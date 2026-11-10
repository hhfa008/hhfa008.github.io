/* Backgammon / 双陆棋 — premium UMD rules engine.
 * Node: require('./engine.js'); browser: window.BackgammonPremiumEngine
 *
 * Official rules implemented (single game, money-play style with the doubling
 * cube; this is not a multi-game match):
 *  - 24 points arranged in four quadrants of six. Two rows of twelve with the
 *    bar between them. Each side has fifteen checkers (thirty in total).
 *  - Standard opening: White 2 on its 24-point, 5 on 13, 3 on 8, 5 on 6;
 *    Black mirrored, moving the other way. Opening pip count is 167 for both.
 *  - A checker may move only to an open point, its own point, or a blot
 *    (exactly one opposing checker). Landing on a blot hits it to the bar.
 *  - A point with two or more opposing checkers is closed and may not be used.
 *  - A checker on the bar must re-enter in the opponent's home board with the
 *    exact die (White 25-die, Black die) before any other checker may move.
 *  - Two dice, doubles are played four times. Both dice must be used when
 *    legal; when only one can be played, the higher die must be used.
 *  - Bear-off only when all fifteen checkers are in the home board and the bar
 *    is empty. Exact rolls come off directly; a larger roll may remove a
 *    checker from the highest occupied point only.
 *  - Game ends when one side has borne off all fifteen. Single game = 1x,
 *    gammon = 2x when the loser has borne off none, backgammon = 3x when that
 *    loser also still has a checker in the winner's home board or on the bar.
 *  - Doubling cube: value starts at 1 (centred). The player to move may double
 *    before rolling; the opponent takes (cube doubles, taker owns it) or
 *    passes (concedes the current stake). Values 1,2,4,8,16,32,64 — 64 is the
 *    cap. A single game owns one cube; no match/Crawford rules.
 *
 * State is plain JSON. Every move helper is pure except the explicitly
 * in-place API (rollDice, applyMove, endTurn, doubleCube, takeCube, passCube).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.BackgammonPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var POINTS = 24;
  var CHECKERS_PER_SIDE = 15;
  var BAR_PIP = 25;
  var CUBE_VALUES = [1, 2, 4, 8, 16, 32, 64];
  var AI_LEVELS = {
    easy: { label: '轻松', depth: 1, jitter: 6.5, maxMs: 160, nodeCap: 2500 },
    normal: { label: '标准', depth: 1, jitter: 0.8, maxMs: 320, nodeCap: 6000 },
    hard: { label: '困难', depth: 2, jitter: 0, maxMs: 500, nodeCap: 9000 }
  };
  var DEFAULT_NAMES = ['白方', '黑方'];

  // ---------------------------------------------------------------- helpers --
  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
  function signOf(side) { return side === 0 ? 1 : -1; }
  function other(side) { return side === 0 ? 1 : 0; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function sideIndex(side) {
    if (side === 0 || side === 1) return side;
    if (side == null) return 0;
    var s = String(side).toLowerCase();
    if (s === 'white' || s === 'w' || s === 'light' || s === '白' || s === '白方') return 0;
    if (s === 'black' || s === 'b' || s === 'dark' || s === '黑' || s === '黑方') return 1;
    var n = Number(side);
    if (n === 0 || n === 1) return n;
    throw new Error('unknown side: ' + side);
  }
  function ownCountAt(points, point, side) {
    var v = points[point] || 0;
    return side === 0 ? Math.max(0, v) : Math.max(0, -v);
  }
  function oppCountAt(points, point, side) {
    var v = points[point] || 0;
    return side === 0 ? Math.max(0, -v) : Math.max(0, v);
  }
  function isHome(point, side) {
    return side === 0 ? point >= 1 && point <= 6 : point >= 19 && point <= 24;
  }
  function homeDistance(point, side) {
    return side === 0 ? point : 25 - point;
  }
  function entryPoint(die, side) {
    return side === 0 ? 25 - die : die;
  }
  function boardCount(points, side) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) n += ownCountAt(points, p, side);
    return n;
  }
  function countCheckers(state, side) {
    side = sideIndex(side);
    return boardCount(state.points, side) + state.bar[side] + state.off[side];
  }
  function outsideHome(state, side) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) {
      if (ownCountAt(state.points, p, side) && !isHome(p, side)) n += ownCountAt(state.points, p, side);
    }
    return n;
  }
  function allHome(state, side) {
    return state.bar[side] === 0 && outsideHome(state, side) === 0;
  }
  function canBearOff(state, side) {
    side = sideIndex(side);
    return allHome(state, side) && state.off[side] < CHECKERS_PER_SIDE;
  }
  function highestInHome(state, point, side) {
    var range = side === 0 ? [point + 1, 6] : [19, point - 1];
    for (var p = range[0]; p <= range[1]; p++) {
      if (ownCountAt(state.points, p, side) > 0) return false;
    }
    return true;
  }
  function canLand(points, point, side) {
    if (point < 1 || point > POINTS) return false;
    return oppCountAt(points, point, side) < 2;
  }
  function pipAt(state, side) {
    side = sideIndex(side);
    var total = state.bar[side] * BAR_PIP;
    for (var p = 1; p <= POINTS; p++) {
      var n = ownCountAt(state.points, p, side);
      if (!n) continue;
      total += n * homeDistance(p, side);
    }
    return total;
  }
  function pip(state, side) { return pipAt(state, sideIndex(side)); }
  function totalBoardCheckers(state) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) n += Math.abs(state.points[p] || 0);
    return n + state.bar[0] + state.bar[1] + state.off[0] + state.off[1];
  }
  function quadrantCounts(state) {
    // Four quadrants of six: 1-6, 7-12, 13-18, 19-24.
    var q = [0, 0, 0, 0];
    for (var p = 1; p <= POINTS; p++) q[Math.floor((p - 1) / 6)] += Math.abs(state.points[p] || 0);
    return q;
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 80) state.log.shift();
  }
  function emit(state, event) {
    state.events.push(event);
    if (state.events.length > 100) state.events.shift();
  }
  function posSnapshot(state) {
    return { points: state.points.slice(), bar: state.bar.slice(), off: state.off.slice() };
  }
  function posFromSnapshot(snap) {
    return { points: snap.points.slice(), bar: snap.bar.slice(), off: snap.off.slice() };
  }

  // ------------------------------------------------------------------- RNG ---
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function nextRandom(state) {
    var rng = mulberry32(state.rngState >>> 0);
    var value = rng();
    // Advance with one step of the same generator so state stays JSON-safe.
    state.rngState = (state.rngState + 0x6D2B79F5) >>> 0;
    return value;
  }
  function dieFromRandom(value) { return 1 + Math.floor(clamp(value, 0, 0.999999999) * 6); }

  // ---------------------------------------------------------------- position --
  function setup(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : (Number(opts.seed) >>> 0);
    var points = new Array(POINTS + 1);
    for (var i = 0; i <= POINTS; i++) points[i] = 0;
    // White: 2 on 24, 5 on 13, 3 on 8, 5 on 6. Black mirrored: 2 on 1,
    // 5 on 12, 3 on 17, 5 on 19. Both total 167 pips.
    points[24] = 2; points[13] = 5; points[8] = 3; points[6] = 5;
    points[1] = -2; points[12] = -5; points[17] = -3; points[19] = -5;
    var cubeValue = opts.cubeValue == null ? 1 : Number(opts.cubeValue);
    if (CUBE_VALUES.indexOf(cubeValue) === -1) cubeValue = 1;
    var state = {
      version: 1,
      seed: seed,
      rngState: seed >>> 0,
      points: points,
      bar: [0, 0],
      off: [0, 0],
      turn: sideIndex(opts.turn == null ? 0 : opts.turn),
      dice: [],
      rolled: [],
      phase: 'roll',            // roll | move | over
      cube: {
        value: cubeValue,
        owner: opts.cubeOwner == null ? null : sideIndex(opts.cubeOwner),
        pending: null             // { by, to }
      },
      winner: null,
      scoreInfo: null,
      endReason: null,            // bearoff | pass
      turnNumber: 1,
      movesThisTurn: [],
      lastMove: null,
      lastRoll: null,
      history: [],
      log: [],
      events: [],
      names: (opts.names && opts.names.length === 2) ? [String(opts.names[0]), String(opts.names[1])] : DEFAULT_NAMES.slice(),
      ai: (opts.ai && opts.ai.length === 2) ? [!!opts.ai[0], !!opts.ai[1]] : [false, false]
    };
    emit(state, { type: 'start', turn: state.turn, pip: [pip(state, 0), pip(state, 1)] });
    log(state, '开局：白方 2/5/3/5，黑方镜像；双方 pip 167。');
    return state;
  }

  // ------------------------------------------------------------------ moves --
  function singleMovesAt(pos, side, die) {
    var moves = [];
    if (!(die >= 1 && die <= 6)) return moves;
    if (pos.bar[side] > 0) {
      var entry = entryPoint(die, side);
      if (canLand(pos.points, entry, side)) moves.push({ from: 'bar', to: entry, die: die });
      return moves;
    }
    var canOff = pos.bar[side] === 0 && outsideHomeFromPos(pos, side) === 0 && pos.off[side] < CHECKERS_PER_SIDE;
    for (var p = 1; p <= POINTS; p++) {
      if (ownCountAt(pos.points, p, side) === 0) continue;
      if (canOff && isHome(p, side)) {
        var dist = homeDistance(p, side);
        if (dist === die) {
          moves.push({ from: p, to: 'off', die: die, bearOff: true });
        } else if (die > dist && highestInHomeFromPos(pos, p, side)) {
          moves.push({ from: p, to: 'off', die: die, bearOff: true });
        }
      }
      var to = side === 0 ? p - die : p + die;
      if (to >= 1 && to <= POINTS && canLand(pos.points, to, side)) {
        moves.push({ from: p, to: to, die: die });
      }
    }
    return moves;
  }
  function outsideHomeFromPos(pos, side) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) {
      if (ownCountAt(pos.points, p, side) && !isHome(p, side)) n += ownCountAt(pos.points, p, side);
    }
    return n;
  }
  function highestInHomeFromPos(pos, point, side) {
    var range = side === 0 ? [point + 1, 6] : [19, point - 1];
    for (var p = range[0]; p <= range[1]; p++) {
      if (ownCountAt(pos.points, p, side) > 0) return false;
    }
    return true;
  }
  function singleMoves(state, side, die) {
    side = sideIndex(side);
    return singleMovesAt({ points: state.points, bar: state.bar, off: state.off }, side, die);
  }

  function rawApplyAt(pos, side, move) {
    var sign = signOf(side);
    var hit = false;
    if (move.from === 'bar') {
      if (pos.bar[side] <= 0) throw new Error('no checker on the bar');
      pos.bar[side] -= 1;
    } else {
      var from = Number(move.from);
      if (!(from >= 1 && from <= POINTS) || ownCountAt(pos.points, from, side) <= 0) {
        throw new Error('no own checker on point ' + move.from);
      }
      pos.points[from] -= sign;
      if (pos.points[from] === 0) pos.points[from] = 0;
    }
    if (move.to === 'off') {
      pos.off[side] += 1;
    } else {
      var to = Number(move.to);
      if (!(to >= 1 && to <= POINTS)) throw new Error('bad destination');
      if (oppCountAt(pos.points, to, side) >= 2) throw new Error('point ' + to + ' is closed');
      if (oppCountAt(pos.points, to, side) === 1) {
        pos.points[to] = 0;              // remove the blot
        pos.bar[other(side)] += 1;       // and send it to the opponent's bar
        hit = true;
      }
      pos.points[to] = (pos.points[to] || 0) + sign;
    }
    return hit;
  }

  // Recursively enumerate maximal sequences. A branch stops when no remaining
  // die can be played. The caller filters to the maximum dice count and (when
  // only one die can be used) the higher die.
  function allSequences(state, side, opts) {
    side = sideIndex(side == null ? state.turn : side);
    if (state.phase !== 'move' || side !== state.turn || !state.dice.length) return [];
    opts = opts || {};
    var initialDice = state.dice.slice().sort(function (a, b) { return a - b; });
    var nodeCap = Math.max(200, Number(opts.nodeCap) || 20000);
    var leaves = [];
    var seen = Object.create(null);
    var nodes = 0;

    function record(pos, diceLeft, moves, hits) {
      // Deduplicate by the full move path, not by the final position. Two
      // legal orders can reach the same position (13/8 then 8/2, or 8/2 then
      // 13/8); both first moves must remain legal for the player.
      var key = moves.map(function (m) { return String(m.from) + '>' + String(m.to) + '@' + m.die; }).join('|') +
        '#' + diceLeft.slice().sort(function (a, b) { return a - b; }).join(',');
      if (seen[key]) return;
      seen[key] = true;
      leaves.push({
        moves: moves.map(function (m) { return { from: m.from, to: m.to, die: m.die, hit: !!m.hit, bearOff: !!m.bearOff }; }),
        diceLeft: diceLeft.slice(),
        diceUsed: moves.map(function (m) { return m.die; }),
        hits: hits,
        final: { points: pos.points.slice(), bar: pos.bar.slice(), off: pos.off.slice() },
        key: key
      });
    }

    function walk(pos, diceLeft, moves, hits) {
      nodes += 1;
      if (nodes > nodeCap) return;
      if (!diceLeft.length) { record(pos, diceLeft, moves, hits); return; }
      var sorted = diceLeft.slice().sort(function (a, b) { return b - a; });
      var tried = Object.create(null);
      var any = false;
      for (var i = 0; i < sorted.length; i++) {
        var die = sorted[i];
        if (tried[die]) continue;
        tried[die] = true;
        var candidates = singleMovesAt(pos, side, die);
        for (var j = 0; j < candidates.length; j++) {
          var move = candidates[j];
          var next = posFromSnapshot(pos);
          var hit = rawApplyAt(next, side, move);
          var left = diceLeft.slice();
          left.splice(left.indexOf(die), 1);
          any = true;
          var nextMoves = moves.concat([{
            from: move.from, to: move.to, die: die, hit: hit, bearOff: !!move.bearOff
          }]);
          if (next.off[side] >= CHECKERS_PER_SIDE) {
            record(next, left, nextMoves, hits + (hit ? 1 : 0));
          } else {
            walk(next, left, nextMoves, hits + (hit ? 1 : 0));
          }
          if (nodes > nodeCap) break;
        }
        if (nodes > nodeCap) break;
      }
      if (!any) record(pos, diceLeft, moves, hits);
    }

    walk({ points: state.points.slice(), bar: state.bar.slice(), off: state.off.slice() }, initialDice, [], 0);
    var playable = leaves.filter(function (leaf) { return leaf.moves.length > 0; });
    if (!playable.length) return [];
    var maxUsed = 0;
    playable.forEach(function (leaf) { if (leaf.moves.length > maxUsed) maxUsed = leaf.moves.length; });
    var best = playable.filter(function (leaf) { return leaf.moves.length === maxUsed; });
    // "If only one die can be played, play the higher one."
    if (maxUsed === 1 && initialDice.length > 1) {
      var highest = initialDice[initialDice.length - 1];
      var higher = best.filter(function (leaf) { return leaf.moves[0].die === highest; });
      if (higher.length) best = higher;
    }
    best.sort(function (a, b) {
      if (a.hits !== b.hits) return b.hits - a.hits;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    return best;
  }

  function legalMoves(state, side) {
    side = sideIndex(side == null ? state.turn : side);
    if (state.phase !== 'move' || side !== state.turn || state.cube.pending) return [];
    var seqs = allSequences(state, side);
    var out = [];
    var seen = Object.create(null);
    seqs.forEach(function (seq) {
      var m = seq.moves[0];
      var key = String(m.from) + '>' + String(m.to) + '@' + m.die;
      if (seen[key]) return;
      seen[key] = true;
      out.push({ from: m.from, to: m.to, die: m.die, hit: !!m.hit, bearOff: !!m.bearOff });
    });
    out.sort(function (a, b) {
      var af = a.from === 'bar' ? 0 : Number(a.from);
      var bf = b.from === 'bar' ? 0 : Number(b.from);
      if (af !== bf) return af - bf;
      var at = a.to === 'off' ? 0 : Number(a.to);
      var bt = b.to === 'off' ? 0 : Number(b.to);
      return at - bt;
    });
    return out;
  }

  function moveKey(move) {
    return String(move.from) + '>' + String(move.to) + '@' + Number(move.die);
  }
  function isLegalMove(state, move, side) {
    if (!move) return false;
    side = sideIndex(side == null ? state.turn : side);
    var key = moveKey(move);
    return legalMoves(state, side).some(function (m) { return moveKey(m) === key; });
  }

  function applyMove(state, move) {
    if (!state || state.phase !== 'move') throw new Error('not in the move phase');
    if (state.cube.pending) throw new Error('doubling cube is pending');
    var side = state.turn;
    if (!isLegalMove(state, move, side)) throw new Error('illegal move: ' + moveKey(move || {}));
    var clean = { from: move.from === 'bar' ? 'bar' : Number(move.from), to: move.to === 'off' ? 'off' : Number(move.to), die: Number(move.die) };
    var dieIndex = state.dice.indexOf(clean.die);
    if (dieIndex < 0) throw new Error('die not available');
    var hit = rawApplyAt({ points: state.points, bar: state.bar, off: state.off }, side, clean);
    state.dice.splice(dieIndex, 1);
    var executed = { from: clean.from, to: clean.to, die: clean.die, hit: hit, bearOff: clean.to === 'off', seat: side };
    state.movesThisTurn.push(executed);
    state.lastMove = executed;
    state.history.push({ turn: state.turnNumber, seat: side, move: executed });
    if (state.history.length > 160) state.history.shift();
    emit(state, { type: 'move', seat: side, move: executed });
    log(state, state.names[side] + ' ' + (clean.from === 'bar' ? '从 bar 进 ' + clean.to : clean.from + ' → ' + (clean.to === 'off' ? 'off' : clean.to)) +
      '（' + clean.die + '）' + (hit ? '，击中对方散子' : '') + (clean.to === 'off' ? '，离盘' : ''));
    if (hit) emit(state, { type: 'hit', seat: side, point: clean.to });
    if (state.off[side] >= CHECKERS_PER_SIDE) {
      finishByBearOff(state, side);
      return state;
    }
    if (state.dice.length && legalMoves(state, side).length) {
      state.phase = 'move';
    } else {
      endTurnInternal(state);
    }
    return state;
  }

  function endTurnInternal(state) {
    var finished = state.turn;
    state.turn = other(state.turn);
    state.dice = [];
    state.rolled = [];
    state.phase = 'roll';
    state.movesThisTurn = [];
    state.turnNumber += 1;
    emit(state, { type: 'turn', seat: state.turn });
    log(state, state.names[finished] + ' 结束回合，轮到 ' + state.names[state.turn] + '。');
  }

  function endTurn(state) {
    if (!state || state.phase !== 'move') throw new Error('not in the move phase');
    if (state.dice.length && legalMoves(state, state.turn).length) throw new Error('legal moves remain');
    endTurnInternal(state);
    return state;
  }

  function rollDice(state, opts) {
    if (!state || state.phase !== 'roll') throw new Error('not in the roll phase');
    if (state.cube.pending) throw new Error('doubling cube is pending');
    opts = opts || {};
    var a, b;
    if (Array.isArray(opts.dice)) {
      a = Number(opts.dice[0]); b = Number(opts.dice[1]);
    } else if (typeof opts.rng === 'function') {
      a = dieFromRandom(opts.rng()); b = dieFromRandom(opts.rng());
    } else {
      a = dieFromRandom(nextRandom(state)); b = dieFromRandom(nextRandom(state));
    }
    if (!(a >= 1 && a <= 6 && b >= 1 && b <= 6)) throw new Error('dice must be 1..6');
    state.rolled = [a, b];
    state.dice = a === b ? [a, a, a, a] : [a, b];
    state.phase = 'move';
    state.movesThisTurn = [];
    state.lastRoll = { a: a, b: b, seat: state.turn, turn: state.turnNumber };
    emit(state, { type: 'roll', seat: state.turn, dice: [a, b], doubles: a === b });
    log(state, state.names[state.turn] + ' 掷出 ' + a + ' + ' + b + (a === b ? '（对子，走四步）' : '') + '。');
    return state;
  }

  // ------------------------------------------------------------ doubling cube --
  function canDouble(state, side) {
    side = sideIndex(side == null ? state.turn : side);
    if (!state || state.phase !== 'roll' || state.cube.pending) return false;
    if (state.turn !== side) return false;
    if (state.cube.value >= 64) return false;
    return state.cube.owner == null || state.cube.owner === side;
  }
  function doubleCube(state, side) {
    side = sideIndex(side == null ? state.turn : side);
    if (!canDouble(state, side)) throw new Error('doubling is not allowed now');
    var to = Math.min(64, state.cube.value * 2);
    state.cube.pending = { by: side, to: to, from: state.cube.value };
    emit(state, { type: 'double', seat: side, value: to });
    log(state, state.names[side] + ' 要求加倍到 ' + to + '，等待对方回应。');
    return state;
  }
  function cubeResponder(state) {
    if (!state || !state.cube.pending) return null;
    return other(state.cube.pending.by);
  }
  function takeCube(state, side) {
    side = sideIndex(side);
    if (!state.cube.pending) throw new Error('no double to take');
    if (side !== other(state.cube.pending.by)) throw new Error('only the opponent may take');
    var pending = state.cube.pending;
    state.cube.value = pending.to;
    state.cube.owner = side;
    state.cube.pending = null;
    emit(state, { type: 'take', seat: side, value: state.cube.value });
    log(state, state.names[side] + ' 接受加倍，倍数方块归 ' + state.names[side] + '，本局价值 ' + state.cube.value + '。');
    return state;
  }
  function passCube(state, side) {
    side = sideIndex(side);
    if (!state.cube.pending) throw new Error('no double to pass');
    if (side !== other(state.cube.pending.by)) throw new Error('only the opponent may pass');
    var pending = state.cube.pending;
    finishByPass(state, pending.by);
    return state;
  }

  // ------------------------------------------------------------------ finish --
  function loserBackgammon(state, winner, loser) {
    if (state.off[loser] > 0) return false;
    if (state.bar[loser] > 0) return true;
    for (var p = 1; p <= POINTS; p++) {
      if (!isHome(p, winner)) continue;
      if (ownCountAt(state.points, p, loser) > 0) return true;
    }
    return false;
  }
  function finishByBearOff(state, winner) {
    var loser = other(winner);
    var type = 'single';
    var multiplier = 1;
    if (state.off[loser] === 0) {
      type = 'gammon';
      multiplier = 2;
      if (loserBackgammon(state, winner, loser)) { type = 'backgammon'; multiplier = 3; }
    }
    var points = state.cube.value * multiplier;
    state.phase = 'over';
    state.winner = winner;
    state.endReason = 'bearoff';
    state.cube.pending = null;
    state.scoreInfo = {
      winner: winner,
      winnerName: state.names[winner],
      loser: loser,
      loserName: state.names[loser],
      type: type,
      multiplier: multiplier,
      cubeValue: state.cube.value,
      points: points,
      loserOff: state.off[loser],
      winnerOff: state.off[winner]
    };
    emit(state, { type: 'over', winner: winner, score: state.scoreInfo });
    log(state, state.names[winner] + ' 全部离盘，' + (type === 'single' ? '单局' : type === 'gammon' ? 'gammon ×2' : 'backgammon ×3') +
      '；倍数 ' + state.cube.value + '，本局 ' + points + ' 分。');
  }
  function finishByPass(state, winner) {
    var loser = other(winner);
    var points = state.cube.value;
    state.phase = 'over';
    state.winner = winner;
    state.endReason = 'pass';
    state.cube.pending = null;
    state.scoreInfo = {
      winner: winner,
      winnerName: state.names[winner],
      loser: loser,
      loserName: state.names[loser],
      type: 'single',
      multiplier: 1,
      cubeValue: state.cube.value,
      points: points,
      loserOff: state.off[loser],
      winnerOff: state.off[winner],
      concedes: true
    };
    emit(state, { type: 'over', winner: winner, score: state.scoreInfo });
    log(state, state.names[loser] + ' 放弃加倍，' + state.names[winner] + ' 赢得当前赌注 ' + points + ' 分。');
  }
  function score(state) {
    if (!state || state.phase !== 'over') return null;
    return state.scoreInfo ? clone(state.scoreInfo) : null;
  }
  function winner(state) { return state && state.phase === 'over' ? state.winner : null; }
  function status(state) {
    if (!state) return 'unknown';
    if (state.phase === 'over') return 'over';
    if (state.cube.pending) return 'cube';
    if (state.phase === 'roll') return 'roll';
    if (state.phase === 'move') return legalMoves(state, state.turn).length ? 'move' : 'no-moves';
    return state.phase;
  }
  function checkersOnBar(state, side) { return state.bar[sideIndex(side)]; }
  function checkersOff(state, side) { return state.off[sideIndex(side)]; }

  // --------------------------------------------------------------------- AI --
  function pipAtPos(pos, side) {
    var total = pos.bar[side] * BAR_PIP;
    for (var p = 1; p <= POINTS; p++) {
      var n = ownCountAt(pos.points, p, side);
      if (n) total += n * homeDistance(p, side);
    }
    return total;
  }
  function homeCountAt(pos, side) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) if (isHome(p, side)) n += ownCountAt(pos.points, p, side);
    return n;
  }
  function madePointsAt(pos, side) {
    var n = 0;
    for (var p = 1; p <= POINTS; p++) if (ownCountAt(pos.points, p, side) >= 2) n += isHome(p, side) ? 2 : 1;
    return n;
  }
  function blotsAt(pos, side) {
    var list = [];
    for (var p = 1; p <= POINTS; p++) if (ownCountAt(pos.points, p, side) === 1) list.push(p);
    return list;
  }
  function hittersForBlot(pos, point, side) {
    // Checkers that can hit `point` next turn: the opponent's bar plus any
    // opponent checker one to six pips behind it on the track.
    var opp = other(side);
    var n = pos.bar[opp];
    for (var d = 1; d <= 6; d++) {
      var p = side === 0 ? point - d : point + d;
      if (p >= 1 && p <= POINTS) n += ownCountAt(pos.points, p, opp);
    }
    return n;
  }
  function evalPos(pos, side) {
    var opp = other(side);
    var s = 0;
    s += (pipAtPos(pos, opp) - pipAtPos(pos, side)) * 0.85;
    s += (pos.off[side] - pos.off[opp]) * 32;
    s += (pos.bar[opp] - pos.bar[side]) * 26;
    s += (homeCountAt(pos, side) - homeCountAt(pos, opp)) * 2.6;
    s += (madePointsAt(pos, side) - madePointsAt(pos, opp)) * 3.4;
    var mine = blotsAt(pos, side);
    for (var i = 0; i < mine.length; i++) {
      var p = mine[i];
      var danger = 1 + hittersForBlot(pos, p, side) * 1.9;
      if (isHome(p, opp)) danger += 2.4;             // blot inside opponent's home
      s -= 2.2 + danger * 1.7;
    }
    var theirs = blotsAt(pos, opp);
    for (var j = 0; j < theirs.length; j++) {
      var q = theirs[j];
      var chance = 1 + hittersForBlot(pos, q, opp) * 1.15;
      s += 1.8 + chance * 1.2;
    }
    // Checkers buried on the 24-point are less useful than checkers escaped.
    s -= ownCountAt(pos.points, 24, side) * 0.9;
    s += ownCountAt(pos.points, 24, opp) * 0.5;
    return s;
  }
  function sequenceScore(state, seq, side) {
    var s = evalPos(seq.final, side);
    s += seq.hits * 7.5;
    // Bearing off is the goal; value each removed checker directly.
    s += seq.final.off[side] * 6;
    return s;
  }
  function hashKey(text) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function jitterFor(state, seq, salt) {
    var h = hashKey(String(state.seed) + '|' + state.turnNumber + '|' + seq.key + '|' + (salt || 0));
    return (h % 10000) / 10000;
  }
  function bestOpponentScore(state, finalPos, deadline) {
    var opp = other(state.turn);
    // One representative roll per candidate keeps hard mode well inside the
    // 500ms cap while still looking one reply ahead.
    var rolls = [[6, 6], [5, 4], [3, 2]];
    var pick = rolls[hashKey(String(state.seed) + state.turnNumber) % rolls.length];
    var sim = clone(state);
    sim.points = finalPos.points.slice();
    sim.bar = finalPos.bar.slice();
    sim.off = finalPos.off.slice();
    sim.turn = opp;
    sim.phase = 'roll';
    sim.dice = [];
    sim.rolled = [];
    sim.turnNumber = state.turnNumber + 1;
    if (Date.now() > deadline) return evalPos(finalPos, opp);
    try { rollDice(sim, { dice: pick }); } catch (err) { return evalPos(finalPos, opp); }
    var seqs = allSequences(sim, opp, { nodeCap: 1800 });
    if (!seqs.length) return evalPos(finalPos, opp);
    var best = -Infinity;
    for (var i = 0; i < seqs.length; i++) {
      if (Date.now() > deadline && best > -Infinity) break;
      var v = sequenceScore(sim, seqs[i], opp);
      if (v > best) best = v;
    }
    return best;
  }
  function aiSequence(state, side, opts) {
    side = sideIndex(side == null ? state.turn : side);
    if (!state || state.phase !== 'move' || state.turn !== side) return null;
    opts = opts || {};
    var level = AI_LEVELS[opts.level] ? opts.level : 'normal';
    var cfg = AI_LEVELS[level];
    var maxMs = clamp(Number(opts.maxMs) || cfg.maxMs, 10, 500);
    var deadline = Date.now() + maxMs;
    var seqs = allSequences(state, side, { nodeCap: cfg.nodeCap });
    if (!seqs.length) return null;
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < seqs.length; i++) {
      if (Date.now() > deadline && best) break;
      var seq = seqs[i];
      var scoreValue = sequenceScore(state, seq, side);
      if (cfg.jitter) scoreValue += (jitterFor(state, seq, 7) - 0.5) * cfg.jitter;
      if (cfg.depth >= 2) {
        scoreValue -= 0.62 * bestOpponentScore(state, seq.final, deadline);
      }
      if (scoreValue > bestScore) { bestScore = scoreValue; best = seq; }
    }
    return best;
  }
  function aiMove(state, side, opts) {
    var seq = aiSequence(state, side, opts);
    if (!seq || !seq.moves.length) return null;
    var m = seq.moves[0];
    return { from: m.from, to: m.to, die: m.die };
  }
  function aiCubeResponse(state, side) {
    side = sideIndex(side == null ? cubeResponder(state) : side);
    if (!state || !state.cube.pending) return null;
    if (side !== cubeResponder(state)) return null;
    var pos = posSnapshot(state);
    var value = evalPos(pos, side);
    var next = state.cube.pending.to;
    if (next <= 2) return 'take';
    if (next >= 16 && value < -50) return 'pass';
    if (next >= 8 && value < -95) return 'pass';
    return 'take';
  }
  function aiDecision(state, side, opts) {
    side = sideIndex(side == null ? state.turn : side);
    if (!state || state.phase === 'over') return null;
    if (state.cube.pending) {
      if (side !== cubeResponder(state)) return null;
      var response = aiCubeResponse(state, side);
      return response ? { type: response, seat: side } : null;
    }
    if (state.turn !== side) return null;
    if (state.phase === 'roll') return { type: 'roll', seat: side };
    if (state.phase === 'move') {
      if (!legalMoves(state, side).length) return { type: 'endTurn', seat: side };
      var move = aiMove(state, side, opts);
      return move ? { type: 'move', seat: side, from: move.from, to: move.to, die: move.die } : { type: 'endTurn', seat: side };
    }
    return null;
  }

  // --------------------------------------------------------------- self-play --
  function selfPlay(seed, opts) {
    opts = opts || {};
    var state = setup({ seed: seed == null ? 99 : seed, names: opts.names });
    var guard = 0;
    while (state.phase !== 'over' && guard < 30000) {
      guard += 1;
      if (state.cube.pending) {
        var responder = cubeResponder(state);
        var reply = aiCubeResponse(state, responder);
        if (reply === 'pass') passCube(state, responder); else takeCube(state, responder);
      } else if (state.phase === 'roll') {
        rollDice(state);
      } else if (state.phase === 'move') {
        var seq = aiSequence(state, state.turn, { level: opts.level || 'easy', maxMs: opts.maxMs || 40 });
        if (seq && seq.moves.length) {
          try { applyMove(state, seq.moves[0]); } catch (err) { endTurn(state); }
        } else {
          endTurn(state);
        }
      }
    }
    return state;
  }

  // ------------------------------------------------------------------ views --
  function compactSequence(seq) {
    return {
      moves: seq.moves.map(function (m) { return { from: m.from, to: m.to, die: m.die, hit: !!m.hit, bearOff: !!m.bearOff }; }),
      diceLeft: seq.diceLeft.slice(),
      hits: seq.hits
    };
  }
  function publicView(state, seat) {
    if (!state) return null;
    var viewer = (seat == null || Number(seat) < 0) ? -1 : sideIndex(seat);
    var pending = state.cube.pending;
    var seqs = (viewer === state.turn && state.phase === 'move' && !pending)
      ? allSequences(state, viewer, { nodeCap: 5000 }) : [];
    var moves = (viewer === state.turn && state.phase === 'move' && !pending)
      ? legalMoves(state, viewer) : [];
    var view = {
      phase: state.phase,
      status: status(state),
      turn: state.turn,
      turnName: state.names[state.turn],
      turnNumber: state.turnNumber,
      dice: state.dice.slice(),
      rolled: state.rolled.slice(),
      points: state.points.slice(),
      bar: state.bar.slice(),
      off: state.off.slice(),
      cube: {
        value: state.cube.value,
        owner: state.cube.owner,
        pending: pending ? { by: pending.by, to: pending.to, from: pending.from, responder: other(pending.by) } : null
      },
      pip: [pip(state, 0), pip(state, 1)],
      checkers: [countCheckers(state, 0), countCheckers(state, 1)],
      canBearOff: [canBearOff(state, 0), canBearOff(state, 1)],
      home: [{ side: 0, from: 1, to: 6 }, { side: 1, from: 19, to: 24 }],
      winner: state.winner,
      winType: state.scoreInfo ? state.scoreInfo.type : null,
      score: state.phase === 'over' ? score(state) : null,
      endReason: state.endReason,
      lastMove: state.lastMove ? clone(state.lastMove) : null,
      lastRoll: state.lastRoll ? clone(state.lastRoll) : null,
      names: state.names.slice(),
      ai: state.ai.slice(),
      log: state.log.slice(-24),
      legalMoves: moves,
      legalSequences: seqs.slice(0, 220).map(compactSequence),
      canRoll: viewer === state.turn && state.phase === 'roll' && !pending,
      canDouble: viewer === state.turn && canDouble(state, viewer),
      canEndTurn: viewer === state.turn && state.phase === 'move' && !pending && moves.length === 0,
      cubeActions: (pending && viewer === other(pending.by)) ? ['take', 'pass'] : [],
      you: viewer
    };
    // The seed, RNG cursor, full history and private internals never leave the
    // server. Backgammon has no hidden board information, so the rest is public.
    return view;
  }

  return {
    setup: setup,
    createGame: setup,
    rollDice: rollDice,
    legalMoves: legalMoves,
    allSequences: allSequences,
    applyMove: applyMove,
    endTurn: endTurn,
    doubleCube: doubleCube,
    takeCube: takeCube,
    passCube: passCube,
    canDouble: canDouble,
    cubeResponder: cubeResponder,
    pip: pip,
    pipAt: pipAt,
    sideIndex: sideIndex,
    canBearOff: canBearOff,
    allHome: allHome,
    status: status,
    winner: winner,
    score: score,
    countCheckers: countCheckers,
    checkersOnBar: checkersOnBar,
    checkersOff: checkersOff,
    quadrantCounts: quadrantCounts,
    totalBoardCheckers: totalBoardCheckers,
    singleMoves: singleMoves,
    isLegalMove: isLegalMove,
    evalPos: evalPos,
    aiSequence: aiSequence,
    aiMove: aiMove,
    aiCubeResponse: aiCubeResponse,
    aiDecision: aiDecision,
    selfPlay: selfPlay,
    publicView: publicView,
    makeRng: mulberry32,
    clone: clone,
    posSnapshot: posSnapshot,
    POINTS: POINTS,
    CHECKERS_PER_SIDE: CHECKERS_PER_SIDE,
    CUBE_VALUES: CUBE_VALUES,
    AI_LEVELS: AI_LEVELS,
    DEFAULT_NAMES: DEFAULT_NAMES
  };
});
