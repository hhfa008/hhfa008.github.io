'use strict';

/*
 * 麻将引擎（纯逻辑、无 DOM、无第三方依赖）。
 *
 * - 136 张牌：万/筒/索 1–9 各 4 张，字牌东南西北中发白各 4 张。
 * - 4 人：庄家 14 张，其余 13 张；摸牌 → 出牌 → 下家摸牌。
 * - 副露：吃（只能吃上家）、碰、明杠；暗杠/加杠/抢杠未实现。
 * - 和牌：4 面子 + 1 将、七对、十三幺；支持自摸与点炮。
 * - 番种：平和 1、碰碰和 2、清一色 2、字一色 4、七对 2、门清 1，
 *   十三幺 5（额外保留）。番数可叠加；底分 100，每番 +100。
 * - 所有随机数来自 seed（mulberry32），不使用 Math.random；同 seed 同一副牌山。
 */

export const TILE_KINDS = [
  '1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m',
  '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p',
  '1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s',
  '1z', '2z', '3z', '4z', '5z', '6z', '7z'
];

export const HONOR_NAMES = {
  '1z': '东', '2z': '南', '3z': '西', '4z': '北',
  '5z': '中', '6z': '发', '7z': '白'
};

const SUIT_OFFSET = { m: 0, p: 9, s: 18, z: 27 };
const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
const ASSET_PREFIX = { m: 'wan', p: 'tong', s: 'tiao' };
const WIN_BASE = 100;
const FAN_VALUE = 100;

export function parseTile(code) {
  if (typeof code !== 'string' || code.length !== 2) return null;
  const rank = Number(code[0]);
  const suit = code[1];
  if (!Number.isInteger(rank) || rank < 1 || rank > 9) return null;
  if (suit === 'm' || suit === 'p' || suit === 's') return { suit: suit, rank: rank };
  if (suit === 'z' && rank >= 1 && rank <= 7) return { suit: 'z', rank: rank };
  return null;
}

export function tileLabel(code) {
  const parsed = parseTile(code);
  if (!parsed) return String(code);
  if (parsed.suit === 'z') return HONOR_NAMES[code] || code;
  return code[0] + (parsed.suit === 'm' ? '万' : parsed.suit === 'p' ? '筒' : '索');
}

