const assert = require('node:assert/strict');
const test = require('node:test');
const siteAdminUserPage = require('../utils/site-admin-user-page');

const users = Array.from({ length: 123 }, (_, index) => ({
  id: `user-${String(index).padStart(3, '0')}`,
  name: `Member ${index}`,
  username: `member_${String(index).padStart(3, '0')}`
}));

test('limits each user management page to 50 sorted accounts', () => {
  const firstPage = siteAdminUserPage(users);

  assert.equal(firstPage.managedUsers.length, 50);
  assert.equal(firstPage.managedUserTotal, 123);
  assert.equal(firstPage.hasMore, true);
  assert.equal(firstPage.managedUsers[0].username, 'member_000');
  assert.equal(firstPage.managedUsers[49].username, 'member_049');
});

test('returns the next batch without repeating users', () => {
  const secondPage = siteAdminUserPage(users, '', 50);

  assert.equal(secondPage.managedUsers.length, 50);
  assert.equal(secondPage.managedUsers[0].username, 'member_050');
  assert.equal(secondPage.hasMore, true);
});

test('does not expose another page when there are exactly 50 total users', () => {
  const page = siteAdminUserPage(users.slice(0, 50));

  assert.equal(page.managedUsers.length, 50);
  assert.equal(page.managedUserTotal, 50);
  assert.equal(page.hasMore, false);
});

test('searches by name or username before applying pagination', () => {
  const page = siteAdminUserPage(users, 'MEMBER 12', 0);

  assert.deepEqual(page.managedUsers.map((user) => user.username), [
    'member_012',
    'member_120',
    'member_121',
    'member_122'
  ]);
  assert.equal(page.managedUserTotal, 4);
  assert.equal(page.hasMore, false);
});
