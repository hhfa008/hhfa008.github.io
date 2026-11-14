/*
 * 《全球惊悚》阿撒托斯剧本 — 精品版纯规则引擎（一期）
 *
 * 纯逻辑、零 DOM、零外部依赖。ES module；Node 侧：
 *   import * as EH from './engine.js'
 * 浏览器二期可直接用 <script type="module"> 加载。
 *
 * 设计约束：
 *   - createGame / legalActions / applyAction 全部是状态推进函数：
 *     applyAction 不修改入参，始终返回 JSON 可序列化的新 state。
 *   - 随机数只来自 state.seed -> state.rngState 的 seeded mulberry32；
 *     相同 seed + 相同动作序列 = 完全相同的终局（含所有骰面、牌序、刷怪点）。
 *   - 非法动作一律抛 Error；AI 只从 legalActions 里选择动作。
 *   - 没有占位实现：地图、遭遇牌、神话卡、古神任务链、怪物、门、AI 全部可玩。
 *
 * 规则口径见同目录 rules.md。
 */

export const VERSION = '1.0.0';
export const DEFAULT_SEED = 'eldritch-horror-azathoth';
export const MAX_ROUNDS = 16;
export const ACTIONS_PER_TURN = 2;
export const MAX_MONSTERS = 8;
export const MAX_GATES = 6;
export const DEFAULT_DOOM = 12;
export const SUCCESS_MIN_FACE = 5;

export const ATTRIBUTE_NAMES = Object.freeze({
  will: '意志',
  strength: '力量',
  observation: '观察',
  influence: '影响'
});

/* ------------------------------------------------------------------ *
 * 调查员                                                             *
 * ------------------------------------------------------------------ */

export const INVESTIGATOR_TEMPLATES = Object.freeze({
  norman: Object.freeze({
    key: 'norman',
    name: '诺曼·惠特斯',
    title: '天文学家',
    attributes: Object.freeze({ will: 3, strength: 1, observation: 3, influence: 2 }),
    health: 5,
    sanity: 7,
    ability: Object.freeze({
      id: 'star-charts',
      name: '星图',
      text: '观察检定 +1 骰。'
    })
  }),
  mark: Object.freeze({
    key: 'mark',
    name: '马克·哈里根',
    title: '士兵',
    attributes: Object.freeze({ will: 2, strength: 3, observation: 2, influence: 2 }),
    health: 8,
    sanity: 5,
    ability: Object.freeze({
      id: 'battle-hardened',
      name: '身经百战',
      text: '力量检定 +1 骰。'
    })
  }),
  diana: Object.freeze({
    key: 'diana',
    name: '戴安娜·斯坦利',
    title: '前邪教徒',
    attributes: Object.freeze({ will: 3, strength: 2, observation: 2, influence: 3 }),
    health: 6,
    sanity: 6,
    ability: Object.freeze({
      id: 'forbidden-knowledge',
      name: '禁忌知识',
      text: '每轮第一次检定失败时可以自动重掷一次。'
    })
  }),
  silas: Object.freeze({
    key: 'silas',
    name: '西拉斯·马什',
    title: '水手',
    attributes: Object.freeze({ will: 2, strength: 3, observation: 3, influence: 1 }),
    health: 7,
    sanity: 5,
    ability: Object.freeze({
      id: 'old-salt',
      name: '老海盐',
      text: '一次移动动作可以沿连接走最多 2 步。'
    })
  })
});

const DEFAULT_INVESTIGATORS = Object.freeze(['norman', 'mark', 'diana', 'silas']);
const START_LOCATIONS = Object.freeze({
  norman: 'arkham',
  mark: 'london',
  diana: 'shanghai',
  silas: 'sydney'
});

/* ------------------------------------------------------------------ *
 * 世界地图：17 个地点 / 15 个子区域 / 6 个大洲                     *
 * ------------------------------------------------------------------ */

const LOCATION_DATA = Object.freeze([
  { id: 'arkham', name: '阿卡姆', continent: '北美洲', region: '北美东海岸', type: 'city' },
  { id: 'buenos_aires', name: '布宜诺斯艾利斯', continent: '南美洲', region: '南美南部', type: 'city' },
  { id: 'amazon', name: '亚马逊雨林', continent: '南美洲', region: '南美腹地', type: 'wilderness' },
  { id: 'london', name: '伦敦', continent: '欧洲', region: '西欧', type: 'city' },
  { id: 'rome', name: '罗马', continent: '欧洲', region: '南欧', type: 'city' },
  { id: 'alps', name: '阿尔卑斯山区', continent: '欧洲', region: '中欧', type: 'wilderness' },
  { id: 'cairo', name: '开罗', continent: '非洲', region: '北非', type: 'city' },
  { id: 'sahara', name: '撒哈拉沙漠', continent: '非洲', region: '北非', type: 'wilderness' },
  { id: 'timbuktu', name: '廷巴克图', continent: '非洲', region: '西非', type: 'wilderness' },
  { id: 'shanghai', name: '上海', continent: '亚洲', region: '东亚', type: 'city' },
  { id: 'tokyo', name: '东京', continent: '亚洲', region: '东亚', type: 'city' },
  { id: 'himalayas', name: '喜马拉雅山区', continent: '亚洲', region: '南亚', type: 'wilderness' },
  { id: 'sydney', name: '悉尼', continent: '大洋洲', region: '澳洲东南', type: 'city' },
  { id: 'outback', name: '澳洲内陆', continent: '大洋洲', region: '澳洲内陆', type: 'wilderness' },
  { id: 'north_atlantic', name: '北大西洋', continent: '海洋', region: '北大西洋', type: 'sea' },
  { id: 'indian_ocean', name: '印度洋', continent: '海洋', region: '印度洋', type: 'sea' },
  { id: 'pacific_ocean', name: '太平洋', continent: '海洋', region: '太平洋', type: 'sea' }
]);

const LOCATION_EDGES = Object.freeze([
  ['arkham', 'north_atlantic'],
  ['arkham', 'buenos_aires'],
  ['buenos_aires', 'amazon'],
  ['buenos_aires', 'north_atlantic'],
  ['amazon', 'north_atlantic'],
  ['london', 'north_atlantic'],
  ['london', 'rome'],
  ['london', 'alps'],
  ['rome', 'alps'],
  ['rome', 'cairo'],
  ['rome', 'timbuktu'],
  ['cairo', 'sahara'],
  ['cairo', 'timbuktu'],
  ['cairo', 'indian_ocean'],
  ['sahara', 'timbuktu'],
  ['timbuktu', 'north_atlantic'],
  ['shanghai', 'tokyo'],
  ['shanghai', 'himalayas'],
  ['shanghai', 'indian_ocean'],
  ['shanghai', 'pacific_ocean'],
  ['tokyo', 'pacific_ocean'],
  ['himalayas', 'indian_ocean'],
  ['sydney', 'outback'],
  ['sydney', 'indian_ocean'],
  ['sydney', 'pacific_ocean'],
  ['outback', 'indian_ocean']
]);

function buildLocations() {
  const map = {};
  LOCATION_DATA.forEach(function (loc) {
    map[loc.id] = {
      id: loc.id,
      name: loc.name,
      continent: loc.continent,
      region: loc.region,
      type: loc.type,
      connections: []
    };
  });
  LOCATION_EDGES.forEach(function (edge) {
    const a = map[edge[0]];
    const b = map[edge[1]];
    if (!a || !b) throw new Error('地图连接引用了未知地点：' + edge.join('-'));
    if (a.connections.indexOf(b.id) === -1) a.connections.push(b.id);
    if (b.connections.indexOf(a.id) === -1) b.connections.push(a.id);
  });
  Object.keys(map).forEach(function (id) { map[id].connections.sort(); });
  return LOCATION_DATA.map(function (loc) { return map[loc.id]; });
}

