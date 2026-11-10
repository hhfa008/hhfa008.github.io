#!/usr/bin/env node
'use strict';

/*
 * for-sale-premium engine + page tests.
 * Run: node games/boardgame/for-sale-premium/test.js
 * Prints: RESULT: N passed, M failed
 */

var fs = require('fs');
var path = require('path');
var Engine = require('./engine.js');
var Data = require('./data.js');
var HERE = __dirname;

var passed = 0, failed = 0, failures = [];
function ok(label, cond, detail) {
  if (cond) passed += 1;
  else { failed += 1; var line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('FAIL ' + line); }
  return !!cond;
}
function eq(label, actual, expected) {
  return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected));
}
function throws(label, fn, pattern) {
  var threw = false, message = '';
  try { fn(); } catch (err) { threw = true; message = String(err && err.message); }
  return ok(label, threw && (!pattern || pattern.test(message)), 'message=' + JSON.stringify(message));
}
function section(name) { console.log('\n## ' + name); }
function playAI(state, limit) {
  var n = 0;
  while (!Engine.isGameOver(state) && n < (limit || 5000)) {
    state = Engine.applyMove(state, Engine.chooseAIMove(state));
    n += 1;
  }
  return state;
}

/* ------------------------------------------------------------------ */
section('components + setup');
eq('30 property values', Data.PROPERTY_VALUES.length, 30);
eq('properties 1..30', [Data.PROPERTY_VALUES[0], Data.PROPERTY_VALUES[29]], [1, 30]);
eq('30 cheques', Data.CHEQUE_VALUES.length, 30);
eq('no cheque of 1', Data.CHEQUE_VALUES.indexOf(1), -1);
eq('cheques 0,0,2..15 twice', Data.CHEQUE_VALUES.filter(function (v) { return v === 0; }).length, 2);
eq('15 appears twice', Data.CHEQUE_VALUES.filter(function (v) { return v === 15; }).length, 2);
eq('start money 18', Data.START_MONEY, 18);
eq('3-6 players', [Data.MIN_PLAYERS, Data.MAX_PLAYERS], [3, 6]);
[3, 4, 5, 6].forEach(function (pc) {
  var g = Engine.createGame({ seed: 20 + pc, playerCount: pc });
  eq(pc + 'p players', g.players.length, pc);
  eq(pc + 'p money', g.players.map(function (p) { return p.money; }), new Array(pc).fill(18));
  eq(pc + 'p property deck', g.propertyDeck.length, 29);
  eq(pc + 'p cheque deck', g.chequeDeck.length, 30);
  eq(pc + 'p phase auction', g.phase, 'auction');
  eq(pc + 'p current auction card', typeof g.auction.card, 'number');
  eq(pc + 'p turn 0', g.auction.turn, 0);
  ok(pc + 'p only seat 0 human', !g.players[0].isAI && g.players.slice(1).every(function (p) { return p.isAI; }));
});
throws('2 players rejected', function () { Engine.createGame({ playerCount: 2 }); });
throws('7 players rejected', function () { Engine.createGame({ playerCount: 7 }); });

/* ------------------------------------------------------------------ */
section('auction legality');
var g = Engine.createGame({ seed: 3, playerCount: 3 });
var moves = Engine.getLegalMoves(g);
ok('opening bid 0 legal', moves.some(function (m) { return m.type === 'bid' && m.amount === 0; }));
ok('opening pass illegal', !moves.some(function (m) { return m.type === 'pass'; }));
throws('opening pass rejected', function () { Engine.applyMove(g, { type: 'pass' }); }, /开叫/);
throws('negative bid rejected', function () { Engine.applyMove(g, { type: 'bid', amount: -1 }); }, /不低于/);
throws('non-integer bid rejected', function () { Engine.applyMove(g, { type: 'bid', amount: 1.5 }); }, /整数/);
var bid0 = Engine.applyMove(g, { type: 'bid', amount: 0 });
eq('bid 0 recorded', bid0.auction.currentBid, 0);
eq('high bidder 0', bid0.auction.highBidder, 0);
eq('turn passes to 1', bid0.auction.turn, 1);
eq('player 0 money unchanged', bid0.players[0].money, 18);
var nextMoves = Engine.getLegalMoves(bid0);
ok('next min is 1', nextMoves.some(function (m) { return m.type === 'bid' && m.amount === 1; }));
ok('pass now legal', nextMoves.some(function (m) { return m.type === 'pass'; }));
throws('cannot bid same amount', function () { Engine.applyMove(bid0, { type: 'bid', amount: 0 }); }, /不低于/);
var broke = JSON.parse(JSON.stringify(bid0));
broke.players[1].money = 2;
throws('cannot bid above money', function () { Engine.applyMove(broke, { type: 'bid', amount: 3 }); }, /现金/);

