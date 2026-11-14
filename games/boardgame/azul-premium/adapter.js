/*
 * Azul premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps Azul seats onto engine.js; no rule
 * and no room state machine lives here.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'azul-premium';
const AI_NAMES = ['你', 'AI · 鎏金匠', 'AI · 朱砂匠', 'AI · 墨玉匠'];
const MIN_SEATS = 2;
const MAX_SEATS = 4;

function clampSeats(n) {
  return Math.max(MIN_SEATS, Math.min(MAX_SEATS, Number(n) || MIN_SEATS));
}
function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && seat.name) || AI_NAMES[index] || ('座位 ' + (index + 1));
}
function turnSeatOf(state) {
  return state && Number.isInteger(state.current) ? state.current : null;
}
function movePayload(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.move && typeof action.move === 'object') return action.move;
  if (action.source === 'factory' || action.source === 'center') return action;
  return null;
}

// Public projection: no bag/discard arrays (their order is the only hidden
// information), only counts. Every board and factory is open.
function publicState(state) {
  if (!state) return null;
  return {
    version: state.version,
    playerCount: state.playerCount,
    players: state.players.map(function (p) {
      return {
        index: p.index,
        name: p.name,
        isAI: !!p.isAI,
        score: p.score,
        lines: p.lines.map(function (line) { return line.slice(); }),
        wall: p.wall.map(function (row) { return row.slice(); }),
        floor: p.floor.slice()
      };
    }),
    factories: state.factories.map(function (factory) { return factory.slice(); }),
    center: state.center.slice(),
    centerMarker: state.centerMarker,
    current: state.current,
    firstPlayer: state.firstPlayer,
    round: state.round,
    turn: state.turn,
    over: !!state.over,
    overReason: state.overReason,
    result: state.result,
    lastAction: state.lastAction,
    lastRound: state.lastRound,
    log: (state.log || []).slice(-30).map(function (entry) {
      return {
        turn: entry.turn,
        round: entry.round,
        player: entry.player,
        type: entry.type,
        text: entry.text
      };
    }),
    bagCount: state.bag.length,
    discardCount: state.discard.length
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, MAX_SEATS);
  const count = clampSeats(list.length || MIN_SEATS);
  const names = [];
  const isAI = [];
  for (let i = 0; i < count; i += 1) {
    const seat = list[i];
    names.push((seat && seat.name) || AI_NAMES[i] || ('座位 ' + (i + 1)));
    isAI.push(seat ? Boolean(seat.ai) : true);
  }
  const state = E.createGame({ seed: seed, playerCount: count, names: names, isAI: isAI });
  return { state: state, seats: list, seed: seed, startedAt: Date.now() };
}

const adapter = {
  slug: SLUG,
  title: '花砖物语 · 联机',
  minPlayers: MIN_SEATS,
  maxPlayers: MAX_SEATS,
  defaultPlayers: MIN_SEATS,
  aiNames: AI_NAMES,

  seatCount(options) {
    const humans = options && options.humans;
    return clampSeats(Math.max(MIN_SEATS, Number(humans) || 0));
  },

  createMatch(options) {
    return buildMatch(options.seed, options.seats);
  },

  view(match) {
    const view = publicState(match && match.state);
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
    if (!state || state.over || state.pendingRound || seatIndex == null) return [];
    if (turnSeatOf(state) !== seatIndex) return [];
    return E.getLegalMoves(state).map(function (move) {
      return {
        type: 'take',
        source: move.source,
        factoryIndex: move.factoryIndex,
        color: move.color,
        row: move.row
      };
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
      const next = E.applyMove(state, {
        source: move.source,
        factoryIndex: move.factoryIndex == null ? -1 : move.factoryIndex,
        color: move.color,
        row: move.row
      });
      match.state = next;
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal move', code: 'E_ACTION' };
    }
  },

  // Pure decision; the caller applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || state.pendingRound || seatIndex == null) return null;
    if (turnSeatOf(state) !== seatIndex) return null;
    let move;
    try { move = E.chooseAIMove(state); } catch (err) { return null; }
    if (!move) return null;
    return {
      type: 'take',
      source: move.source,
      factoryIndex: move.factoryIndex,
      color: move.color,
      row: move.row
    };
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
      reason: state.overReason || (state.over ? 'over' : ''),
      scores: row && Array.isArray(row.scores)
        ? row.scores.map(function (score) { return score.total; })
        : state.players.map(function (player) { return player.score; }),
      rounds: state.round,
      turns: state.turn,
      detail: row
    };
  },

  restart(match, seats) {
    const list = Array.isArray(seats) && seats.length ? seats : (match.seats || []);
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

  hiddenKeys: [],
  publicAction(action) {
    const move = movePayload(action);
    if (!move) return { type: 'take' };
    return {
      type: 'take',
      source: move.source,
      factoryIndex: move.factoryIndex == null ? -1 : move.factoryIndex,
      color: move.color,
      row: move.row
    };
  }
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch,
  turnSeatOf: turnSeatOf
};
