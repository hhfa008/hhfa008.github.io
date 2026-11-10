'use strict';

/*
 * Server-authoritative leaderboard facade for the boardgame pages app.
 *
 * The client never decides what enters the board. Every submission goes
 * through the same checks a backend would apply:
 *   - device id is hashed immediately (only the hash is persisted/returned)
 *   - one nonce may be used once per device, which blocks replay
 *   - scores above maxScore, non-finite/negative scores, absurdly short
 *     durations and client-authoritative claims are accepted but FLAGGED and
 *     never enter the board
 *   - submissions per device are limited to maxPerMinute
 *
 * `createLeaderboard` accepts an injectable clock and storage so the same
 * logic runs in tests, pages and a future Worker.
 */

import { getDeviceId } from './retention.mjs';

export const LEADERBOARD_STORAGE_KEY = 'boardgame.leaderboard.v1';
export const DEFAULT_MAX_SCORE = 100000;
export const DEFAULT_MAX_PER_MINUTE = 20;
export const MIN_SUBMISSION_DURATION_MS = 1000;
export const RATE_WINDOW_MS = 60 * 1000;

function isObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    return globalThis.localStorage || null;
  } catch (err) {
    return null;
  }
}

/**
 * Stable, non-cryptographic device hash (FNV-1a, two rounds). It is only a
 * de-duplication key, not a fingerprint: no IP, user agent or hardware data
 * is mixed in, and the raw device id is never persisted or returned.
 */
export function hashDeviceId(deviceId) {
  const text = String(deviceId == null ? '' : deviceId);
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 0x01000193) >>> 0;
    b ^= code + i;
    b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  a = (a ^ (a >>> 16)) >>> 0;
  b = (b ^ (b >>> 13)) >>> 0;
  return ('00000000' + a.toString(16)).slice(-8) + ('00000000' + b.toString(16)).slice(-8);
}

function freshState() {
  return { entries: [], seen: [], rate: {} };
}

function normalizeState(value) {
  const state = isObject(value) ? value : {};
  const entries = Array.isArray(state.entries) ? state.entries : [];
  state.entries = entries.map(function (entry) {
    if (!isObject(entry)) return null;
    // Privacy scrub: never keep a raw deviceId, even from older snapshots.
    return {
      deviceHash: String(entry.deviceHash || hashDeviceId(entry.deviceId || '')),
      gameId: String(entry.gameId || '').slice(0, 64),
      score: Math.max(0, Math.floor(finite(entry.score, 0))),
      durationMs: Math.max(0, Math.floor(finite(entry.durationMs, 0))),
      at: finite(entry.at, Date.now())
    };
  }).filter(function (entry) { return entry && entry.deviceHash; });
  state.seen = Array.isArray(state.seen) ? state.seen.map(String) : [];
  if (!isObject(state.rate)) state.rate = {};
  return state;
}

function loadState(storage) {
  const store = resolveStorage(storage);
  if (!store) return freshState();
  try {
    const text = store.getItem(LEADERBOARD_STORAGE_KEY);
    if (!text) return freshState();
    return normalizeState(JSON.parse(text));
  } catch (err) {
    return freshState();
  }
}

function saveState(state, storage) {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    return false;
  }
}

function round(value, fallback) {
  return Math.max(0, Math.floor(finite(value, fallback)));
}

/**
 * Create a leaderboard instance.
 *
 * options:
 *   now?          () => timestamp
 *   storage?      localStorage-like object
 *   maxScore?     hard cap; higher scores are flagged and excluded
 *   maxPerMinute? per-device submission limit
 *   minDurationMs? submissions faster than this are flagged
 */
