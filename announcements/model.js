module.exports = (db) => ({
  init: () =>
    db.exec(`CREATE TABLE IF NOT EXISTS site_announcements (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body_markdown TEXT NOT NULL,
      body_html TEXT NOT NULL,
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'none',
      font_size TEXT NOT NULL DEFAULT 'normal',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`),
});
