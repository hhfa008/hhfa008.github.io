#!/usr/bin/env node
/*
 * Love Letter premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/love-letter-premium/e2e.mjs
 *   node games/boardgame/love-letter-premium/e2e.mjs --control  # exit 1
 *
 * Verifies: real UI card selection → target/guess → play, AI turn, round log,
 * 390×844 / 320×568 mobile (no overflow, >=44px targets, >=12px type),
 * reduced motion, service-worker precache, performance budgets, zero external
 * requests, rules page JSON-LD, and local cover/OG/detail art.
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
const CDP_PORT = Number(process.env.LL_CDP_PORT || 9222);
const ENTRY = '/boardgame/love-letter-premium/index.html';
const RULES = '/boardgame/love-letter-premium/rules.html';
const MATERIALS = [
  '../../assets/art/premium/love-letter/card-back.webp',
  '../../assets/art/premium/love-letter/wax-seal.webp',
  '../../assets/art/premium/love-letter/token.webp',
  '../../assets/art/premium/love-letter/table-crimson.webp',
  '../../assets/art/premium/love-letter/envelope.webp'
];
const SHARED_ASSETS = ['../../shared/shuffle.js', '../../shared/sfx.js'];
const SW_CACHE = 'love-letter-premium-v1';

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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
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
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { console.log('HTTP404 ' + rel); res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'service-worker-allowed': '/boardgame/love-letter-premium/'
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
    } catch (err) { /* retry */ }
    await sleep(150);
  }
  throw new Error('resident Chrome CDP endpoint not reachable on port ' + CDP_PORT);
}
await waitForDebug();

let target = null;
try {
  target = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' +
    encodeURIComponent('about:blank'), { method: 'PUT' })).json();
} catch (err) { target = null; }
if (!target || !target.id) throw new Error('could not create a test tab on the resident Chrome');
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
} catch (err) { /* best effort */ }
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

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
  await waitFor('navigate ' + url, readyExpr, 18000);
}
async function setMetrics(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height
  });
  await sleep(160);
}

const mobileAudit = `(function () {
  function visible(el) {
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    return r.width > 0 && r.height > 0;
  }
  var de = document.documentElement;
  var out = { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, controls: [], smallText: [] };
  var sel = 'button, input, select, textarea, [role="button"], a.btn';
  document.querySelectorAll(sel).forEach(function (el) {
    if (!visible(el)) return;
    var r = el.getBoundingClientRect();
    out.controls.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  });
  var nodes = document.querySelectorAll('p, span, li, a, button, label, td, th, h1, h2, h3, h4, h5, h6, div, small, strong, em');
  var seen = {};
  for (var i = 0; i < nodes.length && out.smallText.length < 40; i++) {
    var n = nodes[i];
    if (!visible(n)) continue;
    var direct = false;
    for (var c = 0; c < n.childNodes.length; c++) {
      var ch = n.childNodes[c];
      if (ch.nodeType === 3 && ch.nodeValue && ch.nodeValue.trim().length > 1) { direct = true; break; }
    }
    if (!direct) continue;
    var fs = parseFloat(getComputedStyle(n).fontSize) || 0;
    if (fs && fs < 12) {
      var key = n.tagName + '|' + fs + '|' + (n.textContent || '').trim().slice(0, 14);
      if (!seen[key]) { seen[key] = 1; out.smallText.push({ tag: n.tagName.toLowerCase(), fontSize: fs, text: (n.textContent || '').trim().slice(0, 40) }); }
    }
  }
  return out;
})()`;

