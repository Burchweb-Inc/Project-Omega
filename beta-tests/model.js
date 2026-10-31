function initialize(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS beta_render_gate_failures (
    user_id TEXT PRIMARY KEY,
    window_started_at INTEGER NOT NULL,
    failure_count INTEGER NOT NULL CHECK (failure_count > 0),
    locked_until INTEGER NOT NULL DEFAULT 0
  )`).run();
}

function createGateAttemptModel(db) {
  const nowSeconds = db.prepare("SELECT CAST(strftime('%s', 'now') AS INTEGER) AS now").pluck();
  let getFailure;

  function recordFailure(userId, { maxFailures, windowSeconds }) {
    return db.transaction(() => {
      const now = nowSeconds.get();
      const current = getFailure.get(userId);
      if (current?.locked_until > now) return true;

      const expired = !current || current.window_started_at <= now - windowSeconds;
      const failureCount = expired ? 1 : current.failure_count + 1;
      const lockedUntil = failureCount >= maxFailures ? now + windowSeconds : 0;
      db.prepare(`INSERT INTO beta_render_gate_failures (user_id, window_started_at, failure_count, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          window_started_at = excluded.window_started_at,
          failure_count = excluded.failure_count,
          locked_until = excluded.locked_until`)
        .run(userId, expired ? now : current.window_started_at, failureCount, lockedUntil);
      return lockedUntil > now;
    })();
  }

  return {
    init: () => {
      initialize(db);
      getFailure = db.prepare('SELECT window_started_at, failure_count, locked_until FROM beta_render_gate_failures WHERE user_id = ?');
    },
    isLocked: (userId) => {
      const failure = getFailure.get(userId);
      return Boolean(failure && failure.locked_until > nowSeconds.get());
    },
    recordFailure,
    clear: (userId) => db.prepare('DELETE FROM beta_render_gate_failures WHERE user_id = ?').run(userId).changes > 0,
    pruneExpired: (windowSeconds) => {
      const now = nowSeconds.get();
      return db.prepare(`DELETE FROM beta_render_gate_failures
        WHERE locked_until <= ? AND window_started_at <= ? - ?`).run(now, now, windowSeconds).changes;
    }
  };
}

module.exports = createGateAttemptModel;
