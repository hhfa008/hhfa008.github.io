'use strict';

// Unit tests for the Dou Dizhu engine embedded in index.html.
// Run: node games/doudizhu/test.js

var fs = require('fs');
var path = require('path');

// Page core delegates to globalThis.Shuffle when present; the browser loads
// /games/shared/shuffle.js before the core, so the test loads it too.
require('../shared/shuffle.js');

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
var a = html.indexOf('// __CORE_START__');
var b = html.indexOf('// __CORE_END__');
if (a < 0 || b < 0) throw new Error('core markers not found in index.html');
var core = html.slice(a + '// __CORE_START__'.length, b);
var DDZ = (0, eval)(core + '\n;DDZ');

var passed = 0, failed = 0;
var failures = [];
function ok(label, cond, detail) {
  if (cond) passed++;
  else { failed++; failures.push(label + (detail ? ' — ' + detail : '')); }
}
function group(name, fn) {
  var p0 = passed, f0 = failed;
  var extra = fn() || '';
  return { name: name, pass: passed - p0, fail: failed - f0, extra: extra };
}

/* 1. hand type detection: every type needs >=3 positives and >=2 negatives */
var positives = {
  single: [[3], [10], [17]],
  pair: [[3, 3], [15, 15], [14, 14]],
  triple: [[3, 3, 3], [13, 13, 13], [15, 15, 15]],
  triple_single: [[3, 3, 3, 4], [10, 10, 10, 15], [14, 14, 14, 17]],
  triple_pair: [[3, 3, 3, 4, 4], [9, 9, 9, 15, 15], [13, 13, 13, 14, 14]],
  straight: [[3, 4, 5, 6, 7], [10, 11, 12, 13, 14], [3, 4, 5, 6, 7, 8, 9]],
  straight_pair: [[3, 3, 4, 4, 5, 5], [10, 10, 11, 11, 12, 12, 13, 13], [5, 5, 6, 6, 7, 7]],
  plane: [[3, 3, 3, 4, 4, 4], [10, 10, 10, 11, 11, 11, 12, 12, 12], [7, 7, 7, 8, 8, 8]],
  plane_single: [[3, 3, 3, 4, 4, 4, 5, 6], [9, 9, 9, 10, 10, 10, 3, 15], [5, 5, 5, 6, 6, 6, 7, 7]],
  plane_pair: [[3, 3, 3, 4, 4, 4, 5, 5, 6, 6], [8, 8, 8, 9, 9, 9, 3, 3, 15, 15], [10, 10, 10, 11, 11, 11, 12, 12, 13, 13]],
  four_two_single: [[3, 3, 3, 3, 4, 5], [10, 10, 10, 10, 15, 17], [13, 13, 13, 13, 3, 3]],
  four_two_pair: [[3, 3, 3, 3, 4, 4, 5, 5], [9, 9, 9, 9, 10, 10, 15, 15], [14, 14, 14, 14, 3, 3, 4, 4]],
  bomb: [[3, 3, 3, 3], [15, 15, 15, 15], [12, 12, 12, 12]],
  rocket: [[16, 17]]
};
var negatives = {
  single: [[], [3, 4], [3, 3]],
  pair: [[3, 4], [16, 17], [3, 3, 3]],
  triple: [[3, 3, 4], [3, 4, 5], [3, 3, 3, 3]],
  triple_single: [[3, 3, 4, 4], [3, 3, 3, 3], [3, 3, 3, 4, 4]],
  triple_pair: [[3, 3, 3, 4, 5], [3, 3, 4, 4, 5], [3, 3, 3, 3, 4]],
  straight: [[13, 14, 15], [11, 12, 13, 14, 15], [3, 4, 5, 6], [3, 4, 5, 5, 6], [3, 4, 5, 6, 15]],
  straight_pair: [[3, 3, 4, 4], [13, 13, 14, 14, 15, 15], [3, 3, 4, 4, 5, 6]],
  plane: [[3, 3, 3, 4, 4], [14, 14, 14, 15, 15, 15], [3, 3, 3, 5, 5, 5]],
  plane_single: [[3, 3, 3, 4, 4, 4, 5], [3, 3, 3, 5, 5, 5, 6, 7], [14, 14, 14, 15, 15, 15, 3, 4]],
  plane_pair: [[3, 3, 3, 4, 4, 4, 5, 6], [14, 14, 14, 15, 15, 15, 3, 3, 4, 4], [3, 3, 3, 4, 4, 4, 5, 5, 6, 7]],
  four_two_single: [[3, 3, 3, 4, 5, 6], [3, 3, 3, 3, 4], [3, 3, 3, 3, 4, 4, 5]],
  four_two_pair: [[3, 3, 3, 3, 4, 4, 5], [3, 3, 3, 3, 4, 5, 6, 7], [3, 3, 3, 3, 4, 4, 4]],
  bomb: [[3, 3, 3, 4], [15, 15, 15], [3, 3, 4, 4]],
  rocket: [[16, 16], [16, 17, 3], [15, 15]]
};
var g1 = group('牌型判定', function () {
  Object.keys(positives).forEach(function (type) {
    positives[type].forEach(function (cards, i) {
      var d = DDZ.detect(cards);
      ok('positive ' + type + ' #' + (i + 1), d && d.type === type,
        'got ' + (d ? d.type : 'null') + ' for [' + cards + ']');
    });
    negatives[type].forEach(function (cards, i) {
      var d = DDZ.detect(cards);
      ok('negative ' + type + ' #' + (i + 1), !d || d.type !== type,
        'got ' + (d ? d.type : 'null') + ' for [' + cards + ']');
    });
  });
  return Object.keys(positives).length + ' 种牌型';
});

