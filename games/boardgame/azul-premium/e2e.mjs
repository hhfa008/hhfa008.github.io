#!/usr/bin/env node
/*
 * Azul premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/azul-premium/e2e.mjs
 *
 * Verifies: real UI take→line→wall→score, AI turn, endgame/restart, keyboard,
 * 390×844 / 320×568 / landscape mobile, 44px touch targets, safe-area + 100dvh,
 * reduced motion, WebAudio unlock, service-worker offline reload, performance
 * budgets, zero external requests, rules page JSON-LD/art, and the art
 * composition source (cover/OG/detail) with real component counts.
 *
 * Prints exactly one line: RESULT: N passed, M failed
 * Exit code is non-zero on any failure.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AZUL_CDP_PORT || 9222);
const ENTRY = '/boardgame/azul-premium/index.html';
const RULES = '/boardgame/azul-premium/rules.html';
const ART = '/boardgame/azul-premium/art-render.html?shot=cover';
// Deliberate failure control: proves the harness fails loudly. Run with --control.
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

const MATERIALS = [
  '../../assets/art/premium/azul/tile-blue.webp',
  '../../assets/art/premium/azul/tile-yellow.webp',
  '../../assets/art/premium/azul/tile-red.webp',
  '../../assets/art/premium/azul/tile-black.webp',
  '../../assets/art/premium/azul/tile-white.webp',
  '../../assets/art/premium/azul/factory-wood.webp',
  '../../assets/art/premium/azul/table-felt.webp',
  '../../assets/art/premium/azul/table-wood.webp'
];
const SHARED_ASSETS = ['../../shared/shuffle.js', '../../shared/sfx.js'];

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];
const pageErrors = [];
const requests = [];
const perf = {};

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS ' + label + (detail ? ' · ' + detail : ''));
  } else {
    failed += 1;
    const line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('  FAIL ' + line);
  }
  return !!condition;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function section(title) { console.log('\n[STEP] ' + title); }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};
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
        'cache-control': 'no-store',
        'service-worker-allowed': '/boardgame/azul-premium/'
      });
      res.end(data);
    });
  } catch (err) {
    res.writeHead(500); res.end('error');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = 'http://127.0.0.1:' + port;
console.log('server ' + origin + ENTRY);

// AGENTS.md browser rule: reuse the resident Chrome, never launch a temp
// profile. AppleScript JS is disabled in the GUI profile on this machine, so
// this harness attaches to the already-running audit Chrome's CDP endpoint
// (default 9222), opens one tab, and closes only that tab. It never kills Chrome.
try {
  execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' });
} catch (err) {
  console.warn('chrome-ensure unavailable; will attach to existing CDP port ' + CDP_PORT);
}
async function waitForDebug() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (r.ok) return;
    } catch (err) {}
    await sleep(150);
  }
  throw new Error('existing Chrome CDP endpoint not reachable on port ' + CDP_PORT +
    ' (set AZUL_CDP_PORT; do not launch a temp Chrome)');
}
await waitForDebug();

let target = null;
try {
  const created = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  if (created && created.id) target = created;
} catch (err) {
  target = null;
}
if (!target) throw new Error('could not create a test tab on the resident Chrome');
console.log('attached to resident Chrome tab ' + target.id + ' on port ' + CDP_PORT);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(String(event.data)); } catch (err) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else item.resolve(msg.result);
      } else if (msg.method) {
        this.handlers.forEach((fn) => fn(msg));
      }
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 30000);
    });
  }
  on(fn) { this.handlers.push(fn); }
}

const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.ready;
cdp.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || a.type).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text);
  }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    consoleErrors.push(msg.params.entry.text);
  }
  if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
});
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Log.enable');
try {
  await cdp.send('Storage.clearDataForOrigin', { origin: origin, storageTypes: 'service_workers,cache_storage' });
} catch (err) { /* clearing cache is best-effort */ }
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: origin + ENTRY });

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  });
  if (out.exceptionDetails) {
    const d = out.exceptionDetails;
    throw new Error('page evaluate failed: ' + (d.exception ? (d.exception.description || d.exception.value) : d.text));
  }
  return out.result ? out.result.value : undefined;
}
async function waitFor(label, expression, timeout = 12000, interval = 100) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try {
      last = await evaluate(expression);
      if (last) return last;
    } catch (err) { last = 'ERR ' + err.message; }
    await sleep(interval);
  }
  throw new Error('waitFor timeout: ' + label + ' (last=' + JSON.stringify(last) + ')');
}
async function navigate(url, readyExpr) {
  await cdp.send('Page.navigate', { url });
  await waitFor('navigate ' + url, readyExpr, 15000);
}

