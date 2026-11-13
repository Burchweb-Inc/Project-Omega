const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createSsoModel = require('../sso/model');

test('SSO clients persist hashed secrets and approved redirect URLs', () => {
  const db = new Database(':memory:');
  const model = createSsoModel(db);
  model.init();
  model.init();

  const created = model.create({
    name: 'Burchweb Notes',
    description: 'A small notes app.',
    redirectUris: 'https://notes.burchweb.com/auth/callback\nhttps://notes.burchweb.com/auth/callback',
    createdBy: 'admin-1'
  });

  assert.match(created.client.clientId, /^lockin_[a-f0-9]{32}$/);
  assert.match(created.clientSecret, /^lks_/);
  assert.equal(created.client.redirectUris.length, 1);
  assert.equal(created.client.secretHash, undefined);
  assert.equal(model.verifyClientSecret(created.client.clientId, created.clientSecret), true);
  assert.equal(model.verifyClientSecret(created.client.clientId, 'wrong-secret'), false);

  const stored = db.prepare('SELECT secret_hash FROM sso_clients WHERE client_id = ?').get(created.client.clientId);
  assert.match(stored.secret_hash, /^sha256:/);
  assert.notEqual(stored.secret_hash, created.clientSecret);

  const rotated = model.rotateSecret(created.client.id);
  assert.notEqual(rotated.clientSecret, created.clientSecret);
  assert.equal(model.verifyClientSecret(created.client.clientId, created.clientSecret), false);
  assert.equal(model.verifyClientSecret(created.client.clientId, rotated.clientSecret), true);

  const withRedirect = model.addRedirectUri(created.client.id, 'https://notes.burchweb.com/other/callback');
  assert.equal(withRedirect.redirectUris.length, 2);
  const withoutRedirect = model.removeRedirectUri(created.client.id, 'https://notes.burchweb.com/other/callback');
  assert.deepEqual(withoutRedirect.redirectUris, ['https://notes.burchweb.com/auth/callback']);

  assert.equal(model.all().length, 1);
  assert.equal(model.delete(created.client.id), true);
  assert.equal(model.delete(created.client.id), false);
  assert.deepEqual(model.all(), []);
  db.close();
});

test('SSO redirect validation only accepts exact web URLs and local HTTP', () => {
  assert.equal(createSsoModel.normalizeRedirectUri('https://app.example.com/callback'), 'https://app.example.com/callback');
  assert.equal(createSsoModel.normalizeRedirectUri('http://localhost:3000/callback'), 'http://localhost:3000/callback');
  assert.throws(() => createSsoModel.normalizeRedirectUri('http://app.example.com/callback'), /https/);
  assert.throws(() => createSsoModel.normalizeRedirectUri('javascript:alert(1)'), /http/);
  assert.throws(() => createSsoModel.normalizeRedirectUri('https://app.example.com/callback#fragment'), /fragment/);
  assert.throws(() => createSsoModel.normalizeRedirectUri('https://user:pass@app.example.com/callback'), /username/);
});
