const { test } = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { citationsFor } = require('../study');

test('citations resolve only to authorized context; invented references are removed', () => {
  const allowed = [{ id: 'local-a', remote_id: 'source:abc', kind: 'source', title: 'My notes' }];
  const result = citationsFor('Fact [source:abc]. Again [source:abc]. Secret [source:other]. Fabrication [insight:unknown].', allowed);
  assert.equal(result.citations.length, 1);
  assert.deepEqual(result.citations[0], { id: 'local-a', kind: 'source', title: 'My notes' });
  assert.equal(result.text, 'Fact [1]. Again [1]. Secret [unverified reference omitted]. Fabrication [unverified reference omitted].');
});

test('citations deduplicate multiple references to the same source in correct index order', () => {
  const allowed = [
    { id: 'src-1', remote_id: 'source:one', kind: 'source', title: 'Doc 1' },
    { id: 'src-2', remote_id: 'source:two', kind: 'source', title: 'Doc 2' },
  ];
  const result = citationsFor('Point A [source:one], Point B [source:two], Point C [source:one].', allowed);
  assert.equal(result.citations.length, 2);
  assert.equal(result.text, 'Point A [1], Point B [2], Point C [1].');
  assert.equal(result.citations[0].id, 'src-1');
  assert.equal(result.citations[1].id, 'src-2');
});

test('additive Study Studio schema statements execute cleanly on SQLite without errors', async () => {
  const SQL = await initSqlJs();
  const memDb = new SQL.Database();
  const schema = `
    CREATE TABLE IF NOT EXISTS study_notebooks (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, remote_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, opened_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_items (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, user_id INTEGER NOT NULL, remote_id TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_tasks (task_id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, user_id INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS study_messages (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, user_id INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, citations TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_flashcards (id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL, user_id INTEGER NOT NULL, front TEXT NOT NULL, back TEXT NOT NULL, difficulty TEXT NOT NULL DEFAULT 'new', reviewed_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_xp (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, notebook_id TEXT NOT NULL, event TEXT NOT NULL, earned INTEGER NOT NULL, earned_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS study_feedback (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, user_id INTEGER NOT NULL, helpful INTEGER NOT NULL, created_at TEXT NOT NULL);
  `;
  for (const stmt of schema.split(';').filter(s => s.trim())) {
    memDb.run(stmt);
  }
  const res = memDb.exec("SELECT name FROM sqlite_master WHERE type='table'");
  const tables = res[0].values.map(v => v[0]);
  assert.ok(tables.includes('study_notebooks'));
  assert.ok(tables.includes('study_items'));
  assert.ok(tables.includes('study_tasks'));
  assert.ok(tables.includes('study_messages'));
  assert.ok(tables.includes('study_flashcards'));
  assert.ok(tables.includes('study_xp'));
  assert.ok(tables.includes('study_feedback'));
  memDb.close();
});

