const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { WebSocket } = require('ws');
const { once } = require('node:events');

test('isolated API, account boundaries and browser call lifecycle', { timeout: 120000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-test-'));
  const port = 32179, base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['--require', './tests/fake-provider.cjs', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'isolated-test-secret', GEMINI_API_KEY: 'simulated-test-key', NVIDIA_API_KEY: '', CHAT_PROVIDER: 'gemini' }, stdio: 'pipe' });
  let browser;
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server did not start')), 15000); child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.on('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code)); }); });
    async function request(route, method = 'GET', body, token) {
      return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    }
    for (const file of ['/server.js', '/database.js', '/vibeai.db', '/.env', '/package.json', '/tests/fake-provider.cjs']) assert.equal((await request(file)).status, 404, file);
    assert.equal((await request('/api/companion')).status, 401);
    async function account(name) {
      assert.equal((await request('/api/register', 'POST', { username: name, email: name + '@example.com', password: 'test-password' })).status, 200);
      return (await (await request('/api/login', 'POST', { email: name + '@example.com', password: 'test-password' })).json()).token;
    }
    const a = await account('alice'), b = await account('bob');
    const future = new Date(Date.now() + 86400000).toISOString();
    let saved = await (await request('/api/companion/tasks', 'POST', { tasks: [{ title: 'Finish assignment', dueAt: future }], timezone: 'Asia/Kolkata' }, a)).json();
    const taskId = saved.tasks[0].id;
    assert.equal((await (await request('/api/companion/tasks', 'GET', undefined, b)).json()).tasks.length, 0);
    assert.equal((await request('/api/companion/tasks/' + taskId, 'PATCH', { completed: true }, b)).status, 400);
    assert.equal((await request('/api/companion/tasks', 'POST', { tasks: [{ title: 'No offset', dueAt: '2030-01-01T12:00' }] }, a)).status, 400);
    assert.equal((await request('/api/companion/tasks', 'POST', { tasks: [{ title: 'Valid', dueAt: future }, { title: '' }] }, a)).status, 400);
    assert.equal((await (await request('/api/companion/tasks', 'GET', undefined, a)).json()).tasks.length, 1);
    saved = await (await request('/api/companion/tasks/' + taskId, 'PATCH', { completed: true }, a)).json();
    const firstReward = saved.task.reward;
    assert.ok(firstReward.title);
    await request('/api/companion/tasks/' + taskId, 'PATCH', { completed: false }, a);
    assert.deepEqual((await (await request('/api/companion/tasks/' + taskId, 'PATCH', { completed: true }, a)).json()).task.reward, firstReward);
    await request('/api/companion/tasks/' + taskId, 'PATCH', { completed: false }, a);
    const exported = await (await request('/api/companion/calendar', 'GET', undefined, a)).text();
    assert.match(exported, /BEGIN:VALARM/); assert.match(exported, /SUMMARY:Finish assignment/);
    const taskReply = await (await request('/api/companion/chat', 'POST', { text: 'Add test study task to my planner', timezone: 'Asia/Kolkata' }, a)).json();
    assert.match(taskReply.text, /Saved to your planner/);
    assert.ok((await (await request('/api/companion/tasks', 'GET', undefined, a)).json()).tasks.some(t => t.title === 'Test study task'));
    assert.equal((await request('/api/register', 'POST', { username: {}, email: [], password: 4 })).status, 400);
    await request('/api/companion/profile', 'PUT', { notes: 'I like evening walks.' }, a);
    assert.equal((await (await request('/api/companion', 'GET', undefined, b)).json()).notes, '');
    assert.equal((await request('/api/companion/profile', 'PUT', { notes: 'x'.repeat(2001) }, a)).status, 400);
    const reply = await (await request('/api/companion/chat', 'POST', { text: 'Plan my day' }, a)).json();
    assert.match(reply.text, /small step/);
    assert.equal((await (await request('/api/companion', 'GET', undefined, b)).json()).messages.length, 0);
    const { ticket } = await (await request('/api/companion/call', 'POST', {}, a)).json();
    const ws = new WebSocket(`ws://localhost:${port}/api/companion/live?ticket=${ticket}`, { origin: base });
    const ready = new Promise(resolve => ws.on('message', data => { if (JSON.parse(data).type === 'ready') resolve(); }));
    await ready;
    assert.equal((await request('/api/companion/history', 'DELETE', undefined, a)).status, 409);
    assert.equal((await request('/api/companion/chat', 'POST', { text: 'overlap' }, a)).status, 409);
    const replay = new WebSocket(`ws://localhost:${port}/api/companion/live?ticket=${ticket}`, { origin: base });
    await new Promise(resolve => replay.on('error', resolve));
    ws.close(); await once(ws, 'close');
    browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(value => localStorage.setItem('vibe_token', value), a);
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/chat'); await page.waitForFunction(() => document.getElementById('provider-state').textContent === 'Ready when you are');
    assert.equal(await page.locator('.zuno-character').count(), 2);
    assert.equal(await page.locator('#orb-scene .character-eyes').isVisible(), true);
    assert.equal(await page.locator('.hero-visual img').count(), 0);
    assert.equal(await page.locator('#orb-scene').getAttribute('data-mascot-state'), 'idle');
    assert.equal(await page.locator('#orb-scene .character-eyes').evaluate(el => getComputedStyle(el).animationName), 'zuno-blink');
    await page.evaluate(() => { window.mascotStates = []; new MutationObserver(() => window.mascotStates.push(document.documentElement.dataset.mascotState)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-mascot-state'] }); });
    await page.locator('#planner-add').click();
    await page.locator('#task-title').fill('Browser task');
    await page.locator('#task-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('planner-tasks').textContent.includes('Browser task'));
    await page.getByRole('checkbox', { name: 'Complete Browser task', exact: true }).check();
    await page.waitForFunction(() => document.documentElement.dataset.mascotState === 'task-completed');
    await page.locator('#reward-reveal').click();
    assert.equal(await page.locator('#orb-scene').getAttribute('data-mascot-state'), 'excited');
    assert.ok(await page.locator('#reward-title').textContent());
    await page.locator('#reward-close').click();
    await page.locator('#planner-year-toggle').click();
    assert.equal(await page.locator('.planner-month').count(), 12);
    await page.locator('#planner-year-toggle').click();
    assert.equal(await page.locator('.pick-card').count(), 4);
    await page.locator('[data-mood="focus"]').click();
    assert.equal(await page.locator('[data-mood="focus"]').getAttribute('aria-pressed'), 'true');
    const firstPick = await page.locator('.pick-music h3').textContent();
    await page.locator('#shuffle-mix').click();
    assert.notEqual(await page.locator('.pick-music h3').textContent(), firstPick);
    await page.locator('#message').fill('I feel overwhelmed');
    await page.locator('#send').click();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    assert.equal(await page.locator('[data-mood="stressed"]').getAttribute('aria-pressed'), 'true');
    await page.locator('#personalize-mix').click();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    assert.match(await page.locator('#thread').textContent(), /I’m feeling stressed/);
    await page.screenshot({ path: path.join(dir, 'desktop.png'), fullPage: true });
    await page.locator('#message').fill('<img src=x onerror=alert(1)>'); await page.locator('#send').click();
    await page.waitForFunction(() => !document.getElementById('send').disabled);
    assert.equal(await page.locator('#thread img').count(), 0);
    await page.locator('#context-open').click(); assert.equal(await page.locator('#notes').inputValue(), 'I like evening walks.'); await page.locator('#context-close').click();
    await page.evaluate(() => { const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = async args => { window.testStream = await original(args); return window.testStream; }; });
    await page.locator('#call').click(); await page.waitForFunction(() => document.getElementById('call-status').textContent.startsWith('Connected'));
    await page.waitForFunction(() => document.getElementById('planner-tasks').textContent.includes('Voice test task'));
    await page.locator('#mute').click(); assert.equal(await page.locator('#mute').getAttribute('aria-pressed'), 'true');
    await page.locator('#hangup').click(); assert.equal(await page.evaluate(() => call === null), true);
    await page.waitForFunction(() => document.documentElement.dataset.mascotState === 'idle');
    const states = await page.evaluate(() => window.mascotStates);
    for (const state of ['thinking', 'listening', 'speaking', 'task-completed', 'excited']) assert.ok(states.includes(state), 'Missing real event state: ' + state);
    assert.equal(await page.evaluate(() => window.testStream.getTracks().every(track => track.readyState === 'ended')), true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#context-open').isVisible(), true);
    assert.equal(await page.locator('#logout').isVisible(), true);
    await page.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true });
    // Permission denial must return the controls to a retryable state.
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.locator('#call').click(); await page.waitForFunction(() => document.getElementById('call-status').textContent.includes('permission was denied'));
    assert.equal(await page.locator('#orb-scene').getAttribute('data-mascot-state'), 'error');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#orb-scene .character-eyes').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await page.locator('#call').isEnabled(), true);
    assert.deepEqual(errors, []);
    await request('/api/companion/history', 'DELETE', undefined, a);
    assert.equal((await (await request('/api/companion', 'GET', undefined, a)).json()).messages.length, 0);
    console.log('Screenshots: ' + dir);
  } finally { await browser?.close(); child.kill(); await once(child, 'exit').catch(() => {}); }
});

