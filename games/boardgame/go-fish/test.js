'use strict';

var E = require('./engine.js');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error('FAIL: ' + msg);
  }
}

function card(rank, suit) {
  return { rank: rank, suit: suit };
}

function fresh(seed, deck) {
  var g = E.createGame({ seed: seed || 1 });
  g.deck = deck || [card('2', 'D')];
  g.hands = [[], []];
  g.books = [0, 0];
  g.turn = 0;
  g.phase = 'playing';
  g.winner = null;
  g.log = [];
  g.lastAction = null;
  return g;
}

function ids(cards) {
  return cards.map(E.cardId).sort().join(',');
}

function chineseHas(text) {
  return /[一-鿿]/.test(text);
}

/* ---------------- card helpers ---------------- */

assert(E.RANKS.length === 13, 'RANKS has 13 ranks');
assert(E.SUITS.length === 4, 'SUITS has 4 suits');
assert(E.suitSymbol('H') === '♥', 'suitSymbol(H) is heart');
assert(E.suitSymbol('S') === '♠', 'suitSymbol(S) is spade');
assert(E.isRed(card('A', 'H')) === true, 'hearts are red');
assert(E.isRed(card('K', 'D')) === true, 'diamonds are red');
assert(E.isRed(card('Q', 'S')) === false, 'spades are not red');
assert(E.isRed(card('J', 'C')) === false, 'clubs are not red');
assert(E.cardId(card('10', 'D')) === '10♦', 'cardId composes rank and suit symbol');
assert(E.rankLabel('K') === 'K', 'rankLabel returns rank');

/* ---------------- deck composition and deal ---------------- */

var g1 = E.createGame({ seed: 12345 });
var allCards = g1.hands[0].concat(g1.hands[1], g1.deck);
var allIds = allCards.map(E.cardId);
assert(allCards.length === 52, 'deck plus hands contains 52 cards');
assert(new Set(allIds).size === 52, 'all 52 cards are unique');
assert(g1.deck.length === 38, 'pond has 38 cards after the deal');
assert(g1.hands[0].length === 7, 'player 0 is dealt 7 cards');
assert(g1.hands[1].length === 7, 'player 1 is dealt 7 cards');

E.SUITS.forEach(function (suit) {
  assert(allCards.filter(function (c) { return c.suit === suit; }).length === 13, 'suit ' + suit + ' has 13 cards');
});
E.RANKS.forEach(function (rank) {
  assert(allCards.filter(function (c) { return c.rank === rank; }).length === 4, 'rank ' + rank + ' has 4 cards');
});

var ga = E.createGame({ seed: 777 });
var gb = E.createGame({ seed: 777 });
assert(ids(ga.hands[0]) === ids(gb.hands[0]), 'seeded deal is deterministic for player 0');
assert(ids(ga.hands[1]) === ids(gb.hands[1]), 'seeded deal is deterministic for player 1');
assert(ids(ga.deck) === ids(gb.deck), 'seeded pond order is deterministic');

/* ---------------- rankCounts / handCount / booksFor ---------------- */

var gr = fresh(2);
gr.hands[0] = [card('A', 'S'), card('A', 'H'), card('K', 'C')];
var rc = E.rankCounts(gr, 0);
assert(rc.A === 2, 'rankCounts counts two aces');
assert(rc.K === 1, 'rankCounts counts one king');
assert(!rc.Q, 'rankCounts omits absent ranks');
assert(E.handCount(gr, 0) === 3, 'handCount reflects hand size');
assert(E.booksFor(gr, 0) === 0, 'booksFor starts at zero');

/* ---------------- automatic four-of-a-kind books ---------------- */

var gBook = fresh(3);
gBook.hands[0] = [card('K', 'S'), card('K', 'H'), card('K', 'D'), card('K', 'C'), card('3', 'S')];
var booked = E.checkBooks(gBook, 0);
assert(booked.length === 1 && booked[0] === 'K', 'checkBooks reports the completed king book');
assert(gBook.books[0] === 1, 'checkBooks increments book score');
assert(gBook.hands[0].length === 1, 'checkBooks removes all four book cards');
assert(gBook.hands[0][0].rank === '3', 'checkBooks keeps unrelated cards');
assert(chineseHas(gBook.log[gBook.log.length - 1]), 'book log entry is Chinese');

/* ---------------- successful ask: transfer all, keep turn ---------------- */

