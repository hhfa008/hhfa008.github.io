/*
 * Pioneers of Nine Isles — original resource-management board game engine.
 * Pure rules logic. No DOM, no network. Usable from the browser and Node.
 *
 * Board: 19 pointy-top hexes in rows of 3-4-5-4-3.
 * Terrain: 6 wheat, 6 stone, 6 wood, 1 neutral frost hollow.
 * Ports: 4 tidegates placed on coastal edges; a structure on a tidegate
 *        edge may exchange 2 identical resources for 1 of any other.
 * Win: first to 8 points, or highest score after 12 rounds.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PioneersEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var RESOURCES = ['wheat', 'stone', 'wood'];
  var TERRAINS = ['wheat', 'stone', 'wood', 'neutral'];
  var COSTS = {
    road: { wood: 1, stone: 1 },
    settlement: { wheat: 1, stone: 1, wood: 1 },
    city: { wheat: 2, stone: 3 }
  };
  var WIN_POINTS = 8;
  var MAX_ROUNDS = 12;
  var MAX_STRUCTURES = 5;
  var MAX_CITIES = 3;
  var MAX_ROADS = 10;
  var TRADE_BASE = 3;
  var TRADE_PORT = 2;
  var START_RESOURCES = 2;
  var PRODUCTION_SETTLEMENT = 3;
  var PRODUCTION_CITY = 5;
  var R = 1;
  var W = Math.sqrt(3) * R;
  var PIPS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
  var HEX_DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  var PLAYER_COLORS = ['#c0392b', '#2b2f36', '#3f7d5b', '#b98a5a'];

  function round3(n) { return Math.round(n * 1000) / 1000; }
  function pointKey(x, y) { return round3(x) + ',' + round3(y); }
  function edgeKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  function mulberry32(seed) {
    var a = seed >>> 0;
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

  function cloneResources(r) {
    return { wheat: r.wheat, stone: r.stone, wood: r.wood };
  }

  function totalResources(r) { return r.wheat + r.stone + r.wood; }

  /* ---------- geometry ---------- */

  function buildGeometry() {
    var hexes = [];
    var r, q, qmin, qmax;
    for (r = -2; r <= 2; r++) {
      qmin = Math.max(-2, -2 - r);
      qmax = Math.min(2, 2 - r);
      for (q = qmin; q <= qmax; q++) {
        hexes.push({ id: 'h' + q + ',' + r, q: q, r: r, x: W * (q + r / 2), y: 1.5 * r, vertices: [], edges: [] });
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
      e.mid = { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
    });

    var coastal = Array.from(emap.values()).filter(function (e) { return e.hexes.length === 1; });
    coastal.sort(function (a, b) {
      return Math.atan2(a.mid.y, a.mid.x) - Math.atan2(b.mid.y, b.mid.x);
    });
    var ports = [];
    var n = coastal.length;
    [0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75)].forEach(function (idx, i) {
      var e = coastal[idx];
      ports.push({ id: 'p' + i, edge: e.key, vertices: e.vertices.slice(), mid: { x: e.mid.x, y: e.mid.y } });
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

  /* ---------- board generation ---------- */

  function buildBoard(seed) {
    var rng = mulberry32(seed == null ? Date.now() : seed);
    var geo = buildGeometry();
    var hexes = geo.hexes;
    var neighbors = hexNeighbors(hexes);

    var base = [];
    var i;
    for (i = 0; i < 6; i++) base.push('wheat');
    for (i = 0; i < 6; i++) base.push('stone');
    for (i = 0; i < 6; i++) base.push('wood');
    base.push('neutral');

    var terrains, tokens, guard = 0;
    var tokenPool = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
    do {
      terrains = shuffle(base, rng);
      tokens = shuffle(tokenPool, rng);
      guard++;
    } while (guard < 400 && hasAdjacentHighTokens(hexes, neighbors, terrains, tokens));

    var ti = 0;
    hexes.forEach(function (h, idx) {
      h.terrain = terrains[idx];
      h.number = h.terrain === 'neutral' ? null : tokens[ti++];
    });

    var byId = {};
    hexes.forEach(function (h) { byId[h.id] = h; });
    return { geo: geo, hexes: byId, hexList: hexes, neighbors: neighbors };
  }

  function hasAdjacentHighTokens(hexes, neighbors, terrains, tokens) {
    var assigned = {};
    var ti = 0;
    hexes.forEach(function (h, idx) {
      if (terrains[idx] !== 'neutral') assigned[h.id] = tokens[ti++];
    });
    for (var i = 0; i < hexes.length; i++) {
      var h = hexes[i];
      var a = assigned[h.id];
      if (a !== 6 && a !== 8) continue;
      var ns = neighbors[h.id];
      for (var j = 0; j < ns.length; j++) {
        var b = assigned[ns[j]];
        if (b === 6 || b === 8) return true;
      }
    }
    return false;
  }

  /* ---------- game creation ---------- */

  function createGame(opts) {
    opts = opts || {};
    var count = Math.max(2, Math.min(4, opts.players || 2));
    var humans = opts.humans == null ? count : Math.max(0, Math.min(count, opts.humans));
    var board = buildBoard(opts.seed);
    var players = [];
    for (var i = 0; i < count; i++) {
      players.push({
        id: i,
        name: 'P' + (i + 1),
        color: PLAYER_COLORS[i],
        isAI: i >= humans,
        resources: { wheat: 0, stone: 0, wood: 0 },
        settlements: [],
        cities: [],
        roads: [],
        score: 0,
        portEdges: []
      });
    }

    var g = {
      seed: opts.seed == null ? null : opts.seed,
      geo: board.geo,
      hexes: board.hexes,
      hexList: board.hexList,
      neighbors: board.neighbors,
      ports: board.geo.ports,
      players: players,
      current: 0,
      phase: 'setup',
      setupStep: 'settlement',
      setupSettlement: null,
      round: 1,
      maxRounds: MAX_ROUNDS,
      turnStage: 'roll',
      dice: null,
      lastSum: null,
      log: [],
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
        maxStructures: MAX_STRUCTURES,
        maxCities: MAX_CITIES,
        maxRoads: MAX_ROADS
      }
    };
    addLog(g, 'logStart');
    return g;
  }

  function addLog(g, key, data) {
    var entry = { key: key };
    if (data) {
      for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) entry[k] = data[k];
    }
    entry.seq = g.log.length + 1;
    g.log.push(entry);
    return entry;
  }

  /* ---------- helpers ---------- */

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
      var other = e.vertices[0] === vk ? e.vertices[1] : e.vertices[0];
      if (out.indexOf(other) === -1) out.push(other);
    });
    return out;
  }

  function structureCount(p) { return p.settlements.length + p.cities.length; }

  function hasResources(p, cost) {
    for (var k in cost) if (p.resources[k] < cost[k]) return false;
    return true;
  }

  function missingResources(p, cost) {
    var miss = {};
    for (var k in cost) {
      var d = cost[k] - p.resources[k];
      if (d > 0) miss[k] = d;
    }
    return miss;
  }

  function pay(p, cost) {
    for (var k in cost) p.resources[k] -= cost[k];
  }

  function gain(p, res, n) { p.resources[res] += n; }

  function recomputeScore(p) {
    p.score = p.settlements.length + p.cities.length * 2;
    return p.score;
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

  function isPortEdge(g, ek) {
    return g.ports.some(function (p) { return p.edge === ek; });
  }

  function vertexProduction(g, vk) {
    var v = g.geo.vmap.get(vk);
    var list = [];
    v.hexes.forEach(function (hid) {
      var h = g.hexes[hid];
      if (h && h.number) list.push({ hex: h, pips: PIPS[h.number] || 0 });
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
    if (g.geo.vmap.get(vk).edges.some(function (ek) { return isPortEdge(g, ek); })) value += 1.8;
    return value;
  }

  /* ---------- setup ---------- */

  var ERR = {
    wrongPhase: 'wrongPhase',
    badVertex: 'badVertex',
    badEdge: 'badEdge',
    occupied: 'occupied',
    tooClose: 'tooClose',
    needResources: 'needResources',
    notConnected: 'notConnected',
    noPieces: 'noPieces',
    notYourSettlement: 'notYourSettlement',
    maxCities: 'maxCities',
    maxRoads: 'maxRoads',
    noPort: 'noPort',
    sameResource: 'sameResource',
    notTurn: 'notTurn',
    badDice: 'badDice',
    wrongStage: 'wrongStage'
  };

  function fail(error) { return { ok: false, error: error }; }
  function ok(extra) {
    var r = { ok: true };
    if (extra) for (var k in extra) r[k] = extra[k];
    return r;
  }

  function validateSetupSettlement(g, vk) {
    if (g.phase !== 'setup') return fail(ERR.wrongPhase);
    if (!g.geo.vmap.get(vk)) return fail(ERR.badVertex);
    if (getStructureAt(g, vk)) return fail(ERR.occupied);
    var ns = vertexNeighbors(g, vk);
    for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return fail(ERR.tooClose);
    return ok();
  }

  function placeSetupSettlement(g, vk) {
    var v = validateSetupSettlement(g, vk);
    if (!v.ok) return v;
    var p = g.players[g.current];
    p.settlements.push(vk);
    recomputeScore(p);
    g.setupSettlement = vk;
    g.setupStep = 'road';
    addLog(g, 'logSetupSettlement', { pid: p.id });
    return ok();
  }

  function validateSetupRoad(g, ek) {
    if (g.phase !== 'setup' || g.setupStep !== 'road') return fail(ERR.wrongPhase);
    var e = g.geo.emap.get(ek);
    if (!e) return fail(ERR.badEdge);
    if (g.players.some(function (p) { return p.roads.indexOf(ek) !== -1; })) return fail(ERR.occupied);
    if (e.vertices.indexOf(g.setupSettlement) === -1) return fail(ERR.notConnected);
    return ok();
  }

  function placeSetupRoad(g, ek) {
    var v = validateSetupRoad(g, ek);
    if (!v.ok) return v;
    var p = g.players[g.current];
    p.roads.push(ek);
    addLog(g, 'logSetupRoad', { pid: p.id });
    g.setupSettlement = null;
    g.current++;
    if (g.current >= g.players.length) {
      g.current = 0;
      g.phase = 'play';
      g.turnStage = 'roll';
      g.players.forEach(function (pl) {
        pl.resources.wheat += START_RESOURCES;
        pl.resources.stone += START_RESOURCES;
        pl.resources.wood += START_RESOURCES;
      });
      addLog(g, 'logPlay');
    } else {
      g.setupStep = 'settlement';
    }
    return ok();
  }

  /* ---------- action legality ---------- */

  function legalRoadEdges(g, player) {
    var out = [];
    g.geo.emap.forEach(function (e) {
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
      if (getStructureAt(g, vk)) return;
      var ns = vertexNeighbors(g, vk);
      for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return;
      var connected;
      if (g.phase === 'setup') {
        connected = true;
      } else {
        connected = v.edges.some(function (ek) { return player.roads.indexOf(ek) !== -1; });
      }
      if (connected) out.push(vk);
    });
    return out;
  }

  function validateRoad(g, player, ek) {
    if (g.phase !== 'play') return fail(ERR.wrongPhase);
    var e = g.geo.emap.get(ek);
    if (!e) return fail(ERR.badEdge);
    if (player.roads.length >= MAX_ROADS) return fail(ERR.maxRoads);
    if (g.players.some(function (p) { return p.roads.indexOf(ek) !== -1; })) return fail(ERR.occupied);
    if (!hasResources(player, COSTS.road)) return fail(ERR.needResources);
    if (legalRoadEdges(g, player).indexOf(ek) === -1) return fail(ERR.notConnected);
    return ok();
  }

  function validateSettlement(g, player, vk) {
    if (g.phase !== 'play') return fail(ERR.wrongPhase);
    if (!g.geo.vmap.get(vk)) return fail(ERR.badVertex);
    if (structureCount(player) >= MAX_STRUCTURES) return fail(ERR.noPieces);
    if (getStructureAt(g, vk)) return fail(ERR.occupied);
    var ns = vertexNeighbors(g, vk);
    for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return fail(ERR.tooClose);
    if (!hasResources(player, COSTS.settlement)) return fail(ERR.needResources);
    var connected = g.geo.vmap.get(vk).edges.some(function (ek) { return player.roads.indexOf(ek) !== -1; });
    if (!connected) return fail(ERR.notConnected);
    return ok();
  }

  function validateCity(g, player, vk) {
    if (g.phase !== 'play') return fail(ERR.wrongPhase);
    if (!g.geo.vmap.get(vk)) return fail(ERR.badVertex);
    if (player.cities.length >= MAX_CITIES) return fail(ERR.maxCities);
    var s = getStructureAt(g, vk);
    if (!s) return fail(ERR.badVertex);
    if (s.player.id !== player.id) return fail(ERR.notYourSettlement);
    if (s.type !== 'settlement') return fail(ERR.notYourSettlement);
    if (!hasResources(player, COSTS.city)) return fail(ERR.needResources);
    return ok();
  }

  function buildRoad(g, ek) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return fail(ERR.wrongStage);
    var p = g.players[g.current];
    var v = validateRoad(g, p, ek);
    if (!v.ok) return v;
    pay(p, COSTS.road);
    p.roads.push(ek);
    addLog(g, 'logRoad', { pid: p.id });
    return ok();
  }

  function buildSettlement(g, vk) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return fail(ERR.wrongStage);
    var p = g.players[g.current];
    var v = validateSettlement(g, p, vk);
    if (!v.ok) return v;
    pay(p, COSTS.settlement);
    p.settlements.push(vk);
    recomputeScore(p);
    p.portEdges = playerPortEdges(g, p);
    addLog(g, 'logSettlement', { pid: p.id });
    if (p.score >= WIN_POINTS) finishPoints(g, p);
    return ok({ score: p.score, over: g.over });
  }

  function upgradeCity(g, vk) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return fail(ERR.wrongStage);
    var p = g.players[g.current];
    var v = validateCity(g, p, vk);
    if (!v.ok) return v;
    pay(p, COSTS.city);
    var idx = p.settlements.indexOf(vk);
    p.settlements.splice(idx, 1);
    p.cities.push(vk);
    recomputeScore(p);
    p.portEdges = playerPortEdges(g, p);
    addLog(g, 'logCity', { pid: p.id });
    if (p.score >= WIN_POINTS) finishPoints(g, p);
    return ok({ score: p.score, over: g.over });
  }

  function tradeRate(g, player) {
    return playerPortEdges(g, player).length > 0 ? TRADE_PORT : TRADE_BASE;
  }

  function canExchange(g, player, give) {
    var rate = tradeRate(g, player);
    var list = give ? [give] : RESOURCES;
    return list.some(function (r) { return player.resources[r] >= rate; });
  }

  function validateExchange(g, player, give, get) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return fail(ERR.wrongStage);
    if (RESOURCES.indexOf(give) === -1 || RESOURCES.indexOf(get) === -1) return fail(ERR.sameResource);
    if (give === get) return fail(ERR.sameResource);
    var rate = tradeRate(g, player);
    if (player.resources[give] < rate) return fail(ERR.needResources);
    return ok();
  }

  function exchange(g, give, get) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return fail(ERR.wrongStage);
    var p = g.players[g.current];
    var v = validateExchange(g, p, give, get);
    if (!v.ok) return v;
    var rate = tradeRate(g, p);
    p.resources[give] -= rate;
    p.resources[get] += 1;
    addLog(g, 'logExchange', { pid: p.id, give: give, get: get, rate: rate });
    return ok();
  }

  /* ---------- dice / production ---------- */

  function roll(g, d1, d2) {
    if (g.phase !== 'play') return fail(ERR.wrongPhase);
    if (g.turnStage !== 'roll') return fail(ERR.wrongStage);
    d1 = d1 == null ? 1 + Math.floor(Math.random() * 6) : d1;
    d2 = d2 == null ? 1 + Math.floor(Math.random() * 6) : d2;
    if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) return fail(ERR.badDice);
    var p = g.players[g.current];
    var sum = d1 + d2;
    g.dice = [d1, d2];
    g.lastSum = sum;
    g.turnStage = 'action';
    addLog(g, 'logRoll', { pid: p.id, sum: sum });

    if (sum === 7) {
      var discards = [];
      g.players.forEach(function (pl) {
        var removed = discardHalf(pl);
        var n = removed.wheat + removed.stone + removed.wood;
        if (n > 0) {
          discards.push({ pid: pl.id, n: n, removed: removed });
          addLog(g, 'logDiscard', { pid: pl.id, n: n });
        }
      });
      addLog(g, 'logSeven');
      return ok({ sum: sum, seven: true, discards: discards });
    }

    var gains = {};
    g.players.forEach(function (pl) {
      var gs = { wheat: 0, stone: 0, wood: 0 };
      pl.settlements.forEach(function (vk) { addProduction(g, pl, vk, sum, PRODUCTION_SETTLEMENT, gs); });
      pl.cities.forEach(function (vk) { addProduction(g, pl, vk, sum, PRODUCTION_CITY, gs); });
      var any = gs.wheat + gs.stone + gs.wood;
      if (any > 0) {
        gains[pl.id] = gs;
        addLog(g, 'logProduce', { pid: pl.id, gains: gs });
      }
    });
    if (Object.keys(gains).length === 0) addLog(g, 'logNothing', { sum: sum });
    return ok({ sum: sum, seven: false, gains: gains });
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

  function discardHalf(player) {
    var removed = { wheat: 0, stone: 0, wood: 0 };
    var n = Math.floor(totalResources(player.resources) / 2);
    while (n > 0) {
      var best = null, bestN = 0;
      for (var i = 0; i < RESOURCES.length; i++) {
        var r = RESOURCES[i];
        if (player.resources[r] > bestN) { best = r; bestN = player.resources[r]; }
      }
      if (!best || bestN <= 0) break;
      player.resources[best]--;
      removed[best]++;
      n--;
    }
    return removed;
  }

  /* ---------- turn / end ---------- */

  function endTurn(g) {
    if (g.phase !== 'play') return fail(ERR.wrongPhase);
    if (g.turnStage !== 'action') return fail(ERR.wrongStage);
    g.current++;
    g.dice = null;
    g.lastSum = null;
    if (g.current >= g.players.length) {
      g.current = 0;
      g.round++;
      if (g.round > MAX_ROUNDS) {
        finishRounds(g);
        return ok({ over: true });
      }
    }
    g.turnStage = 'roll';
    return ok({ over: false });
  }

  function finishPoints(g, player) {
    g.phase = 'over';
    g.over = true;
    g.result = 'points';
    g.winners = [player.id];
    g.winner = player.id;
    addLog(g, 'logWinPoints', { pid: player.id, score: player.score });
  }

  function finishRounds(g) {
    var max = Math.max.apply(null, g.players.map(function (p) { return p.score; }));
    var winners = g.players.filter(function (p) { return p.score === max; }).map(function (p) { return p.id; });
    g.phase = 'over';
    g.over = true;
    g.result = winners.length > 1 ? 'draw' : 'rounds';
    g.winners = winners;
    g.winner = winners.length === 1 ? winners[0] : null;
    if (winners.length > 1) addLog(g, 'logDrawRounds', { pids: winners, score: max });
    else addLog(g, 'logWinRounds', { pid: winners[0], score: max });
  }

  /* ---------- AI ---------- */

  function aiSetupSettlement(g) {
    var p = g.players[g.current];
    var verts = legalSettlementVertices(g, p);
    var best = null, bestV = -1;
    verts.forEach(function (vk) {
      var val = vertexValue(g, vk);
      if (val > bestV) { bestV = val; best = vk; }
    });
    return best;
  }

  function aiSetupRoad(g, vk) {
    var edges = g.geo.vmap.get(vk).edges.filter(function (ek) {
      return g.players.every(function (p) { return p.roads.indexOf(ek) === -1; });
    });
    var best = null, bestV = -1;
    edges.forEach(function (ek) {
      var e = g.geo.emap.get(ek);
      var other = e.vertices[0] === vk ? e.vertices[1] : e.vertices[0];
      var val = vertexValue(g, other);
      if (val > bestV) { bestV = val; best = ek; }
    });
    return best;
  }

  function bestSettlementVertex(g, p) {
    var verts = legalSettlementVertices(g, p).filter(function (vk) {
      return hasResources(p, COSTS.settlement);
    });
    var best = null, bestV = -1;
    verts.forEach(function (vk) {
      var val = vertexValue(g, vk);
      if (val > bestV) { bestV = val; best = vk; }
    });
    return best;
  }

  function bestCityVertex(g, p) {
    var verts = p.settlements.filter(function (vk) {
      return validateCity(g, p, vk).ok && hasResources(p, COSTS.city);
    });
    if (!verts.length) return null;
    var best = verts[0], bestV = -1;
    verts.forEach(function (vk) {
      var val = vertexValue(g, vk);
      if (val > bestV) { bestV = val; best = vk; }
    });
    return best;
  }

  function aiExchangeToBuild(g, p) {
    var rate = tradeRate(g, p);
    var targets = [COSTS.settlement, COSTS.city, COSTS.road];
    for (var t = 0; t < targets.length; t++) {
      var cost = targets[t];
      var miss = missingResources(p, cost);
      var keys = Object.keys(miss);
      var need, give;
      if (keys.length === 1 && miss[keys[0]] === 1) {
        need = keys[0];
      } else if (cost === COSTS.road && keys.length === 2) {
        need = keys[0];
      } else {
        continue;
      }
      if (p.resources[need] >= 1) continue;
      for (var i = 0; i < RESOURCES.length; i++) {
        give = RESOURCES[i];
        if (give === need) continue;
        if (p.resources[give] < rate) continue;
        var after = cloneResources(p.resources);
        after[give] -= rate; after[need] += 1;
        var covers = true;
        for (var k in cost) if (after[k] < cost[k]) { covers = false; break; }
        if (!covers) continue;
        var r = exchange(g, give, need);
        if (r.ok) return { type: 'exchange', give: give, get: need };
      }
    }
    return null;
  }

  function aiNextAction(g) {
    if (g.phase !== 'play' || g.turnStage !== 'action') return null;
    var p = g.players[g.current];
    if (!p.isAI) return null;

    var sv = bestSettlementVertex(g, p);
    if (sv) {
      var rs = buildSettlement(g, sv);
      if (rs.ok) return { type: 'settlement', vertex: sv, over: rs.over };
    }

    var cv = bestCityVertex(g, p);
    if (cv) {
      var rc = upgradeCity(g, cv);
      if (rc.ok) return { type: 'city', vertex: cv, over: rc.over };
    }

    var ex = aiExchangeToBuild(g, p);
    if (ex) return ex;

    if (hasResources(p, COSTS.road) && p.roads.length < MAX_ROADS) {
      var edges = legalRoadEdges(g, p);
      var best = null, bestV = -1;
      edges.forEach(function (ek) {
        var e = g.geo.emap.get(ek);
        e.vertices.forEach(function (vk) {
          if (getStructureAt(g, vk)) return;
          var ns = vertexNeighbors(g, vk);
          for (var i = 0; i < ns.length; i++) if (getStructureAt(g, ns[i])) return;
          var val = vertexValue(g, vk);
          if (val > bestV) { bestV = val; best = ek; }
        });
      });
      if (best) {
        var rr = buildRoad(g, best);
        if (rr.ok) return { type: 'road', edge: best };
      }
    }

    var rate = tradeRate(g, p);
    for (var i = 0; i < RESOURCES.length; i++) {
      var give = RESOURCES[i];
      if (p.resources[give] < rate + 1) continue;
      for (var j = 0; j < RESOURCES.length; j++) {
        var get = RESOURCES[j];
        if (get === give) continue;
        if (p.resources[get] <= 1) {
          var re = exchange(g, give, get);
          if (re.ok) return { type: 'exchange', give: give, get: get };
        }
      }
    }
    return null;
  }

  return {
    RESOURCES: RESOURCES,
    TERRAINS: TERRAINS,
    COSTS: COSTS,
    WIN_POINTS: WIN_POINTS,
    MAX_ROUNDS: MAX_ROUNDS,
    MAX_STRUCTURES: MAX_STRUCTURES,
    MAX_CITIES: MAX_CITIES,
    MAX_ROADS: MAX_ROADS,
    PIPS: PIPS,
    PLAYER_COLORS: PLAYER_COLORS,
    ERR: ERR,
    buildGeometry: buildGeometry,
    buildBoard: buildBoard,
    createGame: createGame,
    roll: roll,
    discardHalf: discardHalf,
    placeSetupSettlement: placeSetupSettlement,
    placeSetupRoad: placeSetupRoad,
    validateSetupSettlement: validateSetupSettlement,
    validateSetupRoad: validateSetupRoad,
    buildRoad: buildRoad,
    buildSettlement: buildSettlement,
    upgradeCity: upgradeCity,
    exchange: exchange,
    endTurn: endTurn,
    validateRoad: validateRoad,
    validateSettlement: validateSettlement,
    validateCity: validateCity,
    validateExchange: validateExchange,
    legalRoadEdges: legalRoadEdges,
    legalSettlementVertices: legalSettlementVertices,
    getStructureAt: getStructureAt,
    vertexNeighbors: vertexNeighbors,
    vertexValue: vertexValue,
    vertexProduction: vertexProduction,
    playerPortEdges: playerPortEdges,
    canExchange: canExchange,
    tradeRate: tradeRate,
    TRADE_BASE: TRADE_BASE,
    TRADE_PORT: TRADE_PORT,
    START_RESOURCES: START_RESOURCES,
    PRODUCTION_SETTLEMENT: PRODUCTION_SETTLEMENT,
    PRODUCTION_CITY: PRODUCTION_CITY,
    aiSetupSettlement: aiSetupSettlement,
    aiSetupRoad: aiSetupRoad,
    aiNextAction: aiNextAction,
    recomputeScore: recomputeScore,
    totalResources: totalResources,
    cloneResources: cloneResources,
    finishRounds: finishRounds
  };
});
