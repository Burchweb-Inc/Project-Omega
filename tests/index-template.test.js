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

const authenticatedUser = {
  id: 'user-1',
  name: 'Ada Lovelace',
  username: 'ada',
  settings: {},
  tasks: [],
  moderationStatus: 'active',
  notifications: []
};

test('personalizes opengraph for org pages', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'org',
    view: 'org',
    user: authenticatedUser,
    orgs: [],
    canEdit: () => false,
    selectedOrg: { id: 'org-1', name: 'Biology', slug: 'biology', description: 'Study biology together.', courses: [], members: [] },
    course: null,
    canonicalUrl: 'https://lockedin.burchweb.com/org/org-1',
    error: null,
    notifications: [],
    buildInfo: { id: 'build-1' },
    member: { role: 'admin' },
    renderGateBanner: null
  });

  assert.match(html, /<meta property=\"og:title\" content=\"LockIn \| Biology\">/);
  assert.match(html, /<meta property=\"og:description\" content=\"Study biology together\.">/);
  assert.match(html, /<meta property=\"og:url\" content=\"https:\/\/lockedin\.burchweb\.com\/org\/org-1\">/);
});

test('personalizes opengraph for course pages with the course and org', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'course',
    view: 'course',
    user: authenticatedUser,
    orgs: [],
    canEdit: () => false,
    selectedOrg: { id: 'org-1', name: 'Biology', slug: 'biology', description: 'Study biology together.', courses: [] },
    course: { id: 'course-1', name: 'Cell Structure', code: 'BIO', color: '#ef8354', items: [], board: [], resources: [] },
    canonicalUrl: 'https://lockedin.burchweb.com/org/org-1/course/course-1',
    error: null,
    notifications: [],
    buildInfo: { id: 'build-1' },
    member: { role: 'admin' },
    renderGateBanner: null,
    canManageItem: () => false,
    copyDestinations: [],
    courseTimezone: 'UTC',
    courseDateLocale: 'en-US',
    formatCourseDate: (value) => String(value),
    selectedCourseDay: 'A'
  });

  assert.match(html, /<meta property=\"og:title\" content=\"LockIn \| Biology \| Cell Structure\">/);
  assert.match(html, /<meta property=\"og:description\" content=\"Cell Structure · Biology\">/);
  assert.match(html, /<meta property=\"og:url\" content=\"https:\/\/lockedin\.burchweb\.com\/org\/org-1\/course\/course-1\">/);
});
