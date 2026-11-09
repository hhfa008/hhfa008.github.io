/*
 * Azul（花砖物语）纯规则引擎 — UMD
 *
 * 浏览器：先加载本文件，使用 globalThis.AzulEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；applyMove 不修改入参，始终返回全新 state。
 *   - 所有随机性来自 createGame(seed) 的 mulberry32，不使用未播种随机数。
 *   - 非法动作一律抛 Error；AI 只从 getLegalMoves 里选择。
 *
 * 规则口径（标准双人）：
 *   - 5 色 × 20 枚 = 100 枚；5 个圆盘各 4 枚；中央区起始有先手标记。
 *   - 行 i（0..4）容量 i+1；墙面为 5×5 拉丁方，wallColorAt(r,c)=(c-r+5)%5。
 *   - 地板 7 格（先手标记占 1 格），罚分 1,1,2,2,2,3,3。
 *   - 上墙计分：横向连通数 + 纵向连通数；两者都 >1 时相加，否则取连通数；
 *     四周都没有相邻砖时得 1 分。
 *   - 终局：任一方完成整行墙面后本盘结束；完整行/列各 +2，某色 5 枚 +10。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AzulEngine = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var COLORS = [
    { index: 0, key: 'blue', name: '蓝', hex: '#2f6fb0' },
    { index: 1, key: 'yellow', name: '黄', hex: '#d2a11c' },
    { index: 2, key: 'red', name: '红', hex: '#b8412f' },
    { index: 3, key: 'black', name: '黑', hex: '#2b2b30' },
    { index: 4, key: 'white', name: '白', hex: '#efe6d4' }
  ];
  var COLOR_COUNT = COLORS.length;
  var TILES_PER_COLOR = 20;
  var FACTORY_COUNT = 5;
  var TILES_PER_FACTORY = 4;
  var WALL_SIZE = 5;
  var FLOOR_SIZE = 7;
  var FLOOR_PENALTY = [1, 1, 2, 2, 2, 3, 3];
  var MARKER = -1;
  var MAX_TURNS = 600;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
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

  // 随机数状态直接存在 state.rng.s 里，JSON 克隆后仍可复现。
  function rand(state) {
    var a = state.rng.s | 0;
    a = a + 0x6D2B79F5 | 0;
    state.rng.s = a >>> 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }

  function shuffle(list, state) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(rand(state) * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function wallColorAt(row, col) {
    return ((col - row) % WALL_SIZE + WALL_SIZE) % WALL_SIZE;
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
      columnBonus: cols * 2,
      colorBonus: colors * 10,
      total: rows * 2 + cols * 2 + colors * 10
    };
  }

  function legalRowsFor(player, color) {
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
      state.bag = shuffle(state.discard.slice(), state);
      state.discard = [];
    }
    if (state.bag.length === 0) return null;
    return state.bag.pop();
  }

  function dealFactories(state) {
    for (var f = 0; f < FACTORY_COUNT; f++) {
      var factory = [];
      for (var k = 0; k < TILES_PER_FACTORY; k++) {
        var tile = drawTile(state);
        if (tile === null) break;
        factory.push(tile);
      }
      state.factories[f] = factory;
    }
  }

  function appendLog(state, player, type, text) {
    state.log.push({
      turn: state.turn,
      round: state.round,
      player: player,
      type: type,
      text: text
    });
    if (state.log.length > 160) state.log.splice(0, state.log.length - 160);
  }

  function createGame(seed) {
    var normalized = seed == null ? 1 : (Number(seed) >>> 0);
    var state = {
      seed: normalized,
      rng: { s: normalized },
      bag: [],
      discard: [],
      factories: [[], [], [], [], []],
      center: [],
      centerMarker: true,
      players: [
        createPlayer(0, '你', false),
        createPlayer(1, 'AI 对手', true)
      ],
      current: 0,
      firstPlayer: 0,
      round: 1,
      turn: 0,
      over: false,
      overReason: null,
      result: null,
      log: []
    };
    for (var color = 0; color < COLOR_COUNT; color++) {
      for (var i = 0; i < TILES_PER_COLOR; i++) state.bag.push(color);
    }
    shuffle(state.bag, state);
    dealFactories(state);
    appendLog(state, null, 'start',
      '新开一局：每色 ' + TILES_PER_COLOR + ' 枚，5 个圆盘各 ' + TILES_PER_FACTORY +
      ' 枚，中央区有先手标记。');
    appendLog(state, null, 'round', '第 1 轮开始。');
    return state;
  }

  function sourceTiles(state, move) {
    if (move.source === 'factory') return state.factories[move.factoryIndex] || [];
    if (move.source === 'center') return state.center;
    return [];
  }

  function validateMove(state, move) {
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    if (state.over) throw new Error('对局已结束');
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
      if (!Number.isInteger(factoryIndex) || factoryIndex < 0 || factoryIndex >= FACTORY_COUNT) {
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

    var player = state.players[state.current];
    var legal = legalRowsFor(player, color);
    var row = move.row;
    if (row === -1) {
      if (legal.length > 0) throw new Error('这种颜色仍可放入花纹行，不能直接放地板');
      return { source: move.source, factoryIndex: factoryIndex, color: color, row: -1 };
    }
    if (!Number.isInteger(row) || row < 0 || row >= WALL_SIZE) {
      throw new Error('花纹行编号非法');
    }
    if (legal.indexOf(row) === -1) {
      var line = player.lines[row];
      if (line.length >= row + 1) throw new Error('第 ' + (row + 1) + ' 条花纹行已满');
      if (line.length > 0 && line[0] !== color) throw new Error('第 ' + (row + 1) + ' 条花纹行已有其他颜色');
      if (wallHasColor(player.wall, row, color)) throw new Error('墙面第 ' + (row + 1) + ' 行已有' + COLORS[color].name + '色砖');
      throw new Error('不能放入这条花纹行');
    }
    return { source: move.source, factoryIndex: factoryIndex, color: color, row: row };
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    var player = state.players[state.current];
    var moves = [];

    function addMoves(source, factoryIndex, tiles) {
      var seen = [false, false, false, false, false];
      for (var i = 0; i < tiles.length; i++) {
        var color = tiles[i];
        if (seen[color]) continue;
        seen[color] = true;
        var rows = legalRowsFor(player, color);
        if (rows.length === 0) {
          moves.push({ source: source, factoryIndex: factoryIndex, color: color, row: -1 });
        } else {
          rows.forEach(function (row) {
            moves.push({ source: source, factoryIndex: factoryIndex, color: color, row: row });
          });
        }
      }
    }

    for (var f = 0; f < FACTORY_COUNT; f++) addMoves('factory', f, state.factories[f]);
    addMoves('center', -1, state.center);
    return moves;
  }

  function addToFloor(next, player, tiles) {
    for (var i = 0; i < tiles.length; i++) {
      var tile = tiles[i];
      if (player.floor.length < FLOOR_SIZE) {
        player.floor.push(tile);
      } else if (tile !== MARKER) {
        next.discard.push(tile);
      }
    }
  }

  function roundIsOver(state) {
    if (state.center.length > 0) return false;
    for (var f = 0; f < FACTORY_COUNT; f++) {
      if (state.factories[f].length > 0) return false;
    }
    return true;
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
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
    var winner = null;
    if (scores[0].total > scores[1].total) winner = 0;
    else if (scores[1].total > scores[0].total) winner = 1;
    state.result = {
      reason: reason,
      round: state.round,
      scores: scores,
      winner: winner
    };
    appendLog(state, null, 'end', '对局结束：' + reason + '。' +
      scores.map(function (row) {
        return row.name + ' ' + row.total + ' 分';
      }).join('，') + '。');
    return state;
  }

  function resolveRound(state) {
    var roundNo = state.round;
    state.players.forEach(function (player) {
      var newly = [];
      var wallPoints = 0;
      for (var i = 0; i < WALL_SIZE; i++) {
        var line = player.lines[i];
        if (line.length === i + 1) {
          var color = line[0];
          var col = (color + i) % WALL_SIZE;
          if (player.wall[i][col] !== null) {
            throw new Error('上墙位置冲突');
          }
          player.wall[i][col] = color;
          newly.push([i, col]);
        }
      }
      newly.forEach(function (pos) {
        wallPoints += wallPlacementScore(player.wall, pos[0], pos[1]);
      });
      player.score += wallPoints;
      var penalty = floorPenalty(player.floor);
      player.score -= penalty;

      player.lines.forEach(function (line, i) {
        var full = line.length === i + 1;
        var toDiscard = full ? line.slice(1) : line.slice();
        state.discard = state.discard.concat(toDiscard);
        player.lines[i] = [];
      });
      player.floor.forEach(function (tile) {
        if (tile !== MARKER) state.discard.push(tile);
      });
      player.floor = [];

      var bits = [];
      if (newly.length) bits.push('上墙 ' + newly.length + ' 块，得 ' + wallPoints + ' 分');
      if (penalty) bits.push('地板扣 ' + penalty + ' 分');
      if (!bits.length) bits.push('本回合没有新砖上墙，也没有地板扣分');
      appendLog(state, player.index, 'score',
        player.name + ' 本轮结算：' + bits.join('，') + '，累计 ' + player.score + ' 分。');
    });

    var ended = state.players.some(function (player) {
      for (var r = 0; r < WALL_SIZE; r++) if (rowFilled(player.wall, r)) return true;
      return false;
    });
    if (ended) {
      finishGame(state, '有玩家完成了一整行墙面，触发终局');
      return state;
    }

    state.round += 1;
    state.center = [];
    state.centerMarker = true;
    state.current = state.firstPlayer;
    dealFactories(state);
    var drawable = state.center.length;
    for (var f = 0; f < FACTORY_COUNT; f++) drawable += state.factories[f].length;
    if (drawable === 0) {
      finishGame(state, '砖袋与弃砖区都已空，无法继续发牌');
      return state;
    }
    appendLog(state, null, 'round', '第 ' + state.round + ' 轮开始，先手为' +
      state.players[state.current].name + '。');
    void roundNo;
    return state;
  }

  function applyMove(state, move) {
    var checked = validateMove(state, move);
    var next = clone(state);
    var player = next.players[next.current];
    var source = checked.source === 'factory' ? next.factories[checked.factoryIndex] : next.center;
    var taken = [];
    var rest = [];
    source.forEach(function (tile) {
      if (tile === checked.color) taken.push(tile);
      else rest.push(tile);
    });

    if (checked.source === 'factory') {
      next.factories[checked.factoryIndex] = [];
      rest.forEach(function (tile) { next.center.push(tile); });
      appendLog(next, next.current, 'take',
        player.name + ' 从圆盘 ' + (checked.factoryIndex + 1) + ' 取走 ' + taken.length + ' 枚' +
        COLORS[checked.color].name + '色砖' + (rest.length ? '，其余 ' + rest.length + ' 枚进入中央区' : '') + '。');
    } else {
      next.center = rest;
      if (next.centerMarker) {
        next.centerMarker = false;
        next.firstPlayer = next.current;
        addToFloor(next, player, [MARKER]);
        appendLog(next, next.current, 'marker',
          player.name + ' 取走中央区，获得先手标记（放入地板，占 1 格）。');
      }
      appendLog(next, next.current, 'take',
        player.name + ' 从中央区取走 ' + taken.length + ' 枚' + COLORS[checked.color].name + '色砖。');
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
        player.name + ' 没有可用的花纹行，' + taken.length + ' 枚砖全部放入地板。');
    }
    if (overflow.length) addToFloor(next, player, overflow);

    next.turn += 1;
    if (roundIsOver(next)) {
      resolveRound(next);
    } else {
      next.current = 1 - next.current;
    }
    if (!next.over && next.turn > MAX_TURNS) {
      finishGame(next, '达到回合上限，强制结束');
    }
    return next;
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

  function evaluateMove(state, move) {
    var player = state.players[state.current];
    var tiles = sourceTiles(state, move);
    var taken = 0;
    tiles.forEach(function (tile) { if (tile === move.color) taken += 1; });

    if (move.row === -1) return -900 - taken * 12;

    var line = player.lines[move.row];
    var capacity = move.row + 1;
    var free = capacity - line.length;
    var placed = Math.min(taken, free);
    var overflow = taken - placed;
    var score = placed * 18 + taken * 4;

    if (placed === free) {
      score += 60;
      var col = (move.color + move.row) % WALL_SIZE;
      score += wallPlacementScore(player.wall, move.row, col) * 8;
      if (countOccupiedRow(player.wall, move.row) === 4) score += 90;
      if (countOccupiedCol(player.wall, col) === 4) score += 90;
      if (wallColorCount(player.wall, move.color) === 4) score += 70;
    } else {
      score += wallColorCount(player.wall, move.color) * 6;
    }

    score -= overflow * 14;
    if (player.floor.length + overflow > FLOOR_SIZE) score -= 30;
    score -= player.floor.length * 4;
    score += line.length * 3;
    if (move.source === 'center' && state.centerMarker) score -= 10;
    return score;
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    var moves = getLegalMoves(state);
    if (moves.length === 0) throw new Error('没有合法动作');
    var best = moves[0];
    var bestScore = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var value = evaluateMove(state, moves[i]);
      if (value > bestScore) {
        bestScore = value;
        best = moves[i];
      }
    }
    return best;
  }

  function isGameOver(state) {
    return !!(state && state.over);
  }

  function getResults(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
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
    var winner = null;
    if (state.over && scores[0].total > scores[1].total) winner = 0;
    else if (state.over && scores[1].total > scores[0].total) winner = 1;
    return {
      over: !!state.over,
      reason: state.overReason,
      round: state.round,
      winner: winner,
      scores: scores
    };
  }

  function currentPlayer(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    return state.players[state.current];
  }

  return Object.freeze({
    COLORS: COLORS,
    COLOR_COUNT: COLOR_COUNT,
    TILES_PER_COLOR: TILES_PER_COLOR,
    FACTORY_COUNT: FACTORY_COUNT,
    TILES_PER_FACTORY: TILES_PER_FACTORY,
    WALL_SIZE: WALL_SIZE,
    FLOOR_SIZE: FLOOR_SIZE,
    FLOOR_PENALTY: FLOOR_PENALTY,
    MARKER: MARKER,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    currentPlayer: currentPlayer,
    wallColorAt: wallColorAt,
    wallPlacementScore: wallPlacementScore,
    floorPenalty: floorPenalty,
    computeBonuses: computeBonuses,
    colorCounts: colorCounts,
    allTiles: allTiles
  });
});
