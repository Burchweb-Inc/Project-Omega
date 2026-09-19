const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
const { createIffyModerator } = require('./moderation/iffy');
const { moderationComments, registerCommentRoutes } = require('./moderation/comments');

const app = express();
const port = process.env.PORT || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'studyline.db');
const contentModerator = createIffyModerator();

fs.mkdirSync(dataDir, { recursive: true });
fs.chmodSync(dataDir, 0o700);

const db = new Database(dbPath);
fs.chmodSync(dbPath, 0o600);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  age INTEGER NOT NULL,
  password_hash TEXT NOT NULL,
  tasks TEXT NOT NULL DEFAULT '[]'
)`).run();
try { db.prepare("ALTER TABLE users ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]'").run(); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
for (const column of [
  "notifications TEXT NOT NULL DEFAULT '[]'",
  "moderation_status TEXT NOT NULL DEFAULT 'active'",
  "moderation_message TEXT NOT NULL DEFAULT ''",
  "moderation_until TEXT NOT NULL DEFAULT ''"
]) {
  try { db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
}
db.prepare(`CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`).run();

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.disable('x-powered-by');
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(express.static('public'));

const users = [];
const orgs = [];
const sessions = new Map();
const loginAttempts = new Map();
const courseReorderWindows = new Map();
let taskEncryptionMigrationNeeded = false;

function loadTaskEncryptionKey() {
  if (process.env.TASK_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.TASK_ENCRYPTION_KEY, 'base64url');
    if (key.length !== 32) throw new Error('TASK_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    return key;
  }
  const keyPath = path.join(dataDir, '.task-encryption-key');
  if (!fs.existsSync(keyPath)) fs.writeFileSync(keyPath, crypto.randomBytes(32), { mode: 0o600 });
  fs.chmodSync(keyPath, 0o600);
  const key = fs.readFileSync(keyPath);
  if (key.length !== 32) throw new Error(`${keyPath} must contain exactly 32 bytes.`);
  return key;
}

const taskEncryptionKey = loadTaskEncryptionKey();

function encryptTasks(tasks) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', taskEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tasks || []), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptTasks(storedTasks) {
  if (!storedTasks?.startsWith('v1:')) return JSON.parse(storedTasks || '[]');
  const [, encodedIv, encodedTag, encodedCiphertext] = storedTasks.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', taskEncryptionKey, Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

function loadUsersFromDatabase() {
  const rows = db.prepare('SELECT * FROM users ORDER BY username ASC').all();
  taskEncryptionMigrationNeeded = rows.some((row) => !row.tasks?.startsWith('v1:'));
  users.splice(0, users.length, ...rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    age: Number(row.age),
    passwordHash: row.password_hash,
    tasks: decryptTasks(row.tasks).map(normalizeTask),
    notifications: JSON.parse(row.notifications || '[]'),
    moderationStatus: row.moderation_status || 'active',
    moderationMessage: row.moderation_message || '',
    moderationUntil: row.moderation_until || ''
  })));
}

function loadOrgsFromDatabase() {
  const rows = db.prepare('SELECT * FROM orgs ORDER BY updated_at ASC').all();
  orgs.splice(0, orgs.length, ...rows.map((row) => {
    const org = JSON.parse(row.payload);
    org.courses = (org.courses || []).map((course) => { normalizeCourseItems(course); return { ...course, items: course.items.map((item) => ({ ...item, comments: item.comments || [], verifiedBy: item.verifiedBy || [], downvotedBy: item.downvotedBy || [] })), board: course.board || [], resources: course.resources || [] }; });
    org.groups = (org.groups || []).map((group) => ({ ...group, members: group.members || [], roles: group.roles || {}, itemId: group.itemId || null, createdBy: group.createdBy || group.members?.[0] || null, tasks: group.tasks || [], resources: group.resources || [], polls: group.polls || [], comments: group.comments || [] }));
      org.members = (org.members || []).map((member) => ({ ...member, role: member.role === 'writer' ? 'editor' : member.role || 'viewer' }));
      return { ...org, slug: org.slug || secureSlug(org.name), reports: org.reports || [], groups: org.groups || [], shareCode: org.shareCode || crypto.randomBytes(32).toString('base64url') };
  }));
}

function persistState() {
  const userWrite = db.prepare(`INSERT INTO users (id, name, username, age, password_hash, tasks, notifications, moderation_status, moderation_message, moderation_until)
    VALUES (@id, @name, @username, @age, @passwordHash, @tasks, @notifications, @moderationStatus, @moderationMessage, @moderationUntil)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      username = excluded.username,
      age = excluded.age,
      password_hash = excluded.password_hash,
      tasks = excluded.tasks,
      notifications = excluded.notifications,
      moderation_status = excluded.moderation_status,
      moderation_message = excluded.moderation_message,
      moderation_until = excluded.moderation_until`);
  const orgWrite = db.prepare(`INSERT INTO orgs (id, payload, updated_at)
    VALUES (@id, @payload, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`);

  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM orgs').run();

  users.forEach((user) => userWrite.run({
    id: user.id,
    name: user.name,
    username: user.username,
    age: Number(user.age),
    passwordHash: user.passwordHash,
    tasks: encryptTasks(user.tasks),
    notifications: JSON.stringify(user.notifications || []),
    moderationStatus: user.moderationStatus || 'active',
    moderationMessage: user.moderationMessage || '',
    moderationUntil: user.moderationUntil || ''
  }));

  orgs.forEach((org) => orgWrite.run({
    id: org.id,
    payload: JSON.stringify(org),
    updatedAt: new Date().toISOString()
  }));
}

loadUsersFromDatabase();
loadOrgsFromDatabase();
if (taskEncryptionMigrationNeeded) persistState();

function id() { return crypto.randomBytes(4).toString('hex'); }
function slug(value) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || id(); }
function secureSlug(value) { return `${slug(value).slice(0, 24)}-${crypto.randomBytes(24).toString('base64url')}`; }
function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}
function setSession(response, userId) {
  const token = id() + id();
  sessions.set(token, userId);
  response.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function passwordMatches(password, storedHash) {
  if (!storedHash) return false;
  const [salt, expected] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function loginAllowed(request) {
  const key = request.ip || 'local'; const now = Date.now(); const attempts = (loginAttempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
  loginAttempts.set(key, attempts); return attempts.length < 8;
}
function recordLoginFailure(request) {
  const key = request.ip || 'local'; loginAttempts.set(key, [...(loginAttempts.get(key) || []), Date.now()]);
}
function currentUser(request) {
  const userId = sessions.get(parseCookies(request).session);
  return users.find((user) => user.id === userId);
}
const server = http.createServer(app);
const io = new Server(server);
function liveRequest(request) { return request.is('application/json') || request.get('X-Live-Request') === 'true'; }
function sendMutation(request, response, payload, fallback) {
  if (liveRequest(request)) return response.status(payload.error ? 400 : 200).json(payload);
  return response.redirect(fallback);
}
function courseRoom(orgId, courseId) { return `course:${orgId}:${courseId}`; }
function courseAdminRoom(orgId, courseId) { return `course-admin:${orgId}:${courseId}`; }
function groupRoom(orgId) { return `group:${orgId}`; }
function todoRoom(userId) { return `todo:${userId}`; }
function notificationRoom(userId) { return `notifications:${userId}`; }
function emitCourse(org, course, event, payload) { io.to(courseRoom(org.id, course.id)).emit(event, payload); }
function emitGroup(org, event, payload) { io.to(groupRoom(org.id)).emit(event, payload); }
function emitTodo(userId, event, payload) { io.to(todoRoom(userId)).emit(event, payload); }
function emitNotification(userId, notification) { io.to(notificationRoom(userId)).emit('notification:added', notification); }
function emitCourseAdmins(org, course, event, payload) { io.to(courseAdminRoom(org.id, course.id)).emit(event, payload); }
function dueImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`); const days = Math.round((dueDate - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}
function normalizeTask(task, index = 0) { return { ...task, position: Number.isFinite(Number(task.position)) ? Number(task.position) : index, linked: task.sourceId ? task.linked !== false : false, importance: dueImportance(task.due) }; }
function normalizeUserTasks(user) { if (!user) return; user.tasks = (user.tasks || []).map(normalizeTask); }
function normalizeCourseItems(course) { course.items = (course.items || []).map((item, index) => ({ ...item, position: Number.isFinite(Number(item.position)) ? Number(item.position) : index })); }
function addNotification(user, notification) {
  if (!user) return;
  user.notifications ||= [];
  const created = { id: id(), createdAt: new Date().toISOString(), read: false, ...notification };
  user.notifications.unshift(created);
  user.notifications = user.notifications.slice(0, 50);
  emitNotification(user.id, created);
}
function refreshModerationStatus(user) {
  if (user?.moderationStatus === 'suspended' && user.moderationUntil && new Date(user.moderationUntil) <= new Date()) {
    user.moderationStatus = 'active'; user.moderationUntil = ''; user.moderationMessage = ''; persistState();
  }
  return user?.moderationStatus || 'active';
}
function requireUser(request, response, next) {
  request.user = currentUser(request);
  if (!request.user) return response.redirect('/');
  if (refreshModerationStatus(request.user) !== 'active') return response.status(403).render('index', { page: 'restricted', view: 'restricted', user: request.user, users, orgs, canEdit, selectedOrg: null, error: null });
  next();
}
function membership(org, user) { return org && user ? org.members.find((member) => member.userId === user.id) : null; }
function render(request, response, page, extra = {}) { normalizeUserTasks(request.user); if (request.user) request.user.tasks.sort((left, right) => left.position - right.position); response.render('index', { page, view: page, user: request.user, users, orgs, canEdit, selectedOrg: null, notifications: request.user?.notifications || [], error: request.query?.error, ...extra }); }
function getOrg(request) { return orgs.find((entry) => entry.id === request.params.id || entry.slug === request.params.slug); }
function getCourse(org, courseId) { return org?.courses.find((course) => course.id === courseId); }
function isOrgModerator(org, user) { const role = membership(org, user)?.role; return role === 'admin' || role === 'moderator'; }
function canEdit(member) { return member?.role === 'admin' || member?.role === 'editor' || member?.role === 'moderator'; }
function isOrgAdmin(org, user) { return membership(org, user)?.role === 'admin'; }
function getBreakoutGroup(org, groupId) { return org?.groups?.find((group) => group.id === groupId); }
function canManageBreakoutGroup(org, group, user) { return Boolean(group && user && (isOrgModerator(org, user) || group.createdBy === user.id || group.roles?.[user.id] === 'Organizer' || group.roles?.[user.id] === 'Admin')); }
function canManageItem(org, item, user) { const group = org?.groups?.find((entry) => entry.itemId === item?.id); return Boolean(item && user && (item.createdBy === user.id || isOrgAdmin(org, user) || canManageBreakoutGroup(org, group, user))); }
function canAccess(org, user) { return Boolean(org && user && (org.visibility === 'public' || membership(org, user))); }
async function contentPolicyError(input) {
  const result = await contentModerator.scan(input);
  const blockingCategories = new Set(['profanity', 'heavy-profanity', 'insult', 'harassment', 'targeted-insult', 'targeted-profanity', 'targeted-abuse', 'bad-word-list', 'content-checker']);
  const hasBlockingFinding = result.findings?.some((finding) => blockingCategories.has(finding.category));
  return result.badScore >= 20 || hasBlockingFinding ? 'This content violates our content policy. Edit it, then try again.' : null;
}
function allItems() {
  return orgs.flatMap((org) => org.courses.flatMap((course) => course.items.map((item) => ({ ...item, org, course }))));
}
function renderOrgPage(request, response, page, extra = {}) {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!canAccess(org, request.user)) return response.redirect('/dashboard');
  render(request, response, page, { selectedOrg: org, member, ...extra });
}

