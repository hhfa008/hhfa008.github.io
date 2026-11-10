#!/usr/bin/env node
'use strict';

/*
 * Compose Coup premium cover / OG / detail images from local img-gen
 * single-object assets. The 15-card tableau and six seats are drawn by
 * art-render.html (code), never by the image model.
 *
 *   node games/boardgame/coup-premium/render-art.mjs
 *
 * Outputs (PNG masters + WebP used by the page):
 *   assets/cover.png|webp       1200x1200
 *   assets/og.png|webp          1200x630
 *   assets/detail-1.png|webp    1200x800  challenge tableau
 *   assets/detail-2.png|webp    1200x800  six-seat table
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(HERE, 'assets');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = [
  { shot: 'cover', file: 'cover', width: 1200, height: 1200, quality: 88 },
  { shot: 'og', file: 'og', width: 1200, height: 630, quality: 88 },
  { shot: 'detail1', file: 'detail-1', width: 1200, height: 800, quality: 86 },
  { shot: 'detail2', file: 'detail-2', width: 1200, height: 800, quality: 86 }
];
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
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
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
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'coup-art-'));
      const png = path.join(OUT_DIR, item.file + '.png');
      const url = origin + '/boardgame/coup-premium/art-render.html?shot=' + item.shot;
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
          '--virtual-time-budget=6000',
          '--window-size=' + item.width + ',' + item.height,
          '--user-data-dir=' + profile,
          '--screenshot=' + png,
          url
        ], item.file);
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) {}
      }
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) {
        throw new Error('screenshot missing or too small: ' + png);
      }
      const webp = path.join(OUT_DIR, item.file + '.webp');
      const convert = spawnSync('cwebp', ['-quiet', '-q', String(item.quality), png, '-o', webp], { stdio: 'inherit' });
      if (convert.status !== 0) throw new Error('cwebp failed for ' + item.file);
      const pngSize = fs.statSync(png).size;
      const webpSize = fs.statSync(webp).size;
      console.log('  ' + item.file + '.png ' + Math.round(pngSize / 1024) + 'KB · webp ' + Math.round(webpSize / 1024) + 'KB');
    }
    console.log('done');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
