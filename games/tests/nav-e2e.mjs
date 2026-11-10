#!/usr/bin/env node
'use strict';

/*
 * Full-site navigation E2E + entry inventory.
 *
 * Re-run:
 *   node games/tests/nav-e2e.mjs
 *   node games/tests/nav-e2e.mjs --json reports/nav-e2e-latest.json
 *   node games/tests/nav-e2e.mjs --port 8123 --verbose
 *
 * What it does
 *   1) Three-game 360x800 E2E:
 *        premium (catalog shipped)  games/ -> boardgame feature card ->
 *                                   games/boardgame/ -> azul-premium
 *        arcade  (GAME_STATUS draft) games/          -> 2048
 *        draft   (catalog draft)     direct URL      -> boardgame/azul
 *      Each run asserts: hall URL, link/entry hit, game URL, visible+hit
 *      start control, click without console/exception/resource errors, and
 *      history.back() returning to the previous hall URL/scroll position.
 *   2) Connectivity inventory: every <a href> in games/index.html (zh/en/id)
 *      and games/boardgame/index.html that points at a game page is fetched
 *      (redirects followed manually, max 5). 404/placeholder/redirect-loop is
 *      a failure.  Actual pages are enumerated and compared both ways.
 *   3) Draft exposure: links whose target is draft in
 *      games/GAME_STATUS.json (root games) or games/boardgame/catalog-status.json
 *      (boardgame catalog) are listed as findings.
 *
 * The static server is started from this worktree on a random loopback port
 * and shut down at the end. The resident Chrome is reused via the existing
 * games/boardgame/tests/lib/browser.mjs helper: it only opens/closes ONE tab,
 * never starts/kills the user's Chrome when a resident endpoint already exists.
 *
 * Exit code: 0 when every E2E check and every connectivity check passes;
 * 1 otherwise. Direction-B gaps and draft exposure are reported as findings,
 * not as runner failures (draft pages are allowed to have no entry).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../tools/serve.mjs';
import { withChrome } from '../boardgame/tests/lib/browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LIST_PAGES = [
  'games/index.html',
  'games/en/index.html',
  'games/id/index.html',
  'games/boardgame/index.html'
];
const RESERVED_ROOT = new Set(['en', 'id', 'boardgame', 'assets', 'shared', 'tests', 'data', 'audit', 'scripts']);
const RESERVED_BOARDGAME = new Set([
  'app', 'assets', 'audit', 'board', 'build.mjs', 'collector', 'data', 'demo',
  'engine', 'lib.mjs', 'mini', 'play', 'plugin', 'schema', 'scripts', 'server',
  'tests'
]);
const VIEWPORT = { width: 360, height: 800 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseArgs(argv) {
  const opts = { json: null, port: 0, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = path.resolve(argv[++i] || '');
    else if (arg.startsWith('--json=')) opts.json = path.resolve(arg.slice(7));
    else if (arg === '--port') opts.port = Number(argv[++i]) || 0;
    else if (arg.startsWith('--port=')) opts.port = Number(arg.slice(7)) || 0;
    else if (arg === '--verbose') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node games/tests/nav-e2e.mjs [--json out.json] [--port N] [--verbose]');
      process.exit(0);
    } else {
      throw new Error('unknown argument: ' + arg);
    }
  }
  return opts;
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function safeRead(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch (err) { return ''; }
}

/* ------------------------------------------------------------------ *
 * Inventory parsing
 * ------------------------------------------------------------------ */

