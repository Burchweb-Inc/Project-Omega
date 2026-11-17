const PRIORITY_RANK = {
  high: 0,
  medium: 1,
  normal: 2,
  low: 3
};

function dueOrder(task) {
  if (!task.due || task.due === 'No date') return Number.MAX_SAFE_INTEGER;
  const timestamp = Date.parse(`${task.due}T00:00:00Z`);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function organizeTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const leftPriority = PRIORITY_RANK[String(left.priority || 'normal').toLowerCase()] ?? PRIORITY_RANK.normal;
    const rightPriority = PRIORITY_RANK[String(right.priority || 'normal').toLowerCase()] ?? PRIORITY_RANK.normal;
    const priority = leftPriority - rightPriority;
    if (priority) return priority;
    const due = dueOrder(left) - dueOrder(right);
    if (due) return due;
    return (Number(left.position) || 0) - (Number(right.position) || 0);
  });
}

module.exports = { organizeTasks };
