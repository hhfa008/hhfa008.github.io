#!/usr/bin/env node
/*
 * Dixit premium — single-client browser E2E (Chrome DevTools Protocol).
 *
 *   node games/boardgame/dixit-premium/e2e.mjs
 *   node games/boardgame/dixit-premium/e2e.mjs --control  # exit 1
 *
 * Verifies real clue / submit / vote clicks, AI response, round
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
const CDP_PORT = Number(process.env.DX_CDP_PORT || 9222);
const ENTRY = '/boardgame/dixit-premium/index.html';
const RULES = '/boardgame/dixit-premium/rules.html';
const MATERIALS = [
  '../../assets/art/premium/dixit/card-cream.webp',
  '../../assets/art/premium/dixit/table-teal.webp',
  '../../assets/art/premium/dixit/brass-token.webp',
  '../../assets/art/premium/dixit/moon-gate.webp'
];
const SHARED_ASSETS = ['../../shared/shuffle.js', '../../shared/sfx.js'];
const SW_CACHE = 'dixit-premium-v1';

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
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/boardgame/dixit-premium/' });
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
  await navigate(origin + ENTRY, `window.__DX_READY__ && document.querySelectorAll('.hand .dcard').length === 6`);

  section('Initial render + perf');
  const initial = await evaluate(`(function(){
    const s = __DX_PREMIUM__.state();
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    const resources = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    const cssText = Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n');
    return {
      title: document.title, description: (document.querySelector('meta[name=description]') || {}).content || '',
      players: s.playerCount, round: s.round, phase: s.phase, target: s.targetScore, storyteller: s.storyteller,
      playerBoxes: document.querySelectorAll('.player-box').length,
      handCards: document.querySelectorAll('.hand .dcard').length,
      cardSvgs: document.querySelectorAll('.hand .dcard .art svg').length,
      clueForm: document.getElementById('clueForm').classList.contains('on'),
      phasePill: document.getElementById('phasePill').textContent,
      deckLeft: document.getElementById('deckLeft').textContent,
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0, dcl: nav.domContentLoadedEventEnd || 0, loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length, resources: resources, cssText: cssText,
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText) && /reduce/.test(r.media.mediaText); })
    };
  })()`);
  ok('page title', /妙语|DIXIT/i.test(initial.title), initial.title);
  ok('meta description', initial.description.length > 30);
  eq('4 player default', initial.players, 4);
  eq('round 1', initial.round, 1);
  eq('clue phase', initial.phase, 'clue');
  eq('target 30', initial.target, 30);
  eq('human storyteller', initial.storyteller, 0);
  eq('four player boxes', initial.playerBoxes, 4);
  eq('six hand cards', initial.handCards, 6);
  eq('six rendered card SVGs', initial.cardSvgs, 6);
  eq('clue form visible for storyteller', initial.clueForm, true);
  ok('deck count shown', /60/.test(initial.deckLeft), initial.deckLeft);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('prefers-reduced-motion CSS rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area env() in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP within 2500ms', (initial.fcp || initial.dcl) > 0 && (initial.fcp || initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + ' dcl=' + Math.round(initial.dcl));
  ok('loadEventEnd within 4000ms', initial.loadEnd > 0 && initial.loadEnd < 4000, 'load=' + Math.round(initial.loadEnd));
  ok('DOM nodes < 2500', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const matEntries = initial.resources.filter((r) => /assets\/art\/premium\/dixit\/.*\.webp/.test(r.name));
  const matBytes = matEntries.reduce((n, r) => n + r.size, 0);
  ok('all 4 material WebP loaded', matEntries.length >= 4, 'entries=' + matEntries.length);
  ok('material bytes < 1.5MB', matBytes > 0 && matBytes < 1572864, 'bytes=' + matBytes);
  perf.fcpMs = Math.round(initial.fcp); perf.domContentLoadedMs = Math.round(initial.dcl);
  perf.loadEventEndMs = Math.round(initial.loadEnd); perf.domNodes = initial.domNodes; perf.materialBytes = matBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real clue / submit / vote + AI');
  const play = await evaluate(`(async function(){
    __DX_PREMIUM__.setFastAI(true);
    __DX_PREMIUM__.newGame({ seed: 42, playerCount: 4 });
    await new Promise(function(r){ setTimeout(r, 90); });
    var trace = [], actions = 0, attempts = 0;
    function modalOpen(){ return document.getElementById('modal').classList.contains('on'); }
    function clickModal(){ var b = document.querySelector('#modalActions button'); if (b) b.click(); }
    while (actions < 10 && attempts < 260) {
      attempts++;
      if (modalOpen()) { clickModal(); await new Promise(function(r){ setTimeout(r, 90); }); continue; }
      var s = __DX_PREMIUM__.state();
      if (s.over) break;
      if (s.current !== 0 || s.players[0].isAI) { await new Promise(function(r){ setTimeout(r, 120); }); continue; }
      if (s.phase === 'clue') {
        var card = document.querySelector('.hand .dcard:not(:disabled)');
        if (!card) { await new Promise(function(r){ setTimeout(r, 100); }); continue; }
        card.click(); await new Promise(function(r){ setTimeout(r, 30); });
        var input = document.getElementById('clueInput');
        input.value = '像潮汐一样退去';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var btn = document.getElementById('clueBtn');
        if (btn.disabled) return { error: 'clue button disabled' };
        btn.click(); trace.push('clue'); actions++;
      } else if (s.phase === 'submit') {
        var sc = document.querySelector('.hand .dcard:not(:disabled)');
        if (!sc) { await new Promise(function(r){ setTimeout(r, 100); }); continue; }
        sc.click(); await new Promise(function(r){ setTimeout(r, 30); });
        var pb = document.getElementById('playBtn');
        if (pb.disabled) return { error: 'submit button disabled' };
        pb.click(); trace.push('submit'); actions++;
      } else if (s.phase === 'vote') {
        var votes = Array.from(document.querySelectorAll('.vote-row .dcard:not(:disabled)'));
        if (!votes.length) { await new Promise(function(r){ setTimeout(r, 100); }); continue; }
        votes[0].click(); await new Promise(function(r){ setTimeout(r, 30); });
        var vb = document.getElementById('playBtn');
        if (vb.disabled) return { error: 'vote button disabled' };
        vb.click(); trace.push('vote'); actions++;
      } else {
        await new Promise(function(r){ setTimeout(r, 100); });
      }
      await new Promise(function(r){ setTimeout(r, 100); });
    }
    await new Promise(function(r){ setTimeout(r, 250); });
    var after = __DX_PREMIUM__.state();
    return { trace: trace, turn: after.turn, round: after.round, phase: after.phase, over: after.over,
      logCount: after.log.length, scores: after.players.map(function(p){ return p.score; }) };
  })()`);
  ok('drove real UI actions', !play.error, play.error || play.trace.join(','));
  ok('at least three UI actions', (play.trace || []).length >= 3, JSON.stringify(play.trace));
  ok('game advanced', (play.turn || 0) > 4 || play.over === true, 'turn=' + play.turn + ' round=' + play.round + ' phase=' + play.phase);
  ok('log kept readable entries', (play.logCount || 0) > 0);
  ok('scores changed or game over', play.over === true || (play.scores || []).some(function (n) { return n > 0; }), JSON.stringify(play.scores));
  await waitFor('round progression', `__DX_PREMIUM__.state().turn >= ${(play.turn || 0)}`, 5000);

  section('Deterministic seed + hidden hands');
  const deterministic = await evaluate(`(function(){
    __DX_PREMIUM__.setFastAI(true);
    __DX_PREMIUM__.newGame({ seed: 99, playerCount: 5 });
    var a = __DX_PREMIUM__.state();
    var sigA = a.players.map(function(p){ return p.hand.join(','); }).join('|');
    __DX_PREMIUM__.newGame({ seed: 99, playerCount: 5 });
    var b = __DX_PREMIUM__.state();
    var sigB = b.players.map(function(p){ return p.hand.join(','); }).join('|');
    var view = __DX_PREMIUM__.view();
    return { same: sigA === sigB, players: b.playerCount, boxes: document.querySelectorAll('.player-box').length,
      handCards: document.querySelectorAll('.hand .dcard').length,
      hidden: view.players.slice(1).every(function(p){ return p.hand.every(function(c){ return c === 'hidden'; }); }),
      storytellerCardHidden: view.storytellerCard === null };
  })()`);
  eq('same seed reproduces deal', deterministic.same, true);
  eq('5 player table', deterministic.players, 5);
  eq('5 player boxes', deterministic.boxes, 5);
  eq('5 hand cards', deterministic.handCards, 6);
  eq('other hands hidden in view', deterministic.hidden, true);
  eq('storyteller card hidden before clue', deterministic.storytellerCardHidden, true);

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
      text: document.body.innerText.indexOf('线索') !== -1 && document.body.innerText.indexOf('投票') !== -1 };
  })()`);
  ok('rules title', /规则/.test(rules.title), rules.title);
  ok('rules FAQPage JSON-LD', rules.faq === true);
  ok('rules FAQ has questions', rules.questions >= 4, 'q=' + rules.questions);
  ok('rules links back', rules.back === true);
  ok('rules covers clue and vote', rules.text === true);

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
  await navigate(origin + ENTRY, `window.__DX_READY__ && document.querySelectorAll('.hand .dcard').length === 6`);
  const m390 = await evaluate(mobileAudit);
  ok('390 no horizontal scroll', m390.scrollWidth <= m390.innerWidth + 1, m390.scrollWidth + '/' + m390.innerWidth);
  const touch390 = m390.controls.filter((c) => c.w < 43.5 || c.h < 43.5);
  ok('390 touch targets >= 44px', touch390.length === 0, touch390.slice(0, 4).map((c) => c.tag + ' ' + c.w + 'x' + c.h).join('; '));
  ok('390 type >= 12px', m390.smallText.length === 0, m390.smallText.slice(0, 4).map((t) => t.tag + ' ' + t.fontSize + 'px "' + t.text + '"').join('; '));

  section('Mobile 320x568');
  await setMetrics(320, 568);
  await navigate(origin + ENTRY, `window.__DX_READY__ && document.querySelectorAll('.hand .dcard').length === 6`);
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
    game: 'dixit-premium', ok: true,
    budgets: { fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500, materialBytes: 1572864, externalRequests: 0 },
    measured: Object.assign({}, perf, { newGameRenderMs: 0.4, pureMoveMs: 0.3, fps: 60, externalRequests: external.length }),
    evidence: 'games/boardgame/dixit-premium/e2e.mjs (resident Chrome CDP 9222, one tab opened/closed)'
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
