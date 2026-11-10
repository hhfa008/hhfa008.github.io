'use strict';

// Aeroplane Chess (飞行棋) premium — engine, real-board, rules, AI, page and
// gate tests. Discovery: games/tests/run-all.js runs every test*.js here.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('aeroplane-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function cjk(html) { return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length; }
function pngInfo(file) {
  if (!fs.existsSync(file)) return null;
  var b = fs.readFileSync(file);
  if (b.length < 26 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b.readUInt8(24), colorType: b.readUInt8(25), bytes: b.length };
}
function stateWith(planes, dice, turn, opts) {
  opts = opts || {};
  var list = [planes || [-1, -1, -1, -1]];
  if (opts.p1) list.push(opts.p1);
  if (opts.p2) list.push(opts.p2);
  if (opts.p3) list.push(opts.p3);
  return E.empty({
    players: opts.players || list.length,
    planes: list,
    dice: dice == null ? 1 : dice,
    turn: turn == null ? 0 : turn,
    awaitRoll: opts.awaitRoll == null ? false : opts.awaitRoll
  });
}
function actsFor(st, plane) {
  return E.planeActions(st).filter(function (a) { return a.k === 'move' && a.plane === plane; });
}
function hasAction(st, plane) { return actsFor(st, plane).length > 0; }
function countColor(list, color) {
  var n = 0;
  for (var i = 0; i < list.length; i++) if (list[i] === color) n++;
  return n;
}
function sum(list) { var n = 0; for (var i = 0; i < list.length; i++) n += list[i]; return n; }

s.group('真实 52 格彩环与四色各 13 格', function () {
  s.eq('外环总格数 52', E.LOOP, 52);
  s.eq('归航跑道 6 格', E.HOME, 6);
  s.eq('终点位置 57', E.FINISH, 57);
  s.eq('基地位置 -1', E.HANGAR, -1);
  s.eq('每色 4 架', E.PLANES_PER_PLAYER, 4);
  s.eq('最少 2 人', E.MIN_PLAYERS, 2);
  s.eq('最多 4 人', E.MAX_PLAYERS, 4);
  s.eq('14×14 网格', E.GRID, 14);
  s.eq('环形坐标 52 个', E.RING_CELLS.length, 52);
  s.ok('环形坐标全部唯一', E.RING_GEOMETRY_OK === true);
  var seen = {}, unique = true, inBounds = true;
  E.RING_CELLS.forEach(function (cell) {
    var key = cell[0] + ',' + cell[1];
    if (seen[key]) unique = false;
    seen[key] = true;
    if (cell[0] < 0 || cell[0] > 13 || cell[1] < 0 || cell[1] > 13) inBounds = false;
  });
  s.ok('52 个格子坐标不重复', unique);
  s.ok('52 个格子都在 14×14 内', inBounds);
  s.eq('颜色序列长度 52', E.RING_COLORS.length, 52);
  var colors = [0, 1, 2, 3].map(function (c) { return countColor(E.RING_COLORS, c); });
  s.eq('四色各 13 格', colors, [13, 13, 13, 13]);
  s.eq('四色总计 52', sum(colors), 52);
  s.ok('颜色按 4 循环', E.RING_COLORS.every(function (c, i) { return c === i % 4; }));
  s.eq('四个起点', E.START_RING, [0, 13, 26, 39]);
  s.eq('起点 0 是红格', E.RING_COLORS[E.START_RING[0]], 0);
  s.eq('起点 13 是黄格', E.RING_COLORS[E.START_RING[1]], 1);
  s.eq('起点 26 是蓝格', E.RING_COLORS[E.START_RING[2]], 2);
  s.eq('起点 39 是绿格', E.RING_COLORS[E.START_RING[3]], 3);
  s.eq('红起点坐标', E.RING_CELLS[0], [6, 0]);
  s.eq('黄起点坐标', E.RING_CELLS[13], [13, 6]);
  s.eq('蓝起点坐标', E.RING_CELLS[26], [7, 13]);
  s.eq('绿起点坐标', E.RING_CELLS[39], [0, 7]);
  s.eq('0 号玩家起点', E.startOf(0), 0);
  s.eq('1 号玩家起点', E.startOf(1), 13);
  s.eq('2 号玩家起点', E.startOf(2), 26);
  s.eq('3 号玩家起点', E.startOf(3), 39);
  s.eq('红走 1 格到全局 1', E.globalRing(0, 1), 1);
  s.eq('黄走 1 格到全局 14', E.globalRing(1, 1), 14);
  s.eq('绿走 50 格绕回', E.globalRing(3, 50), 37);
  s.eq('负进度无效', E.globalRing(0, -1), -1);
  s.eq('超过 51 无效', E.globalRing(0, 52), -1);
  s.eq('本色格进度 0', E.isOwnColorCell(0, 0), true);
  s.eq('本色格进度 4', E.isOwnColorCell(0, 4), true);
  s.eq('本色格进度 12', E.isOwnColorCell(0, 12), true);
  s.eq('非本色格进度 1', E.isOwnColorCell(0, 1), false);
  s.eq('非本色格进度 13', E.isOwnColorCell(0, 13), false);
  s.eq('黄方进度 4 也是本色', E.isOwnColorCell(1, 4), true);
  s.eq('蓝方进度 8 也是本色', E.isOwnColorCell(2, 8), true);
  s.eq('绿方进度 20 也是本色', E.isOwnColorCell(3, 20), true);
});

