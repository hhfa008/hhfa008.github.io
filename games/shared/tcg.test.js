#!/usr/bin/env node
'use strict';

/*
 * Self-checks for games/shared/tcg.js replay headers and hidden-information
 * views.
 *
 *   1. Header: snapshot and record carry engineVersion / rng / ruleset.
 *   2. Replay rejection: old bare logs, missing headers, and mismatched
 *      engine/PRNG/ruleset/seed all fail with stable codes.
 *   3. Hidden information: viewFor hides the opponent hand and deck order,
 *      shows the own hand, keeps public zones and the result, and does not
 *      mutate the authoritative state.
 *   4. Replay: the same record replays to a bit-identical state, repeatedly.
 */

var TCG = require('./tcg.js');
var lib = require('../tests/lib');

var s = lib.suite('tcg');

var CARDS = {
  strike: {
    id: 'strike', type: 'spell', cost: 1,
    effects: [{ trigger: 'onPlay', ops: [{ op: 'damage', amount: 3, target: { kind: 'core', side: 'enemy' } }] }]
  },
  guard: { id: 'guard', type: 'unit', cost: 2, atk: 2, hp: 4 },
  healer: {
    id: 'healer', type: 'unit', cost: 2, atk: 1, hp: 3,
    effects: [{ trigger: 'onPlay', ops: [{ op: 'heal', amount: 2, target: { kind: 'core', side: 'self' } }] }]
  },
  wall: { id: 'wall', type: 'unit', cost: 3, atk: 0, hp: 7 }
};

function deck() {
  return [
    'guard', 'strike', 'healer', 'guard', 'strike',
    'guard', 'wall', 'healer', 'strike', 'guard',
    'strike', 'healer', 'wall', 'guard', 'strike'
  ];
}

function create(seed) {
  return TCG.createMatch({
    players: [{ deck: deck() }, { deck: deck() }],
    cardPool: CARDS,
    seed: seed,
    rules: { startingCore: 8, startingHand: 3, firstTurnDraw: 1, maxTurns: 20 }
  });
}

function play(seed, limit) {
  var match = create(seed);
  var rng = lib.mulberry32(seed);
  var actions = [];
  while (match.state.phase !== 'over' && actions.length < (limit || 2000)) {
    var legal = match.legalActions();
    if (!legal.length) break;
    var action = legal[Math.floor(rng() * legal.length)];
    match.apply(action);
    actions.push(action);
  }
  return { match: match, actions: actions };
}

function expectCode(label, fn, code) {
  try {
    fn();
    s.ok(label, false, '没有被拒绝');
  } catch (e) {
    s.ok(label + ' → ' + code, e && e.code === code && e instanceof TCG.Error,
      '实际: ' + (e && e.code) + ' / ' + (e && e.message));
  }
}

/* ------------------------------------------------------------------ *
 * 1. Replay header                                                    *
 * ------------------------------------------------------------------ */

s.group('1. 回放头：snapshot 与 record 携带 engineVersion / rng / ruleset', function () {
  var match = create(42);
  var state = match.state;
  var record = match.record();

  s.eq('导出 engineVersion 常量', TCG.engineVersion, 'tcg/v2');
  s.eq('match.snapshot() 与 match.state 一致', match.snapshot(), match.state);
  s.eq('state.engineVersion', state.engineVersion, TCG.engineVersion);
  s.eq('state.rngInfo.name', state.rngInfo.name, 'sfc32/fnv1a/v1');
  s.eq('state.rngInfo.algorithm', state.rngInfo.algorithm, 'sfc32');
  s.eq('state.rngInfo.seedHash', state.rngInfo.seedHash, 'fnv1a');
  s.eq('state.rngInfo.seed', state.rngInfo.seed, '42');
  s.ok('state.rngInfo 带初始状态摘要',
    /^fnv1a:[0-9a-f]{8}$/.test(state.rngInfo.initialStateDigest),
    String(state.rngInfo.initialStateDigest));
  s.eq('state.ruleset.version', state.ruleset.version, 'tcg-rules/v1');
  s.ok('state.ruleset 带规则摘要',
    /^fnv1a:[0-9a-f]{8}$/.test(state.ruleset.hash), String(state.ruleset.hash));

  s.eq('record.engineVersion', record.engineVersion, TCG.engineVersion);
  var header = match.header();
  s.eq('match.header() 可独立解析版本', header.engineVersion, TCG.engineVersion);
  s.eq('match.header() 不含动作流', [header.actions, header.setup], [undefined, undefined]);
  s.eq('record.rng 算法名', record.rng.name, 'sfc32/fnv1a/v1');
  s.eq('record.rng 种子', record.rng.seed, '42');
  s.eq('record.seed', record.seed, 42);
  s.eq('record.ruleset.version', record.ruleset.version, 'tcg-rules/v1');
  s.ok('record.actions 是数组', Array.isArray(record.actions));
  s.ok('record.setup 可独立重放', record.setup && Array.isArray(record.setup.players));
  s.ok('record.result 含对局摘要', record.result && typeof record.result.phase === 'string');
  s.ok('record 是 JSON 安全的', JSON.stringify(JSON.parse(JSON.stringify(record))) === JSON.stringify(record));
  return 'header = ' + record.engineVersion + ' / ' + record.rng.name;
});

