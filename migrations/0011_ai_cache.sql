-- Voice message transcripts and message translations, made once and reused.
CREATE TABLE transcripts (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  language   TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE translations (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  lang       TEXT NOT NULL,
  -- The text that was translated (an edit makes a new translation).
  source     TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, lang)
);
