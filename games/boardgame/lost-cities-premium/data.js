/*
 * Lost Cities（失落之城）Premium 数据表 — UMD
 * 浏览器：globalThis.LostCitiesData；Node：require('./data.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LostCitiesData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = Object.freeze(['yellow', 'blue', 'white', 'green', 'red']);

  var COLOR_NAMES = Object.freeze({
    yellow: '黄沙',
    blue: '深海',
    white: '雪峰',
    green: '雨林',
    red: '火山'
  });

  var COLOR_META = Object.freeze({
    yellow: Object.freeze({ ink: '#8a6208', deep: '#5f4304', soft: '#fff0bd', accent: '#d6a52c', glyph: '☀' }),
    blue: Object.freeze({ ink: '#1f5f86', deep: '#123b57', soft: '#d8efff', accent: '#4f9cc7', glyph: '≈' }),
    white: Object.freeze({ ink: '#5d6d7a', deep: '#36434e', soft: '#f2f7fa', accent: '#93aebd', glyph: '✳' }),
    green: Object.freeze({ ink: '#256b4c', deep: '#124431', soft: '#d9f5e4', accent: '#51a77b', glyph: '❧' }),
    red: Object.freeze({ ink: '#9a3628', deep: '#642116', soft: '#ffe0d8', accent: '#cd6a51', glyph: '▲' })
  });

  var RULES = Object.freeze({
    handSize: 8,
    maxWagers: 3,
    numberMin: 2,
    numberMax: 10,
    rounds: 3,
    bonusCards: 8,
    bonusPoints: 20,
    basePenalty: 20,
    wagerMultiplier: 1
  });

  var AI = Object.freeze({
    startBonus: 4,
    extendBonus: 2,
    wagerMinHighCards: 2,
    wagerValue: 11,
    discardPenalty: 1.4,
    drawDiscardThreshold: 7
  });

  return Object.freeze({
    COLORS: COLORS,
    COLOR_NAMES: COLOR_NAMES,
    COLOR_META: COLOR_META,
    RULES: RULES,
    AI: AI
  });
});
