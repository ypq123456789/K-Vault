#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;
function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 }).trim();
  } catch (e) {
    console.error("Command failed: " + cmd);
    console.error(e.stderr || e.message);
    process.exit(1);
  }
}
function escapeSql(str) {
  if (str == null) return "NULL";
  return "'" + String(str).replace(/'/g, "''") + "'";
}
async function main() {
  console.log("=== KV -> D1 Migration ===");
  console.log("Mode: " + (DRY_RUN ? "DRY RUN" : "LIVE"));
  console.log("");
  console.log("Step 1: Listing all KV keys...");
  var kvListJson = run("wrangler kv key list --binding img_url --prefix \"\"");
  var kvKeys = JSON.parse(kvListJson);
  console.log("  Found " + kvKeys.length + " keys.");
  console.log("Step 2: Fetching values and metadata...");
  var records = [];
  for (var i = 0; i < kvKeys.length; i++) {
    var key = kvKeys[i].name;
    if (i % 100 === 0 && i > 0) console.log("  Progress: " + i + "/" + kvKeys.length);
    try {
      var raw = run("wrangler kv key get \"" + key + "\" --binding img_url --metadata");
      var parsed = JSON.parse(raw);
      records.push({ key: key, value: parsed.value || "", metadata: parsed.metadata || null, expiration: parsed.expiration || null });
    } catch (e) {
      console.warn("  Warning: Failed to fetch key \"" + key + "\", skipping.");
    }
  }
  console.log("  Fetched " + records.length + " records.");
  console.log("Step 3: Building SQL...");
  var now = Date.now();
  var stmts = [];
  for (var i = 0; i < records.length; i++) {
    var rec = records[i];
    var envelope = { __kvEnvelope: 1, value: String(rec.value || ""), valueEncoding: "text", metadata: rec.metadata, expiration: rec.expiration ? Math.floor(new Date(rec.expiration).getTime() / 1000) : null };
    var ej = JSON.stringify(envelope);
    var mj = JSON.stringify(rec.metadata || {});
    var exp = envelope.expiration ? envelope.expiration * 1000 : null;
    stmts.push("INSERT OR IGNORE INTO kv_store (key, value, metadata_json, created_at, updated_at, expires_at) VALUES (" + escapeSql(rec.key) + ", " + escapeSql(ej) + ", " + escapeSql(mj) + ", " + now + ", " + now + ", " + (exp === null ? "NULL" : exp) + ")");
  }
  console.log("  Generated " + stmts.length + " statements.");
  if (DRY_RUN) {
    console.log("  [DRY RUN] Would execute " + stmts.length + " records. Remove --dry-run to execute.");
    return;
  }
  console.log("Step 4: Writing to D1...");
  var tmpDir = path.join(__dirname, "..", ".tmp-migration");
  fs.mkdirSync(tmpDir, { recursive: true });
  var executed = 0;
  for (var i = 0; i < stmts.length; i += BATCH_SIZE) {
    var batch = stmts.slice(i, i + BATCH_SIZE);
    var sqlFile = path.join(tmpDir, "batch_" + Math.floor(i / BATCH_SIZE) + ".sql");
    fs.writeFileSync(sqlFile, batch.join(";\n") + ";", "utf8");
    try {
      run("wrangler d1 execute k-vault-metadata --remote --file \"" + sqlFile + "\"");
      executed += batch.length;
      if (executed % 200 === 0) console.log("  Progress: " + executed + "/" + stmts.length);
    } catch (e) {
      console.error("  Error at index " + i + ": " + e.message);
    }
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  console.log("\n=== Migration complete ===");
  console.log("Records migrated: " + executed + "/" + stmts.length);
  console.log("Step 5: Verifying...");
  try {
    var cnt = run("wrangler d1 execute k-vault-metadata --remote --command \"SELECT COUNT(*) as cnt FROM kv_store\"");
    console.log("  D1 row count: " + cnt);
    console.log("  KV key count: " + kvKeys.length);
  } catch (e) {
    console.warn("  Could not verify. Run: wrangler d1 execute k-vault-metadata --command \"SELECT COUNT(*) FROM kv_store\"");
  }
}
main().catch(function(e) { console.error("Migration failed:", e); process.exit(1); });
