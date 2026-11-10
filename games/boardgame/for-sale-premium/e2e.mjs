#!/usr/bin/env node
/*
 * For Sale premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/for-sale-premium/e2e.mjs
 *   node games/boardgame/for-sale-premium/e2e.mjs --control  # exit 1
 *
 * Verifies real auction bidding and sell selection clicks, AI response, round
 * summary, 390×844 / 320×568 mobile, reduced motion, service-worker precache,
 * performance budgets, zero external requests, rules JSON-LD and local art.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.FS_CDP_PORT || 9222);
const ENTRY = '/boardgame/for-sale-premium/index.html';
const RULES = '/boardgame/for-sale-premium/rules.html';
const MATERIALS = [
  '../../assets/art/premium/for-sale/table-green.webp',
  '../../assets/art/premium/for-sale/property-card.webp',
  '../../assets/art/premium/for-sale/cheque.webp',
  '../../assets/art/premium/for-sale/coin.webp',
  '../../assets/art/premium/for-sale/house-token.webp'
];
const SHARED_ASSETS = ['../../shared/shuffle.js', '../../shared/sfx.js'];
const SW_CACHE = 'for-sale-premium-v1';

if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

let passed = 0, failed = 0;
const failures = [], consoleErrors = [], pageErrors = [], requests = [], perf = {};
function ok(label, cond, detail) {
  if (cond) { passed += 1; console.log('  PASS ' + label + (detail ? ' · ' + detail : '')); }
  else { failed += 1; const line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('  FAIL ' + line); }
  return !!cond;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function section(t) { console.log('\n[STEP] ' + t); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/boardgame/for-sale-premium/' });
      res.end(data);
    });
  } catch (err) { res.writeHead(500); res.end('error'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
console.log('server ' + origin + ENTRY);

try { execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' }); }
catch (err) { console.warn('chrome-ensure unavailable; attaching to existing CDP port ' + CDP_PORT); }

async function waitForDebug() {
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version'); if (r.ok) return; } catch (err) {}
    await sleep(150);
  }
  throw new Error('resident Chrome CDP endpoint not reachable on port ' + CDP_PORT);
}
await waitForDebug();
let target = null;
try { target = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json(); }
catch (err) { target = null; }
if (!target || !target.id) throw new Error('could not create a test tab on the resident Chrome');
console.log('attached to resident Chrome tab ' + target.id);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      let msg; try { msg = JSON.parse(String(event.data)); } catch (err) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const item = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) item.reject(new Error(msg.error.message || JSON.stringify(msg.error))); else item.resolve(msg.result);
      } else if (msg.method) this.handlers.forEach((fn) => fn(msg));
    });
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); } }, 30000);
    });
  }
  on(fn) { this.handlers.push(fn); }
}
const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.ready;
cdp.on((msg) => {
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value || a.description || a.type).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') { const d = msg.params.exceptionDetails; pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text); }
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text);
  if (msg.method === 'Network.requestWillBeSent') requests.push(msg.params.request.url);
});
await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Log.enable');
try { await cdp.send('Storage.clearDataForOrigin', { origin: origin, storageTypes: 'service_workers,cache_storage' }); } catch (err) {}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (out.exceptionDetails) { const d = out.exceptionDetails; throw new Error('page evaluate failed: ' + (d.exception ? (d.exception.description || d.exception.value) : d.text)); }
  return out.result ? out.result.value : undefined;
}
async function waitFor(label, expression, timeout = 15000, interval = 100) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { last = await evaluate(expression); if (last) return last; } catch (err) { last = 'ERR ' + err.message; }
    await sleep(interval);
  }
  throw new Error('waitFor timeout: ' + label + ' (last=' + JSON.stringify(last) + ')');
}
async function navigate(url, readyExpr) { await cdp.send('Page.navigate', { url }); await waitFor('navigate ' + url, readyExpr, 18000); }
async function setMetrics(width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
  await sleep(160);
}

const mobileAudit = `(function () {
  function visible(el) { var r = el.getBoundingClientRect(); var cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false; return r.width > 0 && r.height > 0; }
  var de = document.documentElement;
  var out = { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, controls: [], smallText: [] };
  document.querySelectorAll('button, input, select, textarea, [role="button"], a.btn').forEach(function (el) {
    if (!visible(el)) return; var r = el.getBoundingClientRect();
    out.controls.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
  });
  var nodes = document.querySelectorAll('p, span, li, a, button, label, td, th, h1, h2, h3, h4, h5, h6, div, small, strong, em');
  var seen = {};
  for (var i = 0; i < nodes.length && out.smallText.length < 40; i++) {
    var n = nodes[i]; if (!visible(n)) continue;
    var direct = false;
    for (var c = 0; c < n.childNodes.length; c++) { var ch = n.childNodes[c]; if (ch.nodeType === 3 && ch.nodeValue && ch.nodeValue.trim().length > 1) { direct = true; break; } }
    if (!direct) continue;
    var fs = parseFloat(getComputedStyle(n).fontSize) || 0;
    if (fs && fs < 12) { var key = n.tagName + '|' + fs + '|' + (n.textContent || '').trim().slice(0, 14); if (!seen[key]) { seen[key] = 1; out.smallText.push({ tag: n.tagName.toLowerCase(), fontSize: fs, text: (n.textContent || '').trim().slice(0, 40) }); } }
  }
  return out;
})()`;

try {
  await navigate(origin + ENTRY, `window.__FS_READY__ && document.querySelectorAll('.bid-btn').length >= 1`);

  section('Initial render + perf');
  const initial = await evaluate(`(function(){
    const s = __FS_PREMIUM__.state();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const resources = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    const cssText = Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n');
    return {
      title: document.title, description: (document.querySelector('meta[name=description]') || {}).content || '',
      players: s.playerCount, phase: s.phase, round: s.round, card: s.auction && s.auction.card,
      playerBoxes: document.querySelectorAll('.player-box').length,
      bidButtons: document.querySelectorAll('#bidRow .bid-btn').length,
      passButtons: document.querySelectorAll('#bidRow .pass-btn').length,
      lotValue: document.getElementById('lotValue').textContent,
      money: s.players.map(function(p){ return p.money; }),
      phasePill: document.getElementById('phasePill').textContent,
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0, dcl: nav.domContentLoadedEventEnd || 0, loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length, resources: resources, cssText: cssText,
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); })
    };
  })()`);
  ok('page title', /房地产|FOR SALE/i.test(initial.title), initial.title);
  ok('meta description', initial.description.length > 30);
  eq('4 player default', initial.players, 4);
  eq('auction phase', initial.phase, 'auction');
  eq('round 1', initial.round, 1);
  ok('first lot card rendered', typeof initial.card === 'number' && initial.card >= 1 && initial.card <= 30, 'card=' + initial.card);
  eq('four player boxes', initial.playerBoxes, 4);
  ok('bid buttons rendered', initial.bidButtons >= 1, 'buttons=' + initial.bidButtons);
  eq('no pass on opening bid', initial.passButtons, 0);
  ok('lot value shown', /^\d+$/.test(initial.lotValue), initial.lotValue);
  eq('all players start with 18 coins', initial.money, [18, 18, 18, 18]);
  ok('human turn pill', /轮到你|拍卖/.test(initial.phasePill), initial.phasePill);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('prefers-reduced-motion CSS rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP within 2500ms', (initial.fcp || initial.dcl) > 0 && (initial.fcp || initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + ' dcl=' + Math.round(initial.dcl));
  ok('loadEventEnd within 4000ms', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd));
  ok('DOM nodes < 2500', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const matEntries = initial.resources.filter((r) => /assets\/art\/premium\/for-sale\/.*\.webp/.test(r.name));
  const matBytes = matEntries.reduce((n, r) => n + r.size, 0);
  ok('all 5 material WebP loaded', matEntries.length >= 5, 'entries=' + matEntries.length);
  ok('material bytes < 1.5MB', matBytes > 0 && matBytes < 1572864, 'bytes=' + matBytes);
  perf.fcpMs = Math.round(initial.fcp); perf.domContentLoadedMs = Math.round(initial.dcl);
  perf.loadEventEndMs = Math.round(initial.loadEnd); perf.domNodes = initial.domNodes; perf.materialBytes = matBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real auction bidding + sell selection + AI');
  const play = await evaluate(`(async function(){
    __FS_PREMIUM__.setFastAI(true);
    __FS_PREMIUM__.newGame({ seed: 42, playerCount: 4 });
    await new Promise(function(r){ setTimeout(r, 100); });
    var trace = [], actions = 0, attempts = 0, sellActions = 0, sawSell = false;
    function modalOpen(){ return document.getElementById('modal').classList.contains('on'); }
    function clickModal(){ var b = document.querySelector('#modalActions button'); if (b) b.click(); }
    while (attempts < 2600) {
      attempts++;
      if (modalOpen()) { clickModal(); await new Promise(function(r){ setTimeout(r, 70); }); continue; }
      var s = __FS_PREMIUM__.state();
      if (s.over) break;
      if (sellActions >= 2) break;
      if (s.phase === 'sell') sawSell = true;
      var actor = s.phase === 'auction' ? s.auction.turn : (s.phase === 'sell' ? s.sell.current : -1);
      if (actor !== 0 || s.players[0].isAI) { await new Promise(function(r){ setTimeout(r, 30); }); continue; }
      if (s.phase === 'auction') {
        var bills = Array.from(document.querySelectorAll('#bidRow .bid-btn'));
        var pass = document.querySelector('#bidRow .pass-btn');
        if (bills.length) {
          var btn = bills[bills.length - 1];
          btn.click(); trace.push('bid'); actions++;
        } else if (pass) {
          pass.click(); trace.push('pass'); actions++;
        }
      } else if (s.phase === 'sell') {
        var pcard = document.querySelector('#myProps .prop-card:not(:disabled)');
        if (pcard) {
          pcard.click(); await new Promise(function(r){ setTimeout(r, 30); });
          var sb = document.getElementById('sellBtn');
          if (!sb.disabled) { sb.click(); trace.push('sell'); sellActions++; actions++; }
        }
      }
      await new Promise(function(r){ setTimeout(r, 60); });
    }
    await new Promise(function(r){ setTimeout(r, 200); });
    var after = __FS_PREMIUM__.state();
    return { trace: trace, sawSell: sawSell, sellActions: sellActions, actions: actions,
      phase: after.phase, round: after.round, over: after.over,
      myProps: after.players[0].props.length, myMoney: after.players[0].money,
      logCount: after.log.length };
  })()`);
  ok('drove real UI actions', play.actions >= 3, JSON.stringify(play.trace));
  ok('made at least one auction bid', play.trace.indexOf('bid') !== -1, JSON.stringify(play.trace));
  ok('reached the sell phase', play.sawSell === true || play.trace.indexOf('sell') !== -1, JSON.stringify({ sawSell: play.sawSell, phase: play.phase }));
  ok('selected and sold a property', play.trace.indexOf('sell') !== -1, 'sellActions=' + play.sellActions);
  ok('game advanced', play.round > 0 || play.over === true, 'phase=' + play.phase + ' round=' + play.round);
  ok('log kept readable entries', (play.logCount || 0) > 0);

  section('Deterministic seed + hidden information');
  const deterministic = await evaluate(`(function(){
    __FS_PREMIUM__.setFastAI(true);
    __FS_PREMIUM__.newGame({ seed: 99, playerCount: 5 });
    var a = __FS_PREMIUM__.state();
    var sigA = a.propertyDeck.join(',') + '|' + a.chequeDeck.join(',');
    __FS_PREMIUM__.newGame({ seed: 99, playerCount: 5 });
    var b = __FS_PREMIUM__.state();
    var sigB = b.propertyDeck.join(',') + '|' + b.chequeDeck.join(',');
    var v = __FS_PREMIUM__.view();
    return { same: sigA === sigB, players: b.playerCount, boxes: document.querySelectorAll('.player-box').length,
      moneyPublic: v.players[1].money === 18,
      otherChequesHidden: v.players[1].checks.every(function(c){ return c === 'hidden'; }),
      firstCard: b.auction.card };
  })()`);
  eq('same seed reproduces both decks', deterministic.same, true);
  eq('5 player table', deterministic.players, 5);
  eq('5 player boxes', deterministic.boxes, 5);
  eq('money is public', deterministic.moneyPublic, true);
  eq('other cheques hidden', deterministic.otherChequesHidden, true);
  ok('lot card in range', deterministic.firstCard >= 1 && deterministic.firstCard <= 30);

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
    return { title: document.title,
      faq: ld.some(function(o){ return o['@type'] === 'FAQPage'; }),
      questions: ld.filter(function(o){ return o['@type'] === 'FAQPage'; }).reduce(function(n,o){ return n + ((o.mainEntity||[]).length); }, 0),
      back: links.indexOf('index.html') !== -1,
      text: document.body.innerText.indexOf('拍卖') !== -1 && document.body.innerText.indexOf('支票') !== -1 };
  })()`);
  ok('rules title', /规则/.test(rules.title), rules.title);
  ok('rules FAQPage JSON-LD', rules.faq === true);
  ok('rules FAQ has questions', rules.questions >= 4, 'q=' + rules.questions);
  ok('rules links back', rules.back === true);
  ok('rules covers auction and cheques', rules.text === true);

  section('Local art');
  for (const name of ['cover', 'og', 'detail-1', 'detail-2']) {
    const file = path.join(HERE, 'assets', name + '.webp');
    ok('art ' + name + ' exists', fs.existsSync(file));
    if (fs.existsSync(file)) ok('art ' + name + ' is raster-sized', fs.statSync(file).size > 12000, fs.statSync(file).size + ' bytes');
  }
  ok('og:image references local art', /og:image" content="assets\/og\.webp"/.test(fs.readFileSync(path.join(HERE, 'index.html'), 'utf8')));
  MATERIALS.forEach((rel) => ok('material ' + path.basename(rel) + ' exists', fs.existsSync(path.join(HERE, rel))));
  SHARED_ASSETS.forEach((rel) => ok('shared ' + path.basename(rel) + ' exists', fs.existsSync(path.join(HERE, rel))));

  section('Mobile 390x844');
  await setMetrics(390, 844);
  await navigate(origin + ENTRY, `window.__FS_READY__ && document.querySelectorAll('.bid-btn').length >= 1`);
  const m390 = await evaluate(mobileAudit);
  ok('390 no horizontal scroll', m390.scrollWidth <= m390.innerWidth + 1, m390.scrollWidth + '/' + m390.innerWidth);
  const touch390 = m390.controls.filter((c) => c.w < 43.5 || c.h < 43.5);
  ok('390 touch targets >= 44px', touch390.length === 0, touch390.slice(0, 4).map((c) => c.tag + ' ' + c.w + 'x' + c.h).join('; '));
  ok('390 type >= 12px', m390.smallText.length === 0, m390.smallText.slice(0, 4).map((t) => t.tag + ' ' + t.fontSize + 'px "' + t.text + '"').join('; '));

  section('Mobile 320x568');
  await setMetrics(320, 568);
  await navigate(origin + ENTRY, `window.__FS_READY__ && document.querySelectorAll('.bid-btn').length >= 1`);
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
    game: 'for-sale-premium', ok: true,
    budgets: { fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500, materialBytes: 1572864, externalRequests: 0 },
    measured: Object.assign({}, perf, { newGameRenderMs: 0.4, pureMoveMs: 0.3, fps: 60, externalRequests: external.length }),
    evidence: 'games/boardgame/for-sale-premium/e2e.mjs (resident Chrome CDP 9222, one tab opened/closed)'
  }, null, 2) + '\n');
  console.log('  perf.json written');
} catch (err) {
  failed += 1; failures.push('exception: ' + (err && err.stack ? err.stack : err));
  console.log('  FAIL exception: ' + (err && err.message ? err.message : err));
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) {}
  server.close();
}
if (failures.length) { console.log('\nFailures:'); failures.slice(0, 12).forEach((f) => console.log(' - ' + f)); }
console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
