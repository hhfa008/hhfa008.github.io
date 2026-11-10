'use strict';

/*
 * Spider Solitaire premium — rules test harness.
 *   node games/boardgame/spider-premium/test.js
 * Prints RESULT: N passed, M failed and exits non-zero on failure.
 */

var E = require('./engine.js');
var fs = require('fs');
var path = require('path');

var passed = 0;
var failed = 0;
var failures = [];
var uid = 0;

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
function card(suit, rank, faceUp) {
  uid += 1;
  return { id: suit + '-' + rank + '-t' + uid, suit: suit, rank: rank, faceUp: faceUp !== false };
}
function blankState(overrides) {
  var columns = [];
  for (var i = 0; i < 10; i++) columns.push([]);
  var base = {
    version: E.VERSION,
    seed: 1,
    difficulty: 4,
    columns: columns,
    stock: [],
    foundations: [],
    completedRuns: 0,
    score: 500,
    moves: 0,
    deals: 0,
    actionCount: 0,
    over: false,
    result: null,
    lastAction: null,
    log: []
  };
  if (overrides) {
    Object.keys(overrides).forEach(function (key) { base[key] = overrides[key]; });
  }
  return base;
}
function isLegal(state, move) {
  return E.getLegalMoves(state).some(function (m) { return m.key === move.key; });
}
function findMove(state, predicate) {
  return E.getLegalMoves(state).filter(predicate)[0] || null;
}
function makeRun(suit, faceUp) {
  var run = [];
  for (var rank = 13; rank >= 1; rank--) run.push(card(suit, rank, faceUp !== false));
  return run;
}
function countRanks(deck, suit) {
  var counts = {};
  deck.filter(function (c) { return c.suit === suit; }).forEach(function (c) {
    counts[c.rank] = (counts[c.rank] || 0) + 1;
  });
  return counts;
}
function sum(values) { return values.reduce(function (a, b) { return a + b; }, 0); }

/* ---------------------------------------------------------------- 牌组 */
console.log('[STEP] 牌组构成');
var one = E.makeDeck(1);
eq('一色共 104 张', one.length, 104);
eq('一色 id 唯一', new Set(one.map(function (c) { return c.id; })).size, 104);
eq('一色只有黑桃', Array.from(new Set(one.map(function (c) { return c.suit; }))), ['spades']);
var oneRanks = countRanks(one, 'spades');
eq('一色每个点数 8 张', Object.keys(oneRanks).length, 13);
ok('一色 A–K 各 8 张', Object.keys(oneRanks).every(function (r) { return oneRanks[r] === 8; }), JSON.stringify(oneRanks));
ok('一色含 8 张 A', one.filter(function (c) { return c.rank === 1; }).length === 8);
ok('一色含 8 张 K', one.filter(function (c) { return c.rank === 13; }).length === 8);

var two = E.makeDeck(2);
eq('二色共 104 张', two.length, 104);
eq('二色 id 唯一', new Set(two.map(function (c) { return c.id; })).size, 104);
eq('二色花色两种', Array.from(new Set(two.map(function (c) { return c.suit; }))).sort(), ['hearts', 'spades']);
eq('二色黑桃 52 张', two.filter(function (c) { return c.suit === 'spades'; }).length, 52);
eq('二色红心 52 张', two.filter(function (c) { return c.suit === 'hearts'; }).length, 52);
ok('二色每花色每点数 4 张', ['spades', 'hearts'].every(function (suit) {
  var counts = countRanks(two, suit);
  return Object.keys(counts).length === 13 && Object.keys(counts).every(function (r) { return counts[r] === 4; });
}));

var four = E.makeDeck(4);
eq('四色共 104 张', four.length, 104);
eq('四色 id 唯一', new Set(four.map(function (c) { return c.id; })).size, 104);
eq('四色四种花色', Array.from(new Set(four.map(function (c) { return c.suit; }))).sort(), ['clubs', 'diamonds', 'hearts', 'spades']);
ok('四色每花色 26 张', ['spades', 'hearts', 'diamonds', 'clubs'].every(function (suit) {
  return four.filter(function (c) { return c.suit === suit; }).length === 26;
}));
ok('四色每花色每点数 2 张', ['spades', 'hearts', 'diamonds', 'clubs'].every(function (suit) {
  var counts = countRanks(four, suit);
  return Object.keys(counts).length === 13 && Object.keys(counts).every(function (r) { return counts[r] === 2; });
}));
eq('四色 A 共 8 张', four.filter(function (c) { return c.rank === 1; }).length, 8);
eq('四色 K 共 8 张', four.filter(function (c) { return c.rank === 13; }).length, 8);
eq('难度数字 1/2/4', E.DIFFICULTIES.map(function (d) { return d.value; }), [1, 2, 4]);
eq('难度字符串 one→1', E.normalizeDifficulty('one'), 1);
eq('难度字符串 two→2', E.normalizeDifficulty('two'), 2);
eq('难度字符串 hard→4', E.normalizeDifficulty('hard'), 4);
throws('难度 3 被拒绝', function () { E.makeDeck(3); }, /难度/);
eq('rankLabel A', E.rankLabel(1), 'A');
eq('rankLabel 10', E.rankLabel(10), '10');
eq('rankLabel J/Q/K', [E.rankLabel(11), E.rankLabel(12), E.rankLabel(13)], ['J', 'Q', 'K']);
eq('cardLabel 黑桃A', E.cardLabel({ suit: 'spades', rank: 1 }), '黑桃A');
eq('cardLabel 红心K', E.cardLabel({ suit: 'hearts', rank: 13 }), '红心K');

