
const crypto = require('crypto');
const initialize = (db) => {
  db.prepare(`CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    slug TEXT,
    name TEXT,
    description TEXT,
    created_by TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    auto_move_past_assignments INTEGER NOT NULL DEFAULT 1 CHECK (auto_move_past_assignments IN (0, 1)),
    theme TEXT,
    visibility TEXT,
    share_code TEXT,
    share_uses INTEGER,
    share_permission TEXT,
    allow_cross_group_task_copy INTEGER NOT NULL DEFAULT 0 CHECK (allow_cross_group_task_copy IN (0, 1)),
    suspended_at TEXT NOT NULL DEFAULT ''
  )`).run();
  ensureOrgColumn(db, 'is_active', 'INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))');
  ensureOrgColumn(db, 'slug', 'TEXT');
  ensureOrgColumn(db, 'name', 'TEXT');
  ensureOrgColumn(db, 'description', 'TEXT');
  ensureOrgColumn(db, 'created_by', 'TEXT');
  ensureOrgColumn(db, 'timezone', "TEXT NOT NULL DEFAULT 'UTC'");
  ensureOrgColumn(db, 'auto_move_past_assignments', 'INTEGER NOT NULL DEFAULT 1 CHECK (auto_move_past_assignments IN (0, 1))');
  ensureOrgColumn(db, 'theme', 'TEXT');
  ensureOrgColumn(db, 'visibility', 'TEXT');
  ensureOrgColumn(db, 'share_code', 'TEXT');
  ensureOrgColumn(db, 'share_uses', 'INTEGER');
  ensureOrgColumn(db, 'share_permission', 'TEXT');
  ensureOrgColumn(db, 'allow_cross_group_task_copy', 'INTEGER NOT NULL DEFAULT 0 CHECK (allow_cross_group_task_copy IN (0, 1))');
  ensureOrgColumn(db, 'suspended_at', "TEXT NOT NULL DEFAULT ''");
};

function ensureOrgColumn(db, name, definition) {
  const columns = db.prepare('PRAGMA table_info(orgs)').all();
  if (!columns.some((column) => column.name === name)) {
    db.exec(`ALTER TABLE orgs ADD COLUMN ${name} ${definition}`);
  }
}

const DIRECT_PROPERTIES = {
  slug: 'slug',
  name: 'name',
  description: 'description',
  createdBy: 'created_by',
  timezone: 'timezone',
  autoMovePastAssignments: 'auto_move_past_assignments',
  theme: 'theme',
  visibility: 'visibility',
  shareCode: 'share_code',
  shareUses: 'share_uses',
  sharePermission: 'share_permission',
  allowCrossGroupTaskCopy: 'allow_cross_group_task_copy',
  suspendedAt: 'suspended_at'
};

function serializeOrg(org) {
  const payload = { ...org };
  for (const property of Object.keys(DIRECT_PROPERTIES)) delete payload[property];
  return JSON.stringify(payload);
}

function orgDatabaseValues(org) {
  return Object.fromEntries(Object.entries(DIRECT_PROPERTIES).map(([property, column]) => {
    let value = org[property];
    if (property === 'timezone') value = isValidTimezone(value) ? value : 'UTC';
    if (property === 'autoMovePastAssignments') value = value === false ? 0 : 1;
    if (property === 'allowCrossGroupTaskCopy') value = value === true ? 1 : 0;
    if (property === 'suspendedAt') value ||= '';
    return [column, value ?? null];
  }));
}

