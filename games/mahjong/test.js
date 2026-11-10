'use strict';

// Mahjong test suite.
// The rules engine is the <script id="engine"> block of index.html; every
// assertion runs against the same source the browser runs, with win detection
// delegated to games/shared/hand-eval.js exactly as the page does.

var fs = require('fs');
var path = require('path');
var lib = require('../tests/lib.js');
var s = lib.suite('mahjong');

var html = lib.page(__dirname);
lib.evalCode(fs.readFileSync(path.join(__dirname, '..', 'shared', 'hand-eval.js'), 'utf8'),
  'globalThis.HandEval');
var M = lib.evalScript(html, 'engine', 'globalThis.Mahjong');

/* ---------------------------------------------------------------- helpers */

// 13 scattered single tiles used as filler. No runs, no pairs.
var FILL = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 30, 32, 33, 2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 31];

function handWith(tile, copies, size) {
  var h = [];
  for (var i = 0; i < copies; i++) h.push(tile);
  for (var j = 0; j < FILL.length && h.length < size; j++) {
    if (FILL[j] !== tile) h.push(FILL[j]);
  }
  while (h.length < size) h.push(33);
  return h.slice(0, size);
}
function counts(list) { return M.countsFrom(list); }
function totalCount(countsArr) { return M.countsTotal(countsArr); }
function emptyMelds() { return [[], [], [], []]; }
function makeState(hands, wall, opts) {
  opts = opts || {};
  var o = {
    hands: hands,
    wall: wall || [],
    dealer: opts.dealer == null ? 0 : opts.dealer,
    turn: opts.turn == null ? 0 : opts.turn,
    melds: opts.melds || emptyMelds(),
    afterDraw: !!opts.afterDraw,
    aiLevels: ['medium', 'medium', 'medium', 'medium']
  };
  return M.createGame(o);
}
function arr(pairs) {
  var c = [];
  for (var i = 0; i < 34; i++) c.push(0);
  for (var j = 0; j < pairs.length; j++) c[pairs[j][0]] += pairs[j][1];
  return c;
}
function isWinArray(c) { return M.checkWinCounts(c, []); }

/* ------------------------------------------------- 1. wall integrity (136) */

s.group('1. 牌墙完整性：136 张与各花色张数', function () {
  var wall = M.makeWall();
  s.eq('总张数 136', wall.length, 136);
  s.eq('导出的 WALL_SIZE 为 136', M.WALL_SIZE, 136);

  var c = counts(wall);
  var wan = 0, tong = 0, tiao = 0, honor = 0;
  for (var i = 0; i < 9; i++) wan += c[i];
  for (i = 9; i < 18; i++) tong += c[i];
  for (i = 18; i < 27; i++) tiao += c[i];
  for (i = 27; i < 34; i++) honor += c[i];
  s.eq('万子 36 张', wan, 36);
  s.eq('筒子 36 张', tong, 36);
  s.eq('条子 36 张', tiao, 36);
  s.eq('字牌 28 张', honor, 28);
  s.ok('合计 136', wan + tong + tiao + honor === 136);

  var allFour = true;
  for (i = 0; i < 34; i++) if (c[i] !== 4) allFour = false;
  s.ok('34 种牌每种恰好 4 张', allFour);

  var shuffleError = null;
  try { M.createGame({ seed: 7 }); } catch (e) { shuffleError = e.message; }
  s.ok('能由共享洗牌引擎生成牌墙', shuffleError === null, shuffleError || '');
});

/* -------------------------------------- 2. dealing: 13 each + dealer 1 = 53 */

