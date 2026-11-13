const pageSize = 50;

function siteAdminUserPage(users, query = '', offset = 0) {
  const normalizedQuery = String(query).trim().toLowerCase();
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const matchingUsers = users
    .filter((user) => !normalizedQuery || `${user.name} ${user.username}`.toLowerCase().includes(normalizedQuery))
    .sort((left, right) => left.username.localeCompare(right.username));
  const managedUsers = matchingUsers.slice(start, start + pageSize);

  return {
    managedUsers,
    managedUserTotal: matchingUsers.length,
    hasMore: start + managedUsers.length < matchingUsers.length
  };
}

module.exports = siteAdminUserPage;
