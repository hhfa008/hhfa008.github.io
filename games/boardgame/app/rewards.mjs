'use strict';

/*
 * Points, levels and trophies for the boardgame pages app.
 *
 * A small state machine that can be used standalone (createRewards) or as a
 * shared library by game pages. All state is JSON-serialisable, storage is
 * optional and every access is guarded, and trophy ids are plain strings so
 * they are easy to persist and compare.
 *
 * Ordering rule: total points only ever increase. `award` rejects zero or
 * negative amounts instead of silently clamping, so callers cannot use the
 * rewards API to take points away from a player.
 */

export const REWARDS_STORAGE_KEY = 'boardgame.rewards.v1';
export const MAX_AWARD_POINTS = 500;
export const MAX_TOTAL_POINTS = 1000000;

const LEVELS = [
  { level: 1, min: 0, title: '新手玩家' },
  { level: 2, min: 100, title: '常客' },
  { level: 3, min: 250, title: '牌桌熟手' },
  { level: 4, min: 500, title: '战术学徒' },
  { level: 5, min: 900, title: '牌局老手' },
  { level: 6, min: 1400, title: '策略家' },
  { level: 7, min: 2000, title: '桌上指挥' },
  { level: 8, min: 2800, title: '连胜猎手' },
  { level: 9, min: 3800, title: '桌游大师' },
  { level: 10, min: 5000, title: '传说牌手' },
  { level: 11, min: 7000, title: '荣誉桌长' },
  { level: 12, min: 10000, title: '殿堂玩家' },
  { level: 13, min: 14000, title: '传奇牌手' },
  { level: 14, min: 20000, title: '桌游宗师' },
  { level: 15, min: 30000, title: '不朽牌魂' }
];

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function levelForPoints(points) {
  const value = Math.max(0, finite(points, 0));
  let level = 1;
  for (const tier of LEVELS) {
    if (value >= tier.min) level = tier.level;
    else break;
  }
  return level;
}

export function levelDetails(points) {
  const value = Math.max(0, finite(points, 0));
  const level = levelForPoints(value);
  const tier = LEVELS[level - 1] || LEVELS[0];
  const next = LEVELS[level] || null;
  return {
    level: level,
    title: tier.title,
    min: tier.min,
    nextAt: next ? next.min : null,
    progress: next ? clamp((value - tier.min) / (next.min - tier.min), 0, 1) : 1
  };
}

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

function freshState(now) {
  return {
    total: 0,
    points: 0,
    level: 1,
    trophies: [],
    history: [],
    createdAt: now,
    updatedAt: now
  };
}

function normalizeState(value, now) {
  const state = isObject(value) ? value : {};
  const total = Math.max(0, Math.floor(finite(state.total, finite(state.points, 0))));
  state.total = total;
  state.points = total;
  state.level = levelForPoints(total);
  if (!Array.isArray(state.trophies)) state.trophies = [];
  state.trophies = state.trophies.map(function (trophy) {
    if (trophy && typeof trophy === 'object') return String(trophy.id == null ? trophy : trophy.id);
    return String(trophy);
  }).filter(function (id, index, list) {
    return id && id !== 'undefined' && list.indexOf(id) === index;
  });
  if (!Array.isArray(state.history)) state.history = [];
  if (!Number.isFinite(state.createdAt)) state.createdAt = now;
  if (!Number.isFinite(state.updatedAt)) state.updatedAt = now;
  return state;
}

function loadState(storage, now) {
  const store = resolveStorage(storage);
  if (!store) return freshState(now);
  try {
    const text = store.getItem(REWARDS_STORAGE_KEY);
    if (!text) return freshState(now);
    return normalizeState(JSON.parse(text), now);
  } catch (err) {
    return freshState(now);
  }
}

