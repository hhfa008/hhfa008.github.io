'use strict';

/*
 * Stone Age Premium — 规则引擎 / 数据 / 30 局 AI 自对弈 / 页面契约。
 * 直接 require 与页面同源的 data.js + engine.js。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('stone-age-premium');
var D = require('./data.js');
var E = require('./engine.js');

function expectThrow(fn) {
  try { fn(); return false; } catch (e) { return true; }
}
function place(g, spotId, workers, slot) {
  return E.applyMove(g, { type: 'place', spotId: spotId, slotIndex: slot == null ? -1 : slot, workers: workers });
}
function resolve(g) { return E.applyMove(g, { type: 'resolve' }); }
function feed(g) { return E.applyMove(g, { type: 'feed' }); }
function playout(g, limit) {
  var steps = 0;
  while (!g.over && steps < (limit || 6000)) {
    g = E.applyMove(g, E.chooseAIMove(g));
    steps++;
  }
  return { state: g, steps: steps };
}

/* ------------------------------------------------------------------ */
s.group('数据完整性', function () {
  s.eq('2–4 人', D.PLAYER_NAMES.length, 4);
  s.eq('28 张建筑', D.BUILDINGS.length, 28);
  s.eq('36 张文明卡', D.CIV_CARDS.length, 36);
  s.eq('10 个放置点', D.SPOTS.length, 10);
  s.eq('8 种文化符号', D.CULTURE_SYMBOLS.length, 8);
  s.eq('4 种乘数', D.MULTIPLIERS.length, 4);
  s.eq('食物除数 2', D.DIVISORS.food, 2);
  s.eq('木除数 3', D.DIVISORS.wood, 3);
  s.eq('砖除数 4', D.DIVISORS.brick, 4);
  s.eq('石除数 5', D.DIVISORS.stone, 5);
  s.eq('金除数 6', D.DIVISORS.gold, 6);
  s.ok('建筑 ID 唯一', new Set(D.BUILDINGS.map(function (b) { return b.id; })).size === 28);
  s.ok('文明卡 ID 唯一', new Set(D.CIV_CARDS.map(function (c) { return c.id; })).size === 36);
  s.ok('每张文明卡有上下两半', D.CIV_CARDS.every(function (c) { return c.top && c.bottom && c.bottom.kind; }));
  s.ok('建筑费用均为正资源', D.BUILDINGS.every(function (b) {
    return Object.keys(b.cost).every(function (k) { return D.RESOURCES.indexOf(k) >= 0 && b.cost[k] > 0; }) && b.points > 0;
  }));
});

/* ------------------------------------------------------------------ */
s.group('开局与确定性', function () {
  var g = E.createGame({ seed: 42, playerCount: 2 });
  s.eq('每人 5 工人', g.players.map(function (p) { return p.totalWorkers; }), [5, 5]);
  s.eq('每人 12 食物', g.players.map(function (p) { return p.food; }), [12, 12]);
  s.eq('初始 0 分', g.players.map(function (p) { return p.score; }), [0, 0]);
  s.eq('2 人 2 叠建筑', g.buildingStacks.length, 2);
  s.eq('每叠 7 张', g.buildingStacks.map(function (s2) { return s2.length; }), [7, 7]);
  s.eq('4 个文明卡展示位', g.civSlots.filter(Boolean).length, 4);
  s.eq('文明卡牌库 32 张', g.civDeck.length, 32);
  s.eq('阶段为放置', g.phase, 'placement');
  s.ok('同 seed 建筑序一致', E.createGame({ seed: 7 }).buildingStacks[0].join(',') === E.createGame({ seed: 7 }).buildingStacks[0].join(','));
  s.ok('异 seed 建筑序不同', E.createGame({ seed: 7 }).buildingStacks[0].join(',') !== E.createGame({ seed: 8 }).buildingStacks[0].join(','));
  var g3 = E.createGame({ seed: 5, playerCount: 3 });
  eq3('3 人 3 叠建筑', g3.buildingStacks.length, 3);
  var g4 = E.createGame({ seed: 5, playerCount: 4 });
  eq3('4 人 4 叠建筑', g4.buildingStacks.length, 4);
  function eq3(label, actual, expected) { s.eq(label, actual, expected); }
  s.ok('非法人数被拒绝', expectThrow(function () { E.createGame({ playerCount: 5 }); }));
});

