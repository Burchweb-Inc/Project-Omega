const GOOGLE_TASKS_API = 'https://tasks.googleapis.com/tasks/v1';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const APPLE_CALDAV_SERVER = process.env.APPLE_CALDAV_SERVER || 'https://caldav.icloud.com';

class IntegrationError extends Error {
  constructor(provider, message, status) {
    super(message);
    this.name = 'IntegrationError';
    this.provider = provider;
    this.status = status;
  }
}

async function responseJson(response, provider) {
  if (!response.ok) throw new IntegrationError(provider, `${provider} returned HTTP ${response.status}.`, response.status);
  return response.json();
}

async function refreshGoogleCredentials(credentials, clientId, clientSecret, fetchImpl = fetch) {
  if (!credentials?.refreshToken) throw new IntegrationError('Google Tasks', 'Google authorization expired. Reconnect your Google account.');
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token'
    })
  });
  const token = await responseJson(response, 'Google OAuth');
  return {
    ...credentials,
    accessToken: token.access_token,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000
  };
}

async function googleRequest(path, accessToken, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${GOOGLE_TASKS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });
  if (!response.ok) throw new IntegrationError('Google Tasks', `Google Tasks returned HTTP ${response.status}.`, response.status);
  if (response.status === 204) return null;
  return response.json();
}

