/* International Draughts premium — copy, palette, rules and sources. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DraughtsData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    slug: 'draughts-premium',
    name: { zh: '国际跳棋', en: 'International Draughts' },
    title: '国际跳棋 · 十路飞王',
    subtitle: '10×10 · 每方 20 子 · 必吃与最大吃子',
    players: '2 人 · 人机 / 同屏 / 联机',
    playTime: '15–45 分钟',
    age: '7+',
    palette: {
      table: '#141a16', walnut: '#3a2718', maple: '#d6b483',
      ivory: '#f2e7d2', gold: '#d8b26a', darkPiece: '#4a2f1b', lightPiece: '#e2c79b', ink: '#221a13'
    },
    difficulty: [
      { id: 1, zh: '入门', en: 'Easy', note: '一步搜索，优先最大吃子。' },
      { id: 2, zh: '进阶', en: 'Club', note: '两步搜索，计算交换与升王。' },
      { id: 3, zh: '高手', en: 'Strong', note: '四步迭代加深，重视王棋与推进。' }
    ],
    modes: [
      { id: 'ai', zh: '人机对战', en: 'vs AI' },
      { id: 'local', zh: '同屏双人', en: 'Two players' }
    ],
    rules: [
      '10×10 棋盘，只走深色格，共 50 个可走格。每方 20 枚兵，白方先行，白方在下。',
      '兵只能向前斜走一格；但吃子可以向四个斜方向跳，跳过相邻敌子落到其后的空格。',
      '吃子是强制的；若有多种吃法，必须选择吃掉最多棋子的路线（最大吃子规则）。',
      '兵到达对方底线升为王；若在连吃途中经过底线仍能继续吃，则不升王，必须继续以兵吃子。',
      '王可以沿斜线任意距离移动；吃子时沿斜线跳过任意距离外的一枚敌子，并落在其后的任意空格。',
      '被吃掉的棋子在全过程中仍占位，不能重复跳过，也不能落在其上；整步结束后才移除。',
      '无合法着法的一方判负；连续 25 回合双方只走王且无吃子判和；同一局面三次判和。'
    ],
    faq: [
      { q: '国际跳棋是 8×8 还是 10×10？', a: '本作采用国际跳棋（International Draughts）标准 10×10 棋盘，每方 20 枚，只走深色格。' },
      { q: '吃子可以不选最多的路线吗？', a: '不可以。国际跳棋采用最大吃子规则，必须选择吃掉棋子最多的路线；数量相同才可任选。' },
      { q: '兵在连吃途中经过底线会升王吗？', a: '不会。只有在连吃结束并停在底线时才升王；若还能继续吃，必须继续以兵的身份吃。' },
      { q: '王怎么吃子？', a: '王沿斜线跳过任意距离外的一枚敌子，并落在敌子之后、下一个棋子之前的任意空格。' },
      { q: '什么情况下判和？', a: '连续 25 回合双方只走王且没有吃子，或同一局面出现三次，判和。' }
    ],
    sources: [
      { platform: 'bilibili', id: 'BV1j7411B7DZ', title: '国际跳棋基本规则介绍', author: '乐棋俱乐部之资深菜鸟' },
      { platform: 'bilibili', id: 'BV17w411574w', title: '国际跳棋怎么玩，国际跳棋玩法规则', author: '一个平静的老实人' },
      { platform: 'bilibili', id: 'BV17m421L7fy', title: '【国跳入门教程】#1 认识国际跳棋', author: '国跳子羊' }
    ],
    art: {
      table: '../../assets/art/premium/shared/table-felt.webp',
      boardDark: '../../assets/art/premium/draughts/board-walnut.webp',
      boardLight: '../../assets/art/premium/xiangqi/board-wood.webp',
      manDark: '../../assets/art/premium/draughts/man-dark.webp',
      manLight: '../../assets/art/premium/draughts/man-light.webp',
      cover: 'assets/cover.webp',
      og: 'assets/og.webp',
      detail1: 'assets/detail-1.webp',
      detail2: 'assets/detail-2.webp'
    }
  };
});
