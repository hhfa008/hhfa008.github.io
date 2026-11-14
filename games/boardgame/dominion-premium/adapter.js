/*
 * Dominion premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and any Worker backend
 * that loads the same module. Only maps Dominion seats onto engine.js; no room
 * state machine and no rule lives here.
 *
 * Hidden information: each player's hand and deck order are private. The
 * viewer sees its own hand, every opponent gets handCount/deckCount only, and
 * seed never leaves the adapter. Discard and play area are public.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'dominion-premium';
const AI_NAMES = ['你', 'AI · 摄政王'];
const MIN_SEATS = 2;
const MAX_SEATS = 2;

function clampSeats(n) {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number(n) || MIN_SEATS));
}
function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && seat.name) || AI_NAMES[index] || ('座位 ' + (index + 1));
}
function turnSeatOf(state) {
  return state && Number.isInteger(state.turn) ? state.turn : null;
}
function movePayload(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.move && typeof action.move === 'object') return action.move;
  if (typeof action.type === 'string') return action;
  return null;
}
function seatScore(state, index) {
  if (!state) return 0;
  const sc = E.score(state);
  return index === 0 ? sc.human : sc.ai;
}
// The shared room server keeps the raw request action on the room's
// `lastAction`. Rewrite it in place to the public projection so an opponent
// never receives hand indices, deck order or unknown request fields.
function sanitizeInPlace(action, safe) {
  if (!action || typeof action !== 'object') return;
  try {
    Object.keys(action).forEach(function (key) { delete action[key]; });
    Object.assign(action, safe);
  } catch (err) { /* frozen input: view() never emits it */ }
}

// Viewer-specific projection: own hand is an array, opponents only counts.
// Deck order is never serialized; only deckCount is exposed.
function publicState(state, match, seatIndex) {
  if (!state) return null;
  const mine = seatIndex == null ? null : seatIndex;
  return {
    turn: state.turn,
    phase: state.phase,
    actions: state.actions,
    buys: state.buys,
    coins: state.coins,
    moves: state.moves,
    over: !!state.over,
    result: state.result || null,
    supply: Object.assign({}, state.supply),
    players: state.players.map(function (p, index) {
      const seat = match && match.seats && match.seats[index];
      const own = mine === index;
      return {
        index: index,
        name: (seat && seat.name) || p.name,
        isAI: seat ? Boolean(seat.ai) : Boolean(p.isAI),
        score: seatScore(state, index),
        hand: own ? p.hand.slice() : [],
        handCount: p.hand.length,
        deckCount: p.deck.length,
        discard: p.discard.slice(),
        discardCount: p.discard.length,
        playArea: p.playArea.slice()
      };
    }),
    log: (state.log || []).slice(-40).map(function (entry) {
      return {
        turn: entry.turn,
        player: entry.player,
        type: entry.type,
        text: entry.text
      };
    }),
    events: (state.events || []).slice(-8).map(function (event) {
      return Object.assign({}, event);
    })
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, MAX_SEATS);
  const count = clampSeats(list.length || MIN_SEATS);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    const seat = list[i];
    names.push((seat && seat.name) || AI_NAMES[i] || ('座位 ' + (i + 1)));
  }
  const state = E.createGame({ seed: seed, names: names, humanFirst: true });
  return { state: state, seats: list, seed: seed, startedAt: Date.now() };
}

const adapter = {
  slug: SLUG,
  title: '领土 · 联机',
  minPlayers: MIN_SEATS,
  maxPlayers: MAX_SEATS,
  defaultPlayers: MIN_SEATS,
  aiNames: AI_NAMES,

  seatCount() {
    return MAX_SEATS;
  },

  createMatch(options) {
    return buildMatch(options.seed, options.seats);
  },

  view(match, seatIndex) {
    return publicState(match && match.state, match, seatIndex);
  },

  legalActions(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || seatIndex == null) return [];
    if (turnSeatOf(state) !== seatIndex) return [];
    return E.legalMoves(state).map(function (move) {
      if (move.type === 'playAction' || move.type === 'buy') {
        return { type: move.type, cardId: move.cardId };
      }
      return { type: move.type };
    });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.over) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (seatIndex == null || turnSeatOf(state) !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = movePayload(action);
    if (!move) return { ok: false, error: 'move payload required', code: 'E_ACTION' };
    try {
      const next = E.applyMove(state, move);
      match.state = next;
      sanitizeInPlace(action, adapter.publicAction(move));
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal move', code: 'E_ACTION' };
    }
  },

  // Pure decision; the shared room server applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || seatIndex == null) return null;
    if (turnSeatOf(state) !== seatIndex) return null;
    try {
      return E.aiMove(state) || null;
    } catch (err) {
      return null;
    }
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
    const row = state.result || null;
    const scores = [seatScore(state, 0), seatScore(state, 1)];
    let winnerSeat = null;
    if (row && row.winner === 'human') winnerSeat = 0;
    else if (row && row.winner === 'ai') winnerSeat = 1;
    else if (row && row.winner === 'tie') winnerSeat = null;
    else if (state.over) {
      if (scores[0] !== scores[1]) winnerSeat = scores[0] > scores[1] ? 0 : 1;
    }
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null ? null : seatName(match, winnerSeat),
      tied: winnerSeat == null,
      reason: state.over ? ((row && row.reason) || 'over') : '',
      scores: scores,
      rounds: state.moves,
      turns: state.moves,
      detail: row
    };
  },

  restart(match, seats) {
    const source = Array.isArray(seats) && seats.length ? seats : ((match && match.seats) || []);
    const list = source.map(function (seat, index) {
      return {
        name: (seat && (seat.name || seat.nickname)) || seatName(match, index),
        ai: Boolean(seat && seat.ai)
      };
    });
    return buildMatch((Date.now() ^ 0x85ebca6b) >>> 0, list);
  },

  hiddenKeys: ['hand', 'hands', 'deck', 'seed', 'role', 'roles', 'word', 'words', 'known', 'lastAction'],

  // Spectator log action: played/bought card ids are public, but never the
  // request body, hand index, deck order or seed.
  publicAction(action) {
    const move = movePayload(action);
    if (!move) return { type: 'move' };
    if (move.type === 'playAction') return { type: 'playAction', cardId: move.cardId };
    if (move.type === 'buy') return { type: 'buy', cardId: move.cardId };
    if (move.type === 'endPhase') return { type: 'endPhase' };
    return { type: String(move.type || 'move') };
  }
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch,
  turnSeatOf: turnSeatOf
};
