'use strict';

// Shared hand evaluator tests: Texas Hold'em + Mahjong win detection.
//
// Run directly:            node games/shared/hand-eval.test.js
// Included by the runner:  node games/tests/run-all.js
//
// The poker suite covers all ten categories, 7-choose-5 selection, full
// kicker ordering and a 100,000-hand exhaustive check against sampled
// alternative five-card combinations. Mahjong covers basic hands, seven
// pairs, thirteen orphans, false positives and per-tile wait enumeration.

var path = require('path');
var lib = require('../tests/lib.js');
var H = require('./hand-eval.js');

var s = lib.suite('shared/hand-eval');

/* ------------------------------ Poker helpers ----------------------------- */

function ev(str) { return H.evalPoker(H.cards(str)); }

function handKey(cs) {
  return cs.map(function (c) { return c.r + c.s; }).sort().join(' ');
}

function cat(label, str, want) {
  var h = ev(str);
  s.eq(label + ' — 牌型', h.rank, want);
  s.eq(label + ' — 名称', h.name, H.HAND_NAMES[want]);
  s.eq(label + ' — 取五张', h.best.length, 5);
}

function cmp(label, a, b, want) {
  s.eq(label, H.comparePoker(ev(a), ev(b)), want);
}

/* ----------------------------- Mahjong helpers ---------------------------- */

var HONOR = { 东: 27, 南: 28, 西: 29, 北: 30, 中: 31, 发: 32, 白: 33 };

// "123m 456p 789s 东东" -> 34-length count array.
function tiles(str) {
  var counts = new Array(34).fill(0);
  str.trim().split(/\s+/).forEach(function (tok) {
    var re = /(\d+)([mps])/g;
    var m;
    while ((m = re.exec(tok))) {
      var base = { m: 0, p: 9, s: 18 }[m[2]];
      for (var i = 0; i < m[1].length; i++) counts[base + Number(m[1][i]) - 1]++;
    }
    var rest = tok.replace(/(\d+)([mps])/g, '');
    for (var j = 0; j < rest.length; j++) {
      var t = HONOR[rest[j]];
      if (t == null) throw new Error('bad tile token: ' + tok);
      counts[t]++;
    }
  });
  return counts;
}

function sum(counts) {
  return counts.reduce(function (a, b) { return a + b; }, 0);
}

function win(label, str, pattern) {
  var r = H.checkWinningHand(tiles(str));
  s.eq(label + ' — 胡牌', r.winning, true);
  if (pattern) {
    s.ok(label + ' — 判定含' + pattern, r.patterns.indexOf(pattern) >= 0, r.patterns.join(','));
  }
}

function lose(label, str) {
  var r = H.checkWinningHand(tiles(str));
  s.eq(label + ' — 不胡', r.winning, false);
  s.ok(label + ' — 给出原因', typeof r.reason === 'string' && r.reason.length > 0, r.reason);
}

/* ================================ Poker =================================== */