/* 2. comparison */
function D(c) { return DDZ.detect(c); }
var g2 = group('比较规则', function () {
  [
    ['single 5>4', D([5]), D([4]), true],
    ['pair JJ>TT', D([11, 11]), D([10, 10]), true],
    ['straight 45678>34567', D([4, 5, 6, 7, 8]), D([3, 4, 5, 6, 7]), true],
    ['triple KKK>QQQ', D([13, 13, 13]), D([12, 12, 12]), true],
    ['bomb 3333>straight', D([3, 3, 3, 3]), D([4, 5, 6, 7, 8]), true],
    ['bomb 3333>pair AA', D([3, 3, 3, 3]), D([14, 14]), true],
    ['bomb 2222>plane', D([15, 15, 15, 15]), D([3, 3, 3, 4, 4, 4]), true],
    ['rocket>bomb 2222', D([16, 17]), D([15, 15, 15, 15]), true],
    ['rocket>straight', D([16, 17]), D([10, 11, 12, 13, 14]), true],
    ['rocket>single', D([16, 17]), D([17]), true],
    ['pair vs single false', D([9, 9]), D([8]), false],
    ['straight vs straight_pair false', D([3, 4, 5, 6, 7]), D([3, 3, 4, 4, 5, 5]), false],
    ['triple_single vs triple_pair false', D([3, 3, 3, 4]), D([5, 5, 5, 6, 6]), false],
    ['plane vs plane_single false', D([3, 3, 3, 4, 4, 4]), D([5, 5, 5, 6, 6, 6, 7, 8]), false],
    ['bomb 4444>3333', D([4, 4, 4, 4]), D([3, 3, 3, 3]), true],
    ['bomb 2222>AAAA', D([15, 15, 15, 15]), D([14, 14, 14, 14]), true],
    ['bomb 5555>4444', D([5, 5, 5, 5]), D([4, 4, 4, 4]), true],
    ['straight 6 cards vs 5 false', D([4, 5, 6, 7, 8, 9]), D([3, 4, 5, 6, 7]), false],
    ['rocket vs rocket false', D([16, 17]), D([16, 17]), false],
    ['bomb vs rocket false', D([15, 15, 15, 15]), D([16, 17]), false]
  ].forEach(function (t) {
    ok('compare ' + t[0], DDZ.canBeat(t[1], t[2]) === t[3]);
  });
  return '同型 / 炸弹 / 王炸 / 不可比';
});

