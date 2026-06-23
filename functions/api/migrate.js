/**
 * R2 -> D1 migration endpoint (paginated)
 * GET /api/migrate?key=SECRET&dry=1          (dry run: first page only)
 * GET /api/migrate?key=SECRET                (execute: first page)
 * GET /api/migrate?key=SECRET&cursor=XXX     (execute: next page)
 *
 * Each call processes one R2 listing page (up to 100 objects).
 * Returns the cursor for the next call. Repeat until listComplete=true.
 *
 * IMPORTANT: Delete this file after migration is complete.
 */

const MIGRATION_SECRET = 'k-vault-migrate-2026';
const R2_PREFIX = 'kv/';
const PAGE_SIZE = 100;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key');

  if (key !== MIGRATION_SECRET) {
    return jr({ error: 'Invalid migration key' }, 401);
  }
  if (!env.R2_BUCKET) return jr({ error: 'R2_BUCKET not configured' }, 500);
  if (!env.DB) return jr({ error: 'DB (D1) not configured' }, 500);

  const dryRun = url.searchParams.get('dry') === '1';
  const cursor = url.searchParams.get('cursor') || undefined;

  try {
    // List one page of R2 objects
    const page = await env.R2_BUCKET.list({ prefix: R2_PREFIX, cursor, limit: PAGE_SIZE });
    const objects = page.objects || [];
    const nextCursor = page.truncated ? page.cursor : null;

    if (dryRun) {
      return jr({
        dryRun: true,
        pageObjects: objects.length,
        listComplete: !page.truncated,
        nextCursor,
        sampleKeys: objects.slice(0, 3).map(o => o.key),
      });
    }

    // Read each object, decode, insert into D1
    const now = Date.now();
    let inserted = 0;
    const errors = [];
    const statements = [];

    for (const obj of objects) {
      try {
        const fullObj = await env.R2_BUCKET.get(obj.key);
        if (!fullObj) continue;
        const body = await fullObj.text();
        let envelope;
        try { envelope = JSON.parse(body); } catch { continue; }
        if (!envelope || envelope.__kvEnvelope !== 1) continue;

        const on = obj.key;
        if (!on.startsWith(R2_PREFIX) || !on.endsWith('.json')) continue;
        const encoded = on.slice(R2_PREFIX.length, -'.json'.length);

        let decodedKey;
        try {
          const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
          const pad = b64 + '='.repeat((4 - (b64.length % 4 || 4)) % 4);
          const bin = atob(pad);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          decodedKey = new TextDecoder().decode(bytes);
        } catch { continue; }

        statements.push({
          key: decodedKey,
          ej: JSON.stringify(envelope),
          mj: JSON.stringify(envelope.metadata ?? {}),
          exp: envelope.expiration ? envelope.expiration * 1000 : null,
        });
      } catch (e) {
        errors.push({ key: obj.key, error: e.message });
      }
    }

    // Batch insert into D1
    if (statements.length > 0) {
      const BATCH = 50;
      for (let i = 0; i < statements.length; i += BATCH) {
        const batch = statements.slice(i, i + BATCH);
        const stmts = batch.map(s =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).bind(s.key, s.ej, s.mj, now, now, s.exp)
        );
        await env.DB.batch(stmts);
        inserted += batch.length;
      }
    }

    // Get D1 count
    let d1Count = 0;
    try {
      const r = await env.DB.prepare("SELECT COUNT(*) as cnt FROM kv_store").first();
      d1Count = r?.cnt || 0;
    } catch {}

    return jr({
      pageObjects: objects.length,
      pageDecoded: statements.length,
      inserted,
      d1Count,
      errors: errors.length,
      listComplete: !page.truncated,
      nextCursor,
    });
  } catch (e) {
    return jr({ error: e.message }, 500);
  }
}

function jr(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
