// Anonymous leaderboard worker for the static games site.
//
// Privacy model:
//   - no accounts, no email/phone, no cookies, no IP persistence/logging
//   - identity is a client-generated 32-hex `device` string (like a nickname token)
//   - only a salted SHA-256 hash of `device` is ever stored
//   - stored fields: device hash (KV key), name, game slug, value, timestamp
//
// This worker is intentionally independent from games/voice-room/worker.

const VERSION = '1.0.0';

// Mirrors the live slugs in games/registry.json (read-only reference).
// Keep in sync manually; a missing slug here rejects a valid game.
export const GAME_SLUGS = [
  'xiangqi', 'chess', 'gomoku', 'reversi', 'checkers-jump', 'draughts',
  'backgammon', 'banqi', 'connect4', 'go9', 'solitaire', 'freecell',
  'spider', '24game', 'doudizhu', 'texas-holdem', 'mahjong', 'tcg-deck',
  'tcg-sample', 'pioneers', 'undercover', 'aeroplane', 'tap-match',
  'voice-room',
];
const GAME_SET = new Set(GAME_SLUGS);

export const LIMITS = {
  xp: { min: 0, max: 1_000_000, dir: 'desc', integer: true },
  time: { min: 1, max: 86_400, dir: 'asc', integer: false }, // seconds, 1s..24h
  streak: { min: 0, max: 3_650, dir: 'desc', integer: true },
};
const KIND_ORDER = ['xp', 'streak', 'time'];

export const AVATAR_SHAPES = ['circle', 'tri', 'square', 'star', 'hex', 'diamond'];

