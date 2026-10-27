/**
 * database.js — Dual-mode database layer:
 * 1. Supabase PostgreSQL when DATABASE_URL is configured (Production).
 * 2. In-memory SQLite via sql.js with vibeai.db disk sync when DATABASE_URL is absent or in unit tests (Local/Testing).
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'vibeai.db');
const isExplicitTestDb = Boolean(process.env.DB_PATH && path.basename(process.env.DB_PATH) !== 'vibeai.db');
const usePg = Boolean(process.env.DATABASE_URL) && !isExplicitTestDb && process.env.NODE_ENV !== 'test';

let db = null; // Will hold the sql.js DB instance when in SQLite mode
let SQL;
let durableSnapshot;
const sleeper = new Int32Array(new SharedArrayBuffer(4));

let pgPool = null;
function getPool() {
  if (!pgPool && process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      max: 10
    });
  }
  return pgPool;
}

function toPg(sql) {
  let pgSql = sql;
  let hasIgnore = false;
  if (/INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+/i, 'INSERT INTO ');
    hasIgnore = true;
  }
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+companion_profiles/i.test(pgSql)) {
    pgSql = 'INSERT INTO companion_profiles (user_id, notes) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET notes = EXCLUDED.notes';
  } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+exam_plans/i.test(pgSql)) {
    pgSql = 'INSERT INTO exam_plans (id, user_id, notebook_id, revision, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET revision = EXCLUDED.revision, data = EXCLUDED.data';
  } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+radio_playlist_tracks/i.test(pgSql)) {
    pgSql = 'INSERT INTO radio_playlist_tracks (user_id, playlist_id, payload_json, fetched_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, playlist_id) DO UPDATE SET payload_json = EXCLUDED.payload_json, fetched_at = EXCLUDED.fetched_at';
  }
  let i = 1;
  pgSql = pgSql.replace(/\?/g, () => '$' + (i++));
  if (hasIgnore && !/ON\s+CONFLICT/i.test(pgSql)) {
    pgSql += ' ON CONFLICT DO NOTHING';
  }
  return pgSql;
}

function saveToDisk() {
  if (!db) return;
  const data = Buffer.from(db.export());
  const temporary = `${DB_PATH}.tmp-${process.pid}`;
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, DB_PATH);
      durableSnapshot = data;
      return;
    } catch (error) {
      last = error;
      try { fs.rmSync(temporary, { force: true }); } catch {}
      Atomics.wait(sleeper, 0, 0, 100 * (attempt + 1));
    }
  }
  db.close();
  db = new SQL.Database(Uint8Array.from(durableSnapshot));
  const error = new Error('Could not persist changes. Check database storage and retry.');
  error.status = 503;
  error.code = last?.code;
  throw error;
}

async function init() {
  if (usePg) {
    const pool = getPool();
    const client = await pool.connect();
    client.release();
    console.log('[DB] Connected to Supabase PostgreSQL pooler.');
    return pool;
  }

  SQL = await initSqlJs();
  let file = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { file = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null; break; }
    catch (error) {
      if (attempt === 4) throw error;
      Atomics.wait(sleeper, 0, 0, 100 * (attempt + 1));
    }
  }
  if (file) {
    db = new SQL.Database(file);
    console.log('[DB] Loaded existing SQLite database from:', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new SQLite database at:', DB_PATH);
  }
  durableSnapshot = Buffer.from(db.export());

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
  require('./radio').init();
  return db;
}

module.exports = {
  rows(sql, params = []) {
    if (usePg) {
      return getPool().query(toPg(sql), params).then(res => res.rows);
    }
    const stmt = db.prepare(sql);
    try { stmt.bind(params); const rows = []; while (stmt.step()) rows.push(stmt.getAsObject()); return rows; }
    finally { stmt.free(); }
  },
  write(sql, params = []) {
    if (usePg) {
      return getPool().query(toPg(sql), params);
    }
    db.run(sql, params); saveToDisk();
  },
  execute(sql, params = []) {
    if (usePg) {
      return getPool().query(toPg(sql), params);
    }
    db.run(sql, params);
  },
  transaction(fn) {
    if (usePg) {
      return fn();
    }
    db.run('BEGIN');
    let result;
    try { result = fn(); db.run('COMMIT'); }
    catch (error) { try { db.run('ROLLBACK'); } catch {} throw error; }
    saveToDisk();
    return result;
  },
  findUserByEmail(email) {
    if (usePg) {
      return getPool().query('SELECT * FROM users WHERE email = $1', [email]).then(r => r.rows[0] || null);
    }
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    stmt.bind([email]);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free(); return null;
  },
  findUserById(id) {
    if (usePg) {
      return getPool().query('SELECT id, username, email, created_at FROM users WHERE id = $1', [id]).then(r => r.rows[0] || null);
    }
    const stmt = db.prepare('SELECT id, username, email, created_at FROM users WHERE id = ?');
    stmt.bind([id]);
    if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
    stmt.free(); return null;
  },
  emailExists(email) {
    if (usePg) {
      return getPool().query('SELECT 1 FROM users WHERE email = $1', [email]).then(r => r.rowCount > 0);
    }
    const res = db.exec('SELECT 1 FROM users WHERE email = ?', [email]);
    return res.length > 0 && res[0].values.length > 0;
  },
  usernameExists(username) {
    if (usePg) {
      return getPool().query('SELECT 1 FROM users WHERE username = $1', [username]).then(r => r.rowCount > 0);
    }
    const res = db.exec('SELECT 1 FROM users WHERE username = ?', [username]);
    return res.length > 0 && res[0].values.length > 0;
  },
  createUser({ username, email, password }) {
    if (usePg) {
      return getPool().query(
        'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
        [username, email, password]
      ).then(r => r.rows[0].id);
    }
    db.run('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', [username, email, password]);
    const res = db.exec('SELECT last_insert_rowid() as id');
    const id  = res[0].values[0][0];
    saveToDisk();
    return id;
  },
  profile(id) {
    if (usePg) {
      return getPool().query('SELECT notes FROM companion_profiles WHERE user_id = $1', [id]).then(r => r.rows[0]?.notes || '');
    }
    return db.exec('SELECT notes FROM companion_profiles WHERE user_id = ?', [id])[0]?.values[0][0] || '';
  },
  saveProfile(id, notes) {
    if (usePg) {
      return getPool().query(
        'INSERT INTO companion_profiles (user_id, notes) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET notes = EXCLUDED.notes',
        [id, notes]
      );
    }
    db.run('INSERT OR REPLACE INTO companion_profiles (user_id, notes) VALUES (?, ?)', [id, notes]);
    saveToDisk();
  },
  history(id) {
    if (usePg) {
      return getPool().query(
        'SELECT role, text, created_at FROM (SELECT * FROM companion_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 60) sub ORDER BY id',
        [id]
      ).then(r => r.rows.map(row => ({ role: row.role, text: row.text, created_at: row.created_at })));
    }
    const result = db.exec('SELECT role, text, created_at FROM (SELECT * FROM companion_messages WHERE user_id = ? ORDER BY id DESC LIMIT 60) ORDER BY id', [id]);
    return (result[0]?.values || []).map(([role, text, created_at]) => ({ role, text, created_at }));
  },
  addMessage(id, role, text) {
    if (usePg) {
      return getPool().query('INSERT INTO companion_messages (user_id, role, text) VALUES ($1, $2, $3)', [id, role, text]).then(() =>
        getPool().query(
          'DELETE FROM companion_messages WHERE user_id = $1 AND id NOT IN (SELECT id FROM companion_messages WHERE user_id = $1 ORDER BY id DESC LIMIT 60)',
          [id]
        )
      );
    }
    db.run('INSERT INTO companion_messages (user_id, role, text) VALUES (?, ?, ?)', [id, role, text]);
    db.run('DELETE FROM companion_messages WHERE user_id = ? AND id NOT IN (SELECT id FROM companion_messages WHERE user_id = ? ORDER BY id DESC LIMIT 60)', [id, id]);
    saveToDisk();
  },
  clearHistory(id) {
    if (usePg) {
      return getPool().query('DELETE FROM companion_messages WHERE user_id = $1', [id]);
    }
    db.run('DELETE FROM companion_messages WHERE user_id = ?', [id]);
    saveToDisk();
  },
  init,
  toPg,
  getPool
};
