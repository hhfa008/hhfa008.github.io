'use strict';

// 6 Nimmt! engine tests. Engine is required directly (no rule copy).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('six-nimmt');

s.group('牌堆与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('3 名玩家', g.players.length, 3);
  s.eq('完整牌堆 104 张', E.fullDeck().length, 104);
  s.eq('每人 10 张手牌', g.players.map(function (p) { return p.hand.length; }), [10, 10, 10]);
  s.eq('开局 4 行', g.rows.length, 4);
  s.ok('每行 1 张起始牌', g.rows.every(function (r) { return r.length === 1; }));
  s.eq('第 1 轮', g.round, 1);
  s.eq('等待出牌', g.phase, 'pick');
});

s.group('牛头分与行定位', function () {
  s.eq('55 是 7 分', E.bull(55), 7);
  s.eq('33 是 5 分', E.bull(33), 5);
  s.eq('20 是 3 分', E.bull(20), 3);
  s.eq('25 是 2 分', E.bull(25), 2);
  s.eq('17 是 1 分', E.bull(17), 1);
  s.eq('104 是 1 分', E.bull(104), 1);
  var rows = [[10], [20], [30], [40]];
  s.eq('25 接第 2 行', E.targetRow(rows, 25), 1);
  s.eq('41 接第 4 行', E.targetRow(rows, 41), 3);
  s.eq('5 无处可接', E.targetRow(rows, 5), -1);
  s.eq('行分数累加', E.rowPoints([10, 20, 25]), 8);
});

s.group('出牌与结算', function () {
  var g = E.createGame({ seed: 2 });
  var c0 = g.players[0].hand[0], c1 = g.players[1].hand[0], c2 = g.players[2].hand[0];
  s.ok('手牌合法', E.legalCard(g, 0, c0));
  s.ok('非本手牌非法', !E.legalCard(g, 0, 105));
  var threw = false;
  try { E.chooseCard(g, 0, 105); } catch (e) { threw = true; }
  s.ok('非法手牌抛错', threw);
  E.chooseCard(g, 0, c0);
  threw = false;
  try { E.chooseCard(g, 0, g.players[0].hand[0]); } catch (e) { threw = true; }
  s.ok('同一轮重复出牌抛错', threw);
  E.chooseCard(g, 1, c1);
  s.eq('未出齐仍等待', g.phase, 'pick');
  E.chooseCard(g, 2, c2);
  s.ok('出齐后进入下一轮或抉择', g.phase === 'pick' || g.phase === 'chooseRow');
  s.ok('手牌各少一张', g.players.every(function (p) { return p.hand.length === 9; }));
});

s.group('小于行尾时必须选行', function () {
  var g = E.createGame({ seed: 3 });
  g.rows = [[10], [20], [30], [40]];
  g.players.forEach(function (p, i) { p.hand = [[5], [45], [50]][i]; });
  E.chooseCard(g, 0, 5);
  E.chooseCard(g, 1, 45);
  E.chooseCard(g, 2, 50);
  s.eq('轮到玩家选行', g.phase, 'chooseRow');
  s.eq('待选玩家是 0', g.pending.player, 0);
  var threw = false;
  try { E.chooseRow(g, 9); } catch (e) { threw = true; }
  s.ok('非法行号抛错', threw);
  E.chooseRow(g, 2);
  s.ok('吃下所选行', g.players[0].taken.indexOf(30) >= 0);
  s.eq('该行改为新牌', g.rows[2], [5]);
  s.eq('45 与 50 都接到第 4 行', g.rows[3], [40, 45, 50]);
  s.eq('第 2 行保持原样', g.rows[1], [20]);
});

s.group('第 6 张吃行', function () {
  var g = E.createGame({ seed: 4 });
  g.rows = [[10, 11, 12, 13, 14], [20], [30], [40]];
  g.players[0].hand = [15];
  g.players[1].hand = [45];
  g.players[2].hand = [50];
  E.chooseCard(g, 0, 15);
  E.chooseCard(g, 1, 45);
  E.chooseCard(g, 2, 50);
  s.ok('吃下整行 5 张', [10, 11, 12, 13, 14].every(function (c) {
    return g.players[0].taken.indexOf(c) >= 0;
  }));
  s.eq('吃行后该行只剩新牌', g.rows[0], [15]);
  s.eq('吃行分数正确', E.score(g, 0), E.rowPoints([10, 11, 12, 13, 14]));
});

s.group('30 局 AI 自对弈', function () {
  var bad = 0, roundsOk = true, handsOk = true, nonNeg = true;
  for (var seed = 1; seed <= 30; seed++) {
    try {
      var g = E.selfPlay(seed, 3);
      if (g.phase !== 'over') bad++;
      if (g.round !== 10) roundsOk = false;
      if (g.players.some(function (p) { return p.hand.length !== 0; })) handsOk = false;
      if (g.players.some(function (p, i) { return E.score(g, i) < 0; })) nonNeg = false;
    } catch (e) { bad++; }
  }
  s.eq('30 局无异常', bad, 0);
  s.eq('恰好 10 轮结束', roundsOk, true);
  s.ok('所有手牌打光', handsOk);
  s.ok('分数非负', nonNeg);
});

s.group('公共视图隐藏对手手牌', function () {
  var g = E.createGame({ seed: 5 });
  var view = E.publicView(g, 0);
  s.eq('自己的手牌可见', view.players[0].hand.length, 10);
  s.eq('对手手牌为 null', view.players[1].hand, null);
  s.eq('对手只暴露张数', view.players[1].handCount, 10);
  s.ok('视图不含牌堆', view.deck === undefined);
  s.ok('行信息完整公开', view.rows.length === 4);
});

s.done();
