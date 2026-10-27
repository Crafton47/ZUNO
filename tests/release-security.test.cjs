const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const jwt = require('jsonwebtoken');
const { signingSecret, rateLimit } = require('../security');
const root = path.resolve(__dirname, '..');
const secret = 'synthetic-release-test-secret-01234567890123456789';

test('signing configuration fails closed and rate limits expire without trusting spoofed headers', () => {
  for (const value of ['', 'short', 'replace-with-a-long-random-secret']) assert.throws(() => signingSecret({ JWT_SECRET: value }));
  assert.equal(signingSecret({ JWT_SECRET: secret }), secret);
  let time = 0, passed = 0, status;
  const middleware = rateLimit({ limit: 2, windowMs: 1000, maxKeys: 1, now: () => time });
  const res = { set() {}, status(v) { status = v; return this; }, json() {} };
  const next = () => passed++;
  middleware({ ip: 'a' }, res, next); middleware({ ip: 'a' }, res, next);
  middleware({ ip: 'a', headers: { 'x-forwarded-for': 'b' } }, res, next);
  assert.equal(status, 429); assert.equal(passed, 2);
  middleware({ ip: 'b' }, res, next); assert.equal(passed, 2);
  time = 1000; middleware({ ip: 'b' }, res, next); assert.equal(passed, 3);
});

test('missing signing secret prevents startup before creating a database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-no-secret-'));
  const dbPath = path.join(dir, 'disposable.db');
  const result = spawnSync(process.execPath, [path.join(root, 'server.js')], { cwd: dir, env: { ...process.env, JWT_SECRET: '', DB_PATH: dbPath }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Set JWT_SECRET/); assert.equal(fs.existsSync(dbPath), false);
});

test('real auth routes enforce password bounds, generic failures, token integrity, headers and throttling', { timeout: 45000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-auth-release-'));
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: dir, env: { ...process.env, PORT: '32291', DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: secret, STUDY_ENABLED: 'false', GEMINI_API_KEY: '', NVIDIA_API_KEY: '', YOUTUBE_API_KEY: '' }, stdio: 'pipe' });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timed out')), 15000);
      child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code)); });
    });
    async function request(route, body, token) {
      return fetch('http://localhost:32291' + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    }
    const user = { username: 'release_user', email: 'release@example.test', password: 'safe-test-password' };
    for (const password of ['short', 'é'.repeat(37)]) assert.equal((await request('/api/register', { ...user, password })).status, 400);
    assert.equal((await request('/api/register', user)).status, 200);
    const wrong = await request('/api/login', { email: user.email, password: 'incorrect' });
    const absent = await request('/api/login', { email: 'missing@example.test', password: 'incorrect' });
    assert.equal(wrong.status, 401); assert.equal(absent.status, 401); assert.deepEqual(await wrong.json(), await absent.json());
    const login = await request('/api/login', user); const { token } = await login.json(); assert.ok(token);
    assert.equal(login.headers.get('cache-control'), 'no-store'); assert.equal(login.headers.get('x-powered-by'), null);
    assert.equal(login.headers.get('x-content-type-options'), 'nosniff'); assert.match(login.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await request('/api/me', undefined, 'Bearer ' + token)).status, 200);
    assert.equal((await request('/api/me', undefined, 'Basic ' + token)).status, 401);
    for (const invalid of [jwt.sign({ id: 1 }, 'wrong-key'), jwt.sign({ id: 1 }, secret, { algorithm: 'HS384' }), jwt.sign({ id: 1 }, secret, { expiresIn: -1 })]) {
      assert.equal((await request('/api/me', undefined, 'Bearer ' + invalid)).status, 403);
    }
    assert.equal((await request('/api/me', undefined, 'Bearer ' + jwt.sign({ id: 9999 }, secret))).status, 401);
    for (let i = 0; i < 16; i++) {
      const response = await request('/api/login', { email: 'throttle@example.test', password: '' });
      assert.equal(response.status, i < 15 ? 400 : 429);
      if (i === 15) assert.ok(Number(response.headers.get('retry-after')) > 0);
    }
    const oversized = await request('/api/login', { email: 'x'.repeat(110000) }); assert.equal(oversized.status, 413);
    assert.doesNotMatch(JSON.stringify(await oversized.json()), /stack|node_modules/);
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  }
});

test('disk failure rejects writes and restores the last durable snapshot including transactions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-disk-release-'));
  process.env.DB_PATH = path.join(dir, 'test.db');
  const db = require('../database'); await db.init();
  db.saveProfile(1, 'durable');
  const before = fs.readFileSync(process.env.DB_PATH);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => { if (to === process.env.DB_PATH) throw Object.assign(new Error('simulated disk failure'), { code: 'EACCES' }); return rename(from, to); };
  try {
    assert.throws(() => db.saveProfile(1, 'lost'), /persist changes/);
    assert.equal(db.profile(1), 'durable'); assert.deepEqual(fs.readFileSync(process.env.DB_PATH), before);
    assert.throws(() => db.transaction(() => db.execute("UPDATE companion_profiles SET notes='lost again' WHERE user_id=1")), /persist changes/);
    assert.equal(db.profile(1), 'durable');
  } finally { fs.renameSync = rename; }
  db.saveProfile(2, 'later'); await db.init();
  assert.equal(db.profile(1), 'durable'); assert.equal(db.profile(2), 'later');
});
