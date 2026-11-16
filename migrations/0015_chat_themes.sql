-- Chat themes (Instagram-style): one look per conversation, shared by everyone in it.
-- NULL = no theme (everyone sees their own appearance settings).
ALTER TABLE rooms ADD COLUMN theme TEXT;
