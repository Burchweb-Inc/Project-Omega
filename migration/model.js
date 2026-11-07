/** @param {import('better-sqlite3').Database} db */
const initialize = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const migrationFiles = ['001-org-direct-properties'];

function applyPending(db) {
  initialize(db);
  const migrations = migrationFiles.map((file) => require(`./${file}`));
  const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');

  for (const migration of migrations) {
    if (hasMigration.get(migration.ID)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(migration.ID);
    })();
  }
}

module.exports = (db) => ({
  init: () => initialize(db),
  applyPending: () => applyPending(db)
});
