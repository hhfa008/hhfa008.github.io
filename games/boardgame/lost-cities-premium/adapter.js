/*
 * Lost Cities premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps two seats onto engine.js; no room
 * state machine lives here.
 *
 * Hidden information: the opponent's hand and the deck order. view() returns
 * the viewer's own hand object, an empty hand plus handCount for the opponent,
 * and only a deck count. Spectators pass seatIndex=null; hiddenKeys tells the
 * shared server to strip hand/deck/seed for the read-only watch feed.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'lost-cities-premium';
const SEATS = 2;
const AI_NAMES = ['AI · 苔原学者', 'AI · 黄铜向导'];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function copyCard(card) {
  return card ? Object.assign({}, card) : null;
}
function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && (seat.nickname || seat.name)) || AI_NAMES[index] || ('座位 ' + (index + 1));
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

// Log-safe action: never the hand index, never a raw request body, never the
// identity of a deck draw. Played/discarded cards are already public in the
// board state; the log only needs the type and (public) colour.
function publicAction(action) {
  const move = movePayload(action);
  if (!move || typeof move !== 'object') return null;
  const type = move.type || 'move';
  if (type === 'draw') {
    const out = { type: 'draw', source: move.source === 'discard' ? 'discard' : 'deck' };
    if (move.source === 'discard' && move.color) out.color = move.color;
    return out;
  }
  if (type === 'play' || type === 'discard') {
    const out = { type: type };
    if (move.color) out.color = move.color;
    return out;
  }
  return { type: type };
}

// state.lastAction carries handIndex and, for draws, the drawn card object.
// Reduce it to the public shape before it leaves the process.
function publicLastAction(lastAction) {
  if (!lastAction || typeof lastAction !== 'object') return null;
  if (lastAction.type === 'play' || lastAction.type === 'discard') {
    return {
      player: lastAction.player,
      type: lastAction.type,
      color: lastAction.color
    };
  }
  if (lastAction.type === 'draw') {
    const out = {
      player: lastAction.player,
      type: 'draw',
      source: lastAction.source === 'discard' ? 'discard' : 'deck',
      deckCount: lastAction.deckCount
    };
    if (lastAction.source === 'discard') out.color = lastAction.color;
    return out;
  }
  return { player: lastAction.player, type: lastAction.type || 'action' };
}

function publicState(state, viewerIndex) {
  if (!state) return null;
  const viewer = Number.isInteger(viewerIndex) ? viewerIndex : null;
  return {
    version: state.version,
    playerCount: SEATS,
    round: state.round,
    rounds: state.rounds,
    phase: state.phase,
    current: state.current,
    starter: state.starter,
    turn: state.turn,
    deckCount: state.deck.length,
    players: state.players.map(function (player, index) {
      return {
        index: player.index,
        name: player.name,
        isAI: !!player.isAI,
        hand: index === viewer ? player.hand.map(copyCard) : [],
        handCount: player.hand.length,
        exp: clone(player.exp),
        roundScores: player.roundScores.slice(),
        totalScore: player.totalScore
      };
    }),
    discards: clone(state.discards),
    pendingDiscard: state.pendingDiscard,
    lastAction: publicLastAction(state.lastAction),
    lastRound: clone(state.lastRound),
    roundResults: clone(state.roundResults || []),
    over: !!state.over,
    result: clone(state.result),
    log: (state.log || []).slice(-28).map(function (row) { return Object.assign({}, row); })
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
  const state = E.createGame({
    seed: seed,
    names: names,
    isAI: isAI,
    humanFirst: !isAI[0]
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
  title: '失落之城 · 联机',
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
    return E.getLegalMoves(state).map(function (move) {
      const out = {
        type: move.type,
        handIndex: move.handIndex,
        cardId: move.cardId,
        source: move.source,
        color: move.color,
        kind: move.kind,
        value: move.value
      };
      Object.keys(out).forEach(function (key) {
        if (out[key] === undefined) delete out[key];
      });
      return out;
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
      const next = E.applyMove(state, {
        type: move.type,
        handIndex: move.handIndex,
        cardId: move.cardId,
        source: move.source,
        color: move.color
      });
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
    try { move = E.chooseAIMove(state, 'normal'); } catch (err) { return null; }
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
      winnerName: winnerSeat == null ? null : seatName(match, winnerSeat),
      tied: row ? !!row.tied : true,
      reason: row && row.reason ? row.reason : (state.over ? '三局累计总分' : ''),
      scores: row && Array.isArray(row.scores)
        ? row.scores.map(function (score) { return score.total; })
        : state.players.map(function (player) { return player.totalScore; }),
      rounds: state.round,
      turns: state.turn,
      winners: row && Array.isArray(row.winners) ? row.winners.slice() : [],
      detail: row
    };
  },

  restart(match, seats) {
    const list = Array.isArray(seats) && seats.length ? seats : ((match && match.seats) || []);
    return buildMatch(
      (Date.now() ^ 0x85ebca6b) >>> 0,
      list.map(function (seat, index) {
        return {
          name: (seat && (seat.nickname || seat.name)) || seatName(match, index),
          ai: Boolean(seat && seat.ai)
        };
      })
    );
  },

  // Spectators never receive hands, deck order or the seed (with a seed the
  // shuffled order could be replayed). Opponent hands never have the key.
  hiddenKeys: ['hand', 'hands', 'deck', 'seed', 'reserved'],

  publicAction: publicAction
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  publicAction: publicAction,
  publicLastAction: publicLastAction,
  buildMatch: buildMatch,
  turnSeatOf: turnSeatOf
};
