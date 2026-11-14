/*
 * Agricola (农场主 / 农家乐) — pure rules engine, phase 1 (no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> canonical legal Action[] for the current player
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> 14-category final score / ranking
 *   hashState(state)              -> stable 8-hex digest for replay checks
 *   chooseGreedyAction(state)     -> one legal action for the built-in AI
 *   autoPlay(state, opts)         -> deterministic self-play
 *   selfPlay(opts)                -> createGame + autoPlay
 *
 * Scope: 2–4 player family game (no Occupation / Minor Improvement cards),
 * 14 rounds, official harvest schedule (rounds 4, 7, 9, 11, 13, 14).
 * Rules and every intentional deviation are documented in rules.md.
 *
 * Design constraints
 *   - Zero runtime dependencies, zero DOM.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input, so public operations are pure.
 *   - Every random choice is derived from createGame({seed}); no Math.random.
 */

let ShuffleApi = globalThis.Shuffle;
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  const mod = await import('../../shared/shuffle.js');
  ShuffleApi = mod && typeof mod.shuffle === 'function' ? mod : globalThis.Shuffle;
}
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  throw new Error('AgricolaEngine requires games/shared/shuffle.js');
}

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Board geometry & constants                                         */
/* ------------------------------------------------------------------ */

export const W = 5;
export const H = 3;
export const CELL_COUNT = W * H;

export const MAX_ROUND = 14;
export const HARVEST_ROUNDS = Object.freeze([4, 7, 9, 11, 13, 14]);
export const MAX_FAMILY = 5;
export const MAX_FENCES = 15;
export const MAX_STABLES = 4;
export const MAX_ROOMS_PER_ACTION = 2;
export const MAX_STABLES_PER_ACTION = 2;

/**
 * Per-player storage limit from the brief. Official Agricola has no such
 * per-player cap (only the physical token supply); see rules.md §10.
 * Set createGame({resourceCap: null}) for the official uncapped behaviour.
 */
export const DEFAULT_RESOURCE_CAP = null;
export const CAPPED_RESOURCES = Object.freeze(['wood', 'clay', 'reed', 'stone', 'grain', 'veg']);
export const HOUSE_MATERIALS = Object.freeze(['wood', 'clay', 'stone']);

export const SPACES = Object.freeze({
  forest: Object.freeze({ name: '森林取柴', minRound: 1, kind: 'gain', gain: Object.freeze({ wood: 3 }) }),
  clayPit: Object.freeze({ name: '泥坑取泥', minRound: 1, kind: 'gain', gain: Object.freeze({ clay: 1 }) }),
  reedBank: Object.freeze({ name: '芦苇塘', minRound: 1, kind: 'gain', gain: Object.freeze({ reed: 1 }) }),
  fishing: Object.freeze({ name: '渔场', minRound: 1, kind: 'pool', pool: 'food', replenish: 1 }),
  crafts: Object.freeze({ name: '工艺品制作', minRound: 1, kind: 'pool', pool: 'food', replenish: 1 }),
  market: Object.freeze({
    name: '集市', minRound: 1, kind: 'market',
    gain: Object.freeze({ food: 1 }), choices: Object.freeze(['wood', 'clay', 'reed'])
  }),
  dayLaborer: Object.freeze({ name: '日工', minRound: 1, kind: 'gain', gain: Object.freeze({ food: 2 }) }),
  grainSeeds: Object.freeze({ name: '谷物种子', minRound: 1, kind: 'gain', gain: Object.freeze({ grain: 1 }) }),
  vegetableSeeds: Object.freeze({ name: '蔬菜种子', minRound: 8, kind: 'gain', gain: Object.freeze({ veg: 1 }) }),
  quarry: Object.freeze({ name: '石矿', minRound: 5, kind: 'gain', gain: Object.freeze({ stone: 1 }) }),
  startingPlayer: Object.freeze({
    name: '起始玩家', minRound: 1, kind: 'startingPlayer', gain: Object.freeze({ food: 1 })
  }),
  plow: Object.freeze({ name: '田野耕地', minRound: 1, kind: 'plow' }),
  sow: Object.freeze({ name: '谷物种植', minRound: 1, kind: 'sow' }),
  build: Object.freeze({ name: '扩建农舍', minRound: 1, kind: 'build' }),
  stables: Object.freeze({ name: '建马厩', minRound: 1, kind: 'stables' }),
  fence: Object.freeze({ name: '牧场围栏', minRound: 1, kind: 'fence' }),
  renovate: Object.freeze({ name: '房屋翻新', minRound: 5, kind: 'renovate' }),
  familyGrowth: Object.freeze({
    name: '扩充家庭', minRound: 5, kind: 'familyGrowth', requiresRoom: true
  }),
  familyGrowthNoRoom: Object.freeze({
    name: '扩充家庭（无需房间）', minRound: 12, kind: 'familyGrowth', requiresRoom: false
  }),
  improvement: Object.freeze({ name: '大设施', minRound: 1, kind: 'improvement' }),
  plowAndSow: Object.freeze({ name: '耕地并播种', minRound: 12, kind: 'plowAndSow' }),
  // Simplified 2-player overlay: the official revised edition adds four extra
  // spaces to the 2-player board so both players can keep a farm running.
  plow2: Object.freeze({ name: '第二块耕地', minRound: 1, kind: 'plow' }),
  grainSeeds2: Object.freeze({ name: '第二谷物种子', minRound: 1, kind: 'gain', gain: Object.freeze({ grain: 1 }) }),
  reedBank2: Object.freeze({ name: '第二芦苇塘', minRound: 1, kind: 'gain', gain: Object.freeze({ reed: 1 }) }),
  clayPit2: Object.freeze({ name: '第二泥坑', minRound: 1, kind: 'gain', gain: Object.freeze({ clay: 1 }) }),
  sheep: Object.freeze({ name: '羊市', minRound: 1, kind: 'animals', animal: 'sheep', replenish: 1 }),
  boar: Object.freeze({ name: '野猪市', minRound: 8, kind: 'animals', animal: 'boar', replenish: 1 }),
  cattle: Object.freeze({ name: '牛市', minRound: 10, kind: 'animals', animal: 'cattle', replenish: 1 })
});

export const SPACE_IDS = Object.freeze(Object.keys(SPACES));
export const ANIMAL_TYPES = Object.freeze(['sheep', 'boar', 'cattle']);
export const RESOURCE_KEYS = Object.freeze(['food', 'wood', 'clay', 'reed', 'stone', 'grain', 'veg']);

/**
 * The official family game still uses Major Improvements (it only drops the
 * Occupation and Minor Improvement decks). Phase 1 implements the two clay
 * cooking improvements; the other eight cards are listed in rules.md §12.
 * `cooking` is the food value of one Grain/Vegerable token.
 */
export const MAJOR_IMPROVEMENTS = Object.freeze({
  fireplace: Object.freeze({
    name: '壁炉', cost: Object.freeze({ clay: 2 }), vp: 1, cooking: 2
  }),
  cookingHearth: Object.freeze({
    name: '灶台', cost: Object.freeze({ clay: 3 }), vp: 1, cooking: 3
  }),
  clayOven: Object.freeze({
    name: '泥炉', cost: Object.freeze({ clay: 3, reed: 1 }), vp: 2, cooking: 5
  }),
  stoneOven: Object.freeze({
    name: '石炉', cost: Object.freeze({ stone: 3, reed: 1 }), vp: 3, cooking: 4
  }),
  joinery: Object.freeze({
    name: '细木工坊', cost: Object.freeze({ wood: 2, clay: 1 }), vp: 2, cooking: 1
  }),
  pottery: Object.freeze({
    name: '陶器坊', cost: Object.freeze({ clay: 2, reed: 1 }), vp: 2, cooking: 1
  }),
  basketmaker: Object.freeze({
    name: '编篮坊', cost: Object.freeze({ reed: 2, wood: 1 }), vp: 2, cooking: 1
  })
});
export const IMPROVEMENT_IDS = Object.freeze(Object.keys(MAJOR_IMPROVEMENTS));

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                 */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('Agricola illegal: ' + message);
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export { stableStringify };

export function hashState(state) {
  const text = stableStringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function shuffleWith(array, seed) {
  return ShuffleApi.shuffle(array.slice(), { seed: String(seed) });
}

function idx(x, y) { return y * W + x; }
function coord(i) { return { x: i % W, y: Math.floor(i / W) }; }

function hKey(x, y) { return 'h:' + x + ':' + y; }
function vKey(x, y) { return 'v:' + x + ':' + y; }

function rectCells(x, y, w, h) {
  const out = [];
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) out.push(idx(xx, yy));
  }
  return out;
}

function rectEdges(x, y, w, h) {
  const edges = [];
  for (let i = 0; i < w; i += 1) {
    edges.push(hKey(x + i, y));
    edges.push(hKey(x + i, y + h));
  }
  for (let j = 0; j < h; j += 1) {
    edges.push(vKey(x, y + j));
    edges.push(vKey(x + w, y + j));
  }
  return edges;
}

/** The four edges of one cell, plus the orthogonal neighbour outside it. */
function cellBoundary(i) {
  const { x, y } = coord(i);
  return [
    { edge: hKey(x, y), neighbour: y > 0 ? idx(x, y - 1) : null },
    { edge: hKey(x, y + 1), neighbour: y < H - 1 ? idx(x, y + 1) : null },
    { edge: vKey(x, y), neighbour: x > 0 ? idx(x - 1, y) : null },
    { edge: vKey(x + 1, y), neighbour: x < W - 1 ? idx(x + 1, y) : null }
  ];
}

/** Edge between two orthogonally adjacent cells, or null. */
function edgeBetween(a, b) {
  const A = coord(a);
  const B = coord(b);
  if (A.y === B.y && Math.abs(A.x - B.x) === 1) {
    return vKey(Math.max(A.x, B.x), A.y);
  }
  if (A.x === B.x && Math.abs(A.y - B.y) === 1) {
    return hKey(A.x, Math.max(A.y, B.y));
  }
  return null;
}

