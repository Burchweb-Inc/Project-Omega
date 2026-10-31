module.exports = (db) => ({
  init: () =>
    db.exec(`CREATE TABLE IF NOT EXISTS bad_word_review_logs (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        checked INTEGER NOT NULL,
        kept_words TEXT NOT NULL DEFAULT '[]',
        removed_words TEXT NOT NULL DEFAULT '[]',
        fallback TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      )`),
});
