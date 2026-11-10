/*
 * For Sale（房地产拍卖）premium — data (UMD).
 *
 * Official components:
 *   - 30 property cards, values 1–30.
 *   - 30 cheque cards: 0, 0, 2, 2, 3, 3, … 15, 15 (the real deck has no 1).
 *   - Each player starts with 18 coins.
 *   - Phase 1 auctions all 30 properties; phase 2 sells properties for cheques.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ForSaleData = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PROPERTY_VALUES = [];
  for (var v = 1; v <= 30; v++) PROPERTY_VALUES.push(v);

  var CHEQUE_VALUES = [0, 0];
  for (var c = 2; c <= 15; c++) CHEQUE_VALUES.push(c, c);

  var PLAYER_COLORS = Object.freeze([
    Object.freeze({ index: 0, key: 'navy', name: '海军蓝', hex: '#2f4b6e', ink: '#eef4ff' }),
    Object.freeze({ index: 1, key: 'brick', name: '砖红', hex: '#9c4a3a', ink: '#fff1e8' }),
    Object.freeze({ index: 2, key: 'olive', name: '橄榄绿', hex: '#5e6b3a', ink: '#f6f7e8' }),
    Object.freeze({ index: 3, key: 'plum', name: '梅紫', hex: '#6a3f63', ink: '#fbeef6' }),
    Object.freeze({ index: 4, key: 'teal', name: '松石绿', hex: '#2f6b67', ink: '#eafaf6' }),
    Object.freeze({ index: 5, key: 'ochre', name: '赭黄', hex: '#8a6a2c', ink: '#fff7e2' })
  ]);

  var NAMES = Object.freeze(['你', 'AI · 砖红经纪', 'AI · 橄榄经纪', 'AI · 梅紫经纪', 'AI · 松石经纪', 'AI · 赭黄经纪']);

  return Object.freeze({
    PROPERTY_VALUES: PROPERTY_VALUES,
    CHEQUE_VALUES: CHEQUE_VALUES,
    START_MONEY: 18,
    MIN_PLAYERS: 3,
    MAX_PLAYERS: 6,
    PLAYER_COLORS: PLAYER_COLORS,
    NAMES: NAMES
  });
}));
