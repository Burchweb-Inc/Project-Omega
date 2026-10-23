const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeBuildIds } = require('../utils/build-id');

test('build IDs are persistent, sequential, and decode to their recorded details', (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-omega-build-id-'));
  const dbPath = path.join(dataDir, 'builds.db');
  const keyPath = path.join(dataDir, 'new-runtime-data', '.build-id-key');
  let db = new Database(dbPath);
  const firstModel = initializeBuildIds(db, keyPath);
  assert.equal(fs.statSync(keyPath).size, 32);
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600);
  const firstBuild = firstModel.createBuild({
    environment: 'development',
    appVersion: '1.0.0',
    nodeVersion: 'v22.0.0',
    platform: 'darwin',
    architecture: 'arm64'
  });
  db.close();

  fs.unlinkSync(keyPath);
  db = new Database(dbPath);
  const secondModel = initializeBuildIds(db, keyPath);
  assert.equal(fs.statSync(keyPath).size, 32);
  const secondBuild = secondModel.createBuild({
    environment: 'production',
    appVersion: '1.0.1',
    nodeVersion: 'v22.1.0',
    platform: 'linux',
    architecture: 'x64'
  });

  t.after(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  assert.match(firstBuild.id, /^\d{15}$/);
  assert.match(secondBuild.id, /^\d{15}$/);
  assert.notEqual(firstBuild.id, secondBuild.id);
  assert.equal(firstBuild.buildNumber, 1);
  assert.equal(secondBuild.buildNumber, 2);
  assert.equal(secondModel.decode(firstBuild.id), null);
  assert.deepEqual(secondModel.decode(secondBuild.id), secondBuild);
  assert.equal(secondModel.decode('123'), null);
  assert.equal(secondModel.decode(`${secondBuild.id.slice(0, -1)}${(Number(secondBuild.id.at(-1)) + 1) % 10}`), null);
});
