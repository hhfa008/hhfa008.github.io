'use strict';

/*
 * Tiny zero-dependency assertion suite.
 *
 * Each test file prints one machine-readable line at the end:
 *   RESULT: N passed, M failed, K skipped
 *
 * A skipped contract is NOT a failure by default. run-all.mjs decides whether
 * skipped contracts are acceptable (default: yes, `--strict`: no).
 */

function stable(value) {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return String(value);
  }
}

export function createSuite(name, options) {
  const opts = options || {};
  const log = opts.log || function (line) { console.log(line); };
  const state = {
    passed: 0,
    failed: 0,
    skipped: 0,
    failures: [],
    skips: [],
    groups: []
  };
  let currentGroup = null;

  function prefix(label) {
    return currentGroup ? currentGroup + ' · ' + label : label;
  }

  function ok(label, condition, detail) {
    if (condition) {
      state.passed += 1;
      return true;
    }
    state.failed += 1;
    state.failures.push(prefix(label) + (detail ? ' — ' + detail : ''));
    return false;
  }

  function eq(label, actual, expected, detail) {
    const a = stable(actual);
    const e = stable(expected);
    return ok(label, a === e, (detail ? detail + '; ' : '') + 'got ' + a + ', want ' + e);
  }

  function near(label, actual, expected, epsilon, detail) {
    const eps = epsilon == null ? 1e-9 : epsilon;
    const pass = typeof actual === 'number' && Math.abs(actual - expected) <= eps;
    return ok(label, pass, (detail ? detail + '; ' : '') + 'got ' + actual + ', want ' + expected + ' ±' + eps);
  }

  function includes(label, haystack, needle, detail) {
    const pass = typeof haystack === 'string' && haystack.indexOf(needle) !== -1;
    return ok(label, pass, (detail ? detail + '; ' : '') + 'missing ' + JSON.stringify(needle));
  }

  function matches(label, value, re, detail) {
    const pass = typeof value === 'string' && re.test(value);
    return ok(label, pass, (detail ? detail + '; ' : '') + 'got ' + JSON.stringify(value) + ', want ' + re);
  }

  async function throws(label, fn, re) {
    try {
      await fn();
      return ok(label, false, 'expected an error, nothing was thrown');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      if (re) return ok(label, re.test(message), 'error message did not match ' + re + ': ' + message);
      return ok(label, true, '');
    }
  }

  async function rejects(label, fn, re) {
    return throws(label, fn, re);
  }

  function skip(label, reason) {
    state.skipped += 1;
    state.skips.push(prefix(label) + ' — ' + reason);
  }

  async function group(label, fn) {
    const before = { p: state.passed, f: state.failed, s: state.skipped };
    const previous = currentGroup;
    currentGroup = label;
    try {
      await fn();
    } catch (err) {
      ok('group crashed', false, err && err.stack ? err.stack : String(err));
    } finally {
      currentGroup = previous;
    }
    state.groups.push({
      name: label,
      passed: state.passed - before.p,
      failed: state.failed - before.f,
      skipped: state.skipped - before.s
    });
  }

  function finish() {
    log('');
    if (state.groups.length === 0) {
      log('[' + (state.failed === 0 ? 'PASS' : 'FAIL') + '] ' + name +
        ': ' + state.passed + ' passed, ' + state.failed + ' failed, ' + state.skipped + ' skipped');
    } else {
      for (const g of state.groups) {
        const tag = g.failed > 0 ? 'FAIL' : (g.skipped > 0 ? 'SKIP' : 'PASS');
        log('[' + tag + '] ' + g.name + ': ' + g.passed + ' passed, ' + g.failed +
          ' failed, ' + g.skipped + ' skipped');
      }
    }
    if (state.skips.length > 0) {
      log('');
      state.skips.forEach(function (s) { log('SKIP: ' + s); });
    }
    if (state.failures.length > 0) {
      log('');
      state.failures.slice(0, 50).forEach(function (f) { log('FAIL: ' + f); });
      if (state.failures.length > 50) log('FAIL: … ' + (state.failures.length - 50) + ' more');
    }
    log('');
    log('RESULT: ' + state.passed + ' passed, ' + state.failed + ' failed, ' + state.skipped + ' skipped');
    if (state.failed > 0) process.exitCode = 1;
  }

  async function run(fn) {
    try {
      await fn();
    } catch (err) {
      ok('suite crashed', false, err && err.stack ? err.stack : String(err));
    }
    finish();
  }

  return {
    name: name,
    ok: ok,
    eq: eq,
    near: near,
    includes: includes,
    matches: matches,
    throws: throws,
    rejects: rejects,
    skip: skip,
    group: group,
    run: run,
    finish: finish,
    counts: function () {
      return { passed: state.passed, failed: state.failed, skipped: state.skipped };
    }
  };
}
