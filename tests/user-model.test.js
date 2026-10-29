const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const previousDataDir = process.env.DATA_DIR;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-user-model-'));
process.env.DATA_DIR = dataDir;
const createUserModel = require('../users/model');

test('loads users and migrates task payloads through the persistence model', (context) => {
  const db = new Database(':memory:');
  const model = createUserModel(db);
  model.init();
  context.after(() => {
    db.close();
    fs.unlinkSync(path.join(dataDir, '.task-encryption-key'));
    fs.rmdirSync(dataDir);
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });

  db.prepare(`INSERT INTO users (id, name, username, age, password_hash, tasks)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    'user-1',
    'Student',
    'student',
    18,
    'hash',
    JSON.stringify([{ id: 'task-1', title: 'Review notes', due: 'No date' }])
  );

  const users = model.all();
  assert.equal(users.length, 1);
  assert.equal(users[0].tasks[0].title, 'Review notes');
  assert.equal(model.needsEncryptionMigration(), true);

  model.persistState(users);
  const storedTasks = db.prepare('SELECT tasks FROM users WHERE id = ?').get('user-1').tasks;
  assert.match(storedTasks, /^v1:/);
  assert.equal(model.all()[0].tasks[0].title, 'Review notes');
  assert.equal(model.needsEncryptionMigration(), false);

  db.prepare(`INSERT INTO users (id, name, username, age, password_hash)
    VALUES (?, ?, ?, ?, ?)`).run('user-2', 'Other student', 'other', 20, 'other-hash');
  const updatedUser = model.all().find((user) => user.id === 'user-1');
  updatedUser.name = 'Updated student';
  updatedUser.settings.betaTools = true;
  assert.equal(model.updateUser(updatedUser), true);
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get('user-1').name, 'Updated student');
  assert.equal(JSON.parse(db.prepare('SELECT settings FROM users WHERE id = ?').get('user-1').settings).betaTools, true);
  assert.equal(db.prepare('SELECT name FROM users WHERE id = ?').get('user-2').name, 'Other student');

  assert.equal(model.deleteUser('user-1'), true);
  assert.equal(model.deleteUser('user-1'), false);
  assert.deepEqual(model.all().map((user) => user.id), ['user-2']);

  model.persistState([]);
  assert.equal(db.prepare('SELECT is_active FROM users WHERE id = ?').get('user-2').is_active, 0);
  assert.deepEqual(model.all(), []);
});
