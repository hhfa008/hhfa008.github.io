/*
 * Coup（政变）Premium 数据 — UMD
 *
 * 基础版 15 张身份牌：公爵、刺客、队长、大使、女伯爵各 3 张。
 * 每名玩家 2 张身份牌、2 枚金币；3–6 人局。
 * 这份数据同时供页面、引擎和静态测试读取，避免三处各写一套名字。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CoupData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROLES = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];

  var ROLE_NAMES = {
    duke: '公爵',
    assassin: '刺客',
    captain: '队长',
    ambassador: '大使',
    contessa: '女伯爵'
  };

  var ROLE_NAMES_EN = {
    duke: 'Duke',
    assassin: 'Assassin',
    captain: 'Captain',
    ambassador: 'Ambassador',
    contessa: 'Contessa'
  };

  var ROLE_TEXT = {
    duke: '征税：从银行拿 3 枚金币。也可阻挡外援。',
    assassin: '暗杀：支付 3 枚金币，目标失去 1 张身份牌。',
    captain: '偷取：从目标处拿走最多 2 枚金币。也可阻挡偷取。',
    ambassador: '交换：抽 2 张牌，从 4 张中保留 2 张。也可阻挡偷取。',
    contessa: '女伯爵：可阻挡暗杀。'
  };

  var ROLE_META = {
    duke: { icon: 'crown', color: '#c9a45d', sigil: '♛' },
    assassin: { icon: 'dagger', color: '#a64b45', sigil: '†' },
    captain: { icon: 'anchor', color: '#5b7f9c', sigil: '⚓' },
    ambassador: { icon: 'scroll', color: '#7d6a9b', sigil: '✦' },
    contessa: { icon: 'rose', color: '#b56f7d', sigil: '❧' }
  };

  var ACTION_NAMES = {
    income: '收入',
    foreign_aid: '外援',
    coup: '政变',
    tax: '征税',
    assassinate: '暗杀',
    steal: '偷取',
    exchange: '交换'
  };

  var ACTION_META = {
    income: { cost: 0, target: false, claim: null, desc: '从银行拿 1 枚金币，不可被挑战或阻挡。' },
    foreign_aid: { cost: 0, target: false, claim: null, desc: '从银行拿 2 枚金币；可被公爵阻挡。' },
    coup: { cost: 7, target: true, claim: null, desc: '支付 7 枚金币，目标失去 1 张身份牌；不可被挑战或阻挡。' },
    tax: { cost: 0, target: false, claim: 'duke', desc: '宣称公爵，拿 3 枚金币；可被挑战。' },
    assassinate: { cost: 3, target: true, claim: 'assassin', desc: '支付 3 枚金币，目标失去 1 张身份牌；可被挑战，可被女伯爵阻挡。' },
    steal: { cost: 0, target: true, claim: 'captain', desc: '宣称队长，从目标处拿最多 2 枚金币；可被挑战或阻挡。' },
    exchange: { cost: 0, target: false, claim: 'ambassador', desc: '宣称大使，抽 2 张牌后保留 2 张；可被挑战。' }
  };

  var CLAIM_BY_ACTION = {
    tax: 'duke',
    assassinate: 'assassin',
    steal: 'captain',
    exchange: 'ambassador'
  };

  var BLOCK_BY_ACTION = {
    foreign_aid: ['duke'],
    assassinate: ['contessa'],
    steal: ['captain', 'ambassador']
  };

  var AI_NAMES = ['你', '红衣主教', '黑曜公爵', '银币队长', '玫瑰女伯爵', '无名使节'];

  var PLAYER_COUNTS = [3, 4, 5, 6];

  return Object.freeze({
    ROLES: Object.freeze(ROLES.slice()),
    ROLE_NAMES: Object.freeze(ROLE_NAMES),
    ROLE_NAMES_EN: Object.freeze(ROLE_NAMES_EN),
    ROLE_TEXT: Object.freeze(ROLE_TEXT),
    ROLE_META: Object.freeze(ROLE_META),
    ACTION_NAMES: Object.freeze(ACTION_NAMES),
    ACTION_META: Object.freeze(ACTION_META),
    CLAIM_BY_ACTION: Object.freeze(CLAIM_BY_ACTION),
    BLOCK_BY_ACTION: Object.freeze(BLOCK_BY_ACTION),
    AI_NAMES: Object.freeze(AI_NAMES),
    PLAYER_COUNTS: Object.freeze(PLAYER_COUNTS),
    COPIES_PER_ROLE: 3,
    START_COINS: 2,
    INFLUENCE_PER_PLAYER: 2,
    COUP_COST: 7,
    ASSASSINATE_COST: 3
  });
});
