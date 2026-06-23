/**
 * D1-backed KV namespace adapter
 * Replaces env.img_url with a D1 SQLite-backed store
 * Implements the same KV-like API: get, getWithMetadata, put, delete, list
 */

function isD1MetadataStoreEnabled(env) {
  return String(env?.METADATA_STORE || "").trim().toLowerCase() === "d1";
}

function nowMs() {
  return Date.now();
}

/**
 * Serialize value + metadata into the value column (JSON envelope)
 * Reuses the __kvEnvelope pattern from r2-kv.js for compatibility
 */
function createEnvelope(value, options = {}) {
  const nowSeconds = Math.floor(nowMs() / 1000);
  let expiration = Number(options.expiration || 0);
  if (!expiration && Number(options.expirationTtl || 0) > 0) {
    expiration = nowSeconds + Number(options.expirationTtl || 0);
  }
  const isBinary = value instanceof ArrayBuffer || ArrayBuffer.isView(value);
  let textValue;
  if (isBinary) {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    textValue = btoa(binary);
  } else {
    textValue = value == null ? "" : String(value);
  }
  return {
    __kvEnvelope: 1,
    value: textValue,
    valueEncoding: isBinary ? "base64" : "text",
    metadata: options.metadata ?? null,
    expiration: Number.isFinite(expiration) && expiration > 0 ? Math.floor(expiration) : null,
  };
}

function decodeEnvelopeValue(envelope, type) {
  if (!envelope) return null;
  if (envelope.valueEncoding === "base64") {
    const binary = atob(String(envelope.value || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    if (type === "arrayBuffer") return bytes.buffer;
    const text = new TextDecoder().decode(bytes);
    if (type === "json") return JSON.parse(text || "null");
    return text;
  }
  const text = String(envelope.value ?? "");
  if (type === "json") return JSON.parse(text || "null");
  if (type === "arrayBuffer") return new TextEncoder().encode(text).buffer;
  return text;
}

function isExpired(envelope, now = nowMs()) {
  const expiration = Number(envelope?.expiration || 0);
  return Number.isFinite(expiration) && expiration > 0 && now >= expiration * 1000;
}

export function createD1BackedKvNamespace({ db, fallbackKv, env }) {
  const fallbackReadEnabled = String(env?.METADATA_R2_FALLBACK_READ || "true") !== "false";

  /**
   * Read envelope from D1. If expired, delete lazily. Falls back to KV if configured.
   */
  async function getEnvelope(key) {
    const now = nowMs();
    try {
      const row = await db.prepare("SELECT value FROM kv_store WHERE key = ?").bind(key).first();
      if (row) {
        let envelope;
        try {
          envelope = JSON.parse(row.value);
        } catch {
          envelope = null;
        }
        if (envelope && typeof envelope === "object" && envelope.__kvEnvelope === 1) {
          if (isExpired(envelope, now)) {
            await db.prepare("DELETE FROM kv_store WHERE key = ?").bind(key).run();
            return null;
          }
          return envelope;
        }
      }
    } catch (e) {
      console.warn("D1 getEnvelope error:", e.message);
    }

    // Fallback to legacy KV if available
    if (!fallbackKv || !fallbackReadEnabled) return null;
    try {
      const record = await fallbackKv.getWithMetadata(key);
      if (record?.value == null && !record?.metadata) return null;
      const migrated = createEnvelope(record.value ?? "", { metadata: record.metadata ?? null });
      // Lazy-migrate to D1
      await db.prepare("INSERT OR REPLACE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(key, JSON.stringify(migrated), JSON.stringify(migrated.metadata ?? {}), now, now, migrated.expiration ? migrated.expiration * 1000 : null)
        .run();
      return migrated;
    } catch (e) {
      console.warn("D1 fallback read error:", e.message);
      return null;
    }
  }

  return {
    async get(key, options = {}) {
      const envelope = await getEnvelope(key);
      if (!envelope) return null;
      return decodeEnvelopeValue(envelope, options?.type);
    },

    async getWithMetadata(key, options = {}) {
      const envelope = await getEnvelope(key);
      if (!envelope) return { value: null, metadata: null };
      return {
        value: decodeEnvelopeValue(envelope, options?.type),
        metadata: envelope.metadata ?? null,
      };
    },

    async put(key, value, options = {}) {
      const now = nowMs();
      const envelope = createEnvelope(value, options);
      const envelopeJson = JSON.stringify(envelope);
      const metadataJson = JSON.stringify(envelope.metadata ?? {});
      await db.prepare(
        "INSERT OR REPLACE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(key, envelopeJson, metadataJson, now, now, envelope.expiration ? envelope.expiration * 1000 : null)
        .run();
    },

    async delete(key) {
      await db.prepare("DELETE FROM kv_store WHERE key = ?").bind(key).run();
    },

    async list(options = {}) {
      const now = nowMs();
      const prefix = String(options.prefix || "");
      const requestedLimit = Math.max(1, Math.min(Number(options.limit || 1000), 1000));
      const cursorOffset = Math.max(0, Number.parseInt(String(options.cursor || "0"), 10) || 0);
      const pattern = prefix ? `${prefix}%` : null;

      // Fetch candidates in key order (lexicographic, matching KV behavior)
      const offset = cursorOffset + requestedLimit;
      let results;
      if (pattern) {
        results = await db.prepare("SELECT key, value FROM kv_store WHERE key LIKE ? ORDER BY key LIMIT ?")
          .bind(pattern, offset)
          .all();
      } else {
        results = await db.prepare("SELECT key, value FROM kv_store ORDER BY key LIMIT ?")
          .bind(offset)
          .all();
      }

      const keys = [];
      for (const row of results?.results || []) {
        let envelope;
        try { envelope = JSON.parse(row.value); } catch { continue; }
        if (!envelope || envelope.__kvEnvelope !== 1) continue;
        // Skip expired entries (lazy delete)
        if (isExpired(envelope, now)) {
          await db.prepare("DELETE FROM kv_store WHERE key = ?").bind(row.key).run();
          continue;
        }
        keys.push({
          name: row.key,
          metadata: envelope.metadata ?? null,
        });
      }

      // Apply cursor offset (after filtering expired)
      const paged = keys.slice(cursorOffset, cursorOffset + requestedLimit);
      const nextOffset = cursorOffset + paged.length;
      return {
        keys: paged,
        list_complete: nextOffset >= keys.length,
        cursor: nextOffset < keys.length ? String(nextOffset) : undefined,
      };
    },
  };
}

/**
 * Install D1-backed metadata store into context.env.img_url
 * Called from _middleware.js when METADATA_STORE=d1
 */
export function installD1MetadataStore(context) {
  const env = context?.env;
  if (!isD1MetadataStoreEnabled(env)) return;
  if (!env?.DB) {
    console.warn("METADATA_STORE=d1 requested but DB (D1 binding) is not configured.");
    return;
  }
  env.img_url = createD1BackedKvNamespace({
    db: env.DB,
    fallbackKv: env.img_url,
    env,
  });
}