s.group('扑克 1. 十种牌型（每种 ≥3 例）', function () {
  cat('皇家同花顺-黑桃', 'As Ks Qs Js Ts 2d 3c', 9);
  cat('皇家同花顺-红桃', 'Ah Kh Qh Jh Th 4s 4c', 9);
  cat('皇家同花顺-方块', 'Ad Kd Qd Jd Td 9s 9c', 9);

  cat('同花顺-9 高', '9h 8h 7h 6h 5h 2c 3d', 8);
  cat('同花顺-A 低', 'Ah 2h 3h 4h 5h Ks Qd', 8);
  cat('同花顺-K 高', 'Kc Qc Jc Tc 9c 2d 3h', 8);

  cat('四条-A', 'Ac Ad Ah As Kc 2d 3h', 7);
  cat('四条-7', '7c 7d 7h 7s Ac Kd 2h', 7);
  cat('四条-2', '2c 2d 2h 2s Ah Kd Qc', 7);

  cat('葫芦-K 带 7', 'Kc Kd Kh 7c 7d 2s 3h', 6);
  cat('葫芦-两个三条', 'Ac Ad Ah Kc Kd Kh 2s', 6);
  cat('葫芦-Q 带 A', 'Qc Qd Qh Ac Ad 2s 3h', 6);

  cat('同花-A 高', 'Ah Jh 8h 5h 2h Kc Qd', 5);
  cat('同花-9 高', '9d 7d 5d 3d 2d Ac Kh', 5);
  cat('同花-K 高', 'Kc Qc 9c 6c 3c As 2d', 5);

  cat('顺子-9 高', '9s 8d 7c 6h 5s Kc Qd', 4);
  cat('顺子-A 低', 'As 2d 3c 4h 5s Kd Qc', 4);
  cat('顺子-6 高', '2s 3d 4c 5h 6s As Kd', 4);

  cat('三条-Q', 'Qc Qd Qh 9s 4c 2d 3h', 3);
  cat('三条-5', '5c 5d 5h As Kd 2c 3h', 3);
  cat('三条-A', 'Ac Ad Ah 9s 4c 2d 3h', 3);

  cat('两对-AK', 'As Ad Kc Kh 7s 2c 3d', 2);
  cat('两对-KQ', 'Kc Kd Qc Qh 9s 2d 3h', 2);
  cat('两对-99 44', '9c 9d 4c 4h As 2d 3h', 2);

  cat('一对-J', 'Jh Js Ad 8c 3h 2s 4d', 1);
  cat('一对-A', 'Ac Ad 9h 8c 3h 2s 4d', 1);
  cat('一对-2', '2c 2d Ah 9c 7h 5s 4d', 1);

  cat('高牌-A', 'As Kd 9c 6h 3s 2d 4c', 0);
  cat('高牌-K', 'Kc Qd 9c 6h 3s 2d 4c', 0);
  cat('高牌-Q', 'Qc Jd 9c 6h 3s 2d 4c', 0);
});

s.group('扑克 2. 7 选 5：最强五张不是前五张', function () {
  function choose(label, seven, wantRank, mustInclude) {
    var cards = H.cards(seven);
    var best = H.best5of7(cards);
    var first5 = cards.slice(0, 5);
    var firstEval = H.evalPoker(first5);

    s.eq(label + ' — 牌型', best.eval.rank, wantRank);
    s.ok(label + ' — 不是前五张', handKey(best.cards) !== handKey(first5),
      'best=' + handKey(best.cards) + ' first5=' + handKey(first5));
    s.ok(label + ' — 强于前五张', H.comparePoker(best.eval, firstEval) > 0,
      best.eval.name + ' vs ' + firstEval.name);
    s.eq(label + ' — 恰取五张', best.cards.length, 5);
    s.ok(label + ' — 五张都来自原手牌', best.cards.every(function (c) {
      return cards.some(function (x) { return x.r === c.r && x.s === c.s; });
    }));
    if (mustInclude) {
      var key = handKey(best.cards);
      mustInclude.forEach(function (c) {
        s.ok(label + ' — 必含 ' + c, key.indexOf(c) >= 0, key);
      });
    }
  }

  choose('前五是高牌，后二补顺子', '2c 3d 4h 5s 9c 6d 7h', 4, ['6d', '7h']);
  choose('前五是高牌，后二补皇家同花顺', 'Ah Kh Qh 2c 3d Jh Th', 9, ['11h', '10h']);
  choose('前五是三条，后二补四条', '9c 9d 9h 2s 3c 9s Ac', 7, ['9s', '14c']);
  choose('前五是高牌，后二补两对', 'Kc 7d 2h 5s 9c Kd 7h', 2, ['13d', '7h']);
  choose('前五只有四张同花，后二补同花顺', '4h 5h 6h 7h 2c 8h 9h', 8, ['8h', '9h']);
  choose('前五是一对 A，后二补 2-6 顺子', 'As Ad 2c 3d 4h 5s 6c', 4, ['6c']);
  choose('前五是 Q 高，后二补 Q-J-T-9-8', 'Qc Jd Th 9s 2c 8d 7h', 4, ['8d']);
  choose('前五是三条 3，后二补 2-6 顺子', '3c 3d 3h 4s 5c 2d 6h', 4, ['2d', '6h']);
  choose('前五有四张红桃 A234，后二补 A2345 同花顺', 'Ah 2h 3h 4h Kc 5h Qd', 8, ['5h']);
  choose('前五是一对 7，后二补 7-J 顺子', '7c 7d 8h 9s Tc Jc 2d', 4, ['11c']);
  choose('前五 A 高，后二补 6 高顺子', 'Ac Kc 2d 3h 4s 5c 6d', 4, ['6d']);
  choose('前五高牌，后二补 6-T 同花顺', 'Ts 9s 8s 2c 3d 7s 6s', 8, ['7s', '6s']);
});

