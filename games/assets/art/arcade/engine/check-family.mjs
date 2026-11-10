#!/usr/bin/env node
'use strict';

/*
 * Acceptance check for one arcade family's art wiring.
 *
 *   node games/assets/art/arcade/engine/check-family.mjs <family>
 *   node .../check-family.mjs <family> --slug slide-4 --browser http://127.0.0.1:9222
 *
 * Static pass: every variant index.html has an absolute 1200x630 og:image and
 * every rules.html has a detail figure whose alt/caption carries that variant's
 * name.
 *
 * Browser pass (representative variant by default): 390x844 and 320x568,
 * horizontal overflow 0, console errors 0, rAF FPS >= 30, og/detail WebP HTTP
 * 200 with the expected intrinsic dimensions.
 */

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const GAMES = path.join(ROOT, 'games');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPRESENTATIVE = {
  'slide-puzzle': 'slide-4', 'lights-out': 'lights-5', 'minesweeper': 'mines-10x10',
  'memory-pairs': 'memory-4x4', 'snake': 'snake-14', 'pong': 'pong',
  'tictactoe': 'tictactoe', 'hanoi': 'hanoi-8', 'reaction': 'reaction-20'
};
const VARIANTS = {
  'slide-puzzle': ['slide-3', 'slide-4', 'slide-5', 'slide-6', 'slide-7', 'slide-8', 'slide-9', 'slide-10', 'slide-11', 'slide-12'],
  'lights-out': ['lights-3', 'lights-4', 'lights-5', 'lights-6', 'lights-7', 'lights-8', 'lights-9', 'lights-10', 'lights-11', 'lights-12'],
  'minesweeper': ['mines-7x7', 'mines-10x10', 'mines-14x14', 'mines-18x18', 'mines-20x20', 'mines-24x24', 'mines-30x16', 'mines-easy', 'mines-mid', 'mines-hard'],
  'memory-pairs': ['memory-3x4', 'memory-4x4', 'memory-4x5', 'memory-4x6', 'memory-5x4', 'memory-5x5', 'memory-6x4', 'memory-6x6', 'memory-8x5', 'memory-8x6'],
  'snake': ['snake', 'snake-10', 'snake-12', 'snake-14', 'snake-18', 'snake-20', 'snake-24', 'snake-30', 'snake-fast', 'snake-wrap'],
  'pong': ['pong', 'pong-1-5', 'pong-2-5', 'pong-2p', 'pong-3', 'pong-3-5', 'pong-4', 'pong-5', 'pong-6', 'pong-fast'],
  'tictactoe': ['tictactoe', 'tictactoe-4', 'tictactoe-5', 'tictactoe-6', 'tictactoe-7', 'tictactoe-8', 'tictactoe-9', 'tictactoe-10', 'tictactoe-11', 'tictactoe-12'],
  'hanoi': ['hanoi-4', 'hanoi-5', 'hanoi-6', 'hanoi-7', 'hanoi-8', 'hanoi-9', 'hanoi-10', 'hanoi-11', 'hanoi-12', 'hanoi-13'],
  'reaction': ['reaction-time', 'reaction-10', 'reaction-20', 'reaction-30']
};
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 1500) });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
class CDP {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.nextId = 1; this.pending = new Map(); this.waiters = []; this.handlers = []; }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP open timeout')), 6000);
      this.ws.addEventListener('open', () => { clearTimeout(t); resolve(); });
      this.ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('CDP open error')); });
    });
    this.ws.addEventListener('message', (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id != null) {
        const p = this.pending.get(m.id); if (!p) return; this.pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error))); else p.resolve(m.result || {});
        return;
      }
      if (!m.method) return;
      const sid = m.sessionId || null;
      this.handlers.slice().forEach((fn) => { try { fn(sid, m.method, m.params || {}); } catch (e) { /* ignore */ } });
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.method === m.method && w.sid === sid) { clearTimeout(w.timer); this.waiters.splice(i, 1); w.resolve(m.params || {}); }
      }
    });
  }
  send(method, params, sid, timeoutMs) {
    const id = this.nextId++;
    const msg = { id, method, params: params || {} };
    if (sid) msg.sessionId = sid;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, timeoutMs || 20000);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify(msg));
    });
  }
  waitFor(sid, method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { sid, method, resolve };
      w.timer = setTimeout(() => { const i = this.waiters.indexOf(w); if (i !== -1) this.waiters.splice(i, 1); reject(new Error('waitFor ' + method)); }, timeoutMs || 20000);
      this.waiters.push(w);
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function connect(preferred) {
  const candidates = [];
  if (preferred) candidates.push(preferred);
  if (process.env.CDP_URL) candidates.push(process.env.CDP_URL);
  candidates.push('http://127.0.0.1:9222');
  for (const base of candidates) {
    try {
      const version = await httpJson(base.replace(/\/$/, '') + '/json/version', 1200);
      if (!version.webSocketDebuggerUrl) continue;
      const cdp = new CDP(version.webSocketDebuggerUrl);
      await cdp.open();
      return { cdp, base, spawned: null, browser: version.Browser || 'unknown' };
    } catch (e) { /* next */ }
  }
  // Fallback: one headless Chrome with animation throttling disabled.
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-check-'));
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--disable-sync',
    '--hide-scrollbars', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--remote-debugging-port=' + port, '--remote-allow-origins=*',
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
  const base = 'http://127.0.0.1:' + port;
  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try { version = await httpJson(base + '/json/version', 800); } catch (e) { await sleep(120); }
  }
  if (!version) { try { child.kill('SIGKILL'); } catch (e) { /* ignore */ } throw new Error('Chrome did not start'); }
  const cdp = new CDP(version.webSocketDebuggerUrl);
  await cdp.open();
  return { cdp, base, spawned: child, profile, browser: version.Browser || 'unknown' };
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.resolve(ROOT, '.' + rel);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function pageNames(html) {
  const title = /<title>([^<]*)<\/title>/i.exec(html);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const en = title ? title[1].replace(/\s*—\s*free online game\s*$/i, '').trim() : '';
  const zhText = h1 ? h1[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
  const zh = zhText.split(/规则|怎么玩|完整|：|:/)[0].trim() || zhText;
  return { en, zh };
}

function staticCheck(family) {
  const failures = [];
  for (const slug of VARIANTS[family]) {
    const indexFile = path.join(GAMES, slug, 'index.html');
    const rulesFile = path.join(GAMES, slug, 'rules.html');
    const index = fs.readFileSync(indexFile, 'utf8');
    const rules = fs.readFileSync(rulesFile, 'utf8');
    const names = pageNames(index);
    const rulesNames = pageNames(rules);
    const og = /<meta property="og:image" content="([^"]+)">/.exec(index);
    if (!og || og[1] !== 'https://hhfa008.github.io/games/assets/art/arcade/' + family + '/og.webp') {
      failures.push(slug + ': index og:image missing/not absolute');
    }
    if (!/<meta property="og:image:width" content="1200">/.test(index) || !/<meta property="og:image:height" content="630">/.test(index)) {
      failures.push(slug + ': index og image dimensions missing');
    }
    const indexAlt = /<meta property="og:image:alt" content="([^"]*)">/.exec(index);
    if (!indexAlt || !names.en || indexAlt[1].indexOf(names.en) === -1) {
      failures.push(slug + ': index og alt does not carry "' + names.en + '"');
    }
    if (!/<meta name="twitter:card" content="summary_large_image">/.test(index) || !/<meta name="twitter:image"/.test(index)) {
      failures.push(slug + ': twitter large-image tags missing');
    }
    if (!rules.includes('<figure class="art-figure">') ||
        !rules.includes('<img src="../assets/art/arcade/' + family + '/detail.webp"')) {
      failures.push(slug + ': rules detail figure missing');
    }
    const figAlt = /<figure class="art-figure">[\s\S]*?alt="([^"]+)"/.exec(rules);
    if (!figAlt || !rulesNames.zh || figAlt[1].indexOf(rulesNames.zh) === -1) {
      failures.push(slug + ': rules figure alt does not carry "' + rulesNames.zh + '"');
    }
    if (!/<figcaption>[^<]*/.test(rules)) failures.push(slug + ': rules figure caption missing');
  }
  return failures;
}

