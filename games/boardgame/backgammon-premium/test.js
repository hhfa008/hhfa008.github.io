'use strict';

// Backgammon / 双陆棋 premium — engine, rules, presentation and artifact tests.
// Runs standalone (no Chrome) and through games/tests/run-all.js.
// Prints the machine-readable RESULT line consumed by run-all.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('backgammon-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function sizeOf(name) { return exists(name) ? fs.statSync(path.join(__dirname, name)).size : 0; }
function chineseCount(html) {
  return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function has(ms, from, to, die) {
  return ms.some(function (m) {
    return String(m.from) === String(from) && String(m.to) === String(to) && (die == null || m.die === die);
  });
}
function blank(opts) {
  opts = opts || {};
  var st = E.setup({ seed: opts.seed == null ? 7 : opts.seed, names: opts.names });
  st.points = new Array(25);
  for (var i = 0; i <= 24; i++) st.points[i] = 0;
  st.bar = [0, 0];
  st.off = [0, 0];
  st.turn = opts.turn == null ? 0 : opts.turn;
  st.dice = (opts.dice || []).slice();
  st.rolled = (opts.rolled || opts.dice || []).slice();
  st.phase = opts.phase || 'move';
  st.cube = { value: opts.cubeValue || 1, owner: opts.cubeOwner == null ? null : opts.cubeOwner, pending: opts.pending || null };
  st.winner = null;
  st.scoreInfo = null;
  st.endReason = null;
  st.history = [];
  st.log = [];
  st.events = [];
  return st;
}
function withPoints(points, opts) {
  var st = blank(opts);
  Object.keys(points).forEach(function (key) { st.points[Number(key)] = points[key]; });
  return st;
}
function sumSide(st, side) {
  var n = st.bar[side] + st.off[side];
  for (var p = 1; p <= 24; p++) {
    if (side === 0 && st.points[p] > 0) n += st.points[p];
    if (side === 1 && st.points[p] < 0) n += -st.points[p];
  }
  return n;
}
// Minimal WebP dimension reader (VP8X / VP8 / VP8L), no dependencies.
function webpSize(file) {
  var b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  var chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), kind: 'VP8X' };
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, kind: 'VP8' };
  if (chunk === 'VP8L') {
    var bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff), kind: 'VP8L' };
  }
  return null;
}

s.group('标准开局：24 点、30 枚、pip 167', function () {
  var g = E.setup({ seed: 1 });
  s.eq('24 个点', g.points.length - 1, 24);
  s.eq('白方 24 点 2 枚', g.points[24], 2);
  s.eq('白方 13 点 5 枚', g.points[13], 5);
  s.eq('白方 8 点 3 枚', g.points[8], 3);
  s.eq('白方 6 点 5 枚', g.points[6], 5);
  s.eq('黑方 1 点 2 枚', g.points[1], -2);
  s.eq('黑方 12 点 5 枚', g.points[12], -5);
  s.eq('黑方 17 点 3 枚', g.points[17], -3);
  s.eq('黑方 19 点 5 枚', g.points[19], -5);
  s.eq('白方共 15 枚', sumSide(g, 0), 15);
  s.eq('黑方共 15 枚', sumSide(g, 1), 15);
  s.eq('总数 30 枚', sumSide(g, 0) + sumSide(g, 1), 30);
  s.eq('白方 pip 167', E.pip(g, 0), 167);
  s.eq('黑方 pip 167', E.pip(g, 1), 167);
  s.eq('四象限各 6 点', E.quadrantCounts(g).length, 4);
  s.eq('四象限棋子计数', E.quadrantCounts(g), [7, 8, 8, 7]);
  s.eq('四象限总数 30', E.quadrantCounts(g).reduce(function (a, b) { return a + b; }, 0), 30);
  s.eq('开局 bar 为空', g.bar, [0, 0]);
  s.eq('开局 off 为空', g.off, [0, 0]);
  s.eq('白先', g.turn, 0);
  s.eq('阶段 roll', g.phase, 'roll');
  s.eq('倍数方块初始 1', g.cube.value, 1);
  s.eq('倍数方块初始居中', g.cube.owner, null);
  s.eq('sideIndex white', E.sideIndex('white'), 0);
  s.eq('sideIndex black', E.sideIndex('black'), 1);
  s.eq('sideIndex 数字 1', E.sideIndex(1), 1);
  s.eq('数据标题', D.title, '双陆棋 Backgammon');
  s.eq('数据人数 2 人', D.players, '2 人');
  s.eq('数据开局 pip 167', D.openingPip, 167);
  s.ok('B 站来源至少 2 条', D.sources.length >= 2, String(D.sources.length));
  s.ok('AI 名称两条', D.aiNames.length === 2, JSON.stringify(D.aiNames));
});