/** 34 种牌面 PNG 的文件名（相对 assets/cardart/mahjong/）。 */
export function tileAsset(code) {
  const parsed = parseTile(code);
  if (!parsed) return null;
  if (parsed.suit === 'z') {
    return parsed.rank <= 4
      ? 'wind-' + parsed.rank + '.png'
      : 'dragon-' + (parsed.rank - 4) + '.png';
  }
  return ASSET_PREFIX[parsed.suit] + '-' + parsed.rank + '.png';
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWall(seed) {
  const wall = [];
  for (let copy = 0; copy < 4; copy += 1) {
    TILE_KINDS.forEach(function (tile) { wall.push(tile); });
  }
  const rng = makeRng(Number.isFinite(seed) ? seed : 1);
  for (let i = wall.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = wall[i];
    wall[i] = wall[j];
    wall[j] = tmp;
  }
  return wall;
}

function tileIndex(code) {
  const parsed = parseTile(code);
  if (!parsed) return -1;
  return SUIT_OFFSET[parsed.suit] + parsed.rank - 1;
}

function indexToTile(index) {
  if (index < 9) return (index + 1) + 'm';
  if (index < 18) return (index - 9 + 1) + 'p';
  if (index < 27) return (index - 18 + 1) + 's';
  return (index - 27 + 1) + 'z';
}

export function countsFromHand(hand) {
  const counts = new Array(34).fill(0);
  (hand || []).forEach(function (code) {
    const index = tileIndex(code);
    if (index >= 0) counts[index] += 1;
  });
  return counts;
}

function countOf(hand, tile) {
  let n = 0;
  for (let i = 0; i < hand.length; i += 1) if (hand[i] === tile) n += 1;
  return n;
}

function meldCountOf(state, player) {
  return state && state.melds && Array.isArray(state.melds[player]) ? state.melds[player].length : 0;
}

function expectedConcealed(meldCount) {
  return 14 - meldCount * 3;
}

// 从第一个非零牌开始拆面子：它只能是刻子，或以它开头的顺子。
function decompose(counts, groupsLeft, melds, out) {
  if (out.length >= 32) return;
  if (groupsLeft === 0) {
    if (counts.every(function (n) { return n === 0; })) out.push(melds.slice());
    return;
  }
  let first = -1;
  for (let i = 0; i < 34; i += 1) {
    if (counts[i] > 0) { first = i; break; }
  }
  if (first === -1) return;

  if (counts[first] >= 3) {
    counts[first] -= 3;
    melds.push({ type: 'triplet', tile: indexToTile(first) });
    decompose(counts, groupsLeft - 1, melds, out);
    melds.pop();
    counts[first] += 3;
  }
  if (first < 27 && (first % 9) <= 6 && counts[first + 1] > 0 && counts[first + 2] > 0) {
    counts[first] -= 1;
    counts[first + 1] -= 1;
    counts[first + 2] -= 1;
    melds.push({ type: 'sequence', tiles: [indexToTile(first), indexToTile(first + 1), indexToTile(first + 2)] });
    decompose(counts, groupsLeft - 1, melds, out);
    melds.pop();
    counts[first] += 1;
    counts[first + 1] += 1;
    counts[first + 2] += 1;
  }
}

function normalizeMelds(melds) {
  if (melds == null) return [];
  // 兼容旧调用 evaluateHand(hand, {tsumo:true})：非数组的第二参数视为选项，忽略。
  if (!Array.isArray(melds)) {
    if (melds && typeof melds === 'object' && Array.isArray(melds.melds)) {
      return normalizeMelds(melds.melds);
    }
    return [];
  }
  const out = [];
  for (let i = 0; i < melds.length; i += 1) {
    const meld = melds[i];
    if (!meld || !Array.isArray(meld.tiles)) return null;
    if (meld.type !== 'chi' && meld.type !== 'pong' && meld.type !== 'kong') return null;
    if (meld.type === 'chi' && meld.tiles.length !== 3) return null;
    if (meld.type === 'pong' && meld.tiles.length !== 3) return null;
    if (meld.type === 'kong' && meld.tiles.length !== 4) return null;
    if (meld.tiles.some(function (tile) { return !parseTile(tile); })) return null;
    out.push({
      type: meld.type,
      tiles: meld.tiles.slice(),
      from: meld.from == null ? null : meld.from
    });
  }
  return out;
}

function allTilesOf(hand, melds) {
  let all = hand.slice();
  melds.forEach(function (meld) { all = all.concat(meld.tiles); });
  return all;
}

function isCleanSuit(tiles) {
  const suits = new Set();
  for (let i = 0; i < tiles.length; i += 1) {
    const parsed = parseTile(tiles[i]);
    if (!parsed || parsed.suit === 'z') return false;
    suits.add(parsed.suit);
  }
  return suits.size === 1;
}

function isAllHonors(tiles) {
  if (!tiles.length) return false;
  for (let i = 0; i < tiles.length; i += 1) {
    const parsed = parseTile(tiles[i]);
    if (!parsed || parsed.suit !== 'z') return false;
  }
  return true;
}

function isSevenPairs(counts) {
  let pairs = 0;
  for (let i = 0; i < counts.length; i += 1) {
    if (counts[i] % 2 !== 0) return false;
    pairs += counts[i] / 2;
  }
  return pairs === 7;
}

function isThirteenOrphans(counts) {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < counts.length; i += 1) {
    total += counts[i];
    if (counts[i] > 2) return false;
    if (counts[i] === 2) pairs += 1;
  }
  if (total !== 14 || pairs !== 1) return false;
  return ORPHANS.every(function (index) { return counts[index] === 1 || counts[index] === 2; });
}

function fanResult(basePatterns, baseFan, tiles, closed, extra) {
  const patterns = basePatterns.slice();
  let fan = baseFan;
  if (isCleanSuit(tiles)) { patterns.push('清一色'); fan += 2; }
  if (isAllHonors(tiles)) { patterns.push('字一色'); fan += 4; }
  if (closed) { patterns.push('门清'); fan += 1; }
  return Object.assign({
    win: true,
    fan: fan,
    points: WIN_BASE + fan * FAN_VALUE,
    patterns: patterns
  }, extra || {});
}

/**
 * 判定一手牌是否和牌。
 * hand 为暗手（含刚摸/刚吃碰杠补的牌）；melds 为副露数组。
 * 暗手张数必须等于 14 - 3 × 副露数（杠按 3 张结构牌计）。
 */