io.use((socket, next) => {
  const user = currentUser({ headers: { cookie: socket.handshake.headers.cookie || '' } });
  if (!user) return next(new Error('Authentication required'));
  socket.user = user;
  next();
});
io.on('connection', (socket) => {
  socket.on('notifications:join', () => socket.join(notificationRoom(socket.user.id)));
  socket.on('todo:join', () => socket.join(todoRoom(socket.user.id)));
  socket.on('course:join', ({ orgId, courseId } = {}) => {
    const org = orgs.find((entry) => entry.id === orgId); const course = getCourse(org, courseId);
    if (canAccess(org, socket.user) && course) { socket.join(courseRoom(org.id, course.id)); if (isOrgAdmin(org, socket.user)) socket.join(courseAdminRoom(org.id, course.id)); }
  });
  socket.on('group:join', ({ orgId } = {}) => {
    const org = orgs.find((entry) => entry.id === orgId);
    if (canAccess(org, socket.user)) socket.join(groupRoom(org.id));
  });
});

registerCommentRoutes({ app, orgs, users, id, persistState, emitCourse, emitGroup, sendMutation, requireUser, getOrg, canAccess, isOrgAdmin, isOrgModerator, canManageBreakoutGroup, contentPolicyError, addNotification });

app.get('/', (request, response) => {
  request.user = currentUser(request);
  if (request.user) return response.redirect('/dashboard');
  render(request, response, 'landing', { error: request.query.error });
});

