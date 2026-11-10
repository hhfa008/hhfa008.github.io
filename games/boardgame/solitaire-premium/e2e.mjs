#!/usr/bin/env node
/*
 * Solitaire premium — single-client browser E2E.
 *
 *   node games/boardgame/solitaire-premium/e2e.mjs
 *   node games/boardgame/solitaire-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end; never kills Chrome.
 *
 * Verifies: real UI deal, draw, undo, hint, auto-send, a click-to-win flow,
 * new-game keyboard shortcut, persistence, rules page JSON-LD, local art,
 * 390x844 / 320x568 mobile layout (no overflow, >=44px controls, >=12px type),
 * performance budgets, zero external requests and no console/page errors.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AUDIT_CDP_PORT || 9222);
const ENTRY = '/boardgame/solitaire-premium/index.html';
const RULES = '/boardgame/solitaire-premium/rules.html';

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
const http404 = [];
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
function section(title) { console.log('\n[STEP] ' + title); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
        'service-worker-allowed': '/boardgame/solitaire-premium/'
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
  console.warn('chrome-ensure unavailable; attaching to CDP port ' + CDP_PORT);
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
    http404.push(msg.params.response.status + ' ' + msg.params.response.url);
  }
});
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Log.enable');
try {
  await cdp.send('Storage.clearDataForOrigin', { origin: origin, storageTypes: 'local_storage,service_workers,cache_storage' });
} catch (err) { /* best effort */ }

