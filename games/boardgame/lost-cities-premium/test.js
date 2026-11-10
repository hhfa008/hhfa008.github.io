'use strict';

/*
 * Lost Cities premium — rules test harness.
 *   node games/boardgame/lost-cities-premium/test.js
 * Prints RESULT: N passed, M failed and exits non-zero on failure.
 */

var E = require('./engine.js');

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
function card(color, value) {
  return { id: color + '-' + value, color: color, kind: 'number', value: value };
}
function wager(color, n) {
  return { id: color + '-w' + n, color: color, kind: 'wager', value: 0 };
}
function sum(values) { return values.reduce(function (a, b) { return a + b; }, 0); }
function moveKey(m) { return E.moveKey(m); }
function isLegal(state, move) {
  return E.getLegalMoves(state).some(function (m) { return E.moveKey(m) === E.moveKey(move); });
}
function noMutation(state, fn) {
  var before = JSON.stringify(state);
  fn();
  return ok('state is not mutated', JSON.stringify(state) === before);
}
function setDeckLast(state, playerIndex) {
  var keep = state.players[0].hand[0] || state.players[1].hand[0];
  state.phase = 'draw';
  state.current = playerIndex || 0;
  state.pendingDiscard = null;
  state.deck = [keep || card('yellow', 5)];
  return state;
}
function assignExpedition(state, playerIndex, color, values, wagers) {
  var exp = state.players[playerIndex].exp[color];
  exp.nums = (values || []).map(function (v) { return card(color, v); });
  exp.wagers = [];
  for (var i = 0; i < (wagers || 0); i++) exp.wagers.push(wager(color, i + 1));
}

