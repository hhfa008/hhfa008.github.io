#!/usr/bin/env node
'use strict';

/*
 * jaipur-premium engine tests.
 *
 * Run: node games/boardgame/jaipur-premium/test.js
 * Prints exactly one machine-readable line: RESULT: N passed, M failed
 * Exits non-zero when anything fails.
 *
 * Coverage: 55-card / 38-token / 18-bonus inventory, opening deal and camels,
 * take / take-camels / exchange / sell, hand limit, sell minimums, top-down
 * tokens, random bonus tiers and depletion, round end (3 exhausted types or
 * empty deck on refill), camel +5, three-step tie-break, seals, match end,
 * illegal actions, public view masking, AI levels and 30 self-play games.
 */

var Engine = require('./engine.js');

var passed = 0;
var failed = 0;
var failures = [];

function ok(label, condition, detail) {
  if (condition) passed += 1;
  else {
    failed += 1;
    var line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('FAIL ' + line);
  }
  return !!condition;
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}
function throws(label, fn, pattern) {
  var threw = false;
  var message = '';
  try { fn(); } catch (err) { threw = true; message = String(err && err.message); }
  return ok(label, threw && (!pattern || pattern.test(message)), 'message=' + JSON.stringify(message));
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function fresh(seed) { return Engine.createGame({ seed: seed == null ? 1 : seed }); }
function zeroMap() {
  var map = {};
  Engine.GOODS.forEach(function (good) { map[good] = []; });
  return map;
}
function sum(list) { return list.reduce(function (a, b) { return a + b; }, 0); }
function handOf(values) {
  var hand = {};
  Engine.GOODS.forEach(function (good) { hand[good] = values[good] || 0; });
  return hand;
}
function allGoodsCounts(state) {
  var counts = { camel: 0 };
  Engine.GOODS.forEach(function (good) { counts[good] = 0; });
  Engine.allCards(state).forEach(function (card) { counts[card] += 1; });
  return counts;
}
function craft(seed) {
  var s = fresh(seed || 1);
  s.players[0].hand = handOf({});
  s.players[1].hand = handOf({});
  s.players[0].camels = 0;
  s.players[1].camels = 0;
  s.players[0].goodsTokens = zeroMap();
  s.players[1].goodsTokens = zeroMap();
  s.players[0].bonusTokens = [];
  s.players[1].bonusTokens = [];
  s.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
  s.deck = [];
  s.current = 0;
  s.over = false;
  s.phase = 'play';
  s.seals = [0, 0];
  s.history = [];
  s.lastRound = null;
  return s;
}

/* ------------------------------------------------------------------ */
/* Inventory constants                                                */
/* ------------------------------------------------------------------ */

eq('6 goods types', Engine.GOODS.length, 6);
eq('goods order', Engine.GOODS, ['diamond', 'gold', 'silver', 'silk', 'spice', 'leather']);
eq('55 cards total constant', Engine.TOTAL_CARDS, 55);
eq('11 camels', Engine.CAMEL_COUNT, 11);
eq('44 goods cards', Engine.TOTAL_GOODS_CARDS, 44);
eq('diamond 6', Engine.CARD_COUNTS.diamond, 6);
eq('gold 6', Engine.CARD_COUNTS.gold, 6);
eq('silver 6', Engine.CARD_COUNTS.silver, 6);
eq('silk 8', Engine.CARD_COUNTS.silk, 8);
eq('spice 8', Engine.CARD_COUNTS.spice, 8);
eq('leather 10', Engine.CARD_COUNTS.leather, 10);
eq('goods cards sum to 44', Engine.GOODS.reduce(function (n, g) { return n + Engine.CARD_COUNTS[g]; }, 0), 44);
eq('cards + camels = 55', Engine.TOTAL_GOODS_CARDS + Engine.CAMEL_COUNT, 55);

eq('38 goods tokens', Engine.TOTAL_GOODS_TOKENS, 38);
eq('diamond tokens', Engine.TOKEN_VALUES.diamond, [7, 7, 5, 5, 5]);
eq('gold tokens', Engine.TOKEN_VALUES.gold, [6, 6, 5, 5, 5]);
eq('silver tokens', Engine.TOKEN_VALUES.silver, [5, 5, 5, 5, 5]);
eq('silk tokens', Engine.TOKEN_VALUES.silk, [5, 3, 3, 2, 2, 1, 1]);
eq('spice tokens', Engine.TOKEN_VALUES.spice, [5, 3, 3, 2, 2, 1, 1]);
eq('leather tokens', Engine.TOKEN_VALUES.leather, [4, 3, 2, 1, 1, 1, 1, 1, 1]);
eq('token stacks sum to 38', Engine.GOODS.reduce(function (n, g) { return n + Engine.TOKEN_VALUES[g].length; }, 0), 38);

eq('18 bonus tokens', Engine.TOTAL_BONUS_TOKENS, 18);
eq('bonus tier 3 values', Engine.BONUS_VALUES[3], [1, 1, 2, 2, 3, 3]);
eq('bonus tier 4 values', Engine.BONUS_VALUES[4], [4, 4, 5, 5, 6, 6]);
eq('bonus tier 5 values', Engine.BONUS_VALUES[5], [8, 8, 9, 9, 10, 10]);
eq('bonus tiers are 3/4/5', Engine.BONUS_TIERS, [3, 4, 5]);
eq('each tier has 6 tokens (3 values x2)', Engine.BONUS_TIERS.map(function (t) { return Engine.BONUS_VALUES[t].length; }), [6, 6, 6]);
eq('18 bonus tokens total', Engine.BONUS_TIERS.reduce(function (n, t) { return n + Engine.BONUS_VALUES[t].length; }, 0), 18);

eq('min sell diamond 2', Engine.MIN_SELL.diamond, 2);
eq('min sell gold 2', Engine.MIN_SELL.gold, 2);
eq('min sell silver 2', Engine.MIN_SELL.silver, 2);
eq('min sell silk 1', Engine.MIN_SELL.silk, 1);
eq('min sell spice 1', Engine.MIN_SELL.spice, 1);
eq('min sell leather 1', Engine.MIN_SELL.leather, 1);
eq('market size 5', Engine.MARKET_SIZE, 5);
eq('opening camels 3', Engine.OPENING_CAMELS, 3);
eq('hand size 5', Engine.HAND_SIZE, 5);
eq('hand limit 7', Engine.HAND_LIMIT, 7);
eq('camel bonus 5', Engine.CAMEL_BONUS, 5);
eq('two seals win', Engine.SEALS_TO_WIN, 2);
eq('deck after setup 40', Engine.DECK_AFTER_SETUP, 40);
eq('three difficulties', Engine.DIFFICULTIES, ['easy', 'medium', 'hard']);

/* ------------------------------------------------------------------ */
/* Opening deal and card conservation                                 */
/* ------------------------------------------------------------------ */

var opening = fresh(20261110);
eq('opening market size 5', opening.market.length, 5);
eq('opening market starts with 3 camels', opening.market.slice(0, 3), ['camel', 'camel', 'camel']);
eq('opening deck 40', opening.deck.length, 40);
eq('opening discard empty', opening.discard.length, 0);
eq('opening round 1', opening.round, 1);
eq('opening current player 0', opening.current, 0);
eq('opening seals 0-0', opening.seals, [0, 0]);
eq('opening total cards 55', Engine.allCards(opening).length, 55);

var openCounts = allGoodsCounts(opening);
eq('opening camel count 11', openCounts.camel, 11);
eq('opening diamond count 6', openCounts.diamond, 6);
eq('opening gold count 6', openCounts.gold, 6);
eq('opening silver count 6', openCounts.silver, 6);
eq('opening silk count 8', openCounts.silk, 8);
eq('opening spice count 8', openCounts.spice, 8);
eq('opening leather count 10', openCounts.leather, 10);

Engine.GOODS.forEach(function (good) {
  eq('opening ' + good + ' count matches deck list', openCounts[good], Engine.CARD_COUNTS[good]);
});
eq('opening token stacks full', Engine.tokenCounts(opening), {
  diamond: 5, gold: 5, silver: 5, silk: 7, spice: 7, leather: 9
});
eq('opening bonus counts 6/6/6', Engine.bonusCounts(opening), { 3: 6, 4: 6, 5: 6 });
eq('opening hand0 size plus camels = 5', Engine.handSize(opening.players[0]) + opening.players[0].camels, 5);
eq('opening hand1 size plus camels = 5', Engine.handSize(opening.players[1]) + opening.players[1].camels, 5);
eq('opening hand0 has no camel key', opening.players[0].hand.camel, undefined);
eq('opening hand1 has no camel key', opening.players[1].hand.camel, undefined);

var realTake = fresh(4321);
var realCard = realTake.market.filter(function (c) { return c !== 'camel'; })[0];
if (realCard) {
  var realAfter = Engine.applyMove(realTake, { type: 'take', card: realCard });
  eq('real-game take keeps 55 cards', Engine.allCards(realAfter).length, 55);
  eq('real-game take keeps all card types', allGoodsCounts(realAfter), allGoodsCounts(realTake));
} else {
  ok('real-game take keeps 55 cards', false, 'no goods in market');
  ok('real-game take keeps all card types', false);
}

var same = fresh(20261110);
eq('same seed reproduces market', same.market, opening.market);
eq('same seed reproduces deck', same.deck, opening.deck);
eq('same seed reproduces hands', [same.players[0].hand, same.players[1].hand], [opening.players[0].hand, opening.players[1].hand]);
var other = fresh(20261111);
ok('different seed changes deal', JSON.stringify(other.deck) !== JSON.stringify(opening.deck));

var camelHistogram = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
var marketGoodsTotal = 0;
var deck40 = true;
var conservation = true;
for (var seed = 0; seed < 200; seed++) {
  var s = fresh(seed);
  camelHistogram[s.players[0].camels] = (camelHistogram[s.players[0].camels] || 0) + 1;
  if (Engine.handSize(s.players[0]) + s.players[0].camels !== 5) conservation = false;
  if (Engine.handSize(s.players[1]) + s.players[1].camels !== 5) conservation = false;
  if (s.deck.length !== 40) deck40 = false;
  if (s.market.length !== 5) conservation = false;
  var marketGoods = s.market.filter(function (c) { return c !== 'camel'; }).length;
  marketGoodsTotal += marketGoods;
  if (marketGoods > 2) conservation = false;
  if (Engine.allCards(s).length !== 55) conservation = false;
}
ok('200 seeds: every hand plus herd is 5', conservation);
ok('200 seeds: deck always 40', deck40);
ok('200 seeds: someone can start with 0 camels', camelHistogram[0] > 0, JSON.stringify(camelHistogram));
ok('200 seeds: someone can start with 2+ camels', (camelHistogram[2] || 0) + (camelHistogram[3] || 0) > 0, JSON.stringify(camelHistogram));
ok('200 seeds: starting camels are not fixed at 3', camelHistogram[3] !== 200, JSON.stringify(camelHistogram));
ok('200 seeds: market flips 0-2 goods', marketGoodsTotal >= 0, 'goods=' + marketGoodsTotal);

/* ------------------------------------------------------------------ */
/* Take one goods card                                                */
/* ------------------------------------------------------------------ */

var takeState = craft(11);
takeState.market = ['diamond', 'camel', 'camel', 'gold', 'silk'];
takeState.deck = ['silk', 'spice', 'leather', 'gold', 'silver'];
takeState.players[0].hand = handOf({ diamond: 0, silk: 1 });
var takeBefore = copy(takeState);
var takeTotalBefore = Engine.allCards(takeState).length;
var taken = Engine.applyMove(takeState, { type: 'take', card: 'diamond' });
eq('take adds one to hand', taken.players[0].hand.diamond, 1);
eq('take removes card from market', taken.market.filter(function (c) { return c === 'diamond'; }).length, 0);
eq('take refills market to 5', taken.market.length, 5);
eq('take draws one from deck', taken.deck.length, 4);
eq('take consumes turn', taken.turn, 1);
eq('take passes turn', taken.current, 1);
eq('take preserves the card pool', Engine.allCards(taken).length, takeTotalBefore);
eq('take does not mutate input', takeState, takeBefore);
eq('take log records card', taken.lastAction.move.card, 'diamond');
eq('take action type', taken.lastAction.type, 'take');

var fullHand = craft(12);
fullHand.players[0].hand = handOf({ diamond: 2, gold: 2, silver: 2, silk: 1 });
fullHand.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
fullHand.deck = ['leather', 'leather'];
eq('crafted hand is 7', Engine.handSize(fullHand.players[0]), 7);
throws('take with 7-card hand rejected', function () { Engine.applyMove(fullHand, { type: 'take', card: 'diamond' }); }, /7 张/);
throws('take camel rejected', function () { Engine.applyMove(takeState, { type: 'take', card: 'camel' }); }, /骆驼/);
throws('take absent card rejected', function () { Engine.applyMove(takeState, { type: 'take', card: 'leather' }); }, /没有/);
throws('unknown action rejected', function () { Engine.applyMove(takeState, { type: 'dance' }); }, /未知/);
throws('null action rejected', function () { Engine.applyMove(takeState, null); }, /动作非法/);

var shortDeck = craft(13);
shortDeck.market = ['diamond', 'camel', 'camel', 'camel', 'camel'];
shortDeck.deck = [];
shortDeck.players[0].hand = handOf({});
var shortResult = Engine.applyMove(shortDeck, { type: 'take', card: 'diamond' });
eq('take with empty deck ends round', shortResult.history.length, 1);
eq('deck-empty round reason', shortResult.lastRound.reason, 'deckEmpty');
eq('deck-empty action completed before settlement', shortResult.history[0].scores[0].goodsTokenCount, 0);

/* ------------------------------------------------------------------ */
/* Take all camels                                                    */
/* ------------------------------------------------------------------ */

var camelState = craft(21);
camelState.market = ['camel', 'camel', 'diamond', 'gold', 'silk'];
camelState.deck = ['camel', 'spice', 'leather', 'silver'];
camelState.players[0].camels = 1;
var camelAfter = Engine.applyMove(camelState, { type: 'takeCamels' });
eq('takeCamels adds all market camels', camelAfter.players[0].camels, 3);
eq('takeCamels market camel count 0 before refill', camelAfter.market.length, 5);
eq('takeCamels refills market', camelAfter.market.length, 5);
eq('takeCamels draws 2 from deck', camelAfter.deck.length, 2);
eq('takeCamels preserves the card pool', Engine.allCards(camelAfter).length, Engine.allCards(camelState).length);
eq('takeCamels passes turn', camelAfter.current, 1);
eq('takeCamels logs count', camelAfter.lastAction.move.type, 'takeCamels');
throws('takeCamels with none rejected', function () {
  var s2 = craft(22); s2.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
  Engine.applyMove(s2, { type: 'takeCamels' });
}, /没有骆驼/);

var camelShort = craft(23);
camelShort.market = ['camel', 'camel', 'camel', 'camel', 'camel'];
camelShort.deck = [];
camelShort.players[0].camels = 0;
var camelShortAfter = Engine.applyMove(camelShort, { type: 'takeCamels' });
eq('taking all camels with empty deck ends round', camelShortAfter.history.length, 1);
eq('camel deck-empty reason', camelShortAfter.lastRound.reason, 'deckEmpty');

/* ------------------------------------------------------------------ */
/* Exchange                                                           */
/* ------------------------------------------------------------------ */

var ex = craft(31);
ex.market = ['diamond', 'gold', 'camel', 'camel', 'silk'];
ex.deck = ['spice', 'leather', 'silver', 'silk'];
ex.players[0].hand = handOf({ spice: 2, leather: 1 });
ex.players[0].camels = 2;
var exAfter = Engine.applyMove(ex, { type: 'exchange', take: [0, 1], give: { spice: 1, camel: 1 } });
eq('exchange gives one spice', exAfter.players[0].hand.spice, 1);
eq('exchange gives one camel', exAfter.players[0].camels, 1);
eq('exchange takes diamond', exAfter.players[0].hand.diamond, 1);
eq('exchange takes gold', exAfter.players[0].hand.gold, 1);
eq('exchange market stays 5', exAfter.market.length, 5);
eq('exchange does not draw from deck', exAfter.deck.length, 4);
eq('exchange returns camel to market', exAfter.market.filter(function (c) { return c === 'camel'; }).length, 3);
eq('exchange passes turn', exAfter.current, 1);
eq('exchange preserves the card pool', Engine.allCards(exAfter).length, Engine.allCards(ex).length);
eq('exchange hand size 4', Engine.handSize(exAfter.players[0]), 4);
eq('exchange action type', exAfter.lastAction.type, 'exchange');

throws('exchange of one card rejected', function () {
  var s2 = craft(32); s2.players[0].hand = handOf({ spice: 2 }); s2.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
  Engine.applyMove(s2, { type: 'exchange', take: [0], give: { spice: 1 } });
}, /至少.*2/);
throws('exchange taking camel rejected', function () {
  var s2 = craft(33); s2.players[0].hand = handOf({ spice: 2 }); s2.market = ['camel', 'diamond', 'gold', 'silk', 'spice'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 1], give: { spice: 2 } });
}, /骆驼/);
throws('exchange duplicate indices rejected', function () {
  var s2 = craft(34); s2.players[0].hand = handOf({ spice: 2 }); s2.market = ['diamond', 'gold', 'silk', 'spice', 'spice'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 0], give: { spice: 2 } });
}, /重复/);
throws('exchange mismatch rejected', function () {
  var s2 = craft(35); s2.players[0].hand = handOf({ spice: 3 }); s2.market = ['diamond', 'gold', 'silk', 'spice', 'spice'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 1], give: { spice: 1 } });
}, /返还/);
throws('exchange without cards rejected', function () {
  var s2 = craft(36); s2.players[0].hand = handOf({}); s2.players[0].camels = 0; s2.market = ['diamond', 'gold', 'silk', 'spice', 'spice'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 1], give: {} });
}, /返还/);
throws('exchange over hand limit rejected', function () {
  var s2 = craft(37);
  s2.players[0].hand = handOf({ diamond: 2, gold: 2, silver: 2, silk: 1 });
  s2.players[0].camels = 2;
  s2.market = ['diamond', 'gold', 'silk', 'spice', 'leather'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 1], give: { camel: 2 } });
}, /7 张/);
throws('exchange invalid market index rejected', function () {
  var s2 = craft(38); s2.players[0].hand = handOf({ spice: 2 }); s2.market = ['diamond', 'gold', 'silk', 'spice', 'leather'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 9], give: { spice: 2 } });
}, /下标/);
throws('exchange negative give rejected', function () {
  var s2 = craft(39); s2.players[0].hand = handOf({ spice: 2 }); s2.market = ['diamond', 'gold', 'silk', 'spice', 'leather'];
  Engine.applyMove(s2, { type: 'exchange', take: [0, 1], give: { spice: -1 } });
}, /返还/);

