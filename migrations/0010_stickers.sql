-- Your own sticker collection (made from photos), on every device you sign in to.
CREATE TABLE stickers (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_stickers_user ON stickers(user_id, created_at DESC);
