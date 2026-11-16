-- Owner powers: timed suspensions with a reason, and "restricted" accounts
-- (can read, can't send, call, upload or post until a time).
ALTER TABLE users ADD COLUMN suspended_until INTEGER;
ALTER TABLE users ADD COLUMN suspend_reason TEXT;
ALTER TABLE users ADD COLUMN restricted_until INTEGER;
ALTER TABLE users ADD COLUMN restrict_reason TEXT;
