const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, firefox, webkit } = require('@playwright/test');

// Layout tests use real local pages and companion APIs, with synthetic Study
// responses. They do not establish real-provider or physical-device support.
for (const [engineName, engine] of Object.entries({ chromium, firefox, webkit })) {
  test(`${engineName}: release viewport, navigation and dialog smoke`, {
    timeout: 180000, skip: !fs.existsSync(engine.executablePath()) && `${engineName} is not installed`,
  }, async t => {
    const root = path.join(__dirname, '..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-mobile-'));
    const preload = path.join(dir, 'preload.cjs');
    fs.writeFileSync(preload, `require(${JSON.stringify(require.resolve('dotenv'))}).config = () => ({});\nrequire(${JSON.stringify(path.join(__dirname, 'fake-provider.cjs'))});\n`);
    const port = 32489, base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, ['--require', preload, 'server.js'], {
      cwd: root, env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        TEMP: dir, TMP: dir, PORT: String(port), DB_PATH: path.join(dir, 'test.db'),
        JWT_SECRET: 'isolated-mobile-test-signing-secret-32-characters',
        GEMINI_API_KEY: 'simulated-test-key', CHAT_PROVIDER: 'gemini',
        STUDY_OWNER_ID: '1', OPEN_NOTEBOOK_URL: 'http://127.0.0.1:1',
      }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let browser;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Mobile test server startup timed out')), 15000);
        child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } });
        child.on('exit', code => { clearTimeout(timer); reject(new Error(`Mobile test server exited ${code}`)); });
      });
      const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post('/api/register', { username: 'mobile_sample', email: 'mobile@example.com', password: 'sample-password-2026' })).status, 200);
      const { token } = await (await post('/api/login', { email: 'mobile@example.com', password: 'sample-password-2026' })).json();
      browser = await engine.launch({ headless: true });
      const context = await browser.newContext({ reducedMotion: 'reduce', hasTouch: true });
      // No external network, fonts, YouTube requests, or personal services.
      await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
      await context.addInitScript(value => {
        if (location.pathname === '/login.html' || location.pathname === '/register.html') localStorage.removeItem('vibe_token');
        else localStorage.setItem('vibe_token', value);
      }, token);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const notebook = { id: 'sample', name: 'Synthetic revision notes', opened_at: '2026-10-27T09:00:00Z', documentCount: 1 };
      await page.route('**/api/companion/study/**', route => {
        const suffix = new URL(route.request().url()).pathname.split('/study')[1];
        const payload = suffix === '/status' ? { available: true, message: 'Synthetic Study service' }
          : suffix === '/notebooks' ? { notebooks: [notebook] }
          : suffix === '/xp' ? { total: 0, level: 1, nextLevel: 100 }
          : suffix.endsWith('/rescue') || suffix === '/rescue/plans' ? { plans: [], commitments: [], quiz: [] }
          : suffix.endsWith('/flashcards') ? { flashcards: [] }
          : { notebook, items: [], messages: [], tasks: [] };
        return route.fulfill({ json: payload });
      });
      async function contained(label) {
        const metrics = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
        assert.ok(metrics.scroll <= metrics.width + 1, `${label}: horizontal overflow ${JSON.stringify(metrics)}`);
      }
      async function navigate(url) {
        // Let mocked fetches settle before destroying their document. WebKit
        // reports late fulfilled interceptions as access-control page errors.
        await page.waitForLoadState('networkidle');
        await page.goto(url, { waitUntil: 'networkidle' });
      }
      for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const route of ['/login.html', '/register.html', '/chat']) {
          await navigate(base + route);
          if (route === '/chat') await page.waitForFunction(() => document.getElementById('provider-state').textContent === 'Ready when you are');
          await contained(`${route} at ${width}`);
        }
        await page.locator('#context-open').tap();
        const dialog = page.locator('dialog[open]');
        const bounds = await dialog.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `Context dialog fits ${width}`);
        await page.keyboard.press('Escape');
        for (const section of ['notebooks', 'ask', 'practice', 'rescue']) {
          await navigate(base + '/study?section=' + section);
          await page.waitForFunction(expected => document.body.dataset.studySection === expected, section);
          const target = section === 'notebooks' ? '#home' : section === 'rescue' ? '#rescue-start' : '#study-picker';
          await page.locator(target).waitFor({ state: 'visible' });
          await contained(`Study ${section} at ${width}`);
        }
        await page.locator('#rescue-start').click();
        await page.locator('#rescue-name').fill('Synthetic exam');
        await contained(`Exam setup at ${width}`);
        await page.locator('#rescue-next').click();
        await page.locator('#rescue-upload-host #upload-form').waitFor({ state: 'visible' });
        if (await page.locator('form form').count()) errors.push(`Nested upload form in Exam material at ${width}`);
        assert.equal(await page.locator('#document').evaluate(input => input.form.id), 'upload-form');
        await contained(`Exam material at ${width}`);
        await page.locator('#rescue-library .notebook-choice').first().tap();
        await page.locator('[data-wizard-step="3"]').tap();
        assert.equal(await page.locator('#rescue-upload-host #upload-form').count(), 0);
        assert.equal(await page.locator('#rescue-generate').evaluate(button => button.form.id), 'rescue-form');
        await contained(`Exam time setup at ${width}`);
        await navigate(base + '/study?notebook=sample&section=ask');
        await page.locator('#workspace').waitFor({ state: 'visible' });
        await contained(`Study notebook at ${width}`);
        await page.reload({ waitUntil: 'networkidle' });
        await page.locator('#workspace').waitFor({ state: 'visible' });
        assert.equal(new URL(page.url()).searchParams.get('notebook'), 'sample');
        t.diagnostic(`PASS ${engineName} width=${width}: auth, dashboard, dialogs, four Study sections, Exam setup and notebook refresh`);
      }
      await page.setViewportSize({ width: 844, height: 390 });
      await navigate(base + '/chat');
      await page.waitForFunction(() => document.getElementById('provider-state').textContent === 'Ready when you are');
      await contained('Landscape dashboard');
      const voiceSupported = await page.evaluate(() => !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode));
      if (voiceSupported) {
        await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
        await page.locator('#call').tap();
        await page.waitForFunction(() => document.getElementById('call-status').textContent.includes('permission was denied'));
      } else {
        await page.locator('#call').tap();
        assert.match(await page.locator('#notice').textContent(), /microphone support/);
        t.diagnostic(`${engineName}: microphone API unavailable; verified unsupported-browser message only`);
      }
      assert.equal(await page.locator('#call').isEnabled(), true);
      await page.locator('#context-open').focus();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
