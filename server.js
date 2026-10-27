require('dotenv').config();

const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const db      = require('./database');
const http = require('http');
const { attachCompanion } = require('./companion');
const { signingSecret, rateLimit, accountKey } = require('./security');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT   || 3000;
const SECRET = signingSecret();
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

const SALT_ROUNDS = 12;

let dummyPasswordHash;
let initPromise = null;
async function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      dummyPasswordHash = await bcrypt.hash(require('crypto').randomBytes(32).toString('hex'), SALT_ROUNDS);
      await db.init();
    })();
  }
  return initPromise;
}

// ── Middleware ─────────────────────────────────────────────────
app.disable('x-powered-by');
app.use(async (req, res, next) => {
  try {
    await ensureInit();
    next();
  } catch (err) {
    next(err);
  }
});
app.use(express.json({ limit: '100kb' }));
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  if (req.path.startsWith('/api')) {
    res.set('X-Frame-Options', 'DENY');
    res.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  } else {
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'");
  }
  next();
});
const authIpLimit = rateLimit({ limit: 60, windowMs: 15 * 60000 });
const authAccountLimit = rateLimit({ limit: 15, windowMs: 15 * 60000, key: accountKey });
app.use(['/api/login', '/api/register'], authIpLimit, authAccountLimit);
// A stray rejected promise (provider socket, background job) must never take the
// whole app down and surface as a random crash; log it and keep serving.
process.on('unhandledRejection', () => console.error('[UNHANDLED REJECTION] Background operation failed.'));
server.on('error', error => { console.error('[SERVER ERROR]', error.code || error.message); process.exit(1); });
// YouTube embeds require client identification; never suppress the cross-origin Referer.
app.use((req, res, next) => { res.set('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });
app.use('/assets', express.static(path.join(__dirname, 'public')));
for (const page of ['login.html', 'register.html', 'index.html']) {
  app.get('/' + page, (req, res) => res.sendFile(path.join(__dirname, page)));
}
app.get('/ideas', (req, res) => res.sendFile(path.join(__dirname, 'legacy.html')));
app.get('/study', (req, res) => res.sendFile(path.join(__dirname, 'study.html')));
app.get('/radio', (req, res) => res.redirect('/chat#zuno-radio'));

// ── JWT Verification Middleware ────────────────────────────────
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = typeof authHeader === 'string' && /^Bearer ([^\s]+)$/i.exec(authHeader)?.[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }
  try {
    const payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
    if (!Number.isSafeInteger(payload.id) || payload.id < 1) {
      return res.status(401).json({ error: 'Please log in again.' });
    }
    const user = await db.findUserById(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'Please log in again.' });
    }
    req.user = payload;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

// ── Helper: send uniform errors ────────────────────────────────
const fail = (res, status, message) => res.status(status).json({ error: message });
const ok   = (res, data)           => res.json({ success: true, ...data });

// ── Routes: static pages ───────────────────────────────────────

// Root → redirect to login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Protected chatbot page
app.get('/chat', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── API: Health Check ──────────────────────────────────────────
app.get('/api', (req, res) => res.json({ status: 'ok', name: 'ZUNO API' }));
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

// ── API: Register ──────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // === Validate fields ===
    if (![username, email, password].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)) {
      return fail(res, 400, 'All fields are required.');
    }
    if (username.trim().length < 3) {
      return fail(res, 400, 'Username must be at least 3 characters.');
    }
    if (username.trim().length > 30) {
      return fail(res, 400, 'Username must be 30 characters or fewer.');
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      return fail(res, 400, 'Username can only contain letters, numbers, and underscores.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(res, 400, 'Invalid email address.');
    }
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
      return fail(res, 400, 'Password must be at least 12 characters and at most 72 UTF-8 bytes.');
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail    = email.trim().toLowerCase();

    // === Check uniqueness ===
    if (await db.usernameExists(cleanUsername)) {
      return fail(res, 409, 'Unable to create an account with these details.');
    }
    if (await db.emailExists(cleanEmail)) {
      return fail(res, 409, 'Unable to create an account with these details.');
    }

    // === Hash password & create user ===
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id   = await db.createUser({ username: cleanUsername, email: cleanEmail, password: hash });

    return ok(res, { message: 'Account created! You can now log in.' });

  } catch (err) {
    console.error('[REGISTER ERROR] Account creation failed.');
    return fail(res, 500, 'Server error during registration. Please try again.');
  }
});

// ── API: Login ─────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (![email, password].every(v => typeof v === 'string' && v.length > 0 && v.length <= 256)) {
      return fail(res, 400, 'Email and password are required.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await db.findUserByEmail(cleanEmail);

    const passwordMatch = await bcrypt.compare(password, user ? user.password : dummyPasswordHash);
    if (!user || !passwordMatch) {
      return fail(res, 401, 'Invalid email or password.');
    }

    // Issue JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      SECRET,
      { expiresIn: EXPIRES }
    );

    return ok(res, {
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });

  } catch (err) {
    console.error('[LOGIN ERROR] Authentication failed.');
    return fail(res, 500, 'Server error during login. Please try again.');
  }
});

// ── API: Verify Token (used by chatbot page on load) ──────────
app.get('/api/me', requireAuth, async (req, res) => {
  const user = await db.findUserById(req.user.id);
  if (!user) return fail(res, 404, 'User not found.');
  return ok(res, { user });
});

// ── API: Logout (client-side, just sends confirmation) ────────
app.post('/api/logout', requireAuth, (req, res) => {
  // JWT is stateless — actual logout is done by deleting the token client-side
  return ok(res, { message: 'Logged out successfully.' });
});

// ── Start Server (after DB is ready) ──────────────────────────
attachCompanion(app, server, requireAuth);
app.use((error, req, res, next) => {
  console.error('[REQUEST ERROR]', req.method, Number(error?.status) || 500);
  if (res.headersSent) return next(error);
  const status = Number(error?.status);
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Something went wrong. Please retry.' });
});

async function startServer() {
  try {
    await ensureInit();
    server.listen(PORT, () => {
      console.log(`\n🚀 Vibe AI Server running at: http://localhost:${PORT}`);
      console.log(`   → Login page:   http://localhost:${PORT}/login.html`);
      console.log(`   → Chatbot:      http://localhost:${PORT}/chat`);
      console.log(`   → Database:     ${process.env.DATABASE_URL ? 'Supabase PostgreSQL' : 'vibeai.db'}\n`);
    });
  } catch (err) {
    console.error('[STARTUP ERROR] Could not initialize the database or server. Check local configuration and file permissions.');
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, server, startServer, ensureInit };
