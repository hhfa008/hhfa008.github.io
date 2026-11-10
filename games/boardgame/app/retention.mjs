'use strict';

/*
 * Boardgame retention & rewards (local-first, zero dependencies).
 *
 * Design constraints:
 *  - Pure data in / data out: every state object is JSON-serialisable.
 *  - No personal information: the only identifier is a random anonymous
 *    device id produced by crypto.randomUUID(). It is never sent anywhere by
 *    this module; a remote leaderboard is opt-in and receives scores only.
 *  - Storage access is always wrapped in try/catch so private mode, blocked
 *    storage or a cleared cache cannot break play.
 *  - Rewards are positive-only: a loss never removes points. Loss aversion is
 *    implemented as a one-per-day comeback/near-miss bonus prompt.
 *  - The client is never authoritative for leaderboard scores: caps, rate
 *    limits and an injectable server validator gate every submission.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DEVICE_ID_KEY = 'boardgame.deviceId';
export const PROGRESS_KEY = 'boardgame.progress.v1';
export const PROGRESS_VERSION = 1;

const PII_PATTERN = /email|phone|mobile|address|realName|fullName|idCard|张三|李四/i;

const DEFAULT_MISSIONS = Object.freeze([
  Object.freeze({ id: 'play-one', title: '完成一局', target: 1, points: 10 }),
  Object.freeze({ id: 'play-cards', title: '打出 10 张牌', target: 10, points: 15 }),
  Object.freeze({ id: 'share-once', title: '分享一次成绩', target: 1, points: 10 })
]);

const DEFAULT_CONFIG = Object.freeze({
  hooks: Object.freeze({
    daily: Object.freeze({ enabled: true, points: 20, cooldownHours: 24 }),
    streak: Object.freeze({ enabled: true, bonusPerDay: 5, maxDays: 7 }),
    lossAversion: Object.freeze({
      enabled: true,
      nearMissBonus: 10,
      comebackBonus: 20,
      maxPerDay: 1,
      inactiveDays: 3,
      expiresHours: 48
    }),
    missions: Object.freeze({
      enabled: true,
      resetHours: 24,
      items: DEFAULT_MISSIONS
    }),
    play: Object.freeze({
      enabled: true,
      winPoints: 20,
      drawPoints: 10,
      lossPoints: 5,
      nearMissPoints: 5,
      rewardCapPerDay: 120
    })
  }),
  antiCheat: Object.freeze({
    maxScore: 100000,
    minIntervalMs: 1000,
    serverAuthoritative: true
  }),
  share: Object.freeze({
    urlTemplate: 'https://hhfa008.github.io/games/boardgame/?match={matchId}'
  })
});

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDeep(base, override) {
  if (!isObject(override)) return clone(base);
  const out = isObject(base) ? clone(base) : {};
  for (const key of Object.keys(override)) {
    const value = override[key];
    if (isObject(value) && isObject(out[key])) out[key] = mergeDeep(out[key], value);
    else out[key] = clone(value);
  }
  return out;
}

function toTimestamp(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number' && Number.isFinite(now)) return now;
  return Date.now();
}

function utcDay(now) {
  return Math.floor(toTimestamp(now) / DAY_MS);
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInt(value, fallback) {
  const number = finite(value, fallback);
  return Math.max(0, Math.floor(number));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ensureArray(owner, key) {
  if (!Array.isArray(owner[key])) owner[key] = [];
  return owner[key];
}

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

/**
 * Create a merged retention configuration. Accepts overrides either at the
 * top level (daily/streak/lossAversion/antiCheat/share) or under `hooks`.
 */
export function createRetentionConfig(options) {
  const opts = isObject(options) ? options : {};
  const merged = mergeDeep(DEFAULT_CONFIG, opts);
  if (isObject(opts.hooks)) merged.hooks = mergeDeep(merged.hooks, opts.hooks);
  const hooks = merged.hooks;

  // Convenience top-level aliases: both `config.daily` and
  // `config.hooks.daily` are supported by pages and by the contract tests.
  merged.daily = clone(hooks.daily);
  merged.streak = clone(hooks.streak);
  merged.lossAversion = clone(hooks.lossAversion);
  merged.missions = clone(hooks.missions);
  merged.play = clone(hooks.play);
  if (!isObject(merged.antiCheat)) merged.antiCheat = clone(DEFAULT_CONFIG.antiCheat);
  merged.anticheat = merged.antiCheat;
  if (!isObject(merged.share)) merged.share = clone(DEFAULT_CONFIG.share);

  // Sanitise: the economy must never become negative or unbounded.
  if (!(merged.daily.points > 0)) merged.daily.points = DEFAULT_CONFIG.hooks.daily.points;
  if (!(merged.streak.bonusPerDay > 0)) merged.streak.bonusPerDay = DEFAULT_CONFIG.hooks.streak.bonusPerDay;
  if (!(merged.streak.maxDays > 0)) merged.streak.maxDays = DEFAULT_CONFIG.hooks.streak.maxDays;
  if (!(merged.antiCheat.maxScore > 0)) merged.antiCheat.maxScore = DEFAULT_CONFIG.antiCheat.maxScore;
  if (!(merged.antiCheat.minIntervalMs > 0)) merged.antiCheat.minIntervalMs = DEFAULT_CONFIG.antiCheat.minIntervalMs;
  merged.antiCheat.serverAuthoritative = true;
  return merged;
}

