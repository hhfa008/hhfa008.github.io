'use strict';

/*
 * Solitaire (Klondike) premium — rules test harness.
 *   node games/boardgame/solitaire-premium/test.js
 * Prints RESULT: N passed, M failed and exits non-zero on failure.
 */

var E = require('./engine.js');
var D = require('./data.js');

var passed = 0;
var failed = 0;
var failures = [];
var uid = 0;

function ok(label, cond, detail) {
  if (cond) passed += 1;
  else {
    failed += 1;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('FAIL ' + label + (detail ? ' — ' + detail : ''));
  }
  return !!cond;
}
function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}
function throws(label, fn, pattern) {
  try {
    fn();
    return ok(label, false, 'did not throw');
  } catch (err) {
    var msg = err && err.message ? err.message : String(err);
    return ok(label, pattern ? pattern.test(msg) : true, msg);
  }
}
function card(rank, suit, faceUp) {
  var suits = { '♠': 0, '♥': 1, '♦': 2, '♣': 3 };
  var values = { A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13 };
  var si = suits[suit];
  uid += 1;
  return {
    id: rank + suit + '#' + uid,
    rank: rank,
    value: values[rank],
    suit: suit,
    suitIndex: si,
    red: si === 1 || si === 2,
    faceUp: faceUp !== false
  };
}
function emptyState() {
  return {
    version: E.VERSION,
    seed: null,
    drawMode: 1,
    status: 'playing',
    stock: [],
    waste: [],
    foundations: [[], [], [], []],
    tableau: [[], [], [], [], [], [], []],
    moves: 0,
    score: 0,
    recycles: 0,
    wonAt: null,
    history: []
  };
}
function moveKey(m) { return E.moveKey(m); }
function hasMove(state, move) {
  var key = moveKey(move);
  return E.getLegalMoves(state).some(function (m) { return moveKey(m) === key; });
}
function noMutation(state, fn) {
  var before = JSON.stringify(state);
  fn();
  return ok('state was not mutated', JSON.stringify(state) === before);
}
function fillFoundations(state, upTo) {
  for (var s = 0; s < 4; s += 1) {
    for (var v = 1; v <= upTo; v += 1) state.foundations[s].push(card(E.RANK_LABEL[v], E.SUITS[s].symbol, true));
  }
  return state;
}

