'use strict';

// Spider solitaire test, running the <script id="spider-core"> engine.

var lib = require('../tests/lib.js');
var s = lib.suite('spider');

var html = lib.page(__dirname);
var C = lib.evalScript(html, 'spider-core', 'globalThis.SpiderCore');

function total(st) {
  return st.cols.reduce(function (n, c) { return n + c.length; }, 0) + st.stock.length;
}

s.group('发牌结构', function () {
  s.eq('一副花色时 104 张', C.makeDeck(1).length, 104);
  s.eq('两副花色时也是 104 张', C.makeDeck(2).length, 104);
  s.eq('四副花色时也是 104 张', C.makeDeck(4).length, 104);
  var st = C.newState(88, 1);
  s.eq('10 列', st.cols.length, 10);
  s.eq('前四列 6 张后六列 5 张', st.cols.map(function (c) { return c.length; }), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
  s.eq('total = 54 已发 + 50 stock', [total(st), st.stock.length], [104, 50]);
  s.eq('每列仅顶牌翻开', st.cols.map(function (c) {
    return c.filter(function (x) { return x.up; }).length;
  }), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  s.eq('同种子确定', C.boardKey(C.newState(5, 2)), C.boardKey(C.newState(5, 2)));
  s.ok('不同种子不同', C.boardKey(C.newState(5, 1)) !== C.boardKey(C.newState(6, 1)));
  s.eq('难度写入局面', C.newState(1, 4).difficulty, 4);
});

s.group('落子规则', function () {
  s.ok('任意花色 5 接 6', C.canDrop({ r: 5, s: 0 }, { r: 6, s: 2, up: true }));
  s.ok('空列接受任意牌', C.canDrop({ r: 5, s: 0 }, null));
  s.ok('背面牌不能接', !C.canDrop({ r: 5, s: 0 }, { r: 6, s: 0, up: false }));
  s.ok('点数跳接非法', !C.canDrop({ r: 4, s: 0 }, { r: 6, s: 0, up: true }));
  s.ok('同花色连续串合法', C.isSuitRun([
    { r: 9, s: 0, up: true }, { r: 8, s: 0, up: true }, { r: 7, s: 0, up: true }
  ], 0));
  s.ok('混花色串非法', !C.isSuitRun([
    { r: 9, s: 0, up: true }, { r: 8, s: 1, up: true }
  ], 0));
  s.ok('背面串非法', !C.isSuitRun([{ r: 9, s: 0, up: false }], 0));
  s.ok('完整 K..A 判定', C.isCompleteRun(Array.from({ length: 13 }, function (_, i) {
    return { r: 13 - i, s: 3, up: true };
  })));
  s.ok('缺一张不算完整', !C.isCompleteRun(Array.from({ length: 12 }, function (_, i) {
    return { r: 13 - i, s: 3, up: true };
  })));
});

s.group('移动与发牌', function () {
  var st = C.newState(9, 1);
  var hint = C.findHint(st);
  s.ok('开局有可行提示', !!hint);
  if (hint) {
    var before = C.boardKey(st);
    s.ok('提示移动合法', C.applyMove(st, hint));
    s.ok('移动后局面改变', before !== C.boardKey(st));
  }
  s.ok('有 stock 且各列非空时可以发牌', C.canDeal(st));
  var stockBefore = st.stock.length;
  var colsBefore = st.cols.map(function (c) { return c.length; });
  s.ok('发一轮牌', C.dealStock(st));
  s.eq('stock 少 10 张', st.stock.length, stockBefore - 10);
  s.eq('每列各加 1 张', st.cols.map(function (c) { return c.length; }), colsBefore.map(function (n) { return n + 1; }));
  s.ok('空列存在时不能发牌', !C.canDeal({
    cols: [[], [], [], [], [], [], [], [{ r: 1, s: 0, up: true }], [], []],
    stock: [{ r: 2, s: 0 }], completed: 0, difficulty: 1, moves: 0
  }));
  s.ok('stock 为空不能发牌', !C.canDeal({
    cols: [[{ r: 1, s: 0, up: true }], [], [], [], [], [], [], [], [], []],
    stock: [], completed: 0, difficulty: 1, moves: 0
  }));
});

s.group('收牌与胜利', function () {
  var st = {
    cols: [[]], stock: [], completed: 0, difficulty: 1, moves: 0
  };
  st.cols = [];
  for (var i = 0; i < 10; i++) st.cols.push([]);
  st.cols[0] = Array.from({ length: 13 }, function (_, i) { return { r: 13 - i, s: 2, up: true }; });
  s.eq('自动收走完整串', C.collectRuns(st), 1);
  s.eq('completed 计数 +1', st.completed, 1);
  s.eq('收走后该列为空', st.cols[0].length, 0);
  s.eq('8 串即胜利', C.isWon({ completed: 8 }), true);
  s.ok('7 串未胜利', !C.isWon({ completed: 7 }));
  s.ok('克隆互不影响', (function () {
    var copy = C.cloneState(st);
    copy.completed = 99;
    return st.completed === 1;
  })());
});

s.done();
