/*
 * The Castles of Burgundy (勃艮第城堡) — pure rules engine, phase 1 (no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> canonical legal Action[] for the current player
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> final / current score, ranking, winner
 *   scorePlayer(state, index)     -> one player's score breakdown
 *   hashState(state)              -> stable 8-hex digest for replay checks
 *   chooseGreedyAction(state)     -> one legal action for the built-in AI
 *   autoPlay(state, opts)         -> deterministic self-play
 *   selfPlay(opts)                -> createGame + autoPlay
 *
 * Scope: 2–4 player base game, 5 phases (A–E) × 5 rounds, two die actions per
 * turn, optional black-depot purchase, all six tile colours, all 8 buildings
 * and all 26 knowledge tiles.
 *
 * Design constraints
 *   - Zero runtime dependencies, zero DOM.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input, so public operations are pure.
 *   - Every random choice is derived from createGame({seed}); no Math.random.
 *
 * Rules and every intentional deviation are documented in rules.md.
 */

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const COLORS = Object.freeze([
  'castle', 'ship', 'animal', 'building', 'knowledge', 'mine'
]);
export const TILE_TYPES = COLORS;
export const PHASES = Object.freeze(['A', 'B', 'C', 'D', 'E']);
export const ROUNDS_PER_PHASE = 5;
export const TOTAL_ROUNDS = 25;

export const REGION_SCORE = Object.freeze({
  1: 1, 2: 3, 3: 6, 4: 10, 5: 15, 6: 21, 7: 28, 8: 36
});
export const PHASE_REGION_BONUS = Object.freeze([10, 8, 6, 4, 2]);
export const SELL_VP = Object.freeze({ 2: 2, 3: 3, 4: 4 });
export const BONUS_VP = Object.freeze({
  2: Object.freeze({ large: 5, small: 2 }),
  3: Object.freeze({ large: 6, small: 3 }),
  4: Object.freeze({ large: 7, small: 4 })
});

export const MAX_STORAGE = 3;
export const MAX_GOODS_TYPES = 3;
export const STARTING_SILVER = 1;
export const MAX_ACTIONS = 20000;

export const BUILDING_TYPES = Object.freeze([
  'warehouse', 'carpenter', 'church', 'market',
  'boardingHouse', 'bank', 'cityHall', 'watchtower'
]);
export const BUILDING_INFO = Object.freeze({
  warehouse: Object.freeze({ name: '仓库', text: '立即卖出一类货品（无需骰子）' }),
  carpenter: Object.freeze({ name: '木匠工坊', text: '从任意编号仓库取一块建筑板块' }),
  church: Object.freeze({ name: '教堂', text: '从任意编号仓库取一块矿/知识/城堡板块' }),
  market: Object.freeze({ name: '市场', text: '从任意编号仓库取一块船只/动物板块' }),
  boardingHouse: Object.freeze({ name: '客栈', text: '立即获得 4 个工人' }),
  bank: Object.freeze({ name: '银行', text: '立即获得 2 银币' }),
  cityHall: Object.freeze({ name: '市政厅', text: '立即从存放区再放一块板块（忽略骰点）' }),
  watchtower: Object.freeze({ name: '瞭望塔', text: '立即获得 4 分' })
});
export const ANIMAL_TYPES = Object.freeze(['sheep', 'pig', 'cattle', 'chicken']);
export const ANIMAL_NAMES = Object.freeze({
  sheep: '羊', pig: '猪', cattle: '牛', chicken: '鸡'
});

export const KNOWLEDGE_INFO = Object.freeze({
  1: '同一城市可重复建筑类型',
  2: '每阶段结束时每座矿额外 +1 工人',
  3: '卖货得 2 银币而非 1',
  4: '卖货额外 +1 工人',
  5: '放船时可从两个相邻货品仓取货',
  6: '可从任意编号仓库购买（仍每回合一次）',
  7: '动物计分时每块计分板块额外 +1 分',
  8: '每 1 工人可调整骰点最多 ±2',
  9: '放置建筑时免费 ±1 骰点',
  10: '放置船只/动物时免费 ±1 骰点',
  11: '放置城堡/矿/知识时免费 ±1 骰点',
  12: '取板块时免费 ±1 骰点',
  13: '拿工人行动额外 +1 银币',
  14: '拿工人行动改为 +4 工人',
  15: '终局每个已售货品种类 3 分',
  16: '终局每座仓库 4 分',
  17: '终局每座瞭望塔 4 分',
  18: '终局每座木匠工坊 4 分',
  19: '终局每座教堂 4 分',
  20: '终局每个市场 4 分',
  21: '终局每座客栈 4 分',
  22: '终局每座银行 4 分',
  23: '终局每座市政厅 4 分',
  24: '终局每种动物类型 4 分',
  25: '终局每块已售货品 1 分',
  26: '终局每块奖励板块 2 分'
});

/** Which building a knowledge tile 16–23 scores. */
export const KNOWLEDGE_BUILDING = Object.freeze({
  16: 'warehouse', 17: 'watchtower', 18: 'carpenter', 19: 'church',
  20: 'market', 21: 'boardingHouse', 22: 'bank', 23: 'cityHall'
});

/**
 * Depot colour layout. Every depot holds four printed-colour slots and is
 * refilled from the matching colour supply at the start of each phase.
 * 2 players use the first two slots of every depot, 3 players the first
 * three, 4 players all four. This custom-but-balanced layout is documented
 * in rules.md §本版简化.
 */
export const DEPOT_LAYOUT = Object.freeze([
  Object.freeze({ number: 1, colors: Object.freeze(['building', 'building', 'building', 'animal']) }),
  Object.freeze({ number: 2, colors: Object.freeze(['animal', 'building', 'knowledge', 'ship']) }),
  Object.freeze({ number: 3, colors: Object.freeze(['knowledge', 'castle', 'knowledge', 'building']) }),
  Object.freeze({ number: 4, colors: Object.freeze(['ship', 'ship', 'building', 'animal']) }),
  Object.freeze({ number: 5, colors: Object.freeze(['mine', 'animal', 'building', 'ship']) }),
  Object.freeze({ number: 6, colors: Object.freeze(['building', 'knowledge', 'castle', 'mine']) })
]);
export const DEPOT_ACTIVE_SLOTS = Object.freeze({ 2: 2, 3: 3, 4: 4 });

/* ------------------------------------------------------------------ */
/* Board geometry                                                     */
/* ------------------------------------------------------------------ */

/*
 * A 37-space hex duchy (radius 3). The centre is the starting castle (die
 * value 6). Every other space carries one printed die value; the 36 outer
 * spaces contain each value 1–6 exactly six times.
 */
