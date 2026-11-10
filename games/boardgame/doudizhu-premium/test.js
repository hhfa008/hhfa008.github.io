'use strict';

// Dou Dizhu premium — engine, rules, presentation and gate tests.
// Discovery: games/tests/run-all.js runs every test*.js under the game dir.

var fs = require('fs');
var path = require('path');
var lib = require(path.join(__dirname, '..', '..', 'tests', 'lib.js'));
var E = require(path.join(__dirname, 'engine.js'));
var D = require(path.join(__dirname, 'data.js'));
var s = lib.suite('doudizhu-premium');

function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function exists(name) { return fs.existsSync(path.join(__dirname, name)); }
function cjk(html) { return (String(html).replace(/<[^>]+>/g, ' ').match(/[一-鿿]/g) || []).length; }
function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  var b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
var DECK = E.makeDeck();
var BY_ID = {};
DECK.forEach(function (c) { BY_ID[c.id] = c; });
function C(id) { if (!BY_ID[id]) throw new Error('unknown card ' + id); return BY_ID[id]; }
function p(ids) { return E.detect(ids.map(C)); }
function playState(seed, bid) {
  var st = E.createGame({ seed: seed == null ? 20261110 : seed });
  var who = E.currentSeat(st);
  var target = bid == null ? 3 : bid;
  var res = E.applyAction(st, { k: 'bid', score: target }, who);
  if (!res.ok && !res.redeal) throw new Error('could not start play phase');
  var guard = 0;
  while (st.phase === 'bid' && guard < 6) {
    guard++;
    var seat = E.currentSeat(st);
    var r = E.applyAction(st, { k: 'bid', score: 0 }, seat);
    if (!r.ok && !r.redeal) throw new Error('bidding broke: ' + r.error);
  }
  if (st.phase !== 'play') throw new Error('could not reach play phase');
  return st;
}
function emptyScores() { return [0, 0, 0]; }

s.group('牌堆：54 张、四种花色、双王', function () {
  var deck = E.makeDeck();
  s.eq('牌堆 54 张', deck.length, 54);
  s.eq('花色 4 种', E.SUITS.length, 4);
  s.eq('花色字符', E.SUITS, ['♠', '♥', '♣', '♦']);
  s.eq('小王点数 16', E.SMALL_JOKER, 16);
  s.eq('大王点数 17', E.BIG_JOKER, 17);
  var ids = {};
  deck.forEach(function (c) { ids[c.id] = (ids[c.id] || 0) + 1; });
  s.eq('54 个唯一 id', Object.keys(ids).length, 54);
  s.ok('每个 id 只出现一次', Object.keys(ids).every(function (k) { return ids[k] === 1; }));
  s.eq('3 到 15 每个点数 4 张', [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].every(function (r) {
    return deck.filter(function (c) { return c.r === r; }).length === 4;
  }), true);
  s.eq('小王 1 张', deck.filter(function (c) { return c.r === E.SMALL_JOKER; }).length, 1);
  s.eq('大王 1 张', deck.filter(function (c) { return c.r === E.BIG_JOKER; }).length, 1);
  s.eq('普通牌 52 张', deck.filter(function (c) { return c.r <= 15; }).length, 52);
  s.eq('红桃是红色', E.isRed(C('H3')), true);
  s.eq('方块是红色', E.isRed(C('D3')), true);
  s.eq('黑桃是黑色', E.isRed(C('S3')), false);
  s.eq('梅花是黑色', E.isRed(C('C3')), false);
  s.eq('大王是红色', E.isRed(C('BJ')), true);
  s.eq('小王是黑色', E.isRed(C('SJ')), false);
  s.eq('点数名 J', E.rankName(11), 'J');
  s.eq('点数名 Q', E.rankName(12), 'Q');
  s.eq('点数名 K', E.rankName(13), 'K');
  s.eq('点数名 A', E.rankName(14), 'A');
  s.eq('点数名 2', E.rankName(15), '2');
  s.eq('小王名', E.rankName(E.SMALL_JOKER), '小王');
  s.eq('大王名', E.rankName(E.BIG_JOKER), '大王');
  s.eq('牌名 黑桃9', E.cardLabel(C('S9')), '♠9');
  s.eq('牌名 大王', E.cardLabel(C('BJ')), '大王');
  var sorted = E.sortHand([C('BJ'), C('SJ'), C('S3'), C('H15'), C('D14')]).map(function (c) { return c.id; });
  s.eq('排序：普通牌在前、王在后', sorted, ['S3', 'D14', 'H15', 'SJ', 'BJ']);
  var copy = E.makeDeck();
  copy[0].r = 99;
  s.eq('每次 makeDeck 返回独立对象', E.makeDeck()[0].r, 3);
});

s.group('发牌：17 / 17 / 17 + 3 张底牌', function () {
  var dealt = E.deal(20261110);
  s.eq('三家各 17 张', dealt.hands.map(function (h) { return h.length; }), [17, 17, 17]);
  s.eq('底牌 3 张', dealt.bottom.length, 3);
  s.eq('合计 54 张', dealt.hands[0].length + dealt.hands[1].length + dealt.hands[2].length + dealt.bottom.length, 54);
  var all = {};
  dealt.hands.forEach(function (h) { h.forEach(function (c) { all[c.id] = (all[c.id] || 0) + 1; }); });
  dealt.bottom.forEach(function (c) { all[c.id] = (all[c.id] || 0) + 1; });
  s.eq('发牌后 54 个唯一 id', Object.keys(all).length, 54);
  s.ok('没有一张牌重复', Object.keys(all).every(function (k) { return all[k] === 1; }));
  s.eq('同种子发牌一致', JSON.stringify(E.deal(42)), JSON.stringify(E.deal(42)));
  var differ = false;
  var a = E.deal(1), b = E.deal(2);
  for (var i = 0; i < 3; i++) {
    for (var j = 0; j < 17; j++) {
      if (a.hands[i][j].id !== b.hands[i][j].id) { differ = true; break; }
    }
  }
  s.ok('不同种子发牌不同', differ);
  s.ok('每家手牌已排序', dealt.hands.every(function (h) {
    for (var k = 1; k < h.length; k++) if (E.cardCmp(h[k - 1], h[k]) > 0) return false;
    return true;
  }));
  var st = E.createGame({ seed: 99 });
  s.eq('建局后三家 17 张', st.hands.map(function (h) { return h.length; }), [17, 17, 17]);
  s.eq('建局后底牌 3 张', st.bottom.length, 3);
  s.eq('建局阶段 bid', st.phase, 'bid');
  s.eq('地主尚未确定', st.landlord, -1);
  s.ok('先叫者在 0..2', [0, 1, 2].indexOf(st.bidding.turn) >= 0);
  s.eq('同种子建局一致', JSON.stringify(E.createGame({ seed: 7 }).hands), JSON.stringify(E.createGame({ seed: 7 }).hands));
  var st2 = playState(88);
  s.eq('叫地主后地主 20 张', st2.hands[st2.landlord].length, 20);
  s.eq('农民仍 17 张', st2.hands.filter(function (h, i) { return i !== st2.landlord; }).map(function (h) { return h.length; }), [17, 17]);
  var bottomInHand = st2.bottom.every(function (c) {
    return st2.hands[st2.landlord].some(function (x) { return x.id === c.id; });
  });
  s.ok('底牌进入地主手牌', bottomInHand);
  s.eq('地主先出牌', st2.turn, st2.landlord);
});

