-- Age gate and terms acceptance.
-- birth_date: YYYY-MM-DD, checked on the server at sign-up (Relay is 16+). NULL for
-- accounts made before the age gate existed; they're asked for it on their next visit.
-- terms_version / terms_accepted_at: which Terms & Privacy Policy the person accepted, and when.
ALTER TABLE users ADD COLUMN birth_date TEXT;
ALTER TABLE users ADD COLUMN terms_version TEXT;
ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
