/* Shared rule engines for Gomoku (五子棋) and Connect Four (四子棋).
 *
 * This file is the single source of truth for both:
 *   - the standalone games at games/gomoku/ and games/connect4/ (classic <script>)
 *   - the voice-room signalling Worker / Durable Object (ES module import)
 *
 * UMD wrapper: classic pages read window.GameRules; the Worker imports the file
 * for its side effect and reads the same global in the isolate.
 *
 * Gomoku rules are lifted from games/gomoku/index.html (checkWinAt / constants).
 * The Connect Four engine is lifted verbatim from games/connect4/index.html
 * (the /* === ENGINE START === * / block), including its AI, so both the
 * standalone page and the server share one implementation.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GameRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var gomoku = (function () {
    var N = 15, EMPTY = 0, BLACK = 1, WHITE = 2;
    var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

    function inBoard(r, c) {
      return r >= 0 && r < N && c >= 0 && c < N;
    }

    function checkWinAt(b, r, c, p) {
      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1], n = 1, k, rr, cc;
        for (k = 1; k < 5; k++) {
          rr = r + dr * k; cc = c + dc * k;
          if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
          n++;
        }
        for (k = 1; k < 5; k++) {
          rr = r - dr * k; cc = c - dc * k;
          if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
          n++;
        }
        if (n >= 5) return true;
      }
      return false;
    }

    // Returns every contiguous stone index in the winning direction (>= 5),
    // or null. Used by the server to broadcast the winning line.
    function lineAt(b, r, c, p) {
      if (!inBoard(r, c) || b[r * N + c] !== p) return null;
      for (var d = 0; d < 4; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        var cells = [r * N + c], k, rr, cc;
        for (k = 1; k < 5; k++) {
          rr = r + dr * k; cc = c + dc * k;
          if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
          cells.push(rr * N + cc);
        }
        for (k = 1; k < 5; k++) {
          rr = r - dr * k; cc = c - dc * k;
          if (!inBoard(rr, cc) || b[rr * N + cc] !== p) break;
          cells.unshift(rr * N + cc);
        }
        if (cells.length >= 5) return cells;
      }
      return null;
    }

    function index(r, c) { return r * N + c; }
    function rowOf(i) { return (i / N) | 0; }
    function colOf(i) { return i % N; }

    return {
      N: N, NN: N * N, EMPTY: EMPTY, BLACK: BLACK, WHITE: WHITE, DIRS: DIRS,
      inBoard: inBoard, checkWinAt: checkWinAt, lineAt: lineAt,
      index: index, rowOf: rowOf, colOf: colOf,
    };
  })();

  var connect4 = (function () {
    var ROWS = 6, COLS = 7, P1 = 1, P2 = 2, WIN = 1000000;
    var ORDER = [3, 2, 4, 1, 5, 0, 6];
    var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

    var WINDOWS = (function () {
      var w = [], r, c, i, cells;
      for (r = 0; r < ROWS; r++) for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push(r * COLS + c + i);
        w.push(cells);
      }
      for (c = 0; c < COLS; c++) for (r = 0; r <= ROWS - 4; r++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c);
        w.push(cells);
      }
      for (r = 0; r <= ROWS - 4; r++) for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r + i) * COLS + c + i);
        w.push(cells);
      }
      for (r = 3; r < ROWS; r++) for (c = 0; c <= COLS - 4; c++) {
        cells = [];
        for (i = 0; i < 4; i++) cells.push((r - i) * COLS + c + i);
        w.push(cells);
      }
      return w;
    })();

    function setup() {
      return { b: new Int8Array(ROWS * COLS), turn: P1, last: -1, plies: 0 };
    }
    function clone(s) {
      return { b: new Int8Array(s.b), turn: s.turn, last: s.last, plies: s.plies };
    }
    function isLegal(s, c) {
      return c >= 0 && c < COLS && s.b[c] === 0;
    }
    function legalMoves(s) {
      var out = [], c;
      for (c = 0; c < COLS; c++) if (s.b[c] === 0) out.push(c);
      return out;
    }
    function rowFor(b, c) {
      var r;
      for (r = ROWS - 1; r >= 0; r--) if (b[r * COLS + c] === 0) return r;
      return -1;
    }

    function lineAt(b, r, c, p) {
      var d, cells, rr, cc, k;
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
      var r, c, p, line;
      for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
        p = b[r * COLS + c];
        if (!p) continue;
        line = lineAt(b, r, c, p);
        if (line) return { winner: p, line: line };
      }
      return null;
    }

    function applyMove(s, c) {
      if (!isLegal(s, c)) return null;
      var b = new Int8Array(s.b), r = rowFor(b, c);
      b[r * COLS + c] = s.turn;
      return { b: b, turn: 3 - s.turn, last: r * COLS + c, plies: s.plies + 1 };
    }

    function status(s) {
      var w = scanWinner(s.b);
      if (w) return { over: true, winner: w.winner, line: w.line, draw: false };
      if (s.plies >= ROWS * COLS || legalMoves(s).length === 0) {
        return { over: true, winner: 0, line: null, draw: true };
      }
      return { over: false, winner: 0, line: null, draw: false };
    }

    function wouldWin(s, c, p) {
      if (!isLegal(s, c)) return false;
      var b = new Int8Array(s.b), r = rowFor(b, c);
      b[r * COLS + c] = p;
      return !!lineAt(b, r, c, p);
    }

    function evalBoard(b, turn) {
      var score = 0, i, v, w, a1, a2, e;
      for (i = 0; i < WINDOWS.length; i++) {
        w = WINDOWS[i]; a1 = 0; a2 = 0;
        for (v = 0; v < 4; v++) {
          if (b[w[v]] === P1) a1++;
          else if (b[w[v]] === P2) a2++;
        }
        e = 4 - a1 - a2;
        if (a1 && a2) continue;
        if (a1 === 3 && e === 1) score += 90;
        else if (a1 === 2 && e === 2) score += 12;
        else if (a1 === 1 && e === 3) score += 2;
        if (a2 === 3 && e === 1) score -= 110;
        else if (a2 === 2 && e === 2) score -= 14;
        else if (a2 === 1 && e === 3) score -= 2;
      }
      for (v = 0; v < ROWS; v++) {
        var m = b[v * COLS + 3];
        if (m === P1) score += 6; else if (m === P2) score -= 6;
        var l = b[v * COLS + 2], rr = b[v * COLS + 4];
        if (l === P1) score += 2; else if (l === P2) score -= 2;
        if (rr === P1) score += 2; else if (rr === P2) score -= 2;
      }
      return turn === P1 ? score : -score;
    }

    function heightsOf(b) {
      var h = [0, 0, 0, 0, 0, 0, 0], c, r;
      for (c = 0; c < COLS; c++) for (r = 0; r < ROWS; r++) if (b[r * COLS + c]) h[c]++;
      return h;
    }

    function search(b, h, turn, depth, alpha, beta, ply, ctx) {
      ctx.nodes++;
      if ((ctx.nodes & 1023) === 0 && (Date.now() > ctx.deadline || ctx.nodes >= ctx.maxNodes)) {
        ctx.abort = true;
      }
      if (ctx.abort) return 0;
      if (depth <= 0) return evalBoard(b, turn);
      var best = -1e9, moved = false, i, c, r, val;
      for (i = 0; i < COLS; i++) {
        c = ORDER[i];
        if (h[c] >= ROWS) continue;
        r = ROWS - 1 - h[c];
        b[r * COLS + c] = turn; h[c]++;
        if (lineAt(b, r, c, turn)) val = WIN - ply;
        else val = -search(b, h, 3 - turn, depth - 1, -beta, -alpha, ply + 1, ctx);
        b[r * COLS + c] = 0; h[c]--;
        if (ctx.abort) return 0;
        moved = true;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (alpha >= beta) break;
      }
      return moved ? best : 0;
    }

    function easyMove(s) {
      var legal = legalMoves(s), i;
      for (i = 0; i < legal.length; i++) if (wouldWin(s, legal[i], s.turn)) return legal[i];
      for (i = 0; i < legal.length; i++) if (wouldWin(s, legal[i], 3 - s.turn)) return legal[i];
      return legal[Math.floor(Math.random() * legal.length)];
    }

    function aiMove(s, level, budget) {
      var legal = legalMoves(s), ln = +level || 2;
      if (!legal.length) return null;
      if (ln === 1) return easyMove(s);

      var depthCap = ln >= 3 ? 7 : 4;
      var deadline = Date.now() + (budget || (ln >= 3 ? 480 : 400));
      var ctx = {
        nodes: 0, deadline: deadline, abort: false,
        maxNodes: ln >= 3 ? 420000 : 260000
      };
      var b = new Int8Array(s.b), h = heightsOf(b), turn = s.turn;
      var order = [], i;
      for (i = 0; i < COLS; i++) if (h[ORDER[i]] < ROWS) order.push(ORDER[i]);
      var best = order[0], d;
      for (d = 1; d <= depthCap; d++) {
        var alpha = -1e9, localVal = -1e9, localBest = null;
        var list = order.slice(), bi = list.indexOf(best), k, c, r, val;
        if (bi > 0) { list.splice(bi, 1); list.unshift(best); }
        for (k = 0; k < list.length; k++) {
          c = list[k]; r = ROWS - 1 - h[c];
          b[r * COLS + c] = turn; h[c]++;
          if (lineAt(b, r, c, turn)) val = WIN - 1;
          else val = -search(b, h, 3 - turn, d - 1, -1e9, -alpha, 1, ctx);
          b[r * COLS + c] = 0; h[c]--;
          if (ctx.abort) break;
          if (val > localVal) { localVal = val; localBest = c; }
          if (val > alpha) alpha = val;
        }
        if (!ctx.abort && localBest !== null) best = localBest;
        if (ctx.abort || localVal >= WIN - 100) break;
      }
      return best;
    }

    return {
      ROWS: ROWS, COLS: COLS, P1: P1, P2: P2,
      setup: setup, clone: clone, isLegal: isLegal, legalMoves: legalMoves,
      rowFor: rowFor, lineAt: lineAt, scanWinner: scanWinner,
      applyMove: applyMove, status: status, wouldWin: wouldWin,
      evaluate: evalBoard, aiMove: aiMove
    };
  })();

  return { gomoku: gomoku, connect4: connect4 };
});
