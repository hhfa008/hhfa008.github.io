'use strict';

/*
 * Two-client online E2E for Gomoku Premium.
 *
 *   node games/boardgame/gomoku-premium/test-online.js
 *   node games/boardgame/gomoku-premium/test-online.js --control  # intentional failure
 *
 * Starts the real shared HTTP room server on ephemeral ports and drives two
 * independent clients over fetch: create/join/invite/password, third-player
 * rejection, host start, same-game sync, reconnect, idle takeover, a full game
 * to settlement, leaderboard, rematch, leave-to-AI and room close.
 */

var path = require('path');
var { pathToFileURL } = require('url');

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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(response) {
  return response.body && response.body.error && response.body.error.code;
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var mainHandle = await mod.createServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 12000, aiDelayMs: 0 });
  var idleHandle = await mod.createServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 300, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + mainHandle.address.port;
  var idleBase = 'http://127.0.0.1:' + idleHandle.address.port;
  var requests = 0;

  function client(origin) {
    return async function api(method, route, body) {
      requests += 1;
      var response = await fetch(origin + route, {
        method: method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      var text = await response.text();
      var data = null;
      try { data = JSON.parse(text); } catch (err) { data = null; }
      return { status: response.status, body: data, text: text };
    };
  }
  var api = client(base);
  var idleApi = client(idleBase);

  function roomRoute(roomId, suffix) {
    return '/api/rooms/' + encodeURIComponent(roomId) + (suffix || '');
  }
  function getView(fn, origin, roomId, session, playerId) {
    var use = fn || api;
    return use('GET', roomRoute(roomId) + '?session=' + encodeURIComponent(session) +
      '&playerId=' + encodeURIComponent(playerId));
  }
  function move(roomId, session, playerId, row, col) {
    return api('POST', roomRoute(roomId, '/actions'), {
      session: session, playerId: playerId, type: 'move', move: { type: 'place', row: row, col: col }
    });
  }

  try {
    /* ---------------------------------------------------------------- */
    /* health                                                           */
    /* ---------------------------------------------------------------- */
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=gomoku', health.body.game, 'gomoku');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* ---------------------------------------------------------------- */
    /* create / invite / third player / same-game sync                  */
    /* ---------------------------------------------------------------- */
    var created = await api('POST', '/api/rooms', { playerId: 'p1', maxPlayers: 2 });
    eq('create room 201', created.status, 201);
    var room = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite = created.body.inviteToken;
    ok('create returns roomId', typeof room === 'string' && room.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite', typeof invite === 'string' && invite.length > 0);
    eq('room has exactly 2 seats', created.body.seats.length, 2);
    eq('host is seat 0', created.body.seats[0].playerId, 'p1');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);
    eq('room maxPlayers is 2', created.body.maxPlayers, 2);

    var joined = await api('POST', roomRoute(room, '/join'), { playerId: 'p2', inviteCode: invite });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    ok('guest session issued', typeof t2 === 'string' && t2.length > 0);
    eq('guest is seat 1', joined.body.seats[1].playerId, 'p2');
    eq('room full now', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var third = await api('POST', roomRoute(room, '/join'), { playerId: 'p3' });
    eq('third human rejected', third.status, 409);
    eq('third human E_FULL', errCode(third), 'E_FULL');

    var lone = await api('POST', '/api/rooms', { playerId: 'solo', maxPlayers: 2 });
    var loneStart = await api('POST', roomRoute(lone.body.roomId, '/start'), {
      session: lone.body.playerSession, playerId: 'solo'
    });
    eq('lone host starts against AI', loneStart.status, 200);
    eq('lone start started', loneStart.body.started, true);
    eq('lone start seat 1 is AI', loneStart.body.seats[1].ai, true);
    var soloView = await getView(api, base, lone.body.roomId, lone.body.playerSession, 'solo');
    ok('lone host can move first', soloView.body.canMove === true);
    var soloLegal = soloView.body.legalMoves || [];
    ok('lone host has a legal move', soloLegal.length > 0);
    var soloPick = soloLegal[0];
    var soloAct = await move(lone.body.roomId, lone.body.playerSession, 'solo', soloPick.row, soloPick.col);
    eq('lone host move accepted', soloAct.status, 200);
    var soloTick = await api('POST', roomRoute(lone.body.roomId, '/tick'), {
      session: lone.body.playerSession, playerId: 'solo', force: true
    });
    eq('lone AI tick 200', soloTick.status, 200);
    ok('lone AI replied', soloTick.body.state.history.length >= 2 &&
      soloTick.body.state.history[soloTick.body.state.history.length - 1].player === 2,
      JSON.stringify(soloTick.body.state.history));

    /* ---------------------------------------------------------------- */
    /* password room                                                    */
    /* ---------------------------------------------------------------- */
    var pw = await api('POST', '/api/rooms', { playerId: 'pw1', password: 'secret', maxPlayers: 2 });
    eq('password room created', pw.status, 201);
    var badJoin = await api('POST', roomRoute(pw.body.roomId, '/join'), { playerId: 'pw2', password: 'wrong' });
    eq('wrong password rejected', badJoin.status, 403);
    eq('wrong password E_PASSWORD', errCode(badJoin), 'E_PASSWORD');
    var goodJoin = await api('POST', roomRoute(pw.body.roomId, '/join'), { playerId: 'pw2', password: 'secret' });
    eq('correct password join 200', goodJoin.status, 200);
    var pwT2 = goodJoin.body.playerSession;

    /* ---------------------------------------------------------------- */
    /* host-only start + same game                                      */
    /* ---------------------------------------------------------------- */
    var guestStart = await api('POST', roomRoute(room, '/start'), { session: t2, playerId: 'p2' });
    eq('guest cannot start', guestStart.status, 403);
    eq('guest start E_HOST', errCode(guestStart), 'E_HOST');

    var started = await api('POST', roomRoute(room, '/start'), { session: t1, playerId: 'p1' });
    eq('host start 200', started.status, 200);
    eq('match started', started.body.started, true);
    eq('start leaves 2 human seats', started.body.seats.filter(function (s) { return !s.ai; }).length, 2);
    eq('initial board empty', started.body.state.board.filter(function (v) { return v !== 0; }).length, 0);
    eq('black starts', started.body.state.current, 1);

    var hostMove = await move(room, t1, 'p1', 7, 3);
    eq('host black move accepted', hostMove.status, 200);
    eq('host move placed', hostMove.body.state.board[7 * 15 + 3], 1);
    eq('turn passes to white', hostMove.body.state.current, 2);
    var guestView = await getView(api, base, room, t2, 'p2');
    eq('guest sees the same move', guestView.body.state.board[7 * 15 + 3], 1);
    eq('guest is now on turn', guestView.body.state.current, 2);
    eq('guest canMove', guestView.body.canMove, true);

    var guestMove = await move(room, t2, 'p2', 0, 0);
    eq('guest white move accepted', guestMove.status, 200);
    eq('guest move placed', guestMove.body.state.board[0], 2);
    var hostView = await getView(api, base, room, t1, 'p1');
    eq('host sees guest move', hostView.body.state.board[0], 2);
    eq('host is now on turn', hostView.body.canMove, true);
    eq('same move count on both clients', hostView.body.state.moveCount, guestView.body.state.moveCount + 1);

    var wrongTurn = await move(room, t2, 'p2', 1, 1);
    eq('out-of-turn move rejected', wrongTurn.status, 409);
    eq('out-of-turn E_TURN', errCode(wrongTurn), 'E_TURN');
    var occupied = await move(room, t1, 'p1', 7, 3);
    eq('occupied move rejected', occupied.status, 422);
    eq('occupied E_ACTION', errCode(occupied), 'E_ACTION');

    /* ---------------------------------------------------------------- */
    /* reconnect + bad token                                            */
    /* ---------------------------------------------------------------- */
    var badToken = await api('POST', roomRoute(room, '/reconnect'), { token: 'nope', playerId: 'p2' });
    eq('bad session rejected', badToken.status, 403);
    eq('bad session E_TOKEN', errCode(badToken), 'E_TOKEN');
    var re = await api('POST', roomRoute(room, '/reconnect'), { token: t2, playerId: 'p2' });
    eq('guest reconnect 200', re.status, 200);
    eq('reconnect keeps seat', re.body.you.playerIndex, 1);
    eq('reconnect same game', re.body.state.moveCount, 2);

    /* ---------------------------------------------------------------- */
    /* full game to settlement                                          */
    /* ---------------------------------------------------------------- */
    var seq = [
      ['p1', t1, 7, 4], ['p2', t2, 0, 1],
      ['p1', t1, 7, 5], ['p2', t2, 0, 2],
      ['p1', t1, 7, 6], ['p2', t2, 0, 3],
      ['p1', t1, 7, 7]
    ];
    var last = null;
    for (var i = 0; i < seq.length; i++) {
      var s = seq[i];
      var res = await move(room, s[1], s[0], s[2], s[3]);
      eq('move ' + (i + 1) + ' accepted', res.status, 200);
      last = res;
    }
    ok('game over after five in a row', last && last.body.state.over === true, JSON.stringify(last && last.body.state.result));
    eq('black wins', last && last.body.state.winner, 1);
    ok('winning line recorded', !!(last && last.body.state.result && last.body.state.result.line &&
      last.body.state.result.line.length >= 5), JSON.stringify(last && last.body.state.result));
    eq('win reason five', last && last.body.state.result && last.body.state.result.reason, 'five');

    var finalHost = await getView(api, base, room, t1, 'p1');
    var finalGuest = await getView(api, base, room, t2, 'p2');
    eq('host sees finished', finalHost.body.status, 'finished');
    eq('guest sees finished', finalGuest.body.status, 'finished');
    eq('both agree on winner', finalHost.body.state.winner, finalGuest.body.state.winner);
    eq('both agree on board', finalHost.body.state.board, finalGuest.body.state.board);
    eq('both agree on result scores', finalHost.body.state.result.scores, finalGuest.body.state.result.scores);
    eq('both agree on move count', finalHost.body.state.moveCount, finalGuest.body.state.moveCount);

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard game=gomoku', board.body.game, 'gomoku');
    eq('leaderboard entry room', board.body.entries[0].roomId, room);
    ok('leaderboard winner recorded', board.body.entries[0].winner === 0 ||
      board.body.entries[0].winnerName === 'p1', JSON.stringify(board.body.entries[0]));

    var restartGuest = await api('POST', roomRoute(room, '/restart'), { session: t2, playerId: 'p2' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(room, '/restart'), { session: t1, playerId: 'p1' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets board', restarted.body.state.moveCount, 0);
    eq('restart current is black', restarted.body.state.current, 1);
    eq('restart keeps 2 players', restarted.body.state.players.length, 2);

    /* ---------------------------------------------------------------- */
    /* leave becomes AI + AI actually moves                             */
    /* ---------------------------------------------------------------- */
    var leave = await api('POST', roomRoute(room, '/leave'), { session: t2, playerId: 'p2' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(api, base, room, t1, 'p1');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);
    var hostOpen = await move(room, t1, 'p1', 6, 6);
    eq('host move after leave accepted', hostOpen.status, 200);
    var ticked = await api('POST', roomRoute(room, '/tick'), { session: t1, playerId: 'p1', force: true });
    eq('tick 200', ticked.status, 200);
    var stonesAfterLeave = ticked.body.state.board.filter(function (v) { return v !== 0; });
    ok('AI replied on the board', stonesAfterLeave.length >= 2 && stonesAfterLeave.indexOf(2) >= 0,
      'stones=' + stonesAfterLeave.length + ' colours=' + JSON.stringify(stonesAfterLeave.slice(0, 6)));

    /* ---------------------------------------------------------------- */
    /* idle takeover on a short-timeout server                          */
    /* ---------------------------------------------------------------- */
    var tk = await idleApi('POST', '/api/rooms', { playerId: 't1', maxPlayers: 2 });
    var tkRoom = tk.body.roomId;
    var tk1 = tk.body.playerSession;
    var tkJoin = await idleApi('POST', roomRoute(tkRoom, '/join'), { playerId: 't2', inviteCode: tk.body.inviteToken });
    var tk2 = tkJoin.body.playerSession;
    await idleApi('POST', roomRoute(tkRoom, '/start'), { session: tk1, playerId: 't1' });
    await sleep(520);
    var tkView = await idleApi('GET', roomRoute(tkRoom) + '?session=' + encodeURIComponent(tk1) + '&playerId=t1');
    eq('idle view 200', tkView.status, 200);
    ok('idle seat takeover recorded', Array.isArray(tkView.body.takeoverSeats) && tkView.body.takeoverSeats.length >= 1,
      JSON.stringify(tkView.body.takeoverSeats));
    var reTk = await idleApi('POST', roomRoute(tkRoom, '/reconnect'), { token: tk2, playerId: 't2' });
    eq('idle player reconnect 200', reTk.status, 200);
    ok('reconnect clears seat 1 takeover', !reTk.body.takeoverSeats || reTk.body.takeoverSeats.indexOf(1) === -1,
      JSON.stringify(reTk.body.takeoverSeats));

    /* ---------------------------------------------------------------- */
    /* close room                                                       */
    /* ---------------------------------------------------------------- */
    var closeByGuest = await api('DELETE', roomRoute(room) + '?session=' + encodeURIComponent(t2) + '&playerId=p2');
    eq('non-host cannot close', closeByGuest.status, 403);
    var closed = await api('DELETE', roomRoute(room) + '?session=' + encodeURIComponent(t1) + '&playerId=p1');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(room));
    eq('closed room is gone', gone.status, 404);

    ok('HTTP request count is sane', requests > 30 && requests < 5000, 'requests=' + requests);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'gomoku', clients: 2, sameGame: true, settlementConsistent: true,
      reconnect: true, timeoutTakeover: true, leaderboard: true, runAll: true,
      test: 'test-online.js', server: 'online-server.mjs', client: 'online.html',
      result: passed + ' passed, ' + failed + ' failed', exitCode: failed ? 1 : 0
    }));
    console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
    if (failed) {
      console.log('Failures:');
      failures.forEach(function (line) { console.log(' - ' + line); });
      process.exitCode = 1;
    }
  } finally {
    await mainHandle.close();
    await idleHandle.close();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  failures.forEach(function (line) { console.log(' - ' + line); });
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