/* ---------------------------------------------------------------- 建局 */
console.log('[STEP] 初始发牌');
var game = E.createGame({ seed: 12345 });
eq('10 列', game.columns.length, 10);
eq('列牌数 6/6/6/6/5/5/5/5/5/5', game.columns.map(function (c) { return c.length; }), [6, 6, 6, 6, 5, 5, 5, 5, 5, 5]);
eq('桌面共 54 张', sum(game.columns.map(function (c) { return c.length; })), 54);
eq('牌堆 50 张', game.stock.length, 50);
eq('总牌数 104', E.allCards(game).length, 104);
eq('唯一牌 104', new Set(E.allCards(game).map(function (c) { return c.id; })).size, 104);
eq('守恒分解 54+50+0', E.cardCounts(game), { columns: 54, stock: 50, foundations: 0, total: 104, unique: 104 });
ok('每列顶端正面', game.columns.every(function (c) { return c[c.length - 1].faceUp; }));
ok('每列非顶端背面', game.columns.every(function (c) {
  return c.slice(0, -1).every(function (x) { return !x.faceUp; });
}));
ok('牌堆全部背面', game.stock.every(function (c) { return !c.faceUp; }));
eq('初始分数 500', game.score, 500);
eq('初始步数 0', game.moves, 0);
eq('初始发牌次数 0', game.deals, 0);
eq('初始完成组 0', game.completedRuns, 0);
eq('初始未结束', game.over, false);
eq('初始无结果', game.result, null);
ok('开局日志存在', game.log.some(function (l) { return l.type === 'start'; }));
eq('默认难度一色', game.difficulty, 1);
eq('difficultyInfo 标签', E.difficultyInfo(1).label, '一色 · 简单');
var twoGame = E.createGame({ seed: 9, difficulty: 2 });
eq('二色建局', twoGame.difficulty, 2);
ok('二色建局含两种花色', new Set(E.allCards(twoGame).map(function (c) { return c.suit; })).size === 2);
var fourGame = E.createGame({ seed: 9, difficulty: 4 });
ok('四色建局含四种花色', new Set(E.allCards(fourGame).map(function (c) { return c.suit; })).size === 4);
var drawModeGame = E.createGame({ seed: 9, drawMode: 2 });
eq('drawMode 兼容 difficulty', drawModeGame.difficulty, 2);
var seedA = E.createGame({ seed: 777 });
var seedB = E.createGame({ seed: 777 });
eq('同 seed 完全相同', E.serialize(seedA), E.serialize(seedB));
var seedC = E.createGame({ seed: 778 });
ok('不同 seed 发牌不同', JSON.stringify(seedA.columns) !== JSON.stringify(seedC.columns));
ok('不同 seed 牌堆不同', JSON.stringify(seedA.stock) !== JSON.stringify(seedC.stock));
ok('初始存在合法动作', E.getLegalMoves(game).length > 0, String(E.getLegalMoves(game).length));

