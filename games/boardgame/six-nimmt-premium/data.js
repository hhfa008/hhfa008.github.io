/* 6 Nimmt! / 谁是牛头王 premium — presentation data, copy and Bilibili sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SixNimmtPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'six-nimmt-premium',
    title: '6 Nimmt! 谁是牛头王',
    subtitle: '四行牌列，六张就爆',
    players: '2–10 人',
    duration: '20–30 分钟',
    mood: '聚会 / 同时出牌 / 牛头狂欢',
    tagline: '所有人同时暗出一张牌，按数字从小到大接龙。谁把一行撑到第六张，谁就吃下整行牛头。',
    rounds: 10,
    handSize: 10,
    rows: 4,
    bullRule: '55 是 7 分；11 的倍数是 5 分；10 的倍数是 3 分；5 的倍数是 2 分；其余 1 分。',
    sources: [
      {
        title: '谁是牛头王｜规则讲解+试玩演示',
        up: '零门槛桌游',
        bv: 'BV1neA2z4ENU',
        url: 'https://www.bilibili.com/video/BV1neA2z4ENU',
        points: ['每人 10 张手牌，四行起始牌', '同时暗出，按数字从小到大结算', '第六张撑爆整行，吃牛头分']
      },
      {
        title: '牛头王规则',
        up: '桌游鼠王',
        bv: 'BV1BfchzTEjB',
        url: 'https://www.bilibili.com/video/BV1BfchzTEjB',
        points: ['接在行尾小于它且最接近的一行', '小于所有行尾时自己选一行吃掉', '十轮后牛头分最低者获胜']
      },
      {
        title: '谁是牛头王，规则教学，6 nimmt',
        up: '桌游怎么玩',
        bv: 'BV1q7411s732',
        url: 'https://www.bilibili.com/video/BV1q7411s732',
        points: ['55 号牌值 7 个牛头', '5 / 10 / 11 的倍数分级别加分', '同时出牌让读牌与心理博弈更重要']
      }
    ],
    aiNames: ['你', '牛头猎手', '接龙赌徒', '黄铜守望者', '牧场主', '夜行牛仔', '绿呢术士', '计数员', '红丝绒客', '最后的牛仔'],
    seats: [
      { avatar: 'Ⅰ', tone: 'coral' },
      { avatar: 'Ⅱ', tone: 'mint' },
      { avatar: 'Ⅲ', tone: 'gold' },
      { avatar: 'Ⅳ', tone: 'violet' },
      { avatar: 'Ⅴ', tone: 'sky' },
      { avatar: 'Ⅵ', tone: 'rose' },
      { avatar: 'Ⅶ', tone: 'lime' },
      { avatar: 'Ⅷ', tone: 'amber' },
      { avatar: 'Ⅸ', tone: 'teal' },
      { avatar: 'Ⅹ', tone: 'plum' }
    ],
    soundLabels: {
      deal: '发牌',
      pick: '暗出',
      reveal: '翻牌',
      take: '吃行',
      round: '轮次',
      win: '结算'
    }
  };
});
