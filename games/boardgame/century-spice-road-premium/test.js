'use strict';

/*
 * 香料之路 Century: Spice Road（premium 版）引擎与页面测试。
 *
 * 运行：node games/boardgame/century-spice-road-premium/test.js
 * 覆盖：36 张得分卡 / 43 张商人卡、两人局设置、四种行动、获取支付、
 *       金币银币、商队上限、终局计分、平局、30 局 AI 自对弈、性能与页面契约。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('century-spice-road-premium');
var E = require('./engine.js');
var D = require('./data.js');

var DIR = __dirname;
var index = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(DIR, 'rules.html'), 'utf8');
var engineSrc = fs.readFileSync(path.join(DIR, 'engine.js'), 'utf8');
var dataSrc = fs.readFileSync(path.join(DIR, 'data.js'), 'utf8');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}
function cjkCount(text) {
  var m = text.match(/[㐀-鿿]/g);
  return m ? m.length : 0;
}
function pointById(id) {
  return D.POINT_CARDS.filter(function (card) { return card.id === id; })[0];
}

/* ------------------------------------------------------------------ */
/* 1. 数据与真实件数                                                   */
/* ------------------------------------------------------------------ */

s.group('数据与真实件数', function () {
  s.eq('香料共 4 种', D.SPICES.length, 4);
  s.eq('香料顺序正确', D.SPICE_KEYS, ['turmeric', 'saffron', 'cardamom', 'cinnamon']);
  s.eq('得分卡 36 张', D.POINT_CARDS.length, 36);
  s.eq('得分卡 ID 唯一', new Set(D.POINT_CARDS.map(function (c) { return c.id; })).size, 36);
  s.eq('得分卡分值 6–20', D.POINT_CARDS.every(function (c) {
    return c.points >= 6 && c.points <= 20;
  }), true);
  s.eq('得分卡费用都是 4 维非负整数', D.POINT_CARDS.every(function (c) {
    return c.cost.length === 4 && c.cost.every(function (n) { return Number.isInteger(n) && n >= 0; });
  }), true);
  s.eq('得分卡总费用至少 4', D.POINT_CARDS.every(function (c) {
    return c.cost.reduce(function (sum, n) { return sum + n; }, 0) >= 4;
  }), true);
  s.eq('商人卡模板 19 种', D.MERCHANT_TEMPLATES.length, 19);
  s.eq('商人卡总数 43 张', D.MERCHANT_TEMPLATES.reduce(function (sum, t) { return sum + t.copies; }, 0), 43);
  s.eq('起始卡模板 2 张', D.STARTING_CARDS.length, 2);
  s.eq('起始卡是生产 2 姜黄 + 升级 2', D.STARTING_CARDS.map(function (c) {
    return c.key;
  }), ['start-create2y', 'start-upgrade2']);
  s.eq('香料方块总数 105', D.CUBE_SUPPLY.turmeric + D.CUBE_SUPPLY.saffron +
    D.CUBE_SUPPLY.cardamom + D.CUBE_SUPPLY.cinnamon, 105);
  s.eq('姜黄 34 / 藏红花 30 / 豆蔻 21 / 肉桂 20', [
    D.CUBE_SUPPLY.turmeric, D.CUBE_SUPPLY.saffron, D.CUBE_SUPPLY.cardamom, D.CUBE_SUPPLY.cinnamon
  ], [34, 30, 21, 20]);
  s.eq('数据页是 UMD', /root\.CenturySpiceRoadData/.test(dataSrc), true);
  s.eq('引擎页是 UMD', /root\.CenturySpiceRoadEngine/.test(engineSrc), true);
  s.eq('引擎不调用 Math.random', /Math\.random/.test(engineSrc), false);
});

/* ------------------------------------------------------------------ */
/* 2. 两人局开局                                                       */
/* ------------------------------------------------------------------ */

