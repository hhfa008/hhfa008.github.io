/* 星陨矿坑 — original two-player expedition push-your-luck engine (UMD).
 * Pure rules, seeded RNG, no DOM. Node: require('./engine.js'); browser: window.MiniEngine.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiniEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var CFG = {
  "slug": "mini-ameri-b-05",
  "name": "星陨矿坑",
  "rival": "陨石猎人",
  "place": "星陨矿坑",
  "target": 12,
  "maxRounds": 9,
  "startSupply": 4,
  "maxSupply": 7,
  "labels": {
    "relic": "陨铁核心",
    "supply": "电池组",
    "hazard": "辐射风暴",
    "shortcut": "磁轨",
    "trap": "坍塌井",
    "blank": "废坑"
  },
  "deck": [
    "relic",
    "relic",
    "hazard",
    "supply",
    "shortcut",
    "relic",
    "trap",
    "hazard",
    "blank",
    "relic",
    "supply",
    "hazard"
  ]
};
  var EFFECTS = {
    relic: { score: 2, supply: 0 },
    supply: { score: 0, supply: 1 },
    hazard: { score: -1, supply: -1 },
    shortcut: { score: 1, supply: 1 },
    trap: { score: 0, supply: -2 },
    blank: { score: 0, supply: 0 }
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
  function log(state, text) {
    state.log.push(text);
    if (state.log.length > 40) state.log.shift();
  }
  function draw(state) {
    if (!state.deck.length) state.deck = shuffle(CFG.deck, state.rng);
    return state.deck.pop();
  }
  function finish(state, winner, reason) {
    state.over = true;
    state.winner = winner;
    state.reason = reason;
    log(state, '对局结束：' + reason);
  }
  function finishByScore(state, reason) {
    var a = state.players[0], b = state.players[1];
    if (a.score === b.score) finish(state, 'draw', reason + '，双方同分');
    else finish(state, a.score > b.score ? 'p0' : 'p1', reason + '，按秘藏分数判定');
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var rng = mulberry32(seed);
    var state = {
      seed: seed, rng: rng,
      players: [
        { name: '你', human: true, score: 0, supply: CFG.startSupply },
        { name: CFG.rival, human: false, score: 0, supply: CFG.startSupply }
      ],
      turn: 0, round: 1, target: CFG.target, maxRounds: CFG.maxRounds,
      maxSupply: CFG.maxSupply, deck: shuffle(CFG.deck, rng),
      lastEvent: '', over: false, winner: null, reason: '', log: [], stepCount: 0
    };
    log(state, '第 1 轮：你与' + CFG.rival + '进入' + CFG.place);
    return state;
  }

  function legalActions(state) {
    return state.over ? [] : ['advance', 'rest'];
  }

  function applyAction(state, action) {
    if (!state || state.over) throw new Error('game is over');
    if (action !== 'advance' && action !== 'rest') throw new Error('unknown action: ' + action);
    var p = state.players[state.turn];
    if (action === 'advance') {
      var key = draw(state);
      var e = EFFECTS[key];
      p.score = Math.max(0, p.score + e.score);
      p.supply = Math.max(0, Math.min(CFG.maxSupply, p.supply + e.supply));
      state.lastEvent = CFG.labels[key] || key;
      log(state, p.name + ' 深入：' + state.lastEvent + '（秘藏 ' + p.score + '，补给 ' + p.supply + '）');
      if (p.score >= CFG.target) {
        finish(state, 'p' + state.turn, p.name + ' 率先取得 ' + CFG.target + ' 分秘藏');
      }
    } else {
      p.supply = Math.min(CFG.maxSupply, p.supply + 1);
      state.lastEvent = '原地休整';
      log(state, p.name + ' 休整，补给回复到 ' + p.supply);
    }
    state.stepCount++;
    if (!state.over) {
      state.turn = 1 - state.turn;
      if (state.turn === 0) state.round++;
      if (state.round > CFG.maxRounds) finishByScore(state, '回合数用尽');
      else if (state.players[0].supply === 0 && state.players[1].supply === 0) {
        finishByScore(state, '双方补给耗尽');
      }
    }
    return state;
  }

  function aiAction(state) {
    if (!state || state.over) return null;
    var p = state.players[state.turn];
    var o = state.players[1 - state.turn];
    if (p.supply <= 1 && p.score >= o.score) return 'rest';
    if (p.supply <= 2 && state.rng() < 0.55) return 'rest';
    return 'advance';
  }

  function selfPlay(seed) {
    var g = createGame({ seed: seed });
    var guard = 0;
    while (!g.over && guard < 400) {
      applyAction(g, aiAction(g));
      guard++;
    }
    if (!g.over) throw new Error('self-play did not terminate');
    return g;
  }

  return {
    CFG: CFG, createGame: createGame, legalActions: legalActions,
    applyAction: applyAction, aiAction: aiAction, selfPlay: selfPlay
  };
});