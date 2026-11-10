/* 极夜灯塔 — original solo co-op survival engine with AI host (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "slug": "mini-ameri-b-06",
  "name": "极夜灯塔",
  "place": "北境灯塔",
  "maxDays": 8,
  "food": 4,
  "warmth": 4,
  "morale": 5,
  "threat": 5,
  "labels": {
    "storm": "暴风雪",
    "night": "无尽长夜",
    "gift": "漂流木",
    "doubt": "低语",
    "calm": "星隙",
    "beast": "冰熊",
    "fire": "炉火重燃",
    "song": "守夜号子",
    "flood": "冰裂",
    "hope": "极光"
  },
  "deck": [
    "storm",
    "calm",
    "gift",
    "night",
    "fire",
    "doubt",
    "calm",
    "beast",
    "song",
    "storm",
    "gift",
    "hope"
  ]
};
  var ACTIONS = {
    gather: { food: 2, warmth: 0, morale: 0, threat: 0, label: '采集' },
    stoke:  { food: -1, warmth: 2, morale: 0, threat: 0, label: '生火' },
    repair: { food: 0, warmth: 0, morale: 0, threat: -2, label: '加固' },
    rally:  { food: 0, warmth: 0, morale: 2, threat: 1, label: '鼓舞' }
  };
  var EVENTS = {
    storm: { warmth: -2, label: CFG.labels.storm },
    night: { threat: 1, label: CFG.labels.night },
    gift:  { food: 1, label: CFG.labels.gift },
    doubt: { morale: -1, label: CFG.labels.doubt },
    calm:  { threat: -1, label: CFG.labels.calm },
    beast: { food: -2, label: CFG.labels.beast },
    fire:  { warmth: 2, label: CFG.labels.fire },
    song:  { morale: 1, label: CFG.labels.song },
    flood: { food: -1, warmth: -1, label: CFG.labels.flood },
    hope:  { morale: 1, threat: -1, label: CFG.labels.hope }
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function clamp(v) { return Math.max(0, Math.min(9, v)); }
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 50) state.log.shift();
  }
  function draw(state) {
    if (!state.deck.length) state.deck = shuffle(CFG.deck, state.rng);
    return state.deck.pop();
  }
  function applyDelta(target, delta) {
    Object.keys(delta).forEach(function (k) {
      if (k === 'label') return;
      target[k] = clamp(target[k] + delta[k]);
    });
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var state = {
      seed: seed, rng: rng,
      day: 1, maxDays: CFG.maxDays,
      res: { food: CFG.food, warmth: CFG.warmth, morale: CFG.morale },
      threat: CFG.threat, maxThreat: 9,
      deck: shuffle(CFG.deck, rng), lastEvent: '',
      over: false, winner: null, reason: '', log: [], stepCount: 0
    };
    log(state, '第 1 天：AI 主持人宣布' + CFG.place + '的生存挑战开始');
    return state;
  }

  function legalActions(state) {
    return state.over ? [] : ['gather', 'stoke', 'repair', 'rally'];
  }

  function applyAction(state, action) {
    if (!state || state.over) throw new Error('game is over');
    var a = ACTIONS[action];
    if (!a) throw new Error('unknown action: ' + action);
    applyDelta(state.res, a);
    log(state, '第 ' + state.day + ' 天你选择' + a.label);
    var key = draw(state);
    var e = EVENTS[key];
    applyDelta(state.res, e);
    if (e.threat) state.threat = clamp(state.threat + e.threat);
    state.lastEvent = e.label;
    log(state, '事件：' + e.label);
    state.stepCount++;
    if (state.res.food <= 0 || state.res.warmth <= 0 || state.res.morale <= 0 || state.threat >= 9) {
      state.over = true;
      state.winner = 'lose';
      state.reason = state.threat >= 9 ? '威胁失控' : '资源耗尽';
      log(state, '营地失守：' + state.reason);
      return state;
    }
    state.day++;
    if (state.day > state.maxDays) {
      state.over = true;
      state.winner = 'win';
      state.reason = '撑过 ' + state.maxDays + ' 天';
      log(state, '你带领营地撑到了救援抵达');
    }
    return state;
  }

  function aiAction(state) {
    if (!state || state.over) return null;
    var r = state.res;
    if (state.threat >= 7 && state.rng() < 0.75) return 'repair';
    if (r.food <= 2) return 'gather';
    if (r.warmth <= 2 && r.food > 1) return 'stoke';
    if (r.morale <= 2) return 'rally';
    if (state.rng() < 0.5) return 'gather';
    return state.rng() < 0.5 ? 'stoke' : 'repair';
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (!g.over && guard < 200) {
      applyAction(g, aiAction(g));
      guard++;
    }
    if (!g.over) throw new Error('self-play did not terminate');
    return g;
  }

  return {
    CFG: CFG, ACTIONS: ACTIONS, createGame: createGame, legalActions: legalActions,
    applyAction: applyAction, aiAction: aiAction, selfPlay: selfPlay
  };
});