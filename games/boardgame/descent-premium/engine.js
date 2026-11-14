/*
 * 《深入绝境：黑暗之旅》第二版 — 精品版纯规则引擎（一期）
 *
 * 纯逻辑、零 DOM、零外部依赖。ES module；Node 侧通过
 *   import * as Descent from './engine.js'
 * 使用，浏览器二期可用 <script type="module"> 加载。
 *
 * 设计约束：
 *   - createGame / legalActions / applyAction 全部是纯函数式状态推进：
 *     applyAction 不修改入参，始终返回一份 JSON 可序列化的新 state。
 *   - 所有随机数都经过 seed：state.seed + state.rngCount -> 共享 shuffle.js
 *     的 seeded sfc32。相同 seed + 相同动作序列 = 完全相同的结果（含骰面）。
 *   - 非法动作一律抛 Error；AI 只从 legalActions 中选择。
 *   - 地图、骰面表、怪物/英雄面板均为显式数据，rules.md 逐条对应。
 *
 * 规则口径以同目录 rules.md 为准；本文件不引入任何占位分支。
 */
import Shuffle from './shuffle-adapter.js';

if (!Shuffle || typeof Shuffle.createRng !== 'function') {
  throw new Error('Descent 引擎需要 games/shared/shuffle.js');
}

export const VERSION = '1.0.0';
export const ACTIONS_PER_TURN = 2;
export const MAX_ROUNDS = 15;
export const MAX_MONSTERS = 6;
export const SUMMON_COST = 3;
export const MAX_FURY_STACKS = 2;
export const DEFAULT_SEED = 'descent-relic-vault';
export const DEFAULT_HERO_COUNT = 2;

/* ------------------------------------------------------------------ *
 * 骰面表（rules.md「骰子」一节逐面列出）                              *
 * ------------------------------------------------------------------ */

function atkFace(dmg, surge) {
  return Object.freeze({ dmg: dmg, surge: surge });
}

function defFace(shield) {
  return Object.freeze({ shield: shield });
}

export const DICE = Object.freeze({
  attack: Object.freeze({
    blue: Object.freeze([
      atkFace(1, 0), atkFace(1, 0), atkFace(2, 0),
      atkFace(2, 0), atkFace(0, 1), atkFace(1, 1)
    ]),
    yellow: Object.freeze([
      atkFace(1, 0), atkFace(1, 1), atkFace(2, 0),
      atkFace(2, 0), atkFace(0, 1), atkFace(1, 2)
    ]),
    red: Object.freeze([
      atkFace(2, 0), atkFace(2, 0), atkFace(3, 0),
      atkFace(3, 0), atkFace(2, 1), atkFace(1, 2)
    ]),
    green: Object.freeze([
      atkFace(1, 0), atkFace(1, 1), atkFace(2, 0),
      atkFace(2, 1), atkFace(0, 2), atkFace(1, 2)
    ])
  }),
  defense: Object.freeze({
    brown: Object.freeze([defFace(0), defFace(0), defFace(0), defFace(1), defFace(1), defFace(1)]),
    gray: Object.freeze([defFace(1), defFace(1), defFace(1), defFace(1), defFace(2), defFace(2)]),
    black: Object.freeze([defFace(0), defFace(1), defFace(1), defFace(2), defFace(2), defFace(3)])
  })
});

export const CONDITION_NAMES = Object.freeze({
  poison: '中毒',
  bleed: '流血',
  stun: '眩晕'
});

const CONDITION_TURNS = Object.freeze({ poison: 3, bleed: 2, stun: 1 });

/* ------------------------------------------------------------------ *
 * 英雄 / 怪物 / 城主卡面板                                            *
 * ------------------------------------------------------------------ */

export const HERO_ARCHETYPES = Object.freeze({
  warrior: Object.freeze({
    key: 'warrior',
    title: '战士',
    name: '凯尔',
    speed: 4,
    stamina: 5,
    health: 14,
    defense: 'gray',
    weapon: Object.freeze({
      name: '阔剑', kind: 'melee', range: 1, dice: Object.freeze(['red', 'blue']), onHit: null
    })
  }),
  scout: Object.freeze({
    key: 'scout',
    title: '游侠',
    name: '莉安',
    speed: 5,
    stamina: 4,
    health: 11,
    defense: 'brown',
    weapon: Object.freeze({
      name: '长弓', kind: 'ranged', range: 4, dice: Object.freeze(['yellow', 'blue']), onHit: null
    })
  }),
  mage: Object.freeze({
    key: 'mage',
    title: '法师',
    name: '塞拉',
    speed: 4,
    stamina: 5,
    health: 9,
    defense: 'brown',
    weapon: Object.freeze({
      name: '腐蚀法杖', kind: 'magic', range: 3, dice: Object.freeze(['blue', 'green']),
      onHit: Object.freeze({ status: 'poison' })
    })
  }),
  healer: Object.freeze({
    key: 'healer',
    title: '牧师',
    name: '奥文',
    speed: 4,
    stamina: 6,
    health: 12,
    defense: 'gray',
    weapon: Object.freeze({
      name: '钉头锤', kind: 'melee', range: 1, dice: Object.freeze(['red', 'green']), onHit: null
    })
  })
});

export const MONSTER_TYPES = Object.freeze({
  goblin: Object.freeze({
    key: 'goblin',
    name: '哥布林',
    health: 4,
    speed: 4,
    defense: 'brown',
    attack: Object.freeze({
      name: '毒刃', range: 1, dice: Object.freeze(['blue']),
      onHit: Object.freeze({ status: 'poison' })
    })
  }),
  skeleton: Object.freeze({
    key: 'skeleton',
    name: '骷髅弓手',
    health: 5,
    speed: 3,
    defense: 'brown',
    attack: Object.freeze({
      name: '腐骨箭', range: 4, dice: Object.freeze(['yellow']),
      onHit: Object.freeze({ status: 'bleed' })
    })
  }),
  ogre: Object.freeze({
    key: 'ogre',
    name: '食人魔',
    health: 8,
    speed: 3,
    defense: 'gray',
    elite: true,
    attack: Object.freeze({
      name: '巨棒', range: 1, dice: Object.freeze(['red']),
      onHit: Object.freeze({ status: 'stun', minDamage: 2 })
    })
  })
});

export const OVERLORD_CARDS = Object.freeze({
  fury: Object.freeze({
    key: 'fury', name: '狂暴', cost: 2,
    text: '选择一只存活怪物，其下一次攻击 +1 伤害；最多叠加 2 层。'
  }),
  shadow_bolt: Object.freeze({
    key: 'shadow_bolt', name: '暗影箭', cost: 2,
    text: '选择一名处于任一存活怪物 4 格内且有视线的英雄，造成 1 点直接伤害并使其中毒。'
  })
});

/* ------------------------------------------------------------------ *
 * 地图「遗物地窖」                                                   *
 * ------------------------------------------------------------------ */

const MAP_LAYOUT = Object.freeze([
  '#############',
  '#....#......#',
  '#....#......#',
  '#....#...X..#',
  '#.......###.#',
  '#....#..###O#',
  '#....#......#',
  '#..X.#......#',
  '#############'
]);

