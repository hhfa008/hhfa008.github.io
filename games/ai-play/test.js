#!/usr/bin/env node
'use strict';

/*
 * GameAgent protocol test suite.
 *
 *   node games/ai-play/test.js
 *
 * Five adapters are in scope: gomoku, connect4, reversi, tcg, mahjong.
 * The suite covers the protocol contract (pure JSON, deterministic hashes,
 * illegal actions leaving state untouched, unknown_game), a full playout per
 * game, and 50 seeded random games per game with zero illegal actions, zero
 * exceptions and no run that reaches maxMoves.
 */

var crypto = require('crypto');
var assert = require('assert');
var lib = require('../tests/lib.js');
var s = lib.suite('ai-play');

var GameAgent = require('../shared/agent-api.js');
var ADAPTERS = {
  gomoku: require('./adapters/gomoku.js'),
  connect4: require('./adapters/connect4.js'),
  reversi: require('./adapters/reversi.js'),
  tcg: require('./adapters/tcg.js'),
  mahjong: require('./adapters/mahjong.js')
};
var GAMES = ['gomoku', 'connect4', 'reversi', 'tcg', 'mahjong'];

/* ---------------------------------------------------------------- helpers */

function plain(value) {
  var text = JSON.stringify(value);
  assert.ok(typeof text === 'string', 'value is not JSON-serializable');
  var round = JSON.parse(text);
  assert.strictEqual(JSON.stringify(round), text, 'JSON round-trip is not stable');
  assert.deepStrictEqual(round, value, 'JSON round-trip changed the value');
  return round;
}

function cloneState(session) {
  var st = session.state();
  // The protocol promises structuredClone + JSON both work.
  var sc = structuredClone(st);
  assert.deepStrictEqual(sc, st, 'structuredClone changed the value');
  return plain(sc);
}

function uniqueIds(actions) {
  var seen = {};
  for (var i = 0; i < actions.length; i++) {
    if (seen[actions[i].id]) return false;
    seen[actions[i].id] = 1;
  }
  return true;
}

function actionsWellFormed(actions) {
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    if (typeof a.id !== 'string' || !a.id) return false;
    if (typeof a.type !== 'string' || !a.type) return false;
    if (typeof a.desc !== 'string') return false;
    if (a.payload === null || typeof a.payload !== 'object' || Array.isArray(a.payload)) return false;
    plain(a.payload);
  }
  return true;
}

function playToEnd(session, seed) {
  var rng = lib.mulberry32((seed >>> 0) || 1);
  var guard = 0;
  while (session.status().phase === 'playing' && guard < 5000) {
    var legal = session.legalActions();
    if (!legal.length) break;
    var pick = legal[Math.floor(rng() * legal.length)];
    var res = session.apply(pick.id);
    assert.ok(res && res.ok === true, 'a legal action was rejected: ' + pick.id + ' / ' + (res && res.error));
    guard++;
  }
  return session;
}

var VALID_WINNERS = { p1: 1, p2: 1, draw: 1 };
function validWinnerFor(winner, seats) {
  return winner === 'draw' || seats.indexOf(winner) >= 0;
}

/* ------------------------------------------------- 1. registry / protocol */

s.group('1. 注册表与协议入口', function () {
  s.eq('GameAgent.version', GameAgent.version, '1.0.0');

  var rows = GameAgent.list();
  s.eq('list() 返回 5 款基础游戏 + mahjong4', rows.length, GAMES.length + 1);
  var slugs = rows.map(function (r) { return r.slug; }).sort();
  s.eq('list() 的 slug 齐全且有序', slugs, GAMES.concat(['mahjong4']).sort());

  var metaOk = rows.every(function (r) {
    return typeof r.players === 'number' && r.players > 0 &&
      Array.isArray(r.seats) && r.seats.length === r.players &&
      typeof r.moves === 'string' && r.moves.length > 0 &&
      typeof r.source === 'string' && r.source.length > 0;
  });
  s.ok('每项都有 players / seats / moves / source', metaOk);

  var createCode = null;
  try { GameAgent.create('__nope__', { seed: 1 }); } catch (e) { createCode = e.code; }
  s.eq('create(unknown) 抛 unknown_game', createCode, 'unknown_game');

  var playoutCode = null;
  try { GameAgent.playout('__nope__', null, { seed: 1 }); } catch (e) { playoutCode = e.code; }
  s.eq('playout(unknown) 抛 unknown_game', playoutCode, 'unknown_game');

  var adapterOk = GAMES.every(function (slug) {
    return ADAPTERS[slug] && typeof ADAPTERS[slug].create === 'function';
  });
  s.ok('五个适配器都已加载', adapterOk);
});

