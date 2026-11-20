function todoList() { return document.querySelector('[data-live-todo-list]'); }
function todoRoot() { return document.querySelector('[data-todo-date-locale]'); }
let focusTasks = [];
let focusCompleted = 0;
let focusReturnTarget = null;
let focusTaskOffset = 0;
let focusHasMoreTasks = false;
let focusTaskTotal = 0;
const focusBackgroundStorageKey = 'lockin.focus-mode.background';
function todoTaskSource(task) {
  return task.sourceId || task.source === 'Unlinked course task' ? task.source || '' : '';
}
function dashboardTodoTaskMarkup(task) {
  const source = todoTaskSource(task);
  return `<article class="dashboard-todo-item ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}"><form class="toggle-task-form" action="/tasks/${escapeHtml(task.id)}/toggle" method="post" data-live-form><button class="lui-check dashboard-todo-check" type="submit" aria-label="${task.done ? 'Mark incomplete' : 'Mark complete'}: ${escapeHtml(task.title)}"><i data-lucide="check"></i></button></form><div><strong>${linkedTaskTextMarkup(task.title, task.links)}</strong>${source ? `<small>${escapeHtml(source)}</small>` : ''}</div></article>`;
}
function syncDashboardTodoCount() {
  const list = document.querySelector('[data-dashboard-todo-list]');
  if (!list) return;
  const count = list.querySelectorAll('.dashboard-todo-item:not(.is-done)').length;
  document.querySelectorAll('[data-dashboard-todo-count], [data-live-todo-count]').forEach((target) => { target.textContent = String(count); });
  const taskCount = Number(list.dataset.taskCount) || 0;
  const pendingCount = Number(list.dataset.pendingCount) || 0;
  const emptyState = list.querySelector('.dashboard-todo-empty');
  const allClear = list.querySelector('[data-todo-all-clear]');
  const showAllClear = taskCount > 0 && pendingCount === 0;
  if (allClear) {
    if (showAllClear) {
      if (emptyState) emptyState.remove();
      if (allClear.hidden) {
        allClear.hidden = false;
        allClear.classList.remove('is-arriving');
        requestAnimationFrame(() => allClear.classList.add('is-arriving'));
      }
    } else {
      allClear.hidden = true;
      allClear.classList.remove('is-arriving');
    }
  }
  const hasPendingRows = list.querySelectorAll('.dashboard-todo-item:not(.is-done)').length > 0;
  if (taskCount > 0) {
    if (showAllClear) {
      list.querySelectorAll('.dashboard-todo-item').forEach((row) => row.remove());
      if (emptyState) emptyState.remove();
      return;
    }
    if (hasPendingRows && emptyState) emptyState.remove();
    return;
  }
  if (emptyState) emptyState.remove();
  const empty = document.createElement('p');
  empty.className = 'dashboard-todo-empty';
  empty.textContent = 'Your private queue is clear. Add a task from any class feed.';
  list.append(empty);
}
function updateDashboardTodo(task, payload = {}) {
  const list = document.querySelector('[data-dashboard-todo-list]');
  if (!list || !task) return;
  if (payload.todoTaskCount !== undefined) list.dataset.taskCount = String(payload.todoTaskCount);
  if (payload.todoPendingCount !== undefined) list.dataset.pendingCount = String(payload.todoPendingCount);
  let row = list.querySelector(`[data-task-id="${CSS.escape(String(task.id))}"]`);
  const wasDone = row?.classList.contains('is-done');
  if (row) row.outerHTML = dashboardTodoTaskMarkup(task);
  else {
    list.querySelector('.dashboard-todo-empty')?.remove();
    list.insertAdjacentHTML('beforeend', dashboardTodoTaskMarkup(task));
  }
  const status = document.querySelector('[data-dashboard-todo-status]');
  if (status) status.textContent = wasDone === undefined
    ? `Added ${task.title} to Personal Todo.`
    : wasDone !== Boolean(task.done) ? `Marked ${task.title} ${task.done ? 'complete' : 'incomplete'}.` : '';
  bindLiveForms(list);
  syncDashboardTodoCount();
  lucide.createIcons();
}
function removeDashboardTodo(taskId, payload = {}) {
  const list = document.querySelector('[data-dashboard-todo-list]');
  list?.querySelector(`[data-task-id="${CSS.escape(String(taskId || ''))}"]`)?.remove();
  if (list) {
    if (payload.todoTaskCount !== undefined) list.dataset.taskCount = String(payload.todoTaskCount);
    if (payload.todoPendingCount !== undefined) list.dataset.pendingCount = String(payload.todoPendingCount);
  }
  syncDashboardTodoCount();
}
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
  const source = todoTaskSource(task);
  const editForm = `<details class="task-edit-details"><summary class="lui-icon-button" aria-label="Edit task"><i data-lucide="pencil"></i></summary><form class="task-edit-form link-composer" action="/tasks/${escapeHtml(task.id)}/update" method="post" data-live-form data-link-composer><label>Title<input name="title" value="${escapeHtml(task.title)}" required></label><label>Details<textarea name="details" rows="3">${escapeHtml(task.details || '')}</textarea></label><div class="link-draft-previews" data-link-draft-previews hidden></div><label>Due date<input name="due" type="date" value="${task.due !== 'No date' ? escapeHtml(task.due) : ''}"></label><label>Priority<select name="priority">${['Low', 'Normal', 'Medium', 'High'].map((value) => `<option ${priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></label><button class="lui-button lui-button-secondary" type="submit">Save task</button></form></details>`;
  return `<article class="private-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}" data-due="${escapeHtml(task.due)}" data-importance="${importance}" data-priority="${escapeHtml(priority.toLowerCase())}" data-position="${Number(task.position) || 0}" draggable="false"><form class="toggle-task-form" action="/tasks/${escapeHtml(task.id)}/toggle" method="post" data-live-form><button class="lui-check task-check" aria-label="Toggle ${escapeHtml(task.title)}"><i data-lucide="check"></i></button></form><div class="private-task-copy"><h3>${linkedTaskTextMarkup(task.title, task.links)}</h3>${task.details ? `<p class="task-details">${linkedTaskTextMarkup(task.details, task.links)}</p>` : ''}${source ? `<span><i data-lucide="link-2"></i> ${escapeHtml(source)}</span>` : ''}<small class="task-due" data-raw-due="${escapeHtml(task.due)}">Due ${escapeHtml(formatTodoDate(task.due))} · ${importance}</small></div>${editForm}<div class="priority-menu"><button class="lui-menu-trigger priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(priority)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button class="lui-menu-action" type="button" data-priority="Low">Low</button><button class="lui-menu-action" type="button" data-priority="Normal">Normal</button><button class="lui-menu-action" type="button" data-priority="Medium">Medium</button><button class="lui-menu-action" type="button" data-priority="High">High</button></div></div><form data-live-form action="/tasks/${escapeHtml(task.id)}/delete" method="post"><button class="lui-icon-button" type="submit" aria-label="Delete task"><i data-lucide="trash-2"></i></button></form><button class="lui-icon-button drag-handle" aria-label="Move task" type="button"><i data-lucide="grip-vertical"></i></button></article>`;
}
function sortTodoDom(compare) { const list = todoList(); if (!list) return; const sentinel = list.querySelector('[data-todo-load-more]'); [...list.querySelectorAll('.private-task')].sort(compare).forEach((task) => sentinel ? list.insertBefore(task, sentinel) : list.appendChild(task)); }
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
  if (filter === 'pending') void loadPendingTasksIfNeeded();
}
async function organizeTodoTasks(button) {
  const list = todoList(); if (!list) return;
  const status = document.querySelector('[data-auto-organize-status]');
  button.disabled = true;
  if (status) {
    status.textContent = 'Organizing and saving order...';
    status.hidden = false;
  }
  try {
    const response = await fetch('/tasks/organize', {
      method: 'POST',
      headers: { Accept: 'application/json', 'X-Live-Request': 'true' }
    });
    const payload = await response.json();
    if (!response.ok || payload.error || !Array.isArray(payload.tasks)) {
      throw new Error(payload.error || 'Task order could not be saved.');
    }
    const positions = new Map(payload.tasks.map((task) => [String(task.id), task.position]));
    list.querySelectorAll('.private-task').forEach((task) => {
      const position = positions.get(task.dataset.taskId);
      if (position !== undefined) task.dataset.position = String(position);
    });
    const previous = captureTodoPositions();
    sortTodoDom((left, right) => Number(left.dataset.position) - Number(right.dataset.position));
    animateTodoPositions(previous, true);
    if (status) {
      status.textContent = '';
      status.hidden = true;
    }
  } catch (error) {
    console.error('Could not organize and save Todo task order.', error);
    if (status) status.textContent = error.message || 'Task order could not be saved.';
  } finally {
    button.disabled = false;
  }
}
function waitForTodoAnimation(duration) { return new Promise((resolve) => window.setTimeout(resolve, duration)); }
function todoLoadMoreControl() { return document.querySelector('[data-todo-load-more]'); }
function setTodoLoadError(message) {
  const control = todoLoadMoreControl();
  if (!control) return;
  control.hidden = false;
  control.dataset.loadError = 'true';
  control.querySelector('[data-todo-load-message]').textContent = message;
  control.querySelector('.todo-loading-orbit').hidden = true;
  control.querySelector('[data-todo-load-retry]').hidden = false;
}
async function loadMoreTodoTasks() {
  const list = todoList();
  const control = todoLoadMoreControl();
  if (!list || !control || control.hidden || control.dataset.loading === 'true' || list.dataset.hasMore !== 'true') return false;
  control.dataset.loading = 'true';
  control.dataset.loadError = 'false';
  control.querySelector('.todo-loading-orbit').hidden = false;
  control.querySelector('[data-todo-load-message]').textContent = 'Bringing in the next tasks';
  control.querySelector('[data-todo-load-retry]').hidden = true;
  try {
    const offset = Number(list.dataset.offset) || 0;
    const response = await fetch(`/todo/tasks?offset=${offset}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Tasks could not be loaded.');
    const sentinel = control;
    const newRows = [];
    payload.tasks.forEach((task) => {
      const template = document.createElement('template');
      template.innerHTML = todoTaskMarkup(task);
      const row = template.content.firstElementChild;
      if (!row || list.querySelector(`[data-task-id="${CSS.escape(String(task.id))}"]`)) return;
      row.hidden = list.dataset.activeFilter === 'pending' ? Boolean(task.done) : list.dataset.activeFilter === 'completed' ? !task.done : false;
      list.insertBefore(row, sentinel);
      bindLiveForms(row);
      bindLinkComposers(row);
      newRows.push(row);
    });
    list.dataset.offset = String(offset + payload.tasks.length);
    list.dataset.hasMore = String(payload.hasMore);
    control.hidden = !payload.hasMore;
    if (!payload.hasMore) control.remove();
    newRows.forEach(enhanceTodoTasks);
    return true;
  } catch (error) {
    console.error('Could not load more Todo tasks.', error);
    setTodoLoadError('Tasks could not be loaded.');
    return false;
  } finally {
    if (control.isConnected) control.dataset.loading = 'false';
  }
}
async function loadPendingTasksIfNeeded() {
  const list = todoList();
  while (list?.dataset.activeFilter === 'pending'
    && list.querySelectorAll('.private-task:not(.is-done)').length < (Number(list.dataset.pageSize) || 10)
    && list.dataset.hasMore === 'true') {
    if (!await loadMoreTodoTasks()) return;
  }
}
function bindTodoPagination() {
  const list = todoList();
  const control = todoLoadMoreControl();
  if (!list || !control || list.dataset.hasMore !== 'true') return;
  control.querySelector('[data-todo-load-retry]')?.addEventListener('click', () => {
    control.dataset.loadError = 'false';
    void loadMoreTodoTasks();
  });
  list.addEventListener('scroll', () => {
    if (list.scrollTop > 0 && list.scrollTop + list.clientHeight >= list.scrollHeight - 100 && control.dataset.loadError !== 'true') {
      void loadMoreTodoTasks();
    }
  }, { passive: true });
}
function readFocusBackgroundPreference() {
  try {
    return window.localStorage.getItem(focusBackgroundStorageKey) || '';
  } catch (error) {
    console.error('Could not read the Focus Mode wallpaper preference.', error);
    return '';
  }
}
function saveFocusBackgroundPreference(url) {
  try {
    if (url) window.localStorage.setItem(focusBackgroundStorageKey, url);
    else window.localStorage.removeItem(focusBackgroundStorageKey);
  } catch (error) {
    console.error('Could not save the Focus Mode wallpaper preference.', error);
  }
}
function focusScreen() { return document.querySelector('[data-focus-screen]'); }
function focusError(message) {
  const error = focusScreen()?.querySelector('[data-focus-error]');
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}
function updateFocusBackground(imageUrl = '') {
  const screen = focusScreen();
  const scene = screen?.querySelector('[data-focus-scene]');
  if (!scene) return;
  scene.dataset.focusScene = imageUrl ? 'wallpaper' : 'empty';
  scene.style.backgroundImage = imageUrl ? `linear-gradient(180deg, rgba(10, 26, 34, .18), rgba(10, 26, 34, .48)), url("${imageUrl}")` : '';
  scene.style.backgroundColor = imageUrl ? '' : '#27464a';
  screen.querySelectorAll('[data-focus-wallpaper]').forEach((choice) => {
    const selected = choice.dataset.wallpaperUrl === imageUrl;
    choice.classList.toggle('is-selected', selected);
    choice.setAttribute('aria-pressed', String(selected));
  });
}
function focusWallpaperButton(wallpaper, collectionName = '') {
  const button = document.createElement('button');
  button.className = 'focus-wallpaper';
  button.type = 'button';
  button.dataset.focusWallpaper = 'true';
  button.dataset.wallpaperUrl = wallpaper.url;
  button.setAttribute('aria-label', `${wallpaper.name}${collectionName ? `, ${collectionName}` : ''}`);
  button.setAttribute('aria-pressed', 'false');
  const image = document.createElement('img');
  image.src = wallpaper.url;
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  const name = document.createElement('span');
  name.textContent = wallpaper.name;
  button.append(image, name);
  button.addEventListener('click', () => {
    updateFocusBackground(wallpaper.url);
    saveFocusBackgroundPreference(wallpaper.url);
    closeFocusBackgroundPicker();
  });
  return button;
}
function closeFocusBackgroundPicker(restoreFocus = true) {
  const picker = focusScreen()?.querySelector('[data-focus-picker]');
  const trigger = focusScreen()?.querySelector('[data-focus-sidebar-toggle]');
  const panel = picker?.querySelector('[data-focus-picker-panel]');
  if (!picker || !trigger || !panel || (!picker.classList.contains('is-open') && picker.hidden)) return;
  picker.classList.remove('is-open');
  panel.inert = true;
  panel.setAttribute('aria-hidden', 'true');
  trigger.hidden = false;
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Expand wallpaper sidebar');
  trigger.classList.remove('is-expanded');
  if (restoreFocus) trigger.focus();
  window.clearTimeout(picker.closeTimer);
  picker.closeTimer = window.setTimeout(() => {
    if (!picker.classList.contains('is-open')) picker.hidden = true;
  }, 260);
}
function openFocusBackgroundPicker() {
  const screen = focusScreen();
  const picker = screen?.querySelector('[data-focus-picker]');
  const trigger = screen?.querySelector('[data-focus-sidebar-toggle]');
  const panel = picker?.querySelector('[data-focus-picker-panel]');
  if (!picker || !trigger || !panel) return;
  window.clearTimeout(picker.closeTimer);
  picker.hidden = false;
  panel.inert = false;
  panel.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => picker.classList.add('is-open'));
  trigger.setAttribute('aria-expanded', 'true');
  trigger.setAttribute('aria-label', 'Collapse wallpaper sidebar');
  trigger.classList.add('is-expanded');
  panel.querySelector('[data-focus-picker-close]').focus();
  trigger.hidden = true;
}
function renderFocusBackgrounds(payload) {
  const screen = focusScreen();
  const bank = screen?.querySelector('[data-focus-picker]');
  if (!bank) return;
  bank.querySelector('[data-focus-background-error]').hidden = true;
  bank.querySelector('[data-focus-background-retry]').hidden = true;
  const recommended = bank.querySelector('[data-focus-recommended]');
  const emptyRecommended = bank.querySelector('[data-focus-empty-recommended]');
  const collectionsSection = bank.querySelector('[data-focus-collections-section]');
  const collections = bank.querySelector('[data-focus-collections]');
  const wallpapers = payload.recommended || [];
  emptyRecommended.hidden = wallpapers.length > 0;
  wallpapers.forEach((wallpaper) => recommended.append(focusWallpaperButton(wallpaper)));
  const collectionEntries = payload.collections || [];
  collectionsSection.hidden = collectionEntries.length === 0;
  collectionEntries.forEach((collection) => {
    const details = document.createElement('details');
    details.className = 'focus-collection';
    const summary = document.createElement('summary');
    summary.className = 'focus-collection-summary';
    const thumbnail = document.createElement('span');
    thumbnail.className = 'focus-collection-thumbnail';
    if (collection.thumbnail) {
      const image = document.createElement('img');
      image.src = collection.thumbnail;
      image.alt = '';
      image.loading = 'lazy';
      thumbnail.append(image);
    } else {
      thumbnail.setAttribute('aria-hidden', 'true');
      thumbnail.textContent = '—';
    }
    const copy = document.createElement('span');
    copy.className = 'focus-collection-copy';
    const name = document.createElement('strong');
    name.textContent = collection.name;
    const count = document.createElement('small');
    count.textContent = `${collection.wallpapers.length} wallpaper${collection.wallpapers.length === 1 ? '' : 's'}`;
    copy.append(name, count);
    const arrow = document.createElement('span');
    arrow.className = 'focus-collection-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    summary.append(thumbnail, copy, arrow);
    const gallery = document.createElement('div');
    gallery.className = 'focus-picker-wallpapers focus-collection-wallpapers';
    gallery.setAttribute('role', 'group');
    gallery.setAttribute('aria-label', `${collection.name} wallpapers`);
    if (collection.wallpapers.length) {
      collection.wallpapers.forEach((wallpaper) => gallery.append(focusWallpaperButton(wallpaper, collection.name)));
    } else {
      const empty = document.createElement('p');
      empty.className = 'focus-picker-empty';
      empty.textContent = 'Add images to this folder to fill the collection.';
      gallery.append(empty);
    }
    details.append(summary, gallery);
    collections.append(details);
  });
  const preferredUrl = readFocusBackgroundPreference();
  const allWallpapers = [...wallpapers, ...collectionEntries.flatMap((collection) => collection.wallpapers)];
  const preferredWallpaper = allWallpapers.find((wallpaper) => wallpaper.url === preferredUrl);
  const firstRecommended = wallpapers[0];
  const firstCollectionWallpaper = collectionEntries.find((collection) => collection.wallpapers.length)?.wallpapers[0];
  const selectedWallpaper = preferredWallpaper || firstRecommended || firstCollectionWallpaper;
  updateFocusBackground(selectedWallpaper?.url || '');
}
async function loadCustomFocusBackgrounds() {
  const bank = focusScreen()?.querySelector('[data-focus-picker]');
  if (!bank || bank.dataset.customLoaded === 'true') return;
  bank.dataset.customLoaded = 'true';
  try {
    const response = await fetch('/focus-backgrounds.json', { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.recommended) || !Array.isArray(payload.collections)) throw new Error(payload.error || 'Wallpaper collections are unavailable.');
    renderFocusBackgrounds(payload);
  } catch (error) {
    console.error('Could not load custom focus backgrounds.', error);
    bank.dataset.customLoaded = 'false';
    const message = focusScreen()?.querySelector('[data-focus-background-error]');
    if (message) {
      message.textContent = 'Wallpapers are unavailable. Try again in a moment.';
      message.hidden = false;
    }
    bank.querySelector('[data-focus-background-retry]').hidden = false;
  }
}
async function loadFocusTasksPage() {
  while (focusTasks.length === 0 && focusHasMoreTasks) {
    const countQuery = focusTaskOffset === 0 ? '&includePendingCount=true' : '';
    const response = await fetch(`/todo/tasks?offset=${focusTaskOffset}${countQuery}`, { headers: { Accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || 'Your tasks could not be loaded.');
    focusTaskOffset += payload.tasks.length;
    focusHasMoreTasks = payload.hasMore;
    if (Number.isSafeInteger(payload.pendingTotal)) focusTaskTotal = payload.pendingTotal;
    focusTasks.push(...payload.tasks.filter((task) => !task.done));
  }
}
function renderFocusTask() {
  const screen = focusScreen();
  const loading = screen.querySelector('[data-focus-loading]');
  const card = screen.querySelector('[data-focus-card]');
  const finish = screen.querySelector('[data-focus-finish]');
  const error = screen.querySelector('[data-focus-error]');
  screen.querySelector('[data-focus-retry]').hidden = true;
  const count = focusTasks.length;
  loading.hidden = true;
  error.hidden = true;
  if (!count) {
    if (focusHasMoreTasks) {
      loading.hidden = false;
      loading.querySelector('p').textContent = 'Loading your next tasks...';
      loadFocusTasksPage().then(renderFocusTask).catch((loadError) => {
        console.error('Could not load more focus tasks.', loadError);
        loading.hidden = true;
        focusError(loadError.message || 'Your tasks could not be loaded. Try again.');
        screen.querySelector('[data-focus-retry]').hidden = false;
      });
      return;
    }
    card.hidden = true;
    finish.hidden = false;
    finish.classList.remove('is-celebrating');
    requestAnimationFrame(() => finish.classList.add('is-celebrating'));
    screen.querySelector('[data-focus-progress]').textContent = 'Session complete';
    window.clearTimeout(screen.focusReturnTimer);
    screen.focusReturnTimer = window.setTimeout(closeFocusMode, 4800);
    return;
  }
  finish.hidden = true;
  card.hidden = false;
  card.classList.remove('focus-card-completing', 'focus-card-entering');
  card.querySelector('[data-focus-complete]').classList.remove('focus-completion-burst');
  const task = focusTasks[0];
  const source = screen.querySelector('[data-focus-source]');
  source.textContent = todoTaskSource(task);
  source.hidden = !source.textContent;
  screen.querySelector('[data-focus-title]').textContent = task.title;
  const details = screen.querySelector('[data-focus-details]');
  details.textContent = task.details || '';
  details.hidden = !task.details;
  screen.querySelector('[data-focus-count]').textContent = `${focusCompleted + 1} / ${focusTaskTotal}`;
  screen.querySelector('[data-focus-progress]').textContent = `${count} task${count === 1 ? '' : 's'} left in this session`;
  screen.querySelector('[data-focus-complete]').disabled = false;
  requestAnimationFrame(() => card.classList.add('focus-card-entering'));
}
function closeFocusMode() {
  const screen = focusScreen();
  if (!screen || screen.hidden) return;
  window.clearTimeout(screen.focusReturnTimer);
  const returnTarget = focusReturnTarget;
  screen.hidden = true;
  screen.setAttribute('hidden', '');
  screen.classList.remove('focus-session-complete');
  document.body.classList.remove('focus-mode-open');
  focusReturnTarget = null;
  closeFocusBackgroundPicker(false);
  if (document.fullscreenElement === screen && document.exitFullscreen) {
    document.exitFullscreen().catch((error) => console.error('Could not exit browser fullscreen.', error));
  }
  returnTarget?.focus();
}
function syncFocusFullscreenButton() {
  const screen = focusScreen();
  const button = screen?.querySelector('[data-focus-fullscreen]');
  if (!screen || !button) return;
  const active = document.fullscreenElement === screen;
  button.setAttribute('aria-label', active ? 'Exit browser fullscreen' : 'Enter browser fullscreen');
  button.title = active ? 'Exit browser fullscreen' : 'Enter browser fullscreen';
  button.classList.toggle('is-fullscreen', active);
}
async function toggleFocusFullscreen() {
  const screen = focusScreen();
  if (!screen) return;
  try {
    if (document.fullscreenElement === screen) await document.exitFullscreen();
    else if (screen.requestFullscreen) await screen.requestFullscreen();
    else throw new Error('Browser fullscreen is not available here.');
  } catch (error) {
    console.error('Could not change fullscreen mode.', error);
    focusError(error.message || 'Browser fullscreen could not be changed.');
  }
}
async function startFocusMode(button) {
  const screen = focusScreen();
  if (!screen || button.disabled) return;
  button.disabled = true;
  focusReturnTarget = button;
  focusTasks = [];
  focusCompleted = 0;
  focusTaskOffset = 0;
  focusHasMoreTasks = true;
  focusTaskTotal = 0;
  screen.hidden = false;
  const picker = screen.querySelector('[data-focus-picker]');
  picker.hidden = true;
  picker.classList.remove('is-open');
  screen.querySelector('[data-focus-sidebar-toggle]').hidden = false;
  picker.querySelector('[data-focus-picker-panel]').inert = true;
  picker.querySelector('[data-focus-picker-panel]').setAttribute('aria-hidden', 'true');
  screen.querySelector('[data-focus-sidebar-toggle]').setAttribute('aria-expanded', 'false');
  screen.querySelector('[data-focus-card]').hidden = true;
  screen.querySelector('[data-focus-finish]').hidden = true;
  screen.querySelector('[data-focus-loading]').hidden = false;
  screen.querySelector('[data-focus-error]').hidden = true;
  screen.querySelector('[data-focus-retry]').hidden = true;
  screen.querySelector('[data-focus-progress]').textContent = 'Preparing your focus session';
  document.body.classList.add('focus-mode-open');
  screen.querySelector('[data-focus-exit]').focus();
  void loadCustomFocusBackgrounds();
  try {
    await loadFocusTasksPage();
    renderFocusTask();
  } catch (error) {
    console.error('Could not start focus mode.', error);
    screen.querySelector('[data-focus-loading]').hidden = true;
    focusError(error.message || 'Your tasks could not be loaded. Try again.');
    screen.querySelector('[data-focus-retry]').hidden = false;
  } finally {
    button.disabled = false;
  }
}
async function completeFocusTask() {
  const screen = focusScreen();
  const task = focusTasks[0];
  const button = screen?.querySelector('[data-focus-complete]');
  if (!task || !button || button.disabled) return;
  button.disabled = true;
  screen.querySelector('[data-focus-error]').hidden = true;
  try {
    const response = await fetch(`/tasks/${encodeURIComponent(task.id)}/toggle`, {
      method: 'POST',
      body: new URLSearchParams(),
      headers: { Accept: 'application/json', 'X-Live-Request': 'true' }
    });
    const payload = await response.json();
    if (!response.ok || payload.error || !payload.task?.done) throw new Error(payload.error || 'This task could not be marked complete.');
    screen.querySelector('[data-focus-card]').classList.add('focus-card-completing');
    button.classList.add('focus-completion-burst');
    await waitForTodoAnimation(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1750);
    focusTasks.shift();
    focusCompleted += 1;
    renderFocusTask();
  } catch (error) {
    console.error('Could not complete the focused task.', error);
    button.disabled = false;
    focusError(error.message || 'This task could not be marked complete. Try again.');
  }
}
function bindFocusMode() {
  const screen = focusScreen();
  if (!screen) return;
  document.body.append(screen);
  document.querySelector('[data-focus-mode]')?.addEventListener('click', (event) => void startFocusMode(event.currentTarget));
  document.querySelector('[data-focus-exit]')?.addEventListener('click', (event) => {
    event.preventDefault();
    closeFocusMode();
  });
  document.querySelector('[data-focus-return]')?.addEventListener('click', closeFocusMode);
  screen.querySelector('[data-focus-fullscreen]')?.addEventListener('click', () => void toggleFocusFullscreen());
  document.querySelector('[data-focus-complete]')?.addEventListener('click', () => void completeFocusTask());
  screen.querySelector('[data-focus-sidebar-toggle]')?.addEventListener('click', () => {
    screen.querySelector('[data-focus-picker]')?.classList.contains('is-open')
      ? closeFocusBackgroundPicker()
      : openFocusBackgroundPicker();
  });
  screen.querySelector('[data-focus-picker-close]')?.addEventListener('click', closeFocusBackgroundPicker);
  screen.querySelector('[data-focus-picker-backdrop]')?.addEventListener('click', closeFocusBackgroundPicker);
  screen.querySelector('[data-focus-background-retry]')?.addEventListener('click', () => {
    const picker = screen.querySelector('[data-focus-picker]');
    picker.dataset.customLoaded = 'false';
    void loadCustomFocusBackgrounds();
  });
  screen.querySelector('[data-focus-retry]')?.addEventListener('click', () => {
    const loading = screen.querySelector('[data-focus-loading]');
    const error = screen.querySelector('[data-focus-error]');
    screen.querySelector('[data-focus-retry]').hidden = true;
    error.hidden = true;
    loading.hidden = false;
    loading.querySelector('p').textContent = 'Loading your next tasks...';
    loadFocusTasksPage().then(renderFocusTask).catch((loadError) => {
      console.error('Could not retry loading focus tasks.', loadError);
      loading.hidden = true;
      focusError(loadError.message || 'Your tasks could not be loaded. Try again.');
      screen.querySelector('[data-focus-retry]').hidden = false;
    });
  });
  document.addEventListener('fullscreenchange', syncFocusFullscreenButton);
  document.addEventListener('fullscreenerror', () => focusError('Browser fullscreen could not be changed.'));
  screen.addEventListener('click', (event) => {
    const picker = screen.querySelector('[data-focus-picker]');
    const panel = picker?.querySelector('[data-focus-picker-panel]');
    if (picker && !picker.hidden && !panel.contains(event.target) && !event.target.closest('[data-focus-sidebar-toggle]')) closeFocusBackgroundPicker();
  });
  document.addEventListener('keydown', (event) => {
    if (screen.hidden) return;
    if (event.key === 'Escape') {
      if (!screen.querySelector('[data-focus-picker]')?.hidden) {
        event.preventDefault();
        closeFocusBackgroundPicker();
      } else {
        event.preventDefault();
        closeFocusMode();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...screen.querySelectorAll('button:not([disabled]), a[href]:not([hidden]), summary')].filter((element) => !element.closest('[hidden]'));
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  });
}
function enhanceTodoTasks(scope = todoList()) {
  const list = todoList(); if (!list) return;
  if (!scope) return;
  const tasks = scope.matches?.('.private-task') ? [scope] : [...scope.querySelectorAll('.private-task')];
  tasks.forEach((task, index) => {
    task.draggable = false; task.dataset.position ||= index; task.dataset.due ||= task.querySelector('[data-raw-due]')?.dataset.rawDue || 'No date'; task.dataset.importance ||= todoImportance(task.dataset.due); task.dataset.priority ||= task.querySelector('.priority-flag')?.textContent.trim().toLowerCase() || 'normal';
    const priority = task.querySelector('.priority-flag');
    if (priority && !priority.closest('.priority-menu')) { const value = priority.textContent.trim(); const menu = document.createElement('div'); menu.className = 'priority-menu'; menu.innerHTML = `<button class="lui-menu-trigger priority-flag" type="button" aria-haspopup="menu" aria-expanded="false"><i data-lucide="flag"></i> <span>${escapeHtml(value)}</span><i data-lucide="chevron-down"></i></button><div class="priority-options" role="menu"><button class="lui-menu-action" type="button" data-priority="Low">Low</button><button class="lui-menu-action" type="button" data-priority="Normal">Normal</button><button class="lui-menu-action" type="button" data-priority="Medium">Medium</button><button class="lui-menu-action" type="button" data-priority="High">High</button></div>`; priority.replaceWith(menu); }
  });
  bindTodoPriorityMenus(scope);
  tasks.forEach((task) => {
    const grip = task.querySelector('.drag-handle, button[aria-label="Move task"]');
    grip?.classList.add('drag-handle');
    if (grip && grip.dataset.dragBound !== 'true') grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault(); liveState.draggedTask = task; task.classList.add('is-dragging'); grip.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dragged = liveState.draggedTask; if (!dragged) return;
        const target = [...list.querySelectorAll('.private-task')].filter((candidate) => candidate !== dragged).find((candidate) => moveEvent.clientY < candidate.getBoundingClientRect().top + candidate.offsetHeight / 2);
        if (target) list.insertBefore(dragged, target);
        else {
          const sentinel = list.querySelector('[data-todo-load-more]');
          if (sentinel) list.insertBefore(dragged, sentinel);
          else list.appendChild(dragged);
        }
      };
      const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); task.classList.remove('is-dragging'); liveState.draggedTask = null; persistTodoOrder(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish, { once: true }); document.addEventListener('pointercancel', finish, { once: true });
    });
    if (grip) grip.dataset.dragBound = 'true';
  });
  lucide.createIcons({ root: scope });
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
  if (document.querySelector('[data-dashboard-todo-list]')) return;
  const list = todoList(); if (!list || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io(); liveState.socket.on('connect', () => liveState.socket.emit('todo:join'));
  liveState.socket.on('todo:task-added', ({ task, todoPendingCount, todoTaskCount }) => { updateTodoPendingCount(list, todoPendingCount); updateTodoTaskCount(list, todoTaskCount); if (!task || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) { syncTodoSummary(); return; } list.querySelector('.empty-panel')?.remove(); const previous = captureTaskListPositions(list); const sentinel = list.querySelector('[data-todo-load-more]'); list.insertAdjacentHTML('beforeend', todoTaskMarkup(task)); const row = list.querySelector(`:scope > [data-task-id="${CSS.escape(task.id)}"]`); if (!row) return; if (sentinel) sentinel.before(row); row.hidden = list.dataset.activeFilter === 'completed'; animateTaskListPositions(list, previous, { enterElement: row, rippleFrom: row }); bindLiveForms(row); bindLinkComposers(row); enhanceTodoTasks(row); lucide.createIcons(); syncTodoSummary(); });
  liveState.socket.on('todo:task-updated', ({ task, todoPendingCount, todoTaskCount }) => { updateTodoPendingCount(list, todoPendingCount); updateTodoTaskCount(list, todoTaskCount); const row = task && list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (!row) { syncTodoSummary(); return; } row.outerHTML = todoTaskMarkup(task); const nextRow = list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); bindLiveForms(nextRow); bindLinkComposers(nextRow); enhanceTodoTasks(nextRow); lucide.createIcons(); syncTodoSummary(); });
  liveState.socket.on('todo:task-deleted', ({ taskId, todoPendingCount, todoTaskCount }) => { updateTodoPendingCount(list, todoPendingCount); updateTodoTaskCount(list, todoTaskCount); list.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); syncTodoSummary(); });
  liveState.socket.on('todo:reordered', ({ tasks }) => { if (!tasks) return; const byId = new Map(tasks.map((task) => [task.id, task])); sortTodoDom((left, right) => byId.get(left.dataset.taskId).position - byId.get(right.dataset.taskId).position); });
}
function bindTodoControls() {
  bindLinkComposers();
  enhanceTodoTasks();
  startTodoAllClearRotation();
  document.querySelectorAll('[data-todo-filter]').forEach((link) => link.addEventListener('click', (event) => { event.preventDefault(); applyTodoFilter(link.dataset.todoFilter); history.replaceState({}, '', `/todo${link.dataset.todoFilter === 'all' ? '' : `?filter=${link.dataset.todoFilter}`}`); }));
  document.querySelector('[data-auto-organize]')?.addEventListener('click', (event) => void organizeTodoTasks(event.currentTarget));
  bindFocusMode();
  bindTodoPagination();
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
    if (payload.verifiedBy) {
      const itemId = payload.itemId || actionUrl.match(/\/items\/([^/]+)\/verify$/)?.[1];
      const card = form.closest('.dashboard-feed-post')
        || document.querySelector(`[data-dashboard-feed-list] [data-item-id="${CSS.escape(String(itemId || ''))}"]`);
      updateDashboardConfirmation(card, payload.verifiedBy, document.querySelector('[data-dashboard-live]')?.dataset.userId);
      if (card?.closest('[data-dashboard-live]')) sortDashboardFeed(card.closest('[data-dashboard-live]'));
    }
    if (payload.downvotedBy) { const itemId = actionUrl.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvotedBy.length; }
    if (payload.downvoteCount !== undefined) { const itemId = actionUrl.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvoteCount; }
    if (payload.comment) {
      const editedComment = actionUrl.endsWith('/update');
      if (editedComment) {
        const entry = form.closest('[data-comment-id]');
        const itemCardElement = form.closest('[data-item-id]');
        const courseLive = form.closest('[data-course-live]');
        const breakoutLive = form.closest('[data-breakout-live]');
        const dashboard = itemCardElement?.closest('[data-dashboard-live]');
        const context = itemCardElement && courseLive ? { orgId: courseLive.dataset.orgId, itemId: itemCardElement.dataset.itemId, canEdit: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canDelete: courseLive.dataset.isAdmin === 'true' || payload.comment.userId === courseLive.dataset.userId, canViewHistory: courseLive.dataset.isAdmin === 'true' } : breakoutLive ? { orgId: breakoutLive.dataset.orgId, groupId: breakoutLive.dataset.groupId, canEdit: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canDelete: breakoutLive.dataset.groupAdmin === 'true' || payload.comment.userId === breakoutLive.dataset.userId, canViewHistory: breakoutLive.dataset.groupAdmin === 'true' } : null;
        if (entry && dashboard) { entry.outerHTML = dashboardCommentMarkup(payload.comment); updateCommentCount(itemCardElement); }
        else if (entry && context) { entry.outerHTML = commentMarkup(payload.comment, context); bindLiveForms(entry.parentElement || document); lucide.createIcons(); }
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
        updateTodoPendingCount(list, payload.todoPendingCount);
        updateTodoTaskCount(list, payload.todoTaskCount);
        if (!existing) {
          if (payload.todoTaskCount === undefined && !list.matches('[data-dashboard-todo-list]')) {
            updateTodoTaskCount(list, Number(list.dataset.taskCount) + 1);
          }
          const empty = list.querySelector('.empty-panel'); empty?.remove();
          const previous = captureTaskListPositions(list);
          list.insertAdjacentHTML('beforeend', list.matches('[data-dashboard-todo-list]') ? dashboardTodoTaskMarkup(payload.task) : todoTaskMarkup(payload.task));
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
        syncDashboardTodoCount();
        if (isTaskCreate) {
          form.reset();
          void animateTaskComposer(document.getElementById('quick-task'), false);
        }
      }
    }
    if (payload.task && isTaskToggle) {
      const row = document.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
      if (row) {
        row.classList.toggle('is-done', Boolean(payload.task.done));
        row.querySelector('.dashboard-todo-check')?.setAttribute('aria-label', `${payload.task.done ? 'Mark incomplete' : 'Mark complete'}: ${payload.task.title}`);
        if (payload.task.done) celebrateTask(row);
        applyTodoFilter(document.querySelector('[data-live-todo-list]')?.dataset.activeFilter || 'all');
      }
      syncDashboardTodoCount();
    }
    if (payload.deleted && payload.taskId) {
      const deletedRow = document.querySelector(`[data-task-id="${CSS.escape(payload.taskId)}"]`);
      const list = deletedRow?.closest('[data-live-todo-list]');
      deletedRow?.remove();
      updateTodoPendingCount(list, payload.todoPendingCount);
      if (payload.todoTaskCount !== undefined) updateTodoTaskCount(list, payload.todoTaskCount);
      else if (list && !list.matches('[data-dashboard-todo-list]')) updateTodoTaskCount(list, Math.max(0, Number(list.dataset.taskCount) - 1));
      syncDashboardTodoCount();
      syncTodoSummary();
    }
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
      updateTodoPendingCount(document.querySelector('[data-live-todo-list]'), payload.todoPendingCount);
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

const todoAllClearQuotes = [
  { title: 'Wow. Someone locked in!', message: 'Now take some time to do what you like. Go outside——GTA6 can wait' },
  { title: 'The list is empty.', message: 'Somewhere a group chat just went quiet.' },
  { title: 'All quiet on the western front.', message: 'Your notebook is closed and the stars have won.' },
  { title: 'Mission accomplished.', message: 'Go have fun before the next battle starts.' },
  { title: 'Locked in? More like locked out.', message: 'You\'re probably not going to touch this site for a while. We\'re ready.' },
  { title: 'You did the thing.', message: 'The couch has been notified and it is honored.' }
];
let todoAllClearQuoteIndex = 0;
let todoAllClearRotationTimer = null;
function todoAllClearTitle() { return document.querySelector('[data-todo-all-clear-title]'); }
function todoAllClearMessage() { return document.querySelector('[data-todo-all-clear-message]'); }
function renderTodoAllClearQuote() { const quote = todoAllClearQuotes[todoAllClearQuoteIndex % todoAllClearQuotes.length]; if (todoAllClearTitle()) todoAllClearTitle().textContent = quote.title; if (todoAllClearMessage()) todoAllClearMessage().textContent = quote.message; }
function rotateTodoAllClearQuote() { todoAllClearQuoteIndex = Math.floor(Math.random() * todoAllClearQuotes.length); renderTodoAllClearQuote(); }
function startTodoAllClearRotation() { window.clearInterval(todoAllClearRotationTimer); todoAllClearQuoteIndex = Math.floor(Math.random() * todoAllClearQuotes.length); renderTodoAllClearQuote(); todoAllClearRotationTimer = window.setInterval(rotateTodoAllClearQuote, 60000); }
function syncTodoSummary() {
  const list = document.querySelector('[data-live-todo-list]'); const summary = document.querySelector('[data-todo-summary]'); const countTarget = document.querySelector('[data-live-todo-count]');
  if (!list) return;
  const isDashboardList = list.matches('[data-dashboard-todo-list]');
  const count = isDashboardList
    ? list.querySelectorAll('.dashboard-todo-item:not(.is-done)').length
    : Number(list.dataset.pendingCount) || 0;
  const taskCount = Number(list.dataset.taskCount) || 0;
  const pendingCount = Number(list.dataset.pendingCount) || 0;
  const showAllClear = taskCount > 0 && pendingCount === 0;
  if (summary) summary.textContent = `${count} thing${count === 1 ? '' : 's'} still in motion`;
  document.querySelectorAll('[data-live-todo-count], [data-dashboard-todo-count]').forEach((target) => { target.textContent = String(count); });
  const emptyState = list.querySelector('[data-todo-all-clear]');
  if (emptyState) {
    if (showAllClear && emptyState.hidden) {
      emptyState.hidden = false;
      emptyState.classList.remove('is-arriving');
      requestAnimationFrame(() => emptyState.classList.add('is-arriving'));
    } else if (!showAllClear) {
      emptyState.hidden = true;
      emptyState.classList.remove('is-arriving');
    }
  }
  if (showAllClear) {
    list.querySelectorAll('.private-task').forEach((row) => row.remove());
  }
  const emptyPanel = list.querySelector('.empty-panel');
  if (!isDashboardList && taskCount === 0) {
    list.querySelectorAll('.private-task').forEach((row) => row.remove());
    if (emptyPanel) emptyPanel.classList.remove('hidden');
    if (!emptyPanel) {
      const panel = document.createElement('div');
      panel.className = 'empty-panel';
      panel.innerHTML = '<i data-lucide="inbox" aria-hidden="true"></i><h3>Your private queue is clear</h3><p>Add a task from any class feed.</p>';
      list.append(panel);
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }
  } else if (emptyPanel) {
    emptyPanel.classList.add('hidden');
  }
}
function updateTodoPendingCount(list, count) {
  if (list && Number.isFinite(Number(count))) list.dataset.pendingCount = String(count);
}
function updateTodoTaskCount(list, count) {
  if (list && Number.isFinite(Number(count))) list.dataset.taskCount = String(count);
}
