const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');
const fs = require('node:fs');
const path = require('node:path');

function taskFixture(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Study task',
    details: '',
    source: 'Personal task',
    due: 'No date',
    priority: 'Normal',
    done: false,
    position: 0,
    links: [],
    ...overrides
  };
}

async function renderDashboard(tasks) {
  return ejs.renderFile('views/partials/dashboard.ejs', {
    dashboardTab: 'overview',
    user: { id: 'user-1', name: 'Ada', tasks },
    dashboardCourses: [],
    feedItems: [],
    feedPageSize: 10,
    feedHasMore: false,
    feedTotal: 0,
    dashboardGroups: [],
    dashboardModeration: [],
    renderLinkedText: (text) => text
  });
}

test('dashboard personal todo shows pending tasks and celebrates a finished list', async () => {
  const pendingOnly = await renderDashboard([taskFixture({ id: 'task-1', done: false })]);
  assert.match(pendingOnly, /data-task-id="task-1"/, 'Pending personal todo tasks should render on the dashboard.');
  assert.doesNotMatch(pendingOnly, /dashboard-todo-empty/, 'A pending task should replace the empty state.');
  assert.doesNotMatch(pendingOnly, /todo-all-clear/, 'An all clear should not show while tasks are pending.');
  assert.match(pendingOnly, /data-task-count="1"/);
  assert.match(pendingOnly, /data-pending-count="1"/);

  const mixed = await renderDashboard([
    taskFixture({ id: 'task-1', title: 'Pending thing', done: false }),
    taskFixture({ id: 'task-2', title: 'Finished thing', done: true })
  ]);
  assert.match(mixed, /data-task-id="task-1"/, 'Only pending tasks should render as dashboard todo rows.');
  assert.doesNotMatch(mixed, /data-task-id="task-2"/, 'Completed tasks should stay out of the pending dashboard list.');
  assert.doesNotMatch(mixed, /todo-all-clear/, 'The all clear should wait until every task is done.');
  assert.match(mixed, /data-task-count="2"/);
  assert.match(mixed, /data-pending-count="1"/);

  const allClear = await renderDashboard([taskFixture({ id: 'task-1', done: true })]);
  assert.doesNotMatch(allClear, /dashboard-todo-item/, 'A finished personal todo should not list task rows.');
  assert.doesNotMatch(allClear, /dashboard-todo-empty/, 'A finished personal todo should not show the empty state.');
  assert.match(allClear, /data-todo-all-clear/, 'A finished personal todo should celebrate with the all clear panel.');
  assert.match(allClear, /src="\/media\/todo-all-clear\.png"/, 'The all clear panel should use the completed tasks image.');
  assert.match(allClear, /data-task-count="1"/);
  assert.match(allClear, /data-pending-count="0"/);

  const empty = await renderDashboard([]);
  assert.match(empty, /dashboard-todo-empty/, 'A personal todo without tasks should show the friendly empty state.');
  assert.doesNotMatch(empty, /todo-all-clear/, 'The all clear should not show without tasks.');
});

test('Todo all clear copy revolves through quirky quotes', async () => {
  const tasks = [{ id: 'task-1', title: 'Study task', details: '', source: 'Personal task', due: 'No date', priority: 'Normal', done: true, position: 0, links: [] }];
  const html = await ejs.renderFile('views/partials/todo.ejs', {
    user: { tasks, settings: {} },
    todoPageSize: 10,
    todoDateTimezone: 'UTC',
    todoDateLocale: 'en-US',
    formatTaskDate: () => 'No date',
    renderLinkedText: (text) => text,
    integrationStatus: '',
    taskSyncConfigured: false,
    taskSyncMissingConfig: 'missing configuration',
    googleTasksConnected: false,
    googleTasksConfigured: false,
    appleRemindersConnected: false,
    appleRemindersUsername: ''
  });

  assert.match(html, /data-todo-all-clear/, 'A finished personal todo should celebrate with the all clear panel.');
  assert.match(html, /data-todo-all-clear-title/, 'The all clear heading should expose a rotating copy hook.');
  assert.match(html, /data-todo-all-clear-message/, 'The all clear message should expose a rotating copy hook.');
  assert.match(html, /Wow\. Someone locked in!/, 'The all clear heading should start with the first rotating quote.');
  assert.match(html, /Now take some time to do what you like/, 'The all clear message should start with the first rotating quote.');

  const todoSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'todo.js'), 'utf8');
  assert.match(todoSource, /Math\.random/, 'The all clear copy should revolve through random quirky quotes.');
  assert.match(todoSource, /setInterval\(rotateTodoAllClearQuote, 60000\)/, 'The all clear copy should revolve every minute.');
});

test('Todo all clear celebrates only an empty pending queue', async () => {
  const todoSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'todo.js'), 'utf8');
  assert.match(todoSource, /function todoCelebrationApplies/, 'The all clear should sit behind a pending queue guard.');
  assert.match(todoSource, /const showAllClear = todoCelebrationApplies\(list\) && taskCount > 0 && pendingCount === 0;/, 'The all clear should celebrate only once the pending queue is finished.');
  assert.match(todoSource, /if \(filter === 'pending'\) void loadPendingTasksIfNeeded\(\);\s*syncTodoSummary\(\);/, 'Switching the todo filter should refresh the all clear state.');
  assert.match(todoSource, /row\.hidden = true;/, 'Finishing the pending queue should park task rows instead of dropping them for other tabs.');
});

test('Todo renders ten initial tasks and exposes focus mode', async () => {
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    id: `task-${index}`,
    title: `Study task ${index}`,
    details: '',
    source: 'Personal study goal',
    due: 'No date',
    priority: 'Normal',
    done: false,
    position: index
  }));
  const html = await ejs.renderFile('views/partials/todo.ejs', {
    user: { tasks, settings: {} },
    todoPageSize: 10,
    todoDateTimezone: 'UTC',
    todoDateLocale: 'en-US',
    formatTaskDate: () => 'No date',
    renderLinkedText: (text) => text,
    integrationStatus: '',
    taskSyncConfigured: false,
    taskSyncMissingConfig: 'missing configuration',
    googleTasksConnected: false,
    googleTasksConfigured: false,
    appleRemindersConnected: false,
    appleRemindersUsername: ''
  });

  assert.equal((html.match(/<article class="private-task/g) || []).length, 10);
  assert.doesNotMatch(html, /Personal study goal/);
  assert.match(html, /data-pending-count="12"/);
  assert.match(html, /data-offset="10" data-has-more="true"/);
  assert.match(html, /data-focus-mode/);
  assert.match(html, /data-focus-screen/);
  assert.match(html, /data-focus-fullscreen/);
  assert.match(html, /data-focus-sidebar-toggle aria-expanded="false"/);
  assert.match(html, /href="\/todo" data-focus-exit aria-label="Exit focus mode"/);
  assert.match(html, /id="focus-picker-panel"/);
  assert.match(html, /data-focus-picker-panel aria-label="Wallpaper collections" aria-hidden="true" inert/);
  assert.match(html, />Recommended</);
  assert.match(html, />Collections</);
});