function orthogonalNeighbours(i) {
  const { x, y } = coord(i);
  const out = [];
  if (x > 0) out.push(idx(x - 1, y));
  if (x < W - 1) out.push(idx(x + 1, y));
  if (y > 0) out.push(idx(x, y - 1));
  if (y < H - 1) out.push(idx(x, y + 1));
  return out;
}

function makeCell() {
  return { room: false, field: null, stable: false };
}

function emptyHousing() {
  return {
    pasture: { sheep: 0, boar: 0, cattle: 0 },
    stable: { sheep: 0, boar: 0, cattle: 0 },
    pet: { sheep: 0, boar: 0, cattle: 0 }
  };
}

function sumAnimals(counts) {
  return ANIMAL_TYPES.reduce((n, t) => n + (counts[t] || 0), 0);
}

/* ------------------------------------------------------------------ */
/* Farmyard / pasture derivation                                      */
/* ------------------------------------------------------------------ */

/**
 * Enclosed pastures, derived only from the fence edge set.
 * A component of cells (adjacency not blocked by a fence) is a pasture iff
 * every boundary edge of the component carries a fence. Board edges count
 * as boundaries, so they must be fenced too (official rule).
 */
export function computePastures(player) {
  const fences = new Set(player.fences || []);
  const visited = new Array(CELL_COUNT).fill(false);
  const pastures = [];

  for (let start = 0; start < CELL_COUNT; start += 1) {
    if (visited[start]) continue;
    const component = [];
    const queue = [start];
    visited[start] = true;
    while (queue.length > 0) {
      const cell = queue.shift();
      component.push(cell);
      for (const nb of orthogonalNeighbours(cell)) {
        if (visited[nb]) continue;
        const edge = edgeBetween(cell, nb);
        if (fences.has(edge)) continue;
        visited[nb] = true;
        queue.push(nb);
      }
    }

    let enclosed = true;
    for (const cell of component) {
      for (const { edge, neighbour } of cellBoundary(cell)) {
        if (neighbour !== null && component.indexOf(neighbour) !== -1) continue;
        if (!fences.has(edge)) { enclosed = false; break; }
      }
      if (!enclosed) break;
    }

    if (enclosed) {
      const sorted = component.slice().sort((a, b) => a - b);
      const stables = component.filter((i) => player.cells[i].stable).length;
      pastures.push({
        key: 'p:' + sorted.join(','),
        cells: sorted,
        spaces: component.length,
        stables,
        capacity: 2 * component.length * Math.pow(2, stables)
      });
    }
  }
  return pastures;
}

function pastureCellSet(player) {
  const set = new Set();
  for (const p of computePastures(player)) for (const c of p.cells) set.add(c);
  return set;
}

function roomCells(player) {
  return player.cells.map((c, i) => (c.room ? i : -1)).filter((i) => i >= 0);
}

function fieldCells(player) {
  return player.cells.map((c, i) => (c.field ? i : -1)).filter((i) => i >= 0);
}

function stableCells(player) {
  return player.cells.map((c, i) => (c.stable ? i : -1)).filter((i) => i >= 0);
}

function countRooms(player) {
  return roomCells(player).length;
}

function countFields(player) {
  return fieldCells(player).length;
}

function fencedStableCount(player) {
  return computePastures(player).reduce((n, p) => n + p.stables, 0);
}

function unfencedStableCount(player) {
  return stableCells(player).length - fencedStableCount(player);
}

/* ------------------------------------------------------------------ */
/* Resources / housing                                                */
/* ------------------------------------------------------------------ */

export function resourceCapFor(state, key) {
  const cap = state.rules.resourceCap;
  if (cap === null || cap === undefined) return Infinity;
  if (CAPPED_RESOURCES.indexOf(key) === -1) return Infinity;
  if (typeof cap === 'number') return cap;
  return cap[key] === undefined ? Infinity : cap[key];
}

function addResource(state, player, key, amount) {
  const cap = resourceCapFor(state, key);
  const current = player[key];
  // A gain never reduces an over-cap holding constructed outside normal play.
  const next = Math.max(current, Math.min(cap, current + amount));
  const gained = next - current;
  player[key] = next;
  return gained;
}

function canPay(player, costs) {
  for (const key of Object.keys(costs)) {
    if (player[key] < costs[key]) return false;
  }
  return true;
}

function pay(player, costs) {
  for (const key of Object.keys(costs)) {
    if (player[key] < costs[key]) return false;
  }
  for (const key of Object.keys(costs)) player[key] -= costs[key];
  return true;
}

function roomMaterialCost(state) {
  return state.rules.roomCost;
}

function houseUnitCost(state) {
  // Adapted to the brief's 4-token storage cap; official cost is 5 + 2 reed.
  return { material: roomMaterialCost(state), reed: 2 };
}

/**
 * Add `n` animals of `type`, housing them in typed pastures, then untyped
 * pastures, then unfenced stables, then the single house pet slot. Excess is
 * returned to the general supply. Returns {kept, discarded}.
 */
function gainAnimals(ps, type, n) {
  if (n <= 0) return { kept: 0, discarded: 0 };
  const pastures = computePastures(ps);
  let kept = 0;
  let remaining = n;

  // 1. pastures already assigned to this type
  let typedCapacity = 0;
  for (const p of pastures) {
    if (ps.pastureTypes[p.key] === type) typedCapacity += p.capacity;
  }
  let spare = Math.max(0, typedCapacity - ps.housing.pasture[type]);
  let use = Math.min(remaining, spare);
  kept += use;
  remaining -= use;
  ps.housing.pasture[type] += use;

  // 2. claim untyped pastures, deterministic key order
  const untyped = pastures
    .filter((p) => !ps.pastureTypes[p.key])
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const p of untyped) {
    if (remaining <= 0) break;
    ps.pastureTypes[p.key] = type;
    use = Math.min(remaining, p.capacity);
    kept += use;
    remaining -= use;
    ps.housing.pasture[type] += use;
  }

  // 3. unfenced stables (1 animal each)
  const stableSpare = Math.max(0, unfencedStableCount(ps) - sumAnimals(ps.housing.stable));
  use = Math.min(remaining, stableSpare);
  kept += use;
  remaining -= use;
  ps.housing.stable[type] += use;

  // 4. the single pet slot in the house (1 animal total)
  if (remaining > 0 && sumAnimals(ps.housing.pet) === 0) {
    kept += 1;
    remaining -= 1;
    ps.housing.pet[type] += 1;
  }

  ps.animals[type] += kept;
  return { kept, discarded: remaining };
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

function makePlayer(index, name, house, cells, food) {
  return {
    index,
    name,
    food,
    wood: 0,
    clay: 0,
    reed: 0,
    stone: 0,
    grain: 0,
    veg: 0,
    beggarCards: 0,
    family: 2,
    newborns: 0,
    house,
    improvements: [],
    cooking: 1,
    cells,
    fences: [],
    pastureTypes: {},
    animals: { sheep: 0, boar: 0, cattle: 0 },
    housing: emptyHousing(),
    workersThisRound: 0,
    workersLeft: 0
  };
}

function startingCells() {
  const cells = Array.from({ length: CELL_COUNT }, makeCell);
  // Two orthogonally adjacent wooden rooms, exactly as the family game starts.
  cells[idx(0, 0)].room = true;
  cells[idx(1, 0)].room = true;
  return cells;
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert(playerCount === 2 || playerCount === 3 || playerCount === 4,
    'playerCount must be 2, 3 or 4');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;

  const resourceCap = opts.resourceCap === undefined
    ? DEFAULT_RESOURCE_CAP
    : opts.resourceCap;
  assert(resourceCap === null || (Number.isInteger(resourceCap) && resourceCap >= 1),
    'resourceCap must be null or a positive integer');
  assert(resourceCap === null || resourceCap >= 4, 'resourceCap must be at least 4');

  // Official room cost is 5 material + 2 reed. With the brief's 4-token cap
  // a 5-cost room can never be assembled, so the cost follows the cap.
  // Official cost is 5 material + 2 reed, independent of any storage variant.
  const roomCost = opts.roomCost === undefined ? 5 : opts.roomCost;
  assert(Number.isInteger(roomCost) && roomCost >= 1, 'roomCost must be a positive integer');

  // The brief says "one harvest every 4 rounds"; the official schedule is
  // 4/7/9/11/13/14. Official is the default; the brief variant is opt-in.
  const harvestRounds = opts.harvestEvery4
    ? [4, 8, 12]
    : HARVEST_ROUNDS.slice();

  const firstPlayer = shuffleWith(
    Array.from({ length: playerCount }, (_, i) => i),
    seed + ':first'
  )[0];

  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    const food = i === firstPlayer ? 2 : 3;
    players.push(makePlayer(
      i,
      opts.names && opts.names[i] ? opts.names[i] : 'P' + (i + 1),
      'wood',
      startingCells(),
      food
    ));
  }

  const spaces = {};
  for (const id of SPACE_IDS) spaces[id] = { occupiedBy: null, pool: 0 };

  const state = {
    version: VERSION,
    seed,
    playerCount,
    rules: {
      resourceCap,
      roomCost,
      harvestRounds,
      harvestEvery4: !!opts.harvestEvery4,
      familyGame: true
    },
    round: 1,
    phase: 'work',
    firstPlayer,
    nextFirstPlayer: null,
    turnOrder: buildTurnOrder(playerCount, firstPlayer),
    turnCursor: 0,
    players,
    spaces,
    improvements: Object.fromEntries(IMPROVEMENT_IDS.map((id) => [id, null])),
    harvestsDone: [],
    events: [],
    winner: null
  };

  beginRound(state, 1);
  return state;
}

function buildTurnOrder(playerCount, firstPlayer) {
  const order = [];
  for (let i = 0; i < playerCount; i += 1) order.push((firstPlayer + i) % playerCount);
  return order;
}

function replenish(state) {
  for (const id of SPACE_IDS) {
    const def = SPACES[id];
    const space = state.spaces[id];
    space.occupiedBy = null;
    if (def.replenish && state.round >= def.minRound) {
      space.pool += def.replenish;
    }
  }
}

