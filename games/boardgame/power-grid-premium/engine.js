/*
 * Power Grid — pure rules engine (phase 1, no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> fully legal Action[] for the current actor
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> score/winner breakdown
 *   chooseGreedyAction(state)     -> one legal action for the built-in AI
 *   selfPlay(opts)                -> deterministic self-play to game over
 *   hashState(state)              -> stable FNV-1a hash of the full state
 *
 * Design constraints
 *   - Zero runtime dependencies. Seeded shuffles use games/shared/shuffle.js.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input and mutates the clone, so every public
 *     operation is pure from the caller's point of view.
 *   - Every random choice goes through a seed derived from createGame({seed}).
 *
 * Rule scope (defaults = Revised / "new" edition, as in the 2021 B站 video):
 *   3 steps, auction → resources → build → bureaucracy, 2–6 players.
 *   New-edition thresholds: Step 2 at 7 cities (6 players: 6); end game at
 *   18/17/17/15/14 cities for 2/3/4/5/6 players. Old-edition values are
 *   available through createGame({ edition: 'classic' }) or explicit
 *   step2Cities / endCities overrides. See rules.md §待确认 and §本版简化.
 */

let ShuffleApi = globalThis.Shuffle;
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  const mod = await import('../../shared/shuffle.js');
  ShuffleApi = (mod && mod.default) || globalThis.Shuffle;
}
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  throw new Error('PowerGridEngine requires games/shared/shuffle.js');
}

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const STEP = Object.freeze({ ONE: 1, TWO: 2, THREE: 3 });
export const RESOURCE_KINDS = Object.freeze(['coal', 'oil', 'garbage', 'uranium']);
export const PLANT_TYPES = Object.freeze([
  'coal', 'oil', 'hybrid', 'garbage', 'uranium', 'eco', 'fusion'
]);

export const START_MONEY = 50;
export const MAX_ACTIONS = 30000;

/* Power plants are printed with a storage limit of twice the fuel shown. */
export const STORAGE_MULTIPLIER = 2;

/*
 * Complete base-game plant deck: 42 cards numbered 03–40, 42, 44, 46, 50.
 * [number, fuel type, fuel required, cities powered]
 * Source: Rio Grande base-game card list (cross-checked against the BGG
 * "power grid contents" table and the official rules' examples for 04, 13,
 * 20, 23, 30, 46, 50).
 */
const PLANT_ROWS = Object.freeze([
  [3, 'oil', 2, 1],
  [4, 'coal', 2, 1],
  [5, 'hybrid', 2, 1],
  [6, 'garbage', 1, 1],
  [7, 'oil', 3, 2],
  [8, 'coal', 3, 2],
  [9, 'oil', 1, 1],
  [10, 'coal', 2, 2],
  [11, 'uranium', 1, 2],
  [12, 'hybrid', 2, 2],
  [13, 'eco', 0, 1],
  [14, 'garbage', 2, 2],
  [15, 'coal', 2, 3],
  [16, 'oil', 2, 3],
  [17, 'uranium', 1, 2],
  [18, 'eco', 0, 3],
  [19, 'garbage', 2, 3],
  [20, 'coal', 3, 5],
  [21, 'hybrid', 2, 4],
  [22, 'eco', 0, 2],
  [23, 'uranium', 1, 3],
  [24, 'garbage', 2, 4],
  [25, 'coal', 2, 5],
  [26, 'oil', 2, 5],
  [27, 'eco', 0, 3],
  [28, 'uranium', 1, 4],
  [29, 'hybrid', 1, 3],
  [30, 'garbage', 3, 6],
  [31, 'coal', 3, 6],
  [32, 'oil', 3, 6],
  [33, 'eco', 0, 4],
  [34, 'uranium', 1, 5],
  [35, 'oil', 1, 5],
  [36, 'coal', 3, 7],
  [37, 'eco', 0, 4],
  [38, 'garbage', 3, 7],
  [39, 'uranium', 1, 6],
  [40, 'oil', 2, 6],
  [42, 'coal', 2, 6],
  [44, 'eco', 0, 5],
  [46, 'hybrid', 3, 7],
  [50, 'fusion', 0, 6]
]);

export const POWER_PLANTS = Object.freeze(PLANT_ROWS.map((row) => Object.freeze({
  number: row[0],
  type: row[1],
  fuel: row[2],
  capacity: row[3]
})));

const PLANT_BY_NUMBER = Object.freeze(Object.fromEntries(
  POWER_PLANTS.map((p) => [p.number, p])
));

/* Money paid for 0..20 powered cities (20+ pays 150). */
export const PAYMENT_TABLE = Object.freeze([
  10, 22, 33, 44, 54, 64, 73, 82, 90, 98,
  105, 112, 118, 124, 129, 134, 138, 142, 145, 148, 150
]);

/* Resource market: fossil slots hold 3 tokens, uranium slots hold 1. */
export const RESOURCE_SLOT_CAPACITY = Object.freeze({
  coal: 3, oil: 3, garbage: 3, uranium: 1
});
export const RESOURCE_MAX_PRICE = Object.freeze({
  coal: 8, oil: 8, garbage: 8, uranium: 16
});
export const RESOURCE_TOTAL_TOKENS = Object.freeze({
  coal: 24, oil: 24, garbage: 24, uranium: 12
});

/*
 * Bureaucracy resupply, "highest empty slot first".
 * RESUPPLY[players][step][resource] = tokens added.
 * Source: official Rio Grande rules / Eric Postpischil condensed table.
 */
export const RESUPPLY = Object.freeze({
  2: { 1: { coal: 3, oil: 2, garbage: 1, uranium: 1 }, 2: { coal: 4, oil: 2, garbage: 2, uranium: 1 }, 3: { coal: 3, oil: 4, garbage: 3, uranium: 1 } },
  3: { 1: { coal: 4, oil: 2, garbage: 1, uranium: 1 }, 2: { coal: 5, oil: 3, garbage: 2, uranium: 1 }, 3: { coal: 3, oil: 4, garbage: 3, uranium: 1 } },
  4: { 1: { coal: 5, oil: 3, garbage: 2, uranium: 1 }, 2: { coal: 6, oil: 4, garbage: 3, uranium: 2 }, 3: { coal: 4, oil: 5, garbage: 4, uranium: 2 } },
  5: { 1: { coal: 5, oil: 4, garbage: 3, uranium: 2 }, 2: { coal: 7, oil: 5, garbage: 3, uranium: 3 }, 3: { coal: 5, oil: 6, garbage: 5, uranium: 2 } },
  6: { 1: { coal: 7, oil: 5, garbage: 3, uranium: 2 }, 2: { coal: 9, oil: 6, garbage: 5, uranium: 3 }, 3: { coal: 6, oil: 7, garbage: 6, uranium: 3 } }
});

/* Revised / "new" edition (2021 B站 video): Step 2 at 7 cities (6p: 6). */
export const STEP2_CITIES_NEW = Object.freeze({ 2: 7, 3: 7, 4: 7, 5: 7, 6: 6 });
export const END_CITIES_NEW = Object.freeze({ 2: 18, 3: 17, 4: 17, 5: 15, 6: 14 });

/* Original edition: Step 2 at 10 cities for 2 players, end at 21. */
export const STEP2_CITIES_CLASSIC = Object.freeze({ 2: 10, 3: 7, 4: 7, 5: 7, 6: 6 });
export const END_CITIES_CLASSIC = Object.freeze({ 2: 21, 3: 17, 4: 17, 5: 15, 6: 14 });

export const PLANT_LIMIT_BY_PLAYERS = Object.freeze({ 2: 4, 3: 3, 4: 3, 5: 3, 6: 3 });

/* City capacity is a Step property, not a player-count property. */
export const CITY_CAPACITY_BY_STEP = Object.freeze({ 1: 1, 2: 2, 3: 3 });

