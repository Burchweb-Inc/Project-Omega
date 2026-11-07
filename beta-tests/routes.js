const crypto = require('node:crypto');

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
  renderTestUrl = process.env.THREE_D_RENDER_TEST_URL || '/beta-tests/3drender/file'
}) {
  const flows = new Map();
  const notices = new Map();
  const localFailures = new Map();
  const renderGrants = new Map();

  if (!renderTestUrl.startsWith('/') || renderTestUrl.startsWith('//') || /[?#\\\r\n]/.test(renderTestUrl) || renderTestUrl.split('/').includes('..')) {
    throw new Error('THREE_D_RENDER_TEST_URL must be a safe local URL path.');
  }

  function pruneExpired() {
    const now = Date.now();
    for (const [userId, flow] of flows) if (flow.expiresAt <= now) flows.delete(userId);
    for (const [userId, notice] of notices) if (notice.expiresAt <= now) notices.delete(userId);
    for (const [userId, grant] of renderGrants) if (grant.expiresAt <= now) renderGrants.delete(userId);
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

  function isUserLocked(user) {
    const failure = localFailures.get(user.id);
    return gateAttempts
      ? gateAttempts.isLocked(user.id)
      : Boolean(failure && failure.lockedUntil > Date.now());
  }

  function isLocked(user, response) {
    if (!isUserLocked(user)) return false;
    flows.delete(user.id);
    notices.set(user.id, { message: FAILURE_NOTICE, expiresAt: Date.now() + FLOW_LIFETIME_MS });
    response.redirect('/');
    return true;
  }

  function deliverRenderTest(request, response, user) {
    const oneHourFromNow = Date.now() + 60 * 60 * 1000;
    renderGrants.set(user.id, { expiresAt: oneHourFromNow });
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    return response.redirect(303, renderTestUrl);
  }

  app.get('/beta-tests/3drender/authorize', (request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    pruneExpired();

    const user = canUseBetaTools(request);
    const grant = user && renderGrants.get(user.id);
    if (!user || isUserLocked(user) || !grant || grant.expiresAt <= Date.now()) {
      if (user) renderGrants.delete(user.id);
      return response.sendStatus(403);
    }

    return response.sendStatus(204);
  });

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

  app.post('/beta-tests/3drender', (request, response) => {
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
    return deliverRenderTest(request, response, user);
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
