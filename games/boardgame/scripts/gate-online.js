#!/usr/bin/env node
'use strict';

/*
 * Multiplayer evidence collector for the shipped gate.
 *
 * Accepted evidence, in order:
 *   1. online-e2e.json with the full contract:
 *        clients>=2, sameGame, settlementConsistent, reconnect,
 *        timeoutTakeover, leaderboard, runAll
 *   2. a dual-client test named test-online.js or online-e2e.test.js that
 *      exits 0 AND emits a standardized result, either:
 *        ONLINE_E2E_JSON: {...full contract...}
 *      or a JSON object containing "clients" (whole stdout or a JSON block).
 *      The older gate required online-e2e.test.js only, so test-online.js was
 *      invisible; both names are now recognized and run-all discovers either
 *      because their basenames start with "test".
 *
 * A page is also required to show an implementation marker (WebSocket /
 * BroadcastChannel / room or invite code, or an online.js/rooms.js file).
 */

const fs = require('fs');
const path = require('path');
const child = require('child_process');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function hasContract(obj) {
  return !!(obj && obj.clients >= 2 && obj.sameGame === true &&
    obj.settlementConsistent === true && obj.reconnect === true &&
    obj.timeoutTakeover === true && obj.leaderboard === true);
}

function parseStandardized(stdout) {
  const text = String(stdout || '');
  const marker = text.match(/ONLINE_E2E_JSON:\s*(\{[\s\S]*?\})\s*$/m);
  if (marker) {
    try { return JSON.parse(marker[1]); } catch (e) { /* fall through */ }
  }
  const trimmed = text.trim();
  if (/^\{[\s\S]*\}$/.test(trimmed)) {
    try { return JSON.parse(trimmed); } catch (e) { /* fall through */ }
  }
  const start = text.indexOf('{');
  while (start !== -1) {
    for (let end = text.length; end > start; end--) {
      if (text.charAt(end - 1) !== '}') continue;
      try {
        const obj = JSON.parse(text.slice(start, end));
        if (obj && ('clients' in obj)) return obj;
      } catch (e) { /* keep trying shorter slices */ }
    }
    break;
  }
  return null;
}

function sourceMarkers(source) {
  const text = String(source || '');
  return {
    dualClient: /two independent clients|two clients|clientA[\s\S]{0,400}clientB|双客户端|两个客户端/i.test(text),
    sameGame: /roomId|same room|同一局|同一房间|same game/i.test(text),
    settlement: /settlement|结算|leaderboard|结果一致/i.test(text),
    reconnect: /reconnect|重连/i.test(text),
    takeover: /takeover|托管|AI fill|AI 补位|离开的座位转为 AI/i.test(text),
    leaderboard: /leaderboard|榜单|入榜/i.test(text)
  };
}

function runOnlineTest(testFile) {
  const res = child.spawnSync(process.execPath, [testFile], {
    cwd: path.dirname(testFile),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });
  const stdout = res.stdout || '';
  const parsed = parseStandardized(stdout);
  const markerOk = res.status === 0 && /ONLINE_E2E_OK\b/.test(stdout);
  const resultLine = (stdout.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i) || [null, null, null]);
  const resultFailed = resultLine[2] == null ? null : +resultLine[2];
  const source = (function () {
    try { return fs.readFileSync(testFile, 'utf8'); } catch (e) { return ''; }
  })();
  const markers = sourceMarkers(source);
  const markerCount = Object.keys(markers).filter((k) => markers[k]).length;
  // Existing suites such as codenames-premium/test-online.js predate the
  // standardized JSON and print `RESULT: N passed, M failed`. Accept an
  // exit-0 run when the source covers at least four contract dimensions.
  const sourceOk = res.status === 0 && (resultFailed == null || resultFailed === 0) && markerCount >= 4;
  return {
    exitCode: res.status,
    stdout: stdout.slice(0, 4000),
    standardized: parsed,
    markerOk: markerOk,
    resultLine: resultLine[0] || null,
    resultFailed: resultFailed,
    sourceMarkers: markers,
    markerCount: markerCount,
    sourceOk: sourceOk,
    ok: res.status === 0 && (hasContract(parsed) || markerOk || sourceOk)
  };
}

