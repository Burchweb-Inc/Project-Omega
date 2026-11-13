# StudyHub

A student-first EJS collaboration workspace for course feeds, peer verification, private Todo queues, academic calendar planning, and breakout project groups. It is ad-free, school-network friendly, and uses persistent SQLite storage.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. On startup, the app creates the ignored `data/` directory, SQLite database, and missing runtime keys. The 32-byte `data/.task-encryption-key` encrypts personal task payloads at rest with AES-256-GCM; `data/.build-id-key` supports build ID decoding. Both keys are created with owner-only permissions. Keep the data volume persistent in production: losing either key makes its associated stored data or historical build IDs unreadable.

## Task integrations

The Todo page can sync each user's personal tasks to Google Tasks and Apple Reminders. Open the sync icon to connect services, sync immediately, or choose manual, every minute, every hour, every 24 hours, or weekly sync. Syncing is disabled entirely unless all Google OAuth values and `APPLE_CALDAV_SERVER` are configured with valid values. LockIn is authoritative: task changes and deletions are pushed out, while changes made in the external app are not imported. Automatic sync runs in the LockIn app process, so it pauses while the service is stopped. Use the sample values in `.env.example` as a starting point:

- For Google Tasks, enable the Google Tasks API, create an OAuth web application, and set `GOOGLE_TASKS_CLIENT_ID`, `GOOGLE_TASKS_CLIENT_SECRET`, and `GOOGLE_TASKS_REDIRECT_URI`. Register the exact redirect URI in Google Cloud, such as `http://localhost:3000/integrations/google/callback` for local development. Each user authorizes their own Google account. LockIn stores a task ID marker in each synced Google task's notes so future syncs can update or remove the right task.
- For Apple Reminders, set `APPLE_CALDAV_SERVER=https://caldav.icloud.com`. Each user connects their own Apple ID from the Todo page with an Apple app-specific password, available from [Apple Account](https://account.apple.com/). LockIn uses an existing “LockIn Tasks” list when found, otherwise it uses the first Reminders list that supports tasks. The password and Google tokens are encrypted at rest using `TASK_ENCRYPTION_KEY` (or the local development key). The user must reconnect if that encryption key is lost or changed.

In production, set `GOOGLE_TASKS_CLIENT_ID` and `GOOGLE_TASKS_REDIRECT_URI` in the deployment environment and register the production callback URL with Google. For the Jenkins deployment, those two values must be available to the Jenkins agent environment; the pipeline injects `GOOGLE_TASKS_CLIENT_SECRET` as a credential, and Docker Compose mounts it as the `google_tasks_client_secret` Docker secret. The app falls back to the environment variable outside that deployment. Apple credentials are per-user and are not shared through environment variables.

## LockIn SSO

LockIn can act as its own OpenID Connect identity provider for other Burchweb apps. Site admins create integrations from **Site Admin > Developers**. Each integration receives a client ID, a client secret that is shown only once, and an exact list of approved redirect URLs. Rotating a secret immediately invalidates that integration's authorization codes and access tokens.

Set `PUBLIC_URL` to the public origin of the deployment, for example `https://lockedin.burchweb.com`. It is required in production and must be a bare HTTPS origin. The app uses it as the OpenID issuer and discovery base. The discovery document is available at `/.well-known/openid-configuration`, and the JWKS at `/.well-known/jwks.json`. The provider supports the authorization code flow, `openid` and `profile` scopes, client secrets through HTTP Basic or form body, and optional PKCE with S256.

Clients authorize against `/oauth/authorize`, exchange codes at `/oauth/token`, and read claims from `/oauth/userinfo`. Redirect URLs must use HTTPS unless they point at localhost. LockIn creates `data/.oidc-signing-key.pem` on first start; keep it private and persistent so issued ID tokens remain verifiable across deploys. The admin console shows the exact endpoints and redirect URLs for each integration. See [the full LockIn SSO integration guide](docs/lockin-sso-integration.md) for the complete client flow, endpoint reference, Node.js example, security checklist, and troubleshooting.

Only site admins can manage SSO integrations. Automatic promotion of the username `admin` is disabled outside `NODE_ENV=development`; use the first-admin bootstrap below for a new production database.

For a brand-new production database, set `BOOTSTRAP_ADMIN_USERNAME`, `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters), and optionally `BOOTSTRAP_ADMIN_NAME` for the first boot. The app creates a site admin only when the users table is completely empty. Remove `BOOTSTRAP_ADMIN_PASSWORD` after the account exists. If the database already has users but no admin, promote an existing account directly in the database.

## Themes and artist access

Users can choose admin-approved themes from the Theme Marketplace. Site admins grant Artist Mode from User Management. Artists can edit draft themes in a full-screen studio with a live LockIn preview, AI color suggestions (including hover states), CSS copy/paste, and scoped Replace All styling for matching LockIn UI classes. The LockUI gallery is available as a dedicated studio preview, and Shift-clicking safe links lets artists inspect other account-accessible pages. Per-element styling uses the same page-specific selectors in the studio and on the live site. Artists can edit published themes and submit updates for review; the published version remains available until an update is approved, and rejected drafts and their artwork remain available for edits. Artist and admin previews use the signed-in account in a read-only, sandboxed LockIn frame. Preview links require both a short-lived HttpOnly cookie and a matching random URL token scoped to that account.

## Request protection

All unsafe HTTP methods (POST, PUT, PATCH, and DELETE) require a same-origin `Origin` or `Referer` when a browser session cookie is present. The app's live forms use the `X-Live-Request` fetch header, which a cross-site HTML form cannot set. Server-to-server clients without browser cookies remain allowed. Mutations are rate limited per IP: 240 per minute generally and 30 per minute for login, signup, SSO consent, and token exchange. Tune these with `MUTATION_RATE_LIMIT`, `AUTH_RATE_LIMIT`, and `MUTATION_RATE_WINDOW_MS`. The counters are in memory, so a restart clears them and multiple app processes do not share them.

When a reverse proxy terminates TLS, set `TRUST_PROXY` to the number of trusted proxy hops. The included nginx example uses one hop, and the production compose file sets `TRUST_PROXY=1`. It also binds port 8891 to localhost so the app is reachable only through that proxy. Leave `TRUST_PROXY` unset when the app port is directly reachable, because a trusted proxy header can otherwise be spoofed.

## Production privacy and storage

This app currently has no hosted cloud service. For durable cloud storage, deploy it with `DATA_DIR` mapped to a persistent private volume and set `TASK_ENCRYPTION_KEY` to a stable 32-byte base64url-encoded secret managed by the deployment platform. Use HTTPS, restrict access to the database volume, and back up both the database and encryption secret independently. Losing the secret makes encrypted tasks unrecoverable.

The signup flow rejects accounts younger than 13, but COPPA compliance also requires product, legal, consent, retention, deletion, and operational controls that cannot be established by this code alone. Obtain legal/privacy review before accepting children’s data.

## Content moderation

Moderated titles, tasks, comments, and resources use the local regex scanner, the newline-delimited list in `moderation/bad-words.txt`, utilityfueled's `content-checker`, and Iffy-style structured review through OpenRouter. Set `OPENROUTER_API_KEY` to enable `nvidia/nemotron-3.5-content-safety:free`; without a key, the local scanners remain active. A `429` response falls back to strict local matching.

When moderators or admins remove content, the removed text is appended to `moderation/bad-word-queue.txt` with a checkpoint in `moderation/bad-word-checkpoint.txt`. Every `BAD_WORD_REVIEW_INTERVAL_MINUTES` minutes (or directly via `BAD_WORD_REVIEW_INTERVAL_MS`), the app sends only unchecked queue entries to OpenRouter using the instructions in `moderation/ai-mod-instructions.txt` and then advances the checkpoint. The AI keeps only genuinely harmful words and writes them to `moderation/bad-words.txt` as one-per-line entries.

Comments live in `moderation/comments.js`. Authors can edit their own comments, edits retain a version history, and group/site admins can reveal that history or remove comments. Comment actions are available from the small three-dot menu.

URL submissions are checked against the historical NSFW URL corpus from [EBazarov/nsfw_data_source_urls](https://github.com/EBazarov/nsfw_data_source_urls). For a complete local corpus, set `NSFW_URL_LIST_PATH` to a downloaded newline-delimited corpus. `NSFW_URL_SOURCE_URL` can point at a smaller raw corpus file for development; it defaults to a representative source file because the upstream repository contains more than 1.5 million URLs.
