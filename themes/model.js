function mapTheme(row) {
  return {
    ...JSON.parse(row.payload),
    id: row.id,
    artistId: row.artist_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function initialize(db) {
  db.prepare(`CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    artist_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  db.prepare('CREATE INDEX IF NOT EXISTS themes_status_updated ON themes(status, updated_at DESC)').run();
  db.prepare('CREATE INDEX IF NOT EXISTS themes_artist_updated ON themes(artist_id, updated_at DESC)').run();
}

function save(db, theme) {
  db.prepare(`INSERT INTO themes (id, artist_id, status, payload, created_at, updated_at)
    VALUES (@id, @artistId, @status, @payload, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      artist_id = excluded.artist_id,
      status = excluded.status,
      payload = excluded.payload,
      updated_at = CURRENT_TIMESTAMP`).run({
    id: theme.id,
    artistId: theme.artistId,
    status: theme.status,
    payload: JSON.stringify(theme)
  });
  return get(db, theme.id);
}

function get(db, id) {
  const row = db.prepare('SELECT * FROM themes WHERE id = ?').get(id);
  return row ? mapTheme(row) : null;
}

function all(db) {
  return db.prepare('SELECT * FROM themes ORDER BY updated_at DESC').all().map(mapTheme);
}

function byArtist(db, artistId) {
  return db.prepare('SELECT * FROM themes WHERE artist_id = ? ORDER BY updated_at DESC').all(artistId).map(mapTheme);
}

function byStatus(db, status) {
  return db.prepare('SELECT * FROM themes WHERE status = ? ORDER BY updated_at ASC').all(status).map(mapTheme);
}

module.exports = (db) => ({
  init: () => initialize(db),
  save: (theme) => save(db, theme),
  get: (id) => get(db, id),
  all: () => all(db),
  byArtist: (artistId) => byArtist(db, artistId),
  byStatus: (status) => byStatus(db, status)
});
