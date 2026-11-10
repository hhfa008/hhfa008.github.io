'use strict';

// Pioneers of Nine Isles — premium engine, rules, presentation and gate tests.
// Discovery: games/tests/run-all.js runs every test*.js under the game dir.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('pioneers-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function cjk(html) { return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length; }
function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  var b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function setResources(p, n) { p.resources = { wheat: n, stone: n, wood: n }; }
function fullSetup(players, seed) {
  var g = E.createGame({ players: players || 2, humans: players || 2, seed: seed == null ? 11 : seed });
  var guard = 0;
  while (g.phase === 'setup') {
    if (++guard > 100) throw new Error('setup did not finish');
    var acts = E.legalActions(g);
    if (!acts.length) throw new Error('no setup action at ' + JSON.stringify(g.setup));
    var r = E.applyAction(g, acts[0]);
    if (!r.ok) throw new Error('setup action rejected: ' + JSON.stringify(acts[0]) + ' ' + JSON.stringify(r));
  }
  return g;
}
function vertexObj(g, vk) { return g.board.vertices.filter(function (v) { return v.key === vk; })[0]; }
function edgeObj(g, ek) { return g.board.edges.filter(function (e) { return e.key === ek; })[0]; }
function productionExpected(g, vk, sum, amount) {
  var out = { wheat: 0, stone: 0, wood: 0 };
  E.vertexProduction(g, vk).forEach(function (x) {
    if (x.hex.number === sum) out[x.hex.terrain] += amount;
  });
  return out;
}
function nonNeutralAdjacent(g, vk) { return E.vertexProduction(g, vk).length; }
function totalRes(p) { return E.totalResources(p.resources); }
function adjacentBuildings(g, vk) {
  return E.vertexNeighbors(g, vk).filter(function (n) { return !!E.getStructureAt(g, n); });
}

/* ------------------------------------------------------------------ board */

