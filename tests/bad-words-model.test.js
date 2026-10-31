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

test('add inserts a complete bad-word review log', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = createBadWordsModel(db);
  model.init();

  const values = {
    id: 'review-1',
    trigger: 'manual',
    checked: 4,
    keptWords: JSON.stringify(['kind word']),
    removedWords: JSON.stringify(['bad word']),
    fallback: '',
    createdAt: '2025-01-01T12:00:00.000Z'
  };
  assert.deepEqual(model.add(values), { changes: 1, lastInsertRowid: 1 });
});

test('cleanup keeps only the ten newest review logs', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = createBadWordsModel(db);
  model.init();

  for (let index = 1; index <= 12; index += 1) {
    model.add({
      id: `log-${index}`,
      trigger: 'manual',
      checked: 1,
      keptWords: '[]',
      removedWords: '[]',
      fallback: '',
      createdAt: `2025-01-${String(index).padStart(2, '0')}T00:00:00.000Z`
    });
  }

  model.cleanup();

  assert.deepEqual(
    db.prepare('SELECT id FROM bad_word_review_logs ORDER BY created_at').pluck().all(),
    ['log-3', 'log-4', 'log-5', 'log-6', 'log-7', 'log-8', 'log-9', 'log-10', 'log-11', 'log-12']
  );
});
