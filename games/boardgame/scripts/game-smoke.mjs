#!/usr/bin/env node
/*
 * Real-browser smoke check for boardgame game pages.
 *
 * browser-check.js targets tools/contract pages: it discovers only pages with
 * <script id="engine"> and requires data-i / data-lang i18n controls. Boardgame
 * pages have none of those markers, so that tool reports "no pages" for this
 * directory. This runner performs the checks the mobile/serverless contract
 * actually needs:
 *
 *   load, title, meta description, viewport, console/page errors,
 *   external requests, 390x844 + 320x568 horizontal overflow,
 *   primary touch targets >= 44px, readable font sizes,
 *   primary controls horizontally reachable, safe click smoke.
 *
 * Usage:
 *   node games/boardgame/scripts/game-smoke.mjs --root games/boardgame \
 *     --width 390 --height 844 --json /tmp/audit-390.json
 *   ... --width 320 --height 568 --json /tmp/audit-320.json
 *
 * --games <file>  read a newline-delimited list of slugs (the 284-game audit
 *                 list). Without it, every directory under --root with an
 *                 index.html and an engine.js is checked.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import child from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LOAD_TIMEOUT_MS = 20000;
const CDP_TIMEOUT_MS = 20000;
const TOUCH_MIN = 43.5;
const FONT_MIN = 12;
const RESERVED = new Set([
  'app', 'assets', 'board', 'collector', 'data', 'demo', 'engine', 'plugin',
  'schema', 'server', 'tests', 'scripts', 'node_modules'
]);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function parseArgs(argv) {
  const opts = {
    root: path.resolve('games/boardgame'),
    games: null,
    width: 390,
    height: 844,
    json: null,
    cdpPort: parseInt(process.env.AUDIT_CDP_PORT || '9222', 10),
    progress: null,
    resume: false,
    resources: null,
    throttle: 80,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.root = path.resolve(argv[++i] || '');
    else if (a === '--games') opts.games = path.resolve(argv[++i] || '');
    else if (a === '--width') opts.width = parseInt(argv[++i], 10);
    else if (a === '--height') opts.height = parseInt(argv[++i], 10);
    else if (a === '--json') opts.json = path.resolve(argv[++i] || '');
    else if (a === '--cdp-port') opts.cdpPort = parseInt(argv[++i], 10);
    else if (a === '--progress') opts.progress = path.resolve(argv[++i] || '');
    else if (a === '--resources') opts.resources = path.resolve(argv[++i] || '');
    else if (a === '--throttle') opts.throttle = parseInt(argv[++i], 10);
    else if (a === '--resume') opts.resume = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return opts;
}

function discover(root, listFile) {
  if (listFile) {
    return fs.readFileSync(listFile, 'utf8')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      .filter((slug) => fs.existsSync(path.join(root, slug, 'index.html')))
      .sort();
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((ent) => ent.isDirectory() && !RESERVED.has(ent.name))
    .filter((ent) => fs.existsSync(path.join(root, ent.name, 'index.html')))
    .map((ent) => ent.name)
    .sort();
}

function httpJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('non-JSON response: ' + body.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 1500, () => req.destroy(new Error('HTTP timeout')));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = [];
    this.handlers = [];
    this.closed = false;
    this.ws.addEventListener('message', (ev) => this._message(ev.data));
    this.ws.addEventListener('close', () => {
      this.closed = true;
      this._failAll(new Error('devtools closed'));
    });
  }
  _message(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : String(data)); }
    catch (e) { return; }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result || {});
      return;
    }
    if (!msg.method) return;
    const sid = msg.sessionId || null;
    const params = msg.params || {};
    this.handlers.slice().forEach((fn) => {
      try { fn(sid, msg.method, params); } catch (e) { /* best effort */ }
    });
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.method === msg.method && w.sessionId === sid) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(params);
      }
    }
  }
  _failAll(err) {
    this.pending.forEach((p) => p.reject(err));
    this.pending.clear();
    this.waiters.forEach((w) => { clearTimeout(w.timer); w.reject(err); });
    this.waiters = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === 1) return resolve();
      const onOpen = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('devtools websocket failed')); };
      const onClose = () => { cleanup(); reject(new Error('devtools closed during connect')); };
      const cleanup = () => {
        this.ws.removeEventListener('open', onOpen);
        this.ws.removeEventListener('error', onError);
        this.ws.removeEventListener('close', onClose);
      };
      this.ws.addEventListener('open', onOpen);
      this.ws.addEventListener('error', onError);
      this.ws.addEventListener('close', onClose);
    });
  }
  on(fn) { this.handlers.push(fn); }
  waitFor(sessionId, method, timeoutMs) {
    return new Promise((resolve, reject) => {
      const w = { sessionId: sessionId || null, method, resolve, reject };
      w.timer = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i !== -1) this.waiters.splice(i, 1);
        reject(new Error('wait ' + method + ' timeout'));
      }, timeoutMs || CDP_TIMEOUT_MS);
      this.waiters.push(w);
    });
  }
  send(method, params, sessionId, timeoutMs) {
    if (this.closed || this.ws.readyState !== 1) {
      return Promise.reject(new Error('websocket not connected (' + method + ')'));
    }
    const id = this.nextId++;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(method + ' timeout'));
      }, timeoutMs || CDP_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });
      try { this.ws.send(JSON.stringify(msg)); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

async function waitForDevtools(port, proc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error('Chrome exited early (code ' + proc.exitCode + ')');
    try { return await httpJson('http://127.0.0.1:' + port + '/json/version', 1200); }
    catch (e) { lastErr = e; await sleep(120); }
  }
  throw new Error('devtools not ready: ' + (lastErr ? lastErr.message : 'timeout'));
}

