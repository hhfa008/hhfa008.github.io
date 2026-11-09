#!/usr/bin/env node
'use strict';

/*
 * One-command test runner for every game under games/ and every tool under
 * tools/.
 *
 *   node games/tests/run-all.js          # human-readable table
 *   node games/tests/run-all.js --json   # also write games/tests/report.json
 *
 * Each test file runs in its own child process, so a crash, an infinite loop
 * (bounded by --timeout) or a non-zero exit only affects that one row.
 * Game tests and tool tests are counted separately; there is one exit code:
 * 0 when every test passes, 1 when anything fails or no tests exist.
 */

var fs = require('fs');
var path = require('path');
var child = require('child_process');

var ROOT = path.resolve(__dirname, '..', '..');
var GAMES_DIR = path.resolve(__dirname, '..');
var TOOLS_DIR = path.join(ROOT, 'tools');
var REPORT_PATH = path.join(__dirname, 'report.json');
var TIMEOUT_MS = 120000;
var SKIP_DIRS = { assets: 1, shared: 1, tests: 1 };
var NON_GAME_DIRS = { en: 1, id: 1 };

// Shared engines live outside the per-game dirs (games/shared/ is skipped by
// the walk), so their tests are listed explicitly here. Boardgame's
// card-battle test uses the *.test.js suffix and is likewise listed explicitly.
var EXTRA_TESTS = [
  path.join(GAMES_DIR, 'shared', 'hand-eval.test.js'),
  path.join(GAMES_DIR, 'shared', 'physics.test.js'),
  path.join(GAMES_DIR, 'boardgame', 'tests', 'card-battle.test.js')
];

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

// tools/tests/*.test.js — top level only, one file per tool slug.
function toolTestFiles() {
  var dir = path.join(TOOLS_DIR, 'tests');
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return []; }
  return entries
    .filter(function (ent) { return ent.isFile() && /\.test\.js$/.test(ent.name); })
    .map(function (ent) { return path.join(dir, ent.name); })
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

