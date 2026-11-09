'use strict';

/*
 * Shared helpers for the game tests.
 *
 * Tests are plain `node` scripts with no npm dependencies. Each page keeps its
 * rules engine inline; instead of copying the logic into the test, we extract
 * the engine from index.html so the assertions always run against the same
 * source the browser runs.
 */

var fs = require('fs');
var path = require('path');

// Load the shared shuffle engine first: page cores that delegate to
// globalThis.Shuffle then run against the same source in tests as in the
// browser (where index.html includes it before the inline core).
require('../shared/shuffle.js');

function page(dir) {
  return fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
}

function between(html, start, end) {
  var a = html.indexOf(start);
  var b = a < 0 ? -1 : html.indexOf(end, a + start.length);
  if (a < 0 || b < 0) {
    throw new Error('markers not found: ' + JSON.stringify(start) + ' / ' + JSON.stringify(end));
  }
  return html.slice(a + start.length, b);
}

function scriptCode(html, id) {
  var re = new RegExp('<script[^>]*id="' + id + '"[^>]*>([\\s\\S]*?)<\\/script>');
  var m = html.match(re);
  if (!m) throw new Error('script id not found: ' + id);
  return m[1];
}

// Run extracted page code inside a function scope and return `expr` from it.
// Using new Function keeps page variables out of the test scope while still
// allowing UMD blocks (which assign to globalThis) to publish their export.
function evalCode(code, expr) {
  var fn = new Function(code + '\n;return (' + expr + ');');
  return fn.call(globalThis);
}

function evalBetween(html, start, end, expr) {
  return evalCode(between(html, start, end), expr);
}

function evalScript(html, id, expr) {
  return evalCode(scriptCode(html, id), expr);
}

function suite(title) {
  var passed = 0, failed = 0, failures = [];
  var groups = [];

  function ok(label, cond, detail) {
    if (cond) {
      passed++;
    } else {
      failed++;
      failures.push(label + (detail ? ' — ' + detail : ''));
    }
  }
  function eq(label, actual, expected) {
    var a = JSON.stringify(actual), e = JSON.stringify(expected);
    ok(label, a === e, 'got ' + a + ', want ' + e);
  }
  function near(label, actual, expected, eps) {
    var e = eps == null ? 1e-9 : eps;
    ok(label, Math.abs(actual - expected) <= e, 'got ' + actual + ', want ' + expected + ' ±' + e);
  }
  function group(name, fn) {
    var p0 = passed, f0 = failed;
    var extra = fn() || '';
    var g = { name: name, pass: passed - p0, fail: failed - f0, extra: extra };
    groups.push(g);
    return g;
  }
  function done() {
    console.log('');
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      console.log('[' + (g.fail === 0 ? 'PASS' : 'FAIL') + '] ' + g.name + ': ' +
        g.pass + ' 项断言, ' + g.fail + ' 失败' + (g.extra ? ' — ' + g.extra : ''));
    }
    if (!groups.length) {
      console.log('[' + (failed === 0 ? 'PASS' : 'FAIL') + '] ' + title + ': ' +
        passed + ' 项断言, ' + failed + ' 失败');
    }
    console.log('');
    if (failures.length) {
      failures.slice(0, 40).forEach(function (f) { console.log('  FAIL: ' + f); });
    }
    console.log('总计: ' + passed + ' 通过, ' + failed + ' 失败');
    // Machine-readable line consumed by run-all.js.
    console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
    if (failed) process.exitCode = 1;
  }

  return {
    ok: ok, eq: eq, near: near, group: group, done: done,
    counts: function () { return { passed: passed, failed: failed }; }
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Tool-page helpers (tools/tests/*.test.js)
// ---------------------------------------------------------------------------

// Every key referenced from markup: data-i / data-i-ph / data-i-aria.
function dataIKeys(html) {
  var seen = Object.create(null);
  var re = /data-i(?:-ph|-aria)?="([^"]+)"/g;
  var m;
  while ((m = re.exec(html))) seen[m[1]] = true;
  return Object.keys(seen).sort();
}

// Parse every JSON-LD block. Throws when a block is not valid JSON.
function jsonLd(html) {
  var out = [];
  var re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  var m;
  while ((m = re.exec(html))) out.push(JSON.parse(m[1]));
  return out;
}

// Strings that would cause the page to make a network request or load remote
// code. The list is intentionally conservative: tools must work offline.
function externalRefs(html) {
  var checks = [
    { re: /<script[^>]*\bsrc\s*=/gi, why: '<script src>' },
    { re: /<link[^>]*\brel\s*=\s*["']?stylesheet/gi, why: 'stylesheet link' },
    { re: /@import/gi, why: '@import' },
    { re: /url\(\s*["']?https?:/gi, why: 'remote url()' },
    { re: /\bfetch\s*\(/g, why: 'fetch()' },
    { re: /XMLHttpRequest/g, why: 'XMLHttpRequest' },
    { re: /sendBeacon/g, why: 'sendBeacon' }
  ];
  var hits = [];
  checks.forEach(function (c) {
    var m = html.match(c.re);
    if (m) hits.push(c.why + ' ×' + m.length);
  });
  return hits;
}

// Assert the three dictionaries exist and expose exactly the same keys.
function checkI18n(t, dict, extraKeys) {
  var langs = ['zh', 'en', 'id'];
  langs.forEach(function (lang) {
    t.ok('i18n ' + lang + ' exists', dict && dict[lang] && typeof dict[lang] === 'object');
  });
  if (!dict || !dict.zh) return [];
  var base = Object.keys(dict.zh).sort();
  langs.slice(1).forEach(function (lang) {
    var keys = dict[lang] ? Object.keys(dict[lang]).sort() : [];
    t.eq('i18n ' + lang + ' key set matches zh', keys, base);
  });
  base.forEach(function (k) {
    langs.forEach(function (lang) {
      var v = dict[lang] && dict[lang][k];
      t.ok('i18n ' + lang + '.' + k + ' non-empty', typeof v === 'string' && v.trim().length > 0);
    });
  });
  (extraKeys || []).forEach(function (k) {
    t.ok('i18n has ' + k, base.indexOf(k) !== -1);
  });
  return base;
}

module.exports = {
  page: page,
  between: between,
  scriptCode: scriptCode,
  evalCode: evalCode,
  evalBetween: evalBetween,
  evalScript: evalScript,
  suite: suite,
  mulberry32: mulberry32,
  dataIKeys: dataIKeys,
  jsonLd: jsonLd,
  externalRefs: externalRefs,
  checkI18n: checkI18n
};
