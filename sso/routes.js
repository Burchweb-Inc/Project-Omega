const crypto = require('crypto');

const REQUEST_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REQUEST_COOKIE = 'lockin_sso_request';
const SUPPORTED_SCOPES = new Set(['openid', 'profile', 'groups']);
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const SSO_PAGE_CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function secureCookieSuffix() {
  const configuredOrigin = process.env.PUBLIC_URL || process.env.ORIGIN || '';
  return process.env.NODE_ENV === 'production' || /^https:/i.test(configuredOrigin) ? '; Secure' : '';
}

function requestCookie(requestId) {
  return `${REQUEST_COOKIE}=${requestId}; HttpOnly; Path=/oauth/authorize; SameSite=Lax; Max-Age=600${secureCookieSuffix()}`;
}

function clearRequestCookie() {
  return `${REQUEST_COOKIE}=; HttpOnly; Path=/oauth/authorize; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`;
}

function noStore(response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}

function ssoPageHeaders(response, referrerPolicy = 'no-referrer', formActionOrigin = '') {
  noStore(response);
  response.setHeader('Referrer-Policy', referrerPolicy);
  const formAction = formActionOrigin ? `'self' ${formActionOrigin}` : "'self'";
  response.setHeader('Content-Security-Policy', SSO_PAGE_CSP.replace("form-action 'self'", `form-action ${formAction}`));
}

function parseScopes(value) {
  const requested = String(value || '').trim().split(/\s+/).filter(Boolean);
  const scopes = requested.length ? requested : ['openid', 'profile'];
  if (scopes.some((scope) => !SUPPORTED_SCOPES.has(scope))) return null;
  return [...new Set(scopes)];
}

function oauthError(response, status, error, description) {
  noStore(response);
  return response.status(status).json({ error, error_description: description });
}

function redirectOAuthError(response, redirectUri, state, error, description) {
  const target = new URL(redirectUri);
  target.searchParams.set('error', error);
  if (description) target.searchParams.set('error_description', description);
  if (state) target.searchParams.set('state', state);
  return response.redirect(target.toString());
}

function readClientCredentials(request) {
  const header = String(request.get('authorization') || '');
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice('Basic '.length).trim(), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator >= 0) return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  }
  return {
    clientId: String(request.body?.client_id || ''),
    clientSecret: String(request.body?.client_secret || '')
  };
}

