'use strict';

/*
 * Azul online contract (L3/L4): rooms, invites, cross-device state sync,
 * 2–4 seats, AI fill, reconnect, timeout auto-play and leaderboard.
 *
 * Starts the real app/server.mjs (createApiServer) on loopback. No browser and
 * no external network. The browser-level dual-client proof lives in
 * azul-premium/online-e2e.mjs (wrapped by azul-premium/test-online.js).
 *
 *   node games/boardgame/tests/azul-online.test.mjs
 */

import http from 'node:http';
import { createRequire } from 'node:module';
import { createSuite } from './lib/suite.mjs';
import { createApiServer, resolveListenOptions } from '../app/server.mjs';

const require = createRequire(import.meta.url);
const Azul = require('../azul-premium/engine.js');

const s = createSuite('boardgame-azul-online');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(base, method, route, body, headers) {
  const init = {
    method,
    headers: Object.assign({ accept: 'application/json' }, headers || {}),
    signal: AbortSignal.timeout(5000)
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(base + route, init);
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (err) { parsed = null; }
  return { status: response.status, body: parsed, text, headers: response.headers };
}

function rawRequest(base, options) {
  const opts = options || {};
  const url = new URL(base + (opts.path || '/'));
  return new Promise(function (resolve, reject) {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: opts.method || 'GET',
      headers: Object.assign({ accept: 'application/json' }, opts.headers || {})
    }, function (res) {
      let text = '';
      res.on('data', function (chunk) { text += chunk.toString(); });
      res.on('end', function () {
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch (err) { body = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('raw request timeout')); });
    if (opts.body !== undefined) req.write(JSON.stringify(opts.body));
    req.end();
  });
}

function getRoom(base, roomId, client) {
  return call(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId) +
    '?playerId=' + encodeURIComponent(client.playerId) +
    '&session=' + encodeURIComponent(client.session || ''));
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const value = await fn();
    last = value;
    if (value) return value;
    await sleep(intervalMs || 25);
  }
  return last;
}

function actionKey(holder) {
  holder.seq += 1;
  return 'azul-e2e-' + Date.now().toString(36) + '-' + holder.seq;
}

function scoreByName(view) {
  const map = {};
  (view.state.players || []).forEach(function (player) { map[player.name] = player.score; });
  return map;
}

let mainApp = null;
let timeoutApp = null;
let base = null;
let timeoutBase = null;

