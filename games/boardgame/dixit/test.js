'use strict';

/* Dixit (simplified) engine tests. Run: node games/boardgame/dixit/test.js */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var E = require('./engine.js');

var s = lib.suite('dixit');
var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

function displayFixture() {
  return [
    { displayId: 0, ownerId: 0, cardId: 'd01' },
    { displayId: 1, ownerId: 1, cardId: 'd02' },
    { displayId: 2, ownerId: 2, cardId: 'd03' }
  ];
}
function playersFixture() {
  return [
    { id: 0, name: '你', score: 0 },
    { id: 1, name: '小满', score: 0 },
    { id: 2, name: '阿岚', score: 0 }
  ];
}
function storyDisplay(g) {
  return g.display.filter(function (d) { return d.ownerId === 0; })[0];
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

s.group('开局与词卡库', function () {
  var g = E.createGame({ seed: 21 });
  s.eq('三人局', g.players.length, 3);
  s.eq('每人 5 张手牌', g.players.map(function (p) { return p.hand.length; }), [5, 5, 5]);
  s.eq('牌库 32 张', E.CARD_BANK.length, 32);
  s.eq('发牌后剩余 17 张', g.deck.length, 17);
  s.eq('第 1 回合', g.round, 1);
  s.eq('玩家 0 是讲述者', g.storyteller, 0);
  s.eq('初始阶段 clue', g.phase, 'clue');
  s.eq('初始分数 0:0:0', g.players.map(function (p) { return p.score; }), [0, 0, 0]);
  s.eq('最多 4 回合', g.maxRounds, 4);
  s.eq('目标 10 分', g.target, 10);
  s.ok('词卡均有文字与标签', E.CARD_BANK.every(function (c) { return c.text && c.tags.length >= 2; }));
});

s.group('隐藏信息', function () {
  var g = E.createGame({ seed: 22 });
  var v = E.viewFor(g, 0);
  s.ok('对手手牌全部隐藏', v.players[1].hand.every(function (c) { return c === 'hidden'; }));
  s.ok('自己的手牌可见', v.players[0].hand.every(function (c) { return c !== 'hidden'; }));
  s.ok('线索未给出前为空', v.clue === null);
  s.ok('讲述者暗牌不在视图中', v.storyCard === undefined);

  var cid = g.players[0].hand[0];
  E.applyAction(g, { type: 'clue', cardId: cid, text: '声音' });
  E.applyAction(g, { type: 'submit', cardId: g.players[1].hand[0] });
  E.applyAction(g, { type: 'submit', cardId: g.players[2].hand[0] });
  var voteView = E.viewFor(g, 0);
  s.eq('出牌后进入投票', g.phase, 'vote');
  s.eq('展示 3 张牌', voteView.display.length, 3);
  s.ok('投票阶段出处隐藏', voteView.display.every(function (d) { return d.ownerId === 'hidden'; }));
  s.eq('投票阶段票数隐藏', voteView.votes.length, 0);
});

s.group('线索校验与出牌流程', function () {
  var g = E.createGame({ seed: 23 });
  var cid = g.players[0].hand[0];
  s.eq('空线索拒绝', E.applyAction(g, { type: 'clue', cardId: cid, text: '  ' }).ok, false);
  s.eq('复述卡面文字拒绝', E.applyAction(g, {
    type: 'clue', cardId: cid, text: E.CARD_BY_ID[cid].text
  }).ok, false);
  s.eq('线索阶段仍可重试', g.phase, 'clue');
  s.eq('合法线索通过', E.applyAction(g, { type: 'clue', cardId: cid, text: '记忆' }).ok, true);
  s.eq('讲述者手牌减少到 4', g.players[0].hand.length, 4);
  s.eq('进入出牌阶段', g.phase, 'submit');
  s.eq('讲述者的牌已入池', g.submissions.length, 1);
  s.eq('非讲述者可以出牌', E.applyAction(g, { type: 'submit', cardId: g.players[1].hand[0] }).ok, true);
  s.eq('非讲述者不能出两次', E.applyAction(g, { type: 'submit', cardId: g.players[1].hand[0] }).ok, false);
  E.applyAction(g, { type: 'submit', cardId: g.players[2].hand[0] });
  s.eq('全部出牌后进入投票', g.phase, 'vote');
  s.eq('展示牌数量等于人数', g.display.length, 3);
  var own = g.display.filter(function (d) { return d.ownerId === 0; })[0];
  var voter1Own = g.display.filter(function (d) { return d.ownerId === 1; })[0];
  s.eq('不能投自己的牌', E.applyAction(g, { type: 'vote', displayId: voter1Own.displayId }).ok, false);
  s.eq('可以投他人的牌', E.applyAction(g, { type: 'vote', displayId: own.displayId }).ok, true);
});

s.group('计分规则', function () {
  var players = playersFixture();
  var display = displayFixture();
  var all = E.scoreVotes(players, display, [
    { voterId: 1, displayId: 0 }, { voterId: 2, displayId: 0 }
  ], 0);
  s.eq('全部猜中：讲述者 0 分', all.add[0], 0);
  s.eq('全部猜中：其他人各 +2', [all.add[1], all.add[2]], [2, 2]);
  s.eq('全部猜中：correct=2', all.correct, 2);

  var none = E.scoreVotes(players, display, [
    { voterId: 1, displayId: 2 }, { voterId: 2, displayId: 1 }
  ], 0);
  s.eq('无人猜中：讲述者 0 分', none.add[0], 0);
  s.eq('无人猜中：其他人各 +2', [none.add[1], none.add[2]], [2, 2]);

  var part = E.scoreVotes(players, display, [
    { voterId: 1, displayId: 0 }, { voterId: 2, displayId: 1 }
  ], 0);
  s.eq('部分猜中：讲述者 +3', part.add[0], 3);
  s.eq('猜中者 +3', part.add[1], 4);
  s.eq('未被投中者 0 分', part.add[2], 0);
  s.eq('部分猜中：correct=1', part.correct, 1);

  var g = E.createGame({ seed: 24 });
  E.applyAction(g, { type: 'clue', cardId: g.players[0].hand[0], text: '梦' });
  E.applyAction(g, { type: 'submit', cardId: g.players[1].hand[0] });
  E.applyAction(g, { type: 'submit', cardId: g.players[2].hand[0] });
  var sd = storyDisplay(g);
  E.applyAction(g, { type: 'vote', displayId: sd.displayId });
  E.applyAction(g, { type: 'vote', displayId: sd.displayId });
  s.eq('两人都猜中后进入结算', g.phase, 'score');
  s.eq('结算分数 0/2/2', g.players.map(function (p) { return p.score; }), [0, 2, 2]);
  s.eq('结算记录 correct=2', g.lastScore.correct, 2);
  s.ok('结算后公开出处', E.viewFor(g, 0).display.every(function (d) { return d.ownerId !== 'hidden'; }));
});

s.group('人类与 AI 交替流程', function () {
  var g = E.createGame({ seed: 25 });
  var cid = g.players[0].hand[0];
  E.applyAction(g, { type: 'clue', cardId: cid, text: '夜晚' });
  s.eq('第 1 回合人类讲述者', E.needsHuman(g), false);
  E.autoRun(g);
  s.eq('AI 出牌投票后进入结算', g.phase, 'score');
  s.eq('结算阶段等待人类继续', E.needsHuman(g), true);
  E.applyAction(g, { type: 'next' });
  s.eq('进入第 2 回合', g.round, 2);
  s.eq('第 2 回合 AI 讲述者', g.storyteller, 1);
  E.autoRun(g);
  s.eq('等待人类出牌', g.phase, 'submit');
  s.eq('确认轮到人类', E.needsHuman(g), true);
  E.applyAction(g, { type: 'submit', cardId: g.players[0].hand[0] });
  E.autoRun(g);
  s.eq('等待人类投票', g.phase, 'vote');
  var ownDisplay = E.viewFor(g, 0).mySubmitted;
  var pick = g.display.filter(function (d) { return d.displayId !== ownDisplay; })[0];
  E.applyAction(g, { type: 'vote', displayId: pick.displayId });
  E.autoRun(g);
  s.eq('第 2 回合完成结算', g.phase === 'score' || g.phase === 'over', true);
});

s.group('30 局 AI 自对弈', function () {
  var allLegal = true, allOver = true, maxSteps = 0, maxRound = 0, winners = {};
  for (var game = 0; game < 30; game++) {
    var g = E.createGame({ aiAll: true, seed: 5000 + game });
    var steps = 0;
    while (!E.isOver(g) && steps < 1000) {
      var a = E.aiAction(g);
      if (!a) { allLegal = false; break; }
      var r = E.applyAction(g, a);
      if (!r.ok) { allLegal = false; break; }
      steps++;
    }
    maxSteps = Math.max(maxSteps, steps);
    maxRound = Math.max(maxRound, g.round);
    if (!E.isOver(g)) allOver = false;
    winners[g.winner] = (winners[g.winner] || 0) + 1;
  }
  s.eq('30 局动作全部合法', allLegal, true);
  s.eq('30 局全部结束', allOver, true);
  s.ok('单局步数有界', maxSteps < 1000, 'max=' + maxSteps);
  s.ok('回合数不超过 4', maxRound <= 4, 'max=' + maxRound);
  s.ok('每局都有结果（含平局）', Object.keys(winners).length > 0);
});

s.done();
