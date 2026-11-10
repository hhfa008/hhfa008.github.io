/* Dou Dizhu premium — shared static reference data.
 *
 * UMD: browsers read window.DoudizhuPremiumData, Node reads module.exports.
 * Facts only; every rule decision lives in engine.js. The Bilibili links are
 * the tutorials used to cross-check the hand-type table (titles read via the
 * search API, no screenshots or OCR).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DoudizhuPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DECK = {
    total: 54,
    suits: ['♠', '♥', '♣', '♦'],
    ranksPerSuit: 13,
    lowRank: 3,
    highRank: 15,
    rankOrder: ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'],
    jokers: ['小王', '大王'],
    copiesPerRank: 4,
    cardMillimetres: { width: 63, height: 88 },
    paperGsm: 300
  };

  var DEAL = {
    players: 3,
    handSize: 17,
    bottomSize: 3,
    landlordHandSize: 20,
    // 17 × 3 + 3 = 54; the bottom goes to the winning bidder.
    check: 54
  };

  var BIDDING = {
    scores: [1, 2, 3],
    passLabel: '不叫',
    rule: '按顺序叫 1/2/3 分或不叫；只能叫得比当前最高分更高，叫到 3 分立即结束。最高叫分者当地主并拿走 3 张底牌。',
    allPass: '三家都不叫则重新发牌（本实现自动重发，次数记录在 redeals）。'
  };

  var HAND_TYPES = [
    { key: 'single', name: '单张', size: '1', rule: '任意一张牌。', example: '♠9' },
    { key: 'pair', name: '对子', size: '2', rule: '两张点数相同的牌。', example: '♥Q ♣Q' },
    { key: 'triple', name: '三张', size: '3', rule: '三张点数相同的牌。', example: '♠7 ♥7 ♦7' },
    { key: 'triple_single', name: '三带一', size: '4', rule: '三张 + 任意一张单牌。', example: '777 + 4' },
    { key: 'triple_pair', name: '三带二', size: '5', rule: '三张 + 一个对子。', example: '777 + 99' },
    { key: 'straight', name: '顺子', size: '≥5', rule: '五张或更多连续单牌，3 到 A，不能含 2 与王。', example: '3 4 5 6 7' },
    { key: 'straight_pair', name: '连对', size: '≥6', rule: '三对或更多连续对子，3 到 A，不能含 2 与王。', example: '33 44 55' },
    { key: 'plane', name: '飞机', size: '≥6', rule: '两组或更多连续三张，3 到 A，不能含 2 与王。', example: '333 444' },
    { key: 'plane_single', name: '飞机带单', size: '4n', rule: 'n 组连续三张 + n 张单牌（翅膀不能用机身点数）。', example: '333 444 + 5 6' },
    { key: 'plane_pair', name: '飞机带对', size: '5n', rule: 'n 组连续三张 + n 个对子。', example: '333 444 + 55 66' },
    { key: 'four_two_single', name: '四带二', size: '6', rule: '四张 + 两张单牌（两张单牌可以同点）。', example: '8888 + 3 5' },
    { key: 'four_two_pair', name: '四带两对', size: '8', rule: '四张 + 两个不同的对子。', example: '8888 + 33 55' },
    { key: 'bomb', name: '炸弹', size: '4', rule: '四张同点，可压任意普通牌型，也可压更小的炸弹。', example: '♠9 ♥9 ♣9 ♦9' },
    { key: 'rocket', name: '王炸', size: '2', rule: '小王 + 大王，最大牌型，压过一切。', example: '小王 + 大王' }
  ];

  var COMPARE = {
    sameType: '同牌型、同张数才能比较，主牌点数大者胜；3 < 4 < … < K < A < 2 < 小王 < 大王。',
    bombs: '炸弹压任意普通牌型；炸弹之间比点数；王炸最大。',
    freeLead: '两家连续「不要」后，最后出牌的人重新自由出牌。'
  };

  var SCORE = {
    base: 1,
    formula: '得分 = 底分 × 叫分 × 2^(炸弹数 + 王炸数)',
    landlordSettles: '地主一人对两名农民，地主按 2 倍收付，每名农民各按 1 倍收付。',
    example: '底分 1、叫 2 分、出现 1 个炸弹：1 × 2 × 2 = 4 分；地主赢 +8，两个农民各 −4。'
  };

  var TIPS = [
    '叫分看结构不看单张大牌：双王、炸弹、长顺子比零散的大牌更值钱。',
    '农民要配合：队友出牌时尽量让牌，队友只剩一两张时更不要抢。',
    '地主只剩一两张时，宁可拆对子也要用更大的单牌顶住，不能让他顺手走完。',
    '炸弹是翻倍器，也是最后一手保险；领先时不要为了压一手小牌提前交炸。',
    '记牌从 2、A、王开始：这几张决定了残局谁能拿到出牌权。',
    '首出优先走长牌型（顺子、连对、飞机），把散牌留到有牌权时再处理。',
    '手牌只剩两手时，先算清楚「出什么、下一手怎么走完」，再决定要不要接牌。'
  ];

  var MATERIALS = {
    paper: '300gsm 象牙白扑克纸，纸纤维与轻微圆角由材质母版提供',
    back: '深红底 + 金色几何回纹牌背，无文字无 logo',
    felt: '墨绿羊毛台呢，细密短绒',
    chip: '39mm、11.5g 黏土筹码，象牙面配红金边点',
    font: 'Songti SC Bold(700) 渲染中文与牌面字符',
    lighting: '左上大柔光箱主光 + 右侧补光'
  };

  var SOURCES = {
    bilibili: [
      'https://www.bilibili.com/video/BV1o8wYeEE8E',
      'https://www.bilibili.com/video/BV1ka411t7Yh',
      'https://www.bilibili.com/video/BV1MBTV6gE5T'
    ],
    bilibiliTitles: [
      '2026年了还不会玩斗地主？9分钟学会斗地主基础规则',
      '斗地主扑克游戏规则讲解，斗地主怎么玩，斗地主规则新手入门知识',
      '斗地主规则讲解'
    ],
    rules: '斗地主通行规则；牌型表、叫分与结算公式以 B 站公开教程标题与既有 games/doudizhu/rules.html 交叉核对（只读标题，不截图、不做 OCR）'
  };

  return {
    DECK: DECK,
    DEAL: DEAL,
    BIDDING: BIDDING,
    HAND_TYPES: HAND_TYPES,
    COMPARE: COMPARE,
    SCORE: SCORE,
    TIPS: TIPS,
    MATERIALS: MATERIALS,
    SOURCES: SOURCES
  };
});