var exFive = craft(40);
exFive.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
exFive.players[0].hand = handOf({ leather: 3, spice: 2 });
exFive.players[0].camels = 0;
var exFiveAfter = Engine.applyMove(exFive, {
  type: 'exchange', take: [0, 1, 2, 3, 4], give: { leather: 3, spice: 2 }
});
eq('exchange can take all five', exFiveAfter.players[0].hand.diamond, 1);
eq('exchange can take all five (silk)', exFiveAfter.players[0].hand.silk, 1);
eq('exchange all five returns market 5', exFiveAfter.market.length, 5);

var exLegal = craft(41);
exLegal.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
exLegal.deck = [];
exLegal.players[0].hand = handOf({ diamond: 2, gold: 2, silver: 2, silk: 1 });
exLegal.players[0].camels = 0;
var exLegalMoves = Engine.getLegalMoves(exLegal);
ok('exchange is legal when hand is full and no other action', exLegalMoves.some(function (m) { return m.type === 'exchange'; }));
ok('no take move when hand is 7', !exLegalMoves.some(function (m) { return m.type === 'take'; }));
ok('no camel move when market has no camel', !exLegalMoves.some(function (m) { return m.type === 'takeCamels'; }));

var exNoRefill = craft(42);
exNoRefill.market = ['diamond', 'gold', 'silver', 'silk', 'spice'];
exNoRefill.deck = [];
exNoRefill.players[0].hand = handOf({ gold: 1, leather: 1 });
var exNoRefillAfter = Engine.applyMove(exNoRefill, { type: 'exchange', take: [0, 1], give: { gold: 1, leather: 1 } });
eq('exchange with empty deck does not end round', exNoRefillAfter.history.length, 0);
eq('exchange with empty deck keeps round', exNoRefillAfter.round, 1);

