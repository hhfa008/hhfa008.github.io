/* International Draughts (10×10) premium engine — pure rules, maximum
   capture, flying kings, notation and alpha-beta AI.
   Browser global: DraughtsEngine. CommonJS: module.exports.
   White (1) moves up (row decreasing) and starts; Black (-1) moves down.
   Kings are 2 / -2. Only dark squares ((r+c) & 1) === 1 are playable. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DraughtsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SIZE = 10, CELLS = 100;
  var EMPTY = 0, WHITE = 1, BLACK = -1, KING = 2;
  var MATE = 100000, INF = 1000000;
  var KING_DRAW_PLIES = 50;   // 25 moves by each side, kings only, no capture
  var REPETITION_LIMIT = 3;
  var DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  function idx(r, c) { return r * SIZE + c; }
  function row(sq) { return (sq / SIZE) | 0; }
  function col(sq) { return sq % SIZE; }
  function inb(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
  function isDark(r, c) { return ((r + c) & 1) === 1; }
  function sideOf(p) { return p > 0 ? WHITE : p < 0 ? BLACK : 0; }
  function isKing(p) { return p === KING || p === -KING; }
  function number(sq) { return row(sq) * 5 + (col(sq) >> 1) + 1; }
  function fromNumber(n) {
    var i = n - 1, r = Math.floor(i / 5), k = i % 5;
    var c = (r % 2 === 0) ? (k * 2 + 1) : (k * 2);
    return idx(r, c);
  }
  function lastRow(sq, side) { return side === WHITE ? row(sq) === 0 : row(sq) === SIZE - 1; }

  function setup() {
    var b = new Array(CELLS).fill(EMPTY), r, c;
    for (r = 0; r < SIZE; r++) {
      for (c = 0; c < SIZE; c++) {
        if (!isDark(r, c)) continue;
        if (r < 4) b[idx(r, c)] = BLACK;
        else if (r > 5) b[idx(r, c)] = WHITE;
      }
    }
    return b;
  }

  function clone(state) {
    return {
      board: state.board.slice(),
      turn: state.turn,
      moveNo: state.moveNo,
      kingMoves: state.kingMoves,
      history: state.history.slice(),
      captures: { white: state.captures.white.slice(), black: state.captures.black.slice() },
      repetition: Object.assign({}, state.repetition),
      over: state.over, winner: state.winner, reason: state.reason
    };
  }

  function createGame() {
    var s = {
      board: setup(), turn: WHITE, moveNo: 1, kingMoves: 0,
      history: [], captures: { white: [], black: [] }, repetition: {},
      over: false, winner: 0, reason: ''
    };
    s.repetition[positionKey(s.board, s.turn)] = 1;
    return s;
  }

  function positionKey(board, turn) {
    return (turn === WHITE ? 'w' : 'b') + board.join('');
  }

  function countPieces(state, side) {
    var n = 0;
    for (var i = 0; i < CELLS; i++) if (sideOf(state.board[i]) === side) n++;
    return n;
  }

  /* All capture sequences from `from`, with captured pieces still occupying
     the board (international rules remove them only after the move ends). */
  function captureSequences(board, from) {
    var piece = board[from];
    var side = sideOf(piece), king = isKing(piece);
    board = board.slice();
    board[from] = EMPTY; // the moving piece has left its origin
    var out = [];
    var path = [from];
    var captured = [];
    var seen = Object.create(null);

    function walk(cur) {
      var r = row(cur), c = col(cur), any = false;
      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        if (!king) {
          var mr = r + dr, mc = c + dc, lr = r + 2 * dr, lc = c + 2 * dc;
          if (!inb(lr, lc)) continue;
          var mid = idx(mr, mc), land = idx(lr, lc);
          if (sideOf(board[mid]) !== -side || seen[mid]) continue;
          if (board[land] !== EMPTY) continue;
          any = true;
          seen[mid] = 1; captured.push(mid); path.push(land);
          var before = out.length;
          walk(land);
          if (out.length === before) {
            out.push({
              from: from, to: land, path: path.slice(), captures: captured.slice(),
              promoted: lastRow(land, side)
            });
          }
          seen[mid] = 0; delete seen[mid]; captured.pop(); path.pop();
        } else {
          var sr = r + dr, sc = c + dc, found = -1;
          while (inb(sr, sc)) {
            var sq = idx(sr, sc);
            if (board[sq] !== EMPTY) { found = sq; break; }
            sr += dr; sc += dc;
          }
          if (found < 0) continue;
          if (sideOf(board[found]) !== -side || seen[found]) continue;
          var lr2 = sr + dr, lc2 = sc + dc;
          while (inb(lr2, lc2)) {
            var land2 = idx(lr2, lc2);
            if (board[land2] !== EMPTY) break;
            any = true;
            seen[found] = 1; captured.push(found); path.push(land2);
            var before2 = out.length;
            walk(land2);
            if (out.length === before2) {
              out.push({
                from: from, to: land2, path: path.slice(), captures: captured.slice(),
                promoted: false
              });
            }
            seen[found] = 0; delete seen[found]; captured.pop(); path.pop();
            lr2 += dr; lc2 += dc;
          }
        }
      }
      return any;
    }
    walk(from);
    return out;
  }

  function quietMoves(board, from) {
    var p = board[from], side = sideOf(p), king = isKing(p);
    var out = [], r = row(from), c = col(from), d;
    if (king) {
      for (d = 0; d < 4; d++) {
        var kr = r + DIRS[d][0], kc = c + DIRS[d][1];
        while (inb(kr, kc) && board[idx(kr, kc)] === EMPTY) {
          out.push({ from: from, to: idx(kr, kc), path: [from, idx(kr, kc)], captures: [], promoted: false });
          kr += DIRS[d][0]; kc += DIRS[d][1];
        }
      }
    } else {
      for (d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        if (side === WHITE && dr > 0) continue;
        if (side === BLACK && dr < 0) continue;
        var nr = r + dr, nc = c + dc;
        if (!inb(nr, nc) || board[idx(nr, nc)] !== EMPTY) continue;
        out.push({
          from: from, to: idx(nr, nc), path: [from, idx(nr, nc)], captures: [],
          promoted: lastRow(idx(nr, nc), side)
        });
      }
    }
    return out;
  }

  function legalMoves(state) {
    var board = state.board, side = state.turn, caps = [], i;
    for (i = 0; i < CELLS; i++) {
      if (sideOf(board[i]) !== side) continue;
      var seq = captureSequences(board, i);
      if (seq.length) caps = caps.concat(seq);
    }
    if (caps.length) {
      var max = 0;
      for (i = 0; i < caps.length; i++) if (caps[i].captures.length > max) max = caps[i].captures.length;
      return caps.filter(function (m) { return m.captures.length === max; });
    }
    var quiet = [];
    for (i = 0; i < CELLS; i++) {
      if (sideOf(board[i]) === side) quiet = quiet.concat(quietMoves(board, i));
    }
    return quiet;
  }

  function legalMovesFrom(state, from) {
    return legalMoves(state).filter(function (m) { return m.from === from; });
  }

  function findMove(state, payload) {
    if (!payload) return null;
    var moves = legalMoves(state);
    var from = payload.from, to = payload.to;
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].from === from && moves[i].to === to) {
        if (Array.isArray(payload.path) && payload.path.length !== moves[i].path.length) continue;
        return moves[i];
      }
    }
    return null;
  }

  function moveNotation(move) {
    var path = move.path || [move.from, move.to];
    return path.map(number).join(move.captures.length ? 'x' : '-');
  }

  function applyMove(state, move) {
    if (!state || state.over) throw new Error('对局已结束');
    var canonical = findMove(state, move);
    if (!canonical) throw new Error('不符合规则的着法');
    var next = clone(state);
    var side = state.turn;
    var p = next.board[canonical.from];
    var notation = moveNotation(canonical);
    for (var i = 0; i < canonical.captures.length; i++) {
      var sq = canonical.captures[i];
      var victim = next.board[sq];
      next.board[sq] = EMPTY;
      next.captures[sideOf(victim) === WHITE ? 'white' : 'black'].push(victim);
    }
    next.board[canonical.from] = EMPTY;
    var promote = canonical.promoted || (!isKing(p) && lastRow(canonical.to, side));
    next.board[canonical.to] = promote ? side * KING : p;
    next.history.push({
      from: canonical.from, to: canonical.to, path: canonical.path,
      captures: canonical.captures, side: side, notation: notation,
      promoted: promote && !isKing(p), moveNo: state.moveNo
    });
    if (canonical.captures.length || !isKing(p)) next.kingMoves = 0;
    else next.kingMoves = state.kingMoves + 1;
    next.turn = -side;
    if (next.turn === WHITE) next.moveNo = state.moveNo + 1;
    var key = positionKey(next.board, next.turn);
    next.repetition[key] = (next.repetition[key] || 0) + 1;
    var moves = legalMoves(next);
    if (moves.length === 0) {
      next.over = true; next.winner = side; next.reason = 'nomoves';
    } else if (next.kingMoves >= KING_DRAW_PLIES) {
      next.over = true; next.winner = 0; next.reason = 'king25';
    } else if (next.repetition[key] >= REPETITION_LIMIT) {
      next.over = true; next.winner = 0; next.reason = 'repetition';
    }
    return next;
  }

  function value(p) {
    if (isKing(p)) return 320;
    return 100;
  }

  function evaluate(state) {
    var score = 0, i, p, side, r, c;
    for (i = 0; i < CELLS; i++) {
      p = state.board[i];
      if (!p) continue;
      side = sideOf(p); r = row(i); c = col(i);
      var v = value(p);
      if (!isKing(p)) {
        var advance = side === WHITE ? (9 - r) : r;
        v += advance * 3;
        if (c >= 2 && c <= 7) v += 3;
        if ((side === WHITE && r === 9) || (side === BLACK && r === 0)) v += 8;
      } else {
        v += (4 - Math.abs(c - 4.5)) * 2;
        v += (side === WHITE ? r : 9 - r) * 0.5;
      }
      score += side === WHITE ? v : -v;
    }
    return state.turn === WHITE ? score : -score;
  }

  var deadline = 0, aborted = false, nodes = 0;
  function timeUp() {
    nodes++;
    if ((nodes & 255) === 0 && Date.now() > deadline) aborted = true;
    return aborted;
  }
  function order(moves) {
    return moves.slice().sort(function (a, b) {
      return (b.captures.length * 100 + (b.promoted ? 40 : 0)) -
        (a.captures.length * 100 + (a.promoted ? 40 : 0));
    });
  }
  function negamax(state, depth, alpha, beta, ply) {
    if (timeUp()) return 0;
    var moves = legalMoves(state);
    if (moves.length === 0) return -MATE + ply;
    if (depth <= 0) return evaluate(state);
    order(moves);
    var best = -INF;
    for (var i = 0; i < moves.length; i++) {
      var val = -negamax(applyMove(state, moves[i]), depth - 1, -beta, -alpha, ply + 1);
      if (aborted) return best;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function chooseMove(state, level, timeMs) {
    var moves = legalMoves(state);
    if (!moves.length) return null;
    if (level <= 1) {
      var ordered = order(moves);
      return ordered[0];
    }
    nodes = 0; aborted = false;
    deadline = Date.now() + (timeMs || 500);
    var maxDepth = level >= 3 ? 4 : level === 2 ? 2 : 1;
    var best = order(moves)[0];
    for (var d = 1; d <= maxDepth; d++) {
      var alpha = -INF, localBest = best, localVal = -INF;
      var ordered2 = order(moves);
      var bi = ordered2.indexOf(best);
      if (bi > 0) { ordered2.splice(bi, 1); ordered2.unshift(best); }
      for (var i = 0; i < ordered2.length; i++) {
        var val = -negamax(applyMove(state, ordered2[i]), d - 1, -INF, -alpha, 1);
        if (aborted) break;
        if (val > localVal) { localVal = val; localBest = ordered2[i]; }
        if (val > alpha) alpha = val;
      }
      if (aborted) break;
      best = localBest;
      if (Date.now() > deadline) break;
    }
    return best;
  }

  function aiMove(state, level, timeMs) {
    return chooseMove(state, level, timeMs);
  }

  function publicState(state, seatIndex) {
    var seatSide = seatIndex === 0 ? WHITE : BLACK;
    var view = {
      board: state.board.slice(),
      turn: state.turn,
      turnSeat: state.turn === WHITE ? 0 : 1,
      moveNo: state.moveNo,
      kingMoves: state.kingMoves,
      history: state.history.map(function (h) {
        return { from: h.from, to: h.to, path: h.path.slice(), captures: h.captures.slice(), side: h.side, notation: h.notation, promoted: !!h.promoted };
      }),
      captures: { white: state.captures.white.slice(), black: state.captures.black.slice() },
      over: state.over, winner: state.winner,
      winnerSeat: state.over ? (state.winner === WHITE ? 0 : state.winner === BLACK ? 1 : null) : null,
      reason: state.reason,
      lastMove: state.history.length ? state.history[state.history.length - 1] : null
    };
    if (seatIndex != null) {
      view.you = seatIndex;
      view.yourSide = seatSide;
      view.canMove = !state.over && state.turn === seatSide;
      view.legal = view.canMove ? legalMoves(state).map(function (m) {
        return {
          from: m.from, to: m.to, path: m.path.slice(), captures: m.captures.slice(),
          promoted: !!m.promoted, notation: moveNotation(m)
        };
      }) : [];
    }
    return view;
  }

  return {
    SIZE: SIZE, CELLS: CELLS, WHITE: WHITE, BLACK: BLACK, KING: KING,
    MATE: MATE, KING_DRAW_PLIES: KING_DRAW_PLIES, REPETITION_LIMIT: REPETITION_LIMIT,
    idx: idx, row: row, col: col, inb: inb, isDark: isDark,
    sideOf: sideOf, isKing: isKing, number: number, fromNumber: fromNumber,
    setup: setup, createGame: createGame, clone: clone,
    legalMoves: legalMoves, legalMovesFrom: legalMovesFrom, findMove: findMove,
    applyMove: applyMove, aiMove: aiMove, chooseMove: chooseMove,
    evaluate: evaluate, publicState: publicState, moveNotation: moveNotation,
    countPieces: countPieces, positionKey: positionKey, captureSequences: captureSequences
  };
});
