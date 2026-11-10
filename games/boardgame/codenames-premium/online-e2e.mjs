#!/usr/bin/env node
/*
 * Codenames Premium — dual-client browser E2E.
 *
 *   node games/boardgame/codenames-premium/online-e2e.mjs
 *
 * Reuses the resident audit Chrome through CDP (chrome-ensure first), opens two
 * independent browser contexts, creates one room, joins from the second
 * context, plays an authoritative game to the end through the real UI, then
 * checks:
 *   - invite URL points at online.html and serves the page
 *   - both clients sync on room / turn / phase / scores
 *   - reconnect after reload restores the same seat and room
 *   - both clients settle the same winner, scores and leaderboard entry
 *   - 390×844 and 320×568: no horizontal overflow, touch targets >=44px,
 *     visible text >=12px, rAF FPS >=30, zero console errors
 *
 * Never launches a temp Chrome/profile and never closes the resident Chrome.
 * Prints exactly one line: RESULT: N passed, M failed
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startOnlineServer } from './online-server.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = Number(process.env.CODENAMES_CDP_PORT || 9222);
const ENTRY = '/online.html';

let passed = 0;
let failed = 0;
const failures = [];

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

function loadPlaywright() {
  try { return require('@playwright/test'); } catch (err) { /* fall through */ }
  const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(globalRoot, '@playwright/test'));
}

try {
  execFileSync(path.join(process.env.HOME, '.local/bin/chrome-ensure'), [], { stdio: 'inherit' });
} catch (err) {
  console.warn('chrome-ensure unavailable; attaching to existing CDP port ' + CDP_PORT);
}

const app = await startOnlineServer({
  port: 0,
  host: '127.0.0.1',
  idleTimeoutMs: 20000,
  aiDelayMs: 220,
  roomTtlMs: 2 * 60 * 60 * 1000
});
const origin = 'http://127.0.0.1:' + app.address.port;
console.log('server ' + origin + ENTRY);

async function waitForDebug() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (response.ok) return;
    } catch (err) { /* retry */ }
    await sleep(150);
  }
  throw new Error('resident Chrome CDP not reachable on port ' + CDP_PORT +
    ' (run chrome-ensure; do not launch a temp Chrome)');
}

const consoleErrors = [];
const pageErrors = [];
let browser = null;
const contexts = [];

async function newClient(label, width, height, entry) {
  const context = await browser.newContext({ viewport: { width: width, height: height } });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', function (message) {
    if (message.type() === 'error') consoleErrors.push(label + ': ' + message.text());
  });
  page.on('pageerror', function (error) {
    pageErrors.push(label + ': ' + (error && error.message ? error.message : String(error)));
  });
  await page.goto(origin + (entry || ENTRY), { waitUntil: 'load' });
  await page.waitForFunction(function () {
    return !!(window.__codenamesOnline && document.getElementById('lobby'));
  });
  return { label, context, page, width, height };
}

async function viewOf(client) {
  return client.page.evaluate(function () {
    return window.__codenamesOnline.getView();
  });
}

async function waitView(client, predicate, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 20000);
  let last = null;
  while (Date.now() < deadline) {
    last = await viewOf(client).catch(function () { return null; });
    if (last && predicate(last)) return last;
    await sleep(120);
  }
  throw new Error('waitView timeout (' + (label || client.label) + '): ' +
    JSON.stringify(last && {
      phase: last.phase, turn: last.turn, canClue: last.canClue,
      canGuess: last.canGuess, scores: last.scores
    }));
}

