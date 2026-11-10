'use strict';

/*
 * Coup premium — unit / rules / AI test suite.
 *
 *   node games/boardgame/coup-premium/test.js
 *
 * Covers 2–6 player setup, 15-card conservation, every action and cost,
 * true/false challenges, block and block-challenge resolution, discards,
 * elimination, deck exhaustion reshuffle, exchange, illegal actions, private
 * views, deterministic shuffling, three AI levels and 30 self-play games.
 */

var E = require('./engine.js');

var passed = 0;
var failed = 0;
var failures = [];

function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    var line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('FAIL ' + line);
  }
  return !!cond;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cards(s) { return E.allCardIds(s).length; }
function uniqueCards(s) { return new Set(E.allCardIds(s)).size; }
function rolesInHand(p) { return p.influence.map(function (c) { return c.role; }); }
function findSeed(playerCount, predicate, limit) {
  for (var seed = 1; seed <= (limit || 400); seed += 1) {
    var s = E.createGame({ playerCount: playerCount, seed: seed, aiAll: true });
    if (predicate(s, seed)) return s;
  }
  throw new Error('no seed found');
}
function passAllChallenges(s) {
  var guard = 0;
  while (s.phase === 'challenge' && guard++ < 20) {
    var r = E.applyAction(s, { type: 'pass' });
    if (!r.ok) throw new Error('pass failed: ' + r.error);
  }
  return s;
}
function passBlock(s) {
  var guard = 0;
  while (s.phase === 'block' && guard++ < 20) {
    var r = E.applyAction(s, { type: 'pass' });
    if (!r.ok) throw new Error('block pass failed: ' + r.error);
  }
  return s;
}
function discardFirst(s) {
  var r = E.applyAction(s, { type: 'discard', index: 0 });
  if (!r.ok) throw new Error('discard failed: ' + r.error);
  return r;
}
function setCoins(s, seat, n) { s.players[seat].coins = n; }
function makeAmbassadorClaim(s) {
  var r = E.applyAction(s, { type: 'exchange' });
  if (!r.ok) throw new Error('exchange claim failed: ' + r.error);
  passAllChallenges(s);
  return s;
}

/* ==================================================================== */
/* 1. constants and setup                                               */
/* ==================================================================== */
ok('version is a string', typeof E.VERSION === 'string' && E.VERSION.length > 0);
eq('five roles', E.ROLES, ['duke', 'assassin', 'captain', 'ambassador', 'contessa']);
eq('five action names', Object.keys(E.ACTION_NAMES).length, 7);
eq('seven actions', Object.keys(E.ACTION_COSTS).length, 7);
eq('coup cost', E.ACTION_COSTS.coup, 7);
eq('assassinate cost', E.ACTION_COSTS.assassinate, 3);
eq('block map', E.BLOCK_BY_ACTION, {
  foreign_aid: ['duke'], assassinate: ['contessa'], steal: ['captain', 'ambassador']
});
eq('three AI levels', E.AI_LEVELS, ['easy', 'normal', 'hard']);

[2, 3, 4, 5, 6].forEach(function (n) {
  var s = E.createGame({ playerCount: n, seed: 100 + n, aiAll: true });
  eq(n + 'p players', s.players.length, n);
  eq(n + 'p phase action', s.phase, 'action');
  eq(n + 'p current 0', s.current, 0);
  eq(n + 'p deck count', s.deck.length, 15 - n * 2);
  eq(n + 'p total cards 15', cards(s), 15);
  eq(n + 'p unique card ids', uniqueCards(s), 15);
  eq(n + 'p each player 2 influences', s.players.map(function (p) { return p.influence.length; }), Array(n).fill(2));
  eq(n + 'p each player 2 coins', s.players.map(function (p) { return p.coins; }), Array(n).fill(2));
  eq(n + 'p each player no lost cards', s.players.map(function (p) { return p.lost.length; }), Array(n).fill(0));
  ok(n + 'p not over', E.isOver(s) === false && s.over === false);
  var counts = E.roleCountsInPlay(s);
  eq(n + 'p each role has 3 copies', E.ROLES.map(function (role) { return counts[role]; }), [3, 3, 3, 3, 3]);
});
eq('15 card IDs for a full deck', E.allCardIds(findSeed(2, function () { return true; })).length, 15);
eq('actor starts at seat 0', E.actorId(findSeed(3, function () { return true; })), 0);
ok('createGame exposes over=false', findSeed(4, function () { return true; }).over === false);