/** Frozen-ish default config returned as a fresh copy each call. */
export const DEFAULT_RETENTION = Object.freeze(createRetentionConfig());

export function getRetentionConfig(options) {
  return createRetentionConfig(options);
}

export const retentionConfig = DEFAULT_RETENTION;

function configFor(state, config) {
  if (config) return config.hooks ? config : createRetentionConfig(config);
  if (state && state.config && state.config.hooks) return state.config;
  return DEFAULT_RETENTION;
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

/** Create a fresh progress state. Safe to persist with JSON.stringify. */
export function createEmptyProgress(now) {
  const at = toTimestamp(now);
  return {
    version: PROGRESS_VERSION,
    points: 0,
    level: levelForPoints(0),
    streak: 0,
    trophies: [],
    lastLoginAt: null,
    lastLoginDay: null,
    lastPlayedAt: null,
    dailyLog: [],
    scores: [],
    entries: [],
    submissions: [],
    missions: { day: null, progress: {}, claimed: [] },
    lossAversion: { day: null, count: 0 },
    comeback: { lastPromptDay: null, lastClaimDay: null },
    wins: 0,
    losses: 0,
    games: 0,
    createdAt: at,
    updatedAt: at
  };
}

function ensureState(state) {
  const next = isObject(state) ? state : {};
  if (!Array.isArray(next.trophies)) next.trophies = [];
  if (!Array.isArray(next.dailyLog)) next.dailyLog = [];
  if (!Array.isArray(next.scores)) next.scores = [];
  if (!Array.isArray(next.entries)) next.entries = [];
  if (!Array.isArray(next.submissions)) next.submissions = [];
  if (!isObject(next.missions)) next.missions = { day: null, progress: {}, claimed: [] };
  if (!isObject(next.missions.progress)) next.missions.progress = {};
  if (!Array.isArray(next.missions.claimed)) next.missions.claimed = [];
  if (!isObject(next.lossAversion)) next.lossAversion = { day: null, count: 0 };
  if (!isObject(next.comeback)) next.comeback = { lastPromptDay: null, lastClaimDay: null };
  if (typeof next.points !== 'number' || !Number.isFinite(next.points)) next.points = 0;
  if (typeof next.streak !== 'number' || !Number.isFinite(next.streak)) next.streak = 0;
  if (typeof next.wins !== 'number') next.wins = 0;
  if (typeof next.losses !== 'number') next.losses = 0;
  if (typeof next.games !== 'number') next.games = 0;
  return next;
}

export function serializeProgress(state) {
  return JSON.stringify(ensureState(state));
}

export function deserializeProgress(text) {
  if (typeof text !== 'string' || !text) return null;
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? ensureState(parsed) : null;
  } catch (err) {
    return null;
  }
}

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

/** Load progress defensively; returns null instead of throwing. */
export function loadProgress(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    return deserializeProgress(store.getItem(PROGRESS_KEY));
  } catch (err) {
    return null;
  }
}

/** Persist progress defensively; returns true when the write happened. */
export function saveProgress(state, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(PROGRESS_KEY, serializeProgress(state));
    return true;
  } catch (err) {
    return false;
  }
}

export function clearProgress(storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.removeItem(PROGRESS_KEY);
    return true;
  } catch (err) {
    return false;
  }
}

export function createProgressStore(storage) {
  const store = resolveStorage(storage);
  return {
    load: function () { return loadProgress(store); },
    save: function (state) { return saveProgress(state, store); },
    clear: function () { return clearProgress(store); }
  };
}

/* ------------------------------------------------------------------ */
/* anonymous device id                                                 */
/* ------------------------------------------------------------------ */

