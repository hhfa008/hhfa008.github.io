#!/usr/bin/env node
'use strict';

/*
 * Thin wrapper around the shared premium-art renderer.
 *
 *   node games/boardgame/chess-premium/render-art.mjs
 *
 * The shared renderer serves the repo, opens art-render.html?shot=<name> in
 * headless Chrome and writes PNG + WebP. This wrapper only pins the slug,
 * output directory and the four required sizes.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const script = path.join(REPO, 'games', 'boardgame', 'scripts', 'render-premium-art.mjs');
const out = path.join(HERE, 'assets');
const args = [
  script,
  '--slug', 'chess-premium',
  '--out', out,
  '--shots', 'cover:1200x1200,og:1200x630,detail1:1200x800,detail2:1200x800'
];

const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('error', (err) => { console.error(err); process.exit(1); });
child.on('close', (code) => { process.exit(code || 0); });
