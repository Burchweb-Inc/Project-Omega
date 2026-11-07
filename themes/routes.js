const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const SELECTORS = {
  body: 'body',
  sidebar: '.sidebar',
  topbar: '.topbar',
  main: '.main-content',
  card: '.admin-panel, .card, .task-card, .report-row, .member-card',
  button: '.lui-button',
  topbarButton: '.topbar .lui-icon-button, .topbar .avatar, .topbar .notification-menu > summary',
  navigation: '.nav-link',
  heading: '.hero-heading, h1, h2',
  content: '.content-wrap, .page-stage',
  footer: '.app-footer',
  group: '.group-card, .org-card'
};
const COLOR_PROPERTIES = new Set(['color', 'background-color', 'border-color']);
const STYLE_PROPERTIES = new Set([...COLOR_PROPERTIES, 'opacity', 'filter', 'box-shadow']);
const REPLACE_ALL_CLASSES = /^(?:lui-[a-z0-9-]{1,36}|btn-[a-z0-9-]{1,36}|admin-panel|card|task-card|report-row|member-card|group-card|org-card|nav-link)$/;
const PREVIEW_PAGES = new Set(['/dashboard', '/calendar', '/groups', '/todo', '/settings', '/site-admin', '/themes/lockui-preview', '/themes/active.css']);

function isAllowedPreviewPage(pathname) {
  const calendarMonth = pathname.match(/^\/calendar\/(\d{4})\/(\d{1,2})$/);
  if (calendarMonth) {
    const year = Number(calendarMonth[1]);
    const month = Number(calendarMonth[2]);
    return year >= 1 && month >= 1 && month <= 12;
  }
  return PREVIEW_PAGES.has(pathname)
    || /^\/group\/[a-z0-9_-]+(?:\/admin)?$/i.test(pathname)
    || /^\/org\/[a-z0-9_-]+(?:\/(?:course\/[a-z0-9_-]+(?:\/(?:task\/[a-z0-9_-]+\/breakout-groups|items\/new))?|breakout\/[a-z0-9_-]+|people(?:\/new)?|courses\/new|settings|admin(?:\/(?:mod|report|settings|share))?))?$/i.test(pathname);
}

function styleTarget(key) {
  const isHover = key.endsWith(':hover');
  const target = isHover ? key.slice(0, -6) : key;
  if (target.length > 180) return null;
  if (Object.hasOwn(SELECTORS, target)) return { selector: SELECTORS[target], isHover };
  const classMatch = target.match(/^class:([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){0,3})$/);
  if (classMatch) {
    const classes = classMatch[1].split('.');
    if (classes.every((className) => REPLACE_ALL_CLASSES.test(className))
        && new Set(classes).size === classes.length) {
      return { selector: `.${classes.join('.')}`, isHover };
    }
    return null;
  }
  const match = target.match(/^element:(dashboard|calendar|groups|todo|lockui|settings|site-admin|org|course|admin|people|breakout|breakout-groups|new-item|new-course|people-new):((?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,15})(?::class:([a-z][a-z0-9_-]{0,63}))?$/);
  if (!match) return null;
  const nodeId = `${match[1]}-${match[2].replaceAll('.', '-')}`;
  return { selector: `[data-theme-node="${nodeId}"]${match[3] ? `.${match[3]}` : ''}`, isHover };
}

function selectorForThemeStyle(key) {
  const target = styleTarget(key);
  if (!target) return '';
  return target.selector.split(',').map((part) => `${part.trim()}${target.isHover ? ':hover' : ''}`).join(', ');
}

