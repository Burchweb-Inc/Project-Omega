# StudyHub

A student-first EJS collaboration workspace for course feeds, peer verification, private Todo queues, academic calendar planning, and breakout project groups. It is ad-free, school-network friendly, and uses persistent SQLite storage.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000`. Data is stored in `data/studyline.db`; personal task payloads are encrypted at rest with AES-256-GCM. A local 32-byte key is created at `data/.task-encryption-key` with owner-only permissions for development.

## Production privacy and storage

This app currently has no hosted cloud service. For durable cloud storage, deploy it with `DATA_DIR` mapped to a persistent private volume and set `TASK_ENCRYPTION_KEY` to a stable 32-byte base64url-encoded secret managed by the deployment platform. Use HTTPS, restrict access to the database volume, and back up both the database and encryption secret independently. Losing the secret makes encrypted tasks unrecoverable.

The signup flow rejects accounts younger than 13, but COPPA compliance also requires product, legal, consent, retention, deletion, and operational controls that cannot be established by this code alone. Obtain legal/privacy review before accepting children’s data.
