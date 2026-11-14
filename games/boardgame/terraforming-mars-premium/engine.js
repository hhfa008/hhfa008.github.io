/*
 * Terraforming Mars (殖民火星) — pure rules engine, phase 1 (no UI, no DOM).
 *
 * Public API
 *   createGame(opts)              -> fresh GameState
 *   legalActions(state[, player]) -> canonical legal Action[] for the current player
 *   applyAction(state, action)    -> new GameState (input is never mutated)
 *   score(state)                  -> TR / tile / card / milestone / award breakdown
 *   hashState(state)              -> stable 8-hex digest for replay checks
 *   chooseGreedyAction(state)     -> one legal action for the built-in AI
 *   autoPlay(state, opts)         -> deterministic self-play
 *   selfPlay(opts)                -> createGame + autoPlay
 *
 * Rule scope
 *   Official Terraforming Mars base game (Stronghold Games, 2016) as summarised
 *   by the spj233 Bilibili rules video in
 *   docs/backlog/2026-11-11-heavy-games-videos.md, plus the official rulebook
 *   for details the video outline does not cover. The 60 project cards below
 *   use the official base-game card names and close-to-print costs/effects;
 *   simplified effect mappings are listed in rules.md §11.
 *
 * Design constraints
 *   - Zero runtime dependencies, zero DOM.
 *   - All state is plain JSON (cloneable / serialisable / replayable).
 *   - applyAction deep-clones the input, so public operations are pure.
 *   - Every random choice derives from createGame({seed}); no Math.random.
 */

let ShuffleApi = globalThis.Shuffle;
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  const mod = await import('../../shared/shuffle.js');
  ShuffleApi = mod && typeof mod.shuffle === 'function' ? mod : globalThis.Shuffle;
}
if (!ShuffleApi || typeof ShuffleApi.shuffle !== 'function') {
  throw new Error('TerraformingMarsEngine requires games/shared/shuffle.js');
}

export const VERSION = '1.0.0';

/* ------------------------------------------------------------------ */
/* Board geometry, tracks and setup constants                         */
/* ------------------------------------------------------------------ */

export const BOARD_W = 9;
export const BOARD_H = 5;
export const BOARD_CELLS = BOARD_W * BOARD_H;

export const TEMPERATURE_MIN = -30;
export const TEMPERATURE_MAX = 8;
export const TEMPERATURE_STEP = 2;
export const TEMPERATURE_STEPS = 20;
export const OXYGEN_MAX = 14;
export const OCEAN_MAX = 9;

export const START_TR = 20;
// Simplified fixed starting corporation. The official Beginner Corporation is
// 42 MC + 1 MC production, but phase 1 omits the 12 corporation cards; this
// slightly richer base keeps two corporation-less players solvent enough to
// terraform inside the generation cap. See rules.md §11.
export const START_MC = 60;
export const START_PRODUCTION = Object.freeze({
  mc: 2, steel: 1, titanium: 0, plants: 0, energy: 0, heat: 0
});
export const RESOURCES = Object.freeze(['mc', 'steel', 'titanium', 'plants', 'energy', 'heat']);
export const PRODUCTION_RESOURCES = RESOURCES;

export const RESEARCH_COST = 3;
export const INITIAL_RESEARCH = 10;
export const GENERATION_RESEARCH = 4;
export const ACTIONS_PER_TURN = 2;
export const PLANT_GREENERY_COST = 8;
export const HEAT_TEMP_COST = 8;
export const MILESTONE_COST = 8;
export const AWARD_COST = 8;
export const CARD_COPIES = 2;
export const MAX_GENERATIONS = 48;
export const MAX_ACTIONS = 20000;

export const CATEGORIES = Object.freeze({
  bio: '生物',
  power: '能源',
  building: '建筑',
  space: '太空',
  science: '科学'
});
export const CATEGORY_IDS = Object.freeze(Object.keys(CATEGORIES));

export const STANDARD_PROJECTS = Object.freeze({
  sellPatents: Object.freeze({ name: '出售专利', cost: 0, gain: 3 }),
  powerPlant: Object.freeze({ name: '发电站', cost: 11 }),
  asteroid: Object.freeze({ name: '小行星', cost: 14 }),
  aquifer: Object.freeze({ name: '引水渠', cost: 18 }),
  greenery: Object.freeze({ name: '绿化', cost: 23 }),
  city: Object.freeze({ name: '城市', cost: 25 })
});

export const MILESTONES = Object.freeze({
  terraformer: Object.freeze({ id: 'terraformer', name: '改造者', metric: 'tr', need: 35 }),
  mayor: Object.freeze({ id: 'mayor', name: '市长', metric: 'cities', need: 3 }),
  gardener: Object.freeze({ id: 'gardener', name: '园丁', metric: 'greenery', need: 3 })
});
export const MILESTONE_IDS = Object.freeze(Object.keys(MILESTONES));

export const AWARDS = Object.freeze({
  landlord: Object.freeze({ id: 'landlord', name: '地主', metric: 'tiles' }),
  scientist: Object.freeze({ id: 'scientist', name: '科学家', metric: 'scienceTags' }),
  thermalist: Object.freeze({ id: 'thermalist', name: '热能专家', metric: 'heat' })
});
export const AWARD_IDS = Object.freeze(Object.keys(AWARDS));

/* ------------------------------------------------------------------ */
/* Project cards — official base-game names, 12 per category          */
/* ------------------------------------------------------------------ */

function cardDef(id, name, en, category, cost, tags, extra = {}) {
  return Object.freeze({
    id,
    name,
    en,
    category,
    cost,
    tags: Object.freeze(tags.slice()),
    vp: extra.vp || 0,
    requirements: extra.requirements ? Object.freeze(extra.requirements) : null,
    effects: Object.freeze((extra.effects || []).map((e) => Object.freeze(e))),
    action: extra.action ? Object.freeze(extra.action) : null,
    onOcean: extra.onOcean ? Object.freeze(extra.onOcean) : null,
    vpPer: extra.vpPer ? Object.freeze(extra.vpPer) : null,
    source: 'TM-base-2016'
  });
}

const P = (res, amount) => ({ type: 'prod', res, amount });
const R = (res, amount) => ({ type: 'res', res, amount });
const TAG_REQ = (tag, n) => ({ tags: { [tag]: n } });

