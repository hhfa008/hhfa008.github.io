#!/usr/bin/env node
/*
 * Lost Cities premium — browser E2E over the resident Chrome CDP endpoint.
 *
 *   node games/boardgame/lost-cities-premium/e2e.mjs
 *   node games/boardgame/lost-cities-premium/e2e.mjs --control  # exit 1
 *
 * Covers real clicks, AI, round transition, endgame/restart, mobile widths,
 * touch/font budgets, reduced motion, WebAudio, service-worker offline,
 * rules JSON-LD/sources, online browser client, and the code-composed art.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.LC_CDP_PORT || 9222);
const ENTRY = '/boardgame/lost-cities-premium/index.html';
const RULES = '/boardgame/lost-cities-premium/rules.html';
const ART = '/boardgame/lost-cities-premium/art-render.html?shot=cover';
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

const MATERIALS = [
  '../../assets/art/premium/lost-cities/card-paper.webp',
  '../../assets/art/premium/lost-cities/compass.webp',
  '../../assets/art/premium/lost-cities/stone-tablet.webp',
  '../../assets/art/premium/lost-cities/jungle-felt.webp',
  '../../assets/art/premium/lost-cities/wood-chest.webp',
  '../../assets/art/premium/lost-cities/wager-seal.webp',
  '../../assets/art/premium/lost-cities/map-scroll.webp'
];
const SHARED_ASSETS = ['../../shared/shuffle.js', '../../shared/sfx.js'];
const COVER_ASSETS = [
  'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'
];

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];
const pageErrors = [];
const requests = [];
const perf = {};
const seenOrigins = new Set();

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
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.slice(1, 4).toString() !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

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
        'service-worker-allowed': '/boardgame/lost-cities-premium/'
      });
      res.end(data);
    });
  } catch (err) {
    res.writeHead(500); res.end('error');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
seenOrigins.add(origin);
console.log('server ' + origin + ENTRY);

try {
  execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' });
} catch (err) {
  console.warn('chrome-ensure unavailable; attaching to existing CDP ' + CDP_PORT);
}
async function waitForDebug() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (r.ok) return;
    } catch (err) {}
    await sleep(150);
  }
  throw new Error('resident Chrome CDP not reachable on ' + CDP_PORT);
}
await waitForDebug();

let target = null;
try {
  const created = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  if (created && created.id) target = created;
} catch (err) { target = null; }
if (!target) throw new Error('could not create a test tab on resident Chrome');
console.log('attached to resident Chrome tab ' + target.id);

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
} catch (err) {}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: origin + ENTRY });

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true, userGesture: true
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
  await waitFor('page boot', `!!(window.__lostcities && document.querySelectorAll('#humanBoard .lane').length === 5)`, 20000);

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    var s = __lostcities.getState();
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    return {
      title: document.title,
      desc: document.querySelector('meta[name=description]') && document.querySelector('meta[name=description]').content,
      viewport: document.querySelector('meta[name=viewport]') && document.querySelector('meta[name=viewport]').content,
      aiLanes: document.querySelectorAll('#aiBoard .lane').length,
      humanLanes: document.querySelectorAll('#humanBoard .lane').length,
      discardPiles: document.querySelectorAll('#discardRail .discard-pile').length,
      handCards: document.querySelectorAll('#hand .card-btn').length,
      deck: s.deck.length,
      hands: s.players.map(function(p){ return p.hand.length; }),
      round: s.round,
      phase: s.phase,
      current: s.current,
      turnText: document.getElementById('statusChip').textContent,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      resources: res,
      reduced: __lostcities.reducedMotion(),
      keyframes: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).filter(function(r){ return r.type === CSSRule.KEYFRAMES_RULE; }).map(function(r){ return r.name; }),
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); }),
      cssText: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n'),
      materialSeen: res.filter(function(r){ return /assets\\/art\\/premium\\/lost-cities\\/.*\\.webp/.test(r.name); }).length,
      backdrop: getComputedStyle(document.querySelector('.play-area')).backdropFilter || 'none'
    };
  })()`);
  ok('page title', /失落之城/.test(initial.title), initial.title);
  ok('meta description', /Lost Cities|失落之城/.test(initial.desc || '') && initial.desc.length > 30);
  ok('viewport width=device-width', /width\s*=\s*device-width/i.test(initial.viewport || ''));
  eq('5 AI lanes', initial.aiLanes, 5);
  eq('5 human lanes', initial.humanLanes, 5);
  eq('5 shared discard piles', initial.discardPiles, 5);
  eq('8 hand cards', initial.handCards, 8);
  eq('44-card deck', initial.deck, 44);
  eq('8 cards each', initial.hands, [8, 8]);
  eq('round 1', initial.round, 1);
  eq('phase play', initial.phase, 'play');
  eq('human starts', initial.current, 0);
  ok('turn badge says you', /轮到你/.test(initial.turnText), initial.turnText);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('FCP/DCL within budget', (initial.fcp > 0 ? initial.fcp : initial.dcl) > 0 && (initial.fcp > 0 ? initial.fcp : initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + 'ms dcl=' + Math.round(initial.dcl) + 'ms');
  ok('loadEventEnd within budget', (initial.loadEnd > 0 ? initial.loadEnd : initial.dcl) < 4000, 'load=' + Math.round(initial.loadEnd) + 'ms dcl=' + Math.round(initial.dcl) + 'ms');
  ok('DOM nodes within budget', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  ok('prefers-reduced-motion CSS rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  const materialEntries = initial.resources.filter((r) => /assets\/art\/premium\/lost-cities\/.*\.webp/.test(r.name));
  const materialBytes = materialEntries.reduce((n, r) => n + r.size, 0);
  ok('all 7 material WebP loaded', initial.materialSeen >= 7, 'seen=' + initial.materialSeen);
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
  const newGameMs = await evaluate(`(function(){ var t=performance.now(); __lostcities.newGame({seed:9090}); return performance.now()-t; })()`);
  ok('new game render under 200ms', newGameMs >= 0 && newGameMs < 200, 'ms=' + newGameMs.toFixed(1));
  perf.newGameRenderMs = Number(newGameMs.toFixed(1));
  const pureLatency = await evaluate(`(async function(){ var m=__lostcities.legalMoves()[0]; var t=performance.now(); await __lostcities.playMove(m,{animate:false}); return performance.now()-t; })()`);
  ok('pure move latency under 500ms', pureLatency >= 0 && pureLatency < 500, 'ms=' + pureLatency.toFixed(1));
  perf.pureMoveMs = Number(pureLatency.toFixed(1));
  eq('isBusy false after move', await evaluate('__lostcities.isBusy()'), false);
  await evaluate(`__lostcities.newGame({seed:20261110})`);
  await waitFor('reset', `!__lostcities.isBusy() && __lostcities.getState().round === 1 && __lostcities.getState().current === 0`, 5000);

  section('WebAudio, keyboard, native controls');
  await evaluate(`document.getElementById('soundBtn').click()`);
  await sleep(260);
  ok('WebAudio unlocked by click', (await evaluate('__lostcities.audioUnlocked()')) === true);
  ok('no inline hover handlers', (await evaluate(`document.querySelectorAll('[onmouseover],[onmouseenter]').length`)) === 0);
  const nativeOk = await evaluate(`Array.from(document.querySelectorAll('.card-btn,.expedition,.discard-pile,.deck-btn,.draw-btn,.text-btn,.icon-btn,.plain-link')).every(function(el){ return el.tagName === 'BUTTON' || el.tagName === 'A'; })`);
  ok('primary controls native buttons/links', nativeOk === true);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(100);
  eq('Escape clears selection', await evaluate('__lostcities.selection()'), null);

  section('Real click: play a card -> draw -> AI');
  const firstMove = await evaluate(`(function(){
    var moves = __lostcities.legalMoves().filter(function(m){ return m.type === 'play'; });
    if (!moves.length) return null;
    var m = moves[0];
    document.querySelector('#hand .card-btn[data-hand="' + m.handIndex + '"]').click();
    return { move: m, selected: __lostcities.selection(), dock: document.getElementById('dockText').textContent, legalLanes: document.querySelectorAll('#humanBoard .expedition.legal').length };
  })()`);
  ok('selected a legal hand card', !!firstMove && firstMove.selected === firstMove.move.handIndex, JSON.stringify(firstMove));
  ok('dock reflects selection', firstMove && /已选/.test(firstMove.dock || ''), firstMove && firstMove.dock);
  ok('legal expedition lane highlighted', firstMove && firstMove.legalLanes >= 1, firstMove && ('lanes=' + firstMove.legalLanes));
  await evaluate(`document.querySelector('#humanBoard .expedition[data-color="${firstMove.move.color}"]').click()`);
  await waitFor('human play applied', `(() => { var s=__lostcities.getState(); return !__lostcities.isBusy() && s.phase === 'draw'; })()`, 6000);
  const afterPlay = await evaluate(`({ state: __lostcities.getState(), anim: __lostcities.animationCounts(), drawDisabled: document.getElementById('deckBtn').disabled, dock: document.getElementById('drawDock').hidden })`);
  eq('human play recorded', afterPlay.state.lastAction.player, 0);
  eq('phase draw after play', afterPlay.state.phase, 'draw');
  eq('same player still draws', afterPlay.state.current, 0);
  ok('hand down to 7', afterPlay.state.players[0].hand.length === 7, 'hand=' + afterPlay.state.players[0].hand.length);
  eq('draw deck enabled', afterPlay.drawDisabled, false);
  eq('draw dock visible', afterPlay.dock, false);
  eq('play animation recorded', afterPlay.anim.play >= 1, true);
  await evaluate(`document.getElementById('deckBtn').click()`);
  await waitFor('AI turn completed', `(() => { var s=__lostcities.getState(); return !__lostcities.isBusy() && (s.over || s.current === 0) && s.turn >= 2; })()`, 12000);
  const afterAI = await evaluate(`({ state: __lostcities.getState(), anim: __lostcities.animationCounts() })`);
  ok('AI completed two actions', afterAI.state.turn >= 2 || afterAI.state.over, 'turn=' + afterAI.state.turn);
  eq('AI hand back to 8 after its turn', afterAI.state.players[1].hand.length, 8);
  ok('draw animation recorded', afterAI.anim.draw >= 1, 'draw=' + afterAI.anim.draw);
  ok('60 cards conserved after human+AI', (await evaluate(`__lostcities.engine.allCards(__lostcities.getState()).length`)) === 60);

  section('Round transition with a real click');
  const craftedRound = await evaluate(`(function(){
    var s = __lostcities.getState();
    s.phase = 'draw'; s.current = 0; s.pendingDiscard = null;
    s.deck = [s.deck[0]];
    __lostcities.setState(s);
    return { round: s.round, deck: s.deck.length, phase: s.phase };
  })()`);
  eq('crafted final-card draw phase', craftedRound.phase, 'draw');
  await evaluate(`document.getElementById('deckBtn').click()`);
  await waitFor('round 2 begins', `(() => { var s=__lostcities.getState(); return !__lostcities.isBusy() && s.round === 2 && !!s.lastRound; })()`, 6000);
  const round2 = await evaluate(`({ state: __lostcities.getState(), toast: document.getElementById('toast').textContent, last: document.getElementById('lastRound').textContent })`);
  eq('round advanced to 2', round2.state.round, 2);
  eq('round result recorded', round2.state.roundResults.length, 1);
  eq('last round reason', round2.state.lastRound.reason, '牌堆最后一张牌被抽走');
  eq('new hand 8', round2.state.players.map((p) => p.hand.length), [8, 8]);
  eq('new deck 44', round2.state.deck.length, 44);
  ok('round summary visible', /第 1 局结算/.test(round2.toast), round2.toast);
  ok('last-round scoreboard text', /上局/.test(round2.last), round2.last);

  section('Endgame -> result -> restart');
  const end = await evaluate('__lostcities.autoPlayToEnd(2000)');
  ok('auto-play reaches game over', end && end.over === true, JSON.stringify({ over: end && end.over, steps: end && end.steps }));
  ok('three round results', end && end.result && end.result.scores[0].roundScores.length === 3);
  ok('result scores finite', end && end.result && end.result.scores.every((s) => Number.isFinite(s.total)));
  await waitFor('result modal shown', `!document.getElementById('resultModal').hidden`, 4000);
  const modal = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, title: document.getElementById('resultTitle').textContent, rows: document.querySelectorAll('#resultBody tr').length, note: document.getElementById('resultNote').textContent })`);
  eq('result modal visible', modal.hidden, false);
  ok('result title rendered', /赢|共享|结束|归来/.test(modal.title), modal.title);
  eq('result table rows 2', modal.rows, 2);
  ok('result note lists totals', /累计/.test(modal.note) && /分/.test(modal.note), modal.note);
  await evaluate(`document.getElementById('againBtn').click()`);
  await waitFor('new game after restart', `(() => { var s=__lostcities.getState(); return s.round === 1 && !s.over && s.players.every(function(p){ return p.totalScore === 0; }); })()`, 6000);
  const restarted = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, state: __lostcities.getState(), hand: document.querySelectorAll('#hand .card-btn').length })`);
  eq('result modal hidden after restart', restarted.hidden, true);
  eq('restart resets round', restarted.state.round, 1);
  eq('restart resets totals', restarted.state.players.map((p) => p.totalScore), [0, 0]);
  eq('restart restores 8 cards', restarted.hand, 8);

  section('Mobile 390 / 320 / landscape');
  const viewports = [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' },
    { width: 844, height: 390, name: '844x390' },
    { width: 568, height: 320, name: '568x320' }
  ];
  const mobileResults = [];
  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await evaluate('window.scrollTo(0,0)');
    await sleep(260);
    const m = await evaluate(`(function(){
      var visible = function(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var targets = Array.from(document.querySelectorAll('.card-btn,.expedition,.discard-pile,.deck-btn,.draw-btn,.text-btn,.icon-btn,.plain-link')).filter(visible);
      var small = targets.filter(function(el){ var r=el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(function(el){ var r=el.getBoundingClientRect(); return (el.className||el.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height); });
      var tiny = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.textContent||'').trim(); if (!text) continue;
        var el = node.parentElement;
        if (!el || el.closest('script,style,.sr-only,[hidden]')) continue;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
        var fs = parseFloat(cs.fontSize)||0;
        if (fs && fs < 12) tiny.push({text:text.slice(0,16),size:fs});
      }
      var reach = ['.card-btn','.expedition','.discard-pile','#deckBtn','#hand'].map(function(sel){
        var el = document.querySelector(sel); if (!el) return {sel:sel,ok:false};
        var r0 = el.getBoundingClientRect();
        var y = r0.top + window.scrollY - Math.max(0,(window.innerHeight-r0.height)/2);
        window.scrollTo(0,Math.max(0,y));
        var r = el.getBoundingClientRect();
        return {sel:sel,ok:r.left>=-1&&r.right<=window.innerWidth+1&&r.top>=-1&&r.bottom<=window.innerHeight+1,rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]};
      });
      window.scrollTo(0,0);
      return {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        docScroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth,
        targets: targets.length, smallCount: small.length, small: small.slice(0,8), tiny: tiny.slice(0,8),
        lanes: document.querySelectorAll('.player-board .lane').length,
        hands: document.querySelectorAll('#hand .card-btn').length,
        bodyMin: parseFloat(getComputedStyle(document.body).minHeight)||0,
        reach: reach,
        backdrop: (getComputedStyle(document.querySelector('.play-area')).backdropFilter || 'none')
      };
    })()`);
    ok(vp.name + ' no horizontal overflow', m.docScroll <= vp.width && m.bodyScroll <= vp.width, m.docScroll + '/' + m.bodyScroll);
    ok(vp.name + ' all touch targets >=44px', m.smallCount === 0, JSON.stringify(m.small));
    ok(vp.name + ' all text >=12px', m.tiny.length === 0, JSON.stringify(m.tiny));
    ok(vp.name + ' controls reachable by scrolling', m.reach.every((r) => r.ok), JSON.stringify(m.reach));
    eq(vp.name + ' keeps 10 lanes', m.lanes, 10);
    eq(vp.name + ' keeps 8 hand cards', m.hands, 8);
    ok(vp.name + ' 100dvh resolves', m.bodyMin >= Math.min(vp.height, 300), 'min=' + m.bodyMin);
    eq(vp.name + ' viewport width matches', m.innerWidth, vp.width);
    ok(vp.name + ' no backdrop-filter on touch', m.backdrop === 'none' || m.backdrop === '', m.backdrop);
    mobileResults.push({ viewport: vp.name, scrollWidth: m.docScroll, touchMin: m.smallCount ? '<44' : 44, fontMin: m.tiny.length ? '<12' : 12 });
  }
  perf.mobile = mobileResults;

  section('Reduced motion');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(250);
  ok('media query reports reduced motion', (await evaluate('__lostcities.reducedMotion()')) === true);
  await evaluate(`__lostcities.newGame({seed:4242})`);
  await waitFor('reduced new game', `__lostcities.getState().round === 1 && !__lostcities.isBusy()`, 5000);
  const animBefore = await evaluate('__lostcities.animationCounts()');
  const reducedMove = await evaluate(`(function(){ var m=__lostcities.legalMoves()[0]; return __lostcities.playMove(m).then(function(){ return m; }); })()`);
  ok('reduced motion move applied', !!reducedMove);
  await sleep(650);
  const animAfter = await evaluate('__lostcities.animationCounts()');
  eq('reduced motion skips animations', animAfter, animBefore);
  await cdp.send('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(`__lostcities.newGame({seed:20261110})`);
  await waitFor('normal game restored', `!__lostcities.isBusy() && __lostcities.getState().round === 1`, 5000);

  section('Service worker offline cache');
  const swReady = await evaluate(`(async function(){
    if (!('serviceWorker' in navigator)) return { ok:false, reason:'no-sw' };
    var reg = await navigator.serviceWorker.ready;
    var keys = await caches.keys();
    var urls = ${JSON.stringify(MATERIALS)};
    var covers = ${JSON.stringify(COVER_ASSETS)};
    var materials = await Promise.all(urls.map(function(u){ return caches.match(u).then(function(r){ return !!r; }); }));
    var cover = await Promise.all(covers.map(function(u){ return caches.match(u).then(function(r){ return !!r; }); }));
    var shared = await Promise.all(${JSON.stringify(SHARED_ASSETS)}.map(function(u){ return caches.match(u).then(function(r){ return !!r; }); }));
    var shell = await caches.match('./index.html').then(function(r){ return !!r; });
    return { ok:true, scope:reg.scope, keys:keys, materials:materials, cover:cover, shared:shared, shell:shell };
  })()`);
  ok('service worker ready', swReady && swReady.ok === true, JSON.stringify(swReady));
  ok('offline cache created', swReady && swReady.keys.includes('lost-cities-premium-v1'), JSON.stringify(swReady && swReady.keys));
  ok('7 materials cached', swReady && swReady.materials.length === 7 && swReady.materials.every(Boolean), JSON.stringify(swReady && swReady.materials));
  ok('cover/OG/details cached', swReady && swReady.cover.every(Boolean), JSON.stringify(swReady && swReady.cover));
  ok('shared shuffle/sfx cached', swReady && swReady.shared.every(Boolean), JSON.stringify(swReady && swReady.shared));
  ok('page shell cached', swReady && swReady.shell === true);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('offline reload', `!!(window.__lostcities && document.querySelectorAll('#hand .card-btn').length === 8 && document.querySelectorAll('#humanBoard .lane').length === 5)`, 15000);
  const offline = await evaluate(`({ online:navigator.onLine, hands:document.querySelectorAll('#hand .card-btn').length, lanes:document.querySelectorAll('.player-board .lane').length, materials:document.querySelectorAll('.compass').length, title:document.title })`);
  ok('offline reload serves game', offline.hands === 8 && offline.lanes === 10, JSON.stringify(offline));
  ok('offline reload keeps materials', offline.materials >= 1);
  ok('offline navigator reports offline', offline.online === false);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('online reload', `!!(window.__lostcities && document.querySelectorAll('#hand .card-btn').length === 8)`, 15000);

  section('Online browser client');
  const onlineMod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
  const onlineHandle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 1200, aiDelayMs: 60 });
  const onlineBase = 'http://127.0.0.1:' + onlineHandle.address.port;
  seenOrigins.add(onlineBase);
  async function onlineApi(method, route, body) {
    const res = await fetch(onlineBase + route, {
      method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch (err) {}
    return { status: res.status, body: data };
  }
  try {
    const created = await onlineApi('POST', '/api/rooms', { playerId: 'browser-p1' });
    ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
    const roomId = created.body.roomId;
    const t1 = created.body.playerSession;
    const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'browser-p1' });
    ok('online match starts with AI seat', started.status === 200 && started.body.seats[1].ai === true, started.status);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.navigate', { url: onlineBase + '/online.html?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=browser-p1' });
    await waitFor('online browser boot', `!!(window.__lostcitiesOnline && window.__lostcitiesOnline.getState() && window.__lostcitiesOnline.getState().players[0].hand.length === 8)`, 15000);
    const onlineBoot = await evaluate(`({ state:__lostcitiesOnline.getState(), gameHidden:document.getElementById('gamePanel').hidden, ownLanes:document.querySelectorAll('#ownBoard .lane').length, rivalLanes:document.querySelectorAll('#rivalBoard .lane').length, hand:document.querySelectorAll('#hand .card').length, room:document.getElementById('roomCode').textContent })`);
    eq('online browser gets 2 players', onlineBoot.state.playerCount, 2);
    eq('online game panel visible', onlineBoot.gameHidden, false);
    eq('online 5 own lanes', onlineBoot.ownLanes, 5);
    eq('online 5 rival lanes', onlineBoot.rivalLanes, 5);
    eq('online 8 hand cards', onlineBoot.hand, 8);
    ok('online room code visible', !!onlineBoot.room, onlineBoot.room);
    const onlineMove = await evaluate(`(function(){
      var moves = __lostcitiesOnline.legalMoves().filter(function(m){ return m.type === 'play'; });
      var m = moves[0]; if (!m) return null;
      document.querySelector('#hand .card[data-hand="' + m.handIndex + '"]').click();
      var lane = document.querySelector('#ownBoard [data-act="exp"][data-color="' + m.color + '"]');
      if (lane) lane.click();
      return m;
    })()`);
    ok('online browser selected a play', !!onlineMove, JSON.stringify(onlineMove));
    if (onlineMove) {
      await waitFor('online play applied', `(() => { var s=__lostcitiesOnline.getState(); return s && s.phase === 'draw'; })()`, 8000);
      const afterOnlinePlay = await evaluate('__lostcitiesOnline.getState()');
      eq('online play reached draw phase', afterOnlinePlay.phase, 'draw');
      await evaluate(`document.getElementById('deckBtn').click()`);
      await waitFor('online AI turn finishes', `(() => { var s=__lostcitiesOnline.getState(); return s && !__lostcitiesOnline.isBusy() && (s.over || s.current === 0) && s.turn >= 2; })()`, 15000);
      const afterOnlineAI = await evaluate('__lostcitiesOnline.getState()');
      ok('online AI completed turn', afterOnlineAI.turn >= 2 || afterOnlineAI.over, 'turn=' + afterOnlineAI.turn);
      ok('online state stays server-authoritative', afterOnlineAI.players.every((p) => Number.isFinite(p.totalScore)));
      const apiView = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(t1) + '&playerId=browser-p1');
      eq('HTTP view matches browser turn', apiView.body.state.turn, afterOnlineAI.turn);
      eq('HTTP view matches browser phase', apiView.body.state.phase, afterOnlineAI.phase);
    }
    const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { token: t1, playerId: 'browser-p1' });
    ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true);
    await evaluate(`document.getElementById('reconnectRoomBtn').click()`);
    await sleep(500);
    ok('online browser reconnect has no error', consoleErrors.length === 0, consoleErrors.join(' | '));
  } finally {
    await onlineHandle.close();
  }

  section('Rules page: JSON-LD, sources, real art');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await navigate(origin + RULES, `document.readyState === 'complete' && !!document.querySelector('article.article')`);
  await sleep(350);
  const rules = await evaluate(`(function(){
    var text = document.querySelector('article.article').innerText || '';
    var cn = (text.match(/[\\u4e00-\\u9fff]/g) || []).length;
    var jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){ try { return JSON.parse(s.textContent); } catch(e){ return {error:String(e)}; } });
    var imgs = Array.from(document.querySelectorAll('.figures img')).map(function(img){ return {src:img.getAttribute('src'),w:img.naturalWidth,h:img.naturalHeight}; });
    return {
      title: document.title, cn: cn, jsonLd: jsonLd,
      hasBv1: /BV1bt411K79U/.test(text), hasBv2: /BV197411N7nn/.test(text),
      hasUltra: /ultraboardgames\\.com\\/lost-cities\\/game-rules\\.php/i.test(text),
      has60: /60 张/.test(text), has8: /8 张/.test(text) && /\\+20/.test(text),
      hasWagerPenalty: /-20/.test(text) && /赌注/.test(text),
      hasThreeRounds: /三局/.test(text), hasLastCard: /最后一张/.test(text),
      hasNoDrawOwnDiscard: /不能抽回自己刚弃的牌/.test(text),
      hasSingle: /单人/.test(text), hasOnline: /联机/.test(text),
      og: document.querySelector('meta[property="og:image"]').content,
      imgs: imgs, scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      buttons: Array.from(document.querySelectorAll('a')).map(function(a){ var r=a.getBoundingClientRect(); return {w:Math.round(r.width),h:Math.round(r.height),text:(a.textContent||'').trim().slice(0,10)}; }).filter(function(x){return x.w>0;})
    };
  })()`);
  ok('rules title', /失落之城/.test(rules.title), rules.title);
  ok('rules has 1200+ Chinese chars', rules.cn >= 1200, 'cn=' + rules.cn);
  eq('rules JSON-LD parse clean', rules.jsonLd.filter((x) => x.error).length, 0);
  ok('Article JSON-LD', rules.jsonLd.some((x) => x['@type'] === 'Article'));
  ok('FAQPage JSON-LD', rules.jsonLd.some((x) => x['@type'] === 'FAQPage'));
  ok('FAQPage has 8+ questions', rules.jsonLd.some((x) => x['@type'] === 'FAQPage' && x.mainEntity && x.mainEntity.length >= 8));
  ok('Bilibili BV1bt411K79U cited', rules.hasBv1 === true);
  ok('Bilibili BV197411N7nn cited', rules.hasBv2 === true);
  ok('UltraBoardGames cited', rules.hasUltra === true);
  ok('rules states 60 cards', rules.has60 === true);
  ok('rules states 8-card +20', rules.has8 === true);
  ok('rules states wager -20', rules.hasWagerPenalty === true);
  ok('rules states three rounds', rules.hasThreeRounds === true);
  ok('rules states last-card ending', rules.hasLastCard === true);
  ok('rules forbids drawing own discard', rules.hasNoDrawOwnDiscard === true);
  ok('rules mentions single player', rules.hasSingle === true);
  ok('rules mentions online', rules.hasOnline === true);
  eq('rules OG image', rules.og, 'assets/og.webp');
  eq('rules has 3 real figures', rules.imgs.length, 3);
  ok('rules figures decoded', rules.imgs.every((img) => img.w > 0 && img.h > 0), JSON.stringify(rules.imgs));
  ok('rules no horizontal overflow at 320', rules.scrollWidth <= rules.innerWidth + 1, rules.scrollWidth + '/' + rules.innerWidth);
  ok('rules nav anchors >=44 high', rules.buttons.filter((b) => /开始单人|联机/.test(b.text)).every((b) => b.h >= 44), JSON.stringify(rules.buttons));

  section('Art composition: cover / OG / details');
  for (const item of [
    { shot: 'cover', width: 1200, height: 1200 },
    { shot: 'og', width: 1200, height: 630 },
    { shot: 'detail1', width: 1200, height: 800 },
    { shot: 'detail2', width: 1200, height: 800 }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: item.width, height: item.height, deviceScaleFactor: 1, mobile: false });
    await navigate(origin + '/boardgame/lost-cities-premium/art-render.html?shot=' + item.shot, `document.readyState === 'complete' && !!window.__artReady`);
    await sleep(250);
    const art = await evaluate(`(async function(){
      var urls = ${JSON.stringify(MATERIALS)};
      var loaded = await Promise.all(urls.map(function(u){ return new Promise(function(resolve){ var img=new Image(); img.onload=function(){resolve({url:u,ok:img.naturalWidth>0});}; img.onerror=function(){resolve({url:u,ok:false});}; img.src=u; }); }));
      var r = document.querySelector('.stage').getBoundingClientRect();
      return {
        ready: window.__artReady === true, shot: document.body.getAttribute('data-shot'),
        expeditions: document.querySelectorAll('.expedition').length,
        discards: document.querySelectorAll('.discard-pile').length,
        hand: document.querySelectorAll('.hand .mini').length,
        decks: document.querySelectorAll('.deck').length,
        compass: document.querySelectorAll('.compass').length,
        wagers: document.querySelectorAll('.mini.w').length,
        materials: loaded, stage: [Math.round(r.width), Math.round(r.height)],
        text: document.querySelector('.brandline h1').textContent
      };
    })()`);
    ok(item.shot + ' art ready', art.ready === true && art.shot === item.shot);
    eq(item.shot + ' has 10 expedition columns', art.expeditions, 10);
    eq(item.shot + ' has 5 discard piles', art.discards, 5);
    eq(item.shot + ' has 8 hand cards', art.hand, 8);
    eq(item.shot + ' has 1 deck', art.decks, 1);
    eq(item.shot + ' has compass', art.compass, 1);
    ok(item.shot + ' has wager seals', art.wagers >= 1, 'wagers=' + art.wagers);
    ok(item.shot + ' has title text', /失落之城/.test(art.text), art.text);
    ok(item.shot + ' 7 materials load', art.materials.every((m) => m.ok), JSON.stringify(art.materials));
    eq(item.shot + ' stage size', art.stage, [item.width, item.height]);
  }
  const assetDir = path.join(HERE, 'assets');
  const cover = pngSize(path.join(assetDir, 'cover.png'));
  const og = pngSize(path.join(assetDir, 'og.png'));
  const detail1 = pngSize(path.join(assetDir, 'detail-1.png'));
  const detail2 = pngSize(path.join(assetDir, 'detail-2.png'));
  ok('cover PNG >=600x400 and >=8KB', cover && cover.width >= 600 && cover.height >= 400 && cover.bytes >= 8192, JSON.stringify(cover));
  ok('OG PNG >=1000x500 and >=15KB', og && og.width >= 1000 && og.height >= 500 && og.bytes >= 15360, JSON.stringify(og));
  ok('detail-1 PNG >=600x400 and >=8KB', detail1 && detail1.width >= 600 && detail1.height >= 400 && detail1.bytes >= 8192, JSON.stringify(detail1));
  ok('detail-2 PNG >=600x400 and >=8KB', detail2 && detail2.width >= 600 && detail2.height >= 400 && detail2.bytes >= 8192, JSON.stringify(detail2));
  ok('cover webp exists and >=8KB', fs.statSync(path.join(assetDir, 'cover.webp')).size >= 8192);
  ok('OG webp exists and >=15KB', fs.statSync(path.join(assetDir, 'og.webp')).size >= 15360);

  section('Zero external requests & console clean');
  const resources = await evaluate(`performance.getEntriesByType('resource').map(function(e){ return e.name; })`);
  const external = resources.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:') && !urlsInSeen(url));
  function urlsInSeen(url) {
    for (const o of seenOrigins) if (url.startsWith(o)) return true;
    return false;
  }
  eq('no external resource entries', external, []);
  const externalRequests = requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('chrome-devtools:') && !urlsInSeen(url));
  eq('no external network requests', externalRequests, []);
  eq('no console errors', consoleErrors, []);
  eq('no page exceptions', pageErrors, []);
  ok('perf recorded', perf.domContentLoaded > 0 && !!perf.domNodes && !!perf.mobile);

  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:');
    failures.forEach((line) => console.log(' - ' + line));
    process.exitCode = 1;
  }
} catch (err) {
  console.log('\nFATAL: ' + (err && err.stack ? err.stack : String(err)));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exitCode = 1;
} finally {
  try { cdp.ws.close(); } catch (err) {}
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + encodeURIComponent(target.id)); } catch (err) {}
  await new Promise((resolve) => server.close(resolve));
}