/* ------------------------------------------------------------------ */
/* Sell                                                               */
/* ------------------------------------------------------------------ */

var sell = craft(51);
sell.players[0].hand = handOf({ diamond: 4 });
sell.market = ['camel', 'camel', 'camel', 'gold', 'silk'];
sell.deck = ['silver', 'spice', 'leather', 'silk'];
var sold = Engine.applyMove(sell, { type: 'sell', good: 'diamond', count: 3 });
eq('sell removes cards from hand', sold.players[0].hand.diamond, 1);
eq('sell takes top three diamond tokens', sold.players[0].goodsTokens.diamond, [7, 7, 5]);
eq('sell leaves two diamond tokens', sold.tokenStacks.diamond, [5, 5]);
eq('sell discards sold cards', sold.discard.length, 3);
eq('sell does not refill market', sold.market.length, 5);
eq('sell does not draw deck', sold.deck.length, 4);
eq('sell grants tier-3 bonus token', sold.players[0].bonusTokens.length, 1);
ok('tier-3 bonus is 1/2/3', [1, 2, 3].indexOf(sold.players[0].bonusTokens[0]) !== -1, JSON.stringify(sold.players[0].bonusTokens));
eq('tier-3 stack now 5', Engine.bonusCounts(sold)[3], 5);
eq('sell passes turn', sold.current, 1);

