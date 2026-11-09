'use strict';

/* Dominion 简化版引擎测试。直接 require 同源 engine.js。 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('dominion');
var E = require('./engine.js');

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function allCards(p) { return p.deck.concat(p.hand, p.discard, p.playArea); }
function countOf(p, id) { return allCards(p).filter(function (x) { return x === id; }).length; }
function setup(seed) { return E.createGame({ seed: seed }); }

s.group('卡牌数据与初始状态', function () {
  s.eq('11 种卡牌', E.CARDS.length, 11);
  s.eq('行动牌 5 种', E.CARDS.filter(function (c) { return c.type === 'action'; }).length, 5);
  s.eq('胜利牌 3 种', E.CARDS.filter(function (c) { return c.type === 'victory'; }).length, 3);
  s.ok('行省 6 分 / 8 费', E.CARD_BY_ID.province.vp === 6 && E.CARD_BY_ID.province.cost === 8);
  var st = setup(1);
  s.eq('起始牌库 10 张', st.players[0].deck.length + st.players[0].hand.length, 10);
  s.eq('起始手牌 5 张', st.players[0].hand.length, 5);
  s.eq('7 铜 3 庄园', [countOf(st.players[0], 'copper'), countOf(st.players[0], 'estate')], [7, 3]);
  s.eq('行省供应 12', st.supply.province, 12);
  s.ok('人类先手', st.turn === 0);
  s.ok('同 seed 完全一致',
    JSON.stringify(setup(3).players[0]) === JSON.stringify(setup(3).players[0]));
});

s.group('财宝与购买', function () {
  var st = setup(2);
  var coppers = st.players[0].hand.filter(function (x) { return x === 'copper'; }).length;
  st = E.applyMove(st, { type: 'endPhase' });
  s.eq('行动阶段结束进入购买', st.phase, 'buy');
  s.eq('财宝自动产生金币', st.coins, coppers);
  s.eq('财宝进入出牌区', st.players[0].playArea.length, coppers);
  var st2 = setup(4);
  st2.phase = 'buy'; st2.coins = 8; st2.buys = 1;
  st2 = E.applyMove(st2, { type: 'buy', cardId: 'province' });
  s.eq('行省供应减 1', st2.supply.province, 11);
  s.eq('行省进入弃牌堆', st2.players[0].discard.filter(function (x) { return x === 'province'; }).length, 1);
  s.eq('金币扣光', st2.coins, 0);
  s.eq('购买次数用完', st2.buys, 0);
  var threw = 0;
  try { E.applyMove(setup(5), { type: 'buy', cardId: 'province' }); } catch (e) { threw++; }
  s.eq('非法阶段购买被拒绝', threw, 1);
  var st3 = setup(6);
  st3.phase = 'buy'; st3.coins = 0;
  s.ok('0 金币不能买行省', !E.legalMoves(st3).some(function (m) { return m.cardId === 'province'; }));
  s.eq('铜币 0 费始终可买', E.legalMoves(st3).some(function (m) { return m.cardId === 'copper'; }), true);
});

s.group('行动牌效果', function () {
  var st = setup(7);
  st.players[0].hand = ['smithy', 'copper', 'copper', 'copper', 'copper'];
  st.players[0].deck = ['copper', 'copper', 'copper', 'copper', 'copper'];
  st = E.applyMove(st, { type: 'playAction', cardId: 'smithy' });
  s.eq('铁匠抽 3 张后手牌 7 张', st.players[0].hand.length, 7);
  s.eq('铁匠进入出牌区', st.players[0].playArea[0], 'smithy');
  s.eq('行动次数扣减', st.actions, 0);

  var st2 = setup(8);
  st2.players[0].hand = ['village', 'copper'];
  st2.players[0].deck = ['copper', 'copper'];
  st2 = E.applyMove(st2, { type: 'playAction', cardId: 'village' });
  s.eq('村庄净 +2 行动', st2.actions, 2);
  s.eq('村庄抽 1 张', st2.players[0].hand.length, 2);

  var st3 = setup(9);
  st3.players[0].hand = ['militia', 'copper'];
  st3.players[1].hand = ['copper', 'copper', 'copper', 'copper', 'copper'];
  st3 = E.applyMove(st3, { type: 'playAction', cardId: 'militia' });
  s.eq('民兵令对手弃到 3 张', st3.players[1].hand.length, 3);
  s.eq('民兵给 2 金币', st3.coins, 2);
  s.eq('对手弃牌堆 +2', st3.players[1].discard.length, 2);

  var st4 = setup(10);
  st4.players[0].hand = ['workshop', 'copper'];
  var silverBefore = st4.supply.silver;
  st4 = E.applyMove(st4, { type: 'playAction', cardId: 'workshop' });
  s.eq('工坊获得银币', st4.players[0].discard[0], 'silver');
  s.eq('银币供应减少', st4.supply.silver, silverBefore - 1);

  var st5 = setup(11);
  st5.players[0].hand = ['market', 'copper'];
  st5.players[0].deck = ['copper', 'copper'];
  st5 = E.applyMove(st5, { type: 'playAction', cardId: 'market' });
  s.eq('市场 +1 行动 +1 购买 +1 金币', [st5.actions, st5.buys, st5.coins], [1, 2, 1]);
});

s.group('回合清理与结束条件', function () {
  var st = setup(12);
  st.phase = 'buy';
  st.players[0].hand = ['copper'];
  st.players[0].playArea = ['silver'];
  st.players[0].deck = ['copper', 'copper', 'copper', 'copper', 'copper', 'copper'];
  st = E.applyMove(st, { type: 'endPhase' });
  s.eq('清理后抽 5 张', st.players[0].hand.length, 5);
  s.ok('换到对手回合', st.turn === 1);
  s.eq('行动/购买/金币重置', [st.actions, st.buys, st.coins], [1, 1, 0]);
  var st2 = setup(13);
  st2.phase = 'buy'; st2.supply.province = 0;
  st2 = E.applyMove(st2, { type: 'endPhase' });
  s.ok('行省堆空立即结束', st2.over);
  var st3 = setup(14);
  st3.phase = 'buy'; st3.supply.village = 0; st3.supply.smithy = 0; st3.supply.market = 0;
  st3 = E.applyMove(st3, { type: 'endPhase' });
  s.ok('三个牌堆空也会结束', st3.over);
  var threw = 0;
  try { E.applyMove(st3, { type: 'endPhase' }); } catch (e) { threw++; }
  s.eq('结束后拒绝动作', threw, 1);
});

s.group('终局计分', function () {
  var st = setup(15);
  st.players[0].deck = ['province', 'duchy'];
  st.players[0].hand = ['estate', 'copper'];
  st.players[0].discard = ['province'];
  st.players[0].playArea = [];
  st.players[1].deck = ['estate', 'estate'];
  st.players[1].hand = ['copper'];
  st.players[1].discard = ['duchy'];
  st.players[1].playArea = [];
  s.eq('双方牌库分', E.score(st), { human: 6 + 3 + 2 + 6, ai: 2 + 2 + 3 });
  s.eq('高分者获胜', E.winner(st), 'human');
  s.ok('结束后无合法动作', E.legalMoves({ over: true }).length === 0);
});

s.group('AI 合法性', function () {
  var st = setup(16);
  var ok = true;
  for (var i = 0; i < 50 && !st.over; i++) {
    try { st = E.applyMove(st, E.aiMove(st)); } catch (e) { ok = false; break; }
  }
  s.ok('AI 连续 50 个动作合法', ok);
  s.ok('AI 能推进游戏', st.moves >= 50 || st.over);
});

s.group('30 局自对弈', function () {
  var errors = 0, incomplete = 0, maxMoves = 0, bad = 0;
  var started = Date.now();
  for (var g = 0; g < 30; g++) {
    var st = setup(4000 + g);
    if (g % 2) st.turn = 1;
    var r = rng(g * 613 + 11);
    var steps = 0;
    try {
      while (!st.over && steps < 3000) {
        var moves = E.legalMoves(st);
        if (!moves.length) break;
        st = E.applyMove(st, pick(r, moves));
        steps++;
      }
      if (!st.over) incomplete++;
      maxMoves = Math.max(maxMoves, steps);
      var sc = E.score(st);
      if (!isFinite(sc.human) || !isFinite(sc.ai)) bad++;
    } catch (e) { errors++; }
  }
  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部结束', incomplete, 0);
  s.eq('分数有限', bad, 0);
  s.ok('动作数有上限', maxMoves < 3000, String(maxMoves));
  s.ok('30 局在 15 秒内跑完', Date.now() - started < 15000, (Date.now() - started) + 'ms');
});

s.group('页面与规则', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('页面引用同源 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch/XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(html));
  s.ok('页面有 390px 媒体查询', /@media\s*\(max-width:\s*(390|430)px\)/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('页面有 44px 触控', /min-height\s*:\s*44px|min-width\s*:\s*44px/.test(html));
  var text = rules.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  var cjk = (text.match(/[一-鿿]/g) || []).length;
  s.ok('规则正文 400–800 字', cjk >= 400 && cjk <= 800, String(cjk));
  s.ok('规则含 FAQ JSON-LD', /"@type"\s*:\s*"FAQPage"/.test(rules));
  s.ok('规则 CTA 回游戏页', /href="index\.html"/.test(rules));
  var blocks = rules.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
  var valid = blocks.length > 0, questions = 0;
  blocks.forEach(function (b) {
    try {
      var data = JSON.parse(b.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, ''));
      if (data['@type'] === 'FAQPage') questions = (data.mainEntity || []).length;
    } catch (e) { valid = false; }
  });
  s.ok('JSON-LD 可解析', valid);
  s.ok('FAQ 至少 4 问', questions >= 4, String(questions));
});

s.done();
