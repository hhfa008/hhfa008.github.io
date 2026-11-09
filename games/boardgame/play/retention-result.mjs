'use strict';

/*
 * Result-page retention wiring shared by card-battle and mahjong.
 *
 * One match produces exactly one ledger entry:
 *   - points are computed by computeMatchPoints() from the public match stats
 *   - the unified play progress (boardgame.play-progress.v1) accumulates the
 *     points, first-play / first-win trophies and daily mission progress
 *   - updateStreak() / recordDailyLogin() keep the streak and daily login bonus
 *   - createRetention().recordPlay() tracks the "3 games per day" reward and
 *     claimDailyReward() claims it through claimDaily()
 *   - validateScore() rejects impossible scores *before* createLeaderboard
 *     .submit() writes anything; the match id is the leaderboard nonce so the
 *     same match cannot be submitted twice
 *
 * Everything is local-only (localStorage). There is no server, no account and
 * no personal data: the leaderboard stores only sha256(salt + anonymous device
 * id), and clearing browser storage resets both the progress and the board.
 */

import {
  addPoints,
  awardTrophy,
  buildSharePayload,
  createRetention,
  levelForPoints,
  updateStreak,
  validateScore
} from '../app/retention.js';
import { createLeaderboard, getOrCreateDeviceId } from '../app/leaderboard.js';
import {
  createEmptyProgress,
  getDailyMissions,
  levelDetails,
  loadProgress,
  recordDailyLogin,
  recordMissionProgress,
  saveProgress,
  shareTextFor
} from './retention-engine-adapter.mjs';

/*
 * 积分公式（也展示在结果页文案里）：
 *   卡牌对战
 *     胜：100 + 剩余奖赏 × 10（最多 6 张 = 60）
 *         + 速胜奖励：max(0, 30 - 回合数) × 2，最多 +40
 *     负：20
 *     平：50
 *   麻将
 *     胜：100 + 番数 × 10（最多 6 番 = 60）
 *         + 余牌奖励：floor(剩余牌墙 / 5)，最多 +40
 *         + 自摸奖励 20
 *     负：20
 *     流局（平）：50
 */
export const POINT_RULES = Object.freeze({
  win: 100,
  draw: 50,
  loss: 20,
  prizeBonus: 10,
  maxPrizeBonus: 60,
  speedTurnBudget: 30,
  speedBonusPerTurn: 2,
  speedBonusCap: 40,
  hanBonus: 10,
  maxHanBonus: 60,
  wallPerBonus: 5,
  wallBonusCap: 40,
  tsumoBonus: 20,
  maxScore: 100000
});

const GAME_TITLES = {
  'card-battle': '卡牌对战',
  mahjong: '麻将'
};

const RESULT_LABELS = {
  win: '胜利',
  loss: '惜败',
  draw: '平局'
};

export const TROPHY_LABELS = Object.freeze({
  'first-play': '首次对局',
  'first-win': '首次胜利',
  'matches-10': '完成 10 局',
  'streak-3': '连胜 3 天'
});

export function trophyLabel(id) {
  return TROPHY_LABELS[id] || String(id || '奖杯');
}

export function newMatchId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
  } catch (err) {
    /* fall through to the timestamp+random id */
  }
  return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

export function formatShortDeviceId(id) {
  if (typeof id !== 'string' || id.length < 12) return '匿名';
  return id.slice(0, 8) + '…' + id.slice(-4);
}

function nonNegativeInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function normaliseGame(value) {
  return value === 'mahjong' ? 'mahjong' : 'card-battle';
}

function normaliseResult(value) {
  return value === 'win' || value === 'draw' || value === 'loss' ? value : 'loss';
}

