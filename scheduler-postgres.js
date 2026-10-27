// Async persistence adapter. Date parsing, validation and calendar formatting stay
// shared with the local scheduler; each mutation locks the account row in Postgres.
const db = require('./database');
const { randomUUID, randomInt } = require('node:crypto');
const { DateTime } = require('luxon');
const movies = ['Ratatouille', 'The Grand Budapest Hotel', 'Spider-Man: Into the Spider-Verse', 'Spirited Away', 'Knives Out', 'About Time'];

module.exports = base => {
  const task = row => ({ ...row, completed: Boolean(row.completed), reward: row.reward ? JSON.parse(row.reward) : null });
  const list = async owner => (await db.rows('SELECT * FROM schedule_tasks WHERE user_id=? ORDER BY due_at,created_at', [owner])).map(task);
  async function mutate(owner, fn) {
    return db.transaction(async () => {
      await db.rows('SELECT id FROM users WHERE id=? FOR UPDATE', [owner]);
      return fn();
    });
  }
  async function add(owner, inputs, timezone) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 10) throw new Error('Add between 1 and 10 tasks at a time.');
    if ((await list(owner)).length + inputs.length > 1000) throw new Error('Your planner is full. Remove old tasks before adding more.');
    const rows = inputs.map(input => ({ id: randomUUID(), ...base.validate(input, timezone) }));
    for (const row of rows) await db.execute('INSERT INTO schedule_tasks (id,user_id,title,due_at,timezone,created_at) VALUES (?,?,?,?,?,?)', [row.id, owner, row.title, row.due_at, row.timezone, new Date().toISOString()]);
    return (await list(owner)).filter(t => rows.some(row => row.id === t.id));
  }
  async function complete(owner, id, completed) {
    if (typeof completed !== 'boolean') throw new Error('Completion must be true or false.');
    const current = (await db.rows('SELECT * FROM schedule_tasks WHERE user_id=? AND id=?', [owner, id]))[0];
    if (!current) throw new Error('Task not found in your planner.');
    let reward = current.reward;
    if (completed && !reward) {
      const title = movies[randomInt(movies.length)];
      reward = JSON.stringify({ title, url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(title + ' official trailer') });
    }
    await db.execute('UPDATE schedule_tasks SET completed=?,completed_at=?,reward=? WHERE user_id=? AND id=?', [completed ? 1 : 0, completed ? new Date().toISOString() : null, reward, owner, id]);
    return task((await db.rows('SELECT * FROM schedule_tasks WHERE user_id=? AND id=?', [owner, id]))[0]);
  }
  async function runTool(owner, name, args, timezone, actionId) {
    try {
      return await mutate(owner, async () => {
        const cached = (await db.rows('SELECT result FROM schedule_actions WHERE user_id=? AND action_id=?', [owner, actionId]))[0];
        if (cached) return JSON.parse(cached.result);
        let result;
        if (name === 'add_tasks') result = { saved: true, tasks: await add(owner, args?.tasks, timezone) };
        else if (name === 'list_tasks') { const tasks = await list(owner); result = { tasks: tasks.slice(-200), total: tasks.length }; }
        else if (name === 'complete_task') result = { completed: true, task: await complete(owner, args?.id, true) };
        else throw new Error('Unknown scheduler action.');
        await db.execute('INSERT INTO schedule_actions (user_id,action_id,result) VALUES (?,?,?)', [owner, actionId, JSON.stringify(result)]);
        return result;
      });
    } catch (error) {
      return { saved: false, error: error.code ? 'Planner storage is unavailable. Please retry.' : error.message };
    }
  }
  async function enriched(owner) {
    const links = await db.rows('SELECT l.task_id,l.notebook_id FROM study_tasks l JOIN study_notebooks n ON n.id=l.notebook_id WHERE l.user_id=? AND n.user_id=?', [owner, owner]);
    const exams = await db.rows('SELECT l.task_id,l.plan_id,l.block_id,p.data FROM exam_task_links l JOIN exam_plans p ON p.id=l.plan_id AND p.user_id=l.user_id WHERE l.user_id=?', [owner]);
    return (await list(owner)).map(t => {
      const exam = exams.find(e => e.task_id === t.id), plan = exam ? JSON.parse(exam.data) : null;
      const block = plan?.blocks.find(b => b.id === exam.block_id);
      return { ...t, notebook_id: links.find(l => l.task_id === t.id)?.notebook_id || null, exam_plan_id: exam?.plan_id || null, exam_topic: block?.title || null, end_at: block?.end || null, reminders: plan ? plan.setup.reminders === true : undefined };
    });
  }
  async function reminders(owner, timezone, now = DateTime.now()) {
    const z = base.zone(timezone), local = now.setZone(z);
    const pending = (await enriched(owner)).filter(t => !t.completed && t.reminders !== false);
    const items = pending.filter(t => DateTime.fromISO(t.due_at) <= now).map(t => ({ id: 'due:' + t.id + ':' + t.due_at, title: 'A little nudge', message: `Still on your list: ${t.title}. One small step counts.` }));
    const today = pending.filter(t => DateTime.fromISO(t.due_at).setZone(z).toISODate() <= local.toISODate());
    if (local.hour >= 20 && today.length) items.unshift({ id: 'evening:' + local.toISODate(), title: 'Your evening check-in', message: `${today.length} tasks still open. Pick one small finish, or move a deadline if today changed.` });
    const seen = new Set((await db.rows('SELECT reminder_id FROM schedule_reminders WHERE user_id=?', [owner])).map(r => r.reminder_id));
    return items.filter(item => !seen.has(item.id)).slice(0, 10);
  }
  function attach(app) {
    const wrap = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
    const edit = fn => wrap(async (req, res) => {
      try { await fn(req, res); }
      catch (error) { if (error.code) throw error; res.status(400).json({ error: error.message }); }
    });
    app.get('/api/companion/tasks', wrap(async (req, res) => res.json({ tasks: await enriched(req.user.id) })));
    app.post('/api/companion/tasks', edit(async (req, res) => res.status(201).json({ tasks: await mutate(req.user.id, () => add(req.user.id, req.body.tasks, req.body.timezone)) })));
    app.patch('/api/companion/tasks/:id', edit(async (req, res) => {
      const result = await mutate(req.user.id, async () => {
        const current = (await list(req.user.id)).find(t => t.id === req.params.id);
        if (!current) throw new Error('Task not found in your planner.');
        if ('completed' in req.body) return complete(req.user.id, current.id, req.body.completed);
        if ((await db.rows('SELECT task_id FROM exam_task_links WHERE task_id=? AND user_id=?', [current.id, req.user.id])).length) throw new Error('Move this study session in Exam Rescue so availability and breaks stay valid.');
        const data = base.validate(req.body, req.body.timezone);
        await db.execute('UPDATE schedule_tasks SET title=?,due_at=?,timezone=? WHERE id=? AND user_id=?', [data.title, data.due_at, data.timezone, current.id, req.user.id]);
        return (await list(req.user.id)).find(t => t.id === current.id);
      });
      res.json({ task: result });
    }));
    app.delete('/api/companion/tasks/:id', wrap(async (req, res) => { await db.write('DELETE FROM schedule_tasks WHERE id=? AND user_id=?', [req.params.id, req.user.id]); res.json({ success: true }); }));
    app.get('/api/companion/reminders', wrap(async (req, res) => res.json({ reminders: await reminders(req.user.id, req.query.timezone) })));
    app.post('/api/companion/reminders/ack', edit(async (req, res) => {
      const ids = req.body.ids;
      if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || id.length > 150)) throw new Error('Invalid reminders.');
      await mutate(req.user.id, async () => { for (const id of ids) await db.execute('INSERT OR IGNORE INTO schedule_reminders VALUES (?,?)', [req.user.id, id]); });
      res.json({ success: true });
    }));
    app.get('/api/companion/calendar', wrap(async (req, res) => res.type('text/calendar').attachment('vibe-planner.ics').send(base.calendar(await enriched(req.user.id)))));
  }
  return { ...base, attach, list, complete, reminders, runTool };
};
