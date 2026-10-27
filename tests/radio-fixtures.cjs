// Shared deterministic fixtures for Radio tests. Never loaded by the application.
const VIDEO_PREFIX = 'vid';

function videoId(index) {
  return VIDEO_PREFIX + String(index).padStart(8, '0');
}

function track(index, overrides = {}) {
  return {
    videoId: videoId(index),
    title: 'Fixture track ' + (index + 1),
    channelTitle: 'Fixture artist',
    duration: 'PT3M5S',
    ...overrides
  };
}

function defaultTracks(count = 5) {
  return Array.from({ length: count }, (_, index) => track(index));
}

// Minimal IFrame API double. It emits the same state transitions the real player
// uses and records the documented commands the app sends.
const playerFixture = `window.YT = { Player: class {
  constructor(id, options) {
    this.options = options; this.index = 0; this.state = -1; this.time = 0; this.duration = 245;
    this.volume = 100; this.muted = false; this.playlistIds = this.ids(); this.list = null;
    window.__fixtureCommands = []; window.testPlayer = this; window.playerCount = (window.playerCount || 0) + 1;
    const frame = document.createElement('iframe'); frame.title = 'YouTube test player'; frame.src = 'about:blank';
    document.getElementById(id).replaceWith(frame); this.frame = frame;
    this.log('create');
    setTimeout(() => options.events.onReady({ target: this }), 10);
  }
  ids() {
    if (Array.isArray(window.__radioFixtureIds)) return window.__radioFixtureIds.slice();
    return Array.from({ length: 60 }, (_, i) => 'vid' + String(i).padStart(8, '0'));
  }
  log(command, value) { (window.__fixtureCommands = window.__fixtureCommands || []).push({ command, value }); }
  emit(data) { this.state = data; this.options.events.onStateChange({ data, target: this }); }
  cuePlaylist(value) {
    if (typeof value === 'string') { this.list = value; this.index = 0; }
    else { this.list = value.list; this.index = Number(value.index) || 0; }
    this.playlistIds = this.ids(); this.index = Math.max(0, Math.min(this.index, this.playlistIds.length - 1));
    this.time = 0; this.log('cuePlaylist', { list: this.list, index: this.index }); this.emit(5);
  }
  loadPlaylist(value) {
    if (typeof value === 'string') { this.list = value; this.index = 0; }
    else { this.list = value.list; this.index = Number(value.index) || 0; }
    this.playlistIds = this.ids(); this.index = Math.max(0, Math.min(this.index, this.playlistIds.length - 1));
    this.time = 0; this.log('loadPlaylist', { list: this.list, index: this.index }); this.emit(5); this.emit(1);
  }
  playVideo() { this.log('playVideo'); this.emit(1); }
  pauseVideo() { this.log('pauseVideo'); this.emit(2); }
  nextVideo() { this.log('nextVideo'); this.index = Math.min(this.index + 1, this.playlistIds.length - 1); this.time = 0; this.emit(1); }
  previousVideo() { this.log('previousVideo'); this.index = Math.max(this.index - 1, 0); this.time = 0; this.emit(1); }
  activeList() { return Array.isArray(window.__radioFixtureIds) ? window.__radioFixtureIds : this.playlistIds; }
  playVideoAt(position) {
    this.log('playVideoAt', position); this.index = Math.max(0, Math.min(Number(position) || 0, this.activeList().length - 1));
    this.time = 0; this.emit(1);
  }
  seekTo(seconds) { this.time = Number(seconds) || 0; this.log('seekTo', this.time); }
  getCurrentTime() { return this.time; }
  getDuration() { return this.duration; }
  getVolume() { return this.volume; }
  setVolume(value) { this.volume = Number(value) || 0; this.log('setVolume', this.volume); }
  mute() { this.muted = true; this.log('mute'); }
  unMute() { this.muted = false; this.log('unMute'); }
  isMuted() { return this.muted; }
  getPlaylist() { return this.activeList().slice(); }
  getPlaylistIndex() { return this.index; }
  getVideoData() { return { video_id: this.activeList()[this.index], title: 'Fixture video ' + this.index, author: 'Fixture channel' }; }
  getPlayerState() { return this.state; }
  getIframe() { return this.frame; }
  addEventListener() {}
  destroy() { this.log('destroy'); this.frame.remove(); this.state = -1; }
} }; window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();`;

module.exports = { videoId, track, defaultTracks, playerFixture };