const ZERO_WIDTH_RE = /[​-‏‪-‮⁠-⁯﻿]/g;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const NAME_MAX = 12;
const NAME_RE = /^[一-龥A-Za-z0-9 #_-]+$/u;

// Small hard-coded baseline blacklist. Deliberately not a full moderation system.
const BAD_ZH = ['傻逼', '沙比', '煞笔', '操你', '草泥马', '尼玛', '妈的', '贱人', '婊子', '约炮', '性爱', '色情'];
const BAD_EN = ['fuck', 'shit', 'bitch', 'cunt', 'asshole', 'nigger', 'faggot', 'whore', 'slut', 'pussy', 'retard'];

// Storage keys
const BOARD_KEY = (game, periodKey) => `v1:board:${game}:${periodKey}`;
const WEEK_PREFIX = 'week:';
const ALL_PERIOD = 'all';
const WEEK_TTL_SECONDS = 14 * 24 * 60 * 60;
const DEVICE_INDEX_KEY = (hash) => `v1:dev:${hash}`;
const DEVICE_INDEX_MAX = 128;

// Rate limits
const DEVICE_WINDOW_MS = 30_000;
const DEVICE_LIMIT = 1;
const IP_WINDOW_MS = 60_000;
const IP_LIMIT = 20;

// Worker-instance-local counters. Not persisted, not logged.
const deviceHits = new Map();
const ipHits = new Map();

// ---------------------------------------------------------------------------
// Pure helpers (exported for games/leaderboard/worker/test.js)
// ---------------------------------------------------------------------------

function bad(error) {
  return { ok: false, error };
}

function compactForProfanity(s) {
  return String(s).toLowerCase().replace(/[\s_-]+/g, '');
}

export function isProfane(raw) {
  const s = compactForProfanity(raw);
  return BAD_ZH.some((w) => s.includes(w)) || BAD_EN.some((w) => s.includes(w));
}

/**
 * Clean and validate a display name.
 * Removes zero-width/control characters, collapses whitespace, truncates to
 * 12 code points (not UTF-16 units), then enforces the charset
 * [Chinese, ASCII letters, digits, space, # _ -].
 * Over-long names are truncated, not rejected.
 */
export function cleanName(raw) {
  if (typeof raw !== 'string') return bad('bad_name');
  if (/[<>]/.test(raw)) return bad('bad_name'); // HTML tags are never accepted
  let cleaned = raw
    .replace(ZERO_WIDTH_RE, '')
    .replace(CONTROL_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return bad('bad_name');
  const points = [...cleaned];
  if (points.length > NAME_MAX) cleaned = points.slice(0, NAME_MAX).join('').trim();
  if (!cleaned) return bad('bad_name');
  if (!NAME_RE.test(cleaned)) return bad('bad_name');
  if (isProfane(cleaned)) return bad('bad_name');
  return { ok: true, name: cleaned };
}

export function validateScore(kind, raw) {
  const lim = LIMITS[kind];
  if (!lim) return bad('bad_value');
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return bad('bad_value');
  if (lim.integer && !Number.isInteger(raw)) return bad('bad_value');
  if (raw < lim.min || raw > lim.max) return bad('bad_value');
  const value = lim.integer ? raw : Math.round(raw * 1000) / 1000;
  return { ok: true, value };
}

export function validateDevice(raw) {
  if (typeof raw !== 'string') return bad('bad_device');
  const device = raw.trim().toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(device)) return bad('bad_device');
  return { ok: true, device };
}

export function isValidGame(raw) {
  return typeof raw === 'string' && GAME_SET.has(raw.trim().toLowerCase());
}

/** True when `value` is strictly better than `prev` for the given kind. */
export function isBetter(kind, value, prev) {
  const dir = LIMITS[kind] ? LIMITS[kind].dir : 'desc';
  if (value === prev) return false;
  return dir === 'asc' ? value < prev : value > prev;
}

export function compareScores(kind, a, b) {
  const dir = LIMITS[kind] ? LIMITS[kind].dir : 'desc';
  const d = dir === 'asc' ? a.value - b.value : b.value - a.value;
  if (d !== 0) return d;
  const ta = Number(a.at ?? a.t ?? 0);
  const tb = Number(b.at ?? b.t ?? 0);
  if (ta !== tb) return ta - tb; // earlier submitters win display order
  return String(a.name ?? '').localeCompare(String(b.name ?? ''));
}

/**
 * Sort entries by score and attach competition ranks (1,1,3). Ties share a
 * rank; display order breaks the tie by earliest timestamp, then name.
 */
export function rankRows(entries, kind) {
  const sorted = [...entries].sort((a, b) => compareScores(kind, a, b));
  let prevValue = null;
  let prevRank = 0;
  return sorted.map((entry, i) => {
    if (prevValue === null || entry.value !== prevValue) {
      prevRank = i + 1;
      prevValue = entry.value;
    }
    return { ...entry, rank: prevRank };
  });
}

/**
 * UTC ISO week bucket, e.g. "2026-W01". Weeks start Monday 00:00 UTC.
 * Independent of the process timezone (only UTC getters are used).
 */
export function weekKey(input) {
  const src = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(src.getTime())) return null;
  const d = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  const day = d.getUTCDay() || 7; // Mon=1 .. Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // move to the Thursday of this ISO week
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Derive two stable hues + one shape from the salted hash (never the device). */
export function deriveAvatar(hashHex) {
  const h = String(hashHex || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const byte = (i) => parseInt(h.slice(i, i + 2), 16);
  let h1 = Math.floor((byte(0) / 256) * 360);
  let h2 = Math.floor((byte(2) / 256) * 360);
  if (h1 === h2) h2 = (h2 + 137) % 360;
  const shape = AVATAR_SHAPES[byte(4) % AVATAR_SHAPES.length];
  return { h1, h2, shape };
}

/**
 * Fixed-window counter. `store` is any Map-like object. Returns
 * {ok, retryAfter} where retryAfter is whole seconds until the window resets.
 */
export function hitCounter(store, key, now, limit, windowMs) {
  const entry = store.get(key);
  if (!entry || now - entry.start >= windowMs) {
    store.set(key, { start: now, count: 1 });
    return { ok: true, retryAfter: 0 };
  }
  if (entry.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000)) };
  }
  entry.count += 1;
  return { ok: true, retryAfter: 0 };
}

export async function hashDevice(salt, device) {
  const data = new TextEncoder().encode(String(salt) + String(device));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extraHeaders },
  });
}

function rateLimited(retryAfter) {
  return json(
    { ok: false, error: 'rate_limited', retryAfter },
    429,
    { 'Retry-After': String(retryAfter) },
  );
}

function pruneStore(store, max = 5000) {
  if (store.size <= max) return;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    if (++removed >= 2000) break;
  }
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// KV access
// ---------------------------------------------------------------------------

