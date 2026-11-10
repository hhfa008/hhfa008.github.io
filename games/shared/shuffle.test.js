'use strict';

/*
 * Statistical and contract tests for games/shared/shuffle.js.
 *
 * Run: node games/shared/shuffle.test.js
 *
 * The heavy tests draw their samples from a fixed seeded PRNG
 * (Shuffle.createRng(SEED), one generator advanced across all trials). Under
 * the null hypothesis a p-value is uniform on [0,1], so an unseeded sample
 * rejects a strict threshold by chance: `p > 0.001` fails about once per 1000
 * runs (observed in practice). A fixed seed makes the same statistic come out
 * of every run while keeping the same 200,000-shuffle sample and the same
 * strict thresholds — the assertions are regression checks, not coin flips.
 * The sample still runs the real Fisher-Yates / nextBelow code, including the
 * exact 32-bit rejection sampling; only the word source is deterministic.
 * The production CSPRNG path is exercised separately (group 5).
 *
 * Sample sizes are deliberately large enough that a biased shuffle would show
 * up:
 *   - 200,000 full shuffles for the 52x52 card/position contingency table
 *   - 100,000 full shuffles for permutation diversity
 */

var lib = require('../tests/lib.js');
var Shuffle = require('./shuffle.js');

var s = lib.suite('shared/shuffle');
var N = 52;

function orderedDeck() {
  var a = [];
  for (var i = 0; i < N; i++) a.push(i);
  return a;
}

function permKey(a) {
  var out = '';
  for (var i = 0; i < a.length; i++) out += String.fromCharCode(33 + a[i]);
  return out;
}

