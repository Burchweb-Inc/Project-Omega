(() => {
  if (window.parent === window || document.body.dataset.themePreview !== 'true') return;
  window.lucide?.createIcons();

  const selectors = {
    topbarButton: '.topbar .lui-icon-button, .topbar .avatar, .topbar .notification-menu > summary',
    button: '.lui-button',
    navigation: '.nav-link',
    heading: '.hero-heading, h1, h2',
    group: '.group-card, .org-card',
    card: '.admin-panel, .card, .task-card, .report-row, .member-card',
    sidebar: '.sidebar',
    topbar: '.topbar',
    main: '.main-content',
    content: '.content-wrap, .page-stage',
    footer: '.app-footer',
    body: document.body
  };
  const properties = ['color', 'background-color', 'border-color', 'opacity', 'filter', 'box-shadow'];
  const colorPattern = /^(#[\da-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|(?:linear|radial)-gradient\([\w\s#(),.%+-]+\))$/i;
  const replaceAllClasses = /^(?:lui-[a-z0-9-]{1,36}|btn-[a-z0-9-]{1,36}|admin-panel|card|task-card|report-row|member-card|group-card|org-card|nav-link)$/;
  const previewPages = new Set(['/dashboard', '/calendar', '/groups', '/todo', '/settings', '/site-admin', '/themes/lockui-preview']);
  const themePageKeys = new Set(['dashboard', 'calendar', 'groups', 'todo', 'lockui', 'settings', 'account-settings', 'site-admin', 'org', 'course', 'admin', 'people', 'breakout', 'breakout-groups', 'new-item', 'new-course', 'people-new']);
  const bodyPageKey = [...themePageKeys].find((page) => document.body.classList.contains(page));
  const pageKey = new URLSearchParams(window.location.search).get('tab') === 'groups'
    ? 'groups'
    : bodyPageKey === 'account-settings' ? 'settings' : bodyPageKey || 'dashboard';
  let previewMode = false;
  let variantElement = null;
  let variantClass = '';
  let variantWasPresent = false;

  function nodePath(element) {
    const path = [];
    let node = element;
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) return null;
      path.unshift([...parent.children].indexOf(node));
      node = parent;
    }
    return node === document.body ? path : null;
  }

  function annotateNode(element, path = nodePath(element)) {
    if (!path) return null;
    const nodeId = `${pageKey}-${path.join('-')}`;
    element.dataset.themeNode = nodeId;
    return nodeId;
  }

  function nodeStyleKey(element) {
    const path = nodePath(element);
    annotateNode(element, path);
    return path ? `element:${pageKey}:${path.join('.')}` : null;
  }

  function elementLabel(element) {
    const className = typeof element.className === 'string'
      ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')
      : '';
    const text = (element.innerText || element.getAttribute('aria-label') || element.getAttribute('title') || '')
      .trim().replace(/\s+/g, ' ').slice(0, 42);
    return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}${text ? ` · ${text}` : ''}`;
  }

  function replaceAllSelector(key) {
    const match = key.match(/^class:([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,3})$/);
    if (!match) return null;
    const classNames = match[1].split('.');
    if (!classNames.every((className) => replaceAllClasses.test(className))
        || new Set(classNames).size !== classNames.length) return null;
    return `.${classNames.join('.')}`;
  }

  function replaceAllGroup(element) {
    const classNames = [...element.classList].filter((className) => replaceAllClasses.test(className)).sort();
    if (!classNames.length || classNames.length > 4) return null;
    const target = `class:${classNames.join('.')}`;
    const selector = `.${classNames.join('.')}`;
    return {
      target,
      label: classNames.join(' + '),
      count: document.querySelectorAll(selector).length
    };
  }

  function elementClasses(element) {
    const ownClasses = [...element.classList].filter((className) => /^[a-z][a-z0-9_-]{0,63}$/.test(className));
    const relatedClasses = new Set(ownClasses);
    document.querySelectorAll('body *').forEach((candidate) => {
      candidate.classList.forEach((className) => {
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(className)) return;
        if (ownClasses.some((ownClass) => ownClass === className
            || ownClass.startsWith(`${className}-`)
            || className.startsWith(`${ownClass}-`))) {
          relatedClasses.add(className);
        }
      });
    });
    return [...relatedClasses].filter((className) => ![...relatedClasses]
      .some((candidate) => candidate.startsWith(`${className}-`)));
  }

  function elementForKey(key) {
    const match = key.match(/^element:(dashboard|calendar|groups|todo|lockui|settings|site-admin|org|course|admin|people|breakout|breakout-groups|new-item|new-course|people-new):((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15})$/);
    if (!match || match[1] !== pageKey) return null;
    return match[2].split('.').reduce((node, index) => node?.children[Number(index)], document.body) || null;
  }

  function clearVariantClass() {
    if (variantElement && variantClass && !variantWasPresent) variantElement.classList.remove(variantClass);
    variantElement = null;
    variantClass = '';
    variantWasPresent = false;
  }

  function setVariantClass(key, className) {
    clearVariantClass();
    const element = elementForKey(key);
    if (!element || typeof className !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(className)) return;
    variantElement = element;
    variantClass = className;
    variantWasPresent = element.classList.contains(className);
    if (!variantWasPresent) element.classList.add(className);
  }

  function safeValue(property, value) {
    if (typeof value !== 'string' || value.length > 160 || /[;{}<>\\]/.test(value) || /\b(url|var|expression)\s*\(/i.test(value)) return false;
    if (['color', 'background-color', 'border-color'].includes(property)) return colorPattern.test(value.trim());
    if (property === 'opacity') return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(value);
    if (property === 'filter') return /^blur\((?:0|[1-9]\d?(?:\.\d+)?)px\)$/.test(value);
    if (property === 'box-shadow') return /^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%+-]+\)))$/i.test(value.trim());
    return false;
  }

  function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    document.querySelectorAll('body *').forEach((element) => annotateNode(element));
    const palette = theme.palette || {};
    let hoverCss = '';
    let customCss = '';
    if (typeof palette.background === 'string' && colorPattern.test(palette.background)) {
      document.documentElement.style.setProperty('--paper', palette.background);
      if (/^(?:linear|radial)-gradient\(/i.test(palette.background)) document.body.style.background = palette.background;
      else document.body.style.backgroundColor = palette.background;
    }
    if (typeof palette.text === 'string' && colorPattern.test(palette.text)) {
      document.documentElement.style.setProperty('--ink', palette.text);
      document.documentElement.style.setProperty('--ink-soft', palette.text);
      document.documentElement.style.setProperty('--muted', palette.text);
      document.body.style.color = palette.text;
    }
    if (typeof palette.surface === 'string' && colorPattern.test(palette.surface)) {
      document.documentElement.style.setProperty('--white', palette.surface);
      document.documentElement.style.setProperty('--mint', palette.surface);
    }
    if (typeof palette.accent === 'string' && colorPattern.test(palette.accent)) {
      document.documentElement.style.setProperty('--blue', palette.accent);
      document.documentElement.style.setProperty('--coral', palette.accent);
      document.documentElement.style.setProperty('--navy', palette.accent);
      document.documentElement.style.setProperty('--gold', palette.accent);
      document.documentElement.style.setProperty('--line', palette.accent);
    }
    if (typeof theme.wallpaper === 'string' && /^\/media\/wallpapers\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(theme.wallpaper)) {
      document.body.style.backgroundImage = `url("${theme.wallpaper}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
      document.body.style.backgroundSize = '';
      document.body.style.backgroundAttachment = '';
    }
    Object.entries(theme.styles || {}).forEach(([key, declarations]) => {
      const isHover = key.endsWith(':hover');
      const baseKey = isHover ? key.slice(0, -6) : key;
      if (baseKey.length > 180) return;
      const nodeMatch = baseKey.match(/^element:(dashboard|calendar|groups|todo|lockui|settings|site-admin|org|course|admin|people|breakout|breakout-groups|new-item|new-course|people-new):((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15})(?::class:([a-z][a-z0-9_-]{0,63}))?$/);
      const classSelector = replaceAllSelector(baseKey);
      const selector = nodeMatch
        ? `[data-theme-node="${nodeMatch[1]}-${nodeMatch[2].replaceAll('.', '-')}"]${nodeMatch[3] ? `.${nodeMatch[3]}` : ''}`
        : classSelector
          ? classSelector
          : selectors[baseKey];
      if (!selector || !declarations || typeof declarations !== 'object') return;
      const styleSelector = isHover
        ? selector.split(',').map((part) => `${part.trim()}:hover`).join(', ')
        : selector;
      const safeDeclarations = [];
      Object.entries(declarations).forEach(([property, value]) => {
        if (properties.includes(property) && safeValue(property, value)) {
          const cssProperty = property === 'background-color' && /^(?:linear|radial)-gradient\(/i.test(value) ? 'background' : property;
          safeDeclarations.push(`${cssProperty}:${value} !important`);
        }
      });
      if (safeDeclarations.length) {
        if (isHover) hoverCss += `${styleSelector}{${safeDeclarations.join(';')}}`;
        else customCss += `${styleSelector}{${safeDeclarations.join(';')}}`;
      }
    });
    const customStyle = document.getElementById('lockin-theme-custom-styles') || document.createElement('style');
    customStyle.id = 'lockin-theme-custom-styles';
    customStyle.textContent = customCss;
    customStyle.remove();
    document.head.append(customStyle);
    const hoverStyle = document.getElementById('lockin-theme-hover-styles') || document.createElement('style');
    hoverStyle.id = 'lockin-theme-hover-styles';
    hoverStyle.textContent = hoverCss;
    hoverStyle.remove();
    document.head.append(hoverStyle);
  }

  function closestTarget(target) {
    const element = target instanceof Element ? target : target.parentElement;
    if (!element || !document.body.contains(element)) return null;
    if (element === document.body) return { key: 'body', element, label: 'Page background' };
    const key = nodeStyleKey(element);
    return key ? { key, element, label: elementLabel(element), group: replaceAllGroup(element) } : null;
  }

  function computedProperties(element) {
    const style = window.getComputedStyle(element);
    return Object.fromEntries(properties.map((property) => {
      const value = style.getPropertyValue(property).trim();
      return [property, value];
    }).filter(([, value]) => value && value !== 'none'));
  }

  function computedHoverProperties(element) {
    const result = {};
    const probeClass = 'lockin-theme-hover-probe';
    element.classList.add(probeClass);
    const inspectRules = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) {
          inspectRules(rule.cssRules);
          continue;
        }
        if (!rule.selectorText || !rule.style) continue;
        const selectorsWithHover = rule.selectorText.split(',').map((selector) => selector.trim()).filter((selector) => selector.includes(':hover'));
        if (!selectorsWithHover.some((selector) => {
          try {
            return element.matches(selector.replace(/:hover\b/g, `.${probeClass}`));
          } catch {
            return false;
          }
        })) continue;
        properties.forEach((property) => {
          let value = rule.style.getPropertyValue(property).trim();
          if (property === 'background-color' && !value) value = rule.style.getPropertyValue('background').trim();
          const variable = value.match(/^var\((--[\w-]+)\)$/);
          if (variable) value = window.getComputedStyle(element).getPropertyValue(variable[1]).trim();
          if (value && safeValue(property, value)) result[property] = value;
        });
      }
    };
    for (const sheet of document.styleSheets) {
      if (sheet.href && new URL(sheet.href).origin !== window.location.origin) continue;
      try {
        inspectRules(sheet.cssRules);
      } catch {
        continue;
      }
    }
    element.classList.remove(probeClass);
    return result;
  }

  function showSelection(target) {
    clearVariantClass();
    document.querySelectorAll('[data-theme-selected]').forEach((element) => delete element.dataset.themeSelected);
    target.element.dataset.themeSelected = 'true';
    const payload = {
      type: 'lockin-theme-element',
      selector: target.key,
      label: target.label,
      replaceAll: target.group || null,
      styles: computedProperties(target.element),
      hoverStyles: computedHoverProperties(target.element),
      classes: elementClasses(target.element)
    };
    window.parent.postMessage(payload, '*');
  }

  function inspectTarget(key) {
    const classSelector = replaceAllSelector(key);
    if (classSelector) {
      const element = document.querySelector(classSelector);
      if (element) showSelection({ key: nodeStyleKey(element), element, label: elementLabel(element), group: replaceAllGroup(element) });
      return;
    }
    const match = key.match(/^element:(dashboard|calendar|groups|todo|lockui|settings|site-admin|org|course|admin|people|breakout|breakout-groups|new-item|new-course|people-new):((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15})$/);
    if (match) {
      if (match[1] !== pageKey) return;
      const element = match[2].split('.').reduce((node, index) => node?.children[Number(index)], document.body);
      if (element) showSelection({ key, element, label: elementLabel(element), group: replaceAllGroup(element) });
      return;
    }
    const selector = selectors[key];
    if (!selector) return;
    const element = selector === document.body ? document.body : document.querySelector(selector);
    if (element) showSelection({ key, element, label: elementLabel(element), group: replaceAllGroup(element) });
  }

  function setPreviewMode(enabled) {
    previewMode = enabled === true;
    document.querySelectorAll('[data-theme-hovered], [data-theme-selected]').forEach((element) => {
      delete element.dataset.themeHovered;
      delete element.dataset.themeSelected;
    });
  }

  function isSafePreviewPath(pathname) {
    const calendarMonth = pathname.match(/^\/calendar\/(\d{4})\/(\d{1,2})$/);
    if (calendarMonth) {
      const year = Number(calendarMonth[1]);
      const month = Number(calendarMonth[2]);
      return year >= 1 && month >= 1 && month <= 12;
    }
    return previewPages.has(pathname)
      || /^\/group\/[a-z0-9_-]+(?:\/admin)?$/i.test(pathname)
      || /^\/org\/[a-z0-9_-]+(?:\/(?:course\/[a-z0-9_-]+(?:\/(?:task\/[a-z0-9_-]+\/breakout-groups|items\/new))?|breakout\/[a-z0-9_-]+|people(?:\/new)?|courses\/new|settings|admin(?:\/(?:mod|report|settings|share))?))?$/i.test(pathname);
  }

  function navigatePreview(anchor) {
    let destination;
    try {
      destination = new URL(anchor.href, window.location.href);
    } catch {
      return;
    }
    if (destination.origin !== window.location.origin) return;
    const pathname = destination.pathname === '/' ? '/dashboard' : destination.pathname;
    if (!isSafePreviewPath(pathname)) return;
    const previewUrl = new URL(pathname, window.location.origin);
    if (destination.pathname === '/dashboard' && ['overview', 'groups', 'moderate'].includes(destination.searchParams.get('tab'))) {
      previewUrl.searchParams.set('tab', destination.searchParams.get('tab'));
    }
    if (destination.pathname === '/todo' && ['pending', 'completed', 'all'].includes(destination.searchParams.get('filter'))) {
      previewUrl.searchParams.set('filter', destination.searchParams.get('filter'));
    }
    window.parent.postMessage({
      type: 'theme-navigate',
      path: `${previewUrl.pathname}${previewUrl.search}`
    }, '*');
  }

  document.querySelectorAll('body *').forEach((element) => {
    annotateNode(element);
  });

  document.addEventListener('pointerover', (event) => {
    if (previewMode) return;
    const target = closestTarget(event.target);
    document.querySelectorAll('[data-theme-hovered]').forEach((element) => delete element.dataset.themeHovered);
    if (target) target.element.dataset.themeHovered = 'true';
  }, true);

  document.addEventListener('pointerout', (event) => {
    if (previewMode) return;
    const target = closestTarget(event.target);
    if (target && !target.element.contains(event.relatedTarget)) delete target.element.dataset.themeHovered;
  }, true);

  document.addEventListener('click', (event) => {
    if (event.shiftKey) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (anchor) {
        event.preventDefault();
        event.stopImmediatePropagation();
        navigatePreview(anchor);
        return;
      }
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (button && button.type === 'button' && !button.form) return;
    }
    if (previewMode) {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigatePreview(anchor);
      return;
    }
    const target = closestTarget(event.target);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target) showSelection(target);
  }, true);

  document.addEventListener('submit', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    if (event.data?.type === 'theme-state') applyTheme(event.data.theme);
    if (event.data?.type === 'theme-inspect') inspectTarget(event.data.selector);
    if (event.data?.type === 'theme-preview-mode') setPreviewMode(event.data.enabled);
    if (event.data?.type === 'theme-variant-state') setVariantClass(event.data.selector, event.data.className);
  });

  const selectionStyle = document.createElement('style');
  selectionStyle.textContent = `
    [data-theme-hovered], .lockin-theme-hover-probe {
      outline: 2px solid #e86f51 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    [data-theme-selected] {
      outline: 2px solid #2c6e9f !important;
      outline-offset: 3px !important;
    }
  `;
  document.head.append(selectionStyle);
  window.parent.postMessage({ type: 'lockin-theme-ready' }, '*');
})();
