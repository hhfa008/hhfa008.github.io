/*
 * Splendor（璀璨宝石）双人规则引擎 — UMD
 *
 * 浏览器：先加载 data.js，再加载 engine.js，使用 globalThis.SplendorEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 规则依据（公开文字规则与牌表）：
 *   - 2 人局：每色宝石 4 枚、黄金 5 枚、贵族 3 张、每级亮出 4 张发展卡。
 *   - 90 张发展卡：一级 40、二级 30、三级 20；贵族 10 选 3。
 *   - 行动：拿 3 种不同颜色各 1 枚；拿 2 枚同色（库存至少 4）；
 *     预留 1 张发展卡（场上或牌堆顶）并拿 1 枚黄金；购买 1 张发展卡。
 *   - 筹码上限 10；预留上限 3；先到 15 声望触发本轮结束。
 *   - 平局先比发展卡数量，少者胜。
 *
 * 设计约束：
 *   - 不依赖 DOM；applyMove 返回全新 state，不修改入参。
 *   - 所有随机性来自 createGame 的 seed（mulberry32），引擎内不使用随机函数。
 *   - AI 只从 getLegalMoves 的返回值里挑选动作。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.SplendorEngine = factory(root.SplendorData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  var SharedShuffle = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('../../shared/shuffle.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Shuffle : null);

  if (!D) throw new Error('缺少 SplendorData：请先加载 data.js');

  var COLORS = D.COLOR_KEYS;
  var COLOR_BY_KEY = D.COLOR_BY_KEY;
  var TOKEN_LIMIT = 10;
  var RESERVE_LIMIT = 3;
  var FACE_UP_PER_TIER = 4;
  var WIN_PRESTIGE = 15;
  var START_GEMS = 4;
  var START_GOLD = 5;
  var NOBLE_COUNT = 3;

  var CARD_CATALOG = D.CARDS.map(function (card) { return card; });
  var NOBLE_CATALOG = D.NOBLES;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

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

  function emptyTokens() {
    var tokens = {};
    COLORS.forEach(function (color) { tokens[color] = 0; });
    tokens.gold = 0;
    return tokens;
  }

  function emptyBonuses() {
    var bonuses = {};
    COLORS.forEach(function (color) { bonuses[color] = 0; });
    return bonuses;
  }

  function createPlayer(index, name, isAI) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      tokens: emptyTokens(),
      bonuses: emptyBonuses(),
      prestige: 0,
      cards: [],
      reserved: [],
      nobles: 0
    };
  }

  function tokenTotal(player) {
    var total = player.tokens.gold || 0;
    COLORS.forEach(function (color) { total += player.tokens[color] || 0; });
    return total;
  }

  function cardCostTotal(card) {
    var total = 0;
    COLORS.forEach(function (color) { total += card.cost[color] || 0; });
    return total;
  }

  function buildDecks(seed) {
    var rng = mulberry32(seed);
    var decks = { 1: [], 2: [], 3: [] };
    var faceUp = { 1: [], 2: [], 3: [] };
    [1, 2, 3].forEach(function (tier) {
      var cards = CARD_CATALOG.filter(function (card) { return card.tier === tier; })
        .map(function (card) { return clone(card); });
      decks[tier] = shuffle(cards, rng);
      for (var i = 0; i < FACE_UP_PER_TIER; i++) {
        faceUp[tier].push(decks[tier].length ? decks[tier].shift() : null);
      }
    });
    return { decks: decks, faceUp: faceUp };
  }

  function createGame(options) {
    var opts = {};
    if (typeof options === 'number') opts.seed = options;
    else if (options && typeof options === 'object') opts = options;
    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    var aiPlayer = opts.aiPlayer == null ? 1 : opts.aiPlayer;
    var names = opts.names || ['你', 'AI 对手'];
    var dealt = buildDecks(seed);
    var players = [
      createPlayer(0, names[0] || '你', aiPlayer === 0),
      createPlayer(1, names[1] || 'AI 对手', aiPlayer === 1)
    ];
    var gems = {};
    COLORS.forEach(function (color) { gems[color] = START_GEMS; });
    gems.gold = START_GOLD;

    var rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    var noblePool = NOBLE_CATALOG.map(function (noble) {
      return { id: noble.id, name: noble.name, points: noble.points, need: clone(noble.need), claimedBy: null };
    });
    shuffle(noblePool, rng);
    var nobles = noblePool.slice(0, NOBLE_COUNT);

    return {
      seed: seed,
      players: players,
      gems: gems,
      decks: dealt.decks,
      faceUp: dealt.faceUp,
      nobles: nobles,
      current: 0,
      round: 1,
      turn: 1,
      over: false,
      overReason: null,
      result: null,
      endgameTriggered: false,
      endgameBy: null,
      log: [{
        turn: 0,
        round: 1,
        player: null,
        type: 'start',
        text: '新开一局（种子 ' + seed + '）：2 人各 4 枚五色宝石与 5 枚黄金；先到 15 声望触发最后一轮。'
      }]
    };
  }

  function appendLog(state, playerIndex, type, text) {
    state.log.push({
      turn: state.turn,
      round: state.round,
      player: playerIndex,
      type: type,
      text: text
    });
    if (state.log.length > 180) state.log.splice(0, state.log.length - 180);
  }

  function findFaceUp(state, cardId) {
    for (var tier = 1; tier <= 3; tier++) {
      var row = state.faceUp[tier] || [];
      for (var i = 0; i < row.length; i++) {
        if (row[i] && row[i].id === cardId) return { card: row[i], tier: tier, index: i };
      }
    }
    return null;
  }

  function findReserved(player, cardId) {
    for (var i = 0; i < player.reserved.length; i++) {
      if (player.reserved[i].id === cardId) return { card: player.reserved[i], index: i };
    }
    return null;
  }

  function refillFaceUp(state, tier, index) {
    var deck = state.decks[tier] || [];
    state.faceUp[tier][index] = deck.length ? deck.shift() : null;
  }

  function paymentForCard(state, playerIndex, card) {
    var player = state.players[playerIndex];
    var colored = {};
    var gold = 0;
    var need = 0;
    COLORS.forEach(function (color) {
      var deficit = Math.max(0, (card.cost[color] || 0) - player.bonuses[color]);
      var paid = Math.min(deficit, player.tokens[color] || 0);
      colored[color] = paid;
      need += deficit;
      gold += deficit - paid;
    });
    return {
      ok: (player.tokens.gold || 0) >= gold,
      colored: colored,
      gold: gold,
      need: need,
      shortfall: Math.max(0, gold - (player.tokens.gold || 0))
    };
  }

  function canBuyCard(state, playerIndex, cardId) {
    var player = state.players[playerIndex];
    if (!player) return false;
    var loc = findFaceUp(state, cardId);
    if (!loc) loc = findReserved(player, cardId);
    return !!loc && paymentForCard(state, playerIndex, loc.card).ok;
  }

  function combinations(list, size) {
    var out = [];
    var pick = [];
    function walk(start) {
      if (pick.length === size) { out.push(pick.slice()); return; }
      for (var i = start; i < list.length; i++) {
        pick.push(list[i]);
        walk(i + 1);
        pick.pop();
      }
    }
    walk(0);
    return out;
  }

  function getLegalMoves(state, playerIndex) {
    if (!state || state.over) return [];
    var pi = playerIndex == null ? state.current : playerIndex;
    var player = state.players[pi];
    if (!player) throw new Error('玩家索引非法');
    var moves = [];

    [1, 2, 3].forEach(function (tier) {
      (state.faceUp[tier] || []).forEach(function (card) {
        if (!card) return;
        if (paymentForCard(state, pi, card).ok) {
          moves.push({ type: 'buy', cardId: card.id, player: pi, source: 'faceUp' });
        }
      });
    });
    player.reserved.forEach(function (card) {
      if (paymentForCard(state, pi, card).ok) {
        moves.push({ type: 'buy', cardId: card.id, player: pi, source: 'reserved' });
      }
    });

    if (player.reserved.length < RESERVE_LIMIT) {
      [1, 2, 3].forEach(function (tier) {
        (state.faceUp[tier] || []).forEach(function (card) {
          if (card) moves.push({ type: 'reserve', cardId: card.id, player: pi, source: 'faceUp' });
        });
        if ((state.decks[tier] || []).length) {
          moves.push({ type: 'reserve', tier: tier, player: pi, source: 'deck' });
        }
      });
    }

    var capacity = TOKEN_LIMIT - tokenTotal(player);
    var available = COLORS.filter(function (color) { return state.gems[color] > 0; });
    if (capacity > 0 && available.length) {
      var size = Math.min(3, available.length, capacity);
      combinations(available, size).forEach(function (colors) {
        moves.push({ type: 'take3', colors: colors.slice(), player: pi });
      });
    }

    if (capacity >= 2) {
      COLORS.forEach(function (color) {
        if (state.gems[color] >= 4) {
          moves.push({ type: 'take2', color: color, player: pi });
        }
      });
    }

    return moves;
  }

  function assertCurrent(state, move) {
    if (state.over) throw new Error('对局已结束');
    if (!move || !move.type) throw new Error('动作非法');
    var pi = state.current;
    if (move.player != null && move.player !== pi) throw new Error('还没轮到这位玩家');
    return pi;
  }

  function takeThree(next, pi, move) {
    var player = next.players[pi];
    if (!Array.isArray(move.colors) || !move.colors.length) {
      throw new Error('拿取行动需要提供颜色列表');
    }
    var unique = [];
    move.colors.forEach(function (color) {
      if (COLORS.indexOf(color) < 0) throw new Error('未知宝石颜色：' + color);
      if (unique.indexOf(color) >= 0) throw new Error('拿取行动不能重复颜色');
      unique.push(color);
    });
    var available = COLORS.filter(function (color) { return next.gems[color] > 0; });
    var capacity = TOKEN_LIMIT - tokenTotal(player);
    var expected = Math.min(3, available.length, capacity);
    if (unique.length !== expected) {
      throw new Error(available.length < 3 ? '筹码不足，只能拿取剩下的不同颜色' :
        (capacity < 3 ? '筹码上限为 10 枚，只能拿取 ' + capacity + ' 枚' : '必须拿取 3 种不同颜色'));
    }
    unique.forEach(function (color) {
      if (next.gems[color] <= 0) throw new Error(COLOR_BY_KEY[color].label + '筹码已用尽');
    });
    if (tokenTotal(player) + unique.length > TOKEN_LIMIT) {
      throw new Error('筹码上限为 10 枚，无法继续拿取');
    }
    unique.forEach(function (color) {
      next.gems[color] -= 1;
      player.tokens[color] += 1;
    });
    appendLog(next, pi, 'take3', player.name + ' 拿取 ' +
      unique.map(function (color) { return COLOR_BY_KEY[color].label; }).join('、') +
      ' 各 1 枚宝石筹码。');
  }

  function takeTwo(next, pi, move) {
    var player = next.players[pi];
    var color = move.color;
    if (COLORS.indexOf(color) < 0) throw new Error('未知宝石颜色：' + color);
    if (next.gems[color] < 4) throw new Error('只有该色库存至少 4 枚时才能拿 2 枚同色');
    if (tokenTotal(player) + 2 > TOKEN_LIMIT) {
      throw new Error('筹码上限为 10 枚，无法继续拿取');
    }
    next.gems[color] -= 2;
    player.tokens[color] += 2;
    appendLog(next, pi, 'take2', player.name + ' 拿取 2 枚' + COLOR_BY_KEY[color].label + '筹码。');
  }

  function reserveCard(next, pi, move) {
    var player = next.players[pi];
    if (player.reserved.length >= RESERVE_LIMIT) throw new Error('预留区最多 3 张卡');
    var card = null;
    if (move.source === 'deck') {
      if (!move.tier || !next.decks[move.tier] || !next.decks[move.tier].length) {
        throw new Error('该等级牌堆已空');
      }
      card = next.decks[move.tier].shift();
      appendLog(next, pi, 'reserve', player.name + ' 从 ' + move.tier + ' 级牌堆顶盲抽并预留 1 张发展卡。');
    } else {
      var loc = findFaceUp(next, move.cardId);
      if (!loc) throw new Error('该卡不在场上');
      card = loc.card;
      next.faceUp[loc.tier][loc.index] = null;
      refillFaceUp(next, loc.tier, loc.index);
      appendLog(next, pi, 'reserve', player.name + ' 预留「' + card.name + '」。');
    }
    player.reserved.push(card);

    if (next.gems.gold > 0 && tokenTotal(player) < TOKEN_LIMIT) {
      next.gems.gold -= 1;
      player.tokens.gold += 1;
      appendLog(next, pi, 'gold', player.name + ' 获得 1 枚黄金。');
    } else if (next.gems.gold <= 0) {
      appendLog(next, null, 'gold', '黄金已用尽，本次预留没有黄金。');
    } else {
      appendLog(next, null, 'gold', '筹码已满，本次预留没有黄金。');
    }
  }

  function nobleRequirementsMet(player, noble) {
    return Object.keys(noble.need).every(function (color) {
      return (player.bonuses[color] || 0) >= noble.need[color];
    });
  }

  function claimNoble(next, pi) {
    var player = next.players[pi];
    for (var i = 0; i < next.nobles.length; i++) {
      var noble = next.nobles[i];
      if (noble.claimedBy !== null) continue;
      if (nobleRequirementsMet(player, noble)) {
        noble.claimedBy = pi;
        player.prestige += noble.points;
        player.nobles += 1;
        appendLog(next, pi, 'noble', '贵族「' + noble.name + '」到访' + player.name +
          '，获得 ' + noble.points + ' 声望。');
        return noble;
      }
    }
    return null;
  }

  function buyCard(next, pi, move) {
    var player = next.players[pi];
    var loc = findFaceUp(next, move.cardId);
    var source = 'faceUp';
    if (!loc) {
      loc = findReserved(player, move.cardId);
      source = 'reserved';
    }
    if (!loc) throw new Error('该卡不在场上或你的预留区');
    var card = loc.card;
    var payment = paymentForCard(next, pi, card);
    if (!payment.ok) {
      throw new Error('筹码不足：还需要 ' + payment.shortfall + ' 枚黄金');
    }

    COLORS.forEach(function (color) {
      player.tokens[color] -= payment.colored[color];
      next.gems[color] += payment.colored[color];
    });
    player.tokens.gold -= payment.gold;
    next.gems.gold += payment.gold;

    if (source === 'faceUp') {
      next.faceUp[loc.tier][loc.index] = null;
      refillFaceUp(next, loc.tier, loc.index);
    } else {
      player.reserved.splice(loc.index, 1);
    }

    player.cards.push(card);
    player.bonuses[card.bonus] += 1;
    player.prestige += card.points;

    var paid = [];
    COLORS.forEach(function (color) {
      if (payment.colored[color] > 0) {
        paid.push(COLOR_BY_KEY[color].label + payment.colored[color]);
      }
    });
    if (payment.gold > 0) paid.push('金' + payment.gold);
    appendLog(next, pi, 'buy', player.name + ' 购买「' + card.name + '」' +
      (card.points ? '，获得 ' + card.points + ' 声望' : '') +
      '（支付 ' + (paid.length ? paid.join('、') : '永久折扣抵扣') + '）。');

    claimNoble(next, pi);
    if (player.prestige >= WIN_PRESTIGE && !next.endgameTriggered) {
      next.endgameTriggered = true;
      next.endgameBy = pi;
      appendLog(next, null, 'endgame', '有人达到 15 声望，当前轮结束后结算。');
    }
  }

  function getScoreboard(state) {
    return state.players.map(function (player) {
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        prestige: player.prestige,
        cards: player.cards.length,
        reserved: player.reserved.length,
        nobles: player.nobles,
        tokens: tokenTotal(player)
      };
    });
  }

  function determineWinner(scores) {
    var best = scores.slice().sort(function (a, b) {
      return (b.prestige - a.prestige) || (a.cards - b.cards) || (a.index - b.index);
    });
    if (best[0].prestige === best[1].prestige && best[0].cards === best[1].cards) return null;
    return best[0].index;
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    var scores = getScoreboard(state);
    var winner = determineWinner(scores);
    state.result = { reason: reason, winner: winner, scores: scores };
    appendLog(state, null, 'end', '对局结束：' + reason + '；' +
      (winner === null ? '双方战平' : state.players[winner].name + ' 获胜') + '。');
    return state;
  }

  function commitMove(next, pi) {
    next.turn += 1;
    next.current = 1 - pi;
    next.round = Math.floor((next.turn - 1) / 2) + 1;

    if (next.endgameTriggered && pi === 1) {
      return finishGame(next, '有人达到 15 声望，本轮结束');
    }
    if (!next.over && getLegalMoves(next).length === 0) {
      return finishGame(next, '没有可执行的动作');
    }
    return next;
  }

  function applyMove(state, move) {
    if (!state || typeof state !== 'object') throw new Error('局面不存在');
    var next = clone(state);
    var pi = assertCurrent(next, move);
    if (move.type === 'take3') takeThree(next, pi, move);
    else if (move.type === 'take2') takeTwo(next, pi, move);
    else if (move.type === 'reserve') reserveCard(next, pi, move);
    else if (move.type === 'buy') buyCard(next, pi, move);
    else throw new Error('未知动作类型：' + move.type);
    return commitMove(next, pi);
  }

  function currentPlayer(state) {
    return state.current;
  }

  function getPlayer(state, index) {
    var player = state.players[index];
    if (!player) throw new Error('玩家索引非法');
    return player;
  }

  function isGameOver(state) {
    return !!(state && state.over);
  }

  function getResults(state) {
    var scores = getScoreboard(state);
    return {
      over: !!state.over,
      reason: state.overReason,
      winner: state.over ? determineWinner(scores) : null,
      scores: scores,
      result: state.result || null
    };
  }

  function cardForMove(state, pi, move) {
    var player = state.players[pi];
    var loc = findFaceUp(state, move.cardId);
    if (!loc) loc = findReserved(player, move.cardId);
    return loc ? loc.card : null;
  }

  function nobleColorValue(state, player, color) {
    var value = 0;
    state.nobles.forEach(function (noble) {
      if (noble.claimedBy !== null) return;
      var need = noble.need[color] || 0;
      var have = player.bonuses[color] || 0;
      if (need > have) value += (need - have === 1 ? 24 : 12);
    });
    return value;
  }

  function wouldCompleteNoble(state, player, card) {
    var nextBonuses = {};
    COLORS.forEach(function (color) {
      nextBonuses[color] = player.bonuses[color] + (color === card.bonus ? 1 : 0);
    });
    return state.nobles.some(function (noble) {
      if (noble.claimedBy !== null) return false;
      return Object.keys(noble.need).every(function (color) {
        return nextBonuses[color] >= noble.need[color];
      });
    });
  }

  function colorDemand(state, player) {
    var demand = {};
    COLORS.forEach(function (color) { demand[color] = 0; });
    var targets = [];
    [1, 2, 3].forEach(function (tier) {
      (state.faceUp[tier] || []).forEach(function (card) {
        if (card && !paymentForCard(state, player.index, card).ok) targets.push(card);
      });
    });
    player.reserved.forEach(function (card) {
      if (!paymentForCard(state, player.index, card).ok) targets.push(card);
    });
    targets.sort(function (a, b) {
      return (b.points - a.points) || (b.tier - a.tier) || a.id.localeCompare(b.id);
    });
    targets.slice(0, 4).forEach(function (card, rank) {
      COLORS.forEach(function (color) {
        var deficit = Math.max(0, card.cost[color] - player.bonuses[color]);
        var short = Math.max(0, deficit - player.tokens[color]);
        demand[color] += short * (8 - rank * 2);
      });
    });
    state.nobles.forEach(function (noble) {
      if (noble.claimedBy !== null) return;
      COLORS.forEach(function (color) {
        var need = noble.need[color] || 0;
        if (need > player.bonuses[color]) demand[color] += (need - player.bonuses[color]) * 3;
      });
    });
    COLORS.forEach(function (color) {
      demand[color] += (START_GEMS - state.gems[color]) * 2;
    });
    return demand;
  }

  function buyScore(state, player, move) {
    var card = cardForMove(state, player.index, move);
    if (!card) return -Infinity;
    var payment = paymentForCard(state, player.index, card);
    var nobleValue = nobleColorValue(state, player, card.bonus);
    var completesNoble = wouldCompleteNoble(state, player, card);
    var score = 3000 + card.points * 280 + card.tier * 22 + nobleValue * 4;
    score -= cardCostTotal(card) * 4;
    score -= payment.gold * 8;
    if (payment.gold === 0) score += 10;
    if (player.bonuses[card.bonus] === 0) score += 14;
    if (completesNoble) score += 180;
    if (move.source === 'reserved') score += 26;
    if (player.prestige + card.points + (completesNoble ? 3 : 0) >= WIN_PRESTIGE) score += 5000;
    return score;
  }

  function reserveScore(state, player, move) {
    if (move.source === 'deck') return 200;
    var card = cardForMove(state, player.index, move);
    if (!card) return -Infinity;
    var demand = colorDemand(state, player);
    var need = 0;
    COLORS.forEach(function (color) {
      var deficit = Math.max(0, card.cost[color] - player.bonuses[color]);
      need += Math.max(0, deficit - player.tokens[color]);
    });
    var score = 600 + card.points * 55 + card.tier * 22 + demand[card.bonus] * 5;
    score += nobleColorValue(state, player, card.bonus) * 5;
    score -= need * 6;
    if (card.tier === 3) score += 50;
    if (player.reserved.length === 0) score += 10;
    if (state.gems.gold > 0 && tokenTotal(player) < TOKEN_LIMIT) score += 18;
    return score;
  }

  function takeScore(state, player, move) {
    var demand = colorDemand(state, player);
    var score = 640;
    if (move.type === 'take3') {
      move.colors.forEach(function (color) {
        score += 24 + demand[color] * 8 + (state.gems[color] <= 1 ? 20 : 0);
      });
      score += move.colors.length * 8;
    } else {
      var color = move.color;
      score += 34 + demand[color] * 18 + (state.gems[color] <= 1 ? 28 : 0);
      score += nobleColorValue(state, player, color) * 2;
    }
    return score;
  }

  function aiTieBreaker(state) {
    var x = (state.seed >>> 0) || 0x1a2b3c4d;
    x = (x ^ Math.imul(state.turn + 1, 0x9e3779b1)) >>> 0;
    x = (x ^ Math.imul(state.current + 1, 0x85ebca6b)) >>> 0;
    x = (x ^ Math.imul(state.players[0].prestige + 3, 0xc2b2ae35)) >>> 0;
    x = (x ^ Math.imul(state.players[1].prestige + 7, 0x27d4eb2f)) >>> 0;
    var rng = mulberry32(x || 0x12345678);
    rng();
    return rng();
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    var player = state.players[state.current];
    var moves = getLegalMoves(state);
    if (!moves.length) throw new Error('没有合法动作');
    var scored = moves.map(function (move) {
      var score;
      if (move.type === 'buy') score = buyScore(state, player, move);
      else if (move.type === 'reserve') score = reserveScore(state, player, move);
      else score = takeScore(state, player, move);
      return { move: move, score: score };
    });
    var bestScore = -Infinity;
    scored.forEach(function (entry) {
      if (entry.score > bestScore) bestScore = entry.score;
    });
    var ties = scored.filter(function (entry) { return entry.score === bestScore; })
      .map(function (entry) { return entry.move; });
    if (ties.length === 1) return ties[0];
    var pick = Math.floor(aiTieBreaker(state) * ties.length);
    if (pick >= ties.length) pick = ties.length - 1;
    return ties[pick];
  }

  function totalGemsInPlay(state) {
    var counts = {};
    COLORS.forEach(function (color) {
      counts[color] = state.gems[color];
    });
    counts.gold = state.gems.gold;
    state.players.forEach(function (player) {
      COLORS.forEach(function (color) { counts[color] += player.tokens[color] || 0; });
      counts.gold += player.tokens.gold || 0;
    });
    return counts;
  }

  return Object.freeze({
    COLORS: COLORS,
    COLOR_BY_KEY: COLOR_BY_KEY,
    TOKEN_LIMIT: TOKEN_LIMIT,
    RESERVE_LIMIT: RESERVE_LIMIT,
    FACE_UP_PER_TIER: FACE_UP_PER_TIER,
    WIN_PRESTIGE: WIN_PRESTIGE,
    START_GEMS: START_GEMS,
    START_GOLD: START_GOLD,
    NOBLE_COUNT: NOBLE_COUNT,
    CARD_CATALOG: CARD_CATALOG,
    NOBLES: NOBLE_CATALOG,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    currentPlayer: currentPlayer,
    getPlayer: getPlayer,
    getScoreboard: getScoreboard,
    tokenTotal: tokenTotal,
    paymentFor: paymentForCard,
    canBuyCard: canBuyCard,
    nobleRequirementsMet: nobleRequirementsMet,
    totalGemsInPlay: totalGemsInPlay
  });
});
