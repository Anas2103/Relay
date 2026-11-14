-- Per-person chat-list preferences (Telegram-style): pin to top, archive, mute.
ALTER TABLE room_members ADD COLUMN pinned_at INTEGER;
ALTER TABLE room_members ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE room_members ADD COLUMN muted_until INTEGER;

-- Secret chats (end-to-end encrypted). A secret chat is a 'dm' room whose
-- dm_key starts with "secret:"; "Saved Messages" is a one-person 'dm' room whose
-- dm_key starts with "saved:". Each participant registers ONE device's public
-- key here. Private keys are generated in the browser as non-extractable
-- WebCrypto keys and never leave that device, so the server (and every admin,
-- including the owner) only ever stores ciphertext for these rooms.
CREATE TABLE secret_keys (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);