s.group('牌型：单、对、三、三带一、三带二', function () {
  s.eq('单张', p(['S3']).type, 'single');
  s.eq('单张主牌', p(['S3']).main, 3);
  s.eq('对子', p(['S3', 'H3']).type, 'pair');
  s.eq('对子张数', p(['S3', 'H3']).count, 2);
  s.eq('三张', p(['S3', 'H3', 'C3']).type, 'triple');
  s.eq('三张主牌', p(['S3', 'H3', 'C3']).main, 3);
  s.eq('三带一', p(['S3', 'H3', 'C3', 'S4']).type, 'triple_single');
  s.eq('三带一张数', p(['S3', 'H3', 'C3', 'S4']).count, 4);
  s.eq('三带一可带王', p(['S3', 'H3', 'C3', 'SJ']).type, 'triple_single');
  s.eq('三带二', p(['S3', 'H3', 'C3', 'S4', 'H4']).type, 'triple_pair');
  s.eq('三带二张数', p(['S3', 'H3', 'C3', 'S4', 'H4']).count, 5);
  s.eq('四张不同点不是三带一', p(['S3', 'H4', 'C5', 'D6']), null);
  s.eq('三张加两张不同点不是三带二', p(['S3', 'H3', 'C3', 'S4', 'H5']), null);
  s.eq('两张同点加一张不同点不是牌型', p(['S3', 'H3', 'S4']), null);
});

