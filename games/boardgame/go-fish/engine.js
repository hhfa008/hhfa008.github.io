(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GoFishEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  var SUITS = ['S', 'H', 'D', 'C'];
  var SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  var NAMES = ['你', 'AI'];

  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function suitSymbol(suit) {
    return SUIT_SYMBOL[suit] || '?';
  }

  function rankLabel(rank) {
    return rank;
  }

  function isRed(card) {
    return !!card && (card.suit === 'H' || card.suit === 'D');
  }

  function cardId(card) {
    return card.rank + suitSymbol(card.suit);
  }

  function buildDeck() {
    var deck = [];
    for (var s = 0; s < SUITS.length; s++) {
      for (var r = 0; r < RANKS.length; r++) {
        deck.push({ rank: RANKS[r], suit: SUITS[s] });
      }
    }
    return deck;
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

  function rankCounts(state, player) {
    var counts = {};
    var hand = (state && state.hands && state.hands[player]) || [];
    for (var i = 0; i < hand.length; i++) {
      counts[hand[i].rank] = (counts[hand[i].rank] || 0) + 1;
    }
    return counts;
  }

  function booksFor(state, player) {
    return state.books[player];
  }

  function handCount(state, player) {
    return state.hands[player].length;
  }

  function hasUsefulAsk(state) {
    if (state.deck.length > 0) return true;
    for (var p = 0; p < 2; p++) {
      var mine = rankCounts(state, p);
      var theirs = rankCounts(state, 1 - p);
      for (var i = 0; i < RANKS.length; i++) {
        var r = RANKS[i];
        if ((mine[r] || 0) > 0 && (theirs[r] || 0) > 0) return true;
      }
    }
    return false;
  }

  function checkBooks(state, player) {
    var counts = rankCounts(state, player);
    var booked = [];
    for (var i = 0; i < RANKS.length; i++) {
      var rank = RANKS[i];
      if ((counts[rank] || 0) >= 4) {
        state.hands[player] = state.hands[player].filter(function (c) {
          return c.rank !== rank;
        });
        state.books[player] += 1;
        booked.push(rank);
        state.log.push(
          NAMES[player] + '凑齐 ' + rank + ' 四张，记 1 本书（共 ' +
          state.books[player] + ' 本）'
        );
      }
    }
    return booked;
  }

  function finish(state) {
    if (state.phase === 'over') return state;
    state.phase = 'over';
    var a = state.books[0];
    var b = state.books[1];
    state.winner = a > b ? 0 : (a < b ? 1 : 'tie');
    state.log.push(
      '游戏结束：你 ' + a + ' : ' + b + ' AI，' +
      (state.winner === 'tie' ? '平局' : (state.winner === 0 ? '你获胜' : 'AI 获胜'))
    );
    return state;
  }

  function maybeFinish(state) {
    if (state.phase !== 'playing') return true;
    if (state.books[0] + state.books[1] >= 13) {
      finish(state);
      return true;
    }
    if (state.hands[0].length === 0 && state.hands[1].length === 0 && state.deck.length === 0) {
      finish(state);
      return true;
    }
    if (state.hands[state.turn].length === 0 && state.deck.length === 0) {
      finish(state);
      return true;
    }
    if (!hasUsefulAsk(state)) {
      finish(state);
      return true;
    }
    return false;
  }

  function ensurePlayable(state) {
    if (!state || state.phase !== 'playing') return;
    var p = state.turn;
    if (state.hands[p].length === 0 && state.deck.length > 0) {
      var card = state.deck.pop();
      state.hands[p].push(card);
      state.log.push(NAMES[p] + '手牌已空，从牌堆摸到 ' + cardId(card));
      checkBooks(state, p);
    }
    maybeFinish(state);
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = (opts.seed === undefined || opts.seed === null) ? (Date.now() >>> 0) : (opts.seed >>> 0);
    var rng = mulberry32(seed);
    var deck = shuffle(buildDeck(), rng);
    var state = {
      deck: deck,
      hands: [[], []],
      books: [0, 0],
      turn: 0,
      phase: 'playing',
      winner: null,
      log: [],
      rng: rng,
      lastAction: null,
      seed: seed
    };
    for (var i = 0; i < 7; i++) {
      state.hands[0].push(state.deck.pop());
      state.hands[1].push(state.deck.pop());
    }
    state.log.push('发牌完成：双方各 7 张，牌堆剩 ' + state.deck.length + ' 张');
    checkBooks(state, 0);
    checkBooks(state, 1);
    return state;
  }

  function fail(error) {
    return { ok: false, error: error, got: 0, drew: null };
  }

  function ask(state, rank) {
    if (!state || typeof state !== 'object') return fail('无效的游戏状态');
    if (state.phase !== 'playing') return fail('游戏已经结束');
    if (RANKS.indexOf(rank) === -1) return fail('无效的点数：' + rank);

    ensurePlayable(state);
    if (state.phase !== 'playing') return fail('游戏已经结束');

    var p = state.turn;
    var o = 1 - p;
    if ((rankCounts(state, p)[rank] || 0) === 0) {
      return fail(NAMES[p] + '手上没有 ' + rank + '，不能这样要牌');
    }

    var moved = [];
    var kept = [];
    state.hands[o].forEach(function (card) {
      if (card.rank === rank) moved.push(card);
      else kept.push(card);
    });
    state.hands[o] = kept;
    var got = moved.length;
    var drew = null;
    var booked = [];

    if (got > 0) {
      state.hands[p] = state.hands[p].concat(moved);
      state.log.push(
        NAMES[p] + '向' + NAMES[o] + '要 ' + rank + ' 牌，' +
        NAMES[o] + '交出 ' + got + ' 张'
      );
      booked = checkBooks(state, p);
      state.log.push(NAMES[p] + '继续要牌');
    } else {
      state.log.push(
        NAMES[p] + '向' + NAMES[o] + '要 ' + rank + ' 牌，' +
        NAMES[o] + '一张也没有'
      );
      if (state.deck.length > 0) {
        drew = state.deck.pop();
        state.hands[p].push(drew);
        state.log.push(NAMES[p] + '从牌堆摸到 ' + cardId(drew));
        booked = checkBooks(state, p);
      } else {
        state.log.push('牌堆已空，摸不到牌');
      }
      state.turn = o;
      state.log.push('轮换：轮到' + NAMES[o]);
    }

    state.lastAction = {
      type: 'ask',
      asker: p,
      rank: rank,
      got: got,
      drew: drew,
      books: booked
    };

    maybeFinish(state);
    if (state.phase === 'playing') ensurePlayable(state);

    return { ok: true, got: got, drew: drew };
  }

  function aiChooseRank(state) {
    var hand = (state && state.hands && state.hands[1]) || [];
    var counts = {};
    for (var i = 0; i < hand.length; i++) {
      counts[hand[i].rank] = (counts[hand[i].rank] || 0) + 1;
    }
    var best = null;
    var bestN = 0;
    for (var r = 0; r < RANKS.length; r++) {
      var n = counts[RANKS[r]] || 0;
      if (n > bestN) {
        bestN = n;
        best = RANKS[r];
      }
    }
    return best;
  }

  return {
    RANKS: RANKS,
    SUITS: SUITS,
    suitSymbol: suitSymbol,
    rankLabel: rankLabel,
    isRed: isRed,
    cardId: cardId,
    createGame: createGame,
    rankCounts: rankCounts,
    booksFor: booksFor,
    handCount: handCount,
    checkBooks: checkBooks,
    ensurePlayable: ensurePlayable,
    finish: finish,
    ask: ask,
    aiChooseRank: aiChooseRank
  };
});
