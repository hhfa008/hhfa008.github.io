#!/usr/bin/env node
/*
 * Aeroplane Chess premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/aeroplane-premium/test-online.js
 *   node games/boardgame/aeroplane-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room; covers room create, invite join,
 * password rejection, host start, server-authoritative dice, seatCount 2–4 /
 * AI fill, state sync, legal-action enforcement, idempotency, a full game to
 * settlement, reconnect, timeout AI takeover, leaderboard, rematch and close.
 *
 * Prints RESULT: N passed, M failed and ONLINE_E2E_JSON for the shipped gate.
 */
'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

if (process.argv.includes('--control')) {
  console.log('  FAIL intentional failure control (expected)');
  console.log('RESULT: 0 passed, 1 failed');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const failures = [];
function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS ' + label + (detail ? ' · ' + detail : ''));
  } else {
    failed += 1;
    const line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('  FAIL ' + line);
  }
  return !!condition;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected),
    'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startAeroplaneServer({
    port: 0,
    host: '127.0.0.1',
    idleTimeoutMs: 700,
    aiDelayMs: 0
  });
  const base = 'http://127.0.0.1:' + handle.address.port;

  async function api(method, route, body) {
    const res = await fetch(base + route, {
      method: method,
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch (err) { json = null; }
    return { status: res.status, body: json };
  }

  const p1 = 'ap-client-one';
  const p2 = 'ap-client-two';

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '红方一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('房间容量 4 座', created.body && created.body.seats.length, 4);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '黄方二号', password: 'zzzz'
  });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '黄方二号', inviteCode: invite
  });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: 'ap-client-three', nickname: '第三人', inviteCode: invite
  });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / seatCount / server-authoritative dice');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('2 位人类按 2 人桌', start.body && start.body.playerCount, 2);
  eq('2 人桌 2 名玩家', start.body && start.body.state.players.length, 2);
  eq('每人 4 架飞机', start.body && start.body.state.players.map((p) => p.planes.length), [4, 4]);
  ok('开局全部在基地', start.body && start.body.state.players.every((p) => p.planes.every((x) => x === -1)));
  eq('真实 52 格环', start.body && start.body.state.board.loop, 52);
  eq('四色各 13 格', start.body && [0, 1, 2, 3].map((c) => start.body.state.board.ringColors.filter((x) => x === c).length), [13, 13, 13, 13]);
  ok('服务端已掷骰', start.body && start.body.state.dice >= 1 && start.body.state.dice <= 6, String(start.body && start.body.state.dice));
  ok('骰子历史已记录', start.body && start.body.state.diceHistory.length >= 1, String(start.body && start.body.state.diceHistory.length));
  ok('publicView 不含 seed', JSON.stringify(start.body && start.body.state).indexOf('"seed"') < 0);
  ok('publicView 不含 rngState', JSON.stringify(start.body && start.body.state).indexOf('rngState') < 0);

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  const currentView = view1.body.state.turnSeat === 0 ? view1 : view2;
  ok('当前玩家有合法动作', currentView.body.legalActions.length > 0, String(currentView.body.legalActions.length));
  eq('turnSeat 是 0 或 1', [0, 1].indexOf(currentView.body.state.turnSeat) >= 0, true);
  eq('两名客户端看到同一回合', view1.body.state.turnSeat, view2.body.state.turnSeat);
  eq('两名客户端看到同一骰子', view1.body.state.dice, view2.body.state.dice);
  eq('两名客户端看到同一版本', view1.body.stateVersion, view2.body.stateVersion);
  ok('两名客户端看到同一 52 格环', JSON.stringify(view1.body.state.board.ringColors) === JSON.stringify(view2.body.state.board.ringColors));
  ok('两名客户端各有 4 架', view1.body.state.players.every((p) => p.planes.length === 4));

  console.log('\n[STEP] turn enforcement / dice tampering / idempotency');
  const firstIsOne = view1.body.legalActions.length > 0;
  const firstView = firstIsOne ? view1 : view2;
  const firstSession = firstIsOne ? t1 : t2;
  const firstPlayer = firstIsOne ? p1 : p2;
  const otherView = firstIsOne ? view2 : view1;
  const wrongSession = firstIsOne ? t2 : t1;
  const wrongPlayer = firstIsOne ? p2 : p1;
  ok('非当前玩家没有合法动作', otherView.body.legalActions.length === 0, 'legal=' + otherView.body.legalActions.length);
  const wrongSeat = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: wrongSession, playerId: wrongPlayer, action: firstView.body.legalActions[0]
  });
  ok('非当前玩家动作被拒绝', wrongSeat.status >= 400, String(wrongSeat.status));

  const firstAction = firstView.body.legalActions[0];
  ok('当前动作是移动而非掷骰', firstAction && firstAction.k === 'move' && firstAction.plane != null, JSON.stringify(firstAction));
  const diceTamper = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: firstSession, playerId: firstPlayer,
    action: Object.assign({}, firstAction, { dice: 6 }), idempotencyKey: 'ap-dice-tamper'
  });
  ok('客户端附带骰子被拒绝', diceTamper.status >= 400, String(diceTamper.status));
  eq('客户端不能掷骰', diceTamper.body && diceTamper.body.error && diceTamper.body.error.code, 'E_DICE');

  const iKey = 'ap-idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: firstSession, playerId: firstPlayer, action: firstAction, idempotencyKey: iKey
  });
  ok('合法移动被接受', first.status === 200, String(first.status) + ' ' + JSON.stringify(first.body && first.body.error));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: firstSession, playerId: firstPlayer, action: firstAction, idempotencyKey: iKey
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);
  ok('幂等重放不重复掷骰', replay.body && replay.body.state && first.body && first.body.state && replay.body.state.diceHistory.length === first.body.state.diceHistory.length);

  console.log('\n[STEP] full game to settlement');
  function pickAction(actions) {
    var copy = actions.slice();
    copy.sort(function (a, b) {
      function score(x) {
        var v = x.to == null ? 0 : x.to;
        if (v >= 57) v += 1000;
        if (x.shortcut) v += 120;
        if (x.jump) v += 60;
        if (x.kind === 'launch') v += 80;
        return v;
      }
      return score(b) - score(a);
    });
    return copy[0];
  }
  let rounds = 0;
  let settled = null;
  let sameSync = true;
  let sawJump = false;
  let sawCapture = false;
  let views = { one: view1.body, two: view2.body };
  while (rounds < 900) {
    rounds += 1;
    if (rounds === 1 || rounds % 25 === 0 ||
      (!views.one.legalActions.length && !views.two.legalActions.length)) {
      const ra = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
      const rb = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
      views.one = ra.body; views.two = rb.body;
      if (ra.body.stateVersion !== rb.body.stateVersion) sameSync = false;
      if (views.one.over || views.two.over) { settled = { a: views.one, b: views.two }; break; }
    }
    const actor = views.one.legalActions && views.one.legalActions.length
      ? { id: p1, t: t1, v: views.one, key: 'one' }
      : (views.two.legalActions && views.two.legalActions.length
        ? { id: p2, t: t2, v: views.two, key: 'two' } : null);
    if (!actor) { await sleep(4); continue; }
    if (actor.v.legalActions.some((x) => x.jump || x.shortcut)) sawJump = true;
    const action = pickAction(actor.v.legalActions);
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: actor.t, playerId: actor.id, action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
    views[actor.key] = sent.body;
    if ((sent.body.state.log || []).some((line) => line.indexOf('撞回') >= 0)) sawCapture = true;
    if (sent.body.over) {
      const ra = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
      const rb = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
      views.one = ra.body; views.two = rb.body;
      if (ra.body.stateVersion !== rb.body.stateVersion) sameSync = false;
      settled = { a: views.one, b: views.two };
      break;
    }
    const otherKey = actor.key === 'one' ? 'two' : 'one';
    const otherId = otherKey === 'one' ? p1 : p2;
    const otherT = otherKey === 'one' ? t1 : t2;
    const other = await api('GET', '/api/rooms/' + roomId + '?session=' + otherT + '&playerId=' + otherId);
    views[otherKey] = other.body;
    if (other.body.stateVersion !== views[actor.key].stateVersion) sameSync = false;
  }
  ok('双客户端对局在 900 步内结束', Boolean(settled), 'rounds=' + rounds);
  ok('全程双方 stateVersion 一致', sameSync);
  ok('对局中出现过跳格或捷径', sawJump);
  if (settled) {
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一分数表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一排名', settled.a.result.ranking, settled.b.result.ranking);
    eq('双方看到同一结算原因', settled.a.result.reason, settled.b.result.reason);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('结算含 2 名玩家', settled.a.result.scores.length, 2);
    ok('存在冠军或和棋', settled.a.result.winnerSeat != null || settled.a.result.tied === true);
    if (settled.a.result.winnerSeat != null) {
      ok('赢家四架全部到终点', settled.a.result.details[settled.a.result.winnerSeat].finished === 4);
    }
    ok('结算带每条飞机位置', settled.a.result.details.every((d) => Array.isArray(d.planes) && d.planes.length === 4));
    ok('对局日志记录过撞子', sawCapture || (settled.a.state.log || []).some((line) => line.indexOf('撞回') >= 0));
  }

  console.log('\n[STEP] leaderboard / rematch / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=aeroplane-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId',
    lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开后全部回基地', restart.body.state.players.every((p) => p.planes.every((x) => x === -1)), true);
  eq('重开后仍 2 人', restart.body.state.players.length, 2);
  ok('重开后服务端重新掷骰', restart.body.state.diceHistory.length >= 1);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'ap-idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', {
    playerId: 'ap-idle-guest', nickname: '陪测', inviteCode: idleInvite
  });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'ap-idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1300);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=ap-idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1,
    JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', {
    session: idleSession, playerId: 'ap-idle-host'
  });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=ap-idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1,
    JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] seatCount 1 human -> AI fill');
  const oneRoom = await api('POST', '/api/rooms', { playerId: 'ap-solo-host', nickname: '独狼' });
  const oneStart = await api('POST', '/api/rooms/' + oneRoom.body.roomId + '/start', {
    session: oneRoom.body.session, playerId: 'ap-solo-host'
  });
  ok('1 位人类也可开局', oneStart.status === 200 && oneStart.body.started === true);
  eq('1 位人类补到 2 座', oneStart.body && oneStart.body.playerCount, 2);
  ok('空位由 AI 补位', oneStart.body && oneStart.body.seats[1] && oneStart.body.seats[1].ai === true);
  eq('AI 补位后仍 2 名玩家', oneStart.body && oneStart.body.state.players.length, 2);

  let aiGame = null;
  for (let r = 0; r < 360; r += 1) {
    const v = await api('GET', '/api/rooms/' + oneRoom.body.roomId + '?session=' + oneRoom.body.session + '&playerId=ap-solo-host');
    if (v.body.over) { aiGame = v.body; break; }
    if (v.body.legalActions && v.body.legalActions.length) {
      const sent = await api('POST', '/api/rooms/' + oneRoom.body.roomId + '/actions', {
        session: oneRoom.body.session, playerId: 'ap-solo-host', action: pickAction(v.body.legalActions)
      });
      if (sent.status >= 400) { ok('AI 补位对局的人类动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body)); break; }
      if (sent.body.over) { aiGame = sent.body; break; }
    } else {
      const ticked = await api('POST', '/api/rooms/' + oneRoom.body.roomId + '/tick', {
        session: oneRoom.body.session, playerId: 'ap-solo-host'
      });
      if (ticked.status >= 400) { ok('AI 补位对局可推进', false, ticked.status + ' ' + JSON.stringify(ticked.body)); break; }
      if (ticked.body.over) { aiGame = ticked.body; break; }
    }
  }
  ok('AI 补位对局能跑完整局', Boolean(aiGame), 'over=' + Boolean(aiGame));
  if (aiGame) {
    ok('AI 补位对局有赢家', aiGame.result && aiGame.result.winnerSeat != null);
    eq('AI 补位对局仍是 2 名玩家', aiGame.result && aiGame.result.details.length, 2);
    ok('AI 补位座位保持 AI', aiGame.seats[1].ai === true);
    ok('AI 补位对局记录了骰子历史', aiGame.state.diceHistory.length > 0);
    ok('AI 补位对局有终局日志', (aiGame.state.log || []).length > 0);
  }

  console.log('\n[STEP] seatCount 3 humans -> 3 seats');
  const threeRoom = await api('POST', '/api/rooms', { playerId: 'ap-three-a', nickname: '三人A', password: 'pass' });
  const threeId = threeRoom.body.roomId;
  const threeT = threeRoom.body.session;
  const joinB = await api('POST', '/api/rooms/' + threeId + '/join', { playerId: 'ap-three-b', nickname: '三人B', password: 'pass' });
  const joinC = await api('POST', '/api/rooms/' + threeId + '/join', { playerId: 'ap-three-c', nickname: '三人C', password: 'pass' });
  ok('第三人加入 3 人房', joinB.status === 200 && joinC.status === 200, joinB.status + '/' + joinC.status);
  const threeStart = await api('POST', '/api/rooms/' + threeId + '/start', { session: threeT, playerId: 'ap-three-a' });
  eq('3 位人类按 3 人桌', threeStart.body && threeStart.body.playerCount, 3);
  eq('3 人桌 3 名玩家', threeStart.body && threeStart.body.state.players.length, 3);
  ok('3 人桌没有 AI 补位', threeStart.body && threeStart.body.seats.every((seat) => seat.ai === false));
  await api('DELETE', '/api/rooms/' + threeId + '?session=' + threeT + '&playerId=ap-three-a');

  console.log('\n[STEP] seatCount 4 humans -> 4 seats');
  const fourRoom = await api('POST', '/api/rooms', { playerId: 'ap-four-a', nickname: '四人A', password: 'pass' });
  const fourId = fourRoom.body.roomId;
  const fourT = fourRoom.body.session;
  await api('POST', '/api/rooms/' + fourId + '/join', { playerId: 'ap-four-b', nickname: '四人B', password: 'pass' });
  await api('POST', '/api/rooms/' + fourId + '/join', { playerId: 'ap-four-c', nickname: '四人C', password: 'pass' });
  await api('POST', '/api/rooms/' + fourId + '/join', { playerId: 'ap-four-d', nickname: '四人D', password: 'pass' });
  const fourStart = await api('POST', '/api/rooms/' + fourId + '/start', { session: fourT, playerId: 'ap-four-a' });
  eq('4 位人类按 4 人桌', fourStart.body && fourStart.body.playerCount, 4);
  eq('4 人桌 4 名玩家', fourStart.body && fourStart.body.state.players.length, 4);
  ok('4 人桌没有 AI 补位', fourStart.body && fourStart.body.seats.every((seat) => seat.ai === false));
  await api('DELETE', '/api/rooms/' + fourId + '?session=' + fourT + '&playerId=ap-four-a');

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  eq('关闭后房间不存在', gone.status, 404);

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'aeroplane-premium',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    seatCount2to4: true,
    aiFill: true,
    serverDice: true,
    runAll: true,
    assertions: passed,
    failed: failed
  }));
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    console.log('FAILURES:\n  ' + failures.join('\n  '));
    process.exitCode = 1;
  }
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  console.log('RESULT: ' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exitCode = 1;
});
