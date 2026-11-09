'use strict';

/*
 * Century: Spice Road（香料之路）引擎测试。
 * 页面与测试共用同一份 engine.js；这里直接 require，不复制规则。
 * 运行：node games/boardgame/century-spice-road/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('century-spice-road');
var E = require('./engine.js');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function cardLike(key) {
  var t = null;
  E.ACTION_TEMPLATES.forEach(function (x) { if (x.key === key) t = x; });
  if (!t) throw new Error('unknown template ' + key);
  return { id: 'test-' + key, key: key, name: t.name, text: t.text, effect: JSON.parse(JSON.stringify(t.effect)), points: 0 };
}

function findCardIndex(player, key) {
  for (var i = 0; i < player.hand.length; i++) if (player.hand[i].key === key) return i;
  return -1;
}

function fresh(seed) {
  var g = E.createGame(seed == null ? 7 : seed);
  g.current = 0;
  return g;
}

/* ------------------------------------------------------------------ */
/* 1. 数据完整性                                                       */
/* ------------------------------------------------------------------ */

s.group('香料与卡表', function () {
  s.eq('4 种香料', E.SPICES.length, 4);
  s.eq('香料价值 1..4', E.SPICES.map(function (x) { return x.value; }), [1, 2, 3, 4]);
  s.eq('香料都有中文名与颜色', E.SPICES.every(function (x) { return x.name && /^#/.test(x.color); }), true);
  s.ok('行动卡模板至少 12 种', E.ACTION_TEMPLATES.length >= 12, String(E.ACTION_TEMPLATES.length));
  s.ok('行动卡模板字段齐全', E.ACTION_TEMPLATES.every(function (t) {
    return t.key && t.name && t.text && t.copies > 0 && t.effect && ['harvest', 'convert', 'upgrade'].indexOf(t.effect.type) >= 0;
  }));
  s.ok('得分卡模板至少 10 种', E.SCORE_TEMPLATES.length >= 10, String(E.SCORE_TEMPLATES.length));
  s.ok('得分卡分值 3..15 且成本合法', E.SCORE_TEMPLATES.every(function (t) {
    return t.points >= 3 && t.points <= 15 && Array.isArray(t.cost) && t.cost.length === 4 &&
      t.cost.every(function (n) { return Number.isInteger(n) && n >= 0; });
  }));
  s.eq('起始手牌 5 张', E.STARTING_HAND.length, 5);
  s.eq('商队上限 10', E.CARAVAN_LIMIT, 10);
  s.eq('触发终局 5 张得分卡', E.SCORE_CARDS_TO_END, 5);
});

/* ------------------------------------------------------------------ */
/* 2. 初始局面与确定性                                                 */
/* ------------------------------------------------------------------ */

s.group('开局与确定性', function () {
  var g = fresh(11);
  s.eq('双人局', g.players.length, 2);
  s.eq('双方各 5 张起始手牌', g.players.map(function (p) { return p.hand.length; }), [5, 5]);
  s.eq('双方初始香料为 0', g.players.map(function (p) { return p.spices; }), [[0, 0, 0, 0], [0, 0, 0, 0]]);
  s.eq('初始分数 0', g.players.map(function (p) { return p.score; }), [0, 0]);
  s.eq('市场各 6 张', [g.actionMarket.length, g.scoreMarket.length], [6, 6]);
  s.eq('先手与回合', [g.current, g.turn, g.over], [0, 1, false]);
  var g2 = E.createGame(11);
  s.eq('同 seed 局面完全一致', JSON.stringify(g), JSON.stringify(g2));
  var g3 = E.createGame(12);
  s.ok('不同 seed 市场顺序不同', JSON.stringify(g.actionMarket) !== JSON.stringify(g3.actionMarket));
  s.ok('每条日志为字符串', g.log.every(function (line) { return typeof line === 'string'; }));
});

/* ------------------------------------------------------------------ */
/* 3. 合法动作与结算                                                   */
/* ------------------------------------------------------------------ */

s.group('采集 / 转换 / 升级', function () {
  var g = fresh(3);
  var before = JSON.stringify(g);
  var hi = findCardIndex(g.players[0], 'h2y');
  s.ok('起始手牌含采集卡', hi >= 0);
  var next = E.applyMove(g, { type: 'play', cardIndex: hi, upgrades: [] });
  s.eq('采集 2 姜黄', next.players[0].spices, [2, 0, 0, 0]);
  s.eq('手牌减少 1', next.players[0].hand.length, 4);
  s.eq('打出卡进入弃牌区', next.players[0].played.length, 1);
  s.eq('回合交给对手', next.current, 1);
  s.eq('applyMove 不修改入参', JSON.stringify(g), before);

  var g2 = fresh(3);
  g2.players[0].spices = [9, 0, 0, 0];
  var hi2 = findCardIndex(g2.players[0], 'h2y');
  var playMove = { type: 'play', cardIndex: hi2, upgrades: [] };
  s.eq('商队将超上限时不是合法动作', E.isLegalMove(g2, playMove), false);
  expectThrow('超上限采集被拒绝', function () { E.applyMove(g2, playMove); }, /非法动作/);

  var g3 = fresh(3);
  g3.players[0].spices = [3, 0, 0, 0];
  g3.players[0].hand.push(cardLike('c3y1r'));
  var ci = g3.players[0].hand.length - 1;
  var cnext = E.applyMove(g3, { type: 'play', cardIndex: ci, upgrades: [] });
  s.eq('3 姜黄换 1 藏红花', cnext.players[0].spices, [0, 1, 0, 0]);

  var g4 = fresh(3);
  g4.players[0].spices = [2, 0, 0, 0];
  g4.players[0].hand.push(cardLike('c3y1r'));
  expectThrow('香料不足的转换被拒绝', function () {
    E.applyMove(g4, { type: 'play', cardIndex: g4.players[0].hand.length - 1, upgrades: [] });
  }, /非法动作/);

  var g5 = fresh(3);
  g5.players[0].spices = [1, 0, 0, 0];
  var ui = findCardIndex(g5.players[0], 'u1');
  var unext = E.applyMove(g5, { type: 'play', cardIndex: ui, upgrades: [0] });
  s.eq('升级 1 个姜黄', unext.players[0].spices, [0, 1, 0, 0]);

  var g6 = fresh(3);
  g6.players[0].spices = [1, 0, 0, 0];
  var ui6 = findCardIndex(g6.players[0], 'u1');
  expectThrow('升级到 4 级以上被拒绝', function () {
    E.applyMove(g6, { type: 'play', cardIndex: ui6, upgrades: [3] });
  }, /非法动作/);
  expectThrow('没有香料时升级被拒绝', function () {
    var g7 = fresh(3);
    E.applyMove(g7, { type: 'play', cardIndex: findCardIndex(g7.players[0], 'u1'), upgrades: [0] });
  }, /非法动作/);

  var g8 = fresh(3);
  g8.players[0].spices = [2, 0, 0, 0];
  g8.players[0].hand.push(cardLike('u2'));
  expectThrow('升级数量不匹配被拒绝', function () {
    E.applyMove(g8, { type: 'play', cardIndex: g8.players[0].hand.length - 1, upgrades: [0] });
  }, /非法动作/);
  var u2next = E.applyMove(g8, { type: 'play', cardIndex: g8.players[0].hand.length - 1, upgrades: [0, 0] });
  s.eq('双重升级两个姜黄', u2next.players[0].spices, [0, 2, 0, 0]);
});

s.group('拿牌 / 休息 / 买分', function () {
  var g = fresh(5);
  var deckBefore = g.actionDeck.length;
  var taken = E.applyMove(g, { type: 'takeCard', marketIndex: 0 });
  s.eq('拿牌后手牌 +1', taken.players[0].hand.length, 6);
  s.eq('市场仍是 6 张', taken.actionMarket.length, 6);
  s.eq('行动牌库减少 1', taken.actionDeck.length, deckBefore - 1);
  expectThrow('非法市场索引被拒绝', function () { E.applyMove(g, { type: 'takeCard', marketIndex: 9 }); }, /非法动作/);

  var r = fresh(5);
  r.players[0].hand = [];
  r.players[0].played = [cardLike('h2y')];
  var rnext = E.applyMove(r, { type: 'rest' });
  s.eq('休息取回全部行动卡', [rnext.players[0].hand.length, rnext.players[0].played.length], [1, 0]);
  var r2 = fresh(5);
  r2.players[0].played = [];
  expectThrow('无弃牌时不能休息', function () { E.applyMove(r2, { type: 'rest' }); }, /非法动作/);

  var b = fresh(5);
  b.players[0].spices = [3, 0, 0, 0];
  b.scoreMarket.push({ id: 'test-p3', key: 'p3', name: '3 分香料卡', text: '', points: 3, cost: [3, 0, 0, 0], effect: null });
  var bnext = E.applyMove(b, { type: 'buy', cardId: 'test-p3' });
  s.eq('买分卡扣香料', bnext.players[0].spices, [0, 0, 0, 0]);
  s.eq('买分卡加分', bnext.players[0].score, 3);
  s.eq('得分卡入账', bnext.players[0].scoreCards.length, 1);
  s.eq('得分市场补位', bnext.scoreMarket.length, 6);

  var b2 = fresh(5);
  b2.players[0].spices = [2, 0, 0, 0];
  b2.scoreMarket.push({ id: 'test-p3b', key: 'p3', name: '3 分香料卡', text: '', points: 3, cost: [3, 0, 0, 0], effect: null });
  expectThrow('香料不足不能买卡', function () { E.applyMove(b2, { type: 'buy', cardId: 'test-p3b' }); }, /非法动作/);
});

/* ------------------------------------------------------------------ */
/* 4. 终局与结算                                                       */
/* ------------------------------------------------------------------ */

s.group('终局触发与结算', function () {
  var g = fresh(9);
  g.players[0].spices = [3, 0, 0, 0];
  for (var i = 0; i < 4; i++) g.players[0].scoreCards.push({ id: 'dummy' + i, points: 1 });
  g.scoreMarket.push({ id: 'test-p3c', key: 'p3', name: '3 分香料卡', text: '', points: 3, cost: [3, 0, 0, 0], effect: null });
  var afterBuy = E.applyMove(g, { type: 'buy', cardId: 'test-p3c' });
  s.eq('第 5 张得分卡触发最后一轮', [afterBuy.finalRound, afterBuy.finalRoundStart], [true, 0]);
  s.eq('触发后尚未立刻结束', afterBuy.over, false);
  s.eq('对手获得最后回合', afterBuy.current, 1);
  var lastMove = E.getLegalMoves(afterBuy)[0];
  s.ok('最后回合存在合法动作', !!lastMove);
  var ended = E.applyMove(afterBuy, lastMove);
  s.eq('回合回到触发者后结束', ended.over, true);

  var fake = fresh(9);
  fake.players[0].score = 20; fake.players[1].score = 20;
  fake.players[0].scoreCards = [1, 2, 3]; fake.players[1].scoreCards = [1, 2];
  fake.players[0].spices = [0, 0, 0, 0]; fake.players[1].spices = [1, 0, 0, 0];
  s.eq('同分先比得分卡数量', E.getResults(fake).winner, 0);
  fake.players[1].spices = [0, 0, 0, 0];
  fake.players[1].scoreCards = [1, 2, 3];
  s.eq('仍同分则平局', E.getResults(fake).winner, null);
  s.eq('结果包含双方分数', E.getResults(fake).scores, [20, 20]);
});

/* ------------------------------------------------------------------ */
/* 5. AI 合法性 / 30 局自对弈                                           */
/* ------------------------------------------------------------------ */

s.group('AI 与自对弈', function () {
  var g = fresh(21);
  var ai = E.chooseAIMove(g);
  s.ok('AI 返回动作', !!ai);
  s.ok('AI 动作为合法动作', E.isLegalMove(g, ai));

  var errors = 0, incomplete = 0, illegal = 0, overBound = 0, badScore = 0;
  var totalTurns = 0, maxTurns = 0;
  for (var game = 0; game < 30; game++) {
    var state = E.createGame(1000 + game);
    var steps = 0;
    try {
      while (!state.over && steps < 400) {
        var move = E.chooseAIMove(state);
        if (!move) { incomplete++; break; }
        if (!E.isLegalMove(state, move)) { illegal++; break; }
        var beforeTurn = state.turn;
        state = E.applyMove(state, move);
        if (state.turn <= beforeTurn) { illegal++; break; }
        steps++;
      }
      if (!state.over) incomplete++;
      if (state.turn >= 400) overBound++;
      state.players.forEach(function (p) {
        var sum = p.scoreCards.reduce(function (a, c) { return a + (c.points || 0); }, 0);
        if (sum !== p.score) badScore++;
      });
      totalTurns += state.turn;
      if (state.turn > maxTurns) maxTurns = state.turn;
    } catch (error) {
      errors++;
    }
  }
  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部自然结束', incomplete, 0);
  s.eq('30 局无非法动作', illegal, 0);
  s.eq('30 局回合数在限制内', overBound, 0);
  s.eq('30 局分数与得分卡一致', badScore, 0);
  s.ok('30 局平均回合数合理', totalTurns / 30 < 200, String(Math.round(totalTurns / 30)));
  s.ok('最长对局未失控', maxTurns < 400, String(maxTurns));

  function playOut(seed) {
    var state = E.createGame(seed);
    var guard = 0;
    while (!state.over && guard < 400) {
      state = E.applyMove(state, E.chooseAIMove(state));
      guard++;
    }
    return state;
  }
  s.eq('同 seed 自对弈结果可复现', JSON.stringify(playOut(77)), JSON.stringify(playOut(77)));
});

/* ------------------------------------------------------------------ */
/* 6. 页面与规则页                                                     */
/* ------------------------------------------------------------------ */

s.group('页面同源与移动端', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('页面存在 viewport', /name="viewport"/.test(html));
  s.ok('页面引用同源 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(html));
  s.ok('页面有 390px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(html) || /@media\s*\(max-width:\s*390px\)/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('页面为中文', /lang="zh-CN"/.test(html));

  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var blocks = rules.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  var parsed = [], valid = true;
  blocks.forEach(function (block) {
    var body = block.replace(/^[\s\S]*?>/, '').replace(/<\/script>$/i, '');
    try { parsed.push(JSON.parse(body)); } catch (e) { valid = false; }
  });
  s.ok('规则页 JSON-LD 可解析', valid && parsed.length > 0);
  s.ok('规则页含 FAQPage', parsed.some(function (x) {
    return x && (x['@type'] === 'FAQPage' || (Array.isArray(x['@graph']) && x['@graph'].some(function (g) { return g['@type'] === 'FAQPage'; })));
  }));
  s.ok('规则页 CTA 回游戏页', /href="index\.html"/.test(rules));
  s.ok('规则页正文不少于 400 字', (rules.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')).length >= 400);
});

s.done();
