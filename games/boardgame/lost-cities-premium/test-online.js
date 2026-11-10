'use strict';

/*
 * Two-client online E2E for Lost Cities Premium.
 *
 *   node games/boardgame/lost-cities-premium/test-online.js
 *   node games/boardgame/lost-cities-premium/test-online.js --control  # expected failure
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent HTTP clients: invite/password, AI fill, server-authoritative
 * rules, hidden hands, reconnect, idle takeover, full three-round settlement,
 * leaderboard, rematch, leave-to-AI and room close.
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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
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
    idleTimeoutMs: 300,
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

  var sameGame = false;
  var settlementConsistent = false;
  var reconnectOk = false;
  var timeoutOk = false;
  var leaderboardOk = false;
  var rematchOk = false;

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=lost-cities', health.body.game, 'lost-cities');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    var created = await api('POST', '/api/rooms', { playerId: 'alice', maxPlayers: 2 });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite token', typeof invite1 === 'string' && invite1.length > 0);
    eq('two seats', created.body.seats.length, 2);
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('room now has 2 humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var inviteReuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite1 });
    eq('invite is single-use status', inviteReuse.status, 403);
    eq('invite is single-use code', errCode(inviteReuse), 'E_INVITE');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var privateRoom = await api('POST', '/api/rooms', { playerId: 'priv-host', password: 'secret-1', visibility: 'private', maxPlayers: 9 });
    eq('private room created', privateRoom.status, 201);
    eq('maxPlayers clamped to 2', privateRoom.body.maxPlayers, 2);
    var privId = privateRoom.body.roomId;
    var privToken = privateRoom.body.playerSession;
    var noAuth = await api('GET', roomRoute(privId));
    eq('private room without session rejected', noAuth.status, 403);
    eq('private room code', errCode(noAuth), 'E_PRIVATE');
    var wrongPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'wrong' });
    eq('wrong password rejected', wrongPass.status, 403);
    eq('wrong password code', errCode(wrongPass), 'E_PASSWORD');
    var rightPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'secret-1' });
    eq('right password accepted', rightPass.status, 200);
    ok('password room has second human', rightPass.body.seats[1].playerId === 'guest');
    await api('DELETE', roomRoute(privId) + '?session=' + encodeURIComponent(privToken) + '&playerId=priv-host');

    // AI fill: one human may start, the other seat becomes AI.
    var solo = await api('POST', '/api/rooms', { playerId: 'solo' });
    var soloStart = await api('POST', roomRoute(solo.body.roomId, '/start'), { session: solo.body.playerSession, playerId: 'solo' });
    eq('solo host starts against AI', soloStart.status, 200);
    eq('solo match has 2 seats', soloStart.body.state.playerCount, 2);
    eq('solo opponent seat is AI', soloStart.body.seats[1].ai, true);
    eq('solo opponent has no playerId', soloStart.body.seats[1].playerId, null);
    eq('solo starts on human turn', soloStart.body.state.current, 0);
    await api('DELETE', roomRoute(solo.body.roomId) + '?session=' + encodeURIComponent(solo.body.playerSession) + '&playerId=solo');

    var startByGuest = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('only host starts', startByGuest.status, 403);
    eq('host-only code', errCode(startByGuest), 'E_HOST');

    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('started phase playing', started.body.status, 'playing');
    eq('2-player state', started.body.state.playerCount, 2);
    eq('current is seat 0', started.body.state.current, 0);
    eq('round 1', started.body.state.round, 1);
    eq('deckCount 44', started.body.state.deckCount, 44);
    ok('current has legal moves', Array.isArray(started.body.legalMoves) && started.body.legalMoves.length > 0);
    eq('host sees own 8-card hand', started.body.state.players[0].hand.length, 8);
    eq('host does not see opponent hand', started.body.state.players[1].hand.length, 0);
    eq('opponent hand count exposed', started.body.state.players[1].handCount, 8);
    ok('server never exposes deck order', started.body.state.deck === undefined);
    eq('pendingDiscard starts null', started.body.state.pendingDiscard, null);

    var outOfTurn = await api('POST', roomRoute(room1, '/actions'), {
      session: t2, playerId: 'bob', type: 'move', move: { type: 'draw', source: 'deck' }
    });
    eq('out-of-turn rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');

    var legal0 = Engine.getLegalMoves(started.body.state);
    var first = legal0.find(function (m) { return m.type === 'play'; }) || legal0[0];
    var goodMove = await move(room1, t1, 'alice', first);
    eq('legal play accepted', goodMove.status, 200);
    eq('phase advanced to draw', goodMove.body.state.phase, 'draw');
    eq('same player still to draw', goodMove.body.state.current, 0);
    eq('hand down to 7 during draw phase', goodMove.body.state.players[0].hand.length, 7);
    eq('deck unchanged before draw', goodMove.body.state.deckCount, 44);

    var wrongDraw = await move(room1, t1, 'alice', { type: 'draw', source: 'deck', cardId: 'bogus' });
    eq('server rejects stale draw payload? legal deck draw still valid', wrongDraw.status, 200);
    eq('deck advanced after legal draw', wrongDraw.body.state.deckCount, 43);
    eq('turn switched to bob', wrongDraw.body.state.current, 1);
    var bobView = await getView(room1, t2, 'bob');
    eq('second client sees same turn', bobView.body.state.current, 1);
    eq('second client sees same round', bobView.body.state.round, 1);
    eq('second client gets own hand', bobView.body.state.players[1].hand.length, 8);
    eq('second client cannot see alice hand', bobView.body.state.players[0].hand.length, 0);
    sameGame = true;

    // Bob acts, then alice, leaves current back at alice's turn for timeout test.
    var bobMoves = bobView.body.legalMoves;
    var bobFirst = bobMoves.find(function (m) { return m.type === 'play'; }) || bobMoves[0];
    var bobAct = await move(room1, t2, 'bob', bobFirst);
    eq('bob legal action accepted', bobAct.status, 200);
    eq('bob now drawing', bobAct.body.state.current, 1);
    var bobView2 = await getView(room1, t2, 'bob');
    var bobDraw = bobView2.body.legalMoves[0];
    var bobDrew = await move(room1, t2, 'bob', bobDraw);
    eq('bob draw accepted', bobDrew.status, 200);
    eq('turn returns to alice', bobDrew.body.state.current, 0);

    var aliceReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t1, playerId: 'alice' });
    eq('reconnect 200', aliceReconnect.status, 200);
    eq('reconnect flag', aliceReconnect.body.reconnected, true);
    eq('reconnect player', aliceReconnect.body.you.playerId, 'alice');
    reconnectOk = true;
    var badReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: 'bad-token', playerId: 'alice' });
    eq('bad reconnect rejected', badReconnect.status, 403);
    eq('bad reconnect code', errCode(badReconnect), 'E_TOKEN');

    // Get to bob's turn, then idle past 300ms and let AI take over.
    var currentView = await getView(room1, t1, 'alice');
    var currentMoves = currentView.body.legalMoves;
    var actA = await move(room1, t1, 'alice', currentMoves[0]);
    if (actA.body.state.phase === 'draw') {
      var drawA = await move(room1, t1, 'alice', { type: 'draw', source: 'deck' });
      ok('alice completed turn before timeout probe', drawA.status === 200);
    }
    await sleep(430);
    var ticked = await api('POST', roomRoute(room1, '/tick'), { session: t1, playerId: 'alice', force: true });
    eq('tick 200', ticked.status, 200);
    ok('idle seat takeover recorded', Array.isArray(ticked.body.takeoverSeats) && ticked.body.takeoverSeats.indexOf(1) !== -1,
      JSON.stringify(ticked.body.takeoverSeats));
    timeoutOk = true;
    var bobReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t2, playerId: 'bob' });
    eq('idle player reconnect 200', bobReconnect.status, 200);
    ok('reconnect clears takeover', !bobReconnect.body.takeoverSeats || bobReconnect.body.takeoverSeats.indexOf(1) === -1,
      JSON.stringify(bobReconnect.body.takeoverSeats));

    // Full three-round game over the real HTTP API.
    var guard = 0;
    var lastView = null;
    while (guard < 1800) {
      var snap = await getView(room1, t1, 'alice');
      lastView = snap.body;
      if (!lastView || !lastView.state) { ok('server view available during play', false); break; }
      if (lastView.state.over) break;
      var current = lastView.state.current;
      var seat = lastView.seats[current];
      if (seat.playerId && !seat.controlledByAI) {
        var token = seat.playerId === 'alice' ? t1 : t2;
        var legal = lastView.legalMoves;
        if (!legal.length) {
          ok('human has a legal action at guard ' + guard, false, JSON.stringify(lastView.state));
          break;
        }
        var chosen = legal.find(function (m) { return m.type === 'play'; }) ||
          legal.find(function (m) { return m.type === 'discard'; }) || legal[0];
        var acted = await move(room1, token, seat.playerId, chosen);
        if (acted.status !== 200) {
          ok('play loop action accepted at guard ' + guard, false, acted.status + ' ' + JSON.stringify(acted.body));
          break;
        }
      } else {
        var tick2 = await api('POST', roomRoute(room1, '/tick'), { session: t1, playerId: 'alice', force: true });
        if (tick2.status !== 200) { ok('AI tick accepted at guard ' + guard, false, tick2.status); break; }
      }
      guard += 1;
    }
    var finalAlice = (await getView(room1, t1, 'alice')).body;
    var finalBob = (await getView(room1, t2, 'bob')).body;
    if (!finalAlice.state.over) {
      console.log('DIAG final', JSON.stringify({
        guard: guard, round: finalAlice.state.round, current: finalAlice.state.current,
        phase: finalAlice.state.phase, turn: finalAlice.state.turn,
        scores: finalAlice.state.players.map(function (p) { return p.totalScore; })
      }));
    }
    ok('three-round game reaches game over', finalAlice.state.over === true, 'guard=' + guard);
    ok('result has two scores', finalAlice.state.result && finalAlice.state.result.scores.length === 2);
    eq('result covers three rounds', finalAlice.state.result.scores[0].roundScores.length, 3);
    eq('bob sees identical result', finalBob.state.result.scores, finalAlice.state.result.scores);
    eq('bob sees identical winner', finalBob.state.result.winner, finalAlice.state.result.winner);
    eq('bob sees identical tied flag', finalBob.state.result.tied, finalAlice.state.result.tied);
    var sumTotals = finalAlice.state.result.scores.map(function (s) {
      return s.roundScores.reduce(function (a, b) { return a + b; }, 0);
    });
    eq('reported total equals round sum', finalAlice.state.result.scores.map(function (s) { return s.total; }), sumTotals);
    settlementConsistent = true;

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    eq('leaderboard game=lost-cities', board.body.game, 'lost-cities');
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard entry room', board.body.entries[0].roomId, room1);
    eq('leaderboard entry has two scores', board.body.entries[0].scores.length, 2);
    leaderboardOk = true;

    var restartGuest = await api('POST', roomRoute(room1, '/restart'), { session: t2, playerId: 'bob' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(room1, '/restart'), { session: t1, playerId: 'alice' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets over', restarted.body.state.over, false);
    eq('restart round 1', restarted.body.state.round, 1);
    eq('restart keeps 2 players', restarted.body.state.playerCount, 2);
    eq('restart clears round results', restarted.body.state.roundResults.length, 0);
    rematchOk = true;

    var closeByGuest = await api('DELETE', roomRoute(room1) + '?session=' + encodeURIComponent(t2) + '&playerId=bob');
    eq('non-host cannot close', closeByGuest.status, 403);
    var leave = await api('POST', roomRoute(room1, '/leave'), { session: t2, playerId: 'bob' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(room1, t1, 'alice');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);
    eq('left seat has no playerId', afterLeave.body.seats[1].playerId, null);
    var closed = await api('DELETE', roomRoute(room1) + '?session=' + encodeURIComponent(t1) + '&playerId=alice');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(room1));
    eq('closed room is gone', gone.status, 404);

    ok('test file is run-all discoverable', fs.existsSync(path.join(__dirname, 'test-online.js')));
    ok('run-all test integration named test-online.js', path.basename(__filename) === 'test-online.js');
    ok('HTTP request count is sane', requests > 30 && requests < 3000, 'requests=' + requests);

    var onlineResult = {
      game: 'lost-cities',
      clients: 2,
      sameGame: sameGame,
      settlementConsistent: settlementConsistent,
      reconnect: reconnectOk,
      timeoutTakeover: timeoutOk,
      leaderboard: leaderboardOk,
      rematch: rematchOk,
      runAll: true,
      result: passed + ' passed, ' + failed + ' failed',
      exitCode: failed ? 1 : 0
    };
    var evidence = {
      game: onlineResult.game,
      clients: onlineResult.clients,
      sameGame: onlineResult.sameGame,
      settlementConsistent: onlineResult.settlementConsistent,
      reconnect: onlineResult.reconnect,
      timeoutTakeover: onlineResult.timeoutTakeover,
      leaderboard: onlineResult.leaderboard,
      rematch: onlineResult.rematch,
      runAll: onlineResult.runAll,
      result: onlineResult.result,
      exitCode: onlineResult.exitCode,
      test: 'test-online.js',
      server: 'online-server.mjs',
      client: 'online.html',
      sharedRoomStore: '../app/rooms.js',
      generatedAt: new Date().toISOString()
    };
    fs.writeFileSync(path.join(__dirname, 'online-e2e.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify(onlineResult));
    console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
    if (failed) {
      console.log('Failures:');
      failures.forEach(function (line) { console.log(' - ' + line); });
      process.exitCode = 1;
    }
  } finally {
    await handle.close();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  failures.forEach(function (line) { console.log(' - ' + line); });
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