async function browserCheck(cdp, origin, family, slug) {
  const results = [];
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
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
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sid).catch(() => {});
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: true }, sid);
      await cdp.send('Target.activateTarget', { targetId: target.targetId }).catch(() => {});
      const url = origin + '/games/' + slug + '/';
      const loaded = cdp.waitFor(sid, 'Page.loadEventFired', 20000);
      await cdp.send('Page.navigate', { url }, sid);
      await loaded;
      await sleep(900);
      const probe = await cdp.send('Runtime.evaluate', {
        expression: '(async function(){' +
          'var out={};' +
          'out.overflow=document.documentElement.scrollWidth-innerWidth;' +
          'out.og=(document.querySelector(\'meta[property="og:image"]\')||{}).content||"";' +
          'out.ogMeta=(document.querySelector(\'meta[property="og:image:width"]\')||{}).content+"x"+(document.querySelector(\'meta[property="og:image:height"]\')||{}).content;' +
          'out.fig="/games/assets/art/arcade/' + family + '/detail.webp";' +
          'out.title=document.title;' +
          'function pathOf(u){try{return new URL(u,location.href).pathname}catch(e){return ""}}' +
          'async function probeImg(u){try{var r=await fetch(pathOf(u),{cache:"no-store"});if(!r.ok)return {status:r.status,w:0,h:0,type:r.headers.get("content-type")||""};var b=await r.blob();var bm=await createImageBitmap(b);return {status:r.status,w:bm.width,h:bm.height,type:r.headers.get("content-type")||""}}catch(e){return {status:0,w:0,h:0,type:String(e)}}}' +
          'out.ogImg=await probeImg(out.og);' +
          'out.figImg=await probeImg(out.fig);' +
          'out.fps=await new Promise(function(res){var n=0,t0=performance.now();function f(){n++;var t=performance.now();if(t-t0<1500)requestAnimationFrame(f);else res(n/((t-t0)/1000));}requestAnimationFrame(f);});' +
          'return out;' +
          '})()',
        awaitPromise: true,
        returnByValue: true
      }, sid, 15000);
      const v = probe && probe.result && probe.result.value;
      const row = {
        family, slug, width: viewport.width, height: viewport.height,
        overflow: v ? v.overflow : null,
        fps: v ? Math.round(v.fps * 10) / 10 : null,
        ogStatus: v && v.ogImg ? v.ogImg.status : null,
        figStatus: v && v.figImg ? v.figImg.status : null,
        figDims: v && v.figImg ? v.figImg.w + 'x' + v.figImg.h : '',
        ogDims: v && v.ogImg ? v.ogImg.w + 'x' + v.ogImg.h : '',
        consoleErrors: errors.length,
        consoleDetail: errors.slice(0, 4)
      };
      row.pass = row.overflow <= 1 && row.fps >= 30 && row.ogStatus === 200 && row.figStatus === 200 &&
        row.figDims === '1200x800' && row.ogDims === '1200x630' && row.consoleErrors === 0;
      results.push(row);
    } finally {
      const i = cdp.handlers.indexOf(handler);
      if (i !== -1) cdp.handlers.splice(i, 1);
      try { await cdp.send('Target.closeTarget', { targetId: target.targetId }, null, 5000); } catch (e) { /* ignore */ }
    }
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const family = args.find((a) => !a.startsWith('--'));
  const slugIndex = args.indexOf('--slug');
  const slug = slugIndex >= 0 ? args[slugIndex + 1] : REPRESENTATIVE[family];
  const browserIndex = args.indexOf('--browser');
  const preferred = browserIndex >= 0 ? args[browserIndex + 1] : null;
  if (!VARIANTS[family]) {
    console.error('usage: node check-family.mjs <' + Object.keys(VARIANTS).join('|') + '> [--slug x] [--browser url]');
    process.exit(2);
  }
  const staticFailures = staticCheck(family);
  console.log('static ' + family + ': ' + (staticFailures.length ? 'FAIL' : 'OK') + ' (' + VARIANTS[family].length + ' variants)');
  staticFailures.forEach((f) => console.log('  - ' + f));

  const server = await startServer();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await connect(preferred);
  console.log('browser ' + browser.browser + ' · ' + (browser.spawned ? 'spawned fallback' : 'resident CDP') + ' · representative ' + slug);
  let rows = [];
  try {
    rows = await browserCheck(browser.cdp, origin, family, slug);
  } finally {
    browser.cdp.close();
    if (browser.spawned && browser.spawned.exitCode === null) {
      try { browser.spawned.kill('SIGTERM'); } catch (e) { /* ignore */ }
      await sleep(400);
      try { if (browser.spawned.exitCode === null) browser.spawned.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }
    if (browser.profile) { try { fs.rmSync(browser.profile, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
    await new Promise((resolve) => server.close(resolve));
  }
  rows.forEach((r) => {
    console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.slug + ' @' + r.width + 'x' + r.height +
      ' overflow=' + r.overflow + ' fps=' + r.fps + ' og=' + r.ogStatus + ' fig=' + r.figStatus +
      ' figDims=' + r.figDims + ' ogDims=' + r.ogDims + ' console=' + r.consoleErrors +
      (r.consoleDetail.length ? ' [' + r.consoleDetail.join(' | ') + ']' : ''));
  });
  const ok = staticFailures.length === 0 && rows.length === 2 && rows.every((r) => r.pass);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
