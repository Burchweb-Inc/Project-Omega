var routeProgress = document.createElement('div');
routeProgress.className = 'route-progress';
document.body.appendChild(routeProgress);

var liveState = { socket: null, notificationSocket: null, pending: new Map(), dashboardHeroTimer: null, dashboardHeroFadeTimer: null };
var escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
var popupMenuSelector = '.notification-menu, .account-menu, .group-menu, .task-menu, .comment-menu, .reply-details, .member-actions, .create-breakout-details, .task-edit-details, .priority-menu';
var popupDetailsSelector = 'details.notification-menu, details.account-menu, details.group-menu, details.task-menu, details.comment-menu, details.reply-details, details.member-actions, details.create-breakout-details, details.task-edit-details';
const taskListMotionAnimations = new WeakMap();
const taskComposerAnimations = new WeakMap();

function taskListItems(list) {
  return [...list.children].filter((element) => element.matches('[data-task-id], [data-item-id]'));
}

function captureTaskListPositions(list) {
  const animations = taskListMotionAnimations.get(list);
  animations?.forEach((animation) => animation.cancel());
  taskListMotionAnimations.delete(list);
  return new Map(taskListItems(list).map((element) => [element, element.getBoundingClientRect()]));
}

function animateTaskListPositions(list, previous, { enterElement = null, rippleFrom = null, organizing = false } = {}) {
  if (!list || !previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const items = taskListItems(list);
  if (items.some((element) => typeof element.animate !== 'function')) return;
  const animations = new Set();
  taskListMotionAnimations.set(list, animations);
  const anchorIndex = items.indexOf(rippleFrom);
  const animate = (element, keyframes, timing) => {
    const animation = element.animate(keyframes, timing);
    animations.add(animation);
    animation.finished.then(() => {
      if (taskListMotionAnimations.get(list) === animations) animations.delete(animation);
    }, () => {
      if (taskListMotionAnimations.get(list) === animations) animations.delete(animation);
    });
  };

  items.forEach((element, index) => {
    if (element === enterElement) {
      if (!element.hidden) animate(element, [
        { opacity: 0, transform: 'translate3d(0, 14px, 0) scale(.975)', filter: 'blur(3px)' },
        { opacity: 1, transform: 'translate3d(0, -2px, 0) scale(1.006)', filter: 'blur(0)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0)' }
      ], { duration: 560, easing: 'cubic-bezier(.16,1,.3,1)' });
      return;
    }

    const before = previous.get(element);
    if (!before || element.hidden) return;
    const after = element.getBoundingClientRect();
    const deltaX = before.left - after.left;
    const deltaY = before.top - after.top;
    const isRipple = rippleFrom && anchorIndex >= 0;
    if (!deltaX && !deltaY && !organizing && !isRipple) return;
    const rippleY = isRipple && !deltaY ? 3 : deltaY;
    const rotation = organizing ? (index % 2 ? 7 : -7) : 0;
    const delay = isRipple ? Math.min(Math.abs(index - anchorIndex) * 24, 144) : 0;
    animate(element, [
      { transform: `translate3d(${deltaX}px, ${rippleY}px, 0) rotateY(${rotation}deg) scale(.994)` },
      { transform: 'translate3d(0, 0, 0) rotateY(0deg) scale(1)' }
    ], { duration: organizing ? 520 : 500, delay, easing: 'cubic-bezier(.22,.8,.32,1)' });
  });
}

function animateTaskComposer(element, opening) {
  if (!element) return Promise.resolve();
  const previous = taskComposerAnimations.get(element);
  previous?.cancel();
  taskComposerAnimations.delete(element);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (element.matches('.modal-backdrop')) {
    const panel = element.querySelector('.modal-card');
    if (opening) {
      element.classList.add('open');
      element.setAttribute('aria-hidden', 'false');
      if (reducedMotion || !panel || typeof panel.animate !== 'function') return Promise.resolve();
      const animation = panel.animate([
        { opacity: 0, transform: 'translateY(18px) scale(.975)', filter: 'blur(2px)' },
        { opacity: 1, transform: 'translateY(-2px) scale(1.004)', filter: 'blur(0)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }
      ], { duration: 440, easing: 'cubic-bezier(.16,1,.3,1)' });
      taskComposerAnimations.set(element, animation);
      animation.finished.then(() => {
        if (taskComposerAnimations.get(element) === animation) taskComposerAnimations.delete(element);
      }, () => {});
      return animation.finished.catch(() => {});
    }
    if (!element.classList.contains('open')) return Promise.resolve();
    element.setAttribute('aria-hidden', 'true');
    if (reducedMotion || !panel || typeof panel.animate !== 'function') {
      element.classList.remove('open');
      return Promise.resolve();
    }
    const animation = panel.animate([
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateY(8px) scale(.985)', filter: 'blur(1px)' }
    ], { duration: 190, easing: 'cubic-bezier(.4,0,1,1)' });
    taskComposerAnimations.set(element, animation);
    return animation.finished.catch(() => {}).then(() => {
      if (taskComposerAnimations.get(element) !== animation) return;
      taskComposerAnimations.delete(element);
      element.classList.remove('open');
    });
  }

  const isHidden = element.classList.contains('hidden');
  if (opening === !isHidden) return Promise.resolve();
  if (opening) element.classList.remove('hidden');
  element.setAttribute('aria-hidden', String(!opening));
  const fullHeight = element.scrollHeight;
  if (reducedMotion || typeof element.animate !== 'function') {
    element.classList.toggle('hidden', !opening);
    return Promise.resolve();
  }
  element.style.overflow = 'hidden';
  const animation = element.animate(opening ? [
    { height: '0px', opacity: 0, transform: 'translateY(-8px)' },
    { height: `${fullHeight}px`, opacity: 1, transform: 'translateY(0)' }
  ] : [
    { height: `${element.getBoundingClientRect().height}px`, opacity: 1, transform: 'translateY(0)' },
    { height: '0px', opacity: 0, transform: 'translateY(-6px)' }
  ], { duration: opening ? 390 : 230, easing: opening ? 'cubic-bezier(.2,.8,.25,1)' : 'cubic-bezier(.4,0,1,1)' });
  taskComposerAnimations.set(element, animation);
  return animation.finished.catch(() => {}).then(() => {
    if (taskComposerAnimations.get(element) !== animation) return;
    taskComposerAnimations.delete(element);
    element.style.height = '';
    element.style.overflow = '';
    if (!opening) element.classList.add('hidden');
  });
}

function decoratePopupMenu(menu) {
  menu.classList.add('lui-menu');
  const panel = menu.matches('.timezone-picker')
    ? menu.querySelector(':scope > [data-timezone-panel]')
    : menu.querySelector(':scope > .notification-popover, :scope > .account-menu-popover, :scope > .group-menu-popover, :scope > .task-menu-popover, :scope > .comment-menu-popover, :scope > .reply-form, :scope > .member-actions-popover, :scope > .breakout-create-form, :scope > .task-edit-form, :scope > .priority-options');
  panel?.classList.add('lui-menu-panel');
  menu.querySelector(':scope > summary, :scope > .priority-flag, :scope > [data-timezone-trigger]')?.classList.add('lui-menu-trigger');
  return panel;
}

const popupMenuAnimations = new WeakMap();
const popupMenuMotion = {
  opening: [{ opacity: 0, transform: 'translateY(-4px) scale(.985)', filter: 'blur(1.5px)' }, { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }],
  closing: [{ opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0)' }, { opacity: 0, transform: 'translateY(-2px) scale(.99)', filter: 'blur(1.5px)' }]
};

function animatePopupMenu(menu, panel, opening) {
  const previousAnimation = popupMenuAnimations.get(menu);
  const currentStyle = previousAnimation && panel ? getComputedStyle(panel) : null;
  previousAnimation?.cancel();
  popupMenuAnimations.delete(menu);
  if (!panel || window.matchMedia('(prefers-reduced-motion: reduce)').matches || typeof panel.animate !== 'function') {
    if (panel) panel.style.willChange = '';
    return null;
  }
  const motion = popupMenuMotion[opening ? 'opening' : 'closing'];
  const keyframes = currentStyle
    ? [{ opacity: currentStyle.opacity, transform: currentStyle.transform, filter: currentStyle.filter }, motion[1]]
    : motion;
  const animation = panel.animate(keyframes, {
    duration: opening ? 220 : 155,
    easing: 'cubic-bezier(.2,.7,.25,1)',
    fill: 'both'
  });
  panel.style.willChange = 'opacity, transform, filter';
  popupMenuAnimations.set(menu, animation);
  animation.finished.then(() => {
    if (popupMenuAnimations.get(menu) !== animation) return;
    popupMenuAnimations.delete(menu);
    panel.style.willChange = '';
    animation.cancel();
  }, () => {
    if (popupMenuAnimations.get(menu) !== animation) return;
    popupMenuAnimations.delete(menu);
    panel.style.willChange = '';
  });
  return animation;
}

function closePopupMenu(menu, restoreFocus = false) {
  if (!menu) return;
  const panel = decoratePopupMenu(menu);
  if (menu.matches('.timezone-picker')) {
    if (!menu.classList.contains('open') || menu.classList.contains('menu-closing')) return;
    const trigger = menu.querySelector('[data-timezone-trigger]');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger?.focus();
    menu.classList.add('menu-closing');
    if (!animatePopupMenu(menu, panel, false)) {
      menu.classList.remove('open', 'menu-closing');
      if (panel) panel.hidden = true;
      return;
    }
    popupMenuAnimations.get(menu).finished.then(() => {
      if (!menu.classList.contains('menu-closing')) return;
      menu.classList.remove('open', 'menu-closing');
      if (panel) panel.hidden = true;
      if (panel) panel.inert = false;
    }, () => {});
    if (panel) panel.inert = true;
    return;
  }
  const isPriorityMenu = menu.matches('.priority-menu');
  if (isPriorityMenu ? !menu.classList.contains('open') || menu.classList.contains('menu-closing') : !menu.open || menu.classList.contains('menu-closing')) return;
  menu.querySelector(':scope > summary, :scope > .priority-flag')?.setAttribute('aria-expanded', 'false');
  if (restoreFocus) menu.querySelector(':scope > summary, :scope > .priority-flag')?.focus();
  menu.classList.add('menu-closing');
  if (!animatePopupMenu(menu, panel, false)) {
    if (isPriorityMenu) menu.classList.remove('open');
    else menu.open = false;
    menu.classList.remove('menu-closing');
    return;
  }
  if (panel) panel.inert = true;
  popupMenuAnimations.get(menu).finished.then(() => {
    if (!menu.classList.contains('menu-closing')) return;
    if (isPriorityMenu) menu.classList.remove('open');
    else menu.open = false;
    menu.classList.remove('menu-closing');
    if (panel) panel.inert = false;
  }, () => {});
}

function openPopupMenu(menu) {
  document.querySelectorAll(popupMenuSelector).forEach((other) => {
    if (other !== menu) closePopupMenu(other);
  });
  document.querySelectorAll('.timezone-picker.open').forEach((other) => closePopupMenu(other));
  const panel = decoratePopupMenu(menu);
  menu.classList.remove('menu-closing');
  if (panel) panel.inert = false;
  if (menu.matches('.priority-menu, .timezone-picker')) menu.classList.add('open');
  else menu.open = true;
  menu.querySelector(':scope > summary, :scope > .priority-flag')?.setAttribute('aria-expanded', 'true');
  animatePopupMenu(menu, panel, true);
}

function bindPopupMenus() {
  document.querySelectorAll(popupMenuSelector).forEach((menu) => {
    decoratePopupMenu(menu);
    const trigger = menu.querySelector(':scope > summary, :scope > .priority-flag');
    if (trigger) trigger.setAttribute('aria-expanded', String(menu.matches('.priority-menu') ? menu.classList.contains('open') : menu.open));
  });
  if (document.body.dataset.popupMenusBound) return;
  document.body.dataset.popupMenusBound = 'true';
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const summary = event.target.closest('summary');
    const detailMenu = summary?.parentElement;
    if (summary && detailMenu?.matches(popupMenuSelector) && detailMenu.firstElementChild === summary) {
      event.preventDefault();
      if (detailMenu.classList.contains('menu-closing')) openPopupMenu(detailMenu);
      else if (detailMenu.open) closePopupMenu(detailMenu);
      else openPopupMenu(detailMenu);
      return;
    }
    if (!event.target.closest('.priority-menu')) {
      document.querySelectorAll('.priority-menu.open').forEach((menu) => closePopupMenu(menu));
    }
    if (!event.target.closest('.timezone-picker')) {
      document.querySelectorAll('.timezone-picker.open').forEach((menu) => closePopupMenu(menu));
    }
    document.querySelectorAll(popupDetailsSelector).forEach((menu) => {
      if (!menu.contains(event.target)) closePopupMenu(menu);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openMenu = [...document.querySelectorAll(`${popupMenuSelector}, .timezone-picker.open`)].reverse().find((menu) => menu.matches('.priority-menu, .timezone-picker') ? menu.classList.contains('open') : menu.open);
    if (!openMenu) return;
    event.preventDefault();
    closePopupMenu(openMenu, true);
  });
}

function showLockUiStatus(message) {
  const status = document.querySelector('[data-lui-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.add('is-visible');
  window.clearTimeout(status.hideTimer);
  status.hideTimer = window.setTimeout(() => status.classList.remove('is-visible'), 2200);
}

function decorateLockUiComponents(root = document) {
  const decorate = (selector, callback) => {
    if (root instanceof Element && root.matches(selector)) callback(root);
    root.querySelectorAll(selector).forEach(callback);
  };
  decorate('.modal-close', (button) => button.classList.add('lui-icon-button'));
  decorate('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea', (field) => {
    field.classList.add(field.matches('select') ? 'lui-select' : field.matches('textarea') ? 'lui-textarea' : 'lui-input');
  });
  decorate('label', (label) => {
    if (label.querySelector('input[type="checkbox"], input[type="radio"]') || label.matches('.course-feed-search, .toggle-row')) return;
    if (label.querySelector('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea')) label.classList.add('lui-field');
  });
  decorate('[role="tablist"], .course-tabs, .admin-tabs, .dashboard-tabs', (tablist) => {
    tablist.classList.add('lui-tabs');
    tablist.querySelectorAll('a, button').forEach((tab) => {
      tab.classList.add('lui-tab');
      if (tablist.matches('[role="tablist"]')) {
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(tab.classList.contains('active') || tab.getAttribute('aria-selected') === 'true'));
      }
    });
  });
  decorate('.feed-card, .group-card, .metric-card, .mod-card, .report-row, .resource-row, .member-card, .settings-section, .setting-card', (card) => card.classList.add('lui-card'));
  decorate('.empty-panel', (empty) => empty.classList.add('lui-empty'));
  decorate('.avatar', (avatar) => {
    avatar.classList.add('lui-avatar');
    if (avatar.classList.contains('small') || avatar.classList.contains('mini')) avatar.classList.add('lui-avatar-sm');
  });
  decorate('.role-label, .queue-count, .nav-count, .priority-flag, .progress-ring', (status) => status.classList.add('lui-badge'));
  decorate('.form-alert, .form-success, .auth-page-alert, .conduct-banner, .settings-tip, .group-settings-error', (alert) => {
    alert.classList.add('lui-alert');
    if (alert.matches('.form-success')) alert.classList.add('lui-alert-success');
    else if (alert.matches('.group-settings-error')) alert.classList.add('lui-alert-danger');
    else if (alert.matches('.conduct-banner')) alert.classList.add('lui-alert-warning');
  });
  decorate('dialog', (dialog) => dialog.classList.add('lui-dialog'));
  decorate('.modal-card, .warning-modal, .announcement-modal, .tutorial-card', (panel) => panel.classList.add('lui-panel'));
}

let sidebarCollapsedPreference = false;
let sidebarPreferenceLoaded = false;
const sidebarLayoutAnimations = new WeakMap();
function bindSidebarToggle() {
  const shell = document.querySelector('.app-shell');
  const sidebar = shell?.querySelector('.sidebar');
  if (!shell || !sidebar) return;
  const mobileViewport = window.matchMedia('(max-width: 700px)');
  if (!sidebarPreferenceLoaded) {
    try {
      sidebarCollapsedPreference = localStorage.getItem('lockin-sidebar-collapsed') === 'true';
    } catch (error) {
      sidebarCollapsedPreference = false;
    }
    sidebarPreferenceLoaded = true;
  }
  let collapsed = sidebarCollapsedPreference;
  let sidebarStateInitialized = false;
  const setState = (isCollapsed, isMobileOpen = false) => {
    const shouldAnimateLayout = sidebarStateInitialized
      && !mobileViewport.matches
      && shell.classList.contains('sidebar-collapsed') !== isCollapsed
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const movingElements = shouldAnimateLayout
      ? [...sidebar.querySelectorAll('.sidebar-head > *, .sidebar-foot > .sidebar-version, .sidebar-foot-body > *')]
      : [];
    movingElements.forEach((element) => {
      sidebarLayoutAnimations.get(element)?.cancel();
      sidebarLayoutAnimations.delete(element);
    });
    const previousPositions = new Map(movingElements.map((element) => [element, element.getBoundingClientRect()]));
    shell.classList.toggle('sidebar-collapsed', isCollapsed);
    sidebar.classList.toggle('mobile-open', isMobileOpen && mobileViewport.matches);
    shell.classList.toggle('sidebar-mobile-open', isMobileOpen && mobileViewport.matches);
    document.body.classList.toggle('sidebar-mobile-open', isMobileOpen && mobileViewport.matches);
    movingElements.forEach((element) => {
      const previous = previousPositions.get(element);
      const current = element.getBoundingClientRect();
      const offsetX = previous.left - current.left;
      const offsetY = previous.top - current.top;
      if (!offsetX && !offsetY) return;
      const animation = element.animate([
        { transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
        { transform: 'translate3d(0, 0, 0)' }
      ], {
        duration: 540,
        easing: isCollapsed ? 'cubic-bezier(.4, 0, .2, 1)' : 'cubic-bezier(.16, 1, .3, 1)'
      });
      sidebarLayoutAnimations.set(element, animation);
      animation.finished.then(() => {
        if (sidebarLayoutAnimations.get(element) === animation) sidebarLayoutAnimations.delete(element);
      }, () => {});
    });
    shell.querySelectorAll('[data-sidebar-toggle]').forEach((button) => {
      const expanded = mobileViewport.matches ? isMobileOpen : !isCollapsed;
      const label = mobileViewport.matches
        ? (isMobileOpen ? 'Close navigation' : 'Open navigation')
        : (isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
      button.setAttribute('aria-expanded', String(expanded));
      button.setAttribute('aria-label', label);
      button.title = label;
      const icon = button.querySelector('i, svg');
      if (icon) {
        const iconName = mobileViewport.matches
          ? (isMobileOpen ? 'x' : 'menu')
          : (isCollapsed ? 'panel-left-open' : 'panel-left-close');
        if (icon instanceof SVGElement) {
          const placeholder = document.createElement('i');
          placeholder.dataset.lucide = iconName;
          icon.replaceWith(placeholder);
        } else {
          icon.dataset.lucide = iconName;
        }
      }
    });
    lucide.createIcons();
    sidebarStateInitialized = true;
  };
  let mobileOpen = false;
  setState(collapsed, mobileOpen);
  shell.querySelectorAll('[data-sidebar-toggle]').forEach((button) => {
    button.onclick = () => {
      if (mobileViewport.matches) {
        mobileOpen = !mobileOpen;
        setState(collapsed, mobileOpen);
        if (mobileOpen) sidebar.querySelector('.sidebar-toggle')?.focus();
        return;
      }
      collapsed = !collapsed;
      sidebarCollapsedPreference = collapsed;
      setState(collapsed, false);
      try {
        localStorage.setItem('lockin-sidebar-collapsed', String(collapsed));
      } catch (error) {
        console.warn('[LockIn] Could not save sidebar preference.', error);
      }
    };
  });
  const backdrop = shell.querySelector('[data-sidebar-close]');
  if (backdrop) backdrop.onclick = () => {
    mobileOpen = false;
    setState(collapsed, mobileOpen);
    shell.querySelector('.mobile-menu')?.focus();
  };
  sidebar.querySelectorAll('a[href]').forEach((link) => {
    link.onclick = () => {
      if (!mobileViewport.matches || !mobileOpen) return;
      mobileOpen = false;
      setState(collapsed, mobileOpen);
    };
  });
  sidebar.querySelectorAll('.nav-link, .space-link, .new-space').forEach((link) => {
    link.title = link.textContent.trim().replace(/\s+/g, ' ');
  });
  if (!document.body.dataset.sidebarResponsiveBound) {
    document.body.dataset.sidebarResponsiveBound = 'true';
    mobileViewport.addEventListener('change', () => bindSidebarToggle());
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const currentSidebar = document.querySelector('.sidebar.mobile-open');
      if (!currentSidebar) return;
      currentSidebar.querySelector('[data-sidebar-toggle]')?.click();
      document.querySelector('.mobile-menu')?.focus();
    });
  }
}

let lockUiDecorationObserver;
function bindLockUiComponentDecoration() {
  decorateLockUiComponents();
  if (lockUiDecorationObserver) return;
  lockUiDecorationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) decorateLockUiComponents(node);
    }));
  });
  lockUiDecorationObserver.observe(document.body, { childList: true, subtree: true });
}

