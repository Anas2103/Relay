-- Group bans: a banned person can't rejoin through an invite link (an admin adding them back lifts the ban).
CREATE TABLE group_bans (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by  TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

-- Reports sent to the admins. `snapshot` keeps what was reported, even if it's later deleted.
CREATE TABLE reports (
  id             TEXT PRIMARY KEY,
  reporter_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  room_id        TEXT,
  message_id     TEXT,
  reason         TEXT NOT NULL,
  details        TEXT,
  snapshot       TEXT,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at     INTEGER NOT NULL,
  resolved_by    TEXT,
  resolved_at    INTEGER
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

-- Group photos.
ALTER TABLE rooms ADD COLUMN avatar_version INTEGER;
CREATE TABLE room_avatars (
  room_id    TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Faster search across all your chats.
CREATE INDEX IF NOT EXISTS idx_members_room ON room_members(room_id);
