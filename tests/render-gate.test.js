const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const registerRenderGateRoutes = require('../beta-tests/routes');
const { isSymbolOnlyPassword } = registerRenderGateRoutes;
const renderGateClient = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'render-gate.js'), 'utf8');

test('submits gate forms with the URL-encoded body format parsed by Express', () => {
  assert.match(renderGateClient, /body:\s*new URLSearchParams\(new FormData\(form\)\)/);
});

function createHarness(user = { id: 'user-1', settings: { betaTools: true }, tasks: [{ done: true }] }, options = {}) {
  const handlers = {};
  const app = {
    get(route, handler) { handlers[`GET ${route}`] = handler; },
    post(route, handler) { handlers[`POST ${route}`] = handler; }
  };
  const consumeNotice = registerRenderGateRoutes({
    app,
    rootDir: path.join(__dirname, '..'),
    currentUser: (request) => request.user,
    refreshModerationStatus: () => 'active',
    ...options,
    render: (request, response, page, locals) => {
      response.rendered = { page, locals };
      return response;
    }
  });

  function request(method, body = {}, overrides = {}) {
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      redirect(location) { this.redirected = location; return this; },
      sendFile(file) { this.file = file; return this; },
      type(value) { this.contentType = value; return this; },
      vary(value) { this.varyValue = value; return this; },
      end() { this.ended = true; return this; }
    };
    const req = {
      user,
      body,
      headers: {},
      acceptsEncodings: () => false,
      ...overrides
    };
    handlers[`${method} /beta-tests/3drender`](req, response, (error) => { throw error; });
    return response;
  }

  return { request, consumeNotice, user };
}

function submitCaptcha(harness, response) {
  const { flowId, captcha } = response.rendered.locals;
  return harness.request('POST', {
    flowId,
    answer: String(captcha.left + captcha.right)
  });
}

test('want access? prove yourself worthy of the holy 3d test', () => {
  const harness = createHarness();
  let response = harness.request('GET');
  assert.equal(response.rendered.page, 'render-gate');
  assert.equal(response.rendered.locals.captchaAmount, 3);

  response = submitCaptcha(harness, response);
  assert.equal(response.rendered.locals.captchaIndex, 1);
  response = submitCaptcha(harness, response);
  assert.equal(response.rendered.locals.captchaIndex, 2);
  response = submitCaptcha(harness, response);
  assert.equal(response.rendered.locals.renderGateStep, 'password');

  response = harness.request('POST', {
    flowId: response.rendered.locals.flowId,
    password: '!*^*&^'
  });
  assert.equal(response.file, path.join(__dirname, '..', 'views', 'beta-tests', '3drender', 'index.html'));
  assert.equal(response.headers['Cache-Control'], 'private, no-store');
  assert.equal(harness.consumeNotice(harness.user.id), null);
});

test('failed captcha redirects home and exposes a one-time notice', () => {
  const harness = createHarness();
  const challenge = harness.request('GET');
  const response = harness.request('POST', {
    flowId: challenge.rendered.locals.flowId,
    answer: 'wrong'
  });
  assert.equal(response.redirected, '/');
  assert.match(harness.consumeNotice(harness.user.id), /get back to work/);
  assert.equal(harness.consumeNotice(harness.user.id), null);
});

test('blocks incomplete todos after the captcha sequence', () => {
  const harness = createHarness({
    id: 'user-2',
    settings: { betaTools: true },
    tasks: [{ done: true }, { done: false }]
  });
  let response = harness.request('GET');
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  assert.equal(response.redirected, '/');
  assert.match(harness.consumeNotice(harness.user.id), /get back to work/);
});

test('rejects passwords containing letters, numbers, or whitespace', () => {
  const harness = createHarness();
  let response = harness.request('GET');
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = harness.request('POST', {
    flowId: response.rendered.locals.flowId,
    password: 'ggg4=NO'
  });
  assert.equal(response.redirected, '/');
  assert.match(harness.consumeNotice(harness.user.id), /get back to work/);
});

test('accepts punctuation and symbol characters only', () => {
  assert.equal(isSymbolOnlyPassword('!*^*&^'), true);
  assert.equal(isSymbolOnlyPassword('✓€'), true);
  assert.equal(isSymbolOnlyPassword(''), false);
  assert.equal(isSymbolOnlyPassword('abc'), false);
  assert.equal(isSymbolOnlyPassword('42'), false);
  assert.equal(isSymbolOnlyPassword('!* *'), false);
  assert.equal(isSymbolOnlyPassword('\u0301'), false);
});

test('requires every todo to be explicitly completed', () => {
  const { hasCompletedTodos } = registerRenderGateRoutes;
  assert.equal(hasCompletedTodos({ tasks: [{ done: true }] }), true);
  assert.equal(hasCompletedTodos({ tasks: [] }), true);
  assert.equal(hasCompletedTodos({ tasks: [{ done: 'true' }] }), false);
  assert.equal(hasCompletedTodos({ tasks: [{ done: false }] }), false);
});

test('checks todos again immediately before opening the test', () => {
  const harness = createHarness();
  let response = harness.request('GET');
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  harness.user.tasks[0].done = false;
  response = harness.request('POST', {
    flowId: response.rendered.locals.flowId,
    password: '!*^*&^'
  });
  assert.equal(response.redirected, '/');
  assert.equal(response.file, undefined);
});

test('locks gate attempts after five failures during the failure window', () => {
  const harness = createHarness();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const challenge = harness.request('GET');
    harness.request('POST', {
      flowId: challenge.rendered.locals.flowId,
      answer: 'wrong'
    });
  }
  const locked = harness.request('GET');
  assert.equal(locked.redirected, '/');
  assert.equal(locked.rendered, undefined);
  assert.match(harness.consumeNotice(harness.user.id), /get back to work/);
});

test('can delegate the authorized file response to an nginx internal location', () => {
  const harness = createHarness(undefined, { renderTestAccelUri: '/_private/3drender/index.html' });
  let response = harness.request('GET');
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = submitCaptcha(harness, response);
  response = harness.request('POST', {
    flowId: response.rendered.locals.flowId,
    password: '!*^*&^'
  });
  assert.equal(response.headers['X-Accel-Redirect'], '/_private/3drender/index.html');
  assert.equal(response.ended, true);
  assert.equal(response.file, undefined);
});

test('rejects unsafe nginx internal redirect URIs', () => {
  assert.throws(
    () => createHarness(undefined, { renderTestAccelUri: '//attacker.invalid/file' }),
    /safe internal URI/
  );
});