s.group('骰子、对子与可注入 RNG', function () {
  var g = E.setup({ seed: 2 });
  E.rollDice(g, { dice: [6, 5] });
  s.eq('普通骰点保留两枚', g.dice, [6, 5]);
  s.eq('rolled 记录原始骰点', g.rolled, [6, 5]);
  s.eq('掷骰后进入 move', g.phase, 'move');
  var threw = false;
  try { E.rollDice(g, { dice: [1, 1] }); } catch (e) { threw = true; }
  s.ok('同一回合不能重复掷骰', threw);
  var d = E.setup({ seed: 3 });
  E.rollDice(d, { dice: [4, 4] });
  s.eq('对子变成四步', d.dice, [4, 4, 4, 4]);
  s.eq('对子 rolled 仍是两枚', d.rolled, [4, 4]);
  var bad = E.setup({ seed: 4 });
  threw = false;
  try { E.rollDice(bad, { dice: [0, 7] }); } catch (e) { threw = true; }
  s.ok('非法骰点被拒绝', threw);
  var r1 = E.setup({ seed: 98765 });
  var r2 = E.setup({ seed: 98765 });
  E.rollDice(r1);
  E.rollDice(r2);
  s.eq('同 seed 掷骰一致', r1.rolled, r2.rolled);
  s.ok('骰点都在 1..6', r1.rolled.every(function (v) { return v >= 1 && v <= 6; }));
  var rng = E.setup({ seed: 8 });
  E.rollDice(rng, { rng: function () { return 0.5; } });
  s.eq('注入 RNG 0.5 得到 4+4', rng.rolled, [4, 4]);
  var lone = withPoints({ 24: 1 }, { dice: [4, 4, 4, 4] });
  var seqs = E.allSequences(lone);
  s.ok('对子可走四步', seqs.some(function (x) { return x.moves.length === 4; }), String(seqs.length));
  s.eq('对子最大步数 4', Math.max.apply(null, seqs.map(function (x) { return x.moves.length; })), 4);
});

s.group('封闭点、方向与击中', function () {
  var g = withPoints({ 10: 1, 7: -2 }, { dice: [3, 2] });
  var ms = E.legalMoves(g);
  s.ok('两枚黑子占住落点时不能落', !has(ms, 10, 7), JSON.stringify(ms));
  s.ok('同一点的另一骰点仍可走', has(ms, 10, 8, 2), JSON.stringify(ms));
  var h = withPoints({ 10: 1, 7: -1 }, { dice: [3, 2] });
  s.ok('只有一枚对方棋子时可以落', has(E.legalMoves(h), 10, 7, 3));
  E.applyMove(h, { from: 10, to: 7, die: 3 });
  s.eq('击中后对方进 bar', h.bar[1], 1);
  s.eq('击中后落点归白方', h.points[7], 1);
  s.eq('击中后黑方总数 1（含 bar）', sumSide(h, 1), 1);
  var own = withPoints({ 10: 2 }, { dice: [3, 2] });
  s.ok('可以叠在自己的点上', has(E.legalMoves(own), 10, 7, 3));
  var whiteTurn = E.setup({ seed: 9 });
  E.rollDice(whiteTurn, { dice: [6, 5] });
  s.ok('白方向 24→1 移动', has(E.legalMoves(whiteTurn), 24, 18, 6));
  var blackTurn = E.setup({ seed: 10, turn: 1 });
  E.rollDice(blackTurn, { dice: [6, 5] });
  s.ok('黑方向 1→24 移动', has(E.legalMoves(blackTurn), 1, 7, 6), JSON.stringify(E.legalMoves(blackTurn)));
  s.ok('黑方不能反向移动', !has(E.legalMoves(blackTurn), 1, -5, 6));
  var mixed = withPoints({ 10: 1, 7: -1 }, { dice: [2] });
  s.ok('落点不能同时存在两色', (function () {
    var m = E.legalMoves(mixed).filter(function (x) { return x.from === 10 && x.to === 8; });
    return m.length === 1;
  })());
});

s.group('bar 优先进场与 25-die', function () {
  var g = withPoints({ 19: 1 }, { dice: [2, 5] });
  g.bar[0] = 1;
  var ms = E.legalMoves(g);
  s.ok('bar 有子时只能从 bar 走', ms.length > 0 && ms.every(function (m) { return m.from === 'bar'; }), JSON.stringify(ms));
  s.ok('白方 die 5 进 20 点', has(ms, 'bar', 20, 5));
  s.ok('白方 die 2 进 23 点', has(ms, 'bar', 23, 2));
  var blocked = withPoints({ 23: -2, 19: 1 }, { dice: [2, 5] });
  blocked.bar[0] = 1;
  var bm = E.legalMoves(blocked);
  s.ok('封闭的进场点不能用该骰点', !has(bm, 'bar', 23, 2), JSON.stringify(bm));
  s.ok('另一个进场点仍可用', has(bm, 'bar', 20, 5));
  var hitEntry = withPoints({ 20: -1, 19: 1 }, { dice: [5, 2] });
  hitEntry.bar[0] = 1;
  s.ok('进场点只有一枚对方子时可击中', has(E.legalMoves(hitEntry), 'bar', 20, 5));
  E.applyMove(hitEntry, { from: 'bar', to: 20, die: 5 });
  s.eq('进场击中后对方进 bar', hitEntry.bar[1], 1);
  s.eq('进场后自己的 bar 清空', hitEntry.bar[0], 0);
  var bothBlocked = withPoints({ 20: -2, 23: -2, 19: 1 }, { dice: [2, 5] });
  bothBlocked.bar[0] = 1;
  s.eq('两个进场点都封死时无合法走法', E.legalMoves(bothBlocked).length, 0);
  E.endTurn(bothBlocked);
  s.eq('无合法走法可以结束回合', bothBlocked.turn, 1);
  var blackBar = withPoints({ 5: -1, 3: 1 }, { turn: 1, dice: [3, 4] });
  blackBar.bar[1] = 1;
  s.ok('黑方 die 3 进 3 点', has(E.legalMoves(blackBar), 'bar', 3, 3), JSON.stringify(E.legalMoves(blackBar)));
  s.ok('黑方 die 4 进 4 点', has(E.legalMoves(blackBar), 'bar', 4, 4));
});

