'use strict';

// Chess test. The engine is the <script id="engine"> block (UMD, exports Chess).
// perft at depths 1-3 pins the whole move generator.

var lib = require('../tests/lib.js');
var s = lib.suite('chess');

var html = lib.page(__dirname);
var C = lib.evalScript(html, 'engine', 'globalThis.Chess');

s.group('开局与 perft', function () {
  var pos = C.initialPosition();
  s.eq('初始 32 枚棋子', pos.board.filter(Boolean).length, 32);
  s.eq('白方先行', pos.turn, 'w');
  s.eq('perft(1) = 20', C.perft(C.initialPosition(), 1), 20);
  s.eq('perft(2) = 400', C.perft(C.initialPosition(), 2), 400);
  s.eq('perft(3) = 8902', C.perft(C.initialPosition(), 3), 8902);
  s.eq('开局将法 20', C.legalMoves(pos).length, 20);
  s.ok('开局未被将军', !C.inCheck(pos, 'w'));
  s.eq('开局局面状态', C.gameStatus(pos).over, false);
});

s.group('FEN 与走子往返', function () {
  var pos = C.fromFEN('8/8/8/4k3/8/3QK3/8/8 w - - 0 1');
  s.eq('棋子摆放', pos.board[43], 'Q');
  s.eq('黑王位置', C.kingSquare(pos, 'b'), 28);
  var ep = C.fromFEN('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
  s.eq('吃过路兵目标格', ep.ep, 44);
  var p2 = C.initialPosition();
  var key = C.positionKey(p2);
  var move = C.legalMoves(p2)[0];
  var undo = C.makeMove(p2, move);
  s.ok('走子后局面变化', C.positionKey(p2) !== key);
  C.unmakeMove(p2, move, undo);
  s.eq('撤销后局面还原', C.positionKey(p2), key);
  s.eq('起始 FEN 可解析', C.fromFEN(C.START_FEN).board.filter(Boolean).length, 32);
});

s.group('将死与逼和', function () {
  var mate = C.gameStatus(C.fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'));
  s.ok('后车杀是 checkmate', mate.over && mate.result === 'checkmate');
  s.eq('杀棋胜方为白', mate.winner, 'w');
  var stale = C.gameStatus(C.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'));
  s.ok('无合法着法但未被将军 = stalemate', stale.over && stale.result === 'stalemate');
  s.eq('逼和无胜方', stale.winner, null);
  var check = C.inCheck(C.fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1'), 'b');
  s.ok('黑王处于被将状态', check);
});

s.group('子力不足与规则边界', function () {
  s.ok('王对王 = 子力不足', C.insufficientMaterial(C.fromFEN('8/8/8/8/8/8/8/K6k w - - 0 1')));
  s.ok('王对王单马 = 子力不足', C.insufficientMaterial(C.fromFEN('8/8/8/8/8/8/7n/K6k w - - 0 1')));
  s.ok('王对王单车 = 可杀', !C.insufficientMaterial(C.fromFEN('8/8/8/8/8/8/7r/K6k w - - 0 1')));
  s.ok('王对王单象 = 子力不足', C.insufficientMaterial(C.fromFEN('8/8/8/8/8/8/7b/K6k w - - 0 1')));
  var fifty = C.fromFEN('7k/8/6K1/8/8/8/8/8 w - - 100 1');
  s.eq('50 回合规则', C.gameStatus(fifty).result, 'fifty');
  var rep = C.fromFEN('7k/8/6K1/8/8/8/8/R7 w - - 0 1');
  var k = C.positionKey(rep);
  s.eq('三次重复局面', C.gameStatus(rep, [k, k, k]).result, 'repetition');
});

s.done();
