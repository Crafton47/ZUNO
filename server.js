require('dotenv').config();

const express = require('express');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const db      = require('./database');
const http = require('http');
const { attachCompanion } = require('./companion');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT   || 3000;
const SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

const SALT_ROUNDS = 12;

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'public')));
for (const page of ['login.html', 'register.html', 'index.html']) {
  app.get('/' + page, (req, res) => res.sendFile(path.join(__dirname, page)));
}
app.get('/ideas', (req, res) => res.sendFile(path.join(__dirname, 'legacy.html')));

// ── JWT Verification Middleware ────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];  // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: 'No token provided. Please log in.' });
  }
  try {
    const payload = jwt.verify(token, SECRET);
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
    if (password.length < 6) {
      return fail(res, 400, 'Password must be at least 6 characters.');
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail    = email.trim().toLowerCase();

    // === Check uniqueness ===
    if (db.usernameExists(cleanUsername)) {
      return fail(res, 409, 'Username is already taken.');
    }
    if (db.emailExists(cleanEmail)) {
      return fail(res, 409, 'An account with this email already exists.');
    }

    // === Hash password & create user ===
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const id   = db.createUser({ username: cleanUsername, email: cleanEmail, password: hash });

    console.log(`[AUTH] New user registered: ${cleanUsername} (id=${id})`);
    return ok(res, { message: 'Account created! You can now log in.' });

  } catch (err) {
    console.error('[REGISTER ERROR]', err.message);
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
    const user = db.findUserByEmail(cleanEmail);

    if (!user) {
      return fail(res, 401, 'No account found with that email address.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
      return fail(res, 401, 'Incorrect password. Please try again.');
    }

    // Issue JWT
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      SECRET,
      { expiresIn: EXPIRES }
    );

    console.log(`[AUTH] User logged in: ${user.username} (id=${user.id})`);
    return ok(res, {
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });

  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    return fail(res, 500, 'Server error during login. Please try again.');
  }
});

// ── API: Verify Token (used by chatbot page on load) ──────────
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.findUserById(req.user.id);
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

async function startServer() {
  try {
    await db.init();  // Load / create SQLite database (sql.js needs async WASM init)
    server.listen(PORT, () => {
      console.log(`\n🚀 Vibe AI Server running at: http://localhost:${PORT}`);
      console.log(`   → Login page:   http://localhost:${PORT}/login.html`);
      console.log(`   → Chatbot:      http://localhost:${PORT}/chat`);
      console.log(`   → Database:     vibeai.db\n`);
    });
  } catch (err) {
    console.error('[STARTUP ERROR]', err);
    process.exit(1);
  }
}

startServer();
