-- Groups: each member has a role; whoever creates the group is its first admin.
ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));
ALTER TABLE rooms ADD COLUMN created_by TEXT;

-- Disappearing messages: a per-chat timer. New messages get an expiry; a cron job removes them.
ALTER TABLE rooms ADD COLUMN disappear_ms INTEGER;
ALTER TABLE messages ADD COLUMN expires_at INTEGER;
CREATE INDEX idx_messages_expires ON messages(expires_at) WHERE expires_at IS NOT NULL;

-- Pinned messages (shared by everyone in the chat).
ALTER TABLE messages ADD COLUMN pinned_at INTEGER;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;
CREATE INDEX idx_messages_pinned ON messages(room_id, pinned_at) WHERE pinned_at IS NOT NULL;

-- Starred messages (private to each person).
CREATE TABLE starred (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, message_id)
);

-- Link previews, cached so each page is fetched at most once a day.
CREATE TABLE link_previews (
  url        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

-- Web push subscriptions (one per device).
CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- Site-wide settings the owner controls (announcement banner, sign-ups open/closed).
CREATE TABLE site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
