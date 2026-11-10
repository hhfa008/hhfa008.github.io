/*
 * Gomoku Premium — pure rules + AI engine (UMD).
 *
 * Browser: globalThis.GomokuEngine after ../../shared/rules.js.
 * Node:    require('./engine.js').
 *
 * The win/line primitives are the shared games/shared/rules.js gomoku
 * implementation (the same file the classic page and voice room use); this
 * module owns the mutable match state, turn validation and the three-level AI.
 *
 * Design constraints:
 *   - no DOM; applyMove never mutates its input, it returns a fresh state;
 *   - illegal moves throw Error;
 *   - the AI only returns moves from getLegalMoves;
 *   - same seed + same position => same AI move (deterministic).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../../shared/rules.js').gomoku);
  } else {
    root.GomokuEngine = factory(root.GameRules && root.GameRules.gomoku);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (shared) {
  'use strict';

  if (!shared || typeof shared.checkWinAt !== 'function') {
    throw new Error('GomokuEngine requires games/shared/rules.js');
  }

  var VERSION = '1.0.0';
  var N = shared.N;
  var NN = shared.NN;
  var EMPTY = shared.EMPTY;
  var BLACK = shared.BLACK;
  var WHITE = shared.WHITE;
  var DIRS = shared.DIRS;
  var WIN = 1e9;
  var W5 = [0, 1, 12, 220, 4000, 1000000];
  var W6 = [0, 2, 25, 450, 9000, 300000, 0];
  var LEVELS = { easy: 1, normal: 2, hard: 4 };
  var STAR_POINTS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
  var DEFAULT_NAMES = ['黑方', '白方'];
  var DEFAULT_AI_NAMES = ['你', 'AI · 棋士'];

  function cloneBoard(board) { return board.slice(); }
  function inBoard(r, c) { return shared.inBoard(r, c); }
  function idx(r, c) { return r * N + c; }
  function rowOf(i) { return (i / N) | 0; }
  function colOf(i) { return i % N; }
  function checkWinAt(board, r, c, p) { return shared.checkWinAt(board, r, c, p); }
  function lineAt(board, r, c, p) { return shared.lineAt(board, r, c, p); }

  function mulberry32(a) {
    a = (a >>> 0) || 1;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function positionSeed(state) {
    var h = (state.seed || 1) ^ ((state.moveCount + 1) * 0x9e3779b9);
    h = (h ^ (state.current * 0x85ebca6b)) >>> 0;
    for (var i = 0; i < NN; i++) {
      if (state.board[i]) h = (Math.imul(h ^ (i + 1), 0x01000193) + state.board[i]) >>> 0;
    }
    return h || 1;
  }

  function normalizeLevel(level) {
    if (level == null) return 2;
    if (typeof level === 'number') return level >= 4 ? 4 : level >= 2 ? 2 : 1;
    var key = String(level).toLowerCase();
    return LEVELS[key] || 2;
  }

  function normalizeMove(move) {
    if (!move || typeof move !== 'object') throw new Error('move must be an object');
    var type = move.type == null ? 'place' : String(move.type);
    if (type !== 'place') throw new Error('unsupported move type: ' + type);
    var r = Number(move.row);
    var c = Number(move.col);
    if (!Number.isInteger(r) || !Number.isInteger(c)) throw new Error('move needs integer row and col');
    if (!inBoard(r, c)) throw new Error('move is outside the 15x15 board');
    return { type: 'place', row: r, col: c };
  }

  function createGame(options) {
    var opts = options || {};
    var seed = (Number(opts.seed) >>> 0) || 1;
    var names = opts.names && opts.names.length === 2 ? [String(opts.names[0]), String(opts.names[1])] : DEFAULT_NAMES.slice();
    var isAI = opts.isAI && opts.isAI.length === 2 ? [!!opts.isAI[0], !!opts.isAI[1]] : [false, true];
    var state = {
      version: VERSION,
      size: N,
      seed: seed,
      rng: seed,
      board: new Array(NN).fill(EMPTY),
      current: BLACK,
      over: false,
      winner: 0,
      winLine: null,
      lastMove: null,
      moveCount: 0,
      players: [
        { index: 0, name: names[0], isAI: isAI[0], color: BLACK },
        { index: 1, name: names[1], isAI: isAI[1], color: WHITE }
      ],
      aiLevel: opts.aiLevel == null ? 'normal' : String(opts.aiLevel),
      history: [],
      events: [],
      result: null
    };
    return state;
  }

  function cloneState(state) {
    return {
      version: state.version,
      size: state.size,
      seed: state.seed,
      rng: state.rng,
      board: cloneBoard(state.board),
      current: state.current,
      over: state.over,
      winner: state.winner,
      winLine: state.winLine ? state.winLine.slice() : null,
      lastMove: state.lastMove ? { row: state.lastMove.row, col: state.lastMove.col, player: state.lastMove.player } : null,
      moveCount: state.moveCount,
      players: state.players.map(function (p) { return { index: p.index, name: p.name, isAI: p.isAI, color: p.color }; }),
      aiLevel: state.aiLevel,
      history: state.history.map(function (h) { return { row: h.row, col: h.col, player: h.player, index: h.index }; }),
      events: (state.events || []).slice(-24),
      result: state.result ? JSON.parse(JSON.stringify(state.result)) : null
    };
  }

  function count(board, p) {
    var n = 0;
    for (var i = 0; i < NN; i++) if (board[i] === p) n++;
    return n;
  }

  function isFull(board) {
    for (var i = 0; i < NN; i++) if (board[i] === EMPTY) return false;
    return true;
  }

  function finish(next, winner, line, reason) {
    next.over = true;
    next.winner = winner;
    next.winLine = line ? line.slice() : null;
    next.result = {
      winner: winner,
      line: line ? line.slice() : null,
      reason: reason,
      scores: [count(next.board, BLACK), count(next.board, WHITE)],
      moves: next.moveCount
    };
    next.events.push({ type: 'end', winner: winner, reason: reason });
    if (next.events.length > 24) next.events.splice(0, next.events.length - 24);
    return next;
  }

  function applyMove(state, move) {
    if (!state || typeof state !== 'object') throw new Error('state is required');
    if (state.over) throw new Error('game is already over');
    var m = normalizeMove(move);
    var i = idx(m.row, m.col);
    if (state.board[i] !== EMPTY) throw new Error('intersection is occupied');
    var next = cloneState(state);
    var p = next.current;
    next.board[i] = p;
    next.lastMove = { row: m.row, col: m.col, player: p };
    next.moveCount += 1;
    next.history.push({ row: m.row, col: m.col, player: p, index: i });
    next.events.push({ type: 'place', row: m.row, col: m.col, player: p, index: i });
    if (next.events.length > 24) next.events.splice(0, next.events.length - 24);
    if (checkWinAt(next.board, m.row, m.col, p)) {
      return finish(next, p, lineAt(next.board, m.row, m.col, p), 'five');
    }
    if (next.moveCount === NN) return finish(next, 0, null, 'full');
    next.current = 3 - p;
    return next;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var out = [];
    var cx = 7;
    var cy = 7;
    for (var i = 0; i < NN; i++) {
      if (state.board[i] !== EMPTY) continue;
      var r = rowOf(i), c = colOf(i);
      out.push({ type: 'place', row: r, col: c, dist: (r - cy) * (r - cy) + (c - cx) * (c - cx) });
    }
    out.sort(function (a, b) { return a.dist - b.dist || a.row - b.row || a.col - b.col; });
    return out.map(function (m) { return { type: m.type, row: m.row, col: m.col }; });
  }

  function immediateWins(board, p) {
    var out = [];
    for (var i = 0; i < NN; i++) {
      if (board[i] !== EMPTY) continue;
      var r = rowOf(i), c = colOf(i);
      board[i] = p;
      if (checkWinAt(board, r, c, p)) out.push(i);
      board[i] = EMPTY;
    }
    return out;
  }

  function pointScore(board, i, p) {
    var r = rowOf(i), c = colOf(i), q = 3 - p, total = 0, d, st, k;
    for (d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      for (st = -4; st <= 0; st++) {
        var own = 0, blocked = false;
        for (k = 0; k < 5; k++) {
          var off = st + k, v;
          if (off === 0) v = p;
          else {
            var rr = r + dr * off, cc = c + dc * off;
            if (!inBoard(rr, cc)) { blocked = true; break; }
            v = board[rr * N + cc];
          }
          if (v === q) { blocked = true; break; }
          if (v === p) own++;
        }
        if (!blocked) total += W5[own];
      }
      for (st = -5; st <= 0; st++) {
        var e1r = r + dr * st, e1c = c + dc * st;
        var e2r = r + dr * (st + 5), e2c = c + dc * (st + 5);
        if (!inBoard(e1r, e1c) || !inBoard(e2r, e2c)) continue;
        if (board[e1r * N + e1c] !== EMPTY || board[e2r * N + e2c] !== EMPTY) continue;
        var own2 = 0, bad = false;
        for (k = 1; k <= 4; k++) {
          var off2 = st + k, v2;
          if (off2 === 0) v2 = p;
          else v2 = board[(r + dr * off2) * N + (c + dc * off2)];
          if (v2 === q) { bad = true; break; }
          if (v2 === p) own2++;
        }
        if (!bad) total += W6[own2];
      }
    }
    return total;
  }

  var LINES = (function () {
    var lines = [], r, c;
    for (r = 0; r < N; r++) {
      var row = [];
      for (c = 0; c < N; c++) row.push(r * N + c);
      lines.push(row);
    }
    for (c = 0; c < N; c++) {
      var col = [];
      for (r = 0; r < N; r++) col.push(r * N + c);
      lines.push(col);
    }
    function diag(r0, c0, dr, dc) {
      var a = [], rr = r0, cc = c0;
      while (inBoard(rr, cc)) { a.push(rr * N + cc); rr += dr; cc += dc; }
      if (a.length >= 5) lines.push(a);
    }
    for (c = 0; c < N; c++) { diag(0, c, 1, 1); diag(0, c, 1, -1); }
    for (r = 1; r < N; r++) { diag(r, 0, 1, 1); diag(r, N - 1, 1, -1); }
    return lines;
  })();

  function evalBoard(board, p) {
    var q = 3 - p, s = 0, li, i, j, v, o, x;
    for (li = 0; li < LINES.length; li++) {
      var L = LINES[li], len = L.length;
      for (i = 0; i + 5 <= len; i++) {
        o = 0; x = 0;
        for (j = 0; j < 5; j++) {
          v = board[L[i + j]];
          if (v === p) o++; else if (v === q) x++;
        }
        if (!x) s += W5[o];
        else if (!o) s -= W5[x] * 1.12;
      }
      for (i = 0; i + 6 <= len; i++) {
        if (board[L[i]] !== EMPTY || board[L[i + 5]] !== EMPTY) continue;
        o = 0; x = 0;
        for (j = 1; j <= 4; j++) {
          v = board[L[i + j]];
          if (v === p) o++; else if (v === q) x++;
        }
        if (!x) s += W6[o];
        else if (!o) s -= W6[x] * 1.12;
      }
    }
    return s;
  }

  function candidates(board) {
    var seen = new Uint8Array(NN), out = [], any = false, i, dr, dc;
    for (i = 0; i < NN; i++) {
      if (board[i] === EMPTY) continue;
      any = true;
      var r = rowOf(i), c = colOf(i);
      for (dr = -2; dr <= 2; dr++) {
        for (dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          var rr = r + dr, cc = c + dc;
          if (!inBoard(rr, cc)) continue;
          var j = rr * N + cc;
          if (board[j] === EMPTY && !seen[j]) { seen[j] = 1; out.push(j); }
        }
      }
    }
    if (!any) return [idx(7, 7)];
    return out;
  }

  function orderedMoves(board, p, limit) {
    var list = candidates(board), scored = [], k;
    for (k = 0; k < list.length; k++) {
      var i = list[k];
      var s = pointScore(board, i, p) + pointScore(board, i, 3 - p) * 0.9;
      scored.push([s, i]);
    }
    scored.sort(function (a, b) { return b[0] - a[0] || a[1] - b[1]; });
    var out = [];
    for (k = 0; k < scored.length && k < limit; k++) out.push(scored[k][1]);
    return out;
  }

  // Node-budgeted search (not wall-clock) so the same position always yields
  // the same move even on a loaded machine. Depth 2 on <=7 candidates stays far
  // below the 150ms per-move budget.
  function negamax(board, depth, alpha, beta, p, ctx) {
    ctx.nodes += 1;
    if (depth <= 0 || ctx.nodes > ctx.maxNodes) return evalBoard(board, p);
    var moves = orderedMoves(board, p, depth >= 2 ? 7 : 5);
    if (!moves.length) return 0;
    var best = -Infinity;
    for (var k = 0; k < moves.length; k++) {
      var i = moves[k], r = rowOf(i), c = colOf(i);
      board[i] = p;
      var val;
      if (checkWinAt(board, r, c, p)) val = WIN - (4 - depth) * 1000;
      else val = -negamax(board, depth - 1, -beta, -alpha, 3 - p, ctx);
      board[i] = EMPTY;
      if (val > best) best = val;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function pickFrom(list, rng) {
    if (!list.length) return -1;
    return list[Math.floor(rng() * list.length) % list.length];
  }

  function chooseAIMove(state, level) {
    if (!state || state.over) return null;
    var board = cloneBoard(state.board);
    if (isFull(board)) return null;
    var p = state.current;
    var q = 3 - p;
    var lvl = normalizeLevel(level == null ? state.aiLevel : level);
    var rng = mulberry32(positionSeed(state));

    var wins = immediateWins(board, p);
    if (wins.length) return { type: 'place', row: rowOf(wins[0]), col: colOf(wins[0]) };
    var blocks = immediateWins(board, q);
    if (blocks.length) {
      blocks.sort(function (a, b) { return pointScore(board, b, p) - pointScore(board, a, p) || a - b; });
      return { type: 'place', row: rowOf(blocks[0]), col: colOf(blocks[0]) };
    }

    var empty = true;
    for (var e = 0; e < NN; e++) { if (board[e] !== EMPTY) { empty = false; break; } }
    if (empty) return { type: 'place', row: 7, col: 7 };

    var limit = lvl === 1 ? 18 : lvl === 2 ? 12 : 10;
    var moves = orderedMoves(board, p, limit);
    if (!moves.length) return null;

    if (lvl === 1) {
      var top = moves.slice(0, Math.min(7, moves.length));
      var chosen = pickFrom(top, rng);
      return { type: 'place', row: rowOf(chosen), col: colOf(chosen) };
    }

    if (lvl === 2) {
      var best = moves[0], bestScore = -Infinity;
      for (var k = 0; k < moves.length; k++) {
        var i = moves[k];
        var r = rowOf(i), c = colOf(i);
        board[i] = p;
        var own = evalBoard(board, p);
        var reply = -Infinity;
        var oppMoves = candidates(board);
        for (var m = 0; m < oppMoves.length; m++) {
          var oi = oppMoves[m];
          var os = pointScore(board, oi, q) + pointScore(board, oi, p) * 0.55;
          if (os > reply) reply = os;
        }
        board[i] = EMPTY;
        var score = own - (reply === -Infinity ? 0 : reply) * 1.05;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return { type: 'place', row: rowOf(best), col: colOf(best) };
    }

    var ctx = { nodes: 0, maxNodes: 9000 };
    var rootBest = moves[0], rootScore = -Infinity, alpha = -Infinity;
    for (var h = 0; h < moves.length; h++) {
      var mi = moves[h], mr = rowOf(mi), mc = colOf(mi);
      board[mi] = p;
      var value;
      if (checkWinAt(board, mr, mc, p)) value = WIN;
      else value = -negamax(board, 2, -Infinity, -alpha, q, ctx);
      board[mi] = EMPTY;
      if (value > rootScore) { rootScore = value; rootBest = mi; }
      if (rootScore > alpha) alpha = rootScore;
    }
    return { type: 'place', row: rowOf(rootBest), col: colOf(rootBest) };
  }

  function status(state) {
    if (!state) return 'unknown';
    if (state.over) {
      if (state.winner === BLACK) return 'black';
      if (state.winner === WHITE) return 'white';
      return 'draw';
    }
    return state.current === BLACK ? 'black-to-move' : 'white-to-move';
  }

  function score(state) {
    return { black: count(state.board, BLACK), white: count(state.board, WHITE), moves: state.moveCount };
  }

  return {
    VERSION: VERSION,
    N: N,
    NN: NN,
    EMPTY: EMPTY,
    BLACK: BLACK,
    WHITE: WHITE,
    STAR_POINTS: STAR_POINTS,
    LEVELS: LEVELS,
    createGame: createGame,
    cloneState: cloneState,
    applyMove: applyMove,
    getLegalMoves: getLegalMoves,
    chooseAIMove: chooseAIMove,
    checkWinAt: checkWinAt,
    lineAt: lineAt,
    immediateWins: immediateWins,
    pointScore: pointScore,
    evalBoard: evalBoard,
    candidates: candidates,
    isFull: isFull,
    count: count,
    status: status,
    score: score
  };
});
