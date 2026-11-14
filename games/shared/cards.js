/* 卡牌游戏公共原语（UMD，零依赖）。
 *
 *   Cards.shuffle(arr, rng)               // Fisher–Yates；rng 需可复现（mulberry32 等）
 *   Cards.makeDeck(suits, maxRank)        // [{r,s}]，r=1..maxRank，s=0..suits-1
 *   Cards.draw(deck)                      // 从牌堆顶取一张（不可变：返回 {card, deck}）
 *   Cards.nextTurn(current, players)      // 0..players-1 轮转
 *   Cards.winnerByEmptyHand(hands)        // 谁先清空；平局返回 'tie'，未结束 null
 *   Cards.winnerByScore(scores)           // 最高分；并列 'tie'
 *
 * 目标：洗牌/牌堆/回合/胜负判定只写一份，卡牌类页面与引擎共用，
 * 随机性由种子驱动，复盘可复现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function shuffle(arr, rng) {
    var a = arr.slice();
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = a.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 原地洗牌：仅用于内部状态（如单机引擎的牌池），不入存档、不跨座位共享。
  function shuffleInPlace(arr, rng) {
    var random = typeof rng === 'function' ? rng : Math.random;
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function makeDeck(suits, maxRank) {
    if (!(suits >= 1) || !(maxRank >= 1)) throw new Error('makeDeck: suits/maxRank must be >= 1');
    var deck = [];
    for (var s = 0; s < suits; s += 1) {
      for (var r = 1; r <= maxRank; r += 1) deck.push({ r: r, s: s });
    }
    return deck;
  }

  // 牌堆顶 = 数组末尾；不修改入参，返回新牌堆，便于存档/复盘。
  function draw(deck) {
    if (!deck.length) return { card: null, deck: deck.slice() };
    var next = deck.slice();
    var card = next.pop();
    return { card: card, deck: next };
  }

  function nextTurn(current, players) {
    if (!(players >= 1)) return 0;
    return ((Number(current) || 0) + 1) % players;
  }

  function winnerByEmptyHand(hands) {
    var empty = [];
    for (var i = 0; i < hands.length; i += 1) {
      if (Array.isArray(hands[i]) && hands[i].length === 0) empty.push(i);
    }
    if (!empty.length) return null;
    return empty.length === 1 ? empty[0] : 'tie';
  }

  function winnerByScore(scores) {
    if (!scores || !scores.length) return null;
    var best = -Infinity;
    var winners = [];
    scores.forEach(function (v, i) {
      var n = Number(v) || 0;
      if (n > best) { best = n; winners = [i]; }
      else if (n === best) winners.push(i);
    });
    return winners.length === 1 ? winners[0] : 'tie';
  }

  return {
    shuffle: shuffle,
    shuffleInPlace: shuffleInPlace,
    makeDeck: makeDeck,
    draw: draw,
    nextTurn: nextTurn,
    winnerByEmptyHand: winnerByEmptyHand,
    winnerByScore: winnerByScore,
    version: '1.0.0'
  };
});
