const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
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

function normalizeTask(task, index = 0) { return { ...task, details: task.details || '', links: normalizeLinks(task.links), position: Number.isFinite(Number(task.position)) ? Number(task.position) : index, linked: task.sourceId ? task.linked !== false : false, importance: dueImportance(task.due) }; }
//function normalizeUserTasks(user) { if (!user) return; user.tasks = (user.tasks || []).map(normalizeTask); }
function normalizeLink(link) { const url = String(typeof link === 'string' ? link : link?.url || ''); let domain = url; try { domain = new URL(url).hostname; } catch (error) {} const fallbackImage = domain && domain !== url ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : ''; return typeof link === 'string' ? { url, title: domain, description: '', image: fallbackImage, domain } : { url, title: link.title || domain, description: link.description || '', image: link.image || fallbackImage, domain: link.domain || domain }; }
function normalizeLinks(links) { return (Array.isArray(links) ? links : []).filter((link) => link?.url).map(normalizeLink); }
function dueImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`); const days = Math.round((dueDate - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}
function loadUsersFromDatabase(db) {
  const rows = db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY username ASC ').all();
  taskEncryptionMigrationNeeded = rows.some((row) => !row.tasks?.startsWith('v1:'));
  return rows.map((row) => {
    const settings = JSON.parse(row.settings || '{}');
    if (settings.snarkyType && settings.passwordSet === undefined) settings.passwordSet = false;
    return {
      id: row.id,
      isActive: Boolean(row.is_active),
      name: row.name,
      username: row.username,
      age: Number(row.age),
      passwordHash: row.password_hash,
      isSiteAdmin: Boolean(row.is_site_admin) || row.username === 'admin',
      tasks: decryptTasks(row.tasks).map(normalizeTask),
      settings,
      notifications: JSON.parse(row.notifications || '[]'),
      moderationStatus: row.moderation_status || 'active',
      moderationMessage: row.moderation_message || '',
      moderationUntil: row.moderation_until || ''
    };
  });
}

function initialize(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    age INTEGER NOT NULL,
    password_hash TEXT NOT NULL,
    tasks TEXT NOT NULL DEFAULT '[]',
    modified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  try { db.prepare("ALTER TABLE users ADD COLUMN tasks TEXT NOT NULL DEFAULT '[]'").run(); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
  for (const column of [
    "is_site_admin INTEGER NOT NULL DEFAULT 0",
    "notifications TEXT NOT NULL DEFAULT '[]'",
    "settings TEXT NOT NULL DEFAULT '{}'",
    "moderation_status TEXT NOT NULL DEFAULT 'active'",
    "moderation_message TEXT NOT NULL DEFAULT ''",
    "moderation_until TEXT NOT NULL DEFAULT ''",
    "is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))"
  ]) {
    try { db.prepare(`ALTER TABLE users ADD COLUMN ${column}`).run(); } catch (error) { if (!error.message.includes('duplicate column name')) throw error; }
  }
  try {
    db.prepare("ALTER TABLE users ADD COLUMN modified_at TEXT NOT NULL DEFAULT ''").run();
    db.prepare("UPDATE users SET modified_at = CURRENT_TIMESTAMP WHERE modified_at = ''").run();
  } catch (error) {
    if (!error.message.includes('duplicate column name')) throw error;
  }
}

function persistState(db, users) {
  const userWrite = db.prepare(`INSERT INTO users (id, name, username, age, password_hash, is_site_admin, tasks, notifications, settings, moderation_status, moderation_message, moderation_until, modified_at)
    VALUES (@id, @name, @username, @age, @passwordHash, @isSiteAdmin, @tasks, @notifications, @settings, @moderationStatus, @moderationMessage, @moderationUntil, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      username = excluded.username,
      age = excluded.age,
      password_hash = excluded.password_hash,
      is_site_admin = excluded.is_site_admin,
      tasks = excluded.tasks,
      notifications = excluded.notifications,
      settings = excluded.settings,
      moderation_status = excluded.moderation_status,
      moderation_message = excluded.moderation_message,
      moderation_until = excluded.moderation_until,
      is_active = 1,
      modified_at = CURRENT_TIMESTAMP`);
  const deactivateMissingUsers = db.prepare('UPDATE users SET is_active = 0 WHERE id NOT IN (SELECT value FROM json_each(?))');

  db.transaction(() => {
    const ids = JSON.stringify(users.map((user) => user.id));
    deactivateMissingUsers.run(ids);
    users.forEach((user) => userWrite.run({
    id: user.id,
    name: user.name,
    username: user.username,
    age: Number(user.age),
    passwordHash: user.passwordHash,
    isSiteAdmin: user.isSiteAdmin ? 1 : 0,
    tasks: encryptTasks(user.tasks),
    notifications: JSON.stringify(user.notifications || []),
    settings: JSON.stringify(user.settings || {}),
    moderationStatus: user.moderationStatus || 'active',
    moderationMessage: user.moderationMessage || '',
    moderationUntil: user.moderationUntil || ''
    }));
  })();
}

module.exports = (db) => ({
  init: () => initialize(db),
  all: () => loadUsersFromDatabase(db),
  needsEncryptionMigration: () => taskEncryptionMigrationNeeded,
  persistState: (users) => persistState(db, users)
});
