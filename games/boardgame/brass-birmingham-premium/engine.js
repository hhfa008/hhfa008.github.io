/*
 * Brass: Birmingham — pure rules engine (phase 1, no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> fully legal Action[] for the current player
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> score/winner breakdown
 *   chooseGreedyAction(state)     -> one legal action for the built-in AI
 *   autoPlay(state, opts)         -> deterministic 2-seat self-play
 *
 * Design constraints
 *   - Zero runtime dependencies. Seeded shuffles use games/shared/shuffle.js.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input and mutates the clone, so every public
 *     operation is pure from the caller's point of view.
 *   - Every random choice goes through a seed derived from createGame({seed}).
 *
 * Rule scope: the official Roxley rulebook (canal era -> rail era, 2–4 players)
 * plus deterministic normalisation for choices the physical game leaves to the
 * player (see rules.md §7). The task brief's 7-card / 1-action variant can be
 * requested with createGame({ handSize: 7, actionsPerTurn: 1 }); the defaults
 * follow the official 8-card / 2-action (first canal round: 1 action) rules.
 */

let ShuffleApi = globalThis.Shuffle;
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  const mod = await import('../../shared/shuffle.js');
  ShuffleApi = (mod && mod.default) || globalThis.Shuffle;
}
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  throw new Error('BrassBirminghamEngine requires games/shared/shuffle.js');
}

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Constants                                                          */
/* ------------------------------------------------------------------ */

export const INDUSTRIES = Object.freeze([
  'cotton', 'manufacturer', 'pottery', 'coal', 'iron', 'brewery'
]);

const SELLABLE = new Set(['cotton', 'manufacturer', 'pottery']);
const ALL_INDUSTRIES = INDUSTRIES.slice();

export const ERA = Object.freeze({ CANAL: 'canal', RAIL: 'rail' });
export const START_MONEY = 17;
export const START_INCOME_SPACE = 10;
export const INCOME_LEVEL_MIN = -10;
export const INCOME_LEVEL_MAX = 30;
export const INCOME_SPACE_MAX = 99;
export const LOAN_AMOUNT = 30;
export const LOAN_INCOME_LEVELS = 3;
export const CANAL_LINK_COST = 3;
export const RAIL_LINK_COST = 5;
export const RAIL_DOUBLE_LINK_COST = 15;
export const MAX_ACTIONS = 4000;

const COAL_MARKET_PRICES = Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
const COAL_MARKET_INITIAL = 13;
const COAL_FALLBACK_PRICE = 8;
const IRON_MARKET_PRICES = Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
const IRON_MARKET_INITIAL = 8;
const IRON_FALLBACK_PRICE = 6;

const WILD_LOCATION_COUNT = 4;
const WILD_INDUSTRY_COUNT = 4;

/* ------------------------------------------------------------------ */
/* Board data                                                         */
/* ------------------------------------------------------------------ */

function slot(...industries) {
  return Object.freeze({ industries: Object.freeze(industries) });
}

const LOCATION_DATA = {
  belper: {
    name: 'Belper', region: 'derbyshire',
    slots: [slot('cotton', 'manufacturer'), slot('coal'), slot('pottery')]
  },
  derby: {
    name: 'Derby', region: 'derbyshire',
    slots: [slot('cotton', 'brewery'), slot('cotton', 'manufacturer'), slot('iron')]
  },
  leek: {
    name: 'Leek', region: 'staffordshire',
    slots: [slot('cotton', 'manufacturer'), slot('cotton', 'coal')]
  },
  'stoke-on-trent': {
    name: 'Stoke-on-Trent', region: 'staffordshire',
    slots: [slot('cotton', 'manufacturer'), slot('pottery', 'iron'), slot('manufacturer')]
  },
  stone: {
    name: 'Stone', region: 'staffordshire',
    slots: [slot('cotton', 'brewery'), slot('manufacturer', 'coal')]
  },
  uttoxeter: {
    name: 'Uttoxeter', region: 'staffordshire',
    slots: [slot('manufacturer', 'brewery'), slot('cotton', 'brewery')]
  },
  stafford: {
    name: 'Stafford', region: 'midlands',
    slots: [slot('manufacturer', 'brewery'), slot('pottery')]
  },
  'burton-on-trent': {
    name: 'Burton-on-Trent', region: 'midlands',
    slots: [slot('manufacturer', 'coal'), slot('brewery')]
  },
  cannock: {
    name: 'Cannock', region: 'midlands',
    slots: [slot('manufacturer', 'coal'), slot('coal')]
  },
  tamworth: {
    name: 'Tamworth', region: 'midlands',
    slots: [slot('cotton', 'coal'), slot('cotton', 'coal')]
  },
  walsall: {
    name: 'Walsall', region: 'midlands',
    slots: [slot('iron', 'manufacturer'), slot('manufacturer', 'brewery')]
  },
  wolverhampton: {
    name: 'Wolverhampton', region: 'black-country',
    slots: [slot('manufacturer'), slot('manufacturer', 'coal')]
  },
  coalbrookdale: {
    name: 'Coalbrookdale', region: 'black-country',
    slots: [slot('iron', 'brewery'), slot('iron'), slot('coal')]
  },
  dudley: {
    name: 'Dudley', region: 'black-country',
    slots: [slot('coal'), slot('iron')]
  },
  kidderminster: {
    name: 'Kidderminster', region: 'black-country',
    slots: [slot('cotton', 'coal'), slot('cotton')]
  },
  worcester: {
    name: 'Worcester', region: 'black-country',
    slots: [slot('cotton'), slot('cotton')]
  },
  birmingham: {
    name: 'Birmingham', region: 'birmingham',
    slots: [slot('cotton', 'manufacturer'), slot('manufacturer'), slot('iron'), slot('manufacturer')]
  },
  coventry: {
    name: 'Coventry', region: 'birmingham',
    slots: [slot('pottery'), slot('manufacturer', 'coal'), slot('iron', 'manufacturer')]
  },
  nuneaton: {
    name: 'Nuneaton', region: 'birmingham',
    slots: [slot('manufacturer', 'brewery'), slot('cotton', 'coal')]
  },
  redditch: {
    name: 'Redditch', region: 'birmingham',
    slots: [slot('manufacturer', 'coal'), slot('iron')]
  },
  'farm-north': {
    name: 'Farm Brewery (North)', region: 'farm', farm: true,
    slots: [slot('brewery')]
  },
  'farm-south': {
    name: 'Farm Brewery (South)', region: 'farm', farm: true,
    slots: [slot('brewery')]
  }
};

export const LOCATIONS = Object.freeze(Object.fromEntries(
  Object.entries(LOCATION_DATA).map(([id, def]) => [id, Object.freeze({
    id,
    name: def.name,
    region: def.region,
    farm: !!def.farm,
    slots: def.slots
  })])
));

const NAMED_LOCATION_IDS = Object.keys(LOCATIONS).filter((id) => !LOCATIONS[id].farm);
const LOCATION_IDS = Object.keys(LOCATIONS);

export const MERCHANTS = Object.freeze({
  shrewsbury: Object.freeze({ name: 'Shrewsbury', slots: 1, minPlayers: 2, bonus: Object.freeze({ type: 'vp', amount: 4 }) }),
  gloucester: Object.freeze({ name: 'Gloucester', slots: 2, minPlayers: 2, bonus: Object.freeze({ type: 'develop', amount: 1 }) }),
  oxford: Object.freeze({ name: 'Oxford', slots: 2, minPlayers: 2, bonus: Object.freeze({ type: 'income', amount: 2 }) }),
  warrington: Object.freeze({ name: 'Warrington', slots: 2, minPlayers: 3, bonus: Object.freeze({ type: 'money', amount: 5 }) }),
  nottingham: Object.freeze({ name: 'Nottingham', slots: 2, minPlayers: 4, bonus: Object.freeze({ type: 'vp', amount: 3 }) })
});

const MERCHANT_IDS = Object.keys(MERCHANTS);

/*
 * 39 board edges. Each edge says whether a canal / rail link may be built on
 * it. `extra` models the southern farm brewery, which is simultaneously
 * connected by the single Kidderminster–Worcester link.
 */
export const LINKS = Object.freeze([
  { a: 'belper', b: 'derby', canal: true, rail: true },
  { a: 'belper', b: 'leek', canal: false, rail: true },
  { a: 'birmingham', b: 'coventry', canal: true, rail: true },
  { a: 'birmingham', b: 'dudley', canal: true, rail: true },
  { a: 'birmingham', b: 'nuneaton', canal: false, rail: true },
  { a: 'birmingham', b: 'oxford', canal: true, rail: true },
  { a: 'birmingham', b: 'redditch', canal: false, rail: true },
  { a: 'birmingham', b: 'tamworth', canal: true, rail: true },
  { a: 'birmingham', b: 'walsall', canal: true, rail: true },
  { a: 'birmingham', b: 'worcester', canal: true, rail: true },
  { a: 'burton-on-trent', b: 'cannock', canal: false, rail: true },
  { a: 'burton-on-trent', b: 'derby', canal: true, rail: true },
  { a: 'burton-on-trent', b: 'stone', canal: true, rail: true },
  { a: 'burton-on-trent', b: 'tamworth', canal: true, rail: true },
  { a: 'burton-on-trent', b: 'walsall', canal: true, rail: false },
  { a: 'cannock', b: 'stafford', canal: true, rail: true },
  { a: 'cannock', b: 'farm-north', canal: true, rail: true },
  { a: 'cannock', b: 'walsall', canal: true, rail: true },
  { a: 'cannock', b: 'wolverhampton', canal: true, rail: true },
  { a: 'coalbrookdale', b: 'kidderminster', canal: true, rail: true },
  { a: 'coalbrookdale', b: 'shrewsbury', canal: true, rail: true },
  { a: 'coalbrookdale', b: 'wolverhampton', canal: true, rail: true },
  { a: 'coventry', b: 'nuneaton', canal: false, rail: true },
  { a: 'derby', b: 'nottingham', canal: true, rail: true },
  { a: 'derby', b: 'uttoxeter', canal: false, rail: true },
  { a: 'dudley', b: 'kidderminster', canal: true, rail: true },
  { a: 'dudley', b: 'wolverhampton', canal: true, rail: true },
  { a: 'gloucester', b: 'redditch', canal: true, rail: true },
  { a: 'gloucester', b: 'worcester', canal: true, rail: true },
  { a: 'kidderminster', b: 'worcester', canal: true, rail: true, extra: ['farm-south'] },
  { a: 'leek', b: 'stoke-on-trent', canal: true, rail: true },
  { a: 'nuneaton', b: 'tamworth', canal: true, rail: true },
  { a: 'redditch', b: 'oxford', canal: true, rail: true },
  { a: 'stafford', b: 'stone', canal: true, rail: true },
  { a: 'stoke-on-trent', b: 'stone', canal: true, rail: true },
  { a: 'stoke-on-trent', b: 'warrington', canal: true, rail: true },
  { a: 'stone', b: 'uttoxeter', canal: false, rail: true },
  { a: 'tamworth', b: 'walsall', canal: false, rail: true },
  { a: 'walsall', b: 'wolverhampton', canal: true, rail: true }
]);

