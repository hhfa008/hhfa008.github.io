'use strict';

// Gomoku test. The rules engine is games/shared/rules.js, the single source
// used by both this page and the voice-room Worker.

var lib = require('../tests/lib.js');
var s = lib.suite('gomoku');

var R = require('../shared/rules.js').gomoku;
var N = R.N;

function b() { return new Int8Array(N * N); }
function put(board, r, c, p) { board[r * N + c] = p; }

s.group('棋盘常量', function () {
  s.eq('15 路', N, 15);
  s.eq('格数 225', R.NN, 225);
  s.eq('空 / 黑 / 白', [R.EMPTY, R.BLACK, R.WHITE], [0, 1, 2]);
  s.eq('四个方向', R.DIRS.length, 4);
  s.eq('索引与行列互逆', [R.rowOf(R.index(7, 8)), R.colOf(R.index(7, 8))], [7, 8]);
  s.eq('边界内', R.inBoard(0, 0) && R.inBoard(14, 14), true);
  s.ok('边界外', !R.inBoard(-1, 0) && !R.inBoard(0, 15));
});

s.group('连五判定', function () {
  var x = b();
  for (var c = 3; c < 8; c++) put(x, 7, c, R.BLACK);
  s.ok('横向连五', R.checkWinAt(x, 7, 5, R.BLACK));
  s.ok('四子不算胜', !R.checkWinAt(x, 7, 5, R.WHITE));

  x = b();
  for (var r = 2; r < 7; r++) put(x, r, 6, R.WHITE);
  s.ok('纵向连五', R.checkWinAt(x, 4, 6, R.WHITE));

  x = b();
  for (var k = 0; k < 5; k++) put(x, k, k, R.BLACK);
  s.ok('主对角线连五', R.checkWinAt(x, 2, 2, R.BLACK));

  x = b();
  for (k = 0; k < 5; k++) put(x, k, 10 - k, R.WHITE);
  s.ok('副对角线连五', R.checkWinAt(x, 2, 8, R.WHITE));

  x = b();
  for (c = 0; c < 5; c++) put(x, 0, c, R.BLACK);
  s.ok('贴边连五', R.checkWinAt(x, 0, 4, R.BLACK));

  x = b();
  for (c = 0; c < 4; c++) put(x, 5, c, R.BLACK);
  s.ok('四子不成五', !R.checkWinAt(x, 5, 3, R.BLACK));

  x = b();
  put(x, 5, 0, R.BLACK); put(x, 5, 1, R.BLACK);
  put(x, 5, 3, R.BLACK); put(x, 5, 4, R.BLACK); put(x, 5, 5, R.BLACK);
  s.ok('断开的五子不算', !R.checkWinAt(x, 5, 4, R.BLACK));

  x = b();
  for (c = 2; c < 8; c++) put(x, 3, c, R.BLACK);
  s.ok('长连六子也算胜', R.checkWinAt(x, 3, 5, R.BLACK));
  s.eq('长连返回 6 个点', R.lineAt(x, 3, 5, R.BLACK).length, 6);
});

s.group('胜利连线', function () {
  var x = b();
  for (var c = 4; c < 9; c++) put(x, 9, c, R.WHITE);
  var line = R.lineAt(x, 9, 6, R.WHITE);
  s.eq('连线 5 点', line.length, 5);
  s.eq('连线索引正确', line.map(function (i) { return [R.rowOf(i), R.colOf(i)]; }),
    [[9, 4], [9, 5], [9, 6], [9, 7], [9, 8]]);
  s.eq('非获胜子无连线', R.lineAt(x, 9, 9, R.BLACK), null);
  s.eq('空点无连线', R.lineAt(b(), 9, 9, R.BLACK), null);
  var v = b();
  put(v, 1, 1, R.BLACK);
  s.eq('单子无连线', R.lineAt(v, 1, 1, R.BLACK), null);
});

s.done();
