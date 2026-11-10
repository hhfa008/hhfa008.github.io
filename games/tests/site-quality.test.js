#!/usr/bin/env node
'use strict';

/*
 * CommonJS wrapper for games/tests/site-quality.mjs.
 *
 * run-all.js expects a single RESULT line from a child process, so this wrapper
 * spawns the ESM checker, relays its output (minus the child RESULT line) and
 * prints exactly one `RESULT: N passed, M failed` line itself.
 *
 * Before the long sweep it runs a cheap concurrency self-test: two checker
 * processes save progress to the same target at the same instant. The old
 * fixed `site-quality-progress.json.tmp` name made the slower rename fail with
 * ENOENT whenever two run-all instances overlapped; both writers must now exit
 * cleanly and no `.tmp` file may be left behind.
 *
 * The browser sweep plus the share-card E2E is the slowest test in the suite,
 * hence the 600s timeout.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var TIMEOUT_MS = 600000;
var PROGRESS_SELFTEST_ROUNDS = 60;
var ROOT = path.resolve(__dirname, '..', '..');
var SCRIPT = path.join(__dirname, 'site-quality.mjs');
var RESULT_RE = /^RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed\s*$/i;

function relay(text) {
  var lines = String(text || '').split(/\r?\n/);
  var kept = [];
  lines.forEach(function (line) {
    if (!RESULT_RE.test(line.trim())) kept.push(line);
  });
  var output = kept.join('\n').replace(/\s+$/, '');
  if (output) console.log(output);
}

/* Scratch lives outside the repo and outside /tmp, per the workspace rules. */
function scratchDir() {
  var dir = path.join(process.env.HOME || os.homedir(), 'games', '.tmp', 'games-batch-testiso');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runProbe(target, barrier) {
  return new Promise(function (resolve) {
    var proc = child.spawn(process.execPath, [SCRIPT, '--progress-self-test'], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        NO_COLOR: '1',
        SITE_QUALITY_PROGRESS: target,
        SITE_QUALITY_PROGRESS_ROUNDS: String(PROGRESS_SELFTEST_ROUNDS),
        SITE_QUALITY_PROGRESS_BARRIER: barrier
      })
    });
    var stdout = '';
    var stderr = '';
    proc.stdout.on('data', function (chunk) { stdout += chunk; });
    proc.stderr.on('data', function (chunk) { stderr += chunk; });
    proc.on('error', function (err) {
      resolve({ code: null, stdout: stdout, stderr: stderr + '\n' + err.message });
    });
    proc.on('close', function (code) {
      resolve({ code: code, stdout: stdout, stderr: stderr });
    });
  });
}

/*
 * Wait until both probes have booted and written their ready flag, then open
 * the go-file. This makes the two save loops overlap on purpose instead of
 * hoping their startup times line up.
 */
function waitForBarrier(dir, barrier, count, timeoutMs) {
  var prefix = path.basename(barrier) + '.ready-';
  return new Promise(function (resolve, reject) {
    var deadline = Date.now() + timeoutMs;
    (function poll() {
      var ready;
      try {
        ready = fs.readdirSync(dir).filter(function (name) { return name.indexOf(prefix) === 0; });
      } catch (err) { reject(err); return; }
      if (ready.length >= count) {
        try { fs.writeFileSync(barrier, 'go'); } catch (err) { reject(err); return; }
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error('timed out waiting for ' + count + ' probe(s)'));
        return;
      }
      setTimeout(poll, 10);
    })();
  });
}

function removeByPrefix(dir, prefix) {
  try {
    fs.readdirSync(dir).forEach(function (name) {
      if (name.indexOf(prefix) !== 0) return;
      try { fs.unlinkSync(path.join(dir, name)); } catch (err) { /* best effort */ }
    });
  } catch (err) { /* best effort */ }
}

async function progressSelfTest() {
  var dir = scratchDir();
  var target = path.join(dir, 'site-quality-progress-selftest-' + process.pid + '.json');
  var barrier = target + '.go';
  var problems = [];

  removeByPrefix(dir, path.basename(barrier));
  var pending = [runProbe(target, barrier), runProbe(target, barrier)];
  try {
    await waitForBarrier(dir, barrier, pending.length, 10000);
  } catch (err) {
    problems.push('probe barrier: ' + err.message);
  }

  var results = await Promise.all(pending);
  results.forEach(function (result, index) {
    var label = 'writer#' + (index + 1);
    if (result.code !== 0) problems.push(label + ' exit=' + result.code);
    if (!/RESULT:\s*\d+\s+passed,\s*0\s+failed/.test(result.stdout)) {
      problems.push(label + ' missing clean RESULT');
    }
    if (/ENOENT/.test(result.stdout + result.stderr)) {
      problems.push(label + ' reported ENOENT');
    }
    if (result.stderr.trim()) problems.push(label + ' stderr: ' + result.stderr.trim());
  });

  try {
    var saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!saved || saved.version !== 1 || !/^self-test-/.test(String(saved.fingerprint))) {
      problems.push('final progress file is not a valid last-writer snapshot');
    }
  } catch (err) {
    problems.push('final progress file unreadable: ' + err.message);
  }

  removeByPrefix(dir, path.basename(barrier));
  var leftovers = fs.readdirSync(dir).filter(function (name) {
    return name.indexOf(path.basename(target) + '.') === 0;
  });
  if (leftovers.length) problems.push('leftover temp files: ' + leftovers.join(', '));

  try { fs.unlinkSync(target); } catch (err) { /* best effort */ }

  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join('; ')
      : '2 writers x ' + PROGRESS_SELFTEST_ROUNDS + ' saves, barrier-synced, no ENOENT, no leftover .tmp'
  };
}

async function main() {
  var selfTest = await progressSelfTest();
  if (!selfTest.ok) {
    console.log('progress concurrency self-test: FAIL — ' + selfTest.detail);
    console.log('');
    console.log('RESULT: 0 passed, 1 failed');
    process.exitCode = 1;
    return;
  }
  console.log('progress concurrency self-test: PASS — ' + selfTest.detail);

  var startedAt = Date.now();
  var result = child.spawnSync(process.execPath, [SCRIPT].concat(process.argv.slice(2)), {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });

  relay(result.stdout);
  relay(result.stderr);

  var combined = String(result.stdout || '') + '\n' + String(result.stderr || '');
  var match = combined.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  var passed = 0;
  var failed = 1;

  if (result.error && result.error.code === 'ETIMEDOUT') {
    console.log('site-quality: timed out after ' + Math.round(TIMEOUT_MS / 1000) + 's');
    failed = 1;
  } else if (match) {
    passed = Number(match[1]);
    failed = Number(match[2]);
  } else {
    console.log('site-quality: child produced no RESULT line');
    failed = 1;
  }

  if (result.status !== 0 && failed === 0) failed = 1;

  console.log('');
  console.log('site-quality wrapper: ' + ((Date.now() - startedAt) / 1000).toFixed(1) + 's, exit=' +
    (result.status == null ? '?' : result.status));
  console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed === 0 && result.status === 0 ? 0 : 1;
}

main();
