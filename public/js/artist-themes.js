(() => {
  const editor = document.querySelector('[data-artist-editor][data-theme]');
  if (!editor) return;

  const themeId = JSON.parse(editor.dataset.theme).id;
  const saveStatus = editor.querySelector('[data-save-status]');
  const preview = editor.querySelector('[data-theme-preview]');
  const previewWorkspace = editor.querySelector('.artist-studio-workspace');
  const previewToggle = editor.querySelector('[data-studio-preview]');
  const paletteInputs = Object.fromEntries([...editor.querySelectorAll('[data-palette]')].map((input) => [input.dataset.palette, input]));
  const styleInputs = Object.fromEntries([...editor.querySelectorAll('[data-element-style]')].map((input) => [input.dataset.elementStyle, input]));
  const styleStateButtons = [...editor.querySelectorAll('[data-style-state]')];
  const editorKey = `lockin-artist-theme-${themeId}`;
  const previewPages = {
    dashboard: '/dashboard',
    calendar: '/calendar',
    groups: '/dashboard?tab=groups',
    todo: '/todo?filter=pending',
    settings: '/settings',
    lockui: '/themes/lockui-preview'
  };
  const styleProperties = new Set(['color', 'background-color', 'border-color', 'opacity', 'filter', 'box-shadow']);
  const replaceAllClasses = /^(?:lui-[a-z0-9-]{1,36}|btn-[a-z0-9-]{1,36}|admin-panel|card|task-card|report-row|member-card|group-card|org-card|nav-link)$/;
  const selectorNames = {
    body: 'Page background',
    sidebar: 'Sidebar',
    topbar: 'Top bar',
    topbarButton: 'Top bar button',
    main: 'Main workspace',
    card: 'Cards and panels',
    button: 'Buttons',
    navigation: 'Navigation links',
    heading: 'Headings',
    content: 'Content area',
    footer: 'Footer',
    group: 'Group cards'
  };

  const initialTheme = JSON.parse(editor.dataset.theme);
  let theme = { ...initialTheme };
  let selected = 'body';
  let selectedReplaceAll = null;
  let selectedVariant = '';
  let selectedVariants = [];
  let styleState = 'normal';
  let selectedComputed = { normal: {}, hover: {} };
  let selectedImage = null;
  let saveTimer;
  let wallpaperTimer;
  let wallpaperChanged = false;
  let wallpaperData = '';
  let wallpaperUpload = Promise.resolve();
  let saveQueue = Promise.resolve();
  let copiedStyles = null;
  let previewMode = false;
  const undoStack = [];
  const redoStack = [];
  let lastHistoryState = null;
  let restoringHistory = false;

  function setStatus(message, isError = false) {
    saveStatus.textContent = message;
    saveStatus.setAttribute('aria-live', isError ? 'assertive' : 'polite');
  }

  function validColor(value) {
    return typeof value === 'string' && value.length <= 160 && !/[;{}<>\\]/.test(value)
      && !/\b(url|var|expression)\s*\(/i.test(value)
      && /^(#[\da-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|(?:linear|radial)-gradient\([\w\s#(),.%+-]+\))$/i.test(value.trim());
  }

  function validStyleValue(property, value) {
    if (['color', 'background-color', 'border-color'].includes(property)) return validColor(value);
    if (property === 'opacity') return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(String(value));
    if (property === 'filter') return /^blur\((?:0|[1-9]\d?(?:\.\d+)?)px\)$/.test(String(value));
    if (property === 'box-shadow') return /^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%+-]+\)))$/i.test(String(value).trim())
      && String(value).length <= 160 && !/[;{}<>\\]/.test(String(value));
    return false;
  }

  function snapshot() {
    return {
      ...theme,
      name: editor.querySelector('[data-theme-name]').value,
      description: editor.querySelector('[data-theme-description]').value,
      palette: Object.fromEntries(Object.entries(paletteInputs).map(([key, input]) => [key, input.value])),
      styles: JSON.parse(JSON.stringify(theme.styles || {})),
      wallpaperData,
      wallpaperChanged,
      wallpaperFit: editor.querySelector('[data-wallpaper-fit]').value,
      wallpaperShape: editor.querySelector('[data-wallpaper-shape]').value,
      wallpaperZoom: editor.querySelector('[data-wallpaper-zoom]').value
    };
  }

  function historySnapshot(state = snapshot()) {
    return {
      ...state,
      palette: { ...state.palette },
      styles: JSON.parse(JSON.stringify(state.styles || {}))
    };
  }

  function updateHistoryControls() {
    editor.querySelector('[data-undo]').disabled = !undoStack.length || restoringHistory;
    editor.querySelector('[data-redo]').disabled = !redoStack.length || restoringHistory;
  }

  function recordHistory() {
    if (!lastHistoryState || restoringHistory) return;
    undoStack.push(lastHistoryState);
    if (undoStack.length > 30) undoStack.shift();
    redoStack.length = 0;
    lastHistoryState = historySnapshot();
    updateHistoryControls();
  }

  function postPreviewState() {
    if (!preview.contentWindow) return;
    const {
      wallpaperData: _wallpaperData,
      wallpaperChanged: _wallpaperChanged,
      wallpaperFit: _wallpaperFit,
      wallpaperShape: _wallpaperShape,
      wallpaperZoom: _wallpaperZoom,
      ...themeState
    } = snapshot();
    preview.contentWindow.postMessage({ type: 'theme-state', theme: themeState }, '*');
    preview.contentWindow.postMessage({ type: 'theme-preview-mode', enabled: previewMode }, '*');
  }

  function setPreviewMode(enabled) {
    previewMode = Boolean(enabled);
    previewWorkspace.classList.toggle('is-previewing', previewMode);
    previewToggle.setAttribute('aria-pressed', String(previewMode));
    previewToggle.innerHTML = previewMode
      ? '<i data-lucide="pencil"></i> Edit theme'
      : '<i data-lucide="eye"></i> Preview';
    window.lucide?.createIcons({ nodes: [previewToggle] });
    postPreviewState();
  }

  function isSafePreviewPath(pathname) {
    const calendarMonth = pathname.match(/^\/calendar\/(\d{4})\/(\d{1,2})$/);
    if (calendarMonth) {
      const month = Number(calendarMonth[2]);
      return Number(calendarMonth[1]) >= 1 && month >= 1 && month <= 12;
    }
    return new Set([
      '/dashboard', '/calendar', '/groups', '/todo', '/settings',
      '/site-admin', '/themes/lockui-preview'
    ]).has(pathname)
      || /^\/group\/[a-z0-9_-]+(?:\/admin)?$/i.test(pathname)
      || /^\/org\/[a-z0-9_-]+(?:\/(?:course\/[a-z0-9_-]+(?:\/(?:task\/[a-z0-9_-]+\/breakout-groups|items\/new))?|breakout\/[a-z0-9_-]+|people(?:\/new)?|courses\/new|settings|admin(?:\/(?:mod|report|settings|share))?))?$/i.test(pathname);
  }

  function navigatePreviewFrame(path) {
    if (typeof path !== 'string' || path.length > 500) return;
    let destination;
    try {
      destination = new URL(path, window.location.origin);
    } catch {
      return;
    }
    if (destination.origin !== window.location.origin) return;
    const pathname = destination.pathname === '/' ? '/dashboard' : destination.pathname;
    if (!isSafePreviewPath(pathname)) return;
    const pageUrl = new URL(pathname, window.location.origin);
    if (pathname === '/dashboard' && ['overview', 'groups', 'moderate'].includes(destination.searchParams.get('tab'))) {
      pageUrl.searchParams.set('tab', destination.searchParams.get('tab'));
    }
    if (pathname === '/todo' && ['pending', 'completed', 'all'].includes(destination.searchParams.get('filter'))) {
      pageUrl.searchParams.set('filter', destination.searchParams.get('filter'));
    }
    pageUrl.searchParams.set('theme-edit', 'true');
    pageUrl.searchParams.set('theme-di', preview.dataset.previewToken);
    preview.src = `${pageUrl.pathname}${pageUrl.search}`;
  }

  function toColorInput(value, fallback) {
    if (/^#[\da-f]{6}$/i.test(value || '')) return value;
    const rgb = String(value || '').match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!rgb) return fallback;
    return `#${rgb.slice(1, 4).map((channel) => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('')}`;
  }

  function selectedStyleKey(state = styleState) {
    const variant = selectedVariant ? `:class:${selectedVariant}` : '';
    return `${selected}${variant}${state === 'hover' ? ':hover' : ''}`;
  }

  function renderInspector() {
    const properties = {
      ...(selectedComputed[styleState] || {}),
      ...(theme.styles?.[selectedStyleKey()] || {})
    };
    for (const [property, input] of Object.entries(styleInputs)) {
      if (property === 'opacity') input.value = properties[property] ?? '1';
      else if (property === 'filter') input.value = Number(String(properties[property] || 'blur(0px)').match(/[\d.]+/)?.[0] || 0);
      else {
        const fallback = property === 'color' ? '#172125' : '#ffffff';
        input.value = toColorInput(properties[property], fallback);
      }
    }
    editor.querySelector('[data-manual-css]').value = Object.entries(properties)
      .filter(([property]) => styleProperties.has(property))
      .map(([property, value]) => `${property}: ${value};`).join('\n');
    styleStateButtons.forEach((button) => {
      const active = button.dataset.styleState === styleState;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    editor.querySelectorAll('[data-style-variant]').forEach((button) => {
      const active = button.dataset.styleVariant === selectedVariant;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    });
    editor.querySelector('[data-style-state-hint]').textContent = styleState === 'hover'
      ? 'Hover styles are filled from the selected LockIn element.'
      : 'Default styles are filled from the selected LockIn element.';
  }

  function setSelectedElement(selector, computed = {}) {
    const dynamicElement = /^element:(?:(?:dashboard|calendar|groups|todo|lockui|settings|site-admin|org|course|admin|people|breakout|breakout-groups|new-item|new-course|people-new):(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15}|shared:[a-z][a-z0-9-]{0,40}:(?:root|(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15}))$/.test(selector);
    const replaceAll = computed.replaceAll;
    const replaceClasses = typeof replaceAll?.target === 'string' && replaceAll.target.length <= 180
      ? replaceAll.target.match(/^class:([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,3})$/)?.[1].split('.')
      : null;
    const validReplaceAll = replaceAll && replaceClasses
      && /^class:[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,3}$/.test(replaceAll.target)
      && replaceClasses.every((className) => replaceAllClasses.test(className))
      && new Set(replaceClasses).size === replaceClasses.length
      && Number.isInteger(replaceAll.count) && replaceAll.count > 0 && replaceAll.count <= 10000;
    if (!selectorNames[selector] && !dynamicElement && !validReplaceAll) return;
    selected = selector;
    selectedVariants = Array.isArray(computed.classes)
      ? [...new Set(computed.classes.filter((className) => typeof className === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(className)))]
      : [];
    selectedVariant = '';
    selectedReplaceAll = validReplaceAll
      ? { target: replaceAll.target, label: replaceClasses.join(' + '), count: replaceAll.count }
      : null;
    selectedComputed = { normal: computed.styles || {}, hover: computed.hoverStyles || {} };
    styleState = 'normal';
    const label = selectorNames[selector] || computed.label || 'Selected element';
    editor.querySelector('[data-selected-element]').textContent = selectedReplaceAll
      ? `${selectedReplaceAll.label} · ${selectedReplaceAll.count} matches`
      : label;
    editor.querySelector('[data-replace-all]').disabled = !selectedReplaceAll;
    editor.querySelector('[data-replace-hint]').textContent = selectedReplaceAll
      ? `${selectedReplaceAll.count} matching element${selectedReplaceAll.count === 1 ? '' : 's'} on this page. Changes stay on this element until you choose Apply to All.`
      : 'Click a LockIn component to enable shared styling.';
    const variants = editor.querySelector('[data-style-variants]');
    variants.replaceChildren(...selectedVariants.map((className) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.styleVariant = className;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = className;
      button.title = `Style this element when it has the ${className} class`;
      return button;
    }));
    variants.hidden = selectedVariants.length === 0;
    renderInspector();
  }

  function currentStylesFor(state = styleState) {
    const configured = theme.styles?.[selectedStyleKey(state)];
    const computed = selectedComputed[state] || {};
    const source = configured && Object.keys(configured).length ? configured : computed;
    return Object.fromEntries(Object.entries(source)
      .filter(([property, value]) => styleProperties.has(property) && validStyleValue(property, value)));
  }

  function replaceAllStyles() {
    if (!selectedReplaceAll) return;
    const baseKey = selectedReplaceAll.target;
    theme.styles ||= {};
    ['normal', 'hover'].forEach((state) => {
      const currentKey = selectedStyleKey(state);
      const targetKey = `${baseKey}${state === 'hover' ? ':hover' : ''}`;
      const currentStyle = theme.styles[currentKey];
      const source = currentStyle && Object.keys(currentStyle).length ? currentStyle : selectedComputed[state] || {};
      const current = Object.fromEntries(Object.entries(source)
        .filter(([property, value]) => styleProperties.has(property) && validStyleValue(property, value)));
      if (Object.keys(current).length) theme.styles[targetKey] = current;
      else delete theme.styles[targetKey];
      if (currentKey !== targetKey) delete theme.styles[currentKey];
    });
    selected = baseKey;
    selectedVariant = '';
    selectedVariants = [];
    setStatus(`Replace All is on for ${selectedReplaceAll.count} matching elements.`);
    renderInspector();
    queueSave();
  }

  async function copyStyles() {
    copiedStyles = currentStylesFor();
    const cssText = Object.entries(copiedStyles).map(([property, value]) => `${property}: ${value};`).join('\n');
    if (!cssText) {
      setStatus('This element has no supported CSS declarations to copy.', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(cssText);
      setStatus('CSS copied. Select another element and choose Paste CSS.');
    } catch (error) {
      setStatus(`CSS is ready to paste in this editor; clipboard access was unavailable: ${error.message}`, true);
    }
  }

  function pasteStyles() {
    if (!copiedStyles || !Object.keys(copiedStyles).length) {
      setStatus('Copy styling from an element before pasting.', true);
      return;
    }
    theme.styles ||= {};
    theme.styles[selectedStyleKey()] = { ...copiedStyles };
    setStatus('Copied CSS applied to the selected element.');
    renderInspector();
    queueSave();
  }

  function persistLocal() {
    try {
      localStorage.setItem(editorKey, JSON.stringify(snapshot()));
      setStatus('Saved on this device. Saving draft…');
      return true;
    } catch (error) {
      setStatus(`Could not save this device’s draft: ${error.message}`, true);
      return false;
    }
  }

  function saveDraft() {
    const current = snapshot();
    const {
      wallpaperData: _wallpaperData,
      wallpaperChanged: _wallpaperChanged,
      wallpaperFit: _wallpaperFit,
      wallpaperShape: _wallpaperShape,
      wallpaperZoom: _wallpaperZoom,
      ...serverDraft
    } = current;
    const save = async () => {
      try {
        const response = await fetch(`/artist/themes/${themeId}/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(serverDraft)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'The server could not save this draft.');
        theme = { ...theme, ...current };
        setStatus('Saved on this device and to your draft.');
        postPreviewState();
        return result.saved === true;
      } catch (error) {
        setStatus(`Device copy saved. Server save failed: ${error.message}`, true);
        return false;
      }
    };
    const pending = saveQueue.then(save, save);
    saveQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  function queueSave() {
    recordHistory();
    persistLocal();
    postPreviewState();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 700);
  }

  async function restoreHistoryState(state) {
    if (restoringHistory) return;
    restoringHistory = true;
    updateHistoryControls();
    clearTimeout(saveTimer);
    clearTimeout(wallpaperTimer);
    try {
      await wallpaperUpload;
      theme = {
        ...initialTheme,
        ...state,
        palette: { ...state.palette },
        styles: JSON.parse(JSON.stringify(state.styles || {}))
      };
      editor.querySelector('[data-theme-name]').value = state.name;
      editor.querySelector('[data-theme-description]').value = state.description;
      Object.entries(paletteInputs).forEach(([key, input]) => { input.value = state.palette[key]; });
      editor.querySelector('[data-wallpaper-fit]').value = state.wallpaperFit || 'cover';
      editor.querySelector('[data-wallpaper-shape]').value = state.wallpaperShape || '16:9';
      editor.querySelector('[data-wallpaper-zoom]').value = state.wallpaperZoom || '1';
      wallpaperData = state.wallpaperData || '';
      wallpaperChanged = Boolean(state.wallpaperChanged);
      selectedImage = null;
      const wallpaperSource = wallpaperData || theme.wallpaper;
      if (wallpaperSource) {
        const image = new Image();
        image.onload = () => {
          selectedImage = image;
          if (wallpaperData) {
            const canvas = editor.querySelector('[data-wallpaper-canvas]');
            canvas.width = image.width;
            canvas.height = image.height;
            canvas.getContext('2d').drawImage(image, 0, 0);
          } else {
            drawWallpaper(false);
          }
        };
        image.src = wallpaperSource;
      } else {
        const canvas = editor.querySelector('[data-wallpaper-canvas]');
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      }
      renderInspector();
      postPreviewState();
      persistLocal();
      if (wallpaperChanged) {
        wallpaperUpload = uploadWallpaper();
        if (!await wallpaperUpload) throw new Error('The restored wallpaper could not be uploaded.');
      }
      if (!await saveDraft()) throw new Error('The restored draft could not be saved to the server.');
      let recoveryCopyCleared = true;
      if (!undoStack.length && !redoStack.length) {
        try {
          localStorage.removeItem(editorKey);
        } catch (error) {
          recoveryCopyCleared = false;
          setStatus(`Draft restored, but the device recovery copy could not be cleared: ${error.message}`, true);
        }
      }
      if (recoveryCopyCleared) setStatus('Draft changes restored.');
    } catch (error) {
      setStatus(`Could not restore draft changes: ${error.message}`, true);
    } finally {
      lastHistoryState = historySnapshot();
      restoringHistory = false;
      updateHistoryControls();
    }
  }

  async function undo() {
    if (!undoStack.length || restoringHistory) return;
    redoStack.push(historySnapshot());
    const previous = undoStack.pop();
    updateHistoryControls();
    await restoreHistoryState(previous);
  }

  async function redo() {
    if (!redoStack.length || restoringHistory) return;
    undoStack.push(historySnapshot());
    const next = redoStack.pop();
    updateHistoryControls();
    await restoreHistoryState(next);
  }

  async function discardChanges() {
    if (!window.confirm('Discard all changes made in this studio session and restore the saved draft?')) return;
    undoStack.length = 0;
    redoStack.length = 0;
    const original = historySnapshot({
      ...initialTheme,
      name: initialTheme.name,
      description: initialTheme.description || '',
      palette: { ...initialTheme.palette },
      styles: JSON.parse(JSON.stringify(initialTheme.styles || {})),
      wallpaperData: '',
      wallpaperChanged: false,
      wallpaperFit: 'cover',
      wallpaperShape: '16:9',
      wallpaperZoom: '1'
    });
    await restoreHistoryState(original);
  }

  function updateColorPalette() {
    const parseHex = (value) => {
      const match = String(value).trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
      if (!match) return null;
      const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
      return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
    };
    const toHex = (rgb) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
    let background = parseHex(paletteInputs.background.value) || [40, 85, 90];
    if (selectedImage) {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 16;
      sampleCanvas.height = 16;
      const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
      sampleContext.drawImage(selectedImage, 0, 0, 16, 16);
      const pixels = sampleContext.getImageData(0, 0, 16, 16).data;
      const totals = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        const alpha = pixels[index + 3] / 255;
        for (let channel = 0; channel < 3; channel += 1) totals[channel] += pixels[index + channel] * alpha + 255 * (1 - alpha);
      }
      background = totals.map((total) => total / (pixels.length / 4));
    }
    const luminance = (rgb) => rgb.map((value) => { const channel = value / 255; return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4; }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const whiteContrast = 1.05 / (luminance(background) + .05);
    const blackContrast = (luminance(background) + .05) / .05;
    const dark = background.map((value) => value * .18);
    const light = background.map((value) => value + (255 - value) * .9);
    const surface = luminance(background) > .45 ? light : dark;
    const accent = [background[1], background[2], background[0]].map((value) => Math.min(255, value * .78 + 30));
    while ((1.05 / (luminance(accent) + .05)) < 4.5) {
      accent.forEach((value, index) => { accent[index] = value * .88; });
    }
    paletteInputs.text.value = whiteContrast >= blackContrast ? '#ffffff' : '#172125';
    paletteInputs.surface.value = toHex(surface);
    paletteInputs.accent.value = toHex(accent);
    const contrastText = (luminance(accent) + .05) / .05 >= 4.5 ? '#172125' : '#ffffff';
    const hoverTargets = new Set([
      'button', 'topbarButton', 'navigation', 'group', 'card',
      'class:lui-button', 'class:lui-icon-button', 'class:lui-menu-action',
      'class:lui-input', 'class:lui-select', 'class:lui-textarea',
      'class:lui-link', 'class:lui-task', 'class:lui-card', 'class:lui-panel',
      'class:lui-comment', 'class:lui-badge', 'class:lui-status', 'class:lui-alert'
    ]);
    Object.keys(theme.styles || {}).forEach((key) => {
      const base = key.endsWith(':hover') ? key.slice(0, -6) : key;
      if (base.startsWith('element:') || base.startsWith('class:')) hoverTargets.add(base);
    });
    if (selected.startsWith('element:') || selected.startsWith('class:')) hoverTargets.add(selectedStyleKey('normal'));
    hoverTargets.forEach((target) => {
      const key = `${target}:hover`;
      const existing = theme.styles?.[key] || {};
      const hoverStyle = ['button', 'topbarButton', 'navigation'].includes(target)
        || target.startsWith('element:')
        || /^class:.*(?:button|menu-action|icon-button|link)/i.test(target)
        ? { 'background-color': paletteInputs.accent.value, color: contrastText }
        : { 'border-color': paletteInputs.accent.value };
      theme.styles ||= {};
      theme.styles[key] = { ...existing, ...hoverStyle };
    });
    queueSave();
  }

  async function randomizeColorPalette() {
    clearTimeout(wallpaperTimer);
    await wallpaperUpload;
    const hue = Math.floor(Math.random() * 360);
    const saturation = 42 + Math.floor(Math.random() * 24);
    const lightness = Math.random() < 0.5
      ? 18 + Math.floor(Math.random() * 15)
      : 78 + Math.floor(Math.random() * 13);
    const channel = (n) => {
      const k = (n + hue / 30) % 12;
      const a = saturation / 100 * Math.min(lightness / 100, 1 - lightness / 100);
      return Math.round(255 * (lightness / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    paletteInputs.background.value = `#${[0, 8, 4].map((offset) => channel(offset).toString(16).padStart(2, '0')).join('')}`;
    selectedImage = null;
    theme.wallpaper = null;
    wallpaperData = '';
    wallpaperChanged = false;
    updateColorPalette();
    setStatus('Random palette created with readable text and contrast-checked accents.');
  }

  function drawWallpaper(saveForRecovery = true) {
    if (!selectedImage) return;
    const canvas = editor.querySelector('[data-wallpaper-canvas]');
    const context = canvas.getContext('2d');
    const shape = editor.querySelector('[data-wallpaper-shape]').value.split(':').map(Number);
    const width = 960;
    const height = Math.round(width * shape[1] / shape[0]);
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = validColor(paletteInputs.background.value) ? paletteInputs.background.value : '#f3f5f6';
    context.fillRect(0, 0, width, height);
    const fit = editor.querySelector('[data-wallpaper-fit]').value;
    const zoom = Number(editor.querySelector('[data-wallpaper-zoom]').value);
    const scale = (fit === 'cover' ? Math.max(width / selectedImage.width, height / selectedImage.height) : Math.min(width / selectedImage.width, height / selectedImage.height)) * zoom;
    const drawWidth = selectedImage.width * scale;
    const drawHeight = selectedImage.height * scale;
    context.drawImage(selectedImage, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    if (!saveForRecovery) return;
    wallpaperData = canvas.toDataURL('image/jpeg', .82);
    wallpaperChanged = true;
    recordHistory();
    editor.querySelector('[data-wallpaper-status]').textContent = 'Cropped artwork is ready to upload.';
    persistLocal();
  }

  async function uploadWallpaper() {
    if (!wallpaperData) return !wallpaperChanged;
    try {
      const response = await fetch(`/artist/themes/${themeId}/artwork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: wallpaperData })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Wallpaper upload failed.');
      theme.wallpaper = result.wallpaper;
      wallpaperChanged = false;
      localStorage.setItem(editorKey, JSON.stringify(snapshot()));
      editor.querySelector('[data-wallpaper-status]').textContent = 'Wallpaper saved to your theme.';
      postPreviewState();
      return true;
    } catch (error) {
      setStatus(`Device copy saved. Wallpaper upload failed: ${error.message}`, true);
      return false;
    }
  }

  function applyManualCss() {
    const text = editor.querySelector('[data-manual-css]').value;
    const properties = {};
    const declarations = text.split(/[;\n]/).map((part) => part.trim()).filter(Boolean);
    let invalid = false;
    declarations.forEach((declaration) => {
      const separator = declaration.indexOf(':');
      if (separator < 1) { invalid = true; return; }
      const property = declaration.slice(0, separator).trim().toLowerCase();
      const value = declaration.slice(separator + 1).trim();
      if (!styleProperties.has(property) || !validStyleValue(property, value)) { invalid = true; return; }
      properties[property] = value;
    });
    theme.styles ||= {};
    const key = selectedStyleKey();
    if (Object.keys(properties).length) theme.styles[key] = properties;
    else delete theme.styles[key];
    queueSave();
    if (invalid) setStatus('Unsupported declarations stay in the editor but are not applied.');
  }

  function applyLocalDraft() {
    let saved;
    try {
      const stored = localStorage.getItem(editorKey);
      saved = stored ? JSON.parse(stored) : null;
    } catch (error) {
      setStatus(`Saved device draft could not be read: ${error.message}`, true);
      return;
    }
    if (saved && typeof saved === 'object') {
      if (saved.name) editor.querySelector('[data-theme-name]').value = saved.name;
      if (saved.description) editor.querySelector('[data-theme-description]').value = saved.description;
      Object.entries(paletteInputs).forEach(([key, input]) => { if (typeof saved.palette?.[key] === 'string') input.value = saved.palette[key]; });
      if (saved.wallpaperFit) editor.querySelector('[data-wallpaper-fit]').value = saved.wallpaperFit;
      if (saved.wallpaperShape) editor.querySelector('[data-wallpaper-shape]').value = saved.wallpaperShape;
      if (saved.wallpaperZoom) editor.querySelector('[data-wallpaper-zoom]').value = saved.wallpaperZoom;
      theme = { ...theme, ...saved, styles: saved.styles || {} };
      wallpaperData = saved.wallpaperData || '';
      wallpaperChanged = Boolean(saved.wallpaperChanged || (wallpaperData && saved.wallpaper !== initialTheme.wallpaper));
    }
    if (wallpaperData) {
      const image = new Image();
      image.onload = () => { selectedImage = image; drawWallpaper(false); };
      image.src = wallpaperData;
    } else if (theme.wallpaper) {
      const image = new Image();
      image.onload = () => { selectedImage = image; drawWallpaper(false); };
      image.src = theme.wallpaper;
    }
  }

  function scheduleWallpaperUpload() {
    if (!wallpaperData) return;
    wallpaperChanged = true;
    clearTimeout(wallpaperTimer);
    wallpaperTimer = setTimeout(() => { wallpaperUpload = uploadWallpaper(); }, 600);
  }

  editor.querySelectorAll('[data-palette], [data-theme-name], [data-theme-description]').forEach((input) => input.addEventListener('input', queueSave));
  editor.querySelector('[data-ai-color]').addEventListener('click', updateColorPalette);
  editor.querySelector('[data-random-color]').addEventListener('click', randomizeColorPalette);
  editor.querySelector('[data-copy-styles]').addEventListener('click', copyStyles);
  editor.querySelector('[data-paste-styles]').addEventListener('click', pasteStyles);
  editor.querySelector('[data-replace-all]').addEventListener('click', replaceAllStyles);
  previewToggle.addEventListener('click', () => setPreviewMode(!previewMode));
  const historyMenu = editor.querySelector('.artist-studio-menu');
  const historyMenuTrigger = historyMenu.querySelector('summary');
  const historyMenuPanel = historyMenu.querySelector('.artist-studio-menu-panel');
  function positionHistoryMenu() {
    const bounds = historyMenuTrigger.getBoundingClientRect();
    const top = Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - historyMenuPanel.offsetHeight - 8));
    historyMenuPanel.style.top = `${top}px`;
    historyMenuPanel.style.right = `${Math.max(8, window.innerWidth - bounds.right)}px`;
  }
  historyMenu.addEventListener('toggle', () => {
    historyMenuTrigger.setAttribute('aria-expanded', String(historyMenu.open));
    if (historyMenu.open) positionHistoryMenu();
  });
  window.addEventListener('resize', () => { if (historyMenu.open) positionHistoryMenu(); });
  const undoShortcut = editor.querySelector('[data-undo-shortcut]');
  const redoShortcut = editor.querySelector('[data-redo-shortcut]');
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  undoShortcut.textContent = isMac ? '⌘ Z' : 'Ctrl Z';
  redoShortcut.textContent = isMac ? '⌘ ⇧ Z' : 'Ctrl Shift Z';
  editor.querySelector('[data-undo]').addEventListener('click', () => { historyMenu.open = false; undo(); });
  editor.querySelector('[data-redo]').addEventListener('click', () => { historyMenu.open = false; redo(); });
  editor.querySelector('[data-discard-changes]').addEventListener('click', () => { historyMenu.open = false; discardChanges(); });
  window.addEventListener('keydown', (event) => {
    if (!editor.contains(event.target) || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && event.shiftKey) {
      event.preventDefault();
      redo();
    } else if (key === 'z') {
      event.preventDefault();
      undo();
    } else if (key === 'y') {
      event.preventDefault();
      redo();
    }
  });
  editor.querySelector('[data-preview-page]').addEventListener('change', (event) => {
    const pageUrl = new URL(previewPages[event.target.value] || previewPages.dashboard, window.location.origin);
    pageUrl.searchParams.set('theme-edit', 'true');
    pageUrl.searchParams.set('theme-di', preview.dataset.previewToken);
    preview.src = `${pageUrl.pathname}${pageUrl.search}`;
  });
  preview.addEventListener('load', postPreviewState);
  window.addEventListener('message', (event) => {
    if (event.source !== preview.contentWindow || event.origin !== 'null') return;
    if (event.data?.type === 'theme-navigate') {
      navigatePreviewFrame(event.data.path);
      return;
    }
    if (event.data?.type === 'lockin-theme-ready') {
      postPreviewState();
      preview.contentWindow.postMessage({ type: 'theme-inspect', selector: selected }, '*');
      return;
    }
    if (event.data?.type === 'lockin-theme-element') setSelectedElement(event.data.selector, event.data);
  });

  Object.entries(styleInputs).forEach(([property, input]) => input.addEventListener('input', () => {
    theme.styles ||= {};
    const key = selectedStyleKey();
    theme.styles[key] ||= {};
    if (property === 'opacity') theme.styles[key][property] = input.value;
    else if (property === 'filter') theme.styles[key][property] = `blur(${input.value}px)`;
    else theme.styles[key][property] = input.value;
    renderInspector();
    queueSave();
  }));
  styleStateButtons.forEach((button) => button.addEventListener('click', () => {
    styleState = button.dataset.styleState;
    renderInspector();
  }));
  editor.querySelector('[data-style-variants]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-style-variant]');
    if (!button) return;
    selectedVariant = button.dataset.styleVariant;
    preview.contentWindow?.postMessage({
      type: 'theme-variant-state',
      selector: selected,
      className: selectedVariant
    }, '*');
    renderInspector();
  });
  editor.querySelector('[data-manual-css]').addEventListener('input', applyManualCss);
  editor.querySelector('[data-wallpaper-file]').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStatus('Choose an image smaller than 10 MB before resizing.', true);
      event.target.value = '';
      return;
    }
    const image = new Image();
    image.onload = () => {
      if (image.width * image.height > 40000000) {
        setStatus('That image is too large to safely resize in this browser.', true);
        URL.revokeObjectURL(image.src);
        return;
      }
      selectedImage = image;
      drawWallpaper();
      wallpaperChanged = true;
      wallpaperUpload = uploadWallpaper();
      URL.revokeObjectURL(image.src);
    };
    image.onerror = () => { setStatus('That image could not be opened.', true); URL.revokeObjectURL(image.src); };
    image.src = URL.createObjectURL(file);
  });
  ['[data-wallpaper-fit]', '[data-wallpaper-shape]', '[data-wallpaper-zoom]'].forEach((selector) => editor.querySelector(selector).addEventListener('input', () => {
    drawWallpaper();
    scheduleWallpaperUpload();
  }));
  editor.querySelector('[data-smart-resize]').addEventListener('click', () => {
    editor.querySelector('[data-wallpaper-fit]').value = 'cover';
    editor.querySelector('[data-wallpaper-zoom]').value = '1';
    drawWallpaper();
    wallpaperChanged = true;
    wallpaperUpload = uploadWallpaper();
  });
  editor.querySelector('[data-submit-theme]').addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      clearTimeout(saveTimer);
      if (!persistLocal()) throw new Error('This device could not save a recovery copy. Free some browser storage and try again.');
      if (!await saveDraft()) throw new Error('The latest changes could not be saved to the server. Your local recovery copy is safe; try submitting again.');
      clearTimeout(wallpaperTimer);
      if (wallpaperChanged) wallpaperUpload = uploadWallpaper();
      const wallpaperSaved = await wallpaperUpload;
      if (wallpaperChanged && !wallpaperSaved) throw new Error('The wallpaper could not be uploaded. Your device recovery copy is safe; try submitting again.');
      const response = await fetch(`/artist/themes/${themeId}/submit`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not submit this theme.');
      localStorage.removeItem(editorKey);
      window.location.href = '/artist?submitted=1';
    } catch (error) {
      setStatus(error.message, true);
      event.currentTarget.disabled = false;
    }
  });

  applyLocalDraft();
  lastHistoryState = historySnapshot();
  updateHistoryControls();
  setSelectedElement('body');
})();
