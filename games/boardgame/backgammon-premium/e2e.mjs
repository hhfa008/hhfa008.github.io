#!/usr/bin/env node
/*
 * Backgammon / 双陆棋 premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/backgammon-premium/e2e.mjs
 *   node games/boardgame/backgammon-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end.
 *
 * Verifies: a real UI game (24 points, 30 checkers, pip 167, a backgammon
 * finish by clicking a checker and the off tray), new game, undo, keyboard,
 * AI reply, difficulty selector, theme/mute, 390x844 / 320x568 mobile layout,
 * rules JSON-LD + two detail images + three Bilibili sources, art composition
 * with real counts, performance budgets, zero external requests, and a browser
 * online-room sync against the shared room server.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBackgammonServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.BACKGAMMON_CDP_PORT || 9333);
const ENTRY = '/boardgame/backgammon-premium/index.html';
const RULES = '/boardgame/backgammon-premium/rules.html';
const ONLINE = '/boardgame/backgammon-premium/online.html';
const ART = '/boardgame/backgammon-premium/art-render.html?shot=cover';

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
const notFound = [];
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

function webpSize(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
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
        'cache-control': 'no-store'
      });
      res.end(data);
    });
  } catch (err) { res.writeHead(500); res.end('error'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = 'http://127.0.0.1:' + port;
console.log('server ' + origin + ENTRY);

try {
  execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' });
} catch (err) {
  console.warn('chrome-ensure unavailable; attaching to existing CDP port ' + CDP_PORT);
}
async function waitForDebug() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (r.ok) return;
    } catch (err) { /* retry */ }
    await sleep(150);
  }
  if (CDP_PORT !== 9222) {
    const { spawn } = await import('node:child_process');
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-backgammon';
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(chrome, [
      '--headless=new', '--remote-debugging-port=' + CDP_PORT,
      '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-sync', '--disable-extensions',
      '--disable-component-update', '--metrics-recording-only', '--mute-audio',
      'about:blank'
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    for (let i = 0; i < 80; i += 1) {
      try {
        const r = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
        if (r.ok) return;
      } catch (err) { /* retry */ }
      await sleep(150);
    }
  }
  throw new Error('resident Chrome CDP not reachable on ' + CDP_PORT);
}
await waitForDebug();

let target = null;
try {
  const created = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })).json();
  if (created && created.id) target = created;
} catch (err) { target = null; }
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
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    notFound.push(msg.params.response.status + ' ' + msg.params.response.url);
  }
});
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Log.enable');
try {
  await cdp.send('Storage.clearDataForOrigin', { origin: origin, storageTypes: 'service_workers,cache_storage' });
} catch (err) { /* best effort */ }

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression: expression,
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
  try { await cdp.send('Page.bringToFront'); } catch (err) {}
  await waitFor('navigate ' + url, readyExpr, 15000);
}

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: origin + ENTRY + '?fast=1' });
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (err) {}
  try { await cdp.send('Page.bringToFront'); } catch (err) {}
  await waitFor('page boot', '!!(window.__premium && window.__premium.state())', 20000);

  section('Initial render: 24 points, 30 checkers, pip 167');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var s = window.__premium.state();
    var cubeBtn = document.getElementById('doubleBtn');
    var roll = document.getElementById('rollBtn');
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      points: document.querySelectorAll('.point').length,
      checkers: document.querySelectorAll('.checker').length,
      white: document.querySelectorAll('.checker-side-0').length,
      black: document.querySelectorAll('.checker-side-1').length,
      pip: s.pip, pointsState: s.points, bar: s.bar, off: s.off,
      cube: s.cube.value, turn: s.turn, phase: s.phase, checkersState: s.checkers,
      fcp: fcp.startTime || 0, dcl: nav.domContentLoadedEventEnd || 0, loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; }),
      cubeH: Math.round(cubeBtn.getBoundingClientRect().height),
      rollH: Math.round(roll.getBoundingClientRect().height),
      levelH: Math.round(document.getElementById('aiLevel').getBoundingClientRect().height),
      sfx: typeof window.Sfx === 'object' && typeof window.Sfx.play === 'function',
      svg: !!document.querySelector('#board .bg-svg')
    };
  })()`);
  ok('title 含双陆棋 BACKGAMMON', /双陆棋/.test(initial.title) && /BACKGAMMON/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('棋盘渲染 24 个点', initial.points, 24);
  eq('棋盘渲染 30 枚棋子', initial.checkers, 30);
  eq('白方 15 枚', initial.white, 15);
  eq('黑方 15 枚', initial.black, 15);
  eq('开局 pip 167/167', initial.pip, [167, 167]);
  eq('开局 30 枚', initial.checkersState, [15, 15]);
  eq('白方 24 点 2 枚', initial.pointsState[24], 2);
  eq('白方 13 点 5 枚', initial.pointsState[13], 5);
  eq('白方 8 点 3 枚', initial.pointsState[8], 3);
  eq('白方 6 点 5 枚', initial.pointsState[6], 5);
  eq('黑方 1 点 2 枚', initial.pointsState[1], -2);
  eq('黑方 12 点 5 枚', initial.pointsState[12], -5);
  eq('黑方 17 点 3 枚', initial.pointsState[17], -3);
  eq('黑方 19 点 5 枚', initial.pointsState[19], -5);
  eq('倍数方块初始 1', initial.cube, 1);
  eq('白方先手', initial.turn, 0);
  eq('等待掷骰', initial.phase, 'roll');
  ok('共享音效模块已加载', initial.sfx === true);
  ok('SVG 棋盘已渲染', initial.svg === true);
  ok('四种本地材质已请求', ['walnut.webp', 'maple.webp', 'leather.webp', 'ivory-checker.webp'].every(function (name) {
    return initial.resources.some(function (url) { return url.indexOf(name) >= 0; });
  }), initial.resources.slice(0, 6).join(', '));
  ok('加倍按钮触控高度 >=44px', initial.cubeH >= 44, String(initial.cubeH));
  ok('掷骰按钮触控高度 >=44px', initial.rollH >= 44, String(initial.rollH));
  ok('难度选择器触控高度 >=44px', initial.levelH >= 44, String(initial.levelH));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: bear off the last checker and win a backgammon');
  const scenario = await evaluate(`(function(){
    window.__premium.scenario('backgammonFinish');
    var s = window.__premium.state();
    return { off: s.off, pip: s.pip, checkers: s.checkers, point1: s.points[1], point3: s.points[3], phase: s.phase };
  })()`);
  eq('残局白方已离盘 14', scenario.off[0], 14);
  eq('残局白方还剩 1 枚', scenario.pip[0], 1);
  eq('残局仍有 30 枚', scenario.checkers, [15, 15]);
  eq('残局 1 点有白棋', scenario.point1, 1);
  eq('残局 3 点有黑棋', scenario.point3, -1);
  const finish = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.roll(1, 1);
    await sleep(60);
    var src = document.querySelector('.point-hit[data-point="1"]');
    if (src) src.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(40);
    var off = document.querySelector('.tray-hit[data-off="0"]');
    if (off) off.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(150);
    var s = window.__premium.state();
    return {
      over: window.__premium.over(), phase: s.phase, winner: s.winner, off: s.off,
      type: s.score && s.score.type, points: s.score && s.score.points,
      cube: s.cube.value, finale: document.getElementById('finale').classList.contains('show'),
      checkers: s.checkers
    };
  })()`);
  eq('点击棋子与 OFF 区后结束', finish.over, true);
  eq('胜方是白方', finish.winner, 0);
  eq('白方 15 枚全部离盘', finish.off[0], 15);
  eq('负方未离盘', finish.off[1], 0);
  eq('结算为 backgammon', finish.type, 'backgammon');
  eq('backgammon ×3 得 3 分', finish.points, 3);
  eq('倍数方块仍为 1', finish.cube, 1);
  eq('结算浮层显示', finish.finale, true);
  eq('终局仍有 30 枚', finish.checkers, [15, 15]);

  section('New game, tap source → destination, undo');
  const moveUndo = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.start();
    window.__premium.roll(6, 5);
    await sleep(60);
    var a = document.querySelector('.point-hit[data-point="24"]');
    if (a) a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(30);
    var b = document.querySelector('.point-hit[data-point="18"]');
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(60);
    var afterMove = window.__premium.state();
    document.getElementById('undoBtn').click();
    await sleep(60);
    var afterUndo = window.__premium.state();
    return {
      moved24: afterMove.points[24], moved18: afterMove.points[18], diceAfterMove: afterMove.dice,
      undone24: afterUndo.points[24], undone18: afterUndo.points[18], diceAfterUndo: afterUndo.dice,
      pip: afterUndo.pip, off: afterUndo.off, cube: afterUndo.cube.value
    };
  })()`);
  eq('点击 24 → 18 走子', moveUndo.moved24, 1);
  eq('目标 18 点得到一枚白棋', moveUndo.moved18, 1);
  eq('走子后剩一枚骰子', moveUndo.diceAfterMove, [5]);
  eq('撤销后 24 点恢复 2 枚', moveUndo.undone24, 2);
  eq('撤销后 18 点恢复空', moveUndo.undone18, 0);
  eq('撤销后骰子恢复两枚', moveUndo.diceAfterUndo, [6, 5]);
  eq('撤销后 pip 167', moveUndo.pip, [167, 167]);
  eq('撤销后 off 为 0', moveUndo.off, [0, 0]);
  eq('撤销后 cube 为 1', moveUndo.cube, 1);

  section('Keyboard, difficulty, theme and mute');
  const controls = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
    await sleep(80);
    var rolled = window.__premium.state().dice.length;
    var sel = document.getElementById('aiLevel');
    sel.value = 'hard'; sel.dispatchEvent(new Event('change'));
    var level = window.__premium.aiLevel();
    document.getElementById('themeBtn').click();
    var theme = document.documentElement.getAttribute('data-theme');
    var beforeMute = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    var afterMute = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    return { rolled: rolled, level: level, theme: theme, beforeMute: beforeMute, afterMute: afterMute };
  })()`);
  ok('键盘 R 可以掷骰', controls.rolled === 2 || controls.rolled === 4, String(controls.rolled));
  eq('难度选择器切到 hard', controls.level, 'hard');
  ok('主题按钮切换 data-theme', controls.theme === 'light' || controls.theme === 'dark', String(controls.theme));
  ok('静音按钮切换 aria-pressed', controls.beforeMute !== controls.afterMute, controls.beforeMute + '→' + controls.afterMute);

  section('AI reply');
  const aiPlay = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.start();
    window.__premium.roll(6, 5);
    var guard = 0;
    while (!window.__premium.over() && window.__premium.state().turn === 0 && guard++ < 30) {
      var s = window.__premium.state();
      if (s.phase === 'move') {
        if (s.legalMoves.length) {
          var m = s.legalMoves[0];
          window.__premium.move(m.from, m.to, m.die);
        } else {
          window.__premium.endTurn();
        }
      }
      await sleep(20);
    }
    var before = window.__premium.state().turnNumber;
    var aiRolled = false;
    for (var i = 0; i < 80; i++) {
      await sleep(40);
      var now = window.__premium.state();
      if (now.rolled.length || now.turnNumber > before) { aiRolled = true; break; }
      if (window.__premium.over()) { aiRolled = true; break; }
    }
    var after = window.__premium.state();
    return { aiRolled: aiRolled, turn: after.turn, turnNumber: after.turnNumber, rolled: after.rolled, over: window.__premium.over() };
  })()`);
  ok('AI 回合自动掷骰/走子', aiPlay.aiRolled === true, JSON.stringify(aiPlay));
  ok('AI 行动后回到人类或结束', aiPlay.turn === 0 || aiPlay.over === true, JSON.stringify(aiPlay));

  section('Mobile 390x844 / 320x568');
  const mobileResults = [];
  for (const vp of [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await sleep(220);
    const m = await evaluate(`(function(){
      var vw = innerWidth;
      var buttons = [];
      document.querySelectorAll('button, a.icon-btn, select, a').forEach(function(b){
        var r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) buttons.push({ h: Math.round(r.height), w: Math.round(r.width), tag: b.tagName });
      });
      var fonts = [];
      document.querySelectorAll('h1,h2,p,span,button,a,li,b,small,label,select').forEach(function(el){
        if (!el.textContent || !el.textContent.trim()) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        var cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return;
        fonts.push(parseFloat(cs.fontSize));
      });
      var overflow = [];
      document.querySelectorAll('body *').forEach(function(el){
        var r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) overflow.push(el.tagName + '.' + (el.className || ''));
      });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6),
        boardWidth: Math.round(document.getElementById('board').getBoundingClientRect().width)
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 按钮/链接/选择器 >=44px 高', m.buttons.every(function (b) { return b.h >= 44; }), JSON.stringify(m.buttons.slice(0, 10)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 棋盘宽度合理', m.boardWidth > 180, String(m.boardWidth));
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, buttons: m.buttons.length, minFont: Math.min.apply(null, m.fonts) });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page JSON-LD, detail art and Bilibili sources');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    return {
      title: document.title,
      jsonld: Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } }),
      images: Array.prototype.map.call(document.querySelectorAll('article img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: Array.from(new Set((document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []))),
      table: !!document.querySelector('article table'),
      biliLinks: document.querySelectorAll('a[href*="bilibili.com/video/BV"]').length
    };
  })()`);
  ok('规则页标题正确', /双陆棋/.test(rules.title), rules.title);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  eq('规则页两张详情配图', rules.images, ['assets/detail-1.webp', 'assets/detail-2.webp']);
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 2 个 BV 号', rules.sources.length >= 2, JSON.stringify(rules.sources));
  ['BV1BL4y1z7SB', 'BV14D4y197By', 'BV1cU516ME9k'].forEach(function (bv) {
    ok('规则页来源 ' + bv, rules.sources.indexOf(bv) >= 0);
  });
  ok('规则页含尺寸表', rules.table === true);
  ok('规则页 3 条 B 站链接', rules.biliLinks >= 3, String(rules.biliLinks));

  section('Art composition with real component counts');
  await navigate(origin + ART, 'document.querySelectorAll(".scene-cover .point").length === 24 && document.querySelectorAll(".scene-cover .checker").length === 30');
  const art = await evaluate(`(function(){
    var scene = document.querySelector('.scene-cover');
    var imgs = Array.prototype.map.call(scene.querySelectorAll('pattern image'), function(i){ return i.getAttribute('href') || ''; });
    return {
      points: scene.querySelectorAll('.point').length,
      checkers: scene.querySelectorAll('.checker').length,
      white: scene.querySelectorAll('.checker-side-0').length,
      black: scene.querySelectorAll('.checker-side-1').length,
      title: scene.querySelector('.title').textContent,
      cube: scene.querySelector('.cube-badge text') ? scene.querySelector('.cube-badge text').textContent : '',
      materials: imgs
    };
  })()`);
  eq('封面 24 个点', art.points, 24);
  eq('封面 30 枚棋子', art.checkers, 30);
  eq('封面白方 15 枚', art.white, 15);
  eq('封面黑方 15 枚', art.black, 15);
  ok('封面标题含全部离盘', /全部离盘/.test(art.title), art.title);
  ok('封面显示倍数方块', /[1248]/.test(art.cube), art.cube);
  ok('封面引用本地胡桃木', art.materials.some(function (u) { return u.indexOf('walnut.webp') >= 0; }));
  ok('封面引用本地枫木', art.materials.some(function (u) { return u.indexOf('maple.webp') >= 0; }));
  ok('封面引用本地皮革', art.materials.some(function (u) { return u.indexOf('leather.webp') >= 0; }));
  ok('封面引用本地象牙棋子', art.materials.some(function (u) { return u.indexOf('ivory-checker.webp') >= 0; }));

  section('Artifact files and dimensions');
  const dims = {
    'assets/cover.webp': [1200, 1200],
    'assets/og.webp': [1200, 630],
    'assets/detail-1.webp': [1200, 800],
    'assets/detail-2.webp': [1200, 800]
  };
  Object.keys(dims).forEach(function (rel) {
    const abs = path.join(HERE, rel);
    const size = fs.existsSync(abs) && fs.statSync(abs).size > 1000 ? webpSize(abs) : null;
    ok('产物存在 ' + rel, Boolean(size), size ? JSON.stringify(size) : 'missing');
    if (size) eq(rel + ' 尺寸', [size.width, size.height], dims[rel]);
  });
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'HANDOFF.md', 'online-e2e.json', 'test-online.js', 'online.html', 'online-server.mjs', 'art-render.html'].forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  const artDir = path.join(GAMES_ROOT, 'assets', 'art', 'premium', 'backgammon');
  ['walnut.webp', 'maple.webp', 'leather.webp', 'ivory-checker.webp'].forEach(function (name) {
    const abs = path.join(artDir, name);
    ok('本地材质 ' + name, fs.existsSync(abs) && fs.statSync(abs).size > 1000);
  });

  section('Performance budgets');
  await navigate(origin + ENTRY + '?fast=1', '!!(window.__premium && window.__premium.state())');
  const perfNow = await evaluate(`(async function(){
    var frames = 0, start = performance.now();
    await new Promise(function(resolve){
      function loop(t){ frames++; if (t - start < 600) requestAnimationFrame(loop); else resolve(); }
      requestAnimationFrame(loop);
    });
    var fps = frames / ((performance.now() - start) / 1000);
    var t = performance.now();
    window.__premium.start();
    var newGameMs = performance.now() - t;
    return { fps: Math.round(fps), newGameMs: Number(newGameMs.toFixed(1)), domNodes: document.getElementsByTagName('*').length };
  })()`);
  ok('FPS >= 30', perfNow.fps >= 30, String(perfNow.fps));
  ok('新局渲染 < 200ms', perfNow.newGameMs < 200, perfNow.newGameMs + 'ms');
  ok('DOM 节点 < 2500', perfNow.domNodes < 2500, String(perfNow.domNodes));
  ok('FCP < 2500ms', Number(perf.fcp) < 2500, perf.fcp + 'ms');
  ok('loadEventEnd < 4000ms', Number(perf.loadEnd) < 4000, perf.loadEnd + 'ms');
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;

  section('Online room: browser client + two HTTP clients');
  const onlineHandle = await startBackgammonServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
  const onlineBase = 'http://127.0.0.1:' + onlineHandle.address.port;
  async function onlineApi(method, route, body) {
    const res = await fetch(onlineBase + route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (err) { json = null; }
    return { status: res.status, body: json };
  }
  const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-p1', nickname: '浏览器房主' });
  ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  const joined2 = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', { playerId: 'e2e-p2', nickname: '第二位玩家', inviteCode: invite });
  ok('online second client joined', joined2.status === 200 && joined2.body.session, joined2.status);
  const t2 = joined2.body && joined2.body.session;
  const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'e2e-p1' });
  ok('online host started match', started.status === 200 && started.body.state && started.body.playerCount === 2, started.status);

  await navigate(onlineBase + ONLINE + '?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-p1',
    'window.__online && window.__online.view() && document.querySelectorAll("#seats .seat").length === 2 && document.querySelectorAll(".point").length === 24 && document.querySelectorAll(".checker").length === 30');
  const boot = await evaluate(`(function(){
    var v = window.__online.view();
    return {
      seats: document.querySelectorAll('#seats .seat').length,
      points: document.querySelectorAll('.point').length,
      checkers: document.querySelectorAll('.checker').length,
      room: document.getElementById('roomChip').textContent,
      pip: v.state.pip, cube: v.state.cube.value,
      rollButton: Array.prototype.some.call(document.querySelectorAll('#actionRow button'), function(b){ return /掷骰/.test(b.textContent); })
    };
  })()`);
  eq('online 浏览器渲染 2 个座位', boot.seats, 2);
  eq('online 浏览器渲染 24 个点', boot.points, 24);
  eq('online 浏览器渲染 30 枚棋子', boot.checkers, 30);
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  eq('online 开局 pip 167/167', boot.pip, [167, 167]);
  eq('online 倍数方块 1', boot.cube, 1);
  ok('online 显示掷骰按钮', boot.rollButton === true);

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const beforeVersion = p1View.body.stateVersion;
  const clickedRoll = await evaluate(`(function(){
    var b = Array.prototype.filter.call(document.querySelectorAll('#actionRow button'), function(x){ return /掷骰/.test(x.textContent); })[0];
    if (!b) return false;
    b.click();
    return true;
  })()`);
  ok('online 浏览器点击掷骰', clickedRoll === true);
  await waitFor('online dice', 'window.__online.view() && (window.__online.view().state.dice.length > 0 || window.__online.view().over)', 12000);
  const onlinePointH = await evaluate(`Math.round((document.querySelector('.point-hit') || {getBoundingClientRect:function(){return {height:0};}}).getBoundingClientRect().height)`);
  ok('online 掷骰后点触控高度 >=44px', Number(onlinePointH) >= 44, String(onlinePointH));
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-p2');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  eq('online 两客户端看到同一棋盘', p1After.body.state.points, p2View.body.state.points);
  eq('online 两客户端看到同一 bar/off', [p1After.body.state.bar, p1After.body.state.off], [p2View.body.state.bar, p2View.body.state.off]);
  ok('online 观察者合法动作独立', Array.isArray(p1After.body.legalActions) && Array.isArray(p2View.body.legalActions));
  ok('online 不泄漏 seed', p1After.body.state.seed === undefined);

  const moved = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var v = window.__online.view();
    var s = v.state;
    var m = (s.legalMoves || [])[0];
    if (!m) return { moved: false, reason: 'no legal move' };
    var src = m.from === 'bar' ? document.querySelector('.bar-hit[data-bar="0"]') : document.querySelector('.point-hit[data-point="' + m.from + '"]');
    if (src) src.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(50);
    var dst = m.to === 'off' ? document.querySelector('.tray-hit[data-off="0"]') : document.querySelector('.point-hit[data-point="' + m.to + '"]');
    if (dst) dst.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(500);
    return { moved: true, from: m.from, to: m.to, die: m.die };
  })()`);
  ok('online 浏览器点击一步走法', moved.moved === true, JSON.stringify(moved));
  await sleep(300);
  const p1Moved = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const p2Moved = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-p2');
  eq('online 走子后棋盘与对手一致', p1Moved.body.state.points, p2Moved.body.state.points);
  eq('online 走子后 bar/off 与对手一致', [p1Moved.body.state.bar, p1Moved.body.state.off], [p2Moved.body.state.bar, p2Moved.body.state.off]);
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=backgammon-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /双陆棋/.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.create && lobby.join && lobby.lb);
  await navigate(origin + ENTRY + '?fast=1', '!!(window.__premium && window.__premium.state())');
  await onlineHandle.close();

  section('Zero external requests & console clean');
  const external = Array.from(new Set(requests.filter(function (url) {
    return url.indexOf(origin) !== 0 && url.indexOf(onlineBase) !== 0 && url.indexOf('data:') !== 0 && url.indexOf('about:') !== 0;
  })));
  eq('零外部网络请求', external.length, 0, external.slice(0, 5).join(', '));
  ok('零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') + ' :: ' + notFound.slice(0, 6).join(' ; '));
  eq('零页面异常', pageErrors.length, 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  ok('E2E 执行成功', false, err && err.message);
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) { /* tab may be gone */ }
  await new Promise(function (resolve) { server.close(resolve); });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: 'backgammon-premium',
  ok: failed === 0,
  budgets: {
    fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000,
    domNodes: 2500, fps: 30, newGameRenderMs: 200,
    materialBytes: 2097152, externalRequests: 0
  },
  measured: {
    fcpMs: perf.fcp, domContentLoadedMs: perf.dcl, loadEventEndMs: perf.loadEnd,
    domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs,
    materialBytes: perf.materialBytes, externalRequests: 0
  },
  mobile: perf.mobile,
  evidence: 'games/boardgame/backgammon-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
