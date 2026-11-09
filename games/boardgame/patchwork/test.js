'use strict';

/*
 * Patchwork（拼布）引擎测试。
 *
 * 页面与测试共用同源 engine.js / data.js；这里直接 require 引擎，避免复制规则。
 * 运行：node games/boardgame/patchwork/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('patchwork');

var DATA = require('./data.js');
var E = require('./engine.js');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function countEmpty(player) {
  var n = 0;
  player.board.forEach(function (row) {
    row.forEach(function (cell) { if (cell === null) n++; });
  });
  return n;
}

function fill(player, row, col, value) {
  player.board[row][col] = value;
}

function firstPlacement(state, patchId) {
  var oriList = E.orientationsFor(patchId);
  for (var oi = 0; oi < oriList.length; oi++) {
    for (var r = 0; r < 9; r++) {
      for (var c = 0; c < 9; c++) {
        var check = E.canPlaceFor(state, state.current, patchId, oi, r, c);
        if (check.ok) return { orientationIndex: oi, row: r, col: c };
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 1. 数据完整性                                                       */
/* ------------------------------------------------------------------ */

s.group('33 块数据', function () {
  s.eq('拼布总数 33', DATA.PATCHES.length, 33);
  s.eq('拼布 ID 唯一', new Set(DATA.PATCHES.map(function (p) { return p.id; })).size, 33);
  s.eq('面积分布符合基础版', DATA.PATCHES.reduce(function (acc, p) {
    acc[p.size] = (acc[p.size] || 0) + 1;
    return acc;
  }, {}), { 2: 1, 3: 3, 4: 7, 5: 9, 6: 10, 7: 2, 8: 1 });
  s.eq('总覆盖格数 166', DATA.PATCHES.reduce(function (sum, p) { return sum + p.size; }, 0), 166);
  s.ok('所有数据对象字段齐全', DATA.PATCHES.every(function (p) {
    return typeof p.id === 'string' && p.id &&
      typeof p.name === 'string' && p.name &&
      Array.isArray(p.cells) && p.cells.length &&
      Number.isInteger(p.buttons) && Number.isInteger(p.time) && Number.isInteger(p.income) &&
      Number.isInteger(p.size) && Number.isInteger(p.rows) && Number.isInteger(p.cols);
  }));

  DATA.PATCHES.forEach(function (p, index) {
    var label = p.id + ' ' + p.name;
    s.eq(label + ' 面积等于格子数', p.size, p.cells.length);
    s.ok(label + ' 面积在 1–9', p.size >= 1 && p.size <= 9, String(p.size));
    s.ok(label + ' 购买成本在 0–10', p.buttons >= 0 && p.buttons <= 10, String(p.buttons));
    s.ok(label + ' 时间成本在 1–6', p.time >= 1 && p.time <= 6, String(p.time));
    s.ok(label + ' 按钮收益在 0–3', p.income >= 0 && p.income <= 3, String(p.income));
    s.ok(label + ' 名称含中文', /[一-鿿]/.test(p.name));
    s.ok(label + ' 坐标均在包围盒内', p.cells.every(function (cell) {
      return cell[0] >= 0 && cell[0] < p.rows && cell[1] >= 0 && cell[1] < p.cols;
    }));
    s.ok(label + ' 至少一格贴左/上边界', p.cells.some(function (cell) {
      return cell[0] === 0 || cell[1] === 0;
    }));
    s.eq(label + ' 坐标不重复', new Set(p.cells.map(function (cell) { return cell.join(','); })).size, p.cells.length);
    s.ok(label + ' 行列尺寸与坐标一致', Math.max.apply(null, p.cells.map(function (cell) { return cell[0]; })) + 1 === p.rows &&
      Math.max.apply(null, p.cells.map(function (cell) { return cell[1]; })) + 1 === p.cols);
    if (index === 0 || index === DATA.PATCHES.length - 1) {
      s.ok(label + ' 首尾数据可读取', !!E.patchById(p.id));
    }
  });

  s.eq('时间轴扣子格 9 个', DATA.INCOME_SPACES.length, 9);
  s.ok('扣子格递增且落在 0–53', DATA.INCOME_SPACES.every(function (n, i, arr) {
    return n > 0 && n <= 53 && (i === 0 || n > arr[i - 1]);
  }));
  s.eq('最后一个扣子格就是终点', DATA.INCOME_SPACES[DATA.INCOME_SPACES.length - 1], DATA.LAST_SPACE);
  s.eq('起点扣子 5', DATA.START_BUTTONS, 5);
  s.eq('7×7 奖励 7 分', DATA.SEVEN_BY_SEVEN_BONUS, 7);
  s.eq('空格扣 2 分', DATA.EMPTY_PENALTY, 2);
});

