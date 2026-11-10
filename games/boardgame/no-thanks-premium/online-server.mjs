#!/usr/bin/env node
/*
 * No Thanks! premium — online room server (2–5 humans, AI fills to 3+).
 *
 * All room/invite/reconnect/timeout/leaderboard plumbing lives in
 * games/shared/online-room-server.mjs. This file only adapts the No Thanks
 * engine: deal, take/pass, AI decision, public view and settlement.
 *
 * Rules run on the server. The deck order and the nine removed cards never
 * leave the server until the game is over.
 *
 *   node games/boardgame/no-thanks-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'no-thanks-premium';
const AI_NAMES = ['房主', '不谢达人', '筹码守财奴', '薄荷商人', '迟到的骑士'];

function scores(match) {
  const state = match.state;
  return state.players.map(function (_, i) { return E.score(state, i); });
}

export const adapter = {
  slug: SLUG,
  title: 'No Thanks! 不谢',
  minPlayers: 3,
  maxPlayers: 5,
  defaultPlayers: 3,
  aiNames: AI_NAMES,

  // Official game is 3–5 players. With one human, fill to 3; with two humans,
  // keep 3 so the table does not become unexpectedly larger.
  seatCount({ humans }) {
    return Math.max(3, Math.min(5, Math.max(3, humans)));
  },

  createMatch({ seed, seats }) {
    const state = E.createGame({
      seed: seed,
      players: seats.length,
      names: seats.map(function (seat, i) { return seat.name || AI_NAMES[i] || ('玩家 ' + (i + 1)); })
    });
    const ai = seats.map(function (seat) { return Boolean(seat.ai); });
    return { state: state, seats: seats, ai: ai, seed: seed, startedAt: Date.now() };
  },

  view(match, seatIndex) {
    const view = E.publicView(match.state, seatIndex == null ? 0 : seatIndex);
    view.turnSeat = match.state.phase === 'playing' ? match.state.turn : null;
    view.turnName = match.state.phase === 'playing' ? match.state.players[match.state.turn].name : null;
    view.players = view.players.map(function (player, i) {
      return Object.assign({}, player, { ai: Boolean(match.ai && match.ai[i]) });
    });
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase !== 'playing' || state.turn !== seatIndex) return [];
    const actions = [{ type: 'take' }];
    if (state.players[seatIndex].chips > 0) actions.push({ type: 'pass' });
    return actions;
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    try {
      if (!action || (action.type !== 'take' && action.type !== 'pass')) {
        return { ok: false, error: 'unknown action', code: 'E_MOVE' };
      }
      if (state.phase !== 'playing') return { ok: false, error: 'game is over', code: 'E_STATE' };
      if (state.turn !== seatIndex) return { ok: false, error: 'not your turn', code: 'E_TURN' };
      if (action.type === 'take') E.take(state, seatIndex);
      else E.pass(state, seatIndex);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
  },

  aiAction(match, seatIndex) {
    const state = match.state;
    if (!state || state.phase !== 'playing' || state.turn !== seatIndex) return null;
    return E.aiDecision(state, seatIndex);
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const list = scores(match);
    const winnerSeats = state.winnerIds && state.winnerIds.length
      ? state.winnerIds.slice()
      : (state.winner == null ? [] : [state.winner]);
    return {
      winnerSeat: winnerSeats.length === 1 ? winnerSeats[0] : null,
      winnerSeats: winnerSeats,
      winnerName: winnerSeats.length === 1 ? state.players[winnerSeats[0]].name : null,
      tied: winnerSeats.length !== 1,
      scores: list,
      losers: list.map(function (score, i) { return { seat: i, name: state.players[i].name, score: score }; }),
      rounds: null,
      turns: state.turnCount,
      removed: (state.removed || []).slice()
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

export function createNoThanksServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startNoThanksServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startNoThanksServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[no-thanks-online] http://' + addr.address + ':' + addr.port + '/boardgame/no-thanks-premium/online.html');
    console.log('[no-thanks-online] http://' + addr.address + ':' + addr.port + '/boardgame/no-thanks-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