async function loadBoardByKey(env, key) {
  let raw = null;
  try {
    raw = await env.LB.get(key, 'json');
  } catch {
    raw = null;
  }
  const rows = raw && typeof raw.rows === 'object' && raw.rows !== null ? raw.rows : {};
  const updatedAt = raw && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0;
  return { key, rows, updatedAt };
}

async function saveBoard(env, board, ttlSeconds) {
  const payload = JSON.stringify({ rows: board.rows, updatedAt: board.updatedAt });
  if (ttlSeconds) await env.LB.put(board.key, payload, { expirationTtl: ttlSeconds });
  else await env.LB.put(board.key, payload);
}

// Merge one submission into a board. One row per device+game; only a better
// score of the same kind replaces the stored one. A cross-kind submission never
// clobbers an existing row (games are expected to use one scoring kind).
function applyScore(board, hash, name, value, kind, now) {
  const rows = { ...board.rows };
  const prev = rows[hash];
  if (!prev) {
    rows[hash] = { n: name, v: value, k: kind, t: now };
  } else if (prev.k === kind && isBetter(kind, value, prev.v)) {
    rows[hash] = { n: name, v: value, k: kind, t: now };
  }
  return { ...board, rows, updatedAt: now };
}

async function addToDeviceIndex(env, hash, keys) {
  const indexKey = DEVICE_INDEX_KEY(hash);
  let existing = null;
  try {
    existing = await env.LB.get(indexKey, 'json');
  } catch {
    existing = null;
  }
  const set = new Set(Array.isArray(existing) ? existing.filter((k) => typeof k === 'string') : []);
  for (const key of keys) set.add(key);
  const list = [...set].slice(-DEVICE_INDEX_MAX);
  await env.LB.put(indexKey, JSON.stringify(list));
}