// Numerical Recipes erfc approximation, |error| < 1.2e-7.
// Good enough for a normal-approximation p-value over 2601 degrees of freedom.
function erfc(x) {
  var z = Math.abs(x);
  var t = 1 / (1 + 0.5 * z);
  var r = t * Math.exp(-z * z - 1.26551223 +
    t * (1.00002368 +
    t * (0.37409196 +
    t * (0.09678418 +
    t * (-0.18628806 +
    t * (0.27886807 +
    t * (-1.13520398 +
    t * (1.48851587 +
    t * (-0.82215223 +
    t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function upperTailP(chi2, df) {
  var z = (chi2 - df) / Math.sqrt(2 * df);
  return 0.5 * erfc(z / Math.SQRT2);
}

function pInterval(p) {
  if (p < 0.001) return '< 0.001';
  if (p < 0.01) return '[0.001, 0.01)';
  if (p < 0.05) return '[0.01, 0.05)';
  if (p < 0.5) return '[0.05, 0.5)';
  if (p < 0.95) return '[0.5, 0.95)';
  return '[0.95, 1]';
}

/* -------------------------------------------------------------------------- *
 * 1 + 2. Uniformity and first-card position bias (shared 200,000 shuffles)   *
 * -------------------------------------------------------------------------- */

var UNIFORM_TRIALS = 200000;
// Fixed seeds: deterministic samples, so the strict thresholds below cannot
// flake. Changing the shuffle algorithm changes these statistics, which is
// exactly what the assertions should catch.
var UNIFORM_SEED = 'shuffle/uniformity/200000/v1';
var DIVERSITY_SEED = 'shuffle/diversity/100000/v1';
var counts = new Int32Array(N * N); // counts[position * N + card]
var uniformStats = null;

function runUniformity() {
  var t0 = Date.now();
  var deck = orderedDeck();
  var rng = Shuffle.createRng(UNIFORM_SEED);
  for (var t = 0; t < UNIFORM_TRIALS; t++) {
    Shuffle.shuffleInPlace(deck, { rng: rng }); // fixed seed: reproducible sample
    for (var pos = 0; pos < N; pos++) counts[pos * N + deck[pos]]++;
  }
  var expected = UNIFORM_TRIALS / N;
  var chi2 = 0;
  var minCell = Infinity, maxCell = -Infinity, maxZ = 0;
  for (var i = 0; i < counts.length; i++) {
    var d = counts[i] - expected;
    chi2 += (d * d) / expected;
    if (counts[i] < minCell) minCell = counts[i];
    if (counts[i] > maxCell) maxCell = counts[i];
    var zi = Math.abs(d / Math.sqrt(expected * (1 - 1 / N)));
    if (zi > maxZ) maxZ = zi;
  }
  var df = (N - 1) * (N - 1);
  var p = upperTailP(chi2, df);
  var firstAce = counts[0 * N + 0]; // position 0, card index 0 (A♠)
  var bias = (firstAce - expected) / expected * 100;
  var biasZ = (firstAce - expected) / Math.sqrt(expected * (1 - 1 / N));
  uniformStats = {
    chi2: chi2, df: df, p: p, expected: expected,
    minCell: minCell, maxCell: maxCell, maxZ: maxZ,
    firstAce: firstAce, bias: bias, biasZ: biasZ,
    ms: Date.now() - t0
  };
  return uniformStats;
}

s.group('1. 均匀性：52 张 × 52 位置，200,000 次洗牌', function () {
  var st = runUniformity();
  console.log('    期望每格 ' + st.expected.toFixed(4) + '，实测范围 [' +
    st.minCell + ', ' + st.maxCell + ']，单格最大 |z| = ' + st.maxZ.toFixed(2));
  console.log('    χ² = ' + st.chi2.toFixed(2) + '，df = ' + st.df +
    '，z = ' + ((st.chi2 - st.df) / Math.sqrt(2 * st.df)).toFixed(3) +
    '，p ≈ ' + st.p.toFixed(4) + '（区间 ' + pInterval(st.p) + '）');
  s.ok('p 值未落入极端拒绝域（p > 0.001）', st.p > 0.001, 'p=' + st.p.toFixed(6));
  s.ok('χ² 在 df ± 6σ 内（σ=√(2df)=' + Math.sqrt(2 * st.df).toFixed(1) + '）',
    Math.abs(st.chi2 - st.df) < 6 * Math.sqrt(2 * st.df),
    'χ²=' + st.chi2.toFixed(2) + ', df=' + st.df);
  console.log('    用时 ' + st.ms + 'ms');
  return 'χ²=' + st.chi2.toFixed(1) + ', df=' + st.df + ', p≈' + st.p.toFixed(3);
});

s.group('2. 位置偏差：第一张是 A♠', function () {
  var st = uniformStats;
  // Same suit-major order shuffleDeck() uses: index 0 is A♠, index 51 is K♣.
  var labels = [];
  Shuffle.SUITS.forEach(function (suit) {
    Shuffle.RANKS.forEach(function (rank) { labels.push(rank + suit); });
  });
  s.eq('牌序索引 0 对应 A♠', labels[0], 'A♠');
  s.eq('牌序索引 51 对应 K♣', labels[51], 'K♣');
  var expected = st.expected;
  var sd = Math.sqrt(expected * (1 - 1 / N));
  console.log('    第一张为 ' + labels[0] + '：实际 ' + st.firstAce + ' 次，期望 ' + expected.toFixed(2) +
    '，偏差 ' + st.bias.toFixed(3) + '%，z = ' + st.biasZ.toFixed(3) +
    '（sd = ' + sd.toFixed(2) + '）');
  s.ok('偏差低于 5%', Math.abs(st.bias) < 5, st.bias.toFixed(3) + '%');
  s.ok('|z| < 4', Math.abs(st.biasZ) < 4, 'z=' + st.biasZ.toFixed(3));
  return st.firstAce + ' vs ' + expected.toFixed(1) + ' (' + st.bias.toFixed(2) + '%)';
});

/* -------------------------------------------------------------------------- *
 * 3. Permutation diversity                                                   *
 * -------------------------------------------------------------------------- */

s.group('3. 排列多样性：100,000 次洗牌的互异排列数', function () {
  var trials = 100000;
  var t0 = Date.now();
  var seen = new Set();
  var deck = orderedDeck();
  var rng = Shuffle.createRng(DIVERSITY_SEED); // fixed seed: reproducible sample
  for (var t = 0; t < trials; t++) {
    Shuffle.shuffleInPlace(deck, { rng: rng });
    seen.add(permKey(deck));
  }
  var unique = seen.size;
  var dupes = trials - unique;
  console.log('    互异排列 ' + unique + ' / ' + trials + '，重复 ' + dupes +
    ' 次（52! ≈ 8.07e67，理论碰撞期望 ≈ 0）');
  s.eq('100,000 次全部互异', unique, trials);
  s.ok('重复不超过 5 次', dupes <= 5, '重复 ' + dupes);
  return unique + '/100000 互异, ' + (Date.now() - t0) + 'ms';
});

/* -------------------------------------------------------------------------- *
 * 4. Seed reproducibility                                                    *
 * -------------------------------------------------------------------------- */

s.group('4. 种子可复现', function () {
  var base = orderedDeck();
  var a = Shuffle.shuffle(base, { seed: 'daily-2026-11-09' });
  var b = Shuffle.shuffle(base, { seed: 'daily-2026-11-09' });
  var c = Shuffle.shuffle(base, { seed: 'daily-2026-11-10' });
  s.eq('同 seed 两次结果完全一致', a, b);
  s.ok('不同 seed 结果不同', JSON.stringify(a) !== JSON.stringify(c));

  var r1 = Shuffle.createRng(123456789);
  var r2 = Shuffle.createRng(123456789);
  var r3 = Shuffle.createRng(987654321);
  var seq1 = [], seq2 = [], seq3 = [];
  for (var i = 0; i < 20; i++) { seq1.push(r1()); seq2.push(r2()); seq3.push(r3()); }
  s.eq('createRng 同 seed 序列一致', seq1, seq2);
  s.ok('createRng 不同 seed 序列不同', JSON.stringify(seq1) !== JSON.stringify(seq3));
  s.ok('序列落在 [0,1)', seq1.every(function (x) { return x >= 0 && x < 1; }));
  s.ok('序列不是常数', new Set(seq1).size > 15, '唯一值 ' + new Set(seq1).size);
  console.log('    示例 seed=123456789 前 5 个随机数: ' +
    seq1.slice(0, 5).map(function (x) { return x.toFixed(6); }).join(', '));
});

/* -------------------------------------------------------------------------- *
 * 5. Consistency: pure vs in-place, edge cases                               *
 * -------------------------------------------------------------------------- */

s.group('5. 一致性：shuffle 不改原数组 / shuffleInPlace 原地', function () {
  var orig = orderedDeck();
  var copy = orig.slice();
  var out = Shuffle.shuffle(orig, { seed: 7 });
  s.eq('shuffle 后原数组未变', orig, copy);
  s.ok('shuffle 返回新数组', out !== orig);

  var inplace = orderedDeck();
  var ref = inplace;
  var res = Shuffle.shuffleInPlace(inplace, { seed: 7 });
  s.ok('shuffleInPlace 返回同一引用', res === ref);
  s.eq('shuffleInPlace 长度不变', inplace.length, N);
  s.eq('同 seed 下 pure 与 in-place 结果一致', res, out);

  var empty = [];
  s.eq('空数组返回空数组', Shuffle.shuffle(empty, { seed: 1 }), []);
  s.eq('空数组原地长度 0', Shuffle.shuffleInPlace(empty, { seed: 1 }).length, 0);
  s.eq('单元素不变', Shuffle.shuffle([42], { seed: 1 }), [42]);
  var one = [42];
  s.ok('单元素原地返回同一引用', Shuffle.shuffleInPlace(one, { seed: 1 }) === one);

  var threw = 0;
  [null, undefined, 42, 'abc', {}].forEach(function (bad) {
    try { Shuffle.shuffle(bad); } catch (e) { if (e instanceof TypeError) threw++; }
  });
  s.eq('非数组抛 TypeError', threw, 5);
  var threw2 = 0;
  try { Shuffle.shuffleInPlace([1, 2], { rng: 'nope' }); } catch (e) { if (e instanceof TypeError) threw2++; }
  s.eq('opts.rng 非函数抛 TypeError', threw2, 1);

  s.ok('默认 CSPRNG 两次输出不同', Shuffle.createRng()() !== Shuffle.createRng()());
});

/* -------------------------------------------------------------------------- *
 * 6. Card integrity: exact multiset before/after                             *
 * -------------------------------------------------------------------------- */

s.group('6. 牌完整性：洗牌前后 multiset 完全一致', function () {
  var deck = Shuffle.shuffleDeck();
  s.eq('标准牌 52 张', deck.length, 52);
  s.eq('标准牌 id 互异', new Set(deck.map(function (c) { return c.id; })).size, 52);
  s.eq('四种花色各 13 张', Shuffle.SUITS.map(function (suit) {
    return deck.filter(function (c) { return c.suit === suit; }).length;
  }), [13, 13, 13, 13]);
  s.eq('每种点数各 4 张', Shuffle.RANKS.map(function (r) {
    return deck.filter(function (c) { return c.rank === r; }).length;
  }), [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);

  var withJokers = Shuffle.shuffleDeck({ jokers: true });
  s.eq('带双王 54 张', withJokers.length, 54);
  s.eq('双王各一张', withJokers.filter(function (c) { return c.joker; }).length, 2);
  s.ok('大小王 id 存在', withJokers.some(function (c) { return c.id === 'SJ'; }) &&
    withJokers.some(function (c) { return c.id === 'BJ'; }));
  s.eq('带王 id 互异', new Set(withJokers.map(function (c) { return c.id; })).size, 54);

  function multiset(cards) {
    var m = {};
    cards.forEach(function (c) { m[c.id] = (m[c.id] || 0) + 1; });
    return Object.keys(m).sort().map(function (k) { return k + ':' + m[k]; });
  }
  var before = multiset(deck);
  Shuffle.shuffleInPlace(deck);
  s.eq('洗牌后每张牌恰好出现一次', multiset(deck), before);
  s.eq('洗牌后仍 52 张', deck.length, 52);

  s.eq('shuffleDeck 同 seed 可复现',
    Shuffle.shuffleDeck({ seed: 'deck-seed' }),
    Shuffle.shuffleDeck({ seed: 'deck-seed' }));
});

/* -------------------------------------------------------------------------- *
 * 7. deal() contract                                                         *
 * -------------------------------------------------------------------------- */

s.group('7. deal 发牌与张数校验', function () {
  var deck = orderedDeck();
  var hands = Shuffle.deal(deck, 4, 5);
  s.eq('发出 4 手', hands.length, 4);
  s.eq('每手 5 张', hands.map(function (h) { return h.length; }), [5, 5, 5, 5]);
  var flat = [].concat.apply([], hands);
  s.eq('发出的 20 张互不重复', new Set(flat).size, 20);
  s.eq('deal 不修改牌堆', deck, orderedDeck());
  s.eq('发完 4 手 13 张', Shuffle.deal(deck, 4, 13).map(function (h) { return h.length; }), [13, 13, 13, 13]);
  s.eq('0 手返回空数组', Shuffle.deal(deck, 0, 5), []);
  s.eq('每手 0 张返回空手', Shuffle.deal(deck, 3, 0), [[], [], []]);

  var threw = 0;
  try { Shuffle.deal(deck, 5, 11); } catch (e) { if (e instanceof RangeError) threw++; }
  s.eq('张数不够抛 RangeError', threw, 1);
  threw = 0;
  try { Shuffle.deal(deck, 2.5, 5); } catch (e) { if (e instanceof RangeError) threw++; }
  try { Shuffle.deal(deck, 2, -1); } catch (e) { if (e instanceof RangeError) threw++; }
  s.eq('非法手数/张数抛 RangeError', threw, 2);
  threw = 0;
  try { Shuffle.deal('not-a-deck', 1, 1); } catch (e) { if (e instanceof TypeError) threw++; }
  s.eq('非数组牌堆抛 TypeError', threw, 1);
});

s.done();
