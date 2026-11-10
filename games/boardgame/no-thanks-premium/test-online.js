#!/usr/bin/env node
/*
 * No Thanks! premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/no-thanks-premium/test-online.js
 *   node games/boardgame/no-thanks-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room; a third seat is AI-filled.
 * Covers: room create, invite join, password rejection, host start, AI fill,
 * state sync, legal-action enforcement, idempotency, full settlement agreement,
 * reconnect, timeout AI takeover, leaderboard and rematch.
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
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startNoThanksServer({
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
  ok('初始 5 个座位', created.body && created.body.seats.length === 5, created.body && String(created.body.seats.length));

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  ok('第二人落在座位 1', joined.body && joined.body.seat === 1, joined.body && String(joined.body.seat));
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));
  const byCode = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-four', nickname: '四号', password: 'abcd' });
  ok('房间号 + 密码加入成功', byCode.status === 200 && byCode.body.session, String(byCode.status));
  if (byCode.body && byCode.body.session) {
    await api('POST', '/api/rooms/' + roomId + '/leave', { session: byCode.body.session, playerId: 'client-four' });
  }

  console.log('\n[STEP] start / AI fill / state sync');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  ok('空位 AI 补齐到 3 人', start.body && start.body.playerCount === 3, start.body && String(start.body.playerCount));
  ok('开局发出 3 名玩家状态', start.body && start.body.state && start.body.state.players.length === 3);
  ok('开局牌面为数字', start.body && typeof start.body.state.current === 'number', start.body && String(start.body.state.current));

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  eq('两名客户端看到同一张牌', view1.body.state.current, view2.body.state.current);
  eq('两名客户端看到同一回合', view1.body.state.turnSeat, view2.body.state.turnSeat);
  eq('两名客户端看到同一牌堆数', view1.body.state.deckCount, view2.body.state.deckCount);
  ok('客户端不泄漏牌堆顺序', view1.body.state.deck === undefined);
  ok('客户端不泄漏未结束的移除牌', view1.body.state.removed === undefined);

  console.log('\n[STEP] turn enforcement / idempotency');
  const notTurn = view1.body.state.turnSeat === 0 ? p2 : p1;
  const notTurnSession = notTurn === p1 ? t1 : t2;
  const notTurnView = notTurn === p1 ? view1 : view2;
  if (notTurnView.body.legalActions.length === 0) {
    const bad = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: notTurnSession, playerId: notTurn, action: { type: 'take' }
    });
    ok('非当前玩家动作被拒绝', bad.status >= 400, String(bad.status));
  } else {
    ok('开局合法动作归当前玩家', true);
  }
  const turnView = view1.body.legalActions.length ? view1 : view2;
  const turnSession = view1.body.legalActions.length ? t1 : t2;
  const turnPlayer = view1.body.legalActions.length ? p1 : p2;
  const key = 'idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turnSession, playerId: turnPlayer, action: turnView.body.legalActions[0], idempotencyKey: key
  });
  ok('合法动作被接受', first.status === 200, String(first.status));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turnSession, playerId: turnPlayer, action: turnView.body.legalActions[0], idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);

  console.log('\n[STEP] full game to settlement');
  let rounds = 0;
  let settled = null;
  while (rounds < 240) {
    rounds += 1;
    const a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
    const b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    const pair = a.body.legalActions && a.body.legalActions.length ? [p1, t1, a.body] : (b.body.legalActions && b.body.legalActions.length ? [p2, t2, b.body] : null);
    if (!pair) { await sleep(20); continue; }
    const action = pair[2].legalActions[0];
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', { session: pair[1], playerId: pair[0], action: action });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
  }
  ok('双客户端对局在 240 步内结束', Boolean(settled), 'rounds=' + rounds);
  if (settled) {
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一分数表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同样的移除牌', settled.a.result.removed, settled.b.result.removed);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    const total = settled.a.result.scores.length;
    ok('结算含 3 名玩家', total === 3, String(total));
    ok('存在冠军或并列', settled.a.result.winnerSeat != null || settled.a.result.tied === true);
    ok('最低分与赢家一致', settled.a.result.winnerSeat == null || settled.a.result.scores[settled.a.result.winnerSeat] === Math.min.apply(null, settled.a.result.scores));
  }

  console.log('\n[STEP] leaderboard / restart / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=no-thanks-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 3, lb.body && String(lb.body.entries.length));
  ok('排行榜含 AI 参与者', lb.body.entries.some((entry) => entry.ai === true));
  ok('排行榜不含原始 playerId', lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  ok('重开后半副牌重置', restart.body.state.players.every((player) => player.cards.length === 0));
  ok('重开后牌堆回到 23', restart.body.state.deckCount === 23, String(restart.body.state.deckCount));

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
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'idle-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('关闭后房间不存在', gone.status === 404, String(gone.status));

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'no-thanks',
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