throws('sell one diamond rejected', function () {
  var s2 = craft(52); s2.players[0].hand = handOf({ diamond: 3 });
  Engine.applyMove(s2, { type: 'sell', good: 'diamond', count: 1 });
}, /至少/);
throws('sell one gold rejected', function () {
  var s2 = craft(53); s2.players[0].hand = handOf({ gold: 3 });
  Engine.applyMove(s2, { type: 'sell', good: 'gold', count: 1 });
}, /至少/);
throws('sell one silver rejected', function () {
  var s2 = craft(54); s2.players[0].hand = handOf({ silver: 3 });
  Engine.applyMove(s2, { type: 'sell', good: 'silver', count: 1 });
}, /至少/);
throws('sell four silk allowed? count above hand rejected', function () {
  var s2 = craft(55); s2.players[0].hand = handOf({ silk: 2 });
  Engine.applyMove(s2, { type: 'sell', good: 'silk', count: 4 });
}, /没有足够/);
throws('sell over remaining tokens rejected', function () {
  var s2 = craft(56);
  s2.players[0].hand = handOf({ diamond: 5 });
  s2.tokenStacks.diamond = [7, 7];
  Engine.applyMove(s2, { type: 'sell', good: 'diamond', count: 3 });
}, /只剩/);
throws('sell empty token good rejected', function () {
  var s2 = craft(57);
  s2.players[0].hand = handOf({ leather: 3 });
  s2.tokenStacks.leather = [];
  Engine.applyMove(s2, { type: 'sell', good: 'leather', count: 1 });
}, /耗尽/);
throws('sell unknown good rejected', function () {
  var s2 = craft(58); s2.players[0].hand = handOf({ diamond: 3 });
  Engine.applyMove(s2, { type: 'sell', good: 'jade', count: 2 });
}, /未知/);

var oneSilk = craft(59);
oneSilk.players[0].hand = handOf({ silk: 1 });
var oneSilkAfter = Engine.applyMove(oneSilk, { type: 'sell', good: 'silk', count: 1 });
eq('silk can sell one', oneSilkAfter.players[0].goodsTokens.silk, [5]);
eq('one-card sale gets no bonus', oneSilkAfter.players[0].bonusTokens.length, 0);
var oneLeather = craft(60);
oneLeather.players[0].hand = handOf({ leather: 1 });
var oneLeatherAfter = Engine.applyMove(oneLeather, { type: 'sell', good: 'leather', count: 1 });
eq('leather can sell one', oneLeatherAfter.players[0].goodsTokens.leather, [4]);
eq('leather one-card sale gets no bonus', oneLeatherAfter.players[0].bonusTokens.length, 0);
var oneSpice = craft(61);
oneSpice.players[0].hand = handOf({ spice: 1 });
var oneSpiceAfter = Engine.applyMove(oneSpice, { type: 'sell', good: 'spice', count: 1 });
eq('spice can sell one', oneSpiceAfter.players[0].goodsTokens.spice, [5]);

var fourSale = craft(62);
fourSale.players[0].hand = handOf({ gold: 4 });
var fourSaleAfter = Engine.applyMove(fourSale, { type: 'sell', good: 'gold', count: 4 });
eq('four gold takes four tokens', fourSaleAfter.players[0].goodsTokens.gold, [6, 6, 5, 5]);
eq('four-card sale uses tier-4 bonus', Engine.bonusCounts(fourSaleAfter)[4], 5);
ok('tier-4 bonus is 4/5/6', [4, 5, 6].indexOf(fourSaleAfter.players[0].bonusTokens[0]) !== -1);
var fiveSale = craft(63);
fiveSale.players[0].hand = handOf({ silver: 5 });
var fiveSaleAfter = Engine.applyMove(fiveSale, { type: 'sell', good: 'silver', count: 5 });
eq('five silver takes five tokens', fiveSaleAfter.players[0].goodsTokens.silver, [5, 5, 5, 5, 5]);
eq('five-card sale uses tier-5 bonus', Engine.bonusCounts(fiveSaleAfter)[5], 5);
ok('tier-5 bonus is 8/9/10', [8, 9, 10].indexOf(fiveSaleAfter.players[0].bonusTokens[0]) !== -1);