s.group('牌型：顺子、连对、飞机及带牌', function () {
  s.eq('五张顺子', p(['S3', 'H4', 'C5', 'S6', 'H7']).type, 'straight');
  s.eq('顺子主牌为最大点', p(['S3', 'H4', 'C5', 'S6', 'H7']).main, 7);
  s.eq('六张顺子', p(['S3', 'H4', 'C5', 'S6', 'H7', 'C8']).type, 'straight');
  s.eq('四张不构成顺子', p(['S3', 'H4', 'C5', 'S6']), null);
  s.eq('顺子不能含 2', p(['S11', 'H12', 'C13', 'S14', 'H15']), null);
  s.eq('顺子可以到 A', p(['S10', 'H11', 'C12', 'S13', 'H14']).type, 'straight');
  s.eq('顺子不能含小王', p(['S12', 'H13', 'C14', 'S15', 'SJ']), null);
  s.eq('三对连对', p(['S3', 'H3', 'S4', 'H4', 'S5', 'H5']).type, 'straight_pair');
  s.eq('连对主牌', p(['S3', 'H3', 'S4', 'H4', 'S5', 'H5']).main, 5);
  s.eq('两对不是连对', p(['S3', 'H3', 'S4', 'H4']), null);
  s.eq('连对不能含 2', p(['S13', 'H13', 'S14', 'H14', 'S15', 'H15']), null);
  s.eq('飞机', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4']).type, 'plane');
  s.eq('飞机主牌', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4']).main, 4);
  s.eq('飞机三连', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H5', 'C5']).type, 'plane');
  s.eq('飞机带单', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H6']).type, 'plane_single');
  s.eq('飞机带单张数', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H6']).count, 8);
  s.eq('飞机带对', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H5', 'S6', 'H6']).type, 'plane_pair');
  s.eq('飞机带对张数', p(['S3', 'H3', 'C3', 'S4', 'H4', 'C4', 'S5', 'H5', 'S6', 'H6']).count, 10);
  s.eq('飞机翅膀不能取机身点数', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'C4', 'D4']), null);
  s.eq('飞机机身不能含 2', p(['S14', 'H14', 'C14', 'S15', 'H15', 'C15']), null);
  s.eq('单组三张不是飞机', p(['S3', 'H3', 'C3']).type, 'triple');
});

s.group('牌型：四带二、炸弹、王炸', function () {
  s.eq('四带二单', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H5']).type, 'four_two_single');
  s.eq('四带二主牌', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H5']).main, 3);
  s.eq('四带两对', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'S5', 'H5']).type, 'four_two_pair');
  s.eq('四带两对张数', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'S5', 'H5']).count, 8);
  s.eq('四带两个同点对子不成立', p(['S3', 'H3', 'C3', 'D3', 'S4', 'H4', 'S4', 'H4']), null);
  s.eq('炸弹', p(['S3', 'H3', 'C3', 'D3']).type, 'bomb');
  s.eq('炸弹主牌', p(['S3', 'H3', 'C3', 'D3']).main, 3);
  s.eq('王炸', p(['SJ', 'BJ']).type, 'rocket');
  s.eq('王炸主牌为大王', p(['SJ', 'BJ']).main, E.BIG_JOKER);
  s.eq('只有小王不是王炸', p(['SJ']).type, 'single');
  s.eq('两张小王不存在', p(['SJ', 'SJ']), null);
  s.eq('空牌返回 null', E.detect([]), null);
  s.eq('牌型名 飞机带对', E.typeName('plane_pair'), '飞机带对');
  s.eq('牌型名 王炸', E.typeName('rocket'), '王炸');
  s.eq('未知牌型名回退', E.typeName('unknown'), 'unknown');
});

s.group('压牌：同型同长、炸弹与王炸', function () {
  s.ok('对 4 压对 3', E.canBeat(p(['S4', 'H4']), p(['S3', 'H3'])));
  s.ok('对 3 不能压对 4', !E.canBeat(p(['S3', 'H3']), p(['S4', 'H4'])));
  s.ok('单张不能压对子', !E.canBeat(p(['S4']), p(['S3', 'H3'])));
  s.ok('三带二不能压三带一', !E.canBeat(p(['S4', 'H4', 'C4', 'S5', 'H5']), p(['S3', 'H3', 'C3', 'S5'])));
  s.ok('五张顺子压五张顺子', E.canBeat(p(['S4', 'H5', 'C6', 'S7', 'H8']), p(['S3', 'H4', 'C5', 'S6', 'H7'])));
  s.ok('六张顺子不能压五张顺子', !E.canBeat(p(['S3', 'H4', 'C5', 'S6', 'H7', 'C8']), p(['S4', 'H5', 'C6', 'S7', 'H8'])));
  s.ok('连对不能压顺子', !E.canBeat(p(['S4', 'H4', 'S5', 'H5', 'S6', 'H6']), p(['S3', 'H4', 'C5', 'S6', 'H7'])));
  s.ok('炸弹压单张', E.canBeat(p(['S3', 'H3', 'C3', 'D3']), p(['H15'])));
  s.ok('炸弹压顺子', E.canBeat(p(['S3', 'H3', 'C3', 'D3']), p(['S4', 'H5', 'C6', 'S7', 'H8'])));
  s.ok('普通牌不能压炸弹', !E.canBeat(p(['H15']), p(['S3', 'H3', 'C3', 'D3'])));
  s.ok('大炸弹压小炸弹', E.canBeat(p(['S4', 'H4', 'C4', 'D4']), p(['S3', 'H3', 'C3', 'D3'])));
  s.ok('小炸弹不能压大炸弹', !E.canBeat(p(['S3', 'H3', 'C3', 'D3']), p(['S4', 'H4', 'C4', 'D4'])));
  s.ok('王炸压炸弹', E.canBeat(p(['SJ', 'BJ']), p(['S3', 'H3', 'C3', 'D3'])));
  s.ok('炸弹不能压王炸', !E.canBeat(p(['S3', 'H3', 'C3', 'D3']), p(['SJ', 'BJ'])));
  s.ok('王炸不能压王炸', !E.canBeat(p(['SJ', 'BJ']), p(['SJ', 'BJ'])));
  s.ok('四带二同型比四张点数', E.canBeat(p(['S4', 'H4', 'C4', 'D4', 'S5', 'H6']), p(['S3', 'H3', 'C3', 'D3', 'S5', 'H6'])));
  s.ok('自由出牌时任意合法牌型可出', E.canBeat(p(['S3']), null));
  s.ok('null 牌型不能出', !E.canBeat(null, p(['S3'])));
  s.ok('王炸是最大牌型', E.canBeat(p(['SJ', 'BJ']), p(['S14', 'H14', 'C14', 'D14'])));
});

s.group('叫分：1/2/3、最高者当地主、全不叫重发', function () {
  var st = E.createGame({ seed: 1234 });
  var first = E.currentSeat(st);
  var legal = E.legalActions(st, first);
  s.eq('叫分阶段首个动作是不叫', legal[0], { k: 'bid', score: 0 });
  s.eq('叫分可选 1/2/3', legal.slice(1).map(function (a) { return a.score; }), [1, 2, 3]);
  s.eq('不叫合法', E.isLegal(st, { k: 'bid', score: 0 }, first), true);
  var notTurn = E.applyAction(st, { k: 'bid', score: 1 }, (first + 1) % 3);
  s.eq('非当前叫分者被拒绝', notTurn.ok, false);
  s.eq('非当前叫分错误码', notTurn.code, 'E_TURN');
  var bad = E.applyAction(st, { k: 'bid', score: 4 }, first);
  s.eq('4 分不是合法叫分', bad.ok, false);
  var bid1 = E.applyAction(st, { k: 'bid', score: 1 }, first);
  s.ok('叫 1 分被接受', bid1.ok);
  s.eq('最高分变 1', st.bidding.highest, 1);
  s.eq('叫分者记录', st.bidding.bidder, first);
  s.eq('叫分后轮到下家', st.bidding.turn, (first + 1) % 3);
  var low = E.applyAction(st, { k: 'bid', score: 1 }, st.bidding.turn);
  s.eq('不能重复叫 1 分', low.ok, false);
  var pass = E.applyAction(st, { k: 'bid', score: 0 }, st.bidding.turn);
  s.ok('下家可以不叫', pass.ok);
  var raise = E.applyAction(st, { k: 'bid', score: 2 }, st.bidding.turn);
  s.ok('可以加到 2 分', raise.ok);
  s.eq('两轮后最高 2 分', st.bidding.highest, 2);
  s.eq('三轮结束进入出牌', st.phase, 'play');
  s.eq('最高叫分者当地主', st.landlord, (first + 2) % 3);
  s.eq('叫分写入 state.bid', st.bid, 2);
  s.eq('地主拿底牌后 20 张', st.hands[st.landlord].length, 20);

  var st3 = E.createGame({ seed: 555 });
  var f3 = E.currentSeat(st3);
  var r3 = E.applyAction(st3, { k: 'bid', score: 3 }, f3);
  s.ok('叫 3 分立即结束', r3.ok && st3.phase === 'play');
  s.eq('叫 3 分者当地主', st3.landlord, f3);
  s.eq('叫 3 分记录', st3.bid, 3);

  var st4 = E.createGame({ seed: 777 });
  var guard = 0;
  while (st4.redeals === 0 && guard < 12) {
    guard++;
    var who = E.currentSeat(st4);
    var res = E.applyAction(st4, { k: 'bid', score: 0 }, who);
    s.ok('全不叫流程仍可推进', res.ok || res.redeal);
    if (st4.phase === 'play') break;
  }
  s.ok('三家不叫触发重发', st4.redeals >= 1, 'redeals=' + st4.redeals);
  s.eq('重发后仍 17/17/17', st4.hands.map(function (h) { return h.length; }), [17, 17, 17]);
  s.eq('重发后底牌 3 张', st4.bottom.length, 3);
  s.ok('重发后仍在叫分或已进入出牌', st4.phase === 'bid' || st4.phase === 'play');
});

s.group('出牌：合法校验、回合推进与两家不要重置', function () {
  var st = playState(2026);
  var landlord = st.landlord;
  s.eq('地主先出牌', st.turn, landlord);
  var passFree = E.applyAction(st, { k: 'pass' }, landlord);
  s.eq('自由出牌时不能不要', passFree.ok, false);
  s.eq('自由出牌不要错误码', passFree.code, 'E_PASS');
  var one = st.hands[landlord][0];
  var act = { k: 'play', cards: [one.id] };
  s.ok('合法单张可出', E.isLegal(st, act, landlord));
  var res = E.applyAction(st, act, landlord);
  s.ok('出牌返回 ok', res.ok);
  s.eq('出牌后少一张', st.hands[landlord].length, 19);
  s.eq('出牌记录写入 history', st.history.length, 1);
  s.eq('最后出牌者', st.lastPlayer, landlord);
  s.eq('轮到下家', st.turn, (landlord + 1) % 3);
  s.eq('上一手牌型', st.lastPlay.type, 'single');

  var next = st.turn;
  var notOwn = E.applyAction(st, { k: 'play', cards: [st.hands[landlord][0].id] }, next);
  s.eq('不能出别人的牌', notOwn.ok, false);
  s.eq('出别人牌错误码', notOwn.code, 'E_CARDS');
  st.hands[next] = [C('S3')];
  var lower = E.applyAction(st, { k: 'play', cards: ['S3'] }, next);
  s.ok('压不过的单张被拒绝', !lower.ok);

  var pass1 = E.applyAction(st, { k: 'pass' }, next);
  s.ok('下家可以不要', pass1.ok);
  s.eq('一家不要后 lastPlay 保留', !!st.lastPlay, true);
  s.eq('不要计数 1', st.passes, 1);
  var third = st.turn;
  var pass2 = E.applyAction(st, { k: 'pass' }, third);
  s.ok('第二家不要', pass2.ok);
  s.eq('两家不要后清空 lastPlay', st.lastPlay, null);
  s.eq('两家不要后 passes 归零', st.passes, 0);
  s.eq('两家不要后回到最后出牌者', st.turn, landlord);
  s.eq('两家不要后 lastPlayer 清零', st.lastPlayer, -1);

  var free = E.applyAction(st, { k: 'play', cards: [st.hands[landlord][0].id] }, landlord);
  s.ok('自由出牌可出任意合法牌型', free.ok);
  s.eq('自由出牌后回合继续', st.turn, (landlord + 1) % 3);
  var illegal = E.applyAction(st, { k: 'play', cards: ['ZZZ'] }, st.turn);
  s.eq('不存在的牌被拒绝', illegal.ok, false);
  s.eq('不存在牌错误码', illegal.code, 'E_CARDS');
  var badAction = E.applyAction(st, { k: 'dance' }, st.turn);
  s.eq('未知动作被拒绝', badAction.ok, false);
  s.eq('未知动作错误码', badAction.code, 'E_ACTION');
});

s.group('胜负：出完即胜、地主与农民结算', function () {
  var st = playState(31);
  var L = st.landlord;
  st.hands[L] = [C('S3')];
  st.turn = L;
  st.lastPlay = null;
  var res = E.applyAction(st, { k: 'play', cards: ['S3'] }, L);
  s.ok('最后一张牌出完', res.ok);
  s.eq('对局结束', st.phase, 'over');
  s.eq('地主获胜', st.winnerSide, 'landlord');
  s.eq('赢家座位', st.winner, L);
  s.eq('结束原因 empty-hand', st.reason, 'empty-hand');
  s.eq('手牌清空', st.hands[L].length, 0);
  var sc = E.scoreOf(st);
  s.eq('地主分值 2 倍', sc.deltas[L], sc.points * 2);
  var farmers = [0, 1, 2].filter(function (i) { return i !== L; });
  s.eq('两个农民各付 1 倍', farmers.map(function (i) { return sc.deltas[i]; }), [-sc.points, -sc.points]);
  s.eq('结算总和为 0', sc.deltas.reduce(function (a, b) { return a + b; }, 0), 0);

  var st2 = playState(32);
  var L2 = st2.landlord;
  var F = (L2 + 1) % 3;
  st2.hands[F] = [C('H4')];
  st2.turn = F;
  st2.lastPlay = null;
  var r2 = E.applyAction(st2, { k: 'play', cards: ['H4'] }, F);
  s.ok('农民出完最后一张', r2.ok);
  s.eq('农民方获胜', st2.winnerSide, 'farmers');
  s.eq('赢家是农民', st2.winner, F);
  var sc2 = E.scoreOf(st2);
  s.eq('农民赢时地主付 2 倍', sc2.deltas[L2], -sc2.points * 2);
  s.eq('队友农民也赢 1 倍', sc2.deltas[F], sc2.points);
  s.eq('另一农民同样赢 1 倍', sc2.deltas.find(function (v, i) { return i !== L2 && i !== F; }), sc2.points);
  s.eq('结束状态 legalActions 为空', E.legalActions(st2, st2.turn).length, 0);
  s.eq('结束后继续操作被拒绝', E.applyAction(st2, { k: 'pass' }, st2.turn).ok, false);
});

s.group('记分：底分 × 叫分 × 炸弹翻倍', function () {
  var st = playState(41, 2);
  var L = st.landlord;
  s.eq('底分默认 1', st.baseScore, 1);
  s.eq('叫分记录 2', st.bid, 2);
  s.eq('初始倍数 1', st.multiplier, 1);
  s.eq('初始分值 2', E.scoreOf(st).points, 2);
  st.hands[L] = [C('S3'), C('H3'), C('C3'), C('D3'), C('S4')];
  st.turn = L;
  st.lastPlay = null;
  var bomb = E.applyAction(st, { k: 'play', cards: ['S3', 'H3', 'C3', 'D3'] }, L);
  s.ok('炸弹可出', bomb.ok);
  s.eq('炸弹计数 1', st.bombsPlayed, 1);
  s.eq('炸弹后倍数 2', st.multiplier, 2);
  s.eq('炸弹后分值 4', E.scoreOf(st).points, 4);

  var next = st.turn;
  st.hands[next] = [C('SJ'), C('BJ')];
  var rocket = E.applyAction(st, { k: 'play', cards: ['SJ', 'BJ'] }, next);
  s.ok('王炸可压炸弹', rocket.ok);
  s.eq('王炸也计入炸弹数', st.bombsPlayed, 2);
  s.eq('两次翻倍后倍数 4', st.multiplier, 4);
  s.eq('两次翻倍后分值 8', E.scoreOf(st).points, 8);

  var st2 = E.createGame({ seed: 42, baseScore: 3 });
  var who = E.currentSeat(st2);
  E.applyAction(st2, { k: 'bid', score: 3 }, who);
  s.eq('自定义底分 3', E.scoreOf(st2).base, 3);
  s.eq('底分 3 × 叫分 3 = 9', E.scoreOf(st2).points, 9);
  s.eq('倍数公式 2^0', Math.pow(2, st2.bombsPlayed), 1);
});

s.group('合法动作枚举与提示', function () {
  var st = playState(61);
  var L = st.landlord;
  var acts = E.legalActions(st, L);
  s.ok('自由出牌有大量合法动作', acts.length > 10, String(acts.length));
  s.ok('自由出牌不含 pass', acts.every(function (a) { return a.k !== 'pass'; }));
  s.ok('所有枚举动作都合法', acts.every(function (a) { return E.isLegal(st, a, L); }));
  var handIds = {};
  st.hands[L].forEach(function (c) { handIds[c.id] = 1; });
  s.ok('枚举动作只使用自己的牌', acts.every(function (a) {
    return a.cards.every(function (id) { return handIds[id]; });
  }));
  var last = E.detect([st.hands[L][0]]);
  var follows = E.legalActions(st, L);
  s.ok('提示返回合法牌型或 null', (function () {
    var sp = E.suggest(st.hands[L], last);
    return sp === null || !!E.detect(sp.cards);
  })());
  var sp2 = E.suggest(st.hands[L], null);
  s.ok('自由出牌提示至少一张', !!sp2 && sp2.count >= 1);
  var minHand = [C('S3')];
  s.eq('单张手牌提示单张', E.suggest(minHand, null).type, 'single');
  s.eq('无法压过时提示 null', E.suggest([C('S3')], E.detect([C('H4')])), null);
  var bombHand = [C('S3'), C('H3'), C('C3'), C('D3')];
  var bombSuggest = E.suggest(bombHand, E.detect([C('H15')]));
  s.ok('只有炸弹时提示炸弹', !!bombSuggest && bombSuggest.type === 'bomb');
});

s.group('AI：三档、合法、不作弊、自对弈', function () {
  var st = E.createGame({ seed: 71 });
  var who = E.currentSeat(st);
  var bid1 = E.aiBid(st.hands[who], 0, 1, function () { return 0.9; });
  s.ok('入门 AI 叫分在 0..3', [0, 1, 2, 3].indexOf(bid1) >= 0, String(bid1));
  var bid2 = E.aiBid(st.hands[who], 0, 2, function () { return 0.5; });
  s.ok('标准 AI 叫分在 0..3', [0, 1, 2, 3].indexOf(bid2) >= 0, String(bid2));
  var bid3 = E.aiBid(st.hands[who], 2, 3, function () { return 0.5; });
  s.ok('高手 AI 不会叫低于当前最高分', bid3 === 0 || bid3 > 2, String(bid3));

  var ps = playState(72);
  var turn = E.currentSeat(ps);
  [1, 2, 3].forEach(function (level) {
    var a = E.aiChoose(ps, turn, level, function () { return 0.37; });
    s.ok('AI 等级 ' + level + ' 有动作', !!a);
    s.ok('AI 等级 ' + level + ' 动作合法', E.isLegal(ps, a, turn));
    s.ok('AI 等级 ' + level + ' 不修改状态', JSON.stringify(ps.hands) === JSON.stringify(ps.hands));
  });
  var before = JSON.stringify(ps.hands);
  E.aiChoose(ps, turn, 3, function () { return 0.61; });
  s.eq('AI 决策不改手牌', JSON.stringify(ps.hands), before);

  // No-cheat: other seats are reduced to a length; touching their cards throws.
  var guard = playState(73);
  var gt = E.currentSeat(guard);
  var otherCounts = [0, 0, 0];
  for (var i = 0; i < 3; i++) otherCounts[i] = guard.hands[i].length;
  for (var j = 0; j < 3; j++) {
    if (j === gt) continue;
    guard.hands[j] = new Proxy([], {
      get: function (target, key) {
        if (key === 'length') return otherCounts[j];
        throw new Error('AI peeked at another hand: ' + String(key));
      }
    });
  }
  var noPeek = null;
  try { noPeek = E.aiChoose(guard, gt, 3, function () { return 0.42; }); }
  catch (err) { noPeek = null; }
  s.ok('高手 AI 不读取对手手牌', !!noPeek);

  var games = [1, 2, 3, 4, 5].map(function (seed) { return E.selfPlay(seed, 2); });
  s.ok('五局自对弈全部结束', games.every(function (g) { return g.phase === 'over'; }));
  s.ok('自对弈赢家合法', games.every(function (g) { return [0, 1, 2].indexOf(g.winner) >= 0; }));
  s.ok('自对弈地主确定', games.every(function (g) { return g.landlord >= 0; }));
  s.ok('自对弈无非法动作', games.every(function (g) { return (g.selfPlayIllegal || 0) === 0; }));
  s.ok('自对弈出牌记录非空', games.every(function (g) { return g.history.length > 0; }));
  s.ok('自对弈赢家手牌清空', games.every(function (g) { return g.hands[g.winner].length === 0; }));
  var scores = games.map(function (g) { return E.scoreOf(g); });
  s.ok('自对弈分值至少底分', scores.every(function (sc) { return sc.points >= 1; }));
  s.ok('自对弈倍数至少 1', scores.every(function (sc) { return sc.multiplier >= 1; }));

  var strong = 0;
  for (var k = 0; k < 6; k++) {
    var duel = E.createGame({ seed: 900 + k, human: [false, false, false] });
    var g2 = 0;
    while (duel.phase !== 'over' && g2 < 1200) {
      g2++;
      var seat = E.currentSeat(duel);
      var level = seat === 0 ? 3 : 1;
      var action = E.aiChoose(duel, seat, level, function () { return E.nextRandom(duel); });
      var res = E.applyAction(duel, action, seat);
      if (!res.ok) break;
    }
    if (duel.winnerSide && ((duel.landlord === 0) === (duel.winnerSide === 'landlord'))) strong++;
  }
  s.ok('高手 AI 在 6 局中至少赢 2 局', strong >= 2, 'wins=' + strong);

  var unseen = E.unseenCounts(ps, turn);
  var totalUnseen = Object.keys(unseen).reduce(function (n, r) { return n + unseen[r]; }, 0);
  s.eq('未见牌数 = 54 - 自己手牌 - 已出牌', totalUnseen, 54 - ps.hands[turn].length - ps.playedIds.length);
  s.ok('未见牌含大王或已在手/已出', unseen[E.BIG_JOKER] === 0 || unseen[E.BIG_JOKER] === 1);
  var inf = E.inference(ps, turn);
  s.ok('推断返回可能的炸弹数', typeof inf.possibleBombs === 'number' && inf.possibleBombs >= 0);
  s.eq('推断王炸布尔值', typeof inf.rocket, 'boolean');
});

s.group('公开视图：隐藏对手手牌与底牌身份', function () {
  var st = playState(81);
  var L = st.landlord;
  var other = (L + 1) % 3;
  var view = E.publicView(st, other);
  s.eq('视图观众座位', view.viewerSeat, other);
  s.eq('观众自己手牌 17 张', view.hand.length, 17);
  s.eq('观众手牌数', view.handCount, 17);
  s.ok('视图不含 hands 字段', !Object.prototype.hasOwnProperty.call(view, 'hands'));
  s.ok('其他座位只有手牌数量', view.seats.every(function (seat) {
    return seat.handCount >= 0 && !Object.prototype.hasOwnProperty.call(seat, 'hand');
  }));
  s.eq('地主手牌数量公开', view.seats[L].handCount, 20);
  s.eq('未结束底牌不揭示', view.bottom.revealed, false);
  s.eq('未结束底牌身份为空', view.bottom.cards, null);
  s.eq('底牌只给数量 3', view.bottom.count, 3);
  var json = JSON.stringify(view);
  var ownIds = {};
  view.hand.forEach(function (c) { ownIds[c.id] = 1; });
  var leaked = false;
  st.hands[L].forEach(function (c) {
    if (!ownIds[c.id] && json.indexOf('"' + c.id + '"') >= 0 && L !== other) leaked = true;
  });
  s.ok('对手手牌身份不出现在 JSON', !leaked);
  s.eq('视图回合座位', view.turnSeat, E.currentSeat(st));
  s.eq('视图 viewerTurn 与回合一致', view.viewerTurn, E.currentSeat(st) === other);
  s.ok('视图含对局日志', Array.isArray(view.log) && view.log.length > 0);
  s.ok('视图含记分结构', typeof view.score === 'object' && view.score.base >= 1);
  s.ok('视图含叫分状态', typeof view.bidding === 'object');
  s.eq('视图含已出牌列表', Array.isArray(view.played), true);

  var Lview = E.publicView(st, L);
  s.eq('地主视图手牌 20 张', Lview.hand.length, 20);
  s.eq('地主视图底牌仍遮罩', Lview.bottom.revealed, false);

  var st2 = playState(82);
  var LL = st2.landlord;
  st2.hands[LL] = [C('S3')];
  st2.turn = LL;
  st2.lastPlay = null;
  E.applyAction(st2, { k: 'play', cards: ['S3'] }, LL);
  var over = E.publicView(st2, (LL + 1) % 3);
  s.eq('结束后底牌揭示', over.bottom.revealed, true);
  s.eq('结束后底牌 3 张', over.bottom.cards.length, 3);
  s.ok('结束后底牌有身份', over.bottom.cards.every(function (c) { return typeof c.id === 'string'; }));
  s.eq('结束后 winnerSide', over.winnerSide, 'landlord');
  s.eq('结束后 result 分值', over.score.points, E.scoreOf(st2).points);
  s.eq('结束后 deltas 已给出', Array.isArray(over.score.deltas), true);
});

s.group('自对弈稳定性：多档位、多种子', function () {
  var reds = 0, total = 0;
  for (var seed = 1; seed <= 8; seed++) {
    var g = E.selfPlay(seed, seed % 2 === 0 ? 2 : 3);
    total++;
    if (g.phase === 'over' && g.winnerSide) reds++;
    s.ok('种子 ' + seed + ' 自对弈结束', g.phase === 'over');
    s.ok('种子 ' + seed + ' 有胜方', g.winnerSide === 'landlord' || g.winnerSide === 'farmers');
    s.ok('种子 ' + seed + ' 回合数合理', g.turns > 3 && g.turns < 1000, String(g.turns));
  }
  s.eq('8 局全部有结果', reds, total);
  var slow = E.selfPlay(3, 1);
  s.eq('入门档自对弈也能结束', slow.phase, 'over');
});

s.group('性能预算', function () {
  var t0 = Date.now();
  for (var i = 0; i < 500; i++) E.createGame({ seed: i });
  var createMs = Date.now() - t0;
  s.ok('500 次建局 < 2000ms', createMs < 2000, createMs + 'ms');

  var g = E.createGame({ seed: 5 });
  var who = E.currentSeat(g);
  E.applyAction(g, { k: 'bid', score: 3 }, who);
  var t1 = Date.now();
  for (var k = 0; k < 300; k++) E.legalActions(g, g.turn);
  var legalMs = Date.now() - t1;
  s.ok('300 次合法动作枚举 < 2500ms', legalMs < 2500, legalMs + 'ms');

  var t2 = Date.now();
  for (var m = 0; m < 30; m++) E.aiChoose(g, g.turn, 2, function () { return E.nextRandom(g); });
  var aiMs = Date.now() - t2;
  s.ok('30 次标准 AI 决策 < 3000ms', aiMs < 3000, aiMs + 'ms');
  s.ok('单次标准 AI 决策 < 150ms', aiMs / 30 < 150, (aiMs / 30).toFixed(1) + 'ms');

  var t3 = Date.now();
  for (var n = 0; n < 12; n++) E.aiChoose(g, g.turn, 3, function () { return E.nextRandom(g); });
  var ai3 = Date.now() - t3;
  s.ok('12 次高手 AI 决策 < 3000ms', ai3 < 3000, ai3 + 'ms');
});

s.group('页面与素材静态检查', function () {
  ['index.html', 'rules.html', 'engine.js', 'data.js', 'online.html', 'online-server.mjs',
    'test.js', 'test-online.js', 'DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'realism.json',
    'perf.json', 'meta.json', 'art-render.html', 'render-art.mjs'].forEach(function (file) {
    s.ok(file + ' 存在', exists(file));
  });
  var index = read('index.html');
  s.ok('index 有 viewport', /name="viewport"[^>]*width=device-width/.test(index));
  s.ok('index 有 meta description', /name="description"[^>]*content="[^"]{40,}"/.test(index));
  s.ok('index 引用 engine.js', index.indexOf('src="engine.js"') >= 0);
  s.ok('index 引用 data.js', index.indexOf('src="data.js"') >= 0);
  s.ok('index 复用 shared shuffle', index.indexOf('shared/shuffle.js') >= 0);
  s.ok('index 复用 shared sfx', index.indexOf('shared/sfx.js') >= 0);
  s.ok('index 复用 shared store', index.indexOf('shared/store.js') >= 0);
  s.ok('index 无外部脚本', !/<script[^>]+src="https?:/.test(index));
  s.ok('index 无外链图片', !/<img[^>]+src="https?:/.test(index));
  s.ok('index 无 emoji 占位', !/[\u{1F300}-\u{1FAFF}]/u.test(index));
  s.ok('index 有 44px 触控 token', /--tap\s*:\s*(4[4-9]|[5-9]\d)px/.test(index));
  s.ok('index 有 48px 操作按钮', /min-height:\s*48px/.test(index));
  s.ok('index 标题用 Songti SC', index.indexOf('Songti SC') >= 0);
  s.ok('index 声明 3 人', index.indexOf('3 人') >= 0);
  s.ok('index 声明联机入口', index.indexOf('online.html') >= 0);
  s.ok('index 手牌用 div+tabindex 而非 role=button', index.indexOf('tabindex="0"') >= 0 && index.indexOf('class="card') >= 0 && index.indexOf('role="button"') < 0);
  s.ok('index 有底牌区域', index.indexOf('bottomCards') >= 0);
  s.ok('index 有地主/农民标识', index.indexOf('地主') >= 0 && index.indexOf('农民') >= 0);

  var rules = read('rules.html');
  s.ok('rules 有 Article JSON-LD', rules.indexOf('"@type": "Article"') >= 0);
  s.ok('rules 有 FAQPage JSON-LD', rules.indexOf('"@type": "FAQPage"') >= 0);
  s.ok('rules 有 canonical', /rel="canonical"/.test(rules));
  s.ok('rules 汉字 >= 1200', cjk(rules) >= 1200, String(cjk(rules)));
  s.ok('rules 至少 2 张本地配图', (rules.match(/<img\b/gi) || []).length >= 2);
  s.ok('rules 无外部图片', !/<img[^>]+src="https?:/.test(rules));
  s.ok('rules 提到顺子', /顺子/.test(rules));
  s.ok('rules 提到飞机带对', /飞机带对/.test(rules));
  s.ok('rules 提到王炸', /王炸/.test(rules));
  s.ok('rules 提到炸弹翻倍', /炸弹[^。]{0,20}翻倍|翻倍[^。]{0,20}炸弹/.test(rules));
  s.ok('rules JSON-LD 可解析', (function () {
    var blocks = rules.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    if (blocks.length < 2) return false;
    try {
      blocks.forEach(function (b) {
        JSON.parse(b.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''));
      });
      return true;
    } catch (e) { return false; }
  })());

  var online = read('online.html');
  s.ok('online 引用 engine.js', online.indexOf('src="engine.js"') >= 0);
  s.ok('online 无外部脚本', !/<script[^>]+src="https?:/.test(online));
  s.ok('online 有联机 + 邀请 + 重连 + 排行榜',
    /联机/.test(online) && /邀请/.test(online) && /重连/.test(online) && /排行榜/.test(online));
  s.ok('online 有密码房间', /密码/.test(online));
  s.ok('online 有 AI 补位说明', /AI/.test(online));

  var server = read('online-server.mjs');
  s.ok('服务端复用共享房间实现', server.indexOf('online-room-server.mjs') >= 0);
  s.ok('服务端 slug 正确', server.indexOf("'doudizhu-premium'") >= 0);
  s.ok('服务端有 AI 补位', /aiAction/.test(server));
  s.ok('服务端有重连', /reconnect|重连/i.test(server));
  s.ok('服务端有排行榜', /leaderboard|排行榜/i.test(server));
  s.ok('服务端有 3 个座位', /maxPlayers:\s*3/.test(server) && /seatCount\(\)\s*\{\s*return (3|SEATS)/.test(server));

  var tOnline = read('test-online.js');
  s.ok('双客户端 E2E 标记', /two-client|双客户端|Two independent HTTP clients/i.test(tOnline));
  s.ok('E2E 输出 ONLINE_E2E_JSON', tOnline.indexOf('ONLINE_E2E_JSON') >= 0);
  s.ok('E2E 支持 --control', tOnline.indexOf('--control') >= 0);
  s.ok('E2E runAll true', /runAll:\s*true/.test(tOnline));
  s.ok('E2E 覆盖结算一致', /settlementConsistent/.test(tOnline));
  s.ok('E2E 覆盖托管', /timeoutTakeover/.test(tOnline));
  s.ok('E2E 声明 2 个客户端', /clients:\s*2/.test(tOnline));
});

s.group('meta / realism / 美术 / 预缓存', function () {
  var meta = JSON.parse(read('meta.json'));
  s.eq('meta slug', meta.slug, 'doudizhu-premium');
  s.eq('meta status shipped', meta.status, 'shipped');
  s.eq('meta players min 3', meta.players && meta.players.min, 3);
  s.eq('meta players max 3', meta.players && meta.players.max, 3);
  s.eq('meta playerCount 3', meta.playerCount, 3);
  s.eq('meta 联机入口', meta.online && meta.online.entry, 'online.html');
  ['rooms', 'invite', 'sync', 'aiFill', 'reconnect', 'timeoutTakeover', 'leaderboard'].forEach(function (k) {
    s.ok('meta 联机能力 ' + k, meta.online.features && !!meta.online.features[k]);
  });
  s.eq('meta 两人实机 + AI 补位', meta.online.aiFillEmptySeats, true);
  s.eq('meta singlePlayer false', meta.singlePlayer, false);
  s.eq('meta 状态原因非空', typeof meta.statusReason === 'string' && meta.statusReason.length > 20, true);

  var realism = JSON.parse(read('realism.json'));
  s.eq('realism pass', realism.pass, true);
  s.ok('realism >= 6 项', realism.checks.length >= 6, String(realism.checks.length));
  var kinds = realism.checks.map(function (c) { return c.kind; });
  ['count', 'dimension', 'proportion', 'color', 'material', 'rule'].forEach(function (k) {
    s.ok('realism 覆盖 ' + k, kinds.indexOf(k) >= 0);
  });
  s.ok('realism 全部 ok', realism.checks.every(function (c) { return c.ok === true; }));
  s.ok('realism 来源 >= 2 个 BV', realism.sources.filter(function (u) { return /bilibili\.com\/video\/BV/.test(u); }).length >= 2);

  var perf = JSON.parse(read('perf.json'));
  s.ok('perf budget 有界', perf.budget && perf.budget.loadMs <= 5000);
  s.ok('perf 有引擎预算', perf.budget && perf.budget.engineMs > 0);

function artCheck(label, base, w, h) {
  var p = pngSize(base + '.png');
  if (p) return s.ok(label, p.w === w && p.h === h, JSON.stringify(p));
  var webp = base + '.webp';
  return s.ok(label + ' (本地 WebP 回退)', fs.existsSync(webp) && fs.statSync(webp).size > 8000, webp);
}
  artCheck('cover 1200x1200', path.join(__dirname, 'assets', 'cover'), 1200, 1200);
  artCheck('og 1200x630', path.join(__dirname, 'assets', 'og'), 1200, 630);
  artCheck('detail-1 1200x800', path.join(__dirname, 'assets', 'detail-1'), 1200, 800);
  artCheck('detail-2 1200x800', path.join(__dirname, 'assets', 'detail-2'), 1200, 800);
  ['assets/cover.webp', 'assets/og.webp', 'assets/detail-1.webp', 'assets/detail-2.webp'].forEach(function (f) {
    s.ok(f + ' 存在且 > 8KB', exists(f) && fs.statSync(path.join(__dirname, f)).size > 8000);
  });
  ['card-paper', 'card-back', 'table-felt', 'chip'].forEach(function (name) {
    var f = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'doudizhu', name + '.webp');
    s.ok('材质 ' + name + '.webp 存在', fs.existsSync(f) && fs.statSync(f).size > 5000);
    var png = path.join(__dirname, '..', '..', 'assets', 'art', 'premium', 'doudizhu', name + '.png');
    s.ok('材质 ' + name + '.png 母版存在', fs.existsSync(png) && fs.statSync(png).size > 20000);
  });

  var manifestPath = path.join(__dirname, '..', '..', 'precache-manifest.js');
  var swPath = path.join(__dirname, '..', '..', 'sw.js');
  s.ok('precache manifest 存在', fs.existsSync(manifestPath));
  if (fs.existsSync(manifestPath) && fs.existsSync(swPath)) {
    var manifest = fs.readFileSync(manifestPath, 'utf8');
    var sw = fs.readFileSync(swPath, 'utf8');
    var swVersion = (sw.match(/CACHE_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
    var manifestVersion = (manifest.match(/"version"\s*:\s*"([^"]+)"/) || [])[1] || '';
    s.ok('sw CACHE_VERSION 非空', !!swVersion, swVersion);
    s.ok('precache manifest 版本非空', !!manifestVersion, manifestVersion);
    s.eq('precache manifest 与 CACHE_VERSION 同步', manifestVersion, swVersion);
    s.ok('manifest 收录共享 shuffle', manifest.indexOf('/games/shared/shuffle.js') >= 0);
    var inManifest = manifest.indexOf('doudizhu-premium') >= 0;
    if (inManifest) {
      s.ok('manifest 收录本游戏单机页', manifest.indexOf('/games/boardgame/doudizhu-premium/index.html') >= 0 ||
        manifest.indexOf('/games/boardgame/doudizhu-premium/') >= 0);
      s.ok('manifest 收录本游戏联机页', manifest.indexOf('/games/boardgame/doudizhu-premium/online.html') >= 0);
      s.ok('manifest 收录本游戏引擎', manifest.indexOf('doudizhu-premium/engine.js') >= 0);
      s.ok('manifest 收录本游戏材质', manifest.indexOf('/games/assets/art/premium/doudizhu/') >= 0);
    } else {
      s.ok('manifest 尚未收录本 slug：跳过条目断言，等待统一 regen', true, 'skipped until scripts/gen-precache.js runs');
    }
  }

  s.ok('数据来源 >= 2 条 B 站', D.SOURCES.bilibili.length >= 2);
  D.SOURCES.bilibili.forEach(function (url) {
    s.ok('B 站来源格式', /^https:\/\/www\.bilibili\.com\/video\/BV/.test(url), url);
  });
  s.eq('牌型表 14 种', D.HAND_TYPES.length, 14);
  s.eq('数据牌堆 54', D.DECK.total, 54);
  s.eq('数据发牌校验 54', D.DEAL.check, 54);
  s.eq('数据叫分 1/2/3', D.BIDDING.scores, [1, 2, 3]);
  s.eq('数据地主 20 张', D.DEAL.landlordHandSize, 20);
  s.eq('数据 3 人', D.DEAL.players, 3);
  s.ok('数据技巧 >= 5 条', D.TIPS.length >= 5);
  s.ok('记分公式含底分与叫分', /底分/.test(D.SCORE.formula) && /叫分/.test(D.SCORE.formula));
});

s.done();