function endpointsOf(edgeIndex) {
  const link = LINKS[edgeIndex];
  if (!link) throw new Error('Brass illegal: unknown edge ' + edgeIndex);
  return link.extra ? [link.a, link.b, ...link.extra] : [link.a, link.b];
}

/* ------------------------------------------------------------------ */
/* Industry tile data (45 tiles per player)                           */
/* ------------------------------------------------------------------ */

const TILE_ROWS = [
  // Cotton Mill (sell)
  { industry: 'cotton', level: 1, count: 3, cost: 12, beer: 1, vp: 5, income: 5, linkIcons: 1, railBuildable: false },
  { industry: 'cotton', level: 2, count: 2, cost: 14, coal: 1, beer: 1, vp: 5, income: 4, linkIcons: 2 },
  { industry: 'cotton', level: 3, count: 3, cost: 16, coal: 1, iron: 1, beer: 1, vp: 9, income: 3, linkIcons: 1 },
  { industry: 'cotton', level: 4, count: 3, cost: 18, coal: 1, iron: 1, beer: 1, vp: 12, income: 2, linkIcons: 1 },
  // Manufacturer (sell)
  { industry: 'manufacturer', level: 1, count: 1, cost: 8, coal: 1, beer: 1, vp: 3, income: 5, linkIcons: 2, railBuildable: false },
  { industry: 'manufacturer', level: 2, count: 2, cost: 10, iron: 1, beer: 1, vp: 5, income: 1, linkIcons: 1 },
  { industry: 'manufacturer', level: 3, count: 1, cost: 12, coal: 2, beer: 0, vp: 4, income: 4, linkIcons: 0 },
  { industry: 'manufacturer', level: 4, count: 1, cost: 8, iron: 1, beer: 1, vp: 3, income: 6, linkIcons: 1 },
  { industry: 'manufacturer', level: 5, count: 2, cost: 16, coal: 1, beer: 2, vp: 8, income: 2, linkIcons: 2 },
  { industry: 'manufacturer', level: 6, count: 1, cost: 20, beer: 1, vp: 7, income: 6, linkIcons: 1 },
  { industry: 'manufacturer', level: 7, count: 1, cost: 16, coal: 1, iron: 1, beer: 0, vp: 9, income: 4, linkIcons: 0 },
  { industry: 'manufacturer', level: 8, count: 2, cost: 20, iron: 2, beer: 1, vp: 11, income: 1, linkIcons: 1 },
  // Pottery (sell)
  { industry: 'pottery', level: 1, count: 1, cost: 17, iron: 1, beer: 1, vp: 10, income: 5, linkIcons: 1, developable: false, railBuildable: true },
  { industry: 'pottery', level: 2, count: 1, cost: 0, coal: 1, beer: 1, vp: 1, income: 1, linkIcons: 1 },
  { industry: 'pottery', level: 3, count: 1, cost: 22, coal: 2, beer: 2, vp: 11, income: 5, linkIcons: 1, developable: false },
  { industry: 'pottery', level: 4, count: 1, cost: 0, coal: 1, beer: 1, vp: 1, income: 1, linkIcons: 1 },
  { industry: 'pottery', level: 5, count: 1, cost: 24, coal: 2, beer: 2, vp: 20, income: 5, linkIcons: 1, railOnly: true },
  // Coal Mine (flips when coal exhausted)
  { industry: 'coal', level: 1, count: 1, cost: 5, resources: 2, vp: 1, income: 4, linkIcons: 2, railBuildable: false },
  { industry: 'coal', level: 2, count: 2, cost: 7, resources: 3, vp: 2, income: 7, linkIcons: 1 },
  { industry: 'coal', level: 3, count: 2, cost: 8, iron: 1, resources: 4, vp: 3, income: 6, linkIcons: 1 },
  { industry: 'coal', level: 4, count: 2, cost: 10, iron: 1, resources: 5, vp: 4, income: 5, linkIcons: 1 },
  // Iron Works (flips when iron exhausted)
  { industry: 'iron', level: 1, count: 1, cost: 5, coal: 1, resources: 4, vp: 3, income: 3, linkIcons: 1, railBuildable: false },
  { industry: 'iron', level: 2, count: 1, cost: 7, coal: 1, resources: 4, vp: 5, income: 3, linkIcons: 1 },
  { industry: 'iron', level: 3, count: 1, cost: 9, coal: 1, resources: 5, vp: 7, income: 2, linkIcons: 1 },
  { industry: 'iron', level: 4, count: 1, cost: 12, coal: 1, resources: 6, vp: 9, income: 1, linkIcons: 1 },
  // Brewery (flips when beer exhausted; barrels by era, not level)
  { industry: 'brewery', level: 1, count: 2, cost: 5, iron: 1, vp: 4, income: 4, linkIcons: 2, railBuildable: false },
  { industry: 'brewery', level: 2, count: 2, cost: 7, iron: 1, vp: 5, income: 5, linkIcons: 2 },
  { industry: 'brewery', level: 3, count: 2, cost: 9, iron: 1, vp: 7, income: 5, linkIcons: 2 },
  { industry: 'brewery', level: 4, count: 1, cost: 9, iron: 1, vp: 10, income: 5, linkIcons: 2, railOnly: true }
];

export const TILES = Object.freeze(TILE_ROWS.map((row) => Object.freeze({
  industry: row.industry,
  level: row.level,
  count: row.count,
  cost: row.cost || 0,
  coal: row.coal || 0,
  iron: row.iron || 0,
  beer: row.beer || 0,
  resources: row.resources || 0,
  vp: row.vp,
  income: row.income,
  linkIcons: row.linkIcons,
  railBuildable: row.railBuildable !== false,
  railOnly: !!row.railOnly,
  developable: row.developable !== false,
  sellable: SELLABLE.has(row.industry),
  flipsBy: SELLABLE.has(row.industry) ? 'sell' : 'resource-exhaustion'
})));

export function tileDef(industry, level) {
  return TILES.find((t) => t.industry === industry && t.level === level) || null;
}

function expandPlayerTiles() {
  const out = [];
  for (const def of TILES) {
    for (let i = 0; i < def.count; i += 1) out.push(def);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Card data (2p=40 / 3p=54 / 4p=64; wild cards are a separate supply) */
/* ------------------------------------------------------------------ */

const CARD_SPECS = [
  { minPlayers: 2, count: 3, kind: 'location', location: 'birmingham' },
  { minPlayers: 2, count: 3, kind: 'location', location: 'coventry' },
  { minPlayers: 2, count: 3, kind: 'location', location: 'coalbrookdale' },
  { minPlayers: 4, count: 3, kind: 'location', location: 'derby' },
  { minPlayers: 3, count: 3, kind: 'location', location: 'stoke-on-trent' },
  { minPlayers: 4, count: 2, kind: 'location', location: 'belper' },
  { minPlayers: 3, count: 2, kind: 'location', location: 'leek' },
  { minPlayers: 3, count: 2, kind: 'location', location: 'stone' },
  { minPlayers: 4, count: 1, kind: 'location', location: 'uttoxeter' },
  { minPlayers: 3, count: 1, kind: 'location', location: 'uttoxeter' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'stafford' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'burton-on-trent' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'cannock' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'dudley' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'kidderminster' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'wolverhampton' },
  { minPlayers: 2, count: 2, kind: 'location', location: 'worcester' },
  { minPlayers: 2, count: 1, kind: 'location', location: 'tamworth' },
  { minPlayers: 2, count: 1, kind: 'location', location: 'walsall' },
  { minPlayers: 2, count: 1, kind: 'location', location: 'nuneaton' },
  { minPlayers: 2, count: 1, kind: 'location', location: 'redditch' },
  { minPlayers: 2, count: 4, kind: 'industry', industries: ['iron'] },
  { minPlayers: 4, count: 1, kind: 'industry', industries: ['coal'] },
  { minPlayers: 2, count: 2, kind: 'industry', industries: ['coal'] },
  { minPlayers: 4, count: 1, kind: 'industry', industries: ['pottery'] },
  { minPlayers: 2, count: 2, kind: 'industry', industries: ['pottery'] },
  { minPlayers: 2, count: 5, kind: 'industry', industries: ['brewery'] },
  { minPlayers: 4, count: 2, kind: 'industry', industries: ['cotton', 'manufacturer'] },
  { minPlayers: 3, count: 6, kind: 'industry', industries: ['cotton', 'manufacturer'] }
];

export function buildDeck(playerCount) {
  const out = [];
  const counters = new Map();
  for (const spec of CARD_SPECS) {
    if (spec.minPlayers > playerCount) continue;
    const baseId = spec.kind === 'location'
      ? 'loc-' + spec.location
      : 'ind-' + spec.industries.join('-');
    for (let i = 0; i < spec.count; i += 1) {
      const n = counters.get(baseId) || 0;
      counters.set(baseId, n + 1);
      const card = { id: baseId + '-' + n, kind: spec.kind };
      if (spec.kind === 'location') card.location = spec.location;
      else card.industries = spec.industries.slice();
      out.push(card);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Generic helpers                                                    */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('Brass illegal: ' + message);
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

function makeMarketFilled(size, filledCount) {
  const arr = new Array(size).fill(true);
  for (let i = 0; i < size - filledCount; i += 1) arr[i] = false;
  return arr;
}

function filledCount(filled) {
  let n = 0;
  for (const f of filled) if (f) n += 1;
  return n;
}

function makeCardIndex(player) {
  const map = new Map();
  for (const card of player.hand) map.set(card.id, card);
  return map;
}

function findCard(player, cardId) {
  return player.hand.find((c) => c.id === cardId) || null;
}

function discardCard(state, playerIndex, cardId) {
  const ps = state.players[playerIndex];
  const idx = ps.hand.findIndex((c) => c.id === cardId);
  assert(idx >= 0, 'card ' + cardId + ' is not in hand');
  const [card] = ps.hand.splice(idx, 1);
  if (card.kind === 'wild-location') state.wildSupply.location += 1;
  else if (card.kind === 'wild-industry') state.wildSupply.industry += 1;
  else state.discard.push(card);
  return card;
}

function gainWild(state, playerIndex, kind) {
  const key = kind === 'wild-location' ? 'location' : 'industry';
  assert(state.wildSupply[key] > 0, 'no ' + kind + ' left in supply');
  state.wildSupply[key] -= 1;
  const card = { id: kind + '-' + state.nextWildId, kind };
  state.nextWildId += 1;
  state.players[playerIndex].hand.push(card);
  return card;
}

/* ------------------------------------------------------------------ */
/* Income track                                                       */
/* ------------------------------------------------------------------ */

export function incomeLevelAt(space) {
  if (space < 0 || space > INCOME_SPACE_MAX) throw new RangeError('income space out of range: ' + space);
  if (space <= 10) return space - 10;
  if (space <= 30) return 1 + Math.floor((space - 11) / 2);
  if (space <= 60) return 11 + Math.floor((space - 31) / 3);
  if (space <= 96) return 21 + Math.floor((space - 61) / 4);
  return 30;
}

export function incomeSpaceForLevelTop(level) {
  if (level < INCOME_LEVEL_MIN || level > INCOME_LEVEL_MAX) throw new RangeError('income level out of range: ' + level);
  if (level <= 0) return level + 10;
  if (level <= 10) return 10 + 2 * level;
  if (level <= 20) return 30 + 3 * (level - 10);
  if (level <= 29) return 60 + 4 * (level - 20);
  return 99;
}

function advanceIncome(state, playerIndex, spaces) {
  const ps = state.players[playerIndex];
  ps.incomeSpace = Math.min(INCOME_SPACE_MAX, ps.incomeSpace + Math.max(0, spaces));
}

/* ------------------------------------------------------------------ */
/* Network / connectivity                                             */
/* ------------------------------------------------------------------ */

function adjacencyFromLinks(links) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  for (const link of links) {
    const eps = endpointsOf(link.edge);
    for (let i = 0; i < eps.length; i += 1) {
      for (let j = i + 1; j < eps.length; j += 1) add(eps[i], eps[j]);
    }
  }
  return adj;
}

function distancesFromNodes(starts, links) {
  const adj = adjacencyFromLinks(links);
  const dist = new Map();
  const queue = [];
  for (const start of starts) {
    if (!dist.has(start)) {
      dist.set(start, 0);
      queue.push(start);
    }
  }
  for (let q = 0; q < queue.length; q += 1) {
    const node = queue[q];
    const next = adj.get(node);
    if (!next) continue;
    for (const nb of next) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(node) + 1);
        queue.push(nb);
      }
    }
  }
  return dist;
}

function reachableMerchantFromLinks(starts, links) {
  const dist = distancesFromNodes(starts, links);
  for (const node of dist.keys()) {
    if (Object.prototype.hasOwnProperty.call(MERCHANTS, node)) return true;
  }
  return false;
}

function ownNetwork(state, playerIndex) {
  const set = new Set();
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (const tile of slots) {
      if (tile && tile.player === playerIndex) set.add(location);
    }
  }
  for (const link of state.board.links) {
    if (link.player !== playerIndex) continue;
    for (const ep of endpointsOf(link.edge)) set.add(ep);
  }
  return set;
}