/* ---------------------------------------------------------------- 建局与牌组 */
console.log('[STEP] 牌组与发牌');
var deck = E.makeDeck();
eq('牌组共 60 张', deck.length, 60);
eq('牌组唯一 id 60 个', new Set(deck.map(function (c) { return c.id; })).size, 60);
eq('五色', new Set(deck.map(function (c) { return c.color; })).size, 5);
E.COLORS.forEach(function (color) {
  var mine = deck.filter(function (c) { return c.color === color.key; });
  eq(color.key + ' 共 12 张', mine.length, 12);
  eq(color.key + ' 数字 2–10 各一张', mine.filter(function (c) { return c.kind === 'number'; }).map(function (c) { return c.value; }).sort(function (a, b) { return a - b; }), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  eq(color.key + ' 赌注 3 张', mine.filter(function (c) { return c.kind === 'wager'; }).length, 3);
});
var game = E.createGame({ seed: 12345 });
eq('初始手牌各 8', game.players.map(function (p) { return p.hand.length; }), [8, 8]);
eq('初始牌堆 44', game.deck.length, 44);
eq('牌张守恒 60', E.allCards(game).length, 60);
eq('发牌后唯一牌 60', new Set(E.allCards(game).map(function (c) { return c.id; })).size, 60);
eq('初始回合 play', game.phase, 'play');
eq('初始第 1 局', game.round, 1);
eq('初始累计分 0', game.players.map(function (p) { return p.totalScore; }), [0, 0]);
eq('初始局分为空', game.players.map(function (p) { return p.roundScores.length; }), [0, 0]);
eq('初始无终局结果', game.result, null);
ok('日志有发牌记录', game.log.some(function (l) { return l.type === 'round'; }));
ok('牌背信息没有暴露（state 内牌堆是对象）', typeof game.deck[0] === 'object' && game.deck[0].id);
var sameA = E.createGame({ seed: 777 });
var sameB = E.createGame({ seed: 777 });
eq('同 seed 发牌一致', sameA.players.map(function (p) { return p.hand.map(function (c) { return c.id; }); }), sameB.players.map(function (p) { return p.hand.map(function (c) { return c.id; }); }));
var otherSeed = E.createGame({ seed: 778 });
ok('不同 seed 发牌不同', JSON.stringify(sameA.players[0].hand) !== JSON.stringify(otherSeed.players[0].hand));
var aiFirst = E.createGame({ seed: 4, humanFirst: false, isAI: [true, true], names: ['A', 'B'] });
eq('humanFirst=false 由座位 1 先手', aiFirst.current, 1);
eq('自定义名字', aiFirst.players.map(function (p) { return p.name; }), ['A', 'B']);
eq('自定义 AI 标记', aiFirst.players.map(function (p) { return p.isAI; }), [true, true]);

/* ---------------------------------------------------------------- 探险列合法性 */
console.log('[STEP] 探险列与赌注时机');
var exp = { wagers: [], nums: [] };
ok('空列可放赌注', E.canPlayCard(exp, wager('blue', 1)));
ok('空列可放任何数字', E.canPlayCard(exp, card('blue', 2)));
exp.wagers.push(wager('blue', 1));
ok('已有赌注仍可再放赌注', E.canPlayCard(exp, wager('blue', 2)));
exp.nums.push(card('blue', 5));
ok('有数字后不能放赌注', !E.canPlayCard(exp, wager('blue', 3)));
ok('更大的数字可放', E.canPlayCard(exp, card('blue', 6)));
ok('相同数字不可放', !E.canPlayCard(exp, card('blue', 5)));
ok('更小数字不可放', !E.canPlayCard(exp, card('blue', 4)));
ok('数字 2–10 均按枚举判断', E.canPlayCard(exp, card('blue', 10)) && !E.canPlayCard(exp, card('blue', 2)));

var craft = E.createGame({ seed: 42 });
craft.players[0].exp.green.nums = [card('green', 4)];
craft.players[0].hand = [
  { id: 'green-3', color: 'green', kind: 'number', value: 3 },
  { id: 'green-5', color: 'green', kind: 'number', value: 5 },
  wager('green', 1),
  wager('green', 2),
  card('red', 9),
  card('red', 2),
  card('blue', 10),
  card('blue', 3)
];
var legal = E.getLegalMoves(craft);
eq('8 张手牌生成 13 个基础动作', legal.filter(function (m) { return m.type === 'play' || m.type === 'discard'; }).length, 13);
eq('其中 8 个弃牌动作', legal.filter(function (m) { return m.type === 'discard'; }).length, 8);
eq('其中 5 个可放入探险列', legal.filter(function (m) { return m.type === 'play'; }).length, 5);
ok('不可放 green-3', !legal.some(function (m) { return m.type === 'play' && m.cardId === 'green-3'; }));
ok('可放 green-5', legal.some(function (m) { return m.type === 'play' && m.cardId === 'green-5'; }));
ok('有数字后赌注只能弃', !legal.some(function (m) { return m.type === 'play' && m.kind === 'wager'; }));
ok('任何手牌均可弃', [0, 1, 2, 3, 4, 5, 6, 7].every(function (i) {
  return legal.some(function (m) { return m.type === 'discard' && m.handIndex === i; });
}));
throws('小于列尾的数字被拒绝', function () {
  E.applyMove(craft, { type: 'play', handIndex: 0, cardId: 'green-3' });
}, /递增|数字/);

/* ---------------------------------------------------------------- 计分 */
console.log('[STEP] 计分公式');
eq('没有牌 0 分', E.expeditionScore({ wagers: [], nums: [] }), 0);
eq('一张赌注 -20', E.expeditionScore({ wagers: [wager('red', 1)], nums: [] }), -20);
eq('两张赌注 -40', E.expeditionScore({ wagers: [wager('red', 1), wager('red', 2)], nums: [] }), -40);
eq('三张赌注 -60', E.expeditionScore({ wagers: [wager('red', 1), wager('red', 2), wager('red', 3)], nums: [] }), -60);
eq('2..6 和 20 无赌注 = 0', E.expeditionScore({ wagers: [], nums: [2, 3, 4, 5, 6].map(function (v) { return card('yellow', v); }) }), 0);
eq('2..7 和 27 = 7', E.expeditionScore({ wagers: [], nums: [2, 3, 4, 5, 6, 7].map(function (v) { return card('yellow', v); }) }), 7);
eq('一张赌注让 (和-20)×2', E.expeditionScore({ wagers: [wager('yellow', 1)], nums: [2, 3, 4, 5, 6, 7].map(function (v) { return card('yellow', v); }) }), 14);
eq('两张赌注 ×3', E.expeditionScore({ wagers: [wager('yellow', 1), wager('yellow', 2)], nums: [4, 5, 6, 7, 8].map(function (v) { return card('yellow', v); }) }), 30);
eq('三张赌注 ×4', E.expeditionScore({ wagers: [wager('yellow', 1), wager('yellow', 2), wager('yellow', 3)], nums: [6, 7, 8, 9].map(function (v) { return card('yellow', v); }) }), 40);
eq('仅数字 8 张 2..9 得 +20 奖励', E.expeditionScore({ wagers: [], nums: [2, 3, 4, 5, 6, 7, 8, 9].map(function (v) { return card('green', v); }) }), 44);
eq('7 张无 +20 奖励', E.expeditionScore({ wagers: [], nums: [2, 3, 4, 5, 6, 7, 8].map(function (v) { return card('green', v); }) }), 15);
eq('赌注计入 8 张奖励', E.expeditionScore({ wagers: [wager('green', 1)], nums: [2, 3, 4, 5, 6, 7, 8].map(function (v) { return card('green', v); }) }), 50);
eq('三张赌注 + 五张数字恰好 8 张', E.expeditionScore({ wagers: [wager('red', 1), wager('red', 2), wager('red', 3)], nums: [6, 7, 8, 9, 10].map(function (v) { return card('red', v); }) }), 100);
eq('数字和不足 20 为负', E.expeditionScore({ wagers: [], nums: [2, 3].map(function (v) { return card('red', v); }) }), -15);
var row = E.expeditionBreakdown({ wagers: [wager('white', 1)], nums: [4, 5, 6, 7, 8, 9, 10].map(function (v) { return card('white', v); }) });
eq('breakdown 张数 8', row.cards, 8);
eq('breakdown 数字和 49', row.sum, 49);
eq('breakdown 基础分 58', row.base, 58);
eq('breakdown 奖励 20', row.bonus, 20);
eq('breakdown 总分 78', row.total, 78);
var scored = E.createGame({ seed: 9 });
assignExpedition(scored, 0, 'yellow', [2, 3, 4, 5, 6, 7, 8, 9], 0);
assignExpedition(scored, 0, 'blue', [3, 4, 5], 2);
assignExpedition(scored, 0, 'red', [], 1);
var pScore = E.scorePlayer(scored.players[0]);
eq('五色合计 = 各列合计', pScore.total, 44 + (-24) + (-20));
var expTotals = pScore.expeditions.map(function (x) { return x.total; });
eq('scorePlayer 给出五列', expTotals.length, 5);
eq('scorePlayer 合计一致', sum(expTotals), pScore.total);
var interim = E.getResults(scored);
eq('未结束 getResults 给出当前局分', interim.scores[0].roundScore, 0);
ok('未结束无冠军', interim.winner === null && interim.over === false);

/* ---------------------------------------------------------------- 打牌 / 弃牌 / 抽牌 */
console.log('[STEP] 回合流程与抽牌');
var s = E.createGame({ seed: 31415 });
var startHand = s.players[0].hand[0];
var playMove = E.getLegalMoves(s).filter(function (m) { return m.type === 'play'; })[0];
ok('开局至少一个可打出的动作', !!playMove);
noMutation(s, function () { E.applyMove(s, playMove); });
var afterPlay = E.applyMove(s, playMove);
eq('出牌后进入抽牌阶段', afterPlay.phase, 'draw');
eq('出牌后仍由同一玩家抽牌', afterPlay.current, 0);
eq('出牌后手牌 7', afterPlay.players[0].hand.length, 7);
eq('牌堆尚未减少', afterPlay.deck.length, 44);
eq('出牌记入日志', afterPlay.lastAction.type, 'play');
var drawMoves = E.getLegalMoves(afterPlay);
ok('抽牌阶段包含牌堆', drawMoves.some(function (m) { return m.type === 'draw' && m.source === 'deck'; }));
ok('抽牌阶段不包含打牌', drawMoves.every(function (m) { return m.type === 'draw'; }));
eq('刚开局弃牌堆为空所以只有牌堆可抽', drawMoves.length, 1);
throws('抽牌阶段不能继续出牌', function () { E.applyMove(afterPlay, { type: 'play', handIndex: 0 }); }, /抽一张|抽牌/);
var afterDraw = E.applyMove(afterPlay, { type: 'draw', source: 'deck' });
eq('抽牌后手牌恢复 8', afterDraw.players[0].hand.length, 8);
eq('牌堆减少到 43', afterDraw.deck.length, 43);
eq('抽牌后切换玩家', afterDraw.current, 1);
eq('抽牌后回到 play', afterDraw.phase, 'play');
eq('完整回合 turn=1', afterDraw.turn, 1);
ok('抽到牌来自原牌堆顶', afterDraw.deck.length === 43);
throws('出牌阶段不能抽牌', function () { E.applyMove(afterDraw, { type: 'draw', source: 'deck' }); }, /打出一张|弃牌/);

var d = E.createGame({ seed: 2718 });
var discardable = d.players[0].hand[0];
var disc = E.applyMove(d, { type: 'discard', handIndex: 0, cardId: discardable.id });
eq('弃牌进入对应颜色弃牌堆', disc.discards[discardable.color].length, 1);
eq('弃牌堆顶就是刚弃的牌', disc.discards[discardable.color][0].id, discardable.id);
eq('pendingDiscard 记录刚弃牌', disc.pendingDiscard, discardable.id);
eq('弃牌后进入 draw', disc.phase, 'draw');
var discMoves = E.getLegalMoves(disc);
ok('不能抽回刚弃的牌', !discMoves.some(function (m) { return m.source === 'discard' && m.color === discardable.color; }));
throws('强制抽刚弃牌报错', function () { E.applyMove(disc, { type: 'draw', source: 'discard', color: discardable.color }); }, /不能抽回/);
// 另一色弃牌堆可抽
var otherColor = E.COLOR_KEYS.filter(function (c) { return c !== discardable.color; })[0];
disc.discards[otherColor] = [card(otherColor, 7)];
discMoves = E.getLegalMoves(disc);
ok('其他弃牌堆顶可抽', discMoves.some(function (m) { return m.source === 'discard' && m.color === otherColor; }));
var fromPile = E.applyMove(disc, { type: 'draw', source: 'discard', color: otherColor });
eq('从弃牌堆抽牌后该堆清空', fromPile.discards[otherColor].length, 0);
eq('抽到的牌进了手牌', fromPile.players[0].hand.some(function (c) { return c.id === otherColor + '-7'; }), true);
eq('从弃牌堆抽牌不减少牌堆', fromPile.deck.length, disc.deck.length);
eq('从弃牌堆抽牌也完成回合', fromPile.current, 1);
// 自己的旧弃牌（非本回合）可以抽
var old = E.createGame({ seed: 99 });
var oldCard = old.players[0].hand[0];
old.discards[oldCard.color] = [oldCard];
old.players[0].hand.splice(0, 1);
old.phase = 'draw';
old.pendingDiscard = null;
var oldDraw = E.applyMove(old, { type: 'draw', source: 'discard', color: oldCard.color });
ok('自己以前弃的牌可以抽回', oldDraw.players[0].hand.some(function (c) { return c.id === oldCard.id; }));

/* ---------------------------------------------------------------- 非法动作 */
console.log('[STEP] 非法动作');
var bad = E.createGame({ seed: 8 });
throws('空动作', function () { E.applyMove(bad, null); }, /动作非法/);
throws('未知动作类型', function () { E.applyMove(bad, { type: 'teleport', handIndex: 0 }); }, /打出|弃牌/);
throws('手牌索引越界', function () { E.applyMove(bad, { type: 'discard', handIndex: 99 }); }, /手牌编号/);
throws('手牌索引非整数', function () { E.applyMove(bad, { type: 'discard', handIndex: 1.5 }); }, /手牌编号/);
throws('手牌 id 过期', function () { E.applyMove(bad, { type: 'discard', handIndex: 0, cardId: 'not-a-card' }); }, /手牌已变化/);
var ended = E.createGame({ seed: 8 });
ended.over = true;
throws('终局不能行动', function () { E.applyMove(ended, { type: 'discard', handIndex: 0 }); }, /已结束/);
eq('终局 legalMoves 为空', E.getLegalMoves(ended), []);
var emptyDraw = E.createGame({ seed: 8 });
emptyDraw.phase = 'draw';
emptyDraw.deck = [];
emptyDraw.discards = { yellow: [], blue: [], white: [], green: [], red: [] };
eq('没有可抽的牌时 legalMoves 为空', E.getLegalMoves(emptyDraw), []);
throws('空牌堆不能抽', function () { E.applyMove(emptyDraw, { type: 'draw', source: 'deck' }); }, /牌堆已空/);
throws('空弃牌堆不能抽', function () { E.applyMove(emptyDraw, { type: 'draw', source: 'discard', color: 'yellow' }); }, /为空/);
throws('抽牌颜色非法', function () { E.applyMove(emptyDraw, { type: 'draw', source: 'discard', color: 'pink' }); }, /颜色非法/);
throws('抽牌来源非法', function () { E.applyMove(emptyDraw, { type: 'draw', source: 'pocket' }); }, /来源非法/);

/* ---------------------------------------------------------------- 最后一张与三局 */
console.log('[STEP] 最后一张牌与三局累计');
var last = E.createGame({ seed: 3 });
setDeckLast(last, 0);
var lastCard = last.deck[0];
var afterLast = E.applyMove(last, { type: 'draw', source: 'deck' });
ok('抽走最后一张后本局结束', !!afterLast.lastRound);
eq('最后一张局结束原因', afterLast.lastRound.reason, '牌堆最后一张牌被抽走');
eq('最后一张由抽牌者抽走', afterLast.lastAction.player, 0);
eq('抽走最后一张后直接进入第 2 局', afterLast.round, 2);
eq('新一局重新发 8 张', afterLast.players.map(function (p) { return p.hand.length; }), [8, 8]);
eq('新一局牌堆 44', afterLast.deck.length, 44);
eq('新一局弃牌清空', afterLast.discards.yellow.length + afterLast.discards.blue.length, 0);
eq('对手没有获得额外回合', afterLast.lastRound.round, 1);
eq('第一局结果已记录', afterLast.roundResults.length, 1);
eq('第一局分数已进入累计', afterLast.players[0].roundScores.length, 1);
ok('最后一张触发新一局重新洗牌', afterLast.log.some(function (l) { return l.round === 2 && l.type === 'round'; }));
eq('原局最后动作是抽牌', afterLast.lastAction.type, 'draw');
eq('抽最后一张的人仍是原玩家', afterLast.lastRound.scores.length, 2);

var third = E.createGame({ seed: 11 });
third.round = 3;
third.players[0].roundScores = [1, 2]; third.players[1].roundScores = [2, 1];
third.players[0].totalScore = 3; third.players[1].totalScore = 3;
third.roundResults = [
  { round: 1, scores: [{ index: 0, total: 1 }, { index: 1, total: 2 }] },
  { round: 2, scores: [{ index: 0, total: 2 }, { index: 1, total: 1 }] }
];
setDeckLast(third, 0);
var finished = E.applyMove(third, { type: 'draw', source: 'deck' });
eq('第 3 局最后一张后终局', finished.over, true);
eq('终局 phase=over', finished.phase, 'over');
ok('终局有 result', !!finished.result);
eq('终局累计三局', finished.result.scores[0].roundScores.length, 3);
eq('终局 roundResults 三局', finished.result.roundResults.length, 3);
eq('winner 返回索引', finished.result.tied ? E.winner(finished) === 'tie' : E.winner(finished) === finished.result.winner, true);

// 三局累计：第 1 局 P0 大胜，第 2 局 P1 胜，验证局间先手。
var match = E.createGame({ seed: 101 });
assignExpedition(match, 0, 'yellow', [2, 3, 4, 5, 6, 7, 8, 9], 0); // 44
setDeckLast(match, 0);
match = E.applyMove(match, { type: 'draw', source: 'deck' });
eq('第 1 局 P0 44 分', match.roundResults[0].scores[0].total, 44);
eq('第 1 局结束进入第 2 局', match.round, 2);
eq('第 1 局胜者先手第 2 局', match.starter, 0);
assignExpedition(match, 1, 'red', [2, 3, 4, 5, 6, 7], 1); // (27-20)*2 = 14
setDeckLast(match, 0);
match = E.applyMove(match, { type: 'draw', source: 'deck' });
eq('第 2 局 P1 14 分', match.roundResults[1].scores[1].total, 14);
eq('第 2 局结束进入第 3 局', match.round, 3);
eq('第 2 局胜者 P1 先手第 3 局', match.starter, 1);
assignExpedition(match, 0, 'blue', [4, 5, 6, 7], 0); // (22-20)=2
setDeckLast(match, 1);
match = E.applyMove(match, { type: 'draw', source: 'deck' });
eq('三局结束', match.over, true);
eq('累计分 = 三局之和 P0', match.players[0].totalScore, 44 + 0 + 2);
eq('累计分 = 三局之和 P1', match.players[1].totalScore, 0 + 14 + 0);
eq('三局总分冠军 P0', match.result.winner, 0);
eq('三局总分非平局', match.result.tied, false);
eq('result 分数与玩家累计一致', match.result.scores.map(function (r) { return r.total; }), match.players.map(function (p) { return p.totalScore; }));
eq('roundScores 与 roundResults 分一致', match.players[0].roundScores, match.roundResults.map(function (r) { return r.scores[0].total; }));

// 平局共享胜利
var tied = E.createGame({ seed: 55 });
tied.round = 3;
assignExpedition(tied, 0, 'green', [2, 3, 4, 5, 6, 7], 0); // 7
assignExpedition(tied, 1, 'green', [2, 3, 4, 5, 6, 7], 0); // 7
tied.players[0].roundScores = [10, 10]; tied.players[1].roundScores = [10, 10];
tied.players[0].totalScore = 20; tied.players[1].totalScore = 20;
setDeckLast(tied, 0);
tied = E.applyMove(tied, { type: 'draw', source: 'deck' });
eq('总分相同共享胜利', tied.result.tied, true);
eq('共享胜利 winner null', tied.result.winner, null);
eq('共享胜利 winners 两人', tied.result.winners.sort(), [0, 1]);
eq('winner() 平局返回 tie', E.winner(tied), 'tie');

/* ---------------------------------------------------------------- AI */
console.log('[STEP] AI 三档与自对弈');
eq('三档 AI', E.AI_LEVELS, ['easy', 'normal', 'hard']);
['easy', 'normal', 'hard'].forEach(function (level) {
  var aiState = E.createGame({ seed: 61 });
  var m1 = E.chooseAIMove(aiState, level);
  ok(level + ' 出牌阶段返回合法动作', isLegal(aiState, m1));
  var aiNext = E.applyMove(aiState, m1);
  var m2 = E.chooseAIMove(aiNext, level);
  ok(level + ' 抽牌阶段返回合法动作', isLegal(aiNext, m2));
  var aiDone = E.applyMove(aiNext, m2);
  ok(level + ' 两次动作完成完整回合', aiDone.current === 1 && aiDone.phase === 'play');
});

// 弃牌堆利用
var discardAI = E.createGame({ seed: 62 });
discardAI.phase = 'draw';
discardAI.current = 0;
discardAI.drawStreak = 0;
discardAI.deck = [card('yellow', 2), card('blue', 3)];
discardAI.players[0].exp.green.nums = [card('green', 2), card('green', 3), card('green', 4)];
discardAI.discards.green = [card('green', 10)];
var discardChoice = E.chooseAIMove(discardAI, 'hard');
ok('困难 AI 会利用高价值弃牌堆', discardChoice.type === 'draw' && discardChoice.source === 'discard' && discardChoice.color === 'green', JSON.stringify(discardChoice));
ok('AI 抽牌不抽刚弃的牌', E.getLegalMoves(discardAI).every(function (m) { return !m.color || m.color !== discardAI.pendingDiscard; }));

var easyCount = [];
var normalCount = [];
var hardCount = [];
for (var seedAI = 1; seedAI <= 8; seedAI++) {
  var probe = E.createGame({ seed: seedAI });
  easyCount.push(moveKey(E.chooseAIMove(probe, 'easy')));
  normalCount.push(moveKey(E.chooseAIMove(probe, 'normal')));
  hardCount.push(moveKey(E.chooseAIMove(probe, 'hard')));
}
ok('三档 AI 至少各有一次不同决策', new Set(easyCount).size > 1 && new Set(normalCount).size > 1 && new Set(hardCount).size > 1);
ok('简单与困难在样本中有差异', easyCount.join('|') !== hardCount.join('|'));

var levels = ['easy', 'normal', 'hard'];
var selfPlayGames = 0;
var selfPlayFailures = 0;
for (var gi = 0; gi < 30; gi++) {
  var level = levels[gi % levels.length];
  var sim = E.createGame({ seed: 9000 + gi });
  var steps = 0;
  var okGame = true;
  while (!sim.over && steps < 2600) {
    var action;
    try { action = E.chooseAIMove(sim, level); }
    catch (err) { okGame = false; break; }
    if (!action) { okGame = false; break; }
    try { sim = E.applyMove(sim, action); }
    catch (err) { okGame = false; break; }
    steps += 1;
  }
  if (!sim.over || !okGame || E.allCards(sim).length !== 60) selfPlayFailures += 1;
  else {
    selfPlayGames += 1;
    if (sim.roundResults.length !== 3) selfPlayFailures += 1;
    if (!Number.isFinite(sim.players[0].totalScore) || !Number.isFinite(sim.players[1].totalScore)) selfPlayFailures += 1;
  }
}
eq('30 局 AI 自对弈全部结束', selfPlayGames, 30);
eq('30 局自对弈无死循环 / 牌张守恒失败', selfPlayFailures, 0);

// 随机制裁：200 个随机合法动作后仍 60 张
var randomState = E.createGame({ seed: 4321 });
var randomSteps = 0;
var randomOk = true;
for (var ri = 0; ri < 200; ri++) {
  if (randomState.over) randomState = E.createGame({ seed: 5000 + ri });
  var legalNow = E.getLegalMoves(randomState);
  if (!legalNow.length) { randomOk = false; break; }
  var pick = legalNow[(ri * 37 + 11) % legalNow.length];
  try { randomState = E.applyMove(randomState, pick); } catch (err) { randomOk = false; break; }
  randomSteps += 1;
  if (E.allCards(randomState).length !== 60) { randomOk = false; break; }
}
eq('随机 200 个合法动作不破坏牌张守恒', randomOk, true);
ok('随机动作确实执行', randomSteps === 200, 'steps=' + randomSteps);

/* ---------------------------------------------------------------- 额外守恒与日志 */
console.log('[STEP] 守恒、日志与结果');
var complete = E.createGame({ seed: 123456 });
var completeSteps = 0;
while (!complete.over && completeSteps < 2600) {
  complete = E.applyMove(complete, E.chooseAIMove(complete, 'hard'));
  completeSteps += 1;
}
eq('完整对局后牌张 60', E.allCards(complete).length, 60);
eq('完整对局后无重复牌', new Set(E.allCards(complete).map(function (c) { return c.id; })).size, 60);
eq('完整对局 3 条局结果', complete.roundResults.length, 3);
eq('完整对局每位玩家 3 个局分', complete.players.map(function (p) { return p.roundScores.length; }), [3, 3]);
ok('完整对局日志 > 20 条', complete.log.length > 20, 'log=' + complete.log.length);
ok('日志包含三局结束', complete.log.filter(function (l) { return l.type === 'round-end'; }).length === 3);
ok('终局日志出现', complete.log.some(function (l) { return l.type === 'end'; }));
eq('result reason', complete.result.reason, '三局累计总分');
eq('result 与 getResults 一致', E.getResults(complete).scores.map(function (r) { return r.total; }), complete.result.scores.map(function (r) { return r.total; }));
ok('winner 返回合法', complete.result.tied ? E.winner(complete) === 'tie' : (E.winner(complete) === 0 || E.winner(complete) === 1));

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
