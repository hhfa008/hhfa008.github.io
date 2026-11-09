#!/usr/bin/env node
'use strict';

/*
 * One-command test runner for every game under games/.
 *
 *   node games/tests/run-all.js          # human-readable table
 *   node games/tests/run-all.js --json   # also write games/tests/report.json
 *
 * Each test file runs in its own child process, so a crash, an infinite loop
 * (bounded by --timeout) or a non-zero exit only affects that one row.
 * Exit code: 0 when every test passes, 1 when anything fails or no tests exist.
 */

var fs = require('fs');
var path = require('path');
var child = require('child_process');

var GAMES_DIR = path.resolve(__dirname, '..');
var REPORT_PATH = path.join(__dirname, 'report.json');
var TIMEOUT_MS = 120000;
var SKIP_DIRS = { assets: 1, shared: 1, tests: 1 };
var NON_GAME_DIRS = { en: 1, id: 1 };

function walkTestFiles(dir, out) {
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
  entries.forEach(function (ent) {
    var full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') return;
      walkTestFiles(full, out);
    } else if (ent.isFile() && /^test.*\.js$/.test(ent.name)) {
      out.push(full);
    }
  });
  return out;
}

function gameDirs() {
  return fs.readdirSync(GAMES_DIR, { withFileTypes: true })
    .filter(function (d) { return d.isDirectory() && !SKIP_DIRS[d.name]; })
    .map(function (d) { return d.name; })
    .filter(function (name) { return !NON_GAME_DIRS[name]; })
    .filter(function (name) {
      return fs.existsSync(path.join(GAMES_DIR, name, 'index.html'));
    })
    .sort();
}

function parseCounts(stdout) {
  var m = stdout.match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (m) return { passed: +m[1], failed: +m[2] };
  m = stdout.match(/(\d+)\s+passed(?:\s*[,，]\s*(\d+)\s+failed)?/i);
  if (m) return { passed: +m[1], failed: m[2] == null ? null : +m[2] };
  m = stdout.match(/总计[:：]\s*(\d+)\s*通过(?:[,，\s]*(\d+)\s*失败)?/);
  if (m) return { passed: +m[1], failed: m[2] == null ? null : +m[2] };
  return null;
}

function displayWidth(s) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c >= 0x1100 && (
      c <= 0x115f || c === 0x2329 || c === 0x232a ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd)
    )) w += 2;
    else w += 1;
  }
  return w;
}

function pad(s, width) {
  var n = width - displayWidth(s);
  return s + (n > 0 ? new Array(n + 1).join(' ') : '');
}

function runOne(file) {
  var start = Date.now();
  var res = child.spawnSync(process.execPath, [file], {
    cwd: GAMES_DIR,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });
  var ms = Date.now() - start;
  var stdout = res.stdout || '';
  var stderr = res.stderr || '';
  var timedOut = res.error && res.error.code === 'ETIMEDOUT';
  var code = res.status;
  var status = (code === 0 && !timedOut) ? 'PASS' : 'FAIL';
  var counts = parseCounts(stdout);
  var note;
  if (counts) {
    note = counts.passed + ' passed' + (counts.failed ? ', ' + counts.failed + ' failed' : '');
  } else if (/perft ok/i.test(stdout)) {
    note = 'perft ok';
  } else if (status === 'PASS') {
    note = 'ok';
  } else if (timedOut) {
    note = 'timeout';
  } else {
    note = 'exit ' + (code == null ? '?' : code);
  }
  return {
    file: file,
    rel: path.relative(GAMES_DIR, file).split(path.sep).join('/'),
    game: path.relative(GAMES_DIR, file).split(path.sep)[0],
    status: status,
    durationMs: ms,
    exitCode: code,
    timedOut: !!timedOut,
    assertions: counts ? { passed: counts.passed, failed: counts.failed } : null,
    note: note,
    stdout: stdout,
    stderr: stderr
  };
}

