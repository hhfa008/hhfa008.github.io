'use strict';

// Reversi test. The engine is the __TEST_CORE_START__ .. __TEST_CORE_END__
// section of the page (the same functions the UI calls).

var lib = require('../tests/lib.js');
var s = lib.suite('reversi');

var html = lib.page(__dirname);
var R = lib.evalBetween(html, '// __TEST_CORE_START__', '// __TEST_CORE_END__', '({' +
  'S:S,NN:NN,BLACK:BLACK,WHITE:WHITE,EMPTY:EMPTY,WEIGHT:WEIGHT,' +
  'flipsAt:flipsAt,legalFor:legalFor,hasMoves:hasMoves,count:count,' +
  'applyMove:applyMove,undoMove:undoMove,posScore:posScore,chooseMove:chooseMove' +
  '})');

function initialBoard() {
  var b = new Uint8Array(R.NN);
  b[3 * R.S + 3] = R.WHITE;
  b[3 * R.S + 4] = R.BLACK;
  b[4 * R.S + 3] = R.BLACK;
  b[4 * R.S + 4] = R.WHITE;
  return b;
}
function at(r, c) { return r * R.S + c; }

s.group('开局', function () {
  var b = initialBoard();
  s.eq('棋盘 64 格', R.NN, 64);
  s.eq('开局黑 2 白 2', [R.count(b, R.BLACK), R.count(b, R.WHITE)], [2, 2]);
  s.eq('黑方 4 个合法点', R.legalFor(b, R.BLACK).map(function (m) { return m.i; }).sort(), [19, 26, 37, 44]);
  s.eq('白方 4 个合法点', R.legalFor(b, R.WHITE).map(function (m) { return m.i; }).sort(), [20, 29, 34, 43]);
  s.ok('黑方有子可下', R.hasMoves(b, R.BLACK));
  s.ok('白方有子可下', R.hasMoves(b, R.WHITE));
});

s.group('翻转规则', function () {
  var b = initialBoard();
  s.eq('黑下 (2,3) 翻 (3,3)', R.flipsAt(b, 2, 3, R.BLACK), [at(3, 3)]);
  s.eq('白下 (2,4) 翻 (3,4)', R.flipsAt(b, 2, 4, R.WHITE), [at(3, 4)]);
  s.eq('已占格不能下', R.flipsAt(b, 3, 3, R.BLACK), null);
  s.eq('无夹击返回 null', R.flipsAt(b, 0, 0, R.BLACK), null);
  s.eq('自己棋子不能翻转自己', R.flipsAt(b, 3, 4, R.WHITE), null);
  s.eq('黑下 (2,3) 翻 1 枚', R.flipsAt(b, 2, 3, R.BLACK).length, 1);
});

s.group('落子与撤销', function () {
  var b = initialBoard();
  var before = new Uint8Array(b);
  var move = R.legalFor(b, R.BLACK).filter(function (m) { return m.i === 19; })[0];
  R.applyMove(b, move, R.BLACK);
  s.eq('落子格变黑', b[19], R.BLACK);
  s.eq('被夹的白子翻黑', b[at(3, 3)], R.BLACK);
  s.eq('黑棋变为 4 枚', R.count(b, R.BLACK), 4);
  s.eq('白棋剩 1 枚', R.count(b, R.WHITE), 1);
  R.undoMove(b, move, R.BLACK);
  s.eq('撤销后棋盘还原', Array.from(b), Array.from(before));
  s.eq('撤销后计数还原', [R.count(b, R.BLACK), R.count(b, R.WHITE)], [2, 2]);
});

s.group('评分与 AI', function () {
  var b = initialBoard();
  s.eq('黑白位置分互为相反数', R.posScore(b, R.BLACK), -R.posScore(b, R.WHITE));
  var b2 = new Uint8Array(R.NN);
  b2[1] = R.WHITE;
  b2[2] = R.BLACK;
  var easy = R.chooseMove(b2, R.BLACK, 1);
  s.eq('简单 AI 优先占角', easy, 0);
  var l2 = R.chooseMove(initialBoard(), R.BLACK, 2);
  s.ok('普通 AI 返回合法点', R.legalFor(initialBoard(), R.BLACK).some(function (m) { return m.i === l2; }), 'got ' + l2);
  var full = new Uint8Array(R.NN);
  for (var i = 0; i < full.length; i++) full[i] = (i % 2) ? R.BLACK : R.WHITE;
  s.eq('满盘无合法点', R.legalFor(full, R.BLACK).length, 0);
  s.eq('无合法点时 AI 返回 -1', R.chooseMove(full, R.BLACK, 1), -1);
});

s.done();
