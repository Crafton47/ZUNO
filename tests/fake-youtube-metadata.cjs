// Test-only interception of the official endpoints; production has no alternate metadata host.
const fs = require('node:fs');
const { defaultTracks } = require('./radio-fixtures.cjs');
const realFetch = global.fetch;
const ENDPOINTS = new Set(['/youtube/v3/playlists', '/youtube/v3/playlistItems', '/youtube/v3/videos']);
const MAX_PAGE_SIZE = 50;

function readFixture() {
  return JSON.parse(fs.readFileSync(process.env.RADIO_METADATA_FIXTURE, 'utf8'));
}

function record(entry) {
  fs.appendFileSync(process.env.RADIO_METADATA_FIXTURE + '.calls', JSON.stringify(entry) + '\n');
}

function upstreamError(status, reason) {
  return Response.json({ error: { errors: [{ reason }], message: 'SENSITIVE_UPSTREAM_TEXT' } }, { status });
}

function thumbnail(videoId) {
  return { high: { url: 'https://i.ytimg.com/vi/' + (videoId || 'KIViy7L_lo8') + '/hqdefault.jpg' } };
}

function playlistInfo(mode, id) {
  return mode.playlists?.[id] || {};
}

function tracksFor(mode, playlistId) {
  const configured = mode.tracks?.[playlistId];
  if (Array.isArray(configured)) return configured;
  if (Array.isArray(mode.defaultTracks)) return mode.defaultTracks;
  return defaultTracks(5);
}

function trackIndex(mode) {
  const index = new Map();
  const lists = Object.values(mode.tracks || {});
  if (!lists.length) lists.push(defaultTracks(5));
  for (const list of lists) for (const item of list) if (item?.videoId) index.set(item.videoId, item);
  for (const item of defaultTracks(5)) if (!index.has(item.videoId)) index.set(item.videoId, item);
  return index;
}

global.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.origin !== 'https://www.googleapis.com' || !ENDPOINTS.has(url.pathname)) return realFetch(input, options);
  if (options.headers?.['X-Goog-Api-Key'] !== 'test-only-youtube-key') throw new Error('Test key not set');
  const mode = readFixture();
  if (mode.delay) await new Promise(resolve => setTimeout(resolve, mode.delay));
  const endpoint = url.pathname.split('/').pop();

  if (endpoint === 'playlists') {
    const ids = (url.searchParams.get('id') || '').split(',').filter(Boolean);
    record({ endpoint, ids, origin: url.origin, keyInURL: url.searchParams.has('key') });
    if (mode.status) return upstreamError(mode.status, mode.reason);
    if (mode.malformed) return Response.json({ surprise: true });
    const items = ids.filter(id => {
      const info = playlistInfo(mode, id);
      return !mode.unavailable?.includes(id) && !info.unavailable;
    }).map(id => {
      const info = playlistInfo(mode, id);
      const configuredTracks = mode.tracks?.[id];
      return {
        id,
        snippet: {
          title: info.title || mode.title || 'Official fixture title',
          channelTitle: info.channelTitle || 'Fixture creator',
          thumbnails: thumbnail(info.videoId || 'KIViy7L_lo8')
        },
        contentDetails: { itemCount: info.itemCount ?? (Array.isArray(configuredTracks) ? configuredTracks.length : 12) }
      };
    });
    return Response.json({ items });
  }

  if (endpoint === 'playlistItems') {
    const playlistId = url.searchParams.get('playlistId') || '';
    const offset = Math.max(0, Number(url.searchParams.get('pageToken')) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(url.searchParams.get('maxResults')) || MAX_PAGE_SIZE));
    record({ endpoint, playlistId, pageToken: offset || null, origin: url.origin, keyInURL: url.searchParams.has('key') });
    if (mode.playlistItemsStatus || mode.trackStatus) return upstreamError(mode.playlistItemsStatus || mode.trackStatus, mode.reason);
    if (mode.malformedTracks) return Response.json({ surprise: true });
    const list = tracksFor(mode, playlistId);
    const page = list.slice(offset, offset + pageSize);
    const items = page.map(item => {
      const title = item.deleted ? 'Deleted video' : item.title;
      const snippet = {
        title,
        channelTitle: item.channelTitle || 'Fixture artist',
        videoOwnerChannelTitle: item.channelTitle || 'Fixture artist',
        thumbnails: thumbnail(item.videoId)
      };
      if (item.videoId) snippet.resourceId = { kind: 'youtube#video', videoId: item.videoId };
      return {
        snippet,
        contentDetails: item.videoId ? { videoId: item.videoId } : {},
        ...(item.privacyStatus ? { status: { privacyStatus: item.privacyStatus } } : {})
      };
    });
    const next = offset + pageSize;
    const body = { items };
    if (!mode.dropNextPageToken && next < list.length) body.nextPageToken = String(next);
    return Response.json(body);
  }

  const ids = (url.searchParams.get('id') || '').split(',').filter(Boolean);
  record({ endpoint, ids, origin: url.origin, keyInURL: url.searchParams.has('key') });
  if (mode.videosStatus) return upstreamError(mode.videosStatus, mode.reason);
  if (mode.malformedVideos) return Response.json({ surprise: true });
  const known = trackIndex(mode);
  const items = ids.filter(id => !mode.omitVideoIds?.includes(id)).map(id => {
    const item = known.get(id) || {};
    if (item.deleted || item.omitFromVideos) return null;
    return {
      id,
      snippet: {
        title: item.title || 'Fixture video ' + id,
        channelTitle: item.channelTitle || 'Fixture artist',
        thumbnails: thumbnail(id)
      },
      contentDetails: { duration: item.duration === null ? undefined : item.duration || 'PT3M5S' },
      status: {
        embeddable: item.embeddable !== false,
        privacyStatus: item.privacyStatus || 'public'
      }
    };
  }).filter(Boolean);
  return Response.json({ items });
};