s.group('2. 发牌：4 人各 13 张 + 庄家多 1 张', function () {
  var allOk = true, detail = '';
  for (var seed = 1; seed <= 30; seed++) {
    var st = M.createGame({ seed: seed });
    var lengths = st.players.map(function (p) { return p.hand.length; });
    if (lengths[0] !== 14 || lengths[1] !== 13 || lengths[2] !== 13 || lengths[3] !== 13) {
      allOk = false; detail = 'seed ' + seed + ': ' + lengths.join('/'); break;
    }
    var dealt = 0, seen = counts(st.players[0].hand.slice());
    for (var p = 0; p < 4; p++) dealt += st.players[p].hand.length;
    if (dealt !== 53) { allOk = false; detail = 'seed ' + seed + ' 发出 ' + dealt; break; }
    if (st.wall.length !== 83) { allOk = false; detail = 'seed ' + seed + ' 牌墙 ' + st.wall.length; break; }
    var combined = counts(st.players[0].hand.slice());
    for (p = 1; p < 4; p++) {
      for (var i = 0; i < st.players[p].hand.length; i++) combined[st.players[p].hand[i]]++;
    }
    for (i = 0; i < st.wall.length; i++) combined[st.wall[i]]++;
    for (i = 0; i < 34; i++) if (combined[i] !== 4) { allOk = false; detail = 'seed ' + seed + ' 第 ' + i + ' 种 ' + combined[i]; break; }
    if (!allOk) break;
  }
  s.ok('30 个种子都是 14/13/13/13、共 53 张、牌墙 83 张', allOk, detail);

  var st2 = M.createGame({ seed: 99 });
  var maxOk = true;
  for (var k = 0; k < 34; k++) if (counts(st2.players[0].hand.slice())[k] > 4) maxOk = false;
  s.ok('庄家手牌同种不超过 4 张', maxOk);

  // 庄家额外那张确实不是重复发牌：四人合计 + 牌墙 = 136。
  var grand = st2.players[0].hand.length + st2.players[1].hand.length +
    st2.players[2].hand.length + st2.players[3].hand.length + st2.wall.length;
  s.eq('手牌 + 牌墙 = 136', grand, 136);
});

/* ------------------------------------------- 3. pong / kong legality checks */

s.group('3. 碰的合法性（6 例）+ 不能碰的负例', function () {
  var tiles = [0, 2, 5, 9, 14, 18, 23, 27, 29, 32];
  var positives = 0, negatives = 0, failures = [];
  tiles.forEach(function (tile) {
    // 正例：下家有 2 张，应该出现「碰」
    var hands = [handWith(tile, 1, 14), handWith(tile, 2, 13), handWith(20, 0, 13), handWith(20, 0, 13)];
    var st = makeState(hands, [3, 4, 5]);
    var r = M.apply(st, { type: 'discard', tile: tile });
    if (!r.ok) { failures.push('discard ' + tile + ': ' + r.error); return; }
    var p = M.pending(st);
    if (p && p.kind === 'claim' && p.player === 1 && p.options.pong) positives++;
    else failures.push('tile ' + tile + ' 未给出碰：' + JSON.stringify(p && { kind: p.kind, player: p.player, options: p.options }));
    var pr = M.apply(st, { type: 'pong' });
    if (!pr.ok) { failures.push('pong ' + tile + ': ' + pr.error); return; }
    var pl = st.players[1];
    if (!(pl.melds.length === 1 && pl.melds[0].type === 'pong' && pl.melds[0].tile === tile)) {
      failures.push('tile ' + tile + ' 碰后副露错误');
    } else if (pl.hand.length !== 11) {
      failures.push('tile ' + tile + ' 碰后手牌 ' + pl.hand.length + '（应为 11）');
    } else if (!(st.turn === 1 && st.phase === 'turn')) {
      failures.push('tile ' + tile + ' 碰后未轮到下家出牌');
    } else if (st.players[0].discards.length !== 0) {
      failures.push('tile ' + tile + ' 碰后牌河未移除');
    } else {
      positives++;
    }

    // 负例：下家只有 1 张，不应出现「碰」
    var hands2 = [handWith(tile, 1, 14), handWith(tile, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)];
    var st2 = makeState(hands2, [3, 4, 5]);
    var r2 = M.apply(st2, { type: 'discard', tile: tile });
    if (!r2.ok) { failures.push('neg discard ' + tile + ': ' + r2.error); return; }
    var p2 = M.pending(st2);
    if (!p2 || p2.player !== 1 || !p2.options || !p2.options.pong) negatives++;
    else failures.push('tile ' + tile + ' 只有 1 张却可碰');
  });
  s.ok('至少 5 例「可碰」：按钮/选项出现且碰后手牌 11 张', positives >= 10,
    '通过 ' + positives + ' 项断言');
  s.ok('至少 5 例「不能碰」：选项不出现', negatives >= 10, '通过 ' + negatives + ' 项断言');
  if (failures.length) failures.slice(0, 6).forEach(function (f) { s.ok('碰用例', false, f); });
});

