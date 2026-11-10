/*
 * Reversi / Othello premium — pure rules engine (UMD).
 *
 *   browser: globalThis.ReversiEngine
 *   Node:    require('./engine.js')
 *
 * 8×8, black moves first. A move must bracket at least one opposing disc in
 * one of the eight directions; all bracketed discs flip. A player with no
 * legal move passes. When neither player can move the game ends and the
 * larger disc count wins (a draw is possible).
 *
 * The engine is authoritative for the page, unit tests and the online room
 * server. applyMove never mutates its input; illegal actions throw Error.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReversiEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var SIZE = 8;
  var CELLS = SIZE * SIZE;
  var EMPTY = 0;
  var BLACK = 1;
  var WHITE = 2;

  var DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1]
  ];

  // Classic Othello positional table: corners are gold, X-squares are traps.
  var WEIGHT = [
    100, -25, 10, 5, 5, 10, -25, 100,
    -25, -50, -5, -5, -5, -5, -50, -25,
    10, -5, 2, 1, 1, 2, -5, 10,
    5, -5, 1, 0, 0, 1, -5, 5,
    5, -5, 1, 0, 0, 1, -5, 5,
    10, -5, 2, 1, 1, 2, -5, 10,
    -25, -50, -5, -5, -5, -5, -50, -25,
    100, -25, 10, 5, 5, 10, -25, 100
  ];

  var CORNERS = [0, 7, 56, 63];
  var DIFFICULTIES = ['easy', 'normal', 'hard'];

  function other(player) { return player === BLACK ? WHITE : BLACK; }
  function index(row, col) { return row * SIZE + col; }
  function rowOf(i) { return (i / SIZE) | 0; }
  function colOf(i) { return i % SIZE; }
  function inBoard(row, col) { return row >= 0 && row < SIZE && col >= 0 && col < SIZE; }
  function emptyBoard() { return new Array(CELLS).fill(EMPTY); }

  function initialBoard() {
    var b = emptyBoard();
    b[index(3, 3)] = WHITE;
    b[index(3, 4)] = BLACK;
    b[index(4, 3)] = BLACK;
    b[index(4, 4)] = WHITE;
    return b;
  }

  function copyBoard(board) {
    if (!board || board.length !== CELLS) throw new Error('board must have 64 cells');
    return board.slice();
  }

  /* ------------------------------------------------------------- legality */

  function flipsAt(board, row, col, player) {
    if (!inBoard(row, col)) return null;
    if (board[index(row, col)] !== EMPTY) return null;
    var opposite = other(player);
    var all = [];
    for (var d = 0; d < DIRS.length; d += 1) {
      var dr = DIRS[d][0];
      var dc = DIRS[d][1];
      var rr = row + dr;
      var cc = col + dc;
      var line = [];
      while (inBoard(rr, cc) && board[index(rr, cc)] === opposite) {
        line.push(index(rr, cc));
        rr += dr;
        cc += dc;
      }
      if (line.length && inBoard(rr, cc) && board[index(rr, cc)] === player) {
        for (var k = 0; k < line.length; k += 1) all.push(line[k]);
      }
    }
    return all.length ? all : null;
  }

  function legalFor(board, player) {
    var out = [];
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] !== EMPTY) continue;
      var row = rowOf(i);
      var col = colOf(i);
      var flips = flipsAt(board, row, col, player);
      if (flips) out.push({ i: i, row: row, col: col, flips: flips });
    }
    return out;
  }

  function hasMoves(board, player) {
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] !== EMPTY) continue;
      if (flipsAt(board, rowOf(i), colOf(i), player)) return true;
    }
    return false;
  }

  function count(board, player) {
    var n = 0;
    for (var i = 0; i < CELLS; i += 1) if (board[i] === player) n += 1;
    return n;
  }

  function scoresOf(board) {
    return { black: count(board, BLACK), white: count(board, WHITE), empty: count(board, EMPTY) };
  }

  /* --------------------------------------------------------------- scoring */

  function posScore(board, player) {
    var opponent = other(player);
    var score = 0;
    for (var i = 0; i < CELLS; i += 1) {
      if (board[i] === player) score += WEIGHT[i];
      else if (board[i] === opponent) score -= WEIGHT[i];
    }
    return score;
  }

  function finalScore(board, player) {
    var diff = count(board, player) - count(board, other(player));
    if (diff > 0) return 100000 + diff;
    if (diff < 0) return -100000 + diff;
    return 0;
  }

  function evaluate(board, player) {
    var opponent = other(player);
    var positional = posScore(board, player);
    var mobility = legalFor(board, player).length - legalFor(board, opponent).length;
    var discs = count(board, player) - count(board, opponent);
    var corners = 0;
    for (var i = 0; i < CORNERS.length; i += 1) {
      if (board[CORNERS[i]] === player) corners += 1;
      else if (board[CORNERS[i]] === opponent) corners -= 1;
    }
    return positional + mobility * 10 + discs * 3 + corners * 24;
  }

  /* -------------------------------------------------------------- movement */

  function normalizeLevel(level) {
    if (level === 1 || level === '1') return 'easy';
    if (level === 2 || level === '2') return 'normal';
    if (level === 4 || level === '4' || level === 'hard') return 'hard';
    if (level === 'easy' || level === 'normal') return level;
    return 'normal';
  }

  function normalizeMove(move) {
    if (!move || typeof move !== 'object') throw new Error('move is required');
    if (move.type === 'pass' || move.pass === true) return { type: 'pass' };
    var row = move.row;
    var col = move.col;
    if ((row == null || col == null) && move.i != null) {
      row = rowOf(Number(move.i));
      col = colOf(Number(move.i));
    }
    row = Number(row);
    col = Number(col);
    if (!Number.isInteger(row) || !Number.isInteger(col) || !inBoard(row, col)) {
      throw new Error('move row/col must be integers on the 8×8 board');
    }
    return { type: 'place', row: row, col: col };
  }

  function cloneState(state) {
    return {
      version: state.version,
      size: SIZE,
      board: state.board.slice(),
      current: state.current,
      over: !!state.over,
      winner: state.winner || 0,
      scores: { black: state.scores.black, white: state.scores.white },
      passed: !!state.passed,
      passCount: state.passCount || 0,
      moveCount: state.moveCount || 0,
      lastMove: state.lastMove ? { row: state.lastMove.row, col: state.lastMove.col, player: state.lastMove.player } : null,
      lastFlips: (state.lastFlips || []).slice(),
      history: (state.history || []).map(function (entry) {
        return entry.type === 'place'
          ? { type: 'place', player: entry.player, row: entry.row, col: entry.col, flips: (entry.flips || []).slice() }
          : { type: 'pass', player: entry.player };
      }),
      players: state.players.map(function (p) {
        return { index: p.index, name: p.name, isAI: !!p.isAI, color: p.color, score: p.score || 0 };
      }),
      aiLevel: state.aiLevel,
      seed: state.seed,
      result: state.result ? Object.assign({}, state.result) : null,
      rng: state.rng
    };
  }

  function updateScores(state) {
    var s = scoresOf(state.board);
    state.scores = { black: s.black, white: s.white };
    state.players[0].score = s.black;
    state.players[1].score = s.white;
  }

  function finalize(state) {
    state.over = true;
    updateScores(state);
    var b = state.scores.black;
    var w = state.scores.white;
    state.winner = b > w ? BLACK : (w > b ? WHITE : 0);
    state.result = {
      black: b,
      white: w,
      winner: state.winner,
      draw: b === w,
      moves: state.moveCount,
      passes: state.history.filter(function (h) { return h.type === 'pass'; }).length
    };
  }

  function advance(state, mover, wasPass) {
    var opponent = other(mover);
    var opponentMoves = legalFor(state.board, opponent);
    if (opponentMoves.length) {
      state.current = opponent;
      if (wasPass) {
        state.passed = true;
      } else {
        state.passed = false;
        state.passCount = 0;
      }
      return;
    }
    // Opponent has no move. If the mover still has one, the opponent must pass.
    if (legalFor(state.board, mover).length) {
      state.current = opponent;
      state.passed = true;
      state.passCount = 1;
      return;
    }
    finalize(state);
  }

  function createGame(options) {
    var opts = options || {};
    var names = Array.isArray(opts.names) && opts.names.length === 2
      ? [String(opts.names[0] || '黑方'), String(opts.names[1] || '白方')]
      : ['黑方', '白方'];
    var isAI = Array.isArray(opts.isAI) && opts.isAI.length === 2
      ? [!!opts.isAI[0], !!opts.isAI[1]]
      : [false, true];
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0) || 1;
    var board = initialBoard();
    var state = {
      version: VERSION,
      size: SIZE,
      board: board,
      current: BLACK,
      over: false,
      winner: 0,
      scores: { black: 2, white: 2 },
      passed: false,
      passCount: 0,
      moveCount: 0,
      lastMove: null,
      lastFlips: [],
      history: [],
      players: [
        { index: 0, name: names[0], isAI: isAI[0], color: BLACK, score: 2 },
        { index: 1, name: names[1], isAI: isAI[1], color: WHITE, score: 2 }
      ],
      aiLevel: normalizeLevel(opts.aiLevel || 'normal'),
      seed: seed,
      result: null,
      rng: seed
    };
    return state;
  }

  function applyMove(state, rawMove) {
    if (!state || state.over) throw new Error('game is over');
    var move = normalizeMove(rawMove);
    var next = cloneState(state);
    var player = next.current;
    var legal = legalFor(next.board, player);

    if (move.type === 'pass') {
      if (legal.length) throw new Error('cannot pass while a legal move exists');
      next.history.push({ type: 'pass', player: player });
      next.passed = true;
      next.passCount = (next.passCount || 0) + 1;
      next.lastMove = null;
      next.lastFlips = [];
      advance(next, player, true);
      return next;
    }

    if (!legal.length) throw new Error('no legal move for this player: pass required');
    var flips = flipsAt(next.board, move.row, move.col, player);
    if (!flips) throw new Error('illegal move: no opposing discs would be flipped');
    next.board[index(move.row, move.col)] = player;
    for (var k = 0; k < flips.length; k += 1) next.board[flips[k]] = player;
    next.history.push({
      type: 'place', player: player, row: move.row, col: move.col, flips: flips.slice()
    });
    next.lastMove = { row: move.row, col: move.col, player: player };
    next.lastFlips = flips.slice();
    next.moveCount += 1;
    next.passed = false;
    next.passCount = 0;
    updateScores(next);
    advance(next, player, false);
    return next;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var moves = legalFor(state.board, state.current);
    if (!moves.length) return [{ type: 'pass', reason: 'no-legal-move' }];
    return moves.map(function (m) {
      return { type: 'place', row: m.row, col: m.col, i: m.i, flips: m.flips.slice() };
    });
  }

  /* ---------------------------------------------------------------- AI */

  function seededRandom(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function orderMoves(moves) {
    moves.sort(function (a, b) {
      var sa = WEIGHT[a.i] * 2 + a.flips.length * 3;
      var sb = WEIGHT[b.i] * 2 + b.flips.length * 3;
      if (sb !== sa) return sb - sa;
      return a.i - b.i;
    });
    return moves;
  }

  function applyBoard(board, move, player) {
    var next = board.slice();
    next[move.i] = player;
    for (var k = 0; k < move.flips.length; k += 1) next[move.flips[k]] = player;
    return next;
  }

  function search(board, player, depth, alpha, beta, ctx) {
    ctx.nodes += 1;
    if (ctx.nodes > ctx.cap || depth <= 0) return evaluate(board, ctx.root);
    var moves = legalFor(board, player);
    if (!moves.length) {
      if (!hasMoves(board, other(player))) return finalScore(board, ctx.root);
      return -search(board, other(player), depth - 1, -beta, -alpha, ctx);
    }
    orderMoves(moves);
    var best = -Infinity;
    for (var k = 0; k < moves.length; k += 1) {
      var next = applyBoard(board, moves[k], player);
      var val = -search(next, other(player), depth - 1, -beta, -alpha, ctx);
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
      if (ctx.nodes > ctx.cap) break;
    }
    return best;
  }

  function chooseAIMove(state, level) {
    if (!state || state.over) return null;
    var player = state.current;
    var moves = legalFor(state.board, player);
    if (!moves.length) return { type: 'pass' };
    var difficulty = normalizeLevel(level == null ? state.aiLevel : level);

    if (difficulty === 'easy') {
      var rng = seededRandom((state.seed || 1) ^ (state.moveCount * 2654435761) ^ (player * 97));
      var best = null;
      var bestVal = -Infinity;
      for (var e = 0; e < moves.length; e += 1) {
        var m = moves[e];
        var corner = CORNERS.indexOf(m.i) !== -1 ? 6 : 0;
        var xs = [9, 14, 49, 54].indexOf(m.i) !== -1 ? -3 : 0;
        var val = m.flips.length * 0.6 + corner + xs + rng() * 4;
        if (val > bestVal) { bestVal = val; best = m; }
      }
      return { type: 'place', row: best.row, col: best.col };
    }

    var depth = difficulty === 'hard' ? 4 : 2;
    var cap = difficulty === 'hard' ? 16000 : 1200;
    var ctx = { root: player, nodes: 0, cap: cap };
    orderMoves(moves);
    var alpha = -Infinity;
    var pick = moves[0];
    var pickScore = -Infinity;
    for (var k = 0; k < moves.length; k += 1) {
      var next = applyBoard(state.board, moves[k], player);
      var score = -search(next, other(player), depth - 1, -Infinity, -alpha, ctx);
      if (score > pickScore) { pickScore = score; pick = moves[k]; }
      if (score > alpha) alpha = score;
      if (ctx.nodes > ctx.cap) break;
    }
    return { type: 'place', row: pick.row, col: pick.col };
  }

  /* --------------------------------------------------------------- undo */

  function undo(state) {
    if (!state || !state.history.length) return state;
    var fresh = createGame({
      names: state.players.map(function (p) { return p.name; }),
      isAI: state.players.map(function (p) { return p.isAI; }),
      seed: state.seed,
      aiLevel: state.aiLevel
    });
    for (var i = 0; i < state.history.length - 1; i += 1) {
      var h = state.history[i];
      fresh = applyMove(fresh, h.type === 'pass' ? { type: 'pass' } : { type: 'place', row: h.row, col: h.col });
    }
    return fresh;
  }

  function publicState(state) {
    if (!state) return null;
    return {
      size: SIZE,
      board: state.board.slice(),
      current: state.current,
      over: !!state.over,
      winner: state.winner || 0,
      scores: { black: state.scores.black, white: state.scores.white },
      passed: !!state.passed,
      passCount: state.passCount || 0,
      moveCount: state.moveCount || 0,
      lastMove: state.lastMove ? { row: state.lastMove.row, col: state.lastMove.col, player: state.lastMove.player } : null,
      lastFlips: (state.lastFlips || []).slice(),
      players: state.players.map(function (p) {
        return { index: p.index, name: p.name, isAI: !!p.isAI, color: p.color, score: p.score || 0 };
      }),
      result: state.result ? Object.assign({}, state.result) : null,
      aiLevel: state.aiLevel,
      recent: (state.history || []).slice(-10).map(function (h) {
        return h.type === 'place'
          ? { type: 'place', player: h.player, row: h.row, col: h.col }
          : { type: 'pass', player: h.player };
      })
    };
  }

  return {
    VERSION: VERSION,
    SIZE: SIZE,
    CELLS: CELLS,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    DIRS: DIRS,
    WEIGHT: WEIGHT,
    CORNERS: CORNERS,
    DIFFICULTIES: DIFFICULTIES,
    other: other,
    index: index,
    rowOf: rowOf,
    colOf: colOf,
    inBoard: inBoard,
    initialBoard: initialBoard,
    emptyBoard: emptyBoard,
    flipsAt: flipsAt,
    legalFor: legalFor,
    hasMoves: hasMoves,
    count: count,
    scoresOf: scoresOf,
    posScore: posScore,
    finalScore: finalScore,
    evaluate: evaluate,
    createGame: createGame,
    applyMove: applyMove,
    getLegalMoves: getLegalMoves,
    chooseAIMove: chooseAIMove,
    undo: undo,
    publicState: publicState,
    normalizeLevel: normalizeLevel
  };
});
