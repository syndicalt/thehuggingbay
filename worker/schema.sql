CREATE TABLE IF NOT EXISTS uploaders (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  rank TEXT NOT NULL DEFAULT 'Sailor',
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS torrents (
  id INTEGER PRIMARY KEY,
  infohash TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  seeds INTEGER NOT NULL DEFAULT 0,
  leechers INTEGER NOT NULL DEFAULT 0,
  uploader_id INTEGER REFERENCES uploaders(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  license TEXT NOT NULL,
  source_url TEXT,
  description TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  files_json TEXT,
  webseeds_json TEXT,
  torrent_b64 TEXT
);
CREATE INDEX IF NOT EXISTS idx_torrents_cat ON torrents(category);
CREATE INDEX IF NOT EXISTS idx_torrents_seeds ON torrents(seeds);
CREATE TABLE IF NOT EXISTS blobs (
  path TEXT PRIMARY KEY,
  content_b64 TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream'
);
