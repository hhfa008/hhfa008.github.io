'use strict';

/*
 * Splendor（璀璨宝石）引擎与页面测试。
 *
 * 页面和测试共用同源 engine.js；这里直接 require 引擎，不复制规则。
 * 运行：node games/boardgame/splendor/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('splendor');
var E = require('./engine.js');

function snapshot(value) {
  return JSON.stringify(value);
}

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function faceUpCards(state) {
  var cards = [];
  [1, 2, 3].forEach(function (tier) {
    (state.faceUp[tier] || []).forEach(function (card) { if (card) cards.push(card); });
  });
  return cards;
}

function allCardZones(state) {
  var cards = [];
  [1, 2, 3].forEach(function (tier) {
    cards = cards.concat(state.decks[tier] || []);
    cards = cards.concat((state.faceUp[tier] || []).filter(Boolean));
  });
  state.players.forEach(function (player) {
    cards = cards.concat(player.cards || []);
    cards = cards.concat(player.reserved || []);
  });
  return cards;
}

function hasMove(moves, move) {
  var wanted = snapshot(move);
  return moves.some(function (item) { return snapshot(item) === wanted; });
}

function setTokens(state, playerIndex, tokens) {
  var player = state.players[playerIndex];
  E.COLORS.forEach(function (color) { player.tokens[color] = tokens[color] || 0; });
  player.tokens.gold = tokens.gold || 0;
}

function makeCard(overrides) {
  var card = {
    id: 'TEST-1', tier: 1, name: '测试卡', color: 'white', prestige: 1,
    cost: { white: 1, blue: 0, green: 0, red: 0, black: 0 }, costTotal: 1
  };
  Object.keys(overrides || {}).forEach(function (key) { card[key] = overrides[key]; });
  return card;
}

/* ------------------------------------------------------------------ */
/* 1. 固定卡表、贵族与开局                                             */
/* ------------------------------------------------------------------ */

s.group('卡表与贵族数据', function () {
  s.eq('卡表共 60 张', E.CARD_CATALOG.length, 60);
  [1, 2, 3].forEach(function (tier) {
    var cards = E.CARD_CATALOG.filter(function (card) { return card.tier === tier; });
    s.eq('阶层 ' + tier + ' 有 20 张', cards.length, 20);
    s.eq('阶层 ' + tier + ' 五色各 4 张', E.COLORS.map(function (color) {
      return cards.filter(function (card) { return card.color === color; }).length;
    }), [4, 4, 4, 4, 4]);
    s.ok('阶层 ' + tier + ' 声望在合理范围', cards.every(function (card) {
      return [0, 1, 2, 3, 4, 5].indexOf(card.prestige) >= 0;
    }));
    s.ok('阶层 ' + tier + ' 成本均为非负整数', cards.every(function (card) {
      return E.COLORS.every(function (color) {
        return Number.isInteger(card.cost[color]) && card.cost[color] >= 0;
      });
    }));
  });
  s.eq('卡牌 ID 全局唯一', new Set(E.CARD_CATALOG.map(function (card) { return card.id; })).size, 60);
  s.ok('声望 0–5 均有卡牌覆盖', [0, 1, 2, 3, 4, 5].every(function (points) {
    return E.CARD_CATALOG.some(function (card) { return card.prestige === points; });
  }));
  var averages = [1, 2, 3].map(function (tier) {
    var cards = E.CARD_CATALOG.filter(function (card) { return card.tier === tier; });
    return cards.reduce(function (sum, card) { return sum + card.costTotal; }, 0) / cards.length;
  });
  s.ok('平均成本随阶层递增', averages[0] < averages[1] && averages[1] < averages[2],
    averages.join(' / '));
  s.eq('贵族固定 3 张', E.NOBLES.length, 3);
  s.ok('贵族均为 3 分', E.NOBLES.every(function (noble) { return noble.prestige === 3; }));
  s.ok('贵族要求覆盖 3–4 种颜色', E.NOBLES.every(function (noble) {
    var count = E.COLORS.filter(function (color) { return noble.requirements[color] > 0; }).length;
    return count >= 3 && count <= 4;
  }));
  s.ok('贵族要求均为正整数', E.NOBLES.every(function (noble) {
    return E.COLORS.every(function (color) {
      var value = noble.requirements[color] || 0;
      return Number.isInteger(value) && value >= 0;
    });
  }));
});

