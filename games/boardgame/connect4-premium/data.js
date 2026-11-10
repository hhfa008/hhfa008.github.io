/* Connect 4 / 四子棋 premium — presentation data, dimensions and sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Connect4PremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'connect4-premium',
    title: '四子棋',
    titleEn: 'Connect 4',
    subtitle: '红先落子，四子连线',
    tagline: '把圆片投进蓝色塑框的七列棋格，让它落到最底部空位。横、竖、两条斜线，先连成四子的人获胜。',
    players: '2 人',
    duration: '5–15 分钟',
    mood: '抽象策略 / 重力落子 / 读步',
    rows: 6,
    cols: 7,
    cells: 42,
    discsPerPlayer: 21,
    totalDiscs: 42,
    firstPlayer: 'red',
    levels: [
      { id: 1, key: 'easy', label: '简单', note: '只看一步：能赢就赢，能挡就挡' },
      { id: 2, key: 'normal', label: '普通', note: '四层搜索：会抢中点、造双威胁' },
      { id: 3, key: 'hard', label: '困难', note: '八层迭代加深，400ms 限时' }
    ],
    rules: {
      board: '7 列 × 6 行，共 42 个棋格；竖立棋盘，圆片从顶部投入。',
      gravity: '圆片沿该列下落，停在这列最低的空格里；列满后不能再投这一列。',
      order: '红方先手，双方轮流各投一枚；每方最多 21 枚，合计 42 枚。',
      win: '横、竖、主对角线、副对角线任一方向的连续四枚同色圆片获胜。',
      draw: '42 格全部填满且没有任何一方四连，判平局。',
      stop: '出现四连或棋盘填满后立即结束，不能再落子。'
    },
    dimensions: {
      discDiameterMm: 32,
      discThicknessMm: 4,
      boardWidthMm: 250,
      boardHeightMm: 220,
      boardDepthMm: 30,
      cellPitchMm: 32,
      rows: 6,
      cols: 7
    },
    colors: {
      red: '#d7263d',
      redHi: '#f05a68',
      redLo: '#8f1526',
      yellow: '#f6c445',
      yellowHi: '#ffdf7e',
      yellowLo: '#b8860f',
      frame: '#1f5fbf',
      frameDark: '#123f86',
      frameEdge: '#0b2a5c',
      hole: '#0b1a2e',
      felt: '#122238',
      ink: '#f4f1e8'
    },
    materials: {
      frame: '蓝色 ABS 注塑塑料框，圆孔边缘抛光',
      discs: '红色 / 黄色 ABS 塑料圆片，直径 32mm',
      table: '深蓝羊毛毡桌面'
    },
    aiNames: ['你', '蓝框对手', '副对角线猎手', '中点守门员', '双威胁工匠', '重力研究员'],
    sources: [
      {
        title: '游戏规则-四子棋',
        up: 'Pipity熊猫乐乐',
        bv: 'BV1VH4y127ku',
        url: 'https://www.bilibili.com/video/BV1VH4y127ku',
        duration: '01:31',
        points: ['圆片从顶部投入，落到该列最低空位', '横、竖或斜线连成四子获胜']
      },
      {
        title: '孙老师四子棋规则讲解',
        up: '枫之月下',
        bv: 'BV1ap4y1Q7km',
        url: 'https://www.bilibili.com/video/BV1ap4y1Q7km',
        duration: '03:50',
        points: ['垂直棋盘依赖重力落子，比平面棋更立体', '先把四子连成一线的一方获胜']
      },
      {
        title: '【Superduck 桌游介绍】四子棋 Connect Four',
        up: 'SuperduckH',
        bv: 'BV1sr4y1D7oe',
        url: 'https://www.bilibili.com/video/BV1sr4y1D7oe',
        duration: '03:24',
        points: ['7 列 × 6 行的标准 Connect Four 棋盘', '红黄双方轮流投子，先四连者胜']
      }
    ],
    // Legal in-progress position used by art-render.html: 24 discs (12 red,
    // 12 yellow), red to move, no four connected, every column bottom-filled.
    artPosition: {
      board: [0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 2, 1, 0, 0, 0, 2, 1, 2, 2, 0, 0, 0, 2, 2, 1, 1, 1, 2, 1, 1, 2, 2, 1, 1, 1, 2, 2, 1],
      last: 8,
      turn: 1,
      moveCount: 24
    },
    art: {
      discRed: '../../assets/art/premium/connect4/disc-red.webp',
      discYellow: '../../assets/art/premium/connect4/disc-yellow.webp',
      frame: '../../assets/art/premium/connect4/frame-blue.webp',
      table: '../../assets/art/premium/connect4/table-felt.webp'
    },
    soundLabels: {
      drop: '落子',
      undo: '悔棋',
      newGame: '新局',
      win: '获胜',
      draw: '平局',
      click: '点击'
    }
  };
});
