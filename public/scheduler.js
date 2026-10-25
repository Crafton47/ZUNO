'use strict';
(() => {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let tasks = [], editing = null, rewardTask = null, loading = false, reload = false, loaded = false;
  let userId = 'local'; try { userId = JSON.parse(atob(token.split('.')[1])).id; } catch {}
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const localInput = date => localDate(date) + `T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const dateLabel = date => new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const startOfWeek = now => { const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return start; };
  function streakDays() {
    const wins = new Set(tasks.filter(t => t.completed_at).map(t => localDate(new Date(t.completed_at))));
    const cursor = new Date(); cursor.setHours(12, 0, 0, 0);
    if (!wins.has(localDate(cursor))) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (wins.has(localDate(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    return streak;
  }
  function renderOverview() {
    const now = new Date(), today = localDate(now);
    const daily = tasks.filter(t => localDate(new Date(t.due_at)) === today);
    const overdue = tasks.filter(t => !t.completed && localDate(new Date(t.due_at)) < today);
    const todayMissions = [...overdue, ...daily];
    const doneToday = daily.filter(t => t.completed).length;
    const completed = tasks.filter(t => t.completed).length;
    const completedThisWeek = tasks.filter(t => t.completed_at && new Date(t.completed_at) >= startOfWeek(now)).length;
    const next = tasks.filter(t => !t.completed).sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0];
    const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
    $('stat-today-value').textContent = todayMissions.length;
    $('stat-today-note').textContent = todayMissions.length ? `${doneToday} of ${todayMissions.length} done` : 'Nothing due today';
    $('stat-done-value').textContent = completed;
    $('stat-done-note').textContent = completedThisWeek ? `${completedThisWeek} this week` : 'Missions banked';
    const streak = streakDays();
    $('stat-streak-value').textContent = streak;
    $('stat-streak-note').textContent = streak ? `${streak === 1 ? 'day' : 'days'} in a row` : 'Finish one to start';
    let nextValue = '—', nextNote = 'Nothing queued';
    if (next) {
      const due = new Date(next.due_at);
      const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
      if (due < now) nextValue = 'Overdue';
      else if (localDate(due) === today) nextValue = due.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      else if (localDate(due) === localDate(tomorrow)) nextValue = 'Tomorrow';
      else nextValue = due.toLocaleDateString([], { month: 'short', day: 'numeric' });
      nextNote = next.title;
    }
    $('stat-next-value').textContent = nextValue;
    $('stat-next-note').textContent = nextNote;
    $('stat-progress-value').textContent = progress + '%';
    $('stat-progress-note').textContent = tasks.length ? `${completed} of ${tasks.length} missions complete` : 'Start with one mission';
    $('stat-progress-fill').style.width = progress + '%';
  }
  $('planner-day').value = localDate(new Date()); $('planner-year-input').value = new Date().getFullYear(); $('task-zone').textContent = timezone;
  const error = text => { $('planner-error').textContent = text; };
  function button(text, action, label) { const el = document.createElement('button'); el.type = 'button'; el.textContent = text; if (label) el.setAttribute('aria-label', label); el.onclick = action; return el; }
  function openEditor(item, day = $('planner-day').value) {
    editing = item?.id || null;
    $('task-dialog-title').textContent = item ? 'Edit this mission' : 'Add a mission';
    $('task-title').value = item?.title || '';
    const now = new Date(); let due = item ? new Date(item.due_at) : new Date(day + 'T21:00');
    if (!item && due < now) { due = new Date(now.getTime() + 30 * 60000); }
    $('task-due').value = localInput(due); $('task-error').textContent = ''; $('task-dialog').showModal();
  }
  function reward(item) {
    rewardTask = item; $('reward-for').textContent = `You finished: ${item.title}. That counts.`;
    $('reward-result').hidden = true; $('reward-reveal').hidden = false;
    if (!$('reward-dialog').open) $('reward-dialog').showModal();
  }
  async function update(item, completed, control) {
    control.disabled = true;
    try {
      const data = await api('/tasks/' + item.id, { method: 'PATCH', body: JSON.stringify({ completed }) });
      tasks = tasks.map(t => t.id === item.id ? data.task : t); render(); error('');
      if (completed && data.task.reward) reward(data.task);
      if (completed) { document.body.classList.add('mission-complete'); setTimeout(() => document.body.classList.remove('mission-complete'), 650); }
    } catch (e) { error(e.message); control.checked = item.completed; }
    finally { control.disabled = false; }
  }
  function render() {
    const today = localDate(new Date()), day = $('planner-day').value || today;
    const daily = tasks.filter(t => localDate(new Date(t.due_at)) === day);
    const overdue = day === today ? tasks.filter(t => !t.completed && localDate(new Date(t.due_at)) < today) : [];
    const done = daily.filter(t => t.completed).length;
    $('planner-count').textContent = `${done} / ${daily.length} done`;
    $('planner-progress').max = Math.max(1, daily.length); $('planner-progress').value = done;
    const container = $('planner-tasks'); container.replaceChildren();
    if (!daily.length && !overdue.length) { const empty = document.createElement('p'); empty.className = 'planner-empty'; empty.textContent = 'No missions here yet. Add one, or tell AURA what’s on your mind.'; container.append(empty); }
    for (const item of [...overdue, ...daily]) {
      const row = document.createElement('div'); row.className = 'planner-task' + (item.completed ? ' done' : '');
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = item.completed; check.setAttribute('aria-label', 'Complete ' + item.title); check.onchange = () => update(item, check.checked, check);
      const text = document.createElement('div'); text.className = 'task-copy';
      const title = document.createElement('strong'); title.textContent = item.title;
      const time = document.createElement('small'); const isOverdue = !item.completed && new Date(item.due_at) < new Date(); time.textContent = (isOverdue ? 'Overdue · ' : '') + dateLabel(item.due_at); if (isOverdue) time.className = 'task-overdue'; text.append(title, time);
      const controls = document.createElement('div'); controls.className = 'task-controls';
      if (item.completed && item.reward) controls.append(button('Gift', () => reward(item), 'Movie reward for ' + item.title));
      controls.append(button('Edit', () => openEditor(item), 'Edit ' + item.title));
      controls.append(button('×', async event => {
        const control = event.currentTarget;
        if (control.dataset.confirm !== 'yes') { control.dataset.confirm = 'yes'; control.textContent = 'Delete?'; return; }
        control.disabled = true;
        try { await api('/tasks/' + item.id, { method: 'DELETE' }); tasks = tasks.filter(t => t.id !== item.id); render(); error(''); } catch (e) { error(e.message); control.disabled = false; }
      }, 'Delete ' + item.title));
      row.append(check, text, controls); container.append(row);
    }
    renderOverview();
    renderYear();
  }
  function renderYear() {
    const year = Number($('planner-year-input').value), grid = $('planner-months'); grid.replaceChildren();
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return;
    for (let month = 0; month < 12; month++) {
      const items = tasks.filter(t => { const date = new Date(t.due_at); return date.getFullYear() === year && date.getMonth() === month; });
      const card = document.createElement('article'); card.className = 'planner-month';
      const heading = document.createElement('h3'); heading.textContent = new Date(year, month, 1).toLocaleString([], { month: 'long' });
      const count = document.createElement('small'); count.textContent = `${items.filter(t => t.completed).length}/${items.length} completed`;
      card.append(heading, count, button('+', () => openEditor(null, `${year}-${String(month + 1).padStart(2, '0')}-01`), 'Add task in ' + heading.textContent));
      for (const item of items.slice(0, 5)) { const b = button((item.completed ? '✓ ' : '○ ') + item.title, () => { $('planner-day').value = localDate(new Date(item.due_at)); render(); $('planner-tasks').scrollIntoView({ block: 'center' }); }); card.append(b); }
      if (items.length > 5) { const more = document.createElement('small'); more.textContent = `${items.length - 5} more — choose a day above to view`; card.append(more); }
      grid.append(card);
    }
  }
  async function loadTasks() {
    if (loading) { reload = true; return; } loading = true;
    try {
      const data = await api('/tasks');
      const added = loaded ? data.tasks.filter(t => !tasks.some(old => old.id === t.id)) : [];
      const newlyDone = data.tasks.find(t => t.completed && t.reward && tasks.some(old => old.id === t.id && !old.completed));
      if (JSON.stringify(tasks) !== JSON.stringify(data.tasks) || !$('planner-tasks').children.length) {
        tasks = data.tasks;
        // A task added by chat or a voice call may be due on another day; show that day so it is visible.
        if (added.length && !$('task-dialog').open) $('planner-day').value = localDate(new Date(added[0].due_at));
        render();
      }
      loaded = true;
      if (newlyDone) reward(newlyDone);
    } catch (e) { error('Planner could not refresh: ' + e.message); }
    finally { loading = false; if (reload) { reload = false; loadTasks(); } }
  }
  async function checkReminders() {
    try {
      const { reminders } = await api('/reminders?timezone=' + encodeURIComponent(timezone));
      const area = $('planner-reminders'); area.replaceChildren();
      for (const reminder of reminders) {
        const row = document.createElement('div'); row.className = 'planner-nudge';
        const content = document.createElement('span'); content.textContent = reminder.title + ': ' + reminder.message;
        const dismiss = button('Got it', async () => { try { await api('/reminders/ack', { method: 'POST', body: JSON.stringify({ ids: [reminder.id] }) }); row.remove(); } catch (e) { error(e.message); } });
        row.append(content, dismiss); area.append(row);
        const key = `vibe-reminder:${userId}:${reminder.id}`;
        try {
          if ('Notification' in window && Notification.permission === 'granted' && localStorage.getItem('vibe-notifications:' + userId) === 'on' && !localStorage.getItem(key)) {
            const notification = new Notification(reminder.title, { body: reminder.message, tag: key }); notification.onclick = () => { window.focus(); $('daily-planner').scrollIntoView(); notification.close(); };
            localStorage.setItem(key, 'shown');
          }
        } catch { /* In-app reminders remain available if the OS blocks notifications. */ }
      }
    } catch { /* Retry on the next poll. */ }
  }
  $('planner-add').onclick = () => openEditor();
  $('task-close').onclick = () => $('task-dialog').close();
  $('task-form').onsubmit = async event => {
    event.preventDefault(); const control = event.submitter; control.disabled = true;
    try {
      const due = new Date($('task-due').value); if (!Number.isFinite(due.getTime())) throw new Error('Choose a valid deadline.');
      const item = { title: $('task-title').value, dueAt: due.toISOString(), timezone };
      await api('/tasks' + (editing ? '/' + editing : ''), { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(editing ? item : { tasks: [item], timezone }) });
      $('planner-day').value = localDate(due); $('task-dialog').close(); await loadTasks(); checkReminders();
    } catch (e) { $('task-error').textContent = e.message; }
    finally { control.disabled = false; }
  };
  $('planner-day').onchange = render;
  $('planner-today').onclick = () => { $('planner-day').value = localDate(new Date()); render(); };
  $('planner-year-toggle').onclick = () => { const panel = $('planner-year'); panel.hidden = !panel.hidden; $('planner-year-toggle').setAttribute('aria-expanded', String(!panel.hidden)); renderYear(); };
  $('planner-year-input').onchange = renderYear;
  function confetti(container) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors = ['#d7ff65', '#39e8ff', '#925bff', '#ff73c6'];
    const burst = document.createElement('div');
    burst.className = 'confetti-burst';
    burst.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 20; i++) {
      const p = document.createElement('span');
      const angle = (i / 20) * 360 + (Math.random() * 20 - 10);
      const dist = 60 + Math.random() * 70;
      const rad = (angle * Math.PI) / 180;
      p.style.setProperty('--tx', `${Math.cos(rad) * dist}px`);
      p.style.setProperty('--ty', `${Math.sin(rad) * dist}px`);
      p.style.setProperty('--color', colors[i % colors.length]);
      p.style.setProperty('--rot', `${Math.random() * 360}deg`);
      burst.appendChild(p);
    }
    container.appendChild(burst);
    setTimeout(() => burst.remove(), 900);
  }
  $('reward-close').onclick = () => $('reward-dialog').close();
  $('reward-reveal').onclick = () => {
    if (!rewardTask?.reward) return;
    $('reward-title').textContent = rewardTask.reward.title;
    $('reward-link').href = rewardTask.reward.url;
    $('reward-result').hidden = false;
    $('reward-reveal').hidden = true;
    confetti($('reward-dialog'));
  };
  $('planner-focus').onclick = () => { document.querySelector('[data-mood="focus"]').click(); $('mood-studio').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
  function notificationLabel() { $('planner-notifications').textContent = localStorage.getItem('vibe-notifications:' + userId) === 'on' ? 'Pause notifications' : 'Enable reminders'; }
  $('planner-notifications').onclick = async () => {
    if (localStorage.getItem('vibe-notifications:' + userId) === 'on') { localStorage.removeItem('vibe-notifications:' + userId); notificationLabel(); return; }
    if (!('Notification' in window)) { error('This browser does not support desktop notifications. In-app reminders still work.'); return; }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') { localStorage.setItem('vibe-notifications:' + userId, 'on'); error('Notifications enabled while Vibe is running. Use calendar export for reminders outside the app.'); notificationLabel(); checkReminders(); }
    else error('Notifications are blocked or dismissed. You can still see reminders here, or change your browser site permissions.');
  };
  $('planner-export').onclick = async () => {
    try {
      const response = await fetch('/api/companion/calendar', { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('Calendar export failed. Please sign in again and retry.');
      const url = URL.createObjectURL(await response.blob()); const a = document.createElement('a'); a.href = url; a.download = 'vibe-planner.ics'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      error('Import the file into your calendar and check that its alerts are enabled. This is a snapshot; later changes need a new export.');
    } catch (e) { error(e.message); }
  };
  notificationLabel(); loadTasks(); checkReminders();
  const timer = setInterval(() => { loadTasks(); checkReminders(); }, 30000);
  window.addEventListener('vibe-tasks-changed', () => { loadTasks(); checkReminders(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadTasks(); checkReminders(); } });
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
