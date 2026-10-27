'use strict';
const { Pool } = require('pg');
require('dotenv').config();

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const token = process.env.OPEN_NOTEBOOK_PASSWORD;
  const res = await fetch('http://127.0.0.1:5055/api/sources/source:cjre8ylldciau0rt0rwo', {
    headers: { Authorization: 'Bearer ' + token }
  });
  if (!res.ok) {
    console.error('Failed to fetch from local Open Notebook:', res.status);
    await pool.end();
    return;
  }
  const data = await res.json();
  console.log('Fetched local source:', data.title, 'Length:', data.full_text?.length);
  await pool.query('UPDATE study_items SET content = $1, status = $2 WHERE id = $3', [
    data.full_text || '',
    'completed',
    '06aabacf-621a-42f7-9612-a75dd87d850d'
  ]);
  const check = await pool.query('SELECT id, title, length(content) as len, status FROM study_items WHERE id = $1', [
    '06aabacf-621a-42f7-9612-a75dd87d850d'
  ]);
  console.log('Supabase updated row:', check.rows[0]);
  await pool.end();
}

run().catch(console.error);
