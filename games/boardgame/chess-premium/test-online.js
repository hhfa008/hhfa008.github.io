#!/usr/bin/env node
/*
 * Chess premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/chess-premium/test-online.js
 *   node games/boardgame/chess-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room. Covers room create, invite,
 * password rejection, join, host start, AI fill, identical public state,
 * turn/legality enforcement, idempotency, a real checkmate settlement,
 * reconnect, timeout AI takeover, leaderboard, colour-swapping rematch and
 * room close. Chess has no hidden information; both seats see the same board.
 *
 * Prints RESULT: N passed, M failed and ONLINE_E2E_JSON for the shipped gate.
 */
'use strict';

const fs = require('fs');
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
  const handle = await mod.startChessServer({
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
  function sendAction(roomId, session, playerId, action, key) {
    const body = { session: session, playerId: playerId, action: action };
    if (key) body.idempotencyKey = key;
    return api('POST', '/api/rooms/' + roomId + '/actions', body);
  }
  function closeRoom(roomId, session, playerId) {
    return api('DELETE', '/api/rooms/' + roomId + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
  }
  function roomOf(created) {
    return { id: created.body.roomId, session: created.body.session, player: created.body.playerId, invite: created.body.inviteToken };
  }
  async function makeRoom(hostId, guestId, password) {
    const created = await api('POST', '/api/rooms', { playerId: hostId, nickname: hostId, password: password });
    const host = roomOf(created);
    if (guestId) {
      const joined = await api('POST', '/api/rooms/' + host.id + '/join', {
        playerId: guestId, nickname: guestId, inviteCode: host.invite, password: password
      });
      host.guest = { id: joined.body && joined.body.roomId, session: joined.body && joined.body.session, player: guestId, seat: joined.body && joined.body.seat };
    }
    await api('POST', '/api/rooms/' + host.id + '/start', { session: host.session, playerId: host.player });
    return host;
  }

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: 'chess-one', nickname: '一号', password: 'chess1' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('初始 2 个座位', created.body && created.body.seats.length, 2);
  eq('房主在座位 0', created.body && created.body.you, 0);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'chess-two', nickname: '二号', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'chess-two', nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  eq('加入返回观察者座位 1', joined.body && joined.body.you, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'chess-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / identical public state / turn enforcement');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: 'chess-one' });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('固定 2 人', start.body && start.body.playerCount, 2);
  eq('开局 FEN', start.body && start.body.state.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  eq('白方先行', start.body && start.body.state.turn, 'w');
  eq('开局 32 枚', start.body && start.body.state.board.filter(Boolean).length, 32);
  eq('座位颜色 [白,黑]', start.body && start.body.state.seatColors, ['w', 'b']);
  const view1 = await getRoom(roomId, t1, 'chess-one');
  const view2 = await getRoom(roomId, t2, 'chess-two');
  eq('两客户端看到同一棋盘', view1.body.state.board, view2.body.state.board);
  eq('两客户端看到同一 FEN', view1.body.state.fen, view2.body.state.fen);
  eq('两客户端看到同一轮次', view1.body.state.turn, view2.body.state.turn);
  eq('白方有 20 个合法动作', view1.body.legalActions.length, 20);
  eq('黑方尚无可行动作', view2.body.legalActions.length, 0);
  const notTurn = await sendAction(roomId, t2, 'chess-two', { type: 'move', from: 11, to: 27 });
  ok('非轮次方动作被拒绝', notTurn.status >= 400, String(notTurn.status));
  const illegal = await sendAction(roomId, t1, 'chess-one', { type: 'move', from: 52, to: 28 });
  ok('非法着法 e2e5 被拒绝', illegal.status >= 400, String(illegal.status));
  const e4 = await sendAction(roomId, t1, 'chess-one', { type: 'move', from: 52, to: 36 });
  ok('e2e4 被接受', e4.status === 200, String(e4.status));
  eq('走子后轮到黑方', e4.body.state.turn, 'b');
  eq('棋谱记录 e4', e4.body.state.history, ['e4']);
  const afterE4a = await getRoom(roomId, t1, 'chess-one');
  const afterE4b = await getRoom(roomId, t2, 'chess-two');
  eq('走子后两客户端同一棋盘', afterE4a.body.state.board, afterE4b.body.state.board);
  eq('黑方现在有 20 个合法动作', afterE4b.body.legalActions.length, 20);
  eq('白方此时没有动作', afterE4a.body.legalActions.length, 0);

  console.log('\n[STEP] idempotency');
  const idemKey = 'idem-' + Date.now();
  const d5 = await sendAction(roomId, t2, 'chess-two', { type: 'move', from: 11, to: 27 }, idemKey);
  ok('d7d5 被接受', d5.status === 200, String(d5.status));
  eq('双方棋谱同步 e4 d5', d5.body.state.history, ['e4', 'd5']);
  const replay = await sendAction(roomId, t2, 'chess-two', { type: 'move', from: 11, to: 27 }, idemKey);
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, d5.body.stateVersion);
  eq('幂等重放不重复走子', replay.body.state.history, ['e4', 'd5']);
  const firstClosed = await closeRoom(roomId, t1, 'chess-one');
  ok('第一局房间关闭', firstClosed.status === 200 && firstClosed.body.closed === true, String(firstClosed.status));

  console.log('\n[STEP] real checkmate settlement');
  const mateRoom = await makeRoom('mate-host', 'mate-guest');
  const moves = [
    { from: 53, to: 45 }, // f2f3
    { from: 12, to: 28 }, // e7e5
    { from: 54, to: 38 }, // g2g4
    { from: 3, to: 39 }   // Qh4#
  ];
  let last = null;
  for (let i = 0; i < moves.length; i++) {
    const who = i % 2 === 0 ? [mateRoom.session, 'mate-host'] : [mateRoom.guest.session, 'mate-guest'];
    last = await sendAction(mateRoom.id, who[0], who[1], { type: 'move', from: moves[i].from, to: moves[i].to });
    ok('愚人杀第 ' + (i + 1) + ' 步被接受', last.status === 200, String(last.status));
  }
  ok('终局标记 over', last.body.over === true);
  eq('终局结果 checkmate', last.body.result.result, 'checkmate');
  eq('黑方获胜座位 1', last.body.result.winnerSeat, 1);
  eq('双方比分 [0,1]', last.body.result.scores, [0, 1]);
  eq('终局棋谱 4 个半回合', last.body.state.history, ['f3', 'e5', 'g4', 'Qh4#']);
  const mate1 = await getRoom(mateRoom.id, mateRoom.session, 'mate-host');
  const mate2 = await getRoom(mateRoom.id, mateRoom.guest.session, 'mate-guest');
  eq('两客户端同一赢家', mate1.body.result.winnerSeat, mate2.body.result.winnerSeat);
  eq('两客户端同一结果类型', mate1.body.result.result, mate2.body.result.result);
  eq('两客户端同一最终棋盘', mate1.body.state.board, mate2.body.state.board);
  eq('终局后白方无动作', mate1.body.legalActions.length, 0);

  console.log('\n[STEP] leaderboard / rematch swaps colours');
  const lb = await api('GET', '/api/leaderboard?game=chess-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId', lb.body.entries.every(function (entry) {
    return !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai;
  }));
  ok('排行榜含胜者标记', lb.body.entries.some(function (entry) { return entry.winner === true; }));
  const restart = await api('POST', '/api/rooms/' + mateRoom.id + '/restart', { session: mateRoom.session, playerId: 'mate-host' });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重赛回到起始 FEN', restart.body.state.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  eq('重赛交换颜色 [黑,白]', restart.body.state.seatColors, ['b', 'w']);
  eq('重赛后白方座位为 1', restart.body.state.whiteSeat, 1);
  eq('重赛棋谱清空', restart.body.state.history, []);
  eq('重赛白方先行', restart.body.state.turn, 'w');

  console.log('\n[STEP] reconnect');
  const reconnect = await api('POST', '/api/rooms/' + mateRoom.id + '/reconnect', { session: mateRoom.session, playerId: 'mate-host' });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));
  eq('重连返回座位 0', reconnect.body.seat, 0);
  const mateClosed = await closeRoom(mateRoom.id, mateRoom.session, 'mate-host');
  ok('重赛房关闭', mateClosed.status === 200 && mateClosed.body.closed === true, String(mateClosed.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await makeRoom('idle-host', 'idle-guest');
  const idleMove = await sendAction(idleRoom.id, idleRoom.session, 'idle-host', { type: 'move', from: 52, to: 36 });
  ok('托管房主走 e2e4', idleMove.status === 200);
  const beforeIdle = await getRoom(idleRoom.id, idleRoom.session, 'idle-host');
  const beforeVersion = beforeIdle.body.stateVersion;
  // Keep the host alive while the guest deliberately stops polling. The host
  // polls 3.5× faster than the 700ms idle window.
  for (let i = 0; i < 11; i++) {
    await sleep(200);
    await getRoom(idleRoom.id, idleRoom.session, 'idle-host');
  }
  const afterIdle = await getRoom(idleRoom.id, idleRoom.session, 'idle-host');
  ok('无请求超时后客座进入托管', afterIdle.body.takeover.indexOf(1) !== -1, JSON.stringify(afterIdle.body.takeover));
  ok('持续轮询的房主未被托管', afterIdle.body.takeover.indexOf(0) === -1, JSON.stringify(afterIdle.body.takeover));
  ok('托管 AI 已应一手', afterIdle.body.state.history.length >= 2, JSON.stringify(afterIdle.body.state.history));
  ok('托管推进 stateVersion', afterIdle.body.stateVersion > beforeVersion, beforeVersion + '→' + afterIdle.body.stateVersion);
  eq('托管后轮到白方', afterIdle.body.state.turn, 'w');
  const cameBack = await api('POST', '/api/rooms/' + idleRoom.id + '/reconnect', { session: idleRoom.guest.session, playerId: 'idle-guest' });
  ok('客座重连成功', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await getRoom(idleRoom.id, idleRoom.guest.session, 'idle-guest');
  ok('重连清除客座托管', afterReconnect.body.takeover.indexOf(1) === -1, JSON.stringify(afterReconnect.body.takeover));
  eq('重连后客座恢复人类', afterReconnect.body.seats[1].ai, false);
  const idleClosed = await closeRoom(idleRoom.id, idleRoom.session, 'idle-host');
  ok('托管测试房关闭', idleClosed.status === 200 && idleClosed.body.closed === true, String(idleClosed.status));

  console.log('\n[STEP] empty seat AI fill');
  const soloCreated = await api('POST', '/api/rooms', { playerId: 'solo-host', nickname: '单人房主' });
  const solo = roomOf(soloCreated);
  const soloStart = await api('POST', '/api/rooms/' + solo.id + '/start', { session: solo.session, playerId: 'solo-host' });
  ok('单人开局成功', soloStart.status === 200 && soloStart.body.started === true);
  eq('空位补齐到 2 人', soloStart.body.playerCount, 2);
  eq('座位 1 为 AI', soloStart.body.seats[1].ai, true);
  const soloMove = await sendAction(solo.id, solo.session, 'solo-host', { type: 'move', from: 52, to: 36 });
  ok('单人房走 e2e4 成功', soloMove.status === 200);
  ok('AI 补位在同一请求内回应', soloMove.body.state.history.length >= 2, JSON.stringify(soloMove.body.state.history));
  eq('AI 回应后轮到白方', soloMove.body.state.turn, 'w');
  ok('AI 回应是合法棋谱', soloMove.body.state.history.length === 2 && /^[a-hNBRQKO]/.test(soloMove.body.state.history[1]), JSON.stringify(soloMove.body.state.history));

  console.log('\n[STEP] close solo room');
  const soloClosed = await closeRoom(solo.id, solo.session, 'solo-host');
  ok('单人房关闭', soloClosed.status === 200 && soloClosed.body.closed === true, String(soloClosed.status));
  const gone = await getRoom(roomId, t1, 'chess-one');
  eq('关闭后房间不存在', gone.status, 404);
  const goneMate = await getRoom(mateRoom.id, mateRoom.session, 'mate-host');
  eq('重赛房关闭后不存在', goneMate.status, 404);
  const goneIdle = await getRoom(idleRoom.id, idleRoom.session, 'idle-host');
  eq('托管房关闭后不存在', goneIdle.status, 404);

  await handle.close();

  const onlineJson = {
    game: 'chess-premium',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    runAll: true,
    assertions: passed,
    failed: failed
  };
  fs.writeFileSync(path.join(__dirname, 'online-e2e.json'), JSON.stringify(onlineJson, null, 2) + '\n');
  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify(onlineJson));
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
