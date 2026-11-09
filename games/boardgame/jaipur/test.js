'use strict';

/*
 * Jaipur（斋普尔）引擎与页面测试。
 *
 * 页面与测试共用同源 engine.js；这里直接 require 引擎，避免复制规则。
 * 运行：node games/boardgame/jaipur/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('jaipur');

var E = require('./engine.js');

/* ------------------------------------------------------------------ */
/* 工具                                                               */
/* ------------------------------------------------------------------ */

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function zeroHand() {
  var hand = {};
  E.GOODS.forEach(function (good) { hand[good] = 0; });
  return hand;
}

// 卡片守恒：市场 + 牌堆 + 弃牌 + 双方手牌 + 双方骆驼 = 44 货物 + 12 骆驼。
function cardTotal(state) {
  var total = state.market.length + state.deck.length + state.discard.length;
  state.players.forEach(function (player) {
    total += player.camels;
    E.GOODS.forEach(function (good) { total += player.hand[good]; });
  });
  return total;
}

function marketGoods(state) {
  return E.GOODS.filter(function (good) { return state.market.indexOf(good) !== -1; });
}

function firstMarketGood(state) {
  return marketGoods(state)[0];
}

function moveInList(moves, move) {
  var wanted = JSON.stringify(move);
  return moves.some(function (item) { return JSON.stringify(item) === wanted; });
}

function cjkCount(text) {
  return (text.match(/[\u4e00-\u9fff]/g) || []).length;
}

/* ------------------------------------------------------------------ */
/* 1. 数据完整性                                                       */
/* ------------------------------------------------------------------ */

s.group('数据完整性', function () {
  s.eq('货物种类 6 种', E.GOODS.length, 6);
  s.eq('钻石 6 张', E.CARD_COUNTS.diamond, 6);
  s.eq('黄金 6 张', E.CARD_COUNTS.gold, 6);
  s.eq('白银 6 张', E.CARD_COUNTS.silver, 6);
  s.eq('丝绸 8 张', E.CARD_COUNTS.silk, 8);
  s.eq('香料 8 张', E.CARD_COUNTS.spice, 8);
  s.eq('皮革 10 张', E.CARD_COUNTS.leather, 10);
  s.eq('货物总数 44 张', E.GOODS.reduce(function (sum, good) {
    return sum + E.CARD_COUNTS[good];
  }, 0), 44);

  s.eq('钻石代币 7,7,5,5,5', E.TOKEN_VALUES.diamond, [7, 7, 5, 5, 5]);
  s.eq('黄金代币 6,6,5,5,5', E.TOKEN_VALUES.gold, [6, 6, 5, 5, 5]);
  s.eq('白银代币 5,5,5,5,5', E.TOKEN_VALUES.silver, [5, 5, 5, 5, 5]);
  s.ok('丝绸/香料代币从高到低', E.TOKEN_VALUES.silk.every(function (value, index, arr) {
    return index === 0 || value <= arr[index - 1];
  }) && E.TOKEN_VALUES.spice.every(function (value, index, arr) {
    return index === 0 || value <= arr[index - 1];
  }));
  s.ok('皮革代币从高到低', E.TOKEN_VALUES.leather.every(function (value, index, arr) {
    return index === 0 || value <= arr[index - 1];
  }));
  s.eq('代币总数 38 枚', E.GOODS.reduce(function (sum, good) {
    return sum + E.TOKEN_VALUES[good].length;
  }, 0), 38);

  s.eq('钻石/黄金/白银至少卖 2 张', [
    E.MIN_SELL.diamond, E.MIN_SELL.gold, E.MIN_SELL.silver
  ], [2, 2, 2]);
  s.eq('丝绸/香料/皮革至少卖 1 张', [
    E.MIN_SELL.silk, E.MIN_SELL.spice, E.MIN_SELL.leather
  ], [1, 1, 1]);
  s.eq('奖励分 3/4/5 张 = 5/4/3', E.BONUS_VALUES, { 3: 5, 4: 4, 5: 3 });

  s.eq('骆驼总数 12 只', E.CAMELS_PER_PLAYER * 2 + E.CAMELS_IN_MARKET + E.CAMELS_EXTRA, 12);
  s.eq('市场容量 5 张', E.MARKET_SIZE, 5);
  s.eq('先赢 2 轮', E.ROUNDS_TO_WIN, 2);
  s.ok('引擎 API 齐全', ['createGame', 'legalMoves', 'applyMove', 'aiMove', 'isOver', 'score', 'winner']
    .every(function (name) { return typeof E[name] === 'function'; }));
});

