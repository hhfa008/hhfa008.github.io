'use strict';

/*
 * 积分 / 等级 / 奖杯（localStorage，读写失败自动降级为内存）。
 *
 * 等级阈值固定为 1/2/3/4/5 级：0 / 100 / 300 / 700 / 1500 分。
 * 奖杯按 id 去重；历史最多 100 条，最新在前。
 */

const STORAGE_KEY = 'boardgame.rewards.v1';

export const LEVELS = [
  { level: 1, min: 0, tier: 'bronze' },
  { level: 2, min: 100, tier: 'silver' },
  { level: 3, min: 300, tier: 'gold' },
  { level: 4, min: 700, tier: 'platinum' },
  { level: 5, min: 1500, tier: 'diamond' }
];

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) {
    /* ignore */
  }
  return null;
}

function defaultState() {
  return { total: 0, trophies: [], history: [] };
}

function levelFor(total) {
  let current = LEVELS[0];
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (total >= LEVELS[i].min) current = LEVELS[i];
  }
  return { level: current.level, tier: current.tier };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRewards(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  let memory = null;

  function load() {
    let raw = null;
    try {
      raw = storage ? storage.getItem(STORAGE_KEY) : null;
    } catch (err) {
      raw = null;
    }
    if (!raw) return defaultState();
    try {
      const parsed = JSON.parse(raw);
      return {
        total: Number.isFinite(parsed.total) ? parsed.total : 0,
        trophies: Array.isArray(parsed.trophies) ? parsed.trophies.slice() : [],
        history: Array.isArray(parsed.history) ? parsed.history.slice() : []
      };
    } catch (err) {
      return defaultState();
    }
  }

  function save(state) {
    memory = state;
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* 降级为内存状态 */
    }
  }

  function snapshot(state) {
    const lv = levelFor(state.total);
    return {
      total: state.total,
      level: lv.level,
      tier: lv.tier,
      trophies: state.trophies.slice(),
      history: state.history.slice()
    };
  }

  function addTrophies(state, input) {
    const ids = [];
    if (input && typeof input.trophy === 'string') ids.push(input.trophy);
    if (input && Array.isArray(input.trophies)) ids.push.apply(ids, input.trophies);
    ids.forEach(function (id) {
      if (typeof id === 'string' && id && state.trophies.indexOf(id) === -1) {
        state.trophies.push(id);
      }
    });
  }

  function award(input) {
    const awardInput = input || {};
    const points = awardInput.points;
    if (!Number.isInteger(points) || points < 1 || points > 10000) {
      return { ok: false, code: 'E_POINTS', message: 'points must be an integer in 1..10000' };
    }
    const state = load();
    state.total += points;
    state.history.unshift({
      type: typeof awardInput.type === 'string' ? awardInput.type : 'play',
      points: points,
      reason: typeof awardInput.reason === 'string' ? awardInput.reason : '',
      at: now()
    });
    if (state.history.length > 100) state.history.length = 100;
    addTrophies(state, awardInput);
    save(state);
    return Object.assign({ ok: true }, snapshot(state));
  }

  function grantTrophy(id) {
    if (typeof id !== 'string' || !id) {
      return { ok: false, code: 'E_TROPHY', message: 'trophy id is required' };
    }
    const state = load();
    addTrophies(state, { trophy: id });
    save(state);
    return Object.assign({ ok: true }, snapshot(state));
  }

  function getState() {
    return snapshot(load());
  }

  function reset() {
    const fresh = defaultState();
    save(fresh);
    return snapshot(fresh);
  }

  return {
    award: award,
    grantTrophy: grantTrophy,
    getState: getState,
    reset: reset
  };
}

export default { createRewards: createRewards, LEVELS: LEVELS };
