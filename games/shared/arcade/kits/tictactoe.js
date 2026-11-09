/* Arcade kit: 井字棋 / n 连棋。state = { n, board, turn, status } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    params = params || {};
    var n = params.n || 3;
    var ai = params.ai !== false;
    var N = n * n;

    function winner(board) {
      // 行 / 列 / 两条对角线
      var r, c;
      for (r = 0; r < n; r++) {
        var v = board[r * n];
        if (!v) continue;
        var ok = true;
        for (c = 1; c < n; c++) if (board[r * n + c] !== v) { ok = false; break; }
        if (ok) return v;
      }
      for (c = 0; c < n; c++) {
        var v2 = board[c];
        if (!v2) continue;
        var ok2 = true;
        for (r = 1; r < n; r++) if (board[r * n + c] !== v2) { ok2 = false; break; }
        if (ok2) return v2;
      }
      var d1 = board[0], okd1 = !!d1;
      for (var i = 1; i < n; i++) if (board[i * n + i] !== d1) okd1 = false;
      if (okd1) return d1;
      var d2 = board[n - 1], okd2 = !!d2;
      for (var j = 1; j < n; j++) if (board[j * n + (n - 1 - j)] !== d2) okd2 = false;
      if (okd2) return d2;
      return 0;
    }

    function full(board) {
      for (var i = 0; i < N; i++) if (board[i] === 0) return false;
      return true;
    }

    function aiMove(board, rng) {
      var tryWin = function (p) {
        for (var i = 0; i < N; i++) {
          if (board[i] !== 0) continue;
          board[i] = p;
          var w = winner(board);
          board[i] = 0;
          if (w === p) return i;
        }
        return -1;
      };
      var i = tryWin(2);
      if (i >= 0) return i;
      i = tryWin(1);
      if (i >= 0) return i;
      var empty = [];
      for (var k = 0; k < N; k++) if (board[k] === 0) empty.push(k);
      if (!empty.length) return -1;
      return empty[Math.min(empty.length - 1, Math.floor(rng() * empty.length))];
    }

    function newGame() {
      return { n: n, board: new Array(N).fill(0), turn: 1, status: 'playing' };
    }

    function act(state, index, rng) {
      rng = rng || Math.random;
      if (state.status !== 'playing' || typeof index !== 'number' || index < 0 || index >= N || state.board[index] !== 0) {
        return { state: state, changed: false, gained: 0 };
      }
      var board = state.board.slice();
      board[index] = 1;
      var status = 'playing';
      if (winner(board) === 1) status = 'won';
      else if (full(board)) status = 'draw';
      else if (ai) {
        var m = aiMove(board, rng);
        if (m >= 0) {
          board[m] = 2;
          if (winner(board) === 2) status = 'lost';
          else if (full(board)) status = 'draw';
        }
      }
      if (!ai) {
        // 双人：换手
        return {
          state: { n: n, board: board, turn: status === 'playing' ? 2 : 1, status: status },
          changed: true, gained: 0,
        };
      }
      return { state: { n: n, board: board, turn: 1, status: status }, changed: true, gained: 0 };
    }

    function status(state) { return state.status; }

    return {
      newGame: newGame,
      act: act,
      status: status,
      winner: winner,
      actions: function () { return ['0..' + (N - 1)]; },
    };
  }
  return { create: create };
});
