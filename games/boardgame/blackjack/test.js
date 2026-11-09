'use strict';

var Engine = require('./engine.js');

var passed = 0;
var failed = 0;

function ok(cond, name) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error('FAIL: ' + name);
  }
}

function eq(actual, expected, name) {
  ok(Object.is(actual, expected), name + ' (got ' + actual + ', want ' + expected + ')');
}

function c(rank, suit) {
  suit = suit || 'S';
  return { suit: suit, rank: rank, id: Engine.cardId(suit, rank) };
}

// Builds a deck with 20 harmless fillers, followed by the given draw order.
function deckWith(cards) {
  var deck = [];
  for (var i = 0; i < 20; i++) deck.push(c('2', 'C'));
  for (var j = cards.length - 1; j >= 0; j--) deck.push(cards[j]);
  return deck;
}

// Fixed table state for deterministic settlement tests.
function table(playerCards, dealerCards, drawCards) {
  var s = Engine.createGame({ seed: 99 });
  s.phase = 'player';
  s.bet = 10;
  s.chips = 90;
  s.player = playerCards.slice();
  s.dealer = dealerCards.slice();
  s.dealerHidden = true;
  s.deck = deckWith(drawCards || []);
  s.result = null;
  s.message = '';
  s.log = [];
  return s;
}

// ---- Deck / exports ----
var g0 = Engine.createGame({ seed: 42 });
eq(g0.deck.length, 52, 'deck has 52 cards');
var ids = {};
var dupes = 0;
g0.deck.forEach(function (card) {
  if (ids[card.id]) dupes += 1;
  ids[card.id] = true;
});
eq(dupes, 0, 'all 52 cards are unique');
eq(Object.keys(ids).length, 52, '52 unique card ids');
eq(Engine.SUITS.length, 4, 'SUITS has 4 suits');
eq(Engine.RANKS.length, 13, 'RANKS has 13 ranks');
eq(Engine.suitSymbol('H'), '♥', 'suitSymbol hearts');
eq(Engine.suitSymbol('S'), '♠', 'suitSymbol spades');
eq(Engine.rankLabel('K'), 'K', 'rankLabel K');
ok(Engine.isRed('H') && Engine.isRed('D'), 'hearts and diamonds are red');
ok(!Engine.isRed('S') && !Engine.isRed('C'), 'spades and clubs are black');
eq(Engine.cardId('D', '10'), 'D-10', 'cardId is suit-rank');

// ---- Initial state ----
eq(g0.phase, 'bet', 'initial phase is bet');
eq(g0.bet, 0, 'initial bet is 0');
eq(g0.chips, 100, 'initial chips are 100');
eq(g0.result, null, 'initial result is null');
eq(g0.dealerHidden, true, 'initial dealer hole card hidden');
ok(Array.isArray(g0.log) && g0.log.length > 0, 'initial Chinese log exists');
ok(typeof g0.rng === 'function', 'seeded rng stored on state');

// ---- handValue ----
var hv1 = Engine.handValue([c('A'), c('K')]);
eq(hv1.total, 21, 'A+K totals 21');
eq(hv1.soft, true, 'A+K is soft');
var hv2 = Engine.handValue([c('A', 'H'), c('A', 'D'), c('9')]);
eq(hv2.total, 21, 'A+A+9 totals 21 (best value)');
eq(hv2.soft, true, 'A+A+9 is soft');
var hv3 = Engine.handValue([c('A'), c('A')]);
eq(hv3.total, 12, 'A+A totals 12');
eq(hv3.soft, true, 'A+A is soft');
var hv4 = Engine.handValue([c('A'), c('9'), c('5')]);
eq(hv4.total, 15, 'A+9+5 uses ace as 1');
eq(hv4.soft, false, 'A+9+5 is hard');
var hv5 = Engine.handValue([c('10'), c('10'), c('5')]);
eq(hv5.total, 25, '10+10+5 busts at 25');
eq(hv5.soft, false, 'busted hand is not soft');
eq(Engine.handValue([]).total, 0, 'empty hand totals 0');
eq(Engine.handValue([c('K'), c('Q'), c('J')]).total, 30, 'face cards total 30');
eq(Engine.isBlackjack([c('A'), c('10')]), true, 'A+10 is blackjack');
eq(Engine.isBlackjack([c('7'), c('7'), c('7')]), false, 'three-card 21 is not blackjack');
eq(Engine.isBlackjack([c('A'), c('K')]), true, 'A+K is blackjack');