const REGION_SPECS = Object.freeze([
  { id: 0, color: 'castle', cells: [[0, 0, 6]] },
  { id: 1, color: 'knowledge', cells: [[0, -3, 1], [1, -3, 2], [2, -3, 3], [3, -3, 4], [2, -2, 5], [3, -2, 6]] },
  { id: 2, color: 'building', cells: [[-1, -2, 1], [0, -2, 2], [1, -2, 3], [-1, -1, 4], [0, -1, 5]] },
  { id: 3, color: 'building', cells: [[1, -1, 1], [2, -1, 2], [2, 0, 3], [1, 0, 6]] },
  { id: 4, color: 'building', cells: [[3, -1, 4], [3, 0, 5], [2, 1, 6]] },
  { id: 5, color: 'animal', cells: [[-2, -1, 1], [-2, 0, 2], [-1, 0, 4]] },
  { id: 6, color: 'animal', cells: [[-3, 0, 3], [-3, 1, 5], [-2, 1, 6]] },
  { id: 7, color: 'ship', cells: [[0, 1, 1], [1, 1, 2], [1, 2, 3], [0, 2, 4]] },
  { id: 8, color: 'ship', cells: [[-1, 1, 5], [-1, 2, 6]] },
  { id: 9, color: 'castle', cells: [[-3, 2, 1], [-2, 2, 5], [-2, 3, 3]] },
  { id: 10, color: 'mine', cells: [[-3, 3, 2]] },
  { id: 11, color: 'mine', cells: [[-1, 3, 4], [0, 3, 6]] }
]);

function freezeSpace(space) {
  return Object.freeze(space);
}

export const BOARD_SPACES = Object.freeze((() => {
  const spaces = [];
  for (const spec of REGION_SPECS) {
    for (const cell of spec.cells) {
      spaces.push(freezeSpace({
        id: spaces.length,
        q: cell[0],
        r: cell[1],
        number: cell[2],
        color: spec.color,
        regionId: spec.id
      }));
    }
  }
  return spaces;
})());

export const REGIONS = Object.freeze(REGION_SPECS.map((spec) => {
  const spaceIds = BOARD_SPACES.filter((s) => s.regionId === spec.id).map((s) => s.id);
  return Object.freeze({
    id: spec.id,
    color: spec.color,
    size: spaceIds.length,
    spaceIds: Object.freeze(spaceIds)
  });
}));

export const COLOR_SPACE_COUNTS = Object.freeze(COLORS.reduce((acc, color) => {
  acc[color] = BOARD_SPACES.filter((s) => s.color === color).length;
  return acc;
}, {}));

const SPACE_BY_COORD = new Map(BOARD_SPACES.map((s) => [s.q + ',' + s.r, s.id]));
const HEX_DIRECTIONS = Object.freeze([
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
]);

export function neighborsOf(spaceId) {
  if (!Number.isInteger(spaceId) || spaceId < 0 || spaceId >= BOARD_SPACES.length) return [];
  const space = BOARD_SPACES[spaceId];
  const out = [];
  for (const [dq, dr] of HEX_DIRECTIONS) {
    const id = SPACE_BY_COORD.get((space.q + dq) + ',' + (space.r + dr));
    if (id !== undefined) out.push(id);
  }
  return out;
}

export function regionOf(spaceId) {
  const space = BOARD_SPACES[spaceId];
  return space ? REGIONS[space.regionId] : null;
}

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                 */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('Castles of Burgundy illegal: ' + message);
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function hashState(state) {
  const text = stableStringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function seedToInt(seed) {
  const text = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function nextRandom(state) {
  // mulberry32; state.rngState is part of the serialisable state.
  let t = (state.rngState + 0x6D2B79F5) >>> 0;
  state.rngState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function rollDie(state) {
  return 1 + Math.floor(nextRandom(state) * 6);
}

function shuffle(state, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function pushEvent(state, event) {
  state.events.push(event);
  if (state.events.length > 400) state.events = state.events.slice(-400);
}

function addVP(state, ps, points, meta) {
  if (!points) return;
  ps.vp += points;
  const event = Object.assign({}, meta || {});
  event.kind = 'vp';
  event.player = ps.index;
  event.points = points;
  pushEvent(state, event);
}

function circularDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, 6 - d);
}

/* ------------------------------------------------------------------ */
/* Tile creation                                                      */
/* ------------------------------------------------------------------ */

function makeTile(state, spec) {
  state.nextTileId += 1;
  return Object.assign({ id: 't' + state.nextTileId }, spec);
}

function makeCastle(state, black) {
  return makeTile(state, { type: 'castle', color: 'castle', black: !!black });
}
function makeShip(state, black) {
  return makeTile(state, { type: 'ship', color: 'ship', black: !!black });
}
function makeMine(state, black) {
  return makeTile(state, { type: 'mine', color: 'mine', black: !!black });
}
function makeAnimal(state, animal, count, black) {
  return makeTile(state, { type: 'animal', color: 'animal', animal, count, black: !!black });
}
function makeBuilding(state, building, black) {
  return makeTile(state, { type: 'building', color: 'building', building, black: !!black });
}
function makeKnowledge(state, knowledge, black) {
  return makeTile(state, { type: 'knowledge', color: 'knowledge', knowledge, black: !!black });
}

function buildSupplies(state) {
  const supplies = {};
  supplies.castle = shuffle(state, Array.from({ length: 16 }, () => makeCastle(state)));
  supplies.ship = shuffle(state, Array.from({ length: 24 }, () => makeShip(state)));
  supplies.mine = shuffle(state, Array.from({ length: 12 }, () => makeMine(state)));

  const animals = [];
  const counts = [2, 3, 4, 2, 3];
  for (const type of ANIMAL_TYPES) {
    for (const count of counts) animals.push(makeAnimal(state, type, count));
  }
  supplies.animal = shuffle(state, animals);

  const buildings = [];
  for (const type of BUILDING_TYPES) {
    for (let i = 0; i < 5; i += 1) buildings.push(makeBuilding(state, type));
  }
  supplies.building = shuffle(state, buildings);

  supplies.knowledge = shuffle(state, Array.from({ length: 26 }, (_, i) => makeKnowledge(state, i + 1)));

  // Black-backed depot copies (bought for 2 silver). Enough for all phases
  // even in a 4-player game.
  const black = [];
  for (const type of BUILDING_TYPES) {
    for (let i = 0; i < 2; i += 1) black.push(makeBuilding(state, type, true));
  }
  for (const type of ANIMAL_TYPES) {
    for (const count of [2, 3]) black.push(makeAnimal(state, type, count, true));
  }
  for (let n = 1; n <= 12; n += 1) black.push(makeKnowledge(state, n, true));
  for (let i = 0; i < 6; i += 1) black.push(makeShip(state, true));
  for (let i = 0; i < 6; i += 1) black.push(makeMine(state, true));
  for (let i = 0; i < 6; i += 1) black.push(makeCastle(state, true));
  supplies.black = shuffle(state, black);

  return supplies;
}

function drawSupply(state, color) {
  const deck = state.supplies[color];
  if (!deck || deck.length === 0) return null;
  return deck.pop();
}

/* ------------------------------------------------------------------ */
/* Player / game construction                                         */
/* ------------------------------------------------------------------ */

function freshBoard(index) {
  const spaces = BOARD_SPACES.map((s) => ({
    id: s.id, q: s.q, r: s.r, number: s.number, color: s.color,
    regionId: s.regionId, tile: null
  }));
  const regions = REGIONS.map((r) => ({
    id: r.id, color: r.color, size: r.size,
    spaceIds: r.spaceIds.slice(), completed: r.id === 0
  }));
  const centre = spaces.find((s) => s.q === 0 && s.r === 0);
  centre.tile = {
    id: 'start-castle-' + index, type: 'castle', color: 'castle', start: true
  };
  return { spaces, regions };
}

function makePlayer(index, name, orderPosition) {
  const board = freshBoard(index);
  return {
    index,
    name,
    spaces: board.spaces,
    regions: board.regions,
    storage: [],
    goods: {},
    sold: {},
    silver: STARTING_SILVER,
    workers: orderPosition + 1,
    vp: 0,
    dice: [],
    diceUsed: [false, false],
    knowledge: [],
    bonusTiles: [],
    colorsCompleted: {}
  };
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert(playerCount === 2 || playerCount === 3 || playerCount === 4,
    'playerCount must be 2, 3 or 4');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;

  const state = {
    version: VERSION,
    seed,
    playerCount,
    rules: {
      edition: '1st',
      board: 'custom-37-hex',
      depotLayout: 'balanced-24-slot',
      storageLimit: MAX_STORAGE,
      goodsTypeLimit: MAX_GOODS_TYPES
    },
    phase: 'play',
    phaseIndex: 0,
    round: 1,
    roundInPhase: 1,
    turnIndex: 0,
    order: [],
    roundOrder: [],
    players: [],
    depots: {},
    blackDepot: [],
    supplies: {},
    goodsSpaces: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] },
    phasePiles: [],
    phaseGoods: [],
    colorBonuses: COLORS.reduce((acc, color) => {
      acc[color] = { large: null, small: null };
      return acc;
    }, {}),
    pendingBonus: 0,
    boughtThisTurn: false,
    actionsThisTurn: 0,
    events: [],
    winner: null,
    rngState: seedToInt(seed),
    nextTileId: 0
  };

  // Random tables.
  state.supplies = buildSupplies(state);

  const goods = [];
  for (let color = 1; color <= 6; color += 1) {
    for (let i = 0; i < 7; i += 1) goods.push(color);
  }
  shuffle(state, goods);
  state.phasePiles = [];
  for (let phase = 0; phase < PHASES.length; phase += 1) {
    state.phasePiles.push(goods.splice(0, 5));
  }
  const startingGoods = goods; // 42 - 25 = 17

  const order = shuffle(state, Array.from({ length: playerCount }, (_, i) => i));
  state.order = order;
  state.roundOrder = order.slice();

  for (let i = 0; i < playerCount; i += 1) {
    const name = opts.names && opts.names[i] ? opts.names[i] : 'P' + (i + 1);
    const ps = makePlayer(i, name, order.indexOf(i));
    for (let n = 0; n < 3 && startingGoods.length > 0; n += 1) {
      addGoods(ps, startingGoods.pop(), 1);
    }
    state.players.push(ps);
  }

  setupPhase(state);
  setupRound(state);
  return state;
}

