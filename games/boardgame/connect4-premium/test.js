'use strict';

/*
 * Connect 4 / 四子棋 premium — unit tests.
 *
 *   node games/boardgame/connect4-premium/test.js
 *
 * Asserts the real rules: 7×6=42 cells, gravity, red first, alternation,
 * 21 discs each, horizontal/vertical/diagonal wins with the winning line,
 * draw on a full board, no moves after game over, pure applyMove/clone/key,
 * publicView isolation, and the pure time-capped AI.
 */

var lib = require('../../tests/lib.js');
var s = lib.suite('connect4-premium');

var E = require('./engine.js');
var D = require('./data.js');

var ROWS = E.ROWS, COLS = E.COLS, CELLS = E.CELLS, P1 = E.P1, P2 = E.P2;

function idx(r, c) { return r * COLS + c; }
function boardWith(cells) {
  var b = new Int8Array(CELLS);
  cells.forEach(function (item) { b[idx(item[0], item[1])] = item[2]; });
  return b;
}
function fromMoves(seq) {
  var st = E.setup();
  for (var i = 0; i < seq.length; i++) st = E.applyMove(st, seq[i]);
  return st;
}
function sorted(a) { return a.slice().sort(function (x, y) { return x - y; }); }
function lcg(seed) {
  var x = seed >>> 0;
  return function () {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}
function assertContiguous(suite, st, label) {
  var ok = true, detail = '';
  for (var c = 0; c < COLS; c++) {
    var seenEmpty = false;
    for (var r = ROWS - 1; r >= 0; r--) {
      var v = st.b[idx(r, c)];
      if (v === 0) seenEmpty = true;
      else if (seenEmpty) { ok = false; detail = 'column ' + c + ' floats at row ' + r; break; }
    }
    if (!ok) break;
  }
  suite.ok(label, ok, detail);
}

s.group('棋盘、组件与初始状态', function () {
  s.eq('6 行', ROWS, 6);
  s.eq('7 列', COLS, 7);
  s.eq('恰好 42 格', CELLS, 42);
  s.eq('红方 P1', P1, 1);
  s.eq('黄方 P2', P2, 2);
  s.eq('四种连线窗口共 69 个', E.WINDOWS.length, 69);
  s.eq('每方 21 枚，合计 42 枚', [D.discsPerPlayer, D.totalDiscs], [21, 42]);
  s.eq('棋盘尺寸 250×220mm', [D.dimensions.boardWidthMm, D.dimensions.boardHeightMm], [250, 220]);
  s.eq('圆片直径 32mm', D.dimensions.discDiameterMm, 32);
  s.ok('格距 32mm 不小于圆片直径', D.dimensions.cellPitchMm >= D.dimensions.discDiameterMm);
  var st = E.setup();
  s.eq('开局 42 格全空', E.countOf(st.b, 0), 42);
  s.eq('红方先手', st.turn, P1);
  s.eq('开局 0 手', st.plies, 0);
  s.eq('开局 7 个合法列', E.legalMoves(st), [0, 1, 2, 3, 4, 5, 6]);
  s.eq('开局无最后落点', st.last, -1);
  s.eq('开局未结束', E.status(st).over, false);
  s.eq('开局无胜者', E.status(st).winner, 0);
});

s.group('重力、落子与合法性', function () {
  var st = E.setup();
  s.eq('空列落点在最底行', E.rowFor(st.b, 0), 5);
  s.eq('空列落点（中列）', E.rowFor(st.b, 3), 5);
  s.eq('列外 rowFor 返回 -1', E.rowFor(st.b, 7), -1);
  s.ok('列外非法 -1', !E.isLegal(st, -1));
  s.ok('列外非法 7', !E.isLegal(st, 7));
  s.ok('小数非法', !E.isLegal(st, 1.5));
  var one = E.applyMove(st, 3);
  s.eq('落子落在底行中列', one.last, idx(5, 3));
  s.eq('落子后换手', one.turn, P2);
  s.eq('落子后 1 手', one.plies, 1);
  s.eq('原局面未被修改（仍 0 手）', st.plies, 0);
  s.eq('原局面仍为空盘', E.countOf(st.b, 0), 42);
  s.eq('同列继续叠放', E.rowFor(one.b, 3), 4);
  s.ok('同列可以继续落子', E.isLegal(one, 3));
  var second = E.applyMove(one, 3);
  s.eq('第二枚贴在第一枚上方', second.b[idx(4, 3)], P2);
  s.eq('第三手回到红方', second.turn, P1);
  var full = E.setup();
  for (var k = 0; k < ROWS; k++) full = E.applyMove(full, 2);
  s.ok('满列不可落子', !E.isLegal(full, 2));
  s.eq('满列 rowFor=-1', E.rowFor(full.b, 2), -1);
  s.eq('满列从合法列中移除', E.legalMoves(full), [0, 1, 3, 4, 5, 6]);
  assertContiguous(s, full, '满列仍从底部连续堆叠');
  var seq = [6, 5, 3, 3, 5, 6, 1, 6, 2, 0, 1, 1, 0, 0, 1, 4, 6, 5, 4, 5, 6, 0, 2, 1];
  assertContiguous(s, fromMoves(seq), '24 手真实局面每列底部连续、无悬空');
});

s.group('四连判定：横 / 竖 / 两条斜线', function () {
  var st = fromMoves([0, 0, 1, 1, 2, 2, 3]);
  var res = E.status(st);
  s.eq('横向四连结束对局', res.over, true);
  s.eq('横向四连红方获胜', res.winner, P1);
  s.eq('横向胜利连线恰好 4 点', res.line.length, 4);
  s.eq('横向连线在底行 0..3', sorted(res.line), [35, 36, 37, 38]);

  st = fromMoves([0, 1, 0, 1, 0, 1, 0]);
  res = E.status(st);
  s.eq('纵向四连结束对局', res.over, true);
  s.eq('纵向四连红方获胜', res.winner, P1);
  s.eq('纵向连线 4 点', res.line.length, 4);
  s.eq('纵向连线在第 0 列', sorted(res.line), [14, 21, 28, 35]);

  var diag = boardWith([[5, 0, P1], [4, 1, P1], [3, 2, P1], [2, 3, P1]]);
  var w = E.scanWinner(diag);
  s.ok('主对角线四连检测到胜者', !!w && w.winner === P1);
  s.eq('主对角线连线 4 点', sorted(w.line), [17, 23, 29, 35]);

  var anti = boardWith([[2, 0, P2], [3, 1, P2], [4, 2, P2], [5, 3, P2]]);
  var w2 = E.scanWinner(anti);
  s.ok('副对角线四连检测到黄方', !!w2 && w2.winner === P2);
  s.eq('副对角线连线 4 点', sorted(w2.line), [14, 22, 30, 38]);

  var three = boardWith([[5, 0, P1], [5, 1, P1], [5, 2, P1]]);
  s.eq('三连不算胜', E.scanWinner(three), null);
  s.ok('wouldWin 预判第 3 列成四', E.wouldWin({ b: three, turn: P1, last: -1, plies: 3, first: P1 }, 3, P1));
  s.ok('wouldWin 不把第 4 列误判成四', !E.wouldWin({ b: three, turn: P1, last: -1, plies: 3, first: P1 }, 4, P1));
  var four = boardWith([[5, 0, P1], [5, 1, P1], [5, 2, P2], [5, 3, P1]]);
  s.ok('四格中有对方圆片时不算四连', !E.wouldWin({ b: four, turn: P1, last: -1, plies: 4, first: P1 }, 4, P1));

  var mixed = boardWith([[5, 0, P1], [5, 1, P1], [5, 2, P2], [5, 3, P1], [5, 4, P1]]);
  s.eq('被对方隔断的五格没有四连', E.scanWinner(mixed), null);

  var verticalGap = boardWith([[5, 0, P1], [4, 0, P2], [3, 0, P1], [2, 0, P1], [1, 0, P1]]);
  s.eq('纵向被隔断不算四连', E.scanWinner(verticalGap), null);
});

s.group('终局、平局与禁止落子', function () {
  var drawBoard = new Int8Array([
    2, 1, 2, 1, 1, 1, 2,
    2, 2, 1, 1, 2, 1, 2,
    1, 2, 2, 2, 1, 1, 1,
    2, 1, 1, 1, 2, 2, 1,
    1, 1, 2, 2, 1, 1, 2,
    2, 1, 2, 1, 2, 2, 2
  ]);
  var fullState = { b: drawBoard, turn: P1, last: 41, plies: 42, first: P1 };
  var st = E.status(fullState);
  s.eq('42 格填满判平局', st.draw, true);
  s.eq('平局 winner=0', st.winner, 0);
  s.eq('平局没有胜利连线', st.line, null);
  s.eq('满盘红方 21 枚', E.countOf(drawBoard, P1), 21);
  s.eq('满盘黄方 21 枚', E.countOf(drawBoard, P2), 21);
  s.eq('满盘合计 42 枚', E.countOf(drawBoard, P1) + E.countOf(drawBoard, P2), 42);
  s.eq('平局无合法列', E.legalMoves(fullState), []);
  s.ok('平局后落子非法', !E.isLegal(fullState, 0));
  s.eq('平局后 applyMove 返回 null', E.applyMove(fullState, 0), null);
  s.eq('平局后 status 仍为 draw', E.status(fullState).draw, true);

  var winState = fromMoves([0, 0, 1, 1, 2, 2, 3]);
  s.eq('胜利后 legalMoves 为空', E.legalMoves(winState), []);
  s.ok('胜利后 isLegal 为假', !E.isLegal(winState, 4));
  s.eq('胜利后不能再落子', E.applyMove(winState, 4), null);
  s.ok('胜利后 wouldWin 为假', !E.wouldWin(winState, 4, P2));
});

s.group('状态纯度、clone 与 key', function () {
  var st = E.setup();
  var c = E.clone(st);
  c.b[idx(5, 3)] = P1;
  c.turn = P2;
  c.plies = 9;
  s.eq('clone 修改不影响原局面棋盘', E.countOf(st.b, P1), 0);
  s.eq('clone 修改不影响原局面轮次', st.turn, P1);
  s.eq('clone 修改不影响原局面手数', st.plies, 0);
  s.eq('clone 携带原局面棋盘', E.countOf(c.b, P1), 1);

  var a = fromMoves([3, 3, 2]);
  var b = fromMoves([3, 3, 2]);
  s.eq('同一序列得到同一 key', E.key(a), E.key(b));
  s.ok('不同手数前缀 key 不同', E.key(a) !== E.key(fromMoves([3, 3])));
  var toggled = E.clone(a);
  toggled.turn = a.turn === P1 ? P2 : P1;
  s.ok('棋盘相同但轮次不同 key 不同', E.key(a) !== E.key(toggled));

  var before = E.key(a);
  var moved = E.applyMove(a, 4);
  s.eq('applyMove 不改变原局面 key', E.key(a), before);
  s.ok('applyMove 产生新局面', E.key(moved) !== before);
  s.eq('applyMove 返回新数组', moved.b !== a.b, true);
  s.eq('applyMove 返回的 plies 递增', [a.plies, moved.plies], [3, 4]);
});

s.group('publicView 公共视图', function () {
  var st = fromMoves([3, 3]);
  var v0 = E.publicView(st, 0);
  var v1 = E.publicView(st, 1);
  s.eq('公共视图 board 是普通数组', Array.isArray(v0.board), true);
  s.eq('公共视图 42 格', v0.board.length, 42);
  s.eq('公共视图行列正确', [v0.rows, v0.cols], [6, 7]);
  s.eq('红方 1 枚 / 黄方 1 枚', v0.counts, { red: 1, yellow: 1 });
  s.eq('公共视图轮次', v0.turn, P1);
  s.eq('公共视图合法列 7 个', v0.legalColumns.length, 7);
  s.eq('座位 0 轮到自己', v0.yourTurn, true);
  s.eq('座位 1 尚未轮到自己', v1.yourTurn, false);
  s.eq('座位颜色 0=红', v0.yourColor, P1);
  s.eq('座位颜色 1=黄', v1.yourColor, P2);
  s.eq('公共视图最后落点', v0.last, 31);
  v0.board[0] = 2;
  s.eq('修改公共视图不影响权威状态', E.countOf(st.b, P2), 1);
  v0.legalColumns.push(9);
  s.eq('合法列数组是副本', E.legalMoves(st).length, 7);
  var win = E.publicView(fromMoves([0, 0, 1, 1, 2, 2, 3]), 0);
  s.eq('公共视图公开胜者', win.winner, P1);
  s.eq('公共视图公开胜利连线', win.line.length, 4);
  s.eq('公共视图结束标记', win.over, true);
  s.eq('结束后无合法列', win.legalColumns, []);
});

s.group('AI：立即取胜、立即阻挡、中心偏好、不越界', function () {
  var three = boardWith([[5, 0, P1], [5, 1, P1], [5, 2, P1]]);
  var s1 = { b: three, turn: P1, last: -1, plies: 3, first: P1 };
  s.eq('简单 AI 抓自己的必胜点', E.aiMove(s1, 1), 3);
  s.eq('普通 AI 抓自己的必胜点', E.aiMove(s1, 2, 60), 3);
  s.eq('困难 AI 抓自己的必胜点', E.aiMove(s1, 3, 60), 3);

  var block = boardWith([[5, 0, P2], [5, 1, P2], [5, 2, P2]]);
  var s2 = { b: block, turn: P1, last: -1, plies: 3, first: P1 };
  s.eq('简单 AI 挡对手的四连', E.aiMove(s2, 1), 3);
  s.eq('普通 AI 挡对手的四连', E.aiMove(s2, 2, 60), 3);
  s.eq('困难 AI 挡对手的四连', E.aiMove(s2, 3, 60), 3);

  var both = boardWith([[5, 0, P1], [5, 1, P1], [5, 2, P1], [4, 0, P2], [4, 1, P2], [4, 2, P2]]);
  var s3 = { b: both, turn: P1, last: -1, plies: 6, first: P1 };
  s.eq('自己可胜时优先取胜而非阻挡', E.aiMove(s3, 2, 80), 3);

  var empty = E.setup();
  s.eq('简单 AI 开局选中间列', E.aiMove(empty, 1), 3);
  s.ok('普通 AI 开局偏向中间列', [2, 3, 4].indexOf(E.aiMove(empty, 2, 120)) >= 0, 'col ' + E.aiMove(empty, 2, 120));
  s.ok('困难 AI 开局偏向中间列', [2, 3, 4].indexOf(E.aiMove(empty, 3, 200)) >= 0, 'col ' + E.aiMove(empty, 3, 200));

  var st = E.setup();
  var before = E.key(st);
  E.aiMove(st, 3, 80);
  s.eq('AI 是纯函数：局面不变', E.key(st), before);

  var seed = 20241110;
  var legalAlways = true, pureAlways = true, playCount = 0;
  var probe = E.setup();
  for (var game = 0; game < 6; game++) {
    probe = E.setup();
    for (var step = 0; step < 42 && !E.status(probe).over; step++) {
      var level = 1 + (game % 3);
      var k0 = E.key(probe);
      var col = E.aiMove(probe, level, 20);
      seed = (seed * 1103515245 + 12345) >>> 0;
      if (E.key(probe) !== k0) pureAlways = false;
      if (col == null || E.legalMoves(probe).indexOf(col) < 0) { legalAlways = false; break; }
      probe = E.applyMove(probe, col);
      if (!probe) { legalAlways = false; break; }
      playCount += 1;
    }
  }
  s.ok('6 局 AI 自对弈从不返回非法列', legalAlways);
  s.ok('AI 自对弈不修改传入局面', pureAlways);
  s.ok('自对弈确实产生了落子', playCount > 50, 'plies ' + playCount);

  var hardStart = Date.now();
  var hardCol = E.aiMove(E.setup(), 3, 400);
  var hardMs = Date.now() - hardStart;
  s.ok('困难 AI 在 400ms 限时内返回', hardMs <= 800, hardMs + 'ms');
  s.ok('困难 AI 返回合法列', E.legalMoves(E.setup()).indexOf(hardCol) >= 0, String(hardCol));

  var full = E.setup();
  for (var f = 0; f < 42; f++) {
    var lm = E.legalMoves(full);
    if (!lm.length) break;
    full = E.applyMove(full, lm[0]);
  }
  s.eq('终局 AI 返回 null', E.aiMove(full, 3, 40), null);
});

s.group('自对弈守恒与终局一致性', function () {
  var g = E.selfPlay(2, 42);
  var st = E.status(g);
  s.ok('自对弈在 42 手内结束', st.over, 'plies ' + g.plies);
  s.ok('终局手数与盘面圆片一致', E.countOf(g.b, P1) + E.countOf(g.b, P2) === g.plies);
  s.ok('红方圆片数符合先手交替', E.countOf(g.b, P1) === Math.ceil(g.plies / 2));
  s.ok('黄方圆片数符合后手交替', E.countOf(g.b, P2) === Math.floor(g.plies / 2));
  s.ok('终局每列从底部连续', (function () {
    for (var c = 0; c < COLS; c++) {
      var empty = false;
      for (var r = ROWS - 1; r >= 0; r--) {
        if (g.b[idx(r, c)] === 0) empty = true;
        else if (empty) return false;
      }
    }
    return true;
  })());
  var st2 = E.status(g);
  if (st2.winner) {
    s.eq('若分胜负则连线长度至少 4', st2.line.length >= 4, true);
    s.ok('胜者属于盘面颜色', st2.winner === P1 || st2.winner === P2);
    s.ok('胜利连线每格都是胜者颜色', st2.line.every(function (i) { return g.b[i] === st2.winner; }));
  } else {
    s.eq('否则必须是满盘平局', [g.plies, st2.draw], [42, true]);
  }
  var one = E.applyMove(E.setup(), 0);
  s.eq('1 手后红 1 黄 0', [E.countOf(one.b, P1), E.countOf(one.b, P2)], [1, 0]);
  var two = E.applyMove(one, 1);
  s.eq('2 手后红 1 黄 1', [E.countOf(two.b, P1), E.countOf(two.b, P2)], [1, 1]);
});

s.done();
