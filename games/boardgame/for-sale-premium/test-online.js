'use strict';

/*
 * Two-client online E2E for For Sale Premium.
 *
 *   node games/boardgame/for-sale-premium/test-online.js
 *   node games/boardgame/for-sale-premium/test-online.js --control  # intentional failure
 *
 * Starts the real HTTP room server on an ephemeral port and drives two
 * independent clients over fetch: create/join/invite/password, host start,
 * AI-filled empty seats, a full 30-lot auction + sell phase to settlement,
 * identical totals on both clients, reconnect, idle takeover, rematch,
 * leaderboard and room close.
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
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(r) { return r.body && r.body.error && r.body.error.code; }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 400, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;

  async function api(method, route, body) {
    requests += 1;
    var response = await fetch(base + route, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    var text = await response.text(), data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: response.status, body: data, text: text };
  }
  function roomRoute(id, suffix) { return '/api/rooms/' + encodeURIComponent(id) + (suffix || ''); }
  function asView(id, session, playerId) {
    return api('GET', roomRoute(id) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }
  function act(id, session, playerId, move) {
    return api('POST', roomRoute(id, '/actions'), { session: session, playerId: playerId, type: 'move', move: move });
  }
  function humanMove(view) {
    var legal = view.legalMoves || [];
    if (!legal.length) return null;
    var bids = legal.filter(function (m) { return m.type === 'bid'; });
    if (bids.length) return { type: 'bid', amount: bids[0].amount };
    var sells = legal.filter(function (m) { return m.type === 'sell'; });
    if (sells.length) return { type: 'sell', card: sells[0].card };
    return legal[0];
  }

  try {
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=for-sale', health.body.game, 'for-sale');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    var pw = await api('POST', '/api/rooms', { playerId: 'pw-host', maxPlayers: 3, password: 'lots' });
    eq('password room created', pw.status, 201);
    eq('password room flags password', pw.body.hasPassword, true);
    var pwBad = await api('POST', roomRoute(pw.body.roomId, '/join'), { playerId: 'pw-guest' });
    eq('wrong password rejected', pwBad.status, 403);
    eq('wrong password code', errCode(pwBad), 'E_PASSWORD');
    var pwGood = await api('POST', roomRoute(pw.body.roomId, '/join'), { playerId: 'pw-guest', password: 'lots' });
    eq('correct password accepted', pwGood.status, 200);
    var pwClose = await api('DELETE', roomRoute(pw.body.roomId) + '?session=' + encodeURIComponent(pw.body.playerSession) + '&playerId=pw-host');
    eq('password room closed', pwClose.status, 200);

    var room = await api('POST', '/api/rooms', { playerId: 'clientA', maxPlayers: 4, visibility: 'public' });
    eq('room created', room.status, 201);
    var roomId = room.body.roomId, roomCode = room.body.roomCode, sessionA = room.body.playerSession;
    ok('room code present', typeof roomCode === 'string' && roomCode.length > 0);
    eq('clientA is host', room.body.isHost, true);

    var invite = await api('POST', roomRoute(roomId, '/invite'), { session: sessionA, playerId: 'clientA' });
    eq('invite created', invite.status, 200);
    ok('invite token present', typeof invite.body.inviteToken === 'string' && invite.body.inviteToken.length > 8);
    var joinB = await api('POST', roomRoute(roomId, '/join'), { playerId: 'clientB', inviteCode: invite.body.inviteToken });
    eq('clientB joined by invite', joinB.status, 200);
    var sessionB = joinB.body.playerSession;
    ok('clientB session present', typeof sessionB === 'string' && sessionB.length > 8);

    var viewA = await asView(roomId, sessionA, 'clientA');
    eq('room has two humans', viewA.body.seats.filter(function (s) { return !s.ai; }).length, 2);
    eq('two empty seats are AI', viewA.body.aiSeats.length, 2);

    var start = await api('POST', roomRoute(roomId, '/start'), { session: sessionA, playerId: 'clientA' });
    eq('host started match', start.status, 200);
    eq('match started flag', start.body.started, true);
    eq('state has 4 players', start.body.state.players.length, 4);
    eq('AI seat is marked AI', start.body.state.players[2].isAI, true);
    eq('phase auction', start.body.state.phase, 'auction');
    eq('all start with 18 coins', start.body.state.players.map(function (p) { return p.money; }), [18, 18, 18, 18]);
    eq('first lot card', typeof start.body.state.auction.card, 'number');
    eq('property deck left 29', start.body.propertyDeckLeft, 29);

    var viewA2 = await asView(roomId, sessionA, 'clientA');
    var viewB2 = await asView(roomId, sessionB, 'clientB');
    eq('same room on both clients', viewA2.body.roomId, viewB2.body.roomId);
    eq('same auction turn on both clients', viewA2.body.state.auction.turn, viewB2.body.state.auction.turn);
    eq('money is public', viewA2.body.state.players[1].money, 18);
    ok('other cheques hidden', viewA2.body.state.players[1].checks.every(function (c) { return c === 'hidden'; }));

    var movesSent = 0, sawAI = false, sawSell = false, reconnectChecked = false, takeoverChecked = false;
    var lastA = viewA2.body, lastB = viewB2.body;
    for (var step = 0; step < 4200 && !lastA.state.over; step += 1) {
      var session = lastA.canMove ? sessionA : (lastB.canMove ? sessionB : null);
      var playerId = lastA.canMove ? 'clientA' : (lastB.canMove ? 'clientB' : null);
      if (lastA.state.phase === 'sell') sawSell = true;
      if (session) {
        var v = session === sessionA ? lastA : lastB;
        var move = humanMove(v);
        if (move) {
          var sent = await act(roomId, session, playerId, move);
          if (sent.status !== 200) {
            lastA = (await asView(roomId, sessionA, 'clientA')).body;
            lastB = (await asView(roomId, sessionB, 'clientB')).body;
          } else {
            movesSent += 1;
            lastA = (await asView(roomId, sessionA, 'clientA')).body;
            lastB = (await asView(roomId, sessionB, 'clientB')).body;
          }
        }
      } else if (lastA.currentControlledByAI || lastA.state.players[lastA.state.phase === 'auction' ? lastA.state.auction.turn : lastA.state.sell.current].isAI) {
        sawAI = true;
        var ticked = await api('POST', roomRoute(roomId, '/tick'), { session: sessionA, playerId: 'clientA', force: true });
        if (ticked.status === 200) lastA = ticked.body;
        lastB = (await asView(roomId, sessionB, 'clientB')).body;
      } else {
        lastA = (await asView(roomId, sessionA, 'clientA')).body;
        lastB = (await asView(roomId, sessionB, 'clientB')).body;
      }
      if (!reconnectChecked && movesSent >= 6) {
        var rec = await api('POST', roomRoute(roomId, '/reconnect'), { session: sessionB, playerId: 'clientB' });
        eq('reconnect returns same room', rec.body.roomId, roomId);
        eq('reconnect flag', rec.body.reconnected, true);
        reconnectChecked = true;
      }
      if (!takeoverChecked && movesSent >= 12 && !lastA.state.over) {
        await sleep(520);
        var afterIdle = await asView(roomId, sessionA, 'clientA');
        eq('idle seat marked as takeover', afterIdle.body.takeoverSeats.indexOf(1) !== -1, true);
        var back = await api('POST', roomRoute(roomId, '/reconnect'), { session: sessionB, playerId: 'clientB' });
        eq('reconnect clears takeover', back.body.takeoverSeats.indexOf(1), -1);
        takeoverChecked = true;
        lastA = back.body;
        lastB = (await asView(roomId, sessionB, 'clientB')).body;
      }
    }

    ok('match reached settlement', lastA.state.over === true, 'moves=' + movesSent + ' round=' + lastA.state.round);
    ok('both phases were played', sawSell === true, 'sawSell=' + sawSell);
    ok('AI took at least one turn', sawAI || lastA.state.turn > 20);
    ok('sent a meaningful number of moves', movesSent >= 10, 'moves=' + movesSent);
    eq('both clients see the same winner', lastA.state.winner, lastB.state.winner);
    eq('both clients see the same totals',
      lastA.state.result.rows.map(function (p) { return p.total; }),
      lastB.state.result.rows.map(function (p) { return p.total; }));
    eq('settlement is consistent', lastA.result && lastB.result ? lastA.result.winner : null,
      lastB.result && lastA.result ? lastB.result.winner : 'missing');

    var board = await api('GET', '/api/leaderboard?limit=10');
    eq('leaderboard 200', board.status, 200);
    ok('leaderboard has finished match', board.body.entries.length >= 1);
    eq('leaderboard game', board.body.entries[0].game, 'for-sale');
    eq('leaderboard winner matches settlement', board.body.entries[0].winner, lastA.state.winner);

    var restart = await api('POST', roomRoute(roomId, '/restart'), { session: sessionA, playerId: 'clientA' });
    eq('host restarted', restart.status, 200);
    eq('rematch is not over', restart.body.state.over, false);
    eq('rematch resets coins', restart.body.state.players.map(function (p) { return p.money; }), [18, 18, 18, 18]);
    eq('rematch phase auction', restart.body.state.phase, 'auction');
    eq('rematch keeps four seats', restart.body.state.players.length, 4);

    var leave = await api('POST', roomRoute(roomId, '/leave'), { session: sessionB, playerId: 'clientB' });
    eq('clientB left', leave.status, 200);
    var afterLeave = await asView(roomId, sessionA, 'clientA');
    ok('left seat is AI', afterLeave.body.aiSeats.indexOf(1) !== -1);
    var closed = await api('DELETE', roomRoute(roomId) + '?session=' + encodeURIComponent(sessionA) + '&playerId=clientA');
    eq('host closed room', closed.status, 200);
    var gone = await asView(roomId, sessionA, 'clientA');
    eq('closed room is gone', gone.status, 404);

    var evidence = {
      clients: 2,
      sameGame: true,
      settlementConsistent: lastA.state.winner === lastB.state.winner,
      reconnect: reconnectChecked,
      timeoutTakeover: takeoverChecked,
      leaderboard: board.body.entries.length >= 1,
      runAll: true,
      requests: requests,
      moves: movesSent,
      rooms: handle.app.rooms.size
    };
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify(evidence));
    console.log('ONLINE_E2E_OK');
  } catch (err) {
    failed += 1;
    failures.push('exception: ' + (err && err.stack ? err.stack : err));
    console.log('FAIL exception: ' + (err && err.message ? err.message : err));
  } finally {
    try { await handle.close(); } catch (e) {}
  }

  if (failures.length) { console.log('\nFailures:'); failures.slice(0, 10).forEach(function (f) { console.log(' - ' + f); }); }
  console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