const CITY_SLOT_PRICE = Object.freeze([10, 15, 20]);

/*
 * Map: a 30-city, connected Germany-lite topology. Connection costs are
 * plausible estimates, not a digit-for-digit copy of the official board;
 * see rules.md §本版简化. The engine accepts any map shaped like this one.
 */
const GERMANY_LITE_CITIES = Object.freeze([
  ['kiel', 'Kiel', 'north'],
  ['hamburg', 'Hamburg', 'north'],
  ['bremen', 'Bremen', 'north'],
  ['hannover', 'Hannover', 'north'],
  ['berlin', 'Berlin', 'east'],
  ['magdeburg', 'Magdeburg', 'east'],
  ['leipzig', 'Leipzig', 'east'],
  ['dresden', 'Dresden', 'east'],
  ['erfurt', 'Erfurt', 'east'],
  ['muenster', 'Münster', 'west'],
  ['bielefeld', 'Bielefeld', 'west'],
  ['dortmund', 'Dortmund', 'west'],
  ['essen', 'Essen', 'west'],
  ['koeln', 'Köln', 'west'],
  ['aachen', 'Aachen', 'west'],
  ['kassel', 'Kassel', 'center'],
  ['frankfurt', 'Frankfurt', 'center'],
  ['wiesbaden', 'Wiesbaden', 'center'],
  ['mainz', 'Mainz', 'center'],
  ['wuerzburg', 'Würzburg', 'center'],
  ['nuernberg', 'Nürnberg', 'south'],
  ['regensburg', 'Regensburg', 'south'],
  ['augsburg', 'Augsburg', 'south'],
  ['muenchen', 'München', 'south'],
  ['passau', 'Passau', 'south'],
  ['stuttgart', 'Stuttgart', 'south'],
  ['karlsruhe', 'Karlsruhe', 'south'],
  ['mannheim', 'Mannheim', 'south'],
  ['saarbruecken', 'Saarbrücken', 'south'],
  ['freiburg', 'Freiburg', 'south']
]);

const GERMANY_LITE_EDGES = Object.freeze([
  ['kiel', 'hamburg', 6],
  ['hamburg', 'bremen', 10],
  ['hamburg', 'hannover', 15],
  ['hamburg', 'berlin', 25],
  ['bremen', 'hannover', 12],
  ['bremen', 'muenster', 16],
  ['hannover', 'bielefeld', 9],
  ['hannover', 'magdeburg', 14],
  ['hannover', 'kassel', 15],
  ['magdeburg', 'berlin', 12],
  ['magdeburg', 'leipzig', 12],
  ['berlin', 'leipzig', 16],
  ['berlin', 'dresden', 18],
  ['muenster', 'bielefeld', 7],
  ['muenster', 'dortmund', 6],
  ['muenster', 'essen', 8],
  ['bielefeld', 'dortmund', 6],
  ['bielefeld', 'kassel', 13],
  ['dortmund', 'essen', 4],
  ['dortmund', 'koeln', 7],
  ['essen', 'koeln', 6],
  ['koeln', 'aachen', 7],
  ['koeln', 'wiesbaden', 12],
  ['aachen', 'wiesbaden', 14],
  ['kassel', 'frankfurt', 12],
  ['kassel', 'erfurt', 11],
  ['kassel', 'wuerzburg', 14],
  ['leipzig', 'dresden', 10],
  ['leipzig', 'erfurt', 12],
  ['dresden', 'regensburg', 20],
  ['erfurt', 'nuernberg', 16],
  ['frankfurt', 'wiesbaden', 3],
  ['frankfurt', 'mainz', 4],
  ['frankfurt', 'wuerzburg', 11],
  ['wiesbaden', 'mannheim', 8],
  ['mainz', 'mannheim', 6],
  ['mainz', 'saarbruecken', 12],
  ['mannheim', 'karlsruhe', 5],
  ['mannheim', 'stuttgart', 8],
  ['saarbruecken', 'stuttgart', 14],
  ['saarbruecken', 'karlsruhe', 12],
  ['karlsruhe', 'stuttgart', 7],
  ['karlsruhe', 'freiburg', 10],
  ['stuttgart', 'nuernberg', 14],
  ['stuttgart', 'augsburg', 15],
  ['wuerzburg', 'nuernberg', 9],
  ['nuernberg', 'regensburg', 10],
  ['nuernberg', 'augsburg', 12],
  ['regensburg', 'passau', 9],
  ['regensburg', 'muenchen', 11],
  ['augsburg', 'muenchen', 6],
  ['muenchen', 'passau', 14],
  ['freiburg', 'muenchen', 22]
]);

function makeMap(id, name, cities, edges) {
  return Object.freeze({
    id,
    name,
    cities: Object.freeze(cities.map((c) => Object.freeze({
      id: c[0], name: c[1], region: c[2]
    }))),
    edges: Object.freeze(edges.map((e) => Object.freeze({
      a: e[0], b: e[1], cost: e[2]
    })))
  });
}

export const MAPS = Object.freeze({
  'germany-lite': makeMap('germany-lite', 'Germany (30-city, phase-1 topology)',
    GERMANY_LITE_CITIES, GERMANY_LITE_EDGES)
});

/* ------------------------------------------------------------------ */
/* Generic helpers                                                    */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('PowerGrid illegal: ' + message);
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

function sum(values) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function maxCityCount(state) {
  let best = 0;
  for (const p of state.players) if (p.cities.length > best) best = p.cities.length;
  return best;
}

function highestPlantNumber(player) {
  let best = 0;
  for (const plant of player.plants) if (plant.number > best) best = plant.number;
  return best;
}

/* ------------------------------------------------------------------ */
/* Plant helpers                                                      */
/* ------------------------------------------------------------------ */

function makePlant(number, resources) {
  const def = PLANT_BY_NUMBER[number];
  assert(def, 'unknown power plant ' + number);
  return {
    number: def.number,
    type: def.type,
    fuel: def.fuel,
    capacity: def.capacity,
    coal: resources ? resources.coal || 0 : 0,
    oil: resources ? resources.oil || 0 : 0,
    garbage: resources ? resources.garbage || 0 : 0,
    uranium: resources ? resources.uranium || 0 : 0
  };
}

function plantAccepts(plant, kind) {
  if (plant.type === 'hybrid') return kind === 'coal' || kind === 'oil';
  return plant.type === kind;
}

function plantStorageUsed(plant) {
  if (plant.type === 'hybrid') return plant.coal + plant.oil;
  if (plant.type === 'coal') return plant.coal;
  if (plant.type === 'oil') return plant.oil;
  if (plant.type === 'garbage') return plant.garbage;
  if (plant.type === 'uranium') return plant.uranium;
  return 0;
}

function plantStorageCap(plant) {
  return plant.fuel * STORAGE_MULTIPLIER;
}

export function plantValue(plant) {
  return plant.capacity * 10 + (plant.fuel === 0 ? 12 : 0) - plant.fuel * 1.5 - plant.number * 0.2;
}

export function paymentForCities(count) {
  if (count < 0) return 0;
  if (count >= PAYMENT_TABLE.length) return PAYMENT_TABLE[PAYMENT_TABLE.length - 1];
  return PAYMENT_TABLE[count];
}

/* ------------------------------------------------------------------ */
/* Resource storage helpers                                           */
/* ------------------------------------------------------------------ */

function resourceTotals(player) {
  const totals = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
  for (const plant of player.plants) {
    totals.coal += plant.coal;
    totals.oil += plant.oil;
    totals.garbage += plant.garbage;
    totals.uranium += plant.uranium;
  }
  return totals;
}

