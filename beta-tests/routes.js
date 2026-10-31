const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream');

const CAPTCHA_COUNT = 3;
const FLOW_LIFETIME_MS = 15 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_NOTICE = 'That was a cute attempt to dodge your todos. Please get back to work.';

function createCaptcha() {
  const left = crypto.randomInt(7, 19);
  const right = crypto.randomInt(3, 13);
  return { left, right };
}

function hasCompletedTodos(user) {
  return (user.tasks || []).every((task) => task?.done === true);
}

function isSymbolOnlyPassword(value) {
  return typeof value === 'string' && value.length > 0 && /^[\p{P}\p{S}]+$/u.test(value);
}

function registerRenderGateRoutes({
  app,
  rootDir,
  currentUser,
  refreshModerationStatus,
  gateAttempts,
  render,
  renderTestPath = process.env.THREE_D_RENDER_TEST_PATH || path.join(rootDir, 'views', 'beta-tests', '3drender', 'index.html'),
  renderTestAccelUri = process.env.THREE_D_RENDER_TEST_ACCEL_URI || null
}) {
  const flows = new Map();
  const notices = new Map();
  const localFailures = new Map();

  if (renderTestAccelUri && (
    !renderTestAccelUri.startsWith('/')
    || renderTestAccelUri.startsWith('//')
    || /[?#\\\r\n]/.test(renderTestAccelUri)
    || renderTestAccelUri.split('/').includes('..')
  )) {
    throw new Error('THREE_D_RENDER_TEST_ACCEL_URI must be a safe internal URI path.');
  }

  function pruneExpired() {
    const now = Date.now();
    for (const [userId, flow] of flows) if (flow.expiresAt <= now) flows.delete(userId);
    for (const [userId, notice] of notices) if (notice.expiresAt <= now) notices.delete(userId);
    if (gateAttempts) {
      gateAttempts.pruneExpired(FAILURE_WINDOW_MS / 1000);
    } else {
      for (const [userId, failure] of localFailures) {
        if (failure.lockedUntil <= now && failure.windowStartedAt + FAILURE_WINDOW_MS <= now) localFailures.delete(userId);
      }
    }
  }

  function canUseBetaTools(request) {
    const user = currentUser(request);
    if (!user?.settings?.betaTools || refreshModerationStatus(user) !== 'active') return null;
    request.user = user;
    return user;
  }

  function showGate(request, response, flow) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    const isCaptcha = flow.step === 'captcha';
    return render(request, response, 'render-gate', {
      renderGateStep: flow.step,
      captcha: isCaptcha ? flow.captcha : null,
      captchaIndex: flow.captchaIndex,
      captchaAmount: CAPTCHA_COUNT,
      flowId: flow.id
    });
  }

  function fail(user, response) {
    flows.delete(user.id);
    if (gateAttempts) {
      gateAttempts.recordFailure(user.id, {
        maxFailures: MAX_FAILURES,
        windowSeconds: FAILURE_WINDOW_MS / 1000
      });
    } else {
      const now = Date.now();
      const current = localFailures.get(user.id);
      const failure = current && current.windowStartedAt + FAILURE_WINDOW_MS > now
        ? current
        : { windowStartedAt: now, count: 0, lockedUntil: 0 };
      failure.count += 1;
      if (failure.count >= MAX_FAILURES) failure.lockedUntil = now + FAILURE_WINDOW_MS;
      localFailures.set(user.id, failure);
    }
    notices.set(user.id, { message: FAILURE_NOTICE, expiresAt: Date.now() + FLOW_LIFETIME_MS });
    return response.redirect('/');
  }

  function isLocked(user, response) {
    const failure = localFailures.get(user.id);
    const locked = gateAttempts
      ? gateAttempts.isLocked(user.id)
      : Boolean(failure && failure.lockedUntil > Date.now());
    if (!locked) return false;
    flows.delete(user.id);
    notices.set(user.id, { message: FAILURE_NOTICE, expiresAt: Date.now() + FLOW_LIFETIME_MS });
    response.redirect('/');
    return true;
  }

  function deliverRenderTest(request, response, next) {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    if (renderTestAccelUri) {
      response.setHeader('X-Accel-Redirect', renderTestAccelUri);
      response.type('html');
      return response.end();
    }
    if (request.acceptsEncodings('gzip') && !request.headers.range) {
      response.type('html');
      response.setHeader('Content-Encoding', 'gzip');
      response.vary('Accept-Encoding');
      pipeline(fs.createReadStream(renderTestPath), zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), response, (error) => {
        if (error && !response.headersSent) next(error);
      });
      return;
    }
    return response.sendFile(renderTestPath);
  }

  app.get('/beta-tests/3drender', (request, response) => {
    pruneExpired();
    const user = canUseBetaTools(request);
    if (!user) return response.redirect('/');
    if (isLocked(user, response)) return response;
    const flow = {
      id: crypto.randomBytes(24).toString('base64url'),
      step: 'captcha',
      captchaIndex: 0,
      captcha: createCaptcha(),
      expiresAt: Date.now() + FLOW_LIFETIME_MS
    };
    flows.set(user.id, flow);
    return showGate(request, response, flow);
  });

  app.post('/beta-tests/3drender', (request, response, next) => {
    pruneExpired();
    const user = canUseBetaTools(request);
    if (!user) return response.redirect('/');
    if (isLocked(user, response)) return response;
    const flow = flows.get(user.id);
    if (!flow || request.body.flowId !== flow.id || flow.expiresAt <= Date.now()) return fail(user, response);

    if (flow.step === 'captcha') {
      const expected = String(flow.captcha.left + flow.captcha.right);
      if (String(request.body.answer || '').trim() !== expected) return fail(user, response);
      flow.captchaIndex += 1;
      if (flow.captchaIndex < CAPTCHA_COUNT) {
        flow.captcha = createCaptcha();
        return showGate(request, response, flow);
      }
      if (!hasCompletedTodos(user)) return fail(user, response);
      flow.step = 'password';
      return showGate(request, response, flow);
    }

    if (flow.step !== 'password' || !hasCompletedTodos(user) || !isSymbolOnlyPassword(request.body.password)) {
      return fail(user, response);
    }
    flows.delete(user.id);
    if (gateAttempts) gateAttempts.clear(user.id);
    else localFailures.delete(user.id);
    return deliverRenderTest(request, response, next);
  });

  return (userId) => {
    pruneExpired();
    const notice = notices.get(userId);
    if (!notice) return null;
    notices.delete(userId);
    return notice.message;
  };
}

module.exports = registerRenderGateRoutes;
module.exports.CAPTCHA_COUNT = CAPTCHA_COUNT;
module.exports.hasCompletedTodos = hasCompletedTodos;
module.exports.isSymbolOnlyPassword = isSymbolOnlyPassword;