export function computeMatchPoints(input) {
  const opts = input || {};
  const game = normaliseGame(opts.game);
  const result = normaliseResult(opts.result);
  const base = result === 'win' ? POINT_RULES.win
    : (result === 'draw' ? POINT_RULES.draw : POINT_RULES.loss);
  let bonus = 0;
  const parts = [];

  if (result === 'win' && game === 'card-battle') {
    const prizes = Math.min(6, nonNegativeInt(opts.remainingPrizes, 0));
    const prizeBonus = Math.min(POINT_RULES.maxPrizeBonus, prizes * POINT_RULES.prizeBonus);
    const turns = Math.min(POINT_RULES.speedTurnBudget, nonNegativeInt(opts.turns, POINT_RULES.speedTurnBudget));
    const speedBonus = Math.min(
      POINT_RULES.speedBonusCap,
      Math.max(0, POINT_RULES.speedTurnBudget - turns) * POINT_RULES.speedBonusPerTurn
    );
    bonus += prizeBonus + speedBonus;
    if (prizeBonus > 0) parts.push('剩余奖赏 ' + prizes + ' 张 +' + prizeBonus);
    if (speedBonus > 0) parts.push('速胜 +' + speedBonus);
  }

  if (result === 'win' && game === 'mahjong') {
    const han = Math.min(6, nonNegativeInt(opts.han, 0));
    const hanBonus = Math.min(POINT_RULES.maxHanBonus, han * POINT_RULES.hanBonus);
    const remainingTiles = nonNegativeInt(opts.remainingTiles, 0);
    const wallBonus = Math.min(POINT_RULES.wallBonusCap,
      Math.floor(remainingTiles / POINT_RULES.wallPerBonus));
    const tsumoBonus = opts.tsumo === true ? POINT_RULES.tsumoBonus : 0;
    bonus += hanBonus + wallBonus + tsumoBonus;
    if (hanBonus > 0) parts.push(han + ' 番 +' + hanBonus);
    if (wallBonus > 0) parts.push('余牌 +' + wallBonus);
    if (tsumoBonus > 0) parts.push('自摸 +' + tsumoBonus);
  }

  return {
    game: game,
    result: result,
    base: base,
    bonus: bonus,
    total: base + bonus,
    parts: parts
  };
}

function safeStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

function defaultCopy(text) {
  return (async function () {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      /* fall through to the legacy path */
    }
    try {
      if (typeof document === 'undefined') return false;
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  })();
}

function absoluteUrl(url, location) {
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  try {
    if (location && location.href) return new URL(url, location.href).href;
  } catch (err) {
    /* keep the relative url */
  }
  return url;
}

/*
 * Prefer the Web Share API; otherwise copy the buildSharePayload() text.
 * Injectable navigator/copy keep this testable without a browser.
 */
export async function shareOrCopy(payload, options) {
  const opts = options || {};
  const nav = opts.navigator || (typeof navigator !== 'undefined' ? navigator : null);
  const text = shareTextFor(payload);
  if (!payload) return { method: 'manual', copied: false, text: '' };

  if (nav && typeof nav.share === 'function') {
    try {
      const data = { title: payload.title, text: payload.text };
      const url = absoluteUrl(payload.url, opts.location);
      if (url) data.url = url;
      await nav.share(data);
      return { method: 'share', copied: true, text: text };
    } catch (err) {
      if (err && err.name === 'AbortError') return { method: 'aborted', copied: false, text: text };
      /* sharing failed: fall back to copying */
    }
  }

  const copy = typeof opts.copy === 'function' ? opts.copy : defaultCopy;
  let copied = false;
  try {
    copied = await copy(text);
  } catch (err) {
    copied = false;
  }
  return { method: copied === false ? 'manual' : 'copy', copied: copied !== false, text: text };
}

