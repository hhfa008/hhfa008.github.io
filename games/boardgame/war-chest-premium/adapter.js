/*
 * War Chest premium — pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps the two engine seats onto the
 * unified room contract; no rule and no room state machine lives here.
 *
 * Hidden information: each player's hand (the command coins available this
 * turn) and the order of their bag/discard pile are private. The public
 * projection exposes hand / bag / discard counts plus the board, reserves,
 * strongholds and units. Spectators (seatIndex == null) see no hand at all,
 * and no seed / rng / draw-pile order is ever emitted.
 */
'use strict';

const E = require('./engine.js');

const SLUG = 'war-chest-premium';
const AI_NAMES = ['AI · 铁腕领主', 'AI · 边境校尉'];
const MIN_SEATS = 2;
const MAX_SEATS = 2;

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
function currentSeatOf(state) {
  return state && Number.isInteger(state.current) ? state.current : null;
}

// Public projection. `viewerIndex` is the absolute seat number; null means a
// spectator. Hand arrays and bag order stay behind this boundary.
function publicState(state, viewerIndex) {
  if (!state) return null;
  const viewer = isSeat(viewerIndex) ? viewerIndex : null;
  return {
    version: state.turn,
    current: state.current,
    turn: state.turn,
    over: !!state.over,
    result: state.result,
    maxTurns: state.maxTurns,
    strongholds: state.strongholds.map(function (sh) {
      return { id: sh.id, r: sh.r, c: sh.c, side: sh.side, owner: sh.owner };
    }),
    units: state.units.map(function (unit) {
      return {
        id: unit.id, owner: unit.owner, type: unit.type,
        r: unit.r, c: unit.c, hp: unit.hp, maxHp: unit.maxHp
      };
    }),
    players: state.players.map(function (player, index) {
      const own = index === viewer;
      return {
        index: index,
        name: player.name,
        isAI: !!player.isAI,
        hand: own ? player.hand.slice() : null,
        handCount: player.hand.length,
        handCounts: own ? E.handCounts(player) : null,
        bagCount: player.bag.length,
        discardCount: player.discard.length,
        coins: E.coinTotal(player),
        reserves: Object.assign({}, player.reserves),
        units: E.unitsOf(state, index).length,
        control: E.controlCount(state, index)
      };
    }),
    log: (state.log || []).slice(-30).map(function (entry) { return Object.assign({}, entry); })
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, MAX_SEATS);
  const count = clampSeats(list.length || MIN_SEATS);
  const aiPlayer = list[0] && list[0].ai ? 0 : 1;
  const state = E.createGame({ seed: seed, aiPlayer: aiPlayer });
  for (let i = 0; i < state.players.length; i += 1) {
    const seat = list[i];
    state.players[i].name = (seat && seat.name) || AI_NAMES[i] || ('座位 ' + (i + 1));
    state.players[i].isAI = seat ? Boolean(seat.ai) : true;
  }
  return { state: state, seats: list.slice(0, count), seed: seed, startedAt: Date.now() };
}

