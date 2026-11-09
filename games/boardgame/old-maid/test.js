'use strict';

var E = require('./engine.js');

var passed = 0;
var failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('FAIL: ' + msg);
  }
}

function eq(actual, expected, msg) {
  var good = Object.is(actual, expected);
  if (!good) {
    console.error('  expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
  }
  ok(good, msg);
}

function throws(fn, msg) {
  var threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
  }
  ok(threw, msg);
}

function card(rank, suit) {
  return { id: rank + suit, rank: rank, suit: suit };
}

function mk(h0, h1, turn) {
  return {
    deck: [],
    hands: [h0, h1],
    turn: turn == null ? 0 : turn,
    phase: 'playing',
    winner: null,
    loser: null,
    log: [],
    discarded: [],
    rng: E.mulberry32(9),
    lastEvent: null
  };
}

function isPairFree(hand) {
  var seen = {};
  for (var i = 0; i < hand.length; i++) {
    if (seen[hand[i].rank]) return false;
    seen[hand[i].rank] = true;
  }
  return true;
}

function countQueens(hand) {
  var n = 0;
  for (var i = 0; i < hand.length; i++) if (hand[i].rank === 'Q') n++;
  return n;
}

/* ========== deck ========== */
var deck = E.createDeck();
eq(deck.length, 51, 'createDeck() 返回 51 张牌');
eq(deck.filter(function (c) { return c.id === E.OLD_MAID_ID; }).length, 0, '黑桃皇后 Q♠ 已移除');
eq(deck.filter(function (c) { return c.rank === 'Q'; }).length, 3, '牌堆中正好剩 3 张皇后');
eq(deck.filter(function (c) { return c.rank === 'Q' && c.suit === 'S'; }).length, 0, '没有黑桃皇后');
eq(deck.filter(function (c) { return c.rank === 'Q' && c.suit === 'H'; }).length, 1, '红桃皇后仍在');
eq(new Set(deck.map(function (c) { return c.id; })).size, 51, '51 张牌 id 全部唯一');

var rankCountsOk = true;
E.RANKS.forEach(function (r) {
  var n = deck.filter(function (c) { return c.rank === r; }).length;
  if (n !== (r === 'Q' ? 3 : 4)) rankCountsOk = false;
});
ok(rankCountsOk, '除皇后外每种点数 4 张，皇后 3 张');

var suitCountsOk = true;
E.SUITS.forEach(function (s) {
  var n = deck.filter(function (c) { return c.suit === s; }).length;
  if (n !== (s === 'S' ? 12 : 13)) suitCountsOk = false;
});
ok(suitCountsOk, '黑桃 12 张、其余花色各 13 张');

eq(E.RANKS.length, 13, 'RANKS 有 13 种点数');
eq(E.SUITS.length, 4, 'SUITS 有 4 种花色');
eq(E.suitSymbol('S'), '♠', 'suitSymbol(S) = ♠');
eq(E.suitSymbol('H'), '♥', 'suitSymbol(H) = ♥');
eq(E.suitSymbol('D'), '♦', 'suitSymbol(D) = ♦');
eq(E.suitSymbol('C'), '♣', 'suitSymbol(C) = ♣');
eq(E.rankLabel('K'), 'K', 'rankLabel(K) = K');
eq(E.rankLabel('10'), '10', 'rankLabel(10) = 10');
ok(E.isRed('H') && E.isRed('D'), '红桃与方块是红色');
ok(!E.isRed('S') && !E.isRed('C'), '黑桃与梅花不是红色');
ok(E.isRed(card('A', 'D')), 'isRed 支持牌对象');
eq(E.OLD_MAID_ID, 'QS', 'OLD_MAID_ID 是 QS');

/* ========== removePairs ========== */
var pairHand = [card('K', 'S'), card('3', 'D'), card('K', 'H')];
var pairRes = E.removePairs(pairHand);
eq(pairRes.hand.length, 1, '一对 K 被移除，只剩 1 张');
eq(pairRes.hand[0].id, '3D', '留下的单牌是 3♦');
eq(pairRes.removed.length, 2, '移除的牌数为 2');
eq(pairRes.removed[0].rank, 'K', '移除的牌属于 K 对子');
eq(pairHand.length, 3, 'removePairs 不修改原数组');

