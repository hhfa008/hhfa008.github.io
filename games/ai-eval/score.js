'use strict';

/*
 * Deterministic scoring helpers for the AI eval engine.
 *
 * No dependencies, no LLM judge. Everything here is pure and reproducible:
 *
 *   deepEqual(a, b)       JSON deep equality, arrays compared as SETS
 *                         (order ignored, duplicate elements ignored).
 *   canonicalKey(v)       stable string used for set equality / digests.
 *   wilsonInterval(k, n)  Wilson 95% confidence interval, hand-rolled.
 *   diffLineCount(a, b)   added + removed lines between two file contents.
 *   parseJsonLoose(text)  tolerant JSON extraction from model output.
 *   stableStringify(v)    sorted-key JSON, used to hash runs.
 *   shorten(v, max)       bounded debug strings (never dump whole answers).
 *
 * Arrays-as-sets is intentional: suite A asks for action sets and card sets,
 * and suite B compares an agent's action against the offered legal actions.
 * For answer fields whose order is semantically meaningful (poker tiebreak
 * kickers), set comparison is still correct because the same multiset must
 * be selected; only presentation order is ignored.
 */

var crypto = require('node:crypto');

var Z_95 = 1.959963984540054;

/* ----------------------------- canonical key ----------------------------- */

function canonicalKey(value, arraysAsSets) {
  var sets = arraysAsSets !== false;
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  var t = typeof value;
  if (t === 'number') {
    if (!isFinite(value)) return 'number:' + String(value);
    return 'number:' + String(value);
  }
  if (t === 'string') return 'string:' + JSON.stringify(value);
  if (t === 'boolean') return 'boolean:' + String(value);
  if (t === 'function') return 'function';
  if (Array.isArray(value)) {
    var parts = [];
    for (var i = 0; i < value.length; i++) parts.push(canonicalKey(value[i], true));
    if (sets) {
      parts.sort();
      // Set semantics: a duplicate element does not change the set.
      var uniq = [];
      for (var j = 0; j < parts.length; j++) {
        if (j === 0 || parts[j] !== parts[j - 1]) uniq.push(parts[j]);
      }
      parts = uniq;
    }
    return 'array:[' + parts.join('|') + ']';
  }
  if (t === 'object') {
    var keys = Object.keys(value).sort();
    var out = [];
    for (var k = 0; k < keys.length; k++) {
      var v = value[keys[k]];
      if (v === undefined) continue;
      out.push(JSON.stringify(keys[k]) + ':' + canonicalKey(v, true));
    }
    return 'object:{' + out.join(',') + '}';
  }
  return t + ':' + String(value);
}

function deepEqual(a, b, opts) {
  var sets = !opts || opts.arraysAsSets !== false;
  return canonicalKey(a, sets) === canonicalKey(b, sets);
}

/* ---------------------------- stable stringify --------------------------- */

function stableStringify(value) {
  if (value === null) return 'null';
  if (value === undefined) return '"__undefined__"';
  var t = typeof value;
  if (t === 'number') return isFinite(value) ? JSON.stringify(value) : 'null';
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) {
    var arr = [];
    for (var i = 0; i < value.length; i++) arr.push(stableStringify(value[i]));
    return '[' + arr.join(',') + ']';
  }
  if (t === 'object') {
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var k = 0; k < keys.length; k++) {
      if (value[keys[k]] === undefined) continue;
      parts.push(JSON.stringify(keys[k]) + ':' + stableStringify(value[keys[k]]));
    }
    return '{' + parts.join(',') + '}';
  }
  return JSON.stringify(String(value));
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/* ------------------------------ Wilson CI -------------------------------- */

