#!/usr/bin/env node
'use strict';

/*
 * 桌游 HTTP/JSON API（机器可调用，无第三方依赖）。
 *
 * 仅内网自用（不要把本服务直接暴露公网）：
 *   node app/server.mjs --port 8787                 # 只监听 127.0.0.1
 *   node app/server.mjs --host 0.0.0.0 --port 8787  # 局域网跨设备联机
 *   BOARDGAME_HOST=0.0.0.0 node app/server.mjs
 *
 *   GET  /health | /api/health | /
 *   POST /api/matches                     开一局
 *   GET  /api/matches/:id                 读状态
 *   GET  /api/matches/:id/actions         合法动作
 *   POST /api/matches/:id/actions         执行动作
 *   POST /api/ai/evaluate                 评估动作
 *   POST /api/rooms                       创建房间（autoFill:true 时 3 秒后 AI 补位）
 *   POST /api/rooms/:id/join              加入房间（密码/邀请码）
 *   GET  /api/rooms/:id                   查询房间状态（客户端 500–1000ms 轮询）
 *   POST /api/rooms/:id/actions           在房间内落子/执行动作（幂等 action id）
 *   POST /api/rooms/:id/start             房主开始对局
 *   POST /api/rooms/:id/reconnect         用 session 重连（恢复托管）
 *   POST /api/rooms/:id/leave             离开房间
 *   DELETE /api/rooms/:id                 房主关闭房间
 *   POST /api/rooms/:id/voice/token       语音接口位（仅成员鉴权）
 *   GET  /api/leaderboard?game=<id>       服务端内存排行榜（匿名 hash，无个人信息）
 *
 * 断线/超时：房间内某玩家超过 BOARDGAME_DISCONNECT_MS（默认 15s）没有任何
 * 带 session 的请求，服务器会用同一套合法动作引擎代打，并在 room view 的
 * autoPlayed 数组中返回托管记录。AI 与托管都走 cardgame.js / mahjong.js，
 * 不复制、不简化规则。
 *
 * 静态页：/play/online.html 等文件同样由本服务提供，因此邀请 URL 使用请求
 * 的 Host 头（不用写死 127.0.0.1），跨设备打开即可加入同一房间。
 * CORS 只回显同源 / 回环 / 局域网 Origin，绝不使用 *。
 *
 * 隐私：只保存匿名设备 id（x-device-id 或随机 dev_<hex>）与玩家自填的
 * playerId；不接收姓名、邮箱、手机号等个人信息。排行榜只存
 * sha256(playerId) 摘要。可选鉴权：设置 BOARDGAME_API_TOKEN 后 /api/* 要求
 * Authorization: Bearer <token>（/health 与静态页保持可读）。
 */

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRoomStoreInternal } from './rooms.js';
import { sha256Hex } from './leaderboard.js';
import * as mahjong from './mahjong.js';
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

const require = createRequire(import.meta.url);
const Azul = require('../azul-premium/engine.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOARDGAME_ROOT = path.resolve(HERE, '..');
const GAMES_ROOT = path.resolve(BOARDGAME_ROOT, '..');
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;
const ANON_PREFIX = 'dev_';
const DEFAULT_AUTO_FILL_MS = 3000;
const DEFAULT_AI_MOVE_MIN_MS = 600;
const DEFAULT_AI_MOVE_MAX_MS = 1200;
const DEFAULT_DISCONNECT_MS = 15000;
const DEFAULT_TICK_MS = 120;
const AI_ID_PREFIX = 'ai_';
const LEADERBOARD_LIMIT = 200;

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

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
  if (raw === 'azul' || raw === '花砖物语' || raw === '花砖') return 'azul';
  return 'card-battle';
}

function isAiPlayer(playerId) {
  return String(playerId || '').indexOf(AI_ID_PREFIX) === 0;
}

function roomNeededPlayers(match) {
  if (!match) return 2;
  if (match.game === 'mahjong') return 4;
  if (match.game === 'azul') return Math.max(2, Math.min(4, match.playerCount || match.maxPlayers || 2));
  return 2;
}

function matchPlayerCount(gameType, value) {
  const fallback = gameType === 'mahjong' ? 4 : 2;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(2, Math.min(4, Math.floor(num)));
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true;
  const parts = host.split('.');
  if (parts.length === 4 && parts.every(function (part) { return /^\d{1,3}$/.test(part); })) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    return a === 10 || a === 127 ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 169 && b === 254);
  }
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  return /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

/*
 * 只允许同源 / 回环 / 局域网 Origin。绝不返回 *：这套服务是内网自用，
 * 不是公网 API。没有 Origin（curl、同源导航）时不需要 CORS 头。
 */
function allowedCorsOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !origin || origin === 'null') return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (err) {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return isPrivateHostname(parsed.hostname) ? origin : null;
}

function applyCors(req, res) {
  const origin = allowedCorsOrigin(req);
  res.setHeader('vary', 'Origin');
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, DELETE, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type, authorization, x-device-id');
    res.setHeader('access-control-max-age', '600');
  }
  return Boolean(origin);
}

function safeHostHeader(req) {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    req.headers.host || '';
  if (!/^[A-Za-z0-9._\-:\[\]]{1,255}$/.test(raw)) return null;
  return raw;
}

function requestOrigin(req) {
  const protoRaw = req.headers['x-forwarded-proto'];
  const proto = (typeof protoRaw === 'string' && protoRaw.split(',')[0].trim()) || 'http';
  if (proto !== 'http' && proto !== 'https') return null;
  const host = safeHostHeader(req);
  return host ? proto + '://' + host : null;
}

function inviteUrlFor(req, room, match) {
  const origin = requestOrigin(req);
  if (!origin || !room) return null;
  const page = match && match.game === 'azul'
    ? '/boardgame/azul-premium/online.html'
    : '/play/online.html';
  return origin + page + '?room=' + encodeURIComponent(room.id) +
    '&code=' + encodeURIComponent(room.code);
}

function sendStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch (err) {
    return false;
  }
  const gameTree = decoded === '/boardgame' || decoded.indexOf('/boardgame/') === 0 ||
    decoded.indexOf('/assets/') === 0 || decoded.indexOf('/shared/') === 0;
  const root = gameTree ? GAMES_ROOT : BOARDGAME_ROOT;
  const target = path.resolve(root, '.' + decoded);
  if (target !== root && !target.startsWith(root + path.sep)) return false;
  if (path.basename(target).startsWith('.')) return false;
  let stat;
  try {
    stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const index = path.join(target, 'index.html');
      stat = fs.statSync(index);
      return sendFile(req, res, index, stat);
    }
  } catch (err) {
    return false;
  }
  return sendFile(req, res, target, stat);
}

function sendFile(req, res, file, stat) {
  if (!stat.isFile()) return false;
  const type = STATIC_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  fs.createReadStream(file).on('error', function () {
    try { res.destroy(); } catch (err) { /* ignore */ }
  }).pipe(res);
  return true;
}

function optionNumber(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(num)));
}

function resolveTimingOptions(options) {
  const opts = options || {};
  const env = process.env;
  const autoFillMs = optionNumber(
    opts.autoFillMs != null ? opts.autoFillMs : env.BOARDGAME_AI_FILL_MS,
    DEFAULT_AUTO_FILL_MS, 0, 60000);
  const moveMin = optionNumber(
    opts.aiMoveMinMs != null ? opts.aiMoveMinMs : env.BOARDGAME_AI_MOVE_MIN_MS,
    DEFAULT_AI_MOVE_MIN_MS, 0, 60000);
  const moveMax = optionNumber(
    opts.aiMoveMaxMs != null ? opts.aiMoveMaxMs : env.BOARDGAME_AI_MOVE_MAX_MS,
    DEFAULT_AI_MOVE_MAX_MS, moveMin, 60000);
  const disconnectMs = optionNumber(
    opts.disconnectMs != null ? opts.disconnectMs : env.BOARDGAME_DISCONNECT_MS,
    DEFAULT_DISCONNECT_MS, 100, 3600000);
  const tickMs = optionNumber(
    opts.tickMs != null ? opts.tickMs : env.BOARDGAME_TICK_MS,
    DEFAULT_TICK_MS, 10, 5000);
  return {
    autoFillMs: autoFillMs,
    aiMoveMinMs: moveMin,
    aiMoveMaxMs: moveMax,
    disconnectMs: disconnectMs,
    tickMs: tickMs
  };
}

/*
 * 解析监听参数，优先级：命令行 > 环境变量 > 默认值。
 * 支持 --host 0.0.0.0 / --host=0.0.0.0 / BOARDGAME_HOST。
 */