/* ------------------------------- 2. per-game initial / legal / illegal */

GAMES.forEach(function (slug) {
  s.group('2.' + slug + '：初始状态、合法动作与非法动作', function () {
    var g = GameAgent.create(slug, { seed: 7 });

    s.eq('session.slug', g.slug, slug);
    s.eq('session.version', g.version, '1.0.0');
    s.eq('session.seats', g.seats, ['p1', 'p2']);

    var st = cloneState(g);
    s.ok('初始 state 是纯 JSON 且可 structuredClone', plain(st) !== null);

    s.eq('初始 status', g.status(), { phase: 'playing', winner: null });
    s.ok('初始 player 是 p1/p2', g.player() === 'p1' || g.player() === 'p2');

    var legal = g.legalActions();
    s.ok('初始 legalActions 非空', legal.length > 0);
    s.ok('初始动作 id 唯一', uniqueIds(legal));
    s.ok('初始动作结构完整且 payload 为纯 JSON', actionsWellFormed(legal));

    var h0 = g.hash();
    s.ok('初始 hash 是非空字符串', typeof h0 === 'string' && h0.length >= 8);
    s.eq('同一初始状态 hash 稳定', g.hash(), h0);

    var r = g.apply(legal[0].id);
    s.eq('合法动作 apply 返回 ok:true', r.ok, true);
    s.ok('合法动作返回的 state 是纯 JSON', plain(r.state) !== null);
    s.ok('合法动作后 hash 发生变化', g.hash() !== h0);

    // Every apply on the same seed must change the hash, step by step.
    var walker = GameAgent.create(slug, { seed: 9 });
    var prev = walker.hash(), steps = 0, changed = 0;
    while (steps < 8 && walker.status().phase === 'playing') {
      var moves = walker.legalActions();
      if (!moves.length) break;
      var picked = moves[(steps * 3 + 1) % moves.length];
      var wr = walker.apply(picked.id);
      assert.ok(wr.ok, 'legal action rejected while walking: ' + picked.id);
      var next = walker.hash();
      if (next !== prev) changed++;
      prev = next;
      steps++;
    }
    s.ok('连续 ' + steps + ' 步 apply 均改变 hash', steps > 0 && changed === steps);

    var before = JSON.stringify(g.state());
    var beforeHash = g.hash();
    var bad = g.apply('__not_a_legal_action__');
    s.eq('非法动作返回 illegal_action', bad, { ok: false, error: 'illegal_action' });
    s.ok('非法动作后 state 完全未变', JSON.stringify(g.state()) === before);
    s.eq('非法动作后 hash 未变', g.hash(), beforeHash);

    var finished = playToEnd(GameAgent.create(slug, { seed: 11 }), 11);
    var fs = finished.status();
    s.eq('完整对局 phase 为 over', fs.phase, 'over');
    s.ok('完整对局有胜负或和棋', !!VALID_WINNERS[fs.winner], String(fs.winner));
    s.eq('结束后 legalActions 为空', finished.legalActions().length, 0);
    s.eq('结束后 apply 返回 game_over', finished.apply('__anything__'), { ok: false, error: 'game_over' });
  });
});

/* ------------------------- 2b. gomoku regression: turns and both colours */

s.group('2b. gomoku：回合交替、双方五连检测与对局记录', function () {
  var g = GameAgent.create('gomoku', { seed: 1 });
  s.eq('初始轮到 p1', g.player(), 'p1');
  g.apply('place:0');
  s.eq('第一手后轮到 p2', g.player(), 'p2');
  g.apply('place:1');
  s.eq('第二手后轮到 p1', g.player(), 'p1');

  // p2 makes five on row 0 (cols 4..8); p1 only has four (cols 0..3).
  var p2 = GameAgent.create('gomoku', { seed: 1 });
  [0, 4, 1, 5, 2, 6, 3, 7, 14, 8].forEach(function (i) {
    var r = p2.apply('place:' + i);
    assert.ok(r.ok, 'p2 scripted move rejected: ' + i);
  });
  s.eq('后手五连判 p2 获胜', p2.status(), { phase: 'over', winner: 'p2' });
  s.eq('后手胜利线为 5 格', p2.state().line.length, 5);

  // p1 makes five on row 0 (cols 4..8); p2 plays four elsewhere.
  var p1 = GameAgent.create('gomoku', { seed: 1 });
  [4, 0, 5, 1, 6, 2, 7, 14, 8].forEach(function (i) {
    var r = p1.apply('place:' + i);
    assert.ok(r.ok, 'p1 scripted move rejected: ' + i);
  });
  s.eq('先手五连判 p1 获胜', p1.status(), { phase: 'over', winner: 'p1' });

  var out = GameAgent.playout('gomoku', null, { seed: 1, maxMoves: 5000 });
  var counts = { p1: 0, p2: 0 };
  for (var i = 0; i < out.log.length; i++) counts[out.log[i].player]++;
  s.ok('playout 双方都实际落子', counts.p1 > 0 && counts.p2 > 0);
  s.ok('双方手数差不超过 1', Math.abs(counts.p1 - counts.p2) <= 1);
});

