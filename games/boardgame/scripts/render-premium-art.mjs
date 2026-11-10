#!/usr/bin/env node
'use strict';

/*
 * Generic premium-art composition renderer.
 *
 *   node games/boardgame/scripts/render-premium-art.mjs \
 *     --slug dominion-premium --out games/assets/art/premium/dominion \
 *     --shots cover:1200x1200,og:1200x630,detail:1536x1024
 *
 * Serves the repo root over a local Node HTTP server, opens
 * /games/boardgame/<slug>/art-render.html?shot=<name> in headless Chrome,
 * writes PNG masters and WebP derivatives into --out.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i !== -1 ? args[i + 1] : fallback;
};
const slug = opt('slug');
const outDir = path.resolve(opt('out', path.join(REPO_ROOT, 'games/assets/art/premium', slug.replace('-premium', ''))));
const shots = (opt('shots', 'cover:1200x1200,og:1200x630,detail:1536x1024')).split(',').map((item) => {
  const [name, size] = item.split(':');
  const [w, h] = size.split('x').map(Number);
  return { name, width: w, height: h };
});
if (!slug) {
  console.error('usage: render-premium-art.mjs --slug <slug> [--out dir] [--shots cover:1200x1200,og:1200x630,detail:1536x1024]');
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.jpg': 'image/jpeg'
};
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(REPO_ROOT, '.' + rel);
    if (file !== REPO_ROOT && !file.startsWith(REPO_ROOT + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  } catch (err) { res.writeHead(500); res.end('error'); }
});

function run(chromeArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(CHROME, chromeArgs, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(label + ' exited ' + code))));
  });
}

(async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const shot of shots) {
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), slug + '-art-'));
      const png = path.join(outDir, shot.name + '.png');
      const url = origin + '/games/boardgame/' + slug + '/art-render.html?shot=' + shot.name;
      console.log('rendering ' + shot.name + ' ' + shot.width + 'x' + shot.height);
      try {
        await run([
          '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
          '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
          '--disable-extensions', '--force-device-scale-factor=1',
          '--run-all-compositor-stages-before-draw', '--virtual-time-budget=6000',
          '--window-size=' + shot.width + ',' + shot.height,
          '--user-data-dir=' + profile,
          '--screenshot=' + png, url
        ], shot.name);
      } finally {
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (err) {}
      }
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) throw new Error('screenshot missing or too small: ' + png);
      const webp = path.join(outDir, shot.name + '.webp');
      const convert = spawnSync('cwebp', ['-quiet', '-q', '88', png, '-o', webp], { stdio: 'inherit' });
      if (convert.status !== 0) throw new Error('cwebp failed for ' + shot.name);
      console.log('  ' + shot.name + '.png ' + Math.round(fs.statSync(png).size / 1024) + 'KB · webp ' +
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