test('missing provider key gives actionable errors without starting a call', { timeout: 30000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-no-key-'));
  const port = 32180, base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'isolated-test-secret', GEMINI_API_KEY: '', NVIDIA_API_KEY: '', CHAT_PROVIDER: 'gemini' }, stdio: 'pipe' });
  try {
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 10000); child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.on('exit', () => { clearTimeout(timer); reject(new Error('Startup failed')); }); });
    const jwt = require('jsonwebtoken');
    const headers = { 'Content-Type': 'application/json' };
    await fetch(base + '/api/register', { method: 'POST', headers, body: JSON.stringify({ username: 'nokey', email: 'nokey@example.com', password: 'test-password' }) });
    headers.Authorization = 'Bearer ' + jwt.sign({ id: 1, username: 'nokey' }, 'isolated-test-secret');
    const state = await (await fetch(base + '/api/companion', { headers })).json(); assert.equal(state.configured, false);
    for (const route of ['/call', '/chat']) {
      const response = await fetch(base + '/api/companion' + route, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) });
      assert.equal(response.status, 503); assert.match((await response.json()).error, /GEMINI_API_KEY/);
    }
  } finally { child.kill(); await once(child, 'exit').catch(() => {}); }
});

test('NVIDIA adapter maps history and reports provider failures', async () => {
  const originalFetch = global.fetch;
  const oldProvider = process.env.CHAT_PROVIDER;
  const oldKey = process.env.NVIDIA_API_KEY;
  process.env.CHAT_PROVIDER = 'nvidia'; process.env.NVIDIA_API_KEY = 'test-only';
  try {
    const adapter = require('../chat-provider');
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://integrate.api.nvidia.com/v1/chat/completions');
      const payload = JSON.parse(options.body);
      assert.equal(payload.messages[1].role, 'assistant');
      assert.equal(payload.messages.at(-1).content, 'hello');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Hi there' } }] }) };
    };
    assert.equal(await adapter.reply('Be friendly', [{ role: 'model', text: 'Welcome' }], 'hello'), 'Hi there');
    global.fetch = async () => ({ ok: false, status: 429 });
    await assert.rejects(adapter.reply('', [], 'hello'), e => e.status === 429);
  } finally {
    global.fetch = originalFetch;
    if (oldProvider === undefined) delete process.env.CHAT_PROVIDER; else process.env.CHAT_PROVIDER = oldProvider;
    if (oldKey === undefined) delete process.env.NVIDIA_API_KEY; else process.env.NVIDIA_API_KEY = oldKey;
  }
});

