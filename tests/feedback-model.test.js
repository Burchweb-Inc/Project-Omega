const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

test('init creates site_feedback with expected columns and default status', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = require('../feedback/model')(db);
  assert.equal(typeof model.init, 'function');
  model.init();

  const columns = db.prepare('PRAGMA table_info(site_feedback)').all();
  assert.deepEqual(columns.map(({ name }) => name), [
    'id',
    'user_id',
    'username',
    'kind',
    'message',
    'created_at',
    'status'
  ]);
  assert.equal(columns.find(({ name }) => name === 'status').dflt_value, "'open'");

  model.init();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', 'site_feedback').count, 1);
});
