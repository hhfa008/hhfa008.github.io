/*
 * Kingdomino（多米诺王国）数据表 — UMD
 *
 * 48 张多米诺瓦片的真实编号、地形与皇冠数量，来自公开牌表数据集：
 * https://github.com/RuPaulsDataRace/Kingdomino-For-Queens
 * 地形共 6 种；96 格、39 顶皇冠。每行：[编号, A 半地形, A 皇冠, B 半地形, B 皇冠]。
 *
 * 浏览器：<script src="data.js"></script> 后使用 globalThis.KingdominoData。
 * Node：const Data = require('./data.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KingdominoData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TERRAINS = Object.freeze({
    wheat: { key: 'wheat', name: '麦田', short: '麦', face: '#d8ad43', deep: '#9a7420', light: '#f2d985', ink: '#3a2a06' },
    forest: { key: 'forest', name: '森林', short: '林', face: '#2f6b45', deep: '#1b432a', light: '#79b58a', ink: '#eaf6ec' },
    water: { key: 'water', name: '湖泊', short: '湖', face: '#3f7fae', deep: '#23506f', light: '#9fd0ea', ink: '#eff9ff' },
    grass: { key: 'grass', name: '草原', short: '草', face: '#7fae55', deep: '#527a2f', light: '#c3df9b', ink: '#1f330c' },
    swamp: { key: 'swamp', name: '沼泽', short: '沼', face: '#8a6f4a', deep: '#5b4729', light: '#c8b184', ink: '#fbf3e3' },
    mine: { key: 'mine', name: '矿山', short: '矿', face: '#4a4a52', deep: '#2a2a30', light: '#9b9ba8', ink: '#f4f4fa' }
  });
  var TERRAIN_LIST = Object.freeze(['wheat', 'forest', 'water', 'grass', 'swamp', 'mine']);

  var RAW_TILES = [
    { id: 1, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 2, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 3, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 4, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 5, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 6, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 7, a: { terrain: 'water', crowns: 0 }, b: { terrain: 'water', crowns: 0 } },
    { id: 8, a: { terrain: 'water', crowns: 0 }, b: { terrain: 'water', crowns: 0 } },
    { id: 9, a: { terrain: 'water', crowns: 0 }, b: { terrain: 'water', crowns: 0 } },
    { id: 10, a: { terrain: 'grass', crowns: 0 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 11, a: { terrain: 'grass', crowns: 0 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 12, a: { terrain: 'swamp', crowns: 0 }, b: { terrain: 'swamp', crowns: 0 } },
    { id: 13, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 14, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'water', crowns: 0 } },
    { id: 15, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 16, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'swamp', crowns: 0 } },
    { id: 17, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'water', crowns: 0 } },
    { id: 18, a: { terrain: 'forest', crowns: 0 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 19, a: { terrain: 'wheat', crowns: 1 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 20, a: { terrain: 'wheat', crowns: 1 }, b: { terrain: 'water', crowns: 0 } },
    { id: 21, a: { terrain: 'wheat', crowns: 1 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 22, a: { terrain: 'wheat', crowns: 1 }, b: { terrain: 'swamp', crowns: 0 } },
    { id: 23, a: { terrain: 'wheat', crowns: 1 }, b: { terrain: 'mine', crowns: 0 } },
    { id: 24, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 25, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 26, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 27, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 28, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'water', crowns: 0 } },
    { id: 29, a: { terrain: 'forest', crowns: 1 }, b: { terrain: 'grass', crowns: 0 } },
    { id: 30, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 31, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 32, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 33, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 34, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 35, a: { terrain: 'water', crowns: 1 }, b: { terrain: 'forest', crowns: 0 } },
    { id: 36, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'grass', crowns: 1 } },
    { id: 37, a: { terrain: 'water', crowns: 0 }, b: { terrain: 'grass', crowns: 1 } },
    { id: 38, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'swamp', crowns: 1 } },
    { id: 39, a: { terrain: 'grass', crowns: 0 }, b: { terrain: 'swamp', crowns: 1 } },
    { id: 40, a: { terrain: 'mine', crowns: 1 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 41, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'grass', crowns: 2 } },
    { id: 42, a: { terrain: 'water', crowns: 0 }, b: { terrain: 'grass', crowns: 2 } },
    { id: 43, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'swamp', crowns: 2 } },
    { id: 44, a: { terrain: 'grass', crowns: 0 }, b: { terrain: 'swamp', crowns: 2 } },
    { id: 45, a: { terrain: 'mine', crowns: 2 }, b: { terrain: 'wheat', crowns: 0 } },
    { id: 46, a: { terrain: 'swamp', crowns: 0 }, b: { terrain: 'mine', crowns: 2 } },
    { id: 47, a: { terrain: 'swamp', crowns: 0 }, b: { terrain: 'mine', crowns: 2 } },
    { id: 48, a: { terrain: 'wheat', crowns: 0 }, b: { terrain: 'mine', crowns: 3 } }
  ];

  var TILES = Object.freeze(RAW_TILES.map(function (tile) {
    return Object.freeze({
      id: tile.id,
      a: Object.freeze({ terrain: tile.a.terrain, crowns: tile.a.crowns }),
      b: Object.freeze({ terrain: tile.b.terrain, crowns: tile.b.crowns })
    });
  }));

  var ORIENTATION_LABELS = Object.freeze([
    '横向 A|B', '横向 B|A', '纵向 A/B', '纵向 B/A'
  ]);

  var SOURCES = Object.freeze([
    {
      title: '析弈讲规则#多米诺王国/8+/2-4/Blue Orange/新天鹅堡',
      up: '析弈讲规则', bv: 'BV1x5411t7xg',
      url: 'https://www.bilibili.com/video/BV1x5411t7xg',
      points: '4 分 45 秒快速规则；2–4 人、Blue Orange 出版；核心是选瓦片、按地形接续、皇冠计分。'
    },
    {
      title: '【勃根地桌遊】多米諾王國 Kingdomino 桌遊教學影片',
      up: '南风丶小草', bv: 'BV1ZV411m7n8',
      url: 'https://www.bilibili.com/video/BV1ZV411m7n8',
      points: '6 分 15 秒教学；介绍 5×5 王国、瓦片接续、领地面积乘皇冠数的计分方式。'
    },
    {
      title: '【Kingdomino|多米诺王国】一个圈地自萌的桌游',
      up: '一起来捉鱿', bv: 'BV1SW411V7JR',
      url: 'https://www.bilibili.com/video/BV1SW411V7JR',
      points: '14 分 45 秒；2–4 人、每局约 15–20 分钟；玩家扮演中世纪领主扩建领地。'
    }
  ]);

  var VARIANTS = Object.freeze([
    { name: 'Harmony', text: '5×5 王国完整无空格，额外 +5 分。' },
    { name: 'Middle Kingdom', text: '城堡位于 5×5 正中央，额外 +10 分。' },
    { name: 'Mighty Duel', text: '两人使用全部 48 张，7×7 王国。' }
  ]);

  return Object.freeze({
    TERRAINS: TERRAINS,
    TERRAIN_LIST: TERRAIN_LIST,
    TILES: TILES,
    ORIENTATION_LABELS: ORIENTATION_LABELS,
    SOURCES: SOURCES,
    VARIANTS: VARIANTS
  });
});
