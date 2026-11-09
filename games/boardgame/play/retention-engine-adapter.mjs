'use strict';

/*
 * Compatibility adapter for the rewards page.
 *
 * Points, streak thresholds, leaderboard validation and share payloads come
 * from ../app/retention.js and ../app/rewards.js. This adapter only wires the
 * page's progress object to those engines and adds the small, purely local
 * mission/comeback bookkeeping that the original page renders.
 */

import {
  recordDailyLogin as engineRecordDailyLogin,
  addPoints,
  awardTrophy,
  buildSharePayload as engineBuildSharePayload,
  getLeaderboard as engineGetLeaderboard,
  getDeviceId as engineGetDeviceId,
  retentionConfig
} from '../app/retention.js';
import { LEVELS } from '../app/rewards.js';

const STORAGE_KEY = 'boardgame.play-progress.v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const LEVEL_TITLES = {
  1: '青铜牌手',
  2: '白银牌手',
  3: '黄金牌手',
  4: '铂金牌手',
  5: '钻石牌手'
};

const MISSION_DEFS = [
  { id: 'play-once', title: '完成 1 局对局', target: 1, points: 10 },
  { id: 'cards-8', title: '打出 8 张牌', target: 8, points: 10 },
  { id: 'share-once', title: '分享一次成绩', target: 1, points: 10 }
];

function utcDay(now) {
  return Math.floor((now == null ? Date.now() : now) / DAY_MS);
}

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

export function createEmptyProgress(now) {
  return {
    version: 1,
    points: 0,
    streak: 0,
    lastLoginAt: null,
    lastLoginDay: null,
    lastDailyAward: 0,
    dailyAwarded: false,
    games: 0,
    wins: 0,
    trophies: [],
    entries: [],
    scores: [],
    submissions: [],
    missions: { day: null, items: {} },
    lastComebackDay: null,
    demoSeeded: false,
    lastMatch: null,
    createdAt: now == null ? Date.now() : now
  };
}