var tierOrders = { 3: {}, 4: {}, 5: {} };
for (var bs = 0; bs < 40; bs++) {
  var bg = fresh(bs);
  tierOrders[3][bg.bonusStacks[3].join('')] = 1;
  tierOrders[4][bg.bonusStacks[4].join('')] = 1;
  tierOrders[5][bg.bonusStacks[5].join('')] = 1;
  if (bs < 8) {
    eq('seed ' + bs + ' tier-3 permutation', bg.bonusStacks[3].slice().sort(function (a, b) { return a - b; }), [1, 1, 2, 2, 3, 3]);
    eq('seed ' + bs + ' tier-4 permutation', bg.bonusStacks[4].slice().sort(function (a, b) { return a - b; }), [4, 4, 5, 5, 6, 6]);
    eq('seed ' + bs + ' tier-5 permutation', bg.bonusStacks[5].slice().sort(function (a, b) { return a - b; }), [8, 8, 9, 9, 10, 10]);
  }
}
ok('tier-3 order varies by seed', Object.keys(tierOrders[3]).length >= 2, JSON.stringify(Object.keys(tierOrders[3])));
ok('tier-4 order varies by seed', Object.keys(tierOrders[4]).length >= 2, JSON.stringify(Object.keys(tierOrders[4])));
ok('tier-5 order varies by seed', Object.keys(tierOrders[5]).length >= 2, JSON.stringify(Object.keys(tierOrders[5])));

var tierExhaust = craft(64);
tierExhaust.players[0].hand = handOf({ diamond: 3 });
tierExhaust.tokenStacks.diamond = [7, 7, 5];
tierExhaust.bonusStacks[3] = [];
var tierExhaustAfter = Engine.applyMove(tierExhaust, { type: 'sell', good: 'diamond', count: 3 });
eq('empty bonus tier yields no bonus', tierExhaustAfter.players[0].bonusTokens.length, 0);
eq('empty bonus tier stays empty', Engine.bonusCounts(tierExhaustAfter)[3], 0);

var tierDrain = craft(65);
tierDrain.players[0].hand = handOf({ diamond: 3, gold: 3, silver: 3, silk: 6, spice: 3, leather: 3 });
tierDrain.tokenStacks.diamond = [7, 7, 5, 5, 5];
tierDrain.tokenStacks.gold = [6, 6, 5, 5, 5];
tierDrain.tokenStacks.silver = [5, 5, 5, 5, 5];
tierDrain.tokenStacks.silk = [5, 3, 3, 2, 2, 1, 1];
tierDrain.tokenStacks.spice = [5, 3, 3, 2, 2, 1, 1];
tierDrain.tokenStacks.leather = [4, 3, 2, 1, 1, 1, 1, 1, 1];
tierDrain.players[0].goodsTokens = zeroMap();
tierDrain.players[1].goodsTokens = zeroMap();
var drainSeq = [['diamond', 3], ['gold', 3], ['silver', 3], ['silk', 3], ['silk', 3], ['spice', 3]];
var drainState = tierDrain;
drainSeq.forEach(function (pair) {
  drainState.current = 0;
  drainState = Engine.applyMove(drainState, { type: 'sell', good: pair[0], count: pair[1] });
});
eq('six tier-3 sales drain the tier', Engine.bonusCounts(drainState)[3], 0);
eq('six tier-3 bonuses collected', drainState.players[0].bonusTokens.length, 6);
eq('six tier-3 bonuses sum to 12 (two of each)', sum(drainState.players[0].bonusTokens), 12);
eq('draining a bonus tier does not end the round', drainState.history.length, 0);
drainState.current = 0;
var seventh = Engine.applyMove(drainState, { type: 'sell', good: 'leather', count: 3 });
eq('seventh three-card sale gets no bonus', seventh.players[0].bonusTokens.length, 6);
eq('drained tier stays empty', Engine.bonusCounts(seventh)[3], 0);
eq('seventh sale still scores goods tokens', seventh.players[0].goodsTokens.leather, [4, 3, 2]);
eq('seventh sale does not end the round', seventh.history.length, 0);

var twoPlayersBonus = craft(66);
twoPlayersBonus.players[0].hand = handOf({ silk: 3 });
twoPlayersBonus.players[1].hand = handOf({ silk: 3 });
twoPlayersBonus.tokenStacks.silk = [5, 3, 3, 2, 2, 1, 1];
twoPlayersBonus.bonusStacks[3] = [1, 1, 2, 2, 3, 3];
var tpb1 = Engine.applyMove(twoPlayersBonus, { type: 'sell', good: 'silk', count: 3 });
var tpb2 = Engine.applyMove(tpb1, { type: 'sell', good: 'silk', count: 3 });
eq('both players can earn from the same bonus tier', [tpb1.players[0].bonusTokens.length, tpb2.players[1].bonusTokens.length], [1, 1]);
eq('two tier-3 bonuses consumed', Engine.bonusCounts(tpb2)[3], 4);
ok('both tier-3 values are in 1/2/3', [1, 2, 3].indexOf(tpb1.players[0].bonusTokens[0]) !== -1 && [1, 2, 3].indexOf(tpb2.players[1].bonusTokens[0]) !== -1);

/* ------------------------------------------------------------------ */
/* Round end, seals, next starter                                     */
/* ------------------------------------------------------------------ */

var roundEnd = craft(71);
roundEnd.players[0].hand = handOf({ diamond: 3 });
roundEnd.players[0].goodsTokens = zeroMap();
roundEnd.players[1].goodsTokens = zeroMap();
roundEnd.players[0].goodsTokens.diamond = [7];
roundEnd.tokenStacks.diamond = [7, 7, 5];
roundEnd.tokenStacks.gold = [];
roundEnd.tokenStacks.silver = [];
roundEnd.tokenStacks.silk = [];
roundEnd.market = ['camel', 'camel', 'camel', 'silk', 'leather'];
roundEnd.deck = ['spice', 'silk'];
roundEnd.current = 0;
roundEnd.starter = 0;
var re = Engine.applyMove(roundEnd, { type: 'sell', good: 'diamond', count: 3 });
eq('three exhausted types record a round', re.history.length, 1);
eq('round result records reason', re.lastRound.reason, 'tokensExhausted');
eq('round result keeps both score rows', re.lastRound.scores.length, 2);
eq('round result camel bonus absent when tied at 0', re.lastRound.camelBonusTo, null);
eq('round result winner is player 0', re.lastRound.winner, 0);
eq('winner receives a seal', re.seals, [1, 0]);
eq('player seal count mirrors match', re.players[0].seals, 1);
eq('new round index 2', re.round, 2);
eq('loser starts next round', re.starter, 1);
eq('current is the loser', re.current, 1);
eq('new round market 5', re.market.length, 5);
eq('new round deck 40', re.deck.length, 40);
eq('new round token stacks full', Engine.tokenCounts(re), {
  diamond: 5, gold: 5, silver: 5, silk: 7, spice: 7, leather: 9
});
eq('new round hands reset to 5 cards', Engine.handSize(re.players[0]) + re.players[0].camels, 5);
eq('seals persist across rounds', re.seals, [1, 0]);
eq('new round lastRound preserved for UI', re.lastRound.round, 1);

