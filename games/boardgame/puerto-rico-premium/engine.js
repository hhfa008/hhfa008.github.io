/*
 * Puerto Rico — pure rules engine, phase 1 (no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> canonical legal Action[] for the current actor
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   advanceState(state)           -> pure helper that resolves automatic phases
 *   score(state)                  -> building VP + shipping VP + large-building bonuses
 *   scorePlayer(state, index)     -> one player's scoring breakdown
 *   hashState(state)              -> stable 8-hex digest for replay checks
 *   currentActor(state)           -> player index that must act, or null
 *   chooseGreedyAction(state[, actions])
 *   autoPlay(state, opts)         -> deterministic self-play
 *   selfPlay(opts)                -> createGame + autoPlay
 *
 * Scope: 2–5 players, base-game roles/buildings, no expansions.
 * Rules and every intentional deviation are documented in rules.md.
 *
 * Design constraints
 *   - Zero runtime dependencies, zero DOM.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input, so public operations are pure.
 *   - Every random choice is derived from createGame({seed}); no Math.random.
 */

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Static data                                                        */
/* ------------------------------------------------------------------ */

export const GOODS = Object.freeze(['corn', 'indigo', 'sugar', 'tobacco', 'coffee']);

export const GOOD_NAMES = Object.freeze({
  corn: '玉米',
  indigo: '靛蓝',
  sugar: '蔗糖',
  tobacco: '烟草',
  coffee: '咖啡'
});

/** Trader's base price per barrel. Corn is worthless without a market. */
export const TRADE_PRICES = Object.freeze({
  corn: 0,
  indigo: 1,
  sugar: 2,
  tobacco: 3,
  coffee: 4
});

export const ROLE_IDS = Object.freeze([
  'settler', 'mayor', 'builder', 'craftsman', 'trader', 'captain', 'prospector'
]);

export const ROLES = Object.freeze({
  settler: Object.freeze({
    name: '开拓者', privilege: '可选择采石场代替种植园', action: '每位玩家可取一块种植园或采石场'
  }),
  mayor: Object.freeze({
    name: '市长', privilege: '从供应区额外拿 1 个殖民者', action: '从殖民船各拿 1 人，然后自由放置'
  }),
  builder: Object.freeze({
    name: '建筑师', privilege: '自己本阶段建建筑少付 1 金币', action: '每位玩家可建 1 栋建筑'
  }),
  craftsman: Object.freeze({
    name: '工匠', privilege: '额外获得 1 金币', action: '所有玩家生产货物'
  }),
  trader: Object.freeze({
    name: '商人', privilege: '自己卖货时额外 +1 金币', action: '每位玩家可卖 1 桶货'
  }),
  captain: Object.freeze({
    name: '船长', privilege: '额外获得 1 胜利点', action: '每位玩家必须尽可能装船'
  }),
  prospector: Object.freeze({
    name: '淘金者', privilege: '获得 1 金币', action: '只有选择者获得 1 金币'
  })
});

/**
 * Base-game buildings. `kind` is production / violet / large.
 * `capacity` is the number of barrels a manned production building can process.
 * `smallProduction` and `largeProduction` drive Guild Hall scoring.
 * `size` is the number of city spaces the building occupies.
 */
export const BUILDING_DEFS = Object.freeze({
  smallIndigo: Object.freeze({
    name: '小靛蓝厂', cost: 1, vp: 1, kind: 'production',
    crop: 'indigo', capacity: 1, size: 1, smallProduction: true
  }),
  smallSugar: Object.freeze({
    name: '小蔗糖厂', cost: 2, vp: 1, kind: 'production',
    crop: 'sugar', capacity: 1, size: 1, smallProduction: true
  }),
  indigoPlant: Object.freeze({
    name: '靛蓝厂', cost: 3, vp: 2, kind: 'production',
    crop: 'indigo', capacity: 3, size: 1, largeProduction: true
  }),
  sugarMill: Object.freeze({
    name: '蔗糖厂', cost: 4, vp: 2, kind: 'production',
    crop: 'sugar', capacity: 3, size: 1, largeProduction: true
  }),
  tobaccoStorage: Object.freeze({
    name: '烟草仓库', cost: 5, vp: 2, kind: 'production',
    crop: 'tobacco', capacity: 3, size: 1, largeProduction: true
  }),
  coffeeRoaster: Object.freeze({
    name: '咖啡烘焙厂', cost: 6, vp: 2, kind: 'production',
    crop: 'coffee', capacity: 2, size: 1, largeProduction: true
  }),

  smallMarket: Object.freeze({
    name: '小市场', cost: 1, vp: 1, kind: 'violet', size: 1, effect: 'market1'
  }),
  hacienda: Object.freeze({
    name: '大农场', cost: 2, vp: 1, kind: 'violet', size: 1, effect: 'hacienda'
  }),
  constructionHut: Object.freeze({
    name: '建筑小屋', cost: 2, vp: 1, kind: 'violet', size: 1, effect: 'constructionHut'
  }),
  smallWarehouse: Object.freeze({
    name: '小仓库', cost: 3, vp: 1, kind: 'violet', size: 1, effect: 'warehouse1'
  }),
  hospice: Object.freeze({
    name: '收容所', cost: 4, vp: 2, kind: 'violet', size: 1, effect: 'hospice'
  }),
  office: Object.freeze({
    name: '办公室', cost: 5, vp: 2, kind: 'violet', size: 1, effect: 'office'
  }),
  largeMarket: Object.freeze({
    name: '大市场', cost: 5, vp: 2, kind: 'violet', size: 1, effect: 'market2'
  }),
  largeWarehouse: Object.freeze({
    name: '大仓库', cost: 6, vp: 2, kind: 'violet', size: 1, effect: 'warehouse2'
  }),
  factory: Object.freeze({
    name: '工厂', cost: 7, vp: 3, kind: 'violet', size: 1, effect: 'factory'
  }),
  university: Object.freeze({
    name: '大学', cost: 8, vp: 3, kind: 'violet', size: 1, effect: 'university'
  }),
  harbor: Object.freeze({
    name: '港口', cost: 8, vp: 3, kind: 'violet', size: 1, effect: 'harbor'
  }),
  wharf: Object.freeze({
    name: '码头', cost: 9, vp: 3, kind: 'violet', size: 1, effect: 'wharf'
  }),

  guildHall: Object.freeze({
    name: '公会厅', cost: 10, vp: 4, kind: 'large', size: 2, effect: 'guildHall'
  }),
  residence: Object.freeze({
    name: '官邸', cost: 10, vp: 4, kind: 'large', size: 2, effect: 'residence'
  }),
  fortress: Object.freeze({
    name: '堡垒', cost: 10, vp: 4, kind: 'large', size: 2, effect: 'fortress'
  }),
  customsHouse: Object.freeze({
    name: '海关', cost: 10, vp: 4, kind: 'large', size: 2, effect: 'customsHouse'
  }),
  cityHall: Object.freeze({
    name: '市政厅', cost: 10, vp: 4, kind: 'large', size: 2, effect: 'cityHall'
  })
});

export const BUILDING_IDS = Object.freeze(Object.keys(BUILDING_DEFS));

export const LARGE_BUILDING_IDS = Object.freeze(
  BUILDING_IDS.filter((id) => BUILDING_DEFS[id].kind === 'large')
);

/**
 * Physical tile supply (base game). Production: 4+4 small, 3 each large.
 * Violet: 2 of each small type, 1 of each large type. Total 49 tiles.
 */
