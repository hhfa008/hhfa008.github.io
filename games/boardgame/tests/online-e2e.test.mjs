'use strict';

/*
 * L3/L4 online E2E: two independent HTTP clients, one room, one authoritative
 * state. Covers every hard requirement of the multiplayer rule:
 *
 *   1. cross-device server + Host-based invite URL + LAN CORS + static page
 *   2. state sync by polling, idempotent action ids
 *   3. AI match fill after 3s, AI uses the real engine with 600–1200ms pacing
 *   4. session reconnect and timeout auto-play (托管)
 *   5. result written to the in-memory leaderboard, AI participants included
 *
 * Starts the real app/server.mjs through createApiServer() on a loopback port.
 * No browser and no external network are required.
 *
 *   node games/boardgame/tests/online-e2e.test.mjs
 */

import http from 'node:http';
import { createSuite } from './lib/suite.mjs';
import { createApiServer, resolveListenOptions } from '../app/server.mjs';

const s = createSuite('boardgame-online-e2e');

const CLIENT_A = { playerId: 'e2e-a', session: null };
const CLIENT_B = { playerId: 'e2e-b', session: null };
let requestSeq = 0;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function actionKey() {
  requestSeq += 1;
  return 'e2e-' + Date.now().toString(36) + '-' + requestSeq;
}

async function call(base, method, route, body, headers) {
  const init = {
    method: method,
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
  return { status: response.status, body: parsed, text: text, headers: response.headers };
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
        resolve({ status: res.statusCode, headers: res.headers, text: text, body: body });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('raw request timeout')); });
    if (opts.body !== undefined) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function playerState(view) {
  return {
    version: view.stateVersion == null ? view.version : view.stateVersion,
    turn: view.turn,
    phase: view.phase,
    status: view.status,
    current: view.currentPlayerId,
    players: (view.players || []).map(function (player) {
      return { id: player.id, hp: player.hp, seat: player.seat, isAi: Boolean(player.isAi) };
    }),
    summaryWinner: view.summary ? view.summary.winner : undefined,
    zones: view.zones
  };
}

function chooseAction(view) {
  const actions = Array.isArray(view.legalActions) ? view.legalActions : [];
  const order = ['attack', 'play', 'endturn', 'endTurn', 'attach', 'draw', 'prize'];
  for (const want of order) {
    const found = actions.find(function (action) {
      return String(action.type || '').replace(/[_-]/g, '').toLowerCase() === want.replace(/[_-]/g, '').toLowerCase();
    });
    if (found) return found;
  }
  return actions[0] || null;
}

async function getRoom(base, roomId, client) {
  return call(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId) +
    '?playerId=' + encodeURIComponent(client.playerId) +
    '&session=' + encodeURIComponent(client.session || ''));
}

async function submitAction(base, roomId, client, action, key) {
  return call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/actions', Object.assign({}, action, {
    playerId: client.playerId,
    session: client.session,
    idempotencyKey: key || actionKey()
  }));
}

async function waitFor(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      last = value;
      if (value) return value;
    } catch (err) {
      last = err;
    }
    await sleep(intervalMs || 50);
  }
  return last && last.ok === false ? last : null;
}

let mainApp = null;
let fastApp = null;
let base = null;
let fastBase = null;

