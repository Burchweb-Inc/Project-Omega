function bindInteractions() {
  bindLockUiComponentDecoration();
  bindSidebarToggle();
  bindPopupMenus();
  bindLockUiGallery();
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active')); document.querySelectorAll('.auth-form').forEach((form) => form.classList.add('hidden')); tab.classList.add('active'); document.getElementById(tab.dataset.tab).classList.remove('hidden'); }));
  bindLiveForms();
  bindTimezoneSearch();
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
  document.querySelectorAll('[data-inline-create]').forEach((button) => button.addEventListener('click', () => { const form = document.querySelector('.inline-create-form'); void animateTaskComposer(form, true); form?.querySelector('input[name="title"]')?.focus(); form?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  document.querySelectorAll('[data-inline-create-close]').forEach((button) => button.addEventListener('click', () => { void animateTaskComposer(button.closest('.inline-create-form'), false); document.querySelector('[data-inline-create]')?.focus?.(); }));
  document.querySelector('.inline-create-form')?.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); void animateTaskComposer(event.currentTarget, false); document.querySelector('[data-inline-create]')?.focus?.(); } });
  document.querySelectorAll('[data-course-tab]').forEach((tab) => tab.addEventListener('click', (event) => { event.preventDefault(); setCourseTab(tab.dataset.courseTab); }));
  document.querySelectorAll('[data-open]').forEach((button) => button.addEventListener('click', () => { const target = document.getElementById(button.dataset.open); if (target?.id === 'quick-task') void animateTaskComposer(target, true); else target?.classList.add('open'); target?.querySelector('[data-modal-autofocus], input[name="title"]')?.focus(); }));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => { const modal = button.closest('.modal-backdrop'); if (modal?.id === 'quick-task') { void animateTaskComposer(modal, false); document.querySelector('[data-open="quick-task"]')?.focus(); } else modal?.classList.remove('open'); if (modal?.matches('[data-task-sync-modal]')) document.querySelector('[data-open="task-sync-modal"]')?.focus(); }));
  document.querySelectorAll('.modal-backdrop').forEach((backdrop) => backdrop.addEventListener('click', (event) => { if (event.target === backdrop) { if (backdrop.id === 'quick-task') { void animateTaskComposer(backdrop, false); document.querySelector('[data-open="quick-task"]')?.focus(); } else backdrop.classList.remove('open'); if (backdrop.matches('[data-task-sync-modal]')) document.querySelector('[data-open="task-sync-modal"]')?.focus(); } }));
  const quickTaskModal = document.getElementById('quick-task');
  quickTaskModal?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    void animateTaskComposer(quickTaskModal, false);
    document.querySelector('[data-open="quick-task"]')?.focus();
  });
  const taskSyncModal = document.querySelector('[data-task-sync-modal]');
  if (taskSyncModal) {
    if (taskSyncModal.classList.contains('open')) taskSyncModal.querySelector('[data-modal-autofocus]')?.focus();
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !taskSyncModal.classList.contains('open')) return;
      taskSyncModal.classList.remove('open');
      document.querySelector('[data-open="task-sync-modal"]')?.focus();
    });
    taskSyncModal.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const controls = [...taskSyncModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  const taskSyncTip = document.querySelector('[data-task-sync-tip]');
  if (taskSyncTip) {
    try { taskSyncTip.hidden = localStorage.getItem('lockin-task-sync-tip-dismissed') === 'true'; } catch (error) {}
    taskSyncTip.querySelector('[data-dismiss-sync-tip]')?.addEventListener('click', () => {
      taskSyncTip.hidden = true;
      try { localStorage.setItem('lockin-task-sync-tip-dismissed', 'true'); } catch (error) {}
    });
  }
  document.querySelectorAll('.comment-menu .lui-menu-action.lui-menu-action-danger i[data-lucide="trash-2"]').forEach((icon) => icon.remove());
  bindNotificationGestures();
  document.querySelectorAll('[data-warning-close]').forEach((button) => button.addEventListener('click', () => { const modal = button.closest('[data-warning-modal]'); const warningId = modal?.dataset.warningId; modal?.remove(); if (warningId) fetch(`/notifications/${encodeURIComponent(warningId)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); }));
  document.querySelectorAll('[data-announcement-close]').forEach((button) => button.addEventListener('click', () => { const modal = button.closest('[data-announcement-modal]'); const announcementId = modal?.dataset.announcementId; modal?.remove(); if (announcementId) fetch(`/notifications/${encodeURIComponent(announcementId)}/read`, { method: 'POST', headers: { Accept: 'application/json', 'X-Live-Request': 'true' } }); }));
  document.querySelectorAll('.report-action-form select[name="action"]').forEach((select) => select.addEventListener('change', () => { const field = select.form.querySelector('.suspension-field'); if (field) field.hidden = select.value !== 'remove-moderate'; }));
  document.querySelectorAll('.report-action-form select[name="action"]').forEach((select) => select.dispatchEvent(new Event('change')));
  document.querySelectorAll('[data-user-search]').forEach((input) => {
    const results = input.closest('label')?.querySelector('[data-user-search-results]');
    let timer;
    let controller;
    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      controller?.abort();
      const query = input.value.trim();
      if (!query) {
        if (results) results.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        return;
      }
      timer = window.setTimeout(async () => {
        controller = new AbortController();
        try {
          const searchParams = new URLSearchParams({ q: query });
          if (input.dataset.userSearchGroup) searchParams.set('groupId', input.dataset.userSearchGroup);
          const response = await fetch(`/api/users/search?${searchParams}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`User search returned ${response.status}.`);
          if (!results || input.value.trim() !== query) return;
          const users = await response.json();
          results.innerHTML = users.map((candidate) => `<button class="lui-menu-action" type="button" role="option" aria-selected="false" data-username="${escapeHtml(candidate.username)}"><strong>${escapeHtml(candidate.name)}</strong><small>@${escapeHtml(candidate.username)}</small></button>`).join('') || '<span class="user-search-empty">No classmates found</span>';
          input.setAttribute('aria-expanded', 'true');
          results.querySelectorAll('[data-username]').forEach((option) => option.addEventListener('click', () => { input.value = option.dataset.username; results.innerHTML = ''; input.setAttribute('aria-expanded', 'false'); input.focus(); }));
        } catch (error) {
          if (error.name === 'AbortError') return;
          console.error('User search failed.', error);
          if (!results) return;
          results.innerHTML = '<span class="user-search-empty">Search is unavailable. Try again.</span>';
          input.setAttribute('aria-expanded', 'true');
        }
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
  syncTodoSummary(); bindPushNotifications();
  lucide.createIcons(); bindLinkComposers(); bindTodoControls(); bindDashboardInteractions(); bindCourseFeedControls(courseRoot()); bindCourseItemEditing(courseRoot()); bindCourseReorder(courseRoot()); bindTaskCopyModal(); bindTutorial(); connectLiveCourse(); connectLiveBreakout(); connectLiveTodo(); connectLiveNotifications(); connectLiveDashboard();
}

function bindTutorial() {
  const tutorial = document.querySelector('[data-tutorial]');
  if (!tutorial || localStorage.getItem('lockin-tutorial-v1') === 'done') return;
  const steps = [
    { selector: '[href="/dashboard"]', title: 'Your overview', copy: 'Start here to see what is happening across your groups and courses.' },
    { selector: '[href="/todo"]', title: 'Your personal Todo', copy: 'Keep private study tasks here. Course events can be added to this list without changing the class feed.' },
    { selector: '[href="/groups"]', title: 'Find your groups', copy: 'Open All groups to join spaces, see your courses, and manage group work.' },
    { selector: '.new-space', title: 'Create a group', copy: 'Make a new study space when you need a shared home for a class or project.' },
    { selector: '.topbar', title: 'You are ready', copy: 'Use the navigation to move around LockIn. You can reopen this tour from the account menu later.' }
  ];
  let index = 0;
  const stepLabel = tutorial.querySelector('[data-tutorial-step]'); const title = tutorial.querySelector('[data-tutorial-title]'); const copy = tutorial.querySelector('[data-tutorial-copy]'); const back = tutorial.querySelector('[data-tutorial-back]'); const next = tutorial.querySelector('[data-tutorial-next]');
  const finish = () => { localStorage.setItem('lockin-tutorial-v1', 'done'); tutorial.hidden = true; document.querySelectorAll('.tutorial-target').forEach((element) => element.classList.remove('tutorial-target')); };
  const render = () => { const step = steps[index]; document.querySelectorAll('.tutorial-target').forEach((element) => element.classList.remove('tutorial-target')); const target = document.querySelector(step.selector); target?.classList.add('tutorial-target'); stepLabel.textContent = `${index + 1} / ${steps.length}`; title.textContent = step.title; copy.textContent = step.copy; back.disabled = index === 0; next.textContent = index === steps.length - 1 ? 'Finish' : 'Next'; };
  back.addEventListener('click', () => { if (index > 0) { index -= 1; render(); } });
  next.addEventListener('click', () => { if (index === steps.length - 1) finish(); else { index += 1; render(); } });
  tutorial.querySelector('[data-tutorial-skip]')?.addEventListener('click', finish);
  tutorial.hidden = false; render(); lucide.createIcons();
}

window.addEventListener('live-error', (event) => showLiveError(event.detail || 'Action failed. Please try again.'));

function isInternalGetLink(link) { return link.origin === window.location.origin && link.pathname && !link.pathname.startsWith('/share/') && !link.hasAttribute('download') && link.target !== '_blank' && !link.dataset.noRouter; }
function setRouteProgress(fraction) {
  routeProgress.classList.remove('indeterminate');
  routeProgress.style.width = `${Math.min(1, Math.max(0, fraction)) * 100}%`;
}

async function readResponseWithProgress(response) {
  if (!response.body) return response.text();
  const total = Number(response.headers.get('Content-Length') || 0);
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const fraction = total > 0 ? received / total : 1 - Math.exp(-received / 262144);
    setRouteProgress(Math.min(0.99, fraction));
  }
  reader.releaseLock();
  let html = '';
  const decoder = new TextDecoder();
  for (const chunk of chunks) html += decoder.decode(chunk, { stream: true });
  html += decoder.decode();
  return html;
}

async function navigate(url, pushState = true) {
  routeProgress.classList.add('active', 'indeterminate');
  routeProgress.style.width = '';
  try {
    const response = await fetch(url, { headers: { 'X-Studyline-Navigation': 'true' } });
    if (!response.ok || response.redirected) throw new Error(`Navigation failed: ${response.status}`);
    const html = await readResponseWithProgress(response);
    setRouteProgress(1);
    const nextDocument = new DOMParser().parseFromString(html, 'text/html');
    const nextShell = nextDocument.querySelector('.app-shell');
    if (!nextShell) throw new Error('Navigation returned an incomplete page.');
    nextDocument.body.querySelectorAll('script').forEach((script) => script.remove());
    liveState.socket?.disconnect();
    liveState.notificationSocket?.disconnect();
    document.querySelector('.app-shell')?.replaceWith(nextShell);
    document.body.className = nextDocument.body.className;
    document.body.classList.add('is-navigating');
    document.body.appendChild(routeProgress);
    document.title = nextDocument.title;
    if (pushState) window.history.pushState({}, '', url);
    window.scrollTo({ top: 0, behavior: 'instant' });
    bindInteractions();
    const target = new URL(url, window.location.href);
    if (target.hash) requestAnimationFrame(() => document.getElementById(decodeURIComponent(target.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' }));
    requestAnimationFrame(() => document.body.classList.remove('is-navigating'));
  } catch (error) {
    window.location.assign(url);
  } finally {
    routeProgress.classList.remove('active', 'indeterminate');
  }
}
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
  if (!loader) return;
  const pageMedia = [...document.querySelectorAll('video')];
  pageMedia.forEach((video) => video.pause());
  let pageLoaded = document.readyState === 'complete';
  let finished = false;
  const reveal = () => {
    if (finished || !pageLoaded) return;
    finished = true;
    document.body.classList.add('page-ready');
    pageMedia.forEach((video) => {
      if (video.hasAttribute('autoplay')) video.play().catch(() => {});
    });
    document.dispatchEvent(new Event('page-reveal'));
    window.setTimeout(() => loader.remove(), 1150);
  };
  window.addEventListener('load', () => { pageLoaded = true; reveal(); }, { once: true });
  if (pageLoaded) reveal();
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

function bindLockUiCopy() {
  document.querySelectorAll('[data-copy-code-button]').forEach((button) => {
    if (button.dataset.copyBound === 'true') return;
    button.dataset.copyBound = 'true';
    button.addEventListener('click', async () => {
      const source = document.getElementById(button.dataset.copyCodeTarget);
      if (!source) return;
      const code = source.textContent.trim();
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
        else {
          const helper = document.createElement('textarea');
          helper.value = code;
          helper.setAttribute('readonly', '');
          helper.style.position = 'fixed';
          helper.style.opacity = '0';
          document.body.appendChild(helper);
          helper.select();
          document.execCommand('copy');
          helper.remove();
        }
        const label = button.querySelector('[data-copy-label]');
        const originalLabel = label?.textContent || 'Copy code';
        button.classList.add('is-copied');
        button.setAttribute('aria-label', 'Code copied');
        if (label) label.textContent = 'Copied';
        window.setTimeout(() => {
          button.classList.remove('is-copied');
          button.setAttribute('aria-label', 'Copy code');
          if (label) label.textContent = originalLabel;
        }, 1600);
      } catch (error) {
        button.setAttribute('aria-label', 'Copy failed');
      }
    });
  });
}

bindInteractions();
playAboutHero();
bindPageLoader();
bindLandingShader();
bindLockUiCopy();