/* ------------------------------------------------------------------ */
/* 2. 开局                                                             */
/* ------------------------------------------------------------------ */

s.group('开局与牌堆', function () {
  var state = E.createGame({ seed: 42 });
  s.eq('初始市场 5 张', state.market.length, 5);
  s.eq('市场前 3 张是骆驼', state.market.slice(0, 3), ['camel', 'camel', 'camel']);
  s.eq('市场其余 2 张是货物', marketGoods(state).length, 2);
  s.eq('牌堆 45 张', state.deck.length, 45);
  s.eq('双方各 3 只骆驼', state.players.map(function (p) { return p.camels; }), [3, 3]);
  s.eq('双方初始手牌为空', state.players.map(function (p) {
    return E.GOODS.reduce(function (sum, good) { return sum + p.hand[good]; }, 0);
  }), [0, 0]);
  s.eq('卡片总数 56', cardTotal(state), 56);
  s.eq('初始第 1 轮', state.round, 1);
  s.eq('初始比分 0:0', state.roundsWon, { human: 0, ai: 0 });
  s.eq('初始轮到人类', state.turn, 'human');
  s.eq('初始阶段 play', state.phase, 'play');
  s.eq('初始未结束', state.over, false);
  s.eq('初始 38 枚代币', E.GOODS.reduce(function (sum, good) {
    return sum + state.tokenPiles[good].length;
  }, 0), 38);
  s.eq('初始代币完整', state.tokenPiles.diamond, [7, 7, 5, 5, 5]);
  s.eq('初始奖励可用', state.bonusAvailable, { 3: true, 4: true, 5: true });

  var again = E.createGame({ seed: 42 });
  s.eq('同种子市场可复现', again.market, state.market);
  s.eq('同种子牌堆可复现', again.deck, state.deck);

  var aiFirst = E.createGame({ seed: 42, humanFirst: false });
  s.eq('humanFirst=false 时 AI 先手', aiFirst.turn, 'ai');
});

/* ------------------------------------------------------------------ */
/* 3. 取牌                                                             */
/* ------------------------------------------------------------------ */

s.group('取牌合法性', function () {
  var state = E.createGame({ seed: 7 });
  var moves = E.legalMoves(state);
  var goods = marketGoods(state);
  s.eq('每种市场货物只有一个取牌动作', moves.filter(function (m) {
    return m.type === 'take';
  }).length, goods.length);
  s.ok('市场货物都在合法动作中', goods.every(function (good) {
    return moveInList(moves, { type: 'take', card: good });
  }));
  s.ok('市场有骆驼时能收骆驼', moveInList(moves, { type: 'takeCamels' }), true);
  s.ok('骆驼不能单张取', !moveInList(moves, { type: 'take', card: 'camel' }));

  var absent = E.GOODS.filter(function (good) { return goods.indexOf(good) === -1; })[0];
  s.ok('至少有一种货物不在市场', !!absent);
  expectThrow('取不在市场的货物抛错', function () {
    E.applyMove(state, { type: 'take', card: absent });
  }, /非法动作/);
  expectThrow('单张取骆驼抛错', function () {
    E.applyMove(state, { type: 'take', card: 'camel' });
  }, /非法动作/);
  expectThrow('未知动作类型抛错', function () {
    E.applyMove(state, { type: 'steal' });
  }, /非法动作/);

  var good = firstMarketGood(state);
  var snapshot = JSON.stringify(state);
  var next = E.applyMove(state, { type: 'take', card: good });
  s.eq('取牌后手牌 +1', next.players[0].hand[good], state.players[0].hand[good] + 1);
  s.eq('取牌后市场仍为 5 张', next.market.length, 5);
  s.eq('取牌后牌堆 -1', next.deck.length, state.deck.length - 1);
  s.eq('取牌后换手', next.turn, 'ai');
  s.eq('取牌后卡片守恒', cardTotal(next), 56);
  s.eq('applyMove 不修改传入 state', JSON.stringify(state), snapshot);
});