function normalizePath(href, pageRel) {
  let value = href;
  if (/^https?:/i.test(value)) {
    const absolute = new URL(value);
    if (!/^\/games\//.test(absolute.pathname)) return null;
    value = absolute.pathname + absolute.search;
  }
  if (!value || value.charAt(0) === '#' || /^(mailto|tel|javascript|data):/i.test(value)) return null;
  const resolved = new URL(value, 'http://nav.local/' + pageRel);
  let pathname;
  try { pathname = decodeURIComponent(resolved.pathname); }
  catch (err) { return null; }
  return path.posix.normalize(pathname);
}

function isGameLink(pathname) {
  if (!pathname) return false;
  const rootDir = pathname.match(/^\/games\/([a-z0-9][a-z0-9-]*)\/$/);
  if (rootDir && !RESERVED_ROOT.has(rootDir[1])) return true;
  const bgDir = pathname.match(/^\/games\/boardgame\/([a-z0-9][a-z0-9-]*)\/$/);
  if (bgDir && !RESERVED_BOARDGAME.has(bgDir[1])) return true;
  return /^\/games\/boardgame\/board\/[a-z0-9-]+\.html$/.test(pathname);
}

function parseLinks() {
  const links = new Map();
  const sourcesByPath = new Map();
  for (const pageRel of LIST_PAGES) {
    const html = safeRead(pageRel);
    const anchorRe = /<a\b([^>]*)>/gi;
    let match;
    while ((match = anchorRe.exec(html))) {
      const attrs = match[1] || '';
      const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']*)["']/i);
      if (!hrefMatch) continue;
      const href = hrefMatch[1].trim();
      const pathname = normalizePath(href, pageRel);
      if (!isGameLink(pathname)) continue;
      const statusMatch = attrs.match(/\bdata-status\s*=\s*["']([^"']*)["']/i);
      if (!links.has(pathname)) {
        links.set(pathname, {
          path: pathname,
          href,
          dataStatus: statusMatch ? statusMatch[1] : null,
          sources: []
        });
      }
      const entry = links.get(pathname);
      if (!entry.sources.includes(pageRel)) entry.sources.push(pageRel);
      if (statusMatch && !entry.dataStatus) entry.dataStatus = statusMatch[1];
      if (!sourcesByPath.has(pathname)) sourcesByPath.set(pathname, []);
      sourcesByPath.get(pathname).push(pageRel);
    }
  }
  return Array.from(links.values());
}

function targetFile(pathname) {
  const clean = pathname.split('?')[0].split('#')[0];
  const abs = path.join(ROOT, clean);
  if (clean.endsWith('/')) return path.join(abs, 'index.html');
  return abs;
}

function pageKey(pathname) {
  const clean = pathname.split('?')[0].split('#')[0];
  return clean;
}

async function fetchCheck(origin, pathname) {
  let url = origin + pathname;
  const chain = [];
  const seen = new Set();
  for (let hop = 0; hop < 6; hop += 1) {
    if (seen.has(url)) return { ok: false, reason: 'redirect loop', finalUrl: url, chain };
    seen.add(url);
    let response;
    try {
      response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    } catch (err) {
      return { ok: false, reason: 'fetch failed: ' + err.message, finalUrl: url, chain };
    }
    chain.push({ url, status: response.status });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { ok: false, reason: 'redirect without location', finalUrl: url, status: response.status, chain };
      url = new URL(location, url).href;
      continue;
    }
    let body = '';
    try { body = await response.text(); } catch (err) { /* status still matters */ }
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    const placeholder = /^(404|not found|page not found|页面不存在|找不到页面)/i.test(title) ||
      (/404|not found|页面不存在/i.test(title) && body.length < 1200);
    const ok = response.status === 200 && !placeholder && body.length > 250;
    return {
      ok,
      status: response.status,
      finalUrl: url,
      finalPath: new URL(url).pathname,
      title,
      bytes: body.length,
      reason: ok ? null : (response.status !== 200 ? 'HTTP ' + response.status : (placeholder ? '404 placeholder' : 'empty body')),
      chain
    };
  }
  return { ok: false, reason: 'too many redirects', finalUrl: url, chain };
}

/* ------------------------------------------------------------------ *
 * Actual page enumeration + status maps
 * ------------------------------------------------------------------ */

