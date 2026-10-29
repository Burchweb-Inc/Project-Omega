require('dotenv').config() ;

const config = require('./config.js');
const creators = require('./config/creators');
const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');
const Database = require('better-sqlite3');
const packageInfo = require('./package.json');
const { marked } = require('marked');
const sanitizeHtml = require('sanitize-html');
const { Server } = require('socket.io');
const { scanContent } = require('./moderation/content-safety');
const { moderationComments, registerCommentRoutes } = require('./moderation/comments');
const { appendRemovedTextForReview, appendAppealPhrase, reviewQueuedBadWords, reviewAppealWords, addUserBadWord } = require('./moderation/bad-word-queue');
const { discoverAppleCalendar, syncAppleReminders, syncGoogleTasks } = require('./utils/task-integrations');
const { isSyncDue, isSyncSchedule, syncInterval } = require('./utils/task-sync-schedule');
const { taskSyncConfiguration } = require('./utils/task-sync-config');
const sharedGroupUserIds = require('./utils/shared-group-users');

const app = express();
const taskSyncConfig = taskSyncConfiguration(config);
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const serviceWorkerVersion = 'lockin-sw-20261004-1';
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'studyline.db');

fs.mkdirSync(dataDir, { recursive: true });
fs.chmodSync(dataDir, 0o700);

const db = new Database(dbPath);
fs.chmodSync(dbPath, 0o600);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

const userModel = require('./users/model')(db); // user table and functions to access it are imported here
const orgModel = require('./org/model')(db);
userModel.init(); // creates and migrates the user table when needed
orgModel.init();

const buildIdModel = require('./utils/build-id').initializeBuildIds(db, path.join(dataDir, '.build-id-key'));
const buildInfo = buildIdModel.createBuild({
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  appVersion: packageInfo.version,
  nodeVersion: process.version,
  platform: process.platform,
  architecture: process.arch
});

db.prepare(`CREATE TABLE IF NOT EXISTS site_feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS site_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  body_html TEXT NOT NULL,
  media_url TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'none',
  font_size TEXT NOT NULL DEFAULT 'normal',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
)`).run();
db.prepare(`CREATE TABLE IF NOT EXISTS bad_word_review_logs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  checked INTEGER NOT NULL,
  kept_words TEXT NOT NULL DEFAULT '[]',
  removed_words TEXT NOT NULL DEFAULT '[]',
  fallback TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
)`).run();
db.prepare('DELETE FROM bad_word_review_logs WHERE id NOT IN (SELECT id FROM bad_word_review_logs ORDER BY created_at DESC LIMIT 10)').run();

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
app.get('/service-worker-version.json', (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.json({ version: serviceWorkerVersion });
});
app.get('/service-worker.js', (request, response) => {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});
app.get('/media/offline/*', (request, response, next) => {
  response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});
app.get('/media/offline-manifest.json', (request, response) => {
  const offlineDir = path.join(__dirname, 'public', 'media', 'offline');
  const files = [];
  const visit = (directory, prefix) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const entryPrefix = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) visit(entryPath, entryPrefix);
      else files.push(`/media/offline${entryPrefix}`);
    }
  };
  visit(offlineDir, '');
  response.json(files);
});
app.get('/beta-tests/3drender', (request, response, next) => {
  const user = currentUser(request);
  if (!user?.settings?.betaTools || refreshModerationStatus(user) !== 'active') return response.redirect('/');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('Vary', 'Cookie');
  const file = path.join(__dirname, 'views', 'beta-tests', '3drender', 'index.html');
  if (request.acceptsEncodings('gzip') && !request.headers.range) {
    response.type('html');
    response.setHeader('Content-Encoding', 'gzip');
    response.vary('Accept-Encoding');
    pipeline(fs.createReadStream(file), zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), response, (error) => {
      if (error && !response.headersSent) next(error);
    });
    return;
  }
  return response.sendFile(file);
});
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
const snarkyTypePending = new Map();
const snarkyTypeLinkRequests = new Map();
const googleTasksOAuthStates = new Map();
const activeTaskSyncs = new Set();
const loginAttempts = new Map();
const courseReorderWindows = new Map();
const ipLocationCache = new Map();
const breakoutPresence = new Map();
const breakoutPingWindows = new Map();

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

