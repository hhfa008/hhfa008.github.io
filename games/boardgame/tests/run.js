#!/usr/bin/env node
'use strict';

/*
 * 桌游模块统一测试门禁（C 角色维护）。
 *
 *   node games/boardgame/tests/run.js
 *
 * 依次执行：
 *   1. tests/test-data.js        —— 数据契约、fixture 重放、筛选纯函数
 *   2. tests/test-build.js       —— 构建冒烟（页面结构、字节稳定性）
 *   3. tests/card-battle.test.js —— 卡牌对战引擎/页面/数据与 AI 自对弈
 *   4. 构建冒烟兜底               —— node build.mjs 到临时目录，核对列表页与详情页数量
 *
 * 每个子套件在独立子进程中运行，cwd 固定为 games/boardgame。任一套件
 * 退出码非 0、缺少 RESULT 行或断言失败，整体退出码为 1，并打印失败文件
 * 与输出尾部；全绿退出码为 0。
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var ROOT = __dirname;
var BOARD_ROOT = path.resolve(ROOT, '..');
var TIMEOUT_MS = 180000;
var SUITES = [
  { name: 'data', file: path.join(ROOT, 'test-data.js') },
  { name: 'build', file: path.join(ROOT, 'test-build.js') },
  { name: 'card-battle', file: path.join(ROOT, 'card-battle.test.js') }
];

function tail(text, lines) {
  var rows = String(text || '').trim().split('\n');
  return rows.slice(-(lines || 12)).join('\n');
}

function parseResult(stdout) {
  var m = String(stdout || '').match(/RESULT:\s*(\d+)\s+passed,\s*(\d+)\s+failed/i);
  if (!m) return null;
  return { passed: +m[1], failed: +m[2] };
}

function runSuite(suite) {
  var started = Date.now();
  var res = cp.spawnSync(process.execPath, [suite.file], {
    cwd: BOARD_ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' })
  });
  var stdout = res.stdout || '';
  var stderr = res.stderr || '';
  var counts = parseResult(stdout);
  var timedOut = !!(res.error && res.error.code === 'ETIMEDOUT');
  var failures = [];

  if (timedOut) failures.push('超时（>' + (TIMEOUT_MS / 1000) + 's）');
  if (res.status !== 0) failures.push('退出码 ' + (res.status == null ? '?' : res.status));
  if (!counts) failures.push('缺少 RESULT 行');
  if (counts && counts.failed > 0) failures.push(counts.failed + ' 项断言失败');

  return {
    name: suite.name,
    file: suite.file,
    rel: path.relative(BOARD_ROOT, suite.file).split(path.sep).join('/'),
    ok: failures.length === 0,
    counts: counts,
    failures: failures,
    stdout: stdout,
    stderr: stderr,
    durationMs: Date.now() - started
  };
}

function smokeBuild() {
  var started = Date.now();
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-gate-'));
  var out = path.join(tmp, 'out');
  var failures = [];
  var passed = 0;
  var buildOutput = '';
  var buildError = '';

  function ok(label, cond, detail) {
    if (cond) {
      passed++;
    } else {
      failures.push(label + (detail ? ' — ' + detail : ''));
    }
  }

  try {
    var games = JSON.parse(fs.readFileSync(path.join(BOARD_ROOT, 'data', 'boardgames.json'), 'utf8'));
    var res = cp.spawnSync(process.execPath, [path.join(BOARD_ROOT, 'build.mjs'), '--out', out], {
      cwd: BOARD_ROOT,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
      env: Object.assign({}, process.env, { NO_COLOR: '1' })
    });
    buildOutput = res.stdout || '';
    buildError = res.stderr || '';
    ok('build.mjs 退出码 0', res.status === 0, (buildError || buildOutput).trim());

    var indexFile = path.join(out, 'index.html');
    ok('列表页存在', fs.existsSync(indexFile));

    var indexHtml = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : '';
    var cards = (indexHtml.match(/class="card"/g) || []).length;
    ok('列表页卡片数 = 数据条数', cards === games.length, 'got ' + cards + ', want ' + games.length);

    var boardDir = path.join(out, 'board');
    var detailFiles = fs.existsSync(boardDir)
      ? fs.readdirSync(boardDir).filter(function (f) { return /\.html$/.test(f); })
      : [];
    ok('详情页数 = 数据条数', detailFiles.length === games.length,
      'got ' + detailFiles.length + ', want ' + games.length);

    var missing = games.filter(function (g) {
      return detailFiles.indexOf(g.slug + '.html') === -1;
    }).map(function (g) { return g.slug; });
    ok('每款游戏都有详情页', missing.length === 0, '缺少 ' + missing.slice(0, 5).join(', '));
  } catch (err) {
    failures.push('构建冒烟异常 — ' + (err && err.message ? err.message : String(err)));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  return {
    name: 'smoke',
    rel: 'build.mjs（临时目录构建）',
    ok: failures.length === 0,
    counts: { passed: passed, failed: failures.length },
    failures: failures,
    stdout: buildOutput,
    stderr: buildError,
    durationMs: Date.now() - started
  };
}

(function () {
  console.log('桌游统一门禁 · ' + BOARD_ROOT);

  var results = SUITES.map(runSuite);
  results.push(smokeBuild());

  var totalPassed = 0;
  var totalFailed = 0;
  results.forEach(function (r) {
    totalPassed += r.counts ? r.counts.passed : 0;
    totalFailed += r.counts ? r.counts.failed : (r.ok ? 0 : 1);
    console.log('[' + (r.ok ? 'PASS' : 'FAIL') + '] ' + r.name + ': ' +
      (r.counts ? r.counts.passed + ' passed, ' + r.counts.failed + ' failed' : r.failures.join('; ')) +
      ' · ' + (r.durationMs / 1000).toFixed(2) + 's');
  });

  var failed = results.filter(function (r) { return !r.ok; });
  if (failed.length) {
    console.log('');
    failed.forEach(function (r) {
      console.log('--- ' + r.rel + ' ---');
      if (r.failures.length) console.log('失败: ' + r.failures.join('; '));
      console.log(tail(r.stdout + '\n' + r.stderr) || '(no output)');
    });
  }

  console.log('');
  console.log('RESULT: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  process.exitCode = failed.length ? 1 : 0;
})();
