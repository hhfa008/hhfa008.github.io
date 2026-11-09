/*
 * Stone Age（石器时代）简化版纯规则引擎 — UMD
 * 浏览器：globalThis.StoneAgeEngine；Node：require('./engine.js')
 * 工人放置采集木/砖/石/金/食物，喂食、建造与工具升级，8 轮后高分胜。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoneAgeEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ROUNDS = 8;
  var WORKERS = 5;
  var FOOD_PER_WORKER = 1;
  var MISSING_FOOD_PENALTY = 2;

  var SPOTS = [
    { id: 'wood', name: '森林', resource: 'wood', capacity: 3, perWorker: 2, glyph: '木' },
    { id: 'brick', name: '砖坑', resource: 'brick', capacity: 3, perWorker: 1, glyph: '砖' },
    { id: 'stone', name: '采石场', resource: 'stone', capacity: 3, perWorker: 1, glyph: '石' },
    { id: 'gold', name: '金矿', resource: 'gold', capacity: 2, perWorker: 1, glyph: '金' },
    { id: 'hunt', name: '猎场', resource: 'food', capacity: 3, perWorker: 1, glyph: '猎' },
    { id: 'farm', name: '农田', resource: 'food', capacity: 3, perWorker: 1, glyph: '田' }
  ];

  var RESOURCE_NAMES = { wood: '木', brick: '砖', stone: '石', gold: '金', food: '食物' };

  var BUILDINGS = [
    { id: 'hut', name: '木屋', cost: { wood: 2, brick: 1 }, points: 6 },
    { id: 'stonehouse', name: '石屋', cost: { brick: 2, stone: 1 }, points: 8 },
    { id: 'market', name: '集市', cost: { wood: 1, brick: 1, stone: 1 }, points: 9 },
    { id: 'workshop', name: '工坊', cost: { wood: 2, stone: 1 }, points: 10 },
    { id: 'temple', name: '神庙', cost: { stone: 2, gold: 1 }, points: 12 },
    { id: 'jewelry', name: '金饰', cost: { gold: 1, stone: 1 }, points: 7 },
    { id: 'cathedral', name: '大教堂', cost: { wood: 2, brick: 2, stone: 2 }, points: 15 },
    { id: 'granary', name: '粮仓', cost: { wood: 1, brick: 2, gold: 1 }, points: 11 }
  ];
  var MARKET_SIZE = 4;

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function nextRandom(st) {
    st.rng = (Math.imul(st.rng, 1664525) + 1013904223) >>> 0;
    return st.rng / 4294967296;
  }
  function shuffle(arr, st) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(nextRandom(st) * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function emptyResources() { return { wood: 0, brick: 0, stone: 0, gold: 0, food: 0 }; }
  function emptyPlacements() {
    var o = {};
    SPOTS.forEach(function (sp) { o[sp.id] = 0; });
    return o;
  }
  function spotById(id) {
    for (var i = 0; i < SPOTS.length; i++) if (SPOTS[i].id === id) return SPOTS[i];
    return null;
  }
  function buildingById(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function createGame(opts) {
    opts = opts || {};
    var seed = opts.seed == null ? 1 : opts.seed >>> 0;
    var st = {
      seed: seed, rng: seed >>> 0, round: 1, phase: 'place',
      turn: opts.humanFirst === false ? 1 : 0, firstPlayer: opts.humanFirst === false ? 1 : 0,
      placements: [emptyPlacements(), emptyPlacements()],
      workersLeft: [WORKERS, WORKERS],
      players: [
        { name: '你', resources: emptyResources(), tools: 0, score: 0, buildings: [] },
        { name: 'AI', resources: emptyResources(), tools: 0, score: 0, buildings: [] }
      ],
      market: [], buildingDeck: [], buildDone: [false, false],
      log: [], over: false, moves: 0
    };
    var deck = shuffle(BUILDINGS.map(function (b) { return b.id; }), st);
    for (var i = 0; i < MARKET_SIZE; i++) st.market.push(buildingById(BUILDINGS, deck.pop()));
    st.buildingDeck = deck;
    st.log.push('第 1 回合开始：双方各 ' + WORKERS + ' 名工人，轮流放置。');
    return st;
  }

  function totalPlaced(state, spotId) {
    return state.placements[0][spotId] + state.placements[1][spotId];
  }

  function legalMoves(state) {
    if (state.over) return [];
    var moves = [];
    if (state.phase === 'place') {
      if (state.workersLeft[state.turn] > 0) {
        SPOTS.forEach(function (sp) {
          if (totalPlaced(state, sp.id) < sp.capacity) moves.push({ type: 'place', spot: sp.id });
        });
      }
      return moves;
    }
    if (state.phase === 'build') {
      if (state.buildDone[state.turn]) return [];
      var p = state.players[state.turn];
      state.market.forEach(function (b) {
        var ok = Object.keys(b.cost).every(function (r) { return (p.resources[r] || 0) >= b.cost[r]; });
        if (ok) moves.push({ type: 'build', buildingId: b.id });
      });
      if (p.tools < 3 && p.resources.wood >= 1 && p.resources.brick >= 1) {
        moves.push({ type: 'upgradeTool' });
      }
      moves.push({ type: 'passBuild' });
      return moves;
    }
    return moves;
  }

  function collectAndFeed(s) {
    SPOTS.forEach(function (sp) {
      for (var p = 0; p < 2; p++) {
        var n = s.placements[p][sp.id];
        if (!n) continue;
        var gain = n * sp.perWorker + (s.players[p].tools > 0 ? s.players[p].tools : 0);
        s.players[p].resources[sp.resource] += gain;
        s.log.push(s.players[p].name + ' 在' + sp.name + '获得 ' + gain + ' ' + RESOURCE_NAMES[sp.resource] + '。');
      }
    });
    for (var i = 0; i < 2; i++) {
      var pl = s.players[i];
      var need = WORKERS * FOOD_PER_WORKER;
      var eaten = Math.min(pl.resources.food, need);
      pl.resources.food -= eaten;
      var missing = need - eaten;
      if (missing > 0) {
        pl.score -= missing * MISSING_FOOD_PENALTY;
        s.log.push(pl.name + ' 缺 ' + missing + ' 食物，扣 ' + (missing * MISSING_FOOD_PENALTY) + ' 分。');
      }
    }
    s.phase = 'build';
    s.turn = s.firstPlayer;
    s.buildDone = [false, false];
    s.log.push('第 ' + s.round + ' 回合进入建造阶段。');
  }

  function advanceBuild(s) {
    if (!(s.buildDone[0] && s.buildDone[1])) {
      s.turn = 1 - s.turn;
      return;
    }
    s.round += 1;
    if (s.round > ROUNDS) {
      s.over = true;
      s.log.push('第 ' + ROUNDS + ' 回合结束，游戏结束。');
      return;
    }
    s.firstPlayer = 1 - s.firstPlayer;
    s.turn = s.firstPlayer;
    s.phase = 'place';
    s.workersLeft = [WORKERS, WORKERS];
    s.placements = [emptyPlacements(), emptyPlacements()];
    s.buildDone = [false, false];
    s.log.push('第 ' + s.round + ' 回合开始，' + s.players[s.turn].name + ' 先放置。');
  }

  function applyMove(state, move) {
    if (state.over) throw new Error('游戏已结束');
    if (state.moves >= 500) throw new Error('动作数超限');
    var legal = legalMoves(state).some(function (m) {
      if (m.type !== move.type) return false;
      if (m.type === 'place') return m.spot === move.spot;
      if (m.type === 'build') return m.buildingId === move.buildingId;
      return true;
    });
    if (!legal) throw new Error('非法动作: ' + JSON.stringify(move));
    var s = clone(state);
    var p = s.players[s.turn];
    s.moves += 1;

    if (move.type === 'place') {
      var spot = spotById(move.spot);
      if (totalPlaced(s, spot.id) >= spot.capacity) throw new Error('工位已满');
      s.placements[s.turn][spot.id] += 1;
      s.workersLeft[s.turn] -= 1;
      s.log.push(p.name + ' 在' + spot.name + '放置 1 名工人。');
      if (s.workersLeft[0] === 0 && s.workersLeft[1] === 0) collectAndFeed(s);
      else s.turn = 1 - s.turn;
      return s;
    }

    if (move.type === 'build') {
      var b = buildingById(s.market, move.buildingId);
      if (!b) throw new Error('建筑不存在');
      Object.keys(b.cost).forEach(function (r) { p.resources[r] -= b.cost[r]; });
      p.score += b.points;
      p.buildings.push(b.id);
      s.market = s.market.filter(function (x) { return x.id !== b.id; });
      if (s.buildingDeck.length) s.market.push(buildingById(BUILDINGS, s.buildingDeck.pop()));
      s.log.push(p.name + ' 建造' + b.name + '，得 ' + b.points + ' 分。');
      s.buildDone[s.turn] = true;
      advanceBuild(s);
      return s;
    }

    if (move.type === 'upgradeTool') {
      p.resources.wood -= 1;
      p.resources.brick -= 1;
      p.tools += 1;
      s.log.push(p.name + ' 升级工具到 ' + p.tools + ' 级。');
      s.buildDone[s.turn] = true;
      advanceBuild(s);
      return s;
    }

    if (move.type === 'passBuild') {
      s.log.push(p.name + ' 跳过建造。');
      s.buildDone[s.turn] = true;
      advanceBuild(s);
      return s;
    }
    throw new Error('未知动作');
  }

  function score(state) {
    return { human: state.players[0].score, ai: state.players[1].score };
  }
  function isOver(state) { return !!state.over; }
  function winner(state) {
    var sc = score(state);
    if (sc.human === sc.ai) return 'tie';
    return sc.human > sc.ai ? 'human' : 'ai';
  }

  function affordableList(state, player) {
    return state.market.filter(function (b) {
      return Object.keys(b.cost).every(function (r) { return player.resources[r] >= b.cost[r]; });
    });
  }

  function aiMove(state) {
    var legal = legalMoves(state);
    if (!legal.length) throw new Error('无合法动作');
    var me = state.players[state.turn];

    if (state.phase === 'place') {
      var foodPlaced = (state.placements[state.turn].hunt + state.placements[state.turn].farm) * 1 +
        state.placements[1 - state.turn].hunt + state.placements[1 - state.turn].farm;
      var food = me.resources.food + foodPlaced;
      var options = legal.filter(function (m) { return m.type === 'place'; });
      function scoreSpot(m) {
        var sp = spotById(m.spot);
        if (sp.resource === 'food') return food < 5 ? 100 : 25;
        var need = 3;
        var bestBuilding = affordableList(state, me)[0];
        if (bestBuilding) {
          var deficit = 0;
          Object.keys(bestBuilding.cost).forEach(function (r) {
            deficit += Math.max(0, bestBuilding.cost[r] - me.resources[r]);
          });
          need = deficit > 0 ? 40 : 20;
        }
        if (sp.id === 'gold') return need + 12;
        if (sp.id === 'wood') return need + 8;
        if (sp.id === 'brick') return need + 6;
        if (sp.id === 'stone') return need + 5;
        return need;
      }
      options.sort(function (x, y) { return scoreSpot(y) - scoreSpot(x); });
      return options[0];
    }

    if (state.phase === 'build') {
      var buildable = legal.filter(function (m) { return m.type === 'build'; });
      buildable.sort(function (x, y) {
        return buildingById(state.market, y.buildingId).points - buildingById(state.market, x.buildingId).points;
      });
      if (buildable.length) return buildable[0];
      if (legal.some(function (m) { return m.type === 'upgradeTool'; }) && state.round <= 5) {
        return { type: 'upgradeTool' };
      }
      return { type: 'passBuild' };
    }
    return legal[0];
  }

  return {
    SPOTS: SPOTS, BUILDINGS: BUILDINGS, RESOURCE_NAMES: RESOURCE_NAMES,
    ROUNDS: ROUNDS, WORKERS: WORKERS, MARKET_SIZE: MARKET_SIZE,
    createGame: createGame, legalMoves: legalMoves, applyMove: applyMove,
    aiMove: aiMove, isOver: isOver, score: score, winner: winner,
    spotById: spotById, buildingById: buildingById
  };
});
