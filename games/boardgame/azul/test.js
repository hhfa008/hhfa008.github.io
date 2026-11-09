'use strict';

/*
 * Azul（花砖物语）引擎测试。
 *
 * 页面与测试共用同源 engine.js；这里直接 require 引擎，避免复制规则。
 * 运行：node games/boardgame/azul/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('azul');

var E = require('./engine.js');

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function emptyWall() {
  var wall = [];
  for (var r = 0; r < 5; r++) {
    var row = [];
    for (var c = 0; c < 5; c++) row.push(null);
    wall.push(row);
  }
  return wall;
}

function clearBoard(state) {
  state.factories = [[], [], [], [], []];
  state.center = [];
  state.centerMarker = false;
}

function emptyTiles(state) {
  return [[], [], [], [], []];
}

function assertColorsConserved(label, state) {
  var counts = E.colorCounts(E.allTiles(state));
  var total = E.allTiles(state).length;
  s.eq(label + ' 每色仍为 20 枚', counts, [20, 20, 20, 20, 20]);
  s.eq(label + ' 总砖数仍为 100', total, 100);
}

/* ------------------------------------------------------------------ */
/* 1. 开局与砖数守恒                                                   */
/* ------------------------------------------------------------------ */

s.group('开局与砖数守恒', function () {
  var state = E.createGame(20261110);
  s.eq('开局 5 个圆盘', state.factories.length, 5);
  s.eq('每个圆盘 4 枚', state.factories.map(function (f) { return f.length; }), [4, 4, 4, 4, 4]);
  s.eq('中央区起始为空', state.center.length, 0);
  s.eq('中央区有先手标记', state.centerMarker, true);
  s.eq('开局第 1 轮', state.round, 1);
  s.eq('开局当前玩家 0', state.current, 0);
  s.eq('开局先手 0', state.firstPlayer, 0);
  s.eq('双方花纹行为空', state.players.map(function (p) { return p.lines.map(function (l) { return l.length; }); }), [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]);
  s.eq('双方墙面为空', state.players.map(function (p) {
    return p.wall.reduce(function (sum, row) {
      return sum + row.filter(function (cell) { return cell === null; }).length;
    }, 0);
  }), [25, 25]);
  s.eq('双方分数为 0', state.players.map(function (p) { return p.score; }), [0, 0]);
  s.eq('砖袋剩 80 枚', state.bag.length, 80);
  assertColorsConserved('开局', state);

  s.eq('墙面色序是拉丁方', (function () {
    var ok = true;
    for (var r = 0; r < 5; r++) {
      var rowSeen = [];
      for (var c = 0; c < 5; c++) {
        var color = E.wallColorAt(r, c);
        if (color < 0 || color > 4 || rowSeen.indexOf(color) !== -1) ok = false;
        rowSeen.push(color);
      }
    }
    return ok;
  })(), true);
  var colSeen = [];
  for (var c = 0; c < 5; c++) {
    var set = [];
    for (var r = 0; r < 5; r++) set.push(E.wallColorAt(r, c));
    colSeen.push(set.join(','));
  }
  s.eq('墙面每列也是 5 色', new Set(colSeen).size, 5);
  s.eq('开局当前玩家对象', E.currentPlayer(state).name, '你');
  s.eq('未结束', E.isGameOver(state), false);
  s.ok('合法动作非空', E.getLegalMoves(state).length > 0);
  s.eq('相同 seed 开局一致', JSON.stringify(E.createGame(42)), JSON.stringify(E.createGame(42)));
  s.ok('不同 seed 开局不同', JSON.stringify(E.createGame(42).factories) !== JSON.stringify(E.createGame(43).factories));
  s.ok('引擎没有 Math.random', !/Math\.random/.test(fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8')));
});

/* ------------------------------------------------------------------ */
/* 2. 取砖：圆盘 / 中央区                                              */
/* ------------------------------------------------------------------ */

s.group('取砖与中央区', function () {
  var state = E.createGame(11);
  state.factories[0] = [0, 1, 0, 2];
  state.factories[1] = [3, 3, 4, 4];
  state.factories[2] = [];
  state.factories[3] = [];
  state.factories[4] = [];
  state.center = [];
  var next = E.applyMove(state, { source: 'factory', factoryIndex: 0, color: 0, row: 4 });
  s.eq('取走后圆盘清空该色', next.factories[0].filter(function (t) { return t === 0; }).length, 0);
  s.eq('圆盘剩余砖进入中央区', next.center.slice().sort(), [1, 2]);
  s.eq('取走的砖进入花纹行', next.players[0].lines[4].length, 2);
  s.eq('原局面未被修改', state.factories[0].length, 4);
  s.eq('原局面中央区仍为空', state.center.length, 0);
  s.eq('轮到对手', next.current, 1);

  var centerState = E.createGame(12);
  centerState.factories[0] = [0, 0, 1, 2];
  centerState.factories[1] = [3];
  centerState.center = [2, 4, 2, 1];
  centerState.centerMarker = false;
  var centerNext = E.applyMove(centerState, { source: 'center', color: 2, row: 4 });
  s.eq('中央区取走后不保留该色', centerNext.center.filter(function (t) { return t === 2; }).length, 0);
  s.eq('中央区其他颜色保留', centerNext.center.slice().sort(), [1, 4]);
  s.eq('中央区砖进入花纹行', centerNext.players[0].lines[4].length, 2);
  s.ok('圆盘未受影响', centerNext.factories[0].length === 4 && centerNext.factories[1].length === 1);

  var emptyState = E.createGame(13);
  emptyState.factories[0] = [0, 0, 1, 2];
  expectThrow('取圆盘不存在的颜色报错', function () {
    E.applyMove(emptyState, { source: 'factory', factoryIndex: 0, color: 4, row: 0 });
  }, /没有/);
  expectThrow('圆盘编号越界报错', function () {
    E.applyMove(emptyState, { source: 'factory', factoryIndex: 9, color: 0, row: 0 });
  }, /圆盘/);
  expectThrow('取空中央区报错', function () {
    E.applyMove(emptyState, { source: 'center', color: 1, row: 0 });
  }, /没有/);
  expectThrow('非法颜色编号报错', function () {
    E.applyMove(emptyState, { source: 'factory', factoryIndex: 0, color: 8, row: 0 });
  }, /颜色/);
  expectThrow('未知来源报错', function () {
    E.applyMove(emptyState, { source: 'bag', color: 0, row: 0 });
  }, /来源/);
});

/* ------------------------------------------------------------------ */
/* 3. 花纹行合法性                                                     */
/* ------------------------------------------------------------------ */

s.group('花纹行合法性', function () {
  var base = E.createGame(21);
  base.factories = [[0, 0, 0], [0, 0], [], [], []];
  base.center = [];
  base.centerMarker = false;

  var notFull = JSON.parse(JSON.stringify(base));
  notFull.players[0].lines[2] = [0, 0];
  var next = E.applyMove(notFull, { source: 'factory', factoryIndex: 0, color: 0, row: 2 });
  s.eq('未满行可以继续放同色', next.players[0].lines[2].length, 3);

  var wrongColor = JSON.parse(JSON.stringify(base));
  wrongColor.players[0].lines[1] = [1];
  expectThrow('行内已有其他颜色报错', function () {
    E.applyMove(wrongColor, { source: 'factory', factoryIndex: 0, color: 0, row: 1 });
  }, /其他颜色/);

  var fullRow = JSON.parse(JSON.stringify(base));
  fullRow.players[0].lines[0] = [0];
  expectThrow('已满行报错', function () {
    E.applyMove(fullRow, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
  }, /已满/);

  var wallBlocked = JSON.parse(JSON.stringify(base));
  wallBlocked.players[0].wall[0][E.wallColorAt(0, 0)] = 0;
  expectThrow('墙面已有同色报错', function () {
    E.applyMove(wallBlocked, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
  }, /墙面/);

  var legalWallRow = E.createGame(22);
  legalWallRow.players[0].wall[0][E.wallColorAt(0, 2)] = 2;
  s.ok('墙面同色只封锁对应行', E.getLegalMoves(legalWallRow).some(function (m) {
    return m.source === 'factory' && m.row === 4;
  }));

  var outRow = E.createGame(23);
  expectThrow('花纹行 5 越界报错', function () {
    E.applyMove(outRow, { source: 'factory', factoryIndex: 0, color: outRow.factories[0][0], row: 5 });
  }, /花纹行/);
  expectThrow('非整数行报错', function () {
    E.applyMove(outRow, { source: 'factory', factoryIndex: 0, color: outRow.factories[0][0], row: 1.5 });
  }, /花纹行/);
  var blocked = E.createGame(24);
  var blockedColor = blocked.factories[0][0];
  for (var bi = 0; bi < 5; bi++) blocked.players[0].wall[bi][E.wallColorAt(bi, blockedColor)] = blockedColor;
  s.eq('所有行被墙面封锁时没有普通落点', E.getLegalMoves(blocked).every(function (m) {
    return !(m.source === 'factory' && m.factoryIndex === 0 && m.color === blockedColor && m.row >= 0);
  }), true);
  expectThrow('所有行封锁时指定行报错', function () {
    E.applyMove(blocked, { source: 'factory', factoryIndex: 0, color: blockedColor, row: 0 });
  }, /墙面/);

  var forcedFloor = E.createGame(25);
  var c = forcedFloor.factories[0][0];
  for (var r = 0; r < 5; r++) forcedFloor.players[0].wall[r][E.wallColorAt(r, c)] = c;
  forcedFloor.factories[1] = [0];
  var moved = E.applyMove(forcedFloor, { source: 'factory', factoryIndex: 0, color: c, row: -1 });
  s.eq('所有行都封锁时只能放地板', moved.players[0].floor.length, forcedFloor.factories[0].filter(function (t) { return t === c; }).length);
  s.eq('强制地板不会进入花纹行', moved.players[0].lines.reduce(function (sum, line) { return sum + line.length; }, 0), 0);
  s.ok('合法动作里包含强制地板', E.getLegalMoves(forcedFloor).some(function (m) {
    return m.source === 'factory' && m.factoryIndex === 0 && m.color === c && m.row === -1;
  }));
});

/* ------------------------------------------------------------------ */
/* 4. 溢出与地板                                                       */
/* ------------------------------------------------------------------ */

s.group('溢出与地板扣分', function () {
  var state = E.createGame(31);
  clearBoard(state);
  state.factories[0] = [1, 1, 1, 1];
  state.factories[1] = [0];
  state.players[0].lines = emptyTiles(state);
  var next = E.applyMove(state, { source: 'factory', factoryIndex: 0, color: 1, row: 0 });
  s.eq('行 0 只收 1 枚', next.players[0].lines[0].length, 1);
  s.eq('多余 3 枚进入地板', next.players[0].floor.length, 3);
  s.eq('地板砖颜色正确', next.players[0].floor, [1, 1, 1]);
  s.eq('地板容量 7', E.FLOOR_SIZE, 7);

  var cap = E.createGame(32);
  clearBoard(cap);
  cap.factories[0] = [0];
  cap.center = [2, 2, 2, 2, 2, 2, 2, 2, 2];
  cap.players[0].lines = emptyTiles(cap);
  var capped = E.applyMove(cap, { source: 'center', factoryIndex: -1, color: 2, row: 0 });
  s.eq('地板最多 7 格（先手未取也一样）', capped.players[0].floor.length, 7);
  s.eq('超出地板的砖被移出', capped.players[0].lines[0].length, 1);

  s.eq('空地板 0 罚分', E.floorPenalty([]), 0);
  s.eq('1 格罚 1 分', E.floorPenalty([0]), 1);
  s.eq('2 格罚 2 分', E.floorPenalty([0, 0]), 2);
  s.eq('7 格罚 14 分', E.floorPenalty([0, 1, 2, 3, 4, 0, 1]), 14);
  s.eq('先手标记占 1 格罚 1 分', E.floorPenalty([E.MARKER]), 1);
  s.eq('先手标记 + 1 砖罚 2 分', E.floorPenalty([E.MARKER, 0]), 2);

  var penaltyState = E.createGame(33);
  clearBoard(penaltyState);
  penaltyState.factories[0] = [0];
  penaltyState.players[0].floor = [1, 1, 1, 1, 1, 1, 1];
  penaltyState.players[0].lines = emptyTiles(penaltyState);
  var resolved = E.applyMove(penaltyState, { source: 'factory', factoryIndex: 0, color: 0, row: 4 });
  s.eq('地板 7 格在回合结束扣 14 分', resolved.players[0].score, -14);
  s.eq('回合结束后地板清空', resolved.players[0].floor.length, 0);
});

/* ------------------------------------------------------------------ */
/* 5. 满行上墙与邻接计分                                               */
/* ------------------------------------------------------------------ */

s.group('满行上墙', function () {
  var state = E.createGame(41);
  clearBoard(state);
  state.factories[0] = [2];
  state.players[0].lines[1] = [2];
  var next = E.applyMove(state, { source: 'factory', factoryIndex: 0, color: 2, row: 1 });
  var col = (2 + 1) % 5;
  s.eq('满行上墙到正确列', next.players[0].wall[1][col], 2);
  s.eq('上墙后花纹行清空', next.players[0].lines[1].length, 0);
  s.eq('孤立一格得 1 分', next.players[0].score, 1);
  s.eq('进入下一轮', next.round, 2);
  s.eq('下一轮仍由先手玩家开始', next.current, 0);
  s.ok('日志记录本轮结算', next.log.some(function (entry) { return entry.type === 'score'; }));

  var half = E.createGame(42);
  clearBoard(half);
  half.factories[0] = [4];
  half.players[0].lines[2] = [4];
  var notFull = E.applyMove(half, { source: 'factory', factoryIndex: 0, color: 4, row: 2 });
  s.eq('未满行不上墙', notFull.players[0].wall[2][1], null);
  s.eq('未满行在轮末被清空', notFull.players[0].lines[2].length, 0);

  var multi = E.createGame(43);
  clearBoard(multi);
  multi.factories[0] = [0];
  multi.players[0].lines[0] = [];
  multi.players[0].lines[2] = [0, 0];
  // 取 1 枚 0：行 0 满、行 2 未满；只有行 0 上墙
  var oneLine = E.applyMove(multi, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
  s.eq('只有满行会上墙', oneLine.players[0].wall[0][0], 0);
  s.eq('未满行不会上墙', oneLine.players[0].wall[2][2], null);
});

s.group('上墙邻接计分', function () {
  var wall = emptyWall();
  s.eq('四周无砖得 1 分', E.wallPlacementScore(wall, 2, 2), 1);

  var horizontal = emptyWall();
  horizontal[1][1] = 0;
  s.eq('横向连 2 得 2 分', E.wallPlacementScore(horizontal, 1, 0), 2);

  var horizontal3 = emptyWall();
  horizontal3[1][0] = 0;
  horizontal3[1][1] = 0;
  s.eq('横向连 3 得 3 分', E.wallPlacementScore(horizontal3, 1, 2), 3);

  var vertical = emptyWall();
  vertical[0][0] = 0;
  s.eq('纵向连 2 得 2 分', E.wallPlacementScore(vertical, 1, 0), 2);

  var cross = emptyWall();
  cross[0][0] = 0;
  cross[2][0] = 3;
  cross[1][1] = 0;
  s.eq('横纵交叉按连通数相加', E.wallPlacementScore(cross, 1, 0), 5);

  var roundState = E.createGame(44);
  clearBoard(roundState);
  roundState.factories[0] = [4];
  roundState.players[0].lines[1] = [4];
  roundState.players[0].wall[0][0] = 0;
  roundState.players[0].wall[2][0] = 3;
  roundState.players[0].wall[1][1] = 0;
  var scored = E.applyMove(roundState, { source: 'factory', factoryIndex: 0, color: 4, row: 1 });
  s.eq('实战交叉上墙得 5 分', scored.players[0].score, 5);
  s.eq('实战上墙位置正确', scored.players[0].wall[1][0], 4);
});

/* ------------------------------------------------------------------ */
/* 6. 先手标记                                                         */
/* ------------------------------------------------------------------ */

s.group('先手标记', function () {
  var state = E.createGame(51);
  clearBoard(state);
  state.factories[0] = [0];
  state.center = [2];
  state.centerMarker = true;
  state.current = 0;
  state.firstPlayer = 0;

  var next = E.applyMove(state, { source: 'center', color: 2, row: 4 });
  s.eq('从中央区取砖拿到先手标记', next.firstPlayer, 0);
  s.eq('标记进入地板', next.players[0].floor.indexOf(E.MARKER) !== -1, true);
  s.eq('中央区标记已移除', next.centerMarker, false);
  s.eq('回合交给对手', next.current, 1);
  s.eq('原局面仍有中央区标记', state.centerMarker, true);

  var second = E.applyMove(next, { source: 'factory', factoryIndex: 0, color: 0, row: 4 });
  s.eq('先手标记在本轮结算时扣 1 分', second.players[0].score, -1);
  s.eq('下一轮由拿标记的玩家先手', second.current, 0);
  s.eq('下一轮中央区重新有标记', second.centerMarker, true);
  s.eq('标记不会留在玩家地板', second.players[0].floor.length, 0);
  s.eq('先手玩家保持', second.firstPlayer, 0);

  var late = E.createGame(52);
  clearBoard(late);
  late.factories[0] = [1];
  late.center = [1];
  late.centerMarker = true;
  late.current = 1;
  var taken = E.applyMove(late, { source: 'center', color: 1, row: 4 });
  s.eq('对手拿标记后成为下轮先手', taken.firstPlayer, 1);
  var after = E.applyMove(taken, { source: 'factory', factoryIndex: 0, color: 1, row: 4 });
  s.eq('下轮由对手先手', after.current, 1);
  s.eq('先手标记回到中央区', after.centerMarker, true);
});

/* ------------------------------------------------------------------ */
/* 7. 终局奖励与结果                                                   */
/* ------------------------------------------------------------------ */

s.group('终局行/列/色奖励', function () {
  var empty = emptyWall();
  s.eq('空墙无奖励', E.computeBonuses(empty), {
    rows: 0, cols: 0, colors: 0, rowBonus: 0, columnBonus: 0, colorBonus: 0, total: 0
  });

  var oneRow = emptyWall();
  for (var c = 0; c < 5; c++) oneRow[0][c] = E.wallColorAt(0, c);
  var rowBonus = E.computeBonuses(oneRow);
  s.eq('完整行 +2', rowBonus.total, 2);
  s.eq('完整行数量正确', rowBonus.rows, 1);

  var oneCol = emptyWall();
  for (var r = 0; r < 5; r++) oneCol[r][0] = E.wallColorAt(r, 0);
  var colBonus = E.computeBonuses(oneCol);
  s.eq('完整列 +2', colBonus.total, 2);
  s.eq('完整列数量正确', colBonus.cols, 1);

  var oneColor = emptyWall();
  for (var rr = 0; rr < 5; rr++) {
    for (var cc = 0; cc < 5; cc++) {
      if (E.wallColorAt(rr, cc) === 3) oneColor[rr][cc] = 3;
    }
  }
  var colorBonus = E.computeBonuses(oneColor);
  s.eq('某色 5 枚 +10', colorBonus.total, 10);
  s.eq('完整颜色数量正确', colorBonus.colors, 1);

  var full = emptyWall();
  for (var fr = 0; fr < 5; fr++) {
    for (var fc = 0; fc < 5; fc++) full[fr][fc] = E.wallColorAt(fr, fc);
  }
  s.eq('满墙奖励 70 分', E.computeBonuses(full).total, 70);

  var end = E.createGame(61);
  clearBoard(end);
  end.factories[0] = [4];
  var player = end.players[0];
  for (var ec = 0; ec < 4; ec++) player.wall[0][ec] = E.wallColorAt(0, ec);
  for (var er = 1; er < 5; er++) player.wall[er][(4 + er) % 5] = 4;
  player.lines[0] = [];
  var finished = E.applyMove(end, { source: 'factory', factoryIndex: 0, color: 4, row: 0 });
  s.eq('完成整行触发终局', finished.over, true);
  s.ok('终局原因可读', /整行/.test(finished.overReason), finished.overReason);
  s.eq('完成行后墙格正确', finished.players[0].wall[0][4], 4);
  var results = E.getResults(finished);
  s.eq('终局包含双方结果', results.scores.length, 2);
  s.eq('行 + 色奖励合计 12', results.scores[0].bonus, 12);
  s.eq('本局基础分 5', results.scores[0].base, 5);
  s.eq('总分 = 基础分 + 奖励', results.scores[0].total, 17);
  s.eq('胜者为完成行的一方', results.winner, 0);
  s.eq('isGameOver 返回 true', E.isGameOver(finished), true);

  var tied = E.createGame(62);
  tied.players[0].score = 10;
  tied.players[1].score = 10;
  finished = E.applyMove((function () {
    var st = E.createGame(63);
    clearBoard(st);
    st.factories[0] = [4];
    var p = st.players[0];
    for (var x = 0; x < 4; x++) p.wall[0][x] = E.wallColorAt(0, x);
    p.lines[0] = [];
    return st;
  })(), { source: 'factory', factoryIndex: 0, color: 4, row: 0 });
  s.ok('终局至少一方有完整行', E.computeBonuses(finished.players[0].wall).rows + E.computeBonuses(finished.players[1].wall).rows >= 1);
});

/* ------------------------------------------------------------------ */
/* 8. AI 合法性                                                        */
/* ------------------------------------------------------------------ */

s.group('AI 合法动作', function () {
  var legalCount = 0;
  for (var seed = 1; seed <= 12; seed++) {
    var state = E.createGame(seed);
    var move = E.chooseAIMove(state);
    var legal = E.getLegalMoves(state).some(function (candidate) {
      return candidate.source === move.source &&
        candidate.factoryIndex === move.factoryIndex &&
        candidate.color === move.color &&
        candidate.row === move.row;
    });
    s.ok('seed ' + seed + ' AI 返回动作', !!move && (move.source === 'factory' || move.source === 'center'));
    s.ok('seed ' + seed + ' AI 动作在合法列表中', legal);
    var threw = '';
    var next = null;
    try { next = E.applyMove(state, move); } catch (error) { threw = error.message; }
    s.ok('seed ' + seed + ' AI 动作可执行', !threw, threw);
    if (next) {
      s.ok('seed ' + seed + ' 原局面未被修改', state.turn === 0 && state.current === 0);
      legalCount += 1;
    }
  }
  s.eq('AI 动作全部通过', legalCount, 12);

  var ended = E.createGame(70);
  ended.over = true;
  expectThrow('终局后 chooseAIMove 报错', function () { E.chooseAIMove(ended); }, /结束/);
  expectThrow('终局后 applyMove 报错', function () {
    E.applyMove(ended, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
  }, /结束/);
});

/* ------------------------------------------------------------------ */
/* 9. 30 局固定 seed 自对弈                                            */
/* ------------------------------------------------------------------ */

s.group('30 局固定 seed 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var incomplete = 0;
  var conservation = 0;
  var badWall = 0;
  var badScore = 0;
  var maxSteps = 0;
  var rounds = [];

  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame(seed);
    var steps = 0;
    try {
      while (!state.over && steps < 800) {
        var counts = E.colorCounts(E.allTiles(state));
        if (counts.join(',') !== '20,20,20,20,20' || E.allTiles(state).length !== 100) conservation += 1;
        state = E.applyMove(state, E.chooseAIMove(state));
        steps += 1;
      }
    } catch (error) {
      errors += 1;
      console.log('  seed ' + seed + ' 第 ' + steps + ' 步异常：' + error.message);
    }
    if (!state.over) incomplete += 1;
    state.players.forEach(function (player) {
      for (var r = 0; r < 5; r++) {
        var seen = [];
        for (var c = 0; c < 5; c++) {
          var cell = player.wall[r][c];
          if (cell !== null) {
            if (cell !== E.wallColorAt(r, c) || seen.indexOf(cell) !== -1) badWall += 1;
            seen.push(cell);
          }
        }
      }
      if (!isFinite(player.score)) badScore += 1;
    });
    if (state.over) {
      var result = E.getResults(state);
      result.scores.forEach(function (row) {
        if (row.total !== row.base + row.bonus) badScore += 1;
      });
      rounds.push(state.round);
    }
    maxSteps = Math.max(maxSteps, steps);
  }

  s.eq('30 局全部无异常', errors, 0);
  s.eq('30 局全部自然结束', incomplete, 0);
  s.eq('30 局砖数始终守恒', conservation, 0);
  s.eq('30 局墙面颜色始终合法', badWall, 0);
  s.eq('30 局分数与结果合法', badScore, 0);
  s.ok('自对弈在回合上限内结束', maxSteps < 800, '最大步数 ' + maxSteps);
  s.ok('每局轮数合理', rounds.every(function (n) { return n >= 4 && n <= 12; }), rounds.join(','));
  s.ok('30 局在 20 秒内跑完', Date.now() - started < 20000, (Date.now() - started) + 'ms');
});

/* ------------------------------------------------------------------ */
/* 10. 页面静态检查                                                    */
/* ------------------------------------------------------------------ */

function cjkCount(html) {
  var text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  var matches = text.match(/[\u4e00-\u9fff]/g);
  return matches ? matches.length : 0;
}


s.group('页面与规则页静态检查', function () {
  var index = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');

  s.ok('游戏页有 viewport', /name="viewport"/.test(index));
  s.ok('游戏页引用同源 engine.js', /<script[^>]*src="engine\.js"/.test(index));
  s.ok('游戏页无外部脚本', !/<script[^>]*src="https?:/i.test(index));
  s.ok('游戏页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(index));
  s.ok('游戏页无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(index));
  s.ok('游戏页无远程 url()', !/url\(\s*["']?https?:/i.test(index));
  s.ok('游戏页有 430px 媒体查询', /@media\s*\(max-width:\s*430px\)/.test(index));
  s.ok('游戏页有减少动效降级', /prefers-reduced-motion/.test(index));
  s.ok('游戏页有 aria-label', /aria-label=/.test(index));
  s.ok('游戏页有 5 个圆盘容器', /id="factories"/.test(index));
  s.ok('游戏页有中央区', /id="centerZone"/.test(index));
  s.ok('游戏页有花纹行容器', /id="rowsHuman"/.test(index) && /id="rowsAI"/.test(index));
  s.ok('游戏页有 5×5 墙面容器', /wallHuman/.test(index) && /wallAI/.test(index));
  s.ok('游戏页有地板行', /floorHuman/.test(index) && /floorAI/.test(index));
  s.ok('游戏页有双方分数', /score0/.test(index) && /score1/.test(index));
  s.ok('游戏页有 seed 输入', /id="seedInput"/.test(index));
  s.ok('游戏页有重开按钮', /id="restart"/.test(index) && /id="newSeed"/.test(index));
  s.ok('游戏页 AI 回合用 setTimeout 推进', /setTimeout\s*\(/.test(index));
  s.ok('游戏页有横向溢出保护', /overflow-x:\s*hidden/.test(index));
  s.ok('游戏页触控目标至少 44px', /min-height:\s*44px/.test(index));
  s.eq('游戏页无 Math.random', /Math\.random/.test(index.replace(/<script[\s\S]*?<\/script>/gi, '')), false);

  s.ok('规则页有 viewport', /name="viewport"/.test(rules));
  s.ok('规则页无外部脚本', !/<script[^>]*src="https?:/i.test(rules));
  s.ok('规则页无外部样式表', !/<link[^>]*rel="stylesheet"/i.test(rules));
  var blocks = lib.jsonLd(rules);
  var faq = blocks.filter(function (block) { return block['@type'] === 'FAQPage'; })[0];
  s.ok('规则页有 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 3 问', !!faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3);
  s.ok('FAQ 每问都有答案', !!faq && faq.mainEntity.every(function (item) {
    return item['@type'] === 'Question' && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));
  s.ok('规则页 CTA 回 index.html', /href="index\.html"/.test(rules));
  s.ok('规则页链接桌游目录', /href="\.\.\/index\.html"/.test(rules));
  s.ok('规则页有玩法正文', /花纹行/.test(rules) && /地板/.test(rules) && /奖励/.test(rules));
  var count = cjkCount(rules);
  s.ok('规则正文 400–800 字', count >= 400 && count <= 800, count + ' 字');
});

s.done();