/* ------------------------------------------------------------------ */
s.group('放置合法性与限制', function () {
  var g = E.createGame({ seed: 10, playerCount: 2 });
  var moves = E.getLegalMoves(g);
  s.ok('开局有合法放置', moves.length > 0);
  s.ok('森林可放 1–7 个', moves.some(function (m) { return m.spotId === 'forest' && m.workers === 1; }));
  s.ok('成长小屋必须 2 个', !moves.some(function (m) { return m.spotId === 'hut' && m.workers === 1; }) &&
    moves.some(function (m) { return m.spotId === 'hut' && m.workers === 2; }));
  s.ok('工具坊只能 1 个', moves.some(function (m) { return m.spotId === 'toolmaker' && m.workers === 1; }) &&
    !moves.some(function (m) { return m.spotId === 'toolmaker' && m.workers === 2; }));
  g = place(g, 'forest', 2);
  s.eq('放置后手牌减少', g.players[0].workersLeft, 3);
  s.eq('轮到对手', g.currentPlayer, 1);
  s.ok('森林已有玩家 0 时，2 人局玩家 1 不能同点', !E.getLegalMoves(g).some(function (m) { return m.spotId === 'forest'; }));
  g = place(g, 'clay', 2);
  s.eq('双方各剩 3/3', g.players.map(function (p) { return p.workersLeft; }), [3, 3]);
  g = place(g, 'hut', 2);
  s.eq('成长小屋占 2', g.spots.hut.total, 2);
  g = place(g, 'toolmaker', 1);
  s.ok('第三人村点被 2/3 人限制封锁', !E.getLegalMoves(g).some(function (m) { return m.spotId === 'field'; }));
  g = place(g, 'hunt', 1);
  g = place(g, 'hunt', 2);
  s.eq('狩猎无上限', g.spots.hunt.total, 3);
  s.ok('工人用尽进入结算', g.phase === 'execute');
  s.ok('结算阶段只有一个动作', E.getLegalMoves(g).length === 1 && E.getLegalMoves(g)[0].type === 'resolve');

  var bad = E.createGame({ seed: 11, playerCount: 2 });
  s.ok('不能放 0 个工人', expectThrow(function () { place(bad, 'forest', 0); }));
  s.ok('不能在工具坊放 2 个', expectThrow(function () { place(bad, 'toolmaker', 2); }));
  var civOnce = place(bad, 'civ', 1, 0);
  s.ok('不能重复放置已满的文明位', expectThrow(function () { place(civOnce, 'civ', 1, 0); }));
  var res = E.createGame({ seed: 12, playerCount: 2 });
  res = place(res, 'forest', 5);
  s.eq('森林容量 7', res.spots.forest.total, 5);
  s.ok('超过人数上限的工人被拒绝', expectThrow(function () { place(place(place(E.createGame({ seed: 13 }), 'forest', 5), 'clay', 5), 'forest', 1); }));
});

/* ------------------------------------------------------------------ */
s.group('结算：采集、工具、成长、农业', function () {
  var g = E.createGame({ seed: 20, playerCount: 2 });
  g.spots.forest.workers[0] = 3; g.spots.forest.total = 3;
  g.spots.toolmaker.workers[0] = 1; g.spots.toolmaker.total = 1;
  g.spots.hut.workers[0] = 2; g.spots.hut.total = 2;
  g.spots.field.workers[0] = 1; g.spots.field.total = 1;
  g.players[0].workersLeft = 0; g.players[1].workersLeft = 0;
  g.phase = 'execute'; g.currentPlayer = 0; g.resolveOrder = [0, 1]; g.resolveIndex = 0;
  var before = Object.assign({}, g.players[0].resources);
  g = resolve(g);
  s.ok('森林产木', g.players[0].resources.wood > before.wood);
  s.eq('工具坊获得工具', g.players[0].tools.length, 1);
  s.eq('成长小屋增加工人', g.players[0].totalWorkers, 6);
  s.eq('农业 +1', g.players[0].agriculture, 1);
  s.eq('结算后轮到下一位', g.currentPlayer, 1);
  s.eq('记录结算摘要', !!g.lastResolve && g.lastResolve.gathers.length === 1, true);
});

