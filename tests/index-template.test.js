const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

test('renders the landing product tour with its software screenshots', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'landing',
    view: 'landing',
    user: null,
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/'
  });

  assert.match(html, /data-landing-tour/);
  assert.ok((html.match(/data-landing-reveal/g) || []).length >= 40);
  assert.match(html, /class="landing-hero-visual" data-landing-reveal="right"/);
  assert.match(html, /data-user-authenticated="false"/);
  assert.match(html, /data-landing-auth-link/);
  assert.match(html, /src="\/media\/landing\/overview-screen\.png"/);
  assert.match(html, /src="\/media\/landing\/course-feed\.png"/);
  assert.match(html, /src="\/media\/landing\/personal-todo\.png"/);
  assert.match(html, /src="\/media\/landing\/academic-calendar\.png"/);
  assert.doesNotMatch(html, /landing-tour-total|data-tour-current/);
  assert.match(html, /type="module" src="\/js\/landing\.js"/);
});

test('renders a collaborative study section with the uploaded image', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'landing',
    view: 'landing',
    user: null,
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/'
  });

  assert.match(html, /id="collaboration"/);
  assert.match(html, /A big room for everyone\. Breakouts for the real work\./);
  assert.match(html, /src="\/media\/landing\/collab\.png"/);
  assert.match(html, /alt="Students gathered around a laptop during a collaborative study session"/);
  assert.match(html, /href="\/signup"[^>]*>Start a study group/);
});

test('renders a moderation section with AI detection and human review', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'landing',
    view: 'landing',
    user: null,
    selectedOrg: null,
    canonicalUrl: 'http://localhost:3000/'
  });

  assert.match(html, /<a href="#moderation"/);
  assert.match(html, /id="moderation" aria-labelledby="landing-moderation-title"/);
  assert.match(html, /AI-powered detection/);
  assert.match(html, /Human-led decisions/);
  assert.match(html, /src="\/media\/landing\/collab\.png"/);
  assert.match(html, /Moderation workflow: AI detection flags a concern for a human moderator to review/);
  assert.match(html, /href="\/about"[^>]*>Learn about LockIn/);
});

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
  assert.match(html, /data-user-authenticated="true"/);
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

test('personalizes opengraph artwork and twitter card for org pages', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'org',
    view: 'org',
    user: authenticatedUser,
    orgs: [],
    canEdit: () => false,
    selectedOrg: { id: 'org-1', name: 'Biology', slug: 'biology', description: 'Study biology together.', image: 'https://lockedin.burchweb.com/media/biology.png', courses: [], members: [] },
    course: null,
    canonicalUrl: 'https://lockedin.burchweb.com/org/org-1',
    error: null,
    notifications: [],
    buildInfo: { id: 'build-1' },
    member: { role: 'admin' },
    renderGateBanner: null
  });

  assert.match(html, /<meta property="og:image" content=/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="twitter:image" content=/);
});

test('personalizes opengraph artwork and twitter card for course pages', async () => {
  const html = await ejs.renderFile('views/index.ejs', {
    page: 'course',
    view: 'course',
    user: authenticatedUser,
    orgs: [],
    canEdit: () => false,
    selectedOrg: { id: 'org-1', name: 'Biology', slug: 'biology', description: 'Study biology together.', courses: [] },
    course: { id: 'course-1', name: 'Cell Structure', code: 'BIO', color: '#ef8354', image: 'https://lockedin.burchweb.com/media/cell-structure.png', items: [], board: [], resources: [] },
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

  assert.match(html, /og:title" content="LockIn/);
  assert.match(html, /og:description" content="Cell Structure/);
  assert.match(html, /og:image" content=/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
});

test('falls back to the generic opengraph copy when no org context exists', async () => {
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

  assert.match(html, /og:title" content="LockIn/);
  assert.match(html, /og:image" content="https:/);
});