// ---- Bet validation ----
var g1 = Engine.createGame({ seed: 7 });
var r0 = Engine.startRound(g1, 0);
eq(r0.ok, false, 'bet 0 rejected');
ok(/至少/.test(r0.error), 'bet 0 error is Chinese');
eq(Engine.startRound(g1, -5).ok, false, 'negative bet rejected');
eq(Engine.startRound(g1, 1.5).ok, false, 'fractional bet rejected');
eq(Engine.startRound(g1, 101).ok, false, 'bet above chips rejected');
eq(g1.phase, 'bet', 'failed bets keep bet phase');
eq(g1.chips, 100, 'failed bets keep chips');
eq(Engine.hit(g1).ok, false, 'cannot hit during bet phase');
eq(Engine.stand(g1).ok, false, 'cannot stand during bet phase');

// ---- Deal ----
var g2 = Engine.createGame({ seed: 2 });
var deal = Engine.startRound(g2, 10);
eq(deal.ok, true, 'valid bet starts round');
eq(g2.phase, 'player', 'deal enters player phase');
eq(g2.chips, 90, 'bet is deducted from chips');
eq(g2.bet, 10, 'bet recorded');
eq(g2.player.length, 2, 'player has two cards');
eq(g2.dealer.length, 2, 'dealer has two cards');
eq(g2.dealerHidden, true, 'hole card hidden in player phase');
eq(g2.deck.length, 48, 'exactly four cards dealt upfront');
eq(g2.result, null, 'no result during play');

// ---- Dealer stands on 17 ----
var s17 = table([c('10'), c('9')], [c('10'), c('7')], []);
var st17 = Engine.stand(s17);
eq(st17.ok, true, 'stand succeeds');
eq(s17.dealer.length, 2, 'dealer stands on 17 with two cards');
eq(Engine.handValue(s17.dealer).total, 17, 'dealer total is 17');
eq(s17.result, 'player', '19 beats dealer 17');
eq(s17.chips, 110, 'win pays even money (90 + 20)');
eq(s17.phase, 'over', 'round over after stand');
eq(s17.dealerHidden, false, 'hole card revealed after stand');
ok(/胜/.test(s17.message), 'win message is Chinese');

// ---- Dealer hits 16 ----
var s16 = table([c('10'), c('9')], [c('10'), c('6')], [c('2')]);
Engine.stand(s16);
eq(s16.dealer.length, 3, 'dealer draws on 16');
eq(Engine.handValue(s16.dealer).total, 18, 'dealer reaches 18');
eq(s16.result, 'player', 'player 19 beats dealer 18');
eq(s16.chips, 110, 'player wins after dealer draw');

// ---- Dealer busts ----
var sBust = table([c('10'), c('8')], [c('10'), c('6')], [c('10')]);
Engine.stand(sBust);
eq(Engine.handValue(sBust.dealer).total, 26, 'dealer busts at 26');
eq(sBust.result, 'player', 'dealer bust gives player the win');
eq(sBust.chips, 110, 'player paid on dealer bust');

// ---- Push ----
var sPush = table([c('10'), c('7')], [c('10'), c('7')], []);
Engine.stand(sPush);
eq(sPush.result, 'push', 'equal totals push');
eq(sPush.chips, 100, 'push returns the bet');
ok(/平局/.test(sPush.message), 'push message is Chinese');

