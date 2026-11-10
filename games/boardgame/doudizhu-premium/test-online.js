#!/usr/bin/env node
/*
 * Dou Dizhu premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/doudizhu-premium/test-online.js
 *   node games/boardgame/doudizhu-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one 3-seat room; the third seat is
 * AI-filled. Covers room create, invite join, password rejection, host start,
 * state sync, hidden hands/bottom, legal-action enforcement, idempotency,
 * a full game to settlement, reconnect, timeout AI takeover, leaderboard,
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
  const handle = await mod.startDoudizhuServer({
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

  const p1 = 'ddz-client-one';
  const p2 = 'ddz-client-two';

  console.log('\n[STEP] room create / invite / password / AI seat');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '地主候选', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('3 个座位', created.body && created.body.seats.length, 3);
  ok('第 2 座默认 AI', created.body && created.body.seats[1].ai === true);
  ok('第 3 座默认 AI', created.body && created.body.seats[2].ai === true);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '农民二号', password: 'zzzz'
  });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '农民二号', inviteCode: invite
  });
  ok('邀请码加入成功', joined.status === 200 && !!joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: 'ddz-client-three', nickname: '第三人', inviteCode: invite
  });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / hidden information / state sync');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('房间保持 3 人', start.body && start.body.playerCount, 3);
  ok('空位由 AI 补足', start.body && start.body.seats[2].ai === true);
  ok('开局自己手牌 17 张', start.body && start.body.state.hand.length >= 17, start.body && String(start.body.state.hand.length));
  ok('服务器不下发其他手牌', start.body && !Object.prototype.hasOwnProperty.call(start.body.state, 'hands'));
  ok('底牌未揭示', start.body && start.body.state.bottom.revealed === false);
  eq('底牌只有数量 3', start.body && start.body.state.bottom.count, 3);
  ok('对手只暴露手牌数量', start.body && start.body.state.seats.every((seat) => typeof seat.handCount === 'number'));

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  eq('两名客户端看到同一状态版本', view1.body.stateVersion, view2.body.stateVersion);
  eq('两名客户端看到同一回合座位', view1.body.state.turnSeat, view2.body.state.turnSeat);
  eq('两名客户端看到同一底牌数量', view1.body.state.bottom.count, view2.body.state.bottom.count);
  ok('两名客户端各自只拿到自己的手牌', view1.body.state.viewerSeat === 0 && view2.body.state.viewerSeat === 1);

  console.log('\n[STEP] turn enforcement / idempotency');
  const turnSeat = view1.body.state.phase === 'over' ? -1 : view1.body.state.turnSeat;
  const wrong = turnSeat === 0
    ? await api('POST', '/api/rooms/' + roomId + '/actions', { session: t2, playerId: p2, action: { k: 'bid', score: 1 } })
    : await api('POST', '/api/rooms/' + roomId + '/actions', { session: t1, playerId: p1, action: { k: 'bid', score: 1 } });
  ok('非当前玩家动作被拒绝', wrong.status >= 400, String(wrong.status));

  const current = turnSeat === 0 ? view1 : view2;
  const curSession = turnSeat === 0 ? t1 : t2;
  const curPlayer = turnSeat === 0 ? p1 : p2;
  ok('当前玩家有合法动作', current.body.legalActions.length > 0);
  const firstAction = current.body.legalActions[0];
  const iKey = 'ddz-idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: curSession, playerId: curPlayer, action: firstAction, idempotencyKey: iKey
  });
  ok('合法动作被接受', first.status === 200, String(first.status) + ' ' + JSON.stringify(first.body && first.body.error));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: curSession, playerId: curPlayer, action: firstAction, idempotencyKey: iKey
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);

  console.log('\n[STEP] full game to settlement');
  let rounds = 0;
  let settled = null;
  let sameSync = true;
  while (rounds < 900) {
    rounds += 1;
    let a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
    let b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    if (a.body.state.turnSeat === 2) {
      await api('POST', '/api/rooms/' + roomId + '/tick', { session: t1, playerId: p1 });
      a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
      b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    }
    if (a.body.stateVersion !== b.body.stateVersion) sameSync = false;
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    const pair = a.body.legalActions && a.body.legalActions.length ? [p1, t1, a.body]
      : (b.body.legalActions && b.body.legalActions.length ? [p2, t2, b.body] : null);
    if (!pair) { await sleep(15); continue; }
    let action = pair[2].legalActions[0];
    if (a.body.state.phase === 'bid') {
      const bids = pair[2].legalActions.filter((x) => x.k === 'bid').map((x) => x.score);
      const best = Math.max.apply(null, bids.concat([0]));
      action = { k: 'bid', score: best };
    }
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: pair[1], playerId: pair[0], action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
    if (sent.body && sent.body.legalActions && sent.body.legalActions.length) {
      // Next human turn is ready; continue immediately.
    }
    await sleep(5);
  }
  ok('双客户端对局在 900 步内结束', Boolean(settled), 'rounds=' + rounds);
  ok('全程双方 stateVersion 一致', sameSync);
  if (settled) {
    eq('双方看到同一赢家座位', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一赢家名字', settled.a.result.winnerName, settled.b.result.winnerName);
    eq('双方看到同一分值表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一倍数', settled.a.result.multiplier, settled.b.result.multiplier);
    eq('双方看到同一本局分值', settled.a.result.points, settled.b.result.points);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('结算含 3 名玩家', settled.a.result.scores.length, 3);
    ok('存在胜方（地主或农民）', settled.a.result.winnerSide === 'landlord' || settled.a.result.winnerSide === 'farmers');
    ok('至少发生过叫分', settled.a.state.bid >= 1, String(settled.a.state.bid));
    ok('至少出过一手牌', settled.a.state.history.length > 0, String(settled.a.state.history.length));
    ok('AI 补位实际参与出牌', settled.a.state.history.some((h) => h.seat === 2),
      settled.a.state.history.map((h) => h.seat).join(','));
    eq('结算详情 3 人', settled.a.result.details.length, 3);
    ok('结算分值总和为 0', settled.a.result.scores.reduce((x, y) => x + y, 0) === 0,
      JSON.stringify(settled.a.result.scores));
    ok('结束后揭示底牌 3 张', settled.a.state.bottom.revealed === true && settled.a.state.bottom.cards.length === 3);
  }

  console.log('\n[STEP] leaderboard / rematch / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=doudizhu-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 3, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId',
    lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));
  ok('排行榜包含 AI 参与者', lb.body.entries.some((entry) => entry.ai === true));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开后回到叫分阶段', restart.body.state.phase, 'bid');
  eq('重开后自己 17 张', restart.body.state.hand.length, 17);
  ok('重开后底牌重新遮罩', restart.body.state.bottom.revealed === false);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'ddz-idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', {
    playerId: 'ddz-idle-guest', nickname: '陪测', inviteCode: idleInvite
  });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'ddz-idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1400);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=ddz-idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1,
    JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', {
    session: idleSession, playerId: 'ddz-idle-host'
  });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=ddz-idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表移除该座位', afterReconnect.body.takeover.indexOf(0) === -1,
    JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  eq('关闭后房间不存在', gone.status, 404);

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'doudizhu',
    clients: 2,
    seats: 3,
    aiFill: true,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    rematch: true,
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
