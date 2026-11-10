#!/usr/bin/env node
'use strict';

/*
 * Self-checks for the generic TCG engine and the Lamptongue sample.
 *
 *   1. Determinism: 100 seeds, each played twice, action logs and final
 *      snapshots compared byte for byte.
 *   2. Replay: the 100 action logs are replayed from scratch; final snapshots
 *      must match the original runs.
 *   3. Illegal actions: 12 classes, each must be rejected with the right code.
 *   4. Serialization: JSON round-trip must deep-equal the snapshot.
 *   5. AI self-play: 200 medium-vs-medium games, all terminate with zero
 *      illegal actions; first-player win rate must sit in 40–60%.
 *   6. Originality: banned-title grep, 12 card faces, each face <= 6 KiB,
 *      30-card decks and complete zh/en/id card text.
 */

var fs = require('fs');
var path = require('path');
var assert = require('assert');
var lib = require('../tests/lib');
var TCG = require('../shared/tcg.js');

var s = lib.suite('tcg-sample');

// The inline data/AI scripts publish on window; make that available under Node.
globalThis.window = globalThis;

var PAGE = lib.page(__dirname);
var DATA = lib.evalScript(PAGE, 'sample-data', 'window.TCGSampleData');
var AI = lib.evalScript(PAGE, 'sample-ai', 'window.TCGSampleAI');

var DECK = DATA.DECK;
var CARDS = DATA.CARDS;
var RULES = DATA.RULES;

function create(seed, opts) {
  opts = opts || {};
  return TCG.createMatch({
    players: [
      { deck: opts.deckA || DECK.slice() },
      { deck: opts.deckB || DECK.slice() }
    ],
    cardPool: CARDS,
    seed: seed,
    rules: Object.assign({}, RULES, opts.rules || {})
  });
}

function fill(id, n) {
  var out = [];
  for (var i = 0; i < (n || 30); i++) out.push(id);
  return out;
}

function playRandom(seed, limit) {
  var m = create(seed);
  var rng = lib.mulberry32((seed ^ 0x9e3779b9) >>> 0);
  var log = [];
  var steps = 0;
  while (m.state.phase !== 'over' && steps < (limit || 4000)) {
    var st = m.state;
    var actions = m.legalActions(st.activePlayer);
    if (!actions.length) break;
    var action = actions[Math.floor(rng() * actions.length)];
    m.apply(action);
    log.push(action);
    steps++;
  }
  return { match: m, log: log, steps: steps, state: m.state };
}

/* ------------------------------------------------------------------ *
 * 1. Determinism                                                      *
 * ------------------------------------------------------------------ */

s.group('1. 确定性：100 个种子，每个跑两遍，动作序列与终局状态逐位一致', function () {
  var badLog = 0, badState = 0, over = 0, totalSteps = 0;
  var firstBad = null;
  for (var seed = 1; seed <= 100; seed++) {
    var a = playRandom(seed, 4000);
    var b = playRandom(seed, 4000);
    totalSteps += a.steps;
    if (a.match.state.phase === 'over') over++;
    var logA = JSON.stringify(a.log);
    var logB = JSON.stringify(b.log);
    if (logA !== logB) { badLog++; if (!firstBad) firstBad = 'seed ' + seed + ' log'; }
    var stateA = JSON.stringify(a.state);
    var stateB = JSON.stringify(b.state);
    if (stateA !== stateB) { badState++; if (!firstBad) firstBad = 'seed ' + seed + ' state'; }
  }
  s.ok('100/100 两遍动作序列完全一致', badLog === 0, firstBad || '');
  s.ok('100/100 两遍终局快照逐位一致', badState === 0, firstBad || '');
  s.ok('100 局全部在步数上限内结束', over === 100, over + '/100');
  return over + ' 局结束，平均 ' + (totalSteps / 100).toFixed(1) + ' 个动作';
});

/* ------------------------------------------------------------------ *
 * 2. Replay                                                           *
 * ------------------------------------------------------------------ */

s.group('2. 重放：100 份动作日志用 replay 重跑，终局快照一致', function () {
  var mismatch = 0, replayOver = 0, badReplay = 0;
  for (var seed = 1; seed <= 100; seed++) {
    var run = playRandom(seed, 4000);
    var replayed;
    try {
      var record = run.match.record();
      replayed = run.match.replay(record);
    } catch (e) {
      badReplay++;
      continue;
    }
    if (JSON.stringify(replayed.state) !== JSON.stringify(run.state)) mismatch++;
    if (replayed.state.phase === 'over') replayOver++;
  }
  s.ok('100/100 replay 未抛错', badReplay === 0, badReplay + ' 抛错');
  s.ok('100/100 重放终局快照与原局一致', mismatch === 0, mismatch + ' 不一致');
  s.ok('100/100 重放后均正确结束', replayOver === 100, replayOver + '/100');
  return '100 份日志逐一重放';
});

