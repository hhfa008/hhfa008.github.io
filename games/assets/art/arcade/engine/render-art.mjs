#!/usr/bin/env node
'use strict';

/*
 * Render the four art images for one arcade family.
 *
 *   node games/assets/art/arcade/engine/render-art.mjs <family>
 *   node .../render-art.mjs <family> --browser http://127.0.0.1:9222
 *
 * Pipeline:
 *   1. realism.mjs validates the committed state; exit 3 = no image written.
 *   2. art-render.html composes the scene in code (grid, 3D perspective,
 *      system-font labels, contact shadows). FLUX only supplies the material
 *      textures; the model never draws characters or the position.
 *   3. A local HTTP server serves the repo; the resident Chrome on CDP 9222
 *      (or one fallback headless Chrome, reused for all four shots) captures
 *      exact-size PNGs.
 *   4. cwebp creates the served WebP and degrades q90 -> q60 only when the
 *      ART-GUIDE section 9 budget is exceeded, printing actual bytes.
 *
 * Outputs in games/assets/art/arcade/<family>/:
 *   cover.png|webp    1024x1024  <= 300KB WebP
 *   og.png|webp       1200x630   <= 200KB WebP
 *   detail.png|webp   1200x800   <= 300KB WebP
 *   card.png|webp     480x320    <=  60KB WebP
 */

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const ARCADE = path.resolve(HERE, '..');
const STATE_DIR = path.join(ARCADE, 'state');
const REALISM = path.join(HERE, 'realism.mjs');
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FAMILIES = [
  'slide-puzzle', 'lights-out', 'minesweeper', 'memory-pairs', 'snake',
  'pong', 'tictactoe', 'hanoi', 'reaction'
];
const SHOTS = [
  { shot: 'cover', width: 1024, height: 1024, budgetKB: 300 },
  { shot: 'og', width: 1200, height: 630, budgetKB: 200 },
  { shot: 'detail', width: 1200, height: 800, budgetKB: 300 },
  { shot: 'card', width: 480, height: 320, budgetKB: 60 }
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG: ' + file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function webpWithBudget(png, webp, budgetKB) {
  const budget = budgetKB * 1024;
  for (let q = 90; q >= 60; q -= 10) {
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

async function httpJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 1500) });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + url);
  return response.json();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.handlers = [];
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    const self = this;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP open timeout')), 6000);
      self.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      self.ws.addEventListener('error', (ev) => { clearTimeout(timer); reject(new Error('CDP error: ' + (ev && ev.message || 'unknown'))); });
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (err) { return; }
      if (msg.id != null) {
        const p = self.pending.get(msg.id);
        if (!p) return;
        self.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else p.resolve(msg.result || {});
        return;
      }
      if (!msg.method) return;
      const sid = msg.sessionId || null;
      self.handlers.slice().forEach((fn) => { try { fn(sid, msg.method, msg.params || {}); } catch (e) { /* best effort */ } });
      for (let i = self.waiters.length - 1; i >= 0; i--) {
        const w = self.waiters[i];
        if (w.method === msg.method && w.sessionId === sid) {
          clearTimeout(w.timer);
          self.waiters.splice(i, 1);
          w.resolve(msg.params || {});
        }
      }
    });
  }
  send(method, params, sessionId, timeoutMs) {
    const id = this.nextId++;
    const payload = { id, method, params: params || {} };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs || 20000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      this.ws.send(JSON.stringify(payload));
    });
  }
  waitFor(sessionId, method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { sessionId: sessionId || null, method, resolve };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error('waitFor timeout: ' + method));
      }, timeoutMs || 20000);
      this.waiters.push(w);
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function connectBrowser(preferred) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  if (process.env.CDP_URL) candidates.push(process.env.CDP_URL);
  candidates.push('http://127.0.0.1:9222');
  for (const base of candidates) {
    try {
      const version = await httpJson(base.replace(/\/$/, '') + '/json/version', 1200);
      if (version && version.webSocketDebuggerUrl) {
        const cdp = new CDP(version.webSocketDebuggerUrl);
        await cdp.open();
        return { cdp, base, spawned: null, version };
      }
    } catch (err) { /* try next */ }
  }
  if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-art-chrome-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + port, '--remote-allow-origins=*',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  const base = 'http://127.0.0.1:' + port;
  try {
    let version = null;
    for (let i = 0; i < 100 && !version; i++) {
      try { version = await httpJson(base + '/json/version', 800); } catch (err) { await sleep(120); }
    }
    if (!version) throw new Error('fallback Chrome DevTools endpoint did not start');
    const cdp = new CDP(version.webSocketDebuggerUrl);
    await cdp.open();
    return { cdp, base, spawned: child, profile, version };
  } catch (err) {
    try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
    throw err;
  }
}