export const MAP = Object.freeze({
  locations: Object.freeze(LOCATION_DATA.map(function (loc) {
    return Object.freeze({
      id: loc.id, name: loc.name, continent: loc.continent,
      region: loc.region, type: loc.type
    });
  })),
  edges: LOCATION_EDGES
});

/* ------------------------------------------------------------------ *
 * 古神：阿撒托斯与三段神秘任务链                                     *
 * ------------------------------------------------------------------ */

export const MYSTERIES = Object.freeze([
  Object.freeze({
    id: 'm1',
    name: '星之眷族的苏醒',
    attribute: 'observation',
    difficulty: 1,
    required: 3,
    types: Object.freeze(['city', 'wilderness']),
    text: '在城市或荒野追查星之眷族的踪迹，每取得 1 点研究进度需要 1 次成功的观察检定。'
  }),
  Object.freeze({
    id: 'm2',
    name: '受诅咒的仪式',
    attribute: 'will',
    difficulty: 2,
    required: 4,
    types: Object.freeze(['wilderness', 'sea']),
    text: '在荒野或海洋寻找仪式节点，每取得 1 点研究进度需要 1 次成功的意志检定。'
  }),
  Object.freeze({
    id: 'm3',
    name: '阿撒托斯的低语',
    attribute: 'will',
    difficulty: 2,
    required: 5,
    types: Object.freeze(['city']),
    text: '在城市中对抗古神的低语，每次研究需要 2 个成功（复杂检定）。'
  })
]);

export const ANCIENT_ONES = Object.freeze({
  azathoth: Object.freeze({
    id: 'azathoth',
    name: '阿撒托斯',
    title: '盲目痴愚之神',
    doom: DEFAULT_DOOM,
    mysteries: MYSTERIES,
    awakening: '末日轨归零时阿撒托斯苏醒，所有调查员被吞噬。',
    defeat: '完成全部 3 张神秘卡即阻止阿撒托斯。'
  })
});

/* ------------------------------------------------------------------ *
 * 遭遇牌：36 张（城市 / 荒野 / 海洋各 12）                           *
 * ------------------------------------------------------------------ */

const CITY_ENCOUNTERS = Object.freeze([
  Object.freeze({ id: 'city-01', name: '黑帮勒索', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'city-02', name: '街角线人', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'city-03', name: '古老图书馆', type: 'city', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'city-04', name: '深夜巡警', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ sanity: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'city-05', name: '码头传闻', type: 'city', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) }),
  Object.freeze({ id: 'city-06', name: '神秘学书店', type: 'city', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'city-07', name: '医院值班室', type: 'city', attribute: 'will', difficulty: 1,
    success: Object.freeze({ health: 2 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'city-08', name: '报社档案室', type: 'city', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'city-09', name: '教会避难所', type: 'city', attribute: 'will', difficulty: 1,
    success: Object.freeze({ sanity: 2 }), fail: Object.freeze({ doom: -1 }) }),
  Object.freeze({ id: 'city-10', name: '地下赌场', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'city-11', name: '失踪者家属', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1, sanity: -1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'city-12', name: '警局问询', type: 'city', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) })
]);

const WILDERNESS_ENCOUNTERS = Object.freeze([
  Object.freeze({ id: 'wild-01', name: '迷雾沼泽', type: 'wilderness', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-02', name: '荒废矿洞', type: 'wilderness', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-03', name: '石阵低语', type: 'wilderness', attribute: 'will', difficulty: 1,
    success: Object.freeze({ doom: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'wild-04', name: '狼群袭击', type: 'wilderness', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-05', name: '幽暗森林', type: 'wilderness', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'wild-06', name: '雪山迷途', type: 'wilderness', attribute: 'will', difficulty: 1,
    success: Object.freeze({ sanity: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-07', name: '沙漠商队', type: 'wilderness', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-08', name: '古老遗迹', type: 'wilderness', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) }),
  Object.freeze({ id: 'wild-09', name: '星陨坑', type: 'wilderness', attribute: 'observation', difficulty: 2,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ monster: true }) }),
  Object.freeze({ id: 'wild-10', name: '荒野营地', type: 'wilderness', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ health: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'wild-11', name: '食尸鬼巢穴', type: 'wilderness', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'wild-12', name: '河畔渡口', type: 'wilderness', attribute: 'will', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) })
]);

const SEA_ENCOUNTERS = Object.freeze([
  Object.freeze({ id: 'sea-01', name: '风暴航行', type: 'sea', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'sea-02', name: '幽灵船', type: 'sea', attribute: 'observation', difficulty: 2,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'sea-03', name: '深海低语', type: 'sea', attribute: 'will', difficulty: 2,
    success: Object.freeze({ doom: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'sea-04', name: '触手袭击', type: 'sea', attribute: 'strength', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'sea-05', name: '迷失航线', type: 'sea', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) }),
  Object.freeze({ id: 'sea-06', name: '水手传说', type: 'sea', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'sea-07', name: '荒岛补给', type: 'sea', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ health: 2 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'sea-08', name: '海雾', type: 'sea', attribute: 'will', difficulty: 1,
    success: Object.freeze({ sanity: 1 }), fail: Object.freeze({ sanity: -1 }) }),
  Object.freeze({ id: 'sea-09', name: '沉船残骸', type: 'sea', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ health: -1 }) }),
  Object.freeze({ id: 'sea-10', name: '诅咒渔获', type: 'sea', attribute: 'will', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ monster: true }) }),
  Object.freeze({ id: 'sea-11', name: '灯塔守望', type: 'sea', attribute: 'observation', difficulty: 1,
    success: Object.freeze({ clues: 1 }), fail: Object.freeze({ doom: -1 }) }),
  Object.freeze({ id: 'sea-12', name: '鲸歌', type: 'sea', attribute: 'influence', difficulty: 1,
    success: Object.freeze({ sanity: 1 }), fail: Object.freeze({ sanity: -1 }) })
]);

export const ENCOUNTER_SETS = Object.freeze({
  city: CITY_ENCOUNTERS,
  wilderness: WILDERNESS_ENCOUNTERS,
  sea: SEA_ENCOUNTERS
});

export const ENCOUNTER_CARDS = Object.freeze(
  CITY_ENCOUNTERS.concat(WILDERNESS_ENCOUNTERS, SEA_ENCOUNTERS)
);

const ENCOUNTER_INDEX = {};
ENCOUNTER_CARDS.forEach(function (card) { ENCOUNTER_INDEX[card.id] = card; });

/* ------------------------------------------------------------------ *
 * 神话卡：12 张                                                      *
 * ------------------------------------------------------------------ */

export const MYTHOS_CARDS = Object.freeze([
  Object.freeze({ id: 'mythos-01', name: '星象异动', doom: 1, gate: true, text: '群星的位置偏移，一道门在世界上打开。' }),
  Object.freeze({ id: 'mythos-02', name: '邪教徒集会', doom: 1, monster: true, text: '披着斗篷的信徒在暗处召唤怪物。' }),
  Object.freeze({ id: 'mythos-03', name: '远古低语', doom: 1, sanity: 1, text: '无法辨认的低语钻进每名调查员的梦境。' }),
  Object.freeze({ id: 'mythos-04', name: '潮汐倒转', doom: 1, gate: true, clue: true, text: '海水退去，露出刻满符号的海床。' }),
  Object.freeze({ id: 'mythos-05', name: '群星归位', doom: 1, monster: true, clue: true, text: '一束星光照亮线索，也照亮了逼近的影子。' }),
  Object.freeze({ id: 'mythos-06', name: '疯狂蔓延', doom: 1, sanity: 1, text: '街巷里传来此起彼伏的尖笑。' }),
  Object.freeze({ id: 'mythos-07', name: '迷雾笼罩', doom: 1, gate: true, text: '浓雾中浮现出不属于这个世界的轮廓。' }),
  Object.freeze({ id: 'mythos-08', name: '献祭之夜', doom: 1, monster: true, text: '远处火光冲天，某种东西回应了献祭。' }),
  Object.freeze({ id: 'mythos-09', name: '不祥预感', doom: 1, clue: true, text: '调查员在噩梦中看见同一个地点。' }),
  Object.freeze({ id: 'mythos-10', name: '门之开启', doom: 1, gate: true, monster: true, text: '门框扭曲，守卫从另一侧挤了出来。' }),
  Object.freeze({ id: 'mythos-11', name: '末日号角', doom: 1, extraDoomIfGates: Object.freeze({ threshold: 2, amount: 1 }),
    text: '号角响起；每多一道敞开的门，世界就离终点更近一步。' }),
  Object.freeze({ id: 'mythos-12', name: '阿撒托斯的凝视', doom: 1, sanity: 1, monster: true, text: '盲目痴愚之神把注意力转向了地球。' })
]);