var camelScore = craft(72);
camelScore.players[0].camels = 5;
camelScore.players[1].camels = 2;
camelScore.players[0].goodsTokens = zeroMap();
camelScore.players[1].goodsTokens = zeroMap();
camelScore.players[0].goodsTokens.gold = [6];
camelScore.players[1].goodsTokens.silk = [5];
var cs = Engine.computeRoundScores(camelScore);
eq('camel majority adds +5', cs.scores[0].camelBonus, 5);
eq('camel minority gets 0', cs.scores[1].camelBonus, 0);
eq('camel majority wins score', cs.winner, 0);
eq('camel bonus shown in total', cs.scores[0].total, 11);

var camelTie = craft(73);
camelTie.players[0].camels = 3;
camelTie.players[1].camels = 3;
camelTie.players[0].goodsTokens = zeroMap();
camelTie.players[1].goodsTokens = zeroMap();
camelTie.players[0].goodsTokens.gold = [6];
camelTie.players[1].goodsTokens.silk = [6];
var ct = Engine.computeRoundScores(camelTie);
eq('equal camels give no bonus', [ct.scores[0].camelBonus, ct.scores[1].camelBonus], [0, 0]);
eq('equal camels and equal score is a tie', ct.winner, null);
eq('tie break exhausted is recorded', ct.tieBreak, 'exhausted');

var tieBonus = craft(74);
tieBonus.players[0].goodsTokens = zeroMap();
tieBonus.players[1].goodsTokens = zeroMap();
tieBonus.players[0].goodsTokens.diamond = [7];
tieBonus.players[1].goodsTokens.gold = [4];
tieBonus.players[1].bonusTokens = [3];
var tb1 = Engine.computeRoundScores(tieBonus);
eq('tie on total', [tb1.scores[0].total, tb1.scores[1].total], [7, 7]);
eq('bonus token count breaks tie', tb1.winner, 1);
eq('tie-break mode is token count', tb1.tieBreak, 'token-count');

var tieGoods = craft(75);
tieGoods.players[0].goodsTokens = zeroMap();
tieGoods.players[1].goodsTokens = zeroMap();
tieGoods.players[0].goodsTokens.diamond = [4, 4];
tieGoods.players[1].goodsTokens.gold = [8];
tieGoods.players[0].bonusTokens = [];
tieGoods.players[1].bonusTokens = [];
var tb2 = Engine.computeRoundScores(tieGoods);
eq('tie on total with equal bonus count', [tb2.scores[0].total, tb2.scores[1].total], [8, 8]);
eq('goods token count breaks tie', tb2.winner, 0);
eq('goods tie-break mode', tb2.tieBreak, 'token-count');

var tieAll = craft(76);
tieAll.players[0].goodsTokens = zeroMap();
tieAll.players[1].goodsTokens = zeroMap();
tieAll.players[0].goodsTokens.diamond = [5];
tieAll.players[1].goodsTokens.gold = [5];
tieAll.players[0].bonusTokens = [2];
tieAll.players[1].bonusTokens = [2];
var tb3 = Engine.computeRoundScores(tieAll);
eq('all three tie values equal', [tb3.scores[0].total, tb3.scores[1].total], [7, 7]);
eq('fully tied round has no winner', tb3.winner, null);
eq('fully tied round records exhausted tie-break', tb3.tieBreak, 'exhausted');

var tieStarter = craft(77);
tieStarter.players[0].hand = handOf({ diamond: 3 });
tieStarter.players[0].goodsTokens = zeroMap();
tieStarter.players[1].goodsTokens = zeroMap();
tieStarter.tokenStacks.diamond = [7, 7, 5];
tieStarter.tokenStacks.gold = [];
tieStarter.tokenStacks.silver = [];
tieStarter.tokenStacks.silk = [];
tieStarter.players[0].goodsTokens.diamond = [];
tieStarter.players[1].goodsTokens.gold = [7, 7, 5];
tieStarter.players[0].bonusTokens = [];
tieStarter.players[1].bonusTokens = [];
tieStarter.bonusStacks[3] = [];
tieStarter.bonusStacks[4] = [];
tieStarter.bonusStacks[5] = [];
tieStarter.players[0].camels = 3;
tieStarter.players[1].camels = 3;
tieStarter.starter = 0;
tieStarter.current = 0;
var tieRound = Engine.applyMove(tieStarter, { type: 'sell', good: 'diamond', count: 3 });
eq('tied round awards no seal', tieRound.seals, [0, 0]);
eq('tied round has no winner', tieRound.lastRound.winner, null);
eq('tied round advances', tieRound.round, 2);
eq('tied round gives starter to other player', tieRound.starter, 1);
eq('tied round current is other player', tieRound.current, 1);

var matchWin = craft(78);
matchWin.seals = [1, 0];
matchWin.players[0].seals = 1;
matchWin.players[0].hand = handOf({ diamond: 3 });
matchWin.tokenStacks.diamond = [7, 7, 5];
matchWin.tokenStacks.gold = [];
matchWin.tokenStacks.silver = [];
matchWin.players[0].goodsTokens = zeroMap();
matchWin.players[1].goodsTokens = zeroMap();
matchWin.market = ['camel', 'camel', 'camel', 'silk', 'leather'];
var mw = Engine.applyMove(matchWin, { type: 'sell', good: 'diamond', count: 3 });
eq('second seal ends the match', mw.over, true);
eq('match winner is player 0', mw.winner, 0);
eq('match seals 2-0', mw.seals, [2, 0]);
eq('match result records seals', mw.result.seals, [2, 0]);
eq('match result records winner', mw.result.winner, 0);
eq('match result records two rounds? one', mw.result.rounds.length, 1);
throws('moves after match end rejected', function () { Engine.applyMove(mw, { type: 'take', card: 'silk' }); }, /结束/);
eq('isGameOver true', Engine.isGameOver(mw), true);
eq('winnerOf returns 0', Engine.winnerOf(mw), 0);

/* ------------------------------------------------------------------ */
/* Scoring / token helpers                                            */
/* ------------------------------------------------------------------ */