// ---- Dealer win ----
var sLose = table([c('10'), c('7')], [c('10'), c('9')], []);
Engine.stand(sLose);
eq(sLose.result, 'dealer', 'dealer 19 beats player 17');
eq(sLose.chips, 90, 'loss forfeits the bet');

// ---- Blackjack payout 3:2 ----
var sBJ = table([c('A'), c('K')], [c('9'), c('7')], []);
Engine.stand(sBJ);
eq(sBJ.result, 'blackjack', 'player blackjack result');
eq(sBJ.chips, 115, 'blackjack pays 3:2 on bet 10 (90 + 25)');
eq(sBJ.phase, 'over', 'blackjack round is over');
ok(/黑杰克/.test(sBJ.message), 'blackjack message is Chinese');

// ---- Both blackjack pushes ----
var sBothBJ = table([c('A'), c('K')], [c('A'), c('Q')], []);
Engine.stand(sBothBJ);
eq(sBothBJ.result, 'push', 'both blackjack pushes');
eq(sBothBJ.chips, 100, 'both blackjack returns bet');

// ---- Bust ends round immediately ----
var sHitBust = table([c('10'), c('9')], [c('10'), c('7')], [c('K')]);
var hb = Engine.hit(sHitBust);
eq(hb.ok, true, 'hit is legal in player phase');
eq(sHitBust.player.length, 3, 'hit adds one card');
eq(sHitBust.phase, 'over', 'bust ends round');
eq(sHitBust.result, 'bust', 'bust result recorded');
eq(sHitBust.chips, 90, 'bust loses the bet');
ok(/爆牌/.test(sHitBust.message), 'bust message is Chinese');

// ---- Hit then stand ----
var sHit = table([c('10'), c('2')], [c('10'), c('7')], [c('5')]);
Engine.hit(sHit);
eq(sHit.player.length, 3, 'hit adds card without busting');
eq(Engine.handValue(sHit.player).total, 17, 'player reaches 17 after hit');
eq(sHit.phase, 'player', 'player may continue after non-bust hit');
Engine.stand(sHit);
eq(sHit.result, 'push', '17 vs 17 pushes');
eq(sHit.chips, 100, 'push after hit returns bet');

// ---- Reaching 21 auto-stands ----
var s21 = table([c('10'), c('2')], [c('10'), c('7')], [c('9')]);
Engine.hit(s21);
eq(Engine.handValue(s21.player).total, 21, 'player reaches 21');
eq(s21.phase, 'over', '21 triggers dealer play automatically');
eq(s21.result, 'player', 'player 21 beats dealer 17');
eq(s21.chips, 110, '21 payout is even money');

// ---- AI dealer ----
function dealerState(cards) {
  var s = Engine.createGame({ seed: 3 });
  s.dealer = cards;
  return s;
}
eq(Engine.aiDealerAction(dealerState([c('10'), c('6')])), 'hit', 'dealer hits 16');
eq(Engine.aiDealerAction(dealerState([c('10'), c('7')])), 'stand', 'dealer stands on 17');
eq(Engine.aiDealerAction(dealerState([c('A'), c('6')])), 'stand', 'dealer stands on soft 17');
eq(Engine.aiDealerAction(dealerState([c('10'), c('10'), c('5')])), 'stand', 'dealer stands on bust');

// ---- newRound / reset ----
var g3 = Engine.createGame({ seed: 11 });
Engine.startRound(g3, 20);
Engine.stand(g3);
var chipsAfter = g3.chips;
eq(Engine.checkRoundOver(g3), true, 'checkRoundOver true after settling');
var nr = Engine.newRound(g3);
eq(nr.ok, true, 'newRound allowed after round over');
eq(g3.phase, 'bet', 'newRound returns to bet phase');
eq(g3.bet, 0, 'newRound clears bet');
eq(g3.player.length, 0, 'newRound clears player hand');
eq(g3.dealer.length, 0, 'newRound clears dealer hand');
eq(g3.chips, chipsAfter, 'newRound keeps chips');
eq(g3.result, null, 'newRound clears result');
eq(g3.dealerHidden, true, 'newRound hides dealer hole card');

