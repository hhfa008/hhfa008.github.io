#!/usr/bin/env node
/* War Chest Premium — real-browser E2E (resident Chrome CDP 9222).
 *   node games/boardgame/war-chest-premium/e2e.mjs
 *   node games/boardgame/war-chest-premium/e2e.mjs --control  # exit 1
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CDP_PORT = Number(process.env.WC_CDP_PORT || 9222);
const ENTRY = '/games/boardgame/war-chest-premium/index.html';
if (process.argv.includes('--control')) { console.log('  FAIL intentional failure control (expected)'); console.log('RESULT: 0 passed, 1 failed'); process.exit(1); }
let passed = 0, failed = 0;
const failures = [], consoleErrors = [], pageErrors = [], requests = [];
const perf = { budgets: { fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500, materialBytes: 1572864, externalRequests: 0 }, mobile: [] };
function ok(label, c, d) { if (c) { passed++; console.log('  PASS ' + label + (d ? ' · ' + d : '')); } else { failed++; const l = label + (d ? ' — ' + d : ''); failures.push(l); console.log('  FAIL ' + l); } return !!c; }
function eq(label, a, b) { return ok(label, JSON.stringify(a) === JSON.stringify(b), 'got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function section(t) { console.log('\n[STEP] ' + t); }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => { try { const u = new URL(req.url, 'http://x'); let rel = decodeURIComponent(u.pathname); if (rel === '/') rel = '/games/index.html'; const file = path.resolve(REPO_ROOT, '.' + rel); if (!file.startsWith(REPO_ROOT + path.sep) && file !== REPO_ROOT) { res.writeHead(403); res.end('forbidden'); return; } fs.readFile(file, (e, d) => { if (e) { res.writeHead(404); res.end('not found'); return; } res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'service-worker-allowed': '/games/' }); res.end(d); }); } catch (e) { res.writeHead(500); res.end('error'); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
try { execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' }); } catch (e) { console.warn('chrome-ensure unavailable'); }
async function waitDebug() { for (let i = 0; i < 80; i++) { try { const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version'); if (r.ok) return; } catch (e) {} await sleep(150); } throw new Error('CDP unreachable'); }
await waitDebug();
const target = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
if (!target || !target.id) throw new Error('no tab');
class CDP { constructor(url) { this.ws = new WebSocket(url); this.id = 0; this.p = new Map(); this.h = []; this.ready = new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); this.ws.addEventListener('message', (e) => { let m; try { m = JSON.parse(String(e.data)); } catch (x) { return; } if (m.id && this.p.has(m.id)) { const q = this.p.get(m.id); this.p.delete(m.id); m.error ? q.j(new Error(m.error.message || JSON.stringify(m.error))) : q.r(m.result); } else if (m.method) this.h.forEach((fn) => fn(m)); }); } async send(method, params = {}) { await this.ready; const id = ++this.id; return new Promise((r, j) => { this.p.set(id, { r, j }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); j(new Error('timeout ' + method)); } }, 30000); }); } on(fn) { this.h.push(fn); } }
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.ready;
cdp.on((m) => { if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value || a.description || a.type).join(' ')); if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception ? (d.exception.description || d.exception.value) : d.text); } if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push(m.params.entry.text); if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url); });
await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Network.enable'); await cdp.send('Log.enable');
try { await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'service_workers,cache_storage' }); } catch (e) {}
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
await cdp.send('Page.navigate', { url: origin + ENTRY });
async function evaluate(expr) { const o = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); if (o.exceptionDetails) { const d = o.exceptionDetails; throw new Error('evaluate: ' + (d.exception ? (d.exception.description || d.exception.value) : d.text)); } return o.result ? o.result.value : undefined; }
async function waitFor(label, expr, timeout = 12000) { const s = Date.now(); let last; while (Date.now() - s < timeout) { try { last = await evaluate(expr); if (last) return last; } catch (e) { last = 'ERR ' + e.message; } await sleep(100); } throw new Error('waitFor ' + label + ' (last=' + JSON.stringify(last) + ')'); }
async function navigate(url, ready) { await cdp.send('Page.navigate', { url }); await waitFor('nav ' + url, ready, 15000); }

try {
  await waitFor('boot', `!!(window.__war && document.querySelectorAll('#board .cell').length === 49)`, 20000);
  section('Initial render and performance');
  const ini = await evaluate(`(function(){var s=__war.getState();var nav=performance.getEntriesByType('navigation')[0]||{};var fcp=performance.getEntriesByName('first-contentful-paint')[0]||{};var res=performance.getEntriesByType('resource').map(function(e){return{name:e.name,size:e.decodedBodySize||e.transferSize||0}});return{title:document.title,desc:(document.querySelector('meta[name=description]')||{}).content,viewport:(document.querySelector('meta[name=viewport]')||{}).content,cells:document.querySelectorAll('#board .cell').length,strongholds:document.querySelectorAll('#board .cell.stronghold').length,coins:document.querySelectorAll('#hand .coin-btn').length,reserves:document.querySelectorAll('#reserves .res').length,controls:s.players.map(function(p){return __war.engine.controlCount(s,p.index)}),hands:s.players.map(function(p){return p.hand.length}),coinsTotal:s.players.map(function(p){return p.bag.length+p.hand.length+p.discard.length}),scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,fcp:fcp.startTime||0,dcl:nav.domContentLoadedEventEnd||performance.now(),loadEnd:nav.loadEventEnd||performance.now(),domNodes:document.getElementsByTagName('*').length,resources:res,reducedRule:Array.from(document.styleSheets).flatMap(function(sh){try{return Array.from(sh.cssRules)}catch(e){return[]}}).some(function(r){return r.media&&/prefers-reduced-motion/.test(r.media.mediaText)}),cssText:Array.from(document.styleSheets).flatMap(function(sh){try{return Array.from(sh.cssRules).map(function(r){return r.cssText})}catch(e){return[]}}).join('\\n'),materialSeen:res.filter(function(r){return /assets\\/art\\/premium\\/war-chest\\/.*\\.webp/.test(r.name)}).length}})()`);
  ok('title', /战争宝箱/.test(ini.title), ini.title);
  ok('description', (ini.desc || '').length > 30);
  ok('viewport', /width=device-width/i.test(ini.viewport || ''));
  eq('49 cells', ini.cells, 49);
  eq('6 strongholds', ini.strongholds, 6);
  eq('4 coin buttons', ini.coins, 4);
  eq('4 reserve rows', ini.reserves, 4);
  eq('2 controls each', ini.controls, [2, 2]);
  eq('3 cards each', ini.hands, [3, 3]);
  eq('16 coins each', ini.coinsTotal, [16, 16]);
  ok('desktop no overflow', ini.scrollWidth <= ini.innerWidth + 1, ini.scrollWidth + '/' + ini.innerWidth);
  ok('reduced motion rule', ini.reducedRule === true);
  ok('100dvh', /100dvh/.test(ini.cssText));
  ok('FCP/DCL budget', ini.dcl > 0 && ini.dcl < 2500, 'dcl=' + Math.round(ini.dcl));
  ok('load budget', ini.loadEnd < 4000, String(Math.round(ini.loadEnd)));
  ok('DOM budget', ini.domNodes < 2500, 'nodes=' + ini.domNodes);
  const mat = ini.resources.filter((r) => /assets\/art\/premium\/war-chest\/.*\.webp/.test(r.name));
  const matBytes = mat.reduce((n, r) => n + r.size, 0);
  ok('material images', ini.materialSeen >= 2, 'seen=' + ini.materialSeen);
  ok('material budget', matBytes > 0 && matBytes < 1572864, 'bytes=' + matBytes);
  perf.fcpMs = Math.round(ini.fcp); perf.domContentLoadedMs = Math.round(ini.dcl); perf.loadEventEndMs = Math.round(ini.loadEnd); perf.domNodes = ini.domNodes; perf.materialBytes = matBytes; perf.materialFiles = mat.length;
  const fps = await evaluate(`new Promise(function(resolve){var f=0,s=performance.now();function loop(t){f++;if(t-s>=700)resolve(f/((t-s)/1000));else requestAnimationFrame(loop)}requestAnimationFrame(loop)})`);
  ok('FPS budget', fps >= 30, 'fps=' + Math.round(fps)); perf.fps = Math.round(fps);
  const newGameMs = await evaluate(`(function(){var t=performance.now();__war.newGame({seed:9090});return performance.now()-t})()`);
  ok('new game <200ms', newGameMs >= 0 && newGameMs < 200, newGameMs.toFixed(1) + 'ms'); perf.newGameRenderMs = Number(newGameMs.toFixed(1));
  const pureMs = await evaluate(`(function(){var s=__war.getState();var a=__war.legalActions()[0];var t=performance.now();__war.engine.applyAction(s,a);return performance.now()-t})()`);
  ok('pure action <500ms', pureMs >= 0 && pureMs < 500, pureMs.toFixed(2) + 'ms'); perf.pureMoveMs = Number(pureMs.toFixed(2));
  await evaluate(`__war.newGame({seed:20261110})`); await waitFor('reset', `!__war.isBusy() && __war.getState().current === 0`, 5000);

  section('Real click: deploy then move');
  const dep = await evaluate(`(function(){var base=__war.legalActions().filter(function(x){return x.type==='deploy'})[0];if(!base)return null;var s=__war.getState();s.players[0].hand=[base.unitType,base.unitType,base.unitType];__war.setState(s);var a=__war.legalActions().filter(function(x){return x.type==='deploy'&&x.unitType===base.unitType})[0];if(!a)return null;document.querySelector('#hand [data-unit="'+a.unitType+'"]').click();document.querySelector('#board .cell[data-r="'+a.r+'"][data-c="'+a.c+'"]').click();return {a:a,units:__war.getState().units.length,hand:__war.getState().players[0].hand.length}})()`);
  ok('deploy click placed a unit', dep && dep.units === 1, JSON.stringify(dep));
  ok('hand spent one coin', dep && dep.hand === 2, dep && String(dep.hand));
  const mv = await evaluate(`(function(){var s=__war.getState();var u=s.units[0];var a=__war.legalActions().filter(function(x){return x.type==='move'&&x.unitId===u.id})[0];if(!a)return null;document.querySelector('#board .cell[data-r="'+u.r+'"][data-c="'+u.c+'"]').click();document.querySelector('#board .cell[data-r="'+a.to.r+'"][data-c="'+a.to.c+'"]').click();var n=__war.getState();var u2=n.units.filter(function(x){return x.id===u.id})[0];return {from:[u.r,u.c],to:u2?[u2.r,u2.c]:null,hand:n.players[0].hand.length}})()`);
  ok('move click moved the unit', !!mv && (mv.to[0] !== mv.from[0] || mv.to[1] !== mv.from[1]), JSON.stringify(mv));
  ok('move spent a coin', mv && mv.hand === 1, mv && String(mv.hand));

  section('Real click: end turn and AI response');
  await evaluate(`document.getElementById('endTurn').click()`);
  await waitFor('AI turn completes', `!__war.isBusy() && (__war.getState().current === 0 || __war.getState().over)`, 20000);
  const after = await evaluate(`({turn:__war.getState().turn,current:__war.getState().current,units:__war.getState().units.length,enemyUnits:__war.getState().units.filter(function(u){return u.owner===1}).length})`);
  ok('turn advanced', after.turn >= 2, JSON.stringify(after));
  ok('AI deployed or acted', after.units >= 1, 'units=' + after.units);

  section('Endgame -> result -> restart');
  const end = await evaluate('__war.autoPlayToEnd(5000)');
  ok('auto-play reaches end', end && end.over === true, JSON.stringify({ over: end && end.over, actions: end && end.actions }));
  await waitFor('result overlay', `document.getElementById('resultOverlay').hidden === false`, 4000);
  const modal = await evaluate(`({title:document.getElementById('resultTitle').textContent,rows:document.querySelectorAll('#resultRows .result-row').length,text:document.getElementById('resultText').textContent})`);
  ok('result title', /赢|获胜|平局/.test(modal.title), modal.title);
  eq('two result rows', modal.rows, 2);
  ok('result reason', /据点|回合|平局/.test(modal.text), modal.text);
  await evaluate(`document.getElementById('again').click()`);
  await waitFor('restart', `__war.getState().current === 0 && __war.getState().over === false`, 5000);
  eq('restart 16 coins', await evaluate('__war.getState().players.map(function(p){return p.bag.length+p.hand.length+p.discard.length})'), [16, 16]);

  section('Mobile 390 / 320 / landscape');
  for (const vp of [{ width: 390, height: 844, name: '390x844' }, { width: 320, height: 568, name: '320x568' }, { width: 844, height: 390, name: '844x390' }, { width: 568, height: 320, name: '568x320' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('mobile boot ' + vp.name, `!!(window.__war && document.querySelectorAll('#board .cell').length === 49)`, 20000);
    await evaluate('window.scrollTo(0,0)'); await sleep(350);
    const m = await evaluate(`(function(){var vis=function(el){return !!(el.offsetWidth||el.offsetHeight||el.getClientRects().length)};var t=Array.from(document.querySelectorAll('button,input,select,textarea,[role="button"],a.btn')).filter(vis);var small=t.filter(function(el){var r=el.getBoundingClientRect();return r.width<44||r.height<44}).map(function(el){return (el.textContent||el.tagName).trim().slice(0,14)});var tiny=[];var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n;while((n=w.nextNode())){var x=(n.textContent||'').trim();if(!x)continue;var el=n.parentElement;if(!el||el.closest('script,style,.sr-only,[hidden]'))continue;var cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden'||!el.getClientRects().length)continue;var fs=parseFloat(cs.fontSize)||0;if(fs&&fs<12)tiny.push({t:x.slice(0,16),s:fs})}return{scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth,small:small,tiny:tiny.slice(0,8),buttons:t.length}})()`);
    perf.mobile.push({ viewport: vp.name, scrollWidth: m.scrollWidth, touchMinPx: m.small.length ? 0 : 44, fontMinPx: m.tiny.length ? m.tiny[0].s : 12 });
    ok(vp.name + ' no overflow', m.scrollWidth <= vp.width && m.innerWidth === vp.width, m.scrollWidth + '/' + m.innerWidth + ' want ' + vp.width);
    eq(vp.name + ' touch >=44', m.small, []);
    eq(vp.name + ' text >=12', m.tiny, []);
    ok(vp.name + ' controls', m.buttons >= 8, 'buttons=' + m.buttons);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(200);

  section('Rules, sources, art');
  await navigate(origin + '/games/boardgame/war-chest-premium/rules.html', `document.title.indexOf('规则') !== -1`);
  const rules = await evaluate(`({title:document.title,text:document.body.innerText,links:Array.from(document.querySelectorAll('a[href*="bilibili"]')).map(function(a){return a.href})})`);
  ok('rules title', /规则/.test(rules.title));
  ok('rules two Bilibili sources', rules.links.length >= 2, JSON.stringify(rules.links));
  ok('rules 4 strongholds', /先控制 4 个据点/.test(rules.text));
  ok('rules 16 coins', /16 枚/.test(rules.text));
  ok('rules 3 actions', /最多执行 3 个行动/.test(rules.text));
  ok('rules HP', /2 点耐久/.test(rules.text));
  await navigate(origin + '/games/boardgame/war-chest-premium/art-render.html?shot=cover', `document.body.getAttribute('data-ready') === 'true'`);
  const art = await evaluate(`(function(){var st=document.getElementById('stage');return{stageW:st.offsetWidth,cells:document.querySelectorAll('#board .cell').length,strongholds:document.querySelectorAll('#board .cell.stronghold').length,units:document.querySelectorAll('#board .unit').length,coins:document.querySelectorAll('.sidecard .coin').length,images:Array.from(document.images).map(function(i){return{src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0}})}})()`);
  ok('art stage 1200', art.stageW === 1200, String(art.stageW));
  eq('art 49 cells', art.cells, 49);
  eq('art 6 strongholds', art.strongholds, 6);
  ok('art units', art.units >= 8, String(art.units));
  eq('art 4 coins', art.coins, 4);
  ok('art materials', art.images.length >= 4 && art.images.every((i) => i.ok), JSON.stringify(art.images));

  section('Global service worker + precache');
  const sw = await evaluate(`(async function(){var regs=navigator.serviceWorker?await navigator.serviceWorker.getRegistrations():[];var t=await(await fetch('/games/precache-manifest.js')).text();var s=await(await fetch('/games/sw.js')).text();return{regs:regs.length,mv:(t.match(/"version":\\s*"([^"]+)"/)||[])[1],sv:(s.match(/CACHE_VERSION\\s*=\\s*'([^']+)'/)||[])[1],page:t.indexOf('/games/boardgame/war-chest-premium/')!==-1,material:t.indexOf('/games/assets/art/premium/war-chest/silver-coin.webp')!==-1}})()`);
  eq('manifest/sw match', sw.mv, sw.sv);
  ok('precache page', sw.page);
  ok('precache material', sw.material);
  ok('SW registered', sw.regs >= 1, 'regs=' + sw.regs);

  section('Online room client');
  const onlineMod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
  const handle = await onlineMod.startOnlineServer({ port: 0, host: '127.0.0.1', aiDelayMs: 0 });
  const oo = 'http://127.0.0.1:' + handle.address.port;
  try {
    await navigate(oo + '/online.html', `!!document.getElementById('createBtn')`);
    await evaluate(`document.getElementById('createName').value='e2e-host';document.getElementById('createBtn').click()`);
    await waitFor('room', `document.getElementById('room').classList.contains('hidden')===false && document.getElementById('roomCode').textContent.trim().length>=4`, 10000);
    const room = await evaluate(`({code:document.getElementById('roomCode').textContent.trim(),seats:document.querySelectorAll('#seats .seat').length,start:!document.getElementById('startBtn').hidden})`);
    ok('created room', room.code.length >= 4, room.code);
    eq('two seats', room.seats, 2);
    eq('start visible', room.start, true);
    await evaluate(`document.getElementById('startBtn').click()`);
    await waitFor('online game', `document.getElementById('game').classList.contains('hidden')===false && document.querySelectorAll('#board .cell').length===49`, 10000);
    const g = await evaluate(`({cells:document.querySelectorAll('#board .cell').length,strongholds:document.querySelectorAll('#board .cell.stronghold').length,coins:document.querySelectorAll('#hand .coin-btn').length,cards:document.querySelectorAll('#scorebar .scorecard').length})`);
    eq('online 49 cells', g.cells, 49);
    eq('online 6 strongholds', g.strongholds, 6);
    eq('online 4 coins', g.coins, 4);
    eq('online 2 scorecards', g.cards, 2);
  } finally { await handle.close(); }

  section('Zero external requests & console clean');
  const urls = await evaluate(`performance.getEntriesByType('resource').map(function(e){return e.name})`);
  eq('no external resources', urls.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('http://127.0.0.1:')), []);
  eq('no external requests', requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('chrome-devtools:') && !u.startsWith('http://127.0.0.1:')), []);
  eq('no console errors', consoleErrors, []);
  eq('no page exceptions', pageErrors, []);
  ok('mobile perf', perf.mobile.length === 4);
  fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({ game: 'war-chest-premium', ok: failed === 0, budgets: perf.budgets, measured: { fcpMs: perf.fcpMs, domContentLoadedMs: perf.domContentLoadedMs, loadEventEndMs: perf.loadEventEndMs, domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs, pureMoveMs: perf.pureMoveMs, materialBytes: perf.materialBytes, materialFiles: perf.materialFiles, externalRequests: 0, mobile: perf.mobile }, evidence: 'e2e.mjs (resident Chrome CDP 9222; one tab opened and closed)' }, null, 2) + '\n');
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
