const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream');

function configureWeb(app, { rootDir, serviceWorkerVersion, currentUser, refreshModerationStatus }) {
  app.set('view engine', 'ejs');
  app.use(express.urlencoded({ extended: true }));
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });
  app.get('/service-worker-version.json', (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.json({ version: serviceWorkerVersion });
  });
  app.get('/service-worker.js', (request, response) => {
    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.sendFile(path.join(rootDir, 'public', 'service-worker.js'));
  });
  app.get('/media/offline/*', (request, response, next) => {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  });
  app.get('/media/offline-manifest.json', (request, response) => {
    const offlineDir = path.join(rootDir, 'public', 'media', 'offline');
    const files = [];
    const visit = (directory, prefix) => {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        const entryPrefix = `${prefix}/${entry.name}`;
        if (entry.isDirectory()) visit(entryPath, entryPrefix);
        else files.push(`/media/offline${entryPrefix}`);
      }
    };
    visit(offlineDir, '');
    response.json(files);
  });
  app.get('/beta-tests/3drender', (request, response, next) => {
    const user = currentUser(request);
    if (!user?.settings?.betaTools || refreshModerationStatus(user) !== 'active') return response.redirect('/');
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Vary', 'Cookie');
    const file = path.join(rootDir, 'views', 'beta-tests', '3drender', 'index.html');
    if (request.acceptsEncodings('gzip') && !request.headers.range) {
      response.type('html');
      response.setHeader('Content-Encoding', 'gzip');
      response.vary('Accept-Encoding');
      pipeline(fs.createReadStream(file), zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }), response, (error) => {
        if (error && !response.headersSent) next(error);
      });
      return;
    }
    return response.sendFile(file);
  });
  app.use(express.static(path.join(rootDir, 'public')));
}

module.exports = configureWeb;
