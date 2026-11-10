/*
 * Jaipur（斋普尔）精品版纯规则引擎 — UMD
 *
 * 浏览器：先加载本文件，使用 globalThis.JaipurEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；state 是纯 JSON 数据，可安全存档/克隆。
 *   - applyMove 不修改入参，始终返回全新 state。
 *   - 洗牌复用 games/shared/shuffle.js 的 seeded Fisher-Yates；同一 seed 可复现。
 *   - 非法动作一律抛 Error；AI 只从合法动作中选择。
 *
 * 规则口径（按用户给定的 Jaipur 官方规则修正旧实现）：
 *   - 55 张牌：钻石6 黄金6 白银6 丝绸8 香料8 皮革10 骆驼11。
 *   - 38 枚货物代币，面值从高到低排列，卖出时从最高的取。
 *   - 18 枚奖励代币：卖 3 张档 {1,2,3}、卖 4 张档 {4,5,6}、卖 5+ 张档 {8,9,10}，
 *     每档 3 种面值、每种 2 枚（6 枚/档，合计 18 枚），各自洗混后背面朝下；
 *     卖到才翻，拿完为止（双方分别可拿）。
 *   - 开局：市场先放 3 只骆驼；余 52 张洗牌，双方各发 5 张；手中骆驼移入骆驼群；
 *     再从牌堆顶翻 2 张补到市场。剩余牌堆 40 张。玩家开局不一定有骆驼。
 *   - 回合四选一：取 1 张货物 / 收走市场全部骆驼 / 交换 N≥2 张 / 卖一种货物。
 *   - 取货物要求取之前手牌 < 7；交换结束时手牌 ≤ 7（骆驼群不计）。
 *   - 卖钻石/黄金/白银至少 2 张，丝绸/香料/皮革至少 1 张；卖出张数不能超过剩余代币数。
 *   - 轮结束：3 种货物代币耗尽，或需要补市场时牌堆已空；当前动作完成后结算。
 *   - 计分：货物代币 + 奖励代币；骆驼多的一方 +5（相同则无人得）。
 *     同分依次比奖励代币数量、货物代币数量，仍平则该轮无人得 Seal。
 *   - 整场先拿 2 个 Seal 获胜；上一轮输家下一轮先手（平局则上一轮非先手方先手）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.JaipurEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('JaipurEngine requires games/shared/shuffle.js');
  }

  var VERSION = '2.0.0';

  /* ------------------------------------------------------------------ */
  /* 常量                                                               */
  /* ------------------------------------------------------------------ */

  var GOODS = Object.freeze(['diamond', 'gold', 'silver', 'silk', 'spice', 'leather']);
  var GOOD_NAMES = Object.freeze({
    diamond: '钻石',
    gold: '黄金',
    silver: '白银',
    silk: '丝绸',
    spice: '香料',
    leather: '皮革'
  });
  var GOOD_EN = Object.freeze({
    diamond: 'DIAMOND', gold: 'GOLD', silver: 'SILVER',
    silk: 'SILK', spice: 'SPICE', leather: 'LEATHER'
  });

  var CARD_COUNTS = Object.freeze({
    diamond: 6, gold: 6, silver: 6, silk: 8, spice: 8, leather: 10
  });
  var CAMEL_COUNT = 11;
  var TOTAL_GOODS_CARDS = 44;
  var TOTAL_CARDS = 55;

  // 货物代币，已按面值从高到低排列。
  var TOKEN_VALUES = Object.freeze({
    diamond: Object.freeze([7, 7, 5, 5, 5]),
    gold: Object.freeze([6, 6, 5, 5, 5]),
    silver: Object.freeze([5, 5, 5, 5, 5]),
    silk: Object.freeze([5, 3, 3, 2, 2, 1, 1]),
    spice: Object.freeze([5, 3, 3, 2, 2, 1, 1]),
    leather: Object.freeze([4, 3, 2, 1, 1, 1, 1, 1, 1])
  });
  var TOTAL_GOODS_TOKENS = 38;

  var MIN_SELL = Object.freeze({
    diamond: 2, gold: 2, silver: 2, silk: 1, spice: 1, leather: 1
  });

  // 奖励代币：三档，每档 3 种面值、每种 2 枚，共 6 枚/档，合计 18 枚。
  var BONUS_TIERS = Object.freeze([3, 4, 5]);
  var BONUS_VALUES = Object.freeze({
    3: Object.freeze([1, 1, 2, 2, 3, 3]),
    4: Object.freeze([4, 4, 5, 5, 6, 6]),
    5: Object.freeze([8, 8, 9, 9, 10, 10])
  });
  var BONUS_PER_TIER = 6;
  var TOTAL_BONUS_TOKENS = 18;

  var MARKET_SIZE = 5;
  var OPENING_CAMELS = 3;
  var OPENING_FLIP = 2;
  var HAND_SIZE = 5;
  var HAND_LIMIT = 7;
  var CAMEL_BONUS = 5;
  var SEALS_TO_WIN = 2;
  var DECK_AFTER_SETUP = 40;

  var MAX_TURNS = 5000;
  var MAX_ROUNDS = 20;

  var DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
  var DIFFICULTY_NAMES = Object.freeze({ easy: '轻松', medium: '标准', hard: '老练' });

  // AI 的货物基础估值，仅用于启发式，不影响规则。
  var CARD_VALUE = Object.freeze({
    diamond: 10, gold: 8.6, silver: 7.2, silk: 5.4, spice: 4.6, leather: 3.2
  });

  // 奖励档的平均值（AI 不知道背面具体数值，用期望值）。
  var BONUS_EXPECTATION = Object.freeze({ 3: 2, 4: 5, 5: 9 });

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                           */
  /* ------------------------------------------------------------------ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function sum(list) {
    return list.reduce(function (total, n) { return total + n; }, 0);
  }

  function zeroHand() {
    var hand = {};
    GOODS.forEach(function (good) { hand[good] = 0; });
    return hand;
  }

  function zeroTokenMap() {
    var map = {};
    GOODS.forEach(function (good) { map[good] = []; });
    return map;
  }

  function isGood(card) {
    return GOODS.indexOf(card) !== -1;
  }

  function handSize(player) {
    return GOODS.reduce(function (n, good) { return n + player.hand[good]; }, 0);
  }

  function handCopy(hand) {
    var out = {};
    GOODS.forEach(function (good) { out[good] = hand[good] || 0; });
    return out;
  }

  function tokenSum(list) {
    return sum(list || []);
  }

  function bonusTierFor(count) {
    if (count >= 5) return 5;
    if (count === 4) return 4;
    if (count === 3) return 3;
    return 0;
  }

  function goodList() {
    return GOODS.slice();
  }

  function cardsFromCounts(counts) {
    var list = [];
    GOODS.forEach(function (good) {
      for (var i = 0; i < (counts[good] || 0); i++) list.push(good);
    });
    return list;
  }

  function hashString(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededShuffle(list, seed, label) {
    return ShuffleApi.shuffle(list, { seed: String(seed) + ':' + label });
  }

  function pushLog(state, player, type, text, data) {
    state.log.push({
      round: state.round,
      turn: state.turn,
      player: player,
      type: type,
      text: text,
      data: data || null
    });
    if (state.log.length > 360) state.log.splice(0, state.log.length - 360);
  }

  function playerName(state, index) {
    var player = state.players[index];
    return player ? player.name : ('玩家 ' + (index + 1));
  }

  /* ------------------------------------------------------------------ */
  /* 开局                                                               */
  /* ------------------------------------------------------------------ */

  function makePlayer(index, name, isAI, difficulty) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      difficulty: difficulty || 'medium',
      hand: zeroHand(),
      camels: 0,
      goodsTokens: zeroTokenMap(),
      bonusTokens: [],
      seals: 0,
      roundScore: 0
    };
  }

  function buildFullDeck() {
    var deck = [];
    GOODS.forEach(function (good) {
      for (var i = 0; i < CARD_COUNTS[good]; i++) deck.push(good);
    });
    for (var c = 0; c < CAMEL_COUNT; c++) deck.push('camel');
    return deck;
  }

  // 从一个完整 55 张牌组里移除 3 只初始市场骆驼，得到要洗的 52 张。
  function buildShuffledDeck(seed, label) {
    var deck = buildFullDeck();
    var removed = 0;
    for (var i = deck.length - 1; i >= 0 && removed < OPENING_CAMELS; i--) {
      if (deck[i] === 'camel') {
        deck.splice(i, 1);
        removed += 1;
      }
    }
    return seededShuffle(deck, seed, label);
  }

  function resetPlayerForRound(player) {
    player.hand = zeroHand();
    player.camels = 0;
    player.goodsTokens = zeroTokenMap();
    player.bonusTokens = [];
    player.roundScore = 0;
  }

  function setupRound(state, starter) {
    state.market = ['camel', 'camel', 'camel'];
    state.deck = buildShuffledDeck(state.seed, 'round:' + state.round + ':deck');
    state.discard = [];
    state.tokenStacks = clone(TOKEN_VALUES);
    state.bonusStacks = {
      3: seededShuffle(BONUS_VALUES[3].slice(), state.seed, 'round:' + state.round + ':bonus:3'),
      4: seededShuffle(BONUS_VALUES[4].slice(), state.seed, 'round:' + state.round + ':bonus:4'),
      5: seededShuffle(BONUS_VALUES[5].slice(), state.seed, 'round:' + state.round + ':bonus:5')
    };
    state.players.forEach(resetPlayerForRound);

    // 双方各发 5 张；手中的骆驼立即进入骆驼群。
    state.players.forEach(function (player) {
      for (var i = 0; i < HAND_SIZE; i++) {
        var card = state.deck.pop();
        if (card === 'camel') player.camels += 1;
        else player.hand[card] += 1;
      }
    });

    // 从牌堆顶翻 2 张补到市场（可能是骆驼）。
    for (var f = 0; f < OPENING_FLIP; f++) {
      var flipped = state.deck.pop();
      if (flipped != null) state.market.push(flipped);
    }

    state.current = starter;
    state.starter = starter;
    state.phase = 'play';
    state.lastAction = null;

    pushLog(state, null, 'roundStart',
      '第 ' + state.round + ' 轮开始：' + playerName(state, starter) + '先手。市场 3 只骆驼 + 2 张货牌，牌堆 ' +
      state.deck.length + ' 张。');
  }

  function createGame(options) {
    var opts = options && typeof options === 'object' ? options : { seed: options };
    var seed = opts.seed == null ? Date.now() : (Number(opts.seed) >>> 0);
    var names = opts.names && opts.names.length === 2
      ? opts.names.slice()
      : ['你', 'AI · 驼铃商队'];
    var aiFlags = opts.isAI && opts.isAI.length === 2 ? opts.isAI.slice() : [false, true];
    var difficulty = DIFFICULTIES.indexOf(opts.difficulty) !== -1 ? opts.difficulty : 'medium';
    var starter = opts.first === 1 || opts.first === 'ai' ? 1 : 0;

    var state = {
      version: VERSION,
      seed: seed,
      round: 1,
      turn: 0,
      phase: 'play',
      market: [],
      deck: [],
      discard: [],
      players: [
        makePlayer(0, names[0], !!aiFlags[0], opts.difficulty0 || 'medium'),
        makePlayer(1, names[1], aiFlags[1] == null ? true : !!aiFlags[1], opts.aiDifficulty || difficulty)
      ],
      tokenStacks: clone(TOKEN_VALUES),
      bonusStacks: { 3: [], 4: [], 5: [] },
      current: starter,
      starter: starter,
      seals: [0, 0],
      history: [],
      lastRound: null,
      result: null,
      over: false,
      winner: null,
      lastAction: null,
      log: [],
      maxRounds: MAX_ROUNDS
    };

    setupRound(state, starter);
    pushLog(state, null, 'start',
      '新开一场斋普尔：先拿 2 个 Seal 者获胜。' +
      state.players[0].name + ' 与 ' + state.players[1].name + ' 各 5 张起手。');
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 查询工具                                                           */
  /* ------------------------------------------------------------------ */

  function allCards(state) {
    var cards = state.market.slice().concat(state.deck).concat(state.discard);
    state.players.forEach(function (player) {
      cards = cards.concat(cardsFromCounts(player.hand));
      for (var i = 0; i < player.camels; i++) cards.push('camel');
    });
    // 玩家已获得的货物代币不是牌；卖出时对应牌已进 discard。
    return cards;
  }

  function cardCounts(state) {
    var counts = { camel: 0 };
    GOODS.forEach(function (good) { counts[good] = 0; });
    allCards(state).forEach(function (card) { counts[card] += 1; });
    return counts;
  }

  function tokenCounts(state) {
    var counts = {};
    GOODS.forEach(function (good) { counts[good] = state.tokenStacks[good].length; });
    return counts;
  }

  function exhaustedTypes(state) {
    return GOODS.filter(function (good) { return state.tokenStacks[good].length === 0; });
  }

  function bonusCounts(state) {
    return {
      3: state.bonusStacks[3].length,
      4: state.bonusStacks[4].length,
      5: state.bonusStacks[5].length
    };
  }

  function maxSellCount(state, player, good) {
    var stack = state.tokenStacks[good] || [];
    return Math.min(player.hand[good] || 0, stack.length);
  }

  function canSell(state, player, good) {
    return maxSellCount(state, player, good) >= MIN_SELL[good];
  }

  function currentPlayer(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    return state.players[state.current];
  }

  function roundScoreDetail(state, player) {
    var goodsValues = [];
    GOODS.forEach(function (good) {
      goodsValues = goodsValues.concat(player.goodsTokens[good] || []);
    });
    var goodsPoints = tokenSum(goodsValues);
    var bonusPoints = tokenSum(player.bonusTokens);
    return {
      index: player.index,
      name: player.name,
      goodsPoints: goodsPoints,
      bonusPoints: bonusPoints,
      camelBonus: 0,
      camelCount: player.camels,
      goodsTokenCount: goodsValues.length,
      bonusTokenCount: player.bonusTokens.length,
      total: goodsPoints + bonusPoints
    };
  }

  function computeRoundScores(state) {
    var rows = state.players.map(function (player) { return roundScoreDetail(state, player); });
    var camelBonusTo = null;
    if (rows[0].camelCount > rows[1].camelCount) {
      rows[0].camelBonus = CAMEL_BONUS;
      camelBonusTo = 0;
    } else if (rows[1].camelCount > rows[0].camelCount) {
      rows[1].camelBonus = CAMEL_BONUS;
      camelBonusTo = 1;
    }
    rows.forEach(function (row) { row.total += row.camelBonus; });

    var winner = null;
    if (rows[0].total > rows[1].total) winner = 0;
    else if (rows[1].total > rows[0].total) winner = 1;
    else {
      if (rows[0].bonusTokenCount > rows[1].bonusTokenCount) winner = 0;
      else if (rows[1].bonusTokenCount > rows[0].bonusTokenCount) winner = 1;
      else if (rows[0].goodsTokenCount > rows[1].goodsTokenCount) winner = 0;
      else if (rows[1].goodsTokenCount > rows[0].goodsTokenCount) winner = 1;
      else winner = null;
    }

    return {
      scores: rows,
      camelBonusTo: camelBonusTo,
      winner: winner,
      tied: winner === null,
      tieBreak: winner === null ? 'exhausted' :
        (rows[0].total === rows[1].total ? 'token-count' : 'score')
    };
  }

  /* ------------------------------------------------------------------ */
  /* 轮结束与整场结算                                                   */
  /* ------------------------------------------------------------------ */

  function finishMatch(state, reason) {
    state.over = true;
    state.phase = 'over';
    var winner = null;
    if (state.seals[0] > state.seals[1]) winner = 0;
    else if (state.seals[1] > state.seals[0]) winner = 1;
    else {
      // 极端防守：回合上限仍平，比较累计轮分，再平则无胜者。
      var totals = [0, 0];
      state.history.forEach(function (entry) {
        entry.scores.forEach(function (row) { totals[row.index] += row.total; });
      });
      if (totals[0] > totals[1]) winner = 0;
      else if (totals[1] > totals[0]) winner = 1;
    }
    state.winner = winner;
    state.result = {
      reason: reason,
      seals: state.seals.slice(),
      winner: winner,
      rounds: state.history.slice(),
      roundCount: state.history.length
    };
    pushLog(state, null, 'matchEnd',
      '整场结束：' + (winner == null ? '无人获胜' : playerName(state, winner) + ' 以 ' +
        state.seals[0] + ' : ' + state.seals[1] + ' 个 Seal 获胜') + '。');
  }

  function finishRound(state, reason) {
    var scoring = computeRoundScores(state);
    var winner = scoring.winner;
    var entry = {
      round: state.round,
      reason: reason,
      scores: scoring.scores,
      camelBonusTo: scoring.camelBonusTo,
      winner: winner,
      tied: scoring.tied,
      tieBreak: scoring.tieBreak,
      sealsAfter: state.seals.slice()
    };
    state.lastRound = entry;
    state.history.push(entry);

    if (winner != null) {
      state.seals[winner] += 1;
      state.players[winner].seals += 1;
      entry.sealsAfter = state.seals.slice();
    }

    pushLog(state, null, 'roundEnd',
      '第 ' + state.round + ' 轮结束（' + (reason === 'deckEmpty' ? '牌堆耗尽' : '三种货物代币耗尽') + '）：' +
      scoring.scores.map(function (row) {
        return row.name + ' ' + row.total + ' 分（货物 ' + row.goodsPoints + ' + 奖励 ' +
          row.bonusPoints + (row.camelBonus ? ' + 骆驼 ' + row.camelBonus : '') + '）';
      }).join('，') + '。' +
      (winner == null ? '同分且奖励/货物代币数相同，本轮无人得 Seal。'
        : playerName(state, winner) + ' 获得 Seal（' + state.seals[0] + ' : ' + state.seals[1] + '）。'),
      { entry: entry });

    if (winner != null && state.seals[winner] >= SEALS_TO_WIN) {
      finishMatch(state, 'seals');
      return;
    }
    if (state.round >= state.maxRounds) {
      finishMatch(state, 'roundLimit');
      return;
    }

    // 上一轮输家下一轮先手；平局则上一轮非先手方先手。
    var nextStarter = winner == null ? 1 - state.starter : 1 - winner;
    state.round += 1;
    setupRound(state, nextStarter);
    pushLog(state, null, 'roundStart',
      '第 ' + state.round + ' 轮开始：' + playerName(state, nextStarter) +
      '先手（' + (winner == null ? '上轮平局，轮到另一方先手' : '上轮输家先手') + '）。');
  }

  /* ------------------------------------------------------------------ */
  /* 合法动作                                                           */
  /* ------------------------------------------------------------------ */

  function refillMarket(state) {
    var need = MARKET_SIZE - state.market.length;
    var short = false;
    while (need > 0 && state.deck.length > 0) {
      state.market.push(state.deck.pop());
      need -= 1;
    }
    if (need > 0) short = true;
    return { short: short, need: need };
  }

  function availableCards(player) {
    var avail = handCopy(player.hand);
    avail.camel = player.camels;
    return avail;
  }

  function totalAvailable(player) {
    return handSize(player) + player.camels;
  }

  function paymentFits(player, give, takeGoodsCount) {
    var size = 0;
    var giveGoods = 0;
    for (var i = 0; i < GOODS.length; i++) {
      var good = GOODS[i];
      var n = give[good] || 0;
      if (n < 0 || n > (player.hand[good] || 0)) return false;
      size += n;
      giveGoods += n;
    }
    var camels = give.camel || 0;
    if (camels < 0 || camels > player.camels) return false;
    size += camels;
    if (size !== takeGoodsCount) return false;
    var finalHand = handSize(player) + takeGoodsCount - giveGoods;
    return finalHand >= 0 && finalHand <= HAND_LIMIT;
  }

  // 给一组“市场取牌下标”，生成若干候选返还方案（不是全部组合，用于 AI/legalMoves 抽样）。
  function paymentPlans(state, player, takeIndices) {
    var taken = takeIndices.map(function (index) { return state.market[index]; });
    var n = taken.length;
    var avail = availableCards(player);
    var takenCounts = {};
    GOODS.forEach(function (good) { takenCounts[good] = 0; });
    taken.forEach(function (good) { if (isGood(good)) takenCounts[good] += 1; });

    var strategies = ['same', 'low', 'camel', 'high', 'mixed'];
    var plans = [];
    var seen = {};

    function pushPlan(give) {
      var key = GOODS.map(function (g) { return give[g] || 0; }).join(',') + '|' + (give.camel || 0);
      if (seen[key]) return;
      if (!paymentFits(player, give, n)) return;
      seen[key] = true;
      plans.push(give);
    }

    strategies.forEach(function (strategy) {
      var give = zeroHand();
      give.camel = 0;
      var remaining = n;
      var order = GOODS.slice();
      if (strategy === 'low') order.sort(function (a, b) { return CARD_VALUE[a] - CARD_VALUE[b]; });
      else if (strategy === 'high') order.sort(function (a, b) { return CARD_VALUE[b] - CARD_VALUE[a]; });
      else if (strategy === 'same') {
        order.sort(function (a, b) {
          return (takenCounts[b] - takenCounts[a]) || (CARD_VALUE[a] - CARD_VALUE[b]);
        });
      } else if (strategy === 'mixed') {
        order.sort(function (a, b) { return (hashString(a + player.index) % 7) - (hashString(b + player.index) % 7); });
      }

      if (strategy === 'camel') {
        var camels = Math.min(remaining, avail.camel);
        give.camel = camels;
        remaining -= camels;
      }
      for (var i = 0; i < order.length && remaining > 0; i++) {
        var good = order[i];
        var take = Math.min(remaining, avail[good] - (give[good] || 0));
        if (take > 0) { give[good] += take; remaining -= take; }
      }
      if (remaining > 0) {
        var extra = Math.min(remaining, avail.camel - give.camel);
        give.camel += extra;
        remaining -= extra;
      }
      if (remaining === 0) pushPlan(give);
    });

    // 单类型整组返还（例如把同种货物的多张一起换出去）。
    GOODS.forEach(function (good) {
      if (avail[good] >= n) {
        var give = zeroHand();
        give[good] = n;
        pushPlan(give);
      }
    });

    return plans;
  }

  function enumerateExchanges(state, limit, player) {
    player = player || currentPlayer(state);
    var goodsIndices = [];
    state.market.forEach(function (card, index) {
      if (isGood(card)) goodsIndices.push(index);
    });
    if (goodsIndices.length < 2) return [];
    if (totalAvailable(player) < 2) return [];

    var maxTake = Math.min(MARKET_SIZE, goodsIndices.length);
    var subsets = [];
    function combine(start, picked) {
      if (picked.length >= 2) subsets.push(picked.slice());
      if (picked.length >= maxTake) return;
      for (var i = start; i < goodsIndices.length; i++) {
        picked.push(goodsIndices[i]);
        combine(i + 1, picked);
        picked.pop();
      }
    }
    combine(0, []);

    var out = [];
    var seen = {};
    var cap = limit == null ? 48 : limit;
    for (var s = 0; s < subsets.length && out.length < cap; s++) {
      var plans = paymentPlans(state, player, subsets[s]);
      for (var p = 0; p < plans.length && out.length < cap; p++) {
        var move = { type: 'exchange', take: subsets[s].slice(), give: plans[p] };
        var key = JSON.stringify(move);
        if (seen[key]) continue;
        seen[key] = true;
        out.push(move);
      }
    }
    return out;
  }

  function getLegalMoves(state, options) {
    if (!state || state.over || state.phase !== 'play') return [];
    var player = state.players[state.current];
    var opts = options || {};
    var moves = [];

    // 卖牌（从少到多，便于 AI 与测试遍历）。
    GOODS.forEach(function (good) {
      var maximum = maxSellCount(state, player, good);
      if (maximum < MIN_SELL[good]) return;
      for (var count = MIN_SELL[good]; count <= maximum; count++) {
        moves.push({ type: 'sell', good: good, count: count });
      }
    });

    // 收骆驼。
    if (state.market.indexOf('camel') !== -1) {
      moves.push({ type: 'takeCamels' });
    }

    // 取 1 张货物：取之前手牌必须 < 7。
    if (handSize(player) < HAND_LIMIT) {
      var seen = {};
      state.market.forEach(function (card) {
        if (!isGood(card) || seen[card]) return;
        seen[card] = true;
        moves.push({ type: 'take', card: card });
      });
    }

    if (opts.includeExchanges !== false) {
      var limit = opts.exchangeLimit == null ? 48 : opts.exchangeLimit;
      moves = moves.concat(enumerateExchanges(state, limit, player));
    }
    return moves;
  }

  function legalMoves(state, options) {
    return getLegalMoves(state, options);
  }

  function isLegalMove(state, move) {
    try {
      validateMove(state, move);
      return true;
    } catch (err) {
      return false;
    }
  }

  function validateMove(state, move) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (state.over || state.phase !== 'play') throw new Error('对局已结束');
    var player = state.players[state.current];

    if (move.type === 'take') {
      if (!isGood(move.card)) throw new Error('只能取货物，骆驼必须整批收走');
      if (state.market.indexOf(move.card) === -1) {
        throw new Error('市场上没有' + GOOD_NAMES[move.card]);
      }
      if (handSize(player) >= HAND_LIMIT) {
        throw new Error('手牌已有 7 张，不能再取货物');
      }
      return { type: 'take', card: move.card };
    }

    if (move.type === 'takeCamels') {
      if (state.market.indexOf('camel') === -1) throw new Error('市场上没有骆驼');
      return { type: 'takeCamels' };
    }

    if (move.type === 'sell') {
      if (!isGood(move.good)) throw new Error('未知货物');
      var count = move.count;
      if (!Number.isInteger(count) || count < MIN_SELL[move.good]) {
        throw new Error(GOOD_NAMES[move.good] + ' 至少卖出 ' + MIN_SELL[move.good] + ' 张');
      }
      if ((player.hand[move.good] || 0) < count) {
        throw new Error('手里没有足够的' + GOOD_NAMES[move.good]);
      }
      var stack = state.tokenStacks[move.good];
      if (!stack.length) throw new Error(GOOD_NAMES[move.good] + ' 的代币已耗尽');
      if (count > stack.length) {
        throw new Error(GOOD_NAMES[move.good] + ' 只剩 ' + stack.length + ' 枚代币，不能卖 ' + count + ' 张');
      }
      return { type: 'sell', good: move.good, count: count };
    }

    if (move.type === 'exchange') {
      if (!Array.isArray(move.take) || move.take.length < 2) {
        throw new Error('交换至少要取 2 张货物');
      }
      var seen = {};
      var takeGoodsCount = 0;
      move.take.forEach(function (index) {
        if (!Number.isInteger(index) || index < 0 || index >= state.market.length) {
          throw new Error('交换取牌下标非法');
        }
        if (seen[index]) throw new Error('交换取牌下标重复');
        seen[index] = true;
        if (!isGood(state.market[index])) throw new Error('交换不能取骆驼');
        takeGoodsCount += 1;
      });
      if (takeGoodsCount > MARKET_SIZE) throw new Error('交换取牌过多');
      var giveInput = move.give || {};
      var give = zeroHand();
      give.camel = Number(giveInput.camel || 0);
      if (!Number.isInteger(give.camel) || give.camel < 0) throw new Error('返还骆驼数非法');
      for (var i = 0; i < GOODS.length; i++) {
        var good = GOODS[i];
        var n = Number(giveInput[good] || 0);
        if (!Number.isInteger(n) || n < 0) throw new Error('返还货物数非法');
        give[good] = n;
      }
      var giveTotal = give.camel;
      GOODS.forEach(function (g2) { giveTotal += give[g2]; });
      if (giveTotal !== takeGoodsCount) {
        throw new Error('取 ' + takeGoodsCount + ' 张就必须返还 ' + takeGoodsCount + ' 张');
      }
      if (!paymentFits(player, give, takeGoodsCount)) {
        throw new Error('返还的牌不足，或交换后手牌超过 7 张');
      }
      return { type: 'exchange', take: move.take.slice(), give: give };
    }

    throw new Error('未知动作类型');
  }

  /* ------------------------------------------------------------------ */
  /* 动作执行                                                           */
  /* ------------------------------------------------------------------ */

  function moveText(state, move, player) {
    if (move.type === 'take') return player.name + ' 从市场取走 1 张「' + GOOD_NAMES[move.card] + '」。';
    if (move.type === 'takeCamels') return player.name + ' 收走市场全部骆驼。';
    if (move.type === 'sell') {
      return player.name + ' 卖出 ' + move.count + ' 张「' + GOOD_NAMES[move.good] + '」。';
    }
    var takenNames = move.take.map(function (index) { return GOOD_NAMES[state.market[index]]; });
    var giveNames = [];
    GOODS.forEach(function (good) {
      for (var i = 0; i < (move.give[good] || 0); i++) giveNames.push(GOOD_NAMES[good]);
    });
    for (var c = 0; c < (move.give.camel || 0); c++) giveNames.push('骆驼');
    return player.name + ' 用 ' + giveNames.join('、') + ' 交换市场的 ' + takenNames.join('、') + '。';
  }

  function applyTake(state, move, player) {
    var index = state.market.indexOf(move.card);
    state.market.splice(index, 1);
    player.hand[move.card] += 1;
    var refill = refillMarket(state);
    pushLog(state, player.index, 'take',
      player.name + ' 取走 1 张「' + GOOD_NAMES[move.card] + '」' +
      (refill.short ? '；牌堆已空，市场无法补满。' : '；市场补至 5 张。'),
      { card: move.card, refillShort: refill.short });
    return { roundOver: false, deckShort: refill.short };
  }

  function applyTakeCamels(state, move, player) {
    var camels = state.market.filter(function (card) { return card === 'camel'; }).length;
    state.market = state.market.filter(function (card) { return card !== 'camel'; });
    player.camels += camels;
    var refill = refillMarket(state);
    pushLog(state, player.index, 'takeCamels',
      player.name + ' 收走 ' + camels + ' 只骆驼（骆驼群共 ' + player.camels + ' 只）' +
      (refill.short ? '；牌堆已空，市场无法补满。' : '；市场补至 5 张。'),
      { camels: camels, refillShort: refill.short });
    return { roundOver: false, deckShort: refill.short };
  }

  function applySell(state, move, player) {
    var count = move.count;
    var taken = state.tokenStacks[move.good].splice(0, count);
    taken.forEach(function (value) { player.goodsTokens[move.good].push(value); });
    player.hand[move.good] -= count;
    for (var i = 0; i < count; i++) state.discard.push(move.good);

    var tier = bonusTierFor(count);
    var bonus = null;
    if (tier && state.bonusStacks[tier].length > 0) {
      bonus = state.bonusStacks[tier].pop();
      player.bonusTokens.push(bonus);
    }
    var exhausted = exhaustedTypes(state);
    pushLog(state, player.index, 'sell',
      player.name + ' 卖出 ' + count + ' 张「' + GOOD_NAMES[move.good] + '」，获得 ' +
      taken.length + ' 枚代币共 ' + tokenSum(taken) + ' 分' +
      (bonus == null ? (tier ? '；' + tier + ' 张档奖励已发完。' : '。') : '，翻出奖励代币 ' + bonus + ' 分。') +
      (exhausted.length >= 3 ? ' 三种货物代币已耗尽。' : ''),
      {
        good: move.good, count: count, tokens: taken, bonus: bonus,
        bonusTier: tier || null, exhausted: exhausted
      });
    return { roundOver: exhausted.length >= 3, exhausted: exhausted, tokens: taken, bonus: bonus };
  }

  function applyExchange(state, move, player) {
    var taken = [];
    var indices = move.take.slice().sort(function (a, b) { return b - a; });
    indices.forEach(function (index) {
      taken.push(state.market[index]);
      state.market.splice(index, 1);
    });
    // 先返还，再进手牌，保持市场 5 张。
    for (var c = 0; c < (move.give.camel || 0); c++) state.market.push('camel');
    player.camels -= (move.give.camel || 0);
    GOODS.forEach(function (good) {
      var n = move.give[good] || 0;
      for (var i = 0; i < n; i++) state.market.push(good);
      player.hand[good] -= n;
    });
    taken.forEach(function (card) { player.hand[card] += 1; });

    var takenNames = taken.map(function (card) { return GOOD_NAMES[card]; });
    var giveNames = [];
    for (var cc = 0; cc < (move.give.camel || 0); cc++) giveNames.push('骆驼');
    GOODS.forEach(function (good) {
      for (var i = 0; i < (move.give[good] || 0); i++) giveNames.push(GOOD_NAMES[good]);
    });
    pushLog(state, player.index, 'exchange',
      player.name + ' 用 ' + giveNames.join('、') + ' 交换市场的 ' + takenNames.join('、') +
      '（市场保持 5 张，手牌 ' + handSize(player) + ' 张）。',
      { take: taken, give: move.give });
    return { roundOver: false };
  }

  function applyMove(state, move, options) {
    if (!state) throw new Error('缺少 state');
    if (state.over) throw new Error('比赛已经结束');
    var legal = validateMove(state, move);
    var next = clone(state);
    var player = next.players[next.current];
    var outcome;

    if (legal.type === 'take') outcome = applyTake(next, legal, player);
    else if (legal.type === 'takeCamels') outcome = applyTakeCamels(next, legal, player);
    else if (legal.type === 'sell') outcome = applySell(next, legal, player);
    else outcome = applyExchange(next, legal, player);

    next.turn += 1;
    next.lastAction = {
      type: legal.type,
      player: next.current,
      move: legal,
      roundEnded: false,
      deckShort: !!outcome.deckShort,
      tokens: outcome.tokens || null,
      bonus: outcome.bonus == null ? null : outcome.bonus,
      text: moveText(next, legal, player)
    };

    if (outcome.roundOver || outcome.deckShort) {
      next.lastAction.roundEnded = true;
      finishRound(next, outcome.deckShort ? 'deckEmpty' : 'tokensExhausted');
      return next;
    }

    if (next.phase === 'play') next.current = 1 - next.current;

    if (!next.over && next.turn > MAX_TURNS) {
      finishMatch(next, 'turnLimit');
    }
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                 */
  /* ------------------------------------------------------------------ */

  function goodUnitValue(state, good) {
    var stack = state.tokenStacks[good] || [];
    if (!stack.length) return 0.15;
    var average = tokenSum(stack) / stack.length;
    return average * 0.82 + CARD_VALUE[good] * 0.18;
  }

  function expectedSellValue(state, player, good, count) {
    var stack = state.tokenStacks[good] || [];
    var take = Math.min(count, stack.length);
    if (take < MIN_SELL[good]) return 0;
    var points = tokenSum(stack.slice(0, take));
    var tier = bonusTierFor(count);
    var bonus = 0;
    if (tier && state.bonusStacks[tier].length > 0) {
      bonus = BONUS_EXPECTATION[tier];
      // 剩余奖励越少，预期越接近真实剩余值。
      var remaining = state.bonusStacks[tier];
      if (remaining.length === 1) bonus = remaining[0];
      else if (remaining.length === 2) bonus = (remaining[0] + remaining[1]) / 2;
    }
    return points + bonus;
  }

  function moveHeuristic(state, move, player, difficulty) {
    var opponent = state.players[1 - player.index];
    var hard = difficulty === 'hard';

    if (move.type === 'sell') {
      var points = expectedSellValue(state, player, move.good, move.count);
      var stackLeft = state.tokenStacks[move.good].length;
      var urgency = 1 + Math.max(0, 3 - stackLeft) * 0.35;
      var score = points * urgency + 1.8;
      if (hard) {
        if (stackLeft === move.count) score += 1.6;
        if (move.count >= 3 && state.bonusStacks[bonusTierFor(move.count)].length) score += 0.9;
        if ((opponent.hand[move.good] || 0) >= MIN_SELL[move.good]) score += 0.45;
        if (stackLeft === 0) score += 1.0;
      }
      return score;
    }

    if (move.type === 'takeCamels') {
      var camels = state.market.filter(function (card) { return card === 'camel'; }).length;
      var value = 1.6 + camels * 1.05;
      if (player.camels <= opponent.camels) value += 2.6;
      if (player.camels + camels > opponent.camels) value += 1.2;
      if (state.deck.length < 8) value += camels * 0.35;
      if (hard) {
        if (player.camels + camels > opponent.camels) value += 1.6;
        if (camels >= 3) value += 0.9;
        if (player.camels === 0 && camels >= 2) value += 0.5;
      }
      return value;
    }

    if (move.type === 'take') {
      var unit = goodUnitValue(state, move.card);
      var value = unit * 1.12;
      var n = player.hand[move.card] || 0;
      if (n + 1 === MIN_SELL[move.card]) value += 1.8;
      if (n + 1 >= 3 && state.bonusStacks[Math.min(5, n + 1)]) value += 0.9;
      if (state.tokenStacks[move.card].length <= 2) value -= 0.5;
      // 市场只剩这一张时，取走也减少了对手的凑套机会。
      var marketCount = state.market.filter(function (card) { return card === move.card; }).length;
      if (marketCount === 1) value += 0.35;
      if (hard) {
        if ((opponent.hand[move.card] || 0) >= 2) value += 0.55;
        var afterCount = n + 1;
        if (afterCount >= 3 && state.tokenStacks[move.card].length >= 3) value += 0.7;
        if (handSize(player) >= 6) value -= 1.4;
      }
      return value;
    }

    // exchange：对比拿到的牌与返还的牌。
    var gain = 0;
    move.take.forEach(function (index) {
      var card = state.market[index];
      if (isGood(card)) gain += goodUnitValue(state, card);
    });
    var cost = 0;
    GOODS.forEach(function (good) {
      var n = move.give[good] || 0;
      if (n) cost += n * goodUnitValue(state, good) * 0.96;
    });
    cost += (move.give.camel || 0) * 0.75;
    var tempo = 2.0;
    var afterHand = handSize(player) - (move.give.diamond + move.give.gold + move.give.silver + move.give.silk + move.give.spice + move.give.leather) + move.take.length;
    if (afterHand > HAND_LIMIT) cost += 20;
    var exchangeScore = (gain - cost) - tempo;
    if (hard) {
      if (gain - cost < 1.1) exchangeScore -= 6;
      if (afterHand >= 7) exchangeScore -= 1;
      if (state.deck.length < 6) exchangeScore += 0.5;
    }
    return exchangeScore;
  }

  function moveKey(move) {
    return JSON.stringify(move);
  }

  function deterministicTie(state, perspective, move) {
    var h = hashString(String(state.seed) + ':' + state.turn + ':' + perspective + ':' + moveKey(move));
    return (h % 997) / 100000;
  }

  function candidateMoves(state, perspective, difficulty) {
    var all = getLegalMoves(state, { exchangeLimit: difficulty === 'hard' ? 28 : 20 });
    if (difficulty === 'easy') {
      // easy 平时不主动交换；但交换是唯一的合法动作时必须使用，否则会卡死。
      var simple = all.filter(function (move) { return move.type !== 'exchange'; });
      return simple.length ? simple : all;
    }
    return all;
  }

  function rankedMoves(state, perspective, difficulty) {
    var moves = candidateMoves(state, perspective, difficulty);
    var player = state.players[perspective];
    return moves.map(function (move, index) {
      return {
        move: move,
        score: moveHeuristic(state, move, player, difficulty),
        tie: deterministicTie(state, perspective, move) + index * 1e-9
      };
    }).sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.tie - b.tie;
    });
  }

  function chooseAIMove(state, difficultyOverride) {
    if (!state || state.over) throw new Error('对局已结束');
    if (state.phase !== 'play') throw new Error('当前不能行动');
    var perspective = state.current;
    var player = state.players[perspective];
    var difficulty = DIFFICULTIES.indexOf(difficultyOverride) !== -1
      ? difficultyOverride
      : (DIFFICULTIES.indexOf(player.difficulty) !== -1 ? player.difficulty : 'medium');
    var ranked = rankedMoves(state, perspective, difficulty);
    if (!ranked.length) throw new Error('没有合法动作');

    if (difficulty === 'easy') {
      // 轻松档：只看眼前收益，并且有 28% 概率随手走一步。
      var roll = hashString(String(state.seed) + ':easy:' + state.turn) % 100;
      if (roll < 28) {
        var pick = ranked[hashString(String(state.turn) + ':pick') % Math.min(4, ranked.length)];
        return clone(pick.move);
      }
      return clone(ranked[0].move);
    }

    if (difficulty === 'medium') {
      return clone(ranked[0].move);
    }

    // 老练档：使用强化启发式（含封锁、奖励档与手牌上限判断）。
    return clone(ranked[0].move);
  }

  function aiMove(state, difficulty) {
    return chooseAIMove(state, difficulty);
  }

  /* ------------------------------------------------------------------ */
  /* 视图 / 汇总                                                        */
  /* ------------------------------------------------------------------ */

  function playerPublic(player, revealHand) {
    return {
      index: player.index,
      name: player.name,
      isAI: player.isAI,
      difficulty: player.difficulty,
      hand: revealHand ? handCopy(player.hand) : null,
      handCount: handSize(player),
      camels: player.camels,
      goodsTokens: clone(player.goodsTokens),
      bonusTokens: player.bonusTokens.slice(),
      bonusTokenCount: player.bonusTokens.length,
      seals: player.seals,
      roundScore: player.roundScore
    };
  }

  function publicState(state, viewerIndex) {
    if (!state) return null;
    var revealAll = state.over;
    return {
      version: state.version,
      seed: state.seed,
      playerCount: state.players.length,
      round: state.round,
      turn: state.turn,
      phase: state.phase,
      market: state.market.slice(),
      deckCount: state.deck.length,
      discardCount: state.discard.length,
      players: state.players.map(function (player) {
        return playerPublic(player, revealAll || viewerIndex === player.index);
      }),
      tokenStacks: clone(state.tokenStacks),
      bonusCounts: bonusCounts(state),
      bonusStacks: revealAll ? clone(state.bonusStacks) : null,
      current: state.current,
      starter: state.starter,
      seals: state.seals.slice(),
      history: state.history.slice(),
      lastRound: state.lastRound,
      result: state.result,
      over: state.over,
      winner: state.winner,
      lastAction: state.lastAction,
      log: state.log.slice(-60)
    };
  }

  function getResults(state) {
    if (!state) throw new Error('缺少对局状态');
    if (state.over && state.result) return state.result;
    return {
      over: false,
      seals: state.seals.slice(),
      winner: null,
      history: state.history.slice(),
      round: state.round
    };
  }

  function winnerOf(state) {
    if (!state || !state.over) return null;
    return state.winner;
  }

  function summary(state) {
    return {
      round: state.round,
      turn: state.turn,
      over: state.over,
      winner: state.winner,
      current: state.current,
      market: state.market.slice(),
      deckCount: state.deck.length,
      seals: state.seals.slice(),
      handSizes: state.players.map(handSize),
      camels: state.players.map(function (player) { return player.camels; }),
      tokenCounts: tokenCounts(state),
      bonusCounts: bonusCounts(state),
      legalCount: getLegalMoves(state, { includeExchanges: false }).length
    };
  }

  function addLog(state, text) {
    pushLog(state, null, 'note', text);
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 导出                                                               */
  /* ------------------------------------------------------------------ */

  return Object.freeze({
    VERSION: VERSION,
    GOODS: GOODS,
    GOOD_NAMES: GOOD_NAMES,
    GOOD_EN: GOOD_EN,
    CARD_COUNTS: CARD_COUNTS,
    CAMEL_COUNT: CAMEL_COUNT,
    TOTAL_GOODS_CARDS: TOTAL_GOODS_CARDS,
    TOTAL_CARDS: TOTAL_CARDS,
    TOKEN_VALUES: TOKEN_VALUES,
    TOTAL_GOODS_TOKENS: TOTAL_GOODS_TOKENS,
    MIN_SELL: MIN_SELL,
    BONUS_TIERS: BONUS_TIERS,
    BONUS_VALUES: BONUS_VALUES,
    TOTAL_BONUS_TOKENS: TOTAL_BONUS_TOKENS,
    BONUS_PER_TIER: BONUS_PER_TIER,
    MARKET_SIZE: MARKET_SIZE,
    OPENING_CAMELS: OPENING_CAMELS,
    OPENING_FLIP: OPENING_FLIP,
    HAND_SIZE: HAND_SIZE,
    HAND_LIMIT: HAND_LIMIT,
    CAMEL_BONUS: CAMEL_BONUS,
    SEALS_TO_WIN: SEALS_TO_WIN,
    DECK_AFTER_SETUP: DECK_AFTER_SETUP,
    MAX_TURNS: MAX_TURNS,
    MAX_ROUNDS: MAX_ROUNDS,
    DIFFICULTIES: DIFFICULTIES,
    DIFFICULTY_NAMES: DIFFICULTY_NAMES,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    legalMoves: legalMoves,
    isLegalMove: isLegalMove,
    validateMove: validateMove,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    aiMove: aiMove,
    computeRoundScores: computeRoundScores,
    exhaustedTypes: exhaustedTypes,
    bonusCounts: bonusCounts,
    tokenCounts: tokenCounts,
    allCards: allCards,
    cardCounts: cardCounts,
    handSize: handSize,
    maxSellCount: maxSellCount,
    canSell: canSell,
    currentPlayer: currentPlayer,
    publicState: publicState,
    getResults: getResults,
    winnerOf: winnerOf,
    isGameOver: function (state) { return !!(state && state.over); },
    summary: summary,
    addLog: addLog
  });
});
