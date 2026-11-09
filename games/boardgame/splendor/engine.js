/*
 * Splendor（璀璨宝石）双人纯规则引擎 — UMD
 *
 * 浏览器：<script src="engine.js"></script>，使用 globalThis.SplendorEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；任何动作都返回全新 state，不修改传入对象。
 *   - 所有随机性来自 createGame 的 seed（mulberry32），不使用 Math.random。
 *   - AI 只从 getLegalMoves(state) 的返回值里挑选动作。
 *   - 非法动作一律抛出 Error。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SplendorEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = ['white', 'blue', 'green', 'red', 'black'];
  var COLOR_NAMES = {
    white: '白', blue: '蓝', green: '绿', red: '红', black: '黑', gold: '金'
  };
  var COLOR_LABELS = {
    white: '钻石', blue: '蓝宝石', green: '祖母绿', red: '红宝石', black: '缟玛瑙', gold: '黄金'
  };
  var TOKEN_LIMIT = 10;
  var RESERVE_LIMIT = 3;
  var FACE_UP_PER_TIER = 4;
  var WIN_PRESTIGE = 15;
  var START_GEMS = 4;
  var START_GOLD = 5;

  var TIER_ONE_COSTS = [
    [1, 0, 0, 0, 0], [0, 1, 0, 0, 0], [0, 0, 1, 0, 0], [0, 0, 0, 1, 0], [0, 0, 0, 0, 1],
    [1, 1, 0, 0, 0], [0, 1, 1, 0, 0], [0, 0, 1, 1, 0], [0, 0, 0, 1, 1], [1, 0, 0, 0, 1],
    [3, 0, 0, 0, 0], [0, 3, 0, 0, 0], [0, 0, 3, 0, 0], [0, 0, 0, 3, 0], [0, 0, 0, 0, 3],
    [2, 1, 0, 0, 0], [0, 2, 1, 0, 0], [0, 0, 2, 1, 0], [0, 0, 0, 2, 1], [1, 0, 0, 0, 2]
  ];
  var TIER_TWO_COSTS = [
    [3, 2, 0, 0, 0], [0, 3, 2, 0, 0], [0, 0, 3, 2, 0], [0, 0, 0, 3, 2], [2, 0, 0, 0, 3],
    [2, 2, 2, 0, 0], [0, 2, 2, 2, 0], [0, 0, 2, 2, 2], [2, 0, 0, 2, 2], [2, 2, 0, 0, 2],
    [4, 2, 1, 0, 0], [0, 4, 2, 1, 0], [0, 0, 4, 2, 1], [1, 0, 0, 4, 2], [2, 1, 0, 0, 4],
    [5, 3, 0, 0, 0], [0, 5, 3, 0, 0], [0, 0, 5, 3, 0], [0, 0, 0, 5, 3], [3, 0, 0, 0, 5]
  ];
  var TIER_THREE_COSTS = [
    [5, 4, 2, 0, 0], [0, 5, 4, 2, 0], [0, 0, 5, 4, 2], [2, 0, 0, 5, 4], [4, 2, 0, 0, 5],
    [6, 3, 0, 0, 0], [0, 6, 3, 0, 0], [0, 0, 6, 3, 0], [0, 0, 0, 6, 3], [3, 0, 0, 0, 6],
    [5, 5, 3, 0, 0], [0, 5, 5, 3, 0], [0, 0, 5, 5, 3], [3, 0, 0, 5, 5], [5, 3, 0, 0, 5],
    [7, 4, 2, 0, 0], [0, 7, 4, 2, 0], [0, 0, 7, 4, 2], [2, 0, 0, 7, 4], [4, 2, 0, 0, 7]
  ];

  var TIER_ONE_NAMES = [
    '晨光护符', '蓝涧胸针', '翠叶指环', '赤砂吊坠', '夜幕耳坠',
    '白玉学徒', '蓝纹工匠', '绿洲旅人', '红铜学徒', '黑羽信使',
    '云母学徒', '海盐商人', '苔原采珠人', '石榴石匠', '墨玉守卫',
    '象牙学徒', '冰湖船夫', '青藤园丁', '陶土匠人', '煤港脚夫'
  ];
  var TIER_TWO_NAMES = [
    '白银匠师', '蓝晶鉴宝师', '翡翠行商', '绯红骑士', '黑曜学者',
    '珍珠织工', '蓝羽书记官', '绿林守望者', '赤金舞者', '玄铁工匠',
    '月白建筑师', '深海领航员', '翡翠祭司', '红玉佣兵', '黑曜密探',
    '象牙银行家', '蓝宝石船长', '青玉宗师', '朱砂炼金师', '墨色收藏家'
  ];
  var TIER_THREE_NAMES = [
    '白金大公', '苍穹贤者', '翡翠女王', '绯红女爵', '黑曜君主',
    '钻石议员', '碧海总督', '翠玉圣者', '赤炎将军', '夜巡公爵',
    '白塔学士', '星河占星师', '翡翠商会会长', '红宝石亲王', '玄夜枢机',
    '永恒白骑士', '蓝钻大亨', '青翠王冠', '赤金皇帝', '黑天鹅女皇'
  ];

  var TIER_ONE_PRESTIGE = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  var TIER_TWO_PRESTIGE = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3];
  var TIER_THREE_PRESTIGE = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5];

  var NOBLE_DEFS = [
    {
      id: 'N1', name: '翡翠商会', prestige: 3,
      requirements: { white: 3, blue: 3, green: 3 }
    },
    {
      id: 'N2', name: '绯红王庭', prestige: 3,
      requirements: { blue: 3, red: 3, black: 3 }
    },
    {
      id: 'N3', name: '四方议厅', prestige: 3,
      requirements: { white: 2, green: 2, red: 2, black: 2 }
    }
  ];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function costObject(values) {
    var out = {};
    COLORS.forEach(function (color, index) { out[color] = values[index] || 0; });
    return out;
  }

  function buildCards(tier, costs, prestige, names) {
    return costs.map(function (values, index) {
      return {
        id: 'S' + tier + '-' + pad2(index + 1),
        tier: tier,
        name: names[index],
        color: COLORS[index % COLORS.length],
        prestige: prestige[index],
        cost: costObject(values)
      };
    });
  }

  var CARD_CATALOG = []
    .concat(buildCards(1, TIER_ONE_COSTS, TIER_ONE_PRESTIGE, TIER_ONE_NAMES))
    .concat(buildCards(2, TIER_TWO_COSTS, TIER_TWO_PRESTIGE, TIER_TWO_NAMES))
    .concat(buildCards(3, TIER_THREE_COSTS, TIER_THREE_PRESTIGE, TIER_THREE_NAMES));

  CARD_CATALOG.forEach(function (card) {
    var total = 0;
    COLORS.forEach(function (color) { total += card.cost[color]; });
    card.costTotal = total;
  });

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
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function emptyTokens() {
    var tokens = {};
    COLORS.forEach(function (color) { tokens[color] = 0; });
    tokens.gold = 0;
    return tokens;
  }

  function createPlayer(index, name, isAI) {
    var bonuses = {};
    COLORS.forEach(function (color) { bonuses[color] = 0; });
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      tokens: emptyTokens(),
      bonuses: bonuses,
      prestige: 0,
      cards: [],
      reserved: []
    };
  }

  function tokenTotal(player) {
    var total = player.tokens.gold || 0;
    COLORS.forEach(function (color) { total += player.tokens[color] || 0; });
    return total;
  }

  function cardTotalCost(card) {
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

    var nobles = NOBLE_DEFS.map(function (noble) {
      var copy = clone(noble);
      copy.claimedBy = null;
      return copy;
    });

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
        text: '新开一局（种子 ' + seed + '）：双方各 4 枚五色宝石筹码与 5 枚黄金，先到 15 声望者触发最后一轮。'
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
    if (state.log.length > 140) state.log.splice(0, state.log.length - 140);
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

  function combination3(colors) {
    var out = [];
    for (var i = 0; i < colors.length; i++) {
      for (var j = i + 1; j < colors.length; j++) {
        for (var k = j + 1; k < colors.length; k++) {
          out.push([colors[i], colors[j], colors[k]]);
        }
      }
    }
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
          if (card) moves.push({ type: 'reserve', cardId: card.id, player: pi });
        });
      });
    }

    var capacity = TOKEN_LIMIT - tokenTotal(player);
    var available = COLORS.filter(function (color) { return state.gems[color] > 0; });
    if (capacity >= 3 && available.length >= 3) {
      combination3(available).forEach(function (colors) {
        moves.push({ type: 'take3', colors: colors.slice(), player: pi });
      });
    } else if (capacity >= 2 && available.length === 2) {
      moves.push({ type: 'take3', colors: available.slice(), player: pi });
    } else if (capacity >= 1 && available.length === 1) {
      moves.push({ type: 'take3', colors: available.slice(), player: pi });
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
      throw new Error('拿 3 色需要提供颜色列表');
    }
    var unique = [];
    move.colors.forEach(function (color) {
      if (COLORS.indexOf(color) < 0) throw new Error('未知宝石颜色：' + color);
      if (unique.indexOf(color) >= 0) throw new Error('拿 3 色不能重复颜色');
      unique.push(color);
    });
    var available = COLORS.filter(function (color) { return next.gems[color] > 0; });
    if (available.length >= 3) {
      if (unique.length !== 3) throw new Error('必须拿取 3 种不同颜色');
    } else if (unique.length !== available.length) {
      throw new Error('筹码不足，只能拿取剩下的不同颜色');
    }
    unique.forEach(function (color) {
      if (next.gems[color] <= 0) throw new Error(COLOR_LABELS[color] + '筹码已用尽');
    });
    if (tokenTotal(player) + unique.length > TOKEN_LIMIT) {
      throw new Error('筹码上限为 10 枚，无法继续拿取');
    }
    unique.forEach(function (color) {
      next.gems[color] -= 1;
      player.tokens[color] += 1;
    });
    appendLog(next, pi, 'take3', player.name + ' 拿取 ' +
      unique.map(function (color) { return COLOR_NAMES[color]; }).join('、') +
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
    appendLog(next, pi, 'take2', player.name + ' 拿取 2 枚' +
      COLOR_NAMES[color] + '色宝石筹码。');
  }

  function reserveCard(next, pi, move) {
    var player = next.players[pi];
    if (player.reserved.length >= RESERVE_LIMIT) throw new Error('预留区最多 3 张卡');
    var loc = findFaceUp(next, move.cardId);
    if (!loc) throw new Error('该卡不在场上');
    var card = loc.card;
    next.faceUp[loc.tier][loc.index] = null;
    refillFaceUp(next, loc.tier, loc.index);
    player.reserved.push(card);

    var goldGained = 0;
    if (next.gems.gold > 0 && tokenTotal(player) < TOKEN_LIMIT) {
      next.gems.gold -= 1;
      player.tokens.gold += 1;
      goldGained = 1;
    }
    var text = player.name + ' 预留「' + card.name + '」';
    if (goldGained) text += '，并获得 1 枚黄金。';
    else if (next.gems.gold <= 0) text += '；黄金已用尽，未获得黄金。';
    else text += '；筹码已满，未获得黄金。';
    appendLog(next, pi, 'reserve', text);
  }

  function nobleRequirementsMet(player, noble) {
    return COLORS.every(function (color) {
      return (player.bonuses[color] || 0) >= (noble.requirements[color] || 0);
    });
  }

  function claimNoble(next, pi) {
    var player = next.players[pi];
    for (var i = 0; i < next.nobles.length; i++) {
      var noble = next.nobles[i];
      if (noble.claimedBy !== null) continue;
      if (nobleRequirementsMet(player, noble)) {
        noble.claimedBy = pi;
        player.prestige += noble.prestige;
        appendLog(next, pi, 'noble', '贵族「' + noble.name + '」到访' + player.name +
          '，获得 ' + noble.prestige + ' 声望。');
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
    player.bonuses[card.color] += 1;
    player.prestige += card.prestige;

    var paid = [];
    COLORS.forEach(function (color) {
      if (payment.colored[color] > 0) paid.push(COLOR_NAMES[color] + payment.colored[color]);
    });
    if (payment.gold > 0) paid.push('金' + payment.gold);
    appendLog(next, pi, 'buy', player.name + ' 购买「' + card.name + '」' +
      (card.prestige ? '，获得 ' + card.prestige + ' 声望' : '') +
      '（支付 ' + (paid.length ? paid.join('、') : '永久加成抵扣') + '）。');

    var noble = claimNoble(next, pi);
    if (noble && player.prestige >= WIN_PRESTIGE && !next.endgameTriggered) {
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
        nobles: state.nobles.filter(function (noble) { return noble.claimedBy === player.index; }).length,
        tokens: tokenTotal(player)
      };
    });
  }

  function determineWinner(scores) {
    var best = scores.slice().sort(function (a, b) {
      return (b.prestige - a.prestige) || (b.cards - a.cards) || (a.index - b.index);
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
    state.result = {
      reason: reason,
      winner: winner,
      scores: scores
    };
    var winnerText = winner === null ? '双方战平' : state.players[winner].name + ' 获胜';
    appendLog(state, null, 'end', '对局结束：' + reason + '；' + winnerText + '。');
    return state;
  }

  function commitMove(next, pi) {
    next.turn += 1;
    next.current = 1 - pi;
    next.round = Math.floor((next.turn - 1) / 2) + 1;

    var reached = next.players.some(function (player) {
      return player.prestige >= WIN_PRESTIGE;
    });
    if (reached && !next.endgameTriggered) {
      next.endgameTriggered = true;
      next.endgameBy = pi;
      appendLog(next, null, 'endgame', '有人达到 15 声望，当前轮结束后结算。');
    }
    if (next.endgameTriggered && pi === 1) {
      finishGame(next, '有人达到 15 声望，本轮结束');
      return next;
    }
    if (!next.over && getLegalMoves(next).length === 0) {
      finishGame(next, '没有可执行的动作');
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
      var need = noble.requirements[color] || 0;
      var have = player.bonuses[color] || 0;
      if (need > have) value += (need - have === 1 ? 24 : 12);
    });
    return value;
  }

  function wouldCompleteNoble(state, player, card) {
    var nextBonuses = {};
    COLORS.forEach(function (color) {
      nextBonuses[color] = player.bonuses[color] + (color === card.color ? 1 : 0);
    });
    return state.nobles.some(function (noble) {
      if (noble.claimedBy !== null) return false;
      return COLORS.every(function (color) {
        return nextBonuses[color] >= (noble.requirements[color] || 0);
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
      return (b.prestige - a.prestige) || (b.tier - a.tier) || a.id.localeCompare(b.id);
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
        var need = noble.requirements[color] || 0;
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
    var nobleValue = nobleColorValue(state, player, card.color);
    var completesNoble = wouldCompleteNoble(state, player, card);
    var score = 3000 + card.prestige * 280 + card.tier * 22 + nobleValue * 4;
    score -= cardTotalCost(card) * 4;
    score -= payment.gold * 8;
    if (payment.gold === 0) score += 10;
    if (player.bonuses[card.color] === 0) score += 14;
    if (completesNoble) score += 180;
    if (move.source === 'reserved') score += 26;
    if (player.prestige + card.prestige + (completesNoble ? 3 : 0) >= WIN_PRESTIGE) score += 5000;
    return score;
  }

  function reserveScore(state, player, move) {
    var card = cardForMove(state, player.index, move);
    if (!card) return -Infinity;
    var demand = colorDemand(state, player);
    var need = 0;
    COLORS.forEach(function (color) {
      var deficit = Math.max(0, card.cost[color] - player.bonuses[color]);
      need += Math.max(0, deficit - player.tokens[color]);
    });
    var score = 600 + card.prestige * 55 + card.tier * 22 + demand[card.color] * 5;
    score += nobleColorValue(state, player, card.color) * 5;
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
    var pi = state.current;
    var player = state.players[pi];
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

  return Object.freeze({
    COLORS: COLORS,
    COLOR_NAMES: COLOR_NAMES,
    COLOR_LABELS: COLOR_LABELS,
    TOKEN_LIMIT: TOKEN_LIMIT,
    RESERVE_LIMIT: RESERVE_LIMIT,
    FACE_UP_PER_TIER: FACE_UP_PER_TIER,
    WIN_PRESTIGE: WIN_PRESTIGE,
    START_GEMS: START_GEMS,
    START_GOLD: START_GOLD,
    CARD_CATALOG: CARD_CATALOG,
    NOBLES: NOBLE_DEFS,
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
    nobleRequirementsMet: nobleRequirementsMet
  });
});
