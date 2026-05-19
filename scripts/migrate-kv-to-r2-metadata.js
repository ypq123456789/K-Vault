#!/usr/bin/env node

const fs = require("node:fs");

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || "af087b3ace8e434ac24273df5b8b9e51";
const namespaceId = process.env.KV_NAMESPACE_ID || "5fe31f18133246fab97ea71a962eea59";
const bucketName = process.env.R2_BUCKET_NAME || "k-vault-files";
const r2Prefix = normalizePrefix(process.env.METADATA_R2_PREFIX || "kv/");
const apiEmail = process.env.CLOUDFLARE_EMAIL;
const apiKey = process.env.CLOUDFLARE_API_KEY;

if (!apiEmail || !apiKey) {
  console.error("CLOUDFLARE_EMAIL and CLOUDFLARE_API_KEY are required.");
  process.exit(1);
}

const headers = {
  "X-Auth-Email": apiEmail,
  "X-Auth-Key": apiKey,
};

function normalizePrefix(prefix) {
  const cleaned = String(prefix || "kv/").replace(/^\/+/, "");
  return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
}

function encodeKey(key) {
  return Buffer.from(String(key || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function cfJson(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(`${init.method || "GET"} ${path} failed: ${JSON.stringify(data.errors || data)}`);
  }
  return data;
}

async function cfRaw(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers });
  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${path} failed (${response.status}): ${text}`);
  }
  return response;
}

async function listKvKeys() {
  const keys = [];
  let cursor = "";
  do {
    const qs = new URLSearchParams({ limit: "1000" });
    if (cursor) qs.set("cursor", cursor);
    const data = await cfJson(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${qs}`);
    keys.push(...(data.result || []));
    cursor = data.result_info?.cursor || "";
  } while (cursor);
  return keys;
}

async function readKvValue(key) {
  const encoded = encodeURIComponent(key);
  const response = await cfRaw(`/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encoded}`);
  if (!response) return "";
  return response.text();
}

async function putR2Object(key, body) {
  const objectKey = `${r2Prefix}${encodeKey(key)}.json`
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/objects/${objectKey}`,
    {
      method: "PUT",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body,
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PUT R2 ${key} failed (${response.status}): ${text}`);
  }
}

function keyNeedsValue(key) {
  return /^(api_token:|paste:|session:|upload:|chunk:|share_slug:|ui_config$|guest:)/.test(String(key || ""));
}

async function mapConcurrent(items, concurrency, worker) {
  const results = [];
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const keys = await listKvKeys();
  let migrated = 0;
  let failed = 0;

  await mapConcurrent(keys, Number(process.env.MIGRATION_CONCURRENCY || 20), async (item, index) => {
    const key = item.name;
    try {
      const value = keyNeedsValue(key) ? await readKvValue(key) : "";
      const envelope = {
        __kvEnvelope: 1,
        value,
        valueEncoding: "text",
        metadata: item.metadata ?? null,
        expiration: item.expiration || null,
      };
      await putR2Object(key, JSON.stringify(envelope));
      migrated += 1;
      if (migrated % 100 === 0) {
        console.log(`Migrated ${migrated}/${keys.length}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`Failed ${key}: ${error.message}`);
    }
  });

  console.log(JSON.stringify({ namespaceId, bucketName, r2Prefix, total: keys.length, migrated, failed }, null, 2));
  fs.writeFileSync("kv-to-r2-migration-result.json", JSON.stringify({ total: keys.length, migrated, failed }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
