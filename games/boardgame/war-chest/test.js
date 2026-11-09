'use strict';

/*
 * War Chest（战争宝箱）简化版引擎测试。
 *
 *   node games/boardgame/war-chest/test.js
 *
 * 页面与测试共用同源 data.js / engine.js；这里直接 require 引擎，不复制规则。
 * 覆盖：数据契约、开局抽币与洗回、部署/移动/攻击合法性、据点控制、
 * 胜负与回合上限、AI 合法动作、50 局 AI 自对弈、页面静态约束。
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('war-chest');

var DATA = require('./data.js');
var E = require('./engine.js');

var PAGE = path.join(__dirname, 'index.html');
var RULES = path.join(__dirname, 'rules.html');

/* ------------------------------------------------------------------ */
/* 测试辅助                                                            */
/* ------------------------------------------------------------------ */

function fresh(seed) {
  return E.createGame({ seed: seed == null ? 1 : seed, aiPlayer: 1 });
}

// 覆盖手牌但保持币总数不变：多出的币从袋/弃币扣除，少了的币补进弃币。
function setHand(state, playerIndex, types) {
  var player = state.players[playerIndex];
  var delta = types.length - player.hand.length;
  var i;
  if (delta > 0) {
    for (i = 0; i < delta; i++) {
      if (player.bag.length) player.bag.pop();
      else if (player.discard.length) player.discard.pop();
    }
  } else if (delta < 0) {
    for (i = 0; i < -delta; i++) player.discard.push(player.hand[0]);
  }
  player.hand = types.slice();
}

// 直接摆一个单位（不经过部署检查），用于构造局面。
function putUnit(state, owner, type, r, c) {
  var unit = { id: state.nextUnitId++, owner: owner, type: type, r: r, c: c };
  state.units.push(unit);
  state.players[owner].reserves[type]--;
  return unit;
}

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function coinInvariant(state) {
  return state.players.every(function (player) { return E.coinTotal(player) === 14; });
}

function unitInvariant(state) {
  return state.players.every(function (player) {
    return DATA.UNIT_ORDER.every(function (type) {
      var onBoard = state.units.filter(function (unit) {
        return unit.owner === player.index && unit.type === type;
      }).length;
      return player.reserves[type] + onBoard === DATA.UNITS[type].count;
    });
  });
}

