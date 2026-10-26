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

test('orgsFor returns active public orgs and orgs containing the requested member', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = createOrgModel(db);
  model.init();

  model.persistState([
    {
      id: 'member-org',
      name: 'Member org',
      slug: 'member-org',
      visibility: 'private',
      courses: [],
      groups: [],
      members: [
        { userId: 'user-1', role: 'admin' },
        { userId: 'user-1', role: 'editor' }
      ]
    },
    {
      id: 'public-org',
      name: 'Public org',
      slug: 'public-org',
      visibility: 'public',
      courses: [],
      groups: [],
      members: []
    },
    {
      id: 'other-org',
      name: 'Other org',
      slug: 'other-org',
      visibility: 'private',
      courses: [],
      groups: [],
      members: [{ userId: 'user-2', role: 'admin' }]
    }
  ]);

  const result = model.orgsFor('user-1');

  assert.deepEqual(result.map((org) => org.id), ['member-org', 'public-org']);
  assert.equal(result.find((org) => org.id === 'member-org').members.length, 2);
  assert.deepEqual(model.orgsFor('missing-user').map((org) => org.id), ['public-org']);
  assert.deepEqual(model.orgsFor('').map((org) => org.id), []);
});

test('feedFor returns items from courses in public orgs and orgs where the user is a member', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  const model = createOrgModel(db);
  model.init();

  model.persistState([
    {
      id: 'org-1',
      name: 'Member org',
      slug: 'member-org',
      courses: [
        {
          id: 'course-1',
          name: 'Math',
          items: [
            { id: 'item-1', title: 'Algebra homework' },
            { id: 'item-2', title: 'Geometry review' }
          ]
        },
        {
          id: 'course-2',
          name: 'Science',
          items: [{ id: 'item-3', title: 'Lab report' }]
        }
      ],
      members: [{ userId: 'user-1', role: 'editor' }]
    },
    {
      id: 'org-2',
      name: 'Other org',
      slug: 'other-org',
      visibility: 'private',
      courses: [
        {
          id: 'course-3',
          name: 'History',
          items: [{ id: 'item-4', title: 'Essay' }]
        }
      ],
      members: [{ userId: 'user-2', role: 'admin' }]
    },
    {
      id: 'org-public',
      name: 'Public org',
      slug: 'public-org',
      visibility: 'public',
      courses: [
        {
          id: 'course-public',
          name: 'Art',
          items: [{ id: 'item-public', title: 'Art project' }]
        }
      ],
      members: []
    }
  ]);

  const feed = model.feedFor('user-1');

  assert.deepEqual(feed.map(({ id }) => id), ['item-1', 'item-2', 'item-3', 'item-public']);
  assert.deepEqual(
    feed.map(({ org, course }) => [org.id, course.id]),
    [
      ['org-1', 'course-1'],
      ['org-1', 'course-1'],
      ['org-1', 'course-2'],
      ['org-public', 'course-public']
    ]
  );
  assert.deepEqual(model.feedFor('missing-user').map(({ id }) => id), ['item-public']);
  assert.deepEqual(model.feedFor('').map(({ id }) => id), []);
});