app.get(['/signup', '/login'], (request, response) => {
  request.user = currentUser(request);
  if (request.user) return response.redirect('/dashboard');
  response.redirect('/');
});

app.post('/signup', (request, response) => {
  const { name, username, password, age } = request.body;
  if (!name || !username || !password || password.length < 8 || !age || Number(age) < 13 || users.some((user) => user.username === username.trim().toLowerCase())) return response.redirect('/?error=signup');
  const user = { id: id(), name: name.trim(), username: username.trim().toLowerCase(), age: Number(age), passwordHash: passwordHash(password), tasks: [] };
  users.push(user); persistState(); setSession(response, user.id); response.redirect('/dashboard');
});

app.post('/login', (request, response) => {
  if (!loginAllowed(request)) return response.redirect('/?error=locked');
  const username = String(request.body.username || '').trim().toLowerCase();
  const user = users.find((candidate) => candidate.username === username);
  if (!user || !passwordMatches(request.body.password || '', user.passwordHash)) { recordLoginFailure(request); return response.redirect('/?error=login'); }
  loginAttempts.delete(request.ip || 'local');
  setSession(response, user.id); response.redirect('/dashboard');
});

app.post('/logout', (request, response) => {
  sessions.delete(parseCookies(request).session);
  response.setHeader('Set-Cookie', 'session=; HttpOnly; Max-Age=0; Path=/'); response.redirect('/');
});

app.post('/notifications/:notificationId/read', requireUser, (request, response) => {
  const notification = (request.user.notifications || []).find((entry) => entry.id === request.params.notificationId);
  if (notification) notification.read = true;
  persistState();
  return sendMutation(request, response, { read: Boolean(notification) }, '/dashboard');
});

app.post('/notifications/:notificationId/delete', requireUser, (request, response) => {
  const before = request.user.notifications || [];
  request.user.notifications = before.filter((notification) => notification.id !== request.params.notificationId);
  persistState();
  return sendMutation(request, response, { deletedNotificationId: request.params.notificationId, deleted: before.length !== request.user.notifications.length }, '/dashboard');
});

app.post('/notifications/read-all', requireUser, (request, response) => {
  (request.user.notifications || []).forEach((notification) => { notification.read = true; });
  persistState();
  return sendMutation(request, response, { readAll: true }, '/dashboard');
});

app.get('/dashboard', requireUser, (request, response) => render(request, response, 'dashboard', { feedItems: allItems().filter((entry) => entry.org.members.some((member) => member.userId === request.user.id)).slice(0, 8) }));
app.get('/todo', requireUser, (request, response) => render(request, response, 'todo'));
app.get('/calendar', requireUser, (request, response) => render(request, response, 'calendar', { calendarItems: allItems().filter((entry) => entry.due && entry.due !== 'No date') }));
app.get('/groups', requireUser, (request, response) => render(request, response, 'groups', { groups: orgs.filter((org) => membership(org, request.user)) }));
app.get(['/org/new', '/group/new'], requireUser, (request, response) => render(request, response, 'new-org'));

app.post(['/orgs', '/groups/new'], requireUser, async (request, response) => {
  const name = String(request.body.name || '').trim();
  if (!name) return response.redirect('/group/new');
  const description = String(request.body.description || '').trim();
  if (await contentPolicyError({ type: 'text', text: `${name} ${description}` })) return response.redirect('/group/new?error=policy');
  const org = { id: id(), slug: secureSlug(name), name, description, theme: 'coral', visibility: 'private', shareCode: crypto.randomBytes(32).toString('base64url'), shareUses: 1, sharePermission: 'viewer', courses: [], groups: [], members: [{ userId: request.user.id, role: 'admin' }], reports: [] };
  orgs.push(org); persistState(); response.redirect(`/group/${org.slug}`);
});

app.get('/group/:slug', requireUser, (request, response) => renderOrgPage(request, response, 'org'));

app.get('/group/:slug/admin', requireUser, (request, response) => {
  const org = getOrg(request);
  if (!org || !isOrgAdmin(org, request.user)) return response.redirect(`/group/${org?.slug || request.params.slug}`);
  response.redirect(`/org/${org.id}/admin/mod`);
});

app.get('/org/:id', requireUser, (request, response) => {
  renderOrgPage(request, response, 'org');
});

