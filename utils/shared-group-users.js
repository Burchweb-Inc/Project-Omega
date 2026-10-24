function sharedGroupUserIds(groups, user, scopeGroupId = '') {
  if (!user?.id) return new Set();

  const sharedGroups = groups.filter(
    (group) => !group.suspendedAt && group.members?.some((member) => member.userId === user.id)
  );

  if (scopeGroupId) {
    const scopeGroup = sharedGroups.find((group) => group.id === scopeGroupId);
    return new Set((scopeGroup?.members || []).map((member) => member.userId));
  }

  return new Set(
    sharedGroups.flatMap((group) => (group.members || []).map((member) => member.userId))
  );
}

module.exports = sharedGroupUserIds;