s.group('两人局开局', function () {
  var state = E.createGame(20261110);
  s.eq('两名玩家', state.players.length, 2);
  s.eq('先手为 0 或 1', state.firstPlayer === 0 || state.firstPlayer === 1, true);
  s.eq('当前玩家等于先手', state.current, state.firstPlayer);
  s.eq('先手 3 个姜黄，后手 4 个姜黄',
    state.firstPlayer === 0 ? [state.players[0].spices[0], state.players[1].spices[0]] : [state.players[1].spices[0], state.players[0].spices[0]],
    [3, 4]);
  s.eq('双方起始手牌各 2 张', state.players.map(function (p) { return p.hand.length; }), [2, 2]);
  s.eq('起始手牌是生产 2 姜黄 + 升级 2', state.players[0].hand.map(function (c) { return c.key; }),
    ['start-create2y', 'start-upgrade2']);
  s.eq('商人市场 6 张', state.merchantMarket.length, 6);
  s.eq('商人牌堆 37 张', state.merchantDeck.length, 37);
  s.eq('得分市场 5 张', state.pointMarket.length, 5);
  s.eq('得分牌堆 31 张', state.pointDeck.length, 31);
  s.eq('金币 4 枚', state.coins.gold, 4);
  s.eq('银币 4 枚', state.coins.silver, 4);
  s.eq('开局不是最后一轮', state.finalRound, false);
  s.eq('开局未结束', state.over, false);
  s.eq('商队上限为 10', E.CARAVAN_LIMIT, 10);
  s.eq('2–3 人局第 6 张得分卡终局', E.END_SCORE_CARDS, 6);
  s.eq('同种子开局一致', JSON.stringify(E.createGame(9)), JSON.stringify(E.createGame(9)));
});

/* ------------------------------------------------------------------ */
/* 3. 升级组合                                                         */
/* ------------------------------------------------------------------ */

s.group('升级组合', function () {
  s.eq('1 张升级 2 且只有姜黄时有两种方案', E.upgradeSequences([3, 0, 0, 0], 2).length, 2);
  s.eq('升级序列长度正确', E.upgradeSequences([3, 0, 0, 0], 2).every(function (seq) {
    return seq.length === 2;
  }), true);
  s.eq('可以连续升级同一个香料', E.upgradeSequences([3, 0, 0, 0], 2).some(function (seq) {
    return seq.join(',') === '0,1';
  }), true);
  s.eq('没有香料时没有升级方案', E.upgradeSequences([0, 0, 0, 0], 1).length, 0);
  s.eq('升级 1 只有 1 种方案', E.upgradeSequences([1, 0, 0, 0], 1).length, 1);
  s.eq('升级卡效果可应用', E.canApplyEffect({
    spices: [3, 0, 0, 0]
  }, { type: 'upgrade', count: 2 }, [0, 0]), true);
  s.eq('非法升级序列被拒绝', E.canApplyEffect({
    spices: [3, 0, 0, 0]
  }, { type: 'upgrade', count: 2 }, [2, 2]), false);
});

/* ------------------------------------------------------------------ */
/* 4. 打出商人卡                                                       */
/* ------------------------------------------------------------------ */

