const assert = require('node:assert/strict');
const test = require('node:test');
const sharedGroupUserIds = require('../utils/shared-group-users');

test('returns only members of active groups shared with the user', () => {
  const groups = [
    { id: 'shared', members: [{ userId: 'me' }, { userId: 'classmate' }] },
    { id: 'unrelated', members: [{ userId: 'stranger' }] },
    { id: 'locked', suspendedAt: '2026-01-01', members: [{ userId: 'me' }, { userId: 'locked-peer' }] }
  ];

  assert.deepEqual([...sharedGroupUserIds(groups, { id: 'me' })].sort(), ['classmate', 'me']);
});

test('returns no users when the current user has no shared groups', () => {
  const groups = [{ id: 'other', members: [{ userId: 'stranger' }] }];

  assert.deepEqual([...sharedGroupUserIds(groups, { id: 'me' })], []);
  assert.deepEqual([...sharedGroupUserIds(groups, null)], []);
});

test('deduplicates users who share multiple groups', () => {
  const groups = [
    { id: 'one', members: [{ userId: 'me' }, { userId: 'classmate' }] },
    { id: 'two', members: [{ userId: 'me' }, { userId: 'classmate' }] }
  ];

  assert.deepEqual([...sharedGroupUserIds(groups, { id: 'me' })].sort(), ['classmate', 'me']);
});

test('limits scoped searches to members of a group the user belongs to', () => {
  const groups = [
    { id: 'one', members: [{ userId: 'me' }, { userId: 'classmate' }] },
    { id: 'two', members: [{ userId: 'me' }, { userId: 'other-classmate' }] }
  ];

  assert.deepEqual([...sharedGroupUserIds(groups, { id: 'me' }, 'one')].sort(), ['classmate', 'me']);
  assert.deepEqual([...sharedGroupUserIds(groups, { id: 'me' }, 'not-joined')], []);
});
