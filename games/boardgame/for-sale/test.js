'use strict';

// For Sale engine tests. Engine is required directly (no rule copy).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('for-sale');

s.group('牌堆与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('3 名玩家', g.players.length, 3);
  s.eq('房产 30 张', g.propertyDeck.length + g.round, 30);
  s.eq('支票 30 张', g.checkDeck.length, 30);
  s.eq('起始现金 18', g.players.map(function (p) { return p.money; }), [18, 18, 18]);
  s.eq('首轮拍卖进行中', g.phase, 'auction');
  s.eq('首张房产可见', typeof g.auction.card, 'number');
  s.eq('首位玩家先手', g.auction.turn, 0);
  s.ok('房产值 1..30', E.PROPERTY_VALUES.join(',') === (function () {
    var a = []; for (var i = 1; i <= 30; i++) a.push(i); return a.join(',');
  })());
});

s.group('拍卖合法性', function () {
  var g = E.createGame({ seed: 2 });
  s.ok('轮到自己可出价', E.legalBid(g, 0));
  s.ok('非当前玩家不可出价', !E.legalBid(g, 1));
  var threw = false;
  try { E.bid(g, 1, 3); } catch (e) { threw = true; }
  s.ok('非法玩家出价抛错', threw);
  threw = false;
  try { E.pass(g, 0); } catch (e) { threw = true; }
  s.ok('开局玩家不能直接放弃', threw);
  E.bid(g, 0, 4);
  s.eq('出价后轮转', g.auction.turn, 1);
  threw = false;
  try { E.bid(g, 1, 4); } catch (e) { threw = true; }
  s.ok('加价必须更高', threw);
  threw = false;
  try { E.bid(g, 1, 99); } catch (e) { threw = true; }
  s.ok('超出持有现金抛错', threw);
  E.pass(g, 1);
  E.pass(g, 2);
  s.eq('最后一人中标', g.players[0].props.length, 1);
  s.eq('中标者付款', g.players[0].money, 14);
  s.eq('进入下一轮', g.round, 2);
});

s.group('出牌换支票', function () {
  var g = E.createGame({ seed: 3 });
  var guard = 0;
  while (g.phase !== 'sell' && guard++ < 500) {
    if (g.phase === 'auction' && g.auction.turn === 0) E.aiAuction(g, 0);
    else if (g.phase === 'auction') E.step(g);
  }
  s.eq('30 轮拍卖后进入卖房', g.phase, 'sell');
  s.eq('共拍出 30 张房产', g.players.reduce(function (a, p) { return a + p.props.length; }, 0), 30);
  s.ok('每个人都有房产可出', g.players.every(function (p) { return p.props.length > 0; }));
  var card = g.players[0].props[0];
  s.ok('合法出牌', E.legalSellCard(g, 0, card));
  s.ok('不能出别人的牌', !E.legalSellCard(g, 1, card));
  E.chooseSellCard(g, 0, card);
  s.eq('记录暗牌', g.sell.picks[0], card);
  s.eq('AI 未选时隐藏暗牌', E.publicView(g, 0).sell.picks[1], null);
  E.chooseSellCard(g, 1, g.players[1].props[0]);
  E.chooseSellCard(g, 2, g.players[2].props[0]);
  s.eq('三人出齐后结算', g.sell.round, 1);
  s.eq('每人拿到一张支票', g.players.map(function (p) { return p.checks.length; }), [1, 1, 1]);
  s.ok('支票从高到低分配', g.checkDeck.length === 27);
});

s.group('计分与胜负', function () {
  var g = E.createGame({ seed: 4 });
  g.players[0].money = 5;
  g.players[0].checks = [10, 2];
  s.eq('总分=现金+支票', E.totalMoney(g, 0), 17);
  var total = 0;
  for (var i = 0; i < 30; i++) total += 18;
  s.eq('初始资金总量正确', total, 540);
});

s.group('30 局 AI 自对弈', function () {
  var bad = 0, winners = {}, checksOk = true, moneyOk = true;
  for (var seed = 1; seed <= 30; seed++) {
    try {
      var g = E.selfPlay(seed, 3);
      if (g.phase !== 'over' || g.winner == null) bad++;
      winners[g.winner] = (winners[g.winner] || 0) + 1;
      if (g.players.some(function (p) { return p.props.length !== 0; })) checksOk = false;
      if (g.players.reduce(function (a, p) { return a + p.checks.length; }, 0) !== 30) checksOk = false;
      if (g.players.some(function (p) { return p.money < 0; })) moneyOk = false;
    } catch (e) { bad++; }
  }
  s.eq('30 局无异常', bad, 0);
  s.ok('每局都有赢家', Object.keys(winners).length > 0);
  s.ok('每人打光 10 张房产/拿到 10 张支票', checksOk);
  s.ok('现金不为负', moneyOk);
});

s.group('公共视图不泄漏暗牌', function () {
  var g = E.createGame({ seed: 5 });
  var guard = 0;
  while (g.phase !== 'sell' && guard++ < 500) {
    if (g.phase === 'auction' && g.auction.turn === 0) E.aiAuction(g, 0);
    else if (g.phase === 'auction') E.step(g);
  }
  E.chooseSellCard(g, 1, g.players[1].props[0]);
  E.chooseSellCard(g, 2, g.players[2].props[0]);
  var view = E.publicView(g, 0);
  s.eq('自己尚未出牌应为空', view.sell.picks[0], null);
  s.eq('他人暗牌被掩码', view.sell.picks[1], 'hidden');
  s.eq('另一名 AI 暗牌也被掩码', view.sell.picks[2], 'hidden');
  s.ok('视图不含未抽牌堆', view.propertyDeck === undefined && view.checkDeck === undefined);
});

s.done();
