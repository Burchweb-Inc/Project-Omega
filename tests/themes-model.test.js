const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const createThemeModel = require('../themes/model');

test('theme persistence is repeatable and keeps artist themes isolated', () => {
  const db = new Database(':memory:');
  const model = createThemeModel(db);
  model.init();
  model.init();

  const first = {
    id: 'theme-1',
    artistId: 'artist-1',
    status: 'draft',
    name: 'Evening Study',
    palette: { background: '#13242a', text: '#ffffff', surface: '#20343a', accent: '#c4e3d4' },
    styles: { card: { opacity: '0.95' } }
  };
  const second = { id: 'theme-2', artistId: 'artist-2', status: 'pending', name: 'Paper', palette: {}, styles: {} };

  model.save(first);
  model.save(second);
  assert.deepEqual(model.byArtist('artist-1').map((theme) => theme.id), ['theme-1']);
  assert.deepEqual(model.byStatus('pending').map((theme) => theme.id), ['theme-2']);

  model.save({ ...first, name: 'Evening Study Revised', status: 'rejected', rejectionNote: 'Adjust contrast.' });
  assert.equal(model.get('theme-1').name, 'Evening Study Revised');
  assert.equal(model.get('theme-1').rejectionNote, 'Adjust contrast.');
  assert.equal(model.get('theme-2').name, 'Paper');
  const deletable = { id: 'theme-3', artistId: 'artist-1', status: 'draft', name: 'Unused draft', palette: {}, styles: {} };
  const publishedDraft = {
    id: 'theme-4',
    artistId: 'artist-1',
    status: 'draft',
    name: 'Published update',
    palette: {},
    styles: {},
    publishedVersion: { name: 'Published version' }
  };
  model.save(deletable);
  model.save(publishedDraft);
  assert.equal(model.deleteDraft('theme-3', 'artist-2'), false);
  assert.equal(model.deleteDraft('theme-3', 'artist-1'), true);
  assert.equal(model.get('theme-3'), null);
  assert.equal(model.deleteDraft('theme-4', 'artist-1'), false);
  assert.equal(model.get('theme-4').name, 'Published update');
  db.close();
});