export function resolveListenOptions(argv, env) {
  const args = Array.isArray(argv) ? argv : [];
  const vars = env || {};
  const out = {
    port: Number.isFinite(Number(vars.BOARDGAME_AI_PORT)) && Number(vars.BOARDGAME_AI_PORT) > 0
      ? Number(vars.BOARDGAME_AI_PORT) : DEFAULT_PORT,
    host: vars.BOARDGAME_HOST || DEFAULT_HOST
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--port') out.port = Number(args[++i]);
    else if (arg.indexOf('--port=') === 0) out.port = Number(arg.slice(7));
    else if (arg === '--host') out.host = args[++i] || DEFAULT_HOST;
    else if (arg.indexOf('--host=') === 0) out.host = arg.slice(7) || DEFAULT_HOST;
  }
  if (!Number.isFinite(out.port) || out.port < 0 || out.port > 65535) out.port = DEFAULT_PORT;
  if (!/^[A-Za-z0-9._\-:\[\]]{1,255}$/.test(String(out.host))) out.host = DEFAULT_HOST;
  return out;
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

function isMatchEnded(match) {
  if (!match || !match.state) return true;
  if (match.game === 'azul') return !!match.state.over;
  return match.state.phase === 'ended';
}

function azulSummary(state) {
  const result = state.result || null;
  return {
    over: !!state.over,
    reason: state.overReason || null,
    round: state.round,
    winner: result ? result.winner : null,
    tied: result ? !!result.tied : false,
    winners: result && Array.isArray(result.winners) ? result.winners.slice() : [],
    scores: result && Array.isArray(result.scores)
      ? result.scores.map(function (row) {
        return {
          index: row.index, name: row.name, isAI: row.isAI,
          base: row.base, bonus: row.bonus, total: row.total
        };
      })
      : state.players.map(function (player) {
        return { index: player.index, name: player.name, isAI: player.isAI, total: player.score };
      })
  };
}

function azulMatchView(match) {
  const state = match.state;
  return {
    matchId: match.id,
    game: 'azul',
    status: state.over ? 'ended' : 'playing',
    phase: state.over ? 'ended' : 'playing',
    turn: state.turn,
    round: state.round,
    current: state.current,
    players: state.players.map(function (player) {
      return {
        id: player.index, seat: player.index, name: player.name,
        isAI: player.isAI, isAi: player.isAI, score: player.score
      };
    }),
    zones: {
      players: state.players.map(function (player) {
        return { id: player.index, name: player.name, score: player.score, isAI: player.isAI };
      })
    },
    state: state,
    deviceId: match.deviceId,
    summary: azulSummary(state)
  };
}

/*
 * Azul 是公开信息游戏（没有暗牌），但每个客户端都希望自己显示在座位 0。
 * 服务器按 viewer 把 players 轮转，并同步 current / firstPlayer / 结算座位，
 * 客户端拿到的始终是“我在下方”的权威状态；动作仍由服务器按原始座位执行。
 */
function azulStateForViewer(match, room, viewerId) {
  const state = match.state;
  const playerCount = state.players.length;
  const seat = room && viewerId ? room.players.indexOf(viewerId) : -1;
  const viewerSeat = seat >= 0 ? seat : 0;
  const order = [];
  for (let i = 0; i < playerCount; i += 1) order.push((viewerSeat + i) % playerCount);
  const rotated = JSON.parse(JSON.stringify(state));
  rotated.players = order.map(function (originalIndex, newIndex) {
    const player = JSON.parse(JSON.stringify(state.players[originalIndex]));
    player.index = newIndex;
    player.seat = originalIndex;
    return player;
  });
  rotated.current = order.indexOf(state.current);
  rotated.firstPlayer = order.indexOf(state.firstPlayer);
  if (rotated.result) {
    rotated.result.scores = rotated.result.scores.map(function (row) {
      const copy = Object.assign({}, row);
      copy.index = order.indexOf(row.index);
      return copy;
    }).sort(function (a, b) { return a.index - b.index; });
    rotated.result.winner = Number.isInteger(state.result && state.result.winner)
      ? order.indexOf(state.result.winner) : null;
    rotated.result.winners = Array.isArray(state.result && state.result.winners)
      ? state.result.winners.map(function (index) { return order.indexOf(index); }) : [];
  }
  if (rotated.lastRound && Array.isArray(rotated.lastRound.players)) {
    rotated.lastRound.players.forEach(function (event) {
      if (event && Number.isInteger(event.index)) event.index = order.indexOf(event.index);
    });
  }
  return { state: rotated, seatOrder: order, viewerSeat: viewerSeat };
}

function matchView(match) {
  if (match.game === 'mahjong') return mahjongMatchView(match);
  if (match.game === 'azul') return azulMatchView(match);
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
  if (action.source) view.source = action.source;
  if (Number.isInteger(action.factoryIndex)) view.factoryIndex = action.factoryIndex;
  if (Number.isInteger(action.color)) view.color = action.color;
  if (Number.isInteger(action.row)) view.row = action.row;
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
  if (match.game === 'azul') return match.state.current;
  return currentIndexOf(match.state);
}

/*
 * 当前必须行动的座位：麻将鸣牌阶段是当前 claim offer 的玩家，
 * 其余阶段是当前的摸打玩家。AI / 托管 / 房间视图都以此为准。
 */
function requiredSeatOf(match) {
  if (!match || !match.state || isMatchEnded(match)) return null;
  if (match.game === 'mahjong') {
    const state = match.state;
    if (state.phase === 'claim') {
      const offer = state.claimOffers && state.claimOffers[state.claimIndex];
      return offer ? offer.player : null;
    }
    return state.currentPlayer;
  }
  if (match.game === 'azul') return match.state.current;
  return currentIndexOf(match.state);
}

function matchLegalActions(match) {
  if (!match.state || isMatchEnded(match)) return [];
  if (match.game === 'mahjong') {
    return mahjong.legalActions(match.state).map(actionView);
  }
  if (match.game === 'azul') {
    return Azul.getLegalMoves(match.state).map(actionView);
  }
  return legalActions(match.state, currentIndexOf(match.state)).map(actionView);
}

function roomView(room, match, req, viewerId) {
  const base = matchView(match);
  const requiredSeat = requiredSeatOf(match);
  const currentSeat = requiredSeat == null ? base.current : requiredSeat;
  const meta = match.meta || {};
  const seatCount = match.game === 'azul'
    ? Math.max(2, Math.min(4, match.playerCount || room.maxPlayers || 2))
    : room.players.length;
  const players = [];
  for (let seat = 0; seat < seatCount; seat += 1) {
    const playerId = room.players[seat] || null;
    const gamePlayer = base.players[seat] || {};
    const ai = playerId ? isAiPlayer(playerId) : false;
    players.push(Object.assign({}, gamePlayer, {
      id: playerId,
      seat: seat,
      nickname: playerId ? (ai ? 'AI 补位' : playerId) : '等待加入',
      isAi: ai || Boolean(gamePlayer.isAI),
      ai: ai || Boolean(gamePlayer.isAI),
      empty: !playerId,
      game: gamePlayer
    }));
  }
  const status = room.status === 'waiting' || room.status === 'ready'
    ? room.status
    : base.status;
  const view = Object.assign({}, base, {
    roomId: room.id,
    inviteCode: room.code,
    inviteUrl: inviteUrlFor(req, room, match),
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
    version: meta.version || 0,
    stateVersion: meta.version || 0,
    lastAction: meta.lastAction || null,
    autoPlayed: Array.isArray(meta.autoPlayed) ? meta.autoPlayed.slice(-20) : [],
    autoPlay: {
      enabled: true,
      timeoutMs: meta.disconnectMs || DEFAULT_DISCONNECT_MS,
      aiPlayers: room.players.filter(isAiPlayer),
      players: Object.keys(meta.autoPilot || {}).filter(function (id) {
        return meta.autoPilot[id] === true;
      })
    },
    autoFill: meta.autoFill || null,
    aiMove: meta.aiMove || null,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt
  });
  if (match.game === 'azul') {
    const rotated = azulStateForViewer(match, room, viewerId);
    view.state = rotated.state;
    view.summary = azulSummary(rotated.state);
    view.seatOrder = rotated.seatOrder;
    view.mySeat = rotated.viewerSeat;
    view.viewerId = viewerId || null;
  }
  return decorateRoomView(view, room, req, match);
}

function decorateRoomView(view, room, req, match) {
  return Object.assign({}, view, {
    inviteUrl: inviteUrlFor(req, room, match),
    inviteCode: room.code,
    roomId: room.id
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
  const timing = resolveTimingOptions(opts);
  const leaderboard = []; // newest last; anonymous hashes only
  let leaderboardSeq = 0;

  function getMatch(id) {
    return matches.get(id) || null;
  }

  function newRoomMeta(hostId) {
    const meta = {
      version: 0,
      lastAction: null,
      lastSeen: new Map(),
      autoPilot: {},
      autoPlayed: [],
      aiActions: [],
      nextActionAt: 0,
      timer: null,
      startedAt: null,
      finishedAt: null,
      leaderboardRecorded: false,
      autoFill: null,
      aiMove: { minMs: timing.aiMoveMinMs, maxMs: timing.aiMoveMaxMs },
      disconnectMs: timing.disconnectMs
    };
    if (hostId) meta.lastSeen.set(hostId, Date.now());
    return meta;
  }

  function bumpVersion(match, info) {
    const meta = match.meta;
    if (!meta) return 0;
    meta.version += 1;
    meta.lastAction = Object.assign({
      seq: meta.version,
      at: Date.now()
    }, info || {});
    return meta.version;
  }

  function touchPlayer(match, playerId) {
    if (!match || !match.meta || !playerId) return;
    match.meta.lastSeen.set(playerId, Date.now());
    if (match.meta.autoPilot[playerId]) {
      delete match.meta.autoPilot[playerId];
      match.meta.lastAction = Object.assign({}, match.meta.lastAction, {
        resumedBy: playerId,
        resumedAt: Date.now()
      });
    }
  }

  function clearRoomTimers(match) {
    if (!match || !match.meta) return;
    if (match.meta.timer) {
      clearInterval(match.meta.timer);
      match.meta.timer = null;
    }
    if (match.meta.autoFillTimer) {
      clearTimeout(match.meta.autoFillTimer);
      match.meta.autoFillTimer = null;
    }
  }

  function activeSeat(match) {
    return requiredSeatOf(match);
  }

  function normalizeActionType(value) {
    return String(value || '').trim().toLowerCase().replace(/[_-]/g, '');
  }

  /*
   * AI 与托管共用：只从引擎给出的合法动作里挑，不另写一套规则。
   * 卡牌优先级：play > attack > attach > draw > prize > endTurn；
   * 麻将：自摸 > 和 > 杠 > 碰 > 吃 > 优先打孤张 > 过。
   */
  function chooseEngineAction(match) {
    if (!match || !match.state || isMatchEnded(match)) return null;
    if (match.game === 'azul') {
      const moves = Azul.getLegalMoves(match.state);
      if (!moves.length) return null;
      return Object.assign({ type: 'move' }, Azul.chooseAIMove(match.state));
    }
    if (match.game === 'mahjong') {
      const state = match.state;
      const actions = mahjong.legalActions(state);
      if (!actions.length) return null;
      if (state.phase === 'claim') {
        const offer = mahjong.currentClaimOffer(state);
        if (!offer) return null;
        const pick = mahjong.chooseAiClaim(state, offer.player);
        if (pick.type === 'pass') return { type: 'pass', playerIndex: offer.player };
        const found = actions.find(function (action) { return action.type === pick.type; });
        if (found) {
          return Object.assign({ playerIndex: offer.player }, found, {
            comboIndex: pick.comboIndex == null ? 0 : pick.comboIndex
          });
        }
        return { type: 'pass', playerIndex: offer.player };
      }
      const tsumo = actions.find(function (action) { return action.type === 'tsumo'; });
      if (tsumo) return tsumo;
      const seat = state.currentPlayer;
      const tile = mahjong.chooseAiDiscard(state.hands[seat], state.melds[seat]);
      const discard = actions.find(function (action) {
        return action.type === 'discard' && action.tile === tile;
      }) || actions.find(function (action) { return action.type === 'discard'; });
      return discard || actions[0];
    }
    const actions = legalActions(match.state, currentIndexOf(match.state));
    const order = ['play', 'attack', 'attach', 'draw', 'prize', 'endturn'];
    for (let i = 0; i < order.length; i += 1) {
      const found = actions.find(function (action) {
        return normalizeActionType(action.type || action.action) === order[i];
      });
      if (found) return found;
    }
    return actions[0] || { type: 'endTurn' };
  }

  function fallbackAction(match) {
    if (!match || !match.state || isMatchEnded(match)) return null;
    if (match.game === 'azul') {
      const moves = Azul.getLegalMoves(match.state);
      return moves.length ? Object.assign({ type: 'move' }, moves[0]) : null;
    }
    if (match.game === 'mahjong') {
      if (match.state.phase === 'claim') {
        const offer = mahjong.currentClaimOffer(match.state);
        return { type: 'pass', playerIndex: offer ? offer.player : undefined };
      }
      const hand = match.state.hands[match.state.currentPlayer] || [];
      return hand.length ? { type: 'discard', tile: hand[hand.length - 1] } : null;
    }
    return { type: 'endTurn' };
  }

  function aiDelay() {
    const span = Math.max(0, timing.aiMoveMaxMs - timing.aiMoveMinMs);
    return timing.aiMoveMinMs + Math.floor(Math.random() * (span + 1));
  }

  function leaderboardEntryFor(room, match, winnerSeat) {
    const state = match.state;
    const game = match.game;
    let score = 0;
    let result = null;
    if (game === 'azul') {
      result = state.result || null;
      const scores = result && Array.isArray(result.scores)
        ? result.scores
        : state.players.map(function (player) {
          return { index: player.index, name: player.name, isAI: player.isAI, total: player.score };
        });
      score = winnerSeat != null
        ? Math.max(0, (scores.find(function (row) { return row.index === winnerSeat; }) || {}).total || 0)
        : Math.max(0, Math.max.apply(null, scores.map(function (row) { return row.total || 0; }).concat([0])));
      result = {
        winner: result ? result.winner : null,
        tied: !!(result && result.tied),
        scores: scores.map(function (row) {
          return { index: row.index, name: row.name, isAI: row.isAI, total: row.total };
        })
      };
    } else if (game === 'mahjong') {
      result = state.result || null;
      score = result && Number.isFinite(result.points) ? Math.max(0, result.points) : 0;
    } else {
      const players = state.players || [];
      score = winnerSeat != null && players[winnerSeat] ? Math.max(0, players[winnerSeat].hp) : 0;
      result = {
        winner: state.winner,
        hp: players.map(function (player) { return player.hp; })
      };
    }
    const participants = room.players.map(function (playerId, seat) {
      return {
        seat: seat,
        playerHash: sha256Hex('boardgame-leaderboard:' + playerId),
        ai: isAiPlayer(playerId),
        winner: seat === winnerSeat
      };
    });
    leaderboardSeq += 1;
    return {
      id: 'lb_' + leaderboardSeq,
      gameId: game,
      roomId: room.id,
      winnerSeat: winnerSeat == null ? null : winnerSeat,
      winnerHash: winnerSeat != null && participants[winnerSeat] ? participants[winnerSeat].playerHash : null,
      score: score,
      turns: Number.isFinite(state.turn) ? state.turn : 0,
      durationMs: Math.max(0, Date.now() - match.createdAt),
      ai: participants.some(function (participant) { return participant.ai; }),
      participants: participants,
      result: result,
      at: Date.now()
    };
  }

  function recordLeaderboard(room, match) {
    if (!match || !match.meta || match.meta.leaderboardRecorded) return null;
    if (!match.state || !isMatchEnded(match)) return null;
    match.meta.leaderboardRecorded = true;
    let winnerSeat = null;
    if (match.game === 'azul') {
      winnerSeat = match.state.result && Number.isInteger(match.state.result.winner)
        ? match.state.result.winner : null;
    } else {
      winnerSeat = Number.isInteger(match.state.winner) ? match.state.winner : null;
    }
    const entry = leaderboardEntryFor(room, match, winnerSeat);
    leaderboard.push(entry);
    if (leaderboard.length > LEADERBOARD_LIMIT) leaderboard.splice(0, leaderboard.length - LEADERBOARD_LIMIT);
    match.meta.leaderboardId = entry.id;
    return entry;
  }

  function sortedLeaderboard(gameId) {
    return leaderboard
      .filter(function (entry) { return !gameId || entry.gameId === gameId; })
      .slice()
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.at - b.at;
      });
  }

  function finalizeRoom(room, match) {
    if (!match || !match.meta || match.meta.finishedAt) return;
    match.meta.finishedAt = Date.now();
    clearRoomTimers(match);
    try {
      roomStore.finish(room.id, room.hostId);
    } catch (err) {
      /* room may already be gone; the match result is still authoritative */
    }
    recordLeaderboard(room, match);
    bumpVersion(match, { type: 'end', playerId: null, ai: false });
  }

  function tickRoom(roomId) {
    const found = roomWithMatch(roomId);
    if (!found) return;
    const room = found.room;
    const match = found.match;
    if (!match.meta) return;
    if (!match.state || isMatchEnded(match)) {
      finalizeRoom(room, match);
      return;
    }
    if (room.status !== 'playing') return;
    const seat = activeSeat(match);
    if (seat == null) return;
    const playerId = room.players[seat];
    if (!playerId) return;
    const meta = match.meta;
    const now = Date.now();
    const ai = isAiPlayer(playerId);
    const autoPilot = meta.autoPilot[playerId] === true;

    if (!ai && !autoPilot) {
      const last = meta.lastSeen.get(playerId) || meta.startedAt || now;
      if (now - last >= timing.disconnectMs) {
        meta.autoPilot[playerId] = true;
        meta.autoPlayed.push({
          playerId: playerId,
          type: 'timeout',
          reason: 'timeout',
          at: now
        });
        meta.nextActionAt = now + aiDelay();
        bumpVersion(match, { type: 'auto-play', playerId: playerId, ai: false, auto: true });
      }
      return;
    }

    if (!meta.nextActionAt) {
      meta.nextActionAt = now + aiDelay();
      return;
    }
    if (now < meta.nextActionAt) return;
    meta.nextActionAt = 0;

    const action = chooseEngineAction(match);
    if (!action) return;
    let applied = action;
    let result = applyMatchAction(match, action);
    if (!result || result.ok === false) {
      const fallback = fallbackAction(match);
      if (fallback) {
        applied = fallback;
        result = applyMatchAction(match, fallback);
      }
    }
    if (!result || result.ok === false) return;
    const appliedType = String(applied.type || applied.action || 'action');
    bumpVersion(match, {
      type: appliedType,
      playerId: playerId,
      ai: ai,
      auto: !ai,
      reason: ai ? 'ai-fill' : 'timeout'
    });
    const entry = {
      playerId: playerId,
      type: appliedType,
      at: Date.now(),
      reason: ai ? 'ai-fill' : 'timeout'
    };
    if (ai) meta.aiActions.push(entry);
    else meta.autoPlayed.push(entry);
    if (meta.aiActions.length > 200) meta.aiActions.splice(0, meta.aiActions.length - 200);
    if (meta.autoPlayed.length > 200) meta.autoPlayed.splice(0, meta.autoPlayed.length - 200);
    if (isMatchEnded(match)) finalizeRoom(room, match);
  }

  /*
   * 房间座位 -> Azul state.players 的名字/AI 标记。座位在开局后不再变化
   * （leave 在 playing 阶段会被拒绝），所以 index 可以直接对齐。
   */
  function syncAzulPlayers(room, match) {
    if (!match || match.game !== 'azul' || !match.state) return;
    match.playerCount = Math.max(2, Math.min(4, room.maxPlayers || match.playerCount || 2));
    match.state.players.forEach(function (player, seat) {
      const playerId = room.players[seat] || null;
      if (!playerId) {
        player.name = 'P' + (seat + 1);
        player.isAI = false;
        return;
      }
      const ai = isAiPlayer(playerId);
      player.name = ai ? 'AI 补位 ' + (seat + 1) : playerId;
      player.isAI = ai;
    });
  }

  function ensureRoomTimer(room, match) {
    if (!match || !match.meta || match.meta.timer) return;
    match.meta.timer = setInterval(function () { tickRoom(room.id); }, timing.tickMs);
    if (match.meta.timer.unref) match.meta.timer.unref();
  }

  function onRoomStarted(room, match) {
    const meta = match.meta || newRoomMeta(room.hostId);
    match.meta = meta;
    syncAzulPlayers(room, match);
    if (!meta.startedAt) meta.startedAt = Date.now();
    const now = Date.now();
    room.players.forEach(function (playerId) { meta.lastSeen.set(playerId, now); });
    bumpVersion(match, { type: 'start', playerId: room.hostId, ai: false });
    ensureRoomTimer(room, match);
  }

  function scheduleAutoFill(room, match, delayMs) {
    if (!room || !match || !match.meta) return;
    if (match.meta.autoFillTimer) clearTimeout(match.meta.autoFillTimer);
    const wait = delayMs == null ? timing.autoFillMs : Math.max(0, Math.floor(delayMs));
    match.meta.autoFill = { enabled: true, delayMs: wait, filledAt: null };
    match.meta.autoFillTimer = setTimeout(function () {
      match.meta.autoFillTimer = null;
      fillAiPlayers(room.id);
    }, wait);
    if (match.meta.autoFillTimer.unref) match.meta.autoFillTimer.unref();
  }

  function fillAiPlayers(roomId) {
    const found = roomWithMatch(roomId);
    if (!found) return;
    const room = found.room;
    const match = found.match;
    if (room.status === 'playing' || room.status === 'finished' || room.status === 'closed') return;
    const needed = roomNeededPlayers(match);
    let filled = 0;
    while (room.players.length < needed && room.players.length < room.maxPlayers) {
      let n = filled + 1;
      let playerId = AI_ID_PREFIX + n;
      while (room.players.indexOf(playerId) !== -1) {
        n += 1;
        playerId = AI_ID_PREFIX + n;
      }
      const result = roomStore.addAi
        ? roomStore.addAi(room.id, { playerId: playerId, nickname: 'AI 补位' })
        : roomStore.join(room.id, { playerId: playerId, nickname: 'AI 补位', password: undefined });
      if (!result || result.ok === false) break;
      filled += 1;
    }
    if (!filled) return;
    const current = roomStore.get(room.id) || room;
    syncAzulPlayers(current, match);
    match.meta.autoFill = Object.assign({}, match.meta.autoFill, {
      enabled: true,
      added: filled,
      filledAt: Date.now()
    });
    current.players.forEach(function (playerId) {
      if (!match.meta.lastSeen.has(playerId)) match.meta.lastSeen.set(playerId, Date.now());
    });
    bumpVersion(match, { type: 'ai-join', playerId: AI_ID_PREFIX + '1', ai: true });
    if (current.players.length >= needed && (current.status === 'waiting' || current.status === 'ready')) {
      const started = roomStore.start(current.id, current.hostId);
      if (started && started.ok) onRoomStarted(current, match);
    }
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

  function makeGameState(gameType, seed, options) {
    if (gameType === 'mahjong') {
      return mahjong.createGame({ seed: seed });
    }
    if (gameType === 'azul') {
      const opts = options || {};
      const playerCount = matchPlayerCount('azul', opts.playerCount);
      const names = Array.isArray(opts.names) && opts.names.length === playerCount
        ? opts.names.slice() : undefined;
      const aiFlags = Array.isArray(opts.isAI) && opts.isAI.length === playerCount
        ? opts.isAI.slice() : undefined;
      return Azul.createGame({
        seed: seed,
        playerCount: playerCount,
        names: names,
        isAI: aiFlags
      });
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

  function createMatchRecord(gameType, seed, deviceId, options) {
    const game = normalizeGameType(gameType);
    const match = {
      id: makeMatchId(),
      game: game,
      ai: false,
      createdAt: Date.now(),
      deviceId: deviceId,
      playerCount: game === 'azul' ? matchPlayerCount('azul', options && options.playerCount) : undefined,
      state: makeGameState(game, seed, options)
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
    const match = createMatchRecord(body.game, seed, deviceIdOf(req, body), {
      playerCount: body.playerCount || body.maxPlayers
    });
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
    if (type === 'play') {
      return playCard(state, current, body.cardId, { target: body.target });
    }
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
    if (type === 'tsumo' || type === 'selfdraw') {
      return mahjong.selfDrawWin(state, state.currentPlayer);
    }
    if (type === 'win' || type === 'claim' || type === 'claimwin') {
      return mahjong.claimWin(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined);
    }
    if (type === 'chi') {
      return mahjong.claimChi(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined,
        Number.isInteger(body.comboIndex) ? body.comboIndex : 0);
    }
    if (type === 'pong') {
      return mahjong.claimPong(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined);
    }
    if (type === 'kong') {
      return mahjong.claimKong(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined);
    }
    if (type === 'pass' || type === 'passclaim') {
      return mahjong.passClaim(state,
        Number.isInteger(body.playerIndex) ? body.playerIndex : undefined);
    }
    if (type === 'draw') {
      const tile = mahjong.draw(state);
      if (tile == null && state.phase !== 'ended') {
        return { ok: false, status: 409, code: 'E_STATE', message: 'cannot draw right now' };
      }
      return { ok: true, state: state, tile: tile };
    }
    return { ok: false, status: 422, code: 'E_INVALID_ACTION', message: 'unknown action: ' + rawType };
  }

  function applyAzulAction(match, body) {
    const input = body || {};
    if (!match.state || match.state.over) {
      return { ok: false, status: 409, code: 'E_STATE', message: 'game is over' };
    }
    const source = input.move && input.move.source ? input.move.source : input.source;
    const sourceIn = input.move || input;
    const move = {
      source: source,
      factoryIndex: Number.isInteger(sourceIn.factoryIndex) ? sourceIn.factoryIndex
        : (Number.isInteger(sourceIn.fi) ? sourceIn.fi : -1),
      color: Number.isInteger(sourceIn.color) ? sourceIn.color : Number(sourceIn.color),
      row: Number.isInteger(sourceIn.row) ? sourceIn.row : Number(sourceIn.row)
    };
    if (move.source !== 'factory' && move.source !== 'center') {
      return { ok: false, status: 422, code: 'E_INVALID_ARGS', message: 'source must be factory or center' };
    }
    if (!Number.isInteger(move.color) || !Number.isInteger(move.row)) {
      return { ok: false, status: 422, code: 'E_INVALID_ARGS', message: 'color and row are required' };
    }
    try {
      const next = Azul.applyMove(match.state, move);
      match.state = next;
      return { ok: true, state: next, action: move };
    } catch (err) {
      return {
        ok: false,
        status: 422,
        code: 'E_ACTION',
        message: err && err.message ? err.message : 'illegal Azul move'
      };
    }
  }

  function applyMatchAction(match, body) {
    if (match.game === 'mahjong') return applyMahjongAction(match, body || {});
    if (match.game === 'azul') return applyAzulAction(match, body || {});
    return applyCardAction(match, body || {});
  }

  const server = http.createServer(function (req, res) {
    res.on('error', function () {});
    const corsAllowed = applyCors(req, res);
    const url = new URL(req.url, 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(corsAllowed ? 204 : 403, {
        'content-length': '0',
        'cache-control': 'no-store'
      });
      return res.end();
    }

    // 只对 API 做鉴权；/health 与静态页保持可读，便于跨设备打开邀请链接。
    if (path.indexOf('/api/') === 0 && !authorized(req)) {
      return error(res, 401, 'E_AUTH', 'missing or invalid bearer token');
    }

    if (req.method === 'GET' && (path === '/' || path === '/health' || path === '/api/health')) {
      return sendJson(res, 200, {
        ok: true,
        status: 'ok',
        service: 'boardgame-ai-api',
        name: 'boardgame',
        version: '1.1.0',
        capabilities: ['matches', 'legal-actions', 'actions', 'ai-evaluate',
          'rooms', 'room-actions', 'room-sessions', 'anonymous-device-id',
          'lan-host', 'invite-url', 'state-version', 'idempotent-actions',
          'ai-fill', 'reconnect', 'auto-play', 'leaderboard'],
        matches: matches.size,
        rooms: roomMatches.size,
        leaderboard: leaderboard.length,
        host: safeHostHeader(req)
      });
    }

    if (req.method === 'GET' && (path === '/api/leaderboard' || path.indexOf('/api/leaderboard/') === 0)) {
      const gameId = url.searchParams.get('game') ||
        (path.indexOf('/api/leaderboard/') === 0 ? decodeURIComponent(path.slice('/api/leaderboard/'.length)) : null);
      const limit = optionNumber(url.searchParams.get('limit'), 10, 1, 100);
      const sorted = sortedLeaderboard(gameId || null);
      const entries = sorted.slice(0, limit).map(function (entry, index) {
        return Object.assign({ rank: index + 1 }, entry);
      });
      return sendJson(res, 200, {
        ok: true,
        gameId: gameId || null,
        total: sorted.length,
        entries: entries
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
          status: isMatchEnded(match) ? 'ended' : 'playing'
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
        const playerCount = matchPlayerCount(gameType, input.playerCount || input.maxPlayers);
        let created;
        try {
          created = roomStore.create({
            hostId: playerId,
            gameId: gameType,
            visibility: input.visibility == null ? 'public' : input.visibility,
            password: input.password,
            maxPlayers: gameType === 'mahjong' ? 4 : (gameType === 'azul' ? playerCount : 2),
            nickname: playerId
          });
        } catch (err) {
          return error(res, 422, err.code || 'E_ROOM', err.message || 'cannot create room');
        }
        const match = createMatchRecord(gameType, seed, deviceIdOf(req, input), { playerCount: playerCount });
        match.meta = newRoomMeta(playerId);
        roomMatches.set(created.room.id, match);
        syncAzulPlayers(created.room, match);
        const session = issueSession(created.room.id, playerId);
        const autoFill = input.autoFill == null
          ? gameType === 'azul'
          : (input.autoFill === true || input.aiFill === true || input.auto === true);
        if (autoFill) {
          scheduleAutoFill(created.room, match, input.autoFillDelayMs);
        }
        const view = roomView(created.room, match, req, playerId);
        return sendJson(res, 201, Object.assign({}, view, {
          ok: true,
          roomId: created.room.id,
          inviteCode: created.room.code,
          inviteUrl: inviteUrlFor(req, created.room, match),
          inviteToken: created.invite ? created.invite.token : null,
          playerSession: session,
          playerId: playerId,
          seed: seed,
          playerCount: gameType === 'azul' ? playerCount : undefined,
          autoFill: match.meta.autoFill
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
        if (playerId && room.players.indexOf(playerId) !== -1) touchPlayer(match, playerId);
        if (match.state && isMatchEnded(match)) finalizeRoom(room, match);
        return sendJson(res, 200, roomView(room, match, req, playerId));
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
          if (match.game === 'azul') syncAzulPlayers(joined, match);
          const needed = roomNeededPlayers(match);
          const shouldStart = joined.players.length >= needed;
          if (shouldStart && (joined.status === 'waiting' || joined.status === 'ready')) {
            roomStore.start(joined.id, joined.hostId);
            onRoomStarted(joined, match);
          }
          if (joined.players.length >= joined.maxPlayers && match.meta && match.meta.autoFillTimer) {
            clearTimeout(match.meta.autoFillTimer);
            match.meta.autoFillTimer = null;
          }
          touchPlayer(match, playerId);
          bumpVersion(match, { type: 'join', playerId: playerId, ai: false });
          const current = roomStore.get(room.id) || joined;
          const session = issueSession(current.id, playerId);
          return sendJson(res, 200, Object.assign({}, roomView(current, match, req, playerId), {
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
          touchPlayer(match, actor.playerId);
          const key = body && body.idempotencyKey;
          const cache = idempotency.get(match.id) || new Map();
          idempotency.set(match.id, cache);
          const cacheKey = key ? String(actor.playerId) + ':' + String(key) : null;
          if (cacheKey && cache.has(cacheKey)) return sendJson(res, 200, cache.get(cacheKey));
          const requiredSeat = requiredSeatOf(match);
          const requiredPlayerId = requiredSeat == null ? null : room.players[requiredSeat];
          if (requiredPlayerId && actor.playerId !== requiredPlayerId) {
            return error(res, 409, 'E_TURN', 'not this player\'s turn');
          }
          const result = applyMatchAction(match, body || {});
          if (!result.ok) {
            return error(res, result.status || 409, result.code || 'E_ACTION', result.message || 'action rejected');
          }
          bumpVersion(match, {
            type: String((body && (body.type || body.action)) || (match.game === 'azul' ? 'move' : 'unknown')),
            playerId: actor.playerId,
            ai: isAiPlayer(actor.playerId),
            auto: false
          });
          if (match.state && isMatchEnded(match)) {
            finalizeRoom(roomStore.get(room.id) || room, match);
          }
          const payload = roomView(roomStore.get(room.id) || room, match, req, actor.playerId);
          payload.action = actionView(Object.assign({
            type: (body && (body.type || body.action)) || (match.game === 'azul' ? 'move' : 'unknown'),
            cardId: body && body.cardId,
            target: body && body.target,
            tile: body && body.tile,
            source: body && body.source,
            factoryIndex: body && body.factoryIndex,
            color: body && body.color,
            row: body && body.row
          }, match.game === 'azul' ? (result.action || {}) : {}));
          if (cacheKey) cache.set(cacheKey, payload);
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
          if (match.game === 'azul') {
            if (room.players.length < 2) {
              return error(res, 409, 'E_PLAYERS', 'need at least 2 players');
            }
            if (room.players.length < roomNeededPlayers(match)) fillAiPlayers(room.id);
            const latest = roomStore.get(room.id) || room;
            if (latest.status !== 'playing' && latest.status !== 'finished') {
              roomStore.start(latest.id, actor.playerId);
              onRoomStarted(latest, match);
            }
            return sendJson(res, 200, Object.assign({}, roomView(roomStore.get(room.id) || latest, match, req, actor.playerId), { ok: true }));
          }
          const needed = roomNeededPlayers(match);
          if (room.players.length < needed) {
            return error(res, 409, 'E_PLAYERS', 'need at least ' + needed + ' players');
          }
          roomStore.start(room.id, actor.playerId);
          onRoomStarted(roomStore.get(room.id) || room, match);
          return sendJson(res, 200, Object.assign({}, roomView(roomStore.get(room.id) || room, match, req, actor.playerId), { ok: true }));
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
          touchPlayer(match, session.playerId);
          bumpVersion(match, { type: 'reconnect', playerId: session.playerId, ai: false });
          return sendJson(res, 200, Object.assign({}, roomView(room, match, req, session.playerId), {
            ok: true,
            playerSession: token,
            playerId: session.playerId,
            autoPlayed: match.meta ? match.meta.autoPlayed.slice(-20) : []
          }));
        }).catch(function (err) {
          error(res, err.code === 'E_BODY' ? 413 : 400, err.code || 'E_JSON', err.message);
        });
      }

      if (actionName === 'leave' && req.method === 'POST') {
        return readJsonBody(req).then(function (body) {
          const actor = actorOfRoom(body, room, null);
          if (!actor.ok) return roomError(res, actor);
          if (match.game === 'azul' && room.status === 'playing') {
            return error(res, 409, 'E_LOCKED', 'cannot leave a running Azul game; reconnect or let auto-play finish');
          }
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
        clearRoomTimers(match);
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

    if ((req.method === 'GET' || req.method === 'HEAD') && sendStatic(req, res, path)) return;

    return error(res, 404, 'E_NOT_FOUND', 'not found');
  });

  server.on('clientError', function (err, socket) {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\ncontent-type: application/json\r\n\r\n{"error":{"code":"E_BAD_REQUEST"}}');
  });

  return {
    server: server,
    matches: matches,
    leaderboard: leaderboard,
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
      for (const match of roomMatches.values()) clearRoomTimers(match);
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
  const listenOptions = resolveListenOptions(process.argv.slice(2), process.env);
  startServer({ port: listenOptions.port, host: listenOptions.host }).then(function (handle) {
    const addr = handle.address;
    console.log('[boardgame-api] listening on http://' + addr.address + ':' + addr.port);
    if (addr.address === '0.0.0.0' || addr.address === '::') {
      console.log('[boardgame-api] LAN mode: invite URLs use the request Host header; internal use only');
    }
  }).catch(function (err) {
    console.error('[boardgame-api] failed: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}

export default { createApiServer: createApiServer, startServer: startServer, resolveListenOptions: resolveListenOptions };
