/*
 * Snakes and Ladders (蛇梯棋) — pure rules engine.
 *
 * No DOM, no timers, no network. The browser attaches the same factory to
 * globalThis.SnakesEngine; Node can require this file directly.
 *
 * Rules implemented:
 *   - 10x10 board, numbered 1 (start) to 100 (finish).
 *   - Two players alternate a single d6 roll.
 *   - Landing on a ladder foot climbs to its top; landing on a snake head
 *     slides down to its tail. Links resolve exactly once.
 *   - A roll that would pass 100 leaves the token where it was; a player
 *     must land exactly on 100 to win.
 *   - First token to reach 100 wins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakesEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 100;

  // All links are fixed, one-hop, and use both endpoints strictly inside 2..99.
  // Every ladder climbs; every snake descends.
  var LADDERS = Object.freeze({
    2: 23,
    8: 34,
    20: 41,
    32: 57,
    51: 67,
    71: 92,
    80: 99
  });

  var SNAKES = Object.freeze({
    17: 7,
    25: 4,
    36: 6,
    49: 11,
    66: 45,
    84: 58,
    98: 40
  });

  function isInteger(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  }

  function isValidDice(value) {
    return isInteger(value) && value >= 1 && value <= 6;
  }

  function isValidPosition(value) {
    return isInteger(value) && value >= 1 && value <= BOARD_SIZE;
  }

  // Small, fast, seedable PRNG. Every random value in this module comes from
  // a function created here (or from a caller-supplied PRNG of the same shape).
  function mulberry32(seed) {
    var a = (Number(seed) || 0) >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function defaultSeed() {
    return Date.now() >>> 0;
  }

  function setup(seed) {
    var actual = seed;
    if (actual === undefined || actual === null) actual = defaultSeed();
    if (typeof actual !== 'number' || !isFinite(actual)) actual = defaultSeed();
    return {
      seed: actual >>> 0,
      positions: [1, 1],
      turn: 1,
      winner: 0,
      rolls: 0,
      last: null,
      history: []
    };
  }

  function cloneState(state) {
    return {
      seed: state.seed,
      positions: state.positions.slice(),
      turn: state.turn,
      winner: state.winner,
      rolls: state.rolls,
      last: state.last ? Object.assign({}, state.last) : null,
      history: state.history.map(function (entry) { return Object.assign({}, entry); })
    };
  }

  function rollDice(rng) {
    var random = rng;
    if (typeof random !== 'function') random = mulberry32(defaultSeed());
    var value;
    try {
      value = Number(random());
    } catch (err) {
      return false;
    }
    if (!isFinite(value) || value < 0 || value >= 1) {
      value = ((value % 1) + 1) % 1;
      if (!isFinite(value)) return false;
    }
    return Math.floor(value * 6) + 1;
  }

  function linkAt(position) {
    if (Object.prototype.hasOwnProperty.call(LADDERS, position)) {
      return { type: 'ladder', from: position, to: LADDERS[position] };
    }
    if (Object.prototype.hasOwnProperty.call(SNAKES, position)) {
      return { type: 'snake', from: position, to: SNAKES[position] };
    }
    return null;
  }

  /*
   * Resolve a move and return the final square number.
   * Overshooting 100 is not allowed: the token stays put.
   * A ladder/snake is applied once, based on the landing square.
   */
  function moveFrom(pos, steps) {
    if (!isValidPosition(pos) || !isValidDice(steps)) return false;
    if (pos === BOARD_SIZE) return BOARD_SIZE;
    var landed = pos + steps;
    if (landed > BOARD_SIZE) return pos;
    var link = linkAt(landed);
    return link ? link.to : landed;
  }

  function hasValidShape(state) {
    return !!state &&
      Array.isArray(state.positions) &&
      state.positions.length === 2 &&
      isValidPosition(state.positions[0]) &&
      isValidPosition(state.positions[1]) &&
      (state.turn === 1 || state.turn === 2) &&
      Array.isArray(state.history) &&
      isInteger(state.rolls) && state.rolls >= 0;
  }

  function currentWinner(state) {
    if (!state || !Array.isArray(state.positions)) return 0;
    if (state.positions[0] === BOARD_SIZE) return 1;
    if (state.positions[1] === BOARD_SIZE) return 2;
    if (state.winner === 1 || state.winner === 2) return state.winner;
    return 0;
  }

  /*
   * Apply one already-rolled die. Invalid dice, malformed state, or a game
   * that is already over return false and never throw.
   * Returns a fresh state; the input state is not modified.
   */
  function applyRoll(state, dice) {
    if (!hasValidShape(state)) return false;
    if (!isValidDice(dice)) return false;
    if (currentWinner(state)) return false;

    var player = state.turn;
    var from = state.positions[player - 1];
    var raw = from + dice;
    var overshoot = raw > BOARD_SIZE;
    var landed = overshoot ? from : raw;
    var link = overshoot ? null : linkAt(landed);
    var to = link ? link.to : landed;
    var won = to === BOARD_SIZE;

    var record = {
      n: state.rolls + 1,
      player: player,
      dice: dice,
      from: from,
      landed: landed,
      to: to,
      overshoot: overshoot,
      transit: link ? link.type : null,
      transitFrom: link ? link.from : null,
      transitTo: link ? link.to : null,
      win: won
    };

    var next = cloneState(state);
    next.positions[player - 1] = to;
    next.turn = won ? player : (player === 1 ? 2 : 1);
    next.winner = won ? player : 0;
    next.rolls = state.rolls + 1;
    next.last = Object.assign({}, record);
    next.history.push(record);
    return next;
  }

  /*
   * The AI always takes a legal turn for the player whose turn it is.
   * Tests inject a seeded PRNG; the UI also passes one in. Without a supplied
   * PRNG, a per-turn mulberry32 stream is derived from the state seed and the
   * accumulated roll count, so callers still get deterministic no-argument AI.
   */
  function aiRoll(state, rng) {
    if (!hasValidShape(state) || currentWinner(state)) return false;
    var random = rng;
    if (typeof random !== 'function') {
      var derived = (state.seed ^ Math.imul(state.rolls + 1, 0x9E3779B1)) >>> 0;
      random = mulberry32(derived);
    }
    var dice = rollDice(random);
    if (!isValidDice(dice)) return false;
    return applyRoll(state, dice);
  }

  function winner(state) {
    return currentWinner(state);
  }

  function status(state) {
    if (!hasValidShape(state)) return false;
    var champ = currentWinner(state);
    return {
      over: champ !== 0,
      winner: champ,
      turn: state.turn,
      currentPlayer: champ ? 0 : state.turn,
      positions: state.positions.slice(),
      rolls: state.rolls,
      last: state.last ? Object.assign({}, state.last) : null
    };
  }

  return {
    BOARD_SIZE: BOARD_SIZE,
    LADDERS: LADDERS,
    SNAKES: SNAKES,
    setup: setup,
    mulberry32: mulberry32,
    rollDice: rollDice,
    applyRoll: applyRoll,
    moveFrom: moveFrom,
    aiRoll: aiRoll,
    status: status,
    winner: winner,
    linkAt: linkAt,
    isValidDice: isValidDice,
    isValidPosition: isValidPosition
  };
});