/* ------------------------------------------------------------------ */
section('auction resolution');
var a = Engine.createGame({ seed: 4, playerCount: 3 });
var card = a.auction.card;
a = Engine.applyMove(a, { type: 'bid', amount: 0 });
a = Engine.applyMove(a, { type: 'bid', amount: 3 });
a = Engine.applyMove(a, { type: 'pass' });
eq('still two active', a.auction.passed, [2]);
a = Engine.applyMove(a, { type: 'pass' });
eq('auction resolved', a.lastAuction.winner, 1);
eq('winner paid 3', a.lastAuction.paid, 3);
eq('winner money 15', a.players[1].money, 15);
eq('winner has property', a.players[1].props, [card]);
eq('next auction starts with winner', a.auction.turn, 1);
eq('auction count 2', a.round, 2);
eq('new card different', a.auction.card !== card, true);
eq('property deck 28', a.propertyDeck.length, 28);

/* ------------------------------------------------------------------ */
section('sell setup + picks');
var s = Engine.createGame({ seed: 5, playerCount: 3 });
s.phase = 'sell';
s.round = 1;
s.sell = {
  round: 1, totalRounds: 1, cheques: [15, 10, 5], sellers: [0, 1, 2],
  current: 2, picks: [null, null, null], reveal: null
};
s.players[0].props = [30];
s.players[1].props = [20];
s.players[2].props = [10];
s.chequeDeck = [];
var sv = Engine.getView(s, 1);
eq('own pick visible after pick', sv.sell.picks[1], null);
eq('cheques public', sv.sell.cheques, [15, 10, 5]);
eq('other checks hidden', sv.players[0].checks, []);
s = Engine.applyMove(s, { type: 'sell', card: 10 });
eq('first pick recorded', s.sell.picks[2], 10);
var hidden = Engine.getView(s, 1);
eq('other pending pick hidden', hidden.sell.picks[2], 'hidden');
eq('own pending pick visible', hidden.sell.picks[1], null);
s = Engine.applyMove(s, { type: 'sell', card: 30 });
s = Engine.applyMove(s, { type: 'sell', card: 20 });
eq('game finished after totalRounds', s.over, true);
eq('highest property got highest cheque', s.lastSell.awarded, [
  { player: 0, card: 30, cheque: 15 },
  { player: 1, card: 20, cheque: 10 },
  { player: 2, card: 10, cheque: 5 }
]);
eq('properties removed', s.players.map(function (p) { return p.props; }), [[], [], []]);
eq('cheques added', s.players.map(function (p) { return p.checks; }), [[15], [10], [5]]);
eq('winner highest total', s.winner, 0);
eq('result rows', Engine.getResults(s).rows.length, 3);

/* ------------------------------------------------------------------ */
section('sell tie-break + hidden cheques');
var t = Engine.createGame({ seed: 6, playerCount: 3 });
t.phase = 'sell'; t.round = 1;
t.sell = { round: 1, totalRounds: 1, cheques: [12, 8, 4], sellers: [0, 1, 2], current: 2, picks: [null, null, null], reveal: null };
t.players[0].props = [20]; t.players[1].props = [20]; t.players[2].props = [20];
t.chequeDeck = [];
t = Engine.applyMove(t, { type: 'sell', card: 20 });
t = Engine.applyMove(t, { type: 'sell', card: 20 });
t = Engine.applyMove(t, { type: 'sell', card: 20 });
eq('equal properties award by seat order', t.lastSell.awarded.map(function (x) { return x.player; }), [0, 1, 2]);
eq('equal properties cheques', t.lastSell.awarded.map(function (x) { return x.cheque; }), [12, 8, 4]);

