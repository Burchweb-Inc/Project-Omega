const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const createGateAttemptModel = require('../beta-tests/model');

test('persists render-gate lockouts and only clears the selected account', (context) => {
  const db = new Database(':memory:');
  const model = createGateAttemptModel(db);
  context.after(() => db.close());

  model.init();
  model.init();
  db.prepare(`INSERT INTO beta_render_gate_failures
    (user_id, window_started_at, failure_count, locked_until)
    VALUES ('unrelated-user', CAST(strftime('%s', 'now') AS INTEGER), 1, 0)`).run();

  assert.equal(model.isLocked('user-1'), false);
  assert.equal(model.recordFailure('user-1', { maxFailures: 2, windowSeconds: 900 }), false);
  assert.equal(model.recordFailure('user-1', { maxFailures: 2, windowSeconds: 900 }), true);
  assert.equal(model.isLocked('user-1'), true);
  assert.equal(model.clear('user-1'), true);
  assert.equal(model.isLocked('user-1'), false);
  assert.deepEqual(
    db.prepare('SELECT user_id FROM beta_render_gate_failures ORDER BY user_id').pluck().all(),
    ['unrelated-user']
  );
});
