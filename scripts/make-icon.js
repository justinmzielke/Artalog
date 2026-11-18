'use strict';

// Generates a placeholder app icon (desktop/build/icon.png). Replace with real artwork any time.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(path.resolve(__dirname, '..', 'desktop', 'node_modules', 'sharp'));

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1f1d1a"/>
  <text x="256" y="350" font-family="Georgia, 'Times New Roman', serif" font-size="300" font-weight="700"
        text-anchor="middle" fill="#f3ede2">A</text>
</svg>`;

const out = path.resolve(__dirname, '..', 'desktop', 'build');
fs.mkdirSync(out, { recursive: true });
sharp(Buffer.from(svg))
  .png()
  .toFile(path.join(out, 'icon.png'))
  .then(() => console.log('Wrote desktop/build/icon.png'));
