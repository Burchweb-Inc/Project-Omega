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
  assert.match(html, /<link rel="icon" href="\/media\/favicon\.ico" type="image\/x-icon">/);
  assert.match(html, /if \('serviceWorker' in navigator && !false\)/);
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