var noPair = E.removePairs([card('A', 'S'), card('2', 'H')]);
eq(noPair.hand.length, 2, '无对子时手牌不变');
eq(noPair.removed.length, 0, '无对子时不弃牌');

var queens3 = E.removePairs([card('Q', 'H'), card('Q', 'D'), card('Q', 'C')]);
eq(queens3.hand.length, 1, '三张皇后只留一张');
eq(queens3.removed.length, 2, '三张皇后弃掉一对');
eq(queens3.hand[0].rank, 'Q', '留下的仍是皇后');

var four7 = E.removePairs([card('7', 'S'), card('7', 'H'), card('7', 'D'), card('7', 'C')]);
eq(four7.hand.length, 0, '四张同点数全部成对弃掉');
eq(four7.removed.length, 4, '四张同点数弃掉两对');

/* ========== createGame deal / setup ========== */
var g = E.createGame({ seed: 2024 });
eq(g.hands.length, 2, '游戏有两手牌');
eq(g.dealtCounts[0], 26, '玩家分到 26 张');
eq(g.dealtCounts[1], 25, '电脑分到 25 张');
eq(g.dealtCounts[0] + g.dealtCounts[1], 51, '总共发出 51 张');
eq(g.turn, 0, '玩家先手');
eq(g.phase, 'playing', '开局状态为 playing');
eq(g.winner, null, '开局 winner 为 null');
eq(g.loser, null, '开局 loser 为 null');
eq(g.hands[0].length + g.hands[1].length + g.discarded.length, 51, '手牌加弃牌共 51 张');
eq(g.discarded.length % 2, 0, '初始弃牌都是成对的');
ok(g.discarded.length > 0, '开局自动弃掉了同点数对子');
ok(isPairFree(g.hands[0]), '开局玩家手牌没有同点数对子');
ok(isPairFree(g.hands[1]), '开局电脑手牌没有同点数对子');
eq(countQueens(g.hands[0]) + countQueens(g.hands[1]), 1, '场上恰好剩一张无法配对的皇后');
eq(g.log.filter(function (s) { return typeof s === 'string' && s.length > 0; }).length, g.log.length,
  'log 全部为中文文本条目');
ok(g.log.length >= 3, '开局日志至少 3 条');
ok(typeof g.rng === 'function', 'state 携带 rng 函数');
eq(typeof E.handCounts(g)[0], 'number', 'handCounts 返回数字');
eq(E.handCounts(g)[0], g.hands[0].length, 'handCounts[0] 与手牌数一致');
eq(E.handCounts(g)[1], g.hands[1].length, 'handCounts[1] 与手牌数一致');

var pairSplitOk = true;
E.RANKS.forEach(function (r) {
  if (r === 'Q') return;
  var in0 = g.hands[0].filter(function (c) { return c.rank === r; }).length;
  var in1 = g.hands[1].filter(function (c) { return c.rank === r; }).length;
  var total = in0 + in1;
  if (!(total === 0 || (total === 2 && in0 === 1 && in1 === 1))) pairSplitOk = false;
});
ok(pairSplitOk, '除皇后外，余牌要么没有、要么两张分居两边');

var allPairFree = true;
for (var s = 1; s <= 20; s++) {
  var sg = E.createGame({ seed: s });
  if (!isPairFree(sg.hands[0]) || !isPairFree(sg.hands[1])) allPairFree = false;
}
ok(allPairFree, '20 个不同种子开局均完成自动配对清理');

var ga = E.createGame({ seed: 7 });
var gb = E.createGame({ seed: 7 });
eq(JSON.stringify(ga.hands), JSON.stringify(gb.hands), '相同种子产生相同发牌');
eq(JSON.stringify(ga.discarded), JSON.stringify(gb.discarded), '相同种子产生相同初始弃牌');
ok(JSON.stringify(E.createGame({ seed: 8 }).hands) !== JSON.stringify(ga.hands), '不同种子产生不同发牌');