s.group('3b. 明杠（6 例）：杠后补一张', function () {
  var tiles = [0, 3, 7, 12, 19, 26, 31, 33];
  var ok = 0, bad = [];
  tiles.forEach(function (tile) {
    var hands = [handWith(tile, 1, 14), handWith(tile, 3, 13), handWith(20, 0, 13), handWith(20, 0, 13)];
    var wall = [2, 4, 6, 8, 10, 12];
    var st = makeState(hands, wall);
    var r = M.apply(st, { type: 'discard', tile: tile });
    if (!r.ok) { bad.push('discard: ' + r.error); return; }
    var p = M.pending(st);
    if (!(p && p.player === 1 && p.options.kong)) { bad.push('tile ' + tile + ' 未给出明杠'); return; }
    var before = st.wall.length;
    var kr = M.apply(st, { type: 'kong' });
    if (!kr.ok) { bad.push('kong ' + tile + ': ' + kr.error); return; }
    var pl = st.players[1];
    if (!(pl.melds.length === 1 && pl.melds[0].type === 'kong' && pl.melds[0].tile === tile)) {
      bad.push('tile ' + tile + ' 明杠副露错误');
    } else if (st.wall.length !== before - 1) {
      bad.push('tile ' + tile + ' 杠后牌墙 ' + st.wall.length + '（应 ' + (before - 1) + '）');
    } else if (pl.hand.length !== 11) {
      bad.push('tile ' + tile + ' 杠后手牌 ' + pl.hand.length + '（应为 11）');
    } else if (!(st.phase === 'turn' && st.turn === 1 && st.afterDraw)) {
      bad.push('tile ' + tile + ' 杠后未进入补牌后的出牌状态');
    } else if (st.players[0].discards.length !== 0) {
      bad.push('tile ' + tile + ' 杠后牌河未移除');
    } else {
      ok++;
    }
  });
  s.ok('至少 5 例明杠：副露、补牌、轮转均正确', ok >= 5, ok + ' 例');
  bad.slice(0, 5).forEach(function (b) { s.ok('明杠用例', false, b); });
});

s.group('3c. 暗杠（6 例）：手上四张，杠后补一张', function () {
  var tiles = [0, 4, 8, 11, 17, 21, 27, 33];
  var ok = 0, bad = [];
  tiles.forEach(function (tile) {
    var hands = [handWith(tile, 4, 14), handWith(20, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)];
    var wall = [2, 4, 6, 8, 10];
    var st = makeState(hands, wall, { afterDraw: true });
    var p = M.pending(st);
    if (!(p && p.options.ankong.indexOf(tile) >= 0)) { bad.push('tile ' + tile + ' 未给出暗杠'); return; }
    var before = st.wall.length;
    var r = M.apply(st, { type: 'ankong', tile: tile });
    if (!r.ok) { bad.push('ankong ' + tile + ': ' + r.error); return; }
    var pl = st.players[0];
    if (!(pl.melds.length === 1 && pl.melds[0].type === 'ankong' && pl.melds[0].tile === tile)) {
      bad.push('tile ' + tile + ' 暗杠副露错误');
    } else if (st.wall.length !== before - 1) {
      bad.push('tile ' + tile + ' 暗杠后牌墙 ' + st.wall.length + '（应 ' + (before - 1) + '）');
    } else if (pl.hand.length !== 11) {
      bad.push('tile ' + tile + ' 暗杠后手牌 ' + pl.hand.length + '（应为 11）');
    } else if (!st.afterDraw || st.turn !== 0 || st.phase !== 'turn') {
      bad.push('tile ' + tile + ' 暗杠后状态错误');
    } else {
      ok++;
    }
  });
  s.ok('至少 5 例暗杠：副露、补牌、状态均正确', ok >= 5, ok + ' 例');

  // 负例：只有三张时不能暗杠
  var neg = makeState([handWith(0, 3, 14), handWith(20, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)], [1, 2], { afterDraw: true });
  var np = M.pending(neg);
  s.ok('只有三张时不出现暗杠选项', np && np.options.ankong.indexOf(0) < 0);
  bad.slice(0, 5).forEach(function (b) { s.ok('暗杠用例', false, b); });
});

