/*
 * War Chest（战争宝箱）简化版规则引擎 — UMD
 *
 * 浏览器：先加载 data.js，再加载本文件，使用 globalThis.WarChestEngine。
 * Node：  const Engine = require('./engine.js')
 *
 * 设计约束：
 *   - 不依赖 DOM；所有动作返回新局面，不修改传入的 state。
 *   - 随机性来自 createGame 的 seed，洗袋结果可复现。
 *   - 所有动作共用同一套合法性检查；AI 只从 legalActions 里选择。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.WarChestEngine = factory(root.WarChestData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  if (!DATA || !DATA.UNITS || !DATA.STRONGHOLDS) throw new Error('WarChestEngine 需要 data.js');

  var SIZE = DATA.BOARD_SIZE;
  var WIN = DATA.WIN_STRONGHOLDS;
  var DRAW = DATA.HAND_DRAW;
  var MAX_TURNS = DATA.MAX_TURNS;
  var UNITS = DATA.UNITS;
  var ORDER = DATA.UNIT_ORDER;
  var PLAYER_NAMES = DATA.PLAYER_NAMES;
  var DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /* ------------------------------------------------------------------ */
  /* 基础工具                                                            */
  /* ------------------------------------------------------------------ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function keyOf(r, c) { return r + ',' + c; }

  function inBounds(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && c >= 0 && r < SIZE && c < SIZE;
  }

  function manhattan(a, b) {
    return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  }

  function coordText(r, c) {
    return '第' + (r + 1) + '行第' + (c + 1) + '列';
  }

  function playerName(index) {
    return PLAYER_NAMES[index] || ('玩家 ' + index);
  }

  function nextRandom(state) {
    state.rng = (state.rng + 0x6D2B79F5) | 0;
    var t = state.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function shuffleMut(list, state) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(nextRandom(state) * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function appendLog(state, player, type, text) {
    state.log.push({ turn: state.turn, player: player, type: type, text: text });
    if (state.log.length > 400) state.log.shift();
  }

  /* ------------------------------------------------------------------ */
  /* 棋盘查询                                                            */
  /* ------------------------------------------------------------------ */

  function unitAt(state, r, c) {
    for (var i = 0; i < state.units.length; i++) {
      var unit = state.units[i];
      if (unit.r === r && unit.c === c) return unit;
    }
    return null;
  }

  function findUnit(state, id) {
    for (var i = 0; i < state.units.length; i++) {
      if (state.units[i].id === id) return state.units[i];
    }
    return null;
  }

  function strongholdAt(state, r, c) {
    for (var i = 0; i < state.strongholds.length; i++) {
      var sh = state.strongholds[i];
      if (sh.r === r && sh.c === c) return sh;
    }
    return null;
  }

  function baseAt(state, r, c) {
    for (var i = 0; i < state.bases.length; i++) {
      var base = state.bases[i];
      if (base.r === r && base.c === c) return base;
    }
    return null;
  }

  function baseOf(state, owner) {
    for (var i = 0; i < state.bases.length; i++) {
      if (state.bases[i].owner === owner) return state.bases[i];
    }
    return null;
  }

  function homeAnchor(state, playerIndex) {
    var base = baseOf(state, playerIndex);
    if (base) return base;
    for (var i = 0; i < state.strongholds.length; i++) {
      var sh = state.strongholds[i];
      if (sh.owner === playerIndex) return sh;
    }
    return { r: playerIndex === 0 ? 6 : 0, c: 3 };
  }

  function controlCount(state, playerIndex) {
    var n = 0;
    state.strongholds.forEach(function (sh) {
      if (sh.owner === playerIndex) n++;
    });
    return n;
  }

  function unitsOf(state, playerIndex) {
    return state.units.filter(function (unit) { return unit.owner === playerIndex; });
  }

  function coinTotal(player) {
    return player.bag.length + player.hand.length + player.discard.length;
  }

  function handCounts(player) {
    var counts = {};
    ORDER.forEach(function (type) { counts[type] = 0; });
    player.hand.forEach(function (type) {
      if (counts[type] == null) counts[type] = 0;
      counts[type]++;
    });
    return counts;
  }

  function remainingReserve(player, type) {
    return player.reserves[type] || 0;
  }

  /* ------------------------------------------------------------------ */
  /* 开局与抽币                                                          */
  /* ------------------------------------------------------------------ */

  function makePlayer(index, isAI) {
    var reserves = {};
    ORDER.forEach(function (type) { reserves[type] = UNITS[type].count; });
    return {
      index: index,
      name: playerName(index),
      isAI: !!isAI,
      bag: [],
      hand: [],
      discard: [],
      reserves: reserves
    };
  }

  function buildBag(state) {
    var bag = [];
    ORDER.forEach(function (type) {
      for (var i = 0; i < UNITS[type].count; i++) bag.push(type);
    });
    shuffleMut(bag, state);
    return bag;
  }

  // 把手牌补到 3 枚；袋空则把弃币洗回袋中。
  function refillMut(state, playerIndex) {
    var player = state.players[playerIndex];
    var drew = 0;
    while (player.hand.length < DRAW) {
      if (!player.bag.length) {
        if (!player.discard.length) break;
        player.bag = player.discard.slice();
        player.discard = [];
        shuffleMut(player.bag, state);
        appendLog(state, playerIndex, 'reshuffle', player.name + ' 的弃币洗回单位袋');
      }
      player.hand.push(player.bag.pop());
      drew++;
    }
    return drew;
  }

  function drawHand(state, playerIndex) {
    var next = clone(state);
    refillMut(next, playerIndex == null ? next.current : playerIndex);
    return next;
  }

  function createGame(options) {
    options = options || {};
    var seed = (options.seed == null ? 1 : options.seed) >>> 0;
    if (!seed) seed = 1;
    var aiPlayer = options.aiPlayer == null ? 1 : options.aiPlayer;
    var state = {
      size: SIZE,
      turn: 1,
      current: 0,
      over: false,
      result: null,
      rng: seed,
      maxTurns: options.maxTurns == null ? MAX_TURNS : options.maxTurns,
      players: [makePlayer(0, aiPlayer === 0), makePlayer(1, aiPlayer === 1)],
      units: [],
      nextUnitId: 1,
      strongholds: DATA.STRONGHOLDS.map(function (sh) {
        return { id: sh.id, r: sh.r, c: sh.c, side: sh.side, owner: sh.start == null ? null : sh.start };
      }),
      bases: DATA.BASES.map(function (base) {
        return { owner: base.owner, r: base.r, c: base.c, name: base.name };
      }),
      log: []
    };
    state.players[0].bag = buildBag(state);
    state.players[1].bag = buildBag(state);
    refillMut(state, 0);
    refillMut(state, 1);
    appendLog(state, 0, 'turn', '第 1 回合：双方各抽 3 枚单位币');
    return state;
  }

  /* ------------------------------------------------------------------ */
  /* 部署                                                                */
  /* ------------------------------------------------------------------ */

  function deployNeighbourAllowed(state, playerIndex, r, c) {
    for (var i = 0; i < DIRS.length; i++) {
      var nr = r + DIRS[i][0];
      var nc = c + DIRS[i][1];
      if (!inBounds(nr, nc)) continue;
      var sh = strongholdAt(state, nr, nc);
      if (sh && sh.owner === playerIndex) return true;
    }
    return false;
  }

  function canDeploy(state, unitType, r, c, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    if (state.over) return { ok: false, reason: '对局已结束' };
    if (playerIndex !== state.current) return { ok: false, reason: '还没轮到你行动' };
    var def = UNITS[unitType];
    if (!def) return { ok: false, reason: '未知的单位类型' };
    var player = state.players[playerIndex];
    if (!player) return { ok: false, reason: '玩家不存在' };
    if (player.hand.indexOf(unitType) === -1) return { ok: false, reason: '手里没有' + def.name + '币' };
    if (remainingReserve(player, unitType) <= 0) return { ok: false, reason: '预备队里没有' + def.name + '了' };
    if (!inBounds(r, c)) return { ok: false, reason: '目标位置超出棋盘' };
    if (unitAt(state, r, c)) return { ok: false, reason: '目标格已有单位' };
    if (strongholdAt(state, r, c)) return { ok: false, reason: '不能直接部署到据点，需要移动占领' };
    if (!deployNeighbourAllowed(state, playerIndex, r, c)) {
      return { ok: false, reason: '只能部署在己方据点的相邻空格' };
    }
    return { ok: true, reason: '' };
  }

  function legalDeployCells(state, unitType, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    var out = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (canDeploy(state, unitType, r, c, playerIndex).ok) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  function spendCoinMut(state, playerIndex, unitType) {
    var hand = state.players[playerIndex].hand;
    var index = hand.indexOf(unitType);
    if (index < 0) throw new Error('手里没有' + UNITS[unitType].name + '币');
    hand.splice(index, 1);
    state.players[playerIndex].discard.push(unitType);
  }

  function deploy(state, unitType, r, c, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    var check = canDeploy(state, unitType, r, c, playerIndex);
    if (!check.ok) throw new Error(check.reason);
    var next = clone(state);
    spendCoinMut(next, playerIndex, unitType);
    next.players[playerIndex].reserves[unitType]--;
    var unit = {
      id: next.nextUnitId++,
      owner: playerIndex,
      type: unitType,
      r: r,
      c: c,
      hp: UNITS[unitType].defense || 1,
      maxHp: UNITS[unitType].defense || 1
    };
    next.units.push(unit);
    appendLog(next, playerIndex, 'deploy',
      playerName(playerIndex) + ' 部署 ' + UNITS[unitType].name + ' 到 ' + coordText(r, c));
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* 移动                                                                */
  /* ------------------------------------------------------------------ */

  // 从单位当前位置出发，返回最多 move 步可达的空格（含敌方大本营，但不从其继续扩展）。
  function bfsReach(state, unit) {
    var limit = UNITS[unit.type].move;
    var seen = {};
    var queue = [{ r: unit.r, c: unit.c, d: 0 }];
    var out = [];
    seen[keyOf(unit.r, unit.c)] = 0;
    while (queue.length) {
      var cur = queue.shift();
      if (cur.d >= limit) continue;
      for (var i = 0; i < DIRS.length; i++) {
        var nr = cur.r + DIRS[i][0];
        var nc = cur.c + DIRS[i][1];
        if (!inBounds(nr, nc)) continue;
        var k = keyOf(nr, nc);
        if (seen[k] !== undefined) continue;
        if (unitAt(state, nr, nc)) continue;
        var d = cur.d + 1;
        seen[k] = d;
        out.push({ r: nr, c: nc, dist: d });
        queue.push({ r: nr, c: nc, d: d });
      }
    }
    out.sort(function (a, b) {
      return (a.dist - b.dist) || (a.r - b.r) || (a.c - b.c);
    });
    return out;
  }

  function canMove(state, unitId, to, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    if (state.over) return { ok: false, reason: '对局已结束' };
    if (playerIndex !== state.current) return { ok: false, reason: '还没轮到你行动' };
    var unit = findUnit(state, unitId);
    if (!unit) return { ok: false, reason: '单位不存在' };
    if (unit.owner !== playerIndex) return { ok: false, reason: '不能操作敌方单位' };
    var def = UNITS[unit.type];
    var player = state.players[playerIndex];
    if (player.hand.indexOf(unit.type) === -1) {
      return { ok: false, reason: '手里没有' + def.name + '币' };
    }
    if (!to || !inBounds(to.r, to.c)) return { ok: false, reason: '目标位置超出棋盘' };
    if (unit.r === to.r && unit.c === to.c) {
      return { ok: false, reason: '原地不动不能作为移动，请选择攻击或结束回合' };
    }
    if (unitAt(state, to.r, to.c)) return { ok: false, reason: '目标格已有单位' };
    var reachable = bfsReach(state, unit);
    var found = null;
    reachable.forEach(function (cell) {
      if (cell.r === to.r && cell.c === to.c) found = cell;
    });
    if (!found) return { ok: false, reason: '超出移动范围或被其他单位阻挡' };
    return { ok: true, reason: '', dist: found.dist, def: def };
  }

  function captureStronghold(next, unit) {
    var sh = strongholdAt(next, unit.r, unit.c);
    if (sh && sh.owner !== unit.owner) {
      sh.owner = unit.owner;
      appendLog(next, unit.owner, 'control',
        playerName(unit.owner) + ' 控制了据点 ' + sh.id.toUpperCase() + '（' + coordText(sh.r, sh.c) + '）');
    }
  }

  function checkWin(next, unit) {
    for (var p = 0; p < 2; p++) {
      if (controlCount(next, p) >= WIN) {
        finishGame(next, p, '控制了 ' + WIN + ' 个据点');
        return true;
      }
    }
    return false;
  }

  function moveUnit(state, unitId, to, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    var check = canMove(state, unitId, to, playerIndex);
    if (!check.ok) throw new Error(check.reason);
    var next = clone(state);
    spendCoinMut(next, playerIndex, findUnit(next, unitId).type);
    var unit = findUnit(next, unitId);
    unit.r = to.r;
    unit.c = to.c;
    appendLog(next, playerIndex, 'move',
      playerName(playerIndex) + ' 的 ' + UNITS[unit.type].name + ' 移动到 ' + coordText(to.r, to.c));
    captureStronghold(next, unit);
    checkWin(next, unit);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* 攻击                                                                */
  /* ------------------------------------------------------------------ */

  function findApproach(state, unit, target) {
    var range = UNITS[unit.type].range;
    if (range <= 0) return null;
    if (manhattan(unit, target) <= range) return { r: unit.r, c: unit.c, dist: 0 };
    var cells = bfsReach(state, unit);
    var best = null;
    cells.forEach(function (cell) {
      if (manhattan(cell, target) > range) return;
      var score = cell.dist * 3 + manhattan(cell, target);
      if (!best || score < best.score ||
        (score === best.score && (cell.r < best.r || (cell.r === best.r && cell.c < best.c)))) {
        best = { r: cell.r, c: cell.c, dist: cell.dist, score: score };
      }
    });
    return best;
  }

  function canAttack(state, unitId, targetId, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    if (state.over) return { ok: false, reason: '对局已结束' };
    if (playerIndex !== state.current) return { ok: false, reason: '还没轮到你行动' };
    var unit = findUnit(state, unitId);
    if (!unit) return { ok: false, reason: '单位不存在' };
    if (unit.owner !== playerIndex) return { ok: false, reason: '不能操作敌方单位' };
    var def = UNITS[unit.type];
    if (def.range <= 0) return { ok: false, reason: def.name + '不能攻击' };
    var player = state.players[playerIndex];
    if (player.hand.indexOf(unit.type) === -1) {
      return { ok: false, reason: '手里没有' + def.name + '币' };
    }
    var target = findUnit(state, targetId);
    if (!target) return { ok: false, reason: '目标单位不存在' };
    if (target.owner === playerIndex) return { ok: false, reason: '不能攻击己方单位' };
    var approach = findApproach(state, unit, target);
    if (!approach) return { ok: false, reason: '目标不在攻击范围内，且移动后也无法接近' };
    return { ok: true, reason: '', approach: approach, def: def };
  }

  function attackUnit(state, unitId, targetId, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    var check = canAttack(state, unitId, targetId, playerIndex);
    if (!check.ok) throw new Error(check.reason);
    var next = clone(state);
    spendCoinMut(next, playerIndex, findUnit(next, unitId).type);
    var attacker = findUnit(next, unitId);
    var target = findUnit(next, targetId);
    var approach = check.approach;
    var moved = attacker.r !== approach.r || attacker.c !== approach.c;
    if (moved) {
      attacker.r = approach.r;
      attacker.c = approach.c;
      captureStronghold(next, attacker);
    }
    var targetType = target.type;
    var targetOwner = target.owner;
    target.hp = (target.hp == null ? (UNITS[targetType].defense || 1) : target.hp) - 1;
    var killed = target.hp <= 0;
    if (killed) {
      var index = next.units.indexOf(target);
      next.units.splice(index, 1);
      next.players[targetOwner].reserves[targetType]++;
    }
    appendLog(next, playerIndex, 'attack',
      playerName(playerIndex) + ' 的 ' + UNITS[attacker.type].name + ' 攻击 ' +
      playerName(targetOwner) + ' 的 ' + UNITS[targetType].name +
      (moved ? '（先移动到 ' + coordText(approach.r, approach.c) + '）' : '') +
      (killed ? '，将其击破' : '，目标还剩 ' + target.hp + ' 点耐久'));
    checkWin(next, attacker);
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* 回合与胜负                                                          */
  /* ------------------------------------------------------------------ */

  function finishGame(state, winner, reason) {
    if (state.over) return state;
    state.over = true;
    state.result = {
      winner: winner,
      reason: reason,
      turn: state.turn,
      control: [controlCount(state, 0), controlCount(state, 1)],
      units: [unitsOf(state, 0).length, unitsOf(state, 1).length]
    };
    var who = winner == null ? '平局' : (winner === 0 ? '你获胜' : 'AI 获胜');
    appendLog(state, winner == null ? state.current : winner, 'result', '对局结束：' + who + ' — ' + reason);
    return state;
  }

  function finishByTiebreak(state) {
    var control = [controlCount(state, 0), controlCount(state, 1)];
    var units = [unitsOf(state, 0).length, unitsOf(state, 1).length];
    var winner = null;
    if (control[0] !== control[1]) winner = control[0] > control[1] ? 0 : 1;
    else if (units[0] !== units[1]) winner = units[0] > units[1] ? 0 : 1;
    return finishGame(state, winner,
      '达到 ' + state.maxTurns + ' 个玩家回合上限，按据点数和场上兵力判定（据点 ' +
      control[0] + ':' + control[1] + '，兵力 ' + units[0] + ':' + units[1] + '）');
  }

  function endTurn(state) {
    if (state.over) return clone(state);
    var next = clone(state);
    var player = next.players[next.current];
    while (player.hand.length) player.discard.push(player.hand.pop());
    if (next.turn >= next.maxTurns) {
      finishByTiebreak(next);
      return next;
    }
    next.current = 1 - next.current;
    next.turn++;
    var drew = refillMut(next, next.current);
    appendLog(next, next.current, 'turn',
      '第 ' + next.turn + ' 回合：' + playerName(next.current) + ' 抽了 ' + drew + ' 枚单位币');
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* 合法动作与 AI                                                       */
  /* ------------------------------------------------------------------ */

  function actionKey(action) {
    return [
      action.type,
      action.unitType || '',
      action.unitId == null ? '' : action.unitId,
      action.r == null ? '' : action.r,
      action.c == null ? '' : action.c,
      action.targetUnitId == null ? '' : action.targetUnitId
    ].join(':');
  }

  function legalActions(state, playerIndex) {
    if (state.over) return [];
    if (playerIndex == null) playerIndex = state.current;
    if (playerIndex !== state.current) return [];
    var player = state.players[playerIndex];
    var types = [];
    player.hand.forEach(function (type) {
      if (types.indexOf(type) === -1) types.push(type);
    });
    var actions = [];
    types.forEach(function (type) {
      legalDeployCells(state, type, playerIndex).forEach(function (cell) {
        actions.push({ type: 'deploy', player: playerIndex, unitType: type, r: cell.r, c: cell.c });
      });
      unitsOf(state, playerIndex).forEach(function (unit) {
        if (unit.type !== type) return;
        bfsReach(state, unit).forEach(function (cell) {
          if (canMove(state, unit.id, cell, playerIndex).ok) {
            actions.push({
              type: 'move', player: playerIndex, unitType: type, unitId: unit.id,
              to: { r: cell.r, c: cell.c }
            });
          }
        });
        state.units.forEach(function (target) {
          if (target.owner === playerIndex) return;
          var check = canAttack(state, unit.id, target.id, playerIndex);
          if (check.ok) {
            actions.push({
              type: 'attack', player: playerIndex, unitType: type, unitId: unit.id,
              targetUnitId: target.id, approach: check.approach
            });
          }
        });
      });
    });
    var seen = {};
    return actions.filter(function (action) {
      var k = actionKey(action);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    }).sort(function (a, b) {
      return actionKey(a) < actionKey(b) ? -1 : actionKey(a) > actionKey(b) ? 1 : 0;
    });
  }

  function applyAction(state, action) {
    if (!action || !action.type) throw new Error('动作格式不正确');
    if (action.type === 'end') return endTurn(state);
    if (action.type === 'deploy') {
      return deploy(state, action.unitType, action.r, action.c, action.player);
    }
    if (action.type === 'move') {
      return moveUnit(state, action.unitId, action.to, action.player);
    }
    if (action.type === 'attack') {
      return attackUnit(state, action.unitId, action.targetUnitId, action.player);
    }
    throw new Error('未知的动作类型：' + action.type);
  }

  function nearestTargetStrongholdDist(state, playerIndex, r, c) {
    var best = Infinity;
    state.strongholds.forEach(function (sh) {
      if (sh.owner === playerIndex) return;
      var d = Math.abs(sh.r - r) + Math.abs(sh.c - c);
      if (d < best) best = d;
    });
    return best === Infinity ? 0 : best;
  }

  function nearestEnemyDist(state, playerIndex, pos) {
    var best = Infinity;
    state.units.forEach(function (unit) {
      if (unit.owner === playerIndex) return;
      var d = Math.abs(unit.r - pos.r) + Math.abs(unit.c - pos.c);
      if (d < best) best = d;
    });
    return best === Infinity ? 99 : best;
  }

  function scoreAction(state, action, playerIndex) {
    if (action.type === 'attack') {
      var target = findUnit(state, action.targetUnitId);
      if (!target) return 0;
      var score = 10 + (UNITS[target.type].value || 10);
      var myBase = homeAnchor(state, playerIndex);
      if (myBase && manhattan(target, myBase) <= 2) score += 45;
      if (action.approach) {
        var apSh = strongholdAt(state, action.approach.r, action.approach.c);
        if (apSh && apSh.owner !== playerIndex) {
          score += 120;
          if (controlCount(state, playerIndex) + 1 >= WIN) score += 1e9;
        }
      }
      return score;
    }
    if (action.type === 'move') {
      var unit = findUnit(state, action.unitId);
      if (!unit) return 0;
      var to = action.to;
      var base = baseAt(state, to.r, to.c);
      if (base && base.owner !== playerIndex) return 1e9;
      var score2 = 0;
      var sh = strongholdAt(state, to.r, to.c);
      if (sh && sh.owner !== playerIndex) {
        score2 += 140;
        if (controlCount(state, playerIndex) + 1 >= WIN) score2 += 1e9;
      }
      var oldD = nearestTargetStrongholdDist(state, playerIndex, unit.r, unit.c);
      var newD = nearestTargetStrongholdDist(state, playerIndex, to.r, to.c);
      score2 += (oldD - newD) * 12;
      var myBase = homeAnchor(state, playerIndex);
      if (myBase && nearestEnemyDist(state, playerIndex, myBase) <= 2) {
        if (manhattan(to, myBase) <= 1) score2 += 55;
        if (manhattan(to, myBase) < manhattan(unit, myBase)) score2 += 20;
      }
      return score2 + 1;
    }
    if (action.type === 'deploy') {
      var cell = { r: action.r, c: action.c };
      var myBase2 = homeAnchor(state, playerIndex);
      var score3 = 5;
      var oldD2 = nearestTargetStrongholdDist(state, playerIndex, myBase2.r, myBase2.c);
      var newD2 = nearestTargetStrongholdDist(state, playerIndex, cell.r, cell.c);
      score3 += (oldD2 - newD2) * 8;
      var threat = nearestEnemyDist(state, playerIndex, myBase2);
      if (threat <= 2) {
        if (manhattan(cell, myBase2) <= 1) score3 += 45;
        if (baseAt(state, cell.r, cell.c)) score3 += 25;
      }
      return score3;
    }
    return 0;
  }

  function chooseAIAction(state, playerIndex) {
    if (playerIndex == null) playerIndex = state.current;
    if (state.over) return { type: 'end', player: playerIndex };
    var actions = legalActions(state, playerIndex);
    if (!actions.length) return { type: 'end', player: playerIndex };
    var best = null;
    var bestScore = -Infinity;
    actions.forEach(function (action) {
      var score = scoreAction(state, action, playerIndex);
      if (score > bestScore ||
        (score === bestScore && best && actionKey(action) < actionKey(best))) {
        best = action;
        bestScore = score;
      }
    });
    if (!best || bestScore <= 0) return { type: 'end', player: playerIndex };
    return best;
  }

  /* ------------------------------------------------------------------ */
  /* 摘要                                                                */
  /* ------------------------------------------------------------------ */

  function summary(state) {
    return {
      turn: state.turn,
      current: state.current,
      over: state.over,
      result: state.result,
      control: [controlCount(state, 0), controlCount(state, 1)],
      players: state.players.map(function (player) {
        return {
          name: player.name,
          isAI: player.isAI,
          hand: player.hand.slice(),
          handCounts: handCounts(player),
          bag: player.bag.length,
          discard: player.discard.length,
          coins: coinTotal(player),
          reserves: Object.assign({}, player.reserves),
          units: unitsOf(state, player.index).length,
          control: controlCount(state, player.index)
        };
      }),
      strongholds: state.strongholds.map(function (sh) {
        return { id: sh.id, r: sh.r, c: sh.c, owner: sh.owner };
      }),
      units: state.units.map(function (unit) {
        return { id: unit.id, owner: unit.owner, type: unit.type, r: unit.r, c: unit.c };
      })
    };
  }

  return Object.freeze({
    BOARD_SIZE: SIZE,
    WIN_STRONGHOLDS: WIN,
    HAND_DRAW: DRAW,
    MAX_TURNS: MAX_TURNS,
    UNITS: UNITS,
    UNIT_ORDER: ORDER,
    createGame: createGame,
    drawHand: drawHand,
    canDeploy: canDeploy,
    legalDeployCells: legalDeployCells,
    deploy: deploy,
    bfsReach: bfsReach,
    canMove: canMove,
    moveUnit: moveUnit,
    findApproach: findApproach,
    canAttack: canAttack,
    attackUnit: attackUnit,
    endTurn: endTurn,
    legalActions: legalActions,
    applyAction: applyAction,
    chooseAIAction: chooseAIAction,
    controlCount: controlCount,
    unitAt: unitAt,
    findUnit: findUnit,
    strongholdAt: strongholdAt,
    baseAt: baseAt,
    baseOf: baseOf,
    homeAnchor: homeAnchor,
    unitsOf: unitsOf,
    coinTotal: coinTotal,
    handCounts: handCounts,
    nearestTargetStrongholdDist: nearestTargetStrongholdDist,
    coordText: coordText,
    summary: summary
  });
});
