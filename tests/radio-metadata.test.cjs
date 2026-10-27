const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchMetadata, fetchPlaylistTracks, thumbnailUrl, parseDuration } = require('../youtube-metadata');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { videoId } = require('./radio-fixtures.cjs');
const id = 'PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs';

function playlistInfo(value, itemCount = 12, title = 'Official fixture title') {
  return { items: [{ id: value, snippet: { title, channelTitle: 'Fixture creator', thumbnails: { high: { url: 'https://i.ytimg.com/vi/KIViy7L_lo8/hqdefault.jpg' } } }, contentDetails: { itemCount } }] };
}

function playlistItems(items) {
  return {
    items: items.map(item => ({
      snippet: {
        title: item.deleted ? 'Deleted video' : item.title,
        channelTitle: item.channelTitle || 'Fixture artist',
        videoOwnerChannelTitle: item.channelTitle || 'Fixture artist',
        ...(item.videoId ? { resourceId: { videoId: item.videoId }, thumbnails: { high: { url: 'https://i.ytimg.com/vi/' + item.videoId + '/hqdefault.jpg' } } } : {})
      },
      contentDetails: item.videoId ? { videoId: item.videoId } : {},
      ...(item.privacyStatus ? { status: { privacyStatus: item.privacyStatus } } : {})
    }))
  };
}

test('official metadata adapter: missing key, fixed URL, safe thumbnails, quota, malformed responses and no credential leakage', async () => {
  const missing = await fetchMetadata([id], { apiKey: '', fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(missing.status, 'unconfigured');
  const result = await fetchMetadata([id], { apiKey: 'never-print-this', fetchImpl: async (url, options) => {
    assert.equal(url.origin, 'https://www.googleapis.com'); assert.equal(url.pathname, '/youtube/v3/playlists');
    assert.equal(url.searchParams.get('part'), 'snippet,contentDetails'); assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.headers['X-Goog-Api-Key'], 'never-print-this'); assert.equal(options.redirect, 'error');
    return Response.json({ items: [{ id, snippet: { title: 'Real API-shaped title', channelTitle: 'Creator', thumbnails: { high: { url: 'https://evil.test/image.png' }, medium: { url: 'https://i.ytimg.com/vi/abc/mqdefault.jpg' } } }, contentDetails: { itemCount: 9 } }] });
  } });
  assert.equal(result.items.get(id).title, 'Real API-shaped title'); assert.equal(result.items.get(id).itemCount, 9);
  assert.match(result.items.get(id).thumbnailUrl, /^https:\/\/i\.ytimg\.com\//);
  for (const url of ['http://i.ytimg.com/a', 'https://i.ytimg.com.evil.test/a', 'javascript:alert(1)', 'https://user:pass@i.ytimg.com/a', 'https://i.ytimg.com:444/a']) assert.equal(thumbnailUrl(url), null);
  for (const [response, status] of [[Response.json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'never-print-this' } }, { status: 403 }), 'quota'], [Response.json({ error: { message: 'never-print-this' } }, { status: 403 }), 'configuration_error'], [Response.json({ items: [{ id, snippet: {} }] }), 'temporary_error'], [Response.json({ bad: true }), 'temporary_error']]) {
    const failure = await fetchMetadata([id], { apiKey: 'never-print-this', fetchImpl: async () => response });
    assert.equal(failure.status, status); assert.ok(!JSON.stringify(failure).includes('never-print-this'));
  }
  assert.equal((await fetchMetadata([id], { apiKey: 'x', fetchImpl: async () => { throw new Error('never-print-this'); } })).status, 'temporary_error');
  assert.equal((await fetchMetadata([id], { apiKey: 'x', fetchImpl: async () => Response.json({ items: [] }) })).items.size, 0);
});