s.group('扑克 3. 踢脚完整比较（≥10 条）', function () {
  cmp('一对：A 踢脚 > K 踢脚',
    'Jh Js Ad 8c 3h 2s 4d', 'Jc Jd Kd 8h 3s 2c 4h', 1);
  cmp('一对：第二踢脚 K > Q',
    '9c 9d Ah Kc 5s 2d 3h', '9c 9d Ah Qc 4s 2d 3h', 1);
  cmp('一对：第三踢脚 5 > 4',
    '9c 9d Ah Kc 5s 2d 3h', '9c 9d Ah Kc 4s 2d 3h', 1);
  cmp('两对：大对 A > K',
    'As Ad 9c 9h 7s 2c 3d', 'Kc Kh Qd Qs Js 2c 3d', 1);
  cmp('两对：小对 K > Q',
    'As Ad Kc Kh 7s 2c 3d', 'Ac Ah Qd Qs 7h 2d 3c', 1);
  cmp('两对：踢脚 A > Q',
    'As Ad Kc Kh Ah 2c 3d', 'Ac Ah Kd Ks Qh 2d 3c', 1);
  cmp('两对：完全相同判平局',
    'As Ad Kc Kh 7s 2c 3d', 'Ac Ah Kd Ks 7h 2d 3c', 0);
  cmp('葫芦：三条 K > 三条 Q',
    'Kc Kd Kh 7c 7d 2s 3h', 'Qc Qd Qh Ac Ad 2s 3h', 1);
  cmp('葫芦：三条 K 带 7 > 带 2',
    'Kc Kd Kh 7c 7d 2s 3h', 'Ks Kd Kh 2c 2d 3s 4h', 1);
  cmp('同花：A J 8 5 4 > A J 8 5 3',
    'Ah Jh 8h 5h 4h Kc Qd', 'Ac Jc 8c 5c 3c Kd Qh', 1);
  cmp('同花：同点数不同花色平局',
    'Ah Jh 8h 5h 4h 2c 3d', 'As Js 8s 5s 4s 2d 3c', 0);
  cmp('顺子：9 高 > 8 高',
    '9s 8d 7c 6h 5s Kc Qd', '8s 7d 6c 5h 4s Kc Qd', 1);
  cmp('四条：踢脚 A > K',
    '7c 7d 7h 7s Ac Kd 2h', '7c 7d 7h 7s Kc Qd 2h', 1);
  cmp('三条：踢脚 9,4 > 9,3',
    'Qc Qd Qh 9s 4c', 'Qc Qd Qh 9s 3c', 1);
  cmp('高牌：逐张比较 K 高 > Q 高',
    'Kc Qd 9c 6h 3s 2d 4c', 'Qc Jd 9c 6h 3s 2d 4c', 1);
  cmp('高牌：完全相同（花色不同）平局',
    'As Kd 9c 6h 3s 2d 4c', 'Ah Kc 9d 6s 3h 2c 4h', 0);

  s.eq('两对完整踢脚数组', ev('As Ad Kc Kh 7s 2c 3d').tiebreak, [14, 13, 7]);
  s.eq('葫芦完整踢脚数组', ev('Ac Ad Ah Kc Kd Kh 2s').tiebreak, [14, 13]);
  s.eq('三条完整踢脚数组', ev('Qc Qd Qh 9s 4c 2d 3h').tiebreak, [12, 9, 4]);
  s.eq('comparePoker 可直接比较牌数组',
    H.comparePoker(H.cards('As Ks Qs Js Ts'), H.cards('9h 8h 7h 6h 5h')), 1);
});

