const test = require('node:test');
const assert = require('node:assert/strict');
const ejs = require('ejs');

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
