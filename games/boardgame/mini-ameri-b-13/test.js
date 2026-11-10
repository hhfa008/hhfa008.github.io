'use strict';

// 边境游侠 — engine contract tests (no DOM, no copied rules).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-ameri-b-13');

s.group('初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('英雄名称', g.hero.name, '荒原游侠');
  s.eq('初始生命', g.hero.hp, 11);
  s.eq('初始攻击', g.hero.atk, 2);
  s.eq('初始等级', g.hero.level, 1);
  s.eq('初始遭遇数', g.encounters.length, 6);
  s.eq('首个遭遇有三个选项', E.legalActions(g).length, 3);
  s.eq('未结束', g.over, false);
});

s.group('选择与成长', function () {
  var g = E.createGame({ seed: 2 });
  E.applyAction(g, 0);
  s.eq('强攻获得 2 经验', g.hero.xp, 2);
  s.eq('强攻获得 1 金币', g.hero.gold, 1);
  s.eq('强攻损失 2 生命', g.hero.hp, 11 - 2);
  E.applyAction(g, 1);
  s.eq('周旋再得 2 金币', g.hero.gold, 3);
  s.eq('进入第三段遭遇', g.encounter, 2);
  var h = E.createGame({ seed: 3 });
  h.hero.xp = 2;
  E.applyAction(h, 0);
  s.eq('经验达标后升级', h.hero.level, 2);
  s.eq('升级提升攻击', h.hero.atk, 3);
  s.eq('升级提升生命上限', h.hero.maxHp, 11 + 2);
  var threw = false;
  try { E.applyAction(h, 9); } catch (e) { threw = true; }
  s.ok('非法选项抛错', threw);
});

s.group('失败与首领', function () {
  var g = E.createGame({ seed: 4 });
  g.hero.hp = 2;
  E.applyAction(g, 0);
  s.ok('生命归零立即失败', g.over && g.winner === 'lose');
  var win = E.createGame({ seed: 5 });
  win.encounter = win.encounters.length - 1;
  win.hero.atk = 9; win.hero.level = 1;
  E.applyAction(win, 0);
  s.ok('战力达标击败首领', win.over && win.winner === 'win');
  var lose = E.createGame({ seed: 6 });
  lose.encounter = lose.encounters.length - 1;
  lose.hero.atk = 0; lose.hero.level = 1;
  E.applyAction(lose, 0);
  s.ok('战力不足首领战失败', lose.over && lose.winner === 'lose');
  var run = E.createGame({ seed: 7 });
  run.encounter = run.encounters.length - 1;
  E.applyAction(run, 1);
  s.ok('首领战撤退直接失败', run.over && run.winner === 'lose');
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, wins = 0, losses = 0, invariants = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (!g.over) bad++;
      if (g.winner === 'win') wins++;
      if (g.winner === 'lose') losses++;
      if (g.hero.hp < 0 || g.hero.hp > g.hero.maxHp) invariants = false;
      if (g.hero.xp < 0 || g.hero.level < 1) invariants = false;
      if (g.hero.atk < 2) invariants = false;
    } catch (e) { bad++; }
  }
  s.eq('20 局全部结束', bad, 0);
  s.eq('每局都有明确胜负', wins + losses, 20);
  s.ok('生命与等级始终合法', invariants);
  var a = E.selfPlay(9), b = E.selfPlay(9);
  s.eq('同种子结果可复现', [a.winner, a.hero.hp, a.hero.level, a.hero.gold], [b.winner, b.hero.hp, b.hero.level, b.hero.gold]);
});

s.done();
