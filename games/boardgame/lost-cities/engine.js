/*
 * Lost Cities（失落之城）纯规则引擎 — UMD
 * 浏览器：globalThis.LostCitiesEngine；Node：require('./engine.js')
 * 规则：5 色探险列，数字必须递增，赌注牌只能先出；牌堆耗尽后对手再走一手结束。
 * 所有随机性来自 createGame 的 seed；applyMove 返回新 state，不修改入参。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LostCitiesEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = ['yellow', 'blue', 'white', 'green', 'red'];
  var COLOR_NAMES = { yellow: '黄色', blue: '蓝色', white: '白色', green: '绿色', red: '红色' };
  var HAND_SIZE = 8;
  var MAX_TURNS = 400;

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

  function newExps() {
    return COLORS.map(function (c) { return { color: c, wagers: 0, nums: [] }; });
  }
  function newPlayer(name) {
    return { name: name, hand: [], exp: newExps() };
  }
  function newDiscard() {
    var d = {};
    COLORS.forEach(function (c) { d[c] = []; });
    return d;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed >>> 0;
    var st = {
      seed: seed, rng: seed >>> 0,
      deck: [], discard: newDiscard(),
      players: [newPlayer('你'), newPlayer('AI')],
      turn: 0, log: [], over: false, lastTurnPlayer: null, moves: 0,
      humanFirst: opts.humanFirst !== false
    };
    COLORS.forEach(function (c) {
      for (var n = 2; n <= 10; n++) st.deck.push({ c: c, k: 'n', v: n });
      for (var w = 0; w < 3; w++) st.deck.push({ c: c, k: 'w', v: 0 });
    });
    shuffle(st.deck, st);
    /* 确定起始玩家，再轮流发牌。 */
    if (!st.humanFirst) st.turn = 1;
    for (var round = 0; round < HAND_SIZE; round++) {
      st.players[0].hand.push(st.deck.pop());
      st.players[1].hand.push(st.deck.pop());
    }
    st.turn = st.humanFirst ? 0 : 1;
    st.log.push('发牌完成，牌堆剩余 ' + st.deck.length + ' 张。' + (st.turn === 0 ? '你先手。' : 'AI 先手。'));
    return st;
  }

  function canPlayCard(exp, card) {
    if (card.k === 'w') return exp.nums.length === 0;
    if (!exp.nums.length) return true;
    return exp.nums[exp.nums.length - 1] < card.v;
  }

  function legalMoves(state) {
    if (state.over) return [];
    var hand = state.players[state.turn].hand;
    var exps = state.players[state.turn].exp;
    var moves = [];
    hand.forEach(function (card, i) {
      if (canPlayCard(exps[COLORS.indexOf(card.c)], card)) {
        moves.push({ type: 'play', handIndex: i, card: card });
      }
      moves.push({ type: 'discard', handIndex: i, card: card });
    });
    return moves;
  }

  function expeditionScore(exp) {
    if (!exp.nums.length) return exp.wagers > 0 ? -20 * exp.wagers : 0;
    var sum = 0;
    exp.nums.forEach(function (n) { sum += n; });
    return (sum + 20 * exp.wagers) * (1 + exp.wagers);
  }

  function score(state) {
    function total(p) {
      var sum = 0;
      p.exp.forEach(function (e) { sum += expeditionScore(e); });
      return sum;
    }
    return { human: total(state.players[0]), ai: total(state.players[1]) };
  }

  function isOver(state) { return !!state.over; }

  function winner(state) {
    var sc = score(state);
    if (sc.human === sc.ai) return 'tie';
    return sc.human > sc.ai ? 'human' : 'ai';
  }

  function findMove(state, move) {
    if (!move || (move.type !== 'play' && move.type !== 'discard')) return null;
    var legal = legalMoves(state);
    for (var i = 0; i < legal.length; i++) {
      if (legal[i].type === move.type && legal[i].handIndex === move.handIndex) return legal[i];
    }
    return null;
  }

  function applyMove(state, move) {
    if (state.over) throw new Error('游戏已结束');
    if (state.moves >= MAX_TURNS) throw new Error('回合数超限');
    var found = findMove(state, move);
    if (!found) throw new Error('非法动作: ' + JSON.stringify(move));
    var s = clone(state);
    var p = s.players[s.turn];
    var card = p.hand.splice(found.handIndex, 1)[0];
    if (found.type === 'play') {
      var exp = p.exp[COLORS.indexOf(card.c)];
      if (card.k === 'w') exp.wagers += 1;
      else exp.nums.push(card.v);
      s.log.push(p.name + ' 打出 ' + COLOR_NAMES[card.c] + (card.k === 'w' ? '赌注' : card.v) + '。');
    } else {
      s.discard[card.c].push(card);
      s.log.push(p.name + ' 弃掉 ' + COLOR_NAMES[card.c] + (card.k === 'w' ? '赌注' : card.v) + '。');
    }
    if (s.deck.length) p.hand.push(s.deck.pop());
    s.moves += 1;
    if (!s.deck.length && s.lastTurnPlayer === null) s.lastTurnPlayer = 1 - s.turn;
    if (s.lastTurnPlayer !== null && s.turn === s.lastTurnPlayer) {
      s.over = true;
      s.log.push('牌堆已空，最后回合结束。');
    } else {
      s.turn = 1 - s.turn;
    }
    if (s.moves >= MAX_TURNS) s.over = true;
    return s;
  }

  function cardKeepValue(card, player) {
    var exp = player.exp[COLORS.indexOf(card.c)];
    if (card.k === 'w') return exp.nums.length ? 12 + exp.nums.length : 2;
    if (!exp.nums.length) return 6 + card.v * 0.4;
    if (exp.nums[exp.nums.length - 1] < card.v) return 12 + card.v;
    return 1;
  }

  function aiMove(state) {
    var legal = legalMoves(state);
    if (!legal.length) throw new Error('没有合法动作');
    var me = state.players[state.turn];
    var best = null, bestScore = -Infinity;
    legal.forEach(function (m) {
      var value;
      if (m.type === 'play') {
        var exp = me.exp[COLORS.indexOf(m.card.c)];
        if (m.card.k === 'w') value = exp.nums.length >= 3 ? 30 : 8;
        else value = 18 + m.card.v + (exp.nums.length ? 6 : 0) + (exp.nums.length >= 2 ? 4 : 0);
      } else {
        value = 30 - cardKeepValue(m.card, me);
      }
      /* 仅在极差时打破平局，保证 AI 可复现。 */
      if (value > bestScore) { bestScore = value; best = m; }
    });
    return { type: best.type, handIndex: best.handIndex };
  }

  return {
    COLORS: COLORS, COLOR_NAMES: COLOR_NAMES, HAND_SIZE: HAND_SIZE,
    createGame: createGame, legalMoves: legalMoves, applyMove: applyMove,
    aiMove: aiMove, isOver: isOver, score: score, winner: winner,
    expeditionScore: expeditionScore, canPlayCard: canPlayCard
  };
});