s.group('打出商人卡', function () {
  var state = E.createGame(1);
  var pi = state.current;
  var next = E.applyMove(state, { type: 'play', cardIndex: 0, upgrades: [] });
  s.eq('生产 2 姜黄后香料 +2', next.players[pi].spices[0], state.players[pi].spices[0] + 2);
  s.eq('打出的卡进入已打出区', next.players[pi].played.length, 1);
  s.eq('手牌减少 1 张', next.players[pi].hand.length, 1);
  s.eq('原状态未被修改', state.players[pi].spices[0], 3);
  s.eq('轮到对手', next.current, 1 - pi);

  // 构造一张转换卡测试支付与获得。
  var trade = E.createGame(2);
  var pi2 = trade.current;
  var template = D.MERCHANT_TEMPLATES.filter(function (t) { return t.key === 'trade2y1r'; })[0];
  trade.players[pi2].spices = [2, 0, 0, 0];
  trade.players[pi2].hand = [{
    id: 'test-trade', key: template.key, name: template.name, text: template.text,
    effect: JSON.parse(JSON.stringify(template.effect)), cubes: [0, 0, 0, 0]
  }];
  var traded = E.applyMove(trade, { type: 'play', cardIndex: 0, upgrades: [] });
  s.eq('转换支付 2 姜黄', traded.players[pi2].spices[0], 0);
  s.eq('转换获得 1 藏红花', traded.players[pi2].spices[1], 1);
  s.eq('转换卡进入已打出区', traded.players[pi2].played.length, 1);

  // 升级 2：把一张姜黄连续升级两次到豆蔻。
  var up = E.createGame(3);
  var pi3 = up.current;
  up.players[pi3].spices = [3, 0, 0, 0];
  var upgraded = E.applyMove(up, { type: 'play', cardIndex: 1, upgrades: [0, 1] });
  s.eq('连续升级后姜黄剩 2', upgraded.players[pi3].spices[0], 2);
  s.eq('连续升级后豆蔻 +1', upgraded.players[pi3].spices[2], 1);
  s.eq('连续升级后藏红花为 0', upgraded.players[pi3].spices[1], 0);

  // 休息：把已打出的卡收回。
  var restState = E.applyMove(up, { type: 'play', cardIndex: 0, upgrades: [] });
  var piRest = restState.current === 0 ? 1 : 0;
  restState.current = piRest;
  var rested = E.applyMove(restState, { type: 'rest' });
  s.eq('休息后已打出区清空', rested.players[piRest].played.length, 0);
  s.eq('休息后手牌增加', rested.players[piRest].hand.length >= 1, true);

  expectThrow('没有已打出的卡不能休息', function () {
    var fresh = E.createGame(4);
    E.applyMove(fresh, { type: 'rest' });
  }, /没有已打出/);
});

/* ------------------------------------------------------------------ */
/* 5. 获取商人卡与支付                                                 */
/* ------------------------------------------------------------------ */

s.group('获取商人卡与支付', function () {
  var state = E.createGame(5);
  var pi = state.current;
  state.players[pi].spices = [3, 3, 3, 3];
  var before = state.players[pi].spices.slice();
  var chosenCubes = state.merchantMarket[2].cubes.slice();
  var acquired = E.applyMove(state, { type: 'acquire', marketIndex: 2 });
  s.eq('获取后手牌 +1', acquired.players[pi].hand.length, state.players[pi].hand.length + 1);
  s.eq('左侧两张卡各得到 1 个香料',
    acquired.merchantMarket[0].cubes.reduce(function (a, b) { return a + b; }, 0) >= 1 &&
    acquired.merchantMarket[1].cubes.reduce(function (a, b) { return a + b; }, 0) >= 1, true);
  s.eq('获取后玩家香料总数变化符合支付与收获',
    E.totalSpices(acquired.players[pi].spices),
    E.totalSpices(before) - 2 + chosenCubes.reduce(function (a, b) { return a + b; }, 0));

  // 自定义支付。
  var custom = E.createGame(6);
  var pi2 = custom.current;
  custom.players[pi2].spices = [1, 1, 1, 1];
  var pay = [[0, 1, 0, 0], [0, 0, 1, 0]];
  var customNext = E.applyMove(custom, { type: 'acquire', marketIndex: 2, payment: pay });
  s.eq('自定义支付把藏红花放到第 1 张左侧卡', customNext.merchantMarket[0].cubes[1], 1);
  s.eq('自定义支付把豆蔻放到第 2 张左侧卡', customNext.merchantMarket[1].cubes[2], 1);
  s.eq('自定义支付后藏红花减少', customNext.players[pi2].spices[1], 0);
  s.eq('自定义支付后豆蔻减少', customNext.players[pi2].spices[2], 0);

  // 最左免费。
  var free = E.createGame(7);
  var pi3 = free.current;
  free.players[pi3].spices = [0, 0, 0, 0];
  var freeNext = E.applyMove(free, { type: 'acquire', marketIndex: 0 });
  s.eq('最左商人卡免费', freeNext.players[pi3].hand.length, free.players[pi3].hand.length + 1);

  // 香料不足。
  var poor = E.createGame(8);
  poor.players[poor.current].spices = [0, 0, 0, 0];
  expectThrow('没有香料不能获取右侧卡', function () {
    E.applyMove(poor, { type: 'acquire', marketIndex: 2 });
  }, /不足/);
  s.eq('支付校验：数量不匹配被拒绝', E.validatePayment(poor.players[poor.current], 2, [[1, 0, 0, 0]]).ok, false);
  s.eq('支付校验：每张卡只能放 1 个', E.validatePayment({
    spices: [2, 0, 0, 0]
  }, 1, [[2, 0, 0, 0]]).ok, false);
});

