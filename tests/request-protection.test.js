const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const http = require('node:http');
const createRequestProtection = require('../server/request-protection');

async function startServer(options = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(createRequestProtection({
    getOrigin: () => 'https://issuer.test',
    cleanupIntervalMs: 0,
    ...options
  }));
  app.post('/save', (_request, response) => response.json({ saved: true }));
  app.post('/oauth/authorize', (_request, response) => response.json({ authorized: true }));
  app.post('/login', (_request, response) => response.json({ signedIn: true }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function post(baseUrl, path, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers
    },
    body: ''
  });
}

function rawPost(baseUrl, path, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(path, baseUrl);
    const request = http.request(target, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('unsafe requests require a same-origin browser context', async (context) => {
  const server = await startServer();
  context.after(server.close);

  assert.equal((await post(server.baseUrl, '/save')).status, 200);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test' })).status, 403);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', Origin: 'https://issuer.test' })).status, 200);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', Referer: 'https://issuer.test/settings' })).status, 200);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', Referer: 'https://evil.test/settings' })).status, 403);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', Origin: 'null' })).status, 403);
  assert.equal((await post(server.baseUrl, '/oauth/authorize', {
    Cookie: 'lockin_sso_request=request-1',
    Origin: 'null',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate'
  })).status, 403);
  const consent = await rawPost(server.baseUrl, '/oauth/authorize', {
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: 'lockin_sso_request=request-1',
    Origin: 'null',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate'
  }, 'request_id=request-1');
  assert.equal(consent.status, 200, consent.body);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', 'Sec-Fetch-Site': 'same-site' })).status, 403);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', 'Sec-Fetch-Site': 'none' })).status, 200);
  assert.equal((await post(server.baseUrl, '/save', { Cookie: 'session=test', 'X-Live-Request': 'true' })).status, 200);
  assert.equal((await post(server.baseUrl, '/save', { Origin: 'https://evil.test' })).status, 403);
});

test('mutation rate limits are per IP and reset after the window', async (context) => {
  let timestamp = 1000;
  const server = await startServer({
    mutationLimit: 2,
    authLimit: 10,
    windowMs: 60_000,
    now: () => timestamp
  });
  context.after(server.close);
  const headers = { Origin: 'https://issuer.test' };

  assert.equal((await post(server.baseUrl, '/save', headers)).status, 200);
  assert.equal((await post(server.baseUrl, '/save', headers)).status, 200);
  const limited = await post(server.baseUrl, '/save', { ...headers, 'X-Live-Request': 'true', Accept: 'application/json' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.equal(limited.headers.get('ratelimit-remaining'), '0');
  assert.equal((await limited.json()).error, 'Too many requests. Wait a moment and try again.');

  timestamp += 60_001;
  assert.equal((await post(server.baseUrl, '/save', headers)).status, 200);
});

test('auth and SSO routes use the stricter rate-limit bucket', async (context) => {
  const server = await startServer({ mutationLimit: 10, authLimit: 1 });
  context.after(server.close);
  const headers = { Origin: 'https://issuer.test' };

  assert.equal((await post(server.baseUrl, '/login', headers)).status, 200);
  const limited = await post(server.baseUrl, '/login', headers);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});