/* ----------------------------------------------------- 3. determinism */

s.group('3. 确定性：同 seed 两次 playout 的 hash / log / 重放一致', function () {
  GAMES.forEach(function (slug) {
    var a = GameAgent.playout(slug, null, { seed: 42, maxMoves: 5000 });
    var b = GameAgent.playout(slug, null, { seed: 42, maxMoves: 5000 });

    s.eq(slug + ' 两次 playout hash 一致', a.hash, b.hash);
    s.eq(slug + ' 两次 playout log 逐字节一致', JSON.stringify(a.log), JSON.stringify(b.log));

    var replay = GameAgent.create(slug, { seed: 42 });
    var replayOk = true;
    for (var i = 0; i < a.log.length; i++) {
      var r = replay.apply(a.log[i].id);
      if (!r || !r.ok) { replayOk = false; break; }
    }
    s.ok(slug + ' log 可重放全部动作', replayOk);
    s.eq(slug + ' 重放终局 hash 一致', replay.hash(), a.hash);

    var md5 = crypto.createHash('md5')
      .update(a.hash + '\n' + JSON.stringify(a.log))
      .digest('hex');
    console.log('  [md5] ' + slug + ' ' + md5);
  });
});

/* ------------------------------------------- 4. 50 random games per game */

s.group('4. 随机对局：每款 50 局，0 非法动作 / 0 异常 / 全部终止', function () {
  var lines = [];
  GAMES.forEach(function (slug) {
    var stats = {
      runs: 50, exceptions: 0, illegal: 0, unterminated: 0,
      maxMoves: 5000, moves: [], winners: { p1: 0, p2: 0, draw: 0 }
    };
    for (var seed = 1; seed <= 50; seed++) {
      try {
        var out = GameAgent.playout(slug, null, { seed: seed, maxMoves: stats.maxMoves });
        stats.moves.push(out.moves);
        if (!VALID_WINNERS[out.winner]) stats.unterminated++;
        else stats.winners[out.winner]++;
      } catch (e) {
        stats.exceptions++;
        if (e && (e.code === 'protocol_error' || e.code === 'illegal_agent_action')) stats.illegal++;
        if (stats.exceptions <= 3) console.log('  [' + slug + '] exception: ' + (e && e.code) + ' ' + (e && e.message));
      }
    }
    var sorted = stats.moves.slice().sort(function (a, b) { return a - b; });
    var sum = stats.moves.reduce(function (a, b) { return a + b; }, 0);
    var med = sorted.length ? sorted[(sorted.length / 2) | 0] : 0;
    var drawRate = stats.runs ? (stats.winners.draw / stats.runs * 100).toFixed(0) : '0';

    s.eq(slug + ' 50 局无异常', stats.exceptions, 0);
    s.eq(slug + ' 50 局 0 次非法动作', stats.illegal, 0);
    s.eq(slug + ' 50 局全部终止', stats.runs - stats.unterminated, 50);
    s.ok(slug + ' 无死循环（步数 < maxMoves）',
      stats.moves.length === stats.runs && stats.moves.every(function (n) { return n > 0 && n < stats.maxMoves; }));

    lines.push(slug + ' 步数 min/med/max = ' + sorted[0] + '/' + med + '/' + (sorted[sorted.length - 1]) +
      '，均值 ' + (sum / stats.runs).toFixed(1) +
      '，p1/p2/draw = ' + stats.winners.p1 + '/' + stats.winners.p2 + '/' + stats.winners.draw +
      '，平局率 ' + drawRate + '%');
  });
  return lines.join(' | ');
});

/* ---------------------------------------- 5. pure JSON every ten moves */

