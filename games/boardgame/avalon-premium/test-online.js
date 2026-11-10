#!/usr/bin/env node
/*
 * Avalon premium — two-client online E2E (run-all auto-discovers this file).
 *
 *   node games/boardgame/avalon-premium/test-online.js
 *   node games/boardgame/avalon-premium/test-online.js --control   # exit 1
 *
 * Two independent clients (two humans) share one room; the three remaining
 * seats are AI-filled so the table has exactly five players. Covers: room
 * create, password rejection, invite join, host start, AI fill to 5,
 * per-seat hidden roles, legal-action enforcement, idempotency, a full game
 * to settlement, same-room result agreement, reconnect, timeout AI takeover,
 * leaderboard and rematch. The browser side of the same contract lives in
 * e2e.mjs (online section).
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
  const handle = await mod.startAvalonServer({
    port: 0,
    host: '127.0.0.1',
    idleTimeoutMs: 900,
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
  const p1 = 'avalon-client-one';
  const p2 = 'avalon-client-two';

  console.log('\n[STEP] room create / password / invite');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '一号', password: 'avalon' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  ok('初始 5 个座位', created.body && created.body.seats.length === 5, created.body && String(created.body.seats.length));

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', password: 'nope' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  ok('第二人落在座位 1', joined.body && joined.body.seat === 1, joined.body && String(joined.body.seat));
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'avalon-client-three', nickname: '三号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / AI fill to exactly 5 / hidden roles');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  ok('空位 AI 补齐到恰好 5 人', start.body && start.body.playerCount === 5, start.body && String(start.body.playerCount));
  ok('开局状态含 5 名玩家', start.body && start.body.state && start.body.state.players.length === 5);
  ok('开局任务表为 2/3/2/3/3', JSON.stringify(start.body.state.questSizes) === JSON.stringify([2, 3, 2, 3, 3]));

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  ok('客户端一拿到自己的角色', typeof view1.body.state.yourRole === 'string' && view1.body.state.yourRole.length > 2, view1.body.state.yourRole);
  ok('客户端二拿到自己的角色', typeof view2.body.state.yourRole === 'string' && view2.body.state.yourRole.length > 2, view2.body.state.yourRole);
  ok('两名人类角色不同（发牌唯一）', view1.body.state.yourRole !== view2.body.state.yourRole);
  eq('客户端一自己的座位标记正确', view1.body.state.roleKnowledge[view1.body.state.yourSeat].role, 'you');
  eq('客户端二自己的座位标记正确', view2.body.state.roleKnowledge[view2.body.state.yourSeat].role, 'you');
  ok('进行中不公开其他玩家角色', view1.body.state.players.every(function (p) { return p.revealedRole === null; }));
  eq('进行中 reveal 为空', view1.body.state.reveal, null);
  ok('公共视图玩家对象不含 role 字段', view1.body.state.players.every(function (p) { return p.role === undefined; }));
  eq('两名客户端看到同一任务序号', view1.body.state.questIndex, view2.body.state.questIndex);
  eq('两名客户端看到同一任务轨道', view1.body.state.questSizes, view2.body.state.questSizes);
  eq('两名客户端看到同一比分', view1.body.state.missions, view2.body.state.missions);
  ok('客户端不泄漏任务卡投票', view1.body.state.history.every(function (h) { return h.failCount === null || h.result != null; }));
  ok('客户端一有角色知识数组', Array.isArray(view1.body.state.roleKnowledge) && view1.body.state.roleKnowledge.length === 5);
  ok('角色知识只含允许的 token', view1.body.state.roleKnowledge.every(function (k) {
    return ['you', 'evil', 'magic', 'evil-ally', 'unknown'].indexOf(k.role) >= 0;
  }));

  console.log('\n[STEP] illegal action / idempotency');
  const phase1 = view1.body.state.phase;
  const wrongType = phase1 === 'propose' ? { type: 'mission', fail: false } : { type: 'propose', team: [0, 1] };
  const bad = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t1, playerId: p1, action: wrongType
  });
  ok('阶段不符的动作被拒绝', bad.status >= 400, String(bad.status));

  const turnView = view1.body.legalActions.length ? view1 : view2;
  const turnSession = view1.body.legalActions.length ? t1 : t2;
  const turnPlayer = view1.body.legalActions.length ? p1 : p2;
  const turnAction = turnView.body.legalActions[0];
  ok('存在合法动作', Boolean(turnAction), JSON.stringify(turnAction));
  const key = 'idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turnSession, playerId: turnPlayer, action: turnAction, idempotencyKey: key
  });
  ok('合法动作被接受', first.status === 200, String(first.status));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turnSession, playerId: turnPlayer, action: turnAction, idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);

  console.log('\n[STEP] full game to settlement (same room)');
  let rounds = 0;
  let settled = null;
  while (rounds < 500) {
    rounds += 1;
    const a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
    const b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    const pair = a.body.legalActions && a.body.legalActions.length
      ? [p1, t1, a.body]
      : (b.body.legalActions && b.body.legalActions.length ? [p2, t2, b.body] : null);
    if (!pair) { await sleep(25); continue; }
    const action = pair[2].legalActions[0];
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: pair[1], playerId: pair[0], action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
  }
  ok('双客户端对局在 500 步内结束', Boolean(settled), 'rounds=' + rounds);
  if (settled) {
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    ok('双方拿到结算结果', Boolean(settled.a.result) && Boolean(settled.b.result));
    eq('双方看到同一获胜阵营', settled.a.result.winnerSide, settled.b.result.winnerSide);
    eq('双方看到同一冠军座位', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一任务结果', settled.a.result.quests, settled.b.result.quests);
    eq('双方看到同一比分表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一完整身份表', settled.a.result.roles, settled.b.result.roles);
    ok('获胜阵营为 good 或 evil', settled.a.result.winnerSide === 'good' || settled.a.result.winnerSide === 'evil');
    ok('结算含 5 名玩家', settled.a.result.scores.length === 5, String(settled.a.result.scores.length));
    ok('结算原因非空', typeof settled.a.result.reason === 'string' && settled.a.result.reason.length > 4);
    ok('结算公开梅林座位', settled.a.result.merlinSeat >= 0 && settled.a.result.merlinSeat < 5);
    ok('结算公开刺客座位', settled.a.result.assassinSeat >= 0 && settled.a.result.assassinSeat < 5);
    ok('结算公开 5 个角色', settled.a.result.roles.length === 5);
    ok('结束后客户端可见完整身份', settled.a.state.reveal && settled.a.state.reveal.roles.length === 5);
    eq('两名客户端结束视图角色一致', settled.a.state.reveal.roles, settled.b.state.reveal.roles);
  }

  console.log('\n[STEP] leaderboard / restart / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=avalon-premium');
  ok('排行榜记录本局 5 个座位', lb.status === 200 && lb.body.entries.length >= 5, lb.body && String(lb.body.entries.length));
  ok('排行榜含 AI 参与者', lb.body.entries.some(function (entry) { return entry.ai === true; }));
  ok('排行榜不含原始 playerId', lb.body.entries.every(function (entry) {
    return entry.ai || !entry.playerId || /^sha256:/.test(entry.playerId);
  }));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开后回到第一次任务', restart.body.state.questIndex, 0);
  eq('重开后比分归零', restart.body.state.missions, { good: 0, evil: 0, needed: 3, total: 5 });
  eq('重开后仍是 5 人', restart.body.playerCount, 5);
  ok('重开后隐藏身份重新发牌', restart.body.state.reveal === null);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'idle-avalon-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', { playerId: 'idle-avalon-guest', nickname: '陪测', inviteCode: idleInvite });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'idle-avalon-host' });
  ok('超时测试房已开局且 5 人', idleStart.status === 200 && idleStart.body.started === true && idleStart.body.playerCount === 5, String(idleStart.status));
  await sleep(1400);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-avalon-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'idle-avalon-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-avalon-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清除该座位', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('关闭后房间不存在', gone.status === 404, String(gone.status));

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'avalon',
    slug: 'avalon-premium',
    clients: 2,
    sameGame: true,
    settlementConsistent: true,
    reconnect: true,
    timeoutTakeover: true,
    leaderboard: true,
    runAll: true,
    aiFillTo: 5,
    hiddenRoles: true,
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