s.group('初始局面合法性', function () {
  var state = E.createGame({ seed: 42 });
  s.eq('两名玩家', state.players.length, 2);
  s.eq('当前玩家是 0', state.current, 0);
  s.eq('第 1 轮', state.round, 1);
  s.eq('对局未结束', state.over, false);
  s.eq('五色库存各 4', E.COLORS.map(function (color) { return state.gems[color]; }), [4, 4, 4, 4, 4]);
  s.eq('黄金库存 5', state.gems.gold, 5);
  s.ok('双方筹码从 0 开始', state.players.every(function (player) {
    return E.tokenTotal(player) === 0;
  }));
  s.ok('双方声望从 0 开始', state.players.every(function (player) { return player.prestige === 0; }));
  s.ok('双方没有卡牌与预留', state.players.every(function (player) {
    return player.cards.length === 0 && player.reserved.length === 0;
  }));
  s.eq('每层翻开 4 张', [1, 2, 3].map(function (tier) { return state.faceUp[tier].length; }), [4, 4, 4]);
  s.eq('每层牌堆 16 张', [1, 2, 3].map(function (tier) { return state.decks[tier].length; }), [16, 16, 16]);
  s.eq('全部卡牌可在牌堆与场上找到', allCardZones(state).length, 60);
  s.eq('开局卡牌无重复', new Set(allCardZones(state).map(function (card) { return card.id; })).size, 60);
  s.eq('贵族 3 张均未到访', state.nobles.filter(function (noble) { return noble.claimedBy === null; }).length, 3);
  s.ok('开局有合法动作', E.getLegalMoves(state).length > 0);
  s.ok('合法动作都属于当前玩家', E.getLegalMoves(state).every(function (move) { return move.player === 0; }));

  var same = E.createGame({ seed: 42 });
  s.eq('相同种子牌序一致', faceUpCards(state).map(function (card) { return card.id; }),
    faceUpCards(same).map(function (card) { return card.id; }));
  var other = E.createGame({ seed: 43 });
  s.ok('不同种子通常改变牌序', faceUpCards(state).map(function (card) { return card.id; }).join(',') !==
    faceUpCards(other).map(function (card) { return card.id; }).join(','));
  s.eq('数字种子写法兼容', E.createGame(42).seed, 42);
});

/* ------------------------------------------------------------------ */
/* 2. 拿取筹码                                                         */
/* ------------------------------------------------------------------ */

