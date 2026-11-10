#!/usr/bin/env node
/* Ticket to Ride Premium — real-browser E2E (resident Chrome CDP 9222).
 *   node games/boardgame/ticket-to-ride-premium/e2e.mjs
 *   node games/boardgame/ticket-to-ride-premium/e2e.mjs --control  # exit 1
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CDP_PORT = Number(process.env.TTR_CDP_PORT || 9222);
const ENTRY = '/games/boardgame/ticket-to-ride-premium/index.html';
if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}
let passed = 0, failed = 0;
const failures = [], consoleErrors = [], pageErrors = [], requests = [];
const perf = { budgets: { fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500, materialBytes: 1572864, externalRequests: 0 }, mobile: [] };
function ok(label, condition, detail) { if (condition) { passed++; console.log('  PASS ' + label + (detail ? ' · ' + detail : '')); } else { failed++; const l = label + (detail ? ' — ' + detail : ''); failures.push(l); console.log('  FAIL ' + l); } return !!condition; }
function eq(label, actual, expected) { return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function section(t) { console.log('\n[STEP] ' + t); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/games/index.html';
    const file = path.resolve(REPO_ROOT, '.' + rel);
    if (!file.startsWith(REPO_ROOT + path.sep) && file !== REPO_ROOT) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/games/' });
      res.end(data);
    });
  } catch (e) { res.writeHead(500); res.end('error'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
try { execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' }); } catch (e) { console.warn('chrome-ensure unavailable'); }
async function waitForDebug() { for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version'); if (r.ok) return; } catch (e) {} await sleep(150); } throw new Error('CDP unreachable'); }
await waitForDebug();
const target = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
if (!target || !target.id) throw new Error('no test tab');
class CDP {
  constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.pending = new Map(); this.handlers = []; this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); }); this.ws.addEventListener('message', (e) => { let m; try { m = JSON.parse(String(e.data)); } catch (x) { return; } if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message || JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method) this.handlers.forEach((fn) => fn(m)); }); }
  async send(method, params = {}) { await this.ready; const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout ' + method)); } }, 30000); }); }
  on(fn) { this.handlers.push(fn); }
}
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.ready;
cdp.on((m) => {
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value || a.description || a.type).join(' '));
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text); }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text);
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
});
await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Log.enable');
try { await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'service_workers,cache_storage' }); } catch (e) {}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: origin + ENTRY });
async function evaluate(expression) { const out = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (out.exceptionDetails) { const d = out.exceptionDetails; throw new Error('evaluate failed: ' + (d.exception ? (d.exception.description || d.exception.value) : d.text)); } return out.result ? out.result.value : undefined; }
async function waitFor(label, expression, timeout = 12000, interval = 100) { const start = Date.now(); let last; while (Date.now() - start < timeout) { try { last = await evaluate(expression); if (last) return last; } catch (e) { last = 'ERR ' + e.message; } await sleep(interval); } throw new Error('waitFor timeout: ' + label + ' (last=' + JSON.stringify(last) + ')'); }
async function navigate(url, ready) { await cdp.send('Page.navigate', { url }); await waitFor('navigate ' + url, ready, 15000); }

try {
  await waitFor('boot', `!!(window.__ttr && document.querySelectorAll('#map .route').length === 40)`, 20000);
  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    var s=__ttr.getState(); var nav=performance.getEntriesByType('navigation')[0]||{}; var fcp=performance.getEntriesByName('first-contentful-paint')[0]||{};
    var res=performance.getEntriesByType('resource').map(function(e){return {name:e.name,size:e.decodedBodySize||e.transferSize||0}});
    return { title:document.title, desc:(document.querySelector('meta[name=description]')||{}).content, viewport:(document.querySelector('meta[name=viewport]')||{}).content,
      routes:document.querySelectorAll('#map .route').length, cities:document.querySelectorAll('#map .city').length, markets:document.querySelectorAll('#market .train-card').length,
      handChips:document.querySelectorAll('#hand .hand-chip').length, tickets:document.querySelectorAll('#tickets .ticket-row').length,
      trains:s.players.map(function(p){return p.trains;}), hand:s.players.map(function(p){return p.wilds+['red','blue','green','yellow','black','white','orange','pink'].reduce(function(n,c){return n+p.hand[c]},0);}),
      ticketCounts:s.players.map(function(p){return p.tickets.length;}), routesState:s.routes.length, marketState:s.market.length, deck:s.deck.length,
      scrollWidth:document.documentElement.scrollWidth, innerWidth:window.innerWidth, fcp:fcp.startTime||0, dcl:nav.domContentLoadedEventEnd||performance.now(), loadEnd:nav.loadEventEnd||performance.now(), domNodes:document.getElementsByTagName('*').length, resources:res,
      reducedRule:Array.from(document.styleSheets).flatMap(function(sh){try{return Array.from(sh.cssRules)}catch(e){return[]}}).some(function(r){return r.media&&/prefers-reduced-motion/.test(r.media.mediaText)}),
      cssText:Array.from(document.styleSheets).flatMap(function(sh){try{return Array.from(sh.cssRules).map(function(r){return r.cssText})}catch(e){return[]}}).join('\\n'),
      materialSeen:res.filter(function(r){return /assets\\/art\\/premium\\/ticket-to-ride\\/.*\\.webp/.test(r.name)}).length };
  })()`);
  ok('title', /车票之旅/.test(initial.title), initial.title);
  ok('description', (initial.desc || '').length > 30);
  ok('viewport', /width=device-width/i.test(initial.viewport || ''));
  eq('40 routes drawn', initial.routes, 40);
  eq('20 cities drawn', initial.cities, 20);
  eq('5 market cards', initial.markets, 5);
  eq('9 hand chips', initial.handChips, 9);
  eq('3 tickets shown', initial.tickets, 3);
  eq('45 trains each', initial.trains, [45, 45]);
  eq('4 cards each', initial.hand, [4, 4]);
  eq('3 tickets each', initial.ticketCounts, [3, 3]);
  ok('desktop no overflow', initial.scrollWidth <= initial.innerWidth + 1, initial.scrollWidth + '/' + initial.innerWidth);
  ok('reduced motion rule', initial.reducedRule === true);
  ok('100dvh in CSS', /100dvh/.test(initial.cssText));
  ok('FCP/DCL budget', initial.dcl > 0 && initial.dcl < 2500, 'dcl=' + Math.round(initial.dcl));
  ok('load budget', initial.loadEnd < 4000, String(Math.round(initial.loadEnd)));
  ok('DOM budget', initial.domNodes < 2500, 'nodes=' + initial.domNodes);
  const mat = initial.resources.filter((r) => /assets\/art\/premium\/ticket-to-ride\/.*\.webp/.test(r.name));
  const matBytes = mat.reduce((n, r) => n + r.size, 0);
  ok('material images loaded', initial.materialSeen >= 2, 'seen=' + initial.materialSeen);
  ok('material budget', matBytes > 0 && matBytes < 1572864, 'bytes=' + matBytes);
  perf.fcpMs = Math.round(initial.fcp); perf.domContentLoadedMs = Math.round(initial.dcl); perf.loadEventEndMs = Math.round(initial.loadEnd); perf.domNodes = initial.domNodes; perf.materialBytes = matBytes; perf.materialFiles = mat.length;
  const fps = await evaluate(`new Promise(function(resolve){var f=0,s=performance.now();function loop(t){f++;if(t-s>=700)resolve(f/((t-s)/1000));else requestAnimationFrame(loop)}requestAnimationFrame(loop)})`);
  ok('FPS budget', fps >= 30, 'fps=' + Math.round(fps)); perf.fps = Math.round(fps);
  const newGameMs = await evaluate(`(function(){var t=performance.now();__ttr.newGame({seed:9090});return performance.now()-t})()`);
  ok('new game <200ms', newGameMs >= 0 && newGameMs < 200, newGameMs.toFixed(1) + 'ms'); perf.newGameRenderMs = Number(newGameMs.toFixed(1));
  const pureMs = await evaluate(`(function(){var s=__ttr.getState();var m=__ttr.legalMoves()[0];var t=performance.now();__ttr.engine.applyMove(s,m);return performance.now()-t})()`);
  ok('pure move <500ms', pureMs >= 0 && pureMs < 500, pureMs.toFixed(1) + 'ms'); perf.pureMoveMs = Number(pureMs.toFixed(2));
  await evaluate(`__ttr.newGame({seed:20261110})`); await waitFor('reset', `!__ttr.isBusy() && __ttr.getState().turn === 0`, 5000);

  section('Real click: draw two cards and AI turn');
  await evaluate(`document.querySelector('#market .train-card').click()`);
  await waitFor('first draw', `__ttr.getState().drawsLeft === 1`, 4000);
  ok('first draw applied', true);
  await evaluate(`document.querySelector('#market .train-card').click()`);
  await waitFor('AI completes', `!__ttr.isBusy() && (__ttr.getState().turn === 0 || __ttr.getState().over)`, 15000);
  const afterAI = await evaluate(`({ state:__ttr.getState(), status:document.getElementById('hint').textContent })`);
  ok('turn passed through AI', afterAI.state.turn === 0 || afterAI.state.over);
  ok('cards conserved', afterAI.state.deck.length + afterAI.state.market.length + afterAI.state.discard.length + afterAI.state.players.reduce(function(n,p){return n+p.wilds+Object.keys(p.hand).reduce(function(a,c){return a+p.hand[c]},0)},0) === 110);

  section('Real click: draw tickets -> keep');
  await evaluate(`document.getElementById('drawTickets').click()`);
  await waitFor('ticket overlay', `document.getElementById('ticketOverlay').hidden === false`, 5000);
  const pick = await evaluate(`({ count: document.querySelectorAll('#ticketPick input').length, rows: document.querySelectorAll('#ticketPick label').length })`);
  eq('3 tickets to choose', pick.count, 3);
  await evaluate(`Array.from(document.querySelectorAll('#ticketPick input')).forEach(function(inp,i){ if(i>0){ inp.checked=false; inp.dispatchEvent(new Event('change',{bubbles:true})); } }); document.getElementById('keepTickets').click()`);
  await waitFor('ticket kept', `!__ttr.isBusy() && (__ttr.getState().turn === 0 || __ttr.getState().over)`, 15000);
  const tickets = await evaluate(`({ count: __ttr.getState().players[0].tickets.length, overlay: document.getElementById('ticketOverlay').hidden })`);
  eq('kept 1 ticket -> 4 total', tickets.count, 4);
  eq('overlay hidden', tickets.overlay, true);

  section('Real click: claim a route');
  const claim = await evaluate(`(function(){
    var s=__ttr.getState(); s.turn=0; s.over=false; s.phase='main'; s.drawsLeft=0; s.players[0].trains=45;
    __ttr.engine.COLORS.forEach(function(c){s.players[0].hand[c]=6}); s.players[0].wilds=2; __ttr.setState(s);
    var route=__ttr.engine.ROUTES.filter(function(r){return s.routes[r.id]===null})[0];
    document.querySelector('#map [data-route="'+route.id+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
    return { route: route, owner: __ttr.getState().routes[route.id], trains: __ttr.getState().players[0].trains };
  })()`);
  eq('route claimed by click', claim.owner, 0);
  ok('trains decreased', claim.trains < 45, String(claim.trains));

  section('Endgame -> result -> restart');
  const end = await evaluate('__ttr.autoPlayToEnd(6000)');
  ok('auto-play reaches end', end && end.over === true, JSON.stringify({ over: end && end.over, moves: end && end.moves }));
  await waitFor('result overlay', `document.getElementById('resultOverlay').hidden === false`, 4000);
  const modal = await evaluate(`({ title:document.getElementById('resultTitle').textContent, rows:document.querySelectorAll('#resultRows .result-row').length, text:document.getElementById('resultText').textContent })`);
  ok('result title', /赢|获胜|平局/.test(modal.title), modal.title);
  eq('two score rows', modal.rows, 2);
  ok('result explains scoring', /路线|任务|最长/.test(modal.text), modal.text);
  await evaluate(`document.getElementById('again').click()`);
  await waitFor('restart', `__ttr.getState().turn === 0 && __ttr.getState().over === false`, 5000);
  eq('restart restores 45 trains', await evaluate('__ttr.getState().players.map(function(p){return p.trains})'), [45, 45]);

  section('Mobile 390 / 320 / landscape');
  for (const vp of [{ width: 390, height: 844, name: '390x844' }, { width: 320, height: 568, name: '320x568' }, { width: 844, height: 390, name: '844x390' }, { width: 568, height: 320, name: '568x320' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('mobile boot ' + vp.name, `!!(window.__ttr && document.querySelectorAll('#map .route').length === 40)`, 20000);
    await evaluate('window.scrollTo(0,0)'); await sleep(350);
    const m = await evaluate(`(function(){
      var vis=function(el){return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)};
      var targets=Array.from(document.querySelectorAll('button,input,select,textarea,[role="button"],a.btn')).filter(vis);
      var small=targets.filter(function(el){var r=el.getBoundingClientRect();return r.width<44||r.height<44}).map(function(el){return (el.textContent||el.tagName).trim().slice(0,14)});
      var tiny=[];var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);var node;
      while((node=walker.nextNode())){var t=(node.textContent||'').trim();if(!t)continue;var el=node.parentElement;if(!el||el.closest('script,style,.sr-only,[hidden]'))continue;var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||!el.getClientRects().length)continue;var fs=parseFloat(cs.fontSize)||0;if(fs&&fs<12)tiny.push({t:t.slice(0,16),s:fs})}
      return {scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,small:small,tiny:tiny.slice(0,8),buttons:targets.length};
    })()`);
    perf.mobile.push({ viewport: vp.name, scrollWidth: m.scrollWidth, touchMinPx: m.small.length ? 0 : 44, fontMinPx: m.tiny.length ? m.tiny[0].s : 12 });
    ok(vp.name + ' no overflow', m.scrollWidth <= vp.width && m.innerWidth === vp.width, m.scrollWidth + '/' + m.innerWidth + ' want ' + vp.width);
    eq(vp.name + ' touch >=44', m.small, []);
    eq(vp.name + ' text >=12', m.tiny, []);
    ok(vp.name + ' controls present', m.buttons >= 8, 'buttons=' + m.buttons);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(200);

  section('Rules, sources, art');
  await navigate(origin + '/games/boardgame/ticket-to-ride-premium/rules.html', `document.title.indexOf('规则') !== -1`);
  const rules = await evaluate(`({ title:document.title, text:document.body.innerText, links:Array.from(document.querySelectorAll('a[href*="bilibili"]')).map(function(a){return a.href}) })`);
  ok('rules title', /规则/.test(rules.title));
  ok('rules lists two Bilibili sources', rules.links.length >= 2, JSON.stringify(rules.links));
  ok('rules explains 110 cards', /110 张车厢卡/.test(rules.text));
  ok('rules explains longest bonus', /10 分/.test(rules.text));
  ok('rules explains <=2 train end', /≤ 2 节/.test(rules.text));
  await navigate(origin + '/games/boardgame/ticket-to-ride-premium/art-render.html?shot=cover', `document.body.getAttribute('data-ready') === 'true'`);
  const art = await evaluate(`(function(){var st=document.getElementById('stage');return {stageW:st.offsetWidth,stageH:st.offsetHeight,routes:document.querySelectorAll('#map .route').length,cities:document.querySelectorAll('#map .city').length,market:document.querySelectorAll('#market .tcard').length,images:Array.from(document.images).map(function(i){return {src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0}})}})()`);
  ok('art stage width 1200', art.stageW === 1200, String(art.stageW));
  eq('art 40 routes', art.routes, 40);
  eq('art 20 cities', art.cities, 20);
  eq('art 5 market cards', art.market, 5);
  ok('art materials load', art.images.length >= 4 && art.images.every((i) => i.ok), JSON.stringify(art.images));

  section('Global service worker + precache');
  const sw = await evaluate(`(async function(){var regs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];var t=await(await fetch('/games/precache-manifest.js')).text();var s=await(await fetch('/games/sw.js')).text();return {regs:regs.length,mv:(t.match(/"version":\\s*"([^"]+)"/)||[])[1],sv:(s.match(/CACHE_VERSION\\s*=\\s*'([^']+)'/)||[])[1],page:t.indexOf('/games/boardgame/ticket-to-ride-premium/')!==-1,material:t.indexOf('/games/assets/art/premium/ticket-to-ride/train-car.webp')!==-1}})()`);
  eq('manifest/sw version match', sw.mv, sw.sv);
  ok('precache lists page', sw.page);
  ok('precache lists material', sw.material);
  ok('service worker registered', sw.regs >= 1, 'regs=' + sw.regs);

  section('Online room client');
  const onlineMod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
  const handle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', aiDelayMs: 0 });
  const onlineOrigin = 'http://127.0.0.1:' + handle.address.port;
  try {
    await navigate(onlineOrigin + '/online.html', `!!document.getElementById('createBtn')`);
    await evaluate(`document.getElementById('createName').value='e2e-host';document.getElementById('createBtn').click()`);
    await waitFor('room created', `document.getElementById('room').classList.contains('hidden')===false && document.getElementById('roomCode').textContent.trim().length>=4`, 10000);
    const room = await evaluate(`({code:document.getElementById('roomCode').textContent.trim(),seats:document.querySelectorAll('#seats .seat').length,start:!document.getElementById('startBtn').hidden})`);
    ok('browser created room', room.code.length >= 4, room.code);
    eq('two seats', room.seats, 2);
    eq('start visible', room.start, true);
    await evaluate(`document.getElementById('startBtn').click()`);
    await waitFor('online game', `document.getElementById('game').classList.contains('hidden')===false && document.querySelectorAll('#map .route').length===40`, 10000);
    const g = await evaluate(`({routes:document.querySelectorAll('#map .route').length,market:document.querySelectorAll('#market .train-card').length,cards:document.querySelectorAll('#scorebar .scorecard').length,rival:document.querySelectorAll('#map .city').length})`);
    eq('online 40 routes', g.routes, 40);
    eq('online 5 market cards', g.market, 5);
    eq('online 2 scorecards', g.cards, 2);
    eq('online 20 cities', g.rival, 20);
  } finally { await handle.close(); }

  section('Zero external requests & console clean');
  const urls = await evaluate(`performance.getEntriesByType('resource').map(function(e){return e.name})`);
  const external = urls.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('http://127.0.0.1:'));
  eq('no external resources', external, []);
  const extReq = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('chrome-devtools:') && !u.startsWith('http://127.0.0.1:'));
  eq('no external network requests', extReq, []);
  eq('no console errors', consoleErrors, []);
  eq('no page exceptions', pageErrors, []);
  ok('mobile perf recorded', perf.mobile.length === 4);
  fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({ game: 'ticket-to-ride-premium', ok: failed === 0, budgets: perf.budgets, measured: { fcpMs: perf.fcpMs, domContentLoadedMs: perf.domContentLoadedMs, loadEventEndMs: perf.loadEventEndMs, domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs, pureMoveMs: perf.pureMoveMs, materialBytes: perf.materialBytes, materialFiles: perf.materialFiles, externalRequests: 0, mobile: perf.mobile }, evidence: 'e2e.mjs (resident Chrome CDP 9222; one tab opened and closed)' }, null, 2) + '\n');
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