async function evaluate(expression) {
  const out = await cdp.send('Runtime.evaluate', {
    expression,
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

const CRAFT_JS = `
  function craft(rank, suit, up) {
    var suits = { '\\u2660': 0, '\\u2665': 1, '\\u2666': 2, '\\u2663': 3 };
    var values = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
    var si = suits[suit];
    return { id: rank + suit, rank: rank, value: values[rank], suit: suit, suitIndex: si, red: si === 1 || si === 2, faceUp: up !== false };
  }
  function base() {
    return { version: window.__solitaire.engine.VERSION, seed: 1, drawMode: 1, status: 'playing',
      stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []],
      moves: 0, score: 0, recycles: 0, wonAt: null, history: [] };
  }
`;

try {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate(origin + ENTRY + '?seed=20261110', '!!(window.__solitaire && window.__solitaire.getState())');
  await waitFor('page complete', 'document.readyState === "complete"');
  await sleep(350);

  section('Initial render and performance');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var s = window.__solitaire.getState();
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      tableau: s.tableau.map(function(p){ return p.length; }),
      stock: s.stock.length,
      waste: s.waste.length,
      foundations: s.foundations.map(function(p){ return p.length; }),
      status: s.status,
      cards: s.stock.length + s.waste.length + s.tableau.reduce(function(a,p){return a+p.length;},0),
      badge: (document.getElementById('singleBadge') || {}).textContent || '',
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      felt: getComputedStyle(document.body).backgroundImage,
      back: getComputedStyle(document.querySelector('.emblem')).backgroundImage,
      cardPaper: getComputedStyle(document.querySelector('.card.face')).backgroundImage
    };
  })()`);
  ok('title 含接龙/Solitaire', /接龙|Solitaire/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('初始七列 1..7', initial.tableau, [1, 2, 3, 4, 5, 6, 7]);
  eq('初始牌堆 24', initial.stock, 24);
  eq('初始弃牌堆空', initial.waste, 0);
  eq('初始基础堆空', initial.foundations, [0, 0, 0, 0]);
  eq('初始 52 张牌守恒', initial.cards, 52);
  eq('初始状态 playing', initial.status, 'playing');
  ok('可见「单人」徽章', initial.badge.indexOf('单人') !== -1, initial.badge);
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffleDeck === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  ok('共享存储模块已加载', await evaluate('typeof window.Store === "object" && typeof window.Store.getJSON === "function"'));
  ok('牌桌使用本地毛毡材质', String(initial.felt).indexOf('felt.webp') >= 0);
  ok('牌背使用本地材质', String(initial.back).indexOf('card-back.webp') >= 0);
  ok('牌面使用本地卡纸材质', String(initial.cardPaper).indexOf('card-paper.webp') >= 0);
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  ok('FCP < 2500ms', initial.fcp < 2500, String(Math.round(initial.fcp)) + 'ms');
  ok('loadEventEnd < 4000ms', initial.loadEnd < 4000, String(Math.round(initial.loadEnd)) + 'ms');
  ok('DOM 节点 < 2500', initial.domNodes < 2500, String(initial.domNodes));
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: draw, undo, hint, auto-send');
  const drawFlow = await evaluate(`(async function(){
    ${CRAFT_JS}
    var s = base();
    s.stock = [craft('2','\\u2660'), craft('3','\\u2665'), craft('4','\\u2666')];
    window.__solitaire.setState(s);
    document.getElementById('stock').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var afterDraw = window.__solitaire.getState();
    document.getElementById('undoBtn').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var afterUndo = window.__solitaire.getState();
    return {
      waste: afterDraw.waste.length, stock: afterDraw.stock.length, moves: afterDraw.moves,
      undoWaste: afterUndo.waste.length, undoStock: afterUndo.stock.length,
      undoDisabled: document.getElementById('undoBtn').disabled,
      scoreText: document.getElementById('score').textContent
    };
  })()`);
  eq('点击牌堆翻出一张', drawFlow.waste, 1);
  eq('翻牌后牌堆减一', drawFlow.stock, 2);
  eq('翻牌记一步', drawFlow.moves, 1);
  eq('撤销后弃牌堆清空', drawFlow.undoWaste, 0);
  eq('撤销后牌堆恢复', drawFlow.undoStock, 3);

  const hintFlow = await evaluate(`(async function(){
    ${CRAFT_JS}
    var s = base();
    s.waste = [craft('A','\\u2660')];
    s.tableau[0] = [craft('K','\\u2665')];
    window.__solitaire.setState(s);
    document.getElementById('hintBtn').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    return {
      toast: document.getElementById('toast').textContent,
      toastShown: document.getElementById('toast').classList.contains('show'),
      highlighted: document.querySelectorAll('.hint-from').length,
      target: document.querySelectorAll('.foundation-slot.hint-to').length
    };
  })()`);
  ok('提示按钮给出可读建议', /基础堆/.test(hintFlow.toast), hintFlow.toast);
  ok('提示高亮来源牌', hintFlow.highlighted >= 1, String(hintFlow.highlighted));
  ok('提示高亮目标基础堆', hintFlow.target >= 1, String(hintFlow.target));

  const autoFlow = await evaluate(`(async function(){
    ${CRAFT_JS}
    var s = base();
    s.waste = [craft('A','\\u2660')];
    s.tableau[0] = [craft('A','\\u2665')];
    s.tableau[1] = [craft('A','\\u2666')];
    s.tableau[2] = [craft('A','\\u2663')];
    window.__solitaire.setState(s);
    document.getElementById('autoBtn').click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var st = window.__solitaire.getState();
    return { foundations: st.foundations.map(function(p){ return p.length; }), score: st.score };
  })()`);
  eq('收牌按钮收走四张 A', autoFlow.foundations, [1, 1, 1, 1]);
  ok('收牌计分 +40', autoFlow.score === 40, String(autoFlow.score));

  section('Real UI: click a card to the foundation and win');
  const winFlow = await evaluate(`(async function(){
    ${CRAFT_JS}
    var s = base();
    var suits = ['\\u2660','\\u2665','\\u2666','\\u2663'];
    var labels = ['A','2','3','4','5','6','7','8','9','10','J','Q'];
    for (var si = 0; si < 4; si += 1) {
      for (var v = 0; v < 12; v += 1) s.foundations[si].push(craft(labels[v], suits[si], true));
    }
    s.foundations[1].push(craft('K', suits[1], true));
    s.foundations[2].push(craft('K', suits[2], true));
    s.foundations[3].push(craft('K', suits[3], true));
    s.waste = [craft('K', suits[0], true)];
    window.__solitaire.setState(s);
    var wasteTop = document.querySelector('.waste-top');
    wasteTop.click();
    await new Promise(function(r){ setTimeout(r, 80); });
    var selected = document.querySelectorAll('.card.selected').length;
    document.querySelector('.foundation-slot[data-foundation="0"]').click();
    await new Promise(function(r){ setTimeout(r, 140); });
    var st = window.__solitaire.getState();
    return {
      selected: selected,
      status: st.status,
      foundations: st.foundations.map(function(p){ return p.length; }),
      modalShown: !document.getElementById('winModal').hidden,
      winScore: document.getElementById('winScore').textContent,
      winMoves: document.getElementById('winMoves').textContent
    };
  })()`);
  ok('点击弃牌堆顶牌会选中', winFlow.selected >= 1, String(winFlow.selected));
  eq('点击基础堆完成通关', winFlow.status, 'won');
  eq('通关时四座基础堆各 13 张', winFlow.foundations, [13, 13, 13, 13]);
  eq('通关弹窗显示', winFlow.modalShown, true);
  ok('通关弹窗显示得分', Number(winFlow.winScore) > 0, winFlow.winScore);

  const newFlow = await evaluate(`(async function(){
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 120); });
    var st = window.__solitaire.getState();
    return { status: st.status, cards: st.stock.length + st.waste.length + st.tableau.reduce(function(a,p){return a+p.length;},0), tableau: st.tableau.map(function(p){ return p.length; }) };
  })()`);
  eq('键盘 N 开新局回到 playing', newFlow.status, 'playing');
  eq('新局恢复 52 张牌', newFlow.cards, 52);
  eq('新局七列 1..7', newFlow.tableau, [1, 2, 3, 4, 5, 6, 7]);

  section('Sound toggle and persistence');
  const persistence = await evaluate(`(async function(){
    var before = document.getElementById('soundBtn').getAttribute('aria-pressed');
    document.getElementById('soundBtn').click();
    var after = document.getElementById('soundBtn').getAttribute('aria-pressed');
    window.__solitaire.newGame({ seed: 424242 });
    window.__solitaire.draw();
    var saved = null;
    try { saved = window.Store.getJSON('hhfa-solitaire-save-v1', null); } catch (e) {}
    return { before: before, after: after, saved: !!saved && !!saved.state };
  })()`);
  ok('音效按钮切换 aria-pressed', persistence.before !== persistence.after, persistence.before + '→' + persistence.after);
  ok('每次操作写入本地存档', persistence.saved === true);

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
      var buttons = [];
      document.querySelectorAll('button, input, select, [role="button"], a.btn').forEach(function(b){
        var r = b.getBoundingClientRect();
        var cs = getComputedStyle(b);
        if (r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
          buttons.push({ tag: b.tagName, w: Math.round(r.width), h: Math.round(r.height), text: (b.textContent || '').trim().slice(0, 12) });
        }
      });
      var fonts = [];
      document.querySelectorAll('h1,h2,p,span,button,a,li,b,small,label,div').forEach(function(el){
        var direct = false;
        for (var i = 0; i < el.childNodes.length; i += 1) {
          if (el.childNodes[i].nodeType === 3 && el.childNodes[i].nodeValue.trim().length > 1) { direct = true; break; }
        }
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
      var cols = document.querySelectorAll('.column');
      return {
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6),
        columns: cols.length,
        firstCard: cols.length ? (function(){ var r = cols[0].getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })() : null
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 主控件 >=44px', m.buttons.every(function (b) { return b.w >= 44 && b.h >= 44; }), JSON.stringify(m.buttons.filter(function (b) { return b.w < 44 || b.h < 44; })));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素横向越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    eq(vp.name + ' 七列可见', m.columns, 7);
    ok(vp.name + ' 牌列有可用宽度', m.firstCard && m.firstCard.w > 20, JSON.stringify(m.firstCard));
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, buttons: m.buttons.length, minFont: Math.min.apply(null, m.fonts), card: m.firstCard });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Persistence reload and rules page');
  await navigate(origin + ENTRY, '!!(window.__solitaire && window.__solitaire.getState())');
  const resumed = await evaluate(`(function(){
    var st = window.__solitaire.getState();
    return { waste: st.waste.length, stock: st.stock.length, moves: st.moves, note: !document.getElementById('resumeNote').hidden };
  })()`);
  eq('刷新后恢复弃牌堆', resumed.waste, 1);
  eq('刷新后恢复牌堆', resumed.stock, 23);
  eq('刷新后恢复步数', resumed.moves, 1);
  ok('页面显示已恢复上局提示', resumed.note === true);

  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rulesPage = await evaluate(`(function(){
    var types = Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } });
    return {
      title: document.title,
      types: types,
      badge: document.body.innerText.indexOf('单人') >= 0,
      images: Array.prototype.map.call(document.querySelectorAll('img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length,
      faq: document.querySelectorAll('details').length
    };
  })()`);
  ok('规则页有 Article JSON-LD', rulesPage.types.indexOf('Article') >= 0, JSON.stringify(rulesPage.types));
  ok('规则页有 FAQPage JSON-LD', rulesPage.types.indexOf('FAQPage') >= 0, JSON.stringify(rulesPage.types));
  ok('规则页明确标注「单人」', rulesPage.badge === true);
  ok('规则页正文 >=1200 汉字', rulesPage.cjk >= 1200, String(rulesPage.cjk));
  ok('规则页至少 2 条 B 站来源', rulesPage.sources >= 2, String(rulesPage.sources));
  ok('规则页有 FAQ 折叠项', rulesPage.faq >= 4, String(rulesPage.faq));
  ok('规则页配图指向本地 detail-1.webp', rulesPage.images.some(function (src) { return /assets\/detail-1\.webp$/.test(src); }), JSON.stringify(rulesPage.images));

  section('Service worker and asset availability');
  const sw = await evaluate(`(async function(){
    try {
      var r = await fetch('/boardgame/solitaire-premium/sw.js');
      var a = await fetch('/boardgame/solitaire-premium/assets/cover.webp');
      var b = await fetch('/boardgame/solitaire-premium/assets/og.webp');
      var c = await fetch('/boardgame/solitaire-premium/assets/detail-1.webp');
      return { sw: r.ok, cover: a.ok, og: b.ok, detail: c.ok };
    } catch (e) { return { error: String(e) }; }
  })()`);
  ok('本地 sw.js 可访问', sw.sw === true);
  ok('cover/og/detail 资源都可访问', sw.cover && sw.og && sw.detail, JSON.stringify(sw));

  section('External requests and console errors');
  const external = [...new Set(requests.filter((u) => !/^(file|data|blob):/i.test(u) && !u.startsWith(origin)))];
  ok('无外部网络请求', external.length === 0, external.slice(0, 5).join('; '));
  ok('无 4xx/5xx 资源', http404.length === 0, http404.slice(0, 5).join('; '));
  ok('无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
  ok('无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  perf.externalRequests = external.length;
  perf.consoleErrors = consoleErrors.length;
  perf.pageErrors = pageErrors.length;
  fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
    measuredAt: new Date().toISOString(),
    environment: 'resident Chrome via CDP 9222, local Node HTTP server',
    budgets: {
      fcpMs: 2500,
      loadEventEndMs: 4000,
      domNodes: 2500,
      touchTargetPx: 44,
      fontSizePx: 12,
      externalRequests: 0
    },
    measured: {
      fcpMs: perf.fcp,
      dclMs: perf.dcl,
      loadEventEndMs: perf.loadEnd,
      domNodes: perf.domNodes,
      materialBytes: perf.materialBytes,
      externalRequests: perf.externalRequests,
      consoleErrors: perf.consoleErrors,
      pageErrors: perf.pageErrors,
      mobile: perf.mobile
    },
    ok: perf.fcp < 2500 && perf.loadEnd < 4000 && perf.domNodes < 2500 &&
      perf.externalRequests === 0 && perf.consoleErrors === 0 && perf.pageErrors === 0
  }, null, 2) + '\n');
  ok('perf.json 已写入且预算通过', JSON.parse(fs.readFileSync(path.join(HERE, 'perf.json'), 'utf8')).ok === true);
} catch (err) {
  failed += 1;
  failures.push('runner error: ' + (err && err.message ? err.message : String(err)));
  console.log('  FAIL runner error — ' + (err && err.stack ? err.stack : String(err)));
} finally {
  try { await cdp.send('Target.closeTarget', { targetId: target.id }); } catch (err) { /* ignore */ }
  cdp.ws.close();
  await new Promise((resolve) => server.close(resolve));
}

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(' - ' + f));
}
process.exit(failed ? 1 : 0);
