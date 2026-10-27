'use strict';
// Only the official, fixed-origin YouTube Data API v3 is queried. Never fetch a submitted URL.
const API_ORIGIN = 'https://www.googleapis.com';
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,120}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PAGE_SIZE = 50;
const DEFAULT_MAX_PAGES = 20;

function apiKey() {
  return (process.env.YOUTUBE_API_KEY ?? process.env.Youtube_API_KEY ?? '').trim();
}

function thumbnailUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(?:i\d?\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)$/.test(url.hostname)) return url.href;
  } catch {}
  return null;
}

function bestThumbnail(thumbnails) {
  const sizes = thumbnails || {};
  return ['maxres', 'standard', 'high', 'medium', 'default'].map(size => thumbnailUrl(sizes[size]?.url)).find(Boolean) || null;
}

function classify(response, data) {
  const reasons = (Array.isArray(data?.error?.errors) ? data.error.errors : []).map(error => error.reason);
  if (response.status === 429 || reasons.some(reason => ['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason))) {
    return { status: 'quota', message: 'YouTube metadata quota is temporarily exhausted. Saved details and playback are unchanged; try again later.' };
  }
  if ([400, 401, 403].includes(response.status)) {
    return { status: 'configuration_error', message: 'Metadata access was denied. Check the server YouTube Data API key, API enablement and key restrictions.' };
  }
  if (response.status === 404) {
    return { status: 'unavailable', message: 'This playlist is no longer available on YouTube.' };
  }
  return { status: 'temporary_error', message: 'YouTube metadata is temporarily unavailable. Your saved playlists are safe; retry later.' };
}

async function request(url, { key, fetchImpl }) {
  try {
    // Header avoids placing the key in URL/query diagnostics. No upstream errors are logged or returned.
    return await fetchImpl(url, { headers: { 'X-Goog-Api-Key': key }, signal: AbortSignal.timeout(10000), redirect: 'error' });
  } catch {
    return null;
  }
}

async function fetchMetadata(ids, { apiKey: key = apiKey(), fetchImpl = fetch } = {}) {
  if (!key?.trim()) return { status: 'unconfigured', message: 'Saved links still play. Automatic titles and artwork need a server-side YOUTUBE_API_KEY.' };
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id => typeof id !== 'string' || !PLAYLIST_ID.test(id))) throw new Error('Invalid metadata IDs');
  const url = new URL(API_ORIGIN + '/youtube/v3/playlists');
  url.searchParams.set('part', 'snippet,contentDetails'); url.searchParams.set('id', ids.join(',')); url.searchParams.set('maxResults', '50');
  const response = await request(url, { key: key.trim(), fetchImpl });
  if (!response) return { status: 'temporary_error', message: 'Could not reach YouTube metadata. Your saved playlists are safe; retry later.' };
  let data;
  try { data = await response.json(); } catch { return { status: 'temporary_error', message: 'YouTube returned an incomplete response. Existing details were kept.' }; }
  if (!response.ok) return classify(response, data);
  if (!Array.isArray(data?.items)) return { status: 'temporary_error', message: 'YouTube returned incomplete metadata. Existing details were kept.' };
  const items = new Map();
  for (const item of data.items) {
    if (!ids.includes(item?.id)) continue;
    const title = item.snippet?.title;
    if (typeof title !== 'string' || !title.trim()) continue;
    items.set(item.id, {
      title: title.trim().slice(0, 300), thumbnailUrl: bestThumbnail(item.snippet.thumbnails),
      channelTitle: typeof item.snippet.channelTitle === 'string' ? item.snippet.channelTitle.slice(0, 200) : null,
      itemCount: Number.isSafeInteger(item.contentDetails?.itemCount) && item.contentDetails.itemCount >= 0 ? item.contentDetails.itemCount : null,
      fetchedAt: new Date().toISOString()
    });
  }
  // An existing item with malformed fields is not evidence of deletion.
  const malformed = data.items.some(item => ids.includes(item?.id) && !items.has(item.id));
  if (malformed) return { status: 'temporary_error', message: 'YouTube returned incomplete metadata. Existing details were kept.' };
  return { status: 'available', items, message: 'Playlist metadata refreshed from YouTube.' };
}

