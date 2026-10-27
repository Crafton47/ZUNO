'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'site-dist');
fs.mkdirSync(output, { recursive: true });
// Only browser files become public. Backend code, environment and SQLite stay out.
for (const file of ['index.html', 'login.html', 'register.html', 'study.html', 'legacy.html']) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, 'public'), path.join(output, 'assets'), { recursive: true });
console.log('Vercel static output prepared; APIs are built separately from api/.');
