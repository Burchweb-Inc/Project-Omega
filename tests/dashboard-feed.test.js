'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DASHBOARD_FEED_PAGE_SIZE, dashboardFeedPage, sortDashboardFeedItems } = require('../utils/dashboard-feed');

test('dashboard feed ranks by closest due date before importance', () => {
  const now = new Date('2026-11-14T12:00:00.000Z');
  const items = [
    { id: 'later-test', type: 'Upcoming test', due: '2026-11-18' },
    { id: 'tomorrow-homework', type: 'Homework', due: '2026-11-15' },
    { id: 'yesterday-project', type: 'Project', due: '2026-11-13' },
    { id: 'no-date', type: 'Homework', due: 'No date' }
  ];

  assert.deepEqual(sortDashboardFeedItems(items, now).map((item) => item.id), [
    'yesterday-project',
    'tomorrow-homework',
    'later-test',
    'no-date'
  ]);
});

test('dashboard feed breaks equal-date ties by importance and activity', () => {
  const now = new Date('2026-11-14T12:00:00.000Z');
  const items = [
    { id: 'homework', type: 'Homework', due: '2026-11-16', verifiedBy: [] },
    { id: 'test', type: 'Upcoming test', due: '2026-11-16', verifiedBy: [] },
    { id: 'high-priority', type: 'Homework', due: '2026-11-16', priority: 'High' },
    { id: 'confirmed-project', type: 'Project', due: '2026-11-16', verifiedBy: ['a', 'b'] },
    { id: 'confirmed-homework', type: 'Homework', due: '2026-11-16', verifiedBy: ['a'] },
    { id: 'active-homework', type: 'Homework', due: '2026-11-16', comments: [{}, {}] }
  ];

  assert.deepEqual(sortDashboardFeedItems(items, now).map((item) => item.id), [
    'high-priority',
    'test',
    'confirmed-project',
    'confirmed-homework',
    'active-homework',
    'homework'
  ]);
});

test('dashboard feed places invalid dates with undated items and sorts deterministically', () => {
  const now = new Date('2026-11-14T12:00:00.000Z');
  const items = [
    { id: 'z', type: 'Homework', due: '2026-02-31' },
    { id: 'b', type: 'Homework', due: 'No date' },
    { id: 'a', type: 'Homework', due: 'No date' }
  ];

  assert.deepEqual(sortDashboardFeedItems(items, now).map((item) => item.id), ['a', 'b', 'z']);
});

test('dashboard feed pages contain ten items and report whether more remain', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({ id: String(index) }));
  const first = dashboardFeedPage(items, 0);
  const second = dashboardFeedPage(items, DASHBOARD_FEED_PAGE_SIZE);
  const last = dashboardFeedPage(items, 20);

  assert.equal(first.items.length, 10);
  assert.equal(first.hasMore, true);
  assert.equal(second.items.length, 10);
  assert.equal(second.hasMore, true);
  assert.equal(last.items.length, 5);
  assert.equal(last.hasMore, false);
});
