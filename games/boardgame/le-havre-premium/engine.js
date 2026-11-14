/*
 * Le Havre (勒阿弗尔 / 港都情浓) — pure rules engine, phase 1 (no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> canonical legal Action[] for the current actor
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> wealth / ranking (official scoring)
 *   scorePlayer(state, index)     -> one player's scoring breakdown
 *   hashState(state)              -> stable 8-hex digest for replay checks
 *   currentPlayer(state)          -> player index that must act, or null
 *   feedObligation(state, index)  -> food still owed at the current round end
 *   chooseGreedyAction(state[, actions])
 *   autoPlay(state, opts)         -> deterministic self-play
 *   selfPlay(opts)                -> createGame + autoPlay
 *
 * Scope: full 2-player game by default (14 rounds), 1–5 players supported.
 * A round is 7 individual turns. Every turn: supply step (advance the ship
 * marker, add two tokens to the Offer spaces) then one mandatory main action
 * (take an Offer / use a building). Buying, selling and loan repayment are
 * optional additional actions. Every seventh turn a Harvest and a Feeding
 * phase resolve. Rules and every intentional deviation are documented in
 * rules.md.
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
  throw new Error('LeHavreEngine requires games/shared/shuffle.js');
}

export const VERSION = '1.0.0';
export const TURNS_PER_ROUND = 7;

/* ------------------------------------------------------------------ */
/* Static data: goods, energy, ships, rounds                          */
/* ------------------------------------------------------------------ */

export const GOODS = Object.freeze([
  'wood', 'clay', 'iron', 'grain', 'fish', 'cattle', 'hide', 'coal',
  'charcoal', 'coke', 'steel', 'brick', 'leather', 'meat', 'bread',
  'smokedFish', 'flour'
]);

export const GOOD_NAMES = Object.freeze({
  wood: '木材', clay: '粘土', iron: '铁', grain: '谷物', fish: '鱼',
  cattle: '牛', hide: '兽皮', coal: '煤', charcoal: '木炭', coke: '焦炭',
  steel: '钢', brick: '砖', leather: '皮革', meat: '肉', bread: '面包',
  smokedFish: '熏鱼', flour: '面粉', francs: '法郎'
});

/** Food value of one token. Grain / cattle are 0 until upgraded. */
export const FOOD_VALUE = Object.freeze({
  fish: 1, smokedFish: 2, bread: 2, meat: 3
});

/** Energy value of one token (official: wood 1, charcoal 3, coal 3, coke 10). */
export const ENERGY_VALUE = Object.freeze({
  wood: 1, charcoal: 3, coal: 3, coke: 10
});

/** The seven Offer spaces. Coal and hides have no Offer space. */
export const OFFER_SPACES = Object.freeze([
  'francs', 'fish', 'wood', 'clay', 'iron', 'grain', 'cattle'
]);

export const STANDARD_GOODS = Object.freeze([
  'fish', 'wood', 'clay', 'iron', 'grain', 'cattle', 'hide', 'coal'
]);

/** Rough trade weight used only by the greedy AI and auto-selection. */
const TRADE_WEIGHT = Object.freeze({
  fish: 1, wood: 1, clay: 1, flour: 1, grain: 1.5, iron: 1.5,
  hide: 1, coal: 2, charcoal: 2, brick: 2, meat: 2, bread: 2,
  smokedFish: 2, cattle: 2, leather: 3, coke: 5, steel: 6
});

export const ROUNDS_BY_PLAYERS = Object.freeze({ 1: 7, 2: 14, 3: 18, 4: 20, 5: 20 });

/**
 * Feeding requirement printed on the current Round card.
 * Phase-1 simplification: the official per-round card table differs by player
 * count and is not reproduced here; this monotone schedule is used instead.
 * See rules.md §待确认.
 */
export const ROUND_FOOD_SCHEDULE = Object.freeze({
  1: Object.freeze([1, 1, 2, 2, 3, 3, 4]),
  2: Object.freeze([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]),
  3: Object.freeze([1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7]),
  4: Object.freeze([1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7]),
  5: Object.freeze([1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 7, 7])
});

export const SHIP_TYPES = Object.freeze({
  wood: Object.freeze({
    name: '木船', food: 2, capacity: 2, energy: 3,
    cost: Object.freeze({ wood: 2 }),
    values: Object.freeze([2, 4, 6, 8, 10, 12, 14])
  }),
  iron: Object.freeze({
    name: '铁船', food: 3, capacity: 3, energy: 3,
    cost: Object.freeze({ wood: 2, iron: 1 }),
    values: Object.freeze([8, 10, 12, 14, 16, 18])
  }),
  steel: Object.freeze({
    name: '钢船', food: 4, capacity: 4, energy: 3,
    cost: Object.freeze({ wood: 2, steel: 1 }),
    values: Object.freeze([20, 22, 24, 26])
  }),
  luxury: Object.freeze({
    name: '豪华邮轮', food: 5, capacity: 0, energy: 3,
    cost: Object.freeze({ steel: 2, iron: 1 }),
    values: Object.freeze([38, 34, 30])
  })
});

export const SHIP_TYPE_IDS = Object.freeze(['wood', 'iron', 'steel', 'luxury']);

/** Francs earned when a good is shipped on a Shipping Line. */
export const SHIP_GOOD_VALUE = Object.freeze({
  meat: 2, smokedFish: 2, charcoal: 2, hide: 2, brick: 2, iron: 2,
  cattle: 3, bread: 3, coal: 3, leather: 4, coke: 5, steel: 8
});

/** Buy price = card value + 4 (phase-1 simplification, see rules.md). */
export const SHIP_BUY_MARKUP = 4;

export const PLAYER_START_FRANCS = 5;
export const PLAYER_START_COAL = 1;

export const STARTING_OFFERS = Object.freeze({
  francs: 2, fish: 2, wood: 2, clay: 1, iron: 0, grain: 0, cattle: 0
});

export const STARTING_BUILDINGS = Object.freeze([
  'constructionFirm', 'buildingFirmA', 'buildingFirmB'
]);

/* ------------------------------------------------------------------ */
/* Static data: the 33 standard buildings (+2 phase-1 extensions)     */
/* ------------------------------------------------------------------ */

function b(def) { return Object.freeze(def); }

/**
 * `cost` is the building material; `null` means "cannot be built".
 * `buyCost` defaults to `value`. `noBuy` blocks purchase (Church).
 * `entry` is the fee in Francs (= 1 food) paid to the owner/town.
 * `action` is the building effect key; `null` means no action.
 */
