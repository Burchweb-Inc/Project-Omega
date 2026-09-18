const routeProgress = document.createElement('div');
routeProgress.className = 'route-progress';
document.body.appendChild(routeProgress);

const liveState = { socket: null, pending: new Map() };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

function courseRoot() { return document.querySelector('[data-course-live]'); }
function itemCard(item) {
  const typeClass = String(item.type || '').toLowerCase().replace(/[^a-z]/g, '-');
  const root = courseRoot(); const orgId = escapeHtml(root.dataset.orgId); const itemId = escapeHtml(item.id); const projectAction = item.type === 'Project' ? `<form data-live-form action="/groups" method="post"><input type="hidden" name="orgId" value="${orgId}"><input type="hidden" name="courseId" value="${escapeHtml(root.dataset.courseId)}"><input type="hidden" name="itemId" value="${itemId}"><button class="text-button breakout-action" type="submit"><i data-lucide="users-round"></i> Create Breakout Group</button></form>` : ''; const downvoteAction = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${orgId}/items/${itemId}/downvote" method="post"><button class="text-button" type="submit"><i data-lucide="thumbs-down"></i> <span data-downvote-count>${(item.downvotedBy || []).length}</span></button></form>` : '';
  return `<article class="feed-card feed-item" data-item-id="${itemId}"><div class="feed-card-head"><span class="category-dot category-${typeClass}"></span><div><span class="feed-source">${escapeHtml(item.type)} · ${escapeHtml(item.due)}</span><h3>${escapeHtml(item.title)}</h3></div><span class="confidence"><i data-lucide="shield-check"></i> <span data-verify-count>${(item.verifiedBy || []).length}</span></span></div><div class="feed-card-foot"><div class="feed-card-actions"><form data-live-form action="/org/${orgId}/items/${itemId}/verify" method="post"><button class="text-button" type="submit"><i data-lucide="badge-check"></i> Confirm details</button></form><form data-live-form action="/org/${orgId}/items/${itemId}/todo" method="post"><button class="text-button" type="submit"><i data-lucide="inbox"></i> Add to My Todo</button></form>${projectAction}${downvoteAction}</div><details class="comment-details"><summary><i data-lucide="message-circle"></i> <span data-comment-count>0</span> comments</summary><div class="comments"><div class="comment-list" data-comment-list></div><form data-live-form action="/org/${orgId}/items/${itemId}/comments" method="post"><input name="comment" placeholder="Ask a question or share a note..." required><button class="button primary" type="submit">Reply</button></form></div></details></div></article>`;
}