/* ---------------------------------------------------------------- 可移动段 */
console.log('[STEP] 可移动段判定');
var runCol = [card('spades', 13), card('spades', 12), card('spades', 11)];
ok('同花降序整段可移动', E.movableFrom(runCol, 0));
ok('同花降序子段可移动', E.movableFrom(runCol, 1));
ok('单张正面可移动', E.movableFrom(runCol, 2));
ok('负数索引不可移动', !E.movableFrom(runCol, -1));
ok('越界索引不可移动', !E.movableFrom(runCol, 3));
ok('空列不可移动', !E.movableFrom([], 0));
var mixedCol = [card('spades', 13), card('hearts', 12), card('hearts', 11)];
ok('混花色整段不可移动', !E.movableFrom(mixedCol, 0));
ok('混花色之后同花子段可移动', E.movableFrom(mixedCol, 1));
var gapCol = [card('spades', 13), card('spades', 10), card('spades', 9)];
ok('跳点数不可移动', !E.movableFrom(gapCol, 0));
ok('后两张同花连续可移动', E.movableFrom(gapCol, 1));
var ascCol = [card('spades', 11), card('spades', 12), card('spades', 13)];
ok('升序不可移动', !E.movableFrom(ascCol, 0));
var hiddenCol = [card('spades', 13, false), card('spades', 12, true)];
ok('背面起始不可移动', !E.movableFrom(hiddenCol, 0));
ok('背面之后正面单张可移动', E.movableFrom(hiddenCol, 1));
var hiddenTail = [card('spades', 13), card('spades', 12, false), card('spades', 11, true)];
ok('段中包含背面不可移动', !E.movableFrom(hiddenTail, 0));
var stateForMove = blankState();
stateForMove.columns[0] = runCol.slice();
ok('isMovableRun(state,0,0)', E.isMovableRun(stateForMove, 0, 0));
ok('isMovableRun 越界列 false', !E.isMovableRun(stateForMove, 10, 0));
ok('isMovableRun 非整数 false', !E.isMovableRun(stateForMove, 0, 1.5));

/* ---------------------------------------------------------------- 放置规则 */
console.log('[STEP] 放置规则');
ok('空列可放置任意牌', E.canPlaceOn([], card('hearts', 5)));
ok('目标顶牌大 1 可放置', E.canPlaceOn([card('hearts', 6)], card('spades', 5)));
ok('同花色大 1 可放置', E.canPlaceOn([card('spades', 6)], card('spades', 5)));
ok('目标同点数不可放置', !E.canPlaceOn([card('hearts', 5)], card('spades', 5)));
ok('目标小 1 不可放置', !E.canPlaceOn([card('hearts', 4)], card('spades', 5)));
ok('目标大 2 不可放置', !E.canPlaceOn([card('hearts', 7)], card('spades', 5)));
ok('目标背面顶牌不可放置', !E.canPlaceOn([card('hearts', 6, false)], card('spades', 5)));
ok('canPlaceRun 空列成立', E.canPlaceRun({ columns: [[card('spades', 13)], []] }, 0, 1, 0));
ok('canPlaceRun 同列不成立', !E.canPlaceRun({ columns: [[card('spades', 13)]] }, 0, 0, 0));
ok('canPlaceRun 非法索引不成立', !E.canPlaceRun({ columns: [[card('spades', 13)], []] }, 0, 1, 1));

/* ---------------------------------------------------------------- 移动 */
console.log('[STEP] 合约式移动');
var moveState = blankState();
moveState.columns[0] = [card('spades', 9, false), card('spades', 8), card('spades', 7)];
moveState.columns[1] = [card('hearts', 9)];
moveState.columns[2] = [card('clubs', 4)];
var move = { type: 'move', fromCol: 0, toCol: 1, index: 1 };
var beforeMove = JSON.stringify(moveState);
var afterMove = E.applyMove(moveState, move);
eq('applyMove 不修改入参', JSON.stringify(moveState), beforeMove);
eq('来源列剩 1 张', afterMove.columns[0].length, 1);
eq('目标列变为 3 张', afterMove.columns[1].length, 3);
eq('移动段保持顺序', afterMove.columns[1].map(function (c) { return c.rank; }), [9, 8, 7]);
eq('移动后来源背面翻正', afterMove.columns[0][0].faceUp, true);
eq('lastAction.flipped', afterMove.lastAction.flipped, true);
eq('移动扣 1 分', afterMove.score, 499);
eq('移动步数 +1', afterMove.moves, 1);
eq('actionCount +1', afterMove.actionCount, 1);
eq('lastAction 类型 move', afterMove.lastAction.type, 'move');
eq('lastAction 段长 2', afterMove.lastAction.runLength, 2);
ok('log 记录移动', afterMove.log.some(function (l) { return l.type === 'move'; }));
ok('移动键稳定', E.getLegalMoves(moveState).some(function (m) { return m.key === 'move:0:1:1'; }));
ok('新状态仍有合法动作', E.getLegalMoves(afterMove).length > 0);

var placeState = blankState();
placeState.columns[0] = [card('spades', 5)];
placeState.columns[1] = [];
placeState.columns[2] = [card('clubs', 8)];
var toEmpty = E.applyMove(placeState, { type: 'move', fromCol: 0, toCol: 1, index: 0 });
eq('可移动到空列', toEmpty.columns[1].length, 1);
eq('空列移动后来源为空', toEmpty.columns[0].length, 0);
eq('空列移动不翻牌', toEmpty.lastAction.flipped, false);