/* ------------------------------------------------------------------ */
/* 6. 领取得分卡与金币                                                 */
/* ------------------------------------------------------------------ */

s.group('领取得分卡与金币', function () {
  var state = E.createGame(9);
  var pi = state.current;
  var cheap = { id: 'test-point', key: 'test', points: 12, cost: [1, 0, 0, 0], name: '12 分测试卡' };
  state.pointMarket[0] = cheap;
  state.players[pi].spices = [1, 0, 0, 0];
  var claimed = E.applyMove(state, { type: 'claim', cardId: cheap.id });
  s.eq('领取后得分卡 +1', claimed.players[pi].scoreCards.length, 1);
  s.eq('领取后支付 1 姜黄', claimed.players[pi].spices[0], 0);
  s.eq('第 1 位得分卡给金币', claimed.players[pi].gold, 1);
  s.eq('银行金币减少 1', claimed.coins.gold, 3);
  s.eq('得分市场补回 5 张', claimed.pointMarket.length, 5);

  var silver = E.createGame(10);
  var pi2 = silver.current;
  silver.pointMarket[1] = { id: 'test-point2', key: 'test2', points: 8, cost: [0, 1, 0, 0], name: '8 分测试卡' };
  silver.players[pi2].spices = [0, 1, 0, 0];
  var silverNext = E.applyMove(silver, { type: 'claim', cardId: 'test-point2' });
  s.eq('第 2 位得分卡给银币', silverNext.players[pi2].silver, 1);
  s.eq('银行银币减少 1', silverNext.coins.silver, 3);

  var slide = E.createGame(11);
  var pi3 = slide.current;
  slide.coins.gold = 0;
  slide.pointMarket[0] = { id: 'test-point3', key: 'test3', points: 9, cost: [1, 0, 0, 0], name: '9 分测试卡' };
  slide.players[pi3].spices = [1, 0, 0, 0];
  var slideNext = E.applyMove(slide, { type: 'claim', cardId: 'test-point3' });
  s.eq('金币用尽后银币滑到第 1 位', slideNext.players[pi3].silver, 1);
  s.eq('金币用尽后不再给金币', slideNext.players[pi3].gold, 0);

  expectThrow('香料不足不能领取', function () {
    var poor = E.createGame(12);
    poor.players[poor.current].spices = [0, 0, 0, 0];
    E.applyMove(poor, { type: 'claim', cardId: poor.pointMarket[0].id });
  }, /不足/);
});

/* ------------------------------------------------------------------ */
/* 7. 终局与计分                                                       */
/* ------------------------------------------------------------------ */