function appendUniqueComment(itemId, comment) {
  const card = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`); if (!card || !comment) return;
  const list = card.querySelector('[data-comment-list]'); if (!list || list.querySelector(`[data-comment-id="${CSS.escape(comment.id || '')}"]`)) return;
  const paragraph = document.createElement('p'); paragraph.dataset.commentId = comment.id || `local-${Date.now()}`; paragraph.innerHTML = `<strong>${escapeHtml(comment.author)}</strong> ${escapeHtml(comment.text)}`; list.appendChild(paragraph);
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
  liveState.socket.on('course:item-created', ({ item }) => { const list = root.querySelector('[data-feed-list]'); if (!list || !item || list.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)) return; root.querySelector('[data-empty-feed]')?.remove(); list.insertAdjacentHTML('afterbegin', itemCard(item)); bindLiveForms(list.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)); lucide.createIcons(); });
  liveState.socket.on('item:verification-changed', ({ itemId, verifiedBy }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = verifiedBy.length; });
  liveState.socket.on('item:downvote-changed', ({ itemId, downvotedBy }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = downvotedBy.length; });
  liveState.socket.on('item:updated', ({ item }) => { const card = root.querySelector(`[data-item-id="${CSS.escape(item?.id || '')}"]`); if (card && item) { card.querySelector('h3').textContent = item.title; card.querySelector('.feed-source').textContent = `${item.type} · ${item.due}`; } });
  liveState.socket.on('item:deleted', ({ itemId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.remove());
  liveState.socket.on('item:comment-added', ({ itemId, comment }) => appendUniqueComment(itemId, comment));
  liveState.socket.on('item:comment-deleted', ({ itemId, commentId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove());
  liveState.socket.on('board:card-created', ({ card }) => { if (!card) return; const list = root.querySelector('[data-board-list]'); if (!list || list.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)) return; root.querySelector('[data-empty-board]')?.remove(); list.insertAdjacentHTML('beforeend', `<div class="claim-row" data-card-id="${escapeHtml(card.id)}"><span><strong>${escapeHtml(card.title)}</strong><small>${escapeHtml(card.status)}</small></span><i data-lucide="arrow-right"></i></div>`); lucide.createIcons(); });
  liveState.socket.on('resource:created', ({ resource }) => { if (!resource) return; const list = root.querySelector('[data-resource-list]'); if (!list || list.querySelector(`[data-resource-id="${CSS.escape(resource.id)}"]`)) return; list.insertAdjacentHTML('beforeend', `<a class="resource-link" data-resource-id="${escapeHtml(resource.id)}" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${escapeHtml(resource.title)}</span></a>`); lucide.createIcons(); });
  liveState.socket.on('subgroup:created', ({ group }) => { if (!group || group.courseId !== root.dataset.courseId) return; const list = root.querySelector('[data-subgroup-list]'); if (!list || list.querySelector(`[data-group-id="${CSS.escape(group.id)}"]`)) return; list.insertAdjacentHTML('beforeend', `<a class="claim-row" href="/org/${escapeHtml(root.dataset.orgId)}/breakout/${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}"><span><strong>${escapeHtml(group.name)}</strong><small>${group.members.length}/${group.limit} members</small></span><i data-lucide="users-round"></i></a>`); lucide.createIcons(); });
}

function connectLiveBreakout() {
  const root = document.querySelector('[data-breakout-live]'); if (!root || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io();
  liveState.socket.on('connect', () => liveState.socket.emit('group:join', { orgId: root.dataset.orgId }));
  liveState.socket.on('breakout:task-created', ({ groupId, task }) => { if (groupId !== root.dataset.groupId || !task) return; const list = root.querySelector('[data-breakout-task-list]'); if (!list || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) return; root.querySelector('[data-empty-breakout-board]')?.remove(); list.insertAdjacentHTML('beforeend', breakoutTaskMarkup(task, root)); bindLiveForms(list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); lucide.createIcons(); });
  liveState.socket.on('breakout:task-updated', ({ groupId, task }) => { if (groupId !== root.dataset.groupId || !task) return; const row = root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (row) { row.outerHTML = breakoutTaskMarkup(task, root); bindLiveForms(root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); lucide.createIcons(); } });
  liveState.socket.on('breakout:task-deleted', ({ groupId, taskId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); });
  liveState.socket.on('breakout:board-deleted', ({ groupId }) => { if (groupId === root.dataset.groupId) root.querySelector('[data-breakout-task-list]').innerHTML = '<div class="empty-panel" data-empty-breakout-board><h3>The board is clear</h3></div>'; });
  liveState.socket.on('breakout:comment-created', ({ groupId, comment }) => { if (groupId !== root.dataset.groupId || !comment) return; const list = root.querySelector('[data-breakout-comment-list]'); if (list && !list.querySelector(`[data-comment-id="${CSS.escape(comment.id)}"]`)) list.insertAdjacentHTML('beforeend', `<div class="comment-entry" data-comment-id="${escapeHtml(comment.id)}"><strong>${escapeHtml(comment.author)}</strong> ${escapeHtml(comment.text)}</div>`); });
  liveState.socket.on('breakout:comment-deleted', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)?.remove(); });
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
    if (payload.verifiedBy) { const itemId = form.action.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = payload.verifiedBy.length; }
    if (payload.downvotedBy) { const itemId = form.action.split('/').at(-2); const count = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count) count.textContent = payload.downvotedBy.length; }
    if (payload.comment) { const itemId = form.action.split('/').at(-2); document.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-list] [data-comment-id="${CSS.escape(optimisticComment?.id || '')}"]`)?.remove(); appendUniqueComment(itemId, payload.comment); }
    if (payload.task) {
      const list = document.querySelector('[data-live-todo-list]'); if (list) {
        const existing = list.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
        if (!existing) {
          const empty = list.querySelector('.empty-panel'); empty?.remove();
          const article = document.createElement('article'); article.className = `private-task ${payload.task.done ? 'is-done' : ''}`; article.dataset.taskId = payload.task.id; article.innerHTML = `<form class="toggle-task-form" action="/tasks/${payload.task.id}/toggle" method="post" data-live-form><button class="task-check" aria-label="Toggle ${escapeHtml(payload.task.title)}"><i data-lucide="check"></i></button></form><div class="private-task-copy"><h3>${escapeHtml(payload.task.title)}</h3><span><i data-lucide="link-2"></i> ${escapeHtml(payload.task.source)}</span><small>Due ${escapeHtml(payload.task.due)}</small></div><span class="priority-flag"><i data-lucide="flag"></i> ${escapeHtml(payload.task.priority || 'Normal')}</span><button class="icon-button" aria-label="Move task" type="button"><i data-lucide="grip-vertical"></i></button>`; list.prepend(article); article.querySelector('.toggle-task-form')?.addEventListener('submit', (event) => { event.preventDefault(); submitLiveForm(event.currentTarget); });
          form.reset(); document.getElementById('quick-task')?.classList.remove('open');
        }
      }
    }
    if (payload.task && isTaskToggle) {
      const row = document.querySelector(`[data-task-id="${CSS.escape(payload.task.id)}"]`);
      if (row) row.classList.toggle('is-done', Boolean(payload.task.done));
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
  const list = document.querySelector('[data-live-todo-list]'); const summary = document.querySelector('[data-todo-summary]'); if (!list || !summary) return;
  const count = list.querySelectorAll('.private-task:not(.is-done)').length;
  summary.textContent = `${count} thing${count === 1 ? '' : 's'} still in motion`;
}