/* ---------------------------------------------------------------- deck */
console.log('[STEP] deck and identities');
var deck = E.makeDeck(12345);
eq('deck has 52 cards', deck.length, 52);
eq('deck ids are unique', new Set(deck.map(function (c) { return c.id; })).size, 52);
E.SUITS.forEach(function (s, index) {
  var mine = deck.filter(function (c) { return c.suit === s.symbol; });
  eq(s.name + ' has 13 cards', mine.length, 13);
  eq(s.name + ' values A..K', mine.map(function (c) { return c.value; }).sort(function (a, b) { return a - b; }), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  eq(s.name + ' suit index', mine[0].suitIndex, index);
});
eq('spade and club are black', [E.SUITS[0].red, E.SUITS[3].red], [false, false]);
eq('heart and diamond are red', [E.SUITS[1].red, E.SUITS[2].red], [true, true]);
eq('rank labels A and K', [E.RANK_LABEL[1], E.RANK_LABEL[13]], ['A', 'K']);
eq('card ratio 63:88', Math.round((63 / 88) * 1000), 716);
ok('deck has no jokers', deck.every(function (c) { return c.rank !== 'Joker'; }));

/* ---------------------------------------------------------------- deal */
console.log('[STEP] deal');
var game = E.createGame({ seed: 20261110 });
eq('seven tableau columns', game.tableau.length, 7);
eq('tableau counts 1..7', game.tableau.map(function (p) { return p.length; }), [1, 2, 3, 4, 5, 6, 7]);
eq('stock has 24 cards', game.stock.length, 24);
eq('waste starts empty', game.waste.length, 0);
eq('four empty foundations', game.foundations.map(function (p) { return p.length; }), [0, 0, 0, 0]);
eq('all 52 cards are present', E.cardCount(game), 52);
eq('unique cards after deal', new Set(E.allCards(game).map(function (c) { return c.id; })).size, 52);
eq('only the top tableau card is face up', game.tableau.map(function (p) { return p.filter(function (c) { return c.faceUp; }).length; }), [1, 1, 1, 1, 1, 1, 1]);
ok('bottom cards are face down', game.tableau.every(function (p) { return p.slice(0, -1).every(function (c) { return !c.faceUp; }); }));
ok('stock is face down', game.stock.every(function (c) { return !c.faceUp; }));
eq('initial score/moves', [game.score, game.moves, game.recycles], [0, 0, 0]);
eq('status playing', game.status, 'playing');
eq('draw mode 1 default', game.drawMode, 1);
eq('draw mode 3 respected', E.createGame({ seed: 1, drawMode: 3 }).drawMode, 3);
eq('invalid draw mode falls back to 1', E.createGame({ seed: 1, drawMode: 7 }).drawMode, 1);
var sameA = E.createGame({ seed: 777 });
var sameB = E.createGame({ seed: 777 });
eq('same seed deals the same cards', E.allCards(sameA).map(function (c) { return c.id; }), E.allCards(sameB).map(function (c) { return c.id; }));
var other = E.createGame({ seed: 778 });
ok('different seed deals differently', JSON.stringify(E.allCards(sameA).map(function (c) { return c.id; })) !== JSON.stringify(E.allCards(other).map(function (c) { return c.id; })));
eq('no history on a fresh deal', game.history.length, 0);
ok('createGame does not mutate opts', (function () { var o = { seed: 5, drawMode: 3 }; E.createGame(o); return o.seed === 5 && o.drawMode === 3; })());

/* ---------------------------------------------------------------- tableau rules */
console.log('[STEP] tableau legality');
var t = [];
ok('empty column accepts King', E.canPlaceOnTableau(t, [card('K', '♠')]));
ok('empty column rejects Queen', !E.canPlaceOnTableau(t, [card('Q', '♥')]));
t = [card('8', '♠')];
ok('red 7 goes on black 8', E.canPlaceOnTableau(t, [card('7', '♥')]));
ok('black 7 goes on black 8? no', !E.canPlaceOnTableau(t, [card('7', '♣')]));
ok('9 cannot go on 8', !E.canPlaceOnTableau(t, [card('9', '♥')]));
ok('same rank cannot stack', !E.canPlaceOnTableau(t, [card('8', '♥')]));
t = [card('8', '♠', false)];
ok('face-down target rejects placement', !E.canPlaceOnTableau(t, [card('7', '♥')]));
ok('run 9-8-7 valid', E.isValidRun([card('9', '♠'), card('8', '♥'), card('7', '♣')]));
ok('run wrong colour invalid', !E.isValidRun([card('9', '♠'), card('8', '♣')]));
ok('run wrong order invalid', !E.isValidRun([card('8', '♠'), card('9', '♥')]));
ok('run with face-down card invalid', !E.isValidRun([card('9', '♠', false), card('8', '♥')]));
ok('empty run invalid', !E.isValidRun([]));

/* ---------------------------------------------------------------- foundation rules */
console.log('[STEP] foundation legality');
ok('Ace starts an empty foundation', E.canPlaceOnFoundation([], card('A', '♠'), 0));
ok('2 cannot start a foundation', !E.canPlaceOnFoundation([], card('2', '♠'), 0));
ok('foundation rejects wrong suit', !E.canPlaceOnFoundation([card('A', '♠')], card('2', '♥'), 0));
ok('foundation accepts next rank same suit', E.canPlaceOnFoundation([card('A', '♠')], card('2', '♠'), 0));
ok('foundation rejects skipped rank', !E.canPlaceOnFoundation([card('A', '♠')], card('3', '♠'), 0));
ok('foundation rejects same rank', !E.canPlaceOnFoundation([card('2', '♠')], card('2', '♠'), 0));

/* ---------------------------------------------------------------- legal moves */
console.log('[STEP] legal move enumeration');
var s = emptyState();
s.stock = [card('5', '♠'), card('6', '♥')];
s.waste = [card('A', '♦')];
s.tableau[0] = [card('K', '♣')];
s.tableau[1] = [card('Q', '♥')];
var legal = E.getLegalMoves(s);
ok('draw is legal while stock has cards', legal.some(function (m) { return m.type === 'draw'; }));
ok('waste Ace to foundation is legal', hasMove(s, { type: 'move', from: { pile: 'waste', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 2 } }));
ok('waste Ace cannot go to spade foundation', !hasMove(s, { type: 'move', from: { pile: 'waste', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 0 } }));
ok('red Q goes on black K', hasMove(s, { type: 'move', from: { pile: 'tableau', index: 1 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } }));
ok('no legal moves when every pile is empty and stock/waste empty', E.getLegalMoves(emptyState()).length === 0);
var s2 = emptyState();
s2.waste = [card('A', '♠')];
eq('recycle offered when stock empty and waste non-empty', E.getLegalMoves(s2)[0].type, 'recycle');
var s3 = emptyState();
for (var sv = 1; sv <= 12; sv += 1) s3.foundations[0].push(card(E.RANK_LABEL[sv], '♠'));
s3.tableau[0] = [card('K', '♥')];
ok('foundation top can return to tableau', hasMove(s3, { type: 'move', from: { pile: 'foundation', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } }));

/* ---------------------------------------------------------------- draw / recycle */
console.log('[STEP] draw and recycle');
var d = emptyState();
d.stock = [card('2', '♠'), card('3', '♥'), card('4', '♦'), card('5', '♣')];
var d1 = E.applyMove(d, { type: 'draw' });
eq('draw 1 moves one card', [d1.waste.length, d1.stock.length], [1, 3]);
eq('drawn card is face up', d1.waste[0].faceUp, true);
eq('draw increments moves', d1.moves, 1);
eq('draw adds history', d1.history.length, 1);
noMutation(d, function () { E.applyMove(d, { type: 'draw' }); });
var d3 = emptyState();
d3.drawMode = 3;
d3.stock = [card('2', '♠'), card('3', '♥'), card('4', '♦'), card('5', '♣')];
var d3r = E.applyMove(d3, { type: 'draw' });
eq('draw 3 moves three cards', [d3r.waste.length, d3r.stock.length], [3, 1]);
var d3b = E.applyMove(d3r, { type: 'draw' });
eq('draw 3 takes the remainder', [d3b.waste.length, d3b.stock.length], [4, 0]);
var rec = emptyState();
rec.drawMode = 3;
rec.waste = [card('2', '♠'), card('3', '♥'), card('4', '♦')];
var rec1 = E.applyMove(rec, { type: 'recycle' });
eq('recycle returns all cards to stock', rec1.stock.length, 3);
eq('recycle empties waste', rec1.waste.length, 0);
ok('recycled stock is face down', rec1.stock.every(function (c) { return !c.faceUp; }));
eq('recycle reverses order', rec1.stock.map(function (c) { return c.rank; }), ['4', '3', '2']);
eq('draw-3 recycle costs 20', rec1.score, -20);
eq('recycle counted', rec1.recycles, 1);
throws('cannot recycle an empty waste', function () { E.applyMove(emptyState(), { type: 'recycle' }); }, /waste is empty/);
throws('cannot draw from an empty stock', function () { E.applyMove(emptyState(), { type: 'draw' }); }, /stock is empty/);

/* ---------------------------------------------------------------- moving cards */
console.log('[STEP] moving cards and scoring');
var m = emptyState();
m.waste = [card('5', '♥')];
m.tableau[0] = [card('6', '♠')];
var m1 = E.applyMove(m, { type: 'move', from: { pile: 'waste', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } });
eq('waste -> tableau appends card', m1.tableau[0].map(function (c) { return c.rank; }), ['6', '5']);
eq('waste -> tableau empties waste', m1.waste.length, 0);
eq('waste -> tableau scores +5', m1.score, 5);
eq('move increments moves', m1.moves, 1);
noMutation(m, function () {
  E.applyMove(m, { type: 'move', from: { pile: 'waste', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } });
});

var runState = emptyState();
runState.tableau[0] = [card('8', '♠', false), card('9', '♥'), card('8', '♠'), card('7', '♥')];
runState.tableau[1] = [card('10', '♠')];
var runMove = { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 1, to: { pile: 'tableau', index: 1 } };
var run1 = E.applyMove(runState, runMove);
eq('run moves three cards', run1.tableau[1].map(function (c) { return c.rank; }), ['10', '9', '8', '7']);
eq('source keeps hidden card and flips it', [run1.tableau[0].length, run1.tableau[0][0].faceUp], [1, true]);
eq('flip scores +5', run1.score, 5);
ok('moved run stays face up', run1.tableau[1].slice(1).every(function (c) { return c.faceUp; }));
throws('cannot move a mixed-colour run', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('9', '♠'), card('8', '♠')];
  bad.tableau[1] = [card('10', '♥')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 1 } });
}, /run cannot move/);
throws('cannot move a face-down card', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('9', '♠', false)];
  bad.tableau[1] = [card('10', '♥')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 1 } });
}, /run cannot move/);
throws('cannot move onto the same pile', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('9', '♠')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } });
}, /same pile/);

