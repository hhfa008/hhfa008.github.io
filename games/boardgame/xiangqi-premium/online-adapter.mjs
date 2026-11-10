/* Xiangqi adapter for games/shared/boardgame-room-server.mjs. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./engine.js');

function moveCode(action) {
  if (action == null) return null;
  if (typeof action === 'number') return action;
  if (typeof action.code === 'number') return action.code;
  if (action.move == null) return null;
  if (typeof action.move === 'number') return action.move;
  if (typeof action.move.code === 'number') return action.move.code;
  if (typeof action.move.from === 'number' && typeof action.move.to === 'number') {
    return E.encode(action.move.from, action.move.to);
  }
  return null;
}

export const xiangqiAdapter = {
  game: 'xiangqi',
  aiNames: ['AI · 楚河', 'AI · 汉界'],

  initialState() {
    return E.createGame();
  },

  apply(state, action, seatIndex) {
    if (!action || (action.type || 'move') !== 'move') throw new Error('unsupported action');
    const code = moveCode(action);
    if (code == null) throw new Error('move code required');
    return E.applyMove(state, code);
  },

  resign(state, seatIndex) {
    const next = E.cloneState(state);
    next.over = true;
    next.winner = seatIndex === 0 ? E.BLACK : E.RED;
    next.reason = 'resign';
    return next;
  },

  aiAction(state) {
    const level = Number(process.env.XIANGQI_ONLINE_AI_LEVEL || 2);
    const budget = Number(process.env.XIANGQI_ONLINE_AI_MS || 180);
    const m = E.aiMove(state, level, budget);
    if (m == null) return null;
    return { type: 'move', move: { code: m, from: E.moveFrom(m), to: E.moveTo(m) } };
  },

  isOver(state) { return !!state.over; },
  turnSeat(state) { return state.turn === E.RED ? 0 : 1; },
  moveCount(state) { return state.history.length; },
  result(state) {
    return {
      winnerSeat: state.winner === E.RED ? 0 : state.winner === E.BLACK ? 1 : null,
      reason: state.reason || (state.over ? 'over' : '')
    };
  },
  view(state, seatIndex) { return E.publicState(state, seatIndex); },
  legal(state) {
    return E.legalMovesFor(state).map((m) => ({
      type: 'move', from: E.moveFrom(m), to: E.moveTo(m), code: m,
      notation: E.moveToChinese(state.board, m)
    }));
  }
};

export default { adapter: xiangqiAdapter };
