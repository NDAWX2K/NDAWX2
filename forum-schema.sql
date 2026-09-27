PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER REFERENCES comments(id),
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 40),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 2 AND 2000),
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected')),
  created_at INTEGER NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  ip_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_status_id ON comments(status,id);
CREATE INDEX IF NOT EXISTS comments_parent_status ON comments(parent_id,status,id);
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_expiry ON rate_limits(expires_at);