export function evaluateHand(hand, melds) {
  const exposed = normalizeMelds(melds);
  const empty = { win: false, fan: 0, points: 0, patterns: [], melds: 0, pair: null, decomposition: null };
  if (!Array.isArray(hand) || !exposed) return empty;
  if (hand.some(function (tile) { return !parseTile(tile); })) return empty;
  if (hand.length !== expectedConcealed(exposed.length)) return empty;

  const combined = countsFromHand(allTilesOf(hand, exposed));
  if (combined.some(function (n) { return n > 4; })) return empty;
  const counts = countsFromHand(hand);
  const tiles = allTilesOf(hand, exposed);
  const closed = exposed.length === 0;

  if (closed && isThirteenOrphans(counts)) {
    // 十三幺本身是门清限定牌型，5 番已含门清，不再额外叠加。
    return {
      win: true,
      fan: 5,
      points: WIN_BASE + 5 * FAN_VALUE,
      patterns: ['十三幺'],
      melds: 0,
      pair: null,
      decomposition: null
    };
  }
  if (closed && isSevenPairs(counts)) {
    return fanResult(['七对'], 2, tiles, true, {
      melds: 7,
      pair: null,
      decomposition: null
    });
  }

  if (exposed.length > 4) return empty;
  const groupsNeeded = 4 - exposed.length;
  const decompositions = [];
  for (let i = 0; i < 34; i += 1) {
    if (counts[i] < 2) continue;
    counts[i] -= 2;
    const meldsOut = [];
    decompose(counts, groupsNeeded, meldsOut, decompositions);
    counts[i] += 2;
  }
  if (!decompositions.length) return empty;

  let allSequences = exposed.every(function (meld) { return meld.type === 'chi'; });
  let allTriplets = exposed.every(function (meld) { return meld.type === 'pong' || meld.type === 'kong'; });
  for (let d = 0; d < decompositions.length; d += 1) {
    const dec = decompositions[d];
    if (!dec.every(function (m) { return m.type === 'sequence'; })) allSequences = false;
    if (!dec.every(function (m) { return m.type === 'triplet'; })) allTriplets = false;
  }

  let basePatterns;
  let baseFan;
  if (allSequences) {
    basePatterns = ['平和'];
    baseFan = 1;
  } else if (allTriplets) {
    basePatterns = ['碰碰和'];
    baseFan = 2;
  } else {
    // 标准型和牌但既非全顺也非全刻：保底「底和」1 番。
    basePatterns = ['底和'];
    baseFan = 1;
  }

  return fanResult(basePatterns, baseFan, tiles, closed, {
    melds: 4,
    pair: null,
    decomposition: decompositions[0]
  });
}

export function canWin(hand, melds) {
  return evaluateHand(hand, melds).win;
}

/* ---------- 牌局状态 ---------- */

function newRoundState(seed, dealer, wall) {
  const hands = [[], [], [], []];
  let wallIndex = 0;
  for (let round = 0; round < 13; round += 1) {
    for (let p = 0; p < 4; p += 1) {
      hands[p].push(wall[wallIndex]);
      wallIndex += 1;
    }
  }
  const dealerTile = wall[wallIndex];
  hands[dealer].push(dealerTile);
  wallIndex += 1;
  return {
    seed: seed,
    wall: wall,
    wallIndex: wallIndex,
    hands: hands,
    rivers: [[], [], [], []],
    melds: [[], [], [], []],
    dealer: dealer,
    currentPlayer: dealer,
    phase: 'discard',
    lastDiscard: null,
    lastDrawn: { player: dealer, tile: dealerTile },
    claimOffers: [],
    claimIndex: 0,
    winner: null,
    result: null,
    turn: 0,
    log: []
  };
}

export function createGame(opts) {
  const options = opts || {};
  const seed = Number.isFinite(options.seed) ? options.seed >>> 0 : 1;
  const dealer = Number.isInteger(options.dealer) ? ((options.dealer % 4) + 4) % 4 : 0;
  const state = newRoundState(seed, dealer, buildWall(seed));
  state.log.push({ text: '开局，庄家 ' + (dealer + 1) + ' 号位，牌山剩余 ' + (state.wall.length - state.wallIndex) + ' 张。' });
  return state;
}

export function startRound(state) {
  if (!state) return null;
  const seed = Number.isFinite(state.seed) ? state.seed >>> 0 : 1;
  const fresh = newRoundState(seed, state.dealer || 0, buildWall(seed));
  Object.keys(fresh).forEach(function (key) { state[key] = fresh[key]; });
  return state;
}

function nextSeat(player) {
  return (player + 1) % 4;
}

export function draw(state, playerIndex) {
  if (!state || state.phase === 'ended' || state.phase === 'claim') return null;
  const player = Number.isInteger(playerIndex) ? playerIndex : state.currentPlayer;
  if (player !== state.currentPlayer) return null;
  const meldCount = meldCountOf(state, player);
  if (state.hands[player].length !== 13 - meldCount * 3) return null;
  if (state.wallIndex >= state.wall.length) {
    state.phase = 'ended';
    state.result = {
      type: 'draw',
      reason: '牌山已空',
      winner: null,
      fan: 0,
      points: 0,
      patterns: []
    };
    state.log.push({ text: '牌山已空，本局流局。' });
    return null;
  }
  const tile = state.wall[state.wallIndex];
  state.wallIndex += 1;
  state.hands[player].push(tile);
  state.lastDrawn = { player: player, tile: tile };
  state.phase = 'discard';
  return tile;
}