function playerHasBoardPieces(state, playerIndex) {
  return ownNetwork(state, playerIndex).size > 0;
}

/* ------------------------------------------------------------------ */
/* Markets                                                            */
/* ------------------------------------------------------------------ */

function planMarketBuy(filled, prices, amount, fallbackPrice) {
  const indices = [];
  let cost = 0;
  let remaining = amount;
  for (let i = 0; i < filled.length && remaining > 0; i += 1) {
    if (!filled[i]) continue;
    indices.push(i);
    cost += prices[i];
    remaining -= 1;
  }
  cost += remaining * fallbackPrice;
  for (const i of indices) filled[i] = false;
  return { cost, indices, fallbackCount: remaining };
}

function planMarketSell(filled, prices, amount) {
  const indices = [];
  let revenue = 0;
  let sold = 0;
  for (let i = filled.length - 1; i >= 0 && sold < amount; i -= 1) {
    if (filled[i]) continue;
    indices.push(i);
    revenue += prices[i];
    sold += 1;
  }
  for (const i of indices) filled[i] = true;
  return { revenue, indices, sold };
}

function globalResourceCount(state, industry) {
  let n = industry === 'coal' ? filledCount(state.markets.coal) : filledCount(state.markets.iron);
  for (const slots of Object.values(state.board.slots)) {
    for (const tile of slots) {
      if (tile && tile.def.industry === industry) n += tile.resources;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Coal / iron plans                                                  */
/* ------------------------------------------------------------------ */

function coalSourcesFor(state, atNodes, links, consumed) {
  const dist = distancesFromNodes(atNodes, links);
  const out = [];
  for (const [location, slots] of Object.entries(state.board.slots)) {
    const distance = dist.get(location);
    if (distance === undefined) continue;
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (!tile || tile.flipped || tile.def.industry !== 'coal') continue;
      const key = location + ':' + i;
      const available = tile.resources - (consumed.get(key) || 0);
      if (available > 0) {
        out.push({ location, slotIndex: i, available, distance, key });
      }
    }
  }
  out.sort((a, b) =>
    a.distance - b.distance ||
    (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
    a.slotIndex - b.slotIndex
  );
  return out;
}

function planCoalDetailed(state, atNodes, amount, links, consumed, marketFilled) {
  if (amount <= 0) return { free: [], marketCost: 0, marketCount: 0 };
  const sources = coalSourcesFor(state, atNodes, links, consumed);
  const free = [];
  let need = amount;
  for (const source of sources) {
    if (need <= 0) break;
    const take = Math.min(need, source.available);
    free.push({ location: source.location, slotIndex: source.slotIndex, take });
    consumed.set(source.key, (consumed.get(source.key) || 0) + take);
    need -= take;
  }
  if (need > 0) {
    if (!reachableMerchantFromLinks(atNodes, links)) return null;
    const buy = planMarketBuy(marketFilled, COAL_MARKET_PRICES, need, COAL_FALLBACK_PRICE);
    return { free, marketCost: buy.cost, marketCount: need };
  }
  return { free, marketCost: 0, marketCount: 0 };
}

function planCoal(state, atNodes, amount) {
  return planCoalDetailed(
    state,
    atNodes,
    amount,
    state.board.links,
    new Map(),
    state.markets.coal.slice()
  );
}

function ironSourcesFor(state, consumed) {
  const out = [];
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (!tile || tile.flipped || tile.def.industry !== 'iron') continue;
      const key = location + ':' + i;
      const available = tile.resources - (consumed.get(key) || 0);
      if (available > 0) out.push({ location, slotIndex: i, available, key });
    }
  }
  out.sort((a, b) =>
    (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
    a.slotIndex - b.slotIndex
  );
  return out;
}

function planIron(state, amount) {
  if (amount <= 0) return { free: [], marketCost: 0, marketCount: 0 };
  const consumed = new Map();
  const sources = ironSourcesFor(state, consumed);
  const free = [];
  let need = amount;
  for (const source of sources) {
    if (need <= 0) break;
    const take = Math.min(need, source.available);
    free.push({ location: source.location, slotIndex: source.slotIndex, take });
    need -= take;
  }
  if (need > 0) {
    const buy = planMarketBuy(state.markets.iron.slice(), IRON_MARKET_PRICES, need, IRON_FALLBACK_PRICE);
    return { free, marketCost: buy.cost, marketCount: need };
  }
  return { free, marketCost: 0, marketCount: 0 };
}

function flipTile(state, location, slotIndex) {
  const tile = state.board.slots[location][slotIndex];
  assert(tile, 'no tile to flip at ' + location + ':' + slotIndex);
  assert(!tile.flipped, 'tile already flipped at ' + location + ':' + slotIndex);
  tile.flipped = true;
  advanceIncome(state, tile.player, tile.def.income);
  state.lastEvents.push({
    kind: 'flip', player: tile.player, location, incomeAdvance: tile.def.income
  });
}

function applyCoalPlan(state, playerIndex, plan) {
  for (const source of plan.free) {
    const tile = state.board.slots[source.location][source.slotIndex];
    tile.resources -= source.take;
    if (tile.resources === 0) flipTile(state, source.location, source.slotIndex);
  }
  if (plan.marketCount > 0) {
    const buy = planMarketBuy(state.markets.coal, COAL_MARKET_PRICES, plan.marketCount, COAL_FALLBACK_PRICE);
    const ps = state.players[playerIndex];
    assert(ps.money >= buy.cost, 'not enough money for coal market');
    ps.money -= buy.cost;
    ps.spentThisRound += buy.cost;
  }
}

function applyIronPlan(state, playerIndex, plan) {
  for (const source of plan.free) {
    const tile = state.board.slots[source.location][source.slotIndex];
    tile.resources -= source.take;
    if (tile.resources === 0) flipTile(state, source.location, source.slotIndex);
  }
  if (plan.marketCount > 0) {
    const buy = planMarketBuy(state.markets.iron, IRON_MARKET_PRICES, plan.marketCount, IRON_FALLBACK_PRICE);
    const ps = state.players[playerIndex];
    assert(ps.money >= buy.cost, 'not enough money for iron market');
    ps.money -= buy.cost;
    ps.spentThisRound += buy.cost;
  }
}

/* ------------------------------------------------------------------ */
/* Beer                                                               */
/* ------------------------------------------------------------------ */

function merchantAccepts(state, merchantId, industry) {
  const m = state.merchants[merchantId];
  if (!m) return false;
  return m.tiles.some((face) => face === 'any' || face === industry);
}

function merchantBarrelIndex(state, merchantId, industry) {
  const m = state.merchants[merchantId];
  if (!m) return -1;
  for (let i = 0; i < m.tiles.length; i += 1) {
    if (m.barrels[i] && (m.tiles[i] === 'any' || m.tiles[i] === industry)) return i;
  }
  return -1;
}

function countBreweryBeer(state, playerIndex, atNodes, links) {
  const reachable = atNodes ? distancesFromNodes(atNodes, links) : new Map();
  let total = 0;
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (const tile of slots) {
      if (!tile || tile.flipped || tile.def.industry !== 'brewery' || tile.resources <= 0) continue;
      if (tile.player === playerIndex || reachable.has(location)) total += tile.resources;
    }
  }
  return total;
}

function consumeBreweryBeer(state, playerIndex, amount, atNodes) {
  if (amount <= 0) return;
  const reachable = atNodes ? distancesFromNodes(atNodes, state.board.links) : new Map();
  const sources = [];
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (!tile || tile.flipped || tile.def.industry !== 'brewery' || tile.resources <= 0) continue;
      if (tile.player === playerIndex || reachable.has(location)) {
        sources.push({ location, slotIndex: i, own: tile.player === playerIndex, player: tile.player });
      }
    }
  }
  sources.sort((a, b) =>
    (a.own === b.own ? 0 : a.own ? -1 : 1) ||
    (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
    a.slotIndex - b.slotIndex
  );
  let need = amount;
  for (const source of sources) {
    if (need <= 0) break;
    const tile = state.board.slots[source.location][source.slotIndex];
    const take = Math.min(need, tile.resources);
    tile.resources -= take;
    need -= take;
    if (tile.resources === 0) flipTile(state, source.location, source.slotIndex);
  }
  assert(need === 0, 'not enough beer');
}