s.group('收骆驼', function () {
  var state = E.createGame({ seed: 11 });
  var camels = state.market.filter(function (card) { return card === 'camel'; }).length;
  s.eq('市场初始 3 只骆驼', camels, 3);

  var next = E.applyMove(state, { type: 'takeCamels' });
  s.eq('收骆驼后骆驼数正确', next.players[0].camels, 3 + camels);
  s.eq('市场不再有骆驼', next.market.indexOf('camel'), -1);
  s.eq('收骆驼后市场补满 5 张', next.market.length, 5);
  s.eq('收骆驼按缺口补牌', next.deck.length, state.deck.length - camels);
  s.eq('收骆驼后卡片守恒', cardTotal(next), 56);
  s.eq('收骆驼后换手', next.turn, 'ai');

  var none = E.createGame({ seed: 12 });
  none.turn = 'human';
  none.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
  expectThrow('市场无骆驼时不能收', function () {
    E.applyMove(none, { type: 'takeCamels' });
  }, /非法动作/);
});

/* ------------------------------------------------------------------ */
/* 4. 卖牌                                                             */
/* ------------------------------------------------------------------ */

s.group('卖牌合法性', function () {
  var state = E.createGame({ seed: 15 });
  state.turn = 'human';
  state.players[0].hand = zeroHand();
  state.players[0].hand.diamond = 1;
  state.players[0].hand.silk = 2;

  var moves = E.legalMoves(state);
  s.ok('钻石 1 张不能卖', !moveInList(moves, { type: 'sell', good: 'diamond', count: 1 }));
  s.ok('钻石 1 张无任何卖牌动作', !moves.some(function (m) {
    return m.type === 'sell' && m.good === 'diamond';
  }));
  s.ok('丝绸 1 张可卖', moveInList(moves, { type: 'sell', good: 'silk', count: 1 }));
  s.ok('丝绸 2 张可卖', moveInList(moves, { type: 'sell', good: 'silk', count: 2 }));
  s.ok('丝绸卖 3 张不合法', !moveInList(moves, { type: 'sell', good: 'silk', count: 3 }));
  s.ok('骆驼不能卖', !moves.some(function (m) { return m.type === 'sell' && m.good === 'camel'; }));

  expectThrow('卖 0 张抛错', function () {
    E.applyMove(state, { type: 'sell', good: 'silk', count: 0 });
  }, /非法动作/);
  expectThrow('卖超过手牌抛错', function () {
    E.applyMove(state, { type: 'sell', good: 'silk', count: 3 });
  }, /非法动作/);
  expectThrow('卖骆驼抛错', function () {
    E.applyMove(state, { type: 'sell', good: 'camel', count: 1 });
  }, /非法动作/);

  var silk = E.applyMove(state, { type: 'sell', good: 'silk', count: 2 });
  s.eq('卖丝绸拿走最高代币 5+3', silk.players[0].scoreTokens, [5, 3]);
  s.eq('卖后手牌清零', silk.players[0].hand.silk, 0);
  s.eq('卖后代币牌堆减少 2', silk.tokenPiles.silk.length, 5);
  s.eq('卖后 soldTypes 记录数量', silk.players[0].soldTypes.silk, 2);
  s.eq('卖掉两张进入弃牌', silk.discard.filter(function (card) { return card === 'silk'; }).length, 2);
  s.eq('卖后换手', silk.turn, 'ai');
  s.eq('卖牌后卡片守恒', cardTotal(silk), cardTotal(state));

  state.players[0].hand.diamond = 2;
  var diamondMoves = E.legalMoves(state);
  s.ok('钻石 2 张可卖', moveInList(diamondMoves, { type: 'sell', good: 'diamond', count: 2 }));
  var sold = E.applyMove(state, { type: 'sell', good: 'diamond', count: 2 });
  s.eq('钻石 2 张拿走 7+7', sold.players[0].scoreTokens, [7, 7]);
  s.eq('本轮得分 14', E.score(sold).human, 14);

  var emptyPile = E.createGame({ seed: 16 });
  emptyPile.turn = 'human';
  emptyPile.players[0].hand.silk = 3;
  emptyPile.tokenPiles.silk = [];
  s.ok('代币卖光的货无卖牌动作', !E.legalMoves(emptyPile).some(function (m) {
    return m.type === 'sell' && m.good === 'silk';
  }));
  expectThrow('代币卖光后不能卖', function () {
    E.applyMove(emptyPile, { type: 'sell', good: 'silk', count: 1 });
  }, /非法动作/);
});