s.group('3d. 加杠（6 例）：碰后摸到第四张', function () {
  var tiles = [1, 5, 9, 13, 18, 24, 30, 32];
  var ok = 0, bad = [];
  tiles.forEach(function (tile) {
    var hands = [handWith(tile, 1, 11), handWith(20, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)];
    var melds = [[{ type: 'pong', tile: tile, from: 1 }], [], [], []];
    var wall = [2, 4, 6, 8];
    var st = makeState(hands, wall, { melds: melds, afterDraw: true });
    var p = M.pending(st);
    if (!(p && p.options.addkong.length === 1)) { bad.push('tile ' + tile + ' 未给出加杠'); return; }
    var before = st.wall.length;
    var r = M.apply(st, { type: 'addkong', meldIndex: 0 });
    if (!r.ok) { bad.push('addkong ' + tile + ': ' + r.error); return; }
    var pl = st.players[0];
    if (!(pl.melds.length === 1 && pl.melds[0].type === 'kong' && pl.melds[0].tile === tile)) {
      bad.push('tile ' + tile + ' 加杠后副露类型错误');
    } else if (st.wall.length !== before - 1) {
      bad.push('tile ' + tile + ' 加杠后牌墙 ' + st.wall.length);
    } else if (pl.hand.length !== 11) {
      bad.push('tile ' + tile + ' 加杠后手牌 ' + pl.hand.length + '（应为 11）');
    } else {
      ok++;
    }
  });
  s.ok('至少 5 例加杠：碰升级为杠并补一张', ok >= 5, ok + ' 例');

  var neg = makeState([handWith(20, 0, 11), handWith(20, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)],
    [1, 2], { melds: [[{ type: 'pong', tile: 0, from: 1 }], [], [], []], afterDraw: true });
  var np = M.pending(neg);
  s.ok('手里没有第四张时不出现加杠选项', np && np.options.addkong.length === 0);
  bad.slice(0, 5).forEach(function (b) { s.ok('加杠用例', false, b); });
});

/* ------------------------------- 4. win detection matches HandEval exactly */

