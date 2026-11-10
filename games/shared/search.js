/* Shared game-tree search: negamax + alpha-beta, iterative deepening and a
 * transposition table.
 *
 * UMD: classic pages read window.Search, Node requires the module.
 *
 * The search is game-agnostic.  An adapter supplies the game rules:
 *
 *   state                        opts.state (or adapter.state)
 *   legalMoves(state)   -> [move]
 *   applyMove(state, m) -> newState        pure; never mutates its argument
 *   status(state)       -> 'playing' | 'win' | 'draw'
 *   winner(state)       -> 0 (draw) | side token | null (still playing)
 *   evaluate(state)     -> number          from the side to move
 *   key(state)          -> string          optional; defaults to GameRules.key
 *   orderMoves(state, moves, info) -> [move]   optional
 *   makeMove(state, m) / unmakeMove(state, undo)   optional in-place fast path
 *
 * Scores are ordinary negamax scores from the side to move.  A move that wins
 * scores `winScore - distance`; a node with no legal moves scores 0.  The
 * default winScore (1e6) is the value the Connect Four engine has always used.
 * (status(state) is part of the adapter contract so hosts can share it; the
 * search itself detects a win with winner(newState) right after applying the
 * move, which also gives it the winner token.)
 *
 * Two ways to drive it:
 *
 *   Search.negamax(adapter, { state, depth, timeMs, tt })
 *     -> { move, score, depth, nodes, aborted, table }
 *
 *   Search.iterativeDeepening(adapter, { state, maxDepth, timeMs })
 *     -> { move, depth, nodes, score, aborted, table }
 *
 * Iterative deepening always returns the best move from the last *completed*
 * depth, so a timeout can only fall back to the previous iteration.  The
 * transposition table is keyed by the adapter's stable key(state) string and
 * stores depth/score/flag/best move; pass `tt: false` or `ttSize: 0` to turn it
 * off.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Search = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INF = 1e9;
  var DEFAULT_WIN_SCORE = 1000000;
  var DEFAULT_TT_SIZE = 1 << 16;
  var DEFAULT_CHECK_MASK = 1023;

  /* ------------------------------------------------------------------ *
   * Transposition table
   * ------------------------------------------------------------------ */

  function TranspositionTable(capacity) {
    this.capacity = capacity > 0 ? (capacity | 0) : DEFAULT_TT_SIZE;
    this.map = new Map();
    this.probes = 0;
    this.hits = 0;
    this.stores = 0;
  }

  TranspositionTable.prototype.probe = function (key) {
    this.probes++;
    var entry = this.map.get(key);
    if (entry) this.hits++;
    return entry || null;
  };

  // Depth-preferred replacement.  When the table is full and the incoming
  // entry is at least as deep as the stored one, the oldest key is evicted
  // (Map keeps insertion order); a shallower entry never overwrites a deeper
  // one.
  TranspositionTable.prototype.store = function (key, depth, score, flag, move) {
    this.stores++;
    var old = this.map.get(key);
    if (old && old.depth > depth) return;
    if (!old && this.map.size >= this.capacity) {
      var first = this.map.keys().next();
      if (!first.done) this.map.delete(first.value);
    }
    this.map.set(key, {
      depth: depth,
      score: score,
      flag: flag,
      move: move == null ? null : move
    });
  };

  TranspositionTable.prototype.clear = function () {
    this.map.clear();
    this.probes = 0;
    this.hits = 0;
    this.stores = 0;
  };

  TranspositionTable.prototype.size = function () {
    return this.map.size;
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  function stateOf(adapter, opts) {
    if (opts.state !== undefined) return opts.state;
    if (adapter && adapter.state !== undefined) return adapter.state;
    throw new Error('Search: opts.state (or adapter.state) is required');
  }

  function resolveKeyFn(adapter, opts) {
    if (opts && typeof opts.key === 'function') {
      return function (state) { return opts.key(state); };
    }
    if (adapter && typeof adapter.key === 'function') {
      return function (state) { return adapter.key(state); };
    }
    if (adapter && typeof adapter.keyOf === 'function') {
      return function (state) { return adapter.keyOf(state); };
    }
    // The shared rule engines publish a normalized contract whose key(state)
    // is the stable position string; accept either that object or a Rules
    // object explicitly passed as adapter.key.
    if (typeof GameRules !== 'undefined' && GameRules && typeof GameRules.key === 'function') {
      return function (state) { return GameRules.key(state); };
    }
    if (typeof Rules !== 'undefined' && Rules && typeof Rules.key === 'function') {
      return function (state) { return Rules.key(state); };
    }
    return null;
  }

  function resolveTable(opts) {
    var tt = opts.tt;
    if (tt && typeof tt.probe === 'function' && typeof tt.store === 'function') return tt;
    if (tt === false || tt === 0) return null;
    var size = opts.ttSize;
    if (size === undefined || size === null) {
      if (typeof tt === 'number') size = tt;
      else if (tt && typeof tt === 'object' && tt.capacity > 0) size = tt.capacity;
      else size = DEFAULT_TT_SIZE;
    }
    if (!(size > 0)) return null;
    return new TranspositionTable(size);
  }

  function makeContext(adapter, opts) {
    var winScore = opts.winScore !== undefined && opts.winScore !== null
      ? opts.winScore : DEFAULT_WIN_SCORE;
    var ctx = {
      nodes: 0,
      aborted: false,
      winScore: winScore,
      // Scores at or beyond half the win value are mate scores; they are
      // normalised by ply before going into the table.
      mateMin: winScore / 2,
      deadline: opts.deadline !== undefined && opts.deadline !== null
        ? opts.deadline
        : (opts.timeMs !== undefined && opts.timeMs !== null ? Date.now() + opts.timeMs : Infinity),
      maxNodes: opts.maxNodes !== undefined && opts.maxNodes !== null ? opts.maxNodes : Infinity,
      checkMask: opts.nodeCheckMask !== undefined && opts.nodeCheckMask !== null
        ? (opts.nodeCheckMask | 0) : DEFAULT_CHECK_MASK,
      earlyStopMargin: opts.earlyStopMargin !== undefined && opts.earlyStopMargin !== null
        ? opts.earlyStopMargin : 100,
      tt: resolveTable(opts)
    };
    if (ctx.tt) {
      var keyFn = resolveKeyFn(adapter, opts);
      if (keyFn) ctx.keyOf = keyFn;
      // Without a stable key the table cannot be used; run without it rather
      // than refusing to search a valid adapter.
      else ctx.tt = null;
    }
    return ctx;
  }

  function checkAbort(ctx) {
    if (ctx.aborted) return true;
    if ((ctx.nodes & ctx.checkMask) === 0) {
      if (ctx.deadline !== Infinity && Date.now() > ctx.deadline) ctx.aborted = true;
      if (ctx.nodes >= ctx.maxNodes) ctx.aborted = true;
    }
    return ctx.aborted;
  }

  // Mate scores depend on the distance from the root, so add/subtract the ply
  // around a table store/probe.
  function toTableScore(score, ply, ctx) {
    if (score > ctx.mateMin) return score + ply;
    if (score < -ctx.mateMin) return score - ply;
    return score;
  }

  function fromTableScore(score, ply, ctx) {
    if (score > ctx.mateMin) return score - ply;
    if (score < -ctx.mateMin) return score + ply;
    return score;
  }

  function moveToFront(moves, move) {
    if (move === undefined || move === null) return moves;
    var i = moves.indexOf(move);
    if (i > 0) {
      moves.splice(i, 1);
      moves.unshift(move);
    }
    return moves;
  }

  function orderedMoves(adapter, state, moves, info) {
    var out;
    if (adapter && typeof adapter.orderMoves === 'function') {
      out = adapter.orderMoves(state, moves.slice(), info);
      if (!Array.isArray(out)) out = moves.slice();
    } else {
      out = moves.slice();
    }
    if (info) {
      if (info.ttMove !== undefined && info.ttMove !== null) moveToFront(out, info.ttMove);
      if (info.hint !== undefined && info.hint !== null) moveToFront(out, info.hint);
    }
    return out;
  }

  function makeMove(adapter, state, move) {
    if (adapter && typeof adapter.makeMove === 'function') {
      return { fast: true, undo: adapter.makeMove(state, move), next: state };
    }
    return { fast: false, undo: null, next: adapter.applyMove(state, move) };
  }

  function unmakeMove(adapter, state, applied) {
    if (applied.fast && adapter && typeof adapter.unmakeMove === 'function') {
      adapter.unmakeMove(state, applied.undo);
    }
  }

  /* ------------------------------------------------------------------ *
   * Negamax with alpha-beta
   * ------------------------------------------------------------------ */

  function search(adapter, state, depth, alpha, beta, ply, ctx) {
    ctx.nodes++;
    if (checkAbort(ctx)) return 0;
    if (depth <= 0) return adapter.evaluate(state);

    var tt = ctx.tt;
    var key = null;
    var tte = null;
    if (tt) {
      key = ctx.keyOf(state);
      tte = tt.probe(key);
      if (tte && tte.depth >= depth) {
        var cached = fromTableScore(tte.score, ply, ctx);
        if (tte.flag === 'exact') return cached;
        if (tte.flag === 'lower' && cached >= beta) return cached;
        if (tte.flag === 'upper' && cached <= alpha) return cached;
      }
    }

    var alpha0 = alpha;
    var beta0 = beta;
    var moves = adapter.legalMoves(state);
    if (!moves || moves.length === 0) {
      if (tt && key !== null) {
        tt.store(key, depth, toTableScore(0, ply, ctx), 'exact', null);
      }
      return 0;
    }

    moves = orderedMoves(adapter, state, moves, {
      ply: ply,
      depth: depth,
      ttMove: tte ? tte.move : null
    });

    var best = -INF;
    var bestMove = null;
    var mover = state.turn;
    var i, applied, val;

    for (i = 0; i < moves.length; i++) {
      applied = makeMove(adapter, state, moves[i]);
      if (adapter.winner(applied.next) === mover) {
        // Match the rules.js convention: a win at ply p scores
        // winScore - p, and a root move (ply 0) scores winScore - 1.
        val = ctx.winScore - Math.max(1, ply);
      } else {
        val = -search(adapter, applied.next, depth - 1, -beta, -alpha, ply + 1, ctx);
      }
      unmakeMove(adapter, state, applied);
      if (ctx.aborted) return 0;
      if (val > best) {
        best = val;
        bestMove = moves[i];
      }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }

    if (tt && key !== null) {
      var flag = best <= alpha0 ? 'upper' : (best >= beta0 ? 'lower' : 'exact');
      tt.store(key, depth, toTableScore(best, ply, ctx), flag, bestMove);
    }
    return best;
  }

  // One root iteration.  Returns the partial result even on abort; callers
  // that must keep the previous completed iteration (iterative deepening)
  // check ctx.aborted and ignore it.
  function rootSearch(adapter, state, depth, ctx, hint, startAlpha, beta) {
    var legal = adapter.legalMoves(state);
    if (!legal || legal.length === 0) {
      return { score: 0, move: null, moves: [], aborted: ctx.aborted };
    }
    var moves = orderedMoves(adapter, state, legal, { ply: 0, depth: depth, hint: hint });
    var alpha = startAlpha !== undefined && startAlpha !== null ? startAlpha : -INF;
    var best = -INF;
    var bestMove = null;
    var mover = state.turn;
    var top = beta !== undefined && beta !== null ? beta : INF;
    var i, applied, val;

    for (i = 0; i < moves.length; i++) {
      applied = makeMove(adapter, state, moves[i]);
      if (adapter.winner(applied.next) === mover) {
        val = ctx.winScore - 1;
      } else {
        val = -search(adapter, applied.next, depth - 1, -top, -alpha, 1, ctx);
      }
      unmakeMove(adapter, state, applied);
      if (ctx.aborted) break;
      if (val > best) {
        best = val;
        bestMove = moves[i];
      }
      if (best > alpha) alpha = best;
    }

    return { score: best, move: bestMove, moves: moves, aborted: ctx.aborted };
  }

  function negamax(adapter, opts) {
    opts = opts || {};
    if ((opts.maxDepth !== undefined && opts.maxDepth !== null) || opts.iterative === true) {
      return iterativeDeepening(adapter, opts);
    }
    var state = stateOf(adapter, opts);
    var depth = opts.depth !== undefined && opts.depth !== null ? opts.depth : 4;
    var ctx = makeContext(adapter, opts);
    var started = Date.now();
    var res = rootSearch(adapter, state, depth, ctx, opts.hintMove, opts.alpha, opts.beta);
    var move = res.move;
    if (move === null && res.moves.length) {
      // A time limit can fire before the first root move finishes.  Always
      // hand back a legal move rather than null.
      move = res.moves[0];
    }
    return {
      move: move,
      score: res.score,
      depth: ctx.aborted ? 0 : depth,
      nodes: ctx.nodes,
      aborted: ctx.aborted,
      elapsedMs: Date.now() - started,
      table: ctx.tt
    };
  }

  function iterativeDeepening(adapter, opts) {
    opts = opts || {};
    var state = stateOf(adapter, opts);
    var maxDepth = opts.maxDepth !== undefined && opts.maxDepth !== null
      ? opts.maxDepth
      : (opts.depth !== undefined && opts.depth !== null ? opts.depth : 4);
    var ctx = makeContext(adapter, opts);
    var started = Date.now();

    var legal = adapter.legalMoves(state);
    if (!legal || legal.length === 0) {
      return {
        move: null, depth: 0, nodes: 0, score: 0, aborted: false,
        elapsedMs: Date.now() - started, table: ctx.tt
      };
    }

    var ordered = orderedMoves(adapter, state, legal, { ply: 0, depth: 0, hint: opts.hintMove });
    var best = ordered[0];
    var bestScore = -INF;
    var completed = 0;
    var d, res;

    for (d = 1; d <= maxDepth; d++) {
      res = rootSearch(adapter, state, d, ctx, best, undefined, opts.beta);
      if (ctx.aborted) break;
      if (res.move !== null) {
        best = res.move;
        bestScore = res.score;
        completed = d;
      }
      if (res.score >= ctx.winScore - ctx.earlyStopMargin) break;
    }

    return {
      move: best,
      depth: completed,
      nodes: ctx.nodes,
      score: bestScore,
      aborted: ctx.aborted,
      elapsedMs: Date.now() - started,
      table: ctx.tt
    };
  }

  return {
    INF: INF,
    TranspositionTable: TranspositionTable,
    negamax: negamax,
    iterativeDeepening: iterativeDeepening
  };
});
