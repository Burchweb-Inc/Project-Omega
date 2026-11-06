const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const Database = require('better-sqlite3');
const createThemeModel = require('../themes/model');
const registerThemeRoutes = require('../themes/routes');

test('artists can submit, revise rejected work, and publish only through admin review', async (context) => {
  const db = new Database(':memory:');
  const themeModel = createThemeModel(db);
  themeModel.init();
  const wallpaperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-wallpapers-'));
  const accounts = {
    artist: { id: 'artist-1', username: 'artist', settings: { artistMode: true } },
    other: { id: 'artist-2', username: 'other', settings: { artistMode: true } },
    member: { id: 'member-1', username: 'member', settings: {} },
    admin: { id: 'admin-1', username: 'admin', isSiteAdmin: true, settings: {} }
  };
  let persistedUser;
  const app = express();
  app.use((_request, response, next) => {
    response.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.urlencoded({ extended: true }));
  app.use((request, _response, next) => {
    request.user = accounts[request.get('x-user')];
    next();
  });
  const requireUser = (request, response, next) => request.user ? next() : response.sendStatus(401);
  const requireSiteAdmin = (request, response, next) => request.user?.isSiteAdmin ? next() : response.sendStatus(403);
  registerThemeRoutes({
    app,
    themeModel,
    requireUser,
    requireSiteAdmin,
    wallpaperDir,
    persistUser: (user) => { persistedUser = user; },
    render: (_request, response, page, data) => response.json({ page, ...data })
  });
  app.get('/dashboard', (request, response) => response.json({
    page: 'real-dashboard',
    previewThemeId: request.themePreview?.id || null,
    previewCss: response.locals.themePreviewCss || null
  }));
  app.get('/calendar', (request, response) => response.json({
    page: 'real-calendar',
    previewThemeId: request.themePreview?.id || null
  }));
  app.get('/calendar/:year/:month', (request, response) => response.json({
    page: `calendar-${request.params.year}-${request.params.month}`,
    previewThemeId: request.themePreview?.id || null
  }));
  app.post('/dashboard', (_request, response) => response.send('normal write allowed'));
  const server = app.listen(0);
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.readdirSync(wallpaperDir).forEach((filename) => fs.unlinkSync(path.join(wallpaperDir, filename)));
    fs.rmdirSync(wallpaperDir);
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const request = (url, user, options = {}) => fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), 'x-user': user, ...options.headers }
  });

  assert.equal((await request('/artist', 'member')).status, 403);
  assert.equal((await request('/artist/themes', 'member', { method: 'POST' })).status, 403);

  const create = await request('/artist/themes', 'artist', { method: 'POST', redirect: 'manual' });
  assert.equal(create.status, 302);
  const themeId = new URL(create.headers.get('location'), baseUrl).searchParams.get('edit');
  assert.ok(themeId);

  const themeData = {
    name: 'Warm Paper',
    description: 'A quiet, readable study space.',
    palette: { background: '#f4ead8', text: '#231f1a', surface: '#fffaf0', accent: '#7a4435' },
    styles: {
      card: { opacity: '0.95', transform: 'scale(2)' },
      'element:lockui:0.1.3': { color: '#ffffff' },
      'class:lui-button.lui-button-primary': { 'background-color': '#7a4435' },
      'class:body': { color: 'red' }
    }
  };
  assert.equal((await request(`/artist/themes/${themeId}/save`, 'other', {
    method: 'POST', body: JSON.stringify(themeData)
  })).status, 404);
  assert.equal((await request(`/artist/themes/${themeId}/save`, 'artist', {
    method: 'POST', body: JSON.stringify(themeData)
  })).status, 200);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lfgAAAAASUVORK5CYII=', 'base64');
  const upload = await request(`/artist/themes/${themeId}/artwork`, 'artist', {
    method: 'POST',
    body: JSON.stringify({ image: `data:image/png;base64,${png.toString('base64')}` })
  });
  assert.equal(upload.status, 200);
  const wallpaperPath = (await upload.json()).wallpaper;
  assert.match(wallpaperPath, /^\/media\/wallpapers\/[a-f0-9]+\.png$/);

  assert.equal((await request(`/artist/themes/${themeId}/submit`, 'artist', { method: 'POST' })).status, 200);
  assert.equal((await request(`/site-admin/themes/${themeId}/review`, 'artist')).status, 403);
  const review = await request(`/site-admin/themes/${themeId}/review`, 'admin');
  const reviewData = await review.json();
  assert.equal(reviewData.reviewTheme.status, 'pending');
  const adminCookie = review.headers.get('set-cookie').split(';')[0];
  assert.match(review.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(review.headers.get('referrer-policy'), 'no-referrer');
  const previewUrl = `/dashboard?theme-edit=true&theme-di=${reviewData.themePreviewToken}`;
  const preview = await request(previewUrl, 'admin', { headers: { Cookie: adminCookie } });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('x-frame-options'), 'SAMEORIGIN');
  const previewPage = await preview.json();
  assert.equal(previewPage.previewThemeId, themeId);
  assert.match(previewPage.previewCss, /#f4ead8/);
  const previewCss = await request(`/themes/active.css?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  });
  const previewCssText = await previewCss.text();
  assert.match(previewCssText, /#f4ead8/);
  assert.match(previewCssText, /\.lui-button\.lui-button-primary\{background-color:#7a4435 !important\}/);
  assert.match(previewCssText, /\[data-theme-node="lockui-0-1-3"\]\{color:#ffffff !important\}/);
  assert.doesNotMatch(previewCssText, /\.body\{/);
  const lockuiPreview = await request(`/themes/lockui-preview?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  });
  assert.equal(lockuiPreview.status, 200);
  assert.equal((await lockuiPreview.json()).page, 'lockui');
  assert.equal((await request(`/b/sample?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  })).status, 403);
  const normalWrite = await request('/dashboard', 'admin', {
    method: 'POST',
    headers: { Cookie: adminCookie, Origin: 'null' }
  });
  assert.equal(normalWrite.status, 200);
  assert.equal(await normalWrite.text(), 'normal write allowed');
  assert.equal((await request(previewUrl, 'admin', {
    method: 'POST',
    headers: { Cookie: adminCookie, Origin: 'null' }
  })).status, 403);
  const calendarPreview = await request(`/calendar?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  });
  assert.equal((await calendarPreview.json()).page, 'real-calendar');
  assert.equal(calendarPreview.headers.get('x-frame-options'), 'SAMEORIGIN');
  const calendarMonthPreview = await request(`/calendar/2026/11?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  });
  assert.equal((await calendarMonthPreview.json()).page, 'calendar-2026-11');
  assert.equal(calendarMonthPreview.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal((await request(`/calendar/2026/13?theme-edit=true&theme-di=${reviewData.themePreviewToken}`, 'admin', {
    headers: { Cookie: adminCookie }
  })).status, 403);
  assert.equal((await request(previewUrl, 'artist', { headers: { Cookie: adminCookie } })).status, 403);
  assert.equal((await request(`/dashboard?theme-edit=true&theme-di=${themeId}`, 'admin', { headers: { Cookie: adminCookie } })).status, 403);
  const rejection = await request(`/site-admin/themes/${themeId}/decision`, 'admin', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'decision=reject&rejectionNote=Please+increase+contrast.'
  });
  assert.equal(rejection.status, 302);
  assert.equal(themeModel.get(themeId).wallpaper, wallpaperPath);

  const revised = await request(`/artist/themes/${themeId}/save`, 'artist', {
    method: 'POST',
    body: JSON.stringify({ ...themeData, name: 'Warm Paper Revised' })
  });
  assert.equal(revised.status, 200);
  assert.equal(themeModel.get(themeId).rejectionNote, 'Please increase contrast.');
  assert.equal((await request(`/artist/themes/${themeId}/submit`, 'artist', { method: 'POST' })).status, 200);
  const approval = await request(`/site-admin/themes/${themeId}/decision`, 'admin', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'decision=approve'
  });
  assert.equal(approval.status, 302);

  const marketplace = await request('/themes', 'member');
  assert.equal((await marketplace.json()).marketplaceThemes[0].status, 'approved');
  const apply = await request(`/themes/${themeId}/apply`, 'member', { method: 'POST', redirect: 'manual' });
  assert.equal(apply.status, 302);
  assert.equal(persistedUser.settings.activeThemeId, themeId);
  assert.match(await (await request('/themes/active.css', 'member')).text(), /#f4ead8/);

  const startUpdate = await request(`/artist/themes/${themeId}/edit`, 'artist', { method: 'POST', redirect: 'manual' });
  assert.equal(startUpdate.status, 302);
  assert.equal(themeModel.get(themeId).status, 'draft');
  assert.equal(themeModel.get(themeId).publishedVersion.name, 'Warm Paper Revised');
  const updateData = {
    ...themeData,
    name: 'Warm Paper Update',
    palette: { ...themeData.palette, background: '#e8d8c8' }
  };
  assert.equal((await request(`/artist/themes/${themeId}/save`, 'artist', {
    method: 'POST', body: JSON.stringify(updateData)
  })).status, 200);
  assert.equal((await request(`/artist/themes/${themeId}/submit`, 'artist', { method: 'POST' })).status, 200);
  assert.equal(themeModel.get(themeId).status, 'pending');
  assert.match(await (await request('/themes/active.css', 'member')).text(), /#f4ead8/);
  const marketplaceDuringReview = await request('/themes', 'member');
  const publishedDuringReview = (await marketplaceDuringReview.json()).marketplaceThemes[0];
  assert.equal(publishedDuringReview.name, 'Warm Paper Revised');
  assert.equal(publishedDuringReview.palette.background, '#f4ead8');

  const rejectUpdate = await request(`/site-admin/themes/${themeId}/decision`, 'admin', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'decision=reject&rejectionNote=Please+keep+the+published+background.'
  });
  assert.equal(rejectUpdate.status, 302);
  assert.equal(themeModel.get(themeId).status, 'rejected');
  assert.match(await (await request('/themes/active.css', 'member')).text(), /#f4ead8/);
  assert.equal((await request(`/artist/themes/${themeId}/save`, 'artist', {
    method: 'POST', body: JSON.stringify({ ...updateData, name: 'Warm Paper Fixed' })
  })).status, 200);
  assert.equal((await request(`/artist/themes/${themeId}/submit`, 'artist', { method: 'POST' })).status, 200);
  const approveUpdate = await request(`/site-admin/themes/${themeId}/decision`, 'admin', {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'decision=approve'
  });
  assert.equal(approveUpdate.status, 302);
  assert.equal(themeModel.get(themeId).status, 'approved');
  assert.equal(themeModel.get(themeId).publishedVersion, undefined);
  assert.match(await (await request('/themes/active.css', 'member')).text(), /#e8d8c8/);
});