var noFlipState = blankState();
noFlipState.columns[0] = [card('spades', 9), card('spades', 8)];
noFlipState.columns[1] = [card('hearts', 9)];
var noFlip = E.applyMove(noFlipState, { type: 'move', fromCol: 0, toCol: 1, index: 1 });
eq('来源仍正面时不翻牌', noFlip.lastAction.flipped, false);
eq('来源剩正面 9', noFlip.columns[0][0].faceUp, true);

var overState = blankState({ over: true });
throws('终局后不能移动', function () { E.applyMove(overState, { type: 'move', fromCol: 0, toCol: 1, index: 0 }); }, /已结束/);
eq('终局 legalMoves 为空', E.getLegalMoves(overState), []);
throws('空动作被拒', function () { E.applyMove(game, null); }, /动作非法/);
throws('未知类型被拒', function () { E.applyMove(game, { type: 'teleport' }); }, /未知动作/);
throws('同列移动被拒', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 5)];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 0, index: 0 });
}, /同一列/);
throws('来源列越界被拒', function () {
  E.applyMove(game, { type: 'move', fromCol: 10, toCol: 1, index: 0 });
}, /来源列/);
throws('目标列越界被拒', function () {
  E.applyMove(game, { type: 'move', fromCol: 0, toCol: -1, index: 0 });
}, /目标列/);
throws('牌起始位置越界被拒', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 5)];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 1, index: 3 });
}, /起始位置/);
throws('背面牌不能移动', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 5, false)];
  s.columns[1] = [];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 1, index: 0 });
}, /背面/);
throws('混花色整段被拒', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 9), card('hearts', 8)];
  s.columns[1] = [card('clubs', 9)];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 1, index: 0 });
}, /连续递减|同花色/);
throws('目标点数不匹配被拒', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 5)];
  s.columns[1] = [card('clubs', 8)];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 1, index: 0 });
}, /大 1 点/);
throws('canPlaceRun 混花色段被拒', function () {
  var s = blankState();
  s.columns[0] = [card('spades', 9), card('hearts', 8)];
  s.columns[1] = [card('clubs', 9)];
  E.applyMove(s, { type: 'move', fromCol: 0, toCol: 1, index: 0 });
}, /连续递减|同花色/);

/* ---------------------------------------------------------------- 发牌 */
console.log('[STEP] 发牌');
var dealGame = E.createGame({ seed: 4242 });
var lengthsBefore = dealGame.columns.map(function (c) { return c.length; });
var stockBefore = dealGame.stock.length;
var dealt = E.applyMove(dealGame, { type: 'deal' });
eq('发牌后每列 +1', dealt.columns.map(function (c) { return c.length; }), lengthsBefore.map(function (n) { return n + 1; }));
eq('发牌后牌堆 40', dealt.stock.length, 40);
eq('发牌次数 +1', dealt.deals, 1);
eq('发牌扣 1 分', dealt.score, 499);
eq('发牌 lastAction 类型', dealt.lastAction.type, 'deal');
eq('发牌 10 张', dealt.lastAction.cards, 10);
ok('发牌后每列顶牌正面', dealt.columns.every(function (c) { return c[c.length - 1].faceUp; }));
ok('发牌后总牌数 104', E.allCards(dealt).length === 104);
eq('发牌后唯一牌 104', new Set(E.allCards(dealt).map(function (c) { return c.id; })).size, 104);
ok('发牌日志存在', dealt.log.some(function (l) { return l.type === 'deal'; }));
ok('初始状态可发牌', E.canDeal(dealGame));
ok('初始 legalMoves 含发牌', E.getLegalMoves(dealGame).some(function (m) { return m.type === 'deal'; }));
eq('deal 键', E.getLegalMoves(dealGame).filter(function (m) { return m.type === 'deal'; })[0].key, 'deal');

var emptyColState = blankState();
emptyColState.columns[0] = [card('spades', 5)];
emptyColState.columns[1] = [];
for (var z = 0; z < 50; z++) emptyColState.stock.push(card('clubs', (z % 13) + 1, false));
ok('存在空列时 canDeal false', !E.canDeal(emptyColState));
ok('存在空列时无发牌动作', !E.getLegalMoves(emptyColState).some(function (m) { return m.type === 'deal'; }));
throws('存在空列时发牌被拒', function () { E.applyMove(emptyColState, { type: 'deal' }); }, /空列/);
throws('draw 别名也检查空列', function () { E.applyMove(emptyColState, { type: 'draw' }); }, /空列/);

