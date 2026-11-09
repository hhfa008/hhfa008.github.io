'use strict';

/* Skull engine tests. Run: node games/boardgame/skull/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('skull');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

var uid = 1;
function disc(type) { return { type: type, uid: 'u' + (uid++), revealed: false }; }
function fresh(seed) {
  var g = E.createGame({ aiAll: true, seed: seed || 4 });
  g.players.forEach(function (p) {
    p.hand = []; p.placed = []; p.points = 0; p.eliminated = false;
  });
  g.turn = 0; g.starter = 0; g.round = 1; g.phase = 'place';
  g.bid = 0; g.bidder = null; g.revealNeed = 0; g.revealed = [];
  g.winner = null; g.log = [];
  return g;
}
function four(p) {
  p.hand = [disc('flower'), disc('flower'), disc('flower'), disc('skull')];
  p.placed = [];
}
function total(g) { return g.players[0].placed.length + g.players[1].placed.length; }

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html));
  s.ok('触控目标 >=44px', /min-height:\s*(44|46|48|52|56)px/.test(html));
  s.ok('aria-label 存在', /aria-label=/.test(html));
  s.ok('规则页含 FAQ JSON-LD', /FAQPage/.test(rules));
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
});

s.group('开局与圆片构成', function () {
  var g = E.createGame({ seed: 8 });
  s.eq('双人对局', g.players.length, 2);
  s.eq('每人 4 枚圆片', g.players.map(function (p) { return p.hand.length; }), [4, 4]);
  g.players.forEach(function (p, idx) {
    var f = p.hand.filter(function (d) { return d.type === 'flower'; }).length;
    var sk = p.hand.filter(function (d) { return d.type === 'skull'; }).length;
    s.eq('玩家 ' + idx + ' 有 3 朵花', f, 3);
    s.eq('玩家 ' + idx + ' 有 1 个骷髅', sk, 1);
  });
  s.eq('开局放片阶段', g.phase, 'place');
  s.eq('玩家 0 先手', g.turn, 0);
  s.eq('桌上初始 0 枚', total(g), 0);
  s.eq('初始积分 0:0', g.players.map(function (p) { return p.points; }), [0, 0]);
});

s.group('隐藏信息', function () {
  var g = fresh();
  g.players[0].hand = [disc('flower'), disc('skull')];
  g.players[1].hand = [disc('flower'), disc('skull')];
  g.players[0].placed = [disc('skull')];
  g.players[1].placed = [disc('flower'), disc('flower')];
  var v = E.viewFor(g, 0);
  s.eq('自己的手牌类型可见', v.players[0].hand, ['flower', 'skull']);
  s.eq('对手手牌类型隐藏', v.players[1].hand, ['hidden', 'hidden']);
  s.eq('自己的暗放圆片可见', v.players[0].placed[0].type, 'skull');
  s.eq('对手暗放圆片隐藏', v.players[1].placed[0].type, 'hidden');
  s.ok('视图不暴露对手圆片顺序', v.players[1].placed.length === 2);
});

s.group('暗放与下注', function () {
  var g = fresh();
  four(g.players[0]); four(g.players[1]);
  E.applyAction(g, { type: 'place', index: 0 });
  s.eq('暗放后换人', g.turn, 1);
  s.eq('桌上 1 枚', total(g), 1);
  E.applyAction(g, { type: 'place', index: 0 });
  s.eq('双方各放一枚后换回', g.turn, 0);
  var r = E.applyAction(g, { type: 'bid', amount: 2 });
  s.eq('下注成功', r.ok, true);
  s.eq('进入加注阶段', g.phase, 'bid');
  s.eq('记录最高出价者', g.bidder, 0);
  s.eq('超出桌上总数的下注被拒绝', E.applyAction(g, { type: 'raise', amount: 3 }).ok, false);
  s.eq('不高于当前注的加注被拒绝', E.applyAction(g, { type: 'raise', amount: 2 }).ok, false);
  E.applyAction(g, { type: 'pass' });
  s.eq('放弃后进入翻片', g.phase, 'reveal');
  s.eq('翻片数量等于注数', g.revealNeed, 2);
  s.eq('先翻自己的圆片', E.allowedOwner(g), 0);
  s.eq('不能先翻对手', E.applyAction(g, { type: 'reveal', owner: 1, index: 0 }).ok, false);
});

s.group('翻片与得分', function () {
  var g = fresh();
  four(g.players[0]); four(g.players[1]);
  g.players[0].placed = [disc('flower'), disc('flower')];
  g.players[1].placed = [disc('flower')];
  g.phase = 'reveal'; g.bidder = 0; g.bid = 2; g.revealNeed = 2; g.turn = 0;
  E.applyAction(g, { type: 'reveal', owner: 0, index: 0 });
  s.eq('翻到花朵后仍需一枚', g.revealNeed, 1);
  E.applyAction(g, { type: 'reveal', owner: 0, index: 1 });
  s.eq('翻满注数得 1 分', g.players[0].points, 1);
  s.eq('成功后开始新回合', g.round, 2);
  s.eq('桌上圆片收回', total(g), 0);
  s.eq('未达 2 分对局继续', g.phase, 'place');

  var w = fresh();
  four(w.players[0]); four(w.players[1]);
  w.players[0].points = 1;
  w.players[0].placed = [disc('flower')];
  w.phase = 'reveal'; w.bidder = 0; w.bid = 1; w.revealNeed = 1; w.turn = 0;
  E.applyAction(w, { type: 'reveal', owner: 0, index: 0 });
  s.eq('第 2 分立即获胜', w.winner, 0);
  s.eq('获胜后结束对局', w.phase, 'over');
});

s.group('骷髅与出局', function () {
  var g = fresh();
  g.players[0].hand = [disc('flower'), disc('flower')];
  g.players[0].placed = [disc('skull'), disc('flower')];
  g.players[1].hand = [disc('flower'), disc('flower')];
  g.players[1].placed = [disc('flower')];
  g.phase = 'reveal'; g.bidder = 0; g.bid = 2; g.revealNeed = 2; g.turn = 0;
  E.applyAction(g, { type: 'reveal', owner: 0, index: 0 });
  s.eq('翻到骷髅挑战失败', g.players[0].points, 0);
  s.eq('失败者失去一枚圆片', g.players[0].hand.length + g.players[0].placed.length, 3);
  s.eq('失败后开始新回合', g.round, 2);
  s.eq('失败者先行动', g.starter, 0);

  var out = fresh();
  out.players[0].hand = [];
  out.players[0].placed = [disc('skull')];
  out.players[1].hand = [disc('flower')];
  out.phase = 'reveal'; out.bidder = 0; out.bid = 1; out.revealNeed = 1; out.turn = 0;
  E.applyAction(out, { type: 'reveal', owner: 0, index: 0 });
  s.eq('失去最后一枚圆片则出局', out.players[0].eliminated, true);
  s.eq('对手立即获胜', out.winner, 1);
  s.eq('出局后对局结束', out.phase, 'over');
});

s.group('AI 合法性约束', function () {
  var g = fresh();
  four(g.players[0]); four(g.players[1]);
  g.players[0].placed = [disc('flower')];
  g.players[1].placed = [disc('flower')];
  g.phase = 'bid'; g.bid = 0; g.turn = 0; g.starter = 0; g.bidder = null;
  var a = E.aiAction(g);
  s.eq('零注时 AI 必须开价', a.type, 'raise');
  s.ok('AI 开价在合法范围', a.amount >= 1 && a.amount <= total(g));
  var acts = E.legalActions(g);
  s.ok('合法动作非空', acts.length > 0);
  s.ok('合法动作不包含放弃（零注）', !acts.some(function (x) { return x.type === 'pass'; }));
});

s.group('30 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, maxSteps = 0, winners = { 0: 0, 1: 0, draw: 0 };
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ aiAll: true, seed: 4000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 3000) {
      var a = E.aiAction(g);
      if (!a) { allLegal = false; break; }
      var r = E.applyAction(g, a);
      if (!r.ok) { allLegal = false; break; }
      steps++;
    }
    maxSteps = Math.max(maxSteps, steps);
    if (!E.isOver(g)) allOver = false;
    if (g.winner === 0) winners[0]++;
    else if (g.winner === 1) winners[1]++;
    else winners.draw++;
  }
  s.eq('30 局动作全部合法', allLegal, true);
  s.eq('30 局全部结束', allOver, true);
  s.ok('单局步数有界', maxSteps < 3000, 'max=' + maxSteps);
  s.ok('至少出现一场非平局', winners[0] + winners[1] > 0);
});

s.done();
