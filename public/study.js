'use strict';
(() => {
  const $ = id => document.getElementById(id), token = localStorage.getItem('vibe_token');
  if (!token) { location.replace('/login.html'); return; }
  let current = null, material = [], polling, working = false, editMode, taskRequest = crypto.randomUUID();
  const controllers = new Set();
  const status = text => { $('error').textContent = text; $('error').hidden = !text; };
  async function api(path, method = 'GET', body) {
    const ctrl = new AbortController(); controllers.add(ctrl); const timeout = setTimeout(() => ctrl.abort(), 150000);
    try {
      const r = await fetch('/api/companion/study' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      const data = await r.json();
      if (r.status === 401) location.replace('/login.html');
      if (!r.ok) throw new Error(data.error || 'Could not complete the study operation.');
      return data;
    } finally { clearTimeout(timeout); controllers.delete(ctrl); }
  }
  function path(suffix = '') { return '/notebooks/' + encodeURIComponent(current) + suffix; }
  function button(label, action, className = '') { const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.className = className; el.onclick = action; return el; }
  async function action(fn) {
    if (working) return;
    working = true; clearTimeout(polling); status('');
    document.querySelectorAll('button').forEach(b => b.disabled = true);
    try { await fn(); } catch (e) { status(e.message); }
    finally { working = false; document.querySelectorAll('button').forEach(b => b.disabled = false); schedulePoll(); }
  }
  function setMode(focus) { document.documentElement.dataset.mode = focus ? 'focus' : 'play'; $('mode-toggle').textContent = focus ? 'Play mode' : 'Focus mode'; $('mode-toggle').setAttribute('aria-pressed', String(focus)); localStorage.setItem('zuno-mode', focus ? 'focus' : 'play'); }
  setMode(localStorage.getItem('zuno-mode') === 'focus'); $('mode-toggle').onclick = () => setMode(document.documentElement.dataset.mode !== 'focus');
  async function home() {
    clearTimeout(polling); current = null; history.replaceState(null, '', '/study');
    $('workspace').hidden = true; $('home').hidden = false;
    const { notebooks } = await api('/notebooks'); $('notebooks').replaceChildren();
    if (!notebooks.length) $('notebooks').textContent = 'A fresh page. Create your first notebook to start.';
    for (const n of notebooks) {
      const card = button('', () => action(() => open(n.id)), 'notebook-card');
      const title = document.createElement('strong'); title.textContent = n.name;
      const date = document.createElement('small'); date.textContent = 'Opened ' + new Date(n.opened_at).toLocaleString();
      card.append(title, date); $('notebooks').append(card);
    }
  }
  function showSource(id) {
    const source = material.find(s => s.id === id); if (!source) return status('This reference is no longer available.');
    $('source-title').textContent = source.title; $('source-text').textContent = source.text || 'No extracted text yet. Processing may still be running.'; $('source-dialog').showModal();
  }
  function renderSources() {
    $('sources').replaceChildren(); const query = $('source-filter').value.toLowerCase();
    const filtered = material.filter(s => (s.title + ' ' + s.text).toLowerCase().includes(query));
    if (!filtered.length) $('sources').textContent = material.length ? 'No matching material.' : 'No sources yet. Upload your first document.';
    for (const s of filtered) {
      const row = document.createElement('div'); row.className = 'source-row';
      const state = document.createElement('small'); state.textContent = `${s.kind} · ${s.status}${s.status === 'completed' && !s.text ? ' · no text extracted' : ''}`;
      row.append(button(s.title, () => showSource(s.id)), state); $('sources').append(row);
    }
  }
  function renderAnswers(messages) {
    $('answers').replaceChildren();
    for (const m of messages) {
      const row = document.createElement('section'); row.className = 'answer';
      const question = document.createElement('strong'); question.textContent = m.question;
      const answer = document.createElement('p'); answer.textContent = m.answer;
      const note = document.createElement('small'); note.textContent = m.citations.length ? 'References supplied by the model; inspect the source below.' : 'No verified source references were supplied in this answer.';
      row.append(question, answer, note);
      m.citations.forEach((c, i) => row.append(button(`[${i + 1}] ${c.title}`, () => showSource(c.id), 'citation')));
      row.append(button('Save answer as note', () => edit('note', m.question.slice(0, 150), m.answer), 'citation'));
      $('answers').append(row);
    }
  }
  function schedulePoll() {
    clearTimeout(polling);
    if (current && !working && material.some(s => !['completed', 'failed', 'error'].includes(s.status))) polling = setTimeout(() => action(refresh), 5000);
  }
  async function refresh() {
    if (!current) return;
    const data = await api(path()); material = data.items;
    $('notebook-name').textContent = data.notebook.name; renderSources(); renderAnswers(data.messages);
    $('linked-tasks').replaceChildren();
    for (const task of data.tasks) { const line = document.createElement('p'); line.textContent = `${task.completed ? '✓' : '○'} ${task.title} · ${new Date(task.due_at).toLocaleString()}`; $('linked-tasks').append(line); }
  }
  async function open(id) {
    current = id; $('source-filter').value = ''; await refresh();
    $('home').hidden = true; $('workspace').hidden = false; history.replaceState(null, '', '/study?notebook=' + encodeURIComponent(id)); $('notebook-name').focus();
  }
  function edit(mode, name = '', content = '') { editMode = mode; $('edit-heading').textContent = mode === 'create' ? 'A new notebook' : mode === 'rename' ? 'Rename notebook' : 'Save a note'; $('edit-name').value = name; $('note-content').value = content; $('note-body').hidden = mode !== 'note'; $('note-content').required = mode === 'note'; $('edit-error').textContent = ''; $('edit-dialog').showModal(); }
  $('new-notebook').onclick = () => edit('create'); $('rename').onclick = () => edit('rename', $('notebook-name').textContent); $('new-note').onclick = () => edit('note');
  $('edit-cancel').onclick = () => $('edit-dialog').close(); $('source-close').onclick = () => $('source-dialog').close();
  $('edit-form').onsubmit = event => { event.preventDefault(); action(async () => {
    try {
      if (editMode === 'create') { const data = await api('/notebooks', 'POST', { name: $('edit-name').value }); await open(data.notebook.id); }
      else if (editMode === 'rename') { await api(path(), 'PATCH', { name: $('edit-name').value }); await refresh(); }
      else { await api(path('/notes'), 'POST', { title: $('edit-name').value, content: $('note-content').value }); await refresh(); }
      $('edit-dialog').close();
    } catch (e) { $('edit-error').textContent = e.message; }
  }); };
  $('back').onclick = () => action(home); $('refresh-sources').onclick = () => action(refresh); $('source-filter').oninput = renderSources;
  $('delete').onclick = () => { $('delete-error').textContent = ''; $('delete-dialog').showModal(); }; $('delete-cancel').onclick = () => $('delete-dialog').close();
  $('delete-confirm').onclick = () => action(async () => { try { await api(path(), 'DELETE', { confirm: true }); $('delete-dialog').close(); await home(); } catch(e) { $('delete-error').textContent = e.message; } });
  let uploadRequest;
  $('upload-form').onsubmit = event => { event.preventDefault(); action(async () => {
    const file = $('document').files[0]; if (!file) return;
    if (file.size > 15 * 1024 * 1024) throw new Error('Please choose a document under 15 MB.');
    $('upload-progress').hidden = false; $('upload-progress').value = 0; $('upload-status').textContent = 'Uploading…';
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); uploadRequest = xhr; xhr.open('POST', '/api/companion/study' + path('/sources')); xhr.setRequestHeader('Authorization', 'Bearer ' + token); xhr.timeout = 150000;
        xhr.upload.onprogress = e => { if (e.lengthComputable) $('upload-progress').value = e.loaded / e.total * 100; if (e.loaded === e.total) $('upload-status').textContent = 'Upload transferred. Waiting for document processing to be queued…'; };
        xhr.onload = () => { try { const data = JSON.parse(xhr.responseText); xhr.status < 300 ? resolve(data) : reject(new Error(data.error || 'Upload failed.')); } catch { reject(new Error('Upload failed.')); } };
        xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('Upload interrupted. Check the connection and retry.'));
        const body = new FormData(); body.append('file', file); xhr.send(body);
      });
      $('upload-status').textContent = 'Uploaded. Processing status is shown below.'; $('document').value = ''; await refresh();
    } catch(e) { $('upload-status').textContent = 'Upload did not complete.'; throw e; }
    finally { uploadRequest = null; $('upload-progress').hidden = true; }
  }); };
  async function ask(question) { $('question-status').textContent = 'Reading your notebook and preparing an answer…'; try { await api(path('/chat'), 'POST', { question }); $('question').value = ''; await refresh(); $('answers').scrollTop = $('answers').scrollHeight; } finally { $('question-status').textContent = ''; } }
  $('question-form').onsubmit = e => { e.preventDefault(); action(() => ask($('question').value)); };
  $('summarize').onclick = () => action(() => ask('Summarize the key concepts in this notebook. Include supporting source references and a short revision checklist.'));
  $('task-form').onsubmit = e => { e.preventDefault(); action(async () => { await api(path('/tasks'), 'POST', { title: $('task-title').value, dueAt: new Date($('task-due').value).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, requestId: taskRequest }); taskRequest = crypto.randomUUID(); $('task-status').textContent = 'Saved in your planner. Reminders appear while ZUNO is open or when you return.'; await refresh(); }); };
  async function boot() { $('retry').hidden = true; const data = await api('/status'); $('connection').textContent = data.message; if (!data.available) { $('new-notebook').disabled = true; return; } const id = new URLSearchParams(location.search).get('notebook'); await (id ? open(id) : home()); schedulePoll(); }
  $('retry').onclick = () => action(boot);
  boot().catch(e => { status(e.message); $('connection').textContent = 'Study Studio is unavailable. Your companion and planner are still available.'; $('retry').hidden = false; });
  window.addEventListener('pagehide', () => { clearTimeout(polling); controllers.forEach(c => c.abort()); uploadRequest?.abort(); });
})();
