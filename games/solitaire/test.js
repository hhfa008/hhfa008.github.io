'use strict';

// Klondike solitaire test.
// The engine is the <script id="solitaire-core"> block, which exports
// globalThis.SolitaireCore and is also usable as a CommonJS module.

var path = require('path');
var lib = require('../tests/lib.js');
var s = lib.suite('solitaire');

var html = lib.page(__dirname);
var C = lib.evalScript(html, 'solitaire-core', 'globalThis.SolitaireCore');

function fullDeck(st) {
  var all = st.stock.concat(st.waste);
  st.tableau.forEach(function (col) { all = all.concat(col); });
  st.foundations.forEach(function (pile) { all = all.concat(pile); });
  return all;
}

function wonState() {
  var f = [[], [], [], []];
  for (var suit = 0; suit < 4; suit++) {
    for (var r = 1; r <= 13; r++) f[suit].push({ r: r, s: suit });
  }
  return {
    stock: [], waste: [], foundations: f,
    tableau: [[], [], [], [], [], [], []], drawCount: 1, moves: 0
  };
}

s.group('发牌结构', function () {
  s.eq('牌堆 52 张', C.makeDeck().length, 52);
  s.eq('牌堆无重复', new Set(C.makeDeck().map(function (c) { return c.r + ',' + c.s; })).size, 52);
  var st = C.newState(2026, 1);
  s.eq('7 列长度 1..7', st.tableau.map(function (c) { return c.length; }), [1, 2, 3, 4, 5, 6, 7]);
  s.eq('每列只有顶牌翻开', st.tableau.map(function (c) {
    return c.filter(function (x) { return x.up; }).length;
  }), [1, 1, 1, 1, 1, 1, 1]);
  s.eq('stock 余 24 张', st.stock.length, 24);
  s.eq('合计 52 张', fullDeck(st).length, 52);
  s.eq('同种子发牌确定', C.boardKey(C.newState(99, 1)), C.boardKey(C.newState(99, 1)));
  s.ok('不同种子发牌不同', C.boardKey(C.newState(1, 1)) !== C.boardKey(C.newState(2, 1)));
});

s.group('叠牌规则', function () {
  s.ok('红 5 压黑 6', C.canStack({ r: 5, s: 1 }, { r: 6, s: 0, up: true }));
  s.ok('黑 5 压红 6', C.canStack({ r: 5, s: 0 }, { r: 6, s: 1, up: true }));
  s.ok('同色不能压', !C.canStack({ r: 5, s: 0 }, { r: 6, s: 0, up: true }));
  s.ok('点数不连续不能压', !C.canStack({ r: 5, s: 1 }, { r: 7, s: 0, up: true }));
  s.ok('背面顶牌不能压', !C.canStack({ r: 5, s: 1 }, { r: 6, s: 0, up: false }));
  s.ok('空列只能放 K', C.canStack({ r: 13, s: 0 }, null));
  s.ok('空列不能放 Q', !C.canStack({ r: 12, s: 0 }, null));
  s.ok('A 上基础堆', C.canFoundation({ r: 1, s: 0 }, []));
  s.ok('2 接在 A 上', C.canFoundation({ r: 2, s: 0 }, [{ r: 1, s: 0 }]));
  s.ok('3 不能直接接 A', !C.canFoundation({ r: 3, s: 0 }, [{ r: 1, s: 0 }]));
  s.ok('基础堆必须同花色', C.canFoundationAt({ r: 2, s: 1 }, [[{ r: 1, s: 0 }], [], [], []], 1) === false);
});

s.group('移牌与翻牌', function () {
  var st = {
    stock: [], waste: [], foundations: [[], [], [], []],
    tableau: [
      [{ r: 13, s: 0, up: true }, { r: 12, s: 1, up: true }],
      [], [], [], [], [], []
    ],
    drawCount: 1, moves: 0
  };
  s.eq('整列红 Q..K 合法移动到空列', C.applyMove(st, {
    type: 'tableau',
    from: { type: 'tableau', col: 0, index: 0 },
    col: 6
  }), true);
  s.eq('目标列两张', st.tableau[6].length, 2);
  s.eq('源列清空', st.tableau[0].length, 0);
  s.eq('步数 +1', st.moves, 1);
  s.ok('非法移动返回 false', !C.applyMove(st, {
    type: 'tableau',
    from: { type: 'tableau', col: 1, index: 0 },
    col: 6
  }));
  var st2 = {
    stock: [{ r: 1, s: 0 }, { r: 2, s: 0 }], waste: [], foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []], drawCount: 3, moves: 0
  };
  C.drawAction(st2);
  s.eq('draw 3 抽 2 张（不足 3）', st2.waste.length, 2);
  s.eq('stock 清空', st2.stock.length, 0);
  C.drawAction(st2);
  s.eq('waste 回收成 stock', st2.stock.length, 2);
  s.eq('回收后 waste 为空', st2.waste.length, 0);
  var st3 = { stock: [], waste: [], foundations: [[], [], [], []], tableau: [[], [], [], [], [], [], []], drawCount: 1, moves: 0 };
  s.ok('两堆都空时抽牌失败', !C.drawAction(st3));
  s.ok('未完成不是胜利', !C.isWon(st3));
  s.ok('四堆 13 张为胜利', C.isWon(wonState()));
  s.ok('有牌时不可自动收牌', C.planAuto(C.newState(5, 1)) === null);
  s.eq('已胜局自动收牌为空计划', C.planAuto(wonState()), []);
});

s.group('对局与撤销', function () {
  var g = new C.Game(1234, 1);
  var k0 = C.boardKey(g.state);
  g.draw();
  var k1 = C.boardKey(g.state);
  s.ok('抽牌改变局面', k0 !== k1);
  g.undo();
  s.eq('撤销恢复局面指纹', C.boardKey(g.state), k0);
  s.eq('撤销后步数也恢复', g.state.moves, 0);
  s.ok('克隆后改动不影响原局面', (function () {
    var copy = C.cloneState(g.state);
    copy.moves = 999;
    return g.state.moves !== 999;
  })());
});

s.done();
