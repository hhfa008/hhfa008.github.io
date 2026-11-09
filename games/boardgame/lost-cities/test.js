'use strict';

/*
 * Lost Cities（失落之城）引擎测试。直接 require 同源 engine.js。
 * 运行：node games/boardgame/lost-cities/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('lost-cities');
var E = require('./engine.js');

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

s.group('初始状态', function () {
  var st = E.createGame({ seed: 42 });
  s.eq('5 种颜色', E.COLORS.length, 5);
  s.eq('牌堆剩余 44 张', st.deck.length, 44);
  s.eq('双方各 8 张手牌', [st.players[0].hand.length, st.players[1].hand.length], [8, 8]);
  s.eq('你方 5 条空探险列', st.players[0].exp.length, 5);
  s.ok('默认人类先手', st.turn === 0);
  s.ok('同 seed 发牌相同', JSON.stringify(st.players[0].hand) === JSON.stringify(E.createGame({ seed: 42 }).players[0].hand));
  s.ok('不同 seed 发牌不同', JSON.stringify(st.players[0].hand) !== JSON.stringify(E.createGame({ seed: 43 }).players[0].hand));
});

s.group('出牌与赌注规则', function () {
  var st = E.createGame({ seed: 7 });
  var p = st.players[0];
  var yellow = E.COLORS.indexOf('yellow');
  p.exp[yellow] = { color: 'yellow', wagers: 0, nums: [] };
  var low = { c: 'yellow', k: 'n', v: 4 };
  var high = { c: 'yellow', k: 'n', v: 9 };
  var wager = { c: 'yellow', k: 'w', v: 0 };
  s.ok('空列可放赌注', E.canPlayCard(p.exp[yellow], wager));
  s.ok('空列可放任意数字', E.canPlayCard(p.exp[yellow], high));
  p.exp[yellow] = { color: 'yellow', wagers: 0, nums: [6] };
  s.ok('数字必须递增', E.canPlayCard(p.exp[yellow], high));
  s.ok('小于末牌不能出', !E.canPlayCard(p.exp[yellow], low));
  s.ok('有数字后不能加赌注', !E.canPlayCard(p.exp[yellow], wager));
  var moved = E.applyMove(st, E.legalMoves(st)[0]);
  s.ok('合法动作产生新对象', moved !== st);
  s.eq('原 state 手牌未被修改', st.players[0].hand.length, 8);
});

s.group('非法动作被拒绝', function () {
  var st = E.createGame({ seed: 9 });
  var threw = 0;
  try { E.applyMove(st, { type: 'play', handIndex: 99 }); } catch (e) { threw++; }
  try { E.applyMove(st, { type: 'hack', handIndex: 0 }); } catch (e) { threw++; }
  try { E.applyMove(st, null); } catch (e) { threw++; }
  s.eq('三类非法动作均抛错', threw, 3);
  s.eq('结束后 legalMoves 为空', E.legalMoves({ over: true }).length, 0);
});

s.group('探险计分', function () {
  s.eq('空列 0 分', E.expeditionScore({ wagers: 0, nums: [] }), 0);
  s.eq('只有一个赌注扣 20', E.expeditionScore({ wagers: 1, nums: [] }), -20);
  s.eq('两个赌注空列扣 40', E.expeditionScore({ wagers: 2, nums: [] }), -40);
  s.eq('5 和 10 无赌注得 15', E.expeditionScore({ wagers: 0, nums: [5, 10] }), 15);
  s.eq('5 和 10 一赌注 = (15+20)×2 = 70', E.expeditionScore({ wagers: 1, nums: [5, 10] }), 70);
  s.eq('5 和 10 两赌注 = (15+40)×3 = 165', E.expeditionScore({ wagers: 2, nums: [5, 10] }), 165);
  var st = E.createGame({ seed: 11 });
  st.players[0].exp[0] = { color: 'yellow', wagers: 0, nums: [2, 3] };
  st.players[1].exp[0] = { color: 'yellow', wagers: 1, nums: [] };
  s.eq('score 汇总双方', E.score(st), { human: 5, ai: -20 });
  s.eq('winner 判人类胜', E.winner(st), 'human');
});

s.group('AI 合法性', function () {
  var st = E.createGame({ seed: 21 });
  var ok = true;
  for (var i = 0; i < 24 && !st.over; i++) {
    var m = E.aiMove(st);
    var legal = E.legalMoves(st).some(function (x) {
      return x.type === m.type && x.handIndex === m.handIndex;
    });
    if (!legal) ok = false;
    st = E.applyMove(st, m);
  }
  s.ok('AI 连续 24 手全部合法', ok);
  s.ok('AI 回合后状态仍可序列化', !!JSON.stringify(st));
});

s.group('30 局自对弈', function () {
  var errors = 0, incomplete = 0, maxMoves = 0, round = 0, badScores = 0;
  var start = Date.now();
  for (var g = 0; g < 30; g++) {
    var st = E.createGame({ seed: 1000 + g, humanFirst: g % 2 === 0 });
    var steps = 0;
    try {
      while (!st.over && steps < 400) {
        var moves = E.legalMoves(st);
        if (!moves.length) break;
        var pick = moves[Math.floor(rng(g * 100 + steps)() * moves.length)];
        st = E.applyMove(st, { type: pick.type, handIndex: pick.handIndex });
        steps++;
      }
      round += st.moves;
      maxMoves = Math.max(maxMoves, steps);
      if (!st.over) incomplete++;
      var sc = E.score(st);
      if (!isFinite(sc.human) || !isFinite(sc.ai)) badScores++;
    } catch (e) { errors++; }
  }
  s.eq('30 局无误', errors, 0);
  s.eq('30 局全部自然结束', incomplete, 0);
  s.eq('分数均为有限数', badScores, 0);
  s.ok('单局回合数有上限', maxMoves < 400, String(maxMoves));
  s.ok('30 局在 10 秒内跑完', Date.now() - start < 10000, (Date.now() - start) + 'ms');
  s.ok('每局平均回合接近满局', round / 30 > 40, String(round / 30));
});

s.group('页面与规则', function () {
  var dir = __dirname;
  var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(dir, 'rules.html'), 'utf8');
  s.ok('页面引用同源 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch/XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(html));
  s.ok('页面有 390px 媒体查询', /@media\s*\(max-width:\s*(390|430)px\)/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('页面含 44px 触控', /min-height\s*:\s*44px|min-width\s*:\s*44px/.test(html));
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
  s.eq('FAQ 至少 4 问', questions >= 4, true);
});

s.done();