function advanceAndDraw(state) {
  state.claimOffers = [];
  state.claimIndex = 0;
  state.phase = 'discard';
  state.currentPlayer = nextSeat(state.currentPlayer);
  state.lastDiscard = null;
  const drawn = draw(state);
  if (state.phase !== 'ended') {
    state.log.push({ text: (state.currentPlayer + 1) + ' 号位摸牌。' });
  }
  return drawn;
}

function chiCombos(hand, tile) {
  const parsed = parseTile(tile);
  if (!parsed || parsed.suit === 'z') return [];
  const counts = countsFromHand(hand);
  const base = SUIT_OFFSET[parsed.suit] + parsed.rank - 1;
  const rank = parsed.rank;
  const combos = [];
  function has(offset) {
    const idx = base + offset;
    return idx >= 0 && idx < 34 && counts[idx] > 0;
  }
  function pair(offsets) {
    const tiles = offsets.map(function (offset) { return indexToTile(base + offset); });
    const used = countsFromHand(tiles);
    // 两个不同牌面不会互相占用；这里只防御非法 index。
    if (used.some(function (n, i) { return n > 0 && counts[i] < n; })) return null;
    return tiles;
  }
  if (rank >= 3 && has(-2) && has(-1)) {
    const p = pair([-2, -1]);
    if (p) combos.push({ tiles: p, meld: [p[0], p[1], tile] });
  }
  if (rank >= 2 && rank <= 8 && has(-1) && has(1)) {
    const p = pair([-1, 1]);
    if (p) combos.push({ tiles: p, meld: [p[0], tile, p[1]] });
  }
  if (rank <= 7 && has(1) && has(2)) {
    const p = pair([1, 2]);
    if (p) combos.push({ tiles: p, meld: [tile, p[0], p[1]] });
  }
  return combos;
}

function analyzeClaims(state, discarder, tile) {
  const offers = [];
  for (let offset = 1; offset < 4; offset += 1) {
    const player = (discarder + offset) % 4;
    const hand = state.hands[player];
    const melds = state.melds[player];
    const actions = [];
    const candidate = hand.concat([tile]);
    if (candidate.length === expectedConcealed(melds.length) && evaluateHand(candidate, melds).win) {
      actions.push({ type: 'win' });
    }
    const copies = countOf(hand, tile);
    if (copies >= 3) actions.push({ type: 'kong' });
    if (copies >= 2) actions.push({ type: 'pong' });
    if (player === nextSeat(discarder)) {
      const combos = chiCombos(hand, tile);
      if (combos.length) actions.push({ type: 'chi', combos: combos });
    }
    if (actions.length) {
      const priority = Math.min.apply(null, actions.map(function (action) {
        if (action.type === 'win') return 0;
        if (action.type === 'kong' || action.type === 'pong') return 1;
        return 2;
      }));
      offers.push({ player: player, distance: offset, priority: priority, actions: actions });
    }
  }
  offers.sort(function (a, b) {
    return a.priority - b.priority || a.distance - b.distance;
  });
  return offers;
}

export function currentClaimOffer(state) {
  if (!state || state.phase !== 'claim') return null;
  return state.claimOffers[state.claimIndex] || null;
}

function hasFreshDraw(state, player) {
  return Boolean(state && state.lastDrawn && state.lastDrawn.player === player);
}

export function claimActionsFor(state, playerIndex) {
  if (!state) return [];
  if (state.phase === 'claim') {
    const offer = currentClaimOffer(state);
    if (offer && (playerIndex == null || offer.player === playerIndex)) return offer.actions.slice();
    return [];
  }
  if (state.phase === 'discard' && state.currentPlayer === (playerIndex == null ? state.currentPlayer : playerIndex)) {
    const hand = state.hands[state.currentPlayer];
    const actions = [];
    const seen = new Set();
    hand.forEach(function (tile) {
      if (!seen.has(tile)) {
        seen.add(tile);
        actions.push({ type: 'discard', tile: tile });
      }
    });
    // 只有刚摸到的牌（或庄家起手第 14 张）才能自摸；吃/碰后必须出牌。
    if (hasFreshDraw(state, state.currentPlayer) &&
      evaluateHand(hand, state.melds[state.currentPlayer]).win) {
      actions.push({ type: 'tsumo' });
    }
    return actions;
  }
  return [];
}

