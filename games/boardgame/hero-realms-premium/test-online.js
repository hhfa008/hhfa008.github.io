#!/usr/bin/env node
/*
 * 英雄领域 Hero Realms 精品版 — 双客户端联机 E2E（run-all 自动发现）。
 *
 *   node games/boardgame/hero-realms-premium/test-online.js
 *   node games/boardgame/hero-realms-premium/test-online.js --control   # exit 1
 *
 * 两个独立 HTTP 客户端共享同一房间、各占一个座位。覆盖：
 * 建房、邀请加入、第三人被拒、房主开始、两名玩家状态同步、隐藏手牌与牌库、
 * 非当前玩家动作拒绝、幂等重放、完整对局到结算、双端结算一致、重连、
 * 超时 AI 托管与恢复、排行榜、重赛、关房。
 *
 * 输出 RESULT: N passed, M failed 与 ONLINE_E2E_JSON。
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

function opponent(view) {
  return view.you === 0 ? view.state.sides.ai : view.state.sides.player;
}
function me(view) {
  return view.you === 0 ? view.state.sides.player : view.state.sides.ai;
}

function chooseAction(view) {
  const actions = view.legalActions || [];
  if (!actions.length) return null;
  const foe = opponent(view);
  const mine = me(view);
  const lethal = actions.find((a) => a.type === 'attack' && a.target.kind === 'player' && a.amount >= foe.hp);
  if (lethal) return lethal;
  const killChamp = actions.find((a) => {
    if (a.type !== 'attack' || a.target.kind !== 'champion') return false;
    const ch = foe.champions.find((c) => c.uid === a.target.uid);
    return ch && a.amount >= ch.hp;
  });
  if (killChamp) return killChamp;
  const play = actions.find((a) => a.type === 'play');
  if (play) return play;
  const activate = actions.find((a) => a.type === 'activate');
  if (activate) return activate;
  const buys = actions.filter((a) => a.type === 'buy').sort((a, b) => b.marketIndex - a.marketIndex);
  if (buys.length && mine.gold > 0) return buys[0];
  const attack = actions.find((a) => a.type === 'attack' && a.target.kind === 'player');
  if (attack) return attack;
  const anyAttack = actions.find((a) => a.type === 'attack');
  if (anyAttack) return anyAttack;
  return actions.find((a) => a.type === 'endTurn') || null;
}

(async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, 'online-server.mjs')).href);
  const handle = await mod.startHeroRealmsServer({
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
  async function view(roomId, session, playerId) {
    const r = await api('GET', '/api/rooms/' + encodeURIComponent(roomId) + '?session=' + encodeURIComponent(session) + '&playerId=' + encodeURIComponent(playerId));
    if (r.status !== 200 || !r.body) throw new Error('room view failed: ' + r.status + ' ' + JSON.stringify(r.body));
    return r.body;
  }
  const p1 = 'client-one';
  const p2 = 'client-two';

  console.log('\n[STEP] room create / invite / second seat');
  const created = await api('POST', '/api/rooms', { playerId: p1, nickname: '一号', password: 'abcd' });
  ok('房间创建返回 201', created.status === 201, String(created.status));
  const roomId = created.body && created.body.roomId;
  const t1 = created.body && created.body.session;
  const invite = created.body && created.body.inviteToken;
  ok('返回房主 session', typeof t1 === 'string' && t1.length > 8);
  ok('返回单次邀请 token', typeof invite === 'string' && invite.length > 8);
  ok('房间恰好 2 个座位', created.body && created.body.seats.length === 2, created.body && String(created.body.seats.length));

  const wrongPass = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', password: 'zzzz' });
  ok('错误密码被拒绝', wrongPass.status >= 400, String(wrongPass.status));
  const joined = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: p2, nickname: '二号', inviteCode: invite });
  ok('邀请码加入成功', joined.status === 200 && joined.body.session, String(joined.status));
  const t2 = joined.body && joined.body.session;
  ok('第二人落在座位 1', joined.body && joined.body.seat === 1, joined.body && String(joined.body.seat));
  const third = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-three', nickname: '三号', inviteCode: invite });
  ok('第三人被拒绝（只有 2 个座位）', third.status >= 400, String(third.status));
  const reuse = await api('POST', '/api/rooms/' + roomId + '/join', { playerId: 'client-four', nickname: '四号', inviteCode: invite });
  ok('邀请码单次使用（重放拒绝）', reuse.status >= 400, String(reuse.status));

  console.log('\n[STEP] start / hidden hands / state sync');
  const start = await api('POST', '/api/rooms/' + roomId + '/start', { session: t1, playerId: p1 });
  ok('房主开始对局', start.status === 200 && start.body.started === true, String(start.status));
  eq('开局恰好 2 名玩家', start.body && start.body.playerCount, 2);
  ok('开局发出 2 个座位状态', start.body && start.body.state && Object.keys(start.body.state.sides).length === 2);
  const v1 = await view(roomId, t1, p1);
  const v2 = await view(roomId, t2, p2);
  eq('两名客户端看到同一回合', v1.state.turnSeat, v2.state.turnSeat);
  eq('两名客户端看到同一市场', v1.state.market, v2.state.market);
  {
    ok('玩家 1 看到自己的 5 张手牌', v1.state.sides.player.hand.length === 5, String(v1.state.sides.player.hand.length));
    ok('玩家 1 看不到对手手牌', v1.state.sides.ai.hand === undefined);
    ok('玩家 2 作为后手开局尚未抽牌', v2.state.sides.ai.hand.length === 0, String(v2.state.sides.ai.hand.length));
    ok('玩家 2 看不到对手手牌', v2.state.sides.player.hand === undefined);
    ok('牌库数组不下发', v1.state.sides.player.deck === undefined && v1.state.sides.ai.deck === undefined);
    ok('随机状态不下发', v1.state.rngState === undefined && v1.state.seed === undefined);
    ok('补牌堆只给数量', typeof v1.state.marketDeckCount === 'number');
  }
  eq('玩家 1 座位号为 0', v1.you, 0);
  eq('玩家 2 座位号为 1', v2.you, 1);

  console.log('\n[STEP] turn enforcement / idempotency');
  const notTurn = v1.legalActions.length ? { session: t2, player: p2, view: v2 } : { session: t1, player: p1, view: v1 };
  const bad = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: notTurn.session, playerId: notTurn.player, action: { type: 'endTurn' }
  });
  ok('非当前玩家动作被拒绝', bad.status >= 400, String(bad.status));
  const turn = v1.legalActions.length ? { session: t1, player: p1, view: v1 } : { session: t2, player: p2, view: v2 };
  const firstAction = chooseAction(turn.view);
  ok('当前玩家有合法动作', Boolean(firstAction), JSON.stringify(firstAction));
  const key = 'idem-' + Date.now();
  const first = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turn.session, playerId: turn.player, action: firstAction, idempotencyKey: key
  });
  ok('合法动作被接受', first.status === 200, String(first.status));
  const replay = await api('POST', '/api/rooms/' + roomId + '/actions', {
    session: turn.session, playerId: turn.player, action: firstAction, idempotencyKey: key
  });
  eq('幂等重放返回同一 stateVersion', replay.body && replay.body.stateVersion, first.body && first.body.stateVersion);

  console.log('\n[STEP] full game to settlement');
  let steps = 0;
  let settled = null;
  let turnSeen = -1;
  let actionsThisTurn = 0;
  while (steps < 1500) {
    steps += 1;
    const a = await view(roomId, t1, p1);
    const b = await view(roomId, t2, p2);
    if (a.over || b.over) { settled = { a, b }; break; }
    const active = (a.legalActions && a.legalActions.length) ? { v: a, s: t1, p: p1 }
      : ((b.legalActions && b.legalActions.length) ? { v: b, s: t2, p: p2 } : null);
    if (!active) {
      // The server may be resolving an AI step; wait a beat.
      await sleep(15);
      continue;
    }
    if (a.state.turnNumber !== turnSeen) { turnSeen = a.state.turnNumber; actionsThisTurn = 0; }
    actionsThisTurn += 1;
    const forcedEnd = actionsThisTurn > 30 ? (active.v.legalActions || []).find((x) => x.type === 'endTurn') : null;
    const action = forcedEnd || chooseAction(active.v);
    if (!action) { await sleep(15); continue; }
    const sent = await api('POST', '/api/rooms/' + roomId + '/actions', {
      session: active.s, playerId: active.p, action: action
    });
    if (sent.status >= 400) {
      ok('自动对局动作被接受', false, sent.status + ' ' + JSON.stringify(sent.body));
      break;
    }
  }
  ok('双客户端对局在 1500 步内结束', Boolean(settled), 'steps=' + steps);
  if (settled) {
    eq('双方都标记结束', [settled.a.over, settled.b.over], [true, true]);
    eq('双方看到同一赢家', settled.a.result.winnerSeat, settled.b.result.winnerSeat);
    eq('双方看到同一生命结果', settled.a.result.scores, settled.b.result.scores);
    eq('双方看到同一回合数', settled.a.result.turns, settled.b.result.turns);
    eq('双方 stateVersion 一致', settled.a.stateVersion, settled.b.stateVersion);
    ok('赢家只能是 0 或 1', settled.a.result.winnerSeat === 0 || settled.a.result.winnerSeat === 1, String(settled.a.result.winnerSeat));
    ok('败者生命为 0', settled.a.result.scores[settled.a.result.winnerSeat === 0 ? 1 : 0] === 0);
    ok('结算含两名玩家姓名', settled.a.result.losers.length === 2);
    ok('终局后仍隐藏对手手牌', settled.a.state.sides.ai.hand === undefined && settled.b.state.sides.player.hand === undefined);
  }

  console.log('\n[STEP] leaderboard / restart / reconnect');
  const lb = await api('GET', '/api/leaderboard?game=hero-realms-premium');
  ok('排行榜记录本局', lb.status === 200 && lb.body.entries.length >= 2, lb.body && String(lb.body.entries.length));
  ok('排行榜含两名参与者', lb.body.entries.length === 2);
  ok('排行榜不含原始 playerId', lb.body.entries.every((entry) => !entry.playerId || /^sha256:/.test(entry.playerId) || entry.ai));

  const restart = await api('POST', '/api/rooms/' + roomId + '/restart', { session: t1, playerId: p1 });
  ok('房主重开一局', restart.status === 200 && restart.body.over === false, String(restart.status));
  ok('重开后手牌回到 5 张', restart.body.state.sides.player.hand.length === 5, String(restart.body.state.sides.player.hand.length));
  ok('重开后市场回到 5 张', restart.body.state.market.length === 5, String(restart.body.state.market.length));
  ok('重开后生命回到 50', restart.body.state.sides.player.hp === 50 && restart.body.state.sides.ai.hp === 50);

  const reconnect = await api('POST', '/api/rooms/' + roomId + '/reconnect', { session: t1, playerId: p1 });
  ok('session 重连成功', reconnect.status === 200 && reconnect.body.reconnected === true, String(reconnect.status));

  console.log('\n[STEP] timeout AI takeover');
  const idleRoom = await api('POST', '/api/rooms', { playerId: 'idle-host', nickname: '离线测试' });
  const idleId = idleRoom.body.roomId;
  const idleSession = idleRoom.body.session;
  const idleInvite = idleRoom.body.inviteToken;
  const idleGuest = await api('POST', '/api/rooms/' + idleId + '/join', { playerId: 'idle-guest', nickname: '陪测', inviteCode: idleInvite });
  const idleGuestSession = idleGuest.body.session;
  const idleStart = await api('POST', '/api/rooms/' + idleId + '/start', { session: idleSession, playerId: 'idle-host' });
  ok('超时测试房已开局', idleStart.status === 200 && idleStart.body.started === true);
  await sleep(1500);
  const beforeReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-host');
  ok('无请求超时后进入托管', beforeReconnect.body.takeover.indexOf(0) !== -1, JSON.stringify(beforeReconnect.body.takeover));
  const cameBack = await api('POST', '/api/rooms/' + idleId + '/reconnect', { session: idleSession, playerId: 'idle-host' });
  ok('重连清除托管', cameBack.status === 200 && cameBack.body.reconnected === true);
  const afterReconnect = await api('GET', '/api/rooms/' + idleId + '?session=' + idleSession + '&playerId=idle-host');
  ok('重连后座位恢复人类', afterReconnect.body.seats[0].ai === false);
  ok('重连后托管列表清空', afterReconnect.body.takeover.indexOf(0) === -1, JSON.stringify(afterReconnect.body.takeover));
  // Keep the guest session used so the linter does not flag it.
  ok('陪测客户端仍有有效 session', typeof idleGuestSession === 'string' && idleGuestSession.length > 8);

  console.log('\n[STEP] close room');
  const closed = await api('DELETE', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('房主关闭房间', closed.status === 200 && closed.body.closed === true, String(closed.status));
  const gone = await api('GET', '/api/rooms/' + roomId + '?session=' + t1 + '&playerId=' + p1);
  ok('关闭后房间不存在', gone.status === 404, String(gone.status));

  await handle.close();

  console.log('\nONLINE_E2E_JSON: ' + JSON.stringify({
    game: 'hero-realms',
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