/* ========== drawCard: transfer ========== */
var st = mk(
  [card('3', 'H'), card('9', 'D')],
  [card('5', 'C'), card('7', 'S'), card('K', 'H')],
  0
);
var beforeOpp = st.hands[1].length;
var drawnId = st.hands[1][1].id;
var ret = E.drawCard(st, 0, 1);
eq(ret, st, 'drawCard 返回 state');
eq(st.hands[0].length, 3, '抽牌后抽牌者多一张');
eq(st.hands[1].length, beforeOpp - 1, '对手少一张');
ok(st.hands[0].some(function (c) { return c.id === drawnId; }), '抽到的牌转移到抽牌者手中');
eq(st.discarded.length, 0, '未凑成对时不弃牌');
eq(st.turn, 1, '抽牌后轮到对手');
eq(st.lastEvent.drawn.id, drawnId, 'lastEvent 记录抽到的牌');
eq(st.lastEvent.index, 1, 'lastEvent 记录抽牌位置');
eq(st.phase, 'playing', '未出完牌时继续游戏');

/* ========== drawCard: pair after draw ========== */
st = mk(
  [card('3', 'H'), card('9', 'D')],
  [card('3', 'C'), card('5', 'S'), card('7', 'H')],
  0
);
E.drawCard(st, 0, 0);
eq(st.hands[0].length, 1, '抽到同点数后自动弃掉一对');
eq(st.hands[0][0].id, '9D', '留下的单牌正确');
eq(st.discarded.length, 2, '弃牌堆增加两张');
eq(st.discarded[0].rank, '3', '弃掉的是 3 的对子');
eq(st.hands[1].length, 2, '对手被抽走一张');
eq(st.turn, 1, '凑对后回合仍然交给对手');
eq(st.lastEvent.removed.length, 2, 'lastEvent 记录凑对移除的牌');

/* ========== invalid draw ========== */
st = mk([card('3', 'H'), card('4', 'D')], [card('5', 'C'), card('6', 'S')], 0);
throws(function () { E.drawCard(st, 0, -1); }, '负数索引被拒绝');
throws(function () { E.drawCard(st, 0, 99); }, '越界索引被拒绝');
throws(function () { E.drawCard(st, 0, 0.5); }, '小数索引被拒绝');
throws(function () { E.drawCard(st, 0, '0'); }, '字符串索引被拒绝');
throws(function () { E.drawCard(st, 1, 0); }, '不是当前回合的玩家不能抽牌');
eq(st.hands[0].length, 2, '非法抽牌后抽牌者手牌不变');
eq(st.hands[1].length, 2, '非法抽牌后对手手牌不变');
eq(st.turn, 0, '非法抽牌后回合不变');

/* ========== turn alternation ========== */
st = mk(
  [card('2', 'H'), card('8', 'D')],
  [card('4', 'C'), card('6', 'S'), card('10', 'H')],
  0
);
E.drawCard(st, 0, 0);
eq(st.turn, 1, '玩家抽牌后 turns 为 1');
E.drawCard(st, 1, 0);
eq(st.turn, 0, '电脑抽牌后 turns 回到 0');
E.drawCard(st, 0, 0);
eq(st.turn, 1, '再次交替到电脑');

/* ========== ending: opposing hand empties ========== */
st = mk([card('Q', 'H'), card('9', 'D')], [card('9', 'C')], 0);
E.drawCard(st, 0, 0);
eq(st.phase, 'over', '一方手牌为空时游戏结束');
eq(st.winner, 1, '空手玩家的对手获胜');
eq(st.loser, 0, '持有皇后的玩家失败');
eq(st.hands[0].length, 1, '失败者手里剩一张');
eq(st.hands[0][0].rank, 'Q', '失败者剩下的正是皇后');
eq(st.hands[1].length, 0, '获胜者已经出完手牌');
ok(st.log.some(function (s) { return s.indexOf('获胜') !== -1; }), '结束日志包含获胜提示');

/* ========== ending: drawer empties own hand ========== */
st = mk([card('3', 'H')], [card('3', 'C'), card('Q', 'D')], 0);
E.drawCard(st, 0, 0);
eq(st.phase, 'over', '抽牌凑对清空自己手牌也结束游戏');
eq(st.winner, 0, '出完手牌的玩家获胜');
eq(st.loser, 1, '对手成为乌龟');
eq(st.hands[0].length, 0, '获胜者手牌为空');
eq(st.hands[1].length, 1, '失败者手里剩皇后');
eq(st.hands[1][0].id, 'QD', '失败者剩下的是皇后 QD');

throws(function () { E.drawCard(st, 0, 0); }, '游戏结束后不能继续抽牌');

