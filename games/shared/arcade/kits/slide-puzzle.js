/* Arcade kit: 数字华容道（n×n）。state = { tiles, blank, moves, won } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var n = (params && params.n) || 4;
    var N = n * n;
    function solved() {
      var t = [];
      for (var i = 1; i < N; i++) t.push(i);
      t.push(0);
      return t;
    }
    function isSolved(t) {
      for (var i = 0; i < N - 1; i++) if (t[i] !== i + 1) return false;
      return t[N - 1] === 0;
    }
    function neighbors(blank) {
      var r = Math.floor(blank / n), c = blank % n;
      var out = [];
      if (r > 0) out.push({ dir: 'up', at: blank - n });
      if (r < n - 1) out.push({ dir: 'down', at: blank + n });
      if (c > 0) out.push({ dir: 'left', at: blank - 1 });
      if (c < n - 1) out.push({ dir: 'right', at: blank + 1 });
      return out;
    }
    function slide(state, dir) {
      var nb = neighbors(state.blank).filter(function (x) { return x.dir === dir; })[0];
      if (!nb) return { state: state, changed: false, gained: 0 };
      var tiles = state.tiles.slice();
      tiles[state.blank] = tiles[nb.at];
      tiles[nb.at] = 0;
      var next = { tiles: tiles, blank: nb.at, moves: state.moves + 1, won: isSolved(tiles) };
      return { state: next, changed: true, gained: 0 };
    }
    function newGame(rng) {
      rng = rng || Math.random;
      var state = { tiles: solved(), blank: N - 1, moves: 0, won: false };
      var dirs = ['up', 'down', 'left', 'right'];
      for (var step = 0; step < N * 40; step++) {
        var movable = neighbors(state.blank);
        var pick = movable[Math.min(movable.length - 1, Math.floor(rng() * movable.length))];
        state = slide(state, pick.dir).state;
      }
      state.moves = 0;
      state.won = false;
      if (isSolved(state.tiles)) {
        state = slide(state, neighbors(state.blank)[0].dir).state;
        state.moves = 0;
      }
      return state;
    }
    function status(state) { return isSolved(state.tiles) ? 'won' : 'playing'; }
    return {
      newGame: newGame,
      act: function (state, dir) { return slide(state, dir); },
      status: status,
      actions: function () { return ['up', 'down', 'left', 'right']; },
    };
  }
  return { create: create };
});
