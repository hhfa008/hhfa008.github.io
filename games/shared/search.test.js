'use strict';

// Tests for games/shared/search.js: negamax + alpha-beta, iterative deepening
// and the transposition table.  The oracle is a plain exhaustive minimax with
// exactly the same evaluation and terminal scoring, so alpha-beta can only be
// allowed to skip nodes, never to change the value of the position.

var lib = require('../tests/lib.js');
var s = lib.suite('shared/search');

var Games = require('../shared/rules.js');
var Search = require('../shared/search.js');
var C = Games.connect4;
var G = Games.contract('connect4');
var ORDER = [3, 2, 4, 1, 5, 0, 6];
var WIN = 1000000;

// Connect Four adapter over the shared contract.  evaluate() is the engine's
// own heuristic, so the oracle and the searched value use identical leaves.
function adapter() {
  return {
    legalMoves: G.legalMoves,
    applyMove: G.applyMove,
    status: G.status,
    winner: G.winner,
    evaluate: function (st) { return C.evaluate(st.b, st.turn); },
    key: G.key,
    orderMoves: function (st, moves) {
      return moves.slice().sort(function (a, b) {
        return ORDER.indexOf(a) - ORDER.indexOf(b);
      });
    }
  };
}

function position(seq) {
  var st = C.setup();
  for (var i = 0; i < seq.length; i++) {
    if (C.status(st).over) break;
    st = C.applyMove(st, seq[i]);
  }
  return st;
}

// Exhaustive minimax.  Terminal scoring mirrors Search: a win at node ply p
// is winScore - p (root move = winScore - 1), and a node with no moves is 0.
// The optional `listMoves` collects every move that attains the best value.
function brute(st, depth, ply, listMoves) {
  if (depth <= 0) {
    var leaf = C.evaluate(st.b, st.turn);
    return listMoves ? { score: leaf, moves: [] } : leaf;
  }
  var moves = C.legalMoves(st);
  if (!moves.length) return listMoves ? { score: 0, moves: [] } : 0;
  var best = -Infinity, bestMoves = [], mover = st.turn, i, next, val;
  for (i = 0; i < moves.length; i++) {
    next = C.applyMove(st, moves[i]);
    if (C.winner(next) === mover) val = WIN - Math.max(1, ply);
    else val = -brute(next, depth - 1, ply + 1, false);
    if (val > best) {
      best = val;
      bestMoves = [moves[i]];
    } else if (val === best) {
      bestMoves.push(moves[i]);
    }
  }
  return listMoves ? { score: best, moves: bestMoves } : best;
}

var CASES = [
  { name: '空盘', state: C.setup(), depth: 4 },
  { name: '中局 (3,4,2,5,1)', state: position([3, 4, 2, 5, 1]), depth: 4 },
  { name: '中局 (0..6 顺势)', state: position([0, 1, 2, 3, 4, 5, 6]), depth: 3 }
];

s.group('negamax 与穷举 minimax 一致', function () {
  CASES.forEach(function (tc) {
    var want = brute(tc.state, tc.depth, 0, true);
    var found = Search.negamax(adapter(), { state: tc.state, depth: tc.depth, tt: false });
    s.eq(tc.name + ' 分值一致', found.score, want.score);
    s.ok(tc.name + ' 走法属于最优集合', want.moves.indexOf(found.move) >= 0,
      'got ' + found.move + ', optimal ' + JSON.stringify(want.moves));
    s.ok(tc.name + ' 未超时', !found.aborted);
    s.ok(tc.name + ' 节点计数 > 0', found.nodes > 0);
  });

  // The same values must survive alpha-beta pruning at a deeper node count.
  var deep = position([3, 4, 2, 5, 1]);
  var oracle = brute(deep, 5, 0, false);
  var pruned = Search.negamax(adapter(), { state: deep, depth: 5, tt: false });
  s.eq('深度 5 分值一致', pruned.score, oracle);
});

