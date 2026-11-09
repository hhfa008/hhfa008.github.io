'use strict';

/* Codenames engine tests. Run: node games/boardgame/codenames/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('codenames');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

function crafted(colors) {
  var st = E.createGame({ mode: 'auto', seed: 7 });
  st.words = colors.map(function (c, i) {
    return { text: '词' + i, tags: [], color: c, revealed: false };
  });
  st.scores = { red: 0, blue: 0 };
  st.turn = 'red';
  st.phase = 'clue';
  st.clue = null;
  st.guessesLeft = 0;
  st.winner = null;
  return st;
}

var RED9 = [];
var i;
for (i = 0; i < 9; i++) RED9.push('red');
var BLUE8 = [];
for (i = 0; i < 8; i++) BLUE8.push('blue');
var NEUTRAL7 = [];
for (i = 0; i < 7; i++) NEUTRAL7.push('neutral');
var FULL = RED9.concat(BLUE8, NEUTRAL7, ['assassin']);

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html));
  s.ok('触控目标 >=44px', /min-height:\s*(44|48|52|56)px/.test(html));
  s.ok('aria-label 存在', /aria-label=/.test(html));
  s.ok('规则页含 FAQ JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0 ||
    rules.indexOf('"@type":"FAQPage"') >= 0);
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
});

s.group('棋盘构成', function () {
  var g = E.createGame({ mode: 'captain', seed: 42 });
  s.eq('25 张词卡', g.words.length, 25);
  var counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
  g.words.forEach(function (w) { counts[w.color]++; });
  s.eq('红 9 / 蓝 8 / 中立 7 / 刺客 1',
    [counts.red, counts.blue, counts.neutral, counts.assassin], [9, 8, 7, 1]);
  s.eq('没有重复词', new Set(g.words.map(function (w) { return w.text; })).size, 25);
  s.eq('红队先手', g.turn, 'red');
});

s.group('隐藏信息', function () {
  var g = E.createGame({ mode: 'captain', seed: 43 });
  var captainView = E.viewFor(g, 0);
  var operativeView = E.viewFor(g, 0);
  var g2 = E.createGame({ mode: 'operative', seed: 43 });
  var opView = E.viewFor(g2, 0);
  s.eq('队长模式玩家可见全部颜色',
    captainView.words.every(function (w) { return w.color !== 'hidden'; }), true);
  s.eq('行动模式未翻开的颜色被隐藏',
    opView.words.filter(function (w) { return w.revealed; }).length, 0);
  s.ok('行动模式 DOM 视图不含未翻开颜色',
    opView.words.every(function (w) { return w.revealed || w.color === 'hidden'; }));
  s.ok('队长视图为独立副本', captainView.words !== g.words);
  void operativeView;
});

s.group('线索校验', function () {
  var g = crafted(FULL);
  s.eq('合法线索通过', E.validClue(g, '水果', 2), true);
  s.eq('空线索拒绝', E.validClue(g, '  ', 1), false);
  s.eq('超长线索拒绝', E.validClue(g, '这是一个非常非常非常非常非常非常长的线索词', 1), false);
  s.eq('数字 0 拒绝', E.validClue(g, '水果', 0), false);
  s.eq('数字 10 拒绝', E.validClue(g, '水果', 10), false);
  s.eq('场上词作线索拒绝', E.validClue(g, '词3', 1), false);
  var r = E.applyAction(g, { type: 'clue', text: '提示', count: 2 });
  s.eq('提交线索成功', r.ok, true);
  s.eq('前进到猜词阶段', g.phase, 'guess');
  s.eq('猜词次数 = 数字 + 1', g.guessesLeft, 3);
});

s.group('翻牌结算', function () {
  var g = crafted(FULL);
  E.applyAction(g, { type: 'clue', text: '提示', count: 2 });
  E.applyAction(g, { type: 'guess', index: 0 });
  s.eq('猜中己方词得分', g.scores.red, 1);
  s.eq('己方词翻面', g.words[0].revealed, true);
  E.applyAction(g, { type: 'guess', index: 9 });
  s.eq('猜中对方词给对方加分', g.scores.blue, 1);
  s.eq('猜错立即换边', g.turn, 'blue');
  s.eq('换边后回到线索阶段', g.phase, 'clue');

  var n = crafted(FULL);
  E.applyAction(n, { type: 'clue', text: '提示', count: 1 });
  E.applyAction(n, { type: 'guess', index: 17 });
  s.eq('中立词不加分', n.scores.red, 0);
  s.eq('中立词结束回合', n.turn, 'blue');

  var a = crafted(FULL);
  E.applyAction(a, { type: 'clue', text: '提示', count: 2 });
  E.applyAction(a, { type: 'guess', index: 24 });
  s.eq('刺客立即结束对局', a.phase, 'over');
  s.eq('红队踩刺客则蓝队胜', a.winner, 'blue');
});

s.group('胜利条件', function () {
  var g = crafted(FULL);
  g.scores.red = 8;
  g.words[0].color = 'red';
  E.applyAction(g, { type: 'clue', text: '提示', count: 1 });
  E.applyAction(g, { type: 'guess', index: 0 });
  s.eq('红队第 9 词获胜', g.winner, 'red');
  s.eq('胜利后 phase=over', g.phase, 'over');

  var b = crafted(FULL);
  b.scores.blue = 7;
  b.turn = 'blue';
  E.applyAction(b, { type: 'clue', text: '提示', count: 1 });
  E.applyAction(b, { type: 'guess', index: 9 });
  s.eq('蓝队第 8 词获胜', b.winner, 'blue');
});

s.group('30 局 AI 自对弈', function () {
  var wins = { red: 0, blue: 0, none: 0 };
  var maxActions = 0;
  var allLegal = true;
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ mode: 'auto', seed: 1000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 2000) {
      var act = E.aiAction(g);
      if (!act) { allLegal = false; break; }
      var r = E.applyAction(g, act);
      if (!r.ok) { allLegal = false; break; }
      steps++;
    }
    maxActions = Math.max(maxActions, steps);
    if (!E.isOver(g)) { allLegal = false; }
    if (g.winner === 'red') wins.red++;
    else if (g.winner === 'blue') wins.blue++;
    else wins.none++;
  }
  s.eq('30 局全部合法结束', allLegal, true);
  s.eq('每局都有胜者', wins.none, 0);
  s.eq('红蓝均有胜局', wins.red > 0 && wins.blue > 0, true);
  s.ok('单局动作数有界（<2000）', maxActions < 2000, 'max=' + maxActions);
});

s.done();
