'use strict';

// Go 9x9 test. The engine is the __TEST_CORE_START__ .. __TEST_CORE_END__
// section of the page (groupAt / tryMove / legalMoves / scoreArea / chooseMove).

var lib = require('../tests/lib.js');
var s = lib.suite('go9');

var html = lib.page(__dirname);
var G = lib.evalBetween(html, '// __TEST_CORE_START__', '// __TEST_CORE_END__', '({' +
  'N:N,NN:NN,BLACK:BLACK,WHITE:WHITE,EMPTY:EMPTY,NB:NB,' +
  'groupAt:groupAt,tryMove:tryMove,legalMoves:legalMoves,' +
  'chooseMove:chooseMove,scoreArea:scoreArea' +
  '})');

function board() { return new Uint8Array(81); }

s.group('棋盘与邻接', function () {
  s.eq('9 路棋盘 81 格', [G.N, G.NN], [9, 81]);
  s.eq('中心 4 邻', G.NB[40].length, 4);
  s.eq('角上 2 邻', G.NB[0].length, 2);
  s.eq('边线 3 邻', G.NB[4].length, 3);
  s.eq('邻接对称', G.NB[40].every(function (j) { return G.NB[j].indexOf(40) >= 0; }), true);
});

s.group('棋串与气', function () {
  var b = board();
  b[40] = G.BLACK;
  var g1 = G.groupAt(b, 40);
  s.eq('单子四口气', g1.libs, 4);
  s.eq('单子串长 1', g1.stones.length, 1);
  b[41] = G.BLACK;
  var g2 = G.groupAt(b, 40);
  s.eq('两子串长 2', g2.stones.length, 2);
  s.eq('两子六口气', g2.libs, 6);
  s.eq('空点返回空串', G.groupAt(board(), 40).libs, 0);
  s.eq('空点串长 0', G.groupAt(board(), 40).stones.length, 0);
});

s.group('落子合法性', function () {
  s.eq('空盘黑有 81 个落点', G.legalMoves(board(), G.BLACK).length, 81);
  s.eq('越界拒绝', G.tryMove(board(), -1, G.BLACK).reason, 'offboard');
  s.eq('越界拒绝（大索引）', G.tryMove(board(), 81, G.BLACK).reason, 'offboard');
  var b = board();
  b[40] = G.BLACK;
  s.eq('已占点拒绝', G.tryMove(b, 40, G.WHITE).reason, 'occupied');
  s.eq('打劫点拒绝', G.tryMove(b, 49, G.WHITE, 49).reason, 'ko');
  var suicide = board();
  [31, 39, 41, 49].forEach(function (i) { suicide[i] = G.WHITE; });
  s.eq('自杀拒绝', G.tryMove(suicide, 40, G.BLACK).reason, 'suicide');
  s.ok('合法点返回新棋盘', (function () {
    var res = G.tryMove(board(), 40, G.BLACK);
    return res.legal && res.board[40] === G.BLACK && res.board !== board();
  })());
  s.ok('落子不修改原棋盘', (function () {
    var src = board();
    G.tryMove(src, 40, G.BLACK);
    return src[40] === G.EMPTY;
  })());
});

s.group('提子', function () {
  var b = board();
  b[40] = G.WHITE;
  [31, 39, 41].forEach(function (i) { b[i] = G.BLACK; }); // 白子仅剩 49 一口气
  var res = G.tryMove(b, 49, G.BLACK);
  s.ok('填最后一气可提子', res.legal);
  s.eq('提走白子', res.captured, [40]);
  s.eq('被提点变空', res.board[40], G.EMPTY);
  s.eq('提子后新串有气', G.groupAt(res.board, 49).libs >= 1, true);
  var alive = board();
  alive[40] = G.WHITE;
  [31, 39].forEach(function (i) { alive[i] = G.BLACK; });
  var res2 = G.tryMove(alive, 49, G.BLACK);
  s.eq('还有气时不提子', res2.captured, []);
});

s.group('数子与 AI', function () {
  var empty = G.scoreArea(board());
  s.eq('空盘中立 81 点', empty.neutral, 81);
  s.eq('空盘各 40.5 分', [empty.blackScore, empty.whiteScore], [40.5, 40.5]);
  var b = board();
  b[40] = G.BLACK;
  var one = G.scoreArea(b);
  s.eq('一子黑棋数出 81 分', one.blackScore, 81);
  s.eq('单方占满盘面', [one.blackTerritory, one.whiteTerritory], [80, 0]);
  var ai = G.chooseMove(board(), G.BLACK, 1);
  s.ok('AI 返回可落点', G.legalMoves(board(), G.BLACK).some(function (m) {
    return m.i === ai;
  }), 'got ' + ai);
  var full = new Uint8Array(81);
  for (var i = 0; i < 81; i++) full[i] = (i % 2) ? G.BLACK : G.WHITE;
  s.eq('满盘无合法点', G.legalMoves(full, G.BLACK).length, 0);
  s.eq('无合法点时 AI 返回 -1', G.chooseMove(full, G.BLACK, 1), -1);
});

s.done();
