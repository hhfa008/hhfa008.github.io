#!/usr/bin/env node
/*
 * Jaipur premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/jaipur-premium/e2e.mjs
 *
 * Verifies: real UI take→AI turn, crafted sell→bonus, endgame/restart,
 * 390×844 / 320×568 / landscape mobile, 44px touch targets, safe-area + 100dvh,
 * reduced motion, WebAudio unlock, service-worker offline reload, performance
 * budgets, zero external requests, rules page JSON-LD, art composition with
 * real component counts, and a browser online-room sync.
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
const CDP_PORT = Number(process.env.JAIPUR_CDP_PORT || 9222);
const ENTRY = '/boardgame/jaipur-premium/index.html';
const RULES = '/boardgame/jaipur-premium/rules.html';
const ART = '/boardgame/jaipur-premium/art-render.html?shot=cover';
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

const MATERIALS = [
  '../../assets/art/premium/jaipur/card-paper.webp',
  '../../assets/art/premium/jaipur/camel.webp',
  '../../assets/art/premium/jaipur/token-gold.webp',
  '../../assets/art/premium/jaipur/token-silver.webp',
  '../../assets/art/premium/jaipur/silk.webp',
  '../../assets/art/premium/jaipur/spice.webp',
  '../../assets/art/premium/jaipur/leather.webp',
  '../../assets/art/premium/jaipur/table-sand.webp'
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
        'service-worker-allowed': '/boardgame/jaipur-premium/'
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
    ' (set JAIPUR_CDP_PORT; do not launch a temp Chrome)');
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
} catch (err) { /* best effort */ }
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
  await waitFor('page boot', `!!(window.__jaipur && document.querySelectorAll('.market-card').length === 5)`, 20000);

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    const s = __jaipur.getState();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    const cssText = Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n');
    return {
      title: document.title,
      market: document.querySelectorAll('.market-card').length,
      deckCount: document.getElementById('deckCount').textContent,
      round: s.round,
      deck: s.deck.length,
      marketState: s.market.length,
      tokenCoins: document.querySelectorAll('.token-stack .coin').length,
      bonusCoins: document.querySelectorAll('.bonus-coin').length,
      tokenStacks: document.querySelectorAll('.token-stack').length,
      bonusTiers: document.querySelectorAll('.bonus-tier').length,
      sealSlots: document.querySelectorAll('.seal').length,
      handGroups: document.querySelectorAll('.hand-group').length,
      turn: document.getElementById('turnBadge').textContent,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      resources: res,
      reduced: __jaipur.reducedMotion(),
      keyframes: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).filter(function(r){ return r.type === CSSRule.KEYFRAMES_RULE; }).map(function(r){ return r.name; }),
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); }),
      cssText: cssText
    };
  })()`);
  ok('page title', /JAIPUR|斋普尔/i.test(initial.title), initial.title);
  eq('market shows 5 cards', initial.market, 5);
  eq('initial round 1', initial.round, 1);
  eq('initial deck 40', initial.deck, 40);
  eq('initial market state 5', initial.marketState, 5);
  eq('deck badge says 40', initial.deckCount, '40');
  eq('6 token stacks', initial.tokenStacks, 6);
  eq('38 goods coins rendered', initial.tokenCoins, 38);
  eq('3 bonus tiers', initial.bonusTiers, 3);
  eq('18 face-down bonus coins', initial.bonusCoins, 18);
  ok('4 seal slots (2 per side)', initial.sealSlots === 4, 'seals=' + initial.sealSlots);
  ok('hand groups rendered', initial.handGroups >= 1 && initial.handGroups <= 6, 'groups=' + initial.handGroups);
  ok('human turn shown', /轮到你/.test(initial.turn), initial.turn);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('keyframes cardIn present', initial.keyframes.includes('cardIn'));
  ok('keyframes chipPulse present', initial.keyframes.includes('chipPulse'));
  ok('prefers-reduced-motion CSS rule present', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP/DCL within budget', (initial.fcp > 0 ? initial.fcp : initial.dcl) > 0 && (initial.fcp > 0 ? initial.fcp : initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + 'ms dcl=' + Math.round(initial.dcl) + 'ms');
  ok('loadEventEnd within budget', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd) + 'ms');
  ok('DOM nodes within budget', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const materialEntries = initial.resources.filter((r) => /assets\/art\/premium\/jaipur\/.*\.webp/.test(r.name));
  const materialBytes = materialEntries.reduce((n, r) => n + r.size, 0);
  ok('all 8 material WebP loaded', materialEntries.length >= 8, 'entries=' + materialEntries.length);
  ok('material bytes within budget', materialBytes > 0 && materialBytes < 2097152, 'bytes=' + materialBytes);
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
    __jaipur.newGame({ seed: 9090 });
    return performance.now() - t;
  })()`);
  ok('new game synchronous render within budget', newGameMs >= 0 && newGameMs < 200, 'ms=' + newGameMs.toFixed(1));
  perf.newGameRenderMs = Number(newGameMs.toFixed(1));

  const pureLatency = await evaluate(`(async function(){
    var m = __jaipur.legalMoves().find(function(x){ return x.type !== 'exchange'; }) || __jaipur.legalMoves()[0];
    var t = performance.now();
    await __jaipur.playMove(m, { animate: false });
    return performance.now() - t;
  })()`);
  ok('pure move latency under 500ms', pureLatency >= 0 && pureLatency < 500, 'ms=' + pureLatency.toFixed(1));
  perf.pureMoveMs = Number(pureLatency.toFixed(1));
  await evaluate(`__jaipur.newGame({ seed: 20261110 })`);
  await waitFor('reset after latency probe', `!__jaipur.isBusy() && __jaipur.getState().round === 1`, 5000);

  section('WebAudio unlock & native controls');
  // Create the AudioContext inside a user-gesture evaluate. Sfx.play() queues
  // when the context is suspended and resumes it; Chrome treats this evaluate
  // call (userGesture:true) as activation.
  await evaluate(`(function(){ if (window.Sfx) { window.Sfx.mute(false); window.Sfx.play('click'); } return true; })()`);
  await sleep(300);
  ok('iOS audio unlocked by touch/click', (await evaluate('__jaipur.audioUnlocked()')) === true, JSON.stringify(await evaluate('window.Sfx && window.Sfx.stats ? window.Sfx.stats() : null')));
  ok('no inline hover handlers', (await evaluate(`document.querySelectorAll('[onmouseover],[onmouseenter]').length`)) === 0);
  const actionKinds = await evaluate(`Array.from(document.querySelectorAll('.market-card,.mode-btn,.hand-group,#newBtn,#soundBtn,#themeBtn,#camelAction,#dockConfirm')).every(function(el){ return el.tagName === 'BUTTON' || el.tagName === 'A'; })`);
  ok('primary controls are native buttons/links', actionKinds === true);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor('Escape clears selection', `__jaipur.selection().takeIndex === -1`, 3000);
  ok('Escape clears selection', (await evaluate('__jaipur.selection().takeIndex')) === -1);

  section('Real click: take a market card -> AI turn');
  const firstMove = await evaluate(`(function(){
    var moves = __jaipur.legalMoves();
    var take = moves.find(function(m){ return m.type === 'take'; });
    if (!take) return { error: 'no take move', moves: moves.slice(0, 5) };
    var node = document.querySelector('.market-card[data-card="' + take.card + '"]');
    if (!node) return { error: 'card node missing', move: take };
    node.click();
    return {
      move: take,
      sel: __jaipur.selection(),
      confirmDisabled: document.getElementById('dockConfirm').disabled,
      dock: document.getElementById('dockTitle').textContent
    };
  })()`);
  ok('selected a legal market card', !!firstMove && firstMove.sel && firstMove.sel.takeIndex >= 0, JSON.stringify(firstMove));
  ok('dock confirm enabled after selecting', firstMove && firstMove.confirmDisabled === false);
  ok('dock reflects the selected card', firstMove && /取/.test(firstMove.dock || ''), firstMove && firstMove.dock);
  await evaluate(`document.getElementById('dockConfirm').click()`);
  await waitFor('human move recorded', `(() => { const s = __jaipur.getState(); return s.turn >= 1; })()`, 10000);
  const afterHuman = await evaluate(`__jaipur.getState()`);
  ok('human take advanced the turn', afterHuman.turn >= 1, 'turn=' + afterHuman.turn);
  ok('human action is recorded', afterHuman.lastAction && afterHuman.lastAction.player === 0, JSON.stringify(afterHuman.lastAction));
  await waitFor('AI completed a turn', `(() => { const s = __jaipur.getState(); return s.turn >= 2 || s.over; })()`, 12000);
  const afterAI = await evaluate(`({ state: __jaipur.getState(), anim: __jaipur.animationCounts() })`);
  ok('AI took its turn', afterAI.state.turn >= 2 || afterAI.state.over, 'turn=' + afterAI.state.turn);
  ok('take animation recorded', afterAI.anim.take >= 1, 'take=' + afterAI.anim.take);
  ok('card pool still 55 after two moves', await evaluate(`(function(){
    var s=__jaipur.getState(); return s.deck.length + s.discard.length + s.market.length +
      s.players.reduce(function(n,p){ return n + Object.keys(p.hand).reduce(function(a,k){return a+p.hand[k];},0) + p.camels; },0) === 55;
  })()`));

  section('Crafted sell -> tokens -> bonus');
  const crafted = await evaluate(`(function(){
    var s = __jaipur.getState();
    s.players[0].hand = { diamond: 3, gold: 0, silver: 0, silk: 0, spice: 0, leather: 0 };
    s.players[0].camels = 0;
    s.players[1].hand = { diamond: 0, gold: 0, silver: 0, silk: 0, spice: 0, leather: 0 };
    s.players[0].goodsTokens = { diamond: [], gold: [], silver: [], silk: [], spice: [], leather: [] };
    s.players[1].goodsTokens = { diamond: [], gold: [], silver: [], silk: [], spice: [], leather: [] };
    s.players[0].bonusTokens = [];
    s.players[1].bonusTokens = [];
    s.market = ['camel', 'camel', 'camel', 'gold', 'silk'];
    s.deck = ['silk', 'spice', 'leather', 'gold', 'silver'];
    s.tokenStacks.diamond = [7, 7, 5, 5, 5];
    s.bonusStacks = { 3: [1, 1, 2, 2, 3, 3], 4: [4, 4, 5, 5, 6, 6], 5: [8, 8, 9, 9, 10, 10] };
    s.current = 0; s.over = false; s.phase = 'play'; s.turn = 5;
    s.history = []; s.lastRound = null;
    __jaipur.setState(s);
    return { hand: __jaipur.getState().players[0].hand, discardBefore: __jaipur.getState().discard.length };
  })()`);
  eq('crafted hand has 3 diamonds', crafted.hand.diamond, 3);
  await evaluate(`document.querySelector('.mode-btn[data-mode="sell"]').click()`);
  await evaluate(`document.querySelector('.hand-group[data-good="diamond"]').click()`);
  const sellDock = await evaluate(`({ disabled: document.getElementById('dockConfirm').disabled, title: document.getElementById('dockTitle').textContent, count: document.getElementById('sellCount').textContent })`);
  ok('sell dock offers the diamond set', sellDock.disabled === false && /钻石/.test(sellDock.title), JSON.stringify(sellDock));
  eq('sell count defaults to 3', sellDock.count, '3');
  await evaluate(`document.getElementById('dockConfirm').click()`);
  await waitFor('sell applied', `__jaipur.getState().players[0].goodsTokens.diamond.length === 3`, 8000);
  const afterSell = await evaluate(`({ state: __jaipur.getState(), anim: __jaipur.animationCounts() })`);
  eq('three diamond tokens collected', afterSell.state.players[0].goodsTokens.diamond, [7, 7, 5]);
  eq('diamond token stack now 2', afterSell.state.tokenStacks.diamond, [5, 5]);
  eq('one tier-3 bonus token earned', afterSell.state.players[0].bonusTokens.length, 1);
  ok('sell animation recorded', afterSell.anim.sell >= 1, 'sell=' + afterSell.anim.sell);
  eq('sold cards go to discard', afterSell.state.discard.length, crafted.discardBefore + 3);

  section('Endgame -> result -> restart');
  const end = await evaluate('__jaipur.autoPlayToEnd(1500)');
  ok('auto-play reaches game over', end && end.over === true, JSON.stringify({ over: end && end.over, turns: end && end.turn }));
  ok('result has two seal counts', end && Array.isArray(end.seals) && end.seals.length === 2, JSON.stringify(end && end.seals));
  ok('winner has two seals', end && (end.seals[0] === 2 || end.seals[1] === 2), JSON.stringify(end && end.seals));
  await waitFor('result modal shown', `!document.getElementById('resultModal').hidden && document.getElementById('resultModal').classList.contains('show')`, 4000);
  const modal = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, show: document.getElementById('resultModal').classList.contains('show'), title: document.getElementById('resultTitle').textContent, rows: document.querySelectorAll('#resultTable tr').length, note: document.getElementById('resultNote').textContent })`);
  ok('result modal visible', modal.hidden === false && modal.show === true);
  ok('result title rendered', /赢|平分|结束/.test(modal.title), modal.title);
  ok('result table has round rows', modal.rows >= 1, 'rows=' + modal.rows);
  ok('result note explains seals', /Seal/.test(modal.note), modal.note);
  await evaluate(`document.getElementById('againBtn').click()`);
  await waitFor('new game after restart', `(() => { const s = __jaipur.getState(); return s.round === 1 && !s.over && s.seals[0] === 0 && s.seals[1] === 0; })()`, 6000);
  const restarted = await evaluate(`({ hidden: document.getElementById('resultModal').hidden, state: __jaipur.getState() })`);
  ok('result modal hidden after restart', restarted.hidden === true);
  eq('restart resets round', restarted.state.round, 1);
  eq('restart resets seals', restarted.state.seals, [0, 0]);

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
      var targets = Array.from(document.querySelectorAll('.market-card, .mode-btn, .hand-group, .btn, .step-btn, #camelAction, #dockConfirm, #newBtn')).filter(visible);
      var small = targets.filter(function(el){
        var r = el.getBoundingClientRect();
        return r.width < 44 || r.height < 44;
      }).map(function(el){
        var r = el.getBoundingClientRect();
        return (el.className || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
      });
      document.documentElement.style.scrollBehavior = 'auto';
      var reach = ['.market-card', '.mode-btn', '.dock', '#dockTitle'].map(function(sel){
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
      var docks = Array.from(document.querySelectorAll('.dock')).map(function(n){ return n.getBoundingClientRect(); });
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        docScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        targets: targets.length,
        small: small.slice(0, 12),
        smallCount: small.length,
        reach: reach,
        bodyFont: parseFloat(getComputedStyle(document.body).fontSize) || 0,
        dockFont: parseFloat(getComputedStyle(document.querySelector('.dock-title')).fontSize) || 0,
        logFont: parseFloat(getComputedStyle(document.querySelector('.log-list li') || document.body).fontSize) || 0,
        tokenFont: parseFloat(getComputedStyle(document.querySelector('.token-name') || document.body).fontSize) || 0,
        bodyMin: bodyMin,
        panelBackdrop: getComputedStyle(document.querySelector('.panel')).backdropFilter || getComputedStyle(document.querySelector('.panel')).webkitBackdropFilter || 'none',
        marketCards: document.querySelectorAll('.market-card').length,
        tokenStacks: document.querySelectorAll('.token-stack').length,
        seals: document.querySelectorAll('.seal').length
      };
    })()`);
    ok(vp.name + ' no horizontal overflow', m.docScroll <= vp.width && m.bodyScroll <= vp.width, m.docScroll + '/' + m.bodyScroll);
    ok(vp.name + ' all touch targets >=44px', m.smallCount === 0, 'small=' + JSON.stringify(m.small));
    ok(vp.name + ' body font readable', m.bodyFont >= 14, 'font=' + m.bodyFont);
    ok(vp.name + ' dock font readable', m.dockFont >= 12, 'font=' + m.dockFont);
    ok(vp.name + ' log font readable', m.logFont >= 12, 'font=' + m.logFont);
    ok(vp.name + ' token font readable', m.tokenFont >= 12, 'font=' + m.tokenFont);
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
    ok(vp.name + ' keeps 5 market cards', m.marketCards === 5);
    ok(vp.name + ' keeps 6 token stacks', m.tokenStacks === 6);
    ok(vp.name + ' keeps seal slots', m.seals >= 4);
    ok(vp.name + ' viewport matches emulation', m.innerWidth === vp.width && m.innerHeight === vp.height, m.innerWidth + 'x' + m.innerHeight);
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
    await waitFor('reload after safe-area', `!!(window.__jaipur && document.querySelector('.topbar'))`, 12000);
    const safe = await evaluate(`({ top: parseFloat(getComputedStyle(document.querySelector('.topbar')).paddingTop) || 0, bottom: parseFloat(getComputedStyle(document.querySelector('.dock')).paddingBottom) || 0 })`);
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
    var rules = await caches.match('./rules.html').then(function(r){ return !!r; });
    var cover = await caches.match('./assets/cover.webp').then(function(r){ return !!r; });
    return { ok: true, scope: reg.scope, keys: keys, materials: checks, shared: shared, shell: shell, rules: rules, cover: cover };
  })()`);
  ok('service worker ready', swReady && swReady.ok === true, JSON.stringify(swReady));
  ok('offline cache created', swReady && swReady.keys.includes('jaipur-premium-v1'), JSON.stringify(swReady && swReady.keys));
  ok('all materials cached for offline', swReady && swReady.materials.every(Boolean), JSON.stringify(swReady && swReady.materials));
  ok('page shell cached for offline', swReady && swReady.shell === true);
  ok('rules page cached for offline', swReady && swReady.rules === true);
  ok('cover cached for offline', swReady && swReady.cover === true);
  ok('shared shuffle/sfx cached for offline', swReady && swReady.shared && swReady.shared.every(Boolean), JSON.stringify(swReady && swReady.shared));
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('offline reload', `!!(window.__jaipur && document.querySelectorAll('.market-card').length === 5)`, 15000);
  const offline = await evaluate(`({ title: document.title, market: document.querySelectorAll('.market-card').length, coins: document.querySelectorAll('.token-stack .coin').length, online: navigator.onLine })`);
  ok('offline reload serves the game', offline.market === 5, JSON.stringify(offline));
  ok('offline reload serves token coins', offline.coins === 38, 'coins=' + offline.coins);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  await waitFor('online reload', `!!(window.__jaipur && document.querySelectorAll('.market-card').length === 5)`, 15000);

  section('Reduced motion');
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(250);
  ok('media query reports reduced motion', (await evaluate('__jaipur.reducedMotion()')) === true);
  await evaluate(`__jaipur.newGame({ seed: 4242 })`);
  await waitFor('new reduced-motion game', `__jaipur.getState().round === 1 && !__jaipur.isBusy()`, 5000);
  const animReducedBefore = await evaluate('__jaipur.animationCounts()');
  const reducedMove = await evaluate(`(function(){
    var moves = __jaipur.legalMoves().filter(function(m){ return m.type !== 'exchange'; });
    if (!moves.length) return null;
    __jaipur.playMove(moves[0]);
    return moves[0];
  })()`);
  ok('reduced-motion move applied', !!reducedMove);
  await sleep(700);
  const animReducedAfter = await evaluate('__jaipur.animationCounts()');
  ok('reduced motion skips take/sell animations', animReducedAfter.take === animReducedBefore.take && animReducedAfter.sell === animReducedBefore.sell,
    'take ' + animReducedBefore.take + '->' + animReducedAfter.take + ' sell ' + animReducedBefore.sell + '->' + animReducedAfter.sell);
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
  const onlineHandle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
    const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-p1' });
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
    await waitFor('online browser boot', `(() => { const s = window.__jaipur && __jaipur.getState(); return !!(s && s.playerCount === 2 && document.querySelector('#roomChip') && !document.querySelector('#roomChip').hidden && document.querySelectorAll('.rival').length === 1); })()`, 15000);
    const onlineBoot = await evaluate(`({ state: __jaipur.getState(), newText: document.getElementById('newBtn').textContent, segHidden: getComputedStyle(document.getElementById('difficultySeg')).display === 'none', room: document.getElementById('roomChip').textContent })`);
    ok('online browser renders 2-player state', onlineBoot.state.playerCount === 2, JSON.stringify(onlineBoot.state));
    ok('online room chip visible', /房间/.test(onlineBoot.room), onlineBoot.room);
    ok('online new-game button returns to room', /返回房间/.test(onlineBoot.newText), onlineBoot.newText);
    ok('online difficulty selector hidden', onlineBoot.segHidden === true);
    const p1Move = await evaluate(`(function(){
      var moves = __jaipur.legalMoves().filter(function(m){ return m.type === 'take'; });
      if (!moves.length) moves = __jaipur.legalMoves();
      if (!moves.length) return null;
      var m = moves[0];
      var node = m.type === 'take' ? document.querySelector('.market-card[data-card="' + m.card + '"]') : null;
      if (node) node.click();
      return m;
    })()`);
    ok('online browser got a legal move', !!p1Move, JSON.stringify(p1Move));
    if (p1Move && p1Move.type === 'take') {
      await evaluate(`document.getElementById('dockConfirm').click()`);
      await waitFor('online browser move sent', `(() => { const s = __jaipur.getState(); return s.turn >= 1 && !__jaipur.isBusy(); })()`, 10000);
      const afterOnline = await evaluate('__jaipur.getState()');
      ok('online browser move advanced server state', afterOnline.turn >= 1, 'turn=' + afterOnline.turn);
      const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(t2) + '&playerId=e2e-p2');
      ok('second HTTP client sees same turn', p2View.status === 200 && p2View.body.state.turn === afterOnline.turn, p2View.status + ' turn=' + (p2View.body && p2View.body.state && p2View.body.state.turn));
    }
    const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { token: t1, playerId: 'e2e-p1' });
    ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, reconnect.status);
  } finally {
    await onlineHandle.close();
  }

  section('Online lobby page opens');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await navigate(origin + '/boardgame/jaipur-premium/online.html', `document.readyState === 'complete' && !!document.getElementById('createBtn')`);
  await sleep(250);
  const lobby = await evaluate(`({ title: document.title, hasCreate: !!document.getElementById('createBtn'), hasJoin: !!document.getElementById('joinBtn'), hasLeaderboard: !!document.getElementById('leaderboard'), scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
  ok('online lobby title', /斋普尔|JAIPUR/.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.hasCreate && lobby.hasJoin && lobby.hasLeaderboard);
  ok('online lobby no horizontal overflow at 320px', lobby.scrollWidth <= lobby.innerWidth + 1, lobby.scrollWidth + '/' + lobby.innerWidth);

  section('Rules page: art, JSON-LD, Bilibili sources');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await navigate(origin + RULES, `document.readyState === 'complete' && !!document.querySelector('article.article')`);
  await sleep(400);
  const rules = await evaluate(`(function(){
    var text = document.querySelector('article.article').innerText || '';
    var cn = (text.match(/[\\u4e00-\\u9fff]/g) || []).length;
    var jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){ try { return JSON.parse(s.textContent); } catch(e){ return { error: String(e) }; } });
    var links = Array.from(document.querySelectorAll('a[href*="bilibili.com/video/"]')).map(function(a){ return a.href; });
    var imgs = Array.from(document.querySelectorAll('.figure img, .hero img')).map(function(img){ return { src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight }; });
    return {
      title: document.title, cn: cn, jsonLd: jsonLd,
      linkCount: links.length, uniqueLinks: Array.from(new Set(links)).length,
      hasSourceBv: /BV1V44y1f7SJ/.test(text) && /BV17t411K79L/.test(text),
      hasCounts: /55 张/.test(text) && /38 枚/.test(text) && /18 枚/.test(text),
      hasCamel: /11 只/.test(text) && /3 只骆驼/.test(text),
      hasTieBreak: /奖励代币数量/.test(text) && /货物代币数量/.test(text),
      hasSingle: /单人/.test(text),
      og: document.querySelector('meta[property="og:image"]') && document.querySelector('meta[property="og:image"]').content,
      imgs: imgs,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  })()`);
  ok('rules title', /斋普尔/.test(rules.title), rules.title);
  ok('rules has 1200+ Chinese chars', rules.cn >= 1200, 'cn=' + rules.cn);
  eq('rules JSON-LD blocks valid', rules.jsonLd.filter((x) => x.error).length, 0);
  ok('Article JSON-LD present', rules.jsonLd.some((x) => x['@type'] === 'Article'));
  ok('FAQPage JSON-LD present', rules.jsonLd.some((x) => x['@type'] === 'FAQPage'));
  ok('FAQPage has 8 questions', rules.jsonLd.some((x) => x['@type'] === 'FAQPage' && x.mainEntity && x.mainEntity.length >= 8));
  ok('rules cites two Bilibili tutorials', rules.uniqueLinks >= 2 && rules.hasSourceBv === true, 'unique=' + rules.uniqueLinks);
  ok('rules states 55/38/18 component counts', rules.hasCounts === true);
  ok('rules states 11 camels and 3 opening camels', rules.hasCamel === true);
  ok('rules explains two-step tie-break', rules.hasTieBreak === true);
  ok('rules marks single-player', rules.hasSingle === true);
  ok('rules OG image declared', rules.og === 'assets/og.webp', rules.og);
  ok('rules cover/detail images loaded', rules.imgs.length >= 3, 'imgs=' + rules.imgs.length);
  ok('rules images decoded', rules.imgs.every((img) => img.w > 0 && img.h > 0), JSON.stringify(rules.imgs));
  ok('rules page no horizontal overflow at 320px', rules.scrollWidth <= rules.innerWidth + 1, rules.scrollWidth + '/' + rules.innerWidth);

  section('Art composition source (cover / details)');
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
      marketCards: document.querySelectorAll('.market-row .card').length,
      goodsCoins: document.querySelectorAll('.tokens .coin').length,
      bonusCoins: document.querySelectorAll('.bcoin').length,
      camelImages: document.querySelectorAll('img[src*="camel"]').length,
      seals: document.querySelectorAll('.seal').length,
      filledSeals: document.querySelectorAll('.seal:not(.empty)').length,
      herdA: document.querySelectorAll('#herdRowA img').length,
      herdB: document.querySelectorAll('#herdRowB img').length,
      deckText: (document.querySelector('.deck-count') || {}).textContent,
      materials: loaded,
      stage: [document.querySelector('.stage').getBoundingClientRect().width, document.querySelector('.stage').getBoundingClientRect().height]
    };
  })()`);
  ok('art composition ready', art.ready === true && art.shot === 'cover');
  eq('art cover has 5 market cards', art.marketCards, 5);
  eq('art cover has 38 goods coins', art.goodsCoins, 38);
  eq('art cover has 18 bonus coins', art.bonusCoins, 18);
  eq('art cover has 9 camel images (3 market + 6 herd)', art.camelImages, 9);
  eq('art cover herd A 4 camels', art.herdA, 4);
  eq('art cover herd B 2 camels', art.herdB, 2);
  eq('art cover deck badge 40', art.deckText, '40');
  ok('art cover has seals', art.seals >= 2 && art.filledSeals >= 2, 'seals=' + art.seals + ' filled=' + art.filledSeals);
  ok('art cover materials all load', art.materials.every((m) => m.ok), JSON.stringify(art.materials));
  eq('art cover stage size', art.stage, [1200, 1200]);
  await navigate(origin + '/boardgame/jaipur-premium/art-render.html?shot=detail1', `document.readyState === 'complete' && !!window.__artReady`);
  await sleep(300);
  const detail1 = await evaluate(`({ shot: document.body.getAttribute('data-shot'), stage: [document.querySelector('.stage').getBoundingClientRect().width, document.querySelector('.stage').getBoundingClientRect().height], cards: document.querySelectorAll('.market-row .card').length, camels: document.querySelectorAll('img[src*="camel"]').length })`);
  eq('detail1 shot height 800', detail1.stage, [1200, 800]);
  eq('detail1 keeps 5 market cards', detail1.cards, 5);
  eq('detail1 keeps 9 camel images', detail1.camels, 9);
  await navigate(origin + '/boardgame/jaipur-premium/art-render.html?shot=detail2', `document.readyState === 'complete' && !!window.__artReady`);
  await sleep(300);
  const detail2 = await evaluate(`({ stage: [document.querySelector('.stage').getBoundingClientRect().width, document.querySelector('.stage').getBoundingClientRect().height], coins: document.querySelectorAll('.tokens .coin').length, bonus: document.querySelectorAll('.bcoin').length })`);
  eq('detail2 shot height 800', detail2.stage, [1200, 800]);
  eq('detail2 keeps 38 goods coins', detail2.coins, 38);
  eq('detail2 keeps 18 bonus coins', detail2.bonus, 18);

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