/* ------------------------------------------------------------------ */
/* 2. 旋转 / 翻转                                                      */
/* ------------------------------------------------------------------ */

s.group('旋转与翻转朝向', function () {
  DATA.PATCHES.forEach(function (p) {
    var ori = E.orientationsFor(p.id);
    s.ok(p.id + ' 至少一个朝向', ori.length >= 1 && ori.length <= 8, String(ori.length));
    s.eq(p.id + ' 朝向 key 唯一', new Set(ori.map(function (o) { return o.key; })).size, ori.length);
    s.ok(p.id + ' 所有朝向面积不变', ori.every(function (o) { return o.cells.length === p.size; }));
    s.ok(p.id + ' 朝向坐标不重复', ori.every(function (o) {
      return new Set(o.cells.map(function (cell) { return cell.join(','); })).size === o.cells.length;
    }));
  });

  var square = E.orientationsFor('P05');
  s.eq('2×2 方块只有 1 种朝向', square.length, 1);
  var w = E.orientationsFor('P33');
  s.ok('W 形有多个朝向', w.length > 1, String(w.length));

  DATA.PATCHES.slice(0, 12).forEach(function (p) {
    var index = 0;
    var key = E.orientationsFor(p.id)[0].key;
    var seen = [key];
    for (var i = 0; i < 4; i++) {
      index = E.rotateIndex(p.id, index, 'cw');
      seen.push(E.orientationsFor(p.id)[index].key);
    }
    s.eq(p.id + ' 顺时针转 4 次回原形', seen[4], key);
    var flipped = E.flipIndex(p.id, 0);
    var back = E.flipIndex(p.id, flipped);
    s.eq(p.id + ' 翻转 2 次回原形', back, 0);
  });

  var p07 = E.orientationsFor('P07');
  var p07Rot = E.rotateIndex('P07', 0, 'cw');
  s.ok('旋转会改变非对称形状', p07[p07Rot].key !== p07[0].key || p07.length === 1);
});

/* ------------------------------------------------------------------ */
/* 3. 开局、市场与合法性                                               */
/* ------------------------------------------------------------------ */

s.group('开局与市场', function () {
  var state = E.createGame({ seed: 42 });
  s.eq('开局双方 5 扣子', state.players.map(function (p) { return p.buttons; }), [5, 5]);
  s.eq('开局双方时间 0', state.players.map(function (p) { return p.time; }), [0, 0]);
  s.eq('开局 81 个空格', E.emptyCells(state.players[0]), 81);
  s.eq('开局无收益', E.playerIncome(state.players[0]), 0);
  s.eq('开局当前玩家 0', state.current, 0);
  s.eq('市场显示 3 块', E.getAvailablePatches(state).length, 3);
  s.eq('市场来自时间标记前方', E.getAvailablePatches(state).every(function (p) {
    return state.pieces.filter(function (x) { return x.id === p.id; })[0].slot > 0;
  }), true);
  s.ok('未购买拼布 owner 为空', state.pieces.every(function (p) { return p.owner === null; }));
  s.eq('33 块 slot 唯一', new Set(state.pieces.map(function (p) { return p.slot; })).size, 33);
  s.ok('slot 均在 1–53', state.pieces.every(function (p) { return p.slot >= 1 && p.slot <= 53; }));

  var affordable = E.getAvailablePatches(state).filter(function (p) {
    return p.buttons <= state.players[0].buttons;
  });
  var boughtPatch = affordable.filter(function (p) { return !!firstPlacement(state, p.id); })[0];
  s.ok('开局至少有一块买得起且可放', !!boughtPatch);
  var bought = boughtPatch ? boughtPatch.id : affordable[0].id;
  var place = firstPlacement(state, bought);
  var next = E.buyPatch(state, bought, place.orientationIndex, place.row, place.col);
  s.eq('买走后 owner 记录', next.pieces.filter(function (p) { return p.owner !== null; }).length, 1);
  s.eq('买走后市场不重复出现', E.getAvailablePatches(next).some(function (p) { return p.id === bought; }), false);
  s.ok('买走后时间前进', next.players[0].time > state.players[0].time);
  s.ok('买走后扣子扣减', next.players[0].buttons === 5 - E.patchById(bought).buttons +
    next.log.filter(function (l) { return l.type === 'buy'; }).reduce(function (sum, l) {
      return sum + (l.incomeEvents || []).reduce(function (x, ev) { return x + ev.amount; }, 0);
    }, 0));
  s.ok('原局面未被修改', state.pieces.filter(function (p) { return p.owner !== null; }).length === 0);
});