var emptyStock = blankState();
emptyStock.columns[0] = [card('spades', 5)];
emptyStock.columns[1] = [card('hearts', 4)];
throws('牌堆不足 10 张不能发牌', function () { E.applyMove(emptyStock, { type: 'deal' }); }, /牌堆已空/);

var fiveDeals = blankState();
for (var dc = 0; dc < 10; dc++) fiveDeals.columns[dc] = [card(E.SUITS[dc % 4].key, 13 - (dc % 5))];
for (var sc = 0; sc < 50; sc++) fiveDeals.stock.push(card('clubs', (sc % 13) + 1, false));
var dealState = fiveDeals;
for (var di = 0; di < 5; di++) dealState = E.applyMove(dealState, { type: 'deal' });
eq('5 次发牌后牌堆 0', dealState.stock.length, 0);
eq('5 次发牌后 deals=5', dealState.deals, 5);
eq('5 次发牌后分数 495', dealState.score, 495);
throws('牌堆空后第 6 次发牌被拒', function () { E.applyMove(dealState, { type: 'deal' }); }, /牌堆已空/);

var dealCompleteCols = [];
for (var q = 0; q < 10; q++) dealCompleteCols.push([]);
var dealRun = makeRun('spades', true);
// 第 10 列放 K..2，牌堆最后一张（正好发给第 1 列）放黑桃 A。
dealCompleteCols[0] = dealRun.slice(0, 12);
for (var q2 = 1; q2 < 9; q2++) dealCompleteCols[q2] = [card(E.SUITS[q2 % 4].key, 5)];
dealCompleteCols[9] = [card('hearts', 4)];
var dealCompleteStock = [];
for (var ds = 0; ds < 49; ds++) dealCompleteStock.push(card('clubs', (ds % 13) + 1, false));
dealCompleteStock.push(dealRun[12]);
var dealCompleteState = blankState({ columns: dealCompleteCols, stock: dealCompleteStock });
var afterDealComplete = E.applyMove(dealCompleteState, { type: 'deal' });
eq('发牌可自动收走完整组', afterDealComplete.foundations.length, 1);
eq('发牌收组 +100', afterDealComplete.score, 599);
eq('发牌收组后 completedRuns=1', afterDealComplete.completedRuns, 1);
ok('发牌收组日志存在', afterDealComplete.log.some(function (l) { return l.type === 'complete'; }));

/* ---------------------------------------------------------------- 完成组与胜利 */
console.log('[STEP] K→A 完成组');
var completeRun = makeRun('hearts', true);
ok('isCompletedTail 识别 K→A', E.isCompletedTail(completeRun));
ok('13 张同花升序不算完成', !E.isCompletedTail(completeRun.slice().reverse()));
ok('12 张不算完成', !E.isCompletedTail(completeRun.slice(1)));
ok('混花色不算完成', !E.isCompletedTail(completeRun.map(function (c, i) {
  return i === 5 ? card('spades', c.rank) : c;
})));
ok('含背面不算完成', !E.isCompletedTail(completeRun.map(function (c, i) {
  return i === 3 ? card('hearts', c.rank, false) : c;
})));
var tailState = blankState();
tailState.columns[0] = completeRun.slice();
eq('findCompletedTail 返回起始索引', E.findCompletedTail(tailState, 0), 0);
tailState.columns[0] = [card('clubs', 5, false)].concat(completeRun);
eq('带底牌的完成组起始索引 1', E.findCompletedTail(tailState, 0), 1);
tailState.columns[0] = completeRun.slice(0, 12);
eq('不完整返回 -1', E.findCompletedTail(tailState, 0), -1);

var autoCompleteState = blankState();
// 发牌按从牌堆尾取牌，最后一列（索引 9）拿到 stock 末尾；这里让第 1 列拿到方块 A。
autoCompleteState.columns[0] = [card('clubs', 5, false)].concat(makeRun('diamonds', true).slice(0, 12));
for (var ac = 1; ac < 10; ac++) autoCompleteState.columns[ac] = [card('spades', 13 - ac)];
for (var acs = 0; acs < 10; acs++) autoCompleteState.stock.push(card('clubs', (acs % 13) + 1, false));
autoCompleteState.stock.pop(); // 让最后一张正好是第 1 列将拿到的牌
autoCompleteState.stock.push(makeRun('diamonds', true)[12]);
var autoComplete = E.applyMove(autoCompleteState, { type: 'deal' });
eq('自动收组后该列清空并翻底牌', autoComplete.columns[0].map(function (c) { return c.rank; }), [5]);
eq('自动收组后底牌正面', autoComplete.columns[0][0].faceUp, true);
eq('自动收组后 foundations=1', autoComplete.foundations.length, 1);
eq('自动收组 +100 计分', autoComplete.score, 599);
eq('自动收组后 completedRuns', autoComplete.completedRuns, 1);
eq('完成组保存 13 张牌', autoComplete.foundations[0].cards.length, 13);

