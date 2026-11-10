/*
 * Hero Realms（英雄领域）精品版 — 纯规则引擎（UMD）。
 *
 *   浏览器：<script src="engine.js"></script> → window.HeroRealmsPremiumEngine
 *   Node：  require('./engine.js')
 *
 * 官方基础规则（本实现遵循）：
 *   - 2 人，各 50 点生命；起始牌组 10 张（本作按任务口径为 7 金币 + 3 匕首），
 *     洗混后回合开始抽 5 张；
 *   - 回合内可打出任意数量手牌，金币 / 战斗 / 治疗 / 抽牌按任意顺序结算；
 *   - 金币可以购买任意多张市场牌，受当前金币总量约束；买到的牌进入弃牌堆，
 *     市场立即补位；
 *   - 战斗进入战斗池，可分配给对手英雄或其冠军；冠军有防御力，被击倒后进入弃牌堆；
 *   - 场上已有同派系另一张牌时，打出带「同盟」的牌会额外触发同盟能力；
 *   - 回合结束弃掉剩余手牌与已打出的行动/物品牌，下一位玩家抽 5 张；
 *   - 牌库抽空时把弃牌堆洗回牌库；治疗不能超过 50 点生命上限；
 *   - 一方生命归零，另一方立即获胜。
 *
 * 与实体基础版的差异（已在 rules.html / realism.json 说明）：
 *   - 起始牌组使用 7 金币 + 3 匕首，而非实体版的 7 金币 + 红宝石 + 匕首 + 短剑；
 *   - 市场由基础版 51 个卡名、约 80 张牌组成，未纳入 Fire Gem、英雄牌组与守卫关键词；
 *   - 卡牌数值为适配本引擎的公开规则实现，不声称逐字复刻实体卡。
 *
 * 引擎无 DOM / 网络 / 计时器，所有公开操作返回新 state；隐藏信息只存在于
 * state.sides[].deck / hand，任何 publicView 都不会把对手手牌或双方牌库下发。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.HeroRealmsPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /* ---------- 共享洗牌 ---------- */
  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('HeroRealmsPremiumEngine requires games/shared/shuffle.js');
  }

  var SIDES = ['player', 'ai'];
  var MAX_HP = 50;
  var OPENING_HAND = 5;
  var MARKET_SIZE = 5;
  var LOG_LIMIT = 240;
  var STEP_LIMIT = 4000;
  var TYPES = ['item', 'action', 'champion'];
  var FACTIONS = ['basic', 'imperial', 'guild', 'necros', 'wild'];
  var EFFECT_KEYS = ['gold', 'combat', 'heal', 'draw'];
  var ABILITY_TYPES = ['combat', 'gold', 'heal', 'draw'];

  function fail(message) { throw new Error(message); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function otherSide(side) { return side === 'player' ? 'ai' : 'player'; }
  function label(side) { return side === 'player' ? '你' : '对手'; }
  function cardName(card) { return card && card.name ? card.name : (card && card.id) || '未知卡牌'; }

  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(list, seed) {
    return ShuffleApi.shuffle(list, { seed: seed >>> 0 });
  }

  function builtInData() {
    if (root && root.HeroRealmsPremiumData) return root.HeroRealmsPremiumData;
    if (typeof require === 'function') {
      try { return require('./data.js'); } catch (e) { /* 浏览器或独立测试 */ }
    }
    return null;
  }

  /* ---------- 数据归一化 ---------- */

  function normalizeEffect(input, where) {
    var out = {};
    if (input == null) return out;
    if (typeof input !== 'object' || Array.isArray(input)) fail(where + ' 必须是对象');
    Object.keys(input).forEach(function (key) {
      if (EFFECT_KEYS.indexOf(key) < 0) fail(where + ' 含未知效果：' + key);
      var n = Number(input[key]);
      if (!isFinite(n) || n < 0 || n % 1 !== 0) fail(where + '.' + key + ' 必须是非负整数');
      if (n > 0) out[key] = n;
    });
    return out;
  }

  function normalizeCards(input) {
    var list = Array.isArray(input) ? input
      : (input && Array.isArray(input.cards) ? input.cards : null);
    if (!list || !list.length) fail('缺少卡牌数据');
    var map = {};
    var marketPool = [];
    list.forEach(function (card) {
      if (!card || typeof card.id !== 'string' || !card.id) fail('卡牌缺少 id');
      if (map[card.id]) fail('卡牌 id 重复：' + card.id);
      if (typeof card.name !== 'string' || !card.name) fail('卡牌缺少名称：' + card.id);
      if (TYPES.indexOf(card.type) < 0) fail('未知卡牌类型：' + card.id + ' / ' + card.type);
      if (FACTIONS.indexOf(card.faction) < 0) fail('未知派系：' + card.id + ' / ' + card.faction);
      if (typeof card.cost !== 'number' || card.cost < 0 || card.cost % 1 !== 0) {
        fail('卡牌价格非法：' + card.id);
      }
      var def = clone(card);
      def.effects = normalizeEffect(card.effects, card.id + '.effects');
      def.ally = normalizeEffect(card.ally, card.id + '.ally');
      def.copies = card.starting ? 0 : Math.max(0, Math.floor(card.copies == null ? 1 : card.copies));
      if (card.type === 'champion') {
        if (!(def.defense > 0)) def.defense = 1;
        if (card.ability) {
          var ability = card.ability;
          if (ABILITY_TYPES.indexOf(ability.type) < 0) fail('未知冠军能力：' + card.id);
          var amount = Number(ability.amount);
          if (!isFinite(amount) || amount <= 0 || amount % 1 !== 0) fail('冠军能力数值非法：' + card.id);
          def.ability = { type: ability.type, amount: amount };
        } else {
          def.ability = null;
        }
      }
      map[def.id] = def;
      if (!def.starting) {
        for (var i = 0; i < def.copies; i += 1) marketPool.push(def.id);
      }
    });
    if (!marketPool.length) fail('市场牌池为空');
    return { map: map, marketPool: marketPool };
  }

  function expandStarting(def) {
    if (!def) return null;
    var out = [];
    if (Array.isArray(def)) {
      def.forEach(function (entry) {
        if (typeof entry === 'string') out.push(entry);
        else if (entry && typeof entry.id === 'string') {
          var n = entry.count == null ? 1 : entry.count;
          for (var i = 0; i < n; i += 1) out.push(entry.id);
        }
      });
      return out;
    }
    if (typeof def === 'object') {
      Object.keys(def).forEach(function (id) {
        var n = def[id] || 0;
        for (var i = 0; i < n; i += 1) out.push(id);
      });
      return out;
    }
    fail('起始牌组格式非法');
    return [];
  }

  function validateDeck(state, deck, source) {
    deck.forEach(function (id) {
      if (!state.cards[id]) fail(source + '包含未知卡牌：' + id);
    });
    return deck;
  }

  /* ---------- 基础状态 ---------- */

  function log(state, side, text) {
    state.log.push({ turn: state.turnNumber, side: side, text: text });
    if (state.log.length > LOG_LIMIT) state.log.shift();
  }

  function newSide(name) {
    return {
      name: name,
      hp: MAX_HP,
      maxHp: MAX_HP,
      gold: 0,
      combat: 0,
      deck: [],
      hand: [],
      discard: [],
      played: [],
      champions: []
    };
  }

  function ensurePlayable(state, side) {
    if (!state || !state.sides || !state.sides[side]) fail('未知阵营：' + side);
    if (state.winner) fail('游戏已经结束');
    if (state.turn !== side) fail('现在不是' + label(side) + '的回合');
  }

  function getCard(state, id) {
    var card = state.cards[id];
    if (!card) fail('未知卡牌：' + id);
    return card;
  }

  function drawCards(state, side, count, reason) {
    var s = state.sides[side];
    var drawn = 0;
    for (var i = 0; i < count; i += 1) {
      if (!s.deck.length) {
        if (!s.discard.length) break;
        state.rngState = (state.rngState + 0x9E3779B9) >>> 0;
        s.deck = shuffle(s.discard.slice(), state.rngState);
        s.discard = [];
        log(state, side, (reason || '') + '牌库耗尽，弃牌堆洗回牌库（' + s.deck.length + ' 张）');
      }
      s.hand.push(s.deck.shift());
      drawn += 1;
    }
    if (drawn > 0) log(state, side, (reason || '') + '抽了 ' + drawn + ' 张牌');
    else log(state, side, (reason || '') + '没有可抽的牌');
    return drawn;
  }

  function startTurn(state, side, draw) {
    var s = state.sides[side];
    state.turn = side;
    s.gold = 0;
    s.combat = 0;
    s.champions.forEach(function (ch) { ch.used = false; });
    log(state, side, '第 ' + state.turnNumber + ' 回合 · ' + label(side) + '回合开始');
    if (draw) drawCards(state, side, OPENING_HAND, '回合开始，');
  }

  /**
   * 创建一局新游戏。
   * opts:
   *   cards         卡牌数组或数据对象（默认 data.js）
   *   startingDeck  起始牌组 [{id,count}] 或 [id...]（默认 7 金币 + 3 匕首）
   *   decks         { player: [id...], ai: [id...] } 覆盖起始牌组（测试用）
   *   shuffle       默认 true；false 时保留顺序
   *   market        指定市场 5 张；marketDeck 指定补牌堆
   *   firstSide     'player' | 'ai'（默认 player）
   *   hp            覆盖初始生命（默认 50）
   *   seed          洗牌种子
   *   openingHand   首回合抽牌数（默认 5）
   */
  function createGame(opts) {
    opts = opts || {};
    var data = opts.cards || builtInData();
    if (!data) fail('缺少卡牌数据');
    var normalized = normalizeCards(data);

    var startingDef = opts.startingDeck ||
      (Array.isArray(data) ? null : data.startingDeck) ||
      [{ id: 'gold', count: 7 }, { id: 'dagger', count: 3 }];
    var starting = expandStarting(startingDef);

    var seed = opts.seed == null ? 20261110 : (Number(opts.seed) >>> 0);
    var hp = opts.hp == null ? MAX_HP : Math.max(1, Number(opts.hp) || MAX_HP);

    var state = {
      version: 2,
      seed: seed,
      rngState: seed || 1,
      maxHp: hp,
      turn: null,
      turnNumber: 1,
      winner: null,
      uidCounter: 1,
      cards: normalized.map,
      market: [],
      marketDeck: [],
      log: [],
      sides: {
        player: newSide((opts.names && opts.names[0]) || '你'),
        ai: newSide((opts.names && opts.names[1]) || '对手')
      }
    };
    SIDES.forEach(function (side) { state.sides[side].hp = hp; state.sides[side].maxHp = hp; });

    var pool = normalized.marketPool.slice();
    if (opts.shuffle !== false) pool = shuffle(pool, (seed + 101) >>> 0);
    if (opts.market) {
      validateDeck(state, opts.market, '市场');
      state.market = opts.market.slice(0, MARKET_SIZE);
      state.marketDeck = opts.marketDeck ? validateDeck(state, opts.marketDeck.slice(), '补牌堆') : [];
    } else {
      state.market = pool.splice(0, MARKET_SIZE);
      state.marketDeck = opts.marketDeck ? validateDeck(state, opts.marketDeck.slice(), '补牌堆') : pool;
    }

    SIDES.forEach(function (side, index) {
      var custom = opts.decks && opts.decks[side];
      var deck = custom ? custom.slice() : starting.slice();
      validateDeck(state, deck, label(side) + '牌库');
      if (opts.shuffle !== false) deck = shuffle(deck, (seed + 17 + index * 37) >>> 0);
      state.sides[side].deck = deck;
    });

    var firstSide = opts.firstSide || 'player';
    if (SIDES.indexOf(firstSide) < 0) fail('未知先手：' + firstSide);
    log(state, null, '对局开始，' + label(firstSide) + '先手');
    log(state, null, '双方 50 点生命；起始牌组 ' + starting.length + ' 张；市场 ' + state.market.length + ' 张');
    startTurn(state, firstSide, false);
    if (opts.openingHand !== 0) {
      drawCards(state, firstSide, opts.openingHand == null ? OPENING_HAND : opts.openingHand, '起手：');
    }
    return state;
  }

  /* ---------- 效果结算 ---------- */

  function healSide(state, side, amount, source) {
    var s = state.sides[side];
    var actual = Math.min(Math.max(0, amount), s.maxHp - s.hp);
    s.hp += actual;
    if (actual > 0) log(state, side, source + ' 恢复 ' + actual + ' 点生命（HP ' + s.hp + '/' + s.maxHp + '）');
    else log(state, side, source + ' 尝试治疗，但生命已满');
    return actual;
  }

  function applyEffects(state, side, effects, source) {
    if (!effects) return;
    var s = state.sides[side];
    if (effects.gold > 0) {
      s.gold += effects.gold;
      log(state, side, source + ' 获得 ' + effects.gold + ' 金币（当前 ' + s.gold + '）');
    }
    if (effects.combat > 0) {
      s.combat += effects.combat;
      log(state, side, source + ' 获得 ' + effects.combat + ' 战斗（战斗池 ' + s.combat + '）');
    }
    if (effects.heal > 0) healSide(state, side, effects.heal, source);
    if (effects.draw > 0) drawCards(state, side, effects.draw, source + ' 效果：');
  }

  function countFaction(state, side, faction) {
    var s = state.sides[side];
    var count = 0;
    s.played.forEach(function (id) {
      if (getCard(state, id).faction === faction) count += 1;
    });
    s.champions.forEach(function (ch) {
      if (getCard(state, ch.cardId).faction === faction) count += 1;
    });
    return count;
  }

  function findChampion(sideState, uid) {
    for (var i = 0; i < sideState.champions.length; i += 1) {
      if (sideState.champions[i].uid === uid) return { champion: sideState.champions[i], index: i };
    }
    return null;
  }

  /* ---------- 公开操作 ---------- */

  function playCard(state, side, handIndex) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (typeof handIndex !== 'number' || handIndex % 1 !== 0 ||
        handIndex < 0 || handIndex >= s.hand.length) {
      fail('手牌位置非法');
    }
    var cardId = s.hand[handIndex];
    var card = getCard(next, cardId);
    var allied = countFaction(next, side, card.faction) > 0;
    s.hand.splice(handIndex, 1);
    if (card.type === 'champion') {
      var defense = Math.max(1, card.defense || 1);
      s.champions.push({
        uid: next.uidCounter++,
        cardId: cardId,
        hp: defense,
        maxHp: defense,
        used: false
      });
      log(next, side, '打出冠军「' + cardName(card) + '」，防御 ' + defense);
    } else {
      s.played.push(cardId);
      log(next, side, '打出「' + cardName(card) + '」');
    }
    applyEffects(next, side, card.effects, '「' + cardName(card) + '」');
    if (allied && card.ally && Object.keys(card.ally).length) {
      log(next, side, '同盟触发 · ' + cardName(card) + '（场上已有同派系卡牌）');
      applyEffects(next, side, card.ally, '「' + cardName(card) + '」同盟');
    }
    return next;
  }

  function activateChampion(state, side, uid) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var found = findChampion(s, uid);
    if (!found) fail('冠军不存在');
    var ch = found.champion;
    if (ch.used) fail('该冠军本回合已经激活过');
    var card = getCard(next, ch.cardId);
    var ability = card.ability;
    if (!ability || !ability.type) fail('该冠军没有可激活能力');
    ch.used = true;
    var amount = Math.max(0, Math.floor(Number(ability.amount) || 0));
    log(next, side, '激活冠军「' + cardName(card) + '」：' + amount);
    if (ability.type === 'combat') applyEffects(next, side, { combat: amount }, '「' + cardName(card) + '」');
    else if (ability.type === 'gold') applyEffects(next, side, { gold: amount }, '「' + cardName(card) + '」');
    else if (ability.type === 'heal') applyEffects(next, side, { heal: amount }, '「' + cardName(card) + '」');
    else if (ability.type === 'draw') applyEffects(next, side, { draw: amount }, '「' + cardName(card) + '」');
    else fail('未知冠军能力：' + ability.type);
    return next;
  }

  // 购买不设每回合次数上限：只看当前金币是否足够。买到的牌直接进入弃牌堆，
  // 市场缺口立即从补牌堆补上。
  function buyCard(state, side, marketIndex) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (typeof marketIndex !== 'number' || marketIndex % 1 !== 0 ||
        marketIndex < 0 || marketIndex >= next.market.length) {
      fail('市场位置非法');
    }
    var cardId = next.market[marketIndex];
    var card = getCard(next, cardId);
    if (s.gold < card.cost) fail('金币不足：需要 ' + card.cost + '，当前 ' + s.gold);
    s.gold -= card.cost;
    s.discard.push(cardId);
    next.market.splice(marketIndex, 1);
    if (next.marketDeck.length) {
      next.market.splice(marketIndex, 0, next.marketDeck.shift());
    }
    log(next, side, '购买「' + cardName(card) + '」花费 ' + card.cost + ' 金币，放入弃牌堆（剩余 ' +
      s.gold + ' 金币，市场 ' + next.market.length + ' 张）');
    return next;
  }

  function attack(state, side, target, amount) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (s.combat <= 0) fail('战斗池为空');
    var foe = next.sides[otherSide(side)];
    target = target || { kind: 'player' };
    if (target.kind === 'player') {
      var use = amount == null ? s.combat : Math.floor(Number(amount));
      if (!(use > 0) || use > s.combat) fail('攻击伤害非法');
      s.combat -= use;
      foe.hp = Math.max(0, foe.hp - use);
      log(next, side, label(side) + ' 对 ' + label(otherSide(side)) + ' 造成 ' + use +
        ' 点伤害（剩余 HP ' + foe.hp + '，战斗池 ' + s.combat + '）');
      if (foe.hp <= 0 && !next.winner) {
        next.winner = side;
        log(next, side, label(otherSide(side)) + ' HP 归零，' + label(side) + '获得胜利！');
      }
      return next;
    }
    if (target.kind !== 'champion') fail('无效的攻击目标');
    var found = findChampion(foe, target.uid);
    if (!found) fail('目标冠军不存在');
    var ch = found.champion;
    var chCard = getCard(next, ch.cardId);
    var dmg = amount == null ? Math.min(s.combat, ch.hp) : Math.floor(Number(amount));
    if (!(dmg > 0) || dmg > s.combat) fail('攻击伤害非法');
    s.combat -= dmg;
    ch.hp -= dmg;
    log(next, side, label(side) + ' 对冠军「' + cardName(chCard) + '」造成 ' + dmg +
      ' 点伤害（剩余防御 ' + Math.max(0, ch.hp) + '，战斗池 ' + s.combat + '）');
    if (ch.hp <= 0) {
      foe.champions.splice(found.index, 1);
      foe.discard.push(ch.cardId);
      log(next, side, '冠军「' + cardName(chCard) + '」被击倒，进入对手弃牌堆');
    }
    return next;
  }

  function endTurn(state, side) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var discarded = s.hand.length + s.played.length;
    s.discard = s.discard.concat(s.hand, s.played);
    s.hand = [];
    s.played = [];
    s.gold = 0;
    s.combat = 0;
    log(next, side, '结束回合，弃掉 ' + discarded + ' 张牌');
    var nextSide = otherSide(side);
    next.turnNumber += 1;
    startTurn(next, nextSide, false);
    drawCards(next, nextSide, OPENING_HAND, '回合开始，');
    return next;
  }

  /* ---------- 合法动作 ---------- */

  function pushAttackActions(state, side, actions) {
    var s = state.sides[side];
    if (s.combat <= 0) return;
    var foe = state.sides[otherSide(side)];
    actions.push({ type: 'attack', side: side, target: { kind: 'player' }, amount: s.combat });
    foe.champions.forEach(function (ch) {
      actions.push({
        type: 'attack', side: side,
        target: { kind: 'champion', uid: ch.uid },
        amount: Math.min(s.combat, ch.hp)
      });
    });
  }

  function legalActions(state, side) {
    if (!state || !state.sides || !state.sides[side]) return [];
    if (state.winner || state.turn !== side) return [];
    var s = state.sides[side];
    var actions = [];
    s.hand.forEach(function (cardId, handIndex) {
      if (!getCard(state, cardId)) return;
      actions.push({ type: 'play', side: side, handIndex: handIndex });
    });
    s.champions.forEach(function (ch) {
      if (ch.used) return;
      var card = getCard(state, ch.cardId);
      if (!card.ability || !card.ability.type) return;
      actions.push({ type: 'activate', side: side, uid: ch.uid });
    });
    state.market.forEach(function (cardId, marketIndex) {
      var card = getCard(state, cardId);
      if (s.gold >= card.cost) actions.push({ type: 'buy', side: side, marketIndex: marketIndex });
    });
    pushAttackActions(state, side, actions);
    actions.push({ type: 'endTurn', side: side });
    return actions;
  }

  function applyAction(state, action) {
    if (!action || typeof action.type !== 'string') fail('无效动作');
    switch (action.type) {
      case 'play': return playCard(state, action.side, action.handIndex);
      case 'activate': return activateChampion(state, action.side, action.uid);
      case 'buy': return buyCard(state, action.side, action.marketIndex);
      case 'attack': return attack(state, action.side, action.target, action.amount);
      case 'endTurn': return endTurn(state, action.side);
      default: fail('未知动作：' + action.type);
    }
  }

  /* ---------- 启发式 AI ---------- */

  function effectValue(state, side, effects) {
    if (!effects) return 0;
    var s = state.sides[side];
    var v = 0;
    v += (effects.gold || 0) * 0.95;
    v += (effects.combat || 0) * 0.9;
    v += (effects.draw || 0) * 1.55;
    if (effects.heal) {
      var missing = s.maxHp - s.hp;
      v += Math.min(effects.heal, missing) * 0.8;
    }
    return v;
  }

  function cardValue(state, side, card) {
    var v = effectValue(state, side, card.effects);
    if (card.type === 'champion') {
      v += 2.2 + (card.defense || 0) * 0.55;
      if (card.ability) {
        var ab = card.ability;
        if (ab.type === 'combat') v += ab.amount * 0.8;
        else if (ab.type === 'gold') v += ab.amount * 0.75;
        else if (ab.type === 'heal') v += ab.amount * 0.5;
        else if (ab.type === 'draw') v += ab.amount * 1.2;
      }
    }
    return v;
  }

  function playActionScore(state, side, action) {
    var s = state.sides[side];
    var card = getCard(state, s.hand[action.handIndex]);
    var score = 1 + cardValue(state, side, card);
    if (card.ally && countFaction(state, side, card.faction) > 0) {
      score += effectValue(state, side, card.ally);
    }
    return score;
  }

  function activateActionScore(state, side, action) {
    var s = state.sides[side];
    var found = findChampion(s, action.uid);
    if (!found) return -100;
    var card = getCard(state, found.champion.cardId);
    var ab = card.ability || {};
    var amount = ab.amount || 0;
    if (ab.type === 'combat') return 1 + amount * 0.9;
    if (ab.type === 'gold') return 1 + amount * 0.85;
    if (ab.type === 'heal') {
      var missing = s.maxHp - s.hp;
      return 1 + (missing > 0 ? Math.min(amount, missing) * 0.85 : 0);
    }
    if (ab.type === 'draw') return 1 + amount * 1.5;
    return 0;
  }

  function buyActionScore(state, side, action) {
    var card = getCard(state, state.market[action.marketIndex]);
    var value = cardValue(state, side, card) + 1.4 - card.cost * 0.55;
    return value;
  }

  function attackActionScore(state, side, action) {
    if (!action.target || action.target.kind === 'player') {
      var foe = state.sides[otherSide(side)];
      if (action.amount >= foe.hp) return 10000;
      return 1 + action.amount * 0.9;
    }
    var foeSide = state.sides[otherSide(side)];
    var found = findChampion(foeSide, action.target.uid);
    if (!found) return -100;
    if (action.amount >= found.champion.hp) return 40 + found.champion.hp;
    return 0.8;
  }

  function actionScore(state, side, action) {
    if (action.type === 'play') return playActionScore(state, side, action);
    if (action.type === 'activate') return activateActionScore(state, side, action);
    if (action.type === 'buy') return buyActionScore(state, side, action);
    if (action.type === 'attack') return attackActionScore(state, side, action);
    return 0.1;
  }

  function aiAction(state, side) {
    if (!state || !state.sides || state.winner || state.turn !== side) return null;
    var actions = legalActions(state, side);
    if (!actions.length) return null;
    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < actions.length; i += 1) {
      var score = actionScore(state, side, actions[i]);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = actions[i];
      }
    }
    return best;
  }

  function step(state) {
    if (!state || state.winner) return { over: true };
    var side = state.turn;
    if (SIDES.indexOf(side) < 0) return { over: true };
    var action = aiAction(state, side);
    if (!action) return { over: true };
    return { action: action, state: applyAction(state, action) };
  }

  function aiAct(state, side) {
    var action = aiAction(state, side);
    if (!action) return null;
    return { action: action, state: applyAction(state, action) };
  }

  function selfPlay(seed, opts) {
    opts = opts || {};
    var state = createGame({
      seed: seed == null ? 1 : seed,
      cards: opts.cards,
      hp: opts.hp,
      firstSide: opts.firstSide || 'player',
      names: opts.names
    });
    var guard = 0;
    while (!state.winner) {
      guard += 1;
      if (guard > STEP_LIMIT) throw new Error('selfPlay step limit');
      var action = aiAction(state, state.turn);
      if (!action) break;
      state = applyAction(state, action);
    }
    return state;
  }

  /* ---------- 公共视图 ---------- */

  function sideView(state, side, viewer) {
    var s = state.sides[side];
    var mine = side === viewer;
    return {
      name: s.name,
      hp: s.hp,
      maxHp: s.maxHp,
      gold: s.gold,
      combat: s.combat,
      hand: mine ? s.hand.slice() : undefined,
      handCount: s.hand.length,
      deckCount: s.deck.length,
      discardCount: s.discard.length,
      discard: s.discard.slice(),
      played: s.played.slice(),
      champions: s.champions.map(function (ch) {
        return { uid: ch.uid, cardId: ch.cardId, hp: ch.hp, maxHp: ch.maxHp, used: ch.used };
      })
    };
  }

  function publicView(state, viewer) {
    var view = viewer === 'ai' ? 'ai' : 'player';
    return {
      phase: state.winner ? 'over' : 'playing',
      turn: state.turn,
      turnNumber: state.turnNumber,
      winner: state.winner,
      mySide: view,
      maxHp: state.maxHp,
      market: state.market.slice(),
      marketDeckCount: state.marketDeck.length,
      sides: {
        player: sideView(state, 'player', view),
        ai: sideView(state, 'ai', view)
      },
      log: state.log.slice()
    };
  }

  function winner(state) { return (state && state.winner) || null; }

  return {
    SIDES: SIDES,
    MAX_HP: MAX_HP,
    OPENING_HAND: OPENING_HAND,
    MARKET_SIZE: MARKET_SIZE,
    TYPES: TYPES,
    FACTIONS: FACTIONS,
    createGame: createGame,
    playCard: playCard,
    activateChampion: activateChampion,
    buyCard: buyCard,
    attack: attack,
    endTurn: endTurn,
    drawCards: drawCards,
    legalActions: legalActions,
    applyAction: applyAction,
    aiAction: aiAction,
    aiAct: aiAct,
    step: step,
    selfPlay: selfPlay,
    publicView: publicView,
    countFaction: countFaction,
    winner: winner,
    otherSide: otherSide,
    nextRandom: nextRandom
  };
});