/* 3. dealing: 1000 shuffles */
var g3 = group('发牌', function () {
  var bad = 0, checked = 0;
  for (var i = 0; i < 1000; i++) {
    var d = DDZ.deal(Math.random);
    checked++;
    var all = d.hands[0].concat(d.hands[1], d.hands[2], d.bottom);
    var ids = all.map(function (c) { return c.id; });
    var uniq = {};
    ids.forEach(function (id) { uniq[id] = (uniq[id] || 0) + 1; });
    var good = d.hands[0].length === 17 && d.hands[1].length === 17 &&
      d.hands[2].length === 17 && d.bottom.length === 3 &&
      all.length === 54 && Object.keys(uniq).length === 54 &&
      ids.every(function (id) { return uniq[id] === 1; });
    if (!good) bad++;
  }
  ok('1000 deals: 17/17/17 + 3, 54 unique cards', bad === 0, bad + ' bad deals');
  return checked + ' 次发牌, 0 重复 0 缺失';
});

/* 4. AI self-play: 200 complete games, zero illegal plays */
var g4 = group('AI 合法性', function () {
  var rnd = DDZ.mulberry32(20261109);
  var games = 200, landlordWins = 0, peasantWins = 0;
  var illegalTotal = 0, unfinished = 0, turnSum = 0, redealSum = 0, finished = 0;
  for (var i = 0; i < games; i++) {
    var r = DDZ.autoPlay(rnd);
    if (!r.finished) { unfinished++; continue; }
    finished++;
    if (r.landlordWin) landlordWins++; else peasantWins++;
    illegalTotal += r.illegal;
    turnSum += r.turns;
    redealSum += r.redeals;
  }
  ok('200 games finished', unfinished === 0, unfinished + ' unfinished');
  ok('200 games zero illegal plays', illegalTotal === 0, illegalTotal + ' illegal');
  ok('200 games produced a winner', finished === games, finished + ' results');
  var pct = function (n) { return (n / games * 100).toFixed(1) + '%'; };
  return '地主 ' + landlordWins + ' 胜 (' + pct(landlordWins) + ') / 农民 ' +
    peasantWins + ' 胜 (' + pct(peasantWins) + '), 非法 ' + illegalTotal +
    ', 平均 ' + (turnSum / games).toFixed(1) + ' 手, 重发 ' + redealSum;
});

/* 5. hint: 200 random positions, suggestion legal and beating */
var g5 = group('提示功能', function () {
  var rnd = DDZ.mulberry32(777001);
  var checked = 0, noBeat = 0, bad = 0, attempts = 0, noBeatVerified = 0;
  while (checked < 200 && attempts < 4000) {
    attempts++;
    var d = DDZ.deal(rnd);
    var hand = d.hands[0];
    var last = DDZ.aiLead(d.hands[1]);
    if (!last) continue;
    var s = DDZ.suggest(hand, last);
    if (!s) {
      noBeat++;
      var alternatives = DDZ.findAllPlays(hand, last);
      if (alternatives.length === 0) noBeatVerified++;
      continue;
    }
    checked++;
    var det = DDZ.detect(s.cards);
    var owned = s.cards.every(function (c) { return hand.indexOf(c) >= 0; });
    var unique = new Set(s.cards.map(function (c) { return c.id; })).size === s.cards.length;
    if (!det || !owned || !unique || !DDZ.canBeat(det, last)) bad++;
  }
  ok('200 hinted positions: legal and beating', checked === 200 && bad === 0,
    checked + ' checked, ' + bad + ' bad');
  ok('positions without a beating play are genuinely unbeatable', noBeat === noBeatVerified,
    noBeat + ' no-beat, ' + noBeatVerified + ' verified');
  return checked + '/200 局面有解且全合法, ' + noBeat + ' 个无解局面已复核';
});

console.log('');
[g1, g2, g3, g4, g5].forEach(function (g) {
  var state = g.fail === 0 ? 'PASS' : 'FAIL';
  console.log('[' + state + '] ' + g.name + ': ' + g.pass + ' 项断言, ' + g.fail + ' 失败' +
    (g.extra ? ' — ' + g.extra : ''));
});
console.log('');
console.log('总计: ' + passed + ' 通过, ' + failed + ' 失败');
if (failed) {
  failures.slice(0, 40).forEach(function (f) { console.log('  FAIL: ' + f); });
  process.exit(1);
}