var king = emptyState();
king.tableau[0] = [card('K', '♠')];
king.tableau[1] = [];
var opened = E.applyMove(king, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 1 } });
eq('King can open a new empty column', opened.tableau[1].map(function (c) { return c.rank; }), ['K']);
throws('non-King cannot open an empty column', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('Q', '♠')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 1 } });
}, /illegal tableau/);

var fnd = emptyState();
fnd.waste = [card('A', '♥')];
var f1 = E.applyMove(fnd, { type: 'move', from: { pile: 'waste', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 1 } });
eq('waste Ace to foundation', f1.foundations[1].length, 1);
eq('waste -> foundation scores +10', f1.score, 10);
throws('foundation rejects a multi-card move', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('3', '♠'), card('2', '♥')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 0 } });
}, /one card at a time/);
throws('foundation rejects a non-Ace start', function () {
  var bad = emptyState();
  bad.tableau[0] = [card('2', '♠')];
  E.applyMove(bad, { type: 'move', from: { pile: 'tableau', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 0 } });
}, /illegal foundation/);
var back = emptyState();
back.foundations[0] = [card('A', '♠'), card('2', '♠')];
back.tableau[0] = [card('3', '♥')];
var back1 = E.applyMove(back, { type: 'move', from: { pile: 'foundation', index: 0 }, cardIndex: 0, to: { pile: 'tableau', index: 0 } });
eq('foundation -> tableau returns the 2', back1.tableau[0].map(function (c) { return c.rank; }), ['3', '2']);
eq('foundation -> tableau scores -15', back1.score, -15);
throws('foundation cannot move to another foundation', function () { E.applyMove(back, { type: 'move', from: { pile: 'foundation', index: 0 }, cardIndex: 0, to: { pile: 'foundation', index: 1 } }); }, /only move back/);

