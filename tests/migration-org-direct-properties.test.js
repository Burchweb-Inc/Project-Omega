const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const createMigrationModel = require('../migration/model');
const createOrgModel = require('../org/model');

test('org direct-properties migration backfills legacy payloads and is recorded once', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());
  db.exec(`CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  const legacyOrg = {
    id: 'legacy-org',
    slug: 'legacy-slug',
    name: 'Legacy org',
    description: 'Legacy description',
    createdBy: 'user-1',
    timezone: 'America/Denver',
    autoMovePastAssignments: false,
    theme: 'green',
    visibility: 'public',
    shareCode: 'legacy-share',
    shareUses: 2,
    sharePermission: 'viewer',
    allowCrossGroupTaskCopy: true,
    suspendedAt: '2025-01-01T00:00:00.000Z',
    courses: [{ id: 'course-1' }]
  };
  db.prepare('INSERT INTO orgs (id, payload, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
    .run(legacyOrg.id, JSON.stringify(legacyOrg));

  const migrations = createMigrationModel(db);
  migrations.applyPending();
  migrations.applyPending();

  const row = db.prepare('SELECT * FROM orgs WHERE id = ?').get('legacy-org');
  assert.equal(row.slug, 'legacy-slug');
  assert.equal(row.name, 'Legacy org');
  assert.equal(row.description, 'Legacy description');
  assert.equal(row.created_by, 'user-1');
  assert.equal(row.timezone, 'America/Denver');
  assert.equal(row.auto_move_past_assignments, 0);
  assert.equal(row.theme, 'green');
  assert.equal(row.visibility, 'public');
  assert.equal(row.share_code, 'legacy-share');
  assert.equal(row.share_uses, 2);
  assert.equal(row.share_permission, 'viewer');
  assert.equal(row.allow_cross_group_task_copy, 1);
  assert.equal(row.suspended_at, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(JSON.parse(row.payload).courses, [{ id: 'course-1' }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE id = ?')
    .get('001-org-direct-properties').count, 1);

  const orgModel = createOrgModel(db);
  orgModel.init();
  const hydrated = orgModel.get('legacy-org');
  assert.equal(hydrated.name, 'Legacy org');
  assert.equal(hydrated.visibility, 'public');
  assert.equal(hydrated.autoMovePastAssignments, false);
  assert.equal(hydrated.allowCrossGroupTaskCopy, true);
});
