/* Chess premium — presentation data, FIDE reference facts and sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'chess-premium',
    title: '国际象棋 · Chess',
    subtitle: '枫木与胡桃木的 64 格战场',
    players: '2 人',
    duration: '10–60 分钟',
    mood: '经典 / 策略 / 深度计算',
    tagline: 'FIDE 完整规则：王车易位、吃过路兵、兵升变、三次重复、五十回合与子力不足。三档 AI，服务端权威联机。',
    board: {
      light: '#e8d3a9',
      dark: '#6b4a2f',
      frame: '#4a2f1c',
      files: 'abcdefgh',
      ranks: '12345678'
    },
    levels: [
      { id: 1, key: 'easy', name: '入门', depth: 2, timeMs: 120, blurb: '看两步，适合第一次下棋。' },
      { id: 2, key: 'normal', name: '进阶', depth: 3, timeMs: 260, blurb: '三层搜索，会抓明显的战术。' },
      { id: 3, key: 'hard', name: '高手', depth: 5, timeMs: 380, blurb: '迭代加深，兼顾子力、位置与王的安全。' }
    ],
    pieces: [
      { code: 'K', zh: '王', en: 'King', value: 0, heightMm: 95, baseMm: 35 },
      { code: 'Q', zh: '后', en: 'Queen', value: 9, heightMm: 82, baseMm: 34 },
      { code: 'R', zh: '车', en: 'Rook', value: 5, heightMm: 55, baseMm: 33 },
      { code: 'B', zh: '象', en: 'Bishop', value: 3, heightMm: 70, baseMm: 32 },
      { code: 'N', zh: '马', en: 'Knight', value: 3, heightMm: 62, baseMm: 32 },
      { code: 'P', zh: '兵', en: 'Pawn', value: 1, heightMm: 45, baseMm: 30 }
    ],
    dimensions: {
      squareMm: 57,
      kingHeightMm: 95,
      queenHeightMm: 82,
      bishopHeightMm: 70,
      knightHeightMm: 62,
      rookHeightMm: 55,
      pawnHeightMm: 45,
      baseDiameterMm: [30, 35],
      boardSquares: 64,
      pieces: 32
    },
    colors: {
      lightSquare: '#e8d3a9',
      darkSquare: '#6b4a2f',
      maple: '#e8cfa4',
      walnut: '#4a2f1c',
      feltGreen: '#2f5a43',
      ivoryHighlight: '#f6e7c8'
    },
    materials: {
      whitePieces: '浅色枫木 maple，暖象牙色，细直木纹',
      blackPieces: '深色胡桃木 walnut，巧克力棕，波浪木纹',
      board: '浅枫木 / 深胡桃木格，57 mm 比赛格',
      table: '墨绿羊毛桌布，细密绒面',
      frame: '胡桃木边框，倒角与浅槽'
    },
    aiNames: ['你', '枫木棋手', '胡桃棋手', '残局匠', '开局书', '巡场裁判', '深算者', '铜钟守夜人'],
    sounds: { move: '落子', capture: '吃子', check: '将军', castle: '易位', win: '胜利', illegal: '非法' },
    sources: [
      {
        title: '11分钟零基础完整学会国际象棋！',
        up: '子聪学长',
        bv: 'BV1PuokBiEb6',
        url: 'https://www.bilibili.com/video/BV1PuokBiEb6',
        fact: '视频章节明确列出：将军、应将、将死、逼和，以及特殊走法升变、吃过路兵、王车易位。'
      },
      {
        title: '国际象棋吃过路兵【国际象棋基础】',
        up: '国际象棋IM杨海南',
        bv: 'BV1uA4y1Q7uQ',
        url: 'https://www.bilibili.com/video/BV1uA4y1Q7uQ',
        fact: '吃过路兵只在兵从初始格一次走两格、恰好越过相邻敌兵的可吃格时成立，且必须立即走。'
      },
      {
        title: '国际象棋王车易位【国际象棋基础】',
        up: '国际象棋IM杨海南',
        bv: 'BV1HS4y1w7Ey',
        url: 'https://www.bilibili.com/video/BV1HS4y1w7Ey',
        fact: '王车易位要求王与车都未移动、之间无子、王不在被将状态，且王经过与落点格都不能被攻击。'
      }
    ]
  };
});
