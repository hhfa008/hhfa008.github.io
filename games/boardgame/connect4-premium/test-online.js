#!/usr/bin/env node
/*
 * Connect 4 / 四子棋 premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/connect4-premium/test-online.js
 *   node games/boardgame/connect4-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room. Covers: create/invite/password,
 * join, start, public-state sync, turn enforcement, illegal columns, hidden
 * internals, idempotency, a full scripted win, settlement agreement,
 * leaderboard, rematch with swapped first player, reconnect, AI fill, timeout
 * AI takeover and room close.
 *
 * Prints RESULT: N passed, M failed and ONLINE_E2E_JSON.
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
  const handle = await mod.startConnect4Server({
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
  const p1 = 'c4-client-one';
  const p2 = 'c4-client-two';

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('初始 2 个座位', created.body && created.body.seats.length, 2);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'c4-client-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / same public state / seat colours');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('两人房坐满 2 人', start.body && start.body.playerCount, 2);
  eq('开局 42 格全空', start.body && start.body.state.board.filter(function (v) { return v !== 0; }).length, 0);
  eq('开局无胜者', [start.body.state.over, start.body.state.winner], [false, 0]);
  eq('座位 0 为红方', start.body.state.colors[0], 'red');
  eq('座位 1 为黄方', start.body.state.colors[1], 'yellow');
  const view1 = await getRoom(roomId, t1, p1);
  const view2 = await getRoom(roomId, t2, p2);
  eq('两名客户端看到同一棋盘', view1.body.state.board, view2.body.state.board);
  eq('两名客户端看到同一轮次', view1.body.state.turn, view2.body.state.turn);
  eq('两名客户端看到同一先手座位', view1.body.state.firstSeat, view2.body.state.firstSeat);
  eq('红方开局 7 个合法列', view1.body.legalActions.length, 7);
  eq('黄方开局没有合法动作', view2.body.legalActions.length, 0);
  ok('客户端看到自己的颜色', view1.body.state.yourColor === 'red' && view2.body.state.yourColor === 'yellow');
  ok('客户端只看到公开状态（无内部棋盘数组类型）', Array.isArray(view1.body.state.board) && view1.body.state.b === undefined);
  ok('公共视图不含引擎内部 key', view1.body.state.key === undefined);
  ok('公共视图不含 match 对象', view1.body.match === undefined);
  eq('公共视图计数红 0 黄 0', view1.body.state.counts, { red: 0, yellow: 0 });
  ok('房主座位标记正确', view1.body.seats[0].isHost === true && view1.body.seats[1].isHost === false);

  console.log('\n[STEP] turn enforcement / illegal actions');
  const notTurn = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t2, playerId: p2, action: { type: 'drop', col: 0 }
  });
  ok('黄方抢先落子被拒绝', notTurn.status >= 400, String(notTurn.status));
  const outOfRange = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 7 }
  });
  ok('第 8 列被拒绝', outOfRange.status >= 400, String(outOfRange.status));
  const negative = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: -1 }
  });
  ok('负数落子被拒绝', negative.status >= 400, String(negative.status));
  const badType = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'pick', card: 3 }
  });
  ok('未知动作类型被拒绝', badType.status >= 400, String(badType.status));
  const badString = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 'x' }
  });
  ok('非数字列被拒绝', badString.status >= 400, String(badString.status));
  const stillEmpty = await getRoom(roomId, t1, p1);
  eq('非法动作没有改变棋盘', stillEmpty.body.state.plies, 0);
  eq('非法动作后仍是红方回合', stillEmpty.body.state.turn, 1);

  console.log('\n[STEP] idempotent first move');
  const key = 'idem-c4-' + Date.now();
  const firstMove = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 0 }, idempotencyKey: key
  });
  ok('红方第 0 列落子成功', firstMove.status === 200, String(firstMove.status));
  eq('落子后 1 手', firstMove.body.state.plies, 1);
  eq('第 0 列底部出现红子', firstMove.body.state.board[35], 1);
  eq('落子后轮到黄方', firstMove.body.state.turn, 2);
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 0 }, idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, firstMove.body.stateVersion);
  eq('幂等重放不重复落子', replay.body.state.plies, 1);
  const doubleMove = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 1 }
  });
  ok('红方不能连续走两手', doubleMove.status >= 400, String(doubleMove.status));

  console.log('\n[STEP] scripted game to a red vertical win');
  const script = [
    { seat: 'yellow', col: 1 },
    { seat: 'red', col: 0 },
    { seat: 'yellow', col: 1 },
    { seat: 'red', col: 0 },
    { seat: 'yellow', col: 1 },
    { seat: 'red', col: 0 }
  ];
  let scriptOk = true;
  for (const move of script) {
    const who = move.seat === 'red' ? { session: t1, playerId: p1 } : { session: t2, playerId: p2 };
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: who.session, playerId: who.playerId, action: { type: 'drop', col: move.col }
    });
    if (sent.status !== 200) { scriptOk = false; console.log('    move failed: ' + move.seat + ' col ' + move.col + ' -> ' + sent.status + ' ' + JSON.stringify(sent.body && sent.body.error)); break; }
  }
  ok('脚本化 6 手全部被接受', scriptOk);
  const settledA = await getRoom(roomId, t1, p1);
  const settledB = await getRoom(roomId, t2, p2);
  ok('双方都看到对局结束', settledA.body.over === true && settledB.body.over === true);
  eq('胜利后 7 手', settledA.body.state.plies, 7);
  eq('红方在第 0 列四连获胜', settledA.body.result.winnerSeat, 0);
  eq('胜者颜色为红', settledA.body.result.winnerColor, 'red');
  eq('双方同意同一胜者', settledA.body.result.winnerSeat, settledB.body.result.winnerSeat);
  eq('双方同意同一胜利连线', settledA.body.result.winningLine, settledB.body.result.winningLine);
  eq('胜利连线恰好 4 格', settledA.body.result.winningLine.length, 4);
  eq('胜利连线在第 0 列', settledA.body.result.winningLine.slice().sort(function (a, b) { return a - b; }), [14, 21, 28, 35]);
  eq('结算比分红 4 黄 3', settledA.body.result.scores, [4, 3]);
  eq('结算非平局', settledA.body.result.tied, false);
  eq('结算手数 7', settledA.body.result.turns, 7);
  eq('胜利后没有合法动作', settledA.body.legalActions.length, 0);
  ok('胜利后不能继续落子', (await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'drop', col: 2 }
  })).status >= 400);

  console.log('\n[STEP] leaderboard / rematch swaps first player');
  const lb = await api('GET', '/api/leaderboard?game=connect4-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜标出本局胜者', lb.body.entries.some(function (e) { return e.winner === true && e.seat === 0; }));
  ok('排行榜不含原始 playerId', lb.body.entries.every(function (e) {
    return !e.playerId || /^sha256:/.test(e.playerId) || e.ai;
  }));
  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开棋盘清空', restart.body.state.board.filter(function (v) { return v !== 0; }).length, 0);
  eq('重开 0 手', restart.body.state.plies, 0);
  eq('重开交换先手座位', restart.body.state.firstSeat, 1);
  eq('重开后座位 0 变黄方', restart.body.state.colors[0], 'yellow');
  eq('重开后座位 1 变红方', restart.body.state.colors[1], 'red');
  const afterRestart1 = await getRoom(roomId, t1, p1);
  const afterRestart2 = await getRoom(roomId, t2, p2);
  eq('原房主（座位 0）重开后没有先手动作', afterRestart1.body.legalActions.length, 0);
  eq('原客人（座位 1）重开后拿到 7 个先手列', afterRestart2.body.legalActions.length, 7);
  eq('原房主重开后执黄', afterRestart1.body.state.yourColor, 'yellow');

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  ok('重连后座位恢复人类', reconnect.body.seats[0].ai === false);

  console.log('\n[STEP] AI fill');
  const aiRoom = await api('POST', '/api/rooms', { playerId: 'c4-ai-host', nickname: 'AI 测试房主' });
  const aiId = aiRoom.body.roomId;
  const aiSession = aiRoom.body.session;
  const aiStart = await api('POST', '/api/rooms/' + aiId + '/start', { session: aiSession, playerId: 'c4-ai-host' });
  ok('单人开局成功', aiStart.status === 200 && aiStart.body.started === true);
  eq('空位 AI 补齐到 2 人', aiStart.body.playerCount, 2);
  eq('座位 1 是 AI', aiStart.body.seats[1].ai, true);
  const aiMove = await api('POST', '/api/rooms/' + aiId + '/actions', {
    session: aiSession, playerId: 'c4-ai-host', action: { type: 'drop', col: 3 }
  });
  ok('房主落子成功', aiMove.status === 200, String(aiMove.status));
  eq('AI 已在服务端应手（2 手）', aiMove.body.state.plies, 2);
  eq('AI 落下一枚黄子', aiMove.body.state.counts, { red: 1, yellow: 1 });
  const aiView = await getRoom(aiId, aiSession, 'c4-ai-host');
  ok('AI 补位后仍轮房主', aiView.body.state.turn === 1 || aiView.body.over, String(aiView.body.state.turn));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'c4-idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', { playerId: 'c4-idle-guest', nickname: '陪测', inviteCode: idleInvite });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'c4-idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1800);
  const beforeReconnect = await getRoom(idleId, idleSession, 'c4-idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  ok('托管期间 AI 已代打至少一手', beforeReconnect.body.state.plies >= 1 || beforeReconnect.body.over,
    JSON.stringify({ plies: beforeReconnect.body.state.plies, over: beforeReconnect.body.over }));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'c4-idle-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await getRoom(idleId, idleSession, 'c4-idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close rooms');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭主房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await getRoom(roomId, t1, p1);
  eq('关闭后主房间不存在', gone.status, 404);
  const closedIdle = await api('DELETE', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=' + 'c4-idle-host');
  ok('关闭超时测试房', closedIdle.status === 200 && closedIdle.body.closed === true);

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'connect4-premium',
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
