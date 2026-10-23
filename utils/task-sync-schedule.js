const SYNC_INTERVALS = Object.freeze({
  minute: 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
  week: 7 * 24 * 60 * 60_000
});

function isSyncSchedule(schedule) {
  return schedule === 'manual' || Object.hasOwn(SYNC_INTERVALS, schedule);
}

function syncInterval(schedule) {
  return Object.hasOwn(SYNC_INTERVALS, schedule) ? SYNC_INTERVALS[schedule] : null;
}

function isSyncDue(settings, now = Date.now()) {
  const interval = syncInterval(settings?.schedule);
  if (settings?.nextSyncAt === null || settings?.nextSyncAt === undefined || settings.nextSyncAt === '') return false;
  const nextSyncAt = Number(settings.nextSyncAt);
  return Boolean(interval && Number.isFinite(nextSyncAt) && nextSyncAt <= now);
}

module.exports = { isSyncDue, isSyncSchedule, syncInterval };