function collectActualPages() {
  const pages = [];
  const seen = new Set();
  const add = (rel, kind, urlPath) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs) || seen.has(urlPath)) return;
    seen.add(urlPath);
    pages.push({ rel, kind, url: urlPath });
  };

  for (const entry of fs.readdirSync(path.join(ROOT, 'games'), { withFileTypes: true })) {
    if (!entry.isDirectory() || RESERVED_ROOT.has(entry.name)) continue;
    const rel = 'games/' + entry.name + '/index.html';
    if (fs.existsSync(path.join(ROOT, rel))) add(rel, 'root-game', '/games/' + entry.name + '/');
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'games', 'boardgame'), { withFileTypes: true })) {
    if (!entry.isDirectory() || RESERVED_BOARDGAME.has(entry.name)) continue;
    const rel = 'games/boardgame/' + entry.name + '/index.html';
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    let kind = 'classic';
    if (/^mini-/.test(entry.name)) kind = 'mini';
    else if (/-premium$/.test(entry.name)) kind = 'premium';
    add(rel, kind, '/games/boardgame/' + entry.name + '/');
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'games', 'boardgame', 'board'), { withFileTypes: true })) {
    if (!entry.isFile() || !/\.html$/.test(entry.name) || entry.name === 'index.html') continue;
    add('games/boardgame/board/' + entry.name, 'board-detail', '/games/boardgame/board/' + entry.name);
  }
  return pages;
}

function statusMap() {
  const map = new Map();
  const note = {};
  try {
    const catalog = readJson('games/boardgame/catalog-status.json');
    for (const game of catalog.games || []) {
      map.set('/games/boardgame/' + game.slug + '/', { status: game.status, kind: game.kind, source: 'catalog-status' });
    }
    for (const extra of catalog.extras || []) {
      map.set('/games/boardgame/' + extra.slug + '/', { status: extra.status, kind: 'extra', source: 'catalog-status' });
      if (extra.slug === 'card-battle') map.set('/games/boardgame/card-battle/', { status: extra.status, kind: 'extra', source: 'catalog-status' });
    }
    note.catalogGeneratedAt = catalog.generatedAt;
    note.catalogSummary = catalog.summary;
  } catch (err) {
    note.catalogError = err.message;
  }
  try {
    const gameStatus = readJson('games/GAME_STATUS.json');
    for (const game of gameStatus.games || []) {
      map.set('/games/' + game.slug + '/', { status: game.status, kind: game.kind, source: 'GAME_STATUS' });
    }
    note.gameStatusGeneratedAt = gameStatus.generatedAt;
    note.gameStatusStats = gameStatus.stats;
  } catch (err) {
    note.gameStatusError = err.message;
  }
  return { map, note };
}

/* ------------------------------------------------------------------ *
 * Browser helpers
 * ------------------------------------------------------------------ */

