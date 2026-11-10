#!/usr/bin/env node
'use strict';

/*
 * Connect 4 / 四子棋 premium — art composition wrapper.
 *
 * The actual composition lives in art-render.html; rendering is delegated to
 * the shared premium renderer (one Chrome screenshot + cwebp per shot). This
 * wrapper only normalises the shot filenames to the shipped names and removes
 * the PNG masters, because only WebP ships.
 *
 *   node games/boardgame/connect4-premium/render-art.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const OUT = path.join(HERE, 'assets');
const RENDERER = path.join(REPO_ROOT, 'games', 'boardgame', 'scripts', 'render-premium-art.mjs');

const result = spawnSync(process.execPath, [
  RENDERER,
  '--slug', 'connect4-premium',
  '--out', OUT,
  '--shots', 'cover:1200x1200,og:1200x630,detail1:1200x800,detail2:1200x800'
], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status == null ? 1 : result.status);

// The shared renderer names shots after the URL; the site ships detail-1/detail-2.
for (const pair of [['detail1.webp', 'detail-1.webp'], ['detail2.webp', 'detail-2.webp']]) {
  const from = path.join(OUT, pair[0]);
  const to = path.join(OUT, pair[1]);
  if (fs.existsSync(from)) fs.renameSync(from, to);
}
for (const name of ['cover.png', 'og.png', 'detail1.png', 'detail2.png']) {
  const file = path.join(OUT, name);
  if (fs.existsSync(file)) fs.rmSync(file);
}
console.log('done — WebP only in ' + OUT);
