/*
 * War Chest（战争宝箱）简化版数据 — UMD
 *
 * 浏览器：先加载本文件，globalThis.WarChestData
 * Node：  require('./data.js')
 *
 * 本文件只放静态定义（棋盘、单位、据点、规则常数），不含任何游戏逻辑，
 * 让 index.html、engine.js 与 test.js 共用同一份数据。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WarChestData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 7;
  var WIN_STRONGHOLDS = 4;
  var HAND_DRAW = 3;
  var MAX_TURNS = 100;

  // 单位顺序也是手牌与预备队的展示顺序。
  var UNIT_ORDER = ['infantry', 'archer', 'cavalry', 'scout', 'commander'];

  // move：一次行动最多走几格（曼哈顿距离）；range：攻击距离，0 表示不能攻击。
  // count：每方单位总数，同时决定每个单位币的初始数量。
  var UNITS = {
    infantry: {
      id: 'infantry', name: '步兵', glyph: '步',
      move: 1, range: 1, count: 5, value: 20,
      desc: '每回合最多移动 1 格，攻击相邻 1 格内的敌人。'
    },
    archer: {
      id: 'archer', name: '弓箭手', glyph: '弓',
      move: 1, range: 2, count: 3, value: 35,
      desc: '移动 1 格，可攻击 2 格内的敌人，是唯一的远程单位。'
    },
    cavalry: {
      id: 'cavalry', name: '骑兵', glyph: '骑',
      move: 2, range: 1, count: 3, value: 35,
      desc: '移动 2 格，攻击相邻 1 格内的敌人，适合快速支援。'
    },
    scout: {
      id: 'scout', name: '斥候', glyph: '斥',
      move: 3, range: 0, count: 2, value: 15,
      desc: '移动 3 格，不能攻击；最快抢占据点的单位。'
    },
    commander: {
      id: 'commander', name: '指挥官', glyph: '指',
      move: 2, range: 1, count: 1, value: 55,
      desc: '移动 2 格，攻击相邻 1 格内的敌人；简化版没有额外光环。'
    }
  };

  // 双方各 6 个据点，共 12 个。坐标为 0 起算的 [row, col]。
  // 0 号玩家（你）在下方，1 号玩家（AI）在上方，布局左右镜像。
  var STRONGHOLDS = [
    { id: 'h0', r: 1, c: 1, side: 1 },
    { id: 'h1', r: 1, c: 3, side: 1 },
    { id: 'h2', r: 1, c: 5, side: 1 },
    { id: 'h3', r: 2, c: 0, side: 1 },
    { id: 'h4', r: 2, c: 3, side: 1 },
    { id: 'h5', r: 2, c: 6, side: 1 },
    { id: 'h6', r: 4, c: 0, side: 0 },
    { id: 'h7', r: 4, c: 3, side: 0 },
    { id: 'h8', r: 4, c: 6, side: 0 },
    { id: 'h9', r: 5, c: 1, side: 0 },
    { id: 'h10', r: 5, c: 3, side: 0 },
    { id: 'h11', r: 5, c: 5, side: 0 }
  ];

  // 大本营：被敌方单位踏入即失败。
  var BASES = [
    { owner: 0, r: 6, c: 3, name: '你的大本营' },
    { owner: 1, r: 0, c: 3, name: 'AI 大本营' }
  ];

  var PLAYER_NAMES = ['你', 'AI'];

  // 界面配色：0 号玩家青蓝，1 号玩家赤红。
  var PLAYER_COLORS = ['#3f8ea8', '#b4513f'];

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    WIN_STRONGHOLDS: WIN_STRONGHOLDS,
    HAND_DRAW: HAND_DRAW,
    MAX_TURNS: MAX_TURNS,
    UNIT_ORDER: UNIT_ORDER,
    UNITS: UNITS,
    STRONGHOLDS: STRONGHOLDS,
    BASES: BASES,
    PLAYER_NAMES: PLAYER_NAMES,
    PLAYER_COLORS: PLAYER_COLORS
  });
});
