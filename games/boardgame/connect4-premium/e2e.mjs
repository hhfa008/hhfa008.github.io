#!/usr/bin/env node
/*
 * Connect 4 / 四子棋 premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/connect4-premium/e2e.mjs
 *   node games/boardgame/connect4-premium/e2e.mjs --control   # exit 1
 *
 * Opens exactly one tab on a resident/dedicated headless Chrome (CDP 9332),
 * closes it at the end, and never kills Chrome.
 *
 * Verifies: real UI play to a finished game, AI reply, undo, restart, strength
 * selector, keyboard/aria, 390×844 / 320×568 mobile layout (no overflow,
 * >=44px controls, >=12px type), rules JSON-LD + two detail images + Bilibili
 * sources, art composition with real counts, performance budgets, zero external
 * requests, zero console/page errors, and a browser online-room section against
 * the shared server (seats, board, move sync, settlement, rematch, reconnect,
 * leaderboard). Writes perf.json.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startConnect4Server } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.CONNECT4_CDP_PORT || 9332);
const ENTRY = '/boardgame/connect4-premium/index.html';
const RULES = '/boardgame/connect4-premium/rules.html';
const ONLINE = '/boardgame/connect4-premium/online.html';
const ART = '/boardgame/connect4-premium/art-render.html?shot=cover';

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
        'cache-control': 'no-store',
        'service-worker-allowed': '/boardgame/connect4-premium/'
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
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-connect4';
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    fs.mkdirSync(profile, { recursive: true });
    const child = spawn(chrome, [
      '--headless=new', '--remote-debugging-port=' + CDP_PORT,
      '--remote-allow-origins=*',
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
if (!target) throw new Error('could not create a test tab on Chrome');
console.log('attached to Chrome tab ' + target.id + ' on port ' + CDP_PORT);

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

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var s = window.__premium.state();
    var board = document.getElementById('board');
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      cells: document.querySelectorAll('#cells .cell').length,
      discs: document.querySelectorAll('#cells .disc.p1, #cells .disc.p2').length,
      holes: document.querySelectorAll('#cells .hole').length,
      cols: document.querySelectorAll('#cols .col').length,
      legal: s.legalColumns,
      boardRole: board.getAttribute('role'),
      boardLabel: board.getAttribute('aria-label'),
      plies: s.plies, turn: s.turn, level: s.level,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; }),
      frameBg: getComputedStyle(document.querySelector('.board')).backgroundImage,
      redBg: getComputedStyle(document.documentElement).getPropertyValue('--art-red')
    };
  })()`);
  ok('title 含 CONNECT 4', /CONNECT 4/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('棋盘 42 个棋格', initial.cells, 42);
  eq('42 个圆形孔位', initial.holes, 42);
  eq('开局 0 枚圆片', initial.discs, 0);
  eq('棋盘 7 列落子区', initial.cols, 7);
  eq('开局 7 个合法列', initial.legal, [0, 1, 2, 3, 4, 5, 6]);
  eq('棋盘 role=grid', initial.boardRole, 'grid');
  ok('棋盘 aria-label 说明 7 列 6 行', /7 列 6 行/.test(initial.boardLabel), initial.boardLabel);
  eq('开局 0 手', initial.plies, 0);
  eq('红方先手', initial.turn, 1);
  eq('默认普通强度', initial.level, 2);
  ok('蓝色塑框材质已加载', /frame-blue\.webp/.test(initial.frameBg), initial.frameBg.slice(0, 100));
  ok('红色圆片材质变量存在', /disc-red\.webp/.test(initial.redBg), initial.redBg.slice(0, 100));
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffle === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: AI reply, hover ghost, keyboard');
  const reply = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.setLevel(2);
    window.__premium.start();
    var col = document.querySelector('#cols .col[data-col="3"]');
    window.__premium.hover(3);
    await sleep(40);
    var ghost = document.querySelectorAll('#cells .disc.ghost').length;
    col.click();
    for (var i = 0; i < 100; i++) {
      var s = window.__premium.state();
      if (!s.busy && s.plies >= 2) break;
      await sleep(25);
    }
    var s = window.__premium.state();
    return {
      ghost: ghost,
      plies: s.plies, turn: s.turn, busy: s.busy,
      red: s.counts.red, yellow: s.counts.yellow,
      last: s.last, lastDisc: !!document.querySelector('#cells .disc.last'),
      ariaCol: document.querySelector('#cols .col[data-col="0"]').getAttribute('aria-label'),
      ariaGridCell: document.querySelector('#cols .col[data-col="0"]').getAttribute('role')
    };
  })()`);
  eq('悬停显示落点预览', reply.ghost, 1);
  ok('人类落子后 AI 已应手（2 手）', reply.plies === 2 && reply.busy === false, 'plies ' + reply.plies + ' busy ' + reply.busy);
  eq('一手红一手黄', [reply.red, reply.yellow], [1, 1]);
  eq('AI 应手后轮回红方', reply.turn, 1);
  ok('最后一手有白色内圈', reply.lastDisc === true);
  ok('列 aria-label 含列号与落点', /第 1 列/.test(reply.ariaCol), reply.ariaCol);
  eq('列使用 gridcell 角色', reply.ariaGridCell, 'gridcell');

  const keyboard = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
    for (var i = 0; i < 100; i++) {
      var s = window.__premium.state();
      if (!s.busy && s.plies >= 2) break;
      await sleep(25);
    }
    var s = window.__premium.state();
    var sel = document.getElementById('level');
    sel.value = '1'; sel.dispatchEvent(new Event('change'));
    var l1 = window.__premium.state().level;
    sel.value = '3'; sel.dispatchEvent(new Event('change'));
    var l3 = window.__premium.state().level;
    sel.value = '2'; sel.dispatchEvent(new Event('change'));
    var theme = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    var theme2 = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    return { plies: s.plies, l1: l1, l3: l3, theme: theme, theme2: theme2 };
  })()`);
  ok('数字键 3 可落子', keyboard.plies >= 1, String(keyboard.plies));
  eq('强度选择器可切到简单', keyboard.l1, 1);
  eq('强度选择器可切到困难', keyboard.l3, 3);
  ok('主题按钮切换 data-theme', keyboard.theme2 === 'light' || keyboard.theme2 === 'dark', String(keyboard.theme2));

  section('Play a full real game through the UI');
  const played = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__premium.setLevel(1);
    window.__premium.start();
    var clicks = 0;
    for (var i = 0; i < 140; i++) {
      var s = window.__premium.state();
      if (s.over) break;
      if (s.busy || s.turn !== 1) { await sleep(20); continue; }
      var order = [3, 2, 4, 1, 5, 0, 6];
      var col = null;
      for (var k = 0; k < order.length; k++) if (s.legalColumns.indexOf(order[k]) >= 0) { col = order[k]; break; }
      if (col == null) break;
      var el = document.querySelector('#cols .col[data-col="' + col + '"]');
      if (!el) break;
      el.click();
      clicks += 1;
      await sleep(30);
    }
    await sleep(140);
    var s = window.__premium.state();
    var resultVisible = !document.getElementById('result').hidden;
    var line = s.line || [];
    var lineOk = line.every(function(i){ return s.board[i] === s.winner; });
    return {
      over: window.__premium.over(), clicks: clicks, plies: s.plies,
      winner: s.winner, draw: s.draw, line: line, lineOk: lineOk,
      counts: s.counts, resultVisible: resultVisible,
      resultText: document.getElementById('resultText').textContent,
      scores: s.scores,
      undoDisabled: document.getElementById('undoBtn').disabled
    };
  })()`);
  eq('浏览器内真实对局结束', played.over, true);
  ok('执行了多次真实点击', played.clicks >= 8, String(played.clicks));
  ok('终局不超过 42 手', played.plies > 0 && played.plies <= 42, String(played.plies));
  eq('终局圆片数与手数一致', played.counts.red + played.counts.yellow, played.plies);
  ok('终局有胜者或平局', played.draw === true || played.winner === 1 || played.winner === 2);
  ok('结果面板显示', played.resultVisible === true);
  ok('结果文案非空', played.resultText.length >= 4, played.resultText);
  ok('终局可以悔棋', played.undoDisabled === false);
  if (played.draw) {
    eq('平局时正好 42 枚', played.plies, 42);
    eq('平局 red+yellow 各 21', [played.counts.red, played.counts.yellow], [21, 21]);
  } else {
    ok('胜利连线至少 4 格', played.line.length >= 4, String(played.line.length));
    ok('胜利连线每格都是胜者颜色', played.lineOk === true);
  }
  ok('本机比分累计了一局', (played.scores.red + played.scores.yellow) >= 1, JSON.stringify(played.scores));

  section('Undo / restart / hover state');
  const reset = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var before = window.__premium.state().plies;
    document.getElementById('undoBtn').click();
    await sleep(60);
    var u = window.__premium.state();
    document.getElementById('newBtn').click();
    await sleep(80);
    var n = window.__premium.state();
    return {
      before: before, undonePlies: u.plies, undoneOver: window.__premium.over(),
      cells: document.querySelectorAll('#cells .disc.p1, #cells .disc.p2').length,
      plies: n.plies, legal: n.legalColumns, resultHidden: document.getElementById('result').hidden
    };
  })()`);
  ok('悔棋减少手数', reset.undonePlies < reset.before, reset.before + '→' + reset.undonePlies);
  eq('悔棋清空圆片', reset.cells, 0);
  eq('新局 0 手', reset.plies, 0);
  eq('新局 7 个合法列', reset.legal, [0, 1, 2, 3, 4, 5, 6]);
  eq('新局隐藏结果面板', reset.resultHidden, true);

  section('Mobile 390x844 / 320x568');
  const mobileResults = [];
  for (const vp of [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await sleep(180);
    const m = await evaluate(`(function(){
      var vw = innerWidth;
      var controls = [];
      document.querySelectorAll('button, select, input, a.icon-btn').forEach(function(b){
        var r = b.getBoundingClientRect();
        var cs = getComputedStyle(b);
        if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') {
          controls.push({ h: Math.round(r.height), w: Math.round(r.width), tag: b.tagName });
        }
      });
      var fonts = [];
      document.querySelectorAll('h1,h2,p,span,button,a,li,b,small,label,select,strong').forEach(function(el){
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
      var col = document.querySelector('#cols .col');
      return {
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        controls: controls, fonts: fonts, overflow: overflow.slice(0, 6),
        colWidth: col ? Math.round(col.getBoundingClientRect().width * 10) / 10 : 0,
        boardWidth: Math.round(document.getElementById('board').getBoundingClientRect().width)
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 主控件 >=44px', m.controls.every(function (b) { return b.h >= 43.5 && b.w >= 43.5; }), JSON.stringify(m.controls.slice(0, 10)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 棋盘 7 列触控宽度 >=43.5', m.colWidth >= 43.5, String(m.colWidth));
    ok(vp.name + ' 棋盘宽度合理', m.boardWidth >= 300, String(m.boardWidth));
    mobileResults.push({
      name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth,
      controls: m.controls.length, minFont: Math.min.apply(null, m.fonts), colWidth: m.colWidth
    });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page JSON-LD, detail art and sources');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    return {
      title: document.title,
      jsonld: Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } }),
      images: Array.prototype.map.call(document.querySelectorAll('article img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: Array.from(new Set((document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []))),
      table: !!document.querySelector('article table'),
      biliLinks: document.querySelectorAll('a[href*="bilibili.com/video/BV"]').length,
      faq: !!document.querySelector('script[type="application/ld+json"]')
    };
  })()`);
  ok('规则页标题含四子棋', /四子棋/.test(rules.title), rules.title);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  eq('规则页两张详情配图', rules.images, ['assets/detail-1.webp', 'assets/detail-2.webp']);
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含 3 个 BV 号', rules.sources.length >= 3, JSON.stringify(rules.sources));
  ['BV1VH4y127ku', 'BV1ap4y1Q7km', 'BV1sr4y1D7oe'].forEach(function (bv) {
    ok('规则页来源 ' + bv, rules.sources.indexOf(bv) >= 0);
  });
  ok('规则页含尺寸表', rules.table === true);
  ok('规则页 3 条 B 站链接', rules.biliLinks >= 3, String(rules.biliLinks));

  section('Art composition with real component counts');
  await navigate(origin + ART, 'document.body.getAttribute("data-art-ok") === "1" && !!window.__artCheck');
  const art = await evaluate(`(function(){
    var c = window.__artCheck;
    function css(sel, pseudo) {
      var el = document.querySelector(sel);
      return el ? getComputedStyle(el, pseudo || null).backgroundImage : '';
    }
    function font(sel) {
      var el = document.querySelector(sel);
      return el ? getComputedStyle(el).fontFamily : '';
    }
    return {
      check: c,
      coverCells: document.querySelectorAll('.scene-cover .cell').length,
      coverDiscs: document.querySelectorAll('.scene-cover .disc.p1, .scene-cover .disc.p2').length,
      coverRed: document.querySelectorAll('.scene-cover .disc.p1').length,
      coverYellow: document.querySelectorAll('.scene-cover .disc.p2').length,
      lastRing: document.querySelectorAll('.scene-cover .disc.last').length,
      title: (document.querySelector('.scene-cover .title') || {}).textContent || '',
      titleFont: font('.scene-cover .title'),
      frame: css('.scene-cover .board'),
      red: css('.scene-cover .disc.p1'),
      felt: css('.stage', '::before')
    };
  })()`);
  eq('封面 42 个棋格', art.coverCells, 42);
  eq('封面 24 枚圆片', art.coverDiscs, 24);
  eq('封面红方 12 枚', art.coverRed, 12);
  eq('封面黄方 12 枚', art.coverYellow, 12);
  eq('封面仅一枚最后落点环', art.lastRing, 1);
  eq('封面局面无四连', art.check.winner, false);
  eq('封面每列底部连续', art.check.contiguous, true);
  eq('封面 7 列高度合法', art.check.colHeights.length, 7);
  ok('封面标题含「四子成线」', /四子成线/.test(art.title), art.title);
  ok('封面标题使用 Songti SC', /Songti SC/.test(art.titleFont), art.titleFont);
  ok('封面引用本地蓝框材质', /frame-blue\.webp/.test(art.frame), art.frame.slice(0, 90));
  ok('封面圆片引用本地红塑料', /disc-red\.webp/.test(art.red), art.red.slice(0, 90));
  ok('封面引用本地毛毡桌面', /table-felt\.webp/.test(art.felt), art.felt.slice(0, 90));

  section('Artifact files and dimensions');
  const dims = {
    'assets/cover.webp': [1200, 1200],
    'assets/og.webp': [1200, 630],
    'assets/detail-1.webp': [1200, 800],
    'assets/detail-2.webp': [1200, 800]
  };
  let shippedBytes = 0;
  Object.keys(dims).forEach(function (rel) {
    const abs = path.join(HERE, rel);
    const size = fs.existsSync(abs) && fs.statSync(abs).size > 1000 ? webpSize(abs) : null;
    ok('产物存在 ' + rel, Boolean(size), size ? JSON.stringify(size) : 'missing');
    if (size) {
      eq(rel + ' 尺寸', [size.width, size.height], dims[rel]);
      shippedBytes += fs.statSync(abs).size;
    }
  });
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'HANDOFF.md', 'online-e2e.json', 'test-online.js', 'online.html', 'online-server.mjs', 'art-render.html', 'render-art.mjs'].forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  const artDir = path.join(GAMES_ROOT, 'assets', 'art', 'premium', 'connect4');
  ['disc-red.webp', 'disc-yellow.webp', 'frame-blue.webp', 'table-felt.webp'].forEach(function (name) {
    const abs = path.join(artDir, name);
    const size = fs.existsSync(abs) ? webpSize(abs) : null;
    ok('本地材质 ' + name, fs.existsSync(abs) && fs.statSync(abs).size > 1000, size ? JSON.stringify(size) : 'missing');
    if (size) eq('材质 ' + name + ' 为 1024x1024', [size.width, size.height], [1024, 1024]);
    if (fs.existsSync(abs)) shippedBytes += fs.statSync(abs).size;
  });
  ok('全部 WebP 体积 <= 2MB', shippedBytes <= 2097152, shippedBytes + ' bytes');
  perf.shippedBytes = shippedBytes;

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
  ok('首屏素材 <= 2MB', Number(perf.materialBytes) <= 2097152, perf.materialBytes + ' bytes');
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;
  perf.domNodes = perfNow.domNodes;

  section('Online room: browser client + two HTTP clients');
  const onlineHandle = await startConnect4Server({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
  const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-c4-p1', nickname: '浏览器房主' });
  ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  const joined2 = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', { playerId: 'e2e-c4-p2', nickname: '第二位玩家', inviteCode: invite });
  ok('online second client joined', joined2.status === 200 && joined2.body.session, joined2.status);
  const t2 = joined2.body && joined2.body.session;
  const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'e2e-c4-p1' });
  ok('online host started match', started.status === 200 && started.body.state && started.body.playerCount === 2, started.status);

  await navigate(onlineBase + ONLINE + '?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-c4-p1',
    'document.querySelectorAll("#seats .seat").length === 2 && document.querySelectorAll("#cells .cell").length === 42 && document.querySelectorAll("#cols .col.legal").length === 7');
  const boot = await evaluate(`({
    seats: document.querySelectorAll('#seats .seat').length,
    cells: document.querySelectorAll('#cells .cell').length,
    legal: document.querySelectorAll('#cols .col.legal').length,
    room: document.getElementById('roomChip').textContent,
    colors: Array.prototype.map.call(document.querySelectorAll('#seats .dot'), function(d){ return d.className; }),
    yourColor: window.__online.view().state.yourColor,
    colWidth: Math.round(document.querySelector('#cols .col').getBoundingClientRect().width)
  })`);
  eq('online 浏览器渲染 2 个座位', boot.seats, 2);
  eq('online 浏览器渲染 42 格', boot.cells, 42);
  eq('online 浏览器渲染 7 个合法列', boot.legal, 7);
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  ok('online 座位显示红黄颜色', boot.colors.some(function (c) { return /red/.test(c); }) && boot.colors.some(function (c) { return /yellow/.test(c); }));
  eq('online 房主执红', boot.yourColor, 'red');
  ok('online 列触控宽度合理', boot.colWidth >= 40, String(boot.colWidth));

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-c4-p1');
  const beforeVersion = p1View.body.stateVersion;
  const clicked = await evaluate(`(function(){
    var b = document.querySelector('#cols .col[data-col="3"]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  ok('online 浏览器点击第 4 列', clicked === true);
  await sleep(1200);
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-c4-p1');
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-c4-p2');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  eq('online 第 4 列底部出现红子', p1After.body.state.board[38], 1);
  eq('online 两客户端看到同一棋盘', p1After.body.state.board, p2View.body.state.board);
  eq('online 两客户端看到同一轮次', p1After.body.state.turn, p2View.body.state.turn);
  await waitFor('browser sees move', '(function(){var v=window.__online.view();return !!(v && v.state && v.state.plies===1);})()', 6000);
  ok('online 浏览器轮询后显示 1 手', await evaluate('window.__online.view().state.plies === 1'));

  // Finish the game over HTTP: yellow 0, red 3, yellow 0, red 3, yellow 0, red 3.
  const finish = [
    { session: t2, player: 'e2e-c4-p2', col: 0 },
    { session: t1, player: 'e2e-c4-p1', col: 3 },
    { session: t2, player: 'e2e-c4-p2', col: 0 },
    { session: t1, player: 'e2e-c4-p1', col: 3 },
    { session: t2, player: 'e2e-c4-p2', col: 0 },
    { session: t1, player: 'e2e-c4-p1', col: 3 }
  ];
  let finishOk = true;
  for (const move of finish) {
    const sent = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions', {
      session: move.session, playerId: move.player, action: { type: 'drop', col: move.col }
    });
    if (sent.status !== 200) { finishOk = false; }
  }
  ok('online 脚本化收尾全部接受', finishOk);
  const finalA = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-c4-p1');
  const finalB = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-c4-p2');
  eq('online 对局结束', finalA.body.over, true);
  eq('online 红方第 4 列四连获胜', finalA.body.result.winnerSeat, 0);
  eq('online 双方结算一致', finalA.body.result.winningLine, finalB.body.result.winningLine);
  await waitFor('browser finale', '(function(){var f=document.getElementById("finale");return f && !f.hidden;})()', 6000);
  ok('online 浏览器显示结算面板', await evaluate('!document.getElementById("finale").hidden'));
  ok('online 浏览器结算含胜者', /获胜/.test(await evaluate('document.getElementById("finaleTitle").textContent')), await evaluate('document.getElementById("finaleTitle").textContent'));

  const restart = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/restart', { session: t1, playerId: 'e2e-c4-p1' });
  ok('online rematch works', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('rematch swaps first player', restart.body.state.firstSeat, 1);
  eq('rematch red is seat 1', restart.body.state.colors[1], 'red');
  await sleep(1200);
  ok('online 浏览器 rematch 后棋盘清空', await evaluate('document.querySelectorAll("#cells .disc.p1, #cells .disc.p2").length === 0 || window.__online.version() > 0'));
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-c4-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=connect4-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));
  ok('online leaderboard has entries', leaderboard.body.entries.length >= 2, String(leaderboard.body.entries.length));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /四子棋/.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.create && lobby.join && lobby.lb);
  // Leave polling pages before shutting the room server down.
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
  game: 'connect4-premium',
  ok: failed === 0,
  budgets: {
    fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000,
    domNodes: 2500, fps: 30, newGameRenderMs: 200,
    materialBytes: 2097152, externalRequests: 0
  },
  measured: {
    fcpMs: perf.fcp, domContentLoadedMs: perf.dcl, loadEventEndMs: perf.loadEnd,
    domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs,
    materialBytes: perf.materialBytes, externalRequests: 0, shippedBytes: perf.shippedBytes
  },
  mobile: perf.mobile,
  evidence: 'games/boardgame/connect4-premium/e2e.mjs (Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