/* ------------------------------------------------------------------ *
 * 3. Illegal actions                                                  *
 * ------------------------------------------------------------------ */

function expectCode(label, fn, code) {
  try {
    fn();
    s.ok(label, false, '没有被拒绝');
  } catch (e) {
    s.ok(label + ' → ' + code, e && e.code === code && e instanceof TCG.Error,
      '实际: ' + (e && e.code) + ' / ' + (e && e.message));
  }
}

s.group('3. 非法动作：12 类全部被拒且原因正确', function () {
  var codes = {};

  // a. not_your_turn
  var m1 = create(201);
  expectCode('对手回合代其结束', function () {
    m1.apply({ type: 'endTurn', playerId: 1 });
  }, 'not_your_turn');
  codes.not_your_turn = 1;

  // b. card_not_in_hand
  expectCode('打出不在手里的牌', function () {
    m1.apply({ type: 'playCard', cardId: 'p0-9999' });
  }, 'card_not_in_hand');
  codes.card_not_in_hand = 1;

  // c. not enough resource
  var m2 = create(202, { deckA: fill('everburn-beast'), deckB: fill('everburn-beast') });
  var expensive = m2.state.players[0].hand[0].id;
  expectCode('费用不足（5 费的牌在 2 灯力回合）', function () {
    m2.apply({ type: 'playCard', cardId: expensive });
  }, 'not_enough_lampower');
  codes.not_enough_lampower = 1;

  // d. target_required (indigo weaver can target itself after entering)
  var m3 = create(203, {
    deckA: fill('indigo-weaver'), deckB: fill('mosswalker'),
    rules: { startingResource: 5, firstTurnResourcePenalty: 0 }
  });
  var weaver = m3.state.players[0].hand[0].id;
  expectCode('需要目标却未给目标', function () {
    m3.apply({ type: 'playCard', cardId: weaver });
  }, 'target_required');
  codes.target_required = 1;

  // e. target_invalid
  expectCode('目标不存在', function () {
    m3.apply({ type: 'playCard', cardId: weaver, target: 'ghost' });
  }, 'target_invalid');
  codes.target_invalid = 1;

  // f. unexpected_target
  var m4 = create(204, {
    deckA: fill('kindle'), deckB: fill('kindle'),
    rules: { startingResource: 5, firstTurnResourcePenalty: 0 }
  });
  var kindle = m4.state.players[0].hand[0].id;
  expectCode('无目标卡却给目标', function () {
    m4.apply({ type: 'playCard', cardId: kindle, target: 'ghost' });
  }, 'unexpected_target');
  codes.unexpected_target = 1;

  // g. unit_not_found
  expectCode('不存在的单位攻击', function () {
    m1.apply({ type: 'attack', attacker: 'ghost', target: 'core' });
  }, 'unit_not_found');
  codes.unit_not_found = 1;

  // h. unit_not_ready (played this turn)
  var m5 = create(205, {
    deckA: fill('amber-wisp'), deckB: fill('mosswalker'),
    rules: { startingResource: 5, firstTurnResourcePenalty: 0 }
  });
  var wisp = m5.state.players[0].hand[0].id;
  m5.apply({ type: 'playCard', cardId: wisp });
  expectCode('刚登场的单位当回合攻击', function () {
    m5.apply({ type: 'attack', attacker: wisp, target: 'core' });
  }, 'unit_not_ready');
  codes.unit_not_ready = 1;

  // i. attack own unit -> target_invalid
  m5.apply({ type: 'endTurn' });
  m5.apply({ type: 'endTurn' });
  expectCode('攻击自己的单位', function () {
    m5.apply({ type: 'attack', attacker: wisp, target: wisp });
  }, 'target_invalid');
  codes.target_invalid_own = 1;

  // j. ability_not_found
  expectCode('发动不存在的能力', function () {
    m5.apply({ type: 'activate', unitId: wisp, abilityIndex: 0 });
  }, 'ability_not_found');
  codes.ability_not_found = 1;

  // k. ability_used
  var m6 = create(206, {
    deckA: fill('silver-patrol'), deckB: fill('mosswalker'),
    rules: { startingResource: 10, maxResource: 10, firstTurnResourcePenalty: 0 }
  });
  var patrol = m6.state.players[0].hand[0].id;
  m6.apply({ type: 'playCard', cardId: patrol });
  m6.apply({ type: 'activate', unitId: patrol, abilityIndex: 0 });
  expectCode('同一能力一回合用两次', function () {
    m6.apply({ type: 'activate', unitId: patrol, abilityIndex: 0 });
  }, 'ability_used');
  codes.ability_used = 1;

  // l. destroyed unit acts again -> unit_not_found
  var m7 = create(207, {
    deckA: fill('mosswalker'), deckB: fill('scorchmark'),
    rules: { startingResource: 10, maxResource: 10, firstTurnResourcePenalty: 0 }
  });
  var guard = m7.state.players[0].hand[0].id;
  m7.apply({ type: 'playCard', cardId: guard });
  m7.apply({ type: 'endTurn' });
  var scorch = m7.state.players[1].hand[0].id;
  m7.apply({ type: 'playCard', cardId: scorch, target: guard });
  s.eq('测试前提：苔径行者已被灼痕击碎', m7.state.players[0].field.length, 0);
  m7.apply({ type: 'endTurn' });
  expectCode('已阵亡单位再次行动', function () {
    m7.apply({ type: 'attack', attacker: guard, target: 'core' });
  }, 'unit_not_found');
  codes.unit_not_found_dead = 1;

  // m. match_over
  var m8 = create(208, {
    deckA: fill('amber-wisp'), deckB: fill('mosswalker'),
    rules: { startingCore: 1, startingResource: 5, firstTurnResourcePenalty: 0 }
  });
  var finisher = m8.state.players[0].hand[0].id;
  m8.apply({ type: 'playCard', cardId: finisher });
  m8.apply({ type: 'endTurn' });
  m8.apply({ type: 'endTurn' });
  m8.apply({ type: 'attack', attacker: finisher, target: 'core' });
  s.eq('测试前提：灯心归零、对局结束', [m8.state.phase, m8.state.winner], ['over', 0]);
  expectCode('对局结束后继续操作', function () {
    m8.apply({ type: 'endTurn' });
  }, 'match_over');
  codes.match_over = 1;

  // n. unknown_action
  expectCode('未知动作类型', function () {
    m1.apply({ type: 'dance' });
  }, 'unknown_action');
  codes.unknown_action = 1;

  var distinct = Object.keys(codes).length;
  s.ok('覆盖 10 类以上非法动作（含 12 个独立错误码）', distinct >= 10, distinct + ' 类');
  return distinct + ' 类非法动作全部拒绝';
});

