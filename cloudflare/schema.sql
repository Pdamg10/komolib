-- KomoLib Cloudflare D1 Schema (100% Free Tier, persistent SQLite)

CREATE TABLE IF NOT EXISTS google_tokens (
  email TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deleted_rooms (
  code TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shelves (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deleted_shelves (
  code TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_spaces (
  space_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files_meta (
  file_key TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS file_chunks (
  file_key TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (file_key, chunk_index)
);
