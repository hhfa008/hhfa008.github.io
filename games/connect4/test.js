'use strict';

// Connect Four test. The rules engine is games/shared/rules.js.

var lib = require('../tests/lib.js');
var s = lib.suite('connect4');

var R = require('../shared/rules.js').connect4;
var ROWS = R.ROWS, COLS = R.COLS;

function idx(r, c) { return r * COLS + c; }

s.group('棋盘与落子', function () {
  s.eq('6 行 7 列', [ROWS, COLS], [6, 7]);
  s.eq('阵营 1/2', [R.P1, R.P2], [1, 2]);
  var st = R.setup();
  s.eq('空盘 42 格', Array.from(st.b).filter(Boolean).length, 0);
  s.eq('先手 P1', st.turn, R.P1);
  s.eq('开局 7 个合法列', R.legalMoves(st), [0, 1, 2, 3, 4, 5, 6]);
  s.eq('空列落点在最底行', R.rowFor(st.b, 3), 5);
  s.ok('列外非法', !R.isLegal(st, -1) && !R.isLegal(st, 7));
  var mv = R.applyMove(st, 3);
  s.eq('落子到第 3 列底部', mv.last, idx(5, 3));
  s.eq('落子后换手', mv.turn, R.P2);
  s.eq('落子后 plies=1', mv.plies, 1);
  s.eq('原局面未变', Array.from(st.b).filter(Boolean).length, 0);
  s.ok('同一列可以继续叠', R.isLegal(mv, 3));
});

s.group('连线判定', function () {
  var st = R.setup();
  // P1 第 0 列四子，P2 第 1 列三子，间隔落子
  var seq = [0, 1, 0, 1, 0, 1, 0];
  var cur = st;
  for (var i = 0; i < seq.length; i++) cur = R.applyMove(cur, seq[i]);
  var res = R.status(cur);
  s.ok('纵向四连获胜', res.over && res.winner === R.P1);
  s.eq('胜利连线 4 点', res.line.length, 4);

  var st2 = R.setup();
  seq = [0, 0, 1, 1, 2, 2, 3];
  cur = st2;
  for (i = 0; i < seq.length; i++) cur = R.applyMove(cur, seq[i]);
  res = R.status(cur);
  s.ok('横向四连获胜', res.over && res.winner === R.P1);

  var d = new Int8Array(ROWS * COLS);
  [[5, 0], [4, 1], [3, 2], [2, 3]].forEach(function (p) { d[idx(p[0], p[1])] = R.P1; });
  var w = R.scanWinner(d);
  s.ok('主对角线四连', !!w && w.winner === R.P1);
  s.eq('主对角线连线', w.line, [[2, 3], [3, 2], [4, 1], [5, 0]].map(function (p) { return idx(p[0], p[1]); }));

  var a = new Int8Array(ROWS * COLS);
  [[2, 0], [3, 1], [4, 2], [5, 3]].forEach(function (p) { a[idx(p[0], p[1])] = R.P2; });
  var w2 = R.scanWinner(a);
  s.ok('副对角线四连', !!w2 && w2.winner === R.P2);

  var three = new Int8Array(ROWS * COLS);
  [[5, 0], [5, 1], [5, 2]].forEach(function (p) { three[idx(p[0], p[1])] = R.P1; });
  s.eq('三连不算胜', R.scanWinner(three), null);
  s.ok('wouldWin 预判第 3 列', R.wouldWin({ b: three, turn: R.P1, last: -1, plies: 3 }, 3, R.P1));
  s.ok('空列不能立即获胜', !R.wouldWin({ b: three, turn: R.P1, last: -1, plies: 3 }, 4, R.P1));
});

s.group('状态与 AI', function () {
  s.eq('开局未结束', R.status(R.setup()).over, false);
  var full = { b: new Int8Array(ROWS * COLS), turn: R.P1, last: -1, plies: 42 };
  s.eq('落满 42 手判和', R.status(full).draw, true);

  var three = new Int8Array(ROWS * COLS);
  [[5, 0], [5, 1], [5, 2]].forEach(function (p) { three[idx(p[0], p[1])] = R.P1; });
  var s1 = { b: three, turn: R.P1, last: -1, plies: 3 };
  s.eq('简单 AI 抓自己的必胜点', R.aiMove(s1, 1), 3);

  var block = new Int8Array(ROWS * COLS);
  [[5, 0], [5, 1], [5, 2]].forEach(function (p) { block[idx(p[0], p[1])] = R.P2; });
  var s2 = { b: block, turn: R.P1, last: -1, plies: 3 };
  s.eq('简单 AI 挡对手的四连', R.aiMove(s2, 1), 3);

  var mid = R.aiMove(R.setup(), 2, 80);
  s.ok('二层 AI 返回合法列', R.legalMoves(R.setup()).indexOf(mid) >= 0, 'got ' + mid);

  var copy = R.clone(R.setup());
  copy.plies = 99;
  s.eq('克隆互相独立', R.setup().plies, 0);
  s.eq('满列不可落子', R.legalMoves({
    b: (function () { var b = new Int8Array(ROWS * COLS); for (var r = 0; r < ROWS; r++) b[idx(r, 2)] = R.P1; return b; })(),
    turn: R.P1, last: -1, plies: 6
  }), [0, 1, 3, 4, 5, 6]);
});

s.done();