function beginRound(state, round) {
  state.round = round;
  state.phase = 'work';
  state.nextFirstPlayer = null;
  for (const ps of state.players) {
    ps.workersThisRound = round === 1 ? 1 : ps.family;
    ps.workersLeft = ps.workersThisRound;
    ps.newborns = 0;
  }
  replenish(state);
  state.turnOrder = buildTurnOrder(state.playerCount, state.firstPlayer);
  state.turnCursor = 0;
  state.events.push({ kind: 'round-start', round });
  trimEvents(state);
}

function trimEvents(state) {
  if (state.events.length > 400) state.events = state.events.slice(-400);
}

/* ------------------------------------------------------------------ */
/* Queries                                                            */
/* ------------------------------------------------------------------ */

export function currentPlayer(state) {
  if (state.phase !== 'work') return null;
  const idxInOrder = state.turnCursor;
  if (idxInOrder < 0 || idxInOrder >= state.turnOrder.length) return null;
  return state.turnOrder[idxInOrder];
}

export function availableRound(state, spaceId) {
  const def = SPACES[spaceId];
  return !!def && state.round >= def.minRound;
}

function spaceUsable(state, spaceId) {
  return availableRound(state, spaceId) && state.spaces[spaceId].occupiedBy === null;
}

/* ------------------------------------------------------------------ */
/* Legal action enumeration                                           */
/* ------------------------------------------------------------------ */

function simpleAction(spaceId) {
  return { type: 'place', space: spaceId };
}

function roomCellEligible(ps, i, fenced) {
  const c = ps.cells[i];
  if (c.room || c.field || c.stable) return false;
  if (fenced.has(i)) return false;
  return true;
}

function eligibleRoomCells(state, ps) {
  const rooms = roomCells(ps);
  const fenced = pastureCellSet(ps);
  const out = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (!roomCellEligible(ps, i, fenced)) continue;
    if (!orthogonalNeighbours(i).some((j) => rooms.indexOf(j) !== -1)) continue;
    out.push(i);
  }
  return out;
}

function enumerateBuilds(state, ps) {
  if (!spaceUsable(state, 'build')) return [];
  const eligible = eligibleRoomCells(state, ps);
  if (eligible.length === 0) return [];
  const fenced = pastureCellSet(ps);
  const rooms = roomCells(ps);
  const out = [];
  const seen = new Set();

  const canAfford = (n) => {
    const unit = houseUnitCost(state);
    return ps[ps.house] >= unit.material * n && ps.reed >= unit.reed * n;
  };

  for (const cell of eligible) {
    if (!canAfford(1)) break;
    out.push({ type: 'place', space: 'build', rooms: [cell] });
  }
  if (canAfford(2)) {
    // Each new room must touch the existing house or another new room;
    // at least one of the pair must touch the existing house.
    for (const anchor of eligible) {
      for (let b = 0; b < CELL_COUNT; b += 1) {
        if (b === anchor) continue;
        if (!roomCellEligible(ps, b, fenced)) continue;
        const touchesHouse = orthogonalNeighbours(b).some((j) => rooms.indexOf(j) !== -1);
        const touchesAnchor = orthogonalNeighbours(b).indexOf(anchor) !== -1;
        if (!touchesHouse && !touchesAnchor) continue;
        const key = [anchor, b].slice().sort((x, y) => x - y).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ type: 'place', space: 'build', rooms: key.split(',').map(Number) });
      }
    }
  }
  return out;
}

function eligibleStableCells(state, ps) {
  const used = stableCells(ps);
  if (used.length >= MAX_STABLES) return [];
  const out = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const c = ps.cells[i];
    if (c.room || c.field || c.stable) continue;
    out.push(i);
  }
  return out;
}

function enumerateStables(state, ps) {
  if (!spaceUsable(state, 'stables')) return [];
  const eligible = eligibleStableCells(state, ps);
  if (eligible.length === 0) return [];
  const out = [];
  const remaining = MAX_STABLES - stableCells(ps).length;
  if (ps.wood < 2) return [];
  for (const cell of eligible) out.push({ type: 'place', space: 'stables', cells: [cell] });
  if (remaining >= 2 && ps.wood >= 4) {
    for (let a = 0; a < eligible.length; a += 1) {
      for (let b = a + 1; b < eligible.length; b += 1) {
        out.push({ type: 'place', space: 'stables', cells: [eligible[a], eligible[b]] });
      }
    }
  }
  return out;
}

function canPlowCell(state, ps, i) {
  const c = ps.cells[i];
  if (c.room || c.field || c.stable) return false;
  if (pastureCellSet(ps).has(i)) return false;
  const fields = fieldCells(ps);
  if (fields.length === 0) return true;
  return orthogonalNeighbours(i).some((j) => fields.indexOf(j) !== -1);
}

function enumeratePlows(state, ps, spaceId = 'plow') {
  if (!spaceUsable(state, spaceId)) return [];
  const out = [];
  for (let i = 0; i < CELL_COUNT; i += 1) {
    if (canPlowCell(state, ps, i)) out.push({ type: 'place', space: spaceId, cell: i });
  }
  return out;
}

function emptyFields(ps) {
  return fieldCells(ps).filter((i) => ps.cells[i].field.crop === null);
}

function enumerateSows(state, ps) {
  if (!spaceUsable(state, 'sow')) return [];
  const fields = emptyFields(ps);
  if (fields.length === 0) return [];
  const out = [];
  const seen = new Set();
  const push = (plan) => {
    if (plan.length === 0) return;
    const key = plan.map((p) => p.field + ':' + p.crop).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type: 'place', space: 'sow', sow: plan });
  };

  const maxGrain = Math.min(ps.grain, fields.length);
  const maxVeg = Math.min(ps.veg, fields.length);

  for (let n = 1; n <= maxGrain; n += 1) {
    push(fields.slice(0, n).map((field) => ({ field, crop: 'grain' })));
  }
  for (let n = 1; n <= maxVeg; n += 1) {
    push(fields.slice(0, n).map((field) => ({ field, crop: 'veg' })));
  }
  for (let g = 1; g <= maxGrain; g += 1) {
    for (let v = 1; v <= maxVeg; v += 1) {
      if (g + v > fields.length) continue;
      const plan = [];
      for (let i = 0; i < g; i += 1) plan.push({ field: fields[i], crop: 'grain' });
      for (let i = 0; i < v; i += 1) plan.push({ field: fields[g + i], crop: 'veg' });
      push(plan);
    }
  }
  return out;
}

function enumeratePlowAndSow(state, ps) {
  if (!spaceUsable(state, 'plowAndSow')) return [];
  const out = [];
  const maxGrain = ps.grain;
  const maxVeg = ps.veg;
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    if (!canPlowCell(state, ps, cell)) continue;
    const fields = emptyFields(ps).concat([cell]);
    const plans = [[]];
    const g = Math.min(maxGrain, fields.length);
    const v = Math.min(maxVeg, fields.length - g);
    if (g > 0) plans.push(fields.slice(0, g).map((field) => ({ field, crop: 'grain' })));
    if (v > 0) plans.push(fields.slice(0, v).map((field) => ({ field, crop: 'veg' })));
    if (g > 0 && v > 0) {
      const plan = [];
      for (let i = 0; i < g; i += 1) plan.push({ field: fields[i], crop: 'grain' });
      for (let i = 0; i < v; i += 1) plan.push({ field: fields[g + i], crop: 'veg' });
      plans.push(plan);
    }
    const seen = new Set();
    for (const plan of plans) {
      const key = plan.map((x) => x.field + ':' + x.crop).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'place', space: 'plowAndSow', cell, sow: plan });
    }
  }
  return out;
}

function enumerateFences(state, ps) {
  if (!spaceUsable(state, 'fence')) return [];
  const pastures = computePastures(ps);
  const fencedCells = new Set();
  for (const p of pastures) for (const c of p.cells) fencedCells.add(c);
  const existingFences = new Set(ps.fences);
  const hasPastures = pastures.length > 0;
  const out = [];

  for (let h = 1; h <= H; h += 1) {
    for (let w = 1; w <= W; w += 1) {
      for (let y = 0; y + h <= H; y += 1) {
        for (let x = 0; x + w <= W; x += 1) {
          const cells = rectCells(x, y, w, h);
          let ok = true;
          for (const c of cells) {
            const cell = ps.cells[c];
            if (cell.room || cell.field || cell.stable) { ok = false; break; }
            if (fencedCells.has(c)) { ok = false; break; }
          }
          if (!ok) continue;
          if (hasPastures) {
            const adjacent = cells.some((c) => orthogonalNeighbours(c).some((nb) =>
              fencedCells.has(nb) && cells.indexOf(nb) === -1));
            if (!adjacent) continue;
          }
          const edges = rectEdges(x, y, w, h);
          const fresh = edges.filter((e) => !existingFences.has(e));
          if (fresh.length === 0) continue;
          if (ps.fences.length + fresh.length > MAX_FENCES) continue;
          if (fresh.length > ps.wood) continue;
          out.push({ type: 'place', space: 'fence', rect: { x, y, w, h } });
        }
      }
    }
  }
  return out;
}

function enumerateRenovate(state, ps) {
  if (!spaceUsable(state, 'renovate')) return [];
  if (ps.house === 'stone') return [];
  const next = ps.house === 'wood' ? 'clay' : 'stone';
  const need = countRooms(ps) * 1;
  if (ps[next] >= need && ps.reed >= 1) return [simpleAction('renovate')];
  return [];
}

function enumerateFamilyGrowth(state, ps, spaceId) {
  if (ps.family >= MAX_FAMILY) return [];
  if (!spaceUsable(state, spaceId)) return [];
  const def = SPACES[spaceId];
  if (def.requiresRoom && countRooms(ps) <= ps.family) return [];
  return [simpleAction(spaceId)];
}

function enumerateImprovements(state, ps) {
  if (!spaceUsable(state, 'improvement')) return [];
  const out = [];
  for (const id of IMPROVEMENT_IDS) {
    if (state.improvements[id] !== null) continue;
    if (!canPay(ps, MAJOR_IMPROVEMENTS[id].cost)) continue;
    out.push({ type: 'place', space: 'improvement', card: id });
  }
  return out;
}

function enumerateMarket(state, ps) {
  if (!spaceUsable(state, 'market')) return [];
  return SPACES.market.choices.map((resource) => ({
    type: 'place', space: 'market', resource
  }));
}

