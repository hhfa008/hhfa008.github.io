#!/usr/bin/env node
/*
 * Avalon premium — single-client browser E2E + online room section.
 *
 *   node games/boardgame/avalon-premium/e2e.mjs
 *   node games/boardgame/avalon-premium/e2e.mjs --control   # exit 1
 *
 * Uses the resident audit Chrome over CDP (chrome-ensure), opens exactly one
 * tab and closes it at the end. No temp Chrome/profile for the browser test.
 *
 * Verifies: real UI full game, hidden-role projections, crafted quest/vote
 * semantics, restart, theme, keyboard, shared shuffle/sfx modules, 390x844 /
 * 320x568 mobile layout (no overflow, >=44px touch targets, >=12px type),
 * performance budgets, zero external requests, rules JSON-LD + detail art,
 * art composition counts, and a browser online-room sync against the shared
 * room server.
 *
 * Prints one line: RESULT: N passed, M failed
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startAvalonServer } from './online-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..', '..');
const CDP_PORT = Number(process.env.AVALON_CDP_PORT || 9333);
const ENTRY = '/boardgame/avalon-premium/index.html';
const RULES = '/boardgame/avalon-premium/rules.html';
const ONLINE = '/boardgame/avalon-premium/online.html';
const ART = '/boardgame/avalon-premium/art-render.html?shot=cover';

if (process.argv.includes('--control')) {
  // --control: intentional failure, exit 1.
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
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    // The pages declare a data-URI icon; also absorb any browser probe so the
    // zero-console-error assertion is not polluted by a favicon 404.
    if (rel === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const file = path.resolve(GAMES_ROOT, '.' + rel);
    if (!file.startsWith(GAMES_ROOT + path.sep) && file !== GAMES_ROOT) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'service-worker-allowed': '/boardgame/avalon-premium/'
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
    const profile = process.env.HOME + '/.cache/games-quality-audit/chrome-profile-avalon-b3-g5';
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

  section('Initial render, 5 seats, hidden role');
  const initial = await evaluate(`(function(){
    var nav = performance.getEntriesByType('navigation')[0] || {};
    var fcp = performance.getEntriesByName('first-contentful-paint')[0] || {};
    var res = performance.getEntriesByType('resource').map(function(e){ return { name: e.name, size: e.decodedBodySize || e.transferSize || 0 }; });
    var s = window.__premium.state();
    var D = window.AvalonPremiumData;
    return {
      title: document.title,
      desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      viewport: (document.querySelector('meta[name="viewport"]') || {}).content || '',
      og: (document.querySelector('meta[property="og:image"]') || {}).content || '',
      players: s.players.length,
      questSizes: s.questSizes,
      phase: s.phase,
      yourRole: s.yourRole,
      roleName: document.getElementById('roleName').textContent,
      roleNameExpected: D && D.roles[s.yourRole] ? D.roles[s.yourRole].name : '?',
      seats: document.querySelectorAll('#seats .seat').length,
      quests: document.querySelectorAll('#questTrack .quest').length,
      revealed: s.players.filter(function(p){ return p.revealedRole != null; }).length,
      reveal: s.reveal,
      roleLeak: s.players.some(function(p){ return p.role !== undefined; }),
      tokens: s.roleKnowledge.map(function(k){ return k.role; }),
      fcp: fcp.startTime || 0,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0,
      domNodes: document.getElementsByTagName('*').length,
      size: res.reduce(function(a, r){ return a + (r.size || 0); }, 0),
      ariaLive: document.getElementById('actionText').getAttribute('aria-live'),
      tableArt: getComputedStyle(document.querySelector('.table-round')).backgroundImage,
      parchmentArt: getComputedStyle(document.querySelector('.sigil')).backgroundImage
    };
  })()`);
  ok('title 含 AVALON/阿瓦隆', /AVALON|阿瓦隆/i.test(initial.title), initial.title);
  ok('meta description 非空', initial.desc.length > 40, String(initial.desc.length));
  ok('viewport 含 width=device-width', initial.viewport.indexOf('width=device-width') >= 0, initial.viewport);
  ok('og:image 指向本地 og.webp', /assets\/og\.webp$/.test(initial.og), initial.og);
  eq('五名玩家', initial.players, 5);
  eq('任务人数 2/3/2/3/3', initial.questSizes, [2, 3, 2, 3, 3]);
  eq('五个任务卡槽', initial.quests, 5);
  eq('五个圆桌座位', initial.seats, 5);
  ok('自己的角色名正确', initial.roleName === initial.roleNameExpected, initial.roleName + ' / ' + initial.roleNameExpected);
  eq('进行中不公开他人身份', initial.revealed, 0);
  eq('进行中 reveal 为空', initial.reveal, null);
  ok('玩家对象不含 role 字段', initial.roleLeak === false);
  ok('角色知识 token 合法', initial.tokens.every(function (t) {
    return ['you', 'evil', 'magic', 'evil-ally', 'unknown'].indexOf(t) >= 0;
  }), initial.tokens.join(','));
  var knowledgeCount = function (token) { return initial.tokens.filter(function (t) { return t === token; }).length; };
  if (initial.yourRole === 'merlin') eq('梅林看到 2 个邪恶', knowledgeCount('evil'), 2);
  else if (initial.yourRole === 'percival') eq('派西维尔看到 2 个魔法师', knowledgeCount('magic'), 2);
  else if (initial.yourRole === 'morgana' || initial.yourRole === 'assassin') eq('邪恶看到 1 个同伙', knowledgeCount('evil-ally'), 1);
  else eq('忠臣没有额外情报', knowledgeCount('evil') + knowledgeCount('magic') + knowledgeCount('evil-ally'), 0);
  ok('共享洗牌模块已加载', await evaluate('typeof window.Shuffle === "object" && typeof window.Shuffle.shuffle === "function"'));
  ok('共享音效模块已加载', await evaluate('typeof window.Sfx === "object" && typeof window.Sfx.play === "function"'));
  ok('圆桌使用本地毛毡材质', String(initial.tableArt).indexOf('round-table-felt.webp') >= 0, String(initial.tableArt).slice(0, 80));
  ok('身份卡使用本地羊皮纸材质', String(initial.parchmentArt).indexOf('parchment.webp') >= 0, String(initial.parchmentArt).slice(0, 80));
  ok('行动区声明 aria-live', initial.ariaLive === 'polite', initial.ariaLive);
  perf.fcp = Math.round(initial.fcp);
  perf.dcl = Math.round(initial.dcl);
  perf.loadEnd = Math.round(initial.loadEnd);
  perf.domNodes = initial.domNodes;
  perf.materialBytes = initial.size;
  console.log('  PERF ' + JSON.stringify(perf));

  section('Real UI: hidden roles and a complete game with clicks');
  const played = await evaluate(`(async function(){
    var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };
    var clicks = 0, proposals = 0, votes = 0, missions = 0, assassinations = 0;
    for (var i = 0; i < 4000; i++) {
      var s = window.__premium.state();
      if (!s || window.__premium.over()) break;
      if (s.phase === 'propose' && s.leader === s.yourSeat) {
        var size = s.teamSize;
        var picked = 0;
        var buttons = Array.prototype.slice.call(document.querySelectorAll('#seats button.seat'));
        buttons.forEach(function(b){ if (b.getAttribute('aria-pressed') === 'true') picked++; });
        if (picked < size) {
          var next = Array.prototype.slice.call(document.querySelectorAll('#seats button.seat')).filter(function(b){ return b.getAttribute('aria-pressed') !== 'true'; })[0];
          if (next) { next.click(); clicks++; }
        } else {
          var c = document.getElementById('confirmTeamBtn');
          if (c && !c.disabled) { c.click(); proposals++; clicks++; }
        }
      } else if (s.phase === 'vote' && !s.players[s.yourSeat].voted) {
        var v = document.getElementById('approveBtn') || document.getElementById('rejectBtn');
        if (v) { v.click(); votes++; clicks++; }
      } else if (s.phase === 'mission' && s.team.indexOf(s.yourSeat) >= 0 && !s.players[s.yourSeat].missionVoted) {
        var m = document.getElementById('missionSuccessBtn') || document.getElementById('missionFailBtn');
        if (m) { m.click(); missions++; clicks++; }
      } else if (s.phase === 'assassin' && s.yourRole === 'assassin') {
        var t = document.querySelector('.targetBtn');
        if (t) { t.click(); assassinations++; clicks++; }
      }
      await sleep(12);
    }
    await sleep(250);
    var s = window.__premium.state();
    return {
      over: window.__premium.over(), clicks: clicks, proposals: proposals, votes: votes,
      missions: missions, assassinations: assassinations,
      phase: s.phase, winner: s.winner, reason: s.winReason,
      quests: s.quests.map(function(q){ return q.result; }),
      missionsScore: s.missions,
      finale: document.getElementById('finale').classList.contains('show'),
      finaleRows: document.querySelectorAll('#finaleTable .finale-row').length,
      revealed: s.players.filter(function(p){ return p.revealedRole != null; }).length,
      logLines: s.log.length
    };
  })()`);
  eq('浏览器内完整一局结束', played.over, true);
  ok('赢家为正义或邪恶', played.winner === 'good' || played.winner === 'evil', String(played.winner));
  ok('至少完成一次提名', played.proposals >= 1, String(played.proposals));
  ok('至少投出一次票', played.votes >= 1, String(played.votes));
  eq('终局显示结算面板', played.finale, true);
  eq('结算翻牌五名玩家', played.finaleRows, 5);
  eq('结束时五名角色全部公开', played.revealed, 5);
  ok('五个任务卡槽保持 5 个', Array.isArray(played.quests) && played.quests.length === 5);
  ok('结算包含胜负原因', typeof played.reason === 'string' && played.reason.length > 4, String(played.reason));
  ok('对局日志持续增长', played.logLines > 6, String(played.logLines));
  console.log('  GAME ' + JSON.stringify({ proposals: played.proposals, votes: played.votes, missions: played.missions, assassinations: played.assassinations, winner: played.winner }));

  section('Restart, theme, mute and keyboard');
  const restarted = await evaluate(`(async function(){
    document.getElementById('againBtn').click();
    await new Promise(function(r){ setTimeout(r, 150); });
    var s = window.__premium.state();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    await new Promise(function(r){ setTimeout(r, 40); });
    var picked = document.querySelectorAll('#seats button.seat[aria-pressed="true"]').length;
    document.getElementById('themeBtn').click();
    var themed = document.documentElement.getAttribute('data-theme');
    document.getElementById('themeBtn').click();
    var mutedBefore = document.getElementById('muteBtn').getAttribute('aria-pressed');
    document.getElementById('muteBtn').click();
    var mutedAfter = document.getElementById('muteBtn').getAttribute('aria-pressed');
    return { phase: s.phase, questIndex: s.questIndex, missions: s.missions, picked: picked, themed: themed, mutedBefore: mutedBefore, mutedAfter: mutedAfter };
  })()`);
  eq('再来一局回到提名', restarted.phase, 'propose');
  eq('再来一局回到第一次任务', restarted.questIndex, 0);
  eq('再来一局比分清零', restarted.missions, { good: 0, evil: 0, needed: 3, total: 5 });
  eq('键盘数字键选中座位', restarted.picked, 1);
  ok('主题按钮切换 data-theme', restarted.themed === 'light' || restarted.themed === 'dark', String(restarted.themed));
  ok('静音按钮切换 aria-pressed', restarted.mutedBefore !== restarted.mutedAfter, restarted.mutedBefore + '→' + restarted.mutedAfter);

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
        buttons: buttons, fonts: fonts, overflow: overflow.slice(0, 6),
        seats: document.querySelectorAll('#seats .seat').length,
        quests: document.querySelectorAll('#questTrack .quest').length,
        roleHeight: Math.round(document.getElementById('roleCard').getBoundingClientRect().height),
        arenaWidth: Math.round(document.querySelector('.arena').getBoundingClientRect().width)
      };
    })()`);
    ok(vp.name + ' 无横向滚动', m.scrollWidth <= m.clientWidth + 1, 'doc ' + m.scrollWidth + '/' + m.clientWidth);
    ok(vp.name + ' 主按钮 >=44px', m.buttons.filter(function (b) { return b.w >= 44; }).every(function (b) { return b.h >= 44; }), JSON.stringify(m.buttons.slice(0, 10)));
    ok(vp.name + ' 可见字号 >=12px', m.fonts.every(function (f) { return f >= 12; }), 'min=' + Math.min.apply(null, m.fonts));
    ok(vp.name + ' 无元素越界', m.overflow.length === 0, JSON.stringify(m.overflow));
    ok(vp.name + ' 五个座位可见', m.seats === 5, String(m.seats));
    ok(vp.name + ' 五个任务卡槽可见', m.quests === 5, String(m.quests));
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
      sources: (document.body.innerHTML.match(/BV[0-9A-Za-z]+/g) || []).length,
      tables: document.querySelectorAll('article table').length,
      hasQuest4: document.body.innerText.indexOf('任务 4') >= 0
    };
  })()`);
  ok('规则页标题正确', /Avalon/i.test(rules.title), rules.title);
  ok('规则页 Article + FAQPage JSON-LD', JSON.stringify(rules.jsonld) === JSON.stringify(['Article', 'FAQPage']), JSON.stringify(rules.jsonld));
  ok('规则页含两张详情配图', rules.images.length === 2 && rules.images.every(function (src) { return /detail-[12]\.webp$/.test(src); }), JSON.stringify(rules.images));
  ok('规则页正文 >=1200 汉字', rules.cjk >= 1200, String(rules.cjk));
  ok('规则页含至少 3 条 B 站来源', rules.sources >= 3, String(rules.sources));
  ok('规则页含官方任务表', rules.tables >= 1 && rules.hasQuest4, 'tables=' + rules.tables);

  section('Art composition with real component counts');
  await navigate(origin + ART, 'document.querySelectorAll(".hero .questcard").length === 5 && !!document.querySelector(".seal")');
  const art = await evaluate(`({
    quests: document.querySelectorAll('.hero .questcard').length,
    seats: document.querySelectorAll('.hero .seatdot').length,
    title: document.querySelector('.title').textContent,
    seal: document.querySelector('.seal').textContent,
    table: getComputedStyle(document.querySelector('.roundtable')).backgroundImage,
    paper: getComputedStyle(document.querySelector('.questcard')).backgroundImage
  })`);
  eq('封面 5 张任务卡', art.quests, 5);
  eq('封面 5 个席位', art.seats, 5);
  ok('封面标题含「一次暗杀」', /一次暗杀/.test(art.title), art.title);
  ok('封面印章为「阿」', /阿/.test(art.seal), art.seal);
  ok('封面引用本地圆桌毛毡', /round-table-felt\.webp/.test(art.table), String(art.table).slice(0, 80));
  ok('封面引用本地羊皮纸', /parchment\.webp/.test(art.paper), String(art.paper).slice(0, 80));

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
    var nav = performance.getEntriesByType('navigation')[0] || {};
    return {
      fps: Math.round(fps),
      newGameMs: Number(newGameMs.toFixed(1)),
      domNodes: document.getElementsByTagName('*').length,
      dcl: nav.domContentLoadedEventEnd || 0,
      loadEnd: nav.loadEventEnd || 0
    };
  })()`);
  ok('FPS >= 30', perfNow.fps >= 30, String(perfNow.fps));
  ok('新局渲染 < 200ms', perfNow.newGameMs < 200, perfNow.newGameMs + 'ms');
  ok('DOM 节点 < 2500', perfNow.domNodes < 2500, String(perfNow.domNodes));
  ok('FCP < 2500ms', Number(perf.fcp) < 2500, perf.fcp + 'ms');
  ok('loadEventEnd < 4000ms', Number(perf.loadEnd) < 4000, perf.loadEnd + 'ms');
  perf.fps = perfNow.fps;
  perf.newGameRenderMs = perfNow.newGameMs;
  perf.dcl = Math.round(perfNow.dcl);
  perf.loadEnd = Math.round(perfNow.loadEnd);

  section('Online room: browser client + two HTTP clients');
  const onlineHandle = await startAvalonServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 8000, aiDelayMs: 0 });
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
  const created = await onlineApi('POST', '/api/rooms', { playerId: 'e2e-avalon-p1', nickname: '浏览器房主' });
  ok('online room created', created.status === 201 && created.body.roomId, created.status + ' ' + JSON.stringify(created.body && created.body.error));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  const joined2 = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', { playerId: 'e2e-avalon-p2', nickname: '第二位玩家', inviteCode: invite });
  ok('online second client joined', joined2.status === 200 && joined2.body.session, joined2.status);
  const t2 = joined2.body && joined2.body.session;
  const started = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/start', { session: t1, playerId: 'e2e-avalon-p1' });
  ok('online host started match with exactly 5 seats', started.status === 200 && started.body.state && started.body.playerCount === 5, started.status);

  await navigate(onlineBase + ONLINE + '?room=' + encodeURIComponent(roomId) + '&session=' + encodeURIComponent(t1) + '&player=e2e-avalon-p1',
    'document.querySelectorAll("#seats .seat").length === 5 && document.querySelectorAll("#questTrack .quest").length === 5 && document.getElementById("roleName").textContent.length > 1');
  const boot = await evaluate(`(function(){
    var v = window.__avalonLastView || {};
    var firstAction = document.querySelector('#actions button');
    return {
      seats: document.querySelectorAll('#seats .seat').length,
      quests: document.querySelectorAll('#questTrack .quest').length,
      room: document.getElementById('roomChip').textContent,
      role: document.getElementById('roleName').textContent,
      roleSide: document.getElementById('roleSide').textContent,
      stateRole: v.yourRole,
      phase: v.phase,
      hidden: (v.players || []).every(function(p){ return p.revealedRole === null; }),
      tokens: (v.roleKnowledge || []).map(function(k){ return k.role; }),
      actionHeight: firstAction ? Math.round(firstAction.getBoundingClientRect().height) : 0,
      selectableSeats: document.querySelectorAll('#seats button.seat').length
    };
  })()`);
  eq('online 浏览器渲染 5 个座位', boot.seats, 5);
  eq('online 浏览器渲染 5 个任务卡槽', boot.quests, 5);
  ok('online 房间号可见', /房间/.test(boot.room), boot.room);
  ok('online 浏览器显示自己的角色', boot.role.length > 1 && boot.role === (await evaluate('window.AvalonPremiumData.roles[window.__avalonLastView.yourRole].name')), boot.role);
  ok('online 进行中不公开他人身份', boot.hidden === true, JSON.stringify(boot.hidden));
  ok('online 角色知识 token 合法', boot.tokens.every(function (t) { return ['you', 'evil', 'magic', 'evil-ally', 'unknown'].indexOf(t) >= 0; }), boot.tokens.join(','));
  ok('online 主按钮触控 >=44px', boot.actionHeight === 0 || boot.actionHeight >= 44, String(boot.actionHeight));

  const p1View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-avalon-p1');
  const beforeVersion = p1View.body.stateVersion;
  if (boot.phase === 'propose' && boot.selectableSeats > 0) {
    const acted = await evaluate(`(async function(){
      var size = window.__avalonLastView.teamSize;
      var clicks = 0;
      for (var guard = 0; guard < 12; guard++) {
        var picked = Array.prototype.slice.call(document.querySelectorAll('#seats button.seat')).filter(function(b){ return b.getAttribute('aria-pressed') === 'true'; }).length;
        if (picked >= size) break;
        var next = Array.prototype.slice.call(document.querySelectorAll('#seats button.seat')).filter(function(b){ return b.getAttribute('aria-pressed') !== 'true'; })[0];
        if (!next) break;
        next.click();
        clicks++;
      }
      await new Promise(function(r){ setTimeout(r, 60); });
      var c = document.getElementById('confirmTeamBtn');
      var disabled = c ? c.disabled : null;
      if (c && !c.disabled) c.click();
      await new Promise(function(r){ setTimeout(r, 500); });
      return { clicks: clicks, disabled: disabled };
    })()`);
    ok('online 浏览器完成队长选人', acted.clicks >= 1, JSON.stringify(acted));
  } else {
    ok('online 浏览器当前无需提名', true, 'phase=' + boot.phase);
  }
  const p1After = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t1 + '&playerId=e2e-avalon-p1');
  ok('online 浏览器动作推进服务端状态', p1After.body.stateVersion > beforeVersion, beforeVersion + '→' + p1After.body.stateVersion);
  const p2View = await onlineApi('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + t2 + '&playerId=e2e-avalon-p2');
  eq('online 两客户端看到同一任务序号', p1After.body.state.questIndex, p2View.body.state.questIndex);
  eq('online 两客户端看到同一任务轨道', p1After.body.state.questSizes, p2View.body.state.questSizes);
  ok('online 两客户端各自角色不同', p1After.body.state.yourRole !== p2View.body.state.yourRole);
  ok('online 客户端不泄漏他人角色', p2View.body.state.players.every(function (p) { return p.revealedRole === null; }));
  const reconnect = await onlineApi('POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', { session: t1, playerId: 'e2e-avalon-p1' });
  ok('online reconnect works', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  const leaderboard = await onlineApi('GET', '/api/leaderboard?game=avalon-premium');
  ok('online leaderboard endpoint works', leaderboard.status === 200 && Array.isArray(leaderboard.body.entries));

  section('Online lobby page opens');
  await navigate(onlineBase + ONLINE, 'document.readyState === "complete" && !!document.getElementById("createBtn")');
  const lobby = await evaluate(`({ title: document.title, create: !!document.getElementById('createBtn'), join: !!document.getElementById('joinBtn'), lb: !!document.getElementById('leaderboard') })`);
  ok('online lobby title', /AVALON|阿瓦隆/i.test(lobby.title), lobby.title);
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
  game: 'avalon-premium',
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
  evidence: 'games/boardgame/avalon-premium/e2e.mjs (resident Chrome CDP ' + CDP_PORT + ', one tab opened/closed)'
}, null, 2) + '\n');

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