export function createLeaderboard(options) {
  const opts = isObject(options) ? options : {};
  const nowFn = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
  const storage = resolveStorage(opts.storage);
  const maxScore = round(opts.maxScore, DEFAULT_MAX_SCORE);
  const maxPerMinute = Math.max(1, round(opts.maxPerMinute, DEFAULT_MAX_PER_MINUTE));
  const minDurationMs = Math.max(1, round(opts.minDurationMs, MIN_SUBMISSION_DURATION_MS));
  let state = loadState(storage);

  const clock = function () {
    const value = nowFn();
    return Number.isFinite(value) ? value : Date.now();
  };

  function persist() {
    return saveState(state, storage);
  }

  function pruneRate(hash, at) {
    const list = Array.isArray(state.rate[hash]) ? state.rate[hash] : [];
    state.rate[hash] = list.filter(function (stamp) {
      return at - stamp < RATE_WINDOW_MS;
    });
    return state.rate[hash];
  }

  /**
   * Submit a result. Returns:
   *   { ok: true,  flagged: false, entry }
   *   { ok: true,  flagged: true, code: 'E_FLAGGED', reasons }
   *   { ok: false, code: 'E_REPLAY' | 'E_RATE' | 'E_INVALID' | 'E_PRIVACY' }
   */
  function submit(payload) {
    if (!isObject(payload)) return { ok: false, code: 'E_INVALID', reason: 'payload_required' };
    const rawDeviceId = String(payload.deviceId == null ? '' : payload.deviceId).trim();
    if (!rawDeviceId || rawDeviceId.length > 200) {
      return { ok: false, code: 'E_INVALID', reason: 'device_id_required' };
    }
    if (/@|email|phone|mobile|address|realName|fullName|idCard/i.test(rawDeviceId)) {
      return { ok: false, code: 'E_PRIVACY', reason: 'device_id_looks_personal' };
    }
    const gameId = String(payload.gameId == null ? '' : payload.gameId).slice(0, 64);
    const nonce = String(payload.nonce == null ? '' : payload.nonce).slice(0, 128);
    if (!gameId || !nonce) return { ok: false, code: 'E_INVALID', reason: 'game_and_nonce_required' };

    const hash = hashDeviceId(rawDeviceId);
    const nonceKey = hash + '|' + gameId + '|' + nonce;
    if (state.seen.indexOf(nonceKey) !== -1) {
      return { ok: false, code: 'E_REPLAY', reason: 'nonce_already_used' };
    }

    const at = clock();
    const rate = pruneRate(hash, at);
    if (rate.length >= maxPerMinute) {
      return {
        ok: false,
        code: 'E_RATE',
        reason: 'too_many_submissions',
        waitMs: Math.max(0, RATE_WINDOW_MS - (at - rate[0]))
      };
    }

    // From here the submission is recorded (nonce + rate) even when flagged,
    // so a cheater cannot retry the same nonce or bypass the frequency limit.
    state.seen.push(nonceKey);
    if (state.seen.length > 1000) state.seen.splice(0, state.seen.length - 1000);
    rate.push(at);
    state.rate[hash] = rate;

    const score = finite(payload.score, NaN);
    const durationMs = finite(payload.durationMs, NaN);
    const reasons = [];
    if (!Number.isFinite(score) || score < 0 || score > maxScore || Math.floor(score) !== score) {
      reasons.push('score_out_of_range');
    }
    if (!Number.isFinite(durationMs) || durationMs < minDurationMs) {
      reasons.push('duration_too_short');
    }
    if (payload.clientAuthoritative === true || payload.authoritative === 'client') {
      reasons.push('client_authoritative');
    }

    if (reasons.length > 0) {
      persist();
      return {
        ok: true,
        flagged: true,
        code: 'E_FLAGGED',
        reasons: reasons,
        score: Number.isFinite(score) ? score : null
      };
    }

    const entry = {
      deviceHash: hash,
      gameId: gameId,
      score: Math.floor(score),
      durationMs: Math.floor(durationMs),
      at: at
    };
    const existing = state.entries.find(function (item) {
      return item.deviceHash === hash && item.gameId === gameId;
    });
    if (!existing) {
      state.entries.push(entry);
    } else if (entry.score > existing.score ||
      (entry.score === existing.score && entry.at < existing.at)) {
      existing.score = entry.score;
      existing.durationMs = entry.durationMs;
      existing.at = entry.at;
    }
    if (state.entries.length > 500) state.entries.splice(0, state.entries.length - 500);
    persist();
    return { ok: true, flagged: false, entry: rankEntry(entry) };
  }

  function rankEntry(entry, rank) {
    return {
      deviceHash: entry.deviceHash,
      gameId: entry.gameId || '',
      score: entry.score,
      durationMs: entry.durationMs,
      at: entry.at,
      rank: rank || 0
    };
  }

  /** Sorted (descending) board. Raw device ids are never present. */
  function top(limit) {
    const list = state.entries
      .filter(function (entry) {
        return entry && Number.isFinite(entry.score) && entry.score >= 0 && entry.score <= maxScore;
      })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.at - b.at;
      })
      .map(function (entry, index) { return rankEntry(entry, index + 1); });
    const cap = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : list.length;
    return list.slice(0, cap);
  }

  function getState() {
    return {
      maxScore: maxScore,
      maxPerMinute: maxPerMinute,
      minDurationMs: minDurationMs,
      entries: top(),
      seenNonces: state.seen.length
    };
  }

  function reset() {
    state = freshState();
    persist();
    return { ok: true, entries: [] };
  }

  return {
    submit: submit,
    submitScore: submit,
    top: top,
    getLeaderboard: top,
    list: top,
    getState: getState,
    reset: reset,
    hashDeviceId: hashDeviceId,
    maxScore: maxScore,
    maxPerMinute: maxPerMinute
  };
}

/** Anonymous device id helper kept alongside the board it identifies. */
export function getOrCreateDeviceId(storage) {
  return getDeviceId(storage);
}

export const ensureDeviceId = getOrCreateDeviceId;
export const deviceId = getOrCreateDeviceId;
export const getDeviceIdForBoard = getOrCreateDeviceId;

export default createLeaderboard;