/* ------------------------------------------------------------------ *
 * 4. Serialization                                                    *
 * ------------------------------------------------------------------ */

s.group('4. 序列化：JSON.stringify -> parse 后深度相等', function () {
  var run = playRandom(77, 4000);
  var st = run.match.state;
  var roundTrip = JSON.parse(JSON.stringify(st));
  assert.deepStrictEqual(roundTrip, st);

  function hasFunction(v) {
    if (typeof v === 'function') return true;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) if (hasFunction(v[i])) return true;
      return false;
    }
    if (v && typeof v === 'object') {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k) && hasFunction(v[k])) return true;
    }
    return false;
  }
  s.ok('快照中没有任何函数值', !hasFunction(st));
  var defIds = Object.keys(st.defs);
  var artLeak = defIds.filter(function (id) { return st.defs[id].art !== undefined; });
  s.ok('快照中的卡牌定义已剥离 SVG 与展示字段', artLeak.length === 0, artLeak.join(','));
  s.ok('卡牌实例全在五个区域中，无循环引用', (function () {
    var ids = {};
    var zones = ['deck', 'hand', 'field', 'discard', 'exile'];
    for (var p = 0; p < 2; p++) {
      for (var z = 0; z < zones.length; z++) {
        var arr = st.players[p][zones[z]];
        for (var i = 0; i < arr.length; i++) {
          if (ids[arr[i].id]) return false;
          ids[arr[i].id] = 1;
        }
      }
    }
    return true;
  })());
  return '快照 ' + JSON.stringify(st).length + ' 字节，可无损往返';
});

/* ------------------------------------------------------------------ *
 * 5. AI self-play                                                     *
 * ------------------------------------------------------------------ */

