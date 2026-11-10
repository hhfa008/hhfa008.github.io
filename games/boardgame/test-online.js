#!/usr/bin/env node
'use strict';

/*
 * games/boardgame/test-online.js
 *
 * Root-level wrapper so `node games/tests/run-all.js` discovers the online
 * E2E suite (that runner only walks test*.js files). The real assertions live
 * in tests/online-e2e.test.mjs; this wrapper starts a fresh child process,
 * relays its output, and prints exactly one machine-readable line:
 *
 *   RESULT: N passed, M failed
 */

var path = require('path');
var childProcess = require('child_process');

var ROOT = __dirname;
var SUITE = path.join(ROOT, 'tests', 'online-e2e.test.mjs');
var RESULT_RE = /RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed(?:,\s*(\d+)\s+skipped)?/g;

function lastResult(stdout) {
  var match = null;
  var m;
  RESULT_RE.lastIndex = 0;
  while ((m = RESULT_RE.exec(stdout)) !== null) match = m;
  if (!match) return null;
  return { passed: Number(match[1]), failed: Number(match[2]), skipped: Number(match[3] || 0) };
}

var result = childProcess.spawnSync(process.execPath, [SUITE], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 20 * 1024 * 1024,
  env: Object.assign({}, process.env, { BOARDGAME_TEST: '1' })
});

var stdout = result.stdout || '';
var stderr = result.stderr || '';
var counts = lastResult(stdout);

if (counts) {
  var lines = stdout.trim().split('\n').filter(function (line) {
    return !/^RESULT:/.test(line.trim());
  });
  var summary = lines.slice(-16).join('\n');
  if (summary) console.log(summary);
} else {
  console.log(stdout.trim());
}

if (result.error && result.error.code === 'ETIMEDOUT') {
  console.log('FAIL: online E2E process timed out');
  counts = { passed: counts ? counts.passed : 0, failed: (counts ? counts.failed : 0) + 1 };
}

if (stderr.trim()) {
  console.error(stderr.trim().split('\n').slice(-20).join('\n'));
}

if (!counts) counts = { passed: 0, failed: 1 };
if (result.status !== 0 && counts.failed === 0) counts.failed += 1;

console.log('RESULT: ' + counts.passed + ' passed, ' + counts.failed + ' failed');
process.exit(counts.failed > 0 ? 1 : 0);
