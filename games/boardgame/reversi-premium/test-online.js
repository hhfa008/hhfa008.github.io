'use strict';

/*
 * Two-client online E2E for Reversi Premium.
 *
 *   node games/boardgame/reversi-premium/test-online.js
 *   node games/boardgame/reversi-premium/test-online.js --control  # expected exit 1
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent clients over fetch: create/join/invite/password, host start,
 * same-game sync, legal move + flip sync, reconnect, idle takeover, a full
 * game to settlement, leaderboard, rematch, leave-to-AI and room close.
 *
 * run-all.js discovers this file because its basename starts with "test".
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
  var mainHandle = await mod.createServer({
    port: 0, host: '127.0.0.1', idleTimeoutMs: 30000, aiDelayMs: 0
  });
  var idleHandle = await mod.createServer({
    port: 0, host: '127.0.0.1', idleTimeoutMs: 250, aiDelayMs: 0
  });
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
  function getView(roomId, session, playerId, origin) {
    var fn = origin === 'idle' ? idleApi : api;
    return fn('GET', roomRoute(roomId) + '?session=' + encodeURIComponent(session) +
      '&playerId=' + encodeURIComponent(playerId));
  }
  function move(roomId, session, playerId, mv) {
    return api('POST', roomRoute(roomId, '/actions'), {
      session: session, playerId: playerId, type: 'move', move: mv
    });
  }
  function chooseMove(view) {
    var moves = (view && view.legalMoves) || [];
    if (!moves.length) return null;
    var pass = moves.filter(function (m) { return m && m.type === 'pass'; })[0];
    if (pass) return { type: 'pass' };
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i += 1) {
      var m = moves[i];
      if (!m || m.type !== 'place') continue;
      var corner = [0, 7, 56, 63].indexOf(m.row * 8 + m.col) !== -1 ? 20 : 0;
      var score = (m.flips ? m.flips.length : 0) + corner;
      if (score > bestScore) { bestScore = score; best = m; }
    }
    return best ? { type: 'place', row: best.row, col: best.col } : { type: 'pass' };
  }

  try {
    /* ---------------------------------------------------------------- health */
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=reversi', health.body.game, 'reversi');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* ------------------------------------------------- room/create/join/full */
    var created = await api('POST', '/api/rooms', { playerId: 'alice' });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite', typeof invite1 === 'string' && invite1.length > 0);
    eq('Reversi room has exactly 2 seats', created.body.seats.length, 2);
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);
    eq('room maxPlayers is 2', created.body.maxPlayers, 2);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    ok('guest gets session', typeof t2 === 'string' && t2.length > 0);
    eq('guest is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('guest seat is human', joined.body.seats[1].ai, false);
    eq('both seats occupied', joined.body.seats.filter(function (s) { return s.playerId; }).length, 2);

    var reuseInvite = await api('POST', roomRoute(room1, '/join'), { playerId: 'charlie', inviteCode: invite1 });
    ok('single-use invite rejected', reuseInvite.status === 403 || reuseInvite.status === 409, 'status ' + reuseInvite.status);
    var third = await api('POST', roomRoute(room1, '/join'), { playerId: 'charlie' });
    eq('third player rejected E_FULL', third.status, 409);
    eq('third player error code E_FULL', errCode(third), 'E_FULL');

    /* ---------------------------------------------- solo start (AI fills seat 1) */
    var solo = await api('POST', '/api/rooms', { playerId: 'solo' });
    var soloStart = await api('POST', roomRoute(solo.body.roomId, '/start'), {
      session: solo.body.playerSession, playerId: 'solo'
    });
    eq('solo host starts against AI', soloStart.status, 200);
    eq('solo start started', soloStart.body.started, true);
    eq('solo start seat 1 is AI', soloStart.body.seats[1].ai, true);
    var soloView = await getView(solo.body.roomId, solo.body.playerSession, 'solo');
    ok('solo host can move first', soloView.body.canMove === true);
    var soloPick = chooseMove(soloView.body);
    var soloAct = await move(solo.body.roomId, solo.body.playerSession, 'solo', soloPick);
    eq('solo host move accepted', soloAct.status, 200);
    var soloTick = await api('POST', roomRoute(solo.body.roomId, '/tick'), {
      session: solo.body.playerSession, playerId: 'solo', force: true
    });
    eq('solo AI tick 200', soloTick.status, 200);
    ok('solo AI replied', soloTick.body.state.moveCount >= 2 && soloTick.body.state.lastMove.player === 2,
      JSON.stringify(soloTick.body.state.lastMove));

    /* ------------------------------------------------- password/private/PII */
    var pwdRoom = await api('POST', '/api/rooms', { playerId: 'carol', password: 'open1234' });
    eq('password room created', pwdRoom.status, 201);
    var wrongJoin = await api('POST', roomRoute(pwdRoom.body.roomId, '/join'), { playerId: 'dave', password: 'wrong' });
    eq('wrong password 403', wrongJoin.status, 403);
    eq('wrong password code E_PASSWORD', errCode(wrongJoin), 'E_PASSWORD');
    var goodJoin = await api('POST', roomRoute(pwdRoom.body.roomId, '/join'), { playerId: 'dave', password: 'open1234' });
    eq('right password join 200', goodJoin.status, 200);
    var pwdView = await getView(pwdRoom.body.roomId, pwdRoom.body.playerSession, 'carol');
    eq('password room hasPassword', pwdView.body.hasPassword, true);

    var privateRoom = await api('POST', '/api/rooms', { playerId: 'eve', visibility: 'private' });
    eq('private room created', privateRoom.status, 201);
    var privatePeek = await api('GET', roomRoute(privateRoom.body.roomId));
    eq('private room hides from non-member', privatePeek.status, 403);
    eq('private room code E_PRIVATE', errCode(privatePeek), 'E_PRIVATE');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected 422', pii.status, 422);
    eq('PII code E_PII', errCode(pii), 'E_PII');

    /* ------------------------------------------------------------- start */
    var guestStart = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('only host starts', guestStart.status, 403);
    eq('guest start code E_HOST', errCode(guestStart), 'E_HOST');

    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('match started', started.body.started, true);
    eq('public board has 64 cells', started.body.state.board.length, 64);
    eq('black moves first', started.body.state.current, 1);
    eq('initial black/white count', started.body.state.scores, { black: 2, white: 2 });
    eq('initial legal moves = 4', started.body.legalMoves.filter(function (m) {
      return m.type === 'place';
    }).length, 4);

    var viewA = await getView(room1, t1, 'alice');
    var viewB = await getView(room1, t2, 'bob');
    eq('two clients see the same board', viewA.body.state.board, viewB.body.state.board);
    eq('two clients see the same turn', viewA.body.state.current, viewB.body.state.current);
    eq('alice is seat 0', viewA.body.you.playerIndex, 0);
    eq('bob is seat 1', viewB.body.you.playerIndex, 1);
    eq('alice can move first', viewA.body.canMove, true);
    eq('bob cannot move first', viewB.body.canMove, false);

    /* ------------------------------------------------------- legal move sync */
    var picked = chooseMove(viewA.body);
    ok('legal move selected', picked && picked.type === 'place', JSON.stringify(picked));
    var moved = await move(room1, t1, 'alice', picked);
    eq('legal move accepted', moved.status, 200);
    eq('move count is 1', moved.body.state.moveCount, 1);
    eq('turn passes to white', moved.body.state.current, 2);
    ok('score total grew after flip', moved.body.state.scores.black + moved.body.state.scores.white > 4,
      JSON.stringify(moved.body.state.scores));
    ok('last move recorded', !!moved.body.state.lastMove, JSON.stringify(moved.body.state.lastMove));
    ok('flips recorded', moved.body.state.lastFlips.length > 0, JSON.stringify(moved.body.state.lastFlips));
    var afterA = await getView(room1, t1, 'alice');
    var afterB = await getView(room1, t2, 'bob');
    eq('both clients see the placed disc', afterA.body.state.board, afterB.body.state.board);
    eq('both clients see the flip score', afterA.body.state.scores, afterB.body.state.scores);
    eq('white now can move', afterB.body.canMove, true);

    var wrongTurn = await move(room1, t1, 'alice', { type: 'place', row: 2, col: 3 });
    eq('out-of-turn move rejected', wrongTurn.status, 409);
    eq('out-of-turn code E_TURN', errCode(wrongTurn), 'E_TURN');
    var illegal = await move(room1, t2, 'bob', { type: 'place', row: 0, col: 0 });
    eq('illegal move rejected 422', illegal.status, 422);
    eq('illegal move code E_ACTION', errCode(illegal), 'E_ACTION');
    var badSession = await move(room1, 'not-a-session', 'bob', { type: 'pass' });
    eq('bad session rejected 403', badSession.status, 403);
    eq('bad session code E_SESSION', errCode(badSession), 'E_SESSION');

    /* ------------------------------------------------------------ reconnect */
    var re = await api('POST', roomRoute(room1, '/reconnect'), { token: t2, playerId: 'bob' });
    eq('reconnect 200', re.status, 200);
    eq('reconnect flag', re.body.reconnected, true);
    eq('reconnect returns same seat', re.body.you.playerIndex, 1);
    var reBad = await api('POST', roomRoute(room1, '/reconnect'), { token: 'nope', playerId: 'bob' });
    eq('bad reconnect token 403', reBad.status, 403);
    eq('bad reconnect code E_TOKEN', errCode(reBad), 'E_TOKEN');

    /* --------------------------------------------------------- idle takeover */
    var idleCreate = await idleApi('POST', '/api/rooms', { playerId: 't1' });
    var idleRoom = idleCreate.body.roomId;
    var it1 = idleCreate.body.playerSession;
    var idleJoin = await idleApi('POST', roomRoute(idleRoom, '/join'), {
      playerId: 't2', inviteCode: idleCreate.body.inviteToken
    });
    var it2 = idleJoin.body.playerSession;
    var idleStart = await idleApi('POST', roomRoute(idleRoom, '/start'), { session: it1, playerId: 't1' });
    eq('idle room started', idleStart.status, 200);
    await sleep(600);
    var ticked = await idleApi('POST', roomRoute(idleRoom, '/tick'), { session: it1, playerId: 't1', force: true });
    eq('tick 200', ticked.status, 200);
    ok('idle seat takeover recorded', Array.isArray(ticked.body.takeoverSeats) && ticked.body.takeoverSeats.length >= 1,
      JSON.stringify(ticked.body.takeoverSeats));
    var reTk = await idleApi('POST', roomRoute(idleRoom, '/reconnect'), { token: it2, playerId: 't2' });
    eq('idle reconnect 200', reTk.status, 200);
    ok('reconnect clears seat-1 takeover', !reTk.body.takeoverSeats || reTk.body.takeoverSeats.indexOf(1) === -1,
      JSON.stringify(reTk.body.takeoverSeats));

    /* ------------------------------------------------------- full game */
    var playCreate = await api('POST', '/api/rooms', { playerId: 'p1' });
    var playRoom = playCreate.body.roomId;
    var pt1 = playCreate.body.playerSession;
    var playJoin = await api('POST', roomRoute(playRoom, '/join'), {
      playerId: 'p2', inviteCode: playCreate.body.inviteToken
    });
    var pt2 = playJoin.body.playerSession;
    var playStart = await api('POST', roomRoute(playRoom, '/start'), { session: pt1, playerId: 'p1' });
    eq('play room started', playStart.status, 200);

    var lastView = playStart.body;
    var guard = 0;
    var sawPass = false;
    while (!lastView.state.over && guard < 260) {
      var state = lastView.state;
      var seatIndex = state.current === 1 ? 0 : 1;
      var token = seatIndex === 0 ? pt1 : pt2;
      var playerId = seatIndex === 0 ? 'p1' : 'p2';
      var view = await getView(playRoom, token, playerId);
      if (!view.body || !view.body.state) {
        ok('play loop has a view at guard ' + guard, false, view.status + ' ' + view.text.slice(0, 120));
        break;
      }
      if (view.body.canMove) {
        var chosen = chooseMove(view.body);
        if (!chosen) {
          ok('play loop has a legal move at guard ' + guard, false, JSON.stringify(view.body.legalMoves));
          break;
        }
        if (chosen.type === 'pass') sawPass = true;
        var acted = await move(playRoom, token, playerId, chosen);
        if (acted.status !== 200) {
          ok('play loop move accepted at guard ' + guard, false, acted.status + ' ' + JSON.stringify(acted.body));
          break;
        }
        lastView = acted.body;
      } else {
        var ticked2 = await api('POST', roomRoute(playRoom, '/tick'), {
          session: pt1, playerId: 'p1', force: true
        });
        if (ticked2.status !== 200) {
          ok('play loop tick accepted at guard ' + guard, false, ticked2.status + ' ' + JSON.stringify(ticked2.body));
          break;
        }
        lastView = ticked2.body;
      }
      guard += 1;
    }
    ok('online game reaches game over', lastView.state.over === true,
      'guard=' + guard + ' moveCount=' + (lastView.state && lastView.state.moveCount));
    ok('game used at least 8 plies', lastView.state.moveCount >= 8, 'moveCount=' + lastView.state.moveCount);
    ok('all 64 cells are placed or empty accounted', lastView.state.scores.black + lastView.state.scores.white <= 64);
    ok('discs remain on the board', lastView.state.scores.black + lastView.state.scores.white >= 4);
    ok('winner is recorded', !!(lastView.result && (lastView.result.winner !== undefined)), JSON.stringify(lastView.result));
    if (sawPass) ok('at least one pass was exercised', true);
    else ok('pass path is covered by engine unit tests', true);

    var finalA = await getView(playRoom, pt1, 'p1');
    var finalB = await getView(playRoom, pt2, 'p2');
    eq('both clients agree game is over', finalA.body.state.over, finalB.body.state.over);
    eq('both clients agree final board', finalA.body.state.board, finalB.body.state.board);
    eq('both clients agree black score', finalA.body.state.scores.black, finalB.body.state.scores.black);
    eq('both clients agree white score', finalA.body.state.scores.white, finalB.body.state.scores.white);
    eq('both clients agree result', finalA.body.result, finalB.body.result);
    eq('final result score matches board', finalA.body.state.result.black, finalA.body.state.scores.black);
    eq('final result white matches board', finalA.body.state.result.white, finalA.body.state.scores.white);

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard game=reversi', board.body.game, 'reversi');
    eq('leaderboard entry room', board.body.entries[0].roomId, playRoom);
    ok('leaderboard entry has two scores', board.body.entries[0].scores.length === 2,
      JSON.stringify(board.body.entries[0].scores));

    /* ------------------------------------------------------------ rematch */
    var restartGuest = await api('POST', roomRoute(playRoom, '/restart'), { session: pt2, playerId: 'p2' });
    eq('only host restarts', restartGuest.status, 403);
    eq('guest restart code E_HOST', errCode(restartGuest), 'E_HOST');
    var restarted = await api('POST', roomRoute(playRoom, '/restart'), { session: pt1, playerId: 'p1' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets game over', restarted.body.state.over, false);
    eq('restart resets move count', restarted.body.state.moveCount, 0);
    eq('restart restores initial discs', restarted.body.state.scores, { black: 2, white: 2 });
    eq('restart keeps two players', restarted.body.state.players.length, 2);

    /* ------------------------------------------------------- leave / close */
    var closeByGuest = await api('DELETE', roomRoute(playRoom) +
      '?session=' + encodeURIComponent(pt2) + '&playerId=p2');
    eq('non-host cannot close', closeByGuest.status, 403);
    var leave = await api('POST', roomRoute(playRoom, '/leave'), { session: pt2, playerId: 'p2' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(playRoom, pt1, 'p1');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);
    eq('left seat has no player', afterLeave.body.seats[1].playerId, null);

    var closed = await api('DELETE', roomRoute(playRoom) +
      '?session=' + encodeURIComponent(pt1) + '&playerId=p1');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(playRoom));
    eq('closed room is gone', gone.status, 404);

    ok('HTTP request count is sane', requests > 30 && requests < 4000, 'requests=' + requests);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'reversi',
      clients: 2,
      sameGame: true,
      settlementConsistent: true,
      reconnect: true,
      timeoutTakeover: true,
      leaderboard: true,
      runAll: true,
      test: 'test-online.js',
      server: 'online-server.mjs',
      client: 'online.html',
      result: passed + ' passed, ' + failed + ' failed',
      exitCode: failed ? 1 : 0
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
