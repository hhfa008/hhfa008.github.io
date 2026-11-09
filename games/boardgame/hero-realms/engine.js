/*
 * Hero Realms（英雄领域）简化版 — 纯规则引擎（UMD）。
 *
 *   浏览器：<script src="engine.js"></script> → window.HeroRealmsEngine
 *   Node：  var E = require('./engine.js')
 *
 * 设计约束：
 *   - 纯规则，无 DOM / 网络 / 计时器；
 *   - 所有公开操作返回新 state，不修改入参；
 *   - state 只含 JSON 可序列化数据；
 *   - 随机性由 state.rngState 驱动，同一 seed + 同一操作序列结果一致。
 *
 * 简化点（详见 rules.html）：
 *   - 双方 50 HP；起始牌组 7 金币 + 3 匕首；
 *   - 每回合开始抽 5 张，金币与护甲在回合开始时重置；
 *   - 每回合可购买 1 张市场牌，买入后直接进入弃牌堆；
 *   - 冠军留在场上，有防御力，每回合可激活一次能力，可被对手伤害击杀。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.HeroRealmsEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SIDES = ['player', 'ai'];
  var MAX_HP = 50;
  var OPENING_HAND = 5;
  var MARKET_SIZE = 5;
  var MAX_CHAMPIONS = 4;
  var LOG_LIMIT = 240;

  function fail(message) { throw new Error(message); }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }

  function otherSide(side) { return side === 'player' ? 'ai' : 'player'; }

  function label(side) { return side === 'player' ? '你' : '对手'; }

  function cardName(card) { return card && card.name ? card.name : (card && card.id) || '未知卡牌'; }

  /* ---------- 确定性随机 ---------- */

  // mulberry32 的单步版本：把状态放在 state.rngState 里，便于序列化与回放。
  function nextRandom(state) {
    var a = (state.rngState | 0) + 0x6D2B79F5 | 0;
    state.rngState = a;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffle(list, state) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(nextRandom(state) * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function builtInData() {
    if (root.HeroRealmsData) return root.HeroRealmsData;
    if (typeof require === 'function') {
      try { return require('./data.js'); } catch (e) { /* 浏览器或独立测试 */ }
    }
    return null;
  }

  /* ---------- 数据归一化 ---------- */

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
      if (['gold', 'gem', 'weapon', 'spell', 'champion'].indexOf(card.type) < 0) {
        fail('未知卡牌类型：' + card.id + ' / ' + card.type);
      }
      if (typeof card.cost !== 'number' || card.cost < 0) fail('卡牌价格非法：' + card.id);
      var def = clone(card);
      if (def.type === 'champion' && !(def.defense > 0)) def.defense = 1;
      map[def.id] = def;
      if (!def.starting) marketPool.push(def.id);
    });
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
          for (var i = 0; i < n; i++) out.push(entry.id);
        }
      });
      return out;
    }
    if (typeof def === 'object') {
      Object.keys(def).forEach(function (id) {
        var n = def[id] || 0;
        for (var i = 0; i < n; i++) out.push(id);
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

  /* ---------- 日志与基础状态 ---------- */

  function log(state, side, text) {
    state.log.push({ turn: state.turnNumber, side: side, text: text });
    if (state.log.length > LOG_LIMIT) state.log.shift();
  }

  function newSide(name) {
    return {
      name: name,
      hp: MAX_HP,
      maxHp: MAX_HP,
      armor: 0,
      gold: 0,
      deck: [],
      hand: [],
      discard: [],
      played: [],
      champions: [],
      boughtThisTurn: false
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
    for (var i = 0; i < count; i++) {
      if (!s.deck.length) {
        if (!s.discard.length) break;
        s.deck = shuffle(s.discard.slice(), state);
        s.discard = [];
        log(state, side, (reason || '') + '牌库耗尽，弃牌堆洗回牌库（' + s.deck.length + ' 张）');
      }
      s.hand.push(s.deck.shift());
      drawn++;
    }
    if (drawn > 0) log(state, side, (reason || '') + '抽了 ' + drawn + ' 张牌');
    else log(state, side, (reason || '') + '没有可抽的牌');
    return drawn;
  }

  function startTurn(state, side, draw) {
    var s = state.sides[side];
    state.turn = side;
    s.gold = 0;
    s.armor = 0;
    s.boughtThisTurn = false;
    s.champions.forEach(function (ch) { ch.used = false; });
    log(state, side, '第 ' + state.turnNumber + ' 回合 · ' + label(side) + '回合开始');
    if (draw) drawCards(state, side, OPENING_HAND, '回合开始，');
  }

  /**
   * 创建一局新游戏。
   * opts:
   *   cards         卡牌数组或数据对象（默认 window.HeroRealmsData / require('./data.js')）
   *   startingDeck  起始牌组 [{id,count}] 或 [id...]（默认数据里的 7 金币 + 3 匕首）
   *   decks         { player: [id...], ai: [id...] } 覆盖起始牌组（测试用）
   *   shuffle       默认 true；false 时保留 decks/起始牌组顺序
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

    var seed = opts.seed == null ? 20260101 : (Number(opts.seed) >>> 0);
    var hp = opts.hp == null ? MAX_HP : Math.max(1, Number(opts.hp) || MAX_HP);

    var state = {
      version: 1,
      seed: seed,
      rngState: seed,
      hp: hp,
      turn: null,
      turnNumber: 1,
      winner: null,
      uidCounter: 1,
      cards: normalized.map,
      market: [],
      marketDeck: [],
      log: [],
      sides: {
        player: newSide('你'),
        ai: newSide('对手')
      }
    };
    SIDES.forEach(function (side) { state.sides[side].hp = hp; state.sides[side].maxHp = hp; });

    // 市场：默认把非起始牌洗混，取前 5 张公开，其余作为补牌堆。
    var pool = normalized.marketPool.slice();
    if (opts.shuffle !== false) shuffle(pool, state);
    if (opts.market) {
      validateDeck(state, opts.market, '市场');
      state.market = opts.market.slice(0, MARKET_SIZE);
      state.marketDeck = opts.marketDeck ? validateDeck(state, opts.marketDeck.slice(), '补牌堆') : [];
    } else {
      state.market = pool.splice(0, MARKET_SIZE);
      state.marketDeck = opts.marketDeck ? validateDeck(state, opts.marketDeck.slice(), '补牌堆') : pool;
    }

    SIDES.forEach(function (side) {
      var custom = opts.decks && opts.decks[side];
      var deck = custom ? custom.slice() : starting.slice();
      validateDeck(state, deck, label(side) + '牌库');
      if (opts.shuffle !== false) shuffle(deck, state);
      state.sides[side].deck = deck;
    });

    var firstSide = opts.firstSide || 'player';
    if (SIDES.indexOf(firstSide) < 0) fail('未知先手：' + firstSide);
    state.turn = firstSide;
    log(state, null, '对局开始，' + label(firstSide) + '先手');
    log(state, null, '牌库：' + starting.length + ' 张起始牌，市场 ' + state.market.length + ' 张');
    startTurn(state, firstSide, false);
    if (opts.openingHand !== 0) drawCards(state, firstSide, opts.openingHand == null ? OPENING_HAND : opts.openingHand, '起手：');
    return state;
  }

  /* ---------- 伤害与效果 ---------- */

  function resolveTarget(state, attackerSide, target) {
    if (!target || target.kind === 'player') return { kind: 'player' };
    if (target.kind !== 'champion') fail('无效的目标');
    var foe = state.sides[otherSide(attackerSide)];
    for (var i = 0; i < foe.champions.length; i++) {
      if (foe.champions[i].uid === target.uid) return { kind: 'champion', uid: target.uid };
    }
    fail('目标冠军不存在');
    return null;
  }

  function dealDamage(state, sourceSide, target, amount, sourceName) {
    var dmg = Math.max(0, Math.floor(Number(amount) || 0));
    if (!dmg) return 0;
    var resolved = resolveTarget(state, sourceSide, target);
    var foe = state.sides[otherSide(sourceSide)];
    var from = sourceName || '效果';
    if (resolved.kind === 'player') {
      var absorbed = Math.min(foe.armor, dmg);
      var real = dmg - absorbed;
      foe.armor -= absorbed;
      foe.hp = Math.max(0, foe.hp - real);
      log(state, sourceSide, from + ' 对 ' + label(otherSide(sourceSide)) + ' 造成 ' + dmg +
        ' 点伤害' + (absorbed ? '（护甲吸收 ' + absorbed + '）' : '') + '，剩余 HP ' + foe.hp);
      if (foe.hp <= 0 && !state.winner) {
        state.winner = sourceSide;
        log(state, sourceSide, label(otherSide(sourceSide)) + ' HP 归零，' + label(sourceSide) + '获得胜利！');
      }
      return dmg;
    }
    var idx = -1;
    for (var i = 0; i < foe.champions.length; i++) {
      if (foe.champions[i].uid === resolved.uid) { idx = i; break; }
    }
    if (idx < 0) fail('目标冠军不存在');
    var ch = foe.champions[idx];
    var chCard = getCard(state, ch.cardId);
    ch.hp -= dmg;
    log(state, sourceSide, from + ' 对冠军「' + cardName(chCard) + '」造成 ' + dmg +
      ' 点伤害，剩余防御 ' + Math.max(0, ch.hp));
    if (ch.hp <= 0) {
      foe.champions.splice(idx, 1);
      foe.discard.push(ch.cardId);
      log(state, sourceSide, '冠军「' + cardName(chCard) + '」被击杀，进入' +
        label(otherSide(sourceSide)) + '的弃牌堆');
    }
    return dmg;
  }

  function applyEffects(state, side, card, target) {
    var s = state.sides[side];
    var e = card.effects || {};
    var name = '「' + cardName(card) + '」';
    if (e.gold > 0) {
      s.gold += e.gold;
      log(state, side, name + ' 获得 ' + e.gold + ' 金币（当前 ' + s.gold + '）');
    }
    if (e.armor > 0) {
      s.armor += e.armor;
      log(state, side, name + ' 获得 ' + e.armor + ' 点护甲（当前 ' + s.armor + '）');
    }
    if (e.heal > 0) {
      var actual = Math.min(e.heal, s.maxHp - s.hp);
      s.hp += actual;
      log(state, side, name + ' 恢复 ' + actual + ' 点生命（HP ' + s.hp + '/' + s.maxHp + '）');
    }
    if (e.draw > 0) drawCards(state, side, e.draw, name + ' 效果：');
    if (e.damage > 0) dealDamage(state, side, target, e.damage, name);
  }

  function findChampion(sideState, uid) {
    for (var i = 0; i < sideState.champions.length; i++) {
      if (sideState.champions[i].uid === uid) return sideState.champions[i];
    }
    return null;
  }

  /* ---------- 公开操作 ---------- */

  function playCard(state, side, handIndex, target) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (typeof handIndex !== 'number' || handIndex % 1 !== 0 ||
        handIndex < 0 || handIndex >= s.hand.length) {
      fail('手牌位置非法');
    }
    var cardId = s.hand[handIndex];
    var card = getCard(next, cardId);
    if (card.type === 'champion' && s.champions.length >= MAX_CHAMPIONS) {
      fail('冠军区已满（最多 ' + MAX_CHAMPIONS + ' 名）');
    }
    s.hand.splice(handIndex, 1);
    if (card.type === 'champion') {
      // 冠军牌留在冠军区，不进入本回合的弃牌堆；被击杀时才进入弃牌堆。
      var defense = Math.max(1, card.defense || 1);
      s.champions.push({
        uid: next.uidCounter++,
        cardId: cardId,
        hp: defense,
        maxHp: defense,
        used: false
      });
      log(next, side, '打出「' + cardName(card) + '」，进入冠军区（防御 ' + defense + '）');
    } else {
      s.played.push(cardId);
      log(next, side, '打出「' + cardName(card) + '」');
    }
    applyEffects(next, side, card, target);
    return next;
  }

  function activateChampion(state, side, uid, target) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    var ch = findChampion(s, uid);
    if (!ch) fail('冠军不存在');
    if (ch.used) fail('该冠军本回合已经激活过');
    var card = getCard(next, ch.cardId);
    var ability = card.ability;
    if (!ability || !ability.type) fail('该冠军没有可激活能力');
    var amount = Math.max(0, Math.floor(Number(ability.amount) || 0));
    log(next, side, '激活冠军「' + cardName(card) + '」的能力');
    if (ability.type === 'damage') {
      dealDamage(next, side, target, amount, '「' + cardName(card) + '」');
    } else if (ability.type === 'heal') {
      var healed = Math.min(amount, s.maxHp - s.hp);
      s.hp += healed;
      log(next, side, '恢复 ' + healed + ' 点生命（HP ' + s.hp + '/' + s.maxHp + '）');
    } else if (ability.type === 'gold') {
      s.gold += amount;
      log(next, side, '获得 ' + amount + ' 金币（当前 ' + s.gold + '）');
    } else if (ability.type === 'armor') {
      s.armor += amount;
      log(next, side, '获得 ' + amount + ' 点护甲（当前 ' + s.armor + '）');
    } else if (ability.type === 'draw') {
      drawCards(next, side, amount, '「' + cardName(card) + '」能力：');
    } else {
      fail('未知冠军能力：' + ability.type);
    }
    ch.used = true;
    return next;
  }

  function buyCard(state, side, marketIndex) {
    var next = clone(state);
    ensurePlayable(next, side);
    var s = next.sides[side];
    if (s.boughtThisTurn) fail('本回合已经购买过一张牌');
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
    s.boughtThisTurn = true;
    log(next, side, '购买「' + cardName(card) + '」花费 ' + card.cost + ' 金币，放入弃牌堆（剩余 ' +
      s.gold + ' 金币）');
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
    s.boughtThisTurn = false;
    log(next, side, '结束回合，弃掉 ' + discarded + ' 张牌');
    var nextSide = otherSide(side);
    next.turnNumber += 1;
    startTurn(next, nextSide, false);
    drawCards(next, nextSide, OPENING_HAND, '回合开始，');
    return next;
  }

  /* ---------- 合法动作 ---------- */

  function pushPlayActions(state, side, actions) {
    var s = state.sides[side];
    s.hand.forEach(function (cardId, handIndex) {
      var card = getCard(state, cardId);
      if (card.type === 'champion' && s.champions.length >= MAX_CHAMPIONS) return;
      var damage = (card.effects && card.effects.damage) || 0;
      if (damage > 0) {
        actions.push({ type: 'play', side: side, handIndex: handIndex, target: { kind: 'player' } });
        state.sides[otherSide(side)].champions.forEach(function (ch) {
          actions.push({
            type: 'play', side: side, handIndex: handIndex,
            target: { kind: 'champion', uid: ch.uid }
          });
        });
      } else {
        actions.push({ type: 'play', side: side, handIndex: handIndex });
      }
    });
    s.champions.forEach(function (ch) {
      if (ch.used) return;
      var card = getCard(state, ch.cardId);
      var ability = card.ability;
      if (!ability || !ability.type) return;
      if (ability.type === 'damage') {
        actions.push({ type: 'activate', side: side, uid: ch.uid, target: { kind: 'player' } });
        state.sides[otherSide(side)].champions.forEach(function (foe) {
          actions.push({
            type: 'activate', side: side, uid: ch.uid,
            target: { kind: 'champion', uid: foe.uid }
          });
        });
      } else {
        actions.push({ type: 'activate', side: side, uid: ch.uid });
      }
    });
  }

  function legalActions(state, side) {
    if (!state || !state.sides || !state.sides[side]) return [];
    if (state.winner || state.turn !== side) return [];
    var s = state.sides[side];
    var actions = [];
    pushPlayActions(state, side, actions);
    if (!s.boughtThisTurn) {
      state.market.forEach(function (cardId, marketIndex) {
        var card = getCard(state, cardId);
        if (s.gold >= card.cost) {
          actions.push({ type: 'buy', side: side, marketIndex: marketIndex });
        }
      });
    }
    actions.push({ type: 'endTurn', side: side });
    return actions;
  }

  function applyAction(state, action) {
    if (!action || typeof action.type !== 'string') fail('无效动作');
    switch (action.type) {
      case 'play': return playCard(state, action.side, action.handIndex, action.target);
      case 'activate': return activateChampion(state, action.side, action.uid, action.target);
      case 'buy': return buyCard(state, action.side, action.marketIndex);
      case 'endTurn': return endTurn(state, action.side);
      default: fail('未知动作：' + action.type);
    }
  }

  /* ---------- 启发式 AI ---------- */

  function targetScore(state, side, target, damage) {
    if (!target || target.kind === 'player') {
      var foe = state.sides[otherSide(side)];
      if (damage >= foe.hp + foe.armor) return 120;
      return 2;
    }
    var foeSide = state.sides[otherSide(side)];
    var ch = findChampion(foeSide, target.uid);
    if (!ch) return -100;
    if (damage >= ch.hp) return 45 + ch.hp;
    return -4;
  }

  function buyValue(state, side, card) {
    var e = card.effects || {};
    var v = 0;
    v += (e.gold || 0) * 0.8;
    v += (e.draw || 0) * 1.0;
    v += (e.damage || 0) * 1.1;
    v += (e.heal || 0) * 0.5;
    v += (e.armor || 0) * 0.5;
    if (card.type === 'champion') {
      v += 2.5 + (card.defense || 0) * 0.35;
      var ab = card.ability || {};
      if (ab.type === 'damage') v += (ab.amount || 0) * 1.0;
      else if (ab.type === 'gold') v += (ab.amount || 0) * 0.8;
      else if (ab.type === 'heal') v += (ab.amount || 0) * 0.5;
      else if (ab.type === 'armor') v += (ab.amount || 0) * 0.5;
      else if (ab.type === 'draw') v += (ab.amount || 0) * 0.8;
    }
    if (card.type === 'gem') v += 0.3;
    v -= card.cost * 0.2;
    return v;
  }

  function playActionScore(state, side, action) {
    var s = state.sides[side];
    var card = getCard(state, s.hand[action.handIndex]);
    var e = card.effects || {};
    var score = 1;
    if (card.type === 'champion') score += 3 + (card.defense || 0) * 0.4;
    score += (e.gold || 0) * 0.9;
    score += (e.draw || 0) * 0.9;
    score += (e.armor || 0) * 0.55;
    if (e.heal) {
      var missing = s.maxHp - s.hp;
      score += missing > 0 ? Math.min(e.heal, missing) * 1.1 : 0.05;
    }
    if (e.damage) {
      score += e.damage * 1.05;
      score += targetScore(state, side, action.target, e.damage);
    }
    return score;
  }

  function activateActionScore(state, side, action) {
    var s = state.sides[side];
    var ch = findChampion(s, action.uid);
    if (!ch) return -100;
    var card = getCard(state, ch.cardId);
    var ab = card.ability || {};
    var amount = ab.amount || 0;
    if (ab.type === 'damage') return 1 + amount * 1.1 + targetScore(state, side, action.target, amount);
    if (ab.type === 'heal') {
      var missing = s.maxHp - s.hp;
      return 1 + (missing > 0 ? Math.min(amount, missing) * 1.15 : 0.05);
    }
    if (ab.type === 'gold') return 1 + amount * 1.0;
    if (ab.type === 'armor') return 1 + amount * 0.7;
    if (ab.type === 'draw') return 1 + amount * 1.0;
    return 0.5;
  }

  function actionScore(state, side, action) {
    if (action.type === 'endTurn') return 0;
    if (action.type === 'play') return playActionScore(state, side, action);
    if (action.type === 'activate') return activateActionScore(state, side, action);
    if (action.type === 'buy') {
      var card = getCard(state, state.market[action.marketIndex]);
      return 2 + Math.max(0, buyValue(state, side, card));
    }
    return 0;
  }

  /*
   * 启发式 AI：从 legalActions 中按分数挑选，因此每一步都必然合法。
   * 优先打出经济/伤害/冠军牌与激活能力，然后购买性价比最高的牌，
   * 没有别的可做时结束回合。返回 null 仅发生在游戏已结束或不是该方回合。
   */
  function aiAction(state, side) {
    if (!state || !state.sides || state.winner || state.turn !== side) return null;
    var actions = legalActions(state, side);
    if (!actions.length) return null;
    var best = actions[actions.length - 1];
    var bestScore = -Infinity;
    for (var i = 0; i < actions.length; i++) {
      var sc = actionScore(state, side, actions[i]);
      if (sc > bestScore + 1e-9) {
        bestScore = sc;
        best = actions[i];
      }
    }
    return best;
  }

  function winner(state) { return (state && state.winner) || null; }

  return {
    SIDES: SIDES,
    MAX_HP: MAX_HP,
    OPENING_HAND: OPENING_HAND,
    MARKET_SIZE: MARKET_SIZE,
    MAX_CHAMPIONS: MAX_CHAMPIONS,
    createGame: createGame,
    playCard: playCard,
    activateChampion: activateChampion,
    buyCard: buyCard,
    endTurn: endTurn,
    drawCards: drawCards,
    legalActions: legalActions,
    applyAction: applyAction,
    aiAction: aiAction,
    winner: winner,
    otherSide: otherSide
  };
});