export function discard(state, tileCode) {
  if (!state || state.phase !== 'discard') return { ok: false, code: 'E_PHASE', message: '当前不能出牌' };
  const player = state.currentPlayer;
  const hand = state.hands[player];
  const meldCount = meldCountOf(state, player);
  if (hand.length !== expectedConcealed(meldCount)) return { ok: false, code: 'E_HAND', message: '手牌数量不对' };
  const index = hand.indexOf(tileCode);
  if (index === -1) return { ok: false, code: 'E_TILE', message: '手牌中没有这张牌' };

  hand.splice(index, 1);
  state.rivers[player].push(tileCode);
  state.lastDiscard = { player: player, tile: tileCode, turn: state.turn };
  state.turn += 1;
  state.log.push({ text: (player + 1) + ' 号位打出 ' + tileLabel(tileCode) + '。' });

  const offers = analyzeClaims(state, player, tileCode);
  if (offers.length) {
    state.phase = 'claim';
    state.claimOffers = offers;
    state.claimIndex = 0;
    const names = offers.map(function (offer) {
      const types = offer.actions.map(function (action) { return action.type; });
      return (offer.player + 1) + ' 号位(' + types.join('/') + ')';
    });
    state.log.push({ text: '可以鸣牌：' + names.join('、') + '。' });
    return { ok: true, phase: 'claim', claimOffers: offers, lastDiscard: state.lastDiscard, state: state };
  }

  const drawn = advanceAndDraw(state);
  return { ok: true, phase: state.phase, drawn: drawn, state: state };
}

function validateClaim(state, playerIndex, type) {
  if (!state || state.phase !== 'claim') return { ok: false, code: 'E_PHASE', message: '没有待处理的弃牌' };
  const offer = currentClaimOffer(state);
  if (!offer) return { ok: false, code: 'E_PHASE', message: '没有待处理的弃牌' };
  if (playerIndex != null && offer.player !== playerIndex) {
    return { ok: false, code: 'E_TURN', message: '还没轮到该玩家鸣牌' };
  }
  if (type) {
    const action = offer.actions.find(function (item) { return item.type === type; });
    if (!action) return { ok: false, code: 'E_ACTION', message: '不能执行该动作' };
    return { ok: true, offer: offer, action: action };
  }
  return { ok: true, offer: offer };
}

function takeClaimedTile(state) {
  if (state.lastDiscard) {
    const river = state.rivers[state.lastDiscard.player];
    if (river.length && river[river.length - 1] === state.lastDiscard.tile) river.pop();
  }
}

function beginOwnTurn(state, player) {
  state.claimOffers = [];
  state.claimIndex = 0;
  state.currentPlayer = player;
  state.phase = 'discard';
  state.lastDiscard = null;
  // 吃/碰后没有摸牌；清掉旧的摸牌标记，避免页面把旧牌当成刚摸的牌。
  state.lastDrawn = null;
}

export function claimChi(state, playerIndex, comboIndex) {
  const check = validateClaim(state, playerIndex, 'chi');
  if (!check.ok) return check;
  const offer = check.offer;
  const action = check.action;
  const combo = action.combos[Number.isInteger(comboIndex) ? comboIndex : 0];
  if (!combo) return { ok: false, code: 'E_CHI', message: '没有这个吃牌组合' };
  const hand = state.hands[offer.player];
  const remaining = hand.slice();
  for (let i = 0; i < combo.tiles.length; i += 1) {
    const at = remaining.indexOf(combo.tiles[i]);
    if (at === -1) return { ok: false, code: 'E_TILE', message: '手牌不足' };
    remaining.splice(at, 1);
  }
  state.hands[offer.player] = remaining;
  state.melds[offer.player].push({
    type: 'chi',
    tiles: combo.meld.slice(),
    from: state.lastDiscard.player,
    claimed: state.lastDiscard.tile
  });
  takeClaimedTile(state);
  const claimed = state.lastDiscard;
  beginOwnTurn(state, offer.player);
  state.log.push({ text: (offer.player + 1) + ' 号位吃 ' + tileLabel(claimed.tile) + '。' });
  return { ok: true, state: state, meld: state.melds[offer.player][state.melds[offer.player].length - 1] };
}

