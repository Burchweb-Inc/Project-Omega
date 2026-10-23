const test = require('node:test');
const assert = require('node:assert/strict');
const { createVtodo, discoverAppleCalendar, syncAppleReminders, syncGoogleTasks } = require('../utils/task-integrations');

test('Google sync creates a task and stores its remote ID', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/tasks/v1/users/@me/lists?maxResults=100')) {
      return Response.json({ items: [{ id: 'list-1', title: 'LockIn Tasks' }] });
    }
    if (String(url).includes('/tasks/v1/lists/list-1/tasks?')) {
      return Response.json({ items: [] });
    }
    if (String(url).endsWith('/tasks/v1/lists/list-1/tasks')) {
      return Response.json({ id: 'remote-1' }, { status: 201 });
    }
    throw new Error(`Unexpected Google request: ${url}`);
  };
  const result = await syncGoogleTasks({
    tasks: [{ id: 'local-1', title: 'Read notes', details: 'Chapter 4', due: '2026-10-22', done: false }],
    credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 },
    integration: { taskListId: 'list-1', taskMap: {} },
    clientId: 'client',
    clientSecret: 'secret',
    fetchImpl
  });
  assert.equal(result.integration.taskMap['local-1'], 'remote-1');
  const payload = JSON.parse(requests[2].options.body);
  assert.equal(payload.title, 'Read notes');
  assert.match(payload.notes, /Chapter 4/);
  assert.match(payload.notes, /\[LockIn task:local-1\]/);
  assert.equal(payload.due, '2026-10-22T00:00:00.000Z');
});

test('Google sync clears a removed due date and deletes a previously synced task', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/tasks/v1/users/@me/lists?maxResults=100')) {
      return Response.json({ items: [{ id: 'list-1', title: 'LockIn Tasks' }] });
    }
    if (String(url).includes('/tasks/v1/lists/list-1/tasks?')) {
      return Response.json({ items: [{ id: 'remote-1', notes: '[LockIn task:deleted-task]' }] });
    }
    if (String(url).endsWith('/tasks/v1/lists/list-1/tasks/remote-1')) {
      return new Response(null, { status: 204 });
    }
    if (String(url).endsWith('/tasks/v1/lists/list-1/tasks/remote-active')) {
      return Response.json({ id: 'remote-active' });
    }
    throw new Error(`Unexpected Google request: ${url}`);
  };
  const result = await syncGoogleTasks({
    tasks: [{ id: 'active-task', title: 'Read notes', due: 'No date', done: false }],
    credentials: { accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 },
    integration: { taskListId: 'list-1', taskMap: { 'active-task': 'remote-active', 'deleted-task': 'remote-1' } },
    clientId: 'client',
    clientSecret: 'secret',
    fetchImpl
  });
  const update = requests.find((request) => request.options.method === 'PATCH');
  const remove = requests.find((request) => request.options.method === 'DELETE');
  assert.equal(JSON.parse(update.options.body).due, null);
  assert.ok(remove);
  assert.deepEqual(result.integration.taskMap, { 'active-task': 'remote-active' });
});

test('Apple CalDAV discovery finds a VTODO calendar', async () => {
  const responses = [
    `<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop><d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>`,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>`,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/home/reminders/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response></d:multistatus>`
  ];
  const fetchImpl = async () => new Response(responses.shift(), { status: 207 });
  const calendar = await discoverAppleCalendar({ username: 'person@icloud.com', password: 'app-password' }, 'https://caldav.icloud.com', fetchImpl);
  assert.equal(calendar, 'https://caldav.icloud.com/home/reminders/');
});

test('Apple sync creates a valid dated VTODO and remembers its URL', async () => {
  let request;
  const result = await syncAppleReminders({
    tasks: [{ id: 'local-task', title: 'Finish, project', details: 'Write; test', due: '2026-10-22', done: true }],
    credentials: { username: 'person@icloud.com', password: 'app-password' },
    integration: { calendarHref: 'https://caldav.icloud.com/home/tasks/', taskMap: {} },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(null, { status: 201 });
    }
  });
  assert.equal(request.options.method, 'PUT');
  assert.match(request.options.body, /SUMMARY:Finish\\, project/);
  assert.match(request.options.body, /DESCRIPTION:Write\\; test/);
  assert.match(request.options.body, /DUE;VALUE=DATE:20261022/);
  assert.match(request.options.body, /STATUS:COMPLETED/);
  assert.equal(result.taskMap['local-task'], request.url);
});

test('Apple sync removes external reminders deleted from LockIn', async () => {
  const requests = [];
  const result = await syncAppleReminders({
    tasks: [],
    credentials: { username: 'person@icloud.com', password: 'app-password' },
    integration: {
      calendarHref: 'https://caldav.icloud.com/home/tasks/',
      taskMap: { 'deleted-task': 'https://caldav.icloud.com/home/tasks/deleted.ics' }
    },
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return new Response(null, { status: 204 });
    }
  });
  assert.equal(requests[0].options.method, 'DELETE');
  assert.deepEqual(result.taskMap, {});
});

test('VTODO escapes line breaks and special characters', () => {
  const ical = createVtodo({ id: 'task', title: 'Line 1\nLine 2, later', details: 'A; B\\C', due: 'No date', done: false });
  assert.match(ical, /SUMMARY:Line 1\\nLine 2\\, later/);
  assert.match(ical, /DESCRIPTION:A\\; B\\\\C/);
  assert.doesNotMatch(ical, /DUE;/);
});