async function listGoogleTasks(taskListId, accessToken, fetchImpl) {
  const tasks = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ maxResults: '100', showCompleted: 'true', showHidden: 'true' });
    if (pageToken) query.set('pageToken', pageToken);
    const page = await googleRequest(`/lists/${encodeURIComponent(taskListId)}/tasks?${query}`, accessToken, {}, fetchImpl);
    tasks.push(...(page.items || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  return tasks;
}

function googleTaskPayload(task) {
  const marker = `[LockIn task:${task.id}]`;
  const notes = [task.details, marker].filter(Boolean).join('\n\n');
  const payload = {
    title: task.title,
    notes,
    status: task.done ? 'completed' : 'needsAction',
    due: task.due && /^\d{4}-\d{2}-\d{2}$/.test(task.due) ? `${task.due}T00:00:00.000Z` : null
  };
  return payload;
}

async function syncGoogleTasks({ tasks, credentials, integration, clientId, clientSecret, fetchImpl = fetch }) {
  let auth = credentials;
  if (auth.expiresAt < Date.now() + 60000) {
    auth = await refreshGoogleCredentials(auth, clientId, clientSecret, fetchImpl);
  }

  const lists = await googleRequest('/users/@me/lists?maxResults=100', auth.accessToken, {}, fetchImpl);
  let taskList = (lists.items || []).find((entry) => entry.id === integration.taskListId);
  taskList ||= (lists.items || []).find((entry) => entry.title === 'LockIn Tasks');
  if (!taskList) {
    taskList = await googleRequest('/users/@me/lists', auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({ title: 'LockIn Tasks' })
    }, fetchImpl);
  }
  const taskListId = taskList.id;

  const remoteTasks = await listGoogleTasks(taskListId, auth.accessToken, fetchImpl);
  const remoteByLockInId = new Map();
  for (const remote of remoteTasks) {
    const marker = String(remote.notes || '').match(/\[LockIn task:([^\]]+)\]/);
    if (marker) remoteByLockInId.set(marker[1], remote.id);
  }
  const taskMap = { ...(integration.taskMap || {}) };
  const activeTaskIds = new Set(tasks.map((task) => task.id));

  for (const task of tasks) {
    const externalId = remoteByLockInId.get(task.id) || taskMap[task.id];
    const payload = googleTaskPayload(task);
    const path = `/lists/${encodeURIComponent(taskListId)}/tasks`;
    let result;
    if (externalId) {
      try {
        result = await googleRequest(`${path}/${encodeURIComponent(externalId)}`, auth.accessToken, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        }, fetchImpl);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    if (!result) {
      result = await googleRequest(path, auth.accessToken, {
        method: 'POST',
        body: JSON.stringify(payload)
      }, fetchImpl);
    }
    taskMap[task.id] = result.id;
  }

  const staleTasks = new Map(Object.entries(taskMap).filter(([taskId]) => !activeTaskIds.has(taskId)));
  for (const [taskId, externalId] of remoteByLockInId) {
    if (!activeTaskIds.has(taskId)) staleTasks.set(taskId, externalId);
  }
  for (const [taskId, externalId] of staleTasks) {
    try {
      await googleRequest(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(externalId)}`, auth.accessToken, {
        method: 'DELETE'
      }, fetchImpl);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    delete taskMap[taskId];
  }

  return { credentials: auth, integration: { taskListId, taskMap } };
}

function xmlEscape(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlUnescape(value) {
  return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function tagContent(xml, localName) {
  const match = String(xml || '').match(new RegExp(`<[^>]*:?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/[^>]*:?${localName}\\s*>`, 'i'));
  return match?.[1] || '';
}

function hrefFromXml(xml) {
  const match = String(xml || '').match(/<(?:[A-Za-z0-9_-]+:)?href(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href\s*>/i);
  return match ? xmlUnescape(match[1].trim()) : '';
}

function responseBlocks(xml) {
  return [...String(xml || '').matchAll(/<(?:[A-Za-z0-9_-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response\s*>/gi)].map((match) => match[1]);
}

function appleAuthHeader(credentials) {
  const password = String(credentials.password || '').replace(/[\s-]/g, '');
  return `Basic ${Buffer.from(`${credentials.username}:${password}`).toString('base64')}`;
}

function isIcloudUrl(value) {
  const url = new URL(value);
  return url.protocol === 'https:' && (url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com'));
}

async function appleRequest(url, credentials, options = {}, fetchImpl = fetch) {
  let target = new URL(url, APPLE_CALDAV_SERVER);
  if (!isIcloudUrl(target.href)) throw new IntegrationError('Apple Reminders', 'Apple returned an unexpected CalDAV address.');
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(target, {
      ...options,
      redirect: 'manual',
      headers: { Authorization: appleAuthHeader(credentials), ...options.headers }
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      if (response.status < 200 || response.status >= 300) {
        const message = response.status === 401 || response.status === 403
          ? 'Apple rejected the iCloud credentials. Use an app-specific password.'
          : `Apple CalDAV returned HTTP ${response.status}.`;
        throw new IntegrationError('Apple Reminders', message, response.status);
      }
      return response;
    }
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new IntegrationError('Apple Reminders', 'Apple CalDAV redirected too many times.');
    target = new URL(location, target);
    if (!isIcloudUrl(target.href)) throw new IntegrationError('Apple Reminders', 'Apple returned an unexpected CalDAV address.');
  }
  throw new IntegrationError('Apple Reminders', 'Apple CalDAV redirected too many times.');
}

async function propfind(url, credentials, depth, body, fetchImpl) {
  const response = await appleRequest(url, credentials, {
    method: 'PROPFIND',
    headers: { Depth: String(depth), 'Content-Type': 'application/xml; charset=utf-8' },
    body
  }, fetchImpl);
  return response.text();
}

async function discoverAppleCalendar(credentials, server = APPLE_CALDAV_SERVER, fetchImpl = fetch) {
  const base = new URL('/.well-known/caldav', server).href;
  const properties = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
  const principalXml = await propfind(base, credentials, 0, properties, fetchImpl);
  const principalHref = hrefFromXml(tagContent(principalXml, 'current-user-principal'));
  if (!principalHref) throw new IntegrationError('Apple Reminders', 'Could not discover the iCloud CalDAV account.');
  const principalUrl = new URL(principalHref, base).href;
  const homeProperties = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
  const homeXml = await propfind(principalUrl, credentials, 0, homeProperties, fetchImpl);
  const homeHref = hrefFromXml(tagContent(homeXml, 'calendar-home-set'));
  if (!homeHref) throw new IntegrationError('Apple Reminders', 'Could not find the iCloud Reminders calendar home.');
  const homeUrl = new URL(homeHref, principalUrl).href;
  const calendarProperties = '<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>';
  const calendarsXml = await propfind(homeUrl, credentials, 1, calendarProperties, fetchImpl);
  const calendars = responseBlocks(calendarsXml).filter((block) =>
    /<[^>]*:?calendar(?:\s[^>]*)?\/?>/i.test(tagContent(block, 'resourcetype')) &&
    /name=["']VTODO["']/i.test(tagContent(block, 'supported-calendar-component-set'))
  );
  if (!calendars.length) throw new IntegrationError('Apple Reminders', 'No iCloud Reminders list that supports tasks was found.');
  const selected = calendars.find((block) => xmlUnescape(tagContent(block, 'displayname')).trim() === 'LockIn Tasks') || calendars[0];
  const calendarHref = hrefFromXml(selected);
  if (!calendarHref) throw new IntegrationError('Apple Reminders', 'Could not read the iCloud Reminders list address.');
  return new URL(calendarHref, homeUrl).href;
}

function icalEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function foldIcalLine(line) {
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const length = Buffer.byteLength(character);
    if (bytes + length > 73) {
      parts.push(current);
      current = ` ${character}`;
      bytes = 1 + length;
    } else {
      current += character;
      bytes += length;
    }
  }
  parts.push(current);
  return parts.join('\r\n');
}

function createVtodo(task) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LockIn//Task Sync//EN', 'BEGIN:VTODO',
    `UID:${icalEscape(`${task.id}@lockin`)}`,
    `SUMMARY:${icalEscape(task.title)}`,
    ...(task.details ? [`DESCRIPTION:${icalEscape(task.details)}`] : []),
    ...(task.due && /^\d{4}-\d{2}-\d{2}$/.test(task.due) ? [`DUE;VALUE=DATE:${task.due.replace(/-/g, '')}`] : []),
    `STATUS:${task.done ? 'COMPLETED' : 'NEEDS-ACTION'}`,
    ...(task.done ? [`COMPLETED:${now}`] : []),
    `DTSTAMP:${now}`, 'END:VTODO', 'END:VCALENDAR'
  ];
  return `${lines.map(foldIcalLine).join('\r\n')}\r\n`;
}

async function syncAppleReminders({ tasks, credentials, integration, server = APPLE_CALDAV_SERVER, fetchImpl = fetch }) {
  const calendarHref = integration.calendarHref || await discoverAppleCalendar(credentials, server, fetchImpl);
  const taskMap = { ...(integration.taskMap || {}) };
  const activeTaskIds = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    const existingHref = taskMap[task.id];
    const itemHref = existingHref || new URL(`${encodeURIComponent(task.id)}@lockin.ics`, calendarHref.endsWith('/') ? calendarHref : `${calendarHref}/`).href;
    await appleRequest(itemHref, credentials, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', ...(existingHref ? {} : { 'If-None-Match': '*' }) },
      body: createVtodo(task)
    }, fetchImpl);
    taskMap[task.id] = itemHref;
  }
  for (const [taskId, itemHref] of Object.entries(taskMap)) {
    if (activeTaskIds.has(taskId)) continue;
    try {
      await appleRequest(itemHref, credentials, { method: 'DELETE' }, fetchImpl);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    delete taskMap[taskId];
  }
  return { calendarHref, taskMap };
}

module.exports = {
  IntegrationError,
  createVtodo,
  discoverAppleCalendar,
  syncAppleReminders,
  syncGoogleTasks
};
