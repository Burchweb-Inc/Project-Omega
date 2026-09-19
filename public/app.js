const routeProgress = document.createElement('div');
routeProgress.className = 'route-progress';
document.body.appendChild(routeProgress);

const liveState = { socket: null, notificationSocket: null, pending: new Map() };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function courseRoot() { return document.querySelector('[data-course-live]'); }
function itemCard(item) {
  const typeClass = String(item.type || '').toLowerCase().replace(/[^a-z]/g, '-');
  const root = courseRoot(); const orgId = escapeHtml(root.dataset.orgId); const itemId = escapeHtml(item.id); const projectAction = item.type === 'Project' ? `<form data-live-form action="/groups" method="post"><input type="hidden" name="orgId" value="${orgId}"><input type="hidden" name="courseId" value="${escapeHtml(root.dataset.courseId)}"><input type="hidden" name="itemId" value="${itemId}"><button class="text-button breakout-action" type="submit"><i data-lucide="users-round"></i> Create Breakout Group</button></form>` : ''; const downvoteAction = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${orgId}/items/${itemId}/downvote" method="post"><button class="text-button" type="submit"><i data-lucide="thumbs-down"></i> <span data-downvote-count>${(item.downvotedBy || []).length}</span></button></form>` : '';
  const dragHandle = root.dataset.canEdit === 'true' ? `<button class="icon-button course-drag-handle" type="button" aria-label="Move ${escapeHtml(item.title)}"><i data-lucide="grip-vertical"></i></button>` : '';
  return `<article class="feed-card feed-item" data-item-id="${itemId}" data-position="${Number(item.position) || 0}"><div class="feed-card-head"><span class="category-dot category-${typeClass}"></span><div><span class="feed-source">${escapeHtml(item.type)} · ${escapeHtml(item.due)}</span><h3>${escapeHtml(item.title)}</h3></div><span class="confidence"><i data-lucide="shield-check"></i> <span data-verify-count>${(item.verifiedBy || []).length}</span></span>${dragHandle}</div><div class="feed-card-foot"><div class="feed-card-actions"><form data-live-form action="/org/${orgId}/items/${itemId}/verify" method="post"><button class="text-button" type="submit"><i data-lucide="badge-check"></i> Confirm details</button></form><form data-live-form action="/org/${orgId}/items/${itemId}/todo" method="post"><button class="text-button" type="submit"><i data-lucide="inbox"></i> Add to My Todo</button></form>${projectAction}${downvoteAction}</div><details class="comment-details"><summary><i data-lucide="message-circle"></i> <span data-comment-count>0</span> comments</summary><div class="comments"><div class="comment-list" data-comment-list></div><form data-live-form action="/org/${orgId}/items/${itemId}/comments" method="post"><input name="comment" placeholder="Ask a question or share a note..." required><button class="button primary" type="submit">Reply</button></form></div></details></div></article>`;
}

function commentMenuMarkup(comment, context) {
  const { orgId, itemId, groupId, canEdit, canDelete, canViewHistory } = context;
  const base = groupId ? `/org/${escapeHtml(orgId)}/breakout/${escapeHtml(groupId)}/comments/${escapeHtml(comment.id)}` : `/org/${escapeHtml(orgId)}/items/${escapeHtml(itemId)}/comments/${escapeHtml(comment.id)}`;
  const report = `<form data-live-form action="/org/${escapeHtml(orgId)}/content-reports" method="post"><input type="hidden" name="contentId" value="${escapeHtml(comment.id)}"><button class="menu-action" type="submit"><i data-lucide="flag"></i> Report comment</button></form>`;
  const edit = canEdit ? `<details class="comment-edit"><summary><i data-lucide="pencil"></i> Edit comment</summary><form data-live-form action="${base}/update" method="post"><textarea name="comment" required>${escapeHtml(comment.text)}</textarea><button class="button secondary" type="submit">Save</button></form></details>` : '';
  const remove = canDelete ? `<form data-live-form action="${base}/delete" method="post"><button class="menu-action danger" type="submit"><i data-lucide="trash-2"></i> Delete comment</button></form>` : '';
  const history = canViewHistory && comment.history?.length ? `<details class="comment-history"><summary><i data-lucide="history"></i> Show edited comment</summary><div>${comment.history.slice().reverse().map((version) => `<p>${escapeHtml(version.text)}<small>${escapeHtml(version.editedAt)} · ${escapeHtml(version.editorName)}</small></p>`).join('')}</div></details>` : '';
  return `<details class="comment-menu"><summary class="icon-button" aria-label="More comment actions"><i data-lucide="ellipsis"></i></summary><div class="comment-menu-popover">${edit}${report}${remove}${history}</div></details>`;
}

