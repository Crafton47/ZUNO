// Explicit opt-in integration test: uses running Open Notebook and configured AI provider.
// All ZUNO records live in a temporary database; only test-created upstream notebooks are deleted.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-study-live-'));
const base = 'http://localhost:32281';
let child, browser, notebook, token;
async function start(extra = {}) {
  child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: '32281', DB_PATH: path.join(dir, 'study-test.db'), JWT_SECRET: 'study-test-only-test-test-test-test-test', STUDY_ENABLED: 'true', STUDY_OWNER_ID: '1', ...extra }, stdio: 'pipe' });
  child.stderr.on('data', b => process.stderr.write(b));
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Server start timeout')), 15000); child.stdout.on('data', b => { if (String(b).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.on('exit', () => { clearTimeout(timer); reject(new Error('Server exited')); }); });
}
async function stop() { if (!child || child.exitCode !== null) return; const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
async function req(url, method = 'GET', body, auth = token) {
  const form = body instanceof FormData;
  const r = await fetch(base + url, { method, headers: { ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(!form ? { 'Content-Type': 'application/json' } : {}) }, body: body ? form ? body : JSON.stringify(body) : undefined, signal: AbortSignal.timeout(150000) });
  return { status: r.status, data: await r.json() };
}
const study = (suffix = '') => '/api/companion/study/notebooks' + (notebook ? '/' + notebook : '') + suffix;
function pdf(text) {
  const stream = `BT /F1 12 Tf 40 750 Td (${text}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n', offsets = [0];
  objects.forEach((o,i) => { offsets.push(Buffer.byteLength(result)); result += `${i+1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(result); result += `xref\n0 6\n0000000000 65535 f \n` + offsets.slice(1).map(o => `${String(o).padStart(10,'0')} 00000 n \n`).join('') + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
(async () => {
  await start();
  for (const name of ['study_owner', 'study_other']) assert.equal((await req('/api/register', 'POST', { username: name, email: name + '@example.test', password: 'test-study-password' }, '')).status, 200);
  token = (await req('/api/login', 'POST', { email: 'study_owner@example.test', password: 'test-study-password' }, '')).data.token;
  const other = (await req('/api/login', 'POST', { email: 'study_other@example.test', password: 'test-study-password' }, '')).data.token;
  assert.equal((await req('/api/companion/study/status')).data.available, true);
  assert.equal((await req('/api/companion/study/notebooks', 'GET', null, '')).status, 401);
  assert.equal((await req('/api/companion/study/notebooks', 'GET', null, other)).status, 403);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); await page.goto(base + '/login.html'); await page.evaluate(t => localStorage.setItem('vibe_token', t), token);
  // Both dashboard entry points open the in-dashboard Study shell without leaving /chat.
  for (const entry of ['#study-entry', '#study-nav']) {
    await page.goto(base + '/chat');
    await page.locator(entry).click();
    await page.locator('#study-shell').waitFor({ state: 'visible' });
    await page.locator('#study-frame').waitFor();
    assert.equal(new URL(page.url()).pathname, '/chat');
  }
  await page.goto(base + '/study');
  await page.locator('#new-notebook').click(); await page.locator('#edit-name').fill('DBMS integration test'); await page.locator('#edit-form button[type=submit]').click();
  try { await page.waitForURL('**/study?notebook=*'); } catch(e) { console.log('Create notebook UI errors:', await page.locator('#edit-error').textContent(), await page.locator('#error').textContent()); throw e; } notebook = new URL(page.url()).searchParams.get('notebook');
  await page.reload(); await page.locator('#notebook-name').filter({ hasText: 'DBMS integration test' }).waitFor();
  assert.equal((await req(study(), 'GET', null, other)).status, 403);
  const content = 'DBMS revision notes. Normalization reduces redundant data and prevents update anomalies. First normal form requires atomic values. Second normal form removes partial dependencies on composite keys. Third normal form removes transitive dependencies. The revision code for this notebook is JUNIPER-742.';
  await page.locator('#document').setInputFiles({ name: 'dbms-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(content) });
  await page.locator('#upload-form button').click(); await page.getByText('Uploaded. Processing status shown below.').waitFor({ timeout: 60000 });
  const form = new FormData(); form.set('file', new Blob([pdf('Third normal form removes transitive dependencies. Test revision PDF.')], { type: 'application/pdf' }), 'dbms.pdf');
  assert.equal((await req(study('/sources'), 'POST', form)).status, 202);
  let data;
  for (let i = 0; i < 40; i++) { data = (await req(study())).data; if (data.items?.length === 2 && data.items.every(s => s.status === 'completed' && s.text)) break; await new Promise(r => setTimeout(r, 1000)); }
  assert.equal(data.items.length, 2); assert.ok(data.items.every(s => s.status === 'completed' && s.text), JSON.stringify(data.items.map(s => ({ status: s.status, hasText: !!s.text }))));
  console.log('PASS: navigation, notebook persistence, actual TXT/PDF ingestion, owner gate.');
  const answer = await req(study('/chat'), 'POST', { question: 'What is our revision code, and what does third normal form remove? Cite the notes.' });
  assert.equal(answer.status, 200, JSON.stringify(answer.data));
  assert.match(answer.data.text, /JUNIPER-742/); assert.match(answer.data.text, /transitive/i); assert.ok(answer.data.citations.length > 0, 'Expected actual model citations');
  assert.ok(answer.data.citations.every(c => data.items.some(i => i.id === c.id)));
  console.log('PASS: real provider grounded answer and authorized source citations.');
  assert.equal((await req(study('/notes'), 'POST', { title: 'Revision plan', content: 'Revise normalization tomorrow.' })).status, 201);
  assert.equal((await req(study(), 'PATCH', { name: 'DBMS verified' })).status, 200);
  const task = await req(study('/tasks'), 'POST', { title: 'Revise normalization', dueAt: new Date(Date.now() + 86400000).toISOString(), timezone: 'Asia/Kolkata', requestId: 'live-study-test' });
  assert.equal(task.status, 201); assert.ok((await req('/api/companion/tasks')).data.tasks.some(t => t.id === task.data.tasks[0].id));
  await page.reload(); await page.locator('#notebook-name').filter({ hasText: 'DBMS verified' }).waitFor();
  await page.getByRole('button', { name: '[1] dbms-notes.txt', exact: true }).click();
  assert.match(await page.locator('#source-text').textContent(), /JUNIPER-742/); await page.locator('#source-close').click();
  await page.locator('#summarize').click();
  await page.waitForFunction(() => document.querySelectorAll('.answer').length === 2, null, { timeout: 150000 });
  assert.match(await page.locator('.answer').last().textContent(), /normal|dependenc/i);
  console.log('PASS: source inspection and real notebook summary.');
  const analyzed = await req(study('/rescue/analyze'), 'POST', { sourceIds: data.items.map(i => i.id) });
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.data));
  assert.ok(analyzed.data.topics.length > 0, 'Actual extracted topics required');
  assert.ok(analyzed.data.topics.every(t => data.items.some(i => i.id === t.sourceId && i.text.replace(/\s+/g,' ').includes(t.quote.replace(/\s+/g,' ')))));
  const { DateTime } = require('luxon');
  const today = DateTime.now().setZone('Asia/Kolkata').startOf('day');
  const setup = { name:'DBMS live exam',timezone:'Asia/Kolkata',examAt:today.plus({days:3,hours:10}).toFormat("yyyy-MM-dd'T'HH:mm"),strategy:'balanced',sessionMinutes:45,breakMinutes:10,travelMinutes:60,topics:analyzed.data.topics,availability:[1,2,3].map(d=>({date:today.plus({days:d}).toISODate(),start:'07:00',end:'20:00',maxHours:5})) };
  let preview = await req(study('/rescue/preview'),'POST',{setup});
  assert.equal(preview.status,200,JSON.stringify(preview.data));
  let result = await req(study('/rescue/apply'),'POST',{previewId:preview.data.previewId,confirm:true});
  assert.equal(result.status,200,JSON.stringify(result.data));
  const examPlan=result.data.plan;
  assert.ok(examPlan.blocks.length>0);
  await req('/api/companion/tasks/'+examPlan.blocks[0].taskId,'PATCH',{completed:true});
  preview=await req(study('/rescue/preview'),'POST',{planId:examPlan.id,setup});
  result=await req(study('/rescue/apply'),'POST',{previewId:preview.data.previewId,confirm:true});
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.plan.blocks.find(b=>b.id===examPlan.blocks[0].id).status,'completed');
  await page.goto(base+'/study?notebook='+notebook+'&section=rescue');
  await page.locator('.rescue-block').first().waitFor();
  console.log('PASS: real topic extraction with verbatim evidence, three-day exam schedule, linked missions, completion and confirmed rescheduling.');
  await page.screenshot({ path: path.join(dir, 'study-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(dir, 'study-mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await stop(); await start(); assert.equal((await req(study())).data.notebook.name, 'DBMS verified');
  assert.ok((await req('/api/companion/tasks')).data.tasks.length > 0);
  await stop(); await start({ STUDY_OWNER_ID: '2' });
  assert.equal((await req(study(), 'GET', null, other)).status, 404); // ownership check independent of owner gate
  assert.equal((await req(study('/chat'), 'POST', { question: 'secret?' }, other)).status, 404);
  await stop(); await start({ OPEN_NOTEBOOK_URL: 'http://127.0.0.1:1' });
  assert.equal((await req('/api/companion/study/status')).status, 503); assert.equal((await req('/api/companion/tasks')).status, 200);
  await page.goto(base + '/study'); await page.locator('#error').filter({ hasText: 'offline' }).waitFor();
  await stop(); await start();
  assert.equal((await req(study(), 'DELETE', {})).status, 400);
  assert.equal((await req(study(), 'DELETE', { confirm: true })).status, 200); notebook = null;
  console.log('PASS: notes, rename, planner links, disk restart, cross-user ownership, offline isolation, delete confirmation, responsive layout.');
  console.log('Screenshots and isolated database: ' + dir);
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(async () => {
  if (notebook) { try { await req(study(), 'DELETE', { confirm: true }); } catch {} }
  await browser?.close(); await stop();
});
