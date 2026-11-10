/*
 * Stone Age（石器时代）premium 数据 — UMD
 *
 * 真实基础版口径：
 *   - 2–4 人；每人 5 个工人（上限 10）、12 食物；
 *   - 资源：木、砖、石、金；食物独立；
 *   - 28 张建筑（4 叠 ×7，2 人用 2 叠、3 人 3 叠、4 人 4 叠）；
 *   - 36 张文明卡，4 个展示位；购买费用 = 从右往左的槽位 1–4 个资源；
 *   - 8 种文化符号（书写、陶艺、医疗、织造、音乐、艺术、运输、日晷），
 *     成套计分 n²；4 种乘数：农夫、工具匠、建房者、萨满。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoneAgeData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RESOURCES = ['wood', 'brick', 'stone', 'gold'];
  var RESOURCE_NAMES = { wood: '木', brick: '砖', stone: '石', gold: '金', food: '食物' };
  var DIVISORS = { food: 2, wood: 3, brick: 4, stone: 5, gold: 6 };
  var CULTURE_SYMBOLS = ['writing', 'pottery', 'healing', 'weaving', 'music', 'art', 'transport', 'sundial'];
  var CULTURE_NAMES = {
    writing: '书写', pottery: '陶艺', healing: '医疗', weaving: '织造',
    music: '音乐', art: '艺术', transport: '运输', sundial: '日晷'
  };
  var MULTIPLIERS = ['farmer', 'toolmaker', 'hutbuilder', 'shaman'];
  var MULTIPLIER_NAMES = { farmer: '农夫', toolmaker: '工具匠', hutbuilder: '建房者', shaman: '萨满' };

  var SPOTS = [
    { id: 'toolmaker', name: '工具坊', kind: 'village', capacity: 1, exact: 1, desc: '获得或升级 1 个工具（1→2→3→4）。' },
    { id: 'hut', name: '成长小屋', kind: 'village', capacity: 2, exact: 2, desc: '获得 1 个新工人，下轮可用（上限 10）。' },
    { id: 'field', name: '农田', kind: 'village', capacity: 1, exact: 1, desc: '农业 +1（上限 10），每轮自动提供食物。' },
    { id: 'hunt', name: '猎场', kind: 'hunt', capacity: Infinity, divisor: 2, resource: 'food', desc: '每工人 1 骰，总点数 ÷2 得食物。' },
    { id: 'forest', name: '森林', kind: 'resource', capacity: 7, divisor: 3, resource: 'wood', desc: '每工人 1 骰，总点数 ÷3 得木。' },
    { id: 'clay', name: '砖坑', kind: 'resource', capacity: 7, divisor: 4, resource: 'brick', desc: '每工人 1 骰，总点数 ÷4 得砖。' },
    { id: 'quarry', name: '采石场', kind: 'resource', capacity: 7, divisor: 5, resource: 'stone', desc: '每工人 1 骰，总点数 ÷5 得石。' },
    { id: 'river', name: '河流', kind: 'resource', capacity: 7, divisor: 6, resource: 'gold', desc: '每工人 1 骰，总点数 ÷6 得金。' },
    { id: 'civ', name: '文明卡', kind: 'civ', capacity: 4, desc: '支付 1–4 个资源，获得展示位上的文明卡。' },
    { id: 'building', name: '建筑', kind: 'building', capacity: 4, desc: '支付资源购买该叠顶部建筑，立即得分。' }
  ];
  var SPOT_BY_ID = Object.create(null);
  SPOTS.forEach(function (s) { SPOT_BY_ID[s.id] = s; });

  var BUILDINGS = [
    { id: 'b01', name: '木屋', cost: { wood: 2, brick: 1 }, points: 6 },
    { id: 'b02', name: '石屋', cost: { brick: 2, stone: 1 }, points: 8 },
    { id: 'b03', name: '集市', cost: { wood: 1, brick: 1, stone: 1 }, points: 9 },
    { id: 'b04', name: '工坊', cost: { wood: 2, stone: 1 }, points: 10 },
    { id: 'b05', name: '神庙', cost: { stone: 2, gold: 1 }, points: 12 },
    { id: 'b06', name: '金饰', cost: { gold: 1, stone: 1 }, points: 7 },
    { id: 'b07', name: '大教堂', cost: { wood: 2, brick: 2, stone: 2 }, points: 15 },
    { id: 'b08', name: '粮仓', cost: { wood: 1, brick: 2, gold: 1 }, points: 11 },
    { id: 'b09', name: '猎人小屋', cost: { wood: 2, gold: 1 }, points: 8 },
    { id: 'b10', name: '陶窑', cost: { brick: 3 }, points: 6 },
    { id: 'b11', name: '采石场', cost: { stone: 3 }, points: 7 },
    { id: 'b12', name: '金矿', cost: { gold: 2 }, points: 9 },
    { id: 'b13', name: '长屋', cost: { wood: 3, brick: 1 }, points: 8 },
    { id: 'b14', name: '谷仓', cost: { wood: 2, brick: 2 }, points: 9 },
    { id: 'b15', name: '水井', cost: { wood: 2, stone: 2 }, points: 10 },
    { id: 'b16', name: '火塘', cost: { brick: 1, stone: 1, gold: 1 }, points: 10 },
    { id: 'b17', name: '图腾柱', cost: { wood: 1, stone: 2 }, points: 9 },
    { id: 'b18', name: '兽栏', cost: { wood: 2, brick: 1, gold: 1 }, points: 10 },
    { id: 'b19', name: '织坊', cost: { brick: 2, gold: 1 }, points: 9 },
    { id: 'b20', name: '药圃', cost: { wood: 1, gold: 2 }, points: 11 },
    { id: 'b21', name: '祭坛', cost: { stone: 2, gold: 2 }, points: 14 },
    { id: 'b22', name: '大屋', cost: { wood: 3, stone: 2 }, points: 13 },
    { id: 'b23', name: '石墙', cost: { brick: 2, stone: 2 }, points: 12 },
    { id: 'b24', name: '宝库', cost: { gold: 2, stone: 1 }, points: 10 },
    { id: 'b25', name: '工坊塔', cost: { wood: 2, brick: 2, gold: 1 }, points: 13 },
    { id: 'b26', name: '圣殿', cost: { stone: 3, gold: 1 }, points: 14 },
    { id: 'b27', name: '王座', cost: { wood: 2, stone: 2, gold: 2 }, points: 16 },
    { id: 'b28', name: '巨石阵', cost: { stone: 4, gold: 2 }, points: 18 }
  ];
  var BUILDING_BY_ID = Object.create(null);
  BUILDINGS.forEach(function (b) { BUILDING_BY_ID[b.id] = b; });

  var CIV_CARDS = [];
  var cid = 0;
  function card(name, category, top, bottom) {
    cid += 1;
    CIV_CARDS.push({ id: 'c' + (cid < 10 ? '0' + cid : cid), name: name, category: category, top: top, bottom: bottom });
  }
  // 10 张骰子选择：立即获得一种骰面收益（木/砖/石/金/工具/农业）。
  var dieNames = ['狩猎女神', '丰饶之角', '石语者', '金色河谷', '工匠之魂', '田野低语', '火种', '河湾', '采石人之歌', '丰收祭'];
  var dieTops = [
    { kind: 'resource', resource: 'wood', amount: 1 },
    { kind: 'resource', resource: 'brick', amount: 1 },
    { kind: 'resource', resource: 'stone', amount: 1 },
    { kind: 'resource', resource: 'gold', amount: 1 },
    { kind: 'tool', amount: 1 },
    { kind: 'agriculture', amount: 1 }
  ];
  var bottomCycle = CULTURE_SYMBOLS.concat(MULTIPLIERS);
  dieNames.forEach(function (name, i) {
    card(name, 'dice', dieTops[i % dieTops.length], { kind: i % 2 ? 'multiplier' : 'culture', key: bottomCycle[i % bottomCycle.length] });
  });
  // 7 张固定食物。
  [1, 2, 3, 4, 5, 7, 1].forEach(function (n, i) {
    card('食物卡 ' + (i + 1), 'food', { kind: 'food', amount: n }, { kind: 'culture', key: CULTURE_SYMBOLS[(i + 3) % 8] });
  });
  // 5 张固定资源。
  [
    { stone: 1 }, { stone: 2 }, { gold: 1 }, { brick: 1 }, { wood: 2 }
  ].forEach(function (gain, i) {
    card('资源卡 ' + (i + 1), 'resource', { kind: 'bundle', gain: gain }, { kind: 'multiplier', key: MULTIPLIERS[i % 4] });
  });
  // 3 张骰点资源。
  ['wood', 'stone', 'gold'].forEach(function (res, i) {
    card('骰点' + RESOURCE_NAMES[res], 'roll', { kind: 'rollResource', resource: res }, { kind: 'culture', key: CULTURE_SYMBOLS[(i + 1) % 8] });
  });
  // 3 张立即 3 分。
  [0, 1, 2].forEach(function (i) {
    card('胜利卡 ' + (i + 1), 'vp', { kind: 'vp', amount: 3 }, { kind: 'multiplier', key: MULTIPLIERS[(i + 1) % 4] });
  });
  // 3 张一次性工具。
  [2, 3, 4].forEach(function (n, i) {
    card('一次性工具 +' + n, 'toolOnce', { kind: 'onceTool', amount: n }, { kind: 'culture', key: CULTURE_SYMBOLS[(i + 5) % 8] });
  });
  // 2 张永久工具、2 张永久农业、1 张背面卡。
  card('永久工具 I', 'tool', { kind: 'tool', amount: 1 }, { kind: 'multiplier', key: 'toolmaker' });
  card('永久工具 II', 'tool', { kind: 'tool', amount: 1 }, { kind: 'multiplier', key: 'toolmaker' });
  card('永久农田 I', 'agriculture', { kind: 'agriculture', amount: 1 }, { kind: 'multiplier', key: 'farmer' });
  card('永久农田 II', 'agriculture', { kind: 'agriculture', amount: 1 }, { kind: 'multiplier', key: 'hutbuilder' });
  card('秘藏', 'hidden', { kind: 'hidden' }, { kind: 'culture', key: 'sundial' });
  var CIV_BY_ID = Object.create(null);
  CIV_CARDS.forEach(function (c) { CIV_BY_ID[c.id] = c; });

  return {
    RESOURCES: RESOURCES,
    RESOURCE_NAMES: RESOURCE_NAMES,
    DIVISORS: DIVISORS,
    CULTURE_SYMBOLS: CULTURE_SYMBOLS,
    CULTURE_NAMES: CULTURE_NAMES,
    MULTIPLIERS: MULTIPLIERS,
    MULTIPLIER_NAMES: MULTIPLIER_NAMES,
    SPOTS: SPOTS,
    SPOT_BY_ID: SPOT_BY_ID,
    BUILDINGS: BUILDINGS,
    BUILDING_BY_ID: BUILDING_BY_ID,
    CIV_CARDS: CIV_CARDS,
    CIV_BY_ID: CIV_BY_ID,
    START_WORKERS: 5,
    MAX_WORKERS: 10,
    START_FOOD: 12,
    MAX_AGRICULTURE: 10,
    MAX_TOOL: 4,
    PLAYER_NAMES: ['你', 'AI · 猎手', 'AI · 工匠', 'AI · 祭司'],
    PLAYER_COLORS: ['#b3452f', '#3d6b8c', '#6b8c3d', '#8c6b3d']
  };
});