try {
  mainApp = createApiServer({
    autoFillMs: 60,
    aiMoveMinMs: 5,
    aiMoveMaxMs: 12,
    disconnectMs: 2000,
    tickMs: 15
  });
  const mainAddress = await mainApp.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + mainAddress.port;

  timeoutApp = createApiServer({
    autoFillMs: 30,
    aiMoveMinMs: 3,
    aiMoveMaxMs: 8,
    disconnectMs: 300,
    tickMs: 15
  });
  const timeoutAddress = await timeoutApp.listen(0, '127.0.0.1');
  timeoutBase = 'http://127.0.0.1:' + timeoutAddress.port;

  await s.run(async function () {
    await s.group('listen options, LAN invite URL and static client', async function () {
      const defaults = resolveListenOptions([], {});
      s.eq('默认只听 127.0.0.1', defaults.host, '127.0.0.1');
      const lan = resolveListenOptions(['--host', '0.0.0.0', '--port', '9001'], {});
      s.eq('--host 0.0.0.0 生效', lan.host, '0.0.0.0');
      s.eq('--port 生效', lan.port, 9001);

      const created = await rawRequest(base, {
        method: 'POST',
        path: '/api/rooms',
        headers: { host: '192.168.8.50:8787', 'content-type': 'application/json' },
        body: { gameType: 'azul', playerId: 'lan-host', seed: 7, maxPlayers: 2, autoFill: false }
      });
      s.eq('带 LAN Host 创建 Azul 房间 201', created.status, 201);
      s.ok('inviteUrl 使用请求 Host',
        typeof created.body.inviteUrl === 'string' &&
        created.body.inviteUrl.indexOf('http://192.168.8.50:8787/boardgame/azul-premium/online.html') === 0,
        String(created.body && created.body.inviteUrl));
      s.ok('inviteUrl 带 room 与 code',
        created.body.inviteUrl.indexOf('room=') !== -1 && created.body.inviteUrl.indexOf('code=') !== -1,
        created.body.inviteUrl);
      s.eq('inviteUrl 指向 Azul 联机页而非通用页',
        created.body.inviteUrl.indexOf('/play/online.html') === -1, true);

      const page = await call(base, 'GET', '/boardgame/azul-premium/online.html');
      s.eq('静态联机页同源提供', page.status, 200);
      s.includes('联机页标题', page.text, '联机房间');
      s.includes('联机页声明 AI 补位', page.text, 'AI 补位');
      s.includes('联机页声明断线重连', page.text, '重连');
      const pageNoCanonical = page.text.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '');
      s.ok('联机页零外部脚本/样式', !/<script[^>]+src="https?:/.test(pageNoCanonical) && !/<link[^>]+href="https?:/.test(pageNoCanonical));
      const engine = await call(base, 'GET', '/boardgame/azul-premium/engine.js');
      s.eq('引擎脚本同源提供', engine.status, 200);
      s.includes('引擎脚本是 Azul 引擎', engine.text, 'AzulEngine');

      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(created.body.roomId) +
        '?playerId=lan-host&session=' + encodeURIComponent(created.body.playerSession));
    });

    await s.group('two clients share one authoritative Azul game', async function () {
      const A = { playerId: 'alice', session: null, seq: 0 };
      const B = { playerId: 'bob', session: null, seq: 0 };
      const created = await call(base, 'POST', '/api/rooms', {
        gameType: 'azul', playerId: A.playerId, seed: 42, maxPlayers: 2, autoFill: false
      });
      s.eq('A 创建 2 人房 201', created.status, 201);
      s.eq('创建返回 gameType=azul', created.body.gameType, 'azul');
      s.eq('创建返回 playerCount=2', created.body.playerCount, 2);
      A.session = created.body.playerSession;
      const roomId = created.body.roomId;
      s.ok('创建返回 Azul state 与 5 个圆盘',
        !!created.body.state && created.body.state.factories.length === 5,
        JSON.stringify(created.body.state && created.body.state.factories.length));

      const joined = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
        playerId: B.playerId
      });
      s.eq('B 加入 200', joined.status, 200);
      B.session = joined.body.playerSession;
      s.ok('B 获得独立 session', Boolean(B.session) && B.session !== A.session);
      s.eq('B 原始座位为 1', joined.body.mySeat, 1);
      s.eq('B 视角座位 0 是 Bob', joined.body.state.players[0].name, 'bob');
      s.eq('B 视角 current 已轮转', joined.body.state.current, 1);
      s.eq('加入后自动开局', joined.body.roomStatus, 'playing');

      const reconnect = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', {
        token: B.session, playerId: B.playerId
      });
      s.eq('session token 可重连', reconnect.status, 200);
      s.eq('重连恢复同一玩家', reconnect.body.playerId, B.playerId);
      s.eq('重连后 stateVersion 一致',
        reconnect.body.stateVersion, (await getRoom(base, roomId, A)).body.stateVersion);

      const forbidden = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/leave', {
        playerId: B.playerId, session: B.session
      });
      s.eq('对局中禁止离开导致座位错位', forbidden.status, 409);
      s.eq('对局中离开返回 E_LOCKED', forbidden.body.error.code, 'E_LOCKED');

      const invalidReconnect = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', {
        token: 'sess_not_real', playerId: B.playerId
      });
      s.eq('伪造 session 重连 403', invalidReconnect.status, 403);

      let ended = false;
      let steps = 0;
      let syncMismatch = null;
      let idempotencyChecked = false;

      for (; steps < 400; steps += 1) {
        const viewA = (await getRoom(base, roomId, A)).body;
        const viewB = (await getRoom(base, roomId, B)).body;
        if (viewA.stateVersion !== viewB.stateVersion ||
            viewA.turn !== viewB.turn ||
            viewA.currentPlayerId !== viewB.currentPlayerId) {
          syncMismatch = 'step ' + steps + ' A=' + viewA.stateVersion + '/' + viewA.currentPlayerId +
            ' B=' + viewB.stateVersion + '/' + viewB.currentPlayerId;
          break;
        }
        if (viewA.status === 'ended' || viewA.roomStatus === 'finished') { ended = true; break; }
        const actor = viewA.currentPlayerId === A.playerId ? A : B;
        const actorView = actor === A ? viewA : viewB;
        s.eq('行动方视角 current 始终是座位 0', actorView.state.current, 0, 'step ' + steps);
        const move = Azul.chooseAIMove(actorView.state);
        const key = actionKey(actor);
        const acted = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions',
          Object.assign({}, move, {
            playerId: actor.playerId,
            session: actor.session,
            idempotencyKey: key
          }));
        s.eq('提交 Azul 动作 200', acted.status, 200, 'step ' + steps);
        if (acted.status !== 200) break;
        const version = acted.body.stateVersion;

        if (!idempotencyChecked) {
          const replay = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions',
            Object.assign({}, move, {
              playerId: actor.playerId,
              session: actor.session,
              idempotencyKey: key
            }));
          s.eq('重复 idempotencyKey 返回 200', replay.status, 200);
          s.eq('重复提交不推进 stateVersion', replay.body.stateVersion, version);
          s.eq('重复提交不推进 turn', replay.body.turn, acted.body.turn);
          idempotencyChecked = true;
        }

        const opponent = actor === A ? B : A;
        const seen = await getRoom(base, roomId, opponent);
        s.eq('对手立即读到同一 stateVersion', seen.body.stateVersion, version, 'step ' + steps);
        s.ok('对手读到 lastAction', !!seen.body.lastAction && seen.body.lastAction.seq === version,
          JSON.stringify(seen.body.lastAction));
      }

      s.ok('双客户端把 Azul 走到结算', ended, 'steps=' + steps);
      s.ok('全程 turn/stateVersion/current 一致', syncMismatch === null, syncMismatch || '');
      s.ok('产生了足够步数', steps > 10, String(steps));

      const finalA = (await getRoom(base, roomId, A)).body;
      const finalB = (await getRoom(base, roomId, B)).body;
      s.eq('结算 stateVersion 双方一致', finalA.stateVersion, finalB.stateVersion);
      s.eq('双方 status 都是 ended', [finalA.status, finalB.status], ['ended', 'ended']);
      const scoresA = scoreByName(finalA);
      const scoresB = scoreByName(finalB);
      const sortedScores = function (map) {
        return Object.keys(map).sort().map(function (name) { return [name, map[name]]; });
      };
      s.eq('双方得分按玩家名完全一致', sortedScores(scoresA), sortedScores(scoresB));
      s.ok('双方都看到同一位获胜者',
        finalA.state.players[finalA.summary.winner] &&
        finalA.state.players[finalA.summary.winner].name ===
        finalB.state.players[finalB.summary.winner].name,
        JSON.stringify({
          a: finalA.summary.winner, b: finalB.summary.winner,
          an: finalA.state.players[finalA.summary.winner] && finalA.state.players[finalA.summary.winner].name,
          bn: finalB.state.players[finalB.summary.winner] && finalB.state.players[finalB.summary.winner].name
        }));
      s.ok('结算分数为有限数字',
        finalA.state.result.scores.every(function (row) { return Number.isFinite(row.total); }),
        JSON.stringify(finalA.state.result.scores));

      const board = await call(base, 'GET', '/api/leaderboard?game=azul&limit=50');
      s.eq('排行榜接口 200', board.status, 200);
      const entry = (board.body.entries || []).find(function (item) { return item.roomId === roomId; });
      s.ok('Azul 结算进入排行榜', Boolean(entry), JSON.stringify(board.body.total));
      if (entry) {
        s.eq('排行榜 gameId=azul', entry.gameId, 'azul');
        s.eq('排行榜冠军座位与原始终局一致', entry.winnerSeat, 1);
        s.eq('排行榜分数为冠军总分', entry.score, 67);
        s.eq('排行榜参与者 2 人', entry.participants.length, 2);
        s.eq('纯人类对局 ai=false', entry.ai, false);
        s.ok('排行榜只存匿名摘要（64 hex，无 playerId）',
          entry.participants.every(function (p) {
            return typeof p.playerHash === 'string' && p.playerHash.length === 64 && !p.playerId;
          }), JSON.stringify(entry.participants));
      }

      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(A.playerId) + '&session=' + encodeURIComponent(A.session));
    });

    await s.group('AI fill for 3/4 seats uses the real engine', async function () {
      const four = await call(base, 'POST', '/api/rooms', {
        gameType: 'azul', playerId: 'host4', seed: 11, maxPlayers: 4, autoFill: true, autoFillDelayMs: 40
      });
      s.eq('4 人房创建 201', four.status, 201);
      s.eq('4 人房 playerCount=4', four.body.playerCount, 4);
      const filled = await waitFor(async function () {
        const view = (await call(base, 'GET', '/api/rooms/' + four.body.roomId)).body;
        return view && view.players && view.players.length >= 4 && view.roomStatus === 'playing' ? view : null;
      }, 3000, 25);
      s.ok('4 人房 AI 补位成功', Boolean(filled),
        JSON.stringify(filled && filled.players.map(function (p) { return [p.id, p.isAi]; })));
      if (filled) {
        s.eq('补 3 个 AI', filled.players.filter(function (p) { return p.isAi; }).length, 3);
        s.eq('4 人局 9 个圆盘', filled.state.factories.length, 9);
        s.eq('state 标记 3 个 AI', filled.state.players.filter(function (p) { return p.isAI; }).length, 3);
        s.eq('4 人局状态为 playing', filled.roomStatus, 'playing');
        const aiMoved = await waitFor(async function () {
          const view = (await call(base, 'GET', '/api/rooms/' + four.body.roomId)).body;
          return view && view.lastAction && view.lastAction.ai === true ? view : null;
        }, 2500, 25);
        s.ok('AI 用真实引擎产生动作', Boolean(aiMoved),
          JSON.stringify(aiMoved && aiMoved.lastAction));
      }
      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(four.body.roomId) +
        '?playerId=host4&session=' + encodeURIComponent(four.body.playerSession));

      const three = await call(base, 'POST', '/api/rooms', {
        gameType: 'azul', playerId: 'host3', seed: 7, maxPlayers: 3, autoFill: true, autoFillDelayMs: 40
      });
      const filled3 = await waitFor(async function () {
        const view = (await call(base, 'GET', '/api/rooms/' + three.body.roomId)).body;
        return view && view.players && view.players.length >= 3 && view.roomStatus === 'playing' ? view : null;
      }, 3000, 25);
      s.ok('3 人房 AI 补位成功', Boolean(filled3));
      if (filled3) {
        s.eq('补 2 个 AI', filled3.players.filter(function (p) { return p.isAi; }).length, 2);
        s.eq('3 人局 7 个圆盘', filled3.state.factories.length, 7);
      }
      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(three.body.roomId) +
        '?playerId=host3&session=' + encodeURIComponent(three.body.playerSession));
    });

    await s.group('timeout auto-play (托管) and reconnect clears it', async function () {
      const host = { playerId: 'idle-a', session: null };
      const guest = { playerId: 'idle-b', session: null };
      const created = await call(timeoutBase, 'POST', '/api/rooms', {
        gameType: 'azul', playerId: host.playerId, seed: 23, maxPlayers: 2, autoFill: false
      });
      host.session = created.body.playerSession;
      const roomId = created.body.roomId;
      const joined = await call(timeoutBase, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
        playerId: guest.playerId
      });
      guest.session = joined.body.playerSession;
      const activeId = joined.body.currentPlayerId;
      const active = activeId === host.playerId ? host : guest;
      const before = joined.body.stateVersion;

      await sleep(1100);
      const after = (await call(timeoutBase, 'GET', '/api/rooms/' + encodeURIComponent(roomId))).body;
      s.ok('超时后产生 autoPlayed 记录',
        Array.isArray(after.autoPlayed) && after.autoPlayed.length > 0,
        JSON.stringify(after.autoPlayed));
      s.ok('托管记录 reason=timeout',
        (after.autoPlayed || []).some(function (item) { return item.reason === 'timeout'; }),
        JSON.stringify(after.autoPlayed));
      s.eq('托管阈值暴露给客户端', after.autoPlay.timeoutMs, 300);
      s.ok('托管推进了 stateVersion', after.stateVersion > before, before + ' -> ' + after.stateVersion);
      s.ok('托管名单包含当前玩家',
        (after.autoPlay.players || []).indexOf(active.playerId) !== -1,
        JSON.stringify(after.autoPlay.players));

      const resumed = await call(timeoutBase, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', {
        token: active.session, playerId: active.playerId
      });
      s.eq('托管玩家 session 重连 200', resumed.status, 200);
      s.ok('重连后退出托管名单',
        (resumed.body.autoPlay.players || []).indexOf(active.playerId) === -1,
        JSON.stringify(resumed.body.autoPlay.players));

      await call(timeoutBase, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(host.playerId) + '&session=' + encodeURIComponent(host.session));
    });

    await s.group('privacy and direct match API', async function () {
      const pii = await call(base, 'POST', '/api/rooms', {
        gameType: 'azul', playerId: 'pii', email: 'a@example.com'
      });
      s.eq('房间创建拒绝个人信息', pii.status, 422);
      s.eq('拒绝码为 E_PII', pii.body.error.code, 'E_PII');

      const match = await call(base, 'POST', '/api/matches', {
        game: 'azul', playerCount: 4, seed: 5
      });
      s.eq('直接匹配 API 支持 Azul', match.status, 201);
      s.eq('直接匹配 4 人 9 圆盘', match.body.state.factories.length, 9);
      const actions = await call(base, 'GET', '/api/matches/' + encodeURIComponent(match.body.matchId) + '/actions');
      s.eq('直接匹配返回合法动作', actions.status, 200);
      s.ok('合法动作非空', Array.isArray(actions.body.actions) && actions.body.actions.length > 0);
      s.eq('合法动作状态为 playing', actions.body.status, 'playing');
    });
  });
} catch (err) {
  s.ok('测试 harness 未抛异常', false, err && err.stack ? err.stack : String(err));
} finally {
  if (mainApp) {
    try { await mainApp.close(); } catch (err) { /* ignore */ }
  }
  if (timeoutApp) {
    try { await timeoutApp.close(); } catch (err) { /* ignore */ }
  }
}
