/*
 * Hero Realms（英雄领域）简化版 — 卡牌数据（UMD）。
 *
 * 浏览器：<script src="data.js"></script> → window.HeroRealmsData
 * Node：  var DATA = require('./data.js')
 *
 * 卡牌字段：
 *   id        唯一 id
 *   name      中文名
 *   type      gold | gem | weapon | spell | champion
 *   cost      市场购买价（金币）
 *   starting  true 表示属于起始牌组，不进入市场
 *   effects   打出时立即结算：gold / damage / heal / draw / armor
 *   defense   冠军防御力（仅 champion）
 *   ability   冠军每回合可激活一次的能力：{ type, amount }
 *   text      规则页/卡面文案
 *   gradient  卡面 CSS 渐变（两个颜色，无图片）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeroRealmsData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STARTING_DECK = [
    { id: 'gold', count: 7 },
    { id: 'dagger', count: 3 }
  ];

  var CARDS = [
    /* ---------- 起始牌 ---------- */
    {
      id: 'gold', name: '金币', type: 'gold', cost: 0, starting: true,
      effects: { gold: 1 }, text: '+1 金币',
      gradient: ['#f6d365', '#a9791c'], accent: '#ffe9a8'
    },
    {
      id: 'dagger', name: '匕首', type: 'weapon', cost: 0, starting: true,
      effects: { damage: 1 }, text: '造成 1 点伤害',
      gradient: ['#b8c2d0', '#475364'], accent: '#e6edf7'
    },

    /* ---------- 宝石 / 经济 ---------- */
    {
      id: 'silver', name: '银币', type: 'gem', cost: 2,
      effects: { gold: 2 }, text: '+2 金币',
      gradient: ['#e2e8ef', '#7b8796'], accent: '#ffffff'
    },
    {
      id: 'sapphire', name: '蓝宝石', type: 'gem', cost: 3,
      effects: { gold: 2, draw: 1 }, text: '+2 金币，抽 1 张牌',
      gradient: ['#6fb6ff', '#1f4e92'], accent: '#cfe6ff'
    },
    {
      id: 'ruby', name: '红宝石', type: 'gem', cost: 3,
      effects: { gold: 2, damage: 1 }, text: '+2 金币，造成 1 点伤害',
      gradient: ['#ff8a8a', '#8e1f2f'], accent: '#ffd6d6'
    },
    {
      id: 'emerald', name: '翡翠', type: 'gem', cost: 4,
      effects: { gold: 3 }, text: '+3 金币',
      gradient: ['#7ee2a8', '#1f6b45'], accent: '#d6ffe7'
    },
    {
      id: 'diamond', name: '钻石', type: 'gem', cost: 6,
      effects: { gold: 4, draw: 1 }, text: '+4 金币，抽 1 张牌',
      gradient: ['#d8f6ff', '#5a8fb0'], accent: '#ffffff'
    },

    /* ---------- 武器 ---------- */
    {
      id: 'short-sword', name: '短剑', type: 'weapon', cost: 2,
      effects: { damage: 2 }, text: '造成 2 点伤害',
      gradient: ['#c3ccd8', '#4c5a6c'], accent: '#eef3fa'
    },
    {
      id: 'twin-daggers', name: '双匕首', type: 'weapon', cost: 3,
      effects: { damage: 2, draw: 1 }, text: '造成 2 点伤害，抽 1 张牌',
      gradient: ['#a9b6c7', '#3d4857'], accent: '#e3ebf5'
    },
    {
      id: 'longbow', name: '长弓', type: 'weapon', cost: 3,
      effects: { damage: 3 }, text: '造成 3 点伤害',
      gradient: ['#c9a06a', '#5b3d1f'], accent: '#ffe2b8'
    },
    {
      id: 'war-axe', name: '战斧', type: 'weapon', cost: 4,
      effects: { damage: 4 }, text: '造成 4 点伤害',
      gradient: ['#d1a0a0', '#6b2c2c'], accent: '#ffd9d9'
    },
    {
      id: 'assassin-blade', name: '刺客之刃', type: 'weapon', cost: 4,
      effects: { damage: 3, draw: 1 }, text: '造成 3 点伤害，抽 1 张牌',
      gradient: ['#8f9bb3', '#2a3244'], accent: '#dbe3f7'
    },
    {
      id: 'flame-lance', name: '烈焰长枪', type: 'weapon', cost: 5,
      effects: { damage: 5 }, text: '造成 5 点伤害',
      gradient: ['#ffb36b', '#a3301f'], accent: '#ffe0c2'
    },

    /* ---------- 法术 ---------- */
    {
      id: 'heal-prayer', name: '治疗祷言', type: 'spell', cost: 2,
      effects: { heal: 4 }, text: '恢复 4 点生命',
      gradient: ['#a8e6c1', '#2d6b4a'], accent: '#e0ffec'
    },
    {
      id: 'shield-wall', name: '盾墙', type: 'spell', cost: 2,
      effects: { armor: 4 }, text: '获得 4 点护甲',
      gradient: ['#a9c5e8', '#3a5f8f'], accent: '#e0efff'
    },
    {
      id: 'divine-light', name: '圣光', type: 'spell', cost: 3,
      effects: { heal: 5, armor: 2 }, text: '恢复 5 点生命，获得 2 点护甲',
      gradient: ['#ffe9a3', '#b07a1d'], accent: '#fff7d6'
    },
    {
      id: 'arcane-study', name: '奥术研习', type: 'spell', cost: 3,
      effects: { draw: 2, gold: 1 }, text: '抽 2 张牌，+1 金币',
      gradient: ['#c3a6ff', '#4b2f8f'], accent: '#e9dcff'
    },
    {
      id: 'frost-bolt', name: '寒冰箭', type: 'spell', cost: 3,
      effects: { damage: 3, armor: 2 }, text: '造成 3 点伤害，获得 2 点护甲',
      gradient: ['#9fdcff', '#2b6b96'], accent: '#e2f6ff'
    },
    {
      id: 'fireball', name: '火球术', type: 'spell', cost: 4,
      effects: { damage: 4 }, text: '造成 4 点伤害',
      gradient: ['#ff9a5c', '#9e271c'], accent: '#ffd9c2'
    },
    {
      id: 'blood-ritual', name: '血祭', type: 'spell', cost: 4,
      effects: { damage: 3, heal: 2 }, text: '造成 3 点伤害，恢复 2 点生命',
      gradient: ['#e06b8b', '#5f1733'], accent: '#ffd3df'
    },
    {
      id: 'wrath', name: '天罚', type: 'spell', cost: 5,
      effects: { damage: 6 }, text: '造成 6 点伤害',
      gradient: ['#ffd36b', '#7a2a12'], accent: '#fff0c2'
    },
    {
      id: 'inspiration', name: '灵感', type: 'spell', cost: 3,
      effects: { gold: 1, draw: 2 }, text: '+1 金币，抽 2 张牌',
      gradient: ['#b8e0ff', '#3d6f9e'], accent: '#e6f4ff'
    },

    /* ---------- 冠军 ---------- */
    {
      id: 'shield-bearer', name: '持盾卫士', type: 'champion', cost: 2,
      defense: 5, effects: {}, ability: { type: 'armor', amount: 2 },
      text: '防御 5 · 每回合激活：+2 护甲',
      gradient: ['#b9c9dd', '#3c4d63'], accent: '#e6effa'
    },
    {
      id: 'guard-captain', name: '卫队长', type: 'champion', cost: 3,
      defense: 4, effects: {}, ability: { type: 'damage', amount: 2 },
      text: '防御 4 · 每回合激活：造成 2 点伤害',
      gradient: ['#e1c48b', '#6d4a1d'], accent: '#ffeccb'
    },
    {
      id: 'priestess', name: '女祭司', type: 'champion', cost: 4,
      defense: 3, effects: {}, ability: { type: 'heal', amount: 3 },
      text: '防御 3 · 每回合激活：恢复 3 点生命',
      gradient: ['#f0c8e8', '#7a2f6b'], accent: '#ffe3fa'
    },
    {
      id: 'merchant', name: '商人', type: 'champion', cost: 4,
      defense: 3, effects: {}, ability: { type: 'gold', amount: 2 },
      text: '防御 3 · 每回合激活：+2 金币',
      gradient: ['#f2d78f', '#7d5a1d'], accent: '#fff2c9'
    },
    {
      id: 'archer-captain', name: '弓手队长', type: 'champion', cost: 5,
      defense: 5, effects: {}, ability: { type: 'damage', amount: 3 },
      text: '防御 5 · 每回合激活：造成 3 点伤害',
      gradient: ['#b7d892', '#3e6326'], accent: '#e8ffd6'
    },
    {
      id: 'young-dragon', name: '幼龙', type: 'champion', cost: 7,
      defense: 6, effects: {}, ability: { type: 'damage', amount: 4 },
      text: '防御 6 · 每回合激活：造成 4 点伤害',
      gradient: ['#ff9f7a', '#7d1d2b'], accent: '#ffded2'
    }
  ];

  var TYPE_LABELS = {
    gold: '金币',
    gem: '宝石',
    weapon: '武器',
    spell: '法术',
    champion: '冠军'
  };

  return {
    version: 1,
    startingDeck: STARTING_DECK,
    cards: CARDS,
    typeLabels: TYPE_LABELS
  };
});
