'use strict';

// Chinese Checkers (checkers-jump) test. Engine lives in ENGINE START..END.

var lib = require('../tests/lib.js');
var s = lib.suite('checkers-jump');

var html = lib.page(__dirname);
var C = lib.evalBetween(html, '/* === ENGINE START === */', '/* === ENGINE END === */', 'CC');

s.group('星形棋盘', function () {
  s.eq('121 个孔位', C.COORDS.length, 121);
  s.eq('6 个三角区', C.ZONES.length, 6);
  s.eq('每区 10 孔', C.ZONES.map(function (z) { return z.length; }), [10, 10, 10, 10, 10, 10]);
  s.ok('邻接对称', C.NEI.every(function (ns, i) {
    return ns.every(function (j) { return C.NEI[j].indexOf(i) >= 0; });
  }));
  s.ok('每个孔至少一个邻居', C.NEI.every(function (ns) { return ns.length > 0; }));
  var e = C.emptyState([0, 1]);
  s.eq('空盘 121 孔全空', e.board.filter(function (x) { return x === -1; }).length, 121);
  s.eq('空盘两人', e.n, 2);
});

s.group('开局与对家', function () {
  var st = C.setup(6);
  s.eq('六人局 60 枚棋子', st.board.filter(function (x) { return x >= 0; }).length, 60);
  s.eq('每人占满本方 10 孔', [0, 1, 2, 3, 4, 5].map(function (p) {
    return st.board.filter(function (x) { return x === p; }).length;
  }), [10, 10, 10, 10, 10, 10]);
  var two = C.setup(2);
  s.eq('双人局对家起始区', [C.targetZone(two, 0), C.targetZone(two, 1)], [3, 0]);
  s.eq('开局轮到 0 号', two.turn, 0);
  s.ok('玩家 0 在起始区 0', C.ZONES[0].every(function (i) { return two.board[i] === 0; }));
  s.ok('玩家 1 在起始区 3', C.ZONES[3].every(function (i) { return two.board[i] === 1; }));
});

s.group('走子与连跳', function () {
  var st = C.setup(2);
  s.eq('开局合法着法 14', C.legalMoves(st, 0).length, 14);
  var all = [];
  for (var i = 0; i < st.board.length; i++) {
    if (st.board[i] === 0) all = all.concat(C.legalMovesFrom(st, i));
  }
  var jump = all.filter(function (m) { return m.jump; })[0];
  s.ok('存在连跳着法', !!jump);
  s.ok('连跳路径至少 2 点', jump && jump.path.length >= 2, jump && JSON.stringify(jump.path));
  s.ok('applyMove 返回新棋盘且不改原棋盘', (function () {
    var before = Array.from(st.board);
    var out = C.applyMove(st, jump);
    return out.board !== st.board && Array.from(st.board).join('') === before.join('');
  })());
  var next = C.applyMove(st, jump);
  s.eq('落子到目标点', next.board[jump.to], 0);
  s.eq('起点清空', next.board[jump.from], -1);
  s.eq('走子后换手', next.turn, 1);
  s.eq('nextTurn 循环', C.nextTurn(st, 0), 1);
  s.eq('nextTurn 回到首位', C.nextTurn(st, 1), 0);
  s.eq('非法起点无着法', C.legalMovesFrom(st, -1), []);
  s.eq('空点无着法', C.legalMovesFrom(C.emptyState([0, 1]), 0), []);
});

s.group('目标与胜负', function () {
  var st = C.setup(2);
  var d0 = C.distMap(st, 0);
  var m = C.legalMoves(st, 0).filter(function (x) {
    return d0[x.to] < d0[x.from];
  })[0];
  s.ok('存在靠近目标的着法', !!m);
  var before = C.sumDist(st, 0);
  var after = C.applyMove(st, m);
  s.ok('走一步后总距离下降', C.sumDist(after, 0) < before, before + ' -> ' + C.sumDist(after, 0));
  var win = C.setup(2);
  C.ZONES[C.targetZone(win, 0)].forEach(function (i) { win.board[i] = 0; });
  s.eq('占满对家三角即胜', C.winner(win), 0);
  s.eq('未占满不胜', C.winner(C.setup(2)), -1);
  var clone = C.clone(st);
  clone.board[C.ZONES[0][0]] = -1;
  s.ok('克隆互不影响', st.board[C.ZONES[0][0]] === 0);
  s.eq('evalFor 目标方给高分', C.evalFor(win, 0) > 0, true);
});

s.done();
