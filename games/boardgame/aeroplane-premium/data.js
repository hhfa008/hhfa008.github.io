/* Aeroplane Chess premium — shared static data.
 *
 * UMD: browsers read window.AeroplanePremiumData, Node reads module.exports.
 * Board geometry and colour constants are derived from engine.js so the page,
 * the rules page, the art renderer and the tests cannot drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.AeroplanePremiumData = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var E;
  if (typeof module === 'object' && module.exports) {
    E = require('./engine.js');
  } else {
    E = root.AeroplanePremiumEngine;
  }
  if (!E) throw new Error('AeroplanePremiumData requires engine.js');

  var perColor = [0, 0, 0, 0];
  for (var i = 0; i < E.RING_COLORS.length; i++) perColor[E.RING_COLORS[i]] += 1;

  var BOARD = {
    players: { min: E.MIN_PLAYERS, max: E.MAX_PLAYERS, default: 4 },
    planesPerPlayer: E.PLANES_PER_PLAYER,
    loop: E.LOOP,
    home: E.HOME,
    finish: E.FINISH,
    hangar: E.HANGAR,
    colors: E.COLORS.length,
    ringPerColor: perColor,
    starts: E.START_RING.slice(),
    bases: E.BASES.length,
    homeLanes: E.LANES.length,
    centerCells: E.CENTER.cells.length,
    grid: E.GRID,
    // Physical reference: a 330 mm folding board, 35 mm wing-span planes,
    // 16 mm dice. 1 mm = 8 px on a 1024 master.
    boardMillimetres: { width: 330, height: 330 },
    ringCellMillimetres: 23.5,
    planeMillimetres: { length: 24, wingspan: 24, thickness: 8 },
    diceMillimetres: 16,
    shortcut: { at: E.SHORTCUT_AT, fly: E.SHORTCUT_FLY },
    jump: E.JUMP_STEP
  };

  // Code-drawn top-down plane silhouette. The img-gen plane masters are
  // material references; the visible token is this path so every plane is a
  // complete aircraft (nose, both wings, tail) and never a cropped close-up.
  var PLANE_PATH = 'M50 4 L57 26 L94 44 L94 54 L57 48 L56 70 L70 82 L70 90 L50 84 L30 90 L30 82 L44 70 L43 48 L6 54 L6 44 L43 26 Z';
  var PLANE_VIEWBOX = '0 0 100 100';

  var COLORS = E.COLORS.map(function (c, index) {
    return {
      index: index,
      key: c.key,
      zh: c.zh,
      en: c.en,
      hex: c.hex,
      ink: c.ink,
      soft: c.soft,
      start: E.START_RING[index],
      startCell: E.RING_CELLS[E.START_RING[index]],
      base: E.BASES[index],
      lane: E.LANES[index]
    };
  });

  var RULES = [
    { title: '人数与目标', text: '2–4 人，每人 4 架飞机。四架全部准确到达中心终点的人获胜；其他人按已到终点架数、总进度排名。' },
    { title: '起飞', text: '掷出 6 才能把一架飞机从基地放到自己颜色的起点格。起飞不触发同色跳格，但若起点格上有敌机，敌机立刻回基地。' },
    { title: '再掷一次', text: '掷出 6 并完成移动后，同一位玩家再掷一次。连续三个 6 是惩罚：最近一次用 6 移动的飞机回到基地，本回合结束；若没有可罚的飞机，则直接跳过。' },
    { title: '同色跳 4', text: '落在与自己同色的环形格上，立即再前进 4 格。跳格只触发一次，不连锁；跳完的落点仍会结算撞子。' },
    { title: '虚线捷径', text: '环形跑道第 37 格（相对进度 36）是本色的虚线捷径口。落在这里不走 +4，而是沿虚线直飞 12 格；捷径与 +4 不叠加。' },
    { title: '撞子', text: '落在有敌机的环形格上，该格所有敌机都回各自基地，必须重新掷 6 才能起飞。归航跑道与中心终点区安全，不发生撞子。' },
    { title: '叠放', text: '本作采用简化的同格共存：己方飞机可以停在同一格，各自独立移动；敌机落到该格时，这一格上的己方飞机全部回基地。' },
    { title: '归航与精确终点', text: '走完 52 格后进入自己的 6 格归航跑道，最后进入中心终点。必须精确点数才能进入终点；点数超出时，飞机先到终点，再按超出的点数退回（例如 52 格掷 6 会退到 56），这次移动不算到达终点。' },
    { title: '无子可动', text: '掷出的点数没有任何合法移动时自动跳过；若掷出 6 则保留回合再掷一次。' },
    { title: '联机', text: '联机房间由服务端掷骰并保存全部飞机位置；客户端只提交“移动哪一架”，不能提交骰子，也拿不到未来的随机数。' }
  ];

  var TIPS = [
    '四架都在基地时，6 的第一选择通常是起飞；机场里的飞机既不推进也不威胁。',
    '接近终点时先算精确点数：还差 1–3 格就不要把所有希望押在同一架上。',
    '把敌机撞回基地的收益，往往大于自己多走 3–4 格，尤其是敌机已经进入后半圈。',
    '同色格每 4 格出现一次，落点前先数清楚跳 4 之后会不会正好踩到敌机。',
    '第 37 格的虚线捷径能一次前进 12 格，中盘抢进度时要主动规划到这一格。',
    '自己的飞机可以叠放，但被撞时整格全回基地；关键格不要堆太多飞机。'
  ];

  var FAQ = [
    {
      q: '为什么必须掷出 6 才能起飞？',
      a: '飞行棋把基地视为停机坪，只有 6 才允许一架飞机进入跑道起点。掷不到 6 时，基地里的飞机不能动；如果跑道上已有飞机，可以按点数移动它们。'
    },
    {
      q: '落在自己颜色的格子上会发生什么？',
      a: '立即再前进 4 格，只跳一次。若这一格正好是第 37 格的虚线捷径口，则改为沿虚线直飞 12 格，而不是 +4。跳完后的落点照样结算撞子。'
    },
    {
      q: '两架自己的飞机停在同一格会怎样？',
      a: '本作采用同格共存：它们各自独立移动，不合并、不阻挡。但敌机落到这一格时，这一格上的所有己方飞机都会回基地。'
    },
    {
      q: '终点可以超过吗？',
      a: '不可以。必须精确点数；点数超过剩余格数时，这架飞机这一步不能走，只能改走别的飞机或跳过。'
    },
    {
      q: '连续掷出三个 6 会怎样？',
      a: '第三次 6 不移动：最近一次用 6 移动的飞机回基地，然后换下一位。如果前两次 6 都没有可移动的飞机，则本回合直接跳过。'
    },
    {
      q: '联机会不会有人改骰子？',
      a: '不会。骰子由服务端引擎生成并写入权威状态，客户端提交的动作只包含“移动第几架飞机”；公开视图只下发已经发生的骰子历史，不下发种子或未来随机数。'
    }
  ];

  var SOURCES = {
    bilibili: [
      { bvid: 'BV1AK4y187Pt', title: '飞行棋教学', url: 'https://www.bilibili.com/video/BV1AK4y187Pt' },
      { bvid: 'BV1Fb4y1p7e7', title: '多合一游戏棋之飞行棋玩法和规则讲解', url: 'https://www.bilibili.com/video/BV1Fb4y1p7e7' },
      { bvid: 'BV1M24y1r7HK', title: '【飞行棋】的玩法以及详细规则', url: 'https://www.bilibili.com/video/BV1M24y1r7HK' },
      { bvid: 'BV1k48wzqELM', title: '飞行棋新手入门规则', url: 'https://www.bilibili.com/video/BV1k48wzqELM' }
    ],
    rules: '飞行棋通行民间规则：4 色各 13 格共 52 格彩环、掷 6 起飞与再掷、同色 +4、撞子回基地、6 格归航道、精确终点。B 站教程只读标题与文字，未截图、未 OCR。'
  };

  return {
    BOARD: BOARD,
    PLANE_PATH: PLANE_PATH,
    PLANE_VIEWBOX: PLANE_VIEWBOX,
    COLORS: COLORS,
    RULES: RULES,
    TIPS: TIPS,
    FAQ: FAQ,
    SOURCES: SOURCES,
    RING_CELLS: E.RING_CELLS,
    RING_COLORS: E.RING_COLORS,
    LANES: E.LANES,
    BASES: E.BASES,
    CENTER: E.CENTER,
    START_RING: E.START_RING
  };
});