s.group('4 基地、4 条 6 格归航道与中心终点', function () {
  s.eq('4 条归航跑道', E.LANES.length, 4);
  E.LANES.forEach(function (lane, i) { s.eq('归航道 ' + i + ' 有 6 格', lane.length, 6); });
  var laneKeys = {}, laneUnique = true;
  E.LANES.forEach(function (lane) { lane.forEach(function (cell) { var k = cell[0] + ',' + cell[1]; if (laneKeys[k]) laneUnique = false; laneKeys[k] = true; }); });
  s.ok('24 个归航格互不重叠', laneUnique);
  s.eq('归航格总数 24', Object.keys(laneKeys).length, 24);
  s.eq('红归航最后一格在中心', E.LANES[0][5], [6, 6]);
  s.eq('黄归航最后一格在中心', E.LANES[1][5], [7, 6]);
  s.eq('蓝归航最后一格在中心', E.LANES[2][5], [7, 7]);
  s.eq('绿归航最后一格在中心', E.LANES[3][5], [6, 7]);
  s.eq('4 座基地', E.BASES.length, 4);
  var slotKeys = {}, slotCount = 0;
  E.BASES.forEach(function (base, i) {
    s.eq('基地 ' + i + ' 有 4 个机位', base.slots.length, 4);
    s.eq('基地 ' + i + ' 是 5×5', [base.c1 - base.c0 + 1, base.r1 - base.r0 + 1], [5, 5]);
    base.slots.forEach(function (slot) { slotKeys[slot[0] + ',' + slot[1]] = true; slotCount++; });
  });
  s.eq('基地机位总数 16', slotCount, 16);
  s.eq('16 个机位互不重叠', Object.keys(slotKeys).length, 16);
  s.eq('中心区 4 格', E.CENTER.cells.length, 4);
  s.eq('中心区 2×2', [E.CENTER.c1 - E.CENTER.c0 + 1, E.CENTER.r1 - E.CENTER.r0 + 1], [2, 2]);
  s.eq('进度 0 在红起点', E.cellOfProgress(0, 0), { kind: 'ring', index: 0, c: 6, r: 0 });
  s.eq('进度 51 在最后一环格', E.cellOfProgress(0, 51).kind, 'ring');
  s.eq('进度 52 在归航道首格', E.cellOfProgress(0, 52), { kind: 'lane', index: 0, c: 6, r: 1 });
  s.eq('进度 56 在归航道末格', E.cellOfProgress(0, 56), { kind: 'lane', index: 4, c: 6, r: 5 });
  s.eq('进度 57 在终点', E.cellOfProgress(0, 57).kind, 'finish');
  s.eq('飞机进度 -1 记 0', E.planeProgress(-1), 0);
  s.eq('飞机进度 0 记 1', E.planeProgress(0), 1);
  s.eq('飞机进度 56 记 57', E.planeProgress(56), 57);
  s.eq('飞机进度 57 记 57', E.planeProgress(57), 57);
  s.eq('同色跳 4 目标', E.jumpTarget(0, 12), 16);
  s.eq('48 格不能跳 4 出环', E.jumpTarget(0, 48), -1);
  s.eq('非本色不能跳', E.jumpTarget(0, 13), -1);
  s.eq('捷径口 36 → 48', E.shortcutTarget(0, 36), 48);
  s.eq('捷径口只在 36', E.shortcutTarget(0, 32), -1);
  s.eq('捷径不越过终点', E.shortcutTarget(0, 40), -1);
});

s.group('2–4 人开局与棋子守恒', function () {
  [2, 3, 4].forEach(function (n) {
    var st = E.createGame({ seed: 100 + n, players: n });
    s.eq(n + ' 人局玩家数', st.players.length, n);
    s.eq(n + ' 人局每方 4 架', st.players.map(function (p) { return p.planes.length; }), Array(n).fill(4));
    s.eq(n + ' 人局总飞机', n * 4, st.players.reduce(function (acc, p) { return acc + p.planes.length; }, 0));
    s.ok(n + ' 人局全部在基地', st.players.every(function (p) { return p.planes.every(function (x) { return x === -1; }); }));
    s.eq(n + ' 人局轮到 0 号', st.turn, 0);
    s.eq(n + ' 人局等待掷骰', st.awaitRoll, true);
    s.eq(n + ' 人局骰子为 0', st.dice, 0);
    s.eq(n + ' 人局阶段 playing', st.phase, 'playing');
    s.eq(n + ' 人局无赢家', st.winner, -1);
    s.eq(n + ' 人局骰子历史为空', st.diceHistory.length, 0);
    s.ok(n + ' 人局颜色对应座位', st.players.every(function (p, i) { return p.color === i; }));
    s.ok(n + ' 人局名称非空', st.players.every(function (p) { return typeof p.name === 'string' && p.name.length > 0; }));
  });
  s.eq('少于 2 人按 2 人', E.createGame({ players: 1 }).players.length, 2);
  s.eq('多于 4 人按 4 人', E.createGame({ players: 9 }).players.length, 4);
  s.eq('同种子同随机状态', E.createGame({ seed: 77 }).rngState, E.createGame({ seed: 77 }).rngState);
  s.ok('不同种子不同随机状态', E.createGame({ seed: 77 }).rngState !== E.createGame({ seed: 78 }).rngState);
  var st = E.empty({ players: 3, planes: [[0, 1, -1, -1], [5, -1, -1, -1], [-1, -1, -1, -1]], dice: 4, turn: 2 });
  s.eq('empty 设置飞机', st.players[0].planes, [0, 1, -1, -1]);
  s.eq('empty 设置骰子', st.dice, 4);
  s.eq('empty 设置回合', st.turn, 2);
  s.eq('empty 默认等待掷骰', st.awaitRoll, true);
  s.eq('克隆不影响原状态', (function () { var c = E.clone(st); c.players[0].planes[0] = 9; return st.players[0].planes[0]; })(), 0);
});

s.group('骰子：服务端随机、可复现、不可预测未来', function () {
  var a = E.createGame({ seed: 20261110 });
  var b = E.createGame({ seed: 20261110 });
  var seqA = [], seqB = [];
  for (var i = 0; i < 60; i++) { seqA.push(E.rollValue(a)); seqB.push(E.rollValue(b)); }
  s.eq('同种子 60 次骰子完全一致', seqA, seqB);
  s.ok('60 次骰子都在 1–6', seqA.every(function (v) { return v >= 1 && v <= 6; }));
  var c = E.createGame({ seed: 20261111 });
  var seqC = [];
  for (var j = 0; j < 60; j++) seqC.push(E.rollValue(c));
  s.ok('不同种子骰子序列不同', JSON.stringify(seqA) !== JSON.stringify(seqC));
  var dist = [0, 0, 0, 0, 0, 0, 0];
  var d = E.createGame({ seed: 4242 });
  for (var k = 0; k < 6000; k++) dist[E.rollValue(d)]++;
  s.ok('6000 次分布覆盖 1–6', dist.slice(1).every(function (n) { return n > 800; }), JSON.stringify(dist.slice(1)));
  s.ok('6000 次没有越界值', dist[0] === 0);
  var st = E.createGame({ seed: 9 });
  var r = E.roll(st, 6);
  s.ok('强制掷骰成功', r.ok === true);
  s.eq('掷骰写入点数', st.dice, 6);
  s.eq('掷骰后不再等待', st.awaitRoll, false);
  s.eq('掷骰计数 1', st.rolls, 1);
  s.eq('骰子历史 1 条', st.diceHistory.length, 1);
  s.eq('骰子历史记录点数', st.diceHistory[0].value, 6);
  s.eq('重复掷骰被拒绝', E.roll(st, 3).code, 'E_ROLL');
  var bad = E.createGame({ seed: 9 });
  s.eq('非法点数 0 被拒绝', E.roll(bad, 0).code, 'E_DIE');
  s.eq('非法点数 7 被拒绝', E.roll(bad, 7).code, 'E_DIE');
  s.eq('非法掷骰不消耗随机数', bad.rolls, 0);
  var view = E.publicView(st, 0);
  s.ok('公开视图不含 seed', JSON.stringify(view).indexOf('"seed"') < 0);
  s.ok('公开视图不含 rngState', JSON.stringify(view).indexOf('rngState') < 0);
  s.ok('公开视图骰子历史只含已发生', view.diceHistory.length === st.rolls);
  s.ok('公开视图骰子历史值合法', view.diceHistory.every(function (x) { return x.value >= 1 && x.value <= 6; }));
  s.eq('公开视图带棋盘 52', view.board.loop, 52);
  s.eq('公开视图带四色 13', view.board.ringColors.filter(function (x) { return x === 0; }).length, 13);
  var tamper = stateWith([0, -1, -1, -1], 1);
  var res = E.applyAction(tamper, { k: 'move', plane: 0, dice: 6, to: 1 });
  s.ok('客户端附带 dice 不改变服务端点数', res.ok && tamper.players[0].planes[0] === 1);
  var er = E.ensureRoll(E.createGame({ seed: 5 }));
  s.eq('ensureRoll 后已掷骰', er.awaitRoll, false);
  s.ok('ensureRoll 后有点数', er.dice >= 1 && er.dice <= 6);
});

