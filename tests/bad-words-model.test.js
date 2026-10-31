const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const createBadWordsModel = require('../bad-words/model');

test('init creates bad_word_review_logs with expected columns and defaults', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = createBadWordsModel(db);
  assert.equal(typeof model.init, 'function');
  model.init();

  const columns = db.prepare('PRAGMA table_info(bad_word_review_logs)').all();
  assert.deepEqual(columns.map(({ name }) => name), [
    'id',
    'trigger',
    'checked',
    'kept_words',
    'removed_words',
    'fallback',
    'created_at'
  ]);
  assert.equal(columns.find(({ name }) => name === 'kept_words').dflt_value, "'[]'");
  assert.equal(columns.find(({ name }) => name === 'removed_words').dflt_value, "'[]'");
  assert.equal(columns.find(({ name }) => name === 'fallback').dflt_value, "''");

  model.init();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', 'bad_word_review_logs').count, 1);
});