/** All canonical legal actions for the current player. */
export function legalActions(state, playerIndex) {
  if (state.phase !== 'work') return [];
  const player = playerIndex === undefined || playerIndex === null
    ? currentPlayer(state)
    : playerIndex;
  if (player === null || player === undefined) return [];
  if (player !== currentPlayer(state)) return [];
  const ps = state.players[player];
  const out = [];

  for (const id of SPACE_IDS) {
    const def = SPACES[id];
    if (!spaceUsable(state, id)) continue;
    switch (def.kind) {
      case 'gain':
      case 'startingPlayer':
      case 'animals':
      case 'pool':
        out.push(simpleAction(id));
        break;
      case 'market':
        out.push(...enumerateMarket(state, ps));
        break;
      case 'plow':
        out.push(...enumeratePlows(state, ps, id));
        break;
      case 'sow':
        out.push(...enumerateSows(state, ps));
        break;
      case 'build':
        out.push(...enumerateBuilds(state, ps));
        break;
      case 'stables':
        out.push(...enumerateStables(state, ps));
        break;
      case 'fence':
        out.push(...enumerateFences(state, ps));
        break;
      case 'renovate':
        out.push(...enumerateRenovate(state, ps));
        break;
      case 'familyGrowth':
        out.push(...enumerateFamilyGrowth(state, ps, id));
        break;
      case 'improvement':
        out.push(...enumerateImprovements(state, ps));
        break;
      case 'plowAndSow':
        out.push(...enumeratePlowAndSow(state, ps));
        break;
      default:
        throw new Error('Agricola engine: unknown space kind ' + def.kind);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Action execution                                                   */
/* ------------------------------------------------------------------ */

function doGain(state, ps, spaceId) {
  const def = SPACES[spaceId];
  for (const key of Object.keys(def.gain)) addResource(state, ps, key, def.gain[key]);
  state.events.push({ kind: 'gain', player: ps.index, space: spaceId, gain: clone(def.gain) });
}

function doPool(state, ps, spaceId) {
  const space = state.spaces[spaceId];
  const amount = space.pool;
  space.pool = 0;
  addResource(state, ps, SPACES[spaceId].pool, amount);
  state.events.push({ kind: 'take-pool', player: ps.index, space: spaceId, amount });
}

function doAnimals(state, ps, spaceId) {
  const def = SPACES[spaceId];
  const space = state.spaces[spaceId];
  const available = space.pool;
  space.pool = 0;
  const result = gainAnimals(ps, def.animal, available);
  state.events.push({
    kind: 'take-animals', player: ps.index, space: spaceId,
    available, kept: result.kept, discarded: result.discarded
  });
}

function doMarket(state, ps, action) {
  if (SPACES.market.choices.indexOf(action.resource) === -1) {
    throw new Error('Agricola illegal: market resource must be one of ' + SPACES.market.choices.join('/'));
  }
  addResource(state, ps, 'food', 1);
  addResource(state, ps, action.resource, 1);
  state.events.push({
    kind: 'market', player: ps.index, resource: action.resource, gain: { food: 1, [action.resource]: 1 }
  });
}

function doPlow(state, ps, action) {
  const cell = action.cell;
  assert(Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT, 'plow needs a cell index');
  assert(canPlowCell(state, ps, cell), 'cell ' + cell + ' cannot be plowed');
  ps.cells[cell].field = { crop: null, count: 0 };
  state.events.push({ kind: 'plow', player: ps.index, cell });
}

function doSow(state, ps, action) {
  assert(Array.isArray(action.sow) && action.sow.length > 0, 'sow needs at least one field');
  const used = new Set();
  const usedGrain = { grain: 0, veg: 0 };
  for (const item of action.sow) {
    assert(item && Number.isInteger(item.field), 'sow item needs a field');
    assert(item.crop === 'grain' || item.crop === 'veg', 'sow crop must be grain or veg');
    assert(!used.has(item.field), 'a field may only be sown once');
    const cell = ps.cells[item.field];
    assert(cell && cell.field && cell.field.crop === null, 'field ' + item.field + ' is not empty');
    used.add(item.field);
    usedGrain[item.crop] += 1;
  }
  assert(ps.grain >= usedGrain.grain && ps.veg >= usedGrain.veg, 'not enough seed in supply');
  ps.grain -= usedGrain.grain;
  ps.veg -= usedGrain.veg;
  for (const item of action.sow) {
    ps.cells[item.field].field = {
      crop: item.crop,
      count: item.crop === 'grain' ? 3 : 2
    };
  }
  state.events.push({
    kind: 'sow', player: ps.index, grain: usedGrain.grain, veg: usedGrain.veg,
    fields: action.sow.map((s) => s.field)
  });
}

function doBuild(state, ps, action) {
  assert(Array.isArray(action.rooms) && action.rooms.length >= 1,
    'build needs at least one room');
  assert(action.rooms.length <= MAX_ROOMS_PER_ACTION, 'too many rooms in one action');
  const fenced = pastureCellSet(ps);
  const rooms = roomCells(ps);
  const chosen = new Set();
  for (const cell of action.rooms) {
    assert(roomCellEligible(ps, cell, fenced), 'cell ' + cell + ' cannot host a new room');
    assert(!chosen.has(cell), 'duplicate room cell');
    chosen.add(cell);
  }
  const touchesHouse = action.rooms.some((cell) =>
    orthogonalNeighbours(cell).some((j) => rooms.indexOf(j) !== -1));
  assert(touchesHouse, 'at least one new room must touch the existing house');
  for (const cell of action.rooms) {
    const connected = orthogonalNeighbours(cell).some((j) =>
      rooms.indexOf(j) !== -1 || (chosen.has(j) && j !== cell));
    assert(connected, 'new room ' + cell + ' must touch the house or another new room');
  }
  const unit = houseUnitCost(state);
  const costs = { reed: unit.reed * action.rooms.length };
  costs[ps.house] = unit.material * action.rooms.length;
  assert(pay(ps, costs), 'not enough resources to build room(s)');
  for (const cell of action.rooms) ps.cells[cell].room = true;
  state.events.push({
    kind: 'build-rooms', player: ps.index, cells: action.rooms.slice(), costs
  });
}

function doStables(state, ps, action) {
  assert(Array.isArray(action.cells) && action.cells.length >= 1, 'stables need at least one cell');
  assert(action.cells.length <= MAX_STABLES_PER_ACTION, 'too many stables in one action');
  assert(stableCells(ps).length + action.cells.length <= MAX_STABLES, 'stable limit is 4');
  const chosen = new Set();
  for (const cell of action.cells) {
    assert(Number.isInteger(cell) && cell >= 0 && cell < CELL_COUNT, 'stable needs a cell index');
    assert(!chosen.has(cell), 'duplicate stable cell');
    chosen.add(cell);
    const c = ps.cells[cell];
    assert(c && !c.room && !c.field && !c.stable, 'cell ' + cell + ' cannot host a stable');
  }
  assert(pay(ps, { wood: 2 * action.cells.length }), 'not enough wood for stable(s)');
  for (const cell of action.cells) ps.cells[cell].stable = true;
  state.events.push({ kind: 'build-stables', player: ps.index, cells: action.cells.slice() });
}

function doFence(state, ps, action) {
  const r = action.rect;
  assert(r && Number.isInteger(r.x) && Number.isInteger(r.y) &&
    Number.isInteger(r.w) && Number.isInteger(r.h), 'fence needs a rect');
  assert(r.x >= 0 && r.y >= 0 && r.w >= 1 && r.h >= 1 && r.x + r.w <= W && r.y + r.h <= H,
    'fence rect out of bounds');
  const cells = rectCells(r.x, r.y, r.w, r.h);
  const fenced = pastureCellSet(ps);
  for (const c of cells) {
    const cell = ps.cells[c];
    assert(!cell.room && !cell.field && !cell.stable, 'fences may not enclose rooms, fields or stables');
    assert(!fenced.has(c), 'cell is already fenced');
  }
  if (fenced.size > 0) {
    const adjacent = cells.some((c) => orthogonalNeighbours(c).some((nb) => fenced.has(nb)));
    assert(adjacent, 'new pastures must touch an existing pasture');
  }
  const edges = rectEdges(r.x, r.y, r.w, r.h);
  const fresh = edges.filter((e) => ps.fences.indexOf(e) === -1);
  assert(fresh.length > 0, 'rect adds no new fence');
  assert(ps.fences.length + fresh.length <= MAX_FENCES, 'fence limit is 15');
  assert(pay(ps, { wood: fresh.length }), 'not enough wood for ' + fresh.length + ' fences');
  ps.fences.push(...fresh);
  state.events.push({
    kind: 'build-fences', player: ps.index, rect: clone(r), newFences: fresh.length
  });
}

function doRenovate(state, ps) {
  assert(ps.house !== 'stone', 'house is already stone');
  const next = ps.house === 'wood' ? 'clay' : 'stone';
  const costs = { reed: 1 };
  costs[next] = countRooms(ps);
  assert(pay(ps, costs), 'not enough resources to renovate');
  ps.house = next;
  state.events.push({ kind: 'renovate', player: ps.index, house: next, costs });
}

function doFamilyGrowth(state, ps, spaceId) {
  assert(ps.family < MAX_FAMILY, 'family is already at the maximum of 5');
  const def = SPACES[spaceId];
  if (def.requiresRoom) {
    assert(countRooms(ps) > ps.family, 'family growth requires an empty room');
  }
  ps.family += 1;
  // The 1-food discount only applies when the birth happens in a harvest round.
  if (state.rules.harvestRounds.indexOf(state.round) !== -1) ps.newborns += 1;
  state.events.push({ kind: 'family-growth', player: ps.index, family: ps.family, newborn: ps.newborns });
}

function doPlowAndSow(state, ps, action) {
  doPlow(state, ps, action);
  if (Array.isArray(action.sow) && action.sow.length > 0) doSow(state, ps, action);
  state.events.push({ kind: 'plow-and-sow', player: ps.index, cell: action.cell });
}

function doImprovement(state, ps, action) {
  const id = action.card;
  assert(typeof id === 'string' && MAJOR_IMPROVEMENTS[id], 'unknown major improvement');
  assert(state.improvements[id] === null, 'major improvement already owned');
  const def = MAJOR_IMPROVEMENTS[id];
  assert(canPay(ps, def.cost), 'not enough resources for ' + def.name);
  pay(ps, def.cost);
  state.improvements[id] = ps.index;
  ps.improvements.push(id);
  ps.cooking = Math.max(ps.cooking, def.cooking);
  state.events.push({
    kind: 'improvement', player: ps.index, card: id, costs: clone(def.cost), vp: def.vp
  });
}

function doStartingPlayer(state, ps) {
  addResource(state, ps, 'food', 1);
  state.nextFirstPlayer = ps.index;
  state.events.push({ kind: 'starting-player', player: ps.index });
}

function doSpaceAction(state, ps, action) {
  const spaceId = action.space;
  assert(typeof spaceId === 'string' && SPACES[spaceId], 'unknown space ' + spaceId);
  const def = SPACES[spaceId];
  assert(spaceUsable(state, spaceId), 'space ' + spaceId + ' is not available');

  switch (def.kind) {
    case 'gain': doGain(state, ps, spaceId); break;
    case 'pool': doPool(state, ps, spaceId); break;
    case 'animals': doAnimals(state, ps, spaceId); break;
    case 'startingPlayer': doStartingPlayer(state, ps); break;
    case 'market': doMarket(state, ps, action); break;
    case 'plow': doPlow(state, ps, action); break;
    case 'sow': doSow(state, ps, action); break;
    case 'build': doBuild(state, ps, action); break;
    case 'stables': doStables(state, ps, action); break;
    case 'fence': doFence(state, ps, action); break;
    case 'renovate': doRenovate(state, ps); break;
    case 'familyGrowth': doFamilyGrowth(state, ps, spaceId); break;
    case 'improvement': doImprovement(state, ps, action); break;
    case 'plowAndSow': doPlowAndSow(state, ps, action); break;
    default: throw new Error('Agricola engine: unknown space kind ' + def.kind);
  }

  state.spaces[spaceId].occupiedBy = ps.index;
}

function advanceTurn(state, player) {
  const ps = state.players[player];
  ps.workersLeft -= 1;
  const anyLeft = state.players.some((p) => p.workersLeft > 0);
  if (!anyLeft) {
    endRound(state);
    return;
  }
  const n = state.turnOrder.length;
  for (let step = 1; step <= n; step += 1) {
    const cursor = (state.turnCursor + step) % n;
    if (state.players[state.turnOrder[cursor]].workersLeft > 0) {
      state.turnCursor = cursor;
      return;
    }
  }
}

export function applyAction(state, action) {
  assert(state.phase === 'work', 'the game is not in the work phase');
  assert(action && action.type === 'place', 'action must be {type:"place"}');
  const player = currentPlayer(state);
  assert(player !== null, 'no current player');
  const ps = state.players[player];

  const legal = legalActions(state, player);
  const key = stableStringify(action);
  const found = legal.some((a) => stableStringify(a) === key);
  if (!found) {
    throw new Error('Agricola illegal: action is not legal for player ' + player + ': ' + key);
  }

  const next = clone(state);
  const nextPs = next.players[player];
  doSpaceAction(next, nextPs, clone(action));
  trimEvents(next);
  advanceTurn(next, player);
  return next;
}

/* ------------------------------------------------------------------ */
/* Harvest                                                            */
/* ------------------------------------------------------------------ */

function harvestFields(state, ps) {
  let grain = 0;
  let veg = 0;
  for (const i of fieldCells(ps)) {
    const field = ps.cells[i].field;
    if (!field || field.crop === null || field.count <= 0) continue;
    if (field.crop === 'grain') {
      addResource(state, ps, 'grain', 1);
      grain += 1;
    } else if (field.crop === 'veg') {
      addResource(state, ps, 'veg', 1);
      veg += 1;
    }
    field.count -= 1;
    if (field.count <= 0) {
      field.crop = null;
      field.count = 0;
    }
  }
  return { grain, veg };
}

function feedFamily(state, ps) {
  const required = Math.max(0, 2 * ps.family - ps.newborns);
  let remaining = required;
  const paid = { food: 0, grain: 0, veg: 0 };

  const useFood = Math.min(remaining, ps.food);
  ps.food -= useFood;
  paid.food = useFood;
  remaining -= useFood;

  const rate = ps.cooking || 1;
  if (remaining > 0) {
    while (remaining > 0 && ps.grain > 0) {
      ps.grain -= 1;
      paid.grain += 1;
      remaining -= rate;
      if (remaining < 0) { ps.food += -remaining; remaining = 0; }
    }
  }
  if (remaining > 0) {
    while (remaining > 0 && ps.veg > 0) {
      ps.veg -= 1;
      paid.veg += 1;
      remaining -= rate;
      if (remaining < 0) { ps.food += -remaining; remaining = 0; }
    }
  }

  if (remaining > 0) ps.beggarCards += remaining;
  return { required, paid, begging: remaining };
}

function breedAnimals(state, ps) {
  const bred = { sheep: 0, boar: 0, cattle: 0 };
  const lost = { sheep: 0, boar: 0, cattle: 0 };
  for (const type of ANIMAL_TYPES) {
    if (ps.animals[type] >= 2) {
      const result = gainAnimals(ps, type, 1);
      bred[type] = result.kept;
      lost[type] = result.discarded;
    }
  }
  return { bred, lost };
}

function runHarvest(state) {
  const summary = { round: state.round, players: [] };
  state.harvestsDone.push(state.round);

  for (const ps of state.players) {
    const fields = harvestFields(state, ps);
    const feed = feedFamily(state, ps);
    const breed = breedAnimals(state, ps);
    ps.newborns = 0;
    summary.players.push({
      player: ps.index,
      fields,
      feed,
      breed,
      beggingCards: ps.beggarCards
    });
    state.events.push({
      kind: 'harvest', round: state.round, player: ps.index,
      fields, feed, breed
    });
  }
  state.events.push({ kind: 'harvest-complete', round: state.round, summary: clone(summary) });
  return summary;
}

function endRound(state) {
  const isHarvest = state.rules.harvestRounds.indexOf(state.round) !== -1;
  if (isHarvest) runHarvest(state);

  if (state.round >= MAX_ROUND) {
    state.phase = 'game-over';
    state.winner = determineWinner(state);
    state.events.push({ kind: 'game-over', winner: state.winner.slice() });
    trimEvents(state);
    return;
  }

  if (state.nextFirstPlayer !== null) state.firstPlayer = state.nextFirstPlayer;
  beginRound(state, state.round + 1);
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

function fieldsScore(n) {
  if (n <= 1) return -1;
  return Math.min(4, n - 1);
}

function pasturesScore(n) {
  if (n === 0) return -1;
  return Math.min(4, n);
}

function grainScore(n) {
  if (n === 0) return -1;
  if (n <= 3) return 1;
  if (n <= 5) return 2;
  if (n <= 7) return 3;
  return 4;
}

function vegScore(n) {
  if (n === 0) return -1;
  return Math.min(4, n);
}

function sheepScore(n) {
  if (n === 0) return -1;
  if (n <= 3) return 1;
  if (n <= 5) return 2;
  if (n <= 7) return 3;
  return 4;
}

function boarScore(n) {
  if (n === 0) return -1;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 6) return 3;
  return 4;
}

function cattleScore(n) {
  if (n === 0) return -1;
  if (n === 1) return 1;
  if (n <= 3) return 2;
  if (n <= 5) return 3;
  return 4;
}

function countCrops(player) {
  const counts = { grain: player.grain, veg: player.veg };
  for (const i of fieldCells(player)) {
    const field = player.cells[i].field;
    if (!field || field.crop === null) continue;
    if (field.crop === 'grain') counts.grain += field.count;
    else if (field.crop === 'veg') counts.veg += field.count;
  }
  return counts;
}

export function scorePlayer(state, playerIndex) {
  const ps = state.players[playerIndex];
  const pastures = computePastures(ps);
  const rooms = countRooms(ps);
  const fields = countFields(ps);
  const crops = countCrops(ps);
  const fencedStables = pastures.reduce((n, p) => n + p.stables, 0);
  const cardVp = (ps.improvements || []).reduce((n, id) =>
    n + (MAJOR_IMPROVEMENTS[id] ? MAJOR_IMPROVEMENTS[id].vp : 0), 0);
  const woodenRooms = ps.house === 'wood' ? rooms : 0;
  const clayRooms = ps.house === 'clay' ? rooms : 0;
  const stoneRooms = ps.house === 'stone' ? rooms : 0;

  const used = new Set(roomCells(ps));
  for (const i of fieldCells(ps)) used.add(i);
  for (const i of stableCells(ps)) used.add(i);
  for (const p of pastures) for (const c of p.cells) used.add(c);
  const unused = CELL_COUNT - used.size;

  const categories = {
    fields: fieldsScore(fields),
    pastures: pasturesScore(pastures.length),
    grain: grainScore(crops.grain),
    vegetables: vegScore(crops.veg),
    sheep: sheepScore(ps.animals.sheep),
    boar: boarScore(ps.animals.boar),
    cattle: cattleScore(ps.animals.cattle),
    unusedSpaces: -unused,
    fencedStables: fencedStables,
    rooms: clayRooms * 1 + stoneRooms * 2,
    family: Math.min(15, ps.family * 3),
    begging: -3 * ps.beggarCards,
    cards: cardVp,
    unspentResources: 0
  };

  let total = 0;
  for (const key of Object.keys(categories)) total += categories[key];

  return {
    index: ps.index,
    name: ps.name,
    total,
    categories,
    details: {
      fields: { count: fields, points: categories.fields },
      pastures: {
        count: pastures.length, spaces: pastures.reduce((n, p) => n + p.spaces, 0),
        points: categories.pastures
      },
      grain: { count: crops.grain, supply: ps.grain, onFields: crops.grain - ps.grain, points: categories.grain },
      vegetables: { count: crops.veg, supply: ps.veg, onFields: crops.veg - ps.veg, points: categories.vegetables },
      sheep: { count: ps.animals.sheep, points: categories.sheep },
      boar: { count: ps.animals.boar, points: categories.boar },
      cattle: { count: ps.animals.cattle, points: categories.cattle },
      unusedSpaces: { count: unused, points: categories.unusedSpaces },
      fencedStables: { count: fencedStables, points: categories.fencedStables },
      rooms: {
        wooden: woodenRooms, clay: clayRooms, stone: stoneRooms,
        material: ps.house, points: categories.rooms
      },
      family: { count: ps.family, points: categories.family },
      begging: { count: ps.beggarCards, points: categories.begging },
      cards: { points: categories.cards, improvements: ps.improvements.slice() },
      unspentResources: { points: categories.unspentResources, note: '官方不计未花资源' }
    }
  };
}

function determineWinner(state) {
  const scored = state.players.map((p) => scorePlayer(state, p.index));
  const best = Math.max(...scored.map((s) => s.total));
  return scored.filter((s) => s.total === best).map((s) => s.index);
}

export function score(state) {
  const players = state.players.map((p) => scorePlayer(state, p.index));
  const ranking = players.slice().sort((a, b) => b.total - a.total || a.index - b.index);
  const winner = state.winner ? state.winner.slice()
    : ranking.length === 0 ? []
      : ranking.filter((p) => p.total === ranking[0].total).map((p) => p.index);

  return {
    version: VERSION,
    round: state.round,
    phase: state.phase,
    harvestsDone: state.harvestsDone.slice(),
    players,
    ranking,
    winner
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI                                                          */
/* ------------------------------------------------------------------ */

const RESOURCE_WEIGHT = Object.freeze({
  food: 2.2, wood: 3.0, clay: 2.4, reed: 2.8, stone: 2.0, grain: 3.0, veg: 3.2
});

// Soft working stock used only by the AI. Unlike state.rules.resourceCap it is
// not a rule: it stops the greedy agent from hoarding 7 reed while it still has
// no pasture. The official engine remains uncapped by default.
const AI_SOFT_STOCK = Object.freeze({
  wood: 8, clay: 8, reed: 8, stone: 8, grain: 6, veg: 6
});

function softCapFor(state, key) {
  const hard = resourceCapFor(state, key);
  const soft = AI_SOFT_STOCK[key] === undefined ? Infinity : AI_SOFT_STOCK[key];
  return Math.min(hard, soft);
}

function sownFieldCount(ps) {
  return fieldCells(ps).filter((i) => {
    const f = ps.cells[i].field;
    return f && f.crop !== null && f.count > 0;
  }).length;
}

function edibleForPlan(ps) {
  const rate = ps.cooking || 1;
  return ps.food + (ps.grain + ps.veg + sownFieldCount(ps)) * rate;
}

function foodTargetFor(state, ps) {
  const need = 2 * ps.family;
  const remaining = state.rules.harvestRounds.filter((r) => r >= state.round).length;
  // In the last two harvests, stockpile for both instead of eating hand-to-mouth.
  if (remaining <= 2) return need * Math.max(1, remaining);
  return need;
}

function totalPastureCapacity(ps) {
  return computePastures(ps).reduce((n, p) => n + p.capacity, 0);
}

function totalAnimalCapacity(ps) {
  return totalPastureCapacity(ps) + unfencedStableCount(ps) +
    (sumAnimals(ps.housing.pet) === 0 ? 1 : 0);
}

function hasFenceSite(state, ps) {
  const fenced = pastureCellSet(ps);
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const c = ps.cells[i];
    if (c.room || c.field || c.stable) continue;
    if (fenced.has(i)) continue;
    if (fenced.size === 0) return true;
    if (orthogonalNeighbours(i).some((nb) => fenced.has(nb))) return true;
  }
  return false;
}

function animalCapacityForType(ps, type) {
  const pastures = computePastures(ps);
  let cap = 0;
  for (const p of pastures) {
    if (ps.pastureTypes[p.key] === type) cap += p.capacity;
    else if (!ps.pastureTypes[p.key]) cap += p.capacity;
  }
  const spare = cap - ps.housing.pasture[type];
  const stableSpare = Math.max(0, unfencedStableCount(ps) - sumAnimals(ps.housing.stable));
  const pet = sumAnimals(ps.housing.pet) === 0 ? 1 : 0;
  return Math.max(0, spare) + stableSpare + pet;
}

const FOOD_SPACES = new Set([
  'fishing', 'crafts', 'dayLaborer', 'market', 'grainSeeds', 'vegetableSeeds',
  'startingPlayer'
]);

function isFoodAction(action) {
  return FOOD_SPACES.has(action.space);
}

function immediateFood(state, action) {
  const space = action.space;
  if (space === 'fishing' || space === 'crafts') return state.spaces[space].pool;
  if (space === 'dayLaborer') return 2;
  if (space === 'market') return 1;
  if (space === 'grainSeeds' || space === 'vegetableSeeds') return 1;
  if (space === 'startingPlayer') return 1;
  return 0;
}

const AI_FAMILY_TARGET = 3;

function aiPlan(state, ps) {
  const edible = edibleForPlan(ps);
  const target = foodTargetFor(state, ps);
  const foodUrgent = edible < target;
  const rooms = countRooms(ps);
  const roomSite = eligibleRoomCells(state, ps).length > 0;
  const pastures = computePastures(ps).length;
  const fieldsNow = countFields(ps);
  // Growth to 3 early, then a second room/growth around rounds 8-10 once the
  // farm has at least one pasture and two fields. Never chase a fifth member.
  const growthReady = ps.family < 3 && rooms > ps.family;
  const needsRoom = ps.family < 3 && rooms === ps.family && roomSite &&
    state.round <= 10;
  const capacity = totalAnimalCapacity(ps);
  const housed = sumAnimals(ps.animals);
  const pools = state.spaces.sheep.pool + state.spaces.boar.pool + state.spaces.cattle.pool;
  const animalActions = ['sheep', 'boar', 'cattle'].filter((type) => {
    if (!spaceUsable(state, type)) return false;
    const available = state.spaces[type].pool;
    const cap = animalCapacityForType(ps, type);
    // Taking the whole pool is worth it if at least 2 fit; only skip when the
    // action would leave almost everything in the general supply.
    return available > 0 && (available <= cap || cap >= 2);
  });
  const wantsAnimal = capacity > housed && animalActions.length > 0;
  const hasSite = hasFenceSite(state, ps);
  const wantsFence = pastures < 4 && (pools > 0 || housed > 0) && hasSite;
  const firstPasture = pastures === 0 && (pools > 0 || housed > 0) && hasSite &&
    state.round <= 12;
  const fields = countFields(ps);
  const empty = emptyFields(ps).length;
  const wantsField = fields < 4;
  const wantsSeed = empty > 0 && (ps.grain < 1 || (state.round >= 8 && ps.veg < 1));
  const wantsSow = empty > 0 && (ps.grain > 0 || ps.veg > 0);
  const availableImprovements = IMPROVEMENT_IDS.filter((id) => state.improvements[id] === null);
  const cookingCards = availableImprovements.filter((id) =>
    MAJOR_IMPROVEMENTS[id].cooking > 1 && (MAJOR_IMPROVEMENTS[id].cost.clay || 0) > 0);
  const improvementClayNeed = cookingCards.length === 0 ? 0
    : Math.min.apply(null, cookingCards.map((id) => MAJOR_IMPROVEMENTS[id].cost.clay));
  const wantsImprovement = ps.cooking === 1 && cookingCards.length > 0 && state.round <= 9;
  return {
    foodUrgent, target, rooms, growthReady, needsRoom, pastures, capacity,
    housed, wantsAnimal, animalActions, wantsFence, firstPasture, fields, empty,
    wantsField, wantsSeed, wantsSow, seedCount: ps.grain + ps.veg,
    wantsImprovement, improvementClayNeed
  };
}

function materialGainValue(state, ps, gains) {
  let value = 0;
  for (const key of Object.keys(gains)) {
    const n = gains[key];
    if (key === 'food') { value += n * RESOURCE_WEIGHT.food; continue; }
    const cap = softCapFor(state, key);
    const room = Math.max(0, cap - ps[key]);
    value += Math.min(n, room) * (RESOURCE_WEIGHT[key] || 1);
  }
  return value;
}

function gatherBonus(state, ps, action, plan) {
  const space = action.space;
  let bonus = 0;
  const roomNeed = plan.needsRoom;
  const fenceNeed = plan.pastures < 4 && (plan.pools > 0 || plan.housed > 0) &&
    hasFenceSite(state, ps);
  const roomCost = state.rules.roomCost;

  if (space === 'forest' || (space === 'market' && action.resource === 'wood')) {
    if (roomNeed && ps.wood < roomCost) bonus += 45;
    if (fenceNeed && ps.wood < 4) bonus += 14;
    if (ps.wood >= roomCost && !fenceNeed && !roomNeed) bonus -= 10;
  }
  if (space === 'reedBank' || (space === 'market' && action.resource === 'reed')) {
    if (roomNeed && ps.reed < 2) bonus += 45;
    if (ps.reed >= 2) bonus -= 6;
  }
  if (space === 'clayPit' || (space === 'market' && action.resource === 'clay')) {
    if (plan.wantsImprovement) bonus += 30;
    if (ps.house === 'wood' && ps.clay < countRooms(ps) && ps.reed >= 1) bonus += 8;
  }
  if (space === 'quarry' && ps.house === 'clay' && ps.stone < countRooms(ps)) bonus += 6;
  return bonus;
}

function actionValue(state, action, playerIndex, planInput) {
  const ps = state.players[playerIndex];
  const spaceId = action.space;
  const def = SPACES[spaceId];
  const plan = planInput || aiPlan(state, ps);
  const edible = edibleForPlan(ps);
  const gap = Math.max(0, plan.target - edible);
  const emptyFieldCount = emptyFields(ps).length;
  const fields = countFields(ps);
  const pastures = computePastures(ps).length;

  if (def.kind === 'improvement') {
    const card = MAJOR_IMPROVEMENTS[action.card];
    if (!card) return -20;
    let value = 20 + card.vp * 12;
    if (ps.cooking === 1 && card.cooking > 1) value += 65;
    if (ps.cooking >= card.cooking) value -= 20;
    if (plan.foodUrgent && card.cooking > 1) value += 20;
    return value;
  }
  if (def.kind === 'gain') {
    let value = materialGainValue(state, ps, def.gain);
    if (def.gain.food) value += Math.min(gap, def.gain.food) * 4;
    if (spaceId === 'grainSeeds') {
      value += emptyFieldCount > 0 ? 20 : 0;
      value += ps.grain < 1 ? 10 : 0;
    }
    if (spaceId === 'vegetableSeeds') {
      value += emptyFieldCount > 0 ? 16 : 0;
    }
    return value + gatherBonus(state, ps, action, plan);
  }
  if (def.kind === 'pool') {
    const pool = state.spaces[spaceId].pool;
    return pool * RESOURCE_WEIGHT.food + Math.min(pool, gap) * 4;
  }
  if (def.kind === 'animals') {
    const cap = animalCapacityForType(ps, def.animal);
    const pool = state.spaces[spaceId].pool;
    if (pool <= 0) return -30;
    if (pool > cap && cap < 2) return -25; // nearly everything would be wasted
    const kept = Math.min(pool, cap);
    const before = ps.animals[def.animal];
    const scoreFn = def.animal === 'sheep' ? sheepScore
      : def.animal === 'boar' ? boarScore : cattleScore;
    const marginal = scoreFn(before + kept) - scoreFn(before);
    const diversity = before === 0 ? 5 : 0;
    return 16 + marginal * 12 + diversity;
  }
  if (def.kind === 'market') {
    const resourceRoom = Math.max(0,
      Math.min(1, softCapFor(state, action.resource) - ps[action.resource]));
    const value = RESOURCE_WEIGHT.food + RESOURCE_WEIGHT[action.resource] * resourceRoom +
      Math.min(1, gap) * 4;
    return value + gatherBonus(state, ps, action, plan);
  }
  if (def.kind === 'plow') {
    if (fields >= 5) return -4;
    const marginal = fieldsScore(fields + 1) - fieldsScore(fields);
    return (fields < 4 ? 18 : 14) + marginal * 8 + (fields < 2 ? 4 : 0);
  }
  if (def.kind === 'sow') {
    return 30 + action.sow.length * 6;
  }
  if (def.kind === 'plowAndSow') {
    return 42 + (action.sow ? action.sow.length * 6 : 0);
  }
  if (def.kind === 'build') {
    const rooms = countRooms(ps);
    const roomGain = action.rooms.length;
    const growthNeed = rooms === ps.family && ps.family < 4;
    let value = growthNeed ? 120 : 6;
    value += roomGain * 6;
    if (ps.house !== 'wood') value += 24 + roomGain * 8;
    return value;
  }
  if (def.kind === 'stables') {
    return 14 + action.cells.length * 6 + (pastures > 0 ? 5 : 0);
  }
  if (def.kind === 'fence') {
    if (pastures >= 4) return -2;
    const r = action.rect;
    const cells = r.w * r.h;
    return 20 + cells * 4 + (pastures === 0 ? 24 : 0);
  }
  if (def.kind === 'renovate') {
    return 18 + countRooms(ps) * 4;
  }
  if (def.kind === 'familyGrowth') {
    if (spaceId === 'familyGrowthNoRoom' && state.round >= 12 && ps.family < 5) {
      return plan.foodUrgent ? 20 : 95;
    }
    if (ps.family < 3) return 130;
    return -10;
  }
  if (spaceId === 'startingPlayer') {
    return state.firstPlayer === playerIndex ? 6 : (state.round <= 10 ? 22 : 8);
  }
  return 0;
}

function bestByValue(state, subset, playerIndex, multiplier, plan) {
  let best = null;
  let bestValue = -Infinity;
  let bestKey = '';
  for (const action of subset) {
    const value = actionValue(state, action, playerIndex, plan) * (multiplier || 1);
    const key = stableStringify(action);
    if (value > bestValue || (value === bestValue && key < bestKey)) {
      best = action;
      bestValue = value;
      bestKey = key;
    }
  }
  return best;
}

function fieldCropCounts(ps) {
  let grain = ps.grain;
  let veg = ps.veg;
  for (const i of fieldCells(ps)) {
    const f = ps.cells[i].field;
    if (!f || f.crop === null) continue;
    if (f.crop === 'grain') grain += f.count;
    else if (f.crop === 'veg') veg += f.count;
  }
  return { grain, veg };
}

function quotaPlan(state, ps) {
  const round = state.round;
  const familyTarget = round >= 5 ? 3 : 2;
  let fieldTarget = round <= 3 ? 2 : (round <= 7 ? 4 : 5);
  let pastureTarget = round <= 5 ? 1 : (round <= 9 ? 2 : 4);
  let animalTarget = round <= 6 ? 1 : (round <= 10 ? 2 : 3);
  // 2-player specialization: the first seat leans fields/grain, the second
  // leans animals/pastures. This reduces head-on competition for the same
  // action spaces while both still fill the other categories late.
  if (ps.index === 0) {
    fieldTarget = Math.min(5, fieldTarget + 1);
    pastureTarget = Math.max(1, pastureTarget - 1);
    animalTarget = Math.max(1, animalTarget - 1);
  } else {
    fieldTarget = Math.max(1, fieldTarget - 1);
    pastureTarget += 1;
    animalTarget += 1;
  }
  const crops = fieldCropCounts(ps);
  const grainTarget = round <= 8 ? 2 : 4;
  const vegTarget = round <= 10 ? 1 : 2;
  const types = ANIMAL_TYPES.filter((t) => ps.animals[t] > 0).length;
  const fields = countFields(ps);
  const pastures = computePastures(ps).length;
  const rooms = countRooms(ps);
  const roomSite = eligibleRoomCells(state, ps).length > 0;

  const goals = [
    { id: 'family', deficit: Math.max(0, familyTarget - ps.family), target: familyTarget },
    { id: 'fields', deficit: Math.max(0, fieldTarget - fields), target: fieldTarget },
    { id: 'grain', deficit: Math.max(0, grainTarget - crops.grain), target: grainTarget },
    { id: 'veg', deficit: Math.max(0, vegTarget - crops.veg), target: vegTarget },
    { id: 'pastures', deficit: Math.max(0, pastureTarget - pastures), target: pastureTarget },
    { id: 'animals', deficit: Math.max(0, animalTarget - types), target: animalTarget }
  ].map((g) => {
    const base = g.target > 0 ? g.deficit / g.target : 0;
    return { ...g, ratio: base * (g.id === 'family' ? 2 : 1) };
  })
    .filter((g) => g.deficit > 0);

  goals.sort((a, b) => b.ratio - a.ratio ||
    ['family', 'fields', 'grain', 'veg', 'pastures', 'animals'].indexOf(a.id) -
    ['family', 'fields', 'grain', 'veg', 'pastures', 'animals'].indexOf(b.id));

  return { goals, fields, pastures, rooms, roomSite, crops, familyTarget,
    fieldTarget, pastureTarget, animalTarget, grainTarget, vegTarget, types };
}

function lateScoreValue(state, action, ps) {
  const space = action.space;
  const fields = countFields(ps);
  const pastures = computePastures(ps).length;
  const crops = fieldCropCounts(ps);
  if (space === 'plow' || space === 'plowAndSow') {
    return (fieldsScore(fields + 1) - fieldsScore(fields)) * 10 +
      (action.space === 'plowAndSow' && action.sow ? action.sow.length * 2 : 0) + 2;
  }
  if (space === 'fence') {
    return (pasturesScore(pastures + 1) - pasturesScore(pastures)) * 10 +
      (pastures < 3 ? 14 : 4);
  }
  if (space === 'sheep' || space === 'boar' || space === 'cattle') {
    const type = space;
    const cap = animalCapacityForType(ps, type);
    const pool = state.spaces[space].pool;
    if (pool <= 0 || (pool > cap && cap < 1)) return -50;
    const kept = Math.min(pool, cap);
    const scoreFn = type === 'sheep' ? sheepScore : type === 'boar' ? boarScore : cattleScore;
    const before = ps.animals[type];
    const marginal = scoreFn(before + kept) - scoreFn(before);
    return marginal * 10 + (before === 0 ? 10 : 0);
  }
  if (space === 'grainSeeds' || space === 'grainSeeds2') {
    if (crops.grain < 4) return 9;
    if (crops.grain < 6) return 5;
    return 1;
  }
  if (space === 'vegetableSeeds') {
    if (crops.veg < 2) return 9;
    if (crops.veg < 4) return 5;
    return 1;
  }
  if (space === 'sow') {
    let gain = 0;
    for (const item of action.sow) {
      if (item.crop === 'grain') {
        gain += (grainScore(crops.grain + 2) - grainScore(crops.grain)) * 10;
      } else {
        gain += (vegScore(crops.veg + 1) - vegScore(crops.veg)) * 10;
      }
    }
    return gain + action.sow.length;
  }
  if (space === 'improvement') {
    const card = MAJOR_IMPROVEMENTS[action.card];
    if (!card) return -50;
    let value = card.vp * 10;
    if (ps.cooking === 1 && card.cooking > 1) value += 12;
    return value;
  }
  if (space === 'stables') {
    const fenced = action.cells.some((c) => {
      const { x, y } = coord(c);
      return computePastures(ps).some((p) => p.cells.indexOf(c) !== -1);
    });
    return (fenced ? 6 : 2) + action.cells.length;
  }
  if (space === 'renovate') {
    return countRooms(ps) * (ps.house === 'wood' ? 10 : 20);
  }
  if (space === 'build') {
    return 2 + (ps.house === 'wood' ? 0 : action.rooms.length * 10);
  }
  if (space === 'familyGrowth' || space === 'familyGrowthNoRoom') {
    return 12;
  }
  if (space === 'forest' || (space === 'market' && action.resource === 'wood')) {
    if (ps.wood < 4 && pastures < 4) return 20;
    return 1;
  }
  if (space === 'reedBank' || space === 'reedBank2' ||
      (space === 'market' && action.resource === 'reed')) {
    if (ps.reed < 2 && countRooms(ps) < 4) return 8;
    return 1;
  }
  if (space === 'clayPit' || space === 'clayPit2' ||
      (space === 'market' && action.resource === 'clay')) {
    return 4;
  }
  if (space === 'market') return 4;
  if (space === 'startingPlayer') return 6;
  if (space === 'quarry') return 2;
  return 0;
}

function pickLate(state, list, player) {
  let best = null;
  let bestValue = -Infinity;
  let bestKey = '';
  for (const action of list) {
    const value = lateScoreValue(state, action, state.players[player]);
    const key = stableStringify(action);
    if (value > bestValue || (value === bestValue && key < bestKey)) {
      best = action;
      bestValue = value;
      bestKey = key;
    }
  }
  return bestValue > 0 ? best : null;
}

export function chooseGreedyAction(state, actions) {
  const list = actions || legalActions(state);
  if (list.length === 0) return null;
  const player = currentPlayer(state);
  const ps = state.players[player];
  const plan = aiPlan(state, ps);
  const plan2 = quotaPlan(state, ps);
  const pick = (subset, multiplier) => bestByValue(state, subset, player, multiplier, plan);
  const bySpace = (space) => list.filter((a) => a.space === space);
  const plow = () => {
    const acts = list.filter((a) => a.space === 'plow' || a.space === 'plow2' || a.space === 'plowAndSow');
    return acts.length > 0 ? pick(acts, 1.15) : null;
  };
  const seed = () => {
    const acts = list.filter((a) => a.space === 'grainSeeds' || a.space === 'grainSeeds2' || a.space === 'vegetableSeeds');
    return acts.length > 0 ? pick(acts, 1.2) : null;
  };
  const sow = () => {
    const acts = bySpace('sow');
    return acts.length > 0 ? pick(acts, 1.2) : null;
  };
  const animals = () => {
    const acts = list.filter((a) => plan.animalActions.indexOf(a.space) !== -1);
    return acts.length > 0 ? pick(acts, 1.2) : null;
  };
  const gatherWood = () => {
    const acts = list.filter((a) =>
      a.space === 'forest' || (a.space === 'market' && a.resource === 'wood'));
    return acts.length > 0 && ps.wood < 4 ? pick(acts, 1.2) : null;
  };
  const fence = () => {
    const acts = bySpace('fence');
    if (acts.length > 0) return pick(acts, 1.3);
    return gatherWood();
  };
  let action;

  // 1. Feed the family before anything else.
  if (plan.foodUrgent) {
    const food = list.filter(isFoodAction);
    if (food.length > 0) {
      let best = null;
      let bestGain = -1;
      let bestValue = -Infinity;
      for (const candidate of food) {
        const gain = immediateFood(state, candidate);
        const value = actionValue(state, candidate, player, plan);
        if (gain > bestGain || (gain === bestGain && value > bestValue)) {
          best = candidate;
          bestGain = gain;
          bestValue = value;
        }
      }
      if (best && bestGain > 0) return best;
    }
  }

  // 2. Family growth is the strongest compound investment. While a room is
  //    still missing, save wood/reed instead of spending them on more fences.
  const familyPending = ps.family < plan2.familyTarget;
  if (familyPending) {
    if (plan2.rooms > ps.family) {
      const growth = list.filter((a) =>
        a.space === 'familyGrowth' || a.space === 'familyGrowthNoRoom');
      if (growth.length > 0) return pick(growth, 1.3);
    } else if (plan2.rooms === ps.family && plan2.roomSite && state.round <= 10) {
      const build = bySpace('build');
      if (build.length > 0) return pick(build, 1.2);
      const needWood = ps.wood < state.rules.roomCost;
      const needReed = ps.reed < 2;
      const gather = list.filter((a) =>
        (needWood && (a.space === 'forest' || (a.space === 'market' && a.resource === 'wood'))) ||
        (needReed && (a.space === 'reedBank' || a.space === 'reedBank2' ||
          (a.space === 'market' && a.resource === 'reed'))));
      if (gather.length > 0) return pick(gather, 1.2);
      const sp = bySpace('startingPlayer');
      if (sp.length > 0) return pick(sp, 1);
    }
  }

  // 0. A cooking improvement is the game's food engine.
  if (plan.wantsImprovement) {
    const improvements = bySpace('improvement');
    if (improvements.length > 0) return pick(improvements, 1.4);
    if (ps.clay < plan.improvementClayNeed) {
      const clay = list.filter((a) =>
        a.space === 'clayPit' || a.space === 'clayPit2' || (a.space === 'market' && a.resource === 'clay'));
      if (clay.length > 0) return pick(clay, 1.35);
    }
  }

  // 2a. Round 12+ no-room growth: 3 points for one action and a worker for
  //     the last rounds is the best remaining move when food is safe.
  if (state.round >= 12 && ps.family < 5 && !plan.foodUrgent) {
    const lateCrops = fieldCropCounts(ps);
    const lateGrowth = list.filter((a) => a.space === 'familyGrowthNoRoom');
    if (lateGrowth.length > 0 && lateCrops.grain >= 2) {
      return pick(lateGrowth, 1.4);
    }
  }

  // 2a2. Buy Major Improvements for points once the farm is running.
  if (state.round >= 9 && !plan.foodUrgent) {
    const cards = bySpace('improvement');
    if (cards.length > 0) return pick(cards, 1.5);
  }

  // 2b. From round 10, squeeze direct score from the remaining actions.
  if (state.round >= 10) {
    const late = pickLate(state, list, player);
    if (late) return late;
  }

  // 3. Work the largest unmet quota. This rotates fields, grain, vegetables,
  //    pastures and animals; pastures pause while a family room is pending.
  for (const goal of plan2.goals) {
    if (familyPending && (goal.id === 'pastures' || goal.id === 'animals')) continue;
    if (goal.id === 'family') {
      if (plan2.rooms > ps.family) {
        const growth = list.filter((a) =>
          a.space === 'familyGrowth' || a.space === 'familyGrowthNoRoom');
        if (growth.length > 0) return pick(growth, 1.3);
      }
      if (plan2.rooms === ps.family && plan2.roomSite && state.round <= 10) {
        const build = bySpace('build');
        if (build.length > 0) return pick(build, 1.2);
        const needWood = ps.wood < state.rules.roomCost;
        const needReed = ps.reed < 2;
        const gather = list.filter((a) =>
          (needWood && (a.space === 'forest' || (a.space === 'market' && a.resource === 'wood'))) ||
          (needReed && (a.space === 'reedBank' || (a.space === 'market' && a.resource === 'reed'))));
        if (gather.length > 0) return pick(gather, 1.1);
        const sp = bySpace('startingPlayer');
        if (sp.length > 0) return pick(sp, 1);
      }
    }
    if (goal.id === 'fields') {
      action = plow();
      if (action) return action;
      action = seed();
      if (action) return action;
      action = sow();
      if (action) return action;
    }
    if (goal.id === 'grain') {
      const empty = emptyFields(ps);
      if (empty.length > 0 && ps.grain > 0) {
        action = sow();
        if (action) return action;
      }
      action = seed();
      if (action) return action;
      action = plow();
      if (action) return action;
    }
    if (goal.id === 'veg') {
      const empty = emptyFields(ps);
      if (empty.length > 0 && ps.veg > 0) {
        action = sow();
        if (action) return action;
      }
      action = seed();
      if (action) return action;
      action = plow();
      if (action) return action;
    }
    if (goal.id === 'pastures') {
      action = fence();
      if (action) return action;
      const sp = bySpace('startingPlayer');
      if (sp.length > 0) return pick(sp, 1);
    }
    if (goal.id === 'animals') {
      action = animals();
      if (action) return action;
      action = fence();
      if (action) return action;
    }
  }

  // 3. Last rounds: direct scoring stock.
  if (state.round >= 11) {
    const scoreActions = list.filter((a) => {
      if (a.space === 'improvement') return true;
      if (a.space === 'grainSeeds' || a.space === 'grainSeeds2') return ps.grain < 4;
      if (a.space === 'vegetableSeeds') return ps.veg < 2;
      if (a.space === 'plow' || a.space === 'plow2' || a.space === 'plowAndSow') {
        return plan2.fields < 5;
      }
      if (a.space === 'fence') return plan2.pastures < 4;
      if (a.space === 'sheep' || a.space === 'boar' || a.space === 'cattle') {
        return plan.animalActions.indexOf(a.space) !== -1;
      }
      if (a.space === 'stables' || a.space === 'renovate') return true;
      return false;
    });
    if (scoreActions.length > 0) return pick(scoreActions, 1);
  }

  // 4. General development.
  return pick(list, 1);
}

export const MAX_ACTIONS = 4000;

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;
  while (next.phase === 'work' && actions < max) {
    const player = currentPlayer(next);
    const list = legalActions(next, player);
    if (list.length === 0) {
      throw new Error('Agricola AI: no legal actions for player ' + player);
    }
    const action = opts.choose ? opts.choose(next, list) : chooseGreedyAction(next, list);
    trace.push({ round: next.round, player, action: clone(action) });
    next = applyAction(next, action);
    actions += 1;
  }
  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('Agricola AI: game did not finish within ' + max + ' actions');
  }
  return { state: next, actions, trace };
}

export function selfPlay(opts = {}) {
  const state = createGame(opts);
  return autoPlay(state, opts);
}

/* ------------------------------------------------------------------ */
/* Public data for tests / future UI                                  */
/* ------------------------------------------------------------------ */

export const DATA = Object.freeze({
  W,
  H,
  CELL_COUNT,
  MAX_ROUND,
  HARVEST_ROUNDS,
  MAX_FAMILY,
  MAX_FENCES,
  MAX_STABLES,
  MAX_ROOMS_PER_ACTION,
  MAX_STABLES_PER_ACTION,
  SPACES,
  SPACE_IDS,
  ANIMAL_TYPES,
  MAJOR_IMPROVEMENTS,
  IMPROVEMENT_IDS,
  CAPPED_RESOURCES,
  DEFAULT_RESOURCE_CAP,
  RESOURCE_WEIGHT
});

export default {
  VERSION,
  DATA,
  SPACES,
  MAJOR_IMPROVEMENTS,
  IMPROVEMENT_IDS,
  HARVEST_ROUNDS,
  createGame,
  legalActions,
  applyAction,
  score,
  scorePlayer,
  currentPlayer,
  availableRound,
  computePastures,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  hashState,
  stableStringify
};