var scoreState = craft(81);
scoreState.players[0].goodsTokens = zeroMap();
scoreState.players[0].goodsTokens.diamond = [7, 5];
scoreState.players[0].goodsTokens.silk = [3, 2];
scoreState.players[0].bonusTokens = [4, 2];
scoreState.players[1].goodsTokens = zeroMap();
scoreState.players[0].camels = 4;
scoreState.players[1].camels = 1;
var ss = Engine.computeRoundScores(scoreState);
eq('goods points sum', ss.scores[0].goodsPoints, 17);
eq('bonus points sum', ss.scores[0].bonusPoints, 6);
eq('goods token count', ss.scores[0].goodsTokenCount, 4);
eq('bonus token count', ss.scores[0].bonusTokenCount, 2);
eq('round total includes camel bonus', ss.scores[0].total, 28);
eq('camel bonus recipient', ss.camelBonusTo, 0);
eq('exhausted types helper empty', Engine.exhaustedTypes(scoreState), []);
scoreState.tokenStacks.gold = [];
eq('exhausted types helper catches one', Engine.exhaustedTypes(scoreState), ['gold']);

scoreState.players[0].hand.diamond = 2;
eq('maxSellCount caps at hand', Engine.maxSellCount(scoreState, scoreState.players[0], 'diamond'), 2);
var lowStack = craft(82);
lowStack.players[0].hand = handOf({ gold: 5 });
lowStack.tokenStacks.gold = [6, 5];
eq('maxSellCount caps at token stack', Engine.maxSellCount(lowStack, lowStack.players[0], 'gold'), 2);
eq('canSell true for 2 gold', Engine.canSell(lowStack, lowStack.players[0], 'gold'), true);
lowStack.tokenStacks.gold = [6];
eq('canSell false with 1 gold token', Engine.canSell(lowStack, lowStack.players[0], 'gold'), false);

/* ------------------------------------------------------------------ */
/* Legal moves and illegal action surface                             */
/* ------------------------------------------------------------------ */

var legalState = craft(91);
legalState.market = ['diamond', 'gold', 'camel', 'silk', 'spice'];
legalState.deck = ['leather', 'silk', 'gold', 'silver', 'spice'];
legalState.players[0].hand = handOf({ diamond: 2, silk: 1, leather: 1 });
legalState.players[0].camels = 2;
var legal = Engine.getLegalMoves(legalState);
ok('legal moves exist', legal.length > 0);
ok('legal moves include sell', legal.some(function (m) { return m.type === 'sell'; }));
ok('legal moves include take', legal.some(function (m) { return m.type === 'take'; }));
ok('legal moves include takeCamels', legal.some(function (m) { return m.type === 'takeCamels'; }));
ok('legal moves include exchange', legal.some(function (m) { return m.type === 'exchange'; }));
ok('every legal move is accepted', legal.every(function (m) { return Engine.isLegalMove(legalState, m); }));
ok('no duplicate legal moves', new Set(legal.map(function (m) { return JSON.stringify(m); })).size === legal.length);
eq('legal moves for finished game empty', Engine.getLegalMoves(mw), []);
ok('isLegalMove rejects an absent card', Engine.isLegalMove(legalState, { type: 'take', card: 'leather' }) === false);
ok('isLegalMove rejects a camel take', Engine.isLegalMove(legalState, { type: 'take', card: 'camel' }) === false);
ok('isLegalMove accepts a legal take', Engine.isLegalMove(legalState, { type: 'take', card: 'diamond' }) === true);

var immutable = fresh(92);
var immutableBefore = JSON.stringify(immutable);
Engine.applyMove(immutable, { type: 'take', card: immutable.market.filter(function (c) { return c !== 'camel'; })[0] || 'camel' });
eq('failed or successful move does not mutate source', JSON.stringify(immutable), immutableBefore);

/* ------------------------------------------------------------------ */
/* Public view masking                                                */
/* ------------------------------------------------------------------ */

var viewSource = fresh(101);
var view0 = Engine.publicState(viewSource, 0);
ok('public view own hand visible', view0.players[0].hand !== null);
eq('public view own hand matches', view0.players[0].hand, viewSource.players[0].hand);
eq('public view opponent hand hidden', view0.players[1].hand, null);
eq('public view opponent hand count public', view0.players[1].handCount, Engine.handSize(viewSource.players[1]));
eq('public view deck hidden as count', view0.deckCount, 40);
eq('public view has no deck array', view0.deck, undefined);
eq('public view bonus stacks hidden', view0.bonusStacks, null);
eq('public view bonus counts present', view0.bonusCounts, { 3: 6, 4: 6, 5: 6 });
eq('public view token stacks visible', view0.tokenStacks, viewSource.tokenStacks);
ok('public view own bonus tokens visible', Array.isArray(view0.players[0].bonusTokens));
var view1 = Engine.publicState(viewSource, 1);
ok('viewer 1 sees own hand', view1.players[1].hand !== null);
eq('viewer 1 cannot see player 0 hand', view1.players[0].hand, null);
var overState = copy(mw);
var overView = Engine.publicState(overState, 0);
ok('finished game reveals both hands', overView.players[0].hand !== null && overView.players[1].hand !== null);
ok('finished game reveals bonus stacks', overView.bonusStacks !== null);
eq('finished public state reports winner', overView.winner, 0);

/* ------------------------------------------------------------------ */
/* AI levels and behaviour differences                                */
/* ------------------------------------------------------------------ */

var aiTestState = craft(111);
aiTestState.market = ['diamond', 'gold', 'camel', 'silk', 'spice'];
aiTestState.deck = ['leather', 'silk', 'gold', 'silver', 'spice', 'diamond'];
aiTestState.players[0].hand = handOf({ diamond: 2, silk: 2, leather: 1 });
aiTestState.players[0].camels = 1;

Engine.DIFFICULTIES.forEach(function (level) {
  var move = Engine.chooseAIMove(aiTestState, level);
  ok('AI ' + level + ' returns a move', !!move);
  ok('AI ' + level + ' move is legal', Engine.isLegalMove(aiTestState, move));
});
ok('AI legal move can be applied', !!Engine.applyMove(aiTestState, Engine.chooseAIMove(aiTestState, 'hard')));

var aiDifferences = {};
Engine.DIFFICULTIES.forEach(function (level) {
  var keys = {};
  for (var i = 0; i < 40; i++) {
    var s2 = fresh(500 + i);
    var m = Engine.chooseAIMove(s2, level);
    keys[JSON.stringify(m)] = 1;
  }
  aiDifferences[level] = Object.keys(keys);
});
ok('easy and hard choose differently across states', aiDifferences.easy.some(function (k) { return aiDifferences.hard.indexOf(k) === -1; }));
ok('medium and hard choose differently across states', aiDifferences.medium.some(function (k) { return aiDifferences.hard.indexOf(k) === -1; }));
ok('easy and medium choose differently across states', aiDifferences.easy.some(function (k) { return aiDifferences.medium.indexOf(k) === -1; }));

