'use strict';

// Builds the frontend and backend and copies them into desktop/ so Electron can package them.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const run = (command, cwd) => execSync(command, { cwd, stdio: 'inherit' });

run('npm run build', path.join(root, 'frontend'));
fs.rmSync(path.join(root, 'backend', 'dist'), { recursive: true, force: true });
run('npm run build', path.join(root, 'backend'));

const copies = [
  [path.join(root, 'frontend', 'dist'), path.join(root, 'desktop', 'frontend')],
  [path.join(root, 'backend', 'dist'), path.join(root, 'desktop', 'server')],
];
for (const [from, to] of copies) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
}
console.log('Staged frontend and backend into desktop/.');
