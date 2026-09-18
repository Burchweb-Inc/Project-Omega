const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Server } = require('socket.io');
const { scanContent } = require('./moderation/content-safety');

const app = express();
const port = process.env.PORT || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'studyline.db');

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
    tasks: decryptTasks(row.tasks).map(normalizeTask)
  })));
}

function loadOrgsFromDatabase() {
  const rows = db.prepare('SELECT * FROM orgs ORDER BY updated_at ASC').all();
  orgs.splice(0, orgs.length, ...rows.map((row) => {
    const org = JSON.parse(row.payload);
    org.courses = (org.courses || []).map((course) => { normalizeCourseItems(course); return { ...course, items: course.items.map((item) => ({ ...item, comments: item.comments || [], verifiedBy: item.verifiedBy || [], downvotedBy: item.downvotedBy || [] })), board: course.board || [], resources: course.resources || [] }; });
    org.groups = (org.groups || []).map((group) => ({ ...group, members: group.members || [], roles: group.roles || {}, itemId: group.itemId || null, createdBy: group.createdBy || group.members?.[0] || null, tasks: group.tasks || [], resources: group.resources || [], polls: group.polls || [], comments: group.comments || [] }));
    return { ...org, slug: org.slug || secureSlug(org.name), reports: org.reports || [], groups: org.groups || [], shareCode: org.shareCode || crypto.randomBytes(32).toString('base64url') };
  }));
}