function parseDuration(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  const seconds = Number(match[1] || 0) * 86400 + Number(match[2] || 0) * 3600 + Number(match[3] || 0) * 60 + Number(match[4] || 0);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

function unavailableTitle(title) {
  return /^(?:deleted video|private video|\[deleted video\]|\[private video\])$/i.test(String(title || '').trim());
}

/**
 * Fetches every accessible page of a playlist, then enriches entries with video durations and status.
 * Keeps the playlist's original order and returns explicit per-entry availability instead of dropping rows.
 */
async function fetchPlaylistTracks(value, { apiKey: key = apiKey(), fetchImpl = fetch, maxPages = DEFAULT_MAX_PAGES } = {}) {
  if (!PLAYLIST_ID.test(String(value || ''))) throw new Error('Invalid playlist ID');
  if (!key?.trim()) return { status: 'unconfigured', message: 'A server-side YOUTUBE_API_KEY is needed to browse individual tracks. The YouTube player still works without it.', playlist: null, tracks: [] };
  const limited = Math.min(Math.max(Number(maxPages) || DEFAULT_MAX_PAGES, 1), 40);

  const infoUrl = new URL(API_ORIGIN + '/youtube/v3/playlists');
  infoUrl.searchParams.set('part', 'snippet,contentDetails'); infoUrl.searchParams.set('id', value); infoUrl.searchParams.set('maxResults', '1');
  const infoResponse = await request(infoUrl, { key: key.trim(), fetchImpl });
  let info = null;
  if (infoResponse) {
    let infoData = null;
    try { infoData = await infoResponse.json(); } catch {}
    if (!infoResponse.ok) { const failure = classify(infoResponse, infoData); if (failure.status !== 'temporary_error') return { ...failure, playlist: null, tracks: [] }; }
    else {
      if (!Array.isArray(infoData?.items)) return { status: 'temporary_error', message: 'YouTube returned incomplete playlist details. Your saved playlist is unchanged; retry later.', playlist: null, tracks: [] };
      const item = infoData.items.find(entry => entry?.id === value);
      if (!item) return { status: 'unavailable', message: 'This playlist is private, deleted, or not accessible with the server API key. Nothing was fabricated.', playlist: null, tracks: [] };
      info = {
        youtubeId: value,
        title: typeof item.snippet?.title === 'string' ? item.snippet.title.trim().slice(0, 300) : null,
        channelTitle: typeof item.snippet?.channelTitle === 'string' ? item.snippet.channelTitle.slice(0, 200) : null,
        thumbnailUrl: bestThumbnail(item.snippet?.thumbnails),
        itemCount: Number.isSafeInteger(item.contentDetails?.itemCount) && item.contentDetails.itemCount >= 0 ? item.contentDetails.itemCount : null
      };
    }
  }

  const entries = [];
  let pageToken = '';
  let pages = 0;
  let truncated = false;
  let failure = null;
  while (pages < limited) {
    const url = new URL(API_ORIGIN + '/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet,contentDetails'); url.searchParams.set('playlistId', value); url.searchParams.set('maxResults', String(PAGE_SIZE));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await request(url, { key: key.trim(), fetchImpl });
    if (!response) { failure = { status: 'temporary_error', message: 'Could not reach YouTube while listing tracks. Try again later.' }; break; }
    let data;
    try { data = await response.json(); } catch { failure = { status: 'temporary_error', message: 'YouTube returned an incomplete track list. Try again later.' }; break; }
    if (!response.ok) { failure = classify(response, data); break; }
    if (!Array.isArray(data?.items)) { failure = { status: 'temporary_error', message: 'YouTube returned an incomplete track list. Try again later.' }; break; }
    for (const item of data.items) {
      const snippet = item?.snippet || {};
      const videoId = item?.contentDetails?.videoId || snippet?.resourceId?.videoId || null;
      entries.push({
        videoId: typeof videoId === 'string' && VIDEO_ID.test(videoId) ? videoId : null,
        title: typeof snippet.title === 'string' ? snippet.title.trim().slice(0, 300) : null,
        channelTitle: typeof snippet.videoOwnerChannelTitle === 'string' ? snippet.videoOwnerChannelTitle.slice(0, 200)
          : typeof snippet.channelTitle === 'string' ? snippet.channelTitle.slice(0, 200) : null,
        thumbnailUrl: bestThumbnail(snippet.thumbnails),
        privacyStatus: typeof item?.status?.privacyStatus === 'string' ? item.status.privacyStatus : null
      });
    }
    pages++;
    pageToken = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
    if (!pageToken) break;
    if (pages >= limited) truncated = true;
  }

  if (!entries.length && failure) return { ...failure, playlist: info, tracks: [], truncated: false };
  if (info && info.itemCount !== null && entries.length > 0 && !truncated && entries.length < info.itemCount) {
    // API pages can omit entries the caller cannot see; never invent them.
    truncated = entries.length < info.itemCount;
  }

  const unique = [...new Set(entries.map(entry => entry.videoId).filter(Boolean))];
  const videos = new Map();
  let complete = true;
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const url = new URL(API_ORIGIN + '/youtube/v3/videos');
    url.searchParams.set('part', 'snippet,contentDetails,status'); url.searchParams.set('id', batch.join(',')); url.searchParams.set('maxResults', '50');
    const response = await request(url, { key: key.trim(), fetchImpl });
    if (!response) { complete = false; break; }
    let data;
    try { data = await response.json(); } catch { complete = false; break; }
    if (!response.ok) { complete = false; break; }
    if (!Array.isArray(data?.items)) { complete = false; break; }
    for (const item of data.items) {
      if (!batch.includes(item?.id)) continue;
      videos.set(item.id, {
        title: typeof item.snippet?.title === 'string' ? item.snippet.title.trim().slice(0, 300) : null,
        channelTitle: typeof item.snippet?.channelTitle === 'string' ? item.snippet.channelTitle.slice(0, 200) : null,
        thumbnailUrl: bestThumbnail(item.snippet?.thumbnails),
        durationSeconds: parseDuration(item.contentDetails?.duration),
        embeddable: item.status?.embeddable !== false,
        privacyStatus: typeof item.status?.privacyStatus === 'string' ? item.status.privacyStatus : null
      });
    }
  }

  const tracks = entries.map((entry, index) => {
    const video = entry.videoId ? videos.get(entry.videoId) : null;
    const deleted = unavailableTitle(entry.title);
    const missing = !entry.videoId;
    const privateVideo = video?.privacyStatus === 'private' || entry.privacyStatus === 'private' || /private video/i.test(entry.title || '');
    const unavailable = missing || deleted || privateVideo || (complete && entry.videoId && !video);
    const restricted = !!video && video.embeddable === false;
    const title = (video?.title || entry.title || (deleted ? 'Unavailable video' : 'Untitled track')).slice(0, 300);
    return {
      index,
      videoId: entry.videoId,
      title,
      channelTitle: video?.channelTitle || entry.channelTitle || null,
      thumbnailUrl: entry.thumbnailUrl || video?.thumbnailUrl || (entry.videoId ? 'https://i.ytimg.com/vi/' + entry.videoId + '/mqdefault.jpg' : null),
      durationSeconds: video?.durationSeconds ?? null,
      unavailable: !!unavailable,
      restricted,
      privacyStatus: video?.privacyStatus || entry.privacyStatus || null
    };
  });

  return {
    status: 'available',
    message: complete
      ? (truncated ? 'Showing the first available pages YouTube returned for this playlist.' : 'Track list loaded from YouTube.')
      : 'Track list loaded, but YouTube did not return every duration or availability detail.',
    partial: !complete,
    truncated,
    playlist: info,
    tracks,
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { fetchMetadata, fetchPlaylistTracks, thumbnailUrl, parseDuration };
