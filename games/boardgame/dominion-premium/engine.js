/*
 * Dominion（领土）premium 纯规则引擎 — UMD
 *
 * 浏览器：globalThis.DominionEngine；Node：require('./engine.js')。
 * 牌库构筑：行动阶段打行动牌，购买阶段自动打出财宝并用金币买牌；
 * 行省堆空或任意三堆耗尽即终局，所有区域里的胜利卡决定胜负。
 * 无 DOM、无网络，页面与测试共用同一份规则。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.DominionEngine = factory(root.DominionData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  var CARDS = DATA.CARDS;
  var CARD_BY_ID = DATA.CARD_BY_ID;
  var MAX_MOVES = 5000;

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
  function cardOf(id) { return CARD_BY_ID[id] || null; }
  function allCards(p) { return p.deck.concat(p.hand, p.discard, p.playArea); }
  function countCard(p, id) {
    return allCards(p).filter(function (x) { return x === id; }).length;
  }
  function emptyPileCount(state) {
    return Object.keys(state.supply).filter(function (id) { return state.supply[id] <= 0; }).length;
  }
  function shuffleDiscardIntoDeck(st, p) {
    if (!p.deck.length && p.discard.length) {
      p.deck = shuffle(p.discard.slice(), st);
      p.discard = [];
    }
  }
  function drawCards(st, p, n) {
    var drawn = 0;
    for (var i = 0; i < n; i++) {
      if (!p.deck.length) shuffleDiscardIntoDeck(st, p);
      if (!p.deck.length) break;
      p.hand.push(p.deck.pop());
      drawn++;
    }
    return drawn;
  }
  function gainCard(st, p, id) {
    if (!CARD_BY_ID[id]) return false;
    if (!st.supply[id] || st.supply[id] <= 0) return false;
    st.supply[id] -= 1;
    p.discard.push(id);
    return true;
  }
  function discardValue(id) {
    var c = cardOf(id);
    if (!c) return 0;
    if (c.type === 'victory') return -10 + (c.vp || 0);
    return (c.coins || 0) * 1.2 + (c.cards || 0) * 0.55 + (c.actions || 0) * 0.35 + (c.buys || 0) * 0.35;
  }
  function discardDownTo(p, size) {
    var discarded = [];
    while (p.hand.length > size) {
      var worst = 0;
      for (var i = 1; i < p.hand.length; i++) {
        if (discardValue(p.hand[i]) < discardValue(p.hand[worst])) worst = i;
      }
      var id = p.hand.splice(worst, 1)[0];
      p.discard.push(id);
      discarded.push(id);
    }
    return discarded;
  }

  /* ------------------------------------------------------------------ */
  /* 开局                                                                */
  /* ------------------------------------------------------------------ */
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed >>> 0;
    var st = {
      seed: seed,
      rng: seed >>> 0,
      supply: clone(DATA.SUPPLY),
      players: [
        { name: (opts.names && opts.names[0]) || DATA.PLAYER_NAMES[0], isAI: false, deck: [], hand: [], discard: [], playArea: [] },
        { name: (opts.names && opts.names[1]) || DATA.PLAYER_NAMES[1], isAI: true, deck: [], hand: [], discard: [], playArea: [] }
      ],
      turn: opts.humanFirst === false ? 1 : 0,
      phase: 'action',
      actions: 1,
      buys: 1,
      coins: 0,
      log: [],
      events: [],
      over: false,
      moves: 0,
      result: null
    };
    st.players.forEach(function (p) {
      p.deck = shuffle(DATA.STARTING_DECK.slice(), st);
      drawCards(st, p, DATA.STARTING_HAND);
    });
    st.log.push({ turn: 1, player: null, type: 'system', text: '开局：双方各 7 铜币 + 3 庄园，抽 5 张。' + (st.turn === 0 ? '你先手。' : 'AI 先手。') });
    return st;
  }

  /* ------------------------------------------------------------------ */
  /* 合法动作                                                            */
  /* ------------------------------------------------------------------ */
  function legalMoves(state) {
    if (state.over) return [];
    var moves = [];
    var p = state.players[state.turn];
    if (state.phase === 'action') {
      if (state.actions > 0) {
        var seen = Object.create(null);
        p.hand.forEach(function (id) {
          var c = cardOf(id);
          if (c && c.type === 'action' && !seen[id]) {
            seen[id] = true;
            moves.push({ type: 'playAction', cardId: id });
          }
        });
      }
      moves.push({ type: 'endPhase' });
      return moves;
    }
    if (state.phase === 'buy') {
      if (state.buys > 0) {
        CARDS.forEach(function (c) {
          if (state.supply[c.id] > 0 && c.cost <= state.coins) moves.push({ type: 'buy', cardId: c.id });
        });
      }
      moves.push({ type: 'endPhase' });
      return moves;
    }
    return moves;
  }

  function findMove(legal, move) {
    return legal.some(function (m) {
      if (m.type !== move.type) return false;
      if (m.type === 'buy' || m.type === 'playAction') return m.cardId === move.cardId;
      return true;
    });
  }

  /* ------------------------------------------------------------------ */
  /* 执行动作                                                            */
  /* ------------------------------------------------------------------ */
  function pushLog(s, type, text, player) {
    s.log.push({ turn: s.moves + 1, player: player == null ? null : player, type: type, text: text });
    if (s.log.length > 220) s.log.splice(0, s.log.length - 220);
  }
  function pushEvent(s, ev) {
    s.events.push(ev);
    if (s.events.length > 80) s.events.splice(0, s.events.length - 80);
  }

  function applyMove(state, move) {
    if (!state || state.over) throw new Error('游戏已结束');
    if (state.moves >= MAX_MOVES) throw new Error('动作数超限');
    if (!findMove(legalMoves(state), move)) throw new Error('非法动作: ' + JSON.stringify(move));
    var s = clone(state);
    var p = s.players[s.turn];
    s.moves += 1;

    if (move.type === 'playAction') {
      var idx = p.hand.indexOf(move.cardId);
      if (idx < 0) throw new Error('手牌中没有该牌');
      var c = cardOf(move.cardId);
      p.hand.splice(idx, 1);
      p.playArea.push(c.id);
      s.actions -= 1;
      pushLog(s, 'action', p.name + ' 打出「' + c.name + '」。', s.turn);
      pushEvent(s, { kind: 'play', player: s.turn, cardId: c.id, phase: 'action' });
      if (c.cards) {
        var drawn = drawCards(s, p, c.cards);
        pushEvent(s, { kind: 'draw', player: s.turn, count: drawn });
      }
      if (c.actions) s.actions += c.actions;
      if (c.buys) s.buys += c.buys;
      if (c.coins) s.coins += c.coins;
      if (c.gain) {
        if (gainCard(s, p, c.gain)) {
          pushLog(s, 'gain', p.name + ' 的工坊获得一张「' + cardOf(c.gain).name + '」。', s.turn);
          pushEvent(s, { kind: 'gain', player: s.turn, cardId: c.gain });
        }
      }
      if (c.attack) {
        var opp = s.players[1 - s.turn];
        var before = opp.hand.length;
        var discarded = discardDownTo(opp, 3);
        if (discarded.length) {
          pushLog(s, 'attack', p.name + ' 的民兵使对手弃掉 ' + discarded.length + ' 张牌。', s.turn);
          pushEvent(s, { kind: 'attack', player: s.turn, target: 1 - s.turn, count: before - opp.hand.length });
        }
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
      pushLog(s, 'buy', p.name + ' 买入「' + bought.name + '」（花费 ' + bought.cost + ' 金币）。', s.turn);
      pushEvent(s, { kind: 'buy', player: s.turn, cardId: bought.id, left: s.supply[bought.id] });
      return s;
    }

    if (move.type === 'endPhase') {
      if (s.phase === 'action') {
        s.phase = 'buy';
        var treasureCoins = 0, treasures = [];
        for (var i = p.hand.length - 1; i >= 0; i--) {
          var td = cardOf(p.hand[i]);
          if (td.type === 'treasure') {
            treasureCoins += td.coins;
            treasures.push(p.hand.splice(i, 1)[0]);
          }
        }
        treasures.forEach(function (id) { p.playArea.push(id); });
        s.coins += treasureCoins;
        pushLog(s, 'phase', p.name + ' 打出财宝，获得 ' + treasureCoins + ' 金币（共 ' + s.coins + '）。', s.turn);
        pushEvent(s, { kind: 'phase', player: s.turn, phase: 'buy', coins: treasureCoins });
        return s;
      }

      /* 购买阶段结束 → 弃牌、抽 5、检查终局。 */
      p.discard = p.discard.concat(p.hand, p.playArea);
      p.hand = [];
      p.playArea = [];
      drawCards(s, p, DATA.STARTING_HAND);
      s.actions = 1;
      s.buys = 1;
      s.coins = 0;
      s.phase = 'action';
      pushLog(s, 'cleanup', p.name + ' 弃掉手牌与已打出的牌，重新抽 5 张。', s.turn);
      pushEvent(s, { kind: 'cleanup', player: s.turn });
      var empty = emptyPileCount(s);
      if (s.supply.province <= 0 || empty >= 3) {
        s.over = true;
        var sc = score(s);
        var w = sc.human === sc.ai ? 'tie' : (sc.human > sc.ai ? 'human' : 'ai');
        s.result = {
          scores: sc,
          winner: w,
          emptyPiles: empty,
          reason: s.supply.province <= 0 ? '行省堆耗尽' : '三个牌堆耗尽'
        };
        pushLog(s, 'over', '终局：' + s.players[0].name + ' ' + sc.human + ' 分 · ' +
          s.players[1].name + ' ' + sc.ai + ' 分（' + s.result.reason + '）。', null);
        pushEvent(s, { kind: 'over', result: s.result });
        return s;
      }
      s.turn = 1 - s.turn;
      pushLog(s, 'turn', '轮到 ' + s.players[s.turn].name + '。', s.turn);
      pushEvent(s, { kind: 'turn', player: s.turn });
      return s;
    }
    throw new Error('未知动作');
  }

  /* ------------------------------------------------------------------ */
  /* 计分                                                                */
  /* ------------------------------------------------------------------ */
  function score(state) {
    function total(p) {
      return allCards(p).reduce(function (sum, id) {
        var c = cardOf(id);
        return sum + (c && c.vp ? c.vp : 0);
      }, 0);
    }
    return { human: total(state.players[0]), ai: total(state.players[1]) };
  }
  function breakdown(state, pi) {
    var p = state.players[pi];
    var out = {};
    allCards(p).forEach(function (id) {
      var c = cardOf(id);
      if (c && c.vp) out[id] = (out[id] || 0) + 1;
    });
    return out;
  }
  function isOver(state) { return !!state.over; }
  function winner(state) {
    if (!state.over) return null;
    var sc = score(state);
    if (sc.human === sc.ai) return 'tie';
    return sc.human > sc.ai ? 'human' : 'ai';
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                  */
  /* ------------------------------------------------------------------ */
  var ACTION_ORDER = ['militia', 'smithy', 'laboratory', 'market', 'festival', 'village', 'cellar', 'workshop'];
  var BUY_ORDER = ['province', 'gold', 'duchy', 'market', 'laboratory', 'festival', 'smithy', 'village', 'militia', 'workshop', 'cellar', 'silver', 'estate', 'copper'];

  function aiMove(state) {
    var legal = legalMoves(state);
    if (!legal.length) throw new Error('无合法动作');
    if (state.phase === 'action') {
      var plays = legal.filter(function (m) { return m.type === 'playAction'; });
      if (!plays.length) return { type: 'endPhase' };
      var opp = state.players[1 - state.turn];
      plays.sort(function (a, b) {
        return ACTION_ORDER.indexOf(a.cardId) - ACTION_ORDER.indexOf(b.cardId);
      });
      var best = plays[0];
      if (best.cardId === 'militia' && opp.hand.length <= 3 && plays.length > 1) best = plays[1];
      if (best.cardId === 'workshop' && state.coins >= 3) {
        var alt = plays.filter(function (m) { return m.cardId !== 'workshop'; })[0];
        if (alt) best = alt;
      }
      return best;
    }
    var buys = legal.filter(function (m) { return m.type === 'buy'; });
    for (var i = 0; i < BUY_ORDER.length; i++) {
      var found = buys.filter(function (m) { return m.cardId === BUY_ORDER[i]; })[0];
      if (found) {
        /* 早期不抢行省：先补 3～5 费的行动/银币，除非金币已经溢出。 */
        if (found.cardId === 'province' && state.moves < 12 && state.coins < 10) continue;
        return found;
      }
    }
    return { type: 'endPhase' };
  }

  function playAITurn(state) {
    var guard = 0;
    while (!state.over && state.turn === 1 && guard++ < 60) {
      state = applyMove(state, aiMove(state));
    }
    return state;
  }

  function summary(state) {
    var p = state.players[state.turn];
    return {
      turn: state.turn,
      phase: state.phase,
      actions: state.actions,
      buys: state.buys,
      coins: state.coins,
      hand: p.hand.slice(),
      deck: p.deck.length,
      discard: p.discard.length,
      played: p.playArea.slice(),
      scores: score(state),
      emptyPiles: emptyPileCount(state)
    };
  }

  return {
    CARDS: CARDS,
    CARD_BY_ID: CARD_BY_ID,
    SUPPLY: DATA.SUPPLY,
    TYPES: DATA.TYPES,
    MAX_MOVES: MAX_MOVES,
    createGame: createGame,
    legalMoves: legalMoves,
    applyMove: applyMove,
    aiMove: aiMove,
    playAITurn: playAITurn,
    score: score,
    breakdown: breakdown,
    winner: winner,
    isOver: isOver,
    cardOf: cardOf,
    countCard: countCard,
    allCards: allCards,
    discardValue: discardValue,
    emptyPileCount: emptyPileCount,
    drawCards: drawCards,
    gainCard: gainCard,
    summary: summary
  };
});