export const CARD_DEFS = Object.freeze([
  /* ------------------------------ 生物 Bio ------------------------------ */
  cardDef('algae', '藻类', 'Algae', 'bio', 10, ['plant', 'bio'], {
    requirements: { oceans: 2 }, effects: [P('plants', 1)]
  }),
  cardDef('arctic-algae', '北极藻类', 'Arctic Algae', 'bio', 12, ['plant', 'bio'], {
    requirements: { oceans: 1 }, effects: [R('plants', 1)],
    onOcean: { type: 'res', res: 'plants', amount: 2 }, vp: 1
  }),
  cardDef('bees', '蜜蜂', 'Bees', 'bio', 14, ['microbe', 'bio'], {
    requirements: { oxygen: 3 }, effects: [P('plants', 1)], vp: 1
  }),
  cardDef('birds', '鸟类', 'Birds', 'bio', 10, ['animal', 'bio'], {
    requirements: { oxygen: 2 },
    action: { effects: [{ type: 'cardResource', res: 'animal', amount: 1 }] },
    vpPer: { type: 'cardResource', res: 'animal', per: 1, vp: 1 }
  }),
  cardDef('decomposers', '分解者', 'Decomposers', 'bio', 5, ['microbe', 'bio'], {
    requirements: { oxygen: 3 },
    effects: [{ type: 'cardResource', res: 'microbe', amount: 2 }],
    vpPer: { type: 'cardResource', res: 'microbe', per: 3, vp: 1 }
  }),
  cardDef('ecological-zone', '生态区域', 'Ecological Zone', 'bio', 12, ['plant', 'animal', 'bio'], {
    requirements: { oxygen: 4 }, effects: [P('plants', 1)], vp: 1
  }),
  cardDef('fish', '鱼类', 'Fish', 'bio', 9, ['animal', 'bio'], {
    requirements: { oceans: 1 },
    action: { cost: { plants: 1 }, effects: [{ type: 'cardResource', res: 'animal', amount: 1 }] },
    vpPer: { type: 'cardResource', res: 'animal', per: 1, vp: 1 }
  }),
  cardDef('grass', '草', 'Grass', 'bio', 11, ['plant', 'bio'], {
    requirements: { oxygen: 2 }, effects: [P('plants', 1)]
  }),
  cardDef('herbivores', '食草动物', 'Herbivores', 'bio', 12, ['animal', 'bio'], {
    requirements: { oxygen: 2 }, effects: [P('plants', 1)], vp: 1
  }),
  cardDef('insects', '昆虫', 'Insects', 'bio', 9, ['microbe', 'bio'], {
    requirements: { oxygen: 6 }, effects: [P('plants', 1)]
  }),
  cardDef('lichen', '地衣', 'Lichen', 'bio', 7, ['plant', 'bio'], {
    effects: [P('plants', 1)]
  }),
  cardDef('mangrove', '红树', 'Mangrove', 'bio', 12, ['plant', 'bio'], {
    requirements: { oceans: 4 },
    effects: [{ type: 'tile', tile: 'greenery' }, P('plants', 1)]
  }),

  /* ----------------------------- 能源 Power ----------------------------- */
  cardDef('solar-power', '太阳能', 'Solar Power', 'power', 11, ['power'], {
    effects: [P('energy', 1)]
  }),
  cardDef('nuclear-power', '核能', 'Nuclear Power', 'power', 10, ['power'], {
    effects: [P('energy', 3), P('mc', -2)]
  }),
  cardDef('geothermal-power', '地热能', 'Geothermal Power', 'power', 11, ['power', 'building'], {
    requirements: { temperature: -10 }, effects: [P('energy', 2)]
  }),
  cardDef('wind-turbines', '风力涡轮机', 'Wind Turbines', 'power', 11, ['power'], {
    requirements: { oxygen: 3 }, effects: [P('energy', 1)], vp: 1
  }),
  cardDef('fusion-power', '聚变发电', 'Fusion Power', 'power', 14, ['power', 'science'], {
    requirements: { oxygen: 10 }, effects: [P('energy', 3)], vp: 1
  }),
  cardDef('power-grid', '电网', 'Power Grid', 'power', 17, ['power'], {
    effects: [{ type: 'prodPerTag', tag: 'power', res: 'energy', amount: 1 }], vp: 1
  }),
  cardDef('power-plant', '发电厂', 'Power Plant', 'power', 4, ['power', 'building'], {
    effects: [P('energy', 1)]
  }),
  cardDef('energy-tapping', '能源开采', 'Energy Tapping', 'power', 3, ['power'], {
    effects: [P('energy', -1), P('mc', 1)]
  }),
  cardDef('energy-saving', '节能', 'Energy Saving', 'power', 6, ['power'], {
    effects: [P('energy', 1)]
  }),
  cardDef('heat-trappers', '热收集器', 'Heat Trappers', 'power', 3, ['power', 'building'], {
    requirements: { oxygen: 6 },
    effects: [{ type: 'opponentProd', res: 'heat', amount: -1 }]
  }),
  cardDef('mohole-area', '地核钻井', 'Mohole Area', 'power', 16, ['power', 'building'], {
    requirements: { oceans: 4 },
    effects: [{ type: 'temperature', steps: 2 }, P('heat', 2)]
  }),
  cardDef('magnetic-field-generators', '磁场发生器', 'Magnetic Field Generators', 'power', 20, ['power', 'science'], {
    requirements: TAG_REQ('science', 2),
    effects: [P('energy', 3), { type: 'tr', amount: 2 }]
  }),

  /* ---------------------------- 建筑 Building --------------------------- */
  cardDef('acquired-company', '收购公司', 'Acquired Company', 'building', 8, ['building', 'earth'], {
    effects: [P('mc', 1)]
  }),
  cardDef('capital', '资本', 'Capital', 'building', 20, ['building', 'city'], {
    requirements: { oceans: 4 },
    effects: [{ type: 'tile', tile: 'city' }], vp: 1
  }),
  cardDef('commercial-district', '商业区', 'Commercial District', 'building', 14, ['building', 'city'], {
    requirements: { cities: 1 },
    effects: [P('mc', 1)],
    vpPer: { type: 'cities', per: 1, vp: 1 }
  }),
  cardDef('dome-farming', '穹顶农业', 'Dome Farming', 'building', 10, ['building', 'plant'], {
    effects: [P('plants', 1), P('mc', 1)]
  }),
  cardDef('industrial-center', '工业中心', 'Industrial Center', 'building', 9, ['building'], {
    requirements: TAG_REQ('building', 3),
    effects: [P('steel', 1), P('mc', 1)]
  }),
  cardDef('mining-area', '采矿区', 'Mining Area', 'building', 9, ['building'], {
    effects: [{ type: 'tile', tile: 'special' }, P('titanium', 1)]
  }),
  cardDef('mining-rights', '采矿权', 'Mining Rights', 'building', 9, ['building'], {
    effects: [P('titanium', 1)]
  }),
  cardDef('noctis-city', '诺克提斯城', 'Noctis City', 'building', 16, ['building', 'city'], {
    effects: [{ type: 'tile', tile: 'city' }, P('mc', 1)]
  }),
  cardDef('research-lab', '研究实验室', 'Research Lab', 'building', 7, ['building', 'science'], {
    effects: [{ type: 'draw', amount: 1 }], vp: 1
  }),
  cardDef('space-elevator', '太空电梯', 'Space Elevator', 'building', 17, ['building', 'space'], {
    requirements: { oxygen: 4 }, effects: [P('titanium', 1)], vp: 1
  }),
  cardDef('steelworks', '钢铁厂', 'Steelworks', 'building', 9, ['building'], {
    action: { cost: { steel: 4 }, effects: [{ type: 'oxygen', steps: 1 }] }, vp: 1
  }),
  cardDef('solar-farm', '太阳能农场', 'Solar Farm', 'building', 12, ['building', 'power'], {
    effects: [P('energy', 1)], vp: 1
  }),

  /* ----------------------------- 太空 Space ----------------------------- */
  cardDef('asteroid', '小行星', 'Asteroid', 'space', 9, ['space'], {
    effects: [{ type: 'temperature', steps: 1 }, P('titanium', 1)]
  }),
  cardDef('comet', '彗星', 'Comet', 'space', 11, ['space'], {
    effects: [{ type: 'ocean', count: 1 }, { type: 'temperature', steps: 1 }]
  }),
  cardDef('deimos-down', '火卫二坠落', 'Deimos Down', 'space', 20, ['space'], {
    effects: [{ type: 'temperature', steps: 3 }]
  }),
  cardDef('ganymede-colony', '木卫三殖民地', 'Ganymede Colony', 'space', 18, ['space', 'jovian', 'city'], {
    effects: [P('mc', 1)],
    vpPer: { type: 'tag', tag: 'jovian', per: 1, vp: 1 }
  }),
  cardDef('giant-ice-asteroid', '巨型冰小行星', 'Giant Ice Asteroid', 'space', 25, ['space'], {
    effects: [{ type: 'temperature', steps: 2 }, { type: 'ocean', count: 2 }]
  }),
  cardDef('ice-asteroid', '冰小行星', 'Ice Asteroid', 'space', 16, ['space'], {
    effects: [{ type: 'ocean', count: 2 }]
  }),
  cardDef('interstellar-colony-ship', '星际殖民船', 'Interstellar Colony Ship', 'space', 20, ['space', 'earth'], {
    requirements: TAG_REQ('science', 3), vp: 4
  }),
  cardDef('io-mining-industries', '木卫一矿业', 'Io Mining Industries', 'space', 20, ['space', 'jovian'], {
    effects: [P('titanium', 2)],
    vpPer: { type: 'tag', tag: 'jovian', per: 1, vp: 1 }
  }),
  cardDef('large-convoy', '大型运输船', 'Large Convoy', 'space', 20, ['space', 'earth'], {
    effects: [{ type: 'ocean', count: 1 }, { type: 'draw', amount: 2 }]
  }),
  cardDef('phobos-space-haven', '火卫一太空港', 'Phobos Space Haven', 'space', 17, ['space', 'city'], {
    effects: [{ type: 'tile', tile: 'city' }, P('titanium', 1)]
  }),
  cardDef('terraforming-ganymede', '改造木卫三', 'Terraforming Ganymede', 'space', 24, ['space', 'jovian'], {
    requirements: TAG_REQ('jovian', 2),
    effects: [{ type: 'tr', amount: 2 }],
    vpPer: { type: 'tag', tag: 'jovian', per: 1, vp: 1 }
  }),
  cardDef('titanium-mine', '钛矿', 'Titanium Mine', 'space', 5, ['space', 'building'], {
    effects: [P('titanium', 1)]
  }),

  /* ---------------------------- 科学 Science ---------------------------- */
  cardDef('ai-central', 'AI 中枢', 'AI Central', 'science', 21, ['science', 'building'], {
    requirements: TAG_REQ('science', 3),
    action: { effects: [{ type: 'draw', amount: 1 }] }, vp: 1
  }),
  cardDef('anti-gravity-technology', '反重力技术', 'Anti-Gravity Technology', 'science', 14, ['science'], {
    requirements: TAG_REQ('science', 6), effects: [{ type: 'tr', amount: 1 }]
  }),
  cardDef('business-contacts', '商业联系', 'Business Contacts', 'science', 7, ['science', 'earth'], {
    effects: [{ type: 'draw', amount: 2 }]
  }),
  cardDef('gene-repair', '基因修复', 'Gene Repair', 'science', 7, ['science'], {
    effects: [P('mc', 1)]
  }),
  cardDef('genetic-engineering', '基因工程', 'Genetic Engineering', 'science', 9, ['science', 'plant'], {
    effects: [P('plants', 1)]
  }),
  cardDef('invention-contest', '发明竞赛', 'Invention Contest', 'science', 6, ['science'], {
    effects: [{ type: 'draw', amount: 2 }]
  }),
  cardDef('inventors-guild', '发明家协会', "Inventors' Guild", 'science', 9, ['science'], {
    requirements: TAG_REQ('science', 3),
    effects: [{ type: 'draw', amount: 2 }], vp: 1
  }),
  cardDef('lagrange-observatory', '拉格朗日观测站', 'Lagrange Observatory', 'science', 14, ['science', 'space'], {
    requirements: TAG_REQ('science', 2),
    effects: [{ type: 'draw', amount: 2 }], vp: 1
  }),
  cardDef('mars-university', '火星大学', 'Mars University', 'science', 12, ['science', 'building'], {
    requirements: TAG_REQ('science', 2),
    effects: [{ type: 'draw', amount: 2 }], vp: 1
  }),
  cardDef('physics-complex', '物理学综合设施', 'Physics Complex', 'science', 13, ['science', 'building'], {
    requirements: TAG_REQ('science', 2),
    action: {
      cost: { energy: 6 },
      effects: [{ type: 'cardResource', res: 'science', amount: 1 }]
    },
    vpPer: { type: 'cardResource', res: 'science', per: 2, vp: 1 }
  }),
  cardDef('research', '研究', 'Research', 'science', 7, ['science'], {
    effects: [{ type: 'draw', amount: 2 }], vp: 1
  }),
  cardDef('search-for-life', '生命探索', 'Search For Life', 'science', 3, ['science'], {
    requirements: { oxygen: 2 },
    action: { effects: [{ type: 'cardResource', res: 'science', amount: 1 }] },
    vpPer: { type: 'cardResource', res: 'science', per: 2, vp: 1 }
  })
]);

