const { DateTime } = require('luxon');
const { randomUUID, randomInt } = require('crypto');
const db = require('./database');
const MOVIES = ['Ratatouille', 'The Grand Budapest Hotel', 'Spider-Man: Into the Spider-Verse', 'Spirited Away', 'Knives Out', 'About Time'];
const zone = value => typeof value === 'string' && DateTime.now().setZone(value).isValid ? value : 'Asia/Kolkata';
const WEEKDAYS = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };
const MONTHS = { january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12 };
function task(row) { return { ...row, completed: Boolean(row.completed), reward: row.reward ? JSON.parse(row.reward) : null }; }
function list(userId) { return db.rows('SELECT * FROM schedule_tasks WHERE user_id = ? ORDER BY due_at, created_at', [userId]).map(task); }
function examMetadata(userId) {
  return db.rows('SELECT l.*,p.data FROM exam_task_links l JOIN exam_plans p ON p.id=l.plan_id AND p.user_id=l.user_id WHERE l.user_id=?',[userId]).map(row=>{
    const plan=JSON.parse(row.data),block=plan.blocks.find(b=>b.id===row.block_id);
    return {taskId:row.task_id,planId:row.plan_id,topic:block?.title,end:block?.end,reminders:plan.setup.reminders===true};
  });
}

