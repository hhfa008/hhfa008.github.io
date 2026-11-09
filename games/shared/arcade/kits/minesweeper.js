/* Arcade kit: 扫雷。state = { rows, cols, mines, revealed, flags, status, started } */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArcadeKit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function create(params) {
    var rows = (params && params.rows) || 9;
    var cols = (params && params.cols) || 9;
    var mineCount = Math.min((params && params.mines) || 10, rows * cols - 1);
    var N = rows * cols;

    function neighbors(index) {
      var r = Math.floor(index / cols), c = index % cols;
      var out = [];
      for (var dr = -1; dr <= 1; dr++) {
        for (var dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          var rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
        }
      }
      return out;
    }

    function blank() {
      return {
        rows: rows, cols: cols, mines: [], revealed: new Array(N).fill(false),
        flags: new Array(N).fill(false), status: 'playing', started: false,
      };
    }

    function placeMines(state, safeIndex, rng) {
      var forbidden = {};
      forbidden[safeIndex] = true;
      neighbors(safeIndex).forEach(function (i) { forbidden[i] = true; });
      var pool = [];
      for (var i = 0; i < N; i++) if (!forbidden[i]) pool.push(i);
      if (pool.length < mineCount) pool = [];
      for (var i = 0; i < N; i++) if (i !== safeIndex) pool.push(i);
      var mines = [];
      var taken = {};
      for (var k = 0; k < mineCount && pool.length; k++) {
        var at = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
        var idx = pool.splice(at, 1)[0];
        if (taken[idx]) continue;
        taken[idx] = true;
        mines.push(idx);
      }
      state.mines = mines;
      state.started = true;
      return state;
    }

    function adjacentMines(state, index) {
      var n = 0;
      neighbors(index).forEach(function (i) { if (state.mines.indexOf(i) >= 0) n++; });
      return n;
    }

    function reveal(state, index, rng) {
      if (state.status !== 'playing' || state.flags[index] || state.revealed[index]) {
        return { state: state, changed: false, gained: 0 };
      }
      if (!state.started) placeMines(state, index, rng);
      var next = {
        rows: state.rows, cols: state.cols, mines: state.mines.slice(),
        revealed: state.revealed.slice(), flags: state.flags.slice(),
        status: state.status, started: true,
      };
      if (next.mines.indexOf(index) >= 0) {
        next.revealed[index] = true;
        next.status = 'lost';
        return { state: next, changed: true, gained: 0 };
      }
      var stack = [index];
      while (stack.length) {
        var cur = stack.pop();
        if (next.revealed[cur] || next.flags[cur]) continue;
        next.revealed[cur] = true;
        if (adjacentMines(next, cur) === 0) {
          neighbors(cur).forEach(function (i) { if (!next.revealed[i]) stack.push(i); });
        }
      }
      var hidden = 0;
      for (var i = 0; i < N; i++) if (!next.revealed[i]) hidden++;
      if (hidden === next.mines.length) next.status = 'won';
      return { state: next, changed: true, gained: 0 };
    }

    function act(state, action, rng) {
      if (!action || typeof action !== 'object') return { state: state, changed: false, gained: 0 };
      if (action.type === 'flag') {
        var i = action.index;
        if (typeof i !== 'number' || i < 0 || i >= N || state.revealed[i]) {
          return { state: state, changed: false, gained: 0 };
        }
        var flags = state.flags.slice();
        flags[i] = !flags[i];
        return {
          state: {
            rows: state.rows, cols: state.cols, mines: state.mines.slice(),
            revealed: state.revealed.slice(), flags: flags,
            status: state.status, started: state.started,
          },
          changed: true, gained: 0,
        };
      }
      if (action.type === 'reveal') {
        return reveal(state, action.index, rng || action.rng || Math.random);
      }
      return { state: state, changed: false, gained: 0 };
    }

    function status(state) { return state.status; }

    return {
      newGame: function () { return blank(); },
      act: act,
      status: status,
      adjacent: adjacentMines,
      actions: function () { return ['reveal', 'flag']; },
    };
  }
  return { create: create };
});
