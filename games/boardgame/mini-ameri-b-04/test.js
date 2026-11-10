'use strict';

// 沉船宝库 — engine contract tests (no DOM, no copied rules).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-ameri-b-04');

s.group('初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('两名探索者', g.players.length, 2);
  s.eq('目标分数', g.target, 13);
  s.eq('最大轮数', g.maxRounds, 8);
  s.eq('初始补给', g.players[0].supply, 5);
  s.eq('玩家先行', g.turn, 0);
  s.eq('初始未结束', g.over, false);
  s.eq('合法行动', E.legalActions(g).join(','), 'advance,rest');
});

s.group('行动与回合', function () {
  var g = E.createGame({ seed: 2 });
  var before = g.players[0].supply;
  E.applyAction(g, 'rest');
  s.eq('休整回复 1 补给', g.players[0].supply, Math.min(8, before + 1));
  s.eq('行动后换手', g.turn, 1);
  E.applyAction(g, 'rest');
  s.eq('双方行动后进入下一轮', g.round, 2);
  var h = E.createGame({ seed: 3 });
  h.players[0].supply = 8;
  E.applyAction(h, 'rest');
  s.eq('补给不超过上限', h.players[0].supply, 8);
  var threw = false;
  try { E.applyAction(h, 'dig'); } catch (e) { threw = true; }
  s.ok('非法行动抛错', threw);
});

s.group('事件与分数', function () {
  var g = E.createGame({ seed: 4 });
  g.players[0].score = 13 - 2;
  g.deck = ['relic'];
  E.applyAction(g, 'advance');
  s.ok('秘藏达到目标立即获胜', g.over && g.winner === 'p0');
  s.eq('分数准确结算', g.players[0].score, 13);
  var h = E.createGame({ seed: 5 });
  h.players[0].supply = 1;
  h.deck = ['trap'];
  E.applyAction(h, 'advance');
  s.eq('陷阱不会让补给为负', h.players[0].supply, 0);
  s.ok('分数不会为负', h.players[0].score >= 0);
  var k = E.createGame({ seed: 6 });
  for (var i = 0; i < 30 && !k.over; i++) E.applyAction(k, 'rest');
  s.ok('连续休整后按轮数结束', k.over && k.winner, true);
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, winners = {}, invariants = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (!g.over || !g.winner) bad++;
      winners[g.winner] = (winners[g.winner] || 0) + 1;
      if (g.players[0].supply < 0 || g.players[1].supply < 0) invariants = false;
      if (g.players[0].score < 0 || g.players[1].score < 0) invariants = false;
      if (g.stepCount > 200) invariants = false;
    } catch (e) { bad++; }
  }
  s.eq('20 局全部正常结束', bad, 0);
  s.ok('赢家标记合法', Object.keys(winners).every(function (k) { return k === 'p0' || k === 'p1' || k === 'draw'; }));
  s.ok('补给与分数始终非负', invariants);
  var a = E.selfPlay(11), b = E.selfPlay(11);
  s.eq('同种子结果可复现', [a.winner, a.players[0].score, a.players[1].score], [b.winner, b.players[0].score, b.players[1].score]);
});

s.done();