function hasBreweryBeerForDoubleRail(state, playerIndex, secondLinkEndpoints, links) {
  const reachable = distancesFromNodes(secondLinkEndpoints, links);
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (const tile of slots) {
      if (!tile || tile.flipped || tile.def.industry !== 'brewery' || tile.resources <= 0) continue;
      if (tile.player === playerIndex || reachable.has(location)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Build target resolution                                            */
/* ------------------------------------------------------------------ */

function nextTileOf(player, industry) {
  return player.tiles.find((t) => t.industry === industry) || null;
}

function removeNextTile(player, industry) {
  const idx = player.tiles.findIndex((t) => t.industry === industry);
  assert(idx >= 0, 'no tile left for ' + industry);
  return player.tiles.splice(idx, 1)[0];
}

function resolveBuildTarget(state, playerIndex, location, industry, def, explicitSlot) {
  const loc = LOCATIONS[location];
  if (!loc) return null;
  const slotDefs = loc.slots;
  const placed = state.board.slots[location];
  if (!slotDefs || !placed) return null;

  const ownAt = placed.some((t) => t && t.player === playerIndex);
  const canalBlocked = state.era === ERA.CANAL && ownAt;

  const vacantSingle = [];
  const vacantDual = [];
  for (let i = 0; i < slotDefs.length; i += 1) {
    if (placed[i] !== null) continue;
    if (!slotDefs[i].industries.includes(industry)) continue;
    if (slotDefs[i].industries.length === 1) vacantSingle.push(i);
    else vacantDual.push(i);
  }

  const overbuildCandidates = [];
  for (let i = 0; i < slotDefs.length; i += 1) {
    const tile = placed[i];
    if (!tile) continue;
    if (!slotDefs[i].industries.includes(industry)) continue;
    if (tile.player === playerIndex) {
      if (tile.def.industry === industry && tile.def.level < def.level) {
        overbuildCandidates.push({ slotIndex: i, kind: 'own', level: tile.def.level });
      }
    } else if (!canalBlocked && (industry === 'coal' || industry === 'iron')) {
      if (
        tile.def.industry === industry &&
        tile.def.level < def.level &&
        globalResourceCount(state, industry) === 0
      ) {
        overbuildCandidates.push({ slotIndex: i, kind: 'opponent', level: tile.def.level });
      }
    }
  }
  overbuildCandidates.sort((a, b) => a.level - b.level || a.slotIndex - b.slotIndex);

  if (explicitSlot !== undefined && explicitSlot !== null) {
    if (!Number.isInteger(explicitSlot) || explicitSlot < 0 || explicitSlot >= slotDefs.length) return null;
    const isVacant = placed[explicitSlot] === null && slotDefs[explicitSlot].industries.includes(industry);
    if (isVacant) {
      if (canalBlocked) return null;
      if (vacantSingle.length > 0 && !vacantSingle.includes(explicitSlot)) return null;
      if (vacantSingle.length === 0 && !vacantDual.includes(explicitSlot)) return null;
      return { slotIndex: explicitSlot, overbuild: 'none' };
    }
    const candidate = overbuildCandidates.find((c) => c.slotIndex === explicitSlot);
    return candidate ? { slotIndex: candidate.slotIndex, overbuild: candidate.kind } : null;
  }

  if (!canalBlocked) {
    if (vacantSingle.length > 0) return { slotIndex: vacantSingle[0], overbuild: 'none' };
    if (vacantDual.length > 0) return { slotIndex: vacantDual[0], overbuild: 'none' };
  }
  if (overbuildCandidates.length > 0) {
    return { slotIndex: overbuildCandidates[0].slotIndex, overbuild: overbuildCandidates[0].kind };
  }
  return null;
}

function networkLocations(state, playerIndex) {
  if (!playerHasBoardPieces(state, playerIndex)) return LOCATION_IDS.slice();
  const net = ownNetwork(state, playerIndex);
  return LOCATION_IDS.filter((loc) => net.has(loc));
}

function buildCardAllows(state, playerIndex, card, location, industry) {
  const loc = LOCATIONS[location];
  if (!loc) return false;
  if (card.kind === 'location') {
    return !loc.farm && card.location === location;
  }
  if (card.kind === 'wild-location') {
    return !loc.farm;
  }
  if (card.kind === 'industry') {
    if (!card.industries.includes(industry)) return false;
    if (loc.farm && industry !== 'brewery') return false;
    return !playerHasBoardPieces(state, playerIndex) || ownNetwork(state, playerIndex).has(location);
  }
  if (card.kind === 'wild-industry') {
    return !playerHasBoardPieces(state, playerIndex) || ownNetwork(state, playerIndex).has(location);
  }
  return false;
}

function buildResourcePlan(state, playerIndex, location, def) {
  const coal = planCoal(state, [location], def.coal);
  if (!coal) return null;
  const iron = planIron(state, def.iron);
  const total = def.cost + coal.marketCost + iron.marketCost;
  if (total > state.players[playerIndex].money) return null;
  return { coal, iron, total };
}

/* ------------------------------------------------------------------ */
/* Action enumerators                                                 */
/* ------------------------------------------------------------------ */

function enumerateBuilds(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  const emptyBoard = !playerHasBoardPieces(state, playerIndex);
  for (const card of ps.hand) {
    let locations;
    let industries;
    if (card.kind === 'location') {
      locations = [card.location];
      industries = ALL_INDUSTRIES;
    } else if (card.kind === 'wild-location') {
      locations = NAMED_LOCATION_IDS;
      industries = ALL_INDUSTRIES;
    } else if (card.kind === 'industry') {
      locations = emptyBoard ? LOCATION_IDS : LOCATION_IDS.filter((loc) => ownNetwork(state, playerIndex).has(loc));
      industries = card.industries;
    } else if (card.kind === 'wild-industry') {
      locations = emptyBoard ? LOCATION_IDS : LOCATION_IDS.filter((loc) => ownNetwork(state, playerIndex).has(loc));
      industries = ALL_INDUSTRIES;
    } else {
      continue;
    }
    for (const industry of industries) {
      const def = nextTileOf(ps, industry);
      if (!def) continue;
      if (state.era === ERA.CANAL && def.railOnly) continue;
      if (state.era === ERA.RAIL && !def.railBuildable) continue;
      for (const location of locations) {
        if (!buildCardAllows(state, playerIndex, card, location, industry)) continue;
        const target = resolveBuildTarget(state, playerIndex, location, industry, def);
        if (!target) continue;
        const plan = buildResourcePlan(state, playerIndex, location, def);
        if (!plan) continue;
        out.push({
          type: 'build',
          cardId: card.id,
          industry,
          location,
          slotIndex: target.slotIndex
        });
      }
    }
  }
  return out;
}

function validateNetworkPlan(state, playerIndex, links) {
  const ps = state.players[playerIndex];
  const emptyBoard = !playerHasBoardPieces(state, playerIndex);
  const ownNet = ownNetwork(state, playerIndex);
  const virtualLinks = state.board.links.slice();
  const consumed = new Map();
  const marketFilled = state.markets.coal.slice();
  let marketCost = 0;

  if (state.era === ERA.CANAL && links.length !== 1) return false;
  if (state.era === ERA.RAIL && (links.length < 1 || links.length > 2)) return false;
  if (new Set(links).size !== links.length) return false;

  for (let k = 0; k < links.length; k += 1) {
    const edgeIndex = links[k];
    const linkDef = LINKS[edgeIndex];
    if (!linkDef) return false;
    if (state.era === ERA.CANAL ? !linkDef.canal : !linkDef.rail) return false;
    if (state.board.links.some((l) => l.edge === edgeIndex)) return false;
    const eps = endpointsOf(edgeIndex);
    const adjacent = (emptyBoard && k === 0) ? true : eps.some((ep) => ownNet.has(ep));
    if (!adjacent) return false;
    virtualLinks.push({ edge: edgeIndex, player: playerIndex, era: state.era });
    for (const ep of eps) ownNet.add(ep);
    if (state.era === ERA.RAIL) {
      const plan = planCoalDetailed(state, eps, 1, virtualLinks, consumed, marketFilled);
      if (!plan) return false;
      marketCost += plan.marketCost;
    }
  }

  if (state.era === ERA.RAIL && links.length === 2) {
    if (!hasBreweryBeerForDoubleRail(state, playerIndex, endpointsOf(links[1]), virtualLinks)) return false;
  }

  const baseCost = state.era === ERA.CANAL
    ? CANAL_LINK_COST
    : links.length === 1 ? RAIL_LINK_COST : RAIL_DOUBLE_LINK_COST;
  return ps.money >= baseCost + marketCost;
}

function enumerateNetworks(state, playerIndex) {
  const ps = state.players[playerIndex];
  if (ps.hand.length === 0) return [];
  const candidates = [];
  for (let i = 0; i < LINKS.length; i += 1) {
    const def = LINKS[i];
    if (state.era === ERA.CANAL ? !def.canal : !def.rail) continue;
    if (state.board.links.some((l) => l.edge === i)) continue;
    candidates.push(i);
  }
  const out = [];
  for (const card of ps.hand) {
    for (const edgeIndex of candidates) {
      if (validateNetworkPlan(state, playerIndex, [edgeIndex])) {
        out.push({ type: 'network', cardId: card.id, links: [edgeIndex] });
      }
    }
  }
  if (state.era === ERA.RAIL) {
    const ownNet = ownNetwork(state, playerIndex);
    const emptyBoard = ownNet.size === 0;
    const firstEdges = candidates.filter((edgeIndex) =>
      emptyBoard || endpointsOf(edgeIndex).some((ep) => ownNet.has(ep))
    );
    const doubles = [];
    for (const i of firstEdges) {
      const netAfterFirst = new Set(ownNet);
      for (const ep of endpointsOf(i)) netAfterFirst.add(ep);
      for (const j of candidates) {
        if (i === j) continue;
        if (!endpointsOf(j).some((ep) => netAfterFirst.has(ep))) continue;
        if (validateNetworkPlan(state, playerIndex, [i, j])) doubles.push([i, j]);
      }
    }
    if (doubles.length > 0) {
      // Card choice for a double rail is enumerated only for the first hand
      // card; the engine accepts the same link pair with any other card in
      // applyAction. This keeps the action list small without hiding the move.
      const card = ps.hand[0];
      for (const pair of doubles) {
        out.push({ type: 'network', cardId: card.id, links: pair });
      }
    }
  }
  return out;
}

function canRemoveSequence(tiles, sequence) {
  const copy = tiles.slice();
  for (const industry of sequence) {
    const idx = copy.findIndex((t) => t.industry === industry);
    if (idx < 0) return false;
    if (!copy[idx].developable) return false;
    copy.splice(idx, 1);
  }
  return true;
}

function enumerateDevelops(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  for (const card of ps.hand) {
    for (const industry of ALL_INDUSTRIES) {
      if (!canRemoveSequence(ps.tiles, [industry])) continue;
      const iron = planIron(state, 1);
      if (ps.money < iron.marketCost) continue;
      out.push({ type: 'develop', cardId: card.id, removals: [industry] });
    }
    for (let i = 0; i < ALL_INDUSTRIES.length; i += 1) {
      for (let j = i; j < ALL_INDUSTRIES.length; j += 1) {
        const seq = [ALL_INDUSTRIES[i], ALL_INDUSTRIES[j]];
        if (!canRemoveSequence(ps.tiles, seq)) continue;
        const iron = planIron(state, 2);
        if (ps.money < iron.marketCost) continue;
        out.push({ type: 'develop', cardId: card.id, removals: seq });
      }
    }
  }
  return out;
}

function sellableTiles(state, playerIndex) {
  const out = [];
  for (const location of LOCATION_IDS) {
    const slots = state.board.slots[location];
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (!tile || tile.player !== playerIndex || tile.flipped || !tile.def.sellable) continue;
      out.push({ location, slotIndex: i, industry: tile.def.industry, beer: tile.def.beer });
    }
  }
  return out;
}

function beerAvailability(state, playerIndex, merchantId, useMerchantBeer, need) {
  if (need <= 0) return !useMerchantBeer;
  let available = 0;
  if (useMerchantBeer) available += 1;
  available += countBreweryBeer(state, playerIndex, [merchantId], state.board.links);
  return available >= need;
}

function enumerateSells(state, playerIndex) {
  const ps = state.players[playerIndex];
  if (ps.hand.length === 0) return [];
  const tiles = sellableTiles(state, playerIndex);
  if (tiles.length === 0) return [];
  const out = [];
  for (const card of ps.hand) {
    for (const tile of tiles) {
      const reachable = distancesFromNodes([tile.location], state.board.links);
      for (const merchantId of MERCHANT_IDS) {
        if (!reachable.has(merchantId)) continue;
        if (!merchantAccepts(state, merchantId, tile.industry)) continue;
        const barrel = merchantBarrelIndex(state, merchantId, tile.industry);
        for (const useMerchantBeer of [false, true]) {
          if (useMerchantBeer && (tile.beer <= 0 || barrel < 0)) continue;
          if (!beerAvailability(state, playerIndex, merchantId, useMerchantBeer, tile.beer)) continue;
          out.push({
            type: 'sell',
            cardId: card.id,
            sales: [{
              location: tile.location,
              slotIndex: tile.slotIndex,
              merchant: merchantId,
              useMerchantBeer
            }]
          });
        }
      }
    }
  }
  return out;
}

function enumerateLoans(state, playerIndex) {
  const level = incomeLevelAt(state.players[playerIndex].incomeSpace);
  if (level - LOAN_INCOME_LEVELS < INCOME_LEVEL_MIN) return [];
  return state.players[playerIndex].hand.map((card) => ({ type: 'loan', cardId: card.id }));
}

function enumerateScouts(state, playerIndex) {
  const ps = state.players[playerIndex];
  if (state.wildSupply.location < 1 || state.wildSupply.industry < 1) return [];
  if (ps.hand.some((c) => c.kind === 'wild-location' || c.kind === 'wild-industry')) return [];
  if (ps.hand.length < 3) return [];
  const out = [];
  for (let i = 0; i < ps.hand.length; i += 1) {
    for (let j = i + 1; j < ps.hand.length; j += 1) {
      for (let k = j + 1; k < ps.hand.length; k += 1) {
        out.push({
          type: 'scout',
          cardIds: [ps.hand[i].id, ps.hand[j].id, ps.hand[k].id]
        });
      }
    }
  }
  return out;
}

export function currentPlayer(state) {
  if (state.phase === 'game-over') return null;
  const idx = state.turnOrder[state.currentPlayerIdx];
  return idx === undefined ? null : idx;
}

export function legalActions(state, playerIndex) {
  if (state.phase === 'game-over') return [];
  const player = playerIndex === undefined || playerIndex === null
    ? currentPlayer(state)
    : playerIndex;
  if (player === null || player === undefined) return [];
  const ps = state.players[player];
  if (!ps || ps.hand.length === 0) return [];
  return [
    ...enumerateBuilds(state, player),
    ...enumerateNetworks(state, player),
    ...enumerateDevelops(state, player),
    ...enumerateSells(state, player),
    ...enumerateLoans(state, player),
    ...enumerateScouts(state, player),
    ...ps.hand.map((card) => ({ type: 'pass', cardId: card.id }))
  ];
}

/* ------------------------------------------------------------------ */
/* Action execution                                                   */
/* ------------------------------------------------------------------ */

function doBuild(state, playerIndex, action) {
  assert(typeof action.cardId === 'string', 'build needs cardId');
  assert(typeof action.industry === 'string', 'build needs industry');
  assert(typeof action.location === 'string', 'build needs location');
  const ps = state.players[playerIndex];
  const card = findCard(ps, action.cardId);
  assert(card, 'build card is not in hand');
  assert(buildCardAllows(state, playerIndex, card, action.location, action.industry), 'card/location/industry do not match');
  const def = nextTileOf(ps, action.industry);
  assert(def, 'no ' + action.industry + ' tile left on player mat');
  if (state.era === ERA.CANAL) assert(!def.railOnly, 'tile is rail-era only');
  if (state.era === ERA.RAIL) assert(def.railBuildable, 'tile is not buildable in the rail era');
  const target = resolveBuildTarget(state, playerIndex, action.location, action.industry, def, action.slotIndex);
  assert(target, 'no legal slot at ' + action.location);
  const plan = buildResourcePlan(state, playerIndex, action.location, def);
  assert(plan, 'cannot pay/obtain resources for build');

  ps.money -= def.cost;
  ps.spentThisRound += def.cost;
  applyCoalPlan(state, playerIndex, plan.coal);
  applyIronPlan(state, playerIndex, plan.iron);

  removeNextTile(ps, action.industry);
  const resources = def.industry === 'brewery'
    ? (state.era === ERA.CANAL ? 1 : 2)
    : def.resources;
  const placed = { def, player: playerIndex, flipped: false, resources };
  state.board.slots[action.location][target.slotIndex] = placed;

  discardCard(state, playerIndex, action.cardId);

  const sellsToCoalMarket = def.industry === 'coal' && reachableMerchantFromLinks([action.location], state.board.links);
  if (def.industry === 'iron' || sellsToCoalMarket) {
    const market = def.industry === 'iron' ? 'iron' : 'coal';
    const prices = market === 'iron' ? IRON_MARKET_PRICES : COAL_MARKET_PRICES;
    const filled = state.markets[market];
    const sale = planMarketSell(filled, prices, placed.resources);
    if (sale.sold > 0) {
      placed.resources -= sale.sold;
      state.players[playerIndex].money += sale.revenue;
      if (placed.resources === 0) flipTile(state, action.location, target.slotIndex);
    }
  }
}

function doNetwork(state, playerIndex, action) {
  assert(Array.isArray(action.links), 'network needs links array');
  assert(action.links.length === 1 || action.links.length === 2, 'network needs 1 or 2 links');
  assert(findCard(state.players[playerIndex], action.cardId), 'network card is not in hand');
  const links = action.links;
  assert(new Set(links).size === links.length, 'duplicate links');
  if (state.era === ERA.CANAL) assert(links.length === 1, 'canal network action places exactly 1 link');

  const ps = state.players[playerIndex];
  const emptyBoard = !playerHasBoardPieces(state, playerIndex);
  const ownNet = ownNetwork(state, playerIndex);
  const baseCost = state.era === ERA.CANAL
    ? CANAL_LINK_COST
    : links.length === 1 ? RAIL_LINK_COST : RAIL_DOUBLE_LINK_COST;

  for (let k = 0; k < links.length; k += 1) {
    const edgeIndex = links[k];
    const def = LINKS[edgeIndex];
    assert(def, 'unknown link edge');
    if (state.era === ERA.CANAL) assert(def.canal, 'not a canal link');
    else assert(def.rail, 'not a rail link');
    assert(!state.board.links.some((l) => l.edge === edgeIndex), 'link edge already built');
    const eps = endpointsOf(edgeIndex);
    const adjacent = (emptyBoard && k === 0) ? true : eps.some((ep) => ownNet.has(ep));
    assert(adjacent, 'new link is not adjacent to own network');

    state.board.links.push({ edge: edgeIndex, player: playerIndex, era: state.era });
    for (const ep of eps) ownNet.add(ep);

    if (state.era === ERA.RAIL) {
      const plan = planCoal(state, eps, 1);
      assert(plan, 'no connected coal source for rail link');
      assert(ps.money >= baseCost + plan.marketCost, 'not enough money for rail link');
      applyCoalPlan(state, playerIndex, plan);
    }
  }

  if (state.era === ERA.RAIL && links.length === 2) {
    const secondEps = endpointsOf(links[1]);
    assert(
      countBreweryBeer(state, playerIndex, secondEps, state.board.links) >= 1,
      'double rail needs 1 beer from a brewery'
    );
    consumeBreweryBeer(state, playerIndex, 1, secondEps);
  }

  assert(ps.money >= baseCost, 'not enough money for link');
  ps.money -= baseCost;
  ps.spentThisRound += baseCost;
  discardCard(state, playerIndex, action.cardId);
}

function doDevelop(state, playerIndex, action) {
  assert(Array.isArray(action.removals), 'develop needs removals');
  assert(action.removals.length === 1 || action.removals.length === 2, 'develop removes 1 or 2 tiles');
  assert(findCard(state.players[playerIndex], action.cardId), 'develop card is not in hand');
  const ps = state.players[playerIndex];
  assert(canRemoveSequence(ps.tiles, action.removals), 'develop must remove the lowest developable tile of each industry');
  const iron = planIron(state, action.removals.length);
  assert(ps.money >= iron.marketCost, 'not enough money for develop iron');
  for (const industry of action.removals) removeNextTile(ps, industry);
  ps.developsThisEra = (ps.developsThisEra || 0) + 1;
  applyIronPlan(state, playerIndex, iron);
  discardCard(state, playerIndex, action.cardId);
}

function applyMerchantBonus(state, playerIndex, merchantId) {
  const bonus = MERCHANTS[merchantId] && MERCHANTS[merchantId].bonus;
  if (!bonus) return;
  const ps = state.players[playerIndex];
  if (bonus.type === 'vp') {
    ps.vp += bonus.amount;
  } else if (bonus.type === 'money') {
    ps.money += bonus.amount;
  } else if (bonus.type === 'income') {
    advanceIncome(state, playerIndex, bonus.amount);
  } else if (bonus.type === 'develop') {
    for (const industry of ALL_INDUSTRIES) {
      const def = nextTileOf(ps, industry);
      if (def && def.developable) {
        removeNextTile(ps, industry);
        break;
      }
    }
  }
  state.lastEvents.push({ kind: 'merchant-bonus', player: playerIndex, merchant: merchantId });
}

function doSell(state, playerIndex, action) {
  assert(Array.isArray(action.sales) && action.sales.length > 0, 'sell needs at least one sale');
  assert(findCard(state.players[playerIndex], action.cardId), 'sell card is not in hand');
  const ps = state.players[playerIndex];

  for (const sale of action.sales) {
    const slots = state.board.slots[sale.location];
    assert(slots, 'unknown sale location');
    const tile = slots[sale.slotIndex];
    assert(tile && tile.player === playerIndex, 'not your tile');
    assert(!tile.flipped, 'tile already flipped');
    assert(tile.def.sellable, 'tile is not sellable');
    const reachable = distancesFromNodes([sale.location], state.board.links);
    assert(reachable.has(sale.merchant), 'tile is not connected to that merchant');
    assert(merchantAccepts(state, sale.merchant, tile.def.industry), 'merchant does not buy that industry');
    const need = tile.def.beer;
    let merchantBeer = false;
    if (sale.useMerchantBeer) {
      assert(need > 0, 'tile does not need beer');
      const barrel = merchantBarrelIndex(state, sale.merchant, tile.def.industry);
      assert(barrel >= 0, 'no matching merchant beer barrel');
      state.merchants[sale.merchant].barrels[barrel] = false;
      merchantBeer = true;
    }
    const remainingBeer = need - (merchantBeer ? 1 : 0);
    if (remainingBeer > 0) {
      assert(
        countBreweryBeer(state, playerIndex, [sale.merchant], state.board.links) >= remainingBeer,
        'not enough beer'
      );
      consumeBreweryBeer(state, playerIndex, remainingBeer, [sale.merchant]);
    }
    flipTile(state, sale.location, sale.slotIndex);
    if (merchantBeer) applyMerchantBonus(state, playerIndex, sale.merchant);
  }
  discardCard(state, playerIndex, action.cardId);
}

function doLoan(state, playerIndex, action) {
  assert(findCard(state.players[playerIndex], action.cardId), 'loan card is not in hand');
  const ps = state.players[playerIndex];
  const level = incomeLevelAt(ps.incomeSpace);
  const nextLevel = level - LOAN_INCOME_LEVELS;
  assert(nextLevel >= INCOME_LEVEL_MIN, 'loan would take income below -10');
  ps.money += LOAN_AMOUNT;
  ps.incomeSpace = incomeSpaceForLevelTop(nextLevel);
  ps.loansTaken = (ps.loansTaken || 0) + 1;
  discardCard(state, playerIndex, action.cardId);
}

function doScout(state, playerIndex, action) {
  assert(Array.isArray(action.cardIds) && action.cardIds.length === 3, 'scout discards exactly 3 cards');
  const ps = state.players[playerIndex];
  assert(new Set(action.cardIds).size === 3, 'scout cards must be distinct');
  assert(!ps.hand.some((c) => c.kind === 'wild-location' || c.kind === 'wild-industry'), 'cannot scout with a wild card in hand');
  assert(state.wildSupply.location >= 1 && state.wildSupply.industry >= 1, 'wild card supply is empty');
  for (const id of action.cardIds) assert(findCard(ps, id), 'scout card ' + id + ' is not in hand');
  for (const id of action.cardIds) discardCard(state, playerIndex, id);
  gainWild(state, playerIndex, 'wild-location');
  gainWild(state, playerIndex, 'wild-industry');
}

function doPass(state, playerIndex, action) {
  assert(findCard(state.players[playerIndex], action.cardId), 'pass card is not in hand');
  discardCard(state, playerIndex, action.cardId);
}

/* ------------------------------------------------------------------ */
/* Turn / round / era structure                                       */
/* ------------------------------------------------------------------ */

export function actionsPerRound(state) {
  return state.era === ERA.CANAL && state.round === 1
    ? state.rules.firstCanalRoundActions
    : state.rules.actionsPerTurn;
}

function refillHand(state, playerIndex) {
  const ps = state.players[playerIndex];
  const need = state.rules.handSize - ps.hand.length;
  if (need <= 0) return;
  const draw = Math.min(need, state.deck.length);
  if (draw <= 0) return;
  ps.hand.push(...state.deck.splice(0, draw));
}

function eraEndCondition(state) {
  return state.deck.length === 0 && state.players.every((p) => p.hand.length === 0);
}

function findLiquidationTarget(state, playerIndex) {
  let best = null;
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (!tile || tile.player !== playerIndex) continue;
      const value = Math.floor(tile.def.cost / 2);
      if (value <= 0) continue;
      const key = [tile.flipped ? 1 : 0, tile.def.vp, location, i];
      if (!best || key[0] < best.key[0] ||
        (key[0] === best.key[0] && (key[1] < best.key[1] ||
          (key[1] === best.key[1] && (key[2] < best.key[2] ||
            (key[2] === best.key[2] && key[3] < best.key[3])))))) {
        best = { location, slotIndex: i, value, key };
      }
    }
  }
  return best;
}