s.group('拿 3 种不同颜色', function () {
  var state = E.createGame({ seed: 7 });
  var before = snapshot(state);
  var move = { type: 'take3', colors: ['white', 'blue', 'green'] };
  var next = E.applyMove(state, move);
  s.eq('拿 3 色后各得 1 枚', ['white', 'blue', 'green'].map(function (color) {
    return next.players[0].tokens[color];
  }), [1, 1, 1]);
  s.eq('拿 3 色后库存各减 1', ['white', 'blue', 'green'].map(function (color) {
    return next.gems[color];
  }), [3, 3, 3]);
  s.eq('拿 3 色后总筹码 3', E.tokenTotal(next.players[0]), 3);
  s.eq('拿 3 色后换手', next.current, 1);
  s.eq('拿 3 色仍属第 1 轮', next.round, 1);
  s.eq('拿 3 色写入日志', next.log[next.log.length - 1].type, 'take3');
  s.eq('原局面未被修改', snapshot(state), before);

  expectThrow('重复颜色非法', function () {
    E.applyMove(state, { type: 'take3', colors: ['white', 'white', 'blue'] });
  }, /重复/);
  expectThrow('未知颜色非法', function () {
    E.applyMove(state, { type: 'take3', colors: ['white', 'blue', 'pink'] });
  }, /颜色/);
  expectThrow('不足三种颜色非法', function () {
    E.applyMove(state, { type: 'take3', colors: ['white', 'blue'] });
  }, /3 种/);

  var low = E.createGame({ seed: 8 });
  low.gems.red = 0;
  expectThrow('零库存颜色非法', function () {
    E.applyMove(low, { type: 'take3', colors: ['white', 'blue', 'red'] });
  }, /用尽/);

  var oneLeft = E.createGame({ seed: 9 });
  oneLeft.gems.white = 1;
  var tookLast = E.applyMove(oneLeft, { type: 'take3', colors: ['white', 'blue', 'green'] });
  s.eq('库存仅 1 枚时仍可拿 1 枚', tookLast.players[0].tokens.white, 1);
  s.eq('库存仅 1 枚时归零', tookLast.gems.white, 0);

  var full = E.createGame({ seed: 10 });
  setTokens(full, 0, { white: 4, blue: 4, green: 1 });
  var fullMoves = E.getLegalMoves(full);
  s.eq('9 枚时不再有拿 3 色动作', fullMoves.filter(function (move) { return move.type === 'take3'; }).length, 0);
  expectThrow('9 枚时拿 3 色超过上限', function () {
    E.applyMove(full, { type: 'take3', colors: ['white', 'blue', 'green'] });
  }, /10 枚/);
});

s.group('拿 2 枚同色与 10 枚上限', function () {
  var state = E.createGame({ seed: 11 });
  var before = snapshot(state);
  var next = E.applyMove(state, { type: 'take2', color: 'red' });
  s.eq('拿 2 色得 2 枚', next.players[0].tokens.red, 2);
  s.eq('拿 2 色库存减 2', next.gems.red, 2);
  s.eq('拿 2 色后总筹码 2', E.tokenTotal(next.players[0]), 2);
  s.eq('拿 2 色后换手', next.current, 1);
  s.eq('拿 2 色写入日志', next.log[next.log.length - 1].type, 'take2');
  s.eq('拿 2 色不修改原局面', snapshot(state), before);

  var three = E.createGame({ seed: 12 });
  three.gems.green = 3;
  expectThrow('库存只有 3 枚不能拿 2 同色', function () {
    E.applyMove(three, { type: 'take2', color: 'green' });
  }, /4 枚/);
  expectThrow('拿 2 色未知颜色非法', function () {
    E.applyMove(state, { type: 'take2', color: 'orange' });
  }, /颜色/);

  var eight = E.createGame({ seed: 13 });
  setTokens(eight, 0, { white: 4, blue: 4 });
  s.ok('8 枚时允许拿 2 枚同色', E.getLegalMoves(eight).some(function (move) {
    return move.type === 'take2' && move.color === 'white';
  }));
  var ten = E.applyMove(eight, { type: 'take2', color: 'white' });
  s.eq('拿取后正好 10 枚', E.tokenTotal(ten.players[0]), 10);
  s.eq('10 枚上限成立', E.tokenTotal(ten.players[0]) <= E.TOKEN_LIMIT, true);

  var nine = E.createGame({ seed: 14 });
  setTokens(nine, 0, { white: 4, blue: 4, green: 1 });
  expectThrow('9 枚时拿 2 同色超限', function () {
    E.applyMove(nine, { type: 'take2', color: 'white' });
  }, /10 枚/);
  s.eq('9 枚时没有拿 2 同色合法动作', E.getLegalMoves(nine).filter(function (move) {
    return move.type === 'take2';
  }).length, 0);
});

/* ------------------------------------------------------------------ */
/* 3. 预留与黄金                                                       */
/* ------------------------------------------------------------------ */

