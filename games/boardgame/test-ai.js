#!/usr/bin/env node
'use strict';

/*
 * games/boardgame/test-ai.js
 *
 * Root-level wrapper so `node games/tests/run-all.js` discovers the boardgame
 * AI/room API (run-all.js only walks test*.js files).
 *
 * It starts app/server.mjs on a free loopback port, polls /health, then runs
 * black-box HTTP assertions for:
 *   - existing matches API regression
 *   - password rooms: create / wrong password / join / state / action / close
 *   - private room visibility
 *   - HTTP error paths (delegated to tests/ai-errors.test.mjs, which self-starts
 *     its own loopback server): 404 missing room, 403 wrong password/non-member,
 *     409/422 illegal moves, room-full/duplicate-join edges, voice auth
 *   - server/ai-eval.mjs CLI JSON output and --out file
 *
 * Prints exactly one machine-readable line:
 *   RESULT: N passed, M failed
 *
 * Never imports the engine. Exits 1 on failure and always kills the server.
 */

var fs = require('fs');
var os = require('os');
var net = require('net');
var path = require('path');
var childProcess = require('child_process');

var ROOT = __dirname;
var SERVER = path.join(ROOT, 'app', 'server.mjs');
var AI_EVAL = path.join(ROOT, 'server', 'ai-eval.mjs');
var TIMEOUT_MS = 4000;

var passed = 0;
var failed = 0;
var failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    return true;
  }
  failed += 1;
  failures.push(label + (detail ? ' — ' + detail : ''));
  return false;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function freePort() {
  return new Promise(function (resolve, reject) {
    var srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', function () {
      var port = srv.address().port;
      srv.close(function () { resolve(port); });
    });
  });
}

async function request(base, method, route, body, timeoutMs) {
  var init = {
    method: method,
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs || TIMEOUT_MS)
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  var response = await fetch(base + route, init);
  var text = await response.text();
  var parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (err) {
    parsed = null;
  }
  return { status: response.status, body: parsed, text: text };
}

function errorCode(body) {
  if (!body || typeof body !== 'object') return undefined;
  if (body.error && typeof body.error === 'object') return body.error.code;
  return body.code;
}

async function waitHealth(base, service) {
  var deadline = Date.now() + 10000;
  var last = null;
  while (Date.now() < deadline) {
    if (service.exitCode != null) return { ok: false, last: 'server exited ' + service.exitCode };
    try {
      var res = await request(base, 'GET', '/health', undefined, 1000);
      last = res;
      if (res.status === 200 && res.body && res.body.ok === true) return { ok: true, response: res };
    } catch (err) {
      last = { error: err && err.message ? err.message : String(err) };
    }
    await sleep(100);
  }
  return { ok: false, last: last };
}

function chooseTestAction(state) {
  var actions = state && Array.isArray(state.legalActions) ? state.legalActions : [];
  for (var i = 0; i < actions.length; i += 1) {
    var type = String(actions[i].type || '').toLowerCase();
    if (type === 'attack' || type === 'play') return actions[i];
  }
  return actions[0] || { type: 'endTurn' };
}

function runAiEval(base, outFile) {
  var result = childProcess.spawnSync(process.execPath, [
    AI_EVAL,
    '--base-url', base,
    '--game', 'card-battle',
    '--seed', '42',
    '--max-turns', '200',
    '--out', outFile
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' })
  });
  return result;
}

/*
 * The HTTP error-path contract lives in tests/ai-errors.test.mjs so that
 * `node tests/run-all.mjs` and this wrapper assert exactly the same thing.
 * The child starts its own loopback server; clear auto-discovery env vars so
 * an unrelated service on 8787/8788/3000 can never satisfy the suite.
 */