export function claimPong(state, playerIndex) {
  const check = validateClaim(state, playerIndex, 'pong');
  if (!check.ok) return check;
  const offer = check.offer;
  const player = offer.player;
  const tile = state.lastDiscard.tile;
  const hand = state.hands[player];
  const at = hand.indexOf(tile);
  if (at === -1) return { ok: false, code: 'E_TILE', message: '手牌没有两张同样的牌' };
  hand.splice(at, 1);
  const second = hand.indexOf(tile);
  if (second === -1) {
    hand.splice(at, 0, tile);
    return { ok: false, code: 'E_TILE', message: '手牌没有两张同样的牌' };
  }
  hand.splice(second, 1);
  state.melds[player].push({ type: 'pong', tiles: [tile, tile, tile], from: state.lastDiscard.player, claimed: tile });
  takeClaimedTile(state);
  const claimed = state.lastDiscard;
  beginOwnTurn(state, player);
  state.log.push({ text: (player + 1) + ' 号位碰 ' + tileLabel(claimed.tile) + '。' });
  return { ok: true, state: state };
}

export function claimKong(state, playerIndex) {
  const check = validateClaim(state, playerIndex, 'kong');
  if (!check.ok) return check;
  const offer = check.offer;
  const player = offer.player;
  const tile = state.lastDiscard.tile;
  const hand = state.hands[player];
  for (let i = 0; i < 3; i += 1) {
    const at = hand.indexOf(tile);
    if (at === -1) return { ok: false, code: 'E_TILE', message: '手牌没有三张同样的牌' };
    hand.splice(at, 1);
  }
  state.melds[player].push({
    type: 'kong',
    tiles: [tile, tile, tile, tile],
    from: state.lastDiscard.player,
    claimed: tile
  });
  takeClaimedTile(state);
  const claimed = state.lastDiscard;
  beginOwnTurn(state, player);
  state.log.push({ text: (player + 1) + ' 号位明杠 ' + tileLabel(claimed.tile) + '。' });
  // 杠后补一张；牌山耗尽则流局。
  const replacement = draw(state);
  state.log.push({ text: (player + 1) + ' 号位杠后补牌。' });
  return { ok: true, state: state, drawn: replacement, ended: state.phase === 'ended' };
}

export function claimWin(state, playerIndex) {
  const check = validateClaim(state, playerIndex, 'win');
  if (!check.ok) return check;
  const offer = check.offer;
  const player = offer.player;
  const tile = state.lastDiscard.tile;
  const hand = state.hands[player].concat([tile]);
  const result = evaluateHand(hand, state.melds[player]);
  if (!result.win) return { ok: false, code: 'E_WIN', message: '牌型不成立' };
  takeClaimedTile(state);
  const from = state.lastDiscard.player;
  state.phase = 'ended';
  state.winner = player;
  state.result = {
    type: 'ron',
    winner: player,
    from: from,
    tile: tile,
    fan: result.fan,
    points: result.points,
    patterns: result.patterns,
    hand: hand,
    melds: state.melds[player].slice()
  };
  state.log.push({ text: (player + 1) + ' 号位和牌（点炮），' + result.fan + ' 番：' + result.patterns.join('、') + '。' });
  return { ok: true, state: state, result: state.result };
}

export function passClaim(state, playerIndex) {
  const check = validateClaim(state, playerIndex);
  if (!check.ok) return check;
  state.claimIndex += 1;
  if (state.claimIndex < state.claimOffers.length) {
    return { ok: true, state: state, phase: 'claim' };
  }
  const drawn = advanceAndDraw(state);
  return { ok: true, state: state, phase: state.phase, drawn: drawn };
}

export function autoClaim(state, playerIndex) {
  if (!state || state.phase !== 'claim') return { ok: false, code: 'E_PHASE', message: '没有待处理的弃牌' };
  const offer = currentClaimOffer(state);
  if (!offer) return passClaim(state);
  if (playerIndex != null && offer.player !== playerIndex) {
    return { ok: false, code: 'E_TURN', message: '还没轮到该玩家鸣牌' };
  }
  const hasWin = offer.actions.some(function (action) { return action.type === 'win'; });
  if (hasWin) return claimWin(state, offer.player);
  return passClaim(state);
}

export function checkWin(state, playerIndex) {
  if (!state) return { win: false, fan: 0, patterns: [], melds: 0 };
  const index = playerIndex == null ? state.currentPlayer : playerIndex;
  if (state.phase === 'claim' && state.lastDiscard) {
    const offer = currentClaimOffer(state);
    if (offer && offer.player === index && offer.actions.some(function (action) { return action.type === 'win'; })) {
      return evaluateHand(state.hands[index].concat([state.lastDiscard.tile]), state.melds[index]);
    }
    return { win: false, fan: 0, points: 0, patterns: [], melds: 0 };
  }
  if (!hasFreshDraw(state, index)) return { win: false, fan: 0, points: 0, patterns: [], melds: 0 };
  return evaluateHand(state.hands[index] || [], state.melds[index]);
}

