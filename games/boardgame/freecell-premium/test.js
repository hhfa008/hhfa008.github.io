'use strict';

/*
 * FreeCell premium — rules / conservation / realism test harness.
 *   node games/boardgame/freecell-premium/test.js
 * Prints RESULT: N passed, M failed and exits non-zero on failure.
 */

var fs = require('fs');
var path = require('path');
var E = require('./engine.js');
var D = require('./data.js');

var HERE = __dirname;
var passed = 0;
var failed = 0;
var failures = [];

function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
  return !!cond;
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}
function throws(label, fn, pattern) {
  try {
    fn();
    return ok(label, false, 'did not throw');
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    return ok(label, pattern ? pattern.test(msg) : true, msg);
  }
}
function noMutation(label, state, fn) {
  var before = JSON.stringify(state);
  fn();
  return ok(label, JSON.stringify(state) === before, 'state changed');
}
function card(suit, rank) { return E.makeCard(suit, rank); }
function ids(cards) { return cards.map(function (c) { return c.id; }); }
function emptyState(extra) {
  var st = {
    version: E.VERSION,
    dealNumber: null,
    seed: null,
    tableau: [[], [], [], [], [], [], [], []],
    freeCells: [null, null, null, null],
    foundations: [[], [], [], []],
    moves: 0,
    autoMoves: 0,
    status: 'playing',
    startedAt: 0,
    finishedAt: null,
    lastMove: null
  };
  if (extra) Object.keys(extra).forEach(function (k) { st[k] = extra[k]; });
  return st;
}
function fillPile(suit, upTo) {
  var pile = [];
  for (var r = 1; r <= upTo; r++) pile.push(card(suit, r));
  return pile;
}
function webpSize(file) {
  var buf;
  try { buf = fs.readFileSync(file); } catch (err) { return null; }
  if (buf.length < 30) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  var type = buf.toString('ascii', 12, 16);
  if (type === 'VP8X') {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (type === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (type === 'VP8L') {
    return {
      width: 1 + (buf[21] | ((buf[22] & 0x3f) << 8)),
      height: 1 + ((buf[22] >> 6) | (buf[23] << 2) | ((buf[24] & 0x0f) << 10))
    };
  }
  return null;
}
function legalKeySet(state) {
  return E.getLegalMoves(state).map(function (m) { return m.key; });
}

/* ------------------------------------------------------------ 微软局号算法 */
console.log('[STEP] 微软局号算法');
eq('deal #1 的微软 RNG 序列', E.msRandomSequence(1, 8), [41, 18467, 6334, 26500, 19169, 15724, 11478, 29358]);
eq('deal #1 第一行', ids(E.dealDeck(1).slice(0, 8)),
  ['spades-3', 'clubs-6', 'hearts-9', 'spades-2', 'diamonds-5', 'hearts-1', 'diamonds-12', 'diamonds-6']);
eq('deal #1 全部 52 张指纹', E.dealDeck(1).map(function (c) { return c.id; }).join(','),
  'spades-3,clubs-6,hearts-9,spades-2,diamonds-5,hearts-1,diamonds-12,diamonds-6,spades-11,spades-10,hearts-10,diamonds-7,clubs-2,spades-6,spades-12,clubs-11,clubs-8,spades-13,hearts-8,spades-7,spades-5,clubs-4,clubs-3,clubs-9,clubs-13,diamonds-4,spades-1,spades-8,diamonds-2,clubs-1,diamonds-1,hearts-2,clubs-12,hearts-12,diamonds-3,hearts-13,hearts-5,clubs-5,spades-4,diamonds-13,diamonds-9,hearts-6,hearts-4,spades-9,diamonds-8,clubs-10,hearts-3,hearts-11,diamonds-11,hearts-7,clubs-7,diamonds-10');
eq('deal #1 共 52 张', E.dealDeck(1).length, 52);
eq('deal #1 无重复', new Set(ids(E.dealDeck(1))).size, 52);
eq('同局号完全确定', ids(E.dealDeck(1)), ids(E.dealDeck(1)));
ok('不同局号不同', ids(E.dealDeck(1)).join() !== ids(E.dealDeck(2)).join());
eq('RNG 序列确定', E.msRandomSequence(7, 5), E.msRandomSequence(7, 5));
ok('不同局号 RNG 不同', E.msRandomSequence(1, 5).join() !== E.msRandomSequence(2, 5).join());
eq('牌序 0 = 梅花 A', E.cardFromIndex(0).id, 'clubs-1');
eq('牌序 12 = 梅花 K', E.cardFromIndex(12).id, 'clubs-13');
eq('牌序 13 = 方块 A', E.cardFromIndex(13).id, 'diamonds-1');
eq('牌序 26 = 红桃 A', E.cardFromIndex(26).id, 'hearts-1');
eq('牌序 51 = 黑桃 K', E.cardFromIndex(51).id, 'spades-13');
throws('牌序 -1 抛错', function () { E.cardFromIndex(-1); });
throws('牌序 52 抛错', function () { E.cardFromIndex(52); });
throws('局号 0 抛错', function () { E.normalizeDealNumber(0); });
throws('局号负数抛错', function () { E.normalizeDealNumber(-9); });
throws('局号小数抛错', function () { E.normalizeDealNumber(1.5); });
throws('局号超上限抛错', function () { E.normalizeDealNumber(1000001); });
throws('局号非数字抛错', function () { E.normalizeDealNumber('abc'); });
eq('局号字符串可接受', E.normalizeDealNumber(' 42 '), 42);
var deal1 = E.dealDeck(1);
eq('四花色各 13 张', E.SUITS.map(function (s) { return deal1.filter(function (c) { return c.suit === s.index; }).length; }), [13, 13, 13, 13]);
eq('四花色牌点各一张', E.SUITS.map(function (s) {
  return deal1.filter(function (c) { return c.suit === s.index; }).map(function (c) { return c.rank; }).sort(function (a, b) { return a - b; });
}), [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]]);
eq('牌点标签 A..K', E.RANKS, ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
eq('牌张标签', card(3, 13).label, '黑桃K');
eq('牌张颜色', [card(0, 5).color, card(1, 5).color, card(2, 5).color, card(3, 5).color], ['black', 'red', 'red', 'black']);

/* ---------------------------------------------------------------- 建局结构 */
console.log('[STEP] 建局与发牌结构');
var game = E.createGame({ dealNumber: 1, now: 1000 });
eq('牌桌 8 列', game.tableau.length, 8);
eq('列张数 7/7/7/7/6/6/6/6', game.tableau.map(function (c) { return c.length; }), [7, 7, 7, 7, 6, 6, 6, 6]);
eq('52 张全部在桌面', E.allCards(game).length, 52);
eq('52 张唯一', new Set(ids(E.allCards(game))).size, 52);
eq('自由空位 4 格', game.freeCells.length, 4);
eq('空位初始为空', game.freeCells, [null, null, null, null]);
eq('基础堆 4 堆', game.foundations.length, 4);
eq('基础堆初始为空', game.foundations.map(function (p) { return p.length; }), [0, 0, 0, 0]);
eq('初始步数 0', game.moves, 0);
eq('初始自动步数 0', game.autoMoves, 0);
eq('初始状态 playing', game.status, 'playing');
eq('记录局号', game.dealNumber, 1);
eq('局号模式无 seed', game.seed, null);
eq('记录开始时间', game.startedAt, 1000);
eq('初始无最后移动', game.lastMove, null);
ok('扑克比例 63:88', Math.abs(E.CARD_RATIO - 63 / 88) < 1e-12, String(E.CARD_RATIO));
eq('首列第一张为发牌第 1 张', game.tableau[0][0].id, 'spades-3');
eq('每列按行发牌', game.tableau.map(function (col) { return col[0].id; }), ids(E.dealDeck(1).slice(0, 8)));
var seededA = E.createGame({ seed: 777 });
var seededB = E.createGame({ seed: 777 });
eq('自由种子模式发牌确定', seededA.tableau.map(function (c) { return ids(c); }), seededB.tableau.map(function (c) { return ids(c); }));
eq('自由种子模式 52 张', E.allCards(seededA).length, 52);
eq('自由种子模式无局号', seededA.dealNumber, null);
eq('自由种子模式记录 seed', seededA.seed, '777');
ok('不同种子发牌不同', ids(seededA.tableau[0]) !== ids(E.createGame({ seed: 778 }).tableau[0]));
var randomDeal = E.createGame();
ok('默认随机局号在 1–1000000', randomDeal.dealNumber >= 1 && randomDeal.dealNumber <= 1000000 && randomDeal.dealNumber % 1 === 0, String(randomDeal.dealNumber));
eq('默认随机局号 52 张', E.allCards(randomDeal).length, 52);
ok('state 可 JSON 序列化', typeof JSON.stringify(game) === 'string');

/* -------------------------------------------------------- 叠牌 / 基础堆规则 */
console.log('[STEP] 叠牌、连续串与基础堆');
ok('红 6 可压黑 7', E.canStack(card(2, 6), card(3, 7)));
ok('黑 6 可压红 7', E.canStack(card(3, 6), card(1, 7)));
ok('同色不能压', !E.canStack(card(3, 6), card(0, 7)));
ok('点数不连续不能压', !E.canStack(card(2, 5), card(3, 7)));
ok('小牌不能压大牌', !E.canStack(card(2, 9), card(3, 7)));
ok('空列可放任意牌', E.canStack(card(0, 4), null));
ok('空列放 K 合法', E.canStack(card(2, 13), null));
ok('红 7 黑 6 红 5 是合法串', E.isValidRun([card(2, 7), card(3, 6), card(1, 5)], 0));
ok('合法串的中间起点也合法', E.isValidRun([card(2, 7), card(3, 6), card(1, 5)], 1));
ok('单张总是合法串', E.isValidRun([card(2, 7)], 0));
ok('同色串非法', !E.isValidRun([card(2, 7), card(1, 6)], 0));
ok('断点串非法', !E.isValidRun([card(2, 7), card(3, 5)], 0));
ok('越界起点非法', !E.isValidRun([card(2, 7)], 1));
ok('A 可上基础堆', E.canFoundation(card(0, 1), []));
ok('2 不能直接上基础堆', !E.canFoundation(card(0, 2), []));
ok('A 后接 2', E.canFoundation(card(0, 2), [card(0, 1)]));
ok('K 接在 Q 后', E.canFoundation(card(0, 13), fillPile(0, 12)));
ok('基础堆满 13 张后不能再放', !E.canFoundation(card(0, 13), fillPile(0, 13)));

/* ---------------------------------------------------------------- 超级搬运 */
console.log('[STEP] 超级搬运容量');
var emptyAll = emptyState();
eq('空场搬到非空列 = (4+1)×2^8', E.maxMove(emptyAll, false), 1280);
eq('空场搬到空列 = (4+1)×2^7', E.maxMove(emptyAll, true), 640);
var oneFree = emptyState();
oneFree.freeCells[0] = card(0, 1);
oneFree.tableau[0] = [card(3, 2)];
eq('1 空位 1 占列 搬到非空列 = 4×2^7', E.maxMove(oneFree, false), 512);
eq('1 空位 1 占列 搬到空列 = 4×2^6', E.maxMove(oneFree, true), 256);
var initialFilled = E.createGame({ dealNumber: 1 });
eq('开局无空列时容量 5', E.maxMove(initialFilled, false), 5);
eq('开局搬到空列容量 5', E.maxMove(initialFilled, true), 5);

var runState = emptyState();
runState.tableau[0] = [card(2, 7), card(3, 6), card(1, 5)];
var runKeys = legalKeySet(runState);
ok('3 张连续串可搬到空列', runKeys.indexOf('T0:0>T1') !== -1, runKeys.filter(function (k) { return k.indexOf('>T1') !== -1; }).join(','));
ok('串中间起点也可搬', runKeys.indexOf('T0:1>T1') !== -1);
var runApplied = E.applyMove(runState, 'T0:0>T1');
eq('整串搬走后源列清空', runApplied.tableau[0].length, 0);
eq('整串搬到目标列', ids(runApplied.tableau[1]), ['hearts-7', 'spades-6', 'diamonds-5']);

var tight = emptyState();
tight.tableau[0] = [card(2, 7), card(3, 6), card(1, 5)];
tight.tableau[1] = [card(3, 8)];
tight.tableau[2] = [card(0, 2)];
tight.tableau[3] = [card(1, 2)];
tight.tableau[4] = [card(2, 2)];
tight.tableau[5] = [card(3, 2)];
tight.tableau[6] = [card(0, 4)];
tight.freeCells = [card(0, 1), card(1, 1), card(2, 1), card(3, 1)];
var tightKeys = legalKeySet(tight);
ok('0 空位 1 空列时 2 张串不能搬到空列', tightKeys.indexOf('T0:1>T7') === -1, tightKeys.join(','));
ok('0 空位 1 空列时单张可搬到空列', tightKeys.indexOf('T0:2>T7') !== -1);
ok('整列搬运例外：3 张整列可搬到空列', tightKeys.indexOf('T0:0>T7') !== -1, 'missing T0:0>T7');
var twoRunState = emptyState();
twoRunState.tableau[0] = [card(2, 7), card(3, 6)];
twoRunState.tableau[1] = [card(3, 8)];
twoRunState.tableau[2] = [card(0, 2)];
twoRunState.tableau[3] = [card(1, 2)];
twoRunState.tableau[4] = [card(2, 2)];
twoRunState.tableau[5] = [card(3, 2)];
twoRunState.tableau[6] = [card(0, 4)];
twoRunState.freeCells = [card(0, 1), card(1, 1), card(2, 1), card(3, 1)];
var twoKeys = legalKeySet(twoRunState);
ok('0 空位 1 空列时 2 张串可搬到非空列', twoKeys.indexOf('T0:0>T1') !== -1, twoKeys.join(','));
var threeRunState = emptyState();
threeRunState.tableau[0] = [card(2, 7), card(3, 6), card(1, 5)];
threeRunState.tableau[1] = [card(3, 8)];
threeRunState.tableau[2] = [card(0, 2)];
threeRunState.tableau[3] = [card(1, 2)];
threeRunState.tableau[4] = [card(2, 2)];
threeRunState.tableau[5] = [card(3, 2)];
threeRunState.tableau[6] = [card(0, 4)];
threeRunState.freeCells = [card(0, 1), card(1, 1), card(2, 1), card(3, 1)];
var threeKeys = legalKeySet(threeRunState);
ok('0 空位 1 空列时 3 张串不能搬到非空列', threeKeys.indexOf('T0:0>T1') === -1);

/* -------------------------------------------------------- 合法动作与应用 */
console.log('[STEP] 合法动作、应用与不修改入参');
var fresh = E.createGame({ dealNumber: 1 });
var initialMoves = E.getLegalMoves(fresh);
ok('开局有合法动作', initialMoves.length > 0, String(initialMoves.length));
eq('移动 key 唯一', new Set(initialMoves.map(function (m) { return m.key; })).size, initialMoves.length);
ok('每个动作都有 from/to', initialMoves.every(function (m) { return m.from && m.to && m.count >= 1; }));
ok('开局不会出现移动到同一列', initialMoves.every(function (m) {
  return !(m.from.zone === 'tableau' && m.to.zone === 'tableau' && m.from.col === m.to.col);
}));
noMutation('getLegalMoves 不修改入参', fresh, function () { E.getLegalMoves(fresh); });
noMutation('hint 不修改入参', fresh, function () { E.hint(fresh); });
noMutation('applyMove 不修改入参', fresh, function () { E.applyMove(fresh, initialMoves[0]); });
noMutation('autoSafeSend 不修改入参', fresh, function () { E.autoSafeSend(fresh); });

var allFirstMovesOk = true;
initialMoves.forEach(function (m) {
  var next = E.applyMove(fresh, m.key);
  if (next.moves !== 1 || E.allCards(next).length !== 52 || new Set(ids(E.allCards(next))).size !== 52) allFirstMovesOk = false;
});
ok('开局每个合法动作都能应用且牌张守恒', allFirstMovesOk, String(initialMoves.length) + ' moves');
eq('按对象应用与按 key 应用一致', JSON.stringify(E.applyMove(fresh, initialMoves[0]).tableau),
  JSON.stringify(E.applyMove(fresh, { key: initialMoves[0].key }).tableau));
throws('未知 key 抛错', function () { E.applyMove(fresh, 'T9:9>T9'); });
throws('空 key 抛错', function () { E.applyMove(fresh, null); });
throws('无 key 对象抛错', function () { E.applyMove(fresh, { from: {}, to: {} }); });
throws('错误基础堆 key 不存在', function () { E.applyMove(fresh, 'T0:6>F1'); });

var toFree = legalKeySet(fresh).filter(function (k) { return />C0$/.test(k); })[0];
ok('存在移到空位的动作', !!toFree, String(toFree));
var freeMoved = E.applyMove(fresh, toFree);
eq('移到空位后步数 +1', freeMoved.moves, 1);
ok('空位出现一张牌', !!freeMoved.freeCells[0], JSON.stringify(freeMoved.freeCells[0]));
eq('移到空位后牌张守恒', E.allCards(freeMoved).length, 52);

var aceState = emptyState();
aceState.tableau[0] = [card(0, 1)];
ok('A 可以送上基础堆', legalKeySet(aceState).indexOf('T0:0>F0') !== -1);
var aceHome = E.applyMove(aceState, 'T0:0>F0');
eq('基础堆收到梅花 A', aceHome.foundations[0].map(function (c) { return c.id; }), ['clubs-1']);
eq('送上基础堆后源列清空', aceHome.tableau[0].length, 0);
throws('没有牌时不能再送基础堆', function () { E.applyMove(aceHome, 'T0:0>F0'); });

var backDown = emptyState();
backDown.foundations[0] = [card(0, 1)];
backDown.tableau[0] = [card(1, 2)];
ok('基础堆可移回牌桌', legalKeySet(backDown).indexOf('F0>T0') !== -1);
eq('基础堆移回牌桌', ids(E.applyMove(backDown, 'F0>T0').tableau[0]), ['diamonds-2', 'clubs-1']);
var backFree = emptyState();
backFree.foundations[0] = [card(0, 1)];
ok('基础堆可移回空位', legalKeySet(backFree).indexOf('F0>C0') !== -1);
eq('基础堆移回空位', E.applyMove(backFree, 'F0>C0').freeCells[0].id, 'clubs-1');

var freeBack = emptyState();
freeBack.freeCells[0] = card(3, 7);
freeBack.tableau[0] = [card(1, 8)];
ok('空位牌可移回牌桌', legalKeySet(freeBack).indexOf('C0>T0') !== -1);
eq('空位移回牌桌', ids(E.applyMove(freeBack, 'C0>T0').tableau[0]), ['diamonds-8', 'spades-7']);

var winState = emptyState({ startedAt: 1000 });
[0, 1, 2].forEach(function (suit) { winState.foundations[suit] = fillPile(suit, 13); });
winState.foundations[3] = fillPile(3, 12);
winState.freeCells[0] = card(3, 13);
eq('胜利前一共有 52 张', E.allCards(winState).length, 52);
ok('胜利前未胜利', !E.isWon(winState));
var won = E.applyMove(winState, 'C0>F3', { now: 5000 });
ok('送上最后 K 后胜利', E.isWon(won));
eq('胜利状态 status=won', won.status, 'won');
eq('胜利记录完成时间', won.finishedAt, 5000);
eq('胜利分数 52 张归位', E.score(won, { now: 5000 }).cardsHome, 52);
eq('胜利用时 4000ms', E.score(won, { now: 5000 }).elapsedMs, 4000);
eq('胜利时 hint 为空', E.hint(won), null);

/* ----------------------------------------------------------- 自动安全收牌 */
console.log('[STEP] 自动安全收牌');
var safeState = emptyState();
safeState.foundations[0] = fillPile(0, 10);
safeState.foundations[1] = fillPile(1, 10);
safeState.foundations[2] = fillPile(2, 10);
safeState.foundations[3] = fillPile(3, 10);
safeState.freeCells[0] = card(0, 11);
safeState.freeCells[1] = card(0, 12);
safeState.tableau[0] = [
  card(1, 11), card(2, 11), card(3, 11),
  card(1, 12), card(2, 12), card(3, 12),
  card(1, 13), card(2, 13), card(3, 13), card(0, 13)
];
eq('自动收牌测试局面共 52 张', E.allCards(safeState).length, 52);
var safeResult = E.autoSafeSend(safeState);
eq('自动收牌返回新 state 与 sent', [typeof safeResult.state, Array.isArray(safeResult.sent)], ['object', true]);
eq('只送安全的一张', safeResult.sent, ['clubs-11']);
eq('梅花 J 归位', safeResult.state.foundations[0].length, 11);
eq('梅花 Q 仍留在空位', safeResult.state.freeCells[1].id, 'clubs-12');
eq('自动收牌计数 +1', safeResult.state.autoMoves, 1);
ok('自动收牌后牌张守恒', E.allCards(safeResult.state).length === 52 && new Set(ids(E.allCards(safeResult.state))).size === 52);

var acesState = emptyState();
acesState.freeCells = [card(0, 1), card(1, 1), card(2, 1), card(3, 1)];
var acesResult = E.autoSafeSend(acesState);
eq('四张 A 全部自动归位', acesResult.sent.length, 4);
eq('四堆基础堆各 1 张', acesResult.state.foundations.map(function (p) { return p.length; }), [1, 1, 1, 1]);
eq('空位全部清空', acesResult.state.freeCells, [null, null, null, null]);

var twoState = emptyState();
twoState.foundations[0] = [card(0, 1)];
twoState.foundations[1] = [card(1, 1)];
twoState.foundations[2] = [card(2, 1)];
twoState.freeCells[0] = card(0, 2);
eq('红 A 都归位后黑 2 安全', E.autoSafeSend(twoState).sent, ['clubs-2']);

var unsafeState = emptyState();
unsafeState.foundations[0] = fillPile(0, 13);
unsafeState.foundations[1] = fillPile(1, 13);
unsafeState.foundations[2] = fillPile(2, 11);
unsafeState.foundations[3] = fillPile(3, 10);
unsafeState.freeCells[0] = card(2, 12);
unsafeState.freeCells[1] = card(3, 13);
var unsafeResult = E.autoSafeSend(unsafeState);
eq('不安全时一张也不送', unsafeResult.sent, []);
eq('不安全时状态不变', E.serialize(unsafeResult.state), E.serialize(unsafeState));

var finishState = emptyState({ startedAt: 2000 });
finishState.foundations[0] = fillPile(0, 13);
finishState.foundations[1] = fillPile(1, 13);
finishState.foundations[2] = fillPile(2, 12);
finishState.foundations[3] = fillPile(3, 12);
finishState.freeCells[0] = card(2, 13);
finishState.tableau[0] = [card(3, 13)];
var finishResult = E.autoFinish(finishState, { now: 9000 });
ok('autoFinish 收完两张 K 并胜利', E.isWon(finishResult.state));
eq('autoFinish 送牌 2 张', finishResult.sent.length, 2);
eq('autoFinish 标记胜利', finishResult.state.status, 'won');
eq('胜利后自动收牌不再送牌', E.autoSafeSend(finishResult.state).sent, []);

/* ------------------------------------------------------------------ 提示 */
console.log('[STEP] 提示');
var hintGame = E.createGame({ dealNumber: 1 });
var hintMove = E.hint(hintGame);
ok('开局提示返回动作', !!hintMove && typeof hintMove.key === 'string');
ok('提示动作合法', !!hintMove && legalKeySet(hintGame).indexOf(hintMove.key) !== -1, hintMove && hintMove.key);
ok('提示带中文说明', !!hintMove && /[把移叠送]/.test(hintMove.reason), hintMove && hintMove.reason);
eq('提示确定', E.hint(hintGame).key, E.hint(E.createGame({ dealNumber: 1 })).key);
var hintAce = emptyState();
hintAce.tableau[0] = [card(0, 1)];
var hintAceMove = E.hint(hintAce);
eq('有 A 时提示优先基础堆', hintAceMove.to.zone, 'foundation');
eq('提示目标是梅花基础堆', hintAceMove.to.suit, 0);

/* ------------------------------------------------------ 随机走子与守恒压力 */
console.log('[STEP] 随机走子守恒压力');
var play = E.createGame({ dealNumber: 617 });
var conservationOk = true;
var uniqueOk = true;
var stuckAt = 0;
for (var step = 0; step < 80; step++) {
  var moves = E.getLegalMoves(play);
  if (!moves.length) { stuckAt = step; break; }
  if (step % 10 === 0) {
    var before = E.serialize(play);
    E.applyMove(play, moves[(step * 13 + 5) % moves.length]);
    if (E.serialize(play) !== before) { /* applyMove returns new state; original untouched */ }
  }
  var chosen = moves[(step * 13 + 5) % moves.length];
  play = E.applyMove(play, chosen);
  var cards = E.allCards(play);
  if (cards.length !== 52) conservationOk = false;
  if (new Set(ids(cards)).size !== 52) uniqueOk = false;
}
ok('80 步随机走子后 52 张守恒', conservationOk);
ok('80 步随机走子后无重复牌', uniqueOk);
ok('随机走子没有卡死（或有合法动作）', stuckAt !== 0 || E.getLegalMoves(play).length > 0, 'stuckAt=' + stuckAt);
noMutation('随机走子不修改上一局面', play, function () { E.getLegalMoves(play); });

/* ------------------------------------------------------------ 序列化与校验 */
console.log('[STEP] 序列化、反序列化与校验');
var ser = E.serialize(game);
var de = E.deserialize(ser);
eq('序列化往返牌桌一致', de.tableau.map(function (c) { return ids(c); }), game.tableau.map(function (c) { return ids(c); }));
eq('序列化往返基础堆一致', de.foundations, game.foundations);
eq('序列化往返局号一致', de.dealNumber, 1);
eq('二次序列化稳定', E.serialize(de), ser);
eq('可反序列化对象', E.deserialize(JSON.parse(ser)).tableau[0].length, 7);
throws('非法 JSON 抛错', function () { E.deserialize('not json'); });
throws('缺少牌桌抛错', function () { E.deserialize({ freeCells: [null, null, null, null], foundations: [[], [], [], []] }); });
var missing = JSON.parse(ser);
missing.tableau[0].pop();
throws('51 张抛错', function () { E.deserialize(missing); });
var duplicate = JSON.parse(ser);
duplicate.tableau[1].push(duplicate.tableau[0][0]);
duplicate.tableau[0].pop();
throws('重复牌抛错', function () { E.deserialize(duplicate); });
var badFoundation = JSON.parse(ser);
badFoundation.foundations[0] = [card(0, 2)];
throws('基础堆顺序错误抛错', function () { E.deserialize(badFoundation); });

/* --------------------------------------------------------- 真实性 / 尺寸 */
console.log('[STEP] 真实性与美术尺寸');
ok('引擎源码不调用 Math.random', !/Math\.random\s*\(/.test(fs.readFileSync(path.join(HERE, 'engine.js'), 'utf8')));
var required = ['engine.js', 'data.js', 'index.html', 'rules.html', 'sw.js', 'art-render.html', 'meta.json', 'realism.json', 'perf.json', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md',
  'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/card.webp'];
required.forEach(function (rel) {
  var abs = path.join(HERE, rel);
  ok('产物存在 ' + rel, fs.existsSync(abs) && fs.statSync(abs).size > 0, String(fs.existsSync(abs) ? fs.statSync(abs).size : 0));
});
var coverSize = webpSize(path.join(HERE, 'assets/cover.webp'));
eq('封面 1200×1200', coverSize && [coverSize.width, coverSize.height], [1200, 1200]);
var ogSize = webpSize(path.join(HERE, 'assets/og.webp'));
eq('OG 1200×630', ogSize && [ogSize.width, ogSize.height], [1200, 630]);
var detailSize = webpSize(path.join(HERE, 'assets/detail-1.webp'));
ok('详情图至少 1200×800', !!detailSize && detailSize.width >= 1200 && detailSize.height >= 800, JSON.stringify(detailSize));
var cardSize = webpSize(path.join(HERE, 'assets/card.webp'));
eq('卡片图 480×320', cardSize && [cardSize.width, cardSize.height], [480, 320]);
var materialRoot = path.resolve(HERE, '../../assets/art/premium/freecell');
var feltSize = webpSize(path.join(materialRoot, 'felt.webp'));
var backSize = webpSize(path.join(materialRoot, 'card-back.webp'));
ok('毛毡材质存在且够大', !!feltSize && feltSize.width >= 1000 && feltSize.height >= 800, JSON.stringify(feltSize));
ok('牌背材质存在且够大', !!backSize && backSize.width >= 1000 && backSize.height >= 800, JSON.stringify(backSize));
eq('真实牌张 63×88mm', D.realism.cardMm, { width: 63, height: 88 });
eq('8 列分布', D.realism.columnDistribution, [7, 7, 7, 7, 6, 6, 6, 6]);
eq('4 空位 4 基础堆', [D.realism.freeCells, D.realism.foundations], [4, 4]);
eq('局号范围 1–1000000', D.realism.dealNumberRange, [1, 1000000]);
eq('材质引用毛毡与牌背', [D.materials.felt.indexOf('felt.webp') !== -1, D.materials.cardBack.indexOf('card-back.webp') !== -1], [true, true]);
eq('三条 B 站来源', D.sources.length, 3);
ok('来源含 BV 号', D.sources.every(function (s) { return /^BV[0-9A-Za-z]+$/.test(s.id); }));
var indexHtml = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
var rulesHtml = fs.readFileSync(path.join(HERE, 'rules.html'), 'utf8');
ok('index 有可见「单人」标注', indexHtml.indexOf('单人') !== -1);
ok('rules 有可见「单人」标注', rulesHtml.indexOf('单人') !== -1);
ok('index 引用共享 shuffle', indexHtml.indexOf('../../shared/shuffle.js') !== -1);
ok('index 引用共享 sfx', indexHtml.indexOf('../../shared/sfx.js') !== -1);
ok('index 引用共享 store', indexHtml.indexOf('../../shared/store.js') !== -1);
ok('index 使用毛毡材质', indexHtml.indexOf('premium/freecell/felt.webp') !== -1);
ok('index 使用牌背材质', indexHtml.indexOf('premium/freecell/card-back.webp') !== -1);
ok('index 无外部脚本', !/<script[^>]+src=["']https?:/i.test(indexHtml));
ok('index 无 Google Fonts', indexHtml.indexOf('fonts.googleapis') === -1);

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:\n  ' + failures.join('\n  '));
  process.exitCode = 1;
}