s.group('预留卡牌与黄金', function () {
  var state = E.createGame({ seed: 21 });
  var card = state.faceUp[1][0];
  var before = snapshot(state);
  var next = E.applyMove(state, { type: 'reserve', cardId: card.id });
  s.eq('预留后预留区 1 张', next.players[0].reserved.length, 1);
  s.eq('预留的卡牌正确', next.players[0].reserved[0].id, card.id);
  s.eq('预留后获得 1 黄金', next.players[0].tokens.gold, 1);
  s.eq('黄金库存减 1', next.gems.gold, 4);
  s.eq('预留后场上仍 4 张', next.faceUp[1].length, 4);
  s.eq('预留后场上不再有该卡', next.faceUp[1].some(function (item) {
    return item && item.id === card.id;
  }), false);
  s.eq('预留后牌堆补 1 张', next.decks[1].length, 15);
  s.eq('预留后换手', next.current, 1);
  s.eq('预留写入日志', next.log[next.log.length - 1].type, 'reserve');
  s.eq('预留不修改原局面', snapshot(state), before);

  var noGold = E.createGame({ seed: 22 });
  noGold.gems.gold = 0;
  var noGoldNext = E.applyMove(noGold, { type: 'reserve', cardId: noGold.faceUp[2][0].id });
  s.eq('黄金耗尽时预留仍可执行', noGoldNext.players[0].reserved.length, 1);
  s.eq('黄金耗尽时没有黄金入账', noGoldNext.players[0].tokens.gold, 0);
  s.ok('黄金耗尽日志可读', /黄金已用尽/.test(noGoldNext.log[noGoldNext.log.length - 1].text));

  var capped = E.createGame({ seed: 23 });
  setTokens(capped, 0, { white: 4, blue: 4, green: 2 });
  var cappedNext = E.applyMove(capped, { type: 'reserve', cardId: capped.faceUp[1][0].id });
  s.eq('已满 10 枚时预留不拿黄金', cappedNext.players[0].tokens.gold, 0);
  s.eq('已满 10 枚时仍保持上限', E.tokenTotal(cappedNext.players[0]), 10);
  s.eq('已满 10 枚时黄金留在库存', cappedNext.gems.gold, 5);

  var max = E.createGame({ seed: 24 });
  max.players[0].reserved = E.CARD_CATALOG.slice(0, 3).map(function (item) {
    return JSON.parse(JSON.stringify(item));
  });
  s.eq('预留 3 张后没有预留动作', E.getLegalMoves(max).filter(function (move) {
    return move.type === 'reserve';
  }).length, 0);
  expectThrow('预留第 4 张非法', function () {
    E.applyMove(max, { type: 'reserve', cardId: max.faceUp[1][0].id });
  }, /最多 3 张/);
  expectThrow('预留不存在的卡非法', function () {
    E.applyMove(state, { type: 'reserve', cardId: 'NOT-A-CARD' });
  }, /不在场上/);
});

/* ------------------------------------------------------------------ */
/* 4. 购买、扣费与永久加成                                             */
/* ------------------------------------------------------------------ */

s.group('购买场上卡牌', function () {
  var state = E.createGame({ seed: 31 });
  var card = state.faceUp[1][0];
  var payment = E.paymentFor(state, 0, card);
  setTokens(state, 0, payment.colored);
  state.players[0].tokens.gold = payment.gold;
  var before = snapshot(state);
  var bankBefore = JSON.parse(JSON.stringify(state.gems));
  var tokensBefore = E.tokenTotal(state.players[0]);
  var deckBefore = state.decks[1].length;
  var next = E.applyMove(state, { type: 'buy', cardId: card.id });

  s.eq('购买后卡牌进入玩家区', next.players[0].cards.length, 1);
  s.eq('购买后卡牌 ID 正确', next.players[0].cards[0].id, card.id);
  s.eq('购买后获得对应颜色永久加成', next.players[0].bonuses[card.color], 1);
  s.eq('购买后获得卡面声望', next.players[0].prestige, card.prestige);
  s.eq('购买后换手', next.current, 1);
  s.eq('购买后场上仍 4 张', next.faceUp[1].length, 4);
  s.eq('购买后场上不再有该卡', next.faceUp[1].some(function (item) {
    return item && item.id === card.id;
  }), false);
  s.eq('购买后从牌堆补牌', next.decks[1].length, deckBefore - 1);
  s.eq('购买后筹码减少支付数量', tokensBefore - E.tokenTotal(next.players[0]), payment.need);
  s.eq('已支付筹码回到宝石库存', E.COLORS.every(function (color) {
    var expected = bankBefore[color] + (payment.colored[color] || 0);
    return next.gems[color] === expected;
  }), true);
  s.eq('黄金支付回到黄金库存', next.gems.gold, bankBefore.gold + (payment.gold || 0));
  s.eq('购买写入日志', next.log[next.log.length - 1].type, 'buy');
  s.eq('购买不修改原局面', snapshot(state), before);
});