function runOne(file, kind) {
  var start = Date.now();
  var isTool = kind === 'tool';
  var res = child.spawnSync(process.execPath, [file], {
    cwd: isTool ? ROOT : GAMES_DIR,
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
  var rel = isTool ? path.relative(ROOT, file) : path.relative(GAMES_DIR, file);
  rel = rel.split(path.sep).join('/');
  return {
    kind: kind,
    file: file,
    rel: rel,
    game: isTool ? null : rel.split('/')[0],
    slug: isTool ? path.basename(file).replace(/\.test\.js$/, '') : null,
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
  var work = [];
  games.forEach(function (g) {
    var files = [];
    walkTestFiles(path.join(GAMES_DIR, g), files);
    files.sort().forEach(function (f) { work.push({ file: f, kind: 'game' }); });
  });
  EXTRA_TESTS.forEach(function (f) {
    if (fs.existsSync(f) && !work.some(function (w) { return w.file === f; })) {
      work.push({ file: f, kind: 'game' });
    }
  });
  toolTestFiles().forEach(function (f) { work.push({ file: f, kind: 'tool' }); });

  var rows = work.map(function (w) { return runOne(w.file, w.kind); });
  var gameRows = rows.filter(function (r) { return r.kind === 'game'; });
  var toolRows = rows.filter(function (r) { return r.kind === 'tool'; });

  var testsByGame = {};
  gameRows.forEach(function (r) { testsByGame[r.game] = (testsByGame[r.game] || 0) + 1; });

  var labelW = displayWidth('测试');
  rows.forEach(function (r) {
    var label;
    if (r.kind === 'tool') {
      label = 'tools/' + r.slug;
    } else {
      label = testsByGame[r.game] > 1 ? r.game + '/' + path.basename(r.file) : r.game;
    }
    r.label = label;
    labelW = Math.max(labelW, displayWidth(label));
  });
  var noteW = Math.max(displayWidth('断言/结果'),
    rows.reduce(function (m, r) { return Math.max(m, displayWidth(r.note)); }, 0));
  var timeW = Math.max(displayWidth('耗时'),
    rows.reduce(function (m, r) { return Math.max(m, displayWidth((r.durationMs / 1000).toFixed(2) + 's')); }, 0));

  function sum(rs) {
    var passed = 0, failed = 0;
    rs.forEach(function (r) {
      if (r.assertions) {
        passed += r.assertions.passed;
        failed += r.assertions.failed || 0;
      }
    });
    return { passed: passed, failed: failed };
  }
  var gameSum = sum(gameRows);
  var toolSum = sum(toolRows);
  var totalPassed = gameSum.passed + toolSum.passed;
  var totalFailed = gameSum.failed + toolSum.failed;

  console.log('');
  console.log(pad('测试', labelW + 2) + pad('断言/结果', noteW + 2) +
    pad('耗时', timeW + 2) + '状态');
  console.log(pad(''.padEnd(0), 0) + new Array(labelW + noteW + timeW + 8).join('-'));
  rows.forEach(function (r) {
    var time = (r.durationMs / 1000).toFixed(2) + 's';
    console.log(pad(r.label, labelW + 2) + pad(r.note, noteW + 2) + pad(time, timeW + 2) + r.status);
  });

  var testedGames = Object.keys(testsByGame).filter(function (g) {
    return games.indexOf(g) >= 0;
  }).length;
  var untested = games.filter(function (g) { return !testsByGame[g]; });
  var failures = rows.filter(function (r) { return r.status !== 'PASS'; });
  console.log('');
  console.log('游戏测试: ' + gameRows.length + ' 个 · 覆盖游戏: ' + testedGames + '/' + games.length +
    ' · 断言: ' + gameSum.passed + ' passed' + (gameSum.failed ? ', ' + gameSum.failed + ' failed' : '') +
    ' · 失败文件: ' + gameRows.filter(function (r) { return r.status !== 'PASS'; }).length);
  console.log('工具测试: ' + toolRows.length + ' 个' +
    ' · 断言: ' + toolSum.passed + ' passed' + (toolSum.failed ? ', ' + toolSum.failed + ' failed' : '') +
    ' · 失败文件: ' + toolRows.filter(function (r) { return r.status !== 'PASS'; }).length);
  console.log('合计: ' + rows.length + ' 个测试文件 · 断言: ' + totalPassed + ' passed' +
    (totalFailed ? ', ' + totalFailed + ' failed' : '') + ' · 失败文件: ' + failures.length);
  if (untested.length) console.log('尚无自动化测试: ' + untested.join(', '));

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
        assertionsPassed: totalPassed,
        assertionsFailed: totalFailed,
        failedFiles: failures.length,
        ok: rows.length > 0 && failures.length === 0,
        toolFiles: toolRows.length,
        gameTests: {
          files: gameRows.length,
          assertionsPassed: gameSum.passed,
          assertionsFailed: gameSum.failed,
          failedFiles: gameRows.filter(function (r) { return r.status !== 'PASS'; }).length
        },
        tools: {
          files: toolRows.length,
          assertionsPassed: toolSum.passed,
          assertionsFailed: toolSum.failed,
          failedFiles: toolRows.filter(function (r) { return r.status !== 'PASS'; }).length
        },
        total: {
          files: rows.length,
          assertionsPassed: totalPassed,
          assertionsFailed: totalFailed,
          failedFiles: failures.length,
          ok: rows.length > 0 && failures.length === 0
        }
      },
      tests: rows.map(function (r) {
        return {
          type: r.kind,
          game: r.game,
          slug: r.slug,
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
    console.log('\n没有找到任何游戏或工具测试文件，视为失败。');
    process.exitCode = 1;
    return;
  }
  if (failures.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  parseCounts: parseCounts,
  gameDirs: gameDirs,
  walkTestFiles: walkTestFiles,
  toolTestFiles: toolTestFiles
};
