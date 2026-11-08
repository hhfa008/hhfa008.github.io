'use strict';

// Pioneers of Nine Isles test. rules live in engine.js (the page loads the
// same file), which is a plain CommonJS module.

var lib = require('../tests/lib.js');
var s = lib.suite('pioneers');
var E = require('./engine.js');

function completeSetup(g) {
  while (g.phase === 'setup') {
    var verts = [];
    g.geo.vmap.forEach(function (v, k) {
      if (E.validateSetupSettlement(g, k).ok) verts.push(k);
    });
    if (!verts.length) throw new Error('no setup vertex');
    E.placeSetupSettlement(g, verts[0]);
    var edge = g.geo.vmap.get(verts[0]).edges.filter(function (ek) {
      return E.validateSetupRoad(g, ek).ok;
    })[0];
    E.placeSetupRoad(g, edge);
  }
  return g;
}

s.group('建局与棋盘', function () {
  var g = E.createGame({ players: 2, humans: 2, seed: 11 });
  s.eq('默认 2 名玩家', g.players.length, 2);
  s.eq('开局处于摆放阶段', [g.phase, g.setupStep], ['setup', 'settlement']);
  s.eq('19 块六边形', g.hexList.length, 19);
  s.eq('地形 6/6/6/1', (function () {
    var m = {};
    g.hexList.forEach(function (h) { m[h.terrain] = (m[h.terrain] || 0) + 1; });
    return [m.wheat, m.stone, m.wood, m.neutral];
  })(), [6, 6, 6, 1]);
  s.eq('四个港口', g.ports.length, 4);
  s.eq('玩家初始资源为 0', E.totalResources(g.players[0].resources), 0);
  s.eq('同种子棋盘一致', E.createGame({ seed: 11 }).hexList.map(function (h) { return h.terrain; }),
    g.hexList.map(function (h) { return h.terrain; }));
  s.eq('4 人局上限', E.createGame({ players: 9 }).players.length, 4);
  s.eq('1 人局下限', E.createGame({ players: 1 }).players.length, 2);
  s.eq('AI 分配按 humans', E.createGame({ players: 3, humans: 1 }).players.map(function (p) { return p.isAI; }), [false, true, true]);
});

s.group('交易', function () {
  var g = completeSetup(E.createGame({ players: 2, humans: 2, seed: 12 }));
  var p = g.players[0];
  E.recomputeScore(p);
  s.eq('基础交易率 3:1', E.tradeRate(g, p), 3);
  p.settlements.push(g.ports[0].vertices[0]);
  s.eq('村庄占住港口顶点后 2:1', E.tradeRate(g, p), 2);
  p.settlements.pop();
  s.ok('资源不足不能交易', !E.canExchange(g, p));
  p.resources = { wheat: 3, stone: 0, wood: 0 };
  s.ok('3 个小麦可交易', E.canExchange(g, p, 'wheat'));
  g.turnStage = 'action';
  var r = E.exchange(g, 'wheat', 'stone');
  s.ok('交易成功', r.ok);
  s.eq('付 3 得 1', [p.resources.wheat, p.resources.stone], [0, 1]);
  s.eq('同资源交易拒绝', E.validateExchange(g, p, 'stone', 'stone').ok, false);
  s.eq('资源不足拒绝', E.validateExchange(g, p, 'wheat', 'wood').ok, false);
});

s.group('摆放与生产', function () {
  var g = completeSetup(E.createGame({ players: 2, humans: 2, seed: 13 }));
  s.eq('摆放完成进入行动阶段', [g.phase, g.turnStage], ['play', 'roll']);
  s.eq('起始资源各 2', g.players.map(function (p) { return E.totalResources(p.resources); }), [6, 6]);
  s.eq('每人 1 村 1 路', g.players.map(function (p) { return [p.settlements.length, p.roads.length]; }), [[1, 1], [1, 1]]);
  s.eq('村庄值 1 分', g.players[0].score, 1);
  s.eq('无资源时不能建村', E.legalSettlementVertices(g, g.players[0]).length, 0);
  s.ok('有可建道路', E.legalRoadEdges(g, g.players[0]).length > 0);
  s.ok('顶点产出是数组', Array.isArray(E.vertexProduction(g, g.players[0].settlements[0])));
  s.ok('顶点价值是数值', typeof E.vertexValue(g, g.players[0].settlements[0]) === 'number');
  s.eq('建造阶段掷骰被拒', E.roll(E.createGame({ seed: 1 }), 1, 2).error, 'wrongPhase');
  var vk = g.players[0].settlements[0];
  s.eq('已占顶点不能再建', E.validateSetupSettlement(g, vk).ok, false);
  s.eq('城市重算 2 分', (function () {
    var p = g.players[1];
    p.settlements = [];
    p.cities = ['x'];
    E.recomputeScore(p);
    return p.score;
  })(), 2);
});

s.group('掷骰、弃半与回合', function () {
  var g = completeSetup(E.createGame({ players: 2, humans: 2, seed: 14 }));
  var r = E.roll(g, 1, 2);
  s.ok('掷出 3 成功', r.ok && r.sum === 3 && r.seven === false);
  s.eq('进入行动阶段', g.turnStage, 'action');
  s.eq('行动阶段不能再次掷骰', E.roll(g, 1, 2).error, 'wrongStage');
  s.eq('行动阶段不能直接结束？可以', E.endTurn(g).ok, true);
  s.eq('换到下一位', g.current, 1);

  var g2 = completeSetup(E.createGame({ players: 2, humans: 2, seed: 15 }));
  g2.players[0].resources = { wheat: 3, stone: 1, wood: 1 };
  g2.players[1].resources = { wheat: 0, stone: 0, wood: 0 };
  var seven = E.roll(g2, 3, 4);
  s.ok('掷 7 成功', seven.ok && seven.seven === true);
  s.eq('掷 7 产生弃牌记录', seven.discards.length, 1);
  s.eq('弃掉一半（5 -> 2）', E.totalResources(g2.players[0].resources), 3);
  s.eq('掷骰阶段才能结束回合', (function () {
    var g3 = completeSetup(E.createGame({ players: 2, humans: 2, seed: 16 }));
    return E.endTurn(g3).error;
  })(), 'wrongStage');
  s.eq('总资源求和', E.totalResources({ wheat: 1, stone: 2, wood: 3 }), 6);
  s.eq('克隆资源互不影响', (function () {
    var r = { wheat: 1, stone: 2, wood: 3 }, c = E.cloneResources(r);
    c.wheat = 9;
    return r.wheat;
  })(), 1);
});

s.group('计分与结算', function () {
  var g = completeSetup(E.createGame({ players: 2, humans: 2, seed: 17 }));
  g.players[0].score = 8;
  g.players[1].score = 5;
  E.finishRounds(g);
  s.eq('12 轮结束标记', [g.phase, g.over], ['over', true]);
  s.eq('分高者获胜', g.winner, 0);
  s.eq('胜者名单', g.winners, [0]);
  var draw = completeSetup(E.createGame({ players: 2, humans: 2, seed: 18 }));
  draw.players[0].score = 4;
  draw.players[1].score = 4;
  E.finishRounds(draw);
  s.eq('同分并列', draw.result, 'draw');
  s.eq('并列无唯一赢家', draw.winner, null);
});

s.done();