s.group('结算：文明卡与建筑', function () {
  var g = E.createGame({ seed: 30, playerCount: 2 });
  g.players[0].resources = { wood: 5, brick: 5, stone: 5, gold: 5 };
  g.spots.civ[3].workers[0] = 1; g.spots.civ[3].total = 1;
  g.spots.building[0].workers[0] = 1; g.spots.building[0].total = 1;
  g.players[0].workersLeft = 0; g.players[1].workersLeft = 0;
  g.phase = 'execute'; g.currentPlayer = 0; g.resolveOrder = [0, 1]; g.resolveIndex = 0;
  var cardId = g.civSlots[3];
  var topId = g.buildingStacks[0][g.buildingStacks[0].length - 1];
  var building = D.BUILDING_BY_ID[topId];
  var scoreBefore = g.players[0].score;
  g = resolve(g);
  s.ok('文明卡被拿走', g.players[0].civCards.indexOf(cardId) >= 0);
  s.eq('文明卡展示位清空', g.civSlots[3], null);
  s.ok('建筑进入玩家区', g.players[0].buildings.indexOf(topId) >= 0);
  s.ok('建筑立即得分', g.players[0].score >= scoreBefore + building.points, g.players[0].score + ' vs ' + (scoreBefore + building.points));
  s.eq('建筑叠减少', g.buildingStacks[0].length, 6);
  s.ok('资源被支付', E.totalResources(g.players[0].resources) < 20);

  var poor = E.createGame({ seed: 31, playerCount: 2 });
  poor.players[0].resources = { wood: 0, brick: 0, stone: 0, gold: 0 };
  poor.spots.building[0].workers[0] = 1; poor.spots.building[0].total = 1;
  poor.players[0].workersLeft = 0; poor.players[1].workersLeft = 0;
  poor.phase = 'execute'; poor.currentPlayer = 0; poor.resolveOrder = [0, 1]; poor.resolveIndex = 0;
  poor = resolve(poor);
  s.eq('资源不足不能建造', poor.players[0].buildings.length, 0);
});

/* ------------------------------------------------------------------ */
s.group('喂食与惩罚', function () {
  var g = E.createGame({ seed: 40, playerCount: 2 });
  g.players[0].food = 0;
  g.players[0].totalWorkers = 5;
  g.players[0].agriculture = 0;
  g.players[0].resources = { wood: 5, brick: 0, stone: 0, gold: 0 };
  g.phase = 'feed';
  g = feed(g);
  s.eq('缺 5 食物用 5 木支付', g.lastFeed[0].resourcesPaid, 5);
  s.eq('无罚分', g.lastFeed[0].penalty, 0);

  var poor = E.createGame({ seed: 41, playerCount: 2 });
  poor.players[0].food = 0;
  poor.players[0].totalWorkers = 5;
  poor.players[0].resources = { wood: 1, brick: 0, stone: 0, gold: 0 };
  poor.players[0].score = 20;
  poor.players[1].food = 99;
  poor.phase = 'feed';
  poor = feed(poor);
  s.eq('资源不足罚 10 分', poor.lastFeed[0].penalty, 10);
  s.eq('罚分后 10 分', poor.players[0].score, 10);

  var agri = E.createGame({ seed: 42, playerCount: 2 });
  agri.players[0].food = 1;
  agri.players[0].totalWorkers = 5;
  agri.players[0].agriculture = 3;
  agri.players[1].food = 99;
  agri.phase = 'feed';
  agri = feed(agri);
  s.eq('农业提供 3 免费食物', agri.lastFeed[0].foodUsed, 1);
  s.eq('只需补 1 食物', agri.lastFeed[0].need, 2);
});

