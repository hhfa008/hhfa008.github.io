'use strict';

/*
 * 留存：每日目标、连续天数、损失厌恶奖励。
 *
 * - 每日目标 3 局；同日达到 3 局后生成待领取奖励，24 小时内不领会过期。
 * - 连续天数按 UTC 日期计算，断一天就从 1 重新开始，best 保留历史最高。
 * - 持久化键 boardgame.retention.v1；storage 抛错时自动降级为内存状态。
 */

import { getOrCreateDeviceId } from './leaderboard.js';

const STORAGE_KEY = 'boardgame.retention.v1';
const DAILY_TARGET = 3;
const REWARD_POINTS = 50;
const REWARD_TTL = 24 * 60 * 60 * 1000;

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) {
    /* ignore */
  }
  return null;
}

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function previousDayKey(timestamp) {
  return dayKey(timestamp - 24 * 60 * 60 * 1000);
}

function defaultState(nowMs) {
  return {
    daily: {
      date: dayKey(nowMs),
      played: 0,
      wins: 0,
      target: DAILY_TARGET,
      completed: false,
      streakDays: 0
    },
    streak: {
      current: 0,
      best: 0,
      lastPlayedDate: null
    },
    lossAversion: {
      pendingReward: null,
      expiresAt: null,
      lost: false,
      claimed: false
    }
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createRetention(options) {
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
    if (!raw) return defaultState(now());
    try {
      memory = JSON.parse(raw);
    } catch (err) {
      return defaultState(now());
    }
    return memory;
  }

  function save(state) {
    memory = state;
    try {
      if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* 降级为内存状态 */
    }
  }

  function expireReward(state, nowMs) {
    const loss = state.lossAversion;
    if (loss.pendingReward == null) return state;
    if (loss.expiresAt != null && nowMs >= loss.expiresAt) {
      loss.pendingReward = null;
      loss.expiresAt = null;
      loss.lost = true;
    }
    return state;
  }

  function rollDaily(state, nowMs) {
    const today = dayKey(nowMs);
    if (state.daily.date !== today) {
      state.daily.date = today;
      state.daily.played = 0;
      state.daily.wins = 0;
      state.daily.completed = false;
      // 昨天的待领奖励保留到 24h 过期；已领/已过期标记在新的一天清掉。
      if (state.lossAversion.pendingReward == null && state.lossAversion.claimed) {
        state.lossAversion.claimed = false;
        state.lossAversion.lost = false;
      }
    }
    state.daily.streakDays = state.streak.current;
    return state;
  }

  function touchStreak(state, nowMs) {
    const today = dayKey(nowMs);
    if (state.streak.lastPlayedDate === today) return state;
    if (state.streak.lastPlayedDate === previousDayKey(nowMs)) {
      state.streak.current += 1;
    } else {
      state.streak.current = 1;
    }
    state.streak.lastPlayedDate = today;
    state.streak.best = Math.max(state.streak.best, state.streak.current);
    state.daily.streakDays = state.streak.current;
    return state;
  }

  function getState() {
    const nowMs = now();
    const state = expireReward(load(), nowMs);
    save(state);
    return {
      daily: Object.assign({}, state.daily),
      streak: Object.assign({}, state.streak),
      lossAversion: Object.assign({}, state.lossAversion)
    };
  }

  function recordPlay(input) {
    const nowMs = now();
    const play = input || {};
    const state = expireReward(load(), nowMs);
    rollDaily(state, nowMs);
    state.daily.played += 1;
    if (play.won) state.daily.wins += 1;
    if (state.daily.played >= DAILY_TARGET) state.daily.completed = true;
    touchStreak(state, nowMs);
    state.daily.streakDays = state.streak.current;

    const loss = state.lossAversion;
    if (state.daily.completed && loss.pendingReward == null && !loss.claimed) {
      loss.pendingReward = REWARD_POINTS;
      loss.expiresAt = nowMs + REWARD_TTL;
      loss.lost = false;
    }
    save(state);
    return {
      daily: Object.assign({}, state.daily),
      streak: Object.assign({}, state.streak),
      lossAversion: Object.assign({}, loss)
    };
  }

  function claimDaily() {
    const nowMs = now();
    const state = expireReward(load(), nowMs);
    const loss = state.lossAversion;
    if (loss.pendingReward == null) {
      save(state);
      if (!state.daily.completed) return { ok: false, code: 'E_NOT_DONE', lost: Boolean(loss.lost) };
      if (loss.lost) return { ok: false, code: 'E_EXPIRED', lost: true };
      return { ok: false, code: 'E_CLAIMED', lost: false };
    }
    const points = loss.pendingReward;
    loss.pendingReward = null;
    loss.expiresAt = null;
    loss.claimed = true;
    loss.lost = false;
    save(state);
    return { ok: true, points: points, lost: false };
  }

  function reset() {
    const fresh = defaultState(now());
    save(fresh);
    return clone(fresh);
  }

  return {
    recordPlay: recordPlay,
    getState: getState,
    claimDaily: claimDaily,
    reset: reset
  };
}

/* ---------- C 模块契约兼容接口（app/retention.js 测试） ---------- */

const DAY_MS = 24 * 60 * 60 * 1000;

export function createRetentionConfig(overrides) {
  const base = {
    daily: { enabled: true, points: 50, cooldownHours: 24 },
    streak: { enabled: true, bonusPerDay: 5, maxDays: 30 },
    lossAversion: { enabled: true, comebackBonus: 20, nearMissBonus: 10, expiresHours: 24 },
    antiCheat: {
      maxScore: 100000,
      minIntervalMs: 1000,
      serverAuthoritative: true,
      // 基础防作弊：异常短局、零动作、超长回合、伪造的玩家 id 都不进榜。
      minDurationMs: 1000,
      minActions: 1,
      maxTurns: 500,
      deviceIdPattern: '^dev_[a-f0-9]{32}$'
    }
  };
  if (!overrides || typeof overrides !== 'object') return base;
  return {
    daily: Object.assign({}, base.daily, overrides.daily),
    streak: Object.assign({}, base.streak, overrides.streak),
    lossAversion: Object.assign({}, base.lossAversion, overrides.lossAversion),
    antiCheat: Object.assign({}, base.antiCheat, overrides.antiCheat)
  };
}

export const retentionConfig = createRetentionConfig();
export const DEFAULT_RETENTION = retentionConfig;

function dayNumber(timestamp) {
  return Math.floor(Number(timestamp) / DAY_MS);
}

export function recordDailyLogin(state, at) {
  const target = state || {};
  const nowMs = Number.isFinite(at) ? at : Date.now();
  const config = createRetentionConfig();
  const today = dayNumber(nowMs);
  const lastAt = Number.isFinite(target.lastLoginAt) ? target.lastLoginAt : null;
  const lastDay = lastAt == null ? null : dayNumber(lastAt);
  target.points = Number(target.points) || 0;
  target.streak = Number(target.streak) || 0;
  target.lastLoginAt = nowMs;

  if (lastDay === today) return target;
  if (lastDay == null) {
    target.streak = 1;
  } else if (today - lastDay === 1) {
    target.streak = Math.min(config.streak.maxDays, target.streak + 1);
  } else {
    target.streak = 1;
  }
  const bonus = Math.max(0, target.streak - 1) * config.streak.bonusPerDay;
  target.points += config.daily.points + bonus;
  target.lastLoginDay = today;
  return target;
}

export function updateStreak(state, at) {
  const target = state || {};
  const nowMs = Number.isFinite(at) ? at : Date.now();
  const lastAt = Number.isFinite(target.lastLoginAt) ? target.lastLoginAt : null;
  if (lastAt == null) return { streak: 1 };
  const diff = dayNumber(nowMs) - dayNumber(lastAt);
  if (diff === 0) return { streak: target.streak || 1 };
  if (diff === 1) return { streak: (target.streak || 0) + 1 };
  return { streak: 1 };
}

export function getStreak(state) {
  return Number(state && state.streak) || 0;
}

export function levelForPoints(points) {
  const value = Number(points) || 0;
  if (value >= 1500) return 5;
  if (value >= 700) return 4;
  if (value >= 300) return 3;
  if (value >= 100) return 2;
  return 1;
}

export function addPoints(state, points) {
  const target = state || {};
  const delta = Number(points) || 0;
  const current = Number(target.points) || 0;
  target.points = Math.max(0, current + delta);
  return target;
}

export function awardTrophy(state, trophyId) {
  const target = state || {};
  if (!Array.isArray(target.trophies)) target.trophies = [];
  if (trophyId != null && target.trophies.indexOf(trophyId) === -1) {
    target.trophies.push(trophyId);
  }
  return target;
}

export function buildSharePayload(input) {
  const opts = input || {};
  const title = typeof opts.title === 'string' && opts.title ? opts.title : '桌游对局';
  const result = opts.result == null ? '' : String(opts.result);
  const score = Number.isFinite(opts.score) ? opts.score : 0;
  const rank = Number.isFinite(opts.rank) ? opts.rank : null;
  const matchId = opts.matchId == null ? '' : String(opts.matchId);
  const text = title + (result ? ' · ' + result : '') + ' · ' + score + ' 分' +
    (rank != null ? ' · 第 ' + rank + ' 名' : '') + (matchId ? ' · ' + matchId : '');
  return {
    title: title,
    text: text,
    url: 'share.html' + (matchId ? '?match=' + encodeURIComponent(matchId) : ''),
    matchId: matchId,
    result: result,
    score: score,
    rank: rank
  };
}

export function getLeaderboard(state, entry) {
  const target = state || {};
  if (!Array.isArray(target.scores)) target.scores = [];
  if (!Array.isArray(target.entries)) target.entries = [];
  if (!Array.isArray(target.submissions)) target.submissions = [];

  if (!entry) {
    return target.entries.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  }

  const config = createRetentionConfig();
  const score = entry.score;
  const at = Number.isFinite(entry.at) ? entry.at : Date.now();
  if (!Number.isInteger(score) || score < 0 || score > config.antiCheat.maxScore) {
    return { ok: false, error: 'score out of range' };
  }
  const previous = target.submissions
    .filter(function (item) { return item.playerId === entry.playerId; })
    .sort(function (a, b) { return b.at - a.at; })[0];
  if (previous && at - previous.at < config.antiCheat.minIntervalMs) {
    return { ok: false, error: 'submitted too quickly' };
  }
  const record = { playerId: entry.playerId, score: score, at: at };
  target.submissions.push(record);
  target.scores.push(record);
  target.entries.push(record);
  return { ok: true, entry: record };
}

export function validateScore(input) {
  const config = createRetentionConfig();
  const value = input || {};
  if (value.clientAuthoritative) return { ok: false, reason: 'client authoritative score rejected' };
  const score = Number(value.score);
  if (!Number.isInteger(score) || score < 0 || score > config.antiCheat.maxScore) {
    return { ok: false, reason: 'score out of range' };
  }

  // Optional fields are enforced only when supplied. The board integration
  // always supplies duration/turns/actions/deviceId.
  let durationMs = null;
  if (value.durationMs !== undefined) {
    durationMs = Number(value.durationMs);
    if (!Number.isFinite(durationMs) || durationMs < config.antiCheat.minDurationMs) {
      return { ok: false, reason: 'match duration below minimum' };
    }
  }

  let turns = null;
  if (value.turns !== undefined) {
    turns = Number(value.turns);
    if (!Number.isInteger(turns) || turns < 1 || turns > config.antiCheat.maxTurns) {
      return { ok: false, reason: 'turn count out of range' };
    }
  }

  let actions = null;
  if (value.actions !== undefined) {
    actions = Number(value.actions);
    if (!Number.isInteger(actions) || actions < config.antiCheat.minActions) {
      return { ok: false, reason: 'action count below minimum' };
    }
  }

  if (value.deviceId !== undefined) {
    if (typeof value.deviceId !== 'string' ||
      !new RegExp(config.antiCheat.deviceIdPattern).test(value.deviceId)) {
      return { ok: false, reason: 'invalid device id' };
    }
  }

  return { ok: true, score: score, durationMs: durationMs, turns: turns, actions: actions };
}

export function getDeviceId(storage) {
  return getOrCreateDeviceId(storage);
}

export default { createRetention: createRetention };
