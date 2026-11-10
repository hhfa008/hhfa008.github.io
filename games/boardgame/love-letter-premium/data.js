/*
 * Love Letter premium — card data (UMD).
 * Official base deck: 16 cards, 8 characters. Values 1–8.
 * Chinese names follow the common 情书 translation; English names follow the
 * 2019 AEG edition. Flavour text is original (not copied from the rulebook).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LoveLetterData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CARDS = Object.freeze([
    Object.freeze({
      id: 1, key: 'guard', name: '卫兵', en: 'Guard', count: 5, value: 1,
      icon: 'guard', color: '#c8b48a',
      text: '猜另一名玩家手牌（不能猜卫兵）。猜中，该玩家出局。',
      flavor: '城门的第一道影子，最不起眼，也最致命。'
    }),
    Object.freeze({
      id: 2, key: 'priest', name: '神父', en: 'Priest', count: 2, value: 2,
      icon: 'priest', color: '#9bb6c9',
      text: '秘密查看另一名玩家的手牌。',
      flavor: '告解室里，秘密比誓言更值钱。'
    }),
    Object.freeze({
      id: 3, key: 'baron', name: '男爵', en: 'Baron', count: 2, value: 3,
      icon: 'baron', color: '#b98a5a',
      text: '与另一名玩家比较手牌。点数低者出局，平手无事。',
      flavor: '爵位是筹码，命也是。'
    }),
    Object.freeze({
      id: 4, key: 'handmaid', name: '侍女', en: 'Handmaid', count: 2, value: 4,
      icon: 'handmaid', color: '#8fae8b',
      text: '保护你直到你的下个回合开始，其他牌的效果对你无效。',
      flavor: '她挡在门前，什么也不说。'
    }),
    Object.freeze({
      id: 5, key: 'prince', name: '王子', en: 'Prince', count: 2, value: 5,
      icon: 'prince', color: '#c9a24d',
      text: '选择一名玩家（可包括自己）弃掉手牌并补一张。弃掉公主者出局。',
      flavor: '年轻的继承人，总想重新发牌。'
    }),
    Object.freeze({
      id: 6, key: 'king', name: '国王', en: 'King', count: 1, value: 6,
      icon: 'king', color: '#b07a52',
      text: '与另一名玩家交换手牌。',
      flavor: '王冠可以交换，王座不能。'
    }),
    Object.freeze({
      id: 7, key: 'countess', name: '女伯爵', en: 'Countess', count: 1, value: 7,
      icon: 'countess', color: '#a06c8c',
      text: '若你同时持有国王或王子，必须打出女伯爵。',
      flavor: '她知道谁在夜里进过王宫。'
    }),
    Object.freeze({
      id: 8, key: 'princess', name: '公主', en: 'Princess', count: 1, value: 8,
      icon: 'princess', color: '#c76b83',
      text: '若你打出或弃掉公主，你立即出局。',
      flavor: '被看见的那一刻，故事就结束了。'
    })
  ]);

  var BY_ID = {};
  var BY_KEY = {};
  CARDS.forEach(function (card) {
    BY_ID[card.id] = card;
    BY_KEY[card.key] = card;
  });

  var TOTAL_CARDS = CARDS.reduce(function (sum, card) { return sum + card.count; }, 0);
  var TARGET_TOKENS = Object.freeze({ 2: 7, 3: 5, 4: 4 });
  var BURN_COUNT = Object.freeze({ 2: 3, 3: 1, 4: 0 });
  var NAMES = Object.freeze(['你', 'AI · 红衣密使', 'AI · 银烛学士', 'AI · 夜巡骑士']);

  return Object.freeze({
    CARDS: CARDS,
    BY_ID: BY_ID,
    BY_KEY: BY_KEY,
    TOTAL_CARDS: TOTAL_CARDS,
    TARGET_TOKENS: TARGET_TOKENS,
    BURN_COUNT: BURN_COUNT,
    NAMES: NAMES
  });
}));