function generateDeviceId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (err) {
    // fall through to the random-hex source
  }
  const bytes = new Uint8Array(16);
  try {
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
  } catch (err) {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
  return out.slice(0, 8) + '-' + out.slice(8, 12) + '-' + out.slice(12, 16) + '-' +
    out.slice(16, 20) + '-' + out.slice(20, 32);
}

function looksAnonymous(id) {
  return typeof id === 'string' && id.length >= 8 && id.length <= 80 && !PII_PATTERN.test(id);
}

/**
 * Return a stable anonymous device id for the given storage. The id is only
 * a random UUID; it is not a fingerprint and carries no personal data.
 */
export function getDeviceId(storage) {
  const store = resolveStorage(storage);
  if (!store) return generateDeviceId();
  try {
    const existing = store.getItem(DEVICE_ID_KEY);
    if (looksAnonymous(existing)) return existing;
  } catch (err) {
    return generateDeviceId();
  }
  const id = generateDeviceId();
  try {
    store.setItem(DEVICE_ID_KEY, id);
  } catch (err) {
    // Private mode / quota: keep the in-memory id for this session.
  }
  return id;
}

export const ensureDeviceId = getDeviceId;
export const deviceId = getDeviceId;

/* ------------------------------------------------------------------ */
/* points, level, trophies                                             */
/* ------------------------------------------------------------------ */

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

/** Level number for a points total. Monotonic and capped at the top tier. */
export function levelForPoints(points) {
  const value = Math.max(0, finite(points, 0));
  let level = 1;
  for (const tier of LEVELS) {
    if (value >= tier.min) level = tier.level;
    else break;
  }
  return level;
}

/** Rich level info for display (progress towards the next tier). */
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

/**
 * Add points to a state in place. Negative amounts are clamped so the total
 * can never fall below zero. Returns the same state object.
 */
export function addPoints(state, amount, meta) {
  const next = ensureState(state);
  let delta = finite(amount, 0);
  if (delta < 0) delta = -Math.min(next.points, Math.abs(delta));
  delta = Math.floor(delta);
  next.points = Math.max(0, Math.floor(next.points + delta));
  next.level = levelForPoints(next.points);
  next.updatedAt = Date.now();
  if (meta && typeof meta === 'object') {
    const log = ensureArray(next, 'pointLog');
    log.push({ at: next.updatedAt, delta: delta, reason: String(meta.reason || 'award') });
    if (log.length > 60) log.splice(0, log.length - 60);
  }
  return next;
}

export const awardPoints = addPoints;

/**
 * Award a trophy once. Duplicate awards are ignored (idempotent), which is
 * what first-win / streak badges need.
 */
export function awardTrophy(state, trophyId, meta) {
  const next = ensureState(state);
  const trophies = ensureArray(next, 'trophies');
  const id = trophyId && typeof trophyId === 'object'
    ? String(trophyId.id || trophyId.trophyId || '')
    : String(trophyId == null ? '' : trophyId);
  if (!id) return next;
  const exists = trophies.some(function (trophy) {
    if (trophy == null) return false;
    return typeof trophy === 'object' ? String(trophy.id) === id : String(trophy) === id;
  });
  if (!exists) {
    trophies.push({
      id: id,
      awardedAt: toTimestamp(meta && meta.at),
      title: meta && meta.title ? String(meta.title) : id
    });
  }
  return next;
}

export const awardTrophies = awardTrophy;

export function getTrophies(state) {
  return ensureState(state).trophies.slice();
}

export function hasTrophy(state, trophyId) {
  const id = String(trophyId);
  return ensureState(state).trophies.some(function (trophy) {
    return trophy != null && String(trophy.id || trophy) === id;
  });
}

/* ------------------------------------------------------------------ */
/* daily login, streak, missions                                       */
/* ------------------------------------------------------------------ */

function streakBonus(streak, config) {
  const cfg = configFor(null, config);
  const effective = Math.min(streak, cfg.streak.maxDays);
  return Math.max(0, (effective - 1) * cfg.streak.bonusPerDay);
}

function nextStreak(previous, lastAt, now, maxDays) {
  if (!lastAt) return 1;
  const gap = utcDay(now) - utcDay(lastAt);
  if (gap <= 0) return Math.max(previous || 1, 1);
  if (gap === 1) return Math.min((previous || 0) + 1, maxDays);
  return 1;
}

/**
 * Record a daily login and grant the daily reward (plus streak bonus) in
 * place. The same UTC day is only rewarded once.
 *
 *   recordDailyLogin(state, now?) -> state
 */
