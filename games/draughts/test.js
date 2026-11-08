'use strict';

// Draughts (8x8 checkers) test. Engine lives in ENGINE START..END.

var lib = require('../tests/lib.js');
var s = lib.suite('draughts');

var html = lib.page(__dirname);
var D = lib.evalBetween(html, '/* === ENGINE START === */', '/* === ENGINE END === */', 'DR');

function put(b, r, c, p) { b[D.sq(r, c)] = p; }

s.group('坐标与开局', function () {
  s.eq('64 格', D.sq(7, 7) + 1, 64);
  s.eq('a8 是 0', D.coord(0), 'a8');
  s.eq('h1 是 63', D.coord(63), 'h1');
  s.eq('行列为右下角 7,7', [D.row(D.sq(7, 7)), D.col(D.sq(7, 7))], [7, 7]);
  s.ok('(0,1) 是深色格', D.isDark(0, 1));
  s.ok('(0,0) 不是深色格', !D.isDark(0, 0));
  var st = D.setup();
  s.eq('双方各 12 子', [D.countPieces(st, D.WHITE), D.countPieces(st, D.BLACK)], [12, 12]);
  s.eq('白先走', st.turn, D.WHITE);
  s.eq('开局 7 种走法', D.legalMoves(st).length, 7);
  s.ok('棋子只在深色格', (function () {
    for (var i = 0; i < 64; i++) {
      if (st.board[i] !== 0 && !D.isDark(D.row(i), D.col(i))) return false;
    }
    return true;
  })());
  s.eq('棋子阵营判定', [D.pieceSide(1), D.pieceSide(-1), D.pieceSide(0)], [1, -1, 0]);
  s.ok('白兵不是王', !D.isKing(1));
  s.ok('黑王是王', D.isKing(-2));
});

s.group('必吃与连吃', function () {
  var b = new Int8Array(64);
  put(b, 5, 2, 1);
  put(b, 4, 3, -1);
  var st = { board: b, turn: 1, sinceProgress: 0 };
  var moves = D.legalMoves(st);
  s.eq('有吃子时只返回吃子', moves.length, 1);
  s.eq('吃子路径', [moves[0].from, moves[0].to, moves[0].captures], [D.sq(5, 2), D.sq(3, 4), [D.sq(4, 3)]]);
  var after = D.applyMove(st, moves[0]);
  s.eq('被吃子移除', after.board[D.sq(4, 3)], 0);
  s.eq('落点为己方子', after.board[D.sq(3, 4)], 1);
  s.eq('换手', after.turn, -1);
  s.eq('吃子重置进度计数', after.sinceProgress, 0);

  var b2 = new Int8Array(64);
  put(b2, 5, 2, 1);
  put(b2, 4, 3, -1);
  put(b2, 2, 5, -1);
  var st2 = { board: b2, turn: 1, sinceProgress: 0 };
  var chain = D.legalMoves(st2);
  s.eq('连吃合并为一步', chain.length, 1);
  s.eq('连吃终点在 (1,6)', chain[0].to, D.sq(1, 6));
  s.eq('连吃吃掉两子', chain[0].captures, [D.sq(4, 3), D.sq(2, 5)]);
  var after2 = D.applyMove(st2, chain[0]);
  s.eq('两枚敌子都清空', [after2.board[D.sq(4, 3)], after2.board[D.sq(2, 5)]], [0, 0]);
  s.ok('moveBySquares 选中连吃', (function () {
    var m = D.moveBySquares(st2, D.sq(5, 2), D.sq(1, 6));
    return m && m.captures.length === 2;
  })());
});

s.group('升王与状态', function () {
  var b = new Int8Array(64);
  put(b, 1, 2, 1);
  var st = { board: b, turn: 1, sinceProgress: 0 };
  var moves = D.legalMoves(st);
  s.eq('白兵到顶线两步均可升王', moves.length, 2);
  s.ok('着法标记升王', moves.every(function (m) { return m.promoted; }));
  s.eq('升王落点', moves.map(function (m) { return m.to; }).sort(), [D.sq(0, 1), D.sq(0, 3)]);
  var crowned = D.applyMove(st, moves[0]);
  s.ok('升王后棋子为白王', crowned.board[moves[0].to] === 2);

  var empty = { board: new Int8Array(64), turn: 1, sinceProgress: 0 };
  s.eq('空盘判和（empty）', D.gameStatus(empty), { over: true, winner: 0, reason: 'empty' });
  var onlyWhite = D.setup();
  for (var i = 0; i < 64; i++) if (onlyWhite.board[i] < 0) onlyWhite.board[i] = 0;
  s.eq('黑方无子则白胜', D.gameStatus(onlyWhite).winner, D.WHITE);
  var onlyBlack = D.setup();
  for (i = 0; i < 64; i++) if (onlyBlack.board[i] > 0) onlyBlack.board[i] = 0;
  s.eq('白方无子则黑胜', D.gameStatus(onlyBlack).winner, D.BLACK);
  var draw = D.setup();
  draw.sinceProgress = 80;
  s.eq('80 步无进展判和', D.gameStatus(draw).reason, 'draw');
  s.eq('开局未结束', D.gameStatus(D.setup()).over, false);
  var clone = D.clone(st);
  clone.board[0] = 9;
  s.ok('克隆互不影响', st.board[0] !== 9);
  s.ok('评估函数返回数值', typeof D.evaluate(D.setup()) === 'number');
});

s.done();
