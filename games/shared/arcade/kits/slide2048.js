/* Arcade kit: 2048（参数 n = 边长）。
 * state = { board: number[n*n] 行优先, score, moves, won, over }
 * act(state, 'left'|'right'|'up'|'down', rng) -> { state, changed, gained }
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create(params) {
    params = params || {};
    var n = params.n || 4;
    var TARGET = params.target || 2048;

    function blank() { return new Array(n * n).fill(0); }

    function spawn(state, rng) {
      var empty = [];
      for (var i = 0; i < n * n; i++) if (state.board[i] === 0) empty.push(i);
      if (!empty.length) return state;
      var at = empty[Math.min(empty.length - 1, Math.floor(rng() * empty.length))];
      state.board[at] = rng() < 0.9 ? 2 : 4;
      return state;
    }

    function newGame(rng) {
      rng = rng || Math.random;
      var state = { board: blank(), score: 0, moves: 0, won: false, over: false };
      spawn(state, rng);
      spawn(state, rng);
      return state;
    }

    function rowOf(b, r) {
      var out = [];
      for (var c = 0; c < n; c++) out.push(b[r * n + c]);
      return out;
    }
    function putRow(b, r, row) {
      for (var c = 0; c < n; c++) b[r * n + c] = row[c];
    }
    function colOf(b, c) {
      var out = [];
      for (var r = 0; r < n; r++) out.push(b[r * n + c]);
      return out;
    }
    function putCol(b, c, col) {
      for (var r = 0; r < n; r++) b[r * n + c] = col[r];
    }

    // 把一行向左合并；返回 { row, gained, changed }
    function mergeLeft(row) {
      var src = row.filter(function (v) { return v !== 0; });
      var out = [];
      var gained = 0;
      var i = 0;
      while (i < src.length) {
        if (i + 1 < src.length && src[i] === src[i + 1]) {
          var v = src[i] * 2;
          out.push(v);
          gained += v;
          i += 2;
        } else {
          out.push(src[i]);
          i++;
        }
      }
      while (out.length < n) out.push(0);
      var changed = row.some(function (v, k) { return v !== out[k]; });
      return { row: out, gained: gained, changed: changed };
    }

    function act(state, dir, rng) {
      rng = rng || Math.random;
      var b = state.board.slice();
      var changed = false;
      var gained = 0;
      var lines = n;
      for (var i = 0; i < lines; i++) {
        var line;
        if (dir === 'left') line = rowOf(b, i);
        else if (dir === 'right') line = rowOf(b, i).reverse();
        else if (dir === 'up') line = colOf(b, i);
        else if (dir === 'down') line = colOf(b, i).reverse();
        else return { state: state, changed: false, gained: 0 };
        var res = mergeLeft(line);
        gained += res.gained;
        if (res.changed) changed = true;
        var out = res.row;
        if (dir === 'right' || dir === 'down') out = out.slice().reverse();
        if (dir === 'left' || dir === 'right') putRow(b, i, out);
        else putCol(b, i, out);
      }
      if (!changed) return { state: state, changed: false, gained: 0 };

      var next = {
        board: b,
        score: state.score + gained,
        moves: state.moves + 1,
        won: state.won || b.indexOf(TARGET) !== -1,
        over: false,
      };
      spawn(next, rng);
      next.over = !canMove(next);
      return { state: next, changed: true, gained: gained };
    }

    function canMove(state) {
      var b = state.board;
      for (var i = 0; i < n * n; i++) if (b[i] === 0) return true;
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var v = b[r * n + c];
          if (c + 1 < n && b[r * n + c + 1] === v) return true;
          if (r + 1 < n && b[(r + 1) * n + c] === v) return true;
        }
      }
      return false;
    }

    function status(state) {
      if (state.won) return 'won';
      if (state.over || !canMove(state)) return 'lost';
      return 'playing';
    }

    return {
      newGame: newGame,
      act: act,
      status: status,
      actions: function () { return ['left', 'right', 'up', 'down']; },
    };
  }

  return { create: create };
});