var gs = fresh(4, [card('2', 'D')]);
gs.hands[0] = [card('A', 'S'), card('A', 'H'), card('3', 'C')];
gs.hands[1] = [card('A', 'D'), card('A', 'C'), card('5', 'S')];
var rs = E.ask(gs, 'A');
assert(rs.ok === true, 'successful ask returns ok');
assert(rs.got === 2, 'successful ask takes all matching cards');
assert(gs.turn === 0, 'successful ask keeps the same player turn');
assert(gs.phase === 'playing', 'game continues after a single book');
assert(gs.books[0] === 1, 'asker completes a book from the transfer');
assert(gs.hands[0].length === 1 && gs.hands[0][0].rank === '3', 'asker hand keeps non-matching cards');
assert(gs.hands[1].length === 1 && gs.hands[1][0].rank === '5', 'opponent hand loses matching cards');
assert(gs.lastAction.got === 2 && gs.lastAction.rank === 'A', 'lastAction records the ask');
assert(gs.lastAction.books.indexOf('A') !== -1, 'lastAction records the completed book');
assert(E.rankCounts(gs, 1).A === undefined, 'opponent holds no aces after transfer');
assert(chineseHas(gs.log.join(' ')), 'ask log entries are Chinese');

/* ---------------- failed ask: draw one, pass turn ---------------- */

var gf = fresh(5, [card('2', 'D'), card('K', 'S')]);
gf.hands[0] = [card('K', 'H')];
gf.hands[1] = [card('3', 'C')];
var rf = E.ask(gf, 'K');
assert(rf.ok === true, 'failed ask is still a legal action');
assert(rf.got === 0, 'failed ask takes no cards');
assert(rf.drew !== null && rf.drew.rank === 'K', 'failed ask draws the top pond card');
assert(gf.turn === 1, 'failed ask passes the turn');
assert(gf.deck.length === 1, 'failed ask removes exactly one pond card');
assert(gf.hands[0].length === 2, 'drawn card joins the asker hand');
assert(gf.books[0] === 0, 'no book is formed without four cards');

/* ---------------- drawn matching rank can complete a book ---------------- */

var gd = fresh(6, [card('7', 'C')]);
gd.hands[0] = [card('7', 'S'), card('7', 'H'), card('7', 'D')];
gd.hands[1] = [card('3', 'C')];
var rd = E.ask(gd, '7');
assert(rd.ok === true && rd.got === 0, 'matching draw happens after a failed ask');
assert(rd.drew !== null && rd.drew.rank === '7', 'drawn card matches requested rank');
assert(gd.books[0] === 1, 'drawn matching card completes the book');
assert(gd.hands[0].length === 0, 'completed book leaves the hand');
assert(gd.turn === 1, 'turn still passes even when the draw completes a book');

/* ---------------- legality validation ---------------- */

var gv = fresh(7, [card('2', 'D')]);
gv.hands[0] = [card('K', 'H')];
gv.hands[1] = [card('3', 'C')];
var rv = E.ask(gv, 'Q');
assert(rv.ok === false, 'asking for a rank the asker lacks is rejected');
assert(typeof rv.error === 'string' && rv.error.length > 0, 'illegal ask returns an error message');
assert(rv.got === 0 && rv.drew === null, 'illegal ask reports no transfer or draw');
assert(gv.turn === 0 && gv.hands[0].length === 1 && gv.hands[1].length === 1, 'illegal ask mutates nothing');

var bad1 = E.ask(gv, '1');
var bad2 = E.ask(gv, '');
var bad3 = E.ask(gv, 'a');
assert(bad1.ok === false, 'numeric 1 is not a valid rank');
assert(bad2.ok === false, 'empty rank is rejected');
assert(bad3.ok === false, 'lowercase rank is rejected');

var gover = E.createGame({ seed: 8 });
gover.phase = 'over';
assert(E.ask(gover, 'A').ok === false, 'asking is rejected after the game is over');

/* ---------------- finish and winners ---------------- */

var gw0 = fresh(9);
gw0.books = [5, 3];
E.finish(gw0);
assert(gw0.phase === 'over', 'finish marks the game as over');
assert(gw0.winner === 0, 'more books wins for player 0');
assert(chineseHas(gw0.log[gw0.log.length - 1]), 'finish logs the result in Chinese');

var gw1 = fresh(10);
gw1.books = [2, 6];
E.finish(gw1);
assert(gw1.winner === 1, 'more books wins for player 1');

var gwt = fresh(11);
gwt.books = [4, 4];
E.finish(gwt);
assert(gwt.winner === 'tie', 'equal books produce a tie');

/* ---------------- 13th book ends the game ---------------- */