function slug(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || id(); }
function secureSlug(value) { return `${slug(value).slice(0, 24)}-${crypto.randomBytes(24).toString('base64url')}`; }
function breakoutTaskSlug(item) { return `${slug(item.title)}-${item.id.slice(-8)}`; }
function dueImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`); const days = Math.round((dueDate - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}

function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || !timezone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

function currentDateInTimezone(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

function isPastAssignment(org, item, now = new Date()) {
  if (typeof item.pastOverride === 'boolean') return item.pastOverride;
  if (org.autoMovePastAssignments === false) return item.past === true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.due || '')) return false;
  const dueDate = new Date(`${item.due}T00:00:00.000Z`);
  if (Number.isNaN(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== item.due) return false;
  return item.due < currentDateInTimezone(org.timezone, now);
}

function normalizeCourseItems(org, course) {
  course.items = (course.items || []).map((item, index) => {
    const past = isPastAssignment(org, item);
    return { ...item, position: Number.isFinite(Number(item.position)) ? Number(item.position) : index, past };
  });
}

function parseOrgPayload(row) {
  const org = { ...JSON.parse(row.payload) };
  for (const [property, column] of Object.entries(DIRECT_PROPERTIES)) {
    const value = row[column];
    if (value !== null && value !== undefined) {
      org[property] = property === 'autoMovePastAssignments' || property === 'allowCrossGroupTaskCopy'
        ? Boolean(value)
        : value;
    }
  }
  org.timezone = isValidTimezone(org.timezone) ? org.timezone : 'UTC';
  org.autoMovePastAssignments = org.autoMovePastAssignments !== false;
  org.courses = (org.courses || []).map((course) => {
    normalizeCourseItems(org, course);
    return {
      ...course,
      items: course.items.map((item) => ({ ...item, comments: item.comments || [], verifiedBy: item.verifiedBy || [], downvotedBy: item.downvotedBy || [] })),
      board: course.board || [],
      resources: course.resources || []
    };
  });
  org.groups = (org.groups || []).map((group) => {
    const task = group.itemId ? org.courses.flatMap((course) => course.items).find((item) => item.id === group.itemId) : null;
    return {
      ...group,
      members: group.members || [],
      roles: group.roles || {},
      itemId: group.itemId || null,
      taskSlug: group.taskSlug || (task ? breakoutTaskSlug(task) : null),
      shareCode: group.shareCode || crypto.randomBytes(12).toString('base64url'),
      createdBy: group.createdBy || group.members?.[0] || null,
      tasks: group.tasks || [],
      resources: group.resources || [],
      polls: group.polls || [],
      comments: (group.comments || []).map((comment) => ({ ...comment, parentId: comment.parentId || null }))
    };
  });
  org.members = (org.members || []).map((member) => ({ ...member, role: member.role === 'writer' ? 'editor' : member.role || 'viewer' }));
  return {
    ...org,
    slug: org.slug || secureSlug(org.name),
    reports: org.reports || [],
    groups: org.groups || [],
    pendingInvites: org.pendingInvites || [],
    suspendedAt: org.suspendedAt || '',
    shareCode: org.shareCode || crypto.randomBytes(32).toString('base64url')
  };
}

function loadOrgsFromDatabase(db) {
  const rows = db.prepare('SELECT * FROM orgs WHERE is_active = 1 ORDER BY updated_at ASC').all();
  const orgs = rows.map((row) => parseOrgPayload(row));
  return orgs;
}

function saveOrg(db, org) {
  const values = {
    id: org.id,
    payload: serializeOrg(org),
    ...orgDatabaseValues(org)
  };
  const columns = ['id', 'payload', ...Object.values(DIRECT_PROPERTIES)];
  const parameters = columns.map((column) => `@${column}`).join(', ');
  const updates = [...Object.values(DIRECT_PROPERTIES), 'payload']
    .map((column) => `${column} = excluded.${column}`)
    .join(',\n      ');

  db.prepare(`INSERT INTO orgs (${columns.join(', ')}, updated_at, is_active)
    VALUES (${parameters}, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(id) DO UPDATE SET
      ${updates},
      updated_at = CURRENT_TIMESTAMP,
      is_active = 1`).run(values);
}

function createOrg(db, { userId, name, description, timezone = 'UTC' }) {
  if (!userId || !name || description == null) {
    throw new TypeError('userId, name, and description are required to create an org');
  }
  if (!isValidTimezone(timezone)) throw new TypeError('timezone must be a valid IANA time zone');

  const org = {
    id: crypto.randomBytes(4).toString('hex'),
    slug: secureSlug(name),
    name,
    description,
    createdBy: userId,
    timezone,
    autoMovePastAssignments: true,
    theme: 'coral',
    visibility: 'private',
    shareCode: crypto.randomBytes(32).toString('base64url'),
    shareUses: 1,
    sharePermission: 'viewer',
    courses: [],
    groups: [],
    members: [{ userId, role: 'admin' }],
    pendingInvites: [],
    reports: []
  };
  saveOrg(db, org);
  return org;
}

function deleteOrg(db, orgId) {
  return db.prepare('UPDATE orgs SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_active = 1').run(orgId).changes > 0;
}

function loadOrgByIdOrSlug(db, { id: orgId, slug: orgSlug } = {}) {
  if (!orgId && !orgSlug) return null;
  const row = db.prepare('SELECT * FROM orgs WHERE is_active = 1 AND (id = ? OR slug = ?) LIMIT 1').get(orgId || null, orgSlug || null);
  return row ? parseOrgPayload(row) : null;
}

function loadOrgByShareCode(db, shareCode) {
  if (!shareCode) return null;
  const row = db.prepare(`SELECT * FROM orgs WHERE is_active = 1 AND EXISTS (
    SELECT 1 FROM json_each(orgs.payload, '$.groups') AS groups
    WHERE json_extract(groups.value, '$.shareCode') = ?
  ) LIMIT 1`).get(shareCode);
  return row ? parseOrgPayload(row) : null;
}

function loadOrgByOrgShareCode(db, shareCode) {
  if (!shareCode) return null;
  const row = db.prepare('SELECT * FROM orgs WHERE is_active = 1 AND share_code = ? LIMIT 1').get(shareCode);
  return row ? parseOrgPayload(row) : null;
}

function loadOrgsForUser(db, userId) {
  if (!userId) return [];

  const orgs = db.prepare(`
    SELECT orgs.*
    FROM orgs
    WHERE is_active = 1
      AND (
        orgs.visibility = 'public'
        OR EXISTS (
          SELECT 1
          FROM json_each(orgs.payload, '$.members') AS members
          WHERE json_extract(members.value, '$.userId') = ?
        )
      )
    ORDER BY orgs.updated_at ASC
  `).all(userId);

  return orgs.map(parseOrgPayload);
}

function loadOrgsForUserOrInvite(db, userId) {
  if (!userId) return [];
  return loadOrgsFromDatabase(db).filter((org) =>
    org.visibility === 'public' ||
    org.members.some((member) => member.userId === userId) ||
    org.pendingInvites.some((invite) => invite.userId === userId)
  );
}

function loadCopyCandidatesForUser(db, userId) {
  if (!userId) return [];
  return loadOrgsFromDatabase(db).filter((org) =>
    org.members.some((member) => member.userId === userId)
  );
}

module.exports = (db) => ({
  init: () => initialize(db),
  all: () => loadOrgsFromDatabase(db),
  get: (orgId) => loadOrgByIdOrSlug(db, { id: orgId }),
  for: (search = {}) => loadOrgByIdOrSlug(db, search),
  byShareCode: (shareCode) => loadOrgByShareCode(db, shareCode),
  byOrgShareCode: (shareCode) => loadOrgByOrgShareCode(db, shareCode),
  orgsFor: (userId) => loadOrgsForUser(db, userId),
  forUserOrInvite: (userId) => loadOrgsForUserOrInvite(db, userId),
  copyCandidatesForUser: (userId) => loadCopyCandidatesForUser(db, userId),
  feedFor: (userId) => loadOrgsForUser(db, userId).flatMap((org) => org.courses.flatMap((course) => course.items.map((item) => ({ ...item, org, course })))),
  isValidTimezone,
  isPastAssignment,
  create: (data) => createOrg(db, data),
  save: (org) => saveOrg(db, org),
  delete: (orgId) => deleteOrg(db, orgId)
});
