/* Reversi adapter — rules implemented here.
 *
 * games/reversi/index.html has a testable core (__TEST_CORE_START__ ..
 * __TEST_CORE_END__) but it is not a shared module and the page exports it in a
 * browser-only shape. The adapter re-implements the same four primitives
 * (flipsAt / legalFor / apply / count) in about 40 lines so that it can be
 * required from node and loaded before the page without reading index.html.
 *
 * State is a flat 8x8 Array: 0 empty, 1 black (p1), 2 white (p2).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../shared/agent-api.js'));
  } else {
    factory(root.GameAgent);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GA) {
  'use strict';

  var S = 8, NN = S * S;
  var EMPTY = 0, BLACK = 1, WHITE = 2;
  var DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function inBoard(r, c) { return r >= 0 && r < S && c >= 0 && c < S; }

  function flipsAt(board, i, p) {
    if (i < 0 || i >= NN || board[i] !== EMPTY) return null;
    var r = (i / S) | 0, c = i % S, q = 3 - p, all = [];
    for (var d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      var rr = r + dr, cc = c + dc, line = [];
      while (inBoard(rr, cc) && board[rr * S + cc] === q) {
        line.push(rr * S + cc);
        rr += dr; cc += dc;
      }
      if (line.length && inBoard(rr, cc) && board[rr * S + cc] === p) {
        for (var k = 0; k < line.length; k++) all.push(line[k]);
      }
    }
    return all.length ? all : null;
  }

  function legalMoves(board, p) {
    var out = [];
    for (var i = 0; i < NN; i++) if (flipsAt(board, i, p)) out.push(i);
    return out;
  }

  function count(board, p) {
    var n = 0;
    for (var i = 0; i < NN; i++) if (board[i] === p) n++;
    return n;
  }

  function initialBoard() {
    var b = [];
    for (var i = 0; i < NN; i++) b.push(EMPTY);
    b[3 * S + 3] = WHITE;
    b[3 * S + 4] = BLACK;
    b[4 * S + 3] = BLACK;
    b[4 * S + 4] = WHITE;
    return b;
  }

  function parseMove(id) {
    if (typeof id !== 'string' || id.indexOf('move:') !== 0) return -1;
    var raw = id.slice(5);
    if (!/^\d+$/.test(raw)) return -1;
    var idx = Number(raw);
    return idx >= 0 && idx < NN ? idx : -1;
  }

  function makeSession(seed) {
    var st = {
      board: initialBoard(),
      turn: BLACK,
      passes: 0,
      moves: 0,
      last: -1,
      over: false,
      winner: null,
      seed: seed === undefined ? 1 : seed
    };

    function finish() {
      var b = count(st.board, BLACK), w = count(st.board, WHITE);
      st.over = true;
      st.winner = b > w ? 'p1' : (w > b ? 'p2' : 'draw');
    }

    // Both sides stuck -> the game is over. Otherwise the side with no move
    // simply receives a single 'pass' action from legalActions().
    function settle() {
      if (legalMoves(st.board, st.turn).length) return;
      if (legalMoves(st.board, 3 - st.turn).length) return;
      finish();
    }

    return {
      slug: 'reversi',
      version: '1.0.0',
      seats: ['p1', 'p2'],

      state: function () { return GA.cloneJSON(st); },

      legalActions: function () {
        if (st.over) return [];
        var moves = legalMoves(st.board, st.turn);
        if (!moves.length) {
          return [{
            id: 'pass',
            type: 'pass',
            payload: { player: st.turn === BLACK ? 'p1' : 'p2' },
            desc: 'pass (no legal move)'
          }];
        }
        var out = [];
        for (var k = 0; k < moves.length; k++) {
          var i = moves[k];
          out.push({
            id: 'move:' + i,
            type: 'move',
            payload: { index: i, row: (i / S) | 0, col: i % S },
            desc: 'place at (' + ((i / S) | 0) + ',' + (i % S) + ')'
          });
        }
        return out;
      },

      apply: function (id) {
        if (st.over) return { ok: false, error: 'game_over' };

        if (id === 'pass') {
          if (legalMoves(st.board, st.turn).length) return { ok: false, error: 'illegal_action' };
          st.turn = 3 - st.turn;
          st.passes += 1;
          st.last = -1;
          settle();
          return { ok: true, state: GA.cloneJSON(st) };
        }

        var idx = parseMove(id);
        if (idx < 0) return { ok: false, error: 'illegal_action' };
        var flips = flipsAt(st.board, idx, st.turn);
        if (!flips) return { ok: false, error: 'illegal_action' };

        var board = st.board.slice();
        board[idx] = st.turn;
        for (var k = 0; k < flips.length; k++) board[flips[k]] = st.turn;
        st.board = board;
        st.moves += 1;
        st.last = idx;
        st.turn = 3 - st.turn;
        settle();
        return { ok: true, state: GA.cloneJSON(st) };
      },

      status: function () {
        return { phase: st.over ? 'over' : 'playing', winner: st.winner };
      },

      player: function () { return st.turn === BLACK ? 'p1' : 'p2'; },

      hash: function () { return GA.hashState(st); }
    };
  }

  function create(opts) {
    opts = opts || {};
    return makeSession(opts.seed);
  }

  create.players = 2;
  create.moves = 'move';
  create.source = 'self-contained (mirrors __TEST_CORE of games/reversi/index.html)';
  if (GA) GA.register('reversi', create);

  return { create: create };
});
