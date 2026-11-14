const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

test('renders ordinary auth pages without a theme preview local', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'login',
    view: 'auth-page',
    user: null,
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/login',
    error: null,
    next: '/dashboard',
    snarkyTypePending: false,
    snarkyTypeConfigured: false
  });

  assert.match(html, /data-theme-preview="false"/);
  assert.match(html, /if \('serviceWorker' in navigator && !false\)/);
});

test('renders the SSO consent form with a same-origin action URL', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'sso-authorize',
    view: 'sso-authorize',
    user: { name: 'Student One', username: 'student1' },
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/oauth/authorize',
    ssoError: null,
    ssoClient: { name: 'LockIn Study' },
    authorizationRequest: { id: 'request-1' },
    redirectHost: 'localhost:3200',
    scopes: ['openid', 'profile'],
    themePreview: null
  });

  assert.match(html, /<form class="sso-consent-actions" action="\/oauth\/authorize" method="post">/);
});

test('embeds authenticated preview CSS in the page for sandboxed theme previews', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'login',
    view: 'auth-page',
    user: null,
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/login',
    error: null,
    next: '/dashboard',
    snarkyTypePending: false,
    snarkyTypeConfigured: false,
    themePreview: { previewToken: 'preview-token' },
    themePreviewCss: 'body{background-color:#f4ead8 !important}'
  });

  assert.match(html, /<style id="lockin-theme-preview-styles">body\{background-color:#f4ead8 !important\}<\/style>/);
  assert.doesNotMatch(html, /href="\/themes\/active\.css"/);
});

test('loads dynamic theme node annotations on authenticated app pages', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'login',
    view: 'auth-page',
    user: { settings: {} },
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/login',
    error: null,
    next: '/dashboard',
    snarkyTypePending: false,
    snarkyTypeConfigured: false
  });

  assert.match(html, /<script src="\/js\/theme-application\.js"><\/script>/);
  assert.doesNotMatch(html, /<script src="\/js\/theme-preview\.js"><\/script>/);
});
