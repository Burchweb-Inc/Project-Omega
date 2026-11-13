const crypto = require('crypto');

const MAX_REDIRECT_URIS = 10;
const CLIENT_ID_PREFIX = 'lockin_';
const CLIENT_SECRET_PREFIX = 'lks_';

function normalizeClientName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 80) throw new Error('Integration names need 2 to 80 characters.');
  return name;
}

function normalizeDescription(value) {
  const description = String(value || '').trim();
  if (description.length > 300) throw new Error('Descriptions can be up to 300 characters.');
  return description;
}

function normalizeRedirectUri(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2000) throw new Error('Enter a complete redirect URL.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error('Enter a complete redirect URL, including http:// or https://.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Redirect URLs must use http:// or https://.');
  if (parsed.username || parsed.password) throw new Error('Redirect URLs cannot include a username or password.');
  if (parsed.hash) throw new Error('Redirect URLs cannot include a fragment.');
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    throw new Error('Use https:// for redirect URLs outside localhost.');
  }
  return parsed.toString();
}

function normalizeRedirectUris(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const uris = [];
  for (const entry of entries) {
    const trimmed = String(entry || '').trim();
    if (!trimmed) continue;
    const normalized = normalizeRedirectUri(trimmed);
    if (!uris.includes(normalized)) uris.push(normalized);
  }
  if (!uris.length) throw new Error('Add at least one approved redirect URL.');
  if (uris.length > MAX_REDIRECT_URIS) throw new Error(`Add no more than ${MAX_REDIRECT_URIS} redirect URLs.`);
  return uris;
}

function hashSecret(secret) {
  return `sha256:${crypto.createHash('sha256').update(String(secret)).digest('hex')}`;
}

function verifySecret(secret, storedHash) {
  if (typeof secret !== 'string' || !secret || typeof storedHash !== 'string' || !storedHash.startsWith('sha256:')) return false;
  const expected = Buffer.from(storedHash.slice('sha256:'.length), 'hex');
  const actual = crypto.createHash('sha256').update(secret).digest();
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createCredentials() {
  return {
    clientId: `${CLIENT_ID_PREFIX}${crypto.randomBytes(16).toString('hex')}`,
    clientSecret: `${CLIENT_SECRET_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  };
}

function clientFromRow(row) {
  if (!row) return null;
  let redirectUris = [];
  try {
    redirectUris = JSON.parse(row.redirect_uris || '[]');
  } catch (error) {
    redirectUris = [];
  }
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    description: row.description || '',
    redirectUris: Array.isArray(redirectUris) ? redirectUris : [],
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at || ''
  };
}

module.exports = (db) => {
  function getById(id) {
    return clientFromRow(db.prepare('SELECT * FROM sso_clients WHERE id = ?').get(id));
  }

  function getByClientId(clientId) {
    return clientFromRow(db.prepare('SELECT * FROM sso_clients WHERE client_id = ?').get(String(clientId || '')));
  }

  function all() {
    return db.prepare('SELECT * FROM sso_clients ORDER BY created_at DESC, name ASC').all().map(clientFromRow);
  }

  function init() {
    db.prepare(`CREATE TABLE IF NOT EXISTS sso_clients (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      secret_hash TEXT NOT NULL,
      redirect_uris TEXT NOT NULL DEFAULT '[]',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    )`).run();
  }

  function create({ name, description, redirectUris, createdBy }) {
    const normalizedName = normalizeClientName(name);
    const normalizedDescription = normalizeDescription(description);
    const approvedUris = normalizeRedirectUris(redirectUris);
    const internalId = crypto.randomBytes(12).toString('hex');
    const { clientId, clientSecret } = createCredentials();
    db.prepare(`INSERT INTO sso_clients (id, client_id, name, description, secret_hash, redirect_uris, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      internalId,
      clientId,
      normalizedName,
      normalizedDescription,
      hashSecret(clientSecret),
      JSON.stringify(approvedUris),
      String(createdBy || '')
    );
    return { client: getById(internalId), clientSecret };
  }

  function rotateSecret(id) {
    const client = getById(id);
    if (!client) return null;
    const clientSecret = `${CLIENT_SECRET_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    db.prepare("UPDATE sso_clients SET secret_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(hashSecret(clientSecret), id);
    return { client: getById(id), clientSecret };
  }

  function addRedirectUri(id, value) {
    const client = getById(id);
    if (!client) return null;
    const uri = normalizeRedirectUri(value);
    if (client.redirectUris.includes(uri)) return client;
    if (client.redirectUris.length >= MAX_REDIRECT_URIS) throw new Error(`This integration already has ${MAX_REDIRECT_URIS} redirect URLs.`);
    const redirectUris = [...client.redirectUris, uri];
    db.prepare("UPDATE sso_clients SET redirect_uris = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(redirectUris), id);
    return getById(id);
  }

  function removeRedirectUri(id, value) {
    const client = getById(id);
    if (!client) return null;
    const uri = normalizeRedirectUri(value);
    const redirectUris = client.redirectUris.filter((entry) => entry !== uri);
    if (redirectUris.length === client.redirectUris.length) return client;
    if (!redirectUris.length) throw new Error('Keep at least one approved redirect URL.');
    db.prepare("UPDATE sso_clients SET redirect_uris = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(JSON.stringify(redirectUris), id);
    return getById(id);
  }

  function deleteClient(id) {
    return db.prepare('DELETE FROM sso_clients WHERE id = ?').run(id).changes > 0;
  }

  function verifyClientSecret(clientId, secret) {
    const row = db.prepare('SELECT secret_hash FROM sso_clients WHERE client_id = ?').get(String(clientId || ''));
    return Boolean(row) && verifySecret(secret, row.secret_hash);
  }

  function markUsed(clientId) {
    db.prepare('UPDATE sso_clients SET last_used_at = CURRENT_TIMESTAMP WHERE client_id = ?').run(clientId);
  }

  return {
    init,
    all,
    getByClientId,
    create,
    rotateSecret,
    addRedirectUri,
    removeRedirectUri,
    delete: deleteClient,
    verifyClientSecret,
    markUsed
  };
};

module.exports.normalizeRedirectUri = normalizeRedirectUri;
