/*
 * Jaipur（斋普尔）Premium 数据表 — UMD
 * 浏览器：globalThis.JaipurData；Node：require('./data.js')
 * 只放静态规则数据与配色，不含任何 DOM / 网络逻辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JaipurData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var GOODS = Object.freeze(['diamond', 'gold', 'silver', 'silk', 'spice', 'leather']);

  var GOOD_NAMES = Object.freeze({
    diamond: '钻石',
    gold: '黄金',
    silver: '白银',
    silk: '丝绸',
    spice: '香料',
    leather: '皮革'
  });

  // 每种货物总张数：6+6+6+8+8+10 = 44；另有 12 只骆驼。
  var CARD_COUNTS = Object.freeze({
    diamond: 6,
    gold: 6,
    silver: 6,
    silk: 8,
    spice: 8,
    leather: 10
  });

  // 得分代币，从高到低发放；取完即该货物停止收购。
  var TOKEN_VALUES = Object.freeze({
    diamond: Object.freeze([7, 7, 5, 5, 5]),
    gold: Object.freeze([6, 6, 5, 5, 5]),
    silver: Object.freeze([5, 5, 5, 5, 5]),
    silk: Object.freeze([5, 3, 3, 2, 2, 1, 1]),
    spice: Object.freeze([5, 3, 3, 2, 2, 1, 1]),
    leather: Object.freeze([4, 3, 2, 1, 1, 1, 1, 1, 1])
  });

  var MIN_SELL = Object.freeze({ diamond: 2, gold: 2, silver: 2, silk: 1, spice: 1, leather: 1 });
  var BONUS_VALUES = Object.freeze({ 3: 5, 4: 4, 5: 3 });

  var GOOD_META = Object.freeze({
    diamond: Object.freeze({ ink: '#6d3fa8', soft: '#e9dcff', accent: '#a77be0' }),
    gold: Object.freeze({ ink: '#9a6700', soft: '#fff0c2', accent: '#e0aa2b' }),
    silver: Object.freeze({ ink: '#4f5d6b', soft: '#e4ebf1', accent: '#93a5b5' }),
    silk: Object.freeze({ ink: '#a83a52', soft: '#ffdde4', accent: '#dc6c86' }),
    spice: Object.freeze({ ink: '#b24b12', soft: '#ffe2cf', accent: '#e8813e' }),
    leather: Object.freeze({ ink: '#6b4a2f', soft: '#eddfcd', accent: '#a9825e' })
  });

  // AI 估值权重（Premium 版把“手牌上限、竞争对手剩余代币”也计入）。
  var AI = Object.freeze({
    cardValue: Object.freeze({ diamond: 6, gold: 5, silver: 4, silk: 3, spice: 2, leather: 1 }),
    scarcity: Object.freeze({ high: 2.4, mid: 1.2, low: 0.3 }),
    camelBase: Object.freeze([10, 7, 4, 1]),
    bonusWeight: 1.15
  });

  var RULES = Object.freeze({
    marketSize: 5,
    handLimit: 7,
    camelsPerPlayer: 3,
    camelsInMarket: 3,
    camelsExtra: 3,
    camelBonus: 5,
    roundsToWin: 2,
    maxRounds: 3
  });

  return Object.freeze({
    GOODS: GOODS,
    GOOD_NAMES: GOOD_NAMES,
    CARD_COUNTS: CARD_COUNTS,
    TOKEN_VALUES: TOKEN_VALUES,
    MIN_SELL: MIN_SELL,
    BONUS_VALUES: BONUS_VALUES,
    GOOD_META: GOOD_META,
    AI: AI,
    RULES: RULES
  });
});
