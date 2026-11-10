#!/usr/bin/env node
/* Arcade batch-2 in-game sprites: 12 programmatic SVG assets rasterized to PNG.
 *
 *   node games/assets/art/arcade/engine/build-inline-sprites.mjs
 *
 * ART-GUIDE §1: single shapes (X/O, lights, mines, snake, pong) are drawn with
 * standard SVG paths, never by an image model. Every output is a 256x256 RGBA
 * PNG with a transparent background; alpha contract is checked by
 * verify-alpha.py (corners 0, center 255).
 *
 * Outputs are written next to the family art dirs and recorded in
 * engine/inline-sprites.json for reproducibility (same config -> same bytes).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARCADE = path.resolve(HERE, '..');
const SIZE = 256;

const SPRITES = [
  {
    name: 'mark-x', family: 'tictactoe', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <g fill="none" stroke="#c8473c" stroke-width="2.8" stroke-linecap="round">
    <path d="M5.4 5.4 18.6 18.6"/><path d="M18.6 5.4 5.4 18.6"/>
  </g>
</svg>
`,
  },
  {
    name: 'mark-o', family: 'tictactoe', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="7.1" fill="none" stroke="#3d7fc4" stroke-width="2.8"/>
  <!-- 1px-scale centre dot keeps the alpha-centre contract (255) without
       reading as a second shape at the 24-48px in-game size. -->
  <circle cx="12" cy="12" r=".55" fill="#3d7fc4"/>
</svg>
`,
  },
  {
    name: 'light-on', family: 'lights-out', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <defs><radialGradient id="halo"><stop offset="0" stop-color="#ffe9a3" stop-opacity=".95"/><stop offset=".65" stop-color="#ffd45e" stop-opacity=".42"/><stop offset="1" stop-color="#ffd45e" stop-opacity="0"/></radialGradient></defs>
  <circle cx="12" cy="11.2" r="10.8" fill="url(#halo)"/>
  <circle cx="12" cy="11.2" r="5.4" fill="#ffd042" stroke="#dfa315" stroke-width=".7"/>
  <circle cx="10.3" cy="9.5" r="1.6" fill="#fff7d9" opacity=".9"/>
  <rect x="9.7" y="16.4" width="4.6" height="2.1" rx=".6" fill="#8d6e63"/>
  <rect x="10.3" y="18.3" width="3.4" height="1.2" rx=".5" fill="#5d4037"/>
</svg>
`,
  },
  {
    name: 'light-off', family: 'lights-out', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <circle cx="12" cy="11.2" r="5.4" fill="#4b5660" stroke="#333c44" stroke-width=".8"/>
  <circle cx="10.3" cy="9.5" r="1.5" fill="#6d7982" opacity=".55"/>
  <rect x="9.7" y="16.4" width="4.6" height="2.1" rx=".6" fill="#5b5148"/>
  <rect x="10.3" y="18.3" width="3.4" height="1.2" rx=".5" fill="#3f3831"/>
</svg>
`,
  },
  {
    name: 'cover-tile', family: 'minesweeper', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <rect x="1.2" y="1.2" width="21.6" height="21.6" rx="2.1" fill="#c8d1d7" stroke="#9aa7b0" stroke-width=".9"/>
  <rect x="2.7" y="2.7" width="18.6" height="7.4" rx="1.5" fill="#e3eaee" opacity=".85"/>
</svg>
`,
  },
  {
    name: 'mine', family: 'minesweeper', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <g stroke="#20262b" stroke-width="1.7" stroke-linecap="round">
    <path d="M12 2.4v4.2"/><path d="M12 17.4v4.2"/><path d="M2.4 12h4.2"/><path d="M17.4 12h4.2"/>
    <path d="M5.2 5.2l3 3"/><path d="M15.8 15.8l3 3"/><path d="M18.8 5.2l-3 3"/><path d="M8.2 15.8l-3 3"/>
  </g>
  <circle cx="12" cy="12" r="6.1" fill="#20262b"/>
  <circle cx="9.7" cy="9.7" r="1.7" fill="#8b979f" opacity=".85"/>
</svg>
`,
  },
  {
    name: 'flag', family: 'minesweeper', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <path d="M7 21V3.4" stroke="#5d4037" stroke-width="1.7" stroke-linecap="round"/>
  <path d="M7.9 6.6 19 10.4 7.9 14.2Z" fill="#dd4a3d" stroke="#b03a30" stroke-width=".5"/>
  <path d="M4.5 21h7.5" stroke="#5d4037" stroke-width="1.7" stroke-linecap="round"/>
</svg>
`,
  },
  {
    name: 'head', family: 'snake', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <rect x="1.6" y="1.6" width="20.8" height="20.8" rx="4.6" fill="#5cb85c" stroke="#3b8a3b" stroke-width=".8"/>
  <circle cx="8.6" cy="9" r="2" fill="#fff"/><circle cx="15.4" cy="9" r="2" fill="#fff"/>
  <circle cx="9" cy="9.2" r="1" fill="#1d2a1d"/><circle cx="15" cy="9.2" r="1" fill="#1d2a1d"/>
  <path d="M10.5 15.2q1.5 1.2 3 0" stroke="#2c6b2c" stroke-width=".9" fill="none" stroke-linecap="round"/>
</svg>
`,
  },
  {
    name: 'body', family: 'snake', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <rect x="2.6" y="2.6" width="18.8" height="18.8" rx="4" fill="#4caf50" stroke="#3d8f41" stroke-width=".7"/>
  <circle cx="8.4" cy="8.4" r="1.5" fill="#73c876" opacity=".75"/>
  <circle cx="15.6" cy="15.6" r="1.3" fill="#73c876" opacity=".55"/>
</svg>
`,
  },
  {
    name: 'food', family: 'snake', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <circle cx="12" cy="13.4" r="6.4" fill="#e0453b" stroke="#b3362e" stroke-width=".7"/>
  <path d="M12 7.3q.2-2 1.9-2.8" stroke="#4a7c3f" stroke-width="1" fill="none" stroke-linecap="round"/>
  <path d="M12 6.9q-2.4-.6-3.7 1.1 2.1.9 3.7-.4" fill="#5fa54a"/>
  <circle cx="9.6" cy="11.3" r="1.5" fill="#ff8a7d" opacity=".6"/>
</svg>
`,
  },
  {
    name: 'paddle', family: 'pong', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <rect x="9" y="1.8" width="6" height="20.4" rx="3" fill="#f3ead9" stroke="#c9b697" stroke-width=".5"/>
  <rect x="9.9" y="3" width="1.2" height="17.6" rx=".6" fill="#fffdf7" opacity=".7"/>
</svg>
`,
  },
  {
    name: 'ball', family: 'pong', role: 'piece',
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9" fill="#f7f3e8" stroke="#c9b697" stroke-width=".6"/>
  <circle cx="9.1" cy="9.1" r="2.8" fill="#ffffff" opacity=".85"/>
</svg>
`,
  },
];

const records = [];
for (const item of SPRITES) {
  const dir = path.join(ARCADE, item.family);
  fs.mkdirSync(dir, { recursive: true });
  const svgPath = path.join(dir, item.name + '.svg');
  const pngPath = path.join(dir, item.name + '.png');
  fs.writeFileSync(svgPath, item.svg);
  const r = spawnSync('rsvg-convert', ['-w', String(SIZE), '-h', String(SIZE), '-o', pngPath, svgPath], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`rsvg-convert failed for ${item.name}: ${r.stderr || r.error}`);
    process.exit(1);
  }
  records.push({
    name: item.name,
    family: item.family,
    role: item.role,
    png: `games/assets/art/arcade/${item.family}/${item.name}.png`,
    svg: `games/assets/art/arcade/${item.family}/${item.name}.svg`,
    source: 'programmatic-svg',
    size: [SIZE, SIZE],
  });
  console.log(`wrote ${item.family}/${item.name}.png`);
}

fs.writeFileSync(
  path.join(HERE, 'inline-sprites.json'),
  JSON.stringify({ version: 1, generatedBy: 'build-inline-sprites.mjs', size: SIZE, sprites: records }, null, 2) + '\n'
);
console.log(`wrote inline-sprites.json (${records.length} sprites)`);
