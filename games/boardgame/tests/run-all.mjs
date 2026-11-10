#!/usr/bin/env node
'use strict';

/*
 * Zero-dependency runner for games/boardgame/tests/*.test.mjs.
 *
 * Usage:
 *   node games/boardgame/tests/run-all.mjs
 *   node games/boardgame/tests/run-all.mjs --strict
 *   node games/boardgame/tests/run-all.mjs --filter=audio
 *   node games/boardgame/tests/run-all.mjs --timeout=180000
 *
 * Every test file runs in its own child process, so a crash or hang cannot
 * take down the other contracts. Each child prints one final line:
 *   RESULT: N passed, M failed, K skipped
 *
 * Files whose wall clock is inherently longer than the 120s default carry a
 * per-file limit in TIMEOUT_OVERRIDES (keyed by path relative to the boardgame
 * root). An explicit --timeout always wins and applies to every file.
 *
 * Exit code:
 *   0 — all executed assertions passed (skipped future modules allowed)
 *   1 — an assertion failed, a child crashed, or --strict was used and any
 *       contract was skipped because its module does not exist yet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(TESTS_DIR);
const RESULT_RE = /RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed(?:,\s*(\d+)\s+skipped)?/g;
const DEFAULT_TIMEOUT_MS = 120000;

// play/e2e.mjs drives two CDP tabs through the whole user-visible chain
// (lobby -> rooms -> match -> result). Since the static server now force-closes
// keep-alive sockets and the E2E client sends Connection: close, teardown no
// longer dominates: measured 8.56s / 8.69s / 8.59s total (close phase 0.00s,
// chain ~8.5s). 20s is ~2.3x the slowest measured run; the 120s default
// remains for every other file.
// Keyed by path relative to ROOT, with forward slashes.
const TIMEOUT_OVERRIDES = {
  'play/e2e.mjs': 20000
};

function timeoutFor(relPath, opts) {
  if (opts.timeoutExplicit) return opts.timeout;
  return Object.prototype.hasOwnProperty.call(TIMEOUT_OVERRIDES, relPath)
    ? TIMEOUT_OVERRIDES[relPath]
    : opts.timeout;
}

function parseArgs(argv) {
  const opts = { strict: false, filter: null, timeout: DEFAULT_TIMEOUT_MS, timeoutExplicit: false, baseline: true, json: false };
  for (const arg of argv) {
    if (arg === '--strict') opts.strict = true;
    else if (arg === '--no-baseline') opts.baseline = false;
    else if (arg === '--json') opts.json = true;
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length);
    else if (arg.startsWith('--timeout=')) {
      opts.timeout = Number(arg.slice('--timeout='.length)) || DEFAULT_TIMEOUT_MS;
      opts.timeoutExplicit = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('usage: node run-all.mjs [--strict] [--no-baseline] [--json] [--filter=<substr>] [--timeout=<ms>]');
      process.exit(0);
    } else {
      console.error('unknown argument: ' + arg);
      process.exit(2);
    }
  }
  return opts;
}

function discover(dir, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'lib' || entry.name === 'fixtures' || entry.name === 'node_modules') continue;
      discover(full, out);
    } else if (entry.isFile() && /\.test\.mjs$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function lastResult(stdout) {
  let match = null;
  let m;
  RESULT_RE.lastIndex = 0;
  while ((m = RESULT_RE.exec(stdout)) !== null) match = m;
  if (!match) return null;
  return { passed: Number(match[1]), failed: Number(match[2]), skipped: Number(match[3] || 0) };
}

function indentedLines(text, prefix) {
  return String(text || '').split('\n').filter(Boolean).map(function (line) {
    return prefix + line;
  }).join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = discover(TESTS_DIR, []).filter(function (file) {
    if (!opts.filter) return true;
    return path.relative(ROOT, file).indexOf(opts.filter) !== -1;
  });

  // The adopted A-baseline gate (tests/run.js) is plain CommonJS and lives
  // outside the *.test.mjs convention. It runs as one extra suite unless
  // --no-baseline is passed, so `run-all.mjs` remains the single C gate.
  const baseline = path.join(TESTS_DIR, 'run.js');
  if (opts.baseline && fs.existsSync(baseline) && (!opts.filter
    || path.relative(ROOT, baseline).indexOf(opts.filter) !== -1
    || 'baseline'.indexOf(opts.filter) !== -1)) {
    files.unshift(baseline);
  }

  // 双客户端 → 同一局 → 结算一致的浏览器 e2e。质量门禁要求它进 run-all，
  // 让联机证据随每次测试一起复跑；--no-baseline 时跳过。
  const e2e = path.join(TESTS_DIR, '..', 'play', 'e2e.mjs');
  if (opts.baseline && fs.existsSync(e2e) && (!opts.filter
    || path.relative(ROOT, e2e).indexOf(opts.filter) !== -1
    || 'e2e'.indexOf(opts.filter) !== -1)) {
    files.push(e2e);
  }

  if (files.length === 0) {
    console.error('no *.test.mjs files matched' + (opts.filter ? ' filter ' + opts.filter : ''));
    console.log('');
    console.log('RESULT: 0 passed, 0 failed, 0 skipped');
    process.exit(1);
  }

  const rows = [];
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  const skipLines = [];

  for (const file of files) {
    const label = path.relative(ROOT, file);
    const relPath = label.split(path.sep).join('/');
    const timeout = timeoutFor(relPath, opts);
    const started = Date.now();
    const child = spawnSync(process.execPath, [file], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: timeout,
      env: Object.assign({}, process.env, { BOARDGAME_TEST: '1' })
    });
    const duration = Date.now() - started;
    const stdout = child.stdout || '';
    const stderr = child.stderr || '';
    const result = lastResult(stdout);

    let status;
    if (child.error && child.error.code === 'ETIMEDOUT') {
      status = 'TIMEOUT';
    } else if (child.status !== 0) {
      status = 'CRASH';
    } else if (!result) {
      status = 'NO-RESULT';
    } else if (result.failed > 0) {
      status = 'FAIL';
    } else if (result.skipped > 0) {
      status = 'SKIP';
    } else {
      status = 'PASS';
    }

    if (result) {
      totalPassed += result.passed;
      totalFailed += result.failed;
      totalSkipped += result.skipped;
    } else {
      totalFailed += 1;
    }

    for (const line of stdout.split('\n')) {
      if (/^SKIP:/.test(line)) skipLines.push(label + ': ' + line);
    }

    rows.push({
      label: label,
      status: status,
      passed: result ? result.passed : 0,
      failed: result ? result.failed : 0,
      skipped: result ? result.skipped : 0,
      duration: duration,
      stdout: stdout,
      stderr: stderr,
      timedOut: Boolean(child.error && child.error.code === 'ETIMEDOUT')
    });
  }

  const width = rows.reduce(function (max, row) { return Math.max(max, row.label.length); }, 0);
  console.log('boardgame test run' + (opts.strict ? ' (strict)' : ''));
  console.log('');
  for (const row of rows) {
    const detail = row.passed + ' passed, ' + row.failed + ' failed, ' + row.skipped + ' skipped';
    console.log(row.status.padEnd(9) + ' ' + row.label.padEnd(width) + '  ' + detail + '  ' + row.duration + 'ms');
  }

  const bad = rows.filter(function (row) { return row.status === 'FAIL' || row.status === 'CRASH' || row.status === 'NO-RESULT' || row.status === 'TIMEOUT'; });
  if (bad.length > 0) {
    console.log('');
    console.log('--- failing tests ---');
    for (const row of bad) {
      console.log('');
      console.log('### ' + row.label + ' [' + row.status + ']');
      if (row.stdout) console.log(indentedLines(row.stdout, '  '));
      if (row.stderr) console.log(indentedLines(row.stderr, '  '));
    }
  }

  if (skipLines.length > 0) {
    console.log('');
    console.log('--- skipped contracts (missing future modules) ---');
    skipLines.forEach(function (line) { console.log('  ' + line); });
    console.log('  Re-run with --strict to turn these into failures.');
  }

  console.log('');
  console.log('RESULT: ' + totalPassed + ' passed, ' + totalFailed + ' failed, ' + totalSkipped + ' skipped');

  if (opts.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      runner: 'games/boardgame/tests/run-all.mjs',
      summary: {
        files: rows.length,
        passed: totalPassed,
        failed: totalFailed,
        skipped: totalSkipped,
        ok: bad.length === 0 && totalFailed === 0,
      },
      rows: rows.map(function (row) {
        return {
          label: row.label,
          status: row.status,
          passed: row.passed,
          failed: row.failed,
          skipped: row.skipped,
          durationMs: row.duration,
        };
      }),
    };
    fs.writeFileSync(path.join(TESTS_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }

  const skipExit = opts.strict && totalSkipped > 0;
  if (totalFailed > 0 || bad.length > 0 || skipExit) {
    if (skipExit) console.error('strict mode: ' + totalSkipped + ' skipped contract(s) treated as failures');
    process.exit(1);
  }
  process.exit(0);
}

main();
