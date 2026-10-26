const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createOrgModel = require('../org/model');

test('loads orgs, migrates is_active, and preserves inactive orgs through persistence', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  db.prepare(`CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  db.prepare('INSERT INTO orgs (id, payload, updated_at) VALUES (?, ?, ?)').run(
    'org-1',
    JSON.stringify({ id: 'org-1', name: 'Study Group', slug: 'study-group', courses: [], groups: [], members: [] }),
    '2025-01-01 00:00:00'
  );

  const model = createOrgModel(db);
  model.init();

  assert.equal(db.prepare('SELECT is_active FROM orgs WHERE id = ?').get('org-1').is_active, 1);
  const orgs = model.all();
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].name, 'Study Group');

  model.persistState([{ ...orgs[0], name: 'Updated Study Group' }]);
  const persisted = db.prepare('SELECT payload, is_active FROM orgs WHERE id = ?').get('org-1');
  assert.equal(JSON.parse(persisted.payload).name, 'Updated Study Group');
  assert.equal(persisted.is_active, 1);
  assert.equal(model.all()[0].name, 'Updated Study Group');

  model.persistState([]);
  assert.equal(db.prepare('SELECT is_active FROM orgs WHERE id = ?').get('org-1').is_active, 0);
  assert.deepEqual(model.all(), []);
});