export const BUILDINGS = Object.freeze({
  constructionFirm: b({
    id: 'constructionFirm', name: '建造公司', category: 'I', sort: 0,
    value: 8, entry: 2, cost: null, buyCost: 8, action: 'construct2',
    starting: true, hammer: true,
    text: '可连续建造 2 栋提案区顶部的建筑'
  }),
  buildingFirmA: b({
    id: 'buildingFirmA', name: '建筑公司 A', category: 'C', sort: 0,
    value: 4, entry: 0, cost: null, buyCost: 4, action: 'construct1',
    starting: true, hammer: true, text: '建造 1 栋提案区顶部的建筑'
  }),
  buildingFirmB: b({
    id: 'buildingFirmB', name: '建筑公司 B', category: 'C', sort: 0,
    value: 6, entry: 1, cost: null, buyCost: 6, action: 'construct1',
    starting: true, hammer: true, text: '建造 1 栋提案区顶部的建筑'
  }),

  marketplace: b({
    id: 'marketplace', name: '集市', category: 'N', sort: 1,
    value: 6, entry: 1, cost: { wood: 2 }, action: 'marketplace',
    text: '取 2 种不同标准货物，每栋自有工匠建筑再 +1 种'
  }),
  sawmill: b({
    id: 'sawmill', name: '锯木厂', category: 'I', sort: 2,
    value: 14, entry: 0, cost: { clay: 1, iron: 1 }, action: 'constructSawmill',
    text: '建造 1 栋含木材成本的建筑，少付 1 木材'
  }),
  fishery: b({
    id: 'fishery', name: '渔场', category: 'C', sort: 3,
    value: 10, entry: 0, cost: { wood: 1, clay: 1 }, action: 'fishery',
    fisherman: true, text: '得 3 鱼，每有 1 渔夫符号再 +1 鱼'
  }),
  joinery: b({
    id: 'joinery', name: '木工坊', category: 'C', sort: 4,
    value: 8, entry: 1, cost: { wood: 3 }, action: 'joinery',
    hammer: true, text: '付 1–3 木材，得 5–7 法郎'
  }),
  bakehouse: b({
    id: 'bakehouse', name: '面包房', category: 'C', sort: 5,
    value: 8, entry: 1, cost: { clay: 2 }, action: 'bakehouse',
    text: '谷物烤面包（每 2 个付 1 能量）；面粉可烤 2 倍面包'
  }),
  hardwareStore: b({
    id: 'hardwareStore', name: '五金店', category: 'C', sort: 6,
    value: 8, entry: 1, cost: { wood: 3, clay: 1 }, action: 'hardware',
    hammer: true, fisherman: true, text: '得 1 木材、1 砖、1 铁'
  }),
  charcoalKiln: b({
    id: 'charcoalKiln', name: '炭窑', category: 'C', sort: 7,
    value: 8, entry: 0, cost: { clay: 1 }, action: 'charcoalKiln',
    text: '任意数量木材升级为木炭，不需能量'
  }),
  smokehouse: b({
    id: 'smokehouse', name: '熏鱼房', category: 'C', sort: 8,
    value: 6, entry: 1, cost: { wood: 2, clay: 1 }, action: 'smokehouse',
    fisherman: true, text: '最多 6 鱼熏制为熏鱼，付 1 能量'
  }),
  abattoir: b({
    id: 'abattoir', name: '屠宰场', category: 'C', sort: 9,
    value: 8, entry: 2, cost: { wood: 1, clay: 1, iron: 1 }, action: 'abattoir',
    text: '任意牛变肉，每 2 头牛得 1 张兽皮'
  }),
  clayMound: b({
    id: 'clayMound', name: '粘土坑', category: 'N', sort: 10,
    value: 2, entry: 1, cost: null, buyCost: 2, action: 'clayMound',
    text: '只能购买。得 3 粘土，每有 1 锤子符号再 +1 粘土'
  }),
  artsCenter: b({
    id: 'artsCenter', name: '艺术中心', category: 'P', sort: 11,
    value: 10, entry: 1, cost: { wood: 1, clay: 1 }, action: 'artsCenter',
    fisherman: true, text: '其他玩家每有 1 人在你的建筑上，得 4 法郎'
  }),
  wharf: b({
    id: 'wharf', name: '船厂', category: 'I', sort: 12,
    value: 14, entry: 2, cost: { wood: 2, clay: 2, iron: 2 }, action: 'wharf',
    fisherman: true, text: '建造 1 艘已出现的船；首艘非木船需现代化（1 砖）'
  }),
  blackMarket: b({
    id: 'blackMarket', name: '黑市', category: 'N', sort: 13,
    value: 2, entry: 1, cost: null, buyCost: 2, action: 'blackMarket',
    text: '只能购买。每个空的 Offer 空间取 2 个对应货物'
  }),
  brickworks: b({
    id: 'brickworks', name: '砖厂', category: 'I', sort: 14,
    value: 14, entry: 1, cost: { wood: 2, clay: 1, iron: 1 }, action: 'brickworks',
    text: '粘土烧砖，每 2 砖付 1 能量；每 2 砖补助 1 法郎'
  }),
  localCourt: b({
    id: 'localCourt', name: '地方法院', category: 'P', sort: 15,
    value: 16, entry: 0, cost: { wood: 3, clay: 2 }, action: 'localCourt',
    text: '免费归还 1–2 张贷款'
  }),
  colliery: b({
    id: 'colliery', name: '煤矿', category: 'I', sort: 16,
    value: 10, entry: 2, cost: { wood: 1, clay: 3 }, action: 'colliery',
    text: '得 3 煤；有至少 1 锤子符号再 +1 煤'
  }),
  wharf2: b({
    id: 'wharf2', name: '第二船厂', category: 'I', sort: 17,
    value: 14, entry: 2, cost: { wood: 2, clay: 2, iron: 2 }, action: 'wharf',
    fisherman: true, text: '第二座船厂，功能同船厂'
  }),
  shippingLine: b({
    id: 'shippingLine', name: '航运公司', category: 'E', sort: 18,
    value: 10, entry: 2, cost: { wood: 2, brick: 3 }, action: 'shipping',
    fisherman: true, text: '用船只运货换取法郎，每艘船付 3 能量'
  }),
  groceryMarket: b({
    id: 'groceryMarket', name: '杂货市场', category: 'E', sort: 19,
    value: 10, entry: 1, cost: { wood: 1, brick: 1 }, action: 'grocery',
    text: '得 1 牛、1 肉、1 鱼、1 熏鱼、1 谷物、1 面包'
  }),
  tannery: b({
    id: 'tannery', name: '制革厂', category: 'C', sort: 20,
    value: 12, entry: 0, cost: { wood: 1, brick: 1 }, action: 'tannery',
    text: '最多 4 兽皮制革，每张补助 1 法郎'
  }),
  businessOffice: b({
    id: 'businessOffice', name: '交易所', category: 'E', sort: 21,
    value: 12, entry: 1, cost: { wood: 4, clay: 1 }, action: 'business',
    hammer: true, fisherman: true,
    text: '4 货物换 1 钢；或用 1 货物换 1 木炭/皮革/砖'
  }),
  ironworks: b({
    id: 'ironworks', name: '铁厂', category: 'I', sort: 22,
    value: 12, entry: 1, cost: { wood: 1, brick: 2 }, action: 'ironworks',
    hammer: true, text: '得 3 铁；可付 6 能量再得 1 铁'
  }),
  steelMill: b({
    id: 'steelMill', name: '钢厂', category: 'I', sort: 23,
    value: 22, entry: 2, cost: { brick: 4, iron: 2 }, action: 'steelMill',
    text: '任意铁炼钢，每块铁付 5 能量'
  }),
  storehouse: b({
    id: 'storehouse', name: '仓库', category: 'E', sort: 24,
    value: 4, entry: 0, cost: { wood: 2, brick: 2 }, buyCost: 10,
    action: null, scoring: 'storehouse', hammer: true,
    text: '无行动；终局每 2 个货物 token +1 法郎价值'
  }),
  cokery: b({
    id: 'cokery', name: '炼焦厂', category: 'I', sort: 25,
    value: 18, entry: 1, cost: { brick: 2, iron: 2 }, action: 'cokery',
    text: '煤变焦炭，每块焦炭补助 1 法郎'
  }),
  dock: b({
    id: 'dock', name: '码头', category: 'I', sort: 26,
    value: 10, entry: 0, cost: { wood: 1, brick: 2, iron: 2 }, buyCost: 24,
    action: null, scoring: 'dock',
    text: '无行动；终局每艘船令其价值 +4'
  }),
  bridge: b({
    id: 'bridge', name: '塞纳河大桥', category: 'N', sort: 27,
    value: 16, entry: 2, cost: { iron: 3 }, action: 'bridge',
    text: '出售货物：升级货物 1 个 1 法郎，标准货物 3 个 1 法郎'
  }),
  townHall: b({
    id: 'townHall', name: '市政厅', category: 'P', sort: 28,
    value: 6, entry: 0, cost: { wood: 4, brick: 3 }, buyCost: 30,
    action: null, scoring: 'townHall',
    text: '无行动；终局每栋公共建筑 +4，每栋工匠建筑 +2'
  }),
  bank: b({
    id: 'bank', name: '银行', category: 'E', sort: 29,
    value: 16, entry: 0, cost: { brick: 4, steel: 1 }, buyCost: 40,
    action: null, scoring: 'bank',
    text: '无行动；终局每栋工业建筑 +3，每栋经济建筑 +2'
  }),
  church: b({
    id: 'church', name: '教堂', category: 'P', sort: 30,
    value: 26, entry: 0, cost: { wood: 5, brick: 3, iron: 1 },
    buyCost: null, noBuy: true, action: 'church',
    text: '需持有 5 面包与 2 鱼；得 5 面包与 3 鱼'
  }),
  // Phase-1 extensions, clearly marked in rules.md.
  mill: b({
    id: 'mill', name: '磨坊', category: 'C', sort: 31,
    value: 6, entry: 1, cost: { wood: 2, clay: 1 }, action: 'mill',
    extension: true, text: '一期扩展：谷物磨成面粉（1:1）'
  }),
  blacksmith: b({
    id: 'blacksmith', name: '铁匠铺', category: 'C', sort: 32,
    value: 8, entry: 1, cost: { brick: 2, iron: 1 }, action: 'blacksmith',
    hammer: true, extension: true,
    text: '一期扩展：1 铁 + 6 能量炼成 1 钢'
  })
});

export const BUILDING_IDS = Object.freeze(Object.keys(BUILDINGS));

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function emptyGoods() {
  const out = {};
  for (const key of GOODS) out[key] = 0;
  return out;
}

function addGood(player, key, amount) {
  assert(player && player.goods, 'addGood: bad player');
  assert(typeof amount === 'number' && amount >= 0, 'addGood: bad amount');
  if (key === 'francs') {
    player.francs += amount;
    return;
  }
  assert(Object.prototype.hasOwnProperty.call(player.goods, key), 'unknown good: ' + key);
  player.goods[key] += amount;
}

function removeGood(player, key, amount) {
  if (amount === 0) return;
  assert(amount > 0, 'removeGood: bad amount');
  if (key === 'francs') {
    assert(player.francs >= amount, 'not enough francs');
    player.francs -= amount;
    return;
  }
  assert((player.goods[key] || 0) >= amount, 'not enough ' + key);
  player.goods[key] -= amount;
}

function goodsTokenCount(player) {
  let total = 0;
  for (const key of GOODS) total += player.goods[key] || 0;
  return total;
}

function foodValueOf(player) {
  let total = 0;
  for (const key of Object.keys(FOOD_VALUE)) total += (player.goods[key] || 0) * FOOD_VALUE[key];
  return total;
}

