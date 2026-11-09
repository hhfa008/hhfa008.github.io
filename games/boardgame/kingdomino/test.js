'use strict';

/*
 * Kingdomino（多米诺王国）引擎测试。
 *
 * 页面与测试共用同源 engine.js；这里直接 require 引擎，避免复制规则。
 * 运行：node games/boardgame/kingdomino/test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('../../tests/lib.js');
var s = lib.suite('kingdomino');

var E = require('./engine.js');

/* ------------------------------------------------------------------ */
/* 测试小工具                                                          */
/* ------------------------------------------------------------------ */

function emptyGrid() {
  var grid = [];
  for (var r = 0; r < 5; r++) {
    var row = [];
    for (var c = 0; c < 5; c++) row.push(null);
    grid.push(row);
  }
  grid[2][2] = { castle: true };
  return grid;
}

function put(grid, r, c, terrain, crowns) {
  grid[r][c] = { terrain: terrain, crowns: crowns, tileId: 1 };
}

function moveKey(move) {
  return move.tileId + '/' + move.orientation + '/' + move.row + '/' + move.col;
}

function expectThrow(label, fn, pattern) {
  var message = '';
  try { fn(); } catch (error) { message = String(error && error.message || error); }
  s.ok(label, !!message && (!pattern || pattern.test(message)), message || '没有抛出异常');
}

function mixedTileId() {
  for (var i = 0; i < E.TILES.length; i++) {
    if (E.TILES[i].a.terrain !== E.TILES[i].b.terrain) return E.TILES[i].id;
  }
  return null;
}

function moveCells(move) {
  return E.orientationCells(move.orientation).map(function (offset) {
    return [move.row + offset[0], move.col + offset[1]];
  });
}

function resultsState(grid0, grid1) {
  return {
    players: [
      { index: 0, name: '你', isAI: false, grid: grid0, placedCount: 2 },
      { index: 1, name: 'AI 对手', isAI: true, grid: grid1, placedCount: 2 }
    ],
    over: true,
    overReason: '测试结束'
  };
}

/* ------------------------------------------------------------------ */
/* 1. 48 张瓦片数据                                                    */
/* ------------------------------------------------------------------ */

s.group('48 张瓦片数据', function () {
  s.eq('瓦片总数 48', E.TILES.length, 48);
  s.eq('瓦片 ID 唯一', new Set(E.TILES.map(function (t) { return t.id; })).size, 48);
  s.eq('瓦片 ID 正好是 1–48', E.TILES.map(function (t) { return t.id; }).join(','),
    Array.from({ length: 48 }, function (_, i) { return i + 1; }).join(','));

  var terrainCount = 0;
  var badTerrain = [];
  var badCrowns = [];
  var totalCrowns = 0;
  E.TILES.forEach(function (tile) {
    [tile.a, tile.b].forEach(function (half) {
      terrainCount += 1;
      if (E.TERRAIN_LIST.indexOf(half.terrain) === -1) badTerrain.push(tile.id + ':' + half.terrain);
      if (!Number.isInteger(half.crowns) || half.crowns < 0 || half.crowns > 3) {
        badCrowns.push(tile.id + ':' + half.crowns);
      }
      totalCrowns += half.crowns;
    });
  });
  s.eq('96 个半格都有地形', terrainCount, 96);
  s.eq('地形全部合法', badTerrain, []);
  s.eq('皇冠全是 0–3 的整数', badCrowns, []);
  s.ok('皇冠总数为正', totalCrowns > 0, String(totalCrowns));
  s.eq('六种地形都出现', E.TERRAIN_LIST.every(function (terrain) {
    return E.TILES.some(function (tile) {
      return tile.a.terrain === terrain || tile.b.terrain === terrain;
    });
  }), true);
  s.eq('TILE_BY_ID 可按 ID 查询', [E.TILE_BY_ID[1].id, E.TILE_BY_ID[48].id], [1, 48]);
  s.eq('每张牌恰好两个半格', E.TILES.every(function (tile) {
    return tile.a && tile.b && E.TERRAIN_LIST.indexOf(tile.a.terrain) !== -1 &&
      E.TERRAIN_LIST.indexOf(tile.b.terrain) !== -1;
  }), true);
});

/* ------------------------------------------------------------------ */
/* 2. 开局、城堡与草稿队列                                             */
/* ------------------------------------------------------------------ */