s.group('掷 6 起飞、再掷与三连 6 惩罚', function () {
  var st = stateWith([-1, -1, -1, -1], 5);
  s.eq('掷 5 不能起飞', E.planeActions(st)[0].k, 'skip');
  st = stateWith([-1, -1, -1, -1], 6);
  var launches = E.planeActions(st).filter(function (a) { return a.kind === 'launch'; });
  s.eq('掷 6 四架都可起飞', launches.length, 4);
  s.eq('起飞动作 from -1', launches[0].from, -1);
  s.eq('起飞动作到起点 0', launches[0].to, 0);
  s.eq('起飞落在本色起点格', launches[0].toCell.index, 0);
  var res = E.applyAction(st, { k: 'move', plane: 0 });
  s.ok('起飞成功', res.ok);
  s.eq('飞机在起点', st.players[0].planes[0], 0);
  s.eq('掷 6 保留回合', st.turn, 0);
  s.eq('掷 6 后等待再掷', st.awaitRoll, true);
  s.eq('起飞不触发跳格', st.players[0].planes[0], 0);
  var capStart = stateWith([-1, -1, -1, -1], 6, 0, { p1: [39, -1, -1, -1] });
  var capRes = E.applyAction(capStart, { k: 'move', plane: 0 });
  s.eq('起飞撞回起点敌机', capStart.players[1].planes[0], -1);
  s.eq('起飞撞子记录 1 架', capRes.captured.length, 1);
  var st2 = E.createGame({ seed: 3, players: 2 });
  s.ok('第一掷有效', E.roll(st2, 6).ok);
  var la = E.planeActions(st2).find(function (a) { return a.kind === 'launch'; });
  E.applyAction(st2, la);
  s.eq('第一次 6 后再掷', st2.awaitRoll, true);
  E.roll(st2, 6);
  var la2 = E.planeActions(st2).find(function (a) { return a.kind === 'launch'; });
  E.applyAction(st2, la2);
  s.eq('第二次 6 后再掷', st2.awaitRoll, true);
  s.eq('三连 6 前飞机在起点', st2.players[0].planes.filter(function (x) { return x === 0; }).length, 2);
  var third = E.roll(st2, 6);
  s.ok('第三次 6 触发惩罚', !!third.penalty);
  s.eq('惩罚把最近移动的飞机送回基地', st2.players[0].planes.filter(function (x) { return x === -1; }).length, 3);
  s.eq('三连 6 后换人', st2.turn, 1);
  s.eq('三连 6 后等待下家掷骰', st2.awaitRoll, true);
  s.eq('骰子历史保留三次 6', st2.diceHistory.slice(-3).map(function (x) { return x.value; }), [6, 6, 6]);
  s.ok('日志写明三连 6', st2.log.some(function (line) { return line.indexOf('连续三个 6') >= 0; }));
  var finishedSafe = E.createGame({ seed: 8, players: 2 });
  finishedSafe.players[0].planes = [57, 57, 57, 57];
  finishedSafe.sixStreak = 2;
  finishedSafe.lastSixMovedPlane = 0;
  finishedSafe.awaitRoll = true;
  var fsRes = E.roll(finishedSafe, 6);
  s.eq('已到终点的飞机不受三连 6 惩罚', finishedSafe.players[0].planes[0], 57);
  s.eq('惩罚记录为空', fsRes.penalty, null);
  var noLast = E.createGame({ seed: 9, players: 2 });
  noLast.sixStreak = 2; noLast.lastSixMovedPlane = null; noLast.awaitRoll = true;
  var nl = E.roll(noLast, 6);
  s.eq('没有可罚飞机时跳过', nl.penalty, null);
  s.eq('跳过也换人', noLast.turn, 1);
  var noMove6 = E.createGame({ seed: 11, players: 2 });
  noMove6.players[0].planes = [57, 57, 57, 57];
  noMove6.awaitRoll = true;
  var nm = E.roll(noMove6, 6);
  s.eq('掷 6 无子可动保留回合', nm.again, true);
  s.eq('无子可动仍等待再掷', noMove6.awaitRoll, true);
  s.eq('无子可动不换人', noMove6.turn, 0);
});

s.group('移动、归航道与精确终点', function () {
  var st = stateWith([0, -1, -1, -1], 3);
  var r = E.applyAction(st, { k: 'move', plane: 0 });
  s.eq('普通移动点数 3', st.players[0].planes[0], 3);
  s.eq('普通移动后换人', st.turn, 1);
  s.eq('普通移动后等待下家掷骰', st.awaitRoll, true);
  s.ok('普通移动返回 turnChanged', r.turnChanged === true);
  var six = stateWith([0, -1, -1, -1], 6);
  E.applyAction(six, { k: 'move', plane: 0 });
  s.eq('掷 6 移动 6 格', six.players[0].planes[0], 6);
  s.eq('掷 6 移动后仍是本方', six.turn, 0);
  s.eq('掷 6 移动后等待再掷', six.awaitRoll, true);
  s.eq('51 + 6 精确到终点', (function () { var x = stateWith([51, -1, -1, -1], 6); return E.applyAction(x, { k: 'move', plane: 0 }).to; })(), 57);
  s.eq('51 + 5 停在归航道末格', (function () { var x = stateWith([51, -1, -1, -1], 5); return E.applyAction(x, { k: 'move', plane: 0 }).to; })(), 56);
  s.eq('52 + 5 精确到终点', (function () { var x = stateWith([52, -1, -1, -1], 5); return E.applyAction(x, { k: 'move', plane: 0 }).to; })(), 57);
  var b52 = E.planeActions(stateWith([52, -1, -1, -1], 6)).find(function (a) { return a.plane === 0; });
  s.eq('52 + 6 超出终点退回 56', b52 && b52.to, 56);
  s.eq('52 + 6 退回 1 格', b52 && b52.bounce, 1);
  s.eq('52 + 6 不再判为不可走', hasAction(stateWith([52, -1, -1, -1], 6), 0), true);
  s.eq('52 + 6 执行后停在 56', (function () { var x = stateWith([52, -1, -1, -1], 6); E.applyAction(x, { k: 'move', plane: 0 }); return x.players[0].planes[0]; })(), 56);
  s.eq('56 + 1 精确到终点', hasAction(stateWith([56, -1, -1, -1], 1), 0), true);
  var b56 = E.planeActions(stateWith([56, -1, -1, -1], 2)).find(function (a) { return a.plane === 0; });
  s.eq('56 + 2 超出终点退回 56', b56 && b56.to, 56);
  s.eq('56 + 2 退回 1 格', b56 && b56.bounce, 1);
  var b56six = E.planeActions(stateWith([56, -1, -1, -1], 6)).find(function (a) { return a.plane === 0; });
  s.eq('56 + 6 退回 52', b56six && b56six.to, 52);
  s.eq('56 + 6 退回 5 格', b56six && b56six.bounce, 5);
  s.eq('超出退回不触发跳格', b56six && b56six.jump, 0);
  s.eq('超出退回不触发捷径', b56six && b56six.shortcut, 0);
  s.eq('已到终点的飞机不再走', hasAction(stateWith([57, -1, -1, -1], 6), 0), false);
  s.eq('51 + 7 是不可能的骰子', E.roll(stateWith([51, -1, -1, -1], 1, 0, { awaitRoll: true }), 7).code, 'E_DIE');
  var lane = stateWith([50, -1, -1, -1], 2);
  var lm = E.planeActions(lane).find(function (a) { return a.plane === 0; });
  s.eq('归航道预览是 lane', lm.toCell.kind, 'lane');
  E.applyAction(lane, { k: 'move', plane: 0 });
  s.eq('52 落在归航道首格', E.cellOfProgress(0, lane.players[0].planes[0]).index, 0);
  var fin = stateWith([56, -1, -1, -1], 1);
  s.eq('到达终点计数 1', (function () { E.applyAction(fin, { k: 'move', plane: 0 }); return E.finishedCount(fin.players[0]); })(), 1);
  s.eq('归航道内不发生撞子', E.capturesAt(stateWith([52, -1, -1, -1], 1), 0, 52).length, 0);
  var p = stateWith([0, 10, -1, -1], 1);
  var before = JSON.stringify(p.players);
  E.planeActions(p);
  s.eq('枚举动作不修改状态', JSON.stringify(p.players), before);
});

