'use strict';

/*
 * 本地排行榜 + 匿名设备 id + 基础防作弊。
 *
 * - 榜单只存 deviceHash = sha256(salt + deviceId)，不落原始 deviceId。
 * - 明显异常的分数（非整数、超上限、>1000 分/秒、时长 <1s）标记 flagged，
 *   不进入榜单，但接口仍返回 ok:true。
 * - 同一设备每分钟最多提交 maxPerMinute 次；nonce 重复直接拒绝。
 * - 持久化键 boardgame.leaderboard.v1；storage 抛错时降级为内存状态。
 */

const STORAGE_KEY = 'boardgame.leaderboard.v1';
const DEVICE_KEY = 'boardgame.device.v1';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function utf8Bytes(text) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
  const bytes = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.codePointAt(i);
    if (code > 0xffff) i += 1;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return new Uint8Array(bytes);
}

export function sha256Hex(text) {
  const bytes = utf8Bytes(String(text));
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < h.length; i += 1) hex += h[i].toString(16).padStart(8, '0');
  return hex;
}

function defaultStorage() {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (err) {
    /* ignore */
  }
  return null;
}

function defaultState() {
  return { entries: [], nonces: [], rate: {} };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getOrCreateDeviceId(storage) {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    if (store) {
      const existing = store.getItem(DEVICE_KEY);
      if (existing && /^dev_[a-f0-9]{32}$/.test(existing)) return existing;
    }
  } catch (err) {
    /* ignore */
  }
  let bytes = null;
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
    }
  } catch (err) {
    bytes = null;
  }
  if (!bytes) {
    bytes = new Uint8Array(16);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, '0');
  const id = 'dev_' + hex;
  try {
    if (store) store.setItem(DEVICE_KEY, id);
  } catch (err) {
    /* ignore */
  }
  return id;
}

export function createLeaderboard(options) {
  const opts = options || {};
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  const salt = typeof opts.salt === 'string' ? opts.salt : 'boardgame';
  const maxScore = Number.isFinite(opts.maxScore) ? opts.maxScore : 10000000;
  const maxPerMinute = Math.max(1, Number.isFinite(opts.maxPerMinute) ? opts.maxPerMinute : 20);
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
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        nonces: Array.isArray(parsed.nonces) ? parsed.nonces : [],
        rate: parsed.rate && typeof parsed.rate === 'object' ? parsed.rate : {}
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

  function deviceHashFor(deviceId) {
    return sha256Hex(salt + String(deviceId));
  }

  function pruneRate(state, nowMs) {
    const cutoff = nowMs - 60000;
    Object.keys(state.rate).forEach(function (key) {
      const kept = (state.rate[key] || []).filter(function (t) { return t > cutoff; });
      if (kept.length) state.rate[key] = kept;
      else delete state.rate[key];
    });
  }

  function sorted(state, gameId) {
    return state.entries
      .filter(function (entry) { return !gameId || entry.gameId === gameId; })
      .sort(function (a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return a.at - b.at;
      });
  }

  function top(n, optionsTop) {
    const optsTop = optionsTop || {};
    const limit = n == null ? 10 : Math.max(1, Math.floor(n));
    const list = sorted(load(), optsTop.gameId).slice(0, limit);
    return list.map(function (entry, index) {
      return {
        rank: index + 1,
        deviceHash: entry.deviceHash,
        score: entry.score,
        gameId: entry.gameId,
        at: entry.at
      };
    });
  }

  function getRank(deviceHash, gameId) {
    if (!deviceHash) return null;
    const list = sorted(load(), gameId);
    const best = list.find(function (entry) { return entry.deviceHash === deviceHash; });
    if (!best) return null;
    return list.indexOf(best) + 1;
  }

  function submit(input) {
    const req = input || {};
    if (typeof req.deviceId !== 'string' || !req.deviceId) {
      return { ok: false, code: 'E_INPUT', message: 'deviceId is required' };
    }
    if (typeof req.gameId !== 'string' || !req.gameId) {
      return { ok: false, code: 'E_INPUT', message: 'gameId is required' };
    }
    if (typeof req.nonce !== 'string' || !req.nonce) {
      return { ok: false, code: 'E_INPUT', message: 'nonce is required' };
    }

    const nowMs = now();
    const state = load();
    pruneRate(state, nowMs);

    if (state.nonces.indexOf(req.nonce) !== -1) {
      return { ok: false, code: 'E_REPLAY', message: 'nonce already used' };
    }

    const hash = deviceHashFor(req.deviceId);
    const recent = state.rate[hash] || [];
    if (recent.length >= maxPerMinute) {
      return { ok: false, code: 'E_RATE', message: 'too many submissions' };
    }

    state.nonces.push(req.nonce);
    if (state.nonces.length > 5000) state.nonces.splice(0, state.nonces.length - 5000);
    state.rate[hash] = recent.concat([nowMs]);

    const score = req.score;
    const durationMs = req.durationMs;
    const flagged = !Number.isInteger(score) ||
      score < 0 ||
      score > maxScore ||
      !Number.isFinite(durationMs) ||
      durationMs < 1000 ||
      score / durationMs > 1000;

    if (flagged) {
      save(state);
      return { ok: true, flagged: true, rank: null, entry: null };
    }

    const entry = {
      deviceHash: hash,
      gameId: req.gameId,
      score: score,
      durationMs: durationMs,
      at: nowMs
    };
    state.entries.push(entry);
    if (state.entries.length > 1000) {
      const all = sorted(state);
      state.entries = all.slice(0, 1000);
    }
    save(state);
    const rank = getRank(hash, req.gameId);
    return {
      ok: true,
      flagged: false,
      rank: rank,
      entry: {
        deviceHash: hash,
        gameId: entry.gameId,
        score: entry.score,
        durationMs: entry.durationMs,
        at: entry.at
      }
    };
  }

  function reset() {
    save(defaultState());
    return { ok: true };
  }

  return {
    submit: submit,
    top: top,
    getRank: getRank,
    reset: reset,
    deviceHashFor: deviceHashFor
  };
}

export default { createLeaderboard: createLeaderboard, getOrCreateDeviceId: getOrCreateDeviceId, sha256Hex: sha256Hex };