async function ensurePersistentChrome(port) {
  // AGENTS.md 2026-11-10: reuse a persistent Chrome; never spawn a temporary
  // profile per run, never kill Chrome. `chrome-ensure` guarantees the user's
  // browser is up; the audit itself needs CDP, so it keeps ONE headless
  // instance on a fixed profile/port and only creates/closes tabs.
  try {
    child.execFileSync(path.join(os.homedir(), '.local', 'bin', 'chrome-ensure'),
      [], { stdio: 'ignore', timeout: 10000 });
  } catch (e) { /* best effort; a running Chrome is not mandatory for CDP */ }

  try { return await httpJson('http://127.0.0.1:' + port + '/json/version', 1200); }
  catch (e) { /* start the persistent audit instance below */ }

  const profile = path.join(os.homedir(), '.cache', 'games-audit-chrome');
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--remote-allow-origins=*',
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only',
    '--mute-audio', '--hide-scrollbars', '--allow-file-access-from-files',
    '--window-size=390,844', 'about:blank'
  ];
  const proc = child.spawn(CHROME_PATH, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  const deadline = Date.now() + 25000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try { return await httpJson('http://127.0.0.1:' + port + '/json/version', 1200); }
    catch (e) { lastErr = e; await sleep(200); }
  }
  throw new Error('persistent audit Chrome not ready on port ' + port + ': ' +
    (lastErr ? lastErr.message : 'timeout'));
}

function getWsUrl(version) {
  return version.webSocketDebuggerUrl;
}