s.group('5. AI 自对弈 200 局：全部结束、0 非法动作、先手胜率 40–60%', function () {
  var firstWins = 0, secondWins = 0, draws = 0, illegal = 0, unfinished = 0;
  var stepsTotal = 0, maxSteps = 0;
  for (var seed = 1000; seed < 1200; seed++) {
    var m = create(seed);
    var steps = 0;
    var ok = true;
    while (m.state.phase !== 'over' && steps < 800) {
      var st = m.state;
      var actions = m.legalActions(st.activePlayer);
      if (!actions.length) { unfinished++; ok = false; break; }
      var action = AI.choose(st, actions, 'normal', null);
      try {
        m.apply(action);
      } catch (e) {
        illegal++;
        ok = false;
        break;
      }
      steps++;
    }
    if (ok && m.state.phase !== 'over') unfinished++;
    stepsTotal += steps;
    if (steps > maxSteps) maxSteps = steps;
    var st2 = m.state;
    if (st2.winner === 0) firstWins++;
    else if (st2.winner === 1) secondWins++;
    else draws++;
  }
  var decided = firstWins + secondWins;
  var rate = decided ? firstWins / decided : 0;
  s.eq('200 局全部正常结束', unfinished, 0);
  s.eq('200 局 0 次非法动作', illegal, 0);
  s.ok('先手胜率在 40%–60% 之间', rate >= 0.4 && rate <= 0.6,
    '先手 ' + firstWins + ' 胜 / 后手 ' + secondWins + ' 胜 / 平局 ' + draws + ' = ' + (rate * 100).toFixed(1) + '%');
  s.ok('每局步数不超过 800', maxSteps <= 800, '最大 ' + maxSteps);
  console.log('    先手 ' + firstWins + ' 胜，后手 ' + secondWins + ' 胜，平局 ' + draws +
    '；先手胜率 ' + (rate * 100).toFixed(1) + '%（按已分胜负计）');
  console.log('    平均 ' + (stepsTotal / 200).toFixed(1) + ' 个动作/局，单局最多 ' + maxSteps);
  return '先手胜率 ' + (rate * 100).toFixed(1) + '%，0 非法动作';
});

/* ------------------------------------------------------------------ *
 * 6. Originality, card faces, language coverage                       *
 * ------------------------------------------------------------------ */

s.group('6. 原创性与卡面：禁用词 grep、12 张卡面、各 ≤6 KiB、三语齐全', function () {
  // Build the pattern from fragments so this checker's own source does not
  // contain the banned strings verbatim.
  var banned = new RegExp(
    ['poke', 'mon'].join('') + '|' +
    ['宝', '可梦'].join('') + '|' +
    ['energy', 'card'].join(' ') + '|' +
    ['trainer', 'card'].join(' ') + '|' +
    ['magic', 'the gathering'].join(' ') + '|' +
    ['hearth', 'stone'].join('') + '|' +
    ['yu', 'gi', 'oh'].join(''),
    'i'
  );
  s.ok('自检用禁用词正则确实能命中样例（证明检查真的跑了）',
    banned.test(['poke', 'mon'].join('')) && banned.test(['energy', 'card'].join(' ')));

  var files = [
    path.join(__dirname, '..', 'shared', 'tcg.js'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'rules.html'),
    path.join(__dirname, 'test.js')
  ];
  var hits = [];
  files.forEach(function (file) {
    if (!fs.existsSync(file)) { hits.push(path.basename(file) + ': 文件缺失'); return; }
    var text = fs.readFileSync(file, 'utf8');
    var m = text.match(banned);
    if (m) hits.push(path.basename(file) + ': ' + m[0]);
  });
  s.ok('4 个源码文件均不含禁用词', hits.length === 0, hits.join('; '));

  var defIds = Object.keys(CARDS);
  s.eq('共 12 种不同卡面', DATA.DISTINCT_FACES, 12);
  s.eq('卡牌定义数量 12', defIds.length, 12);
  s.eq('每套牌 30 张', DATA.DECK_SIZE, 30);
  var over = defIds.filter(function (id) {
    return Buffer.byteLength(CARDS[id].art, 'utf8') > 6144;
  });
  s.ok('每张 SVG 卡面 ≤ 6 KiB', over.length === 0, over.join(','));
  var uniqArt = {};
  defIds.forEach(function (id) { uniqArt[CARDS[id].art] = 1; });
  s.eq('12 张卡面互不相同', Object.keys(uniqArt).length, 12);
  var missing = [];
  defIds.forEach(function (id) {
    ['name', 'text'].forEach(function (field) {
      ['zh', 'en', 'id'].forEach(function (l) {
        if (!CARDS[id][field] || !CARDS[id][field][l]) missing.push(id + '.' + field + '.' + l);
      });
    });
  });
  s.ok('每张卡的名称与说明三语齐全', missing.length === 0, missing.join(','));
  var deckIds = {};
  DECK.forEach(function (id) { deckIds[id] = (deckIds[id] || 0) + 1; });
  s.eq('牌组覆盖全部 12 种卡', Object.keys(deckIds).length, 12);

  var uiCode = lib.scriptCode(PAGE, 'sample-ui');
  var textLiteral = lib.between(uiCode, 'var TEXT = ', ';\n\n  var KEY_LOCAL');
  var UI = new Function('return (' + textLiteral + ');')();
  var keysZh = Object.keys(UI.zh).sort();
  s.eq('UI 英文词典键与中文一致', Object.keys(UI.en).sort(), keysZh);
  s.eq('UI 印尼文词典键与中文一致', Object.keys(UI.id).sort(), keysZh);
  s.ok('UI 三语词典无空值', ['zh', 'en', 'id'].every(function (l) {
    return keysZh.every(function (k) { return typeof UI[l][k] === 'string' && UI[l][k].length > 0; });
  }));
  return '12 张卡面 / 30 张牌 / 三语齐全 / 禁用词 0 命中';
});