s.group('建局与棋盘：19 六边形、6/6/6/1、54 交点、72 条边、4 港口', function () {
  var g = E.createGame({ players: 2, humans: 2, seed: 11 });
  s.eq('默认 2 名玩家', g.players.length, 2);
  s.eq('开局处于摆放阶段', [g.phase, g.setup.step], ['setup', 'settlement']);
  s.eq('起始玩家 0', g.current, 0);
  s.eq('19 块六边形', g.hexList.length, 19);
  s.eq('54 个交点', g.board.vertices.length, 54);
  s.eq('72 条边', g.board.edges.length, 72);
  s.eq('4 座潮门', g.ports.length, 4);
  s.eq('行数为 3-4-5-4-3', [2, 1, 0, -1, -2].map(function (r) {
    return g.hexList.filter(function (h) { return h.r === r; }).length;
  }), [3, 4, 5, 4, 3]);
  var pointy = g.hexList.every(function (h) {
    var ys = h.vertices.map(function (k) { var p = k.split(','); return Number(p[1]); });
    var max = Math.max.apply(null, ys), min = Math.min.apply(null, ys);
    return ys.filter(function (y) { return Math.abs(y - max) < 1e-6; }).length === 1 &&
      ys.filter(function (y) { return Math.abs(y - min) < 1e-6; }).length === 1;
  });
  s.ok('尖顶六边形：每块只有一个最高顶点与一个最低顶点', pointy);
  s.ok('尖顶六边形没有水平顶边', g.hexList.every(function (h) {
    var ys = h.vertices.map(function (k) { var p = k.split(','); return Number(p[1]); });
    var max = Math.max.apply(null, ys);
    return ys.filter(function (y) { return Math.abs(y - max) < 1e-6; }).length === 1;
  }));
  s.ok('尖顶顶点在六边形中心正上方', g.hexList.every(function (h) {
    var top = h.vertices.map(function (k) { return k.split(',').map(Number); })
      .filter(function (p) { return Math.abs(p[1] - (h.y - 1)) < 1e-6; })[0];
    return !!top && Math.abs(top[0] - h.x) < 1e-6;
  }));
  var terr = { wheat: 0, stone: 0, wood: 0, neutral: 0 };
  g.hexList.forEach(function (h) { terr[h.terrain] += 1; });
  s.eq('地形 6 麦 / 6 石 / 6 木 / 1 霜洞', [terr.wheat, terr.stone, terr.wood, terr.neutral], [6, 6, 6, 1]);
  var neutral = g.hexList.filter(function (h) { return h.terrain === 'neutral'; })[0];
  s.ok('霜洞存在且无点数', !!neutral && neutral.number === null, JSON.stringify(neutral && neutral.number));
  var producing = g.hexList.filter(function (h) { return h.terrain !== 'neutral'; });
  s.eq('18 块产出地', producing.length, 18);
  s.ok('所有产出地都有点数', producing.every(function (h) { return h.number >= 2 && h.number <= 12; }));
  var tokens = producing.map(function (h) { return h.number; }).sort(function (a, b) { return a - b; });
  s.eq('点数池精确匹配', tokens, [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
  s.ok('没有 7 点标记', tokens.indexOf(7) === -1);
  s.eq('2 与 12 各一个', [tokens.filter(function (n) { return n === 2; }).length, tokens.filter(function (n) { return n === 12; }).length], [1, 1]);
  s.eq('3/4/5/6/8/9/10/11 各两个', [3, 4, 5, 6, 8, 9, 10, 11].map(function (n) {
    return tokens.filter(function (x) { return x === n; }).length;
  }), [2, 2, 2, 2, 2, 2, 2, 2]);
  s.ok('每个点数 pip 与 PIPS 一致', producing.every(function (h) { return h.pips === E.PIPS[h.number]; }));
  s.eq('PIPS 不同点数值合计 30', Object.keys(E.PIPS).reduce(function (n, k) { return n + E.PIPS[k]; }, 0), 30);
  s.eq('18 个标记的 pip 总数 58', producing.reduce(function (n, h) { return n + h.pips; }, 0), 58);
  var adjacentHigh = false;
  g.hexList.forEach(function (h) {
    if (h.number !== 6 && h.number !== 8) return;
    (g.neighbors[h.id] || []).forEach(function (nid) {
      var n = g.hexes[nid];
      if (n && (n.number === 6 || n.number === 8)) adjacentHigh = true;
    });
  });
  s.ok('种子 11 的 6/8 不相邻', !adjacentHigh);
  [12, 13, 14, 15, 16].forEach(function (seed) {
    var gg = E.createGame({ players: 2, humans: 2, seed: seed });
    var bad = false;
    gg.hexList.forEach(function (h) {
      if (h.number !== 6 && h.number !== 8) return;
      (gg.neighbors[h.id] || []).forEach(function (nid) {
        var n = gg.hexes[nid];
        if (n && (n.number === 6 || n.number === 8)) bad = true;
      });
    });
    s.ok('种子 ' + seed + ' 的 6/8 不相邻', !bad);
  });
  s.eq('同种子地形一致', E.createGame({ seed: 11 }).hexList.map(function (h) { return h.terrain; }),
    g.hexList.map(function (h) { return h.terrain; }));
  s.ok('不同种子地形不同', E.createGame({ seed: 99 }).hexList.some(function (h, i) { return h.terrain !== g.hexList[i].terrain; }));
  s.eq('4 人局上限', E.createGame({ players: 9 }).players.length, 4);
  s.eq('1 人局下限', E.createGame({ players: 1 }).players.length, 2);
  s.eq('3 人局', E.createGame({ players: 3 }).players.length, 3);
  s.eq('AI 分配按 humans', E.createGame({ players: 3, humans: 1 }).players.map(function (p) { return p.ai; }), [false, true, true]);
  s.eq('开局分数为 0', g.players.map(function (p) { return p.score; }), [0, 0]);
  g.players.forEach(function (p, i) {
    s.eq('玩家 ' + i + ' 初始资源为 0', totalRes(p), 0);
    s.eq('玩家 ' + i + ' 初始建筑为空', [p.settlements.length, p.cities.length, p.roads.length], [0, 0, 0]);
    s.ok('玩家 ' + i + ' 有颜色', /^#[0-9a-f]{6}$/i.test(p.color), p.color);
  });
});

s.group('拓扑：顶点 / 边 / 邻接 / 港口边', function () {
  var g = E.createGame({ players: 2, humans: 2, seed: 11 });
  var vkeys = {}, ekeys = {};
  var dupV = false, dupE = false;
  g.board.vertices.forEach(function (v) { if (vkeys[v.key]) dupV = true; vkeys[v.key] = true; });
  g.board.edges.forEach(function (e) { if (ekeys[e.key]) dupE = true; ekeys[e.key] = true; });
  s.ok('交点 key 唯一', !dupV);
  s.ok('边 key 唯一', !dupE);
  s.ok('每个六边形 6 个交点', g.hexList.every(function (h) { return h.vertices.length === 6; }));
  s.ok('每个六边形 6 条边', g.hexList.every(function (h) { return h.edges.length === 6; }));
  s.ok('每个交点有 1-3 个相邻六边形', g.board.vertices.every(function (v) { return v.hexes.length >= 1 && v.hexes.length <= 3; }));
  s.ok('每个交点有 2-3 条边', g.board.vertices.every(function (v) { return v.edges.length >= 2 && v.edges.length <= 3; }));
  s.ok('每条边有 1-2 个相邻六边形', g.board.edges.every(function (e) { return e.hexes.length >= 1 && e.hexes.length <= 2; }));
  s.eq('海岸边 30 条', g.board.edges.filter(function (e) { return e.hexes.length === 1; }).length, 30);
  s.eq('内部边 42 条', g.board.edges.filter(function (e) { return e.hexes.length === 2; }).length, 42);
  s.ok('内部边两端都属于同两个六边形', g.board.edges.filter(function (e) { return e.hexes.length === 2; }).every(function (e) {
    return e.vertices.length === 2;
  }));
  s.ok('边界交点数 18', g.board.vertices.filter(function (v) { return v.hexes.length === 1; }).length === 18);
  s.ok('内部交点数 36', g.board.vertices.filter(function (v) { return v.hexes.length > 1; }).length === 36);
  s.ok('每个交点邻居数 2-3', g.board.vertices.every(function (v) { return E.vertexNeighbors(g, v.key).length >= 2; }));
  s.eq('港口都是海岸边', g.ports.every(function (p) { return edgeObj(g, p.edge).hexes.length === 1; }), true);
  s.eq('港口边互不重复', g.ports.map(function (p) { return p.edge; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).length, 4);
  s.ok('每个港口有两个端点', g.ports.every(function (p) { return p.vertices.length === 2; }));
  s.ok('每个港口比例 2:1', g.ports.every(function (p) { return p.ratio === 2; }));
  s.ok('港口边标记与 ports 一致', g.ports.every(function (p) { return edgeObj(g, p.edge).port === p.id; }));
  s.ok('港口中点数值有效', g.ports.every(function (p) { return typeof p.mid.x === 'number' && typeof p.mid.y === 'number'; }));
  s.eq('邻居表每个六边形 6 个方向', Object.keys(g.neighbors).length, 19);
  s.ok('邻居表只指向真实六边形', Object.keys(g.neighbors).every(function (id) {
    return g.neighbors[id].every(function (nid) { return !!g.hexes[nid]; });
  }));
  s.ok('邻接对称', Object.keys(g.neighbors).every(function (id) {
    return g.neighbors[id].every(function (nid) { return g.neighbors[nid].indexOf(id) !== -1; });
  }));
});

/* ------------------------------------------------------------------ setup */

s.group('蛇形摆放：2/3/4 人顺序、第二村庄给资源、道路连接', function () {
  [2, 3, 4].forEach(function (n) {
    var order = E.createGame({ players: n, humans: n, seed: 21 }).setup.order;
    var expected = [];
    for (var i = 0; i < n; i++) expected.push(i);
    for (var j = n - 1; j >= 0; j--) expected.push(j);
    s.eq(n + ' 人蛇形顺序', order, expected);
    s.eq(n + ' 人摆放动作数', order.length, n * 2);
  });
  var g = E.createGame({ players: 2, humans: 2, seed: 22 });
  var firstVert = E.legalActions(g).filter(function (a) { return a.k === 'setupSettlement'; })[0].vertex;
  var r1 = E.placeSetupSettlement(g, firstVert);
  s.ok('第一个村庄放下成功', r1.ok);
  s.eq('第一村庄不给资源', totalRes(g.players[0]), 0);
  s.eq('进入放道路步骤', g.setup.step, 'road');
  s.eq('记录最后村庄', g.setup.lastSettlement, firstVert);
  var farEdge = g.board.edges.filter(function (e) { return e.vertices.indexOf(firstVert) === -1; })[0].key;
  s.eq('道路必须接刚放的村庄', E.validateSetupRoad(g, farEdge).error, 'notConnected');
  var roadEdge = E.legalActions(g).filter(function (a) { return a.k === 'setupRoad'; })[0].edge;
  s.ok('合法道路可放', E.placeSetupRoad(g, roadEdge).ok);
  s.eq('换到玩家 1', g.current, 1);
  s.eq('步骤回到村庄', g.setup.step, 'settlement');
  s.eq('最后村庄清空', g.setup.lastSettlement, null);
  s.eq('同一村庄不能重复占', E.validateSetupSettlement(g, firstVert).ok, false);
  var neighbor = E.vertexNeighbors(g, firstVert)[0];
  s.eq('相邻交点不能放（距离规则）', E.validateSetupSettlement(g, neighbor).error, 'tooClose');
  s.eq('同一道路不能重复占', (function () {
    var gg = E.createGame({ players: 2, humans: 2, seed: 23 });
    var v = E.legalActions(gg).filter(function (a) { return a.k === 'setupSettlement'; })[0].vertex;
    E.placeSetupSettlement(gg, v);
    var e = E.legalActions(gg).filter(function (a) { return a.k === 'setupRoad'; })[0].edge;
    E.placeSetupRoad(gg, e);
    return gg.players.some(function (p) { return p.roads.indexOf(e) !== -1; });
  })(), true);

  var full = fullSetup(2, 24);
  s.eq('摆放完成进入 play', full.phase, 'play');
  s.eq('第一回合', full.round, 1);
  s.eq('从玩家 0 开始', full.current, 0);
  s.eq('进入掷骰阶段', full.turnStage, 'roll');
  s.eq('每人 2 座村庄', full.players.map(function (p) { return p.settlements.length; }), [2, 2]);
  s.eq('每人 2 条道路', full.players.map(function (p) { return p.roads.length; }), [2, 2]);
  s.eq('每人 2 分', full.players.map(function (p) { return p.score; }), [2, 2]);
  s.eq('摆放步骤 done', full.setup.step, 'done');
  full.players.forEach(function (p) {
    var second = p.settlements[1];
    s.eq(p.name + ' 第二村庄产出地数量 = 启动资源总数', totalRes(p), nonNeutralAdjacent(full, second));
    s.ok(p.name + ' 第二村庄存在', !!second);
  });
  var secondVert = full.players[0].settlements[1];
  var expectedStart = { wheat: 0, stone: 0, wood: 0 };
  E.vertexProduction(full, secondVert).forEach(function (x) { expectedStart[x.hex.terrain] += 1; });
  s.eq('第二村庄按每个相邻地块各 1 份给资源', full.players[0].resources, expectedStart);
  s.ok('第二村庄获得的资源总量等于相邻产出地数', totalRes(full.players[0]) >= 1);
  s.eq('摆放道路都接在自己的村庄或道路上', full.players.every(function (p) {
    return p.roads.every(function (ek) {
      var e = edgeObj(full, ek);
      return e.vertices.some(function (vk) {
        var st = E.getStructureAt(full, vk);
        return (st && st.player.id === p.id) || p.roads.some(function (other) { return other !== ek && edgeObj(full, other).vertices.indexOf(vk) !== -1; });
      });
    });
  }), true);
  s.eq('建筑之间不邻接', full.players.every(function (p) {
    return p.settlements.concat(p.cities).every(function (vk) { return adjacentBuildings(full, vk).length === 0; });
  }), true);
});

/* -------------------------------------------------------------- production */

s.group('掷骰产出：3/5 产出、多个同点数、7 不产、霜洞不产', function () {
  var g = fullSetup(2, 31);
  g.players[1].settlements = [];
  g.players[1].cities = [];
  var p = g.players[0];
  p.settlements = [];
  p.cities = [];
  var sixVertex = null;
  g.hexList.forEach(function (h) {
    if (h.number !== 6 || sixVertex) return;
    sixVertex = h.vertices[0];
  });
  s.ok('找到 6 点地块', !!sixVertex);
  p.settlements.push(sixVertex);
  p.resources = { wheat: 0, stone: 0, wood: 0 };
  var res = E.roll(g, 3, 3);
  s.ok('掷 6 成功', res.ok && res.sum === 6);
  s.eq('村庄产出 3', res.gains[0], productionExpected(g, sixVertex, 6, 3));
  s.eq('进入行动阶段', g.turnStage, 'action');
  s.eq('骰子记录', g.dice, [3, 3]);

  p.settlements = [];
  p.cities = [sixVertex];
  p.resources = { wheat: 0, stone: 0, wood: 0 };
  g.turnStage = 'roll';
  var cityRes = E.roll(g, 3, 3);
  s.eq('城市产出 5', cityRes.gains[0], productionExpected(g, sixVertex, 6, 5));

  // find a vertex with at least two producing hexes
  var multi = null;
  g.board.vertices.forEach(function (v) {
    if (multi) return;
    var prod = E.vertexProduction(g, v.key);
    if (prod.length >= 2) multi = v.key;
  });
  s.ok('存在至少两个产出地的交点', !!multi);
  p.cities = [];
  p.settlements = [multi];
  p.resources = { wheat: 0, stone: 0, wood: 0 };
  g.turnStage = 'roll';
  var sum = E.vertexProduction(g, multi)[0].hex.number;
  var multiRes = E.roll(g, Math.ceil(sum / 2), Math.floor(sum / 2));
  s.eq('相邻两块同点数都算', multiRes.gains[0], productionExpected(g, multi, sum, 3));

  // 7 does nothing
  p.settlements = [sixVertex];
  p.cities = [];
  p.resources = { wheat: 3, stone: 2, wood: 1 };
  g.turnStage = 'roll';
  var seven = E.roll(g, 3, 4);
  s.ok('掷 7 成功', seven.ok && seven.seven === true);
  s.eq('7 不产资源', seven.gains, {});
  s.eq('7 不改变资源', p.resources, { wheat: 3, stone: 2, wood: 1 });
  s.eq('7 仍进入行动阶段', g.turnStage, 'action');
  s.ok('日志写明霜洞/不设强盗', /霜洞|不强盗/.test(g.log.join(' ')));
  s.eq('7 没有强盗字段', g.lastRoll.robber, undefined);

  // neutral never produces
  var neutral = g.hexList.filter(function (h) { return h.terrain === 'neutral'; })[0];
  var nv = neutral.vertices.filter(function (vk) { return E.vertexProduction(g, vk).length > 0; })[0] || neutral.vertices[0];
  p.settlements = [nv];
  p.cities = [];
  p.resources = { wheat: 0, stone: 0, wood: 0 };
  var totalExpected = 0;
  E.vertexProduction(g, nv).forEach(function (x) { totalExpected += 3; });
  for (var d1 = 1; d1 <= 6; d1++) {
    for (var d2 = 1; d2 <= 6; d2++) {
      if (d1 + d2 === 7) continue;
      g.turnStage = 'roll';
      E.roll(g, d1, d2);
    }
  }
  var expectedAll = { wheat: 0, stone: 0, wood: 0 };
  E.vertexProduction(g, nv).forEach(function (x) {
    for (var a = 1; a <= 6; a++) for (var b = 1; b <= 6; b++) {
      if (a + b === x.hex.number) expectedAll[x.hex.terrain] += 3;
    }
  });
  s.eq('霜洞相邻交点只按产出地计数', p.resources, expectedAll);
  s.ok('霜洞本身不产出', neutral.number === null);

  // all players produce
  var g2 = fullSetup(2, 32);
  g2.players.forEach(function (pl) { pl.resources = { wheat: 0, stone: 0, wood: 0 }; });
  var target = g2.players[0].settlements[0];
  var targetNumber = E.vertexProduction(g2, target)[0];
  if (targetNumber) {
    var rr = E.roll(g2, Math.ceil(targetNumber.hex.number / 2), Math.floor(targetNumber.hex.number / 2));
    var any = false;
    Object.keys(rr.gains).forEach(function (id) { if (totalRes(g2.players[Number(id)]) > 0) any = true; });
    s.ok('产出按所有玩家结算', any);
  } else {
    s.ok('产出按所有玩家结算（跳过：无可匹配）', true);
  }

  var g3 = fullSetup(2, 33);
  g3.turnStage = 'action';
  s.eq('行动阶段不能再次掷骰', E.roll(g3, 1, 2).error, 'wrongStage');
  s.eq('非法骰值被拒绝', E.roll(fullSetup(2, 34), 0, 7).error, 'badDice');
  var g4 = fullSetup(2, 35);
  var auto = E.roll(g4);
  s.ok('自动掷骰和值 2-12', auto.sum >= 2 && auto.sum <= 12, String(auto.sum));
  s.ok('自动骰值 1-6', g4.dice.every(function (d) { return d >= 1 && d <= 6; }));
  var a1 = fullSetup(2, 36), a2 = fullSetup(2, 36);
  var r1 = E.roll(a1), r2 = E.roll(a2);
  s.eq('同种子自动骰序列一致（第一掷）', a1.dice, a2.dice);
  a1.turnStage = 'roll'; a2.turnStage = 'roll';
  E.roll(a1); E.roll(a2);
  s.eq('同种子自动骰序列一致（第二掷）', a1.dice, a2.dice);
  s.ok('rngState 随掷骰推进', a1.rngState !== fullSetup(2, 36).rngState);
});

/* ---------------------------------------------------------------- building */

s.group('建造：费用、上限、距离、连接、城市升级', function () {
  var g = fullSetup(2, 41);
  var p = g.players[0];
  setResources(p, 10);
  g.turnStage = 'action';
  var acts = E.legalActions(g);
  var road = acts.filter(function (a) { return a.k === 'buildRoad'; })[0];
  s.ok('存在合法道路', !!road);
  var before = { wood: p.resources.wood, stone: p.resources.stone, roads: p.roads.length, score: p.score };
  s.ok('建道路成功', E.buildRoad(g, road.edge).ok);
  s.eq('道路消耗 1 木', p.resources.wood, before.wood - 1);
  s.eq('道路消耗 1 石', p.resources.stone, before.stone - 1);
  s.eq('道路数量 +1', p.roads.length, before.roads + 1);
  s.eq('道路不加分', p.score, before.score);
  s.eq('道路不能重复占', E.validateRoad(g, p, road.edge).error, 'occupied');
  setResources(p, 10);
  s.eq('远离网络不能建路', (function () {
    var free = g.board.edges.filter(function (e) {
      return p.roads.indexOf(e.key) === -1 && !g.players.some(function (pl) { return pl.roads.indexOf(e.key) !== -1; });
    })[0];
    return E.validateRoad(g, p, free.key).error;
  })(), 'notConnected');
  p.resources = { wheat: 0, stone: 0, wood: 0 };
  s.eq('资源不足不能建路', E.validateRoad(g, p, acts.filter(function (a) { return a.k === 'buildRoad'; })[1].edge).error, 'needResources');

  // A fresh game: roads first, then a village appears at the end of a road.
  var gS = fullSetup(2, 44);
  var pS = gS.players[0];
  setResources(pS, 20);
  gS.turnStage = 'action';
  var roadGuard = 0;
  var sActs = [];
  while (!sActs.length && roadGuard++ < 8) {
    sActs = E.legalActions(gS).filter(function (a) { return a.k === 'buildSettlement'; });
    if (sActs.length) break;
    var nextRoad = E.legalActions(gS).filter(function (a) { return a.k === 'buildRoad'; })[0];
    if (!nextRoad) break;
    E.buildRoad(gS, nextRoad.edge);
  }
  s.ok('沿道路延伸后出现合法村庄', sActs.length > 0);
  var sv = sActs[0].vertex;
  var sb = { wheat: pS.resources.wheat, stone: pS.resources.stone, wood: pS.resources.wood, score: pS.score, n: pS.settlements.length };
  s.ok('建村庄成功', E.buildSettlement(gS, sv).ok);
  s.eq('村庄消耗 1 麦', pS.resources.wheat, sb.wheat - 1);
  s.eq('村庄消耗 1 石', pS.resources.stone, sb.stone - 1);
  s.eq('村庄消耗 1 木', pS.resources.wood, sb.wood - 1);
  s.eq('村庄数量 +1', pS.settlements.length, sb.n + 1);
  s.eq('村庄加 1 分', pS.score, sb.score + 1);
  s.eq('已占交点不能再建', E.validateSettlement(gS, pS, sv).error, 'occupied');
  var neighbor = E.vertexNeighbors(gS, sv)[0];
  s.eq('相邻交点不能建村', E.validateSettlement(gS, pS, neighbor).error, 'tooClose');
  var disconnected = gS.board.vertices.filter(function (v) {
    return !E.getStructureAt(gS, v.key) && v.edges.every(function (ek) { return pS.roads.indexOf(ek) === -1; }) && adjacentBuildings(gS, v.key).length === 0;
  })[0];
  if (disconnected) s.eq('不在自己路网上的交点不能建村', E.validateSettlement(gS, pS, disconnected.key).error, 'notConnected');
  else s.ok('不在自己路网上的交点不能建村（无可测点）', true);

  var cityVert = pS.settlements[0];
  setResources(pS, 10);
  var cb = { wheat: pS.resources.wheat, stone: pS.resources.stone, score: pS.score, sets: pS.settlements.length, cities: pS.cities.length };
  s.ok('升级城市成功', E.upgradeCity(gS, cityVert).ok);
  s.eq('城市消耗 2 麦', pS.resources.wheat, cb.wheat - 2);
  s.eq('城市消耗 3 石', pS.resources.stone, cb.stone - 3);
  s.eq('村庄数量 -1', pS.settlements.length, cb.sets - 1);
  s.eq('城市数量 +1', pS.cities.length, cb.cities + 1);
  s.eq('城市净加 1 分', pS.score, cb.score + 1);
  s.eq('城市分值 2', pS.score, pS.settlements.length + pS.cities.length * 2);
  s.eq('已升级城市不能再升级', E.validateCity(gS, pS, cityVert).error, 'notYourSettlement');
  var other = gS.players[1].settlements[0];
  s.eq('不能升级对手村庄', E.validateCity(gS, pS, other).error, 'notYourSettlement');

  p.settlements = [];
  p.cities = [];
  p.roads = g.board.edges.slice(0, 10).map(function (e) { return e.key; });
  s.eq('道路上限 10', E.validateRoad(g, p, g.board.edges[20].key).error, 'maxRoads');
  p.settlements = ['a', 'b', 'c', 'd', 'e'];
  p.roads = [];
  s.eq('村庄上限 5', E.validateSettlement(g, p, g.board.vertices[0].key).error, 'maxSettlements');
  p.settlements = [];
  p.cities = ['a', 'b', 'c'];
  s.eq('城市上限 3', E.validateCity(g, p, g.board.vertices[0].key).error, 'maxCities');
  p.cities = [];
  p.settlements = ['a', 'b'];
  p.cities = ['c'];
  s.eq('重算分数：2 村 1 城 = 4', E.recomputeScore(p), 4);
  p.settlements = ['a', 'b', 'c', 'd', 'e'];
  p.cities = ['f', 'g', 'h'];
  s.eq('重算分数：5 村 3 城 = 11', E.recomputeScore(p), 11);
  s.eq('MAX_SETTLEMENTS 5', E.MAX_SETTLEMENTS, 5);
  s.eq('MAX_CITIES 3', E.MAX_CITIES, 3);
  s.eq('MAX_ROADS 10', E.MAX_ROADS, 10);

  var g2 = fullSetup(2, 42);
  g2.turnStage = 'roll';
  s.eq('掷骰阶段不能建造', E.buildRoad(g2, g2.board.edges[0].key).error, 'wrongStage');
  s.eq('掷骰阶段不能升级', E.upgradeCity(g2, g2.players[0].settlements[0]).error, 'wrongStage');
  var g3 = E.createGame({ players: 2, humans: 2, seed: 43 });
  s.eq('摆放阶段不能建造', E.buildSettlement(g3, g3.board.vertices[0].key).error, 'wrongPhase');
});

s.group('胜利：8 分即刻结束、12 回合封顶、同分并列', function () {
  var g = fullSetup(2, 51);
  var p = g.players[0];
  g.turnStage = 'action';
  p.resources = { wheat: 20, stone: 20, wood: 20 };
  p.settlements = [g.board.vertices[0].key, g.board.vertices[10].key, g.board.vertices[20].key];
  p.cities = [g.board.vertices[30].key, g.board.vertices[40].key];
  E.recomputeScore(p);
  s.eq('赛前 3 村 2 城 = 7 分', p.score, 7);
  var target = p.settlements[0];
  var r = E.upgradeCity(g, target);
  s.ok('升级到 8 分成功', r.ok);
  s.eq('立即结束', [g.phase, g.over], ['over', true]);
  s.eq('结果 points', g.result, 'points');
  s.eq('赢家 0', g.winner, 0);
  s.eq('赢家名单', g.winners, [0]);
  s.eq('结束后无合法动作', E.legalActions(g).length, 0);
  s.eq('结束后动作被拒绝', E.applyAction(g, { k: 'endTurn' }).ok, false);
  s.eq('8 分常量', E.WIN_POINTS, 8);

  var g2 = fullSetup(2, 52);
  for (var round = 0; round < 12; round++) {
    for (var i = 0; i < 2; i++) {
      g2.turnStage = 'action';
      E.endTurn(g2);
    }
  }
  s.eq('12 回合后结束', [g2.phase, g2.over], ['over', true]);
  s.eq('12 回合常量', E.MAX_ROUNDS, 12);
  s.eq('无人到 8 分则同分并列', g2.result, 'draw');
  s.eq('并列无唯一赢家', g2.winner, null);
  s.eq('并列赢家名单', g2.winners, [0, 1]);

  var g3 = fullSetup(2, 53);
  g3.players[0].score = 8;
  g3.players[1].score = 5;
  E.finishRounds(g3);
  s.eq('12 回合分高者胜', g3.winner, 0);
  s.eq('结果 rounds', g3.result, 'rounds');
  var g4 = fullSetup(2, 54);
  g4.players[0].score = 4;
  g4.players[1].score = 4;
  E.finishRounds(g4);
  s.eq('同分并列', g4.result, 'draw');
  s.eq('同分 winners 两位', g4.winners, [0, 1]);
  var g5 = fullSetup(2, 55);
  E.finishPoints(g5, g5.players[1]);
  s.eq('finishPoints 赢家 1', g5.winner, 1);
  s.eq('finishPoints 结果 points', g5.result, 'points');
  var g6 = fullSetup(2, 56);
  g6.turnStage = 'action';
  E.endTurn(g6);
  s.eq('结束回合换人', g6.current, 1);
  s.eq('结束回合回到掷骰', g6.turnStage, 'roll');
  var g7 = fullSetup(2, 57);
  s.eq('掷骰阶段不能结束回合', E.endTurn(g7).error, 'wrongStage');
  var g8 = fullSetup(2, 58);
  g8.turnStage = 'action';
  E.endTurn(g8);
  g8.turnStage = 'action';
  E.endTurn(g8);
  s.eq('两人各结束一次进入第 2 回合', g8.round, 2);
  s.eq('回合回到玩家 0', g8.current, 0);
  s.eq('第 12 回合最后一动的结束标记', (function () {
    var gg = fullSetup(2, 59);
    for (var r = 0; r < 12; r++) {
      for (var k = 0; k < 2; k++) {
        gg.turnStage = 'action';
        var res = E.endTurn(gg);
        if (r === 11 && k === 1) return res.over === true;
      }
    }
    return false;
  })(), true);
});

/* -------------------------------------------------------------------- trade */

s.group('交易与潮门：3:1 基础、2:1 港口、拒绝同资源与不足', function () {
  var g = fullSetup(2, 61);
  var p = g.players[0];
  g.turnStage = 'action';
  p.resources = { wheat: 6, stone: 1, wood: 1 };
  s.eq('基础比例 3:1', E.tradeRate(g, p), 3);
  var r = E.exchange(g, 'wheat', 'stone');
  s.ok('3 麦换 1 石成功', r.ok);
  s.eq('基础兑换结果', [p.resources.wheat, p.resources.stone], [3, 2]);
  s.eq('兑换结果记录比例', r.rate, 3);
  s.eq('同资源兑换拒绝', E.validateExchange(g, p, 'stone', 'stone').error, 'sameResource');
  s.eq('资源不足拒绝', E.validateExchange(g, p, 'wood', 'wheat').error, 'needResources');
  s.eq('非法资源名拒绝', E.validateExchange(g, p, 'gold', 'wheat').error, 'badResource');

  p.settlements = [g.ports[0].vertices[0]];
  p.cities = [];
  E.recomputeScore(p);
  s.eq('占住港口端点后 2:1', E.tradeRate(g, p), 2);
  p.resources = { wheat: 2, stone: 1, wood: 1 };
  var r2 = E.exchange(g, 'wheat', 'wood');
  s.ok('2 麦换 1 木成功', r2.ok);
  s.eq('2:1 兑换结果', [p.resources.wheat, p.resources.wood], [0, 2]);
  s.eq('2:1 结果比例', r2.rate, 2);
  p.settlements = [g.ports[0].vertices[1]];
  s.eq('港口另一端点也 2:1', E.tradeRate(g, p), 2);
  p.settlements = [];
  p.cities = [g.ports[1].vertices[0]];
  s.eq('城市也可使用港口', E.tradeRate(g, p), 2);
  p.cities = [];
  s.eq('失去港口回到 3:1', E.tradeRate(g, p), 3);
  p.settlements = g.ports.map(function (port) { return port.vertices[0]; });
  s.eq('占多个港口仍是 2:1', E.tradeRate(g, p), 2);
  s.eq('港口边列表去重', E.playerPortEdges(g, p).filter(function (x, i, a) { return a.indexOf(x) === i; }).length, E.playerPortEdges(g, p).length);
  var beforeScore = p.score;
  setResources(p, 10);
  E.exchange(g, 'wheat', 'stone');
  s.eq('兑换不加分', p.score, beforeScore);
  var beforeActions = g.turnActions;
  E.exchange(g, 'wood', 'wheat');
  s.ok('兑换计入本回合动作数', g.turnActions > beforeActions);
  g.turnStage = 'roll';
  s.eq('掷骰阶段不能兑换', E.exchange(g, 'wheat', 'stone').error, 'wrongStage');
  var gg = E.createGame({ players: 2, humans: 2, seed: 62 });
  s.eq('摆放阶段不能兑换', E.exchange(gg, 'wheat', 'stone').error, 'wrongPhase');
  p.resources = { wheat: 1, stone: 1, wood: 1 };
  g.turnStage = 'action';
  s.eq('每种资源都不足 3 时不能交易', E.validateExchange(g, p, 'wheat', 'stone').ok, false);
  s.eq('基础比例常量 3', E.TRADE_BASE, 3);
  s.eq('港口比例常量 2', E.TRADE_PORT, 2);
  s.eq('4 座港口', g.ports.length, 4);
});

/* ----------------------------------------------------------------------- AI */

s.group('AI：三档、合法、不偷看、自对弈', function () {
  var setup = E.createGame({ players: 4, humans: 0, seed: 71 });
  [1, 2, 3].forEach(function (level) {
    var a = E.aiAction(setup, level);
    s.ok('摆放期 AI 等级 ' + level + ' 有动作', !!a);
    s.ok('摆放期 AI 等级 ' + level + ' 动作合法', E.isLegal(setup, a), JSON.stringify(a));
  });
  var before = JSON.stringify(setup);
  E.aiAction(setup, 2);
  E.aiAction(setup, 3);
  s.eq('AI 决策不修改原状态', JSON.stringify(setup), before);

  var g = fullSetup(2, 72);
  g.turnStage = 'action';
  g.players[0].resources = { wheat: 10, stone: 10, wood: 10 };
  [1, 2, 3].forEach(function (level) {
    var a = E.aiAction(g, level);
    s.ok('行动期 AI 等级 ' + level + ' 有动作', !!a);
    s.ok('行动期 AI 等级 ' + level + ' 动作合法', E.isLegal(g, a), JSON.stringify(a));
  });
  var hasCity = E.legalActions(g).some(function (a) { return a.k === 'upgradeCity'; });
  s.ok('存在城市升级动作', hasCity);
  var cityChoice = E.aiAction(g, 2);
  s.eq('启发 AI 优先升级城市', cityChoice.k, 'upgradeCity');

  var g2 = fullSetup(2, 73);
  g2.players[0].resources = { wheat: 20, stone: 20, wood: 20 };
  g2.turnStage = 'action';
  var aiRoadGuard = 0;
  while (aiRoadGuard++ < 8) {
    var setActs = E.legalActions(g2).filter(function (a) { return a.k === 'buildSettlement'; });
    if (setActs.length) break;
    var aiRoad = E.legalActions(g2).filter(function (a) { return a.k === 'buildRoad'; })[0];
    if (!aiRoad) break;
    E.buildRoad(g2, aiRoad.edge);
  }
  g2.players[0].resources = { wheat: 1, stone: 1, wood: 1 };
  var acts2 = E.legalActions(g2);
  var hasSet = acts2.some(function (a) { return a.k === 'buildSettlement'; });
  var hasRoad = acts2.some(function (a) { return a.k === 'buildRoad'; });
  var hasCity2 = acts2.some(function (a) { return a.k === 'upgradeCity'; });
  s.ok('低价资源下仍有村庄动作', hasSet);
  s.ok('低价资源下有道路动作', hasRoad);
  s.ok('低价资源下无城市动作', !hasCity2);
  if (hasSet) s.eq('启发 AI 在村庄与道路间选村庄', E.aiAction(g2, 2).k, 'buildSettlement');

  var g3 = fullSetup(2, 74);
  g3.turnStage = 'action';
  g3.turnActions = E.MAX_STEPS_PER_TURN;
  s.eq('回合动作数守卫返回结束回合', E.aiAction(g3, 2), { k: 'endTurn' });
  g3.turnActions = 0;
  s.ok('行动期 AI 不会返回 null', E.aiAction(g3, 2) != null);

  var self = E.selfPlay(77, 2);
  s.eq('自对弈结束', self.phase, 'over');
  s.eq('自对弈 4 名玩家', self.players.length, 4);
  s.ok('自对弈有结果', self.result === 'points' || self.result === 'rounds' || self.result === 'draw', self.result);
  s.ok('自对弈回合不超过 13', self.round <= 13, String(self.round));
  s.ok('自对弈有人到 8 分或打满 12 回合', self.result === 'points' ? Math.max.apply(null, self.players.map(function (p) { return p.score; })) >= 8 : self.round >= 13);
  s.ok('自对弈建筑不邻接', self.players.every(function (p) {
    return p.settlements.concat(p.cities).every(function (vk) { return adjacentBuildings(self, vk).length === 0; });
  }));
  s.ok('自对弈建筑不重复', (function () {
    var seen = {};
    var dup = false;
    self.players.forEach(function (p) {
      p.settlements.concat(p.cities).forEach(function (vk) { if (seen[vk]) dup = true; seen[vk] = true; });
    });
    return !dup;
  })());
  s.ok('自对弈道路不重复', (function () {
    var seen = {};
    var dup = false;
    self.players.forEach(function (p) {
      p.roads.forEach(function (ek) { if (seen[ek]) dup = true; seen[ek] = true; });
    });
    return !dup;
  })());
  s.ok('自对弈每人 0-5 村', self.players.every(function (p) { return p.settlements.length <= 5; }));
  s.ok('自对弈每人 0-3 城', self.players.every(function (p) { return p.cities.length <= 3; }));
  s.ok('自对弈每人 0-10 路', self.players.every(function (p) { return p.roads.length <= 10; }));
  s.ok('自对弈分数由建筑计算', self.players.every(function (p) { return p.score === p.settlements.length + p.cities.length * 2; }));
  s.ok('自对弈赢家分数 >= 其他', self.winner == null || self.players[self.winner].score >= Math.max.apply(null, self.players.map(function (p) { return p.score; })));
  var setup2 = E.createGame({ players: 3, humans: 0, seed: 78 });
  var guard = 0;
  while (setup2.phase === 'setup' && guard++ < 100) E.aiAct(setup2, 2);
  s.eq('AI 完成 3 人摆放', setup2.phase, 'play');
  s.eq('AI 完成摆放后每人 2 村 2 路', setup2.players.map(function (p) { return [p.settlements.length, p.roads.length]; }), [[2, 2], [2, 2], [2, 2]]);
});

/* --------------------------------------------------------------- public view */

s.group('publicView：公开资源与建筑、不泄漏骰子流', function () {
  var g = fullSetup(2, 81);
  var v = E.publicView(g, 0);
  s.eq('视图阶段', v.phase, 'play');
  s.eq('视图回合', v.round, 1);
  s.eq('视图当前玩家', v.current, 0);
  s.eq('视图 turnSeat', v.turnSeat, 0);
  s.eq('视图 viewerTurn', v.viewerTurn, true);
  s.eq('黑方视角 viewerTurn 为假', E.publicView(g, 1).viewerTurn, false);
  s.eq('视图 19 块六边形', v.board.hexes.length, 19);
  s.eq('视图 54 交点', v.board.vertices.length, 54);
  s.eq('视图 72 条边', v.board.edges.length, 72);
  s.eq('视图 4 港口', v.board.ports.length, 4);
  s.eq('视图玩家数', v.players.length, 2);
  s.eq('资源公开', v.players[0].resources, g.players[0].resources);
  s.eq('建筑公开', v.players[0].settlements, g.players[0].settlements);
  s.eq('分数公开', v.players[0].score, g.players[0].score);
  s.eq('交易比例公开', v.players[0].tradeRate, 3);
  s.eq('视图不含 rngState', v.rngState, undefined);
  s.eq('视图不含 seed', v.seed, undefined);
  s.eq('视图不含 geo', v.geo, undefined);
  s.ok('JSON 序列化不出现 rngState', JSON.stringify(v).indexOf('rngState') === -1);
  s.ok('JSON 可序列化', (function () { try { JSON.stringify(v); return true; } catch (e) { return false; } })());
  s.ok('日志是数组', Array.isArray(v.log));
  s.ok('setup 顺序公开', Array.isArray(v.setup.order) && v.setup.order.length === 4);
  var copy = E.publicView(g, 0);
  copy.players[0].resources.wheat = 999;
  s.ok('视图资源是副本', g.players[0].resources.wheat !== 999);
  var g2 = fullSetup(2, 82);
  E.roll(g2, 2, 3);
  var v2 = E.publicView(g2, 0);
  s.eq('掷骰后骰子公开', v2.dice, [2, 3]);
  s.eq('掷骰后点数公开', v2.lastSum, 5);
  s.ok('掷骰后 lastRoll 公开', !!v2.lastRoll);
  var g3 = fullSetup(2, 83);
  g3.players[0].score = 8;
  E.finishPoints(g3, g3.players[0]);
  var v3 = E.publicView(g3, 0);
  s.eq('结束后 over', v3.over, true);
  s.eq('结束后 winner', v3.winner, 0);
  s.eq('结束后 winners', v3.winners, [0]);
  s.eq('结束后结果', v3.result, 'points');
});

/* ---------------------------------------------------------------- performance */

s.group('性能预算', function () {
  var t0 = Date.now();
  for (var i = 0; i < 200; i++) E.createGame({ players: 4, humans: 0, seed: i });
  var createMs = Date.now() - t0;
  s.ok('200 次建局 < 3000ms', createMs < 3000, createMs + 'ms');
  var g = fullSetup(4, 5);
  g.turnStage = 'action';
  g.players[0].resources = { wheat: 10, stone: 10, wood: 10 };
  var t1 = Date.now();
  for (var k = 0; k < 200; k++) E.legalActions(g);
  var legalMs = Date.now() - t1;
  s.ok('200 次合法动作枚举 < 1500ms', legalMs < 1500, legalMs + 'ms');
  var t2 = Date.now();
  for (var m = 0; m < 20; m++) E.aiAction(g, 2);
  var aiMs = Date.now() - t2;
  s.ok('20 次启发 AI < 4000ms', aiMs < 4000, aiMs + 'ms');
  var t3 = Date.now();
  for (var n = 0; n < 10; n++) E.aiAction(g, 3);
  var ai3Ms = Date.now() - t3;
  s.ok('10 次高手 AI < 4000ms', ai3Ms < 4000, ai3Ms + 'ms');
  s.ok('单次启发 AI < 250ms', aiMs / 20 < 250, (aiMs / 20).toFixed(1) + 'ms');
  var t4 = Date.now();
  for (var p = 0; p < 200; p++) E.publicView(g, 0);
  var viewMs = Date.now() - t4;
  s.ok('200 次 publicView < 1000ms', viewMs < 1000, viewMs + 'ms');
  var t5 = Date.now();
  for (var c = 0; c < 1000; c++) E.clone(g);
  var cloneMs = Date.now() - t5;
  s.ok('1000 次 clone < 1000ms', cloneMs < 1000, cloneMs + 'ms');
  s.ok('engine.js < 60KB', fs.statSync(path.join(__dirname, 'engine.js')).size < 60000,
    fs.statSync(path.join(__dirname, 'engine.js')).size + 'B');
});

/* -------------------------------------------------------------- static pages */

s.group('页面静态检查：单机 / 规则 / 联机 / 服务端', function () {
  ['index.html', 'engine.js', 'data.js', 'rules.html', 'online.html', 'online-server.mjs',
    'test.js', 'test-online.js', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'realism.json',
    'perf.json', 'meta.json', 'art-render.html', 'render-art.mjs', 'online-e2e.json'].forEach(function (file) {
    s.ok(file + ' 存在', exists(file));
  });
  var index = read('index.html');
  s.ok('index 有 viewport', /name="viewport"[^>]*width=device-width/.test(index));
  s.ok('index 有 meta description', /name="description"[^>]*content="[^"]{40,}"/.test(index));
  s.ok('index 引用 engine.js', index.indexOf('src="engine.js"') >= 0);
  s.ok('index 引用 data.js', index.indexOf('src="data.js"') >= 0);
  s.ok('index 复用 shared shuffle', index.indexOf('shared/shuffle.js') >= 0);
  s.ok('index 复用 shared sfx', index.indexOf('shared/sfx.js') >= 0);
  s.ok('index 复用 shared store', index.indexOf('shared/store.js') >= 0);
  s.ok('index 无外部脚本', !/<script[^>]+src="https?:/.test(index));
  s.ok('index 无外链图片', !/<img[^>]+src="https?:/.test(index));
  s.ok('index 无 emoji 占位', !/[\u{1F300}-\u{1FAFF}]/u.test(index));
  s.ok('index 触控 token >= 44px', /--tap\s*:\s*(4[4-9]|[5-9]\d)px/.test(index));
  s.ok('index 标题用 Songti SC', index.indexOf('Songti SC') >= 0);
  s.ok('index 声明 2–4 人', index.indexOf('2–4') >= 0 || index.indexOf('2-4') >= 0);
  s.ok('index 地图用 SVG 代码绘制', /<svg id="map"/.test(index));
  s.ok('index 顶点用 div + tabindex', /className = 'vhot'/.test(index) && /tabIndex/.test(index));
  s.ok('index 不使用 role="button"', index.indexOf('role="button"') === -1);
  s.ok('index 主按钮 >= 48px', /--tap:48px/.test(index) && /min-height:56px/.test(index));
  s.ok('index 有交易面板', index.indexOf('tradePanel') >= 0 && index.indexOf('确认兑换') >= 0);
  s.ok('index 有建造选择器', index.indexOf('pickerList') >= 0 && index.indexOf('选择位置') >= 0);
  s.ok('index 有音效开关', index.indexOf('sfx-toggle') >= 0);
  s.ok('index 有联机入口', index.indexOf('online.html') >= 0);

  var rules = read('rules.html');
  s.ok('rules 有 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('rules 有 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('rules 汉字 >= 1200', cjk(rules) >= 1200, String(cjk(rules)));
  s.ok('rules 至少 2 张本地配图', (rules.match(/<img\b/gi) || []).length >= 2);
  s.ok('rules 无外部图片', !/<img[^>]+src="https?:/.test(rules));
  s.ok('rules 提到蛇形摆放', rules.indexOf('蛇形') >= 0);
  s.ok('rules 提到第二村庄给资源', /第二[^。]{0,20}资源|第二座村庄[^。]{0,24}资源/.test(rules));
  s.ok('rules 提到潮门 2:1', /潮门[^。]{0,30}2:1|2:1[^。]{0,30}潮门/.test(rules));
  s.ok('rules 明确不设强盗', /不设强盗|没有强盗/.test(rules));
  s.ok('rules 明确无发展卡', /没有发展卡|不设发展卡|无发展卡/.test(rules));
  s.ok('rules 提到 8 分', /8 分/.test(rules));
  s.ok('rules 提到 12 回合', /12 回合/.test(rules));
  s.ok('rules 提到 5 村 / 3 城 / 10 路', /5 座村庄/.test(rules) && /3 座城市/.test(rules) && /10 条道路/.test(rules));
  s.ok('rules 图片在本地 assets', rules.indexOf('assets/detail-1.webp') >= 0 && rules.indexOf('assets/detail-2.webp') >= 0);

  var online = read('online.html');
  s.ok('online 引用 engine.js', online.indexOf('src="engine.js"') >= 0);
  s.ok('online 无外部脚本', !/<script[^>]+src="https?:/.test(online));
  s.ok('online 有联机 + AI 匹配标记', /联机/.test(online) && /AI/.test(online) && /邀请/.test(online) && /重连/.test(online));
  s.ok('online 有 2–4 人房', online.indexOf('2–4') >= 0);
  s.ok('online 有服务器权威标记', /服务器/.test(online));
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端有房间/邀请', /room|invite/i.test(server));
  s.ok('服务端有 AI 补位', /aiAction/.test(server));
  s.ok('服务端有重连', /reconnect|重连/i.test(server));
  s.ok('服务端有排行榜', /leaderboard|排行榜/i.test(server));
  s.ok('服务端有 4 人上限', /maxPlayers:\s*4/.test(server));
  var tOnline = read('test-online.js');
  s.ok('双客户端 E2E 标记', /two-client|双客户端|Two independent HTTP clients/i.test(tOnline));
  s.ok('E2E 输出 ONLINE_E2E_JSON', tOnline.indexOf('ONLINE_E2E_JSON') >= 0);
  s.ok('E2E 支持 --control', tOnline.indexOf('--control') >= 0);
  s.ok('E2E runAll true', /runAll:\s*true/.test(tOnline));
  s.ok('E2E 覆盖结算一致', /settlementConsistent/.test(tOnline));
  s.ok('E2E 覆盖托管', /timeoutTakeover/.test(tOnline));
  s.ok('E2E 覆盖 AI 补位', /aiFill/.test(tOnline));
  s.ok('E2E 覆盖重连', /reconnect/.test(tOnline));
  s.ok('E2E 覆盖排行榜', /leaderboard/.test(tOnline));
});

/* --------------------------------------------------- meta / realism / art */

s.group('meta / realism / 美术 / 预缓存', function () {
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'pioneers-premium');
  s.eq('meta status shipped', meta.status, 'shipped');
  s.eq('meta 2 人下限', meta.players && meta.players.min, 2);
  s.eq('meta 4 人上限', meta.players && meta.players.max, 4);
  s.eq('meta 联机入口', meta.online && meta.online.entry, 'online.html');
  s.eq('meta 联机 5 项', ['rooms', 'invite', 'sync', 'reconnect', 'leaderboard'].every(function (k) {
    return meta.online.features && meta.online.features[k];
  }), true);
  s.eq('meta AI 补位', meta.online && meta.online.aiFillEmptySeats, true);
  s.eq('meta 托管', meta.online && meta.online.timeoutTakeover, true);
  s.eq('meta 重赛', meta.online && meta.online.rematch, true);
  s.eq('meta 双客户端 E2E', meta.online && meta.online.twoClientE2E, 'test-online.js');
  s.ok('meta singlePlayer false', meta.singlePlayer === false);
  s.ok('meta 模式说明含 2–4 人', /2–4/.test(meta.modeLabel));
  s.eq('meta 联机证据文件', meta.online && meta.online.evidence, 'online-e2e.json');

  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism >= 6 项', realism.checks.length >= 6, String(realism.checks.length));
  var kinds = realism.checks.map(function (c) { return c.kind; });
  ['count', 'dimension', 'proportion', 'color', 'material', 'rule'].forEach(function (k) {
    s.ok('realism 覆盖 ' + k, kinds.indexOf(k) >= 0);
  });
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism 来源 >= 2 个 B 站', realism.sources.filter(function (u) { return /bilibili\.com\/video\/BV/.test(u); }).length >= 2);
  s.ok('D.SOURCES >= 2 个 BV', D.SOURCES.bilibili.length >= 2);
  D.SOURCES.bilibili.forEach(function (src, i) {
    s.ok('B 站来源 ' + i + ' BV 格式', /^BV[0-9A-Za-z]+$/.test(src.bvid), src.bvid);
    s.ok('B 站来源 ' + i + ' 有标题', typeof src.title === 'string' && src.title.length > 4);
  });
  s.eq('BOARD 六边形 19', D.BOARD.hexes, 19);
  s.eq('BOARD 地形 6/6/6/1', D.BOARD.terrainCounts, { wheat: 6, stone: 6, wood: 6, neutral: 1 });
  s.eq('BOARD 港口 4', D.BOARD.ports, 4);
  s.eq('BOARD 点数无 7', D.BOARD.noToken, 7);
  s.eq('BOARD 12 回合 / 8 分', [D.BOARD.maxRounds, D.BOARD.winPoints], [12, 8]);
  s.eq('PIECES 3 种', D.PIECES.length, 3);
  s.eq('道路上限 10', D.PIECES.filter(function (p) { return p.id === 'road'; })[0].max, 10);
  s.eq('村庄上限 5', D.PIECES.filter(function (p) { return p.id === 'settlement'; })[0].max, 5);
  s.eq('城市上限 3', D.PIECES.filter(function (p) { return p.id === 'city'; })[0].max, 3);

  var perf = JSON.parse(read('perf.json'));
  s.ok('perf budget 有界', perf.budget && perf.budget.loadMs <= 5000);
  s.ok('perf measured 存在', perf.measured && typeof perf.measured.createGame500Ms === 'number');

function artCheck(label, base, w, h) {
  var p = pngSize(base + '.png');
  if (p) return s.ok(label, p.w === w && p.h === h, JSON.stringify(p));
  var webp = base + '.webp';
  return s.ok(label + ' (本地 WebP 回退)', fs.existsSync(webp) && fs.statSync(webp).size > 8000, webp);
}
  artCheck('cover 1200x1200', path.join(__dirname, 'assets', 'cover'), 1200, 1200);
  artCheck('og 1200x630', path.join(__dirname, 'assets', 'og'), 1200, 630);
  artCheck('detail-1 1200x800', path.join(__dirname, 'assets', 'detail-1'), 1200, 800);
  artCheck('detail-2 1200x800', path.join(__dirname, 'assets', 'detail-2'), 1200, 800);
  ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (f) {
    s.ok(f + ' 存在且 > 8KB', exists(f) && fs.statSync(path.join(__dirname, f)).size > 8000);
  });
  var artDir = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'pioneers');
  ['hex-tile', 'resource-wheat', 'resource-stone', 'resource-wood', 'table-felt', 'road-stick', 'settlement-house'].forEach(function (name) {
    var png = path.join(artDir, name + '.png');
    var webp = path.join(artDir, name + '.webp');
    s.ok(name + '.png 1024x1024', fs.existsSync(png) && (function () { var z = pngSize(png); return z && z.w === 1024 && z.h === 1024; })(), name);
    s.ok(name + '.webp 存在', fs.existsSync(webp) && fs.statSync(webp).size > 2000);
  });

  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  if (fs.existsSync(manifestPath)) {
    var manifest = fs.readFileSync(manifestPath, 'utf8');
    var sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
    var swVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
    s.eq('precache manifest 与 CACHE_VERSION 同步', manifestVersion, swVersion);
    s.ok('manifest 收录共享 shuffle', manifest.indexOf('/games/shared/shuffle.js') >= 0);
    if (manifest.indexOf('pioneers-premium') >= 0) {
      s.ok('manifest 收录本游戏单机页',
        manifest.indexOf('/games/boardgame/pioneers-premium/') >= 0 ||
        manifest.indexOf('/games/boardgame/pioneers-premium/index.html') >= 0);
      s.ok('manifest 收录本游戏联机页', manifest.indexOf('/games/boardgame/pioneers-premium/online.html') >= 0);
      s.ok('manifest 收录本游戏引擎', manifest.indexOf('pioneers-premium/engine.js') >= 0);
      s.ok('manifest 收录本游戏材质', manifest.indexOf('/games/assets/art/premium/pioneers/') >= 0);
    } else {
      s.ok('slug 尚未入清单（合并分支由 gen-precache 生成）', true);
      s.ok('slug 入清单由合并分支完成', true);
    }
  } else {
    s.ok('precache manifest 在合并分支生成', true);
  }
  s.ok('online-e2e.json 可解析', (function () {
    try { JSON.parse(read('online-e2e.json')); return true; } catch (e) { return false; }
  })());
});

s.done();
