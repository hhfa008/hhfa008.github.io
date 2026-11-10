'use strict';
/*
 * Patchwork Premium — two-client online E2E.
 *
 *   node games/boardgame/patchwork-premium/test-online.js
 *   node games/boardgame/patchwork-premium/test-online.js --control  # exit 1
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent clients: invite/password, AI fill, server-authoritative rules,
 * reconnect, idle takeover, one full match with settlement consistency,
 * leaderboard, rematch, leave-to-AI and room close. This is a dual-client
 * same-game test and is discovered by games/tests/run-all.js.
 */

var fs = require('fs');
var path = require('path');
var { pathToFileURL } = require('url');
var Engine = require('./engine.js');

if (process.argv.indexOf('--control') !== -1) {
  console.log('  FAIL intentional online failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

var passed = 0, failed = 0, failures = [];
function ok(label, cond, detail) {
  if (cond) passed += 1;
  else { failed += 1; var line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('FAIL ' + line); }
  return !!cond;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(r) { return r.body && r.body.error && r.body.error.code; }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 350, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;

  async function api(method, route, body) {
    requests += 1;
    var response = await fetch(base + route, {
      method: method, headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await response.text();
    var data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: response.status, body: data, text: text };
  }
  function roomRoute(id, suffix) { return '/api/rooms/' + encodeURIComponent(id) + (suffix || ''); }
  function getView(id, session, playerId) {
    return api('GET', roomRoute(id) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }

  var sameGame = false, settlementConsistent = false, reconnectOk = false;
  var timeoutOk = false, leaderboardOk = false, rematchOk = false;

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=patchwork', health.body.game, 'patchwork');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    var created = await api('POST', '/api/rooms', { playerId: 'alice', maxPlayers: 2 });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite token', typeof invite === 'string' && invite.length > 0);
    eq('two seats', created.body.seats.length, 2);
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('two humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var reuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite });
    eq('invite is single-use status', reuse.status, 403);
    eq('invite is single-use code', errCode(reuse), 'E_INVITE');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var guest = await api('POST', roomRoute(room1, '/join'), { playerId: 'mallory' });
    ok('third seat rejected', guest.status === 409 || guest.status === 422, String(guest.status));

    var early = await api('POST', roomRoute(room1, '/actions'), { session: t1, playerId: 'alice', move: { type: 'skip' } });
    eq('action before start rejected', early.status, 409);
    eq('action before start code', errCode(early), 'E_STATE');

    var bobStart = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('non-host cannot start', bobStart.status, 403);

    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    ok('match is playing', started.body.started === true);
    ok('initial state has 33 pieces', started.body.state.pieces.length === 33);
    ok('initial 5 buttons', started.body.state.players[0].buttons === 5 && started.body.state.players[1].buttons === 5);

    var v1 = await getView(room1, t1, 'alice');
    var v2 = await getView(room1, t2, 'bob');
    sameGame = v1.body.state.players[0].time === v2.body.state.players[0].time &&
      v1.body.state.turn === v2.body.state.turn && v1.body.state.pieces.length === v2.body.state.pieces.length;
    ok('two clients see the same game', sameGame);

    var wrongTurn = await api('POST', roomRoute(room1, '/actions'), { session: t2, playerId: 'bob', move: { type: 'skip' } });
    ok('out-of-turn action rejected', wrongTurn.status === 409, String(wrongTurn.status));

    var badMove = await api('POST', roomRoute(room1, '/actions'), {
      session: t1, playerId: 'alice', move: { type: 'buy', patchId: 'P01', orientationIndex: 0, row: 99, col: 99 }
    });
    eq('illegal placement rejected', badMove.status, 422);
    eq('illegal placement code', errCode(badMove), 'E_ACTION');

    var legal = v1.body.legalMoves || [];
    ok('server lists legal moves', legal.length > 0, String(legal.length));
    var first = legal.find(function (m) { return m.type === 'buy'; }) || legal[0];
    var moved = await api('POST', roomRoute(room1, '/actions'), { session: t1, playerId: 'alice', move: first });
    eq('legal action accepted', moved.status, 200);
    ok('turn advanced after action', moved.body.state.turn > v1.body.state.turn);

    await sleep(450);
    var idleView = await getView(room1, t1, 'alice');
    timeoutOk = !!(idleView.body.takeoverSeats && idleView.body.takeoverSeats.indexOf(1) !== -1);
    ok('idle seat is taken over by AI', timeoutOk, JSON.stringify(idleView.body.takeoverSeats));

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t2, playerId: 'bob' });
    eq('reconnect 200', reconnect.status, 200);
    reconnectOk = reconnect.body.reconnected === true && (reconnect.body.takeoverSeats || []).indexOf(1) === -1;
    ok('reconnect clears takeover', reconnectOk);

    /* Drive the rest of the match: alice plays a legal move when possible,
       otherwise force the server to advance the controlled/AI seat. */
    var guard = 0;
    var last = reconnect.body;
    while (!last.state.over && guard < 600) {
      guard += 1;
      var av = await getView(room1, t1, 'alice');
      var bv = await getView(room1, t2, 'bob');
      last = av.body;
      if (last.state.over) break;
      var acting = null;
      if (av.body.canMove) acting = { body: av.body, session: t1, pid: 'alice' };
      else if (bv.body.canMove) acting = { body: bv.body, session: t2, pid: 'bob' };
      if (acting) {
        var lm = (acting.body.legalMoves || []).find(function (m) { return m.type === 'buy'; }) || (acting.body.legalMoves || [])[0];
        if (lm) {
          var r = await api('POST', roomRoute(room1, '/actions'), { session: acting.session, playerId: acting.pid, move: lm });
          if (r.status === 200) { last = r.body; continue; }
        }
      }
      /* Neither human can move: force the server to advance a controlled AI seat. */
      var ticked = await api('POST', roomRoute(room1, '/tick'), { session: t1, playerId: 'alice' });
      if (ticked.status !== 200) break;
      last = ticked.body;
    }
    ok('match finishes', !!(last.state && last.state.over), 'guard ' + guard);
    ok('result has winner or tie', !!(last.state.result && last.state.result.scores && last.state.result.scores.length === 2));

    var endA = await getView(room1, t1, 'alice');
    var endB = await getView(room1, t2, 'bob');
    settlementConsistent = endA.body.state.over === true && endB.body.state.over === true &&
      JSON.stringify(endA.body.state.result) === JSON.stringify(endB.body.state.result);
    ok('both clients agree on settlement', settlementConsistent);

    var lb = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', lb.status, 200);
    leaderboardOk = lb.body.entries.length >= 1 && lb.body.entries[0].game === 'patchwork';
    ok('leaderboard records the match', leaderboardOk);

    var notOver = await api('POST', roomRoute(room1, '/restart'), { session: t1, playerId: 'alice' });
    eq('host rematch 200', notOver.status, 200);
    rematchOk = notOver.body.started === true && notOver.body.state.over === false && notOver.body.state.turn === 1;
    ok('rematch starts a fresh game', rematchOk);

    var leave = await api('POST', roomRoute(room1, '/leave'), { session: t2, playerId: 'bob' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(room1, t1, 'alice');
    ok('left seat becomes AI', afterLeave.body.seats[1].ai === true);

    var closed = await api('DELETE', roomRoute(room1) + '?session=' + encodeURIComponent(t1) + '&playerId=alice');
    eq('host closes room', closed.status, 200);
    var gone = await getView(room1, t1, 'alice');
    eq('closed room is 404', gone.status, 404);

    /* One human + AI seat keeps the room startable. */
    var solo = await api('POST', '/api/rooms', { playerId: 'solo' });
    var soloId = solo.body.roomId;
    var soloStart = await api('POST', roomRoute(soloId, '/start'), { session: solo.body.playerSession, playerId: 'solo' });
    eq('one human can start against AI', soloStart.status, 200);
    ok('AI seat controlled', soloStart.body.seats[1].ai === true);
    await api('DELETE', roomRoute(soloId) + '?session=' + encodeURIComponent(solo.body.playerSession) + '&playerId=solo');

    ok('request count sane', requests > 20 && requests < 500, String(requests));
  } finally {
    await handle.close();
  }

  console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'patchwork', clients: 2, sameGame: sameGame, settlementConsistent: settlementConsistent,
    reconnect: reconnectOk, timeoutTakeover: timeoutOk, leaderboard: leaderboardOk,
    rematch: rematchOk, runAll: true, result: passed + ' passed, ' + failed + ' failed', exitCode: failed ? 1 : 0
  }));
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('FAILURES:');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
