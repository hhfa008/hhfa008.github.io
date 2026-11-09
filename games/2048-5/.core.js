// __CORE_START__
var CORE = (function () {
  'use strict';
  function newGame(rng) {
    rng = rng || Math.random;
    var state = {
      board: null,
      score: 0,
      moves: 0,
      won: false,
      over: false,
    };
    state.board = new Array(25).fill(0);
    addRandomTile(state, rng);
    addRandomTile(state, rng);
    return state;
  }
  function act(state, action, rng) {
    rng = rng || Math.random;
    var next = JSON.parse(JSON.stringify(state));
    var changed = false;
    var gained = 0;
    var originalBoard = next.board.slice();
    var n = 5;
    var dirVectors = {
      'left': [0, -1],
      'right': [0, 1],
      'up': [-1, 0],
      'down': [1, 0]
    };
    var [dr, dc] = dirVectors[action];
    var rowRange, colRange;
    if (action === 'left' || action === 'right') {
      rowRange = [0, n];
      colRange = action === 'left' ? [1, n] : [0, n - 1];
    } else {
      rowRange = action === 'up' ? [1, n] : [0, n - 1];
      colRange = [0, n];
    }
    var rowStep = dr > 0 ? -1 : dr < 0 ? 1 : 0;
    var colStep = dc > 0 ? -1 : dc < 0 ? 1 : 0;
    var rows = [];
    for (var r = 0; r < n; r++) rows.push(r);
    if (rowStep === -1) rows.reverse();
    var cols = [];
    for (var c = 0; c < n; c++) cols.push(c);
    if (colStep === -1) cols.reverse();
    var moved = false;
    for (var r of rows) {
      for (var c of cols) {
        var index = r * n + c;
        if (next.board[index] !== 0) {
          var nr = r;
          var nc = c;
          while (true) {
            var nr2 = nr + dr;
            var nc2 = nc + dc;
            if (nr2 < 0 || nr2 >= n || nc2 < 0 || nc2 >= n) break;
            var index2 = nr2 * n + nc2;
            if (next.board[index2] === 0) {
              next.board[index2] = next.board[index];
              next.board[index] = 0;
              nr = nr2;
              nc = nc2;
              moved = true;
            } else if (next.board[index2] === next.board[index] && !next.board[index2].merged) {
              next.board[index2] *= 2;
              next.score += next.board[index2];
              next.board[index] = 0;
              next.board[index2].merged = true;
              moved = true;
              gained += next.board[index2];
            } else {
              break;
            }
          }
        }
      }
    }
    for (var i = 0; i < n * n; i++) {
      if (next.board[i] && next.board[i].merged) {
        delete next.board[i].merged;
      }
    }
    if (moved) {
      addRandomTile(next, rng);
      next.moves++;
    }
    next.changed = moved;
    next.gained = gained;
    return { state: next, changed: moved, gained: gained };
  }
  function status(state) {
    if (state.won) return 'won';
    if (state.over) return 'lost';
    return 'playing';
  }
  function addRandomTile(state, rng) {
    var emptyCells = [];
    for (var i = 0; i < 25; i++) {
      if (state.board[i] === 0) {
        emptyCells.push(i);
      }
    }
    if (emptyCells.length > 0) {
      var index = Math.floor(rng() * emptyCells.length);
      var cell = emptyCells[index];
      state.board[cell] = (rng() < 0.9) ? 2 : 4;
    } else {
      state.over = true;
    }
  }
  return { newGame: newGame, act: act, status: status };
})();
// __CORE_END__