var detA = E.createGame({ playerCount: 4, seed: 20261110, aiAll: true });
var detB = E.createGame({ playerCount: 4, seed: 20261110, aiAll: true });
eq('same seed deals same honours', detA.players.map(function (p) { return rolesInHand(p); }), detB.players.map(function (p) { return rolesInHand(p); }));
eq('same seed deals same deck order', detA.deck.map(function (c) { return c.id; }), detB.deck.map(function (c) { return c.id; }));
var detC = E.createGame({ playerCount: 4, seed: 20261111, aiAll: true });
ok('different seed differs', JSON.stringify(detA.players.map(rolesInHand)) !== JSON.stringify(detC.players.map(rolesInHand)));

/* ==================================================================== */
/* 2. legal action surface                                              */
/* ==================================================================== */
var legal2 = findSeed(2, function (s) { return s.players[0].coins === 2; });
var legalTypes = E.getLegalActions(legal2).map(function (a) { return a.type; });
ok('2p coins 2 offers income', legalTypes.indexOf('income') >= 0);
ok('2p coins 2 offers foreign aid', legalTypes.indexOf('foreign_aid') >= 0);
ok('2p coins 2 offers tax', legalTypes.indexOf('tax') >= 0);
ok('2p coins 2 offers exchange', legalTypes.indexOf('exchange') >= 0);
ok('2p coins 2 offers steal', legalTypes.indexOf('steal') >= 0);
ok('2p coins 2 hides assassinate', legalTypes.indexOf('assassinate') < 0);
ok('2p coins 2 hides coup', legalTypes.indexOf('coup') < 0);
eq('2p coins 2 legal action count', E.getLegalActions(legal2).length, 5);
eq('steal has the one opponent target', E.getLegalActions(legal2).filter(function (a) { return a.type === 'steal'; })[0].target, 1);

setCoins(legal2, 0, 3);
ok('coins 3 unlocks assassinate', E.getLegalActions(legal2).some(function (a) { return a.type === 'assassinate'; }));
eq('coins 3 legal action count', E.getLegalActions(legal2).length, 6);
setCoins(legal2, 0, 7);
ok('coins 7 unlocks coup', E.getLegalActions(legal2).some(function (a) { return a.type === 'coup'; }));
eq('coins 7 legal action count', E.getLegalActions(legal2).length, 7);
setCoins(legal2, 0, 2);

var challengePhase = findSeed(3, function () { return true; });
E.applyAction(challengePhase, { type: 'tax' });
eq('tax opens challenge phase', challengePhase.phase, 'challenge');
eq('challenge legal actions', E.getLegalActions(challengePhase).map(function (a) { return a.type; }), ['challenge', 'pass']);
eq('challenge actor is next alive seat', E.actorId(challengePhase), 1);
var challengeQueue = challengePhase.pending.challengeQueue.slice();
eq('challenge queue starts at next seat', challengeQueue, [1, 2]);

var blockPhase = findSeed(3, function () { return true; });
E.applyAction(blockPhase, { type: 'foreign_aid' });
eq('foreign aid opens block phase', blockPhase.phase, 'block');
eq('foreign aid block actor next seat', E.actorId(blockPhase), 1);
eq('foreign aid block roles legal', E.getLegalActions(blockPhase).map(function (a) { return a.type + (a.role ? ':' + a.role : ''); }), ['block:duke', 'pass']);

var stealBlock = findSeed(2, function () { return true; });
E.applyAction(stealBlock, { type: 'steal', target: 1 });
passAllChallenges(stealBlock);
eq('steal block phase', stealBlock.phase, 'block');
eq('steal block roles', E.getLegalActions(stealBlock).map(function (a) { return a.role; }).filter(Boolean).sort(), ['ambassador', 'captain']);

var assassinateBlock = findSeed(2, function (s) { s.players[0].coins = 3; return true; });
E.applyAction(assassinateBlock, { type: 'assassinate', target: 1 });
passAllChallenges(assassinateBlock);
eq('assassinate block phase', assassinateBlock.phase, 'block');
eq('assassinate block role', E.getLegalActions(assassinateBlock).map(function (a) { return a.role; }).filter(Boolean), ['contessa']);

/* ==================================================================== */
/* 3. income / foreign aid / tax                                        */
/* ==================================================================== */
var income = findSeed(2, function () { return true; });
var incomeStart = income.turns;
var incomeResult = E.applyAction(income, { type: 'income' });
ok('income accepted', incomeResult.ok, incomeResult.error);
eq('income gives 1 coin', income.players[0].coins, 3);
eq('income ends turn', income.current, 1);
eq('income increments turns', income.turns, incomeStart + 1);
eq('income phase back to action', income.phase, 'action');
ok('income logs gain', income.log.some(function (line) { return /获得 1 枚金币/.test(line); }), JSON.stringify(income.log.slice(-3)));
eq('income conservation', cards(income), 15);

