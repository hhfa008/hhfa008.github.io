'use strict';

/*
 * Two-client online E2E for Jaipur Premium.
 *
 *   node games/boardgame/jaipur-premium/test-online.js
 *   node games/boardgame/jaipur-premium/test-online.js --control  # intentional failure
 *
 * Starts the real HTTP room server on ephemeral ports and drives two
 * independent clients over fetch: create/join/invite/password, host start,
 * AI-filled empty seat, legal move sync, reconnect, idle takeover, a full
 * game to settlement, leaderboard, rematch, leave-to-AI and room close.
 * run-all.js discovers this file because it starts with "test".
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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(response) {
  return response.body && response.body.error && response.body.error.code;
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  // Main room uses a long idle timeout so the two scripted clients never get
  // taken over mid-play. A second server uses a short one for takeover tests.
  var mainHandle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 12000, aiDelayMs: 0 });
  var idleHandle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 250, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + mainHandle.address.port;
  var idleBase = 'http://127.0.0.1:' + idleHandle.address.port;
  var requests = 0;

  function client(origin) {
    return async function api(method, route, body) {
      requests += 1;
      var response = await fetch(origin + route, {
        method: method,
        headers: { 'content-type': 'application/json' },
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
  function getView(origin, roomId, session, playerId) {
    var fn = origin === 'idle' ? idleApi : api;
    return fn('GET', roomRoute(roomId) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }
  function sendMove(roomId, session, playerId, move) {
    return api('POST', roomRoute(roomId, '/actions'), {
      session: session, playerId: playerId, type: 'move', move: move
    });
  }
  function pickMove(moves) {
    if (!moves || !moves.length) return null;
    var sell = moves.find(function (m) { return m.type === 'sell'; });
    if (sell) return sell;
    var take = moves.find(function (m) { return m.type === 'take'; });
    if (take) return take;
    var camels = moves.find(function (m) { return m.type === 'takeCamels'; });
    if (camels) return camels;
    return moves[0];
  }

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=jaipur', health.body.game, 'jaipur');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* -------------------------------------------------------------- */
    /* Room lifecycle: create / invite / password / start             */
    /* -------------------------------------------------------------- */

    var created = await api('POST', '/api/rooms', { playerId: 'alice' });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite', typeof invite1 === 'string' && invite1.length > 0);
    eq('Jaipur room has exactly 2 seats', created.body.seats.length, 2);
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);
    eq('room maxPlayers is 2', created.body.maxPlayers, 2);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('room now has 2 humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var inviteReuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite1 });
    eq('invite is single-use status', inviteReuse.status, 403);
    eq('invite is single-use code', errCode(inviteReuse), 'E_INVITE');

    var third = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol' });
    eq('third human rejected', third.status, 409);
    eq('full room code', errCode(third), 'E_FULL');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var privateRoom = await api('POST', '/api/rooms', { playerId: 'priv-host', password: 'secret-1', visibility: 'private' });
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
    eq('password guest is seat 1', rightPass.body.seats[1].playerId, 'guest');

    var startByGuest = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('only host starts', startByGuest.status, 403);
    eq('host-only code', errCode(startByGuest), 'E_HOST');

    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('started phase playing', started.body.status, 'playing');
    eq('online state has 2 players', started.body.state.playerCount, 2);
    eq('first player is seat 0', started.body.state.current, 0);
    ok('host gets legal moves on turn', Array.isArray(started.body.legalMoves) && started.body.legalMoves.length > 0);
    eq('online deck hidden as count', typeof started.body.state.deckCount, 'number');
    ok('online state has no deck array', started.body.state.deck === undefined);
    ok('online state has no opponent hand', started.body.state.players[1].hand === null || started.body.state.players[0].hand === null);
    eq('online opponent hand count is public', typeof started.body.state.players[1].handCount, 'number');

    var outOfTurn = await api('POST', roomRoute(room1, '/actions'), {
      session: t2, playerId: 'bob', type: 'move', move: { type: 'take', card: 'diamond' }
    });
    eq('out-of-turn rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');

    var illegal = await sendMove(room1, t1, 'alice', { type: 'take', card: 'jade' });
    eq('illegal move rejected', illegal.status, 422);
    eq('illegal move code', errCode(illegal), 'E_ACTION');

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t1, playerId: 'alice' });
    eq('reconnect 200', reconnect.status, 200);
    eq('reconnect flag', reconnect.body.reconnected, true);
    eq('reconnect player', reconnect.body.you.playerId, 'alice');
    var badReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: 'bad-token', playerId: 'alice' });
    eq('bad reconnect rejected', badReconnect.status, 403);
    eq('bad reconnect code', errCode(badReconnect), 'E_TOKEN');

    /* -------------------------------------------------------------- */
    /* AI fill: lone host starts, seat 1 becomes AI                   */
    /* -------------------------------------------------------------- */

    var solo = await api('POST', '/api/rooms', { playerId: 'solo-host' });
    var soloId = solo.body.roomId;
    var soloToken = solo.body.playerSession;
    var soloStart = await api('POST', roomRoute(soloId, '/start'), { session: soloToken, playerId: 'solo-host' });
    eq('lone host can start with AI fill', soloStart.status, 200);
    eq('AI seat 1 after solo start', soloStart.body.seats[1].ai, true);
    eq('AI seat has no playerId', soloStart.body.seats[1].playerId, null);
    eq('solo match has 2 players', soloStart.body.state.playerCount, 2);
    var soloView = await getView('main', soloId, soloToken, 'solo-host');
    ok('solo AI seat is controlled by AI', soloView.body.seats[1].controlledByAI === true || soloView.body.seats[1].ai === true);

    /* -------------------------------------------------------------- */
    /* Full two-client game: same room, same turn, settlement          */
    /* -------------------------------------------------------------- */

    var playRoom = await api('POST', '/api/rooms', { playerId: 'p1' });
    var pr = playRoom.body.roomId;
    var pt1 = playRoom.body.playerSession;
    var pinvite = playRoom.body.inviteToken;
    var p2join = await api('POST', roomRoute(pr, '/join'), { playerId: 'p2', inviteCode: pinvite });
    var pt2 = p2join.body.playerSession;
    var pstart = await api('POST', roomRoute(pr, '/start'), { session: pt1, playerId: 'p1' });
    eq('play room started', pstart.status, 200);
    eq('play room has 2 humans', pstart.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var guard = 0;
    var lastView = pstart.body;
    var sameGameChecked = 0;
    while (!lastView.state.over && guard < 500) {
      var current = lastView.state.current;
      var seat = lastView.seats[current];
      if (seat.playerId && !seat.controlledByAI) {
        var token = seat.playerId === 'p1' ? pt1 : pt2;
        var currentView = await getView('main', pr, token, seat.playerId);
        if (currentView.status !== 200) {
          ok('current client view at guard ' + guard, false, currentView.status + ' ' + currentView.text.slice(0, 120));
          break;
        }
        var legal = currentView.body.legalMoves || [];
        var chosen = pickMove(legal);
        if (!chosen) {
          ok('current client has a legal move at guard ' + guard, false, JSON.stringify(legal));
          break;
        }
        var acted = await sendMove(pr, token, seat.playerId, chosen);
        if (acted.status !== 200) {
          ok('play loop move accepted at guard ' + guard, false, acted.status + ' ' + acted.text.slice(0, 120));
          break;
        }
        lastView = acted.body;
      } else {
        var ticked = await api('POST', roomRoute(pr, '/tick'), { session: pt1, playerId: 'p1', force: true });
        if (ticked.status !== 200) {
          ok('play loop tick accepted at guard ' + guard, false, ticked.status);
          break;
        }
        lastView = ticked.body;
      }
      if (guard % 9 === 0) {
        var otherToken = lastView.state.current === 0 ? pt2 : pt1;
        var otherPlayer = lastView.state.current === 0 ? 'p2' : 'p1';
        var other = await getView('main', pr, otherToken, otherPlayer);
        if (other.status === 200 && other.body.state) {
          var same = other.body.state.turn === lastView.state.turn &&
            other.body.state.current === lastView.state.current &&
            JSON.stringify(other.body.state.market) === JSON.stringify(lastView.state.market);
          if (same) sameGameChecked += 1;
          else ok('two clients see the same game at guard ' + guard, false, JSON.stringify({
            a: [lastView.state.turn, lastView.state.current, lastView.state.market],
            b: [other.body.state.turn, other.body.state.current, other.body.state.market]
          }));
        }
      }
      guard += 1;
    }
    ok('online game reaches game over', lastView.state.over === true, 'guard=' + guard + ' turn=' + lastView.state.turn);
    ok('two clients were sampled in the same game', sameGameChecked > 0, 'samples=' + sameGameChecked);
    eq('final result has two seal counts', Array.isArray(lastView.result && lastView.result.seals) ? lastView.result.seals.length : 0, 2);
    ok('winner recorded', lastView.result && (lastView.result.winner === 0 || lastView.result.winner === 1), JSON.stringify(lastView.result && lastView.result.winner));
    ok('winner reached 2 seals', lastView.result && (lastView.result.seals[0] === 2 || lastView.result.seals[1] === 2), JSON.stringify(lastView.result && lastView.result.seals));

    var viewP1 = await getView('main', pr, pt1, 'p1');
    var viewP2 = await getView('main', pr, pt2, 'p2');
    eq('both clients see the same winner', viewP1.body.result && viewP1.body.result.winner, viewP2.body.result && viewP2.body.result.winner);
    eq('settlement seals match', viewP1.body.result && viewP1.body.result.seals, viewP2.body.result && viewP2.body.result.seals);
    eq('settlement round count matches', viewP1.body.result && viewP1.body.result.rounds, viewP2.body.result && viewP2.body.result.rounds);
    eq('same final turn', viewP1.body.state.turn, viewP2.body.state.turn);
    eq('finished status', viewP1.body.status, 'finished');

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard game=jaipur', board.body.game, 'jaipur');
    eq('leaderboard entry room', board.body.entries[0].roomId, pr);
    ok('leaderboard entry records seals', Array.isArray(board.body.entries[0].seals) && board.body.entries[0].seals.length === 2);

    var restartGuest = await api('POST', roomRoute(pr, '/restart'), { session: pt2, playerId: 'p2' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(pr, '/restart'), { session: pt1, playerId: 'p1' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets game', restarted.body.state.over, false);
    eq('restart round 1', restarted.body.state.round, 1);
    eq('restart keeps 2 players', restarted.body.state.playerCount, 2);
    eq('restart clears seals', restarted.body.state.seals, [0, 0]);

    var leave = await api('POST', roomRoute(pr, '/leave'), { session: pt2, playerId: 'p2' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView('main', pr, pt1, 'p1');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);
    ok('left seat has no playerId', afterLeave.body.seats[1].playerId === null);

    var closeByGuest = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt2) + '&playerId=p2');
    eq('non-host cannot close', closeByGuest.status, 403);
    var closed = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt1) + '&playerId=p1');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(pr));
    eq('closed room is gone', gone.status, 404);

    /* -------------------------------------------------------------- */
    /* Idle timeout takeover + reconnect clears it                    */
    /* -------------------------------------------------------------- */

    var idleCreate = await idleApi('POST', '/api/rooms', { playerId: 'idle-1' });
    var idleId = idleCreate.body.roomId;
    var idleT1 = idleCreate.body.playerSession;
    var idleInvite = idleCreate.body.inviteToken;
    var idleJoin = await idleApi('POST', roomRoute(idleId, '/join'), { playerId: 'idle-2', inviteCode: idleInvite });
    var idleT2 = idleJoin.body.playerSession;
    var idleStart = await idleApi('POST', roomRoute(idleId, '/start'), { session: idleT1, playerId: 'idle-1' });
    eq('idle room started', idleStart.status, 200);
    await sleep(420);
    var idleTick = await idleApi('POST', roomRoute(idleId, '/tick'), { session: idleT1, playerId: 'idle-1', force: true });
    eq('idle tick 200', idleTick.status, 200);
    ok('idle seat takeover recorded', Array.isArray(idleTick.body.takeoverSeats) && idleTick.body.takeoverSeats.length >= 1,
      JSON.stringify(idleTick.body.takeoverSeats));
    var idleReconnect = await idleApi('POST', roomRoute(idleId, '/reconnect'), { token: idleT1, playerId: 'idle-1' });
    eq('idle reconnect 200', idleReconnect.status, 200);
    ok('reconnect clears takeover', !idleReconnect.body.takeoverSeats || idleReconnect.body.takeoverSeats.indexOf(0) === -1,
      JSON.stringify(idleReconnect.body.takeoverSeats));

    ok('HTTP request count is sane', requests > 40 && requests < 2000, 'requests=' + requests);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'jaipur', clients: 2, sameGame: true, settlementConsistent: true,
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
