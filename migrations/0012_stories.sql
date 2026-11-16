-- Stories: a photo or a short text, seen by your contacts for 24 hours.
CREATE TABLE stories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  text       TEXT NOT NULL DEFAULT '',
  background TEXT,
  mime       TEXT,
  data       BLOB,
  width      INTEGER,
  height     INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_stories_user ON stories(user_id, expires_at);
CREATE INDEX idx_stories_expiry ON stories(expires_at);

CREATE TABLE story_views (
  story_id  TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);