const SNAPSHOT_EXPR = `(function () {
  "use strict";
  function visible(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    if (typeof el.checkVisibility === 'function') {
      try { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; }
      catch (e) { /* fall through */ }
    }
    return r.width > 0 && r.height > 0;
  }
  var de = document.documentElement;
  var body = document.body;
  var vp = document.querySelector('meta[name="viewport"]');
  var desc = document.querySelector('meta[name="description"]');
  var out = {
    title: document.title || '',
    lang: de.lang || '',
    viewport: vp ? vp.getAttribute('content') || '' : '',
    description: desc ? desc.getAttribute('content') || '' : '',
    overflow: {
      docScroll: de.scrollWidth, docClient: de.clientWidth,
      bodyScroll: body ? body.scrollWidth : 0
    },
    controls: [], links: [], smallText: [], tinyInputs: []
  };
  var primarySel = 'button, input, select, textarea, [role="button"], ' +
    'a.btn, a.cta, a[class*="btn"], a[class*="cta"], a[class*="card"], .play-entry';
  var els = document.querySelectorAll(primarySel);
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!visible(el)) continue;
    var r = el.getBoundingClientRect();
    var scroller = false;
    var p = el.parentElement;
    while (p && p !== document.body) {
      var pcs = getComputedStyle(p);
      if (/(auto|scroll)/.test(pcs.overflowX) && p.scrollWidth > p.clientWidth + 1) { scroller = true; break; }
      p = p.parentElement;
    }
    out.controls.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 60),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      w: Math.round(r.width), h: Math.round(r.height),
      x: Math.round(r.left), y: Math.round(r.top),
      inViewportX: (r.left >= -1 && r.right <= de.clientWidth + 1) || scroller,
      inScroller: scroller
    });
  }
  var anchors = document.querySelectorAll('a[href]');
  for (var j = 0; j < anchors.length; j++) {
    var a = anchors[j];
    if (!visible(a)) continue;
    var ar = a.getBoundingClientRect();
    out.links.push({
      href: a.getAttribute('href') || '',
      text: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      w: Math.round(ar.width), h: Math.round(ar.height)
    });
  }
  var textSel = 'p, span, li, a, button, label, td, th, h1, h2, h3, h4, h5, h6, div, small, strong, em';
  var nodes = document.querySelectorAll(textSel);
  var seenText = Object.create(null);
  for (var k = 0; k < nodes.length && out.smallText.length < 80; k++) {
    var n = nodes[k];
    if (!visible(n)) continue;
    var hasDirect = false;
    for (var c = 0; c < n.childNodes.length; c++) {
      var ch = n.childNodes[c];
      if (ch.nodeType === 3 && ch.nodeValue && ch.nodeValue.trim().length > 1) { hasDirect = true; break; }
    }
    if (!hasDirect) continue;
    var fs = parseFloat(getComputedStyle(n).fontSize) || 0;
    if (fs && fs < ${FONT_MIN}) {
      var key = n.tagName + '|' + fs + '|' + (n.textContent || '').trim().slice(0, 16);
      if (!seenText[key]) {
        seenText[key] = 1;
        out.smallText.push({
          tag: n.tagName.toLowerCase(), fontSize: fs,
          text: (n.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40)
        });
      }
    }
  }
  var inputs = document.querySelectorAll('input, select, textarea');
  for (var m = 0; m < inputs.length; m++) {
    var inp = inputs[m];
    if (!visible(inp)) continue;
    var ifs = parseFloat(getComputedStyle(inp).fontSize) || 0;
    if (ifs && ifs < 16) {
      out.tinyInputs.push({ tag: inp.tagName.toLowerCase(), fontSize: ifs });
    }
  }
  return out;
})()`;

async function evaluate(cdp, sid, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
  }, sid, CDP_TIMEOUT_MS);
  if (r.exceptionDetails) {
    const d = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) ||
      r.exceptionDetails.text || 'evaluate failed';
    throw new Error(d);
  }
  return r.result ? r.result.value : undefined;
}

async function navigate(cdp, sid, url) {
  const loaded = cdp.waitFor(sid, 'Page.loadEventFired', LOAD_TIMEOUT_MS);
  const res = await cdp.send('Page.navigate', { url }, sid);
  if (res && res.errorText) {
    loaded.catch(() => {});
    throw new Error('navigate failed: ' + res.errorText);
  }
  await loaded;
  await sleep(350);
}

async function setMetrics(cdp, sid, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: true,
    screenWidth: width, screenHeight: height
  }, sid);
}

async function clickSmoke(cdp, sid) {
  const expr = `(function () {
    var btns = document.querySelectorAll('main button, body > button, #app button, .game button');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var r = b.getBoundingClientRect();
      var cs = getComputedStyle(b);
      if (r.width < 1 || r.height < 1 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (b.disabled) continue;
      var before = location.href;
      b.click();
      return { clicked: true, label: (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40), navigated: location.href !== before };
    }
    return { clicked: false };
  })()`;
  return evaluate(cdp, sid, expr);
}

function dedupe(list) {
  const seen = Object.create(null);
  return list.filter((s) => { if (seen[s]) return false; seen[s] = 1; return true; });
}