export const BUILDING_SUPPLY = Object.freeze({
  smallIndigo: 4, smallSugar: 4,
  indigoPlant: 3, sugarMill: 3, tobaccoStorage: 3, coffeeRoaster: 3,
  smallMarket: 2, hacienda: 2, constructionHut: 2, smallWarehouse: 2,
  hospice: 2, office: 2, largeMarket: 2, largeWarehouse: 2,
  factory: 2, university: 2, harbor: 2, wharf: 2,
  guildHall: 1, residence: 1, fortress: 1, customsHouse: 1, cityHall: 1
});

/** Crop tiles in the face-down plantation stack (quarries are separate). */
export const PLANTATION_COUNTS = Object.freeze({
  corn: 10, indigo: 12, sugar: 11, tobacco: 9, coffee: 8
});

export const QUARRY_SUPPLY = 8;
export const ISLAND_SPACES = 12;
export const CITY_SPACES = 12;

/** Starting doubloons by player count. The 2-player variant uses 3 each. */
export const START_DOUBLOONS = Object.freeze({ 2: 3, 3: 2, 4: 3, 5: 4 });

export const COLONIST_TOTAL = Object.freeze({ 2: 40, 3: 55, 4: 75, 5: 95 });
export const VP_CHIP_TOTAL = Object.freeze({ 2: 65, 3: 75, 4: 100, 5: 122 });

/** Cargo ships: 3 ships, one good type each. */
export const SHIP_CAPACITIES = Object.freeze({
  2: Object.freeze([4, 5, 6]),
  3: Object.freeze([4, 5, 6]),
  4: Object.freeze([5, 6, 7]),
  5: Object.freeze([6, 7, 8])
});

/**
 * Starting plantations by position in the turn order. The governor always
 * receives the first entry (indigo); the 2-player variant gives the second
 * player a corn plantation.
 */
export const STARTING_CROPS = Object.freeze({
  2: Object.freeze(['indigo', 'corn']),
  3: Object.freeze(['indigo', 'indigo', 'corn']),
  4: Object.freeze(['indigo', 'indigo', 'corn', 'corn']),
  5: Object.freeze(['indigo', 'indigo', 'indigo', 'corn', 'corn'])
});

/** Factory doubloons by number of different goods produced. */
export const FACTORY_GOLD = Object.freeze([0, 0, 1, 2, 3, 5]);

/**
 * Maximum quarry discount by printed building cost. The four building
 * columns cap the discount at 1/2/3/4; the Builder privilege stacks on top.
 */
export const QUARRY_DISCOUNT_CAP = Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 4, 4]);

export const DEFAULT_MAX_ROUNDS = 50;
export const EVENT_LIMIT = 500;

/* ------------------------------------------------------------------ */
/* Small utilities                                                    */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('PuertoRico: ' + message);
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

