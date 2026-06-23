/**
 * R2 -> D1 migration endpoint (standalone, no admin middleware)
 * GET /api/migrate?key=<SECRET>&dry=1  (dry run)
 * GET /api/migrate?key=<SECRET>         (execute migration)
 *
 * IMPORTANT: Delete this file after migration is complete.
 */

const MIGRATION_SECRET = 'k-vault-migrate-2026';
const R2_PREFIX = 'kv/';
const D1_BATCH_SIZE = 50;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== MIGRATION_SECRET) {
    return new Response(JSON.stringify({ error: 'Invalid migration key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.R2_BUCKET) {
    return jsonResponse({ error: 'R2_BUCKET not configured' }, 500);
  }
  if (!env.DB) {
    return jsonResponse({ error: 'DB (D1) not configured' }, 500);
  }

  const dryRun = url.searchParams.get('dry') === '1';

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

    // Step 2: Read each object and build records
    const now = Date.now();
    const statements = [];
    const errors = [];

    for (const obj of objects) {
      try {
        const body = await obj.text();
        let envelope;
        try { envelope = JSON.parse(body); } catch { continue; }
        if (!envelope || envelope.__kvEnvelope !== 1) continue;

        const objectName = obj.key;
        if (!objectName.startsWith(R2_PREFIX) || !objectName.endsWith('.json')) continue;
        const encodedKey = objectName.slice(R2_PREFIX.length, -'.json'.length);

        let key;
        try {
          const base64 = encodedKey.replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
          const binary = atob(padded);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          key = new TextDecoder().decode(bytes);
        } catch { continue; }

        const envelopeJson = JSON.stringify(envelope);
        const metadataJson = JSON.stringify(envelope.metadata ?? {});
        const expiresAt = envelope.expiration ? envelope.expiration * 1000 : null;

        statements.push({ key, envelopeJson, metadataJson, expiresAt });
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
        sampleKeys: statements.slice(0, 10).map(s => s.key),
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
      r2Objects: objects.length,
      validRecords: statements.length,
      inserted,
      d1Count,
      errors: errors.length,
      insertErrors: insertErrors.length,
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
