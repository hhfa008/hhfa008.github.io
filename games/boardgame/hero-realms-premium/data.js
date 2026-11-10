/*
 * Hero Realms（英雄领域）精品版 — 卡牌与展示数据（UMD）。
 *
 * 浏览器：<script src="data.js"></script> → window.HeroRealmsPremiumData
 * Node：  require('./data.js')
 *
 * 数据口径：
 *  - 卡牌名称、派系与类型取自 Hero Realms 基础版（Wise Wizard Games, 2016）；
 *  - 本实现使用 2 人 50 HP、7 金币 + 3 匕首起始牌组（任务指定的入门牌组），
 *    市场从基础版 80 张市场牌中截取 51 个卡名、约 80 张实体牌构成；
 *  - 数值为适配本引擎的公开规则实现，未声称与实体卡逐字一致。
 *
 * 卡牌字段：
 *   id / name / en / type(item|action|champion) / faction(basic|imperial|guild|necros|wild)
 *   cost    金币价格
 *   copies  进入市场牌堆的张数
 *   effects 立即结算：gold(金币) / combat(战斗) / heal(治疗) / draw(抽牌)
 *   ally    同盟能力：打出本牌时若场上已有同派系另一张牌，额外结算
 *   defense 冠军防御力
 *   ability 冠军每回合可激活一次：{ type, amount }
 *   text    卡面文案
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HeroRealmsPremiumData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STARTING_DECK = [
    { id: 'gold', count: 7 },
    { id: 'dagger', count: 3 }
  ];

  var CARDS = [
    /* ---------------- 基础牌 ---------------- */
    {
      id: 'gold', name: '金币', en: 'Gold', type: 'item', faction: 'basic', cost: 0,
      starting: true, copies: 0, effects: { gold: 1 }, text: '+1 金币',
      gradient: ['#f7dc8a', '#9a6816'], accent: '#fff2c4'
    },
    {
      id: 'dagger', name: '匕首', en: 'Dagger', type: 'item', faction: 'basic', cost: 0,
      starting: true, copies: 0, effects: { combat: 1 }, text: '+1 战斗',
      gradient: ['#c7d2df', '#455263'], accent: '#eff5ff'
    },

    /* ---------------- 帝国 Imperial ---------------- */
    {
      id: 'recruit', name: '征募', en: 'Recruit', type: 'action', faction: 'imperial', cost: 1,
      copies: 3, effects: { gold: 2 }, text: '+2 金币',
      gradient: ['#7fb3ff', '#204a8f'], accent: '#dbe9ff'
    },
    {
      id: 'rally-the-troops', name: '集结部队', en: 'Rally the Troops', type: 'action', faction: 'imperial', cost: 3,
      copies: 2, effects: { combat: 3 }, ally: { heal: 2 }, text: '+3 战斗；同盟：+2 生命',
      gradient: ['#86a9e8', '#243f74'], accent: '#dde8ff'
    },
    {
      id: 'taxation', name: '征税', en: 'Taxation', type: 'action', faction: 'imperial', cost: 3,
      copies: 3, effects: { gold: 2, heal: 2 }, ally: { heal: 4 }, text: '+2 金币，+2 生命；同盟：再 +4 生命',
      gradient: ['#a7c8ff', '#2d5591'], accent: '#eaf2ff'
    },
    {
      id: 'man-at-arms', name: '披甲卫士', en: 'Man-at-Arms', type: 'champion', faction: 'imperial', cost: 3,
      copies: 2, defense: 4, ability: { type: 'combat', amount: 2 }, text: '防御 4 · 激活：+2 战斗',
      gradient: ['#9db9df', '#334f79'], accent: '#e5efff'
    },
    {
      id: 'command', name: '号令', en: 'Command', type: 'action', faction: 'imperial', cost: 4,
      copies: 2, effects: { combat: 4 }, ally: { draw: 1 }, text: '+4 战斗；同盟：抽 1 张牌',
      gradient: ['#84a6e0', '#284575'], accent: '#dce9ff'
    },
    {
      id: 'tithe-priest', name: '什一税祭司', en: 'Tithe Priest', type: 'champion', faction: 'imperial', cost: 4,
      copies: 2, defense: 4, ability: { type: 'heal', amount: 2 }, ally: { heal: 3 },
      text: '防御 4 · 激活：+2 生命；同盟：+3 生命',
      gradient: ['#c9dcff', '#4b6a9d'], accent: '#f0f6ff'
    },
    {
      id: 'master-weyan', name: '韦扬大师', en: 'Master Weyan', type: 'champion', faction: 'imperial', cost: 5,
      copies: 1, defense: 5, ability: { type: 'gold', amount: 2 }, text: '防御 5 · 激活：+2 金币',
      gradient: ['#b7cdf0', '#30507f'], accent: '#eaf3ff'
    },
    {
      id: 'darian-war-mage', name: '战争法师达里安', en: 'Darian, War Mage', type: 'champion', faction: 'imperial', cost: 5,
      copies: 1, defense: 5, ability: { type: 'combat', amount: 3 }, text: '防御 5 · 激活：+3 战斗',
      gradient: ['#8fb5ff', '#203f70'], accent: '#e0edff'
    },
    {
      id: 'cristov-the-just', name: '公正者克里斯托夫', en: 'Cristov, the Just', type: 'champion', faction: 'imperial', cost: 6,
      copies: 1, defense: 6, ability: { type: 'heal', amount: 3 }, text: '防御 6 · 激活：+3 生命',
      gradient: ['#ffebad', '#7a5a16'], accent: '#fff8dd'
    },
    {
      id: 'word-of-power', name: '力量之语', en: 'Word of Power', type: 'action', faction: 'imperial', cost: 6,
      copies: 1, effects: { combat: 5, heal: 2 }, text: '+5 战斗，+2 生命',
      gradient: ['#a6c9ff', '#2a4c80'], accent: '#e9f3ff'
    },
    {
      id: 'kraka-high-priest', name: '高阶祭司克拉卡', en: 'Kraka, High Priest', type: 'champion', faction: 'imperial', cost: 7,
      copies: 1, defense: 7, ability: { type: 'heal', amount: 4 }, text: '防御 7 · 激活：+4 生命',
      gradient: ['#f5d98f', '#7b5c1a'], accent: '#fff4cf'
    },
    {
      id: 'domination', name: '支配', en: 'Domination', type: 'action', faction: 'imperial', cost: 7,
      copies: 1, effects: { combat: 6, draw: 1 }, text: '+6 战斗，抽 1 张牌',
      gradient: ['#b8d2ff', '#294673'], accent: '#eef5ff'
    },
    {
      id: 'arkus-imperial-dragon', name: '帝国巨龙阿库斯', en: 'Arkus, Imperial Dragon', type: 'champion', faction: 'imperial', cost: 8,
      copies: 1, defense: 8, ability: { type: 'combat', amount: 5 }, text: '防御 8 · 激活：+5 战斗',
      gradient: ['#ffd37a', '#7d4b12'], accent: '#fff1c9'
    },

    /* ---------------- 公会 Guild ---------------- */
    {
      id: 'bribe', name: '贿赂', en: 'Bribe', type: 'action', faction: 'guild', cost: 1,
      copies: 3, effects: { gold: 2 }, ally: { gold: 1 }, text: '+2 金币；同盟：再 +1 金币',
      gradient: ['#f3d27d', '#8a611a'], accent: '#fff5d2'
    },
    {
      id: 'street-thug', name: '街头恶棍', en: 'Street Thug', type: 'champion', faction: 'guild', cost: 2,
      copies: 3, defense: 3, ability: { type: 'combat', amount: 2 }, text: '防御 3 · 激活：+2 战斗',
      gradient: ['#e0bd7a', '#6d4c19'], accent: '#ffefc9'
    },
    {
      id: 'profit', name: '利润', en: 'Profit', type: 'action', faction: 'guild', cost: 2,
      copies: 2, effects: { gold: 2, draw: 1 }, text: '+2 金币，抽 1 张牌',
      gradient: ['#f6dc94', '#8f6a1f'], accent: '#fff6d9'
    },
    {
      id: 'smash-and-grab', name: '打砸抢', en: 'Smash and Grab', type: 'action', faction: 'guild', cost: 3,
      copies: 2, effects: { gold: 1, combat: 2 }, text: '+1 金币，+2 战斗',
      gradient: ['#e9c478', '#77521a'], accent: '#ffefc8'
    },
    {
      id: 'fire-bomb', name: '火焰炸弹', en: 'Fire Bomb', type: 'action', faction: 'guild', cost: 4,
      copies: 2, effects: { combat: 4 }, ally: { gold: 1 }, text: '+4 战斗；同盟：+1 金币',
      gradient: ['#ffb36b', '#8a3a12'], accent: '#ffe2c6'
    },
    {
      id: 'hit-job', name: '暗杀委托', en: 'Hit Job', type: 'action', faction: 'guild', cost: 5,
      copies: 1, effects: { combat: 3, gold: 2 }, text: '+3 战斗，+2 金币',
      gradient: ['#d8b272', '#644415'], accent: '#ffedc4'
    },
    {
      id: 'parov-the-enforcer', name: '执法者帕罗夫', en: 'Parov, the Enforcer', type: 'champion', faction: 'guild', cost: 5,
      copies: 1, defense: 5, ability: { type: 'combat', amount: 3 }, text: '防御 5 · 激活：+3 战斗',
      gradient: ['#e6c37c', '#6d4a16'], accent: '#ffefc8'
    },
    {
      id: 'myros-guild-mage', name: '公会法师迈罗斯', en: 'Myros, Guild Mage', type: 'champion', faction: 'guild', cost: 5,
      copies: 1, defense: 5, ability: { type: 'gold', amount: 2 }, text: '防御 5 · 激活：+2 金币',
      gradient: ['#f2d891', '#805d19'], accent: '#fff6d5'
    },
    {
      id: 'rasmus-the-smuggler', name: '走私者拉斯穆斯', en: 'Rasmus, the Smuggler', type: 'champion', faction: 'guild', cost: 6,
      copies: 1, defense: 5, ability: { type: 'gold', amount: 2 }, ally: { draw: 1 },
      text: '防御 5 · 激活：+2 金币；同盟：抽 1 张牌',
      gradient: ['#dfbc75', '#674716'], accent: '#ffedc5'
    },
    {
      id: 'borg-ogre-mercenary', name: '食人魔佣兵博格', en: 'Borg, Ogre Mercenary', type: 'champion', faction: 'guild', cost: 6,
      copies: 1, defense: 7, ability: { type: 'combat', amount: 3 }, text: '防御 7 · 激活：+3 战斗',
      gradient: ['#cfa96b', '#5c3d12'], accent: '#ffe9c1'
    },
    {
      id: 'rake-master-assassin', name: '刺客大师雷克', en: 'Rake, Master Assassin', type: 'champion', faction: 'guild', cost: 7,
      copies: 1, defense: 6, ability: { type: 'combat', amount: 4 }, text: '防御 6 · 激活：+4 战斗',
      gradient: ['#b58f5e', '#4d3210'], accent: '#f7e2bd'
    },

    /* ---------------- 死灵 Necros ---------------- */
    {
      id: 'death-touch', name: '死亡之触', en: 'Death Touch', type: 'action', faction: 'necros', cost: 1,
      copies: 3, effects: { combat: 2 }, text: '+2 战斗',
      gradient: ['#d78aa6', '#651c38'], accent: '#ffdce8'
    },
    {
      id: 'influence', name: '影响力', en: 'Influence', type: 'action', faction: 'necros', cost: 1,
      copies: 2, effects: { gold: 1, heal: 1 }, text: '+1 金币，+1 生命',
      gradient: ['#c48aa8', '#57213a'], accent: '#f7d9e6'
    },
    {
      id: 'death-cultist', name: '死亡邪教徒', en: 'Death Cultist', type: 'champion', faction: 'necros', cost: 2,
      copies: 3, defense: 3, ability: { type: 'combat', amount: 2 }, text: '防御 3 · 激活：+2 战斗',
      gradient: ['#b87b96', '#4d1b31'], accent: '#f3d2e0'
    },
    {
      id: 'dark-energy', name: '黑暗能量', en: 'Dark Energy', type: 'action', faction: 'necros', cost: 2,
      copies: 2, effects: { combat: 2, heal: 1 }, text: '+2 战斗，+1 生命',
      gradient: ['#bd84a1', '#521f36'], accent: '#f6d9e6'
    },
    {
      id: 'the-rot', name: '腐朽', en: 'The Rot', type: 'action', faction: 'necros', cost: 3,
      copies: 2, effects: { combat: 3 }, ally: { heal: 2 }, text: '+3 战斗；同盟：+2 生命',
      gradient: ['#9f6c84', '#41172a'], accent: '#eccadd'
    },
    {
      id: 'dark-reward', name: '黑暗奖赏', en: 'Dark Reward', type: 'action', faction: 'necros', cost: 3,
      copies: 2, effects: { gold: 2, heal: 2 }, text: '+2 金币，+2 生命',
      gradient: ['#c995ad', '#5b2038'], accent: '#f8dce9'
    },
    {
      id: 'cult-priest', name: '邪教祭司', en: 'Cult Priest', type: 'champion', faction: 'necros', cost: 4,
      copies: 2, defense: 4, ability: { type: 'combat', amount: 2 }, ally: { combat: 4 },
      text: '防御 4 · 激活：+2 战斗；同盟：+4 战斗',
      gradient: ['#a86d89', '#48182d'], accent: '#f0cfe0'
    },
    {
      id: 'lys-the-unseen', name: '无形者莉丝', en: 'Lys, the Unseen', type: 'champion', faction: 'necros', cost: 4,
      copies: 2, defense: 3, ability: { type: 'combat', amount: 2 }, text: '防御 3 · 激活：+2 战斗',
      gradient: ['#8b5f79', '#3a1324'], accent: '#e8c9da'
    },
    {
      id: 'life-drain', name: '生命汲取', en: 'Life Drain', type: 'action', faction: 'necros', cost: 5,
      copies: 2, effects: { combat: 4, heal: 3 }, text: '+4 战斗，+3 生命',
      gradient: ['#d17c9c', '#5d1732'], accent: '#ffd8e5'
    },
    {
      id: 'rayla-endweaver', name: '织终者蕾拉', en: 'Rayla, Endweaver', type: 'champion', faction: 'necros', cost: 5,
      copies: 1, defense: 4, ability: { type: 'draw', amount: 1 }, ally: { draw: 1 },
      text: '防御 4 · 激活：抽 1 张牌；同盟：抽 1 张牌',
      gradient: ['#b07593', '#4a1830'], accent: '#f2d0e1'
    },
    {
      id: 'varrick-the-necromancer', name: '死灵法师瓦里克', en: 'Varrick, the Necromancer', type: 'champion', faction: 'necros', cost: 6,
      copies: 1, defense: 5, ability: { type: 'combat', amount: 3 }, text: '防御 5 · 激活：+3 战斗',
      gradient: ['#9f5f80', '#3f1328'], accent: '#eec8dc'
    },
    {
      id: 'krythos-master-vampire', name: '吸血鬼大师克里斯托斯', en: 'Krythos, Master Vampire', type: 'champion', faction: 'necros', cost: 7,
      copies: 1, defense: 6, ability: { type: 'heal', amount: 3 }, text: '防御 6 · 激活：+3 生命',
      gradient: ['#c26e90', '#4e132d'], accent: '#ffd4e3'
    },
    {
      id: 'tyrannor-the-devourer', name: '吞噬者提兰诺', en: 'Tyrannor, the Devourer', type: 'champion', faction: 'necros', cost: 8,
      copies: 1, defense: 8, ability: { type: 'combat', amount: 5 }, text: '防御 8 · 激活：+5 战斗',
      gradient: ['#8f4f70', '#360f22'], accent: '#e8bfd4'
    },

    /* ---------------- 荒野 Wild ---------------- */
    {
      id: 'spark', name: '火花', en: 'Spark', type: 'action', faction: 'wild', cost: 1,
      copies: 3, effects: { combat: 2 }, text: '+2 战斗',
      gradient: ['#a9d98a', '#3f6b26'], accent: '#e6ffd6'
    },
    {
      id: 'elven-gift', name: '精灵赠礼', en: 'Elven Gift', type: 'action', faction: 'wild', cost: 2,
      copies: 2, effects: { heal: 3 }, ally: { draw: 1 }, text: '+3 生命；同盟：抽 1 张牌',
      gradient: ['#bfe3a2', '#4a7a2d'], accent: '#edffe0'
    },
    {
      id: 'orc-grunt', name: '兽人步兵', en: 'Orc Grunt', type: 'champion', faction: 'wild', cost: 2,
      copies: 3, defense: 3, ability: { type: 'combat', amount: 2 }, text: '防御 3 · 激活：+2 战斗',
      gradient: ['#9fca7d', '#3c6324'], accent: '#e2ffd0'
    },
    {
      id: 'natures-bounty', name: '自然恩赐', en: "Nature's Bounty", type: 'action', faction: 'wild', cost: 3,
      copies: 2, effects: { gold: 2, heal: 1 }, text: '+2 金币，+1 生命',
      gradient: ['#b5dd92', '#4a7028'], accent: '#eaffda'
    },
    {
      id: 'wolf-form', name: '狼形态', en: 'Wolf Form', type: 'action', faction: 'wild', cost: 3,
      copies: 2, effects: { combat: 3 }, ally: { heal: 2 }, text: '+3 战斗；同盟：+2 生命',
      gradient: ['#8fbe6e', '#355c20'], accent: '#dcf7cb'
    },
    {
      id: 'rampage', name: '狂暴', en: 'Rampage', type: 'action', faction: 'wild', cost: 4,
      copies: 2, effects: { combat: 4 }, ally: { combat: 2 }, text: '+4 战斗；同盟：再 +2 战斗',
      gradient: ['#c2e09a', '#4c7226'], accent: '#eeffdc'
    },
    {
      id: 'dire-wolf', name: '恐狼', en: 'Dire Wolf', type: 'champion', faction: 'wild', cost: 4,
      copies: 2, defense: 4, ability: { type: 'combat', amount: 2 }, text: '防御 4 · 激活：+2 战斗',
      gradient: ['#88b568', '#33551e'], accent: '#ddf6cc'
    },
    {
      id: 'wolf-shaman', name: '狼萨满', en: 'Wolf Shaman', type: 'champion', faction: 'wild', cost: 5,
      copies: 1, defense: 4, ability: { type: 'heal', amount: 2 }, text: '防御 4 · 激活：+2 生命',
      gradient: ['#a8cf86', '#40602a'], accent: '#e8ffd8'
    },
    {
      id: 'broelyn-loreweaver', name: '织识者布萝琳', en: 'Broelyn, Loreweaver', type: 'champion', faction: 'wild', cost: 5,
      copies: 1, defense: 4, ability: { type: 'draw', amount: 1 }, text: '防御 4 · 激活：抽 1 张牌',
      gradient: ['#c6e6a6', '#4c702f'], accent: '#f0ffe1'
    },
    {
      id: 'cron-the-berserker', name: '狂战士克朗', en: 'Cron, the Berserker', type: 'champion', faction: 'wild', cost: 6,
      copies: 1, defense: 5, ability: { type: 'combat', amount: 4 }, text: '防御 5 · 激活：+4 战斗',
      gradient: ['#9dc77c', '#3a5c22'], accent: '#e5ffd4'
    },
    {
      id: 'torgen-rocksplitter', name: '裂石者托尔根', en: 'Torgen Rocksplitter', type: 'champion', faction: 'wild', cost: 6,
      copies: 1, defense: 6, ability: { type: 'combat', amount: 4 }, text: '防御 6 · 激活：+4 战斗',
      gradient: ['#b3d492', '#456629'], accent: '#ecffdd'
    },
    {
      id: 'grak-storm-giant', name: '风暴巨人格拉克', en: 'Grak, Storm Giant', type: 'champion', faction: 'wild', cost: 7,
      copies: 1, defense: 7, ability: { type: 'combat', amount: 5 }, text: '防御 7 · 激活：+5 战斗',
      gradient: ['#d0e8ae', '#557a33'], accent: '#f4ffe6'
    }
  ];

  var TYPE_LABELS = { item: '物品', action: '行动', champion: '冠军' };
  var FACTION_LABELS = { basic: '基础', imperial: '帝国', guild: '公会', necros: '死灵', wild: '荒野' };

  return {
    version: 1,
    slug: 'hero-realms-premium',
    title: '英雄领域',
    subtitle: '买下卡牌，构筑你的牌库，把对手的 50 点生命打到 0',
    players: '2 人',
    duration: '20–30 分钟',
    mood: '牌库构筑 / 奇幻对战 / 策略',
    tagline: '七枚金币、三把匕首，市场的每一张牌都会改变下一次抽牌。',
    startingDeck: STARTING_DECK,
    cards: CARDS,
    typeLabels: TYPE_LABELS,
    factionLabels: FACTION_LABELS,
    factions: [
      { id: 'imperial', name: '帝国', color: '#6f9fe0', doctrine: '经济、治疗与稳健的冠军' },
      { id: 'guild', name: '公会', color: '#e0b45c', doctrine: '金币、效率与灵活的行动牌' },
      { id: 'necros', name: '死灵', color: '#cf6f92', doctrine: '战斗、吸血与高攻冠军' },
      { id: 'wild', name: '荒野', color: '#9ccb76', doctrine: '爆发战斗、治疗与野兽冠军' }
    ],
    aiNames: ['你', '黑曜领主'],
    seats: [
      { avatar: '⚔', tone: 'gold' },
      { avatar: '☠', tone: 'violet' }
    ],
    soundLabels: {
      deal: '发牌',
      play: '出牌',
      buy: '购买',
      attack: '攻击',
      heal: '治疗',
      win: '胜利',
      lose: '失败'
    },
    sources: [
      {
        title: '超好玩的卡牌游戏推荐：《hero realms（英雄领域）》',
        up: '普-拉-斯-先-生',
        bv: 'BV1oG411G7Dj',
        url: 'https://www.bilibili.com/video/BV1oG411G7Dj',
        points: ['2 人 50 点生命对战', '金币购买市场牌、构筑牌库', '把对手生命打到 0 即获胜']
      },
      {
        title: '【翎教学】《英雄领域》一大扩教学',
        up: '翎-IrisYang-',
        bv: 'BV1UN411e7Ah',
        url: 'https://www.bilibili.com/video/BV1UN411e7Ah',
        points: ['金币、战斗、治疗三种资源', '冠军拥有防御力并可每回合激活', '同派系同盟能力触发']
      },
      {
        title: '【英雄领域】地下城扩展，2024年发售！',
        up: '泰尔康塔',
        bv: 'BV1gX4y1b7Gw',
        url: 'https://www.bilibili.com/video/BV1gX4y1b7Gw',
        points: ['基础版与扩展的卡牌体系', '市场牌与派系机制', '合作模式扩展的定位']
      }
    ]
  };
});