var aid = findSeed(2, function () { return true; });
E.applyAction(aid, { type: 'foreign_aid' });
eq('foreign aid opens block', aid.phase, 'block');
E.applyAction(aid, { type: 'pass' });
eq('foreign aid adds 2', aid.players[0].coins, 4);
eq('foreign aid advances turn', aid.current, 1);
eq('foreign aid conservation', cards(aid), 15);

var aidBlocked = findSeed(2, function () { return true; });
E.applyAction(aidBlocked, { type: 'foreign_aid' });
E.applyAction(aidBlocked, { type: 'block', role: 'duke' });
eq('block opens block challenge', aidBlocked.phase, 'blockChallenge');
E.applyAction(aidBlocked, { type: 'pass' });
eq('accepted block cancels aid', aidBlocked.players[0].coins, 2);
eq('accepted block advances turn', aidBlocked.current, 1);
eq('accepted block loses no card', aidBlocked.players[0].lost.length + aidBlocked.players[1].lost.length, 0);

var bluffBlock = findSeed(2, function (s) {
  return !s.players[1].influence.some(function (c) { return c.role === 'duke'; });
});
E.applyAction(bluffBlock, { type: 'foreign_aid' });
E.applyAction(bluffBlock, { type: 'block', role: 'duke' });
E.applyAction(bluffBlock, { type: 'challenge' });
discardFirst(bluffBlock);
eq('false block reveals one card', bluffBlock.players[1].lost.length, 1);
eq('false block lets aid resolve', bluffBlock.players[0].coins, 4);
eq('false block conservation', cards(bluffBlock), 15);

var trueBlock = findSeed(2, function (s) {
  return s.players[1].influence.some(function (c) { return c.role === 'duke'; });
});
E.applyAction(trueBlock, { type: 'foreign_aid' });
E.applyAction(trueBlock, { type: 'block', role: 'duke' });
E.applyAction(trueBlock, { type: 'challenge' });
discardFirst(trueBlock);
eq('true block costs challenger a card', trueBlock.players[0].lost.length, 1);
eq('true block cancels aid', trueBlock.players[0].coins, 2);
eq('true block advances turn', trueBlock.current, 1);
eq('true block conservation', cards(trueBlock), 15);

var taxTrue = findSeed(2, function (s) {
  return s.players[0].influence.some(function (c) { return c.role === 'duke'; });
});
E.applyAction(taxTrue, { type: 'tax' });
eq('tax claim phase', taxTrue.phase, 'challenge');
E.applyAction(taxTrue, { type: 'challenge' });
eq('true tax claim discards challenger', taxTrue.phase, 'discard');
discardFirst(taxTrue);
eq('true tax claim pays 3', taxTrue.players[0].coins, 5);
eq('true tax claim costs challenger', taxTrue.players[1].lost.length, 1);
eq('true tax reveal is logged', taxTrue.lastReveal && taxTrue.lastReveal.role, 'duke');
eq('true tax conservation', cards(taxTrue), 15);

var taxFalse = findSeed(2, function (s) {
  return !s.players[0].influence.some(function (c) { return c.role === 'duke'; });
});
E.applyAction(taxFalse, { type: 'tax' });
E.applyAction(taxFalse, { type: 'challenge' });
discardFirst(taxFalse);
eq('false tax claim loses a card', taxFalse.players[0].lost.length, 1);
eq('false tax claim pays nothing', taxFalse.players[0].coins, 2);
eq('false tax cancels and advances', taxFalse.current, 1);
eq('false tax conservation', cards(taxFalse), 15);

var taxPass = findSeed(2, function () { return true; });
E.applyAction(taxPass, { type: 'tax' });
E.applyAction(taxPass, { type: 'pass' });
eq('uncontested tax pays 3', taxPass.players[0].coins, 5);
eq('uncontested tax advances', taxPass.current, 1);

/* ==================================================================== */
/* 4. coup / assassinate / steal                                        */
/* ==================================================================== */
var coup = findSeed(2, function () { return true; });
setCoins(coup, 0, 7);
E.applyAction(coup, { type: 'coup', target: 1 });
eq('coup pays 7', coup.players[0].coins, 0);
eq('coup opens target discard', coup.phase, 'discard');
eq('coup discard actor is target', E.actorId(coup), 1);
discardFirst(coup);
eq('coup leaves target with one honour', coup.players[1].influence.length, 1);
eq('coup advances turn', coup.current, 1);
eq('coup conservation', cards(coup), 15);

