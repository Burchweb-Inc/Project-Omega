function loadTaskSyncConfig(environment = process.env, readSecret = () => null) {
  return {
    googleTasks: {
      client_id: environment.GOOGLE_TASKS_CLIENT_ID,
      client_secret: readSecret('google_tasks_client_secret') || environment.GOOGLE_TASKS_CLIENT_SECRET,
      redirect_uri: environment.GOOGLE_TASKS_REDIRECT_URI
    },
    appleReminders: {
      caldav_server: environment.APPLE_CALDAV_SERVER
    }
  };
}

function taskSyncConfiguration(config) {
  const missing = [];
  const google = config?.googleTasks || {};
  const apple = config?.appleReminders || {};

  const configured = (value) => {
    const normalized = String(value || '').trim();
    return normalized && !/^(replace-with-|your-)/i.test(normalized);
  };
  const validUrl = (value, protocols, hostnameCheck = () => true) => {
    if (!configured(value)) return false;
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol) && hostnameCheck(url.hostname);
    } catch (error) {
      return false;
    }
  };

  if (!configured(google.client_id)) missing.push('GOOGLE_TASKS_CLIENT_ID');
  if (!configured(google.client_secret)) missing.push('GOOGLE_TASKS_CLIENT_SECRET');
  if (!validUrl(google.redirect_uri, ['http:', 'https:'])) missing.push('GOOGLE_TASKS_REDIRECT_URI');
  if (!validUrl(apple.caldav_server, ['https:'], (hostname) => hostname === 'icloud.com' || hostname.endsWith('.icloud.com'))) {
    missing.push('APPLE_CALDAV_SERVER');
  }

  return { enabled: missing.length === 0, missing };
}

module.exports = { loadTaskSyncConfig, taskSyncConfiguration };
