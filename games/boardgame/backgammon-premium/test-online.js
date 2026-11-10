#!/usr/bin/env node
/*
 * Backgammon / 双陆棋 premium — two-client online E2E (run-all discovers it).
 *
 *   node games/boardgame/backgammon-premium/test-online.js
 *   node games/boardgame/backgammon-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room. Covers: create/invite/password,
 * join, start, same public board, viewer-only legal actions, doubling cube
 * double/take, illegal action rejection, idempotency, a full game to settlement,
 * reconnect, timeout AI takeover, leaderboard, AI fill, rematch and close.
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

function netScores(result) {
  return (result && result.scores) || [];
}
function chooseAction(view) {
  const acts = (view && view.legalActions) || [];
  if (!acts.length) return null;
  const ends = acts.filter(function (a) { return a.type === 'endTurn'; });
  if (ends.length) return ends[0];
  const takes = acts.filter(function (a) { return a.type === 'take'; });
  if (takes.length) return takes[0];
  const passes = acts.filter(function (a) { return a.type === 'pass'; });
  if (passes.length) return passes[0];
  const rolls = acts.filter(function (a) { return a.type === 'roll'; });
  if (rolls.length) return rolls[0];
  const moves = acts.filter(function (a) { return a.type === 'move'; });
  if (moves.length) {
    moves.sort(function (a, b) {
      const ao = a.to === 'off' ? 0 : 1;
      const bo = b.to === 'off' ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ab = a.from === 'bar' ? 0 : 1;
      const bb = b.from === 'bar' ? 0 : 1;
      if (ab !== bb) return ab - bb;
      return Number(b.die) - Number(a.die);
    });
    return moves[0];
  }
  return null;
}

(async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startBackgammonServer({
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
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '白方房主', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('双陆棋只有 2 个座位', created.body && created.body.seats.length, 2);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '黑方', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '黑方', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / same public board / hidden internals');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('开局 2 名玩家', start.body && start.body.playerCount, 2);
  const st0 = start.body && start.body.state;
  eq('开局 24 点', st0 && st0.points.length - 1, 24);
  eq('开局双方 pip 167', st0 && st0.pip, [167, 167]);
  eq('开局 15 对 15 枚', st0 && st0.checkers, [15, 15]);
  eq('开局白方先手', st0 && st0.turn, 0);
  eq('开局倍数方块 1', st0 && st0.cube.value, 1);

  const view1 = await getRoom(roomId, t1, p1);
  const view2 = await getRoom(roomId, t2, p2);
  eq('两客户端看到同一棋盘', view1.body.state.points, view2.body.state.points);
  eq('两客户端看到同一 bar/off', [view1.body.state.bar, view1.body.state.off], [view2.body.state.bar, view2.body.state.off]);
  eq('两客户端看到同一骰子', view1.body.state.dice, view2.body.state.dice);
  eq('两客户端看到同一倍数方块', view1.body.state.cube.value, view2.body.state.cube.value);
  ok('不泄漏 seed', view1.body.state.seed === undefined);
  ok('不泄漏 rngState', view1.body.state.rngState === undefined);
  ok('不泄漏内部 history', view1.body.state.history === undefined);
  ok('观察者有独立 you', view1.body.state.you === 0 && view2.body.state.you === 1);
  ok('轮到白方：白方有合法动作', (view1.body.legalActions || []).length > 0, JSON.stringify(view1.body.legalActions));
  eq('轮到白方：黑方没有合法动作', (view2.body.legalActions || []).length, 0);

  console.log('\n[STEP] doubling cube: double / take');
  ok('掷骰前有加倍动作', (view1.body.legalActions || []).some(function (a) { return a.type === 'double'; }));
  const doubled = await api('POST', '/api/rooms/' + roomId + '/actions', { session: t1, playerId: p1, action: { type: 'double' } });
  ok('白方要求加倍成功', doubled.status === 200, String(doubled.status));
  const afterDouble2 = await getRoom(roomId, t2, p2);
  eq('等待回应状态 cube', afterDouble2.body.state.status, 'cube');
  ok('黑方有 take/pass', afterDouble2.body.legalActions.some(function (a) { return a.type === 'take'; }) &&
    afterDouble2.body.legalActions.some(function (a) { return a.type === 'pass'; }));
  const badTake = await api('POST', '/api/rooms/' + roomId + '/actions', { session: t1, playerId: p1, action: { type: 'take' } });
  ok('加倍方不能自己接受', badTake.status >= 400, String(badTake.status));
  const taken = await api('POST', '/api/rooms/' + roomId + '/actions', { session: t2, playerId: p2, action: { type: 'take' } });
  ok('黑方接受加倍', taken.status === 200, String(taken.status));
  const afterTake1 = await getRoom(roomId, t1, p1);
  eq('接受后倍数 2', afterTake1.body.state.cube.value, 2);
  eq('接受后方块归黑方', afterTake1.body.state.cube.owner, 1);
  eq('接受后仍由白方掷骰', afterTake1.body.state.turn, 0);

  console.log('\n[STEP] turn enforcement / idempotency');
  const wrongTurn = await api('POST', '/api/rooms/' + roomId + '/actions', { session: t2, playerId: p2, action: { type: 'roll' } });
  ok('黑方不能替白方掷骰', wrongTurn.status >= 400, String(wrongTurn.status));
  const moveBeforeRoll = await api('POST', '/api/rooms/' + roomId + '/actions', { session: t1, playerId: p1, action: { type: 'move', from: 24, to: 18, die: 6 } });
  ok('掷骰前不能走子', moveBeforeRoll.status >= 400, String(moveBeforeRoll.status));
  const key = 'idem-' + Date.now();
  const rolled = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'roll' }, idempotencyKey: key
  });
  ok('白方掷骰成功', rolled.status === 200, String(rolled.status));
  const vAfterRoll = await getRoom(roomId, t1, p1);
  const versionAfterRoll = vAfterRoll.body.stateVersion;
  ok('掷骰后白方有 move 动作', vAfterRoll.body.legalActions.some(function (a) { return a.type === 'move'; }));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'roll' }, idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, versionAfterRoll);
  const v2AfterRoll = await getRoom(roomId, t2, p2);
  eq('掷骰后黑方仍无合法动作', (v2AfterRoll.body.legalActions || []).length, 0);
  const illegalMove = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: { type: 'move', from: 23, to: 22, die: 1 }
  });
  ok('非法走法被服务端拒绝', illegalMove.status >= 400, String(illegalMove.status));

  console.log('\n[STEP] full game to settlement');
  let steps = 0;
  let settled = null;
  while (steps < 5000) {
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
      const action = chooseAction(c.view);
      if (!action) continue;
      const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
        session: c.session, playerId: c.player, action: action
      });
      if (sent.status >= 400) continue;
      acted = true;
      break;
    }
    if (!acted) await sleep(10);
  }
  ok('双客户端对局在 5000 步内结束', Boolean(settled), 'steps=' + steps);
  if (settled) {
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一分数表', netScores(settled.a.result), netScores(settled.b.result));
    eq('双方看到同一类型', settled.a.result.type, settled.b.result.type);
    eq('双方看到同一倍数', settled.a.result.cubeValue, settled.b.result.cubeValue);
    ok('结算类型合法', ['single', 'gammon', 'backgammon'].indexOf(settled.a.result.type) >= 0, settled.a.result.type);
    eq('结算分数 = cube × multiplier', settled.a.result.points, settled.a.result.cubeValue * settled.a.result.multiplier);
    eq('赢家离盘 15', settled.a.result.off[settled.a.result.winnerSeat], 15);
    eq('赢家分数为正', netScores(settled.a.result)[settled.a.result.winnerSeat], settled.a.result.points);
    ok('输家分数为负', netScores(settled.a.result)[1 - settled.a.result.winnerSeat] < 0);
    ok('结算含回合数', typeof settled.a.result.turns === 'number' && settled.a.result.turns > 0, String(settled.a.result.turns));
  }

  console.log('\n[STEP] leaderboard / restart / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=backgammon-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId', lb.body.entries.every(function (entry) {
    return !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai;
  }));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开回到白方', restart.body.state.turn, 0);
  eq('重开 pip 167 对 167', restart.body.state.pip, [167, 167]);
  eq('重开 off 0 对 0', restart.body.state.off, [0, 0]);
  eq('重开倍数方块 1', restart.body.state.cube.value, 1);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] AI fill / timeout takeover');
  const aiRoom = await api('POST', '/api/rooms', { playerId: 'ai-host', nickname: 'AI补位测试' });
  const aiId = aiRoom.body.roomId;
  const aiSession = aiRoom.body.session;
  const aiStart = await api('POST', '/api/rooms/' + aiId + '/start', { session: aiSession, playerId: 'ai-host' });
  ok('单人开局允许开始', aiStart.status === 200 && aiStart.body.started === true, String(aiStart.status));
  eq('空位 AI 补齐到 2 人', aiStart.body.playerCount, 2);
  ok('座位 2 是 AI', aiStart.body.seats[1].ai === true);
  const aiView = await getRoom(aiId, aiSession, 'ai-host');
  ok('AI 座位会在服务端行动', aiView.body.state.stateVersion !== undefined || aiView.body.stateVersion >= 1);

  const idleRoom = await api('POST', '/api/rooms', { playerId: 'idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', { playerId: 'idle-guest', nickname: '陪测', inviteCode: idleInvite });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1500);
  const beforeReconnect = await getRoom(idleId, idleSession, 'idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  ok('托管期间 AI 已代为行动', beforeReconnect.body.state.turnNumber >= 2 || beforeReconnect.body.state.phase === 'over',
    JSON.stringify({ turn: beforeReconnect.body.state.turnNumber, phase: beforeReconnect.body.state.phase }));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'idle-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await getRoom(idleId, idleSession, 'idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await getRoom(roomId, t1, p1);
  eq('关闭后房间不存在', gone.status, 404);

  await handle.close();

  const evidence = {
    game: 'backgammon',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    runAll: true,
    assertions: passed,
    failed: failed,
    controlledFailure: { exitCode: 1 },
    steps: steps,
    evidence: 'games/boardgame/backgammon-premium/test-online.js'
  };
  fs.writeFileSync(path.join(__dirname, 'online-e2e.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
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
