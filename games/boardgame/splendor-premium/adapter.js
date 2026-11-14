/*
 * Splendor premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps two seats onto engine.js; no room
 * state machine lives here.
 *
 * Hidden information: each opponent's reserved cards and the three deck
 * orders. view() returns the viewer's own reserved cards, only a reserved
 * count for the opponent, and deck sizes instead of deck arrays. The seed is
 * never exposed. Spectators pass seatIndex=null and hiddenKeys strips
 * reserved/deck/seed from the read-only watch feed.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'splendor-premium';
const SEATS = 2;
const AI_NAMES = ['AI · 黄金座位', 'AI · 白银座位'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function copyCard(card) {
  return card ? Object.assign({}, card) : null;
}
function turnSeatOf(state) {
  return state && Number.isInteger(state.current) ? state.current : null;
}
function movePayload(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.move && typeof action.move === 'object') return action.move;
  if (action.act && typeof action.act === 'object') return action.act;
  return action;
}

// Log-safe action: colours/tiers are public at the table; a blind deck reserve
// must not name the card, and the raw request body is never echoed.
function publicAction(action) {
  const move = movePayload(action);
  if (!move || typeof move !== 'object') return null;
  const type = move.type || 'move';
  if (type === 'take3') {
    return { type: 'take3', colors: Array.isArray(move.colors) ? move.colors.slice() : [] };
  }
  if (type === 'take2') {
    return { type: 'take2', color: move.color };
  }
  if (type === 'reserve') {
    const out = { type: 'reserve', source: move.source === 'deck' ? 'deck' : 'faceUp' };
    if (out.source === 'deck') {
      if (move.tier != null) out.tier = move.tier;
    } else if (move.cardId != null) {
      // A face-up reserve was already public before the action.
      out.cardId = move.cardId;
    }
    return out;
  }
  if (type === 'buy') {
    // The bought card is public once it is in a player's tableau.
    const out = { type: 'buy' };
    if (move.cardId != null) out.cardId = move.cardId;
    return out;
  }
  return { type: type };
}

function publicState(state, viewerIndex) {
  if (!state) return null;
  const viewer = Number.isInteger(viewerIndex) ? viewerIndex : null;
  return {
    current: state.current,
    round: state.round,
    turn: state.turn,
    over: !!state.over,
    overReason: state.overReason,
    endgameTriggered: !!state.endgameTriggered,
    endgameBy: state.endgameBy,
    gems: Object.assign({}, state.gems),
    faceUp: {
      1: (state.faceUp[1] || []).map(copyCard),
      2: (state.faceUp[2] || []).map(copyCard),
      3: (state.faceUp[3] || []).map(copyCard)
    },
    deckCounts: {
      1: (state.decks[1] || []).length,
      2: (state.decks[2] || []).length,
      3: (state.decks[3] || []).length
    },
    nobles: clone(state.nobles),
    players: state.players.map(function (player, index) {
      return {
        index: player.index,
        name: player.name,
        isAI: !!player.isAI,
        tokens: Object.assign({}, player.tokens),
        bonuses: Object.assign({}, player.bonuses),
        prestige: player.prestige,
        cards: player.cards.map(copyCard),
        nobles: player.nobles,
        reserved: index === viewer ? player.reserved.map(copyCard) : [],
        reservedCount: player.reserved.length
      };
    }),
    result: clone(state.result),
    log: (state.log || []).slice(-40).map(function (row) { return Object.assign({}, row); })
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, SEATS);
  const names = [];
  const isAI = [];
  for (let i = 0; i < SEATS; i += 1) {
    const seat = list[i];
    names.push((seat && seat.name) || AI_NAMES[i] || ('座位 ' + (i + 1)));
    isAI.push(seat ? Boolean(seat.ai) : i > 0);
  }
  const state = E.createGame({ seed: seed, names: names });
  state.players.forEach(function (player, index) {
    player.name = names[index];
    player.isAI = isAI[index];
  });
  return {
    state: state,
    seats: list.map(function (seat, index) {
      return { name: names[index], ai: isAI[index] };
    }),
    seed: seed,
    startedAt: Date.now()
  };
}

const adapter = {
  slug: SLUG,
  title: '璀璨宝石 · 联机',
  minPlayers: SEATS,
  maxPlayers: SEATS,
  defaultPlayers: SEATS,
  aiNames: AI_NAMES,

  seatCount() { return SEATS; },

  createMatch(options) {
    const opts = options || {};
    return buildMatch(opts.seed, opts.seats);
  },

  view(match, seatIndex) {
    return publicState(match && match.state, seatIndex);
  },

  legalActions(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || !Number.isInteger(seatIndex)) return [];
    if (turnSeatOf(state) !== seatIndex) return [];
    return E.getLegalMoves(state, seatIndex).map(function (move) {
      return clone(move);
    });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.over) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (!Number.isInteger(seatIndex) || turnSeatOf(state) !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = movePayload(action);
    if (!move || typeof move !== 'object') {
      return { ok: false, error: 'action is required', code: 'E_ACTION' };
    }
    try {
      const next = E.applyMove(state, move);
      match.state = next;
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_ACTION' };
    }
  },

  // Pure decision; the shared server applies the returned action exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || !Number.isInteger(seatIndex)) return null;
    if (turnSeatOf(state) !== seatIndex) return null;
    let move;
    try { move = E.chooseAIMove(state); } catch (err) { return null; }
    return move || null;
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
    const winnerSeat = row && row.winner != null ? row.winner : null;
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null
        ? null
        : (state.players[winnerSeat] && state.players[winnerSeat].name) || ('座位 ' + (winnerSeat + 1)),
      tied: winnerSeat == null,
      reason: state.overReason || (state.over ? 'over' : ''),
      scores: row && Array.isArray(row.scores)
        ? row.scores.map(function (score) {
          return score.prestige == null ? score.total : score.prestige;
        })
        : state.players.map(function (player) { return player.prestige; }),
      rounds: state.round,
      turns: state.turn,
      detail: row
    };
  },

  restart(match, seats) {
    const list = Array.isArray(seats) && seats.length ? seats : ((match && match.seats) || []);
    return buildMatch(
      (Date.now() ^ 0x85ebca6b) >>> 0,
      list.map(function (seat, index) {
        return {
          name: (seat && (seat.nickname || seat.name)) || AI_NAMES[index] || ('座位 ' + (index + 1)),
          ai: Boolean(seat && seat.ai)
        };
      })
    );
  },

  // Reserved cards, deck order and the seed never reach spectators.
  hiddenKeys: ['hand', 'hands', 'deck', 'decks', 'seed', 'reserved'],

  publicAction: publicAction
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  publicAction: publicAction,
  buildMatch: buildMatch,
  turnSeatOf: turnSeatOf
};