s.group('放置边界、重叠与扣子不足', function () {
  var state = E.createGame({ seed: 7 });
  var patch = E.getAvailablePatches(state)[0];
  var ori = E.orientationsFor(patch.id)[0];
  var checkOk = E.canPlace(state, patch.id, 0, 0, 0);
  s.ok('左上角合法', checkOk.ok, checkOk.reason);
  var neg = E.canPlace(state, patch.id, 0, -1, 0);
  s.ok('负坐标拒绝', !neg.ok && /边界/.test(neg.reason), neg.reason);
  var out = E.canPlace(state, patch.id, 0, 9, 0);
  s.ok('越界拒绝', !out.ok && /边界/.test(out.reason), out.reason);
  var atEdge = E.canPlace(state, patch.id, 0, 9 - ori.rows, 9 - ori.cols);
  s.ok('贴右下角可放', atEdge.ok || patch.size > 9, atEdge.reason);

  var overlap = E.createGame({ seed: 7 });
  fill(overlap.players[0], ori.cells[0][0], ori.cells[0][1], { dummy: true });
  var blocked = E.canPlace(overlap, patch.id, 0, 0, 0);
  s.ok('重叠拒绝', !blocked.ok && /重叠/.test(blocked.reason), blocked.reason);

  var poor = E.createGame({ seed: 7 });
  poor.players[0].buttons = 0;
  var richPatch = E.getAvailablePatches(poor).filter(function (p) { return p.buttons > 0; })[0];
  if (richPatch) {
    var poorCheck = E.canPlace(poor, richPatch.id, 0, 0, 0);
    s.ok('扣子不足拒绝', !poorCheck.ok && /扣子不足/.test(poorCheck.reason), poorCheck.reason);
  } else {
    s.ok('扣子不足测试块存在', false);
  }

  var unavailable = E.createGame({ seed: 7 });
  var notInMarket = DATA.PATCHES.filter(function (p) {
    return !E.getAvailablePatches(unavailable).some(function (a) { return a.id === p.id; });
  })[0];
  var far = E.canPlace(unavailable, notInMarket.id, 0, 0, 0);
  s.ok('市场外拼布拒绝', !far.ok && /可购买范围/.test(far.reason), far.reason);

  expectThrow('非法购买抛错', function () {
    E.buyPatch(state, patch.id, 0, -1, 0);
  }, /边界/);
  expectThrow('非法朝向抛错', function () {
    E.buyPatch(state, patch.id, 999, 0, 0);
  }, /朝向/);
});

/* ------------------------------------------------------------------ */
/* 4. 时间推进、收入与跳过                                             */
/* ------------------------------------------------------------------ */

s.group('时间推进与扣子收入', function () {
  var state = E.createGame({ seed: 9 });
  state.players[0].time = 4;
  state.players[0].buttons = 20;
  state.current = 0;
  state.pieces.forEach(function (p) {
    if (p.id !== 'P03') p.owner = 0;
    else { p.owner = null; p.slot = 5; }
  });
  var place = firstPlacement(state, 'P03');
  s.ok('收入测试块可放', !!place);
  var next = E.buyPatch(state, 'P03', place.orientationIndex, place.row, place.col);
  s.eq('买后时间到 7', next.players[0].time, 7);
  s.eq('经过 5 格扣子收入 1', next.players[0].buttons, 18);
  s.eq('日志记录收入格', next.log.filter(function (l) {
    return l.type === 'buy' && l.incomeEvents && l.incomeEvents.length === 1 &&
      l.incomeEvents[0].space === 5 && l.incomeEvents[0].amount === 1;
  }).length, 1);
  s.eq('拼布按钮收益进入账面', E.playerIncome(next.players[0]), 1);

  var skipState = E.createGame({ seed: 10 });
  skipState.players[0].time = 3;
  skipState.players[1].time = 10;
  skipState.players[0].buttons = 5;
  skipState.current = 0;
  skipState.lastPlayer = 1;
  var skipped = E.skipTurn(skipState);
  s.eq('跳过后落在对手前方一格', skipped.players[0].time, 11);
  s.eq('跳过按移动格数补扣子', skipped.players[0].buttons, 13);
  s.eq('跳过横跨两个扣子格', skipped.log.filter(function (l) {
    return l.type === 'skip' && l.incomeEvents.length === 2;
  }).length, 1);

  var incomeSkip = E.createGame({ seed: 11 });
  incomeSkip.players[0].time = 4;
  incomeSkip.players[1].time = 10;
  incomeSkip.players[0].buttons = 5;
  incomeSkip.players[0].placed = [{ patchId: 'P03' }];
  incomeSkip.current = 0;
  var incomeSkipped = E.skipTurn(incomeSkip);
  s.eq('跳过也结算已有扣子收益', incomeSkipped.players[0].buttons, 14);

  var ahead = E.createGame({ seed: 12 });
  ahead.players[0].time = 20;
  ahead.players[1].time = 3;
  ahead.players[0].buttons = 5;
  ahead.current = 0;
  var noBack = E.skipTurn(ahead);
  s.eq('领先时跳过不倒退', noBack.players[0].time, 20);
  s.eq('领先时跳过不加补偿', noBack.players[0].buttons, 5);
  s.eq('原地跳过计数 +1', noBack.zeroSkips, 1);

  var end = E.createGame({ seed: 13 });
  end.players[0].time = 53;
  end.players[1].time = 53;
  end.players[0].buttons = 5;
  end.current = 0;
  var clamp = E.skipTurn(end);
  s.eq('终点跳过不越界', clamp.players[0].time, 53);
  s.eq('终点跳过不加格数', clamp.players[0].buttons, 5);
});