s.group('5. 纯 JSON：每款每 10 步做 structuredClone + stringify 往返', function () {
  s.ok('node 提供 structuredClone', typeof structuredClone === 'function');

  GAMES.forEach(function (slug) {
    var g = GameAgent.create(slug, { seed: 33 });
    var checks = 0, bad = 0, step = 0;
    while (step < 40 && g.status().phase === 'playing') {
      var st = g.state();
      if (step % 10 === 0) {
        checks++;
        try {
          var sc = structuredClone(st);
          var text = JSON.stringify(sc);
          var round = JSON.parse(text);
          if (JSON.stringify(round) !== text) bad++;
          assert.deepStrictEqual(round, st);
        } catch (e) {
          bad++;
        }
      }
      var legal = g.legalActions();
      if (!legal.length) break;
      var r = g.apply(legal[(step * 5 + 2) % legal.length].id);
      if (!r.ok) { bad++; break; }
      step++;
    }
    s.ok(slug + ' 抽查 ' + checks + ' 次均往返稳定', checks > 0 && bad === 0);
  });
});

/* ------------------------------------------------ 6. explicit agents */

s.group('6. playout 的 agents 参数：函数式 agent 可驱动完整对局', function () {
  GAMES.forEach(function (slug) {
    var out = GameAgent.playout(slug, function (session, legal) {
      return legal[0].id;
    }, { seed: 5, maxMoves: 5000 });
    s.ok(slug + ' 函数式 agent 对局终止', !!VALID_WINNERS[out.winner] && out.moves > 0);
  });
});

/* ------------------------- 7. four-seat mahjong (protocol extension) */

s.group('7. mahjong4：4 座位协议、确定性重放与 50 局随机对局', function () {
  var g = GameAgent.create('mahjong4', { seed: 7 });
  s.eq('session.seats', g.seats, ['p1', 'p2', 'p3', 'p4']);
  s.ok('player 是 4 个座位之一', g.seats.indexOf(g.player()) >= 0);
  var legal = g.legalActions();
  s.ok('初始合法动作非空且 id 唯一', legal.length > 0 && uniqueIds(legal));

  var stats = { runs: 50, exceptions: 0, illegal: 0, unterminated: 0, moves: [], winners: {} };
  for (var seed = 1; seed <= 50; seed++) {
    try {
      var out = GameAgent.playout('mahjong4', null, { seed: seed, maxMoves: 5000 });
      stats.moves.push(out.moves);
      if (!validWinnerFor(out.winner, g.seats)) stats.unterminated++;
      else stats.winners[out.winner] = (stats.winners[out.winner] || 0) + 1;
    } catch (e) {
      stats.exceptions++;
      if (e && (e.code === 'protocol_error' || e.code === 'illegal_agent_action')) stats.illegal++;
      if (stats.exceptions <= 3) console.log('  [mahjong4] exception: ' + (e && e.code) + ' ' + (e && e.message));
    }
  }
  var sorted = stats.moves.slice().sort(function (a, b) { return a - b; });
  var sum = stats.moves.reduce(function (a, b) { return a + b; }, 0);

  s.eq('50 局无异常', stats.exceptions, 0);
  s.eq('50 局 0 次非法动作', stats.illegal, 0);
  s.eq('50 局全部终止', stats.runs - stats.unterminated, 50);
  s.ok('无死循环（步数 < maxMoves）',
    stats.moves.length === stats.runs && stats.moves.every(function (n) { return n > 0 && n < 5000; }));

  var a = GameAgent.playout('mahjong4', null, { seed: 42, maxMoves: 5000 });
  var b = GameAgent.playout('mahjong4', null, { seed: 42, maxMoves: 5000 });
  s.eq('同 seed 两次 playout hash 一致', a.hash, b.hash);
  s.eq('同 seed 两次 playout log 逐字节一致', JSON.stringify(a.log), JSON.stringify(b.log));

  var replay = GameAgent.create('mahjong4', { seed: 42 });
  var replayOk = true;
  for (var i = 0; i < a.log.length; i++) {
    var r = replay.apply(a.log[i].id);
    if (!r || !r.ok) { replayOk = false; break; }
  }
  s.ok('log 可重放全部动作', replayOk);
  s.eq('重放终局 hash 一致', replay.hash(), a.hash);

  var md5 = crypto.createHash('md5')
    .update(a.hash + '\n' + JSON.stringify(a.log))
    .digest('hex');
  console.log('  [md5] mahjong4 ' + md5);

  return '步数 min/med/max = ' + sorted[0] + '/' + sorted[(sorted.length / 2) | 0] + '/' +
    sorted[sorted.length - 1] + '，均值 ' + (sum / stats.runs).toFixed(1) +
    '，winners ' + JSON.stringify(stats.winners);
});

s.done();
