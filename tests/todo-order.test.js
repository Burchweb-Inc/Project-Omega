const test = require('node:test');
const assert = require('node:assert/strict');
const { organizeTasks } = require('../utils/todo-order');

test('AI organization ranks high priority first, then due date and saved order', () => {
  const tasks = [
    { id: 'later', priority: 'Normal', due: '2026-12-10', position: 0 },
    { id: 'high-later', priority: 'High', due: '2026-12-10', position: 1 },
    { id: 'high-sooner', priority: 'High', due: '2026-11-20', position: 2 },
    { id: 'medium', priority: 'Medium', due: '2026-11-18', position: 3 },
    { id: 'low', priority: 'Low', due: '2026-11-17', position: 4 }
  ];

  assert.deepEqual(organizeTasks(tasks).map((task) => task.id), [
    'high-sooner',
    'high-later',
    'medium',
    'later',
    'low'
  ]);
  assert.deepEqual(tasks.map((task) => task.id), ['later', 'high-later', 'high-sooner', 'medium', 'low']);
});

test('AI organization keeps earlier saved order for tied priority and due date', () => {
  const tasks = [
    { id: 'second', priority: 'Normal', due: 'No date', position: 5 },
    { id: 'first', priority: 'Normal', due: 'No date', position: 2 }
  ];

  assert.deepEqual(organizeTasks(tasks).map((task) => task.id), ['first', 'second']);
});