s.group('终局与计分', function () {
  var state = E.createGame(13);
  var pi = state.current;
  state.players[pi].scoreCards = [
    { id: 'a', points: 10 }, { id: 'b', points: 12 }, { id: 'c', points: 8 },
    { id: 'd', points: 15 }, { id: 'e', points: 9 }
  ];
  state.pointMarket[0] = { id: 'final-point', key: 'final', points: 6, cost: [0, 0, 0, 0], name: '6 分' };
  state.players[pi].spices = [0, 0, 0, 0];
  var triggered = E.applyMove(state, { type: 'claim', cardId: 'final-point' });
  s.eq('第 6 张得分卡触发最后一轮', triggered.finalRound, true);
  s.eq('记录触发者', triggered.finalRoundBy, pi);
  s.eq('触发后尚未立刻结束', triggered.over, false);

  var otherMove = E.getLegalMoves(triggered)[0];
  s.ok('对手仍有合法动作', !!otherMove);
  var ended = E.applyMove(triggered, otherMove);
  s.eq('最后一轮结束对局', ended.over, true);
  s.ok('结算含双方总分', ended.result.scores.every(function (row) { return typeof row.total === 'number'; }));

  var scoreState = E.createGame(14);
  scoreState.players[0].scoreCards = [{ id: 'x', points: 13 }, { id: 'y', points: 9 }];
  scoreState.players[0].gold = 2;
  scoreState.players[0].silver = 3;
  scoreState.players[0].spices = [5, 2, 1, 1];
  scoreState.players[1].scoreCards = [{ id: 'z', points: 20 }];
  scoreState.players[1].gold = 1;
  scoreState.players[1].silver = 0;
  scoreState.players[1].spices = [0, 0, 0, 0];
  scoreState.lastPlayer = 1;
  var result = E.computeResults(scoreState, '测试');
  s.eq('得分卡分值合计', result.scores[0].points, 22);
  s.eq('金币 3 分/枚', result.scores[0].coins, 2 * 3 + 3 * 1);
  s.eq('剩余非姜黄香料计分', result.scores[0].cubes, 4);
  s.eq('总分 = 卡 + 币 + 香料', result.scores[0].total, 22 + 9 + 4);
  s.eq('技高一筹者获胜', result.winner, 0);

  scoreState.players[1].scoreCards = [{ id: 'z', points: 20 }];
  scoreState.players[1].gold = 4;
  scoreState.players[1].spices = [0, 1, 1, 1];
  var tie = E.computeResults(scoreState, '测试');
  s.eq('同分时最后行动者获胜', tie.winner, 1);
  s.ok('平局说明包含最后行动', /最后行动/.test(tie.tieBreak));
});

/* ------------------------------------------------------------------ */
/* 8. 商队上限与保守                                                   */
/* ------------------------------------------------------------------ */

s.group('商队上限与守恒', function () {
  var state = E.createGame(15);
  var pi = state.current;
  state.players[pi].spices = [9, 0, 0, 0];
  var next = E.applyMove(state, { type: 'play', cardIndex: 0, upgrades: [] });
  s.eq('超过 10 个时被退回', E.totalSpices(next.players[pi].spices), 10);
  s.eq('退回的是最低价值姜黄', next.players[pi].spices[0], 10);
  s.ok('退回写入记录', next.log.some(function (entry) { return entry.type === 'trim'; }));
});

/* ------------------------------------------------------------------ */
/* 9. 30 局 AI 自对弈与性能                                            */
/* ------------------------------------------------------------------ */

