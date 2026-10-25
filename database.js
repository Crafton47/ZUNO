/**
 * database.js — SQLite via sql.js (pure JavaScript, no native build required)
 * Data is persisted to vibeai.db in the project folder.
 */

const path = require('path');
const fs   = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vibeai.db');

let db = null; // Will hold the sql.js DB instance

// Write DB to disk after every write operation
function saveToDisk() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Initialize DB (async because sql.js loads a WASM binary)
async function init() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    // Load existing database from disk
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing SQLite database from:', DB_PATH);
  } else {
    // Create a fresh database
    db = new SQL.Database();
    console.log('[DB] Created new SQLite database at:', DB_PATH);
  }

  // Create users table if not exists
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL,
      email       TEXT    UNIQUE NOT NULL,
      password    TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
  `);
  db.run(`CREATE TABLE IF NOT EXISTS companion_profiles (user_id INTEGER PRIMARY KEY, notes TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS companion_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));`);
  db.run(`CREATE TABLE IF NOT EXISTS schedule_tasks (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
    due_at TEXT NOT NULL, timezone TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT, reward TEXT, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS schedule_owner_due ON schedule_tasks(user_id, due_at);
    CREATE TABLE IF NOT EXISTS schedule_actions (user_id INTEGER NOT NULL, action_id TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(user_id, action_id));
    CREATE TABLE IF NOT EXISTS schedule_reminders (user_id INTEGER NOT NULL, reminder_id TEXT NOT NULL, PRIMARY KEY(user_id, reminder_id));`);
  saveToDisk();

  require('./study').init();
  return db;
}

// ── Query Helpers ──────────────────────────────────────────────

function findUserByEmail(email) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  stmt.bind([email]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function findUserById(id) {
  const stmt = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function emailExists(email) {
  const res = db.exec('SELECT 1 FROM users WHERE email = ?', [email]);
  return res.length > 0 && res[0].values.length > 0;
}

function usernameExists(username) {
  const res = db.exec('SELECT 1 FROM users WHERE username = ?', [username]);
  return res.length > 0 && res[0].values.length > 0;
}

function createUser({ username, email, password }) {
  db.run(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
    [username, email, password]
  );
  // Get the last inserted id
  const res = db.exec('SELECT last_insert_rowid() as id');
  const id  = res[0].values[0][0];
  saveToDisk();
  return id;
}

module.exports = {
  rows(sql, params = []) {
    const stmt = db.prepare(sql);
    try { stmt.bind(params); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  },
  write(sql, params = []) { db.run(sql, params); saveToDisk(); },
  transaction(fn) {
    db.run('BEGIN');
    try { const result = fn(); db.run('COMMIT'); saveToDisk(); return result; }
    catch (error) { db.run('ROLLBACK'); throw error; }
  },
  execute(sql, params = []) { db.run(sql, params); },
  profile(id) {
    return db.exec('SELECT notes FROM companion_profiles WHERE user_id = ?', [id])[0]?.values[0][0] || '';
  },
  saveProfile(id, notes) {
    db.run('INSERT OR REPLACE INTO companion_profiles (user_id, notes) VALUES (?, ?)', [id, notes]);
    saveToDisk();
  },
  history(id) {
    const result = db.exec('SELECT role, text, created_at FROM (SELECT * FROM companion_messages WHERE user_id = ? ORDER BY id DESC LIMIT 60) ORDER BY id', [id]);
    return (result[0]?.values || []).map(([role, text, created_at]) => ({ role, text, created_at }));
  },
  addMessage(id, role, text) {
    db.run('INSERT INTO companion_messages (user_id, role, text) VALUES (?, ?, ?)', [id, role, text]);
    db.run('DELETE FROM companion_messages WHERE user_id = ? AND id NOT IN (SELECT id FROM companion_messages WHERE user_id = ? ORDER BY id DESC LIMIT 60)', [id, id]);
    saveToDisk();
  },
  clearHistory(id) {
    db.run('DELETE FROM companion_messages WHERE user_id = ?', [id]);
    saveToDisk();
  },
  init,
  findUserByEmail,
  findUserById,
  emailExists,
  usernameExists,
  createUser,
};