var g4 = Engine.createGame({ seed: 12 });
Engine.startRound(g4, 5);
var early = Engine.newRound(g4);
eq(early.ok, false, 'newRound rejected during player phase');
Engine.stand(g4);
eq(Engine.startRound(g4, 5).ok, false, 'startRound rejected when over');

var broke = Engine.createGame({ seed: 13 });
broke.chips = 0;
broke.phase = 'over';
var brokeRound = Engine.newRound(broke);
eq(brokeRound.ok, true, 'newRound works at zero chips');
eq(broke.chips, 100, 'zero chips reset to 100');
eq(broke.phase, 'bet', 'reset chips can bet again');

var g5 = Engine.createGame({ seed: 14 });
Engine.startRound(g5, 50);
var rs = Engine.reset(g5);
eq(rs.ok, true, 'reset succeeds');
eq(g5.chips, 100, 'reset restores 100 chips');
eq(g5.phase, 'bet', 'reset returns to bet phase');
eq(g5.player.length, 0, 'reset clears player cards');
eq(g5.deck.length, 52, 'reset rebuilds full deck');

// ---- Reshuffle when low ----
var low = Engine.createGame({ seed: 5 });
low.deck = [c('2'), c('3'), c('4')];
var lowDeal = Engine.startRound(low, 10);
eq(lowDeal.ok, true, 'round starts with low deck');
eq(low.deck.length, 48, 'low deck reshuffled to 52 then four dealt');
ok(low.log.join('|').indexOf('重新洗牌') >= 0, 'reshuffle logged in Chinese');

// ---- 30 auto-played rounds ----
var auto = Engine.createGame({ seed: 777 });
var rounds = 0;
var illegal = 0;
var infinite = 0;
var badOutcome = 0;
var handLengthIssues = 0;
var validResults = ['player', 'dealer', 'push', 'blackjack', 'bust'];

for (var round = 0; round < 30; round++) {
  if (auto.chips < 1) {
    var refill = Engine.newRound(auto);
    if (!refill.ok) illegal += 1;
    if (auto.chips < 1) badOutcome += 1;
  }
  var bet = Math.min(10, auto.chips);
  var sr = Engine.startRound(auto, bet);
  if (!sr.ok) {
    illegal += 1;
    if (auto.phase === 'over') Engine.newRound(auto);
    continue;
  }
  var steps = 0;
  while (auto.phase === 'player' && steps < 50) {
    var total = Engine.handValue(auto.player).total;
    var action = total < 17 ? Engine.hit(auto) : Engine.stand(auto);
    if (!action.ok) illegal += 1;
    steps += 1;
  }
  if (steps >= 50) infinite += 1;
  if (auto.phase !== 'over') badOutcome += 1;
  if (validResults.indexOf(auto.result) < 0) badOutcome += 1;
  if (!isFinite(auto.chips) || auto.chips < 0) badOutcome += 1;
  if (auto.dealer.length < 2 || auto.player.length < 2) handLengthIssues += 1;
  var next = Engine.newRound(auto);
  if (!next.ok) illegal += 1;
  rounds += 1;
}
eq(rounds, 30, '30 rounds were auto-played');
eq(illegal, 0, 'no illegal actions in auto-play');
eq(infinite, 0, 'no infinite loops in auto-play');
eq(badOutcome, 0, 'every auto-played round has a valid finite outcome');
eq(handLengthIssues, 0, 'both hands always hold at least two cards');
ok(isFinite(auto.chips) && auto.chips >= 0, 'chips remain finite and non-negative');
eq(auto.phase, 'bet', 'auto-play returns to bet phase each round');
eq(auto.bet, 0, 'auto-play clears bet after each round');

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
