'use strict';

/* Ticket to Ride 简化版引擎测试。直接 require 同源 engine.js。 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('ticket-to-ride');
var E = require('./engine.js');

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function handTotal(p) {
  var n = p.wilds;
  E.COLORS.forEach(function (c) { n += p.hand[c]; });
  return n;
}
function hasMove(st, type) {
  return E.legalMoves(st).some(function (m) { return m.type === type; });
}

s.group('地图与初始状态', function () {
  s.eq('12 座城市', E.CITIES.length, 12);
  s.eq('21 条路线', E.ROUTES.length, 21);
  s.eq('8 种车厢卡颜色', E.COLORS.length, 8);
  s.eq('12 张目的地任务', E.TICKETS.length, 12);
  var ids = E.ROUTES.map(function (r) { return r.id; });
  s.eq('路线 id 唯一', new Set(ids).size, E.ROUTES.length);
  s.ok('所有路线长度 1–6', E.ROUTES.every(function (r) { return r.length >= 1 && r.length <= 6; }));
  var st = E.createGame({ seed: 5 });
  s.eq('明牌区 5 张', st.market.length, 5);
  s.eq('双方各 4 张手牌', [handTotal(st.players[0]), handTotal(st.players[1])], [4, 4]);
  s.eq('双方各 3 张任务', [st.players[0].tickets.length, st.players[1].tickets.length], [3, 3]);
  s.eq('初始 45 节车厢', [st.players[0].trains, st.players[1].trains], [45, 45]);
  s.ok('人类默认先手', st.turn === 0);
  s.ok('同 seed 手牌一致',
    JSON.stringify(E.createGame({ seed: 9 }).players[0]) === JSON.stringify(E.createGame({ seed: 9 }).players[0]));
});

s.group('抽牌与回合', function () {
  var st = E.createGame({ seed: 12 });
  var before = handTotal(st.players[0]);
  st = E.applyMove(st, { type: 'drawCard', source: 'deck' });
  s.ok('第一次抽牌后仍轮到自己', st.turn === 0);
  s.eq('抽牌计数 1', st.drawsLeft, 1);
  st = E.applyMove(st, { type: 'drawCard', source: 'deck' });
  s.ok('第二次抽牌后换手', st.turn === 1);
  s.eq('手牌增加 2 张', handTotal(st.players[0]), before + 2);
  s.eq('抽牌计数归零', st.drawsLeft, 0);
  var st2 = E.createGame({ seed: 13 });
  var color = st2.market[0];
  var handBefore = st2.players[0].hand[color] + (color === 'wild' ? st2.players[0].wilds : 0);
  st2 = E.applyMove(st2, { type: 'drawCard', source: 'market', marketIndex: 0 });
  s.eq('明牌区保持 5 张', st2.market.length, 5);
  var handAfter = color === 'wild' ? st2.players[0].wilds : st2.players[0].hand[color];
  s.eq('拿走一张对应颜色', handAfter, handBefore + 1);
  s.ok('不能连续抽三张', !hasMove(st2, 'drawCard') || st2.drawsLeft <= 2);
});

s.group('占路与支付', function () {
  var st = E.createGame({ seed: 20 });
  st.players[0].hand.white = 4;
  var route = E.routeById(15);
  var pay = E.paymentFor(st.players[0], route);
  s.eq('白色 4 段路线支付 4 白', [pay.color, pay.colored, pay.wilds], ['white', 4, 0]);
  st = E.applyMove(st, { type: 'claimRoute', routeId: 15 });
  s.eq('路线归属玩家 0', st.routes[15], 0);
  s.eq('车厢减少 4 节', st.players[0].trains, 41);
  s.eq('路线得分 7', E.score(st).humanDetail.routePts, 7);
  var threw = 0;
  try { E.applyMove(E.createGame({ seed: 21 }), { type: 'claimRoute', routeId: 15 }); } catch (e) { threw++; }
  s.eq('没有卡不能占路', threw, 1);
  var st2 = E.createGame({ seed: 22 });
  st2.players[0].hand.red = 1;
  st2.players[0].wilds = 1;
  var pay2 = E.paymentFor(st2.players[0], E.routeById(7));
  s.eq('万能机车补 1 张红卡', [pay2.color, pay2.colored, pay2.wilds], ['red', 1, 1]);
  s.ok('灰色路线可选任意颜色', E.paymentFor({ hand: { red: 3, blue: 0, green: 0, yellow: 0, black: 0, white: 0, orange: 0, pink: 0 }, wilds: 0 }, E.routeById(5)).color === 'red');
});

s.group('任务牌与结算', function () {
  var st = E.createGame({ seed: 30 });
  st = E.applyMove(st, { type: 'drawTickets' });
  s.eq('进入任务选择阶段', st.phase, 'ticketSelect');
  s.eq('待选任务 3 张', st.pendingTickets.length, 3);
  var keep = E.legalMoves(st).filter(function (m) { return m.keep.length === 1; })[0];
  st = E.applyMove(st, keep);
  s.eq('保留后任务 +1', st.players[0].tickets.length, 4);
  s.ok('任务阶段结束并换手', st.turn === 1 && st.phase === 'main');
  var s2 = E.createGame({ seed: 31 });
  var t9 = E.TICKETS.findIndex(function (t) { return t.a === 3 && t.b === 11; });
  s2.players[0].tickets = [t9];
  s2.routes[3] = 0; s2.routes[4] = 0; s2.routes[5] = 0;
  s.ok('未连通任务不算完成', !E.connected(s2, 0, 3, 11));
  s.eq('未完成任务扣分', E.score(s2).humanDetail.ticketPts, -9);
  s2.routes[6] = 0; s2.routes[13] = 0;
  s.ok('连通后可判定完成', E.connected(s2, 0, 3, 11));
  s.eq('完成任务加分', E.score(s2).humanDetail.ticketPts, 9);
  s.eq('最长路线按边数', E.longestPath(s2, 0) >= 5, true);
});

s.group('AI 合法性', function () {
  var st = E.createGame({ seed: 40 });
  var ok = true;
  for (var i = 0; i < 30 && !st.over; i++) {
    var m = E.aiMove(st);
    try { st = E.applyMove(st, m); } catch (e) { ok = false; break; }
  }
  s.ok('AI 连续 30 个动作合法', ok);
  s.ok('AI 局面可序列化', !!JSON.stringify(st));
});

s.group('30 局自对弈', function () {
  var errors = 0, incomplete = 0, bad = 0, maxMoves = 0;
  var start = Date.now();
  for (var g = 0; g < 30; g++) {
    var st = E.createGame({ seed: 2000 + g, humanFirst: g % 2 === 0 });
    var r = rng(g * 131 + 7);
    var steps = 0;
    try {
      while (!st.over && steps < 800) {
        var moves = E.legalMoves(st);
        if (!moves.length) break;
        var m = pick(r, moves);
        if (m.type === 'keepTickets') {
          var max = st.pendingTickets.length;
          var keep = [];
          for (var k = 0; k < max; k++) if (r() < 0.6) keep.push(k);
          if (!keep.length) keep = [0];
          m = { type: 'keepTickets', keep: keep };
        }
        st = E.applyMove(st, m);
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
  s.ok('单局动作数有上限', maxMoves < 800, String(maxMoves));
  s.ok('30 局在 10 秒内跑完', Date.now() - start < 10000, (Date.now() - start) + 'ms');
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
