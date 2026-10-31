module.exports = (db) => ({
  init: () => db.exec(`CREATE TABLE IF NOT EXISTS site_feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open'
  )`)
});
