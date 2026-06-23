/**
 * Temporary migration endpoint: R2 kv/ objects -> D1
 * GET /api/admin/migrate-r2-to-d1?secret=<ADMIN_SECRET>
 *
 * Lists all R2 objects under the "kv/" prefix, reads their envelope JSON,
 * and inserts them into the D1 database.
 *
 * IMPORTANT: Delete this file after migration is complete.
 */
import { checkAuthentication, isAuthRequired } from '../../utils/auth.js';

const R2_PREFIX = 'kv/';
const D1_BATCH_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;

  // Auth check
  if (isAuthRequired(env)) {
    const auth = await checkAuthentication(context);
    if (!auth.authenticated) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }
  }

  if (!env.R2_BUCKET) {
    return jsonResponse({ error: 'R2_BUCKET not configured' }, 500);
  }
  if (!env.DB) {
    return jsonResponse({ error: 'DB (D1) not configured' }, 500);
  }

  const dryRun = new URL(request.url).searchParams.get('dry') === '1';

  try {
    // Step 1: List all R2 objects with kv/ prefix
    const objects = [];
    let cursor = undefined;
    let listCalls = 0;
    do {
      const page = await env.R2_BUCKET.list({ prefix: R2_PREFIX, cursor, limit: 1000 });
      for (const obj of page.objects || []) {
        objects.push(obj);
      }
      cursor = page.truncated ? page.cursor : undefined;
      listCalls += 1;
    } while (cursor && listCalls < 100);

    // Step 2: Read each object and build D1 insert statements
    const now = Date.now();
    const statements = [];
    const errors = [];

    for (const obj of objects) {
      try {
        const body = await obj.text();
        let envelope;
        try {
          envelope = JSON.parse(body);
        } catch {
          continue;
        }

        // If it's an envelope, decode the key from the object name
        // Object key format: kv/<base64-encoded-key>.json
        const objectName = obj.key;
        if (!objectName.startsWith(R2_PREFIX) || !objectName.endsWith('.json')) continue;
        const encodedKey = objectName.slice(R2_PREFIX.length, -'.json'.length);

        // Decode base64url key
        let key;
        try {
          const base64 = encodedKey.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
          const binary = atob(padded);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          key = new TextDecoder().decode(bytes);
        } catch {
          // If decode fails, skip
          continue;
        }

        // Validate envelope structure
        if (!envelope || envelope.__kvEnvelope !== 1) continue;

        const envelopeJson = JSON.stringify(envelope);
        const metadataJson = JSON.stringify(envelope.metadata ?? {});
        const expiresAt = envelope.expiration ? envelope.expiration * 1000 : null;

        statements.push({
          key,
          envelopeJson,
          metadataJson,
          expiresAt,
        });
      } catch (e) {
        errors.push({ key: obj.key, error: e.message });
      }
    }

    if (dryRun) {
      return jsonResponse({
        dryRun: true,
        r2Objects: objects.length,
        validRecords: statements.length,
        errors: errors.length,
        sample: statements.slice(0, 5),
      });
    }

    // Step 3: Insert into D1 in batches
    let inserted = 0;
    const insertErrors = [];

    for (let i = 0; i < statements.length; i += D1_BATCH_SIZE) {
      const batch = statements.slice(i, i + D1_BATCH_SIZE);
      try {
        const batchStmts = batch.map(s =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(s.key, s.envelopeJson, s.metadataJson, now, now, s.expiresAt)
        );
        await env.DB.batch(batchStmts);
        inserted += batch.length;
      } catch (e) {
        insertErrors.push({ batchStart: i, error: e.message });
      }
    }

    // Verify
    let d1Count = 0;
    try {
      const countResult = await env.DB.prepare("SELECT COUNT(*) as cnt FROM kv_store").first();
      d1Count = countResult?.cnt || 0;
    } catch {}

    return jsonResponse({
      success: true,
      r2Objects: objects.length,
      validRecords: statements.length,
      inserted,
      d1Count,
      errors: errors.length,
      insertErrors: insertErrors.length,
      errorDetails: [...errors.slice(0, 5), ...insertErrors.slice(0, 5)],
    });
  } catch (e) {
    return jsonResponse({ error: e.message, stack: e.stack }, 500);
  }
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
