/*
 * Reversi premium — shared presentation data.
 *
 * UMD: browser globalThis.ReversiData / Node require('./data.js').
 * No rules live here; engine.js is the single rules source.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReversiData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ASSETS = {
    discBlack: '../../assets/art/premium/reversi/disc-black.webp',
    discWhite: '../../assets/art/premium/reversi/disc-white.webp',
    tableFelt: '../../assets/art/premium/reversi/table-felt.webp',
    tableWood: '../../assets/art/premium/reversi/table-wood.webp',
    cover: '../../assets/art/premium/reversi/cover.webp',
    og: '../../assets/art/premium/reversi/og.webp',
    detail: '../../assets/art/premium/reversi/detail.webp'
  };

  var AI_NAMES = ['AI · 黑石', 'AI · 白磐'];
  var PLAYER_NAMES = ['黑方', '白方'];
  var COLORS = { black: '#15181b', white: '#f4efe4', felt: '#2f6046', brass: '#d8b26c' };

  var DIFFICULTIES = [
    { key: 'easy', label: '简单', sub: '随机 + 吃子偏好' },
    { key: 'normal', label: '普通', sub: '两层搜索 + 位置权重' },
    { key: 'hard', label: '困难', sub: '四层剪枝 + 行动力' }
  ];

  var RULES_SUMMARY = [
    '黑棋先行；每次落子必须在横、竖或斜线上夹住至少一枚白棋。',
    '被夹住的棋子全部翻成己方颜色；八个方向同时结算。',
    '没有合法落点时跳过；双方都没有合法落点时终局。',
    '终局棋子多者胜，数量相同为平局。四角最稳，角旁 X 位最危险。'
  ];

  var OPENING_TIPS = [
    '先抢四角，再经营边线；角一旦占住就不会再被翻。',
    '少给对手行动力，比一时多吃几子更重要。',
    '中盘不要过早铺满内圈，保留可翻转的“桥”。',
    '进入终局前数清空位，避免把最后一步让给对手。'
  ];

  var SOURCES = [
    { bvid: 'BV1CuxQ6EExW', title: '《黑白棋》规则', author: 'HullQin', use: '基本落子、夹击与翻面规则' },
    { bvid: 'BV1Bs4y1c7Y9', title: '黑白棋进阶课 1 开局的下法', author: '康康老师的黑白棋课堂', use: '开局与角位策略' },
    { bvid: 'BV1UC411L7vj', title: '【拉老师】黑白棋必胜法', author: '八神太萌', use: '行动力与终局思路' },
    { bvid: 'BV1Hjz9BUEAY', title: '黑白棋基础：消除手数', author: '八神太萌', use: '限制对手行动力' }
  ];

  var RECORD_KEY = 'reversi-premium-record-v1';
  var THEME_KEY = 'reversi-premium-theme';
  var SOUND_KEY = 'reversi-premium-muted';

  return {
    ASSETS: ASSETS,
    AI_NAMES: AI_NAMES,
    PLAYER_NAMES: PLAYER_NAMES,
    COLORS: COLORS,
    DIFFICULTIES: DIFFICULTIES,
    RULES_SUMMARY: RULES_SUMMARY,
    OPENING_TIPS: OPENING_TIPS,
    SOURCES: SOURCES,
    RECORD_KEY: RECORD_KEY,
    THEME_KEY: THEME_KEY,
    SOUND_KEY: SOUND_KEY
  };
});