async function runGame(cdp, sid, root, slug, width, height) {
  const start = Date.now();
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  const coll = { exceptions: [], console: [], log: [], requests: [] };
  activeCollector = coll;

  try {
    await setMetrics(cdp, sid, width, height);
    await navigate(cdp, sid, pathToFileURL(path.join(root, slug, 'index.html')).href);
    check('page load', true);
  } catch (e) {
    check('page load', false, e.message);
    activeCollector = null;
    return finish(slug, checks, start, coll);
  }

  const snap = await evaluate(cdp, sid, SNAPSHOT_EXPR);

  // Both mobile widths are measured on the same loaded page.
  await setMetrics(cdp, sid, 390, 844);
  await sleep(120);
  const s390 = await evaluate(cdp, sid, SNAPSHOT_EXPR);
  await setMetrics(cdp, sid, 320, 568);
  await sleep(120);
  const s320 = await evaluate(cdp, sid, SNAPSHOT_EXPR);

  check('title 非空', !!snap.title.trim(), JSON.stringify(snap.title));
  check('meta description 非空', !!snap.description.trim(), JSON.stringify(snap.description));
  check('viewport 含 width=device-width', /width\s*=\s*device-width/i.test(snap.viewport), snap.viewport);
  check('390x844 无横向滚动',
    s390.overflow.docScroll <= s390.overflow.docClient + 1,
    `doc ${s390.overflow.docScroll}/${s390.overflow.docClient}, body ${s390.overflow.bodyScroll}`);
  check('320x568 无横向滚动',
    s320.overflow.docScroll <= s320.overflow.docClient + 1,
    `doc ${s320.overflow.docScroll}/${s320.overflow.docClient}, body ${s320.overflow.bodyScroll}`);

  const small320 = s320.controls.filter((c) => c.w < TOUCH_MIN || c.h < TOUCH_MIN);
  const small390 = s390.controls.filter((c) => c.w < TOUCH_MIN || c.h < TOUCH_MIN);
  check('390 主触控目标 >= 44px', small390.length === 0,
    small390.slice(0, 5).map((c) => `${c.tag}.${c.cls}"${c.text}" ${c.w}x${c.h}`).join('; '));
  check('320 主触控目标 >= 44px', small320.length === 0,
    small320.slice(0, 5).map((c) => `${c.tag}.${c.cls}"${c.text}" ${c.w}x${c.h}`).join('; '));

  check('390 主控件横向可达', s390.controls.every((c) => c.inViewportX),
    s390.controls.filter((c) => !c.inViewportX).slice(0, 3).map((c) => `${c.tag}"${c.text}" x=${c.x}`).join('; '));
  check('320 主控件横向可达', s320.controls.every((c) => c.inViewportX),
    s320.controls.filter((c) => !c.inViewportX).slice(0, 3).map((c) => `${c.tag}"${c.text}" x=${c.x}`).join('; '));

  check('390 字号可读 (>=12px)', s390.smallText.length === 0,
    s390.smallText.slice(0, 5).map((t) => `${t.tag} ${t.fontSize}px "${t.text}"`).join('; '));
  check('320 字号可读 (>=12px)', s320.smallText.length === 0,
    s320.smallText.slice(0, 5).map((t) => `${t.tag} ${t.fontSize}px "${t.text}"`).join('; '));
  check('输入框字号 >=16px (避免 iOS 缩放)', s390.tinyInputs.length === 0,
    s390.tinyInputs.slice(0, 5).map((t) => `${t.tag} ${t.fontSize}px`).join('; '));

  const ext = externalRequests(coll.requests);
  check('无外部请求', ext.length === 0, ext.slice(0, 5).join('; '));
  check('无 console error', coll.console.length === 0, coll.console.slice(0, 4).join(' | '));
  check('无未捕获异常', coll.exceptions.length === 0, coll.exceptions.slice(0, 4).join(' | '));
  check('无 Log error', coll.log.length === 0, coll.log.slice(0, 4).join(' | '));

  // Click smoke: click the first visible main button, ensure no new errors.
  const beforeConsole = coll.console.length;
  const beforeExc = coll.exceptions.length;
  let click;
  try { click = await clickSmoke(cdp, sid); }
  catch (e) { click = { clicked: false, error: e.message }; }
  await sleep(350);
  if (click.clicked) {
    check('点击冒烟无新增错误',
      coll.console.length === beforeConsole && coll.exceptions.length === beforeExc,
      coll.console.slice(beforeConsole).concat(coll.exceptions.slice(beforeExc)).slice(0, 3).join(' | '));
    check('点击冒烟未意外跳转', click.navigated !== true, click.label || '');
  } else {
    check('点击冒烟（无可用按钮，跳过）', true, '');
  }

  activeCollector = null;
  return finish(slug, checks, start, coll, click);
}