s.group('扑克 4. 边界：A 低、同花顺对四条、四张同花', function () {
  s.eq('A2345 是顺子且高牌为 5', ev('As 2d 3c 4h 5s Kd Qc').tiebreak, [5]);
  s.eq('23456 是顺子且高牌为 6', ev('2s 3d 4c 5h 6s As Kd').tiebreak, [6]);
  s.ok('23456 > A2345', H.comparePoker(ev('2s 3d 4c 5h 6s As Kd'), ev('As 2d 3c 4h 5s Kd Qc')) > 0);
  s.ok('23456 > A2345（另一组边牌）',
    H.comparePoker(ev('2c 3d 4h 5s 6d Kc Qc'), ev('Ac 2s 3h 4d 5c Jd 9h')) > 0);

  s.ok('A2345 同花顺 > 四条 A',
    H.comparePoker(ev('Ah 2h 3h 4h 5h Ks Qd'), ev('Ac Ad Ah As Kc 2d 3h')) > 0);
  s.ok('K 高同花顺 > 四条 2',
    H.comparePoker(ev('Kc Qc Jc Tc 9c 2d 3h'), ev('2c 2d 2h 2s Ah Kd Qc')) > 0);
  s.eq('A2345 同花顺高牌为 5', ev('Ah 2h 3h 4h 5h Ks Qd').tiebreak, [5]);

  s.eq('5 张里只有四张同花不算同花', ev('Ah Jh 8h 5h Kc').rank, 0);
  s.eq('7 张里只有四张同花不算同花', ev('Ah Jh 8h 5h Kc Qd 2s').rank, 0);
  s.eq('7 张里五张同花才算同花', ev('Ah Jh 8h 5h 2h Kc Qd').rank, 5);

  s.eq('皇家同花顺 rank 9', ev('As Ks Qs Js Ts 2d 3c').rank, 9);
  s.ok('皇家同花顺 > 9 高同花顺',
    H.comparePoker(ev('As Ks Qs Js Ts 2d 3c'), ev('9h 8h 7h 6h 5h 2c 3d')) > 0);
  s.eq('六张连续取最大五张（3-7 顺子）', ev('2s 3d 4c 5h 6s 7d Kc').tiebreak, [7]);
});

s.group('扑克 5. 穷举 100,000 手 7 张牌', function () {
  var N = 100000;
  var rng = lib.mulberry32(20261109);
  var deck = [];
  H.SUITS.forEach(function (suit) {
    for (var r = 2; r <= 14; r++) deck.push({ r: r, s: suit });
  });

  // C(7,5) = 21 index combinations; skip the first, compare the other 20.
  var combos = [];
  (function walk(start, idx) {
    if (idx.length === 5) { combos.push(idx.slice()); return; }
    for (var i = start; i <= 6; i++) { idx.push(i); walk(i + 1, idx); idx.pop(); }
  })(0, []);
  var sampled = combos.slice(1);
  if (sampled.length !== 20) throw new Error('expected 20 sampled combos, got ' + sampled.length);

  var wrongBest = 0, violations = 0, badLen = 0, badSubset = 0, comparisons = 0;

  for (var n = 0; n < N; n++) {
    // Partial Fisher-Yates: first seven deck slots become the hand.
    for (var i = 0; i < 7; i++) {
      var j = i + Math.floor(rng() * (52 - i));
      var t = deck[i]; deck[i] = deck[j]; deck[j] = t;
    }
    var hand = deck.slice(0, 7);
    var best = H.best5of7(hand);

    if (H.comparePoker(best.eval, H.evalPoker(hand)) !== 0) wrongBest++;
    if (best.cards.length !== 5) badLen++;

    var pool = {};
    hand.forEach(function (c) { pool[c.r + c.s] = (pool[c.r + c.s] || 0) + 1; });
    var subsetOk = best.cards.every(function (c) {
      var k = c.r + c.s;
      if (!pool[k]) return false;
      pool[k]--;
      return true;
    });
    if (!subsetOk) badSubset++;

    for (var k = 0; k < sampled.length; k++) {
      var alt = sampled[k].map(function (x) { return hand[x]; });
      comparisons++;
      if (H.comparePoker(best.eval, H.evalPoker(alt)) < 0) {
        violations++;
        if (violations <= 3) {
          console.log('  violation: hand=' + handKey(hand) + ' best=' + handKey(best.cards) +
            ' alt=' + handKey(alt));
        }
      }
    }
  }

  s.eq('穷举完成 100,000 手', N, 100000);
  s.eq('best5of7 与 evalPoker 结果一致', wrongBest, 0);
  s.eq('最强五张不弱于抽样的 20 个其他组合', violations, 0);
  s.eq('比较次数 = 100,000 × 20', comparisons, 2000000);
  s.eq('最强结果恰好 5 张', badLen, 0);
  s.eq('最强五张来自原 7 张且不重复', badSubset, 0);
});

