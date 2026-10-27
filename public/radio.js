'use strict';
(() => {
  // Study opened inside the dashboard shares the parent player; never create a second one.
  if (window.parent !== window) {
    document.querySelectorAll('a[href^="/chat"]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); parent.postMessage({ type: 'zuno-study-navigate', hash: new URL(a.href).hash }, location.origin); }));
    return;
  }
  const token = localStorage.getItem('vibe_token');
  if (!token) return;
  const $ = id => document.getElementById(id);
  const moods = {
    hyped: ['⚡', 'Hyped', 'Give that energy somewhere to go.', 'action', 2, '#ff765e'],
    chill: ['🌙', 'Chill', 'A softer soundtrack and a little escape.', 'comedy', 3, '#925bff'],
    low: ['🌧️', 'Low', 'No pressure to cheer up. Take this at your pace.', 'animated', 1, '#5275ff'],
    focus: ['🎯', 'Focus', 'Your soundtrack now. A movie for your next break.', 'scifi', 5, '#b9f44d'],
    tired: ['🪫', 'Tired', 'Less noise. More room to recharge.', 'animated', 8, '#f5b7e8'],
    bored: ['🎲', 'Bored', 'A small change of scene starts here.', 'scifi', 4, '#39e8ff']
  };
  const user = (() => { try { return JSON.parse(localStorage.getItem('vibe_user') || '{}'); } catch { return {}; } })();
  const preferenceKey = 'zuno-radio-pause:' + (user.id || 'local');
  const stateKey = 'zuno-radio-state:' + (user.id || 'local');
  let playlists = [], selected = 'chill', offset = 0, loading = true, libraryError = '';
  let current = null, player = null, ready = false, state = -1, errorCode = null;
  let layout = 'mini', playIntent = false, playlistReady = false, activation = 0, instance = 0;
  let tracks = [], activeIndex = -1, tracksRequest = 0, tracksState = { status: 'idle', message: '' };
  let currentVideoId = null, currentTitle = '', currentArtist = '', searchTerm = '';
  let loadTimer, progressTimer, apiTimer, apiPromise, pending = null, settleTimer, lastRenderedTrack = -1;
  let volume = 70, muted = false, draggingSeek = false, live = false;
  const FLOAT_WIDTH = 202, FLOAT_HEIGHT = 274;
  let position = null, dragState = null, resizeFrame = 0;
  const diagnostics = [];
  let editId = null, deleteId = null;
  const room = $('zuno-radio');

  function node(tag, text, cls) { const el = document.createElement(tag); if (text) el.textContent = text; if (cls) el.className = cls; return el; }
  function button(text, action, cls) { const el = node('button', text, cls); el.type = 'button'; el.onclick = action; return el; }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const total = Math.floor(seconds); const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function trackThumb(id) { return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : null; }
  function watchUrl(id) { return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? 'https://www.youtube.com/watch?v=' + id : null; }
  function playlistUrl(item = current) { return item ? (item.url || 'https://www.youtube.com/playlist?list=' + item.youtubeId) : 'https://www.youtube.com/'; }

  async function api(path = '', method = 'GET', body) {
    const response = await fetch('/api/companion/radio/playlists' + path, { method, signal: AbortSignal.timeout(25000), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || 'Could not load your Radio library. Please retry.');
    return data;
  }

  // ── Markup ───────────────────────────────────────────────────
  const dock = node('aside', '', 'radio-dock'); dock.id = 'radio-dock'; dock.hidden = true;
  dock.dataset.layout = 'mini'; dock.dataset.playing = 'false'; dock.setAttribute('aria-label', 'ZUNO Radio player');
  dock.innerHTML = `
    <div class="radio-float">
      <div class="radio-drag" id="radio-drag" role="group" aria-label="ZUNO Radio player">
        <button class="radio-grip" id="radio-grip" type="button" aria-label="Move the ZUNO Radio player. Drag, or use arrow keys to nudge it. Press Home to reset the position." title="Drag to move · arrow keys to nudge · Home resets">⠿</button>
        <button class="radio-float-copy" id="radio-float-open" type="button" aria-label="Open the full ZUNO Radio player" title="Open the full player">
          <strong id="radio-float-title">ZUNO Radio</strong>
          <small id="radio-float-artist">Pick a playlist</small>
        </button>
        <button class="radio-float-tool" id="radio-float-reset" type="button" aria-label="Reset the player position" title="Reset position">⌂</button>
        <button class="radio-float-tool" id="radio-float-expand" type="button" aria-label="Open the full player" title="Open the full player">⤢</button>
      </div>
      <div class="radio-visual" aria-hidden="false">
        <div id="radio-video"><div id="youtube-player"></div></div>
        <div class="radio-beat" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="radio-float-controls">
        <button id="radio-float-toggle" type="button" aria-label="Play" disabled>▶</button>
        <button id="radio-float-next" type="button" aria-label="Next track" title="Next track" disabled>⏭</button>
        <span id="radio-float-elapsed">0:00</span>
        <button id="radio-float-mini" type="button" aria-label="Minimize to the compact paused bar" title="Minimize (pauses)">—</button>
      </div>
      <span class="radio-float-line" aria-hidden="true"><i id="radio-float-progress"></i></span>
      <span id="radio-float-announce" class="radio-sr" role="status" aria-live="polite"></span>
    </div>
    <div class="radio-bar" id="radio-mini">
      <button class="radio-mini-art" id="radio-mini-expand" type="button" aria-label="Expand ZUNO Radio">
        <img id="radio-mini-image" alt="" hidden decoding="async">
        <span class="radio-mini-disc" aria-hidden="true">♫</span>
      </button>
      <div class="radio-mini-copy">
        <strong id="radio-mini-title">ZUNO Radio</strong>
        <small id="radio-mini-artist">Pick a playlist to begin</small>
      </div>
      <div class="radio-mini-actions">
        <button id="radio-mini-toggle" type="button" aria-label="Play" disabled>▶</button>
        <button id="radio-mini-next" type="button" aria-label="Next track" title="Next track" disabled>⏭</button>
        <button id="radio-mini-open" type="button" aria-label="Expand player" title="Expand player">⤢</button>
      </div>
      <span class="radio-mini-line" aria-hidden="true"><i id="radio-mini-progress"></i></span>
    </div>
    <div class="radio-expanded" id="radio-expanded">
      <header class="radio-head">
        <div class="radio-brand"><span class="radio-brand-mark" aria-hidden="true">♫</span><span><b>ZUNO Radio</b><small>from your own library</small></span></div>
        <div class="radio-head-actions">
          <button id="radio-open" type="button">Open library</button>
          <button id="radio-stop" type="button">Close</button>
          <button id="radio-expand" type="button" aria-expanded="true" aria-label="Switch to the mini player">▼ Mini player</button>
        </div>
      </header>
      <div class="radio-now">
        <div class="radio-now-copy">
          <span id="radio-playlist-title" class="radio-playlist-tag">ZUNO Radio</span>
          <strong id="radio-track">Choose your soundtrack</strong>
          <span id="radio-artist" class="radio-artist">Your saved YouTube playlist</span>
          <p id="radio-status" role="status" aria-live="polite">Ready when you are</p>
        </div>
        <div class="radio-art-row">
          <img id="radio-thumbnail" alt="" hidden decoding="async">
          <div class="radio-vinyl" aria-hidden="true">♫</div>
        </div>
        <div class="radio-seek-row">
          <span id="radio-elapsed">0:00</span>
          <input id="radio-seek" type="range" min="0" max="100" step="1" value="0" aria-label="Seek within current track" disabled>
          <span id="radio-duration">--:--</span>
        </div>
        <div class="radio-controls">
          <button id="radio-prev" type="button" aria-label="Previous track" disabled title="Previous track">⏮</button>
          <button id="radio-toggle" type="button" class="radio-play" disabled aria-label="Play">▶</button>
          <button id="radio-next" type="button" aria-label="Next track" disabled title="Next track">⏭</button>
          <button id="radio-retry" type="button" disabled>Retry</button>
        </div>
        <div class="radio-volume-row">
          <button id="radio-mute" type="button" aria-label="Mute" aria-pressed="false" disabled>🔊</button>
          <input id="radio-volume" type="range" min="0" max="100" step="1" value="70" aria-label="Volume">
          <a id="radio-open-track" href="#" target="_blank" rel="noopener noreferrer">Open track ↗</a>
          <a id="radio-youtube" target="_blank" rel="noopener noreferrer">Playlist ↗</a>
        </div>
      </div>
      <section class="radio-browser" aria-labelledby="radio-browser-heading">
        <header class="radio-browser-head">
          <div>
            <span class="eyebrow">PLAYLIST</span>
            <h3 id="radio-browser-heading">Tracks</h3>
            <p id="radio-playlist-meta">Choose a track to play it in order.</p>
          </div>
          <div class="radio-browser-actions">
            <button id="radio-tracks-refresh" type="button">Refresh tracks</button>
            <a id="radio-open-playlist" href="#" target="_blank" rel="noopener noreferrer">YouTube ↗</a>
          </div>
        </header>
        <label class="radio-search" for="radio-track-search"><span aria-hidden="true">⌕</span><input id="radio-track-search" type="search" maxlength="120" placeholder="Search this playlist by song or artist" autocomplete="off"></label>
        <p id="radio-tracks-status" class="radio-tracks-status" role="status" aria-live="polite"></p>
        <div id="radio-tracks" class="radio-tracks" role="list" aria-label="Playlist tracks"></div>
      </section>
      <details class="radio-diagnostics"><summary>Playback diagnostics</summary><p>Technical details for troubleshooting. Hidden unless you open it.</p><pre id="radio-diagnostics"></pre></details>
    </div>`;
  document.body.append(dock);

  const dialog = node('dialog', '', 'radio-dialog'); dialog.id = 'radio-edit';
  dialog.innerHTML = `<form id="radio-edit-form"><h2>Edit your playlist</h2><label for="radio-label">Your name for this playlist (optional)</label><input id="radio-label" maxlength="100"><p>Leave empty to use the real YouTube title. Your label, mood tags and the original YouTube details stay separate.</p><fieldset id="radio-tags"><legend>Mood tags · choose any</legend></fieldset><p id="radio-edit-error" role="alert"></p><div class="radio-actions"><button type="button" id="radio-edit-cancel">Cancel</button><button class="radio-primary">Save changes</button></div></form>`;
  document.body.append(dialog);

  const deletion = node('dialog', '', 'radio-dialog'); deletion.id = 'radio-delete';
  deletion.innerHTML = `<h2>Remove this playlist?</h2><p id="radio-delete-name"></p><p>This removes the reference from ZUNO. Your YouTube playlist stays unchanged.</p><p id="radio-delete-error" role="alert"></p><div class="radio-actions"><button id="radio-delete-cancel" type="button">Keep playlist</button><button id="radio-delete-confirm" type="button">Remove playlist</button></div>`;
  document.body.append(deletion);

  for (const [key, mood] of Object.entries(moods)) {
    const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.value = key; input.name = 'mood';
    label.append(input, document.createTextNode(mood[0] + ' ' + mood[1])); $('radio-tags').append(label);
  }

  if (room) {
    room.innerHTML = `<div class="radio-room-heading"><div><span class="eyebrow">YOUR OWN LITTLE FREQUENCY</span><h2 id="radio-heading">ZUNO <em>Radio.</em></h2><p>Your playlists, real titles, every track. Pick a song, press play and stay a while.</p></div><span class="radio-mark" aria-hidden="true">♫</span></div>
      <form id="radio-import"><label for="radio-url">Add a public YouTube playlist</label><div class="radio-import-row"><input id="radio-url" type="url" required maxlength="2048" placeholder="https://www.youtube.com/playlist?list=…"><button class="radio-primary">+ Add playlist</button></div><p class="radio-help">ZUNO reads the playlist's real title, artwork and track list from YouTube. Availability is confirmed by the player when you press play.</p><p id="radio-import-status" role="status"></p></form>
      <div class="radio-library-heading"><h3>Your collection</h3><div class="radio-actions"><button id="radio-refresh">↻ Reload library</button><button id="radio-refresh-metadata">Refresh metadata</button></div></div><p id="radio-metadata-status" role="status"></p><div id="radio-library" aria-live="polite"></div>
      <label class="radio-preference"><input id="radio-pause-live" type="checkbox"> Pause music when ZUNO Live starts</label>
      <p class="radio-help">Playback uses YouTube's official visible player, so music keeps going in other tabs and when the window is minimized. Closing the tab, a full page refresh or logging out stops it. Ads, regional limits and embedding permissions are controlled by YouTube.</p>`;
    $('radio-pause-live').checked = localStorage.getItem(preferenceKey) !== 'false';
    $('radio-pause-live').onchange = () => localStorage.setItem(preferenceKey, String($('radio-pause-live').checked));
    $('radio-refresh').onclick = refresh;
    $('radio-refresh-metadata').onclick = async () => {
      const control = $('radio-refresh-metadata'); control.disabled = true;
      $('radio-metadata-status').textContent = 'Fetching real titles and artwork from YouTube…'; $('radio-library').classList.add('radio-skeleton'); $('radio-library').setAttribute('aria-busy', 'true');
      try {
        const data = await api('/metadata/refresh', 'POST', {}); playlists = data.playlists; if (current) current = playlists.find(item => item.id === current.id) || current;
        renderLibrary(); renderMood(); renderNow(); $('radio-metadata-status').textContent = data.metadata.message;
      } catch (err) { $('radio-metadata-status').textContent = err.message; }
      finally { control.disabled = false; $('radio-library').classList.remove('radio-skeleton'); $('radio-library').setAttribute('aria-busy', 'false'); }
    };
    $('radio-import').onsubmit = async e => {
      e.preventDefault(); const submit = e.target.querySelector('button'); submit.disabled = true;
      $('radio-import-status').textContent = 'Saving playlist and fetching its real YouTube details…'; $('radio-library').classList.add('radio-skeleton');
      try {
        const data = await api('', 'POST', { url: $('radio-url').value }); $('radio-url').value = ''; await refresh();
        $('radio-import-status').textContent = 'Saved. ' + (data.metadata?.message || 'Add mood tags with Edit.');
      } catch (err) { $('radio-import-status').textContent = err.message; }
      finally { submit.disabled = false; $('radio-library').classList.remove('radio-skeleton'); }
    };
  }

  function openLibrary() {
    if (!room) { location.href = '/chat#zuno-radio'; return; }
    setLayout(isPlaying() ? 'float' : 'mini');
    location.hash = 'zuno-radio'; room.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function setStatus(message) { $('radio-status').textContent = message; $('radio-mini-artist').title = message; renderMood(); }
  function record(event, code) {
    const entry = { event, code, index: activeIndex, playlist: current?.youtubeId, origin: location.origin, time: new Date().toISOString() };
    diagnostics.push(entry); if (diagnostics.length > 30) diagnostics.shift();
    $('radio-diagnostics').textContent = diagnostics.map(item => JSON.stringify(item)).join('\n');
    if (event === 'error') console.warn('[ZUNO Radio] YouTube error', entry);
  }
  function saveState() {
    try {
      localStorage.setItem(stateKey, JSON.stringify({ playlistId: current?.id || null, index: activeIndex, volume, muted, layout, pos: position }));
    } catch {}
  }
  function readState() { try { return JSON.parse(localStorage.getItem(stateKey) || 'null') || {}; } catch { return {}; } }
  function savedPosition() {
    const pos = readState().pos;
    return pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? { x: Math.round(pos.x), y: Math.round(pos.y) } : null;
  }

  // ── Layout ───────────────────────────────────────────────────
  // `expanded` is the full studio. `float` is the draggable player that keeps
  // YouTube's required 200 × 200 visible viewport, so audio can keep playing.
  // `mini` is a compact bar: a 66 px row cannot legally host a playing embed,
  // so entering it pauses first and only resumes by returning to the video.
  function isPlaying() { return state === 1 || state === 3 || playIntent; }
  function setLayout(next) {
    const target = ['expanded', 'float', 'mini'].includes(next) ? next : 'mini';
    if (target === 'mini' && isPlaying()) pause();
    layout = target;
    dock.dataset.layout = target;
    dock.classList.toggle('expanded', target === 'expanded');
    dock.classList.toggle('float', target === 'float');
    dock.classList.toggle('mini', target === 'mini');
    document.body.classList.toggle('radio-expanded-open', target === 'expanded');
    if (target === 'float') {
      dock.hidden = false;
      if (!position) position = savedPosition();
      applyPosition(position || defaultPosition());
    } else {
      resetDockOffset();
    }
    const expanded = target === 'expanded';
    const playing = isPlaying();
    $('radio-expand').textContent = playing ? '▼ Float player' : '▼ Mini player';
    $('radio-expand').setAttribute('aria-expanded', String(expanded));
    $('radio-expand').setAttribute('aria-label', playing ? 'Collapse to the floating player' : 'Collapse to the paused mini bar');
    $('radio-mini-open').setAttribute('aria-label', 'Expand the full player');
    $('radio-float-expand').setAttribute('aria-label', 'Expand to the full player');
    if (expanded) { ensureTracks(); setTimeout(() => $('radio-track-search')?.focus({ preventScroll: true }), 60); }
    dock.classList.remove('radio-pop');
    if (target !== 'float') { void dock.offsetWidth; dock.classList.add('radio-pop'); }
    saveState();
  }
  function collapse() { setLayout(layout === 'expanded' ? (isPlaying() ? 'float' : 'mini') : 'expanded'); }
  $('radio-expand').onclick = collapse;
  $('radio-mini-expand').onclick = () => setLayout('expanded');
  $('radio-mini-open').onclick = () => setLayout('expanded');
  $('radio-float-open').onclick = () => setLayout('expanded');
  $('radio-float-expand').onclick = () => setLayout('expanded');
  $('radio-float-mini').onclick = () => setLayout('mini');

  // ── Floating position: persistence, clamping, drag and keyboard ──
  function dockSize() {
    return { width: dock.offsetWidth || FLOAT_WIDTH, height: dock.offsetHeight || FLOAT_HEIGHT };
  }
  function clampPosition(pos) {
    const { width, height } = dockSize();
    const maxX = Math.max(0, innerWidth - width);
    const maxY = Math.max(0, innerHeight - height);
    const x = Number.isFinite(pos?.x) ? pos.x : 0;
    const y = Number.isFinite(pos?.y) ? pos.y : 0;
    return { x: Math.round(Math.max(0, Math.min(x, maxX))), y: Math.round(Math.max(0, Math.min(y, maxY))) };
  }
  function defaultPosition() {
    const { width, height } = dockSize();
    const margin = innerWidth <= 640 ? 12 : 18;
    return { x: innerWidth - width - margin, y: innerHeight - height - margin };
  }
  function applyPosition(pos) {
    position = clampPosition(pos);
    dock.style.left = position.x + 'px';
    dock.style.top = position.y + 'px';
    dock.style.right = 'auto';
    dock.style.bottom = 'auto';
  }
  function resetDockOffset() {
    for (const prop of ['left', 'top', 'right', 'bottom']) dock.style.removeProperty(prop);
  }
  function announcePosition(message) { const live = $('radio-float-announce'); if (live) live.textContent = message; }
  function resetPosition() {
    position = defaultPosition();
    applyPosition(position);
    saveState();
    announcePosition('Player position reset to the bottom-right corner.');
  }
  $('radio-float-reset').onclick = resetPosition;

  function beginDrag(event) {
    if (layout !== 'float' || dock.hidden) return;
    if (event.button !== undefined && event.button !== 0) return;
    const control = event.target instanceof Element ? event.target.closest('button') : null;
    if (control && control.id !== 'radio-grip') return;
    const rect = dock.getBoundingClientRect();
    dragState = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    dock.dataset.dragging = 'true';
    document.body.classList.add('radio-dragging');
    try { $('radio-drag').setPointerCapture(event.pointerId); } catch {}
  }
  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.id) return;
    const dx = event.clientX - dragState.x, dy = event.clientY - dragState.y;
    if (!dragState.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    dragState.moved = true;
    applyPosition({ x: dragState.left + dx, y: dragState.top + dy });
    event.preventDefault();
  }
  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.id) return;
    const moved = dragState.moved;
    dragState = null;
    dock.dataset.dragging = 'false';
    document.body.classList.remove('radio-dragging');
    try { $('radio-drag').releasePointerCapture(event.pointerId); } catch {}
    if (!moved) return;
    if (innerWidth <= 640 && position) {
      const { width } = dockSize();
      const margin = 12;
      const right = innerWidth - width - position.x;
      const edge = position.x <= right ? 'left' : 'right';
      applyPosition({ x: edge === 'left' ? margin : innerWidth - width - margin, y: position.y });
      announcePosition('Player docked to the ' + edge + ' edge.');
    }
    saveState();
  }
  $('radio-drag').addEventListener('pointerdown', beginDrag);
  $('radio-drag').addEventListener('pointermove', moveDrag);
  $('radio-drag').addEventListener('pointerup', endDrag);
  $('radio-drag').addEventListener('pointercancel', endDrag);
  $('radio-grip').addEventListener('keydown', event => {
    if (layout !== 'float') return;
    if (event.key === 'Home') { event.preventDefault(); resetPosition(); return; }
    const size = event.shiftKey ? 40 : 12;
    const moves = { ArrowLeft: [-size, 0], ArrowRight: [size, 0], ArrowUp: [0, -size], ArrowDown: [0, size] };
    if (!moves[event.key]) return;
    event.preventDefault();
    applyPosition({ x: (position?.x || 0) + moves[event.key][0], y: (position?.y || 0) + moves[event.key][1] });
    saveState();
    announcePosition('Player at ' + position.x + ' by ' + position.y + ' pixels.');
  });
  window.addEventListener('resize', () => {
    if (layout !== 'float' || !position) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { if (layout === 'float' && position) { applyPosition(position); saveState(); } });
  });

  // ── Player lifecycle ─────────────────────────────────────────
  function loadingTimeout(ms = 20000) {
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => {
      if ([1, 2, 5].includes(state) || errorCode !== null) return;
      record('timeout');
      playIntent = false;
      setStatus('YouTube is taking too long. Retry, choose another track, or open this track on YouTube.');
    }, ms);
  }
  function clearTimers() { clearTimeout(loadTimer); clearInterval(progressTimer); progressTimer = null; clearTimeout(settleTimer); }
  function destroyPlayer() {
    activation++; instance++; clearTimers(); playlistReady = false;
    try { player?.destroy(); } catch {}
    player = null; ready = false; errorCode = null; playIntent = false; pending = null; state = -1;
    const video = $('radio-video'); if (video) video.replaceChildren(Object.assign(node('div'), { id: 'youtube-player' }));
    updateState(-1);
  }
  function closePlayer() {
    destroyPlayer(); current = null; tracks = []; activeIndex = -1; currentVideoId = null; currentTitle = ''; currentArtist = '';
    tracksState = { status: 'idle', message: '' }; dock.hidden = true; document.body.classList.remove('radio-active', 'radio-expanded-open');
    position = null; resetDockOffset();
    try { localStorage.removeItem(stateKey); } catch {}
    renderAll(); renderMood();
  }
  function youtubeAPI() {
    if (window.YT?.Player) return Promise.resolve();
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
      const existing = $('radio-youtube-api'); const script = existing || node('script');
      script.src = 'https://www.youtube.com/iframe_api'; script.id = 'radio-youtube-api';
      function fail() { clearTimeout(apiTimer); script.remove(); apiPromise = null; reject(new Error('YouTube could not load. Check your connection or content blocker, then retry.')); }
      window.onYouTubeIframeAPIReady = () => { clearTimeout(apiTimer); resolve(); };
      script.onerror = fail; apiTimer = setTimeout(fail, 20000); if (!existing) document.head.append(script);
    });
    return apiPromise;
  }
  async function ensurePlayer() {
    if (player && ready) return;
    await youtubeAPI();
    if (player) { if (!ready) await new Promise(resolve => { const poll = setInterval(() => { if (ready) { clearInterval(poll); resolve(); } }, 80); setTimeout(() => { clearInterval(poll); resolve(); }, 6000); }); return; }
    if (player) return;
    const generation = ++instance;
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error('The YouTube player did not become ready. Retry or open the playlist on YouTube.')); } }, 20000);
      player = new YT.Player('youtube-player', {
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 1, origin: location.origin, rel: 0, enablejsapi: 1 },
        events: {
          onReady: event => {
            if (generation !== instance) return;
            ready = true; const frame = event.target.getIframe?.();
            if (frame) {
              frame.referrerPolicy = 'strict-origin-when-cross-origin';
              frame.title = 'YouTube playlist player';
              frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
              frame.setAttribute('allowfullscreen', '');
            }
            try {
              if (typeof event.target.setVolume === 'function') event.target.setVolume(volume);
              if (muted) event.target.mute();
            } catch {}
            record('ready'); updateControls();
            if (!settled) { settled = true; clearTimeout(timer); resolve(); }
          },
          onStateChange: event => {
            if (generation !== instance) return;
            record('state', event.data);
            if ([-1, 2].includes(event.data) && (errorCode !== null || pending)) return;
            updateState(event.data);
            if ([1, 2, 5].includes(event.data)) clearTimeout(loadTimer);
            if (event.data === 3) loadingTimeout();
            if (event.data === 1) {
              playIntent = false; errorCode = null;
              // Keep `pending` until syncFromPlayer() has confirmed the actual video ID.
              syncFromPlayer(true);
            }
            if (event.data === 5) { errorCode = null; syncFromPlayer(); }
            if (event.data === 2) stopProgress();
            if (event.data === 0) { stopProgress(); syncFromPlayer(); }
            updateControls();
            renderNow();
            const labels = { '-1': 'Waiting for YouTube · tap Play', 0: 'Track ended', 1: 'Playing', 2: 'Paused', 3: 'Buffering…', 5: 'Ready · tap Play' };
            if (labels[event.data] && errorCode === null) setStatus(labels[event.data]);
            renderMood();
          },
          onError: event => {
            if (generation !== instance) return;
            clearTimeout(loadTimer); errorCode = event.data; pending = null; playIntent = false;
            updateState(-1); record('error', event.data);
            $('radio-toggle').disabled = false; $('radio-mini-toggle').disabled = false;
            const message = ({
              2: 'YouTube rejected this video or playlist parameter.',
              5: 'Your browser could not play this video.',
              100: 'This video is unavailable, deleted or private.',
              101: 'The owner disabled embedded playback.',
              150: 'The owner disabled embedded playback.',
              153: 'YouTube did not receive the required referrer or client identification.'
            })[event.data] || 'YouTube could not play this entry.';
            setStatus(`${message} (YouTube ${event.data}). Choose another track, Retry, or open it on YouTube.`);
            updateControls(); renderNow();
          },
          onAutoplayBlocked: () => {
            if (generation !== instance) return;
            playIntent = false; clearTimeout(loadTimer); updateState(2); updateControls();
            record('autoplay-blocked');
            setStatus('Your browser needs one more click. Press Play in ZUNO Radio or in the visible YouTube player.');
          }
        }
      });
    });
  }

  function loadPlaylistAt(index, shouldPlay) {
    if (!ready || !current) return;
    const safe = Math.max(0, Math.min(Number(index) || 0, Math.max(0, tracks.length - 1)));
    activeIndex = safe;
    const track = tracks[safe];
    pending = track?.videoId ? { videoId: track.videoId, index: safe, at: Date.now() } : null;
    errorCode = null; state = -1; playIntent = !!shouldPlay; playlistReady = true;
    updateState(-1); updateControls(); renderNow(); renderTracks();
    setStatus(shouldPlay ? 'Loading “' + (track?.title || 'YouTube playlist') + '”…' : 'Ready to play.');
    record(shouldPlay ? 'load-playlist' : 'cue-playlist', safe);
    const options = { listType: 'playlist', list: current.youtubeId, index: safe };
    if (shouldPlay) player.loadPlaylist(options); else player.cuePlaylist(options);
    loadingTimeout(shouldPlay ? 20000 : 15000);
    settleTimer = setTimeout(() => {
      if (!playIntent || errorCode !== null || state === 1) return;
      if (!player) return;
      try { player.playVideo(); } catch {}
    }, 1400);
  }

  function videoData() {
    if (!ready) return null;
    try { return player?.getVideoData?.() || null; } catch { return null; }
  }
  function iframePlaylist() {
    try { const list = player?.getPlaylist?.(); return Array.isArray(list) ? list : null; } catch { return null; }
  }
  function playerTime() { try { return Number(player?.getCurrentTime?.()) || 0; } catch { return 0; } }
  function playerDuration() { try { return Number(player?.getDuration?.()) || 0; } catch { return 0; } }
  function syncFromPlayer(force) {
    if (!ready || !current) return;
    const data = videoData();
    const id = data?.video_id;
    if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return;
    const list = iframePlaylist();
    let index = -1;
    if (tracks.length) {
      index = tracks.findIndex(track => track.videoId === id);
      if (index < 0 && list && player?.getPlaylistIndex) {
        const position = player.getPlaylistIndex();
        if (Number.isInteger(position) && position >= 0) index = position < tracks.length ? position : -1;
      }
    } else {
      const position = player?.getPlaylistIndex?.();
      index = Number.isInteger(position) && position >= 0 ? position : -1;
    }
    if (index >= 0 && index < tracks.length) activeIndex = index;
    const changed = currentVideoId !== id || force || lastRenderedTrack !== activeIndex;
    currentVideoId = id;
    const track = tracks[activeIndex];
    currentTitle = track?.title || (typeof data.title === 'string' ? data.title : '') || 'YouTube';
    currentArtist = track?.channelTitle || (typeof data.author === 'string' ? data.author : '') || current?.metadata?.channelTitle || 'YouTube';
    if (pending?.videoId && pending.videoId !== id) {
      // Do not silently accept a different song. Give YouTube a moment, then explain.
      // Capture this specific request: a newer selection must invalidate the old timer.
      const selection = pending;
      clearTimeout(selection.timer);
      selection.timer = setTimeout(() => {
        if (pending !== selection || selection.videoId === videoData()?.video_id) return;
        errorCode = 'mismatch'; playIntent = false;
        setStatus('YouTube started a different entry than the one selected. That often means an unavailable item is still in the playlist. Use the track list or Open on YouTube.');
        record('selection-mismatch');
        pending = null; updateControls(); renderNow();
      }, 7000);
    }
    if (pending?.videoId === id) { clearTimeout(pending.timer); pending = null; }
    if (changed) { renderNow(); highlightTracks(); updateMediaSession(); }
  }

  function startProgress() {
    if (progressTimer) return;
    progressTimer = setInterval(() => {
      if (!ready || state !== 1) return;
      syncFromPlayer();
      const time = playerTime(), duration = playerDuration();
      if (!draggingSeek) {
        $('radio-elapsed').textContent = formatTime(time);
        $('radio-duration').textContent = formatTime(duration);
        const seek = $('radio-seek'); seek.max = String(Math.max(1, Math.floor(duration))); seek.value = String(Math.min(time, duration || time));
        seek.disabled = !(duration > 0);
      }
      const progress = duration > 0 ? Math.min(100, time / duration * 100) + '%' : '0%';
      $('radio-mini-progress').style.width = progress;
      $('radio-float-progress').style.width = progress;
      $('radio-float-elapsed').textContent = formatTime(time);
      updateMediaSessionPosition(time, duration);
    }, 1000);
  }
  function stopProgress() { clearInterval(progressTimer); progressTimer = null; }

  function updateState(value) {
    state = value;
    dock.dataset.playing = String(value === 1);
    const label = value === 1 ? 'Pause' : 'Play';
    for (const id of ['radio-toggle', 'radio-mini-toggle', 'radio-float-toggle']) {
      const el = $(id); if (!el) continue;
      el.textContent = value === 1 ? 'Ⅱ' : '▶';
      el.setAttribute('aria-label', label);
      el.title = label;
    }
    // A playing embed must be visible and at least 200 × 200. If playback starts
    // while the paused mini bar is showing, promote it to the floating player.
    if (value === 1 && layout === 'mini' && !dock.hidden) setLayout('float');
    if (value === 1) startProgress(); else stopProgress();
    if (value !== 1) {
      if (value === 0) {
        $('radio-mini-progress').style.width = '0%';
        $('radio-float-progress').style.width = '0%';
        $('radio-float-elapsed').textContent = '0:00';
      }
      $('radio-expand').textContent = isPlaying() ? '▼ Float player' : '▼ Mini player';
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = value === 1 ? 'playing' : value === 2 ? 'paused' : 'none';
  }
  function updateControls() {
    for (const id of ['radio-prev', 'radio-next', 'radio-mini-next', 'radio-float-next']) $(id).disabled = !current;
    $('radio-toggle').disabled = !current;
    $('radio-mini-toggle').disabled = !current;
    $('radio-float-toggle').disabled = !current;
    $('radio-retry').disabled = !current;
    $('radio-mute').disabled = !ready;
    $('radio-volume').disabled = !ready;
    $('radio-seek').disabled = !ready || !(playerDuration() > 0);
    $('radio-mini-title').textContent = current ? (currentTitle || current.label || 'ZUNO Radio') : 'ZUNO Radio';
    $('radio-mini-artist').textContent = current ? (currentArtist || current.metadata?.channelTitle || 'YouTube') : 'Pick a playlist to begin';
    $('radio-mini-artist').title = $('radio-status').textContent;
    $('radio-float-title').textContent = current ? (currentTitle || current.label || 'ZUNO Radio') : 'ZUNO Radio';
    $('radio-float-artist').textContent = current ? (currentArtist || current.metadata?.channelTitle || 'YouTube') : 'Pick a playlist';
    $('radio-float-artist').title = $('radio-status').textContent;
  }

  // ── Track data ───────────────────────────────────────────────
  async function loadTracks(item = current, { force = false } = {}) {
    if (!item) return;
    const request = ++tracksRequest;
    if (force) tracksState = { status: 'loading', message: 'Refreshing the track list from YouTube…' };
    else if (!tracks.length) tracksState = { status: 'loading', message: 'Loading every track in this playlist…' };
    renderTracks(); renderBrowserMeta();
    try {
      const data = await api('/' + item.id + '/tracks' + (force ? '?refresh=1' : ''));
      if (request !== tracksRequest) return;
      if (current?.id === item.id) current = data.playlist || current;
      tracks = Array.isArray(data.tracks) ? data.tracks : [];
      tracksState = { status: data.status || 'available', message: data.message || '', stale: !!data.stale, truncated: !!data.truncated, partial: !!data.partial, fetchedAt: data.fetchedAt };
      if (data.playlist) current = data.playlist;
      if (activeIndex < 0 || activeIndex >= tracks.length) {
        const saved = readState();
        activeIndex = current?.id === saved.playlistId && Number.isInteger(saved.index) ? Math.min(saved.index, Math.max(0, tracks.length - 1)) : 0;
      }
      syncFromPlayer(true);
      lastRenderedTrack = -1;
      renderAll(); saveState();
    } catch (err) {
      if (request !== tracksRequest) return;
      tracksState = { status: 'error', message: err.message };
      renderTracks(); renderBrowserMeta();
    }
  }
  function ensureTracks() { if (current && !tracks.length && !['loading'].includes(tracksState.status)) loadTracks(current); }

  // ── Rendering ────────────────────────────────────────────────
  function artwork() { return trackThumb(currentVideoId) || tracks[activeIndex]?.thumbnailUrl || current?.metadata?.thumbnailUrl || null; }
  function renderNow() {
    if (!current) { updateControls(); return; }
    $('radio-playlist-title').textContent = current.label;
    $('radio-mini-title').textContent = currentTitle || current.label;
    $('radio-mini-artist').textContent = currentArtist || current.metadata?.channelTitle || 'YouTube';
    $('radio-track').textContent = currentTitle || (tracks[activeIndex]?.title) || 'Choose a track';
    $('radio-artist').textContent = currentArtist || current.metadata?.channelTitle || 'YouTube playlist';
    const art = artwork();
    const thumb = $('radio-thumbnail'); thumb.hidden = !art;
    if (art && thumb.getAttribute('src') !== art) thumb.src = art;
    thumb.onerror = () => { thumb.hidden = true; };
    const mini = $('radio-mini-image'); mini.hidden = !art;
    if (art && mini.getAttribute('src') !== art) mini.src = art;
    mini.onerror = () => { mini.hidden = true; };
    dock.style.setProperty('--radio-art', art ? 'url("' + art + '")' : 'none');
    const url = current.url || playlistUrl(current);
    $('radio-youtube').href = url; $('radio-open-playlist').href = url;
    const trackUrl = watchUrl(currentVideoId || tracks[activeIndex]?.videoId);
    const openTrack = $('radio-open-track'); openTrack.href = trackUrl || url; openTrack.hidden = !trackUrl;
    $('radio-youtube').textContent = 'Playlist ↗';
    renderBrowserMeta(); highlightTracks(); updateControls(); updateMediaSession();
  }
  function renderBrowserMeta() {
    if (!current) return;
    const meta = current.metadata || {};
    const count = meta.itemCount ?? (tracks.length || null);
    $('radio-browser-heading').textContent = current.label;
    const bits = [meta.channelTitle || currentArtist || null, count != null ? count + ' videos' : null, tracks.length && count != null && tracks.length < count ? tracks.length + ' browsable' : null].filter(Boolean);
    $('radio-playlist-meta').textContent = bits.join(' · ') || 'Track details come from YouTube.';
  }
  function makeTrackRow(track) {
    const row = node('div', '', 'radio-track');
    row.dataset.index = String(track.index);
    row.setAttribute('role', 'listitem');
    if (track.index === activeIndex) row.classList.add('is-active');
    const play = node('button', '', 'radio-track-play');
    play.type = 'button';
    play.dataset.index = String(track.index);
    const badge = track.unavailable ? (track.privacyStatus === 'private' ? 'Private' : 'Unavailable') : track.restricted ? 'Embed blocked' : null;
    play.setAttribute('aria-label', `${track.index + 1}. ${track.title}${track.channelTitle ? ' by ' + track.channelTitle : ''}${badge ? ' — ' + badge : ''}${track.durationSeconds != null ? ' — ' + formatTime(track.durationSeconds) : ''}`);
    if (track.index === activeIndex) play.setAttribute('aria-current', 'true');
    const number = node('span', String(track.index + 1), 'radio-track-number');
    const art = node('span', '', 'radio-track-art');
    if (track.thumbnailUrl) { const img = node('img'); img.src = track.thumbnailUrl; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.onerror = () => img.remove(); art.append(img); }
    else art.append(node('span', '♫'));
    const copy = node('span', '', 'radio-track-copy');
    const title = node('strong', track.title || 'Untitled track');
    const sub = node('small', [track.channelTitle, track.durationSeconds != null ? formatTime(track.durationSeconds) : null, badge].filter(Boolean).join(' · ') || (track.videoId ? 'YouTube' : 'Not playable'));
    copy.append(title, sub);
    const bars = node('span', '', 'radio-track-bars'); bars.setAttribute('aria-hidden', 'true'); bars.append(node('i'), node('i'), node('i'));
    play.append(number, art, copy, bars);
    play.onclick = () => {
      if (track.unavailable || track.restricted || !track.videoId) {
        const reason = track.restricted ? 'The owner does not allow this video to be embedded.' : 'YouTube reports this playlist entry as unavailable.';
        setStatus(reason + ' ZUNO did not substitute another song. Use the YouTube link for this playlist or pick another track.');
        const open = $('radio-open-track'); if (track.videoId) { open.href = watchUrl(track.videoId); open.hidden = false; }
        return;
      }
      selectTrack(track.index);
    };
    row.append(play);
    if (track.unavailable || track.restricted) {
      const link = node('a', '↗', 'radio-track-open'); link.href = watchUrl(track.videoId) || playlistUrl(); link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.setAttribute('aria-label', 'Open this entry on YouTube');
      row.append(link);
    }
    return row;
  }
  function renderTracks() {
    const list = $('radio-tracks'); if (!list) return;
    const term = searchTerm.trim().toLowerCase();
    const filtered = term ? tracks.filter(track => (track.title || '').toLowerCase().includes(term) || (track.channelTitle || '').toLowerCase().includes(term)) : tracks;
    list.replaceChildren();
    $('radio-tracks-status').textContent = tracksState.message || '';
    $('radio-tracks-status').dataset.status = tracksState.status;
    $('radio-tracks-refresh').disabled = !current || tracksState.status === 'loading';
    if (tracksState.status === 'loading') {
      list.classList.add('is-loading');
      for (let i = 0; i < 6; i++) { const skeleton = node('div', '', 'radio-track-skeleton'); skeleton.append(node('span'), node('span')); list.append(skeleton); }
      return;
    }
    list.classList.remove('is-loading');
    if (!tracks.length) {
      const empty = node('div', '', 'radio-tracks-empty');
      const heading = tracksState.status === 'unconfigured' ? 'Track browsing is not configured.'
        : tracksState.status === 'available' ? 'This playlist has no browsable tracks.'
        : 'No track list available.';
      empty.append(node('strong', heading),
        node('p', tracksState.message || 'YouTube did not return an individual track list for this playlist. You can still use the YouTube player controls or open the playlist on YouTube.'));
      if (current) { const link = node('a', 'Open full playlist on YouTube ↗'); link.href = playlistUrl(); link.target = '_blank'; link.rel = 'noopener noreferrer'; empty.append(link); }
      list.append(empty); return;
    }
    if (!filtered.length) { list.append(node('p', 'No tracks match “' + searchTerm.trim() + '”. Try another title or artist.', 'radio-tracks-empty')); return; }
    const fragment = document.createDocumentFragment();
    for (const track of filtered) fragment.append(makeTrackRow(track));
    list.append(fragment);
  }
  function highlightTracks() {
    const list = $('radio-tracks'); if (!list) return;
    list.querySelectorAll('.radio-track').forEach(row => {
      const active = Number(row.dataset.index) === activeIndex;
      row.classList.toggle('is-active', active);
      const btn = row.querySelector('.radio-track-play');
      if (active) btn?.setAttribute('aria-current', 'true'); else btn?.removeAttribute('aria-current');
    });
    if (layout === 'expanded' && activeIndex !== lastRenderedTrack) {
      const active = list.querySelector('.radio-track.is-active');
      if (active) active.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      lastRenderedTrack = activeIndex;
    }
  }
  function renderAll() {
    dock.hidden = !current;
    renderNow(); renderTracks(); updateControls(); renderMood(); highlightTracks();
    document.body.classList.toggle('radio-active', !!current);
  }

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTitle || current?.label || 'ZUNO Radio',
        artist: currentArtist || current?.metadata?.channelTitle || 'YouTube',
        album: current?.label || 'ZUNO Radio',
        artwork: artwork() ? [{ src: artwork(), sizes: '320x180', type: 'image/jpeg' }] : []
      });
    } catch {}
  }
  function updateMediaSessionPosition(time, duration) {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try { if (duration > 0) navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position: Math.min(time, duration) }); } catch {}
  }

  // ── Activation and selection ─────────────────────────────────
  async function activate(item, { index = 0, autoplay = true, view = 'float' } = {}) {
    const same = current?.id === item.id;
    if (same && ready) {
      dock.hidden = false; document.body.classList.add('radio-active');
      if (view) setLayout(view);
      renderAll(); saveState();
      if (!autoplay) return;
      if (errorCode !== null) { selectTrack(index); return; }
      playIntent = true; setStatus('Resuming…'); loadingTimeout(12000);
      try { player.playVideo(); } catch {}
      saveState(); return;
    }
    if (!same) {
      tracks = []; activeIndex = index; tracksState = { status: 'idle', message: '' }; currentVideoId = null; currentTitle = ''; currentArtist = ''; searchTerm = ''; $('radio-track-search').value = '';
      destroyPlayer();
    }
    const request = ++activation;
    current = item; dock.hidden = false; document.body.classList.add('radio-active');
    // Start the track request before opening the browser so ensureTracks() does not
    // fire a duplicate request for the same playlist.
    if (!same) loadTracks(item);
    if (view) setLayout(view);
    renderAll();
    setStatus(autoplay ? 'Connecting to YouTube…' : 'Ready when you are.');
    saveState();
    if (!autoplay) { renderNow(); return; }
    playIntent = true;
    try {
      await ensurePlayer();
      if (request !== activation || !current) return;
      loadPlaylistAt(index, true);
      updateControls();
    } catch (err) {
      if (request !== activation) return;
      playIntent = false; record('player-init-failed');
      setStatus(err.message);
    }
    saveState();
  }
  function selectTrack(index) {
    const track = tracks[index];
    if (!track || !current) return;
    if (track.unavailable || track.restricted || !track.videoId) {
      setStatus(track.unavailable ? 'That track is unavailable on YouTube. ZUNO did not substitute another song.' : 'That track cannot be embedded by its owner.');
      return;
    }
    activeIndex = index; pending = { videoId: track.videoId, index, at: Date.now() };
    errorCode = null; playIntent = true; lastRenderedTrack = -1;
    updateState(-1); renderAll();
    setStatus('Loading “' + track.title + '”…');
    if (!ready) {
      ensurePlayer().then(() => { if (pending?.index === index && playIntent) loadPlaylistAt(index, true); }).catch(err => setStatus(err.message));
      return;
    }
    const list = iframePlaylist();
    if (list && playlistReady) {
      const position = list.indexOf(track.videoId);
      if (position >= 0) {
        record('play-video-at', position);
        try { player.playVideoAt(position); } catch { loadPlaylistAt(index, true); return; }
        loadingTimeout(20000);
        settleTimer = setTimeout(() => { if (pending && playIntent) { try { player.playVideo(); } catch {} } }, 1200);
        return;
      }
    }
    loadPlaylistAt(index, true);
  }
  function playableIndexes() { return tracks.map((track, index) => (!track.unavailable && !track.restricted && track.videoId) ? index : -1).filter(index => index >= 0); }
  function step(direction) {
    if (!current) return;
    if (layout === 'mini') setLayout('float');
    if (!ready) { activate(current, { index: Math.max(0, activeIndex), autoplay: true, view: layout === 'expanded' ? 'expanded' : 'float' }); return; }
    const available = playableIndexes();
    if (!available.length) {
      if (direction > 0 && player) { try { player.nextVideo(); } catch {} }
      else if (player) { try { player.previousVideo(); } catch {} }
      return;
    }
    const position = available.indexOf(activeIndex);
    let target;
    if (position >= 0) target = available[(position + direction + available.length) % available.length];
    else {
      const sorted = direction > 0 ? available : [...available].reverse();
      target = sorted.find(index => direction > 0 ? index > activeIndex : index < activeIndex) ?? (direction > 0 ? available[0] : available[available.length - 1]);
    }
    selectTrack(target);
  }
  function play() {
    if (!current) { openLibrary(); return; }
    // Never start a hidden embed: the mini bar has no video, so promote to the
    // floating player before playback begins.
    if (layout === 'mini') setLayout('float');
    if (!ready) { activate(current, { index: Math.max(0, activeIndex), autoplay: true, view: null }); return; }
    if (errorCode !== null) { selectTrack(activeIndex >= 0 ? activeIndex : 0); return; }
    playIntent = true;
    try { player.playVideo(); } catch {}
    loadingTimeout(12000);
  }
  function pause() {
    playIntent = false; clearTimeout(loadTimer);
    // An explicit pause cancels any pending substitution check, so YouTube's paused
    // state is always reflected instead of being ignored as a load transition.
    if (pending) { clearTimeout(pending.timer); pending = null; }
    try { player?.pauseVideo?.(); } catch {}
  }
  function toggle() { if (state === 1) pause(); else play(); }

  $('radio-toggle').onclick = toggle;
  $('radio-float-toggle').onclick = toggle;
  $('radio-mini-toggle').onclick = toggle;
  $('radio-prev').onclick = () => step(-1);
  $('radio-next').onclick = () => step(1);
  $('radio-mini-next').onclick = () => step(1);
  $('radio-float-next').onclick = () => step(1);
  $('radio-stop').onclick = closePlayer;
  $('radio-retry').onclick = () => {
    if (!current) return;
    if (!ready) { activate(current, { index: Math.max(0, activeIndex), autoplay: true, view: 'expanded' }); return; }
    selectTrack(activeIndex >= 0 ? activeIndex : 0);
  };
  $('radio-open').onclick = e => { e.preventDefault(); openLibrary(); };
  $('radio-tracks-refresh').onclick = () => { if (current) loadTracks(current, { force: true }); };
  $('radio-track-search').oninput = e => { searchTerm = e.target.value.slice(0, 120); renderTracks(); highlightTracks(); };
  $('radio-seek').oninput = e => {
    draggingSeek = true;
    const time = Number(e.target.value) || 0;
    $('radio-elapsed').textContent = formatTime(time);
  };
  $('radio-seek').onchange = e => {
    draggingSeek = false;
    if (!ready) return;
    try { player.seekTo(Number(e.target.value) || 0, true); } catch {}
    syncFromPlayer(); renderNow();
  };
  $('radio-volume').oninput = e => {
    volume = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    if (ready) { try { player.setVolume(volume); if (volume > 0 && muted) { player.unMute(); muted = false; } } catch {} }
    $('radio-mute').setAttribute('aria-pressed', String(muted || volume === 0));
    $('radio-mute').textContent = muted || volume === 0 ? '🔇' : '🔊';
    saveState();
  };
  $('radio-mute').onclick = () => {
    if (!ready) return;
    muted = !muted;
    try { muted ? player.mute() : player.unMute(); } catch {}
    $('radio-mute').setAttribute('aria-pressed', String(muted));
    $('radio-mute').textContent = muted ? '🔇' : '🔊';
    $('radio-mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    saveState();
  };

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('seekto', details => { if (ready && details.seekTime != null) { try { player.seekTo(details.seekTime, true); } catch {} } });
    } catch {}
  }

  // ── Live-session and page lifecycle ──────────────────────────
  window.addEventListener('zuno-live-start', () => { live = true; if (localStorage.getItem(preferenceKey) !== 'false') { playIntent = false; try { player?.pauseVideo?.(); } catch {} } });
  window.addEventListener('zuno-live-end', () => { live = false; });
  // Background tabs and minimized windows must not pause audio. YouTube handles its own
  // background behavior; ZUNO deliberately registers no visibilitychange pause handler.
  window.addEventListener('pagehide', saveState);
  window.addEventListener('storage', e => { if (e.key === 'vibe_token' && e.newValue !== token) { closePlayer(); location.reload(); } });

  // ── Library ──────────────────────────────────────────────────
  $('radio-edit-cancel').onclick = () => dialog.close();
  $('radio-delete-cancel').onclick = () => deletion.close();
  function edit(item) {
    editId = item.id; $('radio-label').value = item.customLabel || '';
    $('radio-label').placeholder = item.metadata?.title || 'Use the real YouTube title';
    $('radio-edit-error').textContent = '';
    $('radio-tags').querySelectorAll('input').forEach(input => { input.checked = item.tags.includes(input.value); });
    if (state === 1) pause();
    dialog.showModal();
  }
  $('radio-edit-form').onsubmit = async e => {
    e.preventDefault(); const submit = e.target.querySelector('button.radio-primary'); submit.disabled = true;
    try {
      const data = await api('/' + editId, 'PATCH', { label: $('radio-label').value, tags: [...$('radio-tags').querySelectorAll('input:checked')].map(input => input.value) });
      if (current?.id === editId) { current = data.playlist; renderNow(); }
      dialog.close(); await refresh();
    } catch (err) { $('radio-edit-error').textContent = err.message; } finally { submit.disabled = false; }
  };
  $('radio-delete-confirm').onclick = async () => {
    $('radio-delete-confirm').disabled = true;
    try { await api('/' + deleteId, 'DELETE'); if (current?.id === deleteId) closePlayer(); deletion.close(); await refresh(); }
    catch (err) { $('radio-delete-error').textContent = err.message; } finally { $('radio-delete-confirm').disabled = false; }
  };
  function renderLibrary() {
    if (!room) return;
    const list = $('radio-library'); list.replaceChildren(); list.classList.toggle('radio-skeleton', loading); list.setAttribute('aria-busy', String(loading));
    if (loading || libraryError || !playlists.length) {
      list.append(node('p', loading ? 'Loading your collection…' : libraryError || 'Your next favorite corner starts with a playlist. Paste a public YouTube playlist above.'));
      return;
    }
    for (const item of playlists) {
      const playing = current?.id === item.id;
      const card = node('article', '', 'radio-playlist' + (playing ? ' is-playing' : ''));
      const art = node('div', '', 'radio-cover');
      if (item.metadata?.thumbnailUrl) {
        const image = node('img'); image.src = item.metadata.thumbnailUrl; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async';
        image.onerror = () => { art.replaceChildren(node('span', 'No artwork')); }; art.append(image);
      } else art.append(node('span', 'No artwork'));
      const copy = node('div', '', 'radio-playlist-copy');
      const heading = node('h4', item.label); copy.append(heading);
      if (item.customLabel && item.originalTitle) copy.append(node('p', 'YouTube: ' + item.originalTitle, 'radio-original-title'));
      const info = [item.metadata?.channelTitle, item.metadata?.itemCount != null ? item.metadata.itemCount + ' videos' : null].filter(Boolean);
      if (info.length) copy.append(node('p', info.join(' · ')));
      const metadataStatus = { unchecked: 'Details not fetched yet · Refresh metadata to check.', unconfigured: 'Title and artwork unavailable · add a server-side YouTube API key.', unavailable: 'Private, deleted or inaccessible on YouTube. Previously saved details may be out of date.', quota: 'Metadata quota reached · previous details kept.', configuration_error: 'Metadata access denied · previous details kept.', temporary_error: 'Metadata temporarily unavailable · try Refresh metadata.' }[item.metadataStatus];
      if (metadataStatus) copy.append(node('p', metadataStatus, 'radio-metadata-note'));
      copy.append(node('p', item.tags.length ? item.tags.map(tag => moods[tag][0] + ' ' + moods[tag][1]).join(' · ') : 'No mood tags yet · add some with Edit'));
      const actions = node('div', '', 'radio-actions');
      if (playing) actions.append(node('span', '● In the player', 'radio-playing-badge'));
      const external = node('a', 'YouTube ↗'); external.href = playlistUrl(item); external.target = '_blank'; external.rel = 'noopener noreferrer';
      actions.append(
        button(playing ? '▶ Resume' : '▶ Play playlist', () => activate(item), 'radio-primary'),
        button('Tracks', () => browse(item)),
        button('Edit', () => edit(item)),
        button('Remove', () => { deleteId = item.id; $('radio-delete-name').textContent = item.label; $('radio-delete-error').textContent = ''; if (state === 1) pause(); deletion.showModal(); }),
        external
      );
      copy.append(actions); card.append(art, copy); list.append(card);
    }
  }
  async function browse(item) {
    if (current?.id !== item.id) { await activate(item, { index: 0, autoplay: false, view: null }); if (current?.id !== item.id) return; }
    dock.hidden = false; document.body.classList.add('radio-active');
    setLayout('expanded'); renderAll();
    if (!tracks.length || tracksState.status === 'error') await loadTracks(item);
    setStatus('Browse the playlist, then choose any track.');
  }
  async function refresh() {
    loading = true; libraryError = ''; renderLibrary(); renderMood();
    try { playlists = (await api()).playlists; }
    catch (err) { libraryError = err.message; }
    finally { loading = false; renderLibrary(); renderMood(); await restore(); }
  }
  async function restore() {
    if (current) return;
    const saved = readState();
    if (!saved.playlistId) return;
    if (saved.pos && Number.isFinite(saved.pos.x) && Number.isFinite(saved.pos.y)) position = { x: saved.pos.x, y: saved.pos.y };
    const item = playlists.find(playlist => playlist.id === saved.playlistId);
    if (!item) return;
    current = item; activeIndex = Number.isInteger(saved.index) ? saved.index : 0;
    if (Number.isFinite(saved.volume)) { volume = saved.volume; $('radio-volume').value = String(volume); }
    if (typeof saved.muted === 'boolean') { muted = saved.muted; $('radio-mute').textContent = muted ? '🔇' : '🔊'; $('radio-mute').setAttribute('aria-pressed', String(muted)); $('radio-mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute'); }
    dock.hidden = false; document.body.classList.add('radio-active');
    try {
      const data = await api('/' + item.id + '/tracks');
      if (current?.id !== item.id) return;
      tracks = Array.isArray(data.tracks) ? data.tracks : [];
      current = data.playlist || item;
      tracksState = { status: data.status || 'available', message: data.message || '', stale: !!data.stale, truncated: !!data.truncated, partial: !!data.partial };
      activeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, tracks.length - 1)));
      currentVideoId = tracks[activeIndex]?.videoId || null;
      currentTitle = tracks[activeIndex]?.title || '';
      currentArtist = tracks[activeIndex]?.channelTitle || current.metadata?.channelTitle || '';
    } catch {}
    setLayout('mini'); renderAll();
    setStatus('Ready when you are. Press Play to continue where you left off.');
  }

  // ── Mood studio ──────────────────────────────────────────────
  function renderMood() {
    if (!$('mood-music')) return;
    const box = $('mood-music'); box.replaceChildren();
    const match = playlists.find(item => item.tags.includes(selected));
    box.append(node('span', '♫ YOUR SOUNDTRACK', 'eyebrow'));
    if (loading || libraryError) {
      box.append(node('p', loading ? 'Finding your playlists…' : libraryError));
      if (libraryError) box.append(button('Retry library', refresh));
      return;
    }
    if (match) {
      box.append(node('h3', match.label), node('p', current?.id === match.id ? $('radio-status').textContent : 'From your collection · tagged ' + moods[selected][1]), button(current?.id === match.id ? '▶ Open the player' : '▶ Open in ZUNO Radio', () => current?.id === match.id ? setLayout('expanded') : activate(match), 'radio-primary'));
    } else {
      box.append(node('h3', 'A little space for your ' + moods[selected][1].toLowerCase() + ' mix.'), node('p', 'No playlist tagged ' + moods[selected][1] + ' yet. Add a YouTube playlist or tag one from your collection.'), button('＋ Add or tag a playlist', () => { openLibrary(); $('radio-url')?.focus(); }, 'radio-primary'));
    }
  }
  function moodRender() {
    if (!$('mood-studio')) return;
    const mood = moods[selected]; $('mood-studio').style.setProperty('--mood-accent', mood[5]);
    document.querySelectorAll('[data-mood]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.mood === selected)));
    $('mood-summary').textContent = mood[2]; renderMood();
    const catalog = window.vibeCatalog; const movies = catalog.MOVIES[mood[3]], movie = movies[offset % movies.length], activity = catalog.ACTIVITIES[(mood[4] + offset) % catalog.ACTIVITIES.length];
    const watch = node('article', '', 'radio-secondary'), tryIt = node('article', '', 'radio-secondary');
    const link = node('a', 'Find trailer ↗'); link.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(movie.title + ' official trailer'); link.target = '_blank'; link.rel = 'noopener noreferrer';
    watch.append(node('span', '▸ WATCH SOMETHING', 'eyebrow'), node('h3', movie.title), node('p', movie.year + ' · ' + movie.tags.join(' / ')), link);
    tryIt.append(node('span', '✳ TRY SOMETHING', 'eyebrow'), node('h3', activity.name), node('p', activity.meta), button('Give me another idea', () => { offset++; moodRender(); }));
    $('mood-picks').replaceChildren(watch, tryIt);
  }
  document.querySelectorAll('[data-mood]').forEach(el => { el.onclick = () => { selected = el.dataset.mood; offset = 0; moodRender(); }; });
  if ($('shuffle-mix')) $('shuffle-mix').onclick = () => { offset++; moodRender(); };
  if ($('personalize-mix')) $('personalize-mix').onclick = openLibrary;
  window.addEventListener('vibe-user-message', e => {
    const match = String(e.detail).match(/\b(?:i am|i'm|i’m|i feel|feeling)\s+(?:so |really )?(stressed|overwhelmed|sad|low|happy|excited|tired|bored|chill|relaxed)\b/i);
    if (match) { selected = ({ stressed: 'tired', overwhelmed: 'tired', sad: 'low', happy: 'hyped', excited: 'hyped', relaxed: 'chill' })[match[1].toLowerCase()] || match[1].toLowerCase(); offset = 0; moodRender(); }
  });

  // ── Study Studio bridge ──────────────────────────────────────
  function showStudy() {
    const shell = $('study-shell'), frame = $('study-frame');
    if (!shell || !frame) { location.href = '/study'; return; }
    if (!frame.getAttribute('src')) frame.src = '/study';
    shell.hidden = false;
    document.querySelectorAll('nav .nav-item').forEach(el => el.classList.remove('selected'));
    $('study-nav')?.classList.add('selected');
    shell.scrollIntoView({ behavior: 'smooth', block: 'start' });
    frame.focus?.();
  }
  if ($('study-shell-close')) $('study-shell-close').onclick = () => {
    $('study-shell').hidden = true;
    $('study-nav')?.classList.remove('selected');
    $('conversation-tab')?.classList.add('selected');
    $('study-entry')?.focus();
  };
  window.addEventListener('message', e => {
    if (e.origin === location.origin && e.source === $('study-frame')?.contentWindow && e.data?.type === 'zuno-study-navigate') {
      $('study-shell').hidden = true;
      if (e.data.hash === '#zuno-radio') openLibrary(); else $('conversation-tab').click();
    }
  });
  window.ZunoRadio = { openStudy: showStudy, play: () => current && play(), pause };

  moodRender(); refresh();
})();
