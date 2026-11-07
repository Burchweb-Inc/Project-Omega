const path = require('node:path');
const initializeDatabase = require('./server/database');
const createMigrationModel = require('./migration/model');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const db = initializeDatabase(dataDir);

try {
  createMigrationModel(db).applyPending();
  console.log('Database migrations are up to date.');
} finally {
  db.close();
}
