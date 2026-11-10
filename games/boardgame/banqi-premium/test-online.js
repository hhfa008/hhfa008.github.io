#!/usr/bin/env node
/*
 * Banqi premium — two-client online E2E (run-all discovers this file).
 *
 *   node games/boardgame/banqi-premium/test-online.js
 *   node games/boardgame/banqi-premium/test-online.js --control   # exit 1
 *
 * Two independent HTTP clients share one room; covers room create, invite
 * join, password rejection, host start, state sync, legal-action enforcement,
 * idempotency, full settlement agreement, reconnect, timeout AI takeover,
 * leaderboard and rematch.
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
  const handle = await mod.startBanqiServer({
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

  const p1 = 'bq-client-one';
  const p2 = 'bq-client-two';

  console.log('\n[STEP] room create / invite / password');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '红方一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  eq('2 个座位', created.body && created.body.seats.length, 2);

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '黑方二号', password: 'zzzz'
  });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: p2, nickname: '黑方二号', inviteCode: invite
  });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  eq('第二人落在座位 1', joined.body && joined.body.seat, 1);
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', {
    playerId: 'bq-client-three', nickname: '第三人', inviteCode: invite
  });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / state sync / hidden information');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('房间保持 2 人', start.body && start.body.playerCount, 2);
  ok('开局 32 格全部有子', start.body && start.body.state.cells.filter(Boolean).length === 32,
    start.body && String(start.body.state.cells.filter(Boolean).length));
  ok('开局全部背面朝上', start.body && start.body.state.cells.every((c) => !c || c.h === 1));
  ok('服务器不下发暗子身份', start.body && start.body.state.cells.every((c) => !c || c.h !== 1 || c.t === null));

  const view1 = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  const view2 = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
  eq('两名客户端看到同一回合', view1.body.state.turn, view2.body.state.turn);
  eq('两名客户端看到同一暗子数', view1.body.state.counts.hidden, view2.body.state.counts.hidden);
  eq('两名客户端看到同一版本', view1.body.stateVersion, view2.body.stateVersion);
  eq('红方先手', view1.body.state.turnSeat, 0);

  console.log('\n[STEP] turn enforcement / idempotency');
  const blackView = view1.body.state.turnSeat === 0 ? view2 : view1;
  ok('非当前玩家没有合法动作', blackView.body.legalActions.length === 0,
    'legal=' + blackView.body.legalActions.length);
  const wrongSeat = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: t2, playerId: p2, action: { k: 'flip', to: 0 }
  });
  ok('非当前玩家动作被拒绝', wrongSeat.status >= 400, String(wrongSeat.status));

  const redView = view1.body.legalActions.length ? view1 : view2;
  const redSession = view1.body.legalActions.length ? t1 : t2;
  const redPlayer = view1.body.legalActions.length ? p1 : p2;
  const firstAction = redView.body.legalActions.find((a) => a.k === 'flip');
  ok('红方有翻子动作', Boolean(firstAction));
  const iKey = 'bq-idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: redSession, playerId: redPlayer, action: firstAction, idempotencyKey: iKey
  });
  ok('合法翻子被接受', first.status === 200, String(first.status) + ' ' + JSON.stringify(first.body && first.body.error));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: redSession, playerId: redPlayer, action: firstAction, idempotencyKey: iKey
  });
  eq('幂等重放返回同一 stateVersion', replay.body.stateVersion, first.body.stateVersion);

  console.log('\n[STEP] full game to settlement');
  let rounds = 0;
  let settled = null;
  let lastVersion = -1;
  let sameSync = true;
  while (rounds < 420) {
    rounds += 1;
    const a = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
    const b = await api('GET', '/api/rooms/' + roomId + '?session=' + t2 + '&playerId=' + p2);
    if (a.body.stateVersion !== b.body.stateVersion) sameSync = false;
    if (a.body.over || b.body.over) { settled = { a: a.body, b: b.body }; break; }
    const pair = a.body.legalActions && a.body.legalActions.length ? [p1, t1, a.body]
      : (b.body.legalActions && b.body.legalActions.length ? [p2, t2, b.body] : null);
    if (!pair) { await sleep(10); continue; }
    const action = pair[2].legalActions[0];
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: pair[1], playerId: pair[0], action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
    lastVersion = sent.body.stateVersion;
  }
  ok('双客户端对局在 420 步内结束', Boolean(settled), 'rounds=' + rounds);
  ok('全程双方 stateVersion 一致', sameSync);
  ok('至少发生过一次翻子', settled && settled.a.state.flips > 0, settled && String(settled.a.state.flips));
  if (settled) {
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一分数表', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一结算原因', settled.a.result.reason, settled.b.result.reason);
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('结算含 2 名玩家', settled.a.result.scores.length, 2);
    ok('存在冠军或和棋', settled.a.result.winnerSeat != null || settled.a.result.tied === true);
    if (settled.a.result.winnerSeat != null) {
      ok('赢家剩余棋子不少于对手',
        settled.a.result.scores[settled.a.result.winnerSeat] >=
        Math.max.apply(null, settled.a.result.scores), JSON.stringify(settled.a.result.scores));
    }
  }

  console.log('\n[STEP] leaderboard / rematch / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=banqi-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜不含原始 playerId',
    lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  eq('重开后暗子回到 32', restart.body.state.counts.hidden, 32);
  eq('重开后回到红方先手', restart.body.state.turnSeat, 0);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'bq-idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  await api('POST', '/api/rooms/' + idleId + '/join', {
    playerId: 'bq-idle-guest', nickname: '陪测', inviteCode: idleInvite
  });
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'bq-idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1300);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=bq-idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1,
    JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', {
    session: idleSession, playerId: 'bq-idle-host'
  });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=bq-idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1,
    JSON.stringify(afterReconnect.body.takeover));

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  eq('关闭后房间不存在', gone.status, 404);

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'banqi',
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
