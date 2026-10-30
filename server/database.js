const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

function initializeDatabase(dataDir) {
  const dbPath = path.join(dataDir, 'studyline.db');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.chmodSync(dataDir, 0o700);

  const db = new Database(dbPath);
  fs.chmodSync(dbPath, 0o600);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  return db;
}

module.exports = initializeDatabase;
