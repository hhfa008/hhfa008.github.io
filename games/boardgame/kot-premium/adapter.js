/*
 * 东京妖都（Kot Premium）— pure game adapter.
 *
 * Shared by the Node online server (online-server.mjs) and the Cloudflare
 * Worker premium-room backend. Only maps the four Kot seats onto engine.js;
 * no rule and no room state machine lives here.
 */
'use strict';

const E = require('./engine.js');
const DATA = require('./data.js');

const SLUG = 'kot-premium';
const AI_NAMES = ['你', 'AI · 电脑 2', 'AI · 电脑 3', 'AI · 电脑 4'];
const SEATS = 4;

function seatName(match, index) {
  const seat = match && match.seats && match.seats[index];
  return (seat && seat.name) || AI_NAMES[index] || ('座位 ' + (index + 1));
}

function actingIndex(state) {
  if (!state) return -1;
  if (state.pending && state.pending.playerId) {
    return state.players.findIndex(function (player) { return player.id === state.pending.playerId; });
  }
  return state.current;
}

function playerPublic(player) {
  return {
    id: player.id,
    name: player.name,
    monsterId: player.monsterId,
    ai: !!player.ai,
    hp: player.hp,
    maxHp: player.maxHp,
    vp: player.vp,
    energy: player.energy,
    location: player.location,
    alive: !!player.alive,
    cards: (player.cards || []).slice(),
    tookClawDamage: !!player.tookClawDamage
  };
}

// Public projection: the deck order and rng cursor are replaced by counts so
// the draw and future rolls cannot be predicted from a client payload.
function publicState(state) {
  if (!state) return null;
  return {
    playerCount: state.playerCount,
    players: state.players.map(playerPublic),
    current: state.current,
    turn: state.turn,
    round: state.round,
    phase: state.phase,
    rollsLeft: state.rollsLeft,
    rollCount: state.rollCount,
    buyCountThisTurn: state.buyCountThisTurn,
    dice: state.dice.map(function (die) { return { face: die.face, locked: !!die.locked }; }),
    shop: state.shop.slice(),
    discard: state.discard.slice(),
    deckCount: state.deck.length,
    discardCount: state.discard.length,
    pending: state.pending
      ? {
        type: state.pending.type,
        player: state.pending.playerId,
        options: state.pending.options,
        forced: state.pending.forced,
        queue: state.pending.queue
      }
      : null,
    gameOver: !!state.gameOver,
    winner: state.winner,
    winnerName: state.winnerName,
    winReason: state.winReason,
    log: state.log.slice(-40).map(function (entry) {
      const out = Object.assign({}, entry);
      if (out.playerId !== undefined) { out.player = out.playerId; delete out.playerId; }
      return out;
    }),
    logSeq: state.logSeq || 0,
    stats: Object.assign({}, state.stats)
  };
}

function buildMatch(seed, seats) {
  const list = (seats || []).slice(0, SEATS);
  const count = Math.max(2, list.length || SEATS);
  const players = [];
  for (let i = 0; i < count; i += 1) {
    const seat = list[i];
    players.push({
      name: seatName({ seats: list }, i),
      monsterId: DATA.MONSTERS[i % DATA.MONSTERS.length].id,
      ai: seat ? Boolean(seat.ai) : true
    });
  }
  const state = E.createGame({ seed: seed, playerCount: count, players: players });
  return { state: state, seats: list, seed: seed, startedAt: Date.now() };
}

function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  const out = { type: action.type };
  if (action.index != null) out.index = Number(action.index);
  if (action.slot != null) out.slot = String(action.slot);
  if (action.cardId != null) out.cardId = String(action.cardId);
  if (action.leave != null) out.leave = !!action.leave;
  return out;
}

const adapter = {
  slug: SLUG,
  title: '东京妖都 · 联机',
  minPlayers: 2,
  maxPlayers: SEATS,
  defaultPlayers: SEATS,
  aiNames: AI_NAMES,

  seatCount() { return SEATS; },

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
        if (seat.ai != null) player.ai = Boolean(seat.ai);
      });
    }
    return view;
  },

  legalActions(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.gameOver || seatIndex == null) return [];
    if (actingIndex(state) !== seatIndex) return [];
    return E.getLegalMoves(state);
  },

  applyAction(match, seatIndex, action) {
    const state = match && match.state;
    if (!state) return { ok: false, error: 'no match', code: 'E_STATE' };
    if (state.gameOver) return { ok: false, error: 'match is already over', code: 'E_STATE' };
    if (seatIndex == null || actingIndex(state) !== seatIndex) {
      return { ok: false, error: 'not your turn', code: 'E_TURN' };
    }
    const move = normalizeAction(action);
    if (!move || !move.type) return { ok: false, error: 'action payload required', code: 'E_ACTION' };
    try {
      const next = E.applyMove(state, move);
      match.state = next;
      return { ok: true, over: !!next.gameOver };
    } catch (err) {
      return { ok: false, error: err.message || 'illegal action', code: 'E_ACTION' };
    }
  },

  // Pure decision; the caller applies it exactly once.
  aiAction(match, seatIndex) {
    const state = match && match.state;
    if (!state || state.gameOver || seatIndex == null) return null;
    if (actingIndex(state) !== seatIndex) return null;
    let move;
    try { move = E.selectAIMove(state); } catch (err) { return null; }
    if (!move) return null;
    return normalizeAction(move);
  },

  // Which seat must act now? Used by the generic AI tick.
  actingSeat(match) {
    const index = actingIndex(match && match.state);
    return index == null || index < 0 ? null : index;
  },

  isOver(match) {
    return !!(match && match.state && match.state.gameOver);
  },

  result(match) {
    const state = match && match.state;
    if (!state) {
      return { winnerSeat: null, winnerName: null, tied: true, scores: [], rounds: 0, turns: 0 };
    }
    let winnerSeat = null;
    if (state.winner != null) {
      const found = state.players.findIndex(function (player) { return player.id === state.winner; });
      winnerSeat = found < 0 ? null : found;
    }
    return {
      winnerSeat: winnerSeat,
      winnerName: winnerSeat == null ? null : seatName(match, winnerSeat),
      tied: winnerSeat == null,
      reason: state.winReason || (state.gameOver ? 'over' : ''),
      scores: state.players.map(function (player) { return player.vp; }),
      rounds: state.round,
      turns: state.turn,
      detail: {
        winnerId: state.winner,
        winnerName: state.winnerName,
        winReason: state.winReason,
        players: state.players.map(playerPublic)
      }
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
    const move = normalizeAction(action);
    if (!move || !move.type) return { type: 'move' };
    const out = { type: move.type };
    if (move.index != null) out.index = move.index;
    if (move.slot != null) out.slot = move.slot;
    if (move.cardId != null) out.cardId = move.cardId;
    if (move.leave != null) out.leave = move.leave;
    return out;
  }
};

module.exports = {
  adapter: adapter,
  publicState: publicState,
  buildMatch: buildMatch,
  actingIndex: actingIndex
};