function encryptData(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', taskEncryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

function decryptData(storedValue) {
  if (!storedValue?.startsWith('v1:')) return JSON.parse(storedValue || 'null');
  const [, encodedIv, encodedTag, encodedCiphertext] = storedValue.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', taskEncryptionKey, Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encodedCiphertext, 'base64url')), decipher.final()]).toString('utf8'));
}

async function syncUserTaskIntegrations(user, providers = ['googleTasks', 'appleReminders']) {
  if (!taskSyncConfig.enabled) return { busy: false, disabled: true, synced: [], errors: [] };
  if (activeTaskSyncs.has(user.id)) return { busy: true, synced: [], errors: [] };
  activeTaskSyncs.add(user.id);
  try {
    user.settings ||= {};
    const synced = [];
    const errors = [];
    const connectedProviders = providers.filter((provider) => user.settings[provider]?.credentials);
    if (!connectedProviders.length) return { busy: false, noConnections: true, synced, errors };

    for (const provider of connectedProviders) {
      const current = user.settings[provider];
      try {
        if (provider === 'googleTasks') {
          const result = await syncGoogleTasks({
            tasks: user.tasks || [],
            credentials: decryptData(current.credentials),
            integration: current,
            clientId: config.googleTasks.client_id,
            clientSecret: config.googleTasks.client_secret
          });
          user.settings.googleTasks = { ...result.integration, credentials: encryptData(result.credentials) };
        } else {
          const result = await syncAppleReminders({
            tasks: user.tasks || [],
            credentials: decryptData(current.credentials),
            integration: current,
            server: config.appleReminders.caldav_server
          });
          user.settings.appleReminders = { ...current, ...result };
        }
        synced.push(provider);
      } catch (error) {
        console.error(`${provider} task sync failed`, error.message);
        errors.push(`${provider === 'googleTasks' ? 'Google Tasks' : 'Apple Reminders'}: ${error.message}`);
      }
    }

    const now = Date.now();
    const taskSync = user.settings.taskSync || { schedule: 'manual' };
    const interval = syncInterval(taskSync.schedule);
    user.settings.taskSync = {
      ...taskSync,
      lastSyncAt: now,
      lastSyncError: errors.join(' ').slice(0, 500),
      nextSyncAt: interval ? now + interval : null
    };
    persistState();
    return { busy: false, noConnections: false, synced, errors };
  } finally {
    activeTaskSyncs.delete(user.id);
  }
}

function persistState() {
  userModel.persistState(users);
}

function saveOrg(org) {
  orgModel.save(org);
}

function persistOrg(org) {
  db.prepare(`INSERT INTO orgs (id, payload, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
    .run(org.id, JSON.stringify(org));
}

const users = userModel.all();
if (userModel.needsEncryptionMigration()) userModel.persistState(users);


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
  response.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
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
function snarkyTypeConfigured() {
  return Boolean(config.snarky.client_id && config.snarky.client_secret);
}
function snarkyTypeIdentity(user) {
  return user?.settings?.snarkyType || null;
}
function snarkyTypeCallbackUrl(request, state = '') {
  const origin = process.env.PUBLIC_URL || `${request.protocol}://${request.get('host')}`;
  const callback = new URL('/auth/snarkytype/callback', origin);
  if (state) callback.searchParams.set('state', state);
  return callback.toString();
}
function snarkyTypeStartUrl(request, mode, next, state = '') {
  const start = new URL('/login/superlink/create', config.snarky.url );
  start.searchParams.set('returnto', snarkyTypeCallbackUrl(request, state));
  const redirectPath = mode === 'link' ? next : `/snarkytype-${mode}?next=${encodeURIComponent(safeReturnTo(next))}`;
  start.searchParams.set('redirect', redirectPath);
  start.searchParams.set('client_id', config.snarky.client_id );
  return start.toString();
}
function rememberSnarkyTypeLink(userId, next) {
  const requestId = crypto.randomBytes(24).toString('base64url');
  snarkyTypeLinkRequests.set(requestId, { userId, next: safeReturnTo(next), expiresAt: Date.now() + 10 * 60 * 1000 });
  return requestId;
}
function takeSnarkyTypeLink(requestId) {
  const pending = snarkyTypeLinkRequests.get(requestId);
  snarkyTypeLinkRequests.delete(requestId);
  return pending && pending.expiresAt > Date.now() ? pending : null;
}
function rememberSnarkyTypePending(profile, mode, next) {
  const pendingId = crypto.randomBytes(24).toString('base64url');
  snarkyTypePending.set(pendingId, { profile, mode, next: safeReturnTo(next), expiresAt: Date.now() + 10 * 60 * 1000 });
  return pendingId;
}
function takeSnarkyTypePending(pendingId) {
  const pending = snarkyTypePending.get(pendingId);
  snarkyTypePending.delete(pendingId);
  return pending && pending.expiresAt > Date.now() ? pending : null;
}
async function verifySnarkyTypeToken(token) {
  if (!snarkyTypeConfigured() || typeof token !== 'string' || token.length > 128) return null;
  const verifyUrl = new URL('/login/superlink/verify-token', config.snarky.url || 'https://snarkytype.net');
  verifyUrl.searchParams.set('token', token);
  const response = await fetch(verifyUrl, { headers: { Authorization: `Bearer ${config.snarky.client_id}:${config.snarky.client_secret}`, Accept: 'application/json' } });
  const responseBody = await response.text();
  let payload;
  try { payload = JSON.parse(responseBody); } catch (error) { payload = null; }
  if (!response.ok) throw new Error(`SnarkyType token verification failed (${response.status}): ${payload?.error || 'unknown error'}`);
  if (!payload.ok || !payload.user?.id || !payload.user?.username) throw new Error('SnarkyType returned an invalid profile.');
  return { id: String(payload.user.id), username: String(payload.user.username).trim().toLowerCase(), displayName: String(payload.user.displayName || payload.user.username).trim() };
}
const server = http.createServer(app);
const io = new Server(server);
const badWordReviewIntervalMs = Number(process.env.BAD_WORD_REVIEW_INTERVAL_MS || (Number(process.env.BAD_WORD_REVIEW_INTERVAL_MINUTES || '10') * 60000));
const badWordReviewInterval = Number.isFinite(badWordReviewIntervalMs) && badWordReviewIntervalMs > 0 ? badWordReviewIntervalMs : 10 * 60 * 1000;
const recordBadWordReview = (trigger, result) => {
  if (trigger !== 'manual' && !result?.checked && !result?.fallback) return;
  db.prepare('INSERT INTO bad_word_review_logs (id, trigger, checked, kept_words, removed_words, fallback, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id(), trigger, result.checked || 0, JSON.stringify(result.kept || []), JSON.stringify(result.removed || []), result.fallback || '', new Date().toISOString()
  );
  db.prepare('DELETE FROM bad_word_review_logs WHERE id NOT IN (SELECT id FROM bad_word_review_logs ORDER BY created_at DESC LIMIT 10)').run();
};
const reviewQueuedBadWordsNow = async (trigger = 'scheduled') => {
  try {
    const result = await reviewQueuedBadWords();
    recordBadWordReview(trigger, result);
    return result;
  } catch (error) {
    console.error('bad-word review failed', error);
    recordBadWordReview(trigger, { checked: 0, fallback: error.message || 'review-failed' });
    return { checked: 0, kept: [], removed: [], fallback: 'review-failed' };
  }
};
const appealWordReviewIntervalMs = Number(process.env.APPEAL_WORD_REVIEW_INTERVAL_MS || (Number(process.env.APPEAL_WORD_REVIEW_INTERVAL_MINUTES || '20') * 60000));
const appealWordReviewInterval = Number.isFinite(appealWordReviewIntervalMs) && appealWordReviewIntervalMs > 0 ? appealWordReviewIntervalMs : 20 * 60 * 1000;
const reviewAppealWordsNow = () => {
  reviewAppealWords().catch((error) => console.error('appeal-word review failed', error));
};
reviewQueuedBadWordsNow();
setInterval(reviewQueuedBadWordsNow, badWordReviewInterval);
reviewAppealWordsNow();
setInterval(reviewAppealWordsNow, appealWordReviewInterval);

function liveRequest(request) { return request.is('application/json') || request.get('X-Live-Request') === 'true'; }
function sendMutation(request, response, payload, fallback) {
  if (liveRequest(request)) return response.status(payload.error ? 400 : 200).json(payload);
  return response.redirect(fallback);
}
function courseRoom(orgId, courseId) { return `course:${orgId}:${courseId}`; }
function courseAdminRoom(orgId, courseId) { return `course-admin:${orgId}:${courseId}`; }
function orgRoom(orgId) { return `org:${orgId}`; }
function groupRoom(orgId) { return `group:${orgId}`; }
function todoRoom(userId) { return `todo:${userId}`; }
function notificationRoom(userId) { return `notifications:${userId}`; }
function emitCourse(org, course, event, payload) { io.to(courseRoom(org.id, course.id)).emit(event, payload); }
function emitOrg(org, event, payload) { io.to(orgRoom(org.id)).emit(event, payload); }
function emitGroup(org, event, payload) { io.to(groupRoom(org.id)).emit(event, payload); }
function emitTodo(userId, event, payload) { io.to(todoRoom(userId)).emit(event, payload); }
function emitNotification(userId, notification) { io.to(notificationRoom(userId)).emit('notification:added', notification); }
function groupPresencePayload(org, groupId) {
  const group = getBreakoutGroup(org, groupId);
  if (!group) return [];
  return group.members.map((userId) => {
    const records = [...breakoutPresence.values()].filter((record) => record.userId === userId && record.orgId === org.id && Date.now() - record.lastSeen <= 60000);
    const active = records.sort((left, right) => right.lastSeen - left.lastSeen)[0];
    return active ? { userId, status: active.groupId === groupId ? 'same-page' : 'inactive', lastSeen: active.lastSeen } : null;
  }).filter(Boolean);
}
function emitGroupPresence(org, groupId) { if (groupId) io.to(groupRoom(org.id)).emit('breakout:presence', { groupId, members: groupPresencePayload(org, groupId) }); }
function emitOrgPresence(org) { (org.groups || []).forEach((group) => emitGroupPresence(org, group.id)); }
function isUserOnBreakoutPage(orgId, groupId, userId) {
  return [...breakoutPresence.values()].some((record) => record.orgId === orgId && record.groupId === groupId && record.userId === userId && Date.now() - record.lastSeen <= 60000);
}
function emitCourseAdmins(org, course, event, payload) { io.to(courseAdminRoom(org.id, course.id)).emit(event, payload); }
function dueImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`); const days = Math.round((dueDate - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}
function fallbackIpLocation() { return { timezone: 'UTC', locale: 'en-US' }; }
function courseDateLocale(countryCode) { return countryCode === 'US' ? 'en-US' : 'en-GB'; }
async function ipLocation(ip) {
  const normalizedIp = String(ip || '').replace(/^::ffff:/, '');
  if (!normalizedIp || normalizedIp === '::1' || normalizedIp === '127.0.0.1' || normalizedIp.startsWith('10.') || normalizedIp.startsWith('192.168.') || normalizedIp.startsWith('172.16.')) return fallbackIpLocation();
  if (ipLocationCache.has(normalizedIp)) return ipLocationCache.get(normalizedIp);
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 1200);
    const result = await fetch(`https://ipapi.co/${encodeURIComponent(normalizedIp)}/json/`, { signal: controller.signal, headers: { Accept: 'application/json' } }); clearTimeout(timeout);
    const data = await result.json(); const location = data.timezone ? { timezone: data.timezone, locale: courseDateLocale(data.country_code) } : fallbackIpLocation();
    ipLocationCache.set(normalizedIp, location); return location;
  } catch (error) { return fallbackIpLocation(); }
}
function formatCourseDate(due, timezone = 'UTC', locale = 'en-US') {
  if (!due || due === 'No date') return 'No date';
  const date = new Date(`${due}T12:00:00Z`); if (Number.isNaN(date.getTime())) return due;
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function formatTaskDate(due, timezone = 'UTC', locale = 'en-US') { return formatCourseDate(due, timezone, locale); }
async function userDateLocation(user, request) {
  const settings = user?.settings || {};
  if (settings.timezone && settings.dateFormat && settings.dateFormat !== 'auto') return { timezone: settings.timezone, locale: settings.dateFormat === 'mdy' ? 'en-US' : settings.dateFormat === 'ymd' ? 'sv-SE' : 'en-GB' };
  const location = await ipLocation(request.ip);
  if (settings.timezone) location.timezone = settings.timezone;
  if (settings.dateFormat && settings.dateFormat !== 'auto') location.locale = settings.dateFormat === 'mdy' ? 'en-US' : settings.dateFormat === 'ymd' ? 'sv-SE' : 'en-GB';
  return location;
}
function normalizeLink(link) { const url = String(typeof link === 'string' ? link : link?.url || ''); let domain = url; try { domain = new URL(url).hostname; } catch (error) {} const fallbackImage = domain && domain !== url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : ''; return typeof link === 'string' ? { url, title: domain, description: '', image: fallbackImage, domain } : { url, title: link.title || domain, description: link.description || '', image: link.image || fallbackImage, domain: link.domain || domain }; }
function normalizeLinks(links) { return (Array.isArray(links) ? links : []).filter((link) => link?.url).map(normalizeLink); }
function submittedLinkUrls(value) { return [...new Set(String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [])].map((entry) => entry.replace(/[),.;!?]+$/, '')).filter((entry) => { try { const url = new URL(entry); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch (error) { return false; } }).slice(0, 5); }
async function fetchLinkPreviews(value) {
  const links = submittedLinkUrls(value);
  return Promise.all(links.map(async (link) => {
    const fallback = normalizeLink(link);
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000);
      const result = await fetch(link, { signal: controller.signal, redirect: 'follow', headers: { Accept: 'text/html,application/xhtml+xml' } });
      const html = (await result.text()).slice(0, 500000);
      const readMeta = (...names) => {
        for (const name of names) {
          const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'));
          if (match?.[1]) return match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
        }
        return '';
      };
      const resolveUrl = (candidate) => { try { return candidate ? new URL(candidate, result.url || link).href : ''; } catch (error) { return ''; } };
      const title = readMeta('og:title', 'twitter:title') || (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim() || fallback.title;
      const description = readMeta('og:description', 'twitter:description', 'description');
      const image = resolveUrl(readMeta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src', 'image_src')) || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(link).hostname)}&sz=128`;
      clearTimeout(timeout);
      return { url: link, title, description, image, domain: new URL(link).hostname, status: result.status };
    } catch (error) { return fallback; }
  }));
}
function normalizeTask(task, index = 0) { return { ...task, details: task.details || '', links: normalizeLinks(task.links), position: Number.isFinite(Number(task.position)) ? Number(task.position) : index, linked: task.sourceId ? task.linked !== false : false, importance: dueImportance(task.due) }; }
function normalizeUserTasks(user) { if (!user) return; user.tasks = (user.tasks || []).map(normalizeTask); }
function pushNotificationSettings(user) {
  return { enabled: false, breakoutComments: true, breakoutTasks: true, mentions: true, announcements: true, ...(user?.settings?.pushNotifications || {}) };
}
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
function safeReturnTo(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/dashboard';
}
function authRedirect(path, error, next) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (next) params.set('next', next);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ''}`;
}
function requireUser(request, response, next) {
  request.user = currentUser(request);
  if (!request.user) return response.redirect(authRedirect('/login', null, request.originalUrl));
  if (refreshModerationStatus(request.user) !== 'active') return response.status(403).render('index', { page: 'restricted', view: 'restricted', user: request.user, users, orgs: orgModel.all(), canEdit, selectedOrg: null, error: null });
  next();
}
function membership(org, user) { return org && user ? org.members.find((member) => member.userId === user.id) : null; }
function pendingInvite(org, user) { return org && user ? (org.pendingInvites || []).find((invite) => invite.userId === user.id) : null; }
function canonicalUrl(request) { return `${process.env.PUBLIC_URL || 'https://lockedin.burchweb.com'}${request.path}`; }
function escapeHtmlServer(value) { return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function trimmedLinkLabel(url) { try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`; } catch (error) { return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[?#]/)[0].replace(/\/$/, ''); } }
function renderLinkedText(text, links = []) {
  const value = String(text || ''); const pattern = /https?:\/\/[^\s<>'"]+/gi; let output = ''; let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const rawUrl = match[0]; const url = rawUrl.replace(/[),.;!?]+$/, ''); const link = links.find((entry) => entry.url === url) || { url, title: trimmedLinkLabel(url), description: '', image: '' };
    output += escapeHtmlServer(value.slice(cursor, match.index));
    output += `<a class="inline-link-preview" href="${escapeHtmlServer(url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtmlServer(trimmedLinkLabel(url))}</span><span class="link-hover-card">${link.image ? `<img src="${escapeHtmlServer(link.image)}" alt="">` : '<span class="link-snapshot-placeholder"></span>'}<span class="link-hover-copy"><strong>${escapeHtmlServer(link.title || trimmedLinkLabel(url))}</strong><small>${escapeHtmlServer(link.description || '')}</small><em>${escapeHtmlServer(url)}</em></span></span></a>`;
    cursor = match.index + rawUrl.length;
  }
  return output + escapeHtmlServer(value.slice(cursor));
}
function render(request, response, page, extra = {}) { normalizeUserTasks(request.user); if (request.user) request.user.tasks.sort((left, right) => left.position - right.position); response.render('index', { page, view: page, user: request.user, users, orgs: orgModel.all(), canEdit, canManageItem, selectedOrg: null, notifications: request.user?.notifications || [], error: request.query?.error, canonicalUrl: canonicalUrl(request), renderLinkedText, buildInfo, ...extra }); }
function renderPublicPage(request, response, page, extra = {}) { response.render('index', { page, view: page, user: null, users, orgs: orgModel.all(), canEdit, selectedOrg: null, notifications: [], error: null, canonicalUrl: canonicalUrl(request), buildInfo, ...extra }); }
function getOrg(request) { return orgModel.for({ id: request.params.id, slug: request.params.slug }); }
function getCourse(org, courseId) { return org?.courses.find((course) => course.id === courseId); }
function isSiteAdmin(user) { return Boolean(user?.isSiteAdmin); }
function isOrgModerator(org, user) { return isSiteAdmin(user) || ['admin', 'moderator'].includes(membership(org, user)?.role); }
function canEdit(member) { return member?.role === 'admin' || member?.role === 'editor' || member?.role === 'moderator'; }
function isOrgAdmin(org, user) { return isSiteAdmin(user) || membership(org, user)?.role === 'admin'; }
function getBreakoutGroup(org, groupId) { return org?.groups?.find((group) => group.id === groupId); }
function breakoutTaskSlug(item) { return `${slug(item.title)}-${item.id.slice(-8)}`; }
function getBreakoutTask(org, courseId, taskSlug) {
  const course = getCourse(org, courseId);
  return course?.items.find((item) => item.type === 'Project' && breakoutTaskSlug(item) === taskSlug);
}
function breakoutGroupsForTask(org, itemId) { return (org?.groups || []).filter((group) => group.itemId === itemId); }
function breakoutGroupsUrl(org, course, item) { return `/org/${org.id}/course/${course.id}/task/${breakoutTaskSlug(item)}/breakout-groups`; }
function canManageBreakoutGroup(org, group, user) { return Boolean(group && user && (isOrgModerator(org, user) || group.createdBy === user.id || group.roles?.[user.id] === 'Organizer' || group.roles?.[user.id] === 'Admin')); }
function canManageItem(org, item, user) { const group = org?.groups?.find((entry) => entry.itemId === item?.id); return Boolean(item && user && (item.createdBy === user.id || isOrgAdmin(org, user) || canManageBreakoutGroup(org, group, user))); }
function canAccess(org, user) { return Boolean(org && user && (isSiteAdmin(user) || (!org.suspendedAt && (org.visibility === 'public' || membership(org, user))))); }
function requireSiteAdmin(request, response, next) { if (!isSiteAdmin(request.user)) return response.status(403).send('Site admin access required.'); next(); }
function siteFeedback() { return db.prepare('SELECT * FROM site_feedback ORDER BY created_at DESC').all(); }
function siteAnnouncements() { return db.prepare('SELECT * FROM site_announcements ORDER BY created_at DESC').all(); }
function siteAdminPageData(request) {
  return {
    siteAdminTab: ['admins', 'users', 'groups', 'moderation', 'feedback', 'announcements', 'cache', 'developers'].includes(request.query.tab) ? request.query.tab : 'admins',
    siteAdminComments: globalModerationComments().filter((comment) => !comment.reviewedAt),
    siteAdminReports: globalReports().filter((report) => report.status === 'open'),
    feedback: siteFeedback(),
    siteAdminUsers: users.filter((user) => user.isSiteAdmin),
    managedUsers: users.slice().sort((left, right) => left.username.localeCompare(right.username)),
    announcements: siteAnnouncements(),
    badWordReviewLogs: db.prepare('SELECT * FROM bad_word_review_logs ORDER BY created_at DESC LIMIT 20').all().map((entry) => ({
      ...entry,
      keptWords: JSON.parse(entry.kept_words || '[]'),
      removedWords: JSON.parse(entry.removed_words || '[]')
    })),
    buildInfo,
    buildIdInput: '',
    buildDecodeResult: null,
    buildDecodeError: ''
  };
}
function renderAnnouncementMarkdown(markdown) {
  const rendered = marked.parse(String(markdown || ''), { breaks: true, gfm: true });
  return sanitizeHtml(rendered, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'code', 'pre', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'target', 'rel'], img: ['src', 'alt', 'title', 'width', 'height'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noreferrer noopener', target: '_blank' }) }
  });
}
function announcementPayload(announcement) {
  return { id: announcement.id, type: 'announcement', title: announcement.title, message: 'A new announcement is waiting for you.', html: announcement.body_html, mediaUrl: announcement.media_url, mediaType: announcement.media_type, fontSize: announcement.font_size, createdAt: announcement.created_at, read: false };
}
function globalModerationComments() { return orgModel.all().flatMap((org) => moderationComments(org).map((comment) => ({ ...comment, orgId: org.id, orgName: org.name }))); }
function globalReports() { return orgModel.all().flatMap((org) => (org.reports || []).map((report) => ({ ...report, orgId: org.id, orgName: org.name }))); }
async function contentPolicyError(input) {
  const result = scanContent(input);
  const blockingCategories = new Set(['profanity', 'heavy-profanity', 'insult', 'harassment', 'targeted-insult', 'targeted-profanity', 'targeted-abuse', 'bad-word-list', 'content-checker']);
  const hasBlockingFinding = result.findings?.some((finding) => blockingCategories.has(finding.category));
  return result.badScore >= 20 || hasBlockingFinding ? 'This content violates our content policy. Edit it, then try again.' : null;
}

function renderOrgPage(request, response, page, extra = {}) {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!canAccess(org, request.user)) return response.redirect('/dashboard');
  render(request, response, page, { selectedOrg: org, member, ...extra });
}
function renderSuspendedGroup(request, response, org) {
  return response.status(423).render('index', { page: 'suspended-group', view: 'suspended-group', user: request.user, users, orgs: orgModel.all(), canEdit, selectedOrg: org, notifications: request.user?.notifications || [], error: null });
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
  socket.on('org:join', ({ orgId } = {}) => {
    const org = orgModel.get(orgId);
    if (org && canAccess(org, socket.user)) socket.join(orgRoom(org.id));
  });
  socket.on('course:join', ({ orgId, courseId } = {}) => {
    const org = orgModel.get(orgId); const course = getCourse(org, courseId);
    if (canAccess(org, socket.user) && course) { socket.join(courseRoom(org.id, course.id)); if (isOrgAdmin(org, socket.user)) socket.join(courseAdminRoom(org.id, course.id)); }
  });
  socket.on('group:join', ({ orgId } = {}) => {
    const org = orgModel.get(orgId);
    if (canAccess(org, socket.user)) { socket.join(groupRoom(org.id)); breakoutPresence.set(socket.id, { userId: socket.user.id, orgId, groupId: null, lastSeen: Date.now() }); emitOrgPresence(org); }
  });
  socket.on('breakout:presence', ({ orgId, groupId } = {}) => {
    const org = orgModel.get(orgId); const group = getBreakoutGroup(org, groupId);
    if (!org || !group || !canAccess(org, socket.user) || !group.members.includes(socket.user.id)) return;
    breakoutPresence.set(socket.id, { userId: socket.user.id, orgId, groupId, lastSeen: Date.now() });
    socket.emit('breakout:presence', { groupId, members: groupPresencePayload(org, groupId) });
    emitGroupPresence(org, groupId);
  });
  socket.on('breakout:presence-heartbeat', () => {
    const record = breakoutPresence.get(socket.id); if (!record) return;
    record.lastSeen = Date.now();
    const org = orgModel.get(record.orgId); if (org) record.groupId ? emitGroupPresence(org, record.groupId) : emitOrgPresence(org);
  });
  socket.on('disconnect', () => {
    const record = breakoutPresence.get(socket.id); breakoutPresence.delete(socket.id);
    const org = record && orgModel.get(record.orgId); if (org) record.groupId ? emitGroupPresence(org, record.groupId) : emitOrgPresence(org);
  });
});

