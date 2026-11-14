/*
 * Ticket to Ride premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps the two engine seats onto the
 * unified room contract; no rule and no room state machine lives here.
 *
 * Hidden information: the opponent's hand, kept destination tickets, the
 * draw deck/discard order and the remaining ticket deck are private. The
 * public projection exposes counts only. Spectators (seatIndex == null) see
 * no hand or ticket list at all.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'ticket-to-ride-premium';
const AI_NAMES = ['AI · 铁路大亨', 'AI · 调度员'];
const MIN_SEATS = 2;
const MAX_SEATS = 2;
const COLORS = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'orange', 'pink'];

function clampSeats(n) {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number(n) || MIN_SEATS));
}
function isSeat(index) {
  return Number.isInteger(index) && index >= 0 && index < MAX_SEATS;
}
function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && seat.name) || AI_NAMES[index] || ('座位 ' + (index + 1));
}
function turnSeatOf(state) {
  return state && Number.isInteger(state.turn) ? state.turn : null;
}
function handCount(player) {
  let total = Number(player && player.wilds) || 0;
  COLORS.forEach(function (color) { total += Number(player.hand && player.hand[color]) || 0; });
  return total;
}

// Public projection. `viewerIndex` is the absolute seat number; null means a
// spectator. Hand / kept tickets / deck order / seed never leave this module.
function publicState(state, viewerIndex) {
  if (!state) return null;
  const viewer = isSeat(viewerIndex) ? viewerIndex : null;
  return {
    version: state.moves,
    current: state.turn,
    phase: state.phase,
    drawsLeft: state.drawsLeft,
    finalTurnPlayer: state.finalTurnPlayer,
    over: !!state.over,
    market: state.market.slice(),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    ticketDeckCount: state.ticketDeck.length,
    routes: state.routes.slice(),
    pendingTickets: state.phase === 'ticketSelect' && state.turn === viewer
      ? state.pendingTickets.slice()
      : [],
    players: state.players.map(function (player, index) {
      const own = index === viewer;
      return {
        index: index,
        name: player.name,
        isAI: !!player.isAI,
        trains: player.trains,
        handCount: handCount(player),
        hand: own ? Object.assign({}, player.hand) : null,
        wilds: own ? player.wilds : null,
        ticketCount: player.tickets.length,
        tickets: own ? player.tickets.slice() : null
      };
    }),
    log: (state.log || []).slice(-30)
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, MAX_SEATS);
  const count = clampSeats(list.length || MIN_SEATS);
  const state = E.createGame({ seed: seed, humanFirst: true });
  // The engine always creates exactly two seats; rename / mark AI from the
  // room seats so the shared server's roster is authoritative.
  for (let i = 0; i < state.players.length; i += 1) {
    const seat = list[i];
    state.players[i].name = (seat && seat.name) || AI_NAMES[i] || ('座位 ' + (i + 1));
    state.players[i].isAI = seat ? Boolean(seat.ai) : true;
  }
  return { state: state, seats: list.slice(0, count), seed: seed, startedAt: Date.now() };
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  const type = String(action.type || '');
  if (type === 'drawCard') {
    const source = action.source === 'market' ? 'market' : action.source === 'deck' ? 'deck' : null;
    if (!source) return null;
    const move = { type: 'drawCard', source: source };
    if (source === 'market') {
      const index = Number(action.marketIndex);
      if (!Number.isInteger(index)) return null;
      move.marketIndex = index;
    }
    return move;
  }
  if (type === 'drawTickets') return { type: 'drawTickets' };
  if (type === 'keepTickets') {
    if (!Array.isArray(action.keep) || !action.keep.length) return null;
    return { type: 'keepTickets', keep: action.keep.map(Number) };
  }
  if (type === 'claimRoute') {
    const routeId = Number(action.routeId);
    if (!Number.isInteger(routeId)) return null;
    return { type: 'claimRoute', routeId: routeId };
  }
  if (type === 'pass') return { type: 'pass' };
  return null;
}

// Spectator log entry. Never expose hand indices, deck order or the raw body.
function publicAction(action) {
  if (!action || typeof action !== 'object') return { type: 'move' };
  if (action.type === 'drawCard') {
    return {
      type: 'drawCard',
      source: action.source === 'market' ? 'market' : 'deck',
      marketIndex: action.source === 'market' ? action.marketIndex : undefined
    };
  }
  if (action.type === 'claimRoute') {
    return { type: 'claimRoute', routeId: action.routeId };
  }
  if (action.type === 'keepTickets') {
    return {
      type: 'keepTickets',
      keepCount: action.keepCount != null
        ? action.keepCount
        : (Array.isArray(action.keep) ? action.keep.length : 0)
    };
  }
  if (action.type === 'drawTickets' || action.type === 'pass') {
    return { type: action.type };
  }
  return { type: 'move' };
}

// The shared room server keeps the raw request action on the room's
// `lastAction`. Rewrite that object in place to the public projection so a
// polling opponent never receives hand indices or unknown request fields.
function sanitizeInPlace(action, safe) {
  if (!action || typeof action !== 'object') return;
  try {
    Object.keys(action).forEach(function (key) { delete action[key]; });
    Object.assign(action, safe);
  } catch (err) { /* frozen input: view() still never emits it */ }
}

