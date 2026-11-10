/* Pioneers of Nine Isles — premium UMD rules engine.
 *
 * Node:    const E = require('./engine.js');
 * Browser: window.PioneersPremiumEngine (include ../../shared/shuffle.js first)
 *
 * Board
 *   19 pointy-top hexes in rows of 3-4-5-4-3, axial coordinates.
 *   6 wheat, 6 stone, 6 wood, 1 neutral frost hollow.
 *   18 number tokens: 2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12.
 *   No 7 token. A die total of 7 produces nothing and simply moves on;
 *   this game has no robber (the frost hollow is a quiet hex, not a robber).
 *   Four 2:1 tidegate ports sit on coastal edges; the bank trades 3:1.
 *
 * Pieces
 *   road     1 wood + 1 stone           max 10
 *   village  1 wheat + 1 stone + 1 wood max 5   +1 point
 *   city     2 wheat + 3 stone          max 3   +2 points
 *   Villages/cities may not share an edge (distance rule). Roads must connect
 *   to your own road or building.
 *
 * Flow
 *   Snake setup: everyone places village+road, then in reverse order a second
 *   village+road. The second village immediately yields one resource for each
 *   adjacent producing hex.
 *   Each turn: roll -> production -> any number of builds/trades -> end turn.
 *   Settlements produce 3, cities 5 (this original game's calibrated rates).
 *   First to 8 points wins immediately; otherwise the highest score after
 *   round 12 wins. There are no development cards and no longest-road bonus.
 *
 * Determinism
 *   Terrain/token shuffles use games/shared/shuffle.js (seeded Fisher-Yates).
 *   Dice use a stateful xorshift stream kept in `state.rngState`. That stream
 *   never appears in publicView(), so a client cannot predict future rolls.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PioneersPremiumEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('PioneersPremiumEngine requires games/shared/shuffle.js');
  }

  var RESOURCES = ['wheat', 'stone', 'wood'];
  var TERRAINS = ['wheat', 'stone', 'wood', 'neutral'];
  var RESOURCE_NAME = { wheat: '麦', stone: '石', wood: '木' };
  var TERRAIN_NAME = { wheat: '麦田', stone: '石山', wood: '林地', neutral: '霜洞' };
  var COSTS = {
    road: { wood: 1, stone: 1 },
    settlement: { wheat: 1, stone: 1, wood: 1 },
    city: { wheat: 2, stone: 3 }
  };
  var WIN_POINTS = 8;
  var MAX_ROUNDS = 12;
  var MAX_SETTLEMENTS = 5;
  var MAX_CITIES = 3;
  var MAX_ROADS = 10;
  var TRADE_BASE = 3;
  var TRADE_PORT = 2;
  var PRODUCTION_SETTLEMENT = 3;
  var PRODUCTION_CITY = 5;
  var PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  var TOKEN_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  var PLAYER_COLORS = ['#c44536', '#2f6fb0', '#3f8f62', '#c98a2e'];
  var DEFAULT_NAMES = ['赤帆', '蓝港', '青禾', '金穗'];
  var HEX_DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  var R = 1;
  var W = Math.sqrt(3) * R;
  var MAX_STEPS_PER_TURN = 40;

  function round3(n) { return Math.round(n * 1000) / 1000; }
  function pointKey(x, y) { return round3(x) + ',' + round3(y); }
  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function cloneResources(r) { return { wheat: r.wheat, stone: r.stone, wood: r.wood }; }
  function totalResources(r) { return r.wheat + r.stone + r.wood; }
  function resourceList(r) {
    return RESOURCES.map(function (k) { return k + ' ' + r[k]; }).join(' · ');
  }
  function hashSeed(seed) {
    if (typeof ShuffleApi.hashSeed === 'function') return ShuffleApi.hashSeed(seed) >>> 0;
    var str = String(seed);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /* Small stateful RNG for dice / tie-breaks. State lives in the server-side
     state object and is deliberately omitted from publicView(). */
  function nextRandom(state) {
    var x = state.rngState | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    state.rngState = x | 0;
    return (x >>> 0) / 4294967296;
  }
  function localRng(seed) {
    var a = (seed | 0) || 1;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* --------------------------------------------------------------- geometry */

  function buildGeometry() {
    var hexes = [];
    var r, q, qmin, qmax;
    for (r = -2; r <= 2; r++) {
      qmin = Math.max(-2, -2 - r);
      qmax = Math.min(2, 2 - r);
      for (q = qmin; q <= qmax; q++) {
        hexes.push({
          id: 'h' + q + ',' + r, q: q, r: r,
          x: round3(W * (q + r / 2)), y: round3(1.5 * R * r),
          vertices: [], edges: []
        });
      }
    }

    var vmap = new Map();
    var emap = new Map();
    var cornerRel = [
      [W / 2, R / 2], [0, R], [-W / 2, R / 2],
      [-W / 2, -R / 2], [0, -R], [W / 2, -R / 2]
    ];

    hexes.forEach(function (h) {
      var vs = cornerRel.map(function (c) { return pointKey(h.x + c[0], h.y + c[1]); });
      h.vertices = vs.slice();
      vs.forEach(function (vk) {
        if (!vmap.has(vk)) vmap.set(vk, { key: vk, hexes: [], edges: [] });
        vmap.get(vk).hexes.push(h.id);
      });
      for (var i = 0; i < 6; i++) {
        var a = vs[i], b = vs[(i + 1) % 6];
        var k = edgeKey(a, b);
        if (!emap.has(k)) emap.set(k, { key: k, vertices: [a, b].sort(), hexes: [] });
        emap.get(k).hexes.push(h.id);
        h.edges.push(k);
        vmap.get(a).edges.push(k);
        vmap.get(b).edges.push(k);
      }
    });

    vmap.forEach(function (v) {
      v.edges = Array.from(new Set(v.edges));
      var xy = v.key.split(',');
      v.x = Number(xy[0]); v.y = Number(xy[1]);
    });
    emap.forEach(function (e) {
      e.hexes = Array.from(new Set(e.hexes));
      var va = vmap.get(e.vertices[0]), vb = vmap.get(e.vertices[1]);
      e.mid = { x: round3((va.x + vb.x) / 2), y: round3((va.y + vb.y) / 2) };
    });

    var coastal = Array.from(emap.values()).filter(function (e) { return e.hexes.length === 1; });
    coastal.sort(function (a, b) {
      return Math.atan2(a.mid.y, a.mid.x) - Math.atan2(b.mid.y, b.mid.x);
    });
    var ports = [];
    var n = coastal.length;
    [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)].forEach(function (idx, i) {
      var e = coastal[idx];
      if (!e) return;
      var port = { id: 'p' + i, edge: e.key, vertices: e.vertices.slice(), mid: { x: e.mid.x, y: e.mid.y }, ratio: TRADE_PORT };
      ports.push(port);
      e.port = port.id;
    });

    return { hexes: hexes, vmap: vmap, emap: emap, ports: ports };
  }

  function hexNeighbors(hexes) {
    var index = {};
    hexes.forEach(function (h) { index[h.q + ',' + h.r] = h; });
    var map = {};
    hexes.forEach(function (h) {
      map[h.id] = HEX_DIRS.map(function (d) {
        var n = index[(h.q + d[0]) + ',' + (h.r + d[1])];
        return n ? n.id : null;
      }).filter(Boolean);
    });
    return map;
  }

  /* ---------------------------------------------------------- board builder */

  function buildBoard(seed) {
    var geo = buildGeometry();
    var hexes = geo.hexes;
    var neighbors = hexNeighbors(hexes);
    var base = [];
    var i;
    for (i = 0; i < 6; i++) base.push('wheat');
    for (i = 0; i < 6; i++) base.push('stone');
    for (i = 0; i < 6; i++) base.push('wood');
    base.push('neutral');

    var terrains = null, tokens = null, attempt = 0;
    do {
      terrains = ShuffleApi.shuffle(base, { seed: String(seed) + ':terrain:' + attempt });
      tokens = ShuffleApi.shuffle(TOKEN_POOL, { seed: String(seed) + ':token:' + attempt });
      attempt += 1;
    } while (attempt < 500 && hasAdjacentHighTokens(hexes, neighbors, terrains, tokens));

    var ti = 0;
    hexes.forEach(function (h, idx) {
      h.terrain = terrains[idx];
      h.number = h.terrain === 'neutral' ? null : tokens[ti++];
      h.pips = h.number == null ? 0 : (PIPS[h.number] || 0);
    });

    var hexMap = {};
    hexes.forEach(function (h) { hexMap[h.id] = h; });
    var vertices = Array.from(geo.vmap.values()).map(function (v) {
      return { key: v.key, x: v.x, y: v.y, hexes: v.hexes.slice(), edges: v.edges.slice() };
    });
    vertices.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
    var edges = Array.from(geo.emap.values()).map(function (e) {
      return {
        key: e.key, vertices: e.vertices.slice(), hexes: e.hexes.slice(),
        mid: { x: e.mid.x, y: e.mid.y }, port: e.port || null
      };
    });
    edges.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });

    return {
      hexes: hexMap,
      hexList: hexes,
      neighbors: neighbors,
      geo: geo,
      vertices: vertices,
      edges: edges,
      ports: geo.ports.map(function (p) {
        return { id: p.id, edge: p.edge, vertices: p.vertices.slice(), mid: { x: p.mid.x, y: p.mid.y }, ratio: p.ratio };
      })
    };
  }

  function hasAdjacentHighTokens(hexes, neighbors, terrains, tokens) {
    var tokenOf = {};
    var ti = 0;
    hexes.forEach(function (h, idx) {
      if (terrains[idx] !== 'neutral') tokenOf[h.id] = tokens[ti++];
    });
    for (var i = 0; i < hexes.length; i++) {
      var h = hexes[i];
      var a = tokenOf[h.id];
      if (a !== 6 && a !== 8) continue;
      var ns = neighbors[h.id] || [];
      for (var j = 0; j < ns.length; j++) {
        var b = tokenOf[ns[j]];
        if (b === 6 || b === 8) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------- state factories */

  function createGame(opts) {
    opts = opts || {};
    var count = Math.max(2, Math.min(4, Number(opts.players) || 2));
    var humans = opts.humans == null ? count : Math.max(0, Math.min(count, Number(opts.humans)));
    var seed = opts.seed == null ? 20261110 : opts.seed;
    var names = opts.names || DEFAULT_NAMES;
    var board = buildBoard(seed);
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({
        id: i,
        name: names[i] || DEFAULT_NAMES[i] || ('拓荒者 ' + (i + 1)),
        color: PLAYER_COLORS[i],
        ai: i >= humans,
        resources: { wheat: 0, stone: 0, wood: 0 },
        settlements: [],
        cities: [],
        roads: [],
        score: 0,
        portEdges: []
      });
    }
    var round1 = [], round2 = [];
    for (var a = 0; a < count; a++) round1.push(a);
    for (var b = count - 1; b >= 0; b--) round2.push(b);
    var order = round1.concat(round2);
    var g = {
      version: 1,
      seed: opts.seed === undefined ? null : opts.seed,
      rngState: hashSeed(seed) | 1,
      board: board,
      geo: board.geo,
      hexes: board.hexes,
      hexList: board.hexList,
      neighbors: board.neighbors,
      ports: board.ports,
      players: players,
      current: order[0],
      phase: 'setup',
      setup: { order: order, index: 0, round: 1, step: 'settlement', lastSettlement: null },
      round: 1,
      maxRounds: MAX_ROUNDS,
      turnStage: 'roll',
      turnActions: 0,
      dice: null,
      lastSum: null,
      lastRoll: null,
      log: [],
      events: [],
      winners: [],
      winner: null,
      result: null,
      over: false,
      settings: {
        players: count,
        humans: humans,
        ais: count - humans,
        winPoints: WIN_POINTS,
        maxRounds: MAX_ROUNDS,
        maxSettlements: MAX_SETTLEMENTS,
        maxCities: MAX_CITIES,
        maxRoads: MAX_ROADS,
        productionSettlement: PRODUCTION_SETTLEMENT,
        productionCity: PRODUCTION_CITY,
        tradeBase: TRADE_BASE,
        tradePort: TRADE_PORT
      }
    };
    addLog(g, '九岛展开：19 块尖顶六边形，麦/石/木各 6，中央 1 块霜洞。');
    addLog(g, '蛇形开局：每人先放村庄与道路，再按逆序放第二个村庄与道路。');
    emit(g, { type: 'start', players: count, seed: g.seed });
    return g;
  }

  function clone(state) {
    return {
      version: state.version,
      seed: state.seed,
      rngState: state.rngState,
      board: state.board,
      geo: state.geo,
      hexes: state.hexes,
      hexList: state.hexList,
      neighbors: state.neighbors,
      ports: state.ports,
      players: state.players.map(function (p) {
        return {
          id: p.id, name: p.name, color: p.color, ai: p.ai,
          resources: cloneResources(p.resources),
          settlements: p.settlements.slice(),
          cities: p.cities.slice(),
          roads: p.roads.slice(),
          score: p.score,
          portEdges: p.portEdges.slice()
        };
      }),
      current: state.current,
      phase: state.phase,
      setup: {
        order: state.setup.order.slice(),
        index: state.setup.index,
        round: state.setup.round,
        step: state.setup.step,
        lastSettlement: state.setup.lastSettlement
      },
      round: state.round,
      maxRounds: state.maxRounds,
      turnStage: state.turnStage,
      turnActions: state.turnActions,
      dice: state.dice ? state.dice.slice() : null,
      lastSum: state.lastSum,
      lastRoll: state.lastRoll ? JSON.parse(JSON.stringify(state.lastRoll)) : null,
      log: state.log.slice(),
      events: state.events.slice(),
      winners: state.winners.slice(),
      winner: state.winner,
      result: state.result,
      over: state.over,
      settings: JSON.parse(JSON.stringify(state.settings))
    };
  }

  function addLog(g, text) {
    g.log.push(text);
    if (g.log.length > 160) g.log.shift();
  }
  function emit(g, event) {
    g.events.push(event);
    if (g.events.length > 120) g.events.shift();
  }

  /* --------------------------------------------------------------- helpers */

  function getStructureAt(g, vk) {
    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      if (p.settlements.indexOf(vk) !== -1) return { player: p, type: 'settlement' };
      if (p.cities.indexOf(vk) !== -1) return { player: p, type: 'city' };
    }
    return null;
  }

  function vertexNeighbors(g, vk) {
    var v = g.geo.vmap.get(vk);
    if (!v) return [];
    var out = [];
    v.edges.forEach(function (ek) {
      var e = g.geo.emap.get(ek);
      if (!e) return;
      var other = e.vertices[0] === vk ? e.vertices[1] : e.vertices[0];
      if (out.indexOf(other) === -1) out.push(other);
    });
    return out;
  }

  function structureCount(p) { return p.settlements.length + p.cities.length; }
  function hasResources(p, cost) {
    for (var k in cost) if (Object.prototype.hasOwnProperty.call(cost, k) && p.resources[k] < cost[k]) return false;
    return true;
  }
  function missingResources(p, cost) {
    var miss = {};
    for (var k in cost) {
      if (!Object.prototype.hasOwnProperty.call(cost, k)) continue;
      var d = cost[k] - p.resources[k];
      if (d > 0) miss[k] = d;
    }
    return miss;
  }
  function pay(p, cost) {
    for (var k in cost) if (Object.prototype.hasOwnProperty.call(cost, k)) p.resources[k] -= cost[k];
  }
  function recomputeScore(p) {
    p.score = p.settlements.length + p.cities.length * 2;
    return p.score;
  }
  function isPortEdge(g, ek) {
    return g.ports.some(function (p) { return p.edge === ek; });
  }
  function playerPortEdges(g, player) {
    var out = [];
    g.ports.forEach(function (port) {
      for (var i = 0; i < port.vertices.length; i++) {
        var s = getStructureAt(g, port.vertices[i]);
        if (s && s.player.id === player.id) { out.push(port.edge); break; }
      }
    });
    return out;
  }
  function tradeRate(g, player) {
    return playerPortEdges(g, player).length > 0 ? TRADE_PORT : TRADE_BASE;
  }
  function refreshPortEdges(g) {
    g.players.forEach(function (p) { p.portEdges = playerPortEdges(g, p); });
  }
  function vertexProduction(g, vk) {
    var v = g.geo.vmap.get(vk);
    var list = [];
    if (!v) return list;
    v.hexes.forEach(function (hid) {
      var h = g.hexes[hid];
      if (h && h.number != null && h.terrain !== 'neutral') list.push({ hex: h, pips: PIPS[h.number] || 0 });
    });
    return list;
  }
  function vertexValue(g, vk) {
    var prod = vertexProduction(g, vk);
    var value = 0, kinds = {};
    prod.forEach(function (x) {
      value += x.pips;
      kinds[x.hex.terrain] = true;
    });
    value += Object.keys(kinds).length * 0.6;
    var v = g.geo.vmap.get(vk);
    if (v && v.edges.some(function (ek) { return isPortEdge(g, ek); })) value += 1.8;
    return value;
  }
  function longestRoad(g, player) {
    var adj = {};
    var edgeList = [];
    player.roads.forEach(function (ek, idx) {
      var e = g.geo.emap.get(ek);
      if (!e) return;
      var a = e.vertices[0], b = e.vertices[1];
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      adj[a].push({ to: b, i: idx });
      adj[b].push({ to: a, i: idx });
      edgeList.push(ek);
    });
    if (!edgeList.length) return 0;
    var best = 0;
    function walk(v, used, n) {
      if (n > best) best = n;
      var links = adj[v] || [];
      for (var i = 0; i < links.length; i++) {
        if (used[links[i].i]) continue;
        used[links[i].i] = 1;
        walk(links[i].to, used, n + 1);
        used[links[i].i] = 0;
      }
    }
    var starts = Object.keys(adj);
    for (var s = 0; s < starts.length; s++) {
      walk(starts[s], {}, 0);
      if (best >= player.roads.length) break;
    }
    return best;
  }

  /* ---------------------------------------------------------------- setup */

  function validateSetupSettlement(g, vk) {
    if (g.phase !== 'setup' || g.setup.step !== 'settlement') return { ok: false, error: 'wrongPhase' };
    if (!g.geo.vmap.get(vk)) return { ok: false, error: 'badVertex' };
    if (getStructureAt(g, vk)) return { ok: false, error: 'occupied' };
    var ns = vertexNeighbors(g, vk);
    for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return { ok: false, error: 'tooClose' };
    return { ok: true };
  }

  function setupResourceGain(g, player, vk) {
    var gains = { wheat: 0, stone: 0, wood: 0 };
    vertexProduction(g, vk).forEach(function (x) {
      var t = x.hex.terrain;
      if (RESOURCES.indexOf(t) === -1) return;
      player.resources[t] += 1;
      gains[t] += 1;
    });
    return gains;
  }

  function placeSetupSettlement(g, vk) {
    var v = validateSetupSettlement(g, vk);
    if (!v.ok) return v;
    var p = g.players[g.current];
    p.settlements.push(vk);
    recomputeScore(p);
    g.setup.lastSettlement = vk;
    g.setup.step = 'road';
    var result = { ok: true, vertex: vk, player: p.id, gains: null, score: p.score };
    addLog(g, p.name + ' 放下第 ' + (g.setup.round === 1 ? '一' : '二') + ' 个村庄。');
    if (g.setup.round === 2) {
      var gains = setupResourceGain(g, p, vk);
      result.gains = gains;
      var n = gains.wheat + gains.stone + gains.wood;
      if (n > 0) addLog(g, p.name + ' 的第二个村庄获得麦 ' + gains.wheat + '、石 ' + gains.stone + '、木 ' + gains.wood + '。');
    }
    emit(g, { type: 'setupSettlement', player: p.id, vertex: vk, round: g.setup.round, gains: result.gains });
    return result;
  }

  function validateSetupRoad(g, ek) {
    if (g.phase !== 'setup' || g.setup.step !== 'road') return { ok: false, error: 'wrongPhase' };
    var e = g.geo.emap.get(ek);
    if (!e) return { ok: false, error: 'badEdge' };
    if (g.players.some(function (p) { return p.roads.indexOf(ek) !== -1; })) return { ok: false, error: 'occupied' };
    if (e.vertices.indexOf(g.setup.lastSettlement) === -1) return { ok: false, error: 'notConnected' };
    return { ok: true };
  }

  function placeSetupRoad(g, ek) {
    var v = validateSetupRoad(g, ek);
    if (!v.ok) return v;
    var p = g.players[g.current];
    p.roads.push(ek);
    addLog(g, p.name + ' 沿新村庄铺下道路。');
    emit(g, { type: 'setupRoad', player: p.id, edge: ek });
    g.setup.lastSettlement = null;
    g.setup.index += 1;
    if (g.setup.index >= g.setup.order.length) {
      finishSetup(g);
      return { ok: true, edge: ek, setupDone: true };
    }
    if (g.setup.index === g.players.length) {
      g.setup.round = 2;
      addLog(g, '第一轮摆放完成，按逆序开始第二轮。');
    }
    g.current = g.setup.order[g.setup.index];
    g.setup.step = 'settlement';
    return { ok: true, edge: ek, setupDone: false };
  }

  function finishSetup(g) {
    g.phase = 'play';
    g.current = 0;
    g.round = 1;
    g.turnStage = 'roll';
    g.turnActions = 0;
    g.setup.step = 'done';
    addLog(g, '摆放结束，第一回合开始：掷两颗骰子。');
    emit(g, { type: 'play', round: 1 });
  }

  /* ------------------------------------------------------------ play rules */

  function connectedToNetwork(g, player, vk) {
    var v = g.geo.vmap.get(vk);
    if (!v) return false;
    var s = getStructureAt(g, vk);
    if (s && s.player.id === player.id) return true;
    return v.edges.some(function (ek) { return player.roads.indexOf(ek) !== -1; });
  }

  function legalRoadEdges(g, player) {
    var out = [];
    g.geo.emap.forEach(function (e) {
      if (e.port === undefined) { /* ports are edges too */ }
      if (player.roads.indexOf(e.key) !== -1) return;
      if (g.players.some(function (p) { return p.roads.indexOf(e.key) !== -1; })) return;
      var connected = e.vertices.some(function (vk) {
        var s = getStructureAt(g, vk);
        if (s && s.player.id === player.id) return true;
        var v = g.geo.vmap.get(vk);
        return v.edges.some(function (other) { return player.roads.indexOf(other) !== -1; });
      });
      if (connected) out.push(e.key);
    });
    return out;
  }

  function legalSettlementVertices(g, player) {
    var out = [];
    g.geo.vmap.forEach(function (v, vk) {
      if (validateSettlement(g, player, vk).ok) out.push(vk);
    });
    return out;
  }

  function validateRoad(g, player, ek) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    var e = g.geo.emap.get(ek);
    if (!e) return { ok: false, error: 'badEdge' };
    if (player.roads.length >= MAX_ROADS) return { ok: false, error: 'maxRoads' };
    if (g.players.some(function (p) { return p.roads.indexOf(ek) !== -1; })) return { ok: false, error: 'occupied' };
    if (!hasResources(player, COSTS.road)) return { ok: false, error: 'needResources' };
    if (legalRoadEdges(g, player).indexOf(ek) === -1) return { ok: false, error: 'notConnected' };
    return { ok: true };
  }

  function validateSettlement(g, player, vk) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    if (!g.geo.vmap.get(vk)) return { ok: false, error: 'badVertex' };
    if (player.settlements.length >= MAX_SETTLEMENTS) return { ok: false, error: 'maxSettlements' };
    if (getStructureAt(g, vk)) return { ok: false, error: 'occupied' };
    var ns = vertexNeighbors(g, vk);
    for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return { ok: false, error: 'tooClose' };
    if (!hasResources(player, COSTS.settlement)) return { ok: false, error: 'needResources' };
    var v = g.geo.vmap.get(vk);
    var connected = v.edges.some(function (ek) { return player.roads.indexOf(ek) !== -1; });
    if (!connected) return { ok: false, error: 'notConnected' };
    return { ok: true };
  }

  function validateCity(g, player, vk) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    if (!g.geo.vmap.get(vk)) return { ok: false, error: 'badVertex' };
    if (player.cities.length >= MAX_CITIES) return { ok: false, error: 'maxCities' };
    var s = getStructureAt(g, vk);
    if (!s) return { ok: false, error: 'badVertex' };
    if (s.player.id !== player.id || s.type !== 'settlement') return { ok: false, error: 'notYourSettlement' };
    if (!hasResources(player, COSTS.city)) return { ok: false, error: 'needResources' };
    return { ok: true };
  }

  function validateExchange(g, player, give, get) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    if (RESOURCES.indexOf(give) === -1 || RESOURCES.indexOf(get) === -1) return { ok: false, error: 'badResource' };
    if (give === get) return { ok: false, error: 'sameResource' };
    var rate = tradeRate(g, player);
    if (player.resources[give] < rate) return { ok: false, error: 'needResources' };
    return { ok: true };
  }

  function buildRoad(g, ek) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    var p = g.players[g.current];
    var v = validateRoad(g, p, ek);
    if (!v.ok) return v;
    pay(p, COSTS.road);
    p.roads.push(ek);
    g.turnActions += 1;
    addLog(g, p.name + ' 铺路一条。');
    emit(g, { type: 'road', player: p.id, edge: ek });
    return { ok: true, edge: ek, roadCount: p.roads.length };
  }

  function buildSettlement(g, vk) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    var p = g.players[g.current];
    var v = validateSettlement(g, p, vk);
    if (!v.ok) return v;
    pay(p, COSTS.settlement);
    p.settlements.push(vk);
    recomputeScore(p);
    p.portEdges = playerPortEdges(g, p);
    g.turnActions += 1;
    addLog(g, p.name + ' 建村庄，得分 ' + p.score + '。');
    emit(g, { type: 'settlement', player: p.id, vertex: vk, score: p.score });
    if (p.score >= WIN_POINTS) { finishPoints(g, p); return { ok: true, vertex: vk, score: p.score, over: true }; }
    return { ok: true, vertex: vk, score: p.score, over: false };
  }

  function upgradeCity(g, vk) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    var p = g.players[g.current];
    var v = validateCity(g, p, vk);
    if (!v.ok) return v;
    pay(p, COSTS.city);
    var idx = p.settlements.indexOf(vk);
    if (idx >= 0) p.settlements.splice(idx, 1);
    p.cities.push(vk);
    recomputeScore(p);
    p.portEdges = playerPortEdges(g, p);
    g.turnActions += 1;
    addLog(g, p.name + ' 把村庄升级为城市，得分 ' + p.score + '。');
    emit(g, { type: 'city', player: p.id, vertex: vk, score: p.score });
    if (p.score >= WIN_POINTS) { finishPoints(g, p); return { ok: true, vertex: vk, score: p.score, over: true }; }
    return { ok: true, vertex: vk, score: p.score, over: false };
  }

  function exchange(g, give, get) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    var p = g.players[g.current];
    var v = validateExchange(g, p, give, get);
    if (!v.ok) return v;
    var rate = tradeRate(g, p);
    p.resources[give] -= rate;
    p.resources[get] += 1;
    g.turnActions += 1;
    addLog(g, p.name + ' 以 ' + rate + ':1 把 ' + RESOURCE_NAME[give] + ' 换成 ' + RESOURCE_NAME[get] + '。');
    emit(g, { type: 'exchange', player: p.id, give: give, get: get, rate: rate });
    return { ok: true, give: give, get: get, rate: rate };
  }

  /* ------------------------------------------------------------ dice/play */

  function diceValue(state) {
    return 1 + Math.floor(nextRandom(state) * 6);
  }

  function roll(g, d1, d2) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'roll') return { ok: false, error: 'wrongStage' };
    d1 = d1 == null ? diceValue(g) : d1;
    d2 = d2 == null ? diceValue(g) : d2;
    if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) return { ok: false, error: 'badDice' };
    var p = g.players[g.current];
    var sum = d1 + d2;
    g.dice = [d1, d2];
    g.lastSum = sum;
    g.turnStage = 'action';
    g.turnActions = 0;
    addLog(g, p.name + ' 掷出 ' + d1 + ' + ' + d2 + ' = ' + sum + '。');
    if (sum === 7) {
      g.lastRoll = { sum: sum, seven: true, gains: {} };
      addLog(g, '霜洞笼罩：本轮不产资源。本作使用简化霜洞，不设强盗。');
      emit(g, { type: 'roll', player: p.id, dice: [d1, d2], sum: sum, seven: true, gains: {} });
      return { ok: true, sum: sum, seven: true, gains: {} };
    }
    var gains = {};
    g.players.forEach(function (pl) {
      var gs = { wheat: 0, stone: 0, wood: 0 };
      pl.settlements.forEach(function (vk) { addProduction(g, pl, vk, sum, PRODUCTION_SETTLEMENT, gs); });
      pl.cities.forEach(function (vk) { addProduction(g, pl, vk, sum, PRODUCTION_CITY, gs); });
      var any = gs.wheat + gs.stone + gs.wood;
      if (any > 0) {
        gains[pl.id] = gs;
        addLog(g, pl.name + ' 获得麦 ' + gs.wheat + '、石 ' + gs.stone + '、木 ' + gs.wood + '。');
      }
    });
    if (Object.keys(gains).length === 0) addLog(g, '没有建筑匹配 ' + sum + ' 点，本轮无人获得资源。');
    g.lastRoll = { sum: sum, seven: false, gains: gains };
    emit(g, { type: 'roll', player: p.id, dice: [d1, d2], sum: sum, seven: false, gains: gains });
    return { ok: true, sum: sum, seven: false, gains: gains };
  }

  function addProduction(g, player, vk, sum, amount, gains) {
    var v = g.geo.vmap.get(vk);
    if (!v) return;
    v.hexes.forEach(function (hid) {
      var h = g.hexes[hid];
      if (!h || h.number !== sum || h.terrain === 'neutral') return;
      player.resources[h.terrain] += amount;
      gains[h.terrain] += amount;
    });
  }

  function endTurn(g) {
    if (g.phase !== 'play') return { ok: false, error: 'wrongPhase' };
    if (g.turnStage !== 'action') return { ok: false, error: 'wrongStage' };
    g.current += 1;
    g.dice = null;
    g.lastSum = null;
    g.lastRoll = null;
    g.turnActions = 0;
    if (g.current >= g.players.length) {
      g.current = 0;
      g.round += 1;
      if (g.round > MAX_ROUNDS) {
        finishRounds(g);
        return { ok: true, over: true };
      }
      addLog(g, '第 ' + g.round + ' 回合开始。');
    }
    g.turnStage = 'roll';
    return { ok: true, over: false, round: g.round, current: g.current };
  }

  function finishPoints(g, player) {
    g.phase = 'over';
    g.over = true;
    g.result = 'points';
    g.winner = player.id;
    g.winners = [player.id];
    addLog(g, player.name + ' 达到 ' + player.score + ' 分，对局结束。');
    emit(g, { type: 'over', winner: player.id, result: 'points', score: player.score });
  }

  function finishRounds(g) {
    var max = Math.max.apply(null, g.players.map(function (p) { return p.score; }));
    var winners = g.players.filter(function (p) { return p.score === max; }).map(function (p) { return p.id; });
    g.phase = 'over';
    g.over = true;
    g.result = winners.length > 1 ? 'draw' : 'rounds';
    g.winners = winners;
    g.winner = winners.length === 1 ? winners[0] : null;
    if (winners.length > 1) addLog(g, '12 回合结束，' + winners.length + ' 位拓荒者同分 ' + max + '，并列。');
    else addLog(g, '12 回合结束，' + g.players[winners[0]].name + ' 以 ' + max + ' 分获胜。');
    emit(g, { type: 'over', winners: winners.slice(), result: g.result, score: max });
  }

  /* ----------------------------------------------------------- action API */

  function legalActions(g) {
    var out = [];
    if (!g || g.phase === 'over') return out;
    if (g.phase === 'setup') {
      if (g.setup.step === 'settlement') {
        g.geo.vmap.forEach(function (v, vk) {
          if (validateSetupSettlement(g, vk).ok) out.push({ k: 'setupSettlement', vertex: vk });
        });
      } else if (g.setup.step === 'road') {
        g.geo.emap.forEach(function (e) {
          if (validateSetupRoad(g, e.key).ok) out.push({ k: 'setupRoad', edge: e.key });
        });
      }
      return out;
    }
    if (g.turnStage === 'roll') return [{ k: 'roll' }];
    var p = g.players[g.current];
    p.settlements.forEach(function (vk) {
      if (validateCity(g, p, vk).ok) out.push({ k: 'upgradeCity', vertex: vk });
    });
    g.geo.vmap.forEach(function (v, vk) {
      if (validateSettlement(g, p, vk).ok) out.push({ k: 'buildSettlement', vertex: vk });
    });
    g.geo.emap.forEach(function (e) {
      if (validateRoad(g, p, e.key).ok) out.push({ k: 'buildRoad', edge: e.key });
    });
    var rate = tradeRate(g, p);
    RESOURCES.forEach(function (give) {
      if (p.resources[give] < rate) return;
      RESOURCES.forEach(function (get) {
        if (get !== give) out.push({ k: 'exchange', give: give, get: get, rate: rate });
      });
    });
    out.push({ k: 'endTurn' });
    return out;
  }

  function legalActionsForSeat(g, seat) {
    if (!g || g.phase === 'over' || g.current !== seat) return [];
    return legalActions(g);
  }

  function isLegal(g, action) {
    if (!action || !g || g.phase === 'over') return false;
    if (action.k === 'setupSettlement') return validateSetupSettlement(g, action.vertex).ok;
    if (action.k === 'setupRoad') return validateSetupRoad(g, action.edge).ok;
    if (g.phase !== 'play') return false;
    if (action.k === 'roll') return g.turnStage === 'roll';
    if (action.k === 'buildRoad') return validateRoad(g, g.players[g.current], action.edge).ok;
    if (action.k === 'buildSettlement') return validateSettlement(g, g.players[g.current], action.vertex).ok;
    if (action.k === 'upgradeCity') return validateCity(g, g.players[g.current], action.vertex).ok;
    if (action.k === 'exchange') return validateExchange(g, g.players[g.current], action.give, action.get).ok;
    if (action.k === 'endTurn') return g.turnStage === 'action';
    return false;
  }

  function applyAction(g, action) {
    if (!isLegal(g, action)) {
      return { ok: false, error: 'illegal action', code: 'E_MOVE' };
    }
    var res;
    if (action.k === 'setupSettlement') res = placeSetupSettlement(g, action.vertex);
    else if (action.k === 'setupRoad') res = placeSetupRoad(g, action.edge);
    else if (action.k === 'roll') res = roll(g);
    else if (action.k === 'buildRoad') res = buildRoad(g, action.edge);
    else if (action.k === 'buildSettlement') res = buildSettlement(g, action.vertex);
    else if (action.k === 'upgradeCity') res = upgradeCity(g, action.vertex);
    else if (action.k === 'exchange') res = exchange(g, action.give, action.get);
    else if (action.k === 'endTurn') res = endTurn(g);
    else res = { ok: false, error: 'unknown action', code: 'E_MOVE' };
    if (res && res.ok && g.phase === 'over') res.over = true;
    return res;
  }

  /* -------------------------------------------------------------------- AI */

  function bestVertexFor(g, p, vertices) {
    var best = null, bestValue = -Infinity;
    vertices.forEach(function (vk) {
      var value = vertexValue(g, vk);
      if (value > bestValue) { bestValue = value; best = vk; }
    });
    return { vertex: best, value: bestValue };
  }

  function reachableVertexValue(g, p, ek) {
    var e = g.geo.emap.get(ek);
    if (!e) return 0;
    var best = 0;
    e.vertices.forEach(function (vk) {
      if (getStructureAt(g, vk)) return;
      var ns = vertexNeighbors(g, vk);
      for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return;
      var value = vertexValue(g, vk);
      if (value > best) best = value;
    });
    return best;
  }

  function exchangeEnablesBuild(g, p, give, get) {
    var rate = tradeRate(g, p);
    var after = cloneResources(p.resources);
    after[give] -= rate;
    after[get] += 1;
    var costs = [COSTS.city, COSTS.settlement, COSTS.road];
    for (var i = 0; i < costs.length; i++) {
      var cost = costs[i];
      var had = hasResources(p, cost);
      var would = true;
      for (var k in cost) if (after[k] < cost[k]) would = false;
      if (!had && would) return true;
    }
    return false;
  }

  function evaluatePosition(g, playerId) {
    var p = g.players[playerId];
    var prod = 0;
    p.settlements.forEach(function (vk) { prod += vertexValue(g, vk) * PRODUCTION_SETTLEMENT; });
    p.cities.forEach(function (vk) { prod += vertexValue(g, vk) * PRODUCTION_CITY; });
    return p.score * 100 + totalResources(p.resources) * 0.6 + prod * 0.8 +
      p.portEdges.length * 8 + longestRoad(g, p) * 3;
  }

  function scoreAction(g, action, level, rng) {
    var p = g.players[g.current];
    var score = 0;
    if (action.k === 'setupSettlement') score = 100 + vertexValue(g, action.vertex) * 10;
    else if (action.k === 'setupRoad') {
      var e = g.geo.emap.get(action.edge);
      var other = e && e.vertices[0] === g.setup.lastSettlement ? e.vertices[1] : (e ? e.vertices[0] : null);
      score = 40 + (other ? vertexValue(g, other) * 6 : 0) + (isPortEdge(g, action.edge) ? 4 : 0);
    } else if (action.k === 'roll') score = 90;
    else if (action.k === 'upgradeCity') score = 1000 + vertexValue(g, action.vertex) * 12;
    else if (action.k === 'buildSettlement') score = 900 + vertexValue(g, action.vertex) * 10;
    else if (action.k === 'buildRoad') {
      score = 260 + reachableVertexValue(g, p, action.edge) * 6;
      if (level >= 3) {
        var tentative = clone(g);
        var pp = tentative.players[tentative.current];
        pp.roads.push(action.edge);
        score += longestRoad(tentative, pp) * 4;
        if (isPortEdge(g, action.edge)) score += 30;
      }
    } else if (action.k === 'exchange') {
      // Trading is only worth it when it completes a build this turn. An
      // aimless 3:1 conversion just drains the stock the next city needs.
      score = exchangeEnablesBuild(g, p, action.give, action.get) ? 150 : -40;
    } else if (action.k === 'endTurn') score = 0;
    if (level >= 3 && action.k !== 'roll' && action.k !== 'endTurn') {
      var next = clone(g);
      var applied = applyAction(next, action);
      if (applied.ok) score += evaluatePosition(next, g.current) * 0.08;
    }
    return score + rng() * 0.35;
  }

  function aiAction(g, level, rng) {
    level = level || 2;
    rng = typeof rng === 'function' ? rng : localRng(g.rngState ^ (g.current + 1) * 0x9e3779b9);
    if (g.phase === 'over') return null;
    if (g.phase === 'play' && g.turnStage === 'action' && g.turnActions >= MAX_STEPS_PER_TURN) {
      return { k: 'endTurn' };
    }
    var acts = legalActions(g);
    if (!acts.length) return null;
    if (level <= 1) return acts[Math.floor(rng() * acts.length)];
    var best = null, bestScore = -Infinity;
    for (var i = 0; i < acts.length; i++) {
      var value = scoreAction(g, acts[i], level, rng);
      if (value > bestScore) { bestScore = value; best = acts[i]; }
    }
    return best || acts[0];
  }

  function aiAct(g, level, rng) {
    var action = aiAction(g, level, rng);
    if (!action) return null;
    var res = applyAction(g, action);
    return res.ok ? action : null;
  }

  function selfPlay(seed, levels) {
    var g = createGame({ players: 4, humans: 0, seed: seed == null ? 20261110 : seed, names: ['AI-赤', 'AI-蓝', 'AI-青', 'AI-金'] });
    var guard = 0;
    while (g.phase !== 'over') {
      if (++guard > 5000) throw new Error('pioneers selfPlay did not finish');
      var level = Array.isArray(levels) ? levels[g.current] : (levels || 2);
      var action = aiAct(g, level || 2, localRng(g.rngState + guard * 7919));
      if (!action) {
        if (g.phase === 'play' && g.turnStage === 'action') applyAction(g, { k: 'endTurn' });
        else break;
      }
    }
    return g;
  }

  /* ---------------------------------------------------------- public view */

  function publicView(g, viewerSeat) {
    var viewer = viewerSeat == null ? g.current : viewerSeat;
    var portVertex = {};
    g.ports.forEach(function (port) {
      port.vertices.forEach(function (vk) { portVertex[vk] = port.id; });
    });
    return {
      phase: g.phase,
      round: g.round,
      maxRounds: g.maxRounds,
      current: g.current,
      turnSeat: g.current,
      viewerSeat: viewer,
      viewerTurn: g.phase !== 'over' && g.current === viewer,
      turnStage: g.turnStage,
      dice: g.dice ? g.dice.slice() : null,
      lastSum: g.lastSum,
      lastRoll: g.lastRoll ? JSON.parse(JSON.stringify(g.lastRoll)) : null,
      setup: {
        round: g.setup.round,
        step: g.setup.step,
        index: g.setup.index,
        order: g.setup.order.slice(),
        lastSettlement: g.setup.lastSettlement
      },
      players: g.players.map(function (p) {
        return {
          id: p.id, name: p.name, color: p.color, ai: p.ai,
          score: p.score,
          resources: cloneResources(p.resources),
          settlements: p.settlements.slice(),
          cities: p.cities.slice(),
          roads: p.roads.slice(),
          portEdges: p.portEdges.slice(),
          tradeRate: tradeRate(g, p),
          isCurrent: g.current === p.id
        };
      }),
      board: {
        hexes: g.hexList.map(function (h) {
          return {
            id: h.id, q: h.q, r: h.r, x: h.x, y: h.y,
            terrain: h.terrain, number: h.number, pips: h.pips,
            vertices: h.vertices.slice(), edges: h.edges.slice()
          };
        }),
        vertices: g.board.vertices.map(function (v) {
          return {
            key: v.key, x: v.x, y: v.y,
            hexes: v.hexes.slice(), edges: v.edges.slice(),
            port: portVertex[v.key] || null
          };
        }),
        edges: g.board.edges.map(function (e) {
          return {
            key: e.key, vertices: e.vertices.slice(), hexes: e.hexes.slice(),
            mid: { x: e.mid.x, y: e.mid.y }, port: e.port || null
          };
        }),
        ports: g.ports.map(function (port) {
          return {
            id: port.id, edge: port.edge, vertices: port.vertices.slice(),
            mid: { x: port.mid.x, y: port.mid.y }, ratio: port.ratio
          };
        })
      },
      log: g.log.slice(),
      winners: g.winners.slice(),
      winner: g.winner,
      result: g.result,
      over: g.over
    };
  }

  return {
    RESOURCES: RESOURCES,
    TERRAINS: TERRAINS,
    RESOURCE_NAME: RESOURCE_NAME,
    TERRAIN_NAME: TERRAIN_NAME,
    COSTS: COSTS,
    WIN_POINTS: WIN_POINTS,
    MAX_ROUNDS: MAX_ROUNDS,
    MAX_SETTLEMENTS: MAX_SETTLEMENTS,
    MAX_CITIES: MAX_CITIES,
    MAX_ROADS: MAX_ROADS,
    TRADE_BASE: TRADE_BASE,
    TRADE_PORT: TRADE_PORT,
    PRODUCTION_SETTLEMENT: PRODUCTION_SETTLEMENT,
    PRODUCTION_CITY: PRODUCTION_CITY,
    PIPS: PIPS,
    TOKEN_POOL: TOKEN_POOL,
    PLAYER_COLORS: PLAYER_COLORS,
    DEFAULT_NAMES: DEFAULT_NAMES,
    MAX_STEPS_PER_TURN: MAX_STEPS_PER_TURN,
    buildGeometry: buildGeometry,
    buildBoard: buildBoard,
    createGame: createGame,
    clone: clone,
    getStructureAt: getStructureAt,
    vertexNeighbors: vertexNeighbors,
    structureCount: structureCount,
    hasResources: hasResources,
    missingResources: missingResources,
    recomputeScore: recomputeScore,
    isPortEdge: isPortEdge,
    playerPortEdges: playerPortEdges,
    tradeRate: tradeRate,
    vertexProduction: vertexProduction,
    vertexValue: vertexValue,
    longestRoad: longestRoad,
    validateSetupSettlement: validateSetupSettlement,
    validateSetupRoad: validateSetupRoad,
    placeSetupSettlement: placeSetupSettlement,
    placeSetupRoad: placeSetupRoad,
    legalRoadEdges: legalRoadEdges,
    legalSettlementVertices: legalSettlementVertices,
    validateRoad: validateRoad,
    validateSettlement: validateSettlement,
    validateCity: validateCity,
    validateExchange: validateExchange,
    buildRoad: buildRoad,
    buildSettlement: buildSettlement,
    upgradeCity: upgradeCity,
    exchange: exchange,
    roll: roll,
    endTurn: endTurn,
    finishPoints: finishPoints,
    finishRounds: finishRounds,
    legalActions: legalActions,
    legalActionsForSeat: legalActionsForSeat,
    isLegal: isLegal,
    applyAction: applyAction,
    aiAction: aiAction,
    aiAct: aiAct,
    selfPlay: selfPlay,
    publicView: publicView,
    nextRandom: nextRandom,
    localRng: localRng,
    totalResources: totalResources,
    cloneResources: cloneResources,
    addLog: addLog,
    emit: emit
  };
});
