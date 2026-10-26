
const crypto = require('crypto');
const initialize = (db) => {
  db.prepare(`CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
  )`).run();
  try { db.prepare("ALTER TABLE orgs ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))").run(); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
};

function slug(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || id(); }
function secureSlug(value) { return `${slug(value).slice(0, 24)}-${crypto.randomBytes(24).toString('base64url')}`; }
function breakoutTaskSlug(item) { return `${slug(item.title)}-${item.id.slice(-8)}`; }
function dueImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`); const days = Math.round((dueDate - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}

function normalizeCourseItems(course) {
  course.items = (course.items || []).map((item, index) => {
    const past = typeof item.pastOverride === 'boolean' ? item.pastOverride : dueImportance(item.due) === 'Overdue';
    return { ...item, position: Number.isFinite(Number(item.position)) ? Number(item.position) : index, past };
  });
}

function parseOrgPayload(row) {
  const org = JSON.parse(row.payload);
      org.courses = (org.courses || []).map((course) => { normalizeCourseItems(course); return { ...course, items: course.items.map((item) => ({ ...item, comments: item.comments || [], verifiedBy: item.verifiedBy || [], downvotedBy: item.downvotedBy || [] })), board: course.board || [], resources: course.resources || [] }; });
      org.groups = (org.groups || []).map((group) => { const task = group.itemId ? org.courses.flatMap((course) => course.items).find((item) => item.id === group.itemId) : null; return { ...group, members: group.members || [], roles: group.roles || {}, itemId: group.itemId || null, taskSlug: group.taskSlug || (task ? breakoutTaskSlug(task) : null), shareCode: group.shareCode || crypto.randomBytes(12).toString('base64url'), createdBy: group.createdBy || group.members?.[0] || null, tasks: group.tasks || [], resources: group.resources || [], polls: group.polls || [], comments: (group.comments || []).map((comment) => ({ ...comment, parentId: comment.parentId || null })) }; });
        org.members = (org.members || []).map((member) => ({ ...member, role: member.role === 'writer' ? 'editor' : member.role || 'viewer' }));
        return { ...org, slug: org.slug || secureSlug(org.name), reports: org.reports || [], groups: org.groups || [], pendingInvites: org.pendingInvites || [], suspendedAt: org.suspendedAt || '', shareCode: org.shareCode || crypto.randomBytes(32).toString('base64url') };
}

function loadOrgsFromDatabase(db) {
  const rows = db.prepare('SELECT * FROM orgs WHERE is_active = 1 ORDER BY updated_at ASC').all();
  const orgs = rows.map((row) => parseOrgPayload(row));
  return orgs;
}

function saveOrg(db, org) {
  db.prepare(`INSERT INTO orgs (id, payload, updated_at, is_active)
    VALUES (@id, @payload, CURRENT_TIMESTAMP, 1)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = CURRENT_TIMESTAMP,
      is_active = 1`).run({
    id: org.id,
    payload: JSON.stringify(org)
  });
}

function createOrg(db, { userId, name, description }) {
  if (!userId || !name || description == null) {
    throw new TypeError('userId, name, and description are required to create an org');
  }

  const org = {
    id: crypto.randomBytes(4).toString('hex'),
    slug: secureSlug(name),
    name,
    description,
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
  const row = db.prepare(`SELECT * FROM orgs WHERE is_active = 1 AND (id = ? OR json_extract(payload, '$.slug') = ?) LIMIT 1`).get(orgId || null, orgSlug || null);
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
  const row = db.prepare(`SELECT * FROM orgs WHERE is_active = 1 AND json_extract(payload, '$.shareCode') = ? LIMIT 1`).get(shareCode);
  return row ? parseOrgPayload(row) : null;
}

function loadOrgsForUser(db, userId) {
  if (!userId) return [];

  const orgs = db.prepare(`
    SELECT orgs.*
    FROM orgs
    WHERE is_active = 1
      AND (
        json_extract(orgs.payload, '$.visibility') = 'public'
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
  create: (data) => createOrg(db, data),
  save: (org) => saveOrg(db, org),
  delete: (orgId) => deleteOrg(db, orgId)
});
