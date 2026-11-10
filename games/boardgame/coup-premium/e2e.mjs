#!/usr/bin/env node
/*
 * Coup premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/coup-premium/e2e.mjs
 *
 * Verifies: real UI actions, challenge / block / discard / exchange modals,
 * target picker, AI turns, elimination and result, restart, 390×844 / 320×568
 * / landscape mobile, 44px targets, >=12px text, safe-area + 100dvh, reduced
 * motion, WebAudio unlock, service-worker offline reload, performance budgets,
 * zero external requests, rules JSON-LD/sources, art composition counts and
 * the online lobby.
 *
 * Prints exactly one line: RESULT: N passed, M failed
 * Exit code is non-zero on any failure.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.COUP_CDP_PORT || 9222);
const ENTRY = '/boardgame/coup-premium/index.html';
const RULES = '/boardgame/coup-premium/rules.html';
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

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
    if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
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
        'service-worker-allowed': '/boardgame/coup-premium/',
        'content-length': data.length
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
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (r.ok) return;
    } catch (err) {}
    await sleep(150);
  }
  throw new Error('existing Chrome CDP endpoint not reachable on port ' + CDP_PORT +
    ' (set COUP_CDP_PORT; do not launch a temp Chrome)');
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
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
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
  await waitFor('navigate ' + url, readyExpr, 18000);
}
async function click(selector) {
  return evaluate(`(function(){ var el=document.querySelector(${JSON.stringify(selector)}); if(!el) return false; el.click(); return true; })()`);
}
async function passHumanPrompts(maxMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < (maxMs || 12000)) {
    last = await evaluate(`({
      phase: __coup.phase(), actor: __coup.actorId(), over: __coup.getState().over,
      turns: __coup.getState().turns, modal: __coup.modal().kind
    })`);
    if (last.over || last.turns >= 2) return last;
    if (last.actor === 0) {
      if (last.phase === 'challenge' || last.phase === 'block' || last.phase === 'blockChallenge') {
        await click('[data-decision="pass"]');
        await sleep(140);
        continue;
      }
      if (last.phase === 'discard') {
        await click('[data-discard-index="0"]');
        await sleep(140);
        continue;
      }
      if (last.phase === 'exchange') {
        await click('[data-exchange-index="0"]');
        await click('[data-exchange-index="1"]');
        await sleep(80);
        await click('[data-exchange-confirm]');
        await sleep(140);
        continue;
      }
    }
    await sleep(160);
  }
  return last;
}

const EXTERNAL = () => requests.filter((url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('about:') && !url.startsWith('blob:'));

try {
  await waitFor('page boot', `!!(window.__coup && document.querySelectorAll('.seat').length === 4)`, 20000);

  section('Initial render, materials and performance');
  const initial = await evaluate(`(function(){
    const s = __coup.getState();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    const cssText = Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n');
    return {
      title: document.title,
      seats: document.querySelectorAll('.seat').length,
      actions: document.querySelectorAll('.action-btn').length,
      ownVisible: document.querySelectorAll('.seat[data-seat="0"] .card.face:not(.lost)').length,
      hiddenCards: document.querySelectorAll('.card.back').length,
      coinImages: document.querySelectorAll('.seat .coin').length,
      phase: __coup.phase(),
      actor: __coup.actorId(),
      deck: s.deck.length,
      log: document.querySelectorAll('#logList li').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      resources: res,
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); }),
      keyframes: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).filter(function(r){ return r.type === CSSRule.KEYFRAMES_RULE; }).map(function(r){ return r.name; }),
      cssText: cssText,
      hoverInline: document.querySelectorAll('[onmouseover],[onmouseenter]').length,
      native: Array.from(document.querySelectorAll('.action-btn,.nav-btn,#soundBtn')).every(function(el){ return el.tagName === 'BUTTON' || el.tagName === 'A'; }),
      soundOn: __coup.config().soundOn
    };
  })()`);
  ok('page title', /政变|COUP/.test(initial.title), initial.title);
  eq('initial 4 seats', initial.seats, 4);
  eq('seven action buttons', initial.actions, 7);
  eq('human sees two role faces', initial.ownVisible, 2);
  eq('three AI seats hide six cards', initial.hiddenCards, 6);
  eq('each seat shows a coin material', initial.coinImages, 4);
  eq('initial phase action', initial.phase, 'action');
  eq('initial actor human', initial.actor, 0);
  eq('initial deck 7 for 4p', initial.deck, 7);
  ok('initial log has entries', initial.log > 0, 'entries=' + initial.log);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('FCP within 2500ms budget', initial.fcp > 0 && initial.fcp < 2500, 'fcp=' + Math.round(initial.fcp) + 'ms');
  ok('DCL within 4000ms budget', initial.dcl > 0 && initial.dcl < 4000, 'dcl=' + Math.round(initial.dcl) + 'ms');
  ok('load within 4000ms budget', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd) + 'ms');
  ok('DOM nodes within 2500', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  ok('prefers-reduced-motion CSS rule present', initial.reducedRule === true);
  ok('turnGlow keyframes present', initial.keyframes.indexOf('turnGlow') >= 0, JSON.stringify(initial.keyframes));
  ok('blink keyframes present', initial.keyframes.indexOf('blink') >= 0);
  ok('100dvh used in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() used in CSS', /safe-area-inset/.test(initial.cssText));
  ok('no inline hover handlers', initial.hoverInline === 0);
  ok('primary controls are native buttons/links', initial.native === true);
  const materials = initial.resources.filter((r) => /assets\/art\/premium\/coup\/.*\.webp/.test(r.name));
  const materialBytes = materials.reduce((n, r) => n + r.size, 0);
  ok('local material WebP loaded', materials.length >= 3, 'entries=' + materials.length);
  ok('material bytes under 1.5MB', materialBytes > 0 && materialBytes < 1572864, 'bytes=' + materialBytes);
  ok('zero external requests', EXTERNAL().length === 0, JSON.stringify(EXTERNAL()));
  perf.fcp = Math.round(initial.fcp);
  perf.domContentLoaded = Math.round(initial.dcl);
  perf.loadEventEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = materialBytes;
  perf.externalRequests = EXTERNAL().length;

  section('WebAudio unlock and reduced-motion query');
  await click('#soundBtn');
  await sleep(80);
  await click('#soundBtn');
  await sleep(180);
  ok('iOS audio unlocked by user gesture', (await evaluate('__coup.audioUnlocked()')) === true);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(80);
  ok('reduced-motion media query live', (await evaluate('__coup.reducedMotion()')) === true);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await sleep(80);

  section('New-game dialog -> 6 players');
  await click('#newBtn');
  await waitFor('new game dialog opens', `document.getElementById('newGameModal').hidden === false`);
  ok('new game dialog visible', (await evaluate(`document.getElementById('newGameModal').hidden`)) === false);
  await click('[data-count="6"]');
  await click('[data-diff="hard"]');
  await click('#startNewBtn');
  await waitFor('6-player game rendered', `document.querySelectorAll('.seat').length === 6 && __coup.getState().playerCount === 6`, 8000);
  const six = await evaluate(`(function(){
    var s=__coup.getState();
    return {
      seats: document.querySelectorAll('.seat').length,
      playerCount: s.playerCount,
      deck: s.deck.length,
      ownVisible: document.querySelectorAll('.seat[data-seat="0"] .card.face:not(.lost)').length,
      hidden: document.querySelectorAll('.card.back').length,
      coins: s.players.map(function(p){ return p.coins; }),
      players: s.players.map(function(p){ return p.influence.length; }),
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      config: __coup.config()
    };
  })()`);
  eq('6 seats rendered', six.seats, 6);
  eq('6 player state', six.playerCount, 6);
  eq('6-player deck 3', six.deck, 3);
  eq('human sees two roles in 6p', six.ownVisible, 2);
  eq('five AI seats hide ten cards', six.hidden, 10);
  eq('every seat starts with 2 coins', six.coins, [2, 2, 2, 2, 2, 2]);
  eq('every seat starts with 2 honours', six.players, [2, 2, 2, 2, 2, 2]);
  eq('difficulty selected as hard', six.config.difficulty, 'hard');
  ok('6p desktop no horizontal overflow', six.scrollWidth <= six.innerWidth + 1, six.scrollWidth + '/' + six.innerWidth);

  section('Mobile 390x844 / 320x568 / landscape');
  const viewports = [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' },
    { width: 844, height: 390, name: '844x390' },
    { width: 568, height: 320, name: '568x320' }
  ];
  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await evaluate('window.scrollTo(0,0)');
    await sleep(260);
    const m = await evaluate(`(function(){
      var visible = function(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var targets = Array.from(document.querySelectorAll('button, a')).filter(visible);
      var small = targets.filter(function(el){ var r=el.getBoundingClientRect(); return r.width < 44 || r.height < 44; })
        .map(function(el){ var r=el.getBoundingClientRect(); return (el.id||el.className||el.tagName)+' '+Math.round(r.width)+'x'+Math.round(r.height); });
      var tiny = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var text = (node.textContent || '').trim();
        if (!text) continue;
        var el = node.parentElement;
        if (!el || el.closest('script, style, .sr-only, [hidden], .overlay:not(.show)')) continue;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
        if (!el.getClientRects().length) continue;
        var size = parseFloat(cs.fontSize) || 0;
        if (size < 12) tiny.push({ text: text.slice(0,18), size: size, tag: el.tagName, cls: String(el.className||'').slice(0,40) });
      }
      var seats = Array.from(document.querySelectorAll('.seat')).map(function(n){ return n.getBoundingClientRect(); });
      var overlap = 0;
      for (var i=0;i<seats.length;i++) for (var j=i+1;j<seats.length;j++) {
        var a=seats[i], b=seats[j];
        if (Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left)) > 1 &&
            Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) > 1) overlap++;
      }
      var outside = seats.filter(function(r){ return r.left < -1 || r.right > window.innerWidth + 1; }).length;
      var first = document.querySelector('.action-btn');
      window.scrollTo(0, Math.max(0, first.getBoundingClientRect().top + window.scrollY - 120));
      var fr = first.getBoundingClientRect();
      var reach = fr.left >= -1 && fr.right <= window.innerWidth + 1 && fr.top >= -1 && fr.bottom <= window.innerHeight + 1;
      window.scrollTo(0, 0);
      var panel = document.querySelector('.panel');
      var bf = getComputedStyle(panel).backdropFilter || getComputedStyle(panel).webkitBackdropFilter || 'none';
      return {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        docScroll: document.documentElement.scrollWidth,
        bodyScroll: document.body.scrollWidth,
        small: small.slice(0, 10), smallCount: small.length,
        tiny: tiny.slice(0, 10), tinyCount: tiny.length,
        bodyFont: parseFloat(getComputedStyle(document.body).fontSize) || 0,
        seats: seats.length, overlap: overlap, outside: outside,
        reach: reach, bodyMin: parseFloat(getComputedStyle(document.body).minHeight) || 0,
        backdrop: bf
      };
    })()`);
    ok(vp.name + ' no horizontal overflow', m.docScroll <= vp.width && m.bodyScroll <= vp.width, m.docScroll + '/' + m.bodyScroll);
    ok(vp.name + ' viewport matches emulation', m.innerWidth === vp.width && m.innerHeight === vp.height, m.innerWidth + 'x' + m.innerHeight);
    ok(vp.name + ' all touch targets >=44px', m.smallCount === 0, JSON.stringify(m.small));
    ok(vp.name + ' all visible text >=12px', m.tinyCount === 0, JSON.stringify(m.tiny));
    ok(vp.name + ' body font >=14px', m.bodyFont >= 14, 'font=' + m.bodyFont);
    ok(vp.name + ' action reachable', m.reach === true);
    ok(vp.name + ' 100dvh resolves', m.bodyMin >= Math.min(vp.height, 300), 'minHeight=' + m.bodyMin);
    ok(vp.name + ' keeps 6 seats', m.seats === 6);
    ok(vp.name + ' seats stay inside viewport', m.outside === 0, 'outside=' + m.outside);
    eq(vp.name + ' seats do not overlap', m.overlap, 0);
    ok(vp.name + ' panel backdrop-filter disabled on touch', m.backdrop === 'none' || m.backdrop === '', m.backdrop);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(150);

  section('Real click: income and AI turn');
  await evaluate(`__coup.newGame({playerCount:2, difficulty:'normal', seed: 111222})`);
  await waitFor('2p game', `__coup.getState().playerCount === 2 && __coup.phase() === 'action'`);
  await click('[data-action="income"]');
  await waitFor('income recorded', `__coup.getState().players[0].coins === 3`, 5000);
  ok('income click adds a coin', (await evaluate('__coup.getState().players[0].coins')) === 3);
  const aiProgress = await passHumanPrompts(14000);
  ok('AI completed a turn after human income', !!aiProgress && (aiProgress.turns >= 2 || aiProgress.over), JSON.stringify(aiProgress));

  section('Real click: challenge -> discard');
  const challengeCraft = await evaluate(`(function(){
    var E=window.CoupEngine;
    var s=E.createGame({playerCount:2, seed:333444, aiAll:false, humanSeat:0});
    s.current=1;
    s.players[1].influence[0].role='duke';
    s.phase='challenge';
    s.pending={action:'tax',actor:1,target:null,claim:'duke',challenger:null,blockClaim:null,blocker:null,challengeQueue:[0],blockQueue:[],blockRoles:[],discardQueue:[],discardReason:'',cont:'afterChallenge',exchange:null};
    s.log.push('测试：玩家1宣称公爵征税。');
    __coup.setState(s);
    return { phase: __coup.phase(), modal: __coup.modal(), actor: __coup.actorId() };
  })()`);
  eq('crafted challenge phase', challengeCraft.phase, 'challenge');
  eq('crafted challenge actor is human', challengeCraft.actor, 0);
  eq('challenge modal opens', challengeCraft.modal.kind, 'challenge');
  await waitFor('challenge modal visible', `document.getElementById('decisionModal').hidden === false`);
  ok('challenge modal visible', (await evaluate(`document.getElementById('decisionModal').hidden`)) === false);
  await click('[data-decision="challenge"]');
  await waitFor('discard modal offered', `__coup.phase() === 'discard' && __coup.modal().kind === 'discard'`, 5000);
  eq('discard phase after failed challenge', await evaluate('__coup.phase()'), 'discard');
  await click('[data-discard-index="0"]');
  await waitFor('challenge resolved', `__coup.phase() === 'action'`, 5000);
  const challengeResult = await evaluate(`({
    coins1: __coup.getState().players[1].coins,
    lost0: __coup.getState().players[0].lost.length,
    log: __coup.getState().log.slice(-6),
    modalHidden: document.getElementById('decisionModal').hidden
  })`);
  eq('true claim resolves tax +3', challengeResult.coins1, 5);
  eq('challenger loses one honour', challengeResult.lost0, 1);
  ok('challenge is logged', challengeResult.log.some(function (line) { return /挑战失败/.test(line); }), JSON.stringify(challengeResult.log));
  ok('decision modal hidden after resolution', challengeResult.modalHidden === true);

  section('Real click: block challenge -> discard');
  const blockCraft = await evaluate(`(function(){
    var E=window.CoupEngine;
    var s=E.createGame({playerCount:2, seed:555666, aiAll:false, humanSeat:0});
    s.current=0;
    s.players[1].influence[0].role='duke';
    s.phase='blockChallenge';
    s.pending={action:'foreign_aid',actor:0,target:null,claim:null,challenger:null,blockClaim:'duke',blocker:1,challengeQueue:[],blockQueue:[1],blockRoles:['duke'],discardQueue:[],discardReason:'',cont:'blockStands',exchange:null};
    s.log.push('测试：玩家2以公爵阻挡外援。');
    __coup.setState(s);
    return { phase: __coup.phase(), modal: __coup.modal(), actor: __coup.actorId() };
  })()`);
  eq('crafted blockChallenge phase', blockCraft.phase, 'blockChallenge');
  eq('blockChallenge modal opens', blockCraft.modal.kind, 'blockChallenge');
  await waitFor('block challenge modal visible', `document.getElementById('decisionModal').hidden === false`);
  await click('[data-decision="challenge"]');
  await waitFor('block challenge discard offered', `__coup.phase() === 'discard'`, 5000);
  await click('[data-discard-index="0"]');
  await waitFor('block challenge resolved', `__coup.phase() === 'action'`, 5000);
  const blockResult = await evaluate(`({
    lost0: __coup.getState().players[0].lost.length,
    lost1: __coup.getState().players[1].lost.length,
    coins0: __coup.getState().players[0].coins,
    current: __coup.getState().current
  })`);
  eq('true block costs the actor one honour', blockResult.lost0, 1);
  eq('true blocker keeps both honours', blockResult.lost1, 0);
  eq('blocked foreign aid pays nothing', blockResult.coins0, 2);
  eq('block challenge ends the turn', blockResult.current, 1);

  section('Real click: exchange selection, Escape, keep');
  const exchangeCraft = await evaluate(`(function(){
    var E=window.CoupEngine;
    var s=E.createGame({playerCount:2, seed:777888, aiAll:false, humanSeat:0});
    var drawn=s.deck.splice(0,2);
    s.current=0;
    s.phase='exchange';
    s.pending={action:'exchange',actor:0,target:null,claim:'ambassador',challenger:null,blockClaim:null,blocker:null,challengeQueue:[],blockQueue:[],blockRoles:[],discardQueue:[],discardReason:'',cont:'end',exchange:{actor:0,cards:s.players[0].influence.concat(drawn),drawn:2}};
    s.log.push('测试：交换身份。');
    __coup.setState(s);
    return { cards: document.querySelectorAll('[data-exchange-index]').length, modal: __coup.modal() };
  })()`);
  eq('exchange modal shows four cards', exchangeCraft.cards, 4);
  eq('exchange modal kind', exchangeCraft.modal.kind, 'exchange');
  await click('[data-exchange-index="0"]');
  await sleep(120);
  eq('first exchange card selected', await evaluate('__coup.modal().selected.length'), 1);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(120);
  eq('Escape clears exchange selection', await evaluate('__coup.modal().selected.length'), 0);
  await click('[data-exchange-index="0"]');
  await click('[data-exchange-index="1"]');
  await sleep(150);
  eq('two exchange cards selected', await evaluate('__coup.modal().selected.length'), 2);
  ok('exchange confirm enabled', await evaluate(`!document.querySelector('[data-exchange-confirm]').disabled`));
  await click('[data-exchange-confirm]');
  await waitFor('exchange completes', `__coup.phase() === 'action' && document.getElementById('decisionModal').hidden`, 5000);
  const exchangeResult = await evaluate(`(function(){
    var s=__coup.getState();
    var n=s.deck.length;
    s.players.forEach(function(p){ n += p.influence.length; });
    n += s.discard.length;
    return { hand: s.players[0].influence.length, current: s.current, cards: n, modalHidden: document.getElementById('decisionModal').hidden, log: s.log.slice(-5) };
  })()`);
  eq('exchange keeps exactly two honours', exchangeResult.hand, 2);
  eq('exchange advances the turn', exchangeResult.current, 1);
  eq('exchange conserves 15 cards', exchangeResult.cards, 15);
  ok('exchange completion logged', exchangeResult.log.some(function (line) { return /完成交换/.test(line); }), JSON.stringify(exchangeResult.log));

  section('Real click: target picker and coup');
  await evaluate(`__coup.newGame({playerCount:2, difficulty:'normal', seed:999000})`);
  await waitFor('target game ready', `__coup.phase() === 'action' && __coup.actorId() === 0`);
  await evaluate(`(function(){ var s=__coup.getState(); s.players[0].coins=7; __coup.setState(s); return true; })()`);
  await click('[data-action="coup"]');
  await waitFor('target modal opens', `document.getElementById('targetModal').hidden === false`);
  eq('target modal has one opponent', await evaluate(`document.querySelectorAll('[data-target]').length`), 1);
  await click('[data-target="1"]');
  await waitFor('coup resolves and AI discards', `__coup.phase() === 'action' && __coup.actorId() === 0`, 12000);
  const coupResult = await evaluate(`({ coins: __coup.getState().players[0].coins, lost: __coup.getState().players[1].lost.length, hidden: document.getElementById('targetModal').hidden })`);
  eq('coup spent all 7 coins', coupResult.coins, 0);
  eq('coup target lost one honour', coupResult.lost, 1);
  ok('target modal hidden after coup', coupResult.hidden === true);

  section('Endgame -> result -> restart (2p)');
  const end2 = await evaluate('__coup.autoPlayToEnd(500)');
  ok('auto-play reaches game over', !!end2 && end2.over === true, JSON.stringify({ over: end2 && end2.over }));
  ok('auto-play has a winner', end2 && end2.winner >= 0 && end2.winner < 2, 'winner=' + (end2 && end2.winner));
  await waitFor('result modal shown', `document.getElementById('resultModal').hidden === false`, 4000);
  const modal2 = await evaluate(`({
    hidden: document.getElementById('resultModal').hidden,
    title: document.getElementById('resultTitle').textContent,
    rows: document.querySelectorAll('#resultTable tr').length,
    alive: __coup.getState().players.filter(function(p){ return !p.eliminated; }).length
  })`);
  ok('result modal visible', modal2.hidden === false);
  ok('result title names a winner', /获胜|结束/.test(modal2.title), modal2.title);
  eq('result table has two rows', modal2.rows, 2);
  eq('exactly one player survives', modal2.alive, 1);
  ok('endgame log mentions winner', (await evaluate(`__coup.getState().log.some(function(l){ return /赢得本局/.test(l); })`)) === true);
  await click('#againBtn');
  await waitFor('restart resets the game', `document.getElementById('resultModal').hidden === true && __coup.phase() === 'action' && __coup.getState().turns === 0`, 6000);
  const restarted = await evaluate(`({ coins: __coup.getState().players.map(function(p){ return p.coins; }), over: __coup.getState().over, hand: __coup.getState().players.map(function(p){ return p.influence.length; }) })`);
  eq('restart resets coins', restarted.coins, [2, 2]);
  eq('restart resets honours', restarted.hand, [2, 2]);
  eq('restart is not over', restarted.over, false);

  section('Endgame -> result (6p)');
  const end6 = await evaluate(`(function(){ __coup.newGame({playerCount:6, difficulty:'hard', seed:123456}); return __coup.autoPlayToEnd(600); })()`);
  ok('6p auto-play reaches game over', end6 && end6.over === true);
  await waitFor('6p result modal shown', `document.getElementById('resultModal').hidden === false`, 4000);
  const modal6 = await evaluate(`({
    rows: document.querySelectorAll('#resultTable tr').length,
    alive: __coup.getState().players.filter(function(p){ return !p.eliminated; }).length,
    cards: (function(){ var s=__coup.getState(), n=s.deck.length; s.players.forEach(function(p){ n+=p.influence.length; }); n+=s.discard.length; return n; })(),
    winner: __coup.getState().winner
  })`);
  eq('6p result table has six rows', modal6.rows, 6);
  eq('6p ends with one survivor', modal6.alive, 1);
  eq('6p endgame conserves 15 cards', modal6.cards, 15);
  ok('6p winner in range', modal6.winner >= 0 && modal6.winner < 6, String(modal6.winner));
  await click('#closeResult');
  await waitFor('result modal can be closed', `document.getElementById('resultModal').hidden === true`);

  section('Service worker and offline reload');
  await navigate(origin + ENTRY, `!!window.__coup && document.querySelectorAll('.seat').length === 4`);
  const swReady = await evaluate(`(async function(){
    if (!('serviceWorker' in navigator)) return { ok:false, reason:'no sw' };
    var reg = await navigator.serviceWorker.ready;
    return { ok:true, scope: reg.scope, controller: !!navigator.serviceWorker.controller };
  })()`);
  ok('service worker registered', swReady.ok === true, JSON.stringify(swReady));
  if (!swReady.controller) {
    await cdp.send('Page.reload');
    await waitFor('controlled reload', `!!window.__coup && !!navigator.serviceWorker.controller`, 15000);
  }
  ok('service worker controls the page', (await evaluate('!!navigator.serviceWorker.controller')) === true);
  const swCache = await evaluate(`(async function(){
    var keys = await caches.keys();
    var cache = await caches.open('coup-premium-v1');
    var urls = ['./index.html','./engine.js','./rules.html','../../shared/shuffle.js','../../shared/sfx.js','../../assets/art/premium/coup/card-back.webp','./assets/cover.webp'];
    var hits = [];
    for (var i=0;i<urls.length;i++) { hits.push(!!(await cache.match(urls[i]))); }
    return { keys: keys, hits: hits };
  })()`);
  ok('coup cache installed', swCache.keys.indexOf('coup-premium-v1') >= 0, JSON.stringify(swCache.keys));
  ok('cache contains index shell', swCache.hits[0] === true);
  ok('cache contains engine', swCache.hits[1] === true);
  ok('cache contains rules', swCache.hits[2] === true);
  ok('cache contains shared shuffle', swCache.hits[3] === true);
  ok('cache contains shared sfx', swCache.hits[4] === true);
  ok('cache contains card-back material', swCache.hits[5] === true);
  ok('cache contains cover art', swCache.hits[6] === true);
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await cdp.send('Page.reload');
  await waitFor('offline reload boots from cache', `!!window.__coup && document.querySelectorAll('.seat').length === 4`, 15000);
  ok('offline reload boots the game', (await evaluate('!!window.__coup')) === true);
  ok('offline state still has 4 seats', (await evaluate(`document.querySelectorAll('.seat').length`)) === 4);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await sleep(150);

  section('Rules page: sources and JSON-LD');
  await navigate(origin + RULES, `document.querySelectorAll('details').length > 0`);
  const rules = await evaluate(`(function(){
    var scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){ return s.textContent; });
    var parsed = scripts.map(function(t){ try { return JSON.parse(t); } catch(e){ return null; } });
    var article = parsed.find(function(x){ return x && x['@type'] === 'Article'; }) || null;
    var faq = parsed.find(function(x){ return x && x['@type'] === 'FAQPage'; }) || null;
    return {
      title: document.title,
      h2: document.querySelectorAll('h2').length,
      details: document.querySelectorAll('details').length,
      article: article,
      faq: faq,
      text: document.body.textContent,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  })()`);
  ok('rules title', /规则|COUP/.test(rules.title), rules.title);
  ok('rules has multiple sections', rules.h2 >= 6, 'h2=' + rules.h2);
  ok('rules has FAQ entries', rules.details >= 8, 'details=' + rules.details);
  ok('Article JSON-LD parses', !!rules.article);
  ok('Article headline present', rules.article && /政变/.test(rules.article.headline || ''), rules.article && rules.article.headline);
  ok('Article declares 2–6 players', rules.article && rules.article.about && rules.article.about.numberOfPlayers.minValue === 2 && rules.article.about.numberOfPlayers.maxValue === 6);
  ok('FAQPage JSON-LD parses', !!rules.faq);
  ok('FAQPage has at least 8 questions', rules.faq && rules.faq.mainEntity && rules.faq.mainEntity.length >= 8, rules.faq && rules.faq.mainEntity.length);
  ok('Bilibili source BV1pW411Y7kr present', /BV1pW411Y7kr/.test(rules.text));
  ok('Bilibili source BV1ja411575N present', /BV1ja411575N/.test(rules.text));
  ok('official rules source present', /indieboardsandcards\.com\/coup\.php/.test(rules.text) && /ultraboardgames\.com\/coup\/game-rules\.php/.test(rules.text));
  ok('rules page no horizontal overflow', rules.scrollWidth <= rules.innerWidth + 1, rules.scrollWidth + '/' + rules.innerWidth);
  ok('rules page brings zero external requests', EXTERNAL().length === 0, JSON.stringify(EXTERNAL()));

  section('Art composition: 15 cards and 6 seats');
  await navigate(origin + '/boardgame/coup-premium/art-render.html?shot=cover', `window.__artReady === true`);
  const artCover = await evaluate(`(function(){
    var imgs = Array.from(document.images);
    return {
      counts: window.__artCounts,
      width: document.getElementById('canvas').getBoundingClientRect().width,
      height: document.getElementById('canvas').getBoundingClientRect().height,
      images: imgs.length,
      broken: imgs.filter(function(i){ return i.complete && i.naturalWidth === 0; }).length
    };
  })()`);
  eq('cover shows exactly 15 identity cards', artCover.counts.cards, 15);
  eq('cover shows exactly 6 seats', artCover.counts.seats, 6);
  ok('cover shows coins for every seat', artCover.counts.coins >= 12, 'coins=' + artCover.counts.coins);
  eq('cover shows five roles', artCover.counts.roles, 5);
  eq('cover canvas 1200x1200', [artCover.width, artCover.height], [1200, 1200]);
  ok('cover images all load', artCover.images >= 3 && artCover.broken === 0, 'images=' + artCover.images + ' broken=' + artCover.broken);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + '/boardgame/coup-premium/art-render.html?shot=og', `window.__artReady === true`);
  const artOG = await evaluate(`({ counts: window.__artCounts, size: [document.getElementById('canvas').getBoundingClientRect().width, document.getElementById('canvas').getBoundingClientRect().height] })`);
  eq('OG shows exactly 15 identity cards', artOG.counts.cards, 15);
  eq('OG shows exactly 6 seats', artOG.counts.seats, 6);
  eq('OG canvas 1200x630', artOG.size, [1200, 630]);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + '/boardgame/coup-premium/art-render.html?shot=detail1', `window.__artReady === true`);
  const artD1 = await evaluate(`({ counts: window.__artCounts, size: [document.getElementById('canvas').getBoundingClientRect().width, document.getElementById('canvas').getBoundingClientRect().height] })`);
  eq('detail-1 shows exactly 15 identity cards', artD1.counts.cards, 15);
  eq('detail-1 shows six seats', artD1.counts.seats, 6);
  eq('detail-1 canvas 1200x800', artD1.size, [1200, 800]);
  await navigate(origin + '/boardgame/coup-premium/art-render.html?shot=detail2', `window.__artReady === true`);
  const artD2 = await evaluate(`({ counts: window.__artCounts, size: [document.getElementById('canvas').getBoundingClientRect().width, document.getElementById('canvas').getBoundingClientRect().height] })`);
  eq('detail-2 shows exactly 15 identity cards', artD2.counts.cards, 15);
  eq('detail-2 shows six seats', artD2.counts.seats, 6);
  eq('detail-2 canvas 1200x800', artD2.size, [1200, 800]);
  ok('art pages bring zero external requests', EXTERNAL().length === 0, JSON.stringify(EXTERNAL()));

  section('Online lobby page');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await navigate(origin + '/boardgame/coup-premium/online.html', `!!document.getElementById('createBtn')`);
  const lobby = await evaluate(`(function(){
    var targets = Array.from(document.querySelectorAll('button, a')).filter(function(el){ return !!(el.offsetWidth||el.offsetHeight); });
    var small = targets.filter(function(el){ var r=el.getBoundingClientRect(); return r.width<44||r.height<44; }).length;
    return {
      title: document.title,
      create: !!document.getElementById('createBtn'),
      join: !!document.getElementById('joinBtn'),
      inputs: document.querySelectorAll('input, select').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      small: small
    };
  })()`);
  ok('online lobby title', /联机|COUP/.test(lobby.title), lobby.title);
  ok('online lobby has create button', lobby.create === true);
  ok('online lobby has join button', lobby.join === true);
  ok('online lobby has room form fields', lobby.inputs >= 5, 'inputs=' + lobby.inputs);
  ok('online lobby 390 no horizontal overflow', lobby.scrollWidth <= lobby.innerWidth + 1, lobby.scrollWidth + '/' + lobby.innerWidth);
  ok('online lobby touch targets >=44px', lobby.small === 0, 'small=' + lobby.small);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 568, deviceScaleFactor: 2, mobile: true });
  await evaluate('window.scrollTo(0,0)');
  await sleep(200);
  const lobby320 = await evaluate(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })`);
  ok('online lobby 320 no horizontal overflow', lobby320.scrollWidth <= lobby320.innerWidth + 1, lobby320.scrollWidth + '/' + lobby320.innerWidth);
  ok('online lobby zero external requests', EXTERNAL().length === 0, JSON.stringify(EXTERNAL()));

  section('Final performance probes');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ENTRY, `!!window.__coup && document.querySelectorAll('.seat').length === 4`);
  const fps = await evaluate(`new Promise(function(resolve){
    var frames = 0, start = performance.now();
    function loop(t){ frames++; if (t - start >= 800) resolve(frames / ((t - start) / 1000)); else requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  })`);
  ok('rAF FPS >=30', fps >= 30, 'fps=' + Math.round(fps));
  perf.fps = Math.round(fps);
  const newGameMs = await evaluate(`(function(){ var t=performance.now(); __coup.newGame({playerCount:6, difficulty:'normal', seed:2026}); return performance.now()-t; })()`);
  ok('new game render under 200ms', newGameMs >= 0 && newGameMs < 200, 'ms=' + newGameMs.toFixed(1));
  perf.newGameRenderMs = Number(newGameMs.toFixed(1));
  const moveMs = await evaluate(`(function(){
    __coup.newGame({playerCount:2, difficulty:'normal', seed:303});
    var t=performance.now();
    __coup.playAction({type:'income'});
    return performance.now()-t;
  })()`);
  ok('pure action latency under 500ms', moveMs >= 0 && moveMs < 500, 'ms=' + moveMs.toFixed(1));
  perf.pureMoveMs = Number(moveMs.toFixed(1));
  await sleep(700);
  const finalNodes = await evaluate(`document.getElementsByTagName('*').length`);
  ok('final DOM nodes under 2500', finalNodes < 2500, 'nodes=' + finalNodes);
  perf.domNodes = Math.max(perf.domNodes || 0, finalNodes);
  ok('no external requests during the suite', EXTERNAL().length === 0, JSON.stringify(EXTERNAL()));
  perf.externalRequests = EXTERNAL().length;
  ok('no console errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
  ok('no uncaught page exceptions', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));
  console.log('  PERF ' + JSON.stringify(perf));

  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:');
    failures.forEach((line) => console.log(' - ' + line));
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err && err.stack ? err.stack : String(err));
  console.log('');
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exitCode = 1;
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) {}
  await new Promise((resolve) => server.close(resolve));
}
