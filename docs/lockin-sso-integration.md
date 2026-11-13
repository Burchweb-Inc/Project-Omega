# LockIn SSO integration guide

LockIn SSO is LockIn's own OpenID Connect provider. It lets another Burchweb app sign a user in with their LockIn account without receiving the user's LockIn password, tasks, groups, or other workspace data.

This guide is for the developer building the client app. It covers the admin setup, the full authorization code flow, request and response details, a Node.js example, security requirements, and common errors.

The examples use `https://lockedin.burchweb.com` as the LockIn origin. Replace it with the value of `PUBLIC_URL` for your LockIn deployment.

## Contents

- [At a glance](#at-a-glance)
- [Before you begin](#before-you-begin)
- [1. Create the integration](#1-create-the-integration)
- [2. Configure the client](#2-configure-the-client)
- [3. Walk through the authorization flow](#3-walk-through-the-authorization-flow)
- [4. Endpoint reference](#4-endpoint-reference)
- [5. ID token and userinfo claims](#5-id-token-and-userinfo-claims)
- [6. Minimal Node.js client](#6-minimal-nodejs-client)
- [7. Security checklist](#7-security-checklist)
- [8. Limits and operations](#8-limits-and-operations)
- [9. Troubleshooting](#9-troubleshooting)
- [10. Quick reference](#10-quick-reference)

## At a glance

| Item | Value |
| --- | --- |
| Protocol | OAuth 2.0 Authorization Code flow with OpenID Connect |
| Issuer | `PUBLIC_URL`, for example `https://lockedin.burchweb.com` |
| Discovery | `/.well-known/openid-configuration` |
| Authorization endpoint | `/oauth/authorize` |
| Token endpoint | `/oauth/token` |
| Userinfo endpoint | `/oauth/userinfo` |
| JWKS endpoint | `/.well-known/jwks.json` |
| Client authentication | HTTP Basic or form body |
| PKCE | Optional, S256 only |
| Scopes | `openid`, `profile` |
| ID token signing | RS256 |
| Access token | Opaque bearer token, 1 hour |
| Authorization code | Single use, 60 seconds |
| Consent request | 10 minutes, same browser |
| Refresh tokens | Not supported |
| Redirect URL matching | Exact string match, HTTPS except loopback |
| Client secrets | SHA-256 hashed, shown once |

LockIn SSO is an identity provider, not a social login button. Your app redirects the browser to LockIn, the user approves access while signed in to LockIn, and your server exchanges the returned code for tokens.

## Before you begin

You need:

- A LockIn deployment with a stable public origin.
- `PUBLIC_URL` set to that origin, for example `https://lockedin.burchweb.com`.
- A site admin account on that LockIn deployment.
- A server-side app that can keep a session and make HTTPS requests.
- An exact callback URL in your app, such as `https://app.example.com/auth/lockin/callback`.
- HTTPS on the callback URL. HTTP is accepted only for `localhost`, `127.0.0.1`, and `[::1]`.

Set `PUBLIC_URL` explicitly in production. The app falls back to `ORIGIN`, then to the incoming request host, but an explicit `PUBLIC_URL` prevents issuer and discovery URLs from depending on proxy headers.

The LockIn server needs a persistent `data/` volume. It stores the SSO clients in SQLite and creates the ID token signing key there unless `OIDC_SIGNING_KEY` is supplied.

## 1. Create the integration

1. Sign in to LockIn as a site admin.
2. Open **Site Admin > Developers**.
3. In the **New integration** form, enter a name and optional description.
4. Add one redirect URL per line.
5. Select **Create integration**.
6. Copy the client ID and client secret immediately.

The secret is shown once. If it is lost, rotate it from the same page. Rotating creates a new secret and immediately invalidates the integration's pending authorization requests, authorization codes, and access tokens.

### Integration fields

| Field | Rules |
| --- | --- |
| Name | 2 to 80 characters |
| Description | Up to 300 characters |
| Redirect URLs | At least 1, at most 10, each up to 2000 characters |

The client ID is stable for the life of the integration. It normally starts with `lockin_`. The client secret normally starts with `lks_` and should be stored like a password.

### Manage redirect URLs

The Developers page lists every approved redirect URL. Use **Approve URL** to add another exact callback. Use the remove button beside a URL to revoke it. The console will not remove the last remaining URL; delete the integration instead if it is no longer used.

Removing a redirect URL takes effect immediately. An authorization request that is already in progress with that URL will fail when the user submits consent.

### Rotate a secret

Use **Rotate secret** when:

- The secret was lost.
- The secret may have appeared in a log, browser bundle, or repository.
- You are rotating credentials on a schedule.

After rotation:

- The old secret stops working immediately.
- Pending authorization requests for that client are discarded.
- Unused authorization codes for that client are discarded.
- Existing access tokens for that client are revoked.
- Already-issued ID tokens are not individually revoked because they are signed JWTs. Treat their `exp` claim as the hard limit and keep client-side sessions short.

Update the client's server environment with the new secret before retrying.

### Delete an integration

Deleting an integration removes its client registration and revokes its pending requests, codes, and access tokens. Apps using that client ID stop working. Existing ID tokens remain verifiable until they expire if a client still accepts them.

## 2. Configure the client

The client app needs four values:

```text
LOCKIN_ISSUER=https://lockedin.burchweb.com
LOCKIN_CLIENT_ID=lockin_...
LOCKIN_CLIENT_SECRET=lks_...
LOCKIN_REDIRECT_URI=https://app.example.com/auth/lockin/callback
```

Keep `LOCKIN_CLIENT_SECRET` on the server. Never put it in browser JavaScript, a mobile app binary, a public repository, or a URL. `LOCKIN_ISSUER` should be the issuer reported by discovery, without a trailing slash.

### Redirect URL rules

LockIn stores a normalized URL and requires an exact match during authorization. The normalization uses the standard URL parser, which can make small visual differences significant.

Valid examples:

```text
https://app.example.com/auth/lockin/callback
https://app.example.com/auth/lockin/callback?source=lockin
http://localhost:4000/auth/lockin/callback
http://127.0.0.1:4000/auth/lockin/callback
```

Invalid examples:

```text
http://app.example.com/auth/lockin/callback
```

HTTP is only for loopback development.

```text
https://app.example.com/auth/lockin/callback#done
```

Fragments are not allowed.

```text
https://user:password@app.example.com/auth/lockin/callback
```

Credentials in the URL are not allowed.

```text
https://app.example.com/auth/*
```

Wildcards are not supported. Every callback must be listed exactly.

A bare origin such as `https://app.example.com` normalizes to `https://app.example.com/`. Use the exact value shown in the Developers page in your authorization request and token request.

### Endpoints

With `PUBLIC_URL=https://lockedin.burchweb.com`:

| Purpose | URL |
| --- | --- |
| Issuer | `https://lockedin.burchweb.com` |
| Discovery | `https://lockedin.burchweb.com/.well-known/openid-configuration` |
| Authorization server metadata | `https://lockedin.burchweb.com/.well-known/oauth-authorization-server` |
| JWKS | `https://lockedin.burchweb.com/.well-known/jwks.json` |
| Authorization | `https://lockedin.burchweb.com/oauth/authorize` |
| Token | `https://lockedin.burchweb.com/oauth/token` |
| Userinfo | `https://lockedin.burchweb.com/oauth/userinfo` |

The two discovery URLs return the same metadata. `PUBLIC_URL` must not include a path. The app removes trailing slashes when building the issuer.

## 3. Walk through the authorization flow

```text
Browser                Your app                    LockIn
   |                      |                          |
   |  click sign in       |                          |
   |--------------------->|                          |
   |                      | 302 to /oauth/authorize  |
   |<---------------------|                          |
   |  sign in and consent                           |
   |----------------------------------------------->|
   |  redirect to callback with code and state       |
   |<-----------------------------------------------|
   |--------------------->|                          |
   |                      | POST /oauth/token        |
   |                      |------------------------->|
   |                      | access token + ID token  |
   |                      |<-------------------------|
   |                      | validate ID token        |
   |                      | POST /oauth/userinfo     |
   |                      |------------------------->|
   |                      | profile claims           |
   |                      |<-------------------------|
   |  app session         |                          |
   |<---------------------|                          |
```

### Step 1: Create state, nonce, and PKCE values

Generate a new random `state`, a new random `nonce`, and a PKCE verifier for every sign-in attempt. Store them in the user's server-side session.

```js
const state = crypto.randomBytes(32).toString('base64url');
const nonce = crypto.randomBytes(32).toString('base64url');
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');
```

Use a verifier of 43 to 128 characters. The example above produces 43 characters.

PKCE is optional in LockIn SSO, but it is recommended. If you send a challenge, the method must be `S256`.

### Step 2: Redirect the browser to LockIn

Send the browser to the authorization endpoint with these parameters:

```text
https://lockedin.burchweb.com/oauth/authorize
  ?client_id=lockin_0123456789abcdef0123456789abcdef
  &redirect_uri=https%3A%2F%2Fapp.example.com%2Fauth%2Flockin%2Fcallback
  &response_type=code
  &scope=openid%20profile
  &state=RANDOM_STATE
  &nonce=RANDOM_NONCE
  &code_challenge=PKCE_CHALLENGE
  &code_challenge_method=S256
```

The browser may not be signed in to LockIn. LockIn will send the user to its login page and return to the authorization request afterward. The user must sign in and approve the request.

The consent page shows the integration name, the redirect host, and whether the request asks for name and username. It does not share the user's password, tasks, or groups.

### Step 3: Receive the callback

On success, LockIn redirects to the approved redirect URL with `code` and `state` in the query string:

```text
https://app.example.com/auth/lockin/callback?code=AUTHORIZATION_CODE&state=RANDOM_STATE
```

On denial or a request error, the callback contains `error` and may contain `error_description` and `state`:

```text
https://app.example.com/auth/lockin/callback?error=access_denied&error_description=The+LockIn+account+owner+denied+the+request.&state=RANDOM_STATE
```

Before exchanging the code:

1. Check that `error` is absent.
2. Compare `state` with the value stored in the session.
3. Check that `code` is present.
4. Reject the callback if the session has no matching pending request.

If the client ID or redirect URL is invalid, LockIn cannot safely redirect back to your app. It renders an error page on LockIn with HTTP 400 instead. The same applies when a consent request has expired or its browser cookie is missing.

### Step 4: Exchange the code on your server

Make a form-encoded POST from your server to the token endpoint. Authenticate with the client ID and secret using HTTP Basic or the form body. Do not do this from browser JavaScript.

```bash
curl -sS https://lockedin.burchweb.com/oauth/token \
  -u "$LOCKIN_CLIENT_ID:$LOCKIN_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$LOCKIN_REDIRECT_URI" \
  --data-urlencode "code_verifier=$CODE_VERIFIER"
```

The `redirect_uri` must match the value used in the authorization request exactly. If PKCE was used, send the original verifier, not the challenge.

A successful response looks like this:

```json
{
  "access_token": "opaque-access-token",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile",
  "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Ii4uLiJ9..."
}
```

Authorization codes are single use and expire after 60 seconds. After a request passes client authentication and grant validation, the code is consumed even if a later check such as the redirect URI, PKCE verifier, or user lookup fails. Do not retry a code after a failed validation; start a new authorization flow.

### Step 5: Validate the ID token

The ID token is a signed JWT. Verify it before creating an app session:

- Signature using the key from `/.well-known/jwks.json`.
- Algorithm is RS256.
- `iss` equals your LockIn issuer.
- `aud` equals your client ID.
- `exp` has not passed.
- `nonce` equals the nonce stored for this sign-in attempt.
- `sub` is present and non-empty.

Do not decode the token and trust the payload without verifying the signature. Do not use the access token as the user's app session.

The `sub` value is the stable LockIn account identifier. Use it as the key for your local user record. The `preferred_username` and `name` values can change.

### Step 6: Read userinfo if needed

The ID token already contains the profile claims requested by the scope. If your app needs a fresh profile, call userinfo from the server:

```bash
curl -sS https://lockedin.burchweb.com/oauth/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

The response is JSON:

```json
{
  "sub": "user-id",
  "name": "Student One",
  "preferred_username": "student1"
}
```

With only `openid`, userinfo returns `sub`. With `profile`, it also returns `name` and `preferred_username`.

### Step 7: Create your own session

After validation, create a new application session for the LockIn `sub`. Regenerate the session ID after sign-in to prevent session fixation. Store only the values your app needs. Keep the LockIn access token server-side if you plan to call userinfo again before it expires.

### Step 8: Logout

LockIn SSO does not publish an RP-initiated logout endpoint. Clear your app's session. The user's LockIn session remains active until it expires or the user signs out of LockIn directly.

## 4. Endpoint reference

### Authorization endpoint

`GET /oauth/authorize`

| Parameter | Required | Notes |
| --- | --- | --- |
| `client_id` | Yes | Client ID from the Developers page |
| `redirect_uri` | Yes | Must exactly match an approved URL |
| `response_type` | Yes | Must be `code` |
| `scope` | No | Space-delimited. Defaults to `openid profile` when omitted. Only `openid` and `profile` are supported. |
| `state` | Recommended | Returned unchanged. Maximum 500 characters. |
| `nonce` | Recommended with `openid` | Included in the ID token. Maximum 200 characters. |
| `code_challenge` | Optional | Base64url SHA-256 challenge, 43 to 128 characters |
| `code_challenge_method` | Required with a challenge | Must be `S256` |

The authorization response is delivered in the query string. Fragment response mode is not supported.

If the request is valid and the user allows access, the redirect contains `code` and `state`.

If the user denies access, the redirect contains `error=access_denied`, an optional `error_description`, and `state`.

If `response_type`, `scope`, `state`, `nonce`, or PKCE validation fails after the client and redirect URL are validated, LockIn redirects the error to the approved callback. If the client or redirect URL is invalid, LockIn shows a 400 error page instead.

### Token endpoint

`POST /oauth/token`

Content type: `application/x-www-form-urlencoded`

Client authentication:

```text
Authorization: Basic base64(client_id:client_secret)
```

or:

```text
client_id=lockin_...&client_secret=lks_...
```

| Parameter | Required | Notes |
| --- | --- | --- |
| `grant_type` | Yes | Must be `authorization_code` |
| `code` | Yes | Code from the callback. Single use, 60 seconds. |
| `redirect_uri` | Yes | Must match the authorization request exactly |
| `code_verifier` | Required with PKCE | Original verifier used to create the challenge |
| `client_id` | With form auth | Required when not using Basic |
| `client_secret` | With form auth | Required when not using Basic |

A successful response contains `access_token`, `token_type`, `expires_in`, and `scope`. If the authorized scope includes `openid`, it also contains `id_token`.

Common token errors:

| Error | HTTP status | Meaning |
| --- | --- | --- |
| `invalid_client` | 401 | Unknown client ID or wrong client secret |
| `unsupported_grant_type` | 400 | Grant type is not `authorization_code` |
| `invalid_grant` | 400 | Code is missing, expired, already used, belongs to another client, has the wrong redirect URI, has the wrong PKCE verifier, or the user no longer exists |

### Userinfo endpoint

`GET /oauth/userinfo`

Send `Authorization: Bearer <access_token>`.

A valid token returns `sub`. With the `profile` scope, it also returns `name` and `preferred_username`.

An invalid, expired, revoked, or deleted-user token returns HTTP 401 with:

```json
{
  "error": "invalid_token",
  "error_description": "The access token is invalid or expired."
}
```

### Discovery and JWKS

`GET /.well-known/openid-configuration`

`GET /.well-known/oauth-authorization-server`

Both return the same metadata, including the issuer, endpoint URLs, supported scopes, supported claims, supported client authentication methods, and `S256` PKCE support.

`GET /.well-known/jwks.json`

Returns the active RSA public key used to verify ID tokens. The JWT header includes a `kid` that matches a key in this response.

Discovery and JWKS responses are cached publicly for 5 minutes. Refetch the JWKS when you see a new `kid`, and do not cache it forever.

## 5. ID token and userinfo claims

### ID token claims

| Claim | Meaning |
| --- | --- |
| `iss` | LockIn issuer, taken from `PUBLIC_URL` |
| `sub` | Stable LockIn user ID |
| `aud` | Your client ID |
| `exp` | Expiration time, 1 hour after issue |
| `iat` | Issue time |
| `auth_time` | Authorization request time recorded by LockIn |
| `nonce` | The nonce from the authorization request, when supplied |
| `name` | Display name, when `profile` is authorized |
| `preferred_username` | LockIn username, when `profile` is authorized |

The ID token is signed with RS256. The access token is opaque and is not a JWT.

### Scopes

| Scope | Effect |
| --- | --- |
| `openid` | Issues an ID token and enables OpenID Connect |
| `profile` | Adds `name` and `preferred_username` to the ID token and userinfo |

Use `scope=openid profile` for a normal sign-in that shows the user's name and username on consent.

There is no `email` scope and no email claim. LockIn does not expose the user's email address through this provider.

### What is not shared

LockIn SSO does not expose:

- Passwords.
- Email addresses.
- Tasks, courses, calendar entries, or files.
- Group memberships or group content.
- Account settings or moderation details.

The consent screen is the boundary. If a value is not listed in the claims above, the client does not receive it.

## 6. Minimal Node.js client

This example uses Express, `express-session`, and `jose`. It is deliberately small. Replace the memory session store before production and set a long random `SESSION_SECRET`.

Create a new app with ESM enabled:

```bash
npm init -y
npm pkg set type=module
npm install express express-session jose
```

Create `server.js`:

```js
import express from 'express';
import session from 'express-session';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const {
  LOCKIN_ISSUER,
  LOCKIN_CLIENT_ID,
  LOCKIN_CLIENT_SECRET,
  LOCKIN_REDIRECT_URI,
  SESSION_SECRET,
  PORT = '4000'
} = process.env;

if (!LOCKIN_ISSUER || !LOCKIN_CLIENT_ID || !LOCKIN_CLIENT_SECRET || !LOCKIN_REDIRECT_URI || !SESSION_SECRET) {
  throw new Error('Set LOCKIN_ISSUER, LOCKIN_CLIENT_ID, LOCKIN_CLIENT_SECRET, LOCKIN_REDIRECT_URI, and SESSION_SECRET.');
}

const app = express();
app.set('trust proxy', 1);
app.use(session({
  name: 'app.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

const jwks = createRemoteJWKSet(new URL(`${LOCKIN_ISSUER}/.well-known/jwks.json`));

app.get('/', (request, response) => {
  response.type('html').send(`
    <h1>LockIn SSO example</h1>
    ${request.session.user
      ? `<p>Signed in as ${request.session.user.username || request.session.user.sub}</p>`
      : '<p><a href="/auth/lockin">Sign in with LockIn</a></p>'}
  `);
});

app.get('/auth/lockin', (request, response) => {
  const state = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  request.session.lockin = { state, nonce, codeVerifier };

  const authorize = new URL(`${LOCKIN_ISSUER}/oauth/authorize`);
  authorize.search = new URLSearchParams({
    client_id: LOCKIN_CLIENT_ID,
    redirect_uri: LOCKIN_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  }).toString();

  response.redirect(authorize.toString());
});

app.get('/auth/lockin/callback', async (request, response) => {
  const pending = request.session.lockin;
  delete request.session.lockin;

  if (!pending) return response.status(400).send('No pending LockIn sign-in.');
  if (request.query.error) return response.status(400).send(String(request.query.error));
  if (request.query.state !== pending.state) return response.status(400).send('State mismatch.');
  if (!request.query.code) return response.status(400).send('Missing authorization code.');

  const basic = Buffer.from(`${LOCKIN_CLIENT_ID}:${LOCKIN_CLIENT_SECRET}`).toString('base64');
  const tokenResponse = await fetch(`${LOCKIN_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(request.query.code),
      redirect_uri: LOCKIN_REDIRECT_URI,
      code_verifier: pending.codeVerifier
    })
  });

  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok) return response.status(400).send(tokens.error || 'Token exchange failed.');

  let payload;
  try {
    ({ payload } = await jwtVerify(tokens.id_token, jwks, {
      issuer: LOCKIN_ISSUER,
      audience: LOCKIN_CLIENT_ID,
      algorithms: ['RS256']
    }));
  } catch (error) {
    return response.status(400).send('ID token validation failed.');
  }

  if (payload.nonce !== pending.nonce) return response.status(400).send('Nonce mismatch.');
  if (!payload.sub) return response.status(400).send('Missing subject.');

  let profile = {};
  const userinfoResponse = await fetch(`${LOCKIN_ISSUER}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  if (userinfoResponse.ok) profile = await userinfoResponse.json();

  request.session.regenerate((error) => {
    if (error) return response.status(500).send('Could not start a session.');

    request.session.user = {
      sub: payload.sub,
      name: payload.name || profile.name || '',
      username: payload.preferred_username || profile.preferred_username || ''
    };

    response.redirect('/');
  });
});

app.listen(Number(PORT), () => {
  console.log(`Example app on http://localhost:${PORT}`);
});
```

Run it with the same redirect URI that is approved in LockIn:

```bash
LOCKIN_ISSUER=https://lockedin.burchweb.com \
LOCKIN_CLIENT_ID=lockin_... \
LOCKIN_CLIENT_SECRET=lks_... \
LOCKIN_REDIRECT_URI=http://localhost:4000/auth/lockin/callback \
SESSION_SECRET=replace-with-a-long-random-value \
node server.js
```

For local development, approve `http://localhost:4000/auth/lockin/callback` in LockIn. For production, use HTTPS and a persistent session store. The default `express-session` memory store is not suitable for a real deployment.

## 7. Security checklist

- Keep the client secret on the server. Never ship it to a browser, mobile binary, or public repository.
- Use HTTPS for the callback. Use HTTP only for loopback development.
- Register exact redirect URLs. Do not accept an arbitrary `redirect_uri` from the request and pass it through to LockIn.
- Use a new `state` for every sign-in and reject a callback whose state does not match.
- Use a new `nonce` for every OpenID sign-in and check it in the ID token.
- Use PKCE with `S256`. This is optional in LockIn SSO but strongly recommended.
- Verify the ID token signature, algorithm, issuer, audience, expiration, and nonce. Do not just decode it.
- Use `sub` as the stable account key. Do not use `preferred_username` as the primary identifier.
- Regenerate the application session after sign-in.
- Store access tokens server-side only. Do not put them in local storage or URLs.
- Rotate the client secret if it may have been exposed. Expect the old secret, codes, and access tokens to stop working.
- Keep the LockIn `data/` volume and signing key private and persistent.
- Add rate limiting and error logging to your callback and token exchange routes.
- Do not log authorization codes, client secrets, access tokens, ID tokens, or full callback URLs in production.

## 8. Limits and operations

| Behavior | Current behavior |
| --- | --- |
| Authorization code lifetime | 60 seconds |
| Access token lifetime | 1 hour |
| ID token lifetime | 1 hour |
| Authorization request lifetime | 10 minutes |
| Refresh tokens | Not supported |
| Token revocation endpoint | Not published |
| RP-initiated logout | Not published |
| Email scope and claim | Not supported |
| Dynamic client registration | Not supported |
| Client credentials grant | Not supported |
| Implicit or hybrid flow | Not supported |
| PKCE methods | `S256` only |
| Authorization response mode | Query string only |
| Redirect URLs per client | 10 |
| Client secret recovery | Not possible; rotate instead |

Authorization requests, authorization codes, and access tokens are kept in memory. Restarting the LockIn process invalidates them. Client registrations and hashed secrets persist in SQLite.

Because grants are in memory, run LockIn as a single application process unless you replace that state with a shared store. Multiple LockIn processes would not see each other's pending consent requests, codes, or access tokens.

Client secret rotation and integration deletion revoke pending requests, codes, and access tokens. Already-issued ID tokens are not revoked individually; their one-hour expiration is the limit.

The ID token signing key is created at `data/.oidc-signing-key.pem` if `OIDC_SIGNING_KEY` is not set. Keep the data volume and key persistent. If the key changes, clients must refetch the JWKS, and ID tokens signed by the old key will no longer verify.

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| LockIn shows "This app is not registered with LockIn SSO." | Wrong or stale `client_id` | Copy the client ID from the Developers page again. |
| LockIn shows "This app requested a redirect URL that has not been approved." | Redirect URL does not exactly match an approved value | Compare the full URL, including scheme, host, port, path, query string, and trailing slash. |
| The callback never arrives | The redirect URL points at the wrong host or port | Use a URL that points at your running app and approve that exact value. |
| "The authorization request expired." | More than 10 minutes passed, the cookie was lost, or the approval came from another browser | Start the sign-in again in the same browser. |
| `invalid_client` | Wrong secret, old secret after rotation, or malformed Basic auth | Check the current secret and the Basic encoding. Try form-body client authentication. |
| `unsupported_grant_type` | Missing or wrong `grant_type` | Send `grant_type=authorization_code`. |
| `invalid_grant` after a code exchange | Code expired, was already used, redirect URI changed, or PKCE verifier is wrong | Start a new authorization flow. A code is consumed after client and grant validation. |
| `invalid_token` from userinfo | Access token expired, LockIn restarted, secret was rotated, or the client was deleted | Obtain a new access token through a new authorization flow. |
| ID token signature verification fails | Cached JWKS is stale, `iss` is wrong, or the signing key changed | Refetch the JWKS and check that `LOCKIN_ISSUER` exactly matches `PUBLIC_URL`. |
| ID token audience verification fails | Using the wrong client ID | Use the same client ID for authorization and token validation. |
| Nonce mismatch | Session was lost or reused | Generate and store a new nonce for every sign-in. |
| `invalid_scope` | Requested a scope other than `openid` or `profile` | Request only `openid` and `profile`. |
| Browser reports a CORS error | Calling token or userinfo from browser JavaScript | Move the request to your server. LockIn SSO is a server-side integration. |
| HTTP redirect URL is rejected | Production URL uses HTTP | Use HTTPS. HTTP is allowed only for localhost and loopback addresses. |

## 10. Quick reference

### Environment

```text
PUBLIC_URL=https://lockedin.burchweb.com
OIDC_SIGNING_KEY=optional-pem-with-escaped-newlines
```

`PUBLIC_URL` is the issuer and discovery base. `ORIGIN` is accepted as a fallback. Set one explicitly in production.

`OIDC_SIGNING_KEY` is optional. If it is not set, LockIn creates `data/.oidc-signing-key.pem`.

### Discovery

```bash
curl -sS https://lockedin.burchweb.com/.well-known/openid-configuration
```

### JWKS

```bash
curl -sS https://lockedin.burchweb.com/.well-known/jwks.json
```

### Token exchange

```bash
curl -sS https://lockedin.burchweb.com/oauth/token \
  -u "$LOCKIN_CLIENT_ID:$LOCKIN_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$LOCKIN_REDIRECT_URI" \
  --data-urlencode "code_verifier=$CODE_VERIFIER"
```

### Userinfo

```bash
curl -sS https://lockedin.burchweb.com/oauth/userinfo \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

### Integration checklist

- [ ] `PUBLIC_URL` is set to the public LockIn origin.
- [ ] The LockIn `data/` volume and signing key are persistent and private.
- [ ] A site admin created an integration with the exact callback URL.
- [ ] The client ID and secret are stored in the client's server environment.
- [ ] The client sends `state`, `nonce`, and an S256 PKCE challenge.
- [ ] The callback validates `state` before exchanging the code.
- [ ] The token request uses the exact redirect URL and verifier.
- [ ] The ID token signature, issuer, audience, expiration, and nonce are verified.
- [ ] The client creates its own session from the verified `sub`.
- [ ] The client does not request email or unsupported scopes.
- [ ] The client handles `access_denied` and token errors without exposing secrets.