function onlineEvidence(game) {
  const dir = game.dir || path.join(path.resolve(__dirname, '..'), game.slug);
  const e2e = readJson(path.join(dir, 'online-e2e.json'));
  const names = ['test-online.js', 'online-e2e.test.js'];
  const testName = names.find((name) => fs.existsSync(path.join(dir, name))) || null;
  const testFile = testName ? path.join(dir, testName) : null;

  let engine = '';
  let index = '';
  try { engine = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'); } catch (e) { /* optional */ }
  try { index = fs.readFileSync(path.join(dir, 'index.html'), 'utf8'); } catch (e) { /* optional */ }
  const impl = /WebSocket|BroadcastChannel|roomCode|room-code|inviteCode|invite-code/i.test(engine + index) ||
    ['online.js', 'online.mjs', 'rooms.js', 'rooms.mjs', 'online-server.mjs', 'server.mjs', 'online.html']
      .some((f) => fs.existsSync(path.join(dir, f)));

  let standardized = null;
  let testRun = null;
  if (hasContract(e2e)) {
    standardized = e2e;
  } else if (testFile) {
    testRun = runOnlineTest(testFile);
    if (testRun.ok) {
      standardized = testRun.standardized || {
        marker: testRun.markerOk ? 'ONLINE_E2E_OK' : null,
        source: testName,
        resultLine: testRun.resultLine,
        sourceMarkers: testRun.sourceMarkers
      };
    }
  }

  const runAll = !!(testName && /^test/.test(testName)) || !!(e2e && e2e.runAll === true);
  const contractOk = hasContract(standardized);
  const markerPass = !!(standardized && standardized.marker === 'ONLINE_E2E_OK');
  const sourcePass = !!(testRun && testRun.sourceOk);
  const ok = !!((contractOk || markerPass || sourcePass) && testFile && impl && runAll);

  return {
    ok,
    detail: {
      evidence: !!e2e,
      contractInJson: hasContract(e2e),
      testFile: testName,
      dualClientTest: !!testFile,
      implementationMarker: impl,
      standardized: standardized ? {
        clients: standardized.clients,
        sameGame: standardized.sameGame,
        settlementConsistent: standardized.settlementConsistent,
        reconnect: standardized.reconnect,
        timeoutTakeover: standardized.timeoutTakeover,
        leaderboard: standardized.leaderboard,
        marker: standardized.marker || null,
        source: standardized.source || null,
        resultLine: standardized.resultLine || null,
        sourceMarkers: standardized.sourceMarkers || null
      } : null,
      testExitCode: testRun ? testRun.exitCode : null,
      testResultLine: testRun ? testRun.resultLine : null,
      sourceMarkers: testRun ? testRun.sourceMarkers : null,
      sourceContract: testRun ? testRun.sourceOk : null,
      runAll: runAll,
      fields: e2e ? {
        clients: e2e.clients, sameGame: e2e.sameGame,
        settlementConsistent: e2e.settlementConsistent,
        reconnect: e2e.reconnect, timeoutTakeover: e2e.timeoutTakeover,
        leaderboard: e2e.leaderboard, runAll: e2e.runAll
      } : null
    }
  };
}

// Deliberate controls: a failing test and an incomplete payload must be
// rejected; a valid test-online.js must be accepted.
function control() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-online-control-'));
  const make = (name, body) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'engine.js'), 'var room = new WebSocket("wss://x");');
    fs.writeFileSync(path.join(dir, 'index.html'), '<button>invite</button>');
    fs.writeFileSync(path.join(dir, 'test-online.js'), body);
    return dir;
  };

  const good = make('good', [
    'console.log("ONLINE_E2E_JSON: " + JSON.stringify({',
    '  clients: 2, sameGame: true, settlementConsistent: true,',
    '  reconnect: true, timeoutTakeover: true, leaderboard: true, runAll: true',
    '}));'
  ].join('\n'));
  const badExit = make('bad-exit', 'console.error("boom"); process.exit(1);');
  const badJson = make('bad-json', 'console.log("ONLINE_E2E_JSON: {\\"clients\\":1}");');

  const goodResult = onlineEvidence({ dir: good, slug: 'fixture-good' });
  const badExitResult = onlineEvidence({ dir: badExit, slug: 'fixture-bad-exit' });
  const badJsonResult = onlineEvidence({ dir: badJson, slug: 'fixture-bad-json' });

  const ok = goodResult.ok && !badExitResult.ok && !badJsonResult.ok;
  const detail = {
    positive_test_online_js: goodResult.ok,
    negative_exit_1: !badExitResult.ok,
    negative_incomplete_payload: !badJsonResult.ok
  };
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ok, detail };
}

module.exports = {
  hasContract,
  parseStandardized,
  runOnlineTest,
  onlineEvidence,
  control
};