s.group('黄金支付与购买预留卡', function () {
  var state = E.createGame({ seed: 32 });
  var card = state.faceUp[1][0];
  var player = state.players[0];
  E.COLORS.forEach(function (color) { player.bonuses[color] = card.cost[color]; });
  var paidColor = E.COLORS.filter(function (color) { return card.cost[color] > 0; })[0];
  player.bonuses[paidColor] -= 1;
  player.tokens.gold = 1;
  var payment = E.paymentFor(state, 0, card);
  s.eq('黄金补足 1 点差额', payment.gold, 1);
  var bonusBefore = state.players[0].bonuses[card.color];
  var next = E.applyMove(state, { type: 'buy', cardId: card.id });
  s.eq('黄金支付后归零', next.players[0].tokens.gold, 0);
  s.eq('黄金回到库存', next.gems.gold, 6);
  s.eq('黄金购买也增加永久加成', next.players[0].bonuses[card.color], bonusBefore + 1);

  var reservedState = E.createGame({ seed: 33 });
  var reservedCard = reservedState.faceUp[2][0];
  var afterReserve = E.applyMove(reservedState, { type: 'reserve', cardId: reservedCard.id });
  afterReserve.current = 0;
  var reservePayment = E.paymentFor(afterReserve, 0, reservedCard);
  setTokens(afterReserve, 0, reservePayment.colored);
  afterReserve.players[0].tokens.gold = reservePayment.gold;
  s.ok('预留卡出现在合法购买列表', E.getLegalMoves(afterReserve).some(function (move) {
    return move.type === 'buy' && move.cardId === reservedCard.id;
  }));
  var bought = E.applyMove(afterReserve, { type: 'buy', cardId: reservedCard.id });
  s.eq('购买预留卡后预留区清空', bought.players[0].reserved.length, 0);
  s.eq('购买预留卡进入玩家卡区', bought.players[0].cards[0].id, reservedCard.id);
  s.eq('购买预留卡不受场上位置影响', bought.faceUp[2].some(function (item) {
    return item && item.id === reservedCard.id;
  }), false);
});

s.group('非法购买', function () {
  var poor = E.createGame({ seed: 34 });
  expectThrow('无筹码购买非法', function () {
    E.applyMove(poor, { type: 'buy', cardId: poor.faceUp[1][0].id });
  }, /筹码不足/);
  expectThrow('购买不存在卡牌非法', function () {
    E.applyMove(poor, { type: 'buy', cardId: 'MISSING' });
  }, /不在场上/);

  var opponentReserved = E.createGame({ seed: 35 });
  var hidden = opponentReserved.decks[1].shift();
  opponentReserved.players[1].reserved.push(hidden);
  setTokens(opponentReserved, 0, { white: 3, blue: 3, green: 3, red: 1 });
  expectThrow('不能购买对手预留卡', function () {
    E.applyMove(opponentReserved, { type: 'buy', cardId: hidden.id });
  }, /不在场上/);

  var ended = E.createGame({ seed: 36 });
  ended.over = true;
  expectThrow('终局后动作非法', function () {
    E.applyMove(ended, { type: 'take2', color: 'white' });
  }, /结束/);
});

