-- Message requests: a new DM starts as a request (no messages) until the other person accepts.
ALTER TABLE rooms ADD COLUMN status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted'));
ALTER TABLE rooms ADD COLUMN requested_by TEXT;
CREATE INDEX idx_rooms_status ON rooms(status);

-- The site owner's account (Grimm): the only one that can review conversations (every access is audited).
ALTER TABLE users ADD COLUMN super_admin INTEGER NOT NULL DEFAULT 0;