test('study routes reject foreign/oversized context, invalid model output and XP; deletion preserves missions and other notebooks', async () => {
  const express = require('express');
  const db = require('../database');
  const study = require('../study');
  const SQL = await initSqlJs(), memory = new SQL.Database();
  const originalDb = Object.fromEntries(['rows', 'write', 'execute', 'transaction'].map(key => [key, db[key]]));
  const envKeys = ['STUDY_ENABLED', 'STUDY_OWNER_ID', 'OPEN_NOTEBOOK_PASSWORD', 'OPEN_NOTEBOOK_URL'];
  const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  let server, context = { sources: [{ id: 'source:owned', full_text: 'Synthetic study notes' }], notes: [] };
  let modelCalls = 0, modelOutput = 'Synthetic answer [source:owned]';
  try {
    db.rows = (sql, params = []) => {
      const statement = memory.prepare(sql);
      try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
      finally { statement.free(); }
    };
    db.execute = db.write = (sql, params = []) => memory.run(sql, params);
    db.transaction = action => { memory.run('BEGIN'); try { const result = action(); memory.run('COMMIT'); return result; } catch (error) { memory.run('ROLLBACK'); throw error; } };
    study.init();
    memory.run('CREATE TABLE schedule_tasks (id TEXT PRIMARY KEY, user_id INTEGER, completed INTEGER)');
    for (const [id, user] of [['owned', 1], ['other', 2]]) {
      db.execute('INSERT INTO study_notebooks VALUES (?,?,?,?,?)', [id, user, 'notebook:' + id, 'Synthetic', '2026-01-01']);
      db.execute('INSERT INTO study_items VALUES (?,?,?,?,?,?)', ['item:' + id, id, user, 'source:' + id, 'source', 'Synthetic']);
    }
    Object.assign(process.env, { STUDY_ENABLED: 'true', STUDY_OWNER_ID: '1', OPEN_NOTEBOOK_PASSWORD: 'synthetic-test-password', OPEN_NOTEBOOK_URL: 'http://127.0.0.1:5055' });
    global.fetch = async (url, options) => {
      const target = new URL(url);
      if (target.port !== '5055') return originalFetch(url, options);
      let data = {};
      if (target.pathname === '/api/chat/context') data = { context };
      if (target.pathname === '/api/chat/sessions') data = { id: 'session:synthetic' };
      if (target.pathname === '/api/chat/execute') { modelCalls++; data = { messages: [{ type: 'ai', content: modelOutput }] }; }
      return { ok: true, status: 200, json: async () => data };
    };
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { req.user = { id: Number(req.headers['x-test-user'] || 1) }; next(); });
    study.attach(app);
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const base = 'http://127.0.0.1:' + server.address().port + '/api/companion/study/notebooks/';
    const request = async (route, body = {}, method = 'POST', user = 1) => {
      const response = await originalFetch(base + route, { method, headers: { 'Content-Type': 'application/json', 'X-Test-User': String(user) }, body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    assert.equal((await request('other/chat', { question: 'Test' })).status, 404);
    assert.equal((await request('owned/chat', { question: 'Test' }, 'POST', 2)).status, 403);
    for (const route of ['chat', 'exam', 'quiz', 'flashcards/generate', 'explain']) {
      context = { sources: [{ id: 'source:foreign', full_text: 'Synthetic foreign data' }] };
      assert.equal((await request('owned/' + route, { question: 'Test' })).status, 502, route);
      context = { sources: [{ id: 'source:owned', full_text: 'x'.repeat(180001) }] };
      assert.equal((await request('owned/' + route, { question: 'Test' })).status, 400, route);
    }
    assert.equal(modelCalls, 0, 'Rejected contexts never reach the model');
    context = { sources: [{ id: 'source:owned', full_text: 'Synthetic study notes' }] };
    for (const route of ['quiz', 'flashcards/generate']) assert.equal((await request('owned/' + route, { topic: {} })).status, 400);
    for (const body of [{ event: 'toString' }, { event: '__proto__' }, { event: 'quiz_complete', score: -1 }, { event: 'quiz_complete', score: '1' }, { event: 'quiz_complete', score: 2 }]) {
      assert.equal((await request('owned/xp', body)).status, 400);
    }
    assert.equal((await request('owned/xp', { event: 'quiz_complete', score: 1 })).data.earned, 50);
    assert.equal((await request('owned/xp', { event: 'quiz_complete', score: 1 })).data.earned, 0);
    for (const correct of [-1, 4, '0', null]) {
      modelOutput = JSON.stringify([{ question: 'Test?', options: ['A', 'B', 'C', 'D'], correct }]);
      assert.equal((await request('owned/quiz')).status, 502, 'Invalid answer index must not be silently corrected');
    }
    modelOutput = JSON.stringify([{ question: 'Test?', options: ['A', 'B', 'C', 'D'], correct: 2 }]);
    assert.equal((await request('owned/quiz')).data.questions[0].correct, 2);
    modelOutput = JSON.stringify([{ front: 'Synthetic question', back: 'Synthetic answer' }]);
    assert.equal((await request('owned/flashcards/generate')).status, 201);
    modelOutput = 'Synthetic answer [source:owned]';
    for (const route of ['chat', 'explain']) {
      const answer = await request('owned/' + route, { question: 'Synthetic question' });
      assert.equal(answer.status, 200);
      assert.ok(answer.data.id, 'Saved answer exposes its ID for feedback');
      assert.equal((await request('owned/feedback', { messageId: answer.data.id, helpful: true })).status, 200);
      assert.equal((await request('owned/feedback', { messageId: answer.data.id, helpful: false })).status, 200);
      assert.equal(db.rows('SELECT * FROM study_feedback WHERE message_id=?', [answer.data.id]).length, 1, 'Feedback updates rather than duplicates');
    }
    const notebookResponse = await originalFetch(base + 'owned');
    const notebookData = await notebookResponse.json();
    assert.ok(notebookData.messages.every(message => message.id), 'History retains feedback IDs after refresh');
    for (const [id, user] of [['owned', 1], ['other', 2]]) {
      db.execute('INSERT INTO study_messages VALUES (?,?,?,?,?,?,?)', ['message:' + id, id, user, 'Q', 'A', '[]', '2026-01-01']);
      db.execute('INSERT INTO study_feedback VALUES (?,?,?,?,?)', ['feedback:' + id, 'message:' + id, user, 1, '2026-01-01']);
      db.execute('INSERT INTO exam_plans VALUES (?,?,?,?,?)', ['plan:' + id, user, id, 1, '{}']);
      db.execute('INSERT INTO exam_previews VALUES (?,?,?,?,?)', ['preview:' + id, user, id, 1, '{}']);
      db.execute('INSERT INTO exam_task_links VALUES (?,?,?,?)', ['task:' + id, 'plan:' + id, 'block', user]);
      db.execute('INSERT INTO study_tasks VALUES (?,?,?)', ['task:' + id, id, user]);
      db.execute('INSERT INTO schedule_tasks VALUES (?,?,?)', ['task:' + id, user, 1]);
      db.execute('INSERT INTO study_quiz_results VALUES (?,?,?,?,?,?,?)', ['quiz:' + id, id, user, 'Synthetic', 1, 1, '2026-01-01']);
    }
    assert.equal((await request('owned', { confirm: true }, 'DELETE')).status, 200);
    for (const table of ['study_notebooks', 'study_items', 'study_messages', 'study_feedback', 'study_flashcards', 'study_tasks', 'study_quiz_results', 'exam_plans', 'exam_previews', 'exam_task_links']) {
      assert.equal(db.rows(`SELECT * FROM ${table} WHERE user_id=1`).length, 0, table);
      if (table !== 'study_flashcards') assert.equal(db.rows(`SELECT * FROM ${table} WHERE user_id=2`).length, 1, table + ' preserves other owner');
    }
    assert.equal(db.rows('SELECT * FROM schedule_tasks WHERE completed=1').length, 2);
    assert.equal(db.rows('SELECT SUM(earned) AS total FROM study_xp WHERE user_id=1')[0].total, 50);
    let limited = false;
    for (let i = 0; i < 60; i++) {
      if ((await request('missing/chat', { question: 'Synthetic' })).status === 429) { limited = true; break; }
    }
    assert.ok(limited, 'Owner-wide POST limit bounds requests across notebook IDs');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    global.fetch = originalFetch; Object.assign(db, originalDb); memory.close();
    for (const key of envKeys) if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});