function storageCaps(player) {
  const caps = { coal: 0, oil: 0, hybrid: 0, garbage: 0, uranium: 0 };
  for (const plant of player.plants) {
    if (plant.type === 'hybrid') caps.hybrid += plantStorageCap(plant);
    else if (plant.type === 'coal') caps.coal += plantStorageCap(plant);
    else if (plant.type === 'oil') caps.oil += plantStorageCap(plant);
    else if (plant.type === 'garbage') caps.garbage += plantStorageCap(plant);
    else if (plant.type === 'uranium') caps.uranium += plantStorageCap(plant);
  }
  return caps;
}

export function freeStorage(player, kind) {
  if (!RESOURCE_KINDS.includes(kind)) return 0;
  const caps = storageCaps(player);
  const totals = resourceTotals(player);
  if (kind === 'coal') {
    return Math.max(0, Math.min(
      caps.coal + caps.hybrid - totals.coal,
      caps.coal + caps.oil + caps.hybrid - totals.coal - totals.oil
    ));
  }
  if (kind === 'oil') {
    return Math.max(0, Math.min(
      caps.oil + caps.hybrid - totals.oil,
      caps.coal + caps.oil + caps.hybrid - totals.coal - totals.oil
    ));
  }
  if (kind === 'garbage') return Math.max(0, caps.garbage - totals.garbage);
  return Math.max(0, caps.uranium - totals.uranium);
}

function addResource(player, kind) {
  for (const plant of player.plants) {
    if (!plantAccepts(plant, kind)) continue;
    if (plantStorageUsed(plant) >= plantStorageCap(plant)) continue;
    plant[kind] += 1;
    return true;
  }
  return false;
}

function consumeResource(state, player, kind, amount) {
  let remaining = amount;
  for (const plant of player.plants) {
    if (remaining <= 0) break;
    const take = Math.min(plant[kind] || 0, remaining);
    if (take > 0) {
      plant[kind] -= take;
      remaining -= take;
    }
  }
  if (remaining > 0) throw new Error('PowerGrid internal: cannot consume ' + remaining + ' ' + kind);
  state.supply[kind] += amount;
}

function consumeHybrid(state, player, amount) {
  let remaining = amount;
  const totals = resourceTotals(player);
  const fromCoal = Math.min(totals.coal, remaining);
  if (fromCoal > 0) {
    consumeResource(state, player, 'coal', fromCoal);
    remaining -= fromCoal;
  }
  if (remaining > 0) consumeResource(state, player, 'oil', remaining);
}

