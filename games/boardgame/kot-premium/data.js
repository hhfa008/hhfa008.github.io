/*
 * 东京妖都（Kot Premium）原创数据 — UMD
 *
 * 浏览器：<script src="data.js"></script> -> globalThis.KOT_DATA
 * Node：  const DATA = require('./data.js')
 *
 * 所有怪兽、名称、配色与能力卡均为本项目原创，不使用任何商业 IP 素材。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KOT_DATA = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /*
   * 6 只原创怪兽。palette 控制 SVG 身体、纹理与眼睛配色；
   * variant 决定渲染器使用的轮廓与纹理类型。
   */
  var MONSTERS = [
    {
      id: 'emberwyrm',
      name: '烬鳞龙',
      en: 'Emberwyrm',
      title: '熔岩脊背的暴君',
      art: 'monster-emberwyrm.webp',
      variant: 'dragon',
      texture: 'scales',
      maxHp: 10,
      palette: {
        body: '#d45432', body2: '#7d241b', belly: '#f2a45c',
        accent: '#ffb347', eye: '#fff0b8', glow: '#ff6a3d', dark: '#3a1210'
      }
    },
    {
      id: 'tideback',
      name: '潮汐鳌',
      en: 'Tideback',
      title: '背负海湾的老龟',
      art: 'monster-tideback.webp',
      variant: 'turtle',
      texture: 'shell',
      maxHp: 10,
      palette: {
        body: '#2f9e93', body2: '#155b5c', belly: '#a9e5d8',
        accent: '#7ff0d4', eye: '#f4ffcf', glow: '#37e0c8', dark: '#0b2d31'
      }
    },
    {
      id: 'lunamantis',
      name: '月影螳',
      en: 'Lunamantis',
      title: '霓虹灯下的猎手',
      art: 'monster-lunamantis.webp',
      variant: 'mantis',
      texture: 'chitin',
      maxHp: 10,
      palette: {
        body: '#8a63d2', body2: '#3e2470', belly: '#d5c2ff',
        accent: '#f0b6ff', eye: '#fff6d8', glow: '#c78bff', dark: '#1c1030'
      }
    },
    {
      id: 'rustfang',
      name: '锈齿兽',
      en: 'Rustfang',
      title: '废铁港口的拾荒王',
      art: 'monster-rustfang.webp',
      variant: 'beast',
      texture: 'plates',
      maxHp: 10,
      palette: {
        body: '#a8763f', body2: '#5c3a1f', belly: '#e0b47a',
        accent: '#ffd166', eye: '#fff2c2', glow: '#ff9f45', dark: '#2b1a0e'
      }
    },
    {
      id: 'frosthorn',
      name: '霜角鲸',
      en: 'Frosthorn',
      title: '来自冰海的独行者',
      art: 'monster-frosthorn.webp',
      variant: 'whale',
      texture: 'ice',
      maxHp: 10,
      palette: {
        body: '#4e8fd6', body2: '#224a84', belly: '#c7e9ff',
        accent: '#bff6ff', eye: '#ffffff', glow: '#6fdcff', dark: '#0b213d'
      }
    },
    {
      id: 'sporecolossus',
      name: '孢子巨像',
      en: 'Sporecolossus',
      title: '行走的霓虹菌林',
      art: 'monster-sporecolossus.webp',
      variant: 'golem',
      texture: 'spore',
      maxHp: 10,
      palette: {
        body: '#5aa845', body2: '#28632c', belly: '#c7ef9b',
        accent: '#d7ff6e', eye: '#fffbd0', glow: '#9dff57', dark: '#10280e'
      }
    }
  ];

  /*
   * 能力卡：购买后永久生效（宣传机器为购买时立即结算）。
   * cost 为能量费用；effect 由 engine.js 读取。
   */
  var CARDS = [
    {
      id: 'acid-claw', name: '酸蚀之爪', en: 'Acid Claw', cost: 6, icon: 'claw',
      effect: 'smash-bonus', text: '你的每次爪击结算额外造成 1 点伤害。'
    },
    {
      id: 'spiked-tail', name: '尖刺尾锤', en: 'Spiked Tail', cost: 5, icon: 'tail',
      effect: 'smash-bonus', text: '你的每次爪击结算额外造成 1 点伤害，可与酸蚀之爪叠加。'
    },
    {
      id: 'lava-armor', name: '熔岩甲壳', en: 'Lava Armor', cost: 4, icon: 'shield',
      effect: 'damage-armor', text: '每轮受到的爪击伤害减少 1 点（最低 0）。'
    },
    {
      id: 'tidal-shell', name: '逆流鳞片', en: 'Tidal Shell', cost: 4, icon: 'wave',
      effect: 'tokyo-armor', text: '当你身处东京时，受到的爪击伤害再减少 1 点。'
    },
    {
      id: 'regen-gland', name: '再生腺体', en: 'Regen Gland', cost: 5, icon: 'heart',
      effect: 'heal-bonus', text: '当你治疗时，额外回复 1 点生命。'
    },
    {
      id: 'solar-core', name: '太阳能核', en: 'Solar Core', cost: 4, icon: 'bolt',
      effect: 'turn-energy', text: '每个回合开始时获得 1 点能量。'
    },
    {
      id: 'giant-bones', name: '巨化骨骼', en: 'Giant Bones', cost: 4, icon: 'bone',
      effect: 'max-hp', text: '最大生命 +2，并立即回复 2 点生命。'
    },
    {
      id: 'energy-siphon', name: '能量虹吸', en: 'Energy Siphon', cost: 4, icon: 'siphon',
      effect: 'energy-bonus', text: '一次结算中掷出至少 3 个能量面时，额外获得 1 点能量。'
    },
    {
      id: 'city-climber', name: '都市攀爬者', en: 'City Climber', cost: 3, icon: 'city',
      effect: 'enter-bonus', text: '进入东京时额外获得 1 分（共 2 分）。'
    },
    {
      id: 'propaganda', name: '宣传机器', en: 'Propaganda', cost: 3, icon: 'star',
      effect: 'buy-vp', text: '购买时立即获得 2 分。'
    },
    {
      id: 'field-medkit', name: '野战急救包', en: 'Field Medkit', cost: 3, icon: 'medkit',
      effect: 'end-heal', text: '回合结束时若你不在东京，回复 1 点生命。'
    },
    {
      id: 'royal-presence', name: '王者威仪', en: 'Royal Presence', cost: 7, icon: 'crown',
      effect: 'tokyo-vp', text: '回合开始时若你在东京，额外获得 2 分（与东京驻守的 2 分叠加）。'
    },
    {
      id: 'hunter-instinct', name: '猎手直觉', en: 'Hunter Instinct', cost: 3, icon: 'eye',
      effect: 'claw-vp', text: '一次结算中掷出至少 3 个爪面时，获得 1 分。'
    },
    {
      id: 'thunder-crown', name: '雷鸣王冠', en: 'Thunder Crown', cost: 6, icon: 'crown2',
      effect: 'turn-vp', text: '每个回合开始时获得 1 分。'
    }
  ];

  function monsterById(id) {
    for (var i = 0; i < MONSTERS.length; i++) {
      if (MONSTERS[i].id === id) return MONSTERS[i];
    }
    return null;
  }

  function cardById(id) {
    for (var i = 0; i < CARDS.length; i++) {
      if (CARDS[i].id === id) return CARDS[i];
    }
    return null;
  }

  return {
    MONSTERS: MONSTERS,
    CARDS: CARDS,
    monsterById: monsterById,
    cardById: cardById
  };
});