function payNegativeIncome(state, playerIndex, owed) {
  const ps = state.players[playerIndex];
  let remaining = owed;
  const fromCash = Math.min(ps.money, remaining);
  ps.money -= fromCash;
  remaining -= fromCash;
  while (remaining > 0) {
    const target = findLiquidationTarget(state, playerIndex);
    if (!target) break;
    state.board.slots[target.location][target.slotIndex] = null;
    ps.money += target.value;
    const paid = Math.min(ps.money, remaining);
    ps.money -= paid;
    remaining -= paid;
  }
  if (remaining > 0) ps.vp = Math.max(0, ps.vp - remaining);
}

function settleIncome(state) {
  for (let p = 0; p < state.playerCount; p += 1) {
    const level = incomeLevelAt(state.players[p].incomeSpace);
    if (level > 0) state.players[p].money += level;
    else if (level < 0) payNegativeIncome(state, p, -level);
  }
}

function scoreLinksAndIndustries(state) {
  const record = {
    era: state.era,
    round: state.round,
    perPlayer: state.players.map(() => ({ linkVP: 0, industryVP: 0 }))
  };
  for (const link of state.board.links) {
    let vp = 0;
    for (const ep of endpointsOf(link.edge)) {
      if (Object.prototype.hasOwnProperty.call(MERCHANTS, ep)) {
        vp += 2;
      } else {
        const slots = state.board.slots[ep] || [];
        for (const tile of slots) {
          if (tile && tile.flipped) vp += tile.def.linkIcons;
        }
      }
    }
    state.players[link.player].vp += vp;
    record.perPlayer[link.player].linkVP += vp;
  }
  state.board.links = [];

  for (const slots of Object.values(state.board.slots)) {
    for (const tile of slots) {
      if (!tile || !tile.flipped) continue;
      state.players[tile.player].vp += tile.def.vp;
      record.perPlayer[tile.player].industryVP += tile.def.vp;
    }
  }
  for (let i = 0; i < record.perPlayer.length; i += 1) {
    record.perPlayer[i].vpAfter = state.players[i].vp;
  }
  state.eraHistory.push(record);
}

