/* Backgammon / 双陆棋 premium — presentation data, copy and researched sources. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BackgammonPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  return {
    slug: 'backgammon-premium',
    title: '双陆棋 Backgammon',
    subtitle: '掷骰、过 bar、全部离盘',
    players: '2 人',
    duration: '15–30 分钟',
    mood: '经典 / 竞速 / 倍数博弈',
    tagline: '两枚骰子，十五枚棋子，二十四点。把对方挡在外面，把自己的十五枚全部带回 home board 离盘。',
    openingPip: 167,
    points: 24,
    checkersPerSide: 15,
    sources: [
      {
        title: '双陆棋，原来我也是另一种棋，规则教学，Backgammon',
        up: '桌游怎么玩',
        bv: 'BV1BL4y1z7SB',
        url: 'https://www.bilibili.com/video/BV1BL4y1z7SB',
        fact: '标题与简介确认为双陆棋（Backgammon）规则教学视频；用作规则教学来源。'
      },
      {
        title: '怎么玩双陆棋？一盘双陆棋实战教会你！',
        up: '瑞成男中音',
        bv: 'BV14D4y197By',
        url: 'https://www.bilibili.com/video/BV14D4y197By',
        fact: '页面评论区文字说明倍数方块：掷骰前要求加倍，对方接受或认输；接受后本局赌注翻倍，全胜（gammon）再翻倍（2 分变 4 分）。'
      },
      {
        title: '【中文】新手教程：如何玩西洋双陆棋',
        up: 'SebunTsuki',
        bv: 'BV1cU516ME9k',
        url: 'https://www.bilibili.com/video/BV1cU516ME9k',
        fact: '简介确认为中文新手教程，原视频为 Beginner Tutorial: How To Play Backgammon（2019-01-22）。'
      }
    ],
    aiNames: ['你', '黑檀对手'],
    levels: [
      { id: 'easy', label: '轻松' },
      { id: 'normal', label: '标准' },
      { id: 'hard', label: '困难' }
    ],
    facts: [
      '24 个点分 4 个象限，每象限 6 点。',
      '双方各 15 枚，共 30 枚；开局 pip 167 对 167。',
      '对子走四步；两枚骰子都能走时必须都走。',
      'bar 上有子时，必须先按骰点进场。',
      '离盘必须 15 枚全在 home board，且 bar 为空。',
      '倍数方块 1 → 2 → 4 …，上限 64。'
    ],
    cubeValues: [1, 2, 4, 8, 16, 32, 64],
    colors: {
      felt: '#173226',
      walnut: '#4a2c1a',
      maple: '#d8b57e',
      ivory: '#f4ead2',
      ebony: '#231611',
      brass: '#c99a4e',
      crimson: '#ad3f2d'
    }
  };
});