export function recordDailyLogin(state, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  const at = toTimestamp(now);
  const today = utcDay(at);
  const last = typeof next.lastLoginAt === 'number' ? next.lastLoginAt : null;
  const lastDay = typeof next.lastLoginDay === 'number' ? next.lastLoginDay : (last ? utcDay(last) : null);

  // Duplicate login on the same UTC day: no reward, streak unchanged.
  if (lastDay === today) {
    next.dailyAwarded = false;
    next.lastDailyReason = 'same_day';
    next.updatedAt = at;
    return next;
  }

  const maxDays = Math.max(1, cfg.streak.maxDays);
  const previousStreak = Math.max(0, next.streak || 0);
  const streak = cfg.streak.enabled === false
    ? previousStreak
    : nextStreak(previousStreak, last, at, maxDays);
  const base = cfg.daily.enabled === false ? 0 : Math.max(0, cfg.daily.points);
  const bonus = cfg.streak.enabled === false ? 0 : streakBonus(streak, cfg);
  const award = Math.floor(base + bonus);

  next.streak = streak;
  next.lastLoginAt = at;
  next.lastLoginDay = today;
  next.dailyAwarded = award > 0;
  next.lastDailyAward = award;
  next.lastDailyReason = 'logged_in';
  next.dailyLog.push({ day: today, at: at, points: award, streak: streak });
  if (next.dailyLog.length > 60) next.dailyLog.splice(0, next.dailyLog.length - 60);
  if (award > 0) addPoints(next, award, { reason: 'daily_login' });
  if (streak >= 3) awardTrophy(next, 'streak-3', { at: at, title: '连胜 3 天' });
  if (streak >= 7) awardTrophy(next, 'streak-7', { at: at, title: '连胜 7 天' });
  next.updatedAt = at;
  return next;
}

export const claimDaily = recordDailyLogin;
export const recordLogin = recordDailyLogin;
export const dailyCheckIn = recordDailyLogin;

/**
 * Standalone streak helper.
 *  - updateStreak(state, now)  -> updates state.streak in place and returns state
 *  - updateStreak(lastAt, now) -> returns the streak number
 */
export function updateStreak(target, now, config) {
  const cfg = configFor(isObject(target) ? target : null, config);
  const maxDays = Math.max(1, cfg.streak.maxDays);
  if (isObject(target)) {
    const next = ensureState(target);
    const at = toTimestamp(now);
    const last = typeof next.lastLoginAt === 'number' ? next.lastLoginAt : null;
    next.streak = nextStreak(next.streak, last, at, maxDays);
    next.lastLoginAt = at;
    next.lastLoginDay = utcDay(at);
    next.updatedAt = at;
    return next;
  }
  const last = typeof target === 'number' ? target : null;
  return nextStreak(0, last, toTimestamp(now), maxDays);
}

export function recordStreak(state, now, config) {
  return updateStreak(state, now, config);
}

export function getStreak(state) {
  return ensureState(state).streak || 0;
}

/** Ensure the mission board matches the current UTC day. */
function resetMissionsIfNeeded(state, now, config) {
  const cfg = configFor(state, config);
  const today = utcDay(now);
  if (state.missions.day !== today) {
    state.missions = { day: today, progress: {}, claimed: [] };
  }
  return cfg;
}

export function getDailyMissions(state, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  resetMissionsIfNeeded(next, now, cfg);
  const items = cfg.missions && Array.isArray(cfg.missions.items) ? cfg.missions.items : DEFAULT_MISSIONS;
  return items.map(function (item) {
    const progress = nonNegativeInt(next.missions.progress[item.id], 0);
    return {
      id: item.id,
      title: item.title,
      target: item.target,
      points: item.points,
      progress: Math.min(progress, item.target),
      complete: progress >= item.target,
      claimed: next.missions.claimed.indexOf(item.id) !== -1
    };
  });
}

/** Advance one mission in place. Returns the updated state. */
export function recordMissionProgress(state, missionId, amount, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  resetMissionsIfNeeded(next, now, cfg);
  const items = cfg.missions && Array.isArray(cfg.missions.items) ? cfg.missions.items : DEFAULT_MISSIONS;
  const item = items.find(function (entry) { return entry.id === missionId; });
  if (!item || cfg.missions.enabled === false) return next;
  const step = Math.max(0, finite(amount, 1));
  const current = nonNegativeInt(next.missions.progress[missionId], 0);
  next.missions.progress[missionId] = Math.min(item.target, current + step);
  return next;
}

