const STATIC_CACHE = 'lockin-static-v6';
const OFFLINE_CACHE = 'lockin-offline-media-v5';
const CORE_ASSETS = ['/offline.html', '/media/logo.png'];

async function cacheCoreAssets() {
  const cache = await caches.open(STATIC_CACHE);
  await Promise.all(CORE_ASSETS.map(async (asset) => {
    const response = await fetch(asset, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not cache ${asset}: ${response.status}`);
    await cache.put(asset, response);
  }));
  console.info('[LockIn SW] Core assets cached', CORE_ASSETS);
}

async function cacheOfflineMedia() {
  const manifestResponse = await fetch('/media/offline-manifest.json', { cache: 'no-store' });
  if (!manifestResponse.ok) return;
  const offlineFiles = await manifestResponse.json();
  const offlineCache = await caches.open(OFFLINE_CACHE);
  await Promise.all(offlineFiles.map(async (file) => {
    try {
      await offlineCache.add(file);
    } catch (error) {
      // Keep one unavailable enhancement asset from blocking the whole cache.
    }
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheCoreAssets());
  event.waitUntil(self.skipWaiting());
  event.waitUntil(cacheOfflineMedia().catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
  event.waitUntil(cacheOfflineMedia().catch(() => {}));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/media/offline/')) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && url.pathname.startsWith('/media/offline/')) {
        const offlineCache = await caches.open(OFFLINE_CACHE);
        await offlineCache.put(request, response.clone());
      }
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const offline = await caches.match('/offline.html');
      return offline || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }));
  }
});
