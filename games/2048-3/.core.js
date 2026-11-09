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
    var n = 3;
    var size = n * n;
    state.board = new Array(size).fill(0);
    // Place two initial tiles
    placeTile(state, rng);
    placeTile(state, rng);
    return state;
  }
  
  function placeTile(state, rng) {
    var n = 3;
    var size = n * n;
    var emptyCells = [];
    for (var i = 0; i < size; i++) {
      if (state.board[i] === 0) {
        emptyCells.push(i);
      }
    }
    if (emptyCells.length > 0) {
      var index = emptyCells[Math.floor(rng() * emptyCells.length)];
      state.board[index] = (rng() < 0.9) ? 2 : 4;
    }
  }
  
  function act(state, action, rng) {
    rng = rng || Math.random;
    var next = JSON.parse(JSON.stringify(state));
    var changed = false;
    var gained = 0;
    var n = 3;
    var size = n * n;
    
    // Helper to get index
    function idx(r, c) { return r * n + c; }
    
    // Helper to get row and col
    function rc(i) { return [Math.floor(i / n), i % n]; }
    
    // Helper to transpose board
    function transpose(board) {
      var newBoard = new Array(size).fill(0);
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          newBoard[idx(c, r)] = board[idx(r, c)];
        }
      }
      return newBoard;
    }
    
    // Helper to reverse board
    function reverse(board) {
      var newBoard = new Array(size).fill(0);
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          newBoard[idx(r, n - 1 - c)] = board[idx(r, c)];
        }
      }
      return newBoard;
    }
    
    // Helper to move a row
    function moveRow(row) {
      var newRow = row.filter(x => x !== 0);
      var merged = [];
      var scoreGained = 0;
      for (var i = 0; i < newRow.length; i++) {
        if (i < newRow.length - 1 && newRow[i] === newRow[i + 1]) {
          var mergedValue = newRow[i] * 2;
          merged.push(mergedValue);
          scoreGained += mergedValue;
          i++; // Skip next
        } else {
          merged.push(newRow[i]);
        }
      }
      while (merged.length < n) merged.push(0);
      return { row: merged, score: scoreGained };
    }
    
    // Apply action
    var board = next.board.slice();
    var original = board.slice();
    
    switch (action) {
      case 'left':
        break;
      case 'right':
        board = reverse(board);
        break;
      case 'up':
        board = transpose(board);
        break;
      case 'down':
        board = transpose(board);
        board = reverse(board);
        break;
      default:
        return { state: next, changed: false, gained: 0 };
    }
    
    var newBoard = [];
    var totalScore = 0;
    for (var r = 0; r < n; r++) {
      var row = [];
      for (var c = 0; c < n; c++) {
        row.push(board[idx(r, c)]);
      }
      var result = moveRow(row);
      newBoard.push(...result.row);
      totalScore += result.score;
    }
    
    // Revert if needed
    switch (action) {
      case 'right':
        newBoard = reverse(newBoard);
        break;
      case 'down':
        newBoard = reverse(newBoard);
        newBoard = transpose(newBoard);
        break;
      case 'up':
        newBoard = transpose(newBoard);
        break;
    }
    
    // Check if changed
    for (var i = 0; i < size; i++) {
      if (original[i] !== newBoard[i]) {
        changed = true;
        break;
      }
    }
    
    if (changed) {
      next.board = newBoard;
      next.score += totalScore;
      next.moves += 1;
      placeTile(next, rng);
    }
    
    next.won = next.board.some(x => x === 2048);
    next.over = isGameOver(next.board);
    
    return { state: next, changed: changed, gained: totalScore };
  }
  
  function isGameOver(board) {
    var n = 3;
    var size = n * n;
    
    // Check for empty cells
    if (board.some(x => x === 0)) {
      return false;
    }
    
    // Check for adjacent equal values
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var i = r * n + c;
        var current = board[i];
        if (
          (c < n - 1 && board[i + 1] === current) ||
          (r < n - 1 && board[i + n] === current)
        ) {
          return false;
        }
      }
    }
    
    return true;
  }
  
  function status(state) {
    if (state.won) return 'won';
    if (state.over) return 'lost';
    return 'playing';
  }
  
  return { newGame: newGame, act: act, status: status };
})();
// __CORE_END__