function bindLockUiGallery() {
  if (!document.querySelector('.lui-gallery')) return;
  document.querySelectorAll('[data-lui-expand]').forEach((button) => {
    if (button.dataset.luiBound) return;
    button.dataset.luiBound = 'true';
    button.addEventListener('click', () => {
      const source = button.closest('[data-lui-component]')?.querySelector('.lui-source');
      if (!source) return;
      source.open = !source.open;
      button.setAttribute('aria-expanded', String(source.open));
      button.dataset.tooltip = source.open ? 'Collapse code' : 'Expand code';
      button.setAttribute('aria-label', source.open ? 'Collapse component code' : 'Expand component code');
      if (source.open) source.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
  document.querySelectorAll('[data-lui-copy]').forEach((button) => {
    if (button.dataset.luiBound) return;
    button.dataset.luiBound = 'true';
    button.addEventListener('click', async () => {
      const source = button.closest('[data-lui-component]')?.querySelector('.lui-source pre code')?.textContent?.trim();
      if (!source) {
        showLockUiStatus('No markup is available for this component.');
        return;
      }
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(source);
        else {
          const field = document.createElement('textarea');
          field.value = source;
          field.setAttribute('readonly', '');
          field.style.position = 'fixed';
          field.style.opacity = '0';
          document.body.appendChild(field);
          field.select();
          const copied = document.execCommand('copy');
          field.remove();
          if (!copied) throw new Error('Clipboard access is unavailable.');
        }
        showLockUiStatus('Markup copied.');
      } catch (error) {
        showLockUiStatus('Could not copy markup. Select and copy the expanded code instead.');
      }
    });
  });
  document.querySelectorAll('[data-lui-dialog-open], [data-lui-open-modal]').forEach((button) => {
    if (button.dataset.luiBound) return;
    button.dataset.luiBound = 'true';
    button.addEventListener('click', () => {
      const dialog = document.getElementById(button.dataset.luiDialogOpen || button.dataset.luiOpenModal);
      if (dialog instanceof HTMLDialogElement && !dialog.open) dialog.showModal();
    });
  });
  document.querySelectorAll('[data-lui-demo-dialog]').forEach((dialog) => {
    if (dialog.dataset.luiBound) return;
    dialog.dataset.luiBound = 'true';
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
  document.querySelectorAll('[data-lui-task-toggle]').forEach((button) => {
    if (button.dataset.luiBound) return;
    button.dataset.luiBound = 'true';
    button.addEventListener('click', () => {
      const row = button.closest('.lui-task');
      const done = row?.classList.toggle('is-done');
      button.innerHTML = `<i data-lucide="${done ? 'check-circle-2' : 'circle'}"></i>`;
      lucide.createIcons();
    });
  });
  document.querySelectorAll('.lui-gallery [data-lui-tab]').forEach((tab) => {
    if (tab.dataset.luiBound) return;
    tab.dataset.luiBound = 'true';
    tab.addEventListener('click', () => {
      tab.closest('[role="tablist"], .lui-tabs')?.querySelectorAll('[data-lui-tab]').forEach((other) => other.setAttribute('aria-selected', String(other === tab)));
    });
  });
  document.querySelectorAll('[data-lui-search-demo]').forEach((input) => {
    if (input.dataset.luiBound) return;
    input.dataset.luiBound = 'true';
    const results = input.closest('.lui-search-demo')?.querySelector('[data-lui-search-results]');
    const options = [...(results?.querySelectorAll('button') || [])];
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      let visible = 0;
      options.forEach((option) => {
        option.hidden = Boolean(query) && !option.textContent.toLocaleLowerCase().includes(query);
        if (!option.hidden) visible += 1;
      });
      if (results) results.hidden = !query;
      input.setAttribute('aria-expanded', String(Boolean(query && visible)));
    });
    options.forEach((option) => option.addEventListener('click', () => {
      input.value = option.textContent.trim().split('@')[0].trim();
      options.forEach((entry) => entry.setAttribute('aria-selected', String(entry === option)));
      if (results) results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }));
  });
  document.querySelectorAll('[data-lui-demo-copy-task]').forEach((button) => {
    if (button.dataset.luiBound) return;
    button.dataset.luiBound = 'true';
    button.addEventListener('click', () => showLockUiStatus('Demo only. The real action opens the copy-task dialog.'));
  });
}
