/*
 * 24 点 · 24 Game Premium — 静态展示数据（UMD）
 *
 * 页面与美术合成页共用：花色、难度文案、牌面点阵坐标、配色。
 * 引擎本身不依赖本文件；本文件也不含规则逻辑。
 *
 * 牌面点阵遵循标准扑克的 2–10 排列（上下 180° 严格对称）：
 *   2 上下各一、3 中列三枚、4 四角、5 四角加中、
 *   6 两列各三、7 再加中上、8 再加中下、
 *   9 两列各四加中、10 两列各四加中上中下、A/1 单枚大花色。
 * 坐标是牌面百分比，x 与 y 均为 0–100。
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Game24Data = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SUITS = [
    { key: 'spades', symbol: '♠', zh: '黑桃', red: false, color: '#1c1a17' },
    { key: 'hearts', symbol: '♥', zh: '红桃', red: true, color: '#a13a32' },
    { key: 'diamonds', symbol: '♦', zh: '方块', red: true, color: '#a13a32' },
    { key: 'clubs', symbol: '♣', zh: '梅花', red: false, color: '#1c1a17' }
  ];

  var DIFFICULTIES = [
    { key: 'easy', label: '简单', desc: '至少 4 种规范解', base: 80 },
    { key: 'normal', label: '普通', desc: '2–3 种规范解', base: 100 },
    { key: 'hard', label: '困难', desc: '恰好 1 种规范解', base: 140 }
  ];

  var PALETTE = {
    bg: '#120d08',
    bgDeep: '#0a0704',
    panel: '#1e1710',
    panel2: '#2a2015',
    paper: '#f1e7d0',
    paperDeep: '#ddceb0',
    ink: '#f7eedb',
    inkDim: '#cbbda5',
    inkFaint: '#9c8e78',
    walnut: '#3a2819',
    walnutLight: '#5a4029',
    brass: '#c9a35f',
    brassLight: '#efd399',
    brassDark: '#85622b',
    red: '#a13a32',
    black: '#1c1a17',
    green: '#8fb47a',
    danger: '#d47765',
    ok: '#8fc48a',
    shadow: 'rgba(0,0,0,.5)'
  };

  var PIPS = {
    1: [{ x: 50, y: 50 }],
    2: [{ x: 50, y: 20 }, { x: 50, y: 80 }],
    3: [{ x: 50, y: 19 }, { x: 50, y: 50 }, { x: 50, y: 81 }],
    4: [{ x: 30, y: 20 }, { x: 70, y: 20 }, { x: 30, y: 80 }, { x: 70, y: 80 }],
    5: [{ x: 30, y: 20 }, { x: 70, y: 20 }, { x: 50, y: 50 }, { x: 30, y: 80 }, { x: 70, y: 80 }],
    6: [
      { x: 30, y: 18 }, { x: 70, y: 18 },
      { x: 30, y: 50 }, { x: 70, y: 50 },
      { x: 30, y: 82 }, { x: 70, y: 82 }
    ],
    7: [
      { x: 30, y: 18 }, { x: 70, y: 18 },
      { x: 30, y: 50 }, { x: 70, y: 50 },
      { x: 30, y: 82 }, { x: 70, y: 82 },
      { x: 50, y: 33 }
    ],
    8: [
      { x: 30, y: 18 }, { x: 70, y: 18 },
      { x: 30, y: 50 }, { x: 70, y: 50 },
      { x: 30, y: 82 }, { x: 70, y: 82 },
      { x: 50, y: 33 }, { x: 50, y: 67 }
    ],
    9: [
      { x: 30, y: 15 }, { x: 70, y: 15 },
      { x: 30, y: 38 }, { x: 70, y: 38 },
      { x: 30, y: 62 }, { x: 70, y: 62 },
      { x: 30, y: 85 }, { x: 70, y: 85 },
      { x: 50, y: 50 }
    ],
    10: [
      { x: 30, y: 15 }, { x: 70, y: 15 },
      { x: 30, y: 38 }, { x: 70, y: 38 },
      { x: 30, y: 62 }, { x: 70, y: 62 },
      { x: 30, y: 85 }, { x: 70, y: 85 },
      { x: 50, y: 26 }, { x: 50, y: 74 }
    ]
  };

  // 标准 SVG 花色轮廓；fill=currentColor，颜色由牌面 .red / .black 控制。
  var SUIT_PATHS = {
    spades: 'M12 1.8c2.9 4 8.4 7.4 8.4 11.8a4.5 4.5 0 0 1-7.1 3.6c.4 1.5 1 2.8 1.7 3.8h-6c.7-1 1.3-2.3 1.7-3.8A4.5 4.5 0 0 1 3.6 13.6C3.6 9.2 9.1 5.8 12 1.8Z',
    hearts: 'M12 21.2C12 21.2 3 15 3 8.7 3 5.5 5.2 3.4 8 3.4c1.7 0 3.2.9 4 2.2.8-1.3 2.3-2.2 4-2.2 2.8 0 5 2.1 5 5.3 0 6.3-9 12.5-9 12.5Z',
    diamonds: 'M12 1.8 21 12l-9 10.2L3 12Z',
    clubs: 'M12 1.9a4.1 4.1 0 0 1 4 4.3c0 1.4-.7 2.7-1.8 3.4 1.1-.6 2.4-.4 3.4.6a4.1 4.1 0 1 1-4.6 6.3c.2 1.4.8 2.7 1.6 3.7h-5.2c.8-1 1.4-2.3 1.6-3.7A4.1 4.1 0 1 1 6.4 10.2c1-1 2.3-1.2 3.4-.6A4.1 4.1 0 0 1 12 1.9Z'
  };

  var PIPS_BY_VALUE = PIPS;
  var PIP_TOTAL = Object.keys(PIPS).reduce(function (sum, key) { return sum + PIPS[key].length; }, 0);

  return {
    SUITS: SUITS,
    SUIT_BY_KEY: SUITS.reduce(function (out, suit) { out[suit.key] = suit; return out; }, {}),
    DIFFICULTIES: DIFFICULTIES,
    PALETTE: PALETTE,
    PIPS: PIPS,
    PIPS_BY_VALUE: PIPS_BY_VALUE,
    PIP_TOTAL: PIP_TOTAL,
    SUIT_PATHS: SUIT_PATHS,
    CARD_ASPECT: [63, 88]
  };
});