function isAutoFavicon(url) {
  return /\/favicon\.ico(?:[?#]|$)/i.test(url || '');
}

function isBenignConsole(text) {
  return /favicon\.ico/i.test(text || '');
}

function createNetworkWatcher(page) {
  const failures = [];
  const requests = new Map();
  page.cdp.on((message) => {
    if (message.method === 'Network.requestWillBeSent') {
      const params = message.params || {};
      requests.set(params.requestId, {
        url: (params.request && params.request.url) || '',
        type: params.type || ''
      });
      return;
    }
    if (message.method === 'Network.responseReceived') {
      const params = message.params || {};
      const response = params.response || {};
      const url = response.url || '';
      if (response.status >= 400 && !isAutoFavicon(url)) {
        failures.push({ kind: 'http', status: response.status, url, type: params.type || '' });
      }
      return;
    }
    if (message.method === 'Network.loadingFailed') {
      const params = message.params || {};
      const info = requests.get(params.requestId) || { url: '', type: '' };
      if (isAutoFavicon(info.url)) return;
      if (params.canceled || params.errorText === 'net::ERR_ABORTED') return;
      failures.push({ kind: 'failed', error: params.errorText || 'loading failed', url: info.url, type: info.type });
    }
  });
  return failures;
}

async function evaluate(page, expression) {
  return page.evaluate(expression);
}

async function navigate(page, url, timeoutMs) {
  let done = false;
  const loaded = new Promise((resolve) => {
    page.cdp.on((message) => {
      if (!done && message.method === 'Page.loadEventFired') {
        done = true;
        resolve();
      }
    });
  });
  await page.cdp.send('Page.navigate', { url });
  await Promise.race([loaded, sleep(timeoutMs || 15000)]);
  await sleep(180);
  return waitFor(page, (state) => state.ready === 'complete', timeoutMs || 15000);
}

async function waitFor(page, predicate, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 12000);
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(page, '({href:location.href,ready:document.readyState,title:document.title,scrollY:window.scrollY,body:document.body?document.body.innerText.length:0})');
    if (predicate(last)) return last;
    await sleep(120);
  }
  throw new Error('timeout; last state=' + JSON.stringify(last));
}

async function clickTarget(page, options) {
  const selectors = options.selectors || [];
  const textRe = options.textRe || null;
  const probeScript = `(function () {
    var selectors = ${JSON.stringify(selectors)};
    var textRe = ${textRe ? 'new RegExp(' + JSON.stringify(textRe) + ', "i")' : 'null'};
    var candidates = [];
    for (var i = 0; i < selectors.length; i++) {
      var found = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < found.length; j++) candidates.push({ el: found[j], selector: selectors[i] });
    }
    if (!candidates.length && textRe) {
      var all = document.querySelectorAll('a[href], button, [role="button"], input[type="submit"]');
      for (var k = 0; k < all.length; k++) {
        var node = all[k];
        var label = (node.textContent || node.value || node.getAttribute('aria-label') || '').trim();
        if (textRe.test(label)) { candidates.push({ el: node, selector: 'text:' + label.slice(0, 40) }); break; }
      }
    }
    if (!candidates.length) return { found: false, tried: selectors };
    var picked = candidates[0];
    var el = picked.el;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    var rect = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    var visible = rect.width > 0 && rect.height > 0 && cs.display !== 'none' &&
      cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
    var x = Math.round(rect.left + rect.width / 2);
    var y = Math.round(rect.top + rect.height / 2);
    var hit = document.elementFromPoint(x, y);
    var hitOk = !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    return {
      found: true, selector: picked.selector, visible: visible, hitOk: hitOk,
      x: x, y: y, w: Math.round(rect.width), h: Math.round(rect.height),
      scrollY: Math.round(window.scrollY),
      tag: el.tagName.toLowerCase(), href: el.getAttribute('href') || '',
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      html: (el.outerHTML || '').slice(0, 180)
    };
  })()`;
  const probe = await evaluate(page, probeScript);
  if (!probe.found || !probe.visible || !probe.hitOk) {
    return { ok: false, probe };
  }
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: probe.x, y: probe.y });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: probe.x, y: probe.y, button: 'left', clickCount: 1 });
  await page.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: probe.x, y: probe.y, button: 'left', clickCount: 1 });
  await sleep(260);
  return { ok: true, probe };
}

function pathnameOf(href) {
  try { return new URL(href).pathname; } catch (err) { return ''; }
}

function samePath(a, b) {
  return pathnameOf(a) === b;
}

/* ------------------------------------------------------------------ *
 * E2E scenarios
 * ------------------------------------------------------------------ */

