function notificationMarkup(notification) {
  const action = notification.href && notification.actionLabel ? `<a class="lui-link" href="${escapeHtml(notification.href)}">${escapeHtml(notification.actionLabel)}</a>` : '';
  return `<div class="notification-item unread" data-notification-id="${escapeHtml(notification.id)}"><div><strong>${escapeHtml(notification.title)}</strong><p>${escapeHtml(notification.message)}</p>${action}<small>${escapeHtml(new Date(notification.createdAt).toLocaleString())}</small></div><div class="notification-actions"><form data-live-form action="/notifications/${escapeHtml(notification.id)}/read" method="post"><button class="lui-icon-button" type="submit" aria-label="Mark notification read"><i data-lucide="check"></i></button></form><form data-live-form action="/notifications/${escapeHtml(notification.id)}/delete" method="post"><button class="lui-icon-button notification-delete-button" type="submit" aria-label="Delete notification"><i data-lucide="trash-2"></i></button></form></div></div>`;
}
function pushCategoryEnabled(notification) {
  const settings = document.body?.dataset || {};
  if (settings.pushEnabled !== 'true') return false;
  if (notification.type === 'breakout-comment') return settings.pushBreakoutComments !== 'false';
  if (notification.type === 'breakout-task') return settings.pushBreakoutTasks !== 'false';
  if (notification.type === 'breakout-ping') return settings.pushMentions !== 'false';
  if (notification.type === 'announcement') return settings.pushAnnouncements !== 'false';
  return false;
}
async function showBrowserNotification(notification) {
  if (!pushCategoryEnabled(notification) || !('Notification' in window) || Notification.permission !== 'granted') return;
  const options = { body: notification.message, icon: '/media/logo.png', tag: notification.type };
  if (document.visibilityState === 'visible') new Notification(notification.title, options);
  else {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.active) registration.active.postMessage({ type: 'show-notification', ...options, title: notification.title, href: notification.href });
  }
}
async function testPushNotifications(button) {
  const status = document.querySelector('[data-push-status]');
  if (!('Notification' in window)) { if (status) status.textContent = 'This browser does not support notifications.'; return; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { if (status) status.textContent = 'Notifications are blocked. Allow them in your browser settings, then try again.'; return; }
    new Notification('LockIn notifications are on', { body: 'This is a test alert. You are ready for breakout updates.', icon: '/media/logo.png', tag: 'lockin-test' });
    button.textContent = 'Test sent'; if (status) status.textContent = 'Test notification sent.';
    window.setTimeout(() => { button.innerHTML = '<i data-lucide="bell-ring"></i> Test'; lucide.createIcons(); }, 2200);
  } catch (error) {
    if (status) status.textContent = `Could not send a notification: ${error.message || 'check browser permissions'}.`;
  }
}
function bindPushNotifications() {
  document.querySelector('[data-push-test]')?.addEventListener('click', (event) => testPushNotifications(event.currentTarget));
  const tip = document.querySelector('[data-push-tip]');
  const course = courseRoot();
  const dismissalKey = `lockin-push-tip-dismissed-${course?.dataset.userId || 'visitor'}`;
  if (tip && localStorage.getItem(dismissalKey) === 'true') tip.remove();
  tip?.querySelector('[data-push-tip-dismiss]')?.addEventListener('click', () => { localStorage.setItem(dismissalKey, 'true'); tip.remove(); });
  if (!document.querySelector('[data-push-tip]')) return;
  if (tip && document.body.dataset.pushEnabled !== 'true' && window.Notification?.permission !== 'granted') {
    const key = `lockin-push-tip-${course?.dataset.courseId || 'course'}`;
    if (!sessionStorage.getItem(key)) { sessionStorage.setItem(key, 'true'); window.setTimeout(() => showLiveSuccess('Tip: Push Notifications can alert you about breakout activity. Choose what you hear in Settings.'), 700); }
  }
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
  scope.querySelectorAll(popupMenuSelector).forEach(decoratePopupMenu);
  scope.querySelectorAll('[data-live-form]').forEach((form) => { if (form.dataset.liveBound === 'true') return; form.dataset.liveBound = 'true'; form.addEventListener('submit', (event) => { event.preventDefault(); const message = form.dataset.confirmMessage; if (message && !window.confirm(message)) return; submitLiveForm(form); }); }); bindLeaveGroupActions(scope);
  scope.querySelectorAll('[data-comment-edit-open]').forEach((button) => { if (button.dataset.editBound === 'true') return; button.dataset.editBound = 'true'; button.addEventListener('click', () => { const entry = button.closest('[data-comment-id]'); const menu = button.closest('.comment-menu'); const editor = entry?.querySelector('.comment-edit-form'); if (menu) closePopupMenu(menu); if (editor && entry?.querySelector('.comment-text')) { entry.querySelector('.comment-text').hidden = true; editor.hidden = false; editor.querySelector('input')?.focus(); } }); });
  scope.querySelectorAll('[data-comment-edit-cancel]').forEach((button) => { if (button.dataset.editBound === 'true') return; button.dataset.editBound = 'true'; button.addEventListener('click', () => { const entry = button.closest('[data-comment-id]'); const editor = button.closest('.comment-edit-form'); if (entry && editor) { editor.hidden = true; entry.querySelector('.comment-text').hidden = false; } }); });
  scope.querySelectorAll('[data-appeal-word]').forEach((button) => { if (button.dataset.appealBound === 'true') return; button.dataset.appealBound = 'true'; button.addEventListener('click', async () => { button.disabled = true; const response = await fetch('/appeals', { method: 'POST', body: new URLSearchParams({ phrase: button.dataset.phrase || '' }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); const payload = await response.json(); if (response.ok && !payload.error) { button.closest('[data-form-error]').textContent = payload.successMessage || 'Thanks. We will review that phrase.'; } else { button.disabled = false; } }); });
}

function showLeaveGroupModal(form) {
  document.querySelector('[data-leave-group-modal]')?.remove();
  const modal = document.createElement('div');
  modal.className = 'warning-modal-backdrop open';
  modal.dataset.leaveGroupModal = 'true';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'leave-group-modal-title');
  modal.innerHTML = `<article class="warning-modal"><i data-lucide="log-out"></i><p class="kicker">LEAVE GROUP</p><h2 id="leave-group-modal-title">Leave this group?</h2><p>You will lose access to this group and its courses. You can only return if someone invites you or you join again.</p><div class="form-actions"><button class="lui-button lui-button-secondary" type="button" data-leave-group-cancel>Cancel</button><button class="lui-button lui-button-danger" type="button" data-leave-group-confirm>Leave Group</button></div></article>`;
  const close = () => modal.remove();
  modal.querySelector('[data-leave-group-cancel]').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });
  modal.querySelector('[data-leave-group-confirm]').addEventListener('click', () => { close(); submitLiveForm(form); });
  document.body.appendChild(modal);
  lucide.createIcons();
  modal.querySelector('[data-leave-group-cancel]').focus();
}

