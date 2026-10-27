'use strict';
const db = require('./database');
const { randomUUID } = require('crypto');
const { fetchMetadata, fetchPlaylistTracks } = require('./youtube-metadata');
const MOODS = ['hyped', 'chill', 'low', 'focus', 'tired', 'bored'];
const TRACK_CACHE_TTL = 6 * 60 * 60 * 1000;
function playlistId(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Paste a public YouTube playlist URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste a complete YouTube playlist URL.'); }
  const id = url.searchParams.get('list');
  const supportedPath = url.hostname === 'youtu.be' ? /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname) : ['/playlist', '/watch', '/playlist/', '/watch/'].includes(url.pathname);
  if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname) || !supportedPath || url.port || url.username || url.password || url.searchParams.getAll('list').length !== 1 || !id || !/^(PL|UU|OLAK5uy_|FL)[A-Za-z0-9_-]{10,100}$/.test(id)) {
    throw new Error('Use an HTTPS YouTube URL with a saved playlist (list=…). Private playlists and temporary mixes may not play.');
  }
  return id;
}
function fields(body, previous) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Playlist details are required.');
  const label = body.label === undefined ? previous?.custom_label || '' : body.label;
  let previousTags = [];
  try { previousTags = previous ? JSON.parse(previous.tags) : []; } catch {}
  const tags = body.tags === undefined ? previousTags : body.tags;
  if (typeof label !== 'string' || label.trim().length > 100) throw new Error('Use a custom label of at most 100 characters, or leave it empty to use the YouTube title.');
  if (!Array.isArray(tags) || tags.length > 6 || tags.some(tag => !MOODS.includes(tag))) throw new Error('Choose from the six supported moods.');
  return { label: label.trim(), tags: [...new Set(tags)] };
}
function init() {
  db.write(`CREATE TABLE IF NOT EXISTS radio_playlists (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, youtube_id TEXT NOT NULL,
    label TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
    UNIQUE(user_id, youtube_id), FOREIGN KEY(user_id) REFERENCES users(id));`);
  db.write(`CREATE TABLE IF NOT EXISTS radio_playlist_tracks (
    user_id INTEGER NOT NULL, playlist_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL, PRIMARY KEY(user_id, playlist_id),
    FOREIGN KEY(user_id) REFERENCES users(id));`);
  const columns = new Set(db.rows('PRAGMA table_info(radio_playlists)').map(column => column.name));
  db.transaction(() => {
    for (const [name, type] of [['custom_label', 'TEXT'], ['metadata_json', 'TEXT'], ['metadata_status', "TEXT NOT NULL DEFAULT 'unchecked'"], ['metadata_checked_at', 'TEXT']]) {
      if (!columns.has(name)) db.execute(`ALTER TABLE radio_playlists ADD COLUMN ${name} ${type}`);
    }
    if (!columns.has('custom_label')) db.execute("UPDATE radio_playlists SET custom_label = label WHERE label <> 'My YouTube playlist' AND trim(label) <> ''");
  });
}
const unpack = row => {
  let metadata = null;
  try { metadata = row.metadata_json ? JSON.parse(row.metadata_json) : null; } catch {}
  let tags = [];
  try { tags = JSON.parse(row.tags); } catch {}
  return { id: row.id, youtubeId: row.youtube_id, url: 'https://www.youtube.com/playlist?list=' + row.youtube_id,
    label: row.custom_label || metadata?.title || 'YouTube playlist', customLabel: row.custom_label || null,
    originalTitle: metadata?.title || null, metadata,
    metadataStatus: row.metadata_status || 'unchecked', metadataCheckedAt: row.metadata_checked_at || null,
    tags, createdAt: row.created_at };
};
async function enrich(rows, owner) {
  const reports = await Promise.all(Array.from({ length: Math.ceil(rows.length / 50) }, (_, batch) => fetchMetadata(rows.slice(batch * 50, batch * 50 + 50).map(row => row.youtube_id))));
  let updated = 0, unavailable = 0;
  (await db.transaction(async () => {
    for (const [index, row] of rows.entries()) {
      const result = reports[Math.floor(index / 50)], metadata = result.items?.get(row.youtube_id);
      const status = result.status === 'available' && !metadata ? 'unavailable' : result.status;
      if (metadata) {
        (await db.execute('UPDATE radio_playlists SET metadata_json = ? WHERE id = ? AND user_id = ?', [JSON.stringify(metadata), row.id, owner])); updated++;
      }
      if (status === 'unavailable') unavailable++;
      (await db.execute('UPDATE radio_playlists SET metadata_status = ?, metadata_checked_at = ? WHERE id = ? AND user_id = ?', [status, new Date().toISOString(), row.id, owner]));
    }
  }));
  const failure = reports.find(result => result.status !== 'available');
  return { updated, unavailable, status: failure?.status || 'available', message: failure?.message || (unavailable ? `${updated} updated; ${unavailable} playlists are private, deleted or inaccessible. Previous details were kept.` : `${updated} playlists refreshed from YouTube.`) };
}
async function readTrackCache(owner, playlist) {
  const row = (await db.rows('SELECT payload_json, fetched_at FROM radio_playlist_tracks WHERE user_id = ? AND playlist_id = ?', [owner, playlist.id]))[0];
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload_json);
    if (!Array.isArray(payload.tracks)) return null;
    return { ...payload, fetchedAt: row.fetched_at };
  } catch { return null; }
}
async function writeTrackCache(owner, playlist, payload) {
  const fetchedAt = payload.fetchedAt || new Date().toISOString();
  const clean = { status: payload.status, message: payload.message, partial: !!payload.partial, truncated: !!payload.truncated, tracks: payload.tracks, fetchedAt };
  (await db.write('INSERT OR REPLACE INTO radio_playlist_tracks (user_id, playlist_id, payload_json, fetched_at) VALUES (?,?,?,?)', [owner, playlist.id, JSON.stringify(clean), fetchedAt]));
  return clean;
}
function attach(app) {
  const safe = {};
  for (const method of ['get','post','patch','delete']) safe[method] = (route, handler) => app[method](route, (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next));
  const base = '/api/companion/radio/playlists';
  const refreshTimes = new Map();
  const trackRefreshTimes = new Map();
  const trackInflight = new Map();
  const owned = async (req, id) => (await db.rows('SELECT * FROM radio_playlists WHERE id = ? AND user_id = ?', [id, req.user.id]))[0];
  safe.get(base, async (req, res) => res.json({ playlists: (await db.rows('SELECT * FROM radio_playlists WHERE user_id = ? ORDER BY created_at, id', [req.user.id])).map(unpack) }));
  safe.post(base, async (req, res, next) => {
    let id, details;
    try { id = playlistId(req.body?.url); details = fields(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    if ((await db.rows('SELECT id FROM radio_playlists WHERE user_id = ? AND youtube_id = ?', [req.user.id, id])).length) return res.status(409).json({ error: 'This playlist is already in your library.' });
    if ((await db.rows('SELECT COUNT(*) AS n FROM radio_playlists WHERE user_id = ?', [req.user.id]))[0].n >= 200) return res.status(400).json({ error: 'Your library is full (200 playlists). Remove one before adding another.' });
    const row = { id: randomUUID(), user_id: req.user.id, youtube_id: id, label: details.label || 'My YouTube playlist', tags: JSON.stringify(details.tags), created_at: new Date().toISOString() };
    try {
      (await db.write('INSERT INTO radio_playlists (id,user_id,youtube_id,label,tags,created_at,custom_label) VALUES (?,?,?,?,?,?,?)', [...Object.values(row), details.label || null]));
      const metadata = await enrich([row], req.user.id);
      const saved = (await db.rows('SELECT * FROM radio_playlists WHERE id = ? AND user_id = ?', [row.id, req.user.id]))[0];
      if (!saved) return res.status(404).json({ error: 'This playlist was removed while metadata was loading.' });
      res.status(201).json({ playlist: unpack(saved), metadata });
    } catch (error) { next(error); }
  });
  safe.post(base + '/metadata/refresh', async (req, res, next) => {
    const now = Date.now();
    for (const [owner, time] of refreshTimes) if (now - time >= 30000) refreshTimes.delete(owner);
    if (refreshTimes.has(req.user.id)) return res.status(429).set('Retry-After', '30').json({ error: 'Please wait 30 seconds before refreshing metadata again.' });
    refreshTimes.set(req.user.id, now);
    try {
      const rows = (await db.rows('SELECT * FROM radio_playlists WHERE user_id = ?', [req.user.id]));
      const metadata = rows.length ? await enrich(rows, req.user.id) : { updated: 0, message: 'Add a playlist first.' };
      res.json({ metadata, playlists: (await db.rows('SELECT * FROM radio_playlists WHERE user_id = ? ORDER BY created_at, id', [req.user.id])).map(unpack) });
    } catch (error) { next(error); }
  });
  async function tracksFor(req, playlist, force) {
    const cached = (await readTrackCache(req.user.id, playlist));
    const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < TRACK_CACHE_TTL;
    if (cached && fresh && !force) return { ...cached, cached: true, stale: false };
    const key = req.user.id + ':' + playlist.id;
    if (trackInflight.has(key)) return trackInflight.get(key);
    const job = (async () => {
      const result = await fetchPlaylistTracks(playlist.youtube_id);
      if (result.playlist?.title) {
        const metadata = {
          title: result.playlist.title, channelTitle: result.playlist.channelTitle,
          thumbnailUrl: result.playlist.thumbnailUrl, itemCount: result.playlist.itemCount,
          fetchedAt: result.fetchedAt || new Date().toISOString()
        };
        (await db.write('UPDATE radio_playlists SET metadata_json = ?, metadata_status = ?, metadata_checked_at = ? WHERE id = ? AND user_id = ?', [JSON.stringify(metadata), 'available', result.fetchedAt || new Date().toISOString(), playlist.id, req.user.id]));
      }
      if (result.status === 'available' && Array.isArray(result.tracks)) {
        const saved = (await writeTrackCache(req.user.id, playlist, result));
        return { ...saved, cached: false, stale: false };
      }
      if (cached) return { ...cached, cached: true, stale: true, status: result.status, message: result.message + ' Showing the saved track list from ' + cached.fetchedAt + '.' };
      return { status: result.status, message: result.message, tracks: [], cached: false, stale: false, partial: false, truncated: false, fetchedAt: null };
    })().finally(() => trackInflight.delete(key));
    trackInflight.set(key, job);
    return job;
  }
  safe.get(base + '/:id/tracks', async (req, res, next) => {
    const playlist = (await owned(req, req.params.id));
    if (!playlist) return res.status(404).json({ error: 'Playlist not found in your library.' });
    const force = req.query.refresh === '1';
    if (force) {
      const now = Date.now();
      for (const [key, time] of trackRefreshTimes) if (now - time >= 20000) trackRefreshTimes.delete(key);
      const key = req.user.id + ':' + playlist.id;
      if (trackRefreshTimes.has(key)) return res.status(429).set('Retry-After', '20').json({ error: 'Please wait 20 seconds before refreshing this track list again.' });
      trackRefreshTimes.set(key, now);
    }
    try {
      const result = await tracksFor(req, playlist, force);
      const latest = (await owned(req, playlist.id)) || playlist;
      res.json({ ...result, playlist: unpack(latest) });
    } catch (error) { next(error); }
  });
  safe.patch(base + '/:id', async (req, res) => {
    const row = (await owned(req, req.params.id));
    if (!row) return res.status(404).json({ error: 'Playlist not found in your library.' });
    let details;
    try { details = fields(req.body, row); } catch (e) { return res.status(400).json({ error: e.message }); }
    (await db.write('UPDATE radio_playlists SET label = ?, custom_label = ?, tags = ? WHERE id = ? AND user_id = ?', [details.label || 'My YouTube playlist', details.label || null, JSON.stringify(details.tags), row.id, req.user.id]));
    const latest = (await owned(req, row.id));
    res.json({ playlist: unpack(latest) });
  });
  safe.delete(base + '/:id', async (req, res) => {
    const row = (await owned(req, req.params.id));
    if (!row) return res.status(404).json({ error: 'Playlist not found in your library.' });
    (await db.transaction(async () => {
      (await db.execute('DELETE FROM radio_playlist_tracks WHERE user_id = ? AND playlist_id = ?', [req.user.id, row.id]));
      (await db.execute('DELETE FROM radio_playlists WHERE id = ? AND user_id = ?', [row.id, req.user.id]));
    }));
    res.json({ success: true });
  });
}
module.exports = { init, attach, playlistId };