function main() {
  var wantJson = process.argv.indexOf('--json') !== -1;
  var games = gameDirs();
  var files = [];
  games.forEach(function (g) { walkTestFiles(path.join(GAMES_DIR, g), files); });
  files.sort();

  var rows = files.map(runOne);
  var testsByGame = {};
  rows.forEach(function (r) { testsByGame[r.game] = (testsByGame[r.game] || 0) + 1; });

  var labelW = displayWidth('游戏');
  rows.forEach(function (r) {
    var label = testsByGame[r.game] > 1 ? r.game + '/' + path.basename(r.file) : r.game;
    r.label = label;
    labelW = Math.max(labelW, displayWidth(label));
  });
  var noteW = Math.max(displayWidth('断言/结果'),
    rows.reduce(function (m, r) { return Math.max(m, displayWidth(r.note)); }, 0));
  var timeW = Math.max(displayWidth('耗时'),
    rows.reduce(function (m, r) { return Math.max(m, displayWidth((r.durationMs / 1000).toFixed(2) + 's')); }, 0));

  var totalPassed = 0, totalFailed = 0, assertionSum = 0;
  rows.forEach(function (r) {
    if (r.assertions) {
      totalPassed += r.assertions.passed;
      totalFailed += r.assertions.failed || 0;
      assertionSum += r.assertions.passed;
    }
  });

  console.log('');
  console.log(pad('游戏', labelW + 2) + pad('断言/结果', noteW + 2) +
    pad('耗时', timeW + 2) + '状态');
  console.log(pad(''.padEnd(0), 0) + new Array(labelW + noteW + timeW + 8).join('-'));
  rows.forEach(function (r) {
    var time = (r.durationMs / 1000).toFixed(2) + 's';
    console.log(pad(r.label, labelW + 2) + pad(r.note, noteW + 2) + pad(time, timeW + 2) + r.status);
  });

  var testedGames = Object.keys(testsByGame).length;
  var untested = games.filter(function (g) { return !testsByGame[g]; });
  console.log('');
  console.log('测试文件: ' + rows.length + ' 个 · 覆盖游戏: ' + testedGames + '/' + games.length +
    ' · 断言: ' + assertionSum + ' passed' + (totalFailed ? ', ' + totalFailed + ' failed' : '') +
    ' · 失败文件: ' + rows.filter(function (r) { return r.status !== 'PASS'; }).length);
  if (untested.length) console.log('尚无自动化测试: ' + untested.join(', '));

  var failures = rows.filter(function (r) { return r.status !== 'PASS'; });
  if (failures.length) {
    console.log('');
    failures.forEach(function (r) {
      console.log('--- ' + r.rel + ' (' + r.note + ') ---');
      var tail = (r.stdout + '\n' + r.stderr).trim().split('\n').slice(-12).join('\n');
      console.log(tail || '(no output)');
    });
  }

  if (wantJson) {
    var report = {
      generatedAt: new Date().toISOString(),
      runner: 'games/tests/run-all.js',
      summary: {
        files: rows.length,
        games: games.length,
        testedGames: testedGames,
        untestedGames: untested,
        assertionsPassed: assertionSum,
        assertionsFailed: totalFailed,
        failedFiles: failures.length,
        ok: failures.length === 0
      },
      tests: rows.map(function (r) {
        return {
          game: r.game,
          file: r.rel,
          status: r.status,
          durationMs: r.durationMs,
          exitCode: r.exitCode,
          timedOut: r.timedOut,
          assertions: r.assertions,
          note: r.note
        };
      })
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
    console.log('\nJSON 报告已写入 ' + path.relative(process.cwd(), REPORT_PATH));
  }

  if (!rows.length) {
    console.log('\n没有找到任何 test*.js，视为失败。');
    process.exitCode = 1;
    return;
  }
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseCounts: parseCounts, gameDirs: gameDirs, walkTestFiles: walkTestFiles };
