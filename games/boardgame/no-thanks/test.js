'use strict';

// No Thanks! engine tests. Engine is required directly (no rule copy).
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var s = lib.suite('no-thanks');

s.group('牌堆与初始状态', function () {
  var g = E.createGame({ seed: 1 });
  s.eq('3 名玩家', g.players.length, 3);
  s.eq('移除 9 张后牌区剩 23 张', g.deck.length, 23);
  s.eq('移除牌 9 张', g.removed.length, 9);
  s.eq('移除牌不重复', new Set(g.removed).size, 9);
  s.eq('牌面恰好 3..35', (function () {
    var all = g.deck.concat(g.removed, [g.current]).sort(function (a, b) { return a - b; });
    for (var i = 0; i < all.length; i++) if (all[i] !== i + 3) return false;
    return all.length === 33;
  })(), true);
  s.eq('每人 11 筹码', g.players.map(function (p) { return p.chips; }), [11, 11, 11]);
  s.eq('首张牌已翻开', typeof g.current, 'number');
  s.eq('牌面筹码为 0', g.chipsOnCard, 0);
  s.eq('玩家 0 先手', g.turn, 0);
  s.eq('完整牌堆 33 张', E.fullDeck().length, 33);
});

s.group('取牌与跳过', function () {
  var g = E.createGame({ seed: 2 });
  s.ok('轮到自己可取', E.legalTake(g, 0));
  s.ok('非当前玩家不可取', !E.legalTake(g, 1));
  s.ok('有筹码可跳过', E.legalPass(g, 0));
  var threw = false;
  try { E.take(g, 1); } catch (e) { threw = true; }
  s.ok('非法取牌抛错', threw);
  var card = g.current;
  E.pass(g, 0);
  s.eq('跳过扣 1 筹码', g.players[0].chips, 10);
  s.eq('跳过给牌加筹码', g.chipsOnCard, 1);
  s.eq('轮转到玩家 1', g.turn, 1);
  E.take(g, 1);
  s.ok('取到当前牌', g.players[1].cards.indexOf(card) >= 0);
  s.eq('取牌获得牌上筹码', g.players[1].chips, 12);
  s.eq('牌面筹码清零', g.chipsOnCard, 0);
  s.eq('轮转到玩家 2', g.turn, 2);
  g.players[0].chips = 0;
  g.turn = 0;
  s.ok('无筹码不能跳过', !E.legalPass(g, 0));
  threw = false;
  try { E.pass(g, 0); } catch (e) { threw = true; }
  s.ok('无筹码跳过抛错', threw);
});

s.group('计分规则', function () {
  s.eq('单张计面值', E.scoreCards([17]), 17);
  s.eq('连续段只计最小', E.scoreCards([7, 8, 9]), 7);
  s.eq('两段分别计最小', E.scoreCards([3, 4, 5, 10, 11]), 13);
  s.eq('乱序也正确', E.scoreCards([9, 7, 8, 20]), 27);
  s.eq('空牌 0 分', E.scoreCards([]), 0);
  var g = E.createGame({ seed: 3 });
  g.players[0].cards = [8, 9, 10];
  g.players[0].chips = 4;
  s.eq('总分=牌分-筹码', E.score(g, 0), 4);
  s.eq('最低分获胜', (function () {
    var h = E.selfPlay(3, 3);
    var best = 0;
    h.players.forEach(function (p, i) { if (E.score(h, i) < E.score(h, best)) best = i; });
    return h.winner === best;
  })(), true);
});

s.group('末牌与结束', function () {
  var g = E.createGame({ seed: 4 });
  g.deck = [];
  g.current = 30;
  g.chipsOnCard = 2;
  E.take(g, 0);
  s.eq('取走末牌后结束', g.phase, 'over');
  s.ok('末牌计入玩家', g.players[0].cards.indexOf(30) >= 0);
  s.ok('有最终赢家', g.winner != null);
});

s.group('30 局 AI 自对弈', function () {
  var bad = 0, illegal = 0, balance = true;
  for (var seed = 1; seed <= 30; seed++) {
    try {
      var g = E.selfPlay(seed, 3);
      if (g.phase !== 'over') bad++;
      g.players.forEach(function (p, i) {
        if (p.chips < 0) balance = false;
        if (p.cards.length + 0 !== p.cards.filter(function (c, j) {
          return p.cards.indexOf(c) === j;
        }).length) illegal++;
      });
      var played = g.players.reduce(function (a, p) { return a + p.cards.length; }, 0);
      if (played !== 24) illegal++;
    } catch (e) { bad++; }
  }
  s.eq('30 局无异常', bad, 0);
  s.eq('24 张牌全部被拿走', illegal, 0);
  s.ok('筹码不为负', balance);
});

s.group('公共视图不泄漏牌堆顺序', function () {
  var g = E.createGame({ seed: 5 });
  var view = E.publicView(g, 0);
  s.eq('视图给出剩余牌数', view.deckCount, g.deck.length);
  s.ok('视图不包含牌堆数组', view.deck === undefined);
  s.eq('自己的牌可见', view.players[0].cards.length, g.players[0].cards.length);
  s.eq('对手的牌也公开（本作规则）', view.players[1].cards.length, g.players[1].cards.length);
  s.ok('视图不含被移除牌的具体值', view.removed === undefined);
});

s.done();