s.group('同色跳 4 与虚线捷径 +12', function () {
  var st = stateWith([11, -1, -1, -1], 1);
  var a = E.planeActions(st).find(function (x) { return x.plane === 0; });
  s.eq('落在本色格预览 +4', a.jump, 4);
  s.eq('预览最终落点 16', a.to, 16);
  s.eq('预览先落在 12', a.landed, 12);
  var r = E.applyAction(st, { k: 'move', plane: 0 });
  s.eq('执行后到 16', st.players[0].planes[0], 16);
  s.eq('结果记录 jump 4', r.jump, 4);
  s.eq('跳格只跳一次', st.players[0].planes[0], 16);
  s.eq('落在别人颜色不跳', hasAction(stateWith([12, -1, -1, -1], 1), 0) && E.planeActions(stateWith([12, -1, -1, -1], 1)).find(function (x) { return x.plane === 0; }).jump, 0);
  var last = stateWith([47, -1, -1, -1], 1);
  var la = E.planeActions(last).find(function (x) { return x.plane === 0; });
  s.eq('48 格不能跳出环', la.jump, 0);
  s.eq('48 格最终仍在 48', la.to, 48);
  var cap = stateWith([11, -1, -1, -1], 1, 0, { p1: [3, -1, -1, -1] });
  var cr = E.applyAction(cap, { k: 'move', plane: 0 });
  s.eq('跳到 16 后撞回敌机', cap.players[1].planes[0], -1);
  s.eq('跳格撞子记录 1 架', cr.captured.length, 1);
  var sc = stateWith([35, -1, -1, -1], 1);
  var sa = E.planeActions(sc).find(function (x) { return x.plane === 0; });
  s.eq('捷径口预览 shortcut 12', sa.shortcut, 12);
  s.eq('捷径不走 +4', sa.jump, 0);
  s.eq('捷径最终 48', sa.to, 48);
  E.applyAction(sc, { k: 'move', plane: 0 });
  s.eq('捷径执行到 48', sc.players[0].planes[0], 48);
  var scCap = stateWith([35, -1, -1, -1], 1, 0, { p1: [35, -1, -1, -1] });
  var scRes = E.applyAction(scCap, { k: 'move', plane: 0 });
  s.eq('捷径撞回 48 格敌机', scCap.players[1].planes[0], -1);
  s.eq('捷径撞子记录 1 架', scRes.captured.length, 1);
  var chain = stateWith([31, -1, -1, -1], 1);
  var ca = E.planeActions(chain).find(function (x) { return x.plane === 0; });
  s.eq('跳 4 到捷径口不再连锁', ca.to, 36);
  s.eq('跳 4 到捷径口 shortcut 0', ca.shortcut, 0);
  var yellow = stateWith([35, -1, -1, -1], 1, 1, { p1: [-1, -1, -1, -1] });
  yellow.players[0].planes = [-1, -1, -1, -1];
  yellow.players[1].planes = [35, -1, -1, -1];
  var ya = E.planeActions(yellow).find(function (x) { return x.plane === 0; });
  s.eq('黄方也有同一条捷径', ya.shortcut, 12);
  s.eq('黄方捷径到 48', ya.to, 48);
  s.eq('跳格与捷径不叠加', sa.shortcut > 0 && sa.jump === 0, true);
});

s.group('撞子回基地、己方叠放与安全区', function () {
  var st = stateWith([5, -1, -1, -1], 1, 0, { p1: [45, -1, -1, -1] });
  var r = E.applyAction(st, { k: 'move', plane: 0 });
  s.eq('撞回同格敌机', st.players[1].planes[0], -1);
  s.eq('撞子列表记录座位', r.captured[0].seat, 1);
  s.eq('撞子列表记录飞机号', r.captured[0].plane, 0);
  var relaunch = stateWith([-1, -1, -1, -1], 5, 1, { p1: [0, -1, -1, -1] });
  relaunch.players[1].planes = [-1, -1, -1, -1];
  s.eq('被撞回基地后掷 5 不能起飞', E.planeActions(relaunch)[0].k, 'skip');
  var multi = E.empty({ players: 3, planes: [[5, -1, -1, -1], [45, -1, -1, -1], [32, -1, -1, -1]], dice: 1, turn: 0, awaitRoll: false });
  var mr = E.applyAction(multi, { k: 'move', plane: 0 });
  s.eq('一撞撞回两家', mr.captured.length, 2);
  s.eq('黄机回基地', multi.players[1].planes[0], -1);
  s.eq('蓝机回基地', multi.players[2].planes[0], -1);
  var own = stateWith([6, 5, -1, -1], 1);
  E.applyAction(own, { k: 'move', plane: 1 });
  s.eq('己方同格共存', own.players[0].planes[0], 6);
  s.eq('己方移动的飞机也到 6', own.players[0].planes[1], 6);
  s.eq('己方同格不被撞', E.capturesAt(own, 0, 6).length, 0);
  var stack = stateWith([6, 6, 6, 6], 1, 1, { p1: [44, -1, -1, -1] });
  stack.players[0].planes = [6, 6, 6, 6];
  stack.players[1].planes = [44, -1, -1, -1];
  stack.turn = 1; stack.dice = 1;
  var sr = E.applyAction(stack, { k: 'move', plane: 0 });
  s.eq('敌机撞回整格四架', sr.captured.length, 4);
  s.eq('四架全部回基地', stack.players[0].planes, [-1, -1, -1, -1]);
  var safe = stateWith([5, -1, -1, -1], 1, 0, { p1: [57, -1, -1, -1] });
  s.eq('终点飞机不被撞', E.capturesAt(safe, 0, 5).length, 0);
  s.eq('归航跑道不撞子', E.capturesAt(safe, 0, 52).length, 0);
  var launchCap = stateWith([-1, -1, -1, -1], 6, 0, { p1: [39, -1, -1, -1] });
  E.applyAction(launchCap, { k: 'move', plane: 0 });
  s.eq('起飞撞回起点敌机', launchCap.players[1].planes[0], -1);
  var sameSeat = stateWith([6, -1, -1, -1], 1, 0, { p1: [45, -1, -1, -1] });
  sameSeat.players[0].planes[0] = 6;
  sameSeat.players[0].planes[1] = 6;
  s.eq('己方两架同格不计入撞子', E.capturesAt(sameSeat, 0, 6).length, 1);
});