/* ------------------------------------------------------------------ *
 * 2. Replay rejection                                                 *
 * ------------------------------------------------------------------ */

s.group('2. 回放拒绝：旧格式、缺头、引擎/PRNG/规则/种子不匹配', function () {
  var run = play(7);
  var match = run.match;
  var base = match.record();

  function cloneRecord() { return JSON.parse(JSON.stringify(base)); }

  expectCode('裸动作数组（旧格式）', function () {
    match.replay(match.log);
  }, 'replay_legacy_format');

  expectCode('未提供记录', function () {
    match.replay();
  }, 'replay_legacy_format');

  expectCode('只有 actions、没有头部', function () {
    match.replay({ actions: match.log });
  }, 'replay_legacy_format');

  expectCode('旧版 1.0.0 记录无 engineVersion', function () {
    match.replay({ version: '1.0.0', seed: 7, actions: match.log });
  }, 'replay_legacy_format');

  expectCode('null 记录', function () {
    match.replay(null);
  }, 'replay_invalid_record');

  var wrongVersion = cloneRecord();
  wrongVersion.engineVersion = 'tcg/v1';
  expectCode('engineVersion 不匹配', function () {
    match.replay(wrongVersion);
  }, 'replay_version_mismatch');

  var wrongRng = cloneRecord();
  wrongRng.rng.name = 'sfc32/fnv1a/v0';
  expectCode('PRNG 算法版本不匹配', function () {
    match.replay(wrongRng);
  }, 'replay_rng_mismatch');

  var wrongDigest = cloneRecord();
  wrongDigest.rng.initialStateDigest = 'fnv1a:deadbeef';
  expectCode('PRNG 初始状态摘要不匹配', function () {
    match.replay(wrongDigest);
  }, 'replay_rng_mismatch');

  var wrongSeed = cloneRecord();
  wrongSeed.seed = 999;
  expectCode('种子与 setup 不一致', function () {
    match.replay(wrongSeed);
  }, 'replay_seed_mismatch');

  var wrongRules = cloneRecord();
  wrongRules.ruleset.hash = 'fnv1a:deadbeef';
  expectCode('规则集摘要不匹配', function () {
    match.replay(wrongRules);
  }, 'replay_ruleset_mismatch');

  var badActions = cloneRecord();
  badActions.actions = {};
  expectCode('actions 不是数组', function () {
    match.replay(badActions);
  }, 'replay_invalid_record');

  // A legacy error must be readable, not a silent empty replay.
  var legacyMessage = '';
  try { match.replay(match.log); } catch (e) { legacyMessage = e.message; }
  s.ok('旧格式错误信息可读', /legacy|header/i.test(legacyMessage), legacyMessage);
  return '6 类头部校验 + 旧格式均可读拒绝';
});

/* ------------------------------------------------------------------ *
 * 3. Hidden-information view                                          *
 * ------------------------------------------------------------------ */