export const MAP = Object.freeze({
  id: 'relic-vault',
  name: '遗物地窖',
  width: 13,
  height: 9,
  layout: MAP_LAYOUT,
  exitCells: Object.freeze([[1, 1], [2, 1], [1, 2], [2, 2]]),
  spawnCells: Object.freeze([[6, 1], [6, 7]]),
  heroStarts: Object.freeze([[3, 2], [4, 2], [3, 4], [4, 4]])
});

const INITIAL_MONSTERS = Object.freeze([
  Object.freeze({ kind: 'goblin', x: 8, y: 2 }),
  Object.freeze({ kind: 'goblin', x: 7, y: 7 }),
  Object.freeze({ kind: 'skeleton', x: 10, y: 2 }),
  Object.freeze({ kind: 'ogre', x: 10, y: 6 })
]);

const DIRECTIONS = Object.freeze([[0, -1], [1, 0], [0, 1], [-1, 0]]);
const HERO_ORDER = Object.freeze(['warrior', 'scout', 'mage', 'healer']);

/* ------------------------------------------------------------------ *
 * 基础工具                                                           *
 * ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function samePos(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

export function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function findHero(state, id) {
  return (state.heroes || []).find(function (hero) { return hero.id === id; }) || null;
}

function findMonster(state, id) {
  return (state.monsters || []).find(function (monster) { return monster.id === id; }) || null;
}

export function getFigure(state, id) {
  return findHero(state, id) || findMonster(state, id);
}

export function aliveHeroes(state) {
  return (state.heroes || []).filter(function (hero) { return hero.alive; });
}

export function aliveMonsters(state) {
  return (state.monsters || []).filter(function (monster) { return monster.alive; });
}

function figureAt(state, x, y, ignoreId) {
  var heroes = state.heroes || [];
  for (var i = 0; i < heroes.length; i++) {
    var hero = heroes[i];
    if (hero.alive && hero.id !== ignoreId && hero.x === x && hero.y === y) return hero;
  }
  var monsters = state.monsters || [];
  for (var j = 0; j < monsters.length; j++) {
    var monster = monsters[j];
    if (monster.alive && monster.id !== ignoreId && monster.x === x && monster.y === y) return monster;
  }
  return null;
}

function inBounds(state, x, y) {
  return x >= 0 && y >= 0 && x < state.board.width && y < state.board.height;
}

function isBlockedCell(state, x, y) {
  if (!inBounds(state, x, y)) return true;
  var cell = state.board.layout[y].charAt(x);
  return cell === '#' || cell === 'X';
}

export function isExitCell(state, x, y) {
  return state.board.exitCells.some(function (cell) { return cell[0] === x && cell[1] === y; });
}

function logEvent(state, type, data) {
  var entry = { round: state.round, phase: state.phase, type: type };
  if (data) {
    Object.keys(data).forEach(function (key) { entry[key] = data[key]; });
  }
  state.log.push(entry);
}

/* ------------------------------------------------------------------ *
 * Seeded 随机                                                        *
 * ------------------------------------------------------------------ */

// 每颗骰子用 seed#rngCount 派生一个独立 seeded 流，rngCount 前进一位。
// 这样 state 只需保存 seed 与计数，JSON 克隆/回放完全可复现。
function drawInt(state, n) {
  var rng = Shuffle.createRng(String(state.seed) + '#' + state.rngCount);
  var value = rng();
  state.rngCount += 1;
  var result = Math.floor(value * n);
  if (result < 0) result = 0;
  if (result >= n) result = n - 1;
  return result;
}

function rollAttackFace(state, color) {
  var faces = DICE.attack[color];
  if (!faces) throw new Error('未知攻击骰色：' + color);
  return faces[drawInt(state, faces.length)];
}

function rollDefenseFace(state, color) {
  if (!color) return defFace(0);
  var faces = DICE.defense[color];
  if (!faces) throw new Error('未知防御骰色：' + color);
  return faces[drawInt(state, faces.length)];
}

function rollAttackPool(state, colors) {
  return colors.map(function (color) { return rollAttackFace(state, color); });
}

/* ------------------------------------------------------------------ *
 * 视线（对角线规则：穿角时两侧格都计入）                             *
 * ------------------------------------------------------------------ */

// Supercover 网格遍历。返回射线接触到的全部格子（含起点/终点）。
// 当射线正好穿过格角时，把两侧正交格也压入结果；调用方任一侧为墙即遮挡。
function supercoverLine(x0, y0, x1, y1) {
  var cells = [[x0, y0]];
  if (x0 === x1 && y0 === y1) return cells;

  var dx = x1 - x0;
  var dy = y1 - y0;
  var stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
  var stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
  var adx = Math.abs(dx);
  var ady = Math.abs(dy);
  var tDeltaX = adx === 0 ? Infinity : 1 / adx;
  var tDeltaY = ady === 0 ? Infinity : 1 / ady;
  var tMaxX = adx === 0 ? Infinity : 0.5 / adx;
  var tMaxY = ady === 0 ? Infinity : 0.5 / ady;
  var x = x0;
  var y = y0;
  var guard = 0;

  while ((x !== x1 || y !== y1) && guard++ < 1000) {
    if (Math.abs(tMaxX - tMaxY) < 1e-9 && stepX !== 0 && stepY !== 0) {
      var sideX = x + stepX;
      var sideY = y + stepY;
      cells.push([sideX, y]);
      cells.push([x, sideY]);
      x = sideX;
      y = sideY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
      cells.push([x, y]);
    } else if (tMaxX < tMaxY) {
      x += stepX;
      tMaxX += tDeltaX;
      cells.push([x, y]);
    } else {
      y += stepY;
      tMaxY += tDeltaY;
      cells.push([x, y]);
    }
  }
  return cells;
}