s.group('两枚骰子、较骰与结束回合', function () {
  var g = E.setup({ seed: 11 });
  E.rollDice(g, { dice: [6, 5] });
  var seqs = E.allSequences(g);
  s.ok('开局 6+5 存在两步序列', seqs.some(function (x) { return x.moves.length === 2; }), String(seqs.length));
  s.ok('所有返回序列都用满两枚', seqs.every(function (x) { return x.moves.length === 2; }));
  s.ok('13→8@5 作为第一步合法', has(E.legalMoves(g), 13, 8, 5), JSON.stringify(E.legalMoves(g)));
  s.ok('13→7@6 作为第一步合法', has(E.legalMoves(g), 13, 7, 6));
  var one = withPoints({ 3: 1 }, { dice: [6, 2] });
  var om = E.legalMoves(one);
  s.eq('只有一枚能走时只返回一枚', om.length, 1);
  s.ok('只有 die 2 可走', has(om, 3, 1, 2), JSON.stringify(om));
  var higher = withPoints({ 8: 1, 24: 1 }, { dice: [6, 5] });
  for (var p = 18; p <= 23; p++) higher.points[p] = -2;
  var hm = E.legalMoves(higher);
  s.ok('两枚都能单独走时必须走较大的 6', has(hm, 8, 2, 6), JSON.stringify(hm));
  s.ok('不能走较小的 5', !has(hm, 8, 3, 5), JSON.stringify(hm));
  var stuck = withPoints({ 24: 1 }, { dice: [6, 5] });
  for (var q = 18; q <= 23; q++) stuck.points[q] = -2;
  s.eq('两枚都走不了时返回空', E.legalMoves(stuck).length, 0);
  s.eq('无走法状态为 no-moves', E.status(stuck), 'no-moves');
  var threw = false;
  try { E.endTurn(withPoints({ 3: 1 }, { dice: [2] })); } catch (e) { threw = true; }
  s.ok('还有合法走法时不能结束回合', threw);
  s.eq('applyMove 拒绝非法走法', (function () {
    var t = withPoints({ 10: 1 }, { dice: [2] });
    try { E.applyMove(t, { from: 10, to: 7, die: 3 }); return false; } catch (e) { return true; }
  })(), true);
});

s.group('离盘：全部进 home、精确与超点', function () {
  var g = withPoints({ 1: 5, 2: 5, 3: 5 }, { dice: [6, 1] });
  s.ok('15 枚全在 home 时可以离盘', E.canBearOff(g, 0));
  var ms = E.legalMoves(g);
  s.ok('精确骰点 1 可以从 1 点离盘', has(ms, 1, 'off', 1), JSON.stringify(ms));
  s.ok('超点 6 可以从最高 3 点离盘', has(ms, 3, 'off', 6));
  var outside = withPoints({ 1: 14, 8: 1 }, { dice: [1] });
  s.ok('有棋子在 home 外不能离盘', !E.canBearOff(outside, 0));
  s.ok('home 外棋子不能离盘', !E.legalMoves(outside).some(function (m) { return m.to === 'off'; }));
  var bar = withPoints({ 1: 14 }, { dice: [1] });
  bar.bar[0] = 1;
  s.ok('bar 有子不能离盘', !E.canBearOff(bar, 0));
  s.ok('bar 有子时没有离盘走法', !E.legalMoves(bar).some(function (m) { return m.to === 'off'; }));
  var skip = withPoints({ 1: 5, 3: 5, 6: 5 }, { dice: [4] });
  s.ok('不能跳过更高的 6 点去离 3 点', !has(E.legalMoves(skip), 3, 'off', 4), JSON.stringify(E.legalMoves(skip)));
  s.ok('6 点可以正常走到 2 点', has(E.legalMoves(skip), 6, 2, 4));
  var exactLower = withPoints({ 3: 1, 6: 1 }, { dice: [3] });
  s.ok('精确点数即使有更高棋子也可离盘', has(E.legalMoves(exactLower), 3, 'off', 3), JSON.stringify(E.legalMoves(exactLower)));
  var high = withPoints({ 1: 1, 3: 1 }, { dice: [6] });
  s.ok('超点从最高 3 点离盘', has(E.legalMoves(high), 3, 'off', 6));
  var near = withPoints({ 1: 1 }, { dice: [1] });
  near.off[0] = 14;
  s.ok('离盘 14 枚后仍可继续离盘', E.canBearOff(near, 0));
  s.ok('black home 为 19–24', E.canBearOff(withPoints({ 19: 15 }, { turn: 1 }), 1));
  s.ok('黑方 home 外的 18 点不能离盘', !E.canBearOff(withPoints({ 18: -15 }, { turn: 1 }), 1));
});