export function selfDrawWin(state, playerIndex) {
  if (!state || state.phase !== 'discard') return { ok: false, code: 'E_PHASE', message: '当前不能自摸' };
  const index = playerIndex == null ? state.currentPlayer : playerIndex;
  if (index !== state.currentPlayer) return { ok: false, code: 'E_TURN', message: '还没轮到该玩家' };
  if (!hasFreshDraw(state, index)) {
    return { ok: false, code: 'E_DRAW', message: '没有刚摸到的牌，不能自摸' };
  }
  const hand = state.hands[index];
  const result = evaluateHand(hand, state.melds[index]);
  if (!result.win) return { ok: false, code: 'E_WIN', message: '牌型不成立' };
  state.phase = 'ended';
  state.winner = index;
  state.result = {
    type: 'tsumo',
    winner: index,
    from: null,
    tile: state.lastDrawn ? state.lastDrawn.tile : hand[hand.length - 1],
    fan: result.fan,
    points: result.points,
    patterns: result.patterns,
    hand: hand.slice(),
    melds: state.melds[index].slice()
  };
  state.log.push({ text: (index + 1) + ' 号位自摸，' + result.fan + ' 番：' + result.patterns.join('、') + '。' });
  return { ok: true, state: state, result: state.result };
}

export function legalActions(state) {
  if (!state || state.phase === 'ended') return [];
  if (state.phase === 'claim') {
    const offer = currentClaimOffer(state);
    if (!offer) return [];
    const actions = offer.actions.map(function (action) {
      return Object.assign({ playerIndex: offer.player }, action);
    });
    actions.push({ type: 'pass', playerIndex: offer.player });
    return actions;
  }
  return claimActionsFor(state, state.currentPlayer);
}

export function summarize(state) {
  return {
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    wallLeft: state.wall.length - state.wallIndex,
    rivers: state.rivers.map(function (river) { return river.slice(); }),
    hands: state.hands.map(function (hand) { return hand.slice(); }),
    handCounts: state.hands.map(function (hand) { return hand.length; }),
    melds: state.melds.map(function (melds) { return melds.slice(); }),
    lastDiscard: state.lastDiscard ? Object.assign({}, state.lastDiscard) : null,
    lastDrawn: state.lastDrawn ? Object.assign({}, state.lastDrawn) : null,
    claimPlayer: currentClaimOffer(state) ? currentClaimOffer(state).player : null,
    winner: state.winner,
    result: state.result ? Object.assign({}, state.result) : null
  };
}

/* ---------- AI ---------- */

function keepScore(hand, tile) {
  const parsed = parseTile(tile);
  if (!parsed) return -100;
  const counts = countsFromHand(hand);
  const idx = tileIndex(tile);
  let score = 0;
  const copies = counts[idx];
  if (copies >= 3) score += 14;
  else if (copies === 2) score += 8;
  if (parsed.suit === 'z') {
    // 字牌只有对子/刻子有价值，孤张优先打掉。
    if (parsed.rank >= 5) score += 1;
    return score;
  }
  const rank = parsed.rank;
  const base = rank - 1; // 0..8 within suit
  function hasOffset(offset) {
    const at = base + offset;
    return at >= 0 && at <= 8 && counts[SUIT_OFFSET[parsed.suit] + at] > 0;
  }
  if (hasOffset(-1)) score += 6;
  if (hasOffset(1)) score += 6;
  if (hasOffset(-2)) score += 3;
  if (hasOffset(2)) score += 3;
  if (rank >= 3 && rank <= 7) score += 1;
  return score;
}

/**
 * 选择要打出的牌：优先孤张、字牌和边张，保留对子、刻子与搭子。
 */
export function chooseAiDiscard(hand, melds) {
  if (!Array.isArray(hand) || !hand.length) return null;
  let best = null;
  let bestScore = Infinity;
  hand.forEach(function (tile) {
    const score = keepScore(hand, tile);
    const parsed = parseTile(tile) || { suit: 'z', rank: 9 };
    if (score < bestScore ||
      (score === bestScore && (parsed.suit === 'z' || parsed.rank >= 8))) {
      best = tile;
      bestScore = score;
    }
  });
  return best;
}

/**
 * 简单的鸣牌决策：能和就和；有杠就杠；字牌对子或副露不多时碰；
 * 副露少于 2 组时吃。返回 {type:'win'|'kong'|'pong'|'chi'|'pass', comboIndex?}。
 */
