#!/usr/bin/env node
'use strict';

/*
 * 桌游 HTTP/JSON API（机器可调用，无第三方依赖）。
 *
 * 仅监听 127.0.0.1，供本地 AI / dsh 插件 / 测试使用：
 *   GET  /health | /api/health | /
 *   POST /api/matches                     开一局
 *   GET  /api/matches/:id                 读状态
 *   GET  /api/matches/:id/actions         合法动作
 *   POST /api/matches/:id/actions         执行动作
 *   POST /api/ai/evaluate                 评估动作
 *   POST /api/rooms                       创建房间
 *   POST /api/rooms/:id/join              加入房间（密码/邀请码）
 *   GET  /api/rooms/:id                   查询房间状态
 *   POST /api/rooms/:id/actions           在房间内落子/执行动作
 *   POST /api/rooms/:id/start             房主开始对局
 *   POST /api/rooms/:id/reconnect         用 session 重连
 *   POST /api/rooms/:id/leave             离开房间
 *   DELETE /api/rooms/:id                 房主关闭房间
 *   POST /api/rooms/:id/voice/token       语音接口位（仅成员鉴权）
 *
 * 隐私：只保存匿名设备 id（x-device-id 或随机 dev_<hex>），不接收姓名、
 * 邮箱、手机号等个人信息。可选鉴权：设置 BOARDGAME_API_TOKEN 后要求
 * Authorization: Bearer <token>。
 *
 * 启动：node app/server.mjs --port 8787
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  CARD_POOL,
  createGame,
  legalActions,
  draw,
  playCard,
  attachEnergy,
  attack,
  endTurn,
  takePrize,
  summarize
} from './cardgame.js';
import { createRoomStoreInternal } from './rooms.js';
import * as mahjong from './mahjong.js';

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
const ANON_PREFIX = 'dev_';

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function makeMatchId() {
  return 'match_' + Date.now().toString(36) + '_' + randomHex(4);
}

function deviceIdOf(req, body) {
  const header = req.headers['x-device-id'];
  const candidate = (typeof header === 'string' && header) ||
    (body && typeof body.deviceId === 'string' && body.deviceId) || '';
  if (/^[A-Za-z0-9_-]{6,128}$/.test(candidate)) return candidate;
  return ANON_PREFIX + randomHex(16);
}

function makeDeck() {
  const deck = [];
  while (deck.length < 60) {
    deck.push(CARD_POOL[deck.length % CARD_POOL.length].id);
  }
  return deck;
}

function currentIndexOf(state) {
  return (state.turn + (state.first || 0)) % state.players.length;
}

function normalizeGameType(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (raw === 'mahjong' || raw === 'mj' || raw === '麻将') return 'mahjong';
  return 'card-battle';
}

function zoneView(player) {
  return {
    id: player.index,
    name: player.name,
    hand: player.hand.slice(),
    deck: player.deck.slice(),
    prizes: (player.prizes || []).slice(),
    discard: player.discard.slice(),
    bench: (player.bench || []).slice(),
    active: player.active ? JSON.parse(JSON.stringify(player.active)) : null
  };
}

function mahjongZoneView(state, index) {
  return {
    id: index,
    name: 'P' + (index + 1),
    hand: state.hands[index].slice(),
    river: state.rivers[index].slice(),
    melds: (state.melds[index] || []).slice()
  };
}

function mahjongMatchView(match) {
  const state = match.state;
  return {
    matchId: match.id,
    game: 'mahjong',
    status: state.phase === 'ended' ? 'ended' : 'playing',
    phase: state.phase,
    turn: state.turn,
    current: state.currentPlayer,
    players: state.hands.map(function (hand, index) {
      return {
        id: index,
        name: 'P' + (index + 1),
        hand: hand.length,
        river: state.rivers[index].length,
        melds: (state.melds[index] || []).length
      };
    }),
    zones: { players: state.hands.map(function (_, index) { return mahjongZoneView(state, index); }) },
    wallLeft: state.wall.length - state.wallIndex,
    deviceId: match.deviceId,
    summary: mahjong.summarize(state)
  };
}

function matchView(match) {
  if (match.game === 'mahjong') return mahjongMatchView(match);
  const state = match.state;
  return {
    matchId: match.id,
    status: state.phase === 'playing' ? 'playing' : 'ended',
    phase: state.phase,
    turn: state.turn,
    current: currentIndexOf(state),
    players: state.players.map(function (player) {
      return {
        id: player.index,
        name: player.name,
        hp: player.hp,
        hand: player.hand.length,
        deck: player.deck.length,
        prizes: (player.prizes || []).length
      };
    }),
    zones: { players: state.players.map(zoneView) },
    deviceId: match.deviceId,
    summary: summarize(state)
  };
}

function actionView(action) {
  if (!action) return null;
  const view = { type: action.type };
  if (action.cardId) view.cardId = action.cardId;
  if (action.target) view.target = action.target;
  if (action.card) view.card = action.card;
  if (action.tile) view.tile = action.tile;
  if (Number.isInteger(action.playerIndex)) view.playerIndex = action.playerIndex;
  return view;
}

function evaluationFor(input) {
  const body = input || {};
  const actions = Array.isArray(body.actions) ? body.actions : [];
  const state = body.state || {};
  const preferred = ['attack', 'play', 'attach', 'draw', 'end-turn'];
  let chosen = null;
  for (let i = 0; i < preferred.length; i += 1) {
    const found = actions.find(function (action) {
      if (typeof action === 'string') return action === preferred[i] || action === preferred[i].replace('-', '');
      return action && (action.type === preferred[i] || action.type === preferred[i].replace('-', ''));
    });
    if (found) { chosen = found; break; }
  }
  if (!chosen) chosen = actions[0] || 'end-turn';
  const hand = Number(state.handSize) || 0;
  const prizes = Number(state.prizesRemaining) || 0;
  const score = Math.max(0, Math.min(100,
    40 + hand * 2 + prizes - (state.turn || 0) * 2
  ));
  return {
    score: score,
    action: chosen,
    recommended: chosen,
    best: chosen,
    reason: '优先攻击/出牌，保留 end-turn 兜底；手牌与奖赏卡越多分数越高。'
  };
}

function matchCurrentIndex(match) {
  if (match.game === 'mahjong') return match.state.currentPlayer;
  return currentIndexOf(match.state);
}

function matchLegalActions(match) {
  if (!match.state || match.state.phase === 'ended') return [];
  if (match.game === 'mahjong') {
    return mahjong.legalActions(match.state).map(actionView);
  }
  return legalActions(match.state, currentIndexOf(match.state)).map(actionView);
}

function roomView(room, match) {
  const base = matchView(match);
  const currentSeat = base.current;
  const players = room.players.map(function (playerId, seat) {
    const gamePlayer = base.players[seat] || {};
    return Object.assign({}, gamePlayer, {
      id: playerId,
      seat: seat,
      nickname: playerId,
      game: gamePlayer
    });
  });
  const status = room.status === 'waiting' || room.status === 'ready'
    ? room.status
    : base.status;
  return Object.assign({}, base, {
    roomId: room.id,
    inviteCode: room.code,
    gameType: match.game,
    hostId: room.hostId,
    visibility: room.visibility,
    hasPassword: room.hasPassword,
    roomStatus: room.status,
    status: status,
    players: players,
    currentPlayerId: room.players[currentSeat] || null,
    actionsFor: room.players[currentSeat] || null,
    legalActions: matchLegalActions(match),
    createdAt: room.createdAt,
    expiresAt: room.expiresAt
  });
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 'E_BODY' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(Object.assign(new Error('invalid JSON'), { code: 'E_JSON' }));
      }
    });
    req.on('error', reject);
  });
}

function authorized(req) {
  const token = process.env.BOARDGAME_API_TOKEN;
  if (!token) return true;
  return req.headers.authorization === 'Bearer ' + token;
}

export function createApiServer(options) {
  const opts = options || {};
  const matches = new Map();
  const idempotency = new Map(); // matchId -> Map(key, response)
  const roomStore = opts.roomStore || createRoomStoreInternal();
  const roomMatches = new Map(); // roomId -> match
  const sessions = new Map(); // session token -> { roomId, playerId }

  function getMatch(id) {
    return matches.get(id) || null;
  }

  function error(res, status, code, message) {
    sendJson(res, status, { error: { code: code, message: message } });
  }

  function issueSession(roomId, playerId) {
    const token = 'sess_' + randomHex(12);
    sessions.set(token, { roomId: roomId, playerId: playerId });
    return token;
  }

  function sessionInfo(token) {
    if (typeof token !== 'string' || !token) return null;
    return sessions.get(token) || null;
  }

  function actorOfRoom(body, room, optsQuery) {
    const input = body || {};
    const query = optsQuery || {};
    const token = input.session || input.playerSession || input.token ||
      query.session || query.playerSession || query.token;
    const session = sessionInfo(token);
    if (token && !session) return { ok: false, status: 403, code: 'E_SESSION', message: 'invalid session token' };
    if (session && session.roomId !== room.id) {
      return { ok: false, status: 403, code: 'E_SESSION', message: 'session does not belong to this room' };
    }
    const playerId = input.playerId || input.userId ||
      query.playerId || query.userId ||
      (session && session.playerId) || null;
    if (!playerId) return { ok: false, status: 401, code: 'E_PLAYER', message: 'playerId or session is required' };
    if (room.players.indexOf(playerId) === -1) {
      return { ok: false, status: 403, code: 'E_PLAYER', message: 'not a member of this room' };
    }
    if (session && session.playerId !== playerId) {
      return { ok: false, status: 403, code: 'E_SESSION', message: 'session does not match playerId' };
    }
    return { ok: true, playerId: playerId, session: session ? token : null };
  }

  function makeGameState(gameType, seed) {
    if (gameType === 'mahjong') {
      return mahjong.createGame({ seed: seed });
    }
    return createGame({
      seed: seed,
      deck: makeDeck(),
      handSize: 7,
      playerHp: 20,
      prizeCards: 6,
      names: ['P1', 'P2']
    });
  }

  function createMatchRecord(gameType, seed, deviceId) {
    const game = normalizeGameType(gameType);
    const match = {
      id: makeMatchId(),
      game: game,
      ai: false,
      createdAt: Date.now(),
      deviceId: deviceId,
      state: makeGameState(game, seed)
    };
    matches.set(match.id, match);
    idempotency.set(match.id, new Map());
    return match;
  }

  function roomWithMatch(roomIdOrCode) {
    const room = roomStore.get(roomIdOrCode);
    if (!room) return null;
    const match = roomMatches.get(room.id);
    if (!match) return null;
    return { room: room, match: match };
  }

  function roomError(res, failure) {
    const status = failure && failure.status ? failure.status : 409;
    const code = failure && failure.code ? failure.code : 'E_ROOM';
    const message = failure && failure.message ? failure.message : 'room operation rejected';
    return error(res, status, code, message);
  }

  function requireMatch(res, id) {
    const match = getMatch(id);
    if (!match) {
      error(res, 404, 'E_NOT_FOUND', 'match not found');
      return null;
    }
    return match;
  }

  function createMatch(body, req) {
    const seed = Number.isFinite(body.seed) ? body.seed >>> 0 : (Date.now() >>> 0);
    const match = createMatchRecord(body.game, seed, deviceIdOf(req, body));
    match.ai = Boolean(body.ai);
    return match;
  }

  function applyCardAction(match, body) {
    const state = match.state;
    const current = currentIndexOf(state);
    const rawType = String(body.type || body.action || '').trim();
    const type = rawType.toLowerCase().replace(/[_-]/g, '');

    if (!type) return { ok: false, status: 422, code: 'E_INVALID_ARGS', message: 'type is required' };
    if (type === 'endturn') return endTurn(state, current);
    if (type === 'draw') return draw(state, current, 1);
    if (type === 'play') return playCard(state, current, body.cardId);
    if (type === 'attach') return attachEnergy(state, current, body.cardId, body.target);
    if (type === 'attack') return attack(state, current);
    if (type === 'prize' || type === 'takeprize') return takePrize(state, current);
    return { ok: false, status: 422, code: 'E_INVALID_ACTION', message: 'unknown action: ' + rawType };
  }

  function applyMahjongAction(match, body) {
    const state = match.state;
    const rawType = String(body.type || body.action || '').trim();
    const type = rawType.toLowerCase().replace(/[_-]/g, '');
    if (!type) return { ok: false, status: 422, code: 'E_INVALID_ARGS', message: 'type is required' };
    if (type === 'discard') {
      const tile = body.tile || body.cardId;
      if (!tile) return { ok: false, status: 422, code: 'E_INVALID_ARGS', message: 'tile is required' };
      return mahjong.discard(state, tile);
    }
    if (type === 'tsumo' || type === 'selfdraw' || type === 'win') {
      return mahjong.selfDrawWin(state, state.currentPlayer);
    }
    if (type === 'claim') {
      return mahjong.claimWin(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined);
    }
    if (type === 'pass' || type === 'passclaim') return mahjong.passClaim(state);
    if (type === 'draw') {
      const tile = mahjong.draw(state);
      if (tile == null && state.phase !== 'ended') {
        return { ok: false, status: 409, code: 'E_STATE', message: 'cannot draw right now' };
      }
      return { ok: true, state: state, tile: tile };
    }
    return { ok: false, status: 422, code: 'E_INVALID_ACTION', message: 'unknown action: ' + rawType };
  }

  function applyMatchAction(match, body) {
    if (match.game === 'mahjong') return applyMahjongAction(match, body || {});
    return applyCardAction(match, body || {});
  }

  const server = http.createServer(function (req, res) {
    res.on('error', function () {});
    if (!authorized(req)) {
      return error(res, 401, 'E_AUTH', 'missing or invalid bearer token');
    }

    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/api/health')) {
      return sendJson(res, 200, {
        ok: true,
        status: 'ok',
        service: 'boardgame-ai-api',
        name: 'boardgame',
        version: '1.0.0',
        capabilities: ['matches', 'legal-actions', 'actions', 'ai-evaluate',
          'rooms', 'room-actions', 'room-sessions', 'anonymous-device-id'],
        matches: matches.size,
        rooms: roomMatches.size
      });
    }

    if (req.method === 'POST' && path === '/api/matches') {
      return readJsonBody(req).then(function (body) {
        if (body && (body.email || body.phone || body.name)) {
          return error(res, 422, 'E_PII', 'personal information is not accepted');
        }
        const match = createMatch(body || {}, req);
        sendJson(res, 201, matchView(match));
      }).catch(function (err) {
        error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
      });
    }

    if (req.method === 'POST' && path === '/api/ai/evaluate') {
      return readJsonBody(req).then(function (body) {
        sendJson(res, 200, {
          evaluation: evaluationFor(body || {}),
          game: (body && body.game) || 'pokemon'
        });
      }).catch(function (err) {
        error(res, 400, err.code || 'E_JSON', err.message);
      });
    }

    const matchRoute = path.match(/^\/api\/matches\/([^/]+)(\/actions)?$/);
    if (matchRoute) {
      const match = requireMatch(res, decodeURIComponent(matchRoute[1]));
      if (!match) return;
      const wantActions = matchRoute[2] === '/actions';

      if (!wantActions && req.method === 'GET') {
        return sendJson(res, 200, matchView(match));
      }

      if (wantActions && req.method === 'GET') {
        const current = matchCurrentIndex(match);
        const actions = matchLegalActions(match);
        return sendJson(res, 200, {
          matchId: match.id,
          turn: match.state.turn,
          current: current,
          actions: actions,
          status: match.state.phase
        });
      }

      if (wantActions && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const key = body && body.idempotencyKey;
          const cache = idempotency.get(match.id) || new Map();
          idempotency.set(match.id, cache);
          if (key && cache.has(key)) {
            return sendJson(res, 200, cache.get(key));
          }
          const result = applyMatchAction(match, body || {});
          if (!result.ok) {
            return error(res, result.status || 409, result.code || 'E_ACTION', result.message || 'action rejected');
          }
          const payload = matchView(match);
          payload.action = actionView({ type: (body && (body.type || body.action)) || 'unknown' });
          if (key) cache.set(key, payload);
          sendJson(res, 200, payload);
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      return error(res, 405, 'E_METHOD', 'method not allowed');
    }

    if (req.method === 'POST' && path === '/api/rooms') {
      return readJsonBody(req).then(function (body) {
        const input = body || {};
        if (input.email || input.phone) {
          return error(res, 422, 'E_PII', 'personal information is not accepted');
        }
        const playerId = input.playerId || input.hostId || input.userId;
        if (!playerId) {
          return error(res, 422, 'E_INVALID_ARGS', 'playerId is required');
        }
        const gameType = normalizeGameType(input.gameType || input.gameId || input.game);
        const seed = Number.isFinite(input.seed) ? input.seed >>> 0 : (Date.now() >>> 0);
        let created;
        try {
          created = roomStore.create({
            hostId: playerId,
            gameId: gameType,
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: gameType === 'mahjong' ? 4 : 2,
            nickname: playerId
          });
        } catch (err) {
          return error(res, 422, err.code || 'E_ROOM', err.message || 'cannot create room');
        }
        const match = createMatchRecord(gameType, seed, deviceIdOf(req, input));
        roomMatches.set(created.room.id, match);
        const session = issueSession(created.room.id, playerId);
        const view = roomView(created.room, match);
        return sendJson(res, 201, Object.assign({}, view, {
          ok: true,
          roomId: created.room.id,
          inviteCode: created.room.code,
          inviteToken: created.invite ? created.invite.token : null,
          playerSession: session,
          playerId: playerId,
          seed: seed
        }));
      }).catch(function (err) {
        error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
      });
    }

    const roomRoute = path.match(/^\/api\/rooms\/([^/]+)(?:\/(join|actions|start|reconnect|leave|voice\/token))?$/);
    if (roomRoute) {
      const roomId = decodeURIComponent(roomRoute[1]);
      const actionName = roomRoute[2] || null;
      const found = roomWithMatch(roomId);
      if (!found) return error(res, 404, 'E_NOT_FOUND', 'room not found');
      const room = found.room;
      const match = found.match;

      if (!actionName && req.method === 'GET') {
        const token = url.searchParams.get('session') || url.searchParams.get('playerSession') ||
          url.searchParams.get('token');
        const queryPlayer = url.searchParams.get('playerId') || url.searchParams.get('userId');
        const session = sessionInfo(token);
        if (token && !session) {
          return error(res, 403, 'E_SESSION', 'invalid session token');
        }
        if (session && (session.roomId !== room.id || (queryPlayer && session.playerId !== queryPlayer))) {
          return error(res, 403, 'E_SESSION', 'session does not belong to this room');
        }
        const playerId = queryPlayer || (session && session.playerId) || null;
        if (room.visibility === 'private' && (!playerId || room.players.indexOf(playerId) === -1)) {
          return error(res, 403, 'E_PRIVATE', 'private room requires a member session');
        }
        if (playerId && !session && room.players.indexOf(playerId) === -1) {
          return error(res, 403, 'E_PLAYER', 'not a member of this room');
        }
        return sendJson(res, 200, roomView(room, match));
      }

      if (actionName === 'join' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const playerId = (body && (body.playerId || body.userId)) || null;
          if (!playerId) return error(res, 422, 'E_INVALID_ARGS', 'playerId is required');
          const inviteCode = body && (body.inviteCode || body.inviteToken);
          let result;
          if (inviteCode && inviteCode !== room.code) {
            const verified = roomStore.verifyInvite(inviteCode);
            if (!verified.ok) return error(res, 403, 'E_INVITE', 'invalid or expired invite');
            result = roomStore.consumeInvite(inviteCode, { playerId: playerId, nickname: playerId });
          } else {
            result = roomStore.join(room.id, {
              playerId: playerId,
              password: body && body.password,
              nickname: playerId
            });
          }
          if (!result.ok) {
            const status = result.code === 'E_PASSWORD' || result.code === 'E_INVITE' ? 403
              : result.code === 'E_LOCKED' ? 423
                : result.code === 'E_FULL' ? 409
                  : result.code === 'E_NOT_FOUND' ? 404
                    : result.code === 'E_PLAYER' ? 422 : 409;
            return error(res, status, result.code || 'E_JOIN', result.message || 'join rejected');
          }
          const joined = roomStore.get(room.id) || result.room;
          const shouldStart = (joined.gameId === 'mahjong' && joined.players.length >= 4) ||
            (joined.gameId !== 'mahjong' && joined.players.length >= 2);
          if (shouldStart && (joined.status === 'waiting' || joined.status === 'ready')) {
            roomStore.start(joined.id, joined.hostId);
          }
          const current = roomStore.get(room.id) || joined;
          const session = issueSession(current.id, playerId);
          return sendJson(res, 200, Object.assign({}, roomView(current, match), {
            ok: true,
            playerSession: session,
            playerId: playerId
          }));
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'actions' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const actor = actorOfRoom(body, room, null);
          if (!actor.ok) return roomError(res, actor);
          if (match.game !== 'mahjong') {
            const currentPlayerId = room.players[matchCurrentIndex(match)];
            if (currentPlayerId && actor.playerId !== currentPlayerId) {
              return error(res, 409, 'E_TURN', 'not this player\'s turn');
            }
          }
          const key = body && body.idempotencyKey;
          const cache = idempotency.get(match.id) || new Map();
          idempotency.set(match.id, cache);
          if (key && cache.has(key)) return sendJson(res, 200, cache.get(key));
          const result = applyMatchAction(match, body || {});
          if (!result.ok) {
            return error(res, result.status || 409, result.code || 'E_ACTION', result.message || 'action rejected');
          }
          const payload = roomView(roomStore.get(room.id) || room, match);
          payload.action = actionView({
            type: (body && (body.type || body.action)) || 'unknown',
            cardId: body && body.cardId,
            target: body && body.target,
            tile: body && body.tile
          });
          if (key) cache.set(key, payload);
          return sendJson(res, 200, payload);
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'start' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const actor = actorOfRoom(body, room, null);
          if (!actor.ok) return roomError(res, actor);
          if (actor.playerId !== room.hostId) return error(res, 403, 'E_HOST', 'only the host can start');
          const needed = match.game === 'mahjong' ? 4 : 2;
          if (room.players.length < needed) {
            return error(res, 409, 'E_PLAYERS', 'need at least ' + needed + ' players');
          }
          roomStore.start(room.id, actor.playerId);
          return sendJson(res, 200, Object.assign({}, roomView(roomStore.get(room.id) || room, match), { ok: true }));
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'reconnect' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const token = body && (body.token || body.session || body.playerSession);
          const playerId = body && (body.playerId || body.userId);
          const session = sessionInfo(token);
          if (!session || session.roomId !== room.id || (playerId && session.playerId !== playerId)) {
            return error(res, 403, 'E_TOKEN', 'invalid session token');
          }
          return sendJson(res, 200, Object.assign({}, roomView(room, match), {
            ok: true,
            playerSession: token,
            playerId: session.playerId
          }));
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'leave' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const actor = actorOfRoom(body, room, null);
          if (!actor.ok) return roomError(res, actor);
          const result = roomStore.leave(room.id, actor.playerId);
          if (!result.ok) return roomError(res, { status: 409, code: result.code, message: result.message });
          for (const [token, session] of sessions) {
            if (session.roomId === room.id && session.playerId === actor.playerId) sessions.delete(token);
          }
          return sendJson(res, 200, { ok: true, roomId: room.id, playerId: actor.playerId, left: true });
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'voice/token' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const userId = (body && (body.userId || body.playerId)) || null;
          if (!userId) return error(res, 422, 'E_INVALID_ARGS', 'userId is required');
          if (room.players.indexOf(userId) === -1) {
            return error(res, 403, 'E_VOICE', 'not a room member');
          }
          return sendJson(res, 200, {
            ok: true,
            roomId: room.id,
            userId: userId,
            transport: null,
            voice: null,
            token: null,
            note: 'voice is interface-only; media is out of scope'
          });
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (!actionName && req.method === 'DELETE') {
        const actor = actorOfRoom({}, room, {
          session: url.searchParams.get('session') || url.searchParams.get('token'),
          playerId: url.searchParams.get('playerId') || url.searchParams.get('userId')
        });
        if (!actor.ok) return roomError(res, actor);
        if (actor.playerId !== room.hostId) return error(res, 403, 'E_HOST', 'only the host can close');
        roomStore.close(room.id, actor.playerId);
        roomMatches.delete(room.id);
        matches.delete(match.id);
        idempotency.delete(match.id);
        for (const [token, session] of sessions) {
          if (session.roomId === room.id) sessions.delete(token);
        }
        return sendJson(res, 200, { ok: true, roomId: room.id, closed: true });
      }

      return error(res, 405, 'E_METHOD', 'method not allowed');
    }

    return error(res, 404, 'E_NOT_FOUND', 'not found');
  });

  server.on('clientError', function (err, socket) {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\n\r\n{"error":{"code":"E_BAD_REQUEST"}}');
  });

  return {
    server: server,
    matches: matches,
    listen(port, host) {
      return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, host || DEFAULT_HOST, function () {
          server.removeListener('error', reject);
          resolve(server.address());
        });
      });
    },
    close() {
      return new Promise(function (resolve) {
        server.close(function () { resolve(); });
      });
    }
  };
}

export async function startServer(options) {
  const opts = options || {};
  const port = Number.isFinite(opts.port) ? opts.port : DEFAULT_PORT;
  const host = opts.host || DEFAULT_HOST;
  const app = createApiServer(opts);
  const address = await app.listen(port, host);
  return { app: app, server: app.server, address: address };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const envPort = Number(process.env.BOARDGAME_AI_PORT);
  const port = portArg !== -1 ? Number(process.argv[portArg + 1])
    : (Number.isFinite(envPort) && envPort > 0 ? envPort : DEFAULT_PORT);
  startServer({ port: port }).then(function (handle) {
    const addr = handle.address;
    console.log('[boardgame-api] listening on http://' + addr.address + ':' + addr.port);
  }).catch(function (err) {
    console.error('[boardgame-api] failed: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}

export default { createApiServer: createApiServer, startServer: startServer };