app.get('/org/:id/breakout/:groupId', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canAccess(org, request.user)) return response.redirect(`/org/${request.params.id}`);
  renderOrgPage(request, response, 'breakout', { group, groupAdmin: canManageBreakoutGroup(org, group, request.user), groupCourse: getCourse(org, group.courseId), groupItem: getCourse(org, group.courseId)?.items.find((item) => item.id === group.itemId) });
});

app.get('/org/:id/course/:courseId', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canAccess(org, request.user)) return response.redirect(`/org/${request.params.id}`);
  normalizeCourseItems(course); renderOrgPage(request, response, 'course', { course: { ...course, items: [...course.items].sort((left, right) => left.position - right.position) } });
});

app.get('/org/:id/course/:courseId/items/new', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  const member = membership(org, request.user);
  if (!course || !canEdit(member)) return response.redirect(`/org/${request.params.id}/course/${request.params.courseId}`);
  renderOrgPage(request, response, 'new-item', { course });
});

app.get('/org/:id/courses/new', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || !canEdit(member)) return response.redirect(`/org/${request.params.id}`);
  renderOrgPage(request, response, 'new-course');
});

app.get('/org/:id/people', requireUser, (request, response) => renderOrgPage(request, response, 'people'));
app.get('/org/:id/people/new', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}/people`);
  renderOrgPage(request, response, 'people-new');
});
app.get('/org/:id/settings', requireUser, (request, response) => response.redirect(`/org/${request.params.id}/admin/settings`));

app.get('/org/:id/admin/:tab?', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || !isOrgModerator(org, request.user)) return response.redirect(`/org/${request.params.id}`);
  const requestedTab = ['mod', 'report', 'settings', 'share'].includes(request.params.tab) ? request.params.tab : 'mod';
  const adminTab = member.role === 'moderator' && !['mod', 'report'].includes(requestedTab) ? 'mod' : requestedTab;
  const comments = moderationComments(org || { courses: [], groups: [] });
  render(request, response, 'admin', {
    selectedOrg: org,
    member,
    adminTab,
    moderationComments: adminTab === 'mod' ? comments.filter((comment) => !comment.reviewedAt) : comments,
    adminStats: {
      members: org.members?.length || 0,
      openReports: (org.reports || []).filter((report) => report.status === 'open').length,
      comments: comments.filter((comment) => !comment.reviewedAt).length,
      courses: org.courses?.length || 0
    }
  });
});

app.post('/org/:id/courses', requireUser, async (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); if (!org || !canEdit(membership(org, request.user))) return response.redirect(`/org/${request.params.id}`);
  const name = String(request.body.name || '').trim(); const code = String(request.body.code || '').trim().toUpperCase();
  if (await contentPolicyError({ type: 'course', text: `${name} ${code}` })) return response.redirect(`/org/${org.id}/courses/new?error=policy`);
  org.courses.push({ id: id(), name, code, color: request.body.color || '#ef8354', items: [], board: [], resources: [] }); persistState(); response.redirect(`/org/${org.id}/course/${org.courses.at(-1).id}`);
});

app.post('/org/:id/courses/:courseId/items', requireUser, async (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const course = org && org.courses.find((entry) => entry.id === request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this course.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const policyError = await contentPolicyError({ type: 'course-item', text: request.body.title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const item = { id: id(), title: String(request.body.title || '').trim(), type: request.body.type, due: request.body.due || 'No date', done: request.body.type !== 'Event' ? false : null, comments: [], verifiedBy: [], downvotedBy: [], createdBy: request.user.id, position: course.items.length };
  if (!item.title) return sendMutation(request, response, { error: 'A title is required.' }, `/org/${org.id}/course/${course.id}`);
  course.items.push(item); persistState(); emitCourse(org, course, 'course:item-created', { item });
  return sendMutation(request, response, { item }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/course/:courseId/items/reorder', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId); const member = membership(org, request.user);
  if (!course || !canEdit(member)) return sendMutation(request, response, { error: 'Only course editors and admins can reorder tasks.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const now = Date.now(); const key = `${request.user.id}:${course.id}`; const windowState = courseReorderWindows.get(key) || { startedAt: now, count: 0 };
  if (now - windowState.startedAt >= 5000) { windowState.startedAt = now; windowState.count = 0; }
  if (member.role !== 'admin' && windowState.count >= 2) return sendMutation(request, response, { error: 'Please wait 5 seconds before reordering again.', retryAfter: Math.max(0, 5000 - (now - windowState.startedAt)) }, `/org/${org.id}/course/${course.id}`);
  const order = Array.isArray(request.body.order) ? request.body.order : String(request.body.order || '').split(','); const itemsById = new Map(course.items.map((item) => [item.id, item]));
  order.forEach((itemId, index) => { const item = itemsById.get(itemId); if (item) item.position = index; });
  course.items.sort((left, right) => left.position - right.position); windowState.count += 1; courseReorderWindows.set(key, windowState); persistState(); emitCourse(org, course, 'course:items-reordered', { items: course.items });
  return sendMutation(request, response, { items: course.items }, `/org/${org.id}/course/${course.id}`);
});

app.post('/groups', requireUser, async (request, response) => {
  const org = getOrg({ params: { id: request.body.orgId } }); const course = getCourse(org, request.body.courseId);
  if (!org || !course || !membership(org, request.user)) return sendMutation(request, response, { error: 'You cannot create a subgroup here.' }, '/groups');
  const item = course.items.find((entry) => entry.id === request.body.itemId);
  if (request.body.itemId && (!item || item.type !== 'Project')) return sendMutation(request, response, { error: 'Breakout groups can only be created for projects.' }, `/org/${org.id}/course/${course.id}`);
  const existing = item && org.groups?.find((group) => group.itemId === item.id);
  if (existing) return sendMutation(request, response, { group: existing, groupUrl: `/org/${org.id}/breakout/${existing.id}` }, `/org/${org.id}/breakout/${existing.id}`);
  org.groups ||= []; const groupName = String(request.body.name || `${item?.title || course.name} breakout group`).trim();
  if (await contentPolicyError({ type: 'group', text: groupName })) return sendMutation(request, response, { error: 'This content violates our content policy. Edit it, then try again.' }, `/org/${org.id}/course/${course.id}`);
  const group = { id: id(), name: groupName, courseId: course.id, courseName: course.name, itemId: item?.id || null, createdBy: request.user.id, limit: Math.max(2, Number(request.body.limit) || 4), members: [request.user.id], roles: { [request.user.id]: 'Organizer' }, tasks: [{ id: id(), title: 'Choose a direction', claimedBy: request.user.id, done: false }, { id: id(), title: 'Upload shared resources', claimedBy: null, done: false }], resources: [], polls: [{ question: 'When should we meet?', options: ['Today after school', 'Tomorrow at lunch', 'This weekend'], votes: {} }] };
  if (!group.name) return sendMutation(request, response, { error: 'A subgroup name is required.' }, '/groups');
  org.groups.push(group); persistState(); emitCourse(org, course, 'subgroup:created', { group }); emitGroup(org, 'subgroup:created', { group });
  return sendMutation(request, response, { group, groupUrl: `/org/${org.id}/breakout/${group.id}` }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/items/:itemId/verify', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (item) { item.verifiedBy ||= []; const index = item.verifiedBy.indexOf(request.user.id); if (index === -1) item.verifiedBy.push(request.user.id); else item.verifiedBy.splice(index, 1); persistState(); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:verification-changed', { itemId: item.id, verifiedBy: item.verifiedBy }); }
  const course = org?.courses.find((entry) => entry.items.some((entryItem) => entryItem.id === request.params.itemId));
  return sendMutation(request, response, { itemId: item?.id, verifiedBy: item?.verifiedBy || [] }, `/org/${org?.id || ''}/course/${course?.id || ''}`);
});

app.post('/org/:id/items/:itemId/downvote', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (!item || member?.role !== 'admin') return sendMutation(request, response, { error: 'Only organization admins can downvote feed items.' }, `/org/${org?.id || ''}`);
  item.downvotedBy ||= []; const index = item.downvotedBy.indexOf(request.user.id); if (index === -1) item.downvotedBy.push(request.user.id); else item.downvotedBy.splice(index, 1);
  persistState(); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourseAdmins(org, course, 'item:downvote-changed', { itemId: item.id, downvoteCount: item.downvotedBy.length });
  return sendMutation(request, response, { itemId: item.id, downvoteCount: item.downvotedBy.length }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/update', requireUser, async (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (!item || !canManageItem(org, item, request.user)) return sendMutation(request, response, { error: 'You cannot edit this item.' }, `/org/${org?.id || ''}`);
  const title = String(request.body.title || '').trim(); const course = org.courses.find((entry) => entry.items.includes(item)); if (!title) return sendMutation(request, response, { error: 'A title is required.' }, `/org/${org.id}`);
  const nextType = request.body.type || item.type; const policyError = nextType === 'Event' ? null : await contentPolicyError({ type: 'course-item', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}`);
  item.title = title; item.type = nextType; item.due = request.body.due || 'No date';
  users.forEach((user) => { const task = (user.tasks || []).find((entry) => entry.sourceId === item.id && entry.linked !== false); if (task) { task.title = item.title; task.due = item.due; task.source = `${course.name} · ${org.name}`; task.importance = dueImportance(task.due); emitTodo(user.id, 'todo:task-updated', { task: normalizeTask(task) }); } });
  persistState(); emitCourse(org, course, 'item:updated', { item });
  return sendMutation(request, response, { item }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = org?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId)); const item = course?.items.find((entry) => entry.id === request.params.itemId);
  if (!org || !item || !canManageItem(org, item, request.user)) return sendMutation(request, response, { error: 'You cannot delete this item.' }, `/org/${org?.id || ''}`);
  course.items = course.items.filter((entry) => entry.id !== item.id); org.groups = (org.groups || []).filter((group) => group.itemId !== item.id);
  users.forEach((user) => { const task = (user.tasks || []).find((entry) => entry.sourceId === item.id); if (task) { task.sourceId = null; task.linked = false; task.source = 'Unlinked course task'; emitTodo(user.id, 'todo:task-updated', { task: normalizeTask(task) }); } });
  persistState(); emitCourse(org, course, 'item:deleted', { itemId: item.id });
  return sendMutation(request, response, { deleted: true, itemId: item.id }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/todo', requireUser, (request, response) => {
  const org = getOrg(request); const course = canAccess(org, request.user) ? org.courses.find((entry) => entry.items.some((entryItem) => entryItem.id === request.params.itemId)) : null; const item = course?.items.find((entry) => entry.id === request.params.itemId);
  let task;
  if (org && course && item) { request.user.tasks ||= []; task = request.user.tasks.find((entry) => entry.sourceId === item.id); if (!task) { task = normalizeTask({ id: id(), title: item.title, sourceId: item.id, source: `${course.name} · ${org.name}`, due: item.due, priority: 'Normal', done: false, position: request.user.tasks.length }); request.user.tasks.push(task); persistState(); emitCourse(org, course, 'task:added', { userId: request.user.id, task }); emitTodo(request.user.id, 'todo:task-added', { task }); } }
  return sendMutation(request, response, { task: task || null, todoPendingCount: (request.user.tasks || []).filter((entry) => !entry.done).length }, `/org/${org?.id || ''}/course/${course?.id || ''}`);
});

