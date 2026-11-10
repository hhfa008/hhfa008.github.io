#!/usr/bin/env node
/*
 * Chess premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/chess-premium/e2e.mjs
 *   node games/boardgame/chess-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP on 9331 (CHESS_PORT overrides),
 * opens exactly one tab and closes it at the end.
 *
 * Verifies: 64 squares / 32 pieces / coordinates, real click sequence to
 * Fool's Mate, undo, New Game, AI reply and strength selector, promotion chooser,
 * keyboard + aria, 390×844 / 320×568 layout, rules JSON-LD + two Bilibili
 * sources + two detail images, code-composed art (64 squares, 32/32/30/6
 * pieces), performance budgets, zero external requests, and a browser online
 * room synced against the shared room server.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startChessServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.CHESS_PORT || 9331);
const ENTRY = '/boardgame/chess-premium/index.html';
const RULES = '/boardgame/chess-premium/rules.html';
const ONLINE = '/boardgame/chess-premium/online.html';
const ART = '/boardgame/chess-premium/art-render.html?shot=';

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
    if (rel === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'public, max-age=86400' }); res.end(); return; }
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'service-worker-allowed': '/boardgame/chess-premium/'
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
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-chess';
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
async function clickSq(sq) {
  const hit = await evaluate('(function(){var el=document.querySelector(\'.sq[data-sq="' + sq + '"]\');if(!el)return false;el.click();return true;})()');
  if (!hit) throw new Error('square missing: ' + sq);
  await sleep(45);
}

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: origin + ENTRY });
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (err) {}
  try { await cdp.send('Page.bringToFront'); } catch (err) {}
  await waitFor('page boot', '!!(window.__premium && window.__premium.state())', 20000);

  section('Initial render: 64 squares, 32 pieces, coordinates');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var s = window.__premium.state();
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      squares: document.querySelectorAll('.sq').length,
      pieces: document.querySelectorAll('.piece').length,
      whitePieces: document.querySelectorAll('.piece.w').length,
      blackPieces: document.querySelectorAll('.piece.b').length,
      fileLabels: Array.prototype.map.call(document.querySelectorAll('.co.f'), function(n){ return n.textContent; }).sort().join(''),
      rankLabels: Array.prototype.map.call(document.querySelectorAll('.co.r'), function(n){ return n.textContent; }).sort().join(''),
      coords: document.querySelectorAll('.co').length,
      boardLabel: (document.getElementById('board') || {}).getAttribute ? document.getElementById('board').getAttribute('aria-label') : '',
      inputBoard: document.getElementById('board').tabIndex,
      s: s,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0)
    };
  })()`);
  ok('title 含国际象棋', /国际象棋/.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 assets/og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('64 个棋盘格', initial.squares, 64);
  eq('开局 32 枚棋子', initial.pieces, 32);
  eq('白方 16 枚', initial.whitePieces, 16);
  eq('黑方 16 枚', initial.blackPieces, 16);
  eq('文件坐标 a–h', initial.fileLabels, 'abcdefgh');
  eq('横线坐标 1–8', initial.rankLabels, '12345678');
  eq('坐标标签 16 个', initial.coords, 16);
  ok('棋盘 aria-label 含 8 行 8 列', /8 行 8 列/.test(initial.boardLabel), initial.boardLabel);
  eq('棋盘 tabIndex=0', initial.inputBoard, 0);
  eq('初始 FEN', initial.s.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  eq('白方先行', initial.s.turn, 'w');
  eq('初始 0 着', initial.s.moveCount, 0);
  eq('初始 32 枚 state', initial.s.pieceCount, 32);
  eq('默认模式人机', initial.s.mode, 'ai');
  eq('默认强度进阶', initial.s.level, 2);
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;

  section('Real click sequence: Fool\'s Mate');
  await evaluate('document.querySelector(\'[data-mode="local"]\').click()');
  await waitFor('local mode', 'window.__premium.state().mode === "local"');
  for (const sq of [53, 45, 12, 28, 54, 38, 3, 39]) await clickSq(sq);
  const mate = await evaluate(`(function(){
    var s = window.__premium.state();
    return {
      over: s.over, status: s.status, turn: s.turn, moveCount: s.moveCount,
      san: s.sanList, lastHighlights: document.querySelectorAll('.sq.last').length,
      checkHighlights: document.querySelectorAll('.sq.check').length,
      statusText: document.getElementById('status').textContent,
      coords: document.querySelectorAll('.co').length
    };
  })()`);
  eq('愚人杀后对局结束', mate.over, true);
  eq('结果为 checkmate', mate.status, 'checkmate');
  eq('4 个半回合计谱', mate.moveCount, 4);
  eq('SAN 棋谱 f3 e5 g4 Qh4#', mate.san, ['f3', 'e5', 'g4', 'Qh4#']);
  ok('状态栏显示将死与黑方胜', /将死/.test(mate.statusText) && /黑方胜/.test(mate.statusText), mate.statusText);
  ok('最后一步高亮两格', mate.lastHighlights === 2, String(mate.lastHighlights));
  eq('被将军王高亮一格', mate.checkHighlights, 1);
  eq('走子后坐标仍为 16 个', mate.coords, 16);

  section('Undo and New Game');
  const undoResult = await evaluate(`(async function(){
    document.getElementById('undoBtn').click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var s = window.__premium.state();
    return { over: s.over, moveCount: s.moveCount, turn: s.turn, san: s.sanList };
  })()`);
  eq('悔棋后回到 3 着', undoResult.moveCount, 3);
  eq('悔棋后不再结束', undoResult.over, false);
  eq('悔棋后轮到黑方', undoResult.turn, 'b');
  const newGame = await evaluate(`(async function(){
    document.getElementById('newBtn').click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var s = window.__premium.state();
    return { fen: s.fen, pieces: document.querySelectorAll('.piece').length, moveCount: s.moveCount, over: s.over, turn: s.turn, coords: document.querySelectorAll('.co').length };
  })()`);
  eq('新局回到起始 FEN', newGame.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  eq('新局 32 枚', newGame.pieces, 32);
  eq('新局棋谱清空', newGame.moveCount, 0);
  eq('新局白方先行', newGame.turn, 'w');
  eq('新局坐标保留', newGame.coords, 16);

  section('Captured trays and move history');
  for (const sq of [52, 36, 11, 27, 36, 27]) await clickSq(sq);
  const capture = await evaluate(`(function(){
    var s = window.__premium.state();
    return {
      san: s.sanList, captured: s.captured.w,
      trayWhite: document.querySelectorAll('#trayTopMini .mini').length,
      trayBlack: document.querySelectorAll('#trayBottomMini .mini').length,
      advTop: document.getElementById('advTop').textContent,
      histRows: document.querySelectorAll('#historyBox li').length,
      histText: document.getElementById('historyBox').textContent
    };
  })()`);
  eq('吃子局 SAN e4 d5 exd5', capture.san, ['e4', 'd5', 'exd5']);
  eq('白方托盘记录被吃黑兵', capture.captured, ['p']);
  eq('白方托盘渲染 1 枚被吃棋子', capture.trayWhite, 1);
  eq('黑方托盘为空', capture.trayBlack, 0);
  eq('白方材料优势 +1', capture.advTop, '+1');
  eq('棋谱两行（1.e4 d5 / 2.exd5）', capture.histRows, 2);
  ok('棋谱文本含 exd5', /exd5/.test(capture.histText), capture.histText.slice(0, 80));
  await evaluate('window.__premium.start()');
  await sleep(100);

  section('AI reply, strength selector, sound and theme');
  await evaluate('document.querySelector(\'[data-mode="ai"]\').click()');
  await waitFor('ai mode', 'window.__premium.state().mode === "ai"');
  await clickSq(52);
  await clickSq(36);
  await waitFor('AI reply', 'window.__premium.state().moveCount >= 2 && !window.__premium.state().aiThinking', 8000);
  const aiState = await evaluate(`(function(){ var s = window.__premium.state(); return { moveCount: s.moveCount, turn: s.turn, san: s.sanList, pieceCount: s.pieceCount }; })()`);
  ok('AI 已回复第二着', aiState.moveCount >= 2, String(aiState.moveCount));
  eq('AI 回复后轮到白方', aiState.turn, 'w');
  ok('AI 着法写入棋谱', aiState.san.length >= 2, JSON.stringify(aiState.san));
  const controls = await evaluate(`(async function(){
    var sel = document.getElementById('level');
    sel.value = '3'; sel.dispatchEvent(new Event('change'));
    await new Promise(function(r){ setTimeout(r, 60); });
    var level = window.__premium.state().level;
    var mute = document.getElementById('muteBtn');
    var before = mute.getAttribute('aria-pressed');
    mute.click();
    var after = mute.getAttribute('aria-pressed');
    mute.click();
    var themeBefore = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    var themeAfter = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    return { level: level, before: before, after: after, themeBefore: themeBefore, themeAfter: themeAfter };
  })()`);
  eq('AI 强度切到高手', controls.level, 3);
  ok('静音按钮切换 aria-pressed', controls.before !== controls.after, controls.before + '→' + controls.after);
  ok('主题按钮切换 data-theme', controls.themeBefore !== controls.themeAfter, controls.themeBefore + '→' + controls.themeAfter);

  section('Keyboard, aria and promotion chooser');
  const keyboard = await evaluate(`(async function(){
    window.__premium.start();
    await new Promise(function(r){ setTimeout(r, 80); });
    var board = document.getElementById('board');
    board.focus();
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 40); });
    var cursor = document.querySelector('.sq.kbd-cursor');
    var cursorSq = cursor ? cursor.getAttribute('data-sq') : null;
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 40); });
    var selected = window.__premium.state().selected;
    var dots = document.querySelectorAll('.sq .dot').length;
    board.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 30); });
    return { cursorSq: cursorSq, selected: selected, dots: dots, cleared: window.__premium.state().selected };
  })()`);
  eq('方向键把光标移到 e2', keyboard.cursorSq, '52');
  eq('Enter 选中 e2', keyboard.selected, 52);
  ok('e2 显示两个合法落点', keyboard.dots >= 2, String(keyboard.dots));
  eq('Escape 清除选择', keyboard.cleared, null);

  const promo = await evaluate(`(async function(){
    window.__premium.setMode('local');
    await new Promise(function(r){ setTimeout(r, 60); });
    window.__premium.loadFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    await new Promise(function(r){ setTimeout(r, 60); });
    window.__premium.tap(8);
    window.__premium.tap(0);
    await new Promise(function(r){ setTimeout(r, 80); });
    var opened = !document.getElementById('promo').hidden;
    var buttons = document.querySelectorAll('#promoGrid button').length;
    var first = document.querySelector('#promoGrid button');
    if (first) first.click();
    await new Promise(function(r){ setTimeout(r, 100); });
    var s = window.__premium.state();
    return {
      opened: opened, buttons: buttons, moveCount: s.moveCount,
      san: s.sanList, hidden: document.getElementById('promo').hidden,
      piece: !!document.querySelector('.sq[data-sq="0"] .piece')
    };
  })()`);
  eq('升变弹窗打开', promo.opened, true);
  eq('升变提供 4 个选择', promo.buttons, 4);
  eq('选择后落子 1 步', promo.moveCount, 1);
  ok('SAN 记录升变', /^a8=/.test((promo.san || [])[0] || ''), JSON.stringify(promo.san));
  eq('升变弹窗关闭', promo.hidden, true);
  ok('a8 出现升变棋子', promo.piece, true);

  section('Mobile 390x844 / 320x568');
  const mobileResults = [];
  for (const vp of [{ width: 390, height: 844, name: '390x844' }, { width: 320, height: 568, name: '320x568' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await evaluate('window.__premium.start()');
    await sleep(200);
    const m = await evaluate(`(function(){
      var vw = innerWidth;
      var buttons = [];
      document.querySelectorAll('main button, main select, main input').forEach(function(b){
        var r = b.getBoundingClientRect();
        var cs = getComputedStyle(b);
        if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
          buttons.push({ h: Math.round(r.height), w: Math.round(r.width), tag: b.tagName, text: (b.textContent || '').trim().slice(0, 16) });
        }
      });
      var fonts = [];
      document.querySelectorAll('h1,h2,p,span,button,a,li,b,small,label,select,summary,em,div').forEach(function(el){
        if (!el.textContent || !el.textContent.trim()) return;
        var direct = false;
        for (var i=0;i<el.childNodes.length;i++){ var c=el.childNodes[i]; if (c.nodeType===3 && c.nodeValue.trim().length>1) direct=true; }
        if (!direct) return;
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
      var board = document.getElementById('board').getBoundingClientRect();
      var cell = document.querySelector('.sq').getBoundingClientRect();
      return {
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6),
        boardW: Math.round(board.width), cellW: Math.round(cell.width),
        squares: document.querySelectorAll('.sq').length,
        pieces: document.querySelectorAll('#board .piece').length,
        coords: document.querySelectorAll('.co').length
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 主控件 >=44px', m.buttons.every(function (b) { return b.h >= 44 && b.w >= 44; }), JSON.stringify(m.buttons.slice(0, 8)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 棋盘 64 格 / 32 枚', m.squares === 64 && m.pieces === 32, m.squares + '/' + m.pieces);
    ok(vp.name + ' 棋盘宽度合理', m.boardW >= 280, String(m.boardW));
    ok(vp.name + ' 格子 >=30px', m.cellW >= 30, String(m.cellW));
    eq(vp.name + ' 坐标保留', m.coords, 16);
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, buttons: m.buttons.length, minFont: Math.min.apply(null, m.fonts), boardW: m.boardW });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

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
  ok('规则页标题正确', /国际象棋/.test(rules.title), rules.title);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  eq('规则页两张详情配图', rules.images, ['assets/detail-1.webp', 'assets/detail-2.webp']);
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 个 BV 号', rules.sources.length >= 3, JSON.stringify(rules.sources));
  ['BV1PuokBiEb6', 'BV1uA4y1Q7uQ', 'BV1HS4y1w7Ey'].forEach(function (bv) {
    ok('规则页来源 ' + bv, rules.sources.indexOf(bv) >= 0);
  });
  ok('规则页含尺寸表', rules.table === true);
  ok('规则页 3 条 B 站链接', rules.biliLinks >= 3, String(rules.biliLinks));

  section('Art composition: real 64-square boards and piece counts');
  await navigate(origin + ART + 'cover', 'document.body.getAttribute("data-shot") === "cover" && document.querySelectorAll(".scene-cover .sq").length === 64');
  const art = await evaluate(`(function(){
    var cover = document.querySelector('.scene-cover');
    var wood = getComputedStyle(document.querySelector('.scene-cover .sq.light'));
    return {
      squares: cover.querySelectorAll('.sq').length,
      pieces: cover.querySelectorAll('.piece').length,
      white: cover.querySelectorAll('.piece.w').length,
      black: cover.querySelectorAll('.piece.b').length,
      title: cover.querySelector('.title').textContent,
      boardW: Math.round(cover.querySelector('.board').getBoundingClientRect().width),
      maple: wood.backgroundImage,
      coords: cover.querySelectorAll('.co').length
    };
  })()`);
  eq('封面 64 格', art.squares, 64);
  eq('封面 32 枚棋子', art.pieces, 32);
  eq('封面白 16 / 黑 16', [art.white, art.black], [16, 16]);
  ok('封面标题含国际象棋', /国际象棋/.test(art.title), art.title);
  ok('封面棋盘宽度 700px', art.boardW === 700, String(art.boardW));
  ok('封面浅格引用本地枫木', /light-maple\.webp/.test(art.maple), art.maple.slice(0, 80));
  eq('封面坐标 16 个', art.coords, 16);

  await navigate(origin + ART + 'og', 'document.body.getAttribute("data-shot") === "og" && document.querySelectorAll(".scene-og .sq").length === 64');
  const og = await evaluate(`({ pieces: document.querySelectorAll('.scene-og .piece').length, squares: document.querySelectorAll('.scene-og .sq').length })`);
  eq('OG 32 枚 / 64 格', [og.pieces, og.squares], [32, 64]);

  await navigate(origin + ART + 'detail1', 'document.body.getAttribute("data-shot") === "detail1" && document.querySelectorAll(".scene-detail1 .psvg").length === 6');
  const d1 = await evaluate(`({ pieces: document.querySelectorAll('.scene-detail1 .psvg').length, labels: document.querySelectorAll('.scene-detail1 .plabel').length, title: document.querySelector('.scene-detail1 .title').textContent })`);
  eq('尺寸图 6 枚棋子', d1.pieces, 6);
  eq('尺寸图 6 个标签', d1.labels, 6);
  ok('尺寸图标题含 95mm', /95mm/.test(d1.title), d1.title);

  await navigate(origin + ART + 'detail2', 'document.body.getAttribute("data-shot") === "detail2" && document.querySelectorAll(".scene-detail2 .piece").length === 30');
  const d2 = await evaluate(`({ pieces: document.querySelectorAll('.scene-detail2 .piece').length, moves: document.querySelectorAll('.scene-detail2 .moves span').length })`);
  eq('中局图 30 枚棋子', d2.pieces, 30);
  eq('中局图 5 组棋谱', d2.moves, 5);

  section('Artifact files and dimensions');
  const dims = {
    'assets/cover.webp': [1200, 1200],
    'assets/og.webp': [1200, 630],
    'assets/detail-1.webp': [1200, 800],
    'assets/detail-2.webp': [1200, 800]
  };
  let shotBytes = 0;
  Object.keys(dims).forEach(function (rel) {
    const abs = path.join(HERE, rel);
    const size = fs.existsSync(abs) && fs.statSync(abs).size > 1000 ? webpSize(abs) : null;
    ok('产物存在 ' + rel, Boolean(size), size ? JSON.stringify(size) : 'missing');
    if (size) eq(rel + ' 尺寸', [size.width, size.height], dims[rel]);
    if (size) shotBytes += fs.statSync(abs).size;
  });
  const artDir = path.join(GAMES_ROOT, 'assets', 'art', 'premium', 'chess');
  const materialNames = ['light-maple.webp', 'dark-walnut.webp', 'felt-cloth.webp', 'board-edge.webp'];
  let materialBytes = 0;
  materialNames.forEach(function (name) {
    const abs = path.join(artDir, name);
    const info = fs.existsSync(abs) ? webpSize(abs) : null;
    ok('材质 ' + name, Boolean(info), info ? JSON.stringify(info) : 'missing');
    if (info) eq('材质尺寸 ' + name, [info.width, info.height], [1024, 1024]);
    if (info) materialBytes += fs.statSync(abs).size;
  });
  ok('美术总量 <=2MB', materialBytes + shotBytes <= 2 * 1024 * 1024, String(materialBytes + shotBytes));
  ok('无 PNG 母版', fs.readdirSync(path.join(HERE, 'assets')).every(function (n) { return !/\.png$/i.test(n); }) &&
    fs.readdirSync(artDir).every(function (n) { return !/\.png$/i.test(n); }));
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'HANDOFF.md', 'online-e2e.json', 'test-online.js', 'online.html', 'online-server.mjs', 'art-render.html'].forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
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
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return e.decodedBodySize || e.transferSize || 0; });
    return { fps: Math.round(fps), newGameMs: Number(newGameMs.toFixed(1)),
      domNodes: document.getElementsByTagName('*').length,
      fcp: Math.round(fcp.startTime || 0), dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      loadEnd: Math.round(nav.loadEventEnd || 0), bytes: res.reduce(function(a,b){ return a+b; }, 0) };
  })()`);
  ok('FPS >= 30', perfNow.fps >= 30, String(perfNow.fps));
  ok('新局渲染 < 200ms', perfNow.newGameMs < 200, perfNow.newGameMs + 'ms');
  ok('DOM 节点 < 2500', perfNow.domNodes < 2500, String(perfNow.domNodes));
  ok('FCP < 2500ms', Number(perfNow.fcp) < 2500, perfNow.fcp + 'ms');
  ok('DCL < 4000ms', Number(perfNow.dcl) < 4000, perfNow.dcl + 'ms');
  ok('loadEventEnd < 4000ms', Number(perfNow.loadEnd) < 4000, perfNow.loadEnd + 'ms');
  ok('素材字节 <=2MB', perfNow.bytes <= 2 * 1024 * 1024, String(perfNow.bytes));
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;
  perf.fcp = perfNow.fcp;
  perf.dcl = perfNow.dcl;
  perf.loadEnd = perfNow.loadEnd;
  perf.domNodes = perfNow.domNodes;
  perf.materialBytes = perfNow.bytes;

  section('Online room: browser client + shared server');
  const onlineHandle = await startChessServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
  const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-chess-host', nickname: '浏览器房主' });
  ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'e2e-chess-host' });
  ok('online host started (AI fills seat 1)', started.status === 200 && started.body.playerCount === 2 && started.body.seats[1].ai === true, started.status);

  await navigate(onlineBase + ONLINE + '?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-chess-host',
    'document.querySelectorAll("#seats .seat").length === 2 && document.querySelectorAll("#board .sq").length === 64 && document.querySelectorAll("#board .piece").length === 32');
  const boot = await evaluate(`({
    seats: document.querySelectorAll('#seats .seat').length,
    squares: document.querySelectorAll('#board .sq').length,
    pieces: document.querySelectorAll('#board .piece').length,
    coords: document.querySelectorAll('#board .co').length,
    chip: document.getElementById('roomChip').textContent,
    online: window.__online.state()
  })`);
  eq('online 浏览器渲染 2 个座位', boot.seats, 2);
  eq('online 渲染 64 格', boot.squares, 64);
  eq('online 渲染 32 枚', boot.pieces, 32);
  eq('online 坐标 16 个', boot.coords, 16);
  ok('online 房间号可见', /房间/.test(boot.chip), boot.chip);
  eq('online 你是白方座位 0', boot.online.you, 0);
  eq('online 轮到白方', boot.online.turn, 'w');
  const beforeVersion = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(t1) + '&playerId=e2e-chess-host');
  await evaluate('window.__online.tap(52)');
  await sleep(60);
  await evaluate('window.__online.tap(36)');
  await sleep(900);
  const afterVersion = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(t1) + '&playerId=e2e-chess-host');
  ok('online 浏览器落子推进服务端状态', afterVersion.body.stateVersion > beforeVersion.body.stateVersion, beforeVersion.body.stateVersion + '→' + afterVersion.body.stateVersion);
  ok('online AI 补位已回手', afterVersion.body.state.history.length >= 2, JSON.stringify(afterVersion.body.state.history));
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-chess-host' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=chess-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /国际象棋/.test(lobby.title), lobby.title);
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
  try { cdp.ws.close(); } catch (err) { /* already closed */ }
  await new Promise(function (resolve) {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(resolve);
  });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: 'chess-premium',
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
  evidence: 'games/boardgame/chess-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
