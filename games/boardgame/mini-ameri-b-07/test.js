'use strict';

// 沙暴商队 — engine contract tests (no DOM, no copied rules).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-ameri-b-07');

s.group('初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('最大天数', g.maxDays, 9);
  s.eq('初始食物', g.res.food, 5);
  s.eq('初始温暖', g.res.warmth, 3);
  s.eq('初始士气', g.res.morale, 5);
  s.eq('初始威胁', g.threat, 6);
  s.eq('四种合法行动', E.legalActions(g).join(','), 'gather,stoke,repair,rally');
  s.eq('初始未结束', g.over, false);
});

s.group('行动结算', function () {
  var g = E.createGame({ seed: 2 });
  g.deck = ['calm'];
  var food = g.res.food, threat = g.threat;
  E.applyAction(g, 'gather');
  s.eq('采集加 2 食物', g.res.food, Math.min(9, food + 2));
  s.eq('平静事件降 1 威胁', g.threat, Math.max(0, threat - 1));
  s.eq('行动后进入下一天', g.day, 2);
  var h = E.createGame({ seed: 3 });
  h.deck = ['calm'];
  h.res.food = 4;
  E.applyAction(h, 'stoke');
  s.eq('生火消耗 1 食物', h.res.food, 3);
  s.eq('生火加 2 温暖', h.res.warmth, Math.min(9, 3 + 2));
  var threw = false;
  try { E.applyAction(h, 'sleep'); } catch (e) { threw = true; }
  s.ok('非法行动抛错', threw);
});

s.group('失败与胜利', function () {
  var g = E.createGame({ seed: 4 });
  g.threat = 8; g.res = { food: 9, warmth: 9, morale: 9 }; g.deck = ['night'];
  E.applyAction(g, 'gather');
  s.ok('威胁到 9 立即失败', g.over && g.winner === 'lose');
  var h = E.createGame({ seed: 5 });
  h.res = { food: 1, warmth: 9, morale: 9 }; h.threat = 2; h.deck = ['beast'];
  E.applyAction(h, 'repair');
  s.ok('食物归零立即失败', h.over && h.winner === 'lose');
  var k = E.createGame({ seed: 6 });
  k.day = 9; k.res = { food: 9, warmth: 9, morale: 9 }; k.threat = 2; k.deck = ['calm'];
  E.applyAction(k, 'gather');
  s.ok('撑满天数即获胜', k.over && k.winner === 'win');
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, wins = 0, losses = 0, invariants = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (!g.over) bad++;
      if (g.winner === 'win') wins++;
      if (g.winner === 'lose') losses++;
      ['food', 'warmth', 'morale'].forEach(function (k) {
        if (g.res[k] < 0 || g.res[k] > 9) invariants = false;
      });
      if (g.threat < 0 || g.threat > 9) invariants = false;
      if (g.day > g.maxDays + 1) invariants = false;
    } catch (e) { bad++; }
  }
  s.eq('20 局全部结束', bad, 0);
  s.eq('胜负标记覆盖有效值', wins + losses, 20);
  s.ok('资源始终在 0 到 9', invariants);
  var a = E.selfPlay(13), b = E.selfPlay(13);
  s.eq('同种子结果可复现', [a.winner, a.day, a.res.food, a.threat], [b.winner, b.day, b.res.food, b.threat]);
});

s.done();