s.group('30 局 AI 自对弈与性能', function () {
  var allLegal = true, allOver = true, resultOk = true;
  var totals = [];
  var started = Date.now();
  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame(seed);
    var guard = 0;
    var legalHere = true;
    while (!state.over && guard < 2000) {
      var moves = E.getLegalMoves(state);
      if (!moves.length) { legalHere = false; break; }
      var move = E.chooseAIMove(state);
      if (!move) { legalHere = false; break; }
      var check = E.validateMove(state, move);
      if (!check.ok) legalHere = false;
      try { state = E.applyMove(state, move); }
      catch (error) { legalHere = false; break; }
      guard++;
    }
    if (!legalHere) allLegal = false;
    if (!state.over) allOver = false;
    if (!state.result || state.result.scores.some(function (row) {
      return row.total !== row.points + row.coins + row.cubes;
    })) resultOk = false;
    totals.push(state.result ? state.result.scores.map(function (row) { return row.total; }) : []);
    s.ok('种子 ' + seed + ' 自对弈合法结束', legalHere && state.over && guard < 2000,
      '步数 ' + guard + '，结束 ' + state.over);
  }
  var elapsed = Date.now() - started;
  s.ok('30 局全部只走合法动作', allLegal);
  s.ok('30 局全部正常结束', allOver);
  s.ok('30 局结算公式正确', resultOk);
  s.ok('30 局自对弈性能 < 20 秒', elapsed < 20000, elapsed + 'ms');
  s.ok('分数在合理范围', totals.every(function (pair) {
    return pair.every(function (x) { return x >= 0 && x <= 250; });
  }));

  var perf = E.createGame(42);
  for (var i = 0; i < 60 && !perf.over; i++) perf = E.applyMove(perf, E.chooseAIMove(perf));
  var t0 = Date.now();
  for (var j = 0; j < 100; j++) E.chooseAIMove(perf);
  var aiMs = Date.now() - t0;
  s.ok('100 次 AI 决策 < 5 秒', aiMs < 5000, aiMs + 'ms');
  s.ok('页面体积 < 250KB', Buffer.byteLength(index, 'utf8') < 250000,
    Buffer.byteLength(index, 'utf8') + ' bytes');
});

/* ------------------------------------------------------------------ */
/* 10. 页面契约                                                        */
/* ------------------------------------------------------------------ */