export function hasLineOfSight(state, from, to) {
  if (!from || !to) return false;
  if (!inBounds(state, from.x, from.y) || !inBounds(state, to.x, to.y)) return false;
  var cells = supercoverLine(from.x, from.y, to.x, to.y);
  for (var i = 0; i < cells.length; i++) {
    var x = cells[i][0];
    var y = cells[i][1];
    if (samePos(cells[i], [from.x, from.y]) || samePos(cells[i], [to.x, to.y])) continue;
    if (isBlockedCell(state, x, y)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * 移动可达性（BFS，四向逐格）                                        *
 * ------------------------------------------------------------------ */

function reachableMoves(state, figure, maxSteps) {
  var width = state.board.width;
  var height = state.board.height;
  var dist = [];
  var prev = [];
  for (var y = 0; y < height; y++) {
    dist.push(new Array(width).fill(Infinity));
    prev.push(new Array(width).fill(null));
  }

  dist[figure.y][figure.x] = 0;
  var queue = [[figure.x, figure.y]];
  var head = 0;
  var results = [];

  while (head < queue.length) {
    var current = queue[head++];
    var cx = current[0];
    var cy = current[1];
    var cd = dist[cy][cx];

    if (cd > 0) {
      // 目的地不能被任何存活角色占据。英雄可以“穿过”友方英雄，
      // 但不能停在其格；怪物则连穿过都不行（见下方邻居判断）。
      if (!figureAt(state, cx, cy, figure.id)) {
        results.push({ x: cx, y: cy, steps: cd, path: buildPath(prev, figure, cx, cy) });
      }
    }

    if (cd >= maxSteps) continue;

    for (var d = 0; d < DIRECTIONS.length; d++) {
      var nx = cx + DIRECTIONS[d][0];
      var ny = cy + DIRECTIONS[d][1];
      if (!inBounds(state, nx, ny) || isBlockedCell(state, nx, ny)) continue;

      var occupant = figureAt(state, nx, ny, figure.id);
      if (occupant) {
        if (figure.side === 'monster') continue; // 怪物不能穿过任何角色
        if (occupant.side === 'monster') continue; // 英雄不能穿过怪物
        // 英雄可以穿过友方英雄；终点会在结果阶段过滤
      }

      var nd = cd + 1;
      if (nd < dist[ny][nx]) {
        dist[ny][nx] = nd;
        prev[ny][nx] = [cx, cy];
        queue.push([nx, ny]);
      }
    }
  }

  results.sort(function (a, b) {
    if (a.steps !== b.steps) return a.steps - b.steps;
    if (a.x !== b.x) return a.x - b.x;
    return a.y - b.y;
  });
  return results;
}

function buildPath(prev, figure, x, y) {
  var path = [[x, y]];
  var cx = x;
  var cy = y;
  while (cx !== figure.x || cy !== figure.y) {
    var p = prev[cy][cx];
    if (!p) break;
    path.push([p[0], p[1]]);
    cx = p[0];
    cy = p[1];
  }
  path.reverse();
  return path;
}

// 忽略角色占位、只考虑墙的 BFS 距离场，供 AI 评估“朝目标前进”用。
function distanceField(state, targets) {
  var width = state.board.width;
  var height = state.board.height;
  var dist = [];
  for (var y = 0; y < height; y++) dist.push(new Array(width).fill(Infinity));
  var queue = [];
  targets.forEach(function (cell) {
    if (!isBlockedCell(state, cell[0], cell[1])) {
      dist[cell[1]][cell[0]] = 0;
      queue.push([cell[0], cell[1]]);
    }
  });
  var head = 0;
  while (head < queue.length) {
    var cur = queue[head++];
    var cd = dist[cur[1]][cur[0]];
    for (var d = 0; d < DIRECTIONS.length; d++) {
      var nx = cur[0] + DIRECTIONS[d][0];
      var ny = cur[1] + DIRECTIONS[d][1];
      if (!inBounds(state, nx, ny) || isBlockedCell(state, nx, ny)) continue;
      if (dist[ny][nx] !== Infinity) continue;
      dist[ny][nx] = cd + 1;
      queue.push([nx, ny]);
    }
  }
  return dist;
}

function fieldAt(field, pos) {
  var row = field[pos.y];
  if (!row) return 99;
  var value = row[pos.x];
  return Number.isFinite(value) ? value : 99;
}

/* ------------------------------------------------------------------ *
 * 状态 / 条件 / 伤害                                                 *
 * ------------------------------------------------------------------ */

function hasCondition(figure, type) {
  return !!figure && figure.conditions.some(function (c) { return c.type === type; });
}

function addCondition(state, figure, type, turns) {
  if (!figure || !figure.alive) return false;
  var duration = turns || CONDITION_TURNS[type];
  if (!duration) throw new Error('未知状态：' + type);
  var existing = figure.conditions.find(function (c) { return c.type === type; });
  if (existing) {
    existing.turns = Math.max(existing.turns, duration);
    return false;
  }
  figure.conditions.push({ type: type, turns: duration });
  return true;
}

function dealDamage(state, figure, amount, source) {
  if (!figure || !figure.alive || amount <= 0) return 0;
  var before = figure.health;
  figure.health -= amount;
  if (figure.health <= 0) {
    figure.health = 0;
    figure.alive = false;
    figure.conditions = [];
    figure.buff = { damage: 0 };
    logEvent(state, 'defeat', { figure: figure.id, side: figure.side, source: source, overkill: amount - before });
    if (figure.side === 'hero') {
      state.overlord.threat += 2;
      logEvent(state, 'threat-gain', { amount: 2, reason: 'hero-defeated', total: state.overlord.threat });
    }
  }
  return before - figure.health;
}

function startActivation(state, figure, baseActions) {
  var damage = 0;
  if (hasCondition(figure, 'poison')) damage += 1;
  if (hasCondition(figure, 'bleed')) damage += 1;
  if (damage > 0) {
    dealDamage(state, figure, damage, 'condition');
    logEvent(state, 'condition-tick', {
      figure: figure.id,
      damage: damage,
      conditions: figure.conditions.map(function (c) { return c.type; })
    });
  }
  if (!figure.alive) return 0;
  var actions = baseActions;
  if (hasCondition(figure, 'stun')) actions = Math.max(0, actions - 1);
  return actions;
}

function endActivationConditions(figure) {
  if (!figure || !figure.alive) return;
  figure.conditions = figure.conditions
    .map(function (c) { return { type: c.type, turns: c.turns - 1 }; })
    .filter(function (c) { return c.turns > 0; });
}

/* ------------------------------------------------------------------ *
 * 战斗                                                               *
 * ------------------------------------------------------------------ */

function attackProfile(figure) {
  return figure.side === 'hero' ? figure.weapon : figure.attack;
}

function sumFaces(faces, key) {
  return faces.reduce(function (sum, face) { return sum + face[key]; }, 0);
}

/**
 * 纯函数：把已经掷出的攻击/防御骰面解析成伤害。
 * options.surgePlan = { damage, pierce }；不传则自动分配：
 * 先用 surge 抵消护盾（1 surge = 1 pierce），剩余全部 +1 伤害。
 * options.bonusDamage 来自「狂暴」等固定加伤。
 */
export function resolveAttackFaces(attackFaces, defenseFaces, options) {
  var opts = options || {};
  var baseDamage = sumFaces(attackFaces, 'dmg');
  var surges = sumFaces(attackFaces, 'surge');
  var shields = sumFaces(defenseFaces || [], 'shield');
  var bonusDamage = opts.bonusDamage || 0;
  var plan;
  if (opts.surgePlan) {
    var damage = opts.surgePlan.damage || 0;
    var pierce = opts.surgePlan.pierce || 0;
    if (!Number.isInteger(damage) || damage < 0 ||
        !Number.isInteger(pierce) || pierce < 0) {
      throw new Error('surgePlan 的 damage/pierce 必须是非负整数');
    }
    if (damage + pierce > surges) {
      throw new Error('surgePlan 花费 ' + (damage + pierce) + ' 超过可用 surge ' + surges);
    }
    plan = { damage: damage, pierce: pierce };
  } else {
    var autoPierce = Math.min(surges, shields);
    plan = { damage: surges - autoPierce, pierce: autoPierce };
  }
  var effectiveShields = Math.max(0, shields - plan.pierce);
  var damage = Math.max(0, baseDamage + bonusDamage + plan.damage - effectiveShields);
  return {
    baseDamage: baseDamage,
    bonusDamage: bonusDamage,
    surges: surges,
    shields: shields,
    plan: plan,
    effectiveShields: effectiveShields,
    damage: damage
  };
}

function performAttack(state, attacker, target, action) {
  var profile = attackProfile(attacker);
  var attackFaces = rollAttackPool(state, profile.dice);
  var defenseFaces = [rollDefenseFace(state, target.defense)];
  var buff = attacker.buff && attacker.buff.damage ? attacker.buff.damage : 0;
  var resolved = resolveAttackFaces(attackFaces, defenseFaces, {
    surgePlan: action && action.surgePlan,
    bonusDamage: buff
  });
  if (buff) attacker.buff.damage = 0;

  var before = target.health;
  dealDamage(state, target, resolved.damage, 'attack');

  var applied = [];
  var onHit = profile.onHit;
  if (onHit && target.alive && resolved.damage > 0 &&
      (!onHit.minDamage || resolved.damage >= onHit.minDamage)) {
    if (addCondition(state, target, onHit.status)) applied.push(onHit.status);
  }

  logEvent(state, 'attack', {
    attacker: attacker.id,
    attackerSide: attacker.side,
    target: target.id,
    targetSide: target.side,
    dice: profile.dice.slice(),
    attackFaces: attackFaces.map(function (f) { return { dmg: f.dmg, surge: f.surge }; }),
    defenseFaces: defenseFaces.map(function (f) { return { shield: f.shield }; }),
    surges: resolved.surges,
    shields: resolved.shields,
    surgePlan: resolved.plan,
    bonusDamage: resolved.bonusDamage,
    damage: resolved.damage,
    healthBefore: before,
    healthAfter: target.health,
    targetDefeated: !target.alive,
    conditionsApplied: applied
  });
  return resolved;
}

function validateAttack(state, attacker, target) {
  var profile = attackProfile(attacker);
  var distance = manhattan(attacker, target);
  if (distance < 1) throw new Error('不能攻击自己所在格');
  if (distance > profile.range) {
    throw new Error('目标超出射程：' + distance + ' > ' + profile.range);
  }
  if (!hasLineOfSight(state, attacker, target)) throw new Error('目标不在视线内');
}

/* ------------------------------------------------------------------ *
 * 移动落地                                                           *
 * ------------------------------------------------------------------ */

function applyMove(state, figure, path, isMonster) {
  if (!Array.isArray(path) || path.length < 2) throw new Error('移动路径至少包含起点与终点');
  if (!Array.isArray(path[0]) || path[0][0] !== figure.x || path[0][1] !== figure.y) {
    throw new Error('移动路径必须从角色当前格开始');
  }

  var steps = path.length - 1;
  var maxSteps = isMonster
    ? figure.speed
    : figure.speed + Math.max(0, figure.stamina - figure.fatigue);
  if (steps > maxSteps) throw new Error('移动点数不足：' + steps + ' > ' + maxSteps);

  for (var i = 1; i < path.length; i++) {
    var prev = path[i - 1];
    var cur = path[i];
    if (!Array.isArray(cur) || !Number.isInteger(cur[0]) || !Number.isInteger(cur[1])) {
      throw new Error('路径格必须是整数坐标');
    }
    if (Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]) !== 1) {
      throw new Error('移动必须四向逐格');
    }
    if (!inBounds(state, cur[0], cur[1]) || isBlockedCell(state, cur[0], cur[1])) {
      throw new Error('移动路径穿过墙/障碍');
    }
    var occupant = figureAt(state, cur[0], cur[1], figure.id);
    if (isMonster) {
      if (occupant) throw new Error('怪物不能穿过或停在角色所在格');
    } else if (occupant && occupant.side === 'monster') {
      throw new Error('英雄不能穿过怪物');
    }
  }

  var destination = path[path.length - 1];
  if (figureAt(state, destination[0], destination[1], figure.id)) {
    throw new Error('目的地已被其他角色占据');
  }

  figure.x = destination[0];
  figure.y = destination[1];

  var fatigue = 0;
  var forcedMarchDamage = 0;
  if (!isMonster) {
    fatigue = Math.max(0, steps - figure.speed);
    if (fatigue > 0) {
      figure.fatigue += fatigue;
      // 规则：单次移动支付的疲劳“超过速度”的部分，每点造成 1 伤害。
      forcedMarchDamage = Math.max(0, fatigue - figure.speed);
      if (forcedMarchDamage > 0) {
        dealDamage(state, figure, forcedMarchDamage, 'forced-march');
      }
    }
  }

  logEvent(state, 'move', {
    actor: figure.id,
    side: figure.side,
    path: path.map(function (p) { return [p[0], p[1]]; }),
    steps: steps,
    fatigueSpent: fatigue,
    forcedMarchDamage: forcedMarchDamage
  });
}

/* ------------------------------------------------------------------ *
 * 回合/阶段推进                                                      *
 * ------------------------------------------------------------------ */

function finishGame(state, winner, reason) {
  if (state.over) return;
  state.over = true;
  state.phase = 'ended';
  state.winner = winner;
  state.endReason = reason;
  state.activeHeroId = null;
  state.activeMonsterId = null;
  logEvent(state, 'game-over', { winner: winner, reason: reason });
}

function checkGameEnd(state) {
  if (!state || state.over) return true;
  var heroes = aliveHeroes(state);
  if (heroes.length === 0) {
    finishGame(state, 'overlord', 'all-heroes-defeated');
    return true;
  }
  if (state.objective.destroyed && heroes.every(function (hero) {
    return isExitCell(state, hero.x, hero.y);
  })) {
    finishGame(state, 'heroes', 'objective-destroyed-and-extracted');
    return true;
  }
  if (state.round > state.maxRounds) {
    finishGame(state, 'overlord', 'round-limit');
    return true;
  }
  return false;
}

function beginHeroActivation(state, index) {
  if (state.over) return;
  state.phase = 'heroes';
  state.activeMonsterId = null;

  for (var i = index; i < state.heroes.length; i++) {
    var hero = state.heroes[i];
    if (!hero.alive) continue;
    state.activeHeroIndex = i;
    state.activeHeroId = hero.id;
    hero.actionsLeft = ACTIONS_PER_TURN;
    hero.actionsLeft = startActivation(state, hero, ACTIONS_PER_TURN);
    if (checkGameEnd(state)) return;
    if (!hero.alive) continue;
    logEvent(state, 'activation-start', {
      actor: hero.id,
      side: 'hero',
      actionsLeft: hero.actionsLeft,
      conditions: hero.conditions.map(function (c) { return c.type; })
    });
    return;
  }

  state.activeHeroIndex = -1;
  state.activeHeroId = null;
  beginOverlordPhase(state);
}

function finishHeroActivation(state) {
  if (state.over) return;
  var hero = findHero(state, state.activeHeroId);
  if (hero && hero.alive) {
    endActivationConditions(hero);
    logEvent(state, 'activation-end', { actor: hero.id, side: 'hero' });
  }
  var next = state.activeHeroIndex + 1;
  state.activeHeroId = null;
  if (next >= state.heroes.length) beginOverlordPhase(state);
  else beginHeroActivation(state, next);
}

function beginOverlordPhase(state) {
  if (state.over) return;
  state.phase = 'overlord';
  state.activeHeroId = null;
  state.activeHeroIndex = -1;
  state.activeMonsterId = null;

  var gain = 1 + aliveHeroes(state).length;
  state.overlord.threat += gain;
  state.overlordQueue = aliveMonsters(state).map(function (monster) { return monster.id; });
  state.overlordQueueIndex = -1;
  logEvent(state, 'overlord-phase', {
    threatGain: gain,
    threat: state.overlord.threat,
    queue: state.overlordQueue.slice()
  });
  advanceMonsterActivation(state);
  checkGameEnd(state);
}

function advanceMonsterActivation(state) {
  if (state.over) return;
  state.activeMonsterId = null;
  while (state.overlordQueueIndex + 1 < state.overlordQueue.length) {
    state.overlordQueueIndex += 1;
    var monster = findMonster(state, state.overlordQueue[state.overlordQueueIndex]);
    if (!monster || !monster.alive) continue;
    state.activeMonsterId = monster.id;
    monster.actionsLeft = ACTIONS_PER_TURN;
    monster.actionsLeft = startActivation(state, monster, ACTIONS_PER_TURN);
    if (checkGameEnd(state)) return;
    if (!monster.alive) continue;
    logEvent(state, 'activation-start', {
      actor: monster.id,
      side: 'monster',
      actionsLeft: monster.actionsLeft,
      conditions: monster.conditions.map(function (c) { return c.type; })
    });
    return;
  }
  state.activeMonsterId = null;
  logEvent(state, 'monster-phase-done', {});
}

function finishMonsterActivation(state) {
  if (state.over) return;
  var monster = findMonster(state, state.activeMonsterId);
  if (monster && monster.alive) {
    endActivationConditions(monster);
    logEvent(state, 'activation-end', { actor: monster.id, side: 'monster' });
  }
  state.activeMonsterId = null;
  advanceMonsterActivation(state);
}

function endOverlordPhase(state) {
  if (state.over) return;
  state.activeMonsterId = null;
  state.round += 1;
  if (state.round > state.maxRounds) {
    finishGame(state, 'overlord', 'round-limit');
    return;
  }
  logEvent(state, 'round-start', { round: state.round });
  beginHeroActivation(state, 0);
}

/* ------------------------------------------------------------------ *
 * 动作生成                                                           *
 * ------------------------------------------------------------------ */

function heroMoveActions(state, hero) {
  var maxSteps = hero.speed + Math.max(0, hero.stamina - hero.fatigue);
  var moves = reachableMoves(state, hero, maxSteps);
  return moves.map(function (move) {
    var fatigue = Math.max(0, move.steps - hero.speed);
    return {
      type: 'move',
      path: move.path,
      steps: move.steps,
      fatigue: fatigue,
      forcedMarchDamage: Math.max(0, fatigue - hero.speed)
    };
  });
}

function monsterMoveActions(state, monster) {
  return reachableMoves(state, monster, monster.speed).map(function (move) {
    return { type: 'move', monsterId: monster.id, path: move.path, steps: move.steps };
  });
}

function heroLegalActions(state, hero) {
  var actions = [];
  actions = actions.concat(heroMoveActions(state, hero));

  aliveMonsters(state).forEach(function (monster) {
    try {
      validateAttack(state, hero, monster);
      actions.push({ type: 'attack', target: monster.id });
    } catch (err) {
      // 不在射程/视线内，不是合法攻击。
    }
  });

  if (!state.objective.destroyed &&
      hero.x === state.objective.x && hero.y === state.objective.y) {
    actions.push({ type: 'interact', target: state.objective.id });
  }

  var statuses = [];
  hero.conditions.forEach(function (condition) {
    if (statuses.indexOf(condition.type) === -1) statuses.push(condition.type);
  });
  actions.push({ type: 'rest' });
  statuses.forEach(function (status) {
    actions.push({ type: 'rest', clearCondition: status });
  });

  actions.push({ type: 'endActivation' });
  return actions;
}

function findShadowBoltSource(state, hero) {
  return aliveMonsters(state).find(function (monster) {
    return manhattan(monster, hero) <= 4 && hasLineOfSight(state, monster, hero);
  }) || null;
}

function overlordLegalActions(state) {
  var actions = [];
  var active = findMonster(state, state.activeMonsterId);
  if (active && !active.alive) active = null;

  if (active && active.alive) {
    if (active.actionsLeft > 0) {
      actions = actions.concat(monsterMoveActions(state, active));
      aliveHeroes(state).forEach(function (hero) {
        try {
          validateAttack(state, active, hero);
          actions.push({ type: 'attack', monsterId: active.id, target: hero.id });
        } catch (err) {
          // 不在射程/视线内。
        }
      });
    }
    actions.push({ type: 'endMonsterActivation', monsterId: active.id });
  }

  if (state.overlord.threat >= SUMMON_COST &&
      aliveMonsters(state).length < MAX_MONSTERS) {
    state.board.spawnCells.forEach(function (cell) {
      if (!isBlockedCell(state, cell[0], cell[1]) &&
          !figureAt(state, cell[0], cell[1])) {
        actions.push({ type: 'summon', cell: [cell[0], cell[1]] });
      }
    });
  }

  if (state.overlord.threat >= 2) {
    aliveMonsters(state).forEach(function (monster) {
      if (monster.buff.damage < MAX_FURY_STACKS) {
        actions.push({ type: 'card', card: 'fury', target: monster.id });
      }
    });
    aliveHeroes(state).forEach(function (hero) {
      if (findShadowBoltSource(state, hero)) {
        actions.push({ type: 'card', card: 'shadow_bolt', target: hero.id });
      }
    });
  }

  if (!active) actions.push({ type: 'endOverlord' });
  return actions;
}

/**
 * 生成 actor 的合法动作。
 * actor：英雄阶段传英雄 id（如 'h1'），城主阶段传 'overlord'。
 * 不传 actor 时默认当前行动者。
 */
export function legalActions(state, actor) {
  if (!state || state.over) return [];
  var current = currentActor(state);
  if (!actor) actor = current;

  if (state.phase === 'heroes') {
    if (actor !== state.activeHeroId) return [];
    var hero = findHero(state, state.activeHeroId);
    if (!hero || !hero.alive || hero.actionsLeft <= 0) return [];
    return heroLegalActions(state, hero);
  }

  if (state.phase === 'overlord') {
    if (actor !== 'overlord') return [];
    return overlordLegalActions(state);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * 动作执行                                                           *
 * ------------------------------------------------------------------ */

function applyInteract(state, hero, action) {
  var objective = state.objective;
  if (action.target && action.target !== objective.id) throw new Error('未知任务目标');
  if (objective.destroyed) throw new Error('任务目标已被摧毁');
  if (hero.x !== objective.x || hero.y !== objective.y) {
    throw new Error('必须站在任务目标格上才能互动');
  }
  objective.progress += 1;
  if (objective.progress >= objective.required) {
    objective.progress = objective.required;
    objective.destroyed = true;
  }
  logEvent(state, 'interact', {
    actor: hero.id,
    target: objective.id,
    progress: objective.progress,
    required: objective.required,
    destroyed: objective.destroyed
  });
}

function applyRest(state, hero, action) {
  hero.fatigue = 0;
  var cleared = null;
  if (action.clearCondition) {
    if (!CONDITION_TURNS[action.clearCondition]) {
      throw new Error('未知状态：' + action.clearCondition);
    }
    var index = hero.conditions.findIndex(function (c) {
      return c.type === action.clearCondition;
    });
    if (index === -1) throw new Error('没有可清除的 ' + CONDITION_NAMES[action.clearCondition]);
    hero.conditions.splice(index, 1);
    cleared = action.clearCondition;
  }
  logEvent(state, 'rest', { actor: hero.id, clearedCondition: cleared, fatigue: 0 });
}

function applyHeroAction(state, action) {
  var hero = findHero(state, state.activeHeroId);
  if (!hero || !hero.alive) throw new Error('当前没有可行动的英雄');
  if (hero.actionsLeft <= 0) throw new Error('该英雄没有剩余行动');
  if (action.actor && action.actor !== hero.id) throw new Error('不是该英雄的行动轮');

  switch (action.type) {
    case 'move':
      applyMove(state, hero, action.path, false);
      break;
    case 'attack': {
      var target = findMonster(state, action.target);
      if (!target || !target.alive) throw new Error('攻击目标不存在或已倒下');
      validateAttack(state, hero, target);
      performAttack(state, hero, target, action);
      break;
    }
    case 'interact':
      applyInteract(state, hero, action);
      break;
    case 'rest':
      applyRest(state, hero, action);
      break;
    case 'endActivation':
      logEvent(state, 'end-activation', { actor: hero.id, side: 'hero' });
      hero.actionsLeft = 0;
      if (checkGameEnd(state)) return;
      finishHeroActivation(state);
      return;
    default:
      throw new Error('未知英雄动作：' + action.type);
  }

  if (checkGameEnd(state)) return;
  hero.actionsLeft -= 1;
  if (hero.actionsLeft <= 0) finishHeroActivation(state);
}

function applySummon(state, action) {
  if (state.overlord.threat < SUMMON_COST) throw new Error('威胁点不足，无法召唤');
  if (aliveMonsters(state).length >= MAX_MONSTERS) throw new Error('怪物数量已达上限');

  var cell = null;
  if (action.cell) {
    var legalCell = state.board.spawnCells.some(function (spawn) {
      return spawn[0] === action.cell[0] && spawn[1] === action.cell[1];
    });
    if (!legalCell) throw new Error('只能在城主出生点召唤');
    cell = action.cell;
  } else {
    cell = state.board.spawnCells.find(function (spawn) {
      return !isBlockedCell(state, spawn[0], spawn[1]) && !figureAt(state, spawn[0], spawn[1]);
    });
  }
  if (!cell) throw new Error('出生点均被占据');
  if (isBlockedCell(state, cell[0], cell[1]) || figureAt(state, cell[0], cell[1])) {
    throw new Error('出生点不可用');
  }

  state.overlord.threat -= SUMMON_COST;
  var monster = makeMonster(state, 'goblin', cell[0], cell[1], true);
  monster.actionsLeft = 0;
  state.monsters.push(monster);
  state.overlord.summons += 1;
  logEvent(state, 'summon', {
    actor: 'overlord',
    monster: monster.id,
    kind: monster.kind,
    cell: [cell[0], cell[1]],
    threat: state.overlord.threat
  });
}

function applyOverlordCard(state, action) {
  var card = OVERLORD_CARDS[action.card];
  if (!card) throw new Error('未知城主卡：' + action.card);
  if (state.overlord.threat < card.cost) throw new Error('威胁点不足，无法打出城主卡');

  if (action.card === 'fury') {
    var monster = findMonster(state, action.target);
    if (!monster || !monster.alive) throw new Error('狂暴目标不存在');
    if (monster.buff.damage >= MAX_FURY_STACKS) throw new Error('狂暴已叠满');
    state.overlord.threat -= card.cost;
    monster.buff.damage += 1;
    logEvent(state, 'overlord-card', {
      card: action.card,
      target: monster.id,
      threat: state.overlord.threat,
      buffDamage: monster.buff.damage
    });
  } else if (action.card === 'shadow_bolt') {
    var hero = findHero(state, action.target);
    if (!hero || !hero.alive) throw new Error('暗影箭目标不存在');
    var source = findShadowBoltSource(state, hero);
    if (!source) throw new Error('没有怪物能看见该英雄');
    state.overlord.threat -= card.cost;
    dealDamage(state, hero, 1, 'shadow_bolt');
    var poisoned = addCondition(state, hero, 'poison');
    logEvent(state, 'overlord-card', {
      card: action.card,
      source: source.id,
      target: hero.id,
      threat: state.overlord.threat,
      damage: 1,
      poisoned: poisoned,
      targetDefeated: !hero.alive
    });
  } else {
    throw new Error('未知城主卡：' + action.card);
  }
  state.overlord.cardsPlayed += 1;
}

function applyOverlordAction(state, action) {
  switch (action.type) {
    case 'move':
    case 'attack': {
      var monster = findMonster(state, action.monsterId);
      if (!monster || !monster.alive) throw new Error('当前没有可行动的怪物');
      if (state.activeMonsterId !== monster.id) throw new Error('不是当前激活怪物');
      if (monster.actionsLeft <= 0) throw new Error('该怪物没有剩余行动');

      if (action.type === 'move') {
        applyMove(state, monster, action.path, true);
      } else {
        var target = findHero(state, action.target);
        if (!target || !target.alive) throw new Error('攻击目标不存在或已倒下');
        validateAttack(state, monster, target);
        performAttack(state, monster, target, action);
      }

      if (checkGameEnd(state)) return;
      monster.actionsLeft -= 1;
      if (monster.actionsLeft <= 0) finishMonsterActivation(state);
      return;
    }
    case 'endMonsterActivation':
      if (!state.activeMonsterId) throw new Error('当前没有激活中的怪物');
      if (action.monsterId && action.monsterId !== state.activeMonsterId) {
        throw new Error('不是当前激活怪物');
      }
      logEvent(state, 'end-activation', { actor: state.activeMonsterId, side: 'monster' });
      finishMonsterActivation(state);
      return;
    case 'summon':
      applySummon(state, action);
      checkGameEnd(state);
      return;
    case 'card':
      applyOverlordCard(state, action);
      checkGameEnd(state);
      return;
    case 'endOverlord': {
      var activeMonster = findMonster(state, state.activeMonsterId);
      if (activeMonster && activeMonster.alive) throw new Error('仍有怪物未结束激活');
      logEvent(state, 'end-overlord-phase', { round: state.round });
      endOverlordPhase(state);
      return;
    }
    default:
      throw new Error('未知城主动作：' + action.type);
  }
}

/**
 * 执行一个动作，返回新 state；不修改入参。
 * 非法动作抛 Error。
 */
export function applyAction(state, action) {
  if (!state) throw new Error('缺少对局状态');
  if (state.over) throw new Error('对局已结束');
  if (!action || typeof action.type !== 'string') throw new Error('动作缺少 type');

  var next = clone(state);
  if (next.phase === 'heroes') applyHeroAction(next, action);
  else if (next.phase === 'overlord') applyOverlordAction(next, action);
  else throw new Error('当前阶段不能行动：' + next.phase);

  next.actionCount += 1;
  if (!next.over) checkGameEnd(next);
  return next;
}

/* ------------------------------------------------------------------ *
 * AI                                                                 *
 * ------------------------------------------------------------------ */

function averageAttackDamage(dice) {
  var total = 0;
  dice.forEach(function (color) {
    var faces = DICE.attack[color];
    if (!faces) throw new Error('未知攻击骰色：' + color);
    total += faces.reduce(function (sum, face) { return sum + face.dmg; }, 0) / faces.length;
  });
  return total;
}

function averageAttackSurges(dice) {
  var total = 0;
  dice.forEach(function (color) {
    var faces = DICE.attack[color];
    total += faces.reduce(function (sum, face) { return sum + face.surge; }, 0) / faces.length;
  });
  return total;
}

function averageShields(color) {
  var faces = DICE.defense[color];
  if (!faces) return 0;
  return faces.reduce(function (sum, face) { return sum + face.shield; }, 0) / faces.length;
}

function expectedDamage(attacker, target) {
  var profile = attackProfile(attacker);
  var damage = averageAttackDamage(profile.dice);
  var surges = averageAttackSurges(profile.dice);
  var shields = target.defense ? averageShields(target.defense) : 0;
  var buff = attacker.buff && attacker.buff.damage ? attacker.buff.damage : 0;
  // surge 可以 1:1 换伤害或抵消护盾；按 0.75 的保守转化率估值。
  return Math.max(0, damage + buff + surges * 0.75 - shields);
}

function scoreHeroAction(state, hero, action) {
  if (action.type === 'interact') return 1000;
  if (action.type === 'endActivation') return 0;

  if (action.type === 'attack') {
    var target = findMonster(state, action.target);
    if (!target || !target.alive) return -100;
    var damage = expectedDamage(hero, target);
    var score = 70 + damage * 9;
    if (damage >= target.health) score += 70;
    if (state.objective.destroyed) score -= 15;
    return score;
  }

  if (action.type === 'move') {
    var destination = action.path[action.path.length - 1];
    var scoreMove = 0;
    if (!state.objective.destroyed) {
      var objectiveField = distanceField(state, [[state.objective.x, state.objective.y]]);
      var oldDistance = fieldAt(objectiveField, hero);
      var newDistance = fieldAt(objectiveField, { x: destination[0], y: destination[1] });
      scoreMove += (oldDistance - newDistance) * 12;
      if (destination[0] === state.objective.x && destination[1] === state.objective.y) {
        scoreMove += 260;
      }
    } else {
      var exitField = distanceField(state, state.board.exitCells);
      var oldExit = fieldAt(exitField, hero);
      var newExit = fieldAt(exitField, { x: destination[0], y: destination[1] });
      scoreMove += (oldExit - newExit) * 12;
      if (isExitCell(state, destination[0], destination[1])) scoreMove += 140;
    }
    var fatigue = Math.max(0, action.path.length - 1 - hero.speed);
    scoreMove -= fatigue * 30;
    if (action.path.length <= 1) scoreMove -= 5;
    return scoreMove;
  }

  if (action.type === 'rest') {
    var scoreRest = 0;
    var hasConditions = hero.conditions.length > 0;
    if (hasConditions) scoreRest += action.clearCondition ? 80 : 20;
    if (hasConditions && hero.conditions.some(function (c) {
      return c.type === 'poison' || c.type === 'bleed';
    })) {
      scoreRest += action.clearCondition ? 40 : 5;
    }
    if (hero.fatigue >= hero.stamina * 0.5) scoreRest += 20;
    if (hero.health / hero.maxHealth < 0.5) scoreRest += 15;
    return scoreRest;
  }

  return -Infinity;
}

function nearestHeroDistance(state, monster) {
  var heroes = aliveHeroes(state);
  if (!heroes.length) return 99;
  var best = 99;
  heroes.forEach(function (hero) {
    var value = manhattan(monster, hero);
    if (value < best) best = value;
  });
  return best;
}

function scoreOverlordAction(state, action) {
  if (action.type === 'attack') {
    var hero = findHero(state, action.target);
    var monster = findMonster(state, action.monsterId);
    if (!hero || !hero.alive || !monster) return -100;
    var damage = expectedDamage(monster, hero);
    var score = 85 + damage * 11;
    if (damage >= hero.health) score += 90;
    return score;
  }

  if (action.type === 'move') {
    var mover = findMonster(state, action.monsterId);
    if (!mover) return -100;
    var destination = action.path[action.path.length - 1];
    var oldDistance = nearestHeroDistance(state, mover);
    var newDistance = nearestHeroDistance(state, { x: destination[0], y: destination[1] });
    var moveScore = (oldDistance - newDistance) * 12;
    if (moveScore === 0) moveScore -= 6;
    return moveScore;
  }

  if (action.type === 'summon') {
    var count = aliveMonsters(state).length;
    if (count < 2) return 95;
    if (count < 4) return 55;
    return 20;
  }

  if (action.type === 'card') {
    if (action.card === 'fury') return 55;
    if (action.card === 'shadow_bolt') {
      var target = findHero(state, action.target);
      if (target && target.health <= 2) return 95;
      return 65;
    }
    return 0;
  }

  if (action.type === 'endMonsterActivation') return 0;
  if (action.type === 'endOverlord') return 0;
  return -Infinity;
}

export function chooseHeroAIAction(state, actor, actions) {
  var heroId = actor || state.activeHeroId;
  var hero = findHero(state, heroId);
  if (!hero) throw new Error('未知英雄：' + heroId);
  var list = actions || legalActions(state, heroId);
  if (!list.length) throw new Error('英雄没有合法动作');
  var best = list[0];
  var bestScore = -Infinity;
  list.forEach(function (action) {
    var score = scoreHeroAction(state, hero, action);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  });
  return clone(best);
}

export function chooseOverlordAIAction(state, actions) {
  var list = actions || legalActions(state, 'overlord');
  if (!list.length) throw new Error('城主没有合法动作');
  var best = list[0];
  var bestScore = -Infinity;
  list.forEach(function (action) {
    var score = scoreOverlordAction(state, action);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  });
  return clone(best);
}

export function chooseAIAction(state, actor) {
  var current = actor || currentActor(state);
  if (current === 'overlord') return chooseOverlordAIAction(state);
  return chooseHeroAIAction(state, current);
}

export function runSelfPlay(options) {
  var opts = options || {};
  var state = createGame(opts);
  var limit = opts.maxActions || 8000;
  var steps = 0;
  while (!state.over && steps < limit) {
    var actor = currentActor(state);
    var action = chooseAIAction(state, actor);
    state = applyAction(state, action);
    steps += 1;
  }
  return {
    state: state,
    result: result(state),
    steps: steps,
    finished: !!state.over
  };
}

/* ------------------------------------------------------------------ *
 * 创建 / 查询                                                        *
 * ------------------------------------------------------------------ */

function makeMonster(state, kind, x, y, summoned) {
  var template = MONSTER_TYPES[kind];
  if (!template) throw new Error('未知怪物类型：' + kind);
  var id = 'm' + state.nextMonsterId;
  state.nextMonsterId += 1;
  return {
    id: id,
    side: 'monster',
    kind: kind,
    kindName: template.name,
    name: template.name + (summoned ? '·召唤' : ''),
    x: x,
    y: y,
    health: template.health,
    maxHealth: template.health,
    speed: template.speed,
    defense: template.defense,
    attack: clone(template.attack),
    actionsLeft: 0,
    alive: true,
    elite: !!template.elite,
    summonedRound: summoned ? state.round : null,
    conditions: [],
    buff: { damage: 0 }
  };
}

function resolveHeroKeys(options) {
  if (Array.isArray(options.heroes)) {
    if (options.heroes.length < 1 || options.heroes.length > 4) {
      throw new Error('英雄数量必须是 1-4');
    }
    options.heroes.forEach(function (key) {
      if (!HERO_ARCHETYPES[key]) throw new Error('未知英雄类型：' + key);
    });
    return options.heroes.slice();
  }
  var count = options.heroCount;
  if (count === undefined || count === null) {
    if (typeof options.heroes === 'number') count = options.heroes;
    else count = DEFAULT_HERO_COUNT;
  }
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new Error('英雄数量必须是 1-4');
  }
  return HERO_ORDER.slice(0, count);
}

function makeHero(template, index, x, y) {
  return {
    id: 'h' + (index + 1),
    side: 'hero',
    kind: 'hero',
    key: template.key,
    title: template.title,
    name: template.name,
    displayName: template.title + '·' + template.name,
    x: x,
    y: y,
    health: template.health,
    maxHealth: template.health,
    speed: template.speed,
    stamina: template.stamina,
    fatigue: 0,
    defense: template.defense,
    weapon: clone(template.weapon),
    actionsLeft: 0,
    alive: true,
    conditions: [],
    buff: { damage: 0 }
  };
}

/**
 * createGame({ seed, heroCount, heroes, maxRounds, startingThreat })
 *   seed      任意字符串/数字，默认 'descent-relic-vault'
 *   heroCount 1-4，默认 2
 *   heroes    也可用 ['warrior','scout','mage','healer'] 指定
 */
export function createGame(options) {
  var opts = options || {};
  var seed = opts.seed === undefined || opts.seed === null
    ? DEFAULT_SEED
    : String(opts.seed);
  var heroKeys = resolveHeroKeys(opts);
  var maxRounds = opts.maxRounds === undefined ? MAX_ROUNDS : opts.maxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds 必须是正整数');

  var state = {
    engine: 'descent-premium',
    version: VERSION,
    seed: seed,
    rngCount: 0,
    round: 1,
    maxRounds: maxRounds,
    phase: 'heroes',
    activeHeroIndex: -1,
    activeHeroId: null,
    activeMonsterId: null,
    overlordQueue: [],
    overlordQueueIndex: -1,
    actionCount: 0,
    heroes: [],
    monsters: [],
    overlord: {
      threat: opts.startingThreat === undefined ? 2 : opts.startingThreat,
      cardsPlayed: 0,
      summons: 0
    },
    objective: {
      id: 'relic',
      name: '仪式水晶',
      x: 11,
      y: 5,
      progress: 0,
      required: 2,
      destroyed: false
    },
    board: {
      id: MAP.id,
      name: MAP.name,
      width: MAP.width,
      height: MAP.height,
      layout: MAP.layout.slice(),
      exitCells: MAP.exitCells.map(function (cell) { return [cell[0], cell[1]]; }),
      spawnCells: MAP.spawnCells.map(function (cell) { return [cell[0], cell[1]]; })
    },
    nextMonsterId: 1,
    over: false,
    winner: null,
    endReason: null,
    log: []
  };

  heroKeys.forEach(function (key, index) {
    var start = MAP.heroStarts[index];
    state.heroes.push(makeHero(HERO_ARCHETYPES[key], index, start[0], start[1]));
  });

  INITIAL_MONSTERS.forEach(function (spec) {
    var monster = makeMonster(state, spec.kind, spec.x, spec.y, false);
    state.monsters.push(monster);
  });

  logEvent(state, 'game-start', {
    seed: seed,
    heroes: state.heroes.map(function (hero) { return { id: hero.id, key: hero.key, name: hero.displayName }; }),
    monsters: state.monsters.map(function (monster) { return { id: monster.id, kind: monster.kind }; }),
    objective: { id: state.objective.id, x: state.objective.x, y: state.objective.y, required: state.objective.required }
  });

  beginHeroActivation(state, 0);
  checkGameEnd(state);
  return state;
}

export function currentActor(state) {
  if (!state || state.over) return null;
  if (state.phase === 'heroes') return state.activeHeroId;
  if (state.phase === 'overlord') return 'overlord';
  return null;
}

export function isOver(state) {
  return !!(state && state.over);
}

export function result(state) {
  if (!state) throw new Error('缺少对局状态');
  return {
    over: !!state.over,
    winner: state.winner || null,
    reason: state.endReason || null,
    round: state.round,
    maxRounds: state.maxRounds,
    objective: {
      id: state.objective.id,
      name: state.objective.name,
      x: state.objective.x,
      y: state.objective.y,
      progress: state.objective.progress,
      required: state.objective.required,
      destroyed: state.objective.destroyed
    },
    heroes: state.heroes.map(function (hero) {
      return {
        id: hero.id,
        name: hero.displayName,
        alive: hero.alive,
        health: hero.health,
        maxHealth: hero.maxHealth,
        fatigue: hero.fatigue,
        stamina: hero.stamina,
        conditions: hero.conditions.map(function (c) { return c.type; }),
        x: hero.x,
        y: hero.y
      };
    }),
    monstersAlive: aliveMonsters(state).length,
    threat: state.overlord.threat,
    actions: state.actionCount,
    logLength: state.log.length
  };
}

export default Object.freeze({
  VERSION: VERSION,
  ACTIONS_PER_TURN: ACTIONS_PER_TURN,
  MAX_ROUNDS: MAX_ROUNDS,
  MAX_MONSTERS: MAX_MONSTERS,
  SUMMON_COST: SUMMON_COST,
  DICE: DICE,
  HERO_ARCHETYPES: HERO_ARCHETYPES,
  MONSTER_TYPES: MONSTER_TYPES,
  OVERLORD_CARDS: OVERLORD_CARDS,
  MAP: MAP,
  createGame: createGame,
  legalActions: legalActions,
  applyAction: applyAction,
  isOver: isOver,
  result: result,
  currentActor: currentActor,
  chooseAIAction: chooseAIAction,
  chooseHeroAIAction: chooseHeroAIAction,
  chooseOverlordAIAction: chooseOverlordAIAction,
  runSelfPlay: runSelfPlay,
  hasLineOfSight: hasLineOfSight,
  resolveAttackFaces: resolveAttackFaces,
  manhattan: manhattan,
  isExitCell: isExitCell,
  aliveHeroes: aliveHeroes,
  aliveMonsters: aliveMonsters,
  getFigure: getFigure
});