/* ------------------------------------------------------------------ */
/* 5. 贵族自动到访                                                     */
/* ------------------------------------------------------------------ */

s.group('贵族自动到访', function () {
  var state = E.createGame({ seed: 41 });
  var card = makeCard({ id: 'TEST-NOBLE', name: '测试白卡' });
  state.faceUp[1][0] = card;
  var player = state.players[0];
  player.bonuses = { white: 2, blue: 3, green: 3, red: 0, black: 0 };
  player.tokens.white = 1;
  var next = E.applyMove(state, { type: 'buy', cardId: card.id });
  var noble = next.nobles.filter(function (item) { return item.id === 'N1'; })[0];
  s.eq('满足条件后贵族到访', noble.claimedBy, 0);
  s.eq('贵族额外提供 3 声望', next.players[0].prestige, card.prestige + 3);
  s.eq('贵族到访写入日志', next.log.some(function (entry) {
    return entry.type === 'noble' && /翡翠商会/.test(entry.text);
  }), true);
  s.eq('同一位贵族只到访一次', next.nobles.filter(function (item) { return item.claimedBy === 0; }).length, 1);
  s.eq('未满足条件的贵族仍未被认领', next.nobles.filter(function (item) {
    return item.claimedBy === null;
  }).length, 2);

  var notYet = E.createGame({ seed: 42 });
  var card2 = makeCard({ id: 'TEST-NOBLE-2' });
  notYet.faceUp[1][0] = card2;
  notYet.players[0].bonuses = { white: 1, blue: 3, green: 3, red: 0, black: 0 };
  notYet.players[0].tokens.white = 1;
  var next2 = E.applyMove(notYet, { type: 'buy', cardId: card2.id });
  s.eq('条件不足时贵族不到访', next2.nobles.every(function (item) {
    return item.claimedBy === null;
  }), true);
  s.eq('未到访时只获得卡面声望', next2.players[0].prestige, card2.prestige);
});

/* ------------------------------------------------------------------ */
/* 6. 15 分终局与平局判定                                              */
/* ------------------------------------------------------------------ */

s.group('15 声望终局', function () {
  var state = E.createGame({ seed: 51 });
  var card = makeCard({ id: 'TEST-WIN', prestige: 1 });
  state.faceUp[1][0] = card;
  state.players[0].prestige = 14;
  state.players[0].tokens.white = 1;
  var afterBuy = E.applyMove(state, { type: 'buy', cardId: card.id });
  s.eq('先手达到 15 声望', afterBuy.players[0].prestige, 15);
  s.eq('先手触发最终轮但尚未结束', afterBuy.over, false);
  s.eq('最终轮轮到后手', afterBuy.current, 1);
  s.eq('终局触发标记成立', afterBuy.endgameTriggered, true);
  s.ok('触发日志可读', afterBuy.log.some(function (entry) {
    return entry.type === 'endgame' || /15 声望/.test(entry.text);
  }));

  var lastMove = E.getLegalMoves(afterBuy)[0];
  var ended = E.applyMove(afterBuy, lastMove);
  s.eq('后手行动后对局结束', ended.over, true);
  s.ok('结束原因包含 15 声望', /15 声望/.test(ended.overReason));
  s.eq('先手分数更高时获胜', ended.result.winner, 0);
  s.eq('结果包含两名玩家', ended.result.scores.length, 2);
  s.eq('isGameOver 返回 true', E.isGameOver(ended), true);
  s.eq('终局后无合法动作', E.getLegalMoves(ended).length, 0);

  var second = E.createGame({ seed: 52 });
  var winCard = makeCard({ id: 'TEST-WIN-2', prestige: 2 });
  second.faceUp[1][0] = winCard;
  second.current = 1;
  second.players[1].prestige = 14;
  second.players[1].tokens.white = 1;
  var endedNow = E.applyMove(second, { type: 'buy', cardId: winCard.id });
  s.eq('后手达到 15 立即结束', endedNow.over, true);
  s.eq('后手在本轮已完成行动', endedNow.result.winner, 1);

  var tie = E.createGame({ seed: 53 });
  tie.over = true;
  tie.overReason = '测试结算';
  tie.players[0].prestige = 15;
  tie.players[1].prestige = 15;
  tie.players[0].cards = [{}, {}, {}];
  tie.players[1].cards = [{}, {}];
  var tieResult = E.getResults(tie);
  s.eq('同分时购买卡多者获胜', tieResult.winner, 0);
  tie.players[1].cards = [{}, {}, {}];
  s.eq('仍相同则平局', E.getResults(tie).winner, null);
});

