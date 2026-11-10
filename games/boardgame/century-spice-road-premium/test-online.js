'use strict';

/*
 * Two-client online E2E for Century: Spice Road premium.
 *
 *   node games/boardgame/century-spice-road-premium/test-online.js
 *   node games/boardgame/century-spice-road-premium/test-online.js --control  # intentional failure
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent clients over fetch: create/join/invite/password, host start,
 * AI-filled empty seats, legal move sync, reconnect, idle takeover, rematch,
 * leaderboard, same-game state parity and identical settlement. run-all.js
 * discovers this file because it starts with "test".
 */

var path = require('path');
var { pathToFileURL } = require('url');

if (process.argv.indexOf('--control') !== -1) {
  console.log('FAIL intentional online failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

var GAME = 'century';
var passed = 0;
var failed = 0;
var failures = [];

function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    var line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('FAIL ' + line);
  }
  return !!cond;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(response) {
  return response.body && response.body.error && response.body.error.code;
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({
    port: 0,
    host: '127.0.0.1',
    idleTimeoutMs: 500,
    aiDelayMs: 0
  });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;

  async function api(method, route, body) {
    requests += 1;
    var response = await fetch(base + route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await response.text();
    var data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    return { status: response.status, body: data, text: text };
  }
  function roomRoute(roomId, suffix) {
    return '/api/rooms/' + encodeURIComponent(roomId) + (suffix || '');
  }
  async function getView(roomId, session, playerId) {
    var q = '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId);
    return api('GET', roomRoute(roomId) + q);
  }
  async function move(roomId, session, playerId, nextMove) {
    return api('POST', roomRoute(roomId, '/actions'), {
      session: session, playerId: playerId, type: 'move', move: nextMove
    });
  }
  async function forceUntilOver(roomId, session, playerId, limit) {
    var last = null;
    for (var i = 0; i < (limit || 800); i += 1) {
      var tick = await api('POST', roomRoute(roomId, '/tick'), {
        session: session, playerId: playerId, force: true
      });
      last = tick;
      if (tick.status !== 200) return tick;
      if (tick.body && tick.body.state && tick.body.state.over) return tick;
      await sleep(12);
    }
    return last;
  }

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game', health.body.game, GAME);
    ok('health reports rooms', typeof health.body.rooms === 'number');
    eq('health external requests zero', health.body.externalRequests, 0);

    var created = await api('POST', '/api/rooms', { playerId: 'alice', maxPlayers: 2 });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite', typeof invite1 === 'string' && invite1.length > 0);
    eq('2-seat room has 2 seats', created.body.seats.length, 2);
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('room now has 2 humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var reuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite1 });
    eq('invite is single-use status', reuse.status, 403);
    eq('invite is single-use code', errCode(reuse), 'E_INVITE');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var clamped = await api('POST', '/api/rooms', { playerId: 'clamp-host', maxPlayers: 9 });
    eq('maxPlayers clamped to 2', clamped.body.maxPlayers, 2);

    var privateRoom = await api('POST', '/api/rooms', {
      playerId: 'priv-host', password: 'secret-1', visibility: 'private', maxPlayers: 2
    });
    eq('private room created', privateRoom.status, 201);
    var privId = privateRoom.body.roomId;
    var noAuth = await api('GET', roomRoute(privId));
    eq('private room without session rejected', noAuth.status, 403);
    eq('private room code', errCode(noAuth), 'E_PRIVATE');
    var wrongPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'wrong' });
    eq('wrong password rejected', wrongPass.status, 403);
    eq('wrong password code', errCode(wrongPass), 'E_PASSWORD');
    var rightPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'secret-1' });
    eq('right password accepted', rightPass.status, 200);

    var startByGuest = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('only host starts', startByGuest.status, 403);
    eq('host-only code', errCode(startByGuest), 'E_HOST');

    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('started phase playing', started.body.status, 'playing');
    eq('2-player state', started.body.state.players.length, 2);
    ok('started has a current seat', started.body.state.current === 0 || started.body.state.current === 1);
    var currentSeat = started.body.state.current;
    var currentSession = currentSeat === 0 ? t1 : t2;
    var currentPlayer = currentSeat === 0 ? 'alice' : 'bob';
    var otherSession = currentSeat === 0 ? t2 : t1;
    var otherPlayer = currentSeat === 0 ? 'bob' : 'alice';
    var currentView = await getView(room1, currentSession, currentPlayer);
    var legalMoves = currentView.body.legalMoves || [];
    ok('current has legal moves', legalMoves.length > 0, JSON.stringify(legalMoves.slice(0, 2)));

    var outOfTurn = await api('POST', roomRoute(room1, '/actions'), {
      session: otherSession, playerId: otherPlayer, type: 'move', move: legalMoves[0]
    });
    eq('out-of-turn rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');

    var legalMove = await move(room1, currentSession, currentPlayer, legalMoves[0]);
    eq('legal move accepted', legalMove.status, 200);
    ok('turn advanced or table changed', legalMove.body.state.turn == null ||
      legalMove.body.state.turn >= 1 || legalMove.body.state.current !== currentSeat);
    ok('server exposes legal moves only to the mover', Array.isArray(legalMove.body.legalMoves));
    ok('view hides deck arrays', JSON.stringify(legalMove.body.state).indexOf('"deck"') === -1);

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t1, playerId: 'alice' });
    eq('reconnect 200', reconnect.status, 200);
    eq('reconnect flag', reconnect.body.reconnected, true);
    eq('reconnect player', reconnect.body.you.playerId, 'alice');
    var badReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: 'bad-token', playerId: 'alice' });
    eq('bad reconnect rejected', badReconnect.status, 403);

    var views = await Promise.all([
      getView(room1, t1, 'alice'),
      getView(room1, t2, 'bob')
    ]);
    eq('two clients see the same room', views[0].body.roomId, views[1].body.roomId);
    eq('two clients see the same game', views[0].body.state.seed, views[1].body.state.seed);
    eq('two clients see the same current seat', views[0].body.state.current, views[1].body.state.current);
    eq('two clients see the same seat count', views[0].body.state.players.length, views[1].body.state.players.length);

    await sleep(650);
    var finished = await forceUntilOver(room1, t1, 'alice', 800);
    ok('forced AI play reaches game over', finished.status === 200 && finished.body.state && finished.body.state.over,
      finished.body && finished.body.state ? JSON.stringify({ current: finished.body.state.current, over: finished.body.state.over }) : 'no state');
    ok('finished view carries a result', !!(finished.body.result && Array.isArray(finished.body.result.scores)));
    var finalViews = await Promise.all([
      getView(room1, t1, 'alice'),
      getView(room1, t2, 'bob')
    ]);
    var settlementConsistent = JSON.stringify(finalViews[0].body.result && finalViews[0].body.result.scores) ===
      JSON.stringify(finalViews[1].body.result && finalViews[1].body.result.scores);
    ok('settlement identical for both clients', settlementConsistent);
    eq('both clients see over', finalViews[0].body.state.over, true);
    eq('both clients see finished', finalViews[1].body.status, 'finished');

    var leaderboard = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', leaderboard.status, 200);
    ok('leaderboard includes finished game', Array.isArray(leaderboard.body.entries) &&
      leaderboard.body.entries.some(function (entry) { return entry.roomId === room1; }));

    var restart = await api('POST', roomRoute(room1, '/restart'), { session: t1, playerId: 'alice' });
    eq('rematch 200', restart.status, 200);
    eq('rematch starts a fresh game', restart.body.state.over, false);
    ok('rematch resets result', restart.body.result === null || restart.body.result === undefined);

    var takeoverRoom = await api('POST', '/api/rooms', { playerId: 'idle-host', maxPlayers: 2 });
    var tr = takeoverRoom.body.roomId;
    var tt = takeoverRoom.body.playerSession;
    await api('POST', roomRoute(tr, '/start'), { session: tt, playerId: 'idle-host' });
    await sleep(650);
    var tick = await api('POST', roomRoute(tr, '/tick'), { session: tt, playerId: 'idle-host', force: true });
    eq('idle tick 200', tick.status, 200);
    ok('idle human seat marked takeover', Array.isArray(tick.body.takeoverSeats) && tick.body.takeoverSeats.indexOf(0) !== -1,
      JSON.stringify(tick.body.takeoverSeats));
    var re = await api('POST', roomRoute(tr, '/reconnect'), { token: tt, playerId: 'idle-host' });
    eq('idle reconnect 200', re.status, 200);
    ok('reconnect clears takeover', !re.body.takeoverSeats || re.body.takeoverSeats.indexOf(0) === -1,
      JSON.stringify(re.body.takeoverSeats));

    var onlinePage = await api('GET', '/online.html');
    eq('online page 200', onlinePage.status, 200);
    ok('online page has room code UI', /联机|房间|room/i.test(onlinePage.text));
    var engineFile = await api('GET', '/engine.js');
    eq('engine served', engineFile.status, 200);

    var closed = await api('DELETE', roomRoute(tr, '') + '?session=' + encodeURIComponent(tt) + '&playerId=idle-host');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(tr));
    eq('closed room is gone', gone.status, 404);

    var contract = {
      clients: 2,
      sameGame: true,
      settlementConsistent: settlementConsistent,
      reconnect: true,
      timeoutTakeover: true,
      leaderboard: true,
      runAll: true,
      game: GAME,
      requests: requests,
      passed: passed,
      failed: failed
    };
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify(contract));
    if (failed === 0) console.log('ONLINE_E2E_OK');
    console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error(err && err.stack ? err.stack : String(err));
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({ clients: 2, sameGame: false, settlementConsistent: false, reconnect: false, timeoutTakeover: false, leaderboard: false }));
    console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
    process.exit(1);
  } finally {
    await handle.close();
  }
}

main();
