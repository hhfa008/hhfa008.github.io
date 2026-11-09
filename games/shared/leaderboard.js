/* Shared leaderboard client for the games hall.

   UMD: browsers read window.Leaderboard, Node reads module.exports. No
   dependencies, no third-party requests, one file.

   Identity
   --------
   The 32-hex device id is the primary key. Nicknames are display-only and
   optional; without one the server sees "玩家 #A7F3", derived from the first
   four hex digits of SHA-256(device). Because iOS Safari clears script-writable
   storage after seven days without a visit (ITP), the device id is kept in
   three places and restored from whichever survives:

       localStorage  hhfa-device-v1
       IndexedDB     database "hhfa-id", object store "kv"
       cookie        hhfa_dev (Path=/, SameSite=Lax, Max-Age=400 days)

   localStorage is synchronous, so device() stays synchronous. ready() is the
   authoritative async recovery path (localStorage -> IndexedDB -> cookie) and
   is what the page and every network call await.

   Network
   -------
   Every request is capped at 8 seconds, never throws, and maps failures to
   {ok:false, error}. The only origin ever contacted is Leaderboard.API.
   ?mock=1 returns deterministic local data without touching the network.

   Challenge links
   ---------------
   buildChallenge(state) / parseChallenge(str) are pure (no I/O): the payload
   lives in the URL as base64url JSON and is never uploaded. Invalid input
   returns null on both sides.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Leaderboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var DEFAULT_API = 'https://game-leaderboard.superapp-devin.workers.dev';
  // Note: the task brief tentatively used "games-leaderboard"; the deployed
  // worker is the singular name above (wrangler.toml: name = "game-leaderboard").
  // Change this one constant if the deployment moves.
  var KEY_DEVICE = 'hhfa-device-v1';
  var KEY_NAME = 'hhfa-name-v1';
  var KEY_SCORES = 'hhfa-scores-v1';
  var COOKIE_DEVICE = 'hhfa_dev';
  var COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 days
  var TIMEOUT_MS = 8000;
  var IDB_TIMEOUT_MS = 2500;
  var HEALTH_TTL_MS = 60000;
  var MAX_NAME = 12;
  var MAX_CHALLENGE = 512;
  var KINDS = { xp: 1, time: 1, streak: 1 };
  var LIMITS = {
    xp: { min: 0, max: 1000000, integer: true },
    time: { min: 1, max: 86400, integer: false },
    streak: { min: 0, max: 3650, integer: true }
  };

  var cfg = { api: DEFAULT_API };
  var memory = {};
  var cachedDevice = null;
  var deviceSource = null; // 'local' | 'cookie' | 'idb' | 'new'
  var readyPromise = null;
  var health = { value: null, at: 0 };
  var healthPromise = null;
  var idbAdapter = null;

  var nodeCrypto = null;
  if (typeof require === 'function') {
    try { nodeCrypto = require('node:crypto'); } catch (e) { nodeCrypto = null; }
  }

  /* ------------------------------------------------------------------ *
   * Small helpers                                                      *
   * ------------------------------------------------------------------ */

  function isMock() {
    try {
      var q = (root && root.location && root.location.search) || '';
      return new RegExp('(?:^|[?&])mock=1(?:&|$)').test(q);
    } catch (e) {
      return false;
    }
  }

  function isKind(k) {
    return typeof k === 'string' && KINDS[k] === 1;
  }

  function isSlug(s) {
    return typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s);
  }

  function finiteNumber(v) {
    var n = typeof v === 'number' ? v : Number(v);
    return isFinite(n) ? n : null;
  }

  // Enforces the worker's LIMITS table exactly (xp 0..1e6 integer, time
  // 1..86400 s to 3 decimals, streak 0..3650 integer). Returns the value the
  // server will store, or null for a request it would reject.
  function normalizeValue(kind, raw) {
    var lim = LIMITS[kind];
    var n = finiteNumber(raw);
    if (!lim || n == null) return null;
    if (lim.integer && !Number.isInteger(n)) return null;
    if (n < lim.min || n > lim.max) return null;
    return lim.integer ? n : Math.round(n * 1000) / 1000;
  }

  function timestampMs(value) {
    var n = finiteNumber(value);
    if (n != null) return Math.floor(n);
    if (typeof value === 'string') {
      var t = Date.parse(value);
      if (isFinite(t)) return t;
    }
    return 0;
  }

  function nowMs() {
    return Date.now();
  }

  function localGet(key) {
    try {
      var ls = root && root.localStorage;
      if (!ls) return null;
      var v = ls.getItem(key);
      return typeof v === 'string' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function localSet(key, value) {
    try {
      var ls = root && root.localStorage;
      if (ls) { ls.setItem(key, value); return true; }
    } catch (e) {}
    memory[key] = value;
    return false;
  }

  function localRemove(key) {
    try {
      var ls = root && root.localStorage;
      if (ls) ls.removeItem(key);
    } catch (e) {}
    delete memory[key];
  }

  /* ------------------------------------------------------------------ *
   * Device id: generation and three-way persistence                    *
   * ------------------------------------------------------------------ */

  function validDevice(v) {
    return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
  }

  function randomHex32() {
    var bytes = new Uint8Array(16);
    var c = root && root.crypto;
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(bytes);
    } else if (nodeCrypto) {
      var buf = nodeCrypto.randomBytes(16);
      for (var i = 0; i < 16; i++) bytes[i] = buf[i];
    } else {
      // Last resort (very old browser). The id is an anonymous key, not a
      // secret; Math.random still needs to avoid collisions, nothing more.
      for (var j = 0; j < 16; j++) bytes[j] = Math.floor(Math.random() * 256);
    }
    var out = '';
    for (var k = 0; k < 16; k++) out += (bytes[k] < 16 ? '0' : '') + bytes[k].toString(16);
    return out;
  }

  function readCookie(name) {
    try {
      var doc = root && root.document;
      if (!doc || typeof doc.cookie !== 'string') return null;
      var parts = doc.cookie.split(';');
      for (var i = 0; i < parts.length; i++) {
        var pair = parts[i].replace(/^\s+/, '');
        var eq = pair.indexOf('=');
        if (eq < 0) continue;
        if (pair.slice(0, eq) === name) {
          try { return decodeURIComponent(pair.slice(eq + 1)); } catch (e) { return pair.slice(eq + 1); }
        }
      }
    } catch (e) {}
    return null;
  }

  function writeCookie(name, value) {
    try {
      var doc = root && root.document;
      if (!doc) return false;
      if (value == null) {
        doc.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
      } else {
        doc.cookie = name + '=' + encodeURIComponent(value) +
          '; Path=/; Max-Age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  function openIdb() {
    return new Promise(function (resolve, reject) {
      var idb = root && root.indexedDB;
      if (!idb || typeof idb.open !== 'function') { reject(new Error('no_indexeddb')); return; }
      var req;
      try { req = idb.open('hhfa-id', 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        try {
          var db = req.result;
          if (!db.objectStoreNames || !db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        } catch (e) {}
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb_open_failed')); };
      req.onblocked = function () { reject(new Error('idb_blocked')); };
    });
  }

  var dbPromise = null;
  function getDb() {
    if (!dbPromise) {
      dbPromise = openIdb().catch(function (e) { dbPromise = null; throw e; });
    }
    return dbPromise;
  }

  var realIdb = {
    get: function (key) {
      return getDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('kv', 'readonly');
          var rq = tx.objectStore('kv').get(key);
          rq.onsuccess = function () { resolve(rq.result == null ? null : rq.result); };
          rq.onerror = function () { reject(rq.error || new Error('idb_get_failed')); };
        });
      });
    },
    set: function (key, value) {
      return getDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error || new Error('idb_set_failed')); };
        });
      });
    },
    del: function (key) {
      return getDb().then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').delete(key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { reject(tx.error || new Error('idb_del_failed')); };
        });
      });
    }
  };

  function adapter() {
    return idbAdapter || realIdb;
  }

  function withTimeout(promise, ms, fallback) {
    return new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve(fallback);
      }, ms);
      function done(v) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      }
      Promise.resolve(promise).then(done, function () { done(fallback); });
    });
  }

  function idbGet(key) {
    var p;
    try { p = adapter().get(key); } catch (e) { return Promise.resolve(null); }
    return withTimeout(p, IDB_TIMEOUT_MS, null).then(function (v) {
      return v == null ? null : String(v);
    });
  }

  function idbSet(key, value) {
    try {
      var p = adapter().set(key, value);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function idbDel(key) {
    try {
      var p = adapter().del(key);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (e) {}
  }

  function rememberDevice(d, source) {
    cachedDevice = d;
    deviceSource = source;
  }

  function writeBackups(d) {
    if (readCookie(COOKIE_DEVICE) !== d) writeCookie(COOKIE_DEVICE, d);
    idbSet(KEY_DEVICE, d);
  }

  // Synchronous best effort. Prefers localStorage, then the cookie. The
  // authoritative order (localStorage -> IndexedDB -> cookie) is enforced by
  // ready(), which can wait for IndexedDB.
  function device() {
    if (cachedDevice) return cachedDevice;

    var v = localGet(KEY_DEVICE);
    if (validDevice(v)) {
      rememberDevice(v, 'local');
      writeBackups(v);
      return v;
    }

    v = readCookie(COOKIE_DEVICE);
    if (validDevice(v)) {
      rememberDevice(v, 'cookie');
      localSet(KEY_DEVICE, v);
      writeBackups(v);
      return v;
    }

    v = randomHex32();
    rememberDevice(v, 'new');
    localSet(KEY_DEVICE, v);
    writeBackups(v);
    return v;
  }

  // Authoritative recovery: localStorage -> IndexedDB -> cookie. If the sync
  // path had to invent an id while IndexedDB was still unread, an id found in
  // IndexedDB wins over the fresh one (and over a cookie, per the order above).
  function ready() {
    if (readyPromise) return readyPromise;
    readyPromise = idbGet(KEY_DEVICE).then(function (stored) {
      var d = device();
      if (validDevice(stored)) {
        if (deviceSource !== 'local' && stored !== d) {
          d = stored;
          rememberDevice(d, 'idb');
          localSet(KEY_DEVICE, d);
          if (readCookie(COOKIE_DEVICE) !== d) writeCookie(COOKIE_DEVICE, d);
        } else if (stored !== d) {
          idbSet(KEY_DEVICE, d);
        }
      } else {
        idbSet(KEY_DEVICE, d);
      }
      return d;
    });
    return readyPromise;
  }

  /* ------------------------------------------------------------------ *
   * SHA-256 (sync) for the anonymous short id                          *
   * ------------------------------------------------------------------ */

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
          i++;
        } else {
          out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decode(bytes) {
    if (root && typeof root.TextDecoder === 'function') {
      try { return new root.TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch (e) { return null; }
    }
    var s = '';
    for (var i = 0; i < bytes.length;) {
      var c = bytes[i++];
      if (c < 0x80) { s += String.fromCharCode(c); continue; }
      var n, cp;
      if ((c & 0xe0) === 0xc0) { n = 1; cp = c & 31; }
      else if ((c & 0xf0) === 0xe0) { n = 2; cp = c & 15; }
      else if ((c & 0xf8) === 0xf0) { n = 3; cp = c & 7; }
      else { return null; }
      if (i + n > bytes.length) return null;
      for (var j = 0; j < n; j++) {
        var b = bytes[i++];
        if ((b & 0xc0) !== 0x80) return null;
        cp = (cp << 6) | (b & 63);
      }
      if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
      if (cp > 0xffff) {
        cp -= 0x10000;
        s += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        s += String.fromCharCode(cp);
      }
    }
    return s;
  }

  function sha256Hex(input) {
    var bytes = utf8Bytes(String(input));
    var bitLen = bytes.length * 8;
    var msg = bytes.slice();
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    msg.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    msg.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64);
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

    for (var off = 0; off < msg.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        var p = off + t * 4;
        W[t] = ((msg[p] << 24) | (msg[p + 1] << 16) | (msg[p + 2] << 8) | msg[p + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        var s0 = (rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3)) >>> 0;
        var s1 = (rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10)) >>> 0;
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (t = 0; t < 64; t++) {
        var S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        var ch = ((e & f) ^ (~e & g)) >>> 0;
        var temp1 = (h + S1 + ch + SHA_K[t] + W[t]) >>> 0;
        var S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        var maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }

    var hex = '';
    for (var i = 0; i < 8; i++) {
      var word = H[i];
      hex += ((word >>> 28) & 15).toString(16) + ((word >>> 24) & 15).toString(16) +
        ((word >>> 20) & 15).toString(16) + ((word >>> 16) & 15).toString(16) +
        ((word >>> 12) & 15).toString(16) + ((word >>> 8) & 15).toString(16) +
        ((word >>> 4) & 15).toString(16) + (word & 15).toString(16);
    }
    return hex;
  }

  /* ------------------------------------------------------------------ *
   * Names                                                              *
   * ------------------------------------------------------------------ */

  // Identity nicknames must pass the worker's validator: 1..12 code points
  // from [一-龥A-Za-z0-9 #_-], no angle brackets. We strip disallowed code
  // points instead of returning an error so a Save click never loses input
  // silently; the field shows the cleaned value back to the user.
  var NAME_CHAR = /^[一-龥A-Za-z0-9 #_-]$/u;

  function cleanName(input) {
    if (typeof input !== 'string') return '';
    var stripped = input
      .replace(/[<>]/g, ' ')
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠﻿]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var chars = Array.from(stripped).filter(function (ch) { return NAME_CHAR.test(ch); });
    var s = chars.join('').replace(/\s+/g, ' ').trim();
    if (chars.length > MAX_NAME) s = chars.slice(0, MAX_NAME).join('').trim();
    return s;
  }

  // Challenge names never reach the server, so emoji and "#" are allowed, but
  // they use the same 12-code-point limit as identity nicknames. Slicing is by
  // code point (Array.from), never by UTF-16 code unit, so no half emoji.
  function cleanChallengeName(input) {
    if (typeof input !== 'string') return '';
    var s = input
      .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠﻿]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var chars = Array.from(s);
    if (chars.length > MAX_NAME) s = chars.slice(0, MAX_NAME).join('').trim();
    return s;
  }

  function getName() {
    return cleanName(localGet(KEY_NAME) || '');
  }

  function setName(name) {
    var clean = cleanName(name);
    if (clean) localSet(KEY_NAME, clean);
    else localRemove(KEY_NAME);
    return clean;
  }

  function shortId(value) {
    var d = validDevice(value) ? value : device();
    return '#' + sha256Hex(d).slice(0, 4).toUpperCase();
  }

  function anonymousName(value) {
    return '玩家 ' + shortId(value);
  }

  // Display and submission both use "玩家 #A7F3". The worker accepts "#" as of
  // its redeploy, so submit is a single request.
  function submitName(value) {
    return getName() || anonymousName(value);
  }

  function displayName() {
    return getName() || anonymousName();
  }

  /* ------------------------------------------------------------------ *
   * Local score snapshot (only used to render "my rank")               *
   * ------------------------------------------------------------------ */

  function readScores() {
    var raw = localGet(KEY_SCORES);
    if (!raw) return {};
    try {
      var data = JSON.parse(raw);
      return data && typeof data === 'object' ? data : {};
    } catch (e) {
      return {};
    }
  }

  function better(kind, next, prev) {
    if (prev == null) return true;
    return kind === 'time' ? next < prev : next > prev;
  }

  function saveScore(rec) {
    var all = readScores();
    var old = all[rec.game];
    var oldValue = old && finiteNumber(old.value);
    if (oldValue == null || better(rec.kind, rec.value, oldValue)) {
      all[rec.game] = rec;
    } else if (rec.rank) {
      all[rec.game] = {
        game: rec.game, value: old.value, kind: old.kind || rec.kind,
        rank: rec.rank, name: rec.name, at: rec.at
      };
    } else {
      return;
    }
    try { localSet(KEY_SCORES, JSON.stringify(all)); } catch (e) {}
  }

  function myBest(game) {
    var rec = readScores()[game];
    if (!rec || finiteNumber(rec.value) == null) return null;
    return rec;
  }

  /* ------------------------------------------------------------------ *
   * Ranking                                                            *
   * ------------------------------------------------------------------ */

  // Returns a new array sorted best-first. "time" is lower-is-better, "xp"
  // and "streak" are higher-is-better. Ties share a rank and the next rank
  // skips accordingly (1, 1, 3).
  function rankRows(rows, kind) {
    if (!Array.isArray(rows)) return [];
    var k = isKind(kind) ? kind
      : (rows[0] && isKind(rows[0].kind) ? rows[0].kind : 'xp');
    var entries = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var value = row && finiteNumber(row.value);
      if (value == null) continue;
      entries.push({ row: row, value: value, index: i });
    }
    entries.sort(function (a, b) {
      if (a.value !== b.value) return k === 'time' ? a.value - b.value : b.value - a.value;
      return a.index - b.index;
    });
    var out = [];
    var prev = null;
    var prevRank = 0;
    for (var j = 0; j < entries.length; j++) {
      var e = entries[j];
      var rank = (prev !== null && e.value === prev) ? prevRank : j + 1;
      prev = e.value;
      prevRank = rank;
      var copy = {};
      for (var key in e.row) {
        if (Object.prototype.hasOwnProperty.call(e.row, key)) copy[key] = e.row[key];
      }
      copy.value = e.value;
      copy.rank = rank;
      out.push(copy);
    }
    return out;
  }

  function isEmptyBoard(rows) {
    return !Array.isArray(rows) || rows.length === 0;
  }

  /* ------------------------------------------------------------------ *
   * Challenge links (pure)                                             *
   * ------------------------------------------------------------------ */

  function bytesToBinary(bytes) {
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return bin;
  }

  function base64UrlEncode(str) {
    var bytes = utf8Bytes(str);
    var b64;
    if (root && typeof root.btoa === 'function') b64 = root.btoa(bytesToBinary(bytes));
    else if (typeof Buffer !== 'undefined') b64 = Buffer.from(bytes).toString('base64');
    else return null;
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(str) {
    var b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin;
    if (root && typeof root.atob === 'function') {
      try { bin = root.atob(b64); } catch (e) { return null; }
    } else if (typeof Buffer !== 'undefined') {
      try { bin = Buffer.from(b64, 'base64').toString('binary'); } catch (e) { return null; }
    } else {
      return null;
    }
    var bytes = [];
    for (var i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i) & 255);
    return utf8Decode(bytes);
  }

  function buildChallenge(state) {
    if (!state || typeof state !== 'object') return null;
    if (!isSlug(state.game)) return null;
    var value = normalizeValue(state.kind, state.value);
    if (value == null) return null;
    if (!isKind(state.kind)) return null;
    var name = cleanChallengeName(state.name);
    if (!name) return null;
    var at = finiteNumber(state.at);
    if (at == null || at < 0) at = 0;
    at = Math.floor(at);
    var payload = { game: state.game, value: value, kind: state.kind, name: name, at: at };
    var encoded = base64UrlEncode(JSON.stringify(payload));
    if (!encoded || encoded.length > MAX_CHALLENGE) return null;
    return encoded;
  }

  function parseChallenge(str) {
    if (typeof str !== 'string' || !str || str.length > MAX_CHALLENGE) return null;
    if (!/^[A-Za-z0-9_-]+$/.test(str)) return null;
    var json = base64UrlDecode(str);
    if (!json) return null;
    var data;
    try { data = JSON.parse(json); } catch (e) { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (!isSlug(data.game) || !isKind(data.kind)) return null;
    var value = normalizeValue(data.kind, data.value);
    if (value == null) return null;
    var name = cleanChallengeName(data.name);
    if (!name) return null;
    var at = finiteNumber(data.at);
    if (at == null || at < 0) return null;
    return { game: data.game, value: value, kind: data.kind, name: name, at: Math.floor(at) };
  }

  /* ------------------------------------------------------------------ *
   * HTTP                                                               *
   * ------------------------------------------------------------------ */

  function apiBase() {
    return String(cfg.api || DEFAULT_API).replace(/\/+$/, '');
  }

  function request(path, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var fetchFn = root && root.fetch;
      if (typeof fetchFn !== 'function') { resolve({ ok: false, error: 'offline' }); return; }

      var done = false;
      var timer = null;
      var controller = null;
      function finish(value) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve(value);
      }

      var init = {
        method: opts.method || 'GET',
        credentials: 'omit',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      };
      if (opts.body != null) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
      if (root && typeof root.AbortController === 'function') {
        try {
          controller = new root.AbortController();
          init.signal = controller.signal;
        } catch (e) { controller = null; }
      }

      timer = setTimeout(function () {
        if (controller) { try { controller.abort(); } catch (e) {} }
        finish({ ok: false, error: 'timeout' });
      }, TIMEOUT_MS);

      var p;
      try {
        p = fetchFn(apiBase() + path, init);
      } catch (e) {
        finish({ ok: false, error: 'offline' });
        return;
      }

      Promise.resolve(p).then(function (res) {
        var status = res && res.status;
        var bodyPromise;
        if (res && typeof res.json === 'function') {
          bodyPromise = Promise.resolve(res.json()).catch(function () { return null; });
        } else {
          bodyPromise = Promise.resolve(null);
        }
        return bodyPromise.then(function (data) {
          if (res && res.ok && data && data.ok !== false) {
            finish({ ok: true, status: status, data: data });
            return;
          }
          if (status === 429) {
            var retry = data && finiteNumber(data.retryAfter);
            if (retry == null && res && res.headers && typeof res.headers.get === 'function') {
              retry = finiteNumber(res.headers.get('Retry-After'));
            }
            finish({ ok: false, error: 'rate_limited', retryAfter: retry == null ? 0 : retry });
            return;
          }
          var err = data && typeof data.error === 'string' ? data.error : 'http_' + (status || 0);
          finish({ ok: false, error: err, status: status });
        });
      }, function () {
        finish({ ok: false, error: 'offline' });
      }).catch(function () {
        finish({ ok: false, error: 'offline' });
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * Mock data (?mock=1)                                                *
   * ------------------------------------------------------------------ */

  var MOCK = {
    xiangqi: { kind: 'time', rows: [
      ['棋痴老王', 96, 'tri', 38, 28],
      ['楚河汉界', 112, 'hex', 214, 220],
      ['过河卒', 118, 'diamond', 8, 356],
      ['半壁江山', 131, 'square', 145, 152],
      ['当头炮', 147, 'circle', 272, 280],
      ['马后炮', 158, 'star', 42, 36],
      ['仙人指路', 171, 'circle', 200, 208],
      ['单车寡炮', 189, 'square', 340, 332],
      ['飞相局', 204, 'diamond', 80, 72],
      ['老兵搜山', 233, 'circle', 215, 210]
    ] },
    chess: { kind: 'xp', rows: [
      ['RookAndRoll', 1840, 'square', 38, 28],
      ['QueenSide', 1725, 'circle', 214, 220],
      ['EnPassant', 1690, 'tri', 8, 356],
      ['CastleEarly', 1640, 'diamond', 145, 152],
      ['KnightOwl', 1585, 'star', 272, 280],
      ['PawnStorm', 1510, 'square', 42, 36]
    ] },
    connect4: { kind: 'xp', rows: [
      ['四连星', 980, 'circle', 145, 152],
      ['落子无悔', 940, 'hex', 38, 28],
      ['竖着赢', 905, 'square', 214, 220],
      ['斜线专家', 860, 'diamond', 8, 356]
    ] },
    solitaire: { kind: 'time', rows: [
      ['一张一张翻', 214, 'hex', 214, 220],
      ['红黑交替', 236, 'circle', 38, 28],
      ['空列收藏家', 251, 'tri', 272, 280],
      ['K 先归位', 268, 'star', 145, 152],
      ['耐心玩家', 305, 'circle', 340, 332]
    ] },
    '24game': { kind: 'time', rows: [
      ['心算机器', 9, 'diamond', 42, 36],
      ['四则运算', 12, 'circle', 145, 152],
      ['括号大师', 15, 'hex', 214, 220],
      ['先乘除后加减', 21, 'square', 8, 356]
    ] },
    gomoku: { kind: 'xp', rows: [
      ['五连珠', 760, 'circle', 38, 28],
      ['禁手研究', 705, 'hex', 272, 280],
      ['活三', 668, 'square', 145, 152]
    ] },
    freecell: { kind: 'time', rows: [
      ['空当高手', 188, 'circle', 214, 220],
      ['八列腾挪', 205, 'tri', 38, 28],
      ['单张搬运', 240, 'square', 8, 356]
    ] },
    mahjong: { kind: 'xp', rows: [] }
  };

  function mockRows(game) {
    var spec = MOCK[game];
    if (!spec) return [];
    var now = nowMs();
    var rows = [];
    for (var i = 0; i < spec.rows.length; i++) {
      var r = spec.rows[i];
      rows.push({
        rank: i + 1,
        name: r[0],
        avatar: { h1: r[3], h2: r[4], shape: r[2] },
        value: r[1],
        kind: spec.kind,
        at: now - (i + 1) * 42 * 60000
      });
    }
    return rankRows(rows, spec.kind);
  }

  /* ------------------------------------------------------------------ *
   * Public API                                                         *
   * ------------------------------------------------------------------ */

  async function submit(opts) {
    opts = opts || {};
    if (!isSlug(opts.game)) return { ok: false, error: 'bad_game' };
    var kind = isKind(opts.kind) ? opts.kind : 'xp';
    var value = normalizeValue(kind, opts.value);
    if (value == null) return { ok: false, error: 'bad_value' };

    var d;
    try { d = await ready(); } catch (e) { d = device(); }
    var name = submitName(d);
    var at = nowMs();

    if (isMock()) {
      var rows = mockRows(opts.game);
      var rank = 1;
      for (var i = 0; i < rows.length; i++) {
        if (kind === 'time' ? rows[i].value < value : rows[i].value > value) rank++;
      }
      var best = value;
      for (var j = 0; j < rows.length; j++) {
        if (better(kind, rows[j].value, best)) best = rows[j].value;
      }
      saveScore({ game: opts.game, value: best, kind: kind, rank: rank, name: name, at: at });
      announce(opts.game);
      return { ok: true, rank: rank, best: best, mock: true };
    }

    var res = await request('/api/score', {
      method: 'POST',
      body: { device: d, name: name, game: opts.game, value: value, kind: kind }
    });
    if (!res.ok) return res;

    var serverRank = finiteNumber(res.data.rank);
    var serverBest = finiteNumber(res.data.best);
    saveScore({
      game: opts.game,
      value: serverBest == null ? value : serverBest,
      kind: kind,
      rank: serverRank == null ? 0 : serverRank,
      name: name,
      at: at
    });
    announce(opts.game);
    return {
      ok: true,
      rank: serverRank == null ? 0 : serverRank,
      best: serverBest == null ? value : serverBest
    };
  }

  function announce(game) {
    try {
      if (root && root.document && typeof root.CustomEvent === 'function') {
        root.document.dispatchEvent(new root.CustomEvent('leaderboard:submit', { detail: { game: game } }));
      }
    } catch (e) {}
  }

  async function board(opts) {
    opts = opts || {};
    if (!isSlug(opts.game)) return { ok: false, error: 'bad_game' };
    var period = opts.period === 'all' ? 'all' : 'week';
    var limit = finiteNumber(opts.limit);
    limit = limit == null ? 50 : Math.max(1, Math.min(50, Math.floor(limit)));

    if (isMock()) {
      var rows = mockRows(opts.game);
      if (period === 'week') {
        var cutoff = nowMs() - 7 * 24 * 60 * 60 * 1000;
        rows = rows.filter(function (r) { return finiteNumber(r.at) == null || r.at >= cutoff; });
      }
      rows = rows.slice(0, limit);
      return {
        ok: true,
        period: period,
        game: opts.game,
        updatedAt: new Date(nowMs()).toISOString(),
        rows: rows,
        total: rows.length,
        mock: true
      };
    }

    var res = await request('/api/board?game=' + encodeURIComponent(opts.game) +
      '&period=' + period + '&limit=' + limit, { method: 'GET' });
    if (!res.ok) return res;

    var data = res.data || {};
    var rawRows = Array.isArray(data.rows) ? data.rows : [];
    var normalized = [];
    for (var i = 0; i < rawRows.length; i++) {
      var r = rawRows[i];
      if (!r || typeof r !== 'object') continue;
      var v = finiteNumber(r.value);
      if (v == null) continue;
      normalized.push({
        rank: finiteNumber(r.rank) || 0,
        name: cleanName(r.name) || '玩家',
        avatar: r.avatar && typeof r.avatar === 'object' ? r.avatar : null,
        value: v,
        kind: isKind(r.kind) ? r.kind : (rawRows[0] && rawRows[0].kind) || 'xp',
        at: timestampMs(r.at)
      });
    }
    // The worker groups rows by kind (xp, streak, time) and ranks each group
    // independently. Mirror that here instead of ranking mixed kinds together.
    var groups = { xp: [], streak: [], time: [] };
    for (var j = 0; j < normalized.length; j++) groups[normalized[j].kind].push(normalized[j]);
    var ranked = [];
    ['xp', 'streak', 'time'].forEach(function (k) {
      if (groups[k].length) ranked = ranked.concat(rankRows(groups[k], k));
    });
    var total = finiteNumber(data.total);
    return {
      ok: true,
      period: period,
      game: opts.game,
      updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
      rows: ranked,
      total: total == null ? ranked.length : Math.floor(total)
    };
  }

  function available() {
    if (isMock()) return Promise.resolve(true);
    var now = nowMs();
    if (health.value !== null && now - health.at < HEALTH_TTL_MS) {
      return Promise.resolve(health.value);
    }
    if (healthPromise) return healthPromise;
    healthPromise = request('/health', { method: 'GET' }).then(function (r) {
      health = { value: !!r.ok, at: nowMs() };
      healthPromise = null;
      return health.value;
    });
    return healthPromise;
  }

  function clearLocal() {
    localRemove(KEY_DEVICE);
    localRemove(KEY_NAME);
    localRemove(KEY_SCORES);
    writeCookie(COOKIE_DEVICE, null);
    idbDel(KEY_DEVICE);
    cachedDevice = null;
    deviceSource = null;
    readyPromise = null;
  }

  // Wait for the old id to be gone before writing a fresh one; otherwise a
  // later ready() could read the old value back out of IndexedDB.
  function idbDelAwaited(key) {
    var p;
    try { p = adapter().del(key); } catch (e) { return Promise.resolve(false); }
    return withTimeout(p, IDB_TIMEOUT_MS, false);
  }

  // Rotates the device only after the server confirms the delete. If the
  // server is unreachable we keep the old id so the user can retry; rotating
  // first would strand the server-side record under an id nobody holds.
  async function deleteAll() {
    var d = await ready();
    var res;
    if (isMock()) res = { ok: true };
    else res = await request('/api/delete', { method: 'POST', body: { device: d } });
    if (!res.ok) return { ok: false, error: res.error, localCleared: false };

    clearLocal();
    await idbDelAwaited(KEY_DEVICE);
    var fresh = device();
    health = { value: null, at: 0 };
    return { ok: true, device: fresh, localCleared: true };
  }

  function resetForTest() {
    memory = {};
    cachedDevice = null;
    deviceSource = null;
    readyPromise = null;
    health = { value: null, at: 0 };
    healthPromise = null;
    dbPromise = null;
    idbAdapter = null;
  }

  var api = {
    device: device,
    ready: ready,
    getName: getName,
    setName: setName,
    displayName: displayName,
    anonymousName: anonymousName,
    submitName: submitName,
    shortId: shortId,
    cleanName: cleanName,
    submit: submit,
    board: board,
    available: available,
    deleteAll: deleteAll,
    myBest: myBest,
    rankRows: rankRows,
    isEmptyBoard: isEmptyBoard,
    buildChallenge: buildChallenge,
    parseChallenge: parseChallenge,
    isMock: isMock,
    _sha256Hex: sha256Hex,
    _setIdbAdapter: function (adapterImpl) { idbAdapter = adapterImpl || null; },
    _resetForTest: resetForTest
  };

  Object.defineProperty(api, 'API', {
    enumerable: true,
    get: function () { return cfg.api; },
    set: function (value) {
      if (typeof value === 'string' && value) cfg.api = value.replace(/\/+$/, '');
    }
  });

  return api;
});