function shipFoodOf(player) {
  let total = 0;
  for (const ship of player.ships) total += SHIP_TYPES[ship.type].food;
  return total;
}

function countCategory(state, playerIndex, category) {
  let n = 0;
  for (const id of state.players[playerIndex].buildings) {
    if (BUILDINGS[id] && BUILDINGS[id].category === category) n += 1;
  }
  return n;
}

function countSymbol(state, playerIndex, symbol) {
  let n = 0;
  for (const id of state.players[playerIndex].buildings) {
    if (BUILDINGS[id] && BUILDINGS[id][symbol]) n += 1;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Cost payment (brick substitutes clay, steel substitutes iron)       */
/* ------------------------------------------------------------------ */

function costNeeds(cost) {
  return {
    wood: cost.wood || 0,
    clay: cost.clay || 0,
    iron: cost.iron || 0,
    brick: cost.brick || 0,
    steel: cost.steel || 0
  };
}

function canPayCost(player, cost) {
  const need = costNeeds(cost);
  const g = player.goods;
  if (g.wood < need.wood) return false;
  if (g.brick < need.brick) return false;
  if (g.clay + (g.brick - need.brick) < need.clay) return false;
  if (g.steel < need.steel) return false;
  if (g.iron + (g.steel - need.steel) < need.iron) return false;
  return true;
}

function payCost(player, cost) {
  const need = costNeeds(cost);
  if (!canPayCost(player, cost)) return false;
  removeGood(player, 'wood', need.wood);
  removeGood(player, 'brick', need.brick);
  // Pay clay first, then brick substitutes the remainder.
  const clayFromClay = Math.min(player.goods.clay, need.clay);
  removeGood(player, 'clay', clayFromClay);
  removeGood(player, 'brick', need.clay - clayFromClay);
  removeGood(player, 'steel', need.steel);
  const ironFromIron = Math.min(player.goods.iron, need.iron);
  removeGood(player, 'iron', ironFromIron);
  removeGood(player, 'steel', need.iron - ironFromIron);
  return true;
}

function canPayCosts(player, costs) {
  const fake = { francs: player.francs, goods: clone(player.goods) };
  for (const cost of costs) {
    if (!payCost(fake, cost)) return false;
  }
  return true;
}

function energyAvailable(player) {
  let total = 0;
  for (const key of Object.keys(ENERGY_VALUE)) total += (player.goods[key] || 0) * ENERGY_VALUE[key];
  return total;
}

/**
 * Choose energy tokens whose total is >= amount with the least overpay,
 * preferring cheap tokens on ties. Returns {wood, charcoal, coal, coke} or null.
 */
function chooseEnergy(player, amount) {
  if (amount <= 0) return { wood: 0, charcoal: 0, coal: 0, coke: 0 };
  if (energyAvailable(player) < amount) return null;
  const keys = ['wood', 'charcoal', 'coal', 'coke'];
  const limit = amount + 10;
  let states = new Map();
  states.set(0, { wood: 0, charcoal: 0, coal: 0, coke: 0 });
  for (const key of keys) {
    const value = ENERGY_VALUE[key];
    const maxCount = Math.min(player.goods[key] || 0, Math.ceil(limit / value));
    const next = new Map();
    for (const [sum, use] of states) {
      for (let n = 0; n <= maxCount; n += 1) {
        const ns = sum + n * value;
        if (ns > limit) break;
        if (!next.has(ns)) {
          const copy = { wood: use.wood, charcoal: use.charcoal, coal: use.coal, coke: use.coke };
          copy[key] = n;
          next.set(ns, copy);
        }
      }
    }
    states = next;
  }
  for (let sum = amount; sum <= limit; sum += 1) {
    if (states.has(sum)) return states.get(sum);
  }
  return null;
}

function canPayEnergy(player, amount) {
  return chooseEnergy(player, amount) !== null;
}

function payEnergy(player, amount) {
  const plan = chooseEnergy(player, amount);
  if (!plan) return false;
  for (const key of ['wood', 'charcoal', 'coal', 'coke']) removeGood(player, key, plan[key]);
  return true;
}

/** Check a goods cost and an energy cost together (both draw on wood). */
function canPayCostAndEnergy(player, cost, amount) {
  const fake = { francs: player.francs, goods: clone(player.goods) };
  if (!payCost(fake, cost)) return false;
  return canPayEnergy(fake, amount);
}

/** Pay goods and energy atomically; restores goods if either step fails. */
function payCostAndEnergy(player, cost, amount) {
  const backup = clone(player.goods);
  if (!payCost(player, cost) || !payEnergy(player, amount)) {
    player.goods = backup;
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Supply tiles & offers                                               */
/* ------------------------------------------------------------------ */

const TILE_TEMPLATES = Object.freeze([
  Object.freeze({ tokens: Object.freeze([{ key: 'wood', n: 1 }, { key: 'fish', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'clay', n: 1 }, { key: 'francs', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'iron', n: 1 }, { key: 'grain', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'cattle', n: 1 }, { key: 'wood', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'francs', n: 1 }, { key: 'fish', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'grain', n: 1 }, { key: 'clay', n: 1 }]), interest: false }),
  Object.freeze({ tokens: Object.freeze([{ key: 'iron', n: 1 }, { key: 'cattle', n: 1 }]), interest: true })
]);

function addOffer(state, key, amount) {
  assert(Object.prototype.hasOwnProperty.call(state.offers, key), 'unknown offer space: ' + key);
  state.offers[key] += amount;
}

function resolveInterest(state) {
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    if (p.loans <= 0) continue;
    if (p.francs < 1) {
      p.loans += 1;
      p.francs += 4;
      state.events.push({ kind: 'loan', player: i, reason: 'interest', loans: p.loans, round: state.round });
    }
    p.francs -= 1;
    state.events.push({ kind: 'interest', player: i, paid: 1, round: state.round });
  }
}

function beginTurn(state) {
  if (state.phase !== 'turn') return;
  const tile = state.supplyTiles[state.supplyIndex];
  if (tile) {
    tile.revealed = true;
    for (const token of tile.tokens) addOffer(state, token.key, token.n);
    state.supplyIndex += 1;
    state.events.push({
      kind: 'supply', round: state.round, turn: state.turnInRound,
      player: state.currentPlayer, tile: tile.id, tokens: clone(tile.tokens)
    });
    if (tile.interest) resolveInterest(state);
  }
}

/* ------------------------------------------------------------------ */
/* Turn order helpers                                                  */
/* ------------------------------------------------------------------ */

export function currentPlayer(state) {
  if (state.phase === 'gameover') return null;
  if (state.phase === 'feeding') return state.feederCursor;
  return state.currentPlayer;
}

function roundFood(state) {
  const schedule = ROUND_FOOD_SCHEDULE[state.playerCount] || ROUND_FOOD_SCHEDULE[2];
  return schedule[Math.min(state.round, schedule.length) - 1] || 0;
}

export function feedObligation(state, playerIndex) {
  if (!state.players[playerIndex]) return 0;
  return Math.max(0, roundFood(state) - shipFoodOf(state.players[playerIndex]));
}

/* ------------------------------------------------------------------ */
/* Household / setup                                                   */
/* ------------------------------------------------------------------ */

function makePlayer(index, playerCount) {
  const goods = emptyGoods();
  goods.coal = PLAYER_START_COAL;
  return {
    id: index,
    name: '玩家' + (index + 1),
    francs: PLAYER_START_FRANCS,
    loans: 0,
    goods,
    disc: null,
    buildings: [],
    ships: []
  };
}

function buildShipDeck(seed) {
  const cards = [];
  for (const type of SHIP_TYPE_IDS) {
    for (const value of SHIP_TYPES[type].values) cards.push({ type, value });
  }
  // The setup places a 2-value wooden ship face up for the first rounds.
  const initialIndex = cards.findIndex((c) => c.type === 'wood' && c.value === 2);
  const initial = cards.splice(initialIndex, 1)[0];
  const deck = shuffleWith(cards, seed + ':ships');
  return { initial, deck };
}

export function createGame(opts = {}) {
  const playerCount = Math.max(1, Math.min(5, Number(opts.playerCount) || 2));
  const seed = opts.seed === undefined ? 1 : opts.seed;
  const maxRound = Number(opts.maxRound) > 0
    ? Math.floor(Number(opts.maxRound))
    : ROUNDS_BY_PLAYERS[playerCount];

  const players = [];
  for (let i = 0; i < playerCount; i += 1) players.push(makePlayer(i, playerCount));

  const pool = shuffleWith(BUILDING_IDS.filter((id) => !BUILDINGS[id].starting), seed + ':buildings');
  const proposals = pool.slice(0, Math.min(3, pool.length));
  const proposalDeck = pool.slice(proposals.length);

  const owner = {};
  const townBuildings = STARTING_BUILDINGS.slice();
  for (const id of STARTING_BUILDINGS) owner[id] = -1;

  const supplyTiles = shuffleWith(
    TILE_TEMPLATES.map((t, i) => ({
      id: i,
      tokens: clone(t.tokens),
      interest: t.interest,
      revealed: false
    })),
    seed + ':supply'
  );

  const shipData = buildShipDeck(seed);
  const introduced = { wood: 0, iron: 0, steel: 0, luxury: 0 };
  introduced[shipData.initial.type] = 1;
  const purchased = { wood: 0, iron: 0, steel: 0, luxury: 0 };

  const state = {
    version: VERSION,
    seed: String(seed),
    playerCount,
    maxRound,
    round: 1,
    turnInRound: 1,
    phase: 'turn',
    currentPlayer: 0,
    firstPlayer: 0,
    feederCursor: null,
    supplyIndex: 0,
    offers: clone(STARTING_OFFERS),
    supplyTiles,
    proposals,
    proposalDeck,
    townBuildings,
    owner,
    occupancy: {},
    wharfModernized: {},
    shipMarket: {
      introduced,
      purchased,
      initial: shipData.initial,
      deck: shipData.deck
    },
    players,
    events: [],
    lastAction: null,
    initialOffers: clone(STARTING_OFFERS)
  };

  beginTurn(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Legal actions                                                       */
/* ------------------------------------------------------------------ */

function actionKey(action) {
  return stableStringify(action);
}

function useAction(building, params) {
  const action = { type: 'useBuilding', building };
  if (params !== undefined) action.params = params;
  return action;
}

function entryFeeFor(state, playerIndex, buildingId) {
  const def = BUILDINGS[buildingId];
  if (!def) return 0;
  const owner = state.owner[buildingId];
  if (owner === playerIndex) return 0;
  return def.entry || 0;
}

function isMainAction(action) {
  return action.type === 'takeOffer' || action.type === 'useBuilding' || action.type === 'pass';
}

function availableShipFor(state, type) {
  const intro = state.shipMarket.introduced[type] || 0;
  const bought = state.shipMarket.purchased[type] || 0;
  if (bought >= intro) return null;
  return { type, value: SHIP_TYPES[type].values[bought] };
}

function shipBuyPrice(ship) {
  return ship.value + SHIP_BUY_MARKUP;
}

function constructActionTargets(state, playerIndex, buildingId, kind) {
  const p = state.players[playerIndex];
  const out = [];
  const proposalIds = state.proposals.slice();
  if (kind === 'constructSawmill') {
    for (const id of proposalIds) {
      const def = BUILDINGS[id];
      if (!def || !def.cost || !(def.cost.wood > 0)) continue;
      const cost = Object.assign({}, def.cost);
      cost.wood -= 1;
      if (canPayCost(p, cost)) out.push([id]);
    }
    return out;
  }
  for (const id of proposalIds) {
    const def = BUILDINGS[id];
    if (!def || !def.cost) continue;
    if (canPayCost(p, def.cost)) out.push([id]);
  }
  if (kind === 'construct2') {
    for (let i = 0; i < proposalIds.length; i += 1) {
      for (let j = i + 1; j < proposalIds.length; j += 1) {
        const a = BUILDINGS[proposalIds[i]];
        const c = BUILDINGS[proposalIds[j]];
        if (!a || !a.cost || !c || !c.cost) continue;
        if (canPayCosts(p, [a.cost, c.cost])) out.push([proposalIds[i], proposalIds[j]]);
      }
    }
  }
  return out;
}

function combinations(items, size) {
  const out = [];
  const current = [];
  function walk(start) {
    if (current.length === size) {
      out.push(current.slice());
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      current.push(items[i]);
      walk(i + 1);
      current.pop();
    }
  }
  walk(0);
  return out;
}

function lowestGoods(player, count, excludeKey) {
  const list = [];
  for (const key of GOODS) {
    if (key === excludeKey) continue;
    for (let i = 0; i < (player.goods[key] || 0); i += 1) list.push(key);
  }
  list.sort((a, c) => (TRADE_WEIGHT[a] || 1) - (TRADE_WEIGHT[c] || 1) || a.localeCompare(c));
  return list.slice(0, count);
}

function buildingUseActions(state, playerIndex, buildingId, out) {
  const def = BUILDINGS[buildingId];
  if (!def || !def.action) return;
  if (state.occupancy[buildingId] !== undefined) return;
  const p = state.players[playerIndex];
  const fee = entryFeeFor(state, playerIndex, buildingId);
  if (p.francs < fee) return;

  switch (def.action) {
    case 'construct1':
    case 'construct2':
    case 'constructSawmill': {
      const lists = constructActionTargets(state, playerIndex, buildingId, def.action);
      for (const targets of lists) out.push(useAction(buildingId, { targets }));
      break;
    }
    case 'fishery':
    case 'hardware':
    case 'grocery':
    case 'colliery':
    case 'clayMound':
    case 'artsCenter':
    case 'blackMarket':
    case 'church':
      if (def.action === 'church') {
        if ((p.goods.bread || 0) < 5 || (p.goods.fish || 0) < 2) break;
      }
      out.push(useAction(buildingId, {}));
      break;
    case 'ironworks':
      out.push(useAction(buildingId, { extra: false }));
      if (canPayEnergy(p, 6)) out.push(useAction(buildingId, { extra: true }));
      break;
    case 'marketplace': {
      const craftsmen = countCategory(state, playerIndex, 'C');
      const size = Math.min(STANDARD_GOODS.length, 2 + craftsmen);
      for (const goods of combinations(STANDARD_GOODS, size)) out.push(useAction(buildingId, { goods }));
      break;
    }
    case 'charcoalKiln': {
      for (let qty = 1; qty <= (p.goods.wood || 0); qty += 1) out.push(useAction(buildingId, { qty }));
      break;
    }
    case 'mill': {
      for (let qty = 1; qty <= (p.goods.grain || 0); qty += 1) out.push(useAction(buildingId, { qty }));
      break;
    }
    case 'brickworks': {
      const max = Math.min(p.goods.clay || 0, 20);
      for (let qty = 1; qty <= max; qty += 1) {
        if (canPayEnergy(p, Math.ceil(qty / 2))) out.push(useAction(buildingId, { qty }));
      }
      break;
    }
    case 'smokehouse': {
      const max = Math.min(6, p.goods.fish || 0);
      if (canPayEnergy(p, 1)) {
        for (let qty = 1; qty <= max; qty += 1) out.push(useAction(buildingId, { qty }));
      }
      break;
    }
    case 'bakehouse': {
      for (let qty = 1; qty <= (p.goods.grain || 0); qty += 1) {
        if (canPayEnergy(p, Math.ceil(qty / 2))) {
          out.push(useAction(buildingId, { source: 'grain', qty }));
        }
      }
      for (let qty = 1; qty <= (p.goods.flour || 0); qty += 1) {
        if (canPayEnergy(p, Math.ceil(qty / 2))) {
          out.push(useAction(buildingId, { source: 'flour', qty }));
        }
      }
      break;
    }
    case 'abattoir': {
      for (let qty = 1; qty <= (p.goods.cattle || 0); qty += 1) out.push(useAction(buildingId, { qty }));
      break;
    }
    case 'tannery': {
      const max = Math.min(4, p.goods.hide || 0);
      for (let qty = 1; qty <= max; qty += 1) out.push(useAction(buildingId, { qty }));
      break;
    }
    case 'cokery': {
      for (let qty = 1; qty <= (p.goods.coal || 0); qty += 1) out.push(useAction(buildingId, { qty }));
      break;
    }
    case 'steelMill': {
      for (let qty = 1; qty <= (p.goods.iron || 0); qty += 1) {
        if (canPayEnergy(p, qty * 5)) out.push(useAction(buildingId, { qty }));
      }
      break;
    }
    case 'blacksmith': {
      for (let qty = 1; qty <= (p.goods.iron || 0); qty += 1) {
        if (canPayEnergy(p, qty * 6)) out.push(useAction(buildingId, { qty }));
      }
      break;
    }
    case 'joinery': {
      for (let qty = 1; qty <= Math.min(3, p.goods.wood || 0); qty += 1) {
        out.push(useAction(buildingId, { qty }));
      }
      break;
    }
    case 'business': {
      if (goodsTokenCount(p) >= 4) out.push(useAction(buildingId, { mode: 'steel' }));
      for (const good of ['charcoal', 'leather', 'brick']) {
        if (lowestGoods(p, 1, good).length === 1) out.push(useAction(buildingId, { mode: 'single', good }));
      }
      break;
    }
    case 'shipping': {
      const usable = p.ships.filter((s) => SHIP_TYPES[s.type].capacity > 0).length;
      if (usable > 0 && goodsTokenCount(p) > 0) {
        for (let n = 1; n <= usable; n += 1) {
          if (canPayEnergy(p, 3 * n)) out.push(useAction(buildingId, { ships: n }));
        }
      }
      break;
    }
    case 'wharf': {
      for (const type of SHIP_TYPE_IDS) {
        const ship = availableShipFor(state, type);
        if (!ship) continue;
        const typeDef = SHIP_TYPES[type];
        if (!canPayCostAndEnergy(p, typeDef.cost, typeDef.energy)) continue;
        if (type !== 'wood' && !state.wharfModernized[buildingId] && (p.goods.brick || 0) < 1) continue;
        out.push(useAction(buildingId, { shipType: type }));
      }
      break;
    }
    case 'localCourt': {
      if (p.loans > 0) out.push(useAction(buildingId, {}));
      break;
    }
    case 'bridge': {
      if (goodsTokenCount(p) >= 1) out.push(useAction(buildingId, {}));
      break;
    }
    default:
      break;
  }
}

export function legalActions(state, playerIndex) {
  if (state.phase === 'gameover') return [];
  if (state.phase === 'feeding') {
    if (playerIndex !== undefined && playerIndex !== state.feederCursor) return [];
    return [{ type: 'feed', player: state.feederCursor }];
  }

  const actor = state.currentPlayer;
  if (playerIndex !== undefined && playerIndex !== actor) return [];
  const p = state.players[actor];
  const optional = [];
  const main = [];

  // Optional additional actions: buying / selling / loan repayment.
  for (const id of state.proposals) {
    const def = BUILDINGS[id];
    if (!def || def.noBuy) continue;
    const cost = def.buyCost === undefined || def.buyCost === null ? def.value : def.buyCost;
    if (p.francs >= cost) optional.push({ type: 'buyBuilding', building: id });
  }
  for (const id of state.townBuildings) {
    const def = BUILDINGS[id];
    if (!def || def.noBuy) continue;
    const cost = def.buyCost === undefined || def.buyCost === null ? def.value : def.buyCost;
    if (p.francs >= cost) optional.push({ type: 'buyBuilding', building: id });
  }
  for (const type of SHIP_TYPE_IDS) {
    const ship = availableShipFor(state, type);
    if (ship && p.francs >= shipBuyPrice(ship)) optional.push({ type: 'buyShip', shipType: type });
  }
  if (p.loans > 0 && p.francs >= 5) optional.push({ type: 'repayLoan' });
  for (const id of p.buildings) {
    if (BUILDINGS[id]) optional.push({ type: 'sellBuilding', building: id });
  }
  for (let i = 0; i < p.ships.length; i += 1) {
    optional.push({ type: 'sellShip', index: i });
  }

  // Main action A: take all goods from an Offer space.
  for (const space of OFFER_SPACES) {
    if (state.offers[space] > 0) main.push({ type: 'takeOffer', space });
  }

  // Main action B: use an unoccupied building with an available action.
  // Only town-owned and player-owned buildings exist on the board; the cards
  // still sitting in the Building Proposals have not been constructed yet and
  // therefore cannot be entered.
  const usable = [];
  for (const id of state.townBuildings) if (!usable.includes(id)) usable.push(id);
  for (let i = 0; i < state.playerCount; i += 1) {
    for (const id of state.players[i].buildings) if (!usable.includes(id)) usable.push(id);
  }
  for (const id of usable) buildingUseActions(state, actor, id, main);

  if (main.length === 0) main.push({ type: 'pass' });
  return optional.concat(main);
}

/* ------------------------------------------------------------------ */
/* Applying actions                                                    */
/* ------------------------------------------------------------------ */

function moveDisc(state, playerIndex, buildingId) {
  const p = state.players[playerIndex];
  if (p.disc !== null && state.occupancy[p.disc] === playerIndex) delete state.occupancy[p.disc];
  p.disc = buildingId;
  state.occupancy[buildingId] = playerIndex;
}

function clearOccupant(state, buildingId) {
  const occupant = state.occupancy[buildingId];
  if (occupant === undefined) return;
  delete state.occupancy[buildingId];
  const p = state.players[occupant];
  if (p && p.disc === buildingId) p.disc = null;
}

function addOwnedBuilding(state, playerIndex, buildingId) {
  const p = state.players[playerIndex];
  state.owner[buildingId] = playerIndex;
  if (!p.buildings.includes(buildingId)) p.buildings.push(buildingId);
}

function removeProposal(state, buildingId) {
  const idx = state.proposals.indexOf(buildingId);
  if (idx === -1) return false;
  state.proposals.splice(idx, 1);
  if (state.proposalDeck.length > 0) state.proposals.push(state.proposalDeck.shift());
  return true;
}

function payEntryFee(state, playerIndex, buildingId) {
  const fee = entryFeeFor(state, playerIndex, buildingId);
  if (fee === 0) return 0;
  const p = state.players[playerIndex];
  assert(p.francs >= fee, 'cannot pay entry fee');
  p.francs -= fee;
  const owner = state.owner[buildingId];
  if (owner !== undefined && owner >= 0) state.players[owner].francs += fee;
  return fee;
}

function harvest(state) {
  for (let i = 0; i < state.players.length; i += 1) {
    const p = state.players[i];
    let grain = 0;
    let cattle = 0;
    if ((p.goods.grain || 0) >= 1) {
      p.goods.grain += 1;
      grain = 1;
    }
    if ((p.goods.cattle || 0) >= 2) {
      p.goods.cattle += 1;
      cattle = 1;
    }
    if (grain || cattle) state.events.push({ kind: 'harvest', player: i, grain, cattle, round: state.round });
  }
}

function feedPlayer(state, playerIndex) {
  const p = state.players[playerIndex];
  let need = feedObligation(state, playerIndex);
  const before = { need, food: foodValueOf(p), francs: p.francs, loans: p.loans };

  // Food tokens first, smallest food value first so overpay is minimised.
  for (const key of ['fish', 'bread', 'smokedFish', 'meat']) {
    while (need > 0 && (p.goods[key] || 0) > 0) {
      p.goods[key] -= 1;
      need -= FOOD_VALUE[key];
    }
  }
  if (need > 0) {
    const pay = Math.min(p.francs, need);
    p.francs -= pay;
    need -= pay;
  }
  let loansTaken = 0;
  if (need > 0) {
    loansTaken = Math.ceil(need / 4);
    p.loans += loansTaken;
    p.francs += loansTaken * 4;
    p.francs -= need;
    need = 0;
    state.events.push({
      kind: 'loan', player: playerIndex, reason: 'feeding', loans: loansTaken,
      total: p.loans, round: state.round
    });
  }
  state.events.push({
    kind: 'feed', player: playerIndex, required: before.need,
    foodBefore: before.food, francsBefore: before.francs,
    loansTaken, francsAfter: p.francs, round: state.round
  });
}

function endRound(state) {
  // A new ship card becomes available after each Round card is resolved.
  if (state.shipMarket.deck.length > 0) {
    const card = state.shipMarket.deck.shift();
    state.shipMarket.introduced[card.type] += 1;
    state.events.push({ kind: 'ship-arrival', type: card.type, value: card.value, round: state.round });
  }
  // The town constructs one building at the end of every round, taking the
  // proposal with the lowest sort order (official rule); the row then refills.
  // The official Round cards only show the building symbol on some rounds;
  // phase 1 does it every round so the 3-slot proposal row cannot stall.
  if (state.proposals.length > 0) {
    let pick = 0;
    for (let i = 1; i < state.proposals.length; i += 1) {
      if (BUILDINGS[state.proposals[i]].sort < BUILDINGS[state.proposals[pick]].sort) pick = i;
    }
    const id = state.proposals.splice(pick, 1)[0];
    state.townBuildings.push(id);
    state.owner[id] = -1;
    if (state.proposalDeck.length > 0) state.proposals.push(state.proposalDeck.shift());
    state.events.push({ kind: 'town-build', building: id, round: state.round });
  } else if (state.proposalDeck.length > 0) {
    const id = state.proposalDeck.shift();
    state.townBuildings.push(id);
    state.owner[id] = -1;
    state.events.push({ kind: 'town-build', building: id, round: state.round });
  }

  state.round += 1;
  if (state.round > state.maxRound) {
    state.phase = 'gameover';
    state.currentPlayer = null;
    state.feederCursor = null;
    state.events.push({ kind: 'gameover', round: state.round - 1 });
    return;
  }
  state.phase = 'turn';
  state.firstPlayer = (state.round - 1) % state.playerCount;
  state.currentPlayer = state.firstPlayer;
  state.turnInRound = 1;
  state.supplyIndex = 0;
  state.feederCursor = null;
  beginTurn(state);
}

function finishMainAction(state) {
  state.events.push({
    kind: 'turn-end', round: state.round, turn: state.turnInRound, player: state.currentPlayer
  });
  if (state.turnInRound >= TURNS_PER_ROUND) {
    harvest(state);
    state.phase = 'feeding';
    state.feederCursor = state.firstPlayer;
    state.events.push({ kind: 'feeding-start', round: state.round, food: roundFood(state) });
    return;
  }
  state.turnInRound += 1;
  state.currentPlayer = (state.currentPlayer + 1) % state.playerCount;
  beginTurn(state);
}

function applyFeed(state) {
  const idx = state.feederCursor;
  assert(idx !== null && idx !== undefined, 'feed: no feeder');
  feedPlayer(state, idx);
  state.feederCursor += 1;
  if (state.feederCursor >= state.playerCount) {
    state.feederCursor = null;
    endRound(state);
  }
}

function effectConstruct(state, playerIndex, buildingId, params) {
  const def = BUILDINGS[buildingId];
  const p = state.players[playerIndex];
  const targets = params.targets || [];
  assert(targets.length > 0, 'construct: no targets');
  if (def.action === 'construct2') assert(targets.length <= 2, 'construct: too many targets');
  else assert(targets.length === 1, 'construct: exactly one target');
  for (const target of targets) {
    assert(state.proposals.includes(target), 'construct: target not in proposals: ' + target);
    const targetDef = BUILDINGS[target];
    assert(targetDef && targetDef.cost, 'construct: target cannot be built');
    let cost = Object.assign({}, targetDef.cost);
    if (def.action === 'constructSawmill') {
      assert(cost.wood > 0, 'sawmill: target needs wood');
      cost.wood -= 1;
    }
    assert(payCost(p, cost), 'construct: cannot pay cost');
    removeProposal(state, target);
    addOwnedBuilding(state, playerIndex, target);
    state.events.push({
      kind: 'build', player: playerIndex, building: target,
      via: buildingId, cost, round: state.round
    });
  }
}

function effectGainBundle(state, playerIndex, action) {
  const p = state.players[playerIndex];
  switch (action) {
    case 'fishery': {
      const n = 3 + countSymbol(state, playerIndex, 'fisherman');
      p.goods.fish += n;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { fish: n }, building: 'fishery' });
      break;
    }
    case 'hardware':
      p.goods.wood += 1;
      p.goods.brick += 1;
      p.goods.iron += 1;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { wood: 1, brick: 1, iron: 1 }, building: 'hardwareStore' });
      break;
    case 'grocery':
      p.goods.cattle += 1;
      p.goods.meat += 1;
      p.goods.fish += 1;
      p.goods.smokedFish += 1;
      p.goods.grain += 1;
      p.goods.bread += 1;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { cattle: 1, meat: 1, fish: 1, smokedFish: 1, grain: 1, bread: 1 }, building: 'groceryMarket' });
      break;
    case 'colliery': {
      const n = 3 + (countSymbol(state, playerIndex, 'hammer') > 0 ? 1 : 0);
      p.goods.coal += n;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { coal: n }, building: 'colliery' });
      break;
    }
    case 'clayMound': {
      const n = 3 + countSymbol(state, playerIndex, 'hammer');
      p.goods.clay += n;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { clay: n }, building: 'clayMound' });
      break;
    }
    case 'artsCenter': {
      let n = 0;
      for (let i = 0; i < state.playerCount; i += 1) {
        if (i === playerIndex) continue;
        const other = state.players[i];
        if (other.disc !== null && state.owner[other.disc] === playerIndex) n += 1;
      }
      p.francs += n * 4;
      state.events.push({ kind: 'gain', player: playerIndex, francs: n * 4, building: 'artsCenter' });
      break;
    }
    case 'blackMarket': {
      const gains = {};
      for (const space of OFFER_SPACES) {
        if (state.offers[space] !== 0) continue;
        if (space === 'francs') p.francs += 2;
        else p.goods[space] += 2;
        gains[space] = 2;
      }
      state.events.push({ kind: 'gain', player: playerIndex, gains, building: 'blackMarket' });
      break;
    }
    case 'church':
      p.goods.bread -= 5;
      p.goods.fish -= 2;
      p.goods.bread += 5;
      p.goods.fish += 3;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { bread: 5, fish: 3 }, building: 'church' });
      break;
    default:
      break;
  }
}

