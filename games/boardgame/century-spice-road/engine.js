/*
 * Century: Spice Road（香料之路）纯规则引擎 — UMD
 *
 * 浏览器：<script src="engine.js"></script> 后使用 globalThis.CenturyEngine
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；所有动作返回全新 state，不修改入参。
 *   - 随机性只来自 createGame(seed)，AI 完全确定。
 *   - 任何动作都先经过 getLegalMoves 的合法性检查。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CenturyEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CARAVAN_LIMIT = 10;
  var SCORE_CARDS_TO_END = 5;
  var MARKET_SIZE = 6;

  var SPICES = [
    { key: 'turmeric', name: '姜黄', color: '#d9a21b', value: 1 },
    { key: 'saffron', name: '藏红花', color: '#d4553f', value: 2 },
    { key: 'cardamom', name: '豆蔻', color: '#3f8f5b', value: 3 },
    { key: 'cinnamon', name: '肉桂', color: '#8a5a3b', value: 4 }
  ];

  /* 行动卡模板：采集 / 转换 / 升级 */
  var ACTION_TEMPLATES = [
    { key: 'h2y', name: '采集 · 姜黄', text: '获得 2 个姜黄', effect: { type: 'harvest', gain: [2, 0, 0, 0] }, copies: 4 },
    { key: 'h2r', name: '采集 · 藏红花', text: '获得 2 个藏红花', effect: { type: 'harvest', gain: [0, 2, 0, 0] }, copies: 3 },
    { key: 'h1g', name: '采集 · 豆蔻', text: '获得 1 个豆蔻', effect: { type: 'harvest', gain: [0, 0, 1, 0] }, copies: 3 },
    { key: 'h1b', name: '采集 · 肉桂', text: '获得 1 个肉桂', effect: { type: 'harvest', gain: [0, 0, 0, 1] }, copies: 2 },
    { key: 'h1y1r', name: '采集 · 双色', text: '获得 1 姜黄 + 1 藏红花', effect: { type: 'harvest', gain: [1, 1, 0, 0] }, copies: 2 },
    { key: 'h1r1g', name: '采集 · 双色', text: '获得 1 藏红花 + 1 豆蔻', effect: { type: 'harvest', gain: [0, 1, 1, 0] }, copies: 2 },
    { key: 'c3y1r', name: '转换 · 姜黄→藏红花', text: '支付 3 姜黄，获得 1 藏红花', effect: { type: 'convert', cost: [3, 0, 0, 0], gain: [0, 1, 0, 0] }, copies: 4 },
    { key: 'c2r1g', name: '转换 · 藏红花→豆蔻', text: '支付 2 藏红花，获得 1 豆蔻', effect: { type: 'convert', cost: [0, 2, 0, 0], gain: [0, 0, 1, 0] }, copies: 3 },
    { key: 'c3r1b', name: '转换 · 藏红花→肉桂', text: '支付 3 藏红花，获得 1 肉桂', effect: { type: 'convert', cost: [0, 3, 0, 0], gain: [0, 0, 0, 1] }, copies: 2 },
    { key: 'c4y1g', name: '转换 · 姜黄→豆蔻', text: '支付 4 姜黄，获得 1 豆蔻', effect: { type: 'convert', cost: [4, 0, 0, 0], gain: [0, 0, 1, 0] }, copies: 2 },
    { key: 'c2g1b', name: '转换 · 豆蔻→肉桂', text: '支付 2 豆蔻，获得 1 肉桂', effect: { type: 'convert', cost: [0, 0, 2, 0], gain: [0, 0, 0, 1] }, copies: 2 },
    { key: 'c5y1b', name: '转换 · 姜黄→肉桂', text: '支付 5 姜黄，获得 1 肉桂', effect: { type: 'convert', cost: [5, 0, 0, 0], gain: [0, 0, 0, 1] }, copies: 1 },
    { key: 'u1', name: '升级 · 单个', text: '将 1 个香料升级一级', effect: { type: 'upgrade', count: 1 }, copies: 4 },
    { key: 'u2', name: '升级 · 双重', text: '将 2 个香料各升级一级', effect: { type: 'upgrade', count: 2 }, copies: 2 }
  ];

  /* 得分卡模板：cost 按四种香料计 */
  var SCORE_TEMPLATES = [
    { key: 'p3', points: 3, cost: [3, 0, 0, 0] },
    { key: 'p4', points: 4, cost: [0, 2, 1, 0] },
    { key: 'p5', points: 5, cost: [0, 4, 0, 0] },
    { key: 'p6', points: 6, cost: [4, 1, 1, 0] },
    { key: 'p7', points: 7, cost: [0, 0, 2, 1] },
    { key: 'p8', points: 8, cost: [0, 4, 2, 0] },
    { key: 'p9', points: 9, cost: [5, 2, 1, 0] },
    { key: 'p10', points: 10, cost: [0, 0, 4, 1] },
    { key: 'p11', points: 11, cost: [0, 3, 3, 1] },
    { key: 'p12', points: 12, cost: [6, 2, 2, 0] },
    { key: 'p13', points: 13, cost: [0, 0, 0, 3] },
    { key: 'p14', points: 14, cost: [0, 4, 4, 1] },
    { key: 'p15', points: 15, cost: [0, 0, 5, 2] }
  ];

  var STARTING_HAND = ['h2y', 'h2y', 'h2r', 'h1g', 'u1'];

  var ACTION_BY_KEY = {};
  ACTION_TEMPLATES.forEach(function (t) { ACTION_BY_KEY[t.key] = t; });
  var SCORE_BY_KEY = {};
  SCORE_TEMPLATES.forEach(function (t) { SCORE_BY_KEY[t.key] = t; });

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function totalSpices(spices) {
    return spices.reduce(function (sum, n) { return sum + n; }, 0);
  }

  function spiceValue(spices) {
    return spices.reduce(function (sum, n, i) { return sum + n * (i + 1); }, 0);
  }

  function canAfford(spices, cost) {
    for (var i = 0; i < 4; i++) if (spices[i] < cost[i]) return false;
    return true;
  }

  function addVectors(a, b, sign) {
    var out = a.slice();
    for (var i = 0; i < 4; i++) out[i] += (sign || 1) * b[i];
    return out;
  }

  function actionCard(key, id) {
    var t = ACTION_BY_KEY[key];
    return {
      id: id, key: key, name: t.name, text: t.text,
      effect: clone(t.effect), points: 0
    };
  }

  function scoreCard(key, id) {
    var t = SCORE_BY_KEY[key];
    return {
      id: id, key: key, name: t.points + ' 分香料卡', text: '支付对应香料换取 ' + t.points + ' 分',
      effect: null, points: t.points, cost: t.cost.slice()
    };
  }

  function buildActionDeck() {
    var deck = [];
    ACTION_TEMPLATES.forEach(function (t) {
      for (var c = 0; c < t.copies; c++) deck.push(actionCard(t.key, 'a' + deck.length));
    });
    return deck;
  }

  function buildScoreDeck() {
    var deck = [];
    SCORE_TEMPLATES.forEach(function (t) {
      for (var c = 0; c < 2; c++) deck.push(scoreCard(t.key, 'p' + deck.length));
    });
    return deck;
  }

  function playerState(index) {
    return {
      index: index,
      name: index === 0 ? '你' : 'AI 商队',
      spices: [0, 0, 0, 0],
      hand: [],
      played: [],
      scoreCards: [],
      score: 0
    };
  }

  function refillMarket(market, deck) {
    while (market.length < MARKET_SIZE && deck.length) market.push(deck.shift());
    return market;
  }

  function createGame(seed) {
    var actualSeed = seed == null ? 1 : (Number(seed) >>> 0);
    var rng = mulberry32(actualSeed);
    var actionDeck = shuffle(buildActionDeck(), rng);
    var scoreDeck = shuffle(buildScoreDeck(), rng);
    var players = [playerState(0), playerState(1)];

    STARTING_HAND.forEach(function (key, i) {
      players[0].hand.push(actionCard(key, 's0-' + i));
      players[1].hand.push(actionCard(key, 's1-' + i));
    });

    var actionMarket = refillMarket([], actionDeck);
    var scoreMarket = refillMarket([], scoreDeck);

    return {
      seed: actualSeed,
      players: players,
      actionDeck: actionDeck,
      scoreDeck: scoreDeck,
      actionMarket: actionMarket,
      scoreMarket: scoreMarket,
      current: 0,
      turn: 1,
      over: false,
      finalRound: false,
      finalRoundStart: null,
      deadlock: false,
      winner: null,
      log: ['新对局开始，你是先手。']
    };
  }

  function currentPlayer(state) { return state.players[state.current]; }

  function upgradeCombos(spices, count, start, prefix, out) {
    start = start || 0; prefix = prefix || []; out = out || [];
    if (prefix.length === count) { out.push(prefix.slice()); return out; }
    for (var level = start; level <= 2; level++) {
      var need = prefix.filter(function (x) { return x === level; }).length + 1;
      if (spices[level] >= need) {
        prefix.push(level);
        upgradeCombos(spices, count, level, prefix, out);
        prefix.pop();
      }
    }
    return out;
  }

  function canApplyEffect(player, effect) {
    var total = totalSpices(player.spices);
    if (effect.type === 'harvest') {
      var gain = effect.gain.reduce(function (s, n) { return s + n; }, 0);
      return total + gain <= CARAVAN_LIMIT;
    }
    if (effect.type === 'convert') {
      return canAfford(player.spices, effect.cost) &&
        total - effect.cost.reduce(function (s, n) { return s + n; }, 0) +
        effect.gain.reduce(function (s, n) { return s + n; }, 0) <= CARAVAN_LIMIT;
    }
    if (effect.type === 'upgrade') {
      return upgradeCombos(player.spices, effect.count).length > 0;
    }
    return false;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = currentPlayer(state);
    var moves = [];

    player.hand.forEach(function (card, index) {
      var effect = card.effect;
      if (!effect) return;
      if (effect.type === 'upgrade') {
        upgradeCombos(player.spices, effect.count).forEach(function (upgrades) {
          moves.push({ type: 'play', cardIndex: index, upgrades: upgrades });
        });
      } else if (canApplyEffect(player, effect)) {
        moves.push({ type: 'play', cardIndex: index, upgrades: [] });
      }
    });

    if (player.played.length > 0) moves.push({ type: 'rest' });

    state.actionMarket.forEach(function (card, index) {
      moves.push({ type: 'takeCard', marketIndex: index });
    });

    if (player.scoreCards.length < SCORE_CARDS_TO_END) {
      state.scoreMarket.forEach(function (card) {
        if (canAfford(player.spices, card.cost)) moves.push({ type: 'buy', cardId: card.id });
      });
    }
    return moves;
  }

  function moveKey(move) {
    if (!move || typeof move !== 'object') return '';
    if (move.type === 'play') {
      var ups = (move.upgrades || []).slice().sort().join(',');
      return 'play|' + move.cardIndex + '|' + ups;
    }
    if (move.type === 'takeCard') return 'takeCard|' + move.marketIndex;
    if (move.type === 'rest') return 'rest';
    if (move.type === 'buy') return 'buy|' + move.cardId;
    return '';
  }

  function isLegalMove(state, move) {
    var key = moveKey(move);
    if (!key) return false;
    return getLegalMoves(state).some(function (m) { return moveKey(m) === key; });
  }

  function checkGameOver(state) {
    if (state.over) return state;
    if (state.finalRound && state.current === state.finalRoundStart) {
      state.over = true;
      var result = getResults(state);
      state.winner = result.winner;
    }
    return state;
  }

  function advanceTurn(state, message) {
    state.turn += 1;
    state.current = 1 - state.current;
    if (message) state.log.push(message);
    checkGameOver(state);
    if (!state.over && getLegalMoves(state).length === 0) {
      state.deadlock = true;
      state.over = true;
      state.winner = getResults(state).winner;
      state.log.push('双方均无合法动作，对局提前结束。');
    }
    return state;
  }

  function applyEffect(state, player, effect, upgrades) {
    if (effect.type === 'harvest') {
      player.spices = addVectors(player.spices, effect.gain, 1);
    } else if (effect.type === 'convert') {
      player.spices = addVectors(player.spices, effect.cost, -1);
      player.spices = addVectors(player.spices, effect.gain, 1);
    } else if (effect.type === 'upgrade') {
      upgrades.forEach(function (level) {
        player.spices[level] -= 1;
        player.spices[level + 1] += 1;
      });
    }
  }

  function applyMove(state, move) {
    if (!state || state.over) throw new Error('对局已结束');
    if (!isLegalMove(state, move)) throw new Error('非法动作: ' + (moveKey(move) || JSON.stringify(move)));
    var next = clone(state);
    var player = currentPlayer(next);
    var message = '';

    if (move.type === 'play') {
      var card = player.hand[move.cardIndex];
      applyEffect(next, player, card.effect, move.upgrades || []);
      player.hand.splice(move.cardIndex, 1);
      player.played.push(card);
      message = player.name + ' 打出「' + card.name + '」';
      next = advanceTurn(next, message);
    } else if (move.type === 'takeCard') {
      var taken = next.actionMarket.splice(move.marketIndex, 1)[0];
      player.hand.push(taken);
      refillMarket(next.actionMarket, next.actionDeck);
      message = player.name + ' 从市场拿取「' + taken.name + '」';
      next = advanceTurn(next, message);
    } else if (move.type === 'rest') {
      var count = player.played.length;
      player.hand = player.hand.concat(player.played);
      player.played = [];
      message = player.name + ' 休息，取回 ' + count + ' 张行动卡';
      next = advanceTurn(next, message);
    } else if (move.type === 'buy') {
      var at = -1;
      for (var i = 0; i < next.scoreMarket.length; i++) {
        if (next.scoreMarket[i].id === move.cardId) { at = i; break; }
      }
      if (at < 0) throw new Error('得分卡不存在');
      var score = next.scoreMarket[at];
      if (!canAfford(player.spices, score.cost)) throw new Error('香料不足');
      player.spices = addVectors(player.spices, score.cost, -1);
      player.score += score.points;
      player.scoreCards.push(score);
      next.scoreMarket.splice(at, 1);
      refillMarket(next.scoreMarket, next.scoreDeck);
      message = player.name + ' 买下 ' + score.points + ' 分香料卡';
      if (player.scoreCards.length >= SCORE_CARDS_TO_END && !next.finalRound) {
        next.finalRound = true;
        next.finalRoundStart = next.current;
        message += '，触发最后一轮！';
      }
      next = advanceTurn(next, message);
    }
    return next;
  }

  /* ---------------------------- AI ---------------------------- */

  function scoreFit(player, scoreMarket) {
    var best = -Infinity;
    scoreMarket.forEach(function (card) {
      var deficit = 0;
      for (var i = 0; i < 4; i++) {
        deficit += Math.max(0, card.cost[i] - player.spices[i]) * (i + 1);
      }
      var fit = card.points * 4 - deficit;
      if (fit > best) best = fit;
    });
    return best === -Infinity ? 0 : best;
  }

  function positionScore(state, playerIndex) {
    var player = state.players[playerIndex];
    return player.score * 100 +
      player.scoreCards.length * 30 +
      spiceValue(player.spices) * 2 +
      totalSpices(player.spices) * 2 +
      scoreFit(player, state.scoreMarket) +
      player.hand.length * 2;
  }

  function cardUsefulness(card, player) {
    if (!card.effect) return 0;
    var effect = card.effect;
    if (effect.type === 'harvest') {
      return effect.gain.reduce(function (s, n, i) { return s + n * (i + 1); }, 0) * 3;
    }
    if (effect.type === 'convert') {
      var gain = effect.gain.reduce(function (s, n, i) { return s + n * (i + 1); }, 0);
      var cost = effect.cost.reduce(function (s, n, i) { return s + n * (i + 1); }, 0);
      return canAfford(player.spices, effect.cost) ? gain * 3 + 4 : 1;
    }
    if (effect.type === 'upgrade') return 8 * effect.count;
    return 0;
  }

  function chooseAIMove(state) {
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var player = currentPlayer(state);

    var buys = moves.filter(function (m) { return m.type === 'buy'; });
    if (buys.length) {
      var bestBuy = null;
      buys.forEach(function (m) {
        var card = null;
        state.scoreMarket.forEach(function (c) { if (c.id === m.cardId) card = c; });
        if (!card) return;
        if (!bestBuy || card.points > bestBuy.points ||
          (card.points === bestBuy.points && totalSpices(card.cost) < totalSpices(bestBuy.cost))) {
          bestBuy = card;
        }
      });
      if (bestBuy) return { type: 'buy', cardId: bestBuy.id };
    }

    var best = null, bestScore = -Infinity;
    moves.forEach(function (m) {
      if (m.type === 'play' || m.type === 'takeCard' || m.type === 'rest') {
        var next;
        try { next = applyMove(state, m); } catch (e) { return; }
        var value = positionScore(next, state.current);
        if (value > bestScore) { bestScore = value; best = m; }
      }
    });
    if (best) return best;
    return moves[0];
  }

  /* -------------------------- 结算 / 查询 -------------------------- */

  function getResults(state) {
    var scores = state.players.map(function (p) { return p.score; });
    var cards = state.players.map(function (p) { return p.scoreCards.length; });
    var values = state.players.map(function (p) { return spiceValue(p.spices); });
    var bestScore = Math.max(scores[0], scores[1]);
    var candidates = [0, 1].filter(function (i) { return scores[i] === bestScore; });
    if (candidates.length === 2) {
      var bestCards = Math.max(cards[0], cards[1]);
      candidates = candidates.filter(function (i) { return cards[i] === bestCards; });
    }
    if (candidates.length === 2) {
      var bestValue = Math.max(values[0], values[1]);
      candidates = candidates.filter(function (i) { return values[i] === bestValue; });
    }
    return {
      winner: candidates.length === 1 ? candidates[0] : null,
      tie: candidates.length !== 1,
      scores: scores,
      scoreCards: cards,
      spiceValue: values,
      over: !!state.over
    };
  }

  function isGameOver(state) { return !!(state && state.over); }

  return Object.freeze({
    SPICES: SPICES,
    CARAVAN_LIMIT: CARAVAN_LIMIT,
    SCORE_CARDS_TO_END: SCORE_CARDS_TO_END,
    MARKET_SIZE: MARKET_SIZE,
    ACTION_TEMPLATES: ACTION_TEMPLATES,
    SCORE_TEMPLATES: SCORE_TEMPLATES,
    STARTING_HAND: STARTING_HAND,
    createGame: createGame,
    currentPlayer: currentPlayer,
    getLegalMoves: getLegalMoves,
    isLegalMove: isLegalMove,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    totalSpices: totalSpices,
    spiceValue: spiceValue,
    canAfford: canAfford,
    canApplyEffect: canApplyEffect,
    positionScore: positionScore
  });
});