function discardPlantResources(state, player, plant) {
  const held = {
    coal: plant.coal, oil: plant.oil, garbage: plant.garbage, uranium: plant.uranium
  };
  for (const kind of RESOURCE_KINDS) {
    let count = held[kind];
    while (count > 0) {
      if (addResource(player, kind)) count -= 1;
      else {
        state.supply[kind] += 1;
        count -= 1;
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fuel planning                                                      */
/* ------------------------------------------------------------------ */

function fuelDemand(plants) {
  const demand = { coal: 0, oil: 0, garbage: 0, uranium: 0, hybrid: 0 };
  for (const plant of plants) {
    if (plant.type === 'coal') demand.coal += plant.fuel;
    else if (plant.type === 'oil') demand.oil += plant.fuel;
    else if (plant.type === 'garbage') demand.garbage += plant.fuel;
    else if (plant.type === 'uranium') demand.uranium += plant.fuel;
    else if (plant.type === 'hybrid') demand.hybrid += plant.fuel;
  }
  return demand;
}

function demandFeasible(totals, demand) {
  if (totals.coal < demand.coal) return false;
  if (totals.oil < demand.oil) return false;
  if (totals.garbage < demand.garbage) return false;
  if (totals.uranium < demand.uranium) return false;
  const spare = (totals.coal - demand.coal) + (totals.oil - demand.oil);
  return demand.hybrid <= spare;
}

function subsetsOf(list) {
  const out = [];
  const total = 1 << list.length;
  for (let mask = 0; mask < total; mask += 1) {
    const subset = [];
    for (let i = 0; i < list.length; i += 1) {
      if (mask & (1 << i)) subset.push(list[i]);
    }
    out.push(subset);
  }
  return out;
}

function subsetFuelCost(plants) {
  return sum(plants.map((p) => p.fuel));
}

function subsetKey(plants) {
  return plants.map((p) => p.number).sort((a, b) => a - b).join(',');
}

/**
 * Best set of plants to run while powering exactly `count` cities.
 * Lexicographic objective: smallest total capacity >= count, then least fuel,
 * then lowest plant numbers. Returns null if impossible.
 */
export function planSupply(player, count) {
  if (count <= 0) return { plants: [], capacity: 0, fuel: 0 };
  if (count > player.cities.length) return null;
  const totals = resourceTotals(player);
  const candidates = [];
  for (const subset of subsetsOf(player.plants)) {
    if (subset.length === 0) continue;
    const capacity = sum(subset.map((p) => p.capacity));
    if (capacity < count) continue;
    if (!demandFeasible(totals, fuelDemand(subset))) continue;
    candidates.push({ plants: subset, capacity, fuel: subsetFuelCost(subset) });
  }
  candidates.sort((a, b) =>
    a.capacity - b.capacity ||
    a.fuel - b.fuel ||
    subsetKey(a.plants).localeCompare(subsetKey(b.plants))
  );
  return candidates.length ? candidates[0] : null;
}

export function maxPowered(player) {
  if (!player.cities.length || !player.plants.length) return 0;
  const totals = resourceTotals(player);
  let best = 0;
  for (const subset of subsetsOf(player.plants)) {
    const capacity = sum(subset.map((p) => p.capacity));
    if (capacity === 0) continue;
    if (!demandFeasible(totals, fuelDemand(subset))) continue;
    const powered = Math.min(capacity, player.cities.length);
    if (powered > best) best = powered;
  }
  return best;
}

function consumePlan(state, player, plan) {
  const fixed = plan.plants.filter((p) => p.type !== 'hybrid' && p.type !== 'eco' && p.type !== 'fusion');
  const hybrids = plan.plants.filter((p) => p.type === 'hybrid');
  for (const plant of fixed) consumeResource(state, player, plant.type, plant.fuel);
  for (const plant of hybrids) consumeHybrid(state, player, plant.fuel);
}

/* ------------------------------------------------------------------ */
/* Map helpers                                                        */
/* ------------------------------------------------------------------ */

export function cityMap(state) {
  const out = {};
  for (const city of state.map.cities) out[city.id] = city;
  return out;
}

function adjacency(state) {
  const adj = {};
  for (const city of state.map.cities) adj[city.id] = [];
  for (const edge of state.map.edges) {
    if (!adj[edge.a] || !adj[edge.b]) continue;
    adj[edge.a].push({ to: edge.b, cost: edge.cost });
    adj[edge.b].push({ to: edge.a, cost: edge.cost });
  }
  return adj;
}

export function shortestConnectionCosts(state, sources) {
  const adj = adjacency(state);
  const dist = {};
  const visited = new Set();
  for (const city of state.map.cities) dist[city.id] = Infinity;
  for (const source of sources) if (dist[source] !== undefined) dist[source] = 0;
  for (let i = 0; i < state.map.cities.length; i += 1) {
    let bestId = null;
    let bestDist = Infinity;
    for (const city of state.map.cities) {
      if (visited.has(city.id)) continue;
      if (dist[city.id] < bestDist) {
        bestDist = dist[city.id];
        bestId = city.id;
      }
    }
    if (bestId === null) break;
    visited.add(bestId);
    for (const edge of adj[bestId]) {
      const next = dist[bestId] + edge.cost;
      if (next < dist[edge.to]) dist[edge.to] = next;
    }
  }
  return dist;
}

export function cityOccupancy(state, cityId) {
  let count = 0;
  for (const player of state.players) {
    if (player.cities.includes(cityId)) count += 1;
  }
  return count;
}

export function cityCapacity(state) {
  const table = (state.rules && state.rules.cityCapacityByStep) || CITY_CAPACITY_BY_STEP;
  return table[state.step] || 1;
}

/* ------------------------------------------------------------------ */
/* Player order helpers                                               */
/* ------------------------------------------------------------------ */

function playerSortKey(state, player, byPlantsOnly) {
  if (byPlantsOnly) return [highestPlantNumber(player)];
  return [player.cities.length, highestPlantNumber(player)];
}

export function determinePlayerOrder(state, byPlantsOnly) {
  const previous = state.turnOrder.slice();
  const ranked = state.players.slice().sort((a, b) => {
    const ka = playerSortKey(state, a, byPlantsOnly);
    const kb = playerSortKey(state, b, byPlantsOnly);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return previous.indexOf(a.index) - previous.indexOf(b.index);
  });
  state.turnOrder = ranked.map((p) => p.index);
  return state.turnOrder;
}

/* ------------------------------------------------------------------ */
/* Market helpers                                                     */
/* ------------------------------------------------------------------ */

function sortMarket(state) {
  state.market.sort((a, b) => a.number - b.number);
}

export function actualMarketSize(state) {
  return state.step === STEP.THREE ? 6 : 4;
}

export function actualMarket(state) {
  return state.market.slice(0, actualMarketSize(state));
}

export function futureMarket(state) {
  return state.step === STEP.THREE ? [] : state.market.slice(actualMarketSize(state));
}

function drawFromDeck(state) {
  if (!state.deck.length) return null;
  const top = state.deck.shift();
  if (top && top.step3) {
    triggerStep3Card(state);
    return null;
  }
  return makePlant(top.number);
}

function triggerStep3Card(state) {
  state.step3Pending = true;
  state.step3Shuffles += 1;
  state.deck = shuffleWith(
    state.deck.concat(state.underDeck || []),
    state.seed + ':step3:' + state.round + ':' + state.step3Shuffles
  );
  state.underDeck = [];
  state.lastEvents.push({ type: 'step3-card-drawn', round: state.round, phase: state.phase });
}

/**
 * Official Minimum Rule: while the actual market's lowest plant number is
 * <= the largest number of cities any player has, remove it and replace it.
 * If no replacement can be drawn (deck empty / Step 3 pending), stop.
 */
function applyMinimumRule(state) {
  let guard = 0;
  while (guard < 40) {
    guard += 1;
    if (!state.market.length) break;
    const size = actualMarketSize(state);
    const lowest = state.market.slice(0, size)[0];
    if (!lowest) break;
    if (lowest.number > maxCityCount(state)) break;
    const replacement = (() => {
      if (!state.deck.length) return { empty: true };
      const top = state.deck[0];
      if (top && top.step3) {
        state.deck.shift();
        triggerStep3Card(state);
        return { empty: true };
      }
      state.deck.shift();
      return { plant: makePlant(top.number) };
    })();
    const index = state.market.findIndex((p) => p.number === lowest.number);
    if (index >= 0) state.market.splice(index, 1);
    state.removedPlants.push(lowest.number);
    state.lastEvents.push({ type: 'minimum-rule', plant: lowest.number, cities: maxCityCount(state) });
    if (replacement.empty) break;
    state.market.push(replacement.plant);
    sortMarket(state);
  }
}

/* ------------------------------------------------------------------ */
/* Phase transition helpers                                           */
/* ------------------------------------------------------------------ */

function actualSizeForStep(step) {
  return step === STEP.THREE ? 6 : 4;
}

export function beginStep2(state) {
  if (state.step !== STEP.ONE) return state;
  state.step = STEP.TWO;
  if (state.market.length) {
    const removed = state.market.shift();
    state.removedPlants.push(removed.number);
    const replacement = drawFromDeck(state);
    if (replacement) state.market.push(replacement);
    sortMarket(state);
  }
  applyMinimumRule(state);
  if (state.step3Pending) beginStep3(state);
  return state;
}

export function beginStep3(state) {
  if (state.step === STEP.THREE) {
    state.step3Pending = false;
    return state;
  }
  state.step = STEP.THREE;
  // The Step 3 card and the lowest market plant are discarded without
  // replacements. Our sentinel already consumed one market slot, leaving 7.
  if (state.market.length > actualSizeForStep(STEP.THREE)) {
    const removed = state.market.shift();
    state.removedPlants.push(removed.number);
  }
  state.market = state.market.slice(0, actualSizeForStep(STEP.THREE));
  state.step3Pending = false;
  applyMinimumRule(state);
  return state;
}

function endGame(state, reason) {
  state.phase = 'game-over';
  state.endReason = reason;
  state.auction = null;
  const ranking = rankPlayers(state);
  if (ranking.length) {
    const top = ranking[0];
    const tied = ranking.filter((p) =>
      p.poweredCities === top.poweredCities &&
      p.money === top.money &&
      p.cities === top.cities
    );
    state.winner = tied.map((p) => p.index);
  } else {
    state.winner = [];
  }
  state.lastEvents.push({ type: 'game-over', reason, winner: state.winner.slice() });
}

/* ------------------------------------------------------------------ */
/* Auction                                                            */
/* ------------------------------------------------------------------ */

function eligiblePlayers(state) {
  const a = state.auction;
  if (!a) return [];
  return state.turnOrder.filter((p) => !a.passed.includes(p) && !a.bought.includes(p));
}

function nextInPool(state, from, pool) {
  const n = state.turnOrder.length;
  const start = state.turnOrder.indexOf(from);
  if (start < 0) return pool.length ? pool[0] : null;
  for (let k = 1; k <= n; k += 1) {
    const candidate = state.turnOrder[(start + k) % n];
    if (pool.includes(candidate)) return candidate;
  }
  return null;
}

function nextEligible(state, from) {
  const eligible = eligiblePlayers(state);
  if (!eligible.length) return null;
  return nextInPool(state, from, eligible);
}

function startAuctionPhase(state) {
  state.phase = 'auction';
  state.orderIdx = 0;
  const first = state.turnOrder.length ? state.turnOrder[0] : null;
  state.auction = {
    mode: 'choose',
    chooser: first,
    bidTurn: null,
    auctioneer: null,
    winner: null,
    plant: null,
    currentBid: 0,
    highBidder: null,
    activeBidders: [],
    passed: [],
    bought: [],
    offers: {}
  };
  if (state.auction.chooser === null) endAuctionPhase(state);
}

function availablePlantsForAuction(state) {
  return actualMarket(state);
}

function canAffordAnyPlant(state, player) {
  const ps = state.players[player];
  return availablePlantsForAuction(state).some((plant) => plant.number <= ps.money);
}

function canDeclineAuction(state, player) {
  if (!availablePlantsForAuction(state).length) return true;
  if (!canAffordAnyPlant(state, player)) return true;
  if (state.round === 1 && state.rules.firstRoundMustOffer) return false;
  return true;
}

function resolveAuction(state) {
  const a = state.auction;
  assert(a && a.highBidder !== null, 'no auction to resolve');
  const winner = a.highBidder;
  const player = state.players[winner];
  const price = a.currentBid;
  const plantInMarket = state.market.find((p) => p.number === a.plant);
  assert(plantInMarket, 'auctioned plant left the market');
  assert(player.money >= price, 'winner cannot pay the bid');
  player.money -= price;
  player.plants.push(makePlant(a.plant));
  state.market = state.market.filter((p) => p.number !== a.plant);
  a.bought.push(winner);
  a.winner = winner;
  state.lastEvents.push({
    type: 'auction-won',
    player: winner,
    plant: a.plant,
    price
  });
  // Market replacement happens after the discard decision too, but drawing it
  // now keeps the market stable for the UI; the official order is irrelevant
  // because the plant is already sold.
  const replacement = drawFromDeck(state);
  if (replacement) state.market.push(replacement);
  sortMarket(state);
  applyMinimumRule(state);
  const limit = state.rules.plantLimit;
  if (player.plants.length > limit) {
    a.mode = 'discard';
    a.discardPlayer = winner;
    return;
  }
  finishAuctionAndContinue(state);
}

function finishAuctionAndContinue(state) {
  const a = state.auction;
  const auctioneer = a.auctioneer;
  const winner = a.winner;
  a.mode = 'choose';
  a.discardPlayer = null;
  a.plant = null;
  a.currentBid = 0;
  a.highBidder = null;
  a.activeBidders = [];
  a.bidTurn = null;
  if (winner !== auctioneer) {
    // The auctioneer lost: they may offer another plant or decline.
    a.chooser = auctioneer;
  } else {
    a.chooser = nextEligible(state, winner);
  }
  if (a.chooser === null) endAuctionPhase(state);
}

function endAuctionPhase(state) {
  if (state.auction && state.auction.bought.length === 0 && state.market.length) {
    const removed = state.market.shift();
    state.removedPlants.push(removed.number);
    const replacement = drawFromDeck(state);
    if (replacement) state.market.push(replacement);
    sortMarket(state);
    applyMinimumRule(state);
  }
  if (state.round === 1) determinePlayerOrder(state, true);
  if (state.step3Pending) beginStep3(state);
  state.auction = null;
  state.phase = 'resources';
  state.orderIdx = 0;
  state.lastEvents.push({ type: 'phase', phase: 'resources' });
}

function doAuctionOffer(state, player, action) {
  const a = state.auction;
  assert(a.mode === 'choose', 'not choosing an auction');
  assert(a.chooser === player, 'not your turn to offer a plant');
  assert(Number.isInteger(action.plant), 'auctionOffer needs an integer plant number');
  const plant = availablePlantsForAuction(state).find((p) => p.number === action.plant);
  assert(plant, 'plant is not in the actual market');
  const bid = action.bid === undefined ? plant.number : action.bid;
  assert(Number.isInteger(bid), 'bid must be an integer');
  assert(bid >= plant.number, 'bid is below the minimum ' + plant.number);
  assert(bid <= state.players[player].money, 'bid exceeds your cash');
  a.mode = 'bid';
  a.auctioneer = player;
  a.plant = plant.number;
  a.currentBid = bid;
  a.highBidder = player;
  a.activeBidders = eligiblePlayers(state);
  a.offers[player] = (a.offers[player] || 0) + 1;
  a.bidTurn = nextInPool(state, player, a.activeBidders);
  state.lastEvents.push({ type: 'auction-opened', player, plant: plant.number, bid });
  if (a.activeBidders.length <= 1 || a.bidTurn === null) resolveAuction(state);
}

function doAuctionBid(state, player, action) {
  const a = state.auction;
  assert(a.mode === 'bid', 'not in a bidding round');
  assert(a.bidTurn === player, 'not your turn to bid');
  assert(Number.isInteger(action.amount), 'bid amount must be an integer');
  assert(action.amount > a.currentBid, 'bid must exceed the current bid');
  assert(action.amount <= state.players[player].money, 'bid exceeds your cash');
  a.currentBid = action.amount;
  a.highBidder = player;
  state.lastEvents.push({ type: 'auction-bid', player, amount: action.amount });
  const remaining = a.activeBidders.filter((p) => p !== player);
  if (remaining.length === 0) {
    resolveAuction(state);
    return;
  }
  a.bidTurn = nextInPool(state, player, a.activeBidders);
  if (a.bidTurn === null) resolveAuction(state);
}

function doAuctionPass(state, player) {
  const a = state.auction;
  assert(a.mode === 'bid', 'not in a bidding round');
  assert(a.bidTurn === player, 'not your turn to bid');
  a.activeBidders = a.activeBidders.filter((p) => p !== player);
  state.lastEvents.push({ type: 'auction-pass', player });
  if (a.activeBidders.length <= 1) {
    resolveAuction(state);
    return;
  }
  a.bidTurn = nextInPool(state, player, a.activeBidders);
  if (a.bidTurn === null) resolveAuction(state);
}

function doAuctionDecline(state, player) {
  const a = state.auction;
  assert(a.mode === 'choose', 'not choosing an auction');
  assert(a.chooser === player, 'not your turn to offer a plant');
  assert(canDeclineAuction(state, player), 'you must offer a plant in round 1');
  a.passed.push(player);
  state.lastEvents.push({ type: 'auction-decline', player });
  a.chooser = nextEligible(state, player);
  if (a.chooser === null) endAuctionPhase(state);
}

function doDiscardPlant(state, player, action) {
  const a = state.auction;
  assert(a.mode === 'discard', 'not discarding a plant');
  assert(a.discardPlayer === player, 'not your discard');
  const ps = state.players[player];
  const limit = state.rules.plantLimit;
  assert(ps.plants.length > limit, 'you are not over the plant limit');
  const index = ps.plants.findIndex((p) => p.number === action.plant);
  assert(index >= 0, 'you do not own plant ' + action.plant);
  const [plant] = ps.plants.splice(index, 1);
  discardPlantResources(state, ps, plant);
  state.lastEvents.push({ type: 'plant-discarded', player, plant: plant.number });
  if (ps.plants.length > limit) return;
  finishAuctionAndContinue(state);
}

/* ------------------------------------------------------------------ */
/* Buy resources                                                      */
/* ------------------------------------------------------------------ */

function reverseOrder(state) {
  return state.turnOrder.slice().reverse();
}

export function cheapestResourcePrice(state, kind) {
  const slots = state.resourceMarket[kind];
  if (!slots) return null;
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] > 0) return i + 1;
  }
  return null;
}

function doBuyResource(state, player, action) {
  const kind = action.resource;
  assert(RESOURCE_KINDS.includes(kind), 'unknown resource ' + kind);
  const ps = state.players[player];
  const price = cheapestResourcePrice(state, kind);
  assert(price !== null, 'no ' + kind + ' available');
  assert(ps.money >= price, 'cannot afford ' + kind + ' at ' + price);
  assert(freeStorage(ps, kind) > 0, 'no storage for ' + kind);
  assert(addResource(ps, kind), 'could not place ' + kind + ' on a plant');
  ps.money -= price;
  const slots = state.resourceMarket[kind];
  for (let i = 0; i < slots.length; i += 1) {
    if (slots[i] > 0) {
      slots[i] -= 1;
      break;
    }
  }
  state.lastEvents.push({ type: 'resource-bought', player, resource: kind, price });
}

function doEndResourcePurchase(state) {
  state.orderIdx += 1;
  if (state.orderIdx >= state.playerCount) {
    state.phase = 'build';
    state.orderIdx = 0;
    state.lastEvents.push({ type: 'phase', phase: 'build' });
  }
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */

export function buildCost(state, player, cityId) {
  const ps = state.players[player];
  const occupancy = cityOccupancy(state, cityId);
  const slot = CITY_SLOT_PRICE[Math.min(occupancy, 2)];
  if (!ps.cities.length) return slot;
  const distances = shortestConnectionCosts(state, ps.cities);
  const connection = distances[cityId];
  if (connection === undefined || connection === Infinity) return Infinity;
  return slot + connection;
}

export function legalBuildCities(state, player) {
  const ps = state.players[player];
  const capacity = cityCapacity(state);
  const out = [];
  for (const city of state.map.cities) {
    if (ps.cities.includes(city.id)) continue;
    if (cityOccupancy(state, city.id) >= capacity) continue;
    const cost = buildCost(state, player, city.id);
    if (!Number.isFinite(cost)) continue;
    if (cost > ps.money) continue;
    out.push({ city: city.id, cost });
  }
  out.sort((a, b) => a.cost - b.cost || a.city.localeCompare(b.city));
  return out;
}

function doBuildCity(state, player, action) {
  const ps = state.players[player];
  const cityId = action.city;
  assert(state.map.cities.some((c) => c.id === cityId), 'unknown city ' + cityId);
  assert(!ps.cities.includes(cityId), 'you already have a house in ' + cityId);
  assert(cityOccupancy(state, cityId) < cityCapacity(state), 'city ' + cityId + ' is full');
  const cost = buildCost(state, player, cityId);
  assert(Number.isFinite(cost), 'city ' + cityId + ' is unreachable');
  assert(cost <= ps.money, 'cannot afford to build in ' + cityId + ' (' + cost + ')');
  ps.money -= cost;
  ps.cities.push(cityId);
  ps.cities.sort();
  state.lastEvents.push({ type: 'city-built', player, city: cityId, cost });
  applyMinimumRule(state);
}

function doEndBuild(state) {
  state.orderIdx += 1;
  if (state.orderIdx >= state.playerCount) afterBuildPhase(state);
}

function afterBuildPhase(state) {
  const mostCities = maxCityCount(state);
  if (mostCities >= state.rules.endCities) {
    endGame(state, 'cities');
    return;
  }
  if (state.step === STEP.ONE && mostCities >= state.rules.step2Cities) {
    beginStep2(state);
    state.lastEvents.push({ type: 'step', step: state.step });
  }
  if (state.step3Pending) beginStep3(state);
  state.phase = 'bureaucracy';
  state.orderIdx = 0;
  state.lastEvents.push({ type: 'phase', phase: 'bureaucracy' });
}

/* ------------------------------------------------------------------ */
/* Bureaucracy                                                        */
/* ------------------------------------------------------------------ */

function doSupplyCities(state, player, action) {
  const ps = state.players[player];
  const count = action.count;
  assert(Number.isInteger(count) && count >= 0, 'count must be a non-negative integer');
  assert(count <= ps.cities.length, 'cannot power more cities than you have');
  const maximum = maxPowered(ps);
  assert(count <= maximum, 'not enough plants/fuel to power ' + count + ' cities');
  const plan = planSupply(ps, count);
  assert(plan, 'no feasible plant plan for ' + count + ' cities');
  consumePlan(state, ps, plan);
  const payment = paymentForCities(count);
  ps.money += payment;
  ps.poweredLast = count;
  state.lastEvents.push({
    type: 'supplied',
    player,
    cities: count,
    payment,
    plants: plan.plants.map((p) => p.number).sort((a, b) => a - b)
  });
  state.orderIdx += 1;
  if (state.orderIdx >= state.playerCount) afterBureaucracy(state);
}

function resupplyResource(state, kind, amount) {
  let remaining = Math.min(amount, state.supply[kind]);
  const cap = RESOURCE_SLOT_CAPACITY[kind];
  const maxPrice = RESOURCE_MAX_PRICE[kind];
  for (let price = maxPrice; price >= 1 && remaining > 0; price -= 1) {
    const index = price - 1;
    const free = cap - state.resourceMarket[kind][index];
    if (free <= 0) continue;
    const add = Math.min(free, remaining);
    state.resourceMarket[kind][index] += add;
    state.supply[kind] -= add;
    remaining -= add;
  }
}

function resupplyAll(state) {
  const table = RESUPPLY[state.playerCount][state.step];
  for (const kind of RESOURCE_KINDS) resupplyResource(state, kind, table[kind]);
  state.lastEvents.push({ type: 'resupply', step: state.step });
}

function afterBureaucracy(state) {
  resupplyAll(state);
  if (state.step3Pending) {
    beginStep3(state);
  } else if (state.step < STEP.THREE) {
    // Move the most expensive future plant under the draw pile.
    if (state.market.length > 4) {
      const under = state.market.pop();
      state.underDeck.push(under);
      const replacement = drawFromDeck(state);
      if (replacement) state.market.push(replacement);
      sortMarket(state);
    }
    applyMinimumRule(state);
    if (state.step3Pending) beginStep3(state);
  } else {
    // Step 3: remove the lowest market plant and replace it.
    if (state.market.length) {
      const removed = state.market.shift();
      state.removedPlants.push(removed.number);
      const replacement = drawFromDeck(state);
      if (replacement) state.market.push(replacement);
      sortMarket(state);
    }
    applyMinimumRule(state);
  }
  state.round += 1;
  if (state.round > state.rules.maxRounds) {
    endGame(state, 'round-limit');
    return;
  }
  determinePlayerOrder(state, false);
  startAuctionPhase(state);
}

/* ------------------------------------------------------------------ */
/* Current actor / legal actions                                      */
/* ------------------------------------------------------------------ */

export function currentPlayer(state) {
  if (state.phase === 'game-over') return null;
  if (state.phase === 'auction') {
    const a = state.auction;
    if (!a) return null;
    if (a.mode === 'choose') return a.chooser;
    if (a.mode === 'bid') return a.bidTurn;
    if (a.mode === 'discard') return a.discardPlayer;
    return null;
  }
  const order = (state.phase === 'resources' || state.phase === 'build')
    ? reverseOrder(state)
    : state.turnOrder;
  const player = order[state.orderIdx];
  return player === undefined ? null : player;
}

export function legalActions(state, playerIndex) {
  if (state.phase === 'game-over') return [];
  const player = currentPlayer(state);
  if (player === null || player === undefined) return [];
  if (playerIndex !== undefined && playerIndex !== null && playerIndex !== player) return [];
  const ps = state.players[player];

  if (state.phase === 'auction') {
    const a = state.auction;
    if (a.mode === 'discard') {
      return ps.plants.map((p) => ({ type: 'discardPlant', plant: p.number }));
    }
    if (a.mode === 'choose') {
      const offers = availablePlantsForAuction(state)
        .filter((p) => p.number <= ps.money)
        .map((p) => ({ type: 'auctionOffer', plant: p.number, bid: p.number }));
      const actions = offers.slice();
      if (!offers.length || canDeclineAuction(state, player)) {
        actions.push({ type: 'auctionDecline' });
      }
      return actions;
    }
    if (a.mode === 'bid') {
      const actions = [{ type: 'auctionPass' }];
      for (let amount = a.currentBid + 1; amount <= ps.money; amount += 1) {
        actions.push({ type: 'auctionBid', amount });
      }
      return actions;
    }
    return [];
  }

  if (state.phase === 'resources') {
    const actions = [];
    for (const kind of RESOURCE_KINDS) {
      const price = cheapestResourcePrice(state, kind);
      if (price === null) continue;
      if (price > ps.money) continue;
      if (freeStorage(ps, kind) <= 0) continue;
      actions.push({ type: 'buyResource', resource: kind });
    }
    actions.push({ type: 'endResourcePurchase' });
    return actions;
  }

  if (state.phase === 'build') {
    const actions = legalBuildCities(state, player).map((b) => ({
      type: 'buildCity',
      city: b.city
    }));
    actions.push({ type: 'endBuild' });
    return actions;
  }

  if (state.phase === 'bureaucracy') {
    const maximum = maxPowered(ps);
    const actions = [];
    for (let count = 0; count <= maximum; count += 1) {
      actions.push({ type: 'supplyCities', count });
    }
    return actions;
  }

  return [];
}

/* ------------------------------------------------------------------ */
/* applyAction                                                        */
/* ------------------------------------------------------------------ */

export function applyAction(state, action) {
  assert(state.phase !== 'game-over', 'game is already over');
  assert(action && typeof action.type === 'string', 'action must have a type');
  const player = currentPlayer(state);
  assert(player !== null, 'no current player');
  const next = clone(state);
  next.lastEvents = [];

  switch (action.type) {
    case 'auctionOffer': doAuctionOffer(next, player, action); break;
    case 'auctionBid': doAuctionBid(next, player, action); break;
    case 'auctionPass': doAuctionPass(next, player); break;
    case 'auctionDecline': doAuctionDecline(next, player); break;
    case 'discardPlant': doDiscardPlant(next, player, action); break;
    case 'buyResource': doBuyResource(next, player, action); break;
    case 'endResourcePurchase': doEndResourcePurchase(next); break;
    case 'buildCity': doBuildCity(next, player, action); break;
    case 'endBuild': doEndBuild(next); break;
    case 'supplyCities': doSupplyCities(next, player, action); break;
    default: throw new Error('PowerGrid illegal: unknown action type ' + action.type);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                            */
/* ------------------------------------------------------------------ */

export function poweredCities(state, player) {
  return Math.min(player.cities.length, maxPowered(player));
}

function rankPlayers(state) {
  return state.players.map((ps) => ({
    index: ps.index,
    name: ps.name,
    money: ps.money,
    cities: ps.cities.length,
    poweredCities: poweredCities(state, ps),
    plants: ps.plants.map((p) => p.number).sort((a, b) => a - b),
    plantCount: ps.plants.length
  })).sort((a, b) =>
    b.poweredCities - a.poweredCities ||
    b.money - a.money ||
    b.cities - a.cities ||
    a.index - b.index
  );
}

export function score(state) {
  return {
    phase: state.phase,
    step: state.step,
    round: state.round,
    endReason: state.endReason || null,
    players: rankPlayers(state),
    ranking: rankPlayers(state),
    winner: state.winner ? state.winner.slice() : null
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI / self-play                                              */
/* ------------------------------------------------------------------ */

function auctionBidLimit(player, plant) {
  const budget = player.plants.length === 0 ? 5 : 12;
  const value = plant.capacity * 7 + (plant.fuel === 0 ? 12 : 0) - plant.fuel * 1.5;
  return Math.max(plant.number, Math.min(player.money - budget, Math.floor(plant.number + value)));
}

function chooseAuctionOffer(state, actions, player) {
  const ps = state.players[player];
  const offers = actions.filter((a) => a.type === 'auctionOffer');
  if (!offers.length) return actions.find((a) => a.type === 'auctionDecline') || null;
  const plants = offers.map((a) => ({
    action: a,
    plant: state.market.find((p) => p.number === a.plant)
  })).filter((x) => x.plant);
  plants.sort((a, b) =>
    plantValue(b.plant) - plantValue(a.plant) ||
    a.plant.number - b.plant.number
  );
  const best = plants[0];
  const offersSoFar = (state.auction.offers && state.auction.offers[player]) || 0;
  const canDecline = actions.some((a) => a.type === 'auctionDecline');
  // Do not spin forever re-offering plants after losing; keep the first two
  // attempts, then let the other players act unless round 1 forces an offer.
  if (canDecline && offersSoFar >= 2 && ps.plants.length > 0) {
    return actions.find((a) => a.type === 'auctionDecline');
  }
  if (canDecline && ps.plants.length >= state.rules.plantLimit && offersSoFar >= 1) {
    return actions.find((a) => a.type === 'auctionDecline');
  }
  return best.action;
}

function chooseAuctionBid(state, actions, player) {
  const ps = state.players[player];
  const a = state.auction;
  const plant = state.market.find((p) => p.number === a.plant);
  if (!plant) return actions.find((x) => x.type === 'auctionPass') || null;
  const maxBid = auctionBidLimit(ps, plant);
  const next = actions
    .filter((x) => x.type === 'auctionBid' && x.amount <= maxBid)
    .sort((x, y) => x.amount - y.amount)[0];
  if (next) return next;
  return actions.find((x) => x.type === 'auctionPass') || null;
}

function chooseDiscard(state, actions, player) {
  const ps = state.players[player];
  const ranked = ps.plants.slice().sort((a, b) =>
    plantValue(a) - plantValue(b) || a.number - b.number
  );
  const target = ranked[0];
  return actions.find((a) => a.type === 'discardPlant' && a.plant === target.number) || actions[0];
}

function neededFuel(player) {
  const need = { coal: 0, oil: 0, garbage: 0, uranium: 0 };
  let hybrid = 0;
  for (const plant of player.plants) {
    if (plant.type === 'coal') need.coal += plant.fuel;
    else if (plant.type === 'oil') need.oil += plant.fuel;
    else if (plant.type === 'garbage') need.garbage += plant.fuel;
    else if (plant.type === 'uranium') need.uranium += plant.fuel;
    else if (plant.type === 'hybrid') hybrid += plant.fuel;
  }
  return { need, hybrid };
}

function chooseResourceAction(state, actions, player) {
  const ps = state.players[player];
  const { need, hybrid } = neededFuel(ps);
  const totals = resourceTotals(ps);
  const buys = actions.filter((a) => a.type === 'buyResource');
  const end = actions.find((a) => a.type === 'endResourcePurchase');
  if (!buys.length) return end;
  if (ps.money <= 14) return end;
  const deficits = [];
  for (const kind of ['coal', 'oil', 'garbage', 'uranium']) {
    if (totals[kind] < need[kind]) deficits.push(kind);
  }
  // Hybrid demand can be met with either coal or oil.
  const flexible = totals.coal + totals.oil < need.coal + need.oil + hybrid;
  if (flexible && totals.coal < need.coal + hybrid) deficits.push('coal');
  if (flexible && totals.oil < need.oil + hybrid) deficits.push('oil');
  if (!deficits.length) return end;
  const candidates = buys
    .filter((a) => deficits.includes(a.resource))
    .sort((a, b) => {
      const pa = cheapestResourcePrice(state, a.resource);
      const pb = cheapestResourcePrice(state, b.resource);
      return pa - pb || a.resource.localeCompare(b.resource);
    });
  if (!candidates.length) return end;
  return candidates[0];
}

function chooseBuildAction(state, actions, player) {
  const ps = state.players[player];
  const builds = actions.filter((a) => a.type === 'buildCity').map((a) => ({
    action: a,
    cost: buildCost(state, player, a.city)
  }));
  const end = actions.find((a) => a.type === 'endBuild');
  if (!builds.length) return end;
  builds.sort((a, b) => a.cost - b.cost || a.action.city.localeCompare(b.action.city));
  const nearEnd = ps.cities.length >= state.rules.endCities - 4;
  const reserve = nearEnd ? 0 : 10;
  const affordable = builds.filter((b) => ps.money - b.cost >= reserve);
  if (!affordable.length) return end;
  // Keep one plant's worth of fuel money early; the income table rewards
  // cities quickly, so building is the default greedy move.
  return affordable[0].action;
}

function chooseBureaucracyAction(state, actions, player) {
  const ps = state.players[player];
  const maximum = maxPowered(ps);
  const exact = actions.find((a) => a.type === 'supplyCities' && a.count === maximum);
  return exact || actions[0];
}

export function chooseGreedyAction(state, actions) {
  const list = actions || legalActions(state);
  if (!list.length) return null;
  const player = currentPlayer(state);
  if (player === null) return null;

  if (state.phase === 'auction') {
    const a = state.auction;
    if (a.mode === 'discard') return chooseDiscard(state, list, player);
    if (a.mode === 'choose') return chooseAuctionOffer(state, list, player);
    if (a.mode === 'bid') return chooseAuctionBid(state, list, player);
  }
  if (state.phase === 'resources') return chooseResourceAction(state, list, player);
  if (state.phase === 'build') return chooseBuildAction(state, list, player);
  if (state.phase === 'bureaucracy') return chooseBureaucracyAction(state, list, player);
  return list[0];
}

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;
  while (next.phase !== 'game-over' && actions < max) {
    const player = currentPlayer(next);
    const list = legalActions(next, player);
    if (!list.length) {
      throw new Error('PowerGrid AI: no legal actions for player ' + player + ' in ' + next.phase);
    }
    const action = opts.choose
      ? opts.choose(next, list)
      : chooseGreedyAction(next, list);
    if (!action) throw new Error('PowerGrid AI: chooser returned null');
    trace.push({ player, action: clone(action) });
    next = applyAction(next, action);
    actions += 1;
  }
  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('PowerGrid AI: game did not finish within ' + max + ' actions');
  }
  return { state: next, actions, trace };
}

export function selfPlay(opts = {}) {
  const state = createGame(opts);
  return autoPlay(state, opts);
}

/* ------------------------------------------------------------------ */
/* Game setup                                                         */
/* ------------------------------------------------------------------ */

function resolveMap(mapOption) {
  if (mapOption === undefined || mapOption === null) return MAPS['germany-lite'];
  if (typeof mapOption === 'string') {
    assert(MAPS[mapOption], 'unknown map ' + mapOption);
    return MAPS[mapOption];
  }
  assert(mapOption && Array.isArray(mapOption.cities) && Array.isArray(mapOption.edges), 'map must have cities[] and edges[]');
  const cities = mapOption.cities.map((c) => ({
    id: c.id, name: c.name || c.id, region: c.region || 'custom'
  }));
  const ids = new Set(cities.map((c) => c.id));
  assert(ids.size === cities.length, 'duplicate city id in map');
  const edges = mapOption.edges.map((e) => ({ a: e.a, b: e.b, cost: e.cost }));
  for (const e of edges) {
    assert(ids.has(e.a) && ids.has(e.b), 'edge references an unknown city');
    assert(Number.isFinite(e.cost) && e.cost >= 0, 'edge cost must be a non-negative number');
  }
  return {
    id: mapOption.id || 'custom',
    name: mapOption.name || 'Custom map',
    cities,
    edges
  };
}

function makeInitialMarket() {
  return [3, 4, 5, 6, 7, 8, 9, 10].map((n) => makePlant(n));
}

function makeDeck(seed, playerCount) {
  const pool = POWER_PLANTS
    .filter((p) => p.number > 10 && p.number !== 13)
    .map((p) => ({ number: p.number }));
  const shuffled = shuffleWith(pool, seed + ':deck');
  const removeCount = playerCount === 2 || playerCount === 3 ? 8 : playerCount === 4 ? 4 : 0;
  const removed = shuffled.splice(0, removeCount).map((p) => p.number);
  const deck = [makePlant(13)].concat(
    shuffled.map((p) => makePlant(p.number)),
    [{ step3: true }]
  );
  return { deck, removed };
}

function makeResourceMarket() {
  const coal = new Array(RESOURCE_MAX_PRICE.coal).fill(RESOURCE_SLOT_CAPACITY.coal);
  const oil = new Array(RESOURCE_MAX_PRICE.oil).fill(0);
  const garbage = new Array(RESOURCE_MAX_PRICE.garbage).fill(0);
  const uranium = new Array(RESOURCE_MAX_PRICE.uranium).fill(0);
  for (let i = 2; i < 8; i += 1) oil[i] = RESOURCE_SLOT_CAPACITY.oil; // prices 3..8
  for (let i = 6; i < 8; i += 1) garbage[i] = RESOURCE_SLOT_CAPACITY.garbage; // prices 7..8
  uranium[13] = 1; // price 14
  uranium[15] = 1; // price 16
  return { coal, oil, garbage, uranium };
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert([2, 3, 4, 5, 6].includes(playerCount), 'playerCount must be 2..6');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;
  const edition = opts.edition === 'classic' ? 'classic' : 'new';
  const step2Table = edition === 'classic' ? STEP2_CITIES_CLASSIC : STEP2_CITIES_NEW;
  const endTable = edition === 'classic' ? END_CITIES_CLASSIC : END_CITIES_NEW;
  const rules = {
    edition,
    step2Cities: opts.step2Cities === undefined ? step2Table[playerCount] : opts.step2Cities,
    endCities: opts.endCities === undefined ? endTable[playerCount] : opts.endCities,
    plantLimit: opts.plantLimit === undefined ? PLANT_LIMIT_BY_PLAYERS[playerCount] : opts.plantLimit,
    cityCapacityByStep: Object.assign({}, CITY_CAPACITY_BY_STEP),
    maxRounds: opts.maxRounds === undefined ? 60 : opts.maxRounds,
    firstRoundMustOffer: opts.firstRoundMustOffer === undefined ? true : !!opts.firstRoundMustOffer,
    startMoney: opts.startMoney === undefined ? START_MONEY : opts.startMoney
  };
  assert(Number.isInteger(rules.step2Cities) && rules.step2Cities > 0, 'step2Cities must be positive');
  assert(Number.isInteger(rules.endCities) && rules.endCities > 0, 'endCities must be positive');
  assert(Number.isInteger(rules.plantLimit) && rules.plantLimit > 0, 'plantLimit must be positive');
  assert(Number.isInteger(rules.maxRounds) && rules.maxRounds > 0, 'maxRounds must be positive');

  const map = resolveMap(opts.map);
  const { deck, removed } = makeDeck(seed, playerCount);
  const turnOrder = shuffleWith(
    Array.from({ length: playerCount }, (_, i) => i),
    seed + ':turn'
  );
  const players = Array.from({ length: playerCount }, (_, index) => ({
    index,
    name: opts.names && opts.names[index] ? opts.names[index] : 'P' + (index + 1),
    money: rules.startMoney,
    cities: [],
    plants: [],
    poweredLast: 0
  }));

  const state = {
    version: VERSION,
    seed,
    playerCount,
    edition,
    rules,
    map,
    step: STEP.ONE,
    round: 1,
    phase: 'auction',
    turnOrder,
    orderIdx: 0,
    players,
    market: makeInitialMarket(),
    deck,
    underDeck: [],
    removedPlants: removed.slice(),
    step3Pending: false,
    step3Shuffles: 0,
    resourceMarket: makeResourceMarket(),
    supply: { coal: 0, oil: 6, garbage: 18, uranium: 10 },
    auction: null,
    winner: null,
    endReason: null,
    lastEvents: []
  };
  startAuctionPhase(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Data export                                                        */
/* ------------------------------------------------------------------ */

export const DATA = Object.freeze({
  POWER_PLANTS,
  MAPS,
  PAYMENT_TABLE,
  RESUPPLY,
  RESOURCE_KINDS,
  RESOURCE_SLOT_CAPACITY,
  RESOURCE_MAX_PRICE,
  RESOURCE_TOTAL_TOKENS,
  START_MONEY,
  STORAGE_MULTIPLIER,
  STEP2_CITIES_NEW,
  STEP2_CITIES_CLASSIC,
  END_CITIES_NEW,
  END_CITIES_CLASSIC,
  PLANT_LIMIT_BY_PLAYERS,
  CITY_CAPACITY_BY_STEP,
  STEP
});

export default {
  VERSION,
  DATA,
  MAPS,
  POWER_PLANTS,
  PAYMENT_TABLE,
  RESUPPLY,
  createGame,
  legalActions,
  applyAction,
  score,
  currentPlayer,
  hashState,
  stableStringify,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  maxPowered,
  planSupply,
  poweredCities,
  buildCost,
  legalBuildCities,
  cityOccupancy,
  cityCapacity,
  cheapestResourcePrice,
  shortestConnectionCosts,
  determinePlayerOrder,
  beginStep2,
  beginStep3,
  actualMarket,
  futureMarket,
  actualMarketSize,
  paymentForCities,
  plantValue,
  freeStorage
};