test('track adapter: full pagination, order, durations, availability and explicit failure states', async () => {
  const missing = await fetchPlaylistTracks(id, { apiKey: '', fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal(missing.status, 'unconfigured');
  assert.deepEqual(missing.tracks, []);
  await assert.rejects(() => fetchPlaylistTracks('bad!', { apiKey: 'x' }), /Invalid playlist/);

  const total = 120;
  const ids = Array.from({ length: total }, (_, index) => videoId(index));
  const pages = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(options.headers['X-Goog-Api-Key'], 'never-print-this');
    assert.equal(url.searchParams.has('key'), false);
    assert.equal(options.redirect, 'error');
    if (url.pathname === '/youtube/v3/playlists') return Response.json(playlistInfo(id, total, 'Large playlist'));
    if (url.pathname === '/youtube/v3/playlistItems') {
      const start = Number(url.searchParams.get('pageToken') || 0);
      pages.push(start);
      const items = ids.slice(start, start + 50).map((video, index) => ({ videoId: video, title: 'Song ' + (start + index + 1), channelTitle: 'Artist ' + (start + index + 1) }));
      const body = playlistItems(items);
      if (start + 50 < total) body.nextPageToken = String(start + 50);
      return Response.json(body);
    }
    const batch = url.searchParams.get('id').split(',');
    return Response.json({ items: batch.map(video => ({ id: video, snippet: { title: 'Video ' + video, channelTitle: 'Video artist', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/' + video + '/mqdefault.jpg' } } }, contentDetails: { duration: 'PT1H2M3S' }, status: { embeddable: true, privacyStatus: 'public' } })) });
  };
  const result = await fetchPlaylistTracks(id, { apiKey: 'never-print-this', fetchImpl });
  assert.equal(result.status, 'available');
  assert.equal(result.tracks.length, total);
  assert.deepEqual(pages, [0, 50, 100]);
  assert.equal(result.playlist.title, 'Large playlist');
  assert.equal(result.truncated, false);
  assert.equal(result.partial, false);
  assert.deepEqual(result.tracks.map(track => track.index).slice(0, 2), [0, 1]);
  assert.equal(result.tracks[0].videoId, ids[0]);
  assert.equal(result.tracks[119].videoId, ids[119]);
  assert.equal(result.tracks[0].durationSeconds, 3723);
  assert.equal(result.tracks[0].title, 'Video ' + ids[0]);
  assert.ok(!JSON.stringify(result).includes('never-print-this'));

  const truncated = await fetchPlaylistTracks(id, { apiKey: 'never-print-this', fetchImpl, maxPages: 1 });
  assert.equal(truncated.tracks.length, 50);
  assert.equal(truncated.truncated, true);
  assert.match(truncated.message, /first available pages/);

  const availability = [
    { videoId: videoId(0), title: 'Available song', channelTitle: 'Artist One', duration: 'PT2M10S' },
    { videoId: videoId(1), title: 'Deleted video', deleted: true },
    { videoId: videoId(2), title: 'Private Video', privacyStatus: 'private' },
    { videoId: null, title: 'Deleted video' },
    { videoId: videoId(3), title: 'Blocked song', embeddable: false },
    { videoId: videoId(4), title: 'Missing song', omitFromVideos: true }
  ];
  const availabilityFetch = async url => {
    if (url.pathname === '/youtube/v3/playlists') return Response.json(playlistInfo(id, availability.length, 'Availability playlist'));
    if (url.pathname === '/youtube/v3/playlistItems') return Response.json(playlistItems(availability));
    const batch = url.searchParams.get('id').split(',');
    return Response.json({ items: batch.map(video => ({
      id: video,
      snippet: { title: availability.find(item => item.videoId === video)?.title || 'Video', channelTitle: 'Artist', thumbnails: { high: { url: 'https://i.ytimg.com/vi/' + video + '/hqdefault.jpg' } } },
      contentDetails: { duration: 'PT2M10S' },
      status: { embeddable: !availability.some(item => item.videoId === video && item.embeddable === false), privacyStatus: video === videoId(2) ? 'private' : 'public' }
    })).filter(item => ![videoId(1), videoId(4)].includes(item.id)) });
  };
  const flags = await fetchPlaylistTracks(id, { apiKey: 'x', fetchImpl: availabilityFetch });
  assert.equal(flags.tracks.length, availability.length);
  assert.deepEqual(flags.tracks.map(track => track.index), [0, 1, 2, 3, 4, 5]);
  assert.equal(flags.tracks[0].unavailable, false); assert.equal(flags.tracks[0].restricted, false); assert.equal(flags.tracks[0].durationSeconds, 130);
  assert.equal(flags.tracks[1].unavailable, true);
  assert.equal(flags.tracks[2].unavailable, true); assert.equal(flags.tracks[2].privacyStatus, 'private');
  assert.equal(flags.tracks[3].unavailable, true); assert.equal(flags.tracks[3].videoId, null);
  assert.equal(flags.tracks[4].restricted, true); assert.equal(flags.tracks[4].unavailable, false);
  assert.equal(flags.tracks[5].unavailable, true);

  const videoFailure = await fetchPlaylistTracks(id, { apiKey: 'x', fetchImpl: async url => {
    if (url.pathname === '/youtube/v3/playlists') return Response.json(playlistInfo(id, 2));
    if (url.pathname === '/youtube/v3/playlistItems') return Response.json(playlistItems(availability.slice(0, 2)));
    return Response.json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 500 });
  } });
  assert.equal(videoFailure.status, 'available');
  assert.equal(videoFailure.partial, true);
  assert.equal(videoFailure.tracks.length, 2);
  assert.equal(videoFailure.tracks[0].unavailable, false);
  assert.match(videoFailure.message, /did not return every/);

  for (const [failure, status] of [
    [async url => url.pathname === '/youtube/v3/playlists' ? Response.json(playlistInfo(id, 5)) : Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 }), 'quota'],
    [async url => url.pathname === '/youtube/v3/playlists' ? Response.json({ items: [] }) : Response.json({ items: [] }), 'unavailable'],
    [async url => url.pathname === '/youtube/v3/playlists' ? Response.json({ surprise: true }) : Response.json({ items: [] }), 'temporary_error'],
    [async url => url.pathname === '/youtube/v3/playlists' ? Response.json(playlistInfo(id, 5)) : Response.json({ surprise: true }), 'temporary_error'],
    [async () => { throw new Error('never-print-this'); }, 'temporary_error']
  ]) {
    const failed = await fetchPlaylistTracks(id, { apiKey: 'x', fetchImpl: failure });
    assert.equal(failed.status, status);
    assert.ok(!JSON.stringify(failed).includes('never-print-this'));
  }

  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('PT0S'), 0);
  for (const value of [null, 'P1W', 'nonsense', undefined]) assert.equal(parseDuration(value), null);
});

test('additive migration, metadata persistence/refresh, track cache, ownership and collection rendering', { timeout: 180000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-metadata-test-'));
  const fixture = path.join(dir, 'fixture.json'), database = path.join(dir, 'test.db');
  fs.writeFileSync(fixture, '{}');
  const SQL = await require('sql.js')(); const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE radio_playlists (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, youtube_id TEXT NOT NULL, label TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, UNIQUE(user_id,youtube_id));`);
  for (const [local, owner, youtube, label, tags] of [['legacy-default', 1, id, 'My YouTube playlist', '["low"]'], ['legacy-custom', 1, id + 'x', 'My custom mix', '["focus"]'], ['other-owner', 2, id + 'y', 'Private label', '[]']]) legacy.run('INSERT INTO radio_playlists VALUES (?,?,?,?,?,?)', [local, owner, youtube, label, tags, '2026-10-25']);
  fs.writeFileSync(database, Buffer.from(legacy.export())); legacy.close();
  let child, browser;
  const base = 'http://localhost:32186', endpoint = '/api/companion/radio/playlists';
  const request = (route, method = 'GET', body, token) => fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function start() {
    child = spawn(process.execPath, ['--require', './tests/fake-youtube-metadata.cjs', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '32186', DB_PATH: database, JWT_SECRET: 'metadata-test-secret-test-test-test-test', STUDY_ENABLED: 'false', GEMINI_API_KEY: '', NVIDIA_API_KEY: '', YOUTUBE_API_KEY: 'test-only-youtube-key', RADIO_METADATA_FIXTURE: fixture }, stdio: 'pipe' });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server timeout')), 15000); child.stdout.on('data', d => { if (String(d).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited')); }); });
  }
  async function restart() { child.kill(); await once(child, 'exit'); await start(); }
  const calls = () => fs.existsSync(fixture + '.calls') ? fs.readFileSync(fixture + '.calls', 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  try {
    await start();
    async function account(name) { await request('/api/register', 'POST', { username: name, email: name + '@example.test', password: 'test-password' }); return (await (await request('/api/login', 'POST', { email: name + '@example.test', password: 'test-password' })).json()).token; }
    const a = await account('metadataalice'), b = await account('metadatabob');
    let rows = (await (await request(endpoint, 'GET', undefined, a)).json()).playlists;
    assert.equal(rows.length, 2); assert.equal(rows.find(row => row.id === 'legacy-default').customLabel, null);
    assert.equal(rows.find(row => row.id === 'legacy-custom').customLabel, 'My custom mix');
    assert.equal((await request(endpoint + '/metadata/refresh', 'POST', {})).status, 401);
    let response = await (await request(endpoint + '/metadata/refresh', 'POST', { ids: ['other-owner'] }, a)).json();
    assert.equal(response.metadata.updated, 2); assert.equal(response.playlists.find(row => row.id === 'legacy-default').label, 'Official fixture title');
    assert.deepEqual(response.playlists.find(row => row.id === 'legacy-custom').tags, ['focus']);
    assert.equal(response.playlists.find(row => row.id === 'legacy-custom').label, 'My custom mix');
    assert.equal((await request(endpoint + '/metadata/refresh', 'POST', {}, a)).status, 429);
    assert.equal((await (await request(endpoint, 'GET', undefined, b)).json()).playlists[0].metadata, null);
    const imported = await (await request(endpoint, 'POST', { url: 'https://www.youtube.com/playlist?list=' + id + 'z' }, a)).json();
    assert.equal(imported.playlist.label, 'Official fixture title'); assert.equal(imported.playlist.metadata.itemCount, 12);
    assert.match(imported.playlist.metadata.thumbnailUrl, /^https:\/\/i\.ytimg\.com/);
    assert.ok(!JSON.stringify(imported).includes('test-only-youtube-key'));
    await request(endpoint + '/' + imported.playlist.id, 'PATCH', { label: 'Evening', tags: ['chill'] }, a);
    await request(endpoint + '/' + imported.playlist.id, 'PATCH', { label: '' }, a);
    rows = (await (await request(endpoint, 'GET', undefined, a)).json()).playlists;
    assert.equal(rows.find(row => row.id === imported.playlist.id).label, 'Official fixture title');
    assert.deepEqual(rows.find(row => row.id === imported.playlist.id).tags, ['chill']);
    await restart();
    rows = (await (await request(endpoint, 'GET', undefined, a)).json()).playlists;
    assert.equal(rows.find(row => row.id === 'legacy-default').metadata.channelTitle, 'Fixture creator');
    browser = await chromium.launch({ headless: true }); const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    await page.addInitScript(token => localStorage.setItem('vibe_token', token), a);
    await page.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="purple"/></svg>' }));
    await page.goto(base + '/chat'); await page.locator('.radio-playlist').first().waitFor();
    assert.equal(await page.locator('.radio-playlist img').count(), 3);
    assert.match(await page.locator('#radio-library').textContent(), /Fixture creator/);
    assert.match(await page.locator('#radio-library').textContent(), /12 videos/);
    assert.ok(!(await page.locator('#radio-library').textContent()).includes(id));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    fs.writeFileSync(fixture, JSON.stringify({ title: 'Refreshed official title', delay: 300 }));
    await page.locator('#radio-refresh-metadata').click();
    await page.waitForFunction(() => document.querySelector('#radio-metadata-status').textContent.includes('3 playlists refreshed'));
    assert.match(await page.locator('#radio-library').textContent(), /Refreshed official title/);
    assert.match(await page.locator('#radio-library').textContent(), /My custom mix/);
    await page.reload(); await page.waitForFunction(() => document.querySelector('#radio-library').textContent.includes('Refreshed official title'));

    // Track browser: real rows, artists, durations, availability badges and search.
    const browserTracks = [
      { videoId: videoId(20), title: 'Browser song one', channelTitle: 'Browser artist', duration: 'PT2M10S' },
      { videoId: videoId(21), title: 'Browser song two', channelTitle: 'Another artist', duration: 'PT1M05S' },
      { videoId: videoId(22), title: 'Private Video', channelTitle: 'Hidden artist', privacyStatus: 'private' },
      { videoId: videoId(23), title: 'Blocked song', channelTitle: 'Strict artist', embeddable: false },
      { videoId: videoId(24), title: 'Deleted entry', channelTitle: 'Gone artist', deleted: true }
    ];
    fs.writeFileSync(fixture, JSON.stringify({ title: 'Refreshed official title', tracks: { [id]: browserTracks } }));
    await page.locator('.radio-playlist').filter({ has: page.locator('h4', { hasText: 'Refreshed official title' }) }).first().getByRole('button', { name: 'Tracks' }).click();
    assert.equal(await page.locator('#radio-playlist-title').textContent(), 'Refreshed official title');
    await page.waitForFunction(() => document.querySelectorAll('#radio-tracks .radio-track').length === 5);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'expanded');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'false');
    assert.match(await page.locator('#radio-tracks').textContent(), /Browser song one/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Browser artist · 2:10/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Private/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Embed blocked/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Unavailable/);
    assert.match(await page.locator('#radio-tracks-status').textContent(), /Track list loaded from YouTube/);
    await page.locator('#radio-track-search').fill('another artist');
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), 1);
    await page.locator('#radio-track-search').fill('no such song');
    assert.match(await page.locator('#radio-tracks').textContent(), /No tracks match/);
    await page.locator('#radio-track-search').fill('');
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), 5);
    await page.locator('#radio-stop').click();

    // Track API: authentication, ownership, cache, forced refresh and rate limiting.
    const importedId = imported.playlist.id;
    const trackRoute = endpoint + '/' + importedId + '/tracks';
    assert.equal((await request(trackRoute)).status, 401);
    assert.equal((await request(trackRoute, 'GET', undefined, b)).status, 404);
    assert.equal((await request(endpoint + '/not-a-playlist/tracks', 'GET', undefined, a)).status, 404);
    const apiTracks = [
      { videoId: videoId(30), title: 'API song one', channelTitle: 'API artist', duration: 'PT3M00S' },
      { videoId: videoId(31), title: 'API song two', channelTitle: 'API artist', duration: 'PT4M00S' },
      { videoId: videoId(32), title: 'API private', channelTitle: 'API artist', privacyStatus: 'private' }
    ];
    fs.writeFileSync(fixture, JSON.stringify({ title: 'Refreshed official title', tracks: { [id + 'z']: apiTracks } }));
    const initialCalls = calls().filter(call => call.endpoint === 'playlistItems' && call.playlistId === id + 'z').length;
    let body = await (await request(trackRoute, 'GET', undefined, a)).json();
    assert.equal(body.status, 'available'); assert.equal(body.tracks.length, 3); assert.equal(body.cached, false);
    assert.equal(body.tracks[0].title, 'API song one'); assert.equal(body.tracks[0].durationSeconds, 180);
    assert.equal(body.playlist.metadata.itemCount, 3);
    assert.ok(!JSON.stringify(body).includes('test-only-youtube-key'));
    const afterFirst = calls().filter(call => call.endpoint === 'playlistItems' && call.playlistId === id + 'z').length;
    assert.equal(afterFirst, initialCalls + 1);
    body = await (await request(trackRoute, 'GET', undefined, a)).json();
    assert.equal(body.cached, true);
    assert.equal(calls().filter(call => call.endpoint === 'playlistItems' && call.playlistId === id + 'z').length, afterFirst);
    body = await (await request(trackRoute + '?refresh=1', 'GET', undefined, a)).json();
    assert.equal(body.cached, false);
    assert.equal((await request(trackRoute + '?refresh=1', 'GET', undefined, a)).status, 429);
    const updatedTracks = apiTracks.map((track, index) => ({ ...track, title: 'Updated track ' + (index + 1) }));
    fs.writeFileSync(fixture, JSON.stringify({ title: 'Refreshed official title', tracks: { [id + 'z']: updatedTracks } }));
    await restart();
    body = await (await request(trackRoute + '?refresh=1', 'GET', undefined, a)).json();
    assert.equal(body.cached, false); assert.equal(body.tracks[0].title, 'Updated track 1');
    await page.reload(); await page.waitForFunction(() => document.querySelector('#radio-library').textContent.includes('Refreshed official title'));
    await page.screenshot({ path: path.join(dir, 'metadata-mobile.png'), fullPage: true });
    fs.writeFileSync(fixture, JSON.stringify({ status: 403, reason: 'quotaExceeded' })); await restart();
    response = await (await request(endpoint + '/metadata/refresh', 'POST', {}, a)).json();
    assert.equal(response.metadata.status, 'quota');
    assert.equal(response.playlists.find(row => row.id === 'legacy-default').metadata.title, 'Refreshed official title');
    assert.ok(!JSON.stringify(response).includes('SENSITIVE_UPSTREAM_TEXT'));
    fs.writeFileSync(fixture, JSON.stringify({ unavailable: [id] })); await restart();
    response = await (await request(endpoint + '/metadata/refresh', 'POST', {}, a)).json();
    assert.equal(response.playlists.find(row => row.id === 'legacy-default').metadataStatus, 'unavailable');
    assert.equal(response.playlists.find(row => row.id === 'legacy-default').metadata.title, 'Refreshed official title');
    const recorded = calls();
    assert.ok(recorded.every(call => !call.keyInURL));
    assert.ok(recorded.filter(call => call.endpoint === 'playlists').every(call => !call.ids.includes(id + 'y')));
    console.log('Metadata fixture artifacts:', dir);
  } finally { await browser?.close(); if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
});
