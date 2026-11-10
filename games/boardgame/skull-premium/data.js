/*
 * Skull（骷髅牌）premium — data (UMD).
 * Each player has 4 coasters — 3 roses + 1 skull. First to 2 challenges wins.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SkullData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DISC_TYPES = Object.freeze({
    rose: Object.freeze({ key: 'rose', name: '玫瑰', en: 'Rose', symbol: '✿' }),
    skull: Object.freeze({ key: 'skull', name: '骷髅', en: 'Skull', symbol: '☠' })
  });
  var PLAYER_COLORS = Object.freeze([
    Object.freeze({ index: 0, key: 'ink', name: '墨黑', hex: '#25262b', ink: '#f4e8d4', coaster: '#2a2b31' }),
    Object.freeze({ index: 1, key: 'rust', name: '铁锈', hex: '#a14b36', ink: '#fff0dc', coaster: '#a14b36' }),
    Object.freeze({ index: 2, key: 'moss', name: '苔绿', hex: '#4f6b4a', ink: '#f2f7ea', coaster: '#4f6b4a' }),
    Object.freeze({ index: 3, key: 'indigo', name: '靛蓝', hex: '#34506e', ink: '#eef5ff', coaster: '#34506e' }),
    Object.freeze({ index: 4, key: 'plum', name: '梅紫', hex: '#6d3a5c', ink: '#fbeaf4', coaster: '#6d3a5c' }),
    Object.freeze({ index: 5, key: 'ochre', name: '赭黄', hex: '#96702a', ink: '#fff6df', coaster: '#96702a' })
  ]);
  var NAMES = Object.freeze(['你', 'AI · 铁锈客', 'AI · 苔绿客', 'AI · 靛蓝客', 'AI · 梅紫客', 'AI · 赭黄客']);

  return Object.freeze({
    DISC_TYPES: DISC_TYPES,
    ROSES_PER_PLAYER: 3,
    SKULLS_PER_PLAYER: 1,
    DISCS_PER_PLAYER: 4,
    TARGET_POINTS: 2,
    MIN_PLAYERS: 3,
    MAX_PLAYERS: 6,
    PLAYER_COLORS: PLAYER_COLORS,
    NAMES: NAMES
  });
}));
