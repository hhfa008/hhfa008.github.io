'use strict';

// Chess premium — FIDE rules, perft, AI, presentation and artifact tests.
// Runs standalone (no Chrome) and through games/tests/run-all.js.
// Prints the machine-readable RESULT line consumed by run-all.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('chess-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function size(name) { return exists(name) ? fs.statSync(path.join(__dirname, name)).size : 0; }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function webpSize(file) {
  var b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  var chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    var bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  return null;
}
function countPieces(pos) {
  var out = { P: 0, N: 0, B: 0, R: 0, Q: 0, K: 0, p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 };
  pos.board.forEach(function (p) { if (p) out[p] += 1; });
  return out;
}
function playUci(game, uci) {
  var m = E.moveFromUCI(game.pos, uci);
  if (!m) throw new Error('test fixture move not legal: ' + uci);
  return E.applyMove(game, m);
}

s.group('初始局面与 FEN', function () {
  var p = E.initialPosition();
  var counts = countPieces(p);
  s.eq('32 枚棋子', p.board.filter(Boolean).length, 32);
  s.eq('白方 16 枚', p.board.filter(function (x) { return x && E.isWhitePiece(x); }).length, 16);
  s.eq('黑方 16 枚', p.board.filter(function (x) { return x && !E.isWhitePiece(x); }).length, 16);
  s.eq('全局 16 兵', counts.P + counts.p, 16);
  s.eq('全局 4 马', counts.N + counts.n, 4);
  s.eq('全局 4 象', counts.B + counts.b, 4);
  s.eq('全局 4 车', counts.R + counts.r, 4);
  s.eq('全局 2 后', counts.Q + counts.q, 2);
  s.eq('全局 2 王', counts.K + counts.k, 2);
  s.eq('白方 8 兵 2 马 2 象 2 车 1 后 1 王', [counts.P, counts.N, counts.B, counts.R, counts.Q, counts.K], [8, 2, 2, 2, 1, 1]);
  s.eq('黑方 8 兵 2 马 2 象 2 车 1 后 1 王', [counts.p, counts.n, counts.b, counts.r, counts.q, counts.k], [8, 2, 2, 2, 1, 1]);
  s.eq('白方先行', p.turn, 'w');
  s.eq('开局易位权 KQkq', p.castling, 'KQkq');
  s.eq('开局无吃过路兵目标', p.ep, -1);
  s.eq('半回合计数 0', p.half, 0);
  s.eq('完整回合 1', p.full, 1);
  s.eq('a1 白车', p.board[56], 'R');
  s.eq('d1 白后', p.board[59], 'Q');
  s.eq('e1 白王', p.board[60], 'K');
  s.eq('e8 黑王', p.board[4], 'k');
  s.eq('d8 黑后', p.board[3], 'q');
  s.eq('FEN 往返完全一致', E.toFEN(p), E.START_FEN);
  s.eq('FEN 可重新解析', E.toFEN(E.fromFEN(E.START_FEN)), E.START_FEN);
  s.eq('开局 20 个合法着法', E.legalMoves(p).length, 20);
  s.eq('e2 兵两个着法', E.legalMovesFrom(p, 52).length, 2);
  s.ok('e2e4 可在合法着法中定位', !!E.moveFromUCI(p, 'e2e4'));
  s.ok('无升变字母时普通着法可定位', !!E.moveFromUCI(p, 'g1f3'));
  var threw = false;
  try { E.fromFEN('8/8/8/8/8/8/8/8 w - - 0 1'); } catch (e) { threw = true; }
  s.ok('无王 FEN 被拒绝', threw);
  threw = false;
  try { E.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP w KQkq - 0 1'); } catch (e) { threw = true; }
  s.ok('不足 8 行 FEN 被拒绝', threw);
  threw = false;
  try { E.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1'); } catch (e) { threw = true; }
  s.ok('非法行棋方 FEN 被拒绝', threw);
  var c = E.clonePosition(p);
  c.board[0] = null;
  s.eq('clone 不影响原局面', p.board[0], 'r');
  ['initialPosition', 'fromFEN', 'toFEN', 'legalMoves', 'makeMove', 'unmakeMove',
    'inCheck', 'gameStatus', 'positionKey', 'perft', 'aiMove', 'publicView'].forEach(function (name) {
    s.ok('引擎 API ' + name, typeof E[name] === 'function');
  });
  var view = E.publicView(p, 1);
  s.eq('publicView 64 格', view.board.length, 64);
  s.eq('publicView 座位移', view.seat, 1);
  s.eq('publicView 合法着法 20', view.legalMoves.length, 20);
  s.eq('publicView FEN', view.fen, E.START_FEN);
  s.eq('publicView 不改变局面', E.toFEN(p), E.START_FEN);
});

s.group('perft 精确基准', function () {
  function check(fen, depth, want, label) {
    var p = E.fromFEN(fen);
    var before = E.toFEN(p);
    var got = E.perft(p, depth);
    s.eq(label, got, want);
    s.eq(label + ' 不改变局面', E.toFEN(p), before);
  }
  var start = E.START_FEN;
  check(start, 1, 20, '起始 perft(1)=20');
  check(start, 2, 400, '起始 perft(2)=400');
  check(start, 3, 8902, '起始 perft(3)=8902');
  check(start, 4, 197281, '起始 perft(4)=197281');
  check('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 1, 48, 'Kiwipete perft(1)=48');
  check('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 2, 2039, 'Kiwipete perft(2)=2039');
  check('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 3, 97862, 'Kiwipete perft(3)=97862');
  check('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 1, 14, '局面 3 perft(1)=14');
  check('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 2, 191, '局面 3 perft(2)=191');
  check('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', 3, 2812, '局面 3 perft(3)=2812');
  check('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 1, 6, '局面 4 perft(1)=6');
  check('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 2, 264, '局面 4 perft(2)=264');
  check('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', 3, 9467, '局面 4 perft(3)=9467');
  check('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 1, 44, '局面 5 perft(1)=44');
  check('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 2, 1486, '局面 5 perft(2)=1486');
  check('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', 3, 62379, '局面 5 perft(3)=62379');
  var divide = E.perftDivide(E.initialPosition(), 2);
  var sum = Object.keys(divide).reduce(function (a, k) { return a + divide[k]; }, 0);
  s.eq('perftDivide 总和等于 perft(2)', sum, 400);
  s.eq('perftDivide 根着法 20 项', Object.keys(divide).length, 20);
});

s.group('兵、吃过路兵与升变', function () {
  var ep = E.fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  s.eq('FEN 吃过路兵目标 d6', E.squareName(ep.ep), 'd6');
  s.ok('吃过路兵目标具有合法着法', E.epIsLegal(ep));
  var epMove = E.moveFromUCI(ep, 'e5d6');
  s.ok('e5xd6 可定位', !!epMove);
  s.ok('标记为吃过路兵', epMove && epMove.ep === true);
  s.eq('被吃兵记录为黑兵', epMove && epMove.captured, 'p');
  var epBefore = E.toFEN(ep);
  var u = E.makeMove(ep, epMove);
  s.eq('兵落在 d6', ep.board[19], 'P');
  s.eq('d5 上的黑兵被移除', ep.board[27], null);
  s.eq('e5 原格清空', ep.board[28], null);
  E.unmakeMove(ep, epMove, u);
  s.eq('撤销吃过路兵还原', E.toFEN(ep), epBefore);

  // FEN records the ep square even when no capture is possible; the repetition
  // key follows FIDE and only includes it when a legal ep capture exists.
  var noCap = E.fromFEN('4k3/8/8/8/8/8/4P3/4K3 w - e6 0 1');
  s.ok('FEN 导出保留不可吃的 e6', E.toFEN(noCap).split(' ')[3] === 'e6');
  var noCap2 = E.fromFEN('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
  s.eq('不可吃的 ep 不进入重复局面 key', E.positionKey(noCap), E.positionKey(noCap2));
  var epKey = E.fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1');
  var noEpKey = E.fromFEN('4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1');
  s.ok('可吃的 ep 进入重复局面 key', E.positionKey(epKey) !== E.positionKey(noEpKey));

  var blockedStart = E.fromFEN('4k3/8/8/8/8/4P3/8/4K3 w - - 0 1');
  s.eq('非初始格兵只能走一格', E.legalMovesFrom(blockedStart, 44).length, 1);
  var blocked = E.fromFEN('4k3/8/8/8/8/4P3/4P3/4K3 w - - 0 1');
  s.eq('被己方兵挡住不能前进', E.legalMovesFrom(blocked, 52).length, 0);
  var caps = E.fromFEN('4k3/8/8/8/3p1p2/4P3/8/4K3 w - - 0 1');
  s.eq('兵可前进或斜吃两侧', E.legalMovesFrom(caps, 44).length, 3);

  var promo = E.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  var promoMoves = E.legalMovesFrom(promo, 8);
  s.eq('升变有 4 种选择', promoMoves.length, 4);
  s.eq('升变选择 Q/R/B/N', promoMoves.map(function (m) { return m.promo; }).sort(), ['B', 'N', 'Q', 'R']);
  s.ok('缺少升变字母时 a7a8 不能定位', E.moveFromUCI(promo, 'a7a8') === null);
  var qMove = E.moveFromUCI(promo, 'a7a8q');
  s.ok('UCI 升变 a7a8q 可定位', !!qMove);
  var pBefore = E.toFEN(promo);
  var pu = E.makeMove(promo, qMove);
  s.eq('升变为后落在 a8', promo.board[0], 'Q');
  s.eq('a7 原格清空', promo.board[8], null);
  E.unmakeMove(promo, qMove, pu);
  s.eq('撤销升变还原', E.toFEN(promo), pBefore);
  var promoCap = E.fromFEN('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  var capMoves = E.legalMovesFrom(promoCap, 8).filter(function (m) { return m.to === 1; });
  s.eq('升变吃子仍有 4 种选择', capMoves.length, 4);
  s.eq('升变吃子记录被吃车', capMoves[0].captured, 'r');

  var game = E.newGame(E.START_FEN);
  playUci(game, 'e2e4');
  s.eq('双步兵后 ep 目标 e3', E.squareName(game.pos.ep), 'e3');
  s.eq('双步兵后半回合归零', game.pos.half, 0);
  playUci(game, 'a7a6');
  s.eq('下一着后 ep 目标清空', game.pos.ep, -1);
  s.eq('黑方走后完整回合到 2', game.pos.full, 2);
  playUci(game, 'g1f3');
  s.eq('马走后半回合计数 1', game.pos.half, 1);
});

s.group('棋子走法与王车易位', function () {
  var start = E.initialPosition();
  s.eq('b1 马开局两个着法', E.legalMovesFrom(start, 57).length, 2);
  s.eq('c1 象开局被挡住', E.legalMovesFrom(start, 58).length, 0);
  s.eq('a1 车开局被挡住', E.legalMovesFrom(start, 56).length, 0);
  s.eq('d1 后开局被挡住', E.legalMovesFrom(start, 59).length, 0);
  s.eq('e1 王开局被挡住', E.legalMovesFrom(start, 60).length, 0);
  var knight = E.fromFEN('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1');
  s.eq('中心马 8 个着法', E.legalMovesFrom(knight, 35).length, 8);
  var bishop = E.fromFEN('4k3/8/8/8/3B4/8/8/4K3 w - - 0 1');
  s.eq('中心象 13 个着法', E.legalMovesFrom(bishop, 35).length, 13);
  var rook = E.fromFEN('4k3/8/8/8/3R4/8/8/4K3 w - - 0 1');
  s.eq('中心车 14 个着法', E.legalMovesFrom(rook, 35).length, 14);
  var queen = E.fromFEN('4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1');
  s.eq('中心后 27 个着法', E.legalMovesFrom(queen, 35).length, 27);
  var king = E.fromFEN('4k3/8/8/8/3K4/8/8/8 w - - 0 1');
  s.eq('中心王 8 个着法', E.legalMovesFrom(king, 35).length, 8);

  var both = E.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  var kMove = E.moveFromUCI(both, 'e1g1');
  var qMove = E.moveFromUCI(both, 'e1c1');
  s.ok('短易位合法', !!kMove && kMove.castle === 'K');
  s.ok('长易位合法', !!qMove && qMove.castle === 'Q');
  var bf = E.toFEN(both);
  var uk = E.makeMove(both, kMove);
  s.eq('短易位王到 g1', both.board[62], 'K');
  s.eq('短易位车到 f1', both.board[61], 'R');
  s.eq('短易位后 h1 清空', both.board[63], null);
  s.eq('白方易位权移除', both.castling, 'kq');
  E.unmakeMove(both, kMove, uk);
  s.eq('撤销短易位还原', E.toFEN(both), bf);
  var uq = E.makeMove(both, qMove);
  s.eq('长易位王到 c1', both.board[58], 'K');
  s.eq('长易位车到 d1', both.board[59], 'R');
  s.eq('长易位后 a1 清空', both.board[56], null);
  E.unmakeMove(both, qMove, uq);

  var through = E.fromFEN('r3kr1r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  s.ok('王经过被攻击的 f1 时不能短易位', !E.moveFromUCI(through, 'e1g1'));
  s.ok('此时长易位仍合法', !!E.moveFromUCI(through, 'e1c1'));
  var inCheck = E.fromFEN('k3r3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  s.ok('被将军时不能易位', !E.moveFromUCI(inCheck, 'e1g1') && !E.moveFromUCI(inCheck, 'e1c1'));
  var bAttacked = E.fromFEN('1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  s.ok('b1 被攻击不阻止长易位', !!E.moveFromUCI(bAttacked, 'e1c1'));

  var kingMoved = E.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  var km = E.moveFromUCI(kingMoved, 'e1f1');
  E.makeMove(kingMoved, km);
  s.eq('王移动后失去两侧易位权', kingMoved.castling, 'kq');
  var rookMoved = E.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  var rm = E.moveFromUCI(rookMoved, 'a1a2');
  E.makeMove(rookMoved, rm);
  s.eq('a1 车移动只失去长易位权', rookMoved.castling, 'Kkq');
  var rookCaptured = E.fromFEN('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1');
  var capture = E.moveFromUCI(rookCaptured, 'g2h1');
  s.ok('象可以吃 h1 车', !!capture);
  E.makeMove(rookCaptured, capture);
  s.eq('h1 车被吃后失去短易位权', rookCaptured.castling, 'Qkq');
});

s.group('将军、将死、逼和与和棋条件', function () {
  var matePos = E.fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  s.ok('黑王被将军', E.inCheck(matePos, 'b'));
  s.ok('白方未被将军', !E.inCheck(matePos, 'w'));
  var mate = E.gameStatus(matePos);
  s.ok('将死标记结束', mate.over === true);
  s.eq('将死结果', mate.result, 'checkmate');
  s.eq('白方获胜', mate.winner, 'w');
  s.eq('将死时 check=true', mate.check, true);
  s.eq('将死无合法着法', mate.moves, 0);
  s.eq('将死不显示和棋', mate.result === 'stalemate', false);

  var stalePos = E.fromFEN('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  var stale = E.gameStatus(stalePos);
  s.ok('逼和标记结束', stale.over === true);
  s.eq('逼和结果', stale.result, 'stalemate');
  s.eq('逼和无胜方', stale.winner, null);
  s.ok('逼和时未将军', !stale.check);

  var fifty99 = E.gameStatus(E.fromFEN('7k/8/6K1/8/8/8/8/R7 w - - 99 1'));
  s.eq('99 半回合尚未触发五十回合', fifty99.over, false);
  var fifty = E.gameStatus(E.fromFEN('7k/8/6K1/8/8/8/8/R7 w - - 100 1'));
  s.eq('100 半回合触发五十回合和棋', fifty.result, 'fifty');
  s.eq('五十回合胜方为空', fifty.winner, null);
  var mateAndFifty = E.gameStatus(E.fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 100 1'));
  s.eq('将死优先于五十回合', mateAndFifty.result, 'checkmate');

  s.ok('王对王 = 子力不足', E.insufficientMaterial(E.fromFEN('8/8/8/8/8/8/8/K6k w - - 0 1')));
  s.ok('王单象对王 = 子力不足', E.insufficientMaterial(E.fromFEN('8/8/8/8/8/8/7b/K6k w - - 0 1')));
  s.ok('王单马对王 = 子力不足', E.insufficientMaterial(E.fromFEN('8/8/8/8/8/8/7n/K6k w - - 0 1')));
  s.ok('同色格双象 = 子力不足', E.insufficientMaterial(E.fromFEN('8/8/8/8/8/8/7b/K5Bk w - - 0 1')));
  s.ok('王单车对王 = 可杀', !E.insufficientMaterial(E.fromFEN('8/8/8/8/8/8/7r/K6k w - - 0 1')));
  s.eq('子力不足局面判和', E.gameStatus(E.fromFEN('8/8/8/8/8/8/8/K6k w - - 0 1')).result, 'insufficient');

  var rep = E.newGame(E.START_FEN);
  ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(function (u) { playUci(rep, u); });
  s.eq('马往返两次后出现三次同局面', rep.keys.filter(function (k) { return k === rep.keys[rep.keys.length - 1]; }).length, 3);
  s.eq('三次重复局面判和', rep.status.result, 'repetition');
  var twice = E.newGame(E.START_FEN);
  ['g1f3', 'g8f6', 'f3g1', 'f6g8'].forEach(function (u) { playUci(twice, u); });
  s.eq('仅两次同局面尚未判和', twice.status.result, null);
  var key = E.positionKey(E.fromFEN('7k/8/6K1/8/8/8/8/R7 w - - 0 1'));
  s.eq('gameStatus 接受重复 key 数组', E.gameStatus(E.fromFEN('7k/8/6K1/8/8/8/8/R7 w - - 0 1'), [key, key, key]).result, 'repetition');

  var pinned = E.fromFEN('4k3/8/8/8/8/4r3/4P3/4K3 w - - 0 1');
  s.ok('被钉住的兵不能离开王所在直线', !E.legalMovesFrom(pinned, 52).some(function (m) { return m.from === 52; }));
  var checked = E.fromFEN('4k3/8/8/8/8/8/8/4K2r w - - 0 1');
  var allSafe = E.legalMoves(checked).every(function (m) {
    var u = E.makeMove(checked, m);
    var safe = !E.inCheck(checked, 'w');
    E.unmakeMove(checked, m, u);
    return safe;
  });
  s.ok('所有合法着法都能解除将军', allSafe);
  s.eq('gameStatus 着法数与 legalMoves 一致', E.gameStatus(checked).moves, E.legalMoves(checked).length);
});

s.group('走子往返、SAN 与 AI', function () {
  var p = E.initialPosition();
  var before = E.toFEN(p);
  var keys = [];
  var stack = [];
  var seed = 1234567;
  for (var ply = 0; ply < 40; ply++) {
    var moves = E.legalMoves(p);
    if (!moves.length) break;
    seed = (seed * 1103515245 + 12345) >>> 0;
    var m = moves[seed % moves.length];
    keys.push(E.toFEN(p));
    stack.push({ move: m, undo: E.makeMove(p, m) });
  }
  s.ok('随机合法序列至少走 20 步', stack.length >= 20);
  for (var i = stack.length - 1; i >= 0; i--) {
    E.unmakeMove(p, stack[i].move, stack[i].undo);
    if (E.toFEN(p) !== keys[i]) { s.ok('撤销第 ' + (i + 1) + ' 步还原', false); break; }
  }
  s.eq('40 步往返后完全还原', E.toFEN(p), before);

  var g = E.newGame(E.START_FEN);
  var m1 = E.moveFromUCI(g.pos, 'e2e4');
  s.eq('e2e4 的 SAN', E.moveToSAN(g.pos, m1), 'e4');
  E.applyMove(g, m1);
  var m2 = E.moveFromUCI(g.pos, 'd7d5');
  E.applyMove(g, m2);
  var m3 = E.moveFromUCI(g.pos, 'e4d5');
  s.eq('兵吃兵 SAN', E.moveToSAN(g.pos, m3), 'exd5');
  var beforeCapture = E.toFEN(g.pos);
  E.applyMove(g, m3);
  s.eq('吃子进入白方托盘', g.captured.w, ['p']);
  E.undoMove(g);
  s.eq('撤销后托盘清空', g.captured.w, []);
  s.eq('撤销后回到吃子前 FEN', E.toFEN(g.pos), beforeCapture);

  var castle = E.fromFEN('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  s.eq('短易位 SAN', E.moveToSAN(castle, E.moveFromUCI(castle, 'e1g1')), 'O-O');
  s.eq('长易位 SAN', E.moveToSAN(castle, E.moveFromUCI(castle, 'e1c1')), 'O-O-O');
  var promo = E.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  s.ok('升变 SAN 含 =Q', E.moveToSAN(promo, E.moveFromUCI(promo, 'a7a8q')).indexOf('a8=Q') === 0);
  var dis = E.fromFEN('4k3/8/8/8/8/8/8/N1N1K3 w - - 0 1');
  var disMove = E.moveFromUCI(dis, 'a1b3');
  s.eq('同目标双马 SAN 消歧义', E.moveToSAN(dis, disMove), 'Nab3');

  var mateLine = E.newGame(E.START_FEN);
  ['f2f3', 'e7e5', 'g2g4', 'd8h4'].forEach(function (u) { playUci(mateLine, u); });
  s.eq('愚人杀终局', mateLine.status.result, 'checkmate');
  s.eq('愚人杀黑方获胜', mateLine.status.winner, 'b');
  s.eq('终局 SAN 以 # 结尾', mateLine.sanList[mateLine.sanList.length - 1], 'Qh4#');
  s.eq('棋谱 4 个半回合', mateLine.sanList.length, 4);

  var aiPos = E.initialPosition();
  var aiFen = E.toFEN(aiPos);
  var ai = E.aiMove(aiPos, { level: 2, timeMs: 300, depth: 2 });
  s.ok('AI 返回合法着法', !!ai && E.legalMoves(aiPos).some(function (m) { return E.uciOf(m) === E.uciOf(ai); }));
  s.eq('AI 不改变调用方局面', E.toFEN(aiPos), aiFen);
  var ai2 = E.aiMove(aiPos, { level: 2, timeMs: 300, depth: 2, seed: 9 });
  var ai3 = E.aiMove(aiPos, { level: 2, timeMs: 300, depth: 2, seed: 9 });
  s.eq('AI 相同种子结果一致', E.uciOf(ai2), E.uciOf(ai3));
  var mateIn1 = E.fromFEN('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  var best = E.aiMove(mateIn1, { level: 3, timeMs: 380, withStats: true, seed: 3 });
  s.ok('AI 找到一步杀', !!best && E.moveToSAN(mateIn1, best.move).indexOf('#') >= 0, best && E.uciOf(best.move));
  s.ok('AI 杀棋分数接近 MATE', best && best.score > E.MATE - 1000, best && String(best.score));
  var mateNode = E.fromFEN('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  s.eq('AI 无着法时返回 null', E.aiMove(mateNode, { level: 1, timeMs: 120 }), null);
  var promotePos = E.fromFEN('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
  var aiPromo = E.aiMove(promotePos, { level: 2, timeMs: 300, depth: 2, seed: 2 });
  s.ok('AI 会处理升变', !!aiPromo && 'QRBN'.indexOf(aiPromo.promo) >= 0, aiPromo && aiPromo.promo);
});

s.group('数据、页面、规则与美术产物', function () {
  s.eq('数据 slug', D.slug, 'chess-premium');
  s.eq('数据标题', D.title, '国际象棋 · Chess');
  s.eq('三档 AI 强度', D.levels.length, 3);
  s.eq('六种棋子资料', D.pieces.length, 6);
  s.eq('比赛格 57mm', D.dimensions.squareMm, 57);
  s.eq('王高 95mm', D.dimensions.kingHeightMm, 95);
  s.eq('兵高 45mm', D.dimensions.pawnHeightMm, 45);
  s.eq('底座直径 30–35mm', D.dimensions.baseDiameterMm, [30, 35]);
  s.eq('棋盘浅格 #e8d3a9', D.colors.lightSquare, '#e8d3a9');
  s.eq('棋盘深格 #6b4a2f', D.colors.darkSquare, '#6b4a2f');
  s.eq('B 站来源至少两条', D.sources.length >= 2, true);
  s.ok('来源包含 BV 号', D.sources.every(function (x) { return /^BV[0-9A-Za-z]+$/.test(x.bv); }));

  var index = read('index.html');
  ['newBtn', 'undoBtn', 'level', 'muteBtn', 'themeBtn', 'board', 'historyBox', 'promo', 'trayTop', 'trayBottom'].forEach(function (id) {
    s.ok('页面控件 ' + id, index.indexOf('id="' + id + '"') >= 0);
  });
  s.ok('页面含 64 格构建循环', index.indexOf('i < 64') >= 0);
  s.ok('页面含合法落点标记', index.indexOf('cap-ring') >= 0 && index.indexOf('.dot') >= 0);
  s.ok('页面含升变选择器', index.indexOf('promoGrid') >= 0);
  s.ok('页面含 FEN 导入导出', index.indexOf('fenInput') >= 0 && index.indexOf('fenCopyBtn') >= 0);
  s.ok('页面标题含国际象棋', /国际象棋/.test(index));
  s.ok('页面 meta description 非空', /name="description" content="[^"]{40,}"/.test(index));
  s.ok('页面 viewport 正确', index.indexOf('width=device-width') >= 0);
  s.ok('OG 图指向本地 assets/og.webp', index.indexOf('content="assets/og.webp"') >= 0);
  // canonical 是必须带绝对 URL 的元数据；外链检查只针对正文资源引用。
  var indexBody = index.replace(/<link\b[^>]*rel=["']?canonical["']?[^>]*>/gi, '');
  var ext = indexBody.match(/(?:src|href)="https?:\/\/[^"]+"/g) || [];
  s.eq('页面零外链资源', ext.length, 0, ext.join(', '));
  s.ok('页面加载共享音效模块', index.indexOf('../../shared/sfx.js') >= 0);

  var rules = read('rules.html');
  var cjk = chineseCount(rules);
  s.ok('规则页 >=1200 汉字', cjk >= 1200, String(cjk));
  s.ok('规则页 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('规则页 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('规则页两张详情图', rules.indexOf('assets/detail-1.webp') >= 0 && rules.indexOf('assets/detail-2.webp') >= 0);
  s.ok('规则页 B 站链接 >=2', (rules.match(/https:\/\/www\.bilibili\.com\/video\/BV/g) || []).length >= 2);
  D.sources.forEach(function (src) {
    s.ok('规则页来源 ' + src.bv, rules.indexOf(src.bv) >= 0);
  });
  s.ok('规则页含尺寸表', rules.indexOf('<table') >= 0);
  s.ok('规则页含 FAQ 标题', /常见问题/.test(rules));

  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'chess-premium');
  s.eq('meta type', meta.type, 'boardgame');
  s.eq('meta status shipped', meta.status, 'shipped');
  s.eq('meta 在线状态 ready', meta.online.status, 'ready');
  s.eq('meta 双人', [meta.players.min, meta.players.max], [2, 2]);
  s.ok('meta e2e 记录', !!meta.e2e && !!meta.e2e.script && !!meta.e2e.online);
  s.ok('meta serviceWorker 预缓存', !!meta.serviceWorker && meta.serviceWorker.precacheIncludes.indexOf('engine.js') >= 0);
  s.ok('meta assets 四张成品', !!meta.assets && meta.assets.detailImages.length === 2);
  s.ok('meta bilibili 来源', !!meta.bilibili && meta.bilibili.sources.length >= 2);

  var realism = JSON.parse(read('realism.json'));
  s.ok('realism 通过', realism.pass === true);
  s.ok('realism 至少 6 项', realism.checks.length >= 6, String(realism.checks.length));
  var kinds = Array.from(new Set(realism.checks.map(function (c) { return c.kind; })));
  s.ok('realism 至少 6 种不同检查', kinds.length >= 6, kinds.join(','));
  s.ok('realism 每项都通过', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism 记录 B 站来源', (realism.sources || []).some(function (x) { return /BV/.test(x); }));

  var perf = JSON.parse(read('perf.json'));
  s.ok('perf ok=true', perf.ok === true);
  s.ok('perf 预算存在', !!perf.budgets && perf.budgets.externalRequests === 0);
  var onlineE2e = JSON.parse(read('online-e2e.json'));
  s.ok('online-e2e 双客户端', onlineE2e.clients === 2 && onlineE2e.runAll === true);

  var artDir = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'chess');
  var artFiles = ['light-maple.webp', 'dark-walnut.webp', 'felt-cloth.webp', 'board-edge.webp'];
  var totalArt = 0;
  artFiles.forEach(function (name) {
    var file = path.join(artDir, name);
    var info = fs.existsSync(file) ? webpSize(file) : null;
    s.ok('材质 ' + name, !!info, info ? JSON.stringify(info) : 'missing');
    if (info) s.eq('材质尺寸 ' + name, [info.width, info.height], [1024, 1024]);
    if (info) totalArt += fs.statSync(file).size;
  });
  s.ok('材质目录无 PNG 母版', fs.readdirSync(artDir).every(function (n) { return !/\.png$/i.test(n); }));
  var dims = {
    'cover.webp': [1200, 1200],
    'og.webp': [1200, 630],
    'detail-1.webp': [1200, 800],
    'detail-2.webp': [1200, 800]
  };
  var totalShots = 0;
  Object.keys(dims).forEach(function (name) {
    var file = path.join(__dirname, 'assets', name);
    var info = fs.existsSync(file) ? webpSize(file) : null;
    s.ok('成品 ' + name, !!info, info ? JSON.stringify(info) : 'missing');
    if (info) s.eq('成品尺寸 ' + name, [info.width, info.height], dims[name]);
    if (info) totalShots += fs.statSync(file).size;
  });
  s.ok('assets 无 PNG 母版', fs.readdirSync(path.join(__dirname, 'assets')).every(function (n) { return !/\.png$/i.test(n); }));
  s.ok('全部美术 <= 2MB', totalArt + totalShots <= 2 * 1024 * 1024, String(totalArt + totalShots));

  var artRender = read('art-render.html');
  s.ok('art-render 含四个镜头', ['cover', 'og', 'detail1', 'detail2'].every(function (x) { return artRender.indexOf(x) >= 0; }));
  s.ok('art-render 使用真实开局', artRender.indexOf('rnbqkbnr/pppppppp') >= 0);
  s.ok('art-render 本地材质', artRender.indexOf('light-maple.webp') >= 0 && artRender.indexOf('dark-walnut.webp') >= 0);
  s.ok('online-server 导出 createChessServer', read('online-server.mjs').indexOf('export function createChessServer') >= 0);
  s.ok('online.html 含大厅与棋盘', read('online.html').indexOf('createBtn') >= 0 && read('online.html').indexOf('id="board"') >= 0);
  ['DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'HANDOFF.md', 'test-online.js', 'e2e.mjs', 'render-art.mjs'].forEach(function (name) {
    s.ok('文件存在 ' + name, size(name) > 0, String(size(name)));
  });
  s.eq('HANDOFF 恰好三行', read('HANDOFF.md').trim().split(/\r?\n/).length, 3);
});

s.done();