function boardInvariant(state) {
  var seen = {};
  return state.units.every(function (unit) {
    if (unit.r < 0 || unit.c < 0 || unit.r >= DATA.BOARD_SIZE || unit.c >= DATA.BOARD_SIZE) return false;
    var k = unit.r + ',' + unit.c;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function controlInvariant(state) {
  return state.players.every(function (player) {
    var derived = state.strongholds.filter(function (sh) { return sh.owner === player.index; }).length;
    return E.controlCount(state, player.index) === derived;
  });
}

function stateInvariant(state) {
  return coinInvariant(state) && unitInvariant(state) && boardInvariant(state) && controlInvariant(state);
}

/* ------------------------------------------------------------------ */
/* 1. 数据契约                                                         */
/* ------------------------------------------------------------------ */

s.group('数据：棋盘、据点与单位', function () {
  s.eq('棋盘为 7×7', DATA.BOARD_SIZE, 7);
  s.eq('控制 4 个据点获胜', DATA.WIN_STRONGHOLDS, 4);
  s.eq('每回合抽 3 枚币', DATA.HAND_DRAW, 3);
  s.eq('回合上限 100', DATA.MAX_TURNS, 100);
  s.eq('5 种单位', DATA.UNIT_ORDER.length, 5);
  s.eq('单位顺序与定义一致',
    DATA.UNIT_ORDER.slice().sort(), Object.keys(DATA.UNITS).sort());
  s.eq('单位名字', DATA.UNIT_ORDER.map(function (t) { return DATA.UNITS[t].name; }),
    ['步兵', '弓箭手', '骑兵', '斥候', '指挥官']);
  s.eq('单位数量分布', DATA.UNIT_ORDER.reduce(function (acc, t) {
    acc[t] = DATA.UNITS[t].count;
    return acc;
  }, {}), { infantry: 5, archer: 3, cavalry: 3, scout: 2, commander: 1 });
  s.eq('每方共 14 个单位', DATA.UNIT_ORDER.reduce(function (sum, t) {
    return sum + DATA.UNITS[t].count;
  }, 0), 14);

  DATA.UNIT_ORDER.forEach(function (type) {
    var u = DATA.UNITS[type];
    s.ok(type + ' 字段齐全', typeof u.name === 'string' && u.name.length > 0 &&
      typeof u.glyph === 'string' && u.glyph.length === 1 &&
      typeof u.desc === 'string' && u.desc.length > 0);
    s.ok(type + ' 移动 1–3', Number.isInteger(u.move) && u.move >= 1 && u.move <= 3, String(u.move));
    s.ok(type + ' 攻击距离 0–2', Number.isInteger(u.range) && u.range >= 0 && u.range <= 2, String(u.range));
    s.ok(type + ' 数量为正', Number.isInteger(u.count) && u.count > 0, String(u.count));
    s.ok(type + ' 价值为正', Number.isInteger(u.value) && u.value > 0, String(u.value));
    s.ok(type + ' 名称含中文', /[一-鿿]/.test(u.name));
  });
  s.eq('步兵 1 步 1 格', [DATA.UNITS.infantry.move, DATA.UNITS.infantry.range], [1, 1]);
  s.eq('弓箭手 2 格远程', [DATA.UNITS.archer.move, DATA.UNITS.archer.range], [1, 2]);
  s.eq('斥候 3 步不能攻击', [DATA.UNITS.scout.move, DATA.UNITS.scout.range], [3, 0]);
  s.eq('指挥官 2 步 1 格', [DATA.UNITS.commander.move, DATA.UNITS.commander.range], [2, 1]);

  s.eq('12 个据点', DATA.STRONGHOLDS.length, 12);
  s.eq('据点 ID 唯一', new Set(DATA.STRONGHOLDS.map(function (h) { return h.id; })).size, 12);
  s.eq('据点坐标唯一', new Set(DATA.STRONGHOLDS.map(function (h) { return h.r + ',' + h.c; })).size, 12);
  s.ok('据点均在棋盘内', DATA.STRONGHOLDS.every(function (h) {
    return h.r >= 0 && h.c >= 0 && h.r < DATA.BOARD_SIZE && h.c < DATA.BOARD_SIZE;
  }));
  s.eq('双方各 6 个据点', [0, 1].map(function (side) {
    return DATA.STRONGHOLDS.filter(function (h) { return h.side === side; }).length;
  }), [6, 6]);
  s.ok('据点不占中间行', DATA.STRONGHOLDS.every(function (h) { return h.r !== 3; }));
  s.ok('据点布局左右镜像', DATA.STRONGHOLDS.every(function (h) {
    return DATA.STRONGHOLDS.some(function (other) {
      return other.r === DATA.BOARD_SIZE - 1 - h.r && other.c === DATA.BOARD_SIZE - 1 - h.c;
    });
  }));
  s.eq('2 个大本营', DATA.BASES.length, 2);
  s.eq('大本营位置', DATA.BASES.map(function (b) { return [b.owner, b.r, b.c]; }),
    [[0, 6, 3], [1, 0, 3]]);
  s.ok('大本营不与据点重叠', DATA.BASES.every(function (b) {
    return !DATA.STRONGHOLDS.some(function (h) { return h.r === b.r && h.c === b.c; });
  }));
  s.eq('双方名称', DATA.PLAYER_NAMES, ['你', 'AI']);
  s.eq('双方颜色', DATA.PLAYER_COLORS.length, 2);
});

/* ------------------------------------------------------------------ */
/* 2. 开局与抽币                                                       */
/* ------------------------------------------------------------------ */

s.group('开局状态', function () {
  var state = fresh(7);
  s.eq('从玩家 0 开始', state.current, 0);
  s.eq('第 1 个玩家回合', state.turn, 1);
  s.ok('开局未结束', !state.over && state.result === null);
  s.eq('两名玩家', state.players.length, 2);
  s.eq('玩家 0 名字', state.players[0].name, '你');
  s.eq('玩家 1 是 AI', state.players[1].isAI, true);
  s.eq('玩家 0 手牌 3 枚', state.players[0].hand.length, 3);
  s.eq('玩家 0 袋中 11 枚', state.players[0].bag.length, 11);
  s.eq('玩家 0 弃币 0', state.players[0].discard.length, 0);
  s.eq('玩家 1 尚未抽币', state.players[1].hand.length, 0);
  s.eq('玩家 1 袋中 14 枚', state.players[1].bag.length, 14);
  s.ok('双方币总数都是 14', coinInvariant(state));
  s.eq('开局无单位', state.units.length, 0);
  s.eq('12 个据点全部中立', state.strongholds.filter(function (h) { return h.owner === null; }).length, 12);
  s.eq('双方据点数为 0', [E.controlCount(state, 0), E.controlCount(state, 1)], [0, 0]);
  s.ok('预备队满编', state.players.every(function (player) {
    return DATA.UNIT_ORDER.every(function (type) {
      return player.reserves[type] === DATA.UNITS[type].count;
    });
  }));
  s.ok('开局日志已记录', state.log.length >= 1);

  var sameA = fresh(99);
  var sameB = fresh(99);
  s.eq('同 seed 洗袋可复现', JSON.stringify(sameA.players), JSON.stringify(sameB.players));
  var diff = fresh(100);
  s.ok('不同 seed 手牌/袋不同',
    JSON.stringify(sameA.players[0].bag) !== JSON.stringify(diff.players[0].bag) ||
    JSON.stringify(sameA.players[0].hand) !== JSON.stringify(diff.players[0].hand));

  var aiFirst = E.createGame({ seed: 3, aiPlayer: 0 });
  s.eq('aiPlayer 0 时玩家 0 是 AI', aiFirst.players[0].isAI, true);
  s.eq('aiPlayer 0 时玩家 1 不是 AI', aiFirst.players[1].isAI, false);
});

s.group('抽币与洗回', function () {
  var state = fresh(11);
  var drawn = E.drawHand(state, 1);
  s.eq('给玩家 1 抽 3 枚', drawn.players[1].hand.length, 3);
  s.eq('抽后袋中 11 枚', drawn.players[1].bag.length, 11);
  s.eq('抽币不改变原局面', state.players[1].hand.length, 0);
  s.ok('抽币后币总数不变', coinInvariant(drawn));

  var wash = fresh(12);
  wash.players[0].hand = [];
  wash.players[0].bag = [];
  wash.players[0].discard = ['infantry', 'archer', 'cavalry', 'infantry'];
  var washed = E.drawHand(wash, 0);
  s.eq('袋空时抽到手牌 3 枚', washed.players[0].hand.length, 3);
  s.eq('洗回后袋中剩 1 枚', washed.players[0].bag.length, 1);
  s.eq('弃币堆被清空', washed.players[0].discard.length, 0);
  s.ok('洗回日志可读', washed.log.some(function (l) { return l.type === 'reshuffle'; }));

  var sparse = fresh(13);
  sparse.players[0].hand = [];
  sparse.players[0].bag = [];
  sparse.players[0].discard = ['scout', 'scout'];
  var partial = E.drawHand(sparse, 0);
  s.eq('袋和弃币不足时抽到手牌 2 枚', partial.players[0].hand.length, 2);
  s.eq('抽空后袋和弃币都为 0',
    [partial.players[0].bag.length, partial.players[0].discard.length], [0, 0]);

  var turn = fresh(14);
  var after = E.endTurn(turn);
  s.eq('结束回合后换人', after.current, 1);
  s.eq('回合数 +1', after.turn, 2);
  s.eq('玩家 0 手牌进弃币', after.players[0].hand.length, 0);
  s.eq('玩家 0 弃币 3 枚', after.players[0].discard.length, 3);
  s.eq('玩家 1 抽到 3 枚', after.players[1].hand.length, 3);
  s.ok('换人后币总数仍为 14', coinInvariant(after));

  var after2 = E.endTurn(after);
  s.eq('再结束回到玩家 0', after2.current, 0);
  s.eq('回合数到 3', after2.turn, 3);
  s.eq('玩家 0 重新抽 3 枚', after2.players[0].hand.length, 3);
});

/* ------------------------------------------------------------------ */
/* 3. 部署合法性                                                       */
/* ------------------------------------------------------------------ */

s.group('部署：合法格与拒绝原因', function () {
  var state = fresh(21);
  setHand(state, 0, ['infantry']);
  var cells = E.legalDeployCells(state, 'infantry', 0);
  s.eq('开局可部署格只有大本营及相邻平地', cells, [
    { r: 6, c: 2 }, { r: 6, c: 3 }, { r: 6, c: 4 }
  ]);
  s.ok('大本营格可以部署', E.canDeploy(state, 'infantry', 6, 3, 0).ok);
  s.ok('相邻平地可以部署', E.canDeploy(state, 'infantry', 6, 2, 0).ok);

  var onStronghold = E.canDeploy(state, 'infantry', 5, 3, 0);
  s.ok('不能直接部署到据点', !onStronghold.ok && /据点/.test(onStronghold.reason), onStronghold.reason);
  var far = E.canDeploy(state, 'infantry', 3, 3, 0);
  s.ok('远处空格拒绝', !far.ok && /相邻/.test(far.reason), far.reason);
  var enemyBase = E.canDeploy(state, 'infantry', 0, 3, 0);
  s.ok('敌方大本营拒绝', !enemyBase.ok && /大本营/.test(enemyBase.reason), enemyBase.reason);
  var wrongTurn = E.canDeploy(state, 'infantry', 6, 2, 1);
  s.ok('非当前玩家拒绝', !wrongTurn.ok && /轮到你/.test(wrongTurn.reason), wrongTurn.reason);

  var occupied = fresh(22);
  setHand(occupied, 0, ['infantry']);
  putUnit(occupied, 0, 'infantry', 6, 2);
  var occ = E.canDeploy(occupied, 'infantry', 6, 2, 0);
  s.ok('有单位的格子拒绝', !occ.ok && /已有单位/.test(occ.reason), occ.reason);

  var noCoin = fresh(23);
  setHand(noCoin, 0, []);
  var nc = E.canDeploy(noCoin, 'infantry', 6, 2, 0);
  s.ok('没有对应币拒绝', !nc.ok && /手里没有/.test(nc.reason), nc.reason);

  var noReserve = fresh(24);
  setHand(noReserve, 0, ['infantry']);
  noReserve.players[0].reserves.infantry = 0;
  var nr = E.canDeploy(noReserve, 'infantry', 6, 2, 0);
  s.ok('预备队为空拒绝', !nr.ok && /预备队/.test(nr.reason), nr.reason);

  var over = fresh(25);
  setHand(over, 0, ['infantry']);
  over.over = true;
  var ov = E.canDeploy(over, 'infantry', 6, 2, 0);
  s.ok('对局结束后拒绝', !ov.ok && /结束/.test(ov.reason), ov.reason);

  expectThrow('非法部署抛错', function () {
    E.deploy(state, 'infantry', 3, 3, 0);
  }, /相邻/);
});

s.group('部署：成功结算与占点后范围', function () {
  var state = fresh(26);
  setHand(state, 0, ['infantry']);
  var next = E.deploy(state, 'infantry', 6, 2, 0);
  s.eq('部署后场上 1 个单位', next.units.length, 1);
  s.eq('单位归属正确', next.units[0].owner, 0);
  s.eq('单位类型正确', next.units[0].type, 'infantry');
  s.eq('单位位置正确', [next.units[0].r, next.units[0].c], [6, 2]);
  s.eq('手牌花掉 1 枚', next.players[0].hand.length, 0);
  s.eq('单位币进入弃币', next.players[0].discard.filter(function (t) { return t === 'infantry'; }).length, 1);
  s.eq('预备队减 1', next.players[0].reserves.infantry, 4);
  s.eq('原局面未被修改', state.units.length, 0);
  s.ok('部署后仍满足单位守恒', unitInvariant(next));
  s.ok('部署后仍满足币守恒', coinInvariant(next));

  var held = fresh(27);
  setHand(held, 0, ['infantry']);
  held.strongholds.forEach(function (h) { if (h.id === 'h10') h.owner = 0; });
  var cells = E.legalDeployCells(held, 'infantry', 0);
  var keys = cells.map(function (c) { return c.r + ',' + c.c; });
  s.ok('已控据点上方可部署', keys.indexOf('5,2') !== -1, keys.join(' '));
  s.ok('已控据点下方可部署', keys.indexOf('5,4') !== -1, keys.join(' '));
  s.ok('不能部署到另一个据点', keys.indexOf('4,3') === -1, keys.join(' '));
  s.ok('己方大本营始终可部署', keys.indexOf('6,3') !== -1, keys.join(' '));

  var enemyHeld = fresh(28);
  setHand(enemyHeld, 0, ['infantry']);
  enemyHeld.strongholds.forEach(function (h) { if (h.id === 'h10') h.owner = 1; });
  s.ok('敌方据点旁不能部署', !E.canDeploy(enemyHeld, 'infantry', 5, 2, 0).ok);
});

/* ------------------------------------------------------------------ */
/* 4. 移动合法性                                                       */
/* ------------------------------------------------------------------ */

s.group('移动：步数、阻挡与结算', function () {
  var state = fresh(31);
  setHand(state, 0, ['infantry']);
  var infantry = putUnit(state, 0, 'infantry', 3, 3);
  s.ok('步兵 1 格移动合法', E.canMove(state, infantry.id, { r: 2, c: 3 }, 0).ok);
  var moved = E.moveUnit(state, infantry.id, { r: 2, c: 3 }, 0);
  s.eq('移动后位置更新', [moved.units[0].r, moved.units[0].c], [2, 3]);
  s.eq('移动花掉 1 枚币', moved.players[0].hand.length, 0);
  s.ok('移动后币进弃币', moved.players[0].discard.indexOf('infantry') !== -1);
  s.eq('原局面位置不变', [state.units[0].r, state.units[0].c], [3, 3]);

  var tooFar = E.canMove(state, infantry.id, { r: 1, c: 3 }, 0);
  s.ok('步兵不能走 2 格', !tooFar.ok && /移动范围|阻挡/.test(tooFar.reason), tooFar.reason);
  var diagonal = E.canMove(state, infantry.id, { r: 2, c: 2 }, 0);
  s.ok('不能斜走', !diagonal.ok && /移动范围|阻挡/.test(diagonal.reason), diagonal.reason);
  var same = E.canMove(state, infantry.id, { r: 3, c: 3 }, 0);
  s.ok('原地不算移动', !same.ok && /原地/.test(same.reason), same.reason);
  var outside = E.canMove(state, infantry.id, { r: 7, c: 3 }, 0);
  s.ok('越界拒绝', !outside.ok && /棋盘/.test(outside.reason), outside.reason);

  var blocked = fresh(32);
  setHand(blocked, 0, ['infantry']);
  var b1 = putUnit(blocked, 0, 'infantry', 3, 3);
  putUnit(blocked, 0, 'infantry', 2, 3);
  var blockedCheck = E.canMove(blocked, b1.id, { r: 1, c: 3 }, 0);
  s.ok('不能穿过单位', !blockedCheck.ok, blockedCheck.reason);
  var ontoUnit = E.canMove(blocked, b1.id, { r: 2, c: 3 }, 0);
  s.ok('不能停在有单位的格', !ontoUnit.ok && /已有单位/.test(ontoUnit.reason), ontoUnit.reason);

  var enemy = fresh(33);
  setHand(enemy, 0, ['infantry']);
  var e1 = putUnit(enemy, 0, 'infantry', 3, 3);
  putUnit(enemy, 1, 'infantry', 3, 4);
  var enemyCheck = E.canMove(enemy, e1.id, { r: 3, c: 4 }, 0);
  s.ok('不能移动到敌方单位格', !enemyCheck.ok && /已有单位/.test(enemyCheck.reason), enemyCheck.reason);

  var noCoin = fresh(34);
  setHand(noCoin, 0, []);
  var n1 = putUnit(noCoin, 0, 'infantry', 3, 3);
  var nc = E.canMove(noCoin, n1.id, { r: 2, c: 3 }, 0);
  s.ok('没有币不能移动', !nc.ok && /手里没有/.test(nc.reason), nc.reason);

  var wrongOwner = fresh(35);
  setHand(wrongOwner, 0, ['infantry']);
  var foe = putUnit(wrongOwner, 1, 'infantry', 3, 3);
  var wo = E.canMove(wrongOwner, foe.id, { r: 2, c: 3 }, 0);
  s.ok('不能操作敌方单位', !wo.ok && /敌方单位/.test(wo.reason), wo.reason);

  var fast = fresh(36);
  setHand(fast, 0, ['scout', 'cavalry']);
  var scout = putUnit(fast, 0, 'scout', 3, 3);
  var cavalry = putUnit(fast, 0, 'cavalry', 3, 5);
  s.ok('斥候可走 3 格', E.canMove(fast, scout.id, { r: 3, c: 0 }, 0).ok);
  s.ok('骑兵可走 2 格', E.canMove(fast, cavalry.id, { r: 1, c: 5 }, 0).ok);

  expectThrow('非法移动抛错', function () {
    E.moveUnit(state, infantry.id, { r: 1, c: 3 }, 0);
  }, /移动范围|阻挡/);
});

s.group('移动：占点、控制保留与大本营', function () {
  var capture = fresh(37);
  setHand(capture, 0, ['infantry']);
  var u = putUnit(capture, 0, 'infantry', 2, 1);
  var after = E.moveUnit(capture, u.id, { r: 2, c: 0 }, 0);
  s.eq('踏上中立据点即控制', after.strongholds.filter(function (h) { return h.id === 'h3'; })[0].owner, 0);
  s.eq('控制数变为 1', E.controlCount(after, 0), 1);
  s.ok('占点日志记录', after.log.some(function (l) { return l.type === 'control'; }));

  var flip = fresh(38);
  setHand(flip, 0, ['infantry']);
  flip.strongholds.forEach(function (h) { if (h.id === 'h3') h.owner = 1; });
  var f = putUnit(flip, 0, 'infantry', 2, 1);
  var flipped = E.moveUnit(flip, f.id, { r: 2, c: 0 }, 0);
  s.eq('敌方据点被翻为中立者所有', flipped.strongholds.filter(function (h) { return h.id === 'h3'; })[0].owner, 0);
  s.eq('敌方控制数归零', E.controlCount(flipped, 1), 0);

  var persist = fresh(39);
  setHand(persist, 0, ['infantry', 'infantry']);
  var p = putUnit(persist, 0, 'infantry', 2, 1);
  var onPoint = E.moveUnit(persist, p.id, { r: 2, c: 0 }, 0);
  var leftPoint = E.moveUnit(onPoint, p.id, { r: 2, c: 1 }, 0);
  s.eq('离开据点后控制权保留', E.controlCount(leftPoint, 0), 1);
  s.eq('据点仍归原主', leftPoint.strongholds.filter(function (h) { return h.id === 'h3'; })[0].owner, 0);

  var base = fresh(40);
  setHand(base, 0, ['scout']);
  var s2 = putUnit(base, 0, 'scout', 1, 3);
  var won = E.moveUnit(base, s2.id, { r: 0, c: 3 }, 0);
  s.ok('踏入敌方大本营立即结束', won.over);
  s.eq('踏入者获胜', won.result.winner, 0);
  s.ok('胜利原因是大本营', /大本营/.test(won.result.reason), won.result.reason);

  var ownBase = fresh(41);
  setHand(ownBase, 0, ['infantry']);
  var ob = putUnit(ownBase, 0, 'infantry', 5, 3);
  s.ok('可以回到己方大本营', E.canMove(ownBase, ob.id, { r: 6, c: 3 }, 0).ok);
});

/* ------------------------------------------------------------------ */
/* 5. 攻击合法性                                                       */
/* ------------------------------------------------------------------ */

s.group('攻击：击杀、距离与结算', function () {
  var state = fresh(51);
  setHand(state, 0, ['infantry']);
  var attacker = putUnit(state, 0, 'infantry', 3, 3);
  var target = putUnit(state, 1, 'archer', 3, 4);
  s.ok('相邻攻击合法', E.canAttack(state, attacker.id, target.id, 0).ok);
  var next = E.attackUnit(state, attacker.id, target.id, 0);
  s.eq('目标被击杀', next.units.length, 1);
  s.eq('攻击方留在原地', [next.units[0].r, next.units[0].c], [3, 3]);
  s.eq('目标棋子回到预备队', next.players[1].reserves.archer, DATA.UNITS.archer.count);
  s.eq('攻击花掉 1 枚币', next.players[0].hand.length, 0);
  s.ok('攻击日志记录', next.log.some(function (l) { return l.type === 'attack'; }));
  s.eq('原局面目标仍在', state.units.length, 2);
  s.ok('击杀后单位守恒', unitInvariant(next));

  var out = fresh(52);
  setHand(out, 0, ['infantry']);
  var a2 = putUnit(out, 0, 'infantry', 3, 3);
  var t2 = putUnit(out, 1, 'infantry', 3, 6);
  var far = E.canAttack(out, a2.id, t2.id, 0);
  s.ok('步兵移动后仍打不到 3 格外', !far.ok && /范围|接近/.test(far.reason), far.reason);

  var archer = fresh(53);
  setHand(archer, 0, ['archer']);
  var a3 = putUnit(archer, 0, 'archer', 0, 0);
  var t3 = putUnit(archer, 1, 'infantry', 0, 2);
  s.ok('弓箭手可打 2 格', E.canAttack(archer, a3.id, t3.id, 0).ok);
  var t3b = putUnit(archer, 1, 'infantry', 3, 3);
  s.ok('弓箭手移动后仍打不到 4 格外', !E.canAttack(archer, a3.id, t3b.id, 0).ok);

  var own = fresh(54);
  setHand(own, 0, ['infantry']);
  var a4 = putUnit(own, 0, 'infantry', 3, 3);
  var friend = putUnit(own, 0, 'infantry', 3, 4);
  var friendly = E.canAttack(own, a4.id, friend.id, 0);
  s.ok('不能攻击己方单位', !friendly.ok && /己方/.test(friendly.reason), friendly.reason);

  var scout = fresh(55);
  setHand(scout, 0, ['scout']);
  var a5 = putUnit(scout, 0, 'scout', 3, 3);
  var t5 = putUnit(scout, 1, 'infantry', 3, 4);
  var scoutAtk = E.canAttack(scout, a5.id, t5.id, 0);
  s.ok('斥候不能攻击', !scoutAtk.ok && /不能攻击/.test(scoutAtk.reason), scoutAtk.reason);

  var noCoin = fresh(56);
  setHand(noCoin, 0, []);
  var a6 = putUnit(noCoin, 0, 'infantry', 3, 3);
  var t6 = putUnit(noCoin, 1, 'infantry', 3, 4);
  var nc = E.canAttack(noCoin, a6.id, t6.id, 0);
  s.ok('没有币不能攻击', !nc.ok && /手里没有/.test(nc.reason), nc.reason);

  var missing = fresh(57);
  setHand(missing, 0, ['infantry']);
  var a7 = putUnit(missing, 0, 'infantry', 3, 3);
  var mi = E.canAttack(missing, a7.id, 99999, 0);
  s.ok('目标不存在拒绝', !mi.ok && /不存在/.test(mi.reason), mi.reason);

  var over = fresh(58);
  setHand(over, 0, ['infantry']);
  var a8 = putUnit(over, 0, 'infantry', 3, 3);
  var t8 = putUnit(over, 1, 'infantry', 3, 4);
  over.over = true;
  var ov = E.canAttack(over, a8.id, t8.id, 0);
  s.ok('结束后不能再攻击', !ov.ok && /结束/.test(ov.reason), ov.reason);

  expectThrow('非法攻击抛错', function () {
    E.attackUnit(state, attacker.id, 99999, 0);
  }, /不存在/);
});

s.group('攻击：先移动再攻击与途中占点', function () {
  var moveAttack = fresh(61);
  setHand(moveAttack, 0, ['archer']);
  var archer = putUnit(moveAttack, 0, 'archer', 2, 2);
  var target = putUnit(moveAttack, 1, 'infantry', 5, 2);
  var check = E.canAttack(moveAttack, archer.id, target.id, 0);
  s.ok('弓箭手可先移动再攻击', check.ok, check.reason);
  s.eq('攻击前会先走到射程内', [check.approach.r, check.approach.c], [3, 2]);
  var after = E.attackUnit(moveAttack, archer.id, target.id, 0);
  s.eq('攻击后位于接近格', [after.units[0].r, after.units[0].c], [3, 2]);
  s.eq('远程目标被击杀', after.units.length, 1);

  var cavalry = fresh(62);
  setHand(cavalry, 0, ['cavalry']);
  var c1 = putUnit(cavalry, 0, 'cavalry', 1, 1);
  var c2 = putUnit(cavalry, 1, 'infantry', 4, 1);
  var cCheck = E.canAttack(cavalry, c1.id, c2.id, 0);
  s.ok('骑兵可移动 2 格后攻击', cCheck.ok, cCheck.reason);
  var cAfter = E.attackUnit(cavalry, c1.id, c2.id, 0);
  s.eq('骑兵最终停在接近格', [cAfter.units[0].r, cAfter.units[0].c], [3, 1]);

  var capture = fresh(63);
  setHand(capture, 0, ['archer']);
  var ar = putUnit(capture, 0, 'archer', 2, 1);
  var foe = putUnit(capture, 1, 'infantry', 4, 0);
  var capCheck = E.canAttack(capture, ar.id, foe.id, 0);
  s.ok('攻击路线可以落在据点上', capCheck.ok, capCheck.reason);
  s.eq('优先接近并占点', [capCheck.approach.r, capCheck.approach.c], [2, 0]);
  var capAfter = E.attackUnit(capture, ar.id, foe.id, 0);
  s.eq('移动途中控制据点', E.controlCount(capAfter, 0), 1);
  s.eq('攻击仍完成击杀', capAfter.units.length, 1);

  var twice = fresh(64);
  setHand(twice, 0, ['infantry']);
  var a = putUnit(twice, 0, 'infantry', 3, 3);
  var t = putUnit(twice, 1, 'infantry', 3, 4);
  var t2 = putUnit(twice, 1, 'infantry', 3, 2);
  var killed = E.attackUnit(twice, a.id, t.id, 0);
  var second = E.canAttack(killed, a.id, t2.id, 0);
  s.ok('一枚币只能攻击一次', !second.ok && /手里没有/.test(second.reason), second.reason);
});

/* ------------------------------------------------------------------ */
/* 6. 据点控制与胜负                                                   */
/* ------------------------------------------------------------------ */

s.group('胜负：4 个据点、大本营与平局判定', function () {
  var state = fresh(71);
  setHand(state, 0, ['infantry']);
  state.strongholds.forEach(function (h) {
    if (h.id === 'h0' || h.id === 'h1' || h.id === 'h2') h.owner = 0;
  });
  var unit = putUnit(state, 0, 'infantry', 2, 1);
  var won = E.moveUnit(state, unit.id, { r: 2, c: 0 }, 0);
  s.ok('控制第 4 个据点立即结束', won.over);
  s.eq('占点方获胜', won.result.winner, 0);
  s.eq('胜因是据点', /4 个据点/.test(won.result.reason), true);
  s.eq('结果记录双方据点', won.result.control, [4, 0]);
  s.eq('结果记录场上兵力', won.result.units, [1, 0]);

  var tie = E.createGame({ seed: 72, maxTurns: 2 });
  tie.turn = 2;
  tie.strongholds.forEach(function (h) {
    if (h.id === 'h0' || h.id === 'h1') h.owner = 0;
    if (h.id === 'h2') h.owner = 1;
  });
  var tied = E.endTurn(tie);
  s.ok('达到回合上限即结束', tied.over);
  s.eq('按据点更多者获胜', tied.result.winner, 0);
  s.ok('回合上限原因可读', /回合上限/.test(tied.result.reason), tied.result.reason);

  var unitsTie = E.createGame({ seed: 73, maxTurns: 2 });
  unitsTie.turn = 2;
  unitsTie.strongholds.forEach(function (h) {
    if (h.id === 'h0') h.owner = 0;
    if (h.id === 'h1') h.owner = 1;
  });
  putUnit(unitsTie, 0, 'infantry', 6, 2);
  putUnit(unitsTie, 0, 'infantry', 6, 4);
  putUnit(unitsTie, 1, 'infantry', 0, 2);
  var byUnits = E.endTurn(unitsTie);
  s.eq('据点相同则比场上兵力', byUnits.result.winner, 0);

  var draw = E.createGame({ seed: 74, maxTurns: 2 });
  draw.turn = 2;
  draw.strongholds.forEach(function (h) {
    if (h.id === 'h0') h.owner = 0;
    if (h.id === 'h1') h.owner = 1;
  });
  var drawn = E.endTurn(draw);
  s.eq('据点和兵力都相同则平局', drawn.result.winner, null);
  s.ok('平局没有胜者', drawn.over && drawn.result.winner === null);

  var ended = E.createGame({ seed: 75, maxTurns: 2 });
  ended.turn = 2;
  ended.over = true;
  ended.result = { winner: 0, reason: '测试', control: [4, 0], units: [1, 0] };
  var unchanged = E.endTurn(ended);
  s.eq('结束后 endTurn 不改变结果', unchanged.result.reason, '测试');
  s.eq('结束后不再换人', unchanged.turn, 2);
});

s.group('摘要与查询', function () {
  var state = fresh(81);
  var summary = E.summary(state);
  s.eq('摘要回合数', summary.turn, 1);
  s.eq('摘要当前玩家', summary.current, 0);
  s.eq('摘要据点计数', summary.control, [0, 0]);
  s.eq('摘要玩家数', summary.players.length, 2);
  s.eq('摘要手牌计数', summary.players[0].handCounts && Object.keys(summary.players[0].handCounts).length, 5);
  s.eq('摘要手牌总量', summary.players[0].hand.length, 3);
  s.eq('摘要袋计数', summary.players[0].bag, 11);
  s.eq('摘要单位数', summary.players[0].units, 0);
  s.eq('摘要 12 个据点', summary.strongholds.length, 12);
  s.eq('坐标文案', E.coordText(0, 0), '第1行第1列');
  s.eq('坐标文案右下角', E.coordText(6, 6), '第7行第7列');
  s.ok('findUnit 找不到时返回 null', E.findUnit(state, 12345) === null);
  s.ok('unitAt 空场返回 null', E.unitAt(state, 3, 3) === null);
  s.ok('baseOf 能取到大本营', !!E.baseOf(state, 0) && E.baseOf(state, 0).r === 6);
});

/* ------------------------------------------------------------------ */
/* 7. AI 合法性                                                        */
/* ------------------------------------------------------------------ */

s.group('AI：动作合法与状态不变量', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var state = fresh(seed);
    var action = E.chooseAIAction(state, 0);
    s.ok('seed ' + seed + ' 返回动作', !!action && typeof action.type === 'string');
    var applied = null;
    var threw = '';
    try { applied = E.applyAction(state, action); } catch (error) { threw = error.message; }
    s.ok('seed ' + seed + ' 动作可执行', !threw, threw);
    if (applied) {
      s.ok('seed ' + seed + ' 执行后状态合法', stateInvariant(applied));
      s.ok('seed ' + seed + ' 回合数不倒退', applied.turn >= state.turn);
    }
  }
});

s.group('50 局 AI 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var unfinished = 0;
  var illegal = 0;
  var invalidResult = 0;
  var maxSteps = 0;
  var byControl = 0;
  var byBase = 0;
  var byLimit = 0;

  for (var seed = 1; seed <= 50; seed++) {
    var state = E.createGame({ seed: seed, aiPlayer: 1 });
    var steps = 0;
    try {
      while (!state.over && steps < 1200) {
        var action = E.chooseAIAction(state, state.current);
        if (!action) { errors++; break; }
        state = E.applyAction(state, action);
        steps++;
        if (!stateInvariant(state)) illegal++;
      }
    } catch (error) {
      errors++;
    }
    if (!state.over) unfinished++;
    if (state.over) {
      var result = state.result;
      if (!result || [0, 1, null].indexOf(result.winner) === -1 ||
        !result.reason || !Array.isArray(result.control) || !Array.isArray(result.units)) {
        invalidResult++;
      }
      if (/4 个据点/.test(result.reason)) byControl++;
      else if (/大本营/.test(result.reason)) byBase++;
      else if (/回合上限/.test(result.reason)) byLimit++;
      if (!stateInvariant(state)) illegal++;
    }
    maxSteps = Math.max(maxSteps, steps);
  }

  s.eq('50 局全部无异常', errors, 0);
  s.eq('50 局全部自然结束', unfinished, 0);
  s.eq('50 局过程中始终满足币/单位/棋盘不变量', illegal, 0);
  s.eq('50 局结果结构合法', invalidResult, 0);
  s.ok('自对弈在动作上限内结束', maxSteps < 1200, String(maxSteps));
  s.ok('自对弈主要靠据点/大本营分胜负', byControl + byBase > 0,
    'control=' + byControl + ' base=' + byBase + ' limit=' + byLimit);
  s.ok('50 局在 20 秒内跑完', Date.now() - started < 20000, (Date.now() - started) + 'ms');
});