/**
 * Claim a completed daily mission once. Returns
 * { ok, awarded, points, reason } and mutates the state on success.
 */
export function claimDailyMission(state, missionId, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  const at = toTimestamp(now);
  resetMissionsIfNeeded(next, at, cfg);
  const items = cfg.missions && Array.isArray(cfg.missions.items) ? cfg.missions.items : DEFAULT_MISSIONS;
  const item = items.find(function (entry) { return entry.id === missionId; });
  if (!item) return { ok: false, awarded: false, reason: 'unknown_mission', state: next };
  if (cfg.missions.enabled === false) return { ok: false, awarded: false, reason: 'disabled', state: next };
  const progress = nonNegativeInt(next.missions.progress[missionId], 0);
  if (progress < item.target) return { ok: false, awarded: false, reason: 'not_complete', state: next };
  if (next.missions.claimed.indexOf(missionId) !== -1) {
    return { ok: false, awarded: false, reason: 'already_claimed', state: next };
  }
  next.missions.claimed.push(missionId);
  addPoints(next, item.points, { reason: 'mission:' + missionId });
  next.updatedAt = at;
  return { ok: true, awarded: true, points: item.points, reason: 'claimed', state: next };
}

/* ------------------------------------------------------------------ */
/* loss aversion / comeback (positive-only, never punitive)            */
/* ------------------------------------------------------------------ */

/**
 * Return a non-punitive "we miss you" prompt when the player has been away
 * for `inactiveDays` or more. It only offers a bonus; it never removes
 * points or reduces the leaderboard position.
 */
export function getReturnPrompt(state, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  const at = toTimestamp(now);
  const loss = cfg.lossAversion;
  if (!loss || loss.enabled === false) {
    return { shouldPrompt: false, eligible: false, reason: 'disabled', bonus: 0 };
  }
  const last = typeof next.lastPlayedAt === 'number' ? next.lastPlayedAt : null;
  if (!last) return { shouldPrompt: false, eligible: false, reason: 'no_history', bonus: 0 };
  const inactiveDays = Math.floor((at - last) / DAY_MS);
  const threshold = Math.max(1, finite(loss.inactiveDays, 3));
  const claimedToday = next.comeback.lastClaimDay === utcDay(at);
  const eligible = inactiveDays >= threshold && !claimedToday;
  return {
    shouldPrompt: eligible,
    eligible: eligible,
    inactiveDays: inactiveDays,
    bonus: eligible ? Math.max(0, loss.comebackBonus || 0) : 0,
    reason: eligible ? 'away' : (claimedToday ? 'already_claimed' : 'recently_played')
  };
}

/**
 * Record a finished game. A near miss (or a lost streak opportunity) grants a
 * once-per-day comeback bonus. Losses never deduct points.
 *
 * event: { result: 'win'|'loss'|'draw'|'near-miss', score?, nearMiss?, streakAtRisk? }
 */
export function recordGameResult(state, event, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  const at = toTimestamp(now);
  const data = isObject(event) ? event : {};
  const result = String(data.result || 'played');
  const today = utcDay(at);

  next.games += 1;
  next.lastPlayedAt = at;
  if (result === 'win') next.wins += 1;
  if (result === 'loss') next.losses += 1;
  recordMissionProgress(next, 'play-one', 1, at, cfg);
  if (finite(data.cardsPlayed, 0) > 0) {
    recordMissionProgress(next, 'play-cards', Math.floor(data.cardsPlayed), at, cfg);
  }

  let bonus = 0;
  let reason = null;
  const loss = cfg.lossAversion;
  const lossEligible = loss && loss.enabled !== false &&
    (result === 'near-miss' || data.nearMiss === true) &&
    next.lossAversion.day !== today &&
    (!loss.maxPerDay || next.lossAversion.count < loss.maxPerDay);
  if (lossEligible) {
    bonus = Math.floor(Math.max(0, loss.nearMissBonus || 0));
    if (bonus > 0) {
      next.lossAversion = { day: today, count: (next.lossAversion.count || 0) + 1 };
      addPoints(next, bonus, { reason: 'near_miss' });
      reason = 'near_miss';
    }
  }

  // Positive-only participation reward, capped per UTC day so the demo
  // cannot be farmed into an absurd local score.
  let playPoints = 0;
  const play = cfg.play || {};
  if (play.enabled !== false) {
    const table = {
      win: nonNegativeInt(play.winPoints, 20),
      draw: nonNegativeInt(play.drawPoints, 10),
      loss: nonNegativeInt(play.lossPoints, 5),
      'near-miss': nonNegativeInt(play.nearMissPoints, 5)
    };
    const wanted = table[result] == null ? table.loss : table[result];
    if (next.playRewardDay !== today) {
      next.playRewardDay = today;
      next.playRewardToday = 0;
    }
    const cap = nonNegativeInt(play.rewardCapPerDay, 120);
    const used = nonNegativeInt(next.playRewardToday, 0);
    playPoints = Math.min(wanted, Math.max(0, cap - used));
    if (playPoints > 0) {
      next.playRewardToday = used + playPoints;
      addPoints(next, playPoints, { reason: 'play:' + result });
    }
  }

  if (result === 'win') awardTrophy(next, 'first-win', { at: at, title: '首胜' });
  next.updatedAt = at;
  return {
    ok: true,
    state: next,
    awarded: bonus + playPoints,
    bonus: bonus,
    playPoints: playPoints,
    reason: reason
  };
}

