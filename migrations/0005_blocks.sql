-- Blocking: one row per (blocker, blocked). While a block exists in either
-- direction, the two people can't message, call, see each other's presence,
-- search for each other or open a new chat.
CREATE TABLE blocks (
  blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX idx_blocks_blocked ON blocks(blocked_id);
