const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const createSsoModel = require('../sso/model');
const createOidcSigner = require('../sso/oidc');
const registerSsoRoutes = require('../sso/routes');

function cookieHeader(response) {
  const values = response.headers.getSetCookie ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map((value) => value.split(';')[0]).join('; ');
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const [key, ...value] = part.trim().split('=');
    return [key, decodeURIComponent(value.join('='))];
  }));
}

function rawPost(baseUrl, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL('/oauth/authorize', baseUrl), {
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response));
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('LockIn SSO completes an authorization code flow with PKCE and rotates secrets', async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-oidc-'));
  const db = new Database(':memory:');
  const ssoModel = createSsoModel(db);
  ssoModel.init();
  const oidcSigner = createOidcSigner(dataDir);
  const users = [
    { id: 'user-1', name: 'Student One', username: 'student1' },
    { id: 'user-2', name: 'Student Two', username: 'student2' },
    { id: 'admin-1', name: 'Site Admin', username: 'admin', isSiteAdmin: true }
  ];
  const orgModel = {
    copyCandidatesForUser: (userId) => userId === 'user-1' ? [{
      id: 'group-1',
      name: 'Biology study group',
      description: 'Weekly review',
      members: [{ userId: 'user-1', role: 'admin' }, { userId: 'user-2', role: 'viewer' }]
    }] : []
  };
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((request, _response, next) => {
    request.user = users.find((user) => user.id === request.get('x-user')) || null;
    next();
  });
  const requireUser = (request, response, next) => request.user ? next() : response.status(401).send('Sign in first.');
  const requireSiteAdmin = (request, response, next) => request.user?.isSiteAdmin ? next() : response.status(403).send('Site admin access required.');
  const render = (_request, response, page, data = {}) => response.json({ page, ...data });
  const sendMutation = (_request, response, payload, fallback) => response.status(payload.error ? 400 : 200).json({ ...payload, fallback });
  registerSsoRoutes({
    app,
    ssoModel,
    oidcSigner,
    users,
    orgModel,
    publicOrigin: () => 'https://issuer.test',
    requireUser,
    requireSiteAdmin,
    render,
    sendMutation,
    parseCookies
  });

  const server = app.listen(0);
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, user, options = {}) => fetch(`${baseUrl}${url}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      Origin: 'https://issuer.test',
      'x-user': user || '',
      ...options.headers
    }
  });

  const created = ssoModel.create({ name: 'Burchweb Notes', redirectUris: 'https://notes.test/auth/callback', createdBy: 'admin-1' });
  const client = created.client;
  const clientSecret = created.clientSecret;
  const redirectUri = 'https://notes.test/auth/callback';
  const verifier = 'verifier-value-that-is-long-enough-for-pkce-123';
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  const authorize = await request(`/oauth/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20groups&state=state-123&nonce=nonce-123&code_challenge=${challenge}&code_challenge_method=S256`, 'user-1');
  assert.equal(authorize.status, 200);
  const authorizePage = await authorize.json();
  assert.equal(authorizePage.page, 'sso-authorize');
  assert.equal(authorizePage.redirectHost, 'notes.test');
  assert.equal(authorize.headers.get('content-security-policy'), "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://notes.test");
  assert.equal(authorize.headers.get('referrer-policy'), 'same-origin');
  assert.equal(authorize.headers.get('cache-control'), 'no-store');
  const stateCookie = cookieHeader(authorize);
  assert.match(stateCookie, /lockin_sso_request=/);

  const localCreated = ssoModel.create({ name: 'LockIn Study', redirectUris: 'http://localhost:3200/auth/lockin/callback', createdBy: 'admin-1' });
  const localAuthorize = await request(`/oauth/authorize?client_id=${localCreated.client.clientId}&redirect_uri=${encodeURIComponent(localCreated.client.redirectUris[0])}&response_type=code&scope=openid%20profile&state=local-state`, 'user-1');
  assert.equal(localAuthorize.headers.get('content-security-policy'), "frame-ancestors 'none'; base-uri 'self'; form-action 'self' http://localhost:3200");
  assert.doesNotMatch(localAuthorize.headers.get('content-security-policy'), /localhost:\*/);

  const crossSiteApproval = await request('/oauth/authorize', 'user-1', {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: stateCookie, Origin: 'https://evil.test' },
    body: new URLSearchParams({ request_id: authorizePage.authorizationRequest.id, decision: 'allow' })
  });
  assert.equal(crossSiteApproval.status, 403);

  const deniedWithoutCookie = await request('/oauth/authorize', 'user-1', {
    method: 'POST',
    redirect: 'manual',
    body: new URLSearchParams({ request_id: authorizePage.authorizationRequest.id, decision: 'allow' })
  });
  assert.equal(deniedWithoutCookie.status, 400);

  const approval = await request('/oauth/authorize', 'user-1', {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: stateCookie, Origin: 'https://issuer.test' },
    body: new URLSearchParams({ request_id: authorizePage.authorizationRequest.id, decision: 'allow' })
  });
  assert.equal(approval.status, 302);
  const callback = new URL(approval.headers.get('location'));
  assert.equal(callback.origin, 'https://notes.test');
  assert.equal(callback.pathname, '/auth/callback');
  assert.equal(callback.searchParams.get('state'), 'state-123');
  const code = callback.searchParams.get('code');
  assert.ok(code);

  const nullOriginAuthorize = await request(`/oauth/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid&state=null-origin-state`, 'user-1');
  const nullOriginPage = await nullOriginAuthorize.json();
  const nullOriginApproval = await rawPost(baseUrl, {
    'Content-Type': 'application/x-www-form-urlencoded',
    Cookie: cookieHeader(nullOriginAuthorize),
    'x-user': 'user-1',
    Origin: 'null',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'navigate'
  }, `request_id=${encodeURIComponent(nullOriginPage.authorizationRequest.id)}&decision=allow`);
  assert.equal(nullOriginApproval.statusCode, 302);

  const tokenResponse = await request('/oauth/token', '', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
  });
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  assert.equal(token.token_type, 'Bearer');
  assert.match(token.access_token, /^[A-Za-z0-9_-]+$/);
  assert.match(token.id_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const [header, payload, signature] = token.id_token.split('.');
  assert.equal(crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), oidcSigner.publicKey, Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  assert.equal(claims.iss, 'https://issuer.test');
  assert.equal(claims.aud, client.clientId);
  assert.equal(claims.sub, 'user-1');
  assert.equal(claims.nonce, 'nonce-123');
  assert.equal(claims.name, 'Student One');
  assert.equal(claims.preferred_username, 'student1');
  assert.deepEqual(claims.groups, [{
    id: 'group-1',
    name: 'Biology study group',
    description: 'Weekly review',
    members: [
      { sub: 'user-1', name: 'Student One', preferred_username: 'student1', role: 'admin' },
      { sub: 'user-2', name: 'Student Two', preferred_username: 'student2', role: 'viewer' }
    ]
  }]);

  const userinfo = await request('/oauth/userinfo', '', { headers: { Authorization: `Bearer ${token.access_token}` } });
  assert.equal(userinfo.status, 200);
  assert.deepEqual(await userinfo.json(), {
    sub: 'user-1',
    name: 'Student One',
    preferred_username: 'student1',
    groups: [{
      id: 'group-1',
      name: 'Biology study group',
      description: 'Weekly review',
      members: [
        { sub: 'user-1', name: 'Student One', preferred_username: 'student1', role: 'admin' },
        { sub: 'user-2', name: 'Student Two', preferred_username: 'student2', role: 'viewer' }
      ]
    }]
  });

  users[0].moderationStatus = 'suspended';
  const suspendedUserinfo = await request('/oauth/userinfo', '', { headers: { Authorization: `Bearer ${token.access_token}` } });
  assert.equal(suspendedUserinfo.status, 401);
  assert.equal((await suspendedUserinfo.json()).error, 'invalid_token');
  users[0].moderationStatus = 'active';

  const replay = await request('/oauth/token', '', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier })
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');

  const shortVerifierAuthorize = await request(`/oauth/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid&state=short-verifier-state&code_challenge=${challenge}&code_challenge_method=S256`, 'user-1');
  assert.equal(shortVerifierAuthorize.status, 200);
  const shortVerifierPage = await shortVerifierAuthorize.json();
  const shortVerifierApproval = await request('/oauth/authorize', 'user-1', {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookieHeader(shortVerifierAuthorize) },
    body: new URLSearchParams({ request_id: shortVerifierPage.authorizationRequest.id, decision: 'allow' })
  });
  assert.equal(shortVerifierApproval.status, 302);
  const shortVerifierCode = new URL(shortVerifierApproval.headers.get('location')).searchParams.get('code');
  assert.ok(shortVerifierCode);
  const shortVerifierResponse = await request('/oauth/token', '', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${client.clientId}:${clientSecret}`).toString('base64')}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: shortVerifierCode, redirect_uri: redirectUri, code_verifier: 'too-short' })
  });
  assert.equal(shortVerifierResponse.status, 400);
  assert.equal((await shortVerifierResponse.json()).error, 'invalid_grant');

  const badRedirect = await request(`/oauth/authorize?client_id=${client.clientId}&redirect_uri=${encodeURIComponent('https://evil.test/callback')}&response_type=code`, 'user-1');
  assert.equal(badRedirect.status, 400);
  assert.equal((await badRedirect.json()).page, 'sso-authorize');

  const discovery = await request('/.well-known/openid-configuration', '');
  assert.equal(discovery.status, 200);
  const discoveryData = await discovery.json();
  assert.equal(discoveryData.issuer, 'https://issuer.test');
  assert.equal(discoveryData.authorization_endpoint, 'https://issuer.test/oauth/authorize');
  assert.deepEqual(discoveryData.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(discoveryData.scopes_supported, ['openid', 'profile', 'groups']);

  const crossSiteAdmin = await request('/site-admin/developers/clients', 'admin-1', {
    method: 'POST',
    headers: { Origin: 'https://evil.test' },
    body: new URLSearchParams({ name: 'Cross-site App', redirectUris: 'https://cross-site.test/callback' })
  });
  assert.equal(crossSiteAdmin.status, 403);

  const createdThroughAdmin = await request('/site-admin/developers/clients', 'admin-1', {
    method: 'POST',
    body: new URLSearchParams({ name: 'Second App', description: 'Another integration.', redirectUris: 'https://second.test/callback' })
  });
  assert.equal(createdThroughAdmin.status, 200);
  const createdPage = await createdThroughAdmin.json();
  assert.equal(createdPage.page, 'sso-client-secret');
  assert.match(createdPage.clientSecret, /^lks_/);

  const rotate = await request(`/site-admin/developers/clients/${client.clientId}/rotate-secret`, 'admin-1', { method: 'POST' });
  assert.equal(rotate.status, 200);
  const rotatedPage = await rotate.json();
  assert.equal(rotatedPage.page, 'sso-client-secret');
  assert.match(rotatedPage.clientSecret, /^lks_/);
  assert.equal(ssoModel.verifyClientSecret(client.clientId, clientSecret), false);
  assert.equal(ssoModel.verifyClientSecret(client.clientId, rotatedPage.clientSecret), true);

  const revokedUserinfo = await request('/oauth/userinfo', '', { headers: { Authorization: `Bearer ${token.access_token}` } });
  assert.equal(revokedUserinfo.status, 401);
  assert.equal((await revokedUserinfo.json()).error, 'invalid_token');

  const forbiddenAdmin = await request('/site-admin/developers/clients', 'user-1', {
    method: 'POST',
    body: new URLSearchParams({ name: 'Nope', redirectUris: 'https://nope.test/callback' })
  });
  assert.equal(forbiddenAdmin.status, 403);
});