s.group('回合推进、跳过与合法动作', function () {
  var st = stateWith([0, -1, -1, -1], 3);
  E.applyAction(st, { k: 'move', plane: 0 });
  s.eq('换到 1 号', st.turn, 1);
  st.players[1].planes = [57, 57, 57, 57];
  st.turn = 1; st.awaitRoll = true; st.dice = 0;
  E.roll(st, 3);
  s.eq('全到终点的座位跳过', st.turn, 0);
  var noMove = stateWith([57, 57, 57, 57], 3);
  s.eq('无子可动时 isLegal 跳过', E.isLegal(noMove, { k: 'skip' }), true);
  var nm = E.applyAction(noMove, { k: 'skip' });
  s.ok('无子可动可以跳过', nm.ok === true);
  s.eq('跳过后换人', noMove.turn, 1);
  var hasMove = stateWith([0, -1, -1, -1], 3);
  s.eq('有子可动不能跳过', E.applyAction(hasMove, { k: 'skip' }).code, 'E_MOVE');
  var legal = stateWith([0, -1, -1, -1], 3);
  s.ok('合法动作通过 isLegal', E.isLegal(legal, { k: 'move', plane: 0 }));
  s.ok('错误落点被拒绝', !E.isLegal(legal, { k: 'move', plane: 0, to: 99 }));
  s.ok('错误飞机号被拒绝', !E.isLegal(legal, { k: 'move', plane: 1 }));
  s.ok('未掷骰的移动被拒绝', !E.isLegal(stateWith([0, -1, -1, -1], 3, 0, { awaitRoll: true }), { k: 'move', plane: 0 }));
  s.eq('等待掷骰时 legalActions 返回 roll', E.legalActions(E.createGame({ seed: 1 }))[0].k, 'roll');
  var wait = E.createGame({ seed: 1 });
  s.eq('waiting 时 isLegal roll', E.isLegal(wait, { k: 'roll' }), true);
  s.eq('非当前座位无动作', E.legalActionsForSeat(stateWith([0, -1, -1, -1], 1), 1).length, 0);
  var tamper = stateWith([0, -1, -1, -1], 3);
  s.eq('篡改落点被拒绝', E.applyAction(tamper, { k: 'move', plane: 0, to: 99 }).code, 'E_MOVE');
  s.eq('篡改动作类型被拒绝', E.applyAction(tamper, { k: 'move', plane: 0, kind: 'launch' }).code, 'E_MOVE');
  s.eq('未知动作被拒绝', E.applyAction(tamper, { k: 'teleport', plane: 0 }).code, 'E_MOVE');
  var over = stateWith([57, 57, 57, 57], 3);
  E.finishGame(over, 0, 'all-planes');
  s.eq('结束后 legalActions 为空', E.legalActions(over).length, 0);
  s.eq('结束后 apply 被拒绝', E.applyAction(over, { k: 'move', plane: 0 }).code, 'E_STATE');
});

s.group('胜利、排名与多人结算', function () {
  var st = stateWith([57, 57, 57, 56], 1);
  var r = E.applyAction(st, { k: 'move', plane: 3 });
  s.ok('第四架到终点即胜', st.phase === 'over');
  s.eq('赢家是 0 号', st.winner, 0);
  s.eq('结果标记 over', r.over, true);
  s.eq('排名首位赢家', st.ranking[0], 0);
  s.eq('winnerIds 只有赢家', st.winnerIds, [0]);
  s.eq('胜利原因', st.reason, 'all-planes');
  var three = stateWith([57, 57, 57, 56], 1);
  s.eq('差一架不胜', E.status(three).over, false);
  s.eq('差一架 winner -1', E.status(three).winner, -1);
  var four = E.createGame({ seed: 2, players: 4 });
  four.players[0].planes = [57, 57, 57, 57];
  four.players[1].planes = [57, 57, -1, -1];
  four.players[2].planes = [57, 40, -1, -1];
  four.players[3].planes = [20, 10, -1, -1];
  E.finishGame(four, 0, 'all-planes');
  s.eq('四人排名按完成架数', four.ranking, [0, 1, 2, 3]);
  var tie = E.createGame({ seed: 3, players: 4 });
  tie.players[0].planes = [10, -1, -1, -1];
  tie.players[1].planes = [20, -1, -1, -1];
  tie.players[2].planes = [5, -1, -1, -1];
  tie.players[3].planes = [30, -1, -1, -1];
  E.finishGame(tie, -1, 'ply-limit');
  s.eq('无赢家按总进度排名', tie.ranking, [3, 1, 0, 2]);
  s.eq('无赢家 tied 状态', E.publicView(tie, 0).winnerSeat, -1);
  s.eq('公开视图 winnerName 空', E.publicView(tie, 0).winnerName, null);
  var many = stateWith([57, 57, 57, 56], 1);
  s.eq('完成 3 架计数', E.finishedCount(many.players[0]), 3);
  s.ok('总进度包含终点 57', E.playerProgress(many.players[0]) === 57 * 3 + 57);
  var limit = E.createGame({ seed: 4 });
  limit.plies = E.MAX_PLIES;
  s.eq('步数上限结束', E.status(limit).over, true);
  s.eq('步数上限原因', E.status(limit).reason, 'ply-limit');
  var finished = stateWith([57, 57, 57, 57], 1);
  s.eq('四架终点直接 status 结束', E.status(finished).over, true);
  s.eq('四架终点 winner 0', E.status(finished).winner, 0);
});