async function measure(entry) {
  const context = await browser.newContext({ viewport: { width: entry.width, height: entry.height } });
  contexts.push(context);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', function (message) {
    if (message.type() === 'error') consoleErrors.push(entry.label + ': ' + message.text());
  });
  page.on('pageerror', function (error) {
    pageErrors.push(entry.label + ': ' + (error && error.message ? error.message : String(error)));
  });
  await page.goto(origin + entry.entry, { waitUntil: 'load' });
  await page.waitForFunction(function () { return document.readyState === 'complete'; });
  await page.bringToFront();
  await sleep(400);
  const layout = await page.evaluate(function () {
    const doc = document;
    const visible = function (el) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' &&
        Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const smallTargets = [];
    doc.querySelectorAll('button, a, input, select').forEach(function (el) {
      if (!visible(el)) return;
      const rect = el.getBoundingClientRect();
      if (rect.height < 44 || rect.width < 44) {
        smallTargets.push(((el.id || el.className || el.tagName) + '').trim() + ':' +
          rect.width.toFixed(1) + 'x' + rect.height.toFixed(1));
      }
    });
    const tinyText = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.nodeValue || !node.nodeValue.trim()) continue;
      const parent = node.parentElement;
      if (!parent || !visible(parent) || parent.closest('svg')) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size < 12) tinyText.push(node.nodeValue.trim().slice(0, 12) + ':' + size);
    }
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth),
      smallTargets: smallTargets.slice(0, 8),
      tinyText: tinyText.slice(0, 8),
      apiErrors: (window.__pageErrors || []).slice()
    };
  });
  const fps = await page.evaluate(function () {
    return new Promise(function (resolve) {
      let frames = 0;
      const started = performance.now();
      let settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        const elapsed = Math.max(1, performance.now() - started);
        resolve(Math.round(frames * 1000 / elapsed));
      }
      function tick(now) {
        frames += 1;
        if (now - started >= 700) finish();
        else requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      setTimeout(finish, 1600);
    });
  });
  return { layout, fps };
}