// Force every action onto the acting seat; clients cannot act as the opponent.
function normalizeAction(action, seatIndex) {
  if (!action || typeof action !== 'object') return null;
  const type = String(action.type || '');
  if (type === 'end') return { type: 'end', player: seatIndex };
  if (type === 'deploy') {
    if (typeof action.unitType !== 'string') return null;
    const r = Number(action.r);
    const c = Number(action.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { type: 'deploy', player: seatIndex, unitType: action.unitType, r: r, c: c };
  }
  if (type === 'move') {
    const unitId = Number(action.unitId);
    const target = action.to && typeof action.to === 'object' ? action.to : null;
    if (!Number.isInteger(unitId) || !target) return null;
    const r = Number(target.r);
    const c = Number(target.c);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { type: 'move', player: seatIndex, unitId: unitId, to: { r: r, c: c } };
  }
  if (type === 'attack') {
    const unitId = Number(action.unitId);
    const targetUnitId = Number(action.targetUnitId);
    if (!Number.isInteger(unitId) || !Number.isInteger(targetUnitId)) return null;
    return {
      type: 'attack', player: seatIndex,
      unitId: unitId, targetUnitId: targetUnitId
    };
  }
  return null;
}

// Spectator log entry. Unit types are already public on the board; hand
// indices, bag order, precomputed approaches and raw request fields are not.
function publicAction(action) {
  if (!action || typeof action !== 'object') return { type: 'move' };
  if (action.type === 'deploy') {
    return { type: 'deploy', unitType: action.unitType, r: action.r, c: action.c };
  }
  if (action.type === 'move') {
    return {
      type: 'move',
      unitType: action.unitType,
      unitId: action.unitId,
      to: action.to ? { r: action.to.r, c: action.to.c } : null
    };
  }
  if (action.type === 'attack') {
    return {
      type: 'attack',
      unitType: action.unitType,
      unitId: action.unitId,
      targetUnitId: action.targetUnitId
    };
  }
  if (action.type === 'end') return { type: 'end' };
  return { type: 'move' };
}

// Keep the shared room's `lastAction` free of unknown request fields.
function sanitizeInPlace(action, safe) {
  if (!action || typeof action !== 'object') return;
  try {
    Object.keys(action).forEach(function (key) { delete action[key]; });
    Object.assign(action, safe);
  } catch (err) { /* frozen input: view() still never emits it */ }
}

const adapter = {
  slug: SLUG,
  title: '战争宝箱 · 联机',
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
    if (currentSeatOf(state) !== seatIndex) return [];
    return E.legalActions(state, seatIndex).map(function (action) {
      if (action.type === 'deploy') {
        return { type: 'deploy', unitType: action.unitType, r: action.r, c: action.c };
      }
      if (action.type === 'move') {
        return {
          type: 'move', unitType: action.unitType, unitId: action.unitId,
          to: { r: action.to.r, c: action.to.c }
        };
      }
      if (action.type === 'attack') {
        return {
          type: 'attack', unitType: action.unitType, unitId: action.unitId,
          targetUnitId: action.targetUnitId
        };
      }
      return publicAction(action);
    });
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.over) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (!isSeat(seatIndex) || currentSeatOf(state) !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = normalizeAction(action, seatIndex);
    if (!move) return { ok: false, error: 'action payload required', code: 'E_ACTION' };
    try {
      const next = E.applyAction(state, move);
      match.state = next;
      sanitizeInPlace(action, publicAction(move));
      return { ok: true, over: !!next.over };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_ACTION' };
    }
  },

  // Pure decision; the caller applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.over || !isSeat(seatIndex)) return null;
    if (currentSeatOf(state) !== seatIndex) return null;
    let action;
    try { action = E.chooseAIAction(state, seatIndex); } catch (err) { return null; }
    return normalizeAction(action, seatIndex);
  },

  actingSeat(match) {
    return currentSeatOf(match && match.state);
  },

  isOver(match) {
    return !!(match && match.state && match.state.over);
  },

  result(match) {
    const state = match && match.state;
    if (!state) {
      return { winnerSeat: null, winnerName: null, tied: true, scores: [], rounds: 0, turns: 0 };
    }
    const raw = state.result || {};
    const winnerSeat = raw.winner == null ? null : raw.winner;
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null ? null : seatName(match, winnerSeat),
      tied: winnerSeat == null,
      reason: raw.reason || (state.over ? 'over' : ''),
      scores: [E.controlCount(state, 0), E.controlCount(state, 1)],
      rounds: state.turn,
      turns: state.turn,
      detail: {
        reason: raw.reason || '',
        control: [E.controlCount(state, 0), E.controlCount(state, 1)],
        units: [E.unitsOf(state, 0).length, E.unitsOf(state, 1).length],
        coins: [E.coinTotal(state.players[0]), E.coinTotal(state.players[1])]
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
    'hand', 'hands', 'handCards', 'bag', 'discard', 'deck', 'drawPile',
    'seed', 'rng', 'tickets', 'orders', 'lastAction'
  ],
  publicAction: publicAction
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch,
  currentSeatOf: currentSeatOf
};