test('scheduler timezone, reminders, idempotency and disk persistence', async () => {
  const { DateTime } = require('luxon');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-schedule-unit-'));
  process.env.DB_PATH = path.join(dir, 'tasks.db');
  const db = require('../database'), scheduler = require('../scheduler');
  await db.init();
  const morning = DateTime.fromISO('2030-04-05T09:00:00+05:30');
  const normal = scheduler.validate({ title: 'Read' }, 'Asia/Kolkata', morning);
  assert.equal(normal.due_at, '2030-04-05T15:30:00.000Z');
  const late = scheduler.validate({ title: 'Read' }, 'Asia/Kolkata', morning.set({ hour: 22 }));
  assert.equal(late.due_at, '2030-04-05T18:29:59.999Z');
  const summer = scheduler.validate({ title: 'Read' }, 'America/New_York', DateTime.fromISO('2030-07-05T12:00:00-04:00'));
  assert.equal(summer.due_at, '2030-07-06T01:00:00.000Z');
  const due = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
  const args = { tasks: [{ title: 'Tomorrow task', dueAt: due.toISO() }] };
  const result = scheduler.runTool(1, 'add_tasks', args, 'Asia/Kolkata', 'same-call');
  assert.equal(result.saved, true);
  assert.deepEqual(scheduler.runTool(1, 'add_tasks', args, 'Asia/Kolkata', 'same-call'), result);
  assert.equal(scheduler.list(1).length, 1);
  assert.equal(scheduler.list(2).length, 0);
  const evening = scheduler.reminders(1, 'Asia/Kolkata', due.set({ hour: 20 }));
  assert.equal(evening.length, 1); assert.match(evening[0].id, /^evening:/);
  db.write('INSERT INTO schedule_reminders VALUES (?,?)', [1, evening[0].id]);
  assert.equal(scheduler.reminders(1, 'Asia/Kolkata', due.set({ hour: 20 })).length, 0);
  assert.equal(scheduler.reminders(1, 'Asia/Kolkata', due.plus({ minutes: 1 })).length, 1);
  assert.equal(scheduler.runTool(2, 'complete_task', { id: result.tasks[0].id }, 'Asia/Kolkata', 'other').saved, false);
  await db.init(); assert.equal(scheduler.list(1).length, 1);
  scheduler.runTool(1, 'complete_task', { id: result.tasks[0].id }, 'Asia/Kolkata', 'complete');
  assert.equal(scheduler.reminders(1, 'Asia/Kolkata', due.plus({ minutes: 1 })).length, 0);
  assert.ok(scheduler.list(1)[0].reward.title);
});
