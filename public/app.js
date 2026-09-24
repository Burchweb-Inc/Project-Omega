const routeProgress = document.createElement('div');
routeProgress.className = 'route-progress';
document.body.appendChild(routeProgress);

const liveState = { socket: null, notificationSocket: null, pending: new Map(), dashboardHeroTimer: null, dashboardHeroFadeTimer: null };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function courseRoot() { return document.querySelector('[data-course-live]'); }
function itemCard(item) {
  const typeClass = String(item.type || '').toLowerCase().replace(/[^a-z]/g, '-');
  const root = courseRoot(); const orgId = escapeHtml(root.dataset.orgId); const itemId = escapeHtml(item.id); const taskSlug = `${String(item.title || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || itemId}-${itemId.slice(-8)}`; const projectAction = item.type === 'Project' ? `<a class="text-button breakout-action" href="/org/${orgId}/course/${escapeHtml(root.dataset.courseId)}/task/${escapeHtml(taskSlug)}/breakout-groups"><i data-lucide="users-round"></i> Breakout Groups</a>` : ''; const downvoteAction = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${orgId}/items/${itemId}/downvote" method="post"><button class="text-button" type="submit"><i data-lucide="thumbs-down"></i> <span data-downvote-count>${(item.downvotedBy || []).length}</span></button></form>` : '';
  const dragHandle = root.dataset.canEdit === 'true' ? `<button class="icon-button course-drag-handle" type="button" aria-label="Move ${escapeHtml(item.title)}"><i data-lucide="grip-vertical"></i></button>` : '';
  return `<article class="feed-card feed-item" data-item-id="${itemId}" data-position="${Number(item.position) || 0}"><div class="feed-card-head"><span class="category-dot category-${typeClass}"></span><div><span class="feed-source">${escapeHtml(item.type)} · ${escapeHtml(item.due)}</span><h3>${escapeHtml(item.title)}</h3></div><span class="confidence"><i data-lucide="shield-check"></i> <span data-verify-count>${(item.verifiedBy || []).length}</span></span>${dragHandle}</div><div class="feed-card-foot"><div class="feed-card-actions"><form data-live-form action="/org/${orgId}/items/${itemId}/verify" method="post"><button class="text-button" type="submit"><i data-lucide="badge-check"></i> Confirm details</button></form><form data-live-form action="/org/${orgId}/items/${itemId}/todo" method="post"><button class="text-button" type="submit"><i data-lucide="inbox"></i> Add to My Todo</button></form>${projectAction}${downvoteAction}</div><details class="comment-details"><summary><i data-lucide="message-circle"></i> <span data-comment-count>${(item.comments || []).filter((comment) => !comment.reported).length}</span> comments</summary><div class="comments"><div class="comment-list" data-comment-list></div><form data-live-form action="/org/${orgId}/items/${itemId}/comments" method="post"><input name="comment" placeholder="Ask a question or share a note..." required><button class="button primary" type="submit">Reply</button></form></div></details></div></article>`;
}

function commentMenuMarkup(comment, context) {
  const { orgId, itemId, groupId, canEdit, canDelete, canViewHistory } = context;
  const base = groupId ? `/org/${escapeHtml(orgId)}/breakout/${escapeHtml(groupId)}/comments/${escapeHtml(comment.id)}` : `/org/${escapeHtml(orgId)}/items/${escapeHtml(itemId)}/comments/${escapeHtml(comment.id)}`;
  const report = `<form data-live-form action="/org/${escapeHtml(orgId)}/content-reports" method="post"><input type="hidden" name="contentId" value="${escapeHtml(comment.id)}"><button class="menu-action" type="submit"><i data-lucide="flag"></i> Report comment</button></form>`;
  const edit = canEdit ? `<details class="comment-edit"><summary><i data-lucide="pencil"></i> Edit comment</summary><form data-live-form action="${base}/update" method="post"><textarea name="comment" required>${escapeHtml(comment.text)}</textarea><button class="button secondary" type="submit">Save</button></form></details>` : '';
  const remove = canDelete ? `<form data-live-form action="${base}/delete" method="post"><button class="menu-action danger" type="submit">Delete comment</button></form>` : '';
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
  updateCommentCount(card);
}

