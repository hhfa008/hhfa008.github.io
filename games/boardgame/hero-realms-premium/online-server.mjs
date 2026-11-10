#!/usr/bin/env node
/*
 * 英雄领域 Hero Realms 精品版 — 联机房间服务适配器。
 *
 * 房间 / 邀请 / 密码 / 重连 / 超时托管 / 排行榜全部复用
 * games/shared/online-room-server.mjs。本文件只负责把 Hero Realms 引擎接到
 * 共享房间协议上：
 *
 *   座位 0 → state.sides.player（先手）
 *   座位 1 → state.sides.ai（后手）
 *
 * 两个座位，恰好 2 人。只有一个真人时，另一个座位由 AI 接管；两个真人
 * 加入后各占一个座位。服务端权威判定，客户端只能看到自己的手牌与公开信息。
 *
 *   node games/boardgame/hero-realms-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));
const D = require(path.join(__dirname, 'data.js'));

const SLUG = 'hero-realms-premium';
const AI_NAMES = ['房主', '黑曜领主'];
const ACTION_TYPES = ['play', 'activate', 'buy', 'attack', 'endTurn'];

function sideOfSeat(seatIndex) {
  return seatIndex === 1 ? 'ai' : 'player';
}

function sameAction(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'play') return a.handIndex === b.handIndex;
  if (a.type === 'activate') return a.uid === b.uid;
  if (a.type === 'buy') return a.marketIndex === b.marketIndex;
  if (a.type === 'attack') {
    var at = a.target || { kind: 'player' };
    var bt = b.target || { kind: 'player' };
    return at.kind === bt.kind && (at.kind !== 'champion' || at.uid === bt.uid) &&
      Number(a.amount) === Number(b.amount);
  }
  return true;
}

function normalizeAction(action, side) {
  if (!action || typeof action !== 'object') return null;
  if (ACTION_TYPES.indexOf(action.type) < 0) return null;
  var out = { type: action.type, side: side };
  if (action.type === 'play') out.handIndex = Number(action.handIndex);
  if (action.type === 'activate') out.uid = Number(action.uid);
  if (action.type === 'buy') out.marketIndex = Number(action.marketIndex);
  if (action.type === 'attack') {
    out.target = action.target && action.target.kind === 'champion'
      ? { kind: 'champion', uid: Number(action.target.uid) }
      : { kind: 'player' };
    out.amount = Number(action.amount);
  }
  return out;
}

function scores(match) {
  return [match.state.sides.player.hp, match.state.sides.ai.hp];
}

export const adapter = {
  slug: SLUG,
  title: '英雄领域 Hero Realms',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  seatCount() {
    return 2;
  },

  createMatch({ seed, seats }) {
    const state = E.createGame({
      cards: D,
      seed: seed == null ? Date.now() : seed,
      firstSide: 'player',
      names: (seats || []).map(function (seat, i) {
        return (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1));
      })
    });
    const ai = (seats || []).map(function (seat) { return Boolean(seat.ai); });
    while (ai.length < 2) ai.push(true);
    return { state: state, seats: seats, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const state = match.state;
    const seat = seatIndex == null ? 0 : seatIndex;
    const side = sideOfSeat(seat);
    const view = E.publicView(state, side);
    view.turnSeat = state.winner ? null : (state.turn === 'player' ? 0 : 1);
    view.turnName = state.winner ? null : state.sides[state.turn].name;
    view.you = seat;
    view.sides.player.ai = Boolean(match.ai && match.ai[0]);
    view.sides.ai.ai = Boolean(match.ai && match.ai[1]);
    view.sides.player.seat = 0;
    view.sides.ai.seat = 1;
    view.sides.player.name = state.sides.player.name;
    view.sides.ai.name = state.sides.ai.name;
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || state.winner) return [];
    const side = sideOfSeat(seatIndex);
    if (state.turn !== side) return [];
    return E.legalActions(state, side);
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    const side = sideOfSeat(seatIndex);
    try {
      if (!action || ACTION_TYPES.indexOf(action.type) < 0) {
        return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      }
      if (state.winner) return { ok: false, error: 'game is over', code: 'E_STATE' };
      if (state.turn !== side) return { ok: false, error: 'not your turn', code: 'E_TURN' };
      const normalized = normalizeAction(action, side);
      if (!normalized) return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      const legal = E.legalActions(state, side);
      const allowed = legal.some(function (item) { return sameAction(item, normalized); });
      if (!allowed) return { ok: false, error: 'illegal action', code: 'E_MOVE' };
      const next = E.applyAction(state, normalized);
      match.state = next;
      return { ok: true, over: Boolean(next.winner) };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
  },

  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.winner) return null;
    const side = sideOfSeat(seatIndex);
    if (state.turn !== side) return null;
    return E.aiAction(state, side);
  },

  isOver(match) {
    return !!(match && match.state && match.state.winner);
  },

  result(match) {
    const state = match.state;
    const winnerSeat = state.winner === 'player' ? 0 : (state.winner === 'ai' ? 1 : null);
    return {
      winnerSeat: winnerSeat,
      winnerSeats: winnerSeat == null ? [] : [winnerSeat],
      winnerName: winnerSeat == null ? null : state.sides[state.winner].name,
      tied: winnerSeat == null,
      scores: scores(match),
      hp: scores(match),
      losers: [
        { seat: 0, name: state.sides.player.name, score: state.sides.player.hp },
        { seat: 1, name: state.sides.ai.name, score: state.sides.ai.hp }
      ],
      rounds: null,
      turns: state.turnNumber,
      remainingHp: scores(match)
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)), ai: Boolean(seat.ai) };
      })
    });
  }
};

export function createHeroRealmsServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startHeroRealmsServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startHeroRealmsServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8788;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[hero-realms-online] http://' + addr.address + ':' + addr.port + '/boardgame/hero-realms-premium/online.html');
    console.log('[hero-realms-online] http://' + addr.address + ':' + addr.port + '/boardgame/hero-realms-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
