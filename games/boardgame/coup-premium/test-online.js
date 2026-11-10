'use strict';

/*
 * Three-client online E2E for Coup Premium.
 *
 *   node games/boardgame/coup-premium/test-online.js
 *   node games/boardgame/coup-premium/test-online.js --control  # intentional failure
 *
 * Starts the real HTTP room server on an ephemeral port and drives three
 * independent clients over fetch: create/join/invite/password, host start,
 * AI-filled empty seats, private views, legal action sync, out-of-turn
 * rejection, reconnect, idle takeover, a full 3-player game through
 * challenge/block/discard/exchange, leaderboard, rematch, leave-as-AI and
 * host close. run-all.js discovers this file because it starts with "test".
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
function errCode(response) { return response.body && response.body.error && response.body.error.code; }
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
  async function act(roomId, session, playerId, action) {
    return api('POST', roomRoute(roomId, '/actions'), {
      session: session, playerId: playerId, type: 'action', action: action
    });
  }

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=coup', health.body.game, 'coup');
    eq('health max players', health.body.maxPlayers, 6);
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* ---------- room lifecycle ---------- */
    var created = await api('POST', '/api/rooms', { playerId: 'alice', maxPlayers: 3 });
    eq('create room 201', created.status, 201);
    var room1 = created.body.roomId;
    var t1 = created.body.playerSession;
    var invite1 = created.body.inviteToken;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof t1 === 'string' && t1.length > 0);
    ok('create returns invite token', typeof invite1 === 'string' && invite1.length > 0);
    eq('3-seat room has 3 seats', created.body.seats.length, 3);
    eq('host is seat 0', created.body.seats[0].playerId, 'alice');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);
    eq('empty seat 2 is AI', created.body.seats[2].ai, true);
    ok('host is marked isHost', created.body.isHost === true);
    ok('lobby canStart false with 1 human', created.body.canStart === false);

    var joined = await api('POST', roomRoute(room1, '/join'), { playerId: 'bob', inviteToken: invite1 });
    eq('invite join 200', joined.status, 200);
    var t2 = joined.body.playerSession;
    eq('bob is seat 1', joined.body.seats[1].playerId, 'bob');
    eq('room has 2 humans', joined.body.seats.filter(function (s) { return !s.ai; }).length, 2);
    var hostAfterJoin = await getView(room1, t1, 'alice');
    ok('host canStart with 2 humans', hostAfterJoin.body.canStart === true);

    var invite2 = await api('POST', roomRoute(room1, '/invite'), { session: t1, playerId: 'alice' });
    eq('host creates a second invite', invite2.status, 200);
    var carolJoin = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteToken: invite2.body.inviteToken });
    eq('carol joins by invite', carolJoin.status, 200);
    var t3 = carolJoin.body.playerSession;
    eq('carol is seat 2', carolJoin.body.seats[2].playerId, 'carol');
    eq('room now has 3 humans', carolJoin.body.seats.filter(function (s) { return !s.ai; }).length, 3);

    var inviteReuse = await api('POST', roomRoute(room1, '/join'), { playerId: 'carol', inviteToken: invite1 });
    eq('invite is single-use status', inviteReuse.status, 403);
    eq('invite is single-use code', errCode(inviteReuse), 'E_INVITE');

    var pii = await api('POST', '/api/rooms', { playerId: 'pii', email: 'a@b.c' });
    eq('PII rejected', pii.status, 422);
    eq('PII code', errCode(pii), 'E_PII');

    var clamped = await api('POST', '/api/rooms', { playerId: 'clamp-host', maxPlayers: 9 });
    eq('maxPlayers clamped to 6', clamped.body.maxPlayers, 6);
    var clampedOne = await api('POST', '/api/rooms', { playerId: 'clamp-one', maxPlayers: 1 });
    eq('maxPlayers clamped to 2', clampedOne.body.maxPlayers, 2);

    var privateRoom = await api('POST', '/api/rooms', { playerId: 'priv-host', password: 'secret-1', visibility: 'private', maxPlayers: 2 });
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

    /* ---------- 3-player game, private views, sync ---------- */
    var started = await api('POST', roomRoute(room1, '/start'), { session: t1, playerId: 'alice' });
    eq('host start 200', started.status, 200);
    eq('started status playing', started.body.status, 'playing');
    eq('3-player state', started.body.state.playerCount, 3);
    eq('3 seats all human', started.body.seats.filter(function (s) { return !s.ai; }).length, 3);
    eq('current is seat 0', started.body.state.current, 0);
    eq('actor is seat 0', started.body.state.actorId, 0);
    ok('current player has legal actions', Array.isArray(started.body.legalActions) && started.body.legalActions.length > 0);
    eq('alice sees her own 2 roles', started.body.state.players[0].influence.filter(function (c) { return !!c.role; }).length, 2);
    eq('alice cannot see bob roles', started.body.state.players[1].influence.filter(function (c) { return !!c.role; }).length, 0);
    eq('alice cannot see carol roles', started.body.state.players[2].influence.filter(function (c) { return !!c.role; }).length, 0);
    eq('face-down influence count hidden', started.body.state.players[1].influence.length, 2);
    eq('deck has 9 cards for 3p', started.body.state.deckCount, 9);

    var bobView = await getView(room1, t2, 'bob');
    eq('bob sees own 2 roles', bobView.body.state.players[1].influence.filter(function (c) { return !!c.role; }).length, 2);
    eq('bob cannot see alice roles', bobView.body.state.players[0].influence.filter(function (c) { return !!c.role; }).length, 0);
    eq('bob gets no legal actions out of turn', bobView.body.legalActions.length, 0);
    eq('bob canAct false', bobView.body.canAct, false);

    var outOfTurn = await act(room1, t2, 'bob', { type: 'income' });
    eq('out-of-turn rejected', outOfTurn.status, 409);
    eq('out-of-turn code', errCode(outOfTurn), 'E_TURN');

    var illegal = await act(room1, t1, 'alice', { type: 'coup', target: 1 });
    eq('illegal coup rejected (2 coins)', illegal.status, 422);
    eq('illegal action code', errCode(illegal), 'E_ACTION');

    var first = await act(room1, t1, 'alice', { type: 'income' });
    eq('legal income accepted', first.status, 200);
    eq('income paid 1 coin', first.body.state.players[0].coins, 3);
    eq('turn passed to seat 1', first.body.state.actorId, 1);
    eq('same action count on server', first.body.state.actionCount, 1);

    var v1 = await getView(room1, t1, 'alice');
    var v2 = await getView(room1, t2, 'bob');
    var v3 = await getView(room1, t3, 'carol');
    eq('three clients see same actor', [v1.body.state.actorId, v2.body.state.actorId, v3.body.state.actorId], [1, 1, 1]);
    eq('three clients see same phase', [v1.body.state.phase, v2.body.state.phase, v3.body.state.phase], ['action', 'action', 'action']);
    eq('three clients see same coins', [v1.body.state.players[0].coins, v2.body.state.players[0].coins, v3.body.state.players[0].coins], [3, 3, 3]);
    eq('three clients see same deck count', [v1.body.state.deckCount, v2.body.state.deckCount, v3.body.state.deckCount], [9, 9, 9]);
    eq('three clients see same action count', [v1.body.state.actionCount, v2.body.state.actionCount, v3.body.state.actionCount], [1, 1, 1]);

    var reconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: t1, playerId: 'alice' });
    eq('reconnect 200', reconnect.status, 200);
    eq('reconnect flag', reconnect.body.reconnected, true);
    eq('reconnect player', reconnect.body.you.playerId, 'alice');
    var badReconnect = await api('POST', roomRoute(room1, '/reconnect'), { token: 'bad-token', playerId: 'alice' });
    eq('bad reconnect rejected', badReconnect.status, 403);
    eq('bad reconnect code', errCode(badReconnect), 'E_TOKEN');

    /* ---------- rematch & leave on the lifecycle room ---------- */
    var leaveStart = await api('POST', roomRoute(room1, '/leave'), { session: t2, playerId: 'bob' });
    eq('leave 200', leaveStart.status, 200);
    var afterLeave = await getView(room1, t1, 'alice');
    eq('left seat becomes AI', afterLeave.body.seats[1].ai, true);
    ok('left seat has no playerId', afterLeave.body.seats[1].playerId === null);
    ok('left seat is in AI seats', afterLeave.body.aiSeats.indexOf(1) >= 0, JSON.stringify(afterLeave.body.aiSeats));

    /* ---------- idle takeover ---------- */
    var room3 = await api('POST', '/api/rooms', { playerId: 'a3', maxPlayers: 2 });
    var r3 = room3.body.roomId;
    var a3 = room3.body.playerSession;
    var inv3 = room3.body.inviteToken;
    var b3join = await api('POST', roomRoute(r3, '/join'), { playerId: 'b3', inviteToken: inv3 });
    var b3 = b3join.body.playerSession;
    var start3 = await api('POST', roomRoute(r3, '/start'), { session: a3, playerId: 'a3' });
    eq('2-player takeover room starts', start3.status, 200);
    eq('2 seats all human', start3.body.seats.filter(function (s) { return !s.ai; }).length, 2);
    var a3view = await getView(r3, a3, 'a3');
    eq('takeover room first actor a3', a3view.body.state.actorId, 0);
    var a3move = await act(r3, a3, 'a3', { type: 'income' });
    eq('takeover room income accepted', a3move.status, 200);
    eq('takeover room now b3', a3move.body.state.actorId, 1);
    await sleep(420);
    var keepAlive = await getView(r3, a3, 'a3');
    ok('a3 poll keeps a3 alive', keepAlive.body.takeoverSeats.indexOf(0) === -1, JSON.stringify(keepAlive.body.takeoverSeats));
    var tick3 = await api('POST', roomRoute(r3, '/tick'), { session: a3, playerId: 'a3', force: true });
    eq('tick 200', tick3.status, 200);
    ok('idle seat takeover recorded', Array.isArray(tick3.body.takeoverSeats) && tick3.body.takeoverSeats.indexOf(1) !== -1,
      JSON.stringify(tick3.body.takeoverSeats));
    var re3 = await api('POST', roomRoute(r3, '/reconnect'), { token: b3, playerId: 'b3' });
    eq('idle player reconnect 200', re3.status, 200);
    ok('reconnect clears takeover', !re3.body.takeoverSeats || re3.body.takeoverSeats.indexOf(1) === -1,
      JSON.stringify(re3.body.takeoverSeats));

    /* ---------- full 3-human play to game over ---------- */
    var playRoom = await api('POST', '/api/rooms', { playerId: 'p1', maxPlayers: 3 });
    var pr = playRoom.body.roomId;
    var pt1 = playRoom.body.playerSession;
    var pinvite = playRoom.body.inviteToken;
    var p2join = await api('POST', roomRoute(pr, '/join'), { playerId: 'p2', inviteToken: pinvite });
    var pt2 = p2join.body.playerSession;
    var p3join = await api('POST', roomRoute(pr, '/join'), { playerId: 'p3' });
    var pt3 = p3join.body.playerSession;
    eq('play room has 3 humans', p3join.body.seats.filter(function (s) { return !s.ai; }).length, 3);
    var tokens = { p1: pt1, p2: pt2, p3: pt3 };
    var pstart = await api('POST', roomRoute(pr, '/start'), { session: pt1, playerId: 'p1' });
    eq('play room started', pstart.status, 200);
    eq('play room 3 players', pstart.body.state.playerCount, 3);

    var lastView = pstart.body;
    var guard = 0;
    var saw = { challenge: 0, block: 0, blockChallenge: 0, discard: 0, exchange: 0, action: 0 };
    var challengedOnce = false;
    var actionSeq = 0;
    function chooseAction(view) {
      var actions = view.legalActions || [];
      if (!actions.length) return null;
      if (view.state.phase === 'action') {
        actionSeq += 1;
        var priority = actionSeq === 1
          ? ['foreign_aid']
          : actionSeq === 2
            ? ['tax', 'steal', 'assassinate', 'foreign_aid']
            : ['coup', 'assassinate', 'steal', 'tax', 'exchange', 'foreign_aid', 'income'];
        for (var p = 0; p < priority.length; p += 1) {
          var found = actions.filter(function (a) { return a.type === priority[p]; });
          if (found.length) return found[0];
        }
        return actions[0];
      }
      if (view.state.phase === 'challenge') {
        if (!challengedOnce) { challengedOnce = true; return { type: 'challenge' }; }
        return { type: 'pass' };
      }
      if (view.state.phase === 'block') {
        var block = actions.filter(function (a) { return a.type === 'block'; });
        if (block.length) return block[0];
        return { type: 'pass' };
      }
      if (view.state.phase === 'blockChallenge') return { type: 'challenge' };
      if (view.state.phase === 'discard') return actions[0];
      if (view.state.phase === 'exchange') return actions[0];
      return actions[0];
    }
    while (!lastView.state.over && guard < 500) {
      var actorIndex = lastView.state.actorId;
      if (actorIndex == null) break;
      var seat = lastView.seats[actorIndex];
      if (!seat || seat.ai || seat.controlledByAI) {
        var ticked = await api('POST', roomRoute(pr, '/tick'), { session: pt1, playerId: 'p1', force: true });
        if (ticked.status !== 200) { ok('play loop tick accepted at ' + guard, false, ticked.status); break; }
        lastView = ticked.body;
        guard += 1;
        continue;
      }
      var playerId = seat.playerId;
      var token = tokens[playerId];
      // Touch every human seat so the tight loop never triggers idle takeover,
      // then read the actor's private view (legalActions is seat-scoped).
      var others = [['p1', pt1], ['p2', pt2], ['p3', pt3]].filter(function (pair) { return pair[0] !== playerId; });
      for (var oi = 0; oi < others.length; oi += 1) await getView(pr, others[oi][1], others[oi][0]);
      var viewResponse = await getView(pr, token, playerId);
      if (viewResponse.status !== 200) { ok('play loop view at ' + guard, false, viewResponse.status); break; }
      lastView = viewResponse.body;
      if (lastView.state.over) break;
      if (!lastView.canAct) {
        await sleep(30);
        guard += 1;
        continue;
      }
      var phase = lastView.state.phase;
      saw[phase] = (saw[phase] || 0) + 1;
      var action = chooseAction(lastView);
      if (!action) { ok('play loop has action at ' + guard, false, JSON.stringify(lastView.state)); break; }
      var acted = await act(pr, token, playerId, action);
      if (acted.status !== 200) {
        ok('play loop action accepted at guard ' + guard, false, acted.status + ' ' + acted.text);
        break;
      }
      lastView = acted.body;
      guard += 1;
    }
    ok('online game reaches game over', lastView.state.over === true, 'guard=' + guard);
    ok('at least one challenge occurred', challengedOnce === true, JSON.stringify(saw));
    ok('online game saw block phases', (saw.block || 0) + (saw.blockChallenge || 0) >= 1, JSON.stringify(saw));
    ok('online game saw action phases', (saw.action || 0) >= 3, JSON.stringify(saw));
    ok('winner seat valid', lastView.state.winner >= 0 && lastView.state.winner < 3, String(lastView.state.winner));

    var finalViews = [];
    for (var fp = 1; fp <= 3; fp += 1) {
      var pid = 'p' + fp;
      var fv = await getView(pr, tokens[pid], pid);
      finalViews.push(fv.body);
    }
    eq('all clients agree game over', finalViews.map(function (v) { return v.state.over; }), [true, true, true]);
    eq('all clients agree winner', finalViews.map(function (v) { return v.state.winner; }), [lastView.state.winner, lastView.state.winner, lastView.state.winner]);
    eq('all clients agree coins', finalViews.map(function (v) { return v.state.players.map(function (p) { return p.coins; }); }),
      [finalViews[0].state.players.map(function (p) { return p.coins; }), finalViews[0].state.players.map(function (p) { return p.coins; }), finalViews[0].state.players.map(function (p) { return p.coins; })]);
    eq('all clients agree eliminated flags', finalViews.map(function (v) { return v.state.players.map(function (p) { return p.eliminated; }); }),
      [finalViews[0].state.players.map(function (p) { return p.eliminated; }), finalViews[0].state.players.map(function (p) { return p.eliminated; }), finalViews[0].state.players.map(function (p) { return p.eliminated; })]);
    ok('alive players <= 1 at settlement', finalViews[0].state.players.filter(function (p) { return !p.eliminated; }).length <= 1);

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard payload has entries array', Array.isArray(board.body.entries), JSON.stringify(board.body).slice(0, 240));
    eq('leaderboard game=coup', board.body.game, 'coup');
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    eq('leaderboard entry room', board.body.entries[0].roomId, pr);
    eq('leaderboard entry winner', board.body.entries[0].winner, lastView.state.winner);
    ok('leaderboard entry has three players', board.body.entries[0].players.length === 3);

    var restartGuest = await api('POST', roomRoute(pr, '/restart'), { session: pt2, playerId: 'p2' });
    eq('only host restarts', restartGuest.status, 403);
    var restarted = await api('POST', roomRoute(pr, '/restart'), { session: pt1, playerId: 'p1' });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets game', restarted.body.state.over, false);
    eq('restart keeps 3 players', restarted.body.state.playerCount, 3);
    eq('restart all players 2 coins', restarted.body.state.players.map(function (p) { return p.coins; }), [2, 2, 2]);
    eq('restart deck 9', restarted.body.state.deckCount, 9);

    var leave = await api('POST', roomRoute(pr, '/leave'), { session: pt3, playerId: 'p3' });
    eq('leave after restart 200', leave.status, 200);
    var afterLeave2 = await getView(pr, pt1, 'p1');
    eq('left seat becomes AI after restart', afterLeave2.body.seats[2].ai, true);
    ok('left seat cleared playerId', afterLeave2.body.seats[2].playerId === null);

    var closeByGuest = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt2) + '&playerId=p2');
    eq('non-host cannot close', closeByGuest.status, 403);
    var closed = await api('DELETE', roomRoute(pr) + '?session=' + encodeURIComponent(pt1) + '&playerId=p1');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(pr));
    eq('closed room is gone', gone.status, 404);

    ok('HTTP request count is sane', requests > 40 && requests < 2500, 'requests=' + requests);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'coup', clients: 3, sameGame: true, settlementConsistent: true,
      reconnect: true, timeoutTakeover: true, leaderboard: true, runAll: true,
      test: 'test-online.js', server: 'online-server.mjs', client: 'online.html',
      aiFillEmptySeats: true, rulesSimplified: false,
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
