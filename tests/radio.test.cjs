const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const { playlistId } = require('../radio');
const { playerFixture, videoId } = require('./radio-fixtures.cjs');
const id = 'PL590L5WQmH8fJ54F369BLDSqIwcs-TCfs';
const url = 'https://www.youtube.com/playlist?list=' + id;
const secondId = id + 'x';

const tracksA = [
  { videoId: videoId(0), title: 'Neon Skyline', channelTitle: 'Night Artist', duration: 'PT3M05S' },
  { videoId: videoId(1), title: 'Midnight Drive', channelTitle: 'Night Artist', duration: 'PT4M12S' },
  { videoId: videoId(2), title: 'Afterglow', channelTitle: 'Guest Artist', duration: 'PT2M45S' },
  { videoId: videoId(3), title: 'Private Video', channelTitle: 'Hidden Artist', privacyStatus: 'private' },
  { videoId: videoId(4), title: 'Embed Blocked', channelTitle: 'Strict Artist', embeddable: false },
  { videoId: videoId(5), title: 'Deleted Video', channelTitle: 'Gone Artist', deleted: true }
];
const tracksB = [
  { videoId: videoId(10), title: 'Second Wind', channelTitle: 'Second Artist', duration: 'PT2M30S' },
  { videoId: videoId(11), title: 'Second Sun', channelTitle: 'Second Artist', duration: 'PT3M10S' },
  { videoId: videoId(12), title: 'Second Rain', channelTitle: 'Second Artist', duration: 'PT1M55S' }
];

test('playlist URL validation rejects hostile hosts, credentials, invalid IDs and temporary mixes', () => {
  assert.equal(playlistId(url), id);
  assert.equal(playlistId('https://music.youtube.com/watch?v=abc&list=' + id), id);
  for (const bad of [null, {}, 'hello', 'http://youtube.com/playlist?list=' + id, 'https://youtube.com.evil.com/?list=' + id, 'https://youtube.com@evil.com/?list=' + id, 'https://a:password@youtube.com/?list=' + id, 'https://youtube.com:444/?list=' + id, 'https://youtu.be/video', 'https://youtube.com/?list=RDabcdef', 'https://youtube.com/?list=PL<script>']) assert.throws(() => playlistId(bad));
});

