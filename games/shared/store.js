/* Shared safe-storage helpers for the games.

   Why this exists
   ---------------
   Nineteen pages under games/ each hand-rolled the same localStorage
   read/write pair (loadBest/saveBest, stats load/save, JSON get/set). Every
   copy had to repeat the same try/catch dance, because localStorage throws in
   private mode and when the quota is full. This module is that one copy.

   Contract
   --------
   - Keys pass through untouched: no prefix, no migration, no renaming. The
     caller's existing key (e.g. 'g24-best-streak-v1') is the storage key, so
     upgrading a page never loses a player's saved history.
   - Values are stored as strings, exactly like localStorage itself. Numeric
     helpers (best) compare numbers; JSON helpers parse/stringify.
   - Nothing here ever throws. A failed read returns the caller's fallback, a
     failed write returns false. Callers that do not care about the result can
     ignore it, matching the old `catch (e) {}` behaviour.

   UMD: browsers read window.Store, Node reads module.exports. One file, no
   dependencies, no network, no user data.
*/
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.Store = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // Looked up at call time (not at load time) so tests can inject a fake
  // storage, and so a browser that throws on property access is caught here.
  function storage() {
    try {
      var s = root && root.localStorage;
      if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  function get(key, fallback) {
    var s = storage();
    if (!s) return fallback;
    try {
      var v = s.getItem(key);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    var s = storage();
    if (!s) return false;
    try {
      s.setItem(key, String(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function getJSON(key, fallback) {
    var raw = get(key, null);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function setJSON(key, value) {
    var text;
    try {
      text = JSON.stringify(value);
    } catch (e) {
      return false; // circular structure, BigInt, throwing toJSON, ...
    }
    // JSON.stringify(undefined/function/symbol) yields undefined, which is not
    // a usable JSON value; refuse rather than store the string "undefined".
    if (typeof text !== 'string') return false;
    return set(key, text);
  }

  function toNumber(value) {
    try {
      var n = typeof value === 'number' ? value : Number(value);
      return isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }

  // best(key, value, { mode: 'max' | 'min' }) -> true when the stored value
  // changed. A missing or non-numeric stored value counts as "no record", so
  // the first finite value always wins (including negative scores in max mode).
  function best(key, value, opts) {
    var v = toNumber(value);
    if (v === null) return false;
    var mode = opts && opts.mode === 'min' ? 'min' : 'max';
    var raw = get(key, null);
    var cur = raw === null ? null : toNumber(raw);
    if (cur !== null) {
      var better = mode === 'min' ? v < cur : v > cur;
      if (!better) return false;
    }
    return set(key, String(v));
  }

  // record(key, patch, { merge: 'object' }) -> the merged object that was
  // written. Only shallow object merging is supported; patch values replace
  // the existing keys. A corrupt/array/non-object stored value is treated as
  // {} so one bad record cannot block future writes. A failed write is silent
  // (matching the old pages): the merged object is still returned for render.
  function record(key, patch, opts) {
    var out = {};
    try {
      var base = getJSON(key, {});
      var k;
      if (base && typeof base === 'object' && !Array.isArray(base)) {
        for (k in base) {
          if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
        }
      }
      if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
        for (k in patch) {
          if (Object.prototype.hasOwnProperty.call(patch, k)) out[k] = patch[k];
        }
      }
    } catch (e) {
      // A hostile getter in patch must not escape; fall through with what we
      // have and still hand the caller something renderable.
    }
    setJSON(key, out);
    return out;
  }

  return {
    get: get,
    set: set,
    getJSON: getJSON,
    setJSON: setJSON,
    best: best,
    record: record
  };
});
