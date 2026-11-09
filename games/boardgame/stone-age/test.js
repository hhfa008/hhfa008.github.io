'use strict';

/* Stone Age（石器时代）简化版引擎测试。直接 require 同源 engine.js。 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('stone-age');
var E = require('./engine.js');

function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function place(st, spot) { return E.applyMove(st, { type: 'place', spot: spot }); }

s.group('工位与初始状态', function () {
  s.eq('6 个工位', E.SPOTS.length, 6);
  s.eq('8 种建筑', E.BUILDINGS.length, 8);
  s.eq('市场 4 座', E.createGame({ seed: 1 }).market.length, 4);
  var st = E.createGame({ seed: 1 });
  s.eq('双方各 5 名工人', st.workersLeft, [5, 5]);
  s.eq('第 1 回合', st.round, 1);
  s.eq('双方资源为 0', [st.players[0].resources.wood, st.players[1].resources.gold], [0, 0]);
  s.ok('容量数据合理', E.SPOTS.every(function (sp) { return sp.capacity >= 2 && sp.perWorker >= 1; }));
  s.ok('同 seed 建筑市场一致',
    JSON.stringify(E.createGame({ seed: 4 }).market) === JSON.stringify(E.createGame({ seed: 4 }).market));
});

s.group('放置合法性', function () {
  var st = E.createGame({ seed: 2 });
  s.eq('可放置动作数 = 6', E.legalMoves(st).filter(function (m) { return m.type === 'place'; }).length, 6);
  st = place(st, 'wood');
  s.ok('放置后换手', st.turn === 1);
  st = place(st, 'wood');
  st = place(st, 'wood');
  s.ok('森林容量 3 已满', E.legalMoves(st).every(function (m) { return m.spot !== 'wood'; }));
  var threw = 0;
  try { place(st, 'wood'); } catch (e) { threw++; }
  s.eq('满员工位拒绝放置', threw, 1);
  s.eq('工位占用计数跨玩家共享', st.placements[0].wood + st.placements[1].wood, 3);
});

s.group('结算采集与喂食', function () {
  var st = E.createGame({ seed: 3 });
  var seq = ['wood', 'wood', 'wood', 'brick', 'brick', 'brick', 'stone', 'stone', 'stone', 'gold'];
  seq.forEach(function (spot) { st = place(st, spot); });
  s.eq('10 名工人放完进入建造阶段', st.phase, 'build');
  s.eq('你方木材 4', st.players[0].resources.wood, 4);
  s.eq('你方砖 1', st.players[0].resources.brick, 1);
  s.eq('你方石 2', st.players[0].resources.stone, 2);
  s.eq('AI 木 2 砖 2 石 1 金 1', [st.players[1].resources.wood, st.players[1].resources.brick, st.players[1].resources.stone, st.players[1].resources.gold], [2, 2, 1, 1]);
  s.eq('双方缺食物各扣 10 分', [st.players[0].score, st.players[1].score], [-10, -10]);
  var st3 = E.createGame({ seed: 6 });
  st3.players[0].tools = 2;
  st3.players[1].tools = 2;
  st3.placements[0].wood = 1;
  st3.placements[1].wood = 1;
  st3.workersLeft = [1, 0];
  st3.phase = 'place'; st3.turn = 0;
  var st4 = E.applyMove(st3, { type: 'place', spot: 'brick' });
  s.ok('工具为每个有工人的工位加资源', st4.players[0].resources.wood >= 4 && st4.players[1].resources.wood >= 4);
  s.ok('采集后仍进入建造', st4.phase === 'build');
});

s.group('建造与工具升级', function () {
  var st = E.createGame({ seed: 8 });
  st.phase = 'build'; st.turn = 0; st.buildDone = [false, false];
  st.players[0].resources = { wood: 9, brick: 9, stone: 9, gold: 9, food: 0 };
  var b = st.market[0];
  var pts = b.points;
  st = E.applyMove(st, { type: 'build', buildingId: b.id });
  s.eq('建造得分', st.players[0].score, pts);
  s.eq('资源被扣除', st.players[0].resources.wood, 9 - (b.cost.wood || 0));
  s.eq('建筑入册', st.players[0].buildings.length, 1);
  s.ok('市场补满 4 座', st.market.length === 4);
  var st2 = E.createGame({ seed: 9 });
  st2.phase = 'build'; st2.turn = 0; st2.buildDone = [false, false];
  st2.players[0].resources.wood = 1; st2.players[0].resources.brick = 1;
  st2 = E.applyMove(st2, { type: 'upgradeTool' });
  s.eq('工具升到 1 级', st2.players[0].tools, 1);
  s.eq('升级消耗木砖', [st2.players[0].resources.wood, st2.players[0].resources.brick], [0, 0]);
  var st3 = E.createGame({ seed: 10 });
  st3.phase = 'build'; st3.turn = 0; st3.buildDone = [false, false];
  var threw = 0;
  try { E.applyMove(st3, { type: 'build', buildingId: 'cathedral' }); } catch (e) { threw++; }
  s.eq('资源不足不能建造', threw, 1);
});

s.group('回合推进与终局', function () {
  var st = E.createGame({ seed: 11 });
  st.phase = 'build'; st.turn = 0; st.buildDone = [false, false];
  st = E.applyMove(st, { type: 'passBuild' });
  s.eq('一人跳过仍等另一人', st.turn, 1);
  st = E.applyMove(st, { type: 'passBuild' });
  s.eq('双方完成后进入第 2 回合', st.round, 2);
  s.eq('工人重置为 5', st.workersLeft, [5, 5]);
  s.eq('回到放置阶段', st.phase, 'place');
  var st2 = E.createGame({ seed: 12 });
  st2.round = 8; st2.phase = 'build'; st2.turn = 0; st2.buildDone = [false, false];
  st2 = E.applyMove(st2, { type: 'passBuild' });
  st2 = E.applyMove(st2, { type: 'passBuild' });
  s.ok('第 8 回合后结束', st2.over);
  s.eq('结束后无合法动作', E.legalMoves(st2).length, 0);
  var threw = 0;
  try { E.applyMove(st2, { type: 'passBuild' }); } catch (e) { threw++; }
  s.eq('结束后动作被拒绝', threw, 1);
});

s.group('AI 合法性', function () {
  var st = E.createGame({ seed: 13 });
  var ok = true, ended = false;
  for (var i = 0; i < 40 && !st.over; i++) {
    try { st = E.applyMove(st, E.aiMove(st)); } catch (e) { ok = false; break; }
  }
  s.ok('AI 连续 40 个动作合法', ok);
  s.ok('AI 能推进回合', st.round >= 2 || st.over);
});

s.group('30 局自对弈', function () {
  var errors = 0, incomplete = 0, maxMoves = 0, badScore = 0;
  var started = Date.now();
  for (var g = 0; g < 30; g++) {
    var st = E.createGame({ seed: 3000 + g, humanFirst: g % 2 === 0 });
    var r = rng(g * 977 + 3);
    var steps = 0;
    try {
      while (!st.over && steps < 400) {
        var legal = E.legalMoves(st);
        if (!legal.length) break;
        st = E.applyMove(st, pick(r, legal));
        steps++;
      }
      if (!st.over) incomplete++;
      maxMoves = Math.max(maxMoves, steps);
      var sc = E.score(st);
      if (!isFinite(sc.human) || !isFinite(sc.ai)) badScore++;
    } catch (e) { errors++; }
  }
  s.eq('30 局无异常', errors, 0);
  s.eq('30 局全部结束', incomplete, 0);
  s.eq('分数有限', badScore, 0);
  s.ok('动作数有上限', maxMoves < 400, String(maxMoves));
  s.ok('30 局在 10 秒内跑完', Date.now() - started < 10000, (Date.now() - started) + 'ms');
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
