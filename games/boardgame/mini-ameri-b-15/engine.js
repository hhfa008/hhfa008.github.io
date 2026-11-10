/* 铁轨浪人 — original solo character-growth adventure engine with AI host (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "slug": "mini-ameri-b-15",
  "name": "铁轨浪人",
  "hero": "铁轨浪人",
  "place": "废弃铁路",
  "hp": 12,
  "bossPower": 11,
  "texts": [
    "铁轨上停着一节没有车头的车厢。",
    "信号灯自己在红绿之间切换。",
    "隧道口堆着新鲜的煤渣。",
    "巡道员留下半张手绘地图。",
    "夜车鸣笛，但时刻表早已停运。"
  ],
  "bossText": "铁路大亨的装甲列车挡住了唯一出口。"
};
  var CHOICES = [
    { label: '强攻', text: '正面突破，伤势更重，但成长更快。', hp: -2, xp: 2, gold: 1 },
    { label: '周旋', text: '借势周旋，收获更多金币。', hp: -1, xp: 1, gold: 2 },
    { label: '休整', text: '暂避锋芒，回复生命但错过成长。', hp: 2, xp: 0, gold: 0 }
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 50) state.log.shift();
  }
  function buildEncounters() {
    var list = [];
    for (var i = 0; i < CFG.texts.length; i++) {
      list.push({ text: CFG.texts[i], choices: CHOICES, boss: false });
    }
    list.push({
      text: CFG.bossText, boss: true, power: CFG.bossPower,
      choices: [
        { label: '决一死战', text: '攻击力与等级决定胜负。' },
        { label: '转身撤退', text: '保住性命，但冒险失败。' }
      ]
    });
    return list;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var state = {
      seed: seed, rng: rng,
      hero: { name: CFG.hero, hp: CFG.hp, maxHp: CFG.hp, atk: 2, xp: 0, level: 1, gold: 0 },
      encounters: buildEncounters(), encounter: 0,
      over: false, winner: null, reason: '', log: [], stepCount: 0, lastText: ''
    };
    log(state, CFG.hero + ' 踏上' + CFG.place + '，第一段遭遇：' + CFG.texts[0]);
    return state;
  }
  function currentEncounter(state) {
    return state.encounters[state.encounter] || null;
  }
  function legalActions(state) {
    if (state.over) return [];
    var enc = currentEncounter(state);
    return enc ? enc.choices.map(function (_, i) { return i; }) : [];
  }
  function levelUp(hero) {
    var gained = 0;
    while (hero.xp >= hero.level * 3) {
      hero.xp -= hero.level * 3;
      hero.level++;
      hero.atk++;
      hero.maxHp += 2;
      hero.hp = Math.min(hero.maxHp, hero.hp + 2);
      gained++;
    }
    return gained;
  }
  function finish(state, winner, reason) {
    state.over = true;
    state.winner = winner;
    state.reason = reason;
    log(state, '冒险结束：' + reason);
  }

  function applyAction(state, idx) {
    if (!state || state.over) throw new Error('game is over');
    var enc = currentEncounter(state);
    if (!enc) throw new Error('no encounter');
    if (typeof idx !== 'number' || idx < 0 || idx >= enc.choices.length) throw new Error('illegal choice');
    state.stepCount++;
    if (enc.boss) {
      if (idx === 1) {
        finish(state, 'lose', '你在最后关头撤退，冒险无果');
        return state;
      }
      var power = state.hero.atk + state.hero.level * 2;
      if (power >= enc.power) finish(state, 'win', state.hero.name + ' 击败首领（战力 ' + power + ' / ' + enc.power + '）');
      else finish(state, 'lose', state.hero.name + ' 战力不足（' + power + ' / ' + enc.power + '）');
      return state;
    }
    var ch = enc.choices[idx];
    state.hero.hp = Math.max(0, Math.min(state.hero.maxHp, state.hero.hp + ch.hp));
    state.hero.xp += ch.xp;
    state.hero.gold += ch.gold;
    state.lastText = ch.text;
    log(state, '第 ' + (state.encounter + 1) + ' 段：选择' + ch.label + '，生命 ' + state.hero.hp + '，经验 ' + state.hero.xp);
    if (state.hero.hp <= 0) {
      finish(state, 'lose', state.hero.name + ' 在第 ' + (state.encounter + 1) + ' 段遭遇中倒下');
      return state;
    }
    var levels = levelUp(state.hero);
    if (levels > 0) log(state, state.hero.name + ' 升到 ' + state.hero.level + ' 级，攻击 ' + state.hero.atk + '，生命上限 ' + state.hero.maxHp);
    state.encounter++;
    var next = currentEncounter(state);
    if (next) log(state, next.boss ? '首领现身：' + next.text : '下一段：' + next.text);
    return state;
  }

  function aiAction(state) {
    if (!state || state.over) return null;
    var enc = currentEncounter(state);
    if (!enc) return null;
    if (enc.boss) {
      var power = state.hero.atk + state.hero.level * 2;
      return power >= enc.power ? 0 : 1;
    }
    if (state.hero.hp <= 3) return 2;
    return state.rng() < 0.5 ? 0 : 1;
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (!g.over && guard < 100) {
      applyAction(g, aiAction(g));
      guard++;
    }
    if (!g.over) throw new Error('self-play did not terminate');
    return g;
  }

  return {
    CFG: CFG, CHOICES: CHOICES, createGame: createGame, currentEncounter: currentEncounter,
    legalActions: legalActions, applyAction: applyAction, aiAction: aiAction, selfPlay: selfPlay
  };
});