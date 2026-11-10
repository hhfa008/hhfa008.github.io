/*
 * FreeCell premium — static palette / labels / material references.
 * UMD: browser global FreeCellData, Node require('./data.js').
 * No DOM, no logic.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FreeCellData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'freecell-premium',
    titleZh: '空当接龙',
    titleEn: 'FreeCell',
    tagline: '微软局号 · 四空位 · 超级搬运',
    badge: '单人',
    palette: {
      bg: '#070d1a',
      bg2: '#0c1730',
      felt: '#061a4a',
      feltDeep: '#04102f',
      panel: '#0d1a33',
      panel2: '#132445',
      ivory: '#f7f1df',
      ivory2: '#e9e0c8',
      ink: '#eef2ff',
      inkDim: '#aab6d4',
      gold: '#d8b26a',
      goldBright: '#f3d99a',
      brassDark: '#8c6828',
      red: '#c0392b',
      black: '#1b2233',
      danger: '#e07a67',
      ok: '#86c99a'
    },
    materials: {
      felt: '../../assets/art/premium/freecell/felt.webp',
      cardBack: '../../assets/art/premium/freecell/card-back.webp'
    },
    assets: {
      cover: 'assets/cover.webp',
      og: 'assets/og.webp',
      detail: 'assets/detail-1.webp',
      card: 'assets/card.webp'
    },
    keyboard: {
      n: '新局',
      u: '撤销',
      h: '提示',
      a: '自动收牌',
      r: '随机局号',
      t: '切换主题',
      escape: '取消选择'
    },
    realism: {
      deck: 52,
      columns: 8,
      columnDistribution: [7, 7, 7, 7, 6, 6, 6, 6],
      freeCells: 4,
      foundations: 4,
      cardMm: { width: 63, height: 88 },
      dealNumberRange: [1, 1000000]
    },
    sources: [
      { id: 'BV1yS4q6UEy3', title: '空当接龙新手入门：临时空位怎么用，整串怎么搬' },
      { id: 'BV1Sx411F7D6', title: '【芯酱】空当接龙教程' },
      { id: 'BV1XNYT6ZEnY', title: '2026年了，还有人想学空当接龙吗？' }
    ]
  };
});
