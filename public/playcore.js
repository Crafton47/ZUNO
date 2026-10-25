'use strict';
(() => {
  const labels = { idle: 'Here for your next idea', listening: 'Mic on. I’m listening.', thinking: 'Connecting the dots…', speaking: 'Let’s talk it through', happy: 'That’s a good step', excited: 'New ideas, let’s go!', comforting: 'Your pace is enough', 'task-completed': 'Small win. Big energy.', error: 'A small hiccup. Try again.' };
  const priorities = { idle: 0, happy: 2, comforting: 3, excited: 4, 'task-completed': 5, thinking: 6, listening: 7, speaking: 8, error: 9 };
  const channels = new Map();
  function render() {
    const state = [...channels.values()].sort((a, b) => priorities[b.state] - priorities[a.state])[0]?.state || 'idle';
    document.querySelectorAll('.zuno-mascot').forEach(el => { el.dataset.mascotState = state; el.setAttribute('aria-label', `ZUNO companion: ${state}`); });
    document.querySelectorAll('[data-mascot-label]').forEach(el => { el.textContent = labels[state]; });
    document.documentElement.dataset.mascotState = state;
  }
  window.ZunoMascot = { level(kind, value) { document.querySelectorAll('.zuno-mascot').forEach(el => el.style.setProperty(kind === 'speech' ? '--speech-level' : '--mic-level', String(Math.max(0, Math.min(1, value))))); }, reset() { for (const item of channels.values()) clearTimeout(item.timer); channels.clear(); render(); }, set(channel, state, duration = 0) {
    if (!(state in labels)) return;
    clearTimeout(channels.get(channel)?.timer);
    const entry = { state }; channels.set(channel, entry);
    if (duration) entry.timer = setTimeout(() => { if (channels.get(channel) === entry) { channels.delete(channel); render(); } }, duration);
    render();
  }, clear(channel) { clearTimeout(channels.get(channel)?.timer); channels.delete(channel); render(); } };
  function mode(focus) {
    document.documentElement.dataset.mode = focus ? 'focus' : 'play';
    const button = document.getElementById('mode-toggle'); button.setAttribute('aria-pressed', String(focus)); button.textContent = focus ? 'Play mode' : 'Focus mode';
    try { localStorage.setItem('zuno-mode', focus ? 'focus' : 'play'); } catch {}
  }
  let saved; try { saved = localStorage.getItem('zuno-mode'); } catch {}
  mode(saved === 'focus');
  document.getElementById('mode-toggle').onclick = () => mode(document.documentElement.dataset.mode !== 'focus');
  window.addEventListener('vibe-user-message', event => { if (/\b(sad|overwhelmed|lonely|anxious)\b/i.test(event.detail)) window.ZunoMascot.set('mood', 'comforting', 6000); });
  window.addEventListener('zuno-task-completed', () => window.ZunoMascot.set('reward', 'task-completed', 5000));
  window.addEventListener('zuno-reward-revealed', () => window.ZunoMascot.set('reward', 'excited', 3000));
  window.addEventListener('pagehide', () => window.ZunoMascot.reset());
  render();
  for (const id of ['study-nav', 'study-entry']) document.getElementById(id).onclick = () => { location.href = '/study'; };
})();