function updateCommentCount(card) {
  const list = card?.querySelector('[data-comment-list]'); const count = card?.querySelector('[data-comment-count]');
  if (list && count) count.textContent = list.querySelectorAll('.comment-entry:not([data-removing="true"])').length;
}
function finishCommentRemoval(entry) { if (!entry) return; const card = entry.closest('[data-item-id]'); entry.remove(); updateCommentCount(card); }

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
  liveState.socket.on('item:comment-deleted', ({ itemId, commentId }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`); finishCommentRemoval(entry); });
  liveState.socket.on('item:comment-reported', ({ itemId, commentId }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`); finishCommentRemoval(entry); });
  liveState.socket.on('board:card-created', ({ card }) => { if (!card) return; const list = root.querySelector('[data-board-list]'); if (!list || list.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)) return; root.querySelector('[data-empty-board]')?.remove(); const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/board/${escapeHtml(card.id)}/delete" method="post"><button class="icon-button" type="submit" aria-label="Delete board task"><i data-lucide="trash-2"></i></button></form>` : '<i data-lucide="arrow-right"></i>'; list.insertAdjacentHTML('beforeend', `<div class="claim-row" data-card-id="${escapeHtml(card.id)}"><span><strong>${escapeHtml(card.title)}</strong><small>${escapeHtml(card.status)}</small></span>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:created', ({ resource }) => { if (!resource) return; const list = root.querySelector('[data-resource-list]'); if (!list || list.querySelector(`[data-resource-id="${CSS.escape(resource.id)}"]`)) return; const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/resources/${escapeHtml(resource.id)}/delete" method="post"><button class="icon-button" type="submit" aria-label="Delete resource"><i data-lucide="trash-2"></i></button></form>` : ''; list.insertAdjacentHTML('beforeend', `<div class="resource-row" data-resource-id="${escapeHtml(resource.id)}"><a class="resource-link" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${escapeHtml(resource.title)}</span></a>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:deleted', ({ resourceId }) => root.querySelector(`[data-resource-id="${CSS.escape(resourceId)}"]`)?.remove());
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
  liveState.socket.on('breakout:comment-deleted', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) finishCommentRemoval(root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)); });
  liveState.socket.on('breakout:comment-reported', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) finishCommentRemoval(root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)); });
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

