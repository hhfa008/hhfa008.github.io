/*
 * Connect 4 / 四子棋 premium — pure rules engine.
 *
 * UMD: Node `require('./engine.js')`, browser `window.Connect4PremiumEngine`.
 * No DOM, no network, no storage, no randomness. Every helper that changes a
 * position returns a new state; `applyMove` never mutates its argument.
 *
 * State: { b: Int8Array(42), turn: 1|2, last: index|-1, plies: n, first: 1|2 }
 *   b is row-major, row 0 is the TOP row, row 5 the BOTTOM row.
 *   P1 = red (moves first), P2 = yellow.
 *
 * Official rules represented:
 *   7 columns × 6 rows = 42 cells; gravity drops a disc to the lowest empty
 *   cell of its column; red moves first; players alternate; four discs in a
 *   line horizontally, vertically or either diagonal win; a full board with
 *   no four connected is a draw; no moves are legal after the game is over.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Connect4PremiumEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROWS = 6, COLS = 7, CELLS = ROWS * COLS;
  var P1 = 1, P2 = 2, EMPTY = 0;
  var WIN_SCORE = 1000000;
  var ORDER = [3, 2, 4, 1, 5, 0, 6];
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  // All 69 possible four-cell windows: 24 horizontal, 21 vertical, 12 + 12 diagonal.
  var WINDOWS = (function () {
    var out = [], r, c, i, cells;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push(r * COLS + c + i);
        out.push(cells);
      }
    }
    for (c = 0; c < COLS; c++) {
      for (r = 0; r <= ROWS - 4; r++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c);
        out.push(cells);
      }
    }
    for (r = 0; r <= ROWS - 4; r++) {
      for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c + i);
        out.push(cells);
      }
    }
    for (r = 3; r < ROWS; r++) {
      for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r - i) * COLS + c + i);
        out.push(cells);
      }
    }
    return out;
  })();

  function index(r, c) { return r * COLS + c; }
  function rowOf(i) { return (i / COLS) | 0; }
  function colOf(i) { return i % COLS; }
  function other(p) { return p === P1 ? P2 : P1; }

  function setup(opts) {
    var first = opts && opts.first === P2 ? P2 : P1;
    return { b: new Int8Array(CELLS), turn: first, last: -1, plies: 0, first: first };
  }

  function clone(s) {
    return {
      b: new Int8Array(s.b),
      turn: s.turn,
      last: s.last,
      plies: s.plies,
      first: s.first || P1
    };
  }

  // The lowest empty cell of a column, or -1 when the column is full.
  function rowFor(b, c) {
    if (!(c >= 0 && c < COLS)) return -1;
    for (var r = ROWS - 1; r >= 0; r--) {
      if (b[r * COLS + c] === EMPTY) return r;
    }
    return -1;
  }

  function heightsOf(b) {
    var h = new Array(COLS), c, r;
    for (c = 0; c < COLS; c++) {
      h[c] = 0;
      for (r = 0; r < ROWS; r++) if (b[r * COLS + c] !== EMPTY) h[c] += 1;
    }
    return h;
  }

  // Longest contiguous run through (r,c) in one direction; >= 4 wins. Returns
  // every index of the run (could be longer than four on a hand-built board).
  function lineAt(b, r, c, p) {
    if (!p || r < 0 || r >= ROWS || c < 0 || c >= COLS || b[r * COLS + c] !== p) return null;
    var d, cells, rr, cc;
    for (d = 0; d < DIRS.length; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      cells = [r * COLS + c];
      rr = r - dr; cc = c - dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
        cells.unshift(rr * COLS + cc); rr -= dr; cc -= dc;
      }
      rr = r + dr; cc = c + dc;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === p) {
        cells.push(rr * COLS + cc); rr += dr; cc += dc;
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }

  function scanWinner(b) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = b[r * COLS + c];
        if (!p) continue;
        var line = lineAt(b, r, c, p);
        if (line) return { winner: p, line: line };
      }
    }
    return null;
  }

  function countOf(b, p) {
    var n = 0;
    for (var i = 0; i < CELLS; i++) if (b[i] === p) n += 1;
    return n;
  }

  function isOverState(s) {
    return !!scanWinner(s.b) || s.plies >= CELLS;
  }

  // A move is a column number. After a win or a full board, nothing is legal.
  function isLegal(s, c) {
    if (typeof c !== 'number' || c !== Math.floor(c)) return false;
    if (c < 0 || c >= COLS) return false;
    if (s.b[c] !== EMPTY) return false;
    if (s.plies >= CELLS) return false;
    return !scanWinner(s.b);
  }

  function legalMoves(s) {
    if (scanWinner(s.b) || s.plies >= CELLS) return [];
    var out = [];
    for (var c = 0; c < COLS; c++) if (s.b[c] === EMPTY) out.push(c);
    return out;
  }

  function applyMove(s, c) {
    if (!isLegal(s, c)) return null;
    var b = new Int8Array(s.b);
    var r = rowFor(b, c);
    if (r < 0) return null;
    b[r * COLS + c] = s.turn;
    return {
      b: b,
      turn: s.turn === P1 ? P2 : P1,
      last: r * COLS + c,
      plies: s.plies + 1,
      first: s.first || P1
    };
  }

  function status(s) {
    var w = scanWinner(s.b);
    if (w) return { over: true, winner: w.winner, line: w.line, draw: false };
    if (s.plies >= CELLS || !legalMoves(s).length) {
      return { over: true, winner: 0, line: null, draw: true };
    }
    return { over: false, winner: 0, line: null, draw: false };
  }

  // Normalized contract: 0 = draw, null = playing, otherwise the winner token.
  function winnerOf(s) {
    var st = status(s);
    if (!st.over) return null;
    return st.draw ? 0 : st.winner;
  }

  // Stable, randomness-free identity of a position for transpositions/dedupe.
  function key(s) {
    return s.b.join('') + '|' + s.turn;
  }

  function rawWouldWin(b, c, p) {
    if (!(c >= 0 && c < COLS)) return false;
    var r = rowFor(b, c);
    if (r < 0) return false;
    var i = r * COLS + c;
    if (b[i] !== EMPTY) return false;
    b[i] = p;
    var line = lineAt(b, r, c, p);
    b[i] = EMPTY;
    return !!line;
  }

  function wouldWin(s, c, p) {
    var who = p === P1 || p === P2 ? p : s.turn;
    if (!isLegal(s, c)) return false;
    return rawWouldWin(new Int8Array(s.b), c, who);
  }

  // --- evaluation & search -------------------------------------------------

  function evalBoard(b, turn) {
    var score = 0, i, w, a1, a2, e, v;
    for (i = 0; i < WINDOWS.length; i++) {
      w = WINDOWS[i]; a1 = 0; a2 = 0;
      for (v = 0; v < 4; v++) {
        if (b[w[v]] === P1) a1 += 1;
        else if (b[w[v]] === P2) a2 += 1;
      }
      if (a1 && a2) continue;
      e = 4 - a1 - a2;
      if (a1 === 3 && e === 1) score += 90;
      else if (a1 === 2 && e === 2) score += 12;
      else if (a1 === 1 && e === 3) score += 2;
      if (a2 === 3 && e === 1) score -= 110;
      else if (a2 === 2 && e === 2) score -= 14;
      else if (a2 === 1 && e === 3) score -= 2;
    }
    for (var r = 0; r < ROWS; r++) {
      var m = b[r * COLS + 3];
      if (m === P1) score += 6; else if (m === P2) score -= 6;
      var l = b[r * COLS + 2], rr = b[r * COLS + 4];
      if (l === P1) score += 2; else if (l === P2) score -= 2;
      if (rr === P1) score += 2; else if (rr === P2) score -= 2;
    }
    return turn === P1 ? score : -score;
  }

  function search(b, h, turn, depth, alpha, beta, ply, ctx) {
    ctx.nodes += 1;
    if ((ctx.nodes & 511) === 0 && Date.now() > ctx.deadline) ctx.abort = true;
    if (ctx.abort) return 0;
    if (depth <= 0) return evalBoard(b, turn);

    var best = -1e9, moved = false, i, c, r, val;
    for (i = 0; i < COLS; i++) {
      c = ORDER[i];
      if (h[c] >= ROWS) continue;
      r = ROWS - 1 - h[c];
      b[r * COLS + c] = turn; h[c] += 1;
      if (lineAt(b, r, c, turn)) val = WIN_SCORE - ply;
      else val = -search(b, h, turn === P1 ? P2 : P1, depth - 1, -beta, -alpha, ply + 1, ctx);
      b[r * COLS + c] = EMPTY; h[c] -= 1;
      if (ctx.abort) return 0;
      moved = true;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return moved ? best : 0;
  }

  function orderedLegal(h, preferred) {
    var out = [], i, c;
    if (preferred != null && h[preferred] < ROWS) out.push(preferred);
    for (i = 0; i < COLS; i++) {
      c = ORDER[i];
      if (c !== preferred && h[c] < ROWS) out.push(c);
    }
    return out;
  }

  /*
   * Pure AI decision. Returns a column, or null when the game is over.
   * level 1 = easy (win, block, centre), 2 = normal, 3 = hard.
   * budget is the wall-clock ceiling in milliseconds; it never exceeds the
   * requested value (default 300/400) and a completed depth is always kept, so
   * the returned column is legal by construction.
   */
  function aiMove(s, level, budget) {
    var legal = legalMoves(s);
    if (!legal.length) return null;
    var ln = Number(level) || 2;
    if (ln < 1) ln = 1;
    if (ln > 3) ln = 3;
    var me = s.turn, opp = other(me);
    var b0 = new Int8Array(s.b);
    var h0 = heightsOf(b0);
    var i, c;

    // 1. Immediate win, scanning from the centre outward.
    for (i = 0; i < COLS; i++) {
      c = ORDER[i];
      if (h0[c] < ROWS && rawWouldWin(b0, c, me)) return c;
    }
    // 2. Immediate block.
    var blocks = [];
    for (i = 0; i < COLS; i++) {
      c = ORDER[i];
      if (h0[c] < ROWS && rawWouldWin(b0, c, opp)) blocks.push(c);
    }
    if (ln === 1) {
      if (blocks.length) return blocks[0];
      for (i = 0; i < COLS; i++) if (h0[ORDER[i]] < ROWS) return ORDER[i];
      return legal[0];
    }
    if (blocks.length === 1) return blocks[0];
    if (blocks.length > 1) return blocks[0]; // both lose; still legal

    var depthCap = ln >= 3 ? 8 : 4;
    var ceiling = ln >= 3 ? 400 : 300;
    var wait = budget == null ? ceiling : Math.min(ceiling, Math.max(16, Number(budget) || ceiling));
    var deadline = Date.now() + wait;
    var ctx = { nodes: 0, deadline: deadline, abort: false };
    var b = new Int8Array(s.b), h = h0.slice();
    var best = orderedLegal(h, null)[0], d;

    for (d = 1; d <= depthCap; d++) {
      var alpha = -1e9, localVal = -1e9, localBest = null;
      var list = orderedLegal(h, best);
      for (var k = 0; k < list.length; k++) {
        c = list[k];
        var r = ROWS - 1 - h[c];
        b[r * COLS + c] = me; h[c] += 1;
        var val;
        if (lineAt(b, r, c, me)) val = WIN_SCORE - 1;
        else val = -search(b, h, opp, d - 1, -1e9, -alpha, 1, ctx);
        b[r * COLS + c] = EMPTY; h[c] -= 1;
        if (ctx.abort) break;
        if (val > localVal) { localVal = val; localBest = c; }
        if (val > alpha) alpha = val;
      }
      if (ctx.abort) break;
      if (localBest != null) best = localBest;
      if (localVal >= WIN_SCORE - 100 || Date.now() > deadline) break;
    }
    return legal.indexOf(best) >= 0 ? best : legal[0];
  }

  // --- public view ---------------------------------------------------------

  // Connect 4 has no hidden information, so the public view is the whole
  // position. It is still a detached plain-object copy: the online server can
  // serialise it and a client cannot mutate the authoritative match.
  function publicView(s, seat) {
    var st = status(s);
    var viewer = seat == null ? -1 : seat;
    var viewerColor = viewer === 0 ? P1 : (viewer === 1 ? P2 : 0);
    return {
      rows: ROWS,
      cols: COLS,
      board: Array.prototype.slice.call(s.b),
      turn: s.turn,
      first: s.first || P1,
      last: s.last,
      plies: s.plies,
      over: st.over,
      winner: st.winner,
      draw: st.draw,
      line: st.line ? st.line.slice() : null,
      legalColumns: legalMoves(s),
      counts: { red: countOf(s.b, P1), yellow: countOf(s.b, P2) },
      you: viewer,
      yourColor: viewerColor,
      yourTurn: viewer >= 0 && !st.over && s.turn === viewerColor
    };
  }

  // Deterministic self-play used by tests and the art/position generators.
  function selfPlay(level, maxPlies) {
    var s = setup({ first: P1 });
    var limit = maxPlies || CELLS;
    while (!isOverState(s) && s.plies < limit) {
      var c = aiMove(s, level || 2, 120);
      if (c == null) break;
      var next = applyMove(s, c);
      if (!next) break;
      s = next;
    }
    return s;
  }

  return {
    ROWS: ROWS, COLS: COLS, CELLS: CELLS,
    P1: P1, P2: P2, EMPTY: EMPTY, ORDER: ORDER, DIRS: DIRS,
    WINDOWS: WINDOWS,
    setup: setup, createGame: setup, clone: clone,
    index: index, rowOf: rowOf, colOf: colOf,
    rowFor: rowFor, heightsOf: heightsOf, countOf: countOf,
    lineAt: lineAt, scanWinner: scanWinner,
    isLegal: isLegal, legalMoves: legalMoves, applyMove: applyMove,
    status: status, winner: winnerOf, wouldWin: wouldWin,
    key: key, evaluate: evalBoard, evalBoard: evalBoard,
    aiMove: aiMove, publicView: publicView, selfPlay: selfPlay,
    isOver: function (s) { return status(s).over; }
  };
});
