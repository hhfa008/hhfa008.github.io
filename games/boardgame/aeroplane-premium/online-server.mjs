#!/usr/bin/env node
/*
 * Aeroplane Chess premium — online room server (2–4 seats, empty seats AI-filled).
 *
 * Room / invite / password / reconnect / timeout takeover / leaderboard /
 * rematch plumbing lives in games/shared/online-room-server.mjs. This adapter
 * only maps seats onto engine players and keeps the dice on the server.
 *
 *   node games/boardgame/aeroplane-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'aeroplane-premium';
const AI_NAMES = ['红方 · 云端', '黄方 · 疾风', '蓝方 · 深空', '绿方 · 青羽'];
const AI_LEVEL = 2;

function seatCountFor(humans) {
  const n = Number(humans) || 0;
  return Math.max(E.MIN_PLAYERS, Math.min(E.MAX_PLAYERS, Math.max(2, n)));
}

export const adapter = {
  slug: SLUG,
  title: '飞行棋 · 52 格彩环',
  minPlayers: E.MIN_PLAYERS,
  maxPlayers: E.MAX_PLAYERS,
  defaultPlayers: 2,
  aiNames: AI_NAMES,

  // One human fills to 2; two humans play 2; three or four humans use the
  // table size they brought (up to 4). Never more than 4 and never a 1-seat
  // game, so an AI opponent is always present.
  seatCount({ humans }) {
    return seatCountFor(humans);
  },

  createMatch({ seed, seats }) {
    const list = (seats || []).slice(0, E.MAX_PLAYERS);
    const names = list.map(function (seat, i) {
      return (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1));
    });
    while (names.length < E.MIN_PLAYERS) names.push(AI_NAMES[names.length] || ('玩家 ' + (names.length + 1)));
    const state = E.createGame({ seed: seed, players: names.length, names: names });
    const ai = list.map(function (seat) { return Boolean(seat && seat.ai); });
    while (ai.length < names.length) ai.push(true);
    for (let i = 0; i < state.players.length; i += 1) {
      state.players[i].human = !ai[i];
      if (ai[i]) state.players[i].name = names[i] || AI_NAMES[i];
    }
    E.ensureRoll(state);
    return { state: state, seats: list, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    if (!match || !match.state) return {};
    E.ensureRoll(match.state);
    const state = match.state;
    const viewer = seatIndex == null ? 0 : seatIndex;
    const view = E.publicView(state, viewer);
    view.turnSeat = state.phase === 'playing' ? state.turn : null;
    view.turnName = state.phase === 'playing' ? state.players[state.turn].name : null;
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, {
        seat: i,
        ai: Boolean(match.ai && match.ai[i])
      });
    });
    view.rolls = state.rolls;
    return view;
  },

  legalActions(match, seatIndex) {
    if (!match || !match.state) return [];
    E.ensureRoll(match.state);
    const state = match.state;
    if (state.phase !== 'playing') return [];
    if (seatIndex == null || seatIndex < 0) return [];
    if (state.turn !== seatIndex) return [];
    // The server already rolled; the client only ever chooses a plane.
    return E.planeActions(state).filter(function (action) { return action.k === 'move'; });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.phase !== 'playing') return { ok: false, error: 'game is over', code: 'E_STATE' };
    if (state.turn !== seatIndex) return { ok: false, error: 'not your turn', code: 'E_TURN' };
    if (!action || typeof action !== 'object') return { ok: false, error: 'missing action', code: 'E_MOVE' };
    if (action.k === 'roll' || action.dice != null || action.value != null) {
      return { ok: false, error: 'dice are rolled by the server', code: 'E_DICE' };
    }
    if (action.k !== 'move' && action.k !== 'skip') {
      return { ok: false, error: 'unsupported action', code: 'E_MOVE' };
    }
    E.ensureRoll(state);
    const result = E.applyAction(state, action);
    if (!result.ok) return { ok: false, error: result.error, code: result.code || 'E_MOVE' };
    return { ok: true, over: state.phase === 'over' };
  },

  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.phase !== 'playing') return null;
    if (state.turn !== seatIndex) return null;
    E.ensureRoll(state);
    if (state.phase !== 'playing' || state.turn !== seatIndex) return null;
    return E.aiAction(state, AI_LEVEL, function () { return E.nextRandom(state); });
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const winnerSeat = state.winner >= 0 ? state.winner : null;
    const scores = state.players.map(function (p) {
      return E.finishedCount(p) * 100 + E.playerProgress(p);
    });
    return {
      winnerSeat: winnerSeat,
      winnerSeats: winnerSeat == null ? [] : [winnerSeat],
      winnerName: winnerSeat == null ? null : state.players[winnerSeat].name,
      tied: winnerSeat == null,
      scores: scores,
      ranking: state.ranking.slice(),
      details: state.players.map(function (p, i) {
        return {
          seat: i,
          color: p.colorKey,
          finished: E.finishedCount(p),
          progress: E.playerProgress(p),
          planes: p.planes.slice()
        };
      }),
      rounds: null,
      turns: state.plies,
      rolls: state.rolls,
      reason: state.reason
    };
  },

  restart(match) {
    const seats = (match.seats || []).map(function (seat, i) {
      return {
        name: (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1)),
        ai: Boolean(seat && seat.ai)
      };
    });
    return this.createMatch({ seed: (Date.now() ^ 0x85ebca6b) >>> 0, seats: seats });
  }
};

export function createAeroplaneServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startAeroplaneServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer, seatCountFor };
export const startOnline = startAeroplaneServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[aeroplane-online] http://' + addr.address + ':' + addr.port + '/boardgame/aeroplane-premium/online.html');
    console.log('[aeroplane-online] http://' + addr.address + ':' + addr.port + '/boardgame/aeroplane-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
