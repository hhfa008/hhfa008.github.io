/* Xiangqi premium engine — pure rules, notation, repetition draw and AI.
   Works as a CommonJS module and as the browser global `XiangqiEngine`.
   Board is a 90-entry array (9 columns × 10 rows, row 0 = Black's back rank).
   Red pieces are upper-case, Black lower-case. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XiangqiEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RED = 1, BLACK = -1;
  var COLS = 9, ROWS = 10, SIZE = 90;
  var MATE = 100000, INF = 1000000;
  var DRAW_PLIES = 120;            // 60 full moves without a capture
  var REPETITION_LIMIT = 3;

  var VAL = { K: 6000, R: 900, N: 400, C: 450, B: 180, A: 180, P: 100 };
  var CHAR = {
    R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵',
    r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒'
  };
  var NAME = {
    R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵',
    r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒'
  };

  function sideOf(p) { return p === p.toUpperCase() ? RED : BLACK; }
  function typeOf(p) { return p.toUpperCase(); }
  function enemy(side) { return -side; }

  function initialBoard() {
    var b = new Array(SIZE).fill(null);
    var back = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
    var x;
    for (x = 0; x < COLS; x++) { b[x] = back[x]; b[81 + x] = back[x].toUpperCase(); }
    b[2 * COLS + 1] = 'c'; b[2 * COLS + 7] = 'c';
    b[7 * COLS + 1] = 'C'; b[7 * COLS + 7] = 'C';
    for (x = 0; x < COLS; x += 2) { b[3 * COLS + x] = 'p'; b[6 * COLS + x] = 'P'; }
    return b;
  }

  function encode(from, to) { return from * SIZE + to; }
  function moveFrom(m) { return Math.floor(m / SIZE); }
  function moveTo(m) { return m % SIZE; }
  function rowOf(sq) { return (sq / COLS) | 0; }
  function colOf(sq) { return sq % COLS; }

  function inPalace(x, y, side) {
    if (x < 3 || x > 5) return false;
    return side === RED ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }

  function addPieceMoves(board, from, p, out) {
    var x = colOf(from), y = rowOf(from), side = sideOf(p), t = typeOf(p);
    var i, nx, ny, dx, dy, q;

    if (t === 'R' || t === 'C') {
      var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (i = 0; i < 4; i++) {
        dx = dirs[i][0]; dy = dirs[i][1];
        nx = x + dx; ny = y + dy;
        if (t === 'R') {
          while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
            q = board[ny * COLS + nx];
            if (!q) out.push(encode(from, ny * COLS + nx));
            else {
              if (sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
              break;
            }
            nx += dx; ny += dy;
          }
        } else {
          var screen = false;
          while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
            q = board[ny * COLS + nx];
            if (!q) {
              if (!screen) out.push(encode(from, ny * COLS + nx));
            } else if (!screen) {
              screen = true;
            } else {
              if (sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
              break;
            }
            nx += dx; ny += dy;
          }
        }
      }
      return;
    }

    if (t === 'N') {
      var kn = [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
                [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]];
      for (i = 0; i < 8; i++) {
        dx = kn[i][0]; dy = kn[i][1];
        nx = x + dx; ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (board[(y + kn[i][3]) * COLS + (x + kn[i][2])]) continue;
        q = board[ny * COLS + nx];
        if (!q || sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
      }
      return;
    }

    if (t === 'B') {
      var el = [[2, 2], [-2, 2], [2, -2], [-2, -2]];
      for (i = 0; i < 4; i++) {
        dx = el[i][0]; dy = el[i][1];
        nx = x + dx; ny = y + dy;
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        if (side === RED ? ny < 5 : ny > 4) continue;
        if (board[(y + dy / 2) * COLS + (x + dx / 2)]) continue;
        q = board[ny * COLS + nx];
        if (!q || sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
      }
      return;
    }

    if (t === 'A') {
      var ad = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
      for (i = 0; i < 4; i++) {
        dx = ad[i][0]; dy = ad[i][1];
        nx = x + dx; ny = y + dy;
        if (!inPalace(nx, ny, side)) continue;
        q = board[ny * COLS + nx];
        if (!q || sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
      }
      return;
    }

    if (t === 'K') {
      var kd = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (i = 0; i < 4; i++) {
        dx = kd[i][0]; dy = kd[i][1];
        nx = x + dx; ny = y + dy;
        if (!inPalace(nx, ny, side)) continue;
        q = board[ny * COLS + nx];
        if (!q || sideOf(q) !== side) out.push(encode(from, ny * COLS + nx));
      }
      return;
    }

    if (t === 'P') {
      var fwd = side === RED ? -1 : 1;
      ny = y + fwd;
      if (ny >= 0 && ny < ROWS) {
        q = board[ny * COLS + x];
        if (!q || sideOf(q) !== side) out.push(encode(from, ny * COLS + x));
      }
      var crossed = side === RED ? y <= 4 : y >= 5;
      if (crossed) {
        if (x > 0) {
          q = board[y * COLS + x - 1];
          if (!q || sideOf(q) !== side) out.push(encode(from, y * COLS + x - 1));
        }
        if (x < COLS - 1) {
          q = board[y * COLS + x + 1];
          if (!q || sideOf(q) !== side) out.push(encode(from, y * COLS + x + 1));
        }
      }
    }
  }

  function pseudoMovesFrom(board, from) {
    var p = board[from];
    if (!p) return [];
    var out = [];
    addPieceMoves(board, from, p, out);
    return out;
  }

  function pseudoMoves(board, side) {
    var out = [];
    for (var sq = 0; sq < SIZE; sq++) {
      var p = board[sq];
      if (p && sideOf(p) === side) addPieceMoves(board, sq, p, out);
    }
    return out;
  }

  function makeMove(board, m) {
    var from = moveFrom(m), to = moveTo(m), cap = board[to];
    board[to] = board[from];
    board[from] = null;
    return cap;
  }
  function unmakeMove(board, m, cap) {
    var from = moveFrom(m), to = moveTo(m);
    board[from] = board[to];
    board[to] = cap;
  }

  function kingSquare(board, side) {
    var target = side === RED ? 'K' : 'k';
    for (var i = 0; i < SIZE; i++) if (board[i] === target) return i;
    return -1;
  }

  function isAttacked(board, sq, bySide) {
    var x = colOf(sq), y = rowOf(sq);
    var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    var d, nx, ny, dist, screen, p, ps, pt;

    for (d = 0; d < 4; d++) {
      nx = x + dirs[d][0]; ny = y + dirs[d][1]; dist = 1; screen = false;
      while (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS) {
        p = board[ny * COLS + nx];
        if (p) {
          ps = sideOf(p); pt = typeOf(p);
          if (!screen) {
            if (ps === bySide) {
              if (pt === 'R') return true;
              if (pt === 'K' && (dirs[d][0] === 0 || dist === 1)) return true;
            }
            screen = true;
          } else {
            if (ps === bySide && pt === 'C') return true;
            break;
          }
        }
        nx += dirs[d][0]; ny += dirs[d][1]; dist++;
      }
    }

    var kn = [[1, 2], [-1, 2], [1, -2], [-1, -2], [2, 1], [2, -1], [-2, 1], [-2, -1]];
    for (d = 0; d < 8; d++) {
      nx = x + kn[d][0]; ny = y + kn[d][1];
      if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
      p = board[ny * COLS + nx];
      if (!p || sideOf(p) !== bySide || typeOf(p) !== 'N') continue;
      var lx, ly;
      if (Math.abs(kn[d][0]) === 2) {
        lx = nx - (kn[d][0] > 0 ? 1 : -1); ly = ny;
      } else {
        lx = nx; ly = ny - (kn[d][1] > 0 ? 1 : -1);
      }
      if (!board[ly * COLS + lx]) return true;
    }

    var pawn = bySide === RED ? 'P' : 'p';
    if (bySide === RED) {
      if (y < ROWS - 1 && board[(y + 1) * COLS + x] === pawn) return true;
      if (y <= 4) {
        if (x > 0 && board[y * COLS + x - 1] === pawn) return true;
        if (x < COLS - 1 && board[y * COLS + x + 1] === pawn) return true;
      }
    } else {
      if (y > 0 && board[(y - 1) * COLS + x] === pawn) return true;
      if (y >= 5) {
        if (x > 0 && board[y * COLS + x - 1] === pawn) return true;
        if (x < COLS - 1 && board[y * COLS + x + 1] === pawn) return true;
      }
    }
    return false;
  }

  function inCheck(board, side) {
    var ksq = kingSquare(board, side);
    if (ksq < 0) return true;
    return isAttacked(board, ksq, -side);
  }

  function legalMoves(board, side) {
    var candidates = pseudoMoves(board, side), out = [];
    for (var i = 0; i < candidates.length; i++) {
      var m = candidates[i], cap = makeMove(board, m);
      if (!inCheck(board, side)) out.push(m);
      unmakeMove(board, m, cap);
    }
    return out;
  }

  /* Traditional Chinese move notation. Red files are numbered 9..1 from
     x=0..8, Black files 1..9. Diagonal pieces name the destination file. */
  function fileNumber(x, side) { return side === RED ? 9 - x : x + 1; }
  function moveToChinese(board, m) {
    var from = moveFrom(m), to = moveTo(m), p = board[from];
    if (!p) return '';
    var side = sideOf(p), t = typeOf(p);
    var fx = colOf(from), fy = rowOf(from), tx = colOf(to), ty = rowOf(to);
    var prefix = (side === RED ? '红' : '黑') + CHAR[p];
    var start = String(fileNumber(fx, side));
    var action, dest;
    if (fy === ty) {
      action = '平';
      dest = String(fileNumber(tx, side));
    } else {
      var forward = side === RED ? ty < fy : ty > fy;
      action = forward ? '进' : '退';
      if (t === 'N' || t === 'B' || t === 'A') dest = String(fileNumber(tx, side));
      else dest = String(Math.abs(ty - fy));
    }
    return prefix + start + action + dest;
  }

  function positionKey(board, side) {
    var out = side === RED ? 'r' : 'b';
    for (var i = 0; i < SIZE; i++) out += board[i] || '.';
    return out;
  }

  function evaluateRed(board) {
    var score = 0;
    for (var sq = 0; sq < SIZE; sq++) {
      var p = board[sq];
      if (!p) continue;
      var side = sideOf(p), t = typeOf(p), x = colOf(sq), y = rowOf(sq);
      var v = VAL[t];
      if (t === 'P') {
        var crossed = side === RED ? y <= 4 : y >= 5;
        var advance = side === RED ? (6 - y) : (y - 3);
        v += advance > 0 ? advance * 4 : 0;
        if (crossed) v += 80 + (side === RED ? (4 - y) : (y - 5)) * 10;
      } else if (t === 'N') {
        v += (4 - Math.abs(x - 4)) * 4 + Math.round((4 - Math.abs(y - 4.5)) * 2);
      } else if (t === 'C') {
        v += (4 - Math.abs(x - 4)) * 3;
        v += side === RED ? Math.max(0, 7 - y) * 2 : Math.max(0, y - 2) * 2;
      } else if (t === 'R') {
        v += (4 - Math.abs(x - 4)) * 2;
      }
      score += side === RED ? v : -v;
    }
    return score;
  }

  function evaluateFor(board, side) { return side * evaluateRed(board); }

  var nodes = 0, deadline = 0, aborted = false;
  function checkTime() {
    nodes++;
    if ((nodes & 511) === 0 && Date.now() > deadline) aborted = true;
    return aborted;
  }
  function moveScore(board, m) {
    var cap = board[moveTo(m)];
    if (!cap) return 0;
    return VAL[typeOf(cap)] * 10 - VAL[typeOf(board[moveFrom(m)])];
  }
  function orderMoves(board, moves) {
    moves.sort(function (a, b) { return moveScore(board, b) - moveScore(board, a); });
    return moves;
  }

  function negamax(board, side, depth, alpha, beta, ply) {
    if (checkTime()) return 0;
    if (depth <= 0) return evaluateFor(board, side);
    var moves = legalMoves(board, side);
    if (moves.length === 0) return -MATE + ply;
    orderMoves(board, moves);
    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i], cap = makeMove(board, m);
      var score = -negamax(board, -side, depth - 1, -beta, -alpha, ply + 1);
      unmakeMove(board, m, cap);
      if (aborted) return best;
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(board, side, depth, timeMs) {
    nodes = 0; aborted = false;
    deadline = Date.now() + (timeMs || 260);
    var moves = legalMoves(board, side);
    if (moves.length === 0) return null;
    orderMoves(board, moves);
    var best = moves[0], bestScore = -INF, alpha = -INF, i, m, cap, score;
    for (i = 0; i < moves.length; i++) {
      m = moves[i];
      cap = makeMove(board, m);
      score = depth <= 1 ? evaluateFor(board, side)
        : -negamax(board, -side, depth - 1, -INF, -alpha, 1);
      unmakeMove(board, m, cap);
      if (aborted && i > 0) break;
      if (score > bestScore) { bestScore = score; best = m; }
      if (score > alpha) alpha = score;
      if (aborted) break;
    }
    return best;
  }

  function emptyState() {
    return {
      board: initialBoard(),
      turn: RED,
      moveNo: 1,
      halfmove: 0,
      history: [],
      captures: { red: [], black: [] },
      repetition: {},
      over: false,
      winner: 0,
      reason: '',
      check: false
    };
  }

  function cloneState(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      moveNo: state.moveNo,
      halfmove: state.halfmove,
      history: state.history.slice(),
      captures: { red: state.captures.red.slice(), black: state.captures.black.slice() },
      repetition: Object.assign({}, state.repetition),
      over: state.over,
      winner: state.winner,
      reason: state.reason,
      check: state.check
    };
  }

  function createGame(options) {
    var opts = options || {};
    var state = emptyState();
    var key = positionKey(state.board, state.turn);
    state.repetition[key] = 1;
    state.check = inCheck(state.board, state.turn);
    if (opts.names) state.names = opts.names;
    return state;
  }

  function applyMove(state, m) {
    if (!state || state.over) throw new Error('对局已结束');
    var from = moveFrom(m), to = moveTo(m);
    var p = state.board[from];
    if (!p) throw new Error('起点没有棋子');
    if (sideOf(p) !== state.turn) throw new Error('还没轮到这一方');
    var legal = legalMoves(state.board, state.turn);
    if (legal.indexOf(m) < 0) throw new Error('不符合规则的着法');
    var next = cloneState(state);
    var notation = moveToChinese(state.board, m);
    var cap = makeMove(next.board, m);
    if (cap) {
      next.captures[sideOf(cap) === RED ? 'red' : 'black'].push(cap);
      next.halfmove = 0;
    } else {
      next.halfmove = state.halfmove + 1;
    }
    next.history.push({
      m: m, from: from, to: to, side: state.turn, notation: notation,
      captured: cap || null, moveNo: state.moveNo
    });
    next.turn = -state.turn;
    if (next.turn === RED) next.moveNo = state.moveNo + 1;
    var key = positionKey(next.board, next.turn);
    next.repetition[key] = (next.repetition[key] || 0) + 1;
    next.check = inCheck(next.board, next.turn);
    var moves = legalMoves(next.board, next.turn);
    if (moves.length === 0) {
      next.over = true;
      next.winner = state.turn;
      next.reason = next.check ? 'checkmate' : 'stalemate';
    } else if (next.halfmove >= DRAW_PLIES) {
      next.over = true;
      next.winner = 0;
      next.reason = 'draw60';
    } else if (next.repetition[key] >= REPETITION_LIMIT) {
      next.over = true;
      next.winner = 0;
      next.reason = 'repetition';
    }
    return next;
  }

  function legalMovesFor(state) {
    if (!state || state.over) return [];
    return legalMoves(state.board, state.turn);
  }

  function aiMove(state, level, timeMs) {
    var depth = level >= 3 ? 3 : level === 2 ? 2 : 1;
    var budget = timeMs || (level >= 3 ? 700 : level === 2 ? 300 : 120);
    return chooseMove(state.board.slice(), state.turn, depth, budget);
  }

  function publicState(state, seatIndex) {
    var seatSide = seatIndex === 1 ? BLACK : RED;
    var view = {
      board: state.board.map(function (p) { return p || null; }),
      turn: state.turn,
      turnSeat: state.turn === RED ? 0 : 1,
      moveNo: state.moveNo,
      halfmove: state.halfmove,
      history: state.history.map(function (h) {
        return { from: h.from, to: h.to, side: h.side, notation: h.notation, captured: h.captured || null };
      }),
      captures: { red: state.captures.red.slice(), black: state.captures.black.slice() },
      check: state.check,
      over: state.over,
      winner: state.winner,
      winnerSeat: state.over ? (state.winner === RED ? 0 : state.winner === BLACK ? 1 : null) : null,
      reason: state.reason,
      lastMove: state.history.length ? state.history[state.history.length - 1] : null
    };
    if (seatIndex != null) {
      view.you = seatIndex;
      view.yourSide = seatSide;
      view.canMove = !state.over && state.turn === seatSide;
      view.legal = view.canMove ? legalMovesFor(state).map(function (m) {
        return { from: moveFrom(m), to: moveTo(m), code: m, notation: moveToChinese(state.board, m) };
      }) : [];
    }
    return view;
  }

  function notate(state, m) { return moveToChinese(state.board, m); }

  function gameStatus(board, turn) {
    var moves = legalMoves(board, turn);
    var check = inCheck(board, turn);
    return {
      moves: moves,
      check: check,
      over: moves.length === 0,
      winner: moves.length === 0 ? -turn : 0,
      checkmate: moves.length === 0 && check,
      stalemate: moves.length === 0 && !check
    };
  }

  return {
    RED: RED, BLACK: BLACK, COLS: COLS, ROWS: ROWS, SIZE: SIZE,
    MATE: MATE, DRAW_PLIES: DRAW_PLIES, REPETITION_LIMIT: REPETITION_LIMIT,
    CHAR: CHAR, NAME: NAME, VAL: VAL,
    initialBoard: initialBoard, sideOfPiece: sideOf, typeOfPiece: typeOf,
    encode: encode, moveFrom: moveFrom, moveTo: moveTo, rowOf: rowOf, colOf: colOf,
    fileNumber: fileNumber, moveToChinese: moveToChinese, notate: notate,
    pseudoMovesFrom: pseudoMovesFrom, pseudoMoves: pseudoMoves, legalMoves: legalMoves,
    legalMovesFor: legalMovesFor, inCheck: inCheck, isAttacked: isAttacked,
    kingSquare: kingSquare, makeMove: makeMove, unmakeMove: unmakeMove,
    evaluate: evaluateRed, evaluateFor: evaluateFor, chooseMove: chooseMove,
    createGame: createGame, cloneState: cloneState, applyMove: applyMove, aiMove: aiMove,
    publicState: publicState, gameStatus: gameStatus, positionKey: positionKey
  };
});
