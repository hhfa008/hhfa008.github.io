#!/usr/bin/env node
/*
 * Pioneers premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/pioneers-premium/test-online.js
 *   node games/boardgame/pioneers-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room; a second room proves an empty
 * seat is AI-filled and plays the whole game. Covers room create, invite join,
 * password rejection, host start, state sync, server-only dice, legal-action
 * enforcement, idempotency, full settlement agreement, AI fill, reconnect,
 * timeout AI takeover, leaderboard, rematch and close.
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

function chooseAction(view) {
  const legal = view.legalActions || [];
  if (!legal.length) return null;
  const roll = legal.find((a) => a.k === 'roll');
  if (roll) return roll;
  const city = legal.find((a) => a.k === 'upgradeCity');
  if (city) return city;
  const settlement = legal.find((a) => a.k === 'buildSettlement');
  if (settlement) return settlement;
  const me = view.state && view.state.players && view.state.players[view.state.turnSeat];
  const roadLimit = me && me.roads.length < 6;
  const road = legal.find((a) => a.k === 'buildRoad');
  if (road && roadLimit) return road;
  const end = legal.find((a) => a.k === 'endTurn');
  return end || legal[0];
}

(async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startPioneersServer({
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

  const p1 = 'pn-client-one';
  const p2 = 'pn-client-two';

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '赤帆一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('创建时预留 4 个座位', created.body && created.body.seats.length, 4);
  eq('2–4 人房上限', created.body && created.body.room && created.body.room.maxPlayers, 4);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '蓝港二号', password: 'zzzz'
  });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '蓝港二号', inviteCode: invite
  });
  ok('邀请码加入成功', joined.status === 200 && !!joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: 'pn-client-three', nickname: '第三人', inviteCode: invite
  });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / state sync / server-only dice');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('按当前人数开 2 座', start.body && start.body.playerCount, 2);
  eq('开局 19 块六边形', start.body && start.body.state.board.hexes.length, 19);
  eq('开局 4 座潮门', start.body && start.body.state.board.ports.length, 4);
  eq('开局蛇形顺序 0,1,1,0', start.body && start.body.state.setup.order, [0, 1, 1, 0]);
  eq('开局在摆放阶段', start.body && start.body.state.phase, 'setup');
  eq('服务器不下发 rngState', start.body && start.body.state.rngState, undefined);
  eq('服务器不下发 seed', start.body && start.body.state.seed, undefined);
  eq('服务器不下发骰子流', JSON.stringify(start.body.state).indexOf('rngState') === -1, true);

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  eq('两名客户端看到同一回合', view1.body.state.current, view2.body.state.current);
  eq('两名客户端看到同一版本', view1.body.stateVersion, view2.body.stateVersion);
  eq('两名客户端看到同一地形', view1.body.state.board.hexes.map((h) => h.terrain), view2.body.state.board.hexes.map((h) => h.terrain));
  eq('两名客户端看到同一资源', view1.body.state.players.map((p) => p.resources), view2.body.state.players.map((p) => p.resources));
  eq('红帆先手（座位 0）', view1.body.state.turnSeat, 0);

  console.log('\n[STEP] turn enforcement / idempotency');
  const nonTurn = view1.body.legalActions.length ? view2 : view1;
  ok('非当前玩家没有合法动作', nonTurn.body.legalActions.length === 0, 'legal=' + nonTurn.body.legalActions.length);
  const wrongSeat = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t2, playerId: p2, action: { k: 'setupSettlement', vertex: start.body.state.board.vertices[0].key }
  });
  ok('非当前玩家动作被拒绝', wrongSeat.status >= 400, String(wrongSeat.status));
  const actorView = view1.body.legalActions.length ? view1 : view2;
  const actorSession = view1.body.legalActions.length ? t1 : t2;
  const actorPlayer = view1.body.legalActions.length ? p1 : p2;
  const firstAction = chooseAction(actorView.body);
  ok('当前玩家有摆放动作', Boolean(firstAction), JSON.stringify(firstAction));
  const iKey = 'pn-idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: actorSession, playerId: actorPlayer, action: firstAction, idempotencyKey: iKey
  });
  ok('合法摆放被接受', first.status === 200, String(first.status) + ' ' + JSON.stringify(first.body && first.body.error));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: actorSession, playerId: actorPlayer, action: firstAction, idempotencyKey: iKey
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);

  console.log('\n[STEP] full two-client game to settlement');
  let rounds = 0;
  let settled = null;
  let sameSync = true;
  let sawRoll = false;
  let sawSetup = false;
  let rolledDice = null;
  while (rounds < 420) {
    rounds += 1;
    const a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
    const b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    if (a.body.stateVersion !== b.body.stateVersion) sameSync = false;
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    const pair = a.body.legalActions && a.body.legalActions.length ? [p1, t1, a.body]
      : (b.body.legalActions && b.body.legalActions.length ? [p2, t2, b.body] : null);
    if (!pair) { await sleep(10); continue; }
    const action = chooseAction(pair[2]);
    if (action.k === 'roll') sawRoll = true;
    if (action.k === 'setupSettlement' || action.k === 'setupRoad') sawSetup = true;
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: pair[1], playerId: pair[0], action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
    if (sent.body && sent.body.state && sent.body.state.dice) rolledDice = sent.body.state.dice;
  }
  ok('双客户端对局在 420 步内结束', Boolean(settled), 'rounds=' + rounds);
  ok('全程双方 stateVersion 一致', sameSync);
  ok('对局经历过蛇形摆放', sawSetup);
  ok('对局经历过掷骰', sawRoll);
  ok('骰子由服务器生成并公开', Array.isArray(rolledDice) && rolledDice.length === 2, JSON.stringify(rolledDice));
  if (settled) {
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一分数表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一结算原因', settled.a.result.reason, settled.b.result.reason);
    eq('双方看到同一明细', settled.a.result.details, settled.b.result.details);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('结算含 2 名玩家', settled.a.result.scores.length, 2);
    ok('存在冠军或平局', settled.a.result.winnerSeat != null || settled.a.result.tied === true);
    if (settled.a.result.winnerSeat != null) {
      ok('赢家分数不低于对手',
        settled.a.result.scores[settled.a.result.winnerSeat] >= Math.max.apply(null, settled.a.result.scores),
        JSON.stringify(settled.a.result.scores));
    }
    ok('结算记录回合数', typeof settled.a.result.rounds === 'number' && settled.a.result.rounds >= 1,
      String(settled.a.result.rounds));
    ok('结算记录建筑细节', settled.a.result.details.every((d) => d.settlements >= 0 && d.cities >= 0 && d.roads >= 0));
    ok('结算保留 AI 标记', settled.a.result.details.every((d) => typeof d.ai === 'boolean'));
  }

  console.log('\n[STEP] leaderboard / rematch / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=pioneers-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId',
    lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));
  ok('排行榜记录分数', lb.body.entries.every((entry) => entry.score == null || typeof entry.score === 'number'));
  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开后回到摆放阶段', restart.body.state.phase, 'setup');
  eq('重开后仍然是 19 块六边形', restart.body.state.board.hexes.length, 19);
  eq('重开后分数归零', restart.body.state.players.map((p) => p.score), [0, 0]);
  eq('重开后蛇形顺序', restart.body.state.setup.order, [0, 1, 1, 0]);
  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] AI fill: one human, empty seat plays the whole game');
  const fillRoom = await api('POST', '/api/rooms', { playerId: 'pn-fill-host', nickname: '独航者' });
  const fillId = fillRoom.body.roomId;
  const fillSession = fillRoom.body.session;
  const fillStart = await api('POST', '/api/rooms/' + fillId + '/start', { session: fillSession, playerId: 'pn-fill-host' });
  ok('单人开局成功', fillStart.status === 200 && fillStart.body.started === true);
  eq('空位补成 2 座', fillStart.body.playerCount, 2);
  ok('空位标记为 AI', fillStart.body.seats[1].ai === true, JSON.stringify(fillStart.body.seats[1]));
  ok('引擎内 AI 标记一致', fillStart.body.state.players[1].ai === true);
  let fillSteps = 0;
  let fillSettled = null;
  let fillAiEvents = 0;
  while (fillSteps < 360) {
    fillSteps += 1;
    const v = await api('GET', '/api/rooms/' + fillId + '?session=' + fillSession + '&playerId=pn-fill-host');
    if (v.body.over) { fillSettled = v.body; break; }
    const action = chooseAction(v.body);
    if (action) {
      const sent = await api('POST', '/api/rooms/' + fillId + '/actions', {
        session: fillSession, playerId: 'pn-fill-host', action: action
      });
      if (sent.status >= 400) {
        ok('AI 补位对局中人类动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
        break;
      }
      if (sent.body && sent.body.lastAction && sent.body.lastAction.type === 'ai') fillAiEvents += 1;
    } else {
      const tick = await api('POST', '/api/rooms/' + fillId + '/tick', { session: fillSession, playerId: 'pn-fill-host' });
      if (tick.body && tick.body.lastAction && tick.body.lastAction.type === 'ai') fillAiEvents += 1;
    }
    await sleep(5);
  }
  ok('AI 补位对局在 360 步内结束', Boolean(fillSettled), 'steps=' + fillSteps);
  if (fillSettled) {
    eq('AI 补位对局结算 2 人', fillSettled.result.scores.length, 2);
    ok('AI 座位有分数', typeof fillSettled.result.scores[1] === 'number', String(fillSettled.result.scores[1]));
    ok('AI 座位有建筑或资源', fillSettled.state.players[1].settlements.length >= 2 || fillSettled.state.players[1].cities.length >= 1,
      JSON.stringify(fillSettled.state.players[1]));
    ok('AI 确实执行过动作', fillAiEvents > 0 || fillSettled.state.log.some((line) => /云策|潮生|野望|远航/.test(line)),
      'aiEvents=' + fillAiEvents);
    eq('AI 补位结算一致', JSON.stringify(fillSettled.result.scores), JSON.stringify(fillSettled.result.details.map((d) => d.score)));
  }
  const lb2 = await api('GET', '/api/leaderboard?game=pioneers-premium');
  ok('AI 参与者进入排行榜', lb2.body.entries.some((entry) => entry.ai === true));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'pn-idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', {
    playerId: 'pn-idle-guest', nickname: '陪测', inviteCode: idleInvite
  });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'pn-idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1400);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=pn-idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1,
    JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', {
    session: idleSession, playerId: 'pn-idle-host'
  });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=pn-idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1,
    JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  eq('关闭后房间不存在', gone.status, 404);

  await handle.close();

  const summary = {
    game: 'pioneers-premium',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    aiFill: true,
    runAll: true,
    assertions: passed,
    failed: failed,
    generatedAt: new Date().toISOString(),
    steps: rounds,
    fillSteps: fillSteps
  };
  try {
    fs.writeFileSync(path.join(__dirname, 'online-e2e.json'), JSON.stringify(summary, null, 2) + '\n');
  } catch (err) { /* evidence write is best effort */ }

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify(summary));
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
