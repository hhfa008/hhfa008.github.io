#!/usr/bin/env node
'use strict';

/*
 * Backgammon premium — thin wrapper around the repo-wide premium art renderer.
 *
 *   node games/boardgame/backgammon-premium/render-art.mjs
 *
 * Serves the repo, renders art-render.html?shot=cover|og|detail1|detail2 in
 * headless Chrome, writes PNG masters then WebP derivatives, and finally
 * deletes the PNG masters so only WebP ships.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const RENDERER = path.join(REPO_ROOT, 'games', 'boardgame', 'scripts', 'render-premium-art.mjs');
const OUT = path.join(HERE, 'assets');
const SHOTS = 'cover:1200x1200,og:1200x630,detail-1:1200x800,detail-2:1200x800';

if (!fs.existsSync(RENDERER)) {
  console.error('shared premium renderer not found: ' + RENDERER);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const run = spawnSync(process.execPath, [
  RENDERER,
  '--slug', 'backgammon-premium',
  '--out', OUT,
  '--shots', SHOTS
], { stdio: 'inherit' });

if (run.status !== 0) {
  console.error('art render failed with exit ' + run.status);
  process.exit(run.status || 1);
}

let total = 0;
['cover', 'og', 'detail-1', 'detail-2'].forEach(function (name) {
  const webp = path.join(OUT, name + '.webp');
  const png = path.join(OUT, name + '.png');
  if (fs.existsSync(webp)) {
    const bytes = fs.statSync(webp).size;
    total += bytes;
    console.log(name + '.webp ' + bytes + ' bytes');
  } else {
    console.error('missing ' + webp);
    process.exitCode = 1;
  }
  if (fs.existsSync(png)) fs.rmSync(png, { force: true });
});
console.log('total shipped art ' + total + ' bytes');
