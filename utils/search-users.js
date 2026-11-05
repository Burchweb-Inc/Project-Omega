function searchUsers(users, query, visibleUserIds = null) {
  return users
    .filter((candidate) => {
      const username = String(candidate.username || '').toLowerCase();
      const name = String(candidate.name || '').toLowerCase();
      return (!visibleUserIds || visibleUserIds.has(candidate.id)) &&
        (username.includes(query) || name.includes(query));
    })
    .slice(0, 8)
    .map((candidate) => ({ id: candidate.id, name: candidate.name, username: candidate.username }));
}

module.exports = searchUsers;
