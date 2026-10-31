const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

test('init creates the site_announcements table with expected columns and defaults', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = require('../announcements/model')(db);
  assert.equal(typeof model.init, 'function');
  model.init();

  const columns = db.prepare('PRAGMA table_info(site_announcements)').all();
  assert.deepEqual(columns.map(({ name }) => name), [
    'id',
    'title',
    'body_markdown',
    'body_html',
    'media_url',
    'media_type',
    'font_size',
    'created_by',
    'created_at'
  ]);
  assert.equal(columns.find(({ name }) => name === 'media_url').dflt_value, "''");
  assert.equal(columns.find(({ name }) => name === 'media_type').dflt_value, "'none'");
  assert.equal(columns.find(({ name }) => name === 'font_size').dflt_value, "'normal'");

  model.init();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?')
    .get('table', 'site_announcements').count, 1);
});
