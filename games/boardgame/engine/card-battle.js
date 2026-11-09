/*
 * Card Battle — 宝可梦式卡牌对战最小闭环引擎（UMD）。
 *
 *   浏览器：<script src="../engine/card-battle.js"></script> → window.CardBattle
 *   Node：  var CardBattle = require('./card-battle.js')
 *
 * 设计约束：
 *   - 纯函数，所有公开操作返回新 state，不修改入参；
 *   - state 只包含 JSON 可序列化数据（测试会深拷贝）；
 *   - 规则见 games/boardgame/card-battle/index.html 的规则说明。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CardBattle = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SIDES = ['player', 'ai'];
  var MAX_FIELD = 3;
  var WIN_SCORE = 3;
  var OPENING_HAND = 5;
  var DECK_POKEMON = 12;
  var DECK_ENERGY = 6;
  var DECK_ITEM = 2;
  var LOG_LIMIT = 300;

  function fail(message) {
    throw new Error(message);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // Small deterministic PRNG so tests and replays are reproducible.
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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

  function normalizeCards(input) {
    var list;
    if (Array.isArray(input)) {
      list = input;
    } else if (input && typeof input === 'object') {
      list = Object.keys(input).map(function (key) { return input[key]; });
    } else {
      fail('缺少卡牌数据：请传入 cards 数组');
    }
    if (!list.length) fail('卡牌数据为空');
    var map = {};
    var copy = list.map(function (card) {
      if (!card || typeof card.id !== 'string') fail('卡牌缺少 id');
      if (map[card.id]) fail('卡牌 id 重复：' + card.id);
      var def = clone(card);
      map[def.id] = def;
      return def;
    });
    return { list: copy, map: map };
  }

  function typeIds(cards, type, count) {
    var ids = cards.filter(function (card) { return card.type === type; })
      .slice(0, count)
      .map(function (card) { return card.id; });
    return ids;
  }

  function buildDeck(cards) {
    var pokemon = typeIds(cards, 'pokemon', DECK_POKEMON);
    var energy = typeIds(cards, 'energy', DECK_ENERGY);
    var item = typeIds(cards, 'item', DECK_ITEM);
    if (pokemon.length < DECK_POKEMON) {
      fail('牌库需要 ' + DECK_POKEMON + ' 张宝可梦，数据只有 ' + pokemon.length + ' 张');
    }
    if (energy.length < DECK_ENERGY) {
      fail('牌库需要 ' + DECK_ENERGY + ' 张能量，数据只有 ' + energy.length + ' 张');
    }
    if (item.length < DECK_ITEM) {
      fail('牌库需要 ' + DECK_ITEM + ' 张道具，数据只有 ' + item.length + ' 张');
    }
    return pokemon.concat(energy, item);
  }

  function label(side) {
    return side === 'player' ? '玩家' : '对手';
  }

  function zh(card) {
    return card && card.name ? card.name.zh : (card && card.id) || '未知卡牌';
  }

  function otherSide(side) {
    return side === 'player' ? 'ai' : 'player';
  }

  function log(state, side, text) {
    state.log.push({
      turn: state.turnNumber,
      side: side,
      text: text
    });
    if (state.log.length > LOG_LIMIT) state.log.shift();
  }

  function getCard(state, id) {
    var card = state.cards[id];
    if (!card) fail('未知卡牌：' + id);
    return card;
  }

  function newSideState(deck) {
    return {
      deck: deck,
      hand: [],
      discard: [],
      field: [],
      score: 0,
      usedEnergy: false,
      playedPokemon: false,
      usedItem: false,
      attacked: false
    };
  }

  function resetTurnFlags(sideState) {
    sideState.usedEnergy = false;
    sideState.playedPokemon = false;
    sideState.usedItem = false;
    sideState.attacked = false;
  }

  function drawCards(state, side, count, reason) {
    var s = state.sides[side];
    var drawn = 0;
    for (var i = 0; i < count; i++) {
      if (!s.deck.length) break;
      s.hand.push(s.deck.shift());
      drawn++;
    }
    if (drawn > 0) {
      log(state, side, (reason || '') + '抽了 ' + drawn + ' 张牌');
    } else {
      log(state, side, (reason || '') + '牌库已空，跳过抽牌');
    }
    return drawn;
  }

  function startTurn(state, side, draw) {
    resetTurnFlags(state.sides[side]);
    log(state, side, '第 ' + state.turnNumber + ' 回合 · ' + label(side) + '回合开始');
    if (draw) drawCards(state, side, 1, '回合开始，');
  }

  function makePokemon(state, card) {
    var uid = state.uidCounter++;
    return {
      uid: uid,
      id: card.id,
      hp: card.hp,
      maxHp: card.hp,
      energy: 0
    };
  }

  function ensurePlayable(state, side) {
    if (!state || !state.sides || !state.sides[side]) fail('未知阵营：' + side);
    if (state.winner) fail('游戏已经结束');
    if (state.turn !== side) fail('现在不是' + label(side) + '的回合');
  }

  function fieldIndex(sideState, index, what) {
    if (typeof index !== 'number' || index < 0 || index >= sideState.field.length) {
      fail((what || '目标') + '不存在');
    }
  }

  function takeFromHand(state, side, cardId) {
    var s = state.sides[side];
    var index = s.hand.indexOf(cardId);
    if (index < 0) fail('手牌中没有：' + cardId);
    s.hand.splice(index, 1);
    return getCard(state, cardId);
  }

  /**
   * 创建一局新游戏。
   * opts:
   *   cards      卡牌数组（必填，或使用全局 CARD_BATTLE_CARDS）
   *   seed       洗牌随机种子（默认固定值，便于复现）
   *   firstSide  'player' | 'ai'，覆盖随机先手
   *   decks      { player: [cardId...], ai: [...] } 自定义牌库（测试用）
   *   shuffle    默认 true；false 时保留自定义牌库顺序
   *   drawOnStart 默认 true；false 时先手第一回合不抽牌（测试用）
   */
  function createGame(opts) {
    opts = opts || {};
    var provided = opts.cards || (typeof CARD_BATTLE_CARDS !== 'undefined' ? CARD_BATTLE_CARDS : null);
    var normalized = normalizeCards(provided);
    var seed = opts.seed == null ? 20260101 : (Number(opts.seed) >>> 0);
    var rng = mulberry32(seed);
    var defaultDeck = buildDeck(normalized.list);

    function deckFor(side) {
      var custom = opts.decks && Array.isArray(opts.decks[side]) ? opts.decks[side].slice() : defaultDeck.slice();
      custom.forEach(function (id) {
        if (!normalized.map[id]) fail('自定义牌库包含未知卡牌：' + id);
      });
      return opts.shuffle === false ? custom : shuffle(custom, rng);
    }

    var state = {
      version: 1,
      seed: seed,
      turn: null,
      turnNumber: 1,
      winner: null,
      uidCounter: 1,
      cards: normalized.map,
      log: [],
      sides: {
        player: newSideState(deckFor('player')),
        ai: newSideState(deckFor('ai'))
      }
    };

    SIDES.forEach(function (side) {
      drawCards(state, side, OPENING_HAND, '起手：');
    });

    var firstSide = opts.firstSide || (rng() < 0.5 ? 'player' : 'ai');
    if (SIDES.indexOf(firstSide) < 0) fail('未知先手：' + firstSide);
    state.turn = firstSide;
    log(state, null, '对局开始，' + label(firstSide) + '先手');
    startTurn(state, firstSide, opts.drawOnStart !== false);
    return state;
  }

  function playCard(state, side, cardId) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var card = getCard(next, cardId);
    if (card.type !== 'pokemon') fail('只有宝可梦可以放置到场上');
    if (s.playedPokemon) fail('本回合已经放置过宝可梦');
    if (s.field.length >= MAX_FIELD) fail('场上最多 ' + MAX_FIELD + ' 只宝可梦');
    takeFromHand(next, side, cardId);
    s.field.push(makePokemon(next, card));
    s.playedPokemon = true;
    log(next, side, '放置了 ' + zh(card));
    return next;
  }

  function attachEnergy(state, side, cardId, targetIndex) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var card = getCard(next, cardId);
    if (card.type !== 'energy') fail('只有能量卡可以附着');
    if (s.usedEnergy) fail('本回合已经附着过能量');
    fieldIndex(s, targetIndex, '宝可梦');
    takeFromHand(next, side, cardId);
    var target = s.field[targetIndex];
    target.energy += 1;
    s.usedEnergy = true;
    log(next, side, '把 ' + zh(card) + ' 附着到 ' + zh(getCard(next, target.id)) +
      '（能量 ' + target.energy + '）');
    return next;
  }

  function useItem(state, side, cardId) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var card = getCard(next, cardId);
    if (card.type !== 'item') fail('只有道具卡可以使用');
    if (card.effect !== 'draw2') fail('未知道具效果：' + card.effect);
    if (s.usedItem) fail('本回合已经使用过道具');
    takeFromHand(next, side, cardId);
    s.discard.push(cardId);
    s.usedItem = true;
    log(next, side, '使用了道具「' + zh(card) + '」');
    drawCards(next, side, 2, '道具效果：');
    return next;
  }

  function attack(state, side, attackerIndex, attackIndex, targetIndex) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (s.attacked) fail('本回合已经攻击过');
    fieldIndex(s, attackerIndex, '攻击方宝可梦');
    var attacker = s.field[attackerIndex];
    var attackerCard = getCard(next, attacker.id);
    var attacks = attackerCard.attacks || [];
    if (typeof attackIndex !== 'number' || attackIndex < 0 || attackIndex >= attacks.length) {
      fail('攻击招式不存在');
    }
    var move = attacks[attackIndex];
    if (attacker.energy < move.cost) {
      fail('能量不足：需要 ' + move.cost + '，当前 ' + attacker.energy);
    }
    var foe = next.sides[otherSide(side)];
    fieldIndex(foe, targetIndex, '对方宝可梦');
    var target = foe.field[targetIndex];
    var targetCard = getCard(next, target.id);
    var multiplier = targetCard.weakness === attackerCard.subtype ? 2 : 1;
    var damage = move.damage * multiplier;

    target.hp -= damage;
    log(next, side, zh(attackerCard) + ' 使用「' + move.name + '」攻击 ' + zh(targetCard) +
      '，造成 ' + damage + ' 点伤害' + (multiplier === 2 ? '（弱点 ×2）' : ''));

    if (target.hp <= 0) {
      foe.field.splice(targetIndex, 1);
      foe.discard.push(target.id);
      s.score += 1;
      log(next, side, zh(targetCard) + ' 被击倒，' + label(side) + '得 1 分（' + s.score + '/' +
        WIN_SCORE + '）');
      if (s.score >= WIN_SCORE) {
        next.winner = side;
        log(next, side, label(side) + '先得 ' + WIN_SCORE + ' 分，获得胜利！');
      }
    }

    s.attacked = true;
    return next;
  }

  function endTurn(state, side) {
    var next = clone(state);
    ensurePlayable(next, side);
    var nextSide = otherSide(side);
    next.turn = nextSide;
    next.turnNumber += 1;
    startTurn(next, nextSide, true);
    return next;
  }

  function legalActions(state, side) {
    if (!state || !state.sides || !state.sides[side]) return [];
    if (state.winner || state.turn !== side) return [];
    var s = state.sides[side];
    var actions = [];

    if (!s.usedEnergy && s.field.length) {
      s.hand.forEach(function (cardId) {
        if (getCard(state, cardId).type !== 'energy') return;
        s.field.forEach(function (_, index) {
          actions.push({ type: 'attachEnergy', side: side, cardId: cardId, target: index });
        });
      });
    }

    if (!s.playedPokemon && s.field.length < MAX_FIELD) {
      s.hand.forEach(function (cardId) {
        if (getCard(state, cardId).type === 'pokemon') {
          actions.push({ type: 'playCard', side: side, cardId: cardId });
        }
      });
    }

    if (!s.usedItem) {
      s.hand.forEach(function (cardId) {
        if (getCard(state, cardId).type === 'item') {
          actions.push({ type: 'useItem', side: side, cardId: cardId });
        }
      });
    }

    if (!s.attacked) {
      var foe = state.sides[otherSide(side)];
      s.field.forEach(function (mon, attackerIndex) {
        var card = getCard(state, mon.id);
        (card.attacks || []).forEach(function (move, attackIndex) {
          if (mon.energy < move.cost) return;
          foe.field.forEach(function (_, targetIndex) {
            actions.push({
              type: 'attack',
              side: side,
              attacker: attackerIndex,
              attackIndex: attackIndex,
              target: targetIndex
            });
          });
        });
      });
    }

    actions.push({ type: 'endTurn', side: side });
    return actions;
  }

  function maxAttackDamage(state, mon) {
    var card = getCard(state, mon.id);
    var attacks = card.attacks || [];
    var best = 0;
    for (var i = 0; i < attacks.length; i++) {
      if (attacks[i].damage > best) best = attacks[i].damage;
    }
    return best;
  }

  function effectiveDamage(state, action, side) {
    var mon = state.sides[side].field[action.attacker];
    var card = getCard(state, mon.id);
    var move = card.attacks[action.attackIndex];
    var target = state.sides[otherSide(side)].field[action.target];
    var multiplier = getCard(state, target.id).weakness === card.subtype ? 2 : 1;
    return move.damage * multiplier;
  }

  /*
   * 简单启发式 AI：能量优先给当前攻击力最高的宝可梦；能攻击就攻击
   * 有效伤害最高的目标；否则放牌 / 用道具 / 结束回合。
   * 所有返回值都从 legalActions 中挑选，因此一定合法。
   */
  function aiAction(state, side) {
    if (!state || state.winner || state.turn !== side) return null;
    var actions = legalActions(state, side);

    var energy = actions.filter(function (a) { return a.type === 'attachEnergy'; });
    if (energy.length) {
      energy.sort(function (a, b) {
        var da = maxAttackDamage(state, state.sides[side].field[a.target]);
        var db = maxAttackDamage(state, state.sides[side].field[b.target]);
        if (db !== da) return db - da;
        return a.target - b.target;
      });
      return energy[0];
    }

    var attacks = actions.filter(function (a) { return a.type === 'attack'; });
    if (attacks.length) {
      attacks.sort(function (a, b) {
        var da = effectiveDamage(state, a, side);
        var db = effectiveDamage(state, b, side);
        if (db !== da) return db - da;
        var ta = state.sides[otherSide(side)].field[a.target].hp;
        var tb = state.sides[otherSide(side)].field[b.target].hp;
        if (ta !== tb) return ta - tb;
        return a.attacker - b.attacker;
      });
      return attacks[0];
    }

    var plays = actions.filter(function (a) { return a.type === 'playCard'; });
    if (plays.length) {
      plays.sort(function (a, b) {
        var ha = getCard(state, a.cardId).hp;
        var hb = getCard(state, b.cardId).hp;
        if (hb !== ha) return hb - ha;
        return a.cardId < b.cardId ? -1 : 1;
      });
      return plays[0];
    }

    var items = actions.filter(function (a) { return a.type === 'useItem'; });
    if (items.length) return items[0];

    for (var i = 0; i < actions.length; i++) {
      if (actions[i].type === 'endTurn') return actions[i];
    }
    return null;
  }

  function applyAction(state, action) {
    if (!action || typeof action.type !== 'string') fail('无效动作');
    switch (action.type) {
      case 'playCard': return playCard(state, action.side, action.cardId);
      case 'attachEnergy': return attachEnergy(state, action.side, action.cardId, action.target);
      case 'useItem': return useItem(state, action.side, action.cardId);
      case 'attack':
        return attack(state, action.side, action.attacker, action.attackIndex, action.target);
      case 'endTurn': return endTurn(state, action.side);
      default: fail('未知动作：' + action.type);
    }
  }

  function score(state, side) {
    if (!state || !state.sides || !state.sides[side]) return 0;
    return state.sides[side].score;
  }

  function winner(state) {
    return (state && state.winner) || null;
  }

  return {
    SIDES: SIDES,
    MAX_FIELD: MAX_FIELD,
    WIN_SCORE: WIN_SCORE,
    OPENING_HAND: OPENING_HAND,
    createGame: createGame,
    playCard: playCard,
    attachEnergy: attachEnergy,
    attack: attack,
    useItem: useItem,
    endTurn: endTurn,
    aiAction: aiAction,
    applyAction: applyAction,
    score: score,
    winner: winner,
    legalActions: legalActions
  };
});
