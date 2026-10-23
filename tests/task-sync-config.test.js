const test = require('node:test');
const assert = require('node:assert/strict');
const { taskSyncConfiguration } = require('../utils/task-sync-config');

const readyConfig = {
  googleTasks: {
    client_id: 'client-id.apps.googleusercontent.com',
    client_secret: 'client-secret',
    redirect_uri: 'https://lockin.example/integrations/google/callback'
  },
  appleReminders: { caldav_server: 'https://caldav.icloud.com' }
};

test('enables task syncing only when all integration ENV values are configured', () => {
  assert.deepEqual(taskSyncConfiguration(readyConfig), { enabled: true, missing: [] });
});

test('disables all task syncing and reports missing ENV values', () => {
  assert.deepEqual(taskSyncConfiguration({ googleTasks: {}, appleReminders: {} }), {
    enabled: false,
    missing: [
      'GOOGLE_TASKS_CLIENT_ID',
      'GOOGLE_TASKS_CLIENT_SECRET',
      'GOOGLE_TASKS_REDIRECT_URI',
      'APPLE_CALDAV_SERVER'
    ]
  });
});

test('rejects placeholder values and invalid provider URLs', () => {
  const configuration = taskSyncConfiguration({
    googleTasks: {
      client_id: 'replace-with-google-oauth-client-id',
      client_secret: 'your-secret',
      redirect_uri: 'not-a-url'
    },
    appleReminders: { caldav_server: 'http://caldav.icloud.com' }
  });
  assert.equal(configuration.enabled, false);
  assert.equal(configuration.missing.length, 4);
});

test('requires the Apple CalDAV endpoint to use HTTPS on iCloud', () => {
  const configuration = taskSyncConfiguration({
    ...readyConfig,
    appleReminders: { caldav_server: 'https://example.com' }
  });
  assert.equal(configuration.enabled, false);
  assert.deepEqual(configuration.missing, ['APPLE_CALDAV_SERVER']);
});