function validColor(value) {
  return typeof value === 'string'
    && value.length <= 160
    && !/[;{}<>\\]/.test(value)
    && !/\b(url|var|expression)\s*\(/i.test(value)
    && /^(#[\da-f]{3,8}|[a-z]{3,20}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+-]+\)|(?:linear|radial)-gradient\([\w\s#(),.%+-]+\))$/i.test(value.trim());
}

function validStyleValue(property, value) {
  if (COLOR_PROPERTIES.has(property)) return validColor(value);
  if (property === 'opacity') return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(String(value));
  if (property === 'filter') return /^blur\((?:0|[1-9]\d?(?:\.\d+)?)px\)$/.test(String(value));
  if (property === 'box-shadow') {
    return typeof value === 'string' && value.length <= 160 && !/[;{}<>\\]/.test(value)
      && !/\b(url|var|expression)\s*\(/i.test(value)
      && /^(?:none|(?:-?\d+(?:\.\d+)?px\s+){2,4}(?:#[\da-f]{3,8}|[a-z]{3,20}|rgba?\([\d\s.,%+-]+\)))$/i.test(value.trim());
  }
  return false;
}

function normalizeStyles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  Object.entries(value).forEach(([selector, declarations]) => {
    if (!styleTarget(selector) || !declarations || typeof declarations !== 'object' || Array.isArray(declarations)) return;
    const clean = {};
    Object.entries(declarations).forEach(([property, styleValue]) => {
      if (STYLE_PROPERTIES.has(property) && validStyleValue(property, styleValue)) clean[property] = String(styleValue).trim();
    });
    if (Object.keys(clean).length) result[selector] = clean;
  });
  return result;
}

function cssForTheme(theme) {
  if (!theme) return '';
  const palette = theme.palette || {};
  const declarations = [];
  if (validColor(palette.background)) {
    declarations.push(`--paper:${palette.background}`);
    declarations.push(`${/^(?:linear|radial)-gradient\(/i.test(palette.background) ? 'background' : 'background-color'}:${palette.background} !important`);
  }
  if (validColor(palette.text)) {
    declarations.push(`--ink:${palette.text}`, `--ink-soft:${palette.text}`, `--muted:${palette.text}`, `color:${palette.text} !important`);
  }
  if (validColor(palette.surface)) declarations.push(`--white:${palette.surface}`, `--mint:${palette.surface}`);
  if (validColor(palette.accent)) {
    declarations.push(`--blue:${palette.accent}`, `--coral:${palette.accent}`, `--navy:${palette.accent}`, `--gold:${palette.accent}`, `--line:${palette.accent}`);
  }
  const rules = declarations.length ? `:root{${declarations.filter((declaration) => declaration.startsWith('--')).join(';')}}body{${declarations.filter((declaration) => !declaration.startsWith('--')).join(';')}}` : '';
  const wallpaper = typeof theme.wallpaper === 'string' && /^\/media\/wallpapers\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(theme.wallpaper)
    ? `body{background-image:url("${theme.wallpaper}") !important;background-size:cover !important;background-attachment:fixed !important}`
    : '';
  const customized = normalizeStyles(theme.styles);
  const styles = Object.entries(customized).map(([selector, properties]) => {
    const declarationsForElement = Object.entries(properties).map(([property, value]) => {
      const cssProperty = property === 'background-color' && /^(?:linear|radial)-gradient\(/i.test(value) ? 'background' : property;
      return `${cssProperty}:${value} !important`;
    }).join(';');
    return `${selectorForThemeStyle(selector)}{${declarationsForElement}}`;
  }).join('');
  return `${rules}${wallpaper}${styles}`;
}

function marketplacePreview(theme) {
  const css = cssForTheme(theme);
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    *{box-sizing:border-box}body{margin:0;padding:10px;background:#f3f5f6;color:#172125;font:14px/1.5 Arial,sans-serif}
    .market-shell{display:grid;grid-template-columns:150px minmax(0,1fr);min-height:390px;overflow:hidden;border:1px solid #d5dcdd;border-radius:12px;background:transparent}
    .sidebar{grid-row:1/3;min-height:390px;padding:18px 12px;background:var(--mint,#e9eeeb)}
    .sidebar strong{display:block;margin:4px 8px 18px;font-size:15px}.nav-link{display:block;margin:3px 0;padding:8px;color:#315b60;text-decoration:none;border-radius:6px}
    .topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #d5dcdd;background:var(--white,#fff)}
    .topbar .lui-icon-button{border:1px solid #d5dcdd;border-radius:8px;background:var(--white,#fff);padding:6px 10px;color:var(--ink,#172125)}
    .main-content{min-width:0;padding:24px}.hero-heading{margin:0;font-size:23px}
    .market-welcome{margin:4px 0 18px;color:#667477}.market-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .card,.task-card{margin:12px 0;padding:14px;border:1px solid #d5dcdd;border-radius:9px;background:var(--white,#fff)}
    .market-stat{padding:10px;border:1px solid #d5dcdd;border-radius:8px;background:var(--white,#fff)}.market-stat strong{display:block;font-size:18px}
    .lui-button{padding:8px 12px;border:0;border-radius:6px;background:var(--blue,#315b60);color:var(--white,#fff)}
    .market-progress{height:6px;margin-top:8px;border-radius:9px;background:var(--mint,#e9eeeb)}.market-progress span{display:block;width:68%;height:100%;border-radius:inherit;background:var(--blue,#315b60)}
    @media(max-width:520px){.market-shell{grid-template-columns:88px minmax(0,1fr)}.sidebar{padding:14px 6px}.nav-link{font-size:11px;padding:7px 4px}.main-content{padding:16px}.market-stats{grid-template-columns:1fr}}
    ${css}
  </style><body class="dashboard"><div class="market-shell"><aside class="sidebar"><strong>LockIn</strong><a class="nav-link">Overview</a><a class="nav-link">Calendar</a><a class="nav-link">Groups</a><a class="nav-link">Tasks</a></aside><header class="topbar"><span>My workspace</span><button class="lui-icon-button" type="button" aria-label="Notifications">Notifications</button></header><main class="main-content"><h1 class="hero-heading">Good afternoon.</h1><p class="market-welcome">A clear view of what is next.</p><div class="market-stats"><div class="market-stat"><span>Focus time</span><strong>2h 40m</strong></div><div class="market-stat"><span>Tasks done</span><strong>8 of 12</strong></div><div class="market-stat"><span>Next class</span><strong>10:30</strong></div></div><article class="card"><h2>Today</h2><p>Review your next task.</p><div class="market-progress"><span></span></div><button class="lui-button" type="button">Open task</button></article><article class="task-card"><strong>Study session</strong><p>Biology · Chapter 4</p></article></main></div><script>document.querySelectorAll('body *').forEach(element=>{const path=[];let node=element;while(node&&node!==document.body){const parent=node.parentElement;if(!parent)break;path.unshift([...parent.children].indexOf(node));node=parent}if(node===document.body)element.dataset.themeNode='dashboard-'+path.join('-')})</script></body></html>`;
}

function publishedTheme(theme) {
  if (!theme) return null;
  if (theme.status === 'approved' || !theme.publishedVersion) return theme;
  return { ...theme, ...theme.publishedVersion, id: theme.id, artistId: theme.artistId, status: 'approved' };
}

function publishedSnapshot(theme) {
  return {
    name: theme.name,
    description: theme.description,
    wallpaper: theme.wallpaper,
    palette: theme.palette,
    styles: theme.styles
  };
}

function safeThemePayload(input, previous = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const name = String(input.name ?? previous.name ?? '').trim();
  const description = String(input.description ?? previous.description ?? '').trim();
  const wallpaperValue = Object.hasOwn(input, 'wallpaper') ? input.wallpaper : previous.wallpaper;
  const wallpaper = typeof wallpaperValue === 'string'
      && /^\/media\/wallpapers\/[a-z0-9-]+\.(?:png|jpe?g|webp)$/i.test(wallpaperValue)
    ? wallpaperValue
    : wallpaperValue == null || wallpaperValue === '' ? '' : null;
  const background = String(input.palette?.background ?? previous.palette?.background ?? '#f3f5f6').trim();
  const text = String(input.palette?.text ?? previous.palette?.text ?? '#172125').trim();
  const surface = String(input.palette?.surface ?? previous.palette?.surface ?? '#ffffff').trim();
  const accent = String(input.palette?.accent ?? previous.palette?.accent ?? '#294e58').trim();
  if (!name || name.length > 60 || description.length > 240 || wallpaper === null
      || !validColor(background) || !validColor(text) || !validColor(surface) || !validColor(accent)) return null;
  return {
    name,
    description,
    wallpaper,
    palette: { background, text, surface, accent },
    styles: normalizeStyles(input.styles)
  };
}

function registerThemeRoutes({ app, themeModel, requireUser, requireSiteAdmin, wallpaperDir, render, persistUser }) {
  const json = express.json({ limit: '200kb' });
  const previewTokens = new Map();
  const previewCookie = 'theme-di';
  const previewCookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 60 * 1000
  };
  function issuePreviewToken(user, theme) {
    const now = Date.now();
    for (const [token, entry] of previewTokens) {
      if (entry.expiresAt <= now) previewTokens.delete(token);
    }
    if (previewTokens.size >= 1000) {
      const oldest = [...previewTokens.entries()].sort((left, right) => left[1].expiresAt - right[1].expiresAt)[0];
      if (oldest) previewTokens.delete(oldest[0]);
    }
    const token = crypto.randomBytes(24).toString('base64url');
    previewTokens.set(token, { userId: user.id, themeId: theme.id, expiresAt: now + previewCookieOptions.maxAge });
    return token;
  }
  function readPreviewToken(request) {
    if (request.query['theme-edit'] !== 'true' || !isAllowedPreviewPage(request.path)) return null;
    const queryToken = String(request.query['theme-di'] || '');
    const cookieToken = String(request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${previewCookie}=`))?.slice(previewCookie.length + 1) || '';
    if (!queryToken || queryToken.length > 64 || queryToken !== cookieToken) return null;
    const entry = previewTokens.get(queryToken);
    if (!entry || entry.expiresAt <= Date.now() || entry.userId !== request.user?.id) {
      previewTokens.delete(queryToken);
      return null;
    }
    const theme = themeModel.get(entry.themeId);
    const validStatus = theme && (
      (theme.artistId === request.user.id && draftEditable(theme))
      || (request.user.isSiteAdmin && theme.status === 'pending')
    );
    if (!validStatus) {
      previewTokens.delete(queryToken);
      return null;
    }
    return theme;
  }
  function sendPreviewCookie(response, token) {
    response.cookie(previewCookie, token, previewCookieOptions);
  }

  const artistOnly = (request, response, next) => {
    if (!request.user?.settings?.artistMode) return response.status(403).send('Artist Mode access is required.');
    next();
  };
  const ownsTheme = (request, response) => {
    const theme = themeModel.get(request.params.id);
    if (!theme || theme.artistId !== request.user.id) {
      response.status(404).json({ error: 'Theme not found.' });
      return null;
    }
    return theme;
  };
  const draftEditable = (theme) => theme.status === 'draft' || theme.status === 'rejected';

  app.get('/themes', requireUser, (request, response) => {
    const marketplaceThemes = themeModel.all()
      .filter((theme) => theme.status === 'approved' || Boolean(theme.publishedVersion))
      .map(publishedTheme);
    render(request, response, 'themes', {
      marketplaceThemes,
      activeThemeId: request.user.settings?.activeThemeId || '',
      applied: String(request.query.applied || ''),
      reset: request.query.reset === '1'
    });
  });

  app.post('/themes/:id/apply', requireUser, (request, response) => {
    const theme = themeModel.get(request.params.id);
    if (!theme || (theme.status !== 'approved' && !theme.publishedVersion)) return response.status(404).send('Theme not found.');
    request.user.settings ||= {};
    request.user.settings.activeThemeId = theme.id;
    persistUser(request.user);
    return response.redirect(`/themes?applied=${encodeURIComponent(theme.name)}`);
  });

  app.post('/themes/reset', requireUser, (request, response) => {
    request.user.settings ||= {};
    delete request.user.settings.activeThemeId;
    persistUser(request.user);
    return response.redirect('/themes?reset=1');
  });

  app.use((request, response, next) => {
    if (request.query['theme-edit'] !== 'true') return next();
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return response.status(403).send('Writes are disabled in theme preview.');
    }
    if (!isAllowedPreviewPage(request.path)) return response.status(403).send('This page is not available in theme preview.');
    requireUser(request, response, () => {
      const theme = readPreviewToken(request);
      if (!theme) return response.status(403).send('This theme preview has expired or is not available to this account.');
      request.themePreview = { ...theme, previewToken: String(request.query['theme-di']) };
      response.locals.themePreviewCss = cssForTheme(theme);
      response.setHeader('X-Frame-Options', 'SAMEORIGIN');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cache-Control', 'no-store');
      next();
    });
  });

  app.get('/themes/active.css', requireUser, (request, response) => {
    const theme = request.themePreview || publishedTheme(themeModel.get(request.user.settings?.activeThemeId));
    response.type('text/css').set('Cache-Control', 'no-store').send(cssForTheme(theme));
  });

  app.get('/themes/lockui-preview', requireUser, (request, response) => {
    if (!request.themePreview) return response.status(403).send('LockUI preview requires an active Studio preview.');
    return render(request, response, 'lockui');
  });

  app.get('/themes/preview/:id', requireUser, (request, response) => {
    const storedTheme = themeModel.get(request.params.id);
    if (!storedTheme || (storedTheme.status !== 'approved' && !storedTheme.publishedVersion
        && !(request.user.isSiteAdmin && storedTheme.status === 'pending'))) {
      return response.status(404).send('Theme not found.');
    }
    const theme = storedTheme.status === 'approved' || storedTheme.publishedVersion
      ? publishedTheme(storedTheme)
      : storedTheme;
    response.type('html').set('X-Frame-Options', 'SAMEORIGIN').send(marketplacePreview(theme));
  });

  app.get('/artist', requireUser, artistOnly, (request, response) => {
    const editingThemeId = String(request.query.edit || '');
    const editingTheme = themeModel.get(editingThemeId);
    let themePreviewToken = '';
    if (editingTheme?.artistId === request.user.id && draftEditable(editingTheme)) {
      themePreviewToken = issuePreviewToken(request.user, editingTheme);
      sendPreviewCookie(response, themePreviewToken);
      response.setHeader('Referrer-Policy', 'no-referrer');
    }
    render(request, response, 'artist', {
      artistThemes: themeModel.byArtist(request.user.id),
      editingThemeId,
      submitted: request.query.submitted === '1',
      themePreviewToken
    });
  });

  app.post('/artist/themes', requireUser, artistOnly, (request, response) => {
    const id = crypto.randomBytes(16).toString('hex');
    const theme = {
      id,
      artistId: request.user.id,
      status: 'draft',
      rejectionNote: '',
      wallpaper: '',
      palette: { background: '#f3f5f6', text: '#172125', surface: '#ffffff', accent: '#294e58' },
      styles: {},
      name: 'Untitled theme',
      description: ''
    };
    themeModel.save(theme);
    response.redirect(`/artist?edit=${id}`);
  });

  app.post('/artist/themes/:id/edit', requireUser, artistOnly, (request, response) => {
    const theme = ownsTheme(request, response);
    if (!theme) return;
    if (theme.status !== 'approved' || theme.publishedVersion) {
      return response.status(409).send('This theme is not currently available to start editing.');
    }
    theme.publishedVersion = publishedSnapshot(theme);
    theme.status = 'draft';
    theme.rejectionNote = '';
    themeModel.save(theme);
    return response.redirect(`/artist?edit=${encodeURIComponent(theme.id)}`);
  });

  app.post('/artist/themes/:id/save', requireUser, artistOnly, json, (request, response) => {
    const theme = ownsTheme(request, response);
    if (!theme) return;
    if (!draftEditable(theme)) return response.status(409).json({ error: 'Submitted themes cannot be edited until they are returned by an admin.' });
    const payload = safeThemePayload(request.body, theme);
    if (!payload) return response.status(400).json({ error: 'Enter a theme name and valid colors. Names are limited to 60 characters; descriptions to 240.' });
    Object.assign(theme, payload);
    themeModel.save(theme);
    response.json({ saved: true, updatedAt: theme.updatedAt });
  });

  app.post('/artist/themes/:id/delete', requireUser, artistOnly, (request, response) => {
    const theme = ownsTheme(request, response);
    if (!theme) return;
    if (!draftEditable(theme) || theme.publishedVersion) {
      return response.status(409).send('Only unpublished drafts can be deleted.');
    }
    if (!themeModel.deleteDraft(theme.id, request.user.id)) {
      return response.status(409).send('This draft can no longer be deleted.');
    }
    return response.redirect('/artist');
  });

  app.post('/artist/themes/:id/artwork', requireUser, artistOnly, express.json({ limit: '8mb' }), (request, response) => {
    const theme = ownsTheme(request, response);
    if (!theme) return;
    if (!draftEditable(theme)) return response.status(409).json({ error: 'Submitted themes cannot be edited until they are returned by an admin.' });
    const image = String(request.body.image || '');
    const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return response.status(400).json({ error: 'Choose a PNG, JPEG, or WebP wallpaper.' });
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) return response.status(413).json({ error: 'Wallpaper files must be smaller than 5 MB.' });
    const signatures = {
      png: buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9,
      webp: buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
    };
    if (!signatures[match[1]]) return response.status(400).json({ error: 'The uploaded file does not match its image type.' });
    fs.mkdirSync(wallpaperDir, { recursive: true });
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const filename = `${crypto.randomBytes(18).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(wallpaperDir, filename), buffer, { flag: 'wx', mode: 0o644 });
    theme.wallpaper = `/media/wallpapers/${filename}`;
    themeModel.save(theme);
    response.json({ wallpaper: theme.wallpaper });
  });

  app.post('/artist/themes/:id/submit', requireUser, artistOnly, (request, response) => {
    const theme = ownsTheme(request, response);
    if (!theme) return;
    if (!draftEditable(theme)) return response.status(409).json({ error: 'This theme is already in the review queue.' });
    const payload = safeThemePayload(theme, theme);
    if (!payload) return response.status(400).json({ error: 'Add a valid name and color palette before submitting.' });
    Object.assign(theme, payload, { status: 'pending', rejectionNote: '', submittedAt: new Date().toISOString() });
    themeModel.save(theme);
    response.json({ submitted: true });
  });

  app.get('/site-admin/themes/:id/review', requireUser, requireSiteAdmin, (request, response) => {
    const theme = themeModel.get(request.params.id);
    if (!theme || theme.status !== 'pending') return response.status(404).send('Review not found.');
    const themePreviewToken = issuePreviewToken(request.user, theme);
    sendPreviewCookie(response, themePreviewToken);
    response.setHeader('Referrer-Policy', 'no-referrer');
    return render(request, response, 'theme-review', { reviewTheme: theme, themePreviewToken });
  });

  app.post('/site-admin/themes/:id/decision', requireUser, requireSiteAdmin, (request, response) => {
    const theme = themeModel.get(request.params.id);
    if (!theme || theme.status !== 'pending') return response.status(404).send('Review not found.');
    const decision = String(request.body.decision || '');
    const rejectionNote = String(request.body.rejectionNote || '').trim();
    if (!['approve', 'reject'].includes(decision) || (decision === 'reject' && (!rejectionNote || rejectionNote.length > 1000))) {
      return response.status(400).send('Reject with a reason of 1 to 1000 characters, or approve the theme.');
    }
    theme.status = decision === 'approve' ? 'approved' : 'rejected';
    theme.rejectionNote = decision === 'reject' ? rejectionNote : '';
    if (decision === 'approve') delete theme.publishedVersion;
    theme.reviewedAt = new Date().toISOString();
    themeModel.save(theme);
    return response.redirect('/site-admin?tab=themes');
  });

  app.get('/site-admin/themes', requireUser, requireSiteAdmin, (request, response) => {
    response.redirect('/site-admin?tab=themes');
  });

  return { cssForTheme, safeThemePayload };
}

module.exports = registerThemeRoutes;
module.exports.cssForTheme = cssForTheme;
module.exports.safeThemePayload = safeThemePayload;