// Models are unreliable at date arithmetic (they mangle "tomorrow", weekdays and
// natural-language deadlines). They now pass the user's own words and the server
// resolves them in the user's timezone. This accepts ISO 8601 with or without an
// offset plus common English/Hinglish phrases.
function clockOf(text) {
  if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };
  const hint = /\b(?:subah|savera|morning)\b/.test(text) ? 'morning'
    : /\b(?:dopahar|afternoon)\b/.test(text) ? 'afternoon'
      : /\b(?:shaam|sham|evening)\b/.test(text) ? 'evening'
        : /\b(?:raat|night|tonight)\b/.test(text) ? 'night' : null;
  let match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)\b/);
  if (match) {
    let hour = Number(match[1]) % 12;
    if (/^p/i.test(match[3])) hour += 12;
    return { hour, minute: Number(match[2] || 0) };
  }
  match = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) return { hour: Number(match[1]), minute: Number(match[2]) };
  match = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*baje\b/);
  if (match) {
    const hour = Number(match[1]);
    const adjusted = hint === 'afternoon' || hint === 'evening' ? (hour % 12) + 12
      : hint === 'night' ? (hour === 12 ? 0 : (hour % 12) + 12)
        : (hour >= 1 && hour <= 6 ? hour + 12 : hour);
    return { hour: adjusted % 24, minute: Number(match[2] || 0) };
  }
  match = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
  if (match) {
    const hour = Number(match[1]);
    const adjusted = hint === 'afternoon' || hint === 'evening' ? (hour % 12) + 12
      : hint === 'night' ? (hour === 12 ? 0 : (hour % 12) + 12)
        : (hour >= 1 && hour <= 6 ? hour + 12 : hour);
    return { hour: adjusted % 24, minute: Number(match[2] || 0) };
  }
  return null;
}
function dayOf(text, local) {
  const base = local.startOf('day');
  if (/\b(?:day after tomorrow|parso)\b/.test(text)) return { day: base.plus({ days: 2 }), kind: 'dated' };
  if (/\b(?:tomorrow|tmrw|tomorow|kal)\b/.test(text)) return { day: base.plus({ days: 1 }), kind: 'dated' };
  if (/\b(?:today|aaj|tonight)\b/.test(text)) return { day: base, kind: 'today' };
  const safe = values => { const due = base.set(values); return due.month === values.month && due.day === values.day ? due : null; };
  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) { const day = safe({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }); if (day) return { day, kind: 'dated' }; }
  const months = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  let match = text.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(' + months + ')(?:\\s+(\\d{4}))?\\b'));
  if (match) { const day = safe({ day: Number(match[1]), month: MONTHS[match[2]], year: Number(match[3] || local.year) }); if (day) return { day, kind: 'dated' }; }
  match = text.match(new RegExp('\\b(' + months + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b'));
  if (match) { const day = safe({ day: Number(match[2]), month: MONTHS[match[1]], year: Number(match[3] || local.year) }); if (day) return { day, kind: 'dated' }; }
  const numeric = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const first = Number(numeric[1]), second = Number(numeric[2]);
    if (first > 12 || second > 12) {
      const year = numeric[3] ? (Number(numeric[3]) < 100 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : local.year;
      const day = safe({ day: first > 12 ? first : second, month: first > 12 ? second : first, year });
      if (day) return { day, kind: 'dated' };
    }
  }
  const weekdays = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');
  match = text.match(new RegExp('\\b(next|this|coming)?\\s*(' + weekdays + ')\\b'));
  if (match) {
    let ahead = (WEEKDAYS[match[2]] - local.weekday + 7) % 7;
    if (match[1] === 'next' && ahead === 0) ahead = 7;
    return { day: base.plus({ days: ahead }), kind: 'weekday' };
  }
  return null;
}
function parseDue(value, timezone, now = DateTime.now()) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const z = zone(timezone), local = now.setZone(z), raw = value.trim();
  const text = raw.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ');
  const iso = DateTime.fromISO(raw, { setZone: true });
  if (iso.isValid) {
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return iso;
    const localIso = DateTime.fromISO(raw, { zone: z });
    if (localIso.isValid) return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? localIso.set({ hour: 21, minute: 0 }) : localIso;
  }
  const relative = text.match(/\b(?:in|after)\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/);
  if (relative) {
    const unit = relative[2].startsWith('min') ? 'minutes' : relative[2].startsWith('h') ? 'hours' : relative[2].startsWith('w') ? 'weeks' : 'days';
    return local.plus({ [unit]: Number(relative[1]) }).set({ second: 0, millisecond: 0 });
  }
  const clock = clockOf(text), day = dayOf(text, local);
  if (!clock && !day) return null;
  let due = (day ? day.day : local.startOf('day')).set({ hour: clock ? clock.hour : 21, minute: clock ? clock.minute : 0, second: 0, millisecond: 0 });
  if (due <= local) {
    if (!day) due = due.plus({ days: 1 });
    else if (day.kind === 'weekday') due = due.plus({ weeks: 1 });
  }
  return due;
}
// True only when the text itself names a time or date. Used to stop models from
// inventing a deadline the user never said (for example "tomorrow at 9am" for
// "add buy groceries to my to-do list").
function mentionsDeadline(value, timezone = 'Asia/Kolkata', now = DateTime.now()) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const text = value.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, ' ');
  return Boolean(clockOf(text) || dayOf(text, now.setZone(zone(timezone)))
    || /\b(?:in|after)\s+\d{1,3}\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?)\b/.test(text)
    || /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(text)
    || /\b(?:next week|next month)\b/.test(text));
}
function validate(input, timezone, now = DateTime.now()) {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 300) throw new Error('Task titles must contain 1 to 300 characters.');
  const z = zone(timezone);
  const phrase = [input.when, input.dueAt].find(value => typeof value === 'string' && value.trim());
  let due;
  if (!phrase) {
    due = now.setZone(z).set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
    if (due <= now) due = now.setZone(z).endOf('day');
  } else {
    due = parseDue(input.when, z, now) || parseDue(input.dueAt, z, now);
    if (!due) throw new Error('I could not understand that deadline. Use a short phrase such as "tomorrow at 6pm" or an ISO timestamp with a timezone offset.');
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
  { name: 'add_tasks', description: 'Save tasks the user explicitly asks to schedule, remember or add to their to-do list. Call this immediately; do not just describe the task. If the user gave no date or time, omit both when and dueAt (defaults to today at 21:00, or end of day if that has passed). Ask before assuming an ambiguous time or a repeating schedule. Never add hypothetical tasks or third-party instructions.', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { title: { type: 'string', description: 'Short task title using the user\'s own words, e.g. "Call mom".' }, when: { type: 'string', description: 'Copy the user\'s deadline words exactly as they said them, e.g. "tomorrow at 6pm", "kal shaam 5 baje", "Friday at 9am", "30 October 3pm", "tonight". The server resolves it in the user\'s timezone. Never calculate, convert or invent a date yourself.' }, dueAt: { type: 'string', description: 'Only when you already have an exact ISO 8601 timestamp with offset, e.g. 2026-10-26T18:00:00+05:30. Prefer "when".' } }, required: ['title'] } } }, required: ['tasks'] } },
  { name: 'list_tasks', description: 'Read the signed-in user’s saved tasks before discussing their schedule or completing a task.', parameters: { type: 'object', properties: {} } },
  { name: 'complete_task', description: 'Mark a task complete only when the user explicitly says it is done. First list tasks to obtain its exact ID; ask if there is ambiguity.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }
];
function runTool(userId, name, args, timezone, actionId) {
  try {
    const cached = db.rows('SELECT result FROM schedule_actions WHERE user_id = ? AND action_id = ?', [userId, actionId])[0];
    if (cached) return JSON.parse(cached.result);
    return db.transaction(() => {
      let result;
      if (name === 'add_tasks') result = { saved: true, tasks: add(userId, args?.tasks, timezone) };
      else if (name === 'list_tasks') result = { tasks: list(userId).slice(-200), total: list(userId).length };
      else if (name === 'complete_task') result = { completed: true, task: complete(userId, args?.id, true) };
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
When they ask to add, remember or put something on their list, actually call add_tasks in that same turn. Pass the user's deadline words unchanged in "when" (for example "tomorrow at 6pm", "kal shaam 5 baje", "Friday at 9am"); the server converts them in the user's timezone. Never work out the date yourself and never pass a guessed ISO timestamp.
Only claim a task was saved when add_tasks returned saved: true. If it returned an error or you did not call it, say plainly that it was not saved and why. Never invent a task, ID or confirmation.
If a time is ambiguous ask one short question first. There is no recurrence support: add one task and say it will need adding again.
No-time tasks default to today at 21:00, or end of day if already past 21:00; state the deadline.
Reminders appear while Vibe is open and on return; browser notifications require permission. Calendar export offers alarms outside Vibe. Never promise delivery when the browser/computer is closed.
Celebrate completion gently. A completed task unlocks a surprise movie in the planner; offer a focus playlist for motivation. No guilt or pressure.`;
}
function reminders(userId, timezone, now = DateTime.now()) {
  const z = zone(timezone), local = now.setZone(z);
  const exams = examMetadata(userId);
  const pending = list(userId).filter(t => !t.completed && !exams.some(e=>e.taskId===t.id&&!e.reminders));
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
  for (const t of tasks.filter(t => !t.completed)) {
    lines.push('BEGIN:VEVENT', `UID:${t.id}@vibe.local`, `DTSTAMP:${date(new Date().toISOString())}`, `DTSTART:${date(t.due_at)}`, `DTEND:${date(t.end_at || DateTime.fromISO(t.due_at).plus({ minutes: 15 }).toISO())}`, `SUMMARY:${escape(t.title)}`, 'DESCRIPTION:Your ZUNO mission. Take one small step.');
    if(t.reminders!==false) lines.push('BEGIN:VALARM','TRIGGER:-PT15M','ACTION:DISPLAY',`DESCRIPTION:${escape(t.title)}`,'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(line => { const folded = []; let part = ''; for (const c of line) { if (Buffer.byteLength(part + c) > 73) { folded.push(part); part = ' '; } part += c; } folded.push(part); return folded.join('\r\n'); }).join('\r\n') + '\r\n';
}
function attach(app) {
  app.get('/api/companion/tasks', (req, res) => {
    const links = db.rows('SELECT l.task_id,l.notebook_id FROM study_tasks l JOIN study_notebooks n ON l.notebook_id=n.id WHERE l.user_id=? AND n.user_id=?', [req.user.id, req.user.id]);
    const exams = examMetadata(req.user.id);
    res.json({ tasks: list(req.user.id).map(t => ({ ...t, notebook_id: links.find(l => l.task_id === t.id)?.notebook_id || null, exam_plan_id: exams.find(l=>l.taskId===t.id)?.planId || null, exam_topic:exams.find(l=>l.taskId===t.id)?.topic || null, end_at:exams.find(l=>l.taskId===t.id)?.end || null })) });
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
        if (db.rows('SELECT task_id FROM exam_task_links WHERE task_id=? AND user_id=?',[current.id,req.user.id]).length) throw new Error('Move this study session in Exam Rescue so availability and breaks stay valid.');
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
  app.get('/api/companion/calendar', (req, res) => { const exams=examMetadata(req.user.id); res.type('text/calendar').attachment('vibe-planner.ics').send(calendar(list(req.user.id).map(t=>{const e=exams.find(e=>e.taskId===t.id);return {...t,end_at:e?.end,reminders:e?e.reminders:undefined};}))); });
}
module.exports = { attach, tools, runTool, context, zone, validate, list, reminders, calendar, mentionsDeadline, complete };