s.group('4. 胡牌判定：20 手已知结果 + 与 HandEval 完全一致', function () {
  var known = [
    ['基本胡-11122233344455万', arr([[0, 3], [1, 3], [2, 3], [3, 3], [4, 2]]), true],
    ['基本胡-123456789万+111筒+东东', arr([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 3], [27, 2]]), true],
    ['基本胡-123456789条+中中中+白白', arr([[18, 1], [19, 1], [20, 1], [21, 1], [22, 1], [23, 1], [24, 1], [25, 1], [26, 1], [31, 3], [33, 2]]), true],
    ['基本胡-111222333444筒+55筒', arr([[9, 3], [10, 3], [11, 3], [12, 3], [13, 2]]), true],
    ['基本胡-123234345456万+99万', arr([[0, 1], [1, 2], [2, 3], [3, 3], [4, 2], [5, 1], [8, 2]]), true],
    ['基本胡-123万456万789万+东东东+中中', arr([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [27, 3], [31, 2]]), true],
    ['七对-01到66各一对', arr([[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2]]), true],
    ['七对-22到88筒各一对', arr([[11, 2], [12, 2], [13, 2], [14, 2], [15, 2], [16, 2], [17, 2]]), true],
    ['七对-七种字牌各一对', arr([[27, 2], [28, 2], [29, 2], [30, 2], [31, 2], [32, 2], [33, 2]]), true],
    ['七对-四张相同算两对', arr([[0, 4], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2]]), true],
    ['七对-两组四张+三对', arr([[0, 4], [1, 4], [2, 2], [3, 2], [4, 2]]), true],
    ['十三幺-幺九字牌各一+重复一万', arr([[0, 2], [8, 1], [9, 1], [17, 1], [18, 1], [26, 1], [27, 1], [28, 1], [29, 1], [30, 1], [31, 1], [32, 1], [33, 1]]), true],
    ['十三幺-幺九字牌各一+重复中', arr([[0, 1], [8, 1], [9, 1], [17, 1], [18, 1], [26, 1], [27, 1], [28, 1], [29, 1], [30, 1], [31, 2], [32, 1], [33, 1]]), true],
    ['诈胡-只有 13 张', arr([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1], [9, 1], [10, 1], [11, 1], [12, 1]]), false],
    ['诈胡-七对里有一张单牌', arr([[0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 1], [7, 1]]), false],
    ['诈胡-十三幺缺白', arr([[0, 3], [8, 1], [9, 1], [17, 1], [18, 1], [26, 1], [27, 1], [28, 1], [29, 1], [30, 1], [31, 1], [32, 1]]), false],
    ['诈胡-四副面子无将', arr([[0, 3], [1, 3], [2, 3], [3, 3], [4, 1], [6, 1]]), false],
    ['诈胡-14 张散牌', arr([[0, 1], [2, 1], [4, 1], [6, 1], [8, 1], [10, 1], [12, 1], [14, 1], [16, 1], [18, 1], [20, 1], [22, 1], [24, 1], [26, 1]]), false],
    ['诈胡-顺子跨花色', arr([[7, 1], [8, 1], [9, 1], [10, 2], [11, 2], [12, 2], [13, 2], [14, 2], [15, 1]]), false],
    ['诈胡-将牌三张', arr([[0, 3], [1, 3], [2, 3], [3, 3], [4, 3]]), false]
  ];

  var mismatches = 0;
  known.forEach(function (row) {
    var label = row[0], c = row[1], want = row[2];
    var engine = HandEval.isWinningHand(c);
    var game = M.checkWinCounts(c, []);
    s.eq(label + ' / 引擎', engine, want);
    s.eq(label + ' / 游戏内一致', game, engine);
    if (game !== engine) mismatches++;
  });
  s.eq('20 手已知结果零分歧', mismatches, 0);

  // Fuzz: 400 random 14-tile count arrays, compare game vs shared engine.
  var rng = lib.mulberry32(20261109);
  var fuzzMismatch = 0, wins = 0;
  for (var n = 0; n < 400; n++) {
    var c = [];
    for (var i = 0; i < 34; i++) c.push(0);
    var left = 14;
    while (left > 0) {
      var k = Math.floor(rng() * 34);
      if (c[k] >= 4) continue;
      c[k]++; left--;
    }
    var e = HandEval.isWinningHand(c);
    var g = M.checkWinCounts(c, []);
    if (e) wins++;
    if (e !== g) fuzzMismatch++;
  }
  s.eq('400 手随机牌与 HandEval 零分歧', fuzzMismatch, 0);

  // 副露后的判定：杠按三张计，且七对不能靠副露成立。
  var melds = [{ type: 'pong', tile: 27, from: 1 }];
  var hand13 = arr([[27, 1], [28, 2], [29, 2], [30, 2], [31, 2], [32, 2]]);
  // 加上副露的 3 张东后是东×4、南..白各一对，引擎看成七对，但实际有副露。
  var merged = hand13.slice();
  merged[27] += 3;
  s.eq('共享引擎把这组计数判为七对', HandEval.isWinningHand(merged), true);
  s.eq('游戏内拒绝「有副露的七对」', M.checkWinCounts(hand13, melds), false);

  // 基本胡 + 副露：111万（碰）+ 123 456 789 万 + 10 10 筒，接 9 筒。
  var meldState = makeState(
    [handWith(9, 1, 14), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], handWith(20, 0, 13), handWith(20, 0, 13)],
    [2, 3, 4],
    { melds: [[], [{ type: 'pong', tile: 0, from: 1 }], [], []], turn: 0 }
  );
  var wr = M.apply(meldState, { type: 'discard', tile: 9 });
  s.ok('有副露时也能点炮胡：打 1 筒', wr.ok, wr.error || '');
  var wp = M.pending(meldState);
  s.ok('点炮方收到胡牌选项', !!(wp && wp.player === 1 && wp.options.hu));
  var hu = M.apply(meldState, { type: 'hu' });
  s.ok('点炮胡成功结算', hu.ok && meldState.over && meldState.result.type === 'win' &&
    meldState.result.winner === 1 && meldState.result.selfDraw === false && meldState.result.from === 0);

  // 自摸路径
  var selfWin = arr([[0, 3], [1, 3], [2, 3], [3, 3], [4, 2]]);
  var selfHand = [];
  for (i = 0; i < 34; i++) for (var j = 0; j < selfWin[i]; j++) selfHand.push(i);
  var selfState = makeState([selfHand, handWith(20, 1, 13), handWith(20, 0, 13), handWith(20, 0, 13)],
    [2, 3], { afterDraw: true, turn: 0 });
  var sp = M.pending(selfState);
  s.ok('自摸时出现胡牌选项', !!(sp && sp.options.hu));
  var sr = M.apply(selfState, { type: 'hu' });
  s.ok('自摸成功结算', sr.ok && selfState.over && selfState.result.selfDraw === true &&
    selfState.result.winner === 0);
});

