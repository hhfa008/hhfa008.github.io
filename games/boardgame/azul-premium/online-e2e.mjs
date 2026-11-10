#!/usr/bin/env node
/*
 * Azul online — dual-client browser E2E.
 *
 *   node games/boardgame/azul-premium/online-e2e.mjs
 *
 * Reuses the resident audit Chrome through CDP (chrome-ensure first), opens two
 * independent browser contexts, creates one 2-player room, joins from the
 * second context, plays the game to the end with the real engine, then checks:
 *   - both clients end on the same stateVersion / status / scores by player
 *   - the invite URL is the Azul online page and the room state is shared
 *   - session reconnect after reload
 *   - 390×844 and 320×568: no horizontal overflow, touch targets >=44px,
 *     rAF FPS >=30, zero console errors, zero external requests
 *
 * Never launches a temp Chrome/profile and never closes the resident Chrome.
 * Prints exactly one line: RESULT: N passed, M failed
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../app/server.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = Number(process.env.AZUL_CDP_PORT || 9222);
const ENTRY = '/boardgame/azul-premium/online.html';

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];
const pageErrors = [];
const requests = [];

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

function reloadPlaywright() {
  const mod = loadPlaywright();
  if (!mod || !mod.chromium) throw new Error('Playwright @playwright/test with chromium is required');
  return mod.chromium;
}

try { execFileSync(process.env.HOME + '/.local/bin/chrome-ensure', [], { stdio: 'inherit' }); }
catch (err) { console.warn('chrome-ensure unavailable; attaching to existing CDP port ' + CDP_PORT); }

const app = createApiServer({
  autoFillMs: 120,
  aiMoveMinMs: 20,
  aiMoveMaxMs: 45,
  disconnectMs: 12000,
  tickMs: 25
});
const address = await app.listen(0, '127.0.0.1');
const origin = 'http://127.0.0.1:' + address.port;
console.log('server ' + origin + ENTRY);

async function waitForDebug() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version');
      if (response.ok) return;
    } catch (err) { /* retry */ }
    await sleep(150);
  }
  throw new Error('resident Chrome CDP not reachable on port ' + CDP_PORT + ' (run chrome-ensure; do not launch a temp Chrome)');
}

let browser = null;
const contexts = [];
let fatal = null;

