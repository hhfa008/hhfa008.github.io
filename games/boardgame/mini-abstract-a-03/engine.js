/* 六六四连 — pure UMD micro abstract engine (single-player vs seeded AI).
 * Browser: window.MiniEngine; Node: require('./engine.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CFG = {
  "slug": "mini-abstract-a-03",
  "name": "六六四连",
  "mode": "line",
  "size": 6,
  "k": 4,
  "dirs": 4
};
  var DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var DIRS8 = DIRS4.concat([[-1, -1], [-1, 1], [1, -1], [1, 1]]);

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) { return mulberry32((seed || 1) >>> 0); }
  function idx(r, c) { return r * CFG.size + c; }
  function rc(i) { return [Math.floor(i / CFG.size), i % CFG.size]; }
  function inB(r, c) { return r >= 0 && r < CFG.size && c >= 0 && c < CFG.size; }
  function dirs() { return CFG.dirs === 8 ? DIRS8 : DIRS4; }
  function other(p) { return p === 0 ? 1 : 0; }

  function countOf(board, p) {
    var n = 0;
    for (var i = 0; i < board.length; i++) if (board[i] === p) n++;
    return n;
  }

  function lineThrough(board, p, i, k, ds) {
    if (board[i] !== p) return false;
    ds = ds || dirs();
    var r = rc(i)[0], c = rc(i)[1];
    for (var d = 0; d < ds.length; d++) {
      var len = 1;
      for (var s = 1; s < k; s++) {
        var rr = r + ds[d][0] * s, cc = c + ds[d][1] * s;
        if (!inB(rr, cc) || board[idx(rr, cc)] !== p) break;
        len++;
      }
      for (var s2 = 1; s2 < k; s2++) {
        var rr2 = r - ds[d][0] * s2, cc2 = c - ds[d][1] * s2;
        if (!inB(rr2, cc2) || board[idx(rr2, cc2)] !== p) break;
        len++;
      }
      if (len >= k) return true;
    }
    return false;
  }

  function anyLine(board, p, k, ds) {
    for (var i = 0; i < board.length; i++) {
      if (board[i] === p && lineThrough(board, p, i, k, ds)) return true;
    }
    return false;
  }

  // ---------- Othello-style flanking ----------
  function flipCaptures(board, i, p) {
    var out = [], ds = DIRS8, r = rc(i)[0], c = rc(i)[1];
    for (var d = 0; d < ds.length; d++) {
      var run = [], rr = r + ds[d][0], cc = c + ds[d][1];
      while (inB(rr, cc) && board[idx(rr, cc)] === other(p)) {
        run.push(idx(rr, cc)); rr += ds[d][0]; cc += ds[d][1];
      }
      if (run.length && inB(rr, cc) && board[idx(rr, cc)] === p) out = out.concat(run);
    }
    return out;
  }

  function initFlip(g) {
    var n = CFG.size, b = g.board;
    if (CFG.initial === 'diag' && n % 2 === 1) {
      var c = (n - 1) / 2;
      b[idx(c, c)] = 0; b[idx(c - 1, c - 1)] = 1;
      b[idx(c - 1, c)] = 0; b[idx(c, c - 1)] = 1;
    } else {
      var m = Math.floor(n / 2);
      b[idx(m - 1, m - 1)] = 1; b[idx(m, m)] = 1;
      b[idx(m - 1, m)] = 0; b[idx(m, m - 1)] = 0;
    }
  }

  // ---------- duel (capture by stepping) ----------
  function initDuel(g) {
    var n = CFG.size, b = g.board, pieces = CFG.pieces || 2, cols;
    if (pieces >= 3) cols = [0, Math.floor((n - 1) / 2), n - 1];
    else cols = n >= 4 ? [1, n - 2] : [0, n - 1];
    for (var i = 0; i < cols.length; i++) {
      b[idx(n - 1, cols[i])] = 0;
      b[idx(0, cols[i])] = 1;
    }
  }

  function createGame(opts) {
    opts = opts || {};
    var n = CFG.size;
    var g = {
      cfg: CFG, size: n, board: new Array(n * n).fill(-1),
      turn: 0, moves: 0, over: false, result: null,
      seed: opts.seed || 1, last: null, msg: '', truncated: false
    };
    if (CFG.mode === 'flip') initFlip(g);
    if (CFG.mode === 'duel') initDuel(g);
    return g;
  }

  // ---------- Go-style capture ----------
  function collectGroup(board, start) {
    var p = board[start], seen = {}, stack = [start], cells = [], liberties = 0;
    seen[start] = true;
    while (stack.length) {
      var i = stack.pop(); cells.push(i);
      var r = rc(i)[0], c = rc(i)[1];
      for (var d = 0; d < 4; d++) {
        var rr = r + DIRS4[d][0], cc = c + DIRS4[d][1];
        if (!inB(rr, cc)) continue;
        var j = idx(rr, cc);
        if (board[j] === -1) liberties++;
        else if (board[j] === p && !seen[j]) { seen[j] = true; stack.push(j); }
      }
    }
    return { cells: cells, liberties: liberties, color: p };
  }

  function goSimulate(board, i, p) {
    var b = board.slice(), enemy = other(p), dead = [], seen = {};
    b[i] = p;
    var r = rc(i)[0], c = rc(i)[1];
    for (var d = 0; d < 4; d++) {
      var rr = r + DIRS4[d][0], cc = c + DIRS4[d][1];
      if (!inB(rr, cc)) continue;
      var j = idx(rr, cc);
      if (b[j] !== enemy || seen[j]) continue;
      var grp = collectGroup(b, j);
      grp.cells.forEach(function (x) { seen[x] = true; });
      if (grp.liberties === 0) dead = dead.concat(grp.cells);
    }
    if (CFG.capture === 'single') {
      var single = [];
      var seen2 = {};
      dead.forEach(function (j) { seen2[j] = true; });
      dead = dead.filter(function (j) {
        // keep only stones whose own group has size 1
        var g2 = collectGroup(b, j);
        return g2.cells.length === 1;
      });
    }
    dead.forEach(function (j) { b[j] = -1; });
    var own = collectGroup(b, i);
    if (own.liberties === 0) return null;
    return { board: b, captured: dead };
  }

  // ---------- mill helpers ----------
  function pickRemove(board, opp) {
    var best = -1, bestScore = -1, n = CFG.size;
    for (var i = 0; i < board.length; i++) {
      if (board[i] !== opp) continue;
      var r = rc(i)[0], c = rc(i)[1], sc = 0;
      for (var d = 0; d < DIRS4.length; d++) {
        var run = 1;
        for (var s = 1; s < 3; s++) {
          var rr = r + DIRS4[d][0] * s, cc = c + DIRS4[d][1] * s;
          if (!inB(rr, cc) || board[idx(rr, cc)] !== opp) break;
          run++;
        }
        sc += run * 10;
      }
      sc += (Math.abs(r - (n - 1) / 2) + Math.abs(c - (n - 1) / 2)) * -1;
      if (sc > bestScore || (sc === bestScore && (best < 0 || i < best))) { best = i; bestScore = sc; }
    }
    return best;
  }

  // ---------- legal moves ----------
  function legalDuel(g, p) {
    var out = [], ds = dirs(), n = CFG.size;
    for (var i = 0; i < g.board.length; i++) {
      if (g.board[i] !== p) continue;
      var r = rc(i)[0], c = rc(i)[1];
      for (var d = 0; d < ds.length; d++) {
        var rr = r + ds[d][0], cc = c + ds[d][1];
        if (!inB(rr, cc)) continue;
        var j = idx(rr, cc);
        if (g.board[j] !== p) out.push({ from: i, to: j });
      }
    }
    return out;
  }

  function legalMoves(g, p) {
    if (g.over) return [];
    if (p == null) p = g.turn;
    if (CFG.mode === 'duel') return legalDuel(g, p);
    var out = [], i, sim;
    for (i = 0; i < g.board.length; i++) {
      if (g.board[i] !== -1) continue;
      if (CFG.mode === 'flip' && flipCaptures(g.board, i, p).length === 0) continue;
      if (CFG.mode === 'go') {
        sim = goSimulate(g.board, i, p);
        if (!sim) continue;
      }
      out.push(i);
    }
    return out;
  }

  // ---------- scoring ----------
  function quadrantScore(board, p) {
    var n = CFG.size, mid = Math.floor(n / 2), sc = 0;
    for (var qr = 0; qr < 2; qr++) {
      for (var qc = 0; qc < 2; qc++) {
        var mine = 0, opp = 0, cells = 0;
        for (var r = qr === 0 ? 0 : mid; r < (qr === 0 ? mid : n); r++) {
          for (var c = qc === 0 ? 0 : mid; c < (qc === 0 ? mid : n); c++) {
            cells++;
            if (board[idx(r, c)] === p) mine++;
            else if (board[idx(r, c)] === other(p)) opp++;
          }
        }
        if (mine > opp) sc += cells;
      }
    }
    return sc;
  }

  function territoryScore(board, p) {
    var n = CFG.size, sc = 0, cr = (n - 1) / 2, i, r, c;
    if (CFG.score === 'center') {
      for (i = 0; i < board.length; i++) {
        if (board[i] !== p) continue;
        r = rc(i)[0]; c = rc(i)[1];
        sc += 2 * (n - Math.max(Math.abs(r - cr), Math.abs(c - cr)));
      }
    } else if (CFG.score === 'quad') {
      sc = quadrantScore(board, p);
    } else {
      for (i = 0; i < board.length; i++) {
        if (board[i] !== p) continue;
        sc += 10;
        r = rc(i)[0]; c = rc(i)[1];
        for (var d = 0; d < DIRS4.length; d++) {
          var rr = r + DIRS4[d][0], cc = c + DIRS4[d][1];
          if (inB(rr, cc) && board[idx(rr, cc)] === p) sc += 3;
        }
      }
    }
    return sc;
  }

  function decideByCount(g) {
    var a = countOf(g.board, 0), b = countOf(g.board, 1);
    return a > b ? 0 : (a < b ? 1 : 'draw');
  }
  function decideTerritory(g) {
    var a = territoryScore(g.board, 0), b = territoryScore(g.board, 1);
    return a > b ? 0 : (a < b ? 1 : 'draw');
  }
  function finish(g, res) {
    g.over = true;
    g.result = res;
    return g;
  }

  function applyMove(g, mv) {
    if (!g || g.over) throw new Error('对局已结束');
    var p = g.turn;

    if (CFG.mode === 'duel') {
      if (!mv || typeof mv !== 'object') throw new Error('非法走法');
      var legal = legalDuel(g, p), found = false;
      for (var q = 0; q < legal.length; q++) {
        if (legal[q].from === mv.from && legal[q].to === mv.to) { found = true; break; }
      }
      if (!found) throw new Error('非法走法');
      var captured = g.board[mv.to] === other(p);
      g.board[mv.from] = -1;
      g.board[mv.to] = p;
      g.moves++; g.last = { from: mv.from, to: mv.to };
      if (captured) g.msg = '吃子！';
      if (captured && countOf(g.board, other(p)) === 0) return finish(g, p);
      g.turn = other(p);
      if (g.moves >= (CFG.maxMoves || 160)) return finish(g, decideByCount(g));
      return g;
    }

    if (typeof mv !== 'number' || legalMoves(g, p).indexOf(mv) < 0) throw new Error('非法落子');

    if (CFG.mode === 'flip') {
      var flips = flipCaptures(g.board, mv, p);
      g.board[mv] = p;
      for (var f = 0; f < flips.length; f++) g.board[flips[f]] = p;
      g.moves++; g.last = mv;
      g.msg = flips.length ? ('翻转 ' + flips.length + ' 子') : '';
      g.turn = other(p);
      if (countOf(g.board, -1) === 0 || legalMoves(g, g.turn).length === 0) {
        return finish(g, decideByCount(g));
      }
      return g;
    }

    g.board[mv] = p;
    g.moves++; g.last = mv;

    if (CFG.mode === 'line') {
      if (lineThrough(g.board, p, mv, CFG.k)) return finish(g, p);
      if (countOf(g.board, -1) === 0) return finish(g, 'draw');
      g.turn = other(p);
      return g;
    }

    if (CFG.mode === 'mill') {
      if (lineThrough(g.board, p, mv, 3)) {
        var removed = 0, removePer = CFG.removePer || 1;
        for (var k = 0; k < removePer; k++) {
          var victim = pickRemove(g.board, other(p));
          if (victim < 0) break;
          g.board[victim] = -1; removed++;
        }
        if (removed) g.msg = '三连！吃掉 ' + removed + ' 子';
      }
      if (g.moves >= 2 * (CFG.stonesPer || 4) || countOf(g.board, -1) === 0) {
        return finish(g, decideByCount(g));
      }
      g.turn = other(p);
      return g;
    }

    if (CFG.mode === 'go') {
      var sim = goSimulate(g.board, mv, p);
      if (!sim) throw new Error('非法落子');
      g.board = sim.board;
      if (sim.captured.length) g.msg = '围吃 ' + sim.captured.length + ' 子';
      if (countOf(g.board, -1) === 0) return finish(g, decideByCount(g));
      g.turn = other(p);
      return g;
    }

    if (CFG.mode === 'territory') {
      if (countOf(g.board, -1) === 0) return finish(g, decideTerritory(g));
      g.turn = other(p);
      return g;
    }

    throw new Error('未知模式');
  }

  // ---------- AI ----------
  function windowScore(board, p, k, ds) {
    var n = CFG.size, sc = 0;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        for (var d = 0; d < ds.length; d++) {
          var mine = 0, opp = 0, ok = true;
          for (var s = 0; s < k; s++) {
            var rr = r + ds[d][0] * s, cc = c + ds[d][1] * s;
            if (!inB(rr, cc)) { ok = false; break; }
            var v = board[idx(rr, cc)];
            if (v === p) mine++;
            else if (v === other(p)) opp++;
          }
          if (!ok || opp > 0 || mine === 0) continue;
          sc += Math.pow(6, mine);
        }
      }
    }
    return sc;
  }

  function evalPlacement(g, mv, p) {
    var board = g.board, b = board.slice(), n = CFG.size;
    if (CFG.mode === 'line') {
      if (lineThrough(b, p, mv, CFG.k)) return 1e12;
      b[mv] = p;
      var mine = windowScore(b, p, CFG.k, dirs());
      var opp = windowScore(b, other(p), CFG.k, dirs());
      var r = rc(mv)[0], c = rc(mv)[1];
      return mine - 1.12 * opp + (n - Math.abs(r - (n - 1) / 2) - Math.abs(c - (n - 1) / 2)) * 0.2;
    }
    if (CFG.mode === 'flip') {
      var flips = flipCaptures(board, mv, p).length;
      b[mv] = p;
      for (var f = 0; f < flips; f++) b[flipCaptures(board, mv, p)[f]] = p;
      var diff = countOf(b, p) - countOf(b, other(p));
      var rr = rc(mv)[0], cc = rc(mv)[1];
      var corner = (rr === 0 || rr === n - 1) && (cc === 0 || cc === n - 1) ? 30 : 0;
      return flips * 45 + diff * 4 + corner;
    }
    if (CFG.mode === 'mill') {
      b[mv] = p;
      var made = lineThrough(b, p, mv, 3) ? 400 : 0;
      var pot = 0, ds = DIRS4;
      for (var d = 0; d < ds.length; d++) {
        var cnt = 0;
        for (var s = -1; s <= 1; s++) {
          var r2 = rc(mv)[0] + ds[d][0] * s, c2 = rc(mv)[1] + ds[d][1] * s;
          if (inB(r2, c2) && b[idx(r2, c2)] === p) cnt++;
        }
        pot += cnt * cnt * 3;
      }
      return made + pot - windowScore(b, other(p), 3, DIRS4) * 0.25;
    }
    if (CFG.mode === 'go') {
      var sim = goSimulate(board, mv, p);
      if (!sim) return -1e9;
      var cap = sim.captured.length;
      var own = collectGroup(sim.board, mv);
      var radj = 0;
      var r3 = rc(mv)[0], c3 = rc(mv)[1];
      for (var d3 = 0; d3 < DIRS4.length; d3++) {
        var r4 = r3 + DIRS4[d3][0], c4 = c3 + DIRS4[d3][1];
        if (inB(r4, c4)) {
          if (sim.board[idx(r4, c4)] === p) radj += 2;
          else if (sim.board[idx(r4, c4)] === other(p)) radj -= 1;
        }
      }
      return cap * 150 + own.liberties * 3 + radj;
    }
    if (CFG.mode === 'territory') {
      b[mv] = p;
      return territoryScore(b, p) - 1.04 * territoryScore(b, other(p));
    }
    return 0;
  }

  function evalDuel(g, mv, p) {
    var b = g.board.slice(), n = CFG.size;
    var captured = b[mv.to] === other(p);
    b[mv.from] = -1; b[mv.to] = p;
    if (captured && countOf(b, other(p)) === 0) return 1e9;
    var score = captured ? 1000 : 0;
    if (countOf(b, other(p)) === 1) score += 60;
    // opponent retaliation on their turn
    var ds = dirs(), risk = 0;
    for (var i = 0; i < b.length; i++) {
      if (b[i] !== other(p)) continue;
      var r = rc(i)[0], c = rc(i)[1];
      for (var d = 0; d < ds.length; d++) {
        var rr = r + ds[d][0], cc = c + ds[d][1];
        if (inB(rr, cc) && b[idx(rr, cc)] === p) risk++;
      }
    }
    score -= risk * 95;
    // advance toward enemy home row and stay central
    var target = p === 0 ? 0 : n - 1;
    for (var j = 0; j < b.length; j++) {
      if (b[j] !== p) continue;
      var rj = rc(j)[0], cj = rc(j)[1];
      score -= Math.abs(rj - target) * 1.2;
      score -= (Math.abs(cj - (n - 1) / 2)) * 0.5;
    }
    return score;
  }

  function aiMove(g) {
    var p = g.turn, moves = legalMoves(g, p), rng = makeRng(g.seed * 7919 + g.moves * 131 + 17);
    if (!moves.length) return null;
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var sc = CFG.mode === 'duel' ? evalDuel(g, moves[i], p) : evalPlacement(g, moves[i], p);
      if (sc < -1e8) continue;
      sc += rng() * 0.4;
      if (sc > bestScore) { bestScore = sc; best = moves[i]; }
    }
    return best === null ? moves[0] : best;
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0, cap = 400 + CFG.size * CFG.size * 6;
    while (!g.over && guard++ < cap) {
      var mv = aiMove(g);
      if (mv === null) { finish(g, decideByCount(g)); break; }
      applyMove(g, mv);
    }
    if (!g.over) { g.truncated = true; finish(g, decideByCount(g)); }
    return { winner: g.result, moves: g.moves, truncated: g.truncated, game: g };
  }

  function winnerOf(g) { return g.over ? g.result : null; }
  function score(g) {
    if (CFG.mode === 'territory') return { 0: territoryScore(g.board, 0), 1: territoryScore(g.board, 1) };
    return { 0: countOf(g.board, 0), 1: countOf(g.board, 1) };
  }

  return {
    CFG: CFG, createGame: createGame, legalMoves: legalMoves, applyMove: applyMove,
    aiMove: aiMove, selfPlay: selfPlay, winnerOf: winnerOf, score: score,
    countOf: countOf, idx: idx, rc: rc, flipCaptures: flipCaptures,
    lineThrough: lineThrough, anyLine: anyLine, territoryScore: territoryScore,
    goSimulate: goSimulate, collectGroup: collectGroup
  };
});