// Wilson score interval for a binomial proportion. Returns null when n=0.
// p = k/n; centre and margin are the textbook Wilson formulas:
//   centre = (p + z^2/(2n)) / (1 + z^2/n)
//   margin = z * sqrt(p(1-p)/n + z^2/(4n^2)) / (1 + z^2/n)
function wilsonInterval(successes, n, z) {
  var k = Number(successes);
  var total = Number(n);
  var zz = z === undefined ? Z_95 : Number(z);
  if (!isFinite(k) || !isFinite(total) || total <= 0) return null;
  if (k < 0) k = 0;
  if (k > total) k = total;
  var p = k / total;
  var z2 = zz * zz;
  var denom = 1 + z2 / total;
  var center = (p + z2 / (2 * total)) / denom;
  var margin = zz * Math.sqrt(p * (1 - p) / total + z2 / (4 * total * total)) / denom;
  return {
    p: p,
    n: total,
    z: zz,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
}

/* ------------------------------- line diff -------------------------------- */

function linesOf(text) {
  return String(text == null ? '' : text).replace(/\r\n/g, '\n').split('\n');
}

// Count inserted + deleted lines after trimming the common prefix and suffix.
// A one-line replacement therefore counts as 2 (one removed, one added).
// This is deliberately simple: suite C only needs a bounded simplicity signal,
// correctness is gated by the test process.
function diffLineCount(before, after) {
  var a = linesOf(before);
  var b = linesOf(after);
  var start = 0;
  var maxStart = Math.min(a.length, b.length);
  while (start < maxStart && a[start] === b[start]) start++;
  var endA = a.length - 1;
  var endB = b.length - 1;
  while (endA >= start && endB >= start && a[endA] === b[endB]) {
    endA--;
    endB--;
  }
  var removed = Math.max(0, endA - start + 1);
  var added = Math.max(0, endB - start + 1);
  return { added: added, removed: removed, total: added + removed };
}

/* ---------------------------- tolerant JSON ------------------------------- */

function stripTrailingCommas(text) {
  return String(text).replace(/,\s*([}\]])/g, '$1');
}

// Find the first balanced JSON object/array starting at or after `from`.
// Respects strings and escapes, so braces inside strings do not confuse it.
function firstJsonValue(text) {
  var s = String(text || '');
  var starts = [];
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === '{' || ch === '[') { starts.push(i); break; }
  }
  if (!starts.length) return null;
  var start = starts[0];
  var open = s[start];
  var close = open === '{' ? '}' : ']';
  var depth = 0;
  var inString = false;
  var escaped = false;
  for (var p = start; p < s.length; p++) {
    var c = s[p];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, p + 1);
    }
  }
  return null;
}

function tryParse(candidate) {
  try { return { ok: true, value: JSON.parse(candidate) }; }
  catch (e) { return { ok: false }; }
}

// Loose extraction:
//   1. direct JSON.parse of the trimmed text
//   2. the first ```json fenced block
//   3. the first balanced object/array in the text
//   4. the same candidates with trailing commas stripped
// Returns {ok, value} or {ok:false, error}.
function parseJsonLoose(text) {
  var raw = String(text == null ? '' : text).replace(/^﻿/, '').trim();
  if (!raw) return { ok: false, error: 'empty_output' };

  var direct = tryParse(raw);
  if (direct.ok) return direct;

  var fence = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) {
    var fenced = fence[1].trim();
    var a = tryParse(fenced);
    if (a.ok) return a;
    var a2 = tryParse(stripTrailingCommas(fenced));
    if (a2.ok) return a2;
  }

  var extracted = firstJsonValue(raw);
  if (extracted) {
    var b = tryParse(extracted);
    if (b.ok) return b;
    var b2 = tryParse(stripTrailingCommas(extracted));
    if (b2.ok) return b2;
  }

  return { ok: false, error: 'invalid_json' };
}

/* ------------------------------- utilities -------------------------------- */

function shorten(value, max) {
  var limit = max || 400;
  var text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); }
    catch (e) { text = String(value); }
  }
  if (text == null) return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…(' + text.length + ' chars)';
}

function round(n, digits) {
  var f = Math.pow(10, digits === undefined ? 6 : digits);
  return Math.round(n * f) / f;
}

module.exports = {
  Z_95: Z_95,
  canonicalKey: canonicalKey,
  deepEqual: deepEqual,
  stableStringify: stableStringify,
  sha256: sha256,
  wilsonInterval: wilsonInterval,
  diffLineCount: diffLineCount,
  parseJsonLoose: parseJsonLoose,
  firstJsonValue: firstJsonValue,
  stripTrailingCommas: stripTrailingCommas,
  shorten: shorten,
  round: round
};
