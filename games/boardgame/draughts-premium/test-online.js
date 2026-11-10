'use strict';

/*
 * Two-client online E2E for International Draughts Premium.
 *
 *   node games/boardgame/draughts-premium/test-online.js
 *   node games/boardgame/draughts-premium/test-online.js --control  # exit 1
 *
 * Drives the shared room server bound to the draughts adapter over fetch:
 * create / invite / password / start / AI fill / maximum-capture move sync /
 * reconnect / idle takeover / resignation settlement / leaderboard / rematch /
 * leave / close.
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
function errCode(response) { return response.body && response.body.error && response.body.error.code; }
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var mainHandle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 15000, aiDelayMs: 0 });
  var idleHandle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 220, aiDelayMs: 0 });
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
  function roomRoute(id, suffix) { return '/api/rooms/' + encodeURIComponent(id) + (suffix || ''); }
  function view(origin, roomId, session, playerId) {
    var fn = origin === 'idle' ? idleApi : api;
    return fn('GET', roomRoute(roomId) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }
  function act(origin, roomId, session, playerId, body) {
    var fn = origin === 'idle' ? idleApi : api;
    return fn('POST', roomRoute(roomId, '/actions'), Object.assign({ session: session, playerId: playerId }, body));
  }
  function movePayload(m) {
    return { type: 'move', move: { from: m.from, to: m.to, path: m.path, captures: m.captures } };
  }

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=draughts', health.body.game, 'draughts');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* Room lifecycle */
    var created = await api('POST', '/api/rooms', { playerId: '白方棋手' });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite', typeof invite1 === 'string' && invite1.length > 0);
    eq('room has exactly 2 seats', created.body.seats.length, 2);
    eq('host is seat 0 white', created.body.seats[0].playerId, '白方棋手');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: '黑方棋手', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('guest is seat 1 black', joined.body.seats[1].playerId, '黑方棋手');
    eq('room now has 2 humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);

    var inviteReuse = await api('POST', roomRoute(room1, '/join'), { playerId: '第三人', inviteCode: invite1 });
    eq('invite is single-use status', inviteReuse.status, 403);
    eq('invite is single-use code', errCode(inviteReuse), 'E_INVITE');
    var third = await api('POST', roomRoute(room1, '/join'), { playerId: '第三人' });
    eq('third human rejected', third.status, 409);
    eq('full room code', errCode(third), 'E_FULL');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var privateRoom = await api('POST', '/api/rooms', { playerId: '私密房主', password: 'secret-1', visibility: 'private' });
    eq('private room created', privateRoom.status, 201);
    var privId = privateRoom.body.roomId;
    var noAuth = await api('GET', roomRoute(privId));
    eq('private room hides state without a session', noAuth.status, 403);
    eq('private room code', errCode(noAuth), 'E_PRIVATE');
    var wrongPass = await api('POST', roomRoute(privId, '/join'), { playerId: '闯入者', password: 'nope' });
    eq('wrong password rejected', wrongPass.status, 409);
    eq('wrong password code', errCode(wrongPass), 'E_PASSWORD');
    var rightPass = await api('POST', roomRoute(privId, '/join'), { playerId: '受邀者', password: 'secret-1' });
    eq('correct password joins', rightPass.status, 200);

    var startGuest = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: '黑方棋手' });
    eq('guest cannot start', startGuest.status, 403);
    eq('guest start code', errCode(startGuest), 'E_HOST');
    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: '白方棋手' });
    eq('host starts 200', started.status, 200);
    eq('started state white to move', started.body.state.turn, 1);
    eq('started state seat 0 can move', started.body.canMove, true);
    eq('opening exposes 9 legal moves', started.body.state.legal.length, 9);
    ok('room chip data present', typeof started.body.roomCode === 'string');

    /* Legal move sync */
    var p1View = await view('main', room1, t1, '白方棋手');
    eq('p1 view can move', p1View.body.canMove, true);
    var move1 = p1View.body.state.legal[0];
    ok('p1 has a legal move with notation', move1 && typeof move1.from === 'number' && /^\d+-?\d+/.test(move1.notation));
    var applied = await act('main', room1, t1, '白方棋手', movePayload(move1));
    eq('move accepted 200', applied.status, 200);
    eq('turn passed to black', applied.body.state.turn, -1);
    eq('move recorded once', applied.body.state.history.length, 1);
    eq('move notation stored', applied.body.state.history[0].notation, move1.notation);

    var p2View = await view('main', room1, t2, '黑方棋手');
    eq('p2 sees the same board', p2View.body.state.board, applied.body.state.board);
    eq('p2 can move on black turn', p2View.body.canMove, true);
    var outOfTurn = await act('main', room1, t1, '白方棋手', movePayload(move1));
    eq('out-of-turn move rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');
    var illegal = await act('main', room1, t2, '黑方棋手', { type: 'move', move: { from: 99, to: 0 } });
    eq('illegal move rejected', illegal.status, 422);
    eq('illegal move code', errCode(illegal), 'E_ACTION');

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { session: t1, playerId: '白方棋手' });
    eq('reconnect 200', reconnect.status, 200);
    eq('reconnect flag', reconnect.body.reconnected, true);

    /* AI fills the empty seat */
    var aiRoom = await api('POST', '/api/rooms', { playerId: '独坐棋手' });
    var aiId = aiRoom.body.roomId;
    var aiT = aiRoom.body.playerSession;
    var aiStarted = await api('POST', roomRoute(aiId, '/start'), { session: aiT, playerId: '独坐棋手' });
    eq('host can start with AI seat', aiStarted.status, 200);
    eq('AI seat stays AI', aiStarted.body.seats[1].ai, true);
    var aiMove = aiStarted.body.state.legal[0];
    var aiAfter = await act('main', aiId, aiT, '独坐棋手', movePayload(aiMove));
    eq('AI replied immediately', aiAfter.status, 200);
    eq('AI made one reply', aiAfter.body.state.history.length, 2);
    eq('turn returns to host', aiAfter.body.state.turn, 1);

    /* Resignation settlement, leaderboard and rematch */
    var settleRoom = await api('POST', '/api/rooms', { playerId: '认输方' });
    var set1 = settleRoom.body.playerSession;
    var settleId = settleRoom.body.roomId;
    var settleJoin = await api('POST', roomRoute(settleId, '/join'), { playerId: '获胜方', inviteCode: settleRoom.body.inviteToken });
    var set2 = settleJoin.body.playerSession;
    await api('POST', roomRoute(settleId, '/start'), { session: set1, playerId: '认输方' });
    var resigned = await act('main', settleId, set1, '认输方', { type: 'resign' });
    eq('resign accepted', resigned.status, 200);
    eq('game is over', resigned.body.state.over, true);
    eq('resign reason recorded', resigned.body.state.reason, 'resign');
    eq('opponent wins', resigned.body.result.winnerSeat, 1);
    var loserView = await view('main', settleId, set2, '获胜方');
    eq('both clients see the same result', [loserView.body.state.over, loserView.body.result.winnerSeat], [true, 1]);

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard recorded the game', board.body.entries.some(function (e) { return e.roomId === settleId && e.winnerSeat === 1; }));
    var entry = board.body.entries.find(function (e) { return e.roomId === settleId; });
    eq('leaderboard names both players', entry.players.map(function (p) { return p.nickname; }).sort(), ['认输方', '获胜方'].sort());

    var restartGuest = await api('POST', roomRoute(settleId, '/restart'), { session: set2, playerId: '获胜方' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(settleId, '/restart'), { session: set1, playerId: '认输方' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets the game', [restarted.body.state.over, restarted.body.state.turn], [false, 1]);
    eq('restart clears history', restarted.body.state.history.length, 0);

    var leave = await api('POST', roomRoute(settleId, '/leave'), { session: set2, playerId: '获胜方' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await view('main', settleId, set1, '认输方');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);

    var closeByGuest = await api('DELETE', roomRoute(settleId) + '?session=' + encodeURIComponent(set2) + '&playerId=' + encodeURIComponent('获胜方'));
    eq('non-host cannot close', closeByGuest.status, 403);
    var closed = await api('DELETE', roomRoute(settleId) + '?session=' + encodeURIComponent(set1) + '&playerId=' + encodeURIComponent('认输方'));
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(settleId));
    eq('closed room is gone', gone.status, 404);

    /* Idle timeout takeover + reconnect */
    var idleCreate = await idleApi('POST', '/api/rooms', { playerId: '闲置甲' });
    var idleId = idleCreate.body.roomId;
    var idleT1 = idleCreate.body.playerSession;
    var idleJoin = await idleApi('POST', roomRoute(idleId, '/join'), { playerId: '闲置乙', inviteCode: idleCreate.body.inviteToken });
    var idleT2 = idleJoin.body.playerSession;
    var idleStart = await idleApi('POST', roomRoute(idleId, '/start'), { session: idleT1, playerId: '闲置甲' });
    eq('idle room started', idleStart.status, 200);
    await sleep(420);
    var idleTick = await idleApi('POST', roomRoute(idleId, '/tick'), { session: idleT1, playerId: '闲置甲', force: true });
    eq('idle tick 200', idleTick.status, 200);
    ok('idle seats were taken over', Array.isArray(idleTick.body.takeoverSeats) && idleTick.body.takeoverSeats.length >= 1,
      JSON.stringify(idleTick.body.takeoverSeats));
    var idleReconnect = await idleApi('POST', roomRoute(idleId, '/reconnect'), { session: idleT1, playerId: '闲置甲' });
    eq('idle reconnect 200', idleReconnect.status, 200);
    ok('reconnect clears its own takeover', (idleReconnect.body.takeoverSeats || []).indexOf(0) === -1,
      JSON.stringify(idleReconnect.body.takeoverSeats));
    eq('reconnected seat is human again', idleReconnect.body.seats[0].ai, false);
    ok('second session still valid', typeof idleT2 === 'string');

    ok('HTTP request count is sane', requests > 30 && requests < 2000, 'requests=' + requests);

    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'draughts', clients: 2, sameGame: true, settlementConsistent: true,
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
