-- Roles, suspension and last-login tracking.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'));
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;

-- Every admin action is recorded. Kept even if the admin or target is deleted.
CREATE TABLE admin_audit (
  id              TEXT PRIMARY KEY,
  admin_id        TEXT NOT NULL,
  admin_username  TEXT NOT NULL,
  action          TEXT NOT NULL,
  target_id       TEXT,
  target_username TEXT,
  details         TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_audit_time ON admin_audit(created_at DESC);

CREATE INDEX idx_messages_user ON messages(user_id);
CREATE INDEX idx_users_created ON users(created_at);