function boardRowsToApi(rows) {
  const groups = new Map();
  for (const [hash, entry] of Object.entries(rows)) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = entry.k;
    if (!LIMITS[kind]) continue;
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({
      device: hash,
      name: String(entry.n || ''),
      value: Number(entry.v),
      kind,
      at: Number(entry.t) || 0,
    });
  }
  const out = [];
  for (const kind of KIND_ORDER) {
    const group = groups.get(kind);
    if (!group) continue;
    for (const row of rankRows(group, kind)) {
      const avatar = deriveAvatar(row.device);
      if (!avatar) continue;
      out.push({
        rank: row.rank,
        name: row.name,
        avatar,
        value: row.value,
        kind: row.kind,
        at: row.at ? new Date(row.at).toISOString() : new Date(0).toISOString(),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleScore(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_device' }, 400);

  const device = validateDevice(body.device);
  if (!device.ok) return json({ ok: false, error: 'bad_device' }, 400);

  const game = typeof body.game === 'string' ? body.game.trim().toLowerCase() : '';
  if (!GAME_SET.has(game)) return json({ ok: false, error: 'bad_game' }, 400);

  const name = cleanName(body.name);
  if (!name.ok) return json({ ok: false, error: 'bad_name' }, 400);

  const score = validateScore(body.kind, body.value);
  if (!score.ok) return json({ ok: false, error: 'bad_value' }, 400);

  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHit = hitCounter(ipHits, ip, now, IP_LIMIT, IP_WINDOW_MS);
  pruneStore(ipHits);
  if (!ipHit.ok) return rateLimited(ipHit.retryAfter);

  const devHit = hitCounter(deviceHits, device.device, now, DEVICE_LIMIT, DEVICE_WINDOW_MS);
  pruneStore(deviceHits);
  if (!devHit.ok) return rateLimited(devHit.retryAfter);

  if (!env.SALT) return json({ ok: false, error: 'server_misconfigured' }, 500);
  if (!env.LB) return json({ ok: false, error: 'server_misconfigured' }, 500);

  const hash = await hashDevice(env.SALT, device.device);
  const week = weekKey(new Date(now));
  const weekKeyName = WEEK_PREFIX + week;
  const weekBoardKey = BOARD_KEY(game, weekKeyName);
  const allBoardKey = BOARD_KEY(game, ALL_PERIOD);

  const [weekBoard, allBoard] = await Promise.all([
    loadBoardByKey(env, weekBoardKey),
    loadBoardByKey(env, allBoardKey),
  ]);

  const nextWeek = applyScore(weekBoard, hash, name.name, score.value, body.kind, now);
  const nextAll = applyScore(allBoard, hash, name.name, score.value, body.kind, now);

  await Promise.all([
    saveBoard(env, nextWeek, WEEK_TTL_SECONDS),
    saveBoard(env, nextAll, 0),
    addToDeviceIndex(env, hash, [weekBoardKey, allBoardKey]),
  ]);

  const stored = nextWeek.rows[hash];
  let rank = 1;
  if (stored) {
    const sameKind = Object.entries(nextWeek.rows)
      .filter(([, entry]) => entry && entry.k === stored.k)
      .map(([deviceHash, entry]) => ({
        device: deviceHash,
        name: entry.n,
        value: entry.v,
        kind: entry.k,
        at: entry.t,
      }));
    const ranked = rankRows(sameKind, stored.k);
    rank = ranked.find((row) => row.device === hash)?.rank || 1;
  }

  return json({ ok: true, rank, best: stored ? stored.v : score.value });
}

async function handleBoard(url, env) {
  const game = (url.searchParams.get('game') || '').trim().toLowerCase();
  if (!GAME_SET.has(game)) return json({ ok: false, error: 'bad_game' }, 400);

  const periodRaw = (url.searchParams.get('period') || 'week').toLowerCase();
  if (periodRaw !== 'week' && periodRaw !== 'all') {
    return json({ ok: false, error: 'bad_period' }, 400);
  }

  const limitRaw = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw >= 1
    ? Math.min(50, Math.floor(limitRaw))
    : 50;

  const now = new Date();
  const periodKey = periodRaw === 'week' ? WEEK_PREFIX + weekKey(now) : ALL_PERIOD;
  const board = await loadBoardByKey(env, BOARD_KEY(game, periodKey));
  const rows = boardRowsToApi(board.rows);

  return json({
    ok: true,
    period: periodRaw,
    game,
    updatedAt: board.updatedAt ? new Date(board.updatedAt).toISOString() : now.toISOString(),
    rows: rows.slice(0, limit),
    total: rows.length,
  });
}

async function handleDelete(request, env) {
  const body = await readJson(request);
  if (!body) return json({ ok: false, error: 'bad_device' }, 400);

  const device = validateDevice(body.device);
  if (!device.ok) return json({ ok: false, error: 'bad_device' }, 400);

  if (!env.SALT) return json({ ok: false, error: 'server_misconfigured' }, 500);
  if (!env.LB) return json({ ok: false, error: 'server_misconfigured' }, 500);

  const hash = await hashDevice(env.SALT, device.device);
  const keys = new Set();

  try {
    const indexed = await env.LB.get(DEVICE_INDEX_KEY(hash), 'json');
    if (Array.isArray(indexed)) {
      for (const key of indexed) {
        if (typeof key === 'string' && key.startsWith('v1:board:')) keys.add(key);
      }
    }
  } catch {
    // Index is an optimization; the deterministic scan below still runs.
  }

  // Deterministic sweep covers lost/racy index entries and the current week.
  const currentWeek = WEEK_PREFIX + weekKey(new Date());
  for (const game of GAME_SLUGS) {
    keys.add(BOARD_KEY(game, ALL_PERIOD));
    keys.add(BOARD_KEY(game, currentWeek));
  }

  let deleted = 0;
  for (const key of keys) {
    const board = await loadBoardByKey(env, key);
    if (!Object.prototype.hasOwnProperty.call(board.rows, hash)) continue;
    delete board.rows[hash];
    board.updatedAt = Date.now();
    await saveBoard(env, board, key.includes(`:${WEEK_PREFIX}`) ? WEEK_TTL_SECONDS : 0);
    deleted += 1;
  }

  try {
    await env.LB.delete(DEVICE_INDEX_KEY(hash));
  } catch {
    // best effort
  }

  return json({ ok: true, deleted });
}

async function route(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === '/health') {
    return json({ ok: true, version: VERSION });
  }

  if (url.pathname === '/api/score') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    return handleScore(request, env);
  }

  if (url.pathname === '/api/board') {
    if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
    return handleBoard(url, env);
  }

  if (url.pathname === '/api/delete') {
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    return handleDelete(request, env);
  }

  return json({ ok: false, error: 'not_found' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch {
      return json({ ok: false, error: 'internal' }, 500);
    }
  },
};