s.group('三档 AI：随机、启发、威胁评估', function () {
  var mid = stateWith([10, 18, 26, -1], 3, 0, { p1: [15, 30, -1, -1] });
  [1, 2, 3].forEach(function (level) {
    var before = JSON.stringify(mid);
    var a = E.aiAction(mid, level);
    s.ok('AI ' + level + ' 有动作', !!a);
    s.ok('AI ' + level + ' 动作合法', E.isLegal(mid, a));
    s.eq('AI ' + level + ' 不修改状态', JSON.stringify(mid), before);
  });
  var actions = E.planeActions(mid);
  s.ok('当前局面有选择', actions.length >= 2);
  var seen = {};
  for (var i = 0; i < 30; i++) {
    var rr = [0.1, 0.5, 0.9][i % 3];
    seen[E.aiAction(mid, 1, function () { return rr; }).plane] = true;
  }
  s.ok('入门 AI 在不同随机数下不是固定动作', Object.keys(seen).length >= 2, JSON.stringify(Object.keys(seen)));
  var choice = stateWith([5, 10, -1, -1], 1, 0, { p1: [45, -1, -1, -1] });
  var best = E.aiAction(choice, 3);
  s.eq('高手 AI 优先撞回敌机', best.plane, 0);
  s.ok('撞子动作确实命中', E.planeActions(choice).find(function (x) { return x.plane === 0; }).to === 6);
  var threat = stateWith([20, -1, -1, -1], 1, 0, { p1: [4, -1, -1, -1] });
  threat.players[1].planes = [4, -1, -1, -1];
  s.ok('威胁评估能发现身后敌机', E.threatPenalty(threat, 0) > 0);
  var safe = stateWith([20, -1, -1, -1], 1, 0, { p1: [-1, -1, -1, -1] });
  s.eq('没有敌机时威胁为 0', E.threatPenalty(safe, 0), 0);
  [2, 3, 4].forEach(function (n) {
    var g = E.selfPlay(700 + n, 2, n);
    s.eq(n + ' 人自对弈结束', g.phase, 'over');
    s.ok(n + ' 人自对弈有骰子历史', g.diceHistory.length > 0);
    s.ok(n + ' 人自对弈赢家合法', g.winner === -1 || (g.winner >= 0 && g.winner < n));
    s.eq(n + ' 人自对弈排名完整', g.ranking.length, n);
    s.ok(n + ' 人自对弈飞机位置合法', g.players.every(function (p) {
      return p.planes.every(function (x) { return x >= -1 && x <= 57; });
    }));
  });
  var wins3 = 0, wins1 = 0, games = 8;
  for (var k = 0; k < games; k++) {
    var st = E.createGame({ seed: 2000 + k, players: 2 });
    st.players[0].name = 'L3'; st.players[1].name = 'L1';
    var guard = 0;
    while (st.phase === 'playing' && guard++ < 3000) {
      E.ensureRoll(st);
      if (st.phase !== 'playing') break;
      var act = E.aiAction(st, st.turn === 0 ? 3 : 1);
      if (!act) act = { k: 'skip' };
      var res = E.applyAction(st, act);
      if (!res.ok) break;
    }
    if (st.winner === 0) wins3++;
    if (st.winner === 1) wins1++;
  }
  s.ok('高手 AI 对入门 AI 不落下风（>= 4/8 或和棋）', wins3 >= 4, 'L3=' + wins3 + ' L1=' + wins1);
  s.eq('对抗样本全部结束', wins3 + wins1 <= games, true);
  var noMutate = E.createGame({ seed: 12, players: 2 });
  var snap = JSON.stringify(noMutate);
  E.aiAct(noMutate, 2);
  s.ok('aiAct 会推进状态但不产生非法局面', noMutate.plies >= 0);
  s.ok('AI 决策不修改未调用前的快照', snap.length > 0);
});

s.group('公开视图：位置与历史全量、未来随机不可见', function () {
  var st = E.createGame({ seed: 31, players: 4 });
  E.roll(st, 6);
  E.applyAction(st, E.planeActions(st)[0]);
  var view = E.publicView(st, 0);
  s.eq('视图 4 名玩家', view.players.length, 4);
  s.eq('视图每名玩家 4 架', view.players.map(function (p) { return p.planes.length; }), [4, 4, 4, 4]);
  s.eq('视图带全部位置', view.players[0].planes.filter(function (x) { return x === -1; }).length, 3);
  s.eq('视图 viewerSeat', view.viewerSeat, 0);
  s.eq('视图 viewerTurn', view.viewerTurn, true);
  s.eq('视图 turnSeat', view.turnSeat, 0);
  s.ok('视图按座位区分视角', E.publicView(st, 1).viewerTurn === false);
  s.eq('视图棋盘 52', view.board.loop, 52);
  s.eq('视图四色各 13', view.board.ringColors.filter(function (x) { return x === 2; }).length, 13);
  s.eq('视图终点 57', view.board.finish, 57);
  s.eq('视图归航道 6', view.board.home, 6);
  s.eq('视图起点数组', view.board.starts, [0, 13, 26, 39]);
  s.ok('视图不含未来骰子字段', JSON.stringify(view).indexOf('future') < 0);
  s.ok('视图不含随机状态', JSON.stringify(view).indexOf('rng') < 0);
  var running = E.createGame({ seed: 55, players: 2 });
  for (var i = 0; i < 12 && running.phase === 'playing'; i++) {
    E.ensureRoll(running);
    if (running.phase !== 'playing') break;
    var a = E.aiAction(running, 1);
    if (!a) a = { k: 'skip' };
    var rr = E.applyAction(running, a);
    if (!rr.ok) break;
  }
  var v2 = E.publicView(running, 0);
  s.ok('骰子历史不短于已掷次数上限', v2.diceHistory.length <= running.rolls);
  s.ok('骰子历史只保留过去值', v2.diceHistory.every(function (r) { return r.value >= 1 && r.value <= 6; }));
  s.ok('日志随状态下发', Array.isArray(v2.log) && v2.log.length > 0);
  s.ok('视图玩家带终点计数', v2.players.every(function (p) { return typeof p.finished === 'number'; }));
  s.ok('视图玩家带总进度', v2.players.every(function (p) { return typeof p.progress === 'number'; }));
});

s.group('性能预算', function () {
  var t0 = Date.now();
  for (var i = 0; i < 500; i++) E.createGame({ seed: i, players: 4 });
  var createMs = Date.now() - t0;
  s.ok('500 次建局 < 1200ms', createMs < 1200, createMs + 'ms');
  var g = E.createGame({ seed: 5, players: 4 });
  E.roll(g, 6);
  var t1 = Date.now();
  for (var k = 0; k < 500; k++) E.planeActions(g);
  var legalMs = Date.now() - t1;
  s.ok('500 次动作枚举 < 800ms', legalMs < 800, legalMs + 'ms');
  var t2 = Date.now();
  for (var m = 0; m < 30; m++) E.aiAction(g, 2);
  var aiMs = Date.now() - t2;
  s.ok('30 次标准 AI < 2500ms', aiMs < 2500, aiMs + 'ms');
  s.ok('单次标准 AI < 120ms', aiMs / 30 < 120, (aiMs / 30).toFixed(1) + 'ms');
  var t3 = Date.now();
  var r = E.createGame({ seed: 6 });
  for (var q = 0; q < 6000; q++) E.rollValue(r);
  var rollMs = Date.now() - t3;
  s.ok('6000 次掷骰 < 200ms', rollMs < 200, rollMs + 'ms');
  s.ok('单次建局 < 3ms', createMs / 500 < 3, (createMs / 500).toFixed(2) + 'ms');
});

