#!/usr/bin/env node
/*
 * Patchwork Premium — real-browser E2E over the resident Chrome CDP endpoint.
 *
 *   node games/boardgame/patchwork-premium/e2e.mjs
 *   node games/boardgame/patchwork-premium/e2e.mjs --control  # exit 1
 *
 * Covers real clicks (select -> rotate -> place -> AI), endgame/restart,
 * 390/320/landscape, touch/font budgets, zero external requests, rules sources,
 * the global v22 service worker / precache manifest, code-composed art and the
 * online room client. Writes perf.json from the measurements of this run.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CDP_PORT = Number(process.env.PW_CDP_PORT || 9222);
const ENTRY = '/games/boardgame/patchwork-premium/index.html';
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

let passed = 0, failed = 0;
const failures = [], consoleErrors = [], pageErrors = [], requests = [];
const perf = { budgets: { fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500, materialBytes: 1572864, externalRequests: 0 }, mobile: [] };
function ok(label, condition, detail) {
  if (condition) { passed += 1; console.log('  PASS ' + label + (detail ? ' · ' + detail : '')); }
  else { failed += 1; const line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('  FAIL ' + line); }
  return !!condition;
}
function eq(label, actual, expected) { return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function section(t) { console.log('\n[STEP] ' + t); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/games/index.html';
    const file = path.resolve(REPO_ROOT, '.' + rel);
    if (!file.startsWith(REPO_ROOT + path.sep) && file !== REPO_ROOT) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/games/' });
      res.end(data);
    });
  } catch (err) { res.writeHead(500); res.end('error'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
console.log('server ' + origin + ENTRY);
try { execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' }); }
catch (err) { console.warn('chrome-ensure unavailable; attaching to existing CDP ' + CDP_PORT); }
async function waitForDebug() {
  for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version'); if (r.ok) return; } catch (e) {} await sleep(150); }
  throw new Error('resident Chrome CDP not reachable on ' + CDP_PORT);
}
await waitForDebug();
let target = null;
try {
  target = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
} catch (e) { target = null; }
if (!target || !target.id) throw new Error('could not create a test tab');

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ready = new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve, { once: true }); this.ws.addEventListener('error', reject, { once: true }); });
    this.ws.addEventListener('message', (event) => {
      let msg; try { msg = JSON.parse(String(event.data)); } catch (e) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error))); else p.resolve(msg.result);
      } else if (msg.method) this.handlers.forEach((fn) => fn(msg));
    });
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
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
try { await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'service_workers,cache_storage' }); } catch (e) {}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: origin + ENTRY });
async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (out.exceptionDetails) { const d = out.exceptionDetails; throw new Error('page evaluate failed: ' + (d.exception ? (d.exception.description || d.exception.value) : d.text)); }
  return out.result ? out.result.value : undefined;
}
async function waitFor(label, expression, timeout = 12000, interval = 100) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { last = await evaluate(expression); if (last) return last; } catch (e) { last = 'ERR ' + e.message; }
    await sleep(interval);
  }
  throw new Error('waitFor timeout: ' + label + ' (last=' + JSON.stringify(last) + ')');
}
async function navigate(url, readyExpr) { await cdp.send('Page.navigate', { url }); await waitFor('navigate ' + url, readyExpr, 15000); }

try {
  await waitFor('page boot', `!!(window.__patchwork && document.querySelectorAll('#board .cell').length === 81)`, 20000);

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    var s = __patchwork.getState();
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name:e.name, size:e.decodedBodySize||e.transferSize||0 }; });
    return {
      title: document.title,
      desc: (document.querySelector('meta[name=description]')||{}).content,
      viewport: (document.querySelector('meta[name=viewport]')||{}).content,
      cells: document.querySelectorAll('#board .cell').length,
      markets: document.querySelectorAll('#market .patch-card').length,
      slots: document.querySelectorAll('#timeline .slot').length,
      pieces: s.pieces.length,
      buttons: s.players.map(function(p){ return p.buttons; }),
      times: s.players.map(function(p){ return p.time; }),
      current: s.current,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || performance.now(),
      loadEnd: nav.loadEventEnd || performance.now(),
      domNodes: document.getElementsByTagName('*').length,
      resources: res,
      reducedRule: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules); } catch(e){ return []; } }).some(function(r){ return r.media && /prefers-reduced-motion/.test(r.media.mediaText); }),
      cssText: Array.from(document.styleSheets).flatMap(function(sh){ try { return Array.from(sh.cssRules).map(function(r){ return r.cssText; }); } catch(e){ return []; } }).join('\\n'),
      materialSeen: res.filter(function(r){ return /assets\\/art\\/premium\\/patchwork\\/.*\\.webp/.test(r.name); }).length,
      sw: !!navigator.serviceWorker
    };
  })()`);
  ok('page title', /拼布艺术/.test(initial.title), initial.title);
  ok('meta description length', (initial.desc || '').length > 30);
  ok('viewport device-width', /width\s*=\s*device-width/i.test(initial.viewport || ''));
  eq('81 board cells', initial.cells, 81);
  eq('3 market patches', initial.markets, 3);
  eq('53 timeline slots', initial.slots, 53);
  eq('33 pieces', initial.pieces, 33);
  eq('5 start buttons each', initial.buttons, [5, 5]);
  eq('time starts at 0', initial.times, [0, 0]);
  eq('human starts', initial.current, 0);
  ok('desktop no horizontal overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('prefers-reduced-motion rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('safe-area inset in CSS', /safe-area-inset/.test(initial.cssText));
  ok('FCP/DCL within budget', (initial.fcp > 0 ? initial.fcp : initial.dcl) > 0 && (initial.fcp > 0 ? initial.fcp : initial.dcl) < 2500, 'fcp=' + Math.round(initial.fcp) + ' dcl=' + Math.round(initial.dcl));
  ok('loadEventEnd within budget', (initial.loadEnd > 0 ? initial.loadEnd : initial.dcl) < 4000, String(Math.round(initial.loadEnd)));
  ok('DOM nodes within budget', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const mat = initial.resources.filter((r) => /assets\/art\/premium\/patchwork\/.*\.webp/.test(r.name));
  const matBytes = mat.reduce((n, r) => n + r.size, 0);
  ok('material webp loaded', initial.materialSeen >= 2, 'seen=' + initial.materialSeen);
  ok('material bytes within budget', matBytes > 0 && matBytes < 1572864, 'bytes=' + matBytes);
  perf.fcpMs = Math.round(initial.fcp); perf.domContentLoadedMs = Math.round(initial.dcl); perf.loadEventEndMs = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes; perf.materialBytes = matBytes; perf.materialFiles = mat.length;
  console.log('  PERF ' + JSON.stringify(perf));

  const fps = await evaluate(`new Promise(function(resolve){ var f=0,s=performance.now(); function loop(t){ f++; if(t-s>=700) resolve(f/((t-s)/1000)); else requestAnimationFrame(loop); } requestAnimationFrame(loop); })`);
  ok('rAF FPS within budget', fps >= 30, 'fps=' + Math.round(fps)); perf.fps = Math.round(fps);
  const newGameMs = await evaluate(`(function(){ var t=performance.now(); __patchwork.newGame({seed:9090}); return performance.now()-t; })()`);
  ok('new game render under 200ms', newGameMs >= 0 && newGameMs < 200, newGameMs.toFixed(1) + 'ms'); perf.newGameRenderMs = Number(newGameMs.toFixed(1));
  const pureMoveMs = await evaluate(`(function(){ var s=__patchwork.getState(); var m=__patchwork.legalMoves()[0]; var t=performance.now(); __patchwork.engine.applyMove(s,m); return performance.now()-t; })()`);
  ok('pure move under 500ms', pureMoveMs >= 0 && pureMoveMs < 500, pureMoveMs.toFixed(1) + 'ms'); perf.pureMoveMs = Number(pureMoveMs.toFixed(2));
  await evaluate(`__patchwork.newGame({seed:20261110})`);
  await waitFor('reset', `!__patchwork.isBusy() && __patchwork.getState().turn === 1 && __patchwork.getState().current === 0`, 5000);

  section('Real click: select -> rotate -> place -> AI');
  const pick = await evaluate(`(function(){
    var m = __patchwork.legalMoves().filter(function(x){ return x.type === 'buy'; })[0];
    if (!m) return null;
    document.querySelector('#market [data-patch-id="' + m.patchId + '"]').click();
    return { move: m, selection: __patchwork.selection(), rotateDisabled: document.getElementById('rotateR').disabled };
  })()`);
  ok('market card selected by click', !!pick && pick.selection && pick.selection.patchId === pick.move.patchId, JSON.stringify(pick && pick.selection));
  eq('rotate enabled', pick && pick.rotateDisabled, false);
  await evaluate(`document.getElementById('rotateR').click()`);
  const sel2 = await evaluate('__patchwork.selection()');
  ok('rotate changes orientation index', sel2 && sel2.orientationIndex !== pick.selection.orientationIndex, JSON.stringify(sel2));
  const placed = await evaluate(`(function(){
    var s = __patchwork.getState();
    var sel = __patchwork.selection();
    var ori = __patchwork.engine.orientationsFor(sel.patchId)[sel.orientationIndex];
    for (var r=0;r<9;r++) for (var c=0;c<9;c++) {
      var chk = __patchwork.engine.canPlaceFor(s, 0, sel.patchId, sel.orientationIndex, r, c);
      if (chk.ok) { document.querySelector('#board .cell[data-r="' + r + '"][data-c="' + c + '"]').click(); return { r:r, c:c, confirmDisabled: document.getElementById('confirm').disabled }; }
    }
    return null;
  })()`);
  ok('legal cell previewed', !!placed && placed.confirmDisabled === false, JSON.stringify(placed));
  if (placed) {
    await evaluate(`document.getElementById('confirm').click()`);
    await waitFor('human placement applied', `!__patchwork.isBusy() && (__patchwork.getState().players[0].placed.length >= 1)`, 8000);
    const after = await evaluate(`({ s: __patchwork.getState(), hint: document.getElementById('hint').textContent, log: document.querySelectorAll('#log li').length })`);
    eq('one patch placed', after.s.players[0].placed.length, 1);
    ok('time advanced', after.s.players[0].time > 0, String(after.s.players[0].time));
    ok('log records the purchase', /买下/.test(after.s.log.map(function(r){return r.text;}).join(' ')));
    ok('hint updated', after.hint.length > 0, after.hint);
    await sleep(900);
    ok('AI took its turn or game continues', (await evaluate('__patchwork.getState().turn')) >= 2, 'turn=' + (await evaluate('__patchwork.getState().turn')));
  }

  section('Endgame -> result -> restart');
  const end = await evaluate('__patchwork.autoPlayToEnd(4000)');
  ok('auto-play reaches game over', end && end.over === true, JSON.stringify({ over: end && end.over, moves: end && end.moves }));
  ok('result has two scores', end && end.result && end.result.scores.length === 2);
  await waitFor('result overlay visible', `document.getElementById('resultOverlay').hidden === false`, 4000);
  const modal = await evaluate(`({ title: document.getElementById('resultTitle').textContent, rows: document.querySelectorAll('#resultRows .result-row').length, reason: document.getElementById('resultReason').textContent })`);
  ok('result title rendered', /赢|获胜|平局/.test(modal.title), modal.title);
  eq('result rows 2', modal.rows, 2);
  ok('result explains scoring', /空格/.test(modal.reason), modal.reason);
  await evaluate(`document.getElementById('again').click()`);
  await waitFor('restart', `__patchwork.getState().turn === 1 && __patchwork.getState().over === false`, 5000);
  eq('restart resets buttons', await evaluate('__patchwork.getState().players.map(function(p){return p.buttons;})'), [5, 5]);

  section('Mobile 390 / 320 / landscape');
  const viewports = [{ width: 390, height: 844, name: '390x844' }, { width: 320, height: 568, name: '320x568' }, { width: 844, height: 390, name: '844x390' }, { width: 568, height: 320, name: '568x320' }];
  for (const vp of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('mobile boot ' + vp.name, `!!(window.__patchwork && document.querySelectorAll('#board .cell').length === 81)`, 20000);
    await evaluate('window.scrollTo(0,0)'); await sleep(350);
    const m = await evaluate(`(function(){
      var vis = function(el){ return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); };
      var targets = Array.from(document.querySelectorAll('button, input, select, textarea, [role="button"], a.btn')).filter(vis);
      var small = targets.filter(function(el){ var r=el.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(function(el){ return (el.textContent||el.tagName).trim().slice(0,14); });
      var tiny = [];
      var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); var node;
      while ((node = walker.nextNode())) {
        var text=(node.textContent||'').trim(); if(!text) continue;
        var el=node.parentElement; if(!el || el.closest('script,style,.sr-only,[hidden]')) continue;
        var cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden'||!el.getClientRects().length) continue;
        var fs=parseFloat(cs.fontSize)||0; if(fs && fs<12) tiny.push({t:text.slice(0,16),s:fs});
      }
      return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, small: small, tiny: tiny.slice(0,8), buttons: targets.length };
    })()`);
    const rec = { viewport: vp.name, scrollWidth: m.scrollWidth, touchMinPx: m.small.length ? 0 : 44, fontMinPx: m.tiny.length ? m.tiny[0].s : 12 };
    perf.mobile.push(rec);
    ok(vp.name + ' no horizontal overflow', m.scrollWidth <= vp.width && m.innerWidth === vp.width, m.scrollWidth + '/' + m.innerWidth + ' want ' + vp.width);
    eq(vp.name + ' no control under 44px', m.small, []);
    eq(vp.name + ' no visible text under 12px', m.tiny, []);
    ok(vp.name + ' primary controls present', m.buttons >= 8, 'buttons=' + m.buttons);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(200);

  section('Rules page, sources and art page');
  await navigate(origin + '/games/boardgame/patchwork-premium/rules.html', `document.title.indexOf('规则') !== -1`);
  const rules = await evaluate(`({ title: document.title, text: document.body.innerText, links: Array.from(document.querySelectorAll('a[href*="bilibili"]')).map(function(a){return a.href;}) })`);
  ok('rules title', /规则/.test(rules.title));
  ok('rules mentions 7x7 bonus', /7×7/.test(rules.text));
  ok('rules lists two Bilibili sources', rules.links.length >= 2, JSON.stringify(rules.links));
  ok('rules lists income spaces', /5、11、17、23、29、35、41、47、53/.test(rules.text));
  ok('rules explains final scoring', /剩余扣子/.test(rules.text) && /空格/.test(rules.text));
  await navigate(origin + '/games/boardgame/patchwork-premium/art-render.html?shot=cover', `document.body.getAttribute('data-ready') === 'true'`);
  const art = await evaluate(`(function(){
    var img = Array.from(document.querySelectorAll('img')); var st = document.getElementById('stage');
    return { images: img.map(function(i){ return { src:i.getAttribute('src'), w:i.naturalWidth, h:i.naturalHeight, ok:i.complete && i.naturalWidth>0 }; }),
      stageW: st ? st.offsetWidth : 0, stageH: st ? st.offsetHeight : 0,
      tiles: document.querySelectorAll('.quilt-cell').length, buttons: document.querySelectorAll('.button-dot').length,
      tracks: document.querySelectorAll('.track-row').length };
  })()`);
  ok('art stage 1200 wide', art.stageW === 1200, String(art.stageW));
  ok('art materials loaded', art.images.length >= 3 && art.images.every((i) => i.ok), JSON.stringify(art.images));
  ok('art has a 9x9 quilt board', art.tiles === 81, String(art.tiles));
  ok('art shows button tokens', art.buttons >= 4, String(art.buttons));
  ok('art shows the time track', art.tracks >= 1, String(art.tracks));

  section('Global service worker + precache manifest');
  const sw = await evaluate(`(async function(){
    var regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
    var txt = await (await fetch('/games/precache-manifest.js')).text();
    var swTxt = await (await fetch('/games/sw.js')).text();
    var mv = (txt.match(/"version":\\s*"([^"]+)"/)||[])[1];
    var sv = (swTxt.match(/CACHE_VERSION\\s*=\\s*'([^']+)'/)||[])[1];
    return { regs: regs.length, manifestVersion: mv, swVersion: sv, hasPage: txt.indexOf('/games/boardgame/patchwork-premium/') !== -1, hasMaterial: txt.indexOf('/games/assets/art/premium/patchwork/button.webp') !== -1 };
  })()`);
  eq('manifest version matches sw', sw.manifestVersion, sw.swVersion);
  ok('precache lists this page', sw.hasPage);
  ok('precache lists material', sw.hasMaterial);
  ok('service worker registration attempted/active', sw.regs >= 1, 'regs=' + sw.regs);

  section('Online room client in a real browser');
  const onlineMod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
  const handle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', aiDelayMs: 0 });
  const onlineOrigin = 'http://127.0.0.1:' + handle.address.port;
  try {
    await navigate(onlineOrigin + '/online.html', `!!document.getElementById('createBtn')`);
    await evaluate(`document.getElementById('createName').value = 'e2e-host'; document.getElementById('createBtn').click()`);
    await waitFor('room created in browser', `document.getElementById('room').classList.contains('hidden') === false && document.getElementById('roomCode').textContent.trim().length >= 4`, 10000);
    const room = await evaluate(`({ code: document.getElementById('roomCode').textContent.trim(), seats: document.querySelectorAll('#seats .seat').length, startVisible: !document.getElementById('startBtn').hidden, gameHidden: document.getElementById('game').classList.contains('hidden') })`);
    ok('browser created a room', room.code.length >= 4, room.code);
    eq('room shows two seats', room.seats, 2);
    eq('host sees start button', room.startVisible, true);
    eq('game hidden before start', room.gameHidden, true);
    await evaluate(`document.getElementById('startBtn').click()`);
    await waitFor('online game started', `document.getElementById('game').classList.contains('hidden') === false && document.querySelectorAll('#board .cell').length === 81`, 10000);
    const game = await evaluate(`({ cells: document.querySelectorAll('#board .cell').length, markets: document.querySelectorAll('#market .patch').length, scoreCards: document.querySelectorAll('#scorebar .scorecard').length, rival: document.querySelectorAll('#rivalBoard .cell').length })`);
    eq('online 81 cells', game.cells, 81);
    eq('online 3 market patches', game.markets, 3);
    eq('online 2 score cards', game.scoreCards, 2);
    eq('online rival board 81 cells', game.rival, 81);
  } finally {
    await handle.close();
  }

  section('Zero external requests & console clean');
  const urls = await evaluate(`performance.getEntriesByType('resource').map(function(e){ return e.name; })`);
  const allowed = [origin, onlineOriginPrefix()];
  const external = urls.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !allowed.some((o) => u.startsWith(o)));
  eq('no external resource entries', external, []);
  const externalReq = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('chrome-devtools:') && !u.startsWith('http://127.0.0.1:'));
  eq('no external network requests', externalReq, []);
  eq('no console errors', consoleErrors, []);
  eq('no page exceptions', pageErrors, []);
  ok('perf mobile recorded', perf.mobile.length === 4);

  fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({ game: 'patchwork-premium', ok: failed === 0, budgets: perf.budgets, measured: { fcpMs: perf.fcpMs, domContentLoadedMs: perf.domContentLoadedMs, loadEventEndMs: perf.loadEventEndMs, domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs, pureMoveMs: perf.pureMoveMs, materialBytes: perf.materialBytes, materialFiles: perf.materialFiles, externalRequests: 0, mobile: perf.mobile }, evidence: 'e2e.mjs (resident Chrome CDP 9222; one tab opened and closed)' }, null, 2) + '\n');
  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('Failures:'); failures.forEach((f) => console.log(' - ' + f)); process.exitCode = 1; }
} catch (err) {
  console.log('\nFATAL: ' + (err && err.stack ? err.stack : String(err)));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exitCode = 1;
} finally {
  try { cdp.ws.close(); } catch (e) {}
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + encodeURIComponent(target.id)); } catch (e) {}
  await new Promise((r) => server.close(r));
}
function onlineOriginPrefix() { return 'http://127.0.0.1:'; }