/* ------------------------------------------------------------------ */
/* 8. 页面静态约束                                                     */
/* ------------------------------------------------------------------ */

s.group('对局页面静态约束', function () {
  var html = fs.readFileSync(PAGE, 'utf8');
  s.ok('页面存在', html.length > 4000);
  s.ok('页面标题含战争宝箱', /<title>[^<]*战争宝箱/.test(html));
  s.ok('页面有 viewport', /name="viewport"/.test(html));
  s.ok('页面引用 data.js', /<script src="data\.js"><\/script>/.test(html));
  s.ok('页面引用 engine.js', /<script src="engine\.js"><\/script>/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch / XHR / sendBeacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));
  s.ok('页面无远程 url() / @import', !/url\(\s*["']?https?:|@import/i.test(html));
  s.ok('页面链接规则页', /href="rules\.html"/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有 aria-live', /aria-live=/.test(html));
  s.ok('页面有 role=dialog', /role="dialog"/.test(html));
  s.ok('页面有 390/430 窄屏媒体查询',
    /@media\s*\(max-width:\s*430px\)/.test(html) || /@media\s*\(max-width:\s*390px\)/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('按钮触控高度至少 44px', /min-height:\s*44px/.test(html));
  s.ok('棋盘是 7 列网格', /grid-template-columns:\s*repeat\(7/.test(html));
  s.ok('页面无远程字体', !/fonts\.googleapis|fonts\.gstatic|@font-face/i.test(html));
});

s.group('规则页与引擎静态约束', function () {
  var html = fs.readFileSync(RULES, 'utf8');
  s.ok('规则页存在', html.length > 3000);
  s.ok('规则页标题含规则', /<title>[^<]*规则/.test(html));
  s.ok('规则页有 viewport', /name="viewport"/.test(html));
  s.ok('顶部写明简化版', /简化版，非官方完整规则/.test(html));
  s.ok('规则页包含胜利条件', /控制 4 个据点/.test(html));
  s.ok('规则页包含大本营胜利', /攻入敌方大本营/.test(html));
  s.ok('规则页包含抽 3 枚币', /抽 3 枚/.test(html));
  s.ok('规则页包含 5 种单位', DATA.UNIT_ORDER.every(function (type) {
    return html.indexOf(DATA.UNITS[type].name) !== -1;
  }));
  s.ok('规则页说明掷币洗回', /洗回袋中/.test(html));
  s.ok('规则页链接回对局', /href="index\.html"/.test(html));
  s.ok('规则页无外部脚本/样式', !/<script[^>]+src="https?:/i.test(html) &&
    !/<link[^>]+rel="stylesheet"/i.test(html));

  var engineSrc = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
  var dataSrc = fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8');
  s.ok('引擎不引用 DOM', !/\bdocument\.|\bwindow\./.test(engineSrc));
  s.ok('数据文件不引用 DOM', !/\bdocument\.|\bwindow\./.test(dataSrc));
  s.ok('引擎是 UMD', /module\.exports/.test(engineSrc) && /globalThis/.test(engineSrc));
  s.ok('数据是 UMD', /module\.exports/.test(dataSrc) && /globalThis/.test(dataSrc));
});

/* ------------------------------------------------------------------ */
/* 9. 动作 API 一致性                                                  */
/* ------------------------------------------------------------------ */

s.group('legalActions 与 applyAction', function () {
  var state = fresh(91);
  var actions = E.legalActions(state, 0);
  s.ok('开局有合法动作', actions.length > 0);
  s.ok('动作类型均在允许集合内', actions.every(function (a) {
    return ['deploy', 'move', 'attack'].indexOf(a.type) !== -1;
  }));
  s.ok('每个动作都有对应币类型', actions.every(function (a) {
    return DATA.UNIT_ORDER.indexOf(a.unitType) !== -1;
  }));
  var deployActions = actions.filter(function (a) { return a.type === 'deploy'; });
  s.ok('开局包含部署动作', deployActions.length > 0);
  var first = deployActions[0];
  var after = E.applyAction(state, first);
  s.eq('applyAction 执行部署', after.units.length, 1);
  s.eq('applyAction 不修改原局面', state.units.length, 0);
  s.eq('结束动作可用', E.applyAction(state, { type: 'end' }).current, 1);
  expectThrow('未知动作抛错', function () {
    E.applyAction(state, { type: 'teleport' });
  }, /未知/);

  var ended = fresh(92);
  ended.over = true;
  s.eq('结束后无合法动作', E.legalActions(ended, 0).length, 0);
  s.eq('结束后 AI 只会结束', E.chooseAIAction(ended, 0).type, 'end');
});

s.done();
