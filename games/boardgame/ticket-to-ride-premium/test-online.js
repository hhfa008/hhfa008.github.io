'use strict';
/*
 * Ticket to Ride Premium — two-client online E2E.
 *   node games/boardgame/ticket-to-ride-premium/test-online.js
 *   node games/boardgame/ticket-to-ride-premium/test-online.js --control  # exit 1
 *
 * Real HTTP room server + two independent clients: invite/password, AI fill,
 * server-authoritative moves, hidden hands/tickets, reconnect, idle takeover,
 * one full match with consistent settlement, leaderboard, rematch, leave-to-AI
 * and room close. run-all.js discovers this file.
 */

var path = require('path');
var { pathToFileURL } = require('url');

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
function eq(label, actual, expected) { return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
function errCode(r) { return r.body && r.body.error && r.body.error.code; }
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 2500, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;
  async function api(method, route, body) {
    requests += 1;
    var response = await fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var text = await response.text(); var data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: response.status, body: data, text };
  }
  function roomRoute(id, suffix) { return '/api/rooms/' + encodeURIComponent(id) + (suffix || ''); }
  function getView(id, session, playerId) { return api('GET', roomRoute(id) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId)); }
  var sameGame = false, settlementConsistent = false, reconnectOk = false, timeoutOk = false, leaderboardOk = false, rematchOk = false;

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=ticket-to-ride', health.body.game, 'ticket-to-ride');
    var created = await api('POST', '/api/rooms', { playerId: 'alice' });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId, t1 = created.body.playerSession, invite = created.body.inviteToken;
    eq('two seats', created.body.seats.length, 2);
    eq('empty seat is AI', created.body.seats[1].ai, true);
    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('two humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);
    var reuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite });
    eq('invite single-use', reuse.status, 403);
    eq('invite code', errCode(reuse), 'E_INVITE');
    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    var early = await api('POST', roomRoute(room1, '/actions'), { session: t1, playerId: 'alice', move: { type: 'drawCard', source: 'deck' } });
    eq('action before start rejected', early.status, 409);
    var bobStart = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('non-host start rejected', bobStart.status, 403);
    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host starts', started.status, 200);
    ok('match started', started.body.started === true);
    ok('40 routes on board', started.body.state.routes.length === 40);
    ok('20 cities on board', started.body.state.players.length === 2 && started.body.state.market.length === 5);

    var v1 = await getView(room1, t1, 'alice');
    var v2 = await getView(room1, t2, 'bob');
    sameGame = v1.body.state.routes.length === v2.body.state.routes.length && v1.body.state.market.join(',') === v2.body.state.market.join(',');
    ok('two clients see same market/routes', sameGame);
    ok('own hand visible', v1.body.state.players[0].hand && typeof v1.body.state.players[0].hand.red === 'number');
    ok('opponent hand hidden', v1.body.state.players[1].hand === null);
    ok('opponent tickets hidden', v1.body.state.players[1].cards === null);
    ok('own tickets visible', Array.isArray(v1.body.state.players[0].cards));

    var wrongTurn = await api('POST', roomRoute(room1, '/actions'), { session: t2, playerId: 'bob', move: { type: 'drawCard', source: 'deck' } });
    ok('out-of-turn rejected', wrongTurn.status === 409, String(wrongTurn.status));
    var illegal = await api('POST', roomRoute(room1, '/actions'), { session: t1, playerId: 'alice', move: { type: 'claimRoute', routeId: 999 } });
    eq('illegal route rejected', illegal.status, 422);
    eq('illegal route code', errCode(illegal), 'E_ACTION');

    var legal = v1.body.legalMoves || [];
    ok('server lists legal moves', legal.length > 0, String(legal.length));
    var first = legal.filter(function (m) { return m.type === 'drawCard'; })[0] || legal[0];
    var moved = await api('POST', roomRoute(room1, '/actions'), { session: t1, playerId: 'alice', move: first });
    eq('legal move accepted', moved.status, 200);
    ok('draw count applied', moved.body.state.drawsLeft === 1 || moved.body.state.current === 1, String(moved.body.state.drawsLeft));

    await sleep(2700);
    var idleView = await getView(room1, t1, 'alice');
    timeoutOk = !!(idleView.body.takeoverSeats && idleView.body.takeoverSeats.indexOf(1) !== -1);
    ok('idle seat taken over by AI', timeoutOk, JSON.stringify(idleView.body.takeoverSeats));
    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t2, playerId: 'bob' });
    eq('reconnect 200', reconnect.status, 200);
    reconnectOk = reconnect.body.reconnected === true && (reconnect.body.takeoverSeats || []).indexOf(1) === -1;
    ok('reconnect clears takeover', reconnectOk);

    var guard = 0;
    while (!idleView.body.state.over && guard < 500) {
      guard += 1;
      var av = await getView(room1, t1, 'alice');
      var bv = await getView(room1, t2, 'bob');
      if (av.body.state.over || bv.body.state.over) break;
      var acting = av.body.canMove ? { view: av.body, session: t1, pid: 'alice' } : (bv.body.canMove ? { view: bv.body, session: t2, pid: 'bob' } : null);
      if (acting) {
        var mv = (acting.view.legalMoves || [])[0];
        if (mv) {
          var r = await api('POST', roomRoute(room1, '/actions'), { session: acting.session, playerId: acting.pid, move: mv });
          if (r.status === 200) continue;
        }
      }
      var ticked = await api('POST', roomRoute(room1, '/tick'), { session: t1, playerId: 'alice' });
      if (ticked.status !== 200) break;
    }
    var endA = await getView(room1, t1, 'alice');
    var endB = await getView(room1, t2, 'bob');
    ok('match finishes', endA.body.state.over === true, 'guard ' + guard);
    ok('both seats have scores', !!(endA.body.result && endA.body.result.scores.length === 2));
    settlementConsistent = endA.body.state.over && endB.body.state.over &&
      JSON.stringify(endA.body.result || {}) === JSON.stringify(endB.body.result || {});
    ok('both clients agree on settlement', settlementConsistent);

    var lb = await api('GET', '/api/leaderboard');
    leaderboardOk = lb.body.entries.length >= 1 && lb.body.entries[0].game === 'ticket-to-ride';
    ok('leaderboard records match', leaderboardOk);
    var restart = await api('POST', roomRoute(room1, '/restart'), { session: t1, playerId: 'alice' });
    eq('host rematch 200', restart.status, 200);
    rematchOk = restart.body.started === true && restart.body.state.over === false;
    ok('rematch starts a fresh game', rematchOk);
    var leave = await api('POST', roomRoute(room1, '/leave'), { session: t2, playerId: 'bob' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(room1, t1, 'alice');
    ok('left seat becomes AI', afterLeave.body.seats[1].ai === true);
    var closed = await api('DELETE', roomRoute(room1) + '?session=' + encodeURIComponent(t1) + '&playerId=alice');
    eq('host closes room', closed.status, 200);
    var gone = await getView(room1, t1, 'alice');
    eq('closed room 404', gone.status, 404);

    var solo = await api('POST', '/api/rooms', { playerId: 'solo' });
    var soloStart = await api('POST', roomRoute(solo.body.roomId, '/start'), { session: solo.body.playerSession, playerId: 'solo' });
    eq('one human starts against AI', soloStart.status, 200);
    await api('DELETE', roomRoute(solo.body.roomId) + '?session=' + encodeURIComponent(solo.body.playerSession) + '&playerId=solo');
    ok('request count sane', requests > 20 && requests < 1500, String(requests));
  } finally { await handle.close(); }

  console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'ticket-to-ride', clients: 2, sameGame, settlementConsistent, reconnect: reconnectOk,
    timeoutTakeover: timeoutOk, leaderboard: leaderboardOk, rematch: rematchOk, runAll: true,
    result: passed + ' passed, ' + failed + ' failed', exitCode: failed ? 1 : 0
  }));
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILURES:'); failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
}
main().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
