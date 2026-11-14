const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('offline page distinguishes connection loss from a server issue', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/offline.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'offline page should contain its connection status script');

  const elements = {
    'status-title': { textContent: '' },
    'status-message': { textContent: '' }
  };
  const listeners = {};
  let reloadCount = 0;
  const document = {
    title: '',
    getElementById: (id) => elements[id]
  };
  const window = {
    addEventListener: (event, listener) => {
      listeners[event] = listener;
    },
    location: { reload: () => { reloadCount += 1; } }
  };
  const navigator = { onLine: false };

  vm.runInNewContext(script, { document, navigator, window });
  assert.equal(document.title, 'LockIn | Offline');
  assert.equal(elements['status-title'].textContent, 'You are offline.');

  navigator.onLine = true;
  listeners.online();
  assert.equal(reloadCount, 1);

  navigator.onLine = false;
  listeners.offline();
  assert.equal(document.title, 'LockIn | Offline');
  assert.equal(elements['status-title'].textContent, 'You are offline.');
});
