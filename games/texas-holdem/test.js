'use strict';

// Texas Hold'em test suite.
// The rules engine is the <script id="engine"> block; every assertion runs
// against the same code the browser runs.

var fs = require('fs');
var path = require('path');
var lib = require('../tests/lib.js');
var s = lib.suite('texas-holdem');

var html = lib.page(__dirname);
var P = lib.evalScript(html, 'engine', 'globalThis.Poker');

function ev(str) { return P.evaluate(P.cards(str)); }
function cat(label, str, want) {
  var h = ev(str);
  s.eq(label, h.cat, want);
  s.eq(label + ' 取五张', h.best.length, 5);
}
function fresh(seed, stacks) {
  var players = (stacks || [1000, 1000, 1000, 1000]).map(function (c, i) {
    return { name: 'P' + i, chips: c };
  });
  var st = P.createTable({ players: players, seed: seed || 1 });
  P.startHand(st);
  return st;
}
function driveTo(st, street) {
  var guard = 0;
  while (st.street !== street && st.street !== 'complete' && guard++ < 80) {
    var seat = st.toAct;
    if (seat == null) break;
    var L = P.legalActions(st, seat);
    if (!L) break;
    var act = L.canCheck ? { type: 'check' } : { type: 'call' };
    var r = P.applyAction(st, seat, act);
    if (!r.ok) throw new Error('driveTo failed: ' + r.error);
  }
  return st;
}
function word(codes) { return String.fromCharCode.apply(null, codes); }
function decodeEntities(str) {
  return str.replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

s.group('1. 牌型判定：十种牌型各 3 个正例', function () {
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

s.group('2. 牌型边界', function () {
  s.eq('A2345 是顺子且高牌为 5', ev('As 2d 3c 4h 5s Kd Qc').score.join(','), '4,5');
  s.eq('A2345 不被误判为 6 高', ev('2s 3d 4c 5h 6s As Kd').score.join(','), '4,6');
  s.eq('A2345 同花顺是 5 高同花顺', ev('Ah 2h 3h 4h 5h Ks Qd').score.join(','), '8,5');
  s.ok('同花顺大于四条', P.compare(ev('Ah 2h 3h 4h 5h Ks Qd'), ev('Ac Ad Ah As Kc 2d 3h')) > 0);
  s.ok('葫芦大于同花', P.compare(ev('Kc Kd Kh 7c 7d 2s 3h'), ev('Ah Jh 8h 5h 2h Kc Qd')) > 0);
  s.eq('两个三条取大的做葫芦三条', ev('Ac Ad Ah Kc Kd Kh 2s').score.join(','), '6,14,13');
  s.eq('四张同花不算同花', ev('Ah Jh 8h 5h Kc Qd 2s').cat, 0);
  s.eq('六张连续取最大五张', ev('2s 3d 4c 5h 6s 7d Kc').score.join(','), '4,7');
  s.ok('6 高顺子大于 A2345', P.compare(ev('2s 3d 4c 5h 6s As Kd'), ev('As 2d 3c 4h 5s Kd Qc')) > 0);
  s.eq('公共牌皇家同花顺对所有人相同', P.compare(ev('2c 3d As Ks Qs Js Ts'), ev('4c 5d As Ks Qs Js Ts')), 0);
});

s.group('3. 比大小：同牌型与踢脚', function () {
  s.ok('一对：A 踢脚大于 K 踢脚',
    P.compare(ev('Jh Js Ad 8c 3h 2s 4d'), ev('Jc Jd Kd 8h 3s 2c 4h')) > 0);
  s.ok('两对：踢脚 A 大于 Q',
    P.compare(ev('As Ad Kc Kh Ah 2c 3d'), ev('Ac Ah Kd Ks Qh 2d 3c')) > 0);
  s.ok('两对：第二对 K 大于 Q',
    P.compare(ev('As Ad Kc Kh 7s 2c 3d'), ev('Ac Ah Qd Qs 7h 2d 3c')) > 0);
  s.ok('同花：A J 8 5 2 大于 A J 8 5 3',
    P.compare(ev('Ah Jh 8h 5h 4h Kc Qd'), ev('Ac Jc 8c 5c 3c Kd Qh')) > 0);
  s.ok('顺子：9 高大于 8 高',
    P.compare(ev('9s 8d 7c 6h 5s Kc Qd'), ev('8s 7d 6c 5h 4s Kc Qd')) > 0);
  s.ok('葫芦：三条 K 大于三条 Q',
    P.compare(ev('Kc Kd Kh 7c 7d 2s 3h'), ev('Qc Qd Qh Ac Ad 2s 3h')) > 0);
  s.ok('四条：踢脚 A 大于 K',
    P.compare(ev('7c 7d 7h 7s Ac Kd 2h'), ev('7c 7d 7h 7s Kc Qd 2h')) > 0);
  s.ok('高牌逐张比较：K 高大于 Q 高',
    P.compare(ev('Kc Qd 9c 6h 3s 2d 4c'), ev('Qc Jd 9c 6h 3s 2d 4c')) > 0);
  s.eq('完全相同牌型判平局',
    P.compare(ev('As Kd 9c 6h 3s 2d 4c'), ev('Ah Kc 9d 6s 3h 2c 4h')), 0);
  s.ok('一对 J 大于一对 10',
    P.compare(ev('Jh Js Ad 8c 3h 2s 4d'), ev('Tc Td Ad 8h 3s 2c 4h')) > 0);
});

s.group('4. 下注合法性', function () {
  var st = fresh(11);
  var seat = st.toAct;
  var r = P.applyAction(st, seat, { type: 'raise', to: 30 });
  s.ok('翻牌前加注到 30 被拒（最小 40）', !r.ok && r.error === 'below-min-raise', r.error);
  r = P.applyAction(st, seat, { type: 'raise', to: 40 });
  s.ok('翻牌前加注到 40 合法', r.ok, r.error);
  var next = st.toAct;
  r = P.applyAction(st, next, { type: 'raise', to: 50 });
  s.ok('加注到 50 被拒（新最小 60）', !r.ok && r.error === 'below-min-raise', r.error);

  var st2 = fresh(12);
  var seat2 = st2.toAct;
  r = P.applyAction(st2, seat2, { type: 'check' });
  s.ok('面对大盲下注不能过牌', !r.ok && r.error === 'cannot-check', r.error);

  var st3 = driveTo(fresh(13), 'flop');
  var a3 = st3.toAct;
  r = P.applyAction(st3, a3, { type: 'call' });
  s.ok('无人下注时跟注被拒', !r.ok && r.error === 'nothing-to-call', r.error);
  r = P.applyAction(st3, a3, { type: 'raise', to: 10 });
  s.ok('翻牌下注 10 被拒（最小 20）', !r.ok && r.error === 'below-min-raise', r.error);
  r = P.applyAction(st3, a3, { type: 'raise', to: 20 });
  s.ok('翻牌下注 20 合法', r.ok, r.error);
  var b3 = st3.toAct;
  r = P.applyAction(st3, b3, { type: 'check' });
  s.ok('翻牌面对下注不能过牌', !r.ok && r.error === 'cannot-check', r.error);
  r = P.applyAction(st3, b3, { type: 'raise', to: 30 });
  s.ok('翻牌加注到 30 被拒（最小 40）', !r.ok && r.error === 'below-min-raise', r.error);

  var st4 = fresh(14);
  var seat4 = st4.toAct;
  st4.players[seat4].chips = 10;
  var L4 = P.legalActions(st4, seat4);
  s.ok('筹码不足以跟注时不能再加注', !L4.canRaise && L4.callAmount === 10, JSON.stringify(L4));
  r = P.applyAction(st4, seat4, { type: 'allin' });
  s.ok('筹码不足时可以全下跟注', r.ok && st4.players[seat4].allIn, r.error);

  var st5 = fresh(15);
  var first = st5.toAct;
  r = P.applyAction(st5, first, { type: 'call' });
  s.ok('短筹码测试：先跟注', r.ok, r.error);
  var shortSeat = st5.toAct;
  st5.players[shortSeat].chips = 30 - st5.players[shortSeat].bet;
  var L5 = P.legalActions(st5, shortSeat);
  s.ok('短筹码全下额低于最小加注', L5.minRaiseTo === 30 && L5.maxRaiseTo === 30, JSON.stringify(L5));
  r = P.applyAction(st5, shortSeat, { type: 'raise', to: 30 });
  s.ok('不足最小加注的全下被允许', r.ok && st5.players[shortSeat].allIn, r.error);
  s.ok('短全下不更新最小加注额', st5.minRaise === 20, String(st5.minRaise));
  while (st5.toAct !== first && st5.toAct != null && st5.street !== 'complete') {
    var mid = st5.toAct;
    var Lmid = P.legalActions(st5, mid);
    P.applyAction(st5, mid, Lmid.canCheck ? { type: 'check' } : { type: 'call' });
  }
  if (st5.toAct === first) {
    var L6 = P.legalActions(st5, first);
    s.ok('短全下后已行动玩家不能再加注', L6.canRaise === false, JSON.stringify(L6));
    r = P.applyAction(st5, first, { type: 'raise', to: 60 });
    s.ok('短全下后再次加注被拒', !r.ok && r.error === 'cannot-raise', r.error);
  }

  var st6 = driveTo(fresh(16), 'flop');
  var bettor = st6.toAct;
  st6.players[bettor].chips = 15;
  var L7 = P.legalActions(st6, bettor);
  s.ok('翻牌短筹码全下可下注', L7.canRaise && L7.maxRaiseTo === 15, JSON.stringify(L7));
  r = P.applyAction(st6, bettor, { type: 'allin' });
  s.ok('翻牌不足大盲的全下被允许', r.ok && st6.players[bettor].allIn, r.error);

  var st7 = driveTo(fresh(17), 'turn');
  var riverBettor = st7.toAct;
  r = P.applyAction(st7, riverBettor, { type: 'raise', to: 20 });
  s.ok('转牌下注 20 合法', r.ok, r.error);
  var riverCaller = st7.toAct;
  P.applyAction(st7, riverCaller, { type: 'call' });
  while (st7.street === 'turn' && st7.toAct != null) {
    var sk = st7.toAct;
    var Lk = P.legalActions(st7, sk);
    P.applyAction(st7, sk, Lk.canCheck ? { type: 'check' } : { type: 'call' });
  }
  if (st7.street === 'river') {
    var rb = st7.toAct;
    P.applyAction(st7, rb, { type: 'raise', to: 20 });
    var rc = st7.toAct;
    r = P.applyAction(st7, rc, { type: 'check' });
    s.ok('河牌面对下注不能过牌', !r.ok && r.error === 'cannot-check', r.error);
  }
});

s.group('5. 边池与分池', function () {
  var board = P.cards('2c 7d 9h 4d 3s');
  function pl(seat, hole, contributed, folded) {
    return { seat: seat, hole: P.cards(hole), contributed: contributed, folded: !!folded };
  }

  var one = P.payout([
    pl(0, 'Ah As', 100), pl(1, 'Kc Kd', 100), pl(2, 'Qc Qd', 300), pl(3, 'Jc Jd', 300)
  ], board, 0);
  s.eq('1 人全下：主池 400', one.pots[0].amount, 400);
  s.eq('1 人全下：边池 400', one.pots[1].amount, 400);
  s.eq('1 人全下：主池有 A/B/C/D 四人资格', one.pots[0].eligible.join(','), '0,1,2,3');
  s.eq('1 人全下：边池只有 C/D 资格', one.pots[1].eligible.join(','), '2,3');
  s.eq('1 人全下：AA 拿主池', one.awards[0], 400);
  s.eq('1 人全下：QQ 拿边池', one.awards[2], 400);
  s.eq('1 人全下：总派发等于总投入', one.awards[0] + one.awards[1] + one.awards[2] + one.awards[3], 800);

  var two = P.payout([
    pl(0, 'Ah As', 100), pl(1, 'Kc Kd', 250), pl(2, 'Qc Qd', 600), pl(3, 'Jc Jd', 600)
  ], board, 0);
  s.eq('2 人全下：主池 400', two.pots[0].amount, 400);
  s.eq('2 人全下：边池一 450', two.pots[1].amount, 450);
  s.eq('2 人全下：边池二 700', two.pots[2].amount, 700);
  s.eq('2 人全下：AA 拿主池', two.awards[0], 400);
  s.eq('2 人全下：KK 拿边池一', two.awards[1], 450);
  s.eq('2 人全下：QQ 拿边池二', two.awards[2], 700);
  s.eq('2 人全下：总派发 1550', two.awards[0] + two.awards[1] + two.awards[2] + two.awards[3], 1550);

  var folded = P.payout([
    pl(0, 'Ah As', 100), pl(1, 'Kc Kd', 100), pl(2, 'Qc Qd', 300), pl(3, '2h 4c', 50, true)
  ], board, 0);
  s.eq('弃牌者的筹码进入主池', folded.pots[0].amount, 350);
  s.eq('弃牌者没有资格分池', folded.pots[0].eligible.indexOf(3), -1);
  s.eq('弃牌者分不到钱', folded.awards[3], 0);
  s.eq('弃牌者投入仍被计入派发', folded.awards[0] + folded.awards[1] + folded.awards[2] + folded.awards[3], 550);

  var royal = P.cards('As Ks Qs Js Ts');
  var tie = P.payout([
    pl(0, '2c 3d', 100), pl(1, '4c 5d', 100), pl(2, '6c 7d', 100), pl(3, '8c 9d', 0, true)
  ], royal, 0);
  s.eq('公共牌皇家同花顺：三家平局', tie.pots[0].winners.join(','), '0,1,2');
  s.eq('平局：每人 100', tie.awards[0] + ',' + tie.awards[1] + ',' + tie.awards[2], '100,100,100');

  var odd = P.payout([
    pl(0, '2c 3d', 33), pl(1, '4c 5d', 33), pl(2, '6c 7d', 33), pl(3, '8c 9d', 1, true)
  ], royal, 0);
  s.eq('平局除不尽：多余筹码给庄家左手第一位赢家', odd.awards[1], 34);
  s.eq('另外两位各拿 33', odd.awards[0] + ',' + odd.awards[2], '33,33');

  var st = P.createTable({ players: [{ name: 'A', chips: 120 }, { name: 'B', chips: 800 }, { name: 'C', chips: 800 }, { name: 'D', chips: 800 }], seed: 31 });
  P.startHand(st);
  var before = st.players.reduce(function (a, p) { return a + p.chips + p.contributed; }, 0);
  var guard = 0;
  while (st.street !== 'complete' && guard++ < 300) {
    var seat = st.toAct;
    if (seat == null) break;
    var a = P.aiAction(st, seat, 'hard', st.rng);
    var r = P.applyAction(st, seat, a);
    if (!r.ok) throw new Error('AI illegal in side-pot hand: ' + r.error);
  }
  var after = st.players.reduce(function (a, p) { return a + p.chips; }, 0);
  s.eq('真实牌局：筹码守恒', after, before);
  var contrib = st.players.reduce(function (a, p) { return a + p.contributed; }, 0);
  var potsSum = (st.result.pots || []).reduce(function (a, pot) { return a + pot.amount; }, 0);
  s.eq('真实牌局：池子总额等于投入总额', potsSum, contrib);
});

s.group('6. AI 自对弈 100 手', function () {
  var hard = P.runSelfPlay({ hands: 100, seed: 42, levels: ['hard', 'easy', 'easy', 'easy'] });
  var medium = P.runSelfPlay({ hands: 100, seed: 42, levels: ['medium', 'easy', 'easy', 'easy'] });
  var easy = P.runSelfPlay({ hands: 100, seed: 42, levels: ['easy', 'easy', 'easy', 'easy'] });
  s.eq('较难组 100 手完成', hard.hands, 100);
  s.eq('中等组 100 手完成', medium.hands, 100);
  s.eq('简单组 100 手完成', easy.hands, 100);
  s.ok('较难组 0 非法动作', hard.illegal === 0, String(hard.illegal) + ' ' + JSON.stringify(hard.errors.slice(0, 2)));
  s.ok('中等组 0 非法动作', medium.illegal === 0, String(medium.illegal));
  s.ok('简单组 0 非法动作', easy.illegal === 0, String(easy.illegal));
  s.ok('每手都有行动', hard.actions > 100 && medium.actions > 100 && easy.actions > 100,
    hard.actions + '/' + medium.actions + '/' + easy.actions);

  var hardWins = hard.stats[0].wins;
  var mediumWins = medium.stats[0].wins;
  var easyWins = easy.stats[0].wins;
  var easyAvg = (hard.stats[1].wins + hard.stats[2].wins + hard.stats[3].wins) / 3;
  s.ok('较难胜率明显高于简单（同种子对照）', hardWins >= easyWins + 10,
    '较难 ' + hardWins + '% vs 简单 ' + easyWins + '%');
  s.ok('较难胜率高于同桌简单 AI 平均值', hardWins > easyAvg + 5,
    '较难 ' + hardWins + '% vs 简单均值 ' + easyAvg.toFixed(1) + '%');
  s.ok('较难胜率高于中等', hardWins > mediumWins,
    '较难 ' + hardWins + '% vs 中等 ' + mediumWins + '%');
  s.ok('每组筹码净变化守恒（四人合计为 0）', hard.stats.reduce(function (a, x) { return a + x.net; }, 0) === 0);
  return '较难 ' + hardWins + '% / 中等 ' + mediumWins + '% / 简单 ' + easyWins +
    '%，同种子简单均值 ' + easyAvg.toFixed(1) + '% · 非法动作 0';
});

s.group('7. 合规：纯虚拟筹码', function () {
  var forbidden = [
    [20805, 20540], [25552, 29616], [20817, 25442], [30495, 38065],
    [20154, 27665, 24065], [32654, 20803], [29616, 37329], [20080, 20837]
  ].map(word);
  var game = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  var rules = fs.readFileSync(path.join(__dirname, 'rules.html'), 'utf8');
  forbidden.forEach(function (w) {
    s.ok('游戏页源码不含「' + w + '」', game.indexOf(w) < 0);
    s.ok('规则页源码不含「' + w + '」', rules.indexOf(w) < 0);
  });
  var payWords = word([20805, 20540]) + '|' + word([25552, 29616]);
  s.ok('游戏页没有支付类按钮', !new RegExp('type="button"[^>]*>(?:[^<]*)(?:' + payWords + ')').test(game));
  var expected = '本游戏使用虚拟筹码，不涉及真实货币、不可' + word([20817, 25442]) +
    '、不提供任何' + word([20805, 20540]) + '。';
  s.ok('游戏页显著位置有完整合规声明', decodeEntities(game).indexOf(expected) >= 0);
  s.ok('规则页顶部有完整合规声明', decodeEntities(rules).indexOf(expected) >= 0);
  s.ok('游戏页使用「起始筹码」表述', game.indexOf('起始筹码') >= 0 && game.indexOf(word([20080, 20837])) < 0);
});

s.done();