app.post('/tasks/:taskId/toggle', requireUser, (request, response) => {
  const task = (request.user.tasks || []).find((entry) => entry.id === request.params.taskId); if (task) task.done = !task.done; persistState(); if (task) emitTodo(request.user.id, 'todo:task-updated', { task: normalizeTask(task) }); return sendMutation(request, response, { task: task || null, todoPendingCount: (request.user.tasks || []).filter((entry) => !entry.done).length }, '/todo');
});

app.post('/tasks', requireUser, async (request, response) => {
  let task = null;
  if (request.body.title?.trim()) {
    const policyError = await contentPolicyError({ type: 'text', text: request.body.title });
    if (policyError) return sendMutation(request, response, { error: policyError }, '/todo');
    request.user.tasks ||= []; task = normalizeTask({ id: id(), title: request.body.title.trim(), sourceId: null, source: 'Personal study goal', due: request.body.due || 'No date', priority: request.body.priority || 'Normal', done: false, position: request.user.tasks.length }); request.user.tasks.push(task); persistState(); emitTodo(request.user.id, 'todo:task-added', { task });
  }
  return sendMutation(request, response, { task, todoPendingCount: (request.user.tasks || []).filter((entry) => !entry.done).length }, '/todo');
});

app.post('/tasks/:taskId/priority', requireUser, (request, response) => {
  const task = (request.user.tasks || []).find((entry) => entry.id === request.params.taskId); const priority = ['Low', 'Normal', 'Medium', 'High'].includes(request.body.priority) ? request.body.priority : 'Normal';
  if (!task) return sendMutation(request, response, { error: 'Task not found.' }, '/todo');
  task.priority = priority; task.linked = false; persistState(); emitTodo(request.user.id, 'todo:task-updated', { task: normalizeTask(task) }); return sendMutation(request, response, { task, todoPendingCount: (request.user.tasks || []).filter((entry) => !entry.done).length }, '/todo');
});

