#!/usr/bin/env node
/*
 * 英雄领域 Hero Realms 精品版 — 真浏览器 E2E（含联机段）。
 *
 *   node games/boardgame/hero-realms-premium/e2e.mjs
 *   node games/boardgame/hero-realms-premium/e2e.mjs --control   # exit 1
 *
 * 使用常驻审计 Chrome（CDP，chrome-ensure 复用），只开一个标签页并在结束时关闭。
 * 验证：初始渲染、真实点击完整一局、重开、主题/静音、共享洗牌/音效模块、
 * 390x844 与 320x568 布局（无横向滚动、触控 >=44px、字号 >=12px）、性能预算、
 * 零外部请求、规则 JSON-LD + 详情图、美术合成页、联机房间同步。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startHeroRealmsServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.HERO_REALMS_CDP_PORT || 9335);
const ENTRY = '/boardgame/hero-realms-premium/index.html';
const RULES = '/boardgame/hero-realms-premium/rules.html';
const ONLINE = '/boardgame/hero-realms-premium/online.html';
const ART = '/boardgame/hero-realms-premium/art-render.html?shot=cover';

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
        'service-worker-allowed': '/boardgame/hero-realms-premium/'
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
  const { spawn } = await import('node:child_process');
  const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-b3-g5-hr';
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
  try { await cdp.send('Page.bringToFront'); } catch (err) {}
  await waitFor('navigate ' + url, readyExpr, 20000);
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
    var st = window.__premium.state();
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      hand: st.sides.player.hand.length,
      deck: st.sides.player.deckCount,
      market: st.market.length,
      hp: [st.sides.player.hp, st.sides.ai.hp],
      turn: st.turn,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; })
    };
  })()`);
  ok('title 含英雄领域', /英雄领域/.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('初始手牌 5 张', initial.hand, 5);
  eq('初始牌库 5 张', initial.deck, 5);
  eq('市场 5 张', initial.market, 5);
  eq('双方 50 HP', initial.hp, [50, 50]);
  eq('玩家先手', initial.turn, 'player');
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffle === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  ok('牌桌使用本地皮革材质', await evaluate('getComputedStyle(document.querySelector(".seat")).backgroundImage.indexOf("leather-mat.webp") >= 0 || getComputedStyle(document.querySelector(".board")).backgroundImage.indexOf("leather-mat.webp") >= 0'));
  ok('卡面使用本地羊皮纸材质', await evaluate('getComputedStyle(document.querySelector(".card")).backgroundImage.indexOf("parchment.webp") >= 0'));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: play a complete game with clicks');
  const played = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var clicks = 0, plays = 0, buys = 0, attacks = 0;
    for (var i = 0; i < 7000; i++) {
      if (window.__premium.over()) break;
      var st = window.__premium.state();
      if (st && st.phase === 'playing' && st.turn === 'player') {
        var me = st.sides.player;
        if (me.combat > 0) {
          var atk = document.getElementById('attackBtn');
          if (atk && !atk.disabled) { atk.click(); clicks++; attacks++; }
        } else if (me.hand.length) {
          var card = document.querySelector('#handFan .card:not(:disabled)');
          if (card) { card.click(); clicks++; plays++; }
        } else if (me.gold > 0) {
          var buy = document.querySelector('#market .card:not(:disabled)');
          if (buy) { buy.click(); clicks++; buys++; }
          else { var end = document.getElementById('endBtn'); if (end && !end.disabled) { end.click(); clicks++; } }
        } else {
          var end2 = document.getElementById('endBtn');
          if (end2 && !end2.disabled) { end2.click(); clicks++; }
        }
      }
      await sleep(5);
    }
    await sleep(150);
    var s = window.__premium.state();
    return {
      over: window.__premium.over(), winner: window.__premium.winner(),
      clicks: clicks, plays: plays, buys: buys, attacks: attacks,
      hp: [s.sides.player.hp, s.sides.ai.hp],
      hand: s.sides.player.hand.length,
      deck: s.sides.player.deckCount,
      market: s.market.length,
      log: s.log.length,
      finale: document.getElementById('finale').classList.contains('show'),
      finaleRows: document.querySelectorAll('#finaleRows .finale-row').length
    };
  })()`);
  eq('浏览器内完整一局结束', played.over, true);
  ok('存在胜者', played.winner === 'player' || played.winner === 'ai', String(played.winner));
  ok('其中一方生命归零', played.hp[0] === 0 || played.hp[1] === 0, JSON.stringify(played.hp));
  eq('终局显示结算面板', played.finale, true);
  eq('结算面板列出两名玩家', played.finaleRows, 2);
  ok('对局日志持续增长', played.log > 8, String(played.log));
  ok('至少打出、购买、攻击过', played.plays > 0 && played.buys > 0 && played.attacks > 0, JSON.stringify(played));

  section('Restart and theme');
  const restarted = await evaluate(`(async function(){
    document.getElementById('restartBtn').click();
    await new Promise(function(r){ setTimeout(r, 160); });
    var s = window.__premium.state();
    document.getElementById('themeBtn').click();
    var themed = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    return { phase: s.phase, hand: s.sides.player.hand.length, deck: s.sides.player.deckCount, market: s.market.length, hp: [s.sides.player.hp, s.sides.ai.hp], themed: themed };
  })()`);
  eq('再来一局回到 playing', restarted.phase, 'playing');
  eq('再来一局手牌 5 张', restarted.hand, 5);
  eq('再来一局牌库 5 张', restarted.deck, 5);
  eq('再来一局市场 5 张', restarted.market, 5);
  eq('再来一局生命 50', restarted.hp, [50, 50]);
  ok('主题按钮切换 data-theme', restarted.themed === 'light' || restarted.themed === 'dark', String(restarted.themed));

  section('Keyboard, mute and shared assets');
  const ui = await evaluate(`(async function(){
    document.getElementById('endBtn').focus();
    var mutedBefore = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    var mutedAfter = document.getElementById('muteBtn').getAttribute('aria-pressed');
    var shared = false;
    try { shared = (await fetch('/sw.js')).ok; } catch (e) { shared = false; }
    return {
      mutedBefore: mutedBefore, mutedAfter: mutedAfter, shared: shared,
      attackH: Math.round(document.getElementById('attackBtn').getBoundingClientRect().height),
      endH: Math.round(document.getElementById('endBtn').getBoundingClientRect().height),
      hasSW: document.documentElement.innerHTML.indexOf('serviceWorker') >= 0
    };
  })()`);
  ok('静音按钮切换 aria-pressed', ui.mutedBefore !== ui.mutedAfter, ui.mutedBefore + '→' + ui.mutedAfter);
  ok('主按钮触控高度 >= 44px', ui.attackH >= 44 && ui.endH >= 44, JSON.stringify(ui));
  ok('共享 /games/sw.js 可访问', ui.shared === true);
  ok('页面不注册 service worker', ui.hasSW === false);

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
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 8),
        hand: (function(){ var r = document.querySelector('#handFan .card'); return r ? { w: Math.round(r.getBoundingClientRect().width), h: Math.round(r.getBoundingClientRect().height) } : null; })(),
        market: document.querySelectorAll('#market .card').length
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 所有按钮 >=44px 高', m.buttons.every(function (b) { return b.h >= 44; }), JSON.stringify(m.buttons.slice(0, 10)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 手牌可见', m.hand && m.hand.w > 80 && m.hand.h > 100, JSON.stringify(m.hand));
    eq(vp.name + ' 市场 5 张', m.market, 5);
    mobileResults.push({ name: vp.name, scrollWidth: m.scrollWidth, clientWidth: m.clientWidth, buttons: m.buttons.length, minFont: Math.min.apply(null, m.fonts) });
  }
  perf.mobile = mobileResults;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  section('Rules page JSON-LD and detail art');
  await navigate(origin + RULES, 'document.readyState === "complete" && !!document.querySelector("article")');
  const rules = await evaluate(`(function(){
    return {
      title: document.title,
      jsonld: Array.prototype.map.call(document.querySelectorAll('script[type="application/ld+json"]'), function(s){ try { return JSON.parse(s.textContent)['@type']; } catch (e) { return 'BAD'; } }),
      images: Array.prototype.map.call(document.querySelectorAll('article img'), function(img){ return img.getAttribute('src'); }),
      cjk: (document.body.innerText.match(/[\\u4e00-\\u9fff]/g) || []).length,
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length
    };
  })()`);
  ok('规则页标题正确', /英雄领域/.test(rules.title), rules.title);
  ok('规则页 Article + FAQPage JSON-LD', JSON.stringify(rules.jsonld) === JSON.stringify(['Article', 'FAQPage']), JSON.stringify(rules.jsonld));
  ok('规则页含两张详情配图', rules.images.length === 2 && rules.images.every(function (src) { return /detail-[12]\.webp$/.test(src); }), JSON.stringify(rules.images));
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 条 B 站来源', rules.sources >= 3, String(rules.sources));

  section('Art composition with real component counts');
  await navigate(origin + ART, '!!document.querySelector(".fan .card") && document.querySelectorAll(".coin").length >= 7');
  const art = await evaluate(`(function(){
    var imgs = Array.prototype.map.call(document.images, function(i){ return { src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight }; });
    return {
      cards: document.querySelectorAll('.fan .card').length,
      coins: document.querySelectorAll('.coin').length,
      crystals: document.querySelectorAll('.crystal').length,
      title: document.querySelector('.title').textContent,
      materials: [
        getComputedStyle(document.querySelector('.mat')).backgroundImage,
        getComputedStyle(document.querySelector('.fan .card')).backgroundImage
      ].join(' '),
      imgs: imgs
    };
  })()`);
  eq('封面 5 张市场牌', art.cards, 5);
  eq('封面 7 枚金币', art.coins, 7);
  eq('封面 1 颗生命水晶', art.crystals, 1);
  ok('封面标题含远征', /远征/.test(art.title), art.title);
  ok('封面引用本地皮革与羊皮纸', /leather-mat\.webp/.test(art.materials) && /parchment\.webp/.test(art.materials));

  section('Artifact raster dimensions');
  const dims = await evaluate(`(async function(){
    function load(src){ return new Promise(function(resolve){ var i = new Image(); i.onload = function(){ resolve({ src: src, w: i.naturalWidth, h: i.naturalHeight }); }; i.onerror = function(){ resolve({ src: src, w: 0, h: 0 }); }; i.src = src; }); }
    return Promise.all([
      load('/boardgame/hero-realms-premium/assets/cover.webp'),
      load('/boardgame/hero-realms-premium/assets/og.webp'),
      load('/boardgame/hero-realms-premium/assets/detail-1.webp'),
      load('/boardgame/hero-realms-premium/assets/detail-2.webp')
    ]);
  })()`);
  eq('cover 1200x1200', [dims[0].w, dims[0].h], [1200, 1200]);
  eq('og 1200x630', [dims[1].w, dims[1].h], [1200, 630]);
  eq('detail-1 1200x800', [dims[2].w, dims[2].h], [1200, 800]);
  eq('detail-2 1200x800', [dims[3].w, dims[3].h], [1200, 800]);

  section('Artifact files');
  const artifacts = ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp', 'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json', 'test-online.js', 'online-server.mjs'];
  artifacts.forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  const materialDir = path.resolve(HERE, '..', '..', 'assets', 'art', 'premium', 'hero-realms');
  ['leather-mat', 'gold-coin', 'dagger', 'health-crystal', 'champion-standee', 'parchment', 'stone-table'].forEach(function (name) {
    const abs = path.join(materialDir, name + '.webp');
    ok('本地材质存在 ' + name + '.webp', fs.existsSync(abs) && fs.statSync(abs).size > 0);
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

  section('Online room: browser client + HTTP clients');
  const onlineHandle = await startHeroRealmsServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
    'document.querySelectorAll("#seats .seat").length === 2 && document.querySelectorAll("#market .card").length === 5');
  const boot = await evaluate(`({
    seats: document.querySelectorAll('#seats .seat').length,
    market: document.querySelectorAll('#market .card').length,
    hand: document.querySelectorAll('#handFan .card').length,
    room: document.getElementById('roomChip').textContent,
    actionHeight: Math.round(document.getElementById('endBtn').getBoundingClientRect().height)
  })`);
  eq('online 浏览器渲染 2 个座位', boot.seats, 2);
  eq('online 浏览器渲染 5 张市场', boot.market, 5);
  eq('online 浏览器显示自己的 5 张手牌', boot.hand, 5);
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  ok('online 主按钮触控 >=44px', boot.actionHeight >= 44, String(boot.actionHeight));

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const beforeVersion = p1View.body.stateVersion;
  const handCard = await evaluate('(function(){ var c=document.querySelector("#handFan .card:not(:disabled)"); if(c){c.click();return true;} return false; })()');
  if (handCard) {
    await sleep(400);
  }
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-p2');
  ok('online 隐藏座位 0 的手牌', p2View.body.state.sides.player.hand === undefined);
  ok('online 座位 1 看到自己的手牌', Array.isArray(p2View.body.state.sides.ai.hand));
  eq('online 两客户端看到同一市场', p1After.body.state.market, p2View.body.state.market);
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=hero-realms-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /英雄领域/.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.create && lobby.join && lobby.lb);
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
  game: 'hero-realms-premium',
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
  evidence: 'games/boardgame/hero-realms-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