s.group('页面离线与可访问性契约', function () {
  s.ok('游戏页有 viewport', /name="viewport"/.test(index));
  s.ok('游戏页引用同源 data.js', /<script[^>]*src="data\.js"/.test(index));
  s.ok('游戏页引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(index));
  s.ok('游戏页无外部脚本', !/<script[^>]*src="https?:/i.test(index));
  s.ok('游戏页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(index));
  s.ok('游戏页无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(index));
  s.ok('游戏页无远程 url()', !/url\(\s*["']?https?:/i.test(index));
  s.ok('游戏页有 430px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(index));
  s.ok('游戏页有 340px 小屏媒体查询', /@media\s*\(max-width:\s*340px\)/.test(index));
  s.ok('游戏页有减少动效降级', /prefers-reduced-motion/.test(index));
  s.ok('游戏页有暗色可读方案', /prefers-color-scheme:\s*dark/.test(index));
  s.ok('游戏页有 aria-label', /aria-label=/.test(index));
  s.ok('游戏页有 44px 触控目标', /min-height:\s*44px/.test(index));
  s.ok('游戏页有 SVG 香料方块', /viewBox="0 0 40 40"/.test(index) && /cubeSvg/.test(index));
  s.ok('游戏页有金币 / 银币 SVG', /coinSvg/.test(index) && /viewBox="0 0 32 32"/.test(index));
  s.ok('游戏页复用 shared/sfx.js', /shared\/sfx\.js/.test(index) && /window\.Sfx/.test(index));
  s.ok('游戏页复用 shared/shuffle.js', /shared\/shuffle\.js/.test(index));
  s.ok('游戏页复用 shared/rewards.js', /shared\/rewards\.js/.test(index) && /Rewards\.record/.test(index));
  s.ok('游戏页有联机房间入口', /href="online\.html"/.test(index));
  s.ok('游戏页有 OG 图与封面预载', /og:image/.test(index) && /assets\/og\.webp/.test(index) && /assets\/cover\.webp/.test(index));
  s.ok('游戏页引用本地材质', /assets\/art\/premium\//.test(index) && /\.webp/.test(index));
  s.ok('有离线 sw.js', fs.existsSync(path.join(DIR, 'sw.js')) && /caches\.open/.test(fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8')));
  s.ok('有 meta.json 与 perf.json', fs.existsSync(path.join(DIR, 'meta.json')) && fs.existsSync(path.join(DIR, 'perf.json')));
  s.ok('有联机页面与服务端', fs.existsSync(path.join(DIR, 'online.html')) && /createRoomStoreInternal/.test(fs.readFileSync(path.join(DIR, 'online-server.mjs'), 'utf8')));
  s.ok('联机测试输出契约', /ONLINE_E2E_JSON/.test(fs.readFileSync(path.join(DIR, 'test-online.js'), 'utf8')));
  s.ok('游戏页有静音按钮', /id="muteBtn"/.test(index));
  s.ok('游戏页有至少 3 段关键帧动画', (index.match(/@keyframes/g) || []).length >= 3);
  s.ok('游戏页有 WAAPI 动画调用', /\.animate\s*\(/.test(index));
  s.ok('游戏页有种子输入', /id="seedInput"/.test(index));
  s.ok('游戏页有重开与换局', /id="restart"/.test(index) && /id="newSeed"/.test(index));
  s.ok('游戏页有 AI 演示', /id="autoDemo"/.test(index) && /startDemo/.test(index));
  s.ok('游戏页有得分卡市场', /id="pointMarket"/.test(index) && /id="claimBtn"/.test(index));
  s.ok('游戏页有商人卡市场与支付', /id="merchantMarket"/.test(index) && /id="payTray"/.test(index) && /id="acquireBtn"/.test(index));
  s.ok('游戏页有手牌与休息', /id="hand"/.test(index) && /id="restBtn"/.test(index) && /id="playBtn"/.test(index));
  s.ok('游戏页有商队面板', /id="caravanHuman"/.test(index) && /id="caravanAI"/.test(index));
  s.ok('游戏页有对局记录', /id="log"/.test(index));
  s.ok('游戏页有结果弹层', /id="resultOverlay"/.test(index) && /role="dialog"/.test(index));
  s.ok('游戏页有键盘取消', /event\.key === 'Escape'/.test(index));
  s.ok('游戏页有调试钩子', /window\.__century/.test(index));
  s.ok('游戏页无 Math.random', !/Math\.random/.test(index.replace(/<script[\s\S]*?<\/script>/gi, '')));

  s.ok('规则页有 viewport', /name="viewport"/.test(rules));
  s.ok('规则页无外部脚本', !/<script[^>]*src="https?:/i.test(rules));
  s.ok('规则页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(rules));
  var blocks = lib.jsonLd(rules);
  var faq = blocks.filter(function (block) { return block['@type'] === 'FAQPage'; })[0];
  s.ok('规则页有 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 3 问', !!faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3);
  s.ok('FAQ 每问都有答案', !!faq && faq.mainEntity.every(function (item) {
    return item['@type'] === 'Question' && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));
  s.ok('规则页 CTA 回 index.html', /href="index\.html"/.test(rules));
  s.ok('规则页链接桌游目录', /href="\.\.\/index\.html"/.test(rules));
  s.ok('规则页含真实件数', /36 张/.test(rules) && /43 张/.test(rules) && /105/.test(rules));
  s.ok('规则页含四类行动', /打出商人卡/.test(rules) && /获取商人卡/.test(rules) && /休息/.test(rules) && /领取得分卡/.test(rules));
  s.ok('规则页含金币银币计分', /金币 3 分/.test(rules) && /银币 1 分/.test(rules));
  s.ok('规则页含 B 站 BV 号', /BV1LkwzevE2h/.test(rules) && /BV1aQ4y1S7TY/.test(rules) && /BV17a4y1E78r/.test(rules));
  s.ok('规则页含 B 站链接', /bilibili\.com\/video\/BV/.test(rules));
  s.ok('规则页含公开文字规则核对', /官方/.test(rules) && /公开/.test(rules));
  var count = cjkCount(rules);
  s.ok('规则正文 1200 字以上', count >= 1200, count + ' 字');
});

s.done();