export function loadProgress(storage) {
  const store = safeStorage(storage);
  if (!store) return null;
  let raw = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (err) {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

export function saveProgress(state, storage) {
  const store = safeStorage(storage);
  if (!store || !state) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    return false;
  }
}

export function getDeviceId(storage) {
  return engineGetDeviceId(safeStorage(storage));
}

export function levelDetails(points) {
  const value = Math.max(0, Number(points) || 0);
  let current = LEVELS[0];
  let next = null;
  for (let i = 0; i < LEVELS.length; i += 1) {
    if (value >= LEVELS[i].min) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }
  const span = next ? next.min - current.min : 1;
  const progress = next ? Math.max(0, Math.min(1, (value - current.min) / span)) : 1;
  return {
    level: current.level,
    tier: current.tier,
    title: LEVEL_TITLES[current.level] || ('等级 ' + current.level),
    progress: progress,
    nextAt: next ? next.min : null
  };
}

export function recordDailyLogin(state, now) {
  const before = Number(state.points) || 0;
  engineRecordDailyLogin(state, now == null ? Date.now() : now);
  const delta = Math.max(0, (Number(state.points) || 0) - before);
  state.lastDailyAward = delta;
  state.dailyAwarded = delta > 0;
  return state;
}

function ensureMissionDay(state, now) {
  const day = utcDay(now);
  if (!state.missions || state.missions.day !== day) {
    const items = {};
    MISSION_DEFS.forEach(function (def) {
      items[def.id] = { progress: 0, claimed: false };
    });
    state.missions = { day: day, items: items };
  }
  if (!state.missions.items) state.missions.items = {};
  MISSION_DEFS.forEach(function (def) {
    if (!state.missions.items[def.id]) state.missions.items[def.id] = { progress: 0, claimed: false };
  });
  return state.missions;
}

export function getDailyMissions(state, now) {
  const missions = ensureMissionDay(state, now);
  return MISSION_DEFS.map(function (def) {
    const item = missions.items[def.id];
    return {
      id: def.id,
      title: def.title,
      points: def.points,
      target: def.target,
      progress: Math.max(0, item.progress || 0),
      claimed: Boolean(item.claimed),
      complete: (item.progress || 0) >= def.target
    };
  });
}

export function recordMissionProgress(state, missionId, delta, now) {
  const missions = ensureMissionDay(state, now);
  const item = missions.items[missionId];
  if (!item) return { ok: false };
  item.progress = Math.max(0, (item.progress || 0) + (Number(delta) || 0));
  return { ok: true, progress: item.progress };
}

export function claimDailyMission(state, missionId, now) {
  const missions = ensureMissionDay(state, now);
  const def = MISSION_DEFS.find(function (item) { return item.id === missionId; });
  const item = missions.items[missionId];
  if (!def || !item) return { ok: false, reason: 'unknown' };
  if (item.claimed) return { ok: false, reason: 'already_claimed' };
  if ((item.progress || 0) < def.target) return { ok: false, reason: 'not_complete' };
  item.claimed = true;
  addPoints(state, def.points);
  return { ok: true, points: def.points };
}

export function recordGameResult(state, input, now) {
  const opts = input || {};
  const at = now == null ? Date.now() : now;
  state.games = (state.games || 0) + 1;
  if (opts.result === 'win') {
    state.wins = (state.wins || 0) + 1;
    awardTrophy(state, 'first-win');
  }
  const playPoints = 5;
  const bonus = opts.nearMiss ? (retentionConfig.lossAversion.nearMissBonus || 10) : 0;
  addPoints(state, playPoints + bonus);
  recordMissionProgress(state, 'play-once', 1, at);
  recordMissionProgress(state, 'cards-8', Math.max(0, Number(opts.cardsPlayed) || 0), at);
  return { playPoints: playPoints, bonus: bonus };
}

export function getReturnPrompt(state, now) {
  const at = now == null ? Date.now() : now;
  if (typeof state.lastLoginAt !== 'number') return { eligible: false };
  const inactiveDays = Math.max(0, Math.floor((at - state.lastLoginAt) / DAY_MS));
  const eligible = inactiveDays >= 3 && state.lastComebackDay !== utcDay(at);
  return {
    eligible: eligible,
    inactiveDays: inactiveDays,
    bonus: retentionConfig.lossAversion.comebackBonus || 20
  };
}

export function claimComebackBonus(state, now) {
  const at = now == null ? Date.now() : now;
  const prompt = getReturnPrompt(state, at);
  if (!prompt.eligible) return { ok: false, reason: 'not_eligible' };
  state.lastComebackDay = utcDay(at);
  addPoints(state, prompt.bonus);
  return { ok: true, points: prompt.bonus };
}

export function createLeaderboardClient(options) {
  void options;
  return {
    read: function read(state, readOptions) {
      const limit = Math.max(1, (readOptions && readOptions.limit) || 10);
      const entries = Array.isArray(state.entries) ? state.entries.slice() : [];
      return entries
        .sort(function (a, b) { return (b.score || 0) - (a.score || 0); })
        .slice(0, limit)
        .map(function (entry, index) {
          return {
            rank: index + 1,
            playerId: entry.playerId,
            label: entry.label,
            score: entry.score,
            at: entry.at
          };
        });
    }
  };
}

export function getLeaderboard(state, entry, options) {
  void options;
  if (!Array.isArray(state.scores)) state.scores = [];
  if (!Array.isArray(state.entries)) state.entries = [];
  if (!Array.isArray(state.submissions)) state.submissions = [];
  const result = engineGetLeaderboard(state, entry);
  if (!result || result.ok !== true) {
    return { ok: false, reason: result && result.error, error: result && result.error };
  }
  const sorted = state.entries.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
  const rank = sorted.findIndex(function (item) {
    return item.playerId === result.entry.playerId && item.at === result.entry.at && item.score === result.entry.score;
  });
  return { ok: true, rank: rank === -1 ? null : rank + 1, entry: result.entry };
}

export function buildSharePayload(match) {
  return engineBuildSharePayload(match);
}

export function shareTextFor(payload) {
  if (!payload) return '';
  return payload.text + (payload.url ? ' ' + payload.url : '');
}
