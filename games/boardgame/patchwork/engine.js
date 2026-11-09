/*
 * Patchwork（拼布）纯规则引擎 — UMD
 *
 * 浏览器：先加载 data.js，再加载本文件，使用 globalThis.PatchworkEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM，所有动作返回新的局面，不修改传入的 state。
 *   - 所有随机性来自 createGame 的 seed，便于测试复现。
 *   - 任何买布动作都经过同一套合法性检查；AI 只能从合法动作里选择。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.PatchworkEngine = factory(root.PatchworkData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  if (!DATA || !DATA.PATCHES) throw new Error('PatchworkEngine 需要 data.js');

  var BOARD_SIZE = DATA.BOARD_SIZE;
  var LAST_SPACE = DATA.LAST_SPACE;
  var START_BUTTONS = DATA.START_BUTTONS;
  var MARKET_VISIBLE = DATA.MARKET_VISIBLE;
  var SEVEN_BY_SEVEN_BONUS = DATA.SEVEN_BY_SEVEN_BONUS;
  var EMPTY_PENALTY = DATA.EMPTY_PENALTY;
  var INCOME_SPACES = DATA.INCOME_SPACES;
  var PATCHES = DATA.PATCHES;
  var PATCH_BY_ID = DATA.PATCH_BY_ID;

  var FABRIC_COLORS = [
    '#a94f42', '#3f6e5a', '#bd8a4a', '#496b89', '#7a5b7e',
    '#8a6a43', '#557d78', '#b0694c', '#5b6f3e', '#96606d'
  ];

  var TRANSFORMS = [
    function (r, c) { return [r, c]; },
    function (r, c) { return [c, -r]; },
    function (r, c) { return [-r, -c]; },
    function (r, c) { return [-c, r]; },
    function (r, c) { return [r, -c]; },
    function (r, c) { return [-c, -r]; },
    function (r, c) { return [-r, c]; },
    function (r, c) { return [c, r]; }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeCells(cells) {
    var minR = Infinity;
    var minC = Infinity;
    cells.forEach(function (cell) {
      if (cell[0] < minR) minR = cell[0];
      if (cell[1] < minC) minC = cell[1];
    });
    return cells
      .map(function (cell) { return [cell[0] - minR, cell[1] - minC]; })
      .sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
  }

  function cellsKey(cells) {
    return cells.map(function (cell) { return cell[0] + ',' + cell[1]; }).join(';');
  }

  function orientationFrom(cells, transform) {
    var transformed = cells.map(function (cell) {
      return transform(cell[0], cell[1]);
    });
    var normalized = normalizeCells(transformed);
    var rows = 0;
    var cols = 0;
    normalized.forEach(function (cell) {
      if (cell[0] + 1 > rows) rows = cell[0] + 1;
      if (cell[1] + 1 > cols) cols = cell[1] + 1;
    });
    return {
      cells: normalized,
      key: cellsKey(normalized),
      rows: rows,
      cols: cols
    };
  }

  function buildOrientations(patch) {
    var seen = Object.create(null);
    var result = [];
    TRANSFORMS.forEach(function (transform) {
      var ori = orientationFrom(patch.cells, transform);
      if (!seen[ori.key]) {
        seen[ori.key] = true;
        result.push(ori);
      }
    });
    return result;
  }

  var ORIENTATIONS = Object.create(null);
  PATCHES.forEach(function (patch) { ORIENTATIONS[patch.id] = buildOrientations(patch); });

  function patchById(patchId) {
    return PATCH_BY_ID[patchId] || null;
  }

  function orientationsFor(patchOrId) {
    var id = typeof patchOrId === 'string' ? patchOrId : (patchOrId && patchOrId.id);
    return ORIENTATIONS[id] || null;
  }

  function findOrientationIndex(patchId, cells) {
    var wanted = cellsKey(normalizeCells(cells));
    var list = ORIENTATIONS[patchId];
    if (!list) return -1;
    for (var i = 0; i < list.length; i++) if (list[i].key === wanted) return i;
    return -1;
  }

  function rotateIndex(patchId, orientationIndex, direction) {
    var list = ORIENTATIONS[patchId];
    if (!list || !list[orientationIndex]) return 0;
    var dir = direction === 'ccw' || direction === -1 ? -1 : 1;
    var transformed = list[orientationIndex].cells.map(function (cell) {
      return dir > 0 ? [cell[1], -cell[0]] : [-cell[1], cell[0]];
    });
    var idx = findOrientationIndex(patchId, transformed);
    return idx < 0 ? orientationIndex : idx;
  }

  function flipIndex(patchId, orientationIndex) {
    var list = ORIENTATIONS[patchId];
    if (!list || !list[orientationIndex]) return 0;
    var transformed = list[orientationIndex].cells.map(function (cell) {
      return [cell[0], -cell[1]];
    });
    var idx = findOrientationIndex(patchId, transformed);
    return idx < 0 ? orientationIndex : idx;
  }

  function createBoard() {
    var board = [];
    for (var r = 0; r < BOARD_SIZE; r++) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c++) row.push(null);
      board.push(row);
    }
    return board;
  }

  function createPlayer(index, name, isAI) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      board: createBoard(),
      placed: [],
      buttons: START_BUTTONS,
      time: 0,
      bonus: 0
    };
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

  /**
   * 33 块拼布沿时间轴排布（1–53）。slot 是“在时间轴上的顺位”，
   * 当前玩家只能看到自己标记前方最近的 MARKET_VISIBLE 块。
   */
  function buildPieceStates(seed) {
    var rng = mulberry32(seed);
    var ids = shuffle(PATCHES.map(function (patch) { return patch.id; }), rng);
    var used = Object.create(null);
    var indices = [];
    for (var i = 0; i < ids.length; i++) indices.push(i);
    return ids.map(function (id, i) {
      var slot = 1 + Math.round(i * (LAST_SPACE - 1) / Math.max(1, ids.length - 1));
      while (used[slot]) {
        slot++;
        if (slot > LAST_SPACE) {
          slot = 1;
          while (used[slot]) slot++;
        }
      }
      used[slot] = true;
      return { id: id, slot: slot, owner: null };
    });
  }

  function createGame(options) {
    var opts = options || {};
    var seed = opts.seed == null ? 1 : (opts.seed >>> 0);
    var aiPlayer = opts.aiPlayer == null ? 1 : opts.aiPlayer;
    var names = opts.names || ['你', 'AI 对手'];
    var players = [
      createPlayer(0, names[0] || '你', aiPlayer === 0),
      createPlayer(1, names[1] || 'AI 对手', aiPlayer === 1)
    ];
    var state = {
      seed: seed,
      players: players,
      pieces: buildPieceStates(seed),
      current: 0,
      lastPlayer: 1,
      turn: 1,
      zeroSkips: 0,
      bonusAwardedTo: null,
      over: false,
      overReason: null,
      result: null,
      log: [{
        turn: 0,
        player: null,
        type: 'start',
        text: '新开一局：双方各 5 枚扣子，33 块拼布沿时间轴排布。'
      }]
    };
    return state;
  }

  function playerIncome(player) {
    var total = 0;
    player.placed.forEach(function (entry) {
      var patch = patchById(entry.patchId);
      if (patch) total += patch.income;
    });
    return total;
  }

  function emptyCells(player) {
    var count = 0;
    for (var r = 0; r < BOARD_SIZE; r++) {
      for (var c = 0; c < BOARD_SIZE; c++) if (player.board[r][c] === null) count++;
    }
    return count;
  }

  function playerScore(player) {
    return player.buttons + player.bonus - EMPTY_PENALTY * emptyCells(player);
  }

  function hasSevenBySeven(board) {
    for (var r = 0; r <= BOARD_SIZE - 7; r++) {
      for (var c = 0; c <= BOARD_SIZE - 7; c++) {
        var full = true;
        for (var dr = 0; dr < 7 && full; dr++) {
          for (var dc = 0; dc < 7; dc++) {
            if (board[r + dr][c + dc] === null) { full = false; break; }
          }
        }
        if (full) return true;
      }
    }
    return false;
  }

  function wouldCompleteSeven(board, cells, row, col) {
    var touched = [];
    for (var i = 0; i < cells.length; i++) {
      var r = row + cells[i][0];
      var c = col + cells[i][1];
      if (r < 0 || c < 0 || r >= BOARD_SIZE || c >= BOARD_SIZE) return false;
      if (board[r][c] === null) touched.push([r, c]);
    }
    touched.forEach(function (pos) { board[pos[0]][pos[1]] = { temp: true }; });
    var result = hasSevenBySeven(board);
    touched.forEach(function (pos) { board[pos[0]][pos[1]] = null; });
    return result;
  }

  function getAvailablePatches(state, playerIndex) {
    var pi = playerIndex == null ? state.current : playerIndex;
    var time = state.players[pi].time;
    var list = state.pieces.filter(function (entry) {
      return entry.owner === null && entry.slot > time;
    });
    list.sort(function (a, b) {
      return (a.slot - b.slot) || a.id.localeCompare(b.id);
    });
    return list.slice(0, MARKET_VISIBLE).map(function (entry) {
      return patchById(entry.id);
    }).filter(Boolean);
  }

  function isPatchAvailable(state, playerIndex, patchId) {
    return getAvailablePatches(state, playerIndex).some(function (patch) {
      return patch.id === patchId;
    });
  }

  function absoluteCells(orientation, row, col) {
    return orientation.cells.map(function (cell) {
      return [row + cell[0], col + cell[1]];
    });
  }

  function cellsWithinBoard(cells) {
    return cells.every(function (pos) {
      return pos[0] >= 0 && pos[1] >= 0 && pos[0] < BOARD_SIZE && pos[1] < BOARD_SIZE;
    });
  }

  function cellsFree(board, cells) {
    return cells.every(function (pos) { return board[pos[0]][pos[1]] === null; });
  }

  function canPlaceFor(state, playerIndex, patchId, orientationIndex, row, col) {
    var player = state.players[playerIndex];
    var patch = patchById(patchId);
    if (!player || !patch) return { ok: false, reason: '拼布不存在', cells: [] };
    var ori = ORIENTATIONS[patchId] && ORIENTATIONS[patchId][orientationIndex];
    if (!ori) return { ok: false, reason: '朝向非法', cells: [] };
    var cells = absoluteCells(ori, row, col);
    var result = { ok: false, reason: '', cells: cells, orientation: ori, patch: patch };

    if (!isPatchAvailable(state, playerIndex, patchId)) {
      result.reason = '这块拼布已经不在可购买范围';
      return result;
    }
    if (player.buttons < patch.buttons) {
      result.reason = '扣子不足：需要 ' + patch.buttons + ' 枚，现有 ' + player.buttons + ' 枚';
      return result;
    }
    if (!Number.isInteger(row) || !Number.isInteger(col) || !cellsWithinBoard(cells)) {
      result.reason = '超出 9×9 棋盘边界';
      return result;
    }
    if (!cellsFree(player.board, cells)) {
      result.reason = '与已放置的拼布重叠';
      return result;
    }
    result.ok = true;
    return result;
  }

  function canPlace(state, patchId, orientationIndex, row, col) {
    return canPlaceFor(state, state.current, patchId, orientationIndex, row, col);
  }

  function colorForPatch(patchId) {
    var n = 0;
    for (var i = 0; i < patchId.length; i++) n += patchId.charCodeAt(i);
    return FABRIC_COLORS[n % FABRIC_COLORS.length];
  }

  function placeOnBoard(player, patch, orientation, row, col) {
    var abs = absoluteCells(orientation, row, col);
    abs.forEach(function (pos, index) {
      player.board[pos[0]][pos[1]] = {
        patchId: patch.id,
        name: patch.name,
        orientationIndex: orientation.index,
        button: index < patch.income,
        color: colorForPatch(patch.id)
      };
    });
    player.placed.push({
      patchId: patch.id,
      orientationIndex: orientation.index,
      row: row,
      col: col,
      cells: abs,
      income: patch.income
    });
  }

  function moveToken(player, target) {
    var from = player.time;
    var to = Math.max(from, Math.min(LAST_SPACE, target));
    var incomeEvents = [];
    for (var i = 0; i < INCOME_SPACES.length; i++) {
      var space = INCOME_SPACES[i];
      if (space > from && space <= to) {
        var amount = playerIncome(player);
        player.buttons += amount;
        incomeEvents.push({ space: space, amount: amount });
      }
    }
    player.time = to;
    return { from: from, to: to, spaces: to - from, incomeEvents: incomeEvents };
  }

  function appendLog(state, player, type, text, extra) {
    var entry = {
      turn: state.turn,
      player: player,
      type: type,
      text: text
    };
    if (extra) {
      Object.keys(extra).forEach(function (key) { entry[key] = extra[key]; });
    }
    state.log.push(entry);
    if (state.log.length > 120) state.log.splice(0, state.log.length - 120);
  }

  function advanceTurn(state) {
    var a = state.players[0].time;
    var b = state.players[1].time;
    if (a < b) state.current = 0;
    else if (b < a) state.current = 1;
    else state.current = 1 - state.lastPlayer;
  }

  function hasLegalBuy(state, playerIndex) {
    var available = getAvailablePatches(state, playerIndex);
    var player = state.players[playerIndex];
    for (var i = 0; i < available.length; i++) {
      var patch = available[i];
      if (player.buttons < patch.buttons) continue;
      var orientations = ORIENTATIONS[patch.id];
      for (var oi = 0; oi < orientations.length; oi++) {
        var ori = orientations[oi];
        for (var r = 0; r + ori.rows <= BOARD_SIZE; r++) {
          for (var c = 0; c + ori.cols <= BOARD_SIZE; c++) {
            if (cellsFree(player.board, absoluteCells(ori, r, c))) return true;
          }
        }
      }
    }
    return false;
  }

  function canAdvance(state, playerIndex) {
    var opponent = state.players[1 - playerIndex];
    return Math.min(LAST_SPACE, opponent.time + 1) > state.players[playerIndex].time;
  }

  function snapshotScores(state) {
    return state.players.map(function (player) {
      var empty = emptyCells(player);
      return {
        index: player.index,
        name: player.name,
        isAI: player.isAI,
        buttons: player.buttons,
        bonus: player.bonus,
        empty: empty,
        penalty: EMPTY_PENALTY * empty,
        score: player.buttons + player.bonus - EMPTY_PENALTY * empty
      };
    });
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.overReason = reason;
    var scores = snapshotScores(state);
    var winner = null;
    if (scores[0].score > scores[1].score) winner = 0;
    else if (scores[1].score > scores[0].score) winner = 1;
    state.result = {
      reason: reason,
      scores: scores,
      winner: winner
    };
    appendLog(state, null, 'end', '对局结束：' + reason);
    return state;
  }

  function evaluateEnd(state) {
    if (state.over) return state;
    var allClaimed = state.pieces.every(function (entry) { return entry.owner !== null; });
    var bothAtEnd = state.players[0].time >= LAST_SPACE && state.players[1].time >= LAST_SPACE;
    var anyBuy = hasLegalBuy(state, 0) || hasLegalBuy(state, 1);
    var anyAdvance = canAdvance(state, 0) || canAdvance(state, 1);
    var reason = null;

    if (allClaimed) reason = '33 块拼布已全部被买走';
    else if (bothAtEnd) reason = '双方时间标记都到达终点';
    else if (!anyBuy && !anyAdvance) reason = '双方都没有可购买的拼布，也无法继续前进';
    else if (state.zeroSkips >= 2 && !anyBuy) reason = '双方连续跳过，且没有可购买的拼布';
    else if (state.turn > 500) reason = '达到回合计时上限';

    if (reason) finishGame(state, reason);
    return state;
  }

  function buyPatch(state, patchId, orientationIndex, row, col, playerIndex) {
    if (state.over) throw new Error('对局已结束');
    var pi = playerIndex == null ? state.current : playerIndex;
    if (pi !== state.current) throw new Error('还没轮到这位玩家');
    var check = canPlaceFor(state, pi, patchId, orientationIndex, row, col);
    if (!check.ok) throw new Error(check.reason);

    var next = clone(state);
    var player = next.players[pi];
    var patch = patchById(patchId);
    var ori = ORIENTATIONS[patchId][orientationIndex];

    player.buttons -= patch.buttons;
    var pieceState = next.pieces.find(function (entry) { return entry.id === patchId; });
    if (!pieceState) throw new Error('拼布队列状态损坏');
    pieceState.owner = pi;
    placeOnBoard(player, patch, {
      cells: ori.cells,
      index: orientationIndex
    }, row, col);

    var movement = moveToken(player, player.time + patch.time);
    var bonusAwarded = false;
    if (next.bonusAwardedTo === null && hasSevenBySeven(player.board)) {
      next.bonusAwardedTo = pi;
      player.bonus = SEVEN_BY_SEVEN_BONUS;
      bonusAwarded = true;
    }

    var text = player.name + ' 买下「' + patch.name + '」，支付 ' + patch.buttons +
      ' 枚扣子，时间前进 ' + movement.spaces + ' 格' +
      (movement.spaces < patch.time ? '（时间成本 ' + patch.time + '，到达终点）' : '') + '。';
    if (movement.incomeEvents.length) {
      var income = movement.incomeEvents.reduce(function (sum, event) { return sum + event.amount; }, 0);
      text += ' 经过 ' + movement.incomeEvents.length + ' 个扣子格，收入 ' + income + ' 枚。';
    }
    appendLog(next, pi, 'buy', text, {
      patchId: patchId,
      cost: patch.buttons,
      timeCost: patch.time,
      incomeEvents: movement.incomeEvents
    });
    if (bonusAwarded) {
      appendLog(next, pi, 'bonus', player.name + ' 第一个完成 7×7 区域，获得 7 分奖励！');
    }

    next.lastPlayer = pi;
    next.turn += 1;
    next.zeroSkips = 0;
    advanceTurn(next);
    evaluateEnd(next);
    return next;
  }

  function skipTurn(state, playerIndex) {
    if (state.over) throw new Error('对局已结束');
    var pi = playerIndex == null ? state.current : playerIndex;
    if (pi !== state.current) throw new Error('还没轮到这位玩家');

    var next = clone(state);
    var player = next.players[pi];
    var opponent = next.players[1 - pi];
    // 原版：移动到对手前方一格；若已经领先或同格，则原地过牌。
    var target = Math.max(player.time, Math.min(LAST_SPACE, opponent.time + 1));
    var spaces = target - player.time;
    if (spaces > 0) player.buttons += spaces;
    var movement = moveToken(player, target);

    var text;
    if (spaces > 0) {
      text = player.name + ' 跳过，前进 ' + spaces + ' 格，获得 ' + spaces + ' 枚扣子。';
    } else {
      text = player.name + ' 跳过；前方没有可前进空间，轮到对手。';
    }
    if (movement.incomeEvents.length) {
      var income = movement.incomeEvents.reduce(function (sum, event) { return sum + event.amount; }, 0);
      text += ' 经过 ' + movement.incomeEvents.length + ' 个扣子格，收入 ' + income + ' 枚。';
    }
    appendLog(next, pi, 'skip', text, { gained: spaces, incomeEvents: movement.incomeEvents });

    next.lastPlayer = pi;
    next.turn += 1;
    next.zeroSkips = spaces === 0 ? next.zeroSkips + 1 : 0;
    advanceTurn(next);
    evaluateEnd(next);
    return next;
  }

  function getLegalBuyMoves(state, playerIndex) {
    var pi = playerIndex == null ? state.current : playerIndex;
    var player = state.players[pi];
    var available = getAvailablePatches(state, pi);
    var moves = [];
    available.forEach(function (patch) {
      if (player.buttons < patch.buttons) return;
      ORIENTATIONS[patch.id].forEach(function (ori, oi) {
        for (var r = 0; r + ori.rows <= BOARD_SIZE; r++) {
          for (var c = 0; c + ori.cols <= BOARD_SIZE; c++) {
            if (cellsFree(player.board, absoluteCells(ori, r, c))) {
              moves.push({
                type: 'buy',
                player: pi,
                patchId: patch.id,
                orientationIndex: oi,
                row: r,
                col: c
              });
            }
          }
        }
      });
    });
    return moves;
  }

  function getLegalMoves(state, playerIndex) {
    if (state.over) return [];
    var pi = playerIndex == null ? state.current : playerIndex;
    return [{ type: 'skip', player: pi }].concat(getLegalBuyMoves(state, pi));
  }

  function applyMove(state, move) {
    if (!move || !move.type) throw new Error('动作非法');
    if (move.type === 'buy') {
      return buyPatch(state, move.patchId, move.orientationIndex, move.row, move.col, move.player);
    }
    if (move.type === 'skip') return skipTurn(state, move.player);
    throw new Error('未知动作类型：' + move.type);
  }

  function placementScore(state, player, patch, ori, row, col) {
    var cells = absoluteCells(ori, row, col);
    var adjacency = 0;
    var edges = 0;
    cells.forEach(function (pos) {
      var r = pos[0];
      var c = pos[1];
      if (r === 0 || c === 0 || r === BOARD_SIZE - 1 || c === BOARD_SIZE - 1) edges += 1;
      [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].forEach(function (n) {
        if (n[0] >= 0 && n[1] >= 0 && n[0] < BOARD_SIZE && n[1] < BOARD_SIZE &&
            player.board[n[0]][n[1]] !== null) adjacency += 1;
      });
    });
    var bonus = 0;
    if (state.bonusAwardedTo === null) {
      var boardCopy = player.board.map(function (rowArr) { return rowArr.slice(); });
      if (wouldCompleteSeven(boardCopy, ori.cells, row, col)) bonus = 600;
    }
    return patch.size * 100 + patch.income * 35 - patch.time * 12 - patch.buttons * 2 +
      adjacency * 3 + edges * 2 + bonus;
  }

  function chooseAIMove(state) {
    if (state.over) throw new Error('对局已结束');
    var pi = state.current;
    var player = state.players[pi];
    var available = getAvailablePatches(state, pi);
    var best = null;
    var bestScore = -Infinity;

    available.forEach(function (patch) {
      if (player.buttons < patch.buttons) return;
      ORIENTATIONS[patch.id].forEach(function (ori, oi) {
        for (var r = 0; r + ori.rows <= BOARD_SIZE; r++) {
          for (var c = 0; c + ori.cols <= BOARD_SIZE; c++) {
            if (!cellsFree(player.board, absoluteCells(ori, r, c))) continue;
            var score = placementScore(state, player, patch, ori, r, c);
            if (score > bestScore) {
              bestScore = score;
              best = {
                type: 'buy',
                player: pi,
                patchId: patch.id,
                orientationIndex: oi,
                row: r,
                col: c
              };
            }
          }
        }
      });
    });

    if (!best) return { type: 'skip', player: pi };
    return best;
  }

  function summary(state) {
    return {
      turn: state.turn,
      current: state.current,
      currentName: state.players[state.current] ? state.players[state.current].name : '',
      over: state.over,
      reason: state.overReason,
      result: state.result,
      available: getAvailablePatches(state).map(function (patch) { return patch.id; }),
      players: state.players.map(function (player) {
        return {
          name: player.name,
          buttons: player.buttons,
          time: player.time,
          income: playerIncome(player),
          empty: emptyCells(player),
          score: playerScore(player),
          bonus: player.bonus
        };
      })
    };
  }

  return Object.freeze({
    BOARD_SIZE: BOARD_SIZE,
    LAST_SPACE: LAST_SPACE,
    START_BUTTONS: START_BUTTONS,
    MARKET_VISIBLE: MARKET_VISIBLE,
    SEVEN_BY_SEVEN_BONUS: SEVEN_BY_SEVEN_BONUS,
    EMPTY_PENALTY: EMPTY_PENALTY,
    INCOME_SPACES: INCOME_SPACES,
    PATCHES: PATCHES,
    createGame: createGame,
    getAvailablePatches: getAvailablePatches,
    isPatchAvailable: isPatchAvailable,
    patchById: patchById,
    orientationsFor: orientationsFor,
    rotateIndex: rotateIndex,
    flipIndex: flipIndex,
    canPlace: canPlace,
    canPlaceFor: canPlaceFor,
    buyPatch: buyPatch,
    skipTurn: skipTurn,
    getLegalBuyMoves: getLegalBuyMoves,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    evaluateEnd: evaluateEnd,
    hasLegalBuy: hasLegalBuy,
    canAdvance: canAdvance,
    hasSevenBySeven: hasSevenBySeven,
    wouldCompleteSeven: wouldCompleteSeven,
    playerIncome: playerIncome,
    emptyCells: emptyCells,
    playerScore: playerScore,
    snapshotScores: snapshotScores,
    finalScores: snapshotScores,
    summary: summary,
    colorForPatch: colorForPatch
  });
});
