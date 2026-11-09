#!/usr/bin/env node
'use strict';

/*
 * games/boardgame/test-e2e.js
 *
 * Root-level wrapper so `node games/tests/run-all.js` discovers the boardgame
 * end-to-end chain (run-all.js only walks test*.js files).
 *
 * It spawns `node play/e2e.mjs` with a 180s hard timeout, forwards its output,
 * and re-emits exactly one machine-readable line:
 *   RESULT: N passed, M failed
 *
 * Exit code is 1 on failure, timeout, a missing RESULT line, or a non-zero
 * child exit; 0 only when the child finished cleanly with 0 failures.
 */

var path = require('path');
var childProcess = require('child_process');

var ROOT = __dirname;
var E2E = path.join(ROOT, 'play', 'e2e.mjs');
var TIMEOUT_MS = 180000;
var RESULT_RE = /RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/g;

function parseResult(text) {
  var match = null;
  var current;
  RESULT_RE.lastIndex = 0;
  while ((current = RESULT_RE.exec(text)) !== null) match = current;
  if (!match) return null;
  return { passed: Number(match[1]), failed: Number(match[2]) };
}

function main() {
  var service = childProcess.spawn(process.execPath, [E2E], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });

  var stdout = '';
  var stderr = '';
  var pending = '';
  var timedOut = false;

  // Forward output live, but hold back the final RESULT line so this wrapper
  // emits exactly one canonical RESULT line at the end.
  service.stdout.on('data', function (chunk) {
    var text = chunk.toString();
    stdout += text;
    pending += text;
    var lines = pending.split('\n');
    pending = lines.pop();
    lines.forEach(function (line) {
      if (/^RESULT:/.test(line)) return;
      process.stdout.write(line + '\n');
    });
  });
  service.stderr.on('data', function (chunk) {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });

  var timer = setTimeout(function () {
    timedOut = true;
    try { service.kill('SIGKILL'); } catch (err) { /* ignore */ }
  }, TIMEOUT_MS);

  service.on('error', function (err) {
    clearTimeout(timer);
    console.log('');
    console.log('FAIL: could not spawn ' + E2E + ' — ' + (err && err.message ? err.message : String(err)));
    console.log('RESULT: 0 passed, 1 failed');
    process.exit(1);
  });

  service.on('close', function (code) {
    clearTimeout(timer);
    if (pending) {
      if (!/^RESULT:/.test(pending)) process.stdout.write(pending + '\n');
      stdout += '\n';
    }

    var result = parseResult(stdout);
    if (timedOut) {
      console.log('');
      console.log('FAIL: e2e.mjs exceeded ' + TIMEOUT_MS + 'ms');
      console.log('RESULT: ' + (result ? result.passed : 0) + ' passed, ' +
        Math.max(1, result ? result.failed : 0) + ' failed');
      process.exit(1);
    }
    if (!result) {
      console.log('');
      console.log('FAIL: e2e.mjs produced no RESULT line (exit ' + code + ')');
      if (stderr) console.log('stderr:\n' + stderr.slice(-2000));
      console.log('RESULT: 0 passed, 1 failed');
      process.exit(1);
    }
    if (code !== 0 || result.failed > 0) {
      console.log('');
      console.log('RESULT: ' + result.passed + ' passed, ' +
        Math.max(1, result.failed) + ' failed');
      process.exit(1);
    }
    console.log('');
    console.log('RESULT: ' + result.passed + ' passed, 0 failed');
    process.exit(0);
  });
}

main();