function bindLeaveGroupActions(scope = document) {
  scope.querySelectorAll('[data-leave-group-trigger]').forEach((button) => {
    if (button.dataset.leaveBound === 'true') return;
    button.dataset.leaveBound = 'true';
    button.addEventListener('click', () => { const details = button.closest('details'); if (details?.matches(popupDetailsSelector)) closePopupMenu(details); else details?.removeAttribute('open'); showLeaveGroupModal(button.closest('[data-leave-group-form]')); });
  });
}

function showLiveError(message) {
  document.querySelector('[data-live-error]')?.remove();
  const alert = document.createElement('div');
  alert.className = 'live-error';
  alert.dataset.liveError = 'true';
  alert.setAttribute('role', 'alert');
  alert.innerHTML = `<i data-lucide="triangle-alert"></i><span>${escapeHtml(message)}</span><button class="lui-icon-button" type="button" aria-label="Dismiss message"><i data-lucide="x"></i></button>`;
  alert.querySelector('button').addEventListener('click', () => alert.remove());
  document.body.appendChild(alert);
  lucide.createIcons();
  window.setTimeout(() => alert.remove(), 7000);
}
function showLiveSuccess(message) {
  document.querySelector('[data-live-success]')?.remove();
  const alert = document.createElement('div'); alert.className = 'live-success'; alert.dataset.liveSuccess = 'true'; alert.setAttribute('role', 'status');
  alert.innerHTML = `<i data-lucide="circle-check"></i><span>${escapeHtml(message)}</span><button class="lui-icon-button" type="button" aria-label="Dismiss message"><i data-lucide="x"></i></button>`;
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
  modal.innerHTML = `<article class="debug-modal"><button class="lui-icon-button modal-close" type="button" data-debug-close aria-label="Close debug menu"><i data-lucide="x"></i></button><p class="kicker">${remote ? 'REMOTE CACHE COMMAND' : 'DEBUG TOOLS'}</p><h2>${remote ? 'Cache purge requested' : 'Browser cache'}</h2>${remote ? '<p>A site admin requested a full cache purge for this browser. The page will unregister its service workers, delete every site cache, and reload.</p><button class="lui-button lui-button-danger" type="button" data-debug-nuke><i data-lucide="bomb"></i> Start purge</button>' : '<p>Use this when updated service workers or media files are not appearing. Nuking cache removes this site\'s service workers and every Cache Storage entry, then reloads the page.</p><p class="debug-warning"><i data-lucide="triangle-alert"></i> Offline media will be removed. The next load downloads fresh files and may be slower. This does not delete your account, tasks, groups, or server data.</p><button class="lui-button lui-button-danger" type="button" data-debug-nuke><i data-lucide="bomb"></i> NUKE CACHE</button>'}</article>`;
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
  document.querySelectorAll('[data-debug-open]').forEach((button) => button.addEventListener('click', () => { const details = button.closest('details'); if (details?.matches(popupDetailsSelector)) closePopupMenu(details); else details?.removeAttribute('open'); showDebugModal(); }));
}
function showWarningModal(notification) {
  document.querySelector('[data-warning-modal]')?.remove();
  const modal = document.createElement('div'); modal.className = 'warning-modal-backdrop open'; modal.dataset.warningModal = 'true'; modal.dataset.warningId = notification.id; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.innerHTML = `<div class="warning-modal"><i data-lucide="shield-alert"></i><p class="kicker">MODERATION NOTICE</p><h2>${escapeHtml(notification.title)}</h2><p>${escapeHtml(notification.message)}</p><button class="lui-button lui-button-primary" type="button" data-warning-close>I understand</button></div>`;
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
  modal.innerHTML = `<article class="announcement-modal announcement-size-${size}"><button class="lui-icon-button modal-close" type="button" data-announcement-close aria-label="Close announcement"><i data-lucide="x"></i></button><p class="kicker">SITE ANNOUNCEMENT</p><h2>${escapeHtml(notification.title)}</h2><div class="announcement-content">${notification.html || `<p>${escapeHtml(notification.message || '')}</p>`}</div>${media}<button class="lui-button lui-button-primary" type="button" data-announcement-close>I Gotchu</button></article>`;
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
    showBrowserNotification(notification).catch(() => {});
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
    const fullName = dashboard.dataset.userName?.trim() || '';
    const firstName = fullName.split(/\s+/)[0] || fullName;
    const heroMessages = [
      'Make today easier to carry.',
      `Good to see you, ${firstName}.`,
      `${fullName}, your next step is waiting.`,
      'Your classes, people, and next steps in one calm view.',
      'Stay on top of your tasks and deadlines.',
      'Keep your learning organized and efficient.',
      `Do your homework, ${fullName}, or else I will tell your mother`,
      'Worried about grades? They\'ll be fine. Just keep working hard.',
      'Remember to take breaks and stay hydrated.',
      'Learning is a journey, not a race. Pace yourself.',
      'Your dedication to learning is inspiring. Keep it up!',
      'It\'s okay to ask for help. Try our comments feature to ask questions.',
      'Working on a group project? Use Breakout Groups to stay connected with your team.',
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
    }, 15000);
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

