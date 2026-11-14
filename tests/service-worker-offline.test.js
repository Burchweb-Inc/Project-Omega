const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const serviceWorkerScript = fs.readFileSync(path.join(__dirname, '../public/service-worker.js'), 'utf8');

function createServiceWorker(fetchImpl) {
  const listeners = {};
  const cacheEntries = new Map();
  const cache = {
    match: async (request) => cacheEntries.get(typeof request === 'string' ? request : request.url),
    put: async (request, response) => {
      cacheEntries.set(typeof request === 'string' ? request : request.url, response);
    }
  };
  const caches = {
    open: async () => cache,
    match: async (request) => cache.match(request)
  };
  const self = {
    location: { origin: 'https://lockin.test' },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    skipWaiting: async () => {}
  };

  vm.runInNewContext(serviceWorkerScript, { self, caches, fetch: fetchImpl, URL, Response, console });
  return { listeners, cacheEntries };
}

test('install caches offline.html even if the optional logo is unavailable', async () => {
  const fetchImpl = async (request) => {
    if (request === '/offline.html') return new Response('<h1>Offline</h1>', { status: 200 });
    if (request === '/media/logo.png') return new Response('', { status: 404 });
    return new Response('', { status: 404 });
  };
  const { listeners, cacheEntries } = createServiceWorker(fetchImpl);
  const pending = [];

  listeners.install({ waitUntil: (promise) => pending.push(promise) });
  await Promise.all(pending);

  assert.equal(await cacheEntries.get('/offline.html').text(), '<h1>Offline</h1>');
});

test('navigation uses the cached offline page for server errors and network failures', async () => {
  const cachedPage = new Response('<h1>Server issue or offline</h1>', { status: 200 });
  const fetchImpl = async () => new Response('Bad Gateway', { status: 502 });
  const { listeners, cacheEntries } = createServiceWorker(fetchImpl);
  cacheEntries.set('/offline.html', cachedPage);

  const event = {
    request: { method: 'GET', mode: 'navigate', url: 'https://lockin.test/dashboard' },
    respondWith: (promise) => {
      event.response = promise;
    }
  };
  listeners.fetch(event);
  assert.equal(await (await event.response).text(), '<h1>Server issue or offline</h1>');

  const networkFailure = createServiceWorker(async () => {
    throw new Error('network unavailable');
  });
  networkFailure.cacheEntries.set('/offline.html', new Response('<h1>Offline fallback</h1>', { status: 200 }));
  const failedEvent = {
    request: { method: 'GET', mode: 'navigate', url: 'https://lockin.test/dashboard' },
    respondWith: (promise) => {
      failedEvent.response = promise;
    }
  };
  networkFailure.listeners.fetch(failedEvent);
  assert.equal(await (await failedEvent.response).text(), '<h1>Offline fallback</h1>');
});

test('navigation preserves non-server HTTP errors', async () => {
  const notFound = new Response('Not found', { status: 404 });
  const { listeners } = createServiceWorker(async () => notFound);
  const event = {
    request: { method: 'GET', mode: 'navigate', url: 'https://lockin.test/missing' },
    respondWith: (promise) => {
      event.response = promise;
    }
  };

  listeners.fetch(event);
  assert.equal(await event.response, notFound);
});

test('logo requests use the cached image and cache a successful network response', async () => {
  const cachedImage = new Response('cached image');
  let fetchCount = 0;
  const { listeners, cacheEntries } = createServiceWorker(async () => {
    fetchCount += 1;
    return new Response('network image');
  });
  cacheEntries.set('/media/logo.png', cachedImage);

  const cachedEvent = {
    request: { method: 'GET', mode: 'no-cors', url: 'https://lockin.test/media/logo.png' },
    respondWith: (promise) => {
      cachedEvent.response = promise;
    }
  };
  listeners.fetch(cachedEvent);
  assert.equal(await (await cachedEvent.response).text(), 'cached image');
  assert.equal(fetchCount, 0);

  cacheEntries.delete('/media/logo.png');
  const networkEvent = {
    request: { method: 'GET', mode: 'no-cors', url: 'https://lockin.test/media/logo.png' },
    respondWith: (promise) => {
      networkEvent.response = promise;
    }
  };
  listeners.fetch(networkEvent);
  assert.equal(await (await networkEvent.response).text(), 'network image');
  assert.equal(await cacheEntries.get('/media/logo.png').text(), 'network image');
});
