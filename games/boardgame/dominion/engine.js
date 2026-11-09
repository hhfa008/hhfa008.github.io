/*
 * Dominion（领土）简化版纯规则引擎 — UMD
 * 浏览器：globalThis.DominionEngine；Node：require('./engine.js')
 * 牌库构筑：行动牌、财宝、胜利卡，洗牌抽 5，行省/三堆空结束，牌库分高者胜。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominionEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CARDS = [
    { id: 'copper', name: '铜币', type: 'treasure', cost: 0, coins: 1, vp: 0 },
    { id: 'silver', name: '银币', type: 'treasure', cost: 3, coins: 2, vp: 0 },
    { id: 'gold', name: '金币', type: 'treasure', cost: 6, coins: 3, vp: 0 },
    { id: 'estate', name: '庄园', type: 'victory', cost: 2, vp: 2 },
    { id: 'duchy', name: '公国', type: 'victory', cost: 5, vp: 3 },
    { id: 'province', name: '行省', type: 'victory', cost: 8, vp: 6 },
    { id: 'village', name: '村庄', type: 'action', cost: 3, actions: 2, cards: 1 },
    { id: 'smithy', name: '铁匠', type: 'action', cost: 4, cards: 3 },
    { id: 'market', name: '市场', type: 'action', cost: 5, cards: 1, actions: 1, buys: 1, coins: 1 },
    { id: 'militia', name: '民兵', type: 'action', cost: 4, coins: 2, attack: true },
    { id: 'workshop', name: '工坊', type: 'action', cost: 4, gain: 'silver' }
  ];

  var SUPPLY = {
    copper: 60, silver: 40, gold: 30, estate: 24, duchy: 12, province: 12,
    village: 10, smithy: 10, market: 10, militia: 10, workshop: 10
  };

  var CARD_BY_ID = {};
  CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function nextRandom(st) {
    st.rng = (Math.imul(st.rng, 1664525) + 1013904223) >>> 0;
    return st.rng / 4294967296;
  }
  function shuffle(arr, st) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(nextRandom(st) * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function cardOf(id) { return CARD_BY_ID[id]; }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed >>> 0;
    var st = {
      seed: seed, rng: seed >>> 0, supply: clone(SUPPLY),
      players: [
        { name: '你', deck: [], hand: [], discard: [], playArea: [] },
        { name: 'AI', deck: [], hand: [], discard: [], playArea: [] }
      ],
      turn: opts.humanFirst === false ? 1 : 0,
      phase: 'action', actions: 1, buys: 1, coins: 0,
      log: [], over: false, moves: 0
    };
    st.supply.province = 12;
    for (var p = 0; p < 2; p++) {
      for (var i = 0; i < 7; i++) st.players[p].deck.push('copper');
      for (var j = 0; j < 3; j++) st.players[p].deck.push('estate');
      shuffle(st.players[p].deck, st);
      drawCards(st, st.players[p], 5);
    }
    st.log.push('开局：双方各 7 铜币 + 3 庄园，抽 5 张。' + (st.turn === 0 ? '你先手。' : 'AI 先手。'));
    return st;
  }

  function shuffleDiscardIntoDeck(st, p) {
    if (!p.deck.length && p.discard.length) {
      p.deck = shuffle(p.discard.slice(), st);
      p.discard = [];
    }
  }
  function drawCards(st, p, n) {
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) shuffleDiscardIntoDeck(st, p);
      if (!p.deck.length) break;
      p.hand.push(p.deck.pop());
    }
  }
  function gainCard(st, p, id) {
    if (st.supply[id] <= 0) return false;
    st.supply[id] -= 1;
    p.discard.push(id);
    return true;
  }
  function attackDiscard(p) {
    while (p.hand.length > 3) {
      var worst = 0;
      for (var i = 1; i < p.hand.length; i++) {
        var a = cardOf(p.hand[worst]), b = cardOf(p.hand[i]);
        if (discardValue(b) < discardValue(a)) worst = i;
      }
      p.discard.push(p.hand.splice(worst, 1)[0]);
    }
  }
  function discardValue(card) {
    if (card.vp) return -10;
    return (card.coins || 0) + (card.cards || 0) * 0.5 + (card.actions || 0) * 0.3 + (card.buys || 0) * 0.3;
  }

  function legalMoves(state) {
    if (state.over) return [];
    if (state.phase === 'action') {
      var p = state.players[state.turn];
      var moves = [];
      var seen = {};
      if (state.actions > 0) {
        p.hand.forEach(function (id) {
          if (cardOf(id).type === 'action' && !seen[id]) {
            seen[id] = true;
            moves.push({ type: 'playAction', cardId: id });
          }
        });
      }
      moves.push({ type: 'endPhase' });
      return moves;
    }
    if (state.phase === 'buy') {
      var out = [];
      if (state.buys > 0) {
        Object.keys(state.supply).forEach(function (id) {
          if (state.supply[id] > 0 && cardOf(id).cost <= state.coins) {
            out.push({ type: 'buy', cardId: id });
          }
        });
      }
      out.push({ type: 'endPhase' });
      return out;
    }
    return [];
  }

  function applyMove(state, move) {
    if (state.over) throw new Error('游戏已结束');
    if (state.moves >= 3000) throw new Error('动作数超限');
    var legal = legalMoves(state).some(function (m) {
      if (m.type !== move.type) return false;
      if (m.type === 'buy' || m.type === 'playAction') return m.cardId === move.cardId;
      return true;
    });
    if (!legal) throw new Error('非法动作: ' + JSON.stringify(move));
    var s = clone(state);
    var p = s.players[s.turn];
    s.moves += 1;

    if (move.type === 'playAction') {
      var idx = p.hand.indexOf(move.cardId);
      if (idx < 0) throw new Error('手牌中没有该牌');
      var card = cardOf(move.cardId);
      p.hand.splice(idx, 1);
      p.playArea.push(card.id);
      s.actions -= 1;
      s.log.push(p.name + ' 打出' + card.name + '。');
      if (card.cards) drawCards(s, p, card.cards);
      if (card.actions) s.actions += card.actions;
      if (card.buys) s.buys += card.buys;
      if (card.coins) s.coins += card.coins;
      if (card.attack) {
        attackDiscard(s.players[1 - s.turn]);
        s.log.push('对手被迫弃牌至 3 张。');
      }
      if (card.gain && gainCard(s, p, card.gain)) {
        s.log.push(p.name + ' 的工坊获得一张银币。');
      }
      return s;
    }

    if (move.type === 'buy') {
      var bought = cardOf(move.cardId);
      if (s.supply[move.cardId] <= 0) throw new Error('该牌堆已空');
      if (s.coins < bought.cost) throw new Error('金币不足');
      if (s.buys <= 0) throw new Error('没有购买次数');
      s.coins -= bought.cost;
      s.buys -= 1;
      s.supply[move.cardId] -= 1;
      p.discard.push(bought.id);
      s.log.push(p.name + ' 买入' + bought.name + '（花费 ' + bought.cost + '）。');
      return s;
    }

    if (move.type === 'endPhase') {
      if (s.phase === 'action') {
        s.phase = 'buy';
        var treasureCoins = 0;
        for (var i = p.hand.length - 1; i >= 0; i--) {
          var c = cardOf(p.hand[i]);
          if (c.type === 'treasure') {
            treasureCoins += c.coins;
            p.playArea.push(p.hand.splice(i, 1)[0]);
          }
        }
        s.coins += treasureCoins;
        s.log.push(p.name + ' 打出财宝，获得 ' + treasureCoins + ' 金币（共 ' + s.coins + '）。');
        return s;
      }
      /* 购买阶段结束：弃牌、抽 5、检查结束条件。 */
      p.discard = p.discard.concat(p.hand, p.playArea);
      p.hand = [];
      p.playArea = [];
      drawCards(s, p, 5);
      s.actions = 1;
      s.buys = 1;
      s.coins = 0;
      s.phase = 'action';
      var emptyPiles = Object.keys(s.supply).filter(function (id) { return s.supply[id] <= 0; }).length;
      if (s.supply.province <= 0 || emptyPiles >= 3) {
        s.over = true;
        s.log.push('行省堆空或三个牌堆耗尽，游戏结束。');
        return s;
      }
      s.turn = 1 - s.turn;
      return s;
    }
    throw new Error('未知动作');
  }

  function score(state) {
    function total(p) {
      var all = p.deck.concat(p.hand, p.discard, p.playArea);
      var vp = 0;
      all.forEach(function (id) { vp += cardOf(id).vp || 0; });
      return vp;
    }
    return { human: total(state.players[0]), ai: total(state.players[1]) };
  }
  function isOver(state) { return !!state.over; }
  function winner(state) {
    var sc = score(state);
    if (sc.human === sc.ai) return 'tie';
    return sc.human > sc.ai ? 'human' : 'ai';
  }

  function aiMove(state) {
    var legal = legalMoves(state);
    if (!legal.length) throw new Error('无合法动作');
    var me = state.players[state.turn];
    if (state.phase === 'action') {
      var actions = legal.filter(function (m) { return m.type === 'playAction'; });
      if (actions.length && state.actions > 0) {
        var order = ['militia', 'smithy', 'market', 'village', 'workshop'];
        actions.sort(function (x, y) { return order.indexOf(x.cardId) - order.indexOf(y.cardId); });
        var opp = state.players[1 - state.turn];
        if (actions[0].cardId === 'militia' && opp.hand.length <= 3) {
          if (actions.length > 1) return actions[1];
          return { type: 'endPhase' };
        }
        return actions[0];
      }
      return { type: 'endPhase' };
    }
    var buys = legal.filter(function (m) { return m.type === 'buy'; });
    var priority = ['province', 'gold', 'duchy', 'market', 'smithy', 'militia', 'village', 'workshop', 'silver', 'copper'];
    for (var i = 0; i < priority.length; i++) {
      var found = buys.filter(function (m) { return m.cardId === priority[i]; })[0];
      if (found) return found;
    }
    return { type: 'endPhase' };
  }

  return {
    CARDS: CARDS, SUPPLY: SUPPLY, CARD_BY_ID: CARD_BY_ID,
    createGame: createGame, legalMoves: legalMoves, applyMove: applyMove,
    aiMove: aiMove, isOver: isOver, score: score, winner: winner,
    cardOf: cardOf, discardValue: discardValue
  };
});