export const CARDS_BY_ID = Object.freeze(Object.fromEntries(
  CARD_DEFS.map((def) => [def.id, def])
));

/* ------------------------------------------------------------------ */
/* Small pure helpers                                                 */
/* ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assert(condition, message) {
  if (!condition) throw new Error('Terraforming Mars illegal: ' + message);
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

function shuffleWith(array, seed) {
  return ShuffleApi.shuffle(array.slice(), { seed: String(seed) });
}

function clampProduction(value) {
  return Math.max(0, value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function temperatureIndex(temp) {
  return Math.round((temp - TEMPERATURE_MIN) / TEMPERATURE_STEP);
}

export function currentTemperature(state) {
  return state.globals.temperature;
}

export function isTerraformed(state) {
  return state.globals.temperature >= TEMPERATURE_MAX
    && state.globals.oxygen >= OXYGEN_MAX
    && state.globals.oceans >= OCEAN_MAX;
}

export function isMaxed(state) {
  return isTerraformed(state);
}

function claimLimit(playerCount) {
  if (playerCount <= 2) return 1;
  if (playerCount === 3) return 2;
  return 3;
}

export function milestoneLimit(state) {
  return claimLimit(state.playerCount);
}

export function awardLimit(state) {
  return claimLimit(state.playerCount);
}

/* ------------------------------------------------------------------ */
/* Cards and deck                                                     */
/* ------------------------------------------------------------------ */

export function cardInstance(defId, uid) {
  const def = CARDS_BY_ID[defId];
  assert(def, 'unknown card definition ' + defId);
  return {
    uid: uid || def.id + '-hand',
    defId: def.id,
    name: def.name,
    en: def.en,
    category: def.category,
    cost: def.cost,
    tags: def.tags.slice(),
    vp: def.vp,
    requirements: def.requirements ? clone(def.requirements) : null,
    effects: clone(def.effects),
    action: def.action ? clone(def.action) : null,
    onOcean: def.onOcean ? clone(def.onOcean) : null,
    vpPer: def.vpPer ? clone(def.vpPer) : null,
    resources: {}
  };
}

function materializeCard(state, defId) {
  const card = cardInstance(defId, 'c' + state.nextCardUid);
  state.nextCardUid += 1;
  return card;
}

function buildDeck(seed) {
  const entries = [];
  for (const def of CARD_DEFS) {
    for (let copy = 0; copy < CARD_COPIES; copy += 1) entries.push({ defId: def.id });
  }
  return shuffleWith(entries, seed + ':deck');
}

function reshuffleDiscard(state) {
  if (state.deck.length > 0 || state.discard.length === 0) return;
  state.deck = shuffleWith(state.discard, state.seed + ':reshuffle:' + state.reshuffleCount);
  state.discard = [];
  state.reshuffleCount += 1;
}

function drawCardsTo(state, playerIndex, count, target) {
  const ps = state.players[playerIndex];
  const dest = target === 'research' ? ps.pendingResearch : ps.hand;
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    reshuffleDiscard(state);
    if (state.deck.length === 0) break;
    const entry = state.deck.pop();
    dest.push(materializeCard(state, entry.defId));
    drawn += 1;
  }
  return drawn;
}

function discardHandCard(state, playerIndex, cardUid) {
  const ps = state.players[playerIndex];
  const idx = ps.hand.findIndex((c) => c.uid === cardUid);
  assert(idx >= 0, 'card ' + cardUid + ' is not in hand');
  const [card] = ps.hand.splice(idx, 1);
  state.discard.push({ defId: card.defId });
  return card;
}

function findPlayedCard(ps, cardUid) {
  return ps.played.find((c) => c.uid === cardUid) || null;
}

function findHandCard(ps, cardUid) {
  return ps.hand.find((c) => c.uid === cardUid) || null;
}

/* ------------------------------------------------------------------ */
/* Player metrics / tags / requirements                               */
/* ------------------------------------------------------------------ */

export function tagCount(state, playerIndex, tag) {
  const ps = state.players[playerIndex];
  let count = 0;
  for (const card of ps.played) {
    if (card.tags.includes(tag)) count += 1;
  }
  return count;
}

export function tileCounts(state, playerIndex) {
  const counts = { ocean: 0, city: 0, greenery: 0, special: 0, tiles: 0 };
  for (const cell of state.board.cells) {
    if (!cell || cell.owner !== playerIndex) continue;
    counts[cell.tile] += 1;
    if (cell.tile !== 'ocean') counts.tiles += 1;
  }
  return counts;
}

export function playerMetrics(state, playerIndex) {
  const ps = state.players[playerIndex];
  const tiles = tileCounts(state, playerIndex);
  return {
    tr: ps.tr,
    mc: ps.mc,
    steel: ps.steel,
    titanium: ps.titanium,
    plants: ps.plants,
    energy: ps.energy,
    heat: ps.heat,
    cities: tiles.city,
    greenery: tiles.greenery,
    special: tiles.special,
    tiles: tiles.tiles,
    scienceTags: tagCount(state, playerIndex, 'science'),
    buildingTags: tagCount(state, playerIndex, 'building'),
    spaceTags: tagCount(state, playerIndex, 'space'),
    powerTags: tagCount(state, playerIndex, 'power'),
    jovianTags: tagCount(state, playerIndex, 'jovian'),
    cardCount: ps.played.length,
    handCount: ps.hand.length
  };
}

export function meetsRequirements(state, playerIndex, requirements) {
  if (!requirements) return true;
  const g = state.globals;
  const metrics = playerMetrics(state, playerIndex);
  if (requirements.oxygen !== undefined && g.oxygen < requirements.oxygen) return false;
  if (requirements.temperature !== undefined && g.temperature < requirements.temperature) return false;
  if (requirements.oceans !== undefined && g.oceans < requirements.oceans) return false;
  if (requirements.tr !== undefined && metrics.tr < requirements.tr) return false;
  if (requirements.cities !== undefined && metrics.cities < requirements.cities) return false;
  if (requirements.production) {
    for (const [res, need] of Object.entries(requirements.production)) {
      if ((state.players[playerIndex].production[res] || 0) < need) return false;
    }
  }
  if (requirements.tags) {
    for (const [tag, need] of Object.entries(requirements.tags)) {
      if (tagCount(state, playerIndex, tag) < need) return false;
    }
  }
  return true;
}

export function describeRequirement(requirements) {
  if (!requirements) return '';
  const parts = [];
  if (requirements.oxygen !== undefined) parts.push('氧气≥' + requirements.oxygen + '%');
  if (requirements.temperature !== undefined) parts.push('温度≥' + requirements.temperature + '°C');
  if (requirements.oceans !== undefined) parts.push('海洋≥' + requirements.oceans);
  if (requirements.tr !== undefined) parts.push('TR≥' + requirements.tr);
  if (requirements.cities !== undefined) parts.push('城市≥' + requirements.cities);
  if (requirements.tags) {
    for (const [tag, need] of Object.entries(requirements.tags)) parts.push(tag + '标签≥' + need);
  }
  return parts.join('，');
}

/* ------------------------------------------------------------------ */
/* Resources, TR and global parameters                                */
/* ------------------------------------------------------------------ */

function gainResource(state, playerIndex, res, amount) {
  const ps = state.players[playerIndex];
  if (!(res in ps)) throw new Error('Terraforming Mars illegal: unknown resource ' + res);
  ps[res] = Math.max(0, ps[res] + amount);
}

function adjustProduction(state, playerIndex, res, amount) {
  const ps = state.players[playerIndex];
  assert(res in ps.production, 'unknown production ' + res);
  ps.production[res] = clampProduction(ps.production[res] + amount);
}

function gainTR(state, playerIndex, amount) {
  const ps = state.players[playerIndex];
  ps.tr = Math.max(0, ps.tr + amount);
  state.events.push({ type: 'tr', player: playerIndex, amount, tr: ps.tr });
}

function raiseTemperature(state, playerIndex, steps) {
  const g = state.globals;
  let raised = 0;
  for (let i = 0; i < steps; i += 1) {
    if (g.temperature >= TEMPERATURE_MAX) break;
    g.temperature += TEMPERATURE_STEP;
    raised += 1;
    gainTR(state, playerIndex, 1);
  }
  if (raised > 0) state.events.push({ type: 'temperature', player: playerIndex, steps: raised, value: g.temperature });
  return raised;
}