var cascadeState = blankState();
cascadeState.columns[0] = [card('clubs', 5, false)].concat(makeRun('hearts', true), makeRun('hearts', true));
cascadeState.columns[1] = [card('spades', 2)];
cascadeState.columns[2] = [card('hearts', 3)];
for (var ca = 3; ca < 10; ca++) cascadeState.columns[ca] = [];
for (var cas = 0; cas < 10; cas++) cascadeState.stock.push(card('clubs', (cas % 13) + 1, false));
var cascade = E.applyMove(cascadeState, { type: 'move', fromCol: 1, toCol: 2, index: 0 });
eq('一次收走两组', cascade.foundations.length, 2);
eq('两组共 26 张', cascade.foundations[0].cards.length + cascade.foundations[1].cards.length, 26);
eq('两组 +200 计分', cascade.score, 500 - 1 + 200);
eq('级联收组后底牌翻正', cascade.columns[0].length === 1 && cascade.columns[0][0].faceUp, true);

var winState = (function () {
  var deck = E.makeDeck(4).map(function (c) { return { id: c.id, suit: c.suit, rank: c.rank, faceUp: true }; });
  var foundations = [];
  for (var r = 0; r < 7; r++) {
    foundations.push({ suit: deck[0].suit, cards: deck.splice(0, 13) });
  }
  deck.sort(function (a, b) { return b.rank - a.rank; });
  var state = blankState({ foundations: foundations, completedRuns: 7, score: 700 });
  state.columns[0] = deck.slice(0, 12);
  state.columns[1] = [deck[12]];
  return state;
})();
eq('胜利场景 7 组', winState.foundations.length, 7);
eq('胜利场景总牌数 104', E.allCards(winState).length, 104);
eq('胜利场景唯一牌 104', new Set(E.allCards(winState).map(function (c) { return c.id; })).size, 104);
ok('胜利前未结束', !E.isWon(winState));
var winMove = { type: 'move', fromCol: 1, toCol: 0, index: 0, key: 'move:1:0:0' };
ok('胜利前一击合法', isLegal(winState, winMove), JSON.stringify(E.getLegalMoves(winState).slice(0, 5)));
var won = E.applyMove(winState, winMove);
eq('胜利后 over=true', won.over, true);
eq('胜利后 result.win', won.result.win, true);
eq('胜利后 8 组', won.foundations.length, 8);
eq('胜利后 completedRuns 8', won.completedRuns, 8);
eq('胜利后 isWon true', E.isWon(won), true);
eq('胜利后 isGameOver true', E.isGameOver(won), true);
eq('胜利后分数 799', won.score, 799);
eq('胜利后 104 张仍在', E.allCards(won).length, 104);
eq('胜利后唯一牌 104', new Set(E.allCards(won).map(function (c) { return c.id; })).size, 104);
eq('胜利后牌桌列清空', won.columns.every(function (c) { return c.length === 0; }), true);
eq('胜利 result 分数与状态一致', won.result.score, won.score);
eq('胜利 result 步数', won.result.moves, won.moves);
throws('胜利后不能再行动', function () { E.applyMove(won, { type: 'deal' }); }, /已结束/);
eq('胜利后 legalMoves 空', E.getLegalMoves(won), []);

var lossState = blankState();
lossState.columns[0] = [card('spades', 2, false), card('spades', 8)];
lossState.columns[1] = [card('hearts', 9)];
for (var ls = 2; ls < 10; ls++) lossState.columns[ls] = [card('diamonds', 12)];
var lossMove = findMove(lossState, function (m) { return m.type === 'move'; });
ok('无棋可走场景初始有一手', !!lossMove, JSON.stringify(E.getLegalMoves(lossState)));
var lost = E.applyMove(lossState, lossMove);
eq('无后续动作时判负', lost.over, true);
eq('判负 result.win=false', lost.result.win, false);
ok('判负原因非空', typeof lost.result.reason === 'string' && lost.result.reason.length > 0, lost.result.reason);
eq('判负后 getLegalMoves 空', E.getLegalMoves(lost), []);