function removeLevelOneTiles(state) {
  for (const [location, slots] of Object.entries(state.board.slots)) {
    for (let i = 0; i < slots.length; i += 1) {
      const tile = slots[i];
      if (tile && tile.def.level === 1) {
        state.board.slots[location][i] = null;
      }
    }
  }
}

function resetMerchantBeer(state) {
  for (const id of MERCHANT_IDS) {
    const m = state.merchants[id];
    m.barrels = m.tiles.map((face) => face !== 'blank');
  }
}

function moveHandsToDiscard(state) {
  for (const ps of state.players) {
    for (const card of ps.hand) {
      if (card.kind === 'wild-location') state.wildSupply.location += 1;
      else if (card.kind === 'wild-industry') state.wildSupply.industry += 1;
      else state.discard.push(card);
    }
    ps.hand = [];
  }
}

function canalToRail(state) {
  removeLevelOneTiles(state);
  resetMerchantBeer(state);
  moveHandsToDiscard(state);
  const pool = state.discard.concat(state.deck);
  state.deck = shuffleWith(pool, state.seed + ':rail');
  state.discard = [];
  for (const ps of state.players) {
    ps.hand = state.deck.splice(0, Math.min(state.rules.handSize, state.deck.length));
    ps.developsThisEra = 0;
  }
  state.era = ERA.RAIL;
  state.round = 1;
  state.currentPlayerIdx = 0;
  state.actionsThisTurn = 0;
  state.roundNonPass = new Array(state.playerCount).fill(false);
  state.phase = 'action';
}

function determineWinners(state) {
  const key = (i) => [
    state.players[i].vp,
    incomeLevelAt(state.players[i].incomeSpace),
    state.players[i].money
  ];
  let winners = [0];
  for (let i = 1; i < state.playerCount; i += 1) {
    const a = key(i);
    const b = key(winners[0]);
    let cmp = 0;
    for (let k = 0; k < a.length; k += 1) {
      if (a[k] !== b[k]) { cmp = a[k] > b[k] ? 1 : -1; break; }
    }
    if (cmp > 0) winners = [i];
    else if (cmp === 0) winners.push(i);
  }
  return winners;
}

function settleEraEnd(state) {
  scoreLinksAndIndustries(state);
  if (state.era === ERA.CANAL) {
    canalToRail(state);
  } else {
    state.phase = 'game-over';
    state.winner = determineWinners(state);
    state.actionsThisTurn = 0;
    state.currentPlayerIdx = 0;
  }
}

function skipCardlessPlayers(state) {
  while (
    state.currentPlayerIdx < state.turnOrder.length &&
    state.players[state.turnOrder[state.currentPlayerIdx]].hand.length === 0
  ) {
    state.currentPlayerIdx += 1;
  }
}