export function createResultTracker(options) {
  const opts = options || {};
  const gameId = normaliseGame(opts.gameId);
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const storage = safeStorage(opts.storage);
  const board = createLeaderboard({ storage: storage, now: now, salt: 'boardgame', maxScore: POINT_RULES.maxScore });
  const retention = createRetention({ storage: storage, now: now });
  const deviceId = getOrCreateDeviceId(storage);

  function currentState() {
    const saved = loadProgress(storage);
    return Object.assign(createEmptyProgress(now()), saved || {});
  }

  function gameTitle() {
    return GAME_TITLES[gameId];
  }

  function selfHash() {
    return board.deviceHashFor(deviceId);
  }

  function boardEntries() {
    const hash = selfHash();
    return board.top(5, { gameId: gameId }).map(function (entry) {
      return {
        rank: entry.rank,
        deviceHash: entry.deviceHash,
        score: entry.score,
        gameId: entry.gameId,
        at: entry.at,
        self: entry.deviceHash === hash,
        label: entry.deviceHash === hash ? '我（本机）' : '匿名玩家 ' + entry.deviceHash.slice(0, 6)
      };
    });
  }

  function rankOfMatch(hash, at, score) {
    const list = board.top(1000, { gameId: gameId });
    const found = list.find(function (entry) {
      return entry.deviceHash === hash && entry.at === at && entry.score === score;
    });
    return found ? found.rank : null;
  }

  function shareFor(state) {
    const last = state && state.lastMatch ? state.lastMatch : null;
    return buildSharePayload({
      title: gameTitle() + ' · 战报',
      result: last ? (RESULT_LABELS[last.result] || last.result) : '',
      score: last ? last.score : Math.max(0, Number(state && state.points) || 0),
      rank: last ? last.rank : null,
      matchId: last ? last.matchId : ''
    });
  }

  function snapshot() {
    const state = currentState();
    const details = levelDetails(state.points || 0);
    const daily = retention.getState();
    const missions = getDailyMissions(state, now());
    const hash = selfHash();
    return {
      gameId: gameId,
      title: gameTitle(),
      deviceId: deviceId,
      deviceShort: formatShortDeviceId(deviceId),
      points: Math.max(0, Number(state.points) || 0),
      level: details.level,
      tier: details.tier,
      levelTitle: details.title,
      levelProgress: details.progress,
      nextAt: details.nextAt,
      streak: Math.max(0, Number(state.streak) || 0),
      trophies: Array.isArray(state.trophies) ? state.trophies.slice() : [],
      games: Math.max(0, Number(state.games) || 0),
      wins: Math.max(0, Number(state.wins) || 0),
      daily: daily.daily,
      lossAversion: daily.lossAversion,
      missions: missions,
      rank: board.getRank(hash, gameId),
      board: boardEntries(),
      lastMatch: state.lastMatch || null,
      share: shareFor(state)
    };
  }

  function recordMatch(input) {
    const entry = input || {};
    const at = now();
    const matchId = typeof entry.matchId === 'string' && entry.matchId ? entry.matchId : newMatchId();
    const state = currentState();
    if (!Array.isArray(state.matchIds)) state.matchIds = [];

    if (state.matchIds.indexOf(matchId) !== -1) {
      const current = snapshot();
      return Object.assign(current, {
        ok: true,
        duplicate: true,
        points: 0,
        total: current.points,
        flagged: false
      });
    }

    const beforePoints = Math.max(0, Number(state.points) || 0);
    const beforeLevel = levelForPoints(beforePoints);
    const beforeTrophies = Array.isArray(state.trophies) ? state.trophies.slice() : [];

    const login = recordDailyLogin(state, at);
    const streakInfo = updateStreak(state, at);
    if (streakInfo && Number.isFinite(streakInfo.streak)) state.streak = streakInfo.streak;

    const breakdown = computeMatchPoints({
      game: gameId,
      result: entry.result,
      remainingPrizes: entry.remainingPrizes,
      turns: entry.turns,
      han: entry.han,
      remainingTiles: entry.remainingTiles,
      tsumo: entry.tsumo
    });

    addPoints(state, breakdown.total);
    state.games = Math.max(0, Number(state.games) || 0) + 1;
    if (breakdown.result === 'win') state.wins = Math.max(0, Number(state.wins) || 0) + 1;

    awardTrophy(state, 'first-play');
    if (breakdown.result === 'win') awardTrophy(state, 'first-win');
    if (state.games >= 10) awardTrophy(state, 'matches-10');
    if (state.streak >= 3) awardTrophy(state, 'streak-3');

    recordMissionProgress(state, 'play-once', 1, at);

    const retentionState = retention.recordPlay({ won: breakdown.result === 'win' });

    const durationMs = Number.isFinite(entry.durationMs)
      ? Math.max(0, Math.floor(entry.durationMs))
      : Math.max(0, at - (Number.isFinite(entry.startedAt) ? entry.startedAt : at));
    const turns = entry.turns == null ? undefined : Number(entry.turns);
    const actions = entry.actions == null ? undefined : Number(entry.actions);

    /*
     * 基础防作弊：分数范围 / 对局时长下限 / 回合与动作数 / 设备 id 格式。
     * 校验不通过时既不写榜单，也不影响已经记入的本机积分（积分只用于本机进度，
     * 榜单要求可解释的真实对局）。结果页会显示“本局成绩未计入”。
     */
    const validation = validateScore({
      score: breakdown.total,
      durationMs: durationMs,
      turns: turns,
      actions: actions,
      deviceId: deviceId
    });

    let flagged = validation.ok !== true;
    let reason = validation.ok === true ? null : validation.reason;
    let submission = null;

    if (validation.ok) {
      submission = board.submit({
        deviceId: deviceId,
        gameId: gameId,
        nonce: matchId,
        score: breakdown.total,
        durationMs: durationMs
      });
      if (!submission || submission.ok !== true) {
        flagged = true;
        reason = (submission && (submission.code || submission.reason)) || 'rejected';
      } else if (submission.flagged) {
        flagged = true;
        reason = 'flagged by leaderboard';
      }
    }

    const level = levelForPoints(state.points);
    const levelUp = level > beforeLevel;
    const matchRank = validation.ok && submission && submission.ok === true && !flagged
      ? rankOfMatch(selfHash(), at, breakdown.total)
      : null;

    state.lastMatch = {
      matchId: matchId,
      gameId: gameId,
      result: breakdown.result,
      score: breakdown.total,
      rank: matchRank,
      at: at,
      durationMs: durationMs,
      turns: turns == null ? null : turns,
      actions: actions == null ? null : actions,
      flagged: flagged,
      reason: reason
    };
    state.matchIds.unshift(matchId);
    if (state.matchIds.length > 200) state.matchIds.length = 200;
    saveProgress(state, storage);

    const newTrophies = (state.trophies || []).filter(function (id) {
      return beforeTrophies.indexOf(id) === -1;
    });

    return Object.assign(snapshot(), {
      ok: true,
      duplicate: false,
      matchId: matchId,
      // `points` is this match's points; `total`/snapshot().points is the ledger.
      points: breakdown.total,
      breakdown: breakdown,
      total: state.points,
      level: level,
      tier: levelDetails(state.points).tier,
      levelTitle: levelDetails(state.points).title,
      levelUp: levelUp,
      levelFrom: beforeLevel,
      levelTo: level,
      newTrophies: newTrophies,
      trophies: (state.trophies || []).slice(),
      streak: Math.max(0, Number(state.streak) || 0),
      daily: retentionState.daily,
      lossAversion: retentionState.lossAversion,
      dailyAward: login && Number.isFinite(login.lastDailyAward) ? login.lastDailyAward : 0,
      dailyAwarded: Boolean(login && login.dailyAwarded),
      missions: getDailyMissions(state, at),
      validated: validation.ok === true,
      validationReason: validation.ok === true ? null : validation.reason,
      flagged: flagged,
      flagReason: reason,
      rank: state.lastMatch.rank,
      board: boardEntries(),
      share: shareFor(state)
    });
  }

  function claimDailyReward() {
    const claimed = retention.claimDaily();
    if (!claimed.ok) return claimed;
    const state = currentState();
    const beforeLevel = levelForPoints(state.points || 0);
    addPoints(state, claimed.points);
    const level = levelForPoints(state.points);
    saveProgress(state, storage);
    return {
      ok: true,
      points: claimed.points,
      total: state.points,
      level: level,
      levelUp: level > beforeLevel
    };
  }

  return {
    gameId: gameId,
    deviceId: deviceId,
    recordMatch: recordMatch,
    claimDailyReward: claimDailyReward,
    snapshot: snapshot,
    lastShare: function lastShare() { return shareFor(currentState()); },
    shareText: function currentShareText() { return shareTextFor(shareFor(currentState())); }
  };
}

export default {
  createResultTracker: createResultTracker,
  computeMatchPoints: computeMatchPoints,
  newMatchId: newMatchId,
  shareOrCopy: shareOrCopy,
  formatShortDeviceId: formatShortDeviceId,
  trophyLabel: trophyLabel,
  TROPHY_LABELS: TROPHY_LABELS,
  POINT_RULES: POINT_RULES
};