s.group('开局与草稿队列', function () {
  var state = E.createGame(1);
  s.eq('双人局', state.players.length, 2);
  s.eq('你是人类、对手是 AI', [state.players[0].isAI, state.players[1].isAI], [false, true]);
  s.eq('双方城堡都在 5×5 中心', state.players.map(function (p) {
    return p.grid[2][2] && p.grid[2][2].castle === true;
  }), [true, true]);
  s.eq('开局只有城堡一格', state.players.map(function (p) {
    var n = 0;
    p.grid.forEach(function (row) { row.forEach(function (cell) { if (cell) n++; }); });
    return n;
  }), [1, 1]);
  s.eq('开局王国得分 0', state.players.map(function (p) { return E.scoreKingdom(p.grid); }), [0, 0]);

  s.eq('本轮亮出 4 张', state.draft.length, 4);
  s.eq('草稿按编号升序', state.draft.map(function (d) { return d.tileId; }).slice().sort(function (a, b) {
    return a - b;
  }), state.draft.map(function (d) { return d.tileId; }));
  s.eq('未选瓦片都在 48 张牌表中', state.draft.every(function (d) { return !!E.getTile(d.tileId); }), true);
  s.eq('牌库还剩 20 张', state.drawPile.length, 20);
  s.eq('本局共抽 24 张且不重复', new Set(state.draft.map(function (d) {
    return d.tileId;
  }).concat(state.drawPile)).size, 24);
  s.eq('开局轮次与先手', [state.round, state.pickIndex, state.current, state.firstPlayer], [1, 0, 0, 0]);
  s.eq('1-2-1 选牌顺序', state.order, [0, 1, 1, 0]);
  s.eq('当前选牌者是先手', E.getCurrentPickPlayer(state), 0);
  s.eq('开局未结束', [state.over, E.isGameOver(state)], [false, false]);
  s.eq('currentPlayer 返回玩家对象', E.currentPlayer(state).index, 0);

  var again = E.createGame(1);
  s.eq('相同 seed 抽到相同 24 张', again.drawPile.slice(), state.drawPile.slice());
  s.eq('相同 seed 首轮草稿一致', again.draft.map(function (d) { return d.tileId; }),
    state.draft.map(function (d) { return d.tileId; }));

  var other = E.createGame(2);
  s.ok('不同 seed 抽牌不同', other.draft.map(function (d) { return d.tileId; }).join(',') !==
    state.draft.map(function (d) { return d.tileId; }).join(','));
});

/* ------------------------------------------------------------------ */
/* 3. 朝向、旋转与两格位置                                             */
/* ------------------------------------------------------------------ */

s.group('朝向与两格', function () {
  s.eq('横向朝下两格', [E.orientationCells(0), E.orientationCells(1)],
    [[[0, 0], [0, 1]], [[0, 0], [0, 1]]]);
  s.eq('纵向朝下两格', [E.orientationCells(2), E.orientationCells(3)],
    [[[0, 0], [1, 0]], [[0, 0], [1, 0]]]);
  s.eq('非法朝向返回 null', E.orientationCells(9), null);

  var probe = E.createGame(1);
  var id = probe.draft.map(function (d) { return d.tileId; }).filter(function (tileId) {
    var candidate = E.getTile(tileId);
    return candidate.a.terrain !== candidate.b.terrain;
  })[0];
  if (id == null) id = mixedTileId();
  s.ok('首轮草稿中存在两种地形的瓦片', id != null, String(id));
  var tile = E.getTile(id);
  s.eq('朝向 0 是 A 左 B 右', E.orientationHalves(id, 0), [tile.a, tile.b]);
  s.eq('朝向 1 交换两半', E.orientationHalves(id, 1), [tile.b, tile.a]);
  s.eq('朝向 2 是 A 上 B 下', E.orientationHalves(id, 2), [tile.a, tile.b]);
  s.eq('朝向 3 交换上下两半', E.orientationHalves(id, 3), [tile.b, tile.a]);

  s.eq('顺时针旋转一圈回到原朝向', [0, 1, 2, 3].every(function (start) {
    var current = start;
    for (var i = 0; i < 4; i++) current = E.rotateOrientation(current);
    return current === start;
  }), true);
  s.eq('旋转顺序 0→2→1→3→0', [0, 1, 2, 3].map(E.rotateOrientation), [2, 3, 1, 0]);
  s.eq('翻转两次回到原朝向', [0, 1, 2, 3].every(function (start) {
    return E.flipOrientation(E.flipOrientation(start)) === start;
  }), true);
  s.eq('朝向 0 翻转后为朝向 1', E.flipOrientation(0), 1);
  s.eq('朝向 2 翻转后为朝向 3', E.flipOrientation(2), 3);

  // 在真实开局中分别用 4 种朝向落子，检查两格地形顺序。
  [0, 1, 2, 3].forEach(function (orientation) {
    var state = E.createGame(1);
    var move = E.getLegalMoves(state).filter(function (m) {
      return m.tileId === id && m.orientation === orientation;
    })[0];
    s.ok('朝向 ' + orientation + ' 存在合法落点', !!move);
    if (!move) return;
    var next = E.applyMove(state, move);
    var halves = E.orientationHalves(id, orientation);
    var cells = moveCells(move);
    s.eq('朝向 ' + orientation + ' 落子地形正确', cells.map(function (pos) {
      return next.players[0].grid[pos[0]][pos[1]].terrain;
    }), halves.map(function (half) { return half.terrain; }));
    s.eq('朝向 ' + orientation + ' 落子皇冠正确', cells.map(function (pos) {
      return next.players[0].grid[pos[0]][pos[1]].crowns;
    }), halves.map(function (half) { return half.crowns; }));
  });
});