function endRound(state) {
  const ranked = state.turnOrder.map((p, index) => ({
    player: p,
    index,
    spent: state.players[p].spentThisRound
  }));
  ranked.sort((a, b) => a.spent - b.spent || a.index - b.index);
  state.turnOrder = ranked.map((r) => r.player);
  for (const ps of state.players) ps.spentThisRound = 0;

  const allPassed = state.rules.passEndsEra && !state.roundNonPass.some(Boolean);
  const deckExhausted = state.rules.eraEndOnDeckEmpty && state.deck.length === 0;
  const eraOver = eraEndCondition(state) || deckExhausted || allPassed;
  const finalRound = eraOver && state.era === ERA.RAIL;
  if (!finalRound) settleIncome(state);

  if (eraOver) {
    settleEraEnd(state);
    return;
  }

  state.round += 1;
  state.currentPlayerIdx = 0;
  state.actionsThisTurn = 0;
  state.roundNonPass = new Array(state.playerCount).fill(false);
  skipCardlessPlayers(state);
}

function endTurn(state, playerIndex) {
  refillHand(state, playerIndex);
  state.actionsThisTurn = 0;
  state.currentPlayerIdx += 1;
  skipCardlessPlayers(state);
  if (state.currentPlayerIdx >= state.turnOrder.length) endRound(state);
}

function advanceAfterAction(state, playerIndex) {
  state.actionsThisTurn += 1;
  const limit = actionsPerRound(state);
  const handEmpty = state.players[playerIndex].hand.length === 0;
  if (state.actionsThisTurn < limit && !handEmpty) return;
  endTurn(state, playerIndex);
}

export function applyAction(state, action) {
  assert(state.phase === 'action', 'game is already over');
  assert(action && typeof action.type === 'string', 'action must have a type');
  const player = currentPlayer(state);
  assert(player !== null, 'no current player');
  const next = clone(state);
  next.lastEvents = [];

  switch (action.type) {
    case 'build': doBuild(next, player, action); break;
    case 'network': doNetwork(next, player, action); break;
    case 'develop': doDevelop(next, player, action); break;
    case 'sell': doSell(next, player, action); break;
    case 'loan': doLoan(next, player, action); break;
    case 'scout': doScout(next, player, action); break;
    case 'pass': doPass(next, player, action); break;
    default: throw new Error('Brass illegal: unknown action type ' + action.type);
  }

  if (action.type !== 'pass') next.roundNonPass[player] = true;
  advanceAfterAction(next, player);
  return next;
}

/* ------------------------------------------------------------------ */
/* Scoring / public score view                                        */
/* ------------------------------------------------------------------ */