function finish(slug, checks, start, coll, click) {
  const failures = checks.filter((c) => !c.ok).map((c) => c.name + (c.detail ? ' — ' + c.detail : ''));
  return {
    slug,
    status: failures.length ? 'FAIL' : 'PASS',
    durationMs: Date.now() - start,
    checks,
    failures,
    click: click || null,
    counts: {
      consoleErrors: coll ? coll.console.length : 0,
      exceptions: coll ? coll.exceptions.length : 0,
      logErrors: coll ? coll.log.length : 0,
      externalRequests: coll ? dedupe(coll.requests.filter((u) => !/^(file|data):/i.test(u))).length : 0
    }
  };
}

function externalRequests(requests) {
  return dedupe(requests.filter((u) => !/^(file|data):/i.test(u)));
}

let activeCollector = null;

function attachCollector(cdp, sid) {
  cdp.on((s, method, params) => {
    if (s !== sid || !activeCollector) return;
    const c = activeCollector;
    if (method === 'Runtime.exceptionThrown') {
      const ed = params.exceptionDetails || {};
      const desc = (ed.exception && ed.exception.description) || ed.text || 'uncaught';
      c.exceptions.push(String(desc).split('\n')[0].slice(0, 300));
    } else if (method === 'Runtime.consoleAPICalled') {
      if (params.type === 'error') {
        const args = (params.args || []).map((a) => {
          if (a.value !== undefined) return String(a.value);
          return a.description || a.type || 'error';
        });
        c.console.push(args.join(' ').split('\n')[0].slice(0, 300));
      }
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry || {};
      if (entry.level === 'error') c.log.push((entry.text || 'log error').slice(0, 300));
    } else if (method === 'Network.requestWillBeSent') {
      c.requests.push((params.request && params.request.url) || '');
    }
  });
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function chromeSample() {
  try {
    const out = child.execSync('ps -axo pid=,pcpu=,rss=,command=', { encoding: 'utf8', timeout: 5000 });
    let cpu = 0, rss = 0, count = 0;
    out.split('\n').forEach((line) => {
      if (line.indexOf('games-audit-chrome') === -1) return;
      const parts = line.trim().split(/\s+/);
      const pcpu = parseFloat(parts[1]) || 0;
      const prss = (parseInt(parts[2], 10) || 0) * 1024;
      cpu = Math.max(cpu, pcpu);
      rss += prss;
      count++;
    });
    return { cpuPercentMax: cpu, rssBytesTotal: rss, processes: count };
  } catch (e) {
    return { cpuPercentMax: 0, rssBytesTotal: 0, processes: 0, error: e.message };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('node game-smoke.mjs --root <dir> --width 390 --height 844 --json out.json [--games list.txt] [--resume]');
    return;
  }
  if (!opts.json) throw new Error('--json <path> is required');
  const slugs = discover(opts.root, opts.games);
  if (!slugs.length) throw new Error('no game pages found under ' + opts.root);

  const progressPath = opts.progress || path.join(opts.root, 'audit', 'progress-smoke.json');
  const resourcesPath = opts.resources || path.join(opts.root, 'audit', 'resources.json');
  const progress = (opts.resume ? readJson(progressPath) : null) || {
    updatedAt: null, width: opts.width, height: opts.height,
    order: slugs, completed: {}, complete: false
  };
  progress.width = opts.width;
  progress.height = opts.height;
  progress.order = slugs;

  if (!opts.resume) progress.completed = {};
  const todo = slugs.filter((slug) => !progress.completed[slug]);
  const startedAt = new Date();
  const startMs = Date.now();
  const nodeStart = process.memoryUsage();
  const systemStart = { loadavg: os.loadavg(), freemem: os.freemem(), totalmem: os.totalmem() };
  const chromeStart = chromeSample();
  let chromeMax = chromeStart.cpuPercentMax;
  let chromeRssMax = chromeStart.rssBytesTotal;

  const sampler = setInterval(() => {
    const s = chromeSample();
    chromeMax = Math.max(chromeMax, s.cpuPercentMax);
    chromeRssMax = Math.max(chromeRssMax, s.rssBytesTotal);
  }, 5000);
  sampler.unref();

  const version = await ensurePersistentChrome(opts.cdpPort);
  const cdp = new CDP(getWsUrl(version));
  await cdp.open();
  // Create exactly one audit tab; close only that tab at the end.
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: sid } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  attachCollector(cdp, sid);
  await cdp.send('Page.enable', {}, sid);
  await cdp.send('Runtime.enable', {}, sid);
  await cdp.send('Log.enable', {}, sid);
  await cdp.send('Network.enable', {}, sid);

  for (let i = 0; i < todo.length; i++) {
    const slug = todo[i];
    let result;
    try {
      result = await runGame(cdp, sid, opts.root, slug, opts.width, opts.height);
    } catch (e) {
      result = { slug, status: 'FAIL', durationMs: 0, checks: [], failures: ['runner error: ' + e.message], counts: {} };
    }
    progress.completed[slug] = result;
    progress.updatedAt = new Date().toISOString();
    writeJsonAtomic(progressPath, progress);
    const done = slugs.length - todo.length + i + 1;
    process.stderr.write(`[${done}/${slugs.length}] ${slug} ${result.status}\n`);
    if (opts.throttle > 0) await sleep(opts.throttle);
  }

  const results = slugs.map((slug) => progress.completed[slug]).filter(Boolean);
  progress.complete = results.length === slugs.length;
  progress.updatedAt = new Date().toISOString();
  writeJsonAtomic(progressPath, progress);

  const summary = {
    root: opts.root,
    width: opts.width,
    height: opts.height,
    total: results.length,
    resumed: slugs.length - todo.length,
    pass: results.filter((r) => r.status === 'PASS').length,
    fail: results.filter((r) => r.status === 'FAIL').length,
    checks: results.reduce((n, r) => n + r.checks.length, 0),
    failedChecks: results.reduce((n, r) => n + r.failures.length, 0),
    externalRequests: results.reduce((n, r) => n + (r.counts.externalRequests || 0), 0),
    consoleErrors: results.reduce((n, r) => n + (r.counts.consoleErrors || 0), 0),
    exceptions: results.reduce((n, r) => n + (r.counts.exceptions || 0), 0)
  };

  fs.writeFileSync(opts.json, JSON.stringify({
    generatedAt: new Date().toISOString(),
    widths: [390, 320],
    progress: progressPath,
    summary,
    results
  }, null, 2) + '\n');

  clearInterval(sampler);
  const endedAt = new Date();
  const nodeEnd = process.memoryUsage();
  const systemEnd = { loadavg: os.loadavg(), freemem: os.freemem(), totalmem: os.totalmem() };
  const resources = readJson(resourcesPath) || { runs: [] };
  resources.runs.push({
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: Date.now() - startMs,
    width: opts.width, height: opts.height,
    total: results.length, resumed: slugs.length - todo.length,
    pass: summary.pass, fail: summary.fail,
    concurrency: 1, throttleMs: opts.throttle,
    node: {
      rssStart: nodeStart.rss, rssEnd: nodeEnd.rss,
      heapUsedStart: nodeStart.heapUsed, heapUsedEnd: nodeEnd.heapUsed
    },
    system: { start: systemStart, end: systemEnd },
    chrome: {
      start: chromeStart,
      maxCpuPercent: chromeMax,
      maxRssBytes: chromeRssMax,
      cpuLimitPercent: 60,
      overLimit: chromeMax > 60
    }
  });
  writeJsonAtomic(resourcesPath, resources);

  // Close only the audit tab; the persistent Chrome stays up for the next run.
  try { await cdp.send('Target.closeTarget', { targetId }); } catch (e) { /* ignore */ }
  cdp.close();

  console.log(JSON.stringify({ summary, resources: resources.runs[resources.runs.length - 1] }, null, 2));
}

main().catch((e) => {
  console.error('game-smoke failed:', e.message);
  process.exit(1);
});
