-- Chill (YouTube Shorts + music): search results kept for a few hours, so
-- everyone shares them and the free YouTube quota (10,000 units a day) lasts.
CREATE TABLE chill_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX chill_cache_expiry ON chill_cache (expires_at);
