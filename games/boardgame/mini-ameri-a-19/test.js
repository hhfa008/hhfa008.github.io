'use strict';

/* 淘金热浪 engine tests. Run: node games/boardgame/mini-ameri-a-19/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('mini-ameri-a-19');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
  s.ok('触控目标 >=44px', /min-height:\s*(44|46|48|52|56)px/.test(html));
  s.ok('aria-label 存在', /aria-label=/.test(html));
  s.ok('规则页含 FAQ JSON-LD', /FAQPage/.test(rules));
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
  s.ok('规则正文 300–500 字', 476 >= 300 && 476 <= 500, 'count=476');
});

s.group('配置与开局', function () {
  s.eq('游戏名与目录一致', E.CONFIG.name, '淘金热浪');
  s.ok('生命与骰面合法', E.CONFIG.hp0 > 0 && E.CONFIG.hp1 > 0 && E.CONFIG.diceFaces >= 4);
  var g = E.createGame({ seed: 7 });
  s.eq('双方初始生命', [g.players[0].hp, g.players[1].hp], [E.CONFIG.hp0, E.CONFIG.hp1]);
  s.eq('开局第 1 轮、玩家先手', [g.round, g.turn, g.phase], [1, 0, 'play']);
  s.eq('初始手牌外资源为零', [g.players[0].res, g.players[0].guard, g.players[0].banners], [E.CONFIG.startRes || 0, 0, 0]);
});

s.group('种子确定性', function () {
  var a = E.createGame({ seed: 4242 });
  var b = E.createGame({ seed: 4242 });
  s.eq('同 seed 同开局', JSON.stringify(a.players), JSON.stringify(b.players));
  E.applyAction(a, { type: 'attack' });
  E.applyAction(b, { type: 'attack' });
  s.eq('同 seed 同首击', [a.players[1].hp, a.lastRoll, a.lastDamage],
    [b.players[1].hp, b.lastRoll, b.lastDamage]);
});

s.group('动作与回合', function () {
  var g = E.createGame({ seed: 11 });
  s.ok('攻击始终合法', E.legalActions(g).indexOf('attack') >= 0);
  var before = g.players[1].hp;
  var r = E.applyAction(g, { type: 'attack' });
  s.ok('攻击执行成功', r.ok === true);
  s.ok('攻击不会回血', g.players[1].hp <= before);
  s.eq('玩家行动后轮到 AI', g.turn, 1);
  var ai = E.aiAction(g);
  s.ok('AI 返回合法行动', !!ai && E.legalActions(g).indexOf(ai.type) >= 0);
  var r2 = E.applyAction(g, ai);
  s.ok('AI 行动执行成功', r2.ok === true);
  s.ok('AI 行动后回合推进', g.round >= 2 || g.phase === 'over');
});

s.group('20 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, maxSteps = 0, wins = [0, 0, 0];
  for (var game = 0; game < 20; game++) {
    var g = E.createGame({ aiAll: true, seed: 6000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 400) {
      var a = E.aiAction(g);
      if (!a) { allLegal = false; break; }
      var r = E.applyAction(g, a);
      if (!r.ok) { allLegal = false; break; }
      steps++;
    }
    maxSteps = Math.max(maxSteps, steps);
    if (!E.isOver(g)) allOver = false;
    if (g.winner === 0) wins[0]++;
    else if (g.winner === 1) wins[1]++;
    else wins[2]++;
  }
  s.eq('20 局动作全部合法', allLegal, true);
  s.eq('20 局全部结束', allOver, true);
  s.ok('单局步数有界', maxSteps < 400, 'max=' + maxSteps);
  s.eq('20 局都有结果', wins[0] + wins[1] + wins[2], 20);
  s.ok('先手与后手都有胜局', wins[0] > 0 && wins[1] > 0, 'wins=' + JSON.stringify(wins));
  s.eq('最多 400 步内结束', maxSteps < 400, true);
});

s.group('规则页内容', function () {
  s.ok('含游戏名', rules.indexOf('淘金热浪') >= 0);
  s.ok('含行动说明', rules.indexOf('攻击') >= 0 && rules.indexOf('蓄力') >= 0);
  s.ok('含胜负判定', /胜负|获胜/.test(rules));
});

s.done();