registerCommentRoutes({ app, users, id, saveOrg, emitCourse, emitGroup, emitOrg, sendMutation, requireUser, getOrg, canAccess, isOrgAdmin, isOrgModerator, canManageBreakoutGroup, contentPolicyError, addNotification, appendRemovedTextForReview, appendAppealPhrase });

app.get('/', (request, response) => {
  request.user = currentUser(request);
  if (request.user) return response.redirect('/dashboard');
  render(request, response, 'landing', { error: request.query.error });
});

app.get('/healthz', (request, response) => response.status(200).json({ status: 'ok' }));

app.get(['/signup', '/login'], (request, response) => {
  request.user = currentUser(request);
  if (request.user) return response.redirect('/dashboard');
  const page = request.path.slice(1) === 'login' ? 'login' : 'signup';
  response.render('index', { page, view: page, user: null, users, orgs: orgModel.all(), canEdit, selectedOrg: null, notifications: [], error: request.query.error, next: safeReturnTo(request.query.next), snarkyTypeConfigured: snarkyTypeConfigured(), snarkyTypePending: Boolean(request.query.snarky) });
});

app.get('/auth/snarkytype', (request, response) => {
  if (!snarkyTypeConfigured()) return response.redirect(authRedirect(request.query.mode === 'signup' ? '/signup' : '/login', 'snarkytype', safeReturnTo(request.query.next)));
  const mode = ['signup', 'link'].includes(request.query.mode) ? request.query.mode : 'login';
  const next = safeReturnTo(request.query.next);
  if (mode === 'link') {
    const user = currentUser(request);
    if (!user) return response.redirect(authRedirect('/login', null, '/settings'));
    const requestId = rememberSnarkyTypeLink(user.id, next);
    return response.redirect(snarkyTypeStartUrl(request, 'link', `/snarkytype-link/${requestId}`, requestId));
  }
  response.redirect(snarkyTypeStartUrl(request, mode, next));
});

