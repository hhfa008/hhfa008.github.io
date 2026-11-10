#!/usr/bin/env node
/*
 * 6 Nimmt! / 谁是牛头王 premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/six-nimmt-premium/e2e.mjs
 *   node games/boardgame/six-nimmt-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end. No temp Chrome/profile for the browser test.
 *
 * Verifies: a real UI game (4 rows, simultaneous picks, row choice, ten rounds),
 * restart, 3/4/5 player selector, keyboard, theme, shared shuffle/sfx modules,
 * 390x844 / 320x568 / landscape mobile layout (no overflow, >=44px targets,
 * >=12px type), rules JSON-LD + two detail images + three Bilibili sources,
 * art composition, performance budgets, zero external requests, and a browser
 * online-room sync against the shared room server.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSixNimmtServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.SIX_NIMMT_CDP_PORT || 9333);
const ENTRY = '/boardgame/six-nimmt-premium/index.html';
const RULES = '/boardgame/six-nimmt-premium/rules.html';
const ONLINE = '/boardgame/six-nimmt-premium/online.html';
const ART = '/boardgame/six-nimmt-premium/art-render.html?shot=cover';

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
        'service-worker-allowed': '/boardgame/six-nimmt-premium/'
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
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-six-nimmt';
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

  section('Initial render and performance');
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
      round: s.round, rows: s.rows.length, hands: s.players.map(function(p){ return p.handCount; }),
      players: s.players.length, phase: s.phase,
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      resources: res.map(function(r){ return r.name; })
    };
  })()`);
  ok('title 含 6 NIMMT', /6 NIMMT/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('开局第 1 轮', initial.round, 1);
  eq('四行牌列', initial.rows, 4);
  eq('三名玩家', initial.players, 3);
  eq('每人 10 张手牌', initial.hands, [10, 10, 10]);
  eq('阶段为 pick', initial.phase, 'pick');
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffle === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  ok('牌桌使用本地毛毡材质', await evaluate('getComputedStyle(document.querySelector(".table")).backgroundImage.indexOf("felt-table.webp") >= 0'));
  ok('手牌使用本地卡纸材质', await evaluate('getComputedStyle(document.querySelector(".hcard")).backgroundImage.indexOf("card-paper.webp") >= 0'));
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: play a complete ten-round game with clicks');
  const played = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var clicks = 0, rowChoices = 0;
    for (var i = 0; i < 900; i++) {
      if (window.__premium.over()) break;
      var st = window.__premium.state();
      if (st && st.phase === 'chooseRow') {
        var rb = document.querySelector('#choiceArea .rowchoices button');
        if (rb) { rb.click(); clicks++; rowChoices++; }
      } else if (st && st.phase === 'pick' && st.myPick == null) {
        var hb = document.querySelector('#hand .hcard');
        if (hb) { hb.click(); clicks++; }
      }
      await sleep(12);
    }
    await sleep(160);
    var s = window.__premium.state();
    return {
      over: window.__premium.over(), clicks: clicks, rowChoices: rowChoices,
      round: s.round, rows: s.rows.length,
      taken: s.players.reduce(function(a,p){ return a + p.taken.length; }, 0),
      rowCards: s.rows.reduce(function(a,r){ return a + r.length; }, 0),
      hands: s.players.reduce(function(a,p){ return a + p.handCount; }, 0),
      scores: s.players.map(function(p){ return p.score; }),
      log: s.log.length,
      unused: (s.unused || []).length,
      finale: document.getElementById('finale').classList.contains('show'),
      finaleRows: document.querySelectorAll('#finaleTable .finale-row').length
    };
  })()`);
  eq('浏览器内十轮结束', played.over, true);
  eq('终局轮次 10', played.round, 10);
  eq('终局牌数守恒 34（4 张起始牌 + 30 张出牌）', played.taken + played.rowCards, 34);
  eq('终局完整牌数守恒 104', played.unused + played.taken + played.rowCards + played.hands, 104);
  eq('终局手牌打光', played.hands, 0);
  eq('终局公开 70 张未使用牌', played.unused, 70);
  eq('终局显示结算面板', played.finale, true);
  eq('结算列出三名玩家', played.finaleRows, 3);
  ok('对局日志持续增长', played.log > 8, String(played.log));
  ok('至少执行 10 次出牌', played.clicks >= 10, String(played.clicks));
  ok('三名玩家都有分数', played.scores.length === 3 && played.scores.every(function (v) { return typeof v === 'number'; }), JSON.stringify(played.scores));

  section('Restart, player count and keyboard');
  const restarted = await evaluate(`(async function(){
    document.getElementById('restartBtn').click();
    await new Promise(function(r){ setTimeout(r, 120); });
    var s = window.__premium.state();
    var sel = document.getElementById('playerCount');
    sel.value = '4'; sel.dispatchEvent(new Event('change'));
    await new Promise(function(r){ setTimeout(r, 100); });
    var four = window.__premium.state();
    sel.value = '3'; sel.dispatchEvent(new Event('change'));
    await new Promise(function(r){ setTimeout(r, 100); });
    var before = window.__premium.state().turnCount;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 120); });
    var after = window.__premium.state();
    var themed = null;
    document.getElementById('themeBtn').click();
    themed = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    return {
      phase: s.phase, round: s.round, hands: s.players.map(function(p){ return p.handCount; }),
      taken: s.players.reduce(function(a,p){ return a + p.taken.length; }, 0),
      fourPlayers: four.players.length, fourHands: four.players.map(function(p){ return p.handCount; }),
      keyAdvanced: after.turnCount > before || after.round > 1,
      themed: themed
    };
  })()`);
  eq('再来一局回到 pick', restarted.phase, 'pick');
  eq('再来一局第 1 轮', restarted.round, 1);
  eq('再来一局清空吃牌', restarted.taken, 0);
  eq('再来一局每人 10 张', restarted.hands, [10, 10, 10]);
  eq('人数选择器切到 4 人', restarted.fourPlayers, 4);
  eq('4 人局每人 10 张', restarted.fourHands, [10, 10, 10, 10]);
  ok('数字键 1 可出牌', restarted.keyAdvanced, String(restarted.keyAdvanced));
  ok('主题按钮切换 data-theme', restarted.themed === 'light' || restarted.themed === 'dark', String(restarted.themed));

  section('Mute and shared service worker');
  const ui = await evaluate(`(async function(){
    window.__premium.start();
    await new Promise(function(r){ setTimeout(r, 80); });
    var before = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    var after = document.getElementById('muteBtn').getAttribute('aria-pressed');
    var swOk = false;
    try { swOk = (await fetch('/sw.js')).ok; } catch (e) { swOk = false; }
    return {
      mutedBefore: before, mutedAfter: after, sw: swOk,
      handHeight: Math.round(document.querySelector('.hcard').getBoundingClientRect().height),
      backHeight: Math.round(document.querySelector('a.icon-btn').getBoundingClientRect().height)
    };
  })()`);
  ok('静音按钮切换 aria-pressed', ui.mutedBefore !== ui.mutedAfter, ui.mutedBefore + '→' + ui.mutedAfter);
  ok('手牌触控高度 >= 44px', ui.handHeight >= 44, String(ui.handHeight));
  ok('导航触控高度 >= 44px', ui.backHeight >= 44, String(ui.backHeight));
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
    await sleep(180);
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
      var row = document.querySelector('.row');
      return {
        scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6),
        rowWidth: row ? Math.round(row.getBoundingClientRect().width) : 0,
        handCols: getComputedStyle(document.getElementById('hand')).gridTemplateColumns
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 按钮/链接 >=44px 高', m.buttons.every(function (b) { return b.h >= 44; }), JSON.stringify(m.buttons.slice(0, 10)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 四行牌桌可见', m.rowWidth > 180, String(m.rowWidth));
    mobileResults.push({
      name: vp.name,
      scrollWidth: m.scrollWidth,
      clientWidth: m.clientWidth,
      buttons: m.buttons.length,
      minFont: Math.min.apply(null, m.fonts)
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
      biliLinks: document.querySelectorAll('a[href*="bilibili.com/video/BV"]').length
    };
  })()`);
  ok('规则页标题正确', /6 Nimmt/i.test(rules.title), rules.title);
  eq('规则页 Article + FAQPage JSON-LD', rules.jsonld, ['Article', 'FAQPage']);
  eq('规则页两张详情配图', rules.images, ['assets/detail-1.webp', 'assets/detail-2.webp']);
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 个 BV 号', rules.sources.length >= 3, JSON.stringify(rules.sources));
  ['BV1neA2z4ENU', 'BV1BfchzTEjB', 'BV1q7411s732'].forEach(function (bv) {
    ok('规则页来源 ' + bv, rules.sources.indexOf(bv) >= 0);
  });
  ok('规则页含计分表', rules.table === true);
  ok('规则页 3 条 B 站链接', rules.biliLinks >= 3, String(rules.biliLinks));

  section('Art composition with real component counts');
  await navigate(origin + ART, 'document.body.getAttribute("data-shot") === "cover" && document.querySelectorAll(".scene-cover .card").length >= 15');
  const art = await evaluate(`({
    cards: document.querySelectorAll('.scene-cover .card').length,
    hot: document.querySelectorAll('.scene-cover .card.hot').length,
    tokens: document.querySelectorAll('.scene-cover .token').length,
    rows: document.querySelectorAll('.scene-cover .brow').length,
    title: document.querySelector('.scene-cover .title').textContent,
    felt: getComputedStyle(document.querySelector('.stage'), '::before').backgroundImage,
    paper: getComputedStyle(document.querySelector('.scene-cover .card')).backgroundImage,
    back: getComputedStyle(document.querySelector('.scene-cover .card.back')).backgroundImage
  })`);
  eq('封面 4 行牌列', art.rows, 4);
  ok('封面至少 15 张牌', art.cards >= 15, String(art.cards));
  eq('封面 3 张暗牌', art.cards - 15, 3);
  ok('封面危险牌高亮', art.hot >= 2, String(art.hot));
  ok('封面至少 5 枚牛头 token', art.tokens >= 5, String(art.tokens));
  ok('封面标题含「六张就爆」', /六张就爆/.test(art.title), art.title);
  ok('封面引用本地毛毡', /felt-table\.webp/.test(art.felt), art.felt.slice(0, 80));
  ok('封面引用本地卡纸', /card-paper\.webp/.test(art.paper));
  ok('封面引用本地牌背', /card-back\.webp/.test(art.back));

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
  ['meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'online-e2e.json', 'test-online.js', 'online.html', 'online-server.mjs', 'art-render.html'].forEach(function (rel) {
    const abs = path.join(HERE, rel);
    ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
  });
  const artDir = path.join(GAMES_ROOT, 'assets', 'art', 'premium', 'six-nimmt');
  ['felt-table.webp', 'card-paper.webp', 'card-back.webp', 'bull-token.webp', 'wood-rail.webp', 'row-ribbon.webp'].forEach(function (name) {
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
  const onlineHandle = await startSixNimmtServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
    'document.querySelectorAll("#seats .seat").length === 3 && document.querySelectorAll("#choiceArea .hcard").length >= 9 && document.querySelectorAll("#rows .trow").length === 4');
  const boot = await evaluate(`({
    seats: document.querySelectorAll('#seats .seat').length,
    rows: document.querySelectorAll('#rows .trow').length,
    hand: document.querySelectorAll('#choiceArea .hcard').length,
    room: document.getElementById('roomChip').textContent,
    actionHeight: Math.round((document.querySelector('#choiceArea .hcard') || {getBoundingClientRect:function(){return {height:0};}}).getBoundingClientRect().height)
  })`);
  eq('online 浏览器渲染 3 个座位', boot.seats, 3);
  eq('online 浏览器渲染四行', boot.rows, 4);
  eq('online 浏览器渲染 10 张手牌', boot.hand, 10);
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  ok('online 手牌触控 >=44px', boot.actionHeight >= 44, String(boot.actionHeight));

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const beforeVersion = p1View.body.stateVersion;
  const clickedCard = await evaluate(`(function(){
    var b = document.querySelector('#choiceArea .hcard');
    if (!b) return null;
    var text = b.querySelector('.n').textContent;
    b.click();
    return Number(text);
  })()`);
  ok('online 浏览器点击暗出一张牌', typeof clickedCard === 'number', String(clickedCard));
  await sleep(500);
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-p1');
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-p2');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  eq('online 两客户端看到同一四行', p1After.body.state.rows, p2View.body.state.rows);
  eq('online 出牌者看到自己的暗牌', p1After.body.state.myPick, clickedCard);
  ok('online 对手只看到已出标记', p2View.body.state.players[0].picked === true && p2View.body.state.players[0].pickedCard === null,
    JSON.stringify({ picked: p2View.body.state.players[0].picked, card: p2View.body.state.players[0].pickedCard }));
  ok('online 不泄漏对手手牌', p2View.body.state.players[0].hand === null);
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=six-nimmt-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /6 NIMMT/i.test(lobby.title), lobby.title);
  ok('online lobby create/join/leaderboard present', lobby.create && lobby.join && lobby.lb);
  // Leave the polling pages before shutting the room server down, otherwise a
  // pending 5s leaderboard poll could surface a network error in the console.
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
  game: 'six-nimmt-premium',
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
  evidence: 'games/boardgame/six-nimmt-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