function setupPhase(state) {
  const active = DEPOT_ACTIVE_SLOTS[state.playerCount];
  const depots = {};
  for (const layout of DEPOT_LAYOUT) {
    const slots = layout.colors.map((color) => ({ color, tile: null }));
    for (let i = 0; i < active; i += 1) {
      let color = layout.colors[i];
      // 3-player special: depot 6's castle slot becomes a mine in B and D.
      if (state.playerCount === 3 &&
        layout.number === 6 && i === 2 &&
        color === 'castle' &&
        (state.phaseIndex === 1 || state.phaseIndex === 3)) {
        color = 'mine';
      }
      slots[i].color = color;
      slots[i].tile = drawSupply(state, color);
    }
    depots[layout.number] = { number: layout.number, slots };
  }
  state.depots = depots;

  state.blackDepot = [];
  const blackTarget = state.playerCount * 2;
  while (state.blackDepot.length < blackTarget && state.supplies.black.length > 0) {
    state.blackDepot.push(state.supplies.black.pop());
  }

  state.phaseGoods = state.phasePiles[state.phaseIndex].slice();
  pushEvent(state, {
    kind: 'phase-setup', phase: PHASES[state.phaseIndex], phaseIndex: state.phaseIndex
  });
}

function setupRound(state) {
  state.roundOrder = state.order.slice();
  state.turnIndex = 0;
  state.actionsThisTurn = 0;
  state.pendingBonus = 0;
  state.boughtThisTurn = false;

  for (const ps of state.players) {
    ps.dice = [rollDie(state), rollDie(state)];
    ps.diceUsed = [false, false];
  }

  const startPlayer = state.roundOrder[0];
  const white = rollDie(state);
  let goodsColor = null;
  if (state.phaseGoods.length > 0) {
    goodsColor = state.phaseGoods.shift();
    state.goodsSpaces[white].push(goodsColor);
  }
  pushEvent(state, {
    kind: 'round-start', round: state.round, roundInPhase: state.roundInPhase,
    phase: PHASES[state.phaseIndex], startPlayer, white, goodsColor
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export function currentPlayer(state) {
  if (state.phase !== 'play') return null;
  const player = state.roundOrder[state.turnIndex];
  return player === undefined ? null : player;
}

export function phaseLetter(state) {
  return PHASES[state.phaseIndex] || null;
}

export function regionSpaces(regionId) {
  const region = REGIONS[regionId];
  return region ? region.spaceIds.slice() : [];
}

export function isEmptySpace(ps, spaceId) {
  return !ps.spaces[spaceId].tile;
}

export function hasKnowledge(ps, number) {
  return ps.knowledge.indexOf(number) !== -1;
}

export function countMines(ps) {
  return ps.spaces.reduce((n, s) => n + (s.tile && s.tile.type === 'mine' ? 1 : 0), 0);
}

export function countBuildings(ps, type) {
  return ps.spaces.reduce((n, s) => n +
    (s.tile && s.tile.type === 'building' && (!type || s.tile.building === type) ? 1 : 0), 0);
}

export function countAnimalTypes(ps) {
  const set = new Set();
  for (const s of ps.spaces) {
    if (s.tile && s.tile.type === 'animal') set.add(s.tile.animal);
  }
  return set.size;
}

export function emptySpaces(ps) {
  return ps.spaces.reduce((n, s) => n + (s.tile ? 0 : 1), 0);
}

function goodsTypes(ps) {
  return Object.keys(ps.goods).filter((color) => (ps.goods[color] || 0) > 0).length;
}

function goodsTiles(ps) {
  return Object.keys(ps.goods).reduce((n, color) => n + (ps.goods[color] || 0), 0);
}

function addGoods(ps, color, amount) {
  if (!color) return false;
  const current = ps.goods[color] || 0;
  if (current === 0 && goodsTypes(ps) >= MAX_GOODS_TYPES) return false;
  ps.goods[color] = current + amount;
  return true;
}

function adjacentToFilled(ps, spaceId) {
  return neighborsOf(spaceId).some((id) => !!ps.spaces[id].tile);
}

function sameBuildingInRegion(ps, regionId, building) {
  return ps.spaces.some((s) =>
    s.regionId === regionId &&
    s.tile && s.tile.type === 'building' && s.tile.building === building);
}

function canPlace(ps, tile, spaceId, value, opts = {}) {
  const space = ps.spaces[spaceId];
  if (!space || space.tile) return false;
  if (!opts.ignoreColor && space.color !== tile.color) return false;
  if (!opts.ignoreNumber && space.number !== value) return false;
  if (!opts.ignoreAdjacency && !adjacentToFilled(ps, spaceId)) return false;
  if (tile.type === 'building' &&
    !opts.ignoreBuildingLimit &&
    !hasKnowledge(ps, 1) &&
    sameBuildingInRegion(ps, space.regionId, tile.building)) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Dice adjustment                                                    */
/* ------------------------------------------------------------------ */

function freeAdjustment(ps, actionType, tile) {
  if (actionType === 'takeTile' && hasKnowledge(ps, 12)) return 1;
  if (actionType === 'placeTile' && tile) {
    if (tile.color === 'building' && hasKnowledge(ps, 9)) return 1;
    if ((tile.color === 'ship' || tile.color === 'animal') && hasKnowledge(ps, 10)) return 1;
    if ((tile.color === 'castle' || tile.color === 'mine' || tile.color === 'knowledge') &&
      hasKnowledge(ps, 11)) return 1;
  }
  return 0;
}

export function adjustmentCost(state, ps, actionType, tile, from, to) {
  if (actionType === 'takeWorkers' || actionType === 'buyTile' || actionType === 'endTurn') return 0;
  const distance = circularDistance(from, to);
  if (distance === 0) return 0;
  const free = freeAdjustment(ps, actionType, tile);
  const remaining = Math.max(0, distance - free);
  if (hasKnowledge(ps, 8)) return Math.ceil(remaining / 2);
  return remaining;
}

/* ------------------------------------------------------------------ */
/* Depot / storage helpers                                            */
/* ------------------------------------------------------------------ */

function activeDepotSlots(state, depotNumber) {
  const depot = state.depots[depotNumber];
  return depot ? depot.slots : [];
}

function findDepotTile(state, tileId) {
  for (const layout of DEPOT_LAYOUT) {
    const depot = state.depots[layout.number];
    if (!depot) continue;
    for (let i = 0; i < depot.slots.length; i += 1) {
      const slot = depot.slots[i];
      if (slot.tile && slot.tile.id === tileId) {
        return { depot: layout.number, slotIndex: i, slot, tile: slot.tile };
      }
    }
  }
  return null;
}

function findBlackTile(state, tileId) {
  const index = state.blackDepot.findIndex((t) => t.id === tileId);
  if (index === -1) return null;
  return { index, tile: state.blackDepot[index] };
}

function findStorageTile(ps, tileId) {
  return ps.storage.find((t) => t.id === tileId) || null;
}

function putIntoStorage(state, ps, tile, discardTileId) {
  if (ps.storage.length < MAX_STORAGE) {
    ps.storage.push(tile);
    return null;
  }
  assert(discardTileId, 'storage is full, discardTileId is required');
  const index = ps.storage.findIndex((t) => t.id === discardTileId);
  assert(index !== -1, 'discard tile is not in storage');
  const discarded = ps.storage[index];
  ps.storage[index] = tile;
  pushEvent(state, {
    kind: 'discard', player: ps.index, tile: discarded, stored: tile
  });
  return discarded;
}

function sellGoods(state, ps, color) {
  const count = ps.goods[color] || 0;
  if (count <= 0) return 0;
  ps.goods[color] = 0;
  ps.sold[color] = (ps.sold[color] || 0) + count;
  const silver = hasKnowledge(ps, 3) ? 2 : 1;
  ps.silver += silver;
  if (hasKnowledge(ps, 4)) ps.workers += 1;
  addVP(state, ps, count * SELL_VP[state.playerCount], {
    reason: 'sell', color, tiles: count
  });
  pushEvent(state, {
    kind: 'sell', player: ps.index, color, tiles: count, silver,
    workers: hasKnowledge(ps, 4) ? 1 : 0
  });
  return count;
}

function sellBestGoods(state, ps) {
  let bestColor = null;
  let bestCount = 0;
  for (let color = 1; color <= 6; color += 1) {
    const count = ps.goods[color] || 0;
    if (count > bestCount) {
      bestCount = count;
      bestColor = color;
    }
  }
  if (bestColor !== null) sellGoods(state, ps, bestColor);
  return bestColor;
}

function gainWorkers(state, ps) {
  const amount = hasKnowledge(ps, 14) ? 4 : 2;
  ps.workers += amount;
  if (hasKnowledge(ps, 13)) ps.silver += 1;
  pushEvent(state, {
    kind: 'take-workers', player: ps.index, workers: amount,
    silver: hasKnowledge(ps, 13) ? 1 : 0
  });
}

/* ------------------------------------------------------------------ */
/* Scoring helpers                                                    */
/* ------------------------------------------------------------------ */

function completeRegionIfNeeded(state, ps, regionId) {
  const region = ps.regions[regionId];
  if (!region || region.completed) return 0;
  if (!region.spaceIds.every((id) => !!ps.spaces[id].tile)) return 0;
  region.completed = true;
  const sizePoints = REGION_SCORE[region.size] || region.size;
  const phasePoints = PHASE_REGION_BONUS[state.phaseIndex] || 0;
  const total = sizePoints + phasePoints;
  addVP(state, ps, total, {
    reason: 'region', region: regionId, size: region.size,
    sizePoints, phasePoints, phase: PHASES[state.phaseIndex]
  });
  return total;
}

function completeColorIfNeeded(state, ps, color) {
  const total = COLOR_SPACE_COUNTS[color];
  if (!total) return 0;
  const filled = ps.spaces.reduce((n, s) =>
    n + (s.color === color && s.tile ? 1 : 0), 0);
  if (filled < total || ps.colorsCompleted[color]) return 0;
  ps.colorsCompleted[color] = true;

  const bonus = state.colorBonuses[color];
  let kind = null;
  if (bonus.large === null) kind = 'large';
  else if (bonus.small === null) kind = 'small';
  if (!kind) {
    pushEvent(state, { kind: 'color-complete', player: ps.index, color, award: null });
    return 0;
  }

  bonus[kind] = ps.index;
  const points = BONUS_VP[state.playerCount][kind];
  ps.bonusTiles.push({ color, kind, points });
  addVP(state, ps, points, { reason: 'color-bonus', color, kind });
  pushEvent(state, {
    kind: 'color-complete', player: ps.index, color, award: kind, points
  });
  return points;
}

/* ------------------------------------------------------------------ */
/* Tile effects                                                       */
/* ------------------------------------------------------------------ */

function animalScore(state, ps, spaceId) {
  const space = ps.spaces[spaceId];
  const tile = space.tile;
  if (!tile || tile.type !== 'animal') return 0;
  const region = ps.regions[space.regionId];
  let points = tile.count;
  let scoredTiles = 1;
  for (const id of region.spaceIds) {
    if (id === spaceId) continue;
    const other = ps.spaces[id].tile;
    if (other && other.type === 'animal' && other.animal === tile.animal) {
      points += other.count;
      scoredTiles += 1;
    }
  }
  if (hasKnowledge(ps, 7)) points += scoredTiles;
  addVP(state, ps, points, {
    reason: 'animal', animal: tile.animal, count: tile.count,
    tiles: scoredTiles, region: space.regionId
  });
  pushEvent(state, {
    kind: 'animal-score', player: ps.index, animal: tile.animal,
    points, tiles: scoredTiles
  });
  return points;
}

function advanceOrderTrack(state, playerIndex) {
  const index = state.order.indexOf(playerIndex);
  if (index > 0) {
    const tmp = state.order[index - 1];
    state.order[index - 1] = state.order[index];
    state.order[index] = tmp;
    pushEvent(state, {
      kind: 'turn-order', player: playerIndex, from: index, to: index - 1
    });
    return true;
  }
  return false;
}

function takeGoodsFromSpace(state, ps, depotNumber) {
  const space = state.goodsSpaces[depotNumber];
  if (!space || space.length === 0) return 0;
  const remaining = [];
  let taken = 0;
  for (const color of space) {
    if (addGoods(ps, color, 1)) {
      taken += 1;
    } else {
      remaining.push(color);
    }
  }
  state.goodsSpaces[depotNumber] = remaining;
  pushEvent(state, {
    kind: 'ship-goods', player: ps.index, depot: depotNumber, taken
  });
  return taken;
}

function shipEffect(state, ps, goodsDepot, goodsDepot2) {
  const depots = [];
  if (goodsDepot !== undefined && goodsDepot !== null) depots.push(goodsDepot);
  if (hasKnowledge(ps, 5) && goodsDepot2 !== undefined && goodsDepot2 !== null) {
    depots.push(goodsDepot2);
  }
  for (const depotNumber of depots) {
    if (depotNumber >= 1 && depotNumber <= 6) takeGoodsFromSpace(state, ps, depotNumber);
  }
  advanceOrderTrack(state, ps.index);
}

function takeTileFromDepots(state, ps, allowedColors, depth) {
  if (depth > 4) return null;
  for (const layout of DEPOT_LAYOUT) {
    const depot = state.depots[layout.number];
    if (!depot) continue;
    for (const slot of depot.slots) {
      if (slot.tile && allowedColors.indexOf(slot.tile.color) !== -1) {
        const tile = slot.tile;
        slot.tile = null;
        const discard = ps.storage.length >= MAX_STORAGE
          ? ps.storage[0].id
          : undefined;
        putIntoStorage(state, ps, tile, discard);
        pushEvent(state, {
          kind: 'building-take-tile', player: ps.index, building: 'take',
          tile, depot: layout.number
        });
        return tile;
      }
    }
  }
  return null;
}

function firstGoodsDepot(state) {
  for (let n = 1; n <= 6; n += 1) {
    if (state.goodsSpaces[n].length > 0) return n;
  }
  return null;
}

function cityHallPlacement(state, ps, depth) {
  if (depth > 6) return false;
  for (const tile of ps.storage.slice()) {
    for (const space of ps.spaces) {
      if (!canPlace(ps, tile, space.id, space.number, { ignoreNumber: true })) continue;
      const index = ps.storage.findIndex((t) => t.id === tile.id);
      if (index === -1) continue;
      ps.storage.splice(index, 1);
      const shipChoice = tile.type === 'ship'
        ? { goodsDepot: firstGoodsDepot(state), goodsDepot2: null }
        : null;
      placeTileAt(state, ps, tile, space.id, depth + 1, shipChoice);
      return true;
    }
  }
  return false;
}

function applyBuildingEffect(state, ps, tile, depth) {
  switch (tile.building) {
    case 'warehouse':
      sellBestGoods(state, ps);
      break;
    case 'carpenter':
      takeTileFromDepots(state, ps, ['building'], depth);
      break;
    case 'church':
      takeTileFromDepots(state, ps, ['mine', 'knowledge', 'castle'], depth);
      break;
    case 'market':
      takeTileFromDepots(state, ps, ['ship', 'animal'], depth);
      break;
    case 'boardingHouse':
      ps.workers += 4;
      pushEvent(state, { kind: 'building', player: ps.index, building: 'boardingHouse', workers: 4 });
      break;
    case 'bank':
      ps.silver += 2;
      pushEvent(state, { kind: 'building', player: ps.index, building: 'bank', silver: 2 });
      break;
    case 'cityHall':
      cityHallPlacement(state, ps, depth);
      break;
    case 'watchtower':
      addVP(state, ps, 4, { reason: 'building', building: 'watchtower' });
      break;
    default:
      break;
  }
}

function placeTileAt(state, ps, tile, spaceId, depth, shipChoice) {
  const space = ps.spaces[spaceId];
  assert(space && !space.tile, 'space is not empty');
  space.tile = tile;
  pushEvent(state, {
    kind: 'place-tile', player: ps.index, tile, space: spaceId, color: space.color
  });

  if (tile.type === 'castle') {
    state.pendingBonus += 1;
    pushEvent(state, { kind: 'castle-extra-action', player: ps.index });
  } else if (tile.type === 'ship') {
    const choice = shipChoice || {};
    shipEffect(state, ps, choice.goodsDepot, choice.goodsDepot2);
  } else if (tile.type === 'animal') {
    animalScore(state, ps, spaceId);
  } else if (tile.type === 'building') {
    applyBuildingEffect(state, ps, tile, depth + 1);
  } else if (tile.type === 'knowledge') {
    ps.knowledge.push(tile.knowledge);
    pushEvent(state, {
      kind: 'knowledge', player: ps.index, knowledge: tile.knowledge
    });
  }

  completeRegionIfNeeded(state, ps, space.regionId);
  completeColorIfNeeded(state, ps, space.color);
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                      */
/* ------------------------------------------------------------------ */

function goodsDepotChoices(state, ps) {
  const nonEmpty = [];
  for (let n = 1; n <= 6; n += 1) {
    if (state.goodsSpaces[n].length > 0) nonEmpty.push(n);
  }
  if (nonEmpty.length === 0) return [{ goodsDepot: null }];
  if (!hasKnowledge(ps, 5)) return nonEmpty.map((n) => ({ goodsDepot: n }));
  const choices = [];
  for (const first of nonEmpty) {
    choices.push({ goodsDepot: first });
    const left = first === 1 ? 6 : first - 1;
    const right = first === 6 ? 1 : first + 1;
    for (const second of [left, right]) {
      if (state.goodsSpaces[second].length > 0) {
        choices.push({ goodsDepot: first, goodsDepot2: second });
      }
    }
  }
  return choices;
}

function pushAction(out, seen, action) {
  const key = stableStringify(action);
  if (seen.has(key)) return;
  seen.add(key);
  out.push(action);
}

function valueAllowed(state, ps, base, actionType, tile) {
  if (base.bonus) return true;
  const cost = adjustmentCost(state, ps, actionType, tile, ps.dice[base.die], base.value);
  return cost <= ps.workers;
}

function enumerateForValue(state, ps, base, out, seen) {
  const value = base.value;
  const prefix = base.bonus ? { bonus: true } : { type: null, die: base.die };
  const takeAllowed = valueAllowed(state, ps, base, 'takeTile', null);

  // Take a six-sided tile from the depot matching the die value.
  for (const slot of activeDepotSlots(state, value)) {
    if (!takeAllowed) break;
    if (!slot.tile) continue;
    if (ps.storage.length < MAX_STORAGE) {
      pushAction(out, seen, Object.assign({}, prefix, {
        type: 'takeTile', value, tileId: slot.tile.id
      }));
    } else {
      for (const discard of ps.storage) {
        pushAction(out, seen, Object.assign({}, prefix, {
          type: 'takeTile', value, tileId: slot.tile.id, discardTileId: discard.id
        }));
      }
    }
  }

  // Add a stored tile to the estate.
  for (const tile of ps.storage) {
    if (!valueAllowed(state, ps, base, 'placeTile', tile)) continue;
    for (const space of ps.spaces) {
      if (!canPlace(ps, tile, space.id, value)) continue;
      if (tile.type === 'ship') {
        for (const choice of goodsDepotChoices(state, ps)) {
          pushAction(out, seen, Object.assign({}, prefix, {
            type: 'placeTile', value, tileId: tile.id, spaceId: space.id,
            goodsDepot: choice.goodsDepot || null,
            goodsDepot2: choice.goodsDepot2 === undefined ? null : choice.goodsDepot2
          }));
        }
      } else {
        pushAction(out, seen, Object.assign({}, prefix, {
          type: 'placeTile', value, tileId: tile.id, spaceId: space.id
        }));
      }
    }
  }

  // Sell all goods of the colour matching the die value.
  if ((ps.goods[value] || 0) > 0 && valueAllowed(state, ps, base, 'sellGoods', null)) {
    pushAction(out, seen, Object.assign({}, prefix, {
      type: 'sellGoods', value
    }));
  }
}

function enumerateBuy(state, ps, out, seen) {
  if (state.boughtThisTurn || ps.silver < 2) return;
  const targets = state.blackDepot.slice();
  if (hasKnowledge(ps, 6)) {
    for (const layout of DEPOT_LAYOUT) {
      const depot = state.depots[layout.number];
      if (!depot) continue;
      for (const slot of depot.slots) {
        if (slot.tile) targets.push(slot.tile);
      }
    }
  }
  for (const tile of targets) {
    if (ps.storage.length < MAX_STORAGE) {
      pushAction(out, seen, { type: 'buyTile', tileId: tile.id });
    } else {
      for (const discard of ps.storage) {
        pushAction(out, seen, {
          type: 'buyTile', tileId: tile.id, discardTileId: discard.id
        });
      }
    }
  }
}

export function legalActions(state, playerIndex) {
  if (state.phase !== 'play') return [];
  const player = currentPlayer(state);
  if (player === null) return [];
  if (playerIndex !== undefined && playerIndex !== null && playerIndex !== player) return [];
  const ps = state.players[player];
  const out = [];
  const seen = new Set();

  if (state.pendingBonus > 0) {
    for (let value = 1; value <= 6; value += 1) {
      enumerateForValue(state, ps, { bonus: true, value }, out, seen);
    }
    pushAction(out, seen, { type: 'takeWorkers', bonus: true });
    return out;
  }

  enumerateBuy(state, ps, out, seen);

  if (state.actionsThisTurn >= 2) {
    pushAction(out, seen, { type: 'endTurn' });
    return out;
  }

  for (let die = 0; die < 2; die += 1) {
    if (ps.diceUsed[die]) continue;
    for (let value = 1; value <= 6; value += 1) {
      enumerateForValue(state, ps, { bonus: false, die, value }, out, seen);
    }
    pushAction(out, seen, {
      type: 'takeWorkers', die, value: ps.dice[die]
    });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Action execution                                                   */
/* ------------------------------------------------------------------ */

function checkDieAction(state, ps, action) {
  assert(Number.isInteger(action.die) && (action.die === 0 || action.die === 1),
    'die must be 0 or 1');
  assert(!ps.diceUsed[action.die], 'die has already been used');
  assert(state.actionsThisTurn < 2, 'two actions have already been taken');
  assert(state.pendingBonus === 0, 'resolve the castle extra action first');
  assert(Number.isInteger(action.value) && action.value >= 1 && action.value <= 6,
    'value must be 1..6');
}

function spendAdjustment(state, ps, action, tile) {
  const from = ps.dice[action.die];
  const to = action.value;
  const cost = adjustmentCost(state, ps, action.type, tile, from, to);
  assert(cost <= ps.workers, 'not enough workers to adjust the die');
  ps.workers -= cost;
  if (cost > 0) {
    pushEvent(state, {
      kind: 'adjust-die', player: ps.index, die: action.die, from, to, workers: cost
    });
  }
  ps.diceUsed[action.die] = true;
  state.actionsThisTurn += 1;
}

function doTakeTile(state, ps, action) {
  const located = findDepotTile(state, action.tileId);
  assert(located, 'tile is not in a numbered depot');
  assert(located.depot === action.value, 'tile is not in the depot matching the die');
  const tile = located.tile;
  putIntoStorage(state, ps, tile, action.discardTileId);
  located.slot.tile = null;
  pushEvent(state, {
    kind: 'take-tile', player: ps.index, tile, depot: located.depot
  });
}

function doPlaceTile(state, ps, action) {
  const tile = findStorageTile(ps, action.tileId);
  assert(tile, 'tile is not in storage');
  const space = ps.spaces[action.spaceId];
  assert(space, 'space does not exist');
  assert(canPlace(ps, tile, action.spaceId, action.value), 'tile cannot be placed there');
  ps.storage.splice(ps.storage.findIndex((t) => t.id === tile.id), 1);

  if (tile.type === 'ship') {
    const goodsDepot = action.goodsDepot === undefined ? null : action.goodsDepot;
    const goodsDepot2 = action.goodsDepot2 === undefined ? null : action.goodsDepot2;
    placeTileAt(state, ps, tile, action.spaceId, 0, { goodsDepot, goodsDepot2 });
  } else {
    placeTileAt(state, ps, tile, action.spaceId, 0);
  }
}

function doSellGoods(state, ps, action) {
  assert((ps.goods[action.value] || 0) > 0, 'no goods of that colour');
  sellGoods(state, ps, action.value);
}

function doBuyTile(state, ps, action) {
  assert(!state.boughtThisTurn, 'already bought a tile this turn');
  assert(ps.silver >= 2, 'buying requires 2 silver');
  let tile = null;
  const black = findBlackTile(state, action.tileId);
  if (black) {
    tile = black.tile;
    state.blackDepot.splice(black.index, 1);
  } else {
    assert(hasKnowledge(ps, 6), 'knowledge tile 6 is required to buy from a numbered depot');
    const located = findDepotTile(state, action.tileId);
    assert(located, 'tile is not available');
    tile = located.tile;
    located.slot.tile = null;
  }
  ps.silver -= 2;
  putIntoStorage(state, ps, tile, action.discardTileId);
  state.boughtThisTurn = true;
  pushEvent(state, { kind: 'buy-tile', player: ps.index, tile });
}

function finishTurn(state) {
  state.actionsThisTurn = 0;
  state.boughtThisTurn = false;
  state.pendingBonus = 0;
  state.turnIndex += 1;

  if (state.turnIndex < state.playerCount) {
    pushEvent(state, {
      kind: 'turn-start', round: state.round, player: state.roundOrder[state.turnIndex]
    });
    return;
  }

  // All players have acted: advance the round.
  state.roundInPhase += 1;
  if (state.roundInPhase > ROUNDS_PER_PHASE) {
    finishPhase(state);
    return;
  }
  state.round += 1;
  setupRound(state);
}

function finishPhase(state) {
  for (const ps of state.players) {
    const mines = countMines(ps);
    if (mines > 0) {
      ps.silver += mines;
      if (hasKnowledge(ps, 2)) ps.workers += mines;
    }
    pushEvent(state, {
      kind: 'phase-income', player: ps.index, phase: PHASES[state.phaseIndex],
      mines, silver: mines, workers: hasKnowledge(ps, 2) ? mines : 0
    });
  }

  state.phaseIndex += 1;
  if (state.phaseIndex >= PHASES.length) {
    state.phase = 'game-over';
    state.pendingBonus = 0;
    state.winner = null;
    pushEvent(state, { kind: 'game-over', round: state.round });
    state.winner = score(state).winner;
    return;
  }

  state.round = state.phaseIndex * ROUNDS_PER_PHASE + 1;
  state.roundInPhase = 1;
  setupPhase(state);
  setupRound(state);
}

export function applyAction(state, action) {
  assert(state.phase === 'play', 'game is over');
  assert(action && typeof action === 'object', 'action must be an object');
  const next = clone(state);
  const player = currentPlayer(next);
  assert(player !== null, 'no current player');
  const ps = next.players[player];

  if (action.type === 'endTurn') {
    assert(!action.bonus, 'endTurn is not a bonus action');
    assert(next.pendingBonus === 0, 'resolve the castle extra action first');
    assert(next.actionsThisTurn >= 2, 'each turn takes exactly two die actions');
    finishTurn(next);
    return next;
  }

  if (action.type === 'buyTile') {
    assert(!action.bonus, 'buying is not a castle bonus action');
    doBuyTile(next, ps, action);
    return next;
  }

  assert(['takeTile', 'placeTile', 'sellGoods', 'takeWorkers'].indexOf(action.type) !== -1,
    'unknown action type ' + action.type);

  let tile = null;
  if (action.type === 'placeTile') {
    tile = findStorageTile(ps, action.tileId);
    assert(tile, 'tile is not in storage');
  }

  if (action.bonus) {
    assert(next.pendingBonus > 0, 'no castle extra action pending');
    next.pendingBonus -= 1;
  } else {
    checkDieAction(next, ps, action);
    spendAdjustment(next, ps, action, tile);
  }

  switch (action.type) {
    case 'takeTile':
      doTakeTile(next, ps, action);
      break;
    case 'placeTile':
      doPlaceTile(next, ps, action);
      break;
    case 'sellGoods':
      doSellGoods(next, ps, action);
      break;
    case 'takeWorkers':
      gainWorkers(next, ps);
      break;
    default:
      break;
  }

  return next;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

function buildingCounts(ps) {
  const counts = {};
  for (const type of BUILDING_TYPES) counts[type] = 0;
  for (const s of ps.spaces) {
    if (s.tile && s.tile.type === 'building') counts[s.tile.building] += 1;
  }
  return counts;
}

function knowledgeEndScore(ps) {
  const counts = buildingCounts(ps);
  const animalTypes = countAnimalTypes(ps);
  const soldTypes = Object.keys(ps.sold).filter((c) => (ps.sold[c] || 0) > 0).length;
  const soldTiles = Object.keys(ps.sold).reduce((n, c) => n + (ps.sold[c] || 0), 0);
  let total = 0;
  const breakdown = [];

  for (const number of ps.knowledge) {
    let points = 0;
    let label = KNOWLEDGE_INFO[number] || ('知识 #' + number);
    if (number === 15) points = soldTypes * 3;
    else if (number >= 16 && number <= 23) {
      points = counts[KNOWLEDGE_BUILDING[number]] * 4;
    } else if (number === 24) points = animalTypes * 4;
    else if (number === 25) points = soldTiles;
    else if (number === 26) points = ps.bonusTiles.length * 2;
    if (points > 0) {
      total += points;
      breakdown.push({ knowledge: number, label, points });
    }
  }
  return { total, breakdown, soldTypes, soldTiles, animalTypes, buildingCounts: counts };
}

export function scorePlayer(state, playerIndex) {
  const ps = state.players[playerIndex];
  const knowledge = knowledgeEndScore(ps);
  const unsold = goodsTiles(ps);
  const workers = Math.floor(ps.workers / 2);
  const categories = {
    immediate: ps.vp,
    unsoldGoods: unsold,
    silver: ps.silver,
    workers,
    knowledge: knowledge.total
  };
  const total = categories.immediate + categories.unsoldGoods +
    categories.silver + categories.workers + categories.knowledge;

  return {
    index: ps.index,
    name: ps.name,
    total,
    categories,
    details: {
      immediate: ps.vp,
      unsoldGoods: { tiles: unsold, colors: clone(ps.goods) },
      silver: ps.silver,
      workers: { count: ps.workers, points: workers },
      knowledge: knowledge.breakdown,
      emptySpaces: emptySpaces(ps),
      mines: countMines(ps),
      bonusTiles: clone(ps.bonusTiles)
    }
  };
}

export function score(state) {
  const players = state.players.map((ps) => scorePlayer(state, ps.index));
  const ranking = players.slice().sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.details.emptySpaces !== a.details.emptySpaces) {
      return b.details.emptySpaces - a.details.emptySpaces;
    }
    const ai = state.order.indexOf(a.index);
    const bi = state.order.indexOf(b.index);
    return bi - ai;
  });
  const top = ranking.length > 0 ? ranking[0].total : 0;
  const winner = ranking.filter((p) => p.total === top).map((p) => p.index);

  return {
    version: VERSION,
    round: state.round,
    phase: state.phase,
    phaseIndex: state.phaseIndex,
    players,
    ranking,
    winner,
    colorBonuses: clone(state.colorBonuses)
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI                                                          */
/* ------------------------------------------------------------------ */

function buildingValue(building) {
  switch (building) {
    case 'watchtower': return 6;
    case 'bank': return 5;
    case 'boardingHouse': return 5;
    case 'cityHall': return 6;
    case 'warehouse': return 4;
    case 'carpenter': return 4;
    case 'church': return 4;
    case 'market': return 4;
    default: return 3;
  }
}

function tileUsefulness(state, ps, tile) {
  let best = 0;
  for (const space of ps.spaces) {
    if (space.tile || space.color !== tile.color) continue;
    if (!adjacentToFilled(ps, space.id)) continue;
    const region = ps.regions[space.regionId];
    const empty = region.spaceIds.filter((id) => !ps.spaces[id].tile).length;
    let value = 3;
    if (empty === 1) value += 8 + Math.min(8, region.size);
    if (tile.type === 'castle') value += 7;
    if (tile.type === 'knowledge') value += 4;
    if (tile.type === 'mine') value += 3;
    if (tile.type === 'animal') value += 2;
    if (tile.type === 'ship') value += 2;
    if (tile.type === 'building') value += 1;
    best = Math.max(best, value);
  }
  return best;
}

function actionHeuristic(state, action) {
  const player = currentPlayer(state);
  if (player === null) return 0;
  const ps = state.players[player];
  let score = 0;

  if (action.type === 'placeTile') {
    const tile = findStorageTile(ps, action.tileId);
    const space = ps.spaces[action.spaceId];
    if (!tile || !space) return -100;
    score = 10;
    const region = ps.regions[space.regionId];
    const empty = region.spaceIds.filter((id) => !ps.spaces[id].tile).length;
    if (empty === 1) {
      score += 22 + (REGION_SCORE[region.size] || 0) + PHASE_REGION_BONUS[state.phaseIndex];
    }
    if (tile.type === 'castle') score += 16;
    if (tile.type === 'animal') {
      const same = region.spaceIds.reduce((n, id) => {
        const t = ps.spaces[id].tile;
        return n + (t && t.type === 'animal' && t.animal === tile.animal ? t.count : 0);
      }, 0);
      score += 7 + same;
    }
    if (tile.type === 'knowledge') score += 12 + (tile.knowledge >= 15 ? 5 : 1);
    if (tile.type === 'mine') score += 9 + (5 - state.phaseIndex) * 2;
    if (tile.type === 'ship') {
      const goods = state.goodsSpaces[action.goodsDepot] || [];
      score += 9 + goods.length * 3;
    }
    if (tile.type === 'building') score += 8 + buildingValue(tile.building);
    if (action.bonus) score += 2;
  } else if (action.type === 'takeTile') {
    const located = findDepotTile(state, action.tileId);
    if (!located) return -100;
    score = 5 + tileUsefulness(state, ps, located.tile);
    if (ps.storage.length >= MAX_STORAGE) score -= 4;
  } else if (action.type === 'sellGoods') {
    const count = ps.goods[action.value] || 0;
    score = 3 + count * SELL_VP[state.playerCount];
  } else if (action.type === 'takeWorkers') {
    score = ps.workers < 4 ? 7 : 2;
  } else if (action.type === 'buyTile') {
    const located = findBlackTile(state, action.tileId) ||
      findDepotTile(state, action.tileId);
    const tile = located ? located.tile : null;
    score = (ps.silver >= 4 ? 2 : -6) + (tile ? tileUsefulness(state, ps, tile) / 2 : 0);
  } else if (action.type === 'endTurn') {
    score = -1;
  }

  if (action.die !== undefined && !action.bonus) {
    let tile = null;
    if (action.type === 'placeTile') tile = findStorageTile(ps, action.tileId);
    score -= adjustmentCost(state, ps, action.type, tile, ps.dice[action.die], action.value) * 1.5;
  }
  return score;
}

export function chooseGreedyAction(state, actions) {
  const list = actions || legalActions(state);
  let best = null;
  let bestScore = -Infinity;
  let bestKey = '';
  for (const action of list) {
    const score = actionHeuristic(state, action);
    const key = stableStringify(action);
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      best = action;
      bestScore = score;
      bestKey = key;
    }
  }
  return best;
}

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;

  while (next.phase === 'play' && actions < max) {
    const player = currentPlayer(next);
    const list = legalActions(next, player);
    if (list.length === 0) {
      throw new Error('Castles of Burgundy AI: no legal actions for player ' + player);
    }
    const action = opts.choose ? opts.choose(next, list) : chooseGreedyAction(next, list);
    trace.push({
      round: next.round, phase: PHASES[next.phaseIndex], player,
      action: clone(action)
    });
    next = applyAction(next, action);
    actions += 1;
  }

  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('Castles of Burgundy AI: game did not finish within ' + max + ' actions');
  }
  return { state: next, actions, trace };
}

export function selfPlay(opts = {}) {
  const state = createGame(opts);
  return autoPlay(state, opts);
}

/* ------------------------------------------------------------------ */
/* Public data                                                        */
/* ------------------------------------------------------------------ */

export const DATA = Object.freeze({
  VERSION,
  COLORS,
  TILE_TYPES,
  PHASES,
  ROUNDS_PER_PHASE,
  TOTAL_ROUNDS,
  REGION_SCORE,
  PHASE_REGION_BONUS,
  SELL_VP,
  BONUS_VP,
  MAX_STORAGE,
  MAX_GOODS_TYPES,
  BOARD_SPACES,
  REGIONS,
  COLOR_SPACE_COUNTS,
  DEPOT_LAYOUT,
  DEPOT_ACTIVE_SLOTS,
  BUILDING_TYPES,
  BUILDING_INFO,
  ANIMAL_TYPES,
  ANIMAL_NAMES,
  KNOWLEDGE_INFO,
  KNOWLEDGE_BUILDING
});

export default {
  VERSION,
  DATA,
  COLORS,
  PHASES,
  REGION_SCORE,
  PHASE_REGION_BONUS,
  SELL_VP,
  BONUS_VP,
  BOARD_SPACES,
  REGIONS,
  DEPOT_LAYOUT,
  BUILDING_INFO,
  KNOWLEDGE_INFO,
  createGame,
  legalActions,
  applyAction,
  score,
  scorePlayer,
  currentPlayer,
  phaseLetter,
  regionSpaces,
  neighborsOf,
  hasKnowledge,
  countMines,
  countBuildings,
  countAnimalTypes,
  emptySpaces,
  adjustmentCost,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  hashState,
  stableStringify
};