function saveState(state, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(REWARDS_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Create a rewards state machine.
 *
 * options:
 *   storage?   localStorage-like object (defaults to globalThis.localStorage)
 *   now?       () => timestamp, injectable for tests
 *   initialState? plain object to restore from
 */
export function createRewards(options) {
  const opts = isObject(options) ? options : {};
  const nowFn = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  const storage = resolveStorage(opts.storage);
  const now = function () {
    const value = nowFn();
    return Number.isFinite(value) ? value : Date.now();
  };
  let state = opts.initialState
    ? normalizeState(opts.initialState, now())
    : loadState(storage, now());

  function persist() {
    return saveState(state, storage);
  }

  function snapshot() {
    const details = levelDetails(state.total);
    return {
      total: state.total,
      points: state.total,
      level: details.level,
      levelTitle: details.title,
      nextLevelAt: details.nextAt,
      levelProgress: details.progress,
      trophies: state.trophies.slice(),
      history: state.history.slice(-20),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt
    };
  }

  function grantTrophy(trophyId) {
    const id = trophyId && typeof trophyId === 'object'
      ? String(trophyId.id == null ? '' : trophyId.id)
      : String(trophyId == null ? '' : trophyId);
    if (!id) return { ok: false, code: 'E_INVALID_TROPHY', reason: 'empty_trophy_id' };
    const already = state.trophies.indexOf(id) !== -1;
    if (!already) {
      state.trophies.push(id);
      state.updatedAt = now();
      persist();
    }
    return { ok: true, granted: !already, trophy: id, trophies: state.trophies.slice() };
  }

  /**
   * Award a positive points amount. Invalid amounts are rejected with
   * `{ ok: false }`; points are never removed.
   */
  function award(payload) {
    const claim = isObject(payload) ? payload : {};
    const amount = Number(claim.points);
    if (!Number.isFinite(amount) || amount <= 0 || Math.floor(amount) !== amount) {
      return { ok: false, code: 'E_INVALID_POINTS', reason: 'points_must_be_positive_integer' };
    }
    if (amount > MAX_AWARD_POINTS) {
      return {
        ok: false,
        code: 'E_AWARD_CAP',
        reason: 'single_award_above_cap',
        maxAward: MAX_AWARD_POINTS
      };
    }
    if (state.total + amount > MAX_TOTAL_POINTS) {
      return { ok: false, code: 'E_TOTAL_CAP', reason: 'total_above_cap', maxTotal: MAX_TOTAL_POINTS };
    }
    const at = now();
    state.total += amount;
    state.points = state.total;
    state.level = levelForPoints(state.total);
    state.history.push({
      at: at,
      points: amount,
      reason: String(claim.reason == null ? 'award' : claim.reason).slice(0, 64)
    });
    if (state.history.length > 100) state.history.splice(0, state.history.length - 100);
    state.updatedAt = at;
    const trophies = [];
    if (claim.trophy != null) {
      const granted = grantTrophy(claim.trophy);
      if (granted.trophies) trophies.push.apply(trophies, granted.trophies);
    }
    persist();
    return {
      ok: true,
      awarded: amount,
      total: state.total,
      level: state.level,
      trophies: trophies.length ? trophies : state.trophies.slice()
    };
  }

  function addPoints(payload) {
    return award(payload);
  }

  function getPoints() {
    return state.total;
  }

  function getLevel() {
    return levelForPoints(state.total);
  }

  function getTrophies() {
    return state.trophies.slice();
  }

  function getState() {
    return snapshot();
  }

  function reset() {
    state = freshState(now());
    persist();
    return { ok: true, state: snapshot() };
  }

  return {
    getState: getState,
    snapshot: snapshot,
    award: award,
    addPoints: addPoints,
    awardPoints: addPoints,
    grantTrophy: grantTrophy,
    awardTrophy: grantTrophy,
    getPoints: getPoints,
    getLevel: getLevel,
    getTrophies: getTrophies,
    levelForPoints: levelForPoints,
    levelDetails: levelDetails,
    reset: reset
  };
}

export default createRewards;