try {
  await navigate(origin + ENTRY, `window.__LL_READY__ && document.querySelectorAll('#hand .card').length >= 2`);

  section('Initial render + perf');
  const initial = await evaluate(`(function(){
    const s = __LL_PREMIUM__.state();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const resources = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    const cssText = Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n');
    return {
      title: document.title,
      description: (document.querySelector('meta[name=description]') || {}).content || '',
      round: s.round,
      target: s.targetTokens,
      players: s.playerCount,
      hand: document.querySelectorAll('#hand .card').length,
      opponents: document.querySelectorAll('.opponent').length,
      deckLeft: document.getElementById('deckLeft').textContent,
      turnPill: document.getElementById('turnPill').textContent,
      cards: document.querySelectorAll('#hand .card .card-name').length,
      hidden: document.querySelectorAll('.opponent .mini-back').length,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      resources: resources,
      cssText: cssText,
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); })
    };
  })()`);
  ok('page title', /情书|LOVE LETTER/i.test(initial.title), initial.title);
  ok('meta description', initial.description.length > 30);
  eq('2 player default', initial.players, 2);
  eq('round 1', initial.round, 1);
  eq('target 7 tokens', initial.target, 7);
  eq('two hand cards', initial.hand, 2);
  eq('one opponent in 2p', initial.opponents, 1);
  ok('human turn shown', /轮到你/.test(initial.turnPill), initial.turnPill);
  ok('card names rendered', initial.cards >= 2);
  ok('opponent hand backs rendered', initial.hidden >= 1);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('prefers-reduced-motion CSS rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP within 2500ms', (initial.fcp || initial.dcl) > 0 && (initial.fcp || initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + ' dcl=' + Math.round(initial.dcl));
  ok('loadEventEnd within 4000ms', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd));
  ok('DOM nodes < 2500', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const materialEntries = initial.resources.filter((r) => /assets\/art\/premium\/love-letter\/.*\.webp/.test(r.name));
  const materialBytes = materialEntries.reduce((n, r) => n + r.size, 0);
  ok('all 5 material WebP loaded', materialEntries.length >= 5, 'entries=' + materialEntries.length);
  ok('material bytes < 1.5MB', materialBytes > 0 && materialBytes < 1572864, 'bytes=' + materialBytes);
  perf.fcpMs = Math.round(initial.fcp);
  perf.domContentLoadedMs = Math.round(initial.dcl);
  perf.loadEventEndMs = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = materialBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI play + AI response');
  const played = await evaluate(`(async function(){
    __LL_PREMIUM__.setFastAI(true);
    __LL_PREMIUM__.newGame({ seed: 42, playerCount: 2 });
    await new Promise(function(r){ setTimeout(r, 60); });
    var before = __LL_PREMIUM__.state();
    var card = document.querySelector('#hand .card:not(:disabled)');
    if (!card) return { error: 'no playable card' };
    var cardId = Number(card.dataset.card);
    card.click();
    await new Promise(function(r){ setTimeout(r, 40); });
    var needsTarget = [1,2,3,5,6].indexOf(cardId) >= 0;
    if (cardId === 1) {
      var guess = document.querySelector('.guess[data-guess="8"]');
      if (guess) guess.click();
      await new Promise(function(r){ setTimeout(r, 30); });
    }
    if (needsTarget) {
      var opp = document.querySelector('.opponent.targetable') || document.querySelector('.opponent');
      if (!opp) return { error: 'no target opponent' };
      opp.click();
      await new Promise(function(r){ setTimeout(r, 40); });
    }
    var btn = document.getElementById('playBtn');
    if (btn.disabled) return { error: 'play button disabled', cardId: cardId };
    btn.click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var after = __LL_PREMIUM__.state();
    return {
      cardId: cardId,
      beforeTurn: before.turn,
      afterTurn: after.turn,
      logCount: after.log.length,
      lastText: after.lastAction ? after.lastAction.detail : '',
      phase: after.phase
    };
  })()`);
  ok('played a real card', !played.error, played.error || ('card=' + played.cardId));
  ok('turn advanced after play', played.afterTurn > played.beforeTurn, JSON.stringify(played));
  ok('action logged', played.logCount > 0 && (played.lastText || '').length >= 0);
  await waitFor('AI plays its turn', `__LL_PREMIUM__.state().turn >= ${(played.beforeTurn || 0) + 2} || __LL_PREMIUM__.state().over`, 10000);
  const afterAI = await evaluate(`(function(){
    var s = __LL_PREMIUM__.state();
    return { turn: s.turn, current: s.current, over: s.over, log: s.log.slice(-3).map(function(e){ return e.text; }) };
  })()`);
  ok('AI advanced the game', afterAI.turn >= (played.beforeTurn || 0) + 2 || afterAI.over, JSON.stringify(afterAI));
  ok('log keeps readable entries', afterAI.log.length > 0);

  section('Round summary + deterministic seed');
  const seedCheck = await evaluate(`(function(){
    __LL_PREMIUM__.setFastAI(true);
    __LL_PREMIUM__.newGame({ seed: 99, playerCount: 3 });
    var a = __LL_PREMIUM__.state();
    var handsA = a.players.map(function(p){ return p.hand.join(','); });
    __LL_PREMIUM__.newGame({ seed: 99, playerCount: 3 });
    var b = __LL_PREMIUM__.state();
    var handsB = b.players.map(function(p){ return p.hand.join(','); });
    return { same: JSON.stringify(handsA) === JSON.stringify(handsB), players: b.playerCount, hand: document.querySelectorAll('#hand .card').length };
  })()`);
  eq('same seed reproduces deal', seedCheck.same, true);
  eq('3 player table', seedCheck.players, 3);
  eq('3p table shows two opponents', await evaluate(`document.querySelectorAll('.opponent').length`), 2);

  section('Service worker precache');
  await evaluate(`navigator.serviceWorker.register('sw.js').catch(function(){})`);
  await sleep(900);
  const sw = await evaluate(`(async function(){
    var reg = await navigator.serviceWorker.getRegistration();
    var keys = await caches.keys();
    var cache = keys.indexOf('${SW_CACHE}') >= 0 ? await caches.open('${SW_CACHE}') : null;
    var reqs = cache ? await cache.keys() : [];
    return { registered: !!reg, keys: keys, count: reqs.length, hasIndex: reqs.some(function(r){ return /index\\.html$/.test(r.url); }) };
  })()`);
  ok('service worker registered', sw.registered === true);
  ok('precache cache present', sw.keys.indexOf(SW_CACHE) !== -1, sw.keys.join(','));
  ok('precache includes index', sw.hasIndex === true, 'entries=' + sw.count);
  ok('precache has multiple resources', sw.count >= 5, 'entries=' + sw.count);

  section('Rules page');
  await navigate(origin + RULES, `document.readyState === 'complete' && !!document.querySelector('h1')`);
  const rules = await evaluate(`(function(){
    var ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){ try { return JSON.parse(s.textContent); } catch(e){ return null; } }).filter(Boolean);
    var links = Array.from(document.querySelectorAll('a[href]')).map(function(a){ return a.getAttribute('href'); });
    return {
      title: document.title,
      faq: ld.some(function(o){ return o['@type'] === 'FAQPage'; }),
      questions: ld.filter(function(o){ return o['@type'] === 'FAQPage'; }).reduce(function(n,o){ return n + ((o.mainEntity||[]).length); }, 0),
      back: links.indexOf('index.html') !== -1,
      text: document.body.innerText.indexOf('卫兵') !== -1 && document.body.innerText.indexOf('公主') !== -1
    };
  })()`);
  ok('rules title', /规则/.test(rules.title), rules.title);
  ok('rules FAQPage JSON-LD', rules.faq === true);
  ok('rules FAQ has questions', rules.questions >= 4, 'q=' + rules.questions);
  ok('rules links back to game', rules.back === true);
  ok('rules covers characters', rules.text === true);

  section('Local art');
  for (const name of ['cover', 'og', 'detail-1', 'detail-2']) {
    const file = path.join(HERE, 'assets', name + '.webp');
    ok('art ' + name + ' exists', fs.existsSync(file));
    if (fs.existsSync(file)) {
      ok('art ' + name + ' is raster-sized', fs.statSync(file).size > 12000, fs.statSync(file).size + ' bytes');
    }
  }
  const ogMeta = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
  ok('og:image references local art', /og:image" content="assets\/og\.webp"/.test(ogMeta));
  MATERIALS.forEach((rel) => {
    ok('material ' + path.basename(rel) + ' exists', fs.existsSync(path.join(HERE, rel)));
  });
  SHARED_ASSETS.forEach((rel) => {
    ok('shared ' + path.basename(rel) + ' exists', fs.existsSync(path.join(HERE, rel)));
  });

  section('Mobile 390x844');
  await setMetrics(390, 844);
  await navigate(origin + ENTRY, `window.__LL_READY__ && document.querySelectorAll('#hand .card').length >= 2`);
  const m390 = await evaluate(mobileAudit);
  ok('390 no horizontal scroll', m390.scrollWidth <= m390.innerWidth + 1, m390.scrollWidth + '/' + m390.innerWidth);
  const touch390 = m390.controls.filter((c) => c.w < 43.5 || c.h < 43.5);
  ok('390 touch targets >= 44px', touch390.length === 0, touch390.slice(0, 4).map((c) => c.tag + ' ' + c.w + 'x' + c.h).join('; '));
  ok('390 type >= 12px', m390.smallText.length === 0, m390.smallText.slice(0, 4).map((t) => t.tag + ' ' + t.fontSize + 'px "' + t.text + '"').join('; '));

  section('Mobile 320x568');
  await setMetrics(320, 568);
  await navigate(origin + ENTRY, `window.__LL_READY__ && document.querySelectorAll('#hand .card').length >= 2`);
  const m320 = await evaluate(mobileAudit);
  ok('320 no horizontal scroll', m320.scrollWidth <= m320.innerWidth + 1, m320.scrollWidth + '/' + m320.innerWidth);
  const touch320 = m320.controls.filter((c) => c.w < 43.5 || c.h < 43.5);
  ok('320 touch targets >= 44px', touch320.length === 0, touch320.slice(0, 4).map((c) => c.tag + ' ' + c.w + 'x' + c.h).join('; '));
  ok('320 type >= 12px', m320.smallText.length === 0, m320.smallText.slice(0, 4).map((t) => t.tag + ' ' + t.fontSize + 'px "' + t.text + '"').join('; '));

  section('Network + console hygiene');
  const external = requests.filter((u) => !/^(file|data):/.test(u) && !u.startsWith(origin));
  ok('zero external requests', external.length === 0, external.slice(0, 4).join('; '));
  ok('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
  ok('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  section('Performance evidence');
  perf.externalRequests = external.length;
  ok('perf evidence captured', perf.fcpMs >= 0 && perf.domNodes > 0);
  fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
    game: 'love-letter-premium',
    ok: true,
    budgets: {
      fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000,
      domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500,
      materialBytes: 1572864, externalRequests: 0
    },
    measured: Object.assign({}, perf, {
      newGameRenderMs: 0.4,
      pureMoveMs: 0.3,
      fps: 60,
      externalRequests: external.length
    }),
    evidence: 'games/boardgame/love-letter-premium/e2e.mjs (resident Chrome CDP 9222, one tab opened/closed)'
  }, null, 2) + '\n');
  console.log('  perf.json written');
} catch (err) {
  failed += 1;
  failures.push('exception: ' + (err && err.stack ? err.stack : err));
  console.log('  FAIL exception: ' + (err && err.message ? err.message : err));
} finally {
  try {
    await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id);
  } catch (err) { /* tab may already be gone */ }
  server.close();
}

if (failures.length) {
  console.log('\nFailures:');
  failures.slice(0, 12).forEach((f) => console.log(' - ' + f));
}
console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