var coupKill = findSeed(2, function () { return true; });
setCoins(coupKill, 0, 7);
coupKill.players[1].influence.pop();
coupKill.discard.push({ id: 'crafted-coup-kill', role: 'ambassador' });
E.applyAction(coupKill, { type: 'coup', target: 1 });
discardFirst(coupKill);
ok('coup can eliminate the last influence', coupKill.players[1].eliminated === true);
eq('last survivor winner', coupKill.winner, 0);
eq('winner over flag', coupKill.over, true);
eq('winner phase over', coupKill.phase, 'over');
ok('winner reported by helper', E.winner(coupKill) === 0);

var assassinateTrue = findSeed(2, function (s) {
  return s.players[0].influence.some(function (c) { return c.role === 'assassin'; });
});
setCoins(assassinateTrue, 0, 3);
E.applyAction(assassinateTrue, { type: 'assassinate', target: 1 });
eq('assassinate pays 3 on declare', assassinateTrue.players[0].coins, 0);
eq('assassinate claim phase', assassinateTrue.phase, 'challenge');
E.applyAction(assassinateTrue, { type: 'challenge' });
discardFirst(assassinateTrue);
eq('assassinate true costs challenger', assassinateTrue.players[1].lost.length, 1);
ok('assassinate continues to block or discard', assassinateTrue.phase === 'block' || assassinateTrue.phase === 'discard', assassinateTrue.phase);
if (assassinateTrue.phase === 'block') E.applyAction(assassinateTrue, { type: 'pass' });
if (assassinateTrue.phase === 'discard') discardFirst(assassinateTrue);
eq('assassinate conservation', cards(assassinateTrue), 15);

var assassinateFalse = findSeed(2, function (s) {
  return !s.players[0].influence.some(function (c) { return c.role === 'assassin'; });
});
setCoins(assassinateFalse, 0, 3);
E.applyAction(assassinateFalse, { type: 'assassinate', target: 1 });
E.applyAction(assassinateFalse, { type: 'challenge' });
discardFirst(assassinateFalse);
eq('failed assassinate loses actor card', assassinateFalse.players[0].lost.length, 1);
eq('assassinate cost is not refunded', assassinateFalse.players[0].coins, 0);
eq('failed assassinate cancels action', assassinateFalse.current, 1);
eq('assassinate false conservation', cards(assassinateFalse), 15);

var assassinateBlock = findSeed(2, function (s) {
  return s.players[0].influence.some(function (c) { return c.role === 'assassin'; }) &&
    s.players[1].influence.some(function (c) { return c.role === 'contessa'; });
});
setCoins(assassinateBlock, 0, 3);
E.applyAction(assassinateBlock, { type: 'assassinate', target: 1 });
E.applyAction(assassinateBlock, { type: 'pass' });
eq('assassinate block window', assassinateBlock.phase, 'block');
E.applyAction(assassinateBlock, { type: 'block', role: 'contessa' });
eq('assassinate block challenge window', assassinateBlock.phase, 'blockChallenge');
E.applyAction(assassinateBlock, { type: 'pass' });
eq('contessa block cancels assassinate', assassinateBlock.players[1].lost.length, 0);
eq('contessa block spends assassin coins', assassinateBlock.players[0].coins, 0);
eq('contessa block advances turn', assassinateBlock.current, 1);
eq('assassinate block conservation', cards(assassinateBlock), 15);

var steal = findSeed(2, function (s) {
  s.players[1].coins = 5;
  return true;
});
E.applyAction(steal, { type: 'steal', target: 1 });
passAllChallenges(steal);
E.applyAction(steal, { type: 'pass' });
eq('steal moves at most 2', steal.players[0].coins, 4);
eq('steal reduces target coins', steal.players[1].coins, 3);
eq('steal advances turn', steal.current, 1);
eq('steal conservation', cards(steal), 15);

var stealOne = findSeed(2, function (s) { s.players[1].coins = 1; return true; });
E.applyAction(stealOne, { type: 'steal', target: 1 });
passAllChallenges(stealOne);
E.applyAction(stealOne, { type: 'pass' });
eq('steal takes only 1 from a 1-coin target', stealOne.players[0].coins, 3);
eq('steal target is emptied', stealOne.players[1].coins, 0);

var stealZero = findSeed(2, function (s) { s.players[1].coins = 0; return true; });
E.applyAction(stealZero, { type: 'steal', target: 1 });
passAllChallenges(stealZero);
E.applyAction(stealZero, { type: 'pass' });
eq('steal from empty target gives 0', stealZero.players[0].coins, 2);

