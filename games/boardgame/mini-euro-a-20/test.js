'use strict';

/*
 * 陶窑订单 引擎测试。
 * 页面与测试共用同一份 engine.js；这里直接 require，不复制规则。
 * 运行：node games/boardgame/mini-euro-a-20/test.js
 */

var E = require('./engine.js');
var CFG = E.config;
var passed = 0;
var failed = 0;

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log('PASS ' + name);
  } else {
    failed += 1;
    console.log('FAIL ' + name + (detail ? ' — ' + detail : ''));
  }
}
function safe(fn, fallback) {
  try { return fn(); } catch (e) { return fallback; }
}
function negative(state) {
  var bad = false;
  state.players.forEach(function (p) {
    if (p.coins < 0 || p.score < 0) bad = true;
    (p.res || []).forEach(function (v) { if (v < 0) bad = true; });
    (p.inv || []).forEach(function (v) { if (v < 0) bad = true; });
  });
  return bad;
}

/* 1. 配置与开局 */
ok('实验编号正确', CFG.slug === 'mini-euro-a-20', CFG.slug);
ok('标题与模式存在', !!CFG.title && CFG.mode === 'orders', CFG.mode);
var g = E.createGame(424242);
ok('双人开局且玩家先行', g.players.length === 2 && !g.over && g.turn === 0);
ok('开局日志非空', g.log.length > 0 && typeof g.log[0] === 'string');

/* 2. 确定性 */
ok('同种子局面完全一致', JSON.stringify(E.createGame(424242)) === JSON.stringify(g));
ok('不同种子产生不同局面', JSON.stringify(E.createGame(777)) !== JSON.stringify(g));

/* 3. 合法行动与不可变性 */
var legal = E.getLegalMoves(g);
ok('开局至少 3 个合法行动', legal.length >= 3, String(legal.length));
ok('合法行动都带稳定 key', legal.every(function (m) { return typeof m.key === 'string' && m.key.length > 0; }));
var snapshot = JSON.stringify(g);
var after = E.applyMove(g, legal[0]);
ok('applyMove 不修改入参', JSON.stringify(g) === snapshot);
ok('行动推进一回合', after.plies === g.plies + 1);

/* 4. 非法行动防护 */
var threw = false;
try { E.applyMove(g, { type: 'hack', key: 'not-a-move' }); } catch (e) { threw = true; }
ok('非法行动抛出异常', threw);

/* 5. AI 确定性 */
var b1 = E.createGame(31337);
var b2 = E.createGame(31337);
ok('同局面的 AI 选择一致', JSON.stringify(E.aiMove(b1)) === JSON.stringify(E.aiMove(b2)));

/* 6. 模式结构 */
if (CFG.mode === 'convert') {
  ok('转换配方与订单充足', CFG.recipes.length >= 4 && CFG.orders.length >= 6);
} else if (CFG.mode === 'orders') {
  ok('订单池与配方充足', CFG.orders.length >= 6 && CFG.recipes.length >= 3);
} else if (CFG.mode === 'worker') {
  ok('工位与轮次配置完整', CFG.spots.length === 6 && CFG.rounds === 4);
} else if (CFG.mode === 'auction') {
  ok('拍品与起始银币配置完整', CFG.lots.length === 10 && CFG.startCoins >= 12);
} else if (CFG.mode === 'market') {
  ok('货物与行动数配置完整', CFG.goods.length === 4 && CFG.actions === 12);
} else {
  ok('未知模式被拒绝', false, CFG.mode);
}

/* 7. 20 局 AI 自对弈 */
var terminated = 0;
var scoresOk = 0;
var metrics = 0;
var sawNegative = false;
var last = null;
var stepsTotal = 0;
var errors = [];
for (var gi = 0; gi < 20; gi++) {
  try {
    var s = E.createGame(9000 + gi * 37);
    var steps = 0;
    while (!s.over && steps < 600) {
      var m = E.aiMove(s);
      if (!m) break;
      s = E.applyMove(s, m);
      steps += 1;
      if (negative(s)) sawNegative = true;
    }
    last = s;
    stepsTotal += steps;
    if (s.over) terminated += 1;
    var sc = E.getScores(s);
    if (sc.length === 2 && sc.every(function (v) { return Number.isFinite(v) && v >= 0; })) scoresOk += 1;
    if (E.netWorth(s, 0) >= 0 && E.netWorth(s, 1) >= 0) metrics += 1;
  } catch (err) {
    errors.push(String(err && err.message || err));
  }
}
ok('20 局 AI 自对弈全部结束', terminated === 20, terminated + '/20 ' + errors.join('; '));
ok('20 局最终分数有效', scoresOk === 20, scoresOk + '/20');
ok('自对弈全程资源与金币非负', !sawNegative);
ok('自对弈估值有限', metrics === 20);
ok('自对弈行动数在合理区间', stepsTotal >= 200 && stepsTotal < 12000, String(stepsTotal));
ok('日志长度受控', !!last && last.log.length <= 40, last ? String(last.log.length) : 'no game');
ok('终局含有效胜者或平局', !!last && [-1, 0, 1].indexOf(last.winner) >= 0, last ? String(last.winner) : 'no game');
ok('终局分数与胜者一致', !!last && (function () {
  var a = last.players[0].score, b = last.players[1].score;
  var expect = a === b ? -1 : (a > b ? 0 : 1);
  return last.winner === expect;
})());

/* 8. 终局拒绝继续行动 */
var overThrew = false;
try { E.applyMove(last, { key: 'after-game' }); } catch (e) { overThrew = true; }
ok('终局拒绝继续行动', overThrew);

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
