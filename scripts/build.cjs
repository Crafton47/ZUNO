// The app runs source directly. Assemble a reproducible, credential-free runtime
// directory for review/deployment; never copy the working tree wholesale.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist');
if (fs.existsSync(destination)) {
  if (fs.lstatSync(destination).isSymbolicLink() || path.dirname(fs.realpathSync(destination)) !== fs.realpathSync(root) || !fs.existsSync(path.join(destination, '.zuno-build'))) {
    throw new Error('Refusing to replace an unrecognized dist directory. Preserve it before building.');
  }
  fs.rmSync(destination, { recursive: true });
}
fs.mkdirSync(destination);
fs.writeFileSync(path.join(destination, '.zuno-build'), 'Generated runtime assembly; safe to regenerate.\n');
const runtime = ['server.js', 'security.js', 'database.js', 'companion.js', 'chat-provider.js', 'scheduler.js', 'study.js', 'exam-rescue.js', 'exam-engine.js', 'radio.js', 'youtube-metadata.js', 'index.html', 'login.html', 'register.html', 'legacy.html', 'study.html', 'package.json', 'package-lock.json', '.env.example', 'public', 'third-party'];
for (const file of runtime) fs.cpSync(path.join(root, file), path.join(destination, file), { recursive: true });
console.log(`Runtime assembly complete: dist/ (${runtime.length} allowlisted entries; no environment secrets or databases). Install with npm ci --omit=dev, configure your own .env, then npm start.`);