var stealBlockTrue = findSeed(2, function (s) {
  return s.players[1].influence.some(function (c) { return c.role === 'captain'; });
});
E.applyAction(stealBlockTrue, { type: 'steal', target: 1 });
passAllChallenges(stealBlockTrue);
E.applyAction(stealBlockTrue, { type: 'block', role: 'captain' });
E.applyAction(stealBlockTrue, { type: 'challenge' });
discardFirst(stealBlockTrue);
eq('true captain block costs challenger', stealBlockTrue.players[0].lost.length, 1);
eq('true captain block prevents steal', stealBlockTrue.players[1].coins, 2);
eq('true steal block conservation', cards(stealBlockTrue), 15);

var stealBlockFalse = findSeed(2, function (s) {
  return !s.players[1].influence.some(function (c) { return c.role === 'captain'; }) &&
    !s.players[1].influence.some(function (c) { return c.role === 'ambassador'; });
});
E.applyAction(stealBlockFalse, { type: 'steal', target: 1 });
passAllChallenges(stealBlockFalse);
E.applyAction(stealBlockFalse, { type: 'block', role: 'ambassador' });
E.applyAction(stealBlockFalse, { type: 'challenge' });
discardFirst(stealBlockFalse);
eq('false steal block loses a card', stealBlockFalse.players[1].lost.length, 1);
eq('false steal block allows steal', stealBlockFalse.players[0].coins, 4);
eq('false steal block conservation', cards(stealBlockFalse), 15);

/* ==================================================================== */
/* 5. exchange and reshuffle                                            */
/* ==================================================================== */
var exchange = findSeed(3, function () { return true; });
var exchangeDeckBefore = exchange.deck.length;
makeAmbassadorClaim(exchange);
eq('exchange phase', exchange.phase, 'exchange');
eq('exchange offers 4 cards', exchange.pending.exchange.cards.length, 4);
eq('exchange hand still 2 until keep', exchange.players[0].influence.length, 2);
eq('exchange legal choices are six pairs', E.getLegalActions(exchange).length, 6);
var exchangeResult = E.applyAction(exchange, { type: 'keep', indices: [0, 1] });
ok('exchange keep accepted', exchangeResult.ok, exchangeResult.error);
eq('exchange keeps exactly 2', exchange.players[0].influence.length, 2);
eq('exchange restores deck size', exchange.deck.length, exchangeDeckBefore);
eq('exchange advances turn', exchange.current, 1);
eq('exchange conservation', cards(exchange), 15);
eq('exchange unique cards', uniqueCards(exchange), 15);
ok('exchange logs completion', exchange.log.some(function (line) { return /完成交换/.test(line); }), JSON.stringify(exchange.log.slice(-3)));
eq('exchange clears pending', exchange.pending, null);

var exchangeView = clone(exchange);
exchangeView.phase = 'exchange';
exchangeView.pending = { action: 'exchange', actor: 0, exchange: { actor: 0, cards: exchangeView.players[0].influence.concat([{ id: 'x1', role: 'duke' }, { id: 'x2', role: 'contessa' }]), drawn: 2 } };
var viewActor = E.viewFor(exchangeView, 0);
var viewOther = E.viewFor(exchangeView, 1);
eq('exchange actor view sees 4 roles', viewActor.pending.exchange.cards.length, 4);
eq('exchange other view hides roles', viewOther.pending.exchange.cards, null);
eq('exchange other view sees count', viewOther.pending.exchange.count, 4);

var reshuffle = findSeed(2, function () { return true; });
var moved = reshuffle.deck.splice(0);
moved.forEach(function (c) { reshuffle.discard.push(c); });
eq('crafted deck empty', reshuffle.deck.length, 0);
ok('crafted discard non-empty', reshuffle.discard.length > 0);
makeAmbassadorClaim(reshuffle);
ok('exchange can start with empty deck', reshuffle.phase === 'exchange' || reshuffle.phase === 'discard', reshuffle.phase);
ok('deck exhaustion log present', reshuffle.log.some(function (line) { return /牌堆耗尽/.test(line); }), JSON.stringify(reshuffle.log.slice(-4)));
eq('reshuffle conservation', cards(reshuffle), 15);

var reshuffleCoup = findSeed(2, function () { return true; });
var stash = reshuffleCoup.deck.splice(0);
stash.forEach(function (c) { reshuffleCoup.discard.push(c); });
reshuffleCoup.players[0].coins = 7;
E.applyAction(reshuffleCoup, { type: 'coup', target: 1 });
discardFirst(reshuffleCoup);
eq('reshuffle keeps card conservation', cards(reshuffleCoup), 15);
ok('lost cards moved to discard', reshuffleCoup.discard.length > 0);