async function submitLiveForm(form, animatedEntry = null) {
  const actionUrl = form.getAttribute('action') || ''; const key = `${actionUrl}:${Date.now()}`; const submit = form.querySelector('button[type="submit"]'); const original = submit?.innerHTML; const formData = new FormData(form); const optimisticComment = actionUrl.endsWith('/comments') ? { id: `pending-${key}`, author: 'You', text: formData.get('comment') } : null;
  const isTaskToggle = form.classList.contains('toggle-task-form');
  const isTaskCreate = form.matches('[data-live-form][action="/tasks"]');
  if (optimisticComment) { const itemId = actionUrl.split('/').at(-2); appendUniqueComment(itemId, optimisticComment); }
  if (submit) { submit.disabled = true; submit.dataset.original = original; }
  try {
    const response = await fetch(actionUrl, { method: 'POST', body: new URLSearchParams(formData), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } });
    const payload = await response.json(); if (!response.ok || payload.error) throw new Error(payload.error || 'Action failed');
    if (payload.groupUrl) { window.location.assign(payload.groupUrl); return; }
    if (payload.successMessage) showLiveSuccess(payload.successMessage);
    if (payload.read || payload.readAll) {
      if (payload.readAll) document.querySelectorAll('.notification-item.unread').forEach((item) => item.classList.replace('unread', 'is-read'));
      else form.closest('.notification-item')?.classList.replace('unread', 'is-read');
      const unread = document.querySelectorAll('.notification-item.unread').length; const badge = document.querySelector('.notification-menu .notification-count');
      if (badge) { badge.textContent = String(unread); badge.hidden = unread === 0; }
    }
    if (payload.action && payload.reportId) document.querySelector(`[data-report-id="${CSS.escape(payload.reportId)}"]`)?.remove();
    if (payload.role || (payload.action && payload.userId)) { window.location.reload(); return; }
    if (payload.verifiedBy) { const itemId = actionUrl.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = payload.verifiedBy.length; }
    if (payload.downvotedBy) { const itemId = actionUrl.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvotedBy.length; }
    if (payload.downvoteCount !== undefined) { const itemId = actionUrl.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvoteCount; }
    if (payload.comment) {
      const editedComment = actionUrl.endsWith('/update');
      if (editedComment) {
        const entry = form.closest('[data-comment-id]');
        const itemCardElement = form.closest('[data-item-id]');
        const courseLive = form.closest('[data-course-live]');
        const breakoutLive = form.closest('[data-breakout-live]');
        const context = itemCardElement && courseLive ? { orgId: courseLive.dataset.orgId, itemId: itemCardElement.dataset.itemId, canEdit: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canDelete: courseLive.dataset.isAdmin === 'true', canViewHistory: courseLive.dataset.isAdmin === 'true' } : { orgId: breakoutLive.dataset.orgId, groupId: breakoutLive.dataset.groupId, canEdit: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canDelete: breakoutLive.dataset.groupAdmin === 'true', canViewHistory: breakoutLive.dataset.groupAdmin === 'true' };
        if (entry) { entry.outerHTML = commentMarkup(payload.comment, context); bindLiveForms(form.closest('[data-comment-list], [data-breakout-comment-list]') || document); lucide.createIcons(); }
      } else {
        const itemId = actionUrl.split('/').at(-2); document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-list] [data-comment-id="${CSS.escape(optimisticComment?.id || '')}"]`)?.remove(); appendUniqueComment(itemId, payload.comment);
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
    if (payload.commentId && (payload.removed || actionUrl.endsWith('/delete'))) finishCommentRemoval(document.querySelector(`[data-comment-id="${CSS.escape(payload.commentId)}"]`));
    if (payload.deletedNotificationId) {
      const notification = animatedEntry || document.querySelector(`[data-notification-id="${CSS.escape(payload.deletedNotificationId)}"]`);
      if (notification) { notification.classList.add('notification-waterfall-out'); window.setTimeout(() => notification.remove(), 300); }
      const remaining = document.querySelectorAll('.notification-item').length - 1; const badge = document.querySelector('.notification-menu .notification-count');
      if (badge) { badge.textContent = String(Math.max(0, remaining)); badge.hidden = remaining <= 0; }
    }
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
    if (animatedEntry) { animatedEntry.style.transform = ''; animatedEntry.classList.remove('notification-waterfall-out'); }
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

function notificationMarkup(notification) {
  const action = notification.href && notification.actionLabel ? `<a class="text-button" href="${escapeHtml(notification.href)}">${escapeHtml(notification.actionLabel)}</a>` : '';
  return `<div class="notification-item unread" data-notification-id="${escapeHtml(notification.id)}"><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p>${action}<small>${escapeHtml(new Date(notification.createdAt).toLocaleString())}</small></div><div class="notification-actions"><form data-live-form action="/notifications/${escapeHtml(notification.id)}/read" method="post"><button class="icon-button" type="submit" aria-label="Mark notification read"><i data-lucide="check"></i></button></form><form data-live-form action="/notifications/${escapeHtml(notification.id)}/delete" method="post"><button class="icon-button notification-delete-button" type="submit" aria-label="Delete notification"><i data-lucide="trash-2"></i></button></form></div></div>`;
}
function bindNotificationGestures(scope = document) {
  scope.querySelectorAll('.notification-item').forEach((item) => {
    if (item.dataset.gestureBound === 'true') return;
    item.dataset.gestureBound = 'true'; let startX = 0; let startY = 0; let tracking = false;
    item.addEventListener('pointerdown', (event) => { if (event.pointerType === 'mouse' || event.target.closest('button, form, a')) return; startX = event.clientX; startY = event.clientY; tracking = true; item.setPointerCapture?.(event.pointerId); });
    item.addEventListener('pointermove', (event) => { if (!tracking) return; const dx = event.clientX - startX; const dy = event.clientY - startY; if (Math.abs(dy) > Math.abs(dx)) { tracking = false; return; } if (dx < 0) item.style.transform = `translateX(${Math.max(dx, -120)}px)`; });
    item.addEventListener('pointerup', (event) => { if (!tracking) return; tracking = false; const dx = event.clientX - startX; item.style.transform = ''; if (dx < -72) { const form = item.querySelector('form[action$="/delete"]'); if (form) { item.classList.add('notification-waterfall-out'); submitLiveForm(form, item); } } });
    item.addEventListener('pointercancel', () => { tracking = false; item.style.transform = ''; });
  });
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
async function purgeClientCache() {
  const registrations = await navigator.serviceWorker?.getRegistrations?.() || [];
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (window.caches) await Promise.all((await caches.keys()).map((cacheName) => caches.delete(cacheName)));
}
function showDebugModal(remote = false) {
  document.querySelector('[data-debug-modal]')?.remove();
  const modal = document.createElement('div');
  modal.className = 'debug-modal-backdrop open';
  modal.dataset.debugModal = 'true';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `<article class="debug-modal"><button class="modal-close" type="button" data-debug-close aria-label="Close debug menu"><i data-lucide="x"></i></button><p class="kicker">${remote ? 'REMOTE CACHE COMMAND' : 'DEBUG TOOLS'}</p><h2>${remote ? 'Cache purge requested' : 'Browser cache'}</h2>${remote ? '<p>A site admin requested a full cache purge for this browser. The page will unregister its service workers, delete every site cache, and reload.</p><button class="button danger" type="button" data-debug-nuke><i data-lucide="bomb"></i> Start purge</button>' : '<p>Use this when updated service workers or media files are not appearing. Nuking cache removes this site\'s service workers and every Cache Storage entry, then reloads the page.</p><p class="debug-warning"><i data-lucide="triangle-alert"></i> Offline media will be removed. The next load downloads fresh files and may be slower. This does not delete your account, tasks, groups, or server data.</p><button class="button danger" type="button" data-debug-nuke><i data-lucide="bomb"></i> NUKE CACHE</button>'}</article>`;
  modal.querySelector('[data-debug-close]').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
  modal.querySelector('[data-debug-nuke]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    modal.classList.add('debug-launching');
    modal.querySelector('.debug-modal').insertAdjacentHTML('beforeend', '<div class="nuclear-animation" aria-label="Nuclear cache purge in progress" role="status"><span class="nuclear-cloud"></span><span class="nuclear-stem"></span></div><p class="debug-status">Deleting service workers and site caches...</p>');
    await new Promise((resolve) => window.setTimeout(resolve, 1900));
    try { await purgeClientCache(); } finally { window.location.reload(); }
  });
  document.body.appendChild(modal);
  lucide.createIcons();
}
function bindDebugTools() {
  document.querySelectorAll('[data-debug-open]').forEach((button) => button.addEventListener('click', () => { button.closest('details')?.removeAttribute('open'); showDebugModal(); }));
}
function showWarningModal(notification) {
  document.querySelector('[data-warning-modal]')?.remove();
  const modal = document.createElement('div'); modal.className = 'warning-modal-backdrop open'; modal.dataset.warningModal = 'true'; modal.dataset.warningId = notification.id; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.innerHTML = `<div class="warning-modal"><i data-lucide="shield-alert"></i><p class="kicker">MODERATION NOTICE</p><h2>${escapeHtml(notification.title)}</h2><p>${escapeHtml(notification.message)}</p><button class="button primary" type="button" data-warning-close>I understand</button></div>`;
  modal.querySelector('[data-warning-close]').addEventListener('click', () => { modal.remove(); fetch(`/notifications/${encodeURIComponent(notification.id)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); });
  document.body.appendChild(modal); lucide.createIcons();
}
function showAnnouncementModal(notification) {
  document.querySelector('[data-announcement-modal]')?.remove();
  const size = ['small', 'normal', 'large'].includes(notification.fontSize) ? notification.fontSize : 'normal';
  const media = notification.mediaUrl && notification.mediaType === 'image' ? `<img class="announcement-media" src="${escapeHtml(notification.mediaUrl)}" alt="Announcement media">` : notification.mediaUrl && notification.mediaType === 'video' ? `<video class="announcement-media" controls preload="metadata" src="${escapeHtml(notification.mediaUrl)}"></video>` : '';
  const modal = document.createElement('div');
  modal.className = 'announcement-modal-backdrop open';
  modal.dataset.announcementModal = 'true';
  modal.dataset.announcementId = notification.id;
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.innerHTML = `<article class="announcement-modal announcement-size-${size}"><button class="modal-close" type="button" data-announcement-close aria-label="Close announcement"><i data-lucide="x"></i></button><p class="kicker">SITE ANNOUNCEMENT</p><h2>${escapeHtml(notification.title)}</h2><div class="announcement-content">${notification.html || `<p>${escapeHtml(notification.message || '')}</p>`}</div>${media}<button class="button primary" type="button" data-announcement-close>I Gotchu</button></article>`;
  modal.querySelectorAll('[data-announcement-close]').forEach((button) => button.addEventListener('click', () => { const id = modal.dataset.announcementId; modal.remove(); if (id) fetch(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); }));
  document.body.appendChild(modal);
  lucide.createIcons();
}
function connectLiveNotifications() {
  if (typeof io !== 'function') return;
  liveState.notificationSocket?.disconnect(); liveState.notificationSocket = io();
  liveState.notificationSocket.on('connect', () => liveState.notificationSocket.emit('notifications:join'));
  liveState.notificationSocket.on('cache:nuke', () => showDebugModal(true));
  liveState.notificationSocket.on('notification:added', (notification) => {
    if (notification.type === 'warning') showWarningModal(notification);
    if (notification.type === 'announcement') showAnnouncementModal(notification);
    const popover = document.querySelector('.notification-popover');
    if (popover && notification.id && !popover.querySelector(`[data-notification-id="${CSS.escape(notification.id)}"]`)) { popover.querySelector('.notification-empty')?.remove(); popover.insertAdjacentHTML('beforeend', notificationMarkup(notification)); bindLiveForms(popover.lastElementChild); bindNotificationGestures(popover.lastElementChild); lucide.createIcons(); }
    showLiveSuccess(notification.actionLabel ? `${notification.title} · ${notification.actionLabel}` : notification.title);
    const summary = document.querySelector('.notification-menu>summary');
    if (summary) {
      const count = summary.querySelector('.notification-count');
      if (count) count.textContent = String(Number(count.textContent || 0) + 1);
      else summary.insertAdjacentHTML('beforeend', '<span class="notification-count">1</span>');
    }
  });
}