/* ---------------------------------------------------------------- 提示 */
console.log('[STEP] 提示');
var hintGame = E.createGame({ seed: 321 });
var hintMove = E.hint(hintGame);
ok('初始 hint 返回动作', !!hintMove);
ok('初始 hint 是合法动作', hintMove && isLegal(hintGame, hintMove), JSON.stringify(hintMove));
var hintBefore = JSON.stringify(hintGame);
E.hint(hintGame);
eq('hint 不修改状态', JSON.stringify(hintGame), hintBefore);
var hintWin = E.hint(winState);
eq('可收组时 hint 选择收组', hintWin && hintWin.key, winMove.type + ':' + winMove.fromCol + ':' + winMove.toCol + ':' + winMove.index);
var dealOnly = blankState();
dealOnly.columns[0] = [card('spades', 5)];
dealOnly.columns[1] = [card('hearts', 12)];
for (var dq = 2; dq < 10; dq++) dealOnly.columns[dq] = [card('clubs', 12)];
for (var dqs = 0; dqs < 10; dqs++) dealOnly.stock.push(card('diamonds', (dqs % 13) + 1, false));
var dealOnlyHint = E.hint(dealOnly);
ok('仅剩发牌时 hint 返回发牌', dealOnlyHint && dealOnlyHint.type === 'deal', JSON.stringify(dealOnlyHint));
var noMoveState = blankState({ over: true });
eq('终局 hint 返回 null', E.hint(noMoveState), null);
var stuck = blankState();
stuck.columns[0] = [card('spades', 13)];
for (var st = 1; st < 10; st++) stuck.columns[st] = [card('hearts', 11)];
eq('无合法动作 hint 返回 null', E.hint(stuck), null);
eq('describeMove 发牌', E.describeMove(hintGame, { type: 'deal' }), '发牌');
ok('describeMove 列信息含箭头', /→/.test(E.describeMove(hintGame, hintMove || { type: 'deal' })));

/* ---------------------------------------------------------------- 序列化与计分 */
console.log('[STEP] 序列化、计分与守恒');
var serGame = E.createGame({ seed: 55 });
var roundTrip = E.deserialize(E.serialize(serGame));
eq('序列化往返一致', E.serialize(roundTrip), E.serialize(serGame));
eq('往返后牌数 104', E.allCards(roundTrip).length, 104);
throws('非法 JSON 被拒', function () { E.deserialize('{oops'); }, /./);
throws('列数错误被拒', function () { E.deserialize(JSON.stringify({ columns: [], stock: [], foundations: [] })); }, /10/);
throws('牌数错误被拒', function () { E.deserialize(JSON.stringify({ columns: [[], [], [], [], [], [], [], [], [], []], stock: [], foundations: [] })); }, /104/);

var scoreGame = E.createGame({ seed: 88 });
var sb0 = E.scoreBreakdown(scoreGame);
eq('初始计分分解 500', sb0.total, 500);
eq('初始计分与 state 一致', E.score(scoreGame), 500);
var firstLegal = E.getLegalMoves(scoreGame)[0];
var scored = E.applyMove(scoreGame, firstLegal);
eq('一步后计分一致', E.scoreBreakdown(scored).total, scored.score);
eq('一步后分数 499', scored.score, 499);

var randomFailures = 0;
var randomSteps = 0;
for (var rs = 1; rs <= 6; rs++) {
  var sim = E.createGame({ seed: 7000 + rs, difficulty: rs % 2 === 0 ? 2 : 4 });
  for (var step = 0; step < 220; step++) {
    if (sim.over) break;
    var moves = E.getLegalMoves(sim);
    if (!moves.length) break;
    var pick = moves[(step * 37 + rs * 11) % moves.length];
    try { sim = E.applyMove(sim, pick); } catch (err) { randomFailures += 1; break; }
    randomSteps += 1;
    var cards = E.allCards(sim);
    if (cards.length !== 104 || new Set(cards.map(function (c) { return c.id; })).size !== 104) {
      randomFailures += 1;
      break;
    }
    if (E.scoreBreakdown(sim).total !== sim.score) {
      randomFailures += 1;
      break;
    }
  }
}
eq('随机走子无异常/守恒失败', randomFailures, 0);
ok('随机走子确有执行', randomSteps > 300, String(randomSteps));

var hintSim = E.createGame({ seed: 2016, difficulty: 1 });
var hintSteps = 0;
while (!hintSim.over && hintSteps < 2500) {
  var hm = E.hint(hintSim);
  if (!hm) break;
  try { hintSim = E.applyMove(hintSim, hm); } catch (err) { break; }
  hintSteps += 1;
  if (E.allCards(hintSim).length !== 104) break;
  if (E.scoreBreakdown(hintSim).total !== hintSim.score) break;
}
ok('提示驱动对局结束或停手', hintSim.over || hintSteps >= 2500 || E.getLegalMoves(hintSim).length === 0, String(hintSteps));
eq('提示驱动全程 104 张', E.allCards(hintSim).length, 104);
eq('提示驱动全程唯一', new Set(E.allCards(hintSim).map(function (c) { return c.id; })).size, 104);
eq('提示驱动计分一致', E.scoreBreakdown(hintSim).total, hintSim.score);
ok('提示驱动产生日志', hintSim.log.length > 5, String(hintSim.log.length));

