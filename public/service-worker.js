const STATIC_CACHE = 'lockin-static-v9';
const OFFLINE_CACHE = 'lockin-offline-media-v5';
const CORE_ASSETS = ['/offline.html', '/media/logo.png'];

async function cacheCoreAssets() {
  const cache = await caches.open(STATIC_CACHE);
  const offlineResponse = await fetch(CORE_ASSETS[0], { cache: 'no-store' });
  if (!offlineResponse.ok) throw new Error(`Could not cache ${CORE_ASSETS[0]}: ${offlineResponse.status}`);
  await cache.put(CORE_ASSETS[0], offlineResponse);

  const logoResponse = await fetch(CORE_ASSETS[1], { cache: 'no-store' });
  if (logoResponse.ok) await cache.put(CORE_ASSETS[1], logoResponse);
  else console.warn(`[LockIn SW] Could not cache ${CORE_ASSETS[1]}: ${logoResponse.status}`);

  console.info('[LockIn SW] Core assets cached', CORE_ASSETS);
}

async function offlineResponse() {
  const cache = await caches.open(STATIC_CACHE);
  return await cache.match('/offline.html')
    || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
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

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'show-notification') return;
  const options = { body: event.data.body || '', icon: '/media/logo.png', badge: '/media/logo.png', data: { href: event.data.href || '/' }, tag: event.data.tag || 'lockin-notification' };
  event.waitUntil(self.registration.showNotification(event.data.title || 'LockIn', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = new URL(event.notification.data?.href || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const client = clients.find((entry) => 'focus' in entry);
    return client ? client.focus().then(() => client.navigate(href)) : self.clients.openWindow(href);
  }));
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

  if (url.pathname === '/media/logo.png') {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(CORE_ASSETS[1]);
      if (cached) return cached;

      const response = await fetch(request);
      if (response.ok) await cache.put(CORE_ASSETS[1], response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      return response.status >= 500 ? offlineResponse() : response;
    }).catch(offlineResponse));
  }
});
