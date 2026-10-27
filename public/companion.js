'use strict';
const $ = id => document.getElementById(id);
let configured = false, busy = false, call = null;
const token = localStorage.getItem('vibe_token');
if (!token) location.replace('/login.html');
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
async function api(path = '', options = {}) {
  const response = await fetch('/api/companion' + path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(180000) });
  if (response.status === 401 || response.status === 403) { location.replace('/login.html'); throw new Error('Please log in again.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please retry.');
  return data;
}
function message(role, text) {
  const el = document.createElement('div'); el.className = 'message ' + role;
  const label = document.createElement('small'); label.textContent = role === 'user' ? 'You' : 'ZUNO';
  const body = document.createElement('span'); body.textContent = text;
  el.append(label, body); $('thread').append(el); $('thread').scrollTop = $('thread').scrollHeight;
  $('suggestions').hidden = true; return el;
}
function typing() {
  const el = document.createElement('div'); el.className = 'typing-indicator'; el.id = 'typing-indicator'; el.setAttribute('aria-label', 'ZUNO is thinking');
  const label = document.createElement('small'); label.textContent = 'ZUNO';
  const dots = document.createElement('span'); dots.className = 'typing-dots'; dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
  el.append(label, dots); $('thread').append(el); $('thread').scrollTop = $('thread').scrollHeight; return el;
}
function renderHistory(messages) { $('thread').replaceChildren(); $('suggestions').hidden = messages.length > 0; messages.forEach(m => message(m.role, m.text)); }
function lock() {
  $('send').disabled = busy || !!call; $('message').disabled = !!call;
  $('call').disabled = busy || !!call; $('voice').disabled = !!call;
  $('clear').disabled = busy || !!call; $('composer-mic').disabled = busy || !!call;
}
const clock = new Date();
$('header-date').textContent = clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
$('pulse-date').textContent = clock.toLocaleDateString([], { month: 'short', day: 'numeric' });
$('hero-talk').onclick = () => { $('call').click(); $('companion').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
$('hero-plan').onclick = () => $('daily-planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
$('composer-mic').onclick = () => {
  if (busy || call) return;
  $('call').click();
  if (configured) $('companion').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
async function initialize() {
  try {
    const response = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!response.ok) { location.replace('/login.html'); return; }
    const { user } = await response.json();
    $('username').textContent = user.username; $('initial').textContent = user.username[0].toUpperCase();
    $('greeting').textContent = `Hey ${user.username} — your goals. Your pace. Your AI companion.`;
    const data = await api(); configured = data.configured;
    $('notes').value = data.notes; renderHistory(data.messages);
    $('provider-state').textContent = configured ? 'Ready when you are' : 'AI setup needed';
    if (!configured) notice(data.chatConfigured ? 'AI chat is ready. Add GEMINI_API_KEY to .env and restart to enable voice calls.' : 'Add GEMINI_API_KEY or NVIDIA_API_KEY to .env and restart to enable AI. Offline ideas remain available.');
    $('message').placeholder = data.chatProvider === 'nvidia' ? 'Ask ZUNO anything… · NVIDIA chat' : 'Ask ZUNO anything…';
  } catch (error) { notice('Unable to load your space. Check your connection and refresh.'); }
}
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); const text = $('message').value.trim();
  if (!text || busy || call) return;
  window.dispatchEvent(new CustomEvent('vibe-user-message', { detail: text }));
  busy = true; window.ZunoMascot?.set('chat', 'thinking'); lock(); notice('');
  const pending = message('user', text); $('message').value = '';
  const indicator = typing();
  $('provider-state').textContent = 'ZUNO is thinking…';
  try { const data = await api('/chat', { method: 'POST', body: JSON.stringify({ text, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }); indicator.remove(); message('model', data.text); window.ZunoMascot?.set('chat-success', 'happy', 2500); }
  catch (error) { window.ZunoMascot?.set('chat-error', 'error', 4500); pending.remove(); indicator.remove(); $('message').value = text; notice(error.message); }
  finally { window.ZunoMascot?.clear('chat'); indicator.remove(); window.dispatchEvent(new Event('vibe-tasks-changed')); busy = false; lock(); $('provider-state').textContent = configured ? 'Ready when you are' : 'AI setup needed'; }
});
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('chat-form').requestSubmit(); } });
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { $('message').value = button.dataset.prompt; $('chat-form').requestSubmit(); }));
$('clear').addEventListener('click', async () => { try { await api('/history', { method: 'DELETE' }); renderHistory([]); notice('Conversation cleared. Your saved personal context is unchanged.'); } catch (error) { notice(error.message); } });
$('context-open').onclick = () => $('context-dialog').showModal();
$('context-close').onclick = () => $('context-dialog').close();
$('conversation-tab').onclick = () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('message').focus();
  document.querySelectorAll('nav .nav-item').forEach(el => el.classList.remove('selected'));
  $('conversation-tab').classList.add('selected');
};
document.querySelectorAll('nav .nav-item').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('nav .nav-item').forEach(el => el.classList.remove('selected'));
    link.classList.add('selected');
  });
});
window.addEventListener('scroll', () => {
  if ($('study-shell') && !$('study-shell').hidden) return;
  const plannerTop = $('daily-planner')?.getBoundingClientRect().top ?? 9999;
  const moodTop = $('mood-studio')?.getBoundingClientRect().top ?? 9999;
  const radioTop = $('zuno-radio')?.getBoundingClientRect().top ?? 9999;
  const navItems = document.querySelectorAll('nav .nav-item');
  if (radioTop <= 220) {
    navItems.forEach(el => el.classList.remove('selected'));
    document.querySelector('nav a[href="#zuno-radio"]')?.classList.add('selected');
  } else if (moodTop <= 220) {
    navItems.forEach(el => el.classList.remove('selected'));
    document.querySelector('nav a[href="#mood-studio"]')?.classList.add('selected');
  } else if (plannerTop <= 220) {
    navItems.forEach(el => el.classList.remove('selected'));
    document.querySelector('nav a[href="#daily-planner"]')?.classList.add('selected');
  } else if (window.scrollY < 200) {
    navItems.forEach(el => el.classList.remove('selected'));
    $('conversation-tab')?.classList.add('selected');
  }
}, { passive: true });
$('context-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api('/profile', { method: 'PUT', body: JSON.stringify({ notes: $('notes').value }) }); $('context-status').textContent = 'Saved. This will apply to your next message or new call.'; }
  catch (error) { $('context-status').textContent = error.message; }
  finally { button.disabled = false; }
};
function stopAudio(c) { for (const source of c.sources) { try { source.stop(); } catch {} } c.sources.clear(); c.next = 0; }
function playAudio(c, base64) {
  const bytes = Uint8Array.from(atob(base64), ch => ch.charCodeAt(0));
  const view = new DataView(bytes.buffer); const buffer = c.audio.createBuffer(1, bytes.length / 2, 24000);
  const floats = buffer.getChannelData(0); for (let i = 0; i < floats.length; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
  const source = c.audio.createBufferSource(); source.buffer = buffer; source.connect(c.outputAnalyser);
  c.next = Math.max(c.audio.currentTime + .03, c.next); source.start(c.next); c.next += buffer.duration; c.sources.add(source);
  $('orb-scene').classList.add('speaking'); window.ZunoMascot?.set('voice', 'speaking');
  source.onended = () => { c.sources.delete(source); if (!c.sources.size && call === c) { $('orb-scene').classList.remove('speaking'); window.ZunoMascot?.set('voice', c.muted ? 'idle' : 'listening'); } };
}
function finishCall(reason = 'Call ended. Take a little calm with you.') {
  const c = call; if (!c) return; call = null; window.dispatchEvent(new Event('zuno-live-end')); window.ZunoMascot?.clear('voice');
  clearInterval(c.timer); clearTimeout(c.timeout); cancelAnimationFrame(c.visualFrame); window.ZunoMascot?.level('speech', 0); window.ZunoMascot?.level('mic', 0); c.stream?.getTracks().forEach(track => track.stop());
  c.capture?.disconnect(); c.mic?.disconnect(); stopAudio(c); c.audio?.close().catch(() => {});
  if (c.socket && c.socket.readyState < 2) c.socket.close();
  $('call').hidden = false; $('call').textContent = '↗  Start a voice call'; $('call-controls').hidden = true;
  $('mute').textContent = 'Mute mic'; $('mute').setAttribute('aria-pressed', 'false');
  $('call-status').textContent = reason; $('orb-scene').classList.remove('active', 'speaking', 'connecting', 'muted'); lock();
  // The server stores completed turns and flushes the final transcript on close.
  if (c.ready) setTimeout(() => { if (!call && !busy) api().then(data => { if (!call && !busy) renderHistory(data.messages); }).catch(() => {}); }, 500);
}
$('call').onclick = async () => {
  if (call || busy) return;
  window.ZunoMascot?.clear('voice-error');
  if (!configured) { notice('Add GEMINI_API_KEY to the server .env file and restart before starting a call.'); return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { notice('Voice calls need a current browser on localhost or HTTPS with microphone support.'); return; }
  const c = { sources: new Set(), next: 0, muted: false, ready: false, captions: {} }; call = c; window.dispatchEvent(new Event('zuno-live-start')); lock(); notice('');
  $('call').hidden = true; $('call-controls').hidden = false; $('mute').disabled = true; $('caption').textContent = '';
  $('orb-scene').classList.remove('active', 'speaking', 'muted'); $('orb-scene').classList.add('connecting');
  $('call-status').textContent = 'Allow microphone access to connect…';
  function voiceError(reason) { if (call === c) { finishCall(reason); window.ZunoMascot?.set('voice-error', 'error', 4500); } }
  c.timeout = setTimeout(() => voiceError('Connection timed out. Please try again.'), 30000);
  try {
    c.audio = new AudioContext(); await c.audio.resume();
    c.outputAnalyser = c.audio.createAnalyser(); c.outputAnalyser.fftSize = 256; c.outputAnalyser.connect(c.audio.destination);
    const waveform = new Float32Array(256);
    function animateSpeech() {
      if (call !== c) return;
      c.outputAnalyser.getFloatTimeDomainData(waveform);
      const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length);
      window.ZunoMascot?.level('speech', Math.min(1, rms * 6));
      c.visualFrame = requestAnimationFrame(animateSpeech);
    }
    animateSpeech();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (call !== c) { stream.getTracks().forEach(t => t.stop()); return; } c.stream = stream;
    await c.audio.audioWorklet.addModule('/assets/audio-worklet.js');
    if (call !== c) return;
    const { ticket } = await api('/call', { method: 'POST', body: JSON.stringify({ voice: $('voice').value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    if (call !== c) return;
    $('call-status').textContent = 'Connecting to ZUNO…';
    c.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/companion/live?ticket=${encodeURIComponent(ticket)}`);
    c.socket.onmessage = event => {
      if (call !== c) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ready') {
          c.ready = true; clearTimeout(c.timeout); c.start = Date.now(); $('mute').disabled = false;
          $('orb-scene').classList.remove('connecting', 'muted'); $('orb-scene').classList.add('active');
          c.timer = setInterval(() => { const sec = Math.floor((Date.now() - c.start) / 1000); $('call-status').textContent = `${c.muted ? 'Microphone muted' : 'Connected · Talk naturally'} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }, 1000);
          $('call-status').textContent = 'Connected · Say hello';
          c.mic = c.audio.createMediaStreamSource(c.stream); c.capture = new AudioWorkletNode(c.audio, 'vibe-capture');
          c.capture.port.onmessage = ({ data: buffer }) => {
            if (call !== c || c.muted || c.socket.readyState !== WebSocket.OPEN) return;
            if (c.socket.bufferedAmount > 128000) { voiceError('Your connection is too slow for live audio. Please retry.'); return; }
            const samples = new Int16Array(buffer); let energy = 0; for (const value of samples) energy += (value / 32768) ** 2;
            window.ZunoMascot?.level('mic', Math.sqrt(energy / samples.length) * 7);
            const bytes = new Uint8Array(buffer); let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
            c.socket.send(JSON.stringify({ type: 'audio', data: btoa(raw) }));
          };
          c.mic.connect(c.capture); c.capture.connect(c.audio.destination); window.ZunoMascot?.set('voice', 'listening');
        } else if (data.type === 'audio') playAudio(c, data.data);
        else if (data.type === 'interrupted') { stopAudio(c); window.ZunoMascot?.set('voice', c.muted ? 'idle' : 'listening'); c.captions = {}; $('orb-scene').classList.remove('speaking'); }
        else if (data.type === 'processing') { if (!c.sources.size) window.ZunoMascot?.set('voice', 'thinking'); }
        else if (data.type === 'caption') { if (data.role === 'model' && !c.sources.size) window.ZunoMascot?.set('voice', 'thinking'); c.captions[data.role] = ((c.captions[data.role] || '') + data.text).slice(-2000); $('caption').textContent = (data.role === 'user' ? 'You: ' : 'ZUNO: ') + c.captions[data.role]; }
        else if (data.type === 'turnComplete') { if (!c.sources.size) window.ZunoMascot?.set('voice', c.muted ? 'idle' : 'listening'); if (c.captions.user) window.dispatchEvent(new CustomEvent('vibe-user-message', { detail: c.captions.user })); c.captions = {}; }
        else if (data.type === 'tasksChanged') window.dispatchEvent(new Event('vibe-tasks-changed'));
        else if (data.type === 'error') { finishCall(data.message); window.ZunoMascot?.set('voice-error', 'error', 4500); }
      } catch { voiceError('Audio could not be played. Please reconnect.'); }
    };
    c.socket.onerror = () => voiceError('Voice connection failed. Check your connection and retry.');
    c.socket.onclose = () => voiceError('Connection ended. Start another call to continue.');
  } catch (error) {
    voiceError(error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow it in your browser and try again.' : error.name === 'NotFoundError' ? 'No microphone found. Connect one and try again.' : error.message);
  }
};
$('mute').onclick = () => {
  const c = call; if (!c?.ready) return; c.muted = !c.muted; window.ZunoMascot?.set('voice', c.sources.size ? 'speaking' : c.muted ? 'idle' : 'listening');
  c.stream.getAudioTracks().forEach(track => { track.enabled = !c.muted; });
  if (c.muted) window.ZunoMascot?.level('mic', 0);
  if (c.muted && c.socket.readyState === WebSocket.OPEN) c.socket.send(JSON.stringify({ type: 'mute' }));
  $('orb-scene').classList.toggle('muted', c.muted);
  $('mute').textContent = c.muted ? 'Unmute mic' : 'Mute mic'; $('mute').setAttribute('aria-pressed', String(c.muted));
};
$('hangup').onclick = () => finishCall();
$('logout').onclick = () => { finishCall(); localStorage.removeItem('vibe_token'); localStorage.removeItem('vibe_user'); location.replace('/login.html'); };
window.addEventListener('pagehide', () => finishCall());
initialize();