app.get('/auth/snarkytype/callback', async (request, response) => {
  try {
    const profile = await verifySnarkyTypeToken(request.query.superlink_token);
    const state = String(request.query.state || '');
    const stateLinkRequest = takeSnarkyTypeLink(state);
    const redirectValue = String(request.query.redirect || '');
    const redirectPath = redirectValue.split('?', 1)[0];
    const mode = stateLinkRequest || redirectPath.startsWith('/snarkytype-link/') ? 'link' : redirectPath === '/snarkytype-signup' ? 'signup' : 'login';
    const redirectQuery = new URLSearchParams(redirectValue.split('?', 2)[1] || '');
    const next = safeReturnTo(redirectQuery.get('next') || '/dashboard');
    const linkedUser = users.find((user) => snarkyTypeIdentity(user)?.id === profile.id);
    const linkId = mode === 'link' && redirectPath.startsWith('/snarkytype-link/') ? redirectPath.slice('/snarkytype-link/'.length) : '';
    const linkRequest = stateLinkRequest || takeSnarkyTypeLink(linkId);
    const linkUser = linkRequest && users.find((user) => user.id === linkRequest.userId);
    const linkNext = linkRequest?.next || next;
    const activeUser = currentUser(request);
    if (mode === 'link' && linkUser) {
      if (linkedUser && linkedUser.id !== linkUser.id) return response.redirect('/settings?error=snarkytype-linked');
      linkUser.settings = { ...(linkUser.settings || {}), snarkyType: profile };
      persistState();
      setSession(response, linkUser.id);
      return response.redirect(linkNext || '/settings');
    }
    if (linkedUser) {
      setSession(response, linkedUser.id);
      return response.redirect(next);
    }
    const pendingId = rememberSnarkyTypePending(profile, mode, next);
    response.setHeader('Set-Cookie', `snarky_pending=${pendingId}; HttpOnly; Path=/; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return response.redirect(`/signup?snarky=1&next=${encodeURIComponent(next)}`);
  } catch (error) {
    console.error('SnarkyType authentication failed', error.message);
    const fallback = String(request.query.redirect || '').split('?', 1)[0] === '/snarkytype-signup' ? '/signup' : '/login';
    return response.redirect(`${fallback}?error=snarkytype`);
  }
});

app.get('/about', (request, response) => renderPublicPage(request, response, 'about', { creators }));
app.get('/support', (request, response) => renderPublicPage(request, response, 'support'));
app.get('/privacy', (request, response) => renderPublicPage(request, response, 'privacy'));
app.get('/terms', (request, response) => renderPublicPage(request, response, 'terms'));
app.get('/understand', (request, response) => renderPublicPage(request, response, 'understand'));
app.get('/beta', (request, response) => renderPublicPage(request, response, 'beta'));
app.get('/dev/lockui', (request, response) => renderPublicPage(request, response, 'lockui'));

app.post('/signup', (request, response) => {
  const { name, username, password, age } = request.body;
  const next = safeReturnTo(request.body.next);
  if (!name || !username || !password || password.length < 8 || !age || Number(age) < 13 || users.some((user) => user.username === username.trim().toLowerCase())) return response.redirect(authRedirect('/signup', 'signup', next));
  const normalizedUsername = username.trim().toLowerCase();
  const user = { id: id(), name: name.trim(), username: normalizedUsername, age: Number(age), passwordHash: passwordHash(password), isSiteAdmin: normalizedUsername === 'admin', tasks: [], settings: {} };
  users.push(user); persistState(); setSession(response, user.id); response.redirect(next);
});

app.post('/signup/snarkytype', (request, response) => {
  const pending = takeSnarkyTypePending(parseCookies(request).snarky_pending);
  const name = String(request.body.name || '').trim();
  const username = String(request.body.username || '').trim().toLowerCase();
  const age = Number(request.body.age);
  if (!pending || !name || !/^[a-z0-9_]{3,24}$/.test(username) || !Number.isInteger(age) || age < 13 || users.some((user) => user.username === username)) return response.redirect('/signup?error=signup&snarky=1');
  const user = { id: id(), name, username, age, passwordHash: passwordHash(crypto.randomBytes(32).toString('base64url')), isSiteAdmin: false, tasks: [], settings: { snarkyType: pending.profile, passwordSet: false } };
  users.push(user); persistState(); setSession(response, user.id);
  response.append('Set-Cookie', 'snarky_pending=; HttpOnly; Max-Age=0; Path=/; SameSite=Lax');
  response.redirect(pending.next);
});

app.post('/login', (request, response) => {
  const next = safeReturnTo(request.body.next);
  if (!loginAllowed(request)) return response.redirect(authRedirect('/login', 'locked', next));
  const username = String(request.body.username || '').trim().toLowerCase();
  const user = users.find((candidate) => candidate.username === username);
  if (!user || !passwordMatches(request.body.password || '', user.passwordHash)) { recordLoginFailure(request); return response.redirect(authRedirect('/login', 'login', next)); }
  loginAttempts.delete(request.ip || 'local');
  setSession(response, user.id); response.redirect(next);
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

app.get('/dashboard', requireUser, (request, response) => {
  const dashboardTab = ['overview', 'groups', 'moderate'].includes(request.query.tab) ? request.query.tab : 'overview';
  const orgs = orgModel.all();
  const dashboardGroups = request.user.isSiteAdmin ? orgs.slice().sort((left, right) => left.name.localeCompare(right.name)) : orgs.filter((org) => membership(org, request.user)).sort((left, right) => left.name.localeCompare(right.name));
  const dashboardModeration = (request.user.isSiteAdmin ? orgs : dashboardGroups).flatMap((org) => moderationComments(org).filter((comment) => !comment.reviewedAt).map((comment) => ({ ...comment, orgId: org.id, orgName: org.name })));
  render(request, response, 'dashboard', {
    feedItems: orgModel.feedFor(request.user.id).slice(0, 8),
    dashboardTab,
    dashboardGroups,
    dashboardModeration
  });
});
app.get('/site-admin', requireUser, requireSiteAdmin, (request, response) => render(request, response, 'site-admin', siteAdminPageData(request)));

app.post('/site-admin/build-id/decrypt', requireUser, requireSiteAdmin, (request, response) => {
  const buildIdInput = String(request.body.buildId || '').trim();
  const buildDecodeResult = buildIdModel.decode(buildIdInput);
  return render(request, response, 'site-admin', {
    ...siteAdminPageData(request),
    siteAdminTab: 'developers',
    buildIdInput,
    buildDecodeResult,
    buildDecodeError: buildDecodeResult ? '' : 'No recorded build matches that ID. Check that all 15 digits are correct.'
  });
});

app.post('/site-admin/groups/:id/suspension', requireUser, requireSiteAdmin, (request, response) => {
  const org = getOrg(request); const action = request.body.action;
  if (!org || !['suspend', 'unsuspend'].includes(action)) return sendMutation(request, response, { error: 'That group action is not available.' }, '/site-admin?tab=groups');
  org.suspendedAt = action === 'suspend' ? (org.suspendedAt || new Date().toISOString()) : '';
  saveOrg(org);
  return sendMutation(request, response, { successMessage: action === 'suspend' ? `${org.name} is suspended indefinitely.` : `${org.name} is active again.` }, '/site-admin?tab=groups');
});

app.post('/site-admin/groups/:id/delete', requireUser, requireSiteAdmin, (request, response) => {
  const org = getOrg(request);
  if (!org || !org.suspendedAt) return sendMutation(request, response, { error: 'Only suspended groups can be deleted from site administration.' }, '/site-admin?tab=groups');
  orgModel.delete(org.id);
  return sendMutation(request, response, { deletedGroup: request.params.id, successMessage: `${org.name} was deleted.` }, '/site-admin?tab=groups');
});
app.use(['/org/:id', '/group/:slug'], (request, response, next) => {
  request.user = currentUser(request);
  const org = getOrg(request);
  if (request.user && org?.suspendedAt && !isSiteAdmin(request.user)) return renderSuspendedGroup(request, response, org);
  next();
});
app.get('/api/users/search', requireUser, (request, response) => {
  const query = String(request.query.q || '').trim().toLowerCase();
  if (query.length < 1) return response.json([]);
  const scopeGroupId = String(request.query.groupId || '');
  const visibleUserIds = sharedGroupUserIds(orgModel.all(), request.user, scopeGroupId);
  response.json(users.filter((candidate) => visibleUserIds.has(candidate.id) && (candidate.username.includes(query) || candidate.name.toLowerCase().includes(query))).slice(0, 8).map((candidate) => ({ id: candidate.id, name: candidate.name, username: candidate.username })));
});
app.post('/site-admin/users', requireUser, requireSiteAdmin, (request, response) => {
  const username = String(request.body.username || '').trim().toLowerCase();
  const target = users.find((candidate) => candidate.username === username);
  if (target) { target.isSiteAdmin = true; persistState(); }
  return sendMutation(request, response, { successMessage: target ? `@${username} is now a site admin.` : 'User not found.' }, '/site-admin?tab=admins');
});
app.post('/site-admin/users/:id/update', requireUser, requireSiteAdmin, (request, response) => {
  const target = users.find((candidate) => candidate.id === request.params.id);
  if (!target) return sendMutation(request, response, { error: 'User not found.' }, '/site-admin?tab=users');

  const name = String(request.body.name || '').trim();
  const username = String(request.body.username || '').trim().toLowerCase();
  const age = Number(request.body.age);
  const newPassword = String(request.body.newPassword || '');
  const isSiteAdminAccount = request.body.isSiteAdmin === 'on';
  const moderationStatus = String(request.body.moderationStatus || '');
  const moderationMessage = String(request.body.moderationMessage || '').trim();
  const moderationUntilInput = String(request.body.moderationUntil || '').trim();
  if (!name || name.length > 80 || !/^[a-z0-9_]{3,24}$/.test(username) || !Number.isInteger(age) || age < 13 || age > 120) {
    return sendMutation(request, response, { error: 'Enter a name, username (3-24 letters, numbers, or underscores), and age from 13 to 120.' }, '/site-admin?tab=users');
  }
  if (users.some((candidate) => candidate.id !== target.id && candidate.username === username)) {
    return sendMutation(request, response, { error: `@${username} is already in use.` }, '/site-admin?tab=users');
  }
  if (newPassword && newPassword.length < 8) {
    return sendMutation(request, response, { error: 'New passwords must have at least 8 characters.' }, '/site-admin?tab=users');
  }
  if (!['active', 'suspended', 'banned'].includes(moderationStatus) || moderationMessage.length > 500) {
    return sendMutation(request, response, { error: 'Choose a valid account status and a message of at most 500 characters.' }, '/site-admin?tab=users');
  }
  if (moderationUntilInput && (moderationStatus !== 'suspended' || !Number.isFinite(Date.parse(moderationUntilInput)))) {
    return sendMutation(request, response, { error: 'Enter a valid end time for a suspended account.' }, '/site-admin?tab=users');
  }
  if (target.isSiteAdmin && !isSiteAdminAccount && users.filter(isSiteAdmin).length <= 1) {
    return sendMutation(request, response, { error: 'The last site admin cannot be removed.' }, '/site-admin?tab=users');
  }

  const updatedUser = {
    ...target,
    name,
    username,
    age,
    isSiteAdmin: isSiteAdminAccount,
    moderationStatus,
    moderationMessage: moderationStatus === 'active' ? '' : moderationMessage,
    moderationUntil: moderationStatus === 'suspended' && moderationUntilInput ? new Date(moderationUntilInput).toISOString() : '',
    settings: { ...(target.settings || {}), betaTools: request.body.betaTools === 'on' }
  };
  if (newPassword) {
    updatedUser.passwordHash = passwordHash(newPassword);
    updatedUser.settings.passwordSet = true;
  }
  if (!userModel.updateUser(updatedUser)) {
    return sendMutation(request, response, { error: 'The user could not be updated.' }, '/site-admin?tab=users');
  }
  Object.assign(target, updatedUser);
  const selfDemoted = target.id === request.user.id && !isSiteAdminAccount;
  const redirectTo = selfDemoted ? '/dashboard' : '/site-admin?tab=users';
  if (newPassword || moderationStatus !== 'active') {
    const currentToken = parseCookies(request).session;
    for (const [token, userId] of sessions) {
      if (userId === target.id && (moderationStatus !== 'active' || token !== currentToken)) sessions.delete(token);
    }
  }
  return sendMutation(request, response, { successMessage: `@${target.username} was updated.`, redirectTo }, redirectTo);
});
app.post('/site-admin/users/:id/delete', requireUser, requireSiteAdmin, (request, response) => {
  const targetIndex = users.findIndex((candidate) => candidate.id === request.params.id);
  const target = users[targetIndex];
  if (!target) return sendMutation(request, response, { error: 'User not found.' }, '/site-admin?tab=users');
  if (target.id === request.user.id) return sendMutation(request, response, { error: 'You cannot delete the account you are currently using.' }, '/site-admin?tab=users');
  if (target.isSiteAdmin && users.filter(isSiteAdmin).length <= 1) {
    return sendMutation(request, response, { error: 'The last site admin cannot be deleted.' }, '/site-admin?tab=users');
  }

  const changedOrgs = [];
  orgs.forEach((org) => {
    const previous = JSON.stringify(org);
    org.members = (org.members || []).filter((member) => member.userId !== target.id);
    org.pendingInvites = (org.pendingInvites || []).filter((invite) => invite.userId !== target.id);
    org.groups = (org.groups || []).filter((group) => group.createdBy !== target.id)
      .map((group) => ({ ...group, members: (group.members || []).filter((memberId) => memberId !== target.id) }));
    if (JSON.stringify(org) !== previous) changedOrgs.push(org);
  });
  const deleted = db.transaction(() => {
    if (!userModel.deleteUser(target.id)) return false;
    changedOrgs.forEach(persistOrg);
    return true;
  })();
  if (!deleted) {
    return sendMutation(request, response, { error: 'The user could not be deleted.' }, '/site-admin?tab=users');
  }
  for (const [token, userId] of sessions) if (userId === target.id) sessions.delete(token);
  users.splice(targetIndex, 1);
  return sendMutation(request, response, { successMessage: `@${target.username} was deleted.`, redirectTo: '/site-admin?tab=users' }, '/site-admin?tab=users');
});
app.post('/site-admin/cache', requireUser, requireSiteAdmin, (request, response) => {
  const username = String(request.body.username || '').trim().toLowerCase();
  const target = username ? users.find((user) => user.username === username) : null;
  if (username && !target) return sendMutation(request, response, { error: 'User not found.' }, '/site-admin?tab=cache');
  const payload = { reason: 'A site admin requested a cache purge.' };
  if (target) {
    io.to(notificationRoom(target.id)).emit('cache:nuke', payload);
    const connected = io.sockets.adapter.rooms.get(notificationRoom(target.id))?.size || 0;
    return sendMutation(request, response, { successMessage: `Cache purge sent to @${target.username} (${connected} connected device${connected === 1 ? '' : 's'}).` }, '/site-admin?tab=cache');
  }
  io.emit('cache:nuke', payload);
  return sendMutation(request, response, { successMessage: `Cache purge sent to all ${users.length} users.` }, '/site-admin?tab=cache');
});
app.post('/site-admin/feedback/:id/status', requireUser, requireSiteAdmin, (request, response) => {
  db.prepare('UPDATE site_feedback SET status = ? WHERE id = ?').run(request.body.status === 'closed' ? 'closed' : 'open', request.params.id);
  return sendMutation(request, response, { successMessage: 'Feedback updated.' }, '/site-admin?tab=feedback');
});
app.post('/site-admin/force-ai-update', requireUser, requireSiteAdmin, (request, response) => {
  return reviewQueuedBadWordsNow('manual').then((result) => sendMutation(request, response, {
    successMessage: result.checked ? `AI review complete: checked ${result.checked}, kept ${result.kept?.length || 0}, discarded ${result.removed?.length || 0}.` : 'The AI update queue is empty.'
  }, '/site-admin?tab=moderation'));
});
app.post('/site-admin/bad-words', requireUser, requireSiteAdmin, (request, response) => {
  const result = addUserBadWord(request.body.word);
  const payload = result.added
    ? { successMessage: `Added "${result.word}" to the active bad-word list.` }
    : { error: result.word ? `"${result.word}" is already on the active list.` : 'Enter a valid word or phrase.' };
  return sendMutation(request, response, payload, '/site-admin?tab=moderation');
});
app.post('/site-admin/announcements', requireUser, requireSiteAdmin, (request, response) => {
  const title = String(request.body.title || '').trim().slice(0, 160);
  const bodyMarkdown = String(request.body.body || '').trim().slice(0, 30000);
  const mediaUrl = String(request.body.mediaUrl || '').trim().slice(0, 2000);
  const mediaType = ['none', 'image', 'video'].includes(request.body.mediaType) ? request.body.mediaType : 'none';
  const fontSize = ['small', 'normal', 'large'].includes(request.body.fontSize) ? request.body.fontSize : 'normal';
  if (!title || !bodyMarkdown) return sendMutation(request, response, { error: 'Announcements need a title and message.' }, '/site-admin?tab=announcements');
  if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) return sendMutation(request, response, { error: 'Media links must start with http:// or https://.' }, '/site-admin?tab=announcements');
  const announcement = { id: id(), title, body_html: renderAnnouncementMarkdown(bodyMarkdown), media_url: mediaUrl, media_type: mediaType, font_size: fontSize, created_by: request.user.id, created_at: new Date().toISOString() };
  db.prepare('INSERT INTO site_announcements (id, title, body_markdown, body_html, media_url, media_type, font_size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(announcement.id, announcement.title, bodyMarkdown, announcement.body_html, announcement.media_url, announcement.media_type, announcement.font_size, announcement.created_by, announcement.created_at);
  const payload = announcementPayload(announcement);
  users.forEach((user) => addNotification(user, payload));
  persistState();
  return sendMutation(request, response, { successMessage: `Announcement sent to ${users.length} users.` }, '/site-admin?tab=announcements');
});
app.post('/beta/feedback', requireUser, async (request, response) => {
  const message = String(request.body.message || '').trim().slice(0, 2000);
  if (!message) return sendMutation(request, response, { error: 'Tell us what you noticed in beta.' }, '/beta');
  const policyError = await contentPolicyError({ type: 'text', text: message });
  if (policyError) return sendMutation(request, response, { error: policyError }, '/beta');
  db.prepare('INSERT INTO site_feedback (id, user_id, username, kind, message, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id(), request.user.id, request.user.username, String(request.body.kind || 'general').slice(0, 40), message, new Date().toISOString());
  return sendMutation(request, response, { successMessage: 'Thanks. Your beta feedback is in.' }, '/beta');
});
app.get('/settings', requireUser, (request, response) => render(request, response, 'account-settings', { accountSettings: request.user.settings || {}, pushSettings: pushNotificationSettings(request.user), snarkyTypeConfigured: snarkyTypeConfigured(), snarkyTypeLinked: request.query.saved === 'snarkytype' }));
app.post('/settings', requireUser, (request, response) => {
  const name = String(request.body.name || '').trim(); const username = String(request.body.username || '').trim().toLowerCase();
  if (!name || !/^[a-z0-9_]{3,24}$/.test(username) || users.some((user) => user.id !== request.user.id && user.username === username)) return sendMutation(request, response, { error: 'Use a valid, available username and a name.' }, '/settings');
  const currentPush = pushNotificationSettings(request.user); const pushNotifications = { enabled: request.body.pushEnabled === 'on', breakoutComments: request.body.pushBreakoutComments === 'on', breakoutTasks: request.body.pushBreakoutTasks === 'on', mentions: request.body.pushMentions === 'on', announcements: request.body.pushAnnouncements === 'on' };
  request.user.name = name; request.user.username = username; request.user.settings = { ...(request.user.settings || {}), timezone: request.body.timezone || '', dateFormat: ['auto', 'mdy', 'dmy', 'ymd'].includes(request.body.dateFormat) ? request.body.dateFormat : 'auto', pushNotifications: request.body.pushEnabled !== undefined ? pushNotifications : currentPush }; persistState();
  return sendMutation(request, response, { successMessage: 'Account settings saved.' }, '/settings');
});
app.post('/settings/push', requireUser, (request, response) => {
  request.user.settings = { ...(request.user.settings || {}), pushNotifications: { enabled: request.body.pushEnabled === 'on', breakoutComments: request.body.pushBreakoutComments === 'on', breakoutTasks: request.body.pushBreakoutTasks === 'on', mentions: request.body.pushMentions === 'on', announcements: request.body.pushAnnouncements === 'on' } };
  persistState();
  return sendMutation(request, response, { successMessage: 'Push notification preferences saved.' }, '/settings#push-notifications');
});
app.get('/integrations/google/connect', requireUser, (request, response) => {
  const { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri } = config.googleTasks;
  if (!taskSyncConfig.enabled || !clientId || !clientSecret || !redirectUri) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const state = crypto.randomBytes(32).toString('base64url');
  googleTasksOAuthStates.forEach((entry, key) => {
    if (entry.createdAt < Date.now() - 10 * 60 * 1000 || entry.userId === request.user.id) googleTasksOAuthStates.delete(key);
  });
  googleTasksOAuthStates.set(state, { userId: request.user.id, createdAt: Date.now() });
  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/tasks',
    access_type: 'offline',
    prompt: 'consent',
    state
  }).toString();
  return response.redirect(authorizeUrl.href);
});
app.get('/integrations/google/callback', async (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const state = String(request.query.state || '');
  const oauthState = googleTasksOAuthStates.get(state);
  googleTasksOAuthStates.delete(state);
  if (!oauthState || oauthState.createdAt < Date.now() - 10 * 60 * 1000) return response.redirect('/todo?integration=google-connect-failed#task-sync-modal');
  const user = users.find((entry) => entry.id === oauthState.userId);
  if (!user || request.query.error || !request.query.code) return response.redirect('/todo?integration=google-connect-failed#task-sync-modal');
  const { client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri } = config.googleTasks;
  try {
    const result = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(request.query.code), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    });
    if (!result.ok) throw new Error(`Google OAuth returned HTTP ${result.status}.`);
    const token = await result.json();
    const previous = user.settings?.googleTasks || {};
    const previousCredentials = previous.credentials ? decryptData(previous.credentials) : {};
    if (!token.access_token || (!token.refresh_token && !previousCredentials.refreshToken)) throw new Error('Google did not provide an offline refresh token.');
    const credentials = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || previousCredentials.refreshToken,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
    };
    user.settings = {
      ...(user.settings || {}),
      googleTasks: { credentials: encryptData(credentials), taskListId: null, taskMap: {} }
    };
    persistState();
    return response.redirect('/todo?integration=google-connected#task-sync-modal');
  } catch (error) {
    console.error('Google Tasks connection failed', error.message);
    return response.redirect('/todo?integration=google-connect-failed#task-sync-modal');
  }
});
app.post('/integrations/google/sync', requireUser, async (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const result = await syncUserTaskIntegrations(request.user, ['googleTasks']);
  const status = result.disabled ? 'sync-env-not-configured' : result.busy ? 'sync-busy' : result.noConnections ? 'google-not-connected' : result.errors.length ? 'sync-failed' : 'sync-complete';
  return response.redirect(`/todo?integration=${status}#task-sync-modal`);
});
app.post('/integrations/google/disconnect', requireUser, (request, response) => {
  request.user.settings = { ...(request.user.settings || {}) };
  delete request.user.settings.googleTasks;
  persistState();
  return response.redirect('/todo?integration=google-disconnected#task-sync-modal');
});
app.post('/integrations/apple/connect', requireUser, async (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const username = String(request.body.username || '').trim().toLowerCase();
  const password = String(request.body.appSpecificPassword || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username) || password.length < 8 || password.length > 128) {
    return response.redirect('/todo?integration=apple-invalid-credentials#task-sync-modal');
  }
  try {
    const credentials = { username, password };
    const calendarHref = await discoverAppleCalendar(credentials, config.appleReminders.caldav_server);
    const previous = request.user.settings?.appleReminders || {};
    const unchangedAccount = previous.username === username;
    request.user.settings = {
      ...(request.user.settings || {}),
      appleReminders: {
        username,
        credentials: encryptData(credentials),
        calendarHref,
        taskMap: unchangedAccount ? (previous.taskMap || {}) : {}
      }
    };
    persistState();
    return response.redirect('/todo?integration=apple-connected#task-sync-modal');
  } catch (error) {
    console.error('Apple Reminders connection failed', error.message);
    return response.redirect('/todo?integration=apple-connect-failed#task-sync-modal');
  }
});
app.post('/integrations/apple/sync', requireUser, async (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const result = await syncUserTaskIntegrations(request.user, ['appleReminders']);
  const status = result.disabled ? 'sync-env-not-configured' : result.busy ? 'sync-busy' : result.noConnections ? 'apple-not-connected' : result.errors.length ? 'sync-failed' : 'sync-complete';
  return response.redirect(`/todo?integration=${status}#task-sync-modal`);
});
app.post('/integrations/apple/disconnect', requireUser, (request, response) => {
  request.user.settings = { ...(request.user.settings || {}) };
  delete request.user.settings.appleReminders;
  persistState();
  return response.redirect('/todo?integration=apple-disconnected#task-sync-modal');
});
app.post('/integrations/sync', requireUser, async (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const result = await syncUserTaskIntegrations(request.user);
  const status = result.disabled ? 'sync-env-not-configured' : result.busy ? 'sync-busy' : result.noConnections ? 'sync-no-connections' : result.errors.length ? 'sync-failed' : 'sync-complete';
  return response.redirect(`/todo?integration=${status}#task-sync-modal`);
});
app.post('/integrations/sync/schedule', requireUser, (request, response) => {
  if (!taskSyncConfig.enabled) return response.redirect('/todo?integration=sync-env-not-configured#task-sync-modal');
  const schedule = String(request.body.schedule || '');
  if (!isSyncSchedule(schedule)) {
    return response.redirect('/todo?integration=sync-schedule-invalid#task-sync-modal');
  }
  request.user.settings ||= {};
  const interval = syncInterval(schedule);
  request.user.settings.taskSync = {
    ...(request.user.settings.taskSync || {}),
    schedule,
    nextSyncAt: interval ? Date.now() + interval : null,
    lastSyncError: null
  };
  persistState();
  return response.redirect('/todo?integration=sync-schedule-saved#task-sync-modal');
});
app.post('/settings/password', requireUser, (request, response) => {
  const newPassword = String(request.body.newPassword || '');
  const passwordSet = request.user.settings?.passwordSet !== false;
  const currentPasswordValid = passwordSet && passwordMatches(request.body.currentPassword || '', request.user.passwordHash);
  if ((!passwordSet && newPassword.length < 8) || (passwordSet && (!currentPasswordValid || newPassword.length < 8))) return sendMutation(request, response, { error: passwordSet ? 'Enter your current password and a new password with at least 8 characters.' : 'Create a password with at least 8 characters.' }, '/settings');
  request.user.passwordHash = passwordHash(newPassword); request.user.settings = { ...(request.user.settings || {}), passwordSet: true }; persistState(); return sendMutation(request, response, { successMessage: passwordSet ? 'Password updated.' : 'Password created.' }, '/settings');
});
app.post('/settings/delete', requireUser, (request, response) => {
  if (String(request.body.confirmation || '') !== 'DELETE' || !passwordMatches(request.body.password || '', request.user.passwordHash)) return sendMutation(request, response, { error: 'Type DELETE and enter your password to close your account.' }, '/settings');
  const deletedUserId = request.user.id;
  const orgs = orgModel.all();
  orgs.forEach((org) => { org.members = (org.members || []).filter((member) => member.userId !== deletedUserId); org.pendingInvites = (org.pendingInvites || []).filter((invite) => invite.userId !== deletedUserId); org.groups = (org.groups || []).filter((group) => group.createdBy !== deletedUserId).map((group) => ({ ...group, members: (group.members || []).filter((memberId) => memberId !== deletedUserId) })); saveOrg(org); });
  for (const [token, userId] of sessions) if (userId === deletedUserId) sessions.delete(token);
  users.splice(users.findIndex((user) => user.id === deletedUserId), 1); persistState(); response.setHeader('Set-Cookie', 'session=; HttpOnly; Max-Age=0; Path=/'); return sendMutation(request, response, { deletedAccount: true, successMessage: 'Your account has been deleted.' }, '/');
});
app.get('/todo', requireUser, async (request, response) => {
  const location = await userDateLocation(request.user, request);
  return render(request, response, 'todo', {
    todoDateTimezone: location.timezone,
    todoDateLocale: location.locale,
    formatTaskDate,
    googleTasksConnected: Boolean(request.user.settings?.googleTasks?.credentials),
    appleRemindersConnected: Boolean(request.user.settings?.appleReminders?.credentials),
    appleRemindersUsername: request.user.settings?.appleReminders?.username || '',
    googleTasksConfigured: Boolean(config.googleTasks.client_id && config.googleTasks.client_secret && config.googleTasks.redirect_uri),
    taskSyncConfigured: taskSyncConfig.enabled,
    taskSyncMissingConfig: taskSyncConfig.missing.join(', '),
    integrationStatus: String(request.query.integration || '')
  });
});
app.use('/calendar', require('./calendar/routes')({ requireUser, render, feedFor: orgModel.feedFor}));
app.use(require('./org/routes')({ contentPolicyError, requireUser, orgModel, render, creatorTimezone: async (user, request) => (await userDateLocation(user, request)).timezone }));
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
  renderOrgPage(request, response, 'breakout', { group, groupAdmin: canManageBreakoutGroup(org, group, request.user), groupMember: group.members.includes(request.user.id), groupCourse: getCourse(org, group.courseId), groupItem: getCourse(org, group.courseId)?.items.find((item) => item.id === group.itemId) });
});