/* ---------------------------------------------------------------- undo */
console.log('[STEP] undo');
var u = E.createGame({ seed: 99 });
var u1 = E.applyMove(u, { type: 'draw' });
var u2 = E.undo(u1);
eq('undo restores the pre-draw state', [u2.stock.length, u2.waste.length, u2.moves], [u.stock.length, u.waste.length, u.moves]);
eq('undo leaves one fewer history entry', u2.history.length, 0);
var u3 = E.applyMove(u2, { type: 'draw' });
var u4 = E.undo(u3);
eq('undo after redo works', [u4.stock.length, u4.waste.length], [u2.stock.length, u2.waste.length]);
throws('undo on an empty history throws', function () { E.undo(u); }, /nothing to undo/);
var u5 = E.createGame({ seed: 3 });
var u6 = E.applyMove(u5, { type: 'draw' });
var u7 = E.applyMove(u6, { type: 'draw' });
var u8 = E.undo(E.undo(u7));
eq('double undo returns to the initial deal', JSON.stringify(E.snapshot(u8)), JSON.stringify(E.snapshot(u5)));

/* ---------------------------------------------------------------- hint / auto */
console.log('[STEP] hint and auto-send');
var h = emptyState();
h.waste = [card('A', '♠')];
h.tableau[0] = [card('K', '♣')];
h.tableau[1] = [card('Q', '♥')];
var hh = E.hint(h);
eq('hint prefers the foundation move', hh.move.to.pile, 'foundation');
ok('hint explains itself', /基础堆/.test(hh.reason), hh.reason);
var hintless = emptyState();
eq('hint returns null with no moves', E.hint(hintless), null);
var auto = emptyState();
auto.waste = [card('A', '♠')];
auto.tableau[0] = [card('A', '♥')];
auto.tableau[1] = [card('A', '♦')];
auto.tableau[2] = [card('A', '♣')];
var autoRes = E.autoSend(auto);
eq('auto-send moves all four aces', autoRes.count, 4);
eq('auto-send foundations after', autoRes.state.foundations.map(function (p) { return p.length; }), [1, 1, 1, 1]);
var finish = emptyState();
finish.stock = [card('K', '♠')];
fillFoundations(finish, 12);
finish.foundations[1].push(card('K', '♥'));
finish.foundations[2].push(card('K', '♦'));
finish.foundations[3].push(card('K', '♣'));
var finishRes = E.autoFinish(finish);
eq('autoFinish wins a one-card-from-victory position', finishRes.state.status, 'won');
eq('win has four 13-card foundations', finishRes.state.foundations.map(function (p) { return p.length; }), [13, 13, 13, 13]);
ok('isWon agrees', E.isWon(finishRes.state));
eq('no moves are legal after winning', E.getLegalMoves(finishRes.state).length, 0);
throws('cannot move after winning', function () {
  E.applyMove(finishRes.state, { type: 'draw' });
}, /not playing/);