function effectUseBuilding(state, playerIndex, action) {
  const buildingId = action.building;
  const def = BUILDINGS[buildingId];
  const params = action.params || {};
  const p = state.players[playerIndex];
  assert(def, 'unknown building: ' + buildingId);
  assert(def.action, 'building has no action: ' + buildingId);
  assert(state.occupancy[buildingId] === undefined, 'building occupied: ' + buildingId);
  assert(p.francs >= entryFeeFor(state, playerIndex, buildingId), 'cannot pay entry fee');

  payEntryFee(state, playerIndex, buildingId);
  moveDisc(state, playerIndex, buildingId);

  switch (def.action) {
    case 'construct1':
    case 'construct2':
    case 'constructSawmill':
      effectConstruct(state, playerIndex, buildingId, params);
      break;
    case 'fishery':
    case 'hardware':
    case 'grocery':
    case 'colliery':
    case 'clayMound':
    case 'artsCenter':
    case 'blackMarket':
    case 'church':
      effectGainBundle(state, playerIndex, def.action);
      break;
    case 'ironworks': {
      const extra = !!params.extra;
      if (extra) assert(payEnergy(p, 6), 'ironworks: cannot pay 6 energy');
      p.goods.iron += extra ? 4 : 3;
      state.events.push({ kind: 'gain', player: playerIndex, gains: { iron: extra ? 4 : 3 }, building: 'ironworks' });
      break;
    }
    case 'marketplace': {
      const goods = params.goods || [];
      const craftsmen = countCategory(state, playerIndex, 'C');
      const size = Math.min(STANDARD_GOODS.length, 2 + craftsmen);
      assert(goods.length === size, 'marketplace: wrong number of goods');
      const seen = new Set();
      for (const key of goods) {
        assert(STANDARD_GOODS.includes(key), 'marketplace: not a standard good');
        assert(!seen.has(key), 'marketplace: duplicate good');
        seen.add(key);
      }
      for (const key of goods) p.goods[key] += 1;
      state.events.push({ kind: 'gain', player: playerIndex, gains: goods.reduce((m, k) => { m[k] = 1; return m; }, {}), building: 'marketplace' });
      break;
    }
    case 'charcoalKiln': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.wood >= qty, 'charcoal kiln: bad qty');
      p.goods.wood -= qty;
      p.goods.charcoal += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'wood', to: 'charcoal', qty, building: 'charcoalKiln' });
      break;
    }
    case 'mill': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.grain >= qty, 'mill: bad qty');
      p.goods.grain -= qty;
      p.goods.flour += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'grain', to: 'flour', qty, building: 'mill' });
      break;
    }
    case 'brickworks': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.clay >= qty, 'brickworks: bad qty');
      assert(payEnergy(p, Math.ceil(qty / 2)), 'brickworks: cannot pay energy');
      p.goods.clay -= qty;
      p.goods.brick += qty;
      const subsidy = Math.floor(qty / 2);
      p.francs += subsidy;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'clay', to: 'brick', qty, subsidy, building: 'brickworks' });
      break;
    }
    case 'smokehouse': {
      const qty = params.qty;
      assert(qty >= 1 && qty <= 6 && p.goods.fish >= qty, 'smokehouse: bad qty');
      assert(payEnergy(p, 1), 'smokehouse: cannot pay energy');
      p.goods.fish -= qty;
      p.goods.smokedFish += qty;
      const subsidy = Math.floor(qty / 2);
      p.francs += subsidy;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'fish', to: 'smokedFish', qty, subsidy, building: 'smokehouse' });
      break;
    }
    case 'bakehouse': {
      const qty = params.qty;
      const source = params.source;
      assert(source === 'grain' || source === 'flour', 'bakehouse: bad source');
      assert(qty >= 1, 'bakehouse: bad qty');
      assert(payEnergy(p, Math.ceil(qty / 2)), 'bakehouse: cannot pay energy');
      let bread;
      if (source === 'grain') {
        assert(p.goods.grain >= qty, 'bakehouse: not enough grain');
        p.goods.grain -= qty;
        bread = qty;
      } else {
        assert(p.goods.flour >= qty, 'bakehouse: not enough flour');
        p.goods.flour -= qty;
        bread = qty * 2;
      }
      p.goods.bread += bread;
      const subsidy = Math.floor(bread / 2);
      p.francs += subsidy;
      state.events.push({ kind: 'convert', player: playerIndex, from: source, to: 'bread', qty: bread, subsidy, building: 'bakehouse' });
      break;
    }
    case 'abattoir': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.cattle >= qty, 'abattoir: bad qty');
      p.goods.cattle -= qty;
      p.goods.meat += qty;
      const hides = Math.floor(qty / 2);
      p.goods.hide += hides;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'cattle', to: 'meat', qty, hides, building: 'abattoir' });
      break;
    }
    case 'tannery': {
      const qty = params.qty;
      assert(qty >= 1 && qty <= 4 && p.goods.hide >= qty, 'tannery: bad qty');
      p.goods.hide -= qty;
      p.goods.leather += qty;
      p.francs += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'hide', to: 'leather', qty, subsidy: qty, building: 'tannery' });
      break;
    }
    case 'cokery': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.coal >= qty, 'cokery: bad qty');
      p.goods.coal -= qty;
      p.goods.coke += qty;
      p.francs += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'coal', to: 'coke', qty, subsidy: qty, building: 'cokery' });
      break;
    }
    case 'steelMill': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.iron >= qty, 'steel mill: bad qty');
      assert(payEnergy(p, qty * 5), 'steel mill: cannot pay energy');
      p.goods.iron -= qty;
      p.goods.steel += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'iron', to: 'steel', qty, building: 'steelMill' });
      break;
    }
    case 'blacksmith': {
      const qty = params.qty;
      assert(qty >= 1 && p.goods.iron >= qty, 'blacksmith: bad qty');
      assert(payEnergy(p, qty * 6), 'blacksmith: cannot pay energy');
      p.goods.iron -= qty;
      p.goods.steel += qty;
      state.events.push({ kind: 'convert', player: playerIndex, from: 'iron', to: 'steel', qty, building: 'blacksmith' });
      break;
    }
    case 'joinery': {
      const qty = params.qty;
      assert(qty >= 1 && qty <= 3 && p.goods.wood >= qty, 'joinery: bad qty');
      p.goods.wood -= qty;
      p.francs += 4 + qty;
      state.events.push({ kind: 'sell', player: playerIndex, goods: { wood: qty }, francs: 4 + qty, building: 'joinery' });
      break;
    }
    case 'business': {
      if (params.mode === 'steel') {
        const picked = lowestGoods(p, 4);
        assert(picked.length === 4, 'business office: need 4 goods');
        for (const key of picked) p.goods[key] -= 1;
        p.goods.steel += 1;
        state.events.push({ kind: 'convert', player: playerIndex, goods: picked, to: 'steel', qty: 1, building: 'businessOffice' });
      } else {
        const good = params.good;
        assert(['charcoal', 'leather', 'brick'].includes(good), 'business office: bad good');
        const picked = lowestGoods(p, 1, good);
        assert(picked.length === 1, 'business office: need 1 good');
        p.goods[picked[0]] -= 1;
        p.goods[good] += 1;
        state.events.push({ kind: 'convert', player: playerIndex, goods: picked, to: good, qty: 1, building: 'businessOffice' });
      }
      break;
    }
    case 'shipping': {
      const n = params.ships;
      assert(n >= 1, 'shipping: bad ships');
      const usable = p.ships
        .filter((s) => SHIP_TYPES[s.type].capacity > 0)
        .slice(0, n);
      assert(usable.length === n, 'shipping: not enough ships');
      assert(payEnergy(p, 3 * n), 'shipping: cannot pay energy');
      const capacity = usable.reduce((sum, s) => sum + SHIP_TYPES[s.type].capacity, 0);
      const candidates = [];
      for (const key of GOODS) {
        for (let i = 0; i < (p.goods[key] || 0); i += 1) candidates.push(key);
      }
      candidates.sort((a, c) => (SHIP_GOOD_VALUE[c] || 1) - (SHIP_GOOD_VALUE[a] || 1));
      const shipped = candidates.slice(0, capacity);
      let francs = 0;
      const gains = {};
      for (const key of shipped) {
        p.goods[key] -= 1;
        const value = SHIP_GOOD_VALUE[key] || 1;
        francs += value;
        gains[key] = (gains[key] || 0) + 1;
      }
      p.francs += francs;
      state.events.push({ kind: 'ship-goods', player: playerIndex, gains, francs, ships: n, building: 'shippingLine' });
      break;
    }
    case 'wharf': {
      const type = params.shipType;
      const ship = availableShipFor(state, type);
      assert(ship, 'wharf: ship not available');
      const typeDef = SHIP_TYPES[type];
      if (type !== 'wood' && !state.wharfModernized[buildingId]) {
        assert((p.goods.brick || 0) >= 1, 'wharf: need brick to modernise');
        p.goods.brick -= 1;
        state.wharfModernized[buildingId] = true;
        state.events.push({ kind: 'modernise', player: playerIndex, building: buildingId, round: state.round });
      }
      assert(payCostAndEnergy(p, typeDef.cost, typeDef.energy), 'wharf: cannot pay ship cost and energy');
      state.shipMarket.purchased[type] += 1;
      p.ships.push({ type, value: ship.value });
      state.events.push({ kind: 'build-ship', player: playerIndex, type, value: ship.value, building: buildingId });
      break;
    }
    case 'localCourt': {
      const before = p.loans;
      if (before === 1) {
        p.loans -= 1;
      } else if (before === 2) {
        p.loans -= 1;
        p.francs += 2;
      } else if (before >= 3) {
        p.loans -= 2;
      }
      state.events.push({ kind: 'loans-returned', player: playerIndex, before, after: p.loans, building: 'localCourt' });
      break;
    }
    case 'bridge': {
      let francs = 0;
      const sold = {};
      for (const key of GOODS) {
        const count = p.goods[key] || 0;
        if (count === 0) continue;
        const upgraded = ['charcoal', 'coke', 'steel', 'brick', 'leather', 'meat', 'bread', 'smokedFish', 'flour'].includes(key);
        if (upgraded) {
          sold[key] = count;
          francs += count;
          p.goods[key] = 0;
        } else {
          const groups = Math.floor(count / 3);
          if (groups > 0) {
            sold[key] = groups * 3;
            francs += groups;
            p.goods[key] -= groups * 3;
          }
        }
      }
      p.francs += francs;
      state.events.push({ kind: 'sell', player: playerIndex, goods: sold, francs, building: 'bridge' });
      break;
    }
    default:
      throw new Error('unhandled building action: ' + def.action);
  }
}

