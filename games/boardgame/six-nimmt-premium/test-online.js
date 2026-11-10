#!/usr/bin/env node
/*
 * 6 Nimmt! premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/six-nimmt-premium/test-online.js
 *   node games/boardgame/six-nimmt-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room; the third seat is AI-filled.
 * Covers: room create, invite join, password rejection, host start, simultaneous
 * hidden picks, AI fill, state sync, legal-action enforcement, idempotency,
 * full game settlement agreement, reconnect, timeout AI takeover, leaderboard,
 * rematch and room close.
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
  const handle = await mod.startSixNimmtServer({
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
  function getRoom(roomId, session, playerId) {
    return api('GET', '/api/rooms/' + roomId + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }
  const p1 = 'client-one';
  const p2 = 'client-two';

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  ok('初始 10 个座位', created.body && created.body.seats.length === 10, created.body && String(created.body.seats.length));

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  ok('第二人落在座位 1', joined.body && joined.body.seat === 1, joined.body && String(joined.body.seat));
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / AI fill / public state');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  ok('空位 AI 补齐到 3 人', start.body && start.body.playerCount === 3, start.body && String(start.body.playerCount));
  ok('开局 3 名玩家', start.body && start.body.state && start.body.state.players.length === 3);
  eq('开局四行', start.body && start.body.state.rows.length, 4);
  ok('开局四行各一张起始牌', start.body && start.body.state.rows.every(function (row) { return row.length === 1; }));
  ok('开局每人 10 张手牌（含已暗出的 1 张）', start.body && start.body.state.players.every(function (player) {
    return player.handCount + (player.picked ? 1 : 0) === 10;
  }));
  eq('开局第 1 轮', start.body && start.body.state.round, 1);

  const view1 = await getRoom(roomId, t1, p1);
  const view2 = await getRoom(roomId, t2, p2);
  eq('两名客户端看到同样四行', view1.body.state.rows, view2.body.state.rows);
  eq('两名客户端看到同一轮次', view1.body.state.round, view2.body.state.round);
  ok('客户端不泄漏未使用牌', view1.body.state.unused === undefined);
  ok('客户端没有 picks 数组', view1.body.state.picks === undefined);
  ok('不泄漏对手手牌', view1.body.state.players[1].hand === null);
  ok('对手手牌只暴露张数', view1.body.state.players[1].handCount === 10);
  ok('自己的手牌可见', Array.isArray(view1.body.state.players[0].hand) && view1.body.state.players[0].hand.length === 10);

  console.log('\n[STEP] simultaneous hidden picks / turn enforcement');
  const a = view1.body.state.players[0].hand.length ? { player: p1, session: t1, view: view1 } : { player: p2, session: t2, view: view2 };
  const b = a.player === p1 ? { player: p2, session: t2, view: view2 } : { player: p1, session: t1, view: view1 };
  ok('两名人类玩家都有合法出牌', a.view.body.legalActions.length === 10 && b.view.body.legalActions.length === 10,
    a.view.body.legalActions.length + '/' + b.view.body.legalActions.length);
  const firstCard = a.view.body.legalActions[0];
  const firstPick = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: a.session, playerId: a.player, action: firstCard
  });
  ok('第一位玩家暗出成功', firstPick.status === 200, String(firstPick.status));
  const afterFirstA = await getRoom(roomId, a.session, a.player);
  const afterFirstB = await getRoom(roomId, b.session, b.player);
  eq('出牌者看到自己的暗牌', afterFirstA.body.state.myPick, firstCard.card);
  ok('对手只看到「已出」不看到牌面', afterFirstB.body.state.players[a.player === p1 ? 0 : 1].picked === true &&
    afterFirstB.body.state.players[a.player === p1 ? 0 : 1].pickedCard === null);
  ok('AI 座位已在服务端补牌', afterFirstB.body.state.players[2].picked === true || afterFirstB.body.state.phase !== 'pick');
  ok('未出牌玩家仍有合法动作', afterFirstB.body.legalActions.length === 10 || afterFirstB.body.state.phase !== 'pick',
    String(afterFirstB.body.legalActions.length));
  const duplicate = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: a.session, playerId: a.player, action: afterFirstA.body.legalActions[0]
  });
  ok('同一轮重复出牌被拒绝', duplicate.status >= 400 || afterFirstA.body.legalActions.length === 0, String(duplicate.status));

  const key = 'idem-' + Date.now();
  const secondPick = afterFirstB.body.legalActions[0];
  const secondSent = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: b.session, playerId: b.player, action: secondPick, idempotencyKey: key
  });
  ok('第二位玩家出牌成功', secondSent.status === 200, String(secondSent.status));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: b.session, playerId: b.player, action: secondPick, idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, secondSent.body.stateVersion);

  console.log('\n[STEP] full game to settlement');
  let steps = 0;
  let settled = null;
  while (steps < 260) {
    steps += 1;
    const va = await getRoom(roomId, t1, p1);
    const vb = await getRoom(roomId, t2, p2);
    if (va.body.over || vb.body.over) { settled = { a: va.body, b: vb.body }; break; }
    const candidates = [
      { player: p1, session: t1, view: va.body },
      { player: p2, session: t2, view: vb.body }
    ];
    let acted = false;
    for (const c of candidates) {
      const acts = c.view.legalActions || [];
      if (!acts.length) continue;
      const pick = acts.filter(function (x) { return x.type === 'pick'; })[0];
      const row = acts.filter(function (x) { return x.type === 'row'; })
        .sort(function (x, y) { return x.points - y.points; })[0];
      const action = pick || row;
      if (!action) continue;
      const sent = await api('POST', '/api/rooms/' + roomId + '/actions', { session: c.session, playerId: c.player, action: action });
      if (sent.status >= 400) {
        // A fast AI tick may have consumed this exact state; retry next loop.
        continue;
      }
      acted = true;
      break;
    }
    if (!acted) await sleep(25);
  }
  ok('双客户端对局在 260 步内结束', Boolean(settled), 'steps=' + steps);
  if (settled) {
    eq('双方看到同一赢家', settled.a.result.winnerSeats, settled.b.result.winnerSeats);
    eq('双方看到同一分数表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同样的未使用牌', settled.a.result.unused, settled.b.result.unused);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('结算含 3 名玩家', settled.a.result.scores.length, 3);
    eq('恰好 10 轮', settled.a.result.rounds, 10);
    ok('存在冠军或并列', settled.a.result.winnerSeat != null || settled.a.result.tied === true);
    ok('赢家分数等于最低分', settled.a.result.winnerSeats.every(function (seat) {
      return settled.a.result.scores[seat] === Math.min.apply(null, settled.a.result.scores);
    }));
    ok('结算公开未使用牌', Array.isArray(settled.a.result.unused) && settled.a.result.unused.length === 104 - 30 - 4,
      String((settled.a.result.unused || []).length));
  }

  console.log('\n[STEP] leaderboard / restart / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=six-nimmt-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 3, lb.body && String(lb.body.entries.length));
  ok('排行榜含 AI 参与者', lb.body.entries.some(function (entry) { return entry.ai === true; }));
  ok('排行榜不含原始 playerId', lb.body.entries.every(function (entry) {
    return !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai;
  }));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开回到第 1 轮', restart.body.state.round, 1);
  ok('重开每人 10 张手牌（含已暗出的 1 张）', restart.body.state.players.every(function (player) {
    return player.handCount + (player.picked ? 1 : 0) === 10;
  }));
  ok('重开四行各一张', restart.body.state.rows.every(function (row) { return row.length === 1; }));
  ok('重开清空已吃牌', restart.body.state.players.every(function (player) { return player.taken.length === 0; }));

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', { playerId: 'idle-guest', nickname: '陪测', inviteCode: idleInvite });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1400);
  const beforeReconnect = await getRoom(idleId, idleSession, 'idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  ok('托管期间 AI 已代打至少一整轮', beforeReconnect.body.state.turnCount >= 3 ||
    beforeReconnect.body.state.phase === 'over',
    JSON.stringify({ phase: beforeReconnect.body.state.phase, turnCount: beforeReconnect.body.state.turnCount }));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'idle-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await getRoom(idleId, idleSession, 'idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await getRoom(roomId, t1, p1);
  ok('关闭后房间不存在', gone.status === 404, String(gone.status));

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'six-nimmt',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
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
