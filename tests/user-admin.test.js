const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const previousDataDir = process.env.DATA_DIR;
const previousNodeEnv = process.env.NODE_ENV;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-user-admin-'));
process.env.DATA_DIR = dataDir;
const createUserModel = require('../users/model');

test('site admin bootstrapping is explicit in production', (context) => {
  const db = new Database(':memory:');
  const model = createUserModel(db);
  model.init();
  db.prepare(`INSERT INTO users (id, name, username, age, password_hash, is_site_admin)
    VALUES (?, ?, ?, ?, ?, ?)`).run('admin-1', 'Admin', 'admin', 18, 'hash', 0);

  context.after(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });

  process.env.NODE_ENV = 'production';
  assert.equal(model.all()[0].isSiteAdmin, false);

  process.env.NODE_ENV = 'development';
  assert.equal(model.all()[0].isSiteAdmin, true);
});