function applyOptionalAction(state, action) {
  const p = state.players[state.currentPlayer];
  switch (action.type) {
    case 'buyBuilding': {
      const id = action.building;
      const def = BUILDINGS[id];
      assert(def && !def.noBuy, 'buyBuilding: not buyable');
      const cost = def.buyCost === undefined || def.buyCost === null ? def.value : def.buyCost;
      assert(p.francs >= cost, 'buyBuilding: cannot pay');
      const inProposal = state.proposals.includes(id);
      const inTown = state.townBuildings.includes(id);
      assert(inProposal || inTown, 'buyBuilding: not available');
      p.francs -= cost;
      clearOccupant(state, id);
      if (inProposal) removeProposal(state, id);
      else state.townBuildings.splice(state.townBuildings.indexOf(id), 1);
      addOwnedBuilding(state, state.currentPlayer, id);
      state.events.push({ kind: 'buy', player: state.currentPlayer, building: id, cost });
      break;
    }
    case 'buyShip': {
      const type = action.shipType;
      const ship = availableShipFor(state, type);
      assert(ship, 'buyShip: not available');
      const price = shipBuyPrice(ship);
      assert(p.francs >= price, 'buyShip: cannot pay');
      p.francs -= price;
      state.shipMarket.purchased[type] += 1;
      p.ships.push({ type, value: ship.value });
      state.events.push({ kind: 'buy-ship', player: state.currentPlayer, type, value: ship.value, price });
      break;
    }
    case 'repayLoan': {
      assert(p.loans > 0 && p.francs >= 5, 'repayLoan: cannot repay');
      p.loans -= 1;
      p.francs -= 5;
      state.events.push({ kind: 'repay-loan', player: state.currentPlayer, loans: p.loans });
      break;
    }
    case 'sellBuilding': {
      const id = action.building;
      assert(p.buildings.includes(id), 'sellBuilding: not owned');
      const value = BUILDINGS[id].value;
      const proceeds = Math.floor(value / 2);
      p.buildings.splice(p.buildings.indexOf(id), 1);
      p.francs += proceeds;
      clearOccupant(state, id);
      state.owner[id] = -1;
      if (!state.townBuildings.includes(id)) state.townBuildings.push(id);
      state.events.push({ kind: 'sell-building', player: state.currentPlayer, building: id, proceeds });
      break;
    }
    case 'sellShip': {
      const index = action.index;
      assert(index >= 0 && index < p.ships.length, 'sellShip: bad index');
      const ship = p.ships[index];
      const proceeds = Math.floor(ship.value / 2);
      p.ships.splice(index, 1);
      p.francs += proceeds;
      if (state.shipMarket.purchased[ship.type] > 0) state.shipMarket.purchased[ship.type] -= 1;
      state.events.push({ kind: 'sell-ship', player: state.currentPlayer, type: ship.type, value: ship.value, proceeds });
      break;
    }
    default:
      throw new Error('unhandled optional action: ' + action.type);
  }
}