/* ------------------------------------------------------------------ */
/* 7. AI 合法性                                                        */
/* ------------------------------------------------------------------ */

s.group('AI 动作合法性', function () {
  var legalFor20 = 0;
  var deterministic = 0;
  var inputUnchanged = 0;
  var tokenCap = 0;

  for (var seed = 1; seed <= 20; seed++) {
    var state = E.createGame({ seed: seed });
    var legal = E.getLegalMoves(state);
    var before = snapshot(state);
    var move = E.chooseAIMove(state);
    if (hasMove(legal, move)) legalFor20++;
    if (snapshot(E.chooseAIMove(state)) === snapshot(move)) deterministic++;
    if (snapshot(state) === before) inputUnchanged++;
    var next;
    var error = '';
    try { next = E.applyMove(state, move); } catch (caught) { error = caught.message; }
    s.ok('seed ' + seed + ' AI 动作可执行', !error, error);
    if (!error && next.players.every(function (player) {
      return E.tokenTotal(player) <= E.TOKEN_LIMIT;
    })) tokenCap++;
  }

  s.eq('20 个 seed 的 AI 动作都在合法列表中', legalFor20, 20);
  s.eq('AI 对同一局面决策确定', deterministic, 20);
  s.eq('AI 决策不修改输入局面', inputUnchanged, 20);
  s.eq('AI 行动后双方筹码不超过 10', tokenCap, 20);
  s.ok('AI 只返回四种动作类型', ['take3', 'take2', 'reserve', 'buy'].indexOf(
    E.chooseAIMove(E.createGame({ seed: 99 })).type) >= 0);

  var ended = E.createGame({ seed: 100 });
  ended.over = true;
  expectThrow('终局后 AI 不再决策', function () { E.chooseAIMove(ended); }, /结束/);
});

/* ------------------------------------------------------------------ */
/* 8. 30 局固定 seed 自对弈                                            */
/* ------------------------------------------------------------------ */

s.group('30 局固定 seed 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var unfinished = 0;
  var illegalMoves = 0;
  var notNatural = 0;
  var badTokens = 0;
  var badBank = 0;
  var badCards = 0;
  var badPrestige = 0;
  var maxSteps = 0;

  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame({ seed: seed });
    var steps = 0;
    try {
      while (!state.over && steps < 600) {
        var legal = E.getLegalMoves(state);
        var move = E.chooseAIMove(state);
        if (!hasMove(legal, move)) illegalMoves++;
        state = E.applyMove(state, move);
        steps++;

        var tokenSum = state.gems.gold;
        E.COLORS.forEach(function (color) {
          tokenSum += state.gems[color];
          if (state.gems[color] < 0) badBank++;
        });
        if (state.gems.gold < 0) badBank++;
        state.players.forEach(function (player) {
          tokenSum += E.tokenTotal(player);
          if (E.tokenTotal(player) > E.TOKEN_LIMIT) badTokens++;
          E.COLORS.forEach(function (color) {
            if (player.tokens[color] < 0) badTokens++;
          });
          if (player.tokens.gold < 0) badTokens++;
          if (player.prestige < 0 || !Number.isInteger(player.prestige)) badPrestige++;
        });
        if (tokenSum !== 25) badTokens++;

        var zones = allCardZones(state);
        if (zones.length !== 60) badCards++;
        if (new Set(zones.map(function (card) { return card.id; })).size !== 60) badCards++;
      }
    } catch (error) {
      errors++;
    }
    if (!state.over) unfinished++;
    if (state.over && !/15 声望/.test(state.overReason || '')) notNatural++;
    maxSteps = Math.max(maxSteps, steps);
  }

  s.eq('30 局全部无异常', errors, 0);
  s.eq('30 局全部自然结束', unfinished, 0);
  s.eq('30 局均以 15 声望收尾', notNatural, 0);
  s.eq('自对弈中的 AI 动作始终合法', illegalMoves, 0);
  s.eq('自对弈中筹码总数守恒且不超上限', badTokens, 0);
  s.eq('自对弈中筹码库存不为负', badBank, 0);
  s.eq('自对弈中 60 张卡始终完整且唯一', badCards, 0);
  s.eq('自对弈中声望始终为非负整数', badPrestige, 0);
  s.ok('每局在 600 步内结束', maxSteps < 600, String(maxSteps));
  s.ok('30 局在 15 秒内完成', Date.now() - started < 15000, (Date.now() - started) + 'ms');
});