s.group('终局：single / gammon / backgammon', function () {
  var single = withPoints({ 1: 1, 19: -5, 20: -5, 22: -5 }, { dice: [1, 1] });
  single.off[0] = 14;
  single.off[1] = 1;
  E.applyMove(single, { from: 1, to: 'off', die: 1 });
  s.eq('单局结束', single.phase, 'over');
  s.eq('单局赢家白方', single.winner, 0);
  s.eq('单局类型 single', single.scoreInfo.type, 'single');
  s.eq('单局倍率 1', single.scoreInfo.multiplier, 1);
  s.eq('单局得分 1', single.scoreInfo.points, 1);
  s.eq('score() 返回同样结果', E.score(single).type, 'single');
  s.eq('winner() 返回胜方', E.winner(single), 0);
  s.eq('结束状态 over', E.status(single), 'over');

  var gammon = withPoints({ 1: 1, 19: -5, 20: -5, 22: -5 }, { dice: [1, 1] });
  gammon.off[0] = 14;
  E.applyMove(gammon, { from: 1, to: 'off', die: 1 });
  s.eq('gammon 类型', gammon.scoreInfo.type, 'gammon');
  s.eq('gammon 倍率 2', gammon.scoreInfo.multiplier, 2);
  s.eq('gammon 得分 2', gammon.scoreInfo.points, 2);

  var back = withPoints({ 1: 1, 3: -1, 19: -5, 20: -5, 22: -4 }, { dice: [1, 1] });
  back.off[0] = 14;
  E.applyMove(back, { from: 1, to: 'off', die: 1 });
  s.eq('backgammon 类型', back.scoreInfo.type, 'backgammon');
  s.eq('backgammon 倍率 3', back.scoreInfo.multiplier, 3);
  s.eq('backgammon 得分 3', back.scoreInfo.points, 3);

  var barBack = withPoints({ 1: 1, 19: -14 }, { dice: [1, 1] });
  barBack.off[0] = 14;
  barBack.bar[1] = 1;
  E.applyMove(barBack, { from: 1, to: 'off', die: 1 });
  s.eq('负方在 bar 也算 backgammon', barBack.scoreInfo.type, 'backgammon');

  var cubed = withPoints({ 1: 1, 19: -5, 20: -5, 22: -5 }, { dice: [1, 1], cubeValue: 4 });
  cubed.off[0] = 14;
  E.applyMove(cubed, { from: 1, to: 'off', die: 1 });
  s.eq('cube 4 的 gammon 得分 8', cubed.scoreInfo.points, 8);
  s.eq('未结束 score 为 null', E.score(E.setup({ seed: 12 })), null);
  s.eq('未结束 winner 为 null', E.winner(E.setup({ seed: 12 })), null);
});

s.group('倍数方块：加倍、接受、放弃、上限 64', function () {
  var g = E.setup({ seed: 13 });
  s.ok('开局可以加倍', E.canDouble(g, 0));
  E.doubleCube(g, 0);
  s.eq('加倍后等待回应', g.cube.pending.by, 0);
  s.eq('加倍目标 2', g.cube.pending.to, 2);
  s.eq('等待回应时不能掷骰', (function () {
    try { E.rollDice(g, { dice: [1, 2] }); return false; } catch (e) { return true; }
  })(), true);
  s.eq('等待回应时无合法走法', E.legalMoves(g).length, 0);
  var responder = E.cubeResponder(g);
  s.eq('回应者是黑方', responder, 1);
  s.eq('非回应者不能接受', (function () {
    try { E.takeCube(g, 0); return false; } catch (e) { return true; }
  })(), true);
  E.takeCube(g, 1);
  s.eq('接受后倍数 2', g.cube.value, 2);
  s.eq('接受后方块归黑方', g.cube.owner, 1);
  s.eq('接受后清空 pending', g.cube.pending, null);
  s.eq('加倍者仍可掷骰', (function () { E.rollDice(g, { dice: [2, 3] }); return g.phase; })(), 'move');
  s.eq('掷骰后不能加倍', (function () {
    try { E.doubleCube(g, 0); return false; } catch (e) { return true; }
  })(), true);
  var cap = E.setup({ seed: 14, cubeValue: 64 });
  s.ok('64 是上限', !E.canDouble(cap, 0));
  s.eq('64 时加倍被拒绝', (function () {
    try { E.doubleCube(cap, 0); return false; } catch (e) { return true; }
  })(), true);
  var pass = E.setup({ seed: 15, cubeValue: 2 });
  E.doubleCube(pass, 0);
  E.passCube(pass, 1);
  s.eq('放弃后结束', pass.phase, 'over');
  s.eq('放弃方输掉当前赌注 2', pass.scoreInfo.points, 2);
  s.eq('放弃标记 concedes', pass.scoreInfo.concedes, true);
  s.eq('放弃赢家是加倍方', pass.winner, 0);
  var noPending = E.setup({ seed: 16 });
  s.eq('没有 pending 时接受被拒绝', (function () {
    try { E.takeCube(noPending, 1); return false; } catch (e) { return true; }
  })(), true);
});

