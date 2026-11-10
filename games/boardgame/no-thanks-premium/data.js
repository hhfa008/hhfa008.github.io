/* No Thanks! premium — presentation data, copy and Bilibili sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NoThanksPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'no-thanks-premium',
    title: 'No Thanks! 不谢',
    subtitle: '一枚筹码，换一次说不的机会',
    players: '3–5 人',
    duration: '15–20 分钟',
    mood: '毛线 / 心机 / 轻快',
    tagline: '低分者胜。收下牌，还是花钱把麻烦推给下家？',
    sources: [
      {
        title: '【勃根地桌遊】禮物 No Thanks 桌遊教學影片',
        up: '南风丶小草',
        bv: 'BV1v7411A7T3',
        url: 'https://www.bilibili.com/video/BV1v7411A7T3',
        points: ['起手 11 枚筹码', '收牌连同牌面筹码一起拿走', '连续数字只算最小的一张']
      },
      {
        title: '【Superduck 桌游介绍】No thanks 不速之礼',
        up: 'SuperduckH',
        bv: 'BV1YP4y1b7tG',
        url: 'https://www.bilibili.com/video/BV1YP4y1b7tG',
        points: ['33 张数字牌先移除 9 张', '没有筹码时必须收牌', '24 张牌被拿完后结算']
      },
      {
        title: '桌游介绍第一期：No thanks不谢牌讲解及玩法展示！',
        up: 'CPG_Knight',
        bv: 'BV19M4y1r7RB',
        url: 'https://www.bilibili.com/video/BV19M4y1r7RB',
        points: ['跳过需支付 1 枚筹码', '筹码可抵消终局分数', '低分玩家获胜']
      }
    ],
    aiNames: ['你', '不谢达人', '筹码守财奴', '薄荷商人', '迟到的骑士'],
    seats: [
      { avatar: '✦', tone: 'coral' },
      { avatar: '♠', tone: 'mint' },
      { avatar: '◆', tone: 'gold' },
      { avatar: '♣', tone: 'violet' },
      { avatar: '●', tone: 'sky' }
    ],
    soundLabels: {
      deal: '发牌',
      chip: '筹码',
      pass: '跳过',
      take: '收牌',
      win: '结算'
    }
  };
});