function startServer() {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = path.resolve(ROOT, '.' + rel);
      if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end('forbidden'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
        res.end(data);
      });
    } catch (err) { res.writeHead(500); res.end('error'); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function capture(cdp, origin, family, item, png) {
  const target = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const sid = attached.sessionId;
  const errors = [];
  const handler = (eventSid, method, params) => {
    if (eventSid !== sid) return;
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails || {};
      errors.push('exception: ' + (d.text || '') + ' ' + (d.exception && d.exception.description || ''));
    }
    if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      errors.push('console.error: ' + (params.args || []).map((a) => a.value || a.description || '').join(' '));
    }
  };
  cdp.on(handler);
  try {
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: item.width, height: item.height, deviceScaleFactor: 1, mobile: false
    }, sid);
    const url = origin + '/games/assets/art/arcade/engine/art-render.html?family=' +
      encodeURIComponent(family) + '&shot=' + item.shot;
    const loaded = cdp.waitFor(sid, 'Page.loadEventFired', 20000);
    await cdp.send('Page.navigate', { url }, sid);
    await loaded;
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await sleep(100);
      const check = await cdp.send('Runtime.evaluate', {
        expression: '(function(){return {ready:document.body.dataset.ready||"",error:document.body.dataset.error||""}})()',
        returnByValue: true
      }, sid);
      const value = check && check.result && check.result.value;
      if (value && value.error) throw new Error(item.shot + ' page error: ' + value.error);
      if (value && value.ready === '1') ready = true;
    }
    if (!ready) throw new Error(item.shot + ' never became ready');
    await cdp.send('Runtime.evaluate', { expression: 'document.fonts && document.fonts.ready', awaitPromise: true }, sid, 5000).catch(() => {});
    await sleep(180);
    if (errors.length) throw new Error(item.shot + ' console errors: ' + errors.join(' | '));
    const layout = await cdp.send('Runtime.evaluate', {
      expression: '(function(){' +
        'var vw=innerWidth,vh=innerHeight,fail=[];' +
        'function rect(el){var b=el.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width,h:b.height};}' +
        'function inside(b){return b.l>=-1&&b.t>=-1&&b.r<=vw+1&&b.b<=vh+1;}' +
        'function area(a,b){var w=Math.min(a.r,b.r)-Math.max(a.l,b.l);var h=Math.min(a.b,b.b)-Math.max(a.t,b.t);return w>0&&h>0?w*h:0;}' +
        'function add(msg){if(fail.indexOf(msg)<0)fail.push(msg);}' +
        'if(document.documentElement.scrollWidth>vw+1)add("document overflows horizontally: "+document.documentElement.scrollWidth+">"+vw);' +
        'var scene=document.querySelector(".scene"),brand=document.querySelector(".brand"),hud=document.querySelector(".hud"),cap=document.querySelector(".caption");' +
        'if(!scene||!inside(rect(scene)))add("scene outside viewport");' +
        'if(!brand||!inside(rect(brand)))add("brand outside viewport");' +
        'if(!hud||!inside(rect(hud)))add("hud outside viewport");' +
        'if(cap&&getComputedStyle(cap).display!=="none"&&!inside(rect(cap)))add("caption outside viewport");' +
        'if(scene&&brand){var s=rect(scene),br=rect(brand);if(area(s,br)/Math.max(1,br.w*br.h)>0.18)add("brand overlaps board");}' +
        'if(scene&&hud){var s2=rect(scene),hr=rect(hud);if(area(s2,hr)/Math.max(1,hr.w*hr.h)>0.18)add("hud overlaps board");}' +
        'var nodes=document.querySelectorAll(".title,.chip .value,.chip .label,.caption");' +
        'for(var i=0;i<nodes.length;i++){var n=nodes[i];if(n.scrollWidth>n.clientWidth+2)add("text overflows: "+n.className+" "+n.scrollWidth+">"+n.clientWidth);}' +
        'var marks=document.querySelectorAll(".num,.mnum");' +
        'for(var j=0;j<marks.length;j++){var m=marks[j],pb=m.parentElement.getBoundingClientRect(),mb=m.getBoundingClientRect();' +
        'if(mb.width>pb.width+2||mb.height>pb.height+2)add("number spills tile: "+m.textContent);}' +
        'return {ok:fail.length===0,fail:fail};' +
        '})()',
      returnByValue: true
    }, sid);
    const layoutValue = layout && layout.result && layout.result.value;
    if (!layoutValue || !layoutValue.ok) {
      throw new Error(item.shot + ' layout: ' + ((layoutValue && layoutValue.fail) || ['probe failed']).join('; '));
    }
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sid, 30000);
    fs.writeFileSync(png, Buffer.from(shot.data, 'base64'));
    const dims = pngSize(png);
    if (dims.width !== item.width || dims.height !== item.height) {
      throw new Error(item.shot + ' screenshot ' + dims.width + 'x' + dims.height + ', expected ' + item.width + 'x' + item.height);
    }
    if (fs.statSync(png).size < 1000) throw new Error(item.shot + ' screenshot is too small');
    return dims;
  } finally {
    cdp.handlers.splice(cdp.handlers.indexOf(handler), 1);
    try { await cdp.send('Target.closeTarget', { targetId: target.targetId }, null, 5000); } catch (err) { /* ignore */ }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const family = args.find((a) => !a.startsWith('--'));
  const browserArgIndex = args.indexOf('--browser');
  const preferred = browserArgIndex >= 0 ? args[browserArgIndex + 1] : null;
  if (!FAMILIES.includes(family)) {
    console.error('usage: node render-art.mjs <' + FAMILIES.join('|') + '> [--browser http://127.0.0.1:9222]');
    process.exit(2);
  }

  // Gate first: a rejected state must never create or overwrite images.
  const gate = spawnSync(process.execPath, [REALISM, path.join(STATE_DIR, family + '.json')], { stdio: 'inherit' });
  if (gate.status !== 0) {
    console.error('REALISM FAIL: refusing to render; no image files written');
    process.exit(gate.status || 3);
  }

  const outDir = path.join(ARCADE, family);
  fs.mkdirSync(outDir, { recursive: true });
  for (const item of SHOTS) {
    for (const ext of ['png', 'webp']) {
      try { fs.rmSync(path.join(outDir, item.shot + '.' + ext)); } catch (err) { /* absent */ }
    }
  }
  for (const name of ['hero.png', 'surface.png']) {
    const file = path.join(ARCADE, 'materials', family, name);
    if (!fs.existsSync(file)) throw new Error('missing material: ' + path.relative(ROOT, file));
  }

  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await connectBrowser(preferred);
  console.log('serving ' + ROOT);
  console.log('origin ' + origin);
  console.log('browser ' + browser.version.Browser + ' · ' + (browser.spawned ? 'spawned (reused for all shots)' : 'resident CDP'));
  try {
    for (const item of SHOTS) {
      const png = path.join(outDir, item.shot + '.png');
      console.log('rendering ' + family + '/' + item.shot + ' ' + item.width + 'x' + item.height);
      const dims = await capture(browser.cdp, origin, family, item, png);
      const webp = path.join(outDir, item.shot + '.webp');
      const result = webpWithBudget(png, webp, item.budgetKB);
      console.log('  ' + item.shot + '.png ' + (fs.statSync(png).size / 1024).toFixed(1) +
        'KB (' + dims.width + 'x' + dims.height + ') · webp q' + result.quality + ' ' +
        (result.bytes / 1024).toFixed(1) + 'KB / ' + item.budgetKB + 'KB');
    }
    console.log('done ' + family);
  } catch (err) {
    for (const item of SHOTS) {
      for (const ext of ['png', 'webp']) {
        try { fs.rmSync(path.join(outDir, item.shot + '.' + ext)); } catch (e) { /* absent */ }
      }
    }
    throw err;
  } finally {
    browser.cdp.close();
    if (browser.spawned && browser.spawned.exitCode === null) {
      try { browser.spawned.kill('SIGTERM'); } catch (err) { /* ignore */ }
      await sleep(500);
      try { if (browser.spawned.exitCode === null) browser.spawned.kill('SIGKILL'); } catch (err) { /* ignore */ }
    }
    if (browser.profile) { try { fs.rmSync(browser.profile, { recursive: true, force: true }); } catch (err) { /* ignore */ } }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
