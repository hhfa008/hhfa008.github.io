/*
 * War Chest（战争宝箱）高级版数据 — UMD
 *
 * 真实口径：7×7 棋盘、6 个据点、先控制 4 个据点获胜；双方各 4 种单位，
 * 每种 4 枚单位币，共 16 枚；每回合抽 3 枚，最多执行 3 个行动。
 * 静态定义只放数据，不含规则逻辑。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WarChestData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 7;
  var WIN_STRONGHOLDS = 4;
  var HAND_DRAW = 3;
  var MAX_TURNS = 120;
  var UNITS_PER_TYPE = 4;

  var UNIT_ORDER = ['swordsman', 'archer', 'cavalry', 'scout'];

  var UNITS = {
    swordsman: {
      id: 'swordsman', name: '剑士', glyph: '剑',
      move: 2, range: 1, count: 4, value: 45, defense: 2,
      desc: '移动 2 格，攻击相邻 1 格；稳定的近战主力。'
    },
    archer: {
      id: 'archer', name: '弓箭手', glyph: '弓',
      move: 1, range: 3, count: 4, value: 40, defense: 1,
      desc: '移动 1 格，攻击 3 格内的敌人；射程最远的单位。'
    },
    cavalry: {
      id: 'cavalry', name: '骑兵', glyph: '骑',
      move: 3, range: 1, count: 4, value: 40, defense: 1,
      desc: '移动 3 格，攻击相邻 1 格；快速穿插与抢点。'
    },
    scout: {
      id: 'scout', name: '斥候', glyph: '斥',
      move: 3, range: 0, count: 4, value: 25, defense: 1,
      desc: '移动 3 格，不能攻击；最快的占点单位。'
    }
  };

  /* 6 个据点：上方 3 个、下方 3 个。双方各从 2 个据点起步，中间 2 个中立。 */
  var STRONGHOLDS = [
    { id: 'h0', r: 1, c: 1, side: 1, start: 1 },
    { id: 'h1', r: 1, c: 3, side: 1, start: null },
    { id: 'h2', r: 1, c: 5, side: 1, start: 1 },
    { id: 'h3', r: 5, c: 1, side: 0, start: 0 },
    { id: 'h4', r: 5, c: 3, side: 0, start: null },
    { id: 'h5', r: 5, c: 5, side: 0, start: 0 }
  ];

  /* 本实现没有“大本营”单位；保留空数组以兼容旧引擎的 baseAt 查询。 */
  var BASES = [];

  var PLAYER_NAMES = ['你', 'AI'];
  var PLAYER_COLORS = ['#3f8ea8', '#b4513f'];

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    WIN_STRONGHOLDS: WIN_STRONGHOLDS,
    HAND_DRAW: HAND_DRAW,
    MAX_TURNS: MAX_TURNS,
    UNITS_PER_TYPE: UNITS_PER_TYPE,
    UNIT_ORDER: UNIT_ORDER,
    UNITS: UNITS,
    STRONGHOLDS: STRONGHOLDS,
    BASES: BASES,
    PLAYER_NAMES: PLAYER_NAMES,
    PLAYER_COLORS: PLAYER_COLORS
  });
});