/* ------------------------------------------------------------------ *
 * 7. Rules page length                                                *
 * ------------------------------------------------------------------ */

s.group('7. 规则页：中文正文 1500–2000 字，含独创声明', function () {
  var file = path.join(__dirname, 'rules.html');
  if (!fs.existsSync(file)) {
    s.ok('rules.html 存在', false, '缺失');
    return '';
  }
  var html = fs.readFileSync(file, 'utf8');
  var visible = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ');
  var cjk = (visible.match(/[\u3400-\u9fff]/g) || []).length;
  s.ok('中文正文 1500–2000 字', cjk >= 1500 && cjk <= 2000, cjk + ' 个汉字');
  s.ok('包含「本作为原创设计」声明', visible.indexOf('本作为原创设计') >= 0);
  s.ok('包含 Article JSON-LD', /"@type"\s*:\s*"Article"/.test(html));
  s.ok('包含 FAQPage JSON-LD', /"@type"\s*:\s*"FAQPage"/.test(html));
  return cjk + ' 个汉字';
});

/* ------------------------------------------------------------------ *
 * 8. Version migration                                                *
 * ------------------------------------------------------------------ */

s.group('8. 版本迁移：旧裸日志经 replayLegacy 显式重放，严格 replay 仍拒绝裸数组', function () {
  var mismatch = 0, rejected = 0, headerOk = 0, mutated = 0, firstBad = null;
  for (var seed = 1; seed <= 20; seed++) {
    var run = playRandom(seed, 4000);
    var legacyLog = run.log;
    var before = JSON.stringify(run.match.state);

    // 旧格式（裸动作数组）仍可读，但只能走显式迁移入口。
    var migrated = run.match.replayLegacy(legacyLog);
    if (JSON.stringify(migrated.state) !== before) {
      mismatch++;
      if (!firstBad) firstBad = 'seed ' + seed + ' snapshot';
    }
    if (JSON.stringify(run.match.state) !== before) mutated++;

    // 严格入口必须继续拒绝裸数组，不允许为了兼容而放宽校验。
    try {
      run.match.replay(legacyLog);
    } catch (e) {
      if (e && e.code === 'replay_legacy_format' && e instanceof TCG.Error) rejected++;
    }

    // 新记录带版本头，严格入口可重放。
    var record = run.match.record();
    var header = record.engineVersion && record.rng && record.ruleset;
    var replayed = run.match.replay(record);
    if (header && JSON.stringify(replayed.state) === before) headerOk++;
  }
  s.ok('20/20 旧裸日志 replayLegacy 终局快照一致', mismatch === 0, firstBad || '');
  s.ok('replayLegacy 不修改原 match', mutated === 0, mutated + ' 被修改');
  s.ok('20/20 严格 replay 仍拒绝裸数组（replay_legacy_format）', rejected === 20, rejected + '/20');
  s.ok('20/20 新记录 record() 带头部且 replay(record) 一致', headerOk === 20, headerOk + '/20');
  return '旧裸日志显式迁移 / 严格入口保持拒绝';
});

s.done();