/** Claim the away-player comeback bonus once per UTC day. */
export function claimComebackBonus(state, now, config) {
  const next = ensureState(state);
  const cfg = configFor(next, config);
  const at = toTimestamp(now);
  const prompt = getReturnPrompt(next, at, cfg);
  if (!prompt.eligible) {
    return { ok: false, awarded: false, reason: prompt.reason, state: next };
  }
  const today = utcDay(at);
  next.comeback.lastClaimDay = today;
  addPoints(next, prompt.bonus, { reason: 'comeback' });
  next.lastPlayedAt = at;
  next.updatedAt = at;
  return { ok: true, awarded: true, points: prompt.bonus, reason: 'comeback', state: next };
}

export function evaluateLossAversion(state, event, now, config) {
  return recordGameResult(state, event, now, config);
}

/* ------------------------------------------------------------------ */
/* anti-cheat                                                          */
/* ------------------------------------------------------------------ */

function antiCheatConfig(config) {
  const cfg = configFor(null, config);
  return cfg.antiCheat && typeof cfg.antiCheat === 'object' ? cfg.antiCheat : DEFAULT_CONFIG.antiCheat;
}

/**
 * Validate a client-claimed score against server-side limits. A client can
 * never be authoritative: `clientAuthoritative: true` is always rejected.
 */
export function validateScore(claim, config) {
  const limits = antiCheatConfig(config);
  if (!isObject(claim)) return { ok: false, valid: false, reason: 'invalid_claim' };
  if (claim.clientAuthoritative === true || claim.authoritative === 'client') {
    return { ok: false, valid: false, reason: 'client_not_authoritative' };
  }
  const score = finite(claim.score, NaN);
  if (!Number.isFinite(score)) return { ok: false, valid: false, reason: 'score_not_number' };
  if (score < 0) return { ok: false, valid: false, reason: 'score_negative' };
  if (score > limits.maxScore) {
    return { ok: false, valid: false, reason: 'score_above_cap', maxScore: limits.maxScore };
  }
  if (claim.durationMs != null) {
    const duration = finite(claim.durationMs, NaN);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, valid: false, reason: 'invalid_duration' };
    }
  }
  return { ok: true, valid: true, score: Math.floor(score), maxScore: limits.maxScore };
}

export const validateResult = validateScore;

/** Rate-limit check for one player id. Returns { ok, waitMs }. */
export function checkRateLimit(state, playerId, at, config) {
  const next = ensureState(state);
  const limits = antiCheatConfig(config);
  const when = toTimestamp(at);
  const submissions = next.submissions;
  let last = null;
  for (const submission of submissions) {
    if (!submission || submission.playerId !== playerId) continue;
    if (last == null || submission.at > last) last = submission.at;
  }
  if (last == null) return { ok: true, waitMs: 0 };
  const elapsed = when - last;
  if (elapsed < limits.minIntervalMs) {
    return { ok: false, reason: 'rate_limited', waitMs: Math.max(0, limits.minIntervalMs - elapsed) };
  }
  return { ok: true, waitMs: 0 };
}

/** Clamp an untrusted score into the allowed range. */
export function sanitizeScore(score, config) {
  const limits = antiCheatConfig(config);
  const value = finite(score, 0);
  return clamp(Math.floor(value), 0, limits.maxScore);
}

/* ------------------------------------------------------------------ */
/* leaderboard (local mirror + injectable remote)                      */
/* ------------------------------------------------------------------ */

