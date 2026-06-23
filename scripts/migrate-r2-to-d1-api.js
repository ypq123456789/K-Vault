#!/usr/bin/env node
/**
 * Migration script: R2 kv/ objects -> D1 database
 * Uses Cloudflare REST API to list R2 objects and insert into D1.
 *
 * Usage:
 *   node scripts/migrate-r2-to-d1-api.js [--dry-run]
 *
 * Requires CLOUDFLARE_API_TOKEN env var (or Global API Key + Email).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ACCOUNT_ID = 'af087b3ace8e434ac24273df5b8b9e51';
const BUCKET_NAME = 'k-vault-files';
const R2_PREFIX = 'kv/';
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;

// Get API credentials from environment or wrangler config
function getCredentials() {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (apiToken) return { type: 'Bearer', token: apiToken };
  const apiKey = process.env.CLOUDFLARE_API_KEY;
  const email = process.env.CLOUDFLARE_EMAIL;
  if (apiKey && email) return { type: 'Global', apiKey, email };
  throw new Error('Set CLOUDFLARE_API_TOKEN or CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL');
}

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function listR2Objects(credentials, cursor) {
  const params = new URLSearchParams({ prefix: R2_PREFIX, limit: '1000' });
  if (cursor) params.set('cursor', cursor);

  const headers = { 'Content-Type': 'application/json' };
  if (credentials.type === 'Bearer') {
    headers['Authorization'] = `Bearer ${credentials.token}`;
  } else {
    headers['X-Auth-Key'] = credentials.apiKey;
    headers['X-Auth-Email'] = credentials.email;
  }

  const options = {
    hostname: 'api.cloudflare.com',
    path: `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects?${params}`,
    method: 'GET',
    headers,
  };

  const result = await httpsRequest(options);
  if (!result.success) {
    throw new Error('R2 list failed: ' + JSON.stringify(result.errors));
  }
  return result.result;
}

async function getR2Object(credentials, objectKey) {
  const headers = {};
  if (credentials.type === 'Bearer') {
    headers['Authorization'] = `Bearer ${credentials.token}`;
  } else {
    headers['X-Auth-Key'] = credentials.apiKey;
    headers['X-Auth-Email'] = credentials.email;
  }

  const options = {
    hostname: 'api.cloudflare.com',
    path: `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET_NAME}/objects/${encodeURIComponent(objectKey)}`,
    method: 'GET',
    headers,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function escapeSql(str) {
  if (str == null) return 'NULL';
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function decodeBase64UrlKey(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
  const binary = Buffer.from(padded, 'base64').toString('utf8');
  return binary;
}

async function main() {
  console.log('=== R2 -> D1 Migration (via Cloudflare API) ===');
  console.log('Mode: ' + (DRY_RUN ? 'DRY RUN' : 'LIVE'));

  const credentials = getCredentials();

  // Step 1: List all R2 objects with kv/ prefix
  console.log('\nStep 1: Listing R2 objects...');
  const allObjects = [];
  let cursor = undefined;
  let page = 0;
  do {
    const result = await listR2Objects(credentials, cursor);
    const objects = result.objects || [];
    allObjects.push(...objects);
    cursor = result.truncated ? result.cursor : undefined;
    page++;
    if (page % 10 === 0) console.log('  Listed ' + allObjects.length + ' objects...');
  } while (cursor);
  console.log('  Total R2 objects: ' + allObjects.length);

  // Step 2: Read each object and build records
  console.log('\nStep 2: Reading object contents...');
  const records = [];
  for (let i = 0; i < allObjects.length; i++) {
    const obj = allObjects[i];
    if (i % 100 === 0 && i > 0) console.log('  Progress: ' + i + '/' + allObjects.length);
    try {
      const content = await getR2Object(credentials, obj.key);
      if (!content) continue;

      let envelope;
      try { envelope = JSON.parse(content); } catch { continue; }
      if (!envelope || envelope.__kvEnvelope !== 1) continue;

      // Decode key from object name: kv/<base64>.json
      const objectName = obj.key;
      if (!objectName.startsWith(R2_PREFIX) || !objectName.endsWith('.json')) continue;
      const encoded = objectName.slice(R2_PREFIX.length, -'.json'.length);
      let key;
      try { key = decodeBase64UrlKey(encoded); } catch { continue; }

      records.push({ key, envelope });
    } catch (e) {
      console.warn('  Warning: Failed to read ' + obj.key + ': ' + e.message);
    }
  }
  console.log('  Valid records: ' + records.length);

  // Step 3: Build SQL
  console.log('\nStep 3: Building SQL...');
  const now = Date.now();
  const stmts = [];
  for (const rec of records) {
    const ej = JSON.stringify(rec.envelope);
    const mj = JSON.stringify(rec.envelope.metadata || {});
    const exp = rec.envelope.expiration ? rec.envelope.expiration * 1000 : null;
    stmts.push(
      "INSERT OR IGNORE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (" +
      escapeSql(rec.key) + ", " + escapeSql(ej) + ", " + escapeSql(mj) + ", " + now + ", " + now + ", " +
      (exp === null ? 'NULL' : exp) + ")"
    );
  }
  console.log('  Generated ' + stmts.length + ' statements.');

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would insert ' + stmts.length + ' records.');
    console.log('Sample keys:');
    for (const rec of records.slice(0, 10)) {
      console.log('  ' + rec.key);
    }
    return;
  }

  // Step 4: Execute on D1
  console.log('\nStep 4: Writing to D1...');
  const tmpDir = path.join(__dirname, '..', '.tmp-migration');
  fs.mkdirSync(tmpDir, { recursive: true });
  const { execSync } = require('child_process');
  let executed = 0;
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    const batch = stmts.slice(i, i + BATCH_SIZE);
    const sqlFile = path.join(tmpDir, 'batch_' + Math.floor(i / BATCH_SIZE) + '.sql');
    fs.writeFileSync(sqlFile, batch.join(';\n') + ';', 'utf8');
    try {
      execSync('wrangler d1 execute k-vault-metadata --remote --file "' + sqlFile + '"', { encoding: 'utf8', stdio: 'pipe' });
      executed += batch.length;
      if (executed % 200 === 0) console.log('  Progress: ' + executed + '/' + stmts.length);
    } catch (e) {
      console.error('  Error at batch ' + Math.floor(i / BATCH_SIZE) + ': ' + (e.stderr || e.message).slice(0, 200));
    }
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log('\n=== Migration complete ===');
  console.log('Records migrated: ' + executed + '/' + stmts.length);

  // Verify
  console.log('\nStep 5: Verifying...');
  try {
    const out = execSync('wrangler d1 execute k-vault-metadata --remote --command "SELECT COUNT(*) as cnt FROM kv_store"', { encoding: 'utf8', stdio: 'pipe' });
    console.log('  D1 count: ' + out.trim());
  } catch (e) {
    console.warn('  Could not auto-verify. Run manually:');
    console.warn('  wrangler d1 execute k-vault-metadata --remote --command "SELECT COUNT(*) FROM kv_store"');
  }
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