function runErrorSuite() {
  var env = Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' });
  delete env.BOARDGAME_AI_BASE_URL;
  delete env.BOARDGAME_API_BASE_URL;
  delete env.BOARDGAME_SERVER_URL;
  var result = childProcess.spawnSync(process.execPath,
    [path.join(ROOT, 'tests', 'ai-errors.test.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env: env
    });
  var text = (result.stdout || '') + '\n' + (result.stderr || '');
  var counts = text.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/);
  return {
    status: result.status,
    counts: counts,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

async function main() {
  var port = await freePort();
  var base = 'http://127.0.0.1:' + port;
  var service = childProcess.spawn(process.execPath, [SERVER, '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { BOARDGAME_API_TOKEN: '' })
  });
  var stderr = '';
  service.stderr.on('data', function (chunk) { stderr += chunk.toString(); });
  service.stdout.on('data', function () {});

  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-ai-test-'));
  var outFile = path.join(tmpDir, 'ai-result.json');

  try {
    var health = await waitHealth(base, service);
    ok('server starts and /health returns ok', health.ok, JSON.stringify(health.last));
    if (!health.ok) throw new Error('server did not become healthy');

    var body = health.response.body;
    ok('health identifies boardgame service', body.service === 'boardgame-ai-api', JSON.stringify(body.service));
    ok('health advertises rooms capability',
      Array.isArray(body.capabilities) && body.capabilities.indexOf('rooms') !== -1,
      JSON.stringify(body.capabilities));

    // --- rooms: create with password -------------------------------------
    var created = await request(base, 'POST', '/api/rooms', {
      gameType: 'card-battle',
      playerId: 'p1',
      seed: 42,
      password: 'secret-1'
    });
    ok('POST /api/rooms returns 201', created.status === 201, 'status ' + created.status);
    var room = created.body || {};
    ok('create returns roomId', typeof room.roomId === 'string' && room.roomId.length > 0, JSON.stringify(room.roomId));
    ok('create returns inviteCode', typeof room.inviteCode === 'string' && room.inviteCode.length > 0, String(room.inviteCode));
    ok('create returns playerSession', typeof room.playerSession === 'string' && room.playerSession.length > 0, String(room.playerSession));
    ok('create returns legalActions array', Array.isArray(room.legalActions), JSON.stringify(room.legalActions));
    ok('create response never contains the plaintext password', created.text.indexOf('secret-1') === -1);

    var roomId = room.roomId;
    var p1Session = room.playerSession;

    // --- wrong password ---------------------------------------------------
    var wrong = await request(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
      playerId: 'p2',
      password: 'wrong'
    });
    ok('wrong room password returns 403', wrong.status === 403, 'status ' + wrong.status);
    ok('wrong password has error.code', Boolean(errorCode(wrong.body)), JSON.stringify(wrong.body));

    // --- join with correct password --------------------------------------
    var joined = await request(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
      playerId: 'p2',
      password: 'secret-1'
    });
    ok('correct password joins the room', joined.status === 200, 'status ' + joined.status);
    var p2Session = joined.body && joined.body.playerSession;
    ok('join returns playerSession', typeof p2Session === 'string' && p2Session.length > 0, String(p2Session));

    // --- room state -------------------------------------------------------
    var stateRes = await request(base, 'GET',
      '/api/rooms/' + encodeURIComponent(roomId) +
      '?playerId=p1&session=' + encodeURIComponent(p1Session));
    ok('GET /api/rooms/:id returns 200', stateRes.status === 200, 'status ' + stateRes.status);
    var state = stateRes.body || {};
    ok('room state lists 2 players', Array.isArray(state.players) && state.players.length === 2,
      JSON.stringify(state.players && state.players.length));
    ok('room state has numeric turn', typeof state.turn === 'number', String(state.turn));
    ok('room state has phase', typeof state.phase === 'string', String(state.phase));
    ok('room state has zones', state.zones !== null && typeof state.zones === 'object', JSON.stringify(state.zones && Object.keys(state.zones)));
    ok('room state has legalActions array', Array.isArray(state.legalActions), JSON.stringify(state.legalActions));
    ok('room state has currentPlayerId', typeof state.currentPlayerId === 'string', String(state.currentPlayerId));

    // --- submit an action as the current player --------------------------
    var currentId = state.currentPlayerId;
    var currentSession = currentId === 'p1' ? p1Session : p2Session;
    var turnBefore = state.turn;
    var action = chooseTestAction(state);
    var acted = await request(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions',
      Object.assign({}, action, { playerId: currentId, session: currentSession }));
    ok('POST /api/rooms/:id/actions returns 200', acted.status === 200, 'status ' + acted.status + ' ' + acted.text.slice(0, 200));
    var afterAct = acted.body || {};
    ok('action advances or keeps a valid state',
      typeof afterAct.turn === 'number' && (afterAct.turn > turnBefore || afterAct.turn === turnBefore),
      'turn ' + turnBefore + ' -> ' + afterAct.turn);
    ok('action response still exposes legalActions', Array.isArray(afterAct.legalActions), JSON.stringify(afterAct.legalActions));

    // --- invalid action error shape --------------------------------------
    var afterState = afterAct.legalActions ? afterAct : state;
    var badCurrent = afterState.currentPlayerId;
    var badSession = badCurrent === 'p1' ? p1Session : p2Session;
    var invalid = await request(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions', {
      type: 'definitely-not-legal',
      playerId: badCurrent,
      session: badSession
    });
    ok('invalid action returns 4xx', invalid.status >= 400 && invalid.status < 500, 'status ' + invalid.status);
    ok('invalid action has error.code', Boolean(errorCode(invalid.body)), JSON.stringify(invalid.body));

    // --- private room visibility -----------------------------------------
    var privateRoom = await request(base, 'POST', '/api/rooms', {
      gameType: 'card-battle',
      playerId: 'pv1',
      seed: 7,
      visibility: 'private'
    });
    ok('private room created', privateRoom.status === 201, 'status ' + privateRoom.status);
    var pvId = privateRoom.body && privateRoom.body.roomId;
    var pvSession = privateRoom.body && privateRoom.body.playerSession;
    var denied = await request(base, 'GET', '/api/rooms/' + encodeURIComponent(pvId));
    ok('private room denies anonymous state read', denied.status === 403, 'status ' + denied.status);
    var allowed = await request(base, 'GET',
      '/api/rooms/' + encodeURIComponent(pvId) + '?playerId=pv1&session=' + encodeURIComponent(pvSession));
    ok('private room allows member state read', allowed.status === 200, 'status ' + allowed.status);

    // --- close room (host only) ------------------------------------------
    var closed = await request(base, 'DELETE',
      '/api/rooms/' + encodeURIComponent(roomId) + '?playerId=p1&session=' + encodeURIComponent(p1Session));
    ok('host can DELETE /api/rooms/:id', closed.status === 200, 'status ' + closed.status);
    var gone = await request(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId) + '?playerId=p1');
    ok('closed room is no longer readable', gone.status === 404, 'status ' + gone.status);

    // --- matches API regression ------------------------------------------
    var match = await request(base, 'POST', '/api/matches', { game: 'pokemon', seed: 20261110, ai: true });
    ok('POST /api/matches still returns 201', match.status === 201, 'status ' + match.status);
    var matchId = match.body && match.body.matchId;
    ok('match response has matchId', typeof matchId === 'string' && matchId.length > 0, String(matchId));
    var matchState = await request(base, 'GET', '/api/matches/' + encodeURIComponent(matchId));
    ok('GET /api/matches/:id returns 200', matchState.status === 200, 'status ' + matchState.status);
    var legal = await request(base, 'GET', '/api/matches/' + encodeURIComponent(matchId) + '/actions');
    ok('GET match actions returns an array', legal.status === 200 && Array.isArray(legal.body.actions),
      'status ' + legal.status);
    var ended = await request(base, 'POST', '/api/matches/' + encodeURIComponent(matchId) + '/actions',
      { type: 'end-turn' });
    ok('POST match action returns 200', ended.status === 200, 'status ' + ended.status);
    var evaluate = await request(base, 'POST', '/api/ai/evaluate', {
      game: 'pokemon',
      state: { turn: 1, handSize: 7, prizesRemaining: 6 },
      actions: ['attack', 'end-turn']
    });
    ok('POST /api/ai/evaluate still returns 200', evaluate.status === 200, 'status ' + evaluate.status);
    ok('evaluation object is present', Boolean(evaluate.body && evaluate.body.evaluation),
      JSON.stringify(evaluate.body));

    // --- ai-eval CLI ------------------------------------------------------
    var cli = runAiEval(base, outFile);
    ok('ai-eval CLI exits 0', cli.status === 0,
      'status ' + cli.status + ' stderr=' + (cli.stderr || '').slice(0, 300));
    var report = null;
    try {
      report = JSON.parse(cli.stdout || '');
    } catch (err) {
      report = null;
    }
    ok('ai-eval stdout is pure JSON', report !== null, String(cli.stdout || '').slice(0, 200));
    if (report) {
      ok('ai-eval schemaVersion is 1', report.schemaVersion === 1, String(report.schemaVersion));
      ok('ai-eval game is card-battle', report.game === 'card-battle', String(report.game));
      ok('ai-eval seed is 42', report.seed === 42, String(report.seed));
      ok('ai-eval startedAt/finishedAt are ISO strings',
        typeof report.startedAt === 'string' && typeof report.finishedAt === 'string',
        JSON.stringify([report.startedAt, report.finishedAt]));
      ok('ai-eval produced moves', Array.isArray(report.moves) && report.moves.length > 0,
        JSON.stringify(report.moves && report.moves.length));
      ok('ai-eval result has winner/score/reason',
        report.result && typeof report.result === 'object' &&
        'winner' in report.result && 'score' in report.result && 'reason' in report.result,
        JSON.stringify(report.result));
      ok('ai-eval errors is an array', Array.isArray(report.errors), JSON.stringify(report.errors));
      ok('ai-eval --out writes the same JSON', fs.existsSync(outFile) &&
        JSON.stringify(JSON.parse(fs.readFileSync(outFile, 'utf8'))) === JSON.stringify(report));
    }

    // --- HTTP error paths -------------------------------------------------
    var errors = runErrorSuite();
    if (!errors.counts) {
      ok('ai-errors suite produced a RESULT line', false,
        'exit ' + errors.status + ' ' + (errors.stderr || errors.stdout || '').slice(0, 400));
    } else {
      var errPassed = Number(errors.counts[1]);
      var errFailed = Number(errors.counts[2]);
      passed += errPassed;
      failed += errFailed;
      if (errFailed > 0) {
        (errors.stdout || '').split('\n').forEach(function (line) {
          if (/^FAIL:/.test(line)) failures.push('ai-errors: ' + line.slice(6));
        });
        failures.push('ai-errors: ' + errFailed + ' assertion(s) failed');
      }
      if (errors.status !== 0 && errFailed === 0) {
        ok('ai-errors suite exits cleanly', false, 'exit ' + errors.status);
      }
    }
  } catch (err) {
    ok('test harness completed without throwing', false, err && err.stack ? err.stack : String(err));
  } finally {
    try { service.kill('SIGTERM'); } catch (err) { /* ignore */ }
    var force = setTimeout(function () {
      try { service.kill('SIGKILL'); } catch (err) { /* ignore */ }
    }, 3000);
    force.unref();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }

  if (failures.length > 0) {
    console.log('');
    failures.forEach(function (line) { console.log('FAIL: ' + line); });
    if (stderr) console.log('server stderr:\n' + stderr.slice(-2000));
  }
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(function (err) {
  console.log('FAIL: harness crashed — ' + (err && err.stack ? err.stack : String(err)));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
