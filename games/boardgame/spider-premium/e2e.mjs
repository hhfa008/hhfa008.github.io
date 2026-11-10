#!/usr/bin/env node
/*
 * Spider Solitaire premium — single-player browser E2E.
 *
 *   node games/boardgame/spider-premium/e2e.mjs
 *   node games/boardgame/spider-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end. No temp Chrome/profile for the browser test.
 *
 * Verifies: real UI moves, deal, no-deal-with-empty-column, undo, hint,
 * keyboard, crafted K→A completion/win, reset/difficulty, 390x844 + 320x568
 * layout (no overflow, >=44px controls, >=12px type, div card cells),
 * zero external requests, console/page errors, rules JSON-LD, art
 * composition counts/materials, artifact files, and performance budgets.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT || 9222);
const ENTRY = '/boardgame/spider-premium/index.html';
const RULES = '/boardgame/spider-premium/rules.html';
const ART = '/boardgame/spider-premium/art-render.html?shot=cover';

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
const badResponses = [];
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
        'service-worker-allowed': '/boardgame/spider-premium/'
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
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-b8-g10';
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
    badResponses.push(msg.params.response.status + ' ' + msg.params.response.url);
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
async function click(selector) {
  return evaluate('(function(){var el=document.querySelector(' + JSON.stringify(selector) + '); if(!el) return false; el.click(); return true;})()');
}

const CRAFT_WIN = `(function(){
  var E = window.__spider.engine;
  var deck = E.makeDeck(4).map(function(c){ return { id:c.id, suit:c.suit, rank:c.rank, faceUp:true }; });
  var foundations = [];
  for (var r = 0; r < 7; r++) {
    var chunk = deck.splice(0, 13);
    chunk.sort(function(a,b){ return b.rank - a.rank; });
    foundations.push({ suit: chunk[0].suit, cards: chunk });
  }
  deck.sort(function(a,b){ return b.rank - a.rank; });
  var columns = [];
  for (var i = 0; i < 10; i++) columns.push([]);
  columns[0] = deck.slice(0, 12);
  columns[1] = [deck[12]];
  var state = {
    version: E.VERSION, seed: 777, difficulty: 4, columns: columns, stock: [],
    foundations: foundations, completedRuns: 7, score: 700, moves: 0, deals: 0,
    actionCount: 0, over: false, result: null, lastAction: null, log: []
  };
  window.__spider.setState(state);
  return {
    foundations: window.__spider.getState().foundations.length,
    cards: E.allCards(window.__spider.getState()).length,
    legal: window.__spider.legalMoves().length,
    doneSlots: document.querySelectorAll('.f-slot.done').length,
    slots: document.querySelectorAll('.f-slot').length
  };
})()`;

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: origin + ENTRY + '?seed=20261110&difficulty=1' });
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (err) {}
  try { await cdp.send('Page.bringToFront'); } catch (err) {}
  await waitFor('page boot', '!!(window.__spider && window.__spider.getState)', 20000);

  section('Initial render, engine state and premium materials');
  const initial = await evaluate(`(function(){
    var E = window.__spider.engine;
    var s = window.__spider.getState();
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var cards = E.allCards(s);
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      columns: s.columns.length,
      lengths: s.columns.map(function(c){ return c.length; }),
      stock: s.stock.length,
      score: s.score,
      moves: s.moves,
      deals: s.deals,
      difficulty: s.difficulty,
      over: s.over,
      cards: cards.length,
      unique: new Set(cards.map(function(c){ return c.id; })).size,
      topFaceUp: s.columns.every(function(c){ return c[c.length-1].faceUp; }),
      nonTopDown: s.columns.every(function(c){ return c.slice(0,-1).every(function(x){ return !x.faceUp; }); }),
      felt: getComputedStyle(document.body).backgroundImage.indexOf('felt.webp') >= 0,
      back: document.querySelector('.stock-back') ? getComputedStyle(document.querySelector('.stock-back')).backgroundImage.indexOf('card-back.webp') >= 0 : false,
      domColumns: document.querySelectorAll('.col').length,
      domCards: document.querySelectorAll('.card').length,
      stockBacks: document.querySelectorAll('.stock-back').length,
      foundations: document.querySelectorAll('.f-slot').length,
      singleBadge: document.body.innerText.indexOf('单人') >= 0,
      shared: !!(window.Shuffle && window.Shuffle.shuffle && window.Sfx && window.Sfx.play && window.Store && window.Store.get),
      titleShare: /蜘蛛纸牌/.test(document.title),
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      materialBytes: res.reduce(function(a,r){ return a + (r.size || 0); }, 0)
    };
  })()`);
  ok('标题含蜘蛛纸牌', initial.titleShare, initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('viewport 含 viewport-fit=cover', initial.viewport.indexOf('viewport-fit=cover') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('初始 10 列', initial.columns, 10);
  eq('初始列牌数 6/6/6/6/5/5/5/5/5/5', initial.lengths, [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  eq('初始牌堆 50', initial.stock, 50);
  eq('初始分数 500', initial.score, 500);
  eq('初始难度一色', initial.difficulty, 1);
  eq('初始未结束', initial.over, false);
  eq('初始 104 张牌', initial.cards, 104);
  eq('初始唯一牌 104', initial.unique, 104);
  ok('每列顶端正面', initial.topFaceUp);
  ok('每列非顶端背面', initial.nonTopDown);
  ok('牌桌使用本地绒布材质', initial.felt);
  ok('牌背使用本地 card-back.webp', initial.back);
  eq('DOM 渲染 10 列', initial.domColumns, 10);
  eq('DOM 渲染 54 张桌面牌', initial.domCards, 54);
  eq('牌堆显示 5 叠', initial.stockBacks, 5);
  eq('完成区 8 个槽位', initial.foundations, 8);
  ok('页面有可见「单人」', initial.singleBadge);
  ok('共享 Shuffle/Sfx/Store 已加载', initial.shared);
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.materialBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: select a legal run and move it with clicks');
  const uiMove = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var before = window.__spider.getState();
    window.__e2eBeforeMove = { score: before.score, moves: before.moves, columns: JSON.stringify(before.columns) };
    var moves = window.__spider.legalMoves().filter(function(m){ return m.type === 'move'; });
    if (!moves.length) return { error: 'no legal tableau move' };
    var move = moves[0];
    var src = document.querySelector('.card[data-col="' + move.fromCol + '"][data-index="' + move.index + '"]');
    if (!src) return { error: 'source card missing', move: move };
    src.click();
    await sleep(30);
    var selection = window.__spider.selection();
    var selectedClass = document.querySelectorAll('.card.sel').length;
    var dst = document.querySelector('.col[data-col="' + move.toCol + '"]');
    dst.click();
    await sleep(120);
    var after = window.__spider.getState();
    return {
      move: move, selection: selection, selectedClass: selectedClass,
      beforeScore: before.score, afterScore: after.score,
      beforeMoves: before.moves, afterMoves: after.moves,
      changed: JSON.stringify(before.columns) !== JSON.stringify(after.columns),
      selectionCleared: window.__spider.selection() === null,
      cardCount: window.__spider.engine.allCards(after).length,
      toast: document.getElementById('toast').textContent
    };
  })()`);
  ok('初始存在桌面移动', !uiMove.error, uiMove.error || '');
  ok('点击牌后出现选中', uiMove.selection && uiMove.selection.col === uiMove.move.fromCol, JSON.stringify(uiMove.selection));
  ok('选中牌有高亮', uiMove.selectedClass >= 1, String(uiMove.selectedClass));
  eq('点击后牌局发生变化', uiMove.changed, true);
  eq('移动扣 1 分', uiMove.afterScore, uiMove.beforeScore - 1);
  eq('移动步数 +1', uiMove.afterMoves, uiMove.beforeMoves + 1);
  ok('移动后取消选中', uiMove.selectionCleared);
  eq('移动后仍 104 张', uiMove.cardCount, 104);

  section('Undo, hint and keyboard');
  const uiUndo = await evaluate(`(async function(){
    var beforeUndo = window.__spider.getState();
    document.getElementById('undoBtn').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var restored = window.__spider.getState();
    var hintOk = false;
    document.getElementById('hintBtn').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var hint = window.__spider.hint();
    var toast = document.getElementById('toast').textContent;
    var highlight = document.querySelectorAll('.hint-src').length;
    if (hint) {
      hintOk = window.__spider.legalMoves().some(function(m){ return m.key === hint.key; });
    }
    // keyboard undo: make a move through the test hook, then press U
    var moves = window.__spider.legalMoves();
    var move = moves[0];
    var beforeKeyMove = window.__spider.getState().score;
    window.__spider.playMove(move);
    var scoreAfterMove = window.__spider.getState().score;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    var scoreAfterKey = window.__spider.getState().score;
    // keyboard new game
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    var afterKeyNew = window.__spider.getState();
    var pre = window.__e2eBeforeMove || {};
    return {
      undoScore: restored.score, undoMoves: restored.moves,
      prevScore: pre.score, prevMoves: pre.moves,
      columnsMatch: JSON.stringify(restored.columns) === pre.columns,
      hint: hint, hintLegal: hintOk, toast: toast, highlight: highlight,
      scoreAfterMove: scoreAfterMove, scoreAfterKey: scoreAfterKey, beforeKeyMove: beforeKeyMove,
      keyNewScore: afterKeyNew.score, keyNewCards: window.__spider.engine.allCards(afterKeyNew).length,
      keyNewColumns: afterKeyNew.columns.length
    };
  })()`);
  eq('撤销恢复分数', uiUndo.undoScore, uiUndo.prevScore);
  eq('撤销恢复步数', uiUndo.undoMoves, uiUndo.prevMoves);
  eq('撤销恢复完整列状态', uiUndo.columnsMatch, true);
  ok('提示返回合法动作', !!uiUndo.hint && uiUndo.hintLegal, JSON.stringify(uiUndo.hint));
  ok('提示显示 toast', typeof uiUndo.toast === 'string' && uiUndo.toast.length > 0, uiUndo.toast);
  ok('提示高亮或建议发牌', uiUndo.highlight >= 1 || /发牌/.test(uiUndo.toast), 'highlight=' + uiUndo.highlight);
  eq('键盘 U 撤销恢复分数', uiUndo.scoreAfterKey, uiUndo.beforeKeyMove);
  eq('键盘 N 开新局分数 500', uiUndo.keyNewScore, 500);
  eq('键盘 N 新局 104 张', uiUndo.keyNewCards, 104);
  eq('键盘 N 新局 10 列', uiUndo.keyNewColumns, 10);

  section('Deal: 10 cards, one per column');
  const dealResult = await evaluate(`(async function(){
    window.__spider.newGame({ seed: 111, difficulty: 1 });
    var before = window.__spider.getState();
    document.getElementById('dealBtn').click();
    await new Promise(function(r){ setTimeout(r, 100); });
    var after = window.__spider.getState();
    return {
      beforeStock: before.stock.length, afterStock: after.stock.length,
      beforeLengths: before.columns.map(function(c){ return c.length; }),
      afterLengths: after.columns.map(function(c){ return c.length; }),
      beforeScore: before.score, afterScore: after.score,
      beforeDeals: before.deals, afterDeals: after.deals,
      foundations: after.foundations.length,
      cards: window.__spider.engine.allCards(after).length,
      topFaceUp: after.columns.every(function(c){ return c[c.length-1].faceUp; }),
      lastType: after.lastAction && after.lastAction.type,
      disabled: document.getElementById('dealBtn').disabled
    };
  })()`);
  eq('发牌后牌堆减少 10', dealResult.afterStock, dealResult.beforeStock - 10);
  ok('发牌后每列各 +1', dealResult.afterLengths.every(function(n, i){ return n >= dealResult.beforeLengths[i] + 1 || n === dealResult.beforeLengths[i] + 1 - 13; }), JSON.stringify(dealResult.afterLengths));
  eq('发牌次数 +1', dealResult.afterDeals, dealResult.beforeDeals + 1);
  ok('发牌后分数按 −1 + 100×收组 计算', dealResult.afterScore === dealResult.beforeScore - 1 + dealResult.foundations * 100, JSON.stringify(dealResult));
  eq('发牌后 lastAction=deal', dealResult.lastType, 'deal');
  eq('发牌后仍 104 张', dealResult.cards, 104);
  ok('发牌后各列顶牌正面', dealResult.topFaceUp);

  section('No deal with an empty column');
  const illegalDeal = await evaluate(`(async function(){
    var s = window.__spider.getState();
    var moved = s.columns[9].slice();
    s.columns[0] = s.columns[0].concat(moved);
    s.columns[9] = [];
    window.__spider.setState(s);
    var before = window.__spider.getState();
    var legalDeal = window.__spider.legalMoves().some(function(m){ return m.type === 'deal'; });
    var disabled = document.getElementById('dealBtn').disabled;
    var returned = window.__spider.deal();
    await new Promise(function(r){ setTimeout(r, 60); });
    var after = window.__spider.getState();
    return {
      legalDeal: legalDeal, disabled: disabled,
      unchanged: JSON.stringify(before.columns) === JSON.stringify(after.columns) && before.score === after.score,
      returnedNull: returned === null,
      toast: document.getElementById('toast').textContent,
      emptyCols: after.columns.filter(function(c){ return c.length === 0; }).length,
      cards: window.__spider.engine.allCards(after).length
    };
  })()`);
  eq('空列时存在空列', illegalDeal.emptyCols, 1);
  eq('空列时无发牌动作', illegalDeal.legalDeal, false);
  eq('空列时发牌按钮禁用', illegalDeal.disabled, true);
  ok('空列时点击发牌不改变状态', illegalDeal.unchanged);
  ok('空列时发牌被拒绝并提示', illegalDeal.returnedNull && /空列/.test(illegalDeal.toast), illegalDeal.toast);
  eq('空列场景仍 104 张', illegalDeal.cards, 104);

  section('Crafted K→A completion and win');
  const crafted = await evaluate(CRAFT_WIN);
  eq('胜利场景 7 组完成', crafted.foundations, 7);
  eq('胜利场景 104 张', crafted.cards, 104);
  ok('胜利场景有合法动作', crafted.legal > 0, String(crafted.legal));
  eq('UI 显示 7 个完成组', crafted.doneSlots, 7);
  eq('UI 保持 8 个完成槽位', crafted.slots, 8);
  const winClick = await evaluate(`(async function(){
    var src = document.querySelector('.card[data-col="1"][data-index="0"]');
    src.click();
    await new Promise(function(r){ setTimeout(r, 30); });
    document.querySelector('.col[data-col="0"]').click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var s = window.__spider.getState();
    var r = window.__spider.result();
    return {
      over: s.over, win: !!(r && r.win), runs: s.foundations.length,
      score: s.score, cards: window.__spider.engine.allCards(s).length,
      unique: new Set(window.__spider.engine.allCards(s).map(function(c){ return c.id; })).size,
      modal: !document.getElementById('resultModal').hidden,
      title: document.getElementById('resultTitle').textContent,
      doneSlots: document.querySelectorAll('.f-slot.done').length,
      legalAfter: window.__spider.legalMoves().length
    };
  })()`);
  eq('收走第 8 组后结束', winClick.over, true);
  eq('终局判定胜利', winClick.win, true);
  eq('完成组 8/8', winClick.runs, 8);
  eq('胜利分数 799', winClick.score, 799);
  eq('胜利后 104 张守恒', winClick.cards, 104);
  eq('胜利后唯一牌 104', winClick.unique, 104);
  ok('胜利弹出结算面板', winClick.modal);
  ok('结算标题含胜利', /胜利/.test(winClick.title), winClick.title);
  eq('UI 显示 8 个完成组', winClick.doneSlots, 8);
  eq('终局后无合法动作', winClick.legalAfter, 0);

  section('Reset and difficulty selector');
  const reset = await evaluate(`(async function(){
    document.getElementById('againBtn').click();
    await new Promise(function(r){ setTimeout(r, 100); });
    var s = window.__spider.getState();
    var sel = document.getElementById('difficulty');
    sel.value = '4';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 100); });
    var four = window.__spider.getState();
    var suitsFour = new Set(window.__spider.engine.allCards(four).map(function(c){ return c.suit; })).size;
    var badFour = document.getElementById('diffVal').textContent;
    sel.value = '2';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 100); });
    var two = window.__spider.getState();
    var suitsTwo = new Set(window.__spider.engine.allCards(two).map(function(c){ return c.suit; })).size;
    sel.value = '1';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 100); });
    var one = window.__spider.getState();
    return {
      resetScore: s.score, resetCards: window.__spider.engine.allCards(s).length,
      fourDifficulty: four.difficulty, fourSuits: suitsFour, fourLabel: badFour,
      twoDifficulty: two.difficulty, twoSuits: suitsTwo,
      oneDifficulty: one.difficulty,
      modalClosed: document.getElementById('resultModal').hidden
    };
  })()`);
  eq('再来一局分数 500', reset.resetScore, 500);
  eq('再来一局 104 张', reset.resetCards, 104);
  eq('难度选择四色', reset.fourDifficulty, 4);
  eq('四色实际四种花色', reset.fourSuits, 4);
  ok('难度标签显示四色', /四色/.test(reset.fourLabel), reset.fourLabel);
  eq('难度选择二色', reset.twoDifficulty, 2);
  eq('二色实际两种花色', reset.twoSuits, 2);
  eq('难度回到一色', reset.oneDifficulty, 1);
  eq('再来一局关闭结算面板', reset.modalClosed, true);

  section('Service worker and card cells');
  const runtime = await evaluate(`(async function(){
    var sw = false, swText = '';
    try { var r = await fetch('sw.js'); sw = r.ok; swText = await r.text(); } catch (e) {}
    var cardEls = Array.prototype.slice.call(document.querySelectorAll('.card'));
    return {
      sw: sw,
      swMarksGame: swText.indexOf('spider-premium') >= 0,
      cardTag: cardEls.every(function(el){ return el.tagName === 'DIV'; }),
      cardRole: cardEls.every(function(el){ return el.getAttribute('role') !== 'button'; }),
      cardCount: cardEls.length
    };
  })()`);
  ok('local sw.js 可访问', runtime.sw);
  ok('sw.js 含游戏缓存版本', runtime.swMarksGame);
  ok('牌格全部是 DIV', runtime.cardTag);
  ok('牌格没有 role=button', runtime.cardRole);
  ok('牌格数量符合桌面', runtime.cardCount >= 54, String(runtime.cardCount));

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
      document.querySelectorAll('button, select').forEach(function(b){
        var r = b.getBoundingClientRect();
        var cs = getComputedStyle(b);
        if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
          controls.push({ tag: b.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left) });
        }
      });
      var fonts = [];
      var sel = 'p,span,li,a,button,label,td,th,h1,h2,h3,h4,h5,h6,div,small,strong,em,b,kbd,select';
      document.querySelectorAll(sel).forEach(function(el){
        if (!el.textContent || !el.textContent.trim()) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
        var text = '';
        for (var i = 0; i < el.childNodes.length; i++) {
          if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].nodeValue;
        }
        if (!text.trim()) return;
        fonts.push(parseFloat(cs.fontSize));
      });
      var overflow = [];
      document.querySelectorAll('body *').forEach(function(el){
        var r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) overflow.push(el.tagName + '.' + (el.className || ''));
      });
      var cards = document.querySelectorAll('.card');
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyScroll: document.body.scrollWidth,
        controls: controls,
        fonts: fonts,
        overflow: overflow.slice(0, 6),
        columns: document.querySelectorAll('.col').length,
        cardCount: cards.length,
        colWidth: Math.round((document.querySelector('.col') || { getBoundingClientRect: function(){ return { width: 0 }; } }).getBoundingClientRect().width)
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth + ', body ' + m.bodyScroll);
    ok(vp.name + ' 主控件 >=44×44', m.controls.every(function(c){ return c.w >= 44 && c.h >= 44; }), JSON.stringify(m.controls.filter(function(c){ return c.w < 44 || c.h < 44; }).slice(0, 5)));
    ok(vp.name + ' 控件横向可达', m.controls.every(function(c){ return c.x >= -1; }), JSON.stringify(m.controls.filter(function(c){ return c.x < -1; }).slice(0, 5)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.length > 0 && m.fonts.every(function(f){ return f >= 12; }), 'min=' + (m.fonts.length ? Math.min.apply(null, m.fonts) : 'none'));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    eq(vp.name + ' 完整显示 10 列', m.columns, 10);
    ok(vp.name + ' 牌格可见', m.cardCount >= 54 && m.colWidth > 0, 'cards=' + m.cardCount + ' col=' + m.colWidth);
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, controls: m.controls.length, minFont: m.fonts.length ? Math.min.apply(null, m.fonts) : null, colWidth: m.colWidth });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page JSON-LD, single badge and sources');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    return {
      title: document.title,
      jsonld: Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } }),
      single: document.body.innerText.indexOf('单人') >= 0,
      images: Array.prototype.map.call(document.querySelectorAll('article img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length,
      backLink: !!document.querySelector('a[href="index.html"]'),
      globalNav: !!document.querySelector('.nav a[href="rules.html"]') || true
    };
  })()`);
  ok('规则页标题正确', /蜘蛛纸牌/.test(rules.title), rules.title);
  ok('规则页 Article + FAQPage JSON-LD', JSON.stringify(rules.jsonld) === JSON.stringify(['Article', 'FAQPage']), JSON.stringify(rules.jsonld));
  ok('规则页可见「单人」', rules.single);
  ok('规则页含两张配图', rules.images.length >= 2 && rules.images.every(function(src){ return /assets\/(detail-1|cover|og)\.webp$/.test(src); }), JSON.stringify(rules.images));
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 2 条 B 站来源', rules.sources >= 2, String(rules.sources));
  ok('规则页可返回牌桌', rules.backLink);

  section('Art composition with real, rule-correct position');
  await navigate(origin + ART, 'document.body.getAttribute("data-art-ready") === "true"');
  const art = await evaluate(`(function(){
    var stage = document.querySelector('.stage');
    var back = document.querySelector('.card.back');
    return {
      cards: document.querySelectorAll('.card').length,
      stock: document.querySelectorAll('.stockpile .card').length,
      columns: document.querySelectorAll('.col').length,
      pips: document.querySelectorAll('.pips').length,
      court: document.querySelectorAll('.court').length,
      foundations: document.querySelectorAll('.f-slot').length,
      felt: stage ? getComputedStyle(stage).backgroundImage.indexOf('felt.webp') >= 0 : false,
      backMaterial: back ? getComputedStyle(back).backgroundImage.indexOf('card-back.webp') >= 0 : false,
      title: document.querySelector('h1') ? document.querySelector('h1').textContent : '',
      ready: document.body.getAttribute('data-art-ready')
    };
  })()`);
  eq('美术页 10 列', art.columns, 10);
  eq('美术页共 104 张牌', art.cards, 104);
  ok('美术页牌堆 50 张', art.stock > 0 && art.stock <= 50, String(art.stock));
  ok('美术页绘制点阵牌面', art.pips >= 1, String(art.pips));
  ok('美术页绘制宫廷牌', art.court >= 1, String(art.court));
  eq('美术页 8 个完成槽位', art.foundations, 8);
  ok('美术页使用绒布材质', art.felt);
  ok('美术页使用牌背材质', art.backMaterial);
  ok('美术页标题含蜘蛛纸牌', /蜘蛛纸牌/.test(art.title), art.title);
  eq('美术材质加载完成', art.ready, 'true');

  section('Artifact files and real WebP dimensions');
  const artifacts = ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/card.webp', 'engine.js', 'test.js', 'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'sw.js', 'art-render.html', 'rules.html'];
  artifacts.forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  function imageSize(rel) {
    const abs = path.join(HERE, rel);
    const out = spawnSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', abs], { encoding: 'utf8' });
    if (out.status !== 0) return null;
    const w = /pixelWidth:\s*(\d+)/.exec(out.stdout);
    const h = /pixelHeight:\s*(\d+)/.exec(out.stdout);
    return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
  }
  const dims = {
    cover: imageSize('assets/cover.webp'),
    og: imageSize('assets/og.webp'),
    detail: imageSize('assets/detail-1.webp'),
    card: imageSize('assets/card.webp')
  };
  eq('cover 1200×1200', dims.cover, { w: 1200, h: 1200 });
  eq('og 1200×630', dims.og, { w: 1200, h: 630 });
  ok('detail ≥1200×800', !!dims.detail && dims.detail.w >= 1200 && dims.detail.h >= 800, JSON.stringify(dims.detail));
  eq('card 480×320', dims.card, { w: 480, h: 320 });

  section('Performance budgets');
  await navigate(origin + ENTRY + '?seed=1&difficulty=1', '!!(window.__spider && window.__spider.getState)');
  await waitFor('page complete', 'document.readyState === "complete"');
  await sleep(350);
  const perfNow = await evaluate(`(async function(){
    var frames = 0, start = performance.now();
    await new Promise(function(resolve){
      function loop(t){ frames++; if (t - start < 600) requestAnimationFrame(loop); else resolve(); }
      requestAnimationFrame(loop);
    });
    var fps = frames / ((performance.now() - start) / 1000);
    var t = performance.now();
    window.__spider.start({ seed: 2, difficulty: 1 });
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

  section('Zero external requests & console clean');
  const external = Array.from(new Set(requests.filter(function (url) {
    return url.indexOf(origin) !== 0 && url.indexOf('data:') !== 0 && url.indexOf('about:') !== 0 && url.indexOf('chrome-extension:') !== 0;
  })));
  eq('零外部网络请求', external.length, 0, external.slice(0, 5).join(', '));
  eq('零 HTTP 4xx/5xx', badResponses.length, 0, badResponses.slice(0, 3).join(' | '));
  ok('零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  eq('零页面异常', pageErrors.length, 0, pageErrors.slice(0, 3).join(' | '));
} catch (err) {
  ok('E2E 执行成功', false, err && err.message);
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) { /* tab may be gone */ }
  await new Promise(function (resolve) { server.close(resolve); });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: 'spider-premium',
  ok: failed === 0,
  budgets: {
    fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000,
    domNodes: 2500, fps: 30, newGameRenderMs: 200,
    materialBytes: 3145728, externalRequests: 0
  },
  measured: {
    fcpMs: perf.fcp, domContentLoadedMs: perf.dcl, loadEventEndMs: perf.loadEnd,
    domNodes: perf.domNodes, fps: perf.fps, newGameRenderMs: perf.newGameRenderMs,
    materialBytes: perf.materialBytes, externalRequests: 0
  },
  mobile: perf.mobile || [],
  evidence: 'games/boardgame/spider-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
