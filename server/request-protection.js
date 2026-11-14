const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const AUTH_PATHS = new Set(['/login', '/signup', '/signup/snarkytype', '/oauth/authorize', '/oauth/token']);
const AUTH_COOKIE = /(?:^|;\s*)(?:session|lockin_sso_request|snarky_pending)=/;

function numericOption(value, fallback, minimum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.floor(parsed) : fallback;
}

function wantsJson(request) {
  if (request.get('x-live-request') === 'true') return true;
  if (String(request.path || '').startsWith('/oauth/')) return true;
  return String(request.get('accept') || '').includes('application/json');
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value)).origin;
  } catch (error) {
    return '';
  }
}

function allowsNullOriginConsent(request) {
  return request.method === 'POST'
    && request.path === '/oauth/authorize'
    && request.get('origin') === 'null'
    && request.get('sec-fetch-site') === 'same-origin'
    && request.get('sec-fetch-mode') === 'navigate'
    && /(?:^|;\s*)lockin_sso_request=[^;]+/.test(String(request.headers.cookie || ''))
    && Boolean(String(request.body?.request_id || ''));
}

function sendRejection(request, response, status, message) {
  response.setHeader('Cache-Control', 'no-store');
  if (wantsJson(request)) return response.status(status).json({ error: message });
  return response.status(status).type('text/plain').send(message);
}

module.exports = function createRequestProtection({
  getOrigin,
  mutationLimit,
  authLimit,
  windowMs,
  now = Date.now,
  cleanupIntervalMs = 10 * 60 * 1000
} = {}) {
  if (typeof getOrigin !== 'function') throw new Error('Request protection requires getOrigin(request).');
  const generalLimit = numericOption(mutationLimit, 240, 1);
  const sensitiveLimit = numericOption(authLimit, 30, 1);
  const duration = numericOption(windowMs, 60_000, 1000);
  const buckets = new Map();

  function consume(key, limit, timestamp) {
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + duration };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt, limit };
  }

  if (cleanupIntervalMs > 0) {
    const cleanup = setInterval(() => {
      const timestamp = now();
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= timestamp) buckets.delete(key);
      }
    }, cleanupIntervalMs);
    cleanup.unref?.();
  }

  return function requestProtection(request, response, next) {
    if (SAFE_METHODS.has(request.method)) return next();

    const timestamp = now();
    const sensitive = AUTH_PATHS.has(request.path);
    const limit = sensitive ? sensitiveLimit : generalLimit;
    const bucketKey = `${request.ip || request.socket?.remoteAddress || 'unknown'}:${sensitive ? 'auth' : 'mutation'}`;
    const result = consume(bucketKey, limit, timestamp);
    response.setHeader('RateLimit-Limit', String(result.limit));
    response.setHeader('RateLimit-Remaining', String(result.remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    if (!result.allowed) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((result.resetAt - timestamp) / 1000))));
      return sendRejection(request, response, 429, 'Too many requests. Wait a moment and try again.');
    }

    let expectedOrigin = '';
    try {
      expectedOrigin = normalizeOrigin(getOrigin(request));
    } catch (error) {
      expectedOrigin = '';
    }
    if (!expectedOrigin) return sendRejection(request, response, 403, 'This request must come from LockIn.');

    const fetchSite = String(request.get('sec-fetch-site') || '').toLowerCase();
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) {
      return sendRejection(request, response, 403, 'This request must come from LockIn.');
    }

    const originHeader = String(request.get('origin') || '');
    const refererHeader = String(request.get('referer') || '');
    const origin = originHeader ? normalizeOrigin(originHeader) : '';
    const referer = refererHeader ? normalizeOrigin(refererHeader) : '';
    const nullOriginConsent = allowsNullOriginConsent(request);
    if ((originHeader && !origin && !nullOriginConsent) || (refererHeader && !referer)) {
      return sendRejection(request, response, 403, 'This request must come from LockIn.');
    }
    if ((origin && origin !== expectedOrigin) || (referer && referer !== expectedOrigin)) {
      return sendRejection(request, response, 403, 'This request must come from LockIn.');
    }

    if (!originHeader && !refererHeader) {
      const hasAuthCookie = AUTH_COOKIE.test(String(request.headers.cookie || ''));
      const liveRequest = request.get('x-live-request') === 'true';
      if (hasAuthCookie && !liveRequest && fetchSite !== 'none') {
        return sendRejection(request, response, 403, 'This request must come from LockIn.');
      }
    }

    return next();
  };
};