const MYTHOS_INDEX = {};
MYTHOS_CARDS.forEach(function (card) { MYTHOS_INDEX[card.id] = card; });

/* ------------------------------------------------------------------ *
 * 怪物                                                               *
 * ------------------------------------------------------------------ */

export const MONSTER_TYPES = Object.freeze({
  cultist: Object.freeze({
    id: 'cultist', name: '邪教徒', health: 1, difficulty: 1,
    fightAttr: 'strength', damage: 1, horror: 1
  }),
  ghoul: Object.freeze({
    id: 'ghoul', name: '食尸鬼', health: 2, difficulty: 2,
    fightAttr: 'strength', damage: 1, horror: 1
  }),
  nightgaunt: Object.freeze({
    id: 'nightgaunt', name: '夜魇', health: 1, difficulty: 2,
    fightAttr: 'will', damage: 1, horror: 1
  }),
  star_spawn: Object.freeze({
    id: 'star_spawn', name: '星之眷族', health: 2, difficulty: 2,
    fightAttr: 'will', damage: 1, horror: 2
  })
});

const MONSTER_KEYS = Object.freeze(['cultist', 'ghoul', 'nightgaunt', 'star_spawn']);

/* ------------------------------------------------------------------ *
 * 基础工具                                                           *
 * ------------------------------------------------------------------ */

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