/* ------------------------------------------------------------------ */
/* 4. 邻接、边界、重叠与不可变性                                       */
/* ------------------------------------------------------------------ */

s.group('放置合法性', function () {
  var state = E.createGame(1);
  var tileId = state.draft[0].tileId;
  var legal = E.getLegalMoves(state);
  s.ok('开局存在合法落点', legal.length > 0, String(legal.length));
  s.eq('开局所有落点都贴着城堡', legal.every(function (move) {
    return moveCells(move).some(function (pos) {
      return Math.abs(pos[0] - 2) + Math.abs(pos[1] - 2) === 1;
    });
  }), true);

  var far = E.canPlaceFor(state, 0, tileId, 0, 0, 0);
  s.ok('远离城堡拒绝', !far.ok && /相邻/.test(far.reason), far.reason);
  var out = E.canPlaceFor(state, 0, tileId, 0, 0, 4);
  s.ok('横向越界拒绝', !out.ok && /边界/.test(out.reason), out.reason);
  var downOut = E.canPlaceFor(state, 0, tileId, 2, 4, 0);
  s.ok('纵向越界拒绝', !downOut.ok && /边界/.test(downOut.reason), downOut.reason);
  var castle = E.canPlaceFor(state, 0, tileId, 0, 2, 1);
  s.ok('不能覆盖城堡', !castle.ok && /城堡/.test(castle.reason), castle.reason);

  var snapshot = JSON.stringify(state);
  var move = legal[0];
  var next = E.applyMove(state, move);
  s.eq('applyMove 不修改原 state', JSON.stringify(state), snapshot);
  s.ok('applyMove 返回全新对象', next !== state && next.players[0] !== state.players[0]);
  s.eq('落子后玩家瓦片数 +1', [state.players[0].placedCount, next.players[0].placedCount], [0, 1]);
  s.ok('落子后选牌指针前进', next.pickIndex !== state.pickIndex || next.round !== state.round);

  var overlap = E.canPlaceFor(next, 0, tileId, move.orientation, move.row, move.col);
  s.ok('已占格重叠拒绝', !overlap.ok && /重叠/.test(overlap.reason), overlap.reason);

  var unavailable = E.TILES.map(function (t) { return t.id; }).filter(function (id) {
    return state.draft.every(function (d) { return d.tileId !== id; }) &&
      state.drawPile.indexOf(id) === -1;
  })[0];
  expectThrow('本轮未亮出的瓦片拒绝', function () {
    E.applyMove(state, { tileId: unavailable, orientation: 0, row: 1, col: 1 });
  }, /待选|队列|非法/);
  expectThrow('非法朝向抛错', function () {
    E.applyMove(state, { tileId: tileId, orientation: 4, row: 1, col: 1 });
  }, /朝向/);
  expectThrow('非整数坐标抛错', function () {
    E.applyMove(state, { tileId: tileId, orientation: 0, row: 1.5, col: 1 });
  }, /整数/);
  expectThrow('对局结束后不能再落子', function () {
    var ended = JSON.parse(JSON.stringify(state));
    ended.over = true;
    E.applyMove(ended, { tileId: tileId, orientation: 0, row: 1, col: 1 });
  }, /结束/);

  var allApply = true;
  legal.slice(0, 10).forEach(function (candidate) {
    var copy = JSON.parse(JSON.stringify(state));
    try { E.applyMove(copy, candidate); } catch (error) { allApply = false; }
  });
  s.ok('getLegalMoves 中的动作都能应用', allApply);
});

