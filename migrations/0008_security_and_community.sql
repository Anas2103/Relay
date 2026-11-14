-- Signed-in devices (like Telegram's "Active sessions").
ALTER TABLE sessions ADD COLUMN device TEXT;
ALTER TABLE sessions ADD COLUMN location TEXT;
ALTER TABLE sessions ADD COLUMN last_active_at INTEGER;

-- Two-step verification (authenticator app codes + one-time recovery codes, stored hashed).
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_pending TEXT;
ALTER TABLE users ADD COLUMN totp_last_step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN recovery_codes TEXT;
-- Devices that haven't been used for this many days are signed out automatically.
ALTER TABLE users ADD COLUMN session_idle_days INTEGER NOT NULL DEFAULT 180;
-- Discord-style custom status ("🎮 Playing", "🏖️ On holiday").
ALTER TABLE users ADD COLUMN status_text TEXT NOT NULL DEFAULT '';

-- Password checked, waiting for the 6-digit code. Short-lived, and only the token's hash is stored.
CREATE TABLE login_challenges (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  device     TEXT,
  location   TEXT
);

-- Groups: invite links, "only admins can post" (announcement channels) and slow mode.
ALTER TABLE rooms ADD COLUMN invite_code TEXT;
CREATE UNIQUE INDEX idx_rooms_invite ON rooms(invite_code) WHERE invite_code IS NOT NULL;
ALTER TABLE rooms ADD COLUMN admins_only INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN slow_mode_ms INTEGER NOT NULL DEFAULT 0;

-- Polls.
CREATE TABLE poll_votes (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_idx INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id, option_idx)
);
