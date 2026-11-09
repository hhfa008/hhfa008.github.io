/*
 * Jaipur（斋普尔）纯规则引擎 — UMD
 *
 * 浏览器：先加载本文件，使用 globalThis.JaipurEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；state 是纯 JSON 数据，可安全存档/克隆。
 *   - applyMove 不修改传入的 state，始终返回新的局面。
 *   - 所有随机性来自 createGame 的 seed（mulberry32），测试可复现。
 *   - AI 只从 legalMoves 返回的动作中选择；任何动作都经过同一套合法性检查。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JaipurEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 常量                                                               */
  /* ------------------------------------------------------------------ */

  var GOODS = ['diamond', 'gold', 'silver', 'silk', 'spice', 'leather'];

  var GOOD_NAMES = {
    diamond: '钻石',
    gold: '黄金',
    silver: '白银',
    silk: '丝绸',
    spice: '香料',
    leather: '皮革'
  };

  // 每种货物的总张数：6+6+6+8+8+10 = 44 张。
  var CARD_COUNTS = {
    diamond: 6,
    gold: 6,
    silver: 6,
    silk: 8,
    spice: 8,
    leather: 10
  };

  // 每种货物的得分代币（从高到低取，取完后该货不能再卖）。
  var TOKEN_VALUES = {
    diamond: [7, 7, 5, 5, 5],
    gold: [6, 6, 5, 5, 5],
    silver: [5, 5, 5, 5, 5],
    silk: [5, 3, 3, 2, 2, 1, 1],
    spice: [5, 3, 3, 2, 2, 1, 1],
    leather: [4, 3, 2, 1, 1, 1, 1, 1, 1]
  };

  // 最少卖出张数。
  var MIN_SELL = {
    diamond: 2,
    gold: 2,
    silver: 2,
    silk: 1,
    spice: 1,
    leather: 1
  };

  // 一次性奖励代币：卖 3 张得 5 分，4 张得 4 分，5 张及以上得 3 分。
  var BONUS_VALUES = { 3: 5, 4: 4, 5: 3 };

  var MARKET_SIZE = 5;
  var CAMELS_PER_PLAYER = 3;
  var CAMELS_IN_MARKET = 3;
  var CAMELS_EXTRA = 3; // 除双方 6 只和市场 3 只之外，牌堆里还有 3 只。
  var CAMEL_BONUS = 5;
  var ROUNDS_TO_WIN = 2;

  // AI 对货物的基础估值（钻石最高，皮革最低）。
  var CARD_VALUES = {
    diamond: 6,
    gold: 5,
    silver: 4,
    silk: 3,
    spice: 2,
    leather: 1
  };

  var PLAYER_NAMES = { human: '你', ai: 'AI' };

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function zeroHand() {
    var hand = {};
    GOODS.forEach(function (good) { hand[good] = 0; });
    return hand;
  }

  function sum(list) {
    return list.reduce(function (total, n) { return total + n; }, 0);
  }

  function isGood(card) {
    return GOODS.indexOf(card) !== -1;
  }

  // mulberry32 的单步版本：返回数值和下一个种子，避免把函数放进 state。
  function rngNext(seed) {
    var a = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return {
      value: ((t ^ (t >>> 14)) >>> 0) / 4294967296,
      seed: a >>> 0
    };
  }

  function shuffleWithSeed(list, seed) {
    var arr = list.slice();
    var current = seed >>> 0;
    for (var i = arr.length - 1; i > 0; i--) {
      var step = rngNext(current);
      current = step.seed;
      var j = Math.floor(step.value * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return { list: arr, seed: current };
  }

  function makePlayer(id, name) {
    return {
      id: id,
      name: name,
      hand: zeroHand(),
      camels: 0,
      scoreTokens: [],
      bonusPoints: 0,
      camelBonus: 0,
      soldTypes: zeroHand()
    };
  }

  function playerOf(state) {
    return state.players[state.turn === 'ai' ? 1 : 0];
  }

  function nameOf(state, id) {
    return PLAYER_NAMES[id] || id;
  }

  function pushLog(state, entry) {
    state.log.push(entry);
  }

  function roundScore(player) {
    return sum(player.scoreTokens) + player.bonusPoints + player.camelBonus;
  }

  /* ------------------------------------------------------------------ */
  /* 开局与每轮重置                                                     */
  /* ------------------------------------------------------------------ */

  function setupRound(state, first) {
    state.market = [];
    state.discard = [];
    state.players.forEach(function (player) {
      player.hand = zeroHand();
      player.camels = CAMELS_PER_PLAYER;
      player.scoreTokens = [];
      player.bonusPoints = 0;
      player.camelBonus = 0;
      player.soldTypes = zeroHand();
    });
    state.tokenPiles = clone(TOKEN_VALUES);
    state.bonusAvailable = { 3: true, 4: true, 5: true };

    var goods = [];
    GOODS.forEach(function (good) {
      for (var i = 0; i < CARD_COUNTS[good]; i++) goods.push(good);
    });

    // 先洗 44 张货物，抽出 2 张放进市场；剩下的货物与 3 只骆驼再洗成牌堆。
    // 这样市场开局严格是「3 只骆驼 + 2 张货物」，牌堆为 45 张。
    var goodsShuffle = shuffleWithSeed(goods, state.rngSeed);
    state.rngSeed = goodsShuffle.seed;
    var goodsPool = goodsShuffle.list;

    for (var m = 0; m < CAMELS_IN_MARKET; m++) state.market.push('camel');
    for (var n = 0; n < 2 && goodsPool.length; n++) state.market.push(goodsPool.pop());

    var deckCards = goodsPool;
    for (var c = 0; c < CAMELS_EXTRA; c++) deckCards.push('camel');
    var deckShuffle = shuffleWithSeed(deckCards, state.rngSeed);
    state.deck = deckShuffle.list;
    state.rngSeed = deckShuffle.seed;

    state.turn = first;
    state.phase = 'play';

    pushLog(state, {
      type: 'roundStart',
      round: state.round,
      first: first,
      text: '第 ' + state.round + ' 轮开始，' + nameOf(state, first) + '先手。'
    });
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = (opts.seed == null ? Date.now() : opts.seed) >>> 0;
    var humanFirst = opts.humanFirst !== false;

    var state = {
      seed: seed,
      rngSeed: seed,
      market: [],
      deck: [],
      discard: [],
      players: [makePlayer('human', PLAYER_NAMES.human), makePlayer('ai', PLAYER_NAMES.ai)],
      tokenPiles: clone(TOKEN_VALUES),
      bonusAvailable: { 3: true, 4: true, 5: true },
      round: 1,
      dealership: humanFirst ? 'human' : 'ai',
      roundsWon: { human: 0, ai: 0 },
      turn: humanFirst ? 'human' : 'ai',
      phase: 'play',
      log: [],
      roundHistory: [],
      lastRound: null,
      over: false
    };

    setupRound(state, state.dealership);
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 合法动作                                                           */
  /* ------------------------------------------------------------------ */

  function legalMoves(state) {
    if (!state || state.over || state.phase !== 'play') return [];
    var player = playerOf(state);
    var moves = [];

    // 卖牌：优先进入列表，AI 同分时更倾向卖牌。
    GOODS.forEach(function (good) {
      var pile = state.tokenPiles[good] || [];
      var minimum = MIN_SELL[good];
      if (!pile.length) return;
      if (player.hand[good] < minimum) return;
      for (var count = minimum; count <= player.hand[good]; count++) {
        moves.push({ type: 'sell', good: good, count: count });
      }
    });

    // 收走市场全部骆驼（至少 1 只）。
    if (state.market.indexOf('camel') !== -1) {
      moves.push({ type: 'takeCamels' });
    }

    // 取 1 张货物；骆驼不能单张拿。
    GOODS.forEach(function (good) {
      if (state.market.indexOf(good) !== -1) moves.push({ type: 'take', card: good });
    });

    return moves;
  }

  function sameMove(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'take') return a.card === b.card;
    if (a.type === 'takeCamels') return true;
    if (a.type === 'sell') return a.good === b.good && a.count === b.count;
    return false;
  }

  function findLegal(state, move) {
    var moves = legalMoves(state);
    for (var i = 0; i < moves.length; i++) {
      if (sameMove(moves[i], move)) return moves[i];
    }
    return null;
  }

  function refillMarket(state) {
    while (state.market.length < MARKET_SIZE && state.deck.length) {
      state.market.push(state.deck.pop());
    }
  }

  function advanceTurn(state) {
    state.turn = state.turn === 'human' ? 'ai' : 'human';
  }

  /* ------------------------------------------------------------------ */
  /* 动作执行（内部，操作已克隆的 state）                                */
  /* ------------------------------------------------------------------ */

  function applyTake(state, move) {
    var player = playerOf(state);
    var index = state.market.indexOf(move.card);
    if (index === -1) throw new Error('市场上没有这张牌：' + move.card);

    state.market.splice(index, 1);
    player.hand[move.card] += 1;

    pushLog(state, {
      type: 'take',
      player: player.id,
      card: move.card,
      text: nameOf(state, player.id) + ' 取走了「' + GOOD_NAMES[move.card] + '」。'
    });

    refillMarket(state);
    advanceTurn(state);
  }

  function applyTakeCamels(state) {
    var player = playerOf(state);
    var camels = state.market.filter(function (card) { return card === 'camel'; }).length;
    if (!camels) throw new Error('市场上没有骆驼可收');

    player.camels += camels;
    state.market = state.market.filter(function (card) { return card !== 'camel'; });

    pushLog(state, {
      type: 'takeCamels',
      player: player.id,
      count: camels,
      text: nameOf(state, player.id) + ' 收走了 ' + camels + ' 只骆驼。'
    });

    refillMarket(state);
    advanceTurn(state);
  }

  function applySell(state, move) {
    var player = playerOf(state);
    var good = move.good;
    var count = move.count;
    var minimum = MIN_SELL[good];
    var pile = state.tokenPiles[good];

    if (!isGood(good)) throw new Error('未知货物：' + good);
    if (!pile || !pile.length) throw new Error(GOOD_NAMES[good] + ' 的代币已卖光');
    if (!(count >= minimum)) throw new Error(GOOD_NAMES[good] + ' 至少卖出 ' + minimum + ' 张');
    if (player.hand[good] < count) throw new Error('手里没有足够的' + GOOD_NAMES[good]);

    player.hand[good] -= count;
    player.soldTypes[good] += count;
    for (var i = 0; i < count; i++) state.discard.push(good);

    // 代币从高到低取；牌堆代币不足时，多出的牌不再计分。
    var takeCount = Math.min(count, pile.length);
    var tokens = pile.splice(0, takeCount);
    tokens.forEach(function (value) { player.scoreTokens.push(value); });

    var tier = count >= 5 ? 5 : count;
    var bonus = 0;
    if (count >= 3 && state.bonusAvailable[String(tier)]) {
      state.bonusAvailable[String(tier)] = false;
      bonus = BONUS_VALUES[tier];
      player.bonusPoints += bonus;
    }

    pushLog(state, {
      type: 'sell',
      player: player.id,
      good: good,
      count: count,
      tokens: tokens,
      bonus: bonus,
      text: nameOf(state, player.id) + ' 卖出 ' + count + ' 张「' + GOOD_NAMES[good] + '」，' +
        '得 ' + sum(tokens) + ' 分' + (bonus ? '，外加奖励 ' + bonus + ' 分' : '') + '。'
    });

    advanceTurn(state);
  }

  /* ------------------------------------------------------------------ */
  /* 轮结束与整场结束                                                   */
  /* ------------------------------------------------------------------ */

  function exhaustedGoods(state) {
    return GOODS.filter(function (good) {
      return !state.tokenPiles[good] || state.tokenPiles[good].length === 0;
    });
  }

  function checkRoundEnd(state) {
    var exhausted = exhaustedGoods(state).length;
    if (state.deck.length > 0 && exhausted < 3) return false;
    endRound(state);
    return true;
  }

  function endRound(state) {
    var human = state.players[0];
    var ai = state.players[1];

    var camelBonusTo = null;
    if (human.camels > ai.camels) {
      human.camelBonus = CAMEL_BONUS;
      camelBonusTo = 'human';
    } else if (ai.camels > human.camels) {
      ai.camelBonus = CAMEL_BONUS;
      camelBonusTo = 'ai';
    }

    var humanScore = roundScore(human);
    var aiScore = roundScore(ai);
    var roundWinner = humanScore > aiScore ? 'human' : (aiScore > humanScore ? 'ai' : null);
    if (roundWinner) state.roundsWon[roundWinner] += 1;

    var entry = {
      round: state.round,
      human: humanScore,
      ai: aiScore,
      camelBonus: camelBonusTo,
      winner: roundWinner,
      roundsWon: clone(state.roundsWon),
      reason: state.deck.length === 0 ? 'deckEmpty' : 'tokensGone'
    };
    state.roundHistory.push(entry);
    state.lastRound = entry;

    var camelText = camelBonusTo
      ? '骆驼多的一方（' + nameOf(state, camelBonusTo) + '）加 ' + CAMEL_BONUS + ' 分。'
      : '双方骆驼相同，不加骆驼分。';
    var winnerText = roundWinner
      ? '第 ' + state.round + ' 轮结束：' + nameOf(state, roundWinner) + ' ' + Math.max(humanScore, aiScore) +
        ' : ' + Math.min(humanScore, aiScore) + ' 获胜。'
      : '第 ' + state.round + ' 轮结束：' + humanScore + ' : ' + aiScore + '，平局，本轮无人得分。';

    pushLog(state, {
      type: 'roundEnd',
      round: state.round,
      human: humanScore,
      ai: aiScore,
      camelBonus: camelBonusTo,
      winner: roundWinner,
      reason: entry.reason,
      text: winnerText + camelText
    });

    if (state.roundsWon.human >= ROUNDS_TO_WIN || state.roundsWon.ai >= ROUNDS_TO_WIN) {
      state.over = true;
      state.phase = 'over';
      var matchWinner = state.roundsWon.human > state.roundsWon.ai ? 'human' : 'ai';
      pushLog(state, {
        type: 'matchEnd',
        winner: matchWinner,
        text: '比赛结束：' + nameOf(state, matchWinner) + '以 ' +
          state.roundsWon.human + ' : ' + state.roundsWon.ai + ' 赢得整场比赛。'
      });
      return;
    }

    state.round += 1;
    var nextFirst = state.round % 2 === 1
      ? state.dealership
      : (state.dealership === 'human' ? 'ai' : 'human');
    setupRound(state, nextFirst);
  }

  /* ------------------------------------------------------------------ */
  /* 对外动作入口                                                       */
  /* ------------------------------------------------------------------ */

  function applyMove(state, move) {
    if (!state) throw new Error('缺少 state');
    if (state.over) throw new Error('比赛已经结束');
    var legal = findLegal(state, move);
    if (!legal) throw new Error('非法动作：' + JSON.stringify(move));

    var next = clone(state);
    if (legal.type === 'take') applyTake(next, legal);
    else if (legal.type === 'takeCamels') applyTakeCamels(next);
    else if (legal.type === 'sell') applySell(next, legal);

    checkRoundEnd(next);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                 */
  /* ------------------------------------------------------------------ */

  function evaluateMove(state, move, player) {
    if (move.type === 'sell') {
      var pile = state.tokenPiles[move.good];
      var taken = Math.min(move.count, pile.length);
      var tokenSum = sum(pile.slice(0, taken));
      var tier = move.count >= 5 ? 5 : move.count;
      var bonus = (move.count >= 3 && state.bonusAvailable[String(tier)])
        ? BONUS_VALUES[tier]
        : 0;
      var premium = move.good === 'diamond' ? 2.5
        : move.good === 'gold' ? 2
          : move.good === 'silver' ? 1.5
            : 0;
      var scarce = pile.length <= 2 ? 1 : 0;
      return tokenSum + bonus + premium + scarce;
    }

    if (move.type === 'takeCamels') {
      var base;
      if (player.camels < 3) base = 10;
      else if (player.camels < 5) base = 7;
      else if (player.camels < 7) base = 4;
      else base = 1;
      var onMarket = state.market.filter(function (card) { return card === 'camel'; }).length;
      return base + onMarket * 0.2;
    }

    // 取 1 张货物：基础估值 + 剩余代币均值 + “凑够最低卖出张数”的加成。
    var goodPile = state.tokenPiles[move.card] || [];
    if (!goodPile.length) return 0.2;
    var average = sum(goodPile) / goodPile.length;
    var value = CARD_VALUES[move.card] * 0.9 + average * 0.55;
    var need = MIN_SELL[move.card] - player.hand[move.card];
    if (need > 0 && need <= 1) value += 2.2;
    if (player.hand[move.card] === 0 && MIN_SELL[move.card] <= 2) value += 0.5;
    return value;
  }

  function aiMove(state) {
    var moves = legalMoves(state);
    if (!moves.length) return null;
    var player = playerOf(state);
    var best = null;
    var bestValue = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var value = evaluateMove(state, moves[i], player);
      if (value > bestValue) {
        bestValue = value;
        best = moves[i];
      }
    }
    return best ? clone(best) : null;
  }

  /* ------------------------------------------------------------------ */
  /* 查询/汇总                                                          */
  /* ------------------------------------------------------------------ */

  function isOver(state) {
    return !!(state && state.over);
  }

  function score(state) {
    return {
      human: roundScore(state.players[0]),
      ai: roundScore(state.players[1])
    };
  }

  function winner(state) {
    if (!state || !state.over) return null;
    if (state.roundsWon.human > state.roundsWon.ai) return 'human';
    if (state.roundsWon.ai > state.roundsWon.human) return 'ai';
    if (state.lastRound && state.lastRound.winner) return state.lastRound.winner;
    return null;
  }

  function summary(state) {
    return {
      round: state.round,
      turn: state.turn,
      phase: state.phase,
      over: state.over,
      winner: winner(state),
      market: state.market.slice(),
      deckCount: state.deck.length,
      scores: score(state),
      roundsWon: clone(state.roundsWon),
      tokenCounts: GOODS.reduce(function (acc, good) {
        acc[good] = state.tokenPiles[good].length;
        return acc;
      }, {}),
      legal: legalMoves(state)
    };
  }

  return Object.freeze({
    GOODS: GOODS,
    GOOD_NAMES: GOOD_NAMES,
    CARD_COUNTS: CARD_COUNTS,
    TOKEN_VALUES: TOKEN_VALUES,
    MIN_SELL: MIN_SELL,
    BONUS_VALUES: BONUS_VALUES,
    CARD_VALUES: CARD_VALUES,
    MARKET_SIZE: MARKET_SIZE,
    CAMELS_PER_PLAYER: CAMELS_PER_PLAYER,
    CAMELS_IN_MARKET: CAMELS_IN_MARKET,
    CAMELS_EXTRA: CAMELS_EXTRA,
    CAMEL_BONUS: CAMEL_BONUS,
    ROUNDS_TO_WIN: ROUNDS_TO_WIN,
    createGame: createGame,
    legalMoves: legalMoves,
    applyMove: applyMove,
    aiMove: aiMove,
    isOver: isOver,
    score: score,
    winner: winner,
    summary: summary
  });
});