function bindLiveForms(scope = document) {
  scope.querySelectorAll('[data-live-form]').forEach((form) => form.addEventListener('submit', (event) => { event.preventDefault(); submitLiveForm(form); }));
}

function bindInteractions() {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.auth-form').forEach((form) => form.classList.add('hidden')); tab.classList.add('active'); document.getElementById(tab.dataset.tab).classList.remove('hidden'); }));
  bindLiveForms();
  document.querySelectorAll('[data-inline-create]').forEach((button) => button.addEventListener('click', () => { const form = document.querySelector('.inline-create-form'); form?.classList.remove('hidden'); form?.querySelector('input[name="title"]')?.focus(); form?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-course-tab]').forEach((tab) => tab.addEventListener('click', (event) => { event.preventDefault(); setCourseTab(tab.dataset.courseTab); }));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => { const target = document.getElementById(button.dataset.open); target?.classList.add('open'); target?.querySelector('input[name="title"]')?.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { button.closest('.modal-backdrop')?.classList.remove('open'); }));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.classList.remove('open'); }));
  document.querySelectorAll('.toggle-task-form').forEach((form) => { form.addEventListener('submit', (event) => { event.preventDefault(); submitLiveForm(form); }); });
  document.querySelectorAll('[data-live-todo-list] .private-task').forEach((task) => { task.querySelector('.task-check')?.addEventListener('click', () => { task.classList.toggle('is-done'); syncTodoSummary(); }); });
  document.querySelectorAll('[data-live-todo-list] .private-task').forEach((task) => { task.closest('form')?.addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget; submitLiveForm(form); }); });
  const hash = window.location.hash.slice(1); if (courseRoot() && ['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false);
  syncTodoSummary();
  lucide.createIcons(); connectLiveCourse(); connectLiveBreakout();
}

function isInternalGetLink(link) { return link.origin === window.location.origin && link.pathname && !link.pathname.startsWith('/share/') && !link.hasAttribute('download') && link.target !== '_blank' && !link.dataset.noRouter; }
async function navigate(url, pushState = true) { routeProgress.classList.add('active'); document.body.classList.add('is-navigating'); try { const response = await fetch(url, { headers: { 'X-Studyline-Navigation': 'true' } }); if (!response.ok) throw new Error(`Navigation failed: ${response.status}`); const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html'); nextDocument.body.querySelectorAll('script').forEach((script) => script.remove()); liveState.socket?.disconnect(); document.body.innerHTML = nextDocument.body.innerHTML; document.body.appendChild(routeProgress); document.title = nextDocument.title; if (pushState) window.history.pushState({}, '', url); window.scrollTo({ top: 0, behavior: 'instant' }); bindInteractions(); requestAnimationFrame(() => document.body.classList.remove('is-navigating')); } catch (error) { window.location.assign(url); } finally { routeProgress.classList.remove('active'); } }
document.addEventListener('click', (event) => { const link = event.target.closest('a'); if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !isInternalGetLink(link)) return; const target = new URL(link.href); if (target.hash && target.pathname === window.location.pathname) return; event.preventDefault(); navigate(target.href); });
window.addEventListener('popstate', () => navigate(window.location.href, false));
window.addEventListener('hashchange', () => { const hash = window.location.hash.slice(1); if (['feed', 'board', 'resources'].includes(hash)) setCourseTab(hash, false); });
bindInteractions();