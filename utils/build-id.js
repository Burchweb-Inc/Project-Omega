const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const HALF_BITS = 25n;
const HALF_MASK = (1n << HALF_BITS) - 1n;
const DOMAIN_LIMIT = 10n ** 15n;
const BUILD_NUMBER_BITS = 17n;
const MAX_BUILD_NUMBER = (1 << Number(BUILD_NUMBER_BITS)) - 1;
const TIMESTAMP_BITS = 32n;
const TIMESTAMP_MASK = (1n << 32n) - 1n;
const ROUNDS = 8;

function loadOrCreateKey(keyPath) {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error(`${keyPath} must contain exactly 32 bytes.`);
    fs.chmodSync(keyPath, 0o600);
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const key = crypto.randomBytes(32);
  try {
    fs.writeFileSync(keyPath, key, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return loadOrCreateKey(keyPath);
}

function roundValue(value, round, key) {
  const digest = crypto.createHmac('sha256', key).update(`build-id:v1:${round}:${value}`).digest();
  return BigInt(digest.readUInt32BE(0)) & HALF_MASK;
}

function permute(value, key, decrypt = false) {
  let left = (value >> HALF_BITS) & HALF_MASK;
  let right = value & HALF_MASK;
  if (decrypt) {
    for (let round = ROUNDS - 1; round >= 0; round -= 1) {
      const previousRight = left;
      const previousLeft = right ^ roundValue(previousRight, round, key);
      left = previousLeft;
      right = previousRight;
    }
  } else {
    for (let round = 0; round < ROUNDS; round += 1) {
      const nextLeft = right;
      const nextRight = left ^ roundValue(right, round, key);
      left = nextLeft;
      right = nextRight;
    }
  }
  return (left << HALF_BITS) | right;
}

function transformIntoDecimalDomain(value, key, decrypt = false) {
  let transformed = value;
  // Cycle walking keeps the reversible permutation inside the 15-digit domain.
  do {
    transformed = permute(transformed, key, decrypt);
  } while (transformed >= DOMAIN_LIMIT);
  return transformed;
}

function initializeBuildIds(db, keyPath) {
  const key = loadOrCreateKey(keyPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS build_id_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_number INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO build_id_sequence (id, last_number) VALUES (1, 0);
    CREATE TABLE IF NOT EXISTS build_id_records (
      id TEXT PRIMARY KEY,
      build_number INTEGER NOT NULL UNIQUE,
      built_at TEXT NOT NULL,
      environment TEXT NOT NULL,
      app_version TEXT NOT NULL,
      node_version TEXT NOT NULL,
      platform TEXT NOT NULL,
      architecture TEXT NOT NULL
    );
  `);

  const createBuild = db.transaction((details) => {
    const buildNumber = db.prepare('SELECT last_number FROM build_id_sequence WHERE id = 1').get().last_number + 1;
    if (buildNumber > MAX_BUILD_NUMBER) throw new Error(`Build number limit of ${MAX_BUILD_NUMBER} has been reached.`);

    const builtAt = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS built_at").get().built_at;
    const timestampSeconds = BigInt(Math.floor(Date.parse(builtAt) / 1000));
    if (timestampSeconds > TIMESTAMP_MASK) throw new Error('Build timestamp is outside the supported range.');

    const payload = (BigInt(buildNumber) << TIMESTAMP_BITS) | timestampSeconds;
    const id = transformIntoDecimalDomain(payload, key).toString().padStart(15, '0');
    db.prepare('UPDATE build_id_sequence SET last_number = ? WHERE id = 1').run(buildNumber);
    db.prepare(`INSERT INTO build_id_records
      (id, build_number, built_at, environment, app_version, node_version, platform, architecture)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      buildNumber,
      builtAt,
      details.environment,
      details.appVersion,
      details.nodeVersion,
      details.platform,
      details.architecture
    );
    return {
      id,
      buildNumber,
      builtAt,
      environment: details.environment,
      appVersion: details.appVersion,
      nodeVersion: details.nodeVersion,
      platform: details.platform,
      architecture: details.architecture
    };
  });

  function decode(id) {
    if (typeof id !== 'string' || !/^\d{15}$/.test(id)) return null;
    const encrypted = BigInt(id);
    const payload = transformIntoDecimalDomain(encrypted, key, true);
    const buildNumber = Number(payload >> TIMESTAMP_BITS);
    const timestampSeconds = payload & TIMESTAMP_MASK;
    const record = db.prepare('SELECT * FROM build_id_records WHERE id = ?').get(id);
    if (!record
      || record.build_number !== buildNumber
      || BigInt(Math.floor(Date.parse(record.built_at) / 1000)) !== timestampSeconds) return null;

    return {
      id: record.id,
      buildNumber: record.build_number,
      builtAt: record.built_at,
      environment: record.environment,
      appVersion: record.app_version,
      nodeVersion: record.node_version,
      platform: record.platform,
      architecture: record.architecture
    };
  }

  return {
    createBuild,
    decode
  };
}

module.exports = { initializeBuildIds };
