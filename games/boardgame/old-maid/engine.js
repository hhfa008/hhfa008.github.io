(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OldMaidEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var OLD_MAID_RANK = 'Q';
  var OLD_MAID_SUIT = 'S';
  var OLD_MAID_ID = 'QS';

  /* ---------- deterministic RNG ---------- */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(deck, rng) {
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    return deck;
  }

  /* ---------- cards ---------- */
  function makeCard(rank, suit) {
    return { id: rank + suit, rank: rank, suit: suit };
  }

  function createDeck() {
    var deck = [];
    for (var r = 0; r < RANKS.length; r++) {
      for (var s = 0; s < SUITS.length; s++) {
        if (RANKS[r] === OLD_MAID_RANK && SUITS[s] === OLD_MAID_SUIT) continue;
        deck.push(makeCard(RANKS[r], SUITS[s]));
      }
    }
    return deck;
  }

  function suitSymbol(cardOrSuit) {
    var s = typeof cardOrSuit === 'string' ? cardOrSuit : cardOrSuit && cardOrSuit.suit;
    return SUIT_SYMBOLS[s] || '?';
  }

  function isRed(cardOrSuit) {
    var s = typeof cardOrSuit === 'string' ? cardOrSuit : cardOrSuit && cardOrSuit.suit;
    return s === 'H' || s === 'D';
  }

  function rankLabel(rank) {
    if (rank && typeof rank === 'object') rank = rank.rank;
    return String(rank);
  }

  /* ---------- pair removal ----------
   * Remove every same-rank pair (suit ignored). If a rank appears an odd
   * number of times, exactly one card of that rank stays in the hand.
   * Returns new arrays; the input hand is never mutated.
   */
  function removePairs(hand) {
    if (!Array.isArray(hand)) throw new TypeError('hand 必须是数组');
    var pending = new Map();
    var removeIdx = new Set();
    hand.forEach(function (card, i) {
      if (!card || typeof card.rank !== 'string') throw new TypeError('手牌中存在无效的牌');
      if (pending.has(card.rank)) {
        removeIdx.add(pending.get(card.rank));
        removeIdx.add(i);
        pending.delete(card.rank);
      } else {
        pending.set(card.rank, i);
      }
    });
    var kept = [];
    var removed = [];
    hand.forEach(function (card, i) {
      if (removeIdx.has(i)) removed.push(card);
      else kept.push(card);
    });
    return { hand: kept, removed: removed };
  }

  /* ---------- state helpers ---------- */
  function addLog(state, msg) {
    state.log.push(msg);
  }

  function checkOver(state) {
    if (!state) throw new TypeError('缺少 state');
    if (state.phase === 'over') return true;
    for (var p = 0; p < 2; p++) {
      if (state.hands[p].length === 0) {
        state.phase = 'over';
        // The player who got rid of every card wins; the other one is
        // left holding the lone queen and loses.
        state.winner = p;
        state.loser = 1 - p;
        addLog(
          state,
          (state.winner === 0 ? '你' : '电脑') + '率先出完手牌，获胜！' +
            (state.loser === 0 ? '你' : '电脑') + '手里剩下乌龟皇后。'
        );
        return true;
      }
    }
    return false;
  }

  function handCounts(state) {
    return [state.hands[0].length, state.hands[1].length];
  }

  /* ---------- game setup ---------- */
  /*
   * opts.seed  – integer seed for mulberry32 (default 1)
   * opts.deck  – optional pre-built 51-card deck (useful for tests)
   */
  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed;
    var rng = mulberry32(seed);
    var deck = opts.deck ? opts.deck.slice() : shuffle(createDeck(), rng);

    var hands = [[], []];
    var dealtCounts = [0, 0];
    deck.forEach(function (card, i) {
      var p = i % 2; // alternate: player 0, player 1, ...
      hands[p].push(card);
      dealtCounts[p]++;
    });

    var state = {
      deck: [],
      hands: hands,
      turn: 0,
      phase: 'playing',
      winner: null,
      loser: null,
      log: [],
      rng: rng,
      seed: seed,
      discarded: [],
      dealtCounts: dealtCounts,
      lastEvent: null
    };

    addLog(state, '游戏开始：52 张牌中移除了黑桃皇后 Q♠ 作为乌龟，共 51 张。');
    addLog(state, '发牌：你 ' + dealtCounts[0] + ' 张，电脑 ' + dealtCounts[1] + ' 张。');

    // Immediately auto-discard all same-rank pairs from each hand.
    for (var p = 0; p < 2; p++) {
      var res = removePairs(hands[p]);
      hands[p] = res.hand;
      state.discarded = state.discarded.concat(res.removed);
      if (res.removed.length) {
        addLog(
          state,
          (p === 0 ? '你' : '电脑') + '起初自动丢掉了 ' + res.removed.length / 2 + ' 对牌。'
        );
      }
    }

    return state;
  }

  /* ---------- AI ---------- */
  // Returns a legal index into the opponent hand for the player whose turn it is.
  function aiChooseIndex(state) {
    if (!state) throw new TypeError('缺少 state');
    var opp = 1 - state.turn;
    var hand = state.hands[opp];
    if (!hand || hand.length === 0) return -1;
    var r = typeof state.rng === 'function' ? state.rng() : Math.random();
    var idx = Math.floor(r * hand.length);
    if (idx < 0) idx = 0;
    if (idx >= hand.length) idx = hand.length - 1;
    return idx;
  }

  /* ---------- one turn ---------- */
  /*
   * drawCard(state, handIndex, index)
   *   handIndex – the drawer; must equal state.turn (opponent = 1 - handIndex)
   *   index     – index inside the opponent hand. Optional for AI; when omitted
   *               a random legal index (aiChooseIndex) is used.
   * Human UI passes the tapped index; AI passes aiChooseIndex(state).
   */
  function drawCard(state, handIndex, index) {
    if (!state) throw new TypeError('缺少 state');
    if (state.phase !== 'playing') throw new Error('游戏已经结束');
    if (handIndex !== 0 && handIndex !== 1) throw new RangeError('玩家索引必须是 0 或 1');
    if (handIndex !== state.turn) throw new Error('还没轮到该玩家抽牌');

    var opp = 1 - handIndex;
    var oppHand = state.hands[opp];
    if (oppHand.length === 0) {
      checkOver(state);
      throw new Error('对方没有牌可抽');
    }

    var idx = index;
    if (idx == null) idx = aiChooseIndex(state);
    if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= oppHand.length) {
      throw new RangeError('无效的抽牌位置：' + idx);
    }

    var card = oppHand.splice(idx, 1)[0];
    var drawerHand = state.hands[handIndex];
    drawerHand.push(card);

    var res = removePairs(drawerHand);
    state.hands[handIndex] = res.hand;
    if (res.removed.length) state.discarded = state.discarded.concat(res.removed);

    var who = handIndex === 0 ? '你' : '电脑';
    var other = opp === 0 ? '你' : '电脑';
    var msg = who + '从' + other + '手牌中抽走了第 ' + (idx + 1) + ' 张牌';
    if (res.removed.length) {
      var ranks = [];
      res.removed.forEach(function (c) {
        if (ranks.indexOf(c.rank) === -1) ranks.push(c.rank);
      });
      msg += '，凑成一对「' + ranks.join('、') + '」并丢弃';
    } else {
      msg += '，没有凑成对';
    }
    addLog(state, msg);

    state.lastEvent = {
      drawer: handIndex,
      opponent: opp,
      index: idx,
      drawn: card,
      removed: res.removed
    };

    state.turn = opp;
    checkOver(state);
    return state;
  }

  return {
    createGame: createGame,
    createDeck: createDeck,
    removePairs: removePairs,
    drawCard: drawCard,
    aiChooseIndex: aiChooseIndex,
    handCounts: handCounts,
    checkOver: checkOver,
    mulberry32: mulberry32,
    RANKS: RANKS,
    SUITS: SUITS,
    suitSymbol: suitSymbol,
    rankLabel: rankLabel,
    isRed: isRed,
    OLD_MAID_ID: OLD_MAID_ID,
    OLD_MAID_RANK: OLD_MAID_RANK,
    OLD_MAID_SUIT: OLD_MAID_SUIT
  };
});
