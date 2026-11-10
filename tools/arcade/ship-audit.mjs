#!/usr/bin/env node
/* 街机 / 原站点 / 多人样板的两档手机冒烟审计（可复跑）。
 *
 *   NODE_PATH=/Users/fa/.npm-global/lib/node_modules node tools/arcade/ship-audit.mjs
 *   ... --strict            # draft 失败也让退出码为 1
 *   ... --only=2048,pong    # 只跑指定 slug（调试用）
 *   ... --no-lobby          # 跳过三个大厅
 *
 * 浏览器复用：先执行 ~/.local/bin/chrome-ensure；优先连接已常驻且开了
 * --remote-debugging-port 的 Chrome（CDP），没有才启动一次常驻实例并复用，
 * 结束时不 kill 浏览器。
 *
 * 两档视口：390×844 与 320×568。每款断言：
 *   - document.scrollWidth ≤ 视口宽
 *   - 无 pageerror / console error / 4xx-5xx 资源
 *   - 关键元素存在、可点击「新游戏」控件
 *   - 可见 button/a/[role=button]/棋盘格热区 ≥44×44（密集棋盘格例外但记录实际尺寸）
 *   - 关键文本 computed font-size ≥12px
 *   - 单人游戏详情页明确标注「单人」
 * 结果写入 games/quality-report.json（可见、可提交）。
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ROOT, VIEWPORTS, allTargets, singleLabelOf } from '../quality/registry.mjs';

const REPORT_PATH = path.join(ROOT, 'games/quality-report.json');
const STATUS_FILE = path.join(ROOT, 'games/boardgame/catalog-status.json');
const CHROME_PATH = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ENSURE = path.join(os.homedir(), '.local/bin/chrome-ensure');
const AUDIT_CACHE = path.join(os.homedir(), '.cache/games-quality-audit');
const PORT_FILE = path.join(AUDIT_CACHE, 'chrome-port');
const AUDIT_PROFILE = path.join(AUDIT_CACHE, 'chrome-profile');
const PROGRESS_FILE = path.join(AUDIT_CACHE, 'progress.json');
const TOUCH_MIN = 44;
const FONT_MIN = 12;
const CONCURRENCY = Math.min(4, Number(process.env.AUDIT_CONCURRENCY || 3));
const STRICT = process.argv.includes('--strict');
const RESUME = process.argv.includes('--resume');
const NO_LOBBY = process.argv.includes('--no-lobby');
const SHIPPED_ONLY = process.argv.includes('--shipped-only');
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  return arg ? arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
})();

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadChromium() {
  const candidates = ['playwright', '@playwright/test', 'playwright-core'];
  for (const id of candidates) {
    try {
      const mod = require(id);
      if (mod && mod.chromium) return mod.chromium;
    } catch { /* try next */ }
  }
  throw new Error(
    'playwright 未找到。请设置：NODE_PATH=/Users/fa/.npm-global/lib/node_modules'
  );
}

// ---------------------------------------------------------------------------
// 静态服务器
// ---------------------------------------------------------------------------
function mime(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  })[ext] || 'application/octet-stream';
}

function startServer() {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    let file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      const body = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode || 0 }));
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ status: 0, error: 'timeout' });
    });
  });
}

// ---------------------------------------------------------------------------
// 常驻 Chrome / CDP 复用
// ---------------------------------------------------------------------------
function candidatePorts() {
  const out = [];
  if (process.env.GAMES_AUDIT_CDP) out.push(Number(process.env.GAMES_AUDIT_CDP));
  try {
    const p = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    if (p) out.push(p);
  } catch { /* none */ }
  try {
    const ps = execFileSync('pgrep', ['-fl', 'Google Chrome'], { encoding: 'utf8' });
    for (const line of ps.split('\n')) {
      if (!/--remote-debugging-port=\d+/.test(line)) continue;
      if (!/--headless|game-smoke|games-quality|boardgame-cdp/.test(line)) continue;
      const m = line.match(/--remote-debugging-port=(\d+)/);
      if (m) out.push(Number(m[1]));
    }
  } catch { /* pgrep may fail */ }
  return [...new Set(out)];
}

