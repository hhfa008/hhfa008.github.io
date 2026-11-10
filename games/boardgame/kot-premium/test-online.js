'use strict';

/*
 * 东京妖都 — two-client online E2E.
 *
 *   node games/boardgame/kot-premium/test-online.js
 *
 * Starts the real Node HTTP room server on an ephemeral port and drives two
 * independent clients over fetch: create/join/invite, password/private rooms,
 * authoritative turn validation, state sync, AI fill, reconnect, idle
 * takeover, finish, leaderboard and restart. run-all.js discovers this file
 * because its name starts with "test". No browser / tmp Chrome is required.
 */

var path = require('path');
var { pathToFileURL } = require('url');

var passed = 0;
var failed = 0;
var failures = [];
var groups = [];
function check(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
  }
  return !!cond;
}
async function group(name, fn) {
  var p0 = passed, f0 = failed;
  try { await fn(); }
  catch (err) { failed += 1; failures.push(name + ' threw: ' + (err && err.stack || err)); }
  groups.push({ name: name, pass: passed - p0, fail: failed - f0 });
}
function eq(label, actual, expected) {
  return check(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

function hasMove(moves, move) {
  return (moves || []).some(function (m) {
    return m.type === move.type &&
      (move.index == null || m.index === move.index) &&
      (move.slot == null || m.slot === move.slot) &&
      (move.cardId == null || m.cardId === move.cardId) &&
      (move.leave == null || !!m.leave === !!move.leave);
  });
}

async function main() {
  var mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  var handle = await mod.startOnlineServer({
    port: 0, host: '127.0.0.1', idleTimeoutMs: 260, aiDelayMs: 0
  });
  var base = 'http://127.0.0.1:' + handle.address.port;
  var requests = 0;
  async function api(method, route, body) {
    requests += 1;
    var res = await fetch(base + route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    var text = await res.text();
    var data = null;
    try { data = JSON.parse(text); } catch (err) { data = null; }
    return { status: res.status, body: data, text: text };
  }
  function errCode(r) { return r.body && r.body.error && r.body.error.code; }

  try {
    var room1, t1, t2, invite1;

    await group('health + create/join/invite', async function () {
      var health = await api('GET', '/health');
      eq('health 200', health.status, 200);
      eq('health game=kot-premium', health.body.game, 'kot-premium');
      check('health 报告房间数', typeof health.body.rooms === 'number');

      var created = await api('POST', '/api/rooms', { playerId: 'p1', nickname: 'P1' });
      eq('创建房间 201', created.status, 201);
      room1 = created.body.roomId;
      t1 = created.body.playerSession;
      invite1 = created.body.inviteToken;
      check('创建返回 roomId', typeof room1 === 'string' && room1.length > 0);
      check('创建返回 host session', typeof t1 === 'string' && t1.length > 0);
      check('创建返回邀请 token', typeof invite1 === 'string' && invite1.length > 0);
      eq('创建后 4 个座位', created.body.seats.length, 4);
      eq('房主是 seat-0', created.body.seats[0].seat + ':' + created.body.seats[0].playerId, 'seat-0:p1');
      eq('其余 3 个空位是 AI', created.body.seats.slice(1).every(function (s) { return s.ai; }), true);

      var joined = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/join', {
        playerId: 'p2', nickname: 'P2', inviteCode: invite1
      });
      eq('邀请加入 200', joined.status, 200);
      t2 = joined.body.playerSession;
      eq('第二名玩家是 seat-1', joined.body.seats[1].seat + ':' + joined.body.seats[1].playerId, 'seat-1:p2');
      eq('空位继续由 AI 补足', joined.body.seats.slice(2).every(function (s) { return s.ai; }), true);

      var reuse = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/join', {
        playerId: 'p3', inviteCode: invite1
      });
      check('邀请 token 单次使用', reuse.status === 403, 'status=' + reuse.status);
      eq('重复邀请错误码 E_INVITE', errCode(reuse), 'E_INVITE');
    });

    await group('password + private + solo start', async function () {
      var created = await api('POST', '/api/rooms', {
        playerId: 'host', password: 'secret-1', visibility: 'private'
      });
      var room = created.body.roomId;
      var invite = created.body.inviteToken;
      eq('私有房创建 201', created.status, 201);

      var noAuth = await api('GET', '/api/rooms/' + encodeURIComponent(room));
      check('私有房无会话不可读', noAuth.status === 403, 'status=' + noAuth.status);
      eq('私有房错误码 E_PRIVATE', errCode(noAuth), 'E_PRIVATE');

      var wrong = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest', password: 'wrong-pass'
      });
      check('错误密码被拒绝', wrong.status === 403, 'status=' + wrong.status);
      eq('错误密码错误码 E_PASSWORD', errCode(wrong), 'E_PASSWORD');

      var right = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest', password: 'secret-1'
      });
      eq('正确密码加入 200', right.status, 200);
      var memberRead = await api('GET', '/api/rooms/' + encodeURIComponent(room) +
        '?session=' + encodeURIComponent(right.body.playerSession));
      eq('私密房成员可读', memberRead.status, 200);

      var inviteJoin = await api('POST', '/api/rooms/' + encodeURIComponent(room) + '/join', {
        playerId: 'guest2', inviteCode: invite
      });
      eq('邀请 token 绕过密码', inviteJoin.status, 200);

      var solo = await api('POST', '/api/rooms', { playerId: 'solo' });
      var startSolo = await api('POST', '/api/rooms/' + encodeURIComponent(solo.body.roomId) + '/start', {
        session: solo.body.playerSession
      });
      eq('单人开局 200', startSolo.status, 200);
      eq('单人开局 started', startSolo.body.started, true);
      eq('单人开局 AI 座位', startSolo.body.aiSeats.sort(), ['seat-1', 'seat-2', 'seat-3']);
    });

    await group('start + authoritative actions + state sync', async function () {
      var started = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/start', { session: t1 });
      eq('房主开始对局 200', started.status, 200);
      eq('对局状态 playing', started.body.status, 'playing');
      eq('4 名玩家（2 真人 + 2 AI）', started.body.state.players.length, 4);
      eq('2 个 AI 座位', started.body.aiSeats.sort(), ['seat-2', 'seat-3']);
      eq('开局 p0 先手', started.body.state.current, 0);
      eq('开局 rolling', started.body.state.phase, 'rolling');
      check('p1 收到合法动作', started.body.yourTurn === true && started.body.legalMoves.some(function (m) { return m.type === 'roll'; }));

      var p2View = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      eq('p2 非当前回合', p2View.body.yourTurn, false);
      eq('p2 无合法动作', p2View.body.legalMoves.length, 0);
      eq('双客户端看到同一生命', p2View.body.state.players.map(function (p) { return p.hp; }), started.body.state.players.map(function (p) { return p.hp; }));
      eq('双客户端看到同一牌库', p2View.body.state.deck.length, started.body.state.deck.length);

      var outOfTurn = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t2, action: { type: 'roll' }
      });
      check('非当前玩家动作被拒绝', outOfTurn.status === 409, 'status=' + outOfTurn.status);
      eq('非当前玩家错误码 E_TURN', errCode(outOfTurn), 'E_TURN');

      var rolled = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t1, action: { type: 'roll' }
      });
      eq('p1 掷骰 200', rolled.status, 200);
      eq('rollCount=1', rolled.body.state.rollCount, 1);
      check('p1 可以锁定', hasMove(rolled.body.legalMoves, { type: 'toggleLock', index: 0 }));

      var locked = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t1, action: { type: 'toggleLock', index: 0 }
      });
      eq('p1 锁定骰子 200', locked.status, 200);
      eq('骰子已锁定', locked.body.state.dice[0].locked, true);

      var illegal = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t1, action: { type: 'enterTokyo', slot: 'city' }
      });
      check('非法动作被拒绝', illegal.status === 422, 'status=' + illegal.status);
      eq('非法动作错误码 E_ACTION', errCode(illegal), 'E_ACTION');
    });

    await group('human turns + AI fill', async function () {
      // Finish p1's turn using only server-advertised legal moves.
      for (var i = 0; i < 24; i += 1) {
        var viewRes = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
        var v = viewRes.body;
        if (!v || !v.yourTurn || v.status === 'finished') break;
        var move = chooseMove(v);
        if (!move) break;
        var acted = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
          session: t1, action: move
        });
        check('p1 合法动作 ' + move.type + ' 200', acted.status === 200, 'status=' + acted.status);
      }
      var after = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      eq('回合推进到 p2 或 AI', after.body.state.gameOver || after.body.currentIndex >= 1, true);
      eq('p2 现在可以行动', after.body.yourTurn, true);
      check('p2 收到合法动作', after.body.legalMoves.length > 0);

      // p2 plays one advertised move; then AI seats are allowed to act.
      var p2move = chooseMove(after.body);
      var p2acted = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/actions', {
        session: t2, action: p2move
      });
      check('p2 合法动作 200', p2acted.status === 200, 'status=' + p2acted.status);
      var ticked = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/tick', {
        session: t1, force: true
      });
      eq('强制 tick 200', ticked.status, 200);
      check('AI 补位后局面仍同步', ticked.body.state.players.length === 4);
      check('AI 座位存在', ticked.body.aiSeats.length >= 2, JSON.stringify(ticked.body.aiSeats));
    });

    await group('reconnect + invalid token', async function () {
      var re = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/reconnect', {
        token: t2, playerId: 'p2'
      });
      eq('断线重连 200', re.status, 200);
      eq('重连保持 seat-1', re.body.you.seat, 'seat-1');
      eq('重连返回同一 session', re.body.playerSession, t2);
      var bad = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/reconnect', {
        token: 'not-a-real-token', playerId: 'p2'
      });
      check('无效 token 被拒绝', bad.status === 403, 'status=' + bad.status);
      eq('无效 token 错误码 E_TOKEN', errCode(bad), 'E_TOKEN');
    });

    await group('idle takeover + recovery', async function () {
      await sleep(420);
      var seen = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t2));
      check('超时座位进入托管', seen.body.takeoverSeats.length >= 1, JSON.stringify(seen.body.takeoverSeats));
      var recovered = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      eq('p1 轮询后托管解除', recovered.body.takeoverSeats.indexOf('seat-0'), -1);
      check('p1 仍是房主座位', recovered.body.you.seat === 'seat-0');
    });

    await group('finish + leaderboard + restart + close', async function () {
      await sleep(420);
      var finalView = null;
      for (var i = 0; i < 30; i += 1) {
        var ticked = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/tick', {
          session: t1, force: true
        });
        finalView = ticked.body;
        if (finalView && finalView.state && finalView.state.gameOver) break;
        await sleep(8);
      }
      check('AI 托管下对局终局', !!finalView && finalView.state && finalView.state.gameOver === true,
        JSON.stringify(finalView && finalView.state && { turn: finalView.state.turn, phase: finalView.state.phase }));
      check('终局有胜者', !!finalView && !!finalView.winner, finalView && finalView.winner);
      check('终局原因合法', finalView && (finalView.winReason === 'points' || finalView.winReason === 'last'));

      var board = await api('GET', '/api/leaderboard');
      eq('结果榜 200', board.status, 200);
      eq('结果榜 game=kot-premium', board.body.game, 'kot-premium');
      check('结果榜已入榜', board.body.entries.length >= 1, JSON.stringify(board.body.entries.length));
      var entry = board.body.entries[0];
      check('榜单记录胜者/4 名玩家/回合', !!entry && !!entry.winner && entry.players.length === 4 && entry.turns >= 1,
        JSON.stringify(entry && { winner: entry.winner, players: entry.players.length, turns: entry.turns }));

      var re = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/reconnect', {
        token: t1, playerId: 'p1'
      });
      eq('房主重连 200', re.status, 200);
      var restarted = await api('POST', '/api/rooms/' + encodeURIComponent(room1) + '/restart', {
        session: t1
      });
      eq('房主重开 200', restarted.status, 200);
      eq('重开后未终局', restarted.body.state.gameOver, false);
      eq('重开后回到第 1 回合', restarted.body.state.turn, 1);
      eq('重开后生命重置', restarted.body.state.players.map(function (p) { return p.hp; }), [10, 10, 10, 10]);

      var closed = await api('DELETE', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      eq('房主关闭房间 200', closed.status, 200);
      var gone = await api('GET', '/api/rooms/' + encodeURIComponent(room1) + '?session=' + encodeURIComponent(t1));
      check('关闭后房间 404', gone.status === 404, 'status=' + gone.status);
    });

    check('请求次数在合理范围', requests > 20 && requests < 2000, requests);
  } finally {
    await handle.close();
  }

  for (var i = 0; i < groups.length; i += 1) {
    var g = groups[i];
    console.log('[' + (g.fail === 0 ? 'PASS' : 'FAIL') + '] ' + g.name + ': ' + g.pass + ' 项断言, ' + g.fail + ' 失败');
  }
  if (failures.length) failures.slice(0, 30).forEach(function (f) { console.log('  FAIL: ' + f); });
  console.log('总计: ' + passed + ' 通过, ' + failed + ' 失败');
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) process.exitCode = 1;
}