/* ------------------------------------------------------------------ */
/* 5. 计分                                                             */
/* ------------------------------------------------------------------ */

s.group('地形连通计分', function () {
  var base = emptyGrid();
  s.eq('只有城堡得 0 分', E.scoreKingdom(base), 0);

  var connected = emptyGrid();
  put(connected, 2, 1, 'wheat', 1);
  put(connected, 2, 0, 'wheat', 0);
  put(connected, 1, 1, 'wheat', 1);
  s.eq('连通麦田 3 格 × 2 皇冠 = 6', E.scoreKingdom(connected), 6);
  s.eq('连通区域数为 1', E.scoreDetails(connected).regionCount, 1);
  s.eq('最大区域面积为 3', E.scoreDetails(connected).maxRegion, 3);

  var separated = emptyGrid();
  put(separated, 0, 0, 'wheat', 2);
  put(separated, 4, 4, 'wheat', 3);
  s.eq('同地形不连通则分成两块', E.scoreDetails(separated).regionCount, 2);
  s.eq('不连通两块各自计分', E.scoreKingdom(separated), 5);

  var different = emptyGrid();
  put(different, 1, 1, 'forest', 2);
  put(different, 1, 2, 'wheat', 3);
  s.eq('不同地形相邻也分开计分', E.scoreKingdom(different), 5);
  s.eq('不同地形产生两个区域', E.scoreDetails(different).regionCount, 2);

  var none = emptyGrid();
  put(none, 0, 0, 'water', 0);
  put(none, 0, 1, 'water', 0);
  put(none, 0, 2, 'water', 0);
  put(none, 1, 0, 'water', 0);
  put(none, 1, 1, 'water', 0);
  put(none, 1, 2, 'water', 0);
  put(none, 2, 0, 'water', 0);
  put(none, 2, 1, 'water', 0);
  s.eq('无皇冠的 8 格区域得 0 分', E.scoreKingdom(none), 0);

  var multi = emptyGrid();
  put(multi, 0, 0, 'wheat', 1);
  put(multi, 0, 1, 'wheat', 1);
  put(multi, 4, 0, 'water', 2);
  put(multi, 4, 1, 'water', 0);
  put(multi, 4, 2, 'water', 0);
  s.eq('多区域求和 2×2 + 3×2 = 10', E.scoreKingdom(multi), 10);
  s.eq('多区域皇冠总数为 4', E.scoreDetails(multi).crowns, 4);

  var diagonal = emptyGrid();
  put(diagonal, 0, 0, 'grass', 2);
  put(diagonal, 1, 1, 'grass', 2);
  s.eq('对角不算连通', E.scoreDetails(diagonal).regionCount, 2);
  s.eq('对角两格各自计分', E.scoreKingdom(diagonal), 4);

  var castleSplit = emptyGrid();
  put(castleSplit, 2, 1, 'swamp', 2);
  put(castleSplit, 2, 3, 'swamp', 3);
  s.eq('城堡阻断同地形连通', E.scoreDetails(castleSplit).regionCount, 2);
  s.eq('城堡两侧分别计分', E.scoreKingdom(castleSplit), 5);
});

/* ------------------------------------------------------------------ */
/* 6. 终局总分、胜者与平局规则                                         */
/* ------------------------------------------------------------------ */

