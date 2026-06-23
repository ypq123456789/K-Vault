-- D1-backed KV store for file metadata, sessions, paste, api tokens, guest counters
-- Mirrors the KV namespace semantics exactly: key → (value, metadata, expiration)

CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_kv_store_expires_at ON kv_store(expires_at);
CREATE INDEX IF NOT EXISTS idx_kv_store_updated_at ON kv_store(updated_at DESC);
