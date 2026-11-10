/* Pioneers premium — shared static reference data.
 *
 * UMD: browsers read window.PioneersPremiumData, Node reads module.exports.
 * Facts only; rules logic lives in engine.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PioneersPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD = {
    hexes: 19,
    rows: [3, 4, 5, 4, 3],
    terrainCounts: { wheat: 6, stone: 6, wood: 6, neutral: 1 },
    vertices: 54,
    edges: 72,
    coastalEdges: 30,
    interiorEdges: 42,
    ports: 4,
    portRate: 2,
    bankRate: 3,
    tokenCount: 18,
    tokenPool: [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12],
    noToken: 7,
    pips: { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 },
    maxRounds: 12,
    winPoints: 8,
    hexEdgeMillimetres: 57,
    tileThicknessMillimetres: 2.4,
    boardMillimetres: { width: 490, height: 560 }
  };

  var PIECES = [
    { id: 'road', zh: '道路', cost: { wood: 1, stone: 1 }, costText: '1 木 + 1 石', points: 0, max: 10, note: '必须接自己的道路或建筑，最多 10 条。' },
    { id: 'settlement', zh: '村庄', cost: { wheat: 1, stone: 1, wood: 1 }, costText: '1 麦 + 1 石 + 1 木', points: 1, max: 5, note: '必须接自己的道路，最多 5 座；与任何村庄/城市至少隔一个空交点。' },
    { id: 'city', zh: '城市', cost: { wheat: 2, stone: 3 }, costText: '2 麦 + 3 石', points: 2, max: 3, note: '只能由自己的村庄升级，最多 3 座，净加 1 分。' }
  ];

  var RESOURCES = [
    { id: 'wheat', zh: '麦', terrain: '麦田', color: '#d8a84e', note: '麦田产出。村庄/城市升级都需要麦。' },
    { id: 'stone', zh: '石', terrain: '石山', color: '#9b9a94', note: '石山产出。道路与城市最耗石。' },
    { id: 'wood', zh: '木', terrain: '林地', color: '#8b6842', note: '林地产出。道路与村庄都需要木。' }
  ];

  var RULES = [
    '19 块尖顶六边形按 3-4-5-4-3 排成菱形岛，共 54 个交点、72 条边。',
    '地形固定 6 麦田、6 石山、6 林地、1 块不产出的霜洞。',
    '18 个点数标记取 2–12 且不含 7：2 与 12 各 1 个，其余各 2 个；6 与 8 不相邻。',
    '4 座潮门位于海岸边，占住潮门边任一交点即可 2:1 兑换；平时为 3:1。',
    '开局蛇形摆放两轮：先正序每人村庄+道路，再逆序每人村庄+道路；第二个村庄立刻按相邻地块各拿 1 份资源。',
    '每回合先掷两颗骰子，再按点数为所有玩家产出，然后可连续建造/兑换，最后结束回合。',
    '点数 7 不产资源；本作使用简化霜洞，不设强盗，也不弃牌。',
    '村庄 1 分、城市 2 分；先到 8 分立即获胜，否则 12 回合后分高者胜，同分并列。',
    '本作没有发展卡，也没有最长路/最大军加分；最长路只作为高手 AI 的连通性参考。'
  ];

  var TIPS = [
    '先看点数覆盖，再看地形种类：6 和 8 各有 5/36 的概率，2 和 12 只有 1/36。',
    '第二个村庄会立刻给资源，开局把第二个村庄放在高点数交叉口，比第一个更值钱。',
    '潮门是分数转换器：2:1 能把多余的木石换成城市缺的那块石，提前一回合升级。',
    '5 个村庄与 3 座城市的上限意味着常见终点是 3 城 + 2 村，正好 8 分。',
    '道路不计分，但决定你能否抢到下一个高点数交点；不要为了铺满 10 条而透支石料。'
  ];

  var SOURCES = {
    bilibili: [
      { bvid: 'BV18J4P6FEEt', title: '【桌游规则】15分钟学会《卡坦：基础》+5-6人扩展！动画图解，新手一看就懂' },
      { bvid: 'BV1JzgtzdESt', title: '卡坦岛｜规则讲解+试玩演示' },
      { bvid: 'BV1Rb411679e', title: '【桌游速成班007】4分09秒讲完《卡坦岛》桌游规则' },
      { bvid: 'BV1pDsszQEL1', title: '《卡坦岛》详细规则教学（不含扩展）' }
    ],
    note: 'B 站教程只读取标题与文字简介，用于核对蛇形摆放、掷骰产出、7 点、距离规则与港口兑换；不截图、不 OCR。本作为原创三资源变体，潮门/霜洞等术语与数值按本作规则页为准。'
  };

  var MATERIALS = {
    tile: '灰米色压纸板，2.4mm 厚，细纸纤维与亚麻压纹',
    road: '浅枫木道路条，40 × 8 × 6mm',
    settlement: '浅枫木小屋，约 20mm 高，可后染四色',
    felt: '深青绿羊毛毡桌面',
    palette: {
      wheat: '#d8a84e', stone: '#9b9a94', wood: '#8b6842', neutral: '#cdd8d4',
      player1: '#c44536', player2: '#2f6fb0', player3: '#3f8f62', player4: '#c98a2e'
    }
  };

  return {
    BOARD: BOARD,
    PIECES: PIECES,
    RESOURCES: RESOURCES,
    RULES: RULES,
    TIPS: TIPS,
    SOURCES: SOURCES,
    MATERIALS: MATERIALS
  };
});