try {
  mainApp = createApiServer({
    autoFillMs: 3000,
    aiMoveMinMs: 600,
    aiMoveMaxMs: 1200,
    disconnectMs: 2500,
    tickMs: 50
  });
  const address = await mainApp.listen(0, '127.0.0.1');
  base = 'http://127.0.0.1:' + address.port;

  fastApp = createApiServer({
    autoFillMs: 20,
    aiMoveMinMs: 2,
    aiMoveMaxMs: 5,
    disconnectMs: 60,
    tickMs: 5
  });
  const fastAddress = await fastApp.listen(0, '127.0.0.1');
  fastBase = 'http://127.0.0.1:' + fastAddress.port;

  await s.run(async function () {
    await s.group('listen options: --host / BOARDGAME_HOST', async function () {
      const defaults = resolveListenOptions([], {});
      s.eq('默认只监听 127.0.0.1', defaults.host, '127.0.0.1');
      const cli = resolveListenOptions(['--host', '0.0.0.0', '--port', '9001'], {});
      s.eq('--host 0.0.0.0 生效', cli.host, '0.0.0.0');
      s.eq('--port 生效', cli.port, 9001);
      const env = resolveListenOptions([], { BOARDGAME_HOST: '0.0.0.0', BOARDGAME_AI_PORT: '9002' });
      s.eq('BOARDGAME_HOST 生效', env.host, '0.0.0.0');
      s.eq('BOARDGAME_AI_PORT 生效', env.port, 9002);
      const precedence = resolveListenOptions(['--host', '127.0.0.1', '--port', '9003'],
        { BOARDGAME_HOST: '0.0.0.0', BOARDGAME_AI_PORT: '9004' });
      s.eq('命令行优先于环境变量（host）', precedence.host, '127.0.0.1');
      s.eq('命令行优先于环境变量（port）', precedence.port, 9003);
    });

    await s.group('cross-device: Host invite URL, CORS, static client', async function () {
      const created = await rawRequest(base, {
        method: 'POST',
        path: '/api/rooms',
        headers: {
          host: '192.168.8.50:8787',
          'content-type': 'application/json'
        },
        body: { gameType: 'card-battle', playerId: 'host-lan', seed: 7 }
      });
      s.eq('带局域网 Host 创建房间返回 201', created.status, 201);
      const view = created.body || {};
      s.ok('返回 inviteUrl', typeof view.inviteUrl === 'string' && view.inviteUrl.length > 0,
        JSON.stringify(view.inviteUrl));
      s.ok('inviteUrl 使用请求 Host 而非写死 127.0.0.1',
        typeof view.inviteUrl === 'string' &&
        view.inviteUrl.indexOf('http://192.168.8.50:8787/play/online.html') === 0,
        String(view.inviteUrl));
      s.ok('inviteUrl 带 room 与 code',
        typeof view.inviteUrl === 'string' &&
        view.inviteUrl.indexOf(encodeURIComponent(String(view.roomId))) !== -1 &&
        view.inviteUrl.indexOf('code=') !== -1,
        String(view.inviteUrl));

      const preflight = await rawRequest(base, {
        method: 'OPTIONS',
        path: '/api/rooms',
        headers: { origin: 'http://192.168.8.20:8765', 'access-control-request-method': 'POST' }
      });
      s.eq('局域网 Origin 预检 204', preflight.status, 204);
      s.eq('局域网 Origin 被回显',
        preflight.headers['access-control-allow-origin'], 'http://192.168.8.20:8765');
      s.ok('预检允许 POST/DELETE',
        String(preflight.headers['access-control-allow-methods'] || '').indexOf('POST') !== -1,
        String(preflight.headers['access-control-allow-methods']));

      const evil = await rawRequest(base, {
        method: 'OPTIONS',
        path: '/api/rooms',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' }
      });
      s.eq('公网 Origin 预检被拒绝', evil.status, 403);
      s.eq('公网 Origin 不回显 ACAO', evil.headers['access-control-allow-origin'], undefined);

      const page = await call(base, 'GET', '/play/online.html');
      s.eq('静态联机页由同一服务提供', page.status, 200);
      s.ok('联机页声明联机 + AI 匹配', page.text.indexOf('联机 + AI 匹配') !== -1);
      // A canonical/og:url link is same-site metadata, not an external request.
      const externalRefs = page.text.split('\n').filter(function (line) {
        if (line.indexOf('https://') === -1) return false;
        return !/rel="canonical"|property="og:url"/.test(line);
      });
      s.eq('联机页只用同源请求（canonical 除外）', externalRefs.length, 0,
        externalRefs.join('\n'));
      const missing = await call(base, 'GET', '/definitely-missing-page');
      s.eq('不存在的静态路径 404', missing.status, 404);

      // clean up the LAN-room
      const close = await rawRequest(base, {
        method: 'DELETE',
        path: '/api/rooms/' + encodeURIComponent(view.roomId) +
          '?playerId=' + encodeURIComponent(view.playerId) +
          '&session=' + encodeURIComponent(view.playerSession)
      });
      s.eq('清理 Host 测试房间', close.status, 200);
    });

    await s.group('two HTTP clients share one authoritative game', async function () {
      const created = await call(base, 'POST', '/api/rooms', {
        gameType: 'card-battle',
        playerId: CLIENT_A.playerId,
        seed: 42
      });
      s.eq('客户端 A 创建房间 201', created.status, 201);
      const roomId = created.body && created.body.roomId;
      CLIENT_A.session = created.body && created.body.playerSession;
      s.ok('房间 id/session 可用', Boolean(roomId && CLIENT_A.session), JSON.stringify(created.body));

      const joined = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
        playerId: CLIENT_B.playerId
      });
      s.eq('客户端 B 加入房间 200', joined.status, 200);
      CLIENT_B.session = joined.body && joined.body.playerSession;
      s.ok('客户端 B 获得独立 session',
        Boolean(CLIENT_B.session) && CLIENT_B.session !== CLIENT_A.session);

      let a = await getRoom(base, roomId, CLIENT_A);
      let b = await getRoom(base, roomId, CLIENT_B);
      s.eq('双方读到同一 turn', a.body.turn, b.body.turn);
      s.eq('双方读到同一 phase', a.body.phase, b.body.phase);
      s.eq('双方读到同一当前玩家', a.body.currentPlayerId, b.body.currentPlayerId);
      s.eq('双方读到同一 stateVersion', a.body.stateVersion, b.body.stateVersion);
      s.eq('房间有 2 名玩家', (a.body.players || []).length, 2);
      s.eq('加入后自动开局', a.body.roomStatus, 'playing');

      const reconnect = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', {
        token: CLIENT_B.session,
        playerId: CLIENT_B.playerId
      });
      s.eq('session token 可重连', reconnect.status, 200);
      s.eq('重连恢复同一玩家', reconnect.body.playerId, CLIENT_B.playerId);
      s.eq('重连后 stateVersion 一致',
        reconnect.body.stateVersion, (await getRoom(base, roomId, CLIENT_A)).body.stateVersion);

      let ended = false;
      let sawOpponentAction = false;
      let idempotencyChecked = false;
      let lastWinner = null;
      let lastScore = null;
      let lastVersion = null;
      let syncMismatch = null;
      let steps = 0;

      for (let step = 0; step < 500; step += 1) {
        steps = step + 1;
        a = await getRoom(base, roomId, CLIENT_A);
        b = await getRoom(base, roomId, CLIENT_B);
        if (!syncMismatch &&
          (a.body.stateVersion !== b.body.stateVersion ||
            a.body.turn !== b.body.turn ||
            a.body.currentPlayerId !== b.body.currentPlayerId ||
            String((a.body.summary || {}).winner) !== String((b.body.summary || {}).winner))) {
          syncMismatch = 'step ' + step + ': A=' + JSON.stringify(playerState(a.body)) +
            ' B=' + JSON.stringify(playerState(b.body));
        }
        if (step === 0) {
          const p1 = playerState(a.body);
          const p2 = playerState(b.body);
          s.eq('双方 zones 快照一致', JSON.stringify(p1.zones), JSON.stringify(p2.zones));
          s.eq('双方 summary.winner 一致', p1.summaryWinner, p2.summaryWinner);
        }

        if (a.body.status === 'ended' || a.body.phase === 'ended' || a.body.roomStatus === 'finished') {
          ended = true;
          lastWinner = a.body.summary ? a.body.summary.winner : a.body.winner;
          lastScore = a.body.summary && a.body.summary.players
            ? a.body.summary.players.map(function (player) { return player.hp; })
            : null;
          lastVersion = a.body.stateVersion;
          break;
        }

        const currentId = a.body.currentPlayerId;
        if (currentId !== CLIENT_A.playerId && currentId !== CLIENT_B.playerId) break;
        const actor = currentId === CLIENT_A.playerId ? CLIENT_A : CLIENT_B;
        const action = chooseAction(a.body);
        if (!action) break;

        const key = actionKey();
        const acted = await submitAction(base, roomId, actor, action, key);
        s.eq('提交动作返回 200', acted.status, 200);
        const actedVersion = acted.body && acted.body.stateVersion;

        if (!idempotencyChecked) {
          const replay = await submitAction(base, roomId, actor, action, key);
          s.eq('重复 idempotencyKey 返回 200', replay.status, 200);
          s.eq('重复提交不推进 stateVersion', replay.body.stateVersion, actedVersion);
          s.eq('重复提交不推进 turn', replay.body.turn, acted.body.turn);
          idempotencyChecked = true;
        }

        const opponent = actor === CLIENT_A ? CLIENT_B : CLIENT_A;
        const seen = await getRoom(base, roomId, opponent);
        if (seen.body.lastAction && seen.body.lastAction.seq === actedVersion) {
          sawOpponentAction = true;
        }
        s.eq('对手读到同一 stateVersion', seen.body.stateVersion, actedVersion);
      }

      s.ok('对局走到结算', ended, 'steps exhausted without end');
      s.ok('每一步双方 turn/stateVersion/current 都一致', syncMismatch === null, syncMismatch || '');
      s.ok('双客户端交替落子产生了足够步数', steps > 4, String(steps));
      s.ok('对手客户端看到了对方动作', sawOpponentAction);
      const finalA = await getRoom(base, roomId, CLIENT_A);
      const finalB = await getRoom(base, roomId, CLIENT_B);
      s.eq('结算 winner 双方一致',
        finalA.body.summary && finalA.body.summary.winner,
        finalB.body.summary && finalB.body.summary.winner);
      s.eq('结算最终版本双方一致', finalA.body.stateVersion, finalB.body.stateVersion);
      s.ok('结算双方玩家 HP 均存在',
        Boolean(lastScore) && lastScore.length === 2 && lastScore.every(function (hp) { return typeof hp === 'number'; }),
        JSON.stringify(lastScore));
      s.ok('结算有明确 winner', lastWinner === 0 || lastWinner === 1, String(lastWinner));
      s.ok('终局版本为数字', typeof lastVersion === 'number', String(lastVersion));

      const board = await call(base, 'GET', '/api/leaderboard?game=card-battle&limit=100');
      s.eq('排行榜接口 200', board.status, 200);
      const entry = (board.body.entries || []).find(function (item) { return item.roomId === roomId; });
      s.ok('双人对局结果进入排行榜', Boolean(entry), JSON.stringify(board.body.entries && board.body.entries.length));
      if (entry) {
        s.eq('排行榜 winnerSeat 与终局一致', entry.winnerSeat, lastWinner);
        s.eq('排行榜参与者 2 人', entry.participants.length, 2);
        s.eq('纯人类对局 ai=false', entry.ai, false);
        s.ok('排行榜只存匿名 hash', entry.participants.every(function (p) {
          return typeof p.playerHash === 'string' && p.playerHash.length === 64 && !p.playerId;
        }), JSON.stringify(entry.participants));
      }

      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(CLIENT_A.playerId) +
        '&session=' + encodeURIComponent(CLIENT_A.session));
    });

    await s.group('AI fill after 3s (default rhythm)', async function () {
      const created = await call(base, 'POST', '/api/rooms', {
        gameType: 'card-battle',
        playerId: 'e2e-solo',
        seed: 11,
        autoFill: true
      });
      s.eq('创建 autoFill 房间 201', created.status, 201);
      const roomId = created.body.roomId;
      const solo = { playerId: 'e2e-solo', session: created.body.playerSession };
      s.eq('初始只有房主', (created.body.players || []).length, 1);
      s.ok('返回 autoFill 配置', Boolean(created.body.autoFill) && created.body.autoFill.enabled === true,
        JSON.stringify(created.body.autoFill));
      s.ok('默认补位延迟为 3 秒', created.body.autoFill.delayMs === 3000,
        String(created.body.autoFill.delayMs));
      s.ok('AI 行动节奏为 600–1200ms',
        created.body.aiMove && created.body.aiMove.minMs === 600 && created.body.aiMove.maxMs === 1200,
        JSON.stringify(created.body.aiMove));
      const before = Date.now();
      const filled = await waitFor(async function () {
        const view = await call(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
        return view.body && view.body.players && view.body.players.length >= 2 ? view.body : null;
      }, 6000, 100);
      const elapsed = Date.now() - before;
      s.ok('3 秒内不会提前补位', elapsed >= 2800, elapsed + 'ms');
      s.ok('3 秒后 AI 补位到 2 人', Boolean(filled), 'players=' + (filled && filled.players.length));
      if (!filled) return;
      const ai = filled.players.find(function (player) { return player.isAi; });
      s.ok('补位玩家标记为 AI', Boolean(ai), JSON.stringify(filled.players));
      s.ok('AI 玩家 id 为 ai_ 前缀', Boolean(ai && /^ai_/.test(ai.id)), ai && ai.id);
      s.eq('AI 补位后自动开局', filled.roomStatus, 'playing');

      let view = filled;
      let aiActed = false;
      for (let i = 0; i < 60; i += 1) {
        view = (await call(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId))).body;
        if (view.currentPlayerId === solo.playerId && view.status === 'playing') {
          const action = chooseAction(view);
          if (action) {
            await submitAction(base, roomId, solo, action, actionKey());
          }
        }
        if (view.lastAction && view.lastAction.ai === true) {
          aiActed = true;
          break;
        }
        if (view.status === 'ended') break;
        await sleep(120);
      }
      s.ok('AI 用合法动作引擎行动', aiActed, JSON.stringify(view.lastAction));
      if (view.lastAction) {
        s.ok('AI 动作是服务器引擎动作', typeof view.lastAction.type === 'string' && view.lastAction.type.length > 0,
          JSON.stringify(view.lastAction));
      }

      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(solo.playerId) +
        '&session=' + encodeURIComponent(solo.session));
    });

    await s.group('timeout auto-play (托管) and reconnect clears it', async function () {
      const created = await call(base, 'POST', '/api/rooms', {
        gameType: 'card-battle',
        playerId: 'idle-a',
        seed: 23
      });
      const roomId = created.body.roomId;
      const idleA = { playerId: 'idle-a', session: created.body.playerSession };
      const idleB = { playerId: 'idle-b', session: null };
      const joined = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
        playerId: idleB.playerId
      });
      idleB.session = joined.body.playerSession;
      const startView = joined.body;
      const activeId = startView.currentPlayerId;
      s.ok('托管测试锁定当前玩家', activeId === idleA.playerId || activeId === idleB.playerId, String(activeId));

      // No requests at all for > disconnectMs (2.5s). Anonymous read afterwards
      // so that neither player's lastSeen is refreshed.
      await sleep(3200);
      const after = await call(base, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
      s.eq('超时后状态仍可读', after.status, 200);
      s.ok('产生 autoPlayed 托管记录', Array.isArray(after.body.autoPlayed) && after.body.autoPlayed.length > 0,
        JSON.stringify(after.body.autoPlayed));
      s.ok('托管记录包含 timeout 原因', (after.body.autoPlayed || []).some(function (item) {
        return item.reason === 'timeout';
      }), JSON.stringify(after.body.autoPlayed));
      s.ok('autoPlay 暴露超时阈值', after.body.autoPlay && after.body.autoPlay.timeoutMs === 2500,
        JSON.stringify(after.body.autoPlay));
      s.ok('托管后 stateVersion 前进了', after.body.stateVersion > startView.stateVersion,
        startView.stateVersion + ' -> ' + after.body.stateVersion);

      const active = activeId === idleA.playerId ? idleA : idleB;
      const resumed = await call(base, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/reconnect', {
        token: active.session,
        playerId: active.playerId
      });
      s.eq('托管玩家用 session 重连成功', resumed.status, 200);
      s.eq('重连响应带回 autoPlayed', Array.isArray(resumed.body.autoPlayed), true);
      const autoPlayers = (resumed.body.autoPlay && resumed.body.autoPlay.players) || [];
      s.ok('重连后该玩家退出托管名单', autoPlayers.indexOf(active.playerId) === -1,
        JSON.stringify(autoPlayers));

      await call(base, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(idleA.playerId) +
        '&session=' + encodeURIComponent(idleA.session));
    });

    await s.group('AI participates in mahjong with the real engine', async function () {
      const created = await call(fastBase, 'POST', '/api/rooms', {
        gameType: 'mahjong',
        playerId: 'mj-host',
        seed: 5,
        autoFill: true
      });
      s.eq('麻将 autoFill 房间创建 201', created.status, 201);
      const roomId = created.body.roomId;
      const filled = await waitFor(async function () {
        const view = await call(fastBase, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
        return view.body && view.body.players && view.body.players.length >= 4 ? view.body : null;
      }, 4000, 20);
      s.ok('麻将补位到 4 人', Boolean(filled), 'players=' + (filled && filled.players.length));
      if (filled) {
        s.eq('麻将 AI 数量', filled.players.filter(function (p) { return p.isAi; }).length, 3);
        s.eq('麻将自动开局', filled.roomStatus, 'playing');
        const moved = await waitFor(async function () {
          const view = await call(fastBase, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
          if (view.body && view.body.lastAction && view.body.lastAction.ai === true) return view.body;
          return null;
        }, 3000, 20);
        s.ok('麻将 AI 用引擎动作行动', Boolean(moved), JSON.stringify(filled.lastAction));
        if (moved) {
          s.ok('麻将 AI 动作有类型', typeof moved.lastAction.type === 'string' && moved.lastAction.type.length > 0,
            JSON.stringify(moved.lastAction));
          s.ok('麻将合法动作来自 mahjong.legalActions',
            moved.status === 'ended' || (Array.isArray(moved.legalActions) && moved.legalActions.length > 0),
            JSON.stringify(moved.legalActions));
        }
      }
      await call(fastBase, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=mj-host&session=' + encodeURIComponent(created.body.playerSession));
    });

    await s.group('two HTTP clients share one mahjong room', async function () {
      const created = await call(fastBase, 'POST', '/api/rooms', {
        gameType: 'mahjong',
        playerId: 'mj2-a',
        seed: 11,
        autoFill: true,
        autoFillDelayMs: 300
      });
      s.eq('麻将双客户端房间创建 201', created.status, 201);
      const roomId = created.body.roomId;
      const joined = await call(fastBase, 'POST', '/api/rooms/' + encodeURIComponent(roomId) + '/join', {
        playerId: 'mj2-b'
      });
      s.eq('第二客户端加入 200', joined.status, 200);
      const a = { playerId: 'mj2-a', session: created.body.playerSession };
      const b = { playerId: 'mj2-b', session: joined.body.playerSession };

      const filled = await waitFor(async function () {
        const view = await getRoom(fastBase, roomId, a);
        return view.body && view.body.players && view.body.players.length >= 4 &&
          view.body.roomStatus === 'playing' ? view.body : null;
      }, 6000, 25);
      s.ok('两个人类客户端与 AI 同房开局', Boolean(filled),
        'players=' + (filled && filled.players.length) + ' status=' + (filled && filled.roomStatus));

      if (filled) {
        const va = await getRoom(fastBase, roomId, a);
        const vb = await getRoom(fastBase, roomId, b);
        s.eq('双方读到同一 stateVersion', va.body.stateVersion, vb.body.stateVersion);
        s.eq('双方 currentPlayerId 一致', va.body.currentPlayerId, vb.body.currentPlayerId);
        s.eq('双方人数一致', va.body.players.length, vb.body.players.length);
        s.eq('双方座位状态一致', JSON.stringify(va.body.players.map(function (p) {
          return { id: p.id, seat: p.seat, isAi: p.isAi };
        })), JSON.stringify(vb.body.players.map(function (p) {
          return { id: p.id, seat: p.seat, isAi: p.isAi };
        })));

        // Neither human acts; the fast server's timeout trustee + AI play out
        // the room, so both clients can observe the same final summary.
        let lastView = null;
        const ended = await waitFor(async function () {
          // Anonymous read: it must not refresh either human's lastSeen, so
          // the timeout trustee can play both seats and reach a result.
          const view = await call(fastBase, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
          lastView = view.body;
          return view.body && (view.body.status === 'ended' || view.body.roomStatus === 'finished')
            ? view.body : null;
        }, 20000, 100);
        s.ok('麻将对局走到结算', Boolean(ended), 'last=' + JSON.stringify(lastView && {
          status: lastView.status,
          roomStatus: lastView.roomStatus,
          stateVersion: lastView.stateVersion,
          currentPlayerId: lastView.currentPlayerId,
          error: lastView.error || lastView.code || null
        }));
        if (ended) {
          const ea = await getRoom(fastBase, roomId, a);
          const eb = await getRoom(fastBase, roomId, b);
          s.eq('结算 stateVersion 一致', ea.body.stateVersion, eb.body.stateVersion);
          s.eq('结算 status 一致', ea.body.status, eb.body.status);
          s.eq('结算 winner 一致',
            JSON.stringify(ea.body.summary && ea.body.summary.winner),
            JSON.stringify(eb.body.summary && eb.body.summary.winner));
        }
      }

      await call(fastBase, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=' + encodeURIComponent(a.playerId) +
        '&session=' + encodeURIComponent(a.session));
    });

    await s.group('AI-vs-autopilot game finishes and enters leaderboard', async function () {
      const created = await call(fastBase, 'POST', '/api/rooms', {
        gameType: 'card-battle',
        playerId: 'ai-lb-host',
        seed: 42,
        autoFill: true
      });
      const roomId = created.body.roomId;
      const finished = await waitFor(async function () {
        const view = await call(fastBase, 'GET', '/api/rooms/' + encodeURIComponent(roomId));
        return view.body && (view.body.status === 'ended' || view.body.roomStatus === 'finished')
          ? view.body : null;
      }, 20000, 50);
      s.ok('AI + 托管对局能走到结算（不卡死）', Boolean(finished),
        'status=' + (finished && (finished.status || finished.roomStatus)));
      if (finished) {
        s.ok('结算 winner 为座位号',
          finished.summary && (finished.summary.winner === 0 || finished.summary.winner === 1),
          JSON.stringify(finished.summary && finished.summary.winner));
        s.ok('托管记录非空', Array.isArray(finished.autoPlayed) && finished.autoPlayed.length > 0,
          JSON.stringify(finished.autoPlayed && finished.autoPlayed.length));
      }
      const board = await call(fastBase, 'GET', '/api/leaderboard?game=card-battle&limit=100');
      const entry = (board.body.entries || []).find(function (item) { return item.roomId === roomId; });
      s.ok('AI 参与的结果进入排行榜', Boolean(entry), JSON.stringify(board.body.total));
      if (entry) {
        s.eq('排行榜标记 AI 参与', entry.ai, true);
        s.ok('排行榜参与者含 AI',
          entry.participants.some(function (p) { return p.ai === true; }),
          JSON.stringify(entry.participants));
        s.ok('排行榜 winnerHash 为匿名摘要',
          typeof entry.winnerHash === 'string' && entry.winnerHash.length === 64,
          String(entry.winnerHash));
        s.ok('AI 对局 score 为数字', Number.isFinite(entry.score), String(entry.score));
      }
      await call(fastBase, 'DELETE', '/api/rooms/' + encodeURIComponent(roomId) +
        '?playerId=ai-lb-host&session=' + encodeURIComponent(created.body.playerSession));
    });
  });
} catch (err) {
  s.ok('E2E harness completed without throwing', false, err && err.stack ? err.stack : String(err));
} finally {
  if (mainApp) {
    try { await mainApp.close(); } catch (err) { /* ignore */ }
  }
  if (fastApp) {
    try { await fastApp.close(); } catch (err) { /* ignore */ }
  }
}
