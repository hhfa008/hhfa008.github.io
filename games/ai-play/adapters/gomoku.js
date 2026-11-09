/* Gomoku adapter — reuses games/shared/rules.js (GameRules.gomoku).
 *
 * The page keeps its board as a flat 15x15 Int8Array; the adapter keeps the
 * same layout as a plain Array so state() is JSON. Win detection is delegated
 * to GameRules.gomoku.checkWinAt / lineAt, i.e. the exact code the page runs.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../shared/agent-api.js'), require('../../shared/rules.js'));
  } else {
    factory(root.GameAgent, root.GameRules);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (GA, Rules) {
  'use strict';

  var G = Rules && Rules.gomoku;
  var N = G ? G.N : 15;
  var BLACK = 1, WHITE = 2;

  function initialState() {
    var board = [];
    for (var i = 0; i < N * N; i++) board.push(0);
    return { board: board, turn: BLACK, moves: 0, winner: null, line: null, last: -1 };
  }

  function parseIndex(id) {
    if (typeof id !== 'string' || id.indexOf('place:') !== 0) return -1;
    var raw = id.slice(6);
    if (!/^\d+$/.test(raw)) return -1;
    var idx = Number(raw);
    return idx >= 0 && idx < N * N ? idx : -1;
  }

  function makeSession(seed) {
    var st = initialState();
    st.seed = seed === undefined ? 1 : seed;

    return {
      slug: 'gomoku',
      version: '1.0.0',
      seats: ['p1', 'p2'],

      state: function () { return GA.cloneJSON(st); },

      legalActions: function () {
        if (st.winner) return [];
        var out = [];
        for (var i = 0; i < N * N; i++) {
          if (st.board[i] !== 0) continue;
          out.push({
            id: 'place:' + i,
            type: 'place',
            payload: { index: i, row: (i / N) | 0, col: i % N },
            desc: 'place a stone at (' + ((i / N) | 0) + ',' + (i % N) + ')'
          });
        }
        return out;
      },

      apply: function (id) {
        if (st.winner) return { ok: false, error: 'game_over' };
        var idx = parseIndex(id);
        if (idx < 0 || st.board[idx] !== 0) return { ok: false, error: 'illegal_action' };

        var p = st.turn;
        var r = (idx / N) | 0, c = idx % N;
        var board = st.board.slice();
        board[idx] = p;
        var won = G.checkWinAt(board, r, c, p);
        var moves = st.moves + 1;

        st.board = board;
        st.moves = moves;
        st.last = idx;
        st.line = won ? G.lineAt(board, r, c, p) : null;
        st.winner = won ? (p === BLACK ? 'p1' : 'p2') : (moves >= N * N ? 'draw' : null);
        st.turn = 3 - p;
        return { ok: true, state: GA.cloneJSON(st) };
      },

      status: function () {
        return { phase: st.winner ? 'over' : 'playing', winner: st.winner };
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
  create.moves = 'place';
  create.source = 'games/shared/rules.js (GameRules.gomoku)';
  if (GA) GA.register('gomoku', create);

  return { create: create };
});