const SCENARIOS = [
  {
    id: 'premium-azul-premium',
    label: 'premium / main hall -> boardgame hall -> azul-premium',
    hall: '/games/',
    route: [
      {
        label: 'boardgame hall entry',
        selectors: ['a.feature-card[href="/games/boardgame/"]', 'a[href="/games/boardgame/"]'],
        path: '/games/boardgame/'
      },
      {
        label: 'premium entry',
        selectors: ['a[href="./azul-premium/"]', 'a[href="/games/boardgame/azul-premium/"]'],
        path: '/games/boardgame/azul-premium/'
      }
    ],
    gamePath: '/games/boardgame/azul-premium/',
    backPath: '/games/boardgame/',
    start: { selectors: ['#newBtn', '#btn-new', '#new'], textRe: '新对局|新游戏|开始|Start|New game|New' }
  },
  {
    id: 'arcade-2048',
    label: 'arcade / GAME_STATUS draft',
    hall: '/games/',
    route: [
      { label: 'arcade entry', selectors: ['a[href="/games/2048/"]'], path: '/games/2048/' }
    ],
    gamePath: '/games/2048/',
    backPath: '/games/',
    start: { selectors: ['#btn-new', '#newBtn', '#new'], textRe: '新游戏|开始|Start|New game|New' }
  },
  {
    id: 'draft-boardgame-azul',
    label: 'draft / catalog draft (direct URL)',
    hall: '/games/',
    entry: { type: 'direct' },
    gamePath: '/games/boardgame/azul/',
    backPath: '/games/',
    start: { selectors: ['#newSeed', '#restart', '#new'], textRe: '新开|新游戏|新对局|开始|Start|New' }
  }
];