test('radio persistence, ownership, track browser, floating drag, player contract and background behavior', { timeout: 300000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-radio-test-'));
  const fixture = path.join(dir, 'youtube.json');
  fs.writeFileSync(fixture, JSON.stringify({ title: 'Fixture playlist', tracks: { [id]: tracksA, [secondId]: tracksB } }));
  const base = 'http://localhost:32183'; let child, browser;
  async function start() {
    child = spawn(process.execPath, ['--require', './tests/fake-provider.cjs', '--require', './tests/fake-youtube-metadata.cjs', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '32183', DB_PATH: path.join(dir, 'test.db'), JWT_SECRET: 'radio-test-secret-test-test-test-test-te', STUDY_ENABLED: 'false', GEMINI_API_KEY: 'simulated', NVIDIA_API_KEY: '', YOUTUBE_API_KEY: 'test-only-youtube-key', RADIO_METADATA_FIXTURE: fixture, CHAT_PROVIDER: 'gemini' }, stdio: 'pipe' });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000); child.stdout.on('data', data => { if (String(data).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error('Server exited')); }); });
  }
  async function request(route, method = 'GET', body, token) { return fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  const endpoint = '/api/companion/radio/playlists';
  const dockBox = page => page.locator('#radio-dock').boundingBox();
  const expectInViewport = async (page, label) => {
    const box = await dockBox(page);
    const viewport = page.viewportSize();
    assert.ok(box.x >= -1 && box.y >= -1, label + ': dock starts inside the viewport');
    assert.ok(box.x + box.width <= viewport.width + 1, label + ': dock stays within the right edge');
    assert.ok(box.y + box.height <= viewport.height + 1, label + ': dock stays within the bottom edge');
  };
  const dragDock = async (page, dx, dy) => {
    const grip = await page.locator('#radio-grip').boundingBox();
    const before = await dockBox(page);
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + dx, grip.y + grip.height / 2 + dy, { steps: 8 });
    await page.mouse.up();
    return { before, after: await dockBox(page) };
  };
  try {
    await start();
    async function account(name) { await request('/api/register', 'POST', { username: name, email: name + '@example.test', password: 'test-password' }); return (await (await request('/api/login', 'POST', { email: name + '@example.test', password: 'test-password' })).json()).token; }
    const a = await account('radioalice'), b = await account('radiobob');
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) assert.equal((await request(endpoint + (['PATCH', 'DELETE'].includes(method) ? '/unknown' : ''), method, method === 'POST' ? { url } : undefined)).status, 401);
    assert.equal((await request(endpoint, 'POST', { url: 'https://evil.test/?list=' + id }, a)).status, 400);
    assert.equal((await request(endpoint, 'POST', { url, tags: ['invented'] }, a)).status, 400);
    const created = await request(endpoint, 'POST', { url, label: 'Night drive', tags: ['chill'] }, a); assert.equal(created.status, 201);
    const item = (await created.json()).playlist;
    assert.equal((await request(endpoint, 'POST', { url: 'https://music.youtube.com/playlist?list=' + id }, a)).status, 409);
    assert.equal((await (await request(endpoint, 'GET', undefined, b)).json()).playlists.length, 0);
    for (const method of ['PATCH', 'DELETE']) assert.equal((await request(endpoint + '/' + item.id, method, method === 'PATCH' ? { label: 'Stolen' } : undefined, b)).status, 404);
    assert.equal((await request(endpoint + '/' + item.id, 'PATCH', { label: 'x'.repeat(101), tags: [] }, a)).status, 400);
    assert.equal((await request(endpoint + '/' + item.id, 'PATCH', { label: 'Quiet hours', tags: ['chill', 'focus'] }, a)).status, 200);
    child.kill(); await once(child, 'exit'); await start();
    assert.equal((await (await request(endpoint, 'GET', undefined, a)).json()).playlists[0].label, 'Quiet hours');
    browser = await chromium.launch({ headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['microphone'] });
    await context.addInitScript(token => { localStorage.setItem('vibe_token', token); localStorage.setItem('vibe_user', JSON.stringify({ id: 1, username: 'radioalice' })); }, a);
    await context.route('https://www.youtube.com/iframe_api', route => route.fulfill({ contentType: 'application/javascript', body: playerFixture }));
    await context.route('https://i.ytimg.com/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#241b45"/></svg>' }));
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/chat');
    await page.waitForFunction(() => document.querySelector('#radio-library h4')?.textContent === 'Quiet hours');
    assert.equal(await page.locator('[data-mood]').count(), 6);
    await page.locator('[data-mood="bored"]').click(); assert.match(await page.locator('#mood-music').textContent(), /No playlist tagged Bored/);
    await page.locator('[data-mood="focus"]').click(); assert.match(await page.locator('#mood-music').textContent(), /Quiet hours/);

    // Playing from the mood studio starts the floating player, not the full studio.
    await page.locator('#mood-music button').click();
    await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'true');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    const floatPanel = await dockBox(page);
    assert.ok(floatPanel.width >= 200 && floatPanel.width <= 206, 'floating card keeps the 200 px player width');
    assert.ok(floatPanel.height >= 268 && floatPanel.height <= 280, 'floating card stays compact: ' + JSON.stringify(floatPanel));
    const floatVideo = await page.locator('#radio-video iframe').boundingBox();
    assert.ok(floatVideo.width >= 200 && floatVideo.height >= 200, 'YouTube visible viewport is at least 200 × 200');
    assert.equal(await page.locator('#radio-dock .radio-mini-actions').isVisible(), false, 'only the floating header and controls are shown');
    await page.waitForFunction(() => document.getElementById('radio-float-title').textContent === 'Neon Skyline');
    assert.equal(await page.locator('#radio-float-artist').textContent(), 'Night Artist');
    await expectInViewport(page, 'initial float');

    // Clicking the song title opens the full player on demand.
    await page.locator('#radio-float-open').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'expanded');
    await page.waitForFunction(() => document.querySelectorAll('#radio-tracks .radio-track').length === 6);
    assert.equal(await page.locator('#radio-browser-heading').textContent(), 'Quiet hours');
    assert.match(await page.locator('#radio-playlist-meta').textContent(), /Fixture creator/);
    assert.match(await page.locator('#radio-playlist-meta').textContent(), /6 videos/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Neon Skyline/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Night Artist · 3:05/);
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), 6);
    assert.equal(await page.locator('#radio-tracks .radio-track').first().getAttribute('data-index'), '0');
    assert.ok((await page.locator('#radio-tracks .radio-track.is-active').getAttribute('data-index')) === '0');
    assert.equal(await page.locator('#radio-track').textContent(), 'Neon Skyline');
    assert.equal(await page.locator('#radio-artist').textContent(), 'Night Artist');
    const expandedVideo = await page.locator('#radio-video iframe').boundingBox();
    assert.ok(expandedVideo.width >= 200 && expandedVideo.height >= 200);

    // Unavailable entries are shown, never silently substituted.
    await page.locator('#radio-track-search').fill('embed');
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), 1);
    await page.locator('#radio-tracks .radio-track-play').click();
    assert.match(await page.locator('#radio-status').textContent(), /does not allow this video to be embedded/);
    assert.equal(await page.evaluate(() => window.testPlayer.index), 0);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    await page.locator('#radio-track-search').fill('');
    assert.equal(await page.locator('#radio-tracks .radio-track').count(), 6);
    assert.match(await page.locator('#radio-tracks').textContent(), /Embed blocked/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Private/);
    assert.match(await page.locator('#radio-tracks').textContent(), /Unavailable/);

    // Direct track selection uses the real playlist position.
    await page.locator('#radio-tracks .radio-track-play[data-index="2"]').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Afterglow');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 2);
    assert.equal(await page.locator('#radio-tracks .radio-track.is-active').getAttribute('data-index'), '2');
    await page.locator('#radio-tracks .radio-track-play[data-index="1"]').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Midnight Drive');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 1);

    // The IFrame playlist can exclude entries; map by video ID, not by list index.
    await page.evaluate(ids => { window.__radioFixtureIds = ids; }, [videoId(1), videoId(2)]);
    await page.locator('#radio-tracks .radio-track-play[data-index="2"]').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Afterglow');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 1, 'uses the actual playlist position');
    await page.evaluate(() => { window.__radioFixtureIds = null; });

    // Previous and next skip unavailable entries and preserve order.
    await page.locator('#radio-next').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Neon Skyline');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 0, 'wraps past private and blocked entries');
    await page.locator('#radio-prev').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Afterglow');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 2);

    // Seek, volume and mute use the player API.
    assert.equal(await page.locator('#radio-seek').isDisabled(), false);
    await page.locator('#radio-seek').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    assert.equal(await page.evaluate(() => window.testPlayer.time), 50);
    await page.locator('#radio-volume').evaluate(el => { el.value = '35'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => window.testPlayer.volume), 35);
    await page.locator('#radio-mute').click();
    assert.equal(await page.evaluate(() => window.testPlayer.muted), true);
    assert.equal(await page.locator('#radio-mute').getAttribute('aria-pressed'), 'true');
    await page.locator('#radio-mute').click();
    assert.equal(await page.evaluate(() => window.testPlayer.muted), false);

    // Background tabs never pause the visible player.
    const background = await context.newPage(); await background.goto('about:blank'); await page.waitForTimeout(500);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true', 'background tab and visibility events do not pause');
    await background.close();

    // Collapsing while playing keeps audio alive in the floating player.
    const beforeFloat = await page.evaluate(() => ({ index: window.testPlayer.index, time: window.testPlayer.time, players: window.playerCount }));
    await page.locator('#radio-expand').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'true');
    assert.equal(await page.evaluate(() => window.testPlayer.index), beforeFloat.index);
    assert.ok(await page.evaluate(() => window.testPlayer.time) >= 50, 'playback position is retained');
    assert.equal(await page.evaluate(() => window.playerCount), beforeFloat.players, 'the player is kept, not remounted');
    assert.equal(await page.locator('#radio-dock .radio-visual').isVisible(), true);
    assert.equal(await page.locator('#radio-expanded').isVisible(), false);
    assert.equal(await page.locator('#radio-diagnostics').isVisible(), false);
    assert.equal(await page.locator('#radio-dock .radio-mini-actions').isVisible(), false);

    // Dragging moves the dock without pausing, restarting or recreating the embed.
    const drag = await dragDock(page, -160, -120);
    assert.ok(Math.abs(drag.after.x - (drag.before.x - 160)) <= 3, 'drag moves horizontally with the pointer: ' + JSON.stringify(drag));
    assert.ok(Math.abs(drag.after.y - (drag.before.y - 120)) <= 3, 'drag moves vertically with the pointer: ' + JSON.stringify(drag));
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    assert.equal(await page.evaluate(() => window.playerCount), beforeFloat.players);
    assert.equal(await page.evaluate(() => window.testPlayer.index), beforeFloat.index);
    assert.ok(await page.evaluate(() => window.testPlayer.time) >= 50, 'drag does not restart the track');
    assert.ok(!(await page.evaluate(() => document.body.classList.contains('radio-dragging'))), 'drag cleanup releases text selection');
    await expectInViewport(page, 'after drag');

    // Keyboard repositioning: arrows nudge, Home resets to the default bottom-right corner.
    await page.locator('#radio-grip').focus();
    const keyboardStart = await dockBox(page);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowUp');
    const keyboardMoved = await dockBox(page);
    assert.ok(Math.abs(keyboardMoved.x - (keyboardStart.x - 24)) <= 1, 'arrow keys nudge by 12 px');
    assert.ok(Math.abs(keyboardMoved.y - (keyboardStart.y - 40)) <= 1, 'shift + arrow nudges by 40 px');
    await page.keyboard.press('Home');
    const reset = await dockBox(page);
    const viewport = page.viewportSize();
    assert.ok(Math.abs(reset.x - (viewport.width - reset.width - 18)) <= 1, 'Home resets to the bottom-right');
    assert.ok(Math.abs(reset.y - (viewport.height - reset.height - 18)) <= 1);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');

    // Saved position survives reloads; resizing clamps it back into the viewport.
    await page.setViewportSize({ width: 500, height: 500 });
    await page.waitForTimeout(150);
    await expectInViewport(page, 'after viewport shrink');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const leftGrip = await page.locator('#radio-grip').boundingBox();
    await dragDock(page, 16 - (leftGrip.x + leftGrip.width / 2), 0);
    const leftDrag = await dockBox(page);
    assert.ok(leftDrag.x <= 14, 'mobile drop snaps to the nearest horizontal edge');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    await expectInViewport(page, 'after mobile snap');
    const rightGrip = await page.locator('#radio-grip').boundingBox();
    const mobileBox = await dockBox(page);
    await page.mouse.move(rightGrip.x + rightGrip.width / 2, rightGrip.y + rightGrip.height / 2);
    await page.mouse.down();
    await page.mouse.move(374, rightGrip.y + rightGrip.height / 2, { steps: 8 });
    await page.mouse.up();
    const mobileRight = await dockBox(page);
    const mobileViewport = page.viewportSize();
    assert.ok(mobileRight.x > mobileBox.x, 'mobile drag reaches the opposite edge');
    assert.ok(Math.abs(mobileRight.x - (mobileViewport.width - mobileRight.width - 12)) <= 2, 'right-edge snap keeps a small margin');
    await expectInViewport(page, 'after mobile right snap');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');

    // Same-document navigation keeps one player, the drag position and playback.
    const navBox = await dockBox(page);
    await page.locator('nav a[href="#daily-planner"]').click();
    const navAfter = await dockBox(page);
    assert.ok(Math.abs(navAfter.x - navBox.x) <= 1 && Math.abs(navAfter.y - navBox.y) <= 1, 'position survives route navigation');
    assert.equal(await page.evaluate(() => window.playerCount), beforeFloat.players);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');

    // Study shares the parent player and never mounts a second one.
    await page.locator('#study-nav').click(); await page.locator('#study-frame').waitFor();
    await page.waitForFunction(() => document.querySelector('#study-frame').contentDocument?.querySelector('#new-notebook'));
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    assert.equal(await page.frameLocator('#study-frame').locator('#radio-dock').count(), 0);
    await page.locator('#study-shell-close').click();

    // ZUNO Live pauses music; hanging up never resumes it; the preference can opt out.
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await page.locator('#call').click();
    await page.waitForFunction(() => !document.querySelector('#mute').disabled);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'false');
    await page.locator('#hangup').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'false');
    await page.locator('#radio-float-toggle').click();
    await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'true');
    await page.locator('#radio-pause-live').uncheck();
    await page.evaluate(() => dispatchEvent(new Event('zuno-live-start')));
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'true');
    await page.evaluate(() => dispatchEvent(new Event('zuno-live-end')));

    // Explicit "Mini (paused)" pauses first, then shows the compact bar.
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await page.locator('#radio-float-expand').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'expanded');
    await page.locator('#radio-tracks .radio-track-play[data-index="1"]').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Midnight Drive');
    await page.locator('#radio-expand').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await page.locator('#radio-float-mini').click();
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'mini');
    await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'false');
    assert.match(await page.locator('#radio-status').textContent(), /Paused/);
    assert.equal(await page.locator('#radio-dock .radio-visual').isVisible(), false, 'the hidden embed is not rendered in the bar');
    assert.equal(await page.locator('#radio-expanded').isVisible(), false);
    const miniBox = await dockBox(page);
    assert.ok(miniBox.width >= 300 && miniBox.width <= 340, 'compact mini width');
    assert.ok(miniBox.height >= 60 && miniBox.height <= 72, 'compact mini height');
    assert.equal(await page.locator('#radio-mini-title').textContent(), 'Midnight Drive');
    assert.equal(await page.locator('#radio-mini-artist').textContent(), 'Night Artist');
    assert.equal(await page.evaluate(() => window.playerCount), beforeFloat.players, 'the player is kept, not remounted');

    // Restore the active playlist, track, volume and saved position across refresh.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('zuno-radio-state:1') || '{}'));
    assert.ok(saved.pos && Number.isFinite(saved.pos.x) && Number.isFinite(saved.pos.y), 'drag position is persisted per account');
    assert.equal(saved.layout, 'mini');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#radio-library h4')?.textContent === 'Quiet hours');
    await page.waitForFunction(() => !document.querySelector('#radio-dock').hidden && document.querySelector('#radio-dock').dataset.layout === 'mini');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'false');
    assert.equal(await page.locator('#radio-mini-title').textContent(), 'Midnight Drive');
    assert.equal(await page.evaluate(() => window.playerCount || 0), 0, 'refresh must not create or autoplay a player');
    assert.equal(await page.locator('#radio-volume').inputValue(), '35');
    await page.locator('#radio-mini-toggle').click();
    await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'true');
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    assert.equal(await page.evaluate(() => window.testPlayer.index), 1);
    assert.equal(await page.evaluate(() => window.testPlayer.volume), 35);
    assert.equal(await page.locator('#radio-track').textContent(), 'Midnight Drive');
    const restoredBox = await dockBox(page);
    assert.ok(Math.abs(restoredBox.x - saved.pos.x) <= 2 && Math.abs(restoredBox.y - saved.pos.y) <= 2, 'reload restores the saved float position');
    await expectInViewport(page, 'after reload');
    await page.locator('#radio-float-expand').click();
    await page.locator('#radio-stop').click();

    // Library import, editing, switching playlists and error recovery.
    await page.locator('#radio-url').fill(url.replace(id, secondId)); await page.locator('#radio-import button').click();
    await page.waitForFunction(() => document.querySelectorAll('.radio-playlist').length === 2);
    await page.locator('.radio-playlist').last().getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#radio-label').fill('<img src=x onerror=alert(1)>'); await page.locator('#radio-tags input[value="bored"]').check(); await page.locator('#radio-edit-form button.radio-primary').click();
    await page.waitForFunction(() => document.querySelectorAll('.radio-playlist h4')[1]?.textContent.includes('<img'));
    assert.equal(await page.locator('#radio-library h4 img, #radio-library h4 *').count(), 0, 'labels are rendered as text, not markup');
    assert.equal(await page.locator('#radio-library img[src="x"]').count(), 0);
    await page.locator('.radio-playlist').first().getByRole('button', { name: 'Play playlist' }).click();
    await page.waitForFunction(() => !document.querySelector('#radio-toggle').disabled);
    await page.evaluate(ids => { window.__radioFixtureIds = ids; }, [videoId(10), videoId(11), videoId(12)]);
    await page.locator('.radio-playlist').last().getByRole('button', { name: 'Play playlist' }).click();
    await page.waitForFunction(() => document.querySelector('#radio-playlist-title').textContent === '<img src=x onerror=alert(1)>');
    assert.equal(await page.evaluate(() => testPlayer.list), secondId);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-layout'), 'float');
    await page.locator('#radio-float-expand').click();
    await page.waitForFunction(() => document.querySelectorAll('#radio-tracks .radio-track').length === 3);
    assert.equal(await page.locator('#radio-track').textContent(), 'Second Wind');
    await page.evaluate(() => testPlayer.options.events.onError({ data: 100 }));
    assert.match(await page.locator('#radio-status').textContent(), /unavailable, deleted or private/);
    assert.equal(await page.locator('#radio-dock').getAttribute('data-playing'), 'false');
    await page.evaluate(() => testPlayer.emit(-1));
    assert.match(await page.locator('#radio-status').textContent(), /YouTube 100/);
    await page.locator('#radio-next').click();
    await page.waitForFunction(() => document.querySelector('#radio-track').textContent === 'Second Sun');
    assert.equal(await page.evaluate(() => testPlayer.index), 1);
    for (const code of [2, 5, 101, 150, 153]) {
      await page.evaluate(code => { testPlayer.options.events.onError({ data: code }); testPlayer.emit(-1); }, code);
      assert.match(await page.locator('#radio-status').textContent(), new RegExp('YouTube ' + code));
      assert.ok(await page.locator('#radio-youtube').getAttribute('href'));
      await page.locator('#radio-retry').click(); await page.waitForFunction(() => document.querySelector('#radio-dock').dataset.playing === 'true');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('.radio-vinyl').evaluate(el => getComputedStyle(el).animationName), 'none');
    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const mobileFrame = await page.locator('#radio-video iframe').boundingBox(); assert.ok(mobileFrame.width >= 200 && mobileFrame.height >= 200);
    await page.screenshot({ path: path.join(dir, 'radio-mobile.png'), fullPage: true });
    await page.locator('#radio-stop').click();
    await page.locator('.radio-playlist').last().getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#radio-delete-cancel').click(); assert.equal(await page.locator('.radio-playlist').count(), 2);
    await page.locator('.radio-playlist').last().getByRole('button', { name: 'Remove', exact: true }).click(); await page.locator('#radio-delete-confirm').click();
    await page.waitForFunction(() => document.querySelectorAll('.radio-playlist').length === 1);
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.radio-playlist').length === 1);
    assert.deepEqual(errors, []);
    // Real-network playback verification lives in tests/radio-live-smoke.cjs so the
    // deterministic fixture test never mixes fake metadata with real video IDs.
    console.log('Radio test artifacts:', dir);
  } finally { await browser?.close(); if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); } }
});