function bestEntries(state) {
  const best = new Map();
  function consider(entry) {
    if (!entry || typeof entry !== 'object') return;
    const playerId = String(entry.playerId == null ? entry.player_id : entry.playerId);
    const score = finite(entry.score, NaN);
    if (!playerId || !Number.isFinite(score)) return;
    const normalized = {
      playerId: playerId,
      label: entry.label ? String(entry.label) : '匿名玩家',
      score: Math.max(0, Math.floor(score)),
      at: toTimestamp(entry.at),
      rank: 0
    };
    const previous = best.get(playerId);
    if (!previous || normalized.score > previous.score ||
      (normalized.score === previous.score && normalized.at < previous.at)) {
      best.set(playerId, normalized);
    }
  }
  state.entries.forEach(consider);
  state.scores.forEach(consider);
  const list = Array.from(best.values()).sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.at - b.at;
  });
  list.forEach(function (entry, index) { entry.rank = index + 1; });
  return list;
}

/**
 * Dual-purpose leaderboard API, backed by the local state:
 *
 *   submit: getLeaderboard(state, { playerId, score, at }) -> result object
 *   read:   getLeaderboard(state)                          -> sorted array
 *   read:   getLeaderboard(state, null, { limit: 10 })     -> sorted array
 *
 * A remote implementation can be injected with `options.remote` (object with
 * submitScore / getLeaderboard). It is only used by syncLeaderboard() and
 * never makes the client authoritative.
 */
export function getLeaderboard(state, submission, options) {
  const next = ensureState(state);
  const opts = isObject(options) ? options : {};
  const cfg = configFor(next, opts.config);
  const limits = cfg.antiCheat && typeof cfg.antiCheat === 'object' ? cfg.antiCheat : DEFAULT_CONFIG.antiCheat;
  const when = toTimestamp(opts.now);

  if (!isObject(submission)) {
    const list = bestEntries(next);
    return typeof opts.limit === 'number' && opts.limit > 0 ? list.slice(0, opts.limit) : list;
  }

  const validation = validateScore({
    score: submission.score,
    clientAuthoritative: submission.clientAuthoritative === true,
    durationMs: submission.durationMs
  }, cfg);
  if (!validation.ok) return validation;

  const playerId = String(submission.playerId == null ? 'anonymous' : submission.playerId);
  if (PII_PATTERN.test(playerId)) {
    return { ok: false, valid: false, reason: 'player_id_looks_personal' };
  }
  const at = submission.at == null ? when : toTimestamp(submission.at);
  const rate = checkRateLimit(next, playerId, at, cfg);
  if (!rate.ok) return rate;

  const score = validation.score;
  const entry = { playerId: playerId, label: '匿名玩家', score: score, at: at };
  next.submissions.push({ playerId: playerId, score: score, at: at });
  if (next.submissions.length > 200) next.submissions.splice(0, next.submissions.length - 200);
  next.scores.push({ playerId: playerId, score: score, at: at });
  if (next.scores.length > 200) next.scores.splice(0, next.scores.length - 200);

  const existing = next.entries.find(function (item) { return item && item.playerId === playerId; });
  if (!existing || existing.score < score) {
    if (existing) {
      existing.score = score;
      existing.at = at;
    } else {
      next.entries.push(entry);
    }
  }
  next.updatedAt = at;
  const list = bestEntries(next);
  const rank = list.findIndex(function (item) { return item.playerId === playerId; }) + 1;
  return { ok: true, valid: true, accepted: true, entry: entry, rank: rank, leaderboard: list };
}

export const leaderboard = getLeaderboard;
export const submitScore = getLeaderboard;

/**
 * Merge a remote leaderboard snapshot into the local mirror. The remote
 * payload is data only; scores still go through validateScore so a hostile
 * or buggy server response cannot inject absurd values.
 */
export function mergeRemoteLeaderboard(state, remoteEntries, config) {
  const next = ensureState(state);
  if (!Array.isArray(remoteEntries)) return next;
  const limits = antiCheatConfig(config);
  remoteEntries.forEach(function (entry) {
    if (!entry || typeof entry !== 'object') return;
    const score = finite(entry.score, NaN);
    if (!Number.isFinite(score) || score < 0 || score > limits.maxScore) return;
    const playerId = String(entry.playerId == null ? entry.player_id : entry.playerId);
    if (!playerId) return;
    const normalized = { playerId: playerId, label: entry.label ? String(entry.label) : '匿名玩家', score: Math.floor(score), at: toTimestamp(entry.at) };
    const index = next.entries.findIndex(function (item) { return item && item.playerId === playerId; });
    if (index === -1) next.entries.push(normalized);
    else if (next.entries[index].score < normalized.score) next.entries[index] = normalized;
  });
  return next;
}