/* ========== checkOver direct ========== */
st = mk([], [card('Q', 'C')], 1);
eq(E.checkOver(st), true, 'checkOver 检测到空手牌');
eq(st.phase, 'over', 'checkOver 设置 phase=over');
eq(st.winner, 0, 'checkOver 判定空手玩家的对手获胜');
eq(st.loser, 1, 'checkOver 判定持皇后者失败');
eq(E.checkOver(st), true, 'checkOver 对已结束游戏幂等');
st = mk([card('A', 'S')], [card('K', 'D')], 0);
eq(E.checkOver(st), false, '双方都有牌时 checkOver 返回 false');

/* ========== AI index legality ========== */
for (var seed = 1; seed <= 25; seed++) {
  var aiState = E.createGame({ seed: seed });
  var guard = 0;
  while (aiState.phase === 'playing' && guard < 300) {
    var turn = aiState.turn;
    var oppLen = aiState.hands[1 - turn].length;
    var idx = E.aiChooseIndex(aiState);
    if (!(Number.isInteger(idx) && idx >= 0 && idx < oppLen)) {
      ok(false, 'AI 选择的索引必须合法 (seed ' + seed + ', idx ' + idx + ', len ' + oppLen + ')');
      break;
    }
    E.drawCard(aiState, turn, idx);
    guard++;
  }
}
ok(true, '25 局中 AI 每次选择的索引均落在合法范围');

var aiA = E.createGame({ seed: 123 });
var aiB = E.createGame({ seed: 123 });
var idxA = E.aiChooseIndex(aiA);
var idxB = E.aiChooseIndex(aiB);
eq(idxA, idxB, '相同种子下 aiChooseIndex 结果确定');

var emptyOpp = mk([], [card('Q', 'C')], 1);
eq(E.aiChooseIndex(emptyOpp), -1, '对手无牌时 AI 返回 -1');

/* ========== 30 self-play games ========== */
var selfPlayOk = true;
var selfPlaySteps = [];
for (var seed2 = 1; seed2 <= 30; seed2++) {
  var game = E.createGame({ seed: seed2 });
  var steps = 0;
  var error = null;
  while (game.phase === 'playing' && steps < 1000) {
    var drawer = game.turn;
    var aiIdx = E.aiChooseIndex(game);
    if (!(Number.isInteger(aiIdx) && aiIdx >= 0 && aiIdx < game.hands[1 - drawer].length)) {
      error = '非法 AI 索引';
      break;
    }
    try {
      E.drawCard(game, drawer, aiIdx);
    } catch (e) {
      error = e.message;
      break;
    }
    steps++;
  }
  selfPlaySteps.push(steps);

  if (error) {
    ok(false, '自对局 seed ' + seed2 + ' 出现非法操作：' + error);
    selfPlayOk = false;
    continue;
  }
  if (game.phase !== 'over') {
    ok(false, '自对局 seed ' + seed2 + ' 在 ' + steps + ' 步内未结束（步数上限内无死循环）');
    selfPlayOk = false;
    continue;
  }

  ok(steps < 1000, '自对局 seed ' + seed2 + ' 在步数上限内结束');
  ok(game.winner === 0 || game.winner === 1, '自对局 seed ' + seed2 + ' 恰好有一个赢家');
  ok(game.loser === 0 || game.loser === 1, '自对局 seed ' + seed2 + ' 恰好有一个输家');
  ok(game.winner === 1 - game.loser, '自对局 seed ' + seed2 + ' 赢家与输家互补');
  ok(game.hands[game.winner].length === 0, '自对局 seed ' + seed2 + ' 赢家手牌为空');
  ok(game.hands[game.loser].length === 1, '自对局 seed ' + seed2 + ' 输家手里恰好一张');
  ok(game.hands[game.loser][0].rank === 'Q', '自对局 seed ' + seed2 + ' 输家手里是皇后');
  ok(game.hands[0].length + game.hands[1].length + game.discarded.length === 51,
    '自对局 seed ' + seed2 + ' 全部 51 张牌有去向');
  ok(game.discarded.length % 2 === 0, '自对局 seed ' + seed2 + ' 弃牌始终成对');
  ok(countQueens(game.hands[game.loser]) === 1, '自对局 seed ' + seed2 + ' 乌龟皇后唯一');
}
ok(selfPlayOk, '30 局全自动对局全部正常结束且无非法操作');
ok(Math.max.apply(null, selfPlaySteps) < 1000, '所有自对局均未触发步数上限');

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
