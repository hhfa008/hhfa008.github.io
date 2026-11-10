#!/usr/bin/env node
/*
 * FreeCell premium — single-player browser E2E.
 *
 *   node games/boardgame/freecell-premium/e2e.mjs
 *   node games/boardgame/freecell-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end. Never kills Chrome and never uses a temporary
 * browser profile.
 *
 * Verifies: the real UI (click-driven moves, selection, illegal-move toast,
 * undo, hint, keyboard, win detection, auto-safe-send), Microsoft deal #1
 * reproducibility, card conservation, 390x844 / 320x568 mobile layout
 * (no horizontal overflow, >=44px primary controls, >=12px visible type),
 * zero external requests, no console/page errors, rules + art pages, artifact
 * dimensions, and performance budgets. Writes the measured numbers to
 * perf.json at the end.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./engine.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT || 9222);
const ENTRY = '/boardgame/freecell-premium/index.html';
const RULES = '/boardgame/freecell-premium/rules.html';
const ART = '/boardgame/freecell-premium/art-render.html?shot=cover';

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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
  throw new Error('resident Chrome CDP not reachable on ' + CDP_PORT + ' (run chrome-ensure)');
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
  await cdp.send('Storage.clearDataForOrigin', { origin: origin, storageTypes: 'service_workers,cache_storage,local_storage' });
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
async function waitFor(label, expression, timeout = 15000, interval = 100) {
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
  try { await cdp.send('Page.bringToFront'); } catch (err) { /* ignore */ }
  await waitFor('navigate ' + url, readyExpr, 20000);
}

