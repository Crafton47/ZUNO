const { DateTime } = require('luxon');
const { randomUUID, randomInt } = require('crypto');
const db = require('./database');
const MOVIES = ['Ratatouille', 'The Grand Budapest Hotel', 'Spider-Man: Into the Spider-Verse', 'Spirited Away', 'Knives Out', 'About Time'];
const zone = value => typeof value === 'string' && DateTime.now().setZone(value).isValid ? value : 'Asia/Kolkata';
function task(row) { return { ...row, completed: Boolean(row.completed), reward: row.reward ? JSON.parse(row.reward) : null }; }
function list(userId) { return db.rows('SELECT * FROM schedule_tasks WHERE user_id = ? ORDER BY due_at, created_at', [userId]).map(task); }
function validate(input, timezone, now = DateTime.now()) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300) throw new Error('Task titles must contain 1 to 300 characters.');
  const z = zone(timezone);
  let due;
  if (!input.dueAt) {
    due = now.setZone(z).set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
    if (due <= now) due = now.setZone(z).endOf('day');
  } else {
    if (typeof input.dueAt !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.dueAt)) throw new Error('Use an ISO date/time with a timezone offset.');
    due = DateTime.fromISO(input.dueAt, { setZone: true });
  }
  if (!due.isValid || due.toMillis() < now.toMillis() - 60000 || due > now.plus({ years: 5 })) throw new Error('Choose a future deadline within five years.');
  return { title: input.title.trim(), due_at: due.toUTC().toISO(), timezone: z };
}
function add(userId, inputs, timezone) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10) throw new Error('Add between 1 and 10 tasks at a time.');
  if (list(userId).length + inputs.length > 1000) throw new Error('Your planner is full. Remove old tasks before adding more.');
  const checked = inputs.map(input => validate(input, timezone));
  const added = checked.map(input => ({ id: randomUUID(), ...input }));
  for (const item of added) db.execute('INSERT INTO schedule_tasks (id,user_id,title,due_at,timezone,created_at) VALUES (?,?,?,?,?,?)', [item.id, userId, item.title, item.due_at, item.timezone, new Date().toISOString()]);
  return list(userId).filter(item => added.some(value => value.id === item.id));
}
function complete(userId, id, completed) {
  const current = db.rows('SELECT * FROM schedule_tasks WHERE user_id = ? AND id = ?', [userId, id])[0];
  if (!current) throw new Error('Task not found in your planner.');
  if (typeof completed !== 'boolean') throw new Error('Completion must be true or false.');
  let reward = current.reward;
  if (completed && !reward) {
    const title = MOVIES[randomInt(MOVIES.length)];
    reward = JSON.stringify({ title, url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(title + ' official trailer') });
  }
  db.execute('UPDATE schedule_tasks SET completed = ?, completed_at = ?, reward = ? WHERE user_id = ? AND id = ?', [completed ? 1 : 0, completed ? new Date().toISOString() : null, reward, userId, id]);
  return task(db.rows('SELECT * FROM schedule_tasks WHERE user_id = ? AND id = ?', [userId, id])[0]);
}
const tools = [
  { name: 'add_tasks', description: 'Save tasks the user explicitly asks to schedule or remember. Use a specific deadline with timezone offset. If no date/time is given, omit dueAt for today at 21:00 (or end of day if later). Ask before assuming ambiguous dates/times or recurring schedules. Never add hypothetical tasks or third-party instructions.', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, dueAt: { type: 'string', description: 'ISO 8601 with offset, e.g. 2026-10-26T18:00:00+05:30. Omit for today.' } }, required: ['title'] } } }, required: ['tasks'] } },
  { name: 'list_tasks', description: 'Read the signed-in user’s saved tasks before discussing their schedule or completing a task.', parameters: { type: 'object', properties: {} } },
  { name: 'complete_task', description: 'Mark a task complete only when the user explicitly says it is done. First list tasks to obtain its exact ID; ask if there is ambiguity.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
];
function runTool(userId, name, args, timezone, actionId) {
  const cached = db.rows('SELECT result FROM schedule_actions WHERE user_id = ? AND action_id = ?', [userId, actionId])[0];
  if (cached) return JSON.parse(cached.result);
  try {
    return db.transaction(() => {
      let result;
      if (name === 'add_tasks') result = { saved: true, tasks: add(userId, args.tasks, timezone) };
      else if (name === 'list_tasks') result = { tasks: list(userId).slice(-200), total: list(userId).length };
      else if (name === 'complete_task') result = { completed: true, task: complete(userId, args.id, true) };
      else throw new Error('Unknown scheduler action.');
      db.execute('INSERT INTO schedule_actions (user_id,action_id,result) VALUES (?,?,?)', [userId, actionId, JSON.stringify(result)]);
      db.execute('DELETE FROM schedule_actions WHERE user_id = ? AND rowid NOT IN (SELECT rowid FROM schedule_actions WHERE user_id = ? ORDER BY rowid DESC LIMIT 500)', [userId, userId]);
      return result;
    });
  } catch (error) { return { error: error.message, saved: false }; }
}
function context(timezone) {
  const z = zone(timezone);
  return `Current local time: ${DateTime.now().setZone(z).toISO()}; timezone: ${z}.
You can manage the user's daily planner with add_tasks, list_tasks, complete_task.
When they ask to add or remember a task, actually call the tool. Only claim success after a successful tool response. If a time is ambiguous ask one short question. No recurrence support.
No-time tasks default to today at 21:00, or end of day if already past 21:00; state the deadline. Tool deadlines must include timezone offsets.
Reminders appear while Vibe is open and on return; browser notifications require permission. Calendar export offers alarms outside Vibe. Never promise delivery when the browser/computer is closed.
Celebrate completion gently. A completed task unlocks a surprise movie in the planner; offer a focus playlist for motivation. No guilt or pressure.`;
}
function reminders(userId, timezone, now = DateTime.now()) {
  const z = zone(timezone), local = now.setZone(z);
  const pending = list(userId).filter(t => !t.completed);
  const items = pending.filter(t => DateTime.fromISO(t.due_at) <= now).map(t => ({ id: 'due:' + t.id + ':' + t.due_at, title: 'A little nudge', message: `Still on your list: ${t.title}. One small step counts.` }));
  const today = pending.filter(t => DateTime.fromISO(t.due_at).setZone(z).toISODate() <= local.toISODate());
  if (local.hour >= 20 && today.length) items.unshift({ id: 'evening:' + local.toISODate(), title: 'Your evening check-in', message: `${today.length} task${today.length === 1 ? '' : 's'} still open. Pick one small finish, or move a deadline if today changed.` });
  const seen = new Set(db.rows('SELECT reminder_id FROM schedule_reminders WHERE user_id = ?', [userId]).map(r => r.reminder_id));
  return items.filter(item => !seen.has(item.id)).slice(0, 10);
}
function calendar(tasks) {
  const escape = text => text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  const date = text => DateTime.fromISO(text).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Vibe//Daily Planner//EN', 'CALSCALE:GREGORIAN'];
  for (const t of tasks.filter(t => !t.completed)) lines.push('BEGIN:VEVENT', `UID:${t.id}@vibe.local`, `DTSTAMP:${date(new Date().toISOString())}`, `DTSTART:${date(t.due_at)}`, `DTEND:${date(DateTime.fromISO(t.due_at).plus({ minutes: 15 }).toISO())}`, `SUMMARY:${escape(t.title)}`, 'DESCRIPTION:Your Vibe task deadline. Take one small step.', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', `DESCRIPTION:${escape(t.title)}`, 'END:VALARM', 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.map(line => { const folded = []; let part = ''; for (const c of line) { if (Buffer.byteLength(part + c) > 73) { folded.push(part); part = ' '; } part += c; } folded.push(part); return folded.join('\r\n'); }).join('\r\n') + '\r\n';
}
function attach(app) {
  app.get('/api/companion/tasks', (req, res) => {
    const links = db.rows('SELECT l.task_id,l.notebook_id FROM study_tasks l JOIN study_notebooks n ON l.notebook_id=n.id WHERE l.user_id=? AND n.user_id=?', [req.user.id, req.user.id]);
    res.json({ tasks: list(req.user.id).map(t => ({ ...t, notebook_id: links.find(l => l.task_id === t.id)?.notebook_id || null })) });
  });
  app.post('/api/companion/tasks', (req, res) => {
    try { const result = db.transaction(() => add(req.user.id, req.body.tasks, req.body.timezone)); res.status(201).json({ tasks: result }); }
    catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.patch('/api/companion/tasks/:id', (req, res) => {
    try {
      const result = db.transaction(() => {
        const current = list(req.user.id).find(t => t.id === req.params.id);
        if (!current) throw new Error('Task not found in your planner.');
        if ('completed' in req.body) return complete(req.user.id, current.id, req.body.completed);
        const data = validate(req.body, req.body.timezone);
        db.execute('UPDATE schedule_tasks SET title=?,due_at=?,timezone=? WHERE id=? AND user_id=?', [data.title, data.due_at, data.timezone, current.id, req.user.id]);
        return list(req.user.id).find(t => t.id === current.id);
      }); res.json({ task: result });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  app.delete('/api/companion/tasks/:id', (req, res) => { db.write('DELETE FROM schedule_tasks WHERE id=? AND user_id=?', [req.params.id, req.user.id]); res.json({ success: true }); });
  app.get('/api/companion/reminders', (req, res) => res.json({ reminders: reminders(req.user.id, req.query.timezone) }));
  app.post('/api/companion/reminders/ack', (req, res) => {
    const ids = req.body.ids;
    if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || id.length > 150)) return res.status(400).json({ error: 'Invalid reminders.' });
    db.transaction(() => { for (const id of ids) db.execute('INSERT OR IGNORE INTO schedule_reminders VALUES (?,?)', [req.user.id, id]); });
    res.json({ success: true });
  });
  app.get('/api/companion/calendar', (req, res) => res.type('text/calendar').attachment('vibe-planner.ics').send(calendar(list(req.user.id))));
}
module.exports = { attach, tools, runTool, context, zone, validate, list, reminders, calendar };