/* =============================== Mahjong ================================== */

s.group('麻将 6. 基本胡：4 面子 + 1 将（≥15 例）', function () {
  win('顺子×4 + 对子', '123m 456m 789m 123p 99p', '基本胡');
  win('刻子×4 + 对子', '111m 222m 333m 444m 55m', '基本胡');
  win('边张：12 听 3', '123m 456m 789s 12p 东东 3p', '基本胡');
  win('嵌张：13 听 2', '123m 456m 789s 13p 东东 2p', '基本胡');
  win('单钓：4 面子 + 单张听将', '123m 456m 789s 111p 东 东', '基本胡');
  win('多解：11122233344455m', '11122233344455m', '基本胡');
  win('清一色顺子 123456789m + 123p + 99s', '123456789m 123p 99s', '基本胡');
  win('重叠顺子 234 345 456 + 567p + 88s', '234m 345m 456m 567p 88s', '基本胡');
  win('刻子 + 顺子混合', '111m 123m 456m 456p 东东', '基本胡');
  win('万筒条各一副 + 万重复 + 将', '123m 123p 123s 123m 东东', '基本胡');
  win('222333444m = 234 三连 + 567p + 99s', '222333444m 567p 99s', '基本胡');
  win('234m 234p 234s + 567m + 东东', '234m 234p 234s 567m 东东', '基本胡');
  win('123 345 567 789m + 11p', '123m 345m 567m 789m 11p', '基本胡');
  win('万顺子 + 筒顺子 + 55p', '123m 456m 789m 234p 55p', '基本胡');
  win('234 567m + 234 567s + 东东', '234m 567m 234p 567s 东东', '基本胡');
  win('四组重叠顺子 123 234 345 456 + 77p', '123m 234m 345m 456m 77p', '基本胡');
  win('111 222 333m + 456p + 77s', '111m 222m 333m 456p 77s', '基本胡');
  win('123m 456p 789s 111s + 22m', '123m 456p 789s 111s 22m', '基本胡');
});

s.group('麻将 7. 七对（≥5 例）', function () {
  win('七对：七种不同牌', '11m 22m 33m 44m 55p 66p 77s', '七对');
  win('七对：含字牌对', '11m 22m 33m 44m 55p 66p 东东', '七对');
  win('七对：四张相同算两对', '1111m 22m 33p 44p 55s 66s', '七对');
  win('七对：两组四张 + 三对', '1111m 2222m 33m 44m 55m', '七对');
  win('七对：风牌四对 + 数牌三对', '11m 22p 33s 东东 南南 西西 北北', '七对');
  win('七对：三组四张 + 一对', '1111m 2222m 3333m 44m', '七对');
});

s.group('麻将 8. 十三幺（≥3 例）', function () {
  win('十三幺：重复东', '19m 19p 19s 东南西北中发白 东', '十三幺');
  win('十三幺：重复白', '19m 19p 19s 东南西北中发 白白', '十三幺');
  win('十三幺：重复 1 万', '11m 9m 1p 9p 1s 9s 东南西北中发白', '十三幺');
  lose('十三幺缺白（拿东当将）', '19m 19p 19s 东南西北中发 东东');
  lose('十三幺混入 5 万', '19m 19p 19s 东南西北中发白 5m');
});