function connectLiveDashboard() {
  const root = document.querySelector('[data-dashboard-live]');
  if (!root || typeof io !== 'function') return;
  liveState.socket?.disconnect();
  liveState.socket = io();
  liveState.socket.on('connect', () => {
    root.querySelectorAll('[data-dashboard-comment]').forEach((item) => {
      if (item.dataset.orgId) liveState.socket.emit('org:join', { orgId: item.dataset.orgId });
    });
  });
  liveState.socket.on('org:moderation-updated', ({ commentId, action }) => {
    if (!commentId || !['comment-removed', 'comment-reviewed'].includes(action)) return;
    const item = root.querySelector(`[data-dashboard-comment-id="${CSS.escape(commentId)}"]`);
    if (!item) return;
    item.remove();
    const list = root.querySelector('.dashboard-moderation-list');
    if (list && !list.querySelector('.dashboard-moderation-item')) {
      list.innerHTML = '<div class="empty-panel"><i data-lucide="badge-check"></i><h3>No moderation queue</h3><p>All visible comments are already reviewed.</p></div>';
      lucide.createIcons();
    }
  });
}

function bindDashboardInteractions() {
  window.clearInterval(liveState.dashboardHeroTimer);
  window.clearTimeout(liveState.dashboardHeroFadeTimer);
  const dashboard = document.querySelector('[data-dashboard-live]');
  if (!dashboard) return;

  const timeElement = dashboard.querySelector('.page-heading .time');
  if (timeElement) timeElement.textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

  const heroElement = dashboard.querySelector('.page-heading .hero');
  if (heroElement) {
    const heroMessages = [
      'Make today easier to carry.',
      'Your classes, people, and next steps in one calm view.',
      'Stay on top of your tasks and deadlines.',
      'Collaborate with your study groups seamlessly.',
      'Keep your learning organized and efficient.'
    ];
    let currentIndex = Math.floor(Math.random() * heroMessages.length);
    heroElement.textContent = heroMessages[currentIndex];
    heroElement.classList.add('hero-fade-in');
    liveState.dashboardHeroTimer = window.setInterval(() => {
      heroElement.classList.remove('hero-fade-in');
      heroElement.classList.add('hero-fade-out');
      liveState.dashboardHeroFadeTimer = window.setTimeout(() => {
        currentIndex = (currentIndex + 1) % heroMessages.length;
        heroElement.textContent = heroMessages[currentIndex];
        heroElement.classList.remove('hero-fade-out');
        heroElement.classList.add('hero-fade-in');
      }, 2500);
    }, 10000);
  }

  const groupSearch = dashboard.querySelector('[data-dashboard-group-search]');
  groupSearch?.addEventListener('input', () => {
    const query = groupSearch.value.trim().toLowerCase();
    dashboard.querySelectorAll('.dashboard-group-item').forEach((item) => {
      const text = item.querySelector('strong')?.textContent?.toLowerCase() || '';
      item.classList.toggle('hidden', Boolean(query) && !text.includes(query));
    });
  });
}