app.post('/tasks/:taskId/delete', requireUser, (request, response) => {
  const tasks = request.user.tasks || []; const task = tasks.find((entry) => entry.id === request.params.taskId);
  if (!task) return sendMutation(request, response, { error: 'Task not found.' }, '/todo');
  request.user.tasks = tasks.filter((entry) => entry.id !== task.id);
  request.user.tasks.forEach((entry, index) => { entry.position = index; });
  persistState(); emitTodo(request.user.id, 'todo:task-deleted', { taskId: task.id });
  return sendMutation(request, response, { deleted: true, taskId: task.id, todoPendingCount: request.user.tasks.filter((entry) => !entry.done).length }, '/todo');
});

app.post('/tasks/:taskId/reorder', requireUser, (request, response) => {
  const tasks = request.user.tasks || []; const orderedIds = Array.isArray(request.body.order) ? request.body.order : String(request.body.order || '').split(',');
  const byId = new Map(tasks.map((task) => [task.id, task])); orderedIds.forEach((taskId, index) => { const task = byId.get(taskId); if (task) task.position = index; });
  tasks.sort((left, right) => left.position - right.position); persistState(); emitTodo(request.user.id, 'todo:reordered', { tasks: tasks.map(normalizeTask) }); return sendMutation(request, response, { tasks }, '/todo');
});

app.post('/org/:id/items/:itemId/toggle', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (item && item.type !== 'Event') { item.done = !item.done; persistState(); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:updated', { item }); }
  return sendMutation(request, response, { item }, `/org/${org?.id || ''}/course/${org?.courses.find((entry) => entry.items.some((entry) => entry.id === request.params.itemId))?.id || ''}`);
});

