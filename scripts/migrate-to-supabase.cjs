'use strict';
require('dotenv').config();
const fs = require('fs');
const initSqlJs = require('sql.js');
const { Pool } = require('pg');

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || connectionString.includes('[YOUR-PASSWORD]')) {
    console.error('ERROR: DATABASE_URL in .env is missing or contains the [YOUR-PASSWORD] placeholder.');
    console.error('Set your actual Supabase database password in .env:');
    console.error('DATABASE_URL=postgresql://postgres:<password>@db.ibpnvzlbnbdnyeckqoki.supabase.co:5432/postgres');
    process.exit(1);
  }

  console.log('[1/4] Connecting to Supabase PostgreSQL...');
  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });

  const client = await pool.connect();
  console.log('✓ Connected to Supabase successfully.');

  try {
    console.log('[2/4] Creating PostgreSQL tables matching ZUNO schema...');
    await client.query('BEGIN');

    // 1. users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. companion_profiles
    await client.query(`
      CREATE TABLE IF NOT EXISTS companion_profiles (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        notes TEXT NOT NULL DEFAULT ''
      );
    `);

    // 3. companion_messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS companion_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. schedule_tasks
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_tasks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        due_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT,
        reward TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_schedule_owner_due ON schedule_tasks(user_id, due_at);
    `);

    // 5. schedule_actions
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_actions (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        action_id TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY(user_id, action_id)
      );
    `);

    // 6. schedule_reminders
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_reminders (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reminder_id TEXT NOT NULL,
        PRIMARY KEY(user_id, reminder_id)
      );
    `);

    // 7. study_notebooks
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_notebooks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        remote_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        opened_at TEXT NOT NULL
      );
    `);

    // 8. study_items
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_items (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        remote_id TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL
      );
    `);

    // 9. study_tasks
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_tasks (
        task_id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    // 10. study_messages
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_messages (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        citations TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 11. study_flashcards
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_flashcards (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        front TEXT NOT NULL,
        back TEXT NOT NULL,
        difficulty TEXT NOT NULL DEFAULT 'new',
        reviewed_at TEXT,
        created_at TEXT NOT NULL
      );
    `);

    // 12. study_xp
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_xp (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notebook_id TEXT NOT NULL,
        event TEXT NOT NULL,
        earned INTEGER NOT NULL,
        earned_at TEXT NOT NULL
      );
    `);

    // 13. study_feedback
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_feedback (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        helpful INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 14. exam_plans
    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_plans (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notebook_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);

    // 15. exam_previews
    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_previews (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        notebook_id TEXT NOT NULL,
        expires BIGINT NOT NULL,
        data TEXT NOT NULL
      );
    `);

    // 16. exam_task_links
    await client.query(`
      CREATE TABLE IF NOT EXISTS exam_task_links (
        task_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(plan_id, block_id)
      );
    `);

    // 17. study_quiz_results
    await client.query(`
      CREATE TABLE IF NOT EXISTS study_quiz_results (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        topic TEXT NOT NULL,
        score INTEGER NOT NULL,
        total INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // 18. radio_playlists
    await client.query(`
      CREATE TABLE IF NOT EXISTS radio_playlists (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        youtube_id TEXT NOT NULL,
        label TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        custom_label TEXT,
        metadata_json TEXT,
        metadata_status TEXT NOT NULL DEFAULT 'unchecked',
        metadata_checked_at TEXT,
        UNIQUE(user_id, youtube_id)
      );
    `);

    // 19. radio_playlist_tracks
    await client.query(`
      CREATE TABLE IF NOT EXISTS radio_playlist_tracks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        playlist_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        PRIMARY KEY(user_id, playlist_id)
      );
    `);

    await client.query('COMMIT');
    console.log('✓ All 19 PostgreSQL tables created/verified.');

    // [3/4] Exporting data from local SQLite
    console.log('[3/4] Reading data from local vibeai.db...');
    if (!fs.existsSync('vibeai.db')) {
      console.log('No local vibeai.db found. Skipping row migration.');
      return;
    }

    const SQL = await initSqlJs();
    const sdb = new SQL.Database(fs.readFileSync('vibeai.db'));

    const tables = [
      'users',
      'companion_profiles',
      'companion_messages',
      'schedule_tasks',
      'schedule_actions',
      'schedule_reminders',
      'study_notebooks',
      'study_items',
      'study_tasks',
      'study_messages',
      'study_flashcards',
      'study_xp',
      'study_feedback',
      'exam_plans',
      'exam_previews',
      'exam_task_links',
      'study_quiz_results',
      'radio_playlists',
      'radio_playlist_tracks'
    ];

    let totalMigrated = 0;
    for (const t of tables) {
      const res = sdb.exec(`SELECT * FROM "${t}"`);
      if (!res.length || !res[0].values.length) continue;
      const cols = res[0].columns;
      const rows = res[0].values;
      console.log(`Migrating ${rows.length} rows for table: ${t}...`);

      for (const row of rows) {
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
        const colList = cols.map(c => `"${c}"`).join(', ');
        const query = `INSERT INTO "${t}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`;
        await client.query(query, row);
        totalMigrated++;
      }
    }

    // Reset sequences for auto-increment tables
    await client.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));`);
    await client.query(`SELECT setval('companion_messages_id_seq', COALESCE((SELECT MAX(id) FROM companion_messages), 1));`);

    console.log(`✓ Migration complete! ${totalMigrated} rows migrated successfully.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(e => {
  console.error(e);
  process.exit(1);
});