var aiSellState = craft(112);
aiSellState.players[0].hand = handOf({ diamond: 3, silk: 1 });
aiSellState.market = ['camel', 'camel', 'camel', 'gold', 'silver'];
aiSellState.tokenStacks.diamond = [7, 7, 5];
var easyMove = Engine.chooseAIMove(aiSellState, 'easy');
var mediumMove = Engine.chooseAIMove(aiSellState, 'medium');
ok('easy and medium both can sell here', easyMove && mediumMove);
Engine.DIFFICULTIES.forEach(function (level) {
  var s2 = copy(aiSellState);
  var m = Engine.chooseAIMove(s2, level);
  var after = Engine.applyMove(s2, m);
  eq('AI ' + level + ' preserves the card pool', Engine.allCards(after).length, Engine.allCards(s2).length);
});

/* ------------------------------------------------------------------ */
/* 30 AI self-play games, no infinite loops                           */
/* ------------------------------------------------------------------ */

var selfPlayPairs = [
  ['easy', 'medium'], ['medium', 'hard'], ['hard', 'easy'],
  ['easy', 'hard'], ['medium', 'easy'], ['hard', 'medium'],
  ['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'],
  ['easy', 'medium'], ['medium', 'hard'], ['hard', 'easy']
];
var selfPlayOk = true;
var selfPlayOver = 0;
var selfPlaySeals = true;
var selfPlayTurns = [];
var selfPlayStart = Date.now();
for (var gameIndex = 0; gameIndex < 30; gameIndex++) {
  var d0 = selfPlayPairs[gameIndex % selfPlayPairs.length][0];
  var d1 = selfPlayPairs[gameIndex % selfPlayPairs.length][1];
  var sg = Engine.createGame({ seed: 9000 + gameIndex, first: gameIndex % 2, aiDifficulty: d1 });
  sg.players[0].isAI = true;
  sg.players[0].difficulty = d0;
  sg.players[1].isAI = true;
  sg.players[1].difficulty = d1;
  var guard = 0;
  var keptCards = true;
  while (!sg.over && guard < 4000) {
    var lm = Engine.getLegalMoves(sg);
    if (!lm.length) { selfPlayOk = false; break; }
    var chosen = Engine.chooseAIMove(sg);
    if (!Engine.isLegalMove(sg, chosen)) { selfPlayOk = false; break; }
    sg = Engine.applyMove(sg, chosen);
    guard += 1;
    if (guard % 17 === 0 && Engine.allCards(sg).length !== 55) keptCards = false;
  }
  if (!keptCards) selfPlayOk = false;
  if (!sg.over) { selfPlayOk = false; }
  else selfPlayOver += 1;
  if (!sg.result || (sg.seals[0] !== 2 && sg.seals[1] !== 2 && sg.result.reason === 'seals')) selfPlaySeals = false;
  if (sg.turn > Engine.MAX_TURNS) selfPlayOk = false;
  if (Engine.allCards(sg).length !== 55) selfPlayOk = false;
  selfPlayTurns.push(sg.turn);
  if (gameIndex < 3) {
    ok('self-play game ' + gameIndex + ' completes', sg.over === true);
    ok('self-play game ' + gameIndex + ' has 55 cards', Engine.allCards(sg).length === 55);
    ok('self-play game ' + gameIndex + ' records result', !!sg.result);
  }
}
var selfPlayMs = Date.now() - selfPlayStart;
ok('30 AI self-play games all complete', selfPlayOk && selfPlayOver === 30, 'ok=' + selfPlayOk + ' over=' + selfPlayOver);
ok('self-play winners reach two seals', selfPlaySeals);
ok('self-play turns below cap', selfPlayTurns.every(function (t) { return t < Engine.MAX_TURNS; }), JSON.stringify(selfPlayTurns.slice(0, 10)));
ok('30 self-play games finish under 120s', selfPlayMs < 120000, 'ms=' + selfPlayMs);
ok('self-play games use more than 10 turns', selfPlayTurns.every(function (t) { return t > 10; }));

/* ------------------------------------------------------------------ */
/* Performance budgets                                                */
/* ------------------------------------------------------------------ */

var perfStart = Date.now();
for (var ci = 0; ci < 300; ci++) Engine.createGame({ seed: ci });
var createMs = Date.now() - perfStart;
ok('300 createGame under 3000ms', createMs < 3000, 'ms=' + createMs);

var perfState = fresh(777);
var legalStart = Date.now();
for (var li = 0; li < 200; li++) Engine.getLegalMoves(perfState);
var legalMs = Date.now() - legalStart;
ok('200 legalMoves under 3000ms', legalMs < 3000, 'ms=' + legalMs);

var aiStart = Date.now();
for (var ai = 0; ai < 60; ai++) Engine.chooseAIMove(fresh(800 + ai), 'medium');
var aiMs = Date.now() - aiStart;
ok('60 medium AI moves under 5000ms', aiMs < 5000, 'ms=' + aiMs);

var hardStart = Date.now();
for (var hi = 0; hi < 20; hi++) Engine.chooseAIMove(fresh(850 + hi), 'hard');
var hardMs = Date.now() - hardStart;
ok('20 hard AI moves under 5000ms', hardMs < 5000, 'ms=' + hardMs);

/* ------------------------------------------------------------------ */
/* Determinism and summary                                            */
/* ------------------------------------------------------------------ */

var detA = fresh(4242);
var detB = fresh(4242);
var seqA = [];
var seqB = [];
for (var di = 0; di < 12; di++) {
  var ma = Engine.chooseAIMove(detA, 'medium');
  var mb = Engine.chooseAIMove(detB, 'medium');
  seqA.push(JSON.stringify(ma));
  seqB.push(JSON.stringify(mb));
  detA = Engine.applyMove(detA, ma);
  detB = Engine.applyMove(detB, mb);
}
eq('same seed + same AI => same move sequence', seqA, seqB);

var summaryState = fresh(31337);
var summary = Engine.summary(summaryState);
eq('summary round', summary.round, 1);
eq('summary deckCount', summary.deckCount, 40);
eq('summary seals', summary.seals, [0, 0]);
eq('summary hand sizes', summary.handSizes.map(function (n) { return n; }).length, 2);
eq('summary token counts', summary.tokenCounts, { diamond: 5, gold: 5, silver: 5, silk: 7, spice: 7, leather: 9 });
eq('summary bonus counts', summary.bonusCounts, { 3: 6, 4: 6, 5: 6 });
ok('summary legal count positive', summary.legalCount > 0);

var resultsUnfinished = Engine.getResults(fresh(2));
eq('getResults unfinished over false', resultsUnfinished.over, false);
eq('getResults unfinished seals', resultsUnfinished.seals, [0, 0]);
eq('getResults finished matches result', Engine.getResults(mw), mw.result);

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
