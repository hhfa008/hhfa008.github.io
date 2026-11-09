/*
 * Kingdomino（多米诺王国）纯规则引擎 — UMD
 *
 * 浏览器：<script src="engine.js"></script> 后使用 globalThis.KingdominoEngine。
 * Node：  var Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；不调用 Math.random，所有随机性来自 createGame(seed) 的 mulberry32。
 *   - applyMove 不修改传入的 state / move，返回全新 state。
 *   - 所有动作都经过同一套合法性检查，非法动作抛 Error。
 *   - AI 只从 getLegalMoves(state) 的结果中选择。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KingdominoEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 5;
  var CENTER = 2;
  var TILE_COUNT = 48;
  var GAME_TILE_COUNT = 24;
  var ROUNDS = 6;
  var DRAFT_SIZE = 4;

  var TERRAINS = Object.freeze({
    wheat: { name: '麦田' },
    forest: { name: '森林' },
    water: { name: '湖泊' },
    grass: { name: '草原' },
    swamp: { name: '沼泽' },
    mine: { name: '矿山' }
  });
  var TERRAIN_LIST = Object.freeze(['wheat', 'forest', 'water', 'grass', 'swamp', 'mine']);

  /*
   * 固定 48 张瓦片（按真实牌表近似）。
   * 每行：[左半地形, 左半皇冠, 右半地形, 右半皇冠]，id 从 1 起。
   * 地形仅使用 6 种；皇冠为 0–3 的整数。
   */
  var RAW_TILES = [
    ['wheat', 0, 'wheat', 0],
    ['forest', 0, 'forest', 0],
    ['water', 0, 'water', 0],
    ['grass', 0, 'grass', 0],
    ['swamp', 0, 'swamp', 0],
    ['mine', 0, 'mine', 0],
    ['wheat', 0, 'forest', 0],
    ['water', 0, 'grass', 0],
    ['swamp', 0, 'wheat', 0],
    ['mine', 0, 'forest', 0],
    ['wheat', 1, 'wheat', 0],
    ['forest', 1, 'forest', 0],
    ['water', 1, 'water', 0],
    ['grass', 1, 'grass', 0],
    ['swamp', 1, 'swamp', 0],
    ['mine', 1, 'mine', 0],
    ['wheat', 1, 'forest', 0],
    ['water', 1, 'grass', 0],
    ['swamp', 1, 'forest', 0],
    ['mine', 1, 'grass', 0],
    ['wheat', 2, 'wheat', 0],
    ['forest', 2, 'forest', 0],
    ['water', 2, 'water', 0],
    ['grass', 2, 'grass', 0],
    ['swamp', 2, 'swamp', 0],
    ['mine', 2, 'mine', 0],
    ['wheat', 1, 'wheat', 1],
    ['forest', 1, 'forest', 1],
    ['water', 1, 'water', 1],
    ['grass', 1, 'grass', 1],
    ['swamp', 1, 'swamp', 1],
    ['mine', 1, 'mine', 1],
    ['wheat', 2, 'forest', 0],
    ['forest', 2, 'water', 0],
    ['water', 2, 'grass', 0],
    ['grass', 2, 'wheat', 0],
    ['swamp', 2, 'forest', 0],
    ['mine', 3, 'water', 0],
    ['wheat', 1, 'wheat', 2],
    ['forest', 1, 'forest', 2],
    ['water', 2, 'swamp', 0],
    ['grass', 2, 'swamp', 0],
    ['wheat', 0, 'mine', 3],
    ['forest', 0, 'mine', 2],
    ['water', 1, 'wheat', 1],
    ['grass', 1, 'forest', 1],
    ['swamp', 1, 'mine', 2],
    ['wheat', 2, 'wheat', 1]
  ];

  var TILES = RAW_TILES.map(function (row, index) {
    return Object.freeze({
      id: index + 1,
      a: Object.freeze({ terrain: row[0], crowns: row[1] }),
      b: Object.freeze({ terrain: row[2], crowns: row[3] })
    });
  });

  var TILE_BY_ID = Object.create(null);
  TILES.forEach(function (tile) { TILE_BY_ID[tile.id] = tile; });

  var ORIENTATION_LABELS = ['横向 A|B', '横向 B|A', '纵向 A/B', '纵向 B/A'];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isInteger(value) {
    return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
  }

  function mulberry32(seed) {
    var a = seed | 0;
    return function () {
      a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function createEmptyGrid() {
    var grid = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c++) row.push(null);
      grid.push(row);
    }
    return grid;
  }

  function createPlayer(index, name, isAI) {
    var grid = createEmptyGrid();
    grid[CENTER][CENTER] = { castle: true };
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      grid: grid,
      placedCount: 0,
      lastMove: null
    };
  }

  function getTile(tileId) {
    return TILE_BY_ID[tileId] || null;
  }

  function terrainName(terrain) {
    return TERRAINS[terrain] ? TERRAINS[terrain].name : '未知地形';
  }

  /* 朝向：0=A 左 B 右，1=B 左 A 右，2=A 上 B 下，3=B 上 A 下 */
  function orientationCells(orientation) {
    if (orientation === 0 || orientation === 1) return [[0, 0], [0, 1]];
    if (orientation === 2 || orientation === 3) return [[0, 0], [1, 0]];
    return null;
  }

  function orientationHalves(tileId, orientation) {
    var tile = typeof tileId === 'object' ? tileId : getTile(tileId);
    if (!tile || orientationCells(orientation) === null) return null;
    var a = tile.a;
    var b = tile.b;
    return (orientation === 1 || orientation === 3) ? [b, a] : [a, b];
  }

  function rotateOrientation(orientation) {
    // 顺时针：0→2→1→3→0
    switch (orientation) {
      case 0: return 2;
      case 2: return 1;
      case 1: return 3;
      case 3: return 0;
      default: return 0;
    }
  }

  function flipOrientation(orientation) {
    switch (orientation) {
      case 0: return 1;
      case 1: return 0;
      case 2: return 3;
      case 3: return 2;
      default: return 0;
    }
  }

  function draftEntry(state, tileId) {
    for (var i = 0; i < state.draft.length; i++) {
      if (state.draft[i].tileId === tileId && state.draft[i].takenBy === null) return state.draft[i];
    }
    return null;
  }

  function getRemainingDraft(state) {
    if (!state || !state.draft) return [];
    return state.draft.filter(function (entry) { return entry.takenBy === null; })
      .map(function (entry) {
        return {
          slot: entry.slot,
          tileId: entry.tileId,
          tile: getTile(entry.tileId)
        };
      });
  }

  function getDraft(state) {
    if (!state || !state.draft) return [];
    return state.draft.map(function (entry) {
      return {
        slot: entry.slot,
        tileId: entry.tileId,
        tile: getTile(entry.tileId),
        takenBy: entry.takenBy,
        takenPick: entry.takenPick == null ? null : entry.takenPick
      };
    });
  }

  function neighbors(row, col) {
    var list = [];
    if (row > 0) list.push([row - 1, col]);
    if (row < BOARD_SIZE - 1) list.push([row + 1, col]);
    if (col > 0) list.push([row, col - 1]);
    if (col < BOARD_SIZE - 1) list.push([row, col + 1]);
    return list;
  }

  function canPlaceFor(state, playerIndex, tileId, orientation, row, col) {
    var player = state && state.players ? state.players[playerIndex] : null;
    var tile = getTile(tileId);
    var offsets = orientationCells(orientation);
    var result = { ok: false, reason: '', cells: [], tile: tile, orientation: orientation };

    if (!player) {
      result.reason = '玩家不存在';
      return result;
    }
    if (!tile) {
      result.reason = '瓦片不存在';
      return result;
    }
    if (!offsets) {
      result.reason = '朝向非法';
      return result;
    }
    if (!isInteger(row) || !isInteger(col)) {
      result.reason = '行号与列号必须是整数';
      return result;
    }

    var cells = offsets.map(function (offset) {
      return [row + offset[0], col + offset[1]];
    });
    result.cells = cells;

    for (var i = 0; i < cells.length; i++) {
      var r = cells[i][0];
      var c = cells[i][1];
      if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) {
        result.reason = '超出 5×5 王国边界';
        return result;
      }
      var target = player.grid[r][c];
      if (target) {
        result.reason = target.castle ? '不能覆盖城堡' : '与已有瓦片重叠';
        return result;
      }
    }

    var adjacent = false;
    for (var j = 0; j < cells.length && !adjacent; j++) {
      var around = neighbors(cells[j][0], cells[j][1]);
      for (var k = 0; k < around.length; k++) {
        if (player.grid[around[k][0]][around[k][1]]) { adjacent = true; break; }
      }
    }
    if (!adjacent) {
      result.reason = '必须与已有领地上下左右相邻';
      return result;
    }

    result.ok = true;
    return result;
  }

  function canPlace(state, tileId, orientation, row, col) {
    return canPlaceFor(state, state ? state.current : 0, tileId, orientation, row, col);
  }

  function hasAnyLegalPlacement(state, playerIndex) {
    if (!state || state.over) return false;
    var remaining = state.draft.filter(function (entry) { return entry.takenBy === null; });
    for (var t = 0; t < remaining.length; t++) {
      for (var o = 0; o < 4; o++) {
        var offsets = orientationCells(o);
        var maxRow = BOARD_SIZE - 1 - (offsets[1][0]);
        var maxCol = BOARD_SIZE - 1 - (offsets[1][1]);
        for (var r = 0; r <= maxRow; r++) {
          for (var c = 0; c <= maxCol; c++) {
            if (canPlaceFor(state, playerIndex, remaining[t].tileId, o, r, c).ok) return true;
          }
        }
      }
    }
    return false;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var pi = state.current;
    var moves = [];
    var remaining = state.draft.filter(function (entry) { return entry.takenBy === null; });
    remaining.forEach(function (entry) {
      for (var o = 0; o < 4; o++) {
        var offsets = orientationCells(o);
        var maxRow = BOARD_SIZE - 1 - offsets[1][0];
        var maxCol = BOARD_SIZE - 1 - offsets[1][1];
        for (var r = 0; r <= maxRow; r++) {
          for (var c = 0; c <= maxCol; c++) {
            if (canPlaceFor(state, pi, entry.tileId, o, r, c).ok) {
              moves.push({ tileId: entry.tileId, orientation: o, row: r, col: c });
            }
          }
        }
      }
    });
    return moves;
  }

  function scoreDetails(grid) {
    var regions = [];
    var seen = [];
    var total = 0;
    var totalCrowns = 0;
    var totalArea = 0;
    var maxRegion = 0;

    for (var r = 0; r < BOARD_SIZE; r++) {
      seen.push([]);
      for (var c = 0; c < BOARD_SIZE; c++) seen[r].push(false);
    }

    for (var sr = 0; sr < BOARD_SIZE; sr++) {
      for (var sc = 0; sc < BOARD_SIZE; sc++) {
        var start = grid && grid[sr] ? grid[sr][sc] : null;
        if (!start || start.castle || !start.terrain || seen[sr][sc]) continue;

        var terrain = start.terrain;
        var queue = [[sr, sc]];
        var cells = [];
        var crowns = 0;
        seen[sr][sc] = true;

        while (queue.length) {
          var pos = queue.shift();
          var cell = grid[pos[0]][pos[1]];
          cells.push(pos);
          crowns += cell.crowns || 0;
          var around = neighbors(pos[0], pos[1]);
          for (var n = 0; n < around.length; n++) {
            var nr = around[n][0];
            var nc = around[n][1];
            if (seen[nr][nc]) continue;
            var next = grid[nr][nc];
            if (next && !next.castle && next.terrain === terrain) {
              seen[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }

        var area = cells.length;
        var regionScore = area * crowns;
        total += regionScore;
        totalCrowns += crowns;
        totalArea += area;
        if (area > maxRegion) maxRegion = area;
        regions.push({
          terrain: terrain,
          terrainName: terrainName(terrain),
          area: area,
          crowns: crowns,
          score: regionScore,
          cells: cells
        });
      }
    }

    return {
      score: total,
      regions: regions,
      regionCount: regions.length,
      crowns: totalCrowns,
      area: totalArea,
      maxRegion: maxRegion
    };
  }

  function scoreKingdom(grid) {
    return scoreDetails(grid).score;
  }

  function playerScore(player) {
    if (!player) return 0;
    return scoreKingdom(Array.isArray(player) ? player : player.grid);
  }

  function appendLog(state, player, type, text, extra) {
    var entry = {
      round: state.round,
      player: player,
      type: type,
      text: text
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { entry[key] = extra[key]; });
    }
    state.log.push(entry);
    if (state.log.length > 100) state.log.splice(0, state.log.length - 100);
  }

  function startNextRound(state) {
    if (state.drawPile.length < DRAFT_SIZE) return false;
    var ids = state.drawPile.slice(0, DRAFT_SIZE).sort(function (a, b) { return a - b; });
    state.drawPile = state.drawPile.slice(DRAFT_SIZE);
    state.round += 1;
    state.firstPlayer = 1 - state.firstPlayer;
    state.order = [state.firstPlayer, 1 - state.firstPlayer, 1 - state.firstPlayer, state.firstPlayer];
    state.pickIndex = 0;
    state.draft = ids.map(function (id, slot) {
      return { slot: slot, tileId: id, takenBy: null, takenPick: null };
    });
    state.current = state.order[0];
    appendLog(state, null, 'round', '第 ' + state.round + ' 轮：亮出 ' +
      ids.map(function (id) { return id + ' 号'; }).join('、') + '瓦片，' +
      state.players[state.current].name + ' 先选。');
    return true;
  }

  function computeResults(state) {
    var rows = state.players.map(function (player) {
      var details = scoreDetails(player.grid);
      return {
        index: player.index,
        name: player.name,
        isAI: !!player.isAI,
        score: details.score,
        placed: player.placedCount,
        regions: details.regionCount,
        maxRegion: details.maxRegion,
        crowns: details.crowns,
        area: details.area
      };
    });

    var winner = null;
    var tieBreak = null;
    if (rows.length > 1) {
      if (rows[0].score !== rows[1].score) {
        winner = rows[0].score > rows[1].score ? 0 : 1;
      } else {
        tieBreak = '总分相同，比较最大单块领地面积';
        if (rows[0].maxRegion !== rows[1].maxRegion) {
          winner = rows[0].maxRegion > rows[1].maxRegion ? 0 : 1;
        } else {
          tieBreak = '总分与最大领地面积相同，比较皇冠总数';
          if (rows[0].crowns !== rows[1].crowns) {
            winner = rows[0].crowns > rows[1].crowns ? 0 : 1;
          } else {
            tieBreak = '总分、最大领地面积与皇冠总数都相同，平局';
            winner = null;
          }
        }
      }
    }

    return {
      reason: state.overReason || null,
      scores: rows,
      winner: winner,
      tieBreak: tieBreak
    };
  }

  function getResults(state) {
    if (!state || !state.players) return null;
    return computeResults(state);
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    state.result = computeResults(state);
    state.result.reason = reason;
    appendLog(state, null, 'end', '对局结束：' + reason);
    return state;
  }

  function anyPlayerCanPlace(state) {
    return hasAnyLegalPlacement(state, 0) || hasAnyLegalPlacement(state, 1);
  }

  function settle(state) {
    var guard = 0;
    while (!state.over) {
      guard += 1;
      if (guard > 100) {
        finishGame(state, '选牌推进异常，已安全结束');
        return state;
      }

      if (state.pickIndex >= DRAFT_SIZE) {
        if (!startNextRound(state)) {
          finishGame(state, '6 轮结束，24 张瓦片已全部选完');
          return state;
        }
        continue;
      }

      var pi = state.order[state.pickIndex];
      state.current = pi;
      if (hasAnyLegalPlacement(state, pi)) return state;

      appendLog(state, pi, 'skip',
        state.players[pi].name + ' 的 5×5 王国没有可放置的瓦片，跳过本次选牌。');
      state.pickIndex += 1;

      if (!anyPlayerCanPlace(state)) {
        finishGame(state, '双方的 5×5 王国都无法再放置剩余瓦片');
        return state;
      }
    }
    return state;
  }

  function applyMove(state, move) {
    if (!state) throw new Error('局面不存在');
    if (state.over) throw new Error('对局已结束');
    if (!move || typeof move !== 'object') throw new Error('动作非法');

    var pi = state.current;
    var player = state.players[pi];
    if (!player) throw new Error('当前玩家不存在');

    if (move.player != null && move.player !== pi) throw new Error('还没轮到这位玩家');
    if (!isInteger(move.tileId) || !getTile(move.tileId)) throw new Error('瓦片 ID 非法');
    if (!isInteger(move.orientation) || move.orientation < 0 || move.orientation > 3) {
      throw new Error('朝向非法：必须是 0–3');
    }
    if (!isInteger(move.row) || !isInteger(move.col)) throw new Error('行号与列号必须是整数');

    var entry = draftEntry(state, move.tileId);
    if (!entry) throw new Error('这张瓦片不在本轮待选队列中');

    var check = canPlaceFor(state, pi, move.tileId, move.orientation, move.row, move.col);
    if (!check.ok) throw new Error(check.reason);

    var next = clone(state);
    var nextEntry = draftEntry(next, move.tileId);
    if (!nextEntry) throw new Error('待选队列状态损坏');

    var tile = getTile(move.tileId);
    var offsets = orientationCells(move.orientation);
    var halves = orientationHalves(tile, move.orientation);
    var absolute = [];

    offsets.forEach(function (offset, index) {
      var r = move.row + offset[0];
      var c = move.col + offset[1];
      absolute.push([r, c]);
      next.players[pi].grid[r][c] = {
        terrain: halves[index].terrain,
        crowns: halves[index].crowns,
        tileId: tile.id
      };
    });

    nextEntry.takenBy = pi;
    nextEntry.takenPick = next.pickIndex;
    next.players[pi].placedCount += 1;
    next.players[pi].lastMove = {
      tileId: tile.id,
      orientation: move.orientation,
      row: move.row,
      col: move.col,
      cells: absolute
    };

    var halfText = halves.map(function (half) {
      return terrainName(half.terrain) + (half.crowns ? '×' + half.crowns + ' 皇冠' : '');
    }).join(' / ');
    appendLog(next, pi, 'place', player.name + ' 选择 ' + tile.id + ' 号瓦片（' + halfText +
      '），以「' + ORIENTATION_LABELS[move.orientation] + '」放在第 ' + (move.row + 1) +
      ' 行第 ' + (move.col + 1) + ' 列。', {
      tileId: tile.id,
      orientation: move.orientation,
      row: move.row,
      col: move.col,
      pickSlot: state.pickIndex
    });

    next.pickIndex += 1;
    return settle(next);
  }

  function regionAreaAt(grid, row, col) {
    var start = grid[row][col];
    if (!start || !start.terrain) return 0;
    var terrain = start.terrain;
    var seen = Object.create(null);
    var queue = [[row, col]];
    var area = 0;
    seen[row + ',' + col] = true;
    while (queue.length) {
      var pos = queue.shift();
      area += 1;
      var around = neighbors(pos[0], pos[1]);
      for (var i = 0; i < around.length; i++) {
        var key = around[i][0] + ',' + around[i][1];
        if (seen[key]) continue;
        var cell = grid[around[i][0]][around[i][1]];
        if (cell && !cell.castle && cell.terrain === terrain) {
          seen[key] = true;
          queue.push(around[i]);
        }
      }
    }
    return area;
  }

  function evaluateMove(state, move) {
    var pi = state.current;
    var player = state.players[pi];
    var tile = getTile(move.tileId);
    var halves = orientationHalves(tile, move.orientation);
    var offsets = orientationCells(move.orientation);

    var grid = player.grid.map(function (row) { return row.slice(); });
    var cells = offsets.map(function (offset) {
      return [move.row + offset[0], move.col + offset[1]];
    });
    cells.forEach(function (pos, index) {
      grid[pos[0]][pos[1]] = {
        terrain: halves[index].terrain,
        crowns: halves[index].crowns,
        tileId: tile.id
      };
    });

    var before = scoreDetails(player.grid).score;
    var after = scoreDetails(grid).score;
    var delta = after - before;
    var crowns = (tile.a.crowns || 0) + (tile.b.crowns || 0);
    var sameAdjacency = 0;
    var emptyAdjacency = 0;
    var maxComponent = 0;

    cells.forEach(function (pos, index) {
      var terrain = halves[index].terrain;
      var around = neighbors(pos[0], pos[1]);
      for (var i = 0; i < around.length; i++) {
        var cell = grid[around[i][0]][around[i][1]];
        if (!cell) emptyAdjacency += 1;
        else if (!cell.castle && cell.terrain === terrain) sameAdjacency += 1;
      }
      var area = regionAreaAt(grid, pos[0], pos[1]);
      if (area > maxComponent) maxComponent = area;
    });

    var centerDistance = Math.abs(move.row + 0.5 - CENTER) + Math.abs(move.col + 0.5 - CENTER);
    var centerBonus = Math.max(0, 4 - centerDistance) * 1.2;

    return delta * 100 +
      crowns * 20 +
      sameAdjacency * 9 +
      emptyAdjacency * 1.5 +
      maxComponent * 3 +
      centerBonus +
      tile.id * 0.01;
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    var moves = getLegalMoves(state);
    if (!moves.length) return null;

    var best = null;
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var score = evaluateMove(state, moves[i]);
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = moves[i];
      }
    }
    return best;
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    var aiPlayer = opts.aiPlayer == null ? 1 : opts.aiPlayer;
    var names = opts.names || ['你', 'AI 对手'];

    var deck = shuffle(TILES.map(function (tile) { return tile.id; }), mulberry32(seed));
    var gameIds = deck.slice(0, GAME_TILE_COUNT);
    var initial = gameIds.slice(0, DRAFT_SIZE).sort(function (a, b) { return a - b; });
    var drawPile = gameIds.slice(DRAFT_SIZE);

    var state = {
      seed: seed,
      players: [
        createPlayer(0, names[0] || '你', aiPlayer === 0),
        createPlayer(1, names[1] || 'AI 对手', aiPlayer === 1)
      ],
      round: 1,
      maxRounds: ROUNDS,
      draft: initial.map(function (id, slot) {
        return { slot: slot, tileId: id, takenBy: null, takenPick: null };
      }),
      drawPile: drawPile,
      pickIndex: 0,
      firstPlayer: 0,
      order: [0, 1, 1, 0],
      current: 0,
      over: false,
      overReason: null,
      result: null,
      log: []
    };

    appendLog(state, null, 'start', '新开一局：从 48 张瓦片中抽取 24 张，共 6 轮；每轮按 1-2-1 选牌，先手每轮轮换。');
    appendLog(state, null, 'round', '第 1 轮：亮出 ' + initial.map(function (id) {
      return id + ' 号';
    }).join('、') + '瓦片，你 先选。');

    return settle(state);
  }

  function isGameOver(state) {
    return !!(state && state.over);
  }

  function currentPlayer(state) {
    if (!state || !state.players) return null;
    return state.players[state.current] || null;
  }

  function getCurrentPickPlayer(state) {
    if (!state || !state.order) return -1;
    return state.order[state.pickIndex];
  }

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    CENTER: CENTER,
    TILE_COUNT: TILE_COUNT,
    GAME_TILE_COUNT: GAME_TILE_COUNT,
    ROUNDS: ROUNDS,
    DRAFT_SIZE: DRAFT_SIZE,
    TILES: TILES,
    TILE_BY_ID: TILE_BY_ID,
    TERRAINS: TERRAINS,
    TERRAIN_LIST: TERRAIN_LIST,
    getTile: getTile,
    terrainName: terrainName,
    orientationCells: orientationCells,
    orientationHalves: orientationHalves,
    rotateOrientation: rotateOrientation,
    flipOrientation: flipOrientation,
    getDraft: getDraft,
    getRemainingDraft: getRemainingDraft,
    getCurrentPickPlayer: getCurrentPickPlayer,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    currentPlayer: currentPlayer,
    scoreKingdom: scoreKingdom,
    scoreDetails: scoreDetails,
    playerScore: playerScore,
    canPlace: canPlace,
    canPlaceFor: canPlaceFor,
    hasAnyLegalPlacement: hasAnyLegalPlacement
  });
});