var cardCountsGame = E.createGame({ seed: 3, difficulty: 4 });
eq('cardCounts 与 allCards 一致', E.cardCounts(cardCountsGame).total, E.allCards(cardCountsGame).length);
eq('allCards(null) 为空', E.allCards(null), []);


/* ---------------------------------------------------------------- 美术产物与页面真实性 */
console.log('[STEP] 美术产物、尺寸与页面真实性');
var ASSET_DIR = path.join(__dirname, 'assets');
function webpSize(file) {
  var buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  var off = 12;
  while (off + 8 <= buf.length) {
    var tag = buf.toString('ascii', off, off + 4);
    var len = buf.readUInt32LE(off + 4);
    if (tag === 'VP8 ') {
      var p = off + 8;
      if (buf[p + 3] !== 0x9d || buf[p + 4] !== 0x01 || buf[p + 5] !== 0x2a) return null;
      return { w: buf[p + 6] | (buf[p + 7] << 8), h: buf[p + 8] | (buf[p + 9] << 8) };
    }
    if (tag === 'VP8X') {
      return {
        w: 1 + (buf[off + 12] | (buf[off + 13] << 8) | (buf[off + 14] << 16)),
        h: 1 + (buf[off + 15] | (buf[off + 16] << 8) | (buf[off + 17] << 16))
      };
    }
    off += 8 + len + (len % 2);
  }
  return null;
}
var artFiles = { cover: 'cover.webp', og: 'og.webp', detail: 'detail-1.webp', card: 'card.webp' };
Object.keys(artFiles).forEach(function (key) {
  var file = path.join(ASSET_DIR, artFiles[key]);
  var exists = fs.existsSync(file);
  ok('美术产物存在 ' + artFiles[key], exists && fs.statSync(file).size > 0, exists ? String(fs.statSync(file).size) : 'missing');
});
var coverSize = webpSize(path.join(ASSET_DIR, 'cover.webp'));
var ogSize = webpSize(path.join(ASSET_DIR, 'og.webp'));
var detailSize = webpSize(path.join(ASSET_DIR, 'detail-1.webp'));
var cardSize = webpSize(path.join(ASSET_DIR, 'card.webp'));
eq('cover 尺寸 1200×1200', coverSize, { w: 1200, h: 1200 });
eq('og 尺寸 1200×630', ogSize, { w: 1200, h: 630 });
ok('detail 尺寸 ≥1200×800', !!detailSize && detailSize.w >= 1200 && detailSize.h >= 800, JSON.stringify(detailSize));
eq('card 尺寸 480×320', cardSize, { w: 480, h: 320 });
ok('cover ≤300KB', fs.statSync(path.join(ASSET_DIR, 'cover.webp')).size <= 300 * 1024, String(fs.statSync(path.join(ASSET_DIR, 'cover.webp')).size));
ok('og ≤200KB', fs.statSync(path.join(ASSET_DIR, 'og.webp')).size <= 200 * 1024, String(fs.statSync(path.join(ASSET_DIR, 'og.webp')).size));
ok('detail ≤300KB', fs.statSync(path.join(ASSET_DIR, 'detail-1.webp')).size <= 300 * 1024, String(fs.statSync(path.join(ASSET_DIR, 'detail-1.webp')).size));
ok('card ≤60KB', fs.statSync(path.join(ASSET_DIR, 'card.webp')).size <= 60 * 1024, String(fs.statSync(path.join(ASSET_DIR, 'card.webp')).size));
var indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rulesHtml = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
ok('index.html 可见「单人」', indexHtml.indexOf('单人') !== -1);
ok('rules.html 可见「单人」', rulesHtml.indexOf('单人') !== -1);
ok('rules.html 含 Article + FAQPage', /"@type":\s*"Article"/.test(rulesHtml) && /"@type":\s*"FAQPage"/.test(rulesHtml));
var externalResources = (indexHtml.match(/<(?:script|img|link)\b[^>]*\b(?:src|href)="https?:\/\/[^"]+"/gi) || []).filter(function (tag) {
  return !/rel="canonical"/i.test(tag);
});
ok('页面无外部 http(s) 资源', externalResources.length === 0, externalResources.slice(0, 3).join('; '));
ok('页面引用本地共享模块', indexHtml.indexOf('../../shared/shuffle.js') !== -1 && indexHtml.indexOf('../../shared/sfx.js') !== -1 && indexHtml.indexOf('../../shared/store.js') !== -1);

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
