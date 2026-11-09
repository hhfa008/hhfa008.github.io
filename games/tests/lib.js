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

module.exports = {
  page: page,
  between: between,
  scriptCode: scriptCode,
  evalCode: evalCode,
  evalBetween: evalBetween,
  evalScript: evalScript,
  suite: suite,
  mulberry32: mulberry32
};
