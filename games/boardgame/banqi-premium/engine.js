/* Banqi (暗棋 / 翻棋) — premium UMD rules engine.
 *
 * Node:    const E = require('./engine.js');
 * Browser: window.BanqiPremiumEngine
 *
 * Official rules implemented:
 *  - 4×8 board, all 32 Chinese-chess pieces dealt face down.
 *  - On your turn you either flip any one hidden piece, or move one of your
 *    revealed pieces one orthogonal step (or a cannon jump).
 *  - Rank order: 帥/將 K > 仕/士 A > 相/象 B > 車 R > 馬 N > 炮/砲 C > 兵/卒 P.
 *  - A piece captures a revealed enemy of strictly lower rank. Equal rank and
 *    lower-to-higher are illegal. 兵/卒 is the single exception: it may capture
 *    帥/將.
 *  - A cannon never captures by adjacency: it must jump exactly one piece
 *    (own or enemy, revealed or hidden) and capture the first revealed enemy
 *    behind that screen.
 *  - Hidden pieces are neutral until flipped; they block movement and cannot
 *    be captured. A flip reveals the piece to its own colour, not the flipper.
 *  - A side with no pieces left loses. A side with no legal action loses.
 *    120 plies without a capture is a draw.
 *
 * The deal uses games/shared/shuffle.js (seeded Fisher–Yates), never Math.random.
 * The engine is deterministic and serialisable so the server can own the state.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.BanqiPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('BanqiPremiumEngine requires games/shared/shuffle.js');
  }

  var RED = 1, BLACK = -1;
  var COLS = 8, ROWS = 4, N = COLS * ROWS;
  var RANK = { K: 7, A: 6, B: 5, R: 4, N: 3, C: 2, P: 1 };
  var VALUE = { K: 10, A: 5, B: 4.5, R: 6, N: 4, C: 3.5, P: 2 };
  var TYPES = ['K', 'A', 'B', 'R', 'N', 'C', 'P'];
  var COUNTS = { K: 1, A: 2, B: 2, R: 2, N: 2, C: 2, P: 5 };
  var GLYPH = {
    '1': { K: '帥', A: '仕', B: '相', R: '車', N: '馬', C: '炮', P: '兵' },
    '-1': { K: '將', A: '士', B: '象', R: '車', N: '馬', C: '砲', P: '卒' }
  };
  var NAME = {
    '1': { K: '红帥', A: '红仕', B: '红相', R: '红車', N: '红馬', C: '红炮', P: '红兵' },
    '-1': { K: '黑將', A: '黑士', B: '黑象', R: '黑車', N: '黑馬', C: '黑砲', P: '黑卒' }
  };
  var DEFAULT_NAMES = ['红方', '黑方'];
  var MAX_PLIES = 4000;
  var DRAW_PLIES = 120;

  var NEI = (function () {
    var out = [], r, c, a;
    for (r = 0; r < ROWS; r++) for (c = 0; c < COLS; c++) {
      a = [];
      if (r > 0) a.push((r - 1) * COLS + c);
      if (r < ROWS - 1) a.push((r + 1) * COLS + c);
      if (c > 0) a.push(r * COLS + c - 1);
      if (c < COLS - 1) a.push(r * COLS + c + 1);
      out.push(a);
    }
    return out;
  })();

  function idx(r, c) { return r * COLS + c; }
  function rowOf(i) { return Math.floor(i / COLS); }
  function colOf(i) { return i % COLS; }
  function mk(s, t, h) { return { s: s, t: t, h: h ? 1 : 0 }; }
  function sideName(s) { return s === RED ? '红方' : '黑方'; }
  function glyphOf(piece) { return piece ? (GLYPH[String(piece.s)] || {})[piece.t] || '?' : ''; }
  function pieceName(piece) { return piece ? (NAME[String(piece.s)] || {})[piece.t] || '?' : '空'; }

  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    var v = ((t ^ t >>> 14) >>> 0) / 4294967296;
    return v;
  }

  function fullPieceList() {
    var list = [];
    [RED, BLACK].forEach(function (side) {
      TYPES.forEach(function (type) {
        for (var k = 0; k < COUNTS[type]; k++) list.push({ s: side, t: type });
      });
    });
    return list;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var names = opts.names || DEFAULT_NAMES;
    var list = ShuffleApi.shuffle(fullPieceList(), { seed: seed });
    var cells = list.map(function (p) { return mk(p.s, p.t, 1); });
    var state = {
      version: 1,
      seed: seed,
      rngState: (seed | 0) || 1,
      cells: cells,
      turn: RED,
      phase: 'playing',
      winner: 0,
      winnerIds: [],
      reason: '',
      noProgress: 0,
      plies: 0,
      flips: 0,
      captures: 0,
      players: [
        { side: RED, name: names[0] || '红方', human: true },
        { side: BLACK, name: names[1] || '黑方', human: true }
      ],
      log: [],
      events: []
    };
    log(state, '32 枚棋子全部扣放，红方先行');
    emit(state, { type: 'start', turn: RED, hidden: 32 });
    return state;
  }

  function empty(turn) {
    var cells = [];
    for (var i = 0; i < N; i++) cells.push(null);
    return {
      version: 1, seed: 0, rngState: 1, cells: cells,
      turn: turn || RED, phase: 'playing', winner: 0, winnerIds: [], reason: '',
      noProgress: 0, plies: 0, flips: 0, captures: 0,
      players: [{ side: RED, name: '红方', human: true }, { side: BLACK, name: '黑方', human: true }],
      log: [], events: []
    };
  }

  function clone(state) {
    return {
      version: state.version,
      seed: state.seed,
      rngState: state.rngState,
      cells: state.cells.map(function (c) { return c ? { s: c.s, t: c.t, h: c.h } : null; }),
      turn: state.turn,
      phase: state.phase,
      winner: state.winner,
      winnerIds: state.winnerIds.slice(),
      reason: state.reason,
      noProgress: state.noProgress,
      plies: state.plies,
      flips: state.flips,
      captures: state.captures,
      players: state.players.map(function (p) { return { side: p.side, name: p.name, human: p.human }; }),
      log: state.log.slice(),
      events: state.events.slice()
    };
  }

  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 80) state.log.shift();
  }
  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 100) state.events.shift();
  }

  function count(state, side) {
    var n = 0;
    for (var i = 0; i < N; i++) if (state.cells[i] && state.cells[i].s === side) n++;
    return n;
  }
  function visibleCount(state, side) {
    var n = 0;
    for (var i = 0; i < N; i++) {
      if (state.cells[i] && state.cells[i].s === side && !state.cells[i].h) n++;
    }
    return n;
  }
  function hiddenCount(state) {
    var n = 0;
    for (var i = 0; i < N; i++) if (state.cells[i] && state.cells[i].h) n++;
    return n;
  }
  function countType(state, side, type) {
    var n = 0;
    for (var i = 0; i < N; i++) {
      if (state.cells[i] && state.cells[i].s === side && state.cells[i].t === type) n++;
    }
    return n;
  }

  function canCapture(att, def) {
    if (!att || !def || def.h || att.h || att.s === def.s) return false;
    if (att.t === 'C') return false;
    if (att.t === 'P' && def.t === 'K') return true;
    return RANK[att.t] > RANK[def.t];
  }

  function cannonTargets(state, from) {
    var out = [], cell = state.cells[from], r = rowOf(from), c = colOf(from);
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var d = 0; d < 4; d++) {
      var seen = 0;
      var rr = r + dirs[d][0], cc = c + dirs[d][1];
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS) {
        var j = idx(rr, cc);
        if (state.cells[j]) {
          if (seen === 0) {
            seen = 1;
          } else {
            var target = state.cells[j];
            if (!target.h && target.s !== cell.s) out.push(j);
            break;
          }
        }
        rr += dirs[d][0]; cc += dirs[d][1];
      }
    }
    return out;
  }

  function movesFor(state, from) {
    var cell = state.cells[from], out = [];
    if (!cell || cell.h || cell.s !== state.turn) return out;
    var nei = NEI[from];
    for (var i = 0; i < nei.length; i++) {
      var j = nei[i], t = state.cells[j];
      if (!t) out.push(j);
      else if (canCapture(cell, t)) out.push(j);
    }
    if (cell.t === 'C') {
      var ct = cannonTargets(state, from);
      for (var k = 0; k < ct.length; k++) if (out.indexOf(ct[k]) < 0) out.push(ct[k]);
    }
    return out;
  }

  function legalActions(state) {
    var out = [];
    if (!state || state.phase !== 'playing' || !state.cells) return out;
    for (var i = 0; i < N; i++) {
      if (state.cells[i] && state.cells[i].h) out.push({ k: 'flip', to: i });
    }
    for (var j = 0; j < N; j++) {
      var c = state.cells[j];
      if (!c || c.h || c.s !== state.turn) continue;
      var ms = movesFor(state, j);
      for (var m = 0; m < ms.length; m++) out.push({ k: 'move', from: j, to: ms[m] });
    }
    return out;
  }

  function legalActionsForSeat(state, side) {
    if (!state || state.phase !== 'playing' || state.turn !== side) return [];
    return legalActions(state);
  }

  function isLegal(state, action) {
    if (!action) return false;
    if (state.phase !== 'playing') return false;
    if (action.k === 'flip') {
      var c = state.cells[action.to];
      return !!c && !!c.h;
    }
    if (action.k === 'move') return movesFor(state, action.from).indexOf(action.to) >= 0;
    return false;
  }

  // Mutates the authoritative state. Returns { ok, error?, capture?, over? }.
  function applyAction(state, action) {
    if (!isLegal(state, action)) {
      return { ok: false, error: 'illegal action', code: 'E_MOVE' };
    }
    var result = { ok: true };
    if (action.k === 'flip') {
      var piece = state.cells[action.to];
      piece.h = 0;
      state.noProgress = 0;
      state.flips += 1;
      result.flip = { to: action.to, side: piece.s, type: piece.t, name: pieceName(piece) };
      log(state, sideName(state.turn) + ' 翻开 ' + pieceName(piece));
      emit(state, { type: 'flip', to: action.to, side: piece.s, piece: piece.t, turn: state.turn });
    } else {
      var target = state.cells[action.to];
      var mover = state.cells[action.from];
      if (target) {
        state.noProgress = 0;
        state.captures += 1;
        result.capture = {
          from: action.from, to: action.to,
          side: mover.s, type: mover.t, name: pieceName(mover),
          target: { side: target.s, type: target.t, name: pieceName(target) }
        };
        log(state, pieceName(mover) + ' 吃掉 ' + pieceName(target));
        emit(state, { type: 'capture', from: action.from, to: action.to, by: mover.s, piece: mover.t, target: target.t });
      } else {
        state.noProgress += 1;
        log(state, pieceName(mover) + ' 移动到 ' + (rowOf(action.to) + 1) + ' 行 ' + (colOf(action.to) + 1) + ' 列');
        emit(state, { type: 'move', from: action.from, to: action.to, side: mover.s });
      }
      state.cells[action.to] = mover;
      state.cells[action.from] = null;
    }
    state.plies += 1;
    state.turn = -state.turn;
    if (state.plies > MAX_PLIES) {
      result.ok = false;
      result.error = 'ply limit reached';
      result.code = 'E_LIMIT';
      finish(state, 0, 'draw');
      result.over = true;
      return result;
    }
    var st = status(state);
    if (st.over) {
      finish(state, st.winner, st.reason);
      result.over = true;
      result.winner = st.winner;
    }
    return result;
  }

  function status(state) {
    var red = count(state, RED), black = count(state, BLACK);
    if (red === 0 && black === 0) return { over: true, winner: 0, reason: 'all' };
    if (red === 0) return { over: true, winner: BLACK, reason: 'all' };
    if (black === 0) return { over: true, winner: RED, reason: 'all' };
    if (state.noProgress >= DRAW_PLIES) return { over: true, winner: 0, reason: 'draw' };
    if (legalActions(state).length === 0) return { over: true, winner: -state.turn, reason: 'stuck' };
    return { over: false, winner: 0, reason: '' };
  }

  function finish(state, winner, reason) {
    state.phase = 'over';
    state.winner = winner;
    state.winnerIds = winner === 0 ? [] : [winner];
    state.reason = reason || '';
    var text = winner === 0 ? '和棋' : sideName(winner) + ' 获胜';
    log(state, '对局结束：' + text);
    emit(state, { type: 'over', winner: winner, reason: state.reason });
  }

  function evaluate(state, side) {
    var score = 0, my = 0, opp = 0;
    for (var i = 0; i < N; i++) {
      var c = state.cells[i];
      if (!c || c.h) continue;
      if (c.s === side) { score += VALUE[c.t]; my++; }
      else { score -= VALUE[c.t]; opp++; }
    }
    // Material plus revealed mobility; hidden pieces are counted as tempo.
    var mobility = legalActions(state).length * (state.turn === side ? 0.035 : -0.035);
    return score + (my - opp) * 0.7 + mobility;
  }

  function actionScore(state, action, rng, level) {
    var next = clone(state);
    var res = applyAction(next, action);
    if (!res.ok) return -1e9;
    var base = evaluate(next, state.turn) + next.plies * 0.001;
    if (level >= 3) {
      // One-ply reply: prefer actions that do not hand the opponent a big
      // material shot. This is intentionally shallow so a turn stays < 30ms.
      var replies = legalActions(next);
      var worst = 0;
      for (var i = 0; i < replies.length; i++) {
        var reply = clone(next);
        applyAction(reply, replies[i]);
        var delta = evaluate(reply, state.turn) - evaluate(next, state.turn);
        if (delta < worst) worst = delta;
      }
      base += worst * 0.55;
    }
    return base + rng * 0.05;
  }

  function aiAction(state, level, rng) {
    var acts = legalActions(state);
    if (!acts.length) return null;
    level = level || 2;
    rng = typeof rng === 'function' ? rng : function () { return nextRandom(state); };
    if (level <= 1) return acts[Math.floor(rng() * acts.length)];
    var best = null, bestValue = -Infinity;
    var deadline = Date.now() + 180;
    for (var i = 0; i < acts.length; i++) {
      var v = actionScore(state, acts[i], rng(), level);
      if (v > bestValue) { bestValue = v; best = acts[i]; }
      if (i > 6 && Date.now() > deadline) break;
    }
    return best || acts[0];
  }

  function aiAct(state, level, rng) {
    var action = aiAction(state, level, rng);
    if (!action) return null;
    var res = applyAction(state, action);
    return res.ok ? action : null;
  }

  function step(state, level) {
    if (state.phase === 'over') return { over: true };
    var action = aiAction(state, level || 2);
    if (!action) {
      var st = status(state);
      finish(state, st.winner, st.reason);
      return { over: true };
    }
    return applyAction(state, action);
  }

  function selfPlay(seed, level) {
    var state = createGame({ seed: seed == null ? 20261110 : seed, names: ['AI-红', 'AI-黑'] });
    var guard = 0;
    while (state.phase === 'playing') {
      if (++guard > MAX_PLIES + 10) throw new Error('banqi selfPlay did not finish');
      aiAct(state, level || 2, function () { return nextRandom(state); });
    }
    return state;
  }

  // Server-safe view. Hidden identities never leave the authoritative state.
  function publicView(state, viewerSide) {
    var viewer = viewerSide === null || viewerSide === undefined ? RED : viewerSide;
    return {
      phase: state.phase,
      turn: state.turn,
      turnSide: state.turn,
      viewerSide: viewer,
      viewerTurn: state.phase === 'playing' && state.turn === viewer,
      cells: state.cells.map(function (c) {
        if (!c) return null;
        if (c.h) return { h: 1, s: 0, t: null };
        return { h: 0, s: c.s, t: c.t };
      }),
      counts: {
        red: count(state, RED), black: count(state, BLACK),
        hidden: hiddenCount(state),
        redVisible: visibleCount(state, RED), blackVisible: visibleCount(state, BLACK),
        redCaptured: 16 - count(state, RED), blackCaptured: 16 - count(state, BLACK)
      },
      players: state.players.map(function (p) {
        return {
          side: p.side, name: p.name, human: p.human,
          pieces: count(state, p.side), captured: 16 - count(state, p.side),
          visible: visibleCount(state, p.side)
        };
      }),
      noProgress: state.noProgress,
      drawAt: DRAW_PLIES,
      plies: state.plies,
      flips: state.flips,
      captures: state.captures,
      winner: state.winner,
      winnerSide: state.winner,
      winnerIds: state.winnerIds.slice(),
      reason: state.reason,
      log: state.log.slice()
    };
  }

  return {
    RED: RED, BLACK: BLACK, COLS: COLS, ROWS: ROWS, N: N,
    RANK: RANK, VALUE: VALUE, TYPES: TYPES, COUNTS: COUNTS,
    GLYPH: GLYPH, NAME: NAME, NEI: NEI, DRAW_PLIES: DRAW_PLIES, MAX_PLIES: MAX_PLIES,
    DEFAULT_NAMES: DEFAULT_NAMES,
    idx: idx, rowOf: rowOf, colOf: colOf, mk: mk,
    sideName: sideName, glyphOf: glyphOf, pieceName: pieceName,
    createGame: createGame, empty: empty, clone: clone,
    count: count, countType: countType, visibleCount: visibleCount, hiddenCount: hiddenCount,
    canCapture: canCapture, cannonTargets: cannonTargets, movesFor: movesFor,
    legalActions: legalActions, legalActionsForSeat: legalActionsForSeat,
    isLegal: isLegal, applyAction: applyAction, status: status, finish: finish,
    evaluate: evaluate, aiAction: aiAction, aiAct: aiAct, step: step, selfPlay: selfPlay,
    publicView: publicView, nextRandom: nextRandom, fullPieceList: fullPieceList,
    log: log, emit: emit
  };
});