var g13 = fresh(12, [card('3', 'D')]);
g13.books = [6, 6];
g13.hands[0] = [card('A', 'S'), card('A', 'H'), card('A', 'D')];
g13.hands[1] = [card('A', 'C'), card('2', 'S')];
var r13 = E.ask(g13, 'A');
assert(r13.ok === true && r13.got === 1, 'thirteenth-book ask transfers the final ace');
assert(g13.books[0] === 7, 'asker reaches seven books');
assert(g13.books[0] + g13.books[1] === 13, 'all 13 books are complete');
assert(g13.phase === 'over', '13 books end the game immediately');
assert(g13.winner === 0, 'winner is decided when the 13th book is made');

/* ---------------- AI rank choice ---------------- */

var gai = fresh(13);
gai.hands[1] = [card('7', 'S'), card('7', 'H'), card('7', 'D'), card('K', 'S'), card('K', 'H')];
assert(E.aiChooseRank(gai) === '7', 'AI asks for its most frequent rank');
assert(E.aiChooseRank(gai) === E.aiChooseRank(gai), 'AI choice is deterministic');

var gtie = fresh(14);
gtie.hands[1] = [card('K', 'S'), card('K', 'H'), card('2', 'S'), card('2', 'H')];
assert(E.aiChooseRank(gtie) === '2', 'AI tie-break uses RANKS order');
assert(E.aiChooseRank(gtie) === '2', 'AI tie-break repeats the same answer');

var gone = fresh(15);
gone.hands[1] = [card('K', 'S')];
assert(E.aiChooseRank(gone) === 'K', 'AI asks its only rank when holding one card');

for (var seed = 1; seed <= 10; seed += 1) {
  var ga2 = E.createGame({ seed: seed });
  var pick = E.aiChooseRank(ga2);
  assert(pick !== null && E.RANKS.indexOf(pick) !== -1, 'AI picks a valid rank for seed ' + seed);
  assert((E.rankCounts(ga2, 1)[pick] || 0) > 0, 'AI only asks ranks it holds for seed ' + seed);
}

/* ---------------- 30-game self-play ---------------- */

var CAP = 600;
for (var n = 1; n <= 30; n += 1) {
  var game = E.createGame({ seed: 9000 + n });
  var steps = 0;
  var illegal = null;

  while (game.phase === 'playing' && steps < CAP) {
    E.ensurePlayable(game);
    if (game.phase !== 'playing') break;
    var player = game.turn;
    var rank = null;
    if (player === 1) {
      rank = E.aiChooseRank(game);
    } else {
      var counts = E.rankCounts(game, 0);
      for (var i = 0; i < E.RANKS.length; i += 1) {
        if ((counts[E.RANKS[i]] || 0) > 0) { rank = E.RANKS[i]; break; }
      }
    }
    if (!rank) { illegal = 'no legal rank at step ' + steps; break; }
    var res = E.ask(game, rank);
    if (!res.ok) { illegal = 'ask rejected: ' + res.error; break; }
    if (res.got < 0 || res.got > 4) { illegal = 'got out of range: ' + res.got; break; }
    if (res.got > 0 && (E.rankCounts(game, 1 - player)[rank] || 0) > 0) {
      illegal = 'opponent still holds the asked rank';
      break;
    }
    steps += 1;
  }

  assert(illegal === null, 'self-play game ' + n + ' has no illegal action (' + illegal + ')');
  assert(steps < CAP, 'self-play game ' + n + ' finishes under the step cap');
  assert(game.phase === 'over', 'self-play game ' + n + ' reaches a final state');

  var totalBooks = game.books[0] + game.books[1];
  assert(game.books[0] >= 0 && game.books[0] <= 13, 'self-play game ' + n + ' player books in range');
  assert(game.books[1] >= 0 && game.books[1] <= 13, 'self-play game ' + n + ' AI books in range');
  assert(Number.isInteger(totalBooks) && totalBooks <= 13, 'self-play game ' + n + ' total books valid');
  assert(
    game.hands[0].length + game.hands[1].length + game.deck.length + 4 * totalBooks === 52,
    'self-play game ' + n + ' conserves all 52 cards'
  );

  var expected = game.books[0] > game.books[1] ? 0 : (game.books[0] < game.books[1] ? 1 : 'tie');
  assert(game.winner === expected, 'self-play game ' + n + ' winner matches book count');
  assert(totalBooks === 13 || game.deck.length === 0, 'self-play game ' + n + ' ends for a valid reason');
}

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
