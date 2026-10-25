// Creates local service secrets once; never logs key values or overwrites existing secrets.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');
const env = dotenv.parse(fs.readFileSync(envPath));
const servicePath = path.join(root, 'deploy', '.env');
const service = fs.existsSync(servicePath) ? dotenv.parse(fs.readFileSync(servicePath)) : {};
for (const key of ['OPEN_NOTEBOOK_PASSWORD', 'OPEN_NOTEBOOK_ENCRYPTION_KEY', 'SURREAL_PASSWORD']) service[key] ||= crypto.randomBytes(32).toString('hex');
for (const key of ['NVIDIA_API_KEY', 'GEMINI_API_KEY']) if (env[key]) service[key] = env[key];
fs.writeFileSync(servicePath, Object.entries(service).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join('\n') + '\n', { mode: 0o600 });
const additions = { OPEN_NOTEBOOK_URL: 'http://127.0.0.1:5055', OPEN_NOTEBOOK_PASSWORD: service.OPEN_NOTEBOOK_PASSWORD, STUDY_ENABLED: 'true' };
// Only auto-select when the existing database contains exactly one account.
(async () => {
  const SQL = await require('sql.js')();
  const dbPath = env.DB_PATH || path.join(root, 'vibeai.db');
  if (!env.STUDY_OWNER_ID && fs.existsSync(dbPath)) {
    const db = new SQL.Database(fs.readFileSync(dbPath));
    const ids = db.exec('SELECT id FROM users')[0]?.values || [];
    if (ids.length === 1) additions.STUDY_OWNER_ID = String(ids[0][0]);
    else console.log('Set STUDY_OWNER_ID in .env to your account ID. Multiple/no accounts: access remains disabled.');
    db.close();
  }
  const lines = Object.entries(additions).filter(([k]) => !env[k]).map(([k,v]) => `${k}=${JSON.stringify(v)}`);
  if (lines.length) fs.appendFileSync(envPath, '\n# Local Study Studio\n' + lines.join('\n') + '\n');
  console.log('Local service configuration saved. Secrets were not printed. Start: docker compose -f deploy/compose.yml --env-file deploy/.env up -d');
})().catch(() => { console.error('Could not inspect local database. Configure STUDY_OWNER_ID manually.'); process.exitCode = 1; });