app.get('/org/:id/course/:courseId/task/:taskSlug/breakout-groups', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId); const item = getBreakoutTask(org, request.params.courseId, request.params.taskSlug);
  if (!org || !course || !item || !canAccess(org, request.user)) return response.redirect(`/org/${request.params.id}/course/${request.params.courseId}`);
  renderOrgPage(request, response, 'breakout-groups', { course, task: item, breakoutGroups: breakoutGroupsForTask(org, item.id), canCreateBreakoutGroup: canEdit(membership(org, request.user)) });
});

app.get('/b/:code', requireUser, (request, response) => {
  const org = orgModel.byShareCode(request.params.code);
  const group = org?.groups?.find((entry) => entry.shareCode === request.params.code);
  if (!org || !group || !canAccess(org, request.user)) return response.status(404).send('This breakout group link is no longer available.');
  if (!group.members.includes(request.user.id)) {
    if (group.members.length >= group.limit) return response.status(409).send('This breakout group is full.');
    group.members.push(request.user.id); group.roles ||= {}; group.roles[request.user.id] = 'Member'; saveOrg(org); emitGroup(org, 'breakout:member-joined', { groupId: group.id, userId: request.user.id });
  }
  response.redirect(`/org/${org.id}/breakout/${group.id}`);
});

