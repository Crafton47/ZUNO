const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let checked = 0;
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.agents', '.gravitas', 'artifacts', 'test-results', 'playwright-report'].includes(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (/\.(js|cjs)$/.test(file)) { execFileSync(process.execPath, ['--check', file]); checked++; }
    else if (/\.html$/.test(file)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (/\bsrc\s*=|application\/ld\+json/i.test(match[1])) continue;
        new vm.Script(match[2], { filename: path.relative(root, file) }); checked++;
      }
    }
  }
}
visit(root);
console.log(`Syntax checks passed for ${checked} JavaScript files/inline scripts. This is not TypeScript type checking.`);
