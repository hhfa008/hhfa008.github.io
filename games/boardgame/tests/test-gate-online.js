'use strict';

/*
 * Gate online contract: test-online.js must be recognized alongside
 * online-e2e.test.js, and only a passing standardized result counts.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var t = require('../../tests/lib.js');
var gateOnline = require('../scripts/gate-online.js');

var s = t.suite('boardgame-gate-online');

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-online-test-'));

function fixture(name, testBody, extra) {
  var dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'engine.js'), 'var room = new WebSocket("wss://example");');
  fs.writeFileSync(path.join(dir, 'index.html'), '<button>invite</button>');
  if (testBody != null) fs.writeFileSync(path.join(dir, 'test-online.js'), testBody);
  if (extra) {
    Object.keys(extra).forEach(function (file) {
      fs.writeFileSync(path.join(dir, file), extra[file]);
    });
  }
  return dir;
}

var goodBody = [
  'console.log("ONLINE_E2E_JSON: " + JSON.stringify({',
  '  clients: 2, sameGame: true, settlementConsistent: true,',
  '  reconnect: true, timeoutTakeover: true, leaderboard: true, runAll: true',
  '}));'
].join('\n');

var good = fixture('good', goodBody);
var badExit = fixture('bad-exit', 'console.error("boom"); process.exit(1);');
var badJson = fixture('bad-json', 'console.log("ONLINE_E2E_JSON: {\\"clients\\":1}");');
var marker = fixture('marker', 'console.log("ONLINE_E2E_OK");');
var e2eJson = fixture('e2e-json', null, {
  'test-online.js': 'process.exit(0);',
  'online-e2e.json': JSON.stringify({
    clients: 2, sameGame: true, settlementConsistent: true, reconnect: true,
    timeoutTakeover: true, leaderboard: true, runAll: true
  })
});
var legacy = fixture('legacy', [
  '/* two independent clients share a roomId; settlement, reconnect,',
  '   AI takeover and leaderboard are asserted. */',
  'console.log("RESULT: 5 passed, 0 failed");'
].join('\n'));
var legacyFail = fixture('legacy-fail', [
  '/* two independent clients share a roomId; settlement, reconnect,',
  '   AI takeover and leaderboard are asserted. */',
  'console.log("RESULT: 5 passed, 1 failed");'
].join('\n'));

s.group('test-online.js recognition', function () {
  var result = gateOnline.onlineEvidence({ dir: good, slug: 'fixture-good' });
  s.ok('test-online.js 通过并被识别', result.ok, JSON.stringify(result.detail));
  s.eq('testFile 名称', result.detail.testFile, 'test-online.js');
  s.eq('标准化字段 clients', result.detail.standardized && result.detail.standardized.clients, 2);
  s.ok('同局结算一致', result.detail.standardized && result.detail.standardized.settlementConsistent === true);
});

s.group('legacy RESULT format', function () {
  var result = gateOnline.onlineEvidence({ dir: legacy, slug: 'fixture-legacy' });
  s.ok('RESULT: N passed, 0 failed + 契约关键词可通过', result.ok, JSON.stringify(result.detail));
  s.eq('RESULT 行被记录', result.detail.testResultLine, 'RESULT: 5 passed, 0 failed');
  s.ok('源码契约标记 >=4', result.detail.sourceContract === true);
  var failedRun = gateOnline.onlineEvidence({ dir: legacyFail, slug: 'fixture-legacy-fail' });
  s.ok('RESULT 含 failed 不算通过', !failedRun.ok, JSON.stringify(failedRun.detail));
});

s.group('negative controls', function () {
  var exit = gateOnline.onlineEvidence({ dir: badExit, slug: 'fixture-bad-exit' });
  s.ok('test-online.js 退出 1 不算通过', !exit.ok, JSON.stringify(exit.detail));
  var incomplete = gateOnline.onlineEvidence({ dir: badJson, slug: 'fixture-bad-json' });
  s.ok('缺少结算字段不算通过', !incomplete.ok, JSON.stringify(incomplete.detail));
  var markerResult = gateOnline.onlineEvidence({ dir: marker, slug: 'fixture-marker' });
  s.ok('ONLINE_E2E_OK 标记可作为标准化输出', markerResult.ok, JSON.stringify(markerResult.detail));
});

s.group('online-e2e.json + online-e2e.test.js', function () {
  var result = gateOnline.onlineEvidence({ dir: e2eJson, slug: 'fixture-e2e-json' });
  s.ok('JSON 契约证据被识别', result.ok, JSON.stringify(result.detail));
  s.ok('JSON 契约字段完整', result.detail.contractInJson === true);
});

s.group('deliberate failing control', function () {
  var control = gateOnline.control();
  s.ok('控制通过（失败退出/不完整载荷被拒绝）', control.ok, JSON.stringify(control.detail));
  s.ok('控制覆盖 test-online.js 正例', control.detail.positive_test_online_js === true);
  s.ok('控制覆盖 exit 1 负例', control.detail.negative_exit_1 === true);
  s.ok('控制覆盖不完整载荷负例', control.detail.negative_incomplete_payload === true);
});

fs.rmSync(tmp, { recursive: true, force: true });
s.done();