function raiseOxygen(state, playerIndex, steps) {
  const g = state.globals;
  let raised = 0;
  for (let i = 0; i < steps; i += 1) {
    if (g.oxygen >= OXYGEN_MAX) break;
    g.oxygen += 1;
    raised += 1;
    gainTR(state, playerIndex, 1);
  }
  if (raised > 0) state.events.push({ type: 'oxygen', player: playerIndex, steps: raised, value: g.oxygen });
  return raised;
}

function triggerOceanPassives(state) {
  for (let pi = 0; pi < state.players.length; pi += 1) {
    for (const card of state.players[pi].played) {
      if (!card.onOcean) continue;
      if (card.onOcean.type === 'res') {
        gainResource(state, pi, card.onOcean.res, card.onOcean.amount);
        state.events.push({
          type: 'trigger', player: pi, card: card.uid, trigger: 'ocean',
          res: card.onOcean.res, amount: card.onOcean.amount
        });
      }
    }
  }
}

function placeOcean(state, playerIndex, cellIndex) {
  assert(state.globals.oceans < OCEAN_MAX, 'all 9 oceans are already placed');
  assert(isInteger(cellIndex) && cellIndex >= 0 && cellIndex < BOARD_CELLS, 'invalid ocean cell');
  assert(!state.board.cells[cellIndex], 'ocean cell is occupied');
  state.board.cells[cellIndex] = {
    tile: 'ocean', owner: null, placedBy: playerIndex, cardId: null
  };
  state.globals.oceans += 1;
  gainTR(state, playerIndex, 1);
  state.events.push({ type: 'ocean', player: playerIndex, cell: cellIndex, oceans: state.globals.oceans });
  triggerOceanPassives(state);
}

function autoPlaceOceans(state, playerIndex, count) {
  for (let i = 0; i < count; i += 1) {
    if (state.globals.oceans >= OCEAN_MAX) break;
    const cell = state.board.cells.findIndex((c) => !c);
    if (cell < 0) break;
    placeOcean(state, playerIndex, cell);
  }
}

function neighbors(cellIndex) {
  const x = cellIndex % BOARD_W;
  const y = Math.floor(cellIndex / BOARD_W);
  const out = [];
  if (x > 0) out.push(cellIndex - 1);
  if (x < BOARD_W - 1) out.push(cellIndex + 1);
  if (y > 0) out.push(cellIndex - BOARD_W);
  if (y < BOARD_H - 1) out.push(cellIndex + BOARD_W);
  return out;
}

function hasAnyTile(state) {
  return state.board.cells.some((c) => !!c);
}

function hasAdjacentCity(state, cellIndex) {
  return neighbors(cellIndex).some((n) => {
    const cell = state.board.cells[n];
    return cell && cell.tile === 'city';
  });
}

function hasAdjacentTile(state, cellIndex) {
  return neighbors(cellIndex).some((n) => !!state.board.cells[n]);
}

export function canPlaceTile(state, cellIndex, kind) {
  if (!isInteger(cellIndex) || cellIndex < 0 || cellIndex >= BOARD_CELLS) return false;
  if (state.board.cells[cellIndex]) return false;
  if (kind === 'ocean') return state.globals.oceans < OCEAN_MAX;
  if (kind === 'greenery') return !hasAnyTile(state) || hasAdjacentTile(state, cellIndex);
  if (kind === 'city') return !hasAdjacentCity(state, cellIndex);
  if (kind === 'special') return true;
  return false;
}

function legalCells(state, kind) {
  const out = [];
  for (let i = 0; i < BOARD_CELLS; i += 1) {
    if (canPlaceTile(state, i, kind)) out.push(i);
  }
  return out;
}

function placeTile(state, playerIndex, cellIndex, kind) {
  assert(canPlaceTile(state, cellIndex, kind), 'cannot place ' + kind + ' on cell ' + cellIndex);
  const ps = state.players[playerIndex];
  state.board.cells[cellIndex] = {
    tile: kind, owner: playerIndex, placedBy: playerIndex, cardId: null
  };
  state.events.push({ type: 'tile', player: playerIndex, tile: kind, cell: cellIndex });
  if (kind === 'greenery') {
    raiseOxygen(state, playerIndex, 1);
  } else if (kind === 'city') {
    ps.production.mc = clampProduction(ps.production.mc + 1);
  }
}

/* ------------------------------------------------------------------ */
/* Effects                                                           */
/* ------------------------------------------------------------------ */