s.group('AI：纯函数、合法走法、时间上限、自对弈', function () {
  var g = E.setup({ seed: 17 });
  E.rollDice(g, { dice: [6, 5] });
  var before = JSON.stringify(g);
  var seq = E.aiSequence(g, 0, { level: 'normal' });
  s.ok('AI 返回完整序列', seq && seq.moves.length > 0);
  s.eq('aiSequence 不修改状态', JSON.stringify(g), before);
  s.ok('AI 第一步合法', seq && E.legalMoves(g).some(function (m) {
    return String(m.from) === String(seq.moves[0].from) && String(m.to) === String(seq.moves[0].to) && m.die === seq.moves[0].die;
  }));
  var move = E.aiMove(g, 0, { level: 'easy' });
  s.ok('aiMove 返回合法单步', move && E.legalMoves(g).some(function (m) {
    return String(m.from) === String(move.from) && String(m.to) === String(move.to) && m.die === move.die;
  }));
  s.eq('aiMove 也不修改状态', JSON.stringify(g), before);
  ['easy', 'normal', 'hard'].forEach(function (level) {
    var x = E.setup({ seed: 18 });
    E.rollDice(x, { dice: [4, 4] });
    var t = Date.now();
    var out = E.aiSequence(x, 0, { level: level });
    var elapsed = Date.now() - t;
    s.ok(level + ' 返回合法序列', out && out.moves.length > 0);
    s.ok(level + ' 时间不超过 500ms', elapsed <= 500, elapsed + 'ms');
  });
  var cubeState = E.setup({ seed: 19 });
  E.doubleCube(cubeState, 0);
  var response = E.aiCubeResponse(cubeState, 1);
  s.ok('AI 加倍回应为 take 或 pass', response === 'take' || response === 'pass', response);
  var passes = 0;
  for (var seed = 1; seed <= 5; seed++) {
    var game = E.selfPlay(seed, { level: 'easy', maxMs: 40 });
    s.eq('自对弈 ' + seed + ' 结束', game.phase, 'over');
    s.eq('自对弈 ' + seed + ' 总数 30', E.totalBoardCheckers(game), 30);
    s.eq('自对弈 ' + seed + ' 赢家离盘 15', game.off[game.winner], 15);
    s.ok('自对弈 ' + seed + ' 分数类型合法', ['single', 'gammon', 'backgammon'].indexOf(game.scoreInfo.type) >= 0);
    s.eq('自对弈 ' + seed + ' 分数 = cube × multiplier', game.scoreInfo.points, game.scoreInfo.cubeValue * game.scoreInfo.multiplier);
    if (game.scoreInfo.type === 'single') passes += 1;
  }
  s.ok('自对弈至少一局是单局', passes >= 1, String(passes));
});

s.group('公共视图不泄漏内部随机状态', function () {
  var g = E.setup({ seed: 20 });
  var v = E.publicView(g, 0);
  s.ok('视图不含 seed', v.seed === undefined);
  s.ok('视图不含 rngState', v.rngState === undefined);
  s.ok('视图不含内部 history', v.history === undefined);
  s.eq('视图 25 个索引的点位', v.points.length, 25);
  s.eq('视图 bar 两项', v.bar.length, 2);
  s.eq('视图 off 两项', v.off.length, 2);
  s.eq('视图 pip 167/167', v.pip, [167, 167]);
  s.eq('视图 checkers 15/15', v.checkers, [15, 15]);
  s.eq('视图 turn 0', v.turn, 0);
  s.eq('视图 status roll', v.status, 'roll');
  s.eq('视图 you 0', v.you, 0);
  s.ok('自己回合有合法走法字段', Array.isArray(v.legalMoves));
  s.eq('掷骰前合法走法为空', v.legalMoves.length, 0);
  s.ok('对手视角看不到我方合法走法', E.publicView(g, 1).legalMoves.length === 0);
  E.rollDice(g, { dice: [6, 5] });
  var v0 = E.publicView(g, 0);
  var v1 = E.publicView(g, 1);
  s.ok('我方视角有合法走法', v0.legalMoves.length > 0);
  s.eq('对方视角没有我方合法走法', v1.legalMoves.length, 0);
  s.ok('我方视角有走法序列', v0.legalSequences.length > 0);
  s.eq('对方视角没有走法序列', v1.legalSequences.length, 0);
  s.eq('两份视图棋盘完全相同', v0.points, v1.points);
  s.eq('两份视图骰子完全相同', v0.dice, v1.dice);
  s.eq('视图 cube 值', v0.cube.value, 1);
  var cg = E.setup({ seed: 201 });
  E.doubleCube(cg, 0);
  var v2 = E.publicView(cg, 1);
  s.eq('等待加倍时对方有 take/pass', v2.cubeActions, ['take', 'pass']);
  s.eq('我方视角没有 take/pass', E.publicView(cg, 0).cubeActions, []);
  s.eq('视图状态 cube', v2.status, 'cube');
});