s.group('卖牌计分与奖励', function () {
  var state = E.createGame({ seed: 17 });
  state.turn = 'human';
  state.players[0].hand.leather = 6;

  var first = E.applyMove(state, { type: 'sell', good: 'leather', count: 3 });
  s.eq('卖 3 张皮革拿 4+3+2', first.players[0].scoreTokens, [4, 3, 2]);
  s.eq('卖 3 张触发 5 分奖励', first.players[0].bonusPoints, 5);
  s.eq('奖励 3 张档已使用', first.bonusAvailable['3'], false);
  s.eq('第一笔得分 14', E.score(first).human, 14);

  first.turn = 'human';
  var second = E.applyMove(first, { type: 'sell', good: 'leather', count: 3 });
  s.eq('第二次拿剩余 1+1+1', second.players[0].scoreTokens.slice(3), [1, 1, 1]);
  s.eq('同类奖励不能重复拿', second.players[0].bonusPoints, 5);
  s.eq('第二笔后总分 17', E.score(second).human, 17);

  var scarce = E.createGame({ seed: 18 });
  scarce.turn = 'human';
  scarce.players[0].hand.silk = 3;
  scarce.tokenPiles.silk = [5];
  var sold = E.applyMove(scarce, { type: 'sell', good: 'silk', count: 3 });
  s.eq('代币不足时只拿剩余代币', sold.players[0].scoreTokens, [5]);
  s.eq('代币不足仍可拿 3 张奖励', sold.players[0].bonusPoints, 5);
  s.eq('代币清空', sold.tokenPiles.silk, []);
  s.eq('三张货全部进入弃牌', sold.discard.length, 3);
});

/* ------------------------------------------------------------------ */
/* 5. 轮结束、骆驼分与终局                                             */
/* ------------------------------------------------------------------ */

