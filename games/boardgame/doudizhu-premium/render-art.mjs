#!/usr/bin/env node
'use strict';

/*
 * Compose Dou Dizhu cover / OG / detail images from local img-gen materials.
 * The 54 card faces, pips, suits and Chinese glyphs are drawn by code in
 * art-render.html; the image model only produced blank paper, card back,
 * table felt and chip materials.
 *
 *   node games/boardgame/doudizhu-premium/render-art.mjs
 *
 * Outputs (PNG masters + WebP used by the pages):
 *   assets/cover.png|webp       1200x1200
 *   assets/og.png|webp          1200x630
 *   assets/detail-1.png|webp    1200x800  full 17/17/17+3 deal
 *   assets/detail-2.png|webp    1200x800  14 hand types + materials
 *
 * Before any screenshot the script re-deals with the same seed and rejects the
 * run (exit 3, zero files) if the composition is not a complete legal deal.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(HERE, 'assets');
const PROFILE_ROOT = path.join(GAMES_ROOT, '.tmp');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEED = 20261110;
const E = require(path.join(HERE, 'engine.js'));

const SHOTS = [
  { shot: 'cover', file: 'cover', width: 1200, height: 1200, quality: 88 },
  { shot: 'og', file: 'og', width: 1200, height: 630, quality: 88 },
  { shot: 'detail1', file: 'detail-1', width: 1200, height: 800, quality: 86 },
  { shot: 'detail2', file: 'detail-2', width: 1200, height: 800, quality: 86 }
];
const TYPE_AUDIT = [
  ['single', ['S9']], ['pair', ['H12', 'C12']], ['triple', ['S7', 'H7', 'D7']],
  ['triple_single', ['S7', 'H7', 'D7', 'S4']], ['triple_pair', ['S7', 'H7', 'D7', 'S9', 'H9']],
  ['straight', ['S3', 'H4', 'C5', 'S6', 'H7']],
  ['straight_pair', ['S3', 'H3', 'S4', 'H4', 'S5', 'H5']],
  ['plane', ['S3', 'H3', 'C3', 'S4', 'H4', 'C4']],
  ['plane_single', ['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H6']],
  ['plane_pair', ['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H5', 'S6', 'H6']],
  ['four_two_single', ['S8', 'H8', 'C8', 'D8', 'S3', 'H5']],
  ['four_two_pair', ['S8', 'H8', 'C8', 'D8', 'S3', 'H3', 'S5', 'H5']],
  ['bomb', ['S9', 'H9', 'C9', 'D9']], ['rocket', ['SJ', 'BJ']]
];

function auditDeal() {
  const deck = E.makeDeck();
  const dealt = E.deal(SEED);
  const counts = dealt.hands.map((h) => h.length);
  const total = counts.reduce((a, b) => a + b, 0) + dealt.bottom.length;
  const landlord = counts[0] + dealt.bottom.length;
  const ids = {};
  dealt.hands.forEach((h) => h.forEach((c) => { ids[c.id] = (ids[c.id] || 0) + 1; }));
  dealt.bottom.forEach((c) => { ids[c.id] = (ids[c.id] || 0) + 1; });
  const unique = Object.keys(ids).length;
  const dup = Object.keys(ids).filter((id) => ids[id] !== 1);
  const bad = [];
  if (deck.length !== 54) bad.push('deck=' + deck.length);
  if (counts.join(',') !== '17,17,17') bad.push('hands=' + counts.join(','));
  if (dealt.bottom.length !== 3) bad.push('bottom=' + dealt.bottom.length);
  if (total !== 54) bad.push('total=' + total);
  if (landlord !== 20) bad.push('landlord=' + landlord);
  if (unique !== 54) bad.push('unique=' + unique);
  if (dup.length) bad.push('duplicates=' + dup.join(','));
  const byId = {};
  deck.forEach((c) => { byId[c.id] = c; });
  TYPE_AUDIT.forEach(([type, list]) => {
    const d = E.detect(list.map((id) => byId[id]));
    if (!d || d.type !== type) bad.push('type ' + type + ' -> ' + (d && d.type));
  });
  if (bad.length) {
    console.error('REALISM FAIL: ' + bad.join(' · '));
    process.exit(3);
  }
  return { deck: deck.length, counts, bottom: dealt.bottom.length, landlord, total, unique };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROFILE_ROOT, { recursive: true });
const audit = auditDeal();
console.log('realism audit ok: 54 cards · ' + audit.counts.join('/') + ' + ' + audit.bottom +
  ' · landlord ' + audit.landlord);

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

function run(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(label + ' exited ' + code));
    });
  });
}

(async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  console.log('serving ' + GAMES_ROOT);
  console.log('origin ' + origin);
  try {
    for (const item of SHOTS) {
      const profile = path.join(PROFILE_ROOT, 'ddz-art-' + process.pid + '-' + item.shot);
      fs.rmSync(profile, { recursive: true, force: true });
      const png = path.join(OUT_DIR, item.file + '.png');
      const url = origin + '/boardgame/doudizhu-premium/art-render.html?shot=' + item.shot + '&seed=' + SEED;
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
          '--virtual-time-budget=5000',
          '--window-size=' + item.width + ',' + item.height,
          '--user-data-dir=' + profile,
          '--screenshot=' + png,
          url
        ], item.file);
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) { /* ignore */ }
      }
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
        throw new Error('screenshot missing or too small: ' + png);
      }
      const webp = path.join(OUT_DIR, item.file + '.webp');
      const convert = spawnSync('cwebp', ['-quiet', '-q', String(item.quality), png, '-o', webp], { stdio: 'inherit' });
      if (convert.status !== 0) throw new Error('cwebp failed for ' + item.file);
      console.log('  ' + item.file + '.png ' + Math.round(fs.statSync(png).size / 1024) + 'KB · webp ' +
        Math.round(fs.statSync(webp).size / 1024) + 'KB');
    }
    console.log('done');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
