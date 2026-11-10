/* Chinese Checkers adapter for games/shared/boardgame-room-server.mjs. */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('./engine.js');

function payloadMove(action) {
  if (!action) return null;
  if (action.move) return action.move;
  if (typeof action.from === 'number' && typeof action.to === 'number') return action;
  return null;
}

export const checkersAdapter = {
  game: 'checkers-jump',
  aiNames: ['AI · 朱红', 'AI · 琥珀'],

  initialState() { return E.setup(2); },

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
    const player = next.active[seatIndex];
    next.over = true;
    next.winner = next.active[(seatIndex + 1) % next.active.length];
    next.reason = 'resign';
    next.resignedBy = player;
    return next;
  },

  aiAction(state) {
    const level = Number(process.env.CHECKERS_ONLINE_AI_LEVEL || 2);
    const budget = Number(process.env.CHECKERS_ONLINE_AI_MS || 180);
    const m = E.aiMove(state, level, budget);
    if (!m) return null;
    return { type: 'move', move: { from: m.from, to: m.to, path: m.path } };
  },

  isOver(state) { return !!state.over; },
  turnSeat(state) { return state.active.indexOf(state.turn); },
  moveCount(state) { return state.history.length; },
  result(state) {
    return {
      winnerSeat: state.winner >= 0 ? state.active.indexOf(state.winner) : null,
      reason: state.reason || (state.over ? 'over' : '')
    };
  },
  view(state, seatIndex) { return E.publicState(state, seatIndex); },
  legal(state) {
    return E.legalMovesForTurn(state).map((m) => ({
      type: 'move', from: m.from, to: m.to, path: m.path.slice(), jump: !!m.jump,
      notation: E.notation(m)
    }));
  }
};

export default { adapter: checkersAdapter };