function webpSize(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (err) { return null; }
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const type = buf.toString('ascii', 12, 16);
  if (type === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  if (type === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (type === 'VP8L') {
    return {
      width: 1 + (buf[21] | ((buf[22] & 0x3f) << 8)),
      height: 1 + ((buf[22] >> 6) | (buf[23] << 2) | ((buf[24] & 0x0f) << 10))
    };
  }
  return null;
}

/* ------------------------------------------------------------------ boot */
try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ENTRY + '?deal=1', 'document.readyState === "complete" && !!(window.__freecell && window.__freecell.state())');

  section('Initial render, deal #1 and materials');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var st = window.__freecell.state();
    var board = document.getElementById('board');
    var free0 = document.getElementById('free-0');
    var cards = document.querySelectorAll('.card');
    var cardNotButton = true;
    var badCards = [];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].tagName !== 'DIV' || cards[i].getAttribute('role') === 'button') {
        cardNotButton = false;
        badCards.push(cards[i].tagName + '.' + (cards[i].className || '') + '#' + (cards[i].id || ''));
      }
    }
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      deal: st.dealNumber,
      cols: st.tableau.length,
      colLengths: st.tableau.map(function(c){ return c.length; }),
      cards: window.__freecell.result().cards,
      domCards: cards.length,
      freeDom: document.querySelectorAll('#freeGroup .slot').length,
      foundDom: document.querySelectorAll('#foundGroup .slot').length,
      badge: (document.getElementById('singleBadge') || {}).textContent || '',
      shuffle: typeof window.Shuffle === 'object' && typeof window.Shuffle.shuffleDeck === 'function',
      sfx: typeof window.Sfx === 'object' && typeof window.Sfx.play === 'function',
      store: typeof window.Store === 'object' && typeof window.Store.getJSON === 'function',
      engine: typeof window.FreeCellEngine === 'object' && window.FreeCellEngine.VERSION,
      cardNotButton: cardNotButton,
      badCards: badCards.slice(0, 5),
      felt: getComputedStyle(board).backgroundImage,
      back: free0 ? getComputedStyle(free0).backgroundImage : '',
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0)
    };
  })()`);
  ok('title 含空当接龙', /空当接龙/.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('URL 局号 1 生效', initial.deal, 1);
  eq('8 列牌桌', initial.cols, 8);
  eq('开局 7/7/7/7/6/6/6/6', initial.colLengths, [7, 7, 7, 7, 6, 6, 6, 6]);
  eq('引擎报告 52 张', initial.cards, 52);
  eq('DOM 渲染 52 张牌', initial.domCards, 52);
  eq('4 个自由空位 DOM', initial.freeDom, 4);
  eq('4 个基础堆 DOM', initial.foundDom, 4);
  eq('可见「单人」badge', initial.badge, '单人');
  ok('共享 shuffle 已加载', initial.shuffle);
  ok('共享 sfx 已加载', initial.sfx);
  ok('共享 store 已加载', initial.store);
  ok('引擎版本已暴露', /^1\./.test(String(initial.engine)), String(initial.engine));
  ok('牌桌使用毛毡材质', initial.felt.indexOf('freecell/felt.webp') >= 0, initial.felt.slice(0, 120));
  ok('空位使用牌背材质', initial.back.indexOf('freecell/card-back.webp') >= 0, initial.back.slice(0, 120));
  ok('牌格全部是 DIV 且不是 role=button', initial.cardNotButton, JSON.stringify(initial.badCards));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Microsoft deal #1 reproducibility');
  const expectedRow = E.dealDeck(1).slice(0, 8).map((c) => c.id);
  const browserRow = await evaluate('window.__freecell.state().tableau.map(function(c){ return c[0].id; })');
  eq('浏览器首行与 Node 引擎 deal #1 一致', browserRow, expectedRow);
  eq('Node 引擎 RNG 序列', E.msRandomSequence(1, 6), [41, 18467, 6334, 26500, 19169, 15724]);
  const browserAll = await evaluate('window.__freecell.state().tableau.reduce(function(a,c){ return a.concat(c.map(function(x){ return x.id; })); }, []).sort()');
  eq('浏览器 52 张无重复', Array.from(new Set(browserAll)).length, 52);
  eq('浏览器牌集与引擎一致', browserAll, E.dealDeck(1).map((c) => c.id).sort());

  section('Real UI: click-driven legal moves and conservation');
  const clickRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    function sourceSel(m){
      if (m.from.zone === 'tableau') return '[data-zone="tableau"][data-col="' + m.from.col + '"][data-idx="' + m.from.index + '"]';
      if (m.from.zone === 'free') return '[data-zone="free"][data-cell="' + m.from.cell + '"]';
      return '[data-zone="foundation"][data-suit="' + m.from.suit + '"]';
    }
    function destSel(m){
      if (m.to.zone === 'tableau') return '.tcol[data-col="' + m.to.col + '"]';
      if (m.to.zone === 'free') return '#free-' + m.to.cell;
      return '#found-' + m.to.suit;
    }
    var moved = 0, errors = [];
    for (var i = 0; i < 8; i++) {
      var before = window.__freecell.state();
      var moves = window.__freecell.legalMoves();
      var m = moves.filter(function(x){ return x.from.zone === 'tableau' && x.to.zone === 'tableau'; })[0] ||
        moves.filter(function(x){ return x.from.zone === 'tableau' && x.to.zone !== 'foundation'; })[0] ||
        moves.filter(function(x){ return x.to.zone === 'tableau'; })[0] || moves[0];
      if (!m) break;
      var src = document.querySelector(sourceSel(m));
      if (!src) { errors.push('no source ' + m.key); break; }
      src.click();
      await sleep(15);
      var dst = document.querySelector(destSel(m));
      if (!dst) { errors.push('no dest ' + m.key); break; }
      dst.click();
      await sleep(25);
      var after = window.__freecell.state();
      if (after.moves <= before.moves) errors.push('not advanced ' + m.key);
      else moved++;
    }
    var final = window.__freecell.result();
    return { moved: moved, errors: errors, cards: final.cards, won: final.won };
  })()`);
  ok('点击执行了至少 4 步合法移动', clickRun.moved >= 4, JSON.stringify(clickRun));
  eq('点击移动过程无失败', clickRun.errors, []);
  eq('点击后 52 张牌守恒', clickRun.cards, 52);
  ok('点击流程没有意外提前胜利', clickRun.won === false);

  section('Illegal move feedback and undo');
  await evaluate('window.__freecell.newGame({dealNumber:1}); true');
  await sleep(40);
  const illegal = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var before = window.__freecell.state().moves;
    var top = document.querySelector('[data-zone="tableau"][data-col="0"][data-idx="6"]');
    if (!top) return { missing: true };
    top.click();
    await sleep(15);
    var wrong = document.getElementById('found-0');
    wrong.click();
    await sleep(25);
    return {
      before: before,
      after: window.__freecell.state().moves,
      toast: document.getElementById('toast').textContent,
      shown: document.getElementById('toast').classList.contains('show')
    };
  })()`);
  ok('非法目标不改变步数', !illegal.missing && illegal.before === illegal.after, JSON.stringify(illegal));
  ok('非法移动给出提示', !!illegal.toast && illegal.toast.length > 0, illegal.toast);
  const undoRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    window.__freecell.clearSelection();
    var moves = window.__freecell.legalMoves();
    var m = moves.filter(function(x){ return x.from.zone === 'tableau'; })[0] || moves[0];
    var el = document.querySelector('[data-zone="tableau"][data-col="' + m.from.col + '"][data-idx="' + m.from.index + '"]');
    el.click();
    await sleep(15);
    var dst = m.to.zone === 'tableau' ? document.querySelector('.tcol[data-col="' + m.to.col + '"]') :
      (m.to.zone === 'free' ? document.getElementById('free-' + m.to.cell) : document.getElementById('found-' + m.to.suit));
    dst.click();
    await sleep(25);
    var afterMove = window.__freecell.state().moves;
    document.getElementById('undoBtn').click();
    await sleep(25);
    var afterUndo = window.__freecell.state();
    return { afterMove: afterMove, afterUndo: afterUndo.moves, cards: window.__freecell.result().cards };
  })()`);
  ok('一步移动后步数增加', undoRun.afterMove >= 1, JSON.stringify(undoRun));
  eq('撤销回到移动前步数', undoRun.afterUndo, 0);
  eq('撤销后 52 张守恒', undoRun.cards, 52);

  section('Hint, keyboard shortcuts, supermove formula');
  const hintRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    document.getElementById('hintBtn').click();
    await sleep(30);
    return {
      from: document.querySelectorAll('.hint-from').length,
      to: document.querySelectorAll('.hint-to').length,
      text: document.getElementById('hintText').textContent,
      api: window.__freecell.hint()
    };
  })()`);
  ok('提示高亮来源与目标', hintRun.from >= 1 && hintRun.to >= 1, JSON.stringify({ from: hintRun.from, to: hintRun.to }));
  ok('提示文本含中文说明', /提示/.test(hintRun.text) && /[把移叠送]/.test(hintRun.text), hintRun.text);
  ok('提示 API 返回合法动作', !!hintRun.api && typeof hintRun.api.key === 'string', hintRun.api && hintRun.api.key);
  const keysRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    await sleep(30);
    var hintVisible = document.getElementById('hintText').textContent.indexOf('提示') === 0;
    document.getElementById('moveStat').textContent = '';
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await sleep(60);
    var fresh = window.__freecell.state();
    var supermove = (function(){
      var st = fresh, eng = window.__freecell.engine;
      var free = eng.emptyFreeCellCount(st), empty = eng.emptyColumnCount(st);
      return {
        limit: eng.maxMove(st, false),
        formula: (free + 1) * Math.pow(2, empty),
        toEmpty: eng.maxMove(st, true),
        formulaEmpty: (free + 1) * Math.pow(2, Math.max(0, empty - 1)),
        columns: eng.COLUMN_COUNT,
        freeCells: eng.FREE_CELL_COUNT,
        ratio: eng.CARD_RATIO
      };
    })();
    return { hintVisible: hintVisible, moves: fresh.moves, cards: window.__freecell.result().cards, supermove: supermove };
  })()`);
  ok('键盘 H 触发提示', keysRun.hintVisible);
  eq('键盘 N 开新局步数归零', keysRun.moves, 0);
  eq('键盘 N 后 52 张守恒', keysRun.cards, 52);
  eq('超级搬运公式与实现一致', keysRun.supermove.limit, keysRun.supermove.formula);
  eq('搬到空列的公式与实现一致', keysRun.supermove.toEmpty, keysRun.supermove.formulaEmpty);
  eq('8 列 4 空位常量', [keysRun.supermove.columns, keysRun.supermove.freeCells], [8, 4]);
  ok('扑克比例 63:88', Math.abs(keysRun.supermove.ratio - 63 / 88) < 1e-12, String(keysRun.supermove.ratio));

  section('Win detection through the real UI');
  const nearWin = E.createGame({ dealNumber: 1 });
  nearWin.foundations = [
    Array.from({ length: 13 }, (_, i) => E.makeCard(0, i + 1)),
    Array.from({ length: 13 }, (_, i) => E.makeCard(1, i + 1)),
    Array.from({ length: 13 }, (_, i) => E.makeCard(2, i + 1)),
    Array.from({ length: 12 }, (_, i) => E.makeCard(3, i + 1))
  ];
  nearWin.tableau = [[], [], [], [], [], [], [], []];
  nearWin.freeCells = [E.makeCard(3, 13), null, null, null];
  nearWin.moves = 11;
  nearWin.startedAt = Date.now() - 5000;
  eq('胜利前牌数 52', E.allCards(nearWin).length, 52);
  await evaluate('window.__freecell.setState(' + JSON.stringify(JSON.stringify(nearWin)) + '); true');
  await sleep(40);
  const winRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var src = document.querySelector('#free-0 .card');
    src.click();
    await sleep(20);
    document.getElementById('found-3').click();
    await sleep(120);
    var res = window.__freecell.result();
    var statsRaw = null;
    try { statsRaw = localStorage.getItem('fc-premium-stats-v1'); } catch (e) {}
    return {
      won: res.won,
      foundation: res.foundation,
      modal: !document.getElementById('winModal').hidden,
      winMoves: document.getElementById('winMoves').textContent,
      winDeal: document.getElementById('winDeal').textContent,
      stats: statsRaw ? JSON.parse(statsRaw) : null,
      spades: window.__freecell.state().foundations[3].length
    };
  })()`);
  ok('点击最后一张 K 后胜利', winRun.won === true);
  eq('52 张全部归位', winRun.foundation, 52);
  eq('黑桃基础堆到 K', winRun.spades, 13);
  eq('胜利结算面板显示', winRun.modal, true);
  eq('结算步数为 12', winRun.winMoves, '12');
  eq('结算显示局号 1', winRun.winDeal, '1');
  ok('胜利写入本机记录', !!winRun.stats && winRun.stats.wins >= 1 && winRun.stats.bestMoves <= 12, JSON.stringify(winRun.stats));

  section('Auto-safe-send finishes a safe endgame');
  const autoWin = E.createGame({ dealNumber: 1 });
  autoWin.foundations = [0, 1, 2, 3].map((suit) =>
    Array.from({ length: 12 }, (_, i) => E.makeCard(suit, i + 1)));
  autoWin.tableau = [[E.makeCard(3, 13)], [E.makeCard(0, 13)], [E.makeCard(1, 13)], [], [], [], [], []];
  autoWin.freeCells = [E.makeCard(2, 13), null, null, null];
  autoWin.moves = 40;
  autoWin.startedAt = Date.now() - 8000;
  eq('自动收牌前牌数 52', E.allCards(autoWin).length, 52);
  await evaluate('window.__freecell.setState(' + JSON.stringify(JSON.stringify(autoWin)) + '); true');
  await sleep(40);
  const autoRun = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    document.getElementById('autoBtn').click();
    await sleep(160);
    var res = window.__freecell.result();
    return {
      won: res.won,
      foundation: res.foundation,
      modal: !document.getElementById('winModal').hidden,
      foundations: window.__freecell.state().foundations.map(function(p){ return p.length; })
    };
  })()`);
  ok('自动安全收牌收完四张 K 并胜利', autoRun.won === true);
  eq('四堆基础堆全部 13 张', autoRun.foundations, [13, 13, 13, 13]);
  eq('自动收牌后 52 张归位', autoRun.foundation, 52);
  eq('自动收牌显示结算面板', autoRun.modal, true);

  section('Service worker cache');
  const sw = await evaluate(`(async function(){
    var fileOk = false;
    try { fileOk = (await fetch('./sw.js')).ok; } catch (e) {}
    var registered = false;
    try {
      var regs = await navigator.serviceWorker.getRegistrations();
      registered = regs.length > 0;
    } catch (e) {}
    return { fileOk: fileOk, registered: registered };
  })()`);
  ok('本地 sw.js 可访问', sw.fileOk === true);
  ok('service worker 已注册', sw.registered === true);

  section('Mobile 390x844 / 320x568');
  await evaluate('window.__freecell.newGame({dealNumber:1}); true');
  await sleep(60);
  const mobile = [];
  for (const vp of [{ width: 390, height: 844, name: '390x844' }, { width: 320, height: 568, name: '320x568' }]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await sleep(180);
    const m = await evaluate(`(function(){
      var de = document.documentElement;
      var vw = de.clientWidth;
      var controls = [];
      document.querySelectorAll('button, input, select, textarea, a[href], [role="button"]').forEach(function(el){
        var r = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
        controls.push({ tag: el.tagName.toLowerCase(), id: el.id || '', w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), right: Math.round(r.right) });
      });
      var smallText = [];
      document.querySelectorAll('body *').forEach(function(el){
        if (el.namespaceURI === 'http://www.w3.org/2000/svg') return;
        var hasDirect = false;
        for (var i = 0; i < el.childNodes.length; i++) {
          var n = el.childNodes[i];
          if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim().length > 1) { hasDirect = true; break; }
        }
        if (!hasDirect) return;
        var r = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
        var fs = parseFloat(cs.fontSize) || 0;
        if (fs && fs < 12) smallText.push({ tag: el.tagName.toLowerCase(), fs: fs, text: (el.textContent || '').trim().slice(0, 20) });
      });
      return {
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        controls: controls,
        smallText: smallText,
        cols: document.querySelectorAll('.tcol').length,
        cards: document.querySelectorAll('.card').length,
        cardDiv: (function(){ var c = document.querySelector('.card'); return !!c && c.tagName === 'DIV' && c.getAttribute('role') !== 'button'; })(),
        cardBox: (function(){ var c = document.querySelector('.tcol .card'); if (!c) return null; var r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    const small = m.controls.filter((c) => c.w < 44 || c.h < 44);
    ok(vp.name + ' 主控件 >=44×44', small.length === 0, JSON.stringify(small.slice(0, 6)));
    ok(vp.name + ' 主控件横向可达', m.controls.every((c) => c.x >= -1 && c.right <= m.clientWidth + 1), JSON.stringify(m.controls.filter((c) => c.x < -1 || c.right > m.clientWidth + 1).slice(0, 4)));
    ok(vp.name + ' 可见字号 >=12px', m.smallText.length === 0, JSON.stringify(m.smallText.slice(0, 6)));
    eq(vp.name + ' 8 列牌桌', m.cols, 8);
    eq(vp.name + ' 52 张牌', m.cards, 52);
    ok(vp.name + ' 牌格是 DIV 非按钮', m.cardDiv === true);
    ok(vp.name + ' 牌面可见', !!m.cardBox && m.cardBox.w > 20 && m.cardBox.h > 28, JSON.stringify(m.cardBox));
    mobile.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, controls: m.controls.length, card: m.cardBox });
  }
  perf.mobile = mobile;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  section('Rules page');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    var jsonld = Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){
      try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; }
    });
    var imgs = Array.prototype.map.call(document.querySelectorAll('img'), function(img){ return img.getAttribute('src'); });
    return {
      title: document.title,
      badge: document.body.innerText.indexOf('单人') !== -1,
      jsonld: jsonld,
      imgs: imgs,
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length,
      faqTerms: ['超级搬运', '基础堆', '局号', '自动收牌'].every(function(t){ return document.body.innerText.indexOf(t) !== -1; })
    };
  })()`);
  ok('规则页标题正确', /空当接龙/.test(rules.title), rules.title);
  ok('规则页有可见「单人」', rules.badge === true);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  ok('规则页含详情图与卡片图', rules.imgs.length === 2 && rules.imgs.some(function(s){ return /detail-1\.webp$/.test(s); }) && rules.imgs.some(function(s){ return /card\.webp$/.test(s); }), JSON.stringify(rules.imgs));
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含 3 条 B 站来源', rules.sources >= 3, String(rules.sources));
  ok('规则页覆盖关键术语', rules.faqTerms === true);

  section('Art composition (four shots)');
  const SHOT_SIZES = { cover: [1200, 1200], og: [1200, 630], detail: [1536, 1024], card: [480, 320] };
  for (const shot of ['cover', 'og', 'detail', 'card']) {
    const dims = SHOT_SIZES[shot];
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: dims[0], height: dims[1], deviceScaleFactor: 1, mobile: false });
    await sleep(120);
    await navigate(origin + '/boardgame/freecell-premium/art-render.html?shot=' + shot,
      'document.documentElement.dataset.cards === "52" && document.querySelectorAll(".board .card").length === 52');
    const art = await evaluate(`(function(){
      var board = document.querySelector('.board');
      var empty = document.querySelector('.slot.empty');
      var de = document.documentElement;
      var rect = board ? board.getBoundingClientRect() : null;
      return {
        shot: document.documentElement.getAttribute('data-shot'),
        cards: document.querySelectorAll('.board .card').length,
        cols: document.querySelectorAll('.col').length,
        free: document.querySelectorAll('.free-slot').length,
        found: document.querySelectorAll('.foundation-slot').length,
        title: (document.querySelector('h1') || {}).textContent || '',
        felt: board ? getComputedStyle(board).backgroundImage : '',
        back: empty ? getComputedStyle(empty).backgroundImage : '',
        buttons: document.querySelectorAll('button').length,
        scrollWidth: de.scrollWidth,
        clientWidth: de.clientWidth,
        scrollHeight: de.scrollHeight,
        clientHeight: de.clientHeight,
        boardTop: rect ? Math.round(rect.top) : -1,
        boardBottom: rect ? Math.round(rect.bottom) : -1
      };
    })()`);
    eq('配图 ' + shot + ' 共 52 张牌', art.cards, 52);
    eq('配图 ' + shot + ' 8 列', art.cols, 8);
    eq('配图 ' + shot + ' 4 空位 + 4 基础堆', [art.free, art.found], [4, 4]);
    ok('配图 ' + shot + ' 标题正确', /空当接龙/.test(art.title), art.title);
    ok('配图 ' + shot + ' 使用毛毡材质', art.felt.indexOf('freecell/felt.webp') >= 0, art.felt.slice(0, 100));
    if (shot === 'card') ok('配图 card 使用牌背材质', art.back.indexOf('freecell/card-back.webp') >= 0, art.back.slice(0, 100));
    ok('配图 ' + shot + ' 目标画布无滚动溢出',
      art.scrollWidth <= art.clientWidth + 1 && art.scrollHeight <= art.clientHeight + 1,
      art.scrollWidth + 'x' + art.scrollHeight + ' / ' + art.clientWidth + 'x' + art.clientHeight);
    ok('配图 ' + shot + ' 牌桌完整落在画布内', art.boardTop >= 0 && art.boardBottom <= dims[1] + 1,
      'board ' + art.boardTop + '–' + art.boardBottom + ' / canvas ' + dims[1]);
  }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  section('Artifact files and WebP dimensions');
  const files = [
    'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/card.webp',
    'engine.js', 'data.js', 'index.html', 'rules.html', 'sw.js', 'art-render.html',
    'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md'
  ];
  files.forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  const coverSize = webpSize(path.join(HERE, 'assets/cover.webp'));
  const ogSize = webpSize(path.join(HERE, 'assets/og.webp'));
  const detailSize = webpSize(path.join(HERE, 'assets/detail-1.webp'));
  const cardSize = webpSize(path.join(HERE, 'assets/card.webp'));
  eq('cover.webp 1200×1200', coverSize, { width: 1200, height: 1200 });
  eq('og.webp 1200×630', ogSize, { width: 1200, height: 630 });
  ok('detail-1.webp 至少 1200×800', !!detailSize && detailSize.width >= 1200 && detailSize.height >= 800, JSON.stringify(detailSize));
  eq('card.webp 480×320', cardSize, { width: 480, height: 320 });
  const feltPath = path.resolve(HERE, '../../assets/art/premium/freecell/felt.webp');
  const backPath = path.resolve(HERE, '../../assets/art/premium/freecell/card-back.webp');
  ok('felt.webp 存在且非空', fs.existsSync(feltPath) && fs.statSync(feltPath).size > 0, String(fs.existsSync(feltPath) ? fs.statSync(feltPath).size : 0));
  ok('card-back.webp 存在且非空', fs.existsSync(backPath) && fs.statSync(backPath).size > 0, String(fs.existsSync(backPath) ? fs.statSync(backPath).size : 0));

  section('Performance budgets');
  await navigate(origin + ENTRY + '?deal=1', 'document.readyState === "complete" && !!(window.__freecell && window.__freecell.state())');
  const perfNow = await evaluate(`(async function(){
    var frames = 0, start = performance.now();
    await new Promise(function(resolve){
      function loop(t){ frames++; if (t - start < 600) requestAnimationFrame(loop); else resolve(); }
      requestAnimationFrame(loop);
    });
    var fps = frames / ((performance.now() - start) / 1000);
    var t = performance.now();
    window.__freecell.newGame({ dealNumber: 1 });
    var newGameMs = performance.now() - t;
    var engine = window.__freecell.engine;
    var pureStart = performance.now();
    var g = engine.createGame({ dealNumber: 617 });
    for (var i = 0; i < 200; i++) {
      var moves = engine.getLegalMoves(g);
      if (!moves.length) break;
      g = engine.applyMove(g, moves[0]);
    }
    var pureMove = (performance.now() - pureStart) / 200;
    return {
      fps: Math.round(fps),
      newGameMs: Number(newGameMs.toFixed(1)),
      pureMoveMs: Number(pureMove.toFixed(3)),
      domNodes: document.getElementsByTagName('*').length
    };
  })()`);
  ok('FPS >= 30', perfNow.fps >= 30, String(perfNow.fps));
  ok('新局渲染 < 200ms', perfNow.newGameMs < 200, perfNow.newGameMs + 'ms');
  ok('纯移动 < 500ms', perfNow.pureMoveMs < 500, perfNow.pureMoveMs + 'ms');
  ok('DOM 节点 < 2500', perfNow.domNodes < 2500, String(perfNow.domNodes));
  ok('FCP < 2500ms', Number(perf.fcp) < 2500, perf.fcp + 'ms');
  ok('loadEventEnd < 4000ms', Number(perf.loadEnd) < 4000, perf.loadEnd + 'ms');
  ok('传输体积 < 2MB', Number(perf.materialBytes) < 2 * 1024 * 1024, String(perf.materialBytes));
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;
  perf.pureMoveMs = perfNow.pureMoveMs;

  section('Zero external requests & console clean');
  const external = Array.from(new Set(requests.filter(function (url) {
    return url.indexOf(origin) !== 0 && url.indexOf('data:') !== 0 &&
      url.indexOf('about:') !== 0 && url.indexOf('blob:') !== 0 &&
      url.indexOf('chrome-extension:') !== 0;
  })));
  eq('零外部网络请求', external.length, 0, external.slice(0, 5).join(', '));
  ok('零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | ') + ' :: ' + notFound.slice(0, 6).join(' ; '));
  eq('零页面异常', pageErrors.length, 0, pageErrors.slice(0, 3).join(' | '));
  eq('零 404', notFound.length, 0, notFound.slice(0, 6).join(' ; '));
} catch (err) {
  ok('E2E 执行成功', false, err && err.message);
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) { /* tab may be gone */ }
  await new Promise(function (resolve) { server.close(resolve); });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: 'freecell-premium',
  ok: failed === 0,
  budgets: {
    fcpMs: 2500,
    domContentLoadedMs: 4000,
    loadEventEndMs: 4000,
    domNodes: 2500,
    fps: 30,
    newGameRenderMs: 200,
    pureMoveMs: 500,
    materialBytes: 2097152,
    externalRequests: 0
  },
  measured: {
    fcpMs: perf.fcp,
    domContentLoadedMs: perf.dcl,
    loadEventEndMs: perf.loadEnd,
    domNodes: perf.domNodes,
    fps: perf.fps,
    newGameRenderMs: perf.newGameRenderMs,
    pureMoveMs: perf.pureMoveMs,
    materialBytes: perf.materialBytes,
    externalRequests: 0
  },
  mobile: perf.mobile || null,
  evidence: 'games/boardgame/freecell-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
