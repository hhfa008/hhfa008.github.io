/* International Draughts adapter for games/shared/boardgame-room-server.mjs. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./engine.js');

function payloadMove(action) {
  if (!action) return null;
  if (action.move) return action.move;
  if (typeof action.from === 'number' && typeof action.to === 'number') return action;
  return null;
}

export const draughtsAdapter = {
  game: 'draughts',
  aiNames: ['AI · 白棋', 'AI · 黑棋'],

  initialState() { return E.createGame(); },

  apply(state, action) {
    if (!action || (action.type || 'move') !== 'move') throw new Error('unsupported action');
    const payload = payloadMove(action);
    if (!payload) throw new Error('move payload required');
    const move = E.findMove(state, payload);
    if (!move) throw new Error('不符合规则的着法');
    return E.applyMove(state, move);
  },

  resign(state, seatIndex) {
    const next = E.clone(state);
    next.over = true;
    next.winner = seatIndex === 0 ? E.BLACK : E.WHITE;
    next.reason = 'resign';
    return next;
  },

  aiAction(state) {
    const level = Number(process.env.DRAUGHTS_ONLINE_AI_LEVEL || 2);
    const budget = Number(process.env.DRAUGHTS_ONLINE_AI_MS || 180);
    const m = E.aiMove(state, level, budget);
    if (!m) return null;
    return {
      type: 'move',
      move: { from: m.from, to: m.to, path: m.path, captures: m.captures }
    };
  },

  isOver(state) { return !!state.over; },
  turnSeat(state) { return state.turn === E.WHITE ? 0 : 1; },
  moveCount(state) { return state.history.length; },
  result(state) {
    return {
      winnerSeat: state.winner === E.WHITE ? 0 : state.winner === E.BLACK ? 1 : null,
      reason: state.reason || (state.over ? 'over' : '')
    };
  },
  view(state, seatIndex) { return E.publicState(state, seatIndex); },
  legal(state) {
    return E.legalMoves(state).map((m) => ({
      type: 'move', from: m.from, to: m.to, path: m.path, captures: m.captures,
      notation: E.moveNotation(m)
    }));
  }
};

export default { adapter: draughtsAdapter };