/* ------------------------------------------------------------------ */
/* 5. 7×7 奖励与终局计分                                               */
/* ------------------------------------------------------------------ */

s.group('7×7 奖励只发一次', function () {
  var state = E.createGame({ seed: 21 });
  var p0 = state.players[0];
  p0.buttons = 20;
  p0.time = 0;
  state.current = 0;
  for (var r = 0; r < 7; r++) {
    for (var c = 0; c < 7; c++) p0.board[r][c] = { dummy: true };
  }
  p0.board[6][5] = null;
  p0.board[6][6] = null;
  var p01 = state.pieces.filter(function (p) { return p.id === 'P01'; })[0];
  p01.owner = null;
  p01.slot = 1;
  state.pieces.filter(function (p) { return p.id !== 'P01'; }).forEach(function (p) { p.owner = 0; });
  s.ok('7×7 完成前不触发', !E.hasSevenBySeven(p0.board));
  var next = E.buyPatch(state, 'P01', 0, 6, 5);
  s.ok('完成后 7×7 成立', E.hasSevenBySeven(next.players[0].board));
  s.eq('7×7 奖励进入玩家', next.players[0].bonus, 7);
  s.eq('奖励记录归属', next.bonusAwardedTo, 0);
  s.eq('奖励日志只出现一次', next.log.filter(function (l) { return l.type === 'bonus'; }).length, 1);

  var p1 = next.players[1];
  p1.buttons = 20;
  p1.time = 0;
  next.current = 1;
  next.over = false;
  next.result = null;
  for (var r2 = 0; r2 < 7; r2++) {
    for (var c2 = 0; c2 < 7; c2++) p1.board[r2][c2] = { dummy: true };
  }
  p1.board[6][0] = null;
  p1.board[6][1] = null;
  p1.board[6][2] = null;
  var p02 = next.pieces.filter(function (p) { return p.id === 'P02'; })[0];
  p02.owner = null;
  p02.slot = 1;
  var second = E.buyPatch(next, 'P02', 0, 6, 0);
  s.ok('第二位玩家也能形成 7×7', E.hasSevenBySeven(second.players[1].board));
  s.eq('第二位玩家拿不到第二个奖励', second.players[1].bonus, 0);
  s.eq('奖励归属仍是第一位', second.bonusAwardedTo, 0);
});

