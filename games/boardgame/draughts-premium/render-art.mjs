#!/usr/bin/env node
'use strict';

/*
 * Compose the International Draughts cover / OG / detail images from the local material
 * photographs and a code-drawn 32-piece opening board.
 *
 *   node games/boardgame/draughts-premium/render-art.mjs
 *
 * Outputs PNG masters and WebP files under assets/:
 *   cover 1200x1200, og 1200x630, detail-1 1200x800, detail-2 1200x800
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

var HERE = path.dirname(fileURLToPath(import.meta.url));
var GAMES_ROOT = path.resolve(HERE, '..', '..');
var OUT_DIR = path.join(HERE, 'assets');
var PROFILE_ROOT = path.join(GAMES_ROOT, '..', '.tmp', 'art-profile-draughts');
var CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
var SHOTS = [
  { shot: 'cover', file: 'cover', width: 1200, height: 1200, quality: 88 },
  { shot: 'og', file: 'og', width: 1200, height: 630, quality: 88 },
  { shot: 'detail1', file: 'detail-1', width: 1200, height: 800, quality: 86 },
  { shot: 'detail2', file: 'detail-2', width: 1200, height: 800, quality: 86 }
];
var MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.json': 'application/json'
};

fs.mkdirSync(OUT_DIR, { recursive: true });

var server = http.createServer(function (req, res) {
  try {
    var url = new URL(req.url, 'http://localhost');
    var rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    var file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, function (err, data) {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  } catch (err) { res.writeHead(500); res.end('error'); }
});

function run(args, label) {
  return new Promise(function (resolve, reject) {
    var child = spawn(CHROME, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', function (code) {
      if (code === 0) resolve(); else reject(new Error(label + ' exited ' + code));
    });
  });
}

(async function main() {
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var origin = 'http://127.0.0.1:' + server.address().port;
  console.log('serving ' + GAMES_ROOT);
  try {
    for (var i = 0; i < SHOTS.length; i++) {
      var item = SHOTS[i];
      var profile = path.join(PROFILE_ROOT, item.file);
      fs.rmSync(profile, { recursive: true, force: true });
      fs.mkdirSync(profile, { recursive: true });
      var png = path.join(OUT_DIR, item.file + '.png');
      var url = origin + '/boardgame/draughts-premium/art-render.html?shot=' + item.shot;
      console.log('rendering ' + item.file + ' ' + item.width + 'x' + item.height);
      await run([
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
        '--disable-extensions', '--force-device-scale-factor=1',
        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=6000',
        '--window-size=' + item.width + ',' + item.height,
        '--user-data-dir=' + profile,
        '--screenshot=' + png, url
      ], item.file);
      fs.rmSync(profile, { recursive: true, force: true });
      if (!fs.existsSync(png) || fs.statSync(png).size < 1000) throw new Error('screenshot missing: ' + png);
      var webp = path.join(OUT_DIR, item.file + '.webp');
      var convert = spawnSync('cwebp', ['-quiet', '-q', String(item.quality), png, '-o', webp], { stdio: 'inherit' });
      if (convert.status !== 0) throw new Error('cwebp failed for ' + item.file);
      console.log('  ' + item.file + '.png ' + Math.round(fs.statSync(png).size / 1024) + 'KB · webp ' + Math.round(fs.statSync(webp).size / 1024) + 'KB');
    }
    console.log('done');
  } finally {
    await new Promise(function (resolve) { server.close(resolve); });
  }
})().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