export function score(state) {
  const players = state.players.map((ps) => ({
    index: ps.index,
    name: ps.name,
    vp: ps.vp,
    money: ps.money,
    incomeSpace: ps.incomeSpace,
    incomeLevel: incomeLevelAt(ps.incomeSpace),
    loansTaken: ps.loansTaken || 0,
    developsThisEra: ps.developsThisEra || 0
  }));
  const ranking = players.slice().sort((a, b) =>
    b.vp - a.vp ||
    b.incomeLevel - a.incomeLevel ||
    b.money - a.money ||
    a.index - b.index
  );
  return {
    phase: state.phase,
    era: state.era,
    round: state.round,
    players,
    ranking,
    winner: state.winner ? state.winner.slice() : null,
    eraHistory: clone(state.eraHistory)
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI / self-play                                             */
/* ------------------------------------------------------------------ */

function saleValue(state, sale) {
  const tile = state.board.slots[sale.location][sale.slotIndex];
  let value = 30 + tile.def.vp * 1.5 + tile.def.income * 2.5;
  if (sale.useMerchantBeer) {
    const bonus = MERCHANTS[sale.merchant].bonus;
    if (bonus.type === 'vp') value += bonus.amount * 1.5;
    else if (bonus.type === 'income') value += bonus.amount * 3;
    else if (bonus.type === 'money') value += bonus.amount * 0.6;
    else if (bonus.type === 'develop') value += 5;
  }
  return value;
}

function merchantReachFrom(state, location, links) {
  const reachable = distancesFromNodes([location], links || state.board.links);
  return MERCHANT_IDS.filter((id) => reachable.has(id));
}

/** Fewest built-link steps from a location to an accepting merchant. */
function minMerchantDistanceForIndustry(state, location, industry, links) {
  const dist = distancesFromNodes([location], links || state.board.links);
  let best = Infinity;
  for (const id of MERCHANT_IDS) {
    if (!merchantAccepts(state, id, industry)) continue;
    const d = dist.get(id);
    if (d !== undefined && d < best) best = d;
  }
  return best;
}

/** Optimistic distance if every era-legal edge existed; used as a build-location hint. */
function staticMerchantDistance(state, location, industry) {
  const links = [];
  for (let i = 0; i < LINKS.length; i += 1) {
    const def = LINKS[i];
    if (state.era === ERA.CANAL ? def.canal : def.rail) {
      links.push({ edge: i, era: state.era });
    }
  }
  return minMerchantDistanceForIndustry(state, location, industry, links);
}

function merchantBeerReady(state, playerIndex, merchantId, industry, need) {
  if (need <= 0) return true;
  let available = countBreweryBeer(state, playerIndex, [merchantId], state.board.links);
  if (merchantBarrelIndex(state, merchantId, industry) >= 0) available += 1;
  return available >= need;
}

function anyMerchantBeerReadyForTile(state, playerIndex, tile) {
  const reachable = merchantReachFrom(state, tile.location);
  for (const id of reachable) {
    if (!merchantAccepts(state, id, tile.industry)) continue;
    if (merchantBeerReady(state, playerIndex, id, tile.industry, tile.beer)) return true;
  }
  return false;
}

function sellablesNeedingBeer(state, playerIndex) {
  return ownSellableTiles(state, playerIndex).filter((tile) => {
    const reachable = merchantReachFrom(state, tile.location);
    const accepting = reachable.filter((id) => merchantAccepts(state, id, tile.industry));
    if (accepting.length === 0) return false;
    return !accepting.some((id) =>
      merchantBeerReady(state, playerIndex, id, tile.industry, tile.beer));
  }).length;
}

function hasDedicatedMerchantFor(state, industry) {
  for (const id of MERCHANT_IDS) {
    if (state.merchants[id].tiles.includes(industry)) return true;
  }
  return false;
}

function ownBreweryBeer(state, playerIndex) {
  return countBreweryBeer(state, playerIndex, null, state.board.links);
}

function ownSellableTiles(state, playerIndex) {
  return sellableTiles(state, playerIndex);
}

function activeOwnIndustry(state, playerIndex, industry) {
  let count = 0;
  for (const slots of Object.values(state.board.slots)) {
    for (const tile of slots) {
      if (tile && tile.player === playerIndex && !tile.flipped &&
          tile.def.industry === industry && tile.resources > 0) {
        count += 1;
      }
    }
  }
  return count;
}

function buildHeuristic(state, action, playerIndex) {
  const ps = state.players[playerIndex];
  const def = nextTileOf(ps, action.industry);
  if (!def) return -Infinity;
  let value = 3 + def.vp + def.income * 0.8;
  if (def.sellable) {
    const currentDist = minMerchantDistanceForIndustry(
      state, action.location, def.industry, state.board.links
    );
    if (currentDist < Infinity) {
      let beerReady = false;
      const reachable = merchantReachFrom(state, action.location);
      for (const id of reachable) {
        if (!merchantAccepts(state, id, def.industry)) continue;
        if (merchantBeerReady(state, playerIndex, id, def.industry, def.beer)) {
          beerReady = true;
          break;
        }
      }
      value += beerReady ? 35 : 12;
    } else {
      const sd = staticMerchantDistance(state, action.location, def.industry);
      if (sd <= 1) value += 14;
      else if (sd <= 2) value += 7;
      else value -= 5;
    }
    // In a 2p game there is no dedicated pottery merchant: pottery can only
    // use the single "any" tile, so it is less reliable than cotton/goods.
    if (!hasDedicatedMerchantFor(state, def.industry)) value -= 8;
  } else if (def.industry === 'brewery') {
    const activeBreweries = activeOwnIndustry(state, playerIndex, 'brewery');
    const need = sellablesNeedingBeer(state, playerIndex);
    if (need > 0 && activeBreweries === 0) value += 30;
    else if (need > 0) value += 8;
    else if (activeBreweries === 0) value += 4;
    else value -= 25;
    if (def.vp >= 7) value += 3;
  } else if (def.industry === 'coal') {
    const activeCoal = activeOwnIndustry(state, playerIndex, 'coal');
    value += activeCoal === 0 ? (state.era === ERA.RAIL ? 8 : 5) : -12;
  } else if (def.industry === 'iron') {
    const activeIron = activeOwnIndustry(state, playerIndex, 'iron');
    value += activeIron === 0 ? 5 : -12;
  }
  value -= def.cost * 0.10;
  return value;
}

function networkHeuristic(state, action, playerIndex) {
  const virtualLinks = state.board.links.concat(
    action.links.map((edge) => ({ edge, player: playerIndex, era: state.era }))
  );
  const enabled = [];
  for (const tile of ownSellableTiles(state, playerIndex)) {
    const before = minMerchantDistanceForIndustry(
      state, tile.location, tile.industry, state.board.links
    );
    if (before < Infinity) continue;
    const after = minMerchantDistanceForIndustry(
      state, tile.location, tile.industry, virtualLinks
    );
    if (after < Infinity) enabled.push(tile);
  }
  let value;
  if (enabled.length > 0) {
    // A link that turns a built, unflipped mill into a sellable mill is worth
    // more than starting another mill: without the link none of the mills
    // score. Value the enabled sales, not just the link count.
    value = 80;
    for (const tile of enabled) {
      const def = state.board.slots[tile.location][tile.slotIndex].def;
      value += 30 + def.vp * 2 + def.income * 2;
    }
  } else {
    value = !playerHasBoardPieces(state, playerIndex) ? -35 : -60;
  }
  if (state.era === ERA.RAIL && action.links.length > 0) {
    const eps = endpointsOf(action.links[action.links.length - 1]);
    const dist = distancesFromNodes(eps, virtualLinks);
    let reachesCoal = false;
    for (const [location, slots] of Object.entries(state.board.slots)) {
      if (!dist.has(location)) continue;
      if (slots.some((tile) =>
        tile && !tile.flipped && tile.def.industry === 'coal' && tile.resources > 0)) {
        reachesCoal = true;
        break;
      }
    }
    if (reachesCoal) value += 12;
  }
  return value;
}

function developHeuristic(state, action, playerIndex) {
  const ps = state.players[playerIndex];
  if ((ps.developsThisEra || 0) >= 3) return -100;
  if (ps.money < 12) return -100;
  const copy = ps.tiles.slice();
  for (const industry of action.removals) {
    const idx = copy.findIndex((t) => t.industry === industry);
    if (idx >= 0) copy.splice(idx, 1);
  }
  let value = 0;
  const seen = new Set();
  for (const industry of action.removals) {
    if (seen.has(industry)) continue;
    seen.add(industry);
    const next = copy.find((t) => t.industry === industry);
    if (!next || next.level <= 1) continue;
    value += 2 + next.vp * 0.3 + next.income * 0.3;
    if (SELLABLE.has(next.industry)) value += 4;
    if (state.era === ERA.RAIL) value += 2;
    if (!SELLABLE.has(next.industry) && state.era === ERA.CANAL) value -= 5;
  }
  return Math.min(value, 12);
}

function cardUseValue(state, playerIndex, card) {
  if (card.kind === 'wild-location' || card.kind === 'wild-industry') return 12;
  const ps = state.players[playerIndex];
  if (card.kind === 'location') {
    const loc = LOCATIONS[card.location];
    if (!loc) return 0;
    let value = 3;
    for (const slotDef of loc.slots) {
      for (const industry of slotDef.industries) {
        if (!nextTileOf(ps, industry)) continue;
        if (SELLABLE.has(industry)) value = Math.max(value, 8);
        else value = Math.max(value, 4);
      }
    }
    return value;
  }
  if (card.kind === 'industry') {
    let value = 2;
    for (const industry of card.industries) {
      if (SELLABLE.has(industry)) value = Math.max(value, 8);
      else value = Math.max(value, 5);
    }
    return value;
  }
  return 0;
}

function actionCardCost(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  if (action.type === 'scout') {
    let value = 0;
    for (const id of action.cardIds) {
      const card = ps.hand.find((c) => c.id === id);
      if (card) value += cardUseValue(state, playerIndex, card);
    }
    return value;
  }
  if (action.cardId) {
    const card = ps.hand.find((c) => c.id === action.cardId);
    if (card) return cardUseValue(state, playerIndex, card);
  }
  return 0;
}

function actionCashCost(state, playerIndex, action) {
  if (action.type === 'build') {
    const def = nextTileOf(state.players[playerIndex], action.industry);
    return def ? def.cost : 0;
  }
  if (action.type === 'network') {
    if (state.era === ERA.CANAL) return CANAL_LINK_COST;
    return action.links.length === 1 ? RAIL_LINK_COST : RAIL_DOUBLE_LINK_COST;
  }
  if (action.type === 'develop') return action.removals.length;
  return 0;
}

function cashReservePenalty(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const reserve = Math.max(0, -incomeLevelAt(ps.incomeSpace));
  if (reserve <= 0) return 0;
  const after = ps.money - actionCashCost(state, playerIndex, action);
  if (after >= reserve) return 0;
  return (reserve - after) * 30;
}

function actionHeuristic(state, action, playerIndex) {
  const ps = state.players[playerIndex];
  if (action.type === 'build') {
    return buildHeuristic(state, action, playerIndex) - cashReservePenalty(state, playerIndex, action);
  }
  const cardCost = actionCardCost(state, playerIndex, action);
  if (action.type === 'network') {
    return networkHeuristic(state, action, playerIndex) - cardCost * 0.8 -
      cashReservePenalty(state, playerIndex, action);
  }
  if (action.type === 'develop') {
    return developHeuristic(state, action, playerIndex) - cardCost * 0.8 -
      cashReservePenalty(state, playerIndex, action);
  }
  if (action.type === 'sell') {
    let value = 0;
    for (const sale of action.sales) value += saleValue(state, sale);
    return value - cardCost * 0.8;
  }
  if (action.type === 'loan') {
    const level = incomeLevelAt(ps.incomeSpace);
    const loans = ps.loansTaken || 0;
    if (loans >= 8 || level < -7) return -80 - cardCost * 0.8;
    if (ps.money < 3) return 10 - cardCost * 0.8;
    if (ps.money < 8) return 5 - cardCost * 0.8;
    return -80 - cardCost * 0.8;
  }
  if (action.type === 'scout') {
    let bestCard = 0;
    for (const c of ps.hand) bestCard = Math.max(bestCard, cardUseValue(state, playerIndex, c));
    if (bestCard <= 5 && ps.hand.length >= 3 &&
        state.wildSupply.location >= 1 && state.wildSupply.industry >= 1) {
      return 10 - cardCost * 0.8;
    }
    return -20 - cardCost * 0.8;
  }
  if (action.type === 'pass') return 0 - cardCost * 0.8;
  return 0;
}

export function chooseGreedyAction(state, actions) {
  const list = actions || legalActions(state);
  if (list.length === 0) return null;
  const player = currentPlayer(state);
  let best = null;
  let bestScore = -Infinity;
  let bestKey = '';
  for (const action of list) {
    const value = actionHeuristic(state, action, player);
    const key = stableStringify(action);
    if (value > bestScore || (value === bestScore && key < bestKey)) {
      best = action;
      bestScore = value;
      bestKey = key;
    }
  }
  return best;
}

export function skipCardlessTurn(state) {
  const next = clone(state);
  const player = currentPlayer(next);
  assert(player !== null, 'no current player');
  assert(next.players[player].hand.length === 0, 'current player still has cards');
  endTurn(next, player);
  return next;
}

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;
  while (next.phase === 'action' && actions < max) {
    const player = currentPlayer(next);
    const list = legalActions(next, player);
    if (list.length === 0) {
      if (next.players[player].hand.length === 0) {
        next = skipCardlessTurn(next);
        actions += 1;
        continue;
      }
      throw new Error('Brass AI: no legal actions for player ' + player);
    }
    const action = opts.choose
      ? opts.choose(next, list)
      : chooseGreedyAction(next, list);
    trace.push({ player, action: clone(action) });
    next = applyAction(next, action);
    actions += 1;
  }
  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('Brass AI: game did not finish within ' + max + ' actions');
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

function merchantTilePool(playerCount) {
  const pool = ['any', 'cotton', 'manufacturer', 'blank', 'blank'];
  if (playerCount >= 3) pool.push('pottery', 'blank');
  if (playerCount >= 4) pool.push('cotton', 'manufacturer');
  return pool;
}

function availableMerchants(playerCount) {
  return MERCHANT_IDS.filter((id) => MERCHANTS[id].minPlayers <= playerCount);
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert(playerCount === 2 || playerCount === 3 || playerCount === 4, 'playerCount must be 2, 3 or 4');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;
  const brief = opts.variant === 'brief';
  const rules = {
    handSize: opts.handSize === undefined ? (brief ? 7 : 8) : opts.handSize,
    actionsPerTurn: opts.actionsPerTurn === undefined ? (brief ? 1 : 2) : opts.actionsPerTurn,
    firstCanalRoundActions: opts.firstCanalRoundActions === undefined ? 1 : opts.firstCanalRoundActions,
    passEndsEra: opts.passEndsEra === undefined ? brief : !!opts.passEndsEra,
    eraEndOnDeckEmpty: opts.eraEndOnDeckEmpty === undefined ? brief : !!opts.eraEndOnDeckEmpty
  };
  assert(Number.isInteger(rules.handSize) && rules.handSize >= 1, 'handSize must be a positive integer');
  assert(Number.isInteger(rules.actionsPerTurn) && rules.actionsPerTurn >= 1, 'actionsPerTurn must be a positive integer');
  assert(Number.isInteger(rules.firstCanalRoundActions) && rules.firstCanalRoundActions >= 1, 'firstCanalRoundActions must be a positive integer');

  const shuffledDeck = shuffleWith(buildDeck(playerCount), seed + ':deck');
  let cursor = 0;
  const hands = [];
  for (let i = 0; i < playerCount; i += 1) {
    hands.push(shuffledDeck.slice(cursor, cursor + rules.handSize));
    cursor += rules.handSize;
  }
  const bottomCards = shuffledDeck.slice(cursor, cursor + playerCount);
  cursor += playerCount;
  const deck = shuffledDeck.slice(cursor);

  const pool = shuffleWith(merchantTilePool(playerCount), seed + ':merchants');
  const activeMerchants = new Set(availableMerchants(playerCount));
  const merchants = {};
  let tileCursor = 0;
  for (const id of MERCHANT_IDS) {
    if (!activeMerchants.has(id)) {
      merchants[id] = { tiles: [], barrels: [] };
      continue;
    }
    const faces = pool.slice(tileCursor, tileCursor + MERCHANTS[id].slots);
    tileCursor += MERCHANTS[id].slots;
    merchants[id] = {
      tiles: faces,
      barrels: faces.map((face) => face !== 'blank')
    };
  }

  const turnOrder = shuffleWith(
    Array.from({ length: playerCount }, (_, i) => i),
    seed + ':turn'
  );

  const slots = {};
  for (const id of LOCATION_IDS) {
    slots[id] = LOCATIONS[id].slots.map(() => null);
  }

  const players = hands.map((hand, index) => ({
    index,
    name: opts.names && opts.names[index] ? opts.names[index] : 'P' + (index + 1),
    hand,
    tiles: expandPlayerTiles(),
    money: START_MONEY,
    incomeSpace: START_INCOME_SPACE,
    vp: 0,
    spentThisRound: 0,
    loansTaken: 0,
    developsThisEra: 0
  }));

  return {
    version: VERSION,
    seed,
    playerCount,
    rules,
    era: ERA.CANAL,
    round: 1,
    phase: 'action',
    board: { slots, links: [] },
    merchants,
    markets: {
      coal: makeMarketFilled(COAL_MARKET_PRICES.length, COAL_MARKET_INITIAL),
      iron: makeMarketFilled(IRON_MARKET_PRICES.length, IRON_MARKET_INITIAL)
    },
    deck,
    discard: bottomCards,
    wildSupply: {
      location: WILD_LOCATION_COUNT,
      industry: WILD_INDUSTRY_COUNT
    },
    nextWildId: 0,
    players,
    turnOrder,
    currentPlayerIdx: 0,
    actionsThisTurn: 0,
    roundNonPass: new Array(playerCount).fill(false),
    eraHistory: [],
    winner: null,
    lastEvents: []
  };
}

/* ------------------------------------------------------------------ */
/* Export data for tests / future UI                                  */
/* ------------------------------------------------------------------ */

export const DATA = Object.freeze({
  LOCATIONS,
  LINKS,
  MERCHANTS,
  TILES,
  COAL_MARKET_PRICES,
  COAL_MARKET_INITIAL,
  COAL_FALLBACK_PRICE,
  IRON_MARKET_PRICES,
  IRON_MARKET_INITIAL,
  IRON_FALLBACK_PRICE,
  WILD_LOCATION_COUNT,
  WILD_INDUSTRY_COUNT,
  NAMED_LOCATION_IDS: Object.freeze(NAMED_LOCATION_IDS.slice())
});

export default {
  VERSION,
  INDUSTRIES,
  ERA,
  LOCATIONS,
  LINKS,
  MERCHANTS,
  TILES,
  DATA,
  createGame,
  legalActions,
  applyAction,
  score,
  currentPlayer,
  actionsPerRound,
  incomeLevelAt,
  incomeSpaceForLevelTop,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  skipCardlessTurn,
  hashState,
  stableStringify
};