function chooseMove(view) {
  var state = view.state;
  var legal = view.legalMoves || [];
  if (!state || !legal.length) return null;
  if (state.phase === 'rolling') {
    if (state.rollCount < 2 && hasMove(legal, { type: 'roll' })) return { type: 'roll' };
    if (hasMove(legal, { type: 'resolveRoll' })) return { type: 'resolveRoll' };
    if (hasMove(legal, { type: 'roll' })) return { type: 'roll' };
  }
  if (state.pending) {
    if (state.pending.type === 'enter') {
      var enter = legal.filter(function (m) { return m.type === 'enterTokyo'; })[0];
      if (enter) return enter;
      if (hasMove(legal, { type: 'skipEnter' })) return { type: 'skipEnter' };
    }
    if (state.pending.type === 'yield') {
      return legal.filter(function (m) { return m.type === 'yieldDecision' && !m.leave; })[0] || legal[0];
    }
  }
  if (state.phase === 'buy') {
    var buy = legal.filter(function (m) { return m.type === 'buyCard'; })[0];
    if (buy) return buy;
    if (hasMove(legal, { type: 'endTurn' })) return { type: 'endTurn' };
  }
  if (hasMove(legal, { type: 'resolveRoll' })) return { type: 'resolveRoll' };
  if (hasMove(legal, { type: 'roll' })) return { type: 'roll' };
  if (hasMove(legal, { type: 'endTurn' })) return { type: 'endTurn' };
  return legal[0] || null;
}

main().catch(function (err) {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