// mulberry32；rngState 是 state 的一部分，因此回放/克隆完全一致。
function nextRandom(state) {
  let t = (state.rngState = (state.rngState + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function drawInt(state, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('drawInt 需要正整数上界');
  const value = Math.floor(nextRandom(state) * n);
  return value < 0 ? 0 : (value >= n ? n - 1 : value);
}

function drawFrom(state, array) {
  if (!array.length) throw new Error('不能从空数组中抽取');
  return array[drawInt(state, array.length)];
}

function shuffleInPlace(state, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = drawInt(state, i + 1);
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

function logEvent(state, type, data) {
  const entry = { round: state.round, phase: state.phase, type: type };
  if (data) {
    Object.keys(data).forEach(function (key) { entry[key] = data[key]; });
  }
  state.log.push(entry);
  return entry;
}

export function getInvestigator(state, id) {
  return state.investigators.find(function (inv) {
    return inv.id === id || inv.key === id;
  }) || null;
}

export function getLocation(state, id) {
  return state.locations.find(function (loc) { return loc.id === id; }) || null;
}

export function aliveInvestigators(state) {
  return state.investigators.filter(function (inv) { return inv.alive; });
}

function currentMystery(state) {
  return state.mysteryIndex < MYSTERIES.length ? MYSTERIES[state.mysteryIndex] : null;
}

function locationTypeOf(state, locationId) {
  const loc = getLocation(state, locationId);
  return loc ? loc.type : null;
}

function gateAt(state, locationId) {
  return state.gates.find(function (gate) { return gate.locationId === locationId; }) || null;
}

function monstersAt(state, locationId) {
  return state.monsters.filter(function (monster) {
    return monster.health > 0 && monster.locationId === locationId;
  });
}

function findMonster(state, id) {
  return state.monsters.find(function (monster) {
    return monster.id === id && monster.health > 0;
  }) || null;
}

/* ------------------------------------------------------------------ *
 * 骰池与检定                                                         *
 * ------------------------------------------------------------------ */

/**
 * 纯函数：把骰面数组结算为成功数。
 * 5/6 为 1 个成功；其他面为 0。difficulty 为需要的成功数。
 */
export function resolveDicePool(faces, difficulty) {
  if (!Array.isArray(faces)) throw new Error('resolveDicePool 需要骰面数组');
  if (!Number.isInteger(difficulty) || difficulty < 1) {
    throw new Error('检定难度必须是正整数');
  }
  const clean = faces.map(function (face) {
    if (!Number.isInteger(face) || face < 1 || face > 6) {
      throw new Error('骰面必须是 1-6 的整数：' + face);
    }
    return face;
  });
  const successes = clean.filter(function (face) { return face >= SUCCESS_MIN_FACE; }).length;
  return {
    faces: clean,
    successes: successes,
    difficulty: difficulty,
    success: successes >= difficulty,
    surplus: Math.max(0, successes - difficulty)
  };
}

function rollFaces(state, pool) {
  const faces = [];
  for (let i = 0; i < pool; i += 1) faces.push(drawInt(state, 6) + 1);
  return faces;
}

function testBonus(inv, attribute) {
  if (inv.key === 'norman' && attribute === 'observation') return 1;
  if (inv.key === 'mark' && attribute === 'strength') return 1;
  return 0;
}

/**
 * 内部检定：按属性掷骰，处理专属能力与戴安娜的重掷。
 * 返回 {attribute, pool, faces, successes, difficulty, success, ...}
 */
function performTest(state, inv, attribute, difficulty, options) {
  const opts = options || {};
  if (!ATTRIBUTE_NAMES[attribute]) throw new Error('未知属性：' + attribute);
  const bonus = opts.bonusDice || 0;
  const pool = Math.max(0, inv.attributes[attribute] + testBonus(inv, attribute) + bonus);
  const firstFaces = rollFaces(state, pool);
  const first = resolveDicePool(firstFaces, difficulty);
  let result = {
    attribute: attribute,
    attributeName: ATTRIBUTE_NAMES[attribute],
    pool: pool,
    faces: first.faces,
    successes: first.successes,
    difficulty: difficulty,
    success: first.success,
    bonusDice: bonus,
    rerolled: false
  };

  // 戴安娜：每轮第一次检定失败时自动重掷一次。
  if (!first.success && inv.key === 'diana' && inv.abilityUsedRound !== state.round) {
    inv.abilityUsedRound = state.round;
    const secondFaces = rollFaces(state, pool);
    const second = resolveDicePool(secondFaces, difficulty);
    result = {
      attribute: attribute,
      attributeName: ATTRIBUTE_NAMES[attribute],
      pool: pool,
      faces: second.faces,
      successes: second.successes,
      difficulty: difficulty,
      success: second.success,
      bonusDice: bonus,
      rerolled: true,
      firstFaces: first.faces,
      firstSuccesses: first.successes
    };
  }

  if (result.success) state.stats.testsPassed += 1;
  else state.stats.testsFailed += 1;
  result.reason = opts.reason || null;
  return result;
}

/* ------------------------------------------------------------------ *
 * 伤害 / 治疗 / 末日                                                 *
 * ------------------------------------------------------------------ */

function changeHealth(state, inv, delta) {
  inv.health += delta;
  if (inv.health > inv.maxHealth) inv.health = inv.maxHealth;
  if (inv.health <= 0) {
    inv.health = 0;
    defeatInvestigator(state, inv, 'health');
  } else {
    logEvent(state, 'health-change', { investigator: inv.id, delta: delta, value: inv.health });
  }
}

function changeSanity(state, inv, delta) {
  inv.sanity += delta;
  if (inv.sanity > inv.maxSanity) inv.sanity = inv.maxSanity;
  if (inv.sanity <= 0) {
    inv.sanity = 0;
    defeatInvestigator(state, inv, 'sanity');
  } else {
    logEvent(state, 'sanity-change', { investigator: inv.id, delta: delta, value: inv.sanity });
  }
}

function changeDoom(state, delta) {
  state.doom += delta;
  if (state.doom > state.maxDoom) state.doom = state.maxDoom;
  if (state.doom < 0) state.doom = 0;
  logEvent(state, 'doom-change', { delta: delta, doom: state.doom });
}

function defeatInvestigator(state, inv, cause) {
  if (!inv.alive) return;
  inv.alive = false;
  inv.actionsLeft = 0;
  const lostClues = inv.clues;
  inv.clues = 0;
  logEvent(state, 'investigator-defeated', {
    investigator: inv.id,
    name: inv.displayName,
    cause: cause,
    lostClues: lostClues
  });
}

function applyEffect(state, inv, effect, locationId, source) {
  if (!effect) return;
  if (effect.clues) inv.clues += effect.clues;
  if (effect.health) changeHealth(state, inv, effect.health);
  if (effect.sanity) changeSanity(state, inv, effect.sanity);
  if (effect.doom) changeDoom(state, effect.doom);
  if (effect.monster) {
    const spawned = spawnMonster(state, locationId);
    if (spawned) {
      logEvent(state, 'monster-spawned-by-effect', { monster: spawned.id, location: locationId, source: source || null });
    }
  }
}

/* ------------------------------------------------------------------ *
 * 门 / 怪物生成与移动                                               *
 * ------------------------------------------------------------------ */

function spawnGate(state, preferredLocationId) {
  if (state.gates.length >= MAX_GATES) return null;
  let candidates = state.locations.filter(function (loc) {
    return state.sealedLocations.indexOf(loc.id) === -1 && !gateAt(state, loc.id);
  });
  if (preferredLocationId) {
    const preferred = candidates.find(function (loc) { return loc.id === preferredLocationId; });
    if (preferred) candidates = [preferred];
  }
  if (!candidates.length) return null;
  const loc = candidates[drawInt(state, candidates.length)];
  const gate = {
    id: 'gate-' + state.nextGateId,
    locationId: loc.id,
    difficulty: 1,
    openedRound: state.round
  };
  state.nextGateId += 1;
  state.gates.push(gate);
  logEvent(state, 'gate-opened', { gate: gate.id, location: loc.id, name: loc.name });
  return gate;
}

function monstersAtLocation(state, locationId) {
  return state.monsters.filter(function (m) {
    return m.health > 0 && m.locationId === locationId;
  }).length;
}

function spawnMonster(state, preferredLocationId) {
  if (state.monsters.filter(function (m) { return m.health > 0; }).length >= MAX_MONSTERS) {
    return null;
  }
  let locationId = preferredLocationId || null;
  if (locationId && monstersAtLocation(state, locationId) >= 2) locationId = null;
  if (!locationId) {
    let candidates = state.locations.filter(function (loc) {
      return monstersAtLocation(state, loc.id) < 2;
    });
    if (state.gates.length) {
      const gateLocations = state.gates.map(function (gate) { return gate.locationId; });
      const gateCandidates = candidates.filter(function (loc) {
        return gateLocations.indexOf(loc.id) !== -1;
      });
      if (gateCandidates.length) candidates = gateCandidates;
    }
    if (!candidates.length) candidates = state.locations.slice();
    const loc = candidates[drawInt(state, candidates.length)];
    locationId = loc.id;
  }
  if (!getLocation(state, locationId)) throw new Error('刷怪地点不存在：' + locationId);
  const type = MONSTER_TYPES[MONSTER_KEYS[drawInt(state, MONSTER_KEYS.length)]];
  const monster = {
    id: 'monster-' + state.nextMonsterId,
    type: type.id,
    name: type.name,
    locationId: locationId,
    health: type.health,
    maxHealth: type.health,
    difficulty: type.difficulty,
    fightAttr: type.fightAttr,
    damage: type.damage,
    horror: type.horror
  };
  state.nextMonsterId += 1;
  state.monsters.push(monster);
  logEvent(state, 'monster-spawned', {
    monster: monster.id, type: monster.type, name: monster.name, location: locationId
  });
  return monster;
}

function removeGate(state, gate) {
  const index = state.gates.indexOf(gate);
  if (index === -1) throw new Error('门已不存在');
  state.gates.splice(index, 1);
}

function removeMonster(state, monster) {
  const index = state.monsters.indexOf(monster);
  if (index !== -1) state.monsters.splice(index, 1);
}

/* ------------------------------------------------------------------ *
 * 图搜索                                                             *
 * ------------------------------------------------------------------ */

function neighborsOf(state, locationId) {
  const loc = getLocation(state, locationId);
  if (!loc) throw new Error('未知地点：' + locationId);
  return loc.connections;
}

function distanceMap(state, startId) {
  const dist = {};
  dist[startId] = 0;
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const next = dist[id] + 1;
    neighborsOf(state, id).forEach(function (nid) {
      if (dist[nid] === undefined) {
        dist[nid] = next;
        queue.push(nid);
      }
    });
  }
  return dist;
}

function pathToNearest(state, fromId, targetIds) {
  if (targetIds.indexOf(fromId) !== -1) return [fromId];
  const targetSet = {};
  targetIds.forEach(function (id) { targetSet[id] = true; });
  const prev = {};
  const visited = {};
  visited[fromId] = true;
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    const neighbors = neighborsOf(state, id);
    for (let i = 0; i < neighbors.length; i += 1) {
      const nid = neighbors[i];
      if (visited[nid]) continue;
      visited[nid] = true;
      prev[nid] = id;
      if (targetSet[nid]) {
        const path = [nid];
        let cursor = nid;
        while (prev[cursor] !== undefined) {
          cursor = prev[cursor];
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(nid);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 检定后的纯结算辅助（供测试与引擎共用）                             *
 * ------------------------------------------------------------------ */

/**
 * 纯函数：根据战斗骰成功数结算一次攻击。
 * 成功数达到怪物难度即命中；伤害 = 成功数 - 难度 + 1。
 */
export function resolveCombatResult(monster, successes) {
  if (!monster || typeof monster !== 'object') throw new Error('resolveCombatResult 需要怪物');
  if (!Number.isInteger(successes) || successes < 0) throw new Error('成功数必须是非负整数');
  const hit = successes >= monster.difficulty;
  const damage = hit ? successes - monster.difficulty + 1 : 0;
  const remaining = hit ? Math.max(0, monster.health - damage) : monster.health;
  return {
    success: hit,
    damage: damage,
    defeated: hit && remaining <= 0,
    remainingHealth: remaining
  };
}

/* ------------------------------------------------------------------ *
 * 动作执行                                                           *
 * ------------------------------------------------------------------ */

function requireInvestigator(state) {
  if (state.phase !== 'actions') throw new Error('当前不是行动阶段');
  const inv = state.investigators[state.activeInvestigatorIndex] || null;
  if (!inv || !inv.alive) throw new Error('当前没有可行动的调查员');
  return inv;
}

function applyMove(state, inv, action) {
  if (!Array.isArray(action.path) || action.path.length < 2) {
    throw new Error('移动路径至少包含起点和终点');
  }
  const path = action.path;
  if (path[0] !== inv.locationId) throw new Error('移动路径必须从当前地点开始');
  const maxSteps = inv.key === 'silas' ? 2 : 1;
  if (path.length - 1 > maxSteps) {
    throw new Error(inv.displayName + ' 一次最多移动 ' + maxSteps + ' 步');
  }
  for (let i = 0; i < path.length - 1; i += 1) {
    if (neighborsOf(state, path[i]).indexOf(path[i + 1]) === -1) {
      throw new Error('地点 ' + path[i] + ' 与 ' + path[i + 1] + ' 不相邻');
    }
  }
  const from = inv.locationId;
  inv.locationId = path[path.length - 1];
  logEvent(state, 'move', {
    investigator: inv.id,
    from: from,
    to: inv.locationId,
    path: path.slice()
  });
}

function applyResearch(state, inv, action) {
  const mystery = currentMystery(state);
  if (!mystery) throw new Error('所有神秘卡都已完成');
  if (inv.researchedRound === state.round) {
    throw new Error('每名调查员每轮最多研究 1 次');
  }
  inv.researchedRound = state.round;
  const loc = getLocation(state, inv.locationId);
  if (mystery.types.indexOf(loc.type) === -1) {
    throw new Error('当前地点类型（' + loc.type + '）不能研究「' + mystery.name + '」');
  }
  let bonusDice = 0;
  let usedClue = false;
  if (action.useClue) {
    if (inv.clues < 1) throw new Error('没有线索可以消耗');
    inv.clues -= 1;
    bonusDice = 2;
    usedClue = true;
  }
  const test = performTest(state, inv, mystery.attribute, mystery.difficulty, {
    bonusDice: bonusDice,
    reason: 'research'
  });
  let completedNow = false;
  if (test.success) {
    state.mysteryProgress += 1;
    if (state.mysteryProgress >= mystery.required) {
      completeMystery(state, inv);
      completedNow = true;
    }
  } else {
    changeSanity(state, inv, -1);
  }
  logEvent(state, 'research', {
    investigator: inv.id,
    mystery: mystery.id,
    attribute: test.attribute,
    attributeName: test.attributeName,
    pool: test.pool,
    bonusDice: test.bonusDice,
    firstFaces: test.firstFaces || null,
    firstSuccesses: test.firstSuccesses === undefined ? null : test.firstSuccesses,
    difficulty: test.difficulty,
    faces: test.faces,
    successes: test.successes,
    success: test.success,
    rerolled: test.rerolled,
    usedClue: usedClue,
    progress: state.mysteryProgress,
    completedNow: completedNow,
    mysteriesCompleted: state.mysteriesCompleted
  });
}

function completeMystery(state, inv) {
  const mystery = currentMystery(state);
  state.mysteriesCompleted += 1;
  state.mysteryIndex += 1;
  const completedId = mystery.id;
  state.mysteryProgress = 0;
  inv.clues += 1;
  // 每完成一段神秘，古神的反应都会更激烈：在随机门/地点刷 1 只怪物。
  const spawned = spawnMonster(state, state.gates.length
    ? state.gates[drawInt(state, state.gates.length)].locationId
    : null);
  logEvent(state, 'mystery-completed', {
    investigator: inv.id,
    mystery: completedId,
    mysteriesCompleted: state.mysteriesCompleted,
    nextMystery: currentMystery(state) ? currentMystery(state).id : null,
    spawnedMonster: spawned ? spawned.id : null
  });
}

function applyFight(state, inv, action) {
  const monster = findMonster(state, action.target);
  if (!monster) throw new Error('攻击目标不存在或已被击败');
  if (monster.locationId !== inv.locationId) throw new Error('只能与同一地点的怪物战斗');
  const test = performTest(state, inv, monster.fightAttr, monster.difficulty, {
    reason: 'combat'
  });
  const outcome = resolveCombatResult(monster, test.successes);
  if (outcome.success) {
    monster.health = outcome.remainingHealth;
    if (outcome.defeated) {
      removeMonster(state, monster);
      state.stats.monstersDefeated += 1;
      inv.clues += 1;
    }
  } else {
    changeHealth(state, inv, -monster.damage);
    changeSanity(state, inv, -monster.horror);
  }
  logEvent(state, 'fight', {
    investigator: inv.id,
    monster: monster.id,
    monsterName: monster.name,
    attribute: test.attribute,
    attributeName: test.attributeName,
    pool: test.pool,
    firstFaces: test.firstFaces || null,
    firstSuccesses: test.firstSuccesses === undefined ? null : test.firstSuccesses,
    difficulty: test.difficulty,
    faces: test.faces,
    successes: test.successes,
    success: test.success,
    rerolled: test.rerolled,
    damage: outcome.damage,
    defeated: outcome.defeated,
    monsterHealth: monster.health
  });
}

function applyCloseGate(state, inv) {
  const gate = gateAt(state, inv.locationId);
  if (!gate) throw new Error('当前地点没有门');
  const test = performTest(state, inv, 'will', gate.difficulty, { reason: 'close-gate' });
  if (test.success) {
    removeGate(state, gate);
    inv.clues += 1;
    state.stats.gatesClosed += 1;
  } else {
    changeSanity(state, inv, -1);
  }
  logEvent(state, 'gate-closed', {
    investigator: inv.id,
    gate: gate.id,
    location: gate.locationId,
    attribute: test.attribute,
    difficulty: test.difficulty,
    faces: test.faces,
    successes: test.successes,
    success: test.success,
    rerolled: test.rerolled,
    doom: state.doom
  });
}

function applySealGate(state, inv) {
  const gate = gateAt(state, inv.locationId);
  if (!gate) throw new Error('当前地点没有门');
  if (inv.clues < 1) throw new Error('封印门需要消耗 1 个线索');
  inv.clues -= 1;
  const test = performTest(state, inv, 'will', 2, { reason: 'seal-gate' });
  if (test.success) {
    removeGate(state, gate);
    if (state.sealedLocations.indexOf(gate.locationId) === -1) {
      state.sealedLocations.push(gate.locationId);
    }
    state.stats.gatesSealed += 1;
  } else {
    changeSanity(state, inv, -1);
  }
  logEvent(state, 'gate-sealed', {
    investigator: inv.id,
    gate: gate.id,
    location: gate.locationId,
    attribute: test.attribute,
    difficulty: test.difficulty,
    faces: test.faces,
    successes: test.successes,
    success: test.success,
    rerolled: test.rerolled,
    sealed: state.sealedLocations.indexOf(gate.locationId) !== -1,
    doom: state.doom
  });
}

function applyRest(state, inv) {
  const before = { health: inv.health, sanity: inv.sanity };
  changeHealth(state, inv, 1);
  changeSanity(state, inv, 1);
  logEvent(state, 'rest', {
    investigator: inv.id,
    healthBefore: before.health,
    sanityBefore: before.sanity,
    healthAfter: inv.health,
    sanityAfter: inv.sanity
  });
}

function applyInvestigatorAction(state, action) {
  const inv = requireInvestigator(state);
  if (action.actor && action.actor !== inv.id) throw new Error('不是该调查员的行动轮');
  if (inv.actionsLeft <= 0) throw new Error('该调查员没有剩余行动');

  if (action.type === 'endTurn') {
    inv.actionsLeft = 0;
    logEvent(state, 'end-turn', { investigator: inv.id });
    advanceInvestigator(state);
    return;
  }

  switch (action.type) {
    case 'move':
      applyMove(state, inv, action);
      break;
    case 'research':
      applyResearch(state, inv, action);
      break;
    case 'fight':
      applyFight(state, inv, action);
      break;
    case 'closeGate':
      applyCloseGate(state, inv);
      break;
    case 'sealGate':
      applySealGate(state, inv);
      break;
    case 'rest':
      applyRest(state, inv);
      break;
    default:
      throw new Error('未知调查员动作：' + action.type);
  }

  inv.actionsLeft -= 1;
  if (!inv.alive || inv.actionsLeft <= 0) advanceInvestigator(state);
}

function advanceInvestigator(state) {
  const start = state.activeInvestigatorIndex + 1;
  for (let i = start; i < state.investigators.length; i += 1) {
    if (state.investigators[i].alive) {
      state.activeInvestigatorIndex = i;
      state.investigators[i].actionsLeft = ACTIONS_PER_TURN;
      state.phase = 'actions';
      logEvent(state, 'investigator-activated', {
        investigator: state.investigators[i].id,
        actionsLeft: ACTIONS_PER_TURN
      });
      return;
    }
  }
  beginEncounters(state);
}

function beginEncounters(state) {
  state.encounterIndex = -1;
  advanceEncounter(state);
}

function advanceEncounter(state) {
  for (let i = state.encounterIndex + 1; i < state.investigators.length; i += 1) {
    if (state.investigators[i].alive) {
      state.encounterIndex = i;
      state.phase = 'encounters';
      logEvent(state, 'encounter-turn', {
        investigator: state.investigators[i].id,
        location: state.investigators[i].locationId
      });
      return;
    }
  }
  state.encounterIndex = -1;
  state.phase = 'mythos';
  logEvent(state, 'mythos-phase', { round: state.round });
}

function drawCard(state, deckKey) {
  if (!state.decks[deckKey]) throw new Error('未知牌堆：' + deckKey);
  if (!state.decks[deckKey].length) {
    const fresh = deckKey === 'mythos'
      ? MYTHOS_CARDS.map(function (card) { return card.id; })
      : ENCOUNTER_SETS[deckKey].map(function (card) { return card.id; });
    state.decks[deckKey] = shuffleInPlace(state, fresh);
    logEvent(state, 'deck-reshuffled', { deck: deckKey });
  }
  return state.decks[deckKey].shift();
}

function applyEncounter(state) {
  if (state.phase !== 'encounters') throw new Error('当前不是遭遇阶段');
  const inv = state.investigators[state.encounterIndex];
  if (!inv || !inv.alive) throw new Error('当前没有可进行遭遇的调查员');
  const loc = getLocation(state, inv.locationId);
  const cardId = drawCard(state, loc.type);
  const card = ENCOUNTER_INDEX[cardId];
  if (!card) throw new Error('遭遇牌不存在：' + cardId);
  const test = performTest(state, inv, card.attribute, card.difficulty, {
    reason: 'encounter:' + card.id
  });
  const effect = test.success ? card.success : card.fail;
  applyEffect(state, inv, effect, inv.locationId, card.id);
  logEvent(state, 'encounter', {
    investigator: inv.id,
    location: inv.locationId,
    locationType: loc.type,
    card: card.id,
    cardName: card.name,
    cardType: card.type,
    attribute: test.attribute,
    difficulty: test.difficulty,
    faces: test.faces,
    successes: test.successes,
    success: test.success,
    rerolled: test.rerolled,
    effect: effect
  });
  advanceEncounter(state);
}

function monstersActivate(state) {
  const aliveMonsters = state.monsters.filter(function (monster) { return monster.health > 0; });
  const attackedThisRound = {};
  for (let i = 0; i < aliveMonsters.length; i += 1) {
    const monster = aliveMonsters[i];
    const alive = aliveInvestigators(state);
    if (!alive.length) return;
    const targets = alive.map(function (inv) { return inv.locationId; });
    if (targets.indexOf(monster.locationId) !== -1) {
      // 本版简化：同一神秘阶段内，同一调查员最多被 1 只怪物攻击，
      // 避免多只怪物同格时瞬间造成无法反应的连锁减员。
      const victim = alive.find(function (inv) {
        return inv.locationId === monster.locationId && !attackedThisRound[inv.id];
      });
      if (!victim) continue;
      attackedThisRound[victim.id] = true;
      changeHealth(state, victim, -monster.damage);
      changeSanity(state, victim, -monster.horror);
      logEvent(state, 'monster-attack', {
        monster: monster.id,
        monsterName: monster.name,
        investigator: victim.id,
        location: monster.locationId,
        healthDamage: monster.damage,
        sanityDamage: monster.horror
      });
      if (!victim.alive) continue;
    } else {
      const path = pathToNearest(state, monster.locationId, targets);
      if (path && path.length > 1) {
        const from = monster.locationId;
        monster.locationId = path[1];
        logEvent(state, 'monster-move', {
          monster: monster.id,
          from: from,
          to: monster.locationId
        });
      }
    }
  }
}

function endRound(state) {
  if (state.round >= state.maxRounds) {
    endGame(state, 'azathoth', 'round-limit');
    return;
  }
  state.round += 1;
  state.phase = 'actions';
  state.encounterIndex = -1;
  state.activeInvestigatorIndex = -1;
  state.investigators.forEach(function (inv) {
    if (inv.alive) inv.actionsLeft = ACTIONS_PER_TURN;
  });
  for (let i = 0; i < state.investigators.length; i += 1) {
    if (state.investigators[i].alive) {
      state.activeInvestigatorIndex = i;
      break;
    }
  }
  if (state.activeInvestigatorIndex === -1) {
    endGame(state, 'azathoth', 'all-investigators-defeated');
    return;
  }
  logEvent(state, 'round-start', {
    round: state.round,
    activeInvestigator: state.investigators[state.activeInvestigatorIndex].id
  });
}

function applyMythos(state) {
  if (state.phase !== 'mythos') throw new Error('当前不是神秘阶段');
  const cardId = drawCard(state, 'mythos');
  const card = MYTHOS_INDEX[cardId];
  if (!card) throw new Error('神话卡不存在：' + cardId);

  changeDoom(state, -(card.doom || 1));
  if (card.extraDoomIfGates && state.gates.length >= card.extraDoomIfGates.threshold) {
    changeDoom(state, -card.extraDoomIfGates.amount);
    logEvent(state, 'extra-doom', {
      card: card.id,
      gates: state.gates.length,
      amount: card.extraDoomIfGates.amount
    });
  }
  if (card.gate) spawnGate(state);
  if (card.monster) spawnMonster(state, null);
  if (card.clue) {
    const alive = aliveInvestigators(state);
    if (alive.length) {
      let chosen = alive[0];
      alive.forEach(function (inv) {
        if (inv.clues < chosen.clues) chosen = inv;
      });
      chosen.clues += 1;
      logEvent(state, 'mythos-clue', { investigator: chosen.id, clues: chosen.clues });
    }
  }
  if (card.sanity) {
    aliveInvestigators(state).slice().forEach(function (inv) {
      changeSanity(state, inv, -card.sanity);
    });
  }

  logEvent(state, 'mythos', {
    card: card.id,
    cardName: card.name,
    doom: state.doom,
    gates: state.gates.length,
    monsters: state.monsters.filter(function (m) { return m.health > 0; }).length
  });

  if (checkEnd(state)) return;
  monstersActivate(state);
  if (checkEnd(state)) return;
  endRound(state);
}

function endGame(state, winner, reason) {
  if (state.over) return;
  state.over = true;
  state.winner = winner;
  state.endReason = reason;
  state.phase = 'ended';
  state.activeInvestigatorIndex = -1;
  state.encounterIndex = -1;
  logEvent(state, 'game-over', {
    winner: winner,
    reason: reason,
    round: state.round,
    doom: state.doom,
    mysteriesCompleted: state.mysteriesCompleted
  });
}

function checkEnd(state) {
  if (state.over) return true;
  if (state.mysteriesCompleted >= MYSTERIES.length) {
    endGame(state, 'investigators', 'mysteries-complete');
    return true;
  }
  if (state.doom <= 0) {
    endGame(state, 'azathoth', 'doom-zero');
    return true;
  }
  if (aliveInvestigators(state).length === 0) {
    endGame(state, 'azathoth', 'all-investigators-defeated');
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 合法动作                                                           *
 * ------------------------------------------------------------------ */

function movePathsFor(state, inv) {
  const maxSteps = inv.key === 'silas' ? 2 : 1;
  const paths = [];
  const first = neighborsOf(state, inv.locationId);
  first.forEach(function (nid) {
    paths.push([inv.locationId, nid]);
  });
  if (maxSteps >= 2) {
    first.forEach(function (nid) {
      neighborsOf(state, nid).forEach(function (nid2) {
        if (nid2 !== inv.locationId && nid2 !== nid) {
          paths.push([inv.locationId, nid, nid2]);
        }
      });
    });
  }
  return paths;
}

function investigatorLegalActions(state, inv) {
  const actions = [];
  const loc = getLocation(state, inv.locationId);
  const mystery = currentMystery(state);

  if (mystery && mystery.types.indexOf(loc.type) !== -1 && inv.researchedRound !== state.round) {
    actions.push({ type: 'research', actor: inv.id });
    if (inv.clues > 0) actions.push({ type: 'research', actor: inv.id, useClue: true });
  }

  const gate = gateAt(state, inv.locationId);
  if (gate) {
    actions.push({ type: 'closeGate', actor: inv.id, target: gate.id });
    if (inv.clues > 0) actions.push({ type: 'sealGate', actor: inv.id, target: gate.id });
  }

  monstersAt(state, inv.locationId).forEach(function (monster) {
    actions.push({ type: 'fight', actor: inv.id, target: monster.id });
  });

  movePathsFor(state, inv).forEach(function (path) {
    actions.push({ type: 'move', actor: inv.id, path: path });
  });

  actions.push({ type: 'rest', actor: inv.id });
  actions.push({ type: 'endTurn', actor: inv.id });
  return actions;
}

export function currentActor(state) {
  if (!state || state.over) return null;
  if (state.phase === 'actions') {
    const inv = state.investigators[state.activeInvestigatorIndex];
    return inv && inv.alive ? inv.id : null;
  }
  if (state.phase === 'encounters') {
    const inv = state.investigators[state.encounterIndex];
    return inv && inv.alive ? inv.id : null;
  }
  if (state.phase === 'mythos') return 'mythos';
  return null;
}

export function legalActions(state, actor) {
  if (!state || state.over) return [];
  const current = currentActor(state);
  if (!actor) actor = current;

  if (state.phase === 'actions') {
    if (actor !== current) return [];
    const inv = state.investigators[state.activeInvestigatorIndex];
    if (!inv || !inv.alive || inv.actionsLeft <= 0) return [];
    return investigatorLegalActions(state, inv);
  }
  if (state.phase === 'encounters') {
    if (actor !== current) return [];
    return [{ type: 'encounter', actor: actor }];
  }
  if (state.phase === 'mythos') {
    if (actor !== 'mythos') return [];
    return [{ type: 'mythos' }];
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * applyAction                                                        *
 * ------------------------------------------------------------------ */

export function applyAction(state, action) {
  if (!state) throw new Error('缺少对局状态');
  if (state.over) throw new Error('对局已结束');
  if (!action || typeof action.type !== 'string') throw new Error('动作缺少 type');

  const next = clone(state);

  if (next.phase === 'actions') {
    applyInvestigatorAction(next, action);
  } else if (next.phase === 'encounters') {
    if (action.type !== 'encounter') throw new Error('遭遇阶段只能执行 encounter');
    applyEncounter(next);
  } else if (next.phase === 'mythos') {
    if (action.type !== 'mythos') throw new Error('神秘阶段只能执行 mythos');
    applyMythos(next);
  } else {
    throw new Error('当前阶段不能行动：' + next.phase);
  }

  next.actionCount += 1;
  if (!next.over) checkEnd(next);
  return next;
}

/* ------------------------------------------------------------------ *
 * AI                                                                 *
 * ------------------------------------------------------------------ */

function minDistance(state, startId, targetSet) {
  const dist = distanceMap(state, startId);
  let best = Infinity;
  targetSet.forEach(function (id) {
    if (dist[id] !== undefined && dist[id] < best) best = dist[id];
  });
  return best;
}

function mysteryTargets(state, mystery) {
  if (!mystery) return [];
  return state.locations.filter(function (loc) {
    return mystery.types.indexOf(loc.type) !== -1;
  }).map(function (loc) { return loc.id; });
}

function gateLocationIds(state) {
  return state.gates.map(function (gate) { return gate.locationId; });
}

function monsterLocationIds(state) {
  return state.monsters.filter(function (m) { return m.health > 0; })
    .map(function (m) { return m.locationId; });
}

function scoreMove(state, inv, action) {
  const from = inv.locationId;
  const to = action.path[action.path.length - 1];
  const mystery = currentMystery(state);
  let score = action.path.length - 1; // 同一动作内多走一步是额外收益
  if (mystery) {
    const targets = mysteryTargets(state, mystery);
    const fromD = minDistance(state, from, targets);
    const toD = minDistance(state, to, targets);
    if (Number.isFinite(fromD) && Number.isFinite(toD)) score += (fromD - toD) * 12;
    const destLoc = getLocation(state, to);
    if (mystery.types.indexOf(destLoc.type) !== -1) score += 40;
  }
  const gateTargets = gateLocationIds(state);
  if (gateTargets.length) {
    const fromG = minDistance(state, from, gateTargets);
    const toG = minDistance(state, to, gateTargets);
    if (Number.isFinite(fromG) && Number.isFinite(toG)) score += (fromG - toG) * 6;
    if (gateTargets.indexOf(to) !== -1) score += 20;
  }
  const monsterTargets = monsterLocationIds(state);
  if (monsterTargets.length) {
    const fromM = minDistance(state, from, monsterTargets);
    const toM = minDistance(state, to, monsterTargets);
    if (Number.isFinite(fromM) && Number.isFinite(toM)) score += (fromM - toM) * 3;
    if (monsterTargets.indexOf(to) !== -1) score += 10;
  }
  return score;
}

function scoreAction(state, inv, action) {
  const doomPressure = state.maxDoom - state.doom;
  switch (action.type) {
    case 'research': {
      const mystery = currentMystery(state);
      if (!mystery) return -1;
      let score = 130;
      if (state.mysteryProgress + 1 >= mystery.required) score += 150;
      if (action.useClue) {
        if (inv.attributes[mystery.attribute] <= 2 || mystery.difficulty >= 2) score += 20;
        else score -= 25;
      }
      return score;
    }
    case 'closeGate':
      return 70 + doomPressure * 6;
    case 'sealGate':
      return 80 + doomPressure * 5 + (inv.clues > 1 ? 10 : -5);
    case 'fight': {
      const monster = findMonster(state, action.target);
      if (!monster) return -1;
      let score = 60;
      if (monster.health === 1) score += 15;
      if (inv.attributes[monster.fightAttr] >= monster.difficulty + 1) score += 10;
      if (inv.health <= 2 || inv.sanity <= 2) score -= 40;
      if (monster.horror >= 2) score -= 10;
      return score;
    }
    case 'rest': {
      let score = 5;
      score += (inv.maxHealth - inv.health) * 10;
      score += (inv.maxSanity - inv.sanity) * 10;
      if (inv.health <= 2 || inv.sanity <= 2) score += 60;
      return score;
    }
    case 'move':
      return scoreMove(state, inv, action);
    case 'endTurn':
      return 0;
    default:
      return -1;
  }
}

export function chooseAIAction(state, actor, actions) {
  const current = actor || currentActor(state);
  let list = actions;
  if (!list) list = legalActions(state, current);
  if (!list.length) throw new Error('当前没有合法动作');

  if (state.phase === 'encounters' || state.phase === 'mythos') return clone(list[0]);
  const inv = getInvestigator(state, current);
  if (!inv) throw new Error('未知调查员：' + current);

  let best = list[0];
  let bestScore = -Infinity;
  list.forEach(function (action) {
    const score = scoreAction(state, inv, action);
    if (score > bestScore) {
      bestScore = score;
      best = action;
    }
  });
  return clone(best);
}

export function runSelfPlay(options) {
  const opts = options || {};
  let state = createGame(opts);
  const limit = opts.maxActions || 6000;
  let steps = 0;
  while (!state.over && steps < limit) {
    const actor = currentActor(state);
    const actions = legalActions(state, actor);
    if (!actions.length) throw new Error('自对弈卡住：' + actor + ' 没有合法动作');
    const action = chooseAIAction(state, actor, actions);
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

function makeInvestigator(template, index) {
  const locationId = START_LOCATIONS[template.key];
  return {
    id: 'inv' + (index + 1),
    key: template.key,
    name: template.name,
    title: template.title,
    displayName: template.title + '·' + template.name,
    locationId: locationId,
    attributes: clone(template.attributes),
    health: template.health,
    maxHealth: template.health,
    sanity: template.sanity,
    maxSanity: template.sanity,
    clues: 0,
    actionsLeft: ACTIONS_PER_TURN,
    alive: true,
    ability: clone(template.ability),
    abilityUsedRound: null,
    researchedRound: null
  };
}

export function createGame(options) {
  const opts = options || {};
  const seed = opts.seed === undefined || opts.seed === null ? DEFAULT_SEED : String(opts.seed);
  const keys = Array.isArray(opts.investigators) ? opts.investigators.slice() : DEFAULT_INVESTIGATORS.slice();
  if (keys.length < 1 || keys.length > 4) throw new Error('调查员数量必须是 1-4');
  keys.forEach(function (key) {
    if (!INVESTIGATOR_TEMPLATES[key]) throw new Error('未知调查员：' + key);
  });
  const maxRounds = opts.maxRounds === undefined ? MAX_ROUNDS : opts.maxRounds;
  if (!Number.isInteger(maxRounds) || maxRounds < 1) throw new Error('maxRounds 必须是正整数');
  const ancient = ANCIENT_ONES[opts.ancientOne || 'azathoth'];
  if (!ancient) throw new Error('未知古神：' + opts.ancientOne);

  const state = {
    engine: 'eldritch-horror-premium',
    version: VERSION,
    seed: seed,
    rngState: seedToInt(seed),
    round: 1,
    maxRounds: maxRounds,
    phase: 'actions',
    activeInvestigatorIndex: -1,
    encounterIndex: -1,
    actionCount: 0,
    ancientOne: {
      id: ancient.id,
      name: ancient.name,
      title: ancient.title,
      awakening: ancient.awakening
    },
    doom: ancient.doom,
    maxDoom: ancient.doom,
    investigators: [],
    locations: buildLocations(),
    gates: [],
    sealedLocations: [],
    monsters: [],
    decks: { city: [], wilderness: [], sea: [], mythos: [] },
    mysteryIndex: 0,
    mysteryProgress: 0,
    mysteriesCompleted: 0,
    nextGateId: 1,
    nextMonsterId: 1,
    stats: {
      testsPassed: 0,
      testsFailed: 0,
      monstersDefeated: 0,
      gatesClosed: 0,
      gatesSealed: 0
    },
    over: false,
    winner: null,
    endReason: null,
    log: []
  };

  keys.forEach(function (key, index) {
    state.investigators.push(makeInvestigator(INVESTIGATOR_TEMPLATES[key], index));
  });

  ['city', 'wilderness', 'sea'].forEach(function (deckKey) {
    const ids = ENCOUNTER_SETS[deckKey].map(function (card) { return card.id; });
    state.decks[deckKey] = shuffleInPlace(state, ids);
  });
  state.decks.mythos = shuffleInPlace(state, MYTHOS_CARDS.map(function (card) { return card.id; }));

  // 开局压力：1 道门 + 1 只守门怪物。
  spawnGate(state);
  spawnMonster(state, state.gates.length ? state.gates[0].locationId : null);

  state.activeInvestigatorIndex = 0;
  state.investigators.forEach(function (inv) { inv.actionsLeft = ACTIONS_PER_TURN; });

  logEvent(state, 'game-start', {
    seed: seed,
    ancientOne: state.ancientOne.id,
    doom: state.doom,
    maxRounds: state.maxRounds,
    investigators: state.investigators.map(function (inv) {
      return {
        id: inv.id,
        key: inv.key,
        name: inv.displayName,
        location: inv.locationId
      };
    }),
    gate: state.gates.length ? state.gates[0].locationId : null,
    monster: state.monsters.length ? state.monsters[0].id : null
  });

  return state;
}

export function isOver(state) {
  return !!(state && state.over);
}

export function result(state) {
  if (!state) throw new Error('缺少对局状态');
  const mystery = currentMystery(state);
  return {
    over: !!state.over,
    winner: state.winner || null,
    reason: state.endReason || null,
    round: state.round,
    maxRounds: state.maxRounds,
    ancientOne: {
      id: state.ancientOne.id,
      name: state.ancientOne.name,
      doom: state.doom,
      maxDoom: state.maxDoom
    },
    mystery: mystery ? {
      id: mystery.id,
      name: mystery.name,
      attribute: mystery.attribute,
      difficulty: mystery.difficulty,
      required: mystery.required,
      progress: state.mysteryProgress
    } : null,
    mysteriesCompleted: state.mysteriesCompleted,
    investigators: state.investigators.map(function (inv) {
      return {
        id: inv.id,
        key: inv.key,
        name: inv.displayName,
        alive: inv.alive,
        health: inv.health,
        maxHealth: inv.maxHealth,
        sanity: inv.sanity,
        maxSanity: inv.maxSanity,
        clues: inv.clues,
        location: inv.locationId
      };
    }),
    gates: state.gates.map(function (gate) {
      return { id: gate.id, location: gate.locationId, difficulty: gate.difficulty };
    }),
    sealedLocations: state.sealedLocations.slice(),
    monsters: state.monsters.filter(function (m) { return m.health > 0; }).map(function (m) {
      return {
        id: m.id,
        type: m.type,
        name: m.name,
        location: m.locationId,
        health: m.health
      };
    }),
    actions: state.actionCount,
    stats: clone(state.stats),
    logLength: state.log.length
  };
}

/* ------------------------------------------------------------------ *
 * 计分与状态摘要                                                     *
 * ------------------------------------------------------------------ */

export function score(state) {
  if (!state) throw new Error('缺少对局状态');
  const alive = aliveInvestigators(state);
  const clues = alive.reduce(function (sum, inv) { return sum + inv.clues; }, 0);
  const mystery = currentMystery(state);
  const progressTotal = state.mysteriesCompleted * 100
    + state.mysteryProgress * 10
    + clues
    + state.stats.gatesSealed * 15
    + state.stats.monstersDefeated * 5
    - state.doom;
  return {
    version: VERSION,
    over: !!state.over,
    winner: state.winner || null,
    reason: state.endReason || null,
    rounds: state.round,
    doom: state.doom,
    maxDoom: state.maxDoom,
    mysteriesCompleted: state.mysteriesCompleted,
    mysteryProgress: state.mysteryProgress,
    mysteryRequired: mystery ? mystery.required : 0,
    investigatorsAlive: alive.length,
    clues: clues,
    gatesOpen: state.gates.length,
    gatesClosed: state.stats.gatesClosed,
    gatesSealed: state.stats.gatesSealed,
    monstersDefeated: state.stats.monstersDefeated,
    tests: { passed: state.stats.testsPassed, failed: state.stats.testsFailed },
    total: progressTotal
  };
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
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

export default Object.freeze({
  VERSION: VERSION,
  DEFAULT_SEED: DEFAULT_SEED,
  MAX_ROUNDS: MAX_ROUNDS,
  ACTIONS_PER_TURN: ACTIONS_PER_TURN,
  MAX_MONSTERS: MAX_MONSTERS,
  MAX_GATES: MAX_GATES,
  ATTRIBUTE_NAMES: ATTRIBUTE_NAMES,
  INVESTIGATOR_TEMPLATES: INVESTIGATOR_TEMPLATES,
  MAP: MAP,
  MYSTERIES: MYSTERIES,
  ANCIENT_ONES: ANCIENT_ONES,
  ENCOUNTER_CARDS: ENCOUNTER_CARDS,
  ENCOUNTER_SETS: ENCOUNTER_SETS,
  MYTHOS_CARDS: MYTHOS_CARDS,
  MONSTER_TYPES: MONSTER_TYPES,
  createGame: createGame,
  legalActions: legalActions,
  applyAction: applyAction,
  currentActor: currentActor,
  isOver: isOver,
  result: result,
  score: score,
  hashState: hashState,
  stableStringify: stableStringify,
  resolveDicePool: resolveDicePool,
  resolveCombatResult: resolveCombatResult,
  chooseAIAction: chooseAIAction,
  runSelfPlay: runSelfPlay,
  getInvestigator: getInvestigator,
  getLocation: getLocation,
  aliveInvestigators: aliveInvestigators
});
