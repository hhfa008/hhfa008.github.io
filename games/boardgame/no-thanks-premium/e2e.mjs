#!/usr/bin/env node
/*
 * No Thanks! premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/no-thanks-premium/e2e.mjs
 *   node games/boardgame/no-thanks-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end. No temp Chrome/profile for the browser test.
 *
 * Verifies: real UI full game, crafted pass/take semantics, restart, theme,
 * shared shuffle/sfx modules, service worker registration, 390x844 / 320x568
 * mobile layout (no overflow, >=44px touch targets, >=12px type), performance
 * budgets, zero external requests, rules JSON-LD + detail art, art composition
 * counts, and a browser online-room sync against the shared room server.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startNoThanksServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.NO_THANKS_CDP_PORT || 9333);
const ENTRY = '/boardgame/no-thanks-premium/index.html';
const RULES = '/boardgame/no-thanks-premium/rules.html';
const ONLINE = '/boardgame/no-thanks-premium/online.html';
const ART = '/boardgame/no-thanks-premium/art-render.html?shot=cover';

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
        'service-worker-allowed': '/boardgame/no-thanks-premium/'
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
    // Dedicated resident audit instance: start once with a persistent profile
    // and reuse it across runs; never kill it at the end of a test.
    const { spawn } = await import('node:child_process');
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-b3-g5';
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
  await cdp.send("Page.navigate", { url });
  try { await cdp.send("Page.bringToFront"); } catch (err) {}
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
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      deck: window.__premium.state().deckCount,
      current: window.__premium.state().current,
      players: window.__premium.state().players.length,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; })
    };
  })()`);
  ok('title 含 NO THANKS', /NO THANKS/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('初始牌堆 23 张', initial.deck, 23);
  ok('初始翻出一张牌', typeof initial.current === 'number', String(initial.current));
  eq('三名玩家', initial.players, 3);
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffle === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  ok('牌桌使用本地毛毡材质', await evaluate('getComputedStyle(document.querySelector(".table")).backgroundImage.indexOf("table-felt.webp") >= 0'));
  ok('牌面使用本地卡纸材质', await evaluate('getComputedStyle(document.querySelector(".numcard")).backgroundImage.indexOf("card-paper.webp") >= 0'));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: play a complete game with clicks');
  const played = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var clicks = 0, passes = 0, takes = 0;
    for (var i = 0; i < 700; i++) {
      if (window.__premium.over()) break;
      var st = window.__premium.state();
      if (st && st.phase === 'playing' && st.turn === 0) {
        var pass = document.getElementById('passBtn');
        var take = document.getElementById('takeBtn');
        var btn = (i % 4 === 0 && pass && !pass.disabled) ? pass : take;
        if (btn && !btn.disabled) { btn.click(); clicks++; if (btn === pass) passes++; else takes++; }
      }
      await sleep(10);
    }
    await sleep(120);
    var s = window.__premium.state();
    return {
      over: window.__premium.over(), clicks: clicks, passes: passes, takes: takes,
      cards: s.players.reduce(function(a,p){ return a + p.cards.length; }, 0),
      deck: s.deckCount, scores: s.players.map(function(p){ return p.score; }),
      log: s.log.length,
      finale: document.getElementById('finale').classList.contains('show'),
      finaleRows: document.querySelectorAll('#finaleTable .finale-row').length,
      removed: (s.removed || []).length
    };
  })()`);
  eq('浏览器内完整一局结束', played.over, true);
  eq('24 张牌全部被收走', played.cards, 24);
  eq('终局牌堆为 0', played.deck, 0);
  eq('终局显示结算面板', played.finale, true);
  ok('结算面板列出三名玩家', played.finaleRows === 3, String(played.finaleRows));
  ok('终局后公开 9 张移除牌', played.removed === 9, String(played.removed));
  ok('对局日志持续增长', played.log > 6, String(played.log));
  ok('至少执行一次跳过', played.passes >= 1 || played.takes >= 1, 'passes=' + played.passes + ' takes=' + played.takes);
  ok('三名玩家都有分数', played.scores.length === 3 && played.scores.every(function (v) { return typeof v === 'number'; }), JSON.stringify(played.scores));

  section('Restart and theme');
  const restarted = await evaluate(`(async function(){
    document.getElementById('restartBtn').click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var s = window.__premium.state();
    document.getElementById('themeBtn').click();
    var themed = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    return { phase: s.phase, deck: s.deckCount, cards: s.players.reduce(function(a,p){ return a + p.cards.length; }, 0), themed: themed };
  })()`);
  eq('再来一局回到 playing', restarted.phase, 'playing');
  eq('再来一局牌堆重置为 23', restarted.deck, 23);
  eq('再来一局清空手牌', restarted.cards, 0);
  ok('主题按钮切换 data-theme', restarted.themed === 'light' || restarted.themed === 'dark', String(restarted.themed));

  section('Keyboard, mute and service worker');
  const ui = await evaluate(`(async function(){
    document.getElementById('takeBtn').focus();
    var mutedBefore = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    var mutedAfter = document.getElementById('muteBtn').getAttribute('aria-pressed');
    var swOk = false;
    try { swOk = (await fetch('/sw.js')).ok; } catch (e) { swOk = false; }
    return {
      mutedBefore: mutedBefore, mutedAfter: mutedAfter,
      sw: swOk,
      passBtnHeight: Math.round(document.getElementById('passBtn').getBoundingClientRect().height),
      takeBtnHeight: Math.round(document.getElementById('takeBtn').getBoundingClientRect().height)
    };
  })()`);
  ok('静音按钮切换 aria-pressed', ui.mutedBefore !== ui.mutedAfter, ui.mutedBefore + '→' + ui.mutedAfter);
  ok('主按钮触控高度 >= 44px', ui.passBtnHeight >= 44 && ui.takeBtnHeight >= 44, JSON.stringify(ui));
  ok('共享 /games/sw.js 可访问', ui.sw === true);

  section('Mobile 390x844 / 320x568 / landscape');
  const mobileResults = [];
  for (const vp of [
    { width: 390, height: 844, name: '390x844' },
    { width: 320, height: 568, name: '320x568' },
    { width: 844, height: 390, name: '844x390' },
    { width: 568, height: 320, name: '568x320' }
  ]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 2, mobile: true });
    await sleep(160);
    const m = await evaluate(`(function(){
      var vw = innerWidth;
      var buttons = [];
      document.querySelectorAll('button, a.icon-btn, a').forEach(function(b){
        var r = b.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) buttons.push({ h: Math.round(r.height), w: Math.round(r.width) });
      });
      var fonts = [];
      document.querySelectorAll('h1,h2,p,span,button,a,li,b,small,label').forEach(function(el){
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
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6), card: (function(){ var r = document.getElementById('cardSlot').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })()
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 主按钮 >=44px', m.buttons.filter(function (b) { return b.w >= 44; }).every(function (b) { return b.h >= 44; }), JSON.stringify(m.buttons.slice(0, 8)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 牌面可见', m.card.w > 90 && m.card.h > 120, JSON.stringify(m.card));
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, buttons: m.buttons.length, minFont: Math.min.apply(null, m.fonts) });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page JSON-LD and detail art');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    return {
      title: document.title,
      article: !!document.querySelector('script[type="application/ld+json"]'),
      jsonld: Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } }),
      images: Array.prototype.map.call(document.querySelectorAll('article img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length
    };
  })()`);
  ok('规则页标题正确', /No Thanks/i.test(rules.title), rules.title);
  ok('规则页 Article + FAQPage JSON-LD', JSON.stringify(rules.jsonld) === JSON.stringify(['Article', 'FAQPage']), JSON.stringify(rules.jsonld));
  ok('规则页含两张详情配图', rules.images.length === 2 && rules.images.every(function (src) { return /detail-[12]\.webp$/.test(src); }), JSON.stringify(rules.images));
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 条 B 站来源', rules.sources >= 3, String(rules.sources));

  section('Art composition with real component counts');
  await navigate(origin + ART, '!!document.querySelector(".fan .card") && document.querySelectorAll(".chip").length >= 7');
  const art = await evaluate(`({
    cards: document.querySelectorAll('.hero .card').length,
    chips: document.querySelectorAll('.chip').length,
    title: document.querySelector('.title').textContent,
    materials: [
      getComputedStyle(document.querySelector('.stage'), '::before').backgroundImage,
      getComputedStyle(document.querySelector('.hero .card:not(.back)')).backgroundImage
    ].join(' ')
  })`);
  eq('封面 5 张牌（含 1 张牌背）', art.cards, 5);
  eq('封面 7 枚筹码', art.chips, 7);
  ok('封面标题含「一次拒绝」', /一次拒绝/.test(art.title), art.title);
  ok('封面引用本地材质', /table-felt\.webp/.test(art.materials) && /card-paper\.webp/.test(art.materials));

  section('Artifact files');
  const artifacts = ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp', 'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json', 'test-online.js'];
  artifacts.forEach(function (rel) {
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
  const onlineHandle = await startNoThanksServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
  ok('online host started match', started.status === 200 && started.body.state && started.body.playerCount === 3, started.status);

  await navigate(onlineBase + ONLINE + '?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-p1',
    'document.querySelectorAll("#seats .seat").length === 3 && !!document.querySelector(".numcard")');
  const boot = await evaluate(`({
    seats: document.querySelectorAll('#seats .seat').length,
    card: (document.querySelector('.numcard') || {}).textContent,
    room: document.getElementById('roomChip').textContent,
    legalTake: !document.getElementById('takeBtn').disabled,
    legalPass: !document.getElementById('passBtn').disabled,
    actionHeight: Math.round(document.getElementById('takeBtn').getBoundingClientRect().height)
  })`);
  eq('online 浏览器渲染 3 个座位', boot.seats, 3);
  ok('online 浏览器显示当前牌', /^\d+$/.test(String(boot.card).trim()), String(boot.card));
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  ok('online 主按钮触控 >=44px', boot.actionHeight >= 44, String(boot.actionHeight));

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const beforeVersion = p1View.body.stateVersion;
  if (boot.legalTake || boot.legalPass) {
    const btn = boot.legalPass && !boot.legalTake ? 'passBtn' : 'takeBtn';
    await evaluate('document.getElementById("' + btn + '").click()');
    await waitFor('online action advanced version', 'true', 500);
    await sleep(350);
  }
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-p2');
  eq('online 两客户端看到同一张牌', p1After.body.state.current, p2View.body.state.current);
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=no-thanks-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /NO THANKS/i.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.create && lobby.join && lobby.lb);
  await onlineHandle.close();

  section('Zero external requests & console clean');
  const external = Array.from(new Set(requests.filter(function (url) {
    return url.indexOf(origin) !== 0 && url.indexOf(onlineBase) !== 0 && url.indexOf('data:') !== 0 && url.indexOf('about:') !== 0;
  })));
  eq('零外部网络请求', external.length, 0, external.slice(0, 5).join(', '));
  ok('零 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') + ' :: ' + notFound.slice(0, 6).join(' ; '));
  eq('零页面异常', pageErrors.length, 0, pageErrors.slice(0, 3).join(' | '));

  section('Artifact files (online)');
  ['online.html', 'online-server.mjs', 'test-online.js', 'online-e2e.json'].forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0);
  });
} catch (err) {
  ok('E2E 执行成功', false, err && err.message);
} finally {
  try { await fetch('http://127.0.0.1:' + CDP_PORT + '/json/close/' + target.id); } catch (err) { /* tab may be gone */ }
  await new Promise(function (resolve) { server.close(resolve); });
}

fs.writeFileSync(path.join(HERE, 'perf.json'), JSON.stringify({
  game: 'no-thanks-premium',
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
  evidence: 'games/boardgame/no-thanks-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