s.group('状态守恒与完整对局', function () {
  var g = E.setup({ seed: 21 });
  s.eq('开局三十枚', E.totalBoardCheckers(g), 30);
  E.rollDice(g, { dice: [6, 5] });
  E.applyMove(g, E.legalMoves(g)[0]);
  s.eq('走一步后仍三十枚', E.totalBoardCheckers(g), 30);
  s.eq('走一步后双方各十五', [E.countCheckers(g, 0), E.countCheckers(g, 1)], [15, 15]);
  var over = E.selfPlay(1234, { level: 'easy', maxMs: 40 });
  s.eq('完整对局结束', over.phase, 'over');
  s.eq('完整对局总数 30', E.totalBoardCheckers(over), 30);
  s.eq('完整对局 winner off 15', over.off[over.winner], 15);
  s.ok('完整对局 log 非空', over.log.length > 5, String(over.log.length));
  s.ok('完整对局 turnNumber 合理', over.turnNumber > 10 && over.turnNumber < 2000, String(over.turnNumber));
  var pv = E.publicView(over, 0);
  s.eq('终局视图 phase over', pv.phase, 'over');
  s.eq('终局视图带 score', pv.score.type, over.scoreInfo.type);
});

s.group('页面、规则与联机页静态检查', function () {
  var html = read('index.html');
  var rules = read('rules.html');
  var online = read('online.html');
  var ui = read('ui.js');
  var art = read('art-render.html');
  s.ok('规则页汉字 >=1200', chineseCount(rules) >= 1200, String(chineseCount(rules)));
  console.log('  CJK rules=' + chineseCount(rules));
  s.ok('index 引用共享音效', html.indexOf('../../shared/sfx.js') >= 0);
  s.ok('index 引用 data.js', html.indexOf('<script src="data.js">') >= 0);
  s.ok('index 引用 engine.js', html.indexOf('<script src="engine.js">') >= 0);
  s.ok('index 引用 ui.js', html.indexOf('<script src="ui.js">') >= 0);
  s.ok('index 引用 ui.css', html.indexOf('href="ui.css"') >= 0);
  s.ok('index 不自建 AudioContext', html.indexOf('AudioContext') === -1 && html.indexOf('createOscillator') === -1);
  s.ok('index 无远程脚本', !/<script[^>]+src=["']https?:/i.test(html));
  // canonical 是必须带绝对 URL 的元数据；外链检查只针对资源引用。
  var htmlNoCanonical = html.replace(/<link\b[^>]*rel=["']?canonical["']?[^>]*>/gi, '');
  s.ok('index 无远程样式', !/<link[^>]+href=["']https?:/i.test(htmlNoCanonical));
  s.ok('index 无远程图片', !/<img[^>]+src=["']https?:/i.test(html));
  s.ok('index 声明 viewport', html.indexOf('width=device-width') >= 0);
  s.ok('index 含 aria-live', html.indexOf('aria-live') >= 0);
  s.ok('index 含主题按钮', html.indexOf('id="themeBtn"') >= 0);
  s.ok('index 含静音按钮', html.indexOf('id="muteBtn"') >= 0);
  s.ok('index 含 AI 难度选择', html.indexOf('id="aiLevel"') >= 0 && html.indexOf('value="hard"') >= 0);
  s.ok('index 含掷骰/撤销/新局', ['id="rollBtn"', 'id="undoBtn"', 'id="newBtn"'].every(function (x) { return html.indexOf(x) >= 0; }));
  s.ok('index 含加倍/接受/放弃', ['id="doubleBtn"', 'id="takeBtn"', 'id="passBtn"'].every(function (x) { return html.indexOf(x) >= 0; }));
  s.ok('index 使用宋体标题', html.indexOf('Songti SC') >= 0 && html.indexOf('font-weight:700') >= 0);
  s.ok('index 至少 3 组关键帧', (html.match(/@keyframes/g) || []).length >= 3);
  s.ok('index 有 reduced-motion', html.indexOf('prefers-reduced-motion') >= 0);
  s.ok('index 有深色主题变量', html.indexOf('--bg:#100b08') >= 0);
  s.ok('index 有浅色主题变量', html.indexOf('--bg:#efe4d1') >= 0);
  s.ok('index 触控变量 >=44px', html.indexOf('--tap:48px') >= 0);
  s.ok('index 链接规则页', html.indexOf('rules.html') >= 0);
  s.ok('index 链接联机页', html.indexOf('online.html') >= 0);
  s.ok('index 无 service worker', html.indexOf('serviceWorker') === -1);
  s.ok('不新增 per-game sw.js', !exists('sw.js'));
  s.ok('ui.js 引用胡桃木材质', ui.indexOf('walnut.webp') >= 0);
  s.ok('ui.js 引用枫木材质', ui.indexOf('maple.webp') >= 0);
  s.ok('ui.js 引用皮革材质', ui.indexOf('leather.webp') >= 0);
  s.ok('ui.js 引用象牙棋子材质', ui.indexOf('ivory-checker.webp') >= 0);
  s.ok('ui.js 生成 24 个点', ui.indexOf('p <= 24') >= 0);
  s.ok('online 页含创建/加入', online.indexOf('createBtn') >= 0 && online.indexOf('joinBtn') >= 0);
  s.ok('online 页含排行榜', online.indexOf('leaderboard') >= 0);
  s.ok('online 页含邀请复制', online.indexOf('inviteBtn') >= 0);
  s.ok('online 页含重赛', online.indexOf('restartBtn') >= 0);
  s.ok('online 页含 roll 动作', online.indexOf("'roll'") >= 0 || online.indexOf('"roll"') >= 0);
  s.ok('online 页含 move 动作', online.indexOf("'move'") >= 0 || online.indexOf('"move"') >= 0);
  s.ok('online 页含 double 动作', online.indexOf("'double'") >= 0 || online.indexOf('"double"') >= 0);
  s.ok('online 页含 take/pass', online.indexOf('take') >= 0 && online.indexOf('pass') >= 0);
  s.ok('online 页含 endTurn', online.indexOf('endTurn') >= 0);
  s.ok('online 页无远程脚本', !/<script[^>]+src=["']https?:/i.test(online));
  s.ok('online 页无远程图片', !/<img[^>]+src=["']https?:/i.test(online));
  s.ok('art-render 引用四种本地材质', ['walnut.webp', 'maple.webp', 'leather.webp', 'ivory-checker.webp'].every(function (n) { return art.indexOf(n) >= 0; }));
  s.ok('art-render 无远程图片', !/url\(["']?https?:/i.test(art));
  s.ok('render-art 调用共享渲染器', read('render-art.mjs').indexOf('render-premium-art.mjs') >= 0);
  s.ok('render-art 输出四档尺寸', read('render-art.mjs').indexOf('1200x1200') >= 0 && read('render-art.mjs').indexOf('detail-2:1200x800') >= 0);
  var jsonld = rules.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  var types = jsonld.map(function (block) {
    try { return JSON.parse(block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))['@type']; }
    catch (e) { return 'BAD'; }
  });
  s.eq('规则页 Article + FAQPage', types, ['Article', 'FAQPage']);
  s.eq('规则页两张详情图', (rules.match(/assets\/detail-[12]\.webp/g) || []).length, 2);
  s.ok('规则页含尺寸表', rules.indexOf('<table>') >= 0);
  s.ok('规则页含 pip 167', rules.indexOf('167') >= 0);
  s.ok('规则页含 BV1BL4y1z7SB', rules.indexOf('BV1BL4y1z7SB') >= 0);
  s.ok('规则页含 BV14D4y197By', rules.indexOf('BV14D4y197By') >= 0);
  s.ok('规则页含 BV1cU516ME9k', rules.indexOf('BV1cU516ME9k') >= 0);
  s.ok('规则页至少 3 条 B 站链接', (rules.match(/https:\/\/www\.bilibili\.com\/video\/BV/g) || []).length >= 3);
  s.ok('规则页无远程图片', !/<img[^>]+src=["']https?:/i.test(rules));
});

s.group('交付产物、元数据与素材尺寸', function () {
  ['index.html', 'engine.js', 'data.js', 'ui.js', 'ui.css', 'rules.html', 'test.js', 'DESIGN.md',
    'ACCEPTANCE.md', 'E2E.md', 'HANDOFF.md', 'realism.json', 'perf.json', 'meta.json', 'online.html',
    'online-server.mjs', 'test-online.js', 'e2e.mjs', 'art-render.html', 'render-art.mjs',
    'assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (name) {
    s.ok('存在 ' + name, sizeOf(name) > 0, String(sizeOf(name)));
  });
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'backgammon-premium');
  s.eq('meta 状态 shipped', meta.status, 'shipped');
  s.eq('meta 人数下限 2', meta.players.min, 2);
  s.eq('meta 人数上限 2', meta.players.max, 2);
  s.ok('meta 声明联机 ready', meta.online && meta.online.status === 'ready');
  s.ok('meta 素材本地', meta.assets && meta.assets.localOnly === true);
  s.ok('meta 零外部请求预算', meta.performanceBudgets.externalRequests === 0);
  s.ok('meta 有 serviceWorker 预缓存', Array.isArray(meta.serviceWorker.precacheIncludes) && meta.serviceWorker.precacheIncludes.length >= 4);
  s.ok('meta 有 B 站来源', Array.isArray(meta.bilibili.sources) && meta.bilibili.sources.length >= 2);
  s.ok('meta 五项门禁', Boolean(meta.gates && meta.gates.tests && meta.gates.art && meta.gates.realism && meta.gates.mobile && meta.gates.online));
  var realism = JSON.parse(read('realism.json'));
  s.eq('realism pass', realism.pass, true);
  s.ok('realism >=6 项', realism.checks.length >= 6, String(realism.checks.length));
  s.ok('realism >=6 类', new Set(realism.checks.map(function (c) { return c.kind; })).size >= 6);
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.eq('realism pip 167', realism.pip.openingBoth, 167);
  var perf = JSON.parse(read('perf.json'));
  s.eq('perf ok', perf.ok, true);
  s.eq('perf 外部请求为 0', perf.measured.externalRequests, 0);
  var onlineEvidence = JSON.parse(read('online-e2e.json'));
  s.eq('online-e2e clients=2', onlineEvidence.clients, 2);
  s.eq('online-e2e sameGame', onlineEvidence.sameGame, true);
  s.eq('online-e2e 结算一致', onlineEvidence.settlementConsistent, true);
  s.eq('online-e2e reconnect', onlineEvidence.reconnect, true);
  s.eq('online-e2e timeoutTakeover', onlineEvidence.timeoutTakeover, true);
  s.eq('online-e2e leaderboard', onlineEvidence.leaderboard, true);
  s.eq('online-e2e 纳入 run-all', onlineEvidence.runAll, true);
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端实现 roll 动作', server.indexOf("action.type === 'roll'") >= 0);
  s.ok('服务端实现 move 动作', server.indexOf("action.type === 'move'") >= 0);
  s.ok('服务端实现 double/take/pass', server.indexOf('doubleCube') >= 0 && server.indexOf('takeCube') >= 0 && server.indexOf('passCube') >= 0);
  s.ok('服务端公共视图来自 engine', server.indexOf('E.publicView') >= 0);
  s.ok('服务端 AI 使用 aiMove', server.indexOf('E.aiMove') >= 0);
  var testOnline = read('test-online.js');
  s.ok('联机测试含双客户端', testOnline.indexOf('client-one') >= 0 && testOnline.indexOf('client-two') >= 0);
  s.ok('联机测试含超时托管', testOnline.indexOf('timeout') >= 0 && testOnline.indexOf('takeover') >= 0);
  s.ok('联机测试含控制组', testOnline.indexOf('--control') >= 0);
  var e2e = read('e2e.mjs');
  s.ok('e2e 含 --control', e2e.indexOf('--control') >= 0);
  s.ok('e2e 含联机段', e2e.indexOf('startBackgammonServer') >= 0 && e2e.indexOf('Online room') >= 0);
  s.ok('DESIGN.md >=400 字节', sizeOf('DESIGN.md') >= 400);
  s.ok('E2E.md 非空', sizeOf('E2E.md') > 200);
  s.ok('HANDOFF.md 三行', read('HANDOFF.md').trim().split(/\r?\n/).length === 3);
  var dims = {
    'assets/cover.webp': [1200, 1200],
    'assets/og.webp': [1200, 630],
    'assets/detail-1.webp': [1200, 800],
    'assets/detail-2.webp': [1200, 800]
  };
  var totalArt = 0;
  Object.keys(dims).forEach(function (rel) {
    var size = webpSize(path.join(__dirname, rel));
    totalArt += sizeOf(rel);
    s.ok(rel + ' 可读取尺寸', Boolean(size), JSON.stringify(size));
    if (size) {
      s.eq(rel + ' 宽', size.width, dims[rel][0]);
      s.eq(rel + ' 高', size.height, dims[rel][1]);
    }
  });
  var artDir = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'backgammon');
  var names = ['walnut.webp', 'maple.webp', 'leather.webp', 'ivory-checker.webp'];
  s.eq('四件本地单物件材质', names.filter(function (n) {
    return fs.existsSync(path.join(artDir, n)) && fs.statSync(path.join(artDir, n)).size > 1000;
  }).length, 4);
  names.forEach(function (n) { totalArt += fs.existsSync(path.join(artDir, n)) ? fs.statSync(path.join(artDir, n)).size : 0; });
  s.ok('全部美术 <= 2MB', totalArt <= 2 * 1024 * 1024, totalArt + ' bytes');
  console.log('  ART total=' + totalArt + ' bytes');
  s.ok('只交付 WebP，不交付 PNG 母版', !fs.existsSync(path.join(__dirname, 'assets', 'cover.png')) &&
    !fs.existsSync(path.join(__dirname, 'assets', 'detail-1.png')));
});

s.done();