function applyEffects(state, playerIndex, effects, ctx = {}) {
  for (const effect of effects) {
    switch (effect.type) {
      case 'prod':
        adjustProduction(state, playerIndex, effect.res, effect.amount);
        break;
      case 'res':
        gainResource(state, playerIndex, effect.res, effect.amount);
        break;
      case 'tr':
        gainTR(state, playerIndex, effect.amount);
        break;
      case 'temperature':
        raiseTemperature(state, playerIndex, effect.steps);
        break;
      case 'oxygen':
        raiseOxygen(state, playerIndex, effect.steps);
        break;
      case 'ocean':
        autoPlaceOceans(state, playerIndex, effect.count);
        break;
      case 'tile':
        assert(ctx.cell !== undefined, 'tile effect requires a cell');
        placeTile(state, playerIndex, ctx.cell, effect.tile);
        break;
      case 'draw':
        drawCardsTo(state, playerIndex, effect.amount, 'hand');
        break;
      case 'cardResource': {
        assert(ctx.card, 'cardResource effect requires a played card');
        ctx.card.resources[effect.res] = (ctx.card.resources[effect.res] || 0) + effect.amount;
        break;
      }
      case 'prodPerTag': {
        const count = tagCount(state, playerIndex, effect.tag);
        const relevant = ctx.card && ctx.card.tags.includes(effect.tag) ? count : count;
        adjustProduction(state, playerIndex, effect.res, effect.amount * relevant);
        break;
      }
      case 'opponentProd': {
        let target = -1;
        let best = -Infinity;
        for (let i = 0; i < state.players.length; i += 1) {
          if (i === playerIndex) continue;
          const value = state.players[i].production[effect.res] || 0;
          if (value > best) { best = value; target = i; }
        }
        if (target >= 0) adjustProduction(state, target, effect.res, effect.amount);
        break;
      }
      case 'vp':
        // Static VP lives on card.vp; a standalone vp effect is ignored.
        break;
      default:
        throw new Error('Terraforming Mars illegal: unknown effect ' + effect.type);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Payment                                                           */
/* ------------------------------------------------------------------ */

export function solvePayment(state, playerIndex, card) {
  const ps = state.players[playerIndex];
  const maxTitanium = card.tags.includes('space')
    ? Math.min(ps.titanium, Math.floor(card.cost / 3)) : 0;
  const maxSteel = card.tags.includes('building')
    ? Math.min(ps.steel, Math.floor(card.cost / 2)) : 0;
  // Prefer steel/titanium (they cannot buy anything else) but keep the MC
  // remainder inside the player's actual cash. Descending order also finds the
  // most resource-heavy exact payment.
  for (let titanium = maxTitanium; titanium >= 0; titanium -= 1) {
    for (let steel = maxSteel; steel >= 0; steel -= 1) {
      const mc = card.cost - titanium * 3 - steel * 2;
      if (mc >= 0 && mc <= ps.mc) return { mc, steel, titanium };
    }
  }
  return null;
}

export function canPayCard(state, playerIndex, card) {
  return solvePayment(state, playerIndex, card) !== null;
}

export function canonicalPayment(state, playerIndex, card) {
  const payment = solvePayment(state, playerIndex, card);
  assert(payment, 'cannot afford ' + card.name + ' (' + card.cost + ' MC)');
  return payment;
}

export function validatePayment(state, playerIndex, card, payment) {
  const ps = state.players[playerIndex];
  const p = payment || { mc: card.cost, steel: 0, titanium: 0 };
  assert(isInteger(p.mc) && p.mc >= 0, 'payment.mc must be a non-negative integer');
  assert(isInteger(p.steel) && p.steel >= 0, 'payment.steel must be a non-negative integer');
  assert(isInteger(p.titanium) && p.titanium >= 0, 'payment.titanium must be a non-negative integer');
  if (p.steel > 0) assert(card.tags.includes('building'), 'steel may only pay for building-tag cards');
  if (p.titanium > 0) assert(card.tags.includes('space'), 'titanium may only pay for space-tag cards');
  const total = p.mc + p.steel * 2 + p.titanium * 3;
  assert(total === card.cost, 'payment totals ' + total + ' but card costs ' + card.cost);
  assert(ps.mc >= p.mc, 'not enough MC');
  assert(ps.steel >= p.steel, 'not enough steel');
  assert(ps.titanium >= p.titanium, 'not enough titanium');
  return p;
}

function payCost(state, playerIndex, cost) {
  const ps = state.players[playerIndex];
  for (const [res, amount] of Object.entries(cost)) {
    assert((ps[res] || 0) >= amount, 'not enough ' + res + ' for action cost');
    ps[res] -= amount;
  }
}

/* ------------------------------------------------------------------ */
/* Card VP and scoring                                               */
/* ------------------------------------------------------------------ */

function countCities(state, playerIndex) {
  return tileCounts(state, playerIndex).city;
}

export function cardVictoryPoints(state, playerIndex, card) {
  let vp = card.vp || 0;
  if (card.vpPer) {
    if (card.vpPer.type === 'tag') {
      vp += tagCount(state, playerIndex, card.vpPer.tag) * card.vpPer.vp;
    } else if (card.vpPer.type === 'cities') {
      vp += countCities(state, playerIndex) * card.vpPer.vp;
    } else if (card.vpPer.type === 'cardResource') {
      const amount = card.resources[card.vpPer.res] || 0;
      vp += Math.floor(amount / card.vpPer.per) * card.vpPer.vp;
    }
  }
  return vp;
}

export function cityVictoryPoints(state, playerIndex) {
  let vp = 0;
  for (let i = 0; i < state.board.cells.length; i += 1) {
    const cell = state.board.cells[i];
    if (!cell || cell.tile !== 'city' || cell.owner !== playerIndex) continue;
    for (const n of neighbors(i)) {
      const other = state.board.cells[n];
      if (other && other.tile === 'greenery') vp += 1;
    }
  }
  return vp;
}

export function greeneryVictoryPoints(state, playerIndex) {
  return tileCounts(state, playerIndex).greenery;
}

function awardMetric(state, playerIndex, metric) {
  const metrics = playerMetrics(state, playerIndex);
  if (metric === 'tiles') return metrics.tiles;
  if (metric === 'scienceTags') return metrics.scienceTags;
  if (metric === 'heat') return metrics.heat;
  return 0;
}

export function awardVictoryPoints(state) {
  const out = new Array(state.players.length).fill(0);
  const detail = [];
  for (const funded of state.awards) {
    const def = AWARDS[funded.id];
    const ranked = state.players.map((ps) => ({
      index: ps.index, metric: awardMetric(state, ps.index, def.metric)
    })).sort((a, b) => b.metric - a.metric || a.index - b.index);
    if (ranked[0] && ranked[0].metric > 0) {
      out[ranked[0].index] += 5;
      detail.push({ award: funded.id, player: ranked[0].index, place: 1, vp: 5 });
    }
    if (ranked[1] && ranked[1].metric > 0) {
      out[ranked[1].index] += 2;
      detail.push({ award: funded.id, player: ranked[1].index, place: 2, vp: 2 });
    }
  }
  return { vp: out, detail };
}

export function score(state) {
  const awards = awardVictoryPoints(state);
  const players = state.players.map((ps) => {
    const metrics = playerMetrics(state, ps.index);
    let cardVp = 0;
    for (const card of ps.played) cardVp += cardVictoryPoints(state, ps.index, card);
    const milestoneVp = state.milestones.filter((m) => m.player === ps.index).length * 5;
    const baseVp = metrics.tr
      + greeneryVictoryPoints(state, ps.index)
      + cityVictoryPoints(state, ps.index)
      + cardVp
      + milestoneVp
      + awards.vp[ps.index];
    return {
      index: ps.index,
      name: ps.name,
      vp: baseVp,
      tr: metrics.tr,
      greeneryVp: greeneryVictoryPoints(state, ps.index),
      cityVp: cityVictoryPoints(state, ps.index),
      cardVp,
      milestoneVp,
      awardVp: awards.vp[ps.index],
      milestones: state.milestones.filter((m) => m.player === ps.index).map((m) => m.id),
      awardsFunded: state.awards.filter((a) => a.player === ps.index).map((a) => a.id),
      mc: ps.mc,
      steel: ps.steel,
      titanium: ps.titanium,
      plants: ps.plants,
      energy: ps.energy,
      heat: ps.heat
    };
  });
  const ranking = players.slice().sort((a, b) => b.vp - a.vp || b.mc - a.mc || a.index - b.index);
  const winner = ranking.filter((p) => p.vp === ranking[0].vp && p.mc === ranking[0].mc).map((p) => p.index);
  return {
    phase: state.phase,
    generation: state.generation,
    terraformed: isTerraformed(state),
    globals: clone(state.globals),
    players,
    ranking,
    winner,
    awards: awards.detail
  };
}

/* ------------------------------------------------------------------ */
/* Legal action generation                                           */
/* ------------------------------------------------------------------ */

export function currentPlayer(state) {
  if (state.phase === 'research') {
    return state.turnOrder[state.researchIdx] === undefined ? null : state.turnOrder[state.researchIdx];
  }
  if (state.phase === 'action') {
    return state.turnOrder[state.currentPlayerIdx] === undefined
      ? null : state.turnOrder[state.currentPlayerIdx];
  }
  return null;
}

function researchActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  for (const card of ps.pendingResearch) {
    if (ps.mc >= RESEARCH_COST) out.push({ type: 'researchBuy', cardId: card.uid, defId: card.defId });
  }
  out.push({ type: 'researchEnd' });
  return out;
}

function playCardActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  for (const card of ps.hand) {
    if (!meetsRequirements(state, playerIndex, card.requirements)) continue;
    if (!canPayCard(state, playerIndex, card)) continue;
    const payment = canonicalPayment(state, playerIndex, card);
    const tileEffect = card.effects.find((e) => e.type === 'tile');
    if (tileEffect) {
      const cells = legalCells(state, tileEffect.tile);
      for (const cell of cells) {
        out.push({ type: 'playCard', cardId: card.uid, defId: card.defId, payment: clone(payment), cell });
      }
    } else {
      out.push({ type: 'playCard', cardId: card.uid, defId: card.defId, payment: clone(payment) });
    }
  }
  return out;
}

function cardActionActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  for (const card of ps.played) {
    if (!card.action) continue;
    if (ps.usedCardActions.includes(card.uid)) continue;
    if (card.action.cost) {
      let ok = true;
      for (const [res, amount] of Object.entries(card.action.cost)) {
        if ((ps[res] || 0) < amount) { ok = false; break; }
      }
      if (!ok) continue;
    }
    out.push({ type: 'cardAction', cardUid: card.uid, defId: card.defId });
  }
  return out;
}

function standardActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  if (ps.hand.length > 0) {
    for (const card of ps.hand) out.push({ type: 'standard', project: 'sellPatents', cardId: card.uid });
  }
  if (ps.mc >= STANDARD_PROJECTS.powerPlant.cost) {
    out.push({ type: 'standard', project: 'powerPlant' });
  }
  if (ps.mc >= STANDARD_PROJECTS.asteroid.cost && state.globals.temperature < TEMPERATURE_MAX) {
    out.push({ type: 'standard', project: 'asteroid' });
  }
  if (ps.mc >= STANDARD_PROJECTS.aquifer.cost && state.globals.oceans < OCEAN_MAX) {
    for (const cell of legalCells(state, 'ocean')) {
      out.push({ type: 'standard', project: 'aquifer', cell });
    }
  }
  if (ps.mc >= STANDARD_PROJECTS.greenery.cost) {
    for (const cell of legalCells(state, 'greenery')) {
      out.push({ type: 'standard', project: 'greenery', cell });
    }
  }
  if (ps.mc >= STANDARD_PROJECTS.city.cost) {
    for (const cell of legalCells(state, 'city')) {
      out.push({ type: 'standard', project: 'city', cell });
    }
  }
  if (ps.plants >= PLANT_GREENERY_COST) {
    for (const cell of legalCells(state, 'greenery')) {
      out.push({ type: 'convertPlants', cell });
    }
  }
  if (ps.heat >= HEAT_TEMP_COST && state.globals.temperature < TEMPERATURE_MAX) {
    out.push({ type: 'convertHeat' });
  }
  return out;
}

function milestoneActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  if (state.milestones.length >= milestoneLimit(state)) return out;
  if (state.milestones.some((m) => m.player === playerIndex)) return out;
  if (ps.mc < MILESTONE_COST) return out;
  const metrics = playerMetrics(state, playerIndex);
  for (const id of MILESTONE_IDS) {
    const def = MILESTONES[id];
    if (state.milestones.some((m) => m.id === id)) continue;
    if (metrics[def.metric] >= def.need) out.push({ type: 'claimMilestone', milestone: id });
  }
  return out;
}

function awardActions(state, playerIndex) {
  const ps = state.players[playerIndex];
  const out = [];
  if (state.awards.length >= awardLimit(state)) return out;
  if (state.awards.some((a) => a.player === playerIndex)) return out;
  if (ps.mc < AWARD_COST) return out;
  for (const id of AWARD_IDS) {
    if (state.awards.some((a) => a.id === id)) continue;
    out.push({ type: 'fundAward', award: id });
  }
  return out;
}