s.group('轮结束与骆驼分', function () {
  var state = E.createGame({ seed: 5 });
  state.deck = [];
  state.turn = 'human';
  state.players[0].scoreTokens = [9, 5];
  state.players[0].camels = 4;
  state.players[1].scoreTokens = [3];
  state.players[1].camels = 2;
  var good = firstMarketGood(state);
  var snapshot = JSON.stringify(state);

  var next = E.applyMove(state, { type: 'take', card: good });
  s.eq('牌堆耗尽即结束本轮', next.roundHistory.length, 1);
  s.eq('结束后进入下一轮', next.round, 2);
  s.eq('结束原因 deckEmpty', next.lastRound.reason, 'deckEmpty');
  s.eq('骆驼多者 +5', next.lastRound.human, 19);
  s.eq('AI 得分保留', next.lastRound.ai, 3);
  s.eq('骆驼分归属人类', next.lastRound.camelBonus, 'human');
  s.eq('人类赢下第 1 轮', next.lastRound.winner, 'human');
  s.eq('整场比分 1:0', next.roundsWon, { human: 1, ai: 0 });
  s.eq('新轮先手交替给 AI', next.turn, 'ai');
  s.eq('新轮重新发牌', next.market.length, 5 + 0);
  s.eq('新轮手牌重置', next.players[0].hand[good], 0);
  s.eq('新轮骆驼重置 3 只', next.players.map(function (p) { return p.camels; }), [3, 3]);
  s.eq('新轮代币重置 38 枚', E.GOODS.reduce(function (sum, g) {
    return sum + next.tokenPiles[g].length;
  }, 0), 38);
  s.eq('原 state 未被修改', JSON.stringify(state), snapshot);

  var tie = E.createGame({ seed: 6 });
  tie.deck = [];
  tie.turn = 'human';
  var tieGood = firstMarketGood(tie);
  var tied = E.applyMove(tie, { type: 'take', card: tieGood });
  s.eq('骆驼相同不加分', tied.lastRound.camelBonus, null);
  s.eq('0:0 平局无人获胜', tied.lastRound.winner, null);
  s.eq('平局不增加轮胜', tied.roundsWon, { human: 0, ai: 0 });
  s.eq('平局后继续下一轮', tied.round, 2);

  var tokens = E.createGame({ seed: 7 });
  tokens.turn = 'human';
  tokens.tokenPiles.silk = [];
  tokens.tokenPiles.spice = [];
  tokens.tokenPiles.leather = [];
  var tokenGood = firstMarketGood(tokens);
  var gone = E.applyMove(tokens, { type: 'take', card: tokenGood });
  s.eq('三种代币卖光即结束', gone.roundHistory.length, 1);
  s.eq('结束原因 tokensGone', gone.lastRound.reason, 'tokensGone');
  s.eq('代币耗尽的下轮重新补满', gone.tokenPiles.silk.length, 7);
});

s.group('整场终局与计分', function () {
  var state = E.createGame({ seed: 8 });
  state.round = 2;
  state.roundsWon = { human: 1, ai: 0 };
  state.deck = [];
  state.turn = 'human';
  state.players[0].scoreTokens = [10];
  state.players[0].camels = 4;
  state.players[1].scoreTokens = [2];
  state.players[1].camels = 2;
  var good = firstMarketGood(state);

  s.eq('未结束 winner 为 null', E.winner(state), null);
  s.eq('未结束 isOver 为 false', E.isOver(state), false);

  var over = E.applyMove(state, { type: 'take', card: good });
  s.eq('先赢 2 轮即结束', over.over, true);
  s.eq('结束阶段为 over', over.phase, 'over');
  s.eq('最终比分 2:0', over.roundsWon, { human: 2, ai: 0 });
  s.eq('winner 返回 human', E.winner(over), 'human');
  s.eq('isOver 为 true', E.isOver(over), true);
  s.eq('终局保留本轮得分', E.score(over), { human: 15, ai: 2 });
  s.eq('终局无合法动作', E.legalMoves(over), []);
  s.eq('终局 AI 不再行动', E.aiMove(over), null);
  expectThrow('终局后不能再走', function () {
    E.applyMove(over, { type: 'take', card: good });
  }, /结束/);

  var sums = E.createGame({ seed: 9 });
  sums.players[0].scoreTokens = [7, 5];
  sums.players[0].bonusPoints = 4;
  sums.players[0].camelBonus = 0;
  sums.players[1].scoreTokens = [3];
  s.eq('score 汇总代币+奖励+骆驼分', E.score(sums), { human: 16, ai: 3 });
});