/**
 * Optional remote sync. `remote` must expose getLeaderboard(options) and/or
 * submitScore(entry). Failures degrade to the local mirror; nothing throws.
 */
export async function syncLeaderboard(state, remote) {
  const next = ensureState(state);
  if (!remote || typeof remote !== 'object') {
    return { ok: false, reason: 'no_remote', state: next };
  }
  try {
    let merged = next;
    if (typeof remote.getLeaderboard === 'function') {
      const snapshot = await remote.getLeaderboard({ playerId: next.playerId || null });
      const entries = Array.isArray(snapshot) ? snapshot
        : (snapshot && Array.isArray(snapshot.entries) ? snapshot.entries : null);
      if (entries) merged = mergeRemoteLeaderboard(next, entries);
    }
    if (typeof remote.submitScore === 'function') {
      const mine = bestEntries(merged).find(function (entry) {
        return entry.playerId === merged.playerId;
      });
      if (mine) await remote.submitScore(mine);
    }
    return { ok: true, state: merged, leaderboard: bestEntries(merged) };
  } catch (err) {
    return { ok: false, reason: 'remote_unavailable', error: String(err && err.message ? err.message : err), state: next };
  }
}

export function createLeaderboardClient(options) {
  const opts = isObject(options) ? options : {};
  const remote = opts.remote || null;
  return {
    submit: function (state, submission) { return getLeaderboard(state, submission, opts); },
    read: function (state, readOptions) {
      return getLeaderboard(state, null, Object.assign({}, opts, readOptions || {}));
    },
    sync: function (state) { return syncLeaderboard(state, remote); },
    remote: remote
  };
}

/* ------------------------------------------------------------------ */
/* share payload                                                       */
/* ------------------------------------------------------------------ */

function shareText(data) {
  const resultLabel = data.result === 'win' ? '获胜'
    : data.result === 'loss' ? '惜败'
      : data.result === 'draw' ? '战平' : '完赛';
  let text = '桌游对局' + resultLabel;
  if (typeof data.score === 'number') text += '，得分 ' + Math.floor(data.score);
  if (typeof data.rank === 'number' && data.rank > 0) text += '，第 ' + Math.floor(data.rank) + ' 名';
  return text + '。来挑战我！';
}

/**
 * Build a public, PII-free share payload for the result page. Only match id,
 * result, score, rank, a short title/text and a site URL are included.
 */
export function buildSharePayload(match, config) {
  const data = isObject(match) ? match : {};
  const cfg = configFor(null, config);
  const template = cfg.share && typeof cfg.share.urlTemplate === 'string'
    ? cfg.share.urlTemplate
    : DEFAULT_CONFIG.share.urlTemplate;
  const matchId = data.matchId == null ? 'local' : String(data.matchId).slice(0, 64);
  const result = typeof data.result === 'string' ? data.result.slice(0, 24) : 'played';
  const score = Number.isFinite(data.score) ? Math.max(0, Math.floor(data.score)) : undefined;
  const rank = Number.isFinite(data.rank) ? Math.max(1, Math.floor(data.rank)) : undefined;

  const payload = {
    matchId: matchId,
    result: result,
    title: '桌游对局成绩',
    text: shareText({ result: result, score: score, rank: rank }),
    url: template.replace('{matchId}', encodeURIComponent(matchId))
  };
  if (score !== undefined) payload.score = score;
  if (rank !== undefined) payload.rank = rank;
  return payload;
}

export const createSharePayload = buildSharePayload;
export const sharePayload = buildSharePayload;

export function shareTextFor(payload) {
  if (!payload || typeof payload !== 'object') return '';
  return (payload.text || '') + ' ' + (payload.url || '');
}

/* ------------------------------------------------------------------ */
/* convenience aggregate for the rewards page                          */
/* ------------------------------------------------------------------ */

/** Build a display snapshot for play/rewards.html. */
export function getRetentionSnapshot(state, now) {
  const next = ensureState(state);
  const at = toTimestamp(now);
  const level = levelDetails(next.points);
  return {
    points: next.points,
    level: level.level,
    levelTitle: level.title,
    levelProgress: level.progress,
    nextLevelAt: level.nextAt,
    streak: next.streak,
    trophies: next.trophies.slice(),
    missions: getDailyMissions(next, at),
    returnPrompt: getReturnPrompt(next, at),
    games: next.games,
    wins: next.wins,
    losses: next.losses
  };
}