s.group('终局胜负与平局', function () {
  var high = emptyGrid();
  put(high, 0, 0, 'wheat', 1);
  put(high, 0, 1, 'wheat', 1);
  var low = emptyGrid();
  put(low, 0, 0, 'wheat', 1);
  var scored = E.getResults(resultsState(high, low));
  s.eq('总分高者获胜', scored.winner, 0);
  s.eq('结果包含双方分数', scored.scores.length, 2);
  s.eq('结果分数与独立计分一致', scored.scores.map(function (row) { return row.score; }),
    [E.scoreKingdom(high), E.scoreKingdom(low)]);
  s.eq('结果带结束原因', scored.reason, '测试结束');

  var maxArea = emptyGrid();
  put(maxArea, 0, 0, 'forest', 1);
  put(maxArea, 0, 1, 'forest', 0);
  put(maxArea, 0, 2, 'forest', 0);
  put(maxArea, 0, 3, 'forest', 0);
  var splitArea = emptyGrid();
  put(splitArea, 0, 0, 'water', 1);
  put(splitArea, 0, 1, 'water', 0);
  put(splitArea, 4, 0, 'water', 1);
  put(splitArea, 4, 1, 'water', 0);
  var tieArea = E.getResults(resultsState(maxArea, splitArea));
  s.eq('平分时最大领地面积决定胜者', tieArea.winner, 0);
  s.ok('平分时记录比较项', /最大/.test(tieArea.tieBreak || ''), tieArea.tieBreak);

  var crownsA = emptyGrid();
  put(crownsA, 0, 0, 'mine', 2);
  put(crownsA, 0, 1, 'mine', 0);
  var crownsB = emptyGrid();
  put(crownsB, 0, 0, 'swamp', 1);
  put(crownsB, 0, 1, 'swamp', 0);
  put(crownsB, 4, 4, 'wheat', 2);
  var tieCrowns = E.getResults(resultsState(crownsA, crownsB));
  s.eq('总分与最大面积都相同则比皇冠', tieCrowns.winner, 1);
  s.ok('平局比较项说明皇冠', /皇冠/.test(tieCrowns.tieBreak || ''), tieCrowns.tieBreak);

  var identicalA = emptyGrid();
  put(identicalA, 0, 0, 'grass', 1);
  var identicalB = emptyGrid();
  put(identicalB, 0, 0, 'grass', 1);
  var tied = E.getResults(resultsState(identicalA, identicalB));
  s.eq('全部相同为平局', tied.winner, null);
  s.ok('完全平局有说明', /平局/.test(tied.tieBreak || ''), tied.tieBreak);
});

/* ------------------------------------------------------------------ */
/* 7. AI 合法性与 30 局自对弈                                          */
/* ------------------------------------------------------------------ */

s.group('AI 合法动作', function () {
  for (var seed = 1; seed <= 8; seed++) {
    var state = E.createGame(seed);
    var moves = E.getLegalMoves(state);
    var move = E.chooseAIMove(state);
    s.ok('seed ' + seed + ' AI 返回动作', !!move);
    s.ok('seed ' + seed + ' AI 动作来自 getLegalMoves', !!move && moves.some(function (m) {
      return moveKey(m) === moveKey(move);
    }));
    var threw = '';
    try { E.applyMove(state, move); } catch (error) { threw = error.message; }
    s.ok('seed ' + seed + ' AI 动作可应用', !threw, threw);
  }

  var deterministic = E.createGame(5);
  s.eq('同一局面 AI 选择确定', moveKey(E.chooseAIMove(deterministic)),
    moveKey(E.chooseAIMove(deterministic)));
});

