/*
 * Splendor（璀璨宝石）数据表 — UMD
 *
 * 90 张发展卡按官方 40 / 30 / 20 的数量与费用表整理：
 * 每行 [等级, 白, 蓝, 绿, 红, 黑, 奖励色, 声望]。
 * 费用列顺序与公开牌表一致；奖励色按公开牌表的 red/green/blue/white/black 索引还原。
 *
 * 浏览器：<script src="data.js"></script> 后使用 globalThis.SplendorData。
 * Node：const Data = require('./data.js')
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SplendorData = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = Object.freeze([
    { key: 'white', name: '钻石', label: '白钻', ink: '#3a3122', face: '#f8f3e4', edge: '#bda86f', glow: '#fffdf2' },
    { key: 'blue', name: '蓝宝石', label: '蓝宝', ink: '#0d2c4d', face: '#2f7fbd', edge: '#16496f', glow: '#9fd8ff' },
    { key: 'green', name: '祖母绿', label: '祖母绿', ink: '#123b26', face: '#2f8955', edge: '#155331', glow: '#9fe8b9' },
    { key: 'red', name: '红宝石', label: '红宝', ink: '#4d1212', face: '#bf3c33', edge: '#7d1d18', glow: '#ffb3a6' },
    { key: 'black', name: '缟玛瑙', label: '黑玛瑙', ink: '#ece7dc', face: '#2b2b31', edge: '#111114', glow: '#b9b4c6' }
  ]);
  var COLOR_KEYS = Object.freeze(COLORS.map(function (c) { return c.key; }));
  var COLOR_BY_KEY = {};
  COLORS.forEach(function (c) { COLOR_BY_KEY[c.key] = c; });

  var RAW_CARDS = [
    [1,3,0,0,0,0,'red',0],
    [1,0,0,0,3,0,'green',0],
    [1,0,0,0,0,3,'blue',0],
    [1,0,3,0,0,0,'white',0],
    [1,0,0,3,0,0,'black',0],
    [1,0,2,1,0,0,'red',0],
    [1,2,1,0,0,0,'green',0],
    [1,1,0,0,0,2,'blue',0],
    [1,0,0,0,2,1,'white',0],
    [1,0,0,2,1,0,'black',0],
    [1,4,0,0,0,0,'red',1],
    [1,0,0,0,0,4,'green',1],
    [1,0,0,0,4,0,'blue',1],
    [1,0,0,4,0,0,'white',1],
    [1,0,4,0,0,0,'black',1],
    [1,2,0,0,2,0,'red',0],
    [1,0,2,0,2,0,'green',0],
    [1,0,0,2,0,2,'blue',0],
    [1,0,2,0,0,2,'white',0],
    [1,2,0,2,0,0,'black',0],
    [1,1,1,1,0,1,'red',0],
    [1,1,1,0,1,1,'green',0],
    [1,1,0,1,1,1,'blue',0],
    [1,0,1,1,1,1,'white',0],
    [1,1,1,1,1,0,'black',0],
    [1,2,1,1,0,1,'red',0],
    [1,1,1,0,1,2,'green',0],
    [1,1,0,1,2,1,'blue',0],
    [1,0,1,2,1,1,'white',0],
    [1,1,2,1,1,0,'black',0],
    [1,2,0,1,0,2,'red',0],
    [1,0,1,0,2,2,'green',0],
    [1,1,0,2,2,0,'blue',0],
    [1,0,2,2,0,1,'white',0],
    [1,2,2,0,1,0,'black',0],
    [1,1,0,0,1,3,'red',0],
    [1,1,3,1,0,0,'green',0],
    [1,0,1,3,1,0,'blue',0],
    [1,3,1,0,0,1,'white',0],
    [1,0,0,1,3,1,'black',0],
    [2,0,0,0,0,5,'red',2],
    [2,0,0,5,0,0,'green',2],
    [2,0,5,0,0,0,'blue',2],
    [2,0,0,0,5,0,'white',2],
    [2,5,0,0,0,0,'black',2],
    [2,0,0,0,6,0,'red',3],
    [2,0,0,6,0,0,'green',3],
    [2,0,6,0,0,0,'blue',3],
    [2,6,0,0,0,0,'white',3],
    [2,0,0,0,0,6,'black',3],
    [2,3,0,0,0,5,'red',2],
    [2,0,5,3,0,0,'green',2],
    [2,5,3,0,0,0,'blue',2],
    [2,0,0,0,5,3,'white',2],
    [2,0,0,5,3,0,'black',2],
    [2,1,4,2,0,0,'red',2],
    [2,4,2,0,0,1,'green',2],
    [2,2,0,0,1,4,'blue',2],
    [2,0,0,1,4,2,'white',2],
    [2,0,1,4,2,0,'black',2],
    [2,2,0,0,2,3,'red',1],
    [2,2,3,0,0,2,'green',1],
    [2,0,2,2,3,0,'blue',1],
    [2,0,0,3,2,2,'white',1],
    [2,3,2,2,0,0,'black',1],
    [2,0,3,0,2,3,'red',1],
    [2,3,0,2,3,0,'green',1],
    [2,0,2,3,0,3,'blue',1],
    [2,2,3,0,3,0,'white',1],
    [2,3,0,3,0,2,'black',1],
    [3,0,0,7,0,0,'red',4],
    [3,0,7,0,0,0,'green',4],
    [3,7,0,0,0,0,'blue',4],
    [3,0,0,0,0,7,'white',4],
    [3,0,0,0,7,0,'black',4],
    [3,0,0,7,3,0,'red',5],
    [3,0,7,3,0,0,'green',5],
    [3,7,3,0,0,0,'blue',5],
    [3,3,0,0,0,7,'white',5],
    [3,0,0,0,7,3,'black',5],
    [3,0,3,6,3,0,'red',4],
    [3,3,6,3,0,0,'green',4],
    [3,6,3,0,0,3,'blue',4],
    [3,3,0,0,3,6,'white',4],
    [3,0,0,3,6,3,'black',4],
    [3,3,5,3,0,3,'red',3],
    [3,5,3,0,3,3,'green',3],
    [3,3,0,3,3,5,'blue',3],
    [3,0,3,3,5,3,'white',3],
    [3,3,3,5,3,0,'black',3]
  ];

  var NAME_TITLES = {
    1: ['拾光者', '切磨匠', '商队学徒', '矿脉行者', '集市学徒', '灯下匠人', '河港旅人', '星尘学徒'],
    2: ['鉴宝师', '行会商人', '宫廷匠师', '远洋船长', '秘境学者', '王城管事'],
    3: ['大公', '贤者', '女王', '君主']
  };
  var CARD_COLORS = ['white', 'blue', 'green', 'red', 'black'];

  var CARDS = RAW_CARDS.map(function (row, index) {
    var tier = row[0];
    var cost = {
      white: row[1], blue: row[2], green: row[3], red: row[4], black: row[5]
    };
    var bonus = row[6];
    var colorIndex = CARD_COLORS.indexOf(bonus);
    var tierIndex = index - (tier === 1 ? 0 : tier === 2 ? 40 : 70);
    var title = NAME_TITLES[tier][tierIndex % NAME_TITLES[tier].length];
    return {
      id: 'S' + tier + '-' + String(tierIndex + 1).padStart(2, '0'),
      tier: tier,
      index: index,
      name: COLOR_BY_KEY[bonus].name + '·' + title,
      bonus: bonus,
      points: row[7],
      cost: cost,
      costTotal: row[1] + row[2] + row[3] + row[4] + row[5]
    };
  });

  var NOBLES = Object.freeze([
    { id: 'N01', name: '钻石行会', points: 3, need: { white: 4, blue: 4 } },
    { id: 'N02', name: '蓝宝王庭', points: 3, need: { blue: 4, green: 4 } },
    { id: 'N03', name: '翡翠议会', points: 3, need: { green: 4, red: 4 } },
    { id: 'N04', name: '绯红骑士团', points: 3, need: { red: 4, black: 4 } },
    { id: 'N05', name: '黑曜密社', points: 3, need: { black: 4, white: 4 } },
    { id: 'N06', name: '三元商会', points: 3, need: { white: 3, blue: 3, green: 3 } },
    { id: 'N07', name: '湖海同盟', points: 3, need: { blue: 3, green: 3, red: 3 } },
    { id: 'N08', name: '赤林守望', points: 3, need: { green: 3, red: 3, black: 3 } },
    { id: 'N09', name: '夜火教团', points: 3, need: { red: 3, black: 3, white: 3 } },
    { id: 'N10', name: '墨白学院', points: 3, need: { black: 3, white: 3, blue: 3 } }
  ]);

  var SOURCES = Object.freeze([
    {
      title: '【璀璨宝石】从规则到战略战术技巧：13分钟成为璀璨宝石大师',
      up: '布尤郁·豪', bv: 'BV1KJ411F7Tq',
      url: 'https://www.bilibili.com/video/BV1KJ411F7Tq',
      points: '胜利条件 15 声望；四类行动：拿三色宝石、拿两枚同色、预留发展卡并拿黄金、购买发展卡；贵族到访与高分流/贵族流取舍。'
    },
    {
      title: '【桌游怎么玩】璀璨宝石，规则教学，城市扩展，要塞扩展，璀璨之城扩展，Splendor',
      up: '桌游怎么玩', bv: 'BV1R7411k7BL',
      url: 'https://www.bilibili.com/video/BV1R7411k7BL',
      points: '五色宝石与黄金的成套收集；发展卡提供永久折扣；贵族需要指定颜色与数量的永久加成。'
    },
    {
      title: '【桌游】Splendor 璀璨宝石 20250920',
      up: 'PLAYBoardGames', bv: 'BV1zGp9zWE4u',
      url: 'https://www.bilibili.com/video/BV1zGp9zWE4u',
      points: '2014 年 BGG Golden Geek 年度游戏、SDJ 获奖作品；两人局完整对局演示。'
    }
  ]);

  return Object.freeze({
    COLORS: COLORS,
    COLOR_KEYS: COLOR_KEYS,
    COLOR_BY_KEY: COLOR_BY_KEY,
    CARDS: Object.freeze(CARDS),
    NOBLES: NOBLES,
    SOURCES: SOURCES,
    NAME_TITLES: NAME_TITLES
  });
});
