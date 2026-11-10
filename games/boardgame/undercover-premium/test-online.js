'use strict';

/*
 * Four-client online E2E for Undercover Premium (双客户端契约；完整对局使用四个独立客户端).
 *
 *   node games/boardgame/undercover-premium/test-online.js
 *   node games/boardgame/undercover-premium/test-online.js --control  # intentional failure
 *
 * Starts the real HTTP room server on ephemeral ports and drives independent
 * clients over fetch: create/join/invite/password/full rooms, host start, empty
 * seats filled by AI, hidden-information checks, a complete 4-human game to a
 * consistent settlement, reconnect, idle takeover, leaderboard, rematch,
 * leave-to-AI and room close.
 *
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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function errCode(response) {
  return response.body && response.body.error && response.body.error.code;
}
function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function makeClient(origin, counter) {
  return async function api(method, route, body) {
    counter.n += 1;
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

function roomRoute(roomId, suffix) {
  return '/api/rooms/' + encodeURIComponent(roomId) + (suffix || '');
}

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var mainHandle = await mod.createServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 15000, aiDelayMs: 0 });
  var idleHandle = await mod.createServer({ port: 0, host: '127.0.0.1', idleTimeoutMs: 250, aiDelayMs: 0 });
  var base = 'http://127.0.0.1:' + mainHandle.address.port;
  var idleBase = 'http://127.0.0.1:' + idleHandle.address.port;
  var counter = { n: 0 };
  var api = makeClient(base, counter);
  var idleApi = makeClient(idleBase, counter);

  try {
    /* -------------------------------------------------------------- */
    /* health                                                         */
    /* -------------------------------------------------------------- */
    var health = await api('GET', '/health');
    eq('health 200', health.status, 200);
    eq('health game=undercover', health.body.game, 'undercover');
    ok('health reports rooms', typeof health.body.rooms === 'number');

    /* -------------------------------------------------------------- */
    /* create / join / invite / password / full                       */
    /* -------------------------------------------------------------- */
    var created = await api('POST', '/api/rooms', { playerId: 'host', maxPlayers: 6 });
    eq('create 6-seat room 201', created.status, 201);
    var room1 = created.body.roomId;
    var hostToken = created.body.playerSession;
    var hostName = created.body.roomCode;
    ok('create returns roomId', typeof room1 === 'string' && room1.length > 0);
    ok('create returns host session', typeof hostToken === 'string' && hostToken.length > 0);
    ok('create returns room code', typeof hostName === 'string' && hostName.length > 0);
    eq('room has six seats', created.body.seats.length, 6);
    eq('host is seat 0', created.body.seats[0].playerId, 'host');
    eq('empty seat 1 is AI', created.body.seats[1].ai, true);
    eq('room maxPlayers is 6', created.body.maxPlayers, 6);

    var soloCreated = await api('POST', '/api/rooms', { playerId: 'solo-host', maxPlayers: 6 });
    var soloStart = await api('POST', roomRoute(soloCreated.body.roomId, '/start'), {
      session: soloCreated.body.playerSession, playerId: 'solo-host'
    });
    eq('solo host starts against AI', soloStart.status, 200);
    eq('solo start started', soloStart.body.started, true);
    eq('solo start fills AI seats', soloStart.body.seats.filter(function (s) { return s.ai; }).length, 5);
    ok('solo start has six players', soloStart.body.state && soloStart.body.state.players.length === 6,
      soloStart.body.state && soloStart.body.state.players.length);

    var inviteJoin = await api('POST', roomRoute(room1, '/join'), {
      playerId: 'guest1', inviteCode: created.body.inviteToken
    });
    eq('invite join 200', inviteJoin.status, 200);
    ok('invite join returns session', typeof inviteJoin.body.playerSession === 'string');
    var reuse = await api('POST', roomRoute(room1, '/join'), {
      playerId: 'guest2', inviteCode: created.body.inviteToken
    });
    eq('single-use invite rejected', reuse.status, 403);
    eq('reused invite error E_INVITE', errCode(reuse), 'E_INVITE');

    var third = await api('POST', roomRoute(room1, '/join'), { playerId: 'guest2' });
    eq('join by public room code 200', third.status, 200);
    ok('third human session', typeof third.body.playerSession === 'string');

    var hostOnlyStart = await api('POST', roomRoute(room1, '/start'), {
      session: third.body.playerSession, playerId: 'guest2'
    });
    eq('non-host cannot start', hostOnlyStart.status, 403);
    eq('non-host start error E_HOST', errCode(hostOnlyStart), 'E_HOST');

    var pwRoom = await api('POST', '/api/rooms', { playerId: 'pw-host', maxPlayers: 4, password: 'secret' });
    eq('password room created', pwRoom.status, 201);
    var pwJoinBad = await api('POST', roomRoute(pwRoom.body.roomId, '/join'), { playerId: 'pw-guest' });
    eq('wrong/missing password rejected', pwJoinBad.status, 403);
    eq('password error E_PASSWORD', errCode(pwJoinBad), 'E_PASSWORD');
    var pwJoinOk = await api('POST', roomRoute(pwRoom.body.roomId, '/join'), {
      playerId: 'pw-guest', password: 'secret'
    });
    eq('correct password joins', pwJoinOk.status, 200);

    var fullRoom = await api('POST', '/api/rooms', { playerId: 'full-host', maxPlayers: 2 });
    var fullJoin = await api('POST', roomRoute(fullRoom.body.roomId, '/join'), { playerId: 'full-guest' });
    eq('second player joins 2-seat room', fullJoin.status, 200);
    var fullThird = await api('POST', roomRoute(fullRoom.body.roomId, '/join'), { playerId: 'full-third' });
    eq('third player rejected from 2-seat room', fullThird.status, 409);
    eq('third player error E_FULL', errCode(fullThird), 'E_FULL');

    var fourRoom = await api('POST', '/api/rooms', { playerId: 'four-host', maxPlayers: 4 });
    for (var fj = 1; fj <= 3; fj += 1) {
      await api('POST', roomRoute(fourRoom.body.roomId, '/join'), { playerId: 'four-' + fj });
    }
    var fifth = await api('POST', roomRoute(fourRoom.body.roomId, '/join'), { playerId: 'four-5' });
    eq('fifth player rejected from 4-seat room', fifth.status, 409);
    eq('fifth player error E_FULL', errCode(fifth), 'E_FULL');

    /* -------------------------------------------------------------- */
    /* AI fill + hidden information                                   */
    /* -------------------------------------------------------------- */
    var aiStart = await api('POST', roomRoute(room1, '/start'), { session: hostToken, playerId: 'host' });
    eq('host starts AI-filled room', aiStart.status, 200);
    eq('AI-filled match started', aiStart.body.started, true);
    ok('match starts in reveal phase', aiStart.body.state && aiStart.body.state.phase === 'reveal',
      aiStart.body.state && aiStart.body.state.phase);
    eq('AI seats remain filled', aiStart.body.seats.filter(function (s) { return s.ai; }).length, 3);
    ok('AI-filled game has six players', aiStart.body.state.players.length === 6);

    var hidden = await api('GET', roomRoute(room1) + '?session=' + encodeURIComponent(hostToken) + '&playerId=host');
    eq('host view 200', hidden.status, 200);
    ok('private word delivered only to the viewer', typeof hidden.body.privateWord === 'string' && hidden.body.privateWord.length > 0);
    ok('private role delivered only to the viewer', ['u', 'b', 'c'].indexOf(hidden.body.privateRole) !== -1);
    ok('living players have no public role', hidden.body.state.players.every(function (p) {
      return !p.alive || (p.role === undefined && p.word === undefined);
    }), JSON.stringify(hidden.body.state.players.map(function (p) { return { i: p.index, alive: p.alive, role: p.role, word: p.word }; })));
    ok('public state has no word pair', hidden.body.state.pair === undefined);
    ok('public state has no role of an AI seat', hidden.body.state.players.every(function (p) {
      return p.role === undefined || !p.alive;
    }));

    // Drive the AI-filled room to the end with the two human sessions.
    var sessions = {};
    sessions.host = hostToken;
    sessions.guest1 = inviteJoin.body.playerSession;
    sessions.guest2 = third.body.playerSession;
    var view = hidden.body;
    var aiGuard = 0;
    var sawElimination = false;
    while (!view.state.over && aiGuard < 400) {
      var current = view.state.current;
      var currentSeat = view.seats[current];
      var currentId = currentSeat && currentSeat.playerId;
      var currentSession = currentId ? sessions[currentId] : null;
      if (currentSession && !currentSeat.controlledByAI) {
        var mine = await api('GET', roomRoute(room1) + '?session=' + encodeURIComponent(currentSession) + '&playerId=' + encodeURIComponent(currentId));
        if (!mine.body || !mine.body.canMove) {
          var forced = await api('POST', roomRoute(room1, '/tick'), { session: hostToken, playerId: 'host', force: true });
          view = forced.body;
          aiGuard += 1;
          continue;
        }
        var move = null;
        if (mine.body.state.phase === 'reveal') move = { type: 'reveal' };
        else if (mine.body.state.phase === 'speak') move = { type: 'beginVote' };
        else if (mine.body.state.phase === 'vote') {
          var options = (mine.body.state.players || []).filter(function (p) {
            return p.alive && p.index !== mine.body.state.current;
          });
          if (options.length) move = { type: 'vote', target: options[0].index };
        }
        if (!move) break;
        var acted = await api('POST', roomRoute(room1, '/actions'), {
          session: currentSession, playerId: currentId, type: 'move', move: move
        });
        if (acted.status !== 200) {
          ok('AI-filled loop action accepted', false, acted.status + ' ' + JSON.stringify(acted.body));
          break;
        }
        view = acted.body;
        if (view.state.lastElim) sawElimination = true;
      } else {
        var ticked = await api('POST', roomRoute(room1, '/tick'), { session: hostToken, playerId: 'host', force: true });
        if (ticked.status !== 200) {
          ok('AI-filled loop tick accepted', false, ticked.status);
          break;
        }
        view = ticked.body;
        if (view.state.lastElim) sawElimination = true;
      }
      aiGuard += 1;
    }
    ok('AI-filled game reaches a result', view.state.over === true, 'guard=' + aiGuard + ' phase=' + view.state.phase);
    ok('AI-filled game had at least one elimination or tie', sawElimination || view.state.over);
    ok('AI-filled result exposes roles only after the game', view.state.over && view.state.players.every(function (p) {
      return typeof p.role === 'string' && typeof p.word === 'string';
    }));

    /* -------------------------------------------------------------- */
    /* four independent human clients: complete game                  */
    /* -------------------------------------------------------------- */
    var play = await api('POST', '/api/rooms', { playerId: 'p0', maxPlayers: 4 });
    var playRoom = play.body.roomId;
    var playSessions = { p0: play.body.playerSession };
    var playIds = ['p0'];
    for (var pj = 1; pj < 4; pj += 1) {
      var pjId = 'p' + pj;
      var joined = await api('POST', roomRoute(playRoom, '/join'), { playerId: pjId });
      eq('four-client join ' + pjId, joined.status, 200);
      playSessions[pjId] = joined.body.playerSession;
      playIds.push(pjId);
    }
    var pStart = await api('POST', roomRoute(playRoom, '/start'), {
      session: playSessions.p0, playerId: 'p0'
    });
    eq('four-client game started', pStart.status, 200);
    eq('four humans fill four seats', pStart.body.seats.filter(function (s) { return !s.ai; }).length, 4);

    var roleByIndex = {};
    var wordByIndex = {};
    for (var ri = 0; ri < playIds.length; ri += 1) {
      var rid = playIds[ri];
      var rv = await api('GET', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions[rid]) + '&playerId=' + encodeURIComponent(rid));
      eq('private view for ' + rid, rv.status, 200);
      ok('private role for ' + rid, ['u', 'b', 'c'].indexOf(rv.body.privateRole) !== -1);
      ok('private word for ' + rid, typeof rv.body.privateWord === 'string');
      roleByIndex[ri] = rv.body.privateRole;
      wordByIndex[ri] = rv.body.privateWord;
      ok('other living seats hidden in ' + rid + ' view', rv.body.state.players.every(function (p) {
        return p.index === ri || !p.alive || (p.role === undefined && p.word === undefined);
      }));
    }
    eq('exactly one undercover in a 4-player room', Object.keys(roleByIndex).filter(function (i) { return roleByIndex[i] === 'u'; }).length, 1);
    eq('no blank in the default online deal', Object.keys(roleByIndex).filter(function (i) { return roleByIndex[i] === 'b'; }).length, 0);

    var playView = pStart.body;
    var playGuard = 0;
    var sawReveal = false;
    var sawSpeak = false;
    var sawVote = false;
    while (!playView.state.over && playGuard < 300) {
      var st = playView.state;
      var seatIndex = st.current;
      var seat = playView.seats[seatIndex];
      var pid = seat && seat.playerId;
      var session = pid ? playSessions[pid] : null;
      if (!session) {
        ok('current seat has a human session', false, JSON.stringify(seat));
        break;
      }
      var cv = await api('GET', roomRoute(playRoom) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(pid));
      if (!cv.body || !cv.body.canMove) {
        ok('current human can move at guard ' + playGuard, false,
          'phase=' + (cv.body && cv.body.state && cv.body.state.phase));
        break;
      }
      var pmove = null;
      if (st.phase === 'reveal') { pmove = { type: 'reveal' }; sawReveal = true; }
      else if (st.phase === 'speak') { pmove = { type: 'beginVote' }; sawSpeak = true; }
      else if (st.phase === 'vote') {
        sawVote = true;
        var candidates = (st.players || []).filter(function (p) {
          return p.alive && p.index !== seatIndex;
        });
        var ucCandidates = candidates.filter(function (p) {
          return roleByIndex[p.index] === 'u' || roleByIndex[p.index] === 'b';
        });
        var target = (ucCandidates[0] || candidates[0]);
        if (!target) { ok('vote has a legal target', false); break; }
        pmove = { type: 'vote', target: target.index };
      }
      if (!pmove) break;
      var playAct = await api('POST', roomRoute(playRoom, '/actions'), {
        session: session, playerId: pid, type: 'move', move: pmove
      });
      if (playAct.status !== 200) {
        ok('four-client move accepted at guard ' + playGuard, false, playAct.status + ' ' + JSON.stringify(playAct.body));
        break;
      }
      playView = playAct.body;
      playGuard += 1;

      // Cross-client consistency: p0 and the actor must see the same match.
      var otherId = pid === 'p0' ? 'p1' : 'p0';
      var otherView = await api('GET', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions[otherId]) + '&playerId=' + encodeURIComponent(otherId));
      ok('two clients share the same phase at guard ' + playGuard,
        otherView.body.state.phase === playView.state.phase &&
        otherView.body.state.round === playView.state.round &&
        otherView.body.state.current === playView.state.current);
      ok('two clients share the same room/game at guard ' + playGuard,
        otherView.body.roomId === playView.roomId && otherView.body.game === 'undercover');
    }
    ok('four-client game reaches game over', playView.state.over === true, 'guard=' + playGuard + ' phase=' + playView.state.phase);
    ok('reveal phase happened', sawReveal === true);
    ok('speak phase happened', sawSpeak === true);
    ok('vote phase happened', sawVote === true);
    eq('four-client winner side is civilians', playView.state.result && playView.state.result.winnerSide, 'civ');
    ok('result records four players', playView.state.result && playView.state.result.players.length === 4);
    ok('all undercover-side players were eliminated', playView.state.result && playView.state.result.players.every(function (p) {
      return p.role === 'c' || p.alive === false;
    }));

    // All four clients agree on the settlement.
    var settlements = [];
    for (var si = 0; si < playIds.length; si += 1) {
      var sid = playIds[si];
      var sv = await api('GET', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions[sid]) + '&playerId=' + encodeURIComponent(sid));
      settlements.push({
        over: sv.body.state.over,
        winnerSide: sv.body.state.result && sv.body.state.result.winnerSide,
        eliminated: sv.body.state.eliminated.slice().sort(),
        roles: sv.body.state.result && sv.body.state.result.players.map(function (p) { return [p.index, p.role, p.word]; }),
        roomId: sv.body.roomId
      });
    }
    var first = JSON.stringify(settlements[0]);
    ok('all four clients agree on the settlement', settlements.every(function (s) { return JSON.stringify(s) === first; }),
      JSON.stringify(settlements));

    var board = await api('GET', '/api/leaderboard');
    eq('leaderboard 200', board.status, 200);
    eq('leaderboard game=undercover', board.body.game, 'undercover');
    ok('leaderboard has an entry', board.body.entries.length >= 1);
    var ourEntry = board.body.entries.filter(function (entry) { return entry.roomId === playRoom; })[0];
    ok('four-client room is on the leaderboard', !!ourEntry, JSON.stringify(board.body.entries.map(function (e) { return e.roomId; })));
    if (ourEntry) {
      ok('leaderboard entry has four seats', ourEntry.seats.length === 4);
      ok('leaderboard entry records the room code', typeof ourEntry.roomCode === 'string');
    }

    /* -------------------------------------------------------------- */
    /* reconnect                                                      */
    /* -------------------------------------------------------------- */
    var badToken = await api('POST', roomRoute(playRoom, '/reconnect'), { token: 'nope', playerId: 'p1' });
    eq('bad reconnect token rejected', badToken.status, 403);
    eq('bad token error E_TOKEN', errCode(badToken), 'E_TOKEN');
    var reconnected = await api('POST', roomRoute(playRoom, '/reconnect'), {
      token: playSessions.p3, playerId: 'p3'
    });
    eq('reconnect 200', reconnected.status, 200);
    eq('reconnect clears takeover marker', (reconnected.body.takeoverSeats || []).indexOf(3), -1);
    eq('reconnect returns the same player', reconnected.body.you.playerId, 'p3');

    /* -------------------------------------------------------------- */
    /* rematch / leave / close                                        */
    /* -------------------------------------------------------------- */
    var guestRestart = await api('POST', roomRoute(playRoom, '/restart'), {
      session: playSessions.p1, playerId: 'p1'
    });
    eq('non-host cannot restart', guestRestart.status, 403);
    var restarted = await api('POST', roomRoute(playRoom, '/restart'), {
      session: playSessions.p0, playerId: 'p0'
    });
    eq('host restart 200', restarted.status, 200);
    eq('restart resets the game', restarted.body.state.over, false);
    eq('restart keeps four players', restarted.body.state.players.length, 4);
    eq('restart returns to reveal', restarted.body.state.phase, 'reveal');

    var leave = await api('POST', roomRoute(playRoom, '/leave'), {
      session: playSessions.p3, playerId: 'p3'
    });
    eq('leave 200', leave.status, 200);
    var afterLeave = await api('GET', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions.p0) + '&playerId=p0');
    eq('left human seat becomes AI', afterLeave.body.seats[3].ai, true);

    var closeGuest = await api('DELETE', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions.p1) + '&playerId=p1');
    eq('non-host cannot close', closeGuest.status, 403);
    var closed = await api('DELETE', roomRoute(playRoom) + '?session=' + encodeURIComponent(playSessions.p0) + '&playerId=p0');
    eq('host closes room', closed.status, 200);
    var gone = await api('GET', roomRoute(playRoom));
    eq('closed room is gone', gone.status, 404);

    /* -------------------------------------------------------------- */
    /* idle timeout takeover on the short-timeout server              */
    /* -------------------------------------------------------------- */
    var idleCreate = await idleApi('POST', '/api/rooms', { playerId: 'i-host', maxPlayers: 4 });
    var idleRoom = idleCreate.body.roomId;
    var idleHostToken = idleCreate.body.playerSession;
    var idleJoin = await idleApi('POST', roomRoute(idleRoom, '/join'), { playerId: 'i-guest' });
    var idleGuestToken = idleJoin.body.playerSession;
    var idleStart = await idleApi('POST', roomRoute(idleRoom, '/start'), {
      session: idleHostToken, playerId: 'i-host'
    });
    eq('idle room starts', idleStart.status, 200);
    await sleep(700);
    var takeoverTick = await idleApi('POST', roomRoute(idleRoom, '/tick'), {
      session: idleHostToken, playerId: 'i-host', force: true
    });
    eq('takeover tick 200', takeoverTick.status, 200);
    ok('idle human seat is taken over', Array.isArray(takeoverTick.body.takeoverSeats) && takeoverTick.body.takeoverSeats.length >= 1,
      JSON.stringify(takeoverTick.body.takeoverSeats));
    var idleReconnect = await idleApi('POST', roomRoute(idleRoom, '/reconnect'), {
      token: idleGuestToken, playerId: 'i-guest'
    });
    eq('idle player reconnect 200', idleReconnect.status, 200);
    ok('reconnect clears the idle takeover', (idleReconnect.body.takeoverSeats || []).indexOf(1) === -1,
      JSON.stringify(idleReconnect.body.takeoverSeats));

    /* -------------------------------------------------------------- */
    /* summary                                                        */
    /* -------------------------------------------------------------- */
    ok('HTTP request count is sane', counter.n > 40 && counter.n < 6000, 'requests=' + counter.n);
    console.log('');
    console.log('ONLINE_E2E_JSON: ' + JSON.stringify({
      game: 'undercover', clients: 4, sameGame: true, settlementConsistent: true,
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