export function applyAction(state, action) {
  assert(action && typeof action.type === 'string', 'applyAction: action required');
  const next = clone(state);
  const legal = legalActions(next);
  const key = actionKey(action);
  const found = legal.some((a) => actionKey(a) === key);
  if (!found) {
    throw new Error('illegal action: ' + key + ' (phase=' + next.phase + ')');
  }

  if (next.phase === 'feeding') {
    applyFeed(next);
    return next;
  }

  next.lastAction = key;
  switch (action.type) {
    case 'takeOffer': {
      const space = action.space;
      const count = next.offers[space];
      assert(count > 0, 'takeOffer: empty offer');
      next.offers[space] = 0;
      if (space === 'francs') next.players[next.currentPlayer].francs += count;
      else next.players[next.currentPlayer].goods[space] += count;
      next.events.push({
        kind: 'take-offer', player: next.currentPlayer, space, count, round: next.round
      });
      finishMainAction(next);
      break;
    }
    case 'useBuilding': {
      effectUseBuilding(next, next.currentPlayer, action);
      finishMainAction(next);
      break;
    }
    case 'pass': {
      next.events.push({ kind: 'pass', player: next.currentPlayer, round: next.round });
      finishMainAction(next);
      break;
    }
    case 'buyBuilding':
    case 'buyShip':
    case 'repayLoan':
    case 'sellBuilding':
    case 'sellShip':
      applyOptionalAction(next, action);
      break;
    default:
      throw new Error('unhandled action: ' + action.type);
  }
  if (next.events.length > 240) next.events = next.events.slice(next.events.length - 240);
  return next;
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export function scorePlayer(state, playerIndex) {
  const p = state.players[playerIndex];
  assert(p, 'scorePlayer: bad index');
  const cash = p.francs;
  let buildings = 0;
  let bonuses = 0;
  const bonusDetail = {};
  const industrial = countCategory(state, playerIndex, 'I');
  const economic = countCategory(state, playerIndex, 'E');
  const craft = countCategory(state, playerIndex, 'C');
  const publicCount = countCategory(state, playerIndex, 'P');

  for (const id of p.buildings) {
    const def = BUILDINGS[id];
    if (!def) continue;
    buildings += def.value;
    if (def.scoring === 'bank') {
      const value = 3 * industrial + 2 * economic;
      bonuses += value;
      bonusDetail.bank = value;
    } else if (def.scoring === 'townHall') {
      const value = 4 * publicCount + 2 * craft;
      bonuses += value;
      bonusDetail.townHall = value;
    } else if (def.scoring === 'dock') {
      const value = 4 * p.ships.length;
      bonuses += value;
      bonusDetail.dock = value;
    } else if (def.scoring === 'storehouse') {
      const value = Math.floor(goodsTokenCount(p) / 2);
      bonuses += value;
      bonusDetail.storehouse = value;
    }
  }
  const ships = p.ships.reduce((sum, ship) => sum + ship.value, 0);
  const loansPenalty = p.loans * 7;
  const total = cash + buildings + ships + bonuses - loansPenalty;
  return {
    index: playerIndex,
    name: p.name,
    total,
    cash,
    buildings,
    ships,
    bonuses,
    bonusDetail,
    loans: p.loans,
    loansPenalty,
    goodsTokens: goodsTokenCount(p)
  };
}

export function score(state) {
  const players = state.players.map((_, i) => scorePlayer(state, i));
  const ranking = players.slice().sort((a, b) => b.total - a.total || a.index - b.index).map((p) => p.index);
  const best = players[ranking[0]].total;
  const winners = players.filter((p) => p.total === best).map((p) => p.index);
  return {
    finished: state.phase === 'gameover',
    round: state.round,
    players,
    ranking,
    winners,
    winner: winners[0],
    best
  };
}

/* ------------------------------------------------------------------ */
/* Greedy AI                                                           */
/* ------------------------------------------------------------------ */

function targetBuildingScore(state, targets) {
  let value = 0;
  for (const id of targets) value += (BUILDINGS[id] ? BUILDINGS[id].value : 0);
  return value;
}

function useActionScore(state, action, playerIndex, hungry) {
  const p = state.players[playerIndex];
  const def = BUILDINGS[action.building];
  if (!def) return -500;
  const params = action.params || {};
  let score = 0;
  switch (def.action) {
    case 'construct1':
    case 'construct2':
    case 'constructSawmill':
      score = 60 + targetBuildingScore(state, params.targets || []);
      break;
    case 'fishery':
      score = 12 + (p.goods.fish || 0) * 0.1;
      if (hungry) score += 25;
      break;
    case 'hardware':
      score = 14;
      if ((p.goods.brick || 0) === 0) score += 14;
      break;
    case 'grocery':
      score = 16;
      if (hungry) score += 20;
      break;
    case 'colliery':
      score = 14;
      break;
    case 'clayMound':
      score = 10;
      break;
    case 'artsCenter':
      score = 12;
      break;
    case 'blackMarket':
      score = 16;
      break;
    case 'marketplace':
      score = 10 + (params.goods ? params.goods.length : 0) * 2;
      break;
    case 'ironworks':
      score = 16 + (params.extra ? 6 : 0);
      break;
    case 'charcoalKiln':
      score = 4 + (params.qty || 0) * 2;
      break;
    case 'mill':
      score = 4 + (params.qty || 0) * 1.5;
      break;
    case 'brickworks':
      score = 4 + (params.qty || 0) * 3;
      break;
    case 'smokehouse':
      score = 5 + (params.qty || 0) * 2 + (hungry ? 10 : 0);
      break;
    case 'bakehouse':
      score = 6 + (params.source === 'flour' ? (params.qty || 0) * 4 : (params.qty || 0) * 2);
      if (hungry) score += 16;
      break;
    case 'abattoir':
      score = 6 + (params.qty || 0) * 2 + (hungry ? 8 : 0);
      break;
    case 'tannery':
      score = 5 + (params.qty || 0) * 3;
      break;
    case 'cokery':
      score = 6 + (params.qty || 0) * 4;
      break;
    case 'steelMill':
      score = 8 + (params.qty || 0) * 5;
      break;
    case 'blacksmith':
      score = 8 + (params.qty || 0) * 5;
      break;
    case 'joinery':
      score = 8 + (params.qty || 0);
      break;
    case 'business':
      score = params.mode === 'steel' ? 18 : 8;
      if (params.mode === 'single' && params.good === 'brick' && (p.goods.brick || 0) === 0) score += 18;
      if (params.mode === 'single' && params.good === 'leather' && (p.goods.leather || 0) === 0) score += 8;
      break;
    case 'shipping':
      score = 12 + (params.ships || 0) * 4;
      break;
    case 'wharf':
      score = 30 + (SHIP_TYPES[params.shipType] ? SHIP_TYPES[params.shipType].food * 4 : 0);
      break;
    case 'localCourt':
      score = p.loans > 0 ? 20 : -100;
      break;
    case 'bridge':
      score = 10 + goodsTokenCount(p);
      break;
    case 'church':
      score = 12;
      break;
    default:
      score = 2;
      break;
  }
  return score;
}

export function chooseGreedyAction(state, actions) {
  const list = actions || legalActions(state);
  if (list.length === 0) return null;
  if (state.phase === 'feeding') return list[0];
  const idx = state.currentPlayer;
  const p = state.players[idx];
  const need = feedObligation(state, idx);
  const reserve = foodValueOf(p) + p.francs;
  const hungry = reserve < need;

  let best = null;
  let bestScore = -Infinity;
  let bestKey = '';
  for (const action of list) {
    let value = 0;
    switch (action.type) {
      case 'takeOffer': {
        const count = state.offers[action.space] || 0;
        if (action.space === 'francs') value = 3 + count * 2.5 + (hungry ? count * 6 : 0);
        else {
          value = 4 + count * (TRADE_WEIGHT[action.space] || 1);
          if (hungry && (action.space === 'fish' || action.space === 'grain' || action.space === 'cattle')) value += 12 * count;
        }
        break;
      }
      case 'buyBuilding': {
        const def = BUILDINGS[action.building];
        const cost = def.buyCost === undefined || def.buyCost === null ? def.value : def.buyCost;
        if (p.francs - cost < 8) value = -200;
        else {
          value = 15 + def.value;
          // Buying the top proposal also unblocks the next card.
          if (state.proposals.includes(action.building)) value += 8;
          if (p.francs - cost > 30) value += 6;
        }
        break;
      }
      case 'buyShip': {
        const ship = availableShipFor(state, action.shipType);
        if (!ship) { value = -200; break; }
        const price = shipBuyPrice(ship);
        if (p.francs - price < 6) value = -200;
        else value = 16 + ship.value * 0.6 + SHIP_TYPES[action.shipType].food * 5;
        break;
      }
      case 'repayLoan':
        value = p.francs > 18 ? 15 : -50;
        break;
      case 'sellBuilding':
        value = hungry ? 20 : 2;
        break;
      case 'sellShip':
        value = hungry ? 18 : -20;
        break;
      case 'pass':
        value = -1000;
        break;
      case 'useBuilding':
        value = useActionScore(state, action, idx, hungry);
        break;
      default:
        value = 0;
        break;
    }
    const key = actionKey(action);
    if (value > bestScore || (value === bestScore && key < bestKey)) {
      best = action;
      bestScore = value;
      bestKey = key;
    }
  }
  return best;
}

export function autoPlay(state, opts = {}) {
  const maxSteps = Number(opts.maxSteps) > 0 ? Math.floor(Number(opts.maxSteps)) : 6000;
  let next = state;
  let steps = 0;
  while (next.phase !== 'gameover' && steps < maxSteps) {
    const actions = legalActions(next);
    if (actions.length === 0) break;
    const action = chooseGreedyAction(next, actions);
    if (!action) break;
    next = applyAction(next, action);
    steps += 1;
  }
  return next;
}

export function selfPlay(opts = {}) {
  const game = createGame(opts);
  return autoPlay(game, opts);
}

export default {
  VERSION,
  createGame,
  legalActions,
  applyAction,
  score,
  scorePlayer,
  hashState,
  currentPlayer,
  feedObligation,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  BUILDINGS,
  SHIP_TYPES
};
