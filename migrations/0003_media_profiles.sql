-- Profiles & preferences
ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar_version INTEGER;          -- NULL = no picture; changes bust the cache
ALTER TABLE users ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'; -- JSON: theme, bubble color...
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;

-- Small profile pictures live in D1 (≤ 200 KB each). Chat media lives in each room's Durable Object.
CREATE TABLE avatars (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT NOT NULL,
  data       BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Rich messages
ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';  -- text | image | voice
ALTER TABLE messages ADD COLUMN media_id TEXT;
ALTER TABLE messages ADD COLUMN meta TEXT;                          -- JSON: size, duration, waveform, viewOnce...
ALTER TABLE messages ADD COLUMN reply_to_id TEXT;
ALTER TABLE messages ADD COLUMN edited_at INTEGER;
ALTER TABLE messages ADD COLUMN deleted_at INTEGER;

CREATE TABLE message_reactions (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- View-once photos: who has already opened them.
CREATE TABLE media_views (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

-- Read receipts / unread counts
ALTER TABLE room_members ADD COLUMN last_read_at INTEGER NOT NULL DEFAULT 0;