s.group('30 局固定 seed 自对弈', function () {
  var started = Date.now();
  var errors = 0;
  var incomplete = 0;
  var badBoard = 0;
  var badCell = 0;
  var badScore = 0;
  var badResult = 0;
  var maxSteps = 0;
  var maxRound = 0;
  var overCount = 0;

  for (var seed = 1; seed <= 30; seed++) {
    var state = E.createGame(seed);
    var steps = 0;
    try {
      while (!state.over && steps < 60) {
        var move = E.chooseAIMove(state);
        if (!move) throw new Error('AI 返回空动作');
        state = E.applyMove(state, move);
        steps += 1;
        maxRound = Math.max(maxRound, state.round);
        state.players.forEach(function (player) {
          var occupied = 0;
          player.grid.forEach(function (row) {
            row.forEach(function (cell) {
              if (!cell) return;
              occupied += 1;
              if (cell.castle) return;
              if (E.TERRAIN_LIST.indexOf(cell.terrain) === -1 ||
                  !Number.isInteger(cell.crowns) || cell.crowns < 0 || cell.crowns > 3 ||
                  !E.getTile(cell.tileId)) badCell += 1;
            });
          });
          if (occupied !== player.placedCount * 2 + 1) badBoard += 1;
          if (player.placedCount > 12) badBoard += 1;
        });
      }
    } catch (error) {
      errors += 1;
    }
    if (!state.over) incomplete += 1;
    if (state.over) overCount += 1;
    maxSteps = Math.max(maxSteps, steps);

    if (state.over) {
      var result = E.getResults(state);
      if (!result || result.scores.length !== 2 ||
          [null, 0, 1].indexOf(result.winner) === -1) badResult += 1;
      if (result) {
        result.scores.forEach(function (row) {
          if (row.score !== E.scoreKingdom(state.players[row.index].grid)) badScore += 1;
        });
      }
    }
  }

  s.eq('30 局全部无异常', errors, 0);
  s.eq('30 局全部自然结束', incomplete, 0);
  s.eq('30 局都到达终局状态', overCount, 30);
  s.eq('30 局棋盘格数与放置数一致', badBoard, 0);
  s.eq('30 局地形、皇冠与瓦片编号合法', badCell, 0);
  s.eq('30 局总分与独立计分一致', badScore, 0);
  s.eq('30 局结果与胜者合法', badResult, 0);
  s.ok('自对弈步数不超过 24 次选牌', maxSteps <= 24, String(maxSteps));
  s.ok('对局不超过 6 轮', maxRound <= 6, String(maxRound));
  s.ok('30 局在 10 秒内跑完', Date.now() - started < 10000, (Date.now() - started) + 'ms');
});

/* ------------------------------------------------------------------ */
/* 8. 页面与规则页静态检查                                             */
/* ------------------------------------------------------------------ */

s.group('页面静态检查', function () {
  var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  s.ok('index.html 存在', html.length > 1000);
  s.ok('页面有 viewport', /name="viewport"/.test(html));
  s.ok('页面引用本地 engine.js', /src="engine\.js"/.test(html));
  s.ok('页面无外部脚本', !/<script[^>]+src=["']https?:/i.test(html));
  s.ok('页面无外部样式表', !/<link[^>]+rel=["']?stylesheet/i.test(html));
  s.ok('页面无 @import', !/@import/.test(html));
  s.ok('页面无 fetch / XHR', !/\bfetch\s*\(|XMLHttpRequest/.test(html));
  s.ok('页面有 390px 级媒体查询', /@media\s*\(max-width:\s*430px\)/.test(html));
  s.ok('页面有减少动效降级', /prefers-reduced-motion/.test(html));
  s.ok('页面有 aria-label', /aria-label=/.test(html));
  s.ok('页面有你的 5×5 棋盘', /id="yourBoard"[^>]*aria-label|aria-label[^>]*5×5/.test(html));
  s.ok('页面有 AI 棋盘', /id="aiBoard"/.test(html));
  s.ok('页面有种子输入', /id="seedInput"/.test(html));
  s.ok('页面有旋转与翻转按钮', /id="rotateBtn"/.test(html) && /id="flipBtn"/.test(html));
  s.ok('页面用 setTimeout 驱动 AI', /setTimeout/.test(html));

  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  s.ok('rules.html 存在', rules.length > 1000);
  var blocks = lib.jsonLd(rules);
  var faq = blocks.filter(function (block) { return block && block['@type'] === 'FAQPage'; })[0];
  s.ok('规则页有 FAQPage JSON-LD', !!faq);
  s.ok('FAQ 至少 3 个问题', !!(faq && Array.isArray(faq.mainEntity) && faq.mainEntity.length >= 3),
    faq && faq.mainEntity ? String(faq.mainEntity.length) : '缺失');
  s.ok('规则页链接开始游戏', /href="index\.html"/.test(rules));
  s.ok('规则页链接桌游目录', /href="\.\.\/index\.html"/.test(rules));

  var mainMatch = rules.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  var mainText = mainMatch ? mainMatch[1].replace(/<[^>]+>/g, '') : '';
  var chineseCount = (mainText.match(/[一-鿿]/g) || []).length;
  s.ok('规则正文 400–800 个汉字', chineseCount >= 400 && chineseCount <= 800, String(chineseCount));
});

s.done();