async function probe(port) {
  if (!port || !Number.isFinite(port)) return false;
  const r = await httpGet(`http://127.0.0.1:${port}/json/version`, 1200);
  return r.status === 200;
}

async function startResidentChrome() {
  fs.mkdirSync(AUDIT_PROFILE, { recursive: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${AUDIT_PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--window-size=390,844',
    'about:blank',
  ];
  const proc = spawn(CHROME_PATH, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  const activePortFile = path.join(AUDIT_PROFILE, 'DevToolsActivePort');
  for (let i = 0; i < 120; i++) {
    try {
      const port = Number(fs.readFileSync(activePortFile, 'utf8').split('\n')[0].trim());
      if (port && await probe(port)) {
        fs.mkdirSync(AUDIT_CACHE, { recursive: true });
        fs.writeFileSync(PORT_FILE, String(port));
        return port;
      }
    } catch { /* not ready */ }
    await sleep(150);
  }
  throw new Error('常驻 Chrome 启动失败');
}

async function ensureChrome() {
  try {
    execFileSync(CHROME_ENSURE, [], { stdio: 'ignore', timeout: 30000 });
  } catch (e) {
    console.warn('chrome-ensure 失败（继续尝试 CDP）:', e.message);
  }
  for (const port of candidatePorts()) {
    if (await probe(port)) return { port, reused: true };
  }
  const port = await startResidentChrome();
  return { port, reused: false };
}

// ---------------------------------------------------------------------------
// 页面内探针
// ---------------------------------------------------------------------------
const PLAY_SELECTORS = [
  '#board', '#game', '#grid', '#hand', '#table', 'canvas', '[data-board]', '#my-hand',
  '#opponents', '#rivers', '#players', '#solitaire-ui', '#freecell-ui', '#spider-ui',
  '#cards', '#form', '#soup-title', '#soup-riddle', '.riddle', '#ov-hand', '#hand-title',
  '#pass-title', '#elim-card', '#lobby', '#members',
];
const NEW_SELECTORS = [
  '#btn-new', '#new', '#newGame', '#newBtn', '#btn-new-2', '#btn-restart', '#restart',
  '#again', '#again-btn', '#start', '#start-btn', '#btn-reset', '#resetBtn', '#createBtn',
  '#btn-skip',
];
const KEY_TEXT_SELECTORS = [
  'h1', '#page-title', '#status', '#stat-score', '#stat-best', '#score', '#result-title',
  '#phase-badge', '.score', '.status', '.lede', '.note', '.hint', '.desc',
  '#btn-new', '#new', '#newGame', '#newBtn', '#start', '#start-btn', '#btn-reset',
  '.primary', 'button.primary',
];

const probeExpr = `(function () {
  "use strict";
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  }
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (typeof el.checkVisibility === "function") {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch (e) { return true; }
    }
    return true;
  }
  function pick(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        if (visible(els[j])) return { selector: selectors[i], el: els[j] };
      }
    }
    return null;
  }
  var out = {};
  out.scrollWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0
  );
  out.innerWidth = window.innerWidth;
  out.title = document.title;
  out.lang = document.documentElement.lang;

  var play = pick(${JSON.stringify(PLAY_SELECTORS)});
  out.play = play ? { selector: play.selector, rect: rect(play.el) } : null;

  var pickedNew = pick(${JSON.stringify(NEW_SELECTORS)});
  if (!pickedNew) {
    var buttons = document.querySelectorAll('button, a[role="button"], [role="button"]');
    for (var bi = 0; bi < buttons.length; bi++) {
      var b = buttons[bi];
      if (!visible(b) || b.disabled) continue;
      var txt = (b.textContent || "").trim();
      if (!/新|开始|再来|重开|发牌|开局|创建|new|start|restart|again|deal|create|reset/i.test(txt)) continue;
      pickedNew = { selector: "text:" + txt.slice(0, 20), el: b };
      break;
    }
  }
  out.newControl = pickedNew ? {
    selector: pickedNew.selector,
    rect: rect(pickedNew.el),
    disabled: Boolean(pickedNew.el.disabled)
  } : null;
  // 有开始/新局按钮但棋盘在开局后才出现：把开始页视为有效 play area。
  if (!out.play && out.newControl) {
    out.play = { selector: 'start-screen:' + out.newControl.selector, rect: out.newControl.rect, startScreen: true };
  }

  var touchSelector = 'button, a, [role="button"], .cell, .tile, [data-cell], [data-tile], ' +
    '.board-cell, .pit, .peg, .light, .mines-cell, .memory-card, .hole, .square, .slot, ' +
    '.pile, .column, .stack, .card, .rank, .file, .point, .node, .space, .house, .home, ' +
    '.goal, .freecell, .disc, .piece, .pawn, .checker, .die';
  var nodes = document.querySelectorAll(touchSelector);
  var violations = [];
  var dense = [];
  var checked = 0;
  var minW = null, minH = null;
  var keyControlSel = ${JSON.stringify(NEW_SELECTORS.join(','))};
  var keyControlList = keyControlSel.split(',');
  for (var k = 0; k < nodes.length; k++) {
    var el = nodes[k];
    if (!visible(el)) continue;
    checked++;
    var r = rect(el);
    if (minW == null || r.width < minW) minW = r.width;
    if (minH == null || r.height < minH) minH = r.height;
    var tag = el.tagName.toLowerCase();
    var id = el.id || "";
    var cls = el.getAttribute("class") || "";
    var isKeyControl = keyControlList.some(function (s) { return s && el.matches(s); }) ||
      el.matches(".primary, .btn.primary, .btn.danger");
    var inBoard = Boolean(el.closest('#board, #game, #grid, [data-board], .board, #hand, #my-hand, #opponents, #rivers, #players'));
    var isBoardCell = inBoard && !isKeyControl && (
      el.matches('.cell, .tile, [data-cell], [data-tile], .board-cell, .pit, .peg, .light, .mines-cell, .memory-card, .hole, .square, .slot, .pile, .column, .stack, .card, .rank, .file, .point, .node, .space, .house, .home, .goal, .freecell, .disc, .piece, .pawn, .checker, .die') ||
      tag === 'button'
    );
    if (r.width < ${TOUCH_MIN} || r.height < ${TOUCH_MIN}) {
      var entry = {
        tag: tag,
        id: id,
        cls: String(cls).slice(0, 40),
        text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 28),
        width: r.width,
        height: r.height
      };
      if (isBoardCell) dense.push(entry);
      else violations.push(entry);
    }
  }
  out.touch = {
    checked: checked,
    minWidth: minW,
    minHeight: minH,
    violations: violations.slice(0, 20),
    violationCount: violations.length,
    denseCount: dense.length,
    denseMin: dense.length ? Math.min.apply(null, dense.map(function (d) { return Math.min(d.width, d.height); })) : null,
    denseSamples: dense.slice(0, 8)
  };

  var fonts = [];
  var fontViolations = [];
  var kt = document.querySelectorAll(${JSON.stringify(KEY_TEXT_SELECTORS.join(','))});
  for (var fi = 0; fi < kt.length; fi++) {
    var fe = kt[fi];
    if (!visible(fe)) continue;
    if (fe.closest('[aria-hidden="true"], .sr-only, footer, small, .eyebrow, .header-note, .latin, .tags, .more')) continue;
    var txt2 = (fe.textContent || "").trim();
    if (!txt2) continue;
    var px = parseFloat(getComputedStyle(fe).fontSize);
    if (!isFinite(px)) continue;
    fonts.push(px);
    if (px < ${FONT_MIN}) {
      fontViolations.push({
        tag: fe.tagName.toLowerCase(),
        id: fe.id || "",
        cls: String(fe.getAttribute("class") || "").slice(0, 40),
        text: txt2.replace(/\\s+/g, " ").slice(0, 28),
        fontSize: px
      });
    }
  }
  out.fonts = {
    checked: fonts.length,
    min: fonts.length ? Math.min.apply(null, fonts) : null,
    violations: fontViolations.slice(0, 12),
    violationCount: fontViolations.length
  };

  out.jsonLd = [];
  var scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (var li = 0; li < scripts.length; li++) {
    try { out.jsonLd.push(JSON.parse(scripts[li].textContent)); }
    catch (e) { out.jsonLd.push({ __error: String(e.message) }); }
  }
  return out;
})()`;

function chooseClickTarget(probe) {
  return probe && probe.newControl ? probe.newControl.selector : null;
}

function summarizeProblems(r) {
  const p = [];
  if (r.httpStatus !== 200) p.push(`page HTTP ${r.httpStatus}`);
  if (r.pageErrors.length) p.push(`pageerror ${r.pageErrors.length}: ${r.pageErrors[0]}`);
  if (r.consoleErrors.length) p.push(`console error ${r.consoleErrors.length}: ${r.consoleErrors[0]}`);
  if (r.failedResponses.length) p.push(`HTTP ${r.failedResponses[0]}`);
  if (r.scrollWidth > r.viewportWidth) p.push(`overflow ${r.scrollWidth}>${r.viewportWidth}`);
  if (!r.play) p.push('missing play area');
  if (!r.newControl) p.push('missing new-game control');
  if (r.clickError) p.push(`click new: ${r.clickError}`);
  if (r.touch.violationCount) {
    const v = r.touch.violations[0];
    p.push(`touch <44: ${r.touch.violationCount} (e.g. ${v.tag}#${v.id || '-'} ${v.width}x${v.height})`);
  }
  if (r.fonts.violationCount) {
    const f = r.fonts.violations[0];
    p.push(`font <12: ${r.fonts.violationCount} (e.g. ${f.text} ${f.fontSize}px)`);
  }
  if (!r.rules.ok) p.push(`rules: ${r.rules.note}`);
  if (!r.single.ok) p.push(`single label: ${r.single.note}`);
  return p;
}

async function auditOne(browser, base, target, vp, context) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const onPageError = (e) => pageErrors.push(String(e && e.message ? e.message : e));
  const onConsole = (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  const onResponse = (r) => {
    if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);

  const url = `${base}${target.url}`;
  let httpStatus = 0;
  const t0 = Date.now();
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    httpStatus = resp ? resp.status() : 0;
  } catch (e) {
    pageErrors.push('goto: ' + e.message);
  }
  await page.waitForTimeout(650);

  let probe;
  try {
    probe = await page.evaluate(probeExpr);
  } catch (e) {
    pageErrors.push('probe: ' + e.message);
    probe = {
      scrollWidth: 0, innerWidth: vp.width, play: null, newControl: null,
      touch: { checked: 0, violationCount: 0, violations: [], denseCount: 0 },
      fonts: { checked: 0, violationCount: 0, violations: [], min: null },
    };
  }
  const loadMs = Date.now() - t0;

  let clickError = null;
  const clickSelector = chooseClickTarget(probe);
  if (clickSelector) {
    try {
      const handle = await page.locator(clickSelector).first();
      await handle.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
      await handle.click({ timeout: 3000 });
      await page.waitForTimeout(450);
    } catch (e) {
      clickError = String(e.message || e).slice(0, 160);
      // 退化到 DOM click，仍算“可点击”证据。
      try {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, clickSelector);
        clickError = null;
        await page.waitForTimeout(250);
      } catch (e2) {
        clickError = String(e2.message || e2).slice(0, 160);
      }
    }
  }

  const rules = { ok: true, status: 0, note: 'n/a' };
  if (target.rules) {
    const r = await httpGet(`${base}${target.rules}`, 4000);
    rules.status = r.status;
    if (r.status !== 200) {
      rules.ok = false;
      rules.note = `rules.html HTTP ${r.status || r.error || '0'}`;
    } else {
      rules.note = 'rules.html HTTP 200';
    }
  }
  const single = target.players === 'single'
    ? singleLabelOf(target)
    : { ok: true, note: 'not required (' + target.players + ')' };

  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  page.off('response', onResponse);
  await page.close().catch(() => {});

  const r = {
    slug: target.slug,
    kind: target.kind,
    players: target.players,
    viewport: vp.key,
    viewportWidth: vp.width,
    httpStatus,
    loadMs,
    scrollWidth: probe.scrollWidth || 0,
    innerWidth: probe.innerWidth || vp.width,
    play: probe.play,
    newControl: probe.newControl,
    clickSelector,
    clickError,
    touch: probe.touch,
    fonts: probe.fonts,
    rules,
    single,
    pageErrors: pageErrors.slice(0, 8),
    pageErrorCount: pageErrors.length,
    consoleErrors: consoleErrors.slice(0, 8),
    consoleErrorCount: consoleErrors.length,
    failedResponses: failedResponses.slice(0, 8),
  };
  r.problems = summarizeProblems(r);
  r.ok = r.problems.length === 0;
  return r;
}

async function auditLobby(browser, base, pathname, vp, context, statusMap) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const onPageError = (e) => pageErrors.push(String(e && e.message ? e.message : e));
  const onConsole = (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); };
  const onResponse = (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`); };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  page.on('response', onResponse);
  let httpStatus = 0;
  try {
    const resp = await page.goto(base + pathname, { waitUntil: 'load', timeout: 20000 });
    httpStatus = resp ? resp.status() : 0;
  } catch (e) {
    pageErrors.push('goto: ' + e.message);
  }
  await page.waitForTimeout(500);
  let info;
  try {
    info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.game-card'));
      const hrefs = cards.map((c) => {
        const a = c.querySelector('a[href]');
        return a ? a.getAttribute('href') : '';
      }).filter(Boolean);
      const slugs = cards.map((c) => c.getAttribute('data-slug')).filter(Boolean);
      let jsonLd = [];
      try {
        jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((s) => { try { return JSON.parse(s.textContent); } catch (e) { return { __error: String(e.message) }; } });
      } catch (e) { jsonLd = [{ __error: String(e.message) }]; }
      function findList(obj) {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj.itemListElement)) return obj;
        for (const v of Object.values(obj)) {
          const found = findList(v);
          if (found) return found;
        }
        return null;
      }
      const list = jsonLd.map(findList).find(Boolean) || null;
      return {
        scrollWidth: Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0),
        innerWidth: window.innerWidth,
        cards: cards.length,
        hrefs,
        slugs,
        hasSearch: !!document.getElementById('game-search'),
        jsonLdCount: jsonLd.length,
        jsonLdErrors: jsonLd.filter((x) => x && x.__error).map((x) => x.__error),
        itemListCount: list && Array.isArray(list.itemListElement) ? list.itemListElement.length : null,
        numberOfItems: list ? list.numberOfItems : null,
        itemUrls: list && Array.isArray(list.itemListElement)
          ? list.itemListElement.map((x) => x.url || '').filter(Boolean) : [],
      };
    });
  } catch (e) {
    pageErrors.push('probe: ' + e.message);
    info = { scrollWidth: 0, innerWidth: vp.width, cards: 0, hrefs: [], slugs: [], hasSearch: false,
      jsonLdCount: 0, jsonLdErrors: [], itemListCount: null, numberOfItems: null, itemUrls: [] };
  }
  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  page.off('response', onResponse);
  await page.close().catch(() => {});

  const problems = [];
  if (httpStatus !== 200) problems.push(`HTTP ${httpStatus}`);
  if (pageErrors.length) problems.push(`pageerror ${pageErrors.length}: ${pageErrors[0]}`);
  if (consoleErrors.length) problems.push(`console error ${consoleErrors.length}: ${consoleErrors[0]}`);
  if (failedResponses.length) problems.push(`HTTP ${failedResponses[0]}`);
  if (info.scrollWidth > vp.width) problems.push(`overflow ${info.scrollWidth}>${vp.width}`);
  if (!info.hasSearch) problems.push('missing #game-search');
  if (info.jsonLdErrors.length) problems.push(`JSON-LD parse: ${info.jsonLdErrors[0]}`);
  if (info.itemListCount == null) problems.push('missing ItemList');
  if (info.itemListCount != null && info.numberOfItems !== info.itemListCount) {
    problems.push(`numberOfItems ${info.numberOfItems} != entries ${info.itemListCount}`);
  }
  if (info.itemListCount != null && info.cards !== info.itemListCount) {
    problems.push(`cards ${info.cards} != ItemList ${info.itemListCount}`);
  }
  if (statusMap) {
    const draftSlugs = info.slugs.filter((s) => statusMap.get(s) && statusMap.get(s) !== 'shipped');
    if (draftSlugs.length) problems.push(`draft cards: ${draftSlugs.slice(0, 8).join(',')}`);
    const draftUrls = info.itemUrls.filter((u) => {
      const m = String(u).match(/\/games\/([^/]+)\/?$/);
      return m && statusMap.get(m[1]) && statusMap.get(m[1]) !== 'shipped';
    });
    if (draftUrls.length) problems.push(`draft ItemList: ${draftUrls.slice(0, 8).join(',')}`);
  }
  return {
    pathname,
    viewport: vp.key,
    ok: problems.length === 0,
    problems,
    httpStatus,
    cards: info.cards,
    scrollWidth: info.scrollWidth,
    innerWidth: info.innerWidth,
    hasSearch: info.hasSearch,
    jsonLdCount: info.jsonLdCount,
    itemListCount: info.itemListCount,
    numberOfItems: info.numberOfItems,
    hrefs: info.hrefs,
    pageErrors,
    consoleErrors,
    failedResponses,
  };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
function loadStatusMap() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    const map = new Map();
    const list = Array.isArray(raw) ? raw : raw.games || [];
    for (const g of list) if (g && g.slug) map.set(g.slug, g.status);
    return map;
  } catch {
    return null;
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function main() {
  const startedAt = new Date();
  const cpuStart = process.cpuUsage();
  let peakRss = process.memoryUsage().rss;
  const memTimer = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 400);
  const chromium = loadChromium();
  const { port, reused } = await ensureChrome();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = new Map();
  for (const vp of VIEWPORTS) {
    contexts.set(vp.key, await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    }));
  }

  const { server, base } = await startServer();
  let targets = allTargets();
  if (ONLY) targets = targets.filter((t) => ONLY.includes(t.slug));
  console.log(`ship-audit: ${targets.length} games × ${VIEWPORTS.length} viewports @ ${base}`);
  console.log(`chrome: ${reused ? 'reused resident CDP' : 'started resident CDP'} :${port}`);

  const jobs = [];
  for (const target of targets) {
    for (const vp of VIEWPORTS) {
      jobs.push({ target, vp });
    }
  }
  // 可中断可续跑：进度落盘到缓存目录，--resume 时跳过已完成 job。
  const runKey = targets.map((t) => t.slug).join(',') + '|' + VIEWPORTS.map((v) => v.key).join(',');
  let progress = { runKey, completed: {} };
  if (RESUME) {
    try {
      const saved = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      if (saved && saved.runKey === runKey) progress = saved;
    } catch { /* start fresh */ }
  }
  let progressDirty = 0;
  function saveProgress() {
    try {
      fs.mkdirSync(AUDIT_CACHE, { recursive: true });
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress) + '\n');
    } catch { /* best effort */ }
  }
  process.on('SIGINT', () => {
    saveProgress();
    console.log('\ninterrupted; progress saved to ' + PROGRESS_FILE + ' (rerun with --resume)');
    process.exit(130);
  });
  let done = 0;
  const rows = await mapLimit(jobs, CONCURRENCY, async ({ target, vp }) => {
    const key = `${target.slug}@${vp.key}`;
    if (progress.completed[key]) return progress.completed[key];
    let r;
    try {
      r = await auditOne(browser, base, target, vp, contexts.get(vp.key));
    } catch (e) {
      r = {
        slug: target.slug, kind: target.kind, players: target.players, viewport: vp.key,
        viewportWidth: vp.width, ok: false, problems: ['audit crash: ' + e.message],
        httpStatus: 0, scrollWidth: 0, touch: { violationCount: 0, violations: [] },
        fonts: { violationCount: 0, violations: [] }, rules: { ok: false, note: 'crash' },
        single: { ok: true, note: 'n/a' }, pageErrors: [], consoleErrors: [], failedResponses: [],
      };
    }
    progress.completed[key] = r;
    progressDirty += 1;
    done += 1;
    if (progressDirty % 5 === 0) saveProgress();
    if (done % 10 === 0) console.log(`... progress ${done}/${jobs.length}`);
    return r;
  });
  saveProgress();

  // 合并每款两档结果。
  const bySlug = new Map();
  for (const r of rows) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, { slug: r.slug, kind: r.kind, players: r.players, viewports: {}, problems: [] });
    }
    const g = bySlug.get(r.slug);
    g.viewports[r.viewport] = r;
    if (!r.ok) g.problems.push(`${r.viewport}: ${r.problems.join('; ')}`);
  }
  const games = Array.from(bySlug.values()).map((g) => {
    g.ok = VIEWPORTS.every((vp) => g.viewports[vp.key] && g.viewports[vp.key].ok);
    return g;
  });

  for (const g of games) {
    const marks = VIEWPORTS.map((vp) => {
      const r = g.viewports[vp.key];
      return `${vp.key}:${r && r.ok ? 'PASS' : 'FAIL'}`;
    }).join(' ');
    console.log(`${g.ok ? 'OK  ' : 'FAIL'} ${g.slug.padEnd(18)} ${marks}` +
      (g.ok ? '' : `  ${g.problems[0]}`));
  }

  // 大厅（只在 390 档做死链检查，两档都做布局/计数）。
  // 默认不过滤 draft；只有 --shipped-only 才把 draft 卡片视为问题。
  const statusMap = SHIPPED_ONLY ? loadStatusMap() : null;
  const lobbies = [];
  if (!NO_LOBBY) {
    const lobbyPaths = ['/games/', '/games/en/', '/games/id/'];
    const linkChecks = new Map();
    for (const p of lobbyPaths) {
      const r = await auditLobby(browser, base, p, VIEWPORTS[0], contexts.get(VIEWPORTS[0].key), statusMap);
      const dead = [];
      for (const href of [...new Set(r.hrefs)]) {
        if (linkChecks.has(href)) continue;
        const url = href.startsWith('http') ? href : base + (href.startsWith('/') ? href : '/' + href);
        const res = await httpGet(url, 5000);
        linkChecks.set(href, res.status);
        if (res.status !== 200) dead.push(`${href} -> ${res.status || res.error}`);
      }
      r.deadLinks = dead;
      if (dead.length) {
        r.ok = false;
        r.problems.push(`dead links: ${dead.slice(0, 6).join('; ')}`);
      }
      lobbies.push(r);
      console.log(`${r.ok ? 'OK  ' : 'FAIL'} lobby ${p} @390 (${r.cards} cards)` +
        (r.ok ? '' : `: ${r.problems.join('; ')}`));
      const r320 = await auditLobby(browser, base, p, VIEWPORTS[1], contexts.get(VIEWPORTS[1].key), statusMap);
      r320.deadLinks = dead;
      if (dead.length) {
        r320.ok = false;
        r320.problems.push(`dead links: ${dead.slice(0, 6).join('; ')}`);
      }
      lobbies.push(r320);
      console.log(`${r320.ok ? 'OK  ' : 'FAIL'} lobby ${p} @320 (${r320.cards} cards)` +
        (r320.ok ? '' : `: ${r320.problems.join('; ')}`));
    }
  }

  for (const vp of VIEWPORTS) {
    await contexts.get(vp.key).close().catch(() => {});
  }
  // 不关闭 browser：CDP 连接断开后常驻 Chrome 继续后台运行。
  clearInterval(memTimer);
  const finishedAt = new Date();
  const durationMs = finishedAt - startedAt;
  const cpu = process.cpuUsage(cpuStart);
  const nodeCpuMs = Math.round((cpu.user + cpu.system) / 1000);
  const nodeCpuPercent = durationMs > 0 ? Math.round((nodeCpuMs / durationMs) * 1000) / 10 : 0;

  const perViewport = {};
  for (const vp of VIEWPORTS) {
    const list = games.map((g) => g.viewports[vp.key]).filter(Boolean);
    perViewport[vp.key] = {
      total: list.length,
      pass: list.filter((r) => r.ok).length,
      fail: list.filter((r) => !r.ok).length,
      failSlugs: list.filter((r) => !r.ok).map((r) => r.slug),
      failDetails: Object.fromEntries(list.filter((r) => !r.ok).map((r) => [r.slug, r.problems])),
    };
  }
  const prior = RESUME ? readJson(REPORT_PATH) : null;
  const report = {
    generatedAt: new Date().toISOString(),
    runner: 'tools/arcade/ship-audit.mjs',
    mode: reused ? 'cdp-reuse-resident' : 'cdp-start-resident',
    chromePort: port,
    concurrency: CONCURRENCY,
    lobbyFilter: SHIPPED_ONLY ? 'shipped-only' : 'unfiltered',
    lobbyCheckedAt: finishedAt.toISOString(),
    // --resume 只补大厅/增量数据时，保留上一次完整批量跑的耗时与峰值内存。
    timing: RESUME && prior && prior.timing ? prior.timing : {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
    },
    lastRun: {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs,
      peakRssMB: Math.round((peakRss / 1024 / 1024) * 10) / 10,
      nodeCpuPercentOfOneCore: nodeCpuPercent,
    },
    resources: RESUME && prior && prior.resources ? prior.resources : {
      peakRssBytes: peakRss,
      peakRssMB: Math.round((peakRss / 1024 / 1024) * 10) / 10,
      nodeCpuMs,
      nodeCpuPercentOfOneCore: nodeCpuPercent,
      loadavg: os.loadavg().map((n) => Math.round(n * 100) / 100),
      progressFile: PROGRESS_FILE,
    },
    viewports: VIEWPORTS,
    thresholds: { touchMin: TOUCH_MIN, fontSizeMin: FONT_MIN },
    games: {
      count: games.length,
      bothPass: games.filter((g) => g.ok).length,
      bothFail: games.filter((g) => !g.ok).length,
      perViewport,
      results: games,
    },
    lobbies,
    lobbyOk: lobbies.every((l) => l.ok),
    notes: [
      '密集棋盘格（#board/#game/#grid 内）小于 44×44 时不计失败，但 touch.denseSamples 记录实际尺寸。',
      '关键按钮（新游戏/开始/重开等 .primary）必须 ≥44×44；键盘/链接热区同样按 44 断言。',
      '关键文本选择器见脚本 KEY_TEXT_SELECTORS；装饰性小字（eyebrow/header-note/latin/tags）不计入。',
    ],
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n=== SUMMARY ===`);
  for (const vp of VIEWPORTS) {
    const s = perViewport[vp.key];
    console.log(`${vp.key}: PASS ${s.pass}/${s.total}, FAIL ${s.fail}` +
      (s.failSlugs.length ? ` -> ${s.failSlugs.join(', ')}` : ''));
  }
  console.log(`both viewports PASS: ${report.games.bothPass}/${report.games.count}`);
  if (!NO_LOBBY) console.log(`lobbies: ${lobbies.filter((l) => l.ok).length}/${lobbies.length} pass`);
  console.log(`report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`duration: ${(durationMs / 1000).toFixed(1)}s; peak node RSS ${(peakRss / 1024 / 1024).toFixed(1)}MB; node CPU ${nodeCpuPercent}% of one core; concurrency ${CONCURRENCY}`);
  server.close();

  const shipped = statusMap
    ? games.filter((g) => statusMap.get(g.slug) === 'shipped')
    : [];
  const shippedFail = shipped.filter((g) => !g.ok);
  const exitBad = shippedFail.length > 0 || (!NO_LOBBY && lobbies.some((l) => !l.ok)) ||
    (STRICT && games.some((g) => !g.ok));
  if (shippedFail.length) {
    console.log(`shipped but failing: ${shippedFail.map((g) => g.slug).join(', ')}`);
  }
  process.exit(exitBad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
