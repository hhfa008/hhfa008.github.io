/* Chinese Checkers premium — copy, palette, rules and sources. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CheckersJumpData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return {
    slug: 'checkers-jump-premium',
    name: { zh: '中国跳棋', en: 'Chinese Checkers' },
    title: '中国跳棋 · 星阵连跳',
    subtitle: '121 孔星形棋盘 · 单步与连跳 · 2 / 4 / 6 人',
    players: '2 / 4 / 6 人 · 人机 / 同屏 / 联机',
    playTime: '10–30 分钟',
    age: '6+',
    palette: {
      table: '#141a18', birch: '#d8b77f', hole: '#4a3520',
      ivory: '#f2e7d2', gold: '#d8b26a', ink: '#221a13'
    },
    players6: [
      { id: 0, zh: '朱红', en: 'Crimson', color: '#c0392b', light: '#ef7b64' },
      { id: 1, zh: '靛蓝', en: 'Indigo', color: '#2f6fb0', light: '#7fb2e0' },
      { id: 2, zh: '松绿', en: 'Pine', color: '#3f8f5f', light: '#8fd0a6' },
      { id: 3, zh: '琥珀', en: 'Amber', color: '#c9922e', light: '#f0cf82' },
      { id: 4, zh: '紫晶', en: 'Amethyst', color: '#7a4fa0', light: '#bf9ada' },
      { id: 5, zh: '橘橙', en: 'Tangerine', color: '#c96b2c', light: '#f0ad7e' }
    ],
    difficulty: [
      { id: 1, zh: '入门', en: 'Easy', note: '贪心前进，优先连跳。' },
      { id: 2, zh: '进阶', en: 'Club', note: '预判一步，兼顾远端落点。' },
      { id: 3, zh: '高手', en: 'Strong', note: '预判两步，计算对家威胁。' }
    ],
    modes: [
      { id: 'ai', zh: '人机对战', en: 'vs AI' },
      { id: 'local', zh: '同屏多人', en: 'Hot seat' }
    ],
    rules: [
      '星形棋盘共 121 个孔位，六个三角区各 10 孔。2 人局在相对的两个三角区，4 人局用四个角区，6 人局六个角区全用。',
      '每回合移动一枚自己的棋子：走到相邻空孔（单步），或跳过相邻的一枚棋子落到其后的空孔（跳）。',
      '跳跃不吃掉被跳过的棋子；可以连续跳，方向可以改变，每跳一次都要落到空孔；连跳中途可以停下。',
      '单步与跳跃不能混在同一回合；一次只能移动一枚棋子。',
      '最先把自己全部 10 枚棋子送进对面三角区（目标区）的玩家获胜。',
      '2 人局红方（0 区）对蓝方（3 区）；4 人局 0↔3、1↔4；6 人局 0↔3、1↔4、2↔5。',
      '本作不设吃子与和棋；可随时认输。联机对局由服务端判定，超时座位自动托管。'
    ],
    faq: [
      { q: '中国跳棋可以连跳吗？', a: '可以。一次跳跃后如果还能继续跳过相邻棋子落到空孔，就可以继续跳，方向也可以改变；中途可以停下。' },
      { q: '跳跃会吃掉被跳过的棋子吗？', a: '不会。中国跳棋的跳跃不吃子，被跳过的棋子留在原位，双方都可以借它起跳。' },
      { q: '几个人可以玩？', a: '本作支持 2、4、6 人。2 人各占相对角区；4 人使用四个角区；6 人六个角区全用。' },
      { q: '怎样才算赢？', a: '最先把自己 10 枚棋子全部送进对面目标三角区的玩家获胜。' },
      { q: '单步和跳跃能混用吗？', a: '不能。一个回合只能选择单步，或选择一次（可连跳的）跳跃路线。' }
    ],
    sources: [
      { platform: 'bilibili', id: 'BV1Ti4y1y7Yr', title: '多合一游戏棋之中国跳棋玩法和规则讲解', author: '游戏玩具合集q' },
      { platform: 'bilibili', id: 'BV1hA7hzYEZt', title: '中国跳棋基础规则讲解演示', author: '益趣汇桌游' }
    ],
    art: {
      table: '../../assets/art/premium/shared/table-felt.webp',
      board: '../../assets/art/premium/checkers-jump/board-birch.webp',
      marble: '../../assets/art/premium/checkers-jump/marble-glass.webp',
      cover: 'assets/cover.webp',
      og: 'assets/og.webp',
      detail1: 'assets/detail-1.webp',
      detail2: 'assets/detail-2.webp'
    }
  };
});