/* ------------------------------------------------------------------ */
/* 9. 页面与同源静态检查                                               */
/* ------------------------------------------------------------------ */

s.group('游戏页面静态检查', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var engineSource = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  s.ok('页面存在 viewport', /name="viewport"/.test(html));
  s.ok('页面引用同源 engine.js', /<script[^>]+src="engine\.js"><\/script>/.test(html));
  s.ok('页面只有 engine.js 一个外部脚本', (html.match(/<script[^>]+src=/g) || []).length === 1);
  s.ok('页面无外部 http 脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch / XHR / sendBeacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));
  s.ok('页面无 CSS @import 或远程 url()', !/@import|url\(\s*["']?https?:/i.test(html));
  s.ok('页面有 430px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有横向溢出保护', /overflow-x:\s*hidden/.test(html));
  s.ok('页面触控目标至少 44px', /min-height:\s*44px/.test(html));
  s.ok('页面有重开按钮', /id="restartBtn"/.test(html) && /重开/.test(html));
  s.ok('页面有种子输入', /id="seedInput"/.test(html) && /type="number"/.test(html));
  s.ok('页面用 setTimeout 推进 AI', /setTimeout\s*\(/.test(html));
  s.ok('页面链接完整规则', /href="rules\.html"/.test(html));
  s.ok('页面链接桌游目录', /href="\.\.\/index\.html"/.test(html));
  s.ok('页面无 Math.random', !/Math\.random\s*\(/.test(html));
  s.ok('引擎 UMD 暴露 SplendorEngine', /root\.SplendorEngine\s*=/.test(engineSource));
  s.ok('引擎无 DOM 依赖', !/\bdocument\.|\bwindow\./.test(engineSource));
  s.ok('引擎无 Math.random', !/Math\.random\s*\(/.test(engineSource));
  s.ok('引擎有 mulberry32', /function mulberry32/.test(engineSource));
});

s.group('规则页与 FAQ 静态检查', function () {
  var html = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '');
  var cjk = (visible.match(/[\u4e00-\u9fff]/g) || []).length;
  s.ok('规则页中文正文 400–800 字', cjk >= 400 && cjk <= 800, String(cjk));
  s.ok('规则页链接回游戏', /href="index\.html"/.test(html));
  s.ok('规则页链接桌游目录', /href="\.\.\/index\.html"/.test(html));
  s.ok('规则页无外部脚本', !/<script[^>]+src=/i.test(html));
  s.ok('规则页无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));

  var blocks = lib.jsonLd(html);
  var faq = blocks.filter(function (block) { return block['@type'] === 'FAQPage'; })[0];
  s.ok('规则页有 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 3 问', !!faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3,
    faq && faq.mainEntity ? String(faq.mainEntity.length) : 'missing');
  s.ok('FAQ 每问都有答案', !!faq && faq.mainEntity.every(function (question) {
    return question['@type'] === 'Question' && question.name &&
      question.acceptedAnswer && question.acceptedAnswer.text;
  }));
});

s.done();