async function runE2e(origin, verbose) {
  const checks = [];
  const scenarios = [];
  const record = (scenarioId, step, ok, detail) => {
    checks.push({ scenarioId, step, ok, detail });
    console.log('  [' + (ok ? 'PASS' : 'FAIL') + '] ' + scenarioId + ' · ' + step + (detail ? ' — ' + detail : ''));
  };

  await withChrome('about:blank', async (page) => {
    await page.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: 1,
      mobile: true
    });
    const networkFailures = createNetworkWatcher(page);
    let consoleCursor = page.consoleErrors.length;
    let pageErrorCursor = page.pageErrors.length;
    let networkCursor = networkFailures.length;

    const drain = () => {
      const consoleErrors = page.consoleErrors.slice(consoleCursor).filter((text) => !isBenignConsole(text));
      const pageErrors = page.pageErrors.slice(pageErrorCursor);
      const net = networkFailures.slice(networkCursor);
      consoleCursor = page.consoleErrors.length;
      pageErrorCursor = page.pageErrors.length;
      networkCursor = networkFailures.length;
      return { consoleErrors, pageErrors, net };
    };

    for (const scenario of SCENARIOS) {
      console.log('\n' + scenario.id + ' (' + scenario.label + ')');
      const result = {
        id: scenario.id,
        label: scenario.label,
        hall: scenario.hall,
        gamePath: scenario.gamePath,
        steps: [],
        ok: true
      };
      const push = (step, ok, detail) => {
        record(scenario.id, step, ok, detail);
        result.steps.push({ step, ok, detail });
        if (!ok) result.ok = false;
      };

      let hallState;
      try {
        hallState = await navigate(page, origin + scenario.hall);
      } catch (err) {
        push('hall loaded', false, err.message);
        scenarios.push(result);
        continue;
      }
      const hallLoaded = samePath(hallState.href, scenario.hall) && hallState.ready === 'complete' && hallState.body > 50;
      push('hall loaded', hallLoaded, hallState.href + ' ready=' + hallState.ready + ' text=' + hallState.body);
      const hallDrain = drain();
      push('hall clean', hallDrain.consoleErrors.length === 0 && hallDrain.pageErrors.length === 0 && hallDrain.net.length === 0,
        JSON.stringify(hallDrain).slice(0, 300));
      if (!hallLoaded) { scenarios.push(result); continue; }

      let scrollAtEntry = hallState.scrollY || 0;
      if (scenario.entry && scenario.entry.type === 'direct') {
        try {
          await navigate(page, origin + scenario.gamePath);
        } catch (err) {
          push('direct URL reached', false, err.message);
          scenarios.push(result);
          continue;
        }
        push('direct URL reached', true, 'direct navigation');
      } else {
        const route = scenario.route || [{
          label: 'entry link',
          selectors: scenario.entry.selectors,
          path: scenario.gamePath
        }];
        let routeFailed = false;
        for (const hop of route) {
          const click = await clickTarget(page, { selectors: hop.selectors });
          const hopDetail = click.probe ? JSON.stringify(click.probe).slice(0, 300) : 'no probe';
          push(hop.label + ' visible + hit', click.ok, hopDetail);
          if (!click.ok) { routeFailed = true; break; }
          scrollAtEntry = click.probe.scrollY;
          try {
            await waitFor(page, (state) => samePath(state.href, hop.path) && state.ready === 'complete', 15000);
          } catch (err) {
            push(hop.label + ' URL reached', false, err.message);
            routeFailed = true;
            break;
          }
          const hopState = await evaluate(page, '({href:location.href,ready:document.readyState,body:document.body?document.body.innerText.length:0})');
          push(hop.label + ' URL reached',
            samePath(hopState.href, hop.path) && hopState.ready === 'complete' && hopState.body > 50,
            hopState.href + ' ready=' + hopState.ready + ' text=' + hopState.body);
          const hopDrain = drain();
          push(hop.label + ' clean', hopDrain.consoleErrors.length === 0 && hopDrain.pageErrors.length === 0 && hopDrain.net.length === 0,
            JSON.stringify(hopDrain).slice(0, 300));
        }
        if (routeFailed) { scenarios.push(result); continue; }
      }

      const gameState = await evaluate(page, '({href:location.href,ready:document.readyState,title:document.title,body:document.body?document.body.innerText.length:0})');
      const gameLoaded = samePath(gameState.href, scenario.gamePath) && gameState.ready === 'complete' && gameState.body > 50;
      push('game page loaded', gameLoaded, gameState.href + ' ready=' + gameState.ready + ' text=' + gameState.body);
      const gameDrain = drain();
      push('game page clean', gameDrain.consoleErrors.length === 0 && gameDrain.pageErrors.length === 0 && gameDrain.net.length === 0,
        JSON.stringify(gameDrain).slice(0, 400));
      if (!gameLoaded) { scenarios.push(result); continue; }

      const startClick = await clickTarget(page, scenario.start);
      const startDetail = startClick.probe
        ? 'selector=' + startClick.probe.selector + ' text="' + startClick.probe.text + '" ' + startClick.probe.w + 'x' + startClick.probe.h + ' hit=' + startClick.probe.hitOk
        : 'tried=' + scenario.start.selectors.join(',');
      push('start control visible + hit', startClick.ok, startDetail);
      if (!startClick.ok) { scenarios.push(result); continue; }
      await sleep(450);
      const startDrain = drain();
      const startErrors = startDrain.consoleErrors.length + startDrain.pageErrors.length + startDrain.net.length;
      push('start click clean', startErrors === 0, JSON.stringify(startDrain).slice(0, 400));

      const backPath = scenario.backPath || scenario.hall;
      try {
        await evaluate(page, 'history.back()');
        await waitFor(page, (state) => samePath(state.href, backPath) && state.ready === 'complete', 15000);
      } catch (err) {
        push('returned to hall', false, err.message);
        scenarios.push(result);
        continue;
      }
      const backState = await evaluate(page, '({href:location.href,ready:document.readyState,scrollY:window.scrollY})');
      push('returned to hall', samePath(backState.href, backPath) && backState.ready === 'complete', backState.href);
      await sleep(350);
      const restored = await evaluate(page, '({scrollY:window.scrollY})');
      const delta = Math.abs(Number(restored.scrollY) - Number(scrollAtEntry));
      push('hall position restored', delta <= 120, 'entry scrollY=' + scrollAtEntry + ' back scrollY=' + restored.scrollY + ' delta=' + delta);
      const backDrain = drain();
      push('return clean', backDrain.consoleErrors.length === 0 && backDrain.pageErrors.length === 0 && backDrain.net.length === 0,
        JSON.stringify(backDrain).slice(0, 400));
      scenarios.push(result);
    }

    const finalDrain = drain();
    if (finalDrain.consoleErrors.length || finalDrain.pageErrors.length || finalDrain.net.length) {
      record('global', 'no console/exception/resource errors', false, JSON.stringify(finalDrain).slice(0, 500));
    } else {
      record('global', 'no console/exception/resource errors', true, 'session clean');
    }
    if (verbose) {
      console.log('\nnetwork requests seen: ' + (page.externalRequests ? page.externalRequests.length : 0));
    }
  });

  return { checks, scenarios };
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const links = parseLinks();
  const actual = collectActualPages();
  const status = statusMap();

  console.log('nav-e2e: worktree ' + ROOT);
  console.log('nav-e2e: ' + links.length + ' unique game links from ' + LIST_PAGES.length + ' list pages');
  console.log('nav-e2e: ' + actual.length + ' actual game pages');

  const handle = await startServer({ root: ROOT, port: opts.port });
  const origin = handle.origin;
  console.log('nav-e2e: static server ' + origin + ' (root ' + handle.root + ')');

  const inventoryFailures = [];
  const inventoryResults = [];
  let inventoryPassed = 0;
  let e2e;
  try {
    for (const link of links) {
      const check = await fetchCheck(origin, link.path);
      const exists = fs.existsSync(targetFile(link.path));
      const result = { path: link.path, href: link.href, sources: link.sources, dataStatus: link.dataStatus, exists, http: check };
      inventoryResults.push(result);
      if (check.ok && exists) {
        inventoryPassed += 1;
        if (opts.verbose) console.log('  [PASS] link ' + link.path + ' -> ' + check.status + ' ' + check.finalPath);
      } else {
        inventoryFailures.push(result);
        console.log('  [FAIL] link ' + link.path + ' -> ' + (check.reason || 'missing file') +
          ' (exists=' + exists + ' status=' + check.status + ' final=' + check.finalPath + ')');
      }
    }

    console.log('\n=== three-game E2E (360x800) ===');
    try {
      e2e = await runE2e(origin, opts.verbose);
    } catch (err) {
      console.error('E2E crashed: ' + (err && err.stack ? err.stack : err));
      e2e = { checks: [{ scenarioId: 'global', step: 'e2e executed', ok: false, detail: String(err) }], scenarios: [] };
    }
  } finally {
    await handle.close();
    console.log('nav-e2e: static server closed');
  }

  /* Direction A: list link -> missing page */
  const directionA = inventoryResults.filter((item) => !item.exists || !item.http.ok);

  /* Direction B: actual page -> no entry in any of the four lists */
  const linkSet = new Set(links.map((link) => pageKey(link.path)));
  const directionB = [];
  for (const page of actual) {
    if (linkSet.has(pageKey(page.url))) continue;
    const info = status.map.get(page.url) || null;
    directionB.push({
      url: page.url,
      rel: page.rel,
      kind: page.kind,
      status: info ? info.status : (page.kind === 'board-detail' ? 'detail' : 'unclassified'),
      source: info ? info.source : null
    });
  }
  const bByStatus = directionB.reduce((acc, item) => {
    const key = item.status + '/' + item.kind;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  /* Draft exposure in the lists */
  const draftViolations = [];
  const staleStatusAttrs = [];
  for (const link of links) {
    const info = status.map.get(link.path);
    if (!info) continue;
    if (info.status === 'draft') {
      draftViolations.push({ path: link.path, source: info.source, kind: info.kind, lists: link.sources });
    }
    if (link.dataStatus === 'draft' && info.status === 'shipped') {
      staleStatusAttrs.push({ path: link.path, source: info.source, dataStatus: link.dataStatus, actual: info.status });
    }
  }
  const draftBySource = draftViolations.reduce((acc, item) => {
    const key = item.source + '/' + item.kind;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log('\n=== connectivity inventory ===');
  console.log('links checked: ' + links.length + ' passed: ' + inventoryPassed + ' failed: ' + inventoryFailures.length);
  console.log('direction A (listed, missing/broken): ' + directionA.length);
  for (const item of directionA.slice(0, 30)) console.log('  A ' + item.path + ' — ' + (item.http.reason || 'missing'));
  console.log('direction B (page exists, no list entry): ' + directionB.length);
  for (const key of Object.keys(bByStatus).sort()) console.log('  B ' + key + ': ' + bByStatus[key]);
  for (const item of directionB.slice(0, 20)) console.log('  B ' + item.status + ' ' + item.url);
  if (directionB.length > 20) console.log('  B ... ' + (directionB.length - 20) + ' more');
  console.log('draft exposure in lists: ' + draftViolations.length);
  for (const key of Object.keys(draftBySource).sort()) console.log('  draft ' + key + ': ' + draftBySource[key]);
  for (const item of draftViolations.slice(0, 25)) console.log('  draft ' + item.path + ' [' + item.source + '] ' + item.lists.join(','));
  if (staleStatusAttrs.length) {
    console.log('FAIL stale data-status="draft" on shipped entries: ' + staleStatusAttrs.length);
    for (const item of staleStatusAttrs.slice(0, 10)) console.log('  stale ' + item.path + ' actual=' + item.actual);
  } else {
    console.log('data-status consistency: OK (no shipped entry marked draft)');
  }

  const e2ePassed = e2e.checks.filter((check) => check.ok).length;
  const e2eFailed = e2e.checks.length - e2ePassed;
  console.log('\nE2E: ' + e2ePassed + ' passed, ' + e2eFailed + ' failed');

  // Status drift is a real failure, not just a report finding: a shipped entry
  // that advertises data-status="draft" is a wrong claim on the lobby page.
  const totalPassed = e2ePassed + inventoryPassed;
  const totalFailed = e2eFailed + inventoryFailures.length + staleStatusAttrs.length;
  const findings = {
    directionA: directionA.length,
    directionB: directionB.length,
    directionB_byStatus: bByStatus,
    draftExposure: draftViolations.length,
    draftExposure_bySource: draftBySource,
    staleShippedStatusAttrs: staleStatusAttrs.length,
    catalog: status.note.catalogSummary || null,
    gameStatus: status.note.gameStatusStats || null,
    rootIndexMissing: !fs.existsSync(path.join(ROOT, 'index.html'))
  };
  console.log('\nFINDINGS ' + JSON.stringify(findings));
  console.log('\nRESULT: ' + totalPassed + ' passed, ' + totalFailed + ' failed');

  if (opts.json) {
    const out = {
      generatedAt: new Date().toISOString(),
      viewport: VIEWPORT,
      origin,
      listPages: LIST_PAGES,
      e2e: { passed: e2ePassed, failed: e2eFailed, checks: e2e.checks, scenarios: e2e.scenarios },
      inventory: {
        checked: links.length,
        passed: inventoryPassed,
        failed: inventoryFailures.length,
        directionA,
        directionB,
        directionB_byStatus: bByStatus,
        draftExposure: draftViolations,
        draftExposure_bySource: draftBySource,
        staleShippedStatusAttrs: staleStatusAttrs,
        results: inventoryResults
      },
      findings
    };
    fs.mkdirSync(path.dirname(opts.json), { recursive: true });
    fs.writeFileSync(opts.json, JSON.stringify(out, null, 2) + '\n');
    console.log('json: ' + opts.json);
  }

  process.exitCode = totalFailed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('nav-e2e fatal: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
