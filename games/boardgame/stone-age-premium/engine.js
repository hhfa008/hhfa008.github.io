/*
 * Stone Age（石器时代）premium 纯规则引擎 — UMD
 *
 * 浏览器：globalThis.StoneAgeEngine；Node：require('./engine.js')。
 * 2–4 人；每轮三阶段：放工人 → 结算 → 喂食；8 轮左右后按建筑、文明卡、
 * 资源与乘数计分。洗牌复用 games/shared/shuffle.js 的 seeded Fisher-Yates。
 *
 * 设计约束：
 *   - 不依赖 DOM；applyMove 不修改入参，返回全新 state；
 *   - 非法动作抛 Error；AI 只从 getLegalMoves 中选择；
 *   - 同一 seed 可复现（state 只保存 seed 与 shuffleCount）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('../../shared/shuffle.js'));
  else root.StoneAgeEngine = factory(root.StoneAgeData, root.Shuffle);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA, ShuffleApi) {
  'use strict';

  if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
    throw new Error('StoneAgeEngine requires games/shared/shuffle.js');
  }

  var VERSION = '1.0.0';
  var MAX_TURNS = 5000;
  var COLORS = DATA.PLAYER_COLORS;
  var PLAYER_COUNT_MIN = 2;
  var PLAYER_COUNT_MAX = 4;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function makeResources() { return { wood: 0, brick: 0, stone: 0, gold: 0 }; }
  function totalResources(res) { return res.wood + res.brick + res.stone + res.gold; }
  function totalTools(player) {
    return player.tools.reduce(function (sum, v) { return sum + v; }, 0);
  }
  function toolValue(player) { return totalTools(player) + player.onceTools.reduce(function (s, v) { return s + v; }, 0); }

  function nextRandom(state) {
    state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
    return state.rng / 4294967296;
  }
  function rollDie(state) {
    return 1 + Math.floor(nextRandom(state) * 6);
  }

  function appendLog(state, player, type, text, data) {
    state.log.push({
      turn: state.turn,
      round: state.round,
      player: player == null ? null : player,
      type: type,
      text: text,
      data: data || null
    });
    if (state.log.length > 260) state.log.splice(0, state.log.length - 260);
  }
  function pushEvent(state, event) {
    state.events.push(event);
    if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
  }

  function makePlayer(index, name, isAI) {
    return {
      index: index,
      name: name,
      isAI: !!isAI,
      color: COLORS[index % COLORS.length],
      score: 0,
      totalWorkers: DATA.START_WORKERS,
      workersLeft: DATA.START_WORKERS,
      food: DATA.START_FOOD,
      agriculture: 0,
      tools: [],
      toolsUsed: [],
      onceTools: [],
      onceUsed: [],
      resources: makeResources(),
      buildings: [],
      civCards: [],
      resolved: false
    };
  }

  function emptySpots(playerCount, buildingCount) {
    var spots = {
      toolmaker: { workers: new Array(playerCount).fill(0), total: 0 },
      hut: { workers: new Array(playerCount).fill(0), total: 0 },
      field: { workers: new Array(playerCount).fill(0), total: 0 },
      hunt: { workers: new Array(playerCount).fill(0), total: 0 },
      forest: { workers: new Array(playerCount).fill(0), total: 0 },
      clay: { workers: new Array(playerCount).fill(0), total: 0 },
      quarry: { workers: new Array(playerCount).fill(0), total: 0 },
      river: { workers: new Array(playerCount).fill(0), total: 0 },
      civ: [],
      building: []
    };
    for (var c = 0; c < 4; c++) spots.civ.push({ workers: new Array(playerCount).fill(0), total: 0 });
    for (var b = 0; b < buildingCount; b++) spots.building.push({ workers: new Array(playerCount).fill(0), total: 0 });
    return spots;
  }

  function createGame(options) {
    var opts = options || {};
    var seed = opts.seed == null ? 1 : (Number(opts.seed) >>> 0);
    var playerCount = opts.playerCount == null ? 2 : Number(opts.playerCount);
    if (playerCount < PLAYER_COUNT_MIN || playerCount > PLAYER_COUNT_MAX) {
      throw new Error('玩家人数必须是 2–4');
    }
    var names = opts.names && opts.names.length === playerCount
      ? opts.names.slice()
      : DATA.PLAYER_NAMES.slice(0, playerCount);
    var aiFlags = opts.isAI && opts.isAI.length === playerCount
      ? opts.isAI.slice()
      : names.map(function (_, i) { return i > 0; });

    var buildingPool = ShuffleApi.shuffle(DATA.BUILDINGS.map(function (b) { return b.id; }), {
      seed: String(seed) + ':buildings'
    });
    var stacks = [];
    for (var s = 0; s < playerCount; s++) stacks.push(buildingPool.slice(s * 7, s * 7 + 7));

    var civPool = ShuffleApi.shuffle(DATA.CIV_CARDS.map(function (c) { return c.id; }), {
      seed: String(seed) + ':civ'
    });
    var civSlots = [null, null, null, null];
    for (var slot = 0; slot < 4; slot++) civSlots[slot] = civPool.pop() || null;

    var state = {
      version: VERSION,
      seed: seed,
      shuffleCount: 1,
      rng: (seed ^ 0x9e3779b9) >>> 0,
      playerCount: playerCount,
      players: [],
      round: 1,
      turn: 0,
      startPlayer: 0,
      currentPlayer: 0,
      phase: 'placement',
      spots: emptySpots(playerCount, stacks.length),
      villageUsed: [],
      buildingStacks: stacks,
      civSlots: civSlots,
      civDeck: civPool,
      resolveOrder: [],
      resolveIndex: 0,
      lastAction: null,
      lastResolve: null,
      lastFeed: null,
      log: [],
      events: [],
      over: false,
      overReason: null,
      result: null
    };
    for (var p = 0; p < playerCount; p++) state.players.push(makePlayer(p, names[p], aiFlags[p]));
    appendLog(state, null, 'start',
      '新开一局：' + playerCount + ' 人，' + stacks.length + ' 叠建筑，每人 5 工人与 12 食物。');
    appendLog(state, null, 'round', '第 1 轮开始，' + state.players[state.startPlayer].name + ' 先手。');
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 合法动作                                                            */
  /* ------------------------------------------------------------------ */
  function villageBlocked(state, spotId) {
    if (state.playerCount > 3) return false;
    if (spotId !== 'toolmaker' && spotId !== 'hut' && spotId !== 'field') return false;
    if (state.villageUsed.indexOf(spotId) !== -1) return false;
    return state.villageUsed.length >= 2;
  }

  function canPlaceOnSpot(state, player, spotId, slotIndex, workers) {
    if (!Number.isInteger(workers) || workers < 1) return false;
    if (workers > player.workersLeft) return false;
    var spot = DATA.SPOT_BY_ID[spotId];
    if (!spot) return false;
    var boardSpot;
    if (spotId === 'civ') {
      boardSpot = state.spots.civ[slotIndex];
      if (!boardSpot || boardSpot.total !== 0 || !state.civSlots[slotIndex]) return false;
      return workers === 1;
    }
    if (spotId === 'building') {
      boardSpot = state.spots.building[slotIndex];
      if (!boardSpot || boardSpot.total !== 0) return false;
      if (!state.buildingStacks[slotIndex] || !state.buildingStacks[slotIndex].length) return false;
      return workers === 1;
    }
    boardSpot = state.spots[spotId];
    if (!boardSpot) return false;
    if (spotId === 'toolmaker' || spotId === 'field') {
      if (boardSpot.total !== 0) return false;
      return workers === 1;
    }
    if (spotId === 'hut') {
      if (boardSpot.total !== 0) return false;
      return workers === 2;
    }
    if (spotId === 'hunt') return true;
    if (spot.kind === 'resource') {
      if (boardSpot.total + workers > spot.capacity) return false;
      if (state.playerCount === 2) {
        for (var i = 0; i < state.playerCount; i++) {
          if (i !== player.index && boardSpot.workers[i] > 0) return false;
        }
      } else if (state.playerCount === 3) {
        var owners = 0;
        for (var k = 0; k < state.playerCount; k++) {
          if (boardSpot.workers[k] > 0 && k !== player.index) owners += 1;
        }
        if (owners >= 2) return false;
      }
      return true;
    }
    return false;
  }

  function getLegalMoves(state) {
    if (!state || state.over) return [];
    if (state.phase === 'execute') {
      return state.players[state.currentPlayer] && !state.players[state.currentPlayer].resolved
        ? [{ type: 'resolve' }] : [];
    }
    if (state.phase === 'feed') return [{ type: 'feed' }];
    if (state.phase !== 'placement') return [];
    var player = state.players[state.currentPlayer];
    if (!player || player.workersLeft <= 0) return [];
    var moves = [];
    var blocked = state.playerCount <= 3 && state.villageUsed.length >= 2;
    DATA.SPOTS.forEach(function (spot) {
      if (spot.id === 'civ') {
        for (var slot = 0; slot < 4; slot++) {
          if (canPlaceOnSpot(state, player, 'civ', slot, 1)) {
            moves.push({ type: 'place', spotId: 'civ', slotIndex: slot, workers: 1, playerIndex: player.index });
          }
        }
        return;
      }
      if (spot.id === 'building') {
        for (var b = 0; b < state.buildingStacks.length; b++) {
          if (canPlaceOnSpot(state, player, 'building', b, 1)) {
            moves.push({ type: 'place', spotId: 'building', slotIndex: b, workers: 1, playerIndex: player.index });
          }
        }
        return;
      }
      if (blocked && (spot.id === 'toolmaker' || spot.id === 'hut' || spot.id === 'field')) return;
      if (villageBlocked(state, spot.id)) return;
      var maxWorkers = Math.min(player.workersLeft, spot.id === 'hunt' ? player.workersLeft : spot.capacity);
      if (spot.id === 'toolmaker' || spot.id === 'field') maxWorkers = 1;
      if (spot.id === 'hut') maxWorkers = 2;
      if (spot.kind === 'resource') {
        var used = state.spots[spot.id].total;
        maxWorkers = Math.min(player.workersLeft, spot.capacity - used);
      }
      for (var w = 1; w <= maxWorkers; w++) {
        if (canPlaceOnSpot(state, player, spot.id, -1, w)) {
          moves.push({ type: 'place', spotId: spot.id, slotIndex: -1, workers: w, playerIndex: player.index });
        }
      }
    });
    return moves;
  }

  /* ------------------------------------------------------------------ */
  /* 放置                                                                */
  /* ------------------------------------------------------------------ */
  function nextPlayerWithWorkers(state, from) {
    for (var i = 1; i <= state.playerCount; i++) {
      var idx = (from + i) % state.playerCount;
      if (state.players[idx].workersLeft > 0) return idx;
    }
    return -1;
  }

  function placeWorkers(state, move) {
    var player = state.players[state.currentPlayer];
    if (!canPlaceOnSpot(state, player, move.spotId, move.slotIndex, move.workers)) {
      throw new Error('该位置不能放置这些工人');
    }
    var boardSpot;
    if (move.spotId === 'civ') boardSpot = state.spots.civ[move.slotIndex];
    else if (move.spotId === 'building') boardSpot = state.spots.building[move.slotIndex];
    else boardSpot = state.spots[move.spotId];
    boardSpot.workers[player.index] += move.workers;
    boardSpot.total += move.workers;
    player.workersLeft -= move.workers;
    if (move.spotId === 'toolmaker' || move.spotId === 'hut' || move.spotId === 'field') {
      if (state.villageUsed.indexOf(move.spotId) === -1) state.villageUsed.push(move.spotId);
    }
    var spotName = DATA.SPOT_BY_ID[move.spotId] ? DATA.SPOT_BY_ID[move.spotId].name : move.spotId;
    appendLog(state, player.index, 'place',
      player.name + ' 在「' + spotName + '」放置 ' + move.workers + ' 个工人。',
      { spotId: move.spotId, slotIndex: move.slotIndex, workers: move.workers });
    pushEvent(state, { kind: 'place', player: player.index, spotId: move.spotId, slotIndex: move.slotIndex, workers: move.workers });
    state.lastAction = {
      type: 'place', player: player.index, spotId: move.spotId,
      slotIndex: move.slotIndex, workers: move.workers
    };
    state.turn += 1;
    var next = nextPlayerWithWorkers(state, state.currentPlayer);
    if (next === -1) {
      state.phase = 'execute';
      state.currentPlayer = state.startPlayer;
      state.resolveOrder = [];
      for (var i = 0; i < state.playerCount; i++) state.resolveOrder.push((state.startPlayer + i) % state.playerCount);
      state.resolveIndex = 0;
      appendLog(state, null, 'phase', '所有工人已放置，进入结算阶段。');
    } else {
      state.currentPlayer = next;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 结算                                                                */
  /* ------------------------------------------------------------------ */
  function canPay(player, cost) {
    for (var res in cost) {
      if ((player.resources[res] || 0) < cost[res]) return false;
    }
    return true;
  }
  function payCost(player, cost) {
    for (var res in cost) player.resources[res] -= cost[res];
  }
  function gainBundle(player, gain) {
    for (var res in gain) player.resources[res] = (player.resources[res] || 0) + gain[res];
  }
  function payAnyResources(player, amount) {
    var paid = 0;
    while (paid < amount) {
      var best = null;
      DATA.RESOURCES.forEach(function (res) {
        if (player.resources[res] > 0 && (!best || player.resources[res] > player.resources[best])) best = res;
      });
      if (!best) break;
      player.resources[best] -= 1;
      paid += 1;
    }
    return paid;
  }
  function addTool(player, amount) {
    var value = amount || 1;
    for (var i = 0; i < player.tools.length; i++) {
      if (player.tools[i] < DATA.MAX_TOOL) {
        player.tools[i] = Math.min(DATA.MAX_TOOL, player.tools[i] + value);
        return player.tools[i];
      }
    }
    player.tools.push(Math.min(DATA.MAX_TOOL, value));
    return player.tools[player.tools.length - 1];
  }

  function useToolsForRoll(state, player, baseSum, divisor) {
    var used = [];
    var candidates = [];
    player.tools.forEach(function (v, i) {
      if (!player.toolsUsed[i]) candidates.push({ value: v, source: 'tool', index: i });
    });
    player.onceTools.forEach(function (v, i) {
      if (!player.onceUsed[i]) candidates.push({ value: v, source: 'once', index: i });
    });
    candidates.sort(function (a, b) { return b.value - a.value; });
    var sum = baseSum;
    candidates.forEach(function (c) {
      if (Math.floor((sum + c.value) / divisor) > Math.floor(sum / divisor)) {
        sum += c.value;
        if (c.source === 'tool') player.toolsUsed[c.index] = true;
        else player.onceUsed[c.index] = true;
        used.push(c.value);
      }
    });
    return { sum: sum, used: used };
  }

  function gather(state, player, workers, spot) {
    var rolls = [];
    var base = 0;
    for (var i = 0; i < workers; i++) {
      var r = rollDie(state);
      rolls.push(r);
      base += r;
    }
    var tooled = useToolsForRoll(state, player, base, spot.divisor);
    var gain = Math.floor(tooled.sum / spot.divisor);
    if (spot.resource === 'food') player.food += gain;
    else player.resources[spot.resource] += gain;
    var result = {
      spotId: spot.id, workers: workers, rolls: rolls, base: base, tools: tooled.used,
      total: tooled.sum, divisor: spot.divisor, resource: spot.resource, gain: gain
    };
    appendLog(state, player.index, 'gather',
      player.name + ' 在「' + spot.name + '」掷 ' + rolls.join('+') + (tooled.used.length ? ' + 工具 ' + tooled.used.join('+') : '') +
      ' = ' + tooled.sum + '，获得 ' + gain + ' ' + DATA.RESOURCE_NAMES[spot.resource] + '。', result);
    pushEvent(state, { kind: 'gather', player: player.index, data: result });
    return result;
  }

  function resolveCivCard(state, player, slotIndex, cardId) {
    var card = DATA.CIV_BY_ID[cardId];
    if (!card) return null;
    var cost = 4 - slotIndex;
    if (totalResources(player.resources) < cost) {
      appendLog(state, player.index, 'civ', player.name + ' 资源不足，无法支付文明卡费用（' + cost + '）。');
      return null;
    }
    payAnyResources(player, cost);
    var top = card.top || {};
    if (top.kind === 'resource') player.resources[top.resource] += top.amount;
    else if (top.kind === 'bundle') gainBundle(player, top.gain);
    else if (top.kind === 'food') player.food += top.amount;
    else if (top.kind === 'tool') addTool(player, top.amount);
    else if (top.kind === 'agriculture') player.agriculture = Math.min(DATA.MAX_AGRICULTURE, player.agriculture + top.amount);
    else if (top.kind === 'vp') player.score += top.amount;
    else if (top.kind === 'onceTool') player.onceTools.push(top.amount);
    else if (top.kind === 'rollResource') {
      var spot = { divisor: DATA.DIVISORS[top.resource], resource: top.resource, id: 'civroll', name: '文明卡骰点' };
      var rolls = [rollDie(state), rollDie(state)];
      var base = rolls[0] + rolls[1];
      var tooled = useToolsForRoll(state, player, base, spot.divisor);
      var gain = Math.floor(tooled.sum / spot.divisor);
      player.resources[top.resource] += gain;
      appendLog(state, player.index, 'civ', player.name + ' 的「' + card.name + '」掷 ' + rolls.join('+') + ' = ' + tooled.sum + '，获得 ' + gain + ' ' + DATA.RESOURCE_NAMES[top.resource] + '。');
    }
    player.civCards.push(card.id);
    state.civSlots[slotIndex] = null;
    appendLog(state, player.index, 'civ', player.name + ' 支付 ' + cost + ' 个资源，获得文明卡「' + card.name + '」。', { cardId: card.id, slotIndex: slotIndex });
    pushEvent(state, { kind: 'civ', player: player.index, cardId: card.id, slotIndex: slotIndex, cost: cost });
    return card;
  }

  function resolvePlayer(state) {
    var player = state.players[state.currentPlayer];
    if (!player || player.resolved) throw new Error('该玩家已经结算');
    var summary = {
      player: player.index,
      name: player.name,
      gathers: [],
      tools: [],
      workersGained: 0,
      agricultureGained: 0,
      civ: [],
      buildings: [],
      food: 0
    };
    ['forest', 'clay', 'quarry', 'river', 'hunt'].forEach(function (spotId) {
      var spot = DATA.SPOT_BY_ID[spotId];
      var workers = state.spots[spotId].workers[player.index];
      if (workers > 0) summary.gathers.push(gather(state, player, workers, spot));
    });
    var tm = state.spots.toolmaker.workers[player.index];
    if (tm > 0) {
      var newValue = addTool(player, 1);
      summary.tools.push(newValue);
      appendLog(state, player.index, 'tool', player.name + ' 在工具坊获得/升级工具到 ' + newValue + '。');
      pushEvent(state, { kind: 'tool', player: player.index, value: newValue });
    }
    var hut = state.spots.hut.workers[player.index];
    if (hut > 0) {
      var before = player.totalWorkers;
      player.totalWorkers = Math.min(DATA.MAX_WORKERS, player.totalWorkers + 1);
      summary.workersGained = player.totalWorkers - before;
      appendLog(state, player.index, 'worker', player.name + ' 的成长小屋带来 1 个新工人（下轮可用，现 ' + player.totalWorkers + '）。');
      pushEvent(state, { kind: 'worker', player: player.index, totalWorkers: player.totalWorkers });
    }
    var field = state.spots.field.workers[player.index];
    if (field > 0) {
      var beforeAgri = player.agriculture;
      player.agriculture = Math.min(DATA.MAX_AGRICULTURE, player.agriculture + 1);
      summary.agricultureGained = player.agriculture - beforeAgri;
      appendLog(state, player.index, 'field', player.name + ' 的农业提升到 ' + player.agriculture + '。');
      pushEvent(state, { kind: 'agriculture', player: player.index, level: player.agriculture });
    }
    for (var slot = 0; slot < 4; slot++) {
      if (state.spots.civ[slot].workers[player.index] > 0 && state.civSlots[slot]) {
        var card = resolveCivCard(state, player, slot, state.civSlots[slot]);
        if (card) summary.civ.push(card.id);
      }
    }
    for (var b = 0; b < state.buildingStacks.length; b++) {
      if (state.spots.building[b].workers[player.index] > 0) {
        var stack = state.buildingStacks[b];
        if (!stack || !stack.length) continue;
        var building = DATA.BUILDING_BY_ID[stack[stack.length - 1]];
        if (building && canPay(player, building.cost)) {
          payCost(player, building.cost);
          player.score += building.points;
          player.buildings.push(building.id);
          stack.pop();
          summary.buildings.push({ id: building.id, name: building.name, points: building.points });
          appendLog(state, player.index, 'building', player.name + ' 建造「' + building.name + '」，立即得 ' + building.points + ' 分。');
          pushEvent(state, { kind: 'building', player: player.index, buildingId: building.id, points: building.points });
        } else if (building) {
          appendLog(state, player.index, 'building', player.name + ' 资源不足，未能建造「' + building.name + '」。');
        }
      }
    }
    player.resolved = true;
    state.lastResolve = summary;
    state.turn += 1;
    state.resolveIndex += 1;
    if (state.resolveIndex >= state.resolveOrder.length) {
      state.phase = 'feed';
      appendLog(state, null, 'phase', '所有玩家结算完毕，进入喂食阶段。');
    } else {
      state.currentPlayer = state.resolveOrder[state.resolveIndex];
    }
    return summary;
  }

  /* ------------------------------------------------------------------ */
  /* 喂食与回合结束                                                      */
  /* ------------------------------------------------------------------ */
  function feedPlayer(state, player) {
    var need = Math.max(0, player.totalWorkers - player.agriculture);
    var consumedFood = Math.min(player.food, need);
    player.food -= consumedFood;
    var shortfall = need - consumedFood;
    var paid = 0;
    if (shortfall > 0) {
      paid = payAnyResources(player, shortfall);
      shortfall -= paid;
    }
    var penalty = 0;
    if (shortfall > 0) {
      penalty = 10;
      player.score = Math.max(0, player.score - penalty);
    }
    var row = {
      player: player.index,
      name: player.name,
      workers: player.totalWorkers,
      agriculture: player.agriculture,
      need: need,
      foodUsed: consumedFood,
      resourcesPaid: paid,
      shortfall: shortfall,
      penalty: penalty,
      foodLeft: player.food,
      scoreAfter: player.score
    };
    appendLog(state, player.index, 'feed',
      player.name + ' 喂食：需要 ' + need + '，农业 ' + player.agriculture + '，吃食物 ' + consumedFood +
      (paid ? '，资源补 ' + paid : '') + (penalty ? '，缺粮罚 ' + penalty + ' 分' : '') + '。', row);
    pushEvent(state, { kind: 'feed', player: player.index, row: row });
    return row;
  }

  function feedAll(state) {
    var rows = state.players.map(function (player) { return feedPlayer(state, player); });
    state.lastFeed = rows;
    state.turn += 1;
    var stacksEmpty = state.buildingStacks.some(function (stack) { return stack.length === 0; });
    var civAvailable = state.civDeck.length + state.civSlots.filter(Boolean).length;
    if (stacksEmpty) {
      finishGame(state, '至少一叠建筑已耗尽');
      return state;
    }
    if (civAvailable < 4) {
      finishGame(state, '文明卡不足以填满 4 个展示位');
      return state;
    }
    state.round += 1;
    state.startPlayer = (state.startPlayer + 1) % state.playerCount;
    state.currentPlayer = state.startPlayer;
    state.phase = 'placement';
    state.spots = emptySpots(state.playerCount, state.buildingStacks.length);
    state.villageUsed = [];
    state.resolveOrder = [];
    state.resolveIndex = 0;
    state.players.forEach(function (player) {
      player.workersLeft = player.totalWorkers;
      player.toolsUsed = [];
      player.onceTools = [];
      player.onceUsed = [];
      player.resolved = false;
    });
    for (var slot = 0; slot < 4; slot++) {
      if (!state.civSlots[slot] && state.civDeck.length) state.civSlots[slot] = state.civDeck.pop();
    }
    appendLog(state, null, 'round', '第 ' + state.round + ' 轮开始，先手为 ' + state.players[state.startPlayer].name + '。');
    if (state.turn > MAX_TURNS) finishGame(state, '达到回合上限，强制结算');
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 终局计分                                                            */
  /* ------------------------------------------------------------------ */
  function scorePlayer(player) {
    var cultureCounts = {};
    DATA.CULTURE_SYMBOLS.forEach(function (key) { cultureCounts[key] = 0; });
    var multipliers = { farmer: 0, toolmaker: 0, hutbuilder: 0, shaman: 0 };
    player.civCards.forEach(function (id) {
      var card = DATA.CIV_BY_ID[id];
      if (!card || !card.bottom) return;
      if (card.bottom.kind === 'culture' && cultureCounts[card.bottom.key] != null) cultureCounts[card.bottom.key] += 1;
      if (card.bottom.kind === 'multiplier' && multipliers[card.bottom.key] != null) multipliers[card.bottom.key] += 1;
    });
    var culturePoints = 0;
    var sets = [];
    while (true) {
      var present = DATA.CULTURE_SYMBOLS.filter(function (key) { return cultureCounts[key] > 0; });
      if (!present.length) break;
      culturePoints += present.length * present.length;
      sets.push(present.length);
      present.forEach(function (key) { cultureCounts[key] -= 1; });
    }
    var toolPoints = totalTools(player);
    var multiplierPoints =
      multipliers.farmer * player.agriculture +
      multipliers.toolmaker * toolPoints +
      multipliers.hutbuilder * player.buildings.length +
      multipliers.shaman * player.totalWorkers;
    var resourcePoints = totalResources(player.resources);
    return {
      index: player.index,
      name: player.name,
      base: player.score,
      culture: culturePoints,
      cultureSets: sets,
      multipliers: multiplierPoints,
      multiplierBreakdown: {
        farmer: multipliers.farmer * player.agriculture,
        toolmaker: multipliers.toolmaker * toolPoints,
        hutbuilder: multipliers.hutbuilder * player.buildings.length,
        shaman: multipliers.shaman * player.totalWorkers
      },
      resourcePoints: resourcePoints,
      resources: Object.assign({}, player.resources),
      tools: toolPoints,
      agriculture: player.agriculture,
      workers: player.totalWorkers,
      buildings: player.buildings.length,
      civCards: player.civCards.slice(),
      tiebreak: player.agriculture + toolPoints + player.totalWorkers,
      total: player.score + culturePoints + multiplierPoints + resourcePoints
    };
  }

  function getResults(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    if (state.result) return state.result;
    var rows = state.players.map(scorePlayer);
    var best = rows.reduce(function (max, row) { return Math.max(max, row.total); }, -Infinity);
    return {
      over: false,
      reason: null,
      round: state.round,
      scores: rows,
      winners: rows.filter(function (row) { return row.total === best; }).map(function (row) { return row.index; }),
      tied: rows.filter(function (row) { return row.total === best; }).length > 1
    };
  }

  function finishGame(state, reason) {
    if (state.over) return state;
    state.over = true;
    state.phase = 'gameover';
    state.overReason = reason;
    var rows = state.players.map(scorePlayer);
    var best = rows.reduce(function (max, row) { return Math.max(max, row.total); }, -Infinity);
    var winners = rows.filter(function (row) { return row.total === best; });
    if (winners.length > 1) {
      var bestTie = winners.reduce(function (max, row) { return Math.max(max, row.tiebreak); }, -Infinity);
      winners = winners.filter(function (row) { return row.tiebreak === bestTie; });
    }
    state.result = {
      over: true,
      reason: reason,
      round: state.round,
      scores: rows,
      winners: winners.map(function (row) { return row.index; }),
      winner: winners.length === 1 ? winners[0].index : null,
      tied: winners.length > 1,
      bestTiebreak: winners.length && winners[0].tiebreak
    };
    appendLog(state, null, 'end',
      '对局结束：' + reason + '。' + rows.map(function (row) { return row.name + ' ' + row.total + ' 分'; }).join('，') + '。');
    pushEvent(state, { kind: 'over', result: state.result });
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 动作入口                                                            */
  /* ------------------------------------------------------------------ */
  function applyMove(state, move) {
    if (!state || state.over) throw new Error('对局已结束');
    if (!move || typeof move !== 'object') throw new Error('动作非法');
    var legal = getLegalMoves(state);
    var match = legal.some(function (m) {
      if (m.type !== move.type) return false;
      if (m.type === 'place') {
        return m.spotId === move.spotId && m.slotIndex === (move.slotIndex == null ? -1 : move.slotIndex) && m.workers === move.workers;
      }
      return true;
    });
    if (!match) throw new Error('非法动作：' + JSON.stringify(move));
    var next = clone(state);
    if (move.type === 'place') placeWorkers(next, move);
    else if (move.type === 'resolve') resolvePlayer(next);
    else if (move.type === 'feed') feedAll(next);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* AI                                                                  */
  /* ------------------------------------------------------------------ */
  function hashString(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function spotValue(state, player, move) {
    var spot = DATA.SPOT_BY_ID[move.spotId];
    var workers = move.workers;
    var foodNeed = Math.max(0, player.totalWorkers - player.agriculture - player.food);
    var value = 0;
    if (move.spotId === 'hunt') {
      value = (foodNeed > 0 ? 7 : 1.2) * workers;
    } else if (spot.kind === 'resource') {
      var scarcity = 3 - Math.min(3, player.resources[spot.resource]);
      value = (2 + scarcity + (workers > 1 ? 0.4 : 0)) * workers;
    } else if (move.spotId === 'field') {
      value = player.agriculture < 7 ? 9 : 2;
    } else if (move.spotId === 'hut') {
      value = player.totalWorkers < 8 ? 8 : 2;
    } else if (move.spotId === 'toolmaker') {
      value = player.tools.length < 3 ? 6 : 3;
    } else if (move.spotId === 'civ') {
      var card = DATA.CIV_BY_ID[state.civSlots[move.slotIndex]];
      var cost = 4 - move.slotIndex;
      value = card ? 10 + (card.top && card.top.kind === 'vp' ? 6 : 2) : -20;
      if (totalResources(player.resources) < cost) value -= 16;
    } else if (move.spotId === 'building') {
      var stack = state.buildingStacks[move.slotIndex];
      var building = stack && stack.length ? DATA.BUILDING_BY_ID[stack[stack.length - 1]] : null;
      value = building && canPay(player, building.cost) ? building.points * 1.4 + 9 : -10;
    }
    if (move.spotId === 'hunt' && foodNeed <= 0) value -= 6;
    if (spot.kind === 'resource' && totalResources(player.resources) > 14) value -= 4;
    // Slight preference for placing more workers where it directly converts.
    return value + ((hashString(move.spotId + ':' + (move.slotIndex == null ? -1 : move.slotIndex) + ':' + workers + ':' + state.turn) % 97) / 1000);
  }

  function chooseAIMove(state) {
    if (!state || state.over) throw new Error('对局已结束');
    var legal = getLegalMoves(state);
    if (!legal.length) throw new Error('没有合法动作');
    if (state.phase !== 'placement') return legal[0];
    var player = state.players[state.currentPlayer];
    var best = null;
    var bestValue = -Infinity;
    legal.forEach(function (move) {
      var value = spotValue(state, player, move);
      if (value > bestValue) { bestValue = value; best = move; }
    });
    return best || legal[0];
  }

  function isGameOver(state) { return !!(state && state.over); }
  function currentPlayer(state) {
    if (!state || !state.players) throw new Error('缺少对局状态');
    return state.players[state.currentPlayer];
  }
  function summary(state) {
    return {
      round: state.round,
      phase: state.phase,
      currentPlayer: state.currentPlayer,
      startPlayer: state.startPlayer,
      scores: state.players.map(function (p) { return p.score; }),
      workers: state.players.map(function (p) { return p.totalWorkers; }),
      food: state.players.map(function (p) { return p.food; }),
      resources: state.players.map(function (p) { return Object.assign({}, p.resources); }),
      buildingStacks: state.buildingStacks.map(function (s) { return s.length; }),
      civSlots: state.civSlots.slice(),
      civDeck: state.civDeck.length
    };
  }

  return Object.freeze({
    VERSION: VERSION,
    MAX_TURNS: MAX_TURNS,
    RESOURCES: DATA.RESOURCES,
    RESOURCE_NAMES: DATA.RESOURCE_NAMES,
    DIVISORS: DATA.DIVISORS,
    SPOTS: DATA.SPOTS,
    BUILDINGS: DATA.BUILDINGS,
    CIV_CARDS: DATA.CIV_CARDS,
    CULTURE_SYMBOLS: DATA.CULTURE_SYMBOLS,
    MULTIPLIERS: DATA.MULTIPLIERS,
    createGame: createGame,
    getLegalMoves: getLegalMoves,
    applyMove: applyMove,
    chooseAIMove: chooseAIMove,
    isGameOver: isGameOver,
    getResults: getResults,
    currentPlayer: currentPlayer,
    summary: summary,
    scorePlayer: scorePlayer,
    totalTools: totalTools,
    totalResources: totalResources
  });
});