const adapter = {
  slug: SLUG,
  title: '车票之旅 · 联机',
  minPlayers: MIN_SEATS,
  maxPlayers: MAX_SEATS,
  defaultPlayers: MIN_SEATS,
  aiNames: AI_NAMES,

  seatCount() {
    return MAX_SEATS;
  },

  createMatch(options) {
    const opts = options || {};
    return buildMatch(opts.seed, opts.seats);
  },

  view(match, seatIndex) {
    const view = publicState(match && match.state, seatIndex);
    if (!view) return null;
    if (match && Array.isArray(match.seats)) {
      view.players.forEach(function (player, index) {
        const seat = match.seats[index];
        if (!seat) return;
        if (seat.name) player.name = seat.name;
        if (seat.ai != null) player.isAI = Boolean(seat.ai);
      });
    }
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || !isSeat(seatIndex)) return [];
    if (turnSeatOf(state) !== seatIndex) return [];
    return E.legalMoves(state).map(function (move) {
      if (move.type === 'drawCard') {
        const out = { type: 'drawCard', source: move.source };
        if (move.source === 'market') out.marketIndex = move.marketIndex;
        return out;
      }
      if (move.type === 'claimRoute') return { type: 'claimRoute', routeId: move.routeId };
      if (move.type === 'keepTickets') return { type: 'keepTickets', keep: move.keep.slice() };
      return { type: move.type };
    });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.over) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (!isSeat(seatIndex) || turnSeatOf(state) !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = normalizeAction(action);
    if (!move) return { ok: false, error: 'action payload required', code: 'E_ACTION' };
    try {
      const next = E.applyMove(state, move);
      match.state = next;
      sanitizeInPlace(action, publicAction(move));
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal move', code: 'E_ACTION' };
    }
  },

  // Pure decision; the caller applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || !isSeat(seatIndex)) return null;
    if (turnSeatOf(state) !== seatIndex) return null;
    let move;
    try { move = E.aiMove(state); } catch (err) { return null; }
    return normalizeAction(move);
  },

  actingSeat(match) {
    return turnSeatOf(match && match.state);
  },

  isOver(match) {
    return !!(match && match.state && match.state.over);
  },

  result(match) {
    const state = match && match.state;
    if (!state) {
      return { winnerSeat: null, winnerName: null, tied: true, scores: [], rounds: 0, turns: 0 };
    }
    const score = E.score(state);
    const winner = E.winner(state);
    const winnerSeat = winner === 'human' ? 0 : winner === 'ai' ? 1 : null;
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null ? null : seatName(match, winnerSeat),
      tied: winnerSeat == null,
      reason: state.over ? 'final' : '',
      scores: [score.human, score.ai],
      rounds: state.moves,
      turns: state.moves,
      detail: {
        human: score.humanDetail,
        ai: score.aiDetail
      }
    };
  },

  restart(match, seats) {
    const source = Array.isArray(seats) && seats.length ? seats : ((match && match.seats) || []);
    return buildMatch(
      (Date.now() ^ 0x85ebca6b) >>> 0,
      source.slice(0, MAX_SEATS).map(function (seat, index) {
        return {
          name: (seat && (seat.nickname || seat.name)) || seatName(match, index),
          ai: Boolean(seat && seat.ai)
        };
      })
    );
  },

  hiddenKeys: [
    'hand', 'hands', 'handCards', 'deck', 'discard', 'ticketDeck',
    'pendingTickets', 'tickets', 'orders', 'seed', 'rng', 'wilds',
    'lastAction'
  ],
  publicAction: publicAction
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch,
  turnSeatOf: turnSeatOf
};