function persistState() {
  const userWrite = db.prepare(`INSERT INTO users (id, name, username, age, password_hash, tasks)
    VALUES (@id, @name, @username, @age, @passwordHash, @tasks)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      username = excluded.username,
      age = excluded.age,
      password_hash = excluded.password_hash,
      tasks = excluded.tasks`);
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
    tasks: encryptTasks(user.tasks)
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
function sendMutation(request, response, payload, fallback) { return liveRequest(request) ? response.json(payload) : response.redirect(fallback); }
function courseRoom(orgId, courseId) { return `course:${orgId}:${courseId}`; }
function courseAdminRoom(orgId, courseId) { return `course-admin:${orgId}:${courseId}`; }
function groupRoom(orgId) { return `group:${orgId}`; }
function todoRoom(userId) { return `todo:${userId}`; }
function emitCourse(org, course, event, payload) { io.to(courseRoom(org.id, course.id)).emit(event, payload); }
function emitGroup(org, event, payload) { io.to(groupRoom(org.id)).emit(event, payload); }
function emitTodo(userId, event, payload) { io.to(todoRoom(userId)).emit(event, payload); }
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
function requireUser(request, response, next) {
  request.user = currentUser(request);
  if (!request.user) return response.redirect('/');
  next();
}
function membership(org, user) { return org && user ? org.members.find((member) => member.userId === user.id) : null; }
function render(request, response, page, extra = {}) { normalizeUserTasks(request.user); if (request.user) request.user.tasks.sort((left, right) => left.position - right.position); response.render('index', { page, view: page, user: request.user, users, orgs, canEdit, selectedOrg: null, error: request.query?.error, ...extra }); }
function getOrg(request) { return orgs.find((entry) => entry.id === request.params.id || entry.slug === request.params.slug); }
function getCourse(org, courseId) { return org?.courses.find((course) => course.id === courseId); }
function canEdit(member) { return member?.role === 'admin' || member?.role === 'editor'; }
function isOrgAdmin(org, user) { return membership(org, user)?.role === 'admin'; }
function getBreakoutGroup(org, groupId) { return org?.groups?.find((group) => group.id === groupId); }
function canManageBreakoutGroup(org, group, user) { return Boolean(group && user && (isOrgAdmin(org, user) || group.createdBy === user.id || group.roles?.[user.id] === 'Organizer' || group.roles?.[user.id] === 'Admin')); }
function canManageItem(org, item, user) { const group = org?.groups?.find((entry) => entry.itemId === item?.id); return Boolean(item && user && (item.createdBy === user.id || isOrgAdmin(org, user) || canManageBreakoutGroup(org, group, user))); }
function canAccess(org, user) { return Boolean(org && user && (org.visibility === 'public' || membership(org, user))); }
function contentPolicyError(input) {
  const result = scanContent(input);
  return result.badScore >= 20 ? 'This content violates our content policy. Edit it, then try again.' : null;
}
function allItems() {
  return orgs.flatMap((org) => org.courses.flatMap((course) => course.items.map((item) => ({ ...item, org, course }))));
}
function moderationComments(org) {
  const courseComments = org.courses.flatMap((course) => course.items.flatMap((item) => (item.comments || []).map((comment) => ({ ...comment, source: item.title, sourceType: 'course item', container: item }))));
  const groupComments = (org.groups || []).flatMap((group) => (group.comments || []).map((comment) => ({ ...comment, source: group.name, sourceType: 'breakout group', container: group })));
  return [...courseComments, ...groupComments].sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0));
}
function findReportedComment(org, commentId) {
  for (const course of org.courses) for (const item of course.items) {
    const comment = (item.comments || []).find((entry) => entry.id === commentId);
    if (comment) return { comment, item, course, group: null };
  }
  for (const group of org.groups || []) {
    const comment = (group.comments || []).find((entry) => entry.id === commentId);
    if (comment) return { comment, item: null, course: null, group };
  }
  return null;
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

app.get('/dashboard', requireUser, (request, response) => render(request, response, 'dashboard', { feedItems: allItems().filter((entry) => entry.org.members.some((member) => member.userId === request.user.id)).slice(0, 8) }));
app.get('/todo', requireUser, (request, response) => render(request, response, 'todo'));
app.get('/calendar', requireUser, (request, response) => render(request, response, 'calendar', { calendarItems: allItems().filter((entry) => entry.due && entry.due !== 'No date') }));
app.get('/groups', requireUser, (request, response) => render(request, response, 'groups', { groups: orgs.filter((org) => membership(org, request.user)) }));
app.get(['/org/new', '/group/new'], requireUser, (request, response) => render(request, response, 'new-org'));

app.post(['/orgs', '/groups/new'], requireUser, (request, response) => {
  const name = String(request.body.name || '').trim();
  if (!name) return response.redirect('/group/new');
  const org = { id: id(), slug: secureSlug(name), name, description: String(request.body.description || '').trim(), visibility: 'private', shareCode: crypto.randomBytes(32).toString('base64url'), shareUses: 1, sharePermission: 'viewer', courses: [], groups: [], members: [{ userId: request.user.id, role: 'admin' }], reports: [] };
  orgs.push(org); persistState(); response.redirect(`/group/${org.slug}`);
});

app.get('/group/:slug', requireUser, (request, response) => renderOrgPage(request, response, 'org'));

app.get('/group/:slug/admin', requireUser, (request, response) => {
  const org = getOrg(request);
  if (!org || !isOrgAdmin(org, request.user)) return response.redirect(`/group/${org?.slug || request.params.slug}`);
  const comments = moderationComments(org);
  renderOrgPage(request, response, 'admin', {
    moderationComments: comments,
    adminStats: {
      members: org.members.length,
      openReports: (org.reports || []).filter((report) => report.status === 'open').length,
      comments: comments.length,
      courses: org.courses.length
    }
  });
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
app.get('/org/:id/settings', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  render(request, response, 'settings', { selectedOrg: org, member });
});

app.post('/org/:id/courses', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); if (!org || !canEdit(membership(org, request.user))) return response.redirect(`/org/${request.params.id}`);
  org.courses.push({ id: id(), name: request.body.name.trim(), code: request.body.code.trim().toUpperCase(), color: request.body.color || '#ef8354', items: [], board: [], resources: [] }); persistState(); response.redirect(`/org/${org.id}/course/${org.courses.at(-1).id}`);
});

