// Local-only scan. Reports locations/rule names, never matched values.
// Pattern scanning is a release aid, not proof that every possible secret is absent.
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const git = args => execFileSync('git', args, { maxBuffer: 64 * 1024 * 1024 });
const rules = [
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/g],
  ['provider-token', /\b(?:nvapi-|sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{20,}/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['jwt-token', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,}/g],
];
// Compare private local configuration values too, without disclosing them or uploading files.
const privateValues = [];
for (const file of ['.env', 'deploy/.env']) {
  if (!fs.existsSync(file)) continue;
  for (const [name, value] of Object.entries(require('dotenv').parse(fs.readFileSync(file)))) {
    if (/(SECRET|PASSWORD|KEY|TOKEN)/.test(name) && value.length >= 12 && !/^(replace|your_|test|simulated)/i.test(value)) privateValues.push(value);
  }
}
const findings = [];
let scanned = 0;
function scan(buffer, location) {
  scanned++;
  const text = buffer.toString('utf8');
  for (const [rule, pattern] of rules) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) findings.push({ location, rule });
  }
  if (privateValues.some(value => text.includes(value))) findings.push({ location, rule: 'local-config-secret' });
}
const files = git(['ls-files', '-c', '-o', '--exclude-standard', '-z']).toString().split('\0').filter(Boolean);
for (const file of new Set(files)) if (fs.existsSync(file) && fs.statSync(file).isFile()) scan(fs.readFileSync(file), file);
const history = process.argv.includes('--history');
let blobs = 0;
if (history) {
  const objects = git(['rev-list', '--objects', '--all']).toString().trim().split('\n').filter(Boolean);
  for (const entry of objects) {
    const [oid, ...names] = entry.split(' ');
    if (git(['cat-file', '-t', oid]).toString().trim() !== 'blob') continue;
    scan(git(['cat-file', 'blob', oid]), `history:${oid.slice(0, 12)}:${names.join(' ')}`);
    blobs++;
  }
}
console.log(JSON.stringify({ scanned, historyBlobs: blobs, findings, limitations: 'Known patterns and exact local-config comparisons; excludes ignored runtime/private data. No entropy or semantic detection.' }, null, 2));
process.exitCode = findings.length ? 1 : 0;