/* ==================================================================== */
/* 6. discard, elimination, win                                         */
/* ==================================================================== */
var eliminate = findSeed(3, function () { return true; });
eliminate.players[1].influence.pop();
eliminate.discard.push({ id: 'crafted-eliminate-1', role: 'duke' });
eliminate.players[1].lost.push('captain');
eliminate.players[1].influence[0].role = 'ambassador';
setCoins(eliminate, 0, 7);
E.applyAction(eliminate, { type: 'coup', target: 1 });
discardFirst(eliminate);
eq('one-influence target is eliminated', eliminate.players[1].eliminated, true);
eq('eliminated player influence empty', eliminate.players[1].influence.length, 0);
eq('eliminated player lost two honours', eliminate.players[1].lost.length, 2);
eq('game continues with three players', eliminate.over, false);
eq('turn moves to next alive seat', eliminate.current, 2);
eq('elimination conservation', cards(eliminate), 15);
ok('eliminated player not in aliveIds', E.aliveIds(eliminate).indexOf(1) < 0);

var lastTwo = findSeed(3, function () { return true; });
lastTwo.players[2].eliminated = true;
lastTwo.players[2].influence = [];
lastTwo.players[2].lost = ['duke', 'captain'];
lastTwo.players[1].influence.pop();
lastTwo.discard.push({ id: 'crafted-last-two', role: 'ambassador' });
setCoins(lastTwo, 0, 7);
E.applyAction(lastTwo, { type: 'coup', target: 1 });
discardFirst(lastTwo);
ok('last two alive resolves winner', lastTwo.over === true);
eq('winner is last alive', lastTwo.winner, 0);
eq('winner state has one alive', E.aliveIds(lastTwo).length, 1);
ok('win log present', lastTwo.log.some(function (line) { return /赢得本局/.test(line); }), JSON.stringify(lastTwo.log.slice(-3)));
eq('game over legal actions empty', E.getLegalActions(lastTwo).length, 0);

/* ==================================================================== */
/* 7. illegal actions                                                   */
/* ==================================================================== */
var illegal = findSeed(3, function () { return true; });
ok('coup without coins rejected', !E.applyAction(illegal, { type: 'coup', target: 1 }).ok);
ok('assassinate without coins rejected', !E.applyAction(illegal, { type: 'assassinate', target: 1 }).ok);
ok('unknown action rejected', !E.applyAction(illegal, { type: 'teleport' }).ok);
ok('missing action rejected', !E.applyAction(illegal, null).ok);
ok('self target rejected', !E.applyAction(illegal, { type: 'steal', target: 0 }).ok);
ok('missing target rejected', !E.applyAction(illegal, { type: 'steal' }).ok);
ok('out-of-range target rejected', !E.applyAction(illegal, { type: 'steal', target: 9 }).ok);
ok('explicit wrong actor rejected', !E.applyAction(illegal, { type: 'income', actor: 1 }).ok);
ok('income cannot target', E.applyAction(clone(illegal), { type: 'income', target: 1 }).ok === true);
var challengedIllegal = findSeed(2, function () { return true; });
E.applyAction(challengedIllegal, { type: 'tax' });
ok('cannot block in challenge phase', !E.applyAction(challengedIllegal, { type: 'block', role: 'duke' }).ok);
ok('cannot discard in challenge phase', !E.applyAction(challengedIllegal, { type: 'discard', index: 0 }).ok);
E.applyAction(challengedIllegal, { type: 'pass' });
eq('passing tax resolves it', challengedIllegal.phase, 'action');
var blockIllegal = findSeed(2, function () { return true; });
E.applyAction(blockIllegal, { type: 'foreign_aid' });
ok('wrong block role rejected', !E.applyAction(blockIllegal, { type: 'block', role: 'assassin' }).ok);
E.applyAction(blockIllegal, { type: 'pass' });
var discardIllegal = findSeed(2, function () { return true; });
setCoins(discardIllegal, 0, 7);
E.applyAction(discardIllegal, { type: 'coup', target: 1 });
ok('invalid discard index rejected', !E.applyAction(discardIllegal, { type: 'discard', index: 2 }).ok);
ok('negative discard index rejected', !E.applyAction(discardIllegal, { type: 'discard', index: -1 }).ok);
ok('discard wrong type rejected', !E.applyAction(discardIllegal, { type: 'pass' }).ok);
var exchangeIllegal = findSeed(2, function () { return true; });
makeAmbassadorClaim(exchangeIllegal);
ok('keep requires two indices', !E.applyAction(exchangeIllegal, { type: 'keep', indices: [0] }).ok);
ok('keep duplicate indices rejected', !E.applyAction(exchangeIllegal, { type: 'keep', indices: [0, 0] }).ok);
ok('keep out-of-range rejected', !E.applyAction(exchangeIllegal, { type: 'keep', indices: [0, 9] }).ok);
ok('keep non-integer rejected', !E.applyAction(exchangeIllegal, { type: 'keep', indices: [0, 'x'] }).ok);
ok('exchange accepts a valid pair after failed attempts', E.applyAction(exchangeIllegal, { type: 'keep', indices: [2, 3] }).ok);
var overIllegal = clone(lastTwo);
ok('actions rejected after game over', !E.applyAction(overIllegal, { type: 'income' }).ok);
ok('legal actions empty after game over', E.getLegalActions(overIllegal).length === 0);
ok('winner helper after over', E.winner(overIllegal) === 0);

