/*
 * Century: Spice Road（香料之路）数据表 — UMD
 *
 * 36 张得分卡的费用与分值来自公开牌表分析表（Quantifying Strategy, Table 1），
 * 与官方 36 张 Point Cards 数量一致；每张卡的费用向量顺序为
 * [姜黄 yellow, 藏红花 red, 豆蔻 green, 肉桂 brown]。
 *
 * 43 张商人卡由官方规则中的生产 / 转换 / 升级三类效果组成，数量凑足 43；
 * 起始手牌为官方两张：生产 2 姜黄 + 升级 2。
 * 香料方块总数按公开组件清单：姜黄 34、藏红花 30、豆蔻 21、肉桂 20。
 *
 * 浏览器：<script src="data.js"></script> 后使用 globalThis.CenturySpiceRoadData。
 * Node：const Data = require('./data.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CenturySpiceRoadData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SPICES = Object.freeze([
    { key: 'turmeric', name: '姜黄', short: '黄', face: '#d9a21b', deep: '#8f6508', light: '#f4d67a', ink: '#2c2004' },
    { key: 'saffron', name: '藏红花', short: '红', face: '#c24c36', deep: '#7e2417', light: '#f0a28e', ink: '#fff3ef' },
    { key: 'cardamom', name: '豆蔻', short: '绿', face: '#3f8f5b', deep: '#205c35', light: '#9fd8b2', ink: '#effaf2' },
    { key: 'cinnamon', name: '肉桂', short: '棕', face: '#8a5a3b', deep: '#54321c', light: '#cfa982', ink: '#fbf1e7' }
  ]);
  var SPICE_KEYS = Object.freeze(SPICES.map(function (s) { return s.key; }));

  var POINT_CARDS = Object.freeze([
    { id: 'P01', points: 6, cost: [2, 2, 0, 0] },
    { id: 'P02', points: 7, cost: [3, 2, 0, 0] },
    { id: 'P03', points: 8, cost: [0, 4, 0, 0] },
    { id: 'P04', points: 8, cost: [2, 0, 2, 0] },
    { id: 'P05', points: 8, cost: [2, 3, 0, 0] },
    { id: 'P06', points: 9, cost: [3, 0, 2, 0] },
    { id: 'P07', points: 10, cost: [0, 2, 2, 0] },
    { id: 'P08', points: 10, cost: [0, 5, 0, 0] },
    { id: 'P09', points: 10, cost: [2, 0, 0, 2] },
    { id: 'P10', points: 11, cost: [2, 0, 3, 0] },
    { id: 'P11', points: 11, cost: [3, 0, 0, 2] },
    { id: 'P12', points: 12, cost: [0, 0, 4, 0] },
    { id: 'P13', points: 12, cost: [0, 2, 0, 2] },
    { id: 'P14', points: 12, cost: [0, 3, 2, 0] },
    { id: 'P15', points: 13, cost: [0, 2, 3, 0] },
    { id: 'P16', points: 14, cost: [0, 0, 2, 2] },
    { id: 'P17', points: 14, cost: [0, 3, 0, 2] },
    { id: 'P18', points: 14, cost: [2, 0, 0, 3] },
    { id: 'P19', points: 15, cost: [0, 0, 5, 0] },
    { id: 'P20', points: 16, cost: [0, 0, 0, 4] },
    { id: 'P21', points: 16, cost: [0, 2, 0, 3] },
    { id: 'P22', points: 17, cost: [0, 0, 3, 2] },
    { id: 'P23', points: 18, cost: [0, 0, 2, 3] },
    { id: 'P24', points: 20, cost: [0, 0, 0, 5] },
    { id: 'P25', points: 9, cost: [2, 1, 0, 1] },
    { id: 'P26', points: 12, cost: [0, 2, 2, 1] },
    { id: 'P27', points: 12, cost: [1, 0, 2, 1] },
    { id: 'P28', points: 13, cost: [2, 2, 2, 0] },
    { id: 'P29', points: 15, cost: [2, 2, 0, 2] },
    { id: 'P30', points: 17, cost: [2, 0, 2, 2] },
    { id: 'P31', points: 19, cost: [0, 2, 2, 2] },
    { id: 'P32', points: 12, cost: [1, 1, 1, 1] },
    { id: 'P33', points: 14, cost: [3, 1, 1, 1] },
    { id: 'P34', points: 16, cost: [1, 3, 1, 1] },
    { id: 'P35', points: 18, cost: [1, 1, 3, 1] },
    { id: 'P36', points: 20, cost: [1, 1, 1, 3] }
  ]);

  var MERCHANT_TEMPLATES = Object.freeze([
    { key: 'create3y', name: '生产 · 3 姜黄', text: '获得 3 个姜黄', effect: {"type":"create","gain":[3,0,0,0]}, copies: 3 },
    { key: 'create4y', name: '生产 · 4 姜黄', text: '获得 4 个姜黄', effect: {"type":"create","gain":[4,0,0,0]}, copies: 2 },
    { key: 'create2r', name: '生产 · 2 藏红花', text: '获得 2 个藏红花', effect: {"type":"create","gain":[0,2,0,0]}, copies: 3 },
    { key: 'create3r', name: '生产 · 3 藏红花', text: '获得 3 个藏红花', effect: {"type":"create","gain":[0,3,0,0]}, copies: 2 },
    { key: 'create1g', name: '生产 · 1 豆蔻', text: '获得 1 个豆蔻', effect: {"type":"create","gain":[0,0,1,0]}, copies: 3 },
    { key: 'create2g', name: '生产 · 2 豆蔻', text: '获得 2 个豆蔻', effect: {"type":"create","gain":[0,0,2,0]}, copies: 2 },
    { key: 'create1b', name: '生产 · 1 肉桂', text: '获得 1 个肉桂', effect: {"type":"create","gain":[0,0,0,1]}, copies: 2 },
    { key: 'create1y1r', name: '生产 · 姜黄 + 藏红花', text: '获得 1 姜黄 + 1 藏红花', effect: {"type":"create","gain":[1,1,0,0]}, copies: 2 },
    { key: 'create1r1g', name: '生产 · 藏红花 + 豆蔻', text: '获得 1 藏红花 + 1 豆蔻', effect: {"type":"create","gain":[0,1,1,0]}, copies: 2 },
    { key: 'create1g1b', name: '生产 · 豆蔻 + 肉桂', text: '获得 1 豆蔻 + 1 肉桂', effect: {"type":"create","gain":[0,0,1,1]}, copies: 1 },
    { key: 'trade2y1r', name: '转换 · 2 姜黄 → 1 藏红花', text: '支付 2 姜黄，获得 1 藏红花', effect: {"type":"trade","cost":[2,0,0,0],"gain":[0,1,0,0]}, copies: 3 },
    { key: 'trade3y1r', name: '转换 · 3 姜黄 → 1 藏红花', text: '支付 3 姜黄，获得 1 藏红花', effect: {"type":"trade","cost":[3,0,0,0],"gain":[0,1,0,0]}, copies: 3 },
    { key: 'trade2r1g', name: '转换 · 2 藏红花 → 1 豆蔻', text: '支付 2 藏红花，获得 1 豆蔻', effect: {"type":"trade","cost":[0,2,0,0],"gain":[0,0,1,0]}, copies: 3 },
    { key: 'trade3r1g', name: '转换 · 3 藏红花 → 1 豆蔻', text: '支付 3 藏红花，获得 1 豆蔻', effect: {"type":"trade","cost":[0,3,0,0],"gain":[0,0,1,0]}, copies: 2 },
    { key: 'trade2g1b', name: '转换 · 2 豆蔻 → 1 肉桂', text: '支付 2 豆蔻，获得 1 肉桂', effect: {"type":"trade","cost":[0,0,2,0],"gain":[0,0,0,1]}, copies: 2 },
    { key: 'trade3g1b', name: '转换 · 3 豆蔻 → 1 肉桂', text: '支付 3 豆蔻，获得 1 肉桂', effect: {"type":"trade","cost":[0,0,3,0],"gain":[0,0,0,1]}, copies: 1 },
    { key: 'trade2y1g', name: '转换 · 2 姜黄 → 1 豆蔻', text: '支付 2 姜黄，获得 1 豆蔻', effect: {"type":"trade","cost":[2,0,0,0],"gain":[0,0,1,0]}, copies: 2 },
    { key: 'upgrade1', name: '升级 · 1 级', text: '将 1 个香料升级一级', effect: {"type":"upgrade","count":1}, copies: 3 },
    { key: 'upgrade2', name: '升级 · 2 级', text: '将 2 个香料各升级一级（可分两次升同一个）', effect: {"type":"upgrade","count":2}, copies: 2 }
  ]);

  var STARTING_CARDS = Object.freeze([
    { key: 'start-create2y', name: '起始 · 生产 2 姜黄', text: '获得 2 个姜黄', effect: { type: 'create', gain: [2, 0, 0, 0] }, starting: true },
    { key: 'start-upgrade2', name: '起始 · 升级 2', text: '将 2 个香料各升级一级', effect: { type: 'upgrade', count: 2 }, starting: true }
  ]);

  var CUBE_SUPPLY = Object.freeze({ turmeric: 34, saffron: 30, cardamom: 21, cinnamon: 20 });

  var SOURCES = Object.freeze([
    {
      title: '4分21秒讲完《香料之路》桌游规则',
      up: '哈姆雷特玩桌游', bv: 'BV1LkwzevE2h',
      url: 'https://www.bilibili.com/video/BV1LkwzevE2h',
      points: '德式轻策，2–5 人，约 35 分钟；快速讲完回合行动、香料生产/转换/升级与得分卡。'
    },
    {
      title: '传说中的璀璨宝石杀手 牧聪桌游第192期 香料之路教学视频',
      up: '兰州牧聪桌游', bv: 'BV1aQ4y1S7TY',
      url: 'https://www.bilibili.com/video/BV1aQ4y1S7TY',
      points: '11 分 13 秒教学；常被拿来与璀璨宝石对比，强调手牌构筑、商队香料上限与得分卡路线。'
    },
    {
      title: '《香料之路》桌游教学',
      up: 'Sunthway', bv: 'BV17a4y1E78r',
      url: 'https://www.bilibili.com/video/BV17a4y1E78r',
      points: '12 分 20 秒新人教学；覆盖设置、四种行动、商人卡市场与终局计分。'
    }
  ]);

  return Object.freeze({
    SPICES: SPICES,
    SPICE_KEYS: SPICE_KEYS,
    POINT_CARDS: POINT_CARDS,
    MERCHANT_TEMPLATES: MERCHANT_TEMPLATES,
    STARTING_CARDS: STARTING_CARDS,
    CUBE_SUPPLY: CUBE_SUPPLY,
    SOURCES: SOURCES
  });
});