app.post('/org/:id/breakout/:groupId/tasks', requireUser, async (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this breakout group.' }, `/org/${request.params.id}`);
  const title = String(request.body.title || '').trim(); if (!title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/breakout/${group.id}`);
  const policyError = await contentPolicyError({ type: 'group-task', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  group.tasks ||= []; const task = { id: id(), title, claimedBy: null, done: false, createdBy: request.user.id }; group.tasks.push(task); persistState(); emitGroup(org, 'breakout:task-created', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/update', requireUser, async (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this task.' }, `/org/${request.params.id}`);
  const nextTitle = String(request.body.title || '').trim() || task.title; const policyError = await contentPolicyError({ type: 'group-task', text: nextTitle });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  task.title = nextTitle; task.done = request.body.done === 'true' || request.body.done === 'on'; persistState(); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/claim', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !group.members.includes(request.user.id)) return sendMutation(request, response, { error: 'You must be in this breakout group to claim a task.' }, `/org/${request.params.id}`);
  task.claimedBy = request.user.id; persistState(); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/unclaim', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || (task.claimedBy !== request.user.id && !canManageBreakoutGroup(org, group, request.user))) return sendMutation(request, response, { error: 'You cannot unclaim this task.' }, `/org/${request.params.id}`);
  task.claimedBy = null; persistState(); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/delegate', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId); const targetId = String(request.body.userId || '');
  if (!group || !task || !canManageBreakoutGroup(org, group, request.user) || !group.members.includes(targetId)) return sendMutation(request, response, { error: 'Only group admins can delegate tasks to group members.' }, `/org/${request.params.id}`);
  task.claimedBy = targetId; persistState(); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this task.' }, `/org/${request.params.id}`);
  group.tasks = (group.tasks || []).filter((task) => task.id !== request.params.taskId); persistState(); emitGroup(org, 'breakout:task-deleted', { groupId: group.id, taskId: request.params.taskId });
  return sendMutation(request, response, { taskId: request.params.taskId }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/board/delete', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this board.' }, `/org/${request.params.id}`);
  group.tasks = []; persistState(); emitGroup(org, 'breakout:board-deleted', { groupId: group.id });
  return sendMutation(request, response, { groupId: group.id }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/course/:courseId/board', requireUser, async (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this board.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.board ||= []; const card = { id: id(), title: String(request.body.title || '').trim(), status: request.body.status || 'Open', claimedBy: null, createdBy: request.user.id };
  if (!card.title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/course/${course.id}`);
  const policyError = await contentPolicyError({ type: 'board-task', text: card.title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#board`);
  course.board.push(card); persistState(); emitCourse(org, course, 'board:card-created', { card });
  return sendMutation(request, response, { card }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/board/:cardId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can delete board cards.' }, `/org/${request.params.id}/course/${request.params.courseId}#board`);
  course.board = (course.board || []).filter((card) => card.id !== request.params.cardId); persistState(); emitCourse(org, course, 'board:card-deleted', { cardId: request.params.cardId });
  return sendMutation(request, response, { deleted: true, cardId: request.params.cardId }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/resources', requireUser, async (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit resources.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.resources ||= []; const resource = { id: id(), title: String(request.body.title || '').trim(), url: String(request.body.url || '').trim(), createdBy: request.user.id };
  if (!resource.title || !resource.url) return sendMutation(request, response, { error: 'A resource title and link are required.' }, `/org/${org.id}/course/${course.id}#resources`);
  const policyError = await contentPolicyError({ type: 'website', text: `${resource.title} ${resource.url}` });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#resources`);
  course.resources.push(resource); persistState(); emitCourse(org, course, 'resource:created', { resource });
  return sendMutation(request, response, { resource }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/course/:courseId/resources/:resourceId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can delete resources.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  const resource = (course.resources || []).find((entry) => entry.id === request.params.resourceId);
  if (!resource) return sendMutation(request, response, { error: 'Resource not found.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  course.resources = course.resources.filter((entry) => entry.id !== resource.id); persistState(); emitCourse(org, course, 'resource:deleted', { resourceId: resource.id });
  return sendMutation(request, response, { deleted: true, resourceId: resource.id }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/admin/settings', requireUser, async (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  const name = String(request.body.name || '').trim(); const description = String(request.body.description || '').trim();
  if (!name || await contentPolicyError({ type: 'text', text: `${name} ${description}` })) return response.redirect(`/org/${request.params.id}/admin/settings?error=policy`);
  org.name = name; org.description = description; org.theme = ['coral', 'green', 'blue', 'gold'].includes(request.body.theme) ? request.body.theme : 'coral'; persistState(); response.redirect(`/org/${org.id}/admin/settings?saved=settings`);
});

app.post('/org/:id/admin/share', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  if (request.body.visibility === 'public' && request.user.age <= 13) return response.redirect(`/org/${org.id}?error=age`);
  org.visibility = request.body.visibility; org.sharePermission = request.body.sharePermission || org.sharePermission; org.shareUses = Math.max(1, Number(request.body.shareUses) || 1); persistState(); response.redirect(`/org/${org.id}/admin/share?saved=settings`);
});

app.post('/org/:id/settings', requireUser, (request, response) => response.redirect(`/org/${request.params.id}/admin/share`));

app.post('/org/:id/members', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const member = membership(org, request.user); const target = users.find((user) => user.username === request.body.username.trim().toLowerCase());
  const role = ['viewer', 'editor', 'moderator'].includes(request.body.role) ? request.body.role : 'viewer';
  if (org && member?.role === 'admin' && target && !membership(org, target)) org.members.push({ userId: target.id, role }); persistState(); response.redirect(`/org/${org.id}/people`);
});

app.post('/org/:id/members/:userId/access', requireUser, (request, response) => {
  const org = getOrg(request); const actor = membership(org, request.user); const target = membership(org, users.find((user) => user.id === request.params.userId));
  const role = ['viewer', 'editor', 'moderator', 'admin'].includes(request.body.role) ? request.body.role : null;
  if (!org || actor?.role !== 'admin' || !target || !role || target.userId === request.user.id) return sendMutation(request, response, { error: 'You cannot change this member access.' }, `/org/${request.params.id}/people`);
  if (target.role === 'admin' && role !== 'admin' && org.members.filter((entry) => entry.role === 'admin').length < 2) return sendMutation(request, response, { error: 'The group must keep at least one admin.' }, `/org/${request.params.id}/people`);
  target.role = role; persistState();
  return sendMutation(request, response, { role, userId: target.userId }, `/org/${org.id}/people`);
});

app.post('/org/:id/members/:userId/remove', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user); const target = membership(org, users.find((user) => user.id === request.params.userId));
  const adminCount = org?.members.filter((entry) => entry.role === 'admin').length || 0;
  if (org && member?.role === 'admin' && target && (target.role !== 'admin' || adminCount > 1)) org.members = org.members.filter((entry) => entry.userId !== request.params.userId);
  persistState(); response.redirect(`/org/${request.params.id}/people`);
});

app.post('/org/:id/members/:userId/repercussion', requireUser, async (request, response) => {
  const org = getOrg(request); const actor = membership(org, request.user); const target = users.find((user) => user.id === request.params.userId); const targetMembership = membership(org, target);
  const action = ['warning', 'suspension', 'ban', 'unban'].includes(request.body.action) ? request.body.action : null;
  if (!org || actor?.role !== 'admin' || !target || !targetMembership || !action || target.id === request.user.id) return sendMutation(request, response, { error: 'You cannot apply that action.' }, `/org/${request.params.id}/people`);
  const message = String(request.body.message || '').trim().slice(0, 500);
  if (message && await contentPolicyError({ type: 'text', text: message })) return sendMutation(request, response, { error: 'That message could not be sent.' }, `/org/${request.params.id}/people`);
  if (action === 'warning') {
    addNotification(target, { type: 'warning', title: `Conduct warning from ${org.name}`, message: message || 'An administrator has given you a conduct warning.' });
  } else if (action === 'suspension') {
    const days = Math.min(30, Math.max(1, Number(request.body.days) || 1)); target.moderationStatus = 'suspended'; target.moderationUntil = new Date(Date.now() + days * 86400000).toISOString(); target.moderationMessage = message || `Your access is suspended for ${days} day${days === 1 ? '' : 's'}.`; addNotification(target, { type: 'suspension', title: `Suspended from ${org.name}`, message: target.moderationMessage });
    sessions.forEach((userId, token) => { if (userId === target.id) sessions.delete(token); });
  } else if (action === 'ban') {
    target.moderationStatus = 'banned'; target.moderationUntil = ''; target.moderationMessage = message || 'Your access is permanently suspended until an administrator lifts the ban.'; addNotification(target, { type: 'ban', title: `Banned from ${org.name}`, message: target.moderationMessage });
    sessions.forEach((userId, token) => { if (userId === target.id) sessions.delete(token); });
  } else {
    target.moderationStatus = 'active'; target.moderationUntil = ''; target.moderationMessage = ''; addNotification(target, { type: 'unban', title: `Access restored to ${org.name}`, message: message || 'An administrator restored your access.' });
  }
  persistState();
  return sendMutation(request, response, { action, userId: target.id, successMessage: action === 'warning' ? 'Warning sent.' : action === 'unban' ? 'Access restored.' : action === 'ban' ? 'Permanent ban applied.' : 'Suspension applied.' }, `/org/${org.id}/people`);
});

app.post('/org/:id/reports', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); if (org && canAccess(org, request.user)) { org.reports ||= []; org.reports.push({ id: id(), reporter: request.user.username, reason: request.body.reason, detail: String(request.body.detail || '').trim(), status: 'open', createdAt: new Date().toISOString() }); persistState(); }
  response.redirect(`/org/${org?.id || ''}?reported=1`);
});

app.post('/org/:id/reports/:reportId/close', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (org && member?.role === 'admin') { const report = (org.reports || []).find((entry) => entry.id === request.params.reportId); if (report) report.status = 'closed'; persistState(); }
  response.redirect(`/org/${org?.id || ''}/admin/report`);
});

app.post('/org/:id/admin/reports/:reportId/action', requireUser, async (request, response) => {
  const org = getOrg(request); const actor = membership(org, request.user); const report = org?.reports?.find((entry) => entry.id === request.params.reportId);
  const action = ['remove', 'remove-moderate', 'warn', 'ban', 'close'].includes(request.body.action) ? request.body.action : null;
  if (!org || !['admin', 'moderator'].includes(actor?.role) || !report || !action) return sendMutation(request, response, { error: 'Only admins and moderators can act on this report.' }, `/org/${request.params.id}/admin/report`);
  const message = String(request.body.message || '').trim().slice(0, 500);
  if (action === 'warn' && !message) return sendMutation(request, response, { error: 'A warning message is required.' }, `/org/${request.params.id}/admin/report`);
  if (message && await contentPolicyError({ type: 'text', text: message })) return sendMutation(request, response, { error: 'That moderation message could not be sent.' }, `/org/${request.params.id}/admin/report`);
  let affectedUser = null;
  if (report.type === 'content' && report.contentId) {
    for (const course of org.courses || []) for (const item of course.items || []) {
      const comment = (item.comments || []).find((entry) => entry.id === report.contentId);
      if (comment) { affectedUser = users.find((user) => user.id === comment.userId); if (['remove', 'remove-moderate', 'ban'].includes(action)) { item.comments = item.comments.filter((entry) => entry.id !== comment.id); emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: comment.id }); } break; }
      if (item.id === report.contentId) { affectedUser = users.find((user) => user.id === item.createdBy); if (['remove', 'remove-moderate', 'ban'].includes(action)) { course.items = course.items.filter((entry) => entry.id !== item.id); emitCourse(org, course, 'item:deleted', { itemId: item.id }); } break; }
    }
    if (!affectedUser) for (const group of org.groups || []) {
      const comment = (group.comments || []).find((entry) => entry.id === report.contentId);
      if (comment) { affectedUser = users.find((user) => user.id === comment.userId); if (['remove', 'remove-moderate', 'ban'].includes(action)) { group.comments = group.comments.filter((entry) => entry.id !== comment.id); emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: comment.id }); } break; }
    }
  }
  if (['remove-moderate', 'warn', 'ban'].includes(action) && affectedUser && affectedUser.id !== request.user.id) {
    const days = Math.min(30, Math.max(1, Number(request.body.days) || 7));
    if (action === 'warn') addNotification(affectedUser, { type: 'warning', title: `Conduct warning from ${org.name}`, message });
    else { affectedUser.moderationStatus = action === 'ban' ? 'banned' : 'suspended'; affectedUser.moderationUntil = action === 'ban' ? '' : new Date(Date.now() + days * 86400000).toISOString(); affectedUser.moderationMessage = message || (action === 'ban' ? 'Your access is permanently suspended until an administrator lifts the ban.' : `Your access is suspended for ${days} days after a content moderation action.`); addNotification(affectedUser, { type: action === 'ban' ? 'ban' : 'suspension', title: `Moderation action in ${org.name}`, message: affectedUser.moderationMessage }); sessions.forEach((userId, token) => { if (userId === affectedUser.id) sessions.delete(token); }); }
  }
  report.status = 'closed'; report.action = action; report.actionBy = request.user.username; report.actionAt = new Date().toISOString(); persistState();
  return sendMutation(request, response, { action, reportId: report.id, successMessage: action === 'close' ? 'Report closed.' : action === 'warn' ? 'Warning sent.' : action === 'remove-moderate' ? 'Content removed and temporary suspension applied.' : action === 'ban' ? 'Content removed and permanent ban applied.' : 'Reported content removed.' }, `/org/${org.id}/admin/report`);
});

app.get('/share/:code', (request, response) => {
    for (const group of org.groups || []) {
      const comment = (group.comments || []).find((entry) => entry.id === report.contentId);
      if (comment) { affectedUser = users.find((user) => user.id === comment.userId); if (action !== 'close') group.comments = group.comments.filter((entry) => entry.id !== comment.id); break; }
    }
  const org = orgs.find((entry) => entry.shareCode === request.params.code);
  if (!org || org.shareUses < 1) return response.status(404).send('This share link is no longer active.');
  const user = currentUser(request); if (!user) return response.redirect('/');
  if (!membership(org, user)) org.members.push({ userId: user.id, role: org.sharePermission }); org.shareUses -= 1; persistState(); response.redirect(`/org/${org.id}`);
});

server.listen(port, () => console.log(`StudyHub running at http://localhost:${port}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);