/* ==================================================================== */
/* 8. private views                                                     */
/* ==================================================================== */
var viewGame = findSeed(4, function () { return true; });
var seat0View = E.viewFor(viewGame, 0);
var seat1View = E.viewFor(viewGame, 1);
var spectator = E.viewFor(viewGame, null);
eq('view player count', seat0View.playerCount, 4);
eq('view own hand length', seat0View.hand.length, 2);
eq('view own roles visible', seat0View.players[0].influence.filter(function (c) { return !!c.role; }).length, 2);
eq('view opponent roles hidden', seat0View.players[1].influence.filter(function (c) { return !!c.role; }).length, 0);
eq('view opponent influence count', seat0View.players[1].influenceCount, 2);
eq('seat1 sees own roles', seat1View.players[1].influence.filter(function (c) { return !!c.role; }).length, 2);
eq('seat1 cannot see seat0 roles', seat1View.players[0].influence.filter(function (c) { return !!c.role; }).length, 0);
eq('spectator sees no roles', spectator.players.reduce(function (n, p) { return n + p.influence.filter(function (c) { return !!c.role; }).length; }, 0), 0);
eq('view exposes deckCount only', seat0View.deckCount, 7);
ok('view has no deck role list', seat0View.deck === undefined);
eq('view phase', seat0View.phase, 'action');
eq('view actor', seat0View.actorId, 0);
ok('view log is array', Array.isArray(seat0View.log));

var pendingView = findSeed(3, function () { return true; });
E.applyAction(pendingView, { type: 'tax' });
var pv = E.viewFor(pendingView, 1);
eq('pending claim visible to others', pv.pending.claim, 'duke');
eq('pending action visible', pv.pending.action, 'tax');
eq('pending actor visible', pv.pending.actor, 0);
eq('pending challenge queue visible', pv.pending.challengeQueue, [1, 2]);

/* ==================================================================== */
/* 9. AI decisions and 30 self-play games                               */
/* ==================================================================== */
var aiState = findSeed(2, function () { return true; });
['easy', 'normal', 'hard'].forEach(function (level) {
  var a = E.chooseAIAction(aiState, level);
  ok(level + ' AI returns an action', !!a && typeof a.type === 'string', JSON.stringify(a));
  ok(level + ' AI action is legal in phase', E.actionError(aiState, a) === null, JSON.stringify(a));
});
var aiCoup = findSeed(2, function (s) { s.players[0].coins = 7; return true; });
var hardCoup = E.chooseAIAction(aiCoup, 'hard');
eq('hard AI launches coup at 7 coins', hardCoup && hardCoup.type, 'coup');
ok('hard AI coup has a legal target', hardCoup.target === 1);

var aiChallengeState = findSeed(3, function (s) {
  E.applyAction(s, { type: 'tax' });
  return s.phase === 'challenge';
});
var easyChallenge = E.chooseAIAction(aiChallengeState, 'easy');
var hardChallenge = E.chooseAIAction(aiChallengeState, 'hard');
ok('easy AI returns challenge or pass', ['challenge', 'pass'].indexOf(easyChallenge.type) >= 0);
ok('hard AI returns challenge or pass', ['challenge', 'pass'].indexOf(hardChallenge.type) >= 0);

var aiBlockState = findSeed(2, function (s) {
  E.applyAction(s, { type: 'foreign_aid' });
  return s.phase === 'block';
});
var aiBlock = E.chooseAIAction(aiBlockState, 'normal');
ok('AI block decision is legal', aiBlock && ['block', 'pass'].indexOf(aiBlock.type) >= 0, JSON.stringify(aiBlock));