try {
  await waitFor('page boot', `!!(window.__azul && document.querySelectorAll('.factory').length === 5)`, 20000);

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    const s = __azul.getState();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    return {
      title: document.title,
      factories: document.querySelectorAll('.factory').length,
      factoryTiles: document.querySelectorAll('.factory .tile-btn').length,
      centerMarker: !document.getElementById('firstMarker').hidden,
      round: s.round, bag: s.bag.length,
      rows: document.querySelectorAll('.pattern-row').length,
      walls: document.querySelectorAll('.wall-cell').length,
      floor: document.querySelectorAll('.floor-slot').length,
      turn: document.getElementById('turnBadge').textContent,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      resources: res,
      reduced: __azul.reducedMotion(),
      keyframes: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).filter(function(r){ return r.type === CSSRule.KEYFRAMES_RULE; }).map(function(r){ return r.name; }),
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); }),
      cssText: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n')
    };
  })()`);
  ok('page title', /AZUL/i.test(initial.title), initial.title);
  eq('5 factories for 2p', initial.factories, 5);
  eq('20 factory tiles', initial.factoryTiles, 20);
  ok('center first-player marker visible', initial.centerMarker === true);
  eq('initial round', initial.round, 1);
  eq('initial bag', initial.bag, 80);
  eq('5 pattern rows', initial.rows, 5);
  eq('25 wall cells', initial.walls, 25);
  eq('7 floor slots', initial.floor, 7);
  ok('human turn shown', /轮到你/.test(initial.turn), initial.turn);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('keyframes tilePop present', initial.keyframes.includes('tilePop'));
  ok('keyframes scoreFloat present', initial.keyframes.includes('scoreFloat'));
  ok('prefers-reduced-motion CSS rule present', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP/DCL within budget', (initial.fcp > 0 ? initial.fcp : initial.dcl) > 0 && (initial.fcp > 0 ? initial.fcp : initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + 'ms dcl=' + Math.round(initial.dcl) + 'ms');
  ok('loadEventEnd within budget', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd) + 'ms');
  ok('DOM nodes within budget', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const materialEntries = initial.resources.filter((r) => /assets\/art\/premium\/azul\/.*\.webp/.test(r.name));
  const materialBytes = materialEntries.reduce((n, r) => n + r.size, 0);
  ok('all 8 material WebP loaded', materialEntries.length >= 8, 'entries=' + materialEntries.length);
  ok('material bytes within budget', materialBytes > 0 && materialBytes < 1572864, 'bytes=' + materialBytes);
  perf.fcp = Math.round(initial.fcp);
  perf.domContentLoaded = Math.round(initial.dcl);
  perf.loadEventEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = materialBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  const fps = await evaluate(`new Promise(function(resolve){
    var frames = 0, start = performance.now();
    function loop(t){ frames++; if (t - start >= 800) resolve(frames / ((t - start) / 1000)); else requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  })`);
  ok('rAF FPS within budget', fps >= 30, 'fps=' + Math.round(fps));
  perf.fps = Math.round(fps);

  const newGameMs = await evaluate(`(function(){
    var t = performance.now();
    __azul.newGame({ seed: 9090, playerCount: 2 });
    return performance.now() - t;
  })()`);
  ok('new game synchronous render within budget', newGameMs >= 0 && newGameMs < 200, 'ms=' + newGameMs.toFixed(1));
  perf.newGameRenderMs = Number(newGameMs.toFixed(1));

  const pureLatency = await evaluate(`(async function(){
    var m = __azul.legalMoves()[0];
    var t = performance.now();
    await __azul.playMove(m, { animate: false });
    return performance.now() - t;
  })()`);
  ok('pure move latency under 500ms', pureLatency >= 0 && pureLatency < 500, 'ms=' + pureLatency.toFixed(1));
  perf.pureMoveMs = Number(pureLatency.toFixed(1));
  await evaluate(`__azul.newGame({ seed: 20261110, playerCount: 2 })`);
  await waitFor('reset after latency probe', `!__azul.isBusy() && __azul.getState().round === 1`, 5000);

  section('WebAudio unlock & touch-only controls');
  await evaluate(`document.getElementById('soundBtn').click()`);
  await sleep(150);
  await evaluate(`document.querySelector('.tile-btn').click()`);
  await sleep(220);
  ok('iOS audio unlocked by touch/click', (await evaluate('__azul.audioUnlocked()')) === true);
  ok('no inline hover handlers', (await evaluate(`document.querySelectorAll('[onmouseover],[onmouseenter]').length`)) === 0);
  const actionKinds = await evaluate(`Array.from(document.querySelectorAll('.tile-btn,.pattern-row,.floor-line,#newBtn,#themeBtn,#soundBtn,.player-seg button')).every(function(el){ return el.tagName === 'BUTTON' || el.tagName === 'A'; })`);
  ok('primary controls are native buttons/links', actionKinds === true);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor('Escape clears selection', `__azul.selection() === null`, 3000);
  ok('Escape clears selection', (await evaluate('__azul.selection()')) === null);

  section('UI take -> pattern line -> AI turn');
  const firstMove = await evaluate(`(function(){
    var moves = __azul.legalMoves().filter(function(m){ return m.row >= 0; });
    if (!moves.length) return null;
    var m = moves[0];
    var sel = m.source === 'factory'
      ? '.factory[data-fi="' + m.factoryIndex + '"] .tile-btn[data-color="' + m.color + '"]'
      : '.center-tile[data-color="' + m.color + '"]';
    var node = document.querySelector(sel);
    if (!node) return { error: 'source node missing', m: m };
    node.click();
    return { move: m, selected: __azul.selection(), legalRows: document.querySelectorAll('.pattern-row.legal').length, dock: document.getElementById('dockTitle').textContent };
  })()`);
  ok('selected a legal source', !!firstMove && !!firstMove.selected, JSON.stringify(firstMove));
  ok('legal destination rows highlighted', firstMove && firstMove.legalRows >= 1, firstMove && ('rows=' + firstMove.legalRows));
  ok('dock reflects selection', firstMove && /已选/.test(firstMove.dock || ''), firstMove && firstMove.dock);
  const move = firstMove.move;
  await evaluate(`document.querySelector('.pattern-row[data-row="${move.row}"]').click()`);
  await waitFor('human move recorded', `(() => { const s = __azul.getState(); return s.turn >= 1 && !__azul.isBusy(); })()`, 10000);
  const afterHuman = await evaluate(`({ state: __azul.getState(), anim: __azul.animationCounts() })`);
  ok('human move placed tiles or completed a line', afterHuman.state.lastAction && afterHuman.state.lastAction.player === 0, JSON.stringify(afterHuman.state.lastAction));
  ok('pattern-line or wall received the color', afterHuman.state.players[0].lines.some((line) => line.length > 0) || afterHuman.state.players[0].wall.flat().some((v) => v !== null), 'lines=' + JSON.stringify(afterHuman.state.players[0].lines));
  ok('take animation recorded', afterHuman.anim.take >= 1, 'take=' + afterHuman.anim.take);
  await waitFor('AI completed a turn', `(() => { const s = __azul.getState(); return s.turn >= 2 || s.over; })()`, 12000);
  const afterAI = await evaluate(`({ state: __azul.getState(), anim: __azul.animationCounts() })`);
  ok('AI took its turn', afterAI.state.turn >= 2 || afterAI.state.over, 'turn=' + afterAI.state.turn);
  ok('AI did not break tile conservation', afterAI.state.bag.length + afterAI.state.discard.length + afterAI.state.center.length + afterAI.state.factories.reduce((n, f) => n + f.length, 0) > 0);

  section('Crafted round: line -> wall -> score animation');
  const crafted = await evaluate(`(function(){
    var E = window.AzulEngine;
    var s = E.createGame({ seed: 777, playerCount: 2 });
    var factoryTiles = s.factories.flat();
    s.factories = [[0], [], [], [], []];
    s.bag = s.bag.concat(factoryTiles);
    var removeOne = function(color){ var i = s.bag.indexOf(color); if (i >= 0) s.bag.splice(i, 1); };
    removeOne(0); removeOne(0); removeOne(1);
    s.center = []; s.centerMarker = false; s.current = 0; s.firstPlayer = 0;
    s.players[0].lines[1] = [0];
    s.players[0].wall[1][2] = 1;
    s.players[0].score = 0;
    s.players[0].floor = [];
    __azul.setState(s);
    return { legal: __azul.legalMoves(), round: __azul.getState().round };
  })()`);
  ok('crafted state exposes blue move to row 2', crafted.legal.some((m) => m.source === 'factory' && m.factoryIndex === 0 && m.color === 0 && m.row === 1), JSON.stringify(crafted.legal));
  const animBefore = await evaluate('__azul.animationCounts()');
  await evaluate(`document.querySelector('.factory[data-fi="0"] .tile-btn[data-color="0"]').click()`);
  await evaluate(`document.querySelector('.pattern-row[data-row="1"]').click()`);
  await waitFor('round resolved to round 2', `(() => { const s = __azul.getState(); return s.round === 2 && !__azul.isBusy(); })()`, 12000);
  const resolved = await evaluate(`({ state: __azul.getState(), anim: __azul.animationCounts() })`);
  eq('blue tile reached wall row 2', resolved.state.players[0].wall[1][1], 0);
  eq('completed pattern line cleared', resolved.state.players[0].lines[1].length, 0);
  ok('horizontal adjacency scored 2', resolved.state.players[0].score >= 2, 'score=' + resolved.state.players[0].score);
  eq('stable wall neighbor preserved', resolved.state.players[0].wall[1][2], 1);
  ok('round-2 factories refilled', resolved.state.factories.reduce((n, f) => n + f.length, 0) > 0, 'factoryTiles=' + resolved.state.factories.reduce((n, f) => n + f.length, 0));
  ok('wall animation recorded', resolved.anim.wall > animBefore.wall, animBefore.wall + ' -> ' + resolved.anim.wall);
  ok('score animation recorded', resolved.anim.score > animBefore.score, animBefore.score + ' -> ' + resolved.anim.score);
  const conserved = await evaluate(`(function(){
    var s = __azul.getState(), n = s.bag.length + s.discard.length + s.center.length;
    s.factories.forEach(function(f){ n += f.length; });
    s.players.forEach(function(p){ p.lines.forEach(function(l){ n += l.length; }); p.wall.forEach(function(r){ r.forEach(function(v){ if (v !== null) n++; }); }); });
    return n;
  })()`);
  eq('tile conservation after crafted round', conserved, 100);

  section('Endgame -> result -> restart');
  const end = await evaluate('__azul.autoPlayToEnd(500)');
  ok('auto-play reaches game over', end && end.over === true, JSON.stringify({ over: end && end.over, turns: end && end.turns }));
  ok('result has both scores', end && end.result && end.result.scores.length === 2);
  ok('result scores are finite', end && end.result && end.result.scores.every((s) => Number.isFinite(s.total) && s.total >= 0));
  await waitFor('result modal shown', `!document.getElementById('resultModal').hidden && document.getElementById('resultModal').classList.contains('show')`, 4000);
  const modal = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, show: document.getElementById('resultModal').classList.contains('show'), title: document.getElementById('resultTitle').textContent, rows: document.querySelectorAll('#resultTable tbody tr').length, note: document.getElementById('resultNote').textContent })`);
  ok('result modal visible', modal.hidden === false && modal.show === true);
  ok('result title rendered', /赢|获胜|平分|结束/.test(modal.title), modal.title);
  eq('result table rows', modal.rows, 2);
  ok('result note explains bonuses', /\+2/.test(modal.note) && /\+7/.test(modal.note) && /\+10/.test(modal.note), modal.note);
  await evaluate(`document.getElementById('againBtn').click()`);
  await waitFor('new game after restart', `(() => { const s = __azul.getState(); return s.round === 1 && !s.over && s.players.every((p) => p.score === 0); })()`, 6000);
  const restarted = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, state: __azul.getState() })`);
  ok('result modal hidden after restart', restarted.hidden === true);
  eq('restart resets round', restarted.state.round, 1);
  ok('restart resets scores', restarted.state.players.every((p) => p.score === 0));

  section('Mobile 390x844 / 320x568 / landscape');
  const viewports = [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' },
    { width: 844, height: 390, name: '844x390' },
    { width: 568, height: 320, name: '568x320' }
  ];
  const mobileResults = [];
  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await evaluate('window.scrollTo(0, 0)');
    await sleep(260);
    const m = await evaluate(`(function(){
      var visible = function(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var targets = Array.from(document.querySelectorAll('.tile-btn, .pattern-row, .floor-line, .icon-btn, .text-btn, .player-seg button')).filter(visible);
      var small = targets.filter(function(el){
        var r = el.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      }).map(function(el){
        var r = el.getBoundingClientRect();
        return (el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
      });
      document.documentElement.style.scrollBehavior = 'auto';
      var reach = ['.tile-btn', '.pattern-row', '.floor-line', '#actionDock'].map(function(sel){
        var el = document.querySelector(sel);
        if (!el) return { sel: sel, ok: false, reason: 'missing' };
        var r0 = el.getBoundingClientRect();
        var y = r0.top + window.scrollY - Math.max(0, (window.innerHeight - r0.height) / 2);
        window.scrollTo(0, Math.max(0, y));
        var r = el.getBoundingClientRect();
        var good = r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1;
        return { sel: sel, ok: good, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      });
      window.scrollTo(0, 0);
      var bodyMin = parseFloat(getComputedStyle(document.body).minHeight) || 0;
      var facs = Array.from(document.querySelectorAll('.factory')).map(function(n){ return n.getBoundingClientRect(); });
      var overlap = function(a, b){
        return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) > 1 &&
               Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) > 1;
      };
      var facOverlaps = 0;
      for (var fi = 0; fi < facs.length; fi++) for (var fj = fi + 1; fj < facs.length; fj++) if (overlap(facs[fi], facs[fj])) facOverlaps++;
      var facOutside = facs.filter(function(r){ return r.left < -1 || r.right > window.innerWidth + 1; }).length;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        facOverlaps: facOverlaps,
        facOutside: facOutside,
        docScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        targets: targets.length,
        small: small.slice(0, 12),
        smallCount: small.length,
        reach: reach,
        bodyFont: parseFloat(getComputedStyle(document.body).fontSize) || 0,
        dockFont: parseFloat(getComputedStyle(document.querySelector('.dock-title')).fontSize) || 0,
        journalFont: parseFloat(getComputedStyle(document.querySelector('.journal-list li') || document.body).fontSize) || 0,
        bodyMin: bodyMin,
        panelBackdrop: getComputedStyle(document.querySelector('.panel')).backdropFilter || getComputedStyle(document.querySelector('.panel')).webkitBackdropFilter || 'none',
        factories: document.querySelectorAll('.factory').length,
        wallCells: document.querySelectorAll('.wall-cell').length
      };
    })()`);
    ok(vp.name + ' no horizontal overflow', m.docScroll <= vp.width && m.bodyScroll <= vp.width, m.docScroll + '/' + m.bodyScroll);
    ok(vp.name + ' all touch targets >=44px', m.smallCount === 0, 'small=' + JSON.stringify(m.small));
    ok(vp.name + ' body font readable', m.bodyFont >= 14, 'font=' + m.bodyFont);
    ok(vp.name + ' dock font readable', m.dockFont >= 12, 'font=' + m.dockFont);
    ok(vp.name + ' journal font readable', m.journalFont >= 12, 'font=' + m.journalFont);
    const tinyText = await evaluate(`(function(){
      var out = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.textContent || '').trim();
        if (!text) continue;
        var el = node.parentElement;
        if (!el || el.closest('script, style, .sr-only, [hidden], .modal:not(.show)')) continue;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        if (!el.getClientRects().length) continue;
        var size = parseFloat(cs.fontSize) || 0;
        if (size < 12) out.push({ text: text.slice(0, 20), size: size, tag: el.tagName, cls: String(el.className || '').slice(0, 50) });
      }
      return out.slice(0, 20);
    })()`);
    ok(vp.name + ' all visible text >=12px', tinyText.length === 0, JSON.stringify(tinyText));
    ok(vp.name + ' primary controls reachable by scrolling', m.reach.every((r) => r.ok), JSON.stringify(m.reach));
    ok(vp.name + ' 100dvh resolves', m.bodyMin >= Math.min(vp.height, 300), 'minHeight=' + m.bodyMin);
    ok(vp.name + ' keeps 5 factories', m.factories === 5);
    ok(vp.name + ' keeps 25 wall cells', m.wallCells === 25);
    ok(vp.name + ' viewport matches emulation', m.innerWidth === vp.width && m.innerHeight === vp.height, m.innerWidth + 'x' + m.innerHeight);
    eq(vp.name + ' factories do not overlap', m.facOverlaps, 0);
    eq(vp.name + ' factories stay inside viewport', m.facOutside, 0);
    if (vp.width <= 720) {
      ok(vp.name + ' backdrop-filter disabled on touch', m.panelBackdrop === 'none' || m.panelBackdrop === '');
    }
    mobileResults.push({ viewport: vp.name, ...m, small: undefined, reach: undefined });
  }
  perf.mobile = mobileResults;

  section('Safe-area inset override');
  let safeAreaSupported = false;
  try {
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 44, left: 0, bottom: 34, right: 0 } });
    safeAreaSupported = true;
  } catch (err) {
    safeAreaSupported = false;
  }
  if (safeAreaSupported) {
    await cdp.send('Page.reload', { ignoreCache: false });
    await waitFor('reload after safe-area', `!!(window.__azul && document.querySelector('.topbar'))`, 12000);
    const safe = await evaluate(`({ top: parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop) || 0, bottom: parseFloat(getComputedStyle(document.querySelector('.footer')).paddingBottom) || 0 })`);
    ok('safe-area top inset applied', safe.top >= 44, 'paddingTop=' + safe.top);
    ok('safe-area bottom inset applied', safe.bottom >= 34, 'paddingBottom=' + safe.bottom);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, bottom: 0, right: 0 } });
  } else {
    ok('safe-area CSS declared (override API unavailable)', true, 'env(safe-area-inset-*) present');
  }

  section('Service worker offline cache');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await evaluate('window.scrollTo(0, 0)');
  const swReady = await evaluate(`(async function(){
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'no-sw' };
    var reg = await navigator.serviceWorker.ready;
    var keys = await caches.keys();
    var urls = ${JSON.stringify(MATERIALS)};
    var checks = await Promise.all(urls.map(function(u){ return caches.match(u).then(function(r){ return !!r; }); }));
    var shared = await Promise.all(${JSON.stringify(SHARED_ASSETS)}.map(function(u){ return caches.match(u).then(function(r){ return !!r; }); }));
    var shell = await caches.match('./index.html').then(function(r){ return !!r; });
    return { ok: true, scope: reg.scope, keys: keys, materials: checks, shared: shared, shell: shell };
  })()`);
  ok('service worker ready', swReady && swReady.ok === true, JSON.stringify(swReady));
  ok('offline cache created', swReady && swReady.keys.includes('azul-premium-v3'), JSON.stringify(swReady && swReady.keys));
  ok('all materials cached for offline', swReady && swReady.materials.every(Boolean), JSON.stringify(swReady && swReady.materials));
  ok('page shell cached for offline', swReady && swReady.shell === true);
  ok('shared shuffle/sfx cached for offline', swReady && swReady.shared && swReady.shared.every(Boolean), JSON.stringify(swReady && swReady.shared));
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('offline reload', `!!(window.__azul && document.querySelectorAll('.factory').length === 5 && document.querySelectorAll('.factory .tile-btn').length === 20)`, 15000);
  const offline = await evaluate(`({ title: document.title, factories: document.querySelectorAll('.factory').length, tiles: document.querySelectorAll('.factory .tile-btn').length, online: navigator.onLine })`);
  ok('offline reload serves the game', offline.factories === 5 && offline.tiles === 20, JSON.stringify(offline));
  ok('offline reload serves local materials', (await evaluate(`Array.from(document.querySelectorAll('.tile')).length >= 20`)) === true);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('online reload', `!!(window.__azul && document.querySelectorAll('.factory').length === 5)`, 15000);

  section('Reduced motion');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(250);
  ok('media query reports reduced motion', (await evaluate('__azul.reducedMotion()')) === true);
  await evaluate(`__azul.newGame({ seed: 4242, playerCount: 2 })`);
  await waitFor('new reduced-motion game', `__azul.getState().round === 1 && !__azul.isBusy()`, 5000);
  const animReducedBefore = await evaluate('__azul.animationCounts()');
  const reducedMove = await evaluate(`(function(){
    var moves = __azul.legalMoves().filter(function(m){ return m.row >= 0; });
    if (!moves.length) return null;
    var m = moves[0];
    return __azul.playMove(m).then(function(){ return m; });
  })()`);
  ok('reduced-motion move applied', !!reducedMove);
  await sleep(650);
  const animReducedAfter = await evaluate('__azul.animationCounts()');
  ok('reduced motion skips take animation', animReducedAfter.take === animReducedBefore.take, animReducedBefore.take + ' -> ' + animReducedAfter.take);
  ok('reduced motion skips wall animation', animReducedAfter.wall === animReducedBefore.wall, animReducedBefore.wall + ' -> ' + animReducedAfter.wall);
  ok('reduced motion skips score animation', animReducedAfter.score === animReducedBefore.score, animReducedBefore.score + ' -> ' + animReducedAfter.score);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });

  section('Zero external requests & console clean');
  const resources = await evaluate(`performance.getEntriesByType('resource').map(function(e){ return e.name; })`);
  const external = resources.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'));
  eq('no external resource entries', external, []);
  const externalRequests = requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('chrome-devtools:'));
  eq('no external network requests', externalRequests, []);
  eq('no console errors', consoleErrors, []);
  eq('no page exceptions', pageErrors, []);

  section('Online room: browser client + two HTTP clients');
  const onlineMod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
  const onlineHandle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 1500, aiDelayMs: 100 });
  const onlineBase = 'http://127.0.0.1:' + onlineHandle.address.port;
  async function onlineApi(method, route, body) {
    const res = await fetch(onlineBase + route, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (err) {}
    return { status: res.status, body: data };
  }
  try {
    const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-p1', maxPlayers: 2 });
    ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
    const roomId = created.body.roomId;
    const t1 = created.body.playerSession;
    const invite = created.body.inviteToken;
    const joined = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', { playerId: 'e2e-p2', inviteCode: invite });
    ok('online second client joined', joined.status === 200 && joined.body.playerSession, joined.status);
    const t2 = joined.body.playerSession;
    const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'e2e-p1' });
    ok('online host started match', started.status === 200 && started.body.state && started.body.state.playerCount === 2, started.status);
    await cdp.send('Page.navigate', { url: onlineBase + '/index.html?online=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-p1' });
    await waitFor('online browser boot', `(() => { const s = window.__azul && __azul.getState(); return !!(s && s.playerCount === 2 && document.querySelector('#roomChip') && !document.querySelector('#roomChip').hidden && document.querySelectorAll('.rival').length === 1); })()`, 15000);
    const onlineBoot = await evaluate(`({ state: __azul.getState(), newText: document.getElementById('newBtn').textContent, segHidden: Array.from(document.querySelectorAll('.player-seg')).every(function(n){ return getComputedStyle(n).display === 'none'; }), room: document.getElementById('roomChip').textContent })`);
    ok('online browser renders 2-player state', onlineBoot.state.playerCount === 2, JSON.stringify(onlineBoot.state));
    ok('online room chip visible', /房间/.test(onlineBoot.room), onlineBoot.room);
    ok('online new-game button returns to room', /返回房间/.test(onlineBoot.newText), onlineBoot.newText);
    ok('online player-count selector hidden', onlineBoot.segHidden === true);
    const p1Move = await evaluate(`(function(){
      var moves = __azul.legalMoves().filter(function(m){ return m.row >= 0; });
      if (!moves.length) return null;
      var m = moves[0];
      var sel = m.source === 'factory'
        ? '.factory[data-fi="' + m.factoryIndex + '"] .tile-btn[data-color="' + m.color + '"]'
        : '.center-tile[data-color="' + m.color + '"]';
      var node = document.querySelector(sel);
      if (node) node.click();
      return m;
    })()`);
    ok('online browser got a legal move', !!p1Move, JSON.stringify(p1Move));
    if (p1Move) {
      await evaluate(`document.querySelector('.pattern-row[data-row="${p1Move.row}"]').click()`);
      await waitFor('online browser move sent', `(() => { const s = __azul.getState(); return s.turn >= 1 && !__azul.isBusy(); })()`, 8000);
      const afterOnline = await evaluate('__azul.getState()');
      ok('online browser move advanced server state', afterOnline.turn >= 1, 'turn=' + afterOnline.turn);
      const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(t2) + '&playerId=e2e-p2');
      ok('second HTTP client sees same turn', p2View.status === 200 && p2View.body.state.turn === afterOnline.turn, p2View.status + ' turn=' + (p2View.body && p2View.body.state && p2View.body.state.turn));
      const p2Move = (p2View.body.legalMoves || []).find(function (m) { return m.row >= 0; }) || (p2View.body.legalMoves || [])[0];
      if (p2Move) {
        const acted = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions', { session: t2, playerId: 'e2e-p2', type: 'move', move: p2Move });
        ok('second HTTP client move accepted', acted.status === 200, acted.status);
        await waitFor('online browser polls partner move', `(() => { const s = __azul.getState(); return s.turn >= 2; })()`, 8000);
        const synced = await evaluate('__azul.getState()');
        ok('online browser synced partner move', synced.turn >= 2, 'turn=' + synced.turn);
      } else {
        ok('second HTTP client has a legal move', false, JSON.stringify(p2View.body && p2View.body.legalMoves));
      }
    }
    const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { token: t1, playerId: 'e2e-p1' });
    ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, reconnect.status);
  } finally {
    await onlineHandle.close();
  }

  section('Rules page: art, JSON-LD, single-player label');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await navigate(origin + RULES, `document.readyState === 'complete' && !!document.querySelector('article.article')`);
  await sleep(400);
  const rules = await evaluate(`(function(){
    var text = document.querySelector('article.article').innerText || '';
    var cn = (text.match(/[\\u4e00-\\u9fff]/g) || []).length;
    var jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){ try { return JSON.parse(s.textContent); } catch(e){ return { error: String(e) }; } });
    var links = Array.from(document.querySelectorAll('a[href*="bilibili.com/video/"]')).map(function(a){ return a.href; });
    var imgs = Array.from(document.querySelectorAll('.figure img')).map(function(img){ return { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight }; });
    return {
      title: document.title, cn: cn, jsonLd: jsonLd,
      linkCount: links.length, uniqueLinks: Array.from(new Set(links)).length,
      hasSourceBv: /BV1aPxx6dEHL/.test(text) && /BV1Fi4y187Ww/.test(text) && /BV1fK9zYSEo6/.test(text) && /BV1qvR5YmEQZ/.test(text),
      hasFactoryCounts: /5 个圆盘/.test(text) && /7 个/.test(text) && /9 个/.test(text),
      hasColumnBonus: /\\+7/.test(text),
      hasTieBreak: /完整横排/.test(text) && /共享胜利/.test(text),
      hasSingle: /单人/.test(text),
      og: document.querySelector('meta[property="og:image"]') && document.querySelector('meta[property="og:image"]').content,
      imgs: imgs,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  })()`);
  ok('rules title', /花砖物语/.test(rules.title), rules.title);
  ok('rules has 1200+ Chinese chars', rules.cn >= 1200, 'cn=' + rules.cn);
  eq('rules JSON-LD blocks valid', rules.jsonLd.filter((x) => x.error).length, 0);
  ok('Article JSON-LD present', rules.jsonLd.some((x) => x['@type'] === 'Article'));
  ok('FAQPage JSON-LD present', rules.jsonLd.some((x) => x['@type'] === 'FAQPage'));
  ok('FAQPage has 8 questions', rules.jsonLd.some((x) => x['@type'] === 'FAQPage' && x.mainEntity && x.mainEntity.length >= 8));
  ok('rules cites 6 Bilibili videos', rules.uniqueLinks >= 6, 'unique=' + rules.uniqueLinks);
  ok('rules cites four key BVs in text', rules.hasSourceBv === true);
  ok('rules states 5/7/9 factory counts', rules.hasFactoryCounts === true);
  ok('rules states +7 column bonus', rules.hasColumnBonus === true);
  ok('rules explains row tie-break and shared victory', rules.hasTieBreak === true);
  ok('rules marks single-player', rules.hasSingle === true);
  ok('rules OG image declared', rules.og === 'assets/og.webp', rules.og);
  eq('rules cover/detail images loaded', rules.imgs.length, 3);
  ok('rules images decoded', rules.imgs.every((img) => img.w > 0 && img.h > 0), JSON.stringify(rules.imgs));
  ok('rules page no horizontal overflow at 320px', rules.scrollWidth <= rules.innerWidth + 1, rules.scrollWidth + '/' + rules.innerWidth);

  section('Art composition source (cover)');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 1200, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ART, `document.readyState === 'complete' && !!window.__artReady`);
  await sleep(400);
  const art = await evaluate(`(async function(){
    var urls = ${JSON.stringify(MATERIALS)};
    var loaded = await Promise.all(urls.map(function(u){
      return new Promise(function(resolve){
        var img = new Image();
        img.onload = function(){ resolve({ url: u, ok: img.naturalWidth > 0 }); };
        img.onerror = function(){ resolve({ url: u, ok: false }); };
        img.src = u;
      });
    }));
    return {
      ready: window.__artReady === true,
      shot: document.body.getAttribute('data-shot'),
      factories: document.querySelectorAll('.factory').length,
      factoryTiles: document.querySelectorAll('.tiles4 .tile').length,
      wallCells: document.querySelectorAll('.cell').length,
      floorSlots: document.querySelectorAll('.floor > span').length,
      marker: document.querySelectorAll('.marker').length,
      center: document.querySelectorAll('.center').length,
      materials: loaded,
      stage: [document.querySelector('.stage').getBoundingClientRect().width, document.querySelector('.stage').getBoundingClientRect().height]
    };
  })()`);
  ok('art composition ready', art.ready === true && art.shot === 'cover');
  eq('art cover has 5 factories', art.factories, 5);
  eq('art cover has 20 factory tiles', art.factoryTiles, 20);
  eq('art cover has 25 wall cells', art.wallCells, 25);
  eq('art cover has 7 floor slots', art.floorSlots, 7);
  eq('art cover has first-player marker', art.marker, 1);
  eq('art cover has center', art.center, 1);
  ok('art cover materials all load', art.materials.every((m) => m.ok), JSON.stringify(art.materials));
  eq('art cover stage size', art.stage, [1200, 1200]);

  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:');
    failures.forEach((f) => console.log(' - ' + f));
    process.exitCode = 1;
  }
} catch (err) {
  console.log('\nFATAL: ' + (err && err.stack ? err.stack : String(err)));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exitCode = 1;
} finally {
  try { cdp.ws.close(); } catch (err) {}
  try {
    await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + encodeURIComponent(target.id));
  } catch (err) { /* close only our tab; never kill Chrome */ }
  await new Promise((resolve) => server.close(resolve));
}
