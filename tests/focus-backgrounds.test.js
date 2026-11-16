const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectionName, discoverFocusBackgrounds } = require('../utils/focus-backgrounds');

test('discovers root wallpapers as recommended and folders as image collections', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-focus-wallpapers-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'zebra.jpg'), '');
  fs.writeFileSync(path.join(directory, 'Amber Sky.PNG'), '');
  fs.writeFileSync(path.join(directory, 'notes.txt'), '');
  fs.mkdirSync(path.join(directory, 'quiet-mornings'));
  fs.writeFileSync(path.join(directory, 'quiet-mornings', '02-lake.webp'), '');
  fs.writeFileSync(path.join(directory, 'quiet-mornings', '01-mist.avif'), '');
  fs.mkdirSync(path.join(directory, 'Empty_Collection'));
  fs.writeFileSync(path.join(directory, '.hidden.jpg'), '');

  const result = discoverFocusBackgrounds(directory);

  assert.deepEqual(result.recommended.map((entry) => entry.name), ['Amber Sky', 'zebra']);
  assert.deepEqual(result.collections.map((entry) => entry.name), ['Empty Collection', 'Quiet Mornings']);
  assert.equal(result.collections[0].thumbnail, null);
  assert.equal(result.collections[1].thumbnail, '/media/focus-backgrounds/quiet-mornings/01-mist.avif');
  assert.deepEqual(result.collections[1].wallpapers.map((entry) => entry.name), ['01-mist', '02-lake']);
});

test('formats collection names without punctuation and preserves word boundaries', () => {
  assert.equal(collectionName('soft-light__&-MOUNTAINS'), 'Soft Light Mountains');
  assert.equal(collectionName('earlyMorning-Sky'), 'Early Morning Sky');
});
