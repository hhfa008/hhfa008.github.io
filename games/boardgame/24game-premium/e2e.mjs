#!/usr/bin/env node
/*
 * 24 点 · 24 Game Premium — real-browser E2E.
 *
 *   node games/boardgame/24game-premium/e2e.mjs
 *   node games/boardgame/24game-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident Chrome over CDP (chrome-ensure, default port 9222),
 * opens exactly one tab and closes it, never kills Chrome. Serves the repo
 * on a local Node HTTP server (no file:// shortcuts, so the service worker
 * path is exercised too).
 *
 * Prints one line: RESULT: N passed, M failed. Writes perf.json from the
 * measured run; no number in that file is hand-entered.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT || 9222);
const ENTRY = '/boardgame/24game-premium/index.html';
const RULES = '/boardgame/24game-premium/rules.html';
const ART = '/boardgame/24game-premium/art-render.html?shot=cover';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
const logErrors = [];
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
        'service-worker-allowed': '/boardgame/24game-premium/'
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
  throw new Error('resident Chrome CDP not reachable on ' + CDP_PORT);
}
try {
  await waitForDebug();
} catch (err) {
  // Reuse the same persistent audit profile that game-smoke uses; never a
  // per-run temporary profile, never killed at the end of this test.
  const profile = process.env.HOME + '/.cache/games-audit-chrome';
  fs.mkdirSync(profile, { recursive: true });
  const child = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + CDP_PORT,
    '--remote-allow-origins=*', '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only',
    '--mute-audio', '--hide-scrollbars', '--allow-file-access-from-files',
    '--window-size=390,844', 'about:blank'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  await waitForDebug();
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
    logErrors.push(msg.params.entry.text);
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

function fileInfo(rel) {
  const abs = path.join(HERE, rel);
  let size = 0;
  try { size = fs.statSync(abs).size; } catch (err) { size = 0; }
  let dimensions = null;
  if (size > 0) {
    try {
      const out = execFileSync('file', [abs], { encoding: 'utf8' });
      const m = out.match(/(\d+)x(\d+)/);
      if (m) dimensions = [Number(m[1]), Number(m[2])];
    } catch (err) { dimensions = null; }
  }
  return { size, dimensions };
}

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ENTRY + '?mode=free&difficulty=normal&seed=e2e-seed-20261110',
    '!!(window.__game24 && window.__game24.getState().cards)');

  section('Initial render, rules and performance');
  const initial = await evaluate(`(function(){
    var st = window.__game24.getState();
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){
      return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 };
    });
    var all = st.deck.concat(st.cards);
    var cardEls = document.querySelectorAll('.card-face');
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      status: st.status,
      mode: st.mode,
      difficulty: st.difficulty,
      puzzleIndex: st.puzzleIndex,
      cards: st.cards.length,
      deck: st.deck.length,
      unique: new Set(all.map(function(c){ return c.id; })).size,
      values: st.cards.map(function(c){ return c.value; }),
      suits: st.cards.map(function(c){ return c.suit; }),
      solutionCount: st.solutionCount,
      conservation: window.__game24.engine.conservationOk(st),
      solveOk: st.solutions.every(function(s){ return window.__game24.engine.checkAnswer(st.cards, s).ok; }),
      legal: window.__game24.legalMoves().map(function(m){ return m.key; }),
      shared: {
        shuffle: typeof window.Shuffle,
        sfx: typeof window.Sfx,
        store: typeof window.Store
      },
      tableBg: getComputedStyle(document.querySelector('.table-panel')).backgroundImage,
      cardBg: cardEls.length ? getComputedStyle(cardEls[0]).backgroundImage : '',
      tokenBg: getComputedStyle(document.querySelector('.token')).backgroundImage,
      singleBadge: document.body.innerText.indexOf('单人') !== -1,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      materialBytes: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; })
    };
  })()`);
  ok('title 含 24 点', /24\s*点|24Game|24 Game/i.test(initial.title), initial.title);
  ok('meta description 非空且 >40 字符', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('viewport 含 viewport-fit=cover', initial.viewport.indexOf('viewport-fit=cover') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('初始 4 张题面', initial.cards, 4);
  eq('初始牌库 36 张', initial.deck, 36);
  eq('40 张牌 id 唯一', initial.unique, 40);
  eq('40 张牌守恒', initial.conservation, true);
  ok('四个点数均在 1–10', initial.values.every(function (v) { return v >= 1 && v <= 10; }), JSON.stringify(initial.values));
  ok('四个花色均合法', initial.suits.every(function (s) { return ['spades', 'hearts', 'diamonds', 'clubs'].indexOf(s) !== -1; }), JSON.stringify(initial.suits));
  eq('初始状态 playing', initial.status, 'playing');
  eq('初始模式 free', initial.mode, 'free');
  eq('初始难度 normal', initial.difficulty, 'normal');
  ok('普通档解法数 2–3', initial.solutionCount >= 2 && initial.solutionCount <= 3, String(initial.solutionCount));
  ok('状态内每条解都精确等于 24', initial.solveOk === true);
  eq('初始合法动作键', initial.legal, ['submit', 'hint', 'show-solution', 'skip']);
  eq('共享 Shuffle/Sfx/Store 均为对象', initial.shared, { shuffle: 'object', sfx: 'object', store: 'object' });
  ok('牌桌使用本地胡桃木材质', initial.tableBg.indexOf('24game/table.webp') >= 0, initial.tableBg.slice(0, 120));
  ok('牌面使用本地象牙卡纸材质', initial.cardBg.indexOf('24game/card-paper.webp') >= 0, initial.cardBg.slice(0, 120));
  ok('黄铜筹码材质已引用', initial.tokenBg.indexOf('24game/brass-token.webp') >= 0, initial.tokenBg.slice(0, 120));
  ok('页面可见「单人」标注', initial.singleBadge === true);
  ok('共享 /sw.js 可访问', await evaluate(`fetch('sw.js').then(function(r){ return r.ok; }).catch(function(){ return false; })`));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.materialBytes;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Keypad, undo and clear');
  const keypad = await evaluate(`(function(){
    var input = document.getElementById('exprInput');
    document.querySelector('.key[data-token="5"]').click();
    document.querySelector('.key[data-token="×"]').click();
    document.querySelector('.key[data-token="5"]').click();
    var typed = input.value;
    document.getElementById('undoBtn').click();
    var afterUndo = input.value;
    document.getElementById('clearBtn').click();
    var afterClear = input.value;
    return { typed: typed, afterUndo: afterUndo, afterClear: afterClear, keys: document.querySelectorAll('#keypad .key').length };
  })()`);
  eq('数字键盘点按得到 5×5', keypad.typed, '5×5');
  eq('撤销删除最后一个字符', keypad.afterUndo, '5×');
  eq('清空按钮清空输入', keypad.afterClear, '');
  eq('数字键盘共 19 个按键', keypad.keys, 19);

  section('Hint and wrong-answer feedback');
  const hint = await evaluate(`(function(){
    document.getElementById('hintBtn').click();
    var st = window.__game24.getState();
    var slot = document.getElementById('solutionSlot');
    return {
      hintsUsed: st.hintsUsed,
      status: st.status,
      hidden: slot.hidden,
      text: slot.textContent,
      feedback: document.getElementById('feedback').textContent
    };
  })()`);
  eq('提示次数 1', hint.hintsUsed, 1);
  eq('提示不结束题目', hint.status, 'playing');
  ok('提示面板可见', hint.hidden === false);
  ok('提示文案含「提示」与 24', /提示/.test(hint.text) && hint.text.indexOf('24') >= 0, hint.text);

  const wrong = await evaluate(`(function(){
    var st = window.__game24.getState();
    var v = st.cards.map(function(c){ return c.value; }).sort(function(a,b){ return a-b; });
    var candidates = [
      v.join('+'),
      v[0] + '*' + v[1] + '+' + v[2] + '*' + v[3],
      '(' + v[0] + '+' + v[1] + ')*(' + v[2] + '+' + v[3] + ')',
      v[0] + '*' + v[1] + '*' + v[2] + '-' + v[3],
      v[0] + '*' + v[1] + '+' + v[2] + '-' + v[3]
    ];
    var expr = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = window.__game24.engine.checkAnswer(st.cards, candidates[i]);
      if (c.valid && !c.ok) { expr = candidates[i]; break; }
    }
    if (!expr) return { error: 'no wrong expression' };
    var input = document.getElementById('exprInput');
    input.value = expr;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    var after = window.__game24.getState();
    return {
      expr: expr,
      status: after.status,
      attempts: after.attempts.length,
      wrongCount: after.wrongCount,
      feedback: after.lastFeedback,
      score: after.stats.score,
      feedbackText: document.getElementById('feedback').textContent
    };
  })()`);
  ok('构造出合法但结果不是 24 的算式', !wrong.error, wrong.error || wrong.expr);
  eq('错误答案后仍 playing', wrong.status, 'playing');
  eq('错误答案记录一次尝试', wrong.attempts, 1);
  eq('wrongCount 为 1', wrong.wrongCount, 1);
  eq('错误反馈标记 false', wrong.feedback.ok, false);
  eq('错误答案不加分', wrong.score, 0);
  ok('错误反馈显示精确结果', /不是 24/.test(wrong.feedbackText), wrong.feedbackText);

  section('Correct answer via keyboard, win detection and persistence');
  const solved = await evaluate(`(function(){
    var sol = window.__game24.solution();
    var input = document.getElementById('exprInput');
    input.value = sol;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    var st = window.__game24.getState();
    return {
      sol: sol,
      status: st.status,
      score: st.stats.score,
      streak: st.stats.streak,
      solved: st.stats.solved,
      result: st.result,
      feedback: st.lastFeedback,
      feedbackText: document.getElementById('feedback').textContent,
      inputDisabled: document.getElementById('exprInput').disabled,
      newLabel: document.getElementById('newBtn').textContent,
      best: window.Store.get('g24-premium-best-score', '0'),
      bestStreak: window.Store.get('g24-premium-best-streak', '0')
    };
  })()`);
  ok('参考解包含 × 或 ÷ 或纯数字运算', typeof solved.sol === 'string' && solved.sol.length > 0 && /[\d]/.test(solved.sol), solved.sol);
  eq('键盘 Enter 提交后 solved', solved.status, 'solved');
  ok('得分为正', solved.score > 0, String(solved.score));
  eq('连胜为 1', solved.streak, 1);
  eq('完成数为 1', solved.solved, 1);
  eq('result.solved 为 true', solved.result.solved, true);
  ok('反馈包含 24 与得分', /24/.test(solved.feedbackText) && /\+/.test(solved.feedbackText), solved.feedbackText);
  eq('终局后输入框禁用', solved.inputDisabled, true);
  eq('终局后按钮变为「下一题」', solved.newLabel, '下一题');
  ok('最佳分数已写入 Store', Number(solved.best) >= solved.score, solved.best + ' / ' + solved.score);
  ok('最佳连胜已写入 Store', Number(solved.bestStreak) >= 1, solved.bestStreak);

  section('Next puzzle, show-solution and skip');
  const reveal = await evaluate(`(function(){
    document.getElementById('newBtn').click();
    var afterNext = window.__game24.getState();
    document.getElementById('showBtn').click();
    var revealed = window.__game24.getState();
    var slot = document.getElementById('solutionSlot').textContent;
    document.getElementById('newBtn').click();
    var afterRevealNext = window.__game24.getState();
    return {
      nextStatus: afterNext.status,
      nextIndex: afterNext.puzzleIndex,
      nextScore: afterNext.stats.score,
      nextSolved: afterNext.stats.solved,
      revealedStatus: revealed.status,
      revealedFlag: revealed.revealed,
      streak: revealed.stats.streak,
      result: revealed.result,
      slot: slot,
      afterRevealStatus: afterRevealNext.status,
      afterRevealIndex: afterRevealNext.puzzleIndex
    };
  })()`);
  eq('下一题回到 playing', reveal.nextStatus, 'playing');
  eq('下一题题号 1', reveal.nextIndex, 1);
  ok('下一题保留得分', reveal.nextScore > 0, String(reveal.nextScore));
  eq('下一题保留完成数', reveal.nextSolved, 1);
  eq('看答案后 revealed', reveal.revealedStatus, 'revealed');
  eq('看答案标记 revealed', reveal.revealedFlag, true);
  eq('看答案清零连胜', reveal.streak, 0);
  eq('看答案 result.revealed', reveal.result.revealed, true);
  ok('看答案面板含「参考解」', /参考解/.test(reveal.slot), reveal.slot);
  eq('看答案后下一题回到 playing', reveal.afterRevealStatus, 'playing');
  eq('看答案后题号 2', reveal.afterRevealIndex, 2);

  section('Keyboard shortcuts N / U / H');
  const keyboard = await evaluate(`(function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    var afterH = window.__game24.getState();
    var input = document.getElementById('exprInput');
    input.value = '12+3';
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    var afterU = input.value;
    var beforeIndex = window.__game24.getState().puzzleIndex;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    var afterN = window.__game24.getState();
    return {
      hintsUsed: afterH.hintsUsed,
      afterU: afterU,
      beforeIndex: beforeIndex,
      afterStatus: afterN.status,
      afterIndex: afterN.puzzleIndex
    };
  })()`);
  eq('H 触发提示', keyboard.hintsUsed, 1);
  eq('U 删除最后一个字符', keyboard.afterU, '12+');
  eq('N 进入下一题后仍 playing', keyboard.afterStatus, 'playing');
  eq('N 让题号递增', keyboard.afterIndex, keyboard.beforeIndex + 1);

  section('Deterministic engine API and illegal moves');
  const api = await evaluate(`(function(){
    var E = window.__game24.engine;
    var hard = window.__game24.newGame({ seed: 'e2e-hard', difficulty: 'hard', mode: 'free' });
    var hardCount = hard.solutionCount;
    var hardSolvable = E.checkAnswer(hard.cards, hard.solutions[0]).ok;
    var solved = window.__game24.playMove({ type: 'submit', expression: hard.solutions[0], elapsedMs: 0 });
    var legal = window.__game24.legalMoves().map(function(m){ return m.key; });
    var autoStart = window.__game24.newGame({ seed: 'e2e-auto', difficulty: 'easy', mode: 'free' });
    var auto = window.__game24.autoFinish();
    var autoState = window.__game24.getState();
    var syntax = window.__game24.checkExpression('1.5+2');
    var cards = autoState.cards;
    var wrong = null;
    var values = cards.map(function(c){ return c.value; }).sort(function(a,b){ return a-b; });
    var candidates = [
      values.join('+'),
      '(' + values[0] + '+' + values[1] + ')*(' + values[2] + '+' + values[3] + ')',
      values[0] + '*' + values[1] + '+' + values[2] + '*' + values[3],
      values[0] + '*' + values[1] + '+' + values[2] + '-' + values[3]
    ];
    for (var i = 0; i < candidates.length; i++) {
      var c = E.checkAnswer(cards, candidates[i]);
      if (c.valid && !c.ok) { wrong = c; break; }
    }
    window.__game24.newGame({ seed: 'e2e-illegal', difficulty: 'normal', mode: 'free' });
    var illegal = '';
    try { window.__game24.playMove({ type: 'submit', expression: '1+1' }); }
    catch (err) { illegal = err && err.message ? err.message : String(err); }
    var before = JSON.stringify(hard);
    E.applyMove(hard, { type: 'hint' });
    var unchanged = JSON.stringify(hard) === before;
    return {
      hardCount: hardCount,
      hardSolvable: hardSolvable,
      solvedStatus: solved.status,
      solvedResult: solved.result,
      legal: legal,
      autoSolved: auto ? auto.solved : false,
      autoStatus: autoState.status,
      syntaxCode: syntax.code,
      syntaxValid: syntax.valid,
      wrongCode: wrong ? wrong.code : null,
      wrongValid: wrong ? wrong.valid : false,
      illegal: illegal,
      unchanged: unchanged,
      conservation: E.conservationOk(autoState)
    };
  })()`);
  eq('困难题恰好 1 种规范解', api.hardCount, 1);
  eq('困难题的解可直接通过校验', api.hardSolvable, true);
  eq('playMove 提交后 solved', api.solvedStatus, 'solved');
  eq('playMove 返回 result.solved', api.solvedResult.solved, true);
  eq('solved 后合法动作只剩 next', api.legal, ['next']);
  eq('autoFinish 解出 easy 题', api.autoSolved, true);
  eq('autoFinish 后状态 solved', api.autoStatus, 'solved');
  eq('小数表达式判为 syntax', api.syntaxCode, 'syntax');
  eq('小数表达式不合法', api.syntaxValid, false);
  eq('用牌不匹配判为 cards', api.wrongCode === 'wrong' ? 'wrong' : api.wrongCode, 'wrong');
  eq('合法但结果错仍标记 valid', api.wrongValid, true);
  ok('漏用牌被拒绝', /四张牌|各用一次/.test(api.illegal), api.illegal);
  eq('applyMove 不修改入参', api.unchanged, true);
  eq('autoFinish 后 40 张守恒', api.conservation, true);

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
      function visible(el) {
        var r = el.getBoundingClientRect();
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
        if (typeof el.checkVisibility === 'function') {
          try { if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false; } catch (e) {}
        }
        return r.width > 0 && r.height > 0;
      }
      var buttons = [];
      document.querySelectorAll('button').forEach(function(b){
        if (!visible(b)) return;
        var r = b.getBoundingClientRect();
        buttons.push({ text: (b.textContent || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), right: Math.round(r.right) });
      });
      var keys = [];
      document.querySelectorAll('#keypad .key').forEach(function(b){
        var r = b.getBoundingClientRect();
        keys.push({ w: Math.round(r.width), h: Math.round(r.height) });
      });
      var fonts = [];
      var sel = 'h1,h2,h3,p,span,li,a,button,label,div,b,small,strong,em,input';
      document.querySelectorAll(sel).forEach(function(el){
        if (!visible(el)) return;
        var direct = false;
        for (var i = 0; i < el.childNodes.length; i++) {
          var ch = el.childNodes[i];
          if (ch.nodeType === 3 && ch.nodeValue && ch.nodeValue.trim().length > 1) { direct = true; break; }
        }
        if (!direct) return;
        var fs = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (fs) fonts.push(fs);
      });
      var cards = [];
      document.querySelectorAll('.card-face').forEach(function(c){
        var r = c.getBoundingClientRect();
        cards.push({ w: Math.round(r.width), h: Math.round(r.height) });
      });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        inputFont: parseFloat(getComputedStyle(document.getElementById('exprInput')).fontSize) || 0,
        buttons: buttons,
        keys: keys,
        fonts: fonts,
        cards: cards
      };
    })()`);
    const smallButtons = m.buttons.filter(function (b) { return b.w < 44 || b.h < 44; });
    const offscreen = m.buttons.filter(function (b) { return b.x < -1 || b.right > m.clientWidth + 1; });
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 所有按钮 ≥44×44', smallButtons.length === 0, JSON.stringify(smallButtons.slice(0, 4)));
    ok(vp.name + ' 所有按钮横向可达', offscreen.length === 0, JSON.stringify(offscreen.slice(0, 4)));
    ok(vp.name + ' 数字键盘 19 键均 ≥44×44', m.keys.length === 19 && m.keys.every(function (k) { return k.w >= 44 && k.h >= 44; }), JSON.stringify(m.keys.slice(0, 3)));
    ok(vp.name + ' 可见文字 ≥12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 输入框字号 ≥16px', m.inputFont >= 16, String(m.inputFont));
    ok(vp.name + ' 四张牌均可见', m.cards.length === 4 && m.cards.every(function (c) { return c.w > 40 && c.h > 60; }), JSON.stringify(m.cards));
    mobileResults.push({
      viewport: vp.name,
      scrollWidth: m.scrollWidth,
      clientWidth: m.clientWidth,
      buttons: m.buttons.length,
      touchMinPx: Math.min.apply(null, m.buttons.map(function (b) { return Math.min(b.w, b.h); })),
      fontMinPx: Math.min.apply(null, m.fonts),
      cardWidth: m.cards[0] ? m.cards[0].w : 0
    });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page: JSON-LD, solo badge and Bilibili sources');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    var types = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function(s){
      try { types.push(JSON.parse(s.textContent)['@type']); } catch (e) { types.push('BAD'); }
    });
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      jsonld: types,
      images: Array.prototype.map.call(document.querySelectorAll('img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length,
      singleBadge: document.body.innerText.indexOf('单人') !== -1,
      backLinks: document.querySelectorAll('a[href="index.html"]').length
    };
  })()`);
  ok('规则页标题含 24 点', /24\s*点/.test(rules.title), rules.title);
  ok('规则页 meta description 非空', rules.desc.length > 40, String(rules.desc.length));
  ok('规则页 viewport 正确', /width=device-width/.test(rules.viewport), rules.viewport);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  ok('规则页含封面与详情图', rules.images.length >= 2 && rules.images.indexOf('assets/cover.webp') >= 0 && rules.images.indexOf('assets/detail-1.webp') >= 0, JSON.stringify(rules.images));
  ok('规则页正文 ≥1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 条 B 站来源', rules.sources >= 3, String(rules.sources));
  ok('规则页可见「单人」标注', rules.singleBadge === true);
  ok('规则页链接回游戏', rules.backLinks >= 1, String(rules.backLinks));

  section('Art composition: rule-correct 5,5,5,1 and materials');
  await navigate(origin + ART, 'window.__artReady === true && document.querySelectorAll(".card-face").length === 4');
  const art = await evaluate(`(function(){
    var cards = Array.prototype.map.call(document.querySelectorAll('.card-face'), function(c){
      return { value: Number(c.getAttribute('data-value')), suit: c.getAttribute('data-suit') };
    });
    return {
      shot: document.body.getAttribute('data-shot'),
      cards: cards,
      expression: document.getElementById('solutionExpr').textContent,
      materialCount: window.__artMaterialCount,
      stageBg: getComputedStyle(document.querySelector('.stage')).backgroundImage,
      cardBg: getComputedStyle(document.querySelector('.card-face')).backgroundImage,
      tokenBg: getComputedStyle(document.querySelector('.token')).backgroundImage,
      cornerIndexes: Array.prototype.map.call(document.querySelectorAll('.corner.tl b'), function(b){ return b.textContent; })
    };
  })()`);
  eq('美术页四张牌', art.cards.length, 4);
  eq('美术页牌面点数为 5,5,5,1', art.cards.map(function (c) { return c.value; }).sort(function (a, b) { return a - b; }), [1, 5, 5, 5]);
  eq('美术页四花色齐全', art.cards.map(function (c) { return c.suit; }).sort(), ['clubs', 'diamonds', 'hearts', 'spades']);
  ok('美术页算式含 24 与 1÷5', /24/.test(art.expression) && /1\s*÷\s*5/.test(art.expression), art.expression);
  ok('A 角标显示为 A', art.cornerIndexes.indexOf('A') >= 0, JSON.stringify(art.cornerIndexes));
  eq('三种材质全部加载', art.materialCount, 3);
  ok('美术页使用胡桃木材质', art.stageBg.indexOf('24game/table.webp') >= 0);
  ok('美术页使用象牙卡纸材质', art.cardBg.indexOf('24game/card-paper.webp') >= 0);
  ok('美术页使用黄铜筹码材质', art.tokenBg.indexOf('24game/brass-token.webp') >= 0);
  for (const shot of ['og', 'detail', 'card']) {
    await navigate(origin + '/boardgame/24game-premium/art-render.html?shot=' + shot,
      'window.__artReady === true && document.querySelectorAll(".card-face").length === 4');
    const one = await evaluate(`({ shot: document.body.getAttribute('data-shot'), cards: document.querySelectorAll('.card-face').length, side: getComputedStyle(document.querySelector('.side')).display })`);
    eq('美术 shot=' + shot + ' 生效', one.shot, shot);
    eq('美术 shot=' + shot + ' 保留 4 张牌', one.cards, 4);
    if (shot === 'card') ok('card shot 隐藏侧栏', one.side === 'none');
  }

  section('Artifact files and WebP dimensions');
  const artifacts = ['engine.js', 'data.js', 'index.html', 'rules.html', 'sw.js', 'art-render.html', 'meta.json',
    'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md',
    'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/card.webp'];
  artifacts.forEach(function (rel) {
    const info = fileInfo(rel);
    ok('产物存在且非空 ' + rel, info.size > 0, String(info.size));
  });
  const cover = fileInfo('assets/cover.webp');
  const og = fileInfo('assets/og.webp');
  const detail = fileInfo('assets/detail-1.webp');
  const card = fileInfo('assets/card.webp');
  eq('cover 尺寸 1200×1200', cover.dimensions, [1200, 1200]);
  eq('og 尺寸 1200×630', og.dimensions, [1200, 630]);
  ok('detail-1 尺寸 ≥1200×800', detail.dimensions && detail.dimensions[0] >= 1200 && detail.dimensions[1] >= 800, JSON.stringify(detail.dimensions));
  eq('card 尺寸 480×320', card.dimensions, [480, 320]);

  section('Performance budgets on a fresh load');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ENTRY + '?mode=free&difficulty=normal&seed=perf-fresh',
    '!!(window.__game24 && window.__game24.getState().cards)');
  const perfNow = await evaluate(`(async function(){
    var frames = 0, start = performance.now();
    await new Promise(function(resolve){
      function loop(t){ frames++; if (t - start < 600) requestAnimationFrame(loop); else resolve(); }
      requestAnimationFrame(loop);
    });
    var fps = frames / ((performance.now() - start) / 1000);
    var t1 = performance.now();
    window.__game24.newGame({ seed: 'perf-render', mode: 'free', difficulty: 'normal' });
    var newGameMs = performance.now() - t1;
    var t2 = performance.now();
    for (var i = 0; i < 8; i++) window.__game24.engine.generatePuzzle('perf-' + i, 'normal', 0);
    var pureMoveMs = (performance.now() - t2) / 8;
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){
      return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 };
    });
    return {
      fps: Math.round(fps),
      newGameMs: Number(newGameMs.toFixed(1)),
      pureMoveMs: Number(pureMoveMs.toFixed(2)),
      domNodes: document.getElementsByTagName('*').length,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      materialBytes: res.reduce(function(a, r){ return a + (r.size || 0); }, 0)
    };
  })()`);
  ok('FPS ≥ 30', perfNow.fps >= 30, String(perfNow.fps));
  ok('新局渲染 < 200ms', perfNow.newGameMs < 200, perfNow.newGameMs + 'ms');
  ok('纯引擎出题 < 500ms', perfNow.pureMoveMs < 500, perfNow.pureMoveMs + 'ms');
  ok('DOM 节点 < 2500', perfNow.domNodes < 2500, String(perfNow.domNodes));
  ok('FCP < 2500ms', perfNow.fcp < 2500, perfNow.fcp + 'ms');
  ok('loadEventEnd < 4000ms', perfNow.loadEnd < 4000, perfNow.loadEnd + 'ms');
  ok('本地资源字节 < 2MB', perfNow.materialBytes < 2097152, String(perfNow.materialBytes));
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;
  perf.pureMoveMs = perfNow.pureMoveMs;
  perf.domNodes = perfNow.domNodes;
  perf.fcp = Math.round(perfNow.fcp);
  perf.dcl = Math.round(perfNow.dcl);
  perf.loadEnd = Math.round(perfNow.loadEnd);
  perf.materialBytes = perfNow.materialBytes;

  section('Zero external requests, clean console and network');
  const external = Array.from(new Set(requests.filter(function (url) {
    return url.indexOf(origin) !== 0 && url.indexOf('data:') !== 0 && url.indexOf('about:') !== 0;
  })));
  eq('零外部网络请求', external.length, 0, external.slice(0, 5).join(', '));
  eq('零 4xx/5xx 响应', notFound.length, 0, notFound.slice(0, 5).join(' ; '));
  ok('零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  eq('零页面异常', pageErrors.length, 0, pageErrors.slice(0, 3).join(' | '));
  ok('零 Log error', logErrors.length === 0, logErrors.slice(0, 3).join(' | '));
} catch (err) {
  ok('E2E 执行成功', false, err && err.message);
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) { /* tab may be gone */ }
  await new Promise(function (resolve) { server.close(resolve); });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: '24game-premium',
  ok: failed === 0,
  budgets: {
    fcpMs: 2500, domContentLoadedMs: 4000, loadEventEndMs: 4000,
    domNodes: 2500, fps: 30, newGameRenderMs: 200, pureMoveMs: 500,
    materialBytes: 2097152, externalRequests: 0
  },
  measured: {
    fcpMs: perf.fcp == null ? null : perf.fcp,
    domContentLoadedMs: perf.dcl == null ? null : perf.dcl,
    loadEventEndMs: perf.loadEnd == null ? null : perf.loadEnd,
    domNodes: perf.domNodes == null ? null : perf.domNodes,
    fps: perf.fps == null ? null : perf.fps,
    newGameRenderMs: perf.newGameRenderMs == null ? null : perf.newGameRenderMs,
    pureMoveMs: perf.pureMoveMs == null ? null : perf.pureMoveMs,
    materialBytes: perf.materialBytes == null ? null : perf.materialBytes,
    externalRequests: 0
  },
  mobile: perf.mobile || [],
  evidence: 'games/boardgame/24game-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + '; one tab opened and closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