s.group('3. 视图裁剪：对手手牌只剩数量，自己手牌可见，公共信息照常', function () {
  var run = play(11);
  var match = run.match;
  var full = match.state;
  var before = JSON.stringify(full);
  var view = TCG.viewFor(full, 0);

  s.eq('viewFor 不修改权威 state', JSON.stringify(match.state), before);
  s.eq('自己手牌张数', view.players[0].hand.length, full.players[0].hand.length);
  s.eq('自己手牌可见（内容一致）', view.players[0].hand, full.players[0].hand);
  s.eq('对手手牌张数', view.players[1].hand.length, full.players[1].hand.length);
  s.eq('对手 handCount', view.players[1].handCount, full.players[1].hand.length);
  s.eq('对手 handHidden', view.players[1].handHidden, true);
  s.eq('自己 handHidden', view.players[0].handHidden, false);

  var leaked = false;
  var hiddenShape = true;
  for (var i = 0; i < view.players[1].hand.length; i++) {
    var card = view.players[1].hand[i];
    if (card.id !== undefined || card.defId !== undefined || card.atk !== undefined) leaked = true;
    if (JSON.stringify(card) !== '{"hidden":true}') hiddenShape = false;
  }
  s.ok('对手手牌不暴露牌面/id', !leaked && hiddenShape, JSON.stringify(view.players[1].hand));

  s.eq('双方牌库只剩张数', [
    view.players[0].deck.length, view.players[1].deck.length
  ], [0, 0]);
  s.eq('牌库张数正确', [
    view.players[0].deckCount, view.players[1].deckCount
  ], [full.players[0].deck.length, full.players[1].deck.length]);
  s.eq('牌库顺序不暴露', [
    view.players[0].deckHidden, view.players[1].deckHidden
  ], [true, true]);

  s.eq('RNG 流不下发', view.rng, undefined);
  s.eq('RNG 元数据中的种子不下发', view.rngInfo, undefined);
  s.eq('种子不下发', view.seed, undefined);

  s.eq('公共区：场上单位照常', view.players[0].field, full.players[0].field);
  s.eq('公共区：弃牌堆照常', [
    view.players[0].discard, view.players[1].discard
  ], [full.players[0].discard, full.players[1].discard]);
  s.eq('公共区：牌库定义照常', view.defs, full.defs);
  s.eq('结算信息照常', [
    view.phase, view.winner, view.winReason, view.draw
  ], [full.phase, full.winner, full.winReason, full.draw]);

  s.eq('snapshotFor 与 viewFor 一致', TCG.snapshotFor(full, 1), TCG.viewFor(full, 1));
  s.eq('match.viewFor 与模块 viewFor 一致', match.viewFor(1), TCG.viewFor(full, 1));
  s.eq('match.snapshotFor 与模块 snapshotFor 一致', match.snapshotFor(0), TCG.snapshotFor(full, 0));

  var view1 = TCG.viewFor(full, 1);
  s.eq('1 号视图：0 号手牌张数', view1.players[0].handCount, full.players[0].hand.length);
  s.ok('1 号视图：0 号手牌不可见',
    view1.players[0].hand.every(function (c) { return c.hidden === true; }));
  s.eq('1 号视图：1 号手牌可见', view1.players[1].hand, full.players[1].hand);

  expectCode('非法 playerId', function () {
    TCG.viewFor(full, 2);
  }, 'invalid_player');
  return '对手手牌仅 handCount，公共区与结算保留';
});

/* ------------------------------------------------------------------ *
 * 4. Deterministic replay                                             *
 * ------------------------------------------------------------------ */

s.group('4. 重放：同一记录连续重放，终局状态逐位一致', function () {
  var run = play(23);
  var match = run.match;
  var record = match.record();
  var original = match.state;

  var first = match.replay(record);
  var second = match.replay(record);
  s.eq('record.actions 与 match.log 一致', record.actions, match.log);
  s.eq('第一次重放终局状态一致', first.state, original);
  s.eq('第二次重放终局状态一致', second.state, original);
  s.eq('连续两次重放逐位一致', second.state, first.state);

  var other = create(999);
  var standalone = other.replay(record);
  s.eq('记录可由另一实例独立重放', standalone.state, original);

  var roundTrip = JSON.parse(JSON.stringify(record));
  s.eq('JSON 往返后的记录可重放', match.replay(roundTrip).state, original);

  s.ok('默认 match.state 手牌仍是完整牌面',
    match.state.players[0].hand.every(function (c) { return c.defId !== undefined; }),
    JSON.stringify(match.state.players[0].hand));

  var tampered = JSON.parse(JSON.stringify(record));
  tampered.actions[0] = { type: 'not_an_action' };
  s.ok('篡改动作流会抛稳定错误', (function () {
    try { match.replay(tampered); return false; }
    catch (e) { return e instanceof TCG.Error; }
  })(), '未抛错');

  return 'seed ' + record.seed + '，' + record.actions.length + ' 个动作，两遍重放一致';
});

/* ------------------------------------------------------------------ *
 * 5. Legacy migration                                                 *
 * ------------------------------------------------------------------ */

s.group('5. 旧格式迁移：裸动作日志经 replayLegacy 显式重放', function () {
  var run = play(19);
  var before = JSON.stringify(run.match.state);
  var legacyLog = run.match.log;
  var migrated = run.match.replayLegacy(legacyLog);

  s.eq('replayLegacy 重放终局快照一致', migrated.state, run.match.state);
  s.eq('replayLegacy 重放终局 phase 一致', migrated.state.phase, run.match.state.phase);
  s.eq('replayLegacy 不修改原 match', JSON.stringify(run.match.state), before);
  s.eq('裸日志本身仍不带头部', Array.isArray(legacyLog), true);

  expectCode('replayLegacy 拒绝非数组日志', function () {
    run.match.replayLegacy({ actions: legacyLog });
  }, 'replay_invalid_record');

  expectCode('replayLegacy 拒绝非法 setup', function () {
    run.match.replayLegacy(legacyLog, 'not-a-setup');
  }, 'replay_invalid_record');

  // The strict entry point must keep failing loudly instead of guessing.
  expectCode('严格 replay 仍拒绝裸日志', function () {
    run.match.replay(legacyLog);
  }, 'replay_legacy_format');

  return 'legacy → v2 显式迁移，严格入口保持拒绝';
});

s.done();