function commentMarkup(comment, context) {
  const edited = comment.editedAt ? '<small class="comment-edited">edited</small>' : '';
  return `<div class="comment-entry" data-comment-id="${escapeHtml(comment.id)}"><div class="comment-body"><strong>${escapeHtml(comment.author)}</strong> ${escapeHtml(comment.text)}${edited}</div>${commentMenuMarkup(comment, context)}</div>`;
}

function appendUniqueComment(itemId, comment) {
  const card = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`); if (!card || !comment) return;
  const list = card.querySelector('[data-comment-list]'); if (!list || list.querySelector(`[data-comment-id="${CSS.escape(comment.id || '')}"]`)) return;
  const root = courseRoot(); const canAdmin = root.dataset.isAdmin === 'true'; const canEdit = canAdmin || comment.userId === root.dataset.userId;
  list.insertAdjacentHTML('beforeend', commentMarkup(comment, { orgId: root.dataset.orgId, itemId, canEdit, canDelete: canAdmin, canViewHistory: canAdmin }));
  bindLiveForms(list.lastElementChild); lucide.createIcons();
  const count = card.querySelector('[data-comment-count]'); if (count) count.textContent = list.children.length;
}

function breakoutTaskMarkup(task, root) {
  const orgId = escapeHtml(root.dataset.orgId); const groupId = escapeHtml(root.dataset.groupId); const userId = root.dataset.userId; const groupAdmin = root.dataset.groupAdmin === 'true'; const members = JSON.parse(root.dataset.members || '[]'); const claimedName = members.find((member) => member.id === task.claimedBy)?.name || 'a member';
  const claimAction = !task.claimedBy ? `<form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/claim" method="post"><button class="button secondary task-action" type="submit">Claim task</button></form>` : '';
  const unclaimAction = task.claimedBy && (groupAdmin || task.claimedBy === userId) ? `<form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/unclaim" method="post"><button class="menu-action" type="submit">Unclaim task</button></form>` : '';
  const adminActions = groupAdmin ? `<details class="inline-edit"><summary><i data-lucide="pencil"></i> Edit task</summary><form class="inline-tool-form" data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/update" method="post"><input name="title" value="${escapeHtml(task.title)}" required><button class="button secondary" type="submit">Save</button></form></details><details class="inline-edit"><summary><i data-lucide="user-plus"></i> Delegate task</summary><form class="inline-tool-form" data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/delegate" method="post"><select name="userId">${members.map((member) => `<option value="${escapeHtml(member.id)}" ${task.claimedBy === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select><button class="button secondary" type="submit">Delegate</button></form></details><form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/delete" method="post"><button class="menu-action danger" type="submit"><i data-lucide="trash-2"></i> Delete task</button></form>` : '';
  const menu = groupAdmin || task.claimedBy === userId ? `<details class="task-menu"><summary class="icon-button" aria-label="More actions for ${escapeHtml(task.title)}"><i data-lucide="ellipsis"></i></summary><div class="task-menu-popover">${unclaimAction}${adminActions}</div></details>` : '';
  return `<article class="claim-row breakout-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}"><span><strong>${escapeHtml(task.title)}</strong><small>${task.claimedBy ? `Claimed by ${escapeHtml(claimedName)}` : 'Open'}</small></span><span class="task-actions">${claimAction}${menu}</span></article>`;
}

function setCourseTab(tabName, updateHash = true) {
  const root = courseRoot(); if (!root) return;
  document.querySelectorAll('[data-course-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.courseTab === tabName));
  document.querySelectorAll('[data-course-view]').forEach((view) => view.classList.toggle('active', view.dataset.courseView === tabName));
  if (updateHash) history.replaceState({}, '', `${window.location.pathname}#${tabName}`);
}

function connectLiveCourse() {
  const root = courseRoot(); if (!root || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io();
  liveState.socket.on('connect', () => { liveState.socket.emit('course:join', { orgId: root.dataset.orgId, courseId: root.dataset.courseId }); liveState.socket.emit('group:join', { orgId: root.dataset.orgId }); });
  liveState.socket.on('course:item-created', ({ item }) => { const list = root.querySelector('[data-feed-list]'); if (!list || !item || list.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)) return; root.querySelector('[data-empty-feed]')?.remove(); list.insertAdjacentHTML('afterbegin', itemCard(item)); bindLiveForms(list.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)); bindCourseReorder(root); lucide.createIcons(); });
  liveState.socket.on('item:verification-changed', ({ itemId, verifiedBy }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = verifiedBy.length; });
  liveState.socket.on('item:downvote-changed', ({ itemId, downvoteCount }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count && downvoteCount !== undefined) count.textContent = downvoteCount; });
  liveState.socket.on('item:updated', ({ item }) => { const card = root.querySelector(`[data-item-id="${CSS.escape(item?.id || '')}"]`); if (card && item) { card.querySelector('h3').textContent = item.title; card.querySelector('.feed-source').textContent = `${item.type} · ${item.due}`; } });
  liveState.socket.on('item:deleted', ({ itemId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.remove());
  liveState.socket.on('course:items-reordered', ({ items }) => { if (!items) return; const list = root.querySelector('[data-feed-list]'); const positions = new Map(items.map((item) => [item.id, item.position])); [...list.querySelectorAll('[data-item-id]')].sort((left, right) => (positions.get(left.dataset.itemId) ?? 0) - (positions.get(right.dataset.itemId) ?? 0)).forEach((card, index) => { card.dataset.position = positions.get(card.dataset.itemId) ?? index; list.appendChild(card); }); });
  liveState.socket.on('item:comment-added', ({ itemId, comment }) => appendUniqueComment(itemId, comment));
  liveState.socket.on('item:comment-updated', ({ itemId, comment }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(comment?.id || '')}"]`); if (entry && comment) { entry.outerHTML = commentMarkup(comment, { orgId: root.dataset.orgId, itemId, canEdit: root.dataset.isAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.isAdmin === 'true', canViewHistory: root.dataset.isAdmin === 'true' }); bindLiveForms(root); lucide.createIcons(); } });
  liveState.socket.on('item:comment-deleted', ({ itemId, commentId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove());
  liveState.socket.on('item:comment-reported', ({ itemId, commentId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove());
  liveState.socket.on('board:card-created', ({ card }) => { if (!card) return; const list = root.querySelector('[data-board-list]'); if (!list || list.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)) return; root.querySelector('[data-empty-board]')?.remove(); const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/board/${escapeHtml(card.id)}/delete" method="post"><button class="icon-button" type="submit" aria-label="Delete board task"><i data-lucide="trash-2"></i></button></form>` : '<i data-lucide="arrow-right"></i>'; list.insertAdjacentHTML('beforeend', `<div class="claim-row" data-card-id="${escapeHtml(card.id)}"><span><strong>${escapeHtml(card.title)}</strong><small>${escapeHtml(card.status)}</small></span>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:created', ({ resource }) => { if (!resource) return; const list = root.querySelector('[data-resource-list]'); if (!list || list.querySelector(`[data-resource-id="${CSS.escape(resource.id)}"]`)) return; const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/resources/${escapeHtml(resource.id)}/delete" method="post"><button class="icon-button" type="submit" aria-label="Delete resource"><i data-lucide="trash-2"></i></button></form>` : ''; list.insertAdjacentHTML('beforeend', `<div class="resource-row" data-resource-id="${escapeHtml(resource.id)}"><a class="resource-link" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${escapeHtml(resource.title)}</span></a>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:deleted', ({ resourceId }) => root.querySelector(`[data-resource-id="${CSS.escape(resourceId)}"]`)?.remove());
  liveState.socket.on('subgroup:created', ({ group }) => { if (!group || group.courseId !== root.dataset.courseId) return; const list = root.querySelector('[data-subgroup-list]'); if (!list || list.querySelector(`[data-group-id="${CSS.escape(group.id)}"]`)) return; list.insertAdjacentHTML('beforeend', `<a class="claim-row" href="/org/${escapeHtml(root.dataset.orgId)}/breakout/${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}"><span><strong>${escapeHtml(group.name)}</strong><small>${group.members.length}/${group.limit} members</small></span><i data-lucide="users-round"></i></a>`); lucide.createIcons(); });
}

function persistCourseOrder(root) {
  const list = root.querySelector('[data-feed-list]'); if (!list) return;
  const order = [...list.querySelectorAll('[data-item-id]')].map((card, index) => { card.dataset.position = index; return card.dataset.itemId; });
  fetch(`/org/${root.dataset.orgId}/course/${root.dataset.courseId}/items/reorder`, { method: 'POST', body: new URLSearchParams({ order: order.join(',') }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }).then(async (response) => { const payload = await response.json(); if (!response.ok || payload.error) { window.dispatchEvent(new CustomEvent('live-error', { detail: payload.error || 'Could not reorder course tasks.' })); } });
}

function bindCourseReorder(root) {
  if (!root || root.dataset.canEdit !== 'true') return;
  const list = root.querySelector('[data-feed-list]'); if (!list) return;
  list.querySelectorAll('[data-item-id]').forEach((card) => {
    if (card.dataset.reorderBound === 'true') return;
    card.dataset.reorderBound = 'true';
    const grip = card.querySelector('.course-drag-handle'); if (!grip) return;
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); liveState.courseDragged = card; card.classList.add('is-dragging'); grip.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => { const dragged = liveState.courseDragged; if (!dragged) return; const target = [...list.querySelectorAll('[data-item-id]')].filter((candidate) => candidate !== dragged).find((candidate) => moveEvent.clientY < candidate.getBoundingClientRect().top + candidate.offsetHeight / 2); if (target) list.insertBefore(dragged, target); else list.appendChild(dragged); };
      const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); card.classList.remove('is-dragging'); liveState.courseDragged = null; persistCourseOrder(root); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish, { once: true }); document.addEventListener('pointercancel', finish, { once: true });
    });
  });
}

function connectLiveBreakout() {
  const root = document.querySelector('[data-breakout-live]'); if (!root || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io();
  liveState.socket.on('connect', () => liveState.socket.emit('group:join', { orgId: root.dataset.orgId }));
  liveState.socket.on('breakout:task-created', ({ groupId, task }) => { if (groupId !== root.dataset.groupId || !task) return; const list = root.querySelector('[data-breakout-task-list]'); if (!list || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) return; root.querySelector('[data-empty-breakout-board]')?.remove(); list.insertAdjacentHTML('beforeend', breakoutTaskMarkup(task, root)); bindLiveForms(list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); lucide.createIcons(); });
  liveState.socket.on('breakout:task-updated', ({ groupId, task }) => { if (groupId !== root.dataset.groupId || !task) return; const row = root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (row) { row.outerHTML = breakoutTaskMarkup(task, root); bindLiveForms(root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); lucide.createIcons(); } });
  liveState.socket.on('breakout:task-deleted', ({ groupId, taskId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); });
  liveState.socket.on('breakout:board-deleted', ({ groupId }) => { if (groupId === root.dataset.groupId) root.querySelector('[data-breakout-task-list]').innerHTML = '<div class="empty-panel" data-empty-breakout-board><h3>The board is clear</h3></div>'; });
  liveState.socket.on('breakout:comment-created', ({ groupId, comment }) => { if (groupId !== root.dataset.groupId || !comment) return; const list = root.querySelector('[data-breakout-comment-list]'); if (list && !list.querySelector(`[data-comment-id="${CSS.escape(comment.id)}"]`)) { list.insertAdjacentHTML('beforeend', commentMarkup(comment, { orgId: root.dataset.orgId, groupId, canEdit: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.groupAdmin === 'true', canViewHistory: root.dataset.groupAdmin === 'true' })); bindLiveForms(list.lastElementChild); lucide.createIcons(); } });
  liveState.socket.on('breakout:comment-updated', ({ groupId, comment }) => { if (groupId !== root.dataset.groupId || !comment) return; const entry = root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(comment.id)}"]`); if (entry) { entry.outerHTML = commentMarkup(comment, { orgId: root.dataset.orgId, groupId, canEdit: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.groupAdmin === 'true', canViewHistory: root.dataset.groupAdmin === 'true' }); bindLiveForms(root); lucide.createIcons(); } });
  liveState.socket.on('breakout:comment-deleted', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove(); });
  liveState.socket.on('breakout:comment-reported', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove(); });
}

function todoList() { return document.querySelector('[data-live-todo-list]'); }
function todoImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0); const date = new Date(`${due}T00:00:00`); const days = Math.round((date - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}
function todoTaskMarkup(task) {
  const importance = task.importance || todoImportance(task.due); const priority = task.priority || 'Normal';
  return `<article class="private-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}" data-due="${escapeHtml(task.due)}" data-importance="${importance}" data-position="${Number(task.position) || 0}" draggable="false"><form class="toggle-task-form" action="/tasks/${escapeHtml(task.id)}/toggle" method="post" data-live-form><button class="task-check" aria-label="Toggle ${escapeHtml(task.title)}"><i data-lucide="check"></i></button></form><div class="private-task-copy"><h3>${escapeHtml(task.title)}</h3><span><i data-lucide="link-2"></i> ${escapeHtml(task.source)}</span><small>Due ${escapeHtml(task.due)} · ${importance}</small></div><div class="priority-menu"><button class="priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(priority)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button type="button" data-priority="Low">Low</button><button type="button" data-priority="Normal">Normal</button><button type="button" data-priority="Medium">Medium</button><button type="button" data-priority="High">High</button></div></div><form data-live-form action="/tasks/${escapeHtml(task.id)}/delete" method="post"><button class="icon-button" type="submit" aria-label="Delete task"><i data-lucide="trash-2"></i></button></form><button class="icon-button drag-handle" aria-label="Move task" type="button"><i data-lucide="grip-vertical"></i></button></article>`;
}
function sortTodoDom(compare) { const list = todoList(); if (!list) return; [...list.querySelectorAll('.private-task')].sort(compare).forEach((task) => list.appendChild(task)); }
function persistTodoOrder() {
  const list = todoList(); if (!list) return;
  const order = [...list.querySelectorAll('.private-task')].map((task, index) => { task.dataset.position = index; return task.dataset.taskId; });
  fetch('/tasks/reorder', { method: 'POST', body: new URLSearchParams({ order: order.join(',') }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } });
}
function applyTodoFilter(filter = 'all') {
  const list = todoList(); if (!list) return;
  document.querySelectorAll('[data-todo-filter]').forEach((link) => link.classList.toggle('active', link.dataset.todoFilter === filter));
  list.querySelectorAll('.private-task').forEach((task) => { task.hidden = filter === 'pending' ? task.classList.contains('is-done') : filter === 'completed' ? !task.classList.contains('is-done') : false; });
}
function toggleFocusMode(button) {
  const list = todoList(); if (!list) return;
  const rank = { Overdue: 0, Today: 1, Soon: 2, Later: 3, Unscheduled: 4 };
  const active = button.classList.toggle('active');
  if (active) sortTodoDom((left, right) => (rank[left.dataset.importance] - rank[right.dataset.importance]) || (new Date(`${left.dataset.due}T00:00:00`) - new Date(`${right.dataset.due}T00:00:00`)) || (Number(left.dataset.position) - Number(right.dataset.position)));
  else sortTodoDom((left, right) => Number(left.dataset.position) - Number(right.dataset.position));
}
function enhanceTodoTasks() {
  const list = todoList(); if (!list) return;
  list.querySelectorAll('.private-task').forEach((task, index) => {
    task.draggable = false; task.dataset.position ||= index; task.dataset.due ||= task.querySelector('small')?.textContent.replace(/^Due\s+/, '').split(' · ')[0] || 'No date'; task.dataset.importance ||= todoImportance(task.dataset.due);
    const priority = task.querySelector('.priority-flag');
    if (priority && !priority.closest('.priority-menu')) { const value = priority.textContent.trim(); const menu = document.createElement('div'); menu.className = 'priority-menu'; menu.innerHTML = `<button class="priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(value)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button type="button" data-priority="Low">Low</button><button type="button" data-priority="Normal">Normal</button><button type="button" data-priority="Medium">Medium</button><button type="button" data-priority="High">High</button></div>`; priority.replaceWith(menu); }
  });
  list.querySelectorAll('.private-task').forEach((task) => {
    const grip = task.querySelector('.drag-handle, button[aria-label="Move task"]');
    grip?.classList.add('drag-handle');
    grip?.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); liveState.draggedTask = task; task.classList.add('is-dragging'); grip.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dragged = liveState.draggedTask; if (!dragged) return;
        const target = [...list.querySelectorAll('.private-task')].filter((candidate) => candidate !== dragged).find((candidate) => moveEvent.clientY < candidate.getBoundingClientRect().top + candidate.offsetHeight / 2);
        if (target) list.insertBefore(dragged, target); else list.appendChild(dragged);
      };
      const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); task.classList.remove('is-dragging'); liveState.draggedTask = null; persistTodoOrder(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish, { once: true }); document.addEventListener('pointercancel', finish, { once: true });
    });
  });
  lucide.createIcons();
}
function connectLiveTodo() {
  const list = todoList(); if (!list || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io(); liveState.socket.on('connect', () => liveState.socket.emit('todo:join'));
  liveState.socket.on('todo:task-added', ({ task }) => { if (!task || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) return; list.querySelector('.empty-panel')?.remove(); list.insertAdjacentHTML('beforeend', todoTaskMarkup(task)); bindLiveForms(list.lastElementChild); enhanceTodoTasks(); lucide.createIcons(); });
  liveState.socket.on('todo:task-updated', ({ task }) => { const row = task && list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (!row) return; row.outerHTML = todoTaskMarkup(task); bindLiveForms(list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); enhanceTodoTasks(); lucide.createIcons(); syncTodoSummary(); });
  liveState.socket.on('todo:task-deleted', ({ taskId }) => { list.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); syncTodoSummary(); });
  liveState.socket.on('todo:reordered', ({ tasks }) => { if (!tasks) return; const byId = new Map(tasks.map((task) => [task.id, task])); [...list.querySelectorAll('.private-task')].sort((left, right) => byId.get(left.dataset.taskId).position - byId.get(right.dataset.taskId).position).forEach((task) => list.appendChild(task)); });
}
function bindTodoControls() {
  enhanceTodoTasks();
  document.querySelectorAll('[data-todo-filter]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); applyTodoFilter(link.dataset.todoFilter); history.replaceState({}, '', `/todo${link.dataset.todoFilter === 'all' ? '' : `?filter=${link.dataset.todoFilter}`}`); }));
  document.querySelector('[data-focus-mode]')?.addEventListener('click', (event) => toggleFocusMode(event.currentTarget));
  document.querySelectorAll('.priority-menu').forEach((menu) => {
    menu.querySelector('.priority-flag')?.addEventListener('click', () => { const open = menu.classList.toggle('open'); menu.querySelector('.priority-flag').setAttribute('aria-expanded', String(open)); });
    menu.querySelectorAll('[data-priority]').forEach((option) => option.addEventListener('click', async () => { const row = menu.closest('.private-task'); const response = await fetch(`/tasks/${row.dataset.taskId}/priority`, { method: 'POST', body: new URLSearchParams({ priority: option.dataset.priority }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); if (!response.ok) return; menu.querySelector('.priority-flag span').textContent = option.dataset.priority; menu.classList.remove('open'); menu.querySelector('.priority-flag').setAttribute('aria-expanded', 'false'); }));
  });
  const filter = new URLSearchParams(window.location.search).get('filter') || 'all'; applyTodoFilter(filter);
}

async function submitLiveForm(form) {
  const key = `${form.action}:${Date.now()}`; const submit = form.querySelector('button[type="submit"]'); const original = submit?.innerHTML; const formData = new FormData(form); const optimisticComment = form.action.endsWith('/comments') ? { id: `pending-${key}`, author: 'You', text: formData.get('comment') } : null;
  const isTaskToggle = form.classList.contains('toggle-task-form');
  const isTaskCreate = form.matches('[data-live-form][action="/tasks"]');
  if (optimisticComment) { const itemId = form.action.split('/').at(-2); appendUniqueComment(itemId, optimisticComment); }
  if (submit) { submit.disabled = true; submit.dataset.original = original; }
  try {
    const response = await fetch(form.action, { method: 'POST', body: new URLSearchParams(formData), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } });
    const payload = await response.json(); if (!response.ok || payload.error) throw new Error(payload.error || 'Action failed');
    if (payload.groupUrl) { window.location.assign(payload.groupUrl); return; }
    if (payload.successMessage) showLiveSuccess(payload.successMessage);
    if (payload.action && payload.reportId) document.querySelector(`[data-report-id="${CSS.escape(payload.reportId)}"]`)?.remove();
    if (payload.role || (payload.action && payload.userId)) { window.location.reload(); return; }
    if (payload.verifiedBy) { const itemId = form.action.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = payload.verifiedBy.length; }
    if (payload.downvotedBy) { const itemId = form.action.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvotedBy.length; }
    if (payload.downvoteCount !== undefined) { const itemId = form.action.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvoteCount; }
    if (payload.comment) {
      const editedComment = form.action.endsWith('/update');
      if (editedComment) {
        const entry = form.closest('[data-comment-id]');
        const itemCardElement = form.closest('[data-item-id]');
        const courseLive = form.closest('[data-course-live]');
        const breakoutLive = form.closest('[data-breakout-live]');
        const context = itemCardElement && courseLive ? { orgId: courseLive.dataset.orgId, itemId: itemCardElement.dataset.itemId, canEdit: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canDelete: courseLive.dataset.isAdmin === 'true', canViewHistory: courseLive.dataset.isAdmin === 'true' } : { orgId: breakoutLive.dataset.orgId, groupId: breakoutLive.dataset.groupId, canEdit: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canDelete: breakoutLive.dataset.groupAdmin === 'true', canViewHistory: breakoutLive.dataset.groupAdmin === 'true' };
        if (entry) { entry.outerHTML = commentMarkup(payload.comment, context); bindLiveForms(form.closest('[data-comment-list], [data-breakout-comment-list]') || document); lucide.createIcons(); }
      } else {
        const itemId = form.action.split('/').at(-2); document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-list] [data-comment-id="${CSS.escape(optimisticComment?.id || '')}"]`)?.remove(); appendUniqueComment(itemId, payload.comment);
      }
    }
    if (payload.task) {
      const list = document.querySelector('[data-live-todo-list]'); if (list) {
        const existing = list.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
        if (!existing) {
          const empty = list.querySelector('.empty-panel'); empty?.remove();
          list.insertAdjacentHTML('afterbegin', todoTaskMarkup(payload.task)); bindLiveForms(list.firstElementChild); enhanceTodoTasks();
          form.reset(); document.getElementById('quick-task')?.classList.remove('open');
        }
      }
    }
    if (payload.task && isTaskToggle) {
      const row = document.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
      if (row) row.classList.toggle('is-done', Boolean(payload.task.done));
    }
    if (payload.deleted && payload.taskId) document.querySelector(`[data-task-id="${CSS.escape(payload.taskId)}"]`)?.remove();
    if (payload.deleted && payload.resourceId) document.querySelector(`[data-resource-id="${CSS.escape(payload.resourceId)}"]`)?.remove();
    if (payload.deleted && payload.itemId) document.querySelector(`[data-item-id="${CSS.escape(payload.itemId)}"]`)?.remove();
    if (payload.deleted && payload.cardId) document.querySelector(`[data-card-id="${CSS.escape(payload.cardId)}"]`)?.remove();
    if (payload.reported) { document.querySelector(`[data-comment-id="${CSS.escape(payload.contentId || '')}"]`)?.remove(); showLiveSuccess(payload.successMessage || 'Report submitted.'); }
    if ((payload.reviewed || payload.removed) && payload.commentId) document.querySelector(`[data-comment-id="${CSS.escape(payload.commentId)}"]`)?.closest('.mod-card')?.remove();
    if (payload.todoPendingCount !== undefined) {
      const countTarget = document.querySelector('[data-live-todo-count]');
      if (countTarget) countTarget.textContent = payload.todoPendingCount;
    }
    if (payload.item) { form.reset(); }
    if (payload.card || payload.resource) form.reset();
    syncTodoSummary();
  } catch (error) {
    if (optimisticComment) document.querySelector(`[data-comment-id="${CSS.escape(optimisticComment.id)}"]`)?.remove();
    window.dispatchEvent(new CustomEvent('live-error', { detail: error.message }));
  } finally { if (submit) { submit.disabled = false; submit.innerHTML = submit.dataset.original; } }
}

function syncTodoSummary() {
  const list = document.querySelector('[data-live-todo-list]'); const summary = document.querySelector('[data-todo-summary]'); const countTarget = document.querySelector('[data-live-todo-count]');
  if (!list) return;
  const count = list.querySelectorAll('.private-task:not(.is-done)').length;
  if (summary) summary.textContent = `${count} thing${count === 1 ? '' : 's'} still in motion`;
  if (countTarget) countTarget.textContent = count;
}

function bindLiveForms(scope = document) {
  scope.querySelectorAll('[data-live-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); submitLiveForm(form); }));
}

function showLiveError(message) {
  document.querySelector('[data-live-error]')?.remove();
  const alert = document.createElement('div');
  alert.className = 'live-error';
  alert.dataset.liveError = 'true';
  alert.setAttribute('role', 'alert');
  alert.innerHTML = `<i data-lucide="triangle-alert"></i><span>${escapeHtml(message)}</span><button type="button" aria-label="Dismiss message"><i data-lucide="x"></i></button>`;
  alert.querySelector('button').addEventListener('click', () => alert.remove());
  document.body.appendChild(alert);
  lucide.createIcons();
  window.setTimeout(() => alert.remove(), 7000);
}
function showLiveSuccess(message) {
  document.querySelector('[data-live-success]')?.remove();
  const alert = document.createElement('div'); alert.className = 'live-success'; alert.dataset.liveSuccess = 'true'; alert.setAttribute('role', 'status');
  alert.innerHTML = `<i data-lucide="circle-check"></i><span>${escapeHtml(message)}</span><button type="button" aria-label="Dismiss message"><i data-lucide="x"></i></button>`;
  alert.querySelector('button').addEventListener('click', () => alert.remove()); document.body.appendChild(alert); lucide.createIcons(); window.setTimeout(() => alert.remove(), 7000);
}
function connectLiveNotifications() {
  if (typeof io !== 'function') return;
  liveState.notificationSocket?.disconnect(); liveState.notificationSocket = io();
  liveState.notificationSocket.on('connect', () => liveState.notificationSocket.emit('notifications:join'));
  liveState.notificationSocket.on('notification:added', (notification) => {
    showLiveSuccess(notification.actionLabel ? `${notification.title} · ${notification.actionLabel}` : notification.title);
    const summary = document.querySelector('.notification-menu>summary');
    if (summary && !summary.querySelector('.notification-count')) summary.insertAdjacentHTML('beforeend', '<span class="notification-count">1</span>');
  });
}

function bindInteractions() {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.auth-form').forEach((form) => form.classList.add('hidden')); tab.classList.add('active'); document.getElementById(tab.dataset.tab).classList.remove('hidden'); }));
  bindLiveForms();
  document.querySelectorAll('[data-inline-create]').forEach((button) => button.addEventListener('click', () => { const form = document.querySelector('.inline-create-form'); form?.classList.remove('hidden'); form?.querySelector('input[name="title"]')?.focus(); form?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-course-tab]').forEach((tab) => tab.addEventListener('click', (event) => { event.preventDefault(); setCourseTab(tab.dataset.courseTab); }));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => { const target = document.getElementById(button.dataset.open); target?.classList.add('open'); target?.querySelector('input[name="title"]')?.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { button.closest('.modal-backdrop')?.classList.remove('open'); }));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.remove('open'); }));
  const hash = window.location.hash.slice(1); if (courseRoot() && ['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false);
  syncTodoSummary();
  lucide.createIcons(); bindTodoControls(); connectLiveCourse(); bindCourseReorder(courseRoot()); connectLiveBreakout(); connectLiveTodo(); connectLiveNotifications();
}

window.addEventListener('live-error', (event) => showLiveError(event.detail || 'Action failed. Please try again.'));

function isInternalGetLink(link) { return link.origin === window.location.origin && link.pathname && !link.pathname.startsWith('/share/') && !link.hasAttribute('download') && link.target !== '_blank' && !link.dataset.noRouter; }
async function navigate(url, pushState = true) { routeProgress.classList.add('active'); document.body.classList.add('is-navigating'); try { const response = await fetch(url, { headers: { 'X-Studyline-Navigation': 'true' } }); if (!response.ok || response.redirected) throw new Error(`Navigation failed: ${response.status}`); const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html'); const nextShell = nextDocument.querySelector('.app-shell'); if (!nextShell) throw new Error('Navigation returned an incomplete page.'); nextDocument.body.querySelectorAll('script').forEach((script) => script.remove()); liveState.socket?.disconnect(); liveState.notificationSocket?.disconnect(); document.querySelector('.app-shell')?.replaceWith(nextShell); document.body.className = nextDocument.body.className; document.body.classList.add('is-navigating'); document.body.appendChild(routeProgress); document.title = nextDocument.title; if (pushState) window.history.pushState({}, '', url); window.scrollTo({ top: 0, behavior: 'instant' }); bindInteractions(); requestAnimationFrame(() => document.body.classList.remove('is-navigating')); } catch (error) { window.location.assign(url); } finally { routeProgress.classList.remove('active'); } }
document.addEventListener('click', (event) => { const link = event.target.closest('a'); if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isInternalGetLink(link)) return; const target = new URL(link.href); if (target.hash && target.pathname === window.location.pathname) return; event.preventDefault(); navigate(target.href); });
window.addEventListener('popstate', () => navigate(window.location.href, false));
window.addEventListener('hashchange', () => { const hash = window.location.hash.slice(1); if (['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false); });
bindInteractions();