/*
 * Dominion（领土）premium 卡牌数据 — UMD
 * 纯数据：卡牌定义、初始牌堆、公共牌堆数量、类型配色。页面与 Node 测试共用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DominionData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TYPES = {
    treasure: { name: '财宝', color: '#d8b26a', glyph: '◉' },
    victory: { name: '胜利', color: '#a78be0', glyph: '✦' },
    action: { name: '行动', color: '#83c99a', glyph: '⚔' }
  };

  var CARDS = [
    { id: 'copper', name: '铜币', type: 'treasure', cost: 0, coins: 1, desc: '打出获得 1 金币。' },
    { id: 'silver', name: '银币', type: 'treasure', cost: 3, coins: 2, desc: '打出获得 2 金币。' },
    { id: 'gold', name: '金币', type: 'treasure', cost: 6, coins: 3, desc: '打出获得 3 金币。' },
    { id: 'estate', name: '庄园', type: 'victory', cost: 2, vp: 2, desc: '终局 2 分。' },
    { id: 'duchy', name: '公国', type: 'victory', cost: 5, vp: 3, desc: '终局 3 分。' },
    { id: 'province', name: '行省', type: 'victory', cost: 8, vp: 6, desc: '终局 6 分；行省堆空即终局。' },
    { id: 'village', name: '村庄', type: 'action', cost: 3, actions: 2, cards: 1, desc: '+2 行动，+1 牌。' },
    { id: 'smithy', name: '铁匠', type: 'action', cost: 4, cards: 3, desc: '+3 牌。' },
    { id: 'market', name: '市场', type: 'action', cost: 5, cards: 1, actions: 1, buys: 1, coins: 1, desc: '+1 牌，+1 行动，+1 购买，+1 金币。' },
    { id: 'militia', name: '民兵', type: 'action', cost: 4, coins: 2, attack: true, desc: '+2 金币；对手弃牌至 3 张。' },
    { id: 'workshop', name: '工坊', type: 'action', cost: 4, gain: 'silver', desc: '获得一张银币，放入弃牌堆。' },
    { id: 'cellar', name: '地窖', type: 'action', cost: 2, actions: 1, cards: 1, desc: '+1 行动，+1 牌（简化版）。' },
    { id: 'festival', name: '节庆', type: 'action', cost: 5, actions: 2, buys: 1, coins: 2, desc: '+2 行动，+1 购买，+2 金币。' },
    { id: 'laboratory', name: '实验室', type: 'action', cost: 5, cards: 2, actions: 1, desc: '+2 牌，+1 行动。' }
  ];

  var SUPPLY = {
    copper: 60, silver: 40, gold: 30,
    estate: 24, duchy: 12, province: 12,
    village: 10, smithy: 10, market: 10, militia: 10,
    workshop: 10, cellar: 10, festival: 10, laboratory: 10
  };

  var CARD_BY_ID = Object.create(null);
  CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  return {
    TYPES: TYPES,
    CARDS: CARDS,
    SUPPLY: SUPPLY,
    CARD_BY_ID: CARD_BY_ID,
    STARTING_DECK: ['copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'copper', 'estate', 'estate', 'estate'],
    STARTING_HAND: 5,
    PLAYER_NAMES: ['你', 'AI 对手'],
    COLORS: ['#cc6a4f', '#7fa8c9']
  };
});
