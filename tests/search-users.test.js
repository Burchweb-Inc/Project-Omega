const assert = require('node:assert/strict');
const test = require('node:test');
const searchUsers = require('../utils/search-users');

const users = [
  { id: 'current-member', name: 'Alex Member', username: 'alex' },
  { id: 'former-member', name: 'Sam Former', username: 'sam' },
  { id: 'new-user', name: 'Taylor New', username: 'taylor' }
];

test('searches matching users even when they have no shared-group history', () => {
  assert.deepEqual(searchUsers(users, 'taylor'), [
    { id: 'new-user', name: 'Taylor New', username: 'taylor' }
  ]);
});

test('can scope matching users to members of an existing group', () => {
  assert.deepEqual(searchUsers(users, 'a', new Set(['current-member', 'former-member'])), [
    { id: 'current-member', name: 'Alex Member', username: 'alex' },
    { id: 'former-member', name: 'Sam Former', username: 'sam' }
  ]);
});

test('limits user search results to eight accounts', () => {
  const manyUsers = Array.from({ length: 10 }, (_, index) => ({
    id: `user-${index}`,
    name: `User ${index}`,
    username: `user${index}`
  }));

  assert.equal(searchUsers(manyUsers, 'user').length, 8);
});