function readBearerToken(request) {
  const header = String(request.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function tokenClaims(user, client, scope, authTime, nonce, issuer, issuedAt) {
  const claims = {
    iss: issuer,
    sub: user.id,
    aud: client.clientId,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    iat: issuedAt,
    auth_time: authTime
  };
  if (scope.split(' ').includes('profile')) {
    claims.name = user.name;
    claims.preferred_username = user.username;
  }
  if (nonce) claims.nonce = nonce;
  return claims;
}

module.exports = function registerSsoRoutes({
  app,
  ssoModel,
  oidcSigner,
  users,
  orgModel,
  publicOrigin,
  requireUser,
  requireSiteAdmin,
  render,
  sendMutation,
  parseCookies
}) {
  const authorizationRequests = new Map();
  const authorizationCodes = new Map();
  const accessTokens = new Map();

  function pruneExpiredRecords() {
    const now = Date.now();
    for (const [requestId, authRequest] of authorizationRequests) if (authRequest.expiresAt <= now) authorizationRequests.delete(requestId);
    for (const [code, record] of authorizationCodes) if (record.expiresAt <= now) authorizationCodes.delete(code);
    for (const [token, record] of accessTokens) if (record.expiresAt <= now) accessTokens.delete(token);
  }

  function takeAuthorizationRequest(requestId, cookieValue) {
    if (!requestId || !cookieValue || !safeEqual(requestId, cookieValue)) return null;
    const request = authorizationRequests.get(requestId);
    if (!request) return null;
    authorizationRequests.delete(requestId);
    return request.expiresAt > Date.now() ? request : null;
  }

  function revokeClientTokens(clientId) {
    for (const [token, record] of accessTokens) if (record.clientId === clientId) accessTokens.delete(token);
    for (const [code, record] of authorizationCodes) if (record.clientId === clientId) authorizationCodes.delete(code);
    for (const [requestId, record] of authorizationRequests) if (record.clientId === clientId) authorizationRequests.delete(requestId);
  }

  function isActiveUser(user) {
    return Boolean(user) && user.isActive !== false && (user.moderationStatus || 'active') === 'active';
  }

  function groupClaimsForUser(userId) {
    if (!orgModel || typeof orgModel.copyCandidatesForUser !== 'function') return [];
    return orgModel.copyCandidatesForUser(userId).map((org) => ({
      id: org.id,
      name: org.name,
      description: org.description || '',
      members: (org.members || []).map((member) => {
        const user = users.find((candidate) => candidate.id === member.userId);
        return {
          sub: member.userId,
          name: user?.name || '',
          preferred_username: user?.username || '',
          role: member.role || 'viewer'
        };
      })
    }));
  }

  function claimsForUser(user, scope) {
    const claims = { sub: user.id };
    if (scope.split(' ').includes('profile')) {
      claims.name = user.name;
      claims.preferred_username = user.username;
    }
    if (scope.split(' ').includes('groups')) claims.groups = groupClaimsForUser(user.id);
    return claims;
  }

  function renderAuthorizeError(request, response, description) {
    response.status(400);
    return render(request, response, 'sso-authorize', {
      ssoError: description,
      ssoClient: null,
      authorizationRequest: null,
      redirectHost: '',
      scopes: []
    });
  }

  function renderDevelopersPage(request, response, extra = {}) {
    ssoPageHeaders(response);
    response.status(extra.status || 200);
    return render(request, response, 'site-admin', {
      siteAdminTab: 'developers',
      ssoClients: ssoModel.all(),
      ssoIssuer: publicOrigin(request),
      buildIdInput: '',
      buildDecodeResult: null,
      buildDecodeError: '',
      developerNotice: null,
      developerError: '',
      developerForm: null,
      ...extra
    });
  }

  function renderSecretPage(request, response, ssoClient, clientSecret, rotated) {
    ssoPageHeaders(response);
    return render(request, response, 'sso-client-secret', {
      ssoClient,
      clientSecret,
      rotated: Boolean(rotated)
    });
  }

  function isSameOriginRequest(request, origin) {
    const candidate = String(request.get('origin') || request.get('referer') || '');
    if (!candidate) return false;
    try {
      return new URL(candidate).origin === origin;
    } catch (error) {
      return false;
    }
  }

  function isNullOriginConsent(request) {
    return request.method === 'POST'
      && request.path === '/oauth/authorize'
      && request.get('origin') === 'null'
      && request.get('sec-fetch-site') === 'same-origin'
      && request.get('sec-fetch-mode') === 'navigate'
      && /(?:^|;\s*)lockin_sso_request=[^;]+/.test(String(request.headers.cookie || ''))
      && Boolean(String(request.body?.request_id || ''));
  }

  function requireSameOrigin(request, response, next) {
    if (isSameOriginRequest(request, publicOrigin(request)) || isNullOriginConsent(request)) return next();
    noStore(response);
    return response.status(403).send('This request must come from LockIn.');
  }

  app.get('/oauth/authorize', requireUser, (request, response) => {
    ssoPageHeaders(response, 'same-origin');
    pruneExpiredRecords();

    const client = ssoModel.getByClientId(String(request.query.client_id || ''));
    const redirectUri = String(request.query.redirect_uri || '');
    const state = String(request.query.state || '');
    const responseType = String(request.query.response_type || '');
    const scopes = parseScopes(request.query.scope);
    const codeChallenge = String(request.query.code_challenge || '');
    const codeChallengeMethod = String(request.query.code_challenge_method || '');
    const nonce = String(request.query.nonce || '');

    if (!client) return renderAuthorizeError(request, response, 'This app is not registered with LockIn SSO.');
    if (!client.redirectUris.includes(redirectUri)) return renderAuthorizeError(request, response, 'This app requested a redirect URL that has not been approved.');
    ssoPageHeaders(response, 'same-origin', new URL(redirectUri).origin);
    if (responseType !== 'code') return redirectOAuthError(response, redirectUri, state, 'unsupported_response_type', 'LockIn SSO only supports the authorization code flow.');
    if (!scopes) return redirectOAuthError(response, redirectUri, state, 'invalid_scope', 'LockIn SSO supports the openid, profile, and groups scopes.');
    if (state.length > 500) return redirectOAuthError(response, redirectUri, state, 'invalid_request', 'The state value is too long.');
    if (nonce.length > 200) return redirectOAuthError(response, redirectUri, state, 'invalid_request', 'The nonce value is too long.');
    if (codeChallenge && (codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))) {
      return redirectOAuthError(response, redirectUri, state, 'invalid_request', 'Use a valid S256 PKCE challenge.');
    }
    if (!codeChallenge && codeChallengeMethod) {
      return redirectOAuthError(response, redirectUri, state, 'invalid_request', 'A PKCE challenge is required when a challenge method is sent.');
    }

    const requestId = randomToken(32);
    const authRequest = {
      id: requestId,
      clientId: client.clientId,
      redirectUri,
      state,
      scope: scopes.join(' '),
      codeChallenge,
      codeChallengeMethod: codeChallenge ? 'S256' : '',
      nonce,
      userId: request.user.id,
      authTime: Math.floor(Date.now() / 1000),
      expiresAt: Date.now() + REQUEST_TTL_MS
    };
    authorizationRequests.set(requestId, authRequest);
    response.append('Set-Cookie', requestCookie(requestId));

    return render(request, response, 'sso-authorize', {
      ssoClient: client,
      authorizationRequest: authRequest,
      redirectHost: new URL(redirectUri).host,
      scopes,
      ssoError: null
    });
  });

  app.post('/oauth/authorize', requireUser, requireSameOrigin, (request, response) => {
    ssoPageHeaders(response);
    pruneExpiredRecords();
    const requestId = String(request.body.request_id || '');
    const authRequest = takeAuthorizationRequest(requestId, parseCookies(request)[REQUEST_COOKIE] || '');
    response.append('Set-Cookie', clearRequestCookie());

    if (!authRequest || authRequest.userId !== request.user.id) {
      return renderAuthorizeError(request, response, 'This authorization request expired. Start again from the app you want to use.');
    }

    const client = ssoModel.getByClientId(authRequest.clientId);
    if (!client || !client.redirectUris.includes(authRequest.redirectUri)) {
      return renderAuthorizeError(request, response, 'This app is no longer approved for LockIn SSO.');
    }

    if (String(request.body.decision || '') !== 'allow') {
      return redirectOAuthError(response, authRequest.redirectUri, authRequest.state, 'access_denied', 'The LockIn account owner denied the request.');
    }

    const code = randomToken(32);
    authorizationCodes.set(code, {
      clientId: client.clientId,
      userId: request.user.id,
      redirectUri: authRequest.redirectUri,
      scope: authRequest.scope,
      codeChallenge: authRequest.codeChallenge,
      nonce: authRequest.nonce,
      authTime: authRequest.authTime,
      expiresAt: Date.now() + CODE_TTL_MS
    });

    const target = new URL(authRequest.redirectUri);
    target.searchParams.set('code', code);
    if (authRequest.state) target.searchParams.set('state', authRequest.state);
    return response.redirect(target.toString());
  });

  app.post('/oauth/token', (request, response) => {
    noStore(response);
    pruneExpiredRecords();
    const { clientId, clientSecret } = readClientCredentials(request);
    const client = ssoModel.getByClientId(clientId);
    if (!client || !ssoModel.verifyClientSecret(client.clientId, clientSecret)) {
      response.setHeader('WWW-Authenticate', 'Basic realm="LockIn SSO"');
      return oauthError(response, 401, 'invalid_client', 'Client authentication failed.');
    }

    if (String(request.body.grant_type || '') !== 'authorization_code') {
      return oauthError(response, 400, 'unsupported_grant_type', 'Only the authorization_code grant is supported.');
    }

    const code = String(request.body.code || '');
    const record = authorizationCodes.get(code);
    authorizationCodes.delete(code);
    if (!record || record.expiresAt <= Date.now()) return oauthError(response, 400, 'invalid_grant', 'The authorization code is invalid or expired.');
    if (record.clientId !== client.clientId) return oauthError(response, 400, 'invalid_grant', 'The authorization code belongs to another client.');
    if (String(request.body.redirect_uri || '') !== record.redirectUri) return oauthError(response, 400, 'invalid_grant', 'The redirect URL does not match the authorization request.');

    if (record.codeChallenge) {
      const verifier = String(request.body.code_verifier || '');
      if (!PKCE_VERIFIER_PATTERN.test(verifier)) {
        return oauthError(response, 400, 'invalid_grant', 'The PKCE verifier is invalid.');
      }
      const computedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      if (!safeEqual(computedChallenge, record.codeChallenge)) {
        return oauthError(response, 400, 'invalid_grant', 'The PKCE verifier does not match.');
      }
    }

    const user = users.find((candidate) => candidate.id === record.userId);
    if (!isActiveUser(user)) return oauthError(response, 400, 'invalid_grant', 'The LockIn account is not active.');

    const accessToken = randomToken(32);
    accessTokens.set(accessToken, {
      userId: user.id,
      clientId: client.clientId,
      scope: record.scope,
      expiresAt: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000
    });
    ssoModel.markUsed(client.clientId);

    const responsePayload = {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: record.scope
    };

    if (record.scope.split(' ').includes('openid')) {
      const issuedAt = Math.floor(Date.now() / 1000);
      const claims = {
        ...tokenClaims(user, client, record.scope, record.authTime, record.nonce, publicOrigin(request), issuedAt),
        ...claimsForUser(user, record.scope)
      };
      responsePayload.id_token = oidcSigner.sign(claims);
    }

    return response.json(responsePayload);
  });

  app.get('/oauth/userinfo', (request, response) => {
    noStore(response);
    pruneExpiredRecords();
    const token = readBearerToken(request);
    const record = token ? accessTokens.get(token) : null;
    if (!record || record.expiresAt <= Date.now()) {
      if (record) accessTokens.delete(token);
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return oauthError(response, 401, 'invalid_token', 'The access token is invalid or expired.');
    }
    const user = users.find((candidate) => candidate.id === record.userId);
    if (!isActiveUser(user)) {
      accessTokens.delete(token);
      response.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      return oauthError(response, 401, 'invalid_token', 'The LockIn account is not active.');
    }
    return response.json(claimsForUser(user, record.scope));
  });

  function openIdConfiguration(request, response) {
    const issuer = publicOrigin(request);
    response.setHeader('Cache-Control', 'public, max-age=300');
    return response.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'profile', 'groups'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'name', 'preferred_username', 'groups']
    });
  }

  app.get(['/.well-known/openid-configuration', '/.well-known/oauth-authorization-server'], openIdConfiguration);
  app.get('/.well-known/jwks.json', (request, response) => {
    response.setHeader('Cache-Control', 'public, max-age=300');
    return response.json(oidcSigner.jwks());
  });

  app.post('/site-admin/developers/clients', requireUser, requireSiteAdmin, requireSameOrigin, (request, response) => {
    const draft = {
      name: String(request.body.name || '').trim(),
      description: String(request.body.description || '').trim(),
      redirectUris: String(request.body.redirectUris || '').trim()
    };
    try {
      const { client, clientSecret } = ssoModel.create({ ...draft, createdBy: request.user.id });
      return renderSecretPage(request, response, client, clientSecret, false);
    } catch (error) {
      return renderDevelopersPage(request, response, {
        status: 422,
        developerError: error.message,
        developerForm: draft
      });
    }
  });

  app.post('/site-admin/developers/clients/:clientId/rotate-secret', requireUser, requireSiteAdmin, requireSameOrigin, (request, response) => {
    const client = ssoModel.getByClientId(request.params.clientId);
    if (!client) return response.redirect('/site-admin?tab=developers&notice=integration-missing');
    const rotated = ssoModel.rotateSecret(client.id);
    if (!rotated) return response.redirect('/site-admin?tab=developers&notice=integration-missing');
    revokeClientTokens(client.clientId);
    return renderSecretPage(request, response, rotated.client, rotated.clientSecret, true);
  });

  app.post('/site-admin/developers/clients/:clientId/redirects', requireUser, requireSiteAdmin, requireSameOrigin, (request, response) => {
    const client = ssoModel.getByClientId(request.params.clientId);
    if (!client) return sendMutation(request, response, { error: 'That integration no longer exists.' }, '/site-admin?tab=developers&notice=integration-missing');
    try {
      ssoModel.addRedirectUri(client.id, request.body.redirectUri);
      return sendMutation(request, response, { successMessage: 'Redirect URL approved.' }, '/site-admin?tab=developers&notice=redirect-added');
    } catch (error) {
      return sendMutation(request, response, { error: error.message }, '/site-admin?tab=developers&notice=redirect-invalid');
    }
  });

  app.post('/site-admin/developers/clients/:clientId/redirects/remove', requireUser, requireSiteAdmin, requireSameOrigin, (request, response) => {
    const client = ssoModel.getByClientId(request.params.clientId);
    if (!client) return sendMutation(request, response, { error: 'That integration no longer exists.' }, '/site-admin?tab=developers&notice=integration-missing');
    if (client.redirectUris.length <= 1) {
      return sendMutation(request, response, { error: 'Keep at least one approved redirect URL.' }, '/site-admin?tab=developers&notice=redirect-last');
    }
    try {
      const updated = ssoModel.removeRedirectUri(client.id, request.body.redirectUri);
      if (!updated || updated.redirectUris.length === client.redirectUris.length) {
        return sendMutation(request, response, { error: 'That redirect URL is not in the approved list.' }, '/site-admin?tab=developers&notice=redirect-invalid');
      }
      revokeClientTokens(client.clientId);
      return sendMutation(request, response, { successMessage: 'Redirect URL removed. Existing codes and tokens for this integration were revoked.' }, '/site-admin?tab=developers&notice=redirect-removed');
    } catch (error) {
      return sendMutation(request, response, { error: error.message }, '/site-admin?tab=developers&notice=redirect-invalid');
    }
  });

  app.post('/site-admin/developers/clients/:clientId/delete', requireUser, requireSiteAdmin, requireSameOrigin, (request, response) => {
    const client = ssoModel.getByClientId(request.params.clientId);
    if (!client) return sendMutation(request, response, { error: 'That integration no longer exists.' }, '/site-admin?tab=developers&notice=integration-missing');
    ssoModel.delete(client.id);
    revokeClientTokens(client.clientId);
    return sendMutation(request, response, { successMessage: `${client.name} was deleted.` }, '/site-admin?tab=developers&notice=integration-deleted');
  });
};