app.post('/org/:id/courses/:courseId/items', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const course = org && org.courses.find((entry) => entry.id === request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this course.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const policyError = request.body.type === 'Event' ? null : contentPolicyError({ type: 'course-item', text: request.body.title });
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

app.post('/groups', requireUser, (request, response) => {
  const org = getOrg({ params: { id: request.body.orgId } }); const course = getCourse(org, request.body.courseId);
  if (!org || !course || !membership(org, request.user)) return sendMutation(request, response, { error: 'You cannot create a subgroup here.' }, '/groups');
  const item = course.items.find((entry) => entry.id === request.body.itemId);
  if (request.body.itemId && (!item || item.type !== 'Project')) return sendMutation(request, response, { error: 'Breakout groups can only be created for projects.' }, `/org/${org.id}/course/${course.id}`);
  const existing = item && org.groups?.find((group) => group.itemId === item.id);
  if (existing) return sendMutation(request, response, { group: existing, groupUrl: `/org/${org.id}/breakout/${existing.id}` }, `/org/${org.id}/breakout/${existing.id}`);
  org.groups ||= []; const group = { id: id(), name: String(request.body.name || `${item?.title || course.name} breakout group`).trim(), courseId: course.id, courseName: course.name, itemId: item?.id || null, createdBy: request.user.id, limit: Math.max(2, Number(request.body.limit) || 4), members: [request.user.id], roles: { [request.user.id]: 'Organizer' }, tasks: [{ id: id(), title: 'Choose a direction', claimedBy: request.user.id, done: false }, { id: id(), title: 'Upload shared resources', claimedBy: null, done: false }], resources: [], polls: [{ question: 'When should we meet?', options: ['Today after school', 'Tomorrow at lunch', 'This weekend'], votes: {} }] };
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

app.post('/org/:id/items/:itemId/update', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (!item || !canManageItem(org, item, request.user)) return sendMutation(request, response, { error: 'You cannot edit this item.' }, `/org/${org?.id || ''}`);
  const title = String(request.body.title || '').trim(); const course = org.courses.find((entry) => entry.items.includes(item)); if (!title) return sendMutation(request, response, { error: 'A title is required.' }, `/org/${org.id}`);
  const nextType = request.body.type || item.type; const policyError = nextType === 'Event' ? null : contentPolicyError({ type: 'course-item', text: title });
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

app.post('/tasks', requireUser, (request, response) => {
  let task = null;
  if (request.body.title?.trim()) {
    const policyError = contentPolicyError({ type: 'text', text: request.body.title });
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

app.post('/org/:id/items/:itemId/comments', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  let comment;
  if (item && String(request.body.comment || '').trim()) {
    const text = String(request.body.comment).trim(); const policyError = contentPolicyError({ type: 'comment', text, previousMessages: item.comments });
    if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org?.id || ''}/course/${org?.courses.find((course) => course.items.some((entry) => entry.id === request.params.itemId))?.id || ''}`);
    comment = { id: id(), author: request.user.name, userId: request.user.id, text, createdAt: new Date().toISOString() }; item.comments.push(comment); persistState(); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:comment-added', { itemId: item.id, comment });
  }
  return sendMutation(request, response, { itemId: item?.id, comment: comment || null }, `/org/${org?.id || ''}/course/${org?.courses.find((course) => course.items.some((entry) => entry.id === request.params.itemId))?.id || ''}`);
});

app.post('/org/:id/items/:itemId/comments/:commentId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = org?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId)); const item = course?.items.find((entry) => entry.id === request.params.itemId); const comment = item?.comments?.find((entry) => entry.id === request.params.commentId);
  if (!org || !item || !comment || !isOrgAdmin(org, request.user)) return sendMutation(request, response, { error: 'Only organization admins can delete comments.' }, `/org/${org?.id || ''}`);
  item.comments = item.comments.filter((entry) => entry.id !== comment.id); persistState(); emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: comment.id });
  return sendMutation(request, response, { itemId: item.id, commentId: comment.id }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this breakout group.' }, `/org/${request.params.id}`);
  const title = String(request.body.title || '').trim(); if (!title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/breakout/${group.id}`);
  const policyError = contentPolicyError({ type: 'group-task', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  group.tasks ||= []; const task = { id: id(), title, claimedBy: null, done: false, createdBy: request.user.id }; group.tasks.push(task); persistState(); emitGroup(org, 'breakout:task-created', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/update', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this task.' }, `/org/${request.params.id}`);
  const nextTitle = String(request.body.title || '').trim() || task.title; const policyError = contentPolicyError({ type: 'group-task', text: nextTitle });
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

app.post('/org/:id/breakout/:groupId/comments', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const text = String(request.body.comment || '').trim();
  if (!group || !canAccess(org, request.user) || !text) return sendMutation(request, response, { error: 'A comment is required.' }, `/org/${request.params.id}`);
  const policyError = contentPolicyError({ type: 'group-comment', text, previousMessages: group.comments });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  group.comments ||= []; const comment = { id: id(), author: request.user.name, userId: request.user.id, text, createdAt: new Date().toISOString() }; group.comments.push(comment); persistState(); emitGroup(org, 'breakout:comment-created', { groupId: group.id, comment });
  return sendMutation(request, response, { comment }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/comments/:commentId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this comment.' }, `/org/${request.params.id}`);
  group.comments = (group.comments || []).filter((comment) => comment.id !== request.params.commentId); persistState(); emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: request.params.commentId });
  return sendMutation(request, response, { commentId: request.params.commentId }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/course/:courseId/board', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this board.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.board ||= []; const card = { id: id(), title: String(request.body.title || '').trim(), status: request.body.status || 'Open', claimedBy: null, createdBy: request.user.id };
  if (!card.title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/course/${course.id}`);
  const policyError = contentPolicyError({ type: 'board-task', text: card.title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#board`);
  course.board.push(card); persistState(); emitCourse(org, course, 'board:card-created', { card });
  return sendMutation(request, response, { card }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/board/:cardId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgAdmin(org, request.user)) return sendMutation(request, response, { error: 'Only organization admins can delete board cards.' }, `/org/${request.params.id}/course/${request.params.courseId}#board`);
  course.board = (course.board || []).filter((card) => card.id !== request.params.cardId); persistState(); emitCourse(org, course, 'board:card-deleted', { cardId: request.params.cardId });
  return sendMutation(request, response, { deleted: true, cardId: request.params.cardId }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/resources', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit resources.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.resources ||= []; const resource = { id: id(), title: String(request.body.title || '').trim(), url: String(request.body.url || '').trim(), createdBy: request.user.id };
  if (!resource.title || !resource.url) return sendMutation(request, response, { error: 'A resource title and link are required.' }, `/org/${org.id}/course/${course.id}#resources`);
  const policyError = contentPolicyError({ type: 'website', text: `${resource.title} ${resource.url}` });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#resources`);
  course.resources.push(resource); persistState(); emitCourse(org, course, 'resource:created', { resource });
  return sendMutation(request, response, { resource }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/course/:courseId/resources/:resourceId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgAdmin(org, request.user)) return sendMutation(request, response, { error: 'Only organization admins can delete resources.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  const resource = (course.resources || []).find((entry) => entry.id === request.params.resourceId);
  if (!resource) return sendMutation(request, response, { error: 'Resource not found.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  course.resources = course.resources.filter((entry) => entry.id !== resource.id); persistState(); emitCourse(org, course, 'resource:deleted', { resourceId: resource.id });
  return sendMutation(request, response, { deleted: true, resourceId: resource.id }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/settings', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  if (request.body.visibility === 'public' && request.user.age <= 13) return response.redirect(`/org/${org.id}?error=age`);
  org.visibility = request.body.visibility; org.sharePermission = request.body.sharePermission || org.sharePermission; org.shareUses = Math.max(1, Number(request.body.shareUses) || 1); persistState(); response.redirect(`/org/${org.id}/settings?saved=settings`);
});

app.post('/org/:id/members', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); const member = membership(org, request.user); const target = users.find((user) => user.username === request.body.username.trim().toLowerCase());
  if (org && member?.role === 'admin' && target && !membership(org, target)) org.members.push({ userId: target.id, role: request.body.role }); persistState(); response.redirect(`/org/${org.id}/people`);
});

app.post('/org/:id/members/:userId/remove', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user); const target = membership(org, users.find((user) => user.id === request.params.userId));
  const adminCount = org?.members.filter((entry) => entry.role === 'admin').length || 0;
  if (org && member?.role === 'admin' && target && (target.role !== 'admin' || adminCount > 1)) org.members = org.members.filter((entry) => entry.userId !== request.params.userId);
  persistState(); response.redirect(`/org/${request.params.id}/people`);
});

app.post('/org/:id/reports', requireUser, (request, response) => {
  const org = orgs.find((entry) => entry.id === request.params.id); if (org && canAccess(org, request.user)) { org.reports ||= []; org.reports.push({ id: id(), reporter: request.user.username, reason: request.body.reason, detail: String(request.body.detail || '').trim(), status: 'open', createdAt: new Date().toISOString() }); persistState(); }
  response.redirect(`/org/${org?.id || ''}?reported=1`);
});

app.post('/org/:id/content-reports', requireUser, (request, response) => {
  const org = getOrg(request); const target = findReportedComment(org, String(request.body.contentId || ''));
  if (!org || !target || !canAccess(org, request.user)) return sendMutation(request, response, { error: 'That content is no longer available.' }, `/org/${org?.id || ''}`);
  target.comment.reported = true; target.comment.reportedAt = new Date().toISOString(); target.comment.reportedBy = request.user.id; target.comment.reportReason = String(request.body.reason || 'Inappropriate content').trim();
  org.reports ||= []; org.reports.push({ id: id(), type: 'content', contentId: target.comment.id, reporter: request.user.username, reason: target.comment.reportReason, detail: String(request.body.detail || '').trim(), status: 'open', createdAt: new Date().toISOString() });
  persistState();
  if (target.item) emitCourse(org, target.course, 'item:comment-reported', { itemId: target.item.id, commentId: target.comment.id });
  if (target.group) emitGroup(org, 'breakout:comment-reported', { groupId: target.group.id, commentId: target.comment.id });
  return sendMutation(request, response, { reported: true, commentId: target.comment.id }, `/org/${org.id}`);
});

app.post('/org/:id/reports/:reportId/close', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (org && member?.role === 'admin') { const report = (org.reports || []).find((entry) => entry.id === request.params.reportId); if (report) report.status = 'closed'; persistState(); }
  response.redirect(`/org/${org?.id || ''}/settings#safety`);
});

app.post('/group/:slug/admin/comments/:commentId/remove', requireUser, (request, response) => {
  const org = getOrg(request);
  if (!org || !isOrgAdmin(org, request.user)) return response.redirect(`/group/${request.params.slug}/admin`);
  const item = org.courses.flatMap((course) => course.items).find((entry) => entry.comments?.some((comment) => comment.id === request.params.commentId));
  const group = (org.groups || []).find((entry) => entry.comments?.some((comment) => comment.id === request.params.commentId));
  if (item) {
    item.comments = item.comments.filter((comment) => comment.id !== request.params.commentId);
    const course = org.courses.find((entry) => entry.items.includes(item));
    emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: request.params.commentId });
  }
  if (group) {
    group.comments = group.comments.filter((comment) => comment.id !== request.params.commentId);
    emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: request.params.commentId });
  }
  persistState();
  return sendMutation(request, response, { removed: Boolean(item || group) }, `/group/${org.slug}/admin`);
});

app.get('/share/:code', (request, response) => {
  const org = orgs.find((entry) => entry.shareCode === request.params.code);
  if (!org || org.shareUses < 1) return response.status(404).send('This share link is no longer active.');
  const user = currentUser(request); if (!user) return response.redirect('/');
  if (!membership(org, user)) org.members.push({ userId: user.id, role: org.sharePermission }); org.shareUses -= 1; persistState(); response.redirect(`/org/${org.id}`);
});

server.listen(port, () => console.log(`StudyHub running at http://localhost:${port}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);