s.group('终局计分与胜负', function () {
  var state = E.createGame({ seed: 31 });
  state.players[0].buttons = 10;
  state.players[0].bonus = 7;
  fill(state.players[0], 0, 0, { dummy: true });
  fill(state.players[0], 0, 1, { dummy: true });
  var scores = E.finalScores(state);
  s.eq('得分 = 扣子 + 奖励 - 2×空格', scores[0].score, 10 + 7 - 2 * 79);
  s.eq('空格数正确', scores[0].empty, 79);
  s.eq('空扣分正确', scores[0].penalty, 158);
  s.eq('双方都有明细', scores.length, 2);

  var end = E.createGame({ seed: 32 });
  end.players[0].time = 53;
  end.players[1].time = 53;
  end.players[0].buttons = 10;
  end.players[1].buttons = 8;
  var over = E.evaluateEnd(end);
  s.ok('双方到终点即结束', over.over);
  s.eq('结束原因可读', /终点/.test(over.overReason), true);
  s.eq('分数高者获胜', over.result.winner, 0);
  s.eq('结果中有两行分数', over.result.scores.length, 2);

  var tie = E.createGame({ seed: 33 });
  tie.players[0].time = 53;
  tie.players[1].time = 53;
  tie.players[0].buttons = 9;
  tie.players[1].buttons = 9;
  var tied = E.evaluateEnd(tie);
  s.eq('同分平局', tied.result.winner, null);

  var claimed = E.createGame({ seed: 34 });
  claimed.pieces.forEach(function (p) { p.owner = 1; });
  var noPieces = E.evaluateEnd(claimed);
  s.ok('无拼布可买即结束', noPieces.over);
  s.eq('无拼布结束原因', /全部被买走/.test(noPieces.overReason), true);

  var noMoves = E.createGame({ seed: 35 });
  noMoves.players[0].time = 53;
  noMoves.players[1].time = 53;
  noMoves.pieces.forEach(function (p) { p.owner = null; p.slot = 1; });
  var stopped = E.evaluateEnd(noMoves);
  s.ok('无合法动作结束', stopped.over);
});

/* ------------------------------------------------------------------ */
/* 6. AI 合法性与 50 局自对弈                                          */
/* ------------------------------------------------------------------ */

s.group('AI 合法动作', function () {
  for (var seed = 1; seed <= 20; seed++) {
    var state = E.createGame({ seed: seed, aiPlayer: 0 });
    var move = E.chooseAIMove(state);
    s.ok('seed ' + seed + ' AI 返回动作', move && (move.type === 'buy' || move.type === 'skip'));
    var next;
    var threw = '';
    try { next = E.applyMove(state, move); } catch (error) { threw = error.message; }
    s.ok('seed ' + seed + ' AI 动作合法', !threw, threw);
    if (!threw) {
      s.ok('seed ' + seed + ' 时间不越界', next.players.every(function (p) { return p.time >= 0 && p.time <= 53; }));
      s.ok('seed ' + seed + ' 扣子不为负', next.players.every(function (p) { return p.buttons >= 0; }));
      s.ok('seed ' + seed + ' 棋盘占格数正确', next.players.every(function (p) {
        return 81 - E.emptyCells(p) === p.placed.reduce(function (sum, x) { return sum + x.cells.length; }, 0);
      }));
    }
  }
});

s.group('50 局 AI 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var incomplete = 0;
  var illegalBoard = 0;
  var illegalScore = 0;
  var maxTurns = 0;

  for (var seed = 1; seed <= 50; seed++) {
    var state = E.createGame({ seed: seed, aiPlayer: 0 });
    var steps = 0;
    try {
      while (!state.over && steps < 800) {
        var move = E.chooseAIMove(state);
        state = E.applyMove(state, move);
        steps++;
        state.players.forEach(function (player) {
          var occupied = 81 - E.emptyCells(player);
          var placedArea = player.placed.reduce(function (sum, entry) { return sum + entry.cells.length; }, 0);
          if (occupied !== placedArea) illegalBoard++;
          if (player.buttons < 0 || player.time < 0 || player.time > 53) illegalScore++;
        });
      }
    } catch (error) {
      errors++;
    }
    if (!state.over) incomplete++;
    if (state.over) {
      var scores = E.finalScores(state);
      scores.forEach(function (row) {
        if (row.score !== row.buttons + row.bonus - 2 * row.empty) illegalScore++;
      });
    }
    maxTurns = Math.max(maxTurns, steps);
  }

  s.eq('50 局全部无异常', errors, 0);
  s.eq('50 局全部自然结束', incomplete, 0);
  s.eq('50 局棋盘始终无重叠', illegalBoard, 0);
  s.eq('50 局扣子/时间/计分始终合法', illegalScore, 0);
  s.ok('自对弈在限制内结束', maxTurns < 800, String(maxTurns));
  s.ok('50 局在 20 秒内跑完', Date.now() - started < 20000, (Date.now() - started) + 'ms');
});

/* ------------------------------------------------------------------ */
/* 7. 页面与同源引用                                                   */
/* ------------------------------------------------------------------ */

s.group('页面同源引用', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('页面存在 viewport', /name="viewport"/.test(html));
  s.ok('页面引用 data.js', /src="data\.js"/.test(html));
  s.ok('页面引用 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src="https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel="stylesheet"/i.test(html));
  s.ok('页面无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(html));
  s.ok('页面有 390px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(html) || /@media\s*\(max-width:\s*390px\)/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
});

s.done();