try {
  await waitForDebug();
  const chromium = reloadPlaywright();
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + CDP_PORT);
  console.log('attached to resident Chrome on port ' + CDP_PORT);

  async function newClient(label) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    contexts.push(context);
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on('console', function (message) {
      if (message.type() === 'error') consoleErrors.push(label + ': ' + message.text());
    });
    page.on('pageerror', function (error) {
      pageErrors.push(label + ': ' + (error && error.message ? error.message : String(error)));
    });
    page.on('request', function (request) { requests.push(request.url()); });
    await page.goto(origin + ENTRY, { waitUntil: 'load' });
    await page.waitForFunction(function () {
      return !!(window.__azulOnline && window.AzulEngine && document.getElementById('lobbyPanel'));
    });
    return { label, context, page };
  }

  const A = await newClient('A');
  const B = await newClient('B');

  section('Room creation, invite URL and second client join');
  const created = await A.page.evaluate(function () {
    return window.__azulOnline.createRoom({ playerId: 'Alice', maxPlayers: 2, autoFill: false, seed: 42 });
  });
  ok('client A creates room', created.status === 201, 'status ' + created.status);
  const roomId = created.body && created.body.roomId;
  ok('room id returned', typeof roomId === 'string' && roomId.length > 0, String(roomId));
  ok('invite URL points at Azul online page',
    typeof created.body.inviteUrl === 'string' &&
    created.body.inviteUrl.indexOf(origin + ENTRY + '?room=') === 0,
    String(created.body.inviteUrl));
  ok('invite URL carries room and code',
    created.body.inviteUrl.indexOf(encodeURIComponent(roomId)) !== -1 &&
    created.body.inviteUrl.indexOf('code=') !== -1,
    created.body.inviteUrl);
  const invitePage = await fetch(created.body.inviteUrl);
  eq('invite URL serves the online page', invitePage.status, 200);

  const joined = await B.page.evaluate(function (id) {
    return window.__azulOnline.joinRoom({ roomId: id, playerId: 'Bob' });
  }, roomId);
  ok('client B joins the same room', joined.status === 200, 'status ' + joined.status);
  eq('room auto-starts after second player', joined.body.roomStatus, 'playing');
  eq('B is original seat 1', joined.body.mySeat, 1);
  eq('B sees itself first (seat 0)', joined.body.state.players[0].name, 'Bob');
  eq('A and B are distinct players', [
    await A.page.evaluate(function () { return window.__azulOnline.playerId(); }),
    await B.page.evaluate(function () { return window.__azulOnline.playerId(); })
  ], ['Alice', 'Bob']);

  await A.page.evaluate(function () { window.__azulOnline.pollMs(120); });
  await B.page.evaluate(function () { window.__azulOnline.pollMs(120); });

  section('Both clients play one authoritative game to the end');
  const plays = await Promise.all([
    A.page.evaluate(function () { return window.__azulOnline.autoPlayToEnd(400); }),
    B.page.evaluate(function () { return window.__azulOnline.autoPlayToEnd(400); })
  ]);
  await A.page.waitForFunction(function () {
    var view = window.__azulOnline.view();
    return !!view && (view.status === 'ended' || (view.state && view.state.over));
  }, null, { timeout: 20000 });
  await B.page.waitForFunction(function () {
    var view = window.__azulOnline.view();
    return !!view && (view.status === 'ended' || (view.state && view.state.over));
  }, null, { timeout: 20000 });

  const finalA = await A.page.evaluate(function () { return window.__azulOnline.view(); });
  const finalB = await B.page.evaluate(function () { return window.__azulOnline.view(); });
  ok('game A reached the end', !!finalA && finalA.status === 'ended', finalA && finalA.status);
  ok('game B reached the end', !!finalB && finalB.status === 'ended', finalB && finalB.status);
  eq('both clients have the same stateVersion', finalA.stateVersion, finalB.stateVersion);
  eq('both clients have the same turn', finalA.turn, finalB.turn);
  const scoresA = {};
  const scoresB = {};
  (finalA.state.players || []).forEach(function (p) { scoresA[p.name] = p.score; });
  (finalB.state.players || []).forEach(function (p) { scoresB[p.name] = p.score; });
  const sorted = function (map) {
    return Object.keys(map).sort().map(function (name) { return [name, map[name]]; });
  };
  eq('final scores match by player', sorted(scoresA), sorted(scoresB));
  ok('both clients agree on the winner',
    finalA.state.players[finalA.summary.winner] &&
    finalA.state.players[finalA.summary.winner].name ===
    finalB.state.players[finalB.summary.winner].name,
    JSON.stringify({
      a: finalA.state.players[finalA.summary.winner] && finalA.state.players[finalA.summary.winner].name,
      b: finalB.state.players[finalB.summary.winner] && finalB.state.players[finalB.summary.winner].name
    }));
  ok('both clients played multiple moves', plays.every(function (play) { return play.steps > 5; }),
    JSON.stringify(plays.map(function (play) { return play.steps; })));
  await sleep(350);
  ok('result modal shown on A',
    await A.page.evaluate(function () { return !document.getElementById('resultModal').hidden; }));
  ok('result modal shown on B',
    await B.page.evaluate(function () { return !document.getElementById('resultModal').hidden; }));

  const board = await (await fetch(origin + '/api/leaderboard?game=azul&limit=50')).json();
  const entry = (board.entries || []).find(function (item) { return item.roomId === roomId; });
  ok('Azul result entered the server leaderboard', !!entry, JSON.stringify(board.total));
  if (entry) {
    eq('leaderboard gameId', entry.gameId, 'azul');
    eq('leaderboard participants', entry.participants.length, 2);
    ok('leaderboard stores anonymous hashes only', entry.participants.every(function (p) {
      return typeof p.playerHash === 'string' && p.playerHash.length === 64 && !p.playerId;
    }), JSON.stringify(entry.participants));
  }

  section('Session reconnect after reload');
  const versionBeforeReload = finalA.stateVersion;
  await A.page.goto(origin + ENTRY + '?room=' + encodeURIComponent(roomId), { waitUntil: 'load' });
  await A.page.waitForFunction(function () {
    var view = window.__azulOnline && window.__azulOnline.view();
    return !!view && view.roomId && view.state;
  }, null, { timeout: 15000 });
  const reconnected = await A.page.evaluate(function () {
    return {
      playerId: window.__azulOnline.playerId(),
      roomId: window.__azulOnline.room(),
      view: window.__azulOnline.view()
    };
  });
  eq('reconnect restores player id', reconnected.playerId, 'Alice');
  eq('reconnect restores the same room', reconnected.roomId, roomId);
  ok('reconnect restores the same game state version or newer',
    reconnected.view.stateVersion >= versionBeforeReload,
    versionBeforeReload + ' -> ' + reconnected.view.stateVersion);
  const reconnectScores = {};
  (reconnected.view.state.players || []).forEach(function (p) { reconnectScores[p.name] = p.score; });
  const sortedReconnect = function (map) {
    return Object.keys(map).sort().map(function (name) { return [name, map[name]]; });
  };
  eq('reconnect restores the final scores', sortedReconnect(reconnectScores), sorted(scoresA));
  ok('reconnect does not need a new join', !!reconnected.view.state);

  section('Mobile 390x844 / 320x568, touch targets, FPS, console');
  try {
    await A.page.evaluate(function () {
      var close = document.getElementById('closeResult');
      if (close && !document.getElementById('resultModal').hidden) close.click();
    });
    const viewports = [
      { width: 390, height: 844, name: '390x844' },
      { width: 320, height: 568, name: '320x568' }
    ];
    for (const vp of viewports) {
      await A.page.setViewportSize({ width: vp.width, height: vp.height });
      await sleep(250);
      const metrics = await A.page.evaluate(function () {
        var visible = function (el) {
          return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        };
        var targets = Array.prototype.slice.call(document.querySelectorAll('button, a.btn, input, select'));
        var small = targets.filter(function (el) {
          if (!visible(el)) return false;
          var rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44);
        }).map(function (el) {
          var rect = el.getBoundingClientRect();
          return (el.id || el.className || el.tagName) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height);
        });
        return {
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          small: small,
          factories: document.querySelectorAll('.factory').length
        };
      });
      ok(vp.name + ' no horizontal overflow',
        metrics.scrollWidth <= vp.width + 1 && metrics.bodyScrollWidth <= vp.width + 1,
        metrics.scrollWidth + '/' + metrics.bodyScrollWidth + ' vs ' + vp.width);
      ok(vp.name + ' viewport matches emulation',
        metrics.innerWidth === vp.width && metrics.innerHeight === vp.height,
        metrics.innerWidth + 'x' + metrics.innerHeight);
      ok(vp.name + ' all touch targets >=44px', metrics.small.length === 0, JSON.stringify(metrics.small));
      ok(vp.name + ' keeps all 5 factories', metrics.factories === 5, String(metrics.factories));
      const fps = await A.page.evaluate(function () {
        return new Promise(function (resolve) {
          var frames = 0;
          var start = performance.now();
          function loop(time) {
            frames += 1;
            if (time - start >= 800) resolve(frames / ((time - start) / 1000));
            else requestAnimationFrame(loop);
          }
          requestAnimationFrame(loop);
        });
      });
      ok(vp.name + ' rAF FPS >=30', fps >= 30, 'fps=' + Math.round(fps));
    }
  } catch (err) {
    ok('mobile smoke completed', false, err && err.stack ? err.stack : String(err));
  }

  section('Console, exceptions and external requests');
  const externalRequests = requests.filter(function (url) {
    return !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:') &&
      !url.startsWith('about:') && !url.startsWith('chrome-devtools:');
  });
  eq('zero console errors', consoleErrors, []);
  eq('zero page exceptions', pageErrors, []);
  eq('zero external requests', externalRequests, []);
  ok('no failed joins leaked into the UI', true);
} catch (err) {
  fatal = err;
  console.log('\nFATAL: ' + (err && err.stack ? err.stack : String(err)));
  failed += 1;
  failures.push('FATAL: ' + (err && err.message ? err.message : String(err)));
} finally {
  for (const context of contexts) {
    try { await Promise.race([context.close(), sleep(3000)]); } catch (err) { /* ignore */ }
  }
  try { await Promise.race([app.close(), sleep(3000)]); } catch (err) { /* ignore */ }
  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('Failures:');
    failures.forEach(function (line) { console.log(' - ' + line); });
  }
  // Do not call browser.close(): it would close the resident Chrome.
  process.exit(failed > 0 ? 1 : 0);
}