app.get('/org/:id/course/:courseId', requireUser, async (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canAccess(org, request.user)) return response.redirect(`/org/${request.params.id}`);
  const location = await userDateLocation(request.user, request);
  const copyDestinations = orgModel.all()
    .filter((destinationOrg) => destinationOrg.id === org.id || org.allowCrossGroupTaskCopy !== false)
    .filter((destinationOrg) => canAccess(destinationOrg, request.user) && canEdit(membership(destinationOrg, request.user)))
    .map((destinationOrg) => ({
      id: destinationOrg.id,
      name: destinationOrg.name,
      courses: (destinationOrg.courses || [])
        .filter((destinationCourse) => destinationOrg.id !== org.id || destinationCourse.id !== course.id)
        .map((destinationCourse) => ({ id: destinationCourse.id, name: destinationCourse.name, code: destinationCourse.code || '' }))
    }))
    .filter((destinationOrg) => destinationOrg.courses.length);
  renderOrgPage(request, response, 'course', { course: { ...course, items: [...course.items].sort((left, right) => left.position - right.position) }, courseTimezone: location.timezone, courseDateLocale: location.locale, formatCourseDate, copyDestinations });
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
  const adminTab = member && member.role === 'moderator' && !['mod', 'report'].includes(requestedTab) ? 'mod' : requestedTab;
  const comments = moderationComments(org || { courses: [], groups: [] });
  const timezones = adminTab === 'settings' ? ['UTC', ...Intl.supportedValuesOf('timeZone')] : [];
  if (adminTab === 'settings' && org && orgModel.isValidTimezone(org.timezone) && !timezones.includes(org.timezone)) timezones.push(org.timezone);
  render(request, response, 'admin', {
    selectedOrg: org,
    member,
    adminTab,
    timezones,
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
  const org = getOrg(request); if (!org || !canEdit(membership(org, request.user))) return response.redirect(`/org/${request.params.id}`);
  const name = String(request.body.name || '').trim(); const code = String(request.body.code || '').trim().toUpperCase();
  if (await contentPolicyError({ type: 'course', text: `${name} ${code}` })) return response.redirect(`/org/${org.id}/courses/new?error=policy`);
  org.courses.push({ id: id(), name, code, color: request.body.color || '#ef8354', items: [], board: [], resources: [] }); saveOrg(org); response.redirect(`/org/${org.id}/course/${org.courses.at(-1).id}`);
});

app.post('/org/:id/courses/:courseId/items', requireUser, async (request, response) => {
  const org = getOrg(request); const course = org && org.courses.find((entry) => entry.id === request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this course.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const policyError = await contentPolicyError({ type: 'course-item', text: request.body.title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const item = { id: id(), title: String(request.body.title || '').trim(), details: String(request.body.details || '').trim(), links: await fetchLinkPreviews(`${request.body.title || ''}\n${request.body.details || ''}`), type: request.body.type, due: request.body.due || 'No date', done: request.body.type !== 'Event' ? false : null, comments: [], verifiedBy: [], downvotedBy: [], createdBy: request.user.id, position: course.items.length, past: false };
  item.past = orgModel.isPastAssignment(org, item);
  if (!item.title) return sendMutation(request, response, { error: 'A title is required.' }, `/org/${org.id}/course/${course.id}`);
  course.items.push(item); saveOrg(org); emitCourse(org, course, 'course:item-created', { item });
  return sendMutation(request, response, { item }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/course/:courseId/items/reorder', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId); const member = membership(org, request.user);
  if (!course || !canAccess(org, request.user)) return sendMutation(request, response, { error: 'You cannot reorder tasks in this course.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  const now = Date.now(); const key = `${request.user.id}:${course.id}`; const lastReorderedAt = courseReorderWindows.get(key) || 0;
  if (!isOrgModerator(org, request.user) && now - lastReorderedAt < 5000) return sendMutation(request, response, { error: 'Please wait 5 seconds before reordering again.', retryAfter: 5000 - (now - lastReorderedAt) }, `/org/${org.id}/course/${course.id}`);
  const pastIds = new Set(Array.isArray(request.body.past) ? request.body.past : String(request.body.past || '').split(','));
  const order = Array.isArray(request.body.order) ? request.body.order : String(request.body.order || '').split(','); const itemsById = new Map(course.items.map((item) => [item.id, item]));
  order.forEach((itemId, index) => { const item = itemsById.get(itemId); if (item) item.position = index; });
  course.items.forEach((item) => { if (order.includes(item.id)) { item.pastOverride = pastIds.has(item.id); item.past = item.pastOverride; } });
  course.items.sort((left, right) => left.position - right.position); courseReorderWindows.set(key, now); saveOrg(org); emitCourse(org, course, 'course:items-reordered', { items: course.items });
  return sendMutation(request, response, { items: course.items }, `/org/${org.id}/course/${course.id}`);
});

app.post('/groups', requireUser, async (request, response) => {
  const org = getOrg({ params: { id: request.body.orgId } }); const course = getCourse(org, request.body.courseId);
  if (!org || !course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'Only course editors, moderators, and admins can create breakout groups.' }, '/groups');
  const item = course.items.find((entry) => entry.id === request.body.itemId);
  if (request.body.itemId && (!item || item.type !== 'Project')) return sendMutation(request, response, { error: 'Breakout groups can only be created for projects.' }, `/org/${org.id}/course/${course.id}`);
  if (item && breakoutGroupsForTask(org, item.id).length >= 50) return sendMutation(request, response, { error: 'This project already has the maximum of 50 breakout groups.' }, breakoutGroupsUrl(org, course, item));
  org.groups ||= []; const groupName = String(request.body.name || `${item?.title || course.name} breakout group`).trim();
  if (await contentPolicyError({ type: 'group', text: groupName })) return sendMutation(request, response, { error: 'This content violates our content policy. Edit it, then try again.' }, `/org/${org.id}/course/${course.id}`);
  const group = { id: id(), name: groupName, taskSlug: item ? breakoutTaskSlug(item) : null, shareCode: crypto.randomBytes(12).toString('base64url'), courseId: course.id, courseName: course.name, itemId: item?.id || null, createdBy: request.user.id, limit: Math.min(50, Math.max(2, Number(request.body.limit) || 4)), members: [request.user.id], roles: { [request.user.id]: 'Organizer' }, tasks: [{ id: id(), title: 'Choose a direction', claimedBy: request.user.id, done: false }, { id: id(), title: 'Upload shared resources', claimedBy: null, done: false }], resources: [], polls: [{ question: 'When should we meet?', options: ['Today after school', 'Tomorrow at lunch', 'This weekend'], votes: {} }] };
  if (!group.name) return sendMutation(request, response, { error: 'A subgroup name is required.' }, '/groups');
  org.groups.push(group); saveOrg(org); emitCourse(org, course, 'subgroup:created', { group }); emitGroup(org, 'subgroup:created', { group });
  const groupUrl = item ? breakoutGroupsUrl(org, course, item) : `/org/${org.id}/breakout/${group.id}`;
  return sendMutation(request, response, { group, groupUrl }, groupUrl);
});

app.post('/org/:id/breakout/:groupId/settings', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this breakout group.' }, `/org/${request.params.id}`);
  const limit = Number(request.body.limit); if (!Number.isInteger(limit) || limit < group.members.length || limit < 2 || limit > 50) return sendMutation(request, response, { error: `Choose a capacity between ${Math.max(2, group.members.length)} and 50.` }, `/org/${org.id}/breakout/${group.id}`);
  group.limit = limit; saveOrg(org); emitGroup(org, 'breakout:updated', { group });
  return sendMutation(request, response, { group }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/members', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const username = String(request.body.username || '').trim().toLowerCase(); const target = users.find((user) => user.username === username);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot add people to this breakout group.' }, `/org/${request.params.id}`);
  if (!target || !membership(org, target)) return sendMutation(request, response, { error: 'That username is not a member of this study space.' }, `/org/${org.id}/breakout/${group.id}`);
  if (group.members.includes(target.id)) return sendMutation(request, response, { error: 'That person is already in the breakout group.' }, `/org/${org.id}/breakout/${group.id}`);
  if (group.members.length >= group.limit) return sendMutation(request, response, { error: 'This breakout group is full.' }, `/org/${org.id}/breakout/${group.id}`);
  group.members.push(target.id); group.roles ||= {}; group.roles[target.id] = 'Member'; saveOrg(org); emitGroup(org, 'breakout:member-joined', { groupId: group.id, userId: target.id });
  return sendMutation(request, response, { member: target.id }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/items/:itemId/verify', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (item) { item.verifiedBy ||= []; const index = item.verifiedBy.indexOf(request.user.id); if (index === -1) item.verifiedBy.push(request.user.id); else item.verifiedBy.splice(index, 1); saveOrg(org); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:verification-changed', { itemId: item.id, verifiedBy: item.verifiedBy }); }
  const course = org?.courses.find((entry) => entry.items.some((entryItem) => entryItem.id === request.params.itemId));
  return sendMutation(request, response, { itemId: item?.id, verifiedBy: item?.verifiedBy || [] }, `/org/${org?.id || ''}/course/${course?.id || ''}`);
});

app.post('/org/:id/items/:itemId/downvote', requireUser, (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (!item) return sendMutation(request, response, { error: 'You cannot dislike this feed item.' }, `/org/${org?.id || ''}`);
  item.downvotedBy ||= []; const index = item.downvotedBy.indexOf(request.user.id); if (index === -1) item.downvotedBy.push(request.user.id); else item.downvotedBy.splice(index, 1);
  saveOrg(org); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:downvote-changed', { itemId: item.id, downvoteCount: item.downvotedBy.length });
  return sendMutation(request, response, { itemId: item.id, downvoteCount: item.downvotedBy.length }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/update', requireUser, async (request, response) => {
  const org = getOrg(request); const item = canAccess(org, request.user) ? org.courses.flatMap((course) => course.items).find((entry) => entry.id === request.params.itemId) : null;
  if (!item || !canManageItem(org, item, request.user)) return sendMutation(request, response, { error: 'You cannot edit this item.' }, `/org/${org?.id || ''}`);
  const title = String(request.body.title || '').trim(); const course = org.courses.find((entry) => entry.items.includes(item)); if (!title) return sendMutation(request, response, { error: 'A title is required.' }, `/org/${org.id}`);
  const nextType = request.body.type || item.type; const policyError = nextType === 'Event' ? null : await contentPolicyError({ type: 'course-item', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}`);
  item.title = title; item.details = String(request.body.details || '').trim(); item.links = await fetchLinkPreviews(`${title}\n${item.details}`); item.type = nextType; item.due = request.body.due || 'No date'; item.past = orgModel.isPastAssignment(org, item);
  users.forEach((user) => { const task = (user.tasks || []).find((entry) => entry.sourceId === item.id && entry.linked !== false); if (task) { task.title = item.title; task.details = item.details; task.links = item.links; task.due = item.due; task.source = `${course.name} · ${org.name}`; task.importance = dueImportance(task.due); emitTodo(user.id, 'todo:task-updated', { task: normalizeTask(task) }); } });
  saveOrg(org); emitCourse(org, course, 'item:updated', { item });
  return sendMutation(request, response, { item }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/copy', requireUser, async (request, response) => {
  const sourceOrg = getOrg(request);
  const sourceCourse = sourceOrg?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId));
  const sourceItem = sourceCourse?.items.find((entry) => entry.id === request.params.itemId);
  const destinationOrg = orgModel.get(request.body.destinationOrgId);
  const destinationCourse = getCourse(destinationOrg, String(request.body.destinationCourseId || ''));
  const sourceFallback = `/org/${sourceOrg?.id || ''}/course/${sourceCourse?.id || ''}`;
  if (!sourceOrg || !sourceItem || !canAccess(sourceOrg, request.user) || !canManageItem(sourceOrg, sourceItem, request.user) || sourceItem.type === 'Event') {
    return sendMutation(request, response, { error: 'You cannot copy this task.' }, sourceFallback);
  }
  if (!destinationOrg || !destinationCourse || !canAccess(destinationOrg, request.user) || !canEdit(membership(destinationOrg, request.user))) {
    return sendMutation(request, response, { error: 'Choose a course you can edit.' }, sourceFallback);
  }
  if (sourceOrg.id !== destinationOrg.id && sourceOrg.allowCrossGroupTaskCopy === false) {
    return sendMutation(request, response, { error: 'This group does not allow copying tasks to other groups.' }, sourceFallback);
  }
  if (sourceOrg.id === destinationOrg.id && sourceCourse.id === destinationCourse.id) {
    return sendMutation(request, response, { error: 'Choose a different course.' }, sourceFallback);
  }
  const policyError = await contentPolicyError({ type: 'course-item', text: `${sourceItem.title}\n${sourceItem.details || ''}` });
  if (policyError) return sendMutation(request, response, { error: policyError }, sourceFallback);

  const copiedItem = {
    id: id(),
    title: sourceItem.title,
    details: sourceItem.details || '',
    links: (sourceItem.links || []).map((link) => ({ ...link })),
    type: sourceItem.type,
    due: sourceItem.due || 'No date',
    done: false,
    comments: [],
    verifiedBy: [],
    downvotedBy: [],
    createdBy: request.user.id,
    position: destinationCourse.items.length,
    past: false
  };
  copiedItem.past = orgModel.isPastAssignment(destinationOrg, copiedItem);
  destinationCourse.items.push(copiedItem);
  saveOrg(destinationOrg);
  emitCourse(destinationOrg, destinationCourse, 'course:item-created', { item: copiedItem });
  const copiedUrl = `/org/${destinationOrg.id}/course/${destinationCourse.id}#item-${copiedItem.id}`;
  return sendMutation(request, response, { copiedItemId: copiedItem.id, copiedUrl, successMessage: 'Task copied.' }, sourceFallback);
});

app.post('/org/:id/items/:itemId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = org?.courses.find((entry) => entry.items.some((item) => item.id === request.params.itemId)); const item = course?.items.find((entry) => entry.id === request.params.itemId);
  if (!org || !item || !canManageItem(org, item, request.user)) return sendMutation(request, response, { error: 'You cannot delete this item.' }, `/org/${org?.id || ''}`);
  appendRemovedTextForReview(item.title || '');
  course.items = course.items.filter((entry) => entry.id !== item.id); org.groups = (org.groups || []).filter((group) => group.itemId !== item.id);
  users.forEach((user) => { const task = (user.tasks || []).find((entry) => entry.sourceId === item.id); if (task) { task.sourceId = null; task.linked = false; task.source = 'Unlinked course task'; emitTodo(user.id, 'todo:task-updated', { task: normalizeTask(task) }); } });
  saveOrg(org); emitCourse(org, course, 'item:deleted', { itemId: item.id });
  return sendMutation(request, response, { deleted: true, itemId: item.id }, `/org/${org.id}/course/${course.id}`);
});

app.post('/org/:id/items/:itemId/todo', requireUser, (request, response) => {
  const org = getOrg(request); const course = canAccess(org, request.user) ? org.courses.find((entry) => entry.items.some((entryItem) => entryItem.id === request.params.itemId)) : null; const item = course?.items.find((entry) => entry.id === request.params.itemId);
  let task;
  if (org && course && item) { request.user.tasks ||= []; task = request.user.tasks.find((entry) => entry.sourceId === item.id); if (!task) { task = normalizeTask({ id: id(), title: item.title, details: item.details, links: item.links, sourceId: item.id, source: `${course.name} · ${org.name}`, due: item.due, priority: 'Normal', done: false, position: request.user.tasks.length }); request.user.tasks.push(task); persistState(); emitCourse(org, course, 'task:added', { userId: request.user.id, task }); emitTodo(request.user.id, 'todo:task-added', { task }); } }
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
    request.user.tasks ||= []; task = normalizeTask({ id: id(), title: request.body.title.trim(), details: String(request.body.details || '').trim(), links: await fetchLinkPreviews(`${request.body.title || ''}\n${request.body.details || ''}`), sourceId: null, source: 'Personal study goal', due: request.body.due || 'No date', priority: request.body.priority || 'Normal', done: false, position: request.user.tasks.length }); request.user.tasks.push(task); persistState(); emitTodo(request.user.id, 'todo:task-added', { task });
  }
  return sendMutation(request, response, { task, todoPendingCount: (request.user.tasks || []).filter((entry) => !entry.done).length }, '/todo');
});

app.post('/tasks/:taskId/update', requireUser, async (request, response) => {
  const task = (request.user.tasks || []).find((entry) => entry.id === request.params.taskId);
  if (!task) return sendMutation(request, response, { error: 'Task not found.' }, '/todo');
  const title = String(request.body.title || '').trim();
  if (!title) return sendMutation(request, response, { error: 'A title is required.' }, '/todo');
  const policyError = await contentPolicyError({ type: 'text', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, '/todo');
  task.title = title; task.details = String(request.body.details || '').trim(); task.links = await fetchLinkPreviews(`${title}\n${task.details}`); task.due = request.body.due || 'No date'; task.priority = ['Low', 'Normal', 'Medium', 'High'].includes(request.body.priority) ? request.body.priority : 'Normal';
  persistState(); emitTodo(request.user.id, 'todo:task-updated', { task: normalizeTask(task) });
  return sendMutation(request, response, { task: normalizeTask(task) }, '/todo');
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
  if (item && item.type !== 'Event') { item.done = !item.done; saveOrg(org); const course = org.courses.find((entry) => entry.items.includes(item)); emitCourse(org, course, 'item:updated', { item });}
  return sendMutation(request, response, { item }, `/org/${org?.id || ''}/course/${org?.courses.find((entry) => entry.items.some((entry) => entry.id === request.params.itemId))?.id || ''}`);
});

app.post('/org/:id/breakout/:groupId/tasks', requireUser, async (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this breakout group.' }, `/org/${request.params.id}`);
  const title = String(request.body.title || '').trim(); if (!title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/breakout/${group.id}`);
  const policyError = await contentPolicyError({ type: 'group-task', text: title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  group.tasks ||= []; const task = { id: id(), title, claimedBy: null, done: false, createdBy: request.user.id }; group.tasks.push(task); saveOrg(org); emitGroup(org, 'breakout:task-created', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/update', requireUser, async (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot edit this task.' }, `/org/${request.params.id}`);
  const nextTitle = String(request.body.title || '').trim() || task.title; const policyError = await contentPolicyError({ type: 'group-task', text: nextTitle });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/breakout/${group.id}`);
  task.title = nextTitle; task.done = request.body.done === 'true' || request.body.done === 'on'; saveOrg(org); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/claim', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !group.members.includes(request.user.id)) return sendMutation(request, response, { error: 'You must be in this breakout group to claim a task.' }, `/org/${request.params.id}`);
  task.claimedBy = request.user.id; saveOrg(org); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/unclaim', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || (task.claimedBy !== request.user.id && !canManageBreakoutGroup(org, group, request.user))) return sendMutation(request, response, { error: 'You cannot unclaim this task.' }, `/org/${request.params.id}`);
  task.claimedBy = null; saveOrg(org); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/toggle', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId);
  if (!group || !task || !group.members.includes(request.user.id)) return sendMutation(request, response, { error: 'You must be in this breakout group to update a task.' }, `/org/${request.params.id}`);
  task.done = !task.done; saveOrg(org); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/ping/:userId', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const target = users.find((user) => user.id === request.params.userId);
  const key = `${request.user.id}:${request.params.userId}`; const remaining = 10000 - (Date.now() - (breakoutPingWindows.get(key) || 0));
  if (!org || !group || !target || target.id === request.user.id || !group.members.includes(request.user.id) || !group.members.includes(target.id)) return sendMutation(request, response, { error: 'You can only ping another person in your breakout group.' }, `/org/${request.params.id}/breakout/${request.params.groupId}`);
  if (remaining > 0) return sendMutation(request, response, { error: `Please wait ${Math.ceil(remaining / 1000)} seconds before pinging ${target.name}.` }, `/org/${request.params.id}/breakout/${request.params.groupId}`);
  breakoutPingWindows.set(key, Date.now());
  addNotification(target, { type: 'breakout-ping', title: `${request.user.name} is looking for you`, message: `Come back to ${group.name} for a quick check-in.`, href: `/org/${org.id}/breakout/${group.id}`, actionLabel: 'Open group' });
  saveOrg(org);
  persistState();
  return sendMutation(request, response, { pinged: true, successMessage: `Ping sent to ${target.name}.` }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/delegate', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId); const task = group?.tasks?.find((entry) => entry.id === request.params.taskId); const targetId = String(request.body.userId || '');
  if (!group || !task || !canManageBreakoutGroup(org, group, request.user) || !group.members.includes(targetId)) return sendMutation(request, response, { error: 'Only group admins can delegate tasks to group members.' }, `/org/${request.params.id}`);
  task.claimedBy = targetId; const target = users.find((user) => user.id === targetId); if (target && target.id !== request.user.id && !isUserOnBreakoutPage(org.id, group.id, target.id)) addNotification(target, { type: 'breakout-task', title: `A task was assigned to you in ${group.name}`, message: task.title, href: `/org/${org.id}/breakout/${group.id}`, actionLabel: 'Open group' }); saveOrg(org); persistState(); emitGroup(org, 'breakout:task-updated', { groupId: group.id, task });
  return sendMutation(request, response, { task }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/tasks/:taskId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this task.' }, `/org/${request.params.id}`);
  group.tasks = (group.tasks || []).filter((task) => task.id !== request.params.taskId); saveOrg(org); emitGroup(org, 'breakout:task-deleted', { groupId: group.id, taskId: request.params.taskId });
  return sendMutation(request, response, { taskId: request.params.taskId }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/breakout/:groupId/board/delete', requireUser, (request, response) => {
  const org = getOrg(request); const group = getBreakoutGroup(org, request.params.groupId);
  if (!group || !canManageBreakoutGroup(org, group, request.user)) return sendMutation(request, response, { error: 'You cannot delete this board.' }, `/org/${request.params.id}`);
  group.tasks = []; saveOrg(org); emitGroup(org, 'breakout:board-deleted', { groupId: group.id });
  return sendMutation(request, response, { groupId: group.id }, `/org/${org.id}/breakout/${group.id}`);
});

app.post('/org/:id/course/:courseId/board', requireUser, async (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit this board.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.board ||= []; const card = { id: id(), title: String(request.body.title || '').trim(), status: request.body.status || 'Open', claimedBy: null, createdBy: request.user.id };
  if (!card.title) return sendMutation(request, response, { error: 'A task title is required.' }, `/org/${org.id}/course/${course.id}`);
  const policyError = await contentPolicyError({ type: 'board-task', text: card.title });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#board`);
  course.board.push(card); saveOrg(org); emitCourse(org, course, 'board:card-created', { card });
  return sendMutation(request, response, { card }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/board/:cardId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can delete board cards.' }, `/org/${request.params.id}/course/${request.params.courseId}#board`);
  course.board = (course.board || []).filter((card) => card.id !== request.params.cardId); saveOrg(org); emitCourse(org, course, 'board:card-deleted', { cardId: request.params.cardId });
  return sendMutation(request, response, { deleted: true, cardId: request.params.cardId }, `/org/${org.id}/course/${course.id}#board`);
});

app.post('/org/:id/course/:courseId/resources', requireUser, async (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !canEdit(membership(org, request.user))) return sendMutation(request, response, { error: 'You cannot edit resources.' }, `/org/${request.params.id}/course/${request.params.courseId}`);
  course.resources ||= []; const resource = { id: id(), title: String(request.body.title || '').trim(), url: String(request.body.url || '').trim(), createdBy: request.user.id };
  if (!resource.title || !resource.url) return sendMutation(request, response, { error: 'A resource title and link are required.' }, `/org/${org.id}/course/${course.id}#resources`);
  const policyError = await contentPolicyError({ type: 'website', text: `${resource.title} ${resource.url}` });
  if (policyError) return sendMutation(request, response, { error: policyError }, `/org/${org.id}/course/${course.id}#resources`);
  course.resources.push(resource); saveOrg(org); emitCourse(org, course, 'resource:created', { resource });
  return sendMutation(request, response, { resource }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/course/:courseId/resources/:resourceId/delete', requireUser, (request, response) => {
  const org = getOrg(request); const course = getCourse(org, request.params.courseId);
  if (!course || !isOrgModerator(org, request.user)) return sendMutation(request, response, { error: 'Only moderators and admins can delete resources.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  const resource = (course.resources || []).find((entry) => entry.id === request.params.resourceId);
  if (!resource) return sendMutation(request, response, { error: 'Resource not found.' }, `/org/${request.params.id}/course/${request.params.courseId}#resources`);
  course.resources = course.resources.filter((entry) => entry.id !== resource.id); saveOrg(org); emitCourse(org, course, 'resource:deleted', { resourceId: resource.id });
  return sendMutation(request, response, { deleted: true, resourceId: resource.id }, `/org/${org.id}/course/${course.id}#resources`);
});

app.post('/org/:id/admin/settings', requireUser, async (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  const name = String(request.body.name || '').trim(); const description = String(request.body.description || '').trim();
  if (!name || await contentPolicyError({ type: 'text', text: `${name} ${description}` })) return response.redirect(`/org/${request.params.id}/admin/settings?error=policy`);
  const timezone = String(request.body.timezone || '');
  if (!orgModel.isValidTimezone(timezone)) return response.redirect(`/org/${org.id}/admin/settings?error=timezone`);
  org.name = name; org.description = description; org.theme = ['coral', 'green', 'blue', 'gold'].includes(request.body.theme) ? request.body.theme : 'coral'; org.allowCrossGroupTaskCopy = request.body.allowCrossGroupTaskCopy === 'on'; org.timezone = timezone; org.autoMovePastAssignments = request.body.autoMovePastAssignments === 'on'; saveOrg(org); response.redirect(`/org/${org.id}/admin/settings?saved=settings`);
});

app.post('/org/:id/admin/share', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (!org || member?.role !== 'admin') return response.redirect(`/org/${request.params.id}`);
  if (request.body.visibility === 'public' && request.user.age <= 13) return response.redirect(`/org/${org.id}?error=age`);
  org.visibility = request.body.visibility; org.sharePermission = request.body.sharePermission || org.sharePermission; org.shareUses = Math.max(1, Number(request.body.shareUses) || 1); saveOrg(org); response.redirect(`/org/${org.id}/admin/share?saved=settings`);
});

app.post('/org/:id/delete', requireUser, (request, response) => {
  const org = getOrg(request);
  if (!org || !isOrgAdmin(org, request.user)) return sendMutation(request, response, { error: 'Only group admins can delete this group.' }, '/groups');
  orgModel.delete(org.id);
  return sendMutation(request, response, { deletedGroup: request.params.id, successMessage: `${org.name} was deleted.` }, '/groups');
});

app.post('/org/:id/settings', requireUser, (request, response) => response.redirect(`/org/${request.params.id}/admin/share`));

app.post('/org/:id/members', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user); const target = users.find((user) => user.username === String(request.body.username || '').trim().toLowerCase());
  const role = ['viewer', 'editor', 'moderator'].includes(request.body.role) ? request.body.role : 'viewer';
  if (org && member?.role === 'admin' && target && target.id !== request.user.id && !membership(org, target)) {
    org.pendingInvites ||= [];
    if (!pendingInvite(org, target)) {
      org.pendingInvites.push({ id: id(), userId: target.id, role, invitedBy: request.user.id, createdAt: new Date().toISOString() });
      addNotification(target, { type: 'group-invite', title: `Invitation to ${org.name}`, message: `${request.user.name} invited you to join ${org.name}.`, href: '/groups', actionLabel: 'Review invitation' });
      saveOrg(org);
    }
  }
  response.redirect(`/org/${org?.id || request.params.id}/people`);
});

app.post('/org/:id/leave', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  const adminCount = org?.members.filter((entry) => entry.role === 'admin').length || 0;
  if (!org || !member) return sendMutation(request, response, { error: 'You are not a member of this group.' }, '/groups');
  if (member.role === 'admin' && adminCount <= 1) return sendMutation(request, response, { error: 'Transfer group administration to another member before leaving.' }, `/org/${org.id}`);
  org.members = org.members.filter((entry) => entry.userId !== request.user.id);
  saveOrg(org);
  return sendMutation(request, response, { leftGroup: true, successMessage: `You left ${org.name}.` }, '/groups');
});

app.post('/groups/:id/invitation/:action', requireUser, (request, response) => {
  const org = getOrg({ params: { id: request.params.id } }); const invite = pendingInvite(org, request.user);
  if (!org || !invite || !['accept', 'deny'].includes(request.params.action)) return sendMutation(request, response, { error: 'That group invitation is no longer available.' }, '/groups');
  org.pendingInvites = (org.pendingInvites || []).filter((entry) => entry.id !== invite.id);
  if (request.params.action === 'accept') {
    if (!membership(org, request.user)) org.members.push({ userId: request.user.id, role: invite.role });
    saveOrg(org);
    return sendMutation(request, response, { invitationAction: 'accepted', successMessage: `You joined ${org.name}.` }, `/group/${org.slug || org.id}`);
  }
  saveOrg(org);
  return sendMutation(request, response, { invitationAction: 'denied', successMessage: `Invitation to ${org.name} declined.` }, '/groups');
});

app.post('/org/:id/members/:userId/access', requireUser, (request, response) => {
  const org = getOrg(request); const actor = membership(org, request.user); const target = membership(org, users.find((user) => user.id === request.params.userId));
  const role = ['viewer', 'editor', 'moderator', 'admin'].includes(request.body.role) ? request.body.role : null;
  if (!org || actor?.role !== 'admin' || !target || !role || target.userId === request.user.id) return sendMutation(request, response, { error: 'You cannot change this member access.' }, `/org/${request.params.id}/people`);
  if (target.role === 'admin' && role !== 'admin' && org.members.filter((entry) => entry.role === 'admin').length < 2) return sendMutation(request, response, { error: 'The group must keep at least one admin.' }, `/org/${request.params.id}/people`);
  target.role = role; saveOrg(org);
  return sendMutation(request, response, { role, userId: target.userId }, `/org/${org.id}/people`);
});

app.post('/org/:id/members/:userId/remove', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user); const target = membership(org, users.find((user) => user.id === request.params.userId));
  const adminCount = org?.members.filter((entry) => entry.role === 'admin').length || 0;
  if (org && member?.role === 'admin' && target && (target.role !== 'admin' || adminCount > 1)) { org.members = org.members.filter((entry) => entry.userId !== request.params.userId); saveOrg(org); }
  response.redirect(`/org/${request.params.id}/people`);
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
  saveOrg(org);
  return sendMutation(request, response, { action, userId: target.id, successMessage: action === 'warning' ? 'Warning sent.' : action === 'unban' ? 'Access restored.' : action === 'ban' ? 'Permanent ban applied.' : 'Suspension applied.' }, `/org/${org.id}/people`);
});

app.post('/org/:id/reports', requireUser, (request, response) => {
  const org = getOrg(request); if (org && canAccess(org, request.user)) { org.reports ||= []; org.reports.push({ id: id(), reporter: request.user.username, reason: request.body.reason, detail: String(request.body.detail || '').trim(), status: 'open', createdAt: new Date().toISOString() }); saveOrg(org); }
  response.redirect(`/org/${org?.id || ''}?reported=1`);
});

app.post('/org/:id/reports/:reportId/close', requireUser, (request, response) => {
  const org = getOrg(request); const member = membership(org, request.user);
  if (org && member?.role === 'admin') { const report = (org.reports || []).find((entry) => entry.id === request.params.reportId); if (report) { report.status = 'closed'; saveOrg(org); } }
  response.redirect(`/org/${org?.id || ''}/admin/report`);
});

app.post('/org/:id/admin/reports/:reportId/action', requireUser, async (request, response) => {
  const org = getOrg(request); const actor = membership(org, request.user); const report = org?.reports?.find((entry) => entry.id === request.params.reportId);
  const action = ['remove', 'remove-moderate', 'warn', 'ban', 'close'].includes(request.body.action) ? request.body.action : null;
  const isSiteAdminUser = isSiteAdmin(request.user);
  const reportFallback = isSiteAdminUser ? '/site-admin?tab=moderation' : `/org/${request.params.id}/admin/report`;
  if (!org || (!isSiteAdminUser && !['admin', 'moderator'].includes(actor?.role)) || !report || !action) return sendMutation(request, response, { error: 'Only admins and moderators can act on this report.' }, reportFallback);
  const message = String(request.body.message || '').trim().slice(0, 500);
  if (action === 'warn' && !message) return sendMutation(request, response, { error: 'A warning message is required.' }, `/org/${request.params.id}/admin/report`);
  if (message && await contentPolicyError({ type: 'text', text: message })) return sendMutation(request, response, { error: 'That moderation message could not be sent.' }, `/org/${request.params.id}/admin/report`);
  let affectedUser = null;
  if (report.type === 'content' && report.contentId) {
    for (const course of org.courses || []) for (const item of course.items || []) {
      const comment = (item.comments || []).find((entry) => entry.id === report.contentId);
      if (comment) { affectedUser = users.find((user) => user.id === comment.userId); if (['remove', 'remove-moderate', 'ban'].includes(action)) { appendRemovedTextForReview(comment.text || report.contentText || report.reason || ''); item.comments = item.comments.filter((entry) => entry.id !== comment.id); emitCourse(org, course, 'item:comment-deleted', { itemId: item.id, commentId: comment.id }); } break; }
      if (item.id === report.contentId) { affectedUser = users.find((user) => user.id === item.createdBy); if (['remove', 'remove-moderate', 'ban'].includes(action)) { appendRemovedTextForReview(item.title || report.contentText || report.reason || ''); course.items = course.items.filter((entry) => entry.id !== item.id); emitCourse(org, course, 'item:deleted', { itemId: item.id }); } break; }
    }
    if (!affectedUser) for (const group of org.groups || []) {
      const comment = (group.comments || []).find((entry) => entry.id === report.contentId);
      if (comment) { affectedUser = users.find((user) => user.id === comment.userId); if (['remove', 'remove-moderate', 'ban'].includes(action)) { appendRemovedTextForReview(comment.text || report.contentText || report.reason || ''); group.comments = group.comments.filter((entry) => entry.id !== comment.id); emitGroup(org, 'breakout:comment-deleted', { groupId: group.id, commentId: comment.id }); } break; }
    }
  }
  if (['remove-moderate', 'warn', 'ban'].includes(action) && affectedUser && affectedUser.id !== request.user.id) {
    const days = Math.min(30, Math.max(1, Number(request.body.days) || 7));
    if (action === 'warn') addNotification(affectedUser, { type: 'warning', title: `Conduct warning from ${org.name}`, message });
    else { affectedUser.moderationStatus = action === 'ban' ? 'banned' : 'suspended'; affectedUser.moderationUntil = action === 'ban' ? '' : new Date(Date.now() + days * 86400000).toISOString(); affectedUser.moderationMessage = message || (action === 'ban' ? 'Your access is permanently suspended until an administrator lifts the ban.' : `Your access is suspended for ${days} days after a content moderation action.`); addNotification(affectedUser, { type: action === 'ban' ? 'ban' : 'suspension', title: `Moderation action in ${org.name}`, message: affectedUser.moderationMessage }); sessions.forEach((userId, token) => { if (userId === affectedUser.id) sessions.delete(token); }); }
  }
  report.status = 'closed'; report.action = action; report.actionBy = request.user.username; report.actionAt = new Date().toISOString(); saveOrg(org);
  emitOrg(org, 'org:moderation-updated', { orgId: org.id, reportId: report.id, commentId: report.contentId, action });
  return sendMutation(request, response, { action, reportId: report.id, successMessage: action === 'close' ? 'Report closed.' : action === 'warn' ? 'Warning sent.' : action === 'remove-moderate' ? 'Content removed and temporary suspension applied.' : action === 'ban' ? 'Content removed and permanent ban applied.' : 'Reported content removed.' }, `/org/${org.id}/admin/report`);
});

app.get('/share/:code', (request, response) => {
  const org = orgModel.byOrgShareCode(request.params.code);
  if (!org || org.shareUses < 1) return response.status(404).send('This share link is no longer active.');
  const user = currentUser(request); if (!user) return response.redirect(authRedirect('/login', null, request.originalUrl));
  if (!membership(org, user)) org.members.push({ userId: user.id, role: org.sharePermission }); org.shareUses -= 1; saveOrg(org); response.redirect(`/org/${org.id}`);
});

app.use((request, response) => {
  response.status(404).render('error', {
    status: 404,
    title: 'That page wandered off.',
    message: 'We looked everywhere we could think of. The page you wanted is not here, but the rest of LockIn is still taking attendance.'
  });
});

app.use((error, request, response, next) => {
  if (response.headersSent) return next(error);
  console.error('Unhandled request error:', error);
  const status = Number(error.status || error.statusCode) === 502 ? 502 : 500;
  response.status(status).render('error', {
    status,
    title: status === 502 ? 'The upstream service is unavailable.' : 'The server missed a step.',
    message: status === 502 ? 'LockIn reached the server, but an upstream service returned a bad gateway response. Please try again shortly.' : 'Something went sideways on our end. No need to debug it from your side; head back to LockIn and try again.'
  });
});

const taskSyncScheduler = setInterval(() => {
  if (!taskSyncConfig.enabled) return;
  const dueUsers = users.filter((user) =>
    isSyncDue(user.settings?.taskSync) &&
    (user.settings?.googleTasks?.credentials || user.settings?.appleReminders?.credentials)
  );
  dueUsers.forEach((user) => {
    syncUserTaskIntegrations(user).catch((error) => console.error(`Scheduled task sync failed for user ${user.id}`, error.message));
  });
}, 15_000);
taskSyncScheduler.unref();

server.listen(port, host, () => {
  const codespacesUrl = process.env.CODESPACES && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
    ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
    : null;
  // VS Code's integrated terminal detects a forwarded port and shows the
  // "Your app is running at http://localhost:PORT" popup plus the Ports panel
  // entry by recognizing a browsable http://localhost:PORT / 127.0.0.1:PORT
  // URL in the startup output. `0.0.0.0` is not browsable, so advertising it
  // makes VS Code ignore the port. The server still listens on `host` (0.0.0.0)
  // so the app stays reachable on the local network; we only change the log.
  const displayUrl = !host || host === '0.0.0.0' || host === '::'
    ? `http://localhost:${port}`
    : `http://${host}:${port}`;
  console.log(`LockIn running at ${displayUrl}${codespacesUrl ? ` (${codespacesUrl})` : ''}`);
});
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
