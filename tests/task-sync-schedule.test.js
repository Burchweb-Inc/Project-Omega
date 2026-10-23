const test = require('node:test');
const assert = require('node:assert/strict');
const { isSyncDue, isSyncSchedule, syncInterval } = require('../utils/task-sync-schedule');

test('accepts manual and the supported automatic sync schedules', () => {
  assert.equal(isSyncSchedule('manual'), true);
  assert.equal(isSyncSchedule('minute'), true);
  assert.equal(isSyncSchedule('hour'), true);
  assert.equal(isSyncSchedule('day'), true);
  assert.equal(isSyncSchedule('week'), true);
  assert.equal(isSyncSchedule('second'), false);
});

test('uses the requested sync interval durations', () => {
  assert.equal(syncInterval('manual'), null);
  assert.equal(syncInterval('minute'), 60_000);
  assert.equal(syncInterval('hour'), 3_600_000);
  assert.equal(syncInterval('day'), 86_400_000);
  assert.equal(syncInterval('week'), 604_800_000);
});

test('runs only non-manual schedules when the saved sync time is due', () => {
  const now = 1_800_000_000_000;
  assert.equal(isSyncDue({ schedule: 'manual', nextSyncAt: now - 1 }, now), false);
  assert.equal(isSyncDue({ schedule: 'hour', nextSyncAt: now + 1 }, now), false);
  assert.equal(isSyncDue({ schedule: 'minute', nextSyncAt: now }, now), true);
  assert.equal(isSyncDue({ schedule: 'week', nextSyncAt: now - 1 }, now), true);
  assert.equal(isSyncDue({ schedule: 'day' }, now), false);
  assert.equal(isSyncDue({ schedule: 'hour', nextSyncAt: null }, now), false);
});
