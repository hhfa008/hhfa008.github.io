/*
 * Gomoku Premium — static data (UMD).
 * Browser: globalThis.GomokuData; Node: require('./data.js').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GomokuData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLS = 'ABCDEFGHIJKLMNO'.split('');
  var STAR_POINTS = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];

  return {
    title: { zh: '五子棋', en: 'Gomoku' },
    subtitle: '十五路木盘 · 三档 AI · 双人联机',
    tagline: '落子无悔，五连即胜。榧木棋盘与那智黑石、蛤碁石的真实质感。',
    cols: COLS,
    starPoints: STAR_POINTS,
    levels: [
      { key: 'easy', value: 1, name: '入门', note: '随机偏邻接，适合初学者' },
      { key: 'normal', value: 2, name: '棋士', note: '攻防评分，会堵活四' },
      { key: 'hard', value: 4, name: '名人', note: '候选搜索，先算杀再算防' }
    ],
    aiNames: ['你', 'AI · 棋士'],
    players: {
      black: { name: '黑方', color: '#1b1d1f', stone: '那智黑石' },
      white: { name: '白方', color: '#f4efe2', stone: '蛤碁石' }
    },
    materials: {
      goban: '../../assets/art/premium/gomoku/goban-wood.webp',
      table: '../../assets/art/premium/gomoku/walnut-wood.webp',
      blackStone: '../../assets/art/premium/gomoku/stone-black.webp',
      whiteStone: '../../assets/art/premium/gomoku/stone-white.webp',
      cover: '../../assets/art/premium/gomoku/cover.webp',
      og: '../../assets/art/premium/gomoku/og.webp',
      detail: '../../assets/art/premium/gomoku/detail.webp'
    },
    physics: {
      stoneDiameterMm: 22,
      stoneThicknessMm: 10,
      boardGridMm: 22,
      boardLines: 15,
      intersections: 225
    },
    sources: [
      'https://www.bilibili.com/video/BV1wS4y1D7uT',
      'https://www.bilibili.com/video/BV1q54y1o7HQ',
      'https://www.bilibili.com/video/BV1dmxX63ETv',
      'https://www.bilibili.com/video/BV1Qt411n7Y4',
      'games/ART-GUIDE.md'
    ]
  };
});
