#!/usr/bin/env node
/* 360×800 手机审计（可复跑）——只读 catalog-status.json 里 status=shipped 的游戏。
 *
 *   NODE_PATH=/Users/fa/.npm-global/lib/node_modules \
 *     node tools/quality/audit-360.mjs
 *
 * 规则（与用户 2026-11-10 要求一致）：
 *   - 视口固定 360×800，isMobile + hasTouch；
 *   - document.scrollWidth ≤ 360（无横向滚动）；
 *   - 可见 button/a/[role=button]/棋盘热区 ≥44×44；密集棋盘格单独记录不判失败；
 *   - 页面能加载、有开局控件、能点击开局（点击后无 pageerror）；
 *   - rules.html HTTP 200。
 * 浏览器：优先复用常驻 Chrome（chrome-ensure + CDP），结束不 kill 浏览器。
 * 并发：AUDIT_CONCURRENCY，默认 2（上限 2）。
 * 输出：games/boardgame/audit/quality-360.json
 *       --only=<slugs> 时改为 games/boardgame/audit/quality-360.partial.json（不覆盖全量）
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CATALOG = path.join(ROOT, 'games/boardgame/catalog-status.json');
const OUT = path.join(ROOT, 'games/boardgame/audit/quality-360.json');
/* --only 子集审计写到独立文件，绝不动全量 quality-360.json。 */
const OUT_PARTIAL = path.join(ROOT, 'games/boardgame/audit/quality-360.partial.json');
const CHROME_PATH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_ENSURE = path.join(os.homedir(), '.local/bin/chrome-ensure');
const AUDIT_CACHE = path.join(os.homedir(), '.cache/games-quality-audit');
const PORT_FILE = path.join(AUDIT_CACHE, 'chrome-port');
const RESIDENT_PROFILE = path.join(AUDIT_CACHE, 'chrome-profile-360');
const VIEWPORT = { key: '360x800', width: 360, height: 800 };
const TOUCH_MIN = 44;
const CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.AUDIT_CONCURRENCY || 2)));
const ONLY = (() => {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  return arg ? arg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
})();

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadChromium() {
  for (const id of ['playwright', '@playwright/test', 'playwright-core']) {
    try {
      const mod = require(id);
      if (mod && mod.chromium) return mod.chromium;
    } catch { /* next */ }
  }
  throw new Error('playwright 未找到；请设置 NODE_PATH=/Users/fa/.npm-global/lib/node_modules');
}

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
    if (pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    let file = path.normalize(path.join(ROOT, pathname));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
      res.end(fs.readFileSync(file));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('404');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
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

async function probeCdp(port) {
  if (!port || !Number.isFinite(port)) return false;
  const r = await httpGet(`http://127.0.0.1:${port}/json/version`, 1200);
  return r.status === 200;
}

function candidatePorts() {
  const out = [];
  if (process.env.GAMES_AUDIT_CDP) out.push(Number(process.env.GAMES_AUDIT_CDP));
  try {
    const p = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
    if (p) out.push(p);
  } catch { /* none */ }
  out.push(9222, 9333, 9332);
  try {
    const ps = execFileSync('pgrep', ['-fl', 'remote-debugging-port='], { encoding: 'utf8' });
    for (const line of ps.split('\n')) {
      const m = line.match(/--remote-debugging-port=(\d+)/);
      if (m) out.push(Number(m[1]));
    }
  } catch { /* pgrep may fail */ }
  return [...new Set(out)];
}

async function startResidentChrome() {
  fs.mkdirSync(RESIDENT_PROFILE, { recursive: true });
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${RESIDENT_PROFILE}`,
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
    '--window-size=360,800',
    'about:blank',
  ];
  const proc = spawn(CHROME_PATH, args, { detached: true, stdio: 'ignore' });
  proc.unref();
  const activePortFile = path.join(RESIDENT_PROFILE, 'DevToolsActivePort');
  for (let i = 0; i < 120; i++) {
    try {
      const port = Number(fs.readFileSync(activePortFile, 'utf8').split('\n')[0].trim());
      if (port && await probeCdp(port)) {
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
  try { execFileSync(CHROME_ENSURE, [], { stdio: 'ignore', timeout: 30000 }); } catch { /* keep going */ }
  for (const port of candidatePorts()) {
    if (await probeCdp(port)) return { port, reused: true };
  }
  const port = await startResidentChrome();
  return { port, reused: false };
}

const probeExpr = (() => {
  const PLAY_SELECTORS = [
    '#board', '#game', '#grid', '#hand', '#table', 'canvas', '[data-board]', '#my-hand',
    '#opponents', '#rivers', '#players', '#solitaire-ui', '#freecell-ui', '#spider-ui',
    '#cards', '#form', '#lobby', '#members', '.board', '.table', '.players', '.table-text',
    '#players', '#playerList', '#quests', '.quest', '#log', '.game-log', '.played', '.hand',
    '.role-card', '.player-card',
  ];
  const NEW_SELECTORS = [
    '#btn-new', '#new', '#newGame', '#newGameBtn', '#newBtn', '#btn-new-2', '#btn-restart',
    '#restart', '#restartBtn', '#again', '#again-btn', '#againBtn', '#start', '#start-btn',
    '#startBtn', '#startGame', '#btn-reset', '#resetBtn', '#createBtn', '#btn-skip',
  ];
  const ACTION_RE = /出牌|落子|发牌|掷骰|摸牌|收下|跳过|叫牌|攻击|结束回合|确认|提交|下一|继续|pass|play|draw|roll|end turn|attack/i;
  return `(function () {
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
    return r.width > 0 && r.height > 0;
  }
  function pick(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) if (visible(els[j])) return { selector: selectors[i], el: els[j] };
    }
    return null;
  }
  var out = {};
  out.scrollWidth = Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0);
  out.innerWidth = window.innerWidth;
  out.title = document.title;

  var play = pick(${JSON.stringify(PLAY_SELECTORS)});
  out.play = play ? { selector: play.selector, rect: rect(play.el) } : null;

  var newCtl = pick(${JSON.stringify(NEW_SELECTORS)});
  if (!newCtl) {
    var buttons = document.querySelectorAll('button, a[role="button"], [role="button"], .btn');
    for (var bi = 0; bi < buttons.length; bi++) {
      var b = buttons[bi];
      if (!visible(b) || b.disabled) continue;
      var txt = (b.textContent || "").trim();
      if (!/新|开始|再来|重开|发牌|开局|创建|new|start|restart|again|deal|create|reset/i.test(txt)) continue;
      newCtl = { selector: "text:" + txt.slice(0, 20), el: b };
      break;
    }
  }
  out.newControl = newCtl ? { selector: newCtl.selector, rect: rect(newCtl.el), disabled: Boolean(newCtl.el.disabled) } : null;
  if (!out.play && out.newControl) out.play = { selector: 'start-screen:' + out.newControl.selector, rect: out.newControl.rect, startScreen: true };

  // 游戏可能直接开局（无“新游戏”按钮）：找一个当前可用的对局动作按钮作为就绪证据。
  var actionRe = ${JSON.stringify(ACTION_RE.source)};
  var actionCtl = null;
  var actBtns = document.querySelectorAll('button, [role="button"], .btn');
  for (var ai = 0; ai < actBtns.length; ai++) {
    var ab = actBtns[ai];
    if (!visible(ab)) continue;
    var atxt = (ab.textContent || '').trim();
    if (!new RegExp(actionRe, 'i').test(atxt)) continue;
    actionCtl = { selector: 'action:' + atxt.slice(0, 20), rect: rect(ab), disabled: Boolean(ab.disabled) };
    break;
  }
  out.actionControl = actionCtl;
  out.autoStart = !out.newControl && Boolean(out.play || actionCtl);

  var touchSelector = 'button, a, [role="button"], input, select, textarea, [onclick], .cell, .tile, [data-cell], [data-tile], ' +
    '.board-cell, .pit, .peg, .light, .mines-cell, .memory-card, .hole, .square, .slot, ' +
    '.pile, .column, .stack, .card, .rank, .file, .point, .node, .space, .house, .home, ' +
    '.goal, .freecell, .disc, .piece, .pawn, .checker, .die, .meeple, .token';
  var nodes = document.querySelectorAll(touchSelector);
  var violations = [], dense = [], checked = 0, minW = null, minH = null;
  for (var k = 0; k < nodes.length; k++) {
    var el = nodes[k];
    if (!visible(el)) continue;
    var cs = getComputedStyle(el);
    if (el.classList.contains('sr-only') || cs.clip === 'rect(0px, 0px, 0px, 0px)') continue;
    // 只统计真正可交互的热区：链接/按钮/表单、显式 onclick、或 cursor:pointer 的元素。
    var interactive = el.matches('a[href], button, input, select, textarea, [role="button"], [onclick]') ||
      cs.cursor === 'pointer';
    if (!interactive) continue;
    checked++;
    var r = rect(el);
    if (r.width <= 2 && r.height <= 2) continue; // 视觉隐藏的跳转链接
    if (minW == null || r.width < minW) minW = r.width;
    if (minH == null || r.height < minH) minH = r.height;
    if (r.width >= ${TOUCH_MIN} && r.height >= ${TOUCH_MIN}) continue;
    var tag = el.tagName.toLowerCase();
    var isKey = el.matches(${JSON.stringify(NEW_SELECTORS.join(','))}) ||
      el.matches('.primary, .btn.primary, .btn.danger');
    var inBoard = Boolean(el.closest('#board, #game, #grid, [data-board], .board, .grid, .board-grid, ' +
      '.play-area, .slots, .row, .track, .river, #hand, #my-hand, #opponents, #rivers, #players, #table, ' +
      '[class*="board"], [class*="grid"], [class*="track"]'));
    var isDense = inBoard && !isKey;
    var entry = {
      tag: tag, id: el.id || '', cls: String(el.getAttribute('class') || '').slice(0, 40),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 24),
      width: r.width, height: r.height
    };
    if (isDense) dense.push(entry); else violations.push(entry);
  }
  out.touch = {
    checked: checked, minWidth: minW, minHeight: minH,
    violationCount: violations.length, violations: violations.slice(0, 20),
    denseCount: dense.length, denseMin: dense.length ? Math.min.apply(null, dense.map(function (d) { return Math.min(d.width, d.height); })) : null,
    denseSamples: dense.slice(0, 6)
  };
  return out;
})()`;
})();

function loadShipped() {
  const raw = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const list = Array.isArray(raw) ? raw : raw.games || [];
  return list.filter((g) => g && g.status === 'shipped' && g.slug)
    .map((g) => ({ slug: g.slug, url: `/games/boardgame/${g.slug}/`, rules: `/games/boardgame/${g.slug}/rules.html`, mode: g.mode }));
}

async function auditOne(context, base, target) {
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url()}`); });

  let httpStatus = 0;
  try {
    const resp = await page.goto(base + target.url, { waitUntil: 'load', timeout: 20000 });
    httpStatus = resp ? resp.status() : 0;
    await page.waitForTimeout(600);
  } catch (e) {
    pageErrors.push('goto: ' + e.message);
  }

  let probe;
  try {
    probe = await page.evaluate(probeExpr);
  } catch (e) {
    pageErrors.push('probe: ' + e.message);
    probe = { scrollWidth: 0, innerWidth: 360, play: null, newControl: null, actionControl: null, autoStart: false,
      touch: { checked: 0, violationCount: 0, violations: [], denseCount: 0, denseMin: null } };
  }

  let clickError = null;
  if (probe.newControl && !probe.newControl.disabled) {
    const sel = probe.newControl.selector;
    try {
      if (sel.startsWith('text:')) {
        await page.getByText(sel.slice(5), { exact: false }).first().click({ timeout: 3000 });
      } else {
        await page.locator(sel).first().click({ timeout: 3000 });
      }
      await page.waitForTimeout(500);
    } catch (e) {
      clickError = String(e.message || e).slice(0, 160);
      try {
        await page.evaluate((s) => {
          const el = s.startsWith('text:')
            ? Array.from(document.querySelectorAll('button, a, .btn')).find((b) => (b.textContent || '').includes(s.slice(5)))
            : document.querySelector(s);
          if (el) el.click();
        }, sel);
        clickError = null;
        await page.waitForTimeout(300);
      } catch (e2) {
        clickError = String(e2.message || e2).slice(0, 160);
      }
    }
  }

  const rules = await httpGet(base + target.rules, 4000);
  const afterClickErrors = pageErrors.slice();
  page.off('pageerror', () => {});
  await page.close().catch(() => {});

  const problems = [];
  if (httpStatus !== 200) problems.push(`HTTP ${httpStatus}`);
  if (pageErrors.length) problems.push(`pageerror ${pageErrors.length}: ${pageErrors[0]}`);
  if (consoleErrors.length) problems.push(`console error ${consoleErrors.length}: ${consoleErrors[0]}`);
  if (probe.scrollWidth > VIEWPORT.width) problems.push(`横向滚动 ${probe.scrollWidth}>${VIEWPORT.width}`);
  if (!probe.play && !probe.actionControl) problems.push('缺少棋盘/开局区域');
  if (!probe.newControl && !probe.autoStart) problems.push('缺少开局/新游戏控件');
  if (clickError) problems.push(`开局点击失败: ${clickError}`);
  if (probe.touch.violationCount) {
    const v = probe.touch.violations[0];
    problems.push(`触控 <44: ${probe.touch.violationCount} 个 (如 ${v.tag}#${v.id || '-'} ${v.width}x${v.height})`);
  }
  if (rules.status !== 200) problems.push(`rules.html HTTP ${rules.status || rules.error || 0}`);

  return {
    slug: target.slug,
    mode: target.mode,
    viewport: VIEWPORT.key,
    ok: problems.length === 0,
    problems,
    httpStatus,
    scrollWidth: probe.scrollWidth,
    innerWidth: probe.innerWidth,
    overflow: probe.scrollWidth > VIEWPORT.width,
    play: probe.play,
    newControl: probe.newControl,
    actionControl: probe.actionControl || null,
    autoStart: Boolean(probe.autoStart),
    clickError,
    touch: probe.touch,
    rulesStatus: rules.status,
    pageErrors: pageErrors.slice(0, 8),
    consoleErrors: consoleErrors.slice(0, 8),
    failedResponses: failedResponses.slice(0, 8),
  };
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
  const chromium = loadChromium();
  const { port, reused } = await ensureChrome();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  const { server, base } = await startServer();
  let targets = loadShipped();
  if (ONLY) targets = targets.filter((t) => ONLY.includes(t.slug));
  console.log(`audit-360: ${targets.length} shipped games @360x800, concurrency=${CONCURRENCY}`);
  console.log(`chrome: ${reused ? 'reused resident CDP' : 'started resident CDP'} :${port}`);

  let done = 0;
  const results = await mapLimit(targets, CONCURRENCY, async (target) => {
    let r;
    try {
      r = await auditOne(context, base, target);
    } catch (e) {
      r = { slug: target.slug, mode: target.mode, viewport: VIEWPORT.key, ok: false,
        problems: ['audit crash: ' + e.message], httpStatus: 0, scrollWidth: 0,
        touch: { violationCount: 0, violations: [] }, rulesStatus: 0, pageErrors: [], consoleErrors: [], failedResponses: [] };
    }
    done++;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.slug.padEnd(26)} ${r.ok ? '360 PASS' : r.problems.join('; ')}`);
    return r;
  });

  await context.close().catch(() => {});
  const finishedAt = new Date();
  const outFile = ONLY ? OUT_PARTIAL : OUT;
  const pass = results.filter((r) => r.ok).length;
  const report = {
    generatedAt: finishedAt.toISOString(),
    runner: 'tools/quality/audit-360.mjs',
    scope: 'games/boardgame/catalog-status.json status=shipped',
    ...(ONLY ? { partial: true, only: ONLY } : {}),
    viewport: VIEWPORT,
    touchMin: TOUCH_MIN,
    concurrency: CONCURRENCY,
    chrome: { port, mode: reused ? 'cdp-reuse-resident' : 'cdp-start-resident' },
    durationMs: finishedAt - startedAt,
    summary: { total: results.length, pass, fail: results.length - pass, failSlugs: results.filter((r) => !r.ok).map((r) => r.slug) },
    results,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n=== SUMMARY ===`);
  console.log(`360x800: PASS ${pass}/${results.length}, FAIL ${results.length - pass}` +
    (report.summary.failSlugs.length ? ` -> ${report.summary.failSlugs.join(', ')}` : ''));
  console.log(`report: ${path.relative(ROOT, outFile)}` + (ONLY ? ' (partial; quality-360.json untouched)' : ''));
  server.close();
  process.exit(report.summary.fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
