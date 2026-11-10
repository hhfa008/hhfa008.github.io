/*
 * Azul（花砖物语）精品版纯规则引擎 — UMD
 *
 * 浏览器：先加载本文件，使用 globalThis.AzulEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；applyMove 不修改入参，始终返回全新 state。
 *   - 洗牌复用 games/shared/shuffle.js 的 seeded Fisher-Yates；
 *     state 只保存 seed 与 shuffleCount，JSON 克隆后可复现。
 *   - 非法动作一律抛 Error；AI 只从 getLegalMoves 里选择。
 *   - 支持 2 / 3 / 4 人。圆盘数按官方规则：2 人 5 个、3 人 7 个、4 人 9 个。
 *
 * 规则口径（官方基础版）：
 *   - 5 色 × 20 枚 = 100 枚；每个圆盘 4 枚；中央区每轮开始放先手标记。
 *   - 行 i（0..4）容量 i+1；墙面为 5×5 拉丁方：
 *       wallColorAt(r,c) = (c - r + 5) % 5
 *       wallColFor(r,color) = (color + r) % 5
 *   - 地板 7 格，罚分 1,1,2,2,2,3,3；先手标记占 1 格并计入罚分。
 *   - 可以主动把整批砖放地板（即使花纹行可用）。
 *   - 取砖后先手标记放地板最左空位；本轮由拿标记的玩家先开始下一轮。
 *   - 上墙逐块即时计分：横向连通数 + 纵向连通数；四周无邻砖得 1 分。
 *   - 回合结算：只清空已完成花纹行（多余砖进弃砖区），未完成花纹行保留。
 *   - 地板罚分后分数不低于 0。
 *   - 终局：任一方完成一整行墙面后打完本轮。奖励：完整行 +2/行，完整列 +7/列，
 *     某色 5 枚 +10/色。平局先比完整行数，仍平则共享胜利。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.AzulEngine = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ShuffleApi = null;
  if (typeof require === 'function') {
    try { ShuffleApi = require('../../shared/shuffle.js'); } catch (err) { ShuffleApi = null; }
  }
  if (!ShuffleApi && root && root.Shuffle) ShuffleApi = root.Shuffle;
  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('AzulEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';

  var COLORS = Object.freeze([
    Object.freeze({ index: 0, key: 'blue', name: '湖蓝', hex: '#2f6fb5', light: '#9cc9f2', dark: '#123f70' }),
    Object.freeze({ index: 1, key: 'yellow', name: '柠黄', hex: '#d9a620', light: '#f7dc84', dark: '#9b6f08' }),
    Object.freeze({ index: 2, key: 'red', name: '朱红', hex: '#b94a3f', light: '#ef9a8d', dark: '#7c251c' }),
    Object.freeze({ index: 3, key: 'black', name: '墨黑', hex: '#2b2e37', light: '#6d7383', dark: '#111318' }),
    Object.freeze({ index: 4, key: 'white', name: '瓷白', hex: '#ece2cf', light: '#fffdf7', dark: '#b8ab92' })
  ]);
  var COLOR_COUNT = COLORS.length;
  var TILES_PER_COLOR = 20;
  var TOTAL_TILES = COLOR_COUNT * TILES_PER_COLOR;
  var TILES_PER_FACTORY = 4;
  var WALL_SIZE = 5;
  var FLOOR_SIZE = 7;
  var FLOOR_PENALTY = Object.freeze([1, 1, 2, 2, 2, 3, 3]);
  var MARKER = -1;
  var MAX_TURNS = 4000;
  var AI_SIMULATION_LIMIT = 8;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function factoryCountFor(playerCount) {
    if (playerCount === 2) return 5;
    if (playerCount === 3) return 7;
    if (playerCount === 4) return 9;
    throw new Error('玩家人数必须是 2、3 或 4');
  }

  function wallColorAt(row, col) {
    return ((col - row) % WALL_SIZE + WALL_SIZE) % WALL_SIZE;
  }

  function wallColFor(row, color) {
    return ((color + row) % WALL_SIZE + WALL_SIZE) % WALL_SIZE;
  }

  function makeLines() {
    var lines = [];
    for (var i = 0; i < WALL_SIZE; i++) lines.push([]);
    return lines;
  }

  function makeWall() {
    var wall = [];
    for (var r = 0; r < WALL_SIZE; r++) {
      var row = [];
      for (var c = 0; c < WALL_SIZE; c++) row.push(null);
      wall.push(row);
    }
    return wall;
  }

  function createPlayer(index, name, isAI) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      score: 0,
      lines: makeLines(),
      wall: makeWall(),
      floor: []
    };
  }

  function defaultNames(playerCount) {
    var names = ['你', 'AI · 青花匠', 'AI · 鎏金匠', 'AI · 朱砂匠'];
    return names.slice(0, playerCount);
  }

  function allTiles(state) {
    var tiles = state.bag.slice().concat(state.discard);
    state.factories.forEach(function (factory) { tiles = tiles.concat(factory); });
    tiles = tiles.concat(state.center);
    state.players.forEach(function (player) {
      player.lines.forEach(function (line) { tiles = tiles.concat(line); });
      player.wall.forEach(function (row) {
        row.forEach(function (cell) { if (cell !== null) tiles.push(cell); });
      });
      player.floor.forEach(function (tile) { if (tile !== MARKER) tiles.push(tile); });
    });
    return tiles;
  }

  function colorCounts(tiles) {
    var counts = [0, 0, 0, 0, 0];
    tiles.forEach(function (tile) {
      if (tile >= 0 && tile < COLOR_COUNT) counts[tile] += 1;
    });
    return counts;
  }

  function floorPenalty(floor) {
    var total = 0;
    for (var i = 0; i < floor.length && i < FLOOR_PENALTY.length; i++) {
      total += FLOOR_PENALTY[i];
    }
    return total;
  }

  // 墙面新砖的即时得分：横向连通数 + 纵向连通数；两者都是 1 时得 1 分。
  function wallPlacementScore(wall, row, col) {
    var horizontal = 1;
    var vertical = 1;
    var c;
    for (c = col - 1; c >= 0 && wall[row][c] !== null; c--) horizontal += 1;
    for (c = col + 1; c < WALL_SIZE && wall[row][c] !== null; c++) horizontal += 1;
    var r;
    for (r = row - 1; r >= 0 && wall[r][col] !== null; r--) vertical += 1;
    for (r = row + 1; r < WALL_SIZE && wall[r][col] !== null; r++) vertical += 1;
    if (horizontal > 1 && vertical > 1) return horizontal + vertical;
    if (horizontal > 1) return horizontal;
    if (vertical > 1) return vertical;
    return 1;
  }

  function wallHasColor(wall, row, color) {
    return wall[row].indexOf(color) !== -1;
  }

  function rowFilled(wall, row) {
    for (var c = 0; c < WALL_SIZE; c++) if (wall[row][c] === null) return false;
    return true;
  }

  function colFilled(wall, col) {
    for (var r = 0; r < WALL_SIZE; r++) if (wall[r][col] === null) return false;
    return true;
  }

  function computeBonuses(wall) {
    var rows = 0;
    var cols = 0;
    var counts = [0, 0, 0, 0, 0];
    for (var r = 0; r < WALL_SIZE; r++) {
      if (rowFilled(wall, r)) rows += 1;
      for (var c = 0; c < WALL_SIZE; c++) {
        if (wall[r][c] !== null) counts[wall[r][c]] += 1;
      }
    }
    for (var col = 0; col < WALL_SIZE; col++) if (colFilled(wall, col)) cols += 1;
    var colors = 0;
    counts.forEach(function (n) { if (n >= WALL_SIZE) colors += 1; });
    return {
      rows: rows,
      cols: cols,
      colors: colors,
      rowBonus: rows * 2,
      columnBonus: cols * 7,
      colorBonus: colors * 10,
      total: rows * 2 + cols * 7 + colors * 10
    };
  }

  function legalPatternRows(player, color) {
    var rows = [];
    for (var i = 0; i < WALL_SIZE; i++) {
      var line = player.lines[i];
      var capacity = i + 1;
      if (line.length >= capacity) continue;
      if (line.length > 0 && line[0] !== color) continue;
      if (wallHasColor(player.wall, i, color)) continue;
      rows.push(i);
    }
    return rows;
  }

  function drawTile(state) {
    if (state.bag.length === 0 && state.discard.length > 0) {
      state.bag = ShuffleApi.shuffle(state.discard, {
        seed: String(state.seed) + ':refill:' + state.shuffleCount
      });
      state.shuffleCount += 1;
      state.discard = [];
    }
    if (state.bag.length === 0) return null;
    return state.bag.pop();
  }

  function dealFactories(state) {
    for (var f = 0; f < state.factories.length; f++) {
      var factory = [];
      for (var k = 0; k < TILES_PER_FACTORY; k++) {
        var tile = drawTile(state);
        if (tile === null) break;
        factory.push(tile);
      }
      state.factories[f] = factory;
    }
  }

  function appendLog(state, player, type, text, data) {
    state.log.push({
      turn: state.turn,
      round: state.round,
      player: player,
      type: type,
      text: text,
      data: data || null
    });
    if (state.log.length > 220) state.log.splice(0, state.log.length - 220);
  }

  function createGame(seedOrOptions) {
    var opts = seedOrOptions && typeof seedOrOptions === 'object' ? seedOrOptions : { seed: seedOrOptions };
    var normalized = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var playerCount = opts.playerCount == null ? 2 : Number(opts.playerCount);
    if (playerCount !== 2 && playerCount !== 3 && playerCount !== 4) {
      throw new Error('玩家人数必须是 2、3 或 4');
    }
    var factoryCount = factoryCountFor(playerCount);
    var names = opts.names && opts.names.length === playerCount ? opts.names.slice() : defaultNames(playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount
      ? opts.isAI.slice()
      : names.map(function (_, i) { return i > 0; });

    var state = {
      version: VERSION,
      seed: normalized,
      shuffleCount: 1,
      playerCount: playerCount,
      bag: [],
      discard: [],
      factories: [],
      center: [],
      centerMarker: true,
      players: [],
      current: 0,
      firstPlayer: 0,
      round: 1,
      turn: 0,
      over: false,
      overReason: null,
      result: null,
      pendingRound: false,
      lastAction: null,
      lastRound: null,
      log: []
    };

    for (var f = 0; f < factoryCount; f++) state.factories.push([]);
    for (var p = 0; p < playerCount; p++) {
      state.players.push(createPlayer(p, names[p], !!aiFlags[p]));
    }
    for (var color = 0; color < COLOR_COUNT; color++) {
      for (var i = 0; i < TILES_PER_COLOR; i++) state.bag.push(color);
    }
    state.bag = ShuffleApi.shuffle(state.bag, { seed: String(normalized) + ':setup' });
    dealFactories(state);
    appendLog(state, null, 'start',
      '新开一局：' + playerCount + ' 人，' + factoryCount + ' 个圆盘，每色 ' +
      TILES_PER_COLOR + ' 枚，中央区有先手标记。');
    appendLog(state, null, 'round', '第 1 轮开始，' + state.players[state.firstPlayer].name + ' 先手。');
    return state;
  }

  function sourceTiles(state, move) {
    if (move.source === 'factory') return state.factories[move.factoryIndex] || [];
    if (move.source === 'center') return state.center;
    return [];
  }

  function validateMove(state, move) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (state.over) throw new Error('对局已结束');
    if (state.pendingRound) throw new Error('本轮已结束，等待结算');
    if (move.source !== 'factory' && move.source !== 'center') {
      throw new Error('取砖来源非法');
    }
    var color = move.color;
    if (!Number.isInteger(color) || color < 0 || color >= COLOR_COUNT) {
      throw new Error('颜色非法');
    }
    var factoryIndex = -1;
    var tiles;
    if (move.source === 'factory') {
      factoryIndex = move.factoryIndex;
      if (!Number.isInteger(factoryIndex) || factoryIndex < 0 || factoryIndex >= state.factories.length) {
        throw new Error('圆盘编号非法');
      }
      tiles = state.factories[factoryIndex];
    } else {
      if (move.factoryIndex != null && move.factoryIndex !== -1) {
        throw new Error('中央区动作不需要圆盘编号');
      }
      tiles = state.center;
    }
    if (tiles.indexOf(color) === -1) {
      throw new Error('该区域没有' + COLORS[color].name + '色砖');
    }

    var row = move.row;
    if (!Number.isInteger(row) || row < -1 || row >= WALL_SIZE) {
      throw new Error('花纹行编号非法');
    }
    if (row === -1) {
      // 官方规则允许玩家主动把整批砖放地板，即使花纹行可用。
      return { source: move.source, factoryIndex: factoryIndex, color: color, row: -1 };
    }

    var player = state.players[state.current];
    var line = player.lines[row];
    if (line.length >= row + 1) throw new Error('第 ' + (row + 1) + ' 条花纹行已满');
    if (line.length > 0 && line[0] !== color) {
      throw new Error('第 ' + (row + 1) + ' 条花纹行已有其他颜色');
    }
    if (wallHasColor(player.wall, row, color)) {
      throw new Error('墙面第 ' + (row + 1) + ' 行已有' + COLORS[color].name + '色砖');
    }
    return { source: move.source, factoryIndex: factoryIndex, color: color, row: row };
  }

  function getLegalMoves(state) {
    if (!state || state.over || state.pendingRound) return [];
    var player = state.players[state.current];
    var moves = [];

    function addMoves(source, factoryIndex, tiles) {
      var seen = [false, false, false, false, false];
      for (var i = 0; i < tiles.length; i++) {
        var color = tiles[i];
        if (color < 0 || color >= COLOR_COUNT || seen[color]) continue;
        seen[color] = true;
        // 地板永远是一个合法选项。
        moves.push({ source: source, factoryIndex: factoryIndex, color: color, row: -1 });
        var rows = legalPatternRows(player, color);
        for (var r = 0; r < rows.length; r++) {
          moves.push({ source: source, factoryIndex: factoryIndex, color: color, row: rows[r] });
        }
      }
    }

    for (var f = 0; f < state.factories.length; f++) addMoves('factory', f, state.factories[f]);
    addMoves('center', -1, state.center);
    return moves;
  }

  function addToFloor(state, player, tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (player.floor.length < FLOOR_SIZE) {
        player.floor.push(tile);
      } else if (tile !== MARKER) {
        state.discard.push(tile);
      }
    }
  }

  function roundIsOver(state) {
    if (state.center.length > 0) return false;
    for (var f = 0; f < state.factories.length; f++) {
      if (state.factories[f].length > 0) return false;
    }
    return true;
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    state.pendingRound = false;
    var scores = state.players.map(function (player) {
      var bonus = computeBonuses(player.wall);
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        base: player.score,
        bonus: bonus.total,
        rowBonus: bonus.rowBonus,
        columnBonus: bonus.columnBonus,
        colorBonus: bonus.colorBonus,
        rows: bonus.rows,
        cols: bonus.cols,
        colors: bonus.colors,
        total: player.score + bonus.total
      };
    });
    var best = -Infinity;
    scores.forEach(function (row) { if (row.total > best) best = row.total; });
    var tiedTop = scores.filter(function (row) { return row.total === best; });
    var winners = tiedTop.slice();
    var winner = null;
    var tied = false;
    if (winners.length === 1) {
      winner = winners[0].index;
    } else {
      var mostRows = -1;
      winners.forEach(function (row) { if (row.rows > mostRows) mostRows = row.rows; });
      winners = winners.filter(function (row) { return row.rows === mostRows; });
      if (winners.length === 1) winner = winners[0].index;
      else tied = true;
    }
    state.result = {
      reason: reason,
      round: state.round,
      scores: scores,
      winner: winner,
      winners: winners.map(function (row) { return row.index; }),
      tied: tied
    };
    appendLog(state, null, 'end', '对局结束：' + reason + '。' +
      scores.map(function (row) { return row.name + ' ' + row.total + ' 分'; }).join('，') + '。');
    return state;
  }

  function resolveRound(state) {
    var events = { round: state.round, players: [], ended: false, result: null };
    state.players.forEach(function (player) {
      var placements = [];
      var points = 0;
      for (var row = 0; row < WALL_SIZE; row++) {
        var line = player.lines[row];
        if (line.length !== row + 1) continue;
        var color = line[0];
        var col = wallColFor(row, color);
        if (player.wall[row][col] !== null) throw new Error('上墙位置冲突');
        player.wall[row][col] = color;
        var gained = wallPlacementScore(player.wall, row, col);
        player.score += gained;
        points += gained;
        placements.push({ row: row, col: col, color: color, points: gained });
        // 已完成花纹行：最右侧一块上墙，其余进弃砖区。
        state.discard = state.discard.concat(line.slice(1));
        player.lines[row] = [];
      }
      // 未完成花纹行保持原样，留到下一轮。
      var penalty = floorPenalty(player.floor);
      var beforePenalty = player.score;
      player.score = Math.max(0, player.score - penalty);
      player.floor.forEach(function (tile) {
        if (tile !== MARKER) state.discard.push(tile);
      });
      player.floor = [];
      events.players.push({
        index: player.index,
        name: player.name,
        placements: placements,
        points: points,
        penalty: penalty,
        beforePenalty: beforePenalty,
        scoreAfter: player.score
      });
    });

    var ended = state.players.some(function (player) {
      for (var r = 0; r < WALL_SIZE; r++) if (rowFilled(player.wall, r)) return true;
      return false;
    });

    state.lastRound = events;
    if (ended) {
      events.ended = true;
      finishGame(state, '有玩家完成了一整行墙面');
      events.result = state.result;
      return state;
    }

    state.round += 1;
    state.center = [];
    state.centerMarker = true;
    state.current = state.firstPlayer;
    dealFactories(state);

    var drawable = state.center.length;
    for (var f = 0; f < state.factories.length; f++) drawable += state.factories[f].length;
    if (drawable === 0) {
      events.ended = true;
      finishGame(state, '砖袋与弃砖区都已耗尽，按当前得分结算');
      events.result = state.result;
      return state;
    }
    appendLog(state, null, 'round', '第 ' + state.round + ' 轮开始，先手为' +
      state.players[state.current].name + '。');
    return state;
  }

  function applyMove(state, move, options) {
    var checked = validateMove(state, move);
    var next = clone(state);
    next.lastRound = null;
    var player = next.players[next.current];
    var source = checked.source === 'factory' ? next.factories[checked.factoryIndex] : next.center;
    var taken = [];
    var rest = [];
    source.forEach(function (tile) {
      if (tile === checked.color) taken.push(tile);
      else rest.push(tile);
    });

    var gotMarker = false;
    if (checked.source === 'factory') {
      next.factories[checked.factoryIndex] = [];
      rest.forEach(function (tile) { next.center.push(tile); });
      appendLog(next, next.current, 'take',
        player.name + ' 从圆盘 ' + (checked.factoryIndex + 1) + ' 取走 ' + taken.length + ' 枚' +
        COLORS[checked.color].name + '色砖' + (rest.length ? '，其余 ' + rest.length + ' 枚进入中央区' : '') + '。');
    } else {
      next.center = rest;
      appendLog(next, next.current, 'take',
        player.name + ' 从中央区取走 ' + taken.length + ' 枚' + COLORS[checked.color].name + '色砖。');
      if (next.centerMarker) {
        next.centerMarker = false;
        next.firstPlayer = next.current;
        gotMarker = true;
        addToFloor(next, player, [MARKER]);
        appendLog(next, next.current, 'marker',
          player.name + ' 获得先手标记（放入地板，占 1 格并计入罚分）。');
      }
    }

    var overflow = [];
    var placed = 0;
    if (checked.row >= 0) {
      var line = player.lines[checked.row];
      var capacity = checked.row + 1;
      var free = capacity - line.length;
      placed = Math.min(taken.length, free);
      for (var i = 0; i < placed; i++) line.push(checked.color);
      overflow = taken.slice(placed);
      appendLog(next, next.current, 'place',
        player.name + ' 将 ' + placed + ' 枚' + COLORS[checked.color].name + '色砖放入第 ' +
        (checked.row + 1) + ' 条花纹行' +
        (overflow.length ? '，' + overflow.length + ' 枚溢出到地板' : '') + '。');
    } else {
      overflow = taken.slice();
      appendLog(next, next.current, 'place',
        player.name + ' 主动将 ' + taken.length + ' 枚' + COLORS[checked.color].name + '色砖放入地板。');
    }
    if (overflow.length) addToFloor(next, player, overflow);

    next.lastAction = {
      player: next.current,
      source: checked.source,
      factoryIndex: checked.factoryIndex,
      color: checked.color,
      row: checked.row,
      taken: taken.length,
      placed: placed,
      overflow: overflow.length,
      gotMarker: gotMarker
    };
    next.turn += 1;

    var deferred = !!(options && options.deferResolve);
    if (roundIsOver(next)) {
      if (deferred) next.pendingRound = true;
      else resolveRound(next);
    } else {
      next.current = (next.current + 1) % next.playerCount;
    }

    if (!next.over && !next.pendingRound && next.turn > MAX_TURNS) {
      finishGame(next, '达到回合上限，强制结算');
    }
    return next;
  }

  function resolvePendingRound(state) {
    if (!state || !state.pendingRound) throw new Error('当前没有等待结算的回合');
    var next = clone(state);
    next.pendingRound = false;
    return resolveRound(next);
  }

  function wallColorCount(wall, color) {
    var count = 0;
    for (var r = 0; r < WALL_SIZE; r++) {
      for (var c = 0; c < WALL_SIZE; c++) if (wall[r][c] === color) count += 1;
    }
    return count;
  }

  function countOccupiedRow(wall, row) {
    var n = 0;
    for (var c = 0; c < WALL_SIZE; c++) if (wall[row][c] !== null) n += 1;
    return n;
  }

  function countOccupiedCol(wall, col) {
    var n = 0;
    for (var r = 0; r < WALL_SIZE; r++) if (wall[r][col] !== null) n += 1;
    return n;
  }

  function floorPenaltySlots(count) {
    var total = 0;
    for (var i = 0; i < count && i < FLOOR_PENALTY.length; i++) total += FLOOR_PENALTY[i];
    return total;
  }

  function scoreMoveHeuristic(state, move) {
    var player = state.players[state.current];
    var tiles = sourceTiles(state, move);
    var taken = 0;
    for (var i = 0; i < tiles.length; i++) if (tiles[i] === move.color) taken += 1;
    var score = taken * 2;
    var overflow = 0;

    if (move.row === -1) {
      return -10 * taken - floorPenaltySlots(player.floor.length + taken) - 8;
    }

    var line = player.lines[move.row];
    var capacity = move.row + 1;
    var free = capacity - line.length;
    var placed = Math.min(taken, free);
    overflow = taken - placed;
    var col = wallColFor(move.row, move.color);

    score += placed * 8;
    if (placed === free) {
      score += 26 + wallPlacementScore(player.wall, move.row, col) * 6;
      if (countOccupiedRow(player.wall, move.row) === 4) score += 16;
      if (countOccupiedCol(player.wall, col) === 4) score += 30;
      if (wallColorCount(player.wall, move.color) === 4) score += 20;
    } else {
      score -= (free - placed) * 2;
    }
    score -= overflow * 3;
    var before = floorPenaltySlots(player.floor.length);
    var after = floorPenaltySlots(player.floor.length + overflow);
    score -= (after - before) * 5;
    score -= player.floor.length * 1.5;
    score += wallColorCount(player.wall, move.color) * 2;
    if (move.source === 'center' && state.centerMarker) score += 4;
    return score;
  }

  function playerBoardValue(player) {
    var value = player.score * 1.2;
    var counts = [0, 0, 0, 0, 0];
    for (var r = 0; r < WALL_SIZE; r++) {
      for (var c = 0; c < WALL_SIZE; c++) {
        if (player.wall[r][c] === null) continue;
        value += 2.5;
        counts[player.wall[r][c]] += 1;
      }
      if (rowFilled(player.wall, r)) value += 12;
    }
    for (var col = 0; col < WALL_SIZE; col++) if (colFilled(player.wall, col)) value += 28;
    for (var k = 0; k < counts.length; k++) if (counts[k] === WALL_SIZE) value += 18;
    player.lines.forEach(function (line, i) {
      value += line.length * 1.5;
      if (line.length === i + 1) value += 8;
    });
    value -= floorPenalty(player.floor) * 2.2;
    return value;
  }

  function evaluateState(state, perspective) {
    if (state.over && state.result) {
      var mine = state.result.scores[perspective].total;
      var maxOther = -Infinity;
      state.result.scores.forEach(function (row) {
        if (row.index !== perspective && row.total > maxOther) maxOther = row.total;
      });
      var win = state.result.winner === perspective ? 28 : 0;
      // 平局接近胜利，但仍略低于独占胜利。
      if (state.result.tied) win = 12;
      return (mine - maxOther) * 4 + win;
    }
    var me = playerBoardValue(state.players[perspective]);
    var others = 0;
    state.players.forEach(function (player) {
      if (player.index !== perspective) others += playerBoardValue(player);
    });
    if (state.playerCount > 1) others /= (state.playerCount - 1);
    return me - others * 0.9;
  }

  function hashString(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function moveKey(move) {
    return move.source + ':' + move.factoryIndex + ':' + move.color + ':' + move.row;
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    if (state.pendingRound) throw new Error('本轮已结束，等待结算');
    var moves = getLegalMoves(state);
    if (moves.length === 0) throw new Error('没有合法动作');
    var perspective = state.current;
    var ranked = moves.map(function (move, index) {
      return {
        move: move,
        quick: scoreMoveHeuristic(state, move),
        tie: ((hashString(moveKey(move)) + state.turn * 131 + index * 17) % 997) / 100000
      };
    });
    ranked.sort(function (a, b) {
      if (b.quick !== a.quick) return b.quick - a.quick;
      return a.tie - b.tie;
    });

    var best = ranked[0].move;
    var bestValue = -Infinity;
    var candidates = ranked.slice(0, AI_SIMULATION_LIMIT);
    for (var i = 0; i < candidates.length; i++) {
      var after;
      try {
        after = applyMove(state, candidates[i].move);
      } catch (err) {
        continue;
      }
      var value = evaluateState(after, perspective) + candidates[i].tie;
      if (value > bestValue) {
        bestValue = value;
        best = candidates[i].move;
      }
    }
    return best;
  }

  function isGameOver(state) {
    return !!(state && state.over);
  }

  function getResults(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    if (state.over && state.result) return state.result;
    var scores = state.players.map(function (player) {
      var bonus = computeBonuses(player.wall);
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        base: player.score,
        bonus: bonus.total,
        rowBonus: bonus.rowBonus,
        columnBonus: bonus.columnBonus,
        colorBonus: bonus.colorBonus,
        rows: bonus.rows,
        cols: bonus.cols,
        colors: bonus.colors,
        total: player.score + bonus.total
      };
    });
    return {
      over: false,
      reason: null,
      round: state.round,
      winner: null,
      winners: [],
      tied: false,
      scores: scores
    };
  }

  function currentPlayer(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    return state.players[state.current];
  }

  return Object.freeze({
    VERSION: VERSION,
    COLORS: COLORS,
    COLOR_COUNT: COLOR_COUNT,
    TILES_PER_COLOR: TILES_PER_COLOR,
    TOTAL_TILES: TOTAL_TILES,
    TILES_PER_FACTORY: TILES_PER_FACTORY,
    WALL_SIZE: WALL_SIZE,
    FLOOR_SIZE: FLOOR_SIZE,
    FLOOR_PENALTY: FLOOR_PENALTY,
    MARKER: MARKER,
    MAX_TURNS: MAX_TURNS,
    factoryCountFor: factoryCountFor,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    resolvePendingRound: resolvePendingRound,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    currentPlayer: currentPlayer,
    wallColorAt: wallColorAt,
    wallColFor: wallColFor,
    wallPlacementScore: wallPlacementScore,
    floorPenalty: floorPenalty,
    computeBonuses: computeBonuses,
    colorCounts: colorCounts,
    allTiles: allTiles
  });
});
