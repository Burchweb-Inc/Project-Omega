const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createOrgModel = require('../org/model');

function createModel(context) {
  const db = new Database(':memory:');
  context.after(() => db.close());
  const model = createOrgModel(db);
  model.init();
  return { db, model };
}

function orgData(id, name, attributes = {}) {
  return {
    id,
    name,
    slug: `${id}-slug`,
    visibility: 'private',
    courses: [],
    groups: [],
    members: [],
    ...attributes
  };
}

test('initializes and migrates is_active for existing org rows', (context) => {
  const db = new Database(':memory:');
  context.after(() => db.close());

  db.prepare(`CREATE TABLE orgs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  db.prepare('INSERT INTO orgs (id, payload, updated_at) VALUES (?, ?, ?)').run(
    'org-1',
    JSON.stringify(orgData('org-1', 'Study Group')),
    '2025-01-01 00:00:00'
  );

  const model = createOrgModel(db);
  model.init();

  assert.equal(db.prepare('SELECT is_active FROM orgs WHERE id = ?').get('org-1').is_active, 1);
  assert.equal(model.all()[0].name, 'Study Group');
});

test('create persists an org with its owner as admin and preserves unrelated rows', (context) => {
  const { db, model } = createModel(context);
  const existing = orgData('existing-org', 'Existing org');
  model.save(existing);

  const created = model.create({ userId: 'user-1', name: 'Study Group', description: 'A place to study', timezone: 'Asia/Tokyo' });

  assert.equal(created.name, 'Study Group');
  assert.equal(created.description, 'A place to study');
  assert.equal(created.createdBy, 'user-1');
  assert.equal(created.timezone, 'Asia/Tokyo');
  assert.equal(created.autoMovePastAssignments, true);
  assert.equal(created.members[0].userId, 'user-1');
  assert.equal(created.members[0].role, 'admin');
  assert.equal(model.get(created.id).name, 'Study Group');
  assert.deepEqual(model.all().map((org) => org.id).sort(), ['existing-org', created.id].sort());
  const savedExisting = db.prepare('SELECT * FROM orgs WHERE id = ?').get('existing-org');
  assert.equal(savedExisting.name, 'Existing org');
  assert.equal(JSON.parse(savedExisting.payload).name, undefined);
  assert.equal(JSON.parse(savedExisting.payload).courses.length, 0);
});

test('assignment past status uses the group date and automatic-move preference', (context) => {
  const { model } = createModel(context);
  const assignment = { due: '2025-01-31' };
  const afterMidnightUtc = new Date('2025-02-01T00:30:00Z');

  assert.equal(model.isPastAssignment({ timezone: 'UTC' }, assignment, afterMidnightUtc), true);
  assert.equal(model.isPastAssignment({ timezone: 'America/New_York' }, assignment, afterMidnightUtc), false);
  assert.equal(model.isPastAssignment({ timezone: 'UTC', autoMovePastAssignments: false }, assignment, afterMidnightUtc), false);
  assert.equal(model.isPastAssignment({ timezone: 'UTC', autoMovePastAssignments: false }, { ...assignment, past: true }, afterMidnightUtc), true);
  assert.equal(model.isPastAssignment({ timezone: 'UTC', autoMovePastAssignments: false }, { ...assignment, pastOverride: true }, afterMidnightUtc), true);
  assert.equal(model.isPastAssignment({ timezone: 'UTC' }, { due: 'No date' }, afterMidnightUtc), false);
});

test('assignment past time is applied on the day after the due date in the group time zone', (context) => {
  const { model } = createModel(context);
  const org = { timezone: 'America/New_York', assignmentPastTime: '17:30' };
  const assignment = { due: '2025-01-30' };

  assert.equal(model.isPastAssignment(org, assignment, new Date('2025-01-31T22:29:00Z')), false);
  assert.equal(model.isPastAssignment(org, assignment, new Date('2025-01-31T22:30:00Z')), true);
  assert.equal(model.isPastAssignment(
    org,
    { ...assignment, pastOverride: false },
    new Date('2025-01-31T22:30:00Z')
  ), true);
  assert.equal(model.isPastAssignment(
    { timezone: 'UTC' },
    assignment,
    new Date('2025-01-31T00:00:00Z')
  ), true);
});

test('A/B-day assignments stay current until their later due date passes', (context) => {
  const { model } = createModel(context);
  const org = { timezone: 'UTC', autoMovePastAssignments: true };
  const now = new Date('2025-02-01T12:00:00Z');

  assert.equal(model.isPastAssignment(org, { due: '2025-01-20', dueA: '2025-01-20', dueB: '2025-02-05' }, now), false);
  assert.equal(model.isPastAssignment(org, { due: '2025-01-20', dueA: '2025-01-20', dueB: '2025-01-25' }, now), true);
  assert.equal(model.isPastAssignment(
    { ...org, assignmentPastTime: '16:00' },
    { due: '2025-01-20', dueA: '2025-01-20', dueB: '2025-01-31' },
    new Date('2025-02-01T15:59:00Z')
  ), false);
  assert.equal(model.isPastAssignment(
    { ...org, assignmentPastTime: '16:00' },
    { due: '2025-01-20', dueA: '2025-01-20', dueB: '2025-01-31' },
    new Date('2025-02-01T16:00:00Z')
  ), true);
});

test('A/B-day course settings and task dates persist', (context) => {
  const { model } = createModel(context);
  model.save(orgData('ab-org', 'A/B Group', {
    courses: [{
      id: 'course-ab',
      abDayEnabled: true,
      items: [{ id: 'ab-task', due: '2025-02-05', dueA: '2025-02-05', dueB: '2025-02-06' }]
    }]
  }));
  const savedCourse = model.get('ab-org').courses[0];

  assert.equal(savedCourse.abDayEnabled, true);
  assert.equal(savedCourse.items[0].dueA, '2025-02-05');
  assert.equal(savedCourse.items[0].dueB, '2025-02-06');
});

test('assignment past time persists and existing orgs default to midnight', (context) => {
  const { model } = createModel(context);
  model.save(orgData('timed-org', 'Timed', { assignmentPastTime: '18:45' }));
  model.save(orgData('legacy-org', 'Legacy'));

  assert.equal(model.get('timed-org').assignmentPastTime, '18:45');
  assert.equal(model.get('legacy-org').assignmentPastTime, '00:00');
  assert.equal(model.isValidAssignmentPastTime('23:59'), true);
  assert.equal(model.isValidAssignmentPastTime('24:00'), false);
  assert.equal(model.isValidAssignmentPastTime('8:00'), false);
});

test('org settings persist and past assignments stay put when automatic moving is disabled', (context) => {
  const { model } = createModel(context);
  model.save(orgData('auto-org', 'Automatic', {
    timezone: 'UTC',
    autoMovePastAssignments: true,
    courses: [{ id: 'course-1', items: [{ id: 'past-item', due: '2000-01-01' }] }]
  }));
  model.save(orgData('manual-org', 'Manual', {
    timezone: 'America/Los_Angeles',
    autoMovePastAssignments: false,
    courses: [{ id: 'course-2', items: [
      { id: 'kept-current', due: '2000-01-01' },
      { id: 'kept-past', due: '2000-01-01', past: true }
    ] }]
  }));

  const automatic = model.get('auto-org');
  const manual = model.get('manual-org');
  assert.equal(automatic.timezone, 'UTC');
  assert.equal(automatic.autoMovePastAssignments, true);
  assert.equal(automatic.courses[0].items[0].past, true);
  assert.equal(manual.timezone, 'America/Los_Angeles');
  assert.equal(manual.autoMovePastAssignments, false);
  assert.deepEqual(manual.courses[0].items.map((item) => item.past), [false, true]);
});

test('create rejects invalid time zones', (context) => {
  const { model } = createModel(context);

  assert.throws(() => model.create({
    userId: 'user-1',
    name: 'Study Group',
    description: 'A place to study',
    timezone: 'Not/A_Timezone'
  }), {
    name: 'TypeError',
    message: 'timezone must be a valid IANA time zone'
  });
});

test('create throws a TypeError when any required field is null or missing', (context) => {
  const { model } = createModel(context);
  const valid = { userId: 'user-1', name: 'Study Group', description: 'A place to study' };

  for (const field of ['userId', 'name', 'description']) {
    assert.throws(() => model.create({ ...valid, [field]: null }), {
      name: 'TypeError',
      message: 'userId, name, and description are required to create an org'
    });
    const missing = { ...valid };
    delete missing[field];
    assert.throws(() => model.create(missing), {
      name: 'TypeError',
      message: 'userId, name, and description are required to create an org'
    });
  }
});

test('get and for load active orgs by ID or slug', (context) => {
  const { model } = createModel(context);
  model.save(orgData('org-1', 'Study Group', { slug: 'study-group' }));
  model.save(orgData('inactive-org', 'Inactive org', { slug: 'inactive-org-slug' }));
  model.delete('inactive-org');

  assert.equal(model.get('org-1').name, 'Study Group');
  assert.equal(model.for({ id: 'org-1' }).slug, 'study-group');
  assert.equal(model.for({ slug: 'study-group' }).id, 'org-1');
  assert.equal(model.get('inactive-org'), null);
  assert.equal(model.for({ slug: 'missing' }), null);
  assert.equal(model.for(), null);
});

test('share-code lookups find active orgs by org and breakout-group codes', (context) => {
  const { model } = createModel(context);
  model.save(orgData('org-1', 'Study Group', {
    shareCode: 'org-share-code',
    groups: [{ id: 'group-1', shareCode: 'group-share-code', members: [], tasks: [], comments: [] }]
  }));
  model.save(orgData('inactive-org', 'Inactive org', {
    shareCode: 'inactive-share-code',
    groups: [{ id: 'inactive-group', shareCode: 'inactive-group-share-code' }]
  }));
  model.delete('inactive-org');

  assert.equal(model.byShareCode('group-share-code').id, 'org-1');
  assert.equal(model.byOrgShareCode('org-share-code').id, 'org-1');
  assert.equal(model.byShareCode('missing'), null);
  assert.equal(model.byOrgShareCode('inactive-share-code'), null);
  assert.equal(model.byShareCode('inactive-group-share-code'), null);
});

test('orgsFor returns active public orgs and orgs containing the requested member', (context) => {
  const { model } = createModel(context);

  model.save(orgData('member-org', 'Member org', {
    members: [
      { userId: 'user-1', role: 'admin' },
      { userId: 'user-1', role: 'editor' }
    ]
  }));
  model.save(orgData('public-org', 'Public org', { visibility: 'public' }));
  model.save(orgData('other-org', 'Other org', { members: [{ userId: 'user-2', role: 'admin' }] }));

  const result = model.orgsFor('user-1');

  assert.deepEqual(result.map((org) => org.id), ['member-org', 'public-org']);
  assert.equal(result.find((org) => org.id === 'member-org').members.length, 2);
  assert.deepEqual(model.orgsFor('missing-user').map((org) => org.id), ['public-org']);
  assert.deepEqual(model.orgsFor('').map((org) => org.id), []);
});

test('forUserOrInvite includes public orgs, memberships, and pending invitations', (context) => {
  const { model } = createModel(context);
  model.save(orgData('member-org', 'Member org', { members: [{ userId: 'user-1', role: 'viewer' }] }));
  model.save(orgData('invite-org', 'Invite org', { pendingInvites: [{ userId: 'user-1' }] }));
  model.save(orgData('public-org', 'Public org', { visibility: 'public' }));
  model.save(orgData('other-org', 'Other org'));

  assert.deepEqual(model.forUserOrInvite('user-1').map((org) => org.id), ['member-org', 'invite-org', 'public-org']);
  assert.deepEqual(model.forUserOrInvite('').map((org) => org.id), []);
});

test('copyCandidatesForUser only returns orgs where the user is a member', (context) => {
  const { model } = createModel(context);
  model.save(orgData('member-org', 'Member org', { members: [{ userId: 'user-1', role: 'editor' }] }));
  model.save(orgData('public-org', 'Public org', { visibility: 'public' }));
  model.save(orgData('invite-org', 'Invite org', { pendingInvites: [{ userId: 'user-1' }] }));

  assert.deepEqual(model.copyCandidatesForUser('user-1').map((org) => org.id), ['member-org']);
  assert.deepEqual(model.copyCandidatesForUser('').map((org) => org.id), []);
});

test('feedFor returns items from courses in public orgs and orgs where the user is a member', (context) => {
  const { model } = createModel(context);

  model.save(orgData('org-1', 'Member org', {
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
  }));
  model.save(orgData('org-2', 'Other org', {
    slug: 'other-org',
    courses: [{ id: 'course-3', name: 'History', items: [{ id: 'item-4', title: 'Essay' }] }],
    members: [{ userId: 'user-2', role: 'admin' }]
  }));
  model.save(orgData('org-public', 'Public org', {
    slug: 'public-org',
    visibility: 'public',
    courses: [{ id: 'course-public', name: 'Art', items: [{ id: 'item-public', title: 'Art project' }] }]
  }));

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

test('save and delete affect only the selected org', (context) => {
  const { db, model } = createModel(context);
  model.save(orgData('org-1', 'First org'));
  model.save(orgData('org-2', 'Second org'));

  const changed = model.get('org-1');
  changed.name = 'Updated first org';
  model.save(changed);
  assert.equal(model.get('org-1').name, 'Updated first org');
  assert.equal(model.get('org-2').name, 'Second org');

  assert.equal(model.delete('org-1'), true);
  assert.equal(model.delete('org-1'), false);
  assert.deepEqual(model.all().map((org) => org.id), ['org-2']);
  assert.equal(db.prepare('SELECT is_active FROM orgs WHERE id = ?').get('org-2').is_active, 1);
  assert.equal(db.prepare('SELECT is_active FROM orgs WHERE id = ?').get('org-1').is_active, 0);
});

test('save stores direct org properties in columns and keeps them out of payload', (context) => {
  const { db, model } = createModel(context);
  model.save(orgData('org-columns', 'Column org', {
    description: 'Description',
    createdBy: 'user-1',
    timezone: 'Asia/Tokyo',
    autoMovePastAssignments: false,
    theme: 'blue',
    visibility: 'public',
    shareCode: 'share-1',
    shareUses: 3,
    sharePermission: 'editor',
    allowCrossGroupTaskCopy: true,
    suspendedAt: '2025-01-01T00:00:00.000Z',
    groups: [{ id: 'nested-group' }]
  }));

  const row = db.prepare('SELECT * FROM orgs WHERE id = ?').get('org-columns');
  const payload = JSON.parse(row.payload);
  assert.equal(row.name, 'Column org');
  assert.equal(row.description, 'Description');
  assert.equal(row.created_by, 'user-1');
  assert.equal(row.timezone, 'Asia/Tokyo');
  assert.equal(row.auto_move_past_assignments, 0);
  assert.equal(row.theme, 'blue');
  assert.equal(row.visibility, 'public');
  assert.equal(row.share_code, 'share-1');
  assert.equal(row.share_uses, 3);
  assert.equal(row.share_permission, 'editor');
  assert.equal(row.allow_cross_group_task_copy, 1);
  assert.equal(row.suspended_at, '2025-01-01T00:00:00.000Z');
  assert.equal(payload.name, undefined);
  assert.equal(payload.visibility, undefined);
  assert.deepEqual(payload.groups, [{ id: 'nested-group' }]);

  const loaded = model.get('org-columns');
  assert.equal(loaded.name, 'Column org');
  assert.equal(loaded.autoMovePastAssignments, false);
  assert.equal(loaded.allowCrossGroupTaskCopy, true);
});