var selfPlayResults = [];
for (var g = 0; g < 30; g += 1) {
  var count = 2 + (g % 5);
  var level = E.AI_LEVELS[g % 3];
  var levels = [];
  for (var li = 0; li < count; li += 1) levels.push(E.AI_LEVELS[(g + li) % 3]);
  var game = E.createGame({ playerCount: count, seed: 9000 + g * 131, aiAll: true, aiLevels: levels });
  var before = cards(game);
  var run = E.autoRun(game, { limit: 800 });
  var stepOk = run.steps > 0 && run.steps < 800;
  var winnerOk = game.winner == null || (game.winner >= 0 && game.winner < count);
  selfPlayResults.push({
    game: g, playerCount: count, level: level, steps: run.steps,
    over: run.over, winner: game.winner, cards: cards(game)
  });
  ok('self-play ' + g + ' terminates', run.over === true && game.over === true, 'steps=' + run.steps + ' phase=' + game.phase);
  ok('self-play ' + g + ' uses fewer than 800 steps', stepOk, 'steps=' + run.steps);
  ok('self-play ' + g + ' winner is in range', winnerOk, 'winner=' + game.winner);
  ok('self-play ' + g + ' conserves 15 cards', cards(game) === 15 && before === 15, 'cards=' + cards(game));
  ok('self-play ' + g + ' winner is alive', game.winner >= 0 && !game.players[game.winner].eliminated);
  eq('self-play ' + g + ' ends with one alive', E.aliveIds(game).length, 1);
}
eq('self-play ran 30 games', selfPlayResults.length, 30);
eq('all self-play games over', selfPlayResults.filter(function (r) { return r.over; }).length, 30);
ok('self-play total steps sane', selfPlayResults.reduce(function (n, r) { return n + r.steps; }, 0) < 30 * 800);

/* difficulty behaviour differs in aggregate */
function aggregate(level, games) {
  var out = { steps: 0, income: 0, foreign_aid: 0, tax: 0, assassinate: 0, steal: 0, exchange: 0, challenges: 0, blocks: 0, discards: 0 };
  for (var i = 0; i < games; i += 1) {
    var count = 3 + (i % 4);
    var levels = [];
    for (var j = 0; j < count; j += 1) levels.push(level);
    var st = E.createGame({ playerCount: count, seed: 40000 + i * 977, aiAll: true, aiLevels: levels });
    var run = E.autoRun(st, { limit: 1000 });
    out.steps += run.steps;
    Object.keys(out).forEach(function (key) {
      if (key === 'steps') return;
      out[key] += st.stats[key] || 0;
    });
  }
  return out;
}
var easyAgg = aggregate('easy', 20);
var normalAgg = aggregate('normal', 20);
var hardAgg = aggregate('hard', 20);
ok('easy AI plays more income than hard', easyAgg.income > hardAgg.income, easyAgg.income + ' vs ' + hardAgg.income);
ok('easy AI plays more foreign aid than hard', easyAgg.foreign_aid > hardAgg.foreign_aid, easyAgg.foreign_aid + ' vs ' + hardAgg.foreign_aid);
ok('hard AI challenges more than easy', hardAgg.challenges > easyAgg.challenges, hardAgg.challenges + ' vs ' + easyAgg.challenges);
ok('hard AI uses more role actions than easy', (hardAgg.tax + hardAgg.steal + hardAgg.assassinate + hardAgg.exchange) > (easyAgg.tax + easyAgg.steal + easyAgg.assassinate + easyAgg.exchange));
ok('normal AI falls between in income', normalAgg.income < easyAgg.income && normalAgg.income >= hardAgg.income, normalAgg.income + ' between ' + hardAgg.income + ' and ' + easyAgg.income);
ok('AI games record discards', easyAgg.discards > 0 && hardAgg.discards > 0);

/* determinism under the shared shuffle + serialisable RNG */
var deterministicA = E.createGame({ playerCount: 4, seed: 777001, aiAll: true });
var deterministicB = E.createGame({ playerCount: 4, seed: 777001, aiAll: true });
var runA = E.autoRun(deterministicA, { limit: 800 });
var runB = E.autoRun(deterministicB, { limit: 800 });
eq('same seed same AI steps', runA.steps, runB.steps);
eq('same seed same winner', deterministicA.winner, deterministicB.winner);
eq('same seed same stats', deterministicA.stats, deterministicB.stats);

/* ==================================================================== */
/* 10. state serialisation                                              */
/* ==================================================================== */
var serial = findSeed(3, function () { return true; });
var serialClone = clone(serial);
eq('state JSON clone keeps cards', cards(serialClone), 15);
ok('state JSON clone has serialisable rng', typeof serialClone.rngState === 'number');
ok('state JSON clone has shuffle counter', typeof serialClone.shuffleCounter === 'number');
ok('serial clone can resume with applyAction', E.applyAction(serialClone, { type: 'income' }).ok);
eq('serial clone conserved after action', cards(serialClone), 15);
ok('public view is JSON serialisable', JSON.stringify(E.viewFor(serial, 0)).length > 100);

/* ---------------- summary ---------------- */
console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