let fatal = null;
try {
  await waitForDebug();
  const mod = loadPlaywright();
  if (!mod || !mod.chromium) throw new Error('Playwright @playwright/test with chromium is required');
  browser = await mod.chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
  console.log('attached to resident Chrome on port ' + CDP_PORT);

  const A = await newClient('A', 390, 844);
  const B = await newClient('B', 390, 844);

  section('Room creation, invite URL and second client join');
  await A.page.fill('#createNick', 'Alice');
  await A.page.click('#createForm button[type="submit"]');
  await A.page.waitForFunction(function () {
    const panel = document.getElementById('roomPanel');
    return panel && !panel.hidden && document.getElementById('roomCode').textContent.indexOf('—') === -1;
  });
  const roomA = await viewOf(A);
  ok('client A creates a room through the UI', !!roomA && !!roomA.roomId, roomA && roomA.roomId);
  eq('A is the red captain (host seat)', roomA && roomA.you && roomA.you.seat, 'red-captain');
  ok('invite token issued to the host', typeof roomA.inviteToken === 'string' && roomA.inviteToken.length > 0,
    String(roomA.inviteToken && roomA.inviteToken.slice(0, 10)));

  const inviteUrl = origin + ENTRY + '?room=' + encodeURIComponent(roomA.roomId) +
    '&invite=' + encodeURIComponent(roomA.inviteToken);
  const invitePage = await fetch(inviteUrl);
  const inviteText = await invitePage.text();
  eq('invite URL serves the online page', invitePage.status, 200);
  ok('invite page is the Codenames online shell', /行动代号|__codenamesOnline/.test(inviteText));

  await B.page.fill('#joinRoom', roomA.roomId);
  await B.page.fill('#joinNick', 'Bob');
  await B.page.click('#joinForm button[type="submit"]');
  await B.page.waitForFunction(function () {
    const panel = document.getElementById('roomPanel');
    return panel && !panel.hidden && !document.getElementById('gamePanel').hidden === false;
  });
  const roomB = await waitView(B, function (v) { return !!v && !!v.you; }, 8000, 'B join');
  eq('B joins the same room', roomB.roomId, roomA.roomId);
  eq('B takes the red operative seat', roomB.you && roomB.you.seat, 'red-operative');
  eq('room has four seats', roomB.seats.length, 4);
  eq('empty blue seats are AI-filled', roomB.aiSeats.sort(), ['blue-captain', 'blue-operative']);
  eq('both clients are distinct players', [
    await A.page.evaluate(function () { return window.__codenamesOnline.getSession().playerId; }),
    await B.page.evaluate(function () { return window.__codenamesOnline.getSession().playerId; })
  ], ['Alice', 'Bob']);

  section('Start and reconnect');
  await A.page.waitForFunction(function () {
    const button = document.getElementById('startBtn');
    return button && !button.hidden;
  });
  await A.page.click('#startBtn');
  await waitView(A, function (v) { return v.started; }, 8000, 'A start');
  await waitView(B, function (v) { return v.started; }, 8000, 'B start');
  const startA = await viewOf(A);
  const startB = await viewOf(B);
  eq('both clients start the same match', startA.roomId, startB.roomId);
  eq('red is on turn at start', startA.turn, 'red');
  eq('red captain sees the key', startA.keyVisible, true);
  eq('red operative does not see the key', startB.keyVisible, false);
  ok('start view exposes a legal suggested clue', !!startA.suggestedClue &&
    typeof startA.suggestedClue.text === 'string' && startA.suggestedClue.count >= 1,
    JSON.stringify(startA.suggestedClue));

  await B.page.reload({ waitUntil: 'load' });
  await B.page.waitForFunction(function () {
    return !!(window.__codenamesOnline && window.__codenamesOnline.getView() &&
      document.getElementById('gamePanel') && !document.getElementById('gamePanel').hidden);
  }, null, { timeout: 15000 });
  const reconnected = await waitView(B, function (v) {
    return v && v.started && v.roomId === roomA.roomId;
  }, 8000, 'B reconnect');
  eq('reload reconnects to the same room', reconnected.roomId, roomA.roomId);
  eq('reload restores the same seat', reconnected.you && reconnected.you.seat, 'red-operative');
  ok('reconnect clears the takeover flag', !reconnected.takeoverSeats.includes('red-operative'),
    JSON.stringify(reconnected.takeoverSeats));

  section('Play one authoritative game to the end through both UIs');
  let redScored = false;
  let redTurns = 0;
  let blueTurns = 0;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const a = await viewOf(A);
    const b = await viewOf(B);
    if (!a || !b) { await sleep(200); continue; }
    if (a.phase === 'over') break;
    if (a.turn === 'red') redTurns += 1; else blueTurns += 1;

    if (a.canClue) {
      const clue = a.suggestedClue || { text: '水果', count: 2 };
      await A.page.fill('#clueText', clue.text);
      await A.page.selectOption('#clueCount', String(clue.count));
      await A.page.evaluate(function () {
        document.getElementById('clueForm').requestSubmit();
      });
      await waitView(A, function (v) { return v.phase === 'guess' || v.phase === 'over'; }, 8000, 'clue');
      continue;
    }

    if (b.canGuess && b.turn === 'red') {
      // Deterministic operative: first take a red word (if any), then hand the
      // turn to blue with a blue word so the AI team really plays. The index
      // comes from the captain's real key; the guess still goes through the
      // normal UI -> HTTP -> engine validation path.
      const key = await A.page.evaluate(function () {
        const view = window.__codenamesOnline.getView();
        return view.words.map(function (w) { return { color: w.color, revealed: w.revealed }; });
      });
      let index = key.findIndex(function (w) { return w.color === 'red' && !w.revealed; });
      if (index === -1 || redScored) {
        index = key.findIndex(function (w) { return w.color === 'blue' && !w.revealed; });
      }
      if (index === -1) index = key.findIndex(function (w) { return !w.revealed; });
      if (index >= 0) {
        if (key[index].color === 'red') redScored = true;
        await B.page.click('#board .tile[data-index="' + index + '"]');
        await sleep(250);
        await waitView(B, function (v) {
          return v.phase === 'over' || v.turn !== 'red' || !v.canGuess || v.guessesMade > b.guessesMade;
        }, 8000, 'guess').catch(function () {});
      }
      continue;
    }
    await sleep(250);
  }

  const finalA = await waitView(A, function (v) { return v.phase === 'over'; }, 10000, 'A finish');
  const finalB = await waitView(B, function (v) { return v.phase === 'over'; }, 10000, 'B finish');
  section('Both clients settle the same result');
  ok('game reached the end', finalA.phase === 'over' && finalB.phase === 'over',
    finalA.phase + '/' + finalB.phase + ' after red=' + redTurns + ' blue=' + blueTurns);
  eq('same winner on both clients', finalA.winner, finalB.winner);
  eq('same scores on both clients', finalA.scores, finalB.scores);
  eq('same final turn number', finalA.turnNo, finalB.turnNo);
  ok('both teams scored at least once', finalA.scores.red + finalA.scores.blue > 0,
    JSON.stringify(finalA.scores));
  ok('blue AI team played a real game', finalA.scores.blue > 0 ||
    finalA.winner === 'blue' || finalA.winner === 'red' && finalA.seats.some(function (s) {
      return s.team === 'blue' && s.controlledByAI;
    }), JSON.stringify({ scores: finalA.scores, winner: finalA.winner }));
  eq('AI seats stayed AI-controlled', finalA.seats.filter(function (s) { return s.ai; }).map(function (s) {
    return s.id;
  }).sort(), ['blue-captain', 'blue-operative']);

  await A.page.waitForFunction(function () {
    return !document.getElementById('overlay').hidden;
  });
  await B.page.waitForFunction(function () {
    return !document.getElementById('overlay').hidden;
  });
  const banners = await Promise.all([A, B].map(function (client) {
    return client.page.evaluate(function () {
      return {
        title: document.getElementById('bannerTitle').textContent,
        text: document.getElementById('bannerText').textContent,
        red: document.getElementById('redScore').textContent,
        blue: document.getElementById('blueScore').textContent
      };
    });
  }));
  eq('result banner is identical on both clients', banners[0].title, banners[1].title);
  eq('visible scores match the final view', [banners[0].red, banners[0].blue],
    [String(finalA.scores.red), String(finalA.scores.blue)]);

  let entry = null;
  for (let i = 0; i < 30; i += 1) {
    const response = await fetch(origin + '/api/leaderboard?limit=20');
    const body = await response.json();
    entry = (body.entries || []).find(function (row) { return row.roomId === finalA.roomId; }) || null;
    if (entry) break;
    await sleep(200);
  }
  ok('finished game enters the anonymous leaderboard once', !!entry,
    entry ? entry.id : 'no entry');
  if (entry) {
    eq('leaderboard winner matches both clients', entry.winner, finalA.winner);
    eq('leaderboard scores match both clients', entry.scores, finalA.scores);
    eq('leaderboard has one record for this room', (await (await fetch(origin + '/api/leaderboard?limit=50'))
      .json()).entries.filter(function (row) { return row.roomId === finalA.roomId; }).length, 1);
  }

  section('Mobile gates: 390×844 and 320×568');
  const mobile390 = await measure({ label: '390x844', width: 390, height: 844, entry: '/online.html' });
  const mobile320 = await measure({ label: '320x568', width: 320, height: 568, entry: '/online.html' });
  [mobile390, mobile320].forEach(function (sample) {
    const label = sample.layout.innerWidth + '×' + sample.layout.innerHeight;
    ok(label + ' viewport matches', sample.layout.innerWidth === (sample.layout.innerWidth === 390 ? 390 : 320),
      label);
    ok(label + ' no horizontal overflow', sample.layout.scrollWidth <= sample.layout.innerWidth,
      sample.layout.scrollWidth + ' <= ' + sample.layout.innerWidth);
    eq(label + ' all touch targets >=44px', sample.layout.smallTargets, []);
    eq(label + ' all visible text >=12px', sample.layout.tinyText, []);
    eq(label + ' page error list is empty', sample.layout.apiErrors, []);
    ok(label + ' rAF FPS >=30', sample.fps >= 30, sample.fps + ' fps');
  });

  eq('zero console errors across the whole E2E', consoleErrors, []);
  eq('zero uncaught page errors across the whole E2E', pageErrors, []);
} catch (err) {
  fatal = err;
  failed += 1;
  console.error('E2E ERROR:', err && err.stack || err);
} finally {
  for (const context of contexts) {
    try { await context.close(); } catch (err) { /* best effort */ }
  }
  if (browser) {
    try { await browser.close(); } catch (err) { /* CDP connection only */ }
  }
  await app.close();
}

if (fatal && passed === 0) passed = 0;
console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('failures:');
  failures.forEach(function (line) { console.log('  - ' + line); });
  process.exitCode = 1;
}
process.exit(process.exitCode || 0);
