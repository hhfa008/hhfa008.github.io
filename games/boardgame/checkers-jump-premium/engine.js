/* Chinese Checkers premium engine — 121-hole star board, 2/4/6 players,
   single steps, unrestricted chain jumps, AI and public state.
   Browser global: ChineseCheckersEngine. CommonJS: module.exports.
   Players are 0..5; empty holes are -1. A two-player game uses opposite
   zones 0 and 3, four-player 0/1/3/4, six-player all six. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChineseCheckersEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  var COORDS = [], KEY = {}, NEI = [], ZONES = [], DIST_BY_TARGET = [];
  var EMPTY = -1;
  var MATE = 100000;

  function rot(q, r) { return [-r, q + r]; }

  (function build() {
    var east = [], q, r, k, p, all = {};
    for (q = 5; q <= 8; q++) for (r = -4; r <= 4 - q; r++) east.push([q, r]);
    ZONES[0] = east;
    for (k = 1; k < 6; k++) ZONES[k] = ZONES[k - 1].map(function (c) { return rot(c[0], c[1]); });
    for (q = -4; q <= 4; q++) for (r = -4; r <= 4; r++) if (Math.abs(q + r) <= 4) all[q + ',' + r] = [q, r];
    ZONES.forEach(function (z) { z.forEach(function (c) { all[c[0] + ',' + c[1]] = [c[0], c[1]]; }); });
    Object.keys(all).forEach(function (key) {
      KEY[key] = COORDS.length;
      COORDS.push({ q: all[key][0], r: all[key][1] });
    });
    NEI = COORDS.map(function (c) {
      var out = [];
      DIRS.forEach(function (d) {
        var key = (c.q + d[0]) + ',' + (c.r + d[1]);
        if (KEY[key] != null) out.push(KEY[key]);
      });
      return out;
    });
    ZONES = ZONES.map(function (z) { return z.map(function (c) { return KEY[c[0] + ',' + c[1]]; }); });
    for (k = 0; k < 6; k++) {
      var d = new Array(COORDS.length).fill(999);
      var queue = ZONES[k].slice(), i;
      ZONES[k].forEach(function (x) { d[x] = 0; });
      for (i = 0; i < queue.length; i++) {
        var cur = queue[i];
        NEI[cur].forEach(function (n) {
          if (d[n] > d[cur] + 1) { d[n] = d[cur] + 1; queue.push(n); }
        });
      }
      DIST_BY_TARGET[k] = d;
    }
  })();

  function playerSet(count) {
    if (count === 2) return [0, 3];
    if (count === 3) return [0, 2, 4];
    if (count === 4) return [0, 1, 3, 4];
    return [0, 1, 2, 3, 4, 5];
  }

  function clone(s) {
    return {
      board: new Int8Array(s.board),
      turn: s.turn,
      active: s.active.slice(),
      n: s.n,
      startZone: s.startZone.slice(),
      history: s.history.slice(),
      over: s.over,
      winner: s.winner,
      moveNo: s.moveNo
    };
  }

  function emptyState(active, startZones) {
    active = active || [0, 1, 2, 3, 4, 5];
    startZones = startZones || active;
    var startZone = [0, 1, 2, 3, 4, 5];
    for (var i = 0; i < active.length; i++) startZone[active[i]] = startZones[i];
    return {
      board: new Int8Array(COORDS.length).fill(EMPTY),
      turn: active[0], active: active.slice(), n: active.length,
      startZone: startZone, history: [], over: false, winner: -1, moveNo: 1
    };
  }

  function setup(count) {
    var active = playerSet(count === 3 || count === 4 || count === 6 ? count : 2);
    var s = emptyState(active, active);
    s.active.forEach(function (p) {
      ZONES[s.startZone[p]].forEach(function (c) { s.board[c] = p; });
    });
    return s;
  }

  function createGame(count) { return setup(count || 2); }

  function targetZone(s, p) { return (s.startZone[p] + 3) % 6; }
  function distMap(s, p) { return DIST_BY_TARGET[targetZone(s, p)]; }

  function legalMovesFrom(s, from) {
    if (from < 0 || from >= s.board.length) return [];
    var p = s.board[from];
    if (p < 0) return [];
    var res = [], seen = {};
    NEI[from].forEach(function (n) {
      if (s.board[n] === EMPTY) { res.push({ from: from, to: n, path: [from, n], jump: false }); seen[n] = 1; }
    });
    var queue = [{ cell: from, path: [from] }], head = 0;
    while (head < queue.length) {
      var cur = queue[head++], c = COORDS[cur.cell];
      for (var d = 0; d < 6; d++) {
        var mkey = (c.q + DIRS[d][0]) + ',' + (c.r + DIRS[d][1]);
        var lkey = (c.q + 2 * DIRS[d][0]) + ',' + (c.r + 2 * DIRS[d][1]);
        if (KEY[mkey] == null || KEY[lkey] == null) continue;
        var mid = KEY[mkey], land = KEY[lkey];
        if (s.board[mid] === EMPTY || s.board[land] !== EMPTY) continue;
        if (seen[land]) continue;
        seen[land] = 1;
        var path = cur.path.concat([land]);
        res.push({ from: from, to: land, path: path, jump: true });
        queue.push({ cell: land, path: path });
      }
    }
    return res;
  }

  function legalMoves(s, p) {
    var out = [];
    for (var i = 0; i < s.board.length; i++) {
      if (s.board[i] === p) out = out.concat(legalMovesFrom(s, i));
    }
    return out;
  }

  function legalMovesForTurn(s) { return s.over ? [] : legalMoves(s, s.turn); }

  function nextTurn(s, p) {
    var i = s.active.indexOf(p);
    return s.active[(i + 1) % s.active.length];
  }

  function notation(m) {
    return 'H' + (m.from + 1) + (m.jump ? 'x' : '-') + m.path.slice(1).map(function (x) { return 'H' + (x + 1); }).join('x');
  }

  function findMove(s, payload) {
    if (!payload) return null;
    var moves = legalMoves(s, s.turn);
    for (var i = 0; i < moves.length; i++) {
      if (moves[i].from === payload.from && moves[i].to === payload.to) {
        if (Array.isArray(payload.path) && payload.path.length !== moves[i].path.length) continue;
        return moves[i];
      }
    }
    return null;
  }

  function applyMove(s, m) {
    if (!s || s.over) throw new Error('对局已结束');
    var canonical = findMove(s, m);
    if (!canonical) throw new Error('不符合规则的着法');
    var out = clone(s);
    var p = out.board[canonical.from];
    out.board[canonical.from] = EMPTY;
    out.board[canonical.to] = p;
    out.history.push({
      from: canonical.from, to: canonical.to, path: canonical.path.slice(),
      jump: !!canonical.jump, side: p, notation: notation(canonical), moveNo: s.moveNo
    });
    out.turn = nextTurn(out, out.turn);
    if (out.turn === out.active[0]) out.moveNo = s.moveNo + 1;
    var w = winner(out);
    if (w >= 0) { out.over = true; out.winner = w; out.reason = 'target'; }
    return out;
  }

  function winner(s) {
    for (var i = 0; i < s.active.length; i++) {
      var p = s.active[i], zone = ZONES[targetZone(s, p)];
      var ok = true;
      for (var j = 0; j < zone.length; j++) if (s.board[zone[j]] !== p) { ok = false; break; }
      if (ok) return p;
    }
    return -1;
  }

  function sumDist(s, p) {
    var d = distMap(s, p), total = 0;
    for (var i = 0; i < s.board.length; i++) if (s.board[i] === p) total += d[i];
    return total;
  }

  function evalFor(s, p) {
    var w = winner(s);
    if (w === p) return MATE;
    if (w >= 0) return -MATE;
    var mine = sumDist(s, p), theirs = 0, count = 0;
    s.active.forEach(function (q) { if (q !== p) { theirs += sumDist(s, q); count++; } });
    return theirs / Math.max(1, count) - mine;
  }

  function moveScore(s, m, p) {
    var d = distMap(s, p), tz = ZONES[targetZone(s, p)];
    var score = (d[m.from] - d[m.to]) * 10;
    if (m.jump) score += 2 + (m.path.length - 2) * 1.5;
    if (tz.indexOf(m.from) >= 0 && tz.indexOf(m.to) < 0) score -= 45;
    if (tz.indexOf(m.to) >= 0) score += 9;
    return score;
  }

  function search(s, p, depth, alpha, beta) {
    var w = winner(s);
    if (w === p) return MATE - depth;
    if (w >= 0) return -MATE + depth;
    if (depth <= 0) return evalFor(s, p);
    var moves = legalMoves(s, s.turn);
    if (!moves.length) return evalFor(s, p);
    var maximizing = s.turn === p;
    var best = maximizing ? -Infinity : Infinity;
    for (var i = 0; i < moves.length; i++) {
      var val = search(applyMove(s, moves[i]), p, depth - 1, alpha, beta);
      if (maximizing) {
        if (val > best) best = val;
        if (best > alpha) alpha = best;
      } else {
        if (val < best) best = val;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function aiMove(s, level, timeMs) {
    var p = s.turn, moves = legalMoves(s, p);
    if (!moves.length) return null;
    if (level <= 0) return moves[Math.floor(Math.random() * moves.length)];
    var scored = moves.map(function (m) { return { m: m, score: moveScore(s, m, p) + Math.random() * 0.3 }; });
    scored.sort(function (a, b) { return b.score - a.score; });
    if (level === 1) return scored[0].m;
    var depth = level >= 3 ? 2 : 1;
    var deadline = Date.now() + (timeMs || 300);
    var best = scored[0].m, bestVal = -Infinity;
    for (var i = 0; i < scored.length; i++) {
      if (Date.now() > deadline && i > 0) break;
      var val = search(applyMove(s, scored[i].m), p, depth, -Infinity, Infinity);
      val += moveScore(s, scored[i].m, p) * 0.01;
      if (val > bestVal) { bestVal = val; best = scored[i].m; }
    }
    return best;
  }

  function publicState(s, seatIndex) {
    var player = seatIndex != null && seatIndex < s.active.length ? s.active[seatIndex] : null;
    var view = {
      board: Array.from(s.board),
      turn: s.turn,
      turnSeat: s.active.indexOf(s.turn),
      active: s.active.slice(),
      n: s.n,
      startZone: s.startZone.slice(),
      targetZones: s.active.map(function (p) { return targetZone(s, p); }),
      moveNo: s.moveNo,
      history: s.history.map(function (h) {
        return { from: h.from, to: h.to, path: h.path.slice(), jump: h.jump, side: h.side, notation: h.notation };
      }),
      over: s.over,
      winner: s.winner,
      winnerSeat: s.over ? s.active.indexOf(s.winner) : null,
      reason: s.reason || '',
      lastMove: s.history.length ? s.history[s.history.length - 1] : null
    };
    if (player != null) {
      view.you = seatIndex;
      view.yourPlayer = player;
      view.canMove = !s.over && s.turn === player;
      view.legal = view.canMove ? legalMoves(s, player).map(function (m) {
        return { from: m.from, to: m.to, path: m.path.slice(), jump: !!m.jump, notation: notation(m) };
      }) : [];
    }
    return view;
  }

  function progress(s, p) {
    var zone = ZONES[targetZone(s, p)], n = 0;
    for (var i = 0; i < zone.length; i++) if (s.board[zone[i]] === p) n++;
    return n;
  }

  return {
    EMPTY: EMPTY, DIRS: DIRS, COORDS: COORDS, NEI: NEI, KEY: KEY, ZONES: ZONES,
    MATE: MATE, playerSet: playerSet,
    clone: clone, emptyState: emptyState, setup: setup, createGame: createGame,
    targetZone: targetZone, distMap: distMap,
    legalMovesFrom: legalMovesFrom, legalMoves: legalMoves, legalMovesForTurn: legalMovesForTurn,
    nextTurn: nextTurn, notation: notation, findMove: findMove, applyMove: applyMove,
    winner: winner, aiMove: aiMove, evalFor: evalFor, sumDist: sumDist,
    publicState: publicState, progress: progress,
    holeCount: COORDS.length
  };
});