/* ----------------------------------------------- 5. AI self-play, 50 games */

s.group('5. AI 自对弈 50 局：全部结束、0 非法操作', function () {
  var stats = { self: 0, discard: 0, draw: 0, illegal: 0, unfinished: 0 };
  var invariants = 0, levelsUsed = ['easy', 'medium', 'hard'];
  for (var g = 0; g < 50; g++) {
    var lv = [levelsUsed[g % 3], levelsUsed[(g + 1) % 3], levelsUsed[(g + 2) % 3], levelsUsed[g % 3]];
    var st = M.createGame({ seed: 2026 + g, dealer: g % 4, autoplay: true, aiLevels: lv });
    try {
      M.settle(st);
    } catch (e) {
      stats.illegal++;
      continue;
    }
    if (!st.over || !st.result) { stats.unfinished++; continue; }
    if (st.result.type === 'draw') stats.draw++;
    else if (st.result.selfDraw) stats.self++;
    else stats.discard++;

    // Invariants: 136 physical tiles, never more than 4 of a kind.
    var used = M.physicalUsed(st);
    var sum = 0, maxOk = true;
    for (var k = 0; k < 34; k++) {
      sum += used[k];
      if (used[k] > 4) maxOk = false;
    }
    if (sum + st.wall.length !== 136) invariants++;
    if (!maxOk) invariants++;
  }
  s.eq('50 局全部正常结束', stats.unfinished, 0);
  s.eq('0 非法操作', stats.illegal, 0);
  s.eq('50 局物理牌数守恒且单种不超 4 张', invariants, 0);
  s.eq('胡牌 + 流局 = 50', stats.self + stats.discard + stats.draw, 50);

  var decided = stats.self + stats.discard;
  var selfPct = decided ? (stats.self / decided * 100).toFixed(1) : '0.0';
  var drawPct = (stats.draw / 50 * 100).toFixed(1);
  var extra = '自摸 ' + stats.self + ' 局（' + selfPct + '% of wins）· 点炮 ' + stats.discard +
    ' 局 · 流局 ' + stats.draw + ' 局（' + drawPct + '%）· 非法 0';
  console.log('  自对弈统计: ' + extra);
  return extra;
});

/* ------------------------------------------- 6. page / integration guards */

s.group('6. 页面体积与规则页字数', function () {
  var gameBytes = fs.statSync(path.join(__dirname, 'index.html')).size;
  s.ok('游戏页 ≤ 120KB', gameBytes <= 120 * 1024, gameBytes + ' bytes');

  var rulesHtml = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  var text = rulesHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  var cjk = (text.match(/[一-鿿]/g) || []).length;
  s.ok('规则页中文 1800–2400 字', cjk >= 1800 && cjk <= 2400, cjk + ' 个汉字');

  s.ok('规则页含 Article JSON-LD', rulesHtml.indexOf('"@type": "Article"') >= 0);
  s.ok('规则页含 FAQPage JSON-LD', rulesHtml.indexOf('"@type": "FAQPage"') >= 0);
  var handAt = html.indexOf('/games/shared/hand-eval.js');
  var engineAt = html.indexOf('<script id="engine">');
  s.ok('游戏页先加载共享验牌引擎再加载内联引擎', handAt >= 0 && engineAt > handAt);
});

s.done();
