/*
 * Kingdomino（多米诺王国）双人规则引擎 — UMD
 *
 * 浏览器：先加载 data.js，再加载 engine.js，使用 globalThis.KingdominoEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 规则依据（Blue Orange 官方公开规则 + 2 人局调整）：
 *   - 48 张多米诺瓦片；2 人局随机取 24 张，每人 2 个国王棋子，每轮各选 2 张。
 *   - 5×5 王国，城堡位于正中央；接续时新瓦片必须与已有领地有地形匹配的边，
 *     城堡四边视为任意地形（wild）。放不进 5×5 或无法接续的瓦片必须弃置。
 *   - 计分：每块连通的同地形领地 = 面积 × 该领地皇冠总数；没有皇冠的领地 0 分。
 *   - 平局先比最大单块领地面积；仍相同则共享胜利。
 *   - 下一轮选牌顺序由本轮所选瓦片在队列中的位置（左到右）决定。
 *
 * 设计约束：不依赖 DOM；不修改入参；引擎内不使用随机函数；AI 只走合法动作。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.KingdominoEngine = factory(root.KingdominoData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (D) {
  'use strict';

  var SharedShuffle = (typeof module === 'object' && module.exports && typeof require === 'function')
    ? require('../../shared/shuffle.js')
    : (typeof globalThis !== 'undefined' ? globalThis.Shuffle : null);

  if (!D) throw new Error('缺少 KingdominoData：请先加载 data.js');

  var BOARD_SIZE = 5;
  var CENTER = 2;
  var GAME_TILE_COUNT = 24;
  var ROUNDS = 6;
  var DRAFT_SIZE = 4;
  var TILES = D.TILES;
  var TILE_BY_ID = Object.create(null);
  TILES.forEach(function (tile) { TILE_BY_ID[tile.id] = tile; });
  var TERRAINS = D.TERRAINS;
  var ORIENTATION_LABELS = D.ORIENTATION_LABELS;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
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
    if (!SharedShuffle) throw new Error('缺少 games/shared/shuffle.js：请先加载 shared/shuffle.js');
    return SharedShuffle.shuffle(list, { rng: rng });
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
      discardedCount: 0,
      lastMove: null
    };
  }

  function getTile(tileId) { return TILE_BY_ID[tileId] || null; }
  function terrainName(key) { return TERRAINS[key] ? TERRAINS[key].name : '未知地形'; }

  function orientationCells(orientation) {
    if (orientation === 0 || orientation === 1) return [[0, 0], [0, 1]];
    if (orientation === 2 || orientation === 3) return [[0, 0], [1, 0]];
    return null;
  }
  function orientationHalves(tileId, orientation) {
    var tile = typeof tileId === 'object' ? tileId : getTile(tileId);
    if (!tile || orientationCells(orientation) === null) return null;
    return (orientation === 1 || orientation === 3) ? [tile.b, tile.a] : [tile.a, tile.b];
  }
  function rotateOrientation(orientation) {
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
    if (!player) { result.reason = '玩家不存在'; return result; }
    if (!tile) { result.reason = '瓦片不存在'; return result; }
    if (!offsets) { result.reason = '朝向非法'; return result; }
    if (!isInteger(row) || !isInteger(col)) { result.reason = '行号与列号必须是整数'; return result; }

    var cells = offsets.map(function (offset) { return [row + offset[0], col + offset[1]]; });
    result.cells = cells;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] < 0 || cells[i][1] < 0 || cells[i][0] >= BOARD_SIZE || cells[i][1] >= BOARD_SIZE) {
        result.reason = '超出 5×5 王国边界';
        return result;
      }
      if (player.grid[cells[i][0]][cells[i][1]]) {
        result.reason = player.grid[cells[i][0]][cells[i][1]].castle ? '不能覆盖城堡' : '与已有瓦片重叠';
        return result;
      }
    }

    var halves = orientationHalves(tile, orientation);
    var touches = false;
    var matches = false;
    cells.forEach(function (cell, index) {
      var around = neighbors(cell[0], cell[1]);
      for (var n = 0; n < around.length; n++) {
        var existing = player.grid[around[n][0]][around[n][1]];
        if (!existing) continue;
        touches = true;
        if (existing.castle || existing.terrain === halves[index].terrain) matches = true;
      }
    });
    if (!touches) { result.reason = '必须与已有领地上下左右相邻'; return result; }
    if (!matches) { result.reason = '至少有一格地形要与相邻瓦片匹配（城堡四边视为任意地形）'; return result; }
    result.ok = true;
    return result;
  }

  function getPlacements(state, playerIndex, tileId) {
    var out = [];
    for (var o = 0; o < 4; o++) {
      var offsets = orientationCells(o);
      var maxRow = BOARD_SIZE - 1 - offsets[1][0];
      var maxCol = BOARD_SIZE - 1 - offsets[1][1];
      for (var r = 0; r <= maxRow; r++) {
        for (var c = 0; c <= maxCol; c++) {
          if (canPlaceFor(state, playerIndex, tileId, o, r, c).ok) {
            out.push({ tileId: tileId, orientation: o, row: r, col: c });
          }
        }
      }
    }
    return out;
  }

  function draftEntry(state, tileId) {
    for (var i = 0; i < state.draft.length; i++) {
      if (state.draft[i].tileId === tileId && state.draft[i].takenBy === null) return state.draft[i];
    }
    return null;
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
  function getRemainingDraft(state) {
    return getDraft(state).filter(function (entry) { return entry.takenBy === null; });
  }

  function scoreDetails(grid) {
    var regions = [];
    var seen = [];
    var total = 0, totalCrowns = 0, totalArea = 0, maxRegion = 0;
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
            var nr = around[n][0], nc = around[n][1];
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
      score: total, regions: regions, regionCount: regions.length,
      crowns: totalCrowns, area: totalArea, maxRegion: maxRegion
    };
  }

  function scoreKingdom(grid) { return scoreDetails(grid).score; }
  function playerScore(player) {
    if (!player) return 0;
    return scoreKingdom(Array.isArray(player) ? player : player.grid);
  }

  function appendLog(state, player, type, text, extra) {
    var entry = { round: state.round, player: player, type: type, text: text };
    if (extra) Object.keys(extra).forEach(function (key) { entry[key] = extra[key]; });
    state.log.push(entry);
    if (state.log.length > 140) state.log.splice(0, state.log.length - 140);
  }

  function currentPlayer(state) {
    if (!state || !state.players) return null;
    return state.players[state.current] || null;
  }

  function applyPlacementToGrid(grid, tile, orientation, row, col) {
    var offsets = orientationCells(orientation);
    var halves = orientationHalves(tile, orientation);
    var absolute = [];
    offsets.forEach(function (offset, index) {
      var r = row + offset[0], c = col + offset[1];
      absolute.push([r, c]);
      grid[r][c] = {
        terrain: halves[index].terrain,
        crowns: halves[index].crowns,
        tileId: tile.id
      };
    });
    return absolute;
  }

  function startNextRound(state) {
    if (state.drawPile.length < DRAFT_SIZE) return false;
    // 下一轮顺序：本轮所选瓦片按队列位置从左到右。
    var ordered = state.draft.slice().sort(function (a, b) {
      return (a.takenPick == null ? 99 : a.takenPick) - (b.takenPick == null ? 99 : b.takenPick);
    });
    var nextOrder = ordered.map(function (entry) { return entry.takenBy; })
      .filter(function (pi) { return pi === 0 || pi === 1; });
    if (nextOrder.length !== DRAFT_SIZE) nextOrder = [state.firstPlayer, 1 - state.firstPlayer, state.firstPlayer, 1 - state.firstPlayer];

    var ids = state.drawPile.slice(0, DRAFT_SIZE).sort(function (a, b) { return a - b; });
    state.drawPile = state.drawPile.slice(DRAFT_SIZE);
    state.round += 1;
    state.order = nextOrder;
    state.pickIndex = 0;
    state.draft = ids.map(function (id, slot) {
      return { slot: slot, tileId: id, takenBy: null, takenPick: null };
    });
    state.current = state.order[0];
    appendLog(state, null, 'round', '第 ' + state.round + ' 轮：亮出 ' +
      ids.map(function (id) { return id + ' 号'; }).join('、') + '；选牌顺序 ' +
      state.order.map(function (pi) { return state.players[pi].name; }).join(' → ') + '。');
    return true;
  }

  function computeResults(state, reason) {
    var rows = state.players.map(function (player) {
      var details = scoreDetails(player.grid);
      return {
        index: player.index,
        name: player.name,
        isAI: !!player.isAI,
        score: details.score,
        placed: player.placedCount,
        discarded: player.discardedCount,
        regions: details.regionCount,
        maxRegion: details.maxRegion,
        crowns: details.crowns,
        area: details.area
      };
    });
    var winner = null;
    if (rows[0].score !== rows[1].score) {
      winner = rows[0].score > rows[1].score ? 0 : 1;
    } else if (rows[0].maxRegion !== rows[1].maxRegion) {
      winner = rows[0].maxRegion > rows[1].maxRegion ? 0 : 1;
    }
    return {
      reason: reason || state.overReason,
      scores: rows,
      winner: winner,
      tieBreak: winner === null ? '总分与最大领地都相同，共享胜利' : null
    };
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    state.result = computeResults(state, reason);
    appendLog(state, null, 'end', '对局结束：' + reason + '；' +
      (state.result.winner === null ? '双方共享胜利' : state.players[state.result.winner].name + ' 获胜') + '。');
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
    if (!draftEntry(state, move.tileId)) throw new Error('这张瓦片不在本轮待选队列中');

    var placements = getPlacements(state, pi, move.tileId);
    var discard = !!move.discard;
    if (discard && placements.length) throw new Error('这张瓦片仍有合法位置，不能弃置');
    if (!discard) {
      if (!placements.length) throw new Error('这张瓦片在你的王国里没有合法位置，需要弃置');
      if (!isInteger(move.orientation) || move.orientation < 0 || move.orientation > 3) {
        throw new Error('朝向非法：必须是 0–3');
      }
      if (!isInteger(move.row) || !isInteger(move.col)) throw new Error('行号与列号必须是整数');
      var check = canPlaceFor(state, pi, move.tileId, move.orientation, move.row, move.col);
      if (!check.ok) throw new Error(check.reason);
      if (!placements.some(function (p) {
        return p.orientation === move.orientation && p.row === move.row && p.col === move.col;
      })) throw new Error('该位置不是合法落点');
    }

    var next = clone(state);
    var entry = draftEntry(next, move.tileId);
    var tile = getTile(move.tileId);
    entry.takenBy = pi;
    entry.takenPick = next.pickIndex;

    if (discard) {
      next.players[pi].discardedCount += 1;
      appendLog(next, pi, 'discard', player.name + ' 无法放置 ' + tile.id + ' 号瓦片，将其弃置。');
    } else {
      var absolute = applyPlacementToGrid(next.players[pi].grid, tile, move.orientation, move.row, move.col);
      next.players[pi].placedCount += 1;
      next.players[pi].lastMove = {
        tileId: tile.id, orientation: move.orientation,
        row: move.row, col: move.col, cells: absolute
      };
      var halves = orientationHalves(tile, move.orientation);
      appendLog(next, pi, 'place', player.name + ' 选择 ' + tile.id + ' 号瓦片（' +
        halves.map(function (half) {
          return terrainName(half.terrain) + (half.crowns ? '×' + half.crowns + ' 皇冠' : '');
        }).join(' / ') + '），以「' + ORIENTATION_LABELS[move.orientation] + '」放在第 ' +
        (move.row + 1) + ' 行第 ' + (move.col + 1) + ' 列。');
    }

    next.pickIndex += 1;
    if (next.pickIndex >= DRAFT_SIZE) {
      if (!startNextRound(next)) {
        return finishGame(next, '6 轮结束，24 张瓦片已全部选完');
      }
    } else {
      next.current = next.order[next.pickIndex];
    }
    return next;
  }

  function getLegalMoves(state, playerIndex) {
    if (!state || state.over) return [];
    var pi = playerIndex == null ? state.current : playerIndex;
    var moves = [];
    var remaining = getRemainingDraft(state);
    remaining.forEach(function (entry) {
      var placements = getPlacements(state, pi, entry.tileId);
      if (placements.length) {
        placements.forEach(function (p) {
          moves.push({ tileId: p.tileId, orientation: p.orientation, row: p.row, col: p.col, player: pi });
        });
      } else {
        moves.push({ tileId: entry.tileId, discard: true, player: pi });
      }
    });
    return moves;
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
    if (move.discard) return -500 + move.tileId * 0.01;
    var tile = getTile(move.tileId);
    var halves = orientationHalves(tile, move.orientation);
    var offsets = orientationCells(move.orientation);
    var grid = player.grid.map(function (row) { return row.slice(); });
    var cells = offsets.map(function (offset) {
      return [move.row + offset[0], move.col + offset[1]];
    });
    cells.forEach(function (pos, index) {
      grid[pos[0]][pos[1]] = { terrain: halves[index].terrain, crowns: halves[index].crowns, tileId: tile.id };
    });
    var before = scoreDetails(player.grid).score;
    var after = scoreDetails(grid).score;
    var delta = after - before;
    var crowns = (tile.a.crowns || 0) + (tile.b.crowns || 0);
    var sameAdjacency = 0, emptyAdjacency = 0, maxComponent = 0;
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
    return delta * 100 + crowns * 20 + sameAdjacency * 9 + emptyAdjacency * 1.5 +
      maxComponent * 3 + centerBonus + tile.id * 0.01;
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    var moves = getLegalMoves(state);
    if (!moves.length) return null;
    var best = null, bestScore = -Infinity;
    moves.forEach(function (move) {
      var score = evaluateMove(state, move);
      if (score > bestScore + 1e-9) { bestScore = score; best = move; }
    });
    return best;
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    var aiPlayer = opts.aiPlayer == null ? 1 : opts.aiPlayer;
    var names = opts.names || ['你', 'AI 对手'];
    var rng = mulberry32(seed);
    var deck = shuffle(TILES.map(function (tile) { return tile.id; }), rng);
    var gameIds = deck.slice(0, GAME_TILE_COUNT);
    var initial = gameIds.slice(0, DRAFT_SIZE).sort(function (a, b) { return a - b; });
    var drawPile = gameIds.slice(DRAFT_SIZE);
    var firstPlayer = rng() < 0.5 ? 0 : 1;

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
      firstPlayer: firstPlayer,
      order: [firstPlayer, 1 - firstPlayer, firstPlayer, 1 - firstPlayer],
      current: firstPlayer,
      over: false,
      overReason: null,
      result: null,
      log: []
    };
    appendLog(state, null, 'start', '新开一局：从 48 张瓦片中抽取 24 张，共 6 轮；每人 2 个国王，每轮各选 2 张。');
    appendLog(state, null, 'round', '第 1 轮：亮出 ' + initial.map(function (id) {
      return id + ' 号';
    }).join('、') + '；' + state.players[firstPlayer].name + ' 先选。');
    return state;
  }

  function isGameOver(state) { return !!(state && state.over); }
  function getResults(state) {
    if (!state || !state.players) return null;
    if (state.result) return state.result;
    return null;
  }
  function getCurrentPickPlayer(state) {
    if (!state || !state.order) return -1;
    return state.order[state.pickIndex];
  }

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    CENTER: CENTER,
    GAME_TILE_COUNT: GAME_TILE_COUNT,
    ROUNDS: ROUNDS,
    DRAFT_SIZE: DRAFT_SIZE,
    TILES: TILES,
    TILE_BY_ID: TILE_BY_ID,
    TERRAINS: TERRAINS,
    ORIENTATION_LABELS: ORIENTATION_LABELS,
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
    getPlacements: getPlacements,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    computeResults: computeResults,
    currentPlayer: currentPlayer,
    scoreKingdom: scoreKingdom,
    scoreDetails: scoreDetails,
    playerScore: playerScore,
    canPlace: function (state, tileId, orientation, row, col) {
      return canPlaceFor(state, state ? state.current : 0, tileId, orientation, row, col);
    },
    canPlaceFor: canPlaceFor
  });
});
