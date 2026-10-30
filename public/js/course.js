function courseRoot() { return document.querySelector('[data-course-live]'); }
function courseItemPast(item) {
  if (typeof item?.past === 'boolean') return item.past;
  if (!item?.due || item.due === 'No date') return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return new Date(`${item.due}T00:00:00`) < today;
}
function courseFolderList(root, past) { return root.querySelector(`[data-course-folder="${past ? 'past' : 'current'}"] .feed-list`); }
function formatCourseDate(due, root) {
  if (!due || due === 'No date') return 'No date';
  const date = new Date(`${due}T12:00:00Z`); if (Number.isNaN(date.getTime())) return due;
  try { return new Intl.DateTimeFormat(root?.dataset.dateLocale || 'en-US', { timeZone: root?.dataset.dateTimezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); } catch (error) { return due; }
}
function taskLinksMarkup(links) {
  if (!Array.isArray(links) || !links.length) return '';
  const label = (url) => { try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`; } catch (error) { return String(url).replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[?#]/)[0].replace(/\/$/, ''); } };
  return `<div class="task-links"><span class="task-link-count"><i data-lucide="link-2"></i>${links.length}</span>${links.map((link) => `<a class="link-preview" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer"><span class="link-visible-url">${escapeHtml(label(link.url))}</span><span class="link-hover-card">${link.image ? `<img src="${escapeHtml(link.image)}" alt="">` : '<span class="link-snapshot-placeholder"></span>'}<span class="link-hover-copy"><strong>${escapeHtml(link.title || link.domain || link.url)}</strong><small>${escapeHtml(link.description || '')}</small><em>${escapeHtml(link.url)}</em></span></span></a>`).join('')}</div>`;
}
function linkedTaskTextMarkup(text, links) {
  const value = String(text || ''); const pattern = /https?:\/\/[^\s<>'"]+/gi; let output = ''; let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const rawUrl = match[0]; const url = rawUrl.replace(/[),.;!?]+$/, ''); const link = (links || []).find((entry) => entry.url === url) || { url, title: url, description: '' };
    output += escapeHtml(value.slice(cursor, match.index));
    let label = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[?#]/)[0].replace(/\/$/, ''); try { const parsed = new URL(url); label = `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`; } catch (error) {}
    output += `<a class="inline-link-preview" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"><span>${escapeHtml(label)}</span><span class="link-hover-card">${link.image ? `<img src="${escapeHtml(link.image)}" alt="">` : '<span class="link-snapshot-placeholder"></span>'}<span class="link-hover-copy"><strong>${escapeHtml(link.title || label)}</strong><small>${escapeHtml(link.description || '')}</small><em>${escapeHtml(url)}</em></span></span></a>`;
    cursor = match.index + rawUrl.length;
  }
  return output + escapeHtml(value.slice(cursor));
}
function detectDraftLinks(value) {
  return [...new Set(String(value || '').match(/https?:\/\/[^\s<>"']+/gi) || [])].map((url) => { const cleanUrl = url.replace(/[),.;!?]+$/, ''); let domain = cleanUrl; try { domain = new URL(cleanUrl).hostname; } catch (error) {} return { url: cleanUrl, title: domain, description: 'Link preview will load when saved', domain }; });
}
function bindLinkComposers(scope = document) {
  scope.querySelectorAll('[data-link-composer]').forEach((form) => {
    const title = form.querySelector('[name="title"]'); const details = form.querySelector('[name="details"]'); const preview = form.querySelector('[data-link-draft-previews]');
    if (!title || !details || !preview || form.dataset.linkComposerBound) return;
    const render = () => { const links = detectDraftLinks(`${title.value}\n${details.value}`); preview.innerHTML = taskLinksMarkup(links); preview.hidden = !links.length; lucide.createIcons(); };
    title.addEventListener('input', render); details.addEventListener('input', render); form.dataset.linkComposerBound = 'true'; render();
  });
}
function bindTimezoneSearch(scope = document) {
  scope.querySelectorAll('[data-timezone-picker]').forEach((picker) => {
    if (picker.dataset.bound === 'true') return;
    const trigger = picker.querySelector('[data-timezone-trigger]');
    const value = picker.querySelector('[data-timezone-value]');
    const selectedLabel = picker.querySelector('[data-timezone-selected]');
    const panel = picker.querySelector('[data-timezone-panel]');
    const search = picker.querySelector('[data-timezone-search]');
    const options = [...picker.querySelectorAll('[data-timezone-option]')];
    const empty = picker.querySelector('[data-timezone-empty]');
    const count = picker.querySelector('[data-timezone-count]');
    if (!trigger || !value || !selectedLabel || !panel || !search) return;
    decoratePopupMenu(picker);

    const visibleOptions = () => options.filter((option) => !option.hidden);
    const focusOption = (option) => {
      if (!option) return;
      options.forEach((entry) => { entry.tabIndex = entry === option ? 0 : -1; });
      option.focus();
    };
    const close = (restoreFocus = false) => {
      closePopupMenu(picker, restoreFocus);
    };
    const open = () => {
      document.querySelectorAll(popupMenuSelector).forEach((menu) => closePopupMenu(menu));
      document.querySelectorAll('.timezone-picker.open').forEach((menu) => { if (menu !== picker) closePopupMenu(menu); });
      openPopupMenu(picker);
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      search.focus();
    };
    const filter = () => {
      const query = search.value.trim().toLocaleLowerCase();
      let matches = 0;
      options.forEach((option) => {
        const searchable = `${option.dataset.searchValue} ${option.dataset.timezoneOption}`.toLocaleLowerCase();
        option.hidden = Boolean(query) && !searchable.includes(query);
        if (!option.hidden) matches += 1;
      });
      if (empty) empty.hidden = matches > 0;
      if (count) count.textContent = query ? `${matches} of ${options.length} time zones` : `${options.length} time zones`;
    };
    const choose = (option) => {
      value.value = option.dataset.timezoneOption;
      selectedLabel.textContent = option.dataset.searchValue;
      options.forEach((entry) => {
        const selected = entry === option;
        entry.setAttribute('aria-selected', String(selected));
        entry.tabIndex = selected ? 0 : -1;
        const check = entry.querySelector('[data-lucide="check"]');
        if (selected && !check) {
          option.insertAdjacentHTML('beforeend', '<i data-lucide="check" aria-hidden="true"></i>');
          lucide.createIcons();
        }
        if (!selected) check?.remove();
      });
      search.value = '';
      filter();
      close(true);
    };

    trigger.addEventListener('click', () => picker.classList.contains('open') && !picker.classList.contains('menu-closing') ? close() : open());
    search.addEventListener('input', filter);
    search.addEventListener('keydown', (event) => {
      const available = visibleOptions();
      if (event.key === 'ArrowDown' && available.length) {
        event.preventDefault();
        focusOption(available.find((option) => option.dataset.timezoneOption === value.value) || available[0]);
      } else if (event.key === 'ArrowUp' && available.length) {
        event.preventDefault();
        focusOption(available.at(-1));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    });
    options.forEach((option) => {
      option.addEventListener('click', () => choose(option));
      option.addEventListener('keydown', (event) => {
        const available = visibleOptions();
        const index = available.indexOf(option);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusOption(available[(index + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length]);
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          focusOption(event.key === 'Home' ? available[0] : available.at(-1));
        } else if (event.key === 'Escape') {
          event.preventDefault();
          close(true);
        } else if (event.key === 'Tab' && !event.shiftKey && index === available.length - 1) {
          close();
        } else if (event.key === 'Tab' && event.shiftKey && index === 0) {
          event.preventDefault();
          search.focus();
        }
      });
    });
    document.addEventListener('click', (event) => {
      if (!picker.contains(event.target) && !panel.hidden) close();
    });
    filter();
    picker.dataset.bound = 'true';
  });
}
function bindCourseItemEditing(scope = document) {
  if (!scope) return;
  scope.querySelectorAll('[data-item-title]').forEach((title) => {
    if (title.dataset.editBound === 'true') return;
    title.dataset.editBound = 'true';
    title.addEventListener('dblclick', () => {
      const card = title.closest('[data-item-id]'); const details = card?.querySelector('.item-edit-details'); const input = details?.querySelector('[name="title"]');
      if (!details || !input) return;
      details.open = true;
      details.querySelector('.item-title-field')?.classList.add('is-inline-title');
      const originalTitle = title; const editor = document.createElement('span'); editor.className = 'item-title-inline-editor';
      const inlineInput = document.createElement('input'); inlineInput.type = 'text'; inlineInput.className = 'item-title-inline-input'; inlineInput.value = input.value; inlineInput.setAttribute('aria-label', 'Edit title');
      inlineInput.addEventListener('input', () => { input.value = inlineInput.value; });
      const save = () => { input.value = inlineInput.value; details.querySelector('form[data-live-form]')?.requestSubmit(); };
      const cancel = () => { details.querySelector('.item-title-field')?.classList.remove('is-inline-title'); editor.replaceWith(originalTitle); details.open = false; };
      const saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'item-title-inline-action save'; saveButton.setAttribute('aria-label', 'Save title'); saveButton.title = 'Save title'; saveButton.innerHTML = '<i data-lucide="check"></i>'; saveButton.addEventListener('click', save);
      const cancelButton = document.createElement('button'); cancelButton.type = 'button'; cancelButton.className = 'item-title-inline-action cancel'; cancelButton.setAttribute('aria-label', 'Cancel title edit'); cancelButton.title = 'Cancel title edit'; cancelButton.innerHTML = '<i data-lucide="x"></i>'; cancelButton.addEventListener('click', cancel);
      inlineInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } if (event.key === 'Escape') { event.preventDefault(); cancel(); } });
      editor.append(inlineInput, saveButton, cancelButton); title.replaceWith(editor); lucide.createIcons(); inlineInput.focus(); inlineInput.select();
    });
  });
}
function courseItemEditMarkup(item, root, orgId, itemId) {
  const canEdit = root.dataset.canEdit === 'true' && (root.dataset.isAdmin === 'true' || item.createdBy === root.dataset.userId);
  if (!canEdit) return '';
  const selected = (type) => item.type === type ? 'selected' : '';
  return `<details class="item-edit-details"><summary class="lui-link"><i data-lucide="pencil"></i> Edit</summary><form class="inline-tool-form item-edit-form" data-live-form action="/org/${orgId}/items/${itemId}/update" method="post"><label class="item-title-field">Title<input name="title" value="${escapeHtml(item.title)}" required></label><label>Details<textarea name="details" rows="5" placeholder="Details">${escapeHtml(item.details || '')}</textarea></label><div class="link-draft-previews" data-link-draft-previews hidden></div><label>Type<select name="type"><option ${selected('Homework')}>Homework</option><option ${selected('Upcoming test')}>Upcoming test</option><option ${selected('Event')}>Event</option><option ${selected('Project')}>Project</option></select></label><label>Date<input name="due" type="date" value="${item.due !== 'No date' ? escapeHtml(item.due) : ''}"></label><button class="lui-button lui-button-secondary" type="submit">Save</button></form><form data-live-form action="/org/${orgId}/items/${itemId}/delete" method="post"><button class="lui-link" type="submit"><i data-lucide="trash-2"></i> Delete</button></form></details>`;
}
function courseItemCopyActionMarkup(item, root, orgId, itemId) {
  const copyableIds = JSON.parse(root.dataset.copyableItemIds || '[]');
  const canCopy = item.type !== 'Event' && root.dataset.copyAvailable === 'true' && (
    root.dataset.isAdmin === 'true' || item.createdBy === root.dataset.userId || copyableIds.includes(item.id)
  );
  if (!canCopy) return '';
  return `<details class="task-menu copy-task-menu"><summary class="lui-icon-button" aria-label="More actions for ${escapeHtml(item.title)}"><i data-lucide="ellipsis"></i></summary><div class="task-menu-popover"><button class="lui-menu-action" type="button" data-copy-task-open data-copy-url="/org/${orgId}/items/${itemId}/copy" data-copy-title="${escapeHtml(item.title)}"><i data-lucide="copy"></i> Copy task</button></div></details>`;
}
function itemCard(item) {
  const typeClass = String(item.type || '').toLowerCase().replace(/[^a-z]/g, '-');
  const root = courseRoot(); const orgId = escapeHtml(root.dataset.orgId); const itemId = escapeHtml(item.id); const taskSlug = `${String(item.title || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || itemId}-${itemId.slice(-8)}`; const projectAction = item.type === 'Project' ? `<a class="lui-link breakout-action" href="/org/${orgId}/course/${escapeHtml(root.dataset.courseId)}/task/${escapeHtml(taskSlug)}/breakout-groups"><i data-lucide="users-round"></i> Breakout Groups</a>` : ''; const canModerate = root.dataset.isAdmin === 'true'; const downvoteAction = `<form data-live-form action="/org/${orgId}/items/${itemId}/downvote" method="post"><button class="lui-link" type="submit"><i data-lucide="thumbs-down"></i>${canModerate ? ` <span data-downvote-count>${(item.downvotedBy || []).length}</span>` : ''}</button></form>`;
  const dragHandle = `<button class="lui-icon-button course-drag-handle" type="button" aria-label="Move ${escapeHtml(item.title)}"><i data-lucide="grip-vertical"></i></button>`;
  return `<article class="feed-card feed-item" id="item-${itemId}" data-item-id="${itemId}" data-position="${Number(item.position) || 0}" data-past="${courseItemPast(item)}" data-type="${escapeHtml(item.type)}"><div class="feed-card-head"><span class="category-dot category-${typeClass}"></span><div><span class="feed-source">${escapeHtml(item.type)} · ${escapeHtml(formatCourseDate(item.due, root))}</span><h3 data-item-title>${linkedTaskTextMarkup(item.title, item.links)}</h3>${item.details ? `<p class="task-details">${linkedTaskTextMarkup(item.details, item.links)}</p>` : ''}</div><span class="confidence"><i data-lucide="shield-check"></i> <span data-verify-count>${(item.verifiedBy || []).length}</span></span>${dragHandle}</div><div class="feed-card-foot"><div class="feed-card-actions"><form data-live-form action="/org/${orgId}/items/${itemId}/verify" method="post"><button class="lui-link" type="submit"><i data-lucide="badge-check"></i> Confirm details</button></form><form data-live-form action="/org/${orgId}/items/${itemId}/todo" method="post"><button class="lui-link" type="submit"><i data-lucide="inbox"></i> Add to My Todo</button></form>${projectAction}${downvoteAction}${courseItemEditMarkup(item, root, orgId, itemId)}${courseItemCopyActionMarkup(item, root, orgId, itemId)}</div><details class="comment-details"><summary><i data-lucide="message-circle"></i> <span data-comment-count>${(item.comments || []).filter((comment) => !comment.reported).length}</span> comments</summary><div class="comments"><div class="comment-list" data-comment-list></div><form data-live-form action="/org/${orgId}/items/${itemId}/comments" method="post"><input name="comment" placeholder="Ask a question or share a note..." required><small class="form-error" data-form-error hidden></small><button class="lui-button lui-button-primary" type="submit">Reply</button></form></div></details></div></article>`;
}

function commentMenuMarkup(comment, context) {
  const { orgId, itemId, groupId, canEdit, canDelete, canViewHistory } = context;
  const base = groupId ? `/org/${escapeHtml(orgId)}/breakout/${escapeHtml(groupId)}/comments/${escapeHtml(comment.id)}` : `/org/${escapeHtml(orgId)}/items/${escapeHtml(itemId)}/comments/${escapeHtml(comment.id)}`;
  const report = `<form data-live-form action="/org/${escapeHtml(orgId)}/content-reports" method="post"><input type="hidden" name="contentId" value="${escapeHtml(comment.id)}"><button class="lui-menu-action" type="submit"><i data-lucide="flag"></i> Report comment</button></form>`;
  const edit = canEdit ? `<button class="lui-menu-action" type="button" data-comment-edit-open><i data-lucide="pencil"></i> Edit comment</button>` : '';
  const remove = canDelete ? `<form data-live-form action="${base}/delete" method="post"><button class="lui-menu-action lui-menu-action-danger" type="submit">Delete comment</button></form>` : '';
  const history = canViewHistory && comment.history?.length ? `<details class="comment-history"><summary><i data-lucide="history"></i> Show edited comment</summary><div>${comment.history.slice().reverse().map((version) => `<p>${escapeHtml(version.text)}<small>${escapeHtml(version.editedAt)} · ${escapeHtml(version.editorName)}</small></p>`).join('')}</div></details>` : '';
  return `<details class="comment-menu"><summary class="lui-icon-button" aria-label="More comment actions"><i data-lucide="ellipsis"></i></summary><div class="comment-menu-popover">${edit}${report}${remove}${history}</div></details>`;
}

function commentMarkup(comment, context) {
  const edited = comment.editedAt ? '<small class="comment-edited">edited</small>' : '';
  const { orgId, itemId, groupId, canEdit } = context;
  const base = groupId ? `/org/${escapeHtml(orgId)}/breakout/${escapeHtml(groupId)}/comments/${escapeHtml(comment.id)}` : `/org/${escapeHtml(orgId)}/items/${escapeHtml(itemId)}/comments/${escapeHtml(comment.id)}`;
  const editor = canEdit ? `<form class="comment-edit-form" data-live-form action="${base}/update" method="post" hidden><input type="text" name="comment" value="${escapeHtml(comment.text)}" required><small class="form-error" data-form-error hidden></small><div class="comment-edit-actions"><button class="lui-button lui-button-secondary" type="submit">Save</button><button class="lui-link" type="button" data-comment-edit-cancel>Cancel</button></div></form>` : '';
  return `<div class="comment-entry" data-comment-id="${escapeHtml(comment.id)}"><div class="comment-body"><div class="comment-text"><strong>${escapeHtml(comment.author)}</strong> <span>${escapeHtml(comment.text)}</span>${edited}</div>${editor}</div>${commentMenuMarkup(comment, context)}</div>`;
}

function appendUniqueComment(itemId, comment) {
  const card = document.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`); if (!card || !comment) return;
  const list = card.querySelector('[data-comment-list]'); if (!list || list.querySelector(`[data-comment-id="${CSS.escape(comment.id || '')}"]`)) return;
  const root = courseRoot(); const canAdmin = root.dataset.isAdmin === 'true'; const canEdit = canAdmin || comment.userId === root.dataset.userId;
  list.insertAdjacentHTML('beforeend', commentMarkup(comment, { orgId: root.dataset.orgId, itemId, canEdit, canDelete: canAdmin || comment.userId === root.dataset.userId, canViewHistory: canAdmin }));
  bindLiveForms(list.lastElementChild); lucide.createIcons();
  updateCommentCount(card);
}

function updateCommentCount(card) {
  const list = card?.querySelector('[data-comment-list]'); const count = card?.querySelector('[data-comment-count]');
  if (list && count) count.textContent = list.querySelectorAll('.comment-entry:not([data-removing="true"]):not(.is-removed)').length;
}
function finishCommentRemoval(entry) { if (!entry) return; const card = entry.closest('[data-item-id]'); entry.remove(); updateCommentCount(card); }
function markCommentReported(entry) {
  if (!entry) return;
  const author = entry.querySelector('.comment-body strong')?.textContent || 'Comment author';
  const body = entry.querySelector('.comment-body');
  if (body) body.innerHTML = `<div class="comment-text comment-removed"><strong>${escapeHtml(author)}</strong> <em>Content removed</em></div>`;
  entry.querySelector('.comment-menu')?.remove();
  entry.classList.add('is-removed');
  updateCommentCount(entry.closest('[data-item-id]'));
}

function breakoutTaskMarkup(task, root) {
  const orgId = escapeHtml(root.dataset.orgId); const groupId = escapeHtml(root.dataset.groupId); const userId = root.dataset.userId; const groupAdmin = root.dataset.groupAdmin === 'true'; const members = JSON.parse(root.dataset.members || '[]'); const claimedName = members.find((member) => member.id === task.claimedBy)?.name || 'a member';
  const claimAction = !task.claimedBy ? `<form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/claim" method="post"><button class="lui-button lui-button-secondary task-action" type="submit">Claim task</button></form>` : '';
  const unclaimAction = task.claimedBy && (groupAdmin || task.claimedBy === userId) ? `<form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/unclaim" method="post"><button class="lui-menu-action" type="submit">Unclaim task</button></form>` : '';
  const adminActions = groupAdmin ? `<details class="inline-edit"><summary><i data-lucide="pencil"></i> Edit task</summary><form class="inline-tool-form" data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/update" method="post"><input name="title" value="${escapeHtml(task.title)}" required><button class="lui-button lui-button-secondary" type="submit">Save</button></form></details><details class="inline-edit"><summary><i data-lucide="user-plus"></i> Delegate task</summary><form class="inline-tool-form" data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/delegate" method="post"><select name="userId">${members.map((member) => `<option value="${escapeHtml(member.id)}" ${task.claimedBy === member.id ? 'selected' : ''}>${escapeHtml(member.name)}</option>`).join('')}</select><button class="lui-button lui-button-secondary" type="submit">Delegate</button></form></details><form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/delete" method="post"><button class="lui-menu-action lui-menu-action-danger" type="submit"><i data-lucide="trash-2"></i> Delete task</button></form>` : '';
  const menu = groupAdmin || task.claimedBy === userId ? `<details class="task-menu"><summary class="lui-icon-button" aria-label="More actions for ${escapeHtml(task.title)}"><i data-lucide="ellipsis"></i></summary><div class="task-menu-popover">${unclaimAction}${adminActions}</div></details>` : '';
  const toggleAction = `<form data-live-form action="/org/${orgId}/breakout/${groupId}/tasks/${escapeHtml(task.id)}/toggle" method="post"><button class="lui-check task-check" type="submit" aria-label="${task.done ? 'Mark incomplete' : 'Mark complete'}"><i data-lucide="${task.done ? 'check-circle-2' : 'circle'}"></i></button></form>`;
  return `<article class="claim-row breakout-task ${task.done ? 'is-done' : ''}" data-task-id="${escapeHtml(task.id)}">${toggleAction}<span class="breakout-task-copy"><strong>${escapeHtml(task.title)}</strong><small>${task.claimedBy ? `Claimed by ${escapeHtml(claimedName)}` : 'Open'}${task.done ? ' · Complete' : ''}</small></span><span class="task-actions">${claimAction}${menu}</span></article>`;
}

function breakoutCommentMarkup(comment, root) {
  const context = { orgId: root.dataset.orgId, groupId: root.dataset.groupId, canEdit: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canViewHistory: root.dataset.groupAdmin === 'true' };
  if (comment.parentId) return commentMarkup(comment, context);
  return `<div class="comment-thread" data-comment-id="${escapeHtml(comment.id)}">${commentMarkup(comment, context)}<details class="reply-details"><summary class="reply-trigger"><i data-lucide="corner-down-right"></i> Reply</summary><form class="reply-form" data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/breakout/${escapeHtml(root.dataset.groupId)}/comments" method="post"><input type="hidden" name="parentId" value="${escapeHtml(comment.id)}"><textarea name="comment" placeholder="Reply to this thread..." rows="1" required></textarea><button class="lui-button lui-button-secondary" type="submit">Send reply</button></form></details><div class="comment-replies"></div></div>`;
}

function appendBreakoutComment(comment, root) {
  if (!comment || !root) return;
  const list = root.querySelector('[data-breakout-comment-list]');
  const wasAtBottom = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 24 : true;
  const existing = root.querySelector(`[data-comment-id="${CSS.escape(comment.id || '')}"]`); if (existing) return;
  if (comment.parentId) {
    const thread = root.querySelector(`[data-comment-id="${CSS.escape(comment.parentId)}"]`); const replies = thread?.querySelector('.comment-replies');
    if (replies) replies.insertAdjacentHTML('beforeend', breakoutCommentMarkup(comment, root));
  } else {
    root.querySelector('[data-breakout-comment-list]')?.insertAdjacentHTML('beforeend', breakoutCommentMarkup(comment, root));
  }
  bindLiveForms(root); lucide.createIcons();
  if (wasAtBottom) list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
}

function scrollBreakoutComments(root) {
  const list = root?.querySelector('[data-breakout-comment-list]');
  if (list) list.scrollTop = list.scrollHeight;
}

function renderBreakoutPresence(root, members) {
  const list = root.querySelector('[data-presence-list]'); const summary = root.querySelector('[data-presence-summary]');
  const records = JSON.parse(root.dataset.members || '[]'); if (!list) return;
  const statusLabel = { 'same-page': 'Here now', inactive: 'On another page' };
  const visible = records.map((member) => ({ ...member, ...(members.find((presence) => presence.userId === member.id) || {}) })).filter((member) => member.status);
  list.innerHTML = visible.map((member) => `<div class="presence-person ${member.status}" data-presence-user="${escapeHtml(member.id)}" data-presence-tooltip="${escapeHtml(`${member.name}${member.id === root.dataset.userId ? ' (you)' : ''} · ${statusLabel[member.status]} · @${member.username || 'member'}`)}"><button class="lui-avatar presence-avatar" type="button" data-presence-details="${escapeHtml(member.id)}" aria-label="View ${escapeHtml(member.name)}">${escapeHtml(member.name.slice(0, 1).toUpperCase())}</button>${member.id !== root.dataset.userId ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/breakout/${escapeHtml(root.dataset.groupId)}/ping/${escapeHtml(member.id)}" method="post"><button class="lui-icon-button presence-ping" type="submit" aria-label="Ping ${escapeHtml(member.name)}" title="Ping ${escapeHtml(member.name)}"><i data-lucide="bell-ring"></i></button></form>` : ''}</div>`).join('');
  const active = visible.filter((member) => member.status === 'same-page').length; if (summary) summary.textContent = `${active} here now`;
  bindLiveForms(list); list.querySelectorAll('[data-presence-details]').forEach((button) => button.addEventListener('click', () => { const member = visible.find((entry) => entry.id === button.dataset.presenceDetails); if (!member) return; document.querySelector('[data-presence-details-modal]')?.remove(); const modal = document.createElement('div'); modal.className = 'presence-details'; modal.dataset.presenceDetailsModal = 'true'; modal.innerHTML = `<article class="presence-details-card"><button class="lui-icon-button" type="button" data-presence-close aria-label="Close details"><i data-lucide="x"></i></button><h2>${escapeHtml(member.name)}</h2><p>@${escapeHtml(member.username || 'member')} · ${escapeHtml(member.role || 'Member')}</p><p>${escapeHtml(statusLabel[member.status])}</p><button class="lui-button lui-button-secondary" type="button" data-presence-close>Close</button></article>`; modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-presence-close]')) modal.remove(); }); document.body.appendChild(modal); lucide.createIcons(); }));
  list.querySelectorAll('.presence-person').forEach((row) => row.addEventListener('click', (event) => { if (!event.target.closest('form, button')) row.querySelector('[data-presence-details]')?.click(); }));
}

function enhanceBreakoutTasks(root) {
  root.querySelectorAll('[data-breakout-task-list] .breakout-task').forEach((row) => {
    if (row.querySelector('.task-check')) return;
    const taskId = row.dataset.taskId; const done = row.classList.contains('is-done');
    row.insertAdjacentHTML('afterbegin', `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/breakout/${escapeHtml(root.dataset.groupId)}/tasks/${escapeHtml(taskId)}/toggle" method="post"><button class="lui-check task-check" type="submit" aria-label="${done ? 'Mark incomplete' : 'Mark complete'}"><i data-lucide="${done ? 'check-circle-2' : 'circle'}"></i></button></form>`);
    row.querySelector(':scope > span:first-of-type')?.classList.add('breakout-task-copy');
  });
  bindLiveForms(root); lucide.createIcons();
}

function setCourseTab(tabName, updateHash = true) {
  const root = courseRoot(); if (!root) return;
  document.querySelectorAll('[data-course-tab]').forEach((tab) => {
    const selected = tab.dataset.courseTab === tabName;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-course-view]').forEach((view) => view.classList.toggle('active', view.dataset.courseView === tabName));
  if (updateHash) history.replaceState({}, '', `${window.location.pathname}#${tabName}`);
}
function applyCourseFeedControls(root) {
  const filter = root.querySelector('[data-course-filter]')?.value || 'all'; const query = (root.querySelector('[data-course-search]')?.value || '').trim().toLowerCase();
  root.querySelectorAll('[data-item-id]').forEach((card) => { const type = (card.dataset.type || '').toLowerCase(); const matchesQuery = !query || card.textContent.toLowerCase().includes(query); const matchesFilter = filter === 'active' ? card.dataset.past !== 'true' : filter === 'past' ? card.dataset.past === 'true' : filter === 'homework' ? type === 'homework' : filter === 'tests' ? type.includes('test') : filter === 'projects' ? type === 'project' : true; card.hidden = !matchesQuery || !matchesFilter; });
  root.querySelectorAll('[data-course-folder-count]').forEach((count) => { const past = count.dataset.courseFolderCount === 'past'; count.textContent = String(root.querySelectorAll(`[data-item-id][data-past="${past}"]:not([hidden])`).length); });
}
function setCourseFolderCollapsed(root, folder, collapsed) {
  const section = root.querySelector(`[data-course-folder="${folder}"]`); const toggle = section?.querySelector('[data-course-folder-toggle]'); const content = section?.querySelector('[data-course-folder-content]');
  if (!section || !toggle || !content) return;
  section.classList.toggle('is-collapsed', collapsed); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${folder} assignments`); content.setAttribute('aria-hidden', String(collapsed)); content.inert = collapsed;
}
function courseFeedStorageKey(root) { return `lockin-course-feed-${root.dataset.orgId}-${root.dataset.courseId}`; }
function loadCourseFeedState(root) {
  const state = { filter: 'all', query: '', collapsed: { current: false, past: false } };
  try {
    const saved = localStorage.getItem(courseFeedStorageKey(root));
    if (!saved) return state;
    const parsed = JSON.parse(saved);
    if (['all', 'active', 'past', 'homework', 'tests', 'projects'].includes(parsed.filter)) state.filter = parsed.filter;
    if (typeof parsed.query === 'string') state.query = parsed.query;
    if (typeof parsed.collapsed?.current === 'boolean') state.collapsed.current = parsed.collapsed.current;
    if (typeof parsed.collapsed?.past === 'boolean') state.collapsed.past = parsed.collapsed.past;
  } catch (error) {
    console.warn('Unable to load saved course feed preferences.', error);
  }
  return state;
}
function saveCourseFeedState(root, state) {
  try {
    localStorage.setItem(courseFeedStorageKey(root), JSON.stringify(state));
  } catch (error) {
    console.warn('Unable to save course feed preferences.', error);
  }
}
function bindCourseFeedControls(root) {
  if (!root || root.dataset.feedControlsBound === 'true') return;
  root.dataset.feedControlsBound = 'true';
  const state = loadCourseFeedState(root); const filter = root.querySelector('[data-course-filter]'); const search = root.querySelector('[data-course-search]');
  if (filter) filter.value = state.filter;
  if (search) search.value = state.query;
  Object.entries(state.collapsed).forEach(([folder, collapsed]) => setCourseFolderCollapsed(root, folder, collapsed));
  filter?.addEventListener('change', () => { state.filter = filter.value; applyCourseFeedControls(root); saveCourseFeedState(root, state); });
  search?.addEventListener('input', () => { state.query = search.value; applyCourseFeedControls(root); saveCourseFeedState(root, state); });
  root.querySelectorAll('[data-course-folder-toggle]').forEach((toggle) => toggle.addEventListener('click', () => {
    const folder = toggle.dataset.courseFolderToggle; state.collapsed[folder] = toggle.getAttribute('aria-expanded') === 'true'; setCourseFolderCollapsed(root, folder, state.collapsed[folder]); saveCourseFeedState(root, state);
  }));
  applyCourseFeedControls(root);
}

function insertCourseFeedItem(root, item) {
  const list = root?.querySelector('[data-feed-list]');
  if (!list || !item || root.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)) return null;
  const targetList = courseFolderList(root, courseItemPast(item));
  if (!targetList) return null;
  root.querySelector('[data-empty-feed]')?.remove();
  const previous = captureTaskListPositions(targetList);
  targetList.insertAdjacentHTML('afterbegin', itemCard(item));
  const card = targetList.querySelector(`:scope > [data-item-id="${CSS.escape(item.id)}"]`);
  if (!card) return null;
  animateTaskListPositions(targetList, previous, { enterElement: card, rippleFrom: card });
  bindLiveForms(card);
  bindCourseItemEditing(card);
  bindCourseReorder(root);
  lucide.createIcons();
  applyCourseFeedControls(root);
  return card;
}

function insertBreakoutTask(root, task) {
  const list = root?.querySelector('[data-breakout-task-list]');
  if (!list || !task || list.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)) return null;
  root.querySelector('[data-empty-breakout-board]')?.remove();
  const previous = captureTaskListPositions(list);
  list.insertAdjacentHTML('beforeend', breakoutTaskMarkup(task, root));
  const row = list.querySelector(`:scope > [data-task-id="${CSS.escape(task.id)}"]`);
  if (!row) return null;
  animateTaskListPositions(list, previous, { enterElement: row, rippleFrom: row });
  bindLiveForms(row);
  lucide.createIcons();
  return row;
}

function connectLiveCourse() {
  const root = courseRoot(); if (!root || typeof io !== 'function') return;
  liveState.socket?.disconnect(); liveState.socket = io();
  liveState.socket.on('connect', () => { liveState.socket.emit('course:join', { orgId: root.dataset.orgId, courseId: root.dataset.courseId }); liveState.socket.emit('group:join', { orgId: root.dataset.orgId }); });
  liveState.socket.on('course:item-created', ({ item }) => insertCourseFeedItem(root, item));
  liveState.socket.on('item:verification-changed', ({ itemId, verifiedBy }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-verify-count]`); if (count) count.textContent = verifiedBy.length; });
  liveState.socket.on('item:downvote-changed', ({ itemId, downvoteCount }) => { const count = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-downvote-count]`); if (count && downvoteCount !== undefined) count.textContent = downvoteCount; });
  liveState.socket.on('item:updated', ({ item }) => { const card = root.querySelector(`[data-item-id="${CSS.escape(item?.id || '')}"]`); if (card && item) { const wasOpen = card.querySelector('.comment-details')?.open; card.outerHTML = itemCard(item); const nextCard = root.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`); bindLiveForms(nextCard); bindCourseItemEditing(nextCard); if (wasOpen) nextCard.querySelector('.comment-details').open = true; const past = courseItemPast(item); nextCard.dataset.past = String(past); const targetList = courseFolderList(root, past); if (targetList && nextCard.parentElement !== targetList) targetList.appendChild(nextCard); applyCourseFeedControls(root); lucide.createIcons(); } });
  liveState.socket.on('item:deleted', ({ itemId }) => root.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`)?.remove());
  liveState.socket.on('course:items-reordered', ({ items }) => { if (!items) return; const positions = new Map(items.map((item) => [item.id, item])); const list = root.querySelector('[data-feed-list]'); [...list.querySelectorAll('[data-item-id]')].forEach((card) => { const item = positions.get(card.dataset.itemId); if (item) card.dataset.past = String(courseItemPast(item)); }); ['current', 'past'].forEach((folder) => { const targetList = courseFolderList(root, folder === 'past'); [...list.querySelectorAll(`[data-item-id][data-past="${folder === 'past'}"]`)].sort((left, right) => (positions.get(left.dataset.itemId)?.position ?? 0) - (positions.get(right.dataset.itemId)?.position ?? 0)).forEach((card) => targetList?.appendChild(card)); }); applyCourseFeedControls(root); });
  liveState.socket.on('item:comment-added', ({ itemId, comment }) => appendUniqueComment(itemId, comment));
  liveState.socket.on('item:comment-updated', ({ itemId, comment }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(comment?.id || '')}"]`); if (entry && comment) { entry.outerHTML = commentMarkup(comment, { orgId: root.dataset.orgId, itemId, canEdit: root.dataset.isAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.isAdmin === 'true' || comment.userId === root.dataset.userId, canViewHistory: root.dataset.isAdmin === 'true' }); bindLiveForms(root); lucide.createIcons(); } });
  liveState.socket.on('item:comment-deleted', ({ itemId, commentId }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`); finishCommentRemoval(entry); });
  liveState.socket.on('item:comment-reported', ({ itemId, commentId }) => { const entry = root.querySelector(`[data-item-id="${CSS.escape(itemId)}"] [data-comment-id="${CSS.escape(commentId)}"]`); markCommentReported(entry); });
  liveState.socket.on('board:card-created', ({ card }) => { if (!card) return; const list = root.querySelector('[data-board-list]'); if (!list || list.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)) return; root.querySelector('[data-empty-board]')?.remove(); const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/board/${escapeHtml(card.id)}/delete" method="post"><button class="lui-icon-button" type="submit" aria-label="Delete board task"><i data-lucide="trash-2"></i></button></form>` : '<i data-lucide="arrow-right"></i>'; list.insertAdjacentHTML('beforeend', `<div class="claim-row" data-card-id="${escapeHtml(card.id)}"><span><strong>${escapeHtml(card.title)}</strong><small>${escapeHtml(card.status)}</small></span>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:created', ({ resource }) => { if (!resource) return; const list = root.querySelector('[data-resource-list]'); if (!list || list.querySelector(`[data-resource-id="${CSS.escape(resource.id)}"]`)) return; const remove = root.dataset.isAdmin === 'true' ? `<form data-live-form action="/org/${escapeHtml(root.dataset.orgId)}/course/${escapeHtml(root.dataset.courseId)}/resources/${escapeHtml(resource.id)}/delete" method="post"><button class="lui-icon-button" type="submit" aria-label="Delete resource"><i data-lucide="trash-2"></i></button></form>` : ''; list.insertAdjacentHTML('beforeend', `<div class="resource-row" data-resource-id="${escapeHtml(resource.id)}"><a class="resource-link" href="${escapeHtml(resource.url)}" target="_blank" rel="noreferrer"><i data-lucide="external-link"></i><span>${escapeHtml(resource.title)}</span></a>${remove}</div>`); bindLiveForms(list.lastElementChild); lucide.createIcons(); });
  liveState.socket.on('resource:deleted', ({ resourceId }) => root.querySelector(`[data-resource-id="${CSS.escape(resourceId)}"]`)?.remove());
}

function persistCourseOrder(root) {
  const list = root.querySelector('[data-feed-list]'); if (!list) return;
  const cards = [...list.querySelectorAll('[data-item-id]')]; const order = cards.map((card, index) => { card.dataset.position = index; return card.dataset.itemId; }); const past = cards.filter((card) => card.dataset.past === 'true').map((card) => card.dataset.itemId);
  return fetch(`/org/${root.dataset.orgId}/course/${root.dataset.courseId}/items/reorder`, { method: 'POST', body: new URLSearchParams({ order: order.join(','), past: past.join(',') }), headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }).then(async (response) => { const payload = await response.json(); if (!response.ok || payload.error) { setCourseReorderCooldown(root, payload.retryAfter || 5000); } });
}

function setCourseReorderCooldown(root, duration = 5000) {
  const until = Date.now() + duration;
  root.dataset.reorderLockedUntil = String(until);
  root.querySelectorAll('.course-drag-handle').forEach((handle) => { handle.disabled = true; handle.classList.add('is-cooldown'); });
  window.setTimeout(() => { if (Number(root.dataset.reorderLockedUntil) > Date.now()) return; root.querySelectorAll('.course-drag-handle').forEach((handle) => { handle.disabled = false; handle.classList.remove('is-cooldown'); }); }, duration);
}

function bindCourseReorder(root) {
  if (!root) return;
  const list = root.querySelector('[data-feed-list]'); if (!list) return;
  list.querySelectorAll('[data-item-id]').forEach((card) => {
    if (card.dataset.reorderBound === 'true') return;
    card.dataset.reorderBound = 'true';
    const grip = card.querySelector('.course-drag-handle'); if (!grip) return;
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || Number(root.dataset.reorderLockedUntil) > Date.now()) return;
      event.preventDefault(); liveState.courseDragged = card; card.classList.add('is-dragging'); grip.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => { const dragged = liveState.courseDragged; if (!dragged) return; const folder = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest('[data-course-folder]'); const targetList = folder?.querySelector('.feed-list'); if (!targetList) return; dragged.dataset.past = String(folder.dataset.courseFolder === 'past'); const target = [...targetList.querySelectorAll('[data-item-id]')].filter((candidate) => candidate !== dragged).find((candidate) => moveEvent.clientY < candidate.getBoundingClientRect().top + candidate.offsetHeight / 2); if (target) targetList.insertBefore(dragged, target); else targetList.appendChild(dragged); };
      const finish = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', finish); document.removeEventListener('pointercancel', finish); card.classList.remove('is-dragging'); liveState.courseDragged = null; if (root.dataset.isAdmin !== 'true') setCourseReorderCooldown(root); persistCourseOrder(root); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', finish, { once: true }); document.addEventListener('pointercancel', finish, { once: true });
    });
  });
}

function connectLiveBreakout() {
  const root = document.querySelector('[data-breakout-live]'); if (!root || typeof io !== 'function') return;
  window.clearInterval(liveState.presenceHeartbeat);
  liveState.socket?.disconnect(); liveState.socket = io();
  liveState.socket.on('connect', () => { liveState.socket.emit('group:join', { orgId: root.dataset.orgId }); liveState.socket.emit('breakout:presence', { orgId: root.dataset.orgId, groupId: root.dataset.groupId }); liveState.presenceHeartbeat = window.setInterval(() => liveState.socket?.emit('breakout:presence-heartbeat'), 20000); });
  liveState.socket.on('breakout:presence', ({ groupId, members }) => { if (groupId === root.dataset.groupId) renderBreakoutPresence(root, members || []); });
  liveState.socket.on('breakout:task-created', ({ groupId, task }) => { if (groupId !== root.dataset.groupId) return; insertBreakoutTask(root, task); });
  liveState.socket.on('breakout:task-updated', ({ groupId, task }) => { if (groupId !== root.dataset.groupId || !task) return; const row = root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`); if (row) { row.outerHTML = breakoutTaskMarkup(task, root); bindLiveForms(root.querySelector(`[data-task-id="${CSS.escape(task.id)}"]`)); lucide.createIcons(); } });
  liveState.socket.on('breakout:task-deleted', ({ groupId, taskId }) => { if (groupId === root.dataset.groupId) root.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)?.remove(); });
  liveState.socket.on('breakout:board-deleted', ({ groupId }) => { if (groupId === root.dataset.groupId) root.querySelector('[data-breakout-task-list]').innerHTML = '<div class="empty-panel" data-empty-breakout-board><h3>The board is clear</h3></div>'; });
  liveState.socket.on('breakout:comment-created', ({ groupId, comment }) => { if (groupId === root.dataset.groupId) appendBreakoutComment(comment, root); });
  liveState.socket.on('breakout:comment-updated', ({ groupId, comment }) => { if (groupId !== root.dataset.groupId || !comment) return; const entry = root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(comment.id)}"]`); if (entry) { entry.outerHTML = commentMarkup(comment, { orgId: root.dataset.orgId, groupId, canEdit: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canDelete: root.dataset.groupAdmin === 'true' || comment.userId === root.dataset.userId, canViewHistory: root.dataset.groupAdmin === 'true' }); bindLiveForms(root); lucide.createIcons(); } });
  liveState.socket.on('breakout:comment-deleted', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) finishCommentRemoval(root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)); });
  liveState.socket.on('breakout:comment-reported', ({ groupId, commentId }) => { if (groupId === root.dataset.groupId) markCommentReported(root.querySelector(`[data-breakout-comment-list] [data-comment-id="${CSS.escape(commentId)}"]`)); });
  enhanceBreakoutTasks(root);
  scrollBreakoutComments(root);
}