export function legalActions(state, playerIndex) {
  if (!state || state.phase === 'game-over') return [];
  if (state.phase === 'production') return [{ type: 'resolveProduction' }];
  if (state.phase === 'generation-end') return [{ type: 'nextGeneration' }];
  const player = playerIndex === undefined || playerIndex === null
    ? currentPlayer(state)
    : playerIndex;
  if (player === null || player === undefined) return [];
  if (state.phase === 'research') return researchActions(state, player);
  if (state.phase === 'action') {
    return [
      ...playCardActions(state, player),
      ...cardActionActions(state, player),
      ...standardActions(state, player),
      ...milestoneActions(state, player),
      ...awardActions(state, player),
      { type: 'pass' }
    ];
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Action execution                                                  */
/* ------------------------------------------------------------------ */

function doResearchBuy(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const idx = ps.pendingResearch.findIndex((c) => c.uid === action.cardId);
  assert(idx >= 0, 'research card ' + action.cardId + ' is not pending');
  assert(ps.mc >= RESEARCH_COST, 'not enough MC to buy research');
  ps.mc -= RESEARCH_COST;
  const [card] = ps.pendingResearch.splice(idx, 1);
  ps.hand.push(card);
  state.events.push({ type: 'researchBuy', player: playerIndex, card: card.uid });
}

function endResearchForPlayer(state, playerIndex) {
  const ps = state.players[playerIndex];
  for (const card of ps.pendingResearch) state.discard.push({ defId: card.defId });
  ps.pendingResearch = [];
}

function doResearchEnd(state, playerIndex) {
  endResearchForPlayer(state, playerIndex);
  state.researchIdx += 1;
  if (state.researchIdx >= state.playerCount) {
    state.phase = 'action';
    state.researchIdx = 0;
    state.currentPlayerIdx = 0;
    state.actionsLeft = ACTIONS_PER_TURN;
    for (const ps of state.players) ps.passed = false;
    state.events.push({ type: 'actionPhase', generation: state.generation });
  }
}

function doPlayCard(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const card = findHandCard(ps, action.cardId);
  assert(card, 'card ' + action.cardId + ' is not in hand');
  assert(meetsRequirements(state, playerIndex, card.requirements),
    'requirements not met for ' + card.name + ': ' + describeRequirement(card.requirements));
  const payment = validatePayment(state, playerIndex, card, action.payment);
  const tileEffect = card.effects.find((e) => e.type === 'tile');
  if (tileEffect) {
    assert(action.cell !== undefined, 'card ' + card.name + ' needs a tile cell');
    assert(canPlaceTile(state, action.cell, tileEffect.tile),
      'cannot place ' + tileEffect.tile + ' on cell ' + action.cell);
  }
  ps.mc -= payment.mc;
  ps.steel -= payment.steel;
  ps.titanium -= payment.titanium;
  const idx = ps.hand.findIndex((c) => c.uid === card.uid);
  ps.hand.splice(idx, 1);
  ps.played.push(card);
  state.events.push({ type: 'playCard', player: playerIndex, card: card.uid, name: card.name, payment });
  applyEffects(state, playerIndex, card.effects, { card, cell: action.cell });
}

function doCardAction(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const card = findPlayedCard(ps, action.cardUid);
  assert(card && card.action, 'card ' + action.cardUid + ' has no action');
  assert(!ps.usedCardActions.includes(card.uid), 'card action already used this generation');
  if (card.action.cost) payCost(state, playerIndex, card.action.cost);
  ps.usedCardActions.push(card.uid);
  state.events.push({ type: 'cardAction', player: playerIndex, card: card.uid, name: card.name });
  applyEffects(state, playerIndex, card.action.effects, { card });
}

function doStandard(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const projects = STANDARD_PROJECTS;
  switch (action.project) {
    case 'sellPatents':
      discardHandCard(state, playerIndex, action.cardId);
      ps.mc += projects.sellPatents.gain;
      state.events.push({ type: 'sellPatents', player: playerIndex, card: action.cardId });
      break;
    case 'powerPlant':
      assert(ps.mc >= projects.powerPlant.cost, 'not enough MC');
      ps.mc -= projects.powerPlant.cost;
      adjustProduction(state, playerIndex, 'energy', 1);
      break;
    case 'asteroid':
      assert(ps.mc >= projects.asteroid.cost, 'not enough MC');
      assert(state.globals.temperature < TEMPERATURE_MAX, 'temperature already maxed');
      ps.mc -= projects.asteroid.cost;
      raiseTemperature(state, playerIndex, 1);
      break;
    case 'aquifer':
      assert(ps.mc >= projects.aquifer.cost, 'not enough MC');
      ps.mc -= projects.aquifer.cost;
      placeOcean(state, playerIndex, action.cell);
      break;
    case 'greenery':
      assert(ps.mc >= projects.greenery.cost, 'not enough MC');
      ps.mc -= projects.greenery.cost;
      placeTile(state, playerIndex, action.cell, 'greenery');
      break;
    case 'city':
      assert(ps.mc >= projects.city.cost, 'not enough MC');
      ps.mc -= projects.city.cost;
      placeTile(state, playerIndex, action.cell, 'city');
      break;
    default:
      throw new Error('Terraforming Mars illegal: unknown standard project ' + action.project);
  }
  state.events.push({ type: 'standard', player: playerIndex, project: action.project });
}

function doConvertPlants(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  assert(ps.plants >= PLANT_GREENERY_COST, 'need 8 plants to place a greenery');
  assert(canPlaceTile(state, action.cell, 'greenery'), 'cannot place greenery on cell ' + action.cell);
  ps.plants -= PLANT_GREENERY_COST;
  placeTile(state, playerIndex, action.cell, 'greenery');
  state.events.push({ type: 'convertPlants', player: playerIndex, cell: action.cell });
}

function doConvertHeat(state, playerIndex) {
  const ps = state.players[playerIndex];
  assert(ps.heat >= HEAT_TEMP_COST, 'need 8 heat to raise temperature');
  assert(state.globals.temperature < TEMPERATURE_MAX, 'temperature already maxed');
  ps.heat -= HEAT_TEMP_COST;
  raiseTemperature(state, playerIndex, 1);
  state.events.push({ type: 'convertHeat', player: playerIndex });
}

function doClaimMilestone(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const def = MILESTONES[action.milestone];
  assert(def, 'unknown milestone ' + action.milestone);
  assert(state.milestones.length < milestoneLimit(state), 'milestone limit reached');
  assert(!state.milestones.some((m) => m.id === action.milestone), 'milestone already claimed');
  assert(!state.milestones.some((m) => m.player === playerIndex), 'you already claimed a milestone');
  assert(ps.mc >= MILESTONE_COST, 'not enough MC');
  const metrics = playerMetrics(state, playerIndex);
  assert(metrics[def.metric] >= def.need, 'milestone condition not met: ' + def.metric + ' ' + metrics[def.metric] + '/' + def.need);
  ps.mc -= MILESTONE_COST;
  state.milestones.push({ id: def.id, player: playerIndex, generation: state.generation });
  state.events.push({ type: 'milestone', player: playerIndex, milestone: def.id });
}

function doFundAward(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const def = AWARDS[action.award];
  assert(def, 'unknown award ' + action.award);
  assert(state.awards.length < awardLimit(state), 'award limit reached');
  assert(!state.awards.some((a) => a.id === action.award), 'award already funded');
  assert(!state.awards.some((a) => a.player === playerIndex), 'you already funded an award');
  assert(ps.mc >= AWARD_COST, 'not enough MC');
  ps.mc -= AWARD_COST;
  state.awards.push({ id: def.id, player: playerIndex, generation: state.generation });
  state.events.push({ type: 'award', player: playerIndex, award: def.id });
}

function resolveProduction(state) {
  assert(state.phase === 'production', 'production can only be resolved in the production phase');
  for (const seat of state.turnOrder) {
    const ps = state.players[seat];
    ps.mc += ps.production.mc;
    ps.steel += ps.production.steel;
    ps.titanium += ps.production.titanium;
    ps.plants += ps.production.plants;
    ps.energy += ps.production.energy;
    ps.heat += ps.production.heat;
    ps.heat += ps.energy;
    ps.energy = 0;
    state.events.push({ type: 'production', player: seat });
    if (ps.plants >= PLANT_GREENERY_COST) {
      const cells = legalCells(state, 'greenery');
      if (cells.length > 0) {
        ps.plants -= PLANT_GREENERY_COST;
        placeTile(state, seat, cells[0], 'greenery');
        state.events.push({ type: 'productionGreenery', player: seat, cell: cells[0] });
      }
    }
    ps.usedCardActions = [];
  }
  state.phase = 'generation-end';
  state.productionDone = true;
  state.lastProduction = state.generation;
}

function doNextGeneration(state) {
  assert(state.phase === 'generation-end', 'nextGeneration requires the generation-end phase');
  if (isTerraformed(state) || state.generation >= MAX_GENERATIONS) {
    state.phase = 'game-over';
    const final = score(state);
    state.winner = final.winner;
    state.events.push({ type: 'gameOver', generation: state.generation, terraformed: isTerraformed(state) });
    return;
  }
  state.generation += 1;
  state.turnOrder = state.turnOrder.slice(1).concat(state.turnOrder.slice(0, 1));
  state.firstPlayer = state.turnOrder[0];
  state.currentPlayerIdx = 0;
  state.researchIdx = 0;
  state.actionsLeft = ACTIONS_PER_TURN;
  state.phase = 'research';
  state.productionDone = false;
  for (const ps of state.players) {
    ps.passed = false;
    ps.usedCardActions = [];
    ps.pendingResearch = [];
  }
  for (const seat of state.turnOrder) {
    drawCardsTo(state, seat, GENERATION_RESEARCH, 'research');
  }
  state.events.push({ type: 'newGeneration', generation: state.generation, firstPlayer: state.firstPlayer });
}

function endActionTurn(state) {
  state.actionsLeft -= 1;
  if (state.actionsLeft > 0) return;
  advanceActionPlayer(state);
}

function advanceActionPlayer(state) {
  const n = state.playerCount;
  for (let step = 1; step <= n; step += 1) {
    const idx = (state.currentPlayerIdx + step) % n;
    const seat = state.turnOrder[idx];
    if (seat === undefined) continue;
    if (!state.players[seat].passed) {
      state.currentPlayerIdx = idx;
      state.actionsLeft = ACTIONS_PER_TURN;
      return;
    }
  }
  state.passedAll = true;
  state.phase = 'production';
  state.events.push({ type: 'productionPhase', generation: state.generation });
}

function doPass(state, playerIndex) {
  const ps = state.players[playerIndex];
  ps.passed = true;
  state.events.push({ type: 'pass', player: playerIndex });
  advanceActionPlayer(state);
}

/* ------------------------------------------------------------------ */
/* applyAction                                                       */
/* ------------------------------------------------------------------ */

export function applyAction(state, action) {
  assert(state && typeof state === 'object', 'state is required');
  assert(action && typeof action === 'object', 'action is required');
  const next = clone(state);
  const player = currentPlayer(next);
  const requirePlayer = () => {
    assert(player !== null, 'no current player for ' + action.type);
    return player;
  };

  switch (action.type) {
    case 'researchBuy':
      assert(next.phase === 'research', 'researchBuy requires the research phase');
      doResearchBuy(next, requirePlayer(), action);
      break;
    case 'researchEnd':
      assert(next.phase === 'research', 'researchEnd requires the research phase');
      doResearchEnd(next, requirePlayer());
      break;
    case 'playCard':
      assert(next.phase === 'action', 'playCard requires the action phase');
      doPlayCard(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'cardAction':
      assert(next.phase === 'action', 'cardAction requires the action phase');
      doCardAction(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'standard':
      assert(next.phase === 'action', 'standard requires the action phase');
      doStandard(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'convertPlants':
      assert(next.phase === 'action', 'convertPlants requires the action phase');
      doConvertPlants(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'convertHeat':
      assert(next.phase === 'action', 'convertHeat requires the action phase');
      doConvertHeat(next, requirePlayer());
      endActionTurn(next);
      break;
    case 'claimMilestone':
      assert(next.phase === 'action', 'claimMilestone requires the action phase');
      doClaimMilestone(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'fundAward':
      assert(next.phase === 'action', 'fundAward requires the action phase');
      doFundAward(next, requirePlayer(), action);
      endActionTurn(next);
      break;
    case 'pass':
      assert(next.phase === 'action', 'pass requires the action phase');
      doPass(next, requirePlayer());
      break;
    case 'resolveProduction':
      assert(next.phase === 'production', 'resolveProduction requires the production phase');
      resolveProduction(next);
      break;
    case 'nextGeneration':
      assert(next.phase === 'generation-end', 'nextGeneration requires the generation-end phase');
      doNextGeneration(next);
      break;
    default:
      throw new Error('Terraforming Mars illegal: unknown action type ' + action.type);
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Greedy AI                                                         */
/* ------------------------------------------------------------------ */

const RESOURCE_VALUE = Object.freeze({
  mc: 1, steel: 2, titanium: 3, plants: 1.2, energy: 1, heat: 0.8
});
const PRODUCTION_VALUE = Object.freeze({
  mc: 10, steel: 7, titanium: 8, plants: 9, energy: 5, heat: 4
});

function effectValue(state, effect, card, playerIndex) {
  const tempSteps = Math.max(0, (TEMPERATURE_MAX - state.globals.temperature) / TEMPERATURE_STEP);
  const oxygenSteps = Math.max(0, OXYGEN_MAX - state.globals.oxygen);
  const oceanSteps = Math.max(0, OCEAN_MAX - state.globals.oceans);
  const tempOnly = tempSteps > 0 && oxygenSteps === 0 && oceanSteps === 0;
  const oxygenOnly = oxygenSteps > 0 && tempSteps === 0 && oceanSteps === 0;
  const oceanOnly = oceanSteps > 0 && tempSteps === 0 && oxygenSteps === 0;
  switch (effect.type) {
    case 'prod':
      return effect.amount * (PRODUCTION_VALUE[effect.res] || 5);
    case 'res':
      return effect.amount * (RESOURCE_VALUE[effect.res] || 1);
    case 'tr':
      return effect.amount * 4;
    case 'temperature':
      return effect.steps * (8 + tempSteps * 1.5) + (tempSteps <= effect.steps ? 40 : 0)
        + (tempOnly ? 70 : 0);
    case 'oxygen':
      return effect.steps * (8 + oxygenSteps * 1.5) + (oxygenSteps <= effect.steps ? 40 : 0)
        + (oxygenOnly ? 70 : 0);
    case 'ocean':
      return effect.count * (8 + oceanSteps * 2) + (oceanSteps <= effect.count ? 50 : 0)
        + (oceanOnly ? 70 : 0);
    case 'tile':
      if (effect.tile === 'city') return 10;
      if (effect.tile === 'greenery') return 8;
      return 4;
    case 'draw':
      return effect.amount * 3;
    case 'cardResource':
      return effect.amount * 2;
    case 'prodPerTag':
      return (state.players[playerIndex].production[effect.res] || 0) * 1
        + tagCount(state, playerIndex, effect.tag) * PRODUCTION_VALUE[effect.res] * 0.7;
    case 'opponentProd':
      return 2;
    default:
      return 0;
  }
}

export function cardValue(state, playerIndex, card) {
  let value = 0;
  for (const effect of card.effects) value += effectValue(state, effect, card, playerIndex);
  value += card.vp * 3;
  if (card.vpPer) {
    if (card.vpPer.type === 'tag') {
      value += (tagCount(state, playerIndex, card.vpPer.tag) + (card.tags.includes(card.vpPer.tag) ? 1 : 0))
        * card.vpPer.vp * 2;
    } else if (card.vpPer.type === 'cardResource') {
      value += 3 * card.vpPer.vp;
    } else if (card.vpPer.type === 'cities') {
      value += countCities(state, playerIndex) * card.vpPer.vp * 2;
    }
  }
  if (card.action) value += 6;
  value -= card.cost * 0.35;
  if (state.generation <= 6) {
    for (const effect of card.effects) {
      if (effect.type === 'prod' && effect.amount > 0) value += effect.amount * 3;
    }
  }
  return value;
}

function projectValue(state, playerIndex, action) {
  const ps = state.players[playerIndex];
  const early = state.generation <= 8;
  const tempSteps = Math.max(0, (TEMPERATURE_MAX - state.globals.temperature) / TEMPERATURE_STEP);
  const oxygenSteps = Math.max(0, OXYGEN_MAX - state.globals.oxygen);
  const oceanSteps = Math.max(0, OCEAN_MAX - state.globals.oceans);
  const tempOnly = tempSteps > 0 && oxygenSteps === 0 && oceanSteps === 0;
  const oxygenOnly = oxygenSteps > 0 && tempSteps === 0 && oceanSteps === 0;
  const oceanOnly = oceanSteps > 0 && tempSteps === 0 && oxygenSteps === 0;
  switch (action.project) {
    case 'sellPatents':
      // Selling patents is a last resort: it burns a card for 3 MC. The AI
      // only does it when the hand is clogged, never as an income engine.
      if (tempOnly || oxygenOnly || oceanOnly) return -120;
      return ps.hand.length >= 12 ? 3 : -120;
    case 'powerPlant':
      return (early ? 4 : 6) - ((tempOnly || oxygenOnly || oceanOnly) ? 50 : 0);
    case 'asteroid': return (early ? 8 : 15) + tempSteps * 4
      + (tempSteps <= 1 ? 60 : 0) + (tempOnly ? 80 : 0);
    case 'aquifer': return (early ? 8 : 15) + oceanSteps * 4
      + (oceanSteps <= 1 ? 70 : 0) + (oceanOnly ? 80 : 0);
    case 'greenery': return (early ? 12 : 22) + oxygenSteps * 4
      + (oxygenSteps <= 1 ? 50 : 0) + (oxygenOnly ? 80 : 0);
    case 'city':
      return (early ? 5 : 12) - ((tempOnly || oxygenOnly || oceanOnly) ? 50 : 0);
    default: return 0;
  }
}

function liquidityPenalty(state, playerIndex, afterMc) {
  if (afterMc >= 8) return 0;
  return -20 - (8 - Math.max(0, afterMc)) * 5;
}

/** Returns the name of the only unfinished global track, or null. */
function onlyTrack(state) {
  const open = [];
  if (state.globals.temperature < TEMPERATURE_MAX) open.push('temperature');
  if (state.globals.oxygen < OXYGEN_MAX) open.push('oxygen');
  if (state.globals.oceans < OCEAN_MAX) open.push('oceans');
  return open.length === 1 ? open[0] : null;
}

function cardHelpsTrack(card, track) {
  return card.effects.some((e) =>
    (track === 'temperature' && e.type === 'temperature')
    || (track === 'oxygen' && (e.type === 'oxygen' || (e.type === 'tile' && e.tile === 'greenery')))
    || (track === 'oceans' && e.type === 'ocean'));
}

function actionHeuristic(state, action, playerIndex) {
  if (action.type === 'pass') return -50;
  if (action.type === 'researchEnd') return -10;
  if (action.type === 'resolveProduction' || action.type === 'nextGeneration') return 1000;
  if (playerIndex === null || playerIndex === undefined) return 0;
  const ps = state.players[playerIndex];
  const lastTrack = onlyTrack(state);
  const lastCost = lastTrack === 'temperature' ? STANDARD_PROJECTS.asteroid.cost
    : lastTrack === 'oceans' ? STANDARD_PROJECTS.aquifer.cost
      : lastTrack === 'oxygen' ? STANDARD_PROJECTS.greenery.cost : 0;
  const freeConversion = lastTrack === 'oxygen' && ps.plants >= PLANT_GREENERY_COST;
  const reserve = freeConversion ? 0 : lastCost;
  const saving = lastTrack !== null && ps.mc < reserve + 6;
  switch (action.type) {
    case 'researchBuy': {
      const card = ps.pendingResearch.find((c) => c.uid === action.cardId);
      if (!card) return -100;
      let value = cardValue(state, playerIndex, card);
      if (card.cost <= 10) value += 8;
      if (card.effects.some((e) => e.type === 'prod' && e.amount > 0)) value += 10;
      if (!meetsRequirements(state, playerIndex, card.requirements)) value -= 20;
      if (ps.hand.length >= 7) value -= 25;
      if (ps.mc - RESEARCH_COST < 4) value -= 40;
      if (lastTrack && !cardHelpsTrack(card, lastTrack)
        && (saving || ps.mc - RESEARCH_COST < reserve)) value -= 60;
      if (value < 4) value -= 15;
      return value;
    }
    case 'playCard': {
      const card = ps.hand.find((c) => c.uid === action.cardId);
      if (!card) return -100;
      let value = cardValue(state, playerIndex, card) + 10;
      const afterMc = ps.mc - (action.payment ? action.payment.mc : 0);
      const penalty = liquidityPenalty(state, playerIndex, afterMc);
      const growsEconomy = card.effects.some((e) =>
        e.type === 'prod' && e.amount > 0 && (e.res === 'mc' || e.res === 'steel' || e.res === 'titanium'));
      value += growsEconomy ? penalty * 0.35 : penalty;
      // When one track is the only one left, do not burn the credits needed
      // for the matching standard project on unrelated VP cards.
      if (lastTrack && !cardHelpsTrack(card, lastTrack)
        && (saving || afterMc < reserve)) value -= 100;
      return value;
    }
    case 'cardAction': {
      const card = findPlayedCard(ps, action.cardUid);
      if (!card) return -100;
      let value = 6;
      for (const effect of card.action.effects) value += effectValue(state, effect, card, playerIndex);
      if (saving && !cardHelpsTrack(card, lastTrack)) value -= 60;
      return value;
    }
    case 'standard': {
      const cost = STANDARD_PROJECTS[action.project] ? STANDARD_PROJECTS[action.project].cost : 0;
      const afterMc = ps.mc - cost;
      let value = projectValue(state, playerIndex, action)
        + liquidityPenalty(state, playerIndex, afterMc);
      if (state.generation <= 8 && cost > 0 && afterMc < 15) value -= 25;
      if (saving) {
        const useful = (lastTrack === 'temperature' && action.project === 'asteroid')
          || (lastTrack === 'oxygen' && action.project === 'greenery')
          || (lastTrack === 'oceans' && action.project === 'aquifer');
        if (!useful) value -= 100;
      }
      if (lastTrack) {
        const useful = (lastTrack === 'temperature' && action.project === 'asteroid')
          || (lastTrack === 'oxygen' && action.project === 'greenery')
          || (lastTrack === 'oceans' && action.project === 'aquifer');
        if (!useful && afterMc < reserve) value -= 100;
      }
      return value;
    }
    case 'convertPlants': {
      const oxygenSteps = Math.max(0, OXYGEN_MAX - state.globals.oxygen);
      const only = oxygenSteps > 0
        && state.globals.temperature >= TEMPERATURE_MAX && state.globals.oceans >= OCEAN_MAX;
      return 20 + oxygenSteps * 4 + (oxygenSteps <= 1 ? 50 : 0) + (only ? 80 : 0);
    }
    case 'convertHeat': {
      const tempSteps = Math.max(0, (TEMPERATURE_MAX - state.globals.temperature) / TEMPERATURE_STEP);
      const only = tempSteps > 0
        && state.globals.oxygen >= OXYGEN_MAX && state.globals.oceans >= OCEAN_MAX;
      return 12 + tempSteps * 4 + (tempSteps <= 1 ? 60 : 0) + (only ? 80 : 0);
    }
    case 'claimMilestone': return 34 + liquidityPenalty(state, playerIndex, ps.mc - MILESTONE_COST)
      + ((lastTrack && ps.mc - MILESTONE_COST < reserve) ? -60 : 0);
    case 'fundAward': return (state.generation <= 6 ? 5 : 18)
      + liquidityPenalty(state, playerIndex, ps.mc - AWARD_COST)
      + ((lastTrack && ps.mc - AWARD_COST < reserve) ? -60 : 0);
    default: return 0;
  }
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

export function autoPlay(state, opts = {}) {
  let next = state;
  let actions = 0;
  const trace = [];
  const max = opts.maxActions || MAX_ACTIONS;
  while (next.phase !== 'game-over' && actions < max) {
    const list = legalActions(next);
    if (list.length === 0) {
      throw new Error('Terraforming Mars AI: no legal actions in phase ' + next.phase);
    }
    const action = opts.choose ? opts.choose(next, list) : chooseGreedyAction(next, list);
    trace.push({ generation: next.generation, phase: next.phase, player: currentPlayer(next), action: clone(action) });
    next = applyAction(next, action);
    actions += 1;
  }
  if (next.phase !== 'game-over' && !opts.allowIncomplete) {
    throw new Error('Terraforming Mars AI: game did not finish within ' + max + ' actions');
  }
  return { state: next, actions, trace };
}

export function selfPlay(opts = {}) {
  const state = createGame(opts);
  return autoPlay(state, opts);
}

/* ------------------------------------------------------------------ */
/* Game setup                                                        */
/* ------------------------------------------------------------------ */

function makePlayer(index, name) {
  return {
    index,
    name,
    mc: START_MC,
    steel: 0,
    titanium: 0,
    plants: 0,
    energy: 0,
    heat: 0,
    production: clone(START_PRODUCTION),
    tr: START_TR,
    hand: [],
    played: [],
    pendingResearch: [],
    usedCardActions: [],
    passed: false,
    milestones: [],
    awards: []
  };
}

export function createGame(opts = {}) {
  const playerCount = opts.playerCount === undefined ? 2 : opts.playerCount;
  assert(isInteger(playerCount) && playerCount >= 2 && playerCount <= 5,
    'playerCount must be an integer from 2 to 5');
  const seed = opts.seed === undefined || opts.seed === null ? 1 : opts.seed;
  const turnOrder = shuffleWith(
    Array.from({ length: playerCount }, (_, i) => i),
    seed + ':turn'
  );
  const players = Array.from({ length: playerCount }, (_, i) => makePlayer(
    i,
    opts.names && opts.names[i] ? opts.names[i] : 'P' + (i + 1)
  ));
  const state = {
    version: VERSION,
    seed,
    playerCount,
    generation: 1,
    firstPlayer: turnOrder[0],
    turnOrder,
    currentPlayerIdx: 0,
    researchIdx: 0,
    actionsLeft: ACTIONS_PER_TURN,
    phase: 'research',
    globals: { temperature: TEMPERATURE_MIN, oxygen: 0, oceans: 0 },
    board: { cells: new Array(BOARD_CELLS).fill(null) },
    deck: buildDeck(seed),
    discard: [],
    reshuffleCount: 0,
    nextCardUid: 1,
    players,
    milestones: [],
    awards: [],
    winner: null,
    passedAll: false,
    productionDone: false,
    lastProduction: 0,
    rules: {
      actionsPerTurn: ACTIONS_PER_TURN,
      initialResearch: INITIAL_RESEARCH,
      generationResearch: GENERATION_RESEARCH,
      researchCost: RESEARCH_COST,
      maxGenerations: MAX_GENERATIONS,
      cardCopies: CARD_COPIES
    },
    events: []
  };
  for (const seat of state.turnOrder) {
    drawCardsTo(state, seat, INITIAL_RESEARCH, 'research');
  }
  state.events.push({ type: 'gameStart', generation: 1, firstPlayer: state.firstPlayer });
  return state;
}

/* ------------------------------------------------------------------ */
/* Export data for tests / future UI                                  */
/* ------------------------------------------------------------------ */

export const DATA = Object.freeze({
  CATEGORIES,
  CARDS_BY_ID,
  STANDARD_PROJECTS,
  MILESTONES,
  AWARDS,
  RESOURCES,
  BOARD_W,
  BOARD_H,
  TEMPERATURE_MIN,
  TEMPERATURE_MAX,
  TEMPERATURE_STEP,
  OXYGEN_MAX,
  OCEAN_MAX,
  START_TR,
  START_MC,
  START_PRODUCTION,
  RESEARCH_COST,
  INITIAL_RESEARCH,
  GENERATION_RESEARCH,
  ACTIONS_PER_TURN,
  PLANT_GREENERY_COST,
  HEAT_TEMP_COST,
  MILESTONE_COST,
  AWARD_COST,
  MAX_GENERATIONS
});

export default {
  VERSION,
  createGame,
  legalActions,
  applyAction,
  score,
  hashState,
  stableStringify,
  currentPlayer,
  chooseGreedyAction,
  autoPlay,
  selfPlay,
  cardValue,
  cardInstance,
  playerMetrics,
  tagCount,
  tileCounts,
  meetsRequirements,
  canPlaceTile,
  canPayCard,
  canonicalPayment,
  validatePayment,
  cardVictoryPoints,
  cityVictoryPoints,
  greeneryVictoryPoints,
  awardVictoryPoints,
  isTerraformed,
  milestoneLimit,
  awardLimit,
  DATA,
  CARD_DEFS,
  CARDS_BY_ID,
  STANDARD_PROJECTS,
  MILESTONES,
  AWARDS,
  CATEGORIES
};