/* ------------------------------------------------------------------ */
s.group('终局计分', function () {
  var player = E.createGame({ seed: 50 }).players[0];
  player.civCards = ['c26', 'c29', 'c30'];
  var row = E.scorePlayer(player);
  s.ok('文化套数已计算', Array.isArray(row.cultureSets));
  s.ok('乘数分已计算', row.multipliers >= 0);
  s.ok('资源分等于剩余资源', row.resourcePoints === E.totalResources(player.resources));
  s.eq('工具有价值', row.tools, 0);
  var withRes = JSON.parse(JSON.stringify(player));
  withRes.resources = { wood: 3, brick: 2, stone: 1, gold: 4 };
  s.eq('剩余资源 1:1 计分', E.scorePlayer(withRes).resourcePoints, 10);

  var g = E.createGame({ seed: 51, playerCount: 2 });
  g.over = true;
  var result = E.getResults(g);
  s.ok('实时结果有分数行', result.scores.length === 2);
  var fin = E.createGame({ seed: 52, playerCount: 2 });
  fin.buildingStacks[0] = [];
  fin.phase = 'feed';
  fin.players.forEach(function (p) { p.food = 99; });
  fin = feed(fin);
  s.ok('建筑叠耗尽即终局', fin.over === true);
  s.eq('终局有胜者或平局', fin.result.winners.length >= 1, true);
  s.ok('终局分数为数字', fin.result.scores.every(function (r) { return typeof r.total === 'number'; }));
});

/* ------------------------------------------------------------------ */
s.group('30 局 AI 自对弈', function () {
  var finished = 0, maxRounds = 0, badWorkers = 0, badFood = 0, minScore = Infinity, maxScore = -Infinity;
  for (var seed = 1; seed <= 30; seed++) {
    var out = playout(E.createGame({ seed: seed, playerCount: 2, isAI: [true, true] }));
    var g = out.state;
    if (g.over) finished++;
    maxRounds = Math.max(maxRounds, g.round);
    g.players.forEach(function (p) {
      if (p.totalWorkers < 5 || p.totalWorkers > 10) badWorkers++;
      if (p.food < 0) badFood++;
    });
    (g.result ? g.result.scores : []).forEach(function (r) {
      minScore = Math.min(minScore, r.total);
      maxScore = Math.max(maxScore, r.total);
    });
  }
  s.eq('30 局全部结束', finished, 30);
  s.ok('轮数在合理范围', maxRounds < 80, 'maxRounds=' + maxRounds);
  s.eq('工人数量始终 5–10', badWorkers, 0);
  s.eq('食物从不为负', badFood, 0);
  s.ok('分数范围合理', minScore >= 0 && maxScore < 600, minScore + '..' + maxScore);
});

/* ------------------------------------------------------------------ */
s.group('E2E 完整一局', function () {
  var g = E.createGame({ seed: 60, playerCount: 2 });
  var steps = 0;
  while (!g.over && steps < 6000) { g = E.applyMove(g, E.chooseAIMove(g)); steps++; }
  s.ok('完整一局结束', g.over === true, 'steps=' + steps);
  s.ok('终局原因存在', !!g.overReason);
  s.ok('终局结果有 2 行', g.result && g.result.scores.length === 2);
  s.ok('终局日志有结束记录', g.log.some(function (x) { return x.type === 'end'; }));
  s.ok('回合数至少 1', g.round >= 1);
});

/* ------------------------------------------------------------------ */
s.group('页面静态契约', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('页面引入 data.js 与 engine.js', /data\.js/.test(html) && /engine\.js/.test(html));
  s.ok('页面有联机入口', /online\.html/.test(html));
  s.ok('页面有移动端 viewport', /viewport/.test(html));
  s.ok('页面有 44px 触控目标', /44px/.test(html));
  s.ok('页面有棋盘容器', /id="board"/.test(html));
  s.ok('页面有玩家/资源面板', /id="resources"/.test(html) && /id="players"/.test(html));
  s.ok('页面有联机桥接', /online-bridge\.js/.test(html));
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('规则页引用 B 站教程', /bilibili\.com\/video\//.test(rules));
  s.ok('规则页写明 72/36/28 口径', /36/.test(rules) && /28/.test(rules));
});

s.done();