s.group('麻将 9. 不听 / 诈胡 / 输入校验（≥10 例）', function () {
  lose('三副面子无将', '123m 456m 789m 123p 9p 东');
  lose('缺一张成面子', '123m 456m 789m 12p 东东 北');
  lose('四个刻子无将', '111m 222m 333m 444m 5m 9p');
  lose('两对拆不开', '123m 456m 789m 123p 34p');
  lose('六对 + 两张单牌', '11m 22m 33m 44m 55p 66p 7s 8s');
  lose('奇数张太多（不是七对）', '1111m 222m 33m 44m 55m 7m');
  lose('三对子但无四副面子', '123m 456m 789m 11p 22s 东');
  lose('缺一对的散牌', '12m 45m 78m 12p 45p 78s 东北');
  lose('面子数量不足', '123m 123m 123m 12p 34s 东');
  lose('混入单张字牌', '111222333444m 5m 9s');

  var thirteen = tiles('123m 456m 789m 123p 99p');
  thirteen[0]--; // 13 tiles
  var r13 = H.checkWinningHand(thirteen);
  s.eq('13 张不能直接判胡', r13.winning, false);
  s.ok('13 张给出张数原因', /14/.test(r13.reason), r13.reason);
  s.eq('isWinningHand 同步返回 false', H.isWinningHand(thirteen), false);
  s.ok('isWinningHand.lastReason 带原因', /14/.test(H.isWinningHand.lastReason), H.isWinningHand.lastReason);

  var fifteen = tiles('123m 456m 789m 123p 99p');
  fifteen[0]++;
  var r15 = H.checkWinningHand(fifteen);
  s.eq('15 张不能判胡', r15.winning, false);
  s.ok('15 张给出张数原因', /14/.test(r15.reason), r15.reason);

  var five = new Array(34).fill(0);
  five[0] = 5;
  var r5 = H.checkWinningHand(five);
  s.eq('同一张牌 5 张判非法', r5.winning, false);
  s.ok('超出 0–4 给出原因', /0.4/.test(r5.reason), r5.reason);

  var badLen = H.checkWinningHand([1, 2, 3]);
  s.eq('非 34 长度判非法', badLen.winning, false);
  s.ok('非 34 长度给出原因', /34/.test(badLen.reason), badLen.reason);
});

s.group('麻将 10. 20 手 13 张牌逐张枚举 34 种听牌', function () {
  var cases = [
    { hand: '123m 456m 789m 123p 9p', waits: [17] },
    { hand: '123m 456m 789s 12p 东东', waits: [11] },
    { hand: '123m 456m 789s 13p 东东', waits: [10] },
    { hand: '123m 456m 789s 111p 东', waits: [27] },
    { hand: '1112223334445m', waits: [1, 2, 3, 4, 5] },
    { hand: '11m 22m 33m 44m 55p 66p 7s', waits: [24] },
    { hand: '1111m 22m 33p 44p 55s 6s', waits: [23] },
    { hand: '19m 19p 19s 东南西北中发白', waits: [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33] },
    { hand: '11m 9m 1p 9p 1s 9s 东南西北中发', waits: [33] },
    { hand: '123m 456m 789m 234p 5p', waits: [10, 13] },
    { hand: '123m 123p 123s 123m 东', waits: [27] },
    { hand: '123m 456m 789m 1p 4p 7p 东', waits: [] },
    { hand: '1m 4m 7m 2p 5p 8p 3s 6s 9s 东南西北', waits: [] },
    { hand: '123m 456m 789m 11p 99p', waits: [9, 17] },
    { hand: '111m 222m 333m 444m 5m', waits: [1, 2, 3, 4, 5] },
    { hand: '234m 345m 456m 567p 8s', waits: [25] },
    { hand: '11m 22p 33s 东东 南南 西西 北', waits: [30] },
    { hand: '123m 234m 345m 456m 7p', waits: [15] },
    { hand: '123m 456p 789s 111m 2p', waits: [10] },
    { hand: '123456789m 东东东 7p', waits: [15] }
  ];

  if (cases.length !== 20) throw new Error('expected 20 mahjong cases, got ' + cases.length);

  cases.forEach(function (c) {
    var counts = tiles(c.hand);
    s.eq(c.hand + ' — 13 张', sum(counts), 13);

    var got = H.winningTiles(counts);
    s.eq(c.hand + ' — 听牌', got, c.waits);

    // Enumerate all 34 draws and cross-check against isWinningHand.
    var mismatches = [];
    var illegal = [];
    for (var t = 0; t < 34; t++) {
      var canDraw = counts[t] < 4;
      if (c.waits.indexOf(t) >= 0 && !canDraw) illegal.push(H.tileName(t));
      var actual = false;
      if (canDraw) {
        counts[t]++;
        actual = H.isWinningHand(counts);
        counts[t]--;
      }
      var expected = c.waits.indexOf(t) >= 0;
      if (actual !== expected) mismatches.push(H.tileName(t) + (actual ? ' 应不听却听' : ' 应听却不听'));
    }
    s.eq(c.hand + ' — 34 张逐一枚举一致', mismatches, []);
    s.eq(c.hand + ' — 没有第 5 张的非法听牌', illegal, []);
  });
});

s.done();
