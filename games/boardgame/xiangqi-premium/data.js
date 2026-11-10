/* Xiangqi Premium — copy, palette, rules and source notes.
   Browser global: XiangqiData. CommonJS: module.exports. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XiangqiData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    slug: 'xiangqi-premium',
    name: { zh: '中国象棋', en: 'Xiangqi' },
    title: '中国象棋 · 楚河汉界',
    subtitle: '九路十行 · 三十二子 · 完整规则与三档 AI',
    players: '2 人 · 人机 / 同屏 / 联机',
    playTime: '10–40 分钟',
    age: '6+',
    palette: {
      table: '#1a100b', walnut: '#2d1d13', board: '#c99a5f',
      ivory: '#f4e7cf', gold: '#d8b26a', red: '#a5241b', ink: '#221a14'
    },
    difficulty: [
      { id: 1, zh: '入门', en: 'Easy', note: '一步搜索，适合熟悉走子。' },
      { id: 2, zh: '进阶', en: 'Club', note: '两步搜索，会吃子与保护。' },
      { id: 3, zh: '高手', en: 'Strong', note: '三步搜索，重视子力与将军。' }
    ],
    modes: [
      { id: 'ai', zh: '人机对战', en: 'vs AI' },
      { id: 'local', zh: '同屏双人', en: 'Two players' }
    ],
    rules: [
      '棋盘九路十行，中间是楚河汉界。红方在下，黑方在上，红先。',
      '帅/将只能在九宫内走一步；士/仕在九宫内斜走一步；相/象走田字，不能过河，象眼被占则不能走。',
      '马走日字，蹩马腿时不能走；车走直线；炮走直线，吃子时必须隔一个炮架。',
      '兵/卒向前一步，过河后可以左右一步，不能后退。',
      '将帅不能照面：同一路且中间无子时，先走的一方不能留下照面局面。',
      '将死或困毙对手即胜；连续 60 回合无吃子判和；同一局面出现三次判和。'
    ],
    faq: [
      { q: '中国象棋红方先走还是黑方先走？', a: '红方先走。棋盘下侧为红方，上侧为黑方。' },
      { q: '什么是蹩马腿？', a: '马向某个方向走日字时，紧邻该方向的第一格如果有棋子，这一步就被挡住，称为蹩马腿。' },
      { q: '炮怎么吃子？', a: '炮沿直线移动；吃子时，炮与目标之间必须恰好隔着一个棋子（炮架），不能多也不能少。' },
      { q: '将帅可以照面吗？', a: '不可以。将帅在同一路且中间无子时，轮走的一方不能走成或留下照面局面。' },
      { q: '什么情况下判和？', a: '连续 60 回合（120 个半回合）没有吃子，或同一局面出现三次，判和。' }
    ],
    sources: [
      { platform: 'bilibili', id: 'BV1PN4zzqErY', title: '象棋入门 如何走子以及记录方法 零基础学象棋第一集', author: '板鸭象棋' },
      { platform: 'bilibili', id: 'BV1hiMdzyE7N', title: '中国象棋规则', author: '馬緻逺仝學' },
      { platform: 'bilibili', id: 'BV1da411S7Vf', title: '【中国象棋】零基础学棋 入门篇（全集）', author: '象棋研究者' }
    ],
    art: {
      table: '../../assets/art/premium/xiangqi/table-walnut.webp',
      board: '../../assets/art/premium/xiangqi/board-wood.webp',
      piece: '../../assets/art/premium/xiangqi/piece-wood.webp',
      cover: 'assets/cover.webp',
      og: 'assets/og.webp',
      detail1: 'assets/detail-1.webp',
      detail2: 'assets/detail-2.webp'
    }
  };
});
