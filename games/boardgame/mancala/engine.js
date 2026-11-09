/*
 * Mancala (Kalah) rules engine.
 *
 * Pure logic: no DOM and no network. The same file is loaded by index.html
 * and can be required from Node:
 *
 *   var E = require('./engine.js');
 *   var state = E.setup();
 *   var next = E.applyMove(state, 2);
 *
 * Board layout (indices are global):
 *   player 0 (human, bottom): pits 0..5, left to right
 *   player 1 (AI, top):      pits 6..11, left to right
 *
 * Sowing follows one counter-clockwise cycle:
 *   0 1 2 3 4 5 [store 0] 11 10 9 8 7 6 [store 1]
 * so player 0 sows to the right, player 1 sows to the left, and each player
 * skips the opponent's store. A pit's opposite is pit + 6 for 0..5 and
 * pit - 6 for 6..11.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MancalaEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PITS = 6;
  var PIT_COUNT = PITS * 2;
  var STONES_PER_PIT = 4;
  var STORE_0 = 100;
  var STORE_1 = 101;
  var CYCLE = [0, 1, 2, 3, 4, 5, STORE_0, 11, 10, 9, 8, 7, 6, STORE_1];
  var SLOT_INDEX = {};
  var DEFAULT_DEPTH = 5;
  var MAX_DEPTH = 6;
  var DEFAULT_MAX_NODES = 60000;
  var MAX_MAX_NODES = 400000;
  var WIN_SCORE = 1000000000;
  var INF = Infinity;

  CYCLE.forEach(function (slot, index) { SLOT_INDEX[slot] = index; });

  function mulberry32(seed) {
    var a;
    if (typeof seed === 'number' && isFinite(seed)) {
      a = seed >>> 0;
    } else if (typeof seed === 'string') {
      a = 2166136261;
      for (var i = 0; i < seed.length; i++) {
        a ^= seed.charCodeAt(i);
        a = Math.imul(a, 16777619);
      }
      a >>>= 0;
    } else {
      a = Date.now() >>> 0;
    }
    return function () {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function isPlayer(value) {
    return value === 0 || value === 1;
  }

  function isPit(value) {
    return typeof value === 'number' && isFinite(value) &&
      Math.floor(value) === value && value >= 0 && value < PIT_COUNT;
  }

  function playerOfPit(pit) {
    return isPit(pit) ? (pit < PITS ? 0 : 1) : null;
  }

  function oppositePit(pit) {
    if (!isPit(pit)) return null;
    return pit < PITS ? pit + PITS : pit - PITS;
  }

  function rowSeeds(pits, player) {
    if (!Array.isArray(pits) || !isPlayer(player)) return 0;
    var start = player * PITS;
    var total = 0;
    for (var i = start; i < start + PITS; i++) total += pits[i] || 0;
    return total;
  }

  function totalSeeds(state) {
    if (!state || !Array.isArray(state.pits) || !Array.isArray(state.stores)) return 0;
    return rowSeeds(state.pits, 0) + rowSeeds(state.pits, 1) +
      (state.stores[0] || 0) + (state.stores[1] || 0);
  }

  function setup() {
    var pits = [];
    for (var i = 0; i < PIT_COUNT; i++) pits.push(STONES_PER_PIT);
    return {
      pits: pits,
      stores: [0, 0],
      turn: 0,
      over: false,
      winner: null,
      draw: false,
      moves: 0,
      lastMove: null
    };
  }

  function cloneState(state) {
    return {
      pits: state.pits.slice(),
      stores: state.stores.slice(),
      turn: state.turn,
      over: !!state.over,
      winner: state.winner == null ? null : state.winner,
      draw: !!state.draw,
      moves: state.moves || 0,
      lastMove: state.lastMove ? Object.assign({}, state.lastMove) : null
    };
  }

  function isTerminal(state) {
    if (!state || !Array.isArray(state.pits)) return true;
    if (state.over) return true;
    return rowSeeds(state.pits, 0) === 0 || rowSeeds(state.pits, 1) === 0;
  }

  /*
   * Return the stores as they would look after end-of-game collection.
   * This does not mutate the state. It also makes status()/winner() safe on
   * hand-built states that have a row empty but have not been settled yet.
   */
  function finalScores(state) {
    if (!state || !Array.isArray(state.pits) || !Array.isArray(state.stores)) return [0, 0];
    var scores = [state.stores[0] || 0, state.stores[1] || 0];
    var zero = rowSeeds(state.pits, 0);
    var one = rowSeeds(state.pits, 1);
    if (zero === 0 && one > 0) scores[1] += one;
    else if (one === 0 && zero > 0) scores[0] += zero;
    return scores;
  }

  function scores(state) {
    if (!state || !Array.isArray(state.stores)) return [0, 0];
    return isTerminal(state) ? finalScores(state) : state.stores.slice();
  }

  function winner(state) {
    if (!isTerminal(state)) return null;
    var sc = finalScores(state);
    if (sc[0] === sc[1]) return null;
    return sc[0] > sc[1] ? 0 : 1;
  }

  function status(state) {
    var over = isTerminal(state);
    var sc = over ? finalScores(state) : (state.stores || [0, 0]).slice();
    var draw = over && sc[0] === sc[1];
    return {
      over: over,
      turn: state ? state.turn : null,
      scores: sc,
      draw: draw,
      winner: over && !draw ? (sc[0] > sc[1] ? 0 : 1) : null
    };
  }

  function legalMoves(state) {
    if (!state || !Array.isArray(state.pits) || state.over) return [];
    if (!isPlayer(state.turn)) return [];
    if (rowSeeds(state.pits, 0) === 0 || rowSeeds(state.pits, 1) === 0) return [];
    var start = state.turn * PITS;
    var moves = [];
    for (var i = start; i < start + PITS; i++) {
      if (state.pits[i] > 0) moves.push(i);
    }
    return moves;
  }

  /*
   * Every move starts with a fresh copy. The original state, including its
   * pits, stores and lastMove, is never modified.
   */
  function applyMove(state, pit) {
    if (!state || !Array.isArray(state.pits) || !Array.isArray(state.stores)) return false;
    if (!isPlayer(state.turn) || state.over) return false;
    if (!isPit(pit)) return false;
    if (pit < state.turn * PITS || pit >= (state.turn + 1) * PITS) return false;
    if (isTerminal(state)) return false;
    var seedCount = state.pits[pit];
    if (!(seedCount > 0)) return false;

    var pits = state.pits.slice();
    var stores = state.stores.slice();
    var player = state.turn;
    var ownStore = player === 0 ? STORE_0 : STORE_1;
    var otherStore = player === 0 ? STORE_1 : STORE_0;
    var hand = seedCount;
    var slotIndex = SLOT_INDEX[pit];
    var lastToken = null;
    var lastWasEmpty = false;

    pits[pit] = 0;

    while (hand > 0) {
      slotIndex = (slotIndex + 1) % CYCLE.length;
      var token = CYCLE[slotIndex];
      if (token === otherStore) continue;

      lastToken = token;
      if (token === ownStore) {
        stores[player] += 1;
      } else {
        lastWasEmpty = pits[token] === 0;
        pits[token] += 1;
      }
      hand -= 1;
    }

    var extraTurn = lastToken === ownStore;
    var captured = 0;
    var capturedPit = null;

    if (!extraTurn && isPit(lastToken) && playerOfPit(lastToken) === player &&
        lastWasEmpty) {
      var opposite = oppositePit(lastToken);
      if (opposite != null && pits[opposite] > 0) {
        captured = pits[opposite] + 1;
        capturedPit = opposite;
        stores[player] += captured;
        pits[lastToken] = 0;
        pits[opposite] = 0;
      }
    }

    var next = {
      pits: pits,
      stores: stores,
      turn: extraTurn ? player : 1 - player,
      over: false,
      winner: null,
      draw: false,
      moves: (state.moves || 0) + 1,
      lastMove: {
        pit: pit,
        player: player,
        seeds: seedCount,
        landed: isPit(lastToken) ? lastToken : 'store',
        extraTurn: extraTurn,
        capture: captured,
        capturedPit: capturedPit,
        collected: 0,
        collectedTo: null
      }
    };

    var zero = rowSeeds(pits, 0);
    var one = rowSeeds(pits, 1);
    var collected = 0;
    var collectedTo = null;

    if (zero === 0 || one === 0) {
      next.over = true;
      if (zero === 0 && one > 0) {
        collected = one;
        collectedTo = 1;
        next.stores[1] += one;
        for (var i = PITS; i < PIT_COUNT; i++) pits[i] = 0;
      } else if (one === 0 && zero > 0) {
        collected = zero;
        collectedTo = 0;
        next.stores[0] += zero;
        for (var j = 0; j < PITS; j++) pits[j] = 0;
      }
      next.lastMove.collected = collected;
      next.lastMove.collectedTo = collectedTo;
      if (next.stores[0] === next.stores[1]) {
        next.winner = null;
        next.draw = true;
      } else {
        next.winner = next.stores[0] > next.stores[1] ? 0 : 1;
        next.draw = false;
      }
    }

    return next;
  }

  function evaluate(state, player) {
    var other = 1 - player;
    var storeDiff = (state.stores[player] || 0) - (state.stores[other] || 0);
    var rowDiff = rowSeeds(state.pits, player) - rowSeeds(state.pits, other);
    return storeDiff * 100 + rowDiff * 3;
  }

  function terminalValue(state, player) {
    var sc = finalScores(state);
    if (sc[0] === sc[1]) return 0;
    var winningPlayer = sc[0] > sc[1] ? 0 : 1;
    var margin = Math.abs(sc[0] - sc[1]);
    return (winningPlayer === player ? 1 : -1) * (WIN_SCORE + margin * 1000);
  }

  /*
   * Negamax with alpha-beta pruning. A node's value is from the perspective
   * of state.turn. If a move grants another turn, the sign is not flipped;
   * otherwise the child value is negated. Depth and node caps are the
   * performance guards.
   */
  function search(state, depth, alpha, beta, ctx) {
    ctx.nodes += 1;
    if (ctx.nodes > ctx.maxNodes) return evaluate(state, state.turn);
    if (isTerminal(state)) return terminalValue(state, state.turn);
    if (depth <= 0) return evaluate(state, state.turn);

    var player = state.turn;
    var moves = legalMoves(state);
    if (!moves.length) return terminalValue(state, player);

    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var child = applyMove(state, moves[i]);
      if (!child) continue;
      var value;
      if (child.over) {
        value = terminalValue(child, player);
      } else if (child.turn === player) {
        value = search(child, depth - 1, alpha, beta, ctx);
      } else {
        value = -search(child, depth - 1, -beta, -alpha, ctx);
      }
      if (value > best) best = value;
      if (value > alpha) alpha = value;
      if (alpha >= beta) break;
    }
    return best === -INF ? evaluate(state, player) : best;
  }

  function aiMove(state, options) {
    options = options || {};
    var moves = legalMoves(state);
    if (!moves.length) return null;

    var requestedDepth = options.depth == null ? DEFAULT_DEPTH : Math.floor(options.depth);
    if (!isFinite(requestedDepth)) requestedDepth = DEFAULT_DEPTH;
    var depth = Math.max(1, Math.min(MAX_DEPTH, requestedDepth));

    var requestedNodes = options.maxNodes == null ? DEFAULT_MAX_NODES : Math.floor(options.maxNodes);
    if (!isFinite(requestedNodes)) requestedNodes = DEFAULT_MAX_NODES;
    var maxNodes = Math.max(1000, Math.min(MAX_MAX_NODES, requestedNodes));

    var seed = options.seed == null ? Date.now() : options.seed;
    var rng = mulberry32(seed);
    var ctx = { nodes: 0, maxNodes: maxNodes };
    var player = state.turn;
    var alpha = -INF;
    var beta = INF;
    var bestScore = -INF;
    var bestMoves = [];

    for (var i = 0; i < moves.length; i++) {
      var child = applyMove(state, moves[i]);
      if (!child) continue;
      var value;
      if (child.over) {
        value = terminalValue(child, player);
      } else if (child.turn === player) {
        value = search(child, depth - 1, alpha, beta, ctx);
      } else {
        value = -search(child, depth - 1, -beta, -alpha, ctx);
      }

      if (value > bestScore) {
        bestScore = value;
        bestMoves = [moves[i]];
        if (value > alpha) alpha = value;
      } else if (value === bestScore) {
        bestMoves.push(moves[i]);
      }
    }

    if (!bestMoves.length) return moves[0];
    if (bestMoves.length === 1) return bestMoves[0];
    return bestMoves[Math.floor(rng() * bestMoves.length)];
  }

  return {
    PITS: PITS,
    PIT_COUNT: PIT_COUNT,
    STONES_PER_PIT: STONES_PER_PIT,
    DEFAULT_DEPTH: DEFAULT_DEPTH,
    MAX_DEPTH: MAX_DEPTH,
    setup: setup,
    legalMoves: legalMoves,
    applyMove: applyMove,
    aiMove: aiMove,
    isTerminal: isTerminal,
    status: status,
    winner: winner,
    scores: scores,
    rowSeeds: rowSeeds,
    totalSeeds: totalSeeds,
    oppositePit: oppositePit,
    playerOfPit: playerOfPit,
    mulberry32: mulberry32
  };
});