function bindInteractions() {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.auth-form').forEach((form) => form.classList.add('hidden')); tab.classList.add('active'); document.getElementById(tab.dataset.tab).classList.remove('hidden'); }));
  bindLiveForms();
  document.querySelectorAll('[data-auth-form]').forEach((form) => form.addEventListener('submit', (event) => {
    if (!form.reportValidity() || form.dataset.submitting === 'true') return;
    event.preventDefault();
    form.dataset.submitting = 'true';
    form.closest('.auth-page')?.classList.add('is-transitioning');
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;
    window.setTimeout(() => HTMLFormElement.prototype.submit.call(form), 900);
  }));
  bindDebugTools();
  document.querySelectorAll('[data-inline-create]').forEach((button) => button.addEventListener('click', () => { const form = document.querySelector('.inline-create-form'); form?.classList.remove('hidden'); form?.querySelector('input[name="title"]')?.focus(); form?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-course-tab]').forEach((tab) => tab.addEventListener('click', (event) => { event.preventDefault(); setCourseTab(tab.dataset.courseTab); }));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => { const target = document.getElementById(button.dataset.open); target?.classList.add('open'); target?.querySelector('input[name="title"]')?.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { button.closest('.modal-backdrop')?.classList.remove('open'); }));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.remove('open'); }));
  document.querySelectorAll('.comment-menu .menu-action.danger i[data-lucide="trash-2"]').forEach((icon) => icon.remove());
  bindNotificationGestures();
  document.querySelectorAll('[data-warning-close]').forEach((button) => button.addEventListener('click', () => { const modal = button.closest('[data-warning-modal]'); const warningId = modal?.dataset.warningId; modal?.remove(); if (warningId) fetch(`/notifications/${encodeURIComponent(warningId)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); }));
  document.querySelectorAll('[data-announcement-close]').forEach((button) => button.addEventListener('click', () => { const modal = button.closest('[data-announcement-modal]'); const announcementId = modal?.dataset.announcementId; modal?.remove(); if (announcementId) fetch(`/notifications/${encodeURIComponent(announcementId)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); }));
  document.querySelectorAll('.report-action-form select[name="action"]').forEach((select) => select.addEventListener('change', () => { const field = select.form.querySelector('.suspension-field'); if (field) field.hidden = select.value !== 'remove-moderate'; }));
  document.querySelectorAll('.report-action-form select[name="action"]').forEach((select) => select.dispatchEvent(new Event('change')));
  document.querySelectorAll('[data-user-search]').forEach((input) => {
    const results = input.closest('label')?.querySelector('[data-user-search-results]');
    let timer;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = input.value.trim();
      if (!query) { if (results) results.innerHTML = ''; return; }
      timer = window.setTimeout(async () => {
        const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
        if (!response.ok || !results) return;
        const users = await response.json();
        results.innerHTML = users.map((candidate) => `<button type="button" role="option" data-username="${escapeHtml(candidate.username)}"><strong>${escapeHtml(candidate.name)}</strong><small>@${escapeHtml(candidate.username)}</small></button>`).join('') || '<span class="user-search-empty">No users found</span>';
        results.querySelectorAll('[data-username]').forEach((option) => option.addEventListener('click', () => { input.value = option.dataset.username; results.innerHTML = ''; input.focus(); }));
      }, 160);
    });
  });
  document.querySelectorAll('[data-group-search]').forEach((input) => {
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      document.querySelectorAll('[data-group-row]').forEach((row) => {
        const name = (row.dataset.groupName || row.textContent || '').toLowerCase();
        row.hidden = Boolean(query) && !name.includes(query);
      });
    });
  });
  const hash = window.location.hash.slice(1); if (courseRoot() && ['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false);
  syncTodoSummary();
  lucide.createIcons(); bindTodoControls(); bindDashboardInteractions(); connectLiveCourse(); connectLiveBreakout(); connectLiveTodo(); connectLiveNotifications(); connectLiveDashboard();
}

window.addEventListener('live-error', (event) => showLiveError(event.detail || 'Action failed. Please try again.'));

function isInternalGetLink(link) { return link.origin === window.location.origin && link.pathname && !link.pathname.startsWith('/share/') && !link.hasAttribute('download') && link.target !== '_blank' && !link.dataset.noRouter; }
async function navigate(url, pushState = true) { routeProgress.classList.add('active'); document.body.classList.add('is-navigating'); try { const response = await fetch(url, { headers: { 'X-Studyline-Navigation': 'true' } }); if (!response.ok || response.redirected) throw new Error(`Navigation failed: ${response.status}`); const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html'); const nextShell = nextDocument.querySelector('.app-shell'); if (!nextShell) throw new Error('Navigation returned an incomplete page.'); nextDocument.body.querySelectorAll('script').forEach((script) => script.remove()); liveState.socket?.disconnect(); liveState.notificationSocket?.disconnect(); document.querySelector('.app-shell')?.replaceWith(nextShell); document.body.className = nextDocument.body.className; document.body.classList.add('is-navigating'); document.body.appendChild(routeProgress); document.title = nextDocument.title; if (pushState) window.history.pushState({}, '', url); window.scrollTo({ top: 0, behavior: 'instant' }); bindInteractions(); requestAnimationFrame(() => document.body.classList.remove('is-navigating')); } catch (error) { window.location.assign(url); } finally { routeProgress.classList.remove('active'); } }
document.addEventListener('click', (event) => { const link = event.target.closest('a'); if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isInternalGetLink(link)) return; const target = new URL(link.href); if (target.hash && target.pathname === window.location.pathname) return; event.preventDefault(); navigate(target.href); });
window.addEventListener('popstate', () => navigate(window.location.href, false));
window.addEventListener('hashchange', () => { const hash = window.location.hash.slice(1); if (['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false); });
function playAboutHero() {
  const video = document.querySelector('[data-about-hero-video]');
  if (!video) return;
  let started = false;
  const startPlayback = () => {
    if (started) return;
    started = true;
    video.pause();
    video.currentTime = 0;
    window.setTimeout(() => { video.play().catch(() => {}); }, 1000);
  };
  const begin = () => {
    if (!document.body.classList.contains('page-ready')) return;
    if (video.readyState >= 1) startPlayback();
    else video.addEventListener('loadedmetadata', startPlayback, { once: true });
  };
  video.addEventListener('ended', () => video.pause(), { once: true });
  document.addEventListener('page-reveal', begin, { once: true });
  if (document.body.classList.contains('page-ready')) begin();
}

function bindPageLoader() {
  const loader = document.querySelector('[data-page-loader]');
  const shimmer = document.querySelector('[data-page-loader-video]');
  if (!loader || !shimmer) return;
  const pageMedia = [...document.querySelectorAll('video:not([data-page-loader-video])')];
  pageMedia.forEach((video) => video.pause());
  let pageLoaded = document.readyState === 'complete';
  let shimmerFinished = false;
  let finished = false;
  const reveal = () => {
    if (finished || !pageLoaded || !shimmerFinished) return;
    finished = true;
    document.body.classList.add('page-ready');
    pageMedia.forEach((video) => {
      if (video.hasAttribute('autoplay')) video.play().catch(() => {});
    });
    document.dispatchEvent(new Event('page-reveal'));
    window.setTimeout(() => loader.remove(), 1150);
  };
  const finishShimmer = () => {
    shimmer.pause();
    shimmerFinished = true;
    reveal();
  };
  const finishOrLoopShimmer = () => {
    if (pageLoaded) {
      finishShimmer();
      return;
    }
    shimmer.currentTime = 0;
    shimmer.play().catch(finishShimmer);
  };
  window.addEventListener('load', () => { pageLoaded = true; reveal(); }, { once: true });
  shimmer.addEventListener('ended', finishOrLoopShimmer);
  shimmer.addEventListener('error', finishShimmer, { once: true });
  if (shimmer.ended) finishOrLoopShimmer();
  const startShimmer = () => {
    if (shimmer.dataset.started === 'true') return;
    shimmer.dataset.started = 'true';
    shimmer.currentTime = 0;
    shimmer.play().catch(finishShimmer);
  };
  if (shimmer.readyState >= 1) startShimmer();
  else shimmer.addEventListener('loadedmetadata', startShimmer, { once: true });
}

function bindLandingShader() {
  const canvas = document.querySelector('[data-landing-shader]');
  if (!canvas) return;
  const context = canvas.getContext('webgl', { alpha: false, antialias: true });
  if (!context) return;
  const vertexSource = 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }';
  const fragmentSource = `precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform vec2 mouse;
    #define PI 3.14159265359
    void main() {
      vec2 uv = gl_FragCoord.xy / resolution.xy;
      vec2 point = uv - 0.5;
      point.x *= resolution.x / resolution.y;
      vec2 cursor = (mouse - 0.5) * vec2(0.24, 0.16);
      float waveOne = sin(point.x * 3.4 + time * 0.42 + cursor.x) * 0.14;
      float waveTwo = cos(point.y * 4.8 - time * 0.28 + cursor.y) * 0.12;
      float ribbon = smoothstep(0.18, 0.0, abs(point.y - waveOne - waveTwo));
      float orbit = smoothstep(0.025, 0.0, abs(length(point + vec2(0.12, -0.04)) - 0.34));
      vec3 navy = vec3(0.07, 0.18, 0.31);
      vec3 blue = vec3(0.10, 0.34, 0.51);
      vec3 coral = vec3(0.91, 0.32, 0.22);
      vec3 gold = vec3(0.93, 0.63, 0.22);
      vec3 color = mix(navy, blue, smoothstep(-0.7, 0.8, point.x + point.y * 0.4));
      color += coral * ribbon * 0.55;
      color += gold * orbit * 0.65;
      float cursorLight = smoothstep(0.34, 0.0, length(point - cursor));
      color += vec3(0.12, 0.08, 0.02) * cursorLight;
      color += 0.035 * sin(vec3(0.0, 1.7, 3.1) + time * 0.12 + point.xyx * 4.0);
      gl_FragColor = vec4(color, 1.0);
    }`;
  const compile = (type, source) => {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) return null;
    return shader;
  };
  const vertexShader = compile(context.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(context.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return;
  const program = context.createProgram();
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) return;
  const buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
  const positionLocation = context.getAttribLocation(program, 'position');
  const resolutionLocation = context.getUniformLocation(program, 'resolution');
  const timeLocation = context.getUniformLocation(program, 'time');
  const mouseLocation = context.getUniformLocation(program, 'mouse');
  const hero = canvas.closest('.landing-hero');
  const targetMouse = { x: 0.5, y: 0.5 };
  const currentMouse = { x: 0.5, y: 0.5 };
  const updateMouse = (event) => {
    const bounds = canvas.getBoundingClientRect();
    targetMouse.x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    targetMouse.y = Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height));
  };
  hero?.addEventListener('pointermove', updateMouse, { passive: true });
  hero?.addEventListener('pointerleave', () => { targetMouse.x = 0.5; targetMouse.y = 0.5; }, { passive: true });
  const resize = () => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    context.viewport(0, 0, width, height);
  };
  const draw = (timestamp) => {
    resize();
    context.useProgram(program);
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.enableVertexAttribArray(positionLocation);
    context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 0, 0);
    context.uniform2f(resolutionLocation, canvas.width, canvas.height);
    context.uniform1f(timeLocation, timestamp * 0.001);
    currentMouse.x += (targetMouse.x - currentMouse.x) * 0.045;
    currentMouse.y += (targetMouse.y - currentMouse.y) * 0.045;
    context.uniform2f(mouseLocation, currentMouse.x, currentMouse.y);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
  };
  let frameId;
  const animate = (timestamp) => { draw(timestamp); frameId = window.requestAnimationFrame(animate); };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) draw(0);
  else frameId = window.requestAnimationFrame(animate);
  window.addEventListener('resize', resize, { passive: true });
  canvas.addEventListener('webglcontextlost', () => window.cancelAnimationFrame(frameId), { once: true });
}

bindInteractions();
playAboutHero();
bindPageLoader();
bindLandingShader();