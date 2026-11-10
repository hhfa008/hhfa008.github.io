#!/usr/bin/env node
'use strict';

/*
 * Render the four 2048 art images from the real, replayed position.
 *
 *   node games/2048/assets/render-art.mjs
 *
 * Pipeline:
 *   1. realism.mjs replays state.json; exit 3 means no rendering at all.
 *   2. art-render.html composes the scene in code (grid, 3D perspective,
 *      numbers with system fonts, contact shadows). The FLUX materials are
 *      blank tiles and a walnut table only; the model never draws text.
 *   3. Headless Chrome screenshots four exact sizes.
 *   4. cwebp makes the served WebP; it degrades q90 -> q60 only if the
 *      ART-GUIDE section 9 budget is exceeded, and prints actual bytes.
 *
 * Outputs (PNG master + WebP):
 *   assets/cover.png|webp    1024x1024  <= 300KB WebP
 *   assets/og.png|webp       1200x630   <= 200KB WebP
 *   assets/detail.png|webp   1200x800   <= 300KB WebP
 *   assets/card.png|webp     480x320    <=  60KB WebP
 */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = HERE;
const STATE = path.join(HERE, 'state.json');
const REALISM = path.join(HERE, 'realism.mjs');
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const SHOTS = [
  { shot: 'cover', file: 'cover', width: 1024, height: 1024, budgetKB: 300, quality: 90 },
  { shot: 'og', file: 'og', width: 1200, height: 630, budgetKB: 200, quality: 90 },
  { shot: 'detail', file: 'detail', width: 1200, height: 800, budgetKB: 300, quality: 90 },
  { shot: 'card', file: 'card', width: 480, height: 320, budgetKB: 60, quality: 90 }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG: ' + file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function run(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(label + ' exited ' + code + (stderr ? '\n' + stderr : '')));
    });
  });
}

function webpWithBudget(png, webp, startQuality, budgetKB) {
  const budget = budgetKB * 1024;
  for (let q = startQuality; q >= 60; q -= 10) {
    const res = spawnSync('cwebp', ['-quiet', '-q', String(q), png, '-o', webp], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error('cwebp failed for ' + png);
    const bytes = fs.statSync(webp).size;
    if (bytes <= budget) return { quality: q, bytes };
    console.log('  q' + q + ' ' + (bytes / 1024).toFixed(1) + 'KB > ' + budgetKB + 'KB, retrying');
  }
  const bytes = fs.statSync(webp).size;
  throw new Error(path.basename(webp) + ' is ' + (bytes / 1024).toFixed(1) +
    'KB after q60, budget ' + budgetKB + 'KB');
}

(async function main() {
  // Gate first: a rejected position must not produce or overwrite images.
  const gate = spawnSync(process.execPath, [REALISM, STATE], { stdio: 'inherit' });
  if (gate.status !== 0) {
    console.error('REALISM FAIL: refusing to render; no image files written');
    process.exit(gate.status || 3);
  }

  if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
  const missing = [
    'tile-ivory-cut.png', 'tile-clay-cut.png', 'tile-gold-cut.png', 'table-walnut.png'
  ].filter((f) => !fs.existsSync(path.join(GAMES_ROOT, 'assets', 'art', '2048', 'materials', f)));
  if (missing.length) throw new Error('missing materials: ' + missing.join(', '));

  for (const item of SHOTS) {
    for (const ext of ['png', 'webp']) {
      const file = path.join(OUT_DIR, item.file + '.' + ext);
      try { fs.rmSync(file); } catch (err) { /* absent */ }
    }
  }

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const file = path.resolve(GAMES_ROOT, '.' + rel);
      if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {
          'content-type': MIME[path.extname(file)] || 'application/octet-stream',
          'cache-control': 'no-store'
        });
        res.end(data);
      });
    } catch (err) {
      res.writeHead(500); res.end('error');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log('serving ' + GAMES_ROOT);
  console.log('origin ' + origin);

  try {
    for (const item of SHOTS) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), '2048-art-'));
      const png = path.join(OUT_DIR, item.file + '.png');
      const page = origin + '/2048/assets/art-render.html?shot=' + item.shot;
      console.log('rendering ' + item.file + ' ' + item.width + 'x' + item.height);
      try {
        await run([
          '--headless=new',
          '--disable-gpu',
          '--hide-scrollbars',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-networking',
          '--disable-sync',
          '--disable-extensions',
          '--force-device-scale-factor=1',
          '--run-all-compositor-stages-before-draw',
          '--virtual-time-budget=7000',
          '--window-size=' + item.width + ',' + item.height,
          '--user-data-dir=' + profile,
          '--screenshot=' + png,
          page
        ], item.file);
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* best effort */ }
      }
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
        throw new Error('screenshot missing or too small: ' + png);
      }
      const dims = pngSize(png);
      if (dims.width !== item.width || dims.height !== item.height) {
        throw new Error(item.file + ' dimensions ' + dims.width + 'x' + dims.height +
          ', expected ' + item.width + 'x' + item.height);
      }
      const webp = path.join(OUT_DIR, item.file + '.webp');
      const result = webpWithBudget(png, webp, item.quality, item.budgetKB);
      console.log('  ' + item.file + '.png ' + (fs.statSync(png).size / 1024).toFixed(1) +
        'KB · webp q' + result.quality + ' ' + (result.bytes / 1024).toFixed(1) +
        'KB / ' + item.budgetKB + 'KB');
    }
    console.log('done');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