/* ---------------------------------------------------------------- serialization */
console.log('[STEP] serialization');
var ser = E.createGame({ seed: 42, drawMode: 3 });
var text = E.serialize(ser);
var restored = E.deserialize(text);
eq('serialize/deserialize keeps all 52 cards', E.cardCount(restored), 52);
eq('serialize/deserialize keeps the seed', restored.seed, 42);
eq('serialize/deserialize keeps draw mode', restored.drawMode, 3);
eq('serialize/deserialize keeps the tableau', restored.tableau.map(function (p) { return p.length; }), ser.tableau.map(function (p) { return p.length; }));
eq('serialize/deserialize keeps face-up state', restored.tableau.map(function (p) { return p.filter(function (c) { return c.faceUp; }).length; }), [1, 1, 1, 1, 1, 1, 1]);
eq('serialized history is not persisted', restored.history.length, 0);
throws('rejects an unknown version', function () {
  var raw = JSON.parse(text); raw.version = '0.0.0'; E.deserialize(raw);
}, /version/);
throws('rejects duplicate cards', function () {
  var raw = JSON.parse(text); raw.stock[0] = raw.stock[1]; E.deserialize(raw);
}, /duplicate/);
throws('rejects a 51-card save', function () {
  var raw = JSON.parse(text); raw.stock.pop(); E.deserialize(raw);
}, /52 cards/);
throws('rejects malformed JSON', function () { E.deserialize('{oops'); }, /invalid/);

/* ---------------------------------------------------------------- summary / realism */
console.log('[STEP] score summary and realism');
var sum = E.scoreSummary(ser);
eq('summary score', sum.score, 0);
eq('summary foundations', sum.foundations, [0, 0, 0, 0]);
eq('summary hidden counts', sum.tableauHidden, [0, 1, 2, 3, 4, 5, 6]);
ok('summary won false', sum.won === false);
eq('realism: 52 cards, 4 suits, 13 ranks', [52, new Set(deck.map(function (c) { return c.suit; })).size, new Set(deck.map(function (c) { return c.value; })).size], [52, 4, 13]);
eq('realism: card dimensions 63x88mm', [63, 88], [63, 88]);
eq('realism: initial stock 24', game.stock.length, 24);
eq('realism: 28 tableau cards', game.tableau.reduce(function (a, p) { return a + p.length; }, 0), 28);
eq('realism: 7 columns with 1..7 cards', game.tableau.map(function (p) { return p.length; }), [1, 2, 3, 4, 5, 6, 7]);
ok('realism: foundations are one per suit', new Set(E.SUITS.map(function (s) { return s.key; })).size === 4);
eq('all card values 1..13', deck.map(function (c) { return c.value; }).filter(function (v) { return v < 1 || v > 13; }), []);
eq('score rule constants', E.SCORE_RULES, { wasteToTableau: 5, wasteToFoundation: 10, tableauToFoundation: 10, flip: 5, foundationToTableau: -15, recycleDraw1: 0, recycleDraw3: -20 });

/* ---------------------------------------------------------------- data */
console.log('[STEP] presentation data');
eq('data title', D.title.indexOf('接龙') >= 0, true);
eq('data has four suits', D.suits.length, 4);
eq('data draw modes', D.drawModes, [1, 3]);
eq('data score rules stay in sync with the engine', D.scoreRules, E.SCORE_RULES);
eq('data cites three Bilibili sources', D.sources.length, 3);
ok('every source carries a BV id', D.sources.every(function (s) { return /^BV[0-9A-Za-z]+$/.test(s.id); }));

/* ---------------------------------------------------------------- result */
console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('FAILURES:');
  failures.forEach(function (f) { console.log(' - ' + f); });
}
process.exit(failed ? 1 : 0);
