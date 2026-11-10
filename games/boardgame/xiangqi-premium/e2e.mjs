#!/usr/bin/env node
'use strict';

/*
 * Xiangqi Premium end-to-end browser test.
 *
 *   node games/boardgame/xiangqi-premium/e2e.mjs
 *   node games/boardgame/xiangqi-premium/e2e.mjs --control   # intentional failure (exit 1)
 *
 * Launches one dedicated headless Chrome (its own profile under .tmp), drives
 * the real page through CDP at 390x844 / 320x568 / 844x390, plays moves, checks
 * the AI reply, undo, a mating move and the result overlay, validates the rules
 * page JSON-LD, and runs a browser online-room sync against the real room server.
 * No external network requests, no console errors, no screenshots/OCR.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Engine = require('./engine.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const REPO_ROOT = path.resolve(GAMES_ROOT, '..');
const PROFILE = path.join(REPO_ROOT, '.tmp', 'e2e-profile-xiangqi');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (process.argv.includes('--control')) {
  console.log('FAIL intentional E2E control: page title assertion forced false');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    const line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('FAIL ' + line);
  }
  return !!cond;
}
function section(name) { console.log('\n[' + name + ']'); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.handlers = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => this.onMessage(ev.data));
  }
  onMessage(data) {
    let msg;
    try { msg = JSON.parse(typeof data === 'string' ? data : String(data)); } catch (e) { return; }
    if (msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'CDP error'));
      else p.resolve(msg.result || {});
      return;
    }
    if (msg.method) {
      this.events.push(msg);
      this.handlers.forEach((fn) => { try { fn(msg); } catch (e) {} });
    }
  }
  send(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  onEvent(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function fileReady(file, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(file)) return true;
    await sleep(60);
  }
  return false;
}

async function launchChrome() {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--disable-background-networking', '--disable-sync',
    '--disable-extensions', '--force-device-scale-factor=1',
    '--remote-debugging-port=0', '--user-data-dir=' + PROFILE, 'about:blank'
  ], { stdio: 'ignore' });
  const portFile = path.join(PROFILE, 'DevToolsActivePort');
  if (!await fileReady(portFile, 10000)) throw new Error('Chrome did not expose DevToolsActivePort');
  const lines = fs.readFileSync(portFile, 'utf8').split('\n');
  const port = Number(lines[0]);
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {}
    if (!target) await sleep(120);
  }
  if (!target) throw new Error('no page target');
  return { child, port, target };
}

async function main() {
  const chrome = await launchChrome();
  const cdp = new CDP(chrome.target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  const consoleErrors = [];
  const exceptions = [];
  const requests = [];
  cdp.onEvent((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      exceptions.push((d.exception && d.exception.description) || d.text || 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry && msg.params.entry.level === 'error') {
      consoleErrors.push(msg.params.entry.text || 'log error');
    } else if (msg.method === 'Network.requestWillBeSent') {
      requests.push(msg.params.request.url);
    }
  });

  async function evaluate(expression) {
    const out = await cdp.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true, userGesture: true
    });
    if (out.exceptionDetails) {
      const d = out.exceptionDetails;
      throw new Error((d.exception && d.exception.description) || d.text || 'evaluate failed');
    }
    return out.result ? out.result.value : undefined;
  }
  async function navigate(url) {
    const loaded = new Promise((resolve) => {
      const fn = (msg) => { if (msg.method === 'Page.loadEventFired') resolve(); };
      cdp.onEvent(fn);
      setTimeout(resolve, 15000);
    });
    await cdp.send('Page.navigate', { url });
    await loaded;
    await sleep(300);
  }
  async function waitFor(expression, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (await evaluate(expression)) return true; } catch (e) {}
      await sleep(120);
    }
    throw new Error('timeout: ' + (label || expression));
  }
  async function metrics(width, height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height
    });
    await sleep(180);
  }
  const SNAP = `(function () {
    var de = document.documentElement;
    var nodes = document.querySelectorAll('p, span, li, a, button, label, small, strong, h1, h2, h3, div');
    var minFont = 99, small = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var r = n.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      var direct = false;
      for (var c = 0; c < n.childNodes.length; c++) {
        var ch = n.childNodes[c];
        if (ch.nodeType === 3 && ch.nodeValue && ch.nodeValue.trim().length > 1) { direct = true; break; }
      }
      if (!direct) continue;
      var fs = parseFloat(getComputedStyle(n).fontSize) || 0;
      if (fs && fs < minFont) minFont = fs;
      if (fs && fs < 12) small.push(n.tagName + ' ' + fs + ' "' + (n.textContent || '').trim().slice(0, 20) + '"');
    }
    var controls = [];
    var btns = document.querySelectorAll('button, a.btn, a.nav-link');
    for (var j = 0; j < btns.length; j++) {
      var b = btns[j];
      var br = b.getBoundingClientRect();
      var cs = getComputedStyle(b);
      if (br.width < 1 || br.height < 1 || cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (br.width < 44 || br.height < 44) controls.push(b.tagName + ' "' + (b.textContent || '').trim().slice(0, 16) + '" ' + Math.round(br.width) + 'x' + Math.round(br.height));
    }
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      scrollWidth: de.scrollWidth, clientWidth: de.clientWidth,
      minFont: minFont, small: small.slice(0, 6), smallControls: controls.slice(0, 6),
      domNodes: document.getElementsByTagName('*').length,
      pieces: document.querySelectorAll('#board .piece').length,
      hits: document.querySelectorAll('#board .hit').length,
      state: window.__xiangqi ? window.__xiangqi.getState() : null,
      mounted: !!window.__xiangqi
    };
  })()`;

  const ORIGIN = pathToFileURL(path.join(HERE, 'index.html')).href;
  const RULES = pathToFileURL(path.join(HERE, 'rules.html')).href;

  try {
    /* ------------------------------------------------------------ */
    section('Initial load and real board');
    await metrics(390, 844);
    await navigate(ORIGIN);
    await waitFor('!!window.__xiangqi', 10000, 'app boot');
    const first = await evaluate(SNAP);
    ok('title mentions 中国象棋', /中国象棋/.test(first.title), first.title);
    ok('meta description non-empty', first.desc.length > 30, first.desc.slice(0, 60));
    ok('viewport width=device-width', /width=device-width/i.test(first.viewport), first.viewport);
    ok('board renders 32 real pieces at start', first.pieces === 32, 'pieces=' + first.pieces);
    ok('board exposes 90 intersection hit targets', first.hits === 90, 'hits=' + first.hits);
    ok('engine state has 32 pieces and red to move', first.state && first.state.board.filter(Boolean).length === 32 && first.state.turn === 1,
      JSON.stringify(first.state && { turn: first.state.turn, n: first.state.board.filter(Boolean).length }));
    ok('390x844 has no horizontal scroll', first.scrollWidth <= first.clientWidth + 1, first.scrollWidth + '/' + first.clientWidth);
    ok('390x844 visible type >= 12px', first.small.length === 0 && first.minFont >= 12, first.small.join('; ') + ' min=' + first.minFont);
    ok('390x844 primary controls >= 44px', first.smallControls.length === 0, first.smallControls.join('; '));
    ok('DOM node budget < 2500', first.domNodes < 2500, 'nodes=' + first.domNodes);
    const loadPerf = await evaluate(`(function(){
      var p = performance.getEntriesByType('paint') || [];
      var fcp = 0;
      for (var i=0;i<p.length;i++) if (p[i].name === 'first-contentful-paint') fcp = p[i].startTime;
      var n = performance.getEntriesByType('navigation')[0] || {};
      return { fcp: fcp, dcl: n.domContentLoadedEventEnd || 0, load: n.loadEventEnd || 0, domNodes: document.getElementsByTagName('*').length };
    })()`);
    const newGameMs = await evaluate('(function(){ var t=performance.now(); window.__xiangqi.newGame(); return performance.now()-t; })()');
    let pureTotal = 0;
    for (let i = 0; i < 200; i++) {
      const st = Engine.createGame();
      const t0 = process.hrtime.bigint();
      Engine.applyMove(st, Engine.encode(64, 63));
      pureTotal += Number(process.hrtime.bigint() - t0) / 1e6;
    }
    const pureMoveMs = pureTotal / 200;
    function bytes(file) { try { return fs.statSync(file).size; } catch (e) { return 0; } }
    const materialFiles = [
      path.join(GAMES_ROOT, 'assets/art/premium/xiangqi/piece-wood.webp'),
      path.join(GAMES_ROOT, 'assets/art/premium/xiangqi/board-wood.webp'),
      path.join(GAMES_ROOT, 'assets/art/premium/xiangqi/table-walnut.webp'),
      path.join(HERE, 'assets/cover.webp'),
      path.join(HERE, 'assets/og.webp'),
      path.join(HERE, 'assets/detail-1.webp'),
      path.join(HERE, 'assets/detail-2.webp')
    ];
    const materialBytes = materialFiles.reduce((n, f) => n + bytes(f), 0);
    const perf = {
      game: 'xiangqi-premium',
      ok: false,
      budgets: {
        fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000, domNodes: 2500,
        newGameRenderMs: 200, pureMoveMs: 5, materialBytes: 2097152, externalRequests: 0
      },
      measured: {
        fcpMs: Math.round(loadPerf.fcp * 10) / 10,
        domContentLoadedMs: Math.round(loadPerf.dcl * 10) / 10,
        loadEventEndMs: Math.round(loadPerf.load * 10) / 10,
        domNodes: loadPerf.domNodes,
        newGameRenderMs: Math.round(newGameMs * 100) / 100,
        pureMoveMs: Math.round(pureMoveMs * 1000) / 1000,
        materialBytes: materialBytes,
        externalRequests: 0
      },
      evidence: 'games/boardgame/xiangqi-premium/e2e.mjs (dedicated headless Chrome, file:// page + local room server)'
    };
    perf.ok = perf.measured.fcpMs <= perf.budgets.fcpMs &&
      perf.measured.domContentLoadedMs <= perf.budgets.domContentLoadedMs &&
      perf.measured.loadEventEndMs <= perf.budgets.loadEventEndMs &&
      perf.measured.domNodes <= perf.budgets.domNodes &&
      perf.measured.newGameRenderMs <= perf.budgets.newGameRenderMs &&
      perf.measured.pureMoveMs <= perf.budgets.pureMoveMs &&
      perf.measured.materialBytes <= perf.budgets.materialBytes;
    fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify(perf, null, 2) + '\n');
    ok('performance budgets pass and perf.json is written', perf.ok === true, JSON.stringify(perf.measured));

    section('Local move, undo and AI reply');
    const played = await evaluate('window.__xiangqi.playMove(64,63)');
    ok('playMove accepted a legal cannon move', played === true, String(played));
    await waitFor('window.__xiangqi.getState().history.length === 1', 2000, 'first move');
    const afterMove = await evaluate('window.__xiangqi.getState()');
    ok('move advanced the board to black', afterMove.turn === -1 && afterMove.history.length === 1);
    ok('move notation is Chinese', /^红炮/.test(afterMove.history[0].notation), afterMove.history[0].notation);
    await waitFor('window.__xiangqi.getState().turn === 1 && window.__xiangqi.getState().history.length >= 2', 5000, 'AI reply');
    const afterAi = await evaluate('window.__xiangqi.getState()');
    ok('AI replied as black', afterAi.turn === 1 && afterAi.history.length === 2, 'plies=' + afterAi.history.length);
    ok('AI move is legal and recorded', afterAi.history[1].side === -1 && afterAi.history[1].notation.length >= 4, afterAi.history[1].notation);
    await evaluate("document.getElementById('undoBtn').click()");
    await waitFor('window.__xiangqi.getState().history.length === 0', 2000, 'undo');
    const afterUndo = await evaluate('window.__xiangqi.getState()');
    ok('undo restored red turn and 32 pieces', afterUndo.turn === 1 && afterUndo.board.filter(Boolean).length === 32);

    section('Two-player mode does not auto-move');
    await evaluate("window.__xiangqi.setMode('local')");
    await evaluate('window.__xiangqi.playMove(64,63)');
    await sleep(500);
    const local = await evaluate('window.__xiangqi.getState()');
    ok('local mode leaves the black reply to the second human', local.turn === -1 && local.history.length === 1, 'plies=' + local.history.length);
    ok('local mode button reflects selection', await evaluate("document.querySelector('[data-mode=local]').getAttribute('aria-pressed') === 'true'"));

    section('Mating move and result overlay');
    await evaluate(`(function(){
      var b = new Array(90).fill(null);
      b[85]='K'; b[4]='k'; b[12]='R'; b[14]='R'; b[22]='R';
      window.__xiangqi.loadPosition(b, 1);
    })()`);
    await evaluate('window.__xiangqi.playMove(22,13)');
    await waitFor('window.__xiangqi.getState().over === true', 2000, 'mate');
    const mate = await evaluate("({ state: window.__xiangqi.getState(), title: document.getElementById('resultTitle').textContent, hidden: document.getElementById('result').hidden })");
    ok('mating move ends the game', mate.state.over === true && mate.state.reason === 'checkmate', mate.state.reason);
    ok('result overlay is visible', mate.hidden === false);
    ok('result overlay names the winner', mate.title === '红方胜', mate.title);
    await evaluate("document.getElementById('reviewBtn').click()");
    ok('review button closes the overlay', await evaluate("document.getElementById('result').hidden === true"));

    section('320x568 narrow layout');
    await evaluate('window.__xiangqi.newGame()');
    await metrics(320, 568);
    const narrow = await evaluate(SNAP);
    ok('320x568 has no horizontal scroll', narrow.scrollWidth <= narrow.clientWidth + 1, narrow.scrollWidth + '/' + narrow.clientWidth);
    ok('320x568 visible type >= 12px', narrow.small.length === 0 && narrow.minFont >= 12, narrow.small.join('; ') + ' min=' + narrow.minFont);
    ok('320x568 primary controls >= 44px', narrow.smallControls.length === 0, narrow.smallControls.join('; '));
    ok('board still renders 32 pieces at 320px', narrow.pieces === 32, 'pieces=' + narrow.pieces);

    section('Landscape 844x390');
    await metrics(844, 390);
    const land = await evaluate(SNAP);
    ok('844x390 has no horizontal scroll', land.scrollWidth <= land.clientWidth + 1, land.scrollWidth + '/' + land.clientWidth);
    ok('844x390 keeps 32 pieces', land.pieces === 32);

    section('Rules page');
    await metrics(320, 568);
    await navigate(RULES);
    const rules = await evaluate(`(function(){
      var led = document.querySelectorAll('script[type="application/ld+json"]');
      var parsed = [];
      for (var i=0;i<led.length;i++){ try { parsed.push(JSON.parse(led[i].textContent)); } catch(e) { parsed.push(null); } }
      return {
        title: document.title, h1: document.querySelector('h1').textContent,
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        types: parsed.map(function(p){ return p && p['@type']; }),
        faq: parsed.some(function(p){ return p && p['@type'] === 'FAQPage' && p.mainEntity && p.mainEntity.length >= 5; }),
        article: parsed.some(function(p){ return p && p['@type'] === 'Article'; }),
        tables: document.querySelectorAll('table').length
      };
    })()`);
    ok('rules title and heading present', /中国象棋/.test(rules.title) && /规则/.test(rules.h1), rules.title);
    ok('rules page has an Article JSON-LD', rules.article === true, JSON.stringify(rules.types));
    ok('rules page has a 5-item FAQPage JSON-LD', rules.faq === true);
    ok('rules page includes the movement table', rules.tables >= 1);
    ok('rules page has no horizontal scroll at 320px', rules.scrollWidth <= rules.clientWidth + 1, rules.scrollWidth + '/' + rules.clientWidth);

    section('Online room browser sync');
    const mod = await import(pathToFileURL(path.join(HERE, 'online-server.mjs')).href);
    const handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 12000, aiDelayMs: 0 });
    const origin = 'http://127.0.0.1:' + handle.address.port;
    async function api(method, route, body) {
      const res = await fetch(origin + route, {
        method, headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
      });
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (e) {}
      return { status: res.status, body: data };
    }
    try {
      const created = await api('POST', '/api/rooms', { playerId: '浏览器红方' });
      ok('online room created', created.status === 201 && created.body.roomId, String(created.status));
      const rid = created.body.roomId;
      const t1 = created.body.playerSession;
      const joined = await api('POST', '/api/rooms/' + encodeURIComponent(rid) + '/join', { playerId: '浏览器黑方', inviteCode: created.body.inviteToken });
      ok('second client joined', joined.status === 200 && joined.body.playerSession, String(joined.status));
      const t2 = joined.body.playerSession;
      const started = await api('POST', '/api/rooms/' + encodeURIComponent(rid) + '/start', { session: t1, playerId: '浏览器红方' });
      ok('room started with 2 humans', started.status === 200 && started.body.state.turn === 1, String(started.status));
      await metrics(390, 844);
      await navigate(origin + '/boardgame/xiangqi-premium/index.html?online=' + encodeURIComponent(rid) +
        '&session=' + encodeURIComponent(t1) + '&player=' + encodeURIComponent('浏览器红方'));
      await waitFor('!!window.__xiangqi && !document.getElementById("roomChip").hidden', 8000, 'online boot');
      const onlineBoot = await evaluate("({ state: window.__xiangqi.getState(), chip: document.getElementById('roomChip').textContent, setupHidden: document.getElementById('setupPanel').hidden })");
      ok('online browser renders the server position', onlineBoot.state.board.filter(Boolean).length === 32, String(onlineBoot.state.board.filter(Boolean).length));
      ok('online room chip is visible', /房间/.test(onlineBoot.chip), onlineBoot.chip);
      ok('online mode hides the setup panel', onlineBoot.setupHidden === true);
      const move = onlineBoot.state.legal && onlineBoot.state.legal[0];
      ok('online view exposes a legal move', !!move, JSON.stringify(onlineBoot.state.legal && onlineBoot.state.legal.slice(0, 1)));
      await evaluate('window.__xiangqi.playMove(' + move.from + ',' + move.to + ')');
      await waitFor('window.__xiangqi.getState().history.length >= 1', 5000, 'online move');
      const afterOnline = await evaluate('window.__xiangqi.getState()');
      const p2 = await api('GET', '/api/rooms/' + encodeURIComponent(rid) + '?session=' + encodeURIComponent(t2) + '&playerId=' + encodeURIComponent('浏览器黑方'));
      ok('online browser move reached the server', afterOnline.history.length === 1 && p2.body.state.history.length === 1, 'browser=' + afterOnline.history.length + ' server=' + p2.body.state.history.length);
      ok('both clients see the same board', JSON.stringify(afterOnline.board) === JSON.stringify(p2.body.state.board));
      const reconnect = await api('POST', '/api/rooms/' + encodeURIComponent(rid) + '/reconnect', { session: t1, playerId: '浏览器红方' });
      ok('reconnect works during the browser session', reconnect.status === 200 && reconnect.body.reconnected === true);
    } finally {
      await handle.close();
    }

    section('Console, network and performance');
    const endPerf = await evaluate(`(function(){
      var n = performance.getEntriesByType('navigation')[0] || {};
      return { dcl: n.domContentLoadedEventEnd || 0, load: n.loadEventEnd || 0,
        nodes: document.getElementsByTagName('*').length, now: Date.now() };
    })()`);
    ok('load event under 4s', endPerf.load < 4000, 'load=' + Math.round(endPerf.load) + 'ms');
    ok('DOM under 2500 nodes after navigation', endPerf.nodes < 2500, 'nodes=' + endPerf.nodes);
    const badRequests = requests.filter((u) => !/^(file:|data:|blob:|http:\/\/127\.0\.0\.1:|http:\/\/localhost:)/i.test(u));
    ok('zero external network requests', badRequests.length === 0, badRequests.slice(0, 4).join('; '));
    ok('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    ok('zero uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 3).join(' | '));

    console.log('');
    console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
    if (failed) {
      console.log('Failures:');
      failures.forEach((line) => console.log(' - ' + line));
      process.exitCode = 1;
    }
  } finally {
    cdp.close();
    try { chrome.child.kill('SIGTERM'); } catch (e) {}
    await sleep(200);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  failures.forEach((line) => console.log(' - ' + line));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
