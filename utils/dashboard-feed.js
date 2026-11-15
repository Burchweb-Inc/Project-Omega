'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD_FEED_PAGE_SIZE = 10;
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, normal: 3, low: 4 };
const TYPE_RANK = { 'upcoming test': 0, test: 0, project: 1, homework: 2, event: 3 };

function dueDistance(item, today) {
  const due = item?.due;
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return Number.POSITIVE_INFINITY;
  const dueAt = Date.parse(`${due}T00:00:00.000Z`);
  if (!Number.isFinite(dueAt) || new Date(dueAt).toISOString().slice(0, 10) !== due) return Number.POSITIVE_INFINITY;
  return Math.abs(dueAt - today) / DAY_MS;
}

function rank(map, value) {
  const key = String(value || '').trim().toLowerCase();
  return Object.hasOwn(map, key) ? map[key] : Number.MAX_SAFE_INTEGER;
}

function sortDashboardFeedItems(items, now = new Date()) {
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return items.map((item) => ({
    item,
    distance: dueDistance(item, today),
    priority: rank(PRIORITY_RANK, item.priority),
    type: rank(TYPE_RANK, item.type),
    confirmations: (item.verifiedBy || []).length,
    comments: (item.comments || []).filter((comment) => !comment.reported).length
  })).sort((a, b) =>
    a.distance - b.distance
    || a.priority - b.priority
    || a.type - b.type
    || b.confirmations - a.confirmations
    || b.comments - a.comments
    || String(a.item.id || '').localeCompare(String(b.item.id || ''))
  ).map(({ item }) => item);
}

function dashboardFeedPage(items, offset) {
  const pageItems = items.slice(offset, offset + DASHBOARD_FEED_PAGE_SIZE);
  return {
    items: pageItems,
    total: items.length,
    hasMore: offset + pageItems.length < items.length
  };
}

module.exports = { DASHBOARD_FEED_PAGE_SIZE, dashboardFeedPage, sortDashboardFeedItems };
