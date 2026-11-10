'use strict';

// 黑市骰局 — engine contract tests (no DOM, no copied rules).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('mini-ameri-b-16');

s.group('初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('两名玩家', g.players.length, 2);
  s.eq('初始筹码', g.players[0].chips, 10);
  s.eq('初始分数', g.players[0].score, 0);
  s.eq('最大轮数', g.maxRounds, 7);
  s.eq('首轮开始', g.round, 1);
  s.eq('合法出价', E.legalActions(g).join(','), '0,1,2,3');
  s.eq('未结束', g.over, false);
});

s.group('安全卡结算', function () {
  var g = E.createGame({ seed: 2 });
  g.deck = [{ type: 'safe', pot: 3 }];
  E.applyAction(g, 2, 0);
  s.eq('赢家支付 2 筹码', g.players[0].chips, 8);
  s.eq('安全卡得分 = 出价 + 底分', g.players[0].score, 5);
  s.eq('对手支付 0 筹码', g.players[1].chips, 10);
  s.eq('进入下一轮', g.round, 2);
  var h = E.createGame({ seed: 3 });
  h.deck = [{ type: 'safe', pot: 2 }];
  E.applyAction(h, 1, 1);
  s.eq('平局双方都支付筹码', [h.players[0].chips, h.players[1].chips], [9, 9]);
  s.eq('平局没有收益', [h.players[0].score, h.players[1].score], [0, 0]);
});

s.group('陷阱与非法出价', function () {
  var g = E.createGame({ seed: 4 });
  g.players[0].score = 4;
  g.deck = [{ type: 'trap' }];
  E.applyAction(g, 2, 1);
  s.eq('陷阱扣掉赢家出价', g.players[0].score, 2);
  s.eq('分数不会为负', g.players[0].score >= 0, true);
  var threw = false;
  try { E.applyAction(g, 4, 0); } catch (e) { threw = true; }
  s.ok('超出范围的出价抛错', threw);
  var poor = E.createGame({ seed: 5 });
  poor.players[0].chips = 1;
  var threw2 = false;
  try { E.applyAction(poor, 3, 0); } catch (e) { threw2 = true; }
  s.ok('筹码不足时抛错', threw2);
});

s.group('20 局 AI 自对弈', function () {
  var bad = 0, winners = {}, invariants = true;
  for (var seed = 1; seed <= 20; seed++) {
    try {
      var g = E.selfPlay(seed);
      if (!g.over || !g.winner) bad++;
      winners[g.winner] = (winners[g.winner] || 0) + 1;
      if (g.players[0].chips < 0 || g.players[1].chips < 0) invariants = false;
      if (g.players[0].score < 0 || g.players[1].score < 0) invariants = false;
      if (g.round > g.maxRounds + 1) invariants = false;
    } catch (e) { bad++; }
  }
  s.eq('20 局全部结束', bad, 0);
  s.ok('赢家标记合法', Object.keys(winners).every(function (k) { return k === 'p0' || k === 'p1' || k === 'draw'; }));
  s.ok('筹码与分数始终非负', invariants);
  var a = E.selfPlay(17), b = E.selfPlay(17);
  s.eq('同种子结果可复现', [a.winner, a.players[0].chips, a.players[0].score, a.players[1].score], [b.winner, b.players[0].chips, b.players[0].score, b.players[1].score]);
});

s.done();
