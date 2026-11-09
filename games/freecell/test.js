'use strict';

// FreeCell test, running the <script id="freecell-core"> engine from the page.

var lib = require('../tests/lib.js');
var s = lib.suite('freecell');

var html = lib.page(__dirname);
var C = lib.evalScript(html, 'freecell-core', 'globalThis.FreeCellCore');

function emptyState() {
  return {
    free: [null, null, null, null],
    foundations: [[], [], [], []],
    cols: [[], [], [], [], [], [], [], []],
    moves: 0
  };
}

s.group('发牌结构', function () {
  var st = C.newState(42);
  s.eq('8 列', st.cols.length, 8);
  s.eq('前四列 7 张后四列 6 张', st.cols.map(function (c) { return c.length; }), [7, 7, 7, 7, 6, 6, 6, 6]);
  s.eq('52 张全部发出', st.cols.reduce(function (n, c) { return n + c.length; }, 0), 52);
  s.eq('四张空位', st.free.length, 4);
  s.eq('四个基础堆', st.foundations.length, 4);
  s.eq('同种子发牌确定', C.boardKey(C.newState(7)), C.boardKey(C.newState(7)));
  s.ok('不同种子不同', C.boardKey(C.newState(1)) !== C.boardKey(C.newState(2)));
});

s.group('叠牌与基础堆', function () {
  s.ok('黑 5 压红 6', C.canStack({ r: 5, s: 0 }, { r: 6, s: 1 }));
  s.ok('红 5 压黑 6', C.canStack({ r: 5, s: 1 }, { r: 6, s: 0 }));
  s.ok('同色不能压', !C.canStack({ r: 5, s: 0 }, { r: 6, s: 0 }));
  s.ok('点数不连续不能压', !C.canStack({ r: 4, s: 0 }, { r: 6, s: 1 }));
  s.ok('空列可放任意牌', C.canStack({ r: 4, s: 2 }, null));
  s.ok('A 上基础堆', C.canFoundation({ r: 1, s: 0 }, []));
  s.ok('K 接在 Q 上', C.canFoundation({ r: 13, s: 0 }, Array.from({ length: 12 }, function (_, i) { return { r: i + 1, s: 0 }; })));
  s.ok('2 不能直接上基础堆', !C.canFoundation({ r: 2, s: 0 }, []));
  s.ok('合法连续牌组', C.isRun([{ r: 7, s: 0 }, { r: 6, s: 1 }, { r: 5, s: 0 }], 0));
  s.ok('同色牌组非法', !C.isRun([{ r: 7, s: 0 }, { r: 6, s: 0 }], 0));
});

s.group('空位与超移动', function () {
  var st = emptyState();
  s.eq('空位 4 个', C.freeEmpty(st), 4);
  s.eq('空列 8 个', C.emptyCols(st), 8);
  s.eq('4 空位 8 空列可搬 1280 张', C.maxMove(st, false), 1280);
  st.cols[0] = [{ r: 5, s: 0 }];
  st.free[0] = { r: 1, s: 0 };
  s.eq('空位剩 3', C.freeEmpty(st), 3);
  s.eq('空列剩 7', C.emptyCols(st), 7);
  s.eq('非空目标列可搬 512 张', C.maxMove(st, false), 512);
  s.eq('搬到空列时该列要留出来，可搬 256 张', C.maxMove(st, true), 256);
});

s.group('移动合法性', function () {
  var st = emptyState();
  st.cols[0] = [{ r: 4, s: 1 }];
  st.free[0] = { r: 3, s: 0 };
  s.ok('空位 -> 列', C.applyMove(st, {
    from: { zone: 'free', cell: 0 },
    to: { zone: 'col', col: 0 }
  }));
  s.eq('空位清空', st.free[0], null);
  s.eq('列顶变为黑 3', st.cols[0][st.cols[0].length - 1].r, 3);

  var st2 = emptyState();
  st2.cols[0] = [{ r: 1, s: 0 }];
  s.ok('列 -> 基础堆', C.applyMove(st2, {
    from: { zone: 'col', col: 0, index: 0 },
    to: { zone: 'foundation', suit: 0 }
  }));
  s.eq('基础堆第一张 A', st2.foundations[0][0].r, 1);

  var st3 = emptyState();
  st3.cols[0] = [{ r: 5, s: 0 }, { r: 4, s: 1 }];
  s.ok('列 -> 空列（整段）', C.applyMove(st3, {
    from: { zone: 'col', col: 0, index: 1 },
    to: { zone: 'col', col: 1 }
  }));
  s.eq('源列剩 1 张', st3.cols[0].length, 1);
  s.eq('目标列 1 张', st3.cols[1].length, 1);
  s.ok('不能移动到同一列', !C.applyMove(st3, {
    from: { zone: 'col', col: 1, index: 0 },
    to: { zone: 'col', col: 1 }
  }));
  st3.free[1] = { r: 10, s: 0 };
  s.ok('不能移动到已占用的空位', !C.applyMove(st3, {
    from: { zone: 'col', col: 0, index: 0 },
    to: { zone: 'free', cell: 1 }
  }));
  s.eq('失败的移动不改变步数', st3.moves, 1);
});

s.group('胜利判定', function () {
  var st = emptyState();
  s.ok('开局未胜', !C.isWon(st));
  for (var suit = 0; suit < 4; suit++) {
    for (var r = 1; r <= 13; r++) st.foundations[suit].push({ r: r, s: suit });
  }
  s.ok('四堆 13 张为胜利', C.isWon(st));
  s.eq('胜利后再移动无意义', C.boardKey(st), C.boardKey(C.cloneState(st)));
});

s.done();
