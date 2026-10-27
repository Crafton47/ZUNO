// Opt-in real-network verification for ZUNO Radio.
//
// Unlike tests/radio.test.cjs, this test uses the real YouTube Data API key from
// .env and the real YouTube IFrame player. It deliberately writes only to a
// temporary database and never prints credentials.
//
// Run with: npm run test:radio:live
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
require('dotenv').config();

const playlist = process.env.RADIO_LIVE_PLAYLIST || 'PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs';
const url = 'https://www.youtube.com/playlist?list=' + playlist;

test('real YouTube data and playback controls', { timeout: 300000 }, async t => {
  if (!process.env.YOUTUBE_API_KEY) {
    t.skip('YOUTUBE_API_KEY is not configured; live Radio smoke test skipped.');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-radio-live-'));
  const base = 'http://localhost:32187';
  let child, browser;
  async function start() {
    const env = { ...process.env, PORT: '32187', DB_PATH: path.join(dir, 'live.db'), JWT_SECRET: 'radio-live-smoke-secret-test-test-test-t', STUDY_ENABLED: 'false', GEMINI_API_KEY: 'simulated', NVIDIA_API_KEY: '', CHAT_PROVIDER: 'gemini' };
    delete env.RADIO_METADATA_FIXTURE;
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Startup timeout\n' + stderr)), 20000);
      child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited (' + code + ')\n' + stderr)); });
    });
  }
  async function request(route, method = 'GET', body, token) {
    return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  const waitStatus = (page, value, timeout = 45000) => page.waitForFunction(expected => document.querySelector('#radio-dock')?.dataset.playing === expected, value, { timeout });
  const trackTitle = page => page.locator('#radio-track').textContent();
  const seconds = text => String(text).split(':').reduce((total, part) => total * 60 + Number(part), 0);

  try {
    await start();
    const username = 'radiolive' + Date.now().toString(36);
    await request('/api/register', 'POST', { username, email: username + '@example.test', password: 'test-password' });
    const token = (await (await request('/api/login', 'POST', { email: username + '@example.test', password: 'test-password' })).json()).token;
    const created = await request('/api/companion/radio/playlists', 'POST', { url, label: 'Live smoke playlist' }, token);
    assert.equal(created.status, 201);
    const item = (await created.json()).playlist;
    const details = await (await request('/api/companion/radio/playlists/' + item.id + '/tracks', 'GET', undefined, token)).json();
    assert.equal(details.status, 'available', 'real YouTube Data API track list is available');
    assert.ok(details.tracks.length > 1, 'real playlist has multiple tracks');
    const playable = details.tracks.filter(track => !track.unavailable && !track.restricted && track.videoId);
    assert.ok(playable.length > 1, 'real playlist has multiple playable tracks');

    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(auth => {
      localStorage.setItem('vibe_token', auth.token);
      localStorage.setItem('vibe_user', JSON.stringify({ id: 1, username: auth.username }));
    }, { token, username });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/chat');
    await page.waitForFunction(() => document.querySelector('#radio-library h4')?.textContent === 'Live smoke playlist');
    assert.match(await page.locator('.radio-playlist').textContent(), /videos/);
    assert.match(await page.locator('.radio-playlist').textContent(), /YouTube/);

    await page.locator('.radio-playlist .radio-primary').click();
    await page.waitForFunction(() => !document.querySelector('#radio-toggle').disabled);
    try {
      await waitStatus(page, 'true', 45000);
    } catch {
      // Headless browsers can require a second gesture even after the playlist click.
      if (await page.locator('#radio-toggle').isEnabled()) await page.locator('#radio-toggle').click();
      await waitStatus(page, 'true', 45000);
    }
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    const floatFrame = await page.locator('#radio-video iframe').boundingBox();
    assert.ok(floatFrame.width >= 200 && floatFrame.height >= 200, 'floating real YouTube viewport is at least 200 × 200');
    await page.locator('#radio-float-expand').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'expanded');
    await page.waitForFunction(track => document.querySelector('#radio-track')?.textContent === track, playable[0].title, { timeout: 45000 });
    assert.match(await page.locator('#radio-status').textContent(), /Playing|Buffering/);
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), details.tracks.length);
    console.log('LIVE TRACK:', await trackTitle(page), '| playlist:', await page.locator('#radio-playlist-title').textContent());

    // Pause and resume.
    await page.locator('#radio-toggle').click();
    await page.waitForFunction(() => document.querySelector('#radio-status')?.textContent === 'Paused', null, { timeout: 20000 });
    await waitStatus(page, 'false', 5000);
    await page.locator('#radio-toggle').click();
    await waitStatus(page, 'true', 45000);

    // Direct selection of a different real video.
    const target = playable[1];
    await page.locator('#radio-tracks .radio-track-play[data-index="' + target.index + '"]').click();
    await page.waitForFunction(track => document.querySelector('#radio-track')?.textContent === track, target.title, { timeout: 45000 });
    await waitStatus(page, 'true', 45000);
    assert.equal(await page.locator('#radio-tracks .radio-track.is-active').getAttribute('data-index'), String(target.index));
    console.log('LIVE DIRECT SELECT:', target.title);

    // Next and previous follow the real playlist order (skipping unavailable entries).
    const position = playable.findIndex(track => track.index === target.index);
    const expectedNext = playable[(position + 1) % playable.length];
    await page.locator('#radio-next').click();
    await page.waitForFunction(track => document.querySelector('#radio-track')?.textContent === track, expectedNext.title, { timeout: 45000 });
    await waitStatus(page, 'true', 45000);
    await page.locator('#radio-prev').click();
    await page.waitForFunction(track => document.querySelector('#radio-track')?.textContent === track, target.title, { timeout: 45000 });
    await waitStatus(page, 'true', 45000);
    console.log('LIVE PREV/NEXT: verified');

    // Seek and volume controls are applied by the real player/UI.
    await page.waitForFunction(() => !document.querySelector('#radio-seek').disabled, null, { timeout: 30000 });
    const seekTo = Math.min(30, Math.max(5, Number(await page.locator('#radio-seek').getAttribute('max')) - 10));
    await page.locator('#radio-seek').evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('change', { bubbles: true })); }, seekTo);
    await page.waitForFunction(value => {
      const elapsed = document.querySelector('#radio-elapsed')?.textContent || '0:00';
      return elapsed.split(':').reduce((total, part) => total * 60 + Number(part), 0) >= value - 2;
    }, seekTo, { timeout: 30000 });
    await page.locator('#radio-volume').evaluate(element => { element.value = '35'; element.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.locator('#radio-volume').inputValue(), '35');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('zuno-radio-state:1') || '{}').volume), 35);
    console.log('LIVE SEEK/VOLUME: verified at', seekTo + 's, volume 35');

    // Real background tab playback: no app-level visibility pause.
    const background = await context.newPage();
    await background.goto('about:blank');
    await background.bringToFront();
    await page.waitForTimeout(6000);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true', 'audio continues while another tab is active');
    await background.close();
    await page.bringToFront();
    await page.waitForTimeout(2000);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    console.log('LIVE BACKGROUND: verified');

    // Collapse while playing: the real YouTube audio continues in the floating player.
    const liveTitle = await trackTitle(page);
    await page.locator('#radio-expand').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await waitStatus(page, 'true', 15000);
    const floatBox = await page.locator('#radio-dock').boundingBox();
    assert.ok(floatBox.width >= 200 && floatBox.width <= 206, 'floating card width');
    assert.ok(floatBox.height >= 268 && floatBox.height <= 280, 'floating card height');
    assert.equal(await page.locator('#radio-dock .radio-visual').isVisible(), true);
    assert.equal(await page.locator('#radio-dock .radio-mini-actions').isVisible(), false);

    // Dragging the real playing embed must not pause or restart it.
    const grip = await page.locator('#radio-grip').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 - 140, grip.y + grip.height / 2 - 100, { steps: 10 });
    await page.mouse.up();
    const draggedBox = await page.locator('#radio-dock').boundingBox();
    assert.ok(Math.abs(draggedBox.x - (floatBox.x - 140)) <= 3, 'real player drags horizontally');
    assert.ok(Math.abs(draggedBox.y - (floatBox.y - 100)) <= 3, 'real player drags vertically');
    await page.waitForTimeout(3000);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true', 'audio keeps playing after a drag');
    assert.equal(await trackTitle(page), liveTitle, 'the same real track keeps playing after a drag');
    console.log('LIVE DRAG: verified while playing');

    // Explicit "Mini (paused)" pauses the real player before hiding the embed.
    await page.locator('#radio-float-mini').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'mini');
    await waitStatus(page, 'false');
    const mini = await page.locator('#radio-dock').boundingBox();
    assert.ok(mini.width >= 300 && mini.width <= 340, 'compact mini width');
    assert.ok(mini.height >= 60 && mini.height <= 72, 'compact mini height');
    assert.equal(await page.locator('#radio-dock .radio-visual').isVisible(), false);
    await page.locator('#radio-mini-open').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'expanded');
    await waitStatus(page, 'false');
    await page.locator('#radio-toggle').click();
    await waitStatus(page, 'true', 20000);

    await page.screenshot({ path: path.join(dir, 'radio-live.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('LIVE ARTIFACTS:', dir);
  } finally { await browser?.close(); if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
});
