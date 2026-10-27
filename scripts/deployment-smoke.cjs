'use strict';
// Opt-in deployment verification. Uses only newly created synthetic records.
require('dotenv').config();
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
let server;
async function main() {
  const db = require('../database');
  assert.ok(db.isPostgres, 'Deployment check requires configured PostgreSQL');
  let base = process.argv[2];
  if (!base) {
    process.env.VERCEL = '1';
    const application = require('../server');
    await application.ensureInit();
    server = application.server;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + server.address().port;
  }
  const username = 'deploy_' + randomUUID().replace(/-/g, '').slice(0, 16);
  const email = username + '@example.test';
  const password = randomBytes(24).toString('hex');
  let token;
  async function request(route, method = 'GET', body) {
    const r = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    console.log(method, route, r.status);
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: r.status, data };
  }
  try {
    assert.equal((await request('/api/health')).status, 200); console.log('PASS API health');
    assert.equal((await request('/api/companion')).status, 401);
    assert.equal((await request('/api/register', 'POST', { username, email, password })).status, 200);
    const login = await request('/api/login', 'POST', { email, password }); assert.equal(login.status, 200); token = login.data.token; assert.ok(token);
    assert.equal((await request('/api/me')).status, 200); console.log('PASS registration/login/authentication');
    assert.equal((await request('/api/companion/profile', 'PUT', { notes: 'Synthetic deployment check' })).status, 200);
    const companion = await request('/api/companion'); assert.equal(companion.status, 200); assert.equal(companion.data.notes, 'Synthetic deployment check');
    let saved = await request('/api/companion/tasks', 'POST', { tasks: [{ title: 'Synthetic deployment mission', dueAt: new Date(Date.now() + 86400000).toISOString() }], timezone: 'Asia/Kolkata' });
    assert.equal(saved.status, 201); const id = saved.data.tasks[0].id;
    saved = await request('/api/companion/tasks/' + id, 'PATCH', { completed: true }); assert.equal(saved.status, 200); assert.ok(saved.data.task.reward);
    const tasks = await request('/api/companion/tasks'); assert.equal(tasks.status, 200); assert.equal(tasks.data.tasks.find(t => t.id === id).completed, true);
    assert.equal((await request('/api/companion/reminders')).status, 200); assert.equal((await request('/api/companion/calendar')).status, 200);
    console.log('PASS PostgreSQL profile/mission persistence and completion reward');
    assert.equal((await request('/api/companion/radio/playlists')).status, 200);
    const radio = await request('/api/companion/radio/playlists', 'POST', { url: 'https://www.youtube.com/playlist?list=PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs', label: 'Synthetic deployment check', tags: ['focus'] });
    assert.equal(radio.status, 201); assert.ok(radio.data.playlist.id);
    assert.equal((await request('/api/companion/radio/playlists/' + radio.data.playlist.id, 'PATCH', { label: 'Updated test label' })).status, 200);
    console.log('PASS Radio playlist read/write');
    assert.equal((await request('/api/companion/study/status')).data.available, false);
    const callRes = await request('/api/companion/call', 'POST', { timezone: 'Asia/Kolkata', voice: 'Aoede' });
    assert.equal(callRes.status, 200);
    assert.ok(callRes.data.ticket);
    console.log('PASS Live voice ticket endpoint');
    const chat = await request('/api/companion/chat', 'POST', { text: 'Reply with one short friendly sentence. Do not create tasks.', timezone: 'Asia/Kolkata' });
    assert.equal(chat.status, 200, 'Real AI chat HTTP status'); assert.ok(typeof chat.data.text === 'string' && chat.data.text.length > 0);
    console.log('PASS real AI text response');
    assert.equal((await request('/api/companion', 'GET')).data.messages.length, 2);
    console.log('PASS conversation persisted');
  } finally {
    // Only this randomly named synthetic account is deleted; existing accounts untouched.
    await db.getPool().query('DELETE FROM users WHERE username=$1 AND email=$2', [username, email]);
    if (server) await new Promise(resolve => server.close(resolve));
    await db.getPool().end();
  }
}
main().catch(error => { console.error('FAIL deployment smoke:', error.code || error.name, typeof error.actual === 'number' ? `actual=${error.actual} expected=${error.expected}` : ''); process.exitCode = 1; });