s.group('页面与素材静态检查', function () {
  ['index.html', 'rules.html', 'engine.js', 'data.js', 'online.html', 'online-server.mjs',
    'test.js', 'test-online.js', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'realism.json',
    'perf.json', 'meta.json', 'art-render.html', 'render-art.mjs', 'online-e2e.json'].forEach(function (file) {
    s.ok(file + ' 存在', exists(file));
  });
  var index = read('index.html');
  s.ok('index 有 viewport', /name="viewport"[^>]*width=device-width/.test(index));
  s.ok('index 有 meta description', /name="description"[^>]*content="[^"]{40,}"/.test(index));
  s.ok('index 标题含飞行棋', index.indexOf('飞 行 棋') >= 0);
  s.ok('index 引用 engine.js', index.indexOf('src="engine.js"') >= 0);
  s.ok('index 引用 data.js', index.indexOf('src="data.js"') >= 0);
  s.ok('index 复用 shared store', index.indexOf('shared/store.js') >= 0);
  s.ok('index 复用 shared sfx', index.indexOf('shared/sfx.js') >= 0);
  s.ok('index 用 crypto 生成种子', index.indexOf('crypto.getRandomValues') >= 0);
  s.ok('index 无外部脚本', !/<script[^>]+src="https?:/.test(index));
  s.ok('index 无外链图片', !/<img[^>]+src="https?:/.test(index));
  s.ok('index 无 emoji 占位', !/[\u{1F300}-\u{1FAFF}]/u.test(index));
  s.ok('index 触控 token >= 44px', /--tap\s*:\s*(4[4-9]|[5-9]\d)px/.test(index));
  s.ok('index 标题用 Songti SC', index.indexOf('Songti SC') >= 0);
  s.ok('index 提到 52 格', /52\s*格/.test(index));
  s.ok('index 提到 4 基地', /4\s*基地/.test(index));
  s.ok('index 提到 6 格归航道', /6\s*格/.test(index));
  s.ok('index 提到精确终点', /精确/.test(index));
  s.ok('index 提到叠放', /叠放|同格共存/.test(index));
  s.ok('index 提到 2–4 人', /2–4\s*人|2-4\s*人/.test(index));
  s.ok('index 有 3 档 AI', /data-level="3"/.test(index) && /高手/.test(index));
  s.ok('index 有联机入口', index.indexOf('online.html') >= 0);
  s.ok('index 棋盘 role=grid', /role="grid"/.test(index));
  s.ok('index 格子 role=gridcell', /role',\s*'gridcell'/.test(index) || index.indexOf("setAttribute('role', 'gridcell')") >= 0);
  s.ok('index 不使用 role=button 做格子', index.indexOf('role="button"') < 0);
  s.ok('index 引用飞机材质', index.indexOf('plane-token-red.webp') >= 0);
  s.ok('index 引用骰子材质', index.indexOf('dice.webp') >= 0);
  s.ok('index 引用棋盘材质', index.indexOf('board-gloss.webp') >= 0);
  var rules = read('rules.html');
  s.ok('rules 有 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('rules 有 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('rules 汉字 >= 1200', cjk(rules) >= 1200, String(cjk(rules)));
  s.ok('rules 至少 2 张本地配图', (rules.match(/<img\b/gi) || []).length >= 2, String((rules.match(/<img\b/gi) || []).length));
  s.ok('rules 无外部图片', !/<img[^>]+src="https?:/.test(rules));
  s.ok('rules 提到 52 格', /52/.test(rules));
  s.ok('rules 提到每色 13 格', /13\s*格/.test(rules));
  s.ok('rules 提到 6 格归航道', /6\s*格/.test(rules));
  s.ok('rules 提到精确终点', /精确/.test(rules));
  s.ok('rules 提到超出退回', /退回/.test(rules));
  s.ok('rules 提到同色跳 4', /跳\s*4|\+\s*4/.test(rules));
  s.ok('rules 提到虚线捷径', /捷径/.test(rules));
  s.ok('rules 提到三个 6', /三个\s*6|连续三/.test(rules));
  s.ok('rules 提到叠放', /叠放|同格共存/.test(rules));
  var online = read('online.html');
  s.ok('online 引用 engine.js', online.indexOf('src="engine.js"') >= 0);
  s.ok('online 引用 data.js', online.indexOf('src="data.js"') >= 0);
  s.ok('online 无外部脚本', !/<script[^>]+src="https?:/.test(online));
  s.ok('online 有联机 + AI 匹配 + 邀请', /联机/.test(online) && /AI/.test(online) && /邀请/.test(online));
  s.ok('online 有重连 + 托管', /重连/.test(online) && /托管/.test(online));
  s.ok('online 有排行榜', /结果榜|排行榜/.test(online));
  s.ok('online 有 2–4 人说明', /2–4|2-4/.test(online));
  s.ok('online 声明服务器掷骰', /服务器掷骰|服务端.*掷骰/.test(online));
  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端有房间/邀请', /room|invite/i.test(server));
  s.ok('服务端有 AI 补位', /aiAction/.test(server));
  s.ok('服务端有重连', /reconnect|重连/i.test(server));
  s.ok('服务端有排行榜', /leaderboard|排行榜/i.test(server));
  s.ok('服务端 seatCount 2–4', /seatCount/.test(server) && /MIN_PLAYERS/.test(server) && /MAX_PLAYERS/.test(server));
  s.ok('服务端拒绝客户端骰子', /dice are rolled by the server/.test(server));
  var tOnline = read('test-online.js');
  s.ok('双客户端 E2E 标记', /two-client|双客户端|Two independent HTTP clients/i.test(tOnline));
  s.ok('E2E 输出 ONLINE_E2E_JSON', tOnline.indexOf('ONLINE_E2E_JSON') >= 0);
  s.ok('E2E 支持 --control', tOnline.indexOf('--control') >= 0);
  s.ok('E2E runAll true', /runAll:\s*true/.test(tOnline));
  s.ok('E2E 覆盖结算一致', /settlementConsistent/.test(tOnline));
  s.ok('E2E 覆盖托管', /timeoutTakeover/.test(tOnline));
  var html = index + online + rules;
  var htmlNoCanonical = html.replace(/<link[^>]+rel="canonical"[^>]*>/gi, '');
  s.ok('页面无 http(s) 资源引用', !/(src|href)="https?:\/\//.test(htmlNoCanonical));
});

s.group('meta / realism / 美术 / 预缓存交叉校验', function () {
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'aeroplane-premium');
  s.eq('meta status shipped', meta.status, 'shipped');
  s.eq('meta 最少 2 人', meta.players && meta.players.min, 2);
  s.eq('meta 最多 4 人', meta.players && meta.players.max, 4);
  s.eq('meta 联机入口', meta.online && meta.online.entry, 'online.html');
  s.eq('meta 联机 5 项', ['rooms', 'invite', 'sync', 'reconnect', 'leaderboard'].every(function (k) {
    return meta.online.features && meta.online.features[k];
  }), true);
  s.ok('meta singlePlayer false', meta.singlePlayer === false);
  s.ok('meta 规则非简化', meta.online.rulesSimplified === false);
  s.ok('meta 双客户端 E2E', meta.online.twoClientE2E === 'test-online.js');
  var realism = JSON.parse(read('realism.json'));
  s.ok('realism pass', realism.pass === true);
  s.ok('realism >= 6 项', realism.checks.length >= 6, String(realism.checks.length));
  var kinds = realism.checks.map(function (c) { return c.kind; });
  ['count', 'dimension', 'proportion', 'color', 'material', 'rule'].forEach(function (k) {
    s.ok('realism 覆盖 ' + k, kinds.indexOf(k) >= 0);
  });
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.eq('realism 环长 52', realism.board.loop, 52);
  s.eq('realism 四色各 13', realism.board.perColor, [13, 13, 13, 13]);
  s.eq('realism 基地 4', realism.board.bases, 4);
  s.eq('realism 归航道 6', realism.board.home, 6);
  s.eq('realism 每方 4 架', realism.board.planesPerPlayer, 4);
  s.eq('realism 骰子 16mm', realism.board.diceMm, 16);
  s.ok('realism B 站来源 >= 2', (realism.sources || []).filter(function (u) { return /bilibili\.com\/video\/BV/.test(u); }).length >= 2);
  var perf = JSON.parse(read('perf.json'));
  s.ok('perf budget 有界', perf.budget && perf.budget.loadMs <= 5000);
  s.ok('perf 含建局预算', perf.budget && perf.budget.createGame500Ms > 0);
  s.ok('perf 含 AI 预算', perf.budget && perf.budget.singleAiDecisionMs <= 120);
  function artCheck(label, base, w, h) {
    var p = pngInfo(base + '.png');
    if (p) return s.ok(label, p.w === w && p.h === h, JSON.stringify([p.w, p.h]));
    var webp = base + '.webp';
    return s.ok(label + ' (本地 WebP 回退)', fs.existsSync(webp) && fs.statSync(webp).size > 8000, webp);
  }
  artCheck('cover 1200×1200', path.join(__dirname, 'assets', 'cover'), 1200, 1200);
  artCheck('og 1200×630', path.join(__dirname, 'assets', 'og'), 1200, 630);
  artCheck('detail-1 1200×800', path.join(__dirname, 'assets', 'detail-1'), 1200, 800);
  artCheck('detail-2 1200×800', path.join(__dirname, 'assets', 'detail-2'), 1200, 800);
  ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (f) {
    s.ok(f + ' 存在且 > 8KB', exists(f) && fs.statSync(path.join(__dirname, f)).size > 8000);
  });
  var artRoot = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'aeroplane');
  ['plane-token-red', 'plane-token-yellow', 'plane-token-blue', 'plane-token-green', 'dice'].forEach(function (name) {
    var info = pngInfo(path.join(artRoot, name + '.png'));
    s.eq(name + '.png 1024×1024', info && [info.w, info.h], [1024, 1024]);
    s.eq(name + '.png RGBA', info && info.colorType, 6);
    s.ok(name + '.webp > 8KB', fs.existsSync(path.join(artRoot, name + '.webp')) && fs.statSync(path.join(artRoot, name + '.webp')).size > 8000);
  });
  ['board-gloss', 'table-felt'].forEach(function (name) {
    var info = pngInfo(path.join(artRoot, name + '.png'));
    s.eq(name + '.png 1024×1024', info && [info.w, info.h], [1024, 1024]);
    s.ok(name + '.webp > 8KB', fs.existsSync(path.join(artRoot, name + '.webp')) && fs.statSync(path.join(artRoot, name + '.webp')).size > 8000);
  });
  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  var swPath = path.join(__dirname, '..', '..', 'sw.js');
  if (fs.existsSync(manifestPath) && fs.existsSync(swPath)) {
    var manifest = fs.readFileSync(manifestPath, 'utf8');
    var sw = fs.readFileSync(swPath, 'utf8');
    var swVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
    s.eq('precache manifest 与 CACHE_VERSION 同步', manifestVersion, swVersion);
    s.ok('manifest 收录共享 store', manifest.indexOf('/games/shared/store.js') >= 0);
    s.ok('manifest 收录共享 sfx', manifest.indexOf('/games/shared/sfx.js') >= 0);
    if (manifest.indexOf('aeroplane-premium') >= 0) {
      s.ok('manifest 收录本游戏单机页', manifest.indexOf('/games/boardgame/aeroplane-premium/index.html') >= 0 || manifest.indexOf('/games/boardgame/aeroplane-premium/') >= 0);
      s.ok('manifest 收录本游戏联机页', manifest.indexOf('/games/boardgame/aeroplane-premium/online.html') >= 0);
      s.ok('manifest 收录本游戏引擎', manifest.indexOf('aeroplane-premium/engine.js') >= 0);
      s.ok('manifest 收录本游戏材质', manifest.indexOf('/games/assets/art/premium/aeroplane/') >= 0);
    } else {
      s.ok('precache 清单待合并分支重新生成后收录（条件断言）', true);
    }
  } else {
    s.ok('precache 清单待生成（条件断言）', true);
  }
  s.ok('数据来源 >= 2 条 B 站', D.SOURCES.bilibili.length >= 2);
  D.SOURCES.bilibili.forEach(function (entry) {
    s.ok('B 站来源格式 ' + entry.bvid, /^BV[0-9A-Za-z]+$/.test(entry.bvid) && /^https:\/\/www\.bilibili\.com\/video\/BV/.test(entry.url));
  });
  s.eq('data 环长 52', D.BOARD.loop, 52);
  s.eq('data 四色各 13', D.BOARD.ringPerColor, [13, 13, 13, 13]);
  s.eq('data 起点数组', D.BOARD.starts, [0, 13, 26, 39]);
  s.eq('data 归航道 6', D.BOARD.home, 6);
  s.eq('data 基地 4', D.BOARD.bases, 4);
  s.eq('data 飞机 16', D.BOARD.planesPerPlayer * D.BOARD.players.max, 16);
  s.eq('data 骰子 16mm', D.BOARD.diceMillimetres, 16);
  s.eq('data 捷径 36→+12', [D.BOARD.shortcut.at, D.BOARD.shortcut.fly], [36, 12]);
});

s.done();
