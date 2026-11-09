'use strict';

/* Love Letter engine tests. Run: node games/boardgame/love-letter/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('love-letter');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

function fresh(seed) {
  var g = E.createGame({ aiAll: true, seed: seed || 3 });
  g.players.forEach(function (p) {
    p.hand = []; p.discard = []; p.protected = false; p.out = false;
  });
  g.deck = [];
  g.turn = 0;
  g.phase = 'play';
  g.winner = null;
  g.known = { 0: {}, 1: {} };
  return g;
}
function setHands(g, a, b) { g.players[0].hand = a.slice(); g.players[1].hand = b.slice(); }
function hiddenCount(p) { return p.hand.filter(function (c) { return c !== 'hidden'; }).length; }

s.group('静态页面约束', function () {
  s.ok('引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(html));
  s.ok('移动端 viewport', /name="viewport"[^>]*width=device-width/.test(html));
  s.ok('无外部 http(s) 请求', !/(src|href)="https?:\/\//.test(html));
  s.ok('触控目标 >=44px', /min-height:\s*(44|46|48|52|56)px/.test(html));
  s.ok('aria-label 存在', /aria-label=/.test(html));
  s.ok('规则页含 FAQ JSON-LD', /FAQPage/.test(rules));
  s.ok('规则页有回游戏 CTA', /href="index\.html"/.test(rules));
});

s.group('牌库构成', function () {
  var g = E.createGame({ seed: 9 });
  s.eq('8 种角色', E.CARDS.length, 8);
  s.eq('角色点数 1–8', E.CARDS.map(function (c) { return c.id; }), [1, 2, 3, 4, 5, 6, 7, 8]);
  s.eq('总张数 16', E.CARDS.reduce(function (n, c) { return n + c.count; }, 0), 16);
  s.eq('卫兵 5 张', E.CARD_BY_ID[1].count, 5);
  s.eq('公主 1 张', E.CARD_BY_ID[8].count, 1);
  s.eq('开局各 1 张、已抽 1 张', [g.players[0].hand.length, g.players[1].hand.length], [2, 1]);
  s.eq('牌堆剩余 12 张', g.deck.length, 12);
  s.eq('暗置 1 张', typeof g.burn, 'number');
  s.eq('开局轮到玩家 0', g.turn, 0);
});

s.group('隐藏信息', function () {
  var g = E.createGame({ seed: 12 });
  var v = E.viewFor(g, 0);
  s.eq('对手手牌默认隐藏', v.players[1].hand[0], 'hidden');
  s.ok('自己手牌可见', v.players[0].hand.every(function (c) { return c !== 'hidden'; }));
  g.known[0][1] = g.players[1].hand[0];
  var v2 = E.viewFor(g, 0);
  s.eq('神父看到后可显示', v2.players[1].hand[0], g.players[1].hand[0]);
  s.ok('视图不泄露牌堆顺序', v.deckLeft === g.deck.length && v.deck === undefined);
  void hiddenCount;
});

s.group('出牌合法性', function () {
  var g = fresh();
  setHands(g, [7, 6], [2]);
  g.deck = [3, 4, 5, 8];
  var acts = E.legalActions(g);
  s.ok('女伯爵+国王：只能打女伯爵', acts.length > 0 && acts.every(function (a) { return a.card === 7; }));
  s.eq('非法打国王被拒绝', E.applyAction(g, { type: 'play', card: 6, target: 1 }).ok, false);
  s.eq('卫兵猜 1 被拒绝', E.applyAction(g, { type: 'play', card: 1, target: 1, guess: 1 }).ok, false);

  var g2 = fresh();
  setHands(g2, [7, 4], [2]);
  g2.deck = [3, 4, 5, 8];
  var acts2 = E.legalActions(g2);
  s.ok('女伯爵+侍女可自由选择', acts2.some(function (a) { return a.card === 4; }) &&
    acts2.some(function (a) { return a.card === 7; }));
});

s.group('卫兵与神父', function () {
  var g = fresh();
  setHands(g, [1, 2], [5]);
  g.deck = [3, 4, 6, 8];
  E.applyAction(g, { type: 'play', card: 1, target: 1, guess: 5 });
  s.eq('卫兵猜中对手出局', g.players[1].out, true);
  s.eq('猜中即获胜', g.winner, 0);

  var m = fresh();
  setHands(m, [1, 2], [5]);
  m.deck = [3, 4, 6, 8];
  E.applyAction(m, { type: 'play', card: 1, target: 1, guess: 7 });
  s.eq('卫兵猜错对手存活', m.players[1].out, false);
  s.eq('猜错后换 AI 行动', m.turn, 1);

  var p = fresh();
  setHands(p, [2, 4], [6]);
  p.deck = [3, 5, 8, 2];
  E.applyAction(p, { type: 'play', card: 2, target: 1 });
  s.eq('神父记录对手手牌', p.known[0][1], 6);
  s.eq('神父不淘汰对手', p.players[1].out, false);
});

s.group('男爵比较', function () {
  var g = fresh();
  setHands(g, [3, 6], [4]);
  g.deck = [2, 5, 8, 4];
  E.applyAction(g, { type: 'play', card: 3, target: 1 });
  s.eq('男爵点数低者出局', g.players[1].out, true);
  s.eq('男爵获胜', g.winner, 0);

  var t = fresh();
  setHands(t, [3, 4], [4]);
  t.deck = [2, 5, 6, 8];
  E.applyAction(t, { type: 'play', card: 3, target: 1 });
  s.eq('男爵平手无人出局', t.players[0].out || t.players[1].out, false);

  var l = fresh();
  setHands(l, [3, 2], [7]);
  l.deck = [4, 5, 6, 8];
  E.applyAction(l, { type: 'play', card: 3, target: 1 });
  s.eq('男爵点数低者可能是自己', l.players[0].out, true);
  s.eq('自己出局则 AI 获胜', l.winner, 1);
});

s.group('侍女保护', function () {
  var g = fresh();
  setHands(g, [4, 5], [1, 3]);
  g.deck = [2, 6, 7, 8];
  E.applyAction(g, { type: 'play', card: 4 });
  s.eq('侍女使自己受保护', g.players[0].protected, true);
  s.eq('侍女不淘汰人', g.players[0].out, false);
  s.eq('侍女后换 AI 行动', g.turn, 1);
  E.applyAction(g, { type: 'play', card: 1, target: 0, guess: 5 });
  s.eq('卫兵对受保护者无效', g.players[0].out, false);
  s.eq('保护在本人下回合解除', g.players[0].protected, false);
});

s.group('王子与国王', function () {
  var g = fresh();
  setHands(g, [5, 6], [8]);
  g.deck = [2, 3, 4, 7];
  E.applyAction(g, { type: 'play', card: 5, target: 1 });
  s.eq('王子迫使对手弃公主，对手出局', g.players[1].out, true);
  s.eq('王子间接获胜', g.winner, 0);

  var self = fresh();
  setHands(self, [5, 6], [2]);
  self.deck = [2, 3, 4, 7];
  E.applyAction(self, { type: 'play', card: 5, target: 0 });
  s.eq('王子对自己：弃旧牌补新牌', self.players[0].hand, [7]);
  s.eq('王子对自己不淘汰', self.players[0].out, false);

  var k = fresh();
  setHands(k, [6, 2], [7]);
  k.deck = [3, 4, 5, 8];
  E.applyAction(k, { type: 'play', card: 6, target: 1 });
  s.eq('国王换到对手的 7', k.players[0].hand.indexOf(7) >= 0, true);
  s.eq('对手换到 2 并补牌', k.players[1].hand.indexOf(2) >= 0, true);
});

s.group('公主与牌堆耗尽', function () {
  var g = fresh();
  setHands(g, [8, 4], [2]);
  g.deck = [2, 3, 5, 6];
  E.applyAction(g, { type: 'play', card: 8 });
  s.eq('打出公主立即出局', g.players[0].out, true);
  s.eq('打出公主则 AI 获胜', g.winner, 1);

  var e = fresh();
  setHands(e, [4, 6], [4]);
  e.deck = [];
  E.applyAction(e, { type: 'play', card: 4 });
  s.eq('牌堆空时比手牌，6 大于 4', e.winner, 0);
  s.eq('牌堆空对局结束', e.phase, 'over');

  var tie = fresh();
  setHands(tie, [4, 6], [6]);
  tie.deck = [];
  tie.players[1].discard = [1];
  E.applyAction(tie, { type: 'play', card: 4 });
  s.eq('手牌同点比较弃牌堆点数', tie.winner, 0);
});

s.group('30 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, maxSteps = 0, winners = { 0: 0, 1: 0, draw: 0 };
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ aiAll: true, seed: 3000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 500) {
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
  s.ok('单局步数有界', maxSteps < 500, 'max=' + maxSteps);
  s.ok('双方都有胜局', winners[0] > 0 && winners[1] > 0);
});

s.done();
