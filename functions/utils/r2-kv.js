const DEFAULT_PREFIX = "kv/";

function isR2MetadataStoreEnabled(env) {
  return String(env?.METADATA_STORE || env?.KV_BACKEND || "")
    .trim()
    .toLowerCase() === "r2";
}

function encodeKey(key) {
  const bytes = new TextEncoder().encode(String(key || ""));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeKey(encoded) {
  const base64 = String(encoded || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function normalizePrefix(raw) {
  const prefix = String(raw || DEFAULT_PREFIX).replace(/^\/+/, "");
  return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function makeObjectKey(prefix, key) {
  return `${prefix}${encodeKey(key)}.json`;
}

function objectNameToKey(prefix, objectName = "") {
  if (!objectName.startsWith(prefix) || !objectName.endsWith(".json")) return "";
  return decodeKey(objectName.slice(prefix.length, -".json".length));
}

function normalizeBody(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value;
}

async function readTextFromBody(body) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  if (typeof body.text === "function") return body.text();
  return String(body);
}

function parseStoredEnvelope(text) {
  try {
    const parsed = JSON.parse(text || "{}");
    if (parsed && typeof parsed === "object" && parsed.__kvEnvelope === 1) {
      return parsed;
    }
  } catch {
    // Fall through to legacy plain string.
  }
  return {
    __kvEnvelope: 1,
    value: text || "",
    valueEncoding: "text",
    metadata: null,
    expiration: null,
  };
}

function isExpired(envelope, now = Date.now()) {
  const expiration = Number(envelope?.expiration || 0);
  return Number.isFinite(expiration) && expiration > 0 && now >= expiration * 1000;
}

async function objectToEnvelope(object) {
  if (!object) return null;
  const text = await object.text();
  return parseStoredEnvelope(text);
}

function createEnvelope(value, options = {}) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  let expiration = Number(options.expiration || 0);
  if (!expiration && Number(options.expirationTtl || 0) > 0) {
    expiration = nowSeconds + Number(options.expirationTtl || 0);
  }
  return {
    __kvEnvelope: 1,
    value,
    valueEncoding: value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? "base64" : "text",
    metadata: options.metadata ?? null,
    expiration: Number.isFinite(expiration) && expiration > 0 ? Math.floor(expiration) : null,
  };
}

async function serializeEnvelope(envelope) {
  let value = normalizeBody(envelope.value);
  if (envelope.valueEncoding === "base64") {
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new TextEncoder().encode(String(value || ""));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    value = btoa(binary);
  } else {
    value = await readTextFromBody(value);
  }
  return JSON.stringify({ ...envelope, value });
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

export function createR2BackedKvNamespace({ bucket, fallbackKv, env }) {
  const prefix = normalizePrefix(env?.METADATA_R2_PREFIX);

  async function getEnvelope(key) {
    const object = await bucket.get(makeObjectKey(prefix, key));
    const envelope = await objectToEnvelope(object);
    if (envelope && isExpired(envelope)) {
      await bucket.delete(makeObjectKey(prefix, key));
      return null;
    }
    if (envelope) return envelope;

    if (!fallbackKv || String(env?.METADATA_R2_FALLBACK_READ || "true") === "false") {
      return null;
    }

    const record = await fallbackKv.getWithMetadata(key);
    if (record?.value == null && !record?.metadata) return null;
    const migrated = createEnvelope(record.value ?? "", { metadata: record.metadata ?? null });
    if (String(env?.METADATA_R2_LAZY_MIGRATE || "true") !== "false") {
      await bucket.put(makeObjectKey(prefix, key), await serializeEnvelope(migrated), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { key: String(key || "").slice(0, 512) },
      });
    }
    return migrated;
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
      const envelope = createEnvelope(value, options);
      const customMetadata = { key: String(key || "").slice(0, 512) };
      if (envelope.expiration) customMetadata.expiration = String(envelope.expiration);
      await bucket.put(makeObjectKey(prefix, key), await serializeEnvelope(envelope), {
        httpMetadata: { contentType: "application/json" },
        customMetadata,
      });
    },

    async delete(key) {
      await bucket.delete(makeObjectKey(prefix, key));
    },

    async list(options = {}) {
      const all = [];
      const requestedPrefix = String(options.prefix || "");
      const limit = Math.max(1, Math.min(Number(options.limit || 1000), 1000));
      const cursorOffset = Math.max(0, Number.parseInt(String(options.cursor || "0"), 10) || 0);
      let cursor = undefined;

      const targetCount = cursorOffset + limit;
      do {
        const page = await bucket.list({ prefix, cursor, limit: 1000 });
        for (const object of page.objects || []) {
          const key = objectNameToKey(prefix, object.key);
          if (!key || (requestedPrefix && !key.startsWith(requestedPrefix))) continue;
          const envelope = await getEnvelope(key);
          if (!envelope) continue;
          all.push({
            name: key,
            metadata: envelope.metadata ?? null,
            expiration: envelope.expiration ?? undefined,
          });
          if (all.length >= targetCount) break;
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor && all.length < targetCount);

      all.sort((left, right) => left.name.localeCompare(right.name));
      const slice = all.slice(cursorOffset, cursorOffset + limit);
      const nextOffset = cursorOffset + slice.length;
      return {
        keys: slice,
        list_complete: !cursor && nextOffset >= all.length,
        cursor: nextOffset < all.length ? String(nextOffset) : undefined,
      };
    },
  };
}

export function installR2MetadataStore(context) {
  const env = context?.env;
  if (!isR2MetadataStoreEnabled(env)) return;
  if (!env?.R2_BUCKET) {
    console.warn("METADATA_STORE=r2 requested but R2_BUCKET is not configured.");
    return;
  }

  env.img_url = createR2BackedKvNamespace({
    bucket: env.R2_BUCKET,
    fallbackKv: env.img_url,
    env,
  });
}
