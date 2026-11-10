#!/usr/bin/env node
/*
 * Backgammon / 双陆棋 premium — online room adapter.
 *
 * Room, invite, password, reconnect, AI fill, timeout takeover, leaderboard and
 * rematch plumbing live in games/shared/online-room-server.mjs. This file only
 * adapts the pure backgammon engine:
 *
 *   actions: { type:'roll' }
 *            { type:'move', from: 1..24 | 'bar', to: 1..24 | 'off', die: 1..6 }
 *            { type:'endTurn' }
 *            { type:'double' } | { type:'take' } | { type:'pass' }
 *
 * The server is authoritative. Both players already know the whole board in
 * backgammon; the only private data is the RNG seed and the server-side history,
 * both of which publicView() omits. legalActions() is viewer-specific, so a
 * player never receives the opponent's first-step moves.
 *
 *   node games/boardgame/backgammon-premium/online-server.mjs --port 8787
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOnlineServer, startOnlineServer } from '../../shared/online-room-server.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const E = require(path.join(__dirname, 'engine.js'));

const SLUG = 'backgammon-premium';
const AI_NAMES = ['白方 · AI', '黑檀守卫 · AI'];
const VALID = ['roll', 'move', 'endTurn', 'double', 'take', 'pass'];

function scoreList(match) {
  const s = match.state && match.state.scoreInfo;
  const points = s ? s.points : 0;
  const winner = s ? s.winner : null;
  return [0, 1].map(function (seat) {
    if (winner == null) return 0;
    return seat === winner ? points : -points;
  });
}

export const adapter = {
  slug: SLUG,
  title: '双陆棋 Backgammon',
  minPlayers: 2,
  maxPlayers: 2,
  defaultPlayers: 2,
  aiNames: AI_NAMES,
  seatCount() { return 2; },

  createMatch({ seed, seats }) {
    const names = seats.map(function (seat, i) {
      return (seat && seat.name) || AI_NAMES[i] || ('玩家 ' + (i + 1));
    });
    const state = E.setup({
      seed: seed == null ? 20261110 : seed,
      names: names,
      ai: seats.map(function (seat) { return Boolean(seat && seat.ai); })
    });
    return {
      state: state,
      seats: seats,
      ai: seats.map(function (seat) { return Boolean(seat && seat.ai); }),
      seed: seed,
      startedAt: Date.now()
    };
  },

  view(match, seatIndex) {
    const viewer = seatIndex == null ? -1 : seatIndex;
    const view = E.publicView(match.state, viewer);
    view.you = viewer;
    view.names = match.state.names.slice();
    view.ai = (match.ai || [false, false]).slice();
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match.state;
    if (!state || seatIndex == null || state.phase === 'over') return [];
    if (state.cube.pending) {
      const responder = E.cubeResponder(state);
      return responder === seatIndex ? [{ type: 'take' }, { type: 'pass' }] : [];
    }
    if (state.turn !== seatIndex) return [];
    if (state.phase === 'roll') {
      const actions = [{ type: 'roll' }];
      if (E.canDouble(state, seatIndex)) actions.push({ type: 'double', value: Math.min(64, state.cube.value * 2) });
      return actions;
    }
    if (state.phase === 'move') {
      const moves = E.legalMoves(state, seatIndex);
      if (!moves.length) return [{ type: 'endTurn' }];
      return moves.map(function (m) {
        return { type: 'move', from: m.from, to: m.to, die: m.die };
      });
    }
    return [];
  },

  applyAction(match, seatIndex, action) {
    const state = match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (!action || VALID.indexOf(action.type) === -1) {
      return { ok: false, error: 'unknown action', code: 'E_MOVE' };
    }
    if (state.phase === 'over') return { ok: false, error: 'game is over', code: 'E_STATE' };
    try {
      if (action.type === 'take' || action.type === 'pass') {
        if (!state.cube.pending) return { ok: false, error: 'no double pending', code: 'E_STATE' };
        if (E.cubeResponder(state) !== seatIndex) return { ok: false, error: 'not the responder', code: 'E_TURN' };
        if (action.type === 'take') E.takeCube(state, seatIndex);
        else E.passCube(state, seatIndex);
        return { ok: true };
      }
      if (state.cube.pending) return { ok: false, error: 'cube response pending', code: 'E_CUBE' };
      if (state.turn !== seatIndex) return { ok: false, error: 'not your turn', code: 'E_TURN' };
      if (action.type === 'roll') {
        if (state.phase !== 'roll') return { ok: false, error: 'already rolled', code: 'E_STATE' };
        E.rollDice(state);
        return { ok: true };
      }
      if (action.type === 'double') {
        if (state.phase !== 'roll') return { ok: false, error: 'double only before rolling', code: 'E_STATE' };
        if (!E.canDouble(state, seatIndex)) return { ok: false, error: 'doubling is not allowed', code: 'E_CUBE' };
        E.doubleCube(state, seatIndex);
        return { ok: true };
      }
      if (action.type === 'endTurn') {
        if (state.phase !== 'move') return { ok: false, error: 'not moving', code: 'E_STATE' };
        if (E.legalMoves(state, seatIndex).length) return { ok: false, error: 'legal moves remain', code: 'E_MOVE' };
        E.endTurn(state);
        return { ok: true };
      }
      if (action.type === 'move') {
        if (state.phase !== 'move') return { ok: false, error: 'roll first', code: 'E_STATE' };
        E.applyMove(state, { from: action.from, to: action.to, die: action.die });
        return { ok: true };
      }
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_MOVE' };
    }
    return { ok: false, error: 'unhandled action', code: 'E_MOVE' };
  },

  // Pure decision, never mutates. The shared server applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.phase === 'over') return null;
    if (state.cube.pending) {
      if (E.cubeResponder(state) !== seatIndex) return null;
      const reply = E.aiCubeResponse(state, seatIndex);
      return reply ? { type: reply } : null;
    }
    if (state.turn !== seatIndex) return null;
    if (state.phase === 'roll') return { type: 'roll' };
    if (state.phase === 'move') {
      const moves = E.legalMoves(state, seatIndex);
      if (!moves.length) return { type: 'endTurn' };
      const move = E.aiMove(state, seatIndex, { level: 'normal' });
      if (!move) return { type: 'endTurn' };
      return { type: 'move', from: move.from, to: move.to, die: move.die };
    }
    return null;
  },

  isOver(match) {
    return !!(match && match.state && match.state.phase === 'over');
  },

  result(match) {
    const state = match.state;
    const s = state.scoreInfo || {};
    const scores = scoreList(match);
    return {
      winnerSeat: state.winner,
      winnerSeats: state.winner == null ? [] : [state.winner],
      winnerName: state.winner == null ? null : state.names[state.winner],
      tied: false,
      scores: scores,
      winners: state.winner == null ? [] : [{
        seat: state.winner,
        name: state.names[state.winner],
        score: scores[state.winner]
      }],
      losers: scores.map(function (score, seat) {
        return { seat: seat, name: state.names[seat], score: score };
      }),
      type: s.type || null,
      multiplier: s.multiplier || 1,
      cubeValue: s.cubeValue || state.cube.value,
      points: s.points || 0,
      concedes: Boolean(s.concedes),
      off: state.off.slice(),
      pip: [E.pip(state, 0), E.pip(state, 1)],
      turns: state.turnNumber
    };
  },

  restart(match) {
    return this.createMatch({
      seed: (Date.now() ^ 0x5f3759df) >>> 0,
      seats: (match.seats || []).map(function (seat, i) {
        return { name: seat.name || AI_NAMES[i], ai: Boolean(seat.ai) };
      })
    });
  }
};

export function createBackgammonServer(options) {
  return createOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export function startBackgammonServer(options) {
  return startOnlineServer(Object.assign({}, options, { adapter: adapter }));
}

export { startOnlineServer };
export const startOnline = startBackgammonServer;

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const portArg = process.argv.indexOf('--port');
  const port = portArg !== -1 ? Number(process.argv[portArg + 1]) : 8787;
  startOnlineServer({ port: port, adapter: adapter }).then(function (handle) {
    const addr = handle.address;
    console.log('[backgammon-online] http://' + addr.address + ':' + addr.port + '/boardgame/backgammon-premium/online.html');
    console.log('[backgammon-online] http://' + addr.address + ':' + addr.port + '/boardgame/backgammon-premium/index.html');
  }).catch(function (err) {
    console.error(err);
    process.exitCode = 1;
  });
}