/** FNV-1a seed expansion + mulberry32. Same seed string -> same stream. */
function makeRng(seedText) {
  let h = 2166136261;
  const text = String(seedText);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(array, seedText) {
  const rng = makeRng(seedText);
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function logEvent(state, event) {
  state.events.push(event);
  if (state.events.length > EVENT_LIMIT) {
    state.events = state.events.slice(-EVENT_LIMIT);
  }
}

function buildTurnOrder(playerCount, firstPlayer) {
  const order = [];
  for (let i = 0; i < playerCount; i += 1) {
    order.push((firstPlayer + i) % playerCount);
  }
  return order;
}

function rotate(array, start) {
  return array.slice(start).concat(array.slice(0, start));
}

/* ------------------------------------------------------------------ */
/* Setup                                                              */
/* ------------------------------------------------------------------ */

function makePlayer(index, name, doubloons) {
  return {
    index,
    name,
    doubloons,
    vpChips: 0,
    sanJuan: 1,
    goods: { corn: 0, indigo: 0, sugar: 0, tobacco: 0, coffee: 0 },
    island: Array.from({ length: ISLAND_SPACES }, () => null),
    citySlots: Array.from({ length: CITY_SPACES }, () => null),
    buildings: {}
  };
}

function makePlantationBag(seed, startingCrops) {
  const counts = {};
  for (const crop of GOODS) counts[crop] = PLANTATION_COUNTS[crop];
  // The starting plantations are physically taken from the same supply.
  for (const crop of startingCrops) counts[crop] -= 1;
  const tiles = [];
  for (const crop of GOODS) {
    for (let i = 0; i < counts[crop]; i += 1) tiles.push(crop);
  }
  return shuffleWith(tiles, seed + ':plantations');
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert(playerCount >= 2 && playerCount <= 5, 'playerCount must be 2, 3, 4 or 5');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;
  const maxRounds = opts.maxRounds === undefined ? DEFAULT_MAX_ROUNDS : opts.maxRounds;
  assert(Number.isInteger(maxRounds) && maxRounds >= 1, 'maxRounds must be a positive integer');

  const firstPlayer = shuffleWith(
    Array.from({ length: playerCount }, (_, i) => i),
    String(seed) + ':first'
  )[0];
  const turnOrder = buildTurnOrder(playerCount, firstPlayer);
  const startingCrops = STARTING_CROPS[playerCount];
  const startDoubloons = START_DOUBLOONS[playerCount];

  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    players.push(makePlayer(
      i,
      opts.names && opts.names[i] ? opts.names[i] : 'P' + (i + 1),
      startDoubloons
    ));
  }

  // Starting plantations and colonists are assigned by turn-order position.
  for (let pos = 0; pos < playerCount; pos += 1) {
    const player = players[turnOrder[pos]];
    player.island[0] = { type: startingCrops[pos], manned: true };
  }

  const bag = makePlantationBag(seed, startingCrops);
  const rowSize = playerCount + 1;
  const row = bag.splice(0, rowSize);

  const colonistShip = playerCount;
  const colonistTotal = COLONIST_TOTAL[playerCount];
  const onBoards = playerCount * 2; // one on the starting plantation, one in San Juan
  const supplyColonists = colonistTotal - onBoards - colonistShip;

  const buildingsSupply = {};
  for (const id of BUILDING_IDS) buildingsSupply[id] = BUILDING_SUPPLY[id];

  const ships = SHIP_CAPACITIES[playerCount].map((capacity) => ({
    capacity, good: null, count: 0
  }));

  const state = {
    version: VERSION,
    seed,
    playerCount,
    rules: {
      maxRounds,
      colonistTotal,
      vpChipTotal: VP_CHIP_TOTAL[playerCount],
      storageBase: 1,
      officialBaseGame: true,
      // The brief's end condition is "large buildings sold out or colonists
      // exhausted". The official VP-chip exhaustion ending is opt-in.
      endOnVpExhausted: !!opts.endOnVpExhausted
    },
    round: 1,
    generation: 1,
    phase: 'roleChoice',
    governor: firstPlayer,
    turnOrder,
    chosenRoles: [],
    chosenBy: [],
    roleChooserCursor: 0,
    roleChooser: null,
    activeRole: null,
    roleOrder: [],
    roleCursor: 0,
    roleStep: 'select',
    players,
    plantations: {
      bag,
      row,
      discard: [],
      reshuffleCount: 0
    },
    buildingsSupply,
    ships,
    tradingHouse: [],
    supply: {
      colonists: supplyColonists,
      vpChips: VP_CHIP_TOTAL[playerCount],
      quarries: QUARRY_SUPPLY,
      colonistShip
    },
    events: [],
    winner: null,
    champion: null,
    endReason: null,
    stats: { actions: 0, rolesPlayed: 0 }
  };

  logEvent(state, {
    kind: 'setup', seed, playerCount, governor: firstPlayer,
    startingCrops: turnOrder.map((pi, pos) => ({
      player: pi, crop: startingCrops[pos]
    }))
  });
  return state;
}

/* ------------------------------------------------------------------ */
/* State queries                                                      */
/* ------------------------------------------------------------------ */

export function playerOf(state, index) {
  return state.players[index];
}

export function citySlotsUsed(player) {
  return player.citySlots.reduce((n, slot) => n + (slot ? 1 : 0), 0);
}

export function cityFreeSlots(player) {
  return CITY_SPACES - citySlotsUsed(player);
}

export function filledIslandSpaces(player) {
  return player.island.reduce((n, tile) => n + (tile ? 1 : 0), 0);
}

export function emptyIslandIndexes(player) {
  const out = [];
  for (let i = 0; i < player.island.length; i += 1) {
    if (player.island[i] === null) out.push(i);
  }
  return out;
}

export function totalGoods(player) {
  return GOODS.reduce((n, good) => n + player.goods[good], 0);
}

export function totalColonists(player) {
  let n = player.sanJuan;
  for (const tile of player.island) if (tile && tile.manned) n += 1;
  for (const id of Object.keys(player.buildings)) {
    if (player.buildings[id].manned) n += 1;
  }
  return n;
}

export function hasBuilding(player, type) {
  return !!player.buildings[type];
}

export function hasMannedBuilding(player, type) {
  return !!(player.buildings[type] && player.buildings[type].manned);
}

export function countMannedPlantations(player, crop) {
  return player.island.reduce((n, tile) =>
    n + (tile && tile.type === crop && tile.manned ? 1 : 0), 0);
}

export function countMannedQuarries(player) {
  return player.island.reduce((n, tile) =>
    n + (tile && tile.type === 'quarry' && tile.manned ? 1 : 0), 0);
}

export function productionCapacity(player, crop) {
  let capacity = 0;
  for (const id of Object.keys(player.buildings)) {
    const def = BUILDING_DEFS[id];
    const building = player.buildings[id];
    if (def.kind === 'production' && def.crop === crop && building.manned) {
      capacity += def.capacity;
    }
  }
  return capacity;
}

export function tradePrice(player, good, chooser) {
  assert(TRADE_PRICES[good] !== undefined, 'unknown good ' + good);
  let price = TRADE_PRICES[good];
  if (hasMannedBuilding(player, 'smallMarket')) price += 1;
  if (hasMannedBuilding(player, 'largeMarket')) price += 2;
  if (chooser === player.index) price += 1;
  return price;
}

export function quarryDiscount(player, cost) {
  const cap = QUARRY_DISCOUNT_CAP[Math.max(0, Math.min(9, cost - 1))];
  return Math.min(countMannedQuarries(player), cap);
}

export function effectiveBuildingCost(state, player, type) {
  const def = BUILDING_DEFS[type];
  assert(def, 'unknown building ' + type);
  let discount = quarryDiscount(player, def.cost);
  if (state.activeRole === 'builder' && state.roleChooser === player.index) {
    discount += 1;
  }
  return Math.max(0, def.cost - discount);
}

export function tradingHouseEntry(state, good) {
  return state.tradingHouse.find((entry) => entry.good === good) || null;
}

export function tradingHouseFull(state) {
  return state.tradingHouse.length >= 4;
}

function actorOf(state) {
  if (state.phase === 'roleChoice') {
    return state.turnOrder[state.roleChooserCursor] === undefined
      ? null : state.turnOrder[state.roleChooserCursor];
  }
  if (state.phase === 'role') {
    return state.roleOrder[state.roleCursor] === undefined
      ? null : state.roleOrder[state.roleCursor];
  }
  return null;
}

export function currentActor(state) {
  const s = advanceState(state);
  return actorOf(s);
}

export const currentPlayer = currentActor;

/* ------------------------------------------------------------------ */
/* Plantation bag / row                                               */
/* ------------------------------------------------------------------ */

function reshuffleDiscard(state) {
  if (state.plantations.discard.length === 0) return false;
  state.plantations.reshuffleCount += 1;
  state.plantations.bag = shuffleWith(
    state.plantations.discard,
    String(state.seed) + ':reshuffle:' + state.plantations.reshuffleCount
  );
  state.plantations.discard = [];
  return true;
}

function drawFromBag(state, count) {
  const out = [];
  while (out.length < count) {
    if (state.plantations.bag.length === 0 && !reshuffleDiscard(state)) break;
    out.push(state.plantations.bag.shift());
  }
  return out;
}

/** Hacienda draws blind from the face-down stack; discards are not reshuffled. */
function drawBlind(state) {
  if (state.plantations.bag.length === 0) return null;
  return state.plantations.bag.shift();
}

function refillPlantationRow(state) {
  state.plantations.discard.push(...state.plantations.row);
  state.plantations.row = [];
  const drawn = drawFromBag(state, state.playerCount + 1);
  state.plantations.row = drawn;
  logEvent(state, {
    kind: 'plantation-row-refill',
    row: drawn.slice(),
    bag: state.plantations.bag.length,
    discard: state.plantations.discard.length
  });
}

/* ------------------------------------------------------------------ */
/* Colonist / VP helpers                                              */
/* ------------------------------------------------------------------ */

function takeColonistsFromSupply(state, count) {
  const take = Math.min(count, state.supply.colonists);
  state.supply.colonists -= take;
  return take;
}

function gainVp(state, player, amount) {
  const take = Math.min(amount, state.supply.vpChips);
  state.supply.vpChips -= take;
  player.vpChips += take;
  return take;
}

function placeIslandTile(player, type, manned) {
  const index = player.island.indexOf(null);
  assert(index !== -1, 'no empty island space');
  player.island[index] = { type, manned: !!manned };
  return index;
}

function takeHospiceColonist(state) {
  if (state.supply.colonists > 0) {
    state.supply.colonists -= 1;
    return true;
  }
  if (state.supply.colonistShip > 0) {
    state.supply.colonistShip -= 1;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Role flow                                                          */
/* ------------------------------------------------------------------ */

function logRoundState(state, role, player) {
  logEvent(state, { kind: 'choose-role', round: state.round, player, role });
}

/**
 * Resolve every phase that has no player decision. This is the single place
 * that moves from one decision point to the next. It mutates its argument.
 */
function advanceInPlace(state) {
  let guard = 0;
  while (guard < 20000) {
    guard += 1;
    if (state.phase === 'game-over') return state;
    if (state.phase === 'roleChoice') return state;
    if (state.phase !== 'role') return state;

    if (!state.activeRole) {
      state.phase = 'roleChoice';
      return state;
    }

    if (state.roleCursor >= state.roleOrder.length) {
      completeRole(state);
      continue;
    }

    if (state.roleStep === 'ship') {
      const player = state.players[state.roleOrder[state.roleCursor]];
      const actions = enumerateShip(state, player);
      if (actions.length === 0) {
        logEvent(state, { kind: 'ship-pass', player: player.index, round: state.round });
        state.roleCursor += 1;
        continue;
      }
      return state;
    }

    if (state.roleStep === 'mayorPlace') {
      const player = state.players[state.roleOrder[state.roleCursor]];
      if (!hasMayorDecision(player)) {
        logEvent(state, { kind: 'mayor-finish', player: player.index, round: state.round });
        state.roleCursor += 1;
        continue;
      }
      return state;
    }

    // settle / build / sell always include a voluntary pass, so a decision exists.
    return state;
  }
  throw new Error('PuertoRico: automatic advance did not converge');
}

export function advanceState(state) {
  const next = clone(state);
  advanceInPlace(next);
  return next;
}

function hasPlacementTarget(player) {
  for (const tile of player.island) {
    if (tile && !tile.manned) return true;
  }
  for (const id of Object.keys(player.buildings)) {
    if (!player.buildings[id].manned) return true;
  }
  return false;
}

/**
 * The Mayor phase allows a full reallocation of every colonist, not just the
 * newly arriving ones. A decision is needed while the player has an idle
 * colonist plus an empty slot, or any employed colonist that can be picked up.
 */
function hasMayorDecision(player) {
  if (player.sanJuan > 0 && hasPlacementTarget(player)) return true;
  for (const tile of player.island) {
    if (tile && tile.manned) return true;
  }
  for (const id of Object.keys(player.buildings)) {
    if (player.buildings[id].manned) return true;
  }
  return false;
}

function finishRoleEffect(state, role) {
  if (role === 'settler') {
    refillPlantationRow(state);
    return;
  }
  if (role === 'mayor') {
    let emptyCircles = 0;
    for (const player of state.players) {
      for (const id of Object.keys(player.buildings)) {
        if (!player.buildings[id].manned) emptyCircles += 1;
      }
    }
    const want = Math.max(state.playerCount, emptyCircles);
    const got = takeColonistsFromSupply(state, want);
    // The rule puts new colonists on the ship; any colonists left from the
    // previous Mayor phase stay there.
    state.supply.colonistShip += got;
    logEvent(state, {
      kind: 'colonist-ship-refill',
      want, got, emptyCircles,
      ship: state.supply.colonistShip,
      supply: state.supply.colonists
    });
    return;
  }
  if (role === 'trader') {
    if (state.tradingHouse.length >= 4) {
      logEvent(state, { kind: 'trading-house-empty', goods: clone(state.tradingHouse) });
      state.tradingHouse = [];
    }
    return;
  }
  if (role === 'captain') {
    const storage = [];
    for (const player of state.players) {
      storage.push({ player: player.index, ...storeGoods(state, player) });
    }
    logEvent(state, { kind: 'captain-storage', storage: clone(storage) });
    for (const ship of state.ships) {
      ship.good = null;
      ship.count = 0;
    }
    logEvent(state, { kind: 'ships-empty' });
  }
}

function completeRole(state) {
  const role = state.activeRole;
  assert(role, 'completeRole called without an active role');
  finishRoleEffect(state, role);
  logEvent(state, { kind: 'role-end', role, round: state.round });
  state.activeRole = null;
  state.roleStep = 'select';
  state.roleOrder = [];
  state.roleCursor = 0;
  state.roleChooser = null;
  state.stats.rolesPlayed += 1;
  state.roleChooserCursor += 1;
  if (state.roleChooserCursor >= state.playerCount) {
    endRound(state);
  } else {
    state.phase = 'roleChoice';
  }
}

function gameEndReason(state) {
  if (state.players.some((player) => citySlotsUsed(player) >= CITY_SPACES)) return 'city-full';
  if (state.supply.colonists <= 0) return 'colonists-exhausted';
  if (LARGE_BUILDING_IDS.every((id) => state.buildingsSupply[id] === 0)) return 'large-sold-out';
  if (state.rules.endOnVpExhausted && state.supply.vpChips <= 0) return 'vp-chips-exhausted';
  if (state.round > state.rules.maxRounds) return 'max-rounds';
  return null;
}

function endRound(state) {
  const finishedRound = state.round;
  state.round += 1;
  state.generation = state.round;
  state.governor = (state.governor + 1) % state.playerCount;
  state.turnOrder = buildTurnOrder(state.playerCount, state.governor);
  state.roleChooserCursor = 0;
  state.chosenRoles = [];
  state.chosenBy = [];
  state.activeRole = null;
  state.roleStep = 'select';
  state.roleOrder = [];
  state.roleCursor = 0;
  state.roleChooser = null;

  const reason = gameEndReason(state);
  if (reason) {
    state.phase = 'game-over';
    state.endReason = reason;
    const scored = score(state);
    state.winner = scored.winner;
    state.champion = scored.champion;
    logEvent(state, {
      kind: 'game-over', round: finishedRound, reason,
      winner: state.winner, champion: state.champion
    });
  } else {
    state.phase = 'roleChoice';
    logEvent(state, {
      kind: 'round-end', round: finishedRound, nextGovernor: state.governor
    });
  }
}

/* ------------------------------------------------------------------ */
/* Legal action enumeration                                           */
/* ------------------------------------------------------------------ */

function enumerateChooseRole(state) {
  return ROLE_IDS
    .filter((role) => state.chosenRoles.indexOf(role) === -1)
    .map((role) => ({ type: 'chooseRole', role }));
}

function enumerateSettle(state, player) {
  const out = [];
  const empty = emptyIslandIndexes(player);
  if (empty.length > 0) {
    const seen = Object.create(null);
    for (const crop of state.plantations.row) {
      if (seen[crop]) continue;
      seen[crop] = true;
      out.push({ type: 'settle', source: 'row', tile: crop });
      if (
        hasMannedBuilding(player, 'hacienda') &&
        empty.length >= 2 &&
        state.plantations.bag.length > 0
      ) {
        out.push({ type: 'settle', source: 'row', tile: crop, hacienda: true });
      }
    }
    const mayQuarry = state.roleChooser === player.index ||
      hasMannedBuilding(player, 'constructionHut');
    if (mayQuarry && state.supply.quarries > 0) {
      out.push({ type: 'settle', source: 'quarry' });
    }
  }
  out.push({ type: 'settle', pass: true });
  return out;
}

function enumerateMayorPlace(state, player) {
  const out = [];
  if (player.sanJuan > 0) {
    for (let i = 0; i < player.island.length; i += 1) {
      const tile = player.island[i];
      if (tile && !tile.manned) {
        out.push({ type: 'placeColonist', target: 'island', index: i });
      }
    }
    for (const id of Object.keys(player.buildings)) {
      if (!player.buildings[id].manned) {
        out.push({ type: 'placeColonist', target: 'building', building: id });
      }
    }
  }
  // Free reallocation: pick a colonist back up and place it elsewhere.
  for (let i = 0; i < player.island.length; i += 1) {
    const tile = player.island[i];
    if (tile && tile.manned) {
      out.push({ type: 'unplaceColonist', target: 'island', index: i });
    }
  }
  for (const id of Object.keys(player.buildings)) {
    if (player.buildings[id].manned) {
      out.push({ type: 'unplaceColonist', target: 'building', building: id });
    }
  }
  out.push({ type: 'mayorDone' });
  return out;
}

function enumerateBuild(state, player) {
  const out = [];
  for (const id of BUILDING_IDS) {
    const def = BUILDING_DEFS[id];
    if (state.buildingsSupply[id] <= 0) continue;
    if (player.buildings[id]) continue;
    if (cityFreeSlots(player) < def.size) continue;
    if (player.doubloons < effectiveBuildingCost(state, player, id)) continue;
    out.push({ type: 'build', building: id });
  }
  out.push({ type: 'build', pass: true });
  return out;
}

function enumerateSell(state, player) {
  const out = [];
  for (const good of GOODS) {
    if (player.goods[good] <= 0) continue;
    const present = tradingHouseEntry(state, good);
    if (present && !hasMannedBuilding(player, 'office')) continue;
    if (!present && tradingHouseFull(state)) continue;
    out.push({ type: 'sell', good });
  }
  out.push({ type: 'sell', pass: true });
  return out;
}

function enumerateShip(state, player) {
  const out = [];
  let publicActions = 0;
  let wharfActions = 0;
  for (const good of GOODS) {
    const have = player.goods[good];
    if (have <= 0) continue;

    let maxLoad = 0;
    const bestShips = [];
    for (let i = 0; i < state.ships.length; i += 1) {
      const ship = state.ships[i];
      if (ship.good !== null && ship.good !== good) continue;
      const space = ship.capacity - ship.count;
      if (space <= 0) continue;
      const load = Math.min(have, space);
      if (load > maxLoad) {
        maxLoad = load;
        bestShips.length = 0;
        bestShips.push(i);
      } else if (load === maxLoad) {
        bestShips.push(i);
      }
    }
    if (maxLoad > 0) {
      publicActions += bestShips.length;
      for (const ship of bestShips) {
        out.push({ type: 'ship', good, ship });
      }
    }
    if (hasMannedBuilding(player, 'wharf')) {
      wharfActions += 1;
      out.push({ type: 'ship', good, ship: 'wharf' });
    }
  }
  // Public shipping is mandatory when possible; the Wharf is optional.
  if (publicActions === 0 && wharfActions > 0) {
    out.push({ type: 'ship', pass: true });
  }
  return out;
}

function enumerate(state) {
  const actor = actorOf(state);
  if (actor === null) return [];
  const player = state.players[actor];
  if (state.phase === 'roleChoice') return enumerateChooseRole(state);
  if (state.phase !== 'role') return [];
  switch (state.roleStep) {
    case 'settle': return enumerateSettle(state, player);
    case 'mayorPlace': return enumerateMayorPlace(state, player);
    case 'build': return enumerateBuild(state, player);
    case 'sell': return enumerateSell(state, player);
    case 'ship': return enumerateShip(state, player);
    default: return [];
  }
}

/** All canonical legal actions for the current actor (or [] for another player). */
export function legalActions(state, playerIndex) {
  const next = advanceState(state);
  const actor = actorOf(next);
  if (actor === null) return [];
  if (playerIndex !== undefined && playerIndex !== null && playerIndex !== actor) return [];
  return enumerate(next);
}

/* ------------------------------------------------------------------ */
/* Action execution                                                   */
/* ------------------------------------------------------------------ */

function executeChooseRole(state, player, action) {
  const role = action.role;
  assert(ROLE_IDS.indexOf(role) !== -1, 'unknown role ' + role);
  assert(state.chosenRoles.indexOf(role) === -1, 'role already chosen this round');
  assert(state.turnOrder[state.roleChooserCursor] === player.index,
    'only the current role chooser may choose');

  state.chosenRoles.push(role);
  state.chosenBy.push(player.index);
  state.roleChooser = player.index;
  state.roleOrder = rotate(state.turnOrder, state.roleChooserCursor);
  state.roleCursor = 0;
  state.activeRole = role;
  state.phase = 'role';
  logRoundState(state, role, player.index);

  switch (role) {
    case 'settler':
      state.roleStep = 'settle';
      break;
    case 'mayor': {
      const bonus = takeColonistsFromSupply(state, 1);
      player.sanJuan += bonus;
      for (const pi of state.roleOrder) {
        if (state.supply.colonistShip > 0) {
          state.supply.colonistShip -= 1;
          state.players[pi].sanJuan += 1;
        }
      }
      logEvent(state, {
        kind: 'mayor-take', chooser: player.index,
        bonus, shipLeft: state.supply.colonistShip
      });
      state.roleStep = 'mayorPlace';
      break;
    }
    case 'builder':
      state.roleStep = 'build';
      break;
    case 'craftsman': {
      player.doubloons += 1;
      doCraftsman(state);
      completeRole(state);
      break;
    }
    case 'trader':
      state.roleStep = 'sell';
      break;
    case 'captain': {
      const vp = gainVp(state, player, 1);
      for (const ship of state.ships) {
        ship.good = null;
        ship.count = 0;
      }
      logEvent(state, { kind: 'captain-privilege', player: player.index, vp });
      state.roleStep = 'ship';
      break;
    }
    case 'prospector':
      player.doubloons += 1;
      logEvent(state, { kind: 'prospector', player: player.index, doubloons: 1 });
      completeRole(state);
      break;
    default:
      throw new Error('PuertoRico: unhandled role ' + role);
  }
}

function executeSettle(state, player, action) {
  if (action.pass) {
    logEvent(state, { kind: 'settle-pass', player: player.index });
    state.roleCursor += 1;
    return;
  }
  assert(emptyIslandIndexes(player).length > 0, 'no empty island space');
  if (action.source === 'quarry') {
    const mayQuarry = state.roleChooser === player.index ||
      hasMannedBuilding(player, 'constructionHut');
    assert(mayQuarry, 'player may not take a quarry');
    assert(state.supply.quarries > 0, 'no quarries left');
    state.supply.quarries -= 1;
    const index = placeIslandTile(player, 'quarry', false);
    let hospiced = false;
    if (hasMannedBuilding(player, 'hospice') && takeHospiceColonist(state)) {
      player.island[index].manned = true;
      hospiced = true;
    }
    logEvent(state, {
      kind: 'settle', player: player.index, source: 'quarry',
      index, hospiced, quarriesLeft: state.supply.quarries
    });
    state.roleCursor += 1;
    return;
  }

  assert(GOODS.indexOf(action.tile) !== -1, 'unknown plantation ' + action.tile);
  const rowIndex = state.plantations.row.indexOf(action.tile);
  assert(rowIndex !== -1, 'plantation not in the face-up row');
  state.plantations.row.splice(rowIndex, 1);
  const index = placeIslandTile(player, action.tile, false);
  let hospiced = false;
  if (hasMannedBuilding(player, 'hospice') && takeHospiceColonist(state)) {
    player.island[index].manned = true;
    hospiced = true;
  }

  let hacienda = null;
  if (action.hacienda) {
    assert(hasMannedBuilding(player, 'hacienda'), 'Hacienda is not manned');
    assert(emptyIslandIndexes(player).length > 0, 'no space for the Hacienda tile');
    const extra = drawBlind(state);
    assert(extra, 'no face-down plantation for Hacienda');
    const extraIndex = placeIslandTile(player, extra, false);
    hacienda = { crop: extra, index: extraIndex };
  }

  logEvent(state, {
    kind: 'settle', player: player.index, source: 'row', crop: action.tile,
    index, hospiced, hacienda
  });
  state.roleCursor += 1;
}

function executeMayorPlace(state, player, action) {
  if (action.type === 'mayorDone') {
    logEvent(state, { kind: 'mayor-finish', player: player.index, round: state.round });
    state.roleCursor += 1;
    return;
  }
  if (action.type === 'unplaceColonist') {
    if (action.target === 'island') {
      const tile = player.island[action.index];
      assert(tile && tile.manned, 'island target is not manned');
      tile.manned = false;
    } else if (action.target === 'building') {
      const building = player.buildings[action.building];
      assert(building && building.manned, 'building target is not manned');
      building.manned = false;
    } else {
      throw new Error('PuertoRico: unknown unplace target ' + action.target);
    }
    player.sanJuan += 1;
    logEvent(state, {
      kind: 'unplace-colonist', player: player.index,
      target: action.target, index: action.index, building: action.building
    });
    return;
  }
  assert(player.sanJuan > 0, 'no colonist in San Juan');
  if (action.target === 'island') {
    const tile = player.island[action.index];
    assert(tile && !tile.manned, 'island target is not available');
    tile.manned = true;
  } else if (action.target === 'building') {
    const building = player.buildings[action.building];
    assert(building && !building.manned, 'building target is not available');
    building.manned = true;
  } else {
    throw new Error('PuertoRico: unknown placement target ' + action.target);
  }
  player.sanJuan -= 1;
  logEvent(state, {
    kind: 'place-colonist', player: player.index,
    target: action.target, index: action.index, building: action.building
  });
}

function executeBuild(state, player, action) {
  if (action.pass) {
    logEvent(state, { kind: 'build-pass', player: player.index });
    state.roleCursor += 1;
    return;
  }
  const id = action.building;
  const def = BUILDING_DEFS[id];
  assert(def, 'unknown building ' + id);
  assert(state.buildingsSupply[id] > 0, 'building supply exhausted');
  assert(!player.buildings[id], 'player already owns ' + id);
  assert(cityFreeSlots(player) >= def.size, 'not enough city spaces');

  const cost = effectiveBuildingCost(state, player, id);
  assert(player.doubloons >= cost, 'not enough doubloons');
  const hadUniversity = hasMannedBuilding(player, 'university');

  player.doubloons -= cost;
  const slots = [];
  for (let i = 0; i < CITY_SPACES && slots.length < def.size; i += 1) {
    if (player.citySlots[i] === null) slots.push(i);
  }
  for (const slot of slots) player.citySlots[slot] = id;
  const building = { type: id, manned: false, slots };
  player.buildings[id] = building;
  state.buildingsSupply[id] -= 1;

  let freeColonist = false;
  if (hadUniversity && state.supply.colonists > 0) {
    state.supply.colonists -= 1;
    building.manned = true;
    freeColonist = true;
  }

  logEvent(state, {
    kind: 'build', player: player.index, building: id, cost,
    discount: def.cost - cost,
    slots, freeColonist, supplyLeft: state.buildingsSupply[id]
  });
  state.roleCursor += 1;
}

function executeSell(state, player, action) {
  if (action.pass) {
    logEvent(state, { kind: 'sell-pass', player: player.index });
    state.roleCursor += 1;
    return;
  }
  const good = action.good;
  assert(player.goods[good] > 0, 'no ' + good + ' to sell');
  const present = tradingHouseEntry(state, good);
  const hasOffice = hasMannedBuilding(player, 'office');
  if (present) {
    assert(hasOffice, 'good type already in the trading house');
  } else {
    assert(!tradingHouseFull(state), 'trading house is full');
  }
  const price = tradePrice(player, good, state.roleChooser);

  player.goods[good] -= 1;
  if (present) {
    present.count += 1;
  } else {
    state.tradingHouse.push({ good, count: 1 });
  }
  player.doubloons += price;
  logEvent(state, {
    kind: 'sell', player: player.index, good, price,
    doubloons: player.doubloons, office: present ? hasOffice : false,
    tradingHouse: clone(state.tradingHouse)
  });
  state.roleCursor += 1;
}

function executeShip(state, player, action) {
  if (action.pass) {
    logEvent(state, { kind: 'ship-decline-wharf', player: player.index });
    state.roleCursor += 1;
    return;
  }
  const good = action.good;
  assert(player.goods[good] > 0, 'no ' + good + ' to ship');
  let amount;
  if (action.ship === 'wharf') {
    assert(hasMannedBuilding(player, 'wharf'), 'Wharf is not manned');
    amount = player.goods[good];
  } else {
    const ship = state.ships[action.ship];
    assert(ship, 'unknown ship ' + action.ship);
    assert(ship.good === null || ship.good === good, 'ship carries another good');
    const space = ship.capacity - ship.count;
    assert(space > 0, 'ship is full');
    amount = Math.min(player.goods[good], space);
    ship.good = good;
    ship.count += amount;
  }
  assert(amount > 0, 'nothing to ship');
  player.goods[good] -= amount;

  const harbor = hasMannedBuilding(player, 'harbor') ? 1 : 0;
  const vp = gainVp(state, player, amount + harbor);
  logEvent(state, {
    kind: 'ship', player: player.index, good, amount,
    ship: action.ship, harbor, vp,
    ships: clone(state.ships), vpChips: player.vpChips
  });
  state.roleCursor += 1;
}

function execute(state, player, action) {
  if (state.phase === 'roleChoice') {
    executeChooseRole(state, player, action);
    return;
  }
  switch (state.roleStep) {
    case 'settle': executeSettle(state, player, action); return;
    case 'mayorPlace': executeMayorPlace(state, player, action); return;
    case 'build': executeBuild(state, player, action); return;
    case 'sell': executeSell(state, player, action); return;
    case 'ship': executeShip(state, player, action); return;
    default: throw new Error('PuertoRico: no action handler for step ' + state.roleStep);
  }
}

export function applyAction(state, action) {
  const next = advanceState(state);
  const actor = actorOf(next);
  assert(actor !== null, 'no current actor');
  const legal = enumerate(next);
  const key = stableStringify(action);
  const found = legal.some((candidate) => stableStringify(candidate) === key);
  if (!found) {
    throw new Error(
      'PuertoRico illegal: action is not legal for player ' + actor + ': ' + key
    );
  }
  execute(next, next.players[actor], clone(action));
  next.stats.actions += 1;
  advanceInPlace(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Craftsman                                                          */
/* ------------------------------------------------------------------ */

function doCraftsman(state) {
  const summary = [];
  for (const player of state.players) {
    const produced = {};
    for (const good of GOODS) {
      let amount;
      if (good === 'corn') {
        amount = countMannedPlantations(player, 'corn');
      } else {
        const plantations = countMannedPlantations(player, good);
        const capacity = productionCapacity(player, good);
        amount = Math.min(plantations, capacity);
      }
      if (amount > 0) {
        player.goods[good] += amount;
        produced[good] = amount;
      }
    }
    let factoryGold = 0;
    if (hasMannedBuilding(player, 'factory')) {
      const types = Object.keys(produced).length;
      factoryGold = FACTORY_GOLD[types] || 0;
      player.doubloons += factoryGold;
    }
    summary.push({ player: player.index, produced, factoryGold });
  }
  logEvent(state, { kind: 'craftsman', summary: clone(summary) });
}

/* ------------------------------------------------------------------ */
/* Captain storage                                                    */
/* ------------------------------------------------------------------ */

function storeGoods(state, player) {
  const remaining = {};
  for (const good of GOODS) remaining[good] = player.goods[good];

  let warehouseSlots = 0;
  if (hasMannedBuilding(player, 'smallWarehouse')) warehouseSlots += 1;
  if (hasMannedBuilding(player, 'largeWarehouse')) warehouseSlots += 2;

  const candidates = GOODS
    .filter((good) => remaining[good] > 0)
    .sort((a, b) =>
      remaining[b] - remaining[a] ||
      TRADE_PRICES[b] - TRADE_PRICES[a] ||
      GOODS.indexOf(a) - GOODS.indexOf(b));

  const warehouseTypes = candidates.slice(0, warehouseSlots);
  for (const good of warehouseTypes) remaining[good] = 0;

  let baseGood = null;
  const baseCandidates = GOODS
    .filter((good) => remaining[good] > 0)
    .sort((a, b) =>
      TRADE_PRICES[b] - TRADE_PRICES[a] ||
      remaining[b] - remaining[a] ||
      GOODS.indexOf(a) - GOODS.indexOf(b));
  if (baseCandidates.length > 0) {
    baseGood = baseCandidates[0];
    remaining[baseGood] -= 1;
  }

  const lost = {};
  for (const good of GOODS) {
    if (remaining[good] > 0) {
      lost[good] = remaining[good];
      player.goods[good] -= remaining[good];
    }
  }
  return { warehouseTypes, baseGood, lost };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

function largeBuildingBonus(player, type) {
  const def = BUILDING_DEFS[type];
  if (def.kind !== 'large') return 0;

  if (type === 'guildHall') {
    let small = 0;
    let large = 0;
    for (const id of Object.keys(player.buildings)) {
      const other = BUILDING_DEFS[id];
      if (other.smallProduction) small += 1;
      if (other.largeProduction) large += 1;
    }
    return small + 2 * large;
  }
  if (type === 'residence') {
    const filled = filledIslandSpaces(player);
    if (filled <= 0) return 0;
    if (filled <= 9) return 4;
    if (filled === 10) return 5;
    if (filled === 11) return 6;
    return 7;
  }
  if (type === 'fortress') {
    return Math.floor(totalColonists(player) / 3);
  }
  if (type === 'customsHouse') {
    return Math.floor(player.vpChips / 4);
  }
  if (type === 'cityHall') {
    let violet = 0;
    for (const id of Object.keys(player.buildings)) {
      const other = BUILDING_DEFS[id];
      if (other.kind === 'violet' || other.kind === 'large') violet += 1;
    }
    return violet;
  }
  return 0;
}

export function scorePlayer(state, playerIndex) {
  const player = state.players[playerIndex];
  assert(player, 'unknown player ' + playerIndex);

  let buildingVp = 0;
  const buildingDetails = [];
  for (const id of Object.keys(player.buildings)) {
    const def = BUILDING_DEFS[id];
    const building = player.buildings[id];
    buildingVp += def.vp;
    buildingDetails.push({
      type: id, name: def.name, vp: def.vp,
      manned: building.manned, slots: building.slots.slice()
    });
  }

  const largeBonuses = {};
  let largeBonus = 0;
  for (const id of LARGE_BUILDING_IDS) {
    const building = player.buildings[id];
    if (!building || !building.manned) continue;
    const points = largeBuildingBonus(player, id);
    largeBonuses[id] = points;
    largeBonus += points;
  }

  const shippingVp = player.vpChips;
  const total = buildingVp + shippingVp + largeBonus;
  const goods = GOODS.reduce((n, good) => n + player.goods[good], 0);
  const tieBreak = player.doubloons + goods;

  return {
    index: player.index,
    name: player.name,
    total,
    buildingVp,
    shippingVp,
    largeBonus,
    tieBreak,
    categories: {
      buildings: buildingVp,
      shipping: shippingVp,
      largeBuildings: largeBonus,
      ...largeBonuses
    },
    details: {
      buildings: buildingDetails,
      largeBonuses,
      citySlotsUsed: citySlotsUsed(player),
      filledIslandSpaces: filledIslandSpaces(player),
      colonists: totalColonists(player),
      goods,
      doubloons: player.doubloons,
      vpChips: player.vpChips
    }
  };
}

function scoreAll(state) {
  const players = state.players.map((player) => scorePlayer(state, player.index));
  const ranking = players.slice().sort((a, b) =>
    b.total - a.total ||
    b.tieBreak - a.tieBreak ||
    a.index - b.index);
  const best = ranking.length > 0 ? ranking[0].total : 0;
  const winner = players.filter((player) => player.total === best).map((player) => player.index);
  const champion = ranking.length > 0 ? ranking[0].index : null;
  return { players, ranking, winner, champion };
}

export function score(state) {
  const scored = scoreAll(state);
  return {
    version: VERSION,
    round: state.round,
    generation: state.generation,
    phase: state.phase,
    endReason: state.endReason,
    players: scored.players,
    ranking: scored.ranking,
    winner: scored.winner,
    champion: scored.champion
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI                                                          */
/* ------------------------------------------------------------------ */

function aiUnmannedTargets(player) {
  let n = 0;
  for (const tile of player.island) if (tile && !tile.manned) n += 1;
  for (const id of Object.keys(player.buildings)) {
    if (!player.buildings[id].manned) n += 1;
  }
  return n;
}

function aiProductionPotential(state, player) {
  let total = 0;
  for (const good of GOODS) {
    if (good === 'corn') {
      total += countMannedPlantations(player, 'corn');
    } else {
      total += Math.min(
        countMannedPlantations(player, good),
        productionCapacity(player, good)
      );
    }
  }
  return total;
}

function aiSaleValue(state, player, good) {
  const present = tradingHouseEntry(state, good);
  if (present && !hasMannedBuilding(player, 'office')) return -1;
  if (!present && tradingHouseFull(state)) return -1;
  return tradePrice(player, good, state.roleChooser);
}

/**
 * After the early land-grab the greedy agent stops buying cheap violet
 * buildings and saves its doubloons for a large building. This is still a
 * one-ply greedy heuristic, not a search.
 */
function aiShouldSaveForLarge(state, player) {
  if (state.round < 8) return false;
  if (player.doubloons >= 10) return false;
  if (cityFreeSlots(player) < 2) return false;
  return LARGE_BUILDING_IDS.some((id) => state.buildingsSupply[id] > 0);
}

function aiBestBuildingScore(state, player) {
  let best = 0;
  for (const id of BUILDING_IDS) {
    const def = BUILDING_DEFS[id];
    if (state.buildingsSupply[id] <= 0) continue;
    if (player.buildings[id]) continue;
    if (cityFreeSlots(player) < def.size) continue;
    const cost = effectiveBuildingCost(state, player, id);
    if (player.doubloons < cost) continue;
    const score = aiBuildingScore(state, player, id, cost);
    if (score > best) best = score;
  }
  return best;
}

function aiBuildingScore(state, player, id, cost) {
  const def = BUILDING_DEFS[id];
  let score = def.vp * 6 - cost * 1.5;

  if (def.kind === 'production') {
    const plantations = countMannedPlantations(player, def.crop);
    const capacity = productionCapacity(player, def.crop);
    const unmet = Math.max(0, plantations - capacity);
    score += 18 + Math.min(def.capacity, unmet) * 10;
    if (plantations === 0) score -= 15;
  } else if (def.effect === 'market1' || def.effect === 'market2') {
    score += 12;
    if (hasBuilding(player, 'smallMarket') || hasBuilding(player, 'largeMarket')) score += 6;
  } else if (def.effect === 'warehouse1' || def.effect === 'warehouse2') {
    score += totalGoods(player) >= 3 ? 24 : 8;
  } else if (def.effect === 'factory') {
    let types = 0;
    for (const good of GOODS) {
      if (productionCapacity(player, good) > 0 ||
        (good === 'corn' && countMannedPlantations(player, 'corn') > 0)) types += 1;
    }
    score += types >= 2 ? 10 + types * 5 : 0;
  } else if (def.effect === 'university' || def.effect === 'hospice') {
    score += 14;
  } else if (def.effect === 'harbor' || def.effect === 'wharf') {
    score += totalGoods(player) > 0 ? 18 : 4;
  } else if (def.effect === 'hacienda' || def.effect === 'constructionHut') {
    score += 10;
  } else if (def.effect === 'office') {
    score += state.tradingHouse.length >= 2 ? 12 : 5;
  } else if (def.kind === 'large') {
    if (def.size === 2 && cityFreeSlots(player) < 2) return -Infinity;
    score += 28;
    if (id === 'guildHall') {
      let production = 0;
      for (const other of Object.keys(player.buildings)) {
        if (BUILDING_DEFS[other].kind === 'production') production += 1;
      }
      score += production * 4;
    }
    if (id === 'cityHall') {
      let violet = 0;
      for (const other of Object.keys(player.buildings)) {
        if (BUILDING_DEFS[other].kind === 'violet' ||
          BUILDING_DEFS[other].kind === 'large') violet += 1;
      }
      score += violet * 3;
    }
    if (id === 'residence') score += Math.max(0, filledIslandSpaces(player) - 7) * 3;
    if (id === 'fortress') score += Math.floor(totalColonists(player) / 3) * 4;
    if (id === 'customsHouse') score += Math.floor(player.vpChips / 4) * 4;
  }

  if (def.kind !== 'large' && aiShouldSaveForLarge(state, player)) {
    if (def.kind === 'production') score -= 4;
    else if (def.effect === 'warehouse1' || def.effect === 'warehouse2') score -= 2;
    else score -= 12;
  }
  return score;
}

function aiRoleScore(state, role, player) {
  const goods = totalGoods(player);
  const production = aiProductionPotential(state, player);
  const emptyIsland = emptyIslandIndexes(player).length;
  const emptyTargets = aiUnmannedTargets(player);
  const incoming = player.sanJuan + Math.min(1, state.supply.colonistShip);
  let saleBest = -1;
  for (const good of GOODS) {
    if (player.goods[good] <= 0) continue;
    saleBest = Math.max(saleBest, aiSaleValue(state, player, good));
  }

  switch (role) {
    case 'captain':
      return goods > 0 && state.supply.vpChips > 0
        ? 45 + goods * 3 + (hasMannedBuilding(player, 'harbor') ? 5 : 0)
        : 0;
    case 'trader':
      return saleBest > 0
        ? 42 + saleBest * 4 + (player.doubloons < 10 ? 10 : 0)
        : 0;
    case 'mayor':
      return emptyTargets > 0 && incoming > 0
        ? 36 + Math.min(emptyTargets, 6) * 4
        : 0;
    case 'builder': {
      const best = aiBestBuildingScore(state, player);
      return best > 0 ? 28 + best * 0.6 : 0;
    }
    case 'craftsman':
      return production > 0 ? 32 + production * 5 : 0;
    case 'settler': {
      if (emptyIsland <= 0) return 0;
      let useful = false;
      for (const crop of state.plantations.row) {
        if (productionCapacity(player, crop) > 0 ||
          (crop === 'corn' && countMannedPlantations(player, 'corn') > 0)) {
          useful = true;
        }
      }
      const quarryUseful = countMannedQuarries(player) < 2;
      return useful || quarryUseful ? 20 + emptyIsland : 5;
    }
    case 'prospector':
      return 4;
    default:
      return 0;
  }
}

function sortedBest(state, actions, scorer) {
  let best = null;
  let bestScore = -Infinity;
  let bestKey = '';
  for (const action of actions) {
    const score = scorer(action);
    const key = stableStringify(action);
    if (score > bestScore || (score === bestScore && key < bestKey)) {
      best = action;
      bestScore = score;
      bestKey = key;
    }
  }
  return best;
}

function chooseRoleAction(state, actions, player) {
  return sortedBest(state, actions, (action) => aiRoleScore(state, action.role, player));
}

function chooseSettleAction(state, actions, player) {
  return sortedBest(state, actions, (action) => {
    if (action.pass) return 0;
    if (action.source === 'quarry') {
      return countMannedQuarries(player) < 2 ? 55 : 8;
    }
    const price = TRADE_PRICES[action.tile];
    const capacity = productionCapacity(player, action.tile);
    const cornAlready = countMannedPlantations(player, 'corn');
    let score = 15 + price * 5;
    if (capacity > 0) score += 20;
    if (action.tile === 'corn') {
      score = cornAlready === 0 ? 30 : 12;
    }
    if (action.hacienda) score += 6;
    return score;
  });
}

function chooseMayorAction(state, actions, player) {
  return sortedBest(state, actions, (action) => {
    if (action.type === 'mayorDone') return 0;
    if (action.type === 'unplaceColonist') return -10;
    if (action.target === 'island') {
      const tile = player.island[action.index];
      const price = TRADE_PRICES[tile.type] || 0;
      const capacity = productionCapacity(player, tile.type);
      if (tile.type === 'quarry') return 45 + (countMannedQuarries(player) < 2 ? 20 : 0);
      if (capacity > 0) return 55 + price * 3;
      return 28 + price * 3;
    }
    const id = action.building;
    const def = BUILDING_DEFS[id];
    let score = 20 + def.vp * 3;
    if (def.kind === 'production') {
      const plantations = countMannedPlantations(player, def.crop);
      const capacity = productionCapacity(player, def.crop);
      if (plantations > capacity) score += 25;
    }
    if (def.effect === 'factory' || def.effect === 'university' ||
      def.effect === 'harbor' || def.effect === 'wharf' ||
      def.effect === 'warehouse1' || def.effect === 'warehouse2') {
      score += 18;
    }
    if (def.kind === 'large') score += 8;
    return score;
  });
}

function chooseBuildAction(state, actions, player) {
  return sortedBest(state, actions, (action) => {
    if (action.pass) return 0;
    const def = BUILDING_DEFS[action.building];
    const cost = effectiveBuildingCost(state, player, action.building);
    let score = aiBuildingScore(state, player, action.building, cost);
    if (def.kind === 'large' && state.round < 6) score -= 20;
    return score;
  });
}

function chooseSellAction(state, actions, player) {
  return sortedBest(state, actions, (action) => {
    if (action.pass) return 0;
    const price = tradePrice(player, action.good, state.roleChooser);
    return price > 0 ? 10 + price * 4 : -1;
  });
}

function chooseShipAction(state, actions, player) {
  return sortedBest(state, actions, (action) => {
    if (action.pass) return -1;
    const good = action.good;
    const have = player.goods[good];
    const amount = action.ship === 'wharf'
      ? have
      : Math.min(have, state.ships[action.ship].capacity - state.ships[action.ship].count);
    const harbor = hasMannedBuilding(player, 'harbor') ? 1 : 0;
    return amount * 10 + TRADE_PRICES[good] + harbor;
  });
}

export function chooseGreedyAction(state, actions) {
  const next = advanceState(state);
  const actor = actorOf(next);
  if (actor === null) return null;
  const list = actions && actions.length !== undefined
    ? actions
    : enumerate(next);
  if (!list || list.length === 0) return null;
  const player = next.players[actor];

  if (next.phase === 'roleChoice') return chooseRoleAction(next, list, player);
  switch (next.roleStep) {
    case 'settle': return chooseSettleAction(next, list, player);
    case 'mayorPlace': return chooseMayorAction(next, list, player);
    case 'build': return chooseBuildAction(next, list, player);
    case 'sell': return chooseSellAction(next, list, player);
    case 'ship': return chooseShipAction(next, list, player);
    default: return list[0];
  }
}

export const MAX_ACTIONS = 8000;

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;
  while (next.phase !== 'game-over' && actions < max) {
    const actor = currentActor(next);
    if (actor === null) {
      throw new Error('PuertoRico AI: no current actor');
    }
    const list = legalActions(next, actor);
    if (list.length === 0) {
      throw new Error('PuertoRico AI: no legal actions for player ' + actor);
    }
    const action = opts.choose
      ? opts.choose(next, list)
      : chooseGreedyAction(next, list);
    if (!action) {
      throw new Error('PuertoRico AI: chooser returned null');
    }
    trace.push({
      round: next.round, player: actor, role: next.activeRole, action: clone(action)
    });
    next = applyAction(next, action);
    actions += 1;
  }
  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('PuertoRico AI: game did not finish within ' + max + ' actions');
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
  GOODS,
  GOOD_NAMES,
  TRADE_PRICES,
  ROLE_IDS,
  ROLES,
  BUILDING_DEFS,
  BUILDING_IDS,
  LARGE_BUILDING_IDS,
  BUILDING_SUPPLY,
  PLANTATION_COUNTS,
  QUARRY_SUPPLY,
  ISLAND_SPACES,
  CITY_SPACES,
  START_DOUBLOONS,
  COLONIST_TOTAL,
  VP_CHIP_TOTAL,
  SHIP_CAPACITIES,
  STARTING_CROPS,
  FACTORY_GOLD,
  QUARRY_DISCOUNT_CAP,
  DEFAULT_MAX_ROUNDS
});

export default {
  VERSION,
  DATA,
  GOODS,
  ROLE_IDS,
  ROLES,
  BUILDING_DEFS,
  BUILDING_IDS,
  LARGE_BUILDING_IDS,
  BUILDING_SUPPLY,
  createGame,
  legalActions,
  applyAction,
  advanceState,
  score,
  scorePlayer,
  currentActor,
  currentPlayer,
  hashState,
  stableStringify,
  citySlotsUsed,
  cityFreeSlots,
  filledIslandSpaces,
  emptyIslandIndexes,
  totalGoods,
  totalColonists,
  hasBuilding,
  hasMannedBuilding,
  countMannedPlantations,
  countMannedQuarries,
  productionCapacity,
  tradePrice,
  quarryDiscount,
  effectiveBuildingCost,
  tradingHouseEntry,
  tradingHouseFull,
  chooseGreedyAction,
  autoPlay,
  selfPlay
};
