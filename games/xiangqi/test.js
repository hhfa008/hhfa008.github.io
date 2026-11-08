'use strict';

// Chinese chess (xiangqi) test. The engine is the <script id="engine"> block.

var lib = require('../tests/lib.js');
var s = lib.suite('xiangqi');

var html = lib.page(__dirname);
var X = lib.evalScript(html, 'engine', 'globalThis.Xiangqi');

function empty() { return new Array(90).fill(null); }
function move(from, to) { return X.encode(from, to); }

s.group('开局局面', function () {
  var b = X.initialBoard();
  s.eq('32 枚棋子', b.filter(Boolean).length, 32);
  s.eq('红方 16 枚', b.filter(function (p) { return p && X.sideOfPiece(p) === X.RED; }).length, 16);
  s.eq('黑方 16 枚', b.filter(function (p) { return p && X.sideOfPiece(p) === X.BLACK; }).length, 16);
  s.eq('红帅在 85', X.kingSquare(b, X.RED), 85);
  s.eq('黑将在 4', X.kingSquare(b, X.BLACK), 4);
  s.eq('开局红方 44 种着法', X.legalMoves(b, X.RED).length, 44);
  var st = X.gameState(b, X.RED);
  s.eq('开局未被将军', st.check, false);
  s.eq('开局未结束', st.over, false);
  s.eq('开局状态着法数', st.moves.length, 44);
  s.eq('红向上为负行', X.sideOfPiece('R'), X.RED);
  s.eq('黑向下为正行', X.sideOfPiece('r'), X.BLACK);
  s.eq('typeOfPiece 忽略阵营', X.typeOfPiece('n'), 'N');
});

s.group('走子与撤销', function () {
  var b = X.initialBoard();
  var m = move(64, 63); // 红炮向左平移一格（空位）
  var before = b.slice();
  var cap = X.makeMove(b, m);
  s.eq('未吃子', cap, null);
  s.eq('起点清空', b[64], null);
  s.eq('终点落子', b[63], 'C');
  X.unmakeMove(b, m, cap);
  s.eq('撤销后完全还原', b, before);
  var b2 = X.initialBoard();
  b2[63] = 'C';
  b2[40] = 'p';
  var r = X.applyMove(b2, move(63, 40));
  s.eq('applyMove 返回被吃子', r.captured, 'p');
  s.eq('applyMove 新棋盘落子', r.board[40], 'C');
});

s.group('炮：必须翻一个炮架', function () {
  var b = empty();
  b[40] = 'C'; // 红炮
  b[13] = 'r'; // 黑车，同一列
  b[22] = 'P'; // 红兵作炮架
  var tos = X.pseudoMovesFrom(b, 40).map(function (m) { return X.moveTo(m); });
  s.ok('隔一子可吃黑车', tos.indexOf(13) >= 0);
  s.ok('不能落到炮架上', tos.indexOf(22) < 0);
  s.ok('可走到空位', tos.indexOf(31) >= 0);
  var b2 = empty();
  b2[40] = 'C';
  b2[13] = 'r'; // 中间无炮架
  var tos2 = X.pseudoMovesFrom(b2, 40).map(function (m) { return X.moveTo(m); });
  s.ok('无炮架不能吃子', tos2.indexOf(13) < 0);
});

s.group('马腿、象眼、士与将', function () {
  var b = empty();
  b[40] = 'N';
  s.eq('空盘马有 8 步', X.pseudoMovesFrom(b, 40).length, 8);
  b[49] = 'P'; // 别马腿
  s.eq('别马腿后剩 6 步', X.pseudoMovesFrom(b, 40).length, 6);
  s.eq('被别的两步不在列表', X.pseudoMovesFrom(b, 40)
    .map(function (m) { return X.moveTo(m); }).filter(function (t) { return t === 57 || t === 59; }).length, 0);

  var e = empty();
  e[83] = 'B';
  s.eq('红象两步', X.pseudoMovesFrom(e, 83).map(function (m) { return X.moveTo(m); }).sort(), [63, 67]);
  e[73] = 'P'; // 塞象眼
  s.eq('塞象眼后一步', X.pseudoMovesFrom(e, 83).map(function (m) { return X.moveTo(m); }), [67]);

  var a = empty();
  a[76] = 'A';
  s.eq('士在九宫 4 步', X.pseudoMovesFrom(a, 76).map(function (m) { return X.moveTo(m); }).sort(), [66, 68, 84, 86]);
  var k = empty();
  k[85] = 'K';
  s.eq('帅在九宫 3 步', X.pseudoMovesFrom(k, 85).map(function (m) { return X.moveTo(m); }).sort(), [76, 84, 86]);
});

s.group('兵与飞将', function () {
  var b = empty();
  b[56] = 'P';
  s.eq('未过河兵只向前', X.pseudoMovesFrom(b, 56).map(function (m) { return X.moveTo(m); }), [47]);
  var b2 = empty();
  b2[40] = 'P';
  s.eq('过河兵可横走', X.pseudoMovesFrom(b2, 40).map(function (m) { return X.moveTo(m); }).sort(), [31, 39, 41]);
  var b3 = empty();
  b3[4] = 'k';
  b3[85] = 'K';
  s.ok('飞将：同列无子红帅被黑将攻击', X.isAttacked(b3, 85, X.BLACK));
  s.ok('飞将：反向同样成立', X.isAttacked(b3, 4, X.RED));
  b3[49] = 'P';
  s.ok('中间有子时不成立', !X.isAttacked(b3, 85, X.BLACK));
});

s.done();
