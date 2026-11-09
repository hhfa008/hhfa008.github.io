'use strict';

/* Coup engine tests. Run: node games/boardgame/coup/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('coup');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

function cards(p, roles) {
  p.influence = roles.map(function (r) { return { role: r, revealed: false }; });
}
function fresh(seed) {
  var g = E.createGame({ aiAll: true, seed: seed || 11 });
  g.current = 0;
  g.phase = 'action';
  g.pending = null;
  g.winner = null;
  g.players.forEach(function (p) { p.coins = 2; p.eliminated = false; });
  return g;
}
function passAll(g) {
  var guard = 0;
  while ((g.phase === 'challenge' || g.phase === 'block') && guard++ < 20) {
    E.applyAction(g, { type: 'pass' });
  }
}
function discardTop(g) {
  if (g.phase !== 'discard') return;
  var p = g.players[E.actorId(g)];
  for (var i = 0; i < p.influence.length; i++) {
    if (!p.influence[i].revealed) { E.applyAction(g, { type: 'discard', index: i }); return; }
  }
}

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html));
  s.ok('触控目标 >=44px', /min-height:\s*(44|46|48|52|56)px/.test(html));
  s.ok('aria-label 存在', /aria-label=/.test(html));
  s.ok('规则页含 FAQ JSON-LD', /FAQPage/.test(rules));
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
});

s.group('开局与隐藏信息', function () {
  var g = E.createGame({ seed: 5 });
  s.eq('三名玩家', g.players.length, 3);
  s.eq('每人两张身份牌', g.players.map(function (p) { return p.influence.length; }), [2, 2, 2]);
  s.eq('每人两枚金币', g.players.map(function (p) { return p.coins; }), [2, 2, 2]);
  s.eq('牌堆剩 9 张', g.deck.length, 9);
  s.eq('开局阶段 action', g.phase, 'action');
  var v = E.viewFor(g, 0);
  s.ok('自己的身份可见', v.players[0].influence.every(function (c) { return c.role !== 'hidden'; }));
  s.ok('对手未翻开身份隐藏', v.players[1].influence.every(function (c) { return c.role === 'hidden'; }));
  s.ok('viewFor 不改变原状态', g.players[1].influence[0].role !== 'hidden');
});

s.group('行动合法性', function () {
  var g = fresh();
  var types = E.legalActions(g).map(function (a) { return a.type; });
  s.ok('收入始终合法', types.indexOf('income') >= 0);
  s.ok('征税可诈称', types.indexOf('tax') >= 0);
  s.ok('2 金币不能暗杀', types.indexOf('assassinate') < 0);
  s.ok('2 金币不能政变', types.indexOf('coup') < 0);
  g.players[0].coins = 7;
  types = E.legalActions(g).map(function (a) { return a.type; });
  s.ok('7 金币可政变', types.indexOf('coup') >= 0);
  s.eq('政变目标数量', E.legalActions(g).filter(function (a) { return a.type === 'coup'; }).length, 2);
  s.eq('非法行动被拒绝', E.applyAction(g, { type: 'coup', target: 99 }).ok, false);
});

s.group('收入与外援', function () {
  var g = fresh();
  cards(g.players[0], ['duke', 'contessa']);
  E.applyAction(g, { type: 'income' });
  s.eq('收入 +1', g.players[0].coins, 3);
  s.eq('收入后换人', g.current, 1);

  g = fresh();
  E.applyAction(g, { type: 'foreign_aid' });
  s.eq('外援进入阻挡阶段', g.phase, 'block');
  passAll(g);
  s.eq('无人阻挡则 +2', g.players[0].coins, 4);
});

s.group('征税与挑战', function () {
  var g = fresh();
  cards(g.players[0], ['duke', 'contessa']);
  cards(g.players[1], ['captain', 'captain']);
  E.applyAction(g, { type: 'tax' });
  s.eq('宣称公爵进入挑战', g.phase, 'challenge');
  s.eq('挑战者为下一名玩家', E.actorId(g), 1);
  E.applyAction(g, { type: 'challenge' });
  discardTop(g);
  s.eq('真公爵挑战失败，挑战者掉牌',
    g.players[1].influence.filter(function (c) { return c.revealed; }).length, 1);
  s.eq('行动继续，征税 +3', g.players[0].coins, 5);

  g = fresh();
  cards(g.players[0], ['captain', 'contessa']);
  cards(g.players[1], ['captain', 'captain']);
  E.applyAction(g, { type: 'tax' });
  E.applyAction(g, { type: 'challenge' });
  discardTop(g);
  s.eq('诈称公爵被拆穿，行动者掉牌',
    g.players[0].influence.filter(function (c) { return c.revealed; }).length, 1);
  s.eq('被拆穿不获得金币', g.players[0].coins, 2);
  s.eq('行动取消后换人', g.current, 1);
});

s.group('暗杀、阻挡与政变', function () {
  var g = fresh();
  cards(g.players[0], ['assassin', 'contessa']);
  cards(g.players[1], ['captain', 'captain']);
  g.players[0].coins = 3;
  E.applyAction(g, { type: 'assassinate', target: 1 });
  s.eq('暗杀先扣 3 金币', g.players[0].coins, 0);
  passAll(g);
  discardTop(g);
  s.eq('暗杀使目标掉一张牌',
    g.players[1].influence.filter(function (c) { return c.revealed; }).length, 1);

  g = fresh();
  cards(g.players[0], ['assassin', 'contessa']);
  cards(g.players[1], ['contessa', 'captain']);
  g.players[0].coins = 3;
  E.applyAction(g, { type: 'assassinate', target: 1 });
  E.applyAction(g, { type: 'pass' });
  E.applyAction(g, { type: 'pass' });
  s.eq('目标可进入阻挡阶段', g.phase, 'block');
  E.applyAction(g, { type: 'block', role: 'contessa' });
  s.eq('阻挡后由行动者决定挑战', g.phase, 'blockChallenge');
  E.applyAction(g, { type: 'pass' });
  s.eq('接受阻挡则目标不掉牌',
    g.players[1].influence.filter(function (c) { return c.revealed; }).length, 0);

  g = fresh();
  cards(g.players[0], ['duke', 'duke']);
  cards(g.players[1], ['captain', 'captain']);
  g.players[0].coins = 8;
  E.applyAction(g, { type: 'coup', target: 1 });
  s.eq('政变直接进入弃牌', g.phase, 'discard');
  s.eq('政变扣 7 金币', g.players[0].coins, 1);
  discardTop(g);
  s.eq('政变目标掉牌',
    g.players[1].influence.filter(function (c) { return c.revealed; }).length, 1);
});

s.group('偷取、交换与胜负', function () {
  var g = fresh();
  cards(g.players[0], ['captain', 'duke']);
  cards(g.players[1], ['captain', 'duke']);
  g.players[1].coins = 4;
  E.applyAction(g, { type: 'steal', target: 1 });
  passAll(g);
  s.eq('偷取上限 2 枚', [g.players[0].coins, g.players[1].coins], [4, 2]);

  g = fresh();
  cards(g.players[0], ['ambassador', 'duke']);
  E.applyAction(g, { type: 'exchange' });
  passAll(g);
  s.eq('交换阶段手牌 4 张', g.players[0].influence.length, 4);
  var keep = E.legalActions(g)[0];
  s.eq('保留两张合法', keep.type, 'keep');
  E.applyAction(g, keep);
  s.eq('交换后恢复 2 张', g.players[0].influence.length, 2);

  g = fresh();
  cards(g.players[0], ['duke', 'duke']);
  cards(g.players[1], ['captain']);
  cards(g.players[2], ['contessa']);
  g.players[0].coins = 7;
  E.applyAction(g, { type: 'coup', target: 2 });
  discardTop(g);
  s.eq('淘汰一人后继续对局', g.phase !== 'over', true);
  g.current = 0;
  g.phase = 'action';
  g.players[0].coins = 7;
  E.applyAction(g, { type: 'coup', target: 1 });
  discardTop(g);
  s.eq('只剩一人即获胜', g.phase, 'over');
  s.eq('胜者为玩家 0', g.winner, 0);
});

s.group('30 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, maxSteps = 0, wins = [0, 0, 0];
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ aiAll: true, seed: 2000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 2000) {
      var a = E.aiAction(g);
      if (!a) { allLegal = false; break; }
      var r = E.applyAction(g, a);
      if (!r.ok) { allLegal = false; break; }
      steps++;
    }
    maxSteps = Math.max(maxSteps, steps);
    if (!E.isOver(g)) allOver = false;
    if (g.winner >= 0) wins[g.winner]++;
  }
  s.eq('30 局动作全部合法', allLegal, true);
  s.eq('30 局全部结束', allOver, true);
  s.ok('单局步数有界', maxSteps < 2000, 'max=' + maxSteps);
  s.ok('多个座位都出现胜者', wins.filter(function (n) { return n > 0; }).length >= 2);
});

s.done();
