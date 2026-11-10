/*
 * Century: Spice Road（香料之路）双人规则引擎 — UMD
 *
 * 浏览器：先加载 data.js，再加载 engine.js，使用 globalThis.CenturySpiceRoadEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 规则依据（官方 2024 规则 PDF + 公开牌表）：
 *   - 2 人局：起始手牌 1 张「生产 2 姜黄」+ 1 张「升级 2」；
 *     先手 3 个姜黄，后手 4 个姜黄；商队上限 10。
 *   - 每回合四选一：打出商人卡 / 获取商人卡 / 休息 / 领取得分卡。
 *   - 获取商人卡：左侧每张卡放 1 个任意香料；最左免费；拿走的卡上已有香料归自己。
 *   - 得分卡：支付卡面香料；第 1、2 位分别有金币 / 银币；金币 3 分、银币 1 分。
 *   - 2–3 人局第 6 张得分卡触发最后一轮；结束后金币 3、银币 1、
 *     剩余非姜黄香料每个 1 分；平局时最后行动的玩家获胜。
 *
 * 设计约束：不依赖 DOM；applyMove 不修改入参；随机性只来自 seed。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.CenturySpiceRoadEngine = factory(root.CenturySpiceRoadData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  var SharedShuffle = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('../../shared/shuffle.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Shuffle : null);

  if (!D) throw new Error('缺少 CenturySpiceRoadData：请先加载 data.js');

  var SPICES = D.SPICES;
  var SPICE_KEYS = D.SPICE_KEYS;
  var CARAVAN_LIMIT = 10;
  var MERCHANT_ROW = 6;
  var POINT_ROW = 5;
  var END_SCORE_CARDS = 6;
  var COINS_PER_PLAYER = 2;
  var SPICE_VALUE = [1, 2, 3, 4];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rng) {
    if (!SharedShuffle) throw new Error('缺少 games/shared/shuffle.js：请先加载 shared/shuffle.js');
    return SharedShuffle.shuffle(list, { rng: rng });
  }
  function totalSpices(spices) {
    return spices.reduce(function (sum, n) { return sum + n; }, 0);
  }
  function spiceValue(spices) {
    return spices.reduce(function (sum, n, i) { return sum + n * SPICE_VALUE[i]; }, 0);
  }
  function nonYellowCount(spices) {
    return spices[1] + spices[2] + spices[3];
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
  function oneCube(index) {
    var out = [0, 0, 0, 0];
    out[index] = 1;
    return out;
  }

  function merchantCard(template, id) {
    return {
      id: id,
      key: template.key,
      name: template.name,
      text: template.text,
      effect: clone(template.effect),
      cubes: [0, 0, 0, 0]
    };
  }
  function pointCard(source, id) {
    return {
      id: id,
      key: source.id,
      points: source.points,
      cost: source.cost.slice(),
      name: source.points + ' 分香料卡'
    };
  }
  function buildMerchantDeck(seed) {
    var rng = mulberry32(seed ^ 0x51ed270b);
    var deck = [];
    D.MERCHANT_TEMPLATES.forEach(function (template) {
      for (var i = 0; i < template.copies; i++) {
        deck.push(merchantCard(template, 'm' + deck.length));
      }
    });
    return shuffle(deck, rng);
  }
  function buildPointDeck(seed) {
    var rng = mulberry32(seed ^ 0x2f6e2b1);
    return shuffle(D.POINT_CARDS.map(function (source, index) {
      return pointCard(source, 'p' + index);
    }), rng);
  }
  function refillMerchant(state) {
    while (state.merchantMarket.length < MERCHANT_ROW && state.merchantDeck.length) {
      state.merchantMarket.push(state.merchantDeck.shift());
    }
  }
  function refillPoints(state) {
    while (state.pointMarket.length < POINT_ROW && state.pointDeck.length) {
      state.pointMarket.push(state.pointDeck.shift());
    }
  }
  function createPlayer(index, name, isAI, startYellow) {
    var spices = [0, 0, 0, 0];
    spices[0] = startYellow;
    var hand = D.STARTING_CARDS.map(function (template, i) {
      return merchantCard(template, 's' + index + '-' + i);
    });
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      spices: spices,
      hand: hand,
      played: [],
      scoreCards: [],
      gold: 0,
      silver: 0
    };
  }

  function createGame(seed) {
    var actualSeed = seed == null ? 1 : (Number(seed) >>> 0);
    var rng = mulberry32(actualSeed);
    var firstPlayer = rng() < 0.5 ? 0 : 1;
    var startCubes = firstPlayer === 0 ? [3, 4] : [4, 3];
    var players = [
      createPlayer(0, '你', false, startCubes[0]),
      createPlayer(1, 'AI 商队', true, startCubes[1])
    ];
    var state = {
      seed: actualSeed,
      players: players,
      merchantDeck: buildMerchantDeck(actualSeed),
      pointDeck: buildPointDeck(actualSeed),
      merchantMarket: [],
      pointMarket: [],
      coins: { gold: COINS_PER_PLAYER * 2, silver: COINS_PER_PLAYER * 2 },
      firstPlayer: firstPlayer,
      current: firstPlayer,
      turn: 1,
      lastPlayer: null,
      finalRound: false,
      finalRoundBy: null,
      over: false,
      overReason: null,
      result: null,
      log: []
    };
    refillMerchant(state);
    refillPoints(state);
    appendLog(state, null, 'start', '新开一局（种子 ' + actualSeed + '）：' + players[firstPlayer].name +
      ' 先手；起始手牌为「生产 2 姜黄」与「升级 2」；商队上限 10。');
    return state;
  }

  function appendLog(state, player, type, text) {
    state.log.push({ turn: state.turn, player: player, type: type, text: text });
    if (state.log.length > 180) state.log.splice(0, state.log.length - 180);
  }

  /* --------------------------- 升级组合 --------------------------- */

  function upgradeSequences(spices, count) {
    var out = [];
    var seen = Object.create(null);
    function rec(counts, seq) {
      if (seq.length === count) {
        var key = seq.join(',');
        if (!seen[key]) { seen[key] = true; out.push(seq.slice()); }
        return;
      }
      for (var level = 0; level <= 2; level++) {
        if (counts[level] <= 0) continue;
        var next = counts.slice();
        next[level] -= 1;
        next[level + 1] += 1;
        seq.push(level);
        rec(next, seq);
        seq.pop();
      }
    }
    rec(spices.slice(), []);
    return out;
  }
  function applyUpgrades(spices, sequence) {
    var out = spices.slice();
    sequence.slice().sort(function (a, b) { return a - b; }).forEach(function (level) {
      out[level] -= 1;
      out[level + 1] += 1;
    });
    return out;
  }
  function canApplyEffect(player, effect, upgrades) {
    if (effect.type === 'create') return true;
    if (effect.type === 'trade') return canAfford(player.spices, effect.cost);
    if (effect.type === 'upgrade') {
      if (!Array.isArray(upgrades) || upgrades.length !== effect.count) return false;
      return upgradeSequences(player.spices, effect.count).some(function (seq) {
        return seq.join(',') === upgrades.slice().sort().join(',');
      });
    }
    return false;
  }
  function applyEffect(player, effect, upgrades) {
    if (effect.type === 'create') {
      player.spices = addVectors(player.spices, effect.gain, 1);
    } else if (effect.type === 'trade') {
      player.spices = addVectors(player.spices, effect.cost, -1);
      player.spices = addVectors(player.spices, effect.gain, 1);
    } else if (effect.type === 'upgrade') {
      player.spices = applyUpgrades(player.spices, upgrades);
    }
  }
  function trimCaravan(state, player) {
    var returned = [0, 0, 0, 0];
    while (totalSpices(player.spices) > CARAVAN_LIMIT) {
      var level = 0;
      while (level < 3 && player.spices[level] <= 0) level++;
      if (level > 3) break;
      player.spices[level] -= 1;
      returned[level] += 1;
    }
    if (returned.some(function (n) { return n > 0; })) {
      appendLog(state, player.index, 'trim', player.name + ' 商队超过 10 个，退回 ' +
        returned.map(function (n, i) { return n ? SPICES[i].name + n : ''; }).filter(Boolean).join('、') + '。');
    }
  }

  /* --------------------------- 支付 / 获取 --------------------------- */

  function defaultPayment(player, count) {
    var remaining = player.spices.slice();
    var payment = [];
    for (var slot = 0; slot < count; slot++) {
      var level = 0;
      while (level < 4 && remaining[level] <= 0) level++;
      if (level >= 4) return null;
      remaining[level] -= 1;
      payment.push(oneCube(level));
    }
    return payment;
  }
  function validatePayment(player, count, payment) {
    if (count === 0) return { ok: true, payment: [] };
    if (!Array.isArray(payment) || payment.length !== count) {
      return { ok: false, reason: '需要为左侧每张商人卡各支付 1 个香料' };
    }
    var need = [0, 0, 0, 0];
    for (var i = 0; i < payment.length; i++) {
      var vector = payment[i];
      if (!Array.isArray(vector) || vector.length !== 4) return { ok: false, reason: '支付向量非法' };
      var sum = 0;
      for (var j = 0; j < 4; j++) {
        if (vector[j] < 0 || !Number.isInteger(vector[j])) return { ok: false, reason: '支付数量必须是整数' };
        sum += vector[j];
        need[j] += vector[j];
      }
      if (sum !== 1) return { ok: false, reason: '每张左侧商人卡只能放 1 个香料' };
    }
    if (!canAfford(player.spices, need)) return { ok: false, reason: '香料不足以支付获取费用' };
    return { ok: true, payment: payment, need: need };
  }
  function paymentFor(player, count, payment) {
    if (payment) return validatePayment(player, count, payment);
    var d = defaultPayment(player, count);
    return d ? { ok: true, payment: d } : { ok: false, reason: '香料不足以支付获取费用' };
  }

  /* --------------------------- 回合动作 --------------------------- */

  function findPoint(state, cardId) {
    for (var i = 0; i < state.pointMarket.length; i++) {
      if (state.pointMarket[i].id === cardId) return { card: state.pointMarket[i], index: i };
    }
    return null;
  }

  function takeCoin(state, player, pointIndex) {
    if (pointIndex === 0) {
      if (state.coins.gold > 0) {
        state.coins.gold -= 1;
        player.gold += 1;
        return '金币';
      }
      if (state.coins.silver > 0) {
        state.coins.silver -= 1;
        player.silver += 1;
        return '银币';
      }
    } else if (pointIndex === 1 && state.coins.gold > 0 && state.coins.silver > 0) {
      state.coins.silver -= 1;
      player.silver += 1;
      return '银币';
    }
    return null;
  }

  function moveKey(move) {
    if (!move || typeof move !== 'object') return '';
    if (move.type === 'play') return 'play|' + move.cardIndex + '|' + (move.upgrades || []).join(',');
    if (move.type === 'acquire') return 'acquire|' + move.marketIndex + '|' + JSON.stringify(move.payment || null);
    if (move.type === 'rest') return 'rest';
    if (move.type === 'claim') return 'claim|' + move.cardId;
    return '';
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = state.players[state.current];
    var moves = [];

    player.hand.forEach(function (card, index) {
      var effect = card.effect;
      if (effect.type === 'upgrade') {
        upgradeSequences(player.spices, effect.count).forEach(function (sequence) {
          moves.push({ type: 'play', cardIndex: index, upgrades: sequence.slice() });
        });
      } else if (canApplyEffect(player, effect, [])) {
        moves.push({ type: 'play', cardIndex: index, upgrades: [] });
      }
    });

    state.merchantMarket.forEach(function (card, index) {
      var pay = paymentFor(player, index, null);
      if (pay.ok) moves.push({ type: 'acquire', marketIndex: index, payment: pay.payment });
    });

    if (player.played.length > 0) moves.push({ type: 'rest' });

    state.pointMarket.forEach(function (card) {
      if (canAfford(player.spices, card.cost)) moves.push({ type: 'claim', cardId: card.id });
    });
    return moves;
  }

  function validateMove(state, move) {
    if (!state || state.over) return { ok: false, reason: '对局已结束' };
    if (!move || typeof move !== 'object') return { ok: false, reason: '动作非法' };
    var player = state.players[state.current];
    if (move.type === 'play') {
      var card = player.hand[move.cardIndex];
      if (!card) return { ok: false, reason: '手牌不存在' };
      if (!canApplyEffect(player, card.effect, move.upgrades || [])) {
        return { ok: false, reason: '无法应用这张商人卡的效果' };
      }
      return { ok: true };
    }
    if (move.type === 'acquire') {
      if (!Number.isInteger(move.marketIndex) || move.marketIndex < 0 ||
          move.marketIndex >= state.merchantMarket.length) return { ok: false, reason: '商人卡不存在' };
      var pay = paymentFor(player, move.marketIndex, move.payment);
      if (!pay.ok) return { ok: false, reason: pay.reason };
      return { ok: true, payment: pay.payment };
    }
    if (move.type === 'rest') {
      if (!player.played.length) return { ok: false, reason: '没有已打出的商人卡可以收回' };
      return { ok: true };
    }
    if (move.type === 'claim') {
      var found = findPoint(state, move.cardId);
      if (!found) return { ok: false, reason: '得分卡不存在' };
      if (!canAfford(player.spices, found.card.cost)) return { ok: false, reason: '香料不足' };
      return { ok: true };
    }
    return { ok: false, reason: '未知动作类型' };
  }

  function computeResults(state, reason) {
    var rows = state.players.map(function (player) {
      var points = player.scoreCards.reduce(function (sum, card) { return sum + card.points; }, 0);
      var coins = player.gold * 3 + player.silver * 1;
      var cubes = nonYellowCount(player.spices);
      return {
        index: player.index,
        name: player.name,
        isAI: !!player.isAI,
        points: points,
        gold: player.gold,
        silver: player.silver,
        coins: coins,
        cubes: cubes,
        total: points + coins + cubes,
        scoreCards: player.scoreCards.length
      };
    });
    var winner = null;
    if (rows[0].total !== rows[1].total) {
      winner = rows[0].total > rows[1].total ? 0 : 1;
    } else if (state.lastPlayer !== null) {
      winner = state.lastPlayer;
    }
    return {
      reason: reason || state.overReason,
      scores: rows,
      winner: winner,
      tieBreak: winner === null ? '总分相同且无法判定行动顺序，平局' :
        (rows[0].total === rows[1].total ? '总分相同，最后行动的玩家获胜' : null)
    };
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    state.result = computeResults(state, reason);
    appendLog(state, null, 'end', '对局结束：' + reason + '；' +
      (state.result.winner === null ? '平局' : state.players[state.result.winner].name + ' 获胜') + '。');
    return state;
  }

  function advanceTurn(state, message) {
    if (message) appendLog(state, state.current, 'turn', message);
    state.lastPlayer = state.current;
    state.turn += 1;
    state.current = 1 - state.current;
    if (state.finalRound && state.current === state.finalRoundBy) {
      return finishGame(state, '最后一轮结束');
    }
    if (getLegalMoves(state).length === 0) {
      return finishGame(state, '双方均无合法动作');
    }
    return state;
  }

  function applyMove(state, move) {
    var check = validateMove(state, move);
    if (!check.ok) throw new Error(check.reason || '非法动作');
    var next = clone(state);
    var player = next.players[next.current];
    var message = '';

    if (move.type === 'play') {
      var card = player.hand[move.cardIndex];
      applyEffect(player, card.effect, move.upgrades || []);
      player.hand.splice(move.cardIndex, 1);
      player.played.push(card);
      trimCaravan(next, player);
      message = player.name + ' 打出「' + card.name + '」' +
        (card.effect.type === 'upgrade' && move.upgrades.length ? '（升级 ' +
          move.upgrades.map(function (level) { return SPICES[level].short + '→' + SPICES[level + 1].short; }).join('、') + '）' : '');
    } else if (move.type === 'acquire') {
      var payment = check.payment || paymentFor(player, move.marketIndex, move.payment).payment;
      for (var i = 0; i < payment.length; i++) {
        player.spices = addVectors(player.spices, payment[i], -1);
        next.merchantMarket[i].cubes = addVectors(next.merchantMarket[i].cubes, payment[i], 1);
      }
      var taken = next.merchantMarket.splice(move.marketIndex, 1)[0];
      player.spices = addVectors(player.spices, taken.cubes, 1);
      taken.cubes = [0, 0, 0, 0];
      trimCaravan(next, player);
      player.hand.push(taken);
      refillMerchant(next);
      message = player.name + ' 获取商人卡「' + taken.name + '」' +
        (move.marketIndex ? '（向左侧 ' + move.marketIndex + ' 张卡各放 1 个香料）' : '（最左免费）');
    } else if (move.type === 'rest') {
      var count = player.played.length;
      player.hand = player.hand.concat(player.played);
      player.played = [];
      message = player.name + ' 休息，取回 ' + count + ' 张行动卡';
    } else if (move.type === 'claim') {
      var found = findPoint(next, move.cardId);
      var point = found.card;
      player.spices = addVectors(player.spices, point.cost, -1);
      player.scoreCards.push(point);
      var coin = takeCoin(next, player, found.index);
      next.pointMarket.splice(found.index, 1);
      refillPoints(next);
      message = player.name + ' 领取 ' + point.points + ' 分香料卡' +
        (coin ? '，获得 1 枚' + coin : '');
      if (player.scoreCards.length >= END_SCORE_CARDS && !next.finalRound) {
        next.finalRound = true;
        next.finalRoundBy = next.current;
        appendLog(next, next.current, 'final', '第 6 张得分卡出现，完成本轮后结算。');
      }
    }
    return advanceTurn(next, message);
  }

  function currentPlayer(state) {
    return state.players[state.current];
  }
  function isGameOver(state) { return !!(state && state.over); }
  function getResults(state) {
    return state && state.over ? state.result : null;
  }

  /* ----------------------------- AI ----------------------------- */

  function positionScore(state, playerIndex) {
    var player = state.players[playerIndex];
    var points = player.scoreCards.reduce(function (sum, card) { return sum + card.points; }, 0);
    var bestClaim = 0;
    state.pointMarket.forEach(function (card) {
      var deficit = 0;
      for (var i = 0; i < 4; i++) deficit += Math.max(0, card.cost[i] - player.spices[i]) * SPICE_VALUE[i];
      var fit = card.points * 4 - deficit;
      if (fit > bestClaim) bestClaim = fit;
    });
    return points * 100 + player.scoreCards.length * 30 + player.gold * 30 + player.silver * 10 +
      spiceValue(player.spices) * 2 + totalSpices(player.spices) * 2 +
      player.hand.length * 2 + bestClaim;
  }

  function chooseAIMove(state) {
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var best = null, bestScore = -Infinity;
    moves.forEach(function (move) {
      var next;
      try { next = applyMove(state, move); } catch (error) { return; }
      var score = positionScore(next, state.current);
      // 领取得分卡有终局价值，略微加权。
      if (move.type === 'claim') score += 40;
      if (score > bestScore + 1e-9) { bestScore = score; best = move; }
    });
    return best || moves[0];
  }

  return Object.freeze({
    SPICES: SPICES,
    SPICE_KEYS: SPICE_KEYS,
    CARAVAN_LIMIT: CARAVAN_LIMIT,
    MERCHANT_ROW: MERCHANT_ROW,
    POINT_ROW: POINT_ROW,
    END_SCORE_CARDS: END_SCORE_CARDS,
    COINS_PER_PLAYER: COINS_PER_PLAYER,
    POINT_CARDS: D.POINT_CARDS,
    MERCHANT_TEMPLATES: D.MERCHANT_TEMPLATES,
    STARTING_CARDS: D.STARTING_CARDS,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    validateMove: validateMove,
    applyMove: applyMove,
    moveKey: moveKey,
    chooseAIMove: chooseAIMove,
    currentPlayer: currentPlayer,
    isGameOver: isGameOver,
    getResults: getResults,
    computeResults: computeResults,
    totalSpices: totalSpices,
    spiceValue: spiceValue,
    nonYellowCount: nonYellowCount,
    canAfford: canAfford,
    canApplyEffect: canApplyEffect,
    upgradeSequences: upgradeSequences,
    defaultPayment: defaultPayment,
    validatePayment: validatePayment,
    positionScore: positionScore
  });
});