/* ------------------------------------------------------------------ */
/* 6. AI 策略与合法性                                                  */
/* ------------------------------------------------------------------ */

s.group('AI 合法动作与策略', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var state = E.createGame({ seed: seed });
    var move = E.aiMove(state);
    s.ok('seed ' + seed + ' AI 返回动作', !!move);
    var legal = E.legalMoves(state);
    s.ok('seed ' + seed + ' AI 动作在合法列表', moveInList(legal, move));
    var threw = '';
    try { E.applyMove(state, move); } catch (error) { threw = error.message; }
    s.ok('seed ' + seed + ' AI 动作可执行', !threw, threw);
  }

  var camels = E.createGame({ seed: 20 });
  camels.turn = 'ai';
  camels.players[1].camels = 0;
  s.eq('缺骆驼时 AI 收骆驼', E.aiMove(camels).type, 'takeCamels');

  var sell = E.createGame({ seed: 21 });
  sell.turn = 'ai';
  sell.players[1].hand = zeroHand();
  sell.players[1].hand.diamond = 2;
  var sellMove = E.aiMove(sell);
  s.eq('AI 优先卖高分钻石', sellMove, { type: 'sell', good: 'diamond', count: 2 });

  var goods = E.createGame({ seed: 22 });
  goods.turn = 'ai';
  goods.players[1].camels = 8;
  goods.market = ['silk', 'leather', 'leather', 'leather', 'leather'];
  goods.deck = ['diamond'];
  s.eq('AI 取估值更高的丝绸', E.aiMove(goods), { type: 'take', card: 'silk' });
});

/* ------------------------------------------------------------------ */
/* 7. 30 局 AI 自对弈                                                  */
/* ------------------------------------------------------------------ */

s.group('30 局 AI 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var unfinished = 0;
  var mutated = 0;
  var illegal = 0;
  var badWinner = 0;
  var maxSteps = 0;

  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame({ seed: seed });
    var steps = 0;
    try {
      while (!state.over && steps < 2000) {
        var move = E.aiMove(state);
        if (!move) throw new Error('无可用动作');
        var snapshot = JSON.stringify(state);
        var next = E.applyMove(state, move);
        if (JSON.stringify(state) !== snapshot) mutated++;
        if (!moveInList(E.legalMoves(state), move)) illegal++;
        state = next;
        steps++;
      }
    } catch (error) {
      errors++;
    }
    if (!state.over) unfinished++;
    if (state.over) {
      var finalWinner = E.winner(state);
      if (finalWinner !== 'human' && finalWinner !== 'ai') badWinner++;
      if (state.roundsWon[finalWinner] !== E.ROUNDS_TO_WIN) badWinner++;
    }
    maxSteps = Math.max(maxSteps, steps);
  }

  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部自然结束', unfinished, 0);
  s.eq('30 局动作始终合法', illegal, 0);
  s.eq('30 局原局面从未被修改', mutated, 0);
  s.eq('30 局胜者都赢满 2 轮', badWinner, 0);
  s.ok('30 局在 2000 步内结束', maxSteps < 2000, String(maxSteps));
  s.ok('30 局在 15 秒内跑完', Date.now() - started < 15000, (Date.now() - started) + 'ms');
});

s.group('30 局随机合法走子', function () {
  var errors = 0;
  var unfinished = 0;
  var emptyMoves = 0;
  var maxSteps = 0;

  for (var seed = 1; seed <= 30; seed++) {
    var rng = lib.mulberry32(seed * 7919);
    var state = E.createGame({ seed: seed });
    var steps = 0;
    try {
      while (!state.over && steps < 4000) {
        var moves = E.legalMoves(state);
        if (!moves.length) { emptyMoves++; break; }
        var move = moves[Math.floor(rng() * moves.length)];
        state = E.applyMove(state, move);
        steps++;
      }
    } catch (error) {
      errors++;
    }
    if (!state.over) unfinished++;
    maxSteps = Math.max(maxSteps, steps);
  }

  s.eq('随机 30 局无异常', errors, 0);
  s.eq('随机 30 局没有空动作局面', emptyMoves, 0);
  s.eq('随机 30 局全部自然结束', unfinished, 0);
  s.ok('随机 30 局步数有限', maxSteps < 4000, String(maxSteps));
});

