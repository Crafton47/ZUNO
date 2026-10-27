const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync, spawn } = require('node:child_process');

console.log('=== ZUNO Clean-Clone Isolation Test ===');
const source = path.resolve(__dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zuno-clean-clone-'));
console.log(`Isolated directory: ${tempDir}`);

// 1. Copy allowlisted source files (tracked + untracked release files)
const exclude = new Set([
  'node_modules',
  'dist',
  '.env',
  '.gravitas',
  '.agents',
  'test-results',
  'playwright-report',
  'vibeai.db'
]);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (exclude.has(entry.name) || entry.name.endsWith('.db') || entry.name.includes('.db-') || entry.name.endsWith('.log')) {
      continue;
    }
    const sPath = path.join(src, entry.name);
    const dPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(sPath, dPath);
    } else {
      fs.copyFileSync(sPath, dPath);
    }
  }
}

copyDir(source, tempDir);
console.log('Copied project files to clean temp directory.');

function run(cmd, args, cwd = tempDir, env = {}) {
  console.log(`\n> [${cwd}] ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
    shell: true
  });
  if (res.status !== 0) {
    throw new Error(`Command failed with exit code ${res.status}: ${cmd} ${args.join(' ')}`);
  }
}

try {
  // Step A: npm ci
  console.log('\n--- Step A: npm ci ---');
  run('npm', ['ci']);

  // Step B: create synthetic .env
  console.log('\n--- Step B: create synthetic .env ---');
  let envExample = fs.readFileSync(path.join(tempDir, '.env.example'), 'utf8');
  envExample = envExample.replace(
    /JWT_SECRET=.*/,
    'JWT_SECRET=synthetic-clean-clone-secret-01234567890123456789'
  );
  fs.writeFileSync(path.join(tempDir, '.env'), envExample);
  console.log('Created .env with synthetic 32-byte JWT_SECRET.');

  // Step C: npm run check
  console.log('\n--- Step C: npm run check ---');
  run('npm', ['run', 'check']);

  // Step D: npm run lint
  console.log('\n--- Step D: npm run lint ---');
  run('npm', ['run', 'lint']);

  // Step E: npm run build
  console.log('\n--- Step E: npm run build ---');
  run('npm', ['run', 'build']);

  // Step F: npm test
  console.log('\n--- Step F: npm test ---');
  run('npm', ['test']);

  // Step G: clean startup test from empty database
  console.log('\n--- Step G: Clean startup from empty database ---');
  const port = 34567;
  const dbPath = path.join(tempDir, 'clean-startup-test.db');
  const serverProc = spawn(process.execPath, [path.join(tempDir, 'server.js')], {
    cwd: tempDir,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      JWT_SECRET: 'synthetic-clean-clone-secret-01234567890123456789',
      STUDY_ENABLED: 'false',
      GEMINI_API_KEY: '',
      NVIDIA_API_KEY: '',
      YOUTUBE_API_KEY: ''
    },
    stdio: 'pipe'
  });

  let serverOutput = '';
  serverProc.stdout.on('data', d => { serverOutput += d; });
  serverProc.stderr.on('data', d => { serverOutput += d; });

  const startPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timed out:\n' + serverOutput)), 15000);
    serverProc.stdout.on('data', d => {
      if (d.toString().includes('Server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
    serverProc.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited unexpectedly with code ${code}:\n` + serverOutput));
    });
  });

  // Await start
  const runAsync = async () => {
    await startPromise;
    console.log(`Server started successfully on port ${port}.`);

    // Test public endpoint
    const resHtml = await fetch(`http://localhost:${port}/login.html`);
    console.log(`GET /login.html status: ${resHtml.status}`);
    if (resHtml.status !== 200) {
      throw new Error(`Expected /login.html status 200, got ${resHtml.status}`);
    }

    // Test protected endpoint without token returns 401
    const resAuth = await fetch(`http://localhost:${port}/api/companion`);
    console.log(`GET /api/companion (no token) status: ${resAuth.status}`);
    if (resAuth.status !== 401) {
      throw new Error(`Expected status 401 for unauthenticated request, got ${resAuth.status}`);
    }

    // Register a new user on the clean database
    const regRes = await fetch(`http://localhost:${port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'cleanclone_user',
        email: 'cleanclone@example.test',
        password: 'clean-clone-password-123'
      })
    });
    console.log(`POST /api/register status: ${regRes.status}`);
    if (regRes.status !== 200) {
      throw new Error(`Registration failed with status ${regRes.status}`);
    }

    // Login to get token
    const loginRes = await fetch(`http://localhost:${port}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'cleanclone@example.test',
        password: 'clean-clone-password-123'
      })
    });
    const { token } = await loginRes.json();
    console.log(`POST /api/login status: ${loginRes.status}, token received: ${Boolean(token)}`);
    if (!token) {
      throw new Error('No token returned from login');
    }

    // Request with valid token
    const resComp = await fetch(`http://localhost:${port}/api/companion`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    console.log(`GET /api/companion (with token) status: ${resComp.status}`);
    const data = await resComp.json();
    console.log(`GET /api/companion body: ${JSON.stringify(data)}`);
    if (resComp.status !== 200) {
      throw new Error(`Expected status 200, got ${resComp.status}`);
    }

    // Verify empty db file was created
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Expected db file ${dbPath} to exist`);
    }
    console.log(`Database file successfully initialized on disk (${fs.statSync(dbPath).size} bytes).`);

    serverProc.kill();
    console.log('\n=== CLEAN-CLONE TEST PASSED ALL CHECKS ===');
  };

  runAsync().then(() => {
    // Cleanup temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('Cleaned up temporary directory.');
    } catch (e) {
      console.warn('Note: Could not delete tempDir immediately:', e.message);
    }
    process.exit(0);
  }).catch(err => {
    serverProc.kill();
    console.error('Clean clone test failed:', err);
    process.exit(1);
  });

} catch (err) {
  console.error('Clean clone test step error:', err);
  process.exit(1);
}