s.group('置换表', function () {
  // The table is keyed by the contract's stable key(state).
  s.eq('默认容量 2^16', new Search.TranspositionTable().capacity, 65536);
  var direct = new Search.TranspositionTable(2);
  direct.store('a', 3, 10, 'exact', 1);
  var hit = direct.probe('a');
  s.eq('命中保留 depth/score/flag/move', [hit.depth, hit.score, hit.flag, hit.move],
    [3, 10, 'exact', 1]);
  s.eq('命中计数', direct.hits, 1);
  direct.store('b', 1, 2, 'upper', null);
  direct.store('c', 1, 4, 'lower', null);
  s.eq('容量上限时淘汰最旧键', direct.size(), 2);
  s.eq('最旧键已被淘汰', direct.probe('a'), null);

  CASES.forEach(function (tc) {
    var depth = Math.max(tc.depth, 5);
    var plain = Search.negamax(adapter(), { state: tc.state, depth: depth, tt: false });
    var tabled = Search.negamax(adapter(), { state: tc.state, depth: depth, ttSize: 1 << 14 });
    s.eq(tc.name + ' 开表分值不变', tabled.score, plain.score);
    s.ok(tc.name + ' 开表节点数下降', tabled.nodes < plain.nodes,
      'tt=' + tabled.nodes + ', plain=' + plain.nodes);
    s.ok(tc.name + ' 表确实命中', tabled.table.hits > 0, 'hits=' + tabled.table.hits);
  });

  // Capacity is configurable and a tiny table still returns the same value
  // (eviction only costs nodes, never correctness).
  var tiny = Search.negamax(adapter(), { state: CASES[1].state, depth: 5, ttSize: 4 });
  var plain5 = Search.negamax(adapter(), { state: CASES[1].state, depth: 5, tt: false });
  s.eq('小容量表分值不变', tiny.score, plain5.score);
  s.ok('小容量表命中次数有限但可用', tiny.table.capacity === 4);
});

s.group('时限与迭代加深', function () {
  // The empty board has no early forced win, so depth 64 can only stop on the
  // clock — exactly what this group exercises.
  var st = C.setup();
  var res = Search.iterativeDeepening(adapter(), {
    state: st, maxDepth: 64, timeMs: 10, tt: false
  });
  s.ok('返回合法走法', C.legalMoves(st).indexOf(res.move) >= 0, 'got ' + res.move);
  s.ok('返回上一层已完成深度', res.depth >= 1, 'depth=' + res.depth);
  s.ok('超时标志', res.aborted === true);
  s.ok('时限内返回', res.elapsedMs < 2000, 'elapsed=' + res.elapsedMs + 'ms');
  s.ok('结果包含节点数', res.nodes > 0);
  s.eq('结果字段齐全', Object.keys(res).sort(),
    ['aborted', 'depth', 'elapsedMs', 'move', 'nodes', 'score', 'table']);

  // A direct fixed-depth negamax stopped by a deadline must also hand back a
  // legal move instead of null.
  var direct = Search.negamax(adapter(), { state: st, depth: 64, timeMs: 5, tt: false });
  s.ok('negamax 超时仍返回合法走法', C.legalMoves(st).indexOf(direct.move) >= 0,
    'got ' + direct.move);

  // A generous deadline completes the requested depth and reports it.
  var done = Search.iterativeDeepening(adapter(), {
    state: C.setup(), maxDepth: 4, timeMs: 5000, tt: false
  });
  s.eq('充足时限完成指定深度', done.depth, 4);
  s.ok('充足时限未中止', done.aborted === false);
});

s.group('connect4 接入逐手一致', function () {
  // Games/connect4/index.html calls C4.aiMove(state, level, budget).  The
  // search-backed implementation must pick the exact move the original inline
  // search picked, at both difficulty levels, including level 3's depth 7.
  var states = [
    C.setup(),
    position([3, 4, 2, 5, 1]),
    position([0, 1, 2, 3, 4, 5, 6, 0, 1, 2]),
    position([3, 3, 4, 4, 2])
  ];
  var levels = [2, 3];
  states.forEach(function (st, si) {
    levels.forEach(function (level) {
      var now = C.aiMove(st, level);
      var legacy = C.legacyAiMove(st, level);
      s.eq('局面 ' + si + ' 等级 ' + level + ' 走法一致', now, legacy);
      s.ok('局面 ' + si + ' 等级 ' + level + ' 走法合法',
        C.legalMoves(st).indexOf(now) >= 0, 'got ' + now);
    });
  });
});

s.done();