/* ------------------------------------------------------------------ */
/* 8. 页面：同源、390px、ARIA 与规则页                                */
/* ------------------------------------------------------------------ */

s.group('游戏页面同源与移动端', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var external = lib.externalRefs(html.replace(/<script[^>]+src="engine\.js"[^>]*><\/script>/gi, ''));

  s.ok('页面有 viewport', /name="viewport"/.test(html));
  s.ok('页面引用同源 engine.js', /<script[^>]+src="engine\.js"/.test(html));
  s.ok('页面只有 engine.js 外部脚本', (html.match(/<script[^>]+src="([^"]+)"/g) || [])
    .every(function (tag) { return /src="engine\.js"/.test(tag); }));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无远程资源请求', !/<(?:script|img)[^>]+src="https?:/i.test(html) &&
    !/url\(\s*["']?https?:/i.test(html) && !/@import/i.test(html));
  s.eq('页面无 fetch/XHR/sendBeacon', external, []);
  s.ok('页面有 390/430px 媒体查询', /@media\s*\(max-width:\s*(?:430|390)px\)/.test(html));
  s.ok('页面阻止横向溢出', /overflow-x:\s*hidden/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有 aria-live', /aria-live=/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('触控目标至少 44px', /min-height:\s*44px/.test(html));
  s.ok('市场为 5 列网格', /grid-template-columns:\s*repeat\(5/.test(html));
  s.ok('AI 由 setTimeout 自动行动', /setTimeout/.test(html) && /JaipurEngine/.test(html));
  s.ok('页面链接规则页', /href="rules\.html"/.test(html));
  s.ok('页面无内联图片请求', !/<img\b/i.test(html));
});

s.group('规则页与 FAQ', function () {
  var html = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var blocks = lib.jsonLd(html);
  var faq = blocks.filter(function (block) { return block['@type'] === 'FAQPage'; })[0];
  var article = html.match(/<article>([\s\S]*?)<\/article>/);
  var text = article ? article[1].replace(/<[^>]+>/g, '') : '';
  var chars = cjkCount(text);

  s.ok('规则页有 viewport', /name="viewport"/.test(html));
  s.ok('规则页含 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 4 个问答', !!faq && faq.mainEntity.length >= 4, faq ? String(faq.mainEntity.length) : '0');
  if (faq) {
    s.ok('FAQ 每个问答字段完整', faq.mainEntity.every(function (item) {
      return item['@type'] === 'Question' && typeof item.name === 'string' &&
        item.name.length > 0 && item.acceptedAnswer &&
        item.acceptedAnswer['@type'] === 'Answer' &&
        typeof item.acceptedAnswer.text === 'string' && item.acceptedAnswer.text.length > 0;
    }));
  }
  s.ok('规则正文 400–800 汉字', chars >= 400 && chars <= 800, String(chars));
  s.ok('规则页 CTA 返回游戏', /<a[^>]+href="index\.html"[^>]*>/.test(html) && /开始对局/.test(html));
  s.ok('规则页独立响应式', /@media\s*\(max-width:\s*(?:480|430|390)px\)/.test(html) &&
    /name="viewport"/.test(html));
  s.ok('规则页有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('规则页无外部样式表/脚本请求', !/<link[^>]+rel="stylesheet"/i.test(html) &&
    !/<script[^>]+src="https?:/i.test(html));
  s.ok('规则页防止横向溢出', /overflow-x:\s*hidden/.test(html));
});

s.done();