export function chooseAiClaim(state, playerIndex) {
  const offer = currentClaimOffer(state);
  if (!offer || (playerIndex != null && offer.player !== playerIndex)) return { type: 'pass' };
  const types = offer.actions.map(function (action) { return action.type; });
  if (types.indexOf('win') !== -1) return { type: 'win' };
  const player = offer.player;
  const melds = state.melds[player] || [];
  if (types.indexOf('kong') !== -1) return { type: 'kong' };
  if (types.indexOf('pong') !== -1) {
    const tile = state.lastDiscard ? state.lastDiscard.tile : '';
    const parsed = parseTile(tile);
    if ((parsed && parsed.suit === 'z') || melds.length < 2) return { type: 'pong' };
  }
  if (types.indexOf('chi') !== -1 && melds.length < 2) {
    const action = offer.actions.find(function (item) { return item.type === 'chi'; });
    return { type: 'chi', comboIndex: action && action.combos.length ? 0 : 0 };
  }
  return { type: 'pass' };
}

/* ---------- C 模块契约兼容接口 ---------- */

export const TILE_TYPES = TILE_KINDS;
export const KINDS = TILE_KINDS;

export function createWall(seed) {
  return buildWall(seed);
}

export const makeWall = createWall;

export function dealHands(wall, players) {
  if (!Array.isArray(wall)) throw new Error('wall must be an array');
  const count = Number.isInteger(players) ? Math.max(1, players) : 4;
  const remaining = wall.slice();
  const hands = [];
  for (let p = 0; p < count; p += 1) {
    const hand = [];
    for (let i = 0; i < 13; i += 1) {
      const tile = remaining.shift();
      if (tile !== undefined) hand.push(tile);
    }
    hands.push(hand);
  }
  return { wall: remaining, hands: hands, players: count };
}

export function drawTile(state, playerIndex) {
  if (!state || !Array.isArray(state.wall) || !Array.isArray(state.hands)) return null;
  if (state.wall.length === 0) return null;
  const index = Number.isInteger(playerIndex) ? playerIndex : 0;
  if (!Array.isArray(state.hands[index])) state.hands[index] = [];
  const tile = state.wall.shift();
  state.hands[index].push(tile);
  return { tile: tile, wall: state.wall, hand: state.hands[index] };
}

export function discardTile(state, playerIndex, tile) {
  if (!state || !Array.isArray(state.hands)) throw new Error('invalid state');
  const index = Number.isInteger(playerIndex) ? playerIndex : 0;
  const hand = state.hands[index] || [];
  const at = hand.indexOf(tile);
  if (at === -1) {
    const err = new Error('tile not in hand');
    err.code = 'E_TILE';
    throw err;
  }
  hand.splice(at, 1);
  if (!Array.isArray(state.discards)) state.discards = [[], [], [], []];
  if (!Array.isArray(state.discards[index])) state.discards[index] = [];
  state.discards[index].push(tile);
  return { ok: true, tile: tile, wall: state.wall, hand: hand };
}

export function isWinningHand(hand, melds) {
  return canWin(hand, melds);
}

export function scoreHand(hand, options) {
  const opts = options || {};
  const result = evaluateHand(hand, opts.melds);
  if (!result.win) {
    return { win: false, han: 0, fu: 0, points: 0, yaku: [] };
  }
  const sevenPairs = result.patterns.indexOf('七对') !== -1;
  return {
    win: true,
    han: result.fan,
    fan: result.fan,
    fu: sevenPairs ? 25 : (result.patterns.indexOf('平和') !== -1 ? 30 : 40),
    points: result.points,
    base: WIN_BASE,
    yaku: result.patterns.slice(),
    patterns: result.patterns.slice(),
    tsumo: Boolean(opts.tsumo)
  };
}

export default {
  TILE_KINDS: TILE_KINDS,
  parseTile: parseTile,
  tileLabel: tileLabel,
  tileAsset: tileAsset,
  buildWall: buildWall,
  makeRng: makeRng,
  createGame: createGame,
  startRound: startRound,
  draw: draw,
  discard: discard,
  canWin: canWin,
  evaluateHand: evaluateHand,
  checkWin: checkWin,
  claimChi: claimChi,
  claimPong: claimPong,
  claimKong: claimKong,
  claimWin: claimWin,
  passClaim: passClaim,
  autoClaim: autoClaim,
  currentClaimOffer: currentClaimOffer,
  claimActionsFor: claimActionsFor,
  selfDrawWin: selfDrawWin,
  legalActions: legalActions,
  chooseAiDiscard: chooseAiDiscard,
  chooseAiClaim: chooseAiClaim,
  summarize: summarize
};
