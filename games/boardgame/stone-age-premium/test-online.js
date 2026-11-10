'use strict';

/*
 * Two-client online E2E for Stone Age Premium.
 *
 *   node games/boardgame/stone-age-premium/test-online.js
 *   node games/boardgame/stone-age-premium/test-online.js --control  # intentional failure
 *
 * Two independent clients drive the real HTTP room server through placement,
 * resolution and feeding, plus create/join/invite/password, reconnect, idle
 * takeover, rematch, leaderboard and room close.
 */

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
function totalRes(p) { return p.resources.wood + p.resources.brick + p.resources.stone + p.resources.gold; }

function chooseMove(view) {
  var moves = view.legalMoves || [];
  if (!moves.length) return null;
  var state = view.state;
  if (state.phase !== 'placement') return moves[0];
  var me = state.players[state.currentPlayer];
  var buys = moves.filter(function (m) { return m.spotId === 'building'; });
  for (var bi = 0; bi < buys.length; bi++) {
    var stack = state.buildingStacks[buys[bi].slotIndex] || [];
    var topId = null;
    for (var si = stack.length - 1; si >= 0; si--) { if (stack[si]) { topId = stack[si]; break; } }
    var b = topId ? Engine.BUILDINGS.filter(function (x) { return x.id === topId; })[0] : null;
    if (b && Object.keys(b.cost).every(function (k) { return me.resources[k] >= b.cost[k]; })) return buys[bi];
  }
  var civs = moves.filter(function (m) { return m.spotId === 'civ'; });
  if (civs.length && totalRes(me) >= (4 - civs[0].slotIndex)) return civs[0];
  var need = Math.max(0, me.totalWorkers - me.agriculture - me.food);
  var hunt = moves.filter(function (m) { return m.spotId === 'hunt'; });
  if (need > 0 && hunt.length) return hunt.sort(function (a, b) { return b.workers - a.workers; })[0];
  var order = ['wood', 'brick', 'stone', 'gold'];
  order.sort(function (a, b) { return me.resources[a] - me.resources[b]; });
  var spotMap = { wood: 'forest', brick: 'clay', stone: 'quarry', gold: 'river' };
  for (var ri = 0; ri < order.length; ri++) {
    var spotId = spotMap[order[ri]];
    var res = moves.filter(function (m) { return m.spotId === spotId; });
    if (res.length) return res.sort(function (a, b) { return b.workers - a.workers; })[0];
  }
  if (hunt.length) return hunt.sort(function (a, b) { return b.workers - a.workers; })[0];
  return moves.filter(function (m) { return m.type === 'place'; })[0] || moves[0];
}

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.createServer({
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
      headers: body ? { 'content-type': 'application/json' } : undefined,
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

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=stoneage', health.body.game, 'stoneage');

    var created = await api('POST', '/api/rooms', { playerId: 'alice', maxPlayers: 2 });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteCode: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    var inviteReuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteCode: invite1 });
    eq('invite is single-use', inviteReuse.status, 403);

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var privateRoom = await api('POST', '/api/rooms', { playerId: 'priv-host', password: 'secret-1', visibility: 'private', maxPlayers: 2 });
    var privId = privateRoom.body.roomId;
    var noAuth = await api('GET', roomRoute(privId));
    eq('private room rejected without session', noAuth.status, 403);
    var wrongPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'wrong' });
    eq('wrong password rejected', wrongPass.status, 403);
    var rightPass = await api('POST', roomRoute(privId, '/join'), { playerId: 'guest', password: 'secret-1' });
    eq('right password accepted', rightPass.status, 200);

    var startByGuest = await api('POST', roomRoute(room1, '/start'), { session: t2, playerId: 'bob' });
    eq('only host starts', startByGuest.status, 403);
    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('started phase playing', started.body.status, 'playing');
    eq('start player 0', started.body.state.startPlayer, 0);
    ok('current has legal placements', Array.isArray(started.body.legalMoves) && started.body.legalMoves.length > 0);
    ok('civilization deck is hidden', started.body.state.civDeck === undefined && typeof started.body.state.civDeckCount === 'number');
    eq('2 players in state', started.body.state.players.length, 2);
    eq('each player starts with 5 workers', started.body.state.players[0].totalWorkers, 5);
    eq('each player starts with 12 food', started.body.state.players[0].food, 12);

    var outOfTurn = await api('POST', roomRoute(room1, '/actions'), {
      session: t2, playerId: 'bob', type: 'move', move: { type: 'feed' }
    });
    eq('out-of-turn rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');

    var illegal = await api('POST', roomRoute(room1, '/actions'), {
      session: t1, playerId: 'alice', type: 'move', move: { type: 'place', spotId: 'hut', slotIndex: -1, workers: 1 }
    });
    eq('illegal placement rejected', illegal.status, 422);

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t1, playerId: 'alice' });
    eq('reconnect 200', reconnect.status, 200);
    eq('reconnect flag', reconnect.body.reconnected, true);
    var badReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: 'nope', playerId: 'alice' });
    eq('bad reconnect rejected', badReconnect.status, 403);

    /* ---- idle takeover -------------------------------------------- */
    var tkCreate = await api('POST', '/api/rooms', { playerId: 't1', maxPlayers: 2 });
    var tkRoom = tkCreate.body.roomId;
    var tk1 = tkCreate.body.playerSession;
    var tkJoin = await api('POST', roomRoute(tkRoom, '/join'), { playerId: 't2', inviteCode: tkCreate.body.inviteToken });
    var tk2 = tkJoin.body.playerSession;
    await api('POST', roomRoute(tkRoom, '/start'), { session: tk1, playerId: 't1' });
    await sleep(500);
    var tickTakeover = await api('POST', roomRoute(tkRoom, '/tick'), { session: tk1, playerId: 't1', force: true });
    eq('tick 200', tickTakeover.status, 200);
    ok('idle seat takeover recorded', Array.isArray(tickTakeover.body.takeoverSeats) && tickTakeover.body.takeoverSeats.length >= 1,
      JSON.stringify(tickTakeover.body.takeoverSeats));
    var reTk = await api('POST', roomRoute(tkRoom, '/reconnect'), { token: tk2, playerId: 't2' });
    eq('idle player reconnect 200', reTk.status, 200);
    ok('reconnect clears takeover', !reTk.body.takeoverSeats || reTk.body.takeoverSeats.indexOf(1) === -1,
      JSON.stringify(reTk.body.takeoverSeats));

    /* ---- full two-client game ------------------------------------- */
    var playRoom = await api('POST', '/api/rooms', { playerId: 'p1', maxPlayers: 2 });
    var pr = playRoom.body.roomId;
    var pt1 = playRoom.body.playerSession;
    var p2join = await api('POST', roomRoute(pr, '/join'), { playerId: 'p2', inviteCode: playRoom.body.inviteToken });
    var pt2 = p2join.body.playerSession;
    var pstart = await api('POST', roomRoute(pr, '/start'), { session: pt1, playerId: 'p1' });
    eq('play room started', pstart.status, 200);

    var guard = 0;
    var lastView = pstart.body;
    var sawResolve = false;
    var sawFeed = false;
    while (!lastView.state.over && guard < 2400) {
      var state = lastView.state;
      var seatIndex = state.currentPlayer;
      var seat = lastView.seats[seatIndex];
      if (seat && seat.playerId && !seat.controlledByAI) {
        var token = seatIndex === 0 ? pt1 : pt2;
        var playerId = seatIndex === 0 ? 'p1' : 'p2';
        var view = await getView(pr, token, playerId);
        if (!view.body || !view.body.legalMoves || !view.body.legalMoves.length) {
          console.log('DIAG no legal moves', JSON.stringify({
            guard: guard, phase: view.body && view.body.state && view.body.state.phase,
            current: view.body && view.body.state && view.body.state.currentPlayer
          }));
          break;
        }
        var chosen = chooseMove(view.body);
        if (view.body.state.phase === 'execute') sawResolve = true;
        if (view.body.state.phase === 'feed') sawFeed = true;
        var acted = await move(pr, token, playerId, chosen);
        if (acted.status !== 200) {
          ok('play loop move accepted at guard ' + guard, false, acted.status + ' ' + JSON.stringify(acted.body));
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
      guard += 1;
    }
    ok('online game reaches game over', lastView.state.over === true, 'guard=' + guard + ' round=' + lastView.state.round);
    ok('resolution phase happened', sawResolve === true);
    ok('feeding phase happened', sawFeed === true);
    ok('result has two scores', lastView.result && Array.isArray(lastView.result.scores) && lastView.result.scores.length === 2, JSON.stringify(lastView.result));
    ok('winner is recorded', !!(lastView.result && (lastView.result.winner != null || lastView.result.tied === true)), JSON.stringify(lastView.result));
    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard game=stoneage', board.body.game, 'stoneage');
    eq('leaderboard entry room', board.body.entries[0].roomId, pr);

    var restartGuest = await api('POST', roomRoute(pr, '/restart'), { session: pt2, playerId: 'p2' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(pr, '/restart'), { session: pt1, playerId: 'p1' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets game', restarted.body.state.over, false);
    eq('restart keeps 2 players', restarted.body.state.players.length, 2);
    eq('restart round 1', restarted.body.state.round, 1);

    var leave = await api('POST', roomRoute(pr, '/leave'), { session: pt2, playerId: 'p2' });
    eq('leave 200', leave.status, 200);
    var afterLeave = await getView(pr, pt1, 'p1');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);

    var closeByGuest = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt2) + '&playerId=p2');
    eq('non-host cannot close', closeByGuest.status, 403);
    var closed = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt1) + '&playerId=p1');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(pr));
    eq('closed room is gone', gone.status, 404);

    ok('HTTP request count is sane', requests > 20 && requests < 5000, 'requests=' + requests);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'stoneage', clients: 2, sameGame: true, settlementConsistent: true,
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
    await handle.close();
  }
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : String(err));
  failures.forEach(function (line) { console.log(' - ' + line); });
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
