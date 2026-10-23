# StudyHub

A student-first EJS collaboration workspace for course feeds, peer verification, private Todo queues, academic calendar planning, and breakout project groups. It is ad-free, school-network friendly, and uses persistent SQLite storage.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Data is stored in `data/studyline.db`; personal task payloads are encrypted at rest with AES-256-GCM. A local 32-byte key is created at `data/.task-encryption-key` with owner-only permissions for development.

## Task integrations

The Todo page can sync each user's personal tasks to Google Tasks and Apple Reminders. Open the sync icon to connect services, sync immediately, or choose manual, every minute, every hour, every 24 hours, or weekly sync. Syncing is disabled entirely unless all Google OAuth values and `APPLE_CALDAV_SERVER` are configured with valid values. LockIn is authoritative: task changes and deletions are pushed out, while changes made in the external app are not imported. Automatic sync runs in the LockIn app process, so it pauses while the service is stopped. Use the sample values in `.env.example` as a starting point:

- For Google Tasks, enable the Google Tasks API, create an OAuth web application, and set `GOOGLE_TASKS_CLIENT_ID`, `GOOGLE_TASKS_CLIENT_SECRET`, and `GOOGLE_TASKS_REDIRECT_URI`. Register the exact redirect URI in Google Cloud, such as `http://localhost:3000/integrations/google/callback` for local development. Each user authorizes their own Google account. LockIn stores a task ID marker in each synced Google task's notes so future syncs can update or remove the right task.
- For Apple Reminders, set `APPLE_CALDAV_SERVER=https://caldav.icloud.com`. Each user connects their own Apple ID from the Todo page with an Apple app-specific password, available from [Apple Account](https://account.apple.com/). LockIn uses an existing “LockIn Tasks” list when found, otherwise it uses the first Reminders list that supports tasks. The password and Google tokens are encrypted at rest using `TASK_ENCRYPTION_KEY` (or the local development key). The user must reconnect if that encryption key is lost or changed.

In production, set the Google environment variables in the deployment environment and register the production callback URL with Google. Apple credentials are per-user and are not shared through environment variables.

## Production privacy and storage

This app currently has no hosted cloud service. For durable cloud storage, deploy it with `DATA_DIR` mapped to a persistent private volume and set `TASK_ENCRYPTION_KEY` to a stable 32-byte base64url-encoded secret managed by the deployment platform. Use HTTPS, restrict access to the database volume, and back up both the database and encryption secret independently. Losing the secret makes encrypted tasks unrecoverable.

The signup flow rejects accounts younger than 13, but COPPA compliance also requires product, legal, consent, retention, deletion, and operational controls that cannot be established by this code alone. Obtain legal/privacy review before accepting children’s data.

## Content moderation

Moderated titles, tasks, comments, and resources use the local regex scanner, the newline-delimited list in `moderation/bad-words.txt`, utilityfueled's `content-checker`, and Iffy-style structured review through OpenRouter. Set `OPENROUTER_API_KEY` to enable `nvidia/nemotron-3.5-content-safety:free`; without a key, the local scanners remain active. A `429` response falls back to strict local matching.

When moderators or admins remove content, the removed text is appended to `moderation/bad-word-queue.txt` with a checkpoint in `moderation/bad-word-checkpoint.txt`. Every `BAD_WORD_REVIEW_INTERVAL_MINUTES` minutes (or directly via `BAD_WORD_REVIEW_INTERVAL_MS`), the app sends only unchecked queue entries to OpenRouter using the instructions in `moderation/ai-mod-instructions.txt` and then advances the checkpoint. The AI keeps only genuinely harmful words and writes them to `moderation/bad-words.txt` as one-per-line entries.

Comments live in `moderation/comments.js`. Authors can edit their own comments, edits retain a version history, and group/site admins can reveal that history or remove comments. Comment actions are available from the small three-dot menu.

URL submissions are checked against the historical NSFW URL corpus from [EBazarov/nsfw_data_source_urls](https://github.com/EBazarov/nsfw_data_source_urls). For a complete local corpus, set `NSFW_URL_LIST_PATH` to a downloaded newline-delimited corpus. `NSFW_URL_SOURCE_URL` can point at a smaller raw corpus file for development; it defaults to a representative source file because the upstream repository contains more than 1.5 million URLs.