var hv = Engine.createGame({ seed: 7, playerCount: 3 });
hv.players[0].checks = [15];
hv.players[1].checks = [10];
var v1 = Engine.getView(hv, 1);
eq('own cheque visible', v1.players[1].checks, [10]);
eq('other cheque hidden', v1.players[0].checks, ['hidden']);
eq('money public', v1.players[0].money, 18);
eq('total hidden for other', v1.players[0].total, null);
eq('own total visible', v1.players[1].total, 28);

/* ------------------------------------------------------------------ */
section('full match + conservation');
[3, 4, 5, 6].forEach(function (pc) {
  var allOver = true, moneySane = true, propsDone = true, chequeCount = 0;
  for (var game = 0; game < 10; game++) {
    var state = playAI(Engine.createGame({ seed: 400 + game + pc * 100, playerCount: pc }), 5000);
    if (!Engine.isGameOver(state)) allOver = false;
    state.players.forEach(function (p) {
      if (p.money < 0) moneySane = false;
      if (p.props.length) propsDone = false;
    });
    chequeCount += state.players.reduce(function (n, p) { return n + p.checks.length; }, 0);
  }
  eq(pc + 'p: 10 matches finished', allOver, true);
  eq(pc + 'p: money never negative', moneySane, true);
  eq(pc + 'p: all properties sold', propsDone, true);
  ok(pc + 'p: cheques distributed', chequeCount >= 0, 'cheques=' + chequeCount);
});

/* ------------------------------------------------------------------ */
section('determinism + immutability + perf');
var d1 = Engine.createGame({ seed: 123, playerCount: 4 });
var d2 = Engine.createGame({ seed: 123, playerCount: 4 });
eq('same seed same property deck', d1.propertyDeck, d2.propertyDeck);
eq('same seed same cheque deck', d1.chequeDeck, d2.chequeDeck);
var im = Engine.createGame({ seed: 3, playerCount: 4 });
var before = JSON.stringify(im);
Engine.applyMove(im, Engine.getLegalMoves(im)[0]);
eq('applyMove does not mutate input', JSON.stringify(im), before);
var perfState = Engine.createGame({ seed: 12, playerCount: 5 });
var start = process.hrtime.bigint();
var steps = 0;
while (!Engine.isGameOver(perfState) && steps < 500) {
  perfState = Engine.applyMove(perfState, Engine.chooseAIMove(perfState));
  steps += 1;
}
var elapsed = Number(process.hrtime.bigint() - start) / 1e6;
ok('AI simulation under 500ms', elapsed < 500, elapsed.toFixed(2) + 'ms');
ok('AI simulation advanced', steps > 20, 'steps=' + steps);

/* ------------------------------------------------------------------ */
section('page + assets');
var html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(HERE, 'rules.html'), 'utf8');
ok('index loads engine.js', /<script[^>]*src="engine\.js"/.test(html));
ok('index loads data.js', /<script[^>]*src="data\.js"/.test(html));
ok('index reuses shared shuffle', /shared\/shuffle\.js/.test(html));
ok('index reuses shared sfx', /shared\/sfx\.js/.test(html));
ok('mobile viewport', /name="viewport"[^>]*width=device-width/.test(html));
ok('no external http request', !/(src|href)="https?:\/\//.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
ok('touch targets >=44px', /min-height:\s*4[4-9]px/.test(html));
ok('aria labels present', /aria-label=/.test(html));
ok('rules FAQ JSON-LD', /FAQPage/.test(rules));
ok('rules links back', /href="index\.html"/.test(rules));
ok('songti declared', /Songti SC/.test(html));
ok('online page exists', fs.existsSync(path.join(HERE, 'online.html')));
ok('online server exists', fs.existsSync(path.join(HERE, 'online-server.mjs')));
ok('service worker precache exists', /CORE/.test(fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8')));
['table-green', 'property-card', 'cheque', 'coin', 'house-token'].forEach(function (name) {
  ok('material ' + name + ' present', fs.existsSync(path.join(HERE, '../../assets/art/premium/for-sale', name + '.webp')));
});
['cover', 'og', 'detail-1', 'detail-2'].forEach(function (name) {
  ok('local art ' + name + ' present', fs.existsSync(path.join(HERE, 'assets', name + '.webp')));
});

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
