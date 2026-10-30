function todoList() { return document.querySelector('[data-live-todo-list]'); }
function todoRoot() { return document.querySelector('[data-todo-date-locale]'); }
function formatTodoDate(due) {
  if (!due || due === 'No date') return 'No date';
  const date = new Date(`${due}T12:00:00Z`); if (Number.isNaN(date.getTime())) return due;
  const root = todoRoot();
  try { return new Intl.DateTimeFormat(root?.dataset.todoDateLocale || 'en-US', { timeZone: root?.dataset.todoDateTimezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); } catch (error) { return due; }
}
function captureTodoPositions() { const list = todoList(); return list ? captureTaskListPositions(list) : null; }
function animateTodoPositions(previous, organizing = false) {
  const list = todoList();
  animateTaskListPositions(list, previous, { organizing });
}
function celebrateTask(task) {
  task.classList.add('task-completing');
  const check = task.querySelector('.task-check'); if (!check) return;
  const colors = ['#ef7357', '#e9b44c', '#4c8fd0', '#43a66a'];
  const burst = document.createElement('span'); burst.className = 'task-confetti'; burst.setAttribute('aria-hidden', 'true');
  burst.innerHTML = colors.map((color, index) => `<i style="--confetti-color:${color};--confetti-angle:${index * 90}deg"></i>`).join('');
  check.append(burst); window.setTimeout(() => { burst.remove(); task.classList.remove('task-completing'); }, 650);
}
function todoImportance(due) {
  if (!due || due === 'No date') return 'Unscheduled';
  const today = new Date(); today.setHours(0, 0, 0, 0); const date = new Date(`${due}T00:00:00`); const days = Math.round((date - today) / 86400000);
  if (days < 0) return 'Overdue'; if (days === 0) return 'Today'; if (days <= 3) return 'Soon'; return 'Later';
}
function todoTaskMarkup(task) {
  const importance = task.importance || todoImportance(task.due); const priority = task.priority || 'Normal';
  const editForm = `<details class="task-edit-details"><summary class="lui-icon-button" aria-label="Edit task"><i data-lucide="pencil"></i></summary><form class="task-edit-form link-composer" action="/tasks/${escapeHtml(task.id)}/update" method="post" data-live-form data-link-composer><label>Title<input name="title" value="${escapeHtml(task.title)}" required></label><label>Details<textarea name="details" rows="3">${escapeHtml(task.details || '')}</textarea></label><div class="link-draft-previews" data-link-draft-previews hidden></div><label>Due date<input name="due" type="date" value="${task.due !== 'No date' ? escapeHtml(task.due) : ''}"></label><label>Priority<select name="priority">${['Low', 'Normal', 'Medium', 'High'].map((value) => `<option ${priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><button class="lui-button lui-button-secondary" type="submit">Save task</button></form></details>`;
  return `<article class="private-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}" data-due="${escapeHtml(task.due)}" data-importance="${importance}" data-priority="${escapeHtml(priority.toLowerCase())}" data-position="${Number(task.position) || 0}" draggable="false"><form class="toggle-task-form" action="/tasks/${escapeHtml(task.id)}/toggle" method="post" data-live-form><button class="lui-check task-check" aria-label="Toggle ${escapeHtml(task.title)}"><i data-lucide="check"></i></button></form><div class="private-task-copy"><h3>${linkedTaskTextMarkup(task.title, task.links)}</h3>${task.details ? `<p class="task-details">${linkedTaskTextMarkup(task.details, task.links)}</p>` : ''}<span><i data-lucide="link-2"></i> ${escapeHtml(task.source)}</span><small class="task-due" data-raw-due="${escapeHtml(task.due)}">Due ${escapeHtml(formatTodoDate(task.due))} · ${importance}</small></div>${editForm}<div class="priority-menu"><button class="lui-menu-trigger priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(priority)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button class="lui-menu-action" type="button" data-priority="Low">Low</button><button class="lui-menu-action" type="button" data-priority="Normal">Normal</button><button class="lui-menu-action" type="button" data-priority="Medium">Medium</button><button class="lui-menu-action" type="button" data-priority="High">High</button></div></div><form data-live-form action="/tasks/${escapeHtml(task.id)}/delete" method="post"><button class="lui-icon-button" type="submit" aria-label="Delete task"><i data-lucide="trash-2"></i></button></form><button class="lui-icon-button drag-handle" aria-label="Move task" type="button"><i data-lucide="grip-vertical"></i></button></article>`;
}
function sortTodoDom(compare) { const list = todoList(); if (!list) return; [...list.querySelectorAll('.private-task')].sort(compare).forEach((task) => list.appendChild(task)); }
function persistTodoOrder() {
  const list = todoList(); if (!list) return;
  const order = [...list.querySelectorAll('.private-task')].map((task, index) => { task.dataset.position = index; return task.dataset.taskId; });
  fetch('/tasks/reorder', { method: 'POST', body: new URLSearchParams({ order: order.join(',') }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } });
}
function applyTodoFilter(filter = 'all') {
  const list = todoList(); if (!list) return;
  const previous = captureTodoPositions();
  document.querySelectorAll('[data-todo-filter]').forEach((link) => link.classList.toggle('active', link.dataset.todoFilter === filter));
  list.querySelectorAll('.private-task').forEach((task) => { task.hidden = filter === 'pending' ? task.classList.contains('is-done') : filter === 'completed' ? !task.classList.contains('is-done') : false; });
  list.dataset.activeFilter = filter; animateTodoPositions(previous);
}
function toggleFocusMode(button) {
  const list = todoList(); if (!list) return;
  const previous = captureTodoPositions();
  const active = button.classList.toggle('active');
  if (active) sortTodoDom((left, right) => { const leftDue = left.dataset.due === 'No date' ? Number.MAX_SAFE_INTEGER : new Date(`${left.dataset.due}T00:00:00`).getTime(); const rightDue = right.dataset.due === 'No date' ? Number.MAX_SAFE_INTEGER : new Date(`${right.dataset.due}T00:00:00`).getTime(); return (leftDue - rightDue) || (Number(left.dataset.position) - Number(right.dataset.position)); });
  else sortTodoDom((left, right) => Number(left.dataset.position) - Number(right.dataset.position));
  animateTodoPositions(previous, true);
}
function enhanceTodoTasks() {
  const list = todoList(); if (!list) return;
  list.querySelectorAll('.private-task').forEach((task, index) => {
    task.draggable = false; task.dataset.position ||= index; task.dataset.due ||= task.querySelector('[data-raw-due]')?.dataset.rawDue || 'No date'; task.dataset.importance ||= todoImportance(task.dataset.due); task.dataset.priority ||= task.querySelector('.priority-flag')?.textContent.trim().toLowerCase() || 'normal';
    const priority = task.querySelector('.priority-flag');
    if (priority && !priority.closest('.priority-menu')) { const value = priority.textContent.trim(); const menu = document.createElement('div'); menu.className = 'priority-menu'; menu.innerHTML = `<button class="lui-menu-trigger priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(value)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button class="lui-menu-action" type="button" data-priority="Low">Low</button><button class="lui-menu-action" type="button" data-priority="Normal">Normal</button><button class="lui-menu-action" type="button" data-priority="Medium">Medium</button><button class="lui-menu-action" type="button" data-priority="High">High</button></div>`; priority.replaceWith(menu); }
  });
  bindTodoPriorityMenus(list);
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
function bindTodoPriorityMenus(scope = document) {
  scope.querySelectorAll('.priority-menu').forEach((menu) => {
    if (menu.dataset.priorityBound === 'true') return;
    menu.dataset.priorityBound = 'true';
    menu.querySelector('.priority-flag')?.addEventListener('click', (event) => { event.preventDefault(); menu.classList.contains('open') ? closePopupMenu(menu) : openPopupMenu(menu); });
    menu.querySelectorAll('[data-priority]').forEach((option) => option.addEventListener('click', async () => { const row = menu.closest('.private-task'); const response = await fetch(`/tasks/${row.dataset.taskId}/priority`, { method: 'POST', body: new URLSearchParams({ priority: option.dataset.priority }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); if (!response.ok) return; row.dataset.priority = option.dataset.priority.toLowerCase(); menu.querySelector('.priority-flag span').textContent = option.dataset.priority; closePopupMenu(menu); }));
  });
}
function connectLiveTodo() {
  const list = todoList(); if (!list || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io(); liveState.socket.on('connect', () => liveState.socket.emit('todo:join'));
  liveState.socket.on('todo:task-added', ({ task }) => { if (!task || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) return; list.querySelector('.empty-panel')?.remove(); const previous = captureTaskListPositions(list); list.insertAdjacentHTML('beforeend', todoTaskMarkup(task)); const row = list.querySelector(`:scope > [data-task-id="${CSS.escape(task.id)}"]`); if (!row) return; row.hidden = list.dataset.activeFilter === 'completed'; animateTaskListPositions(list, previous, { enterElement: row, rippleFrom: row }); bindLiveForms(row); bindLinkComposers(row); enhanceTodoTasks(); lucide.createIcons(); });
  liveState.socket.on('todo:task-updated', ({ task }) => { const row = task && list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (!row) return; row.outerHTML = todoTaskMarkup(task); const nextRow = list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); bindLiveForms(nextRow); bindLinkComposers(nextRow); enhanceTodoTasks(); lucide.createIcons(); syncTodoSummary(); });
  liveState.socket.on('todo:task-deleted', ({ taskId }) => { list.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); syncTodoSummary(); });
  liveState.socket.on('todo:reordered', ({ tasks }) => { if (!tasks) return; const byId = new Map(tasks.map((task) => [task.id, task])); [...list.querySelectorAll('.private-task')].sort((left, right) => byId.get(left.dataset.taskId).position - byId.get(right.dataset.taskId).position).forEach((task) => list.appendChild(task)); });
}
function bindTodoControls() {
  bindLinkComposers();
  enhanceTodoTasks();
  document.querySelectorAll('[data-todo-filter]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); applyTodoFilter(link.dataset.todoFilter); history.replaceState({}, '', `/todo${link.dataset.todoFilter === 'all' ? '' : `?filter=${link.dataset.todoFilter}`}`); }));
  document.querySelector('[data-focus-mode]')?.addEventListener('click', (event) => toggleFocusMode(event.currentTarget));
  bindTodoPriorityMenus();
  const filter = new URLSearchParams(window.location.search).get('filter') || 'all'; applyTodoFilter(filter);
}

async function submitLiveForm(form, animatedEntry = null) {
  const actionUrl = form.getAttribute('action') || ''; const submit = form.querySelector('button[type="submit"]'); const original = submit?.innerHTML; const formData = new FormData(form);
  const isTaskToggle = form.classList.contains('toggle-task-form');
  const isTaskCreate = form.matches('[data-live-form][action="/tasks"]');
  form.querySelector('[data-form-error]')?.setAttribute('hidden', '');
  if (submit) { submit.disabled = true; submit.dataset.original = original; }
  if (isTaskCreate || form.matches('.inline-create-form, .task-add-form')) form.classList.add('task-creation-pending');
  try {
    const response = await fetch(actionUrl, { method: 'POST', body: new URLSearchParams(formData), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } });
    const payload = await response.json(); if (!response.ok || payload.error) throw new Error(payload.error || 'Action failed');
    if (payload.redirectTo) { window.location.assign(payload.redirectTo); return; }
    if (payload.groupUrl) { window.location.assign(payload.groupUrl); return; }
    if (payload.deletedAccount) { window.location.assign('/'); return; }
    if (payload.successMessage) showLiveSuccess(payload.successMessage);
    if (actionUrl === '/settings/push') {
      document.body.dataset.pushEnabled = formData.get('pushEnabled') === 'on' ? 'true' : 'false';
      document.body.dataset.pushBreakoutComments = formData.get('pushBreakoutComments') === 'on' ? 'true' : 'false';
      document.body.dataset.pushBreakoutTasks = formData.get('pushBreakoutTasks') === 'on' ? 'true' : 'false';
      document.body.dataset.pushMentions = formData.get('pushMentions') === 'on' ? 'true' : 'false';
      document.body.dataset.pushAnnouncements = formData.get('pushAnnouncements') === 'on' ? 'true' : 'false';
    }
    form.querySelectorAll('input:not([type="hidden"]), textarea').forEach((field) => { field.value = ''; field.dispatchEvent(new Event('input')); });
    const details = form.closest('details');
    if (!form.closest('.notification-menu')) {
      if (details?.matches(popupDetailsSelector)) closePopupMenu(details);
      else details?.removeAttribute('open');
    }
    if (payload.invitationAction || payload.leftGroup || payload.deletedGroup) { window.location.reload(); return; }
    if (payload.read || payload.readAll) {
      if (payload.readAll) document.querySelectorAll('.notification-item.unread').forEach((item) => item.classList.replace('unread', 'is-read'));
      else form.closest('.notification-item')?.classList.replace('unread', 'is-read');
      const unread = document.querySelectorAll('.notification-item.unread').length; const badge = document.querySelector('.notification-menu .notification-count');
      if (badge) { badge.textContent = String(unread); badge.hidden = unread === 0; }
    }
    if (payload.action && payload.reportId) {
      const report = document.querySelector(`[data-report-id="${CSS.escape(payload.reportId)}"]`);
      const queue = report?.closest('[data-report-queue]');
      report?.remove();
      if (queue && !queue.querySelector('[data-report-id]')) {
        const count = queue.querySelector('.queue-count');
        if (count) count.textContent = '0 open';
        const empty = document.createElement('div');
        empty.className = 'empty-panel';
        empty.dataset.reportEmpty = 'true';
        empty.innerHTML = '<i data-lucide="flag"></i><h3>No open reports</h3><p>Reports from every group will appear here.</p>';
        queue.append(empty);
        lucide.createIcons();
      }
    }
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
        const context = itemCardElement && courseLive ? { orgId: courseLive.dataset.orgId, itemId: itemCardElement.dataset.itemId, canEdit: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canDelete: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canViewHistory: courseLive.dataset.isAdmin === 'true' } : breakoutLive ? { orgId: breakoutLive.dataset.orgId, groupId: breakoutLive.dataset.groupId, canEdit: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canDelete: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canViewHistory: breakoutLive.dataset.groupAdmin === 'true' } : null;
        if (entry && context) { entry.outerHTML = commentMarkup(payload.comment, context); bindLiveForms(entry.parentElement || document); lucide.createIcons(); }
      } else {
        const breakoutLive = form.closest('[data-breakout-live]');
        if (breakoutLive) appendBreakoutComment(payload.comment, breakoutLive);
        else { const itemId = actionUrl.split('/').at(-2); appendUniqueComment(itemId, payload.comment); }
      }
    }
    if (payload.task) {
      const breakoutLive = form.closest('[data-breakout-live]');
      const row = breakoutLive?.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
      if (breakoutLive && row) { row.outerHTML = breakoutTaskMarkup(payload.task, breakoutLive); bindLiveForms(breakoutLive.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`)); lucide.createIcons(); }
      else if (breakoutLive && /\/tasks\/?$/.test(actionUrl)) insertBreakoutTask(breakoutLive, payload.task);
    }
    if (payload.task) {
      const list = document.querySelector('[data-live-todo-list]'); if (list) {
        const existing = list.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
        if (!existing) {
          const empty = list.querySelector('.empty-panel'); empty?.remove();
          const previous = captureTaskListPositions(list);
          list.insertAdjacentHTML('beforeend', todoTaskMarkup(payload.task));
          const row = list.querySelector(`:scope > [data-task-id="${CSS.escape(payload.task.id)}"]`);
          if (row) {
            row.hidden = list.dataset.activeFilter === 'completed';
            animateTaskListPositions(list, previous, { enterElement: row, rippleFrom: row });
            bindLiveForms(row);
            bindLinkComposers(row);
          }
          enhanceTodoTasks();
          lucide.createIcons();
        }
        if (isTaskCreate) {
          form.reset();
          void animateTaskComposer(document.getElementById('quick-task'), false);
        }
      }
    }
    if (payload.task && isTaskToggle) {
      const row = document.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
      if (row) { row.classList.toggle('is-done', Boolean(payload.task.done)); if (payload.task.done) celebrateTask(row); applyTodoFilter(document.querySelector('[data-live-todo-list]')?.dataset.activeFilter || 'all'); }
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
    if (payload.item) {
      insertCourseFeedItem(form.closest('[data-course-live]'), payload.item);
      form.reset();
      if (form.matches('.inline-create-form')) void animateTaskComposer(form, false);
    }
    if (payload.card || payload.resource) form.reset();
    syncTodoSummary();
  } catch (error) {
    if (animatedEntry) { animatedEntry.style.transform = ''; animatedEntry.classList.remove('notification-waterfall-out'); }
    showFormError(form, error.message, formData.get('comment'));
  } finally {
    form.classList.remove('task-creation-pending');
    if (submit) { submit.disabled = false; submit.innerHTML = submit.dataset.original; }
  }
}

function showFormError(form, message, phrase) {
  let error = form.querySelector('[data-form-error]');
  if (!error) {
    error = document.createElement('small');
    error.className = 'form-error';
    error.dataset.formError = 'true';
    form.querySelector('.comment-edit-actions')?.before(error);
    if (!error.parentElement) form.append(error);
  }
  error.innerHTML = `${escapeHtml(message)}${phrase ? ` <button class="lui-link appeal-word-link" type="button" data-appeal-word data-phrase="${escapeHtml(phrase)}">Report mistake</button>` : ''}`;
  error.hidden = false;
  bindLiveForms(error);
}

function bindTaskCopyModal() {
  const modal = document.querySelector('[data-task-copy-modal]');
  if (!modal || modal.dataset.bound === 'true') return;
  modal.dataset.bound = 'true';
  const dialog = modal.querySelector('.task-copy-dialog');
  const heading = modal.querySelector('[data-copy-heading]');
  const description = modal.querySelector('[data-copy-description]');
  const groups = modal.querySelector('[data-copy-groups]');
  const review = modal.querySelector('[data-copy-review]');
  const progress = modal.querySelector('[data-copy-progress]');
  const result = modal.querySelector('[data-copy-result]');
  const errorMessage = modal.querySelector('[data-copy-error]');
  const back = modal.querySelector('[data-copy-back]');
  const groupCrumb = modal.querySelector('[data-copy-group-crumb]');
  const courseCrumb = modal.querySelector('[data-copy-course-crumb]');
  const groupCrumbButton = groupCrumb.querySelector('button');
  const courseLabel = modal.querySelector('[data-copy-course-label]');
  let selectedGroup = null;
  let selectedCourse = null;
  let returnFocus = null;

  const renderStep = (step) => {
    modal.dataset.step = step;
    const locked = step === 'copying' || step === 'done';
    groups.hidden = !['groups', 'courses'].includes(step);
    review.hidden = step !== 'review';
    progress.hidden = step !== 'copying';
    result.hidden = step !== 'done';
    back.hidden = !['courses', 'review'].includes(step);
    back.disabled = locked;
    groupCrumb.hidden = !selectedGroup || !['courses', 'review'].includes(step);
    courseCrumb.hidden = !selectedCourse || !['review', 'copying', 'done'].includes(step);
    modal.querySelectorAll('[data-copy-group]').forEach((button) => {
      button.hidden = step !== 'groups';
    });
    modal.querySelectorAll('[data-copy-courses]').forEach((list) => {
      list.hidden = step !== 'courses' || list.dataset.copyCourses !== selectedGroup?.id;
    });
    const labels = {
      groups: ['Choose a group', modal.dataset.copyTitle ? `Copy “${modal.dataset.copyTitle}” into a course you can edit.` : 'Select the group that contains the destination course.'],
      courses: ['Choose a course', `Select a course in ${selectedGroup?.name || 'this group'}.`],
      review: ['Ready to copy', 'Check the destination, then make the copy.'],
      copying: ['Copying task', 'Your task is being added to the selected course.'],
      done: ['Copy complete', 'Your copied task is ready to open.']
    };
    heading.textContent = labels[step][0];
    description.textContent = labels[step][1];
    groupCrumbButton.textContent = selectedGroup?.name || '';
    courseLabel.textContent = selectedCourse ? `${selectedCourse.code ? `${selectedCourse.code} · ` : ''}${selectedCourse.name}` : '';
    errorMessage.hidden = true;
    if (step === 'review') modal.querySelector('[data-copy-destination]').textContent = `${selectedGroup.name} · ${selectedCourse.code ? `${selectedCourse.code} · ` : ''}${selectedCourse.name}`;
  };

  const reset = () => {
    selectedGroup = null;
    selectedCourse = null;
    modal.dataset.copyUrl = '';
    modal.dataset.copyTitle = '';
    renderStep('groups');
  };
  const close = () => {
    if (modal.dataset.step === 'copying') return;
    modal.hidden = true;
    modal.classList.remove('open');
    document.body.classList.remove('task-copy-open');
    returnFocus?.focus();
  };

  const course = courseRoot();
  course?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-copy-task-open]');
    if (!button) return;
    returnFocus = button;
    selectedGroup = null;
    selectedCourse = null;
    modal.dataset.copyUrl = button.dataset.copyUrl || '';
    modal.dataset.copyTitle = button.dataset.copyTitle || '';
    const details = button.closest('details');
    if (details?.matches(popupDetailsSelector)) closePopupMenu(details);
    else details?.removeAttribute('open');
    renderStep('groups');
    modal.hidden = false;
    modal.classList.add('open');
    document.body.classList.add('task-copy-open');
    requestAnimationFrame(() => dialog.focus());
  });

  modal.querySelectorAll('[data-copy-group]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedGroup = { id: button.dataset.copyGroup, name: button.dataset.copyGroupName };
      selectedCourse = null;
      renderStep('courses');
      modal.querySelector(`[data-copy-courses="${CSS.escape(selectedGroup.id)}"] [data-copy-course]`)?.focus();
    });
  });
  modal.querySelectorAll('[data-copy-course]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedCourse = { id: button.dataset.copyCourse, name: button.dataset.copyCourseName, code: button.dataset.copyCourseCode };
      renderStep('review');
      modal.querySelector('[data-copy-submit]').focus();
    });
  });
  modal.querySelector('[data-copy-back]').addEventListener('click', () => renderStep(modal.dataset.step === 'review' ? 'courses' : 'groups'));
  modal.querySelectorAll('[data-copy-nav="groups"]').forEach((button) => button.addEventListener('click', () => renderStep('groups')));
  groupCrumbButton.addEventListener('click', () => renderStep('courses'));
  modal.querySelector('[data-copy-close]').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href]:not([hidden])')].filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  });
  modal.querySelector('[data-copy-another]').addEventListener('click', () => {
    selectedGroup = null;
    selectedCourse = null;
    renderStep('groups');
    modal.querySelector('[data-copy-nav="groups"]').focus();
  });
  modal.querySelector('[data-copy-submit]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (!selectedGroup || !selectedCourse || !modal.dataset.copyUrl) return;
    errorMessage.hidden = true;
    button.disabled = true;
    const startedAt = Date.now();
    renderStep('copying');
    try {
      const request = fetch(modal.dataset.copyUrl, {
        method: 'POST',
        body: new URLSearchParams({ destinationOrgId: selectedGroup.id, destinationCourseId: selectedCourse.id }),
        headers: { Accept: 'application/json', 'X-Live-Request': 'true' }
      }).then((response) => ({ response }), (error) => ({ error }));
      const [result] = await Promise.all([request, new Promise((resolve) => window.setTimeout(resolve, 500))]);
      if (result.error) throw result.error;
      const response = result.response;
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error || 'The task could not be copied.');
      const link = modal.querySelector('[data-copy-result-link]');
      link.href = payload.copiedUrl;
      renderStep('done');
      link.focus();
      lucide.createIcons();
    } catch (error) {
      renderStep('review');
      errorMessage.textContent = error.message || 'The task could not be copied. Try again.';
      errorMessage.hidden = false;
      modal.querySelector('[data-copy-submit]').focus();
    } finally {
      if (Date.now() - startedAt < 500) await new Promise((resolve) => window.setTimeout(resolve, 500 - (Date.now() - startedAt)));
      modal.querySelector('[data-copy-submit]').disabled = false;
    }
  });
}

function syncTodoSummary() {
  const list = document.querySelector('[data-live-todo-list]'); const summary = document.querySelector('[data-todo-summary]'); const countTarget = document.querySelector('[data-live-todo-count]');
  if (!list) return;
  const count = list.querySelectorAll('.private-task:not(.is-done)').length;
  if (summary) summary.textContent = `${count} thing${count === 1 ? '' : 's'} still in motion`;
  if (countTarget) countTarget.textContent = count;
}
