#!/usr/bin/env node
'use strict';

/* Love Letter premium engine + page tests. Run: node games/boardgame/love-letter-premium/test.js */

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
function fresh(playerCount, seed) {
  var g = Engine.createGame({ seed: seed == null ? 1 : seed, playerCount: playerCount || 3 });
  g.players.forEach(function (p) { p.hand = []; p.discard = []; p.protected = false; p.out = false; p.tokens = 0; });
  g.deck = []; g.burn = []; g.current = 0; g.turn = 1; g.round = 1; g.phase = 'play';
  g.over = false; g.winner = null; g.winners = []; g.lastAction = null; g.lastRound = null;
  g.known = {}; g.players.forEach(function (p) { g.known[p.index] = {}; });
  return g;
}
function setHands(g, hands) { hands.forEach(function (hand, i) { g.players[i].hand = hand.slice(); }); }
function movesFor(g, card) { return Engine.getLegalMoves(g).filter(function (m) { return m.card === card; }); }

section('deck + data');
eq('8 characters', Data.CARDS.length, 8);
eq('values 1..8', Data.CARDS.map(function (c) { return c.value; }), [1,2,3,4,5,6,7,8]);
eq('16 cards total', Data.TOTAL_CARDS, 16);
eq('guard x5', Data.BY_ID[1].count, 5);
eq('priest x2', Data.BY_ID[2].count, 2);
eq('baron x2', Data.BY_ID[3].count, 2);
eq('handmaid x2', Data.BY_ID[4].count, 2);
eq('prince x2', Data.BY_ID[5].count, 2);
eq('king x1', Data.BY_ID[6].count, 1);
eq('countess x1', Data.BY_ID[7].count, 1);
eq('princess x1', Data.BY_ID[8].count, 1);
eq('2p target 7', Data.TARGET_TOKENS[2], 7);
eq('3p target 5', Data.TARGET_TOKENS[3], 5);
eq('4p target 4', Data.TARGET_TOKENS[4], 4);
eq('2p burn 3', Data.BURN_COUNT[2], 3);
eq('3p burn 1', Data.BURN_COUNT[3], 1);
eq('4p burn 0', Data.BURN_COUNT[4], 0);

section('setup by player count');
[2,3,4].forEach(function (pc) {
  var g = Engine.createGame({ seed: 40 + pc, playerCount: pc });
  eq(pc + 'p players', g.players.length, pc);
  eq(pc + 'p target tokens', g.targetTokens, Data.TARGET_TOKENS[pc]);
  eq(pc + 'p burn count', g.burn.length, Data.BURN_COUNT[pc]);
  eq(pc + 'p current player has 2 cards', g.players[0].hand.length, 2);
  g.players.slice(1).forEach(function (p) { ok(pc + 'p player ' + p.index + ' starts with 1 card', p.hand.length === 1); });
  var dealt = g.players.reduce(function (n, p) { return n + p.hand.length; }, 0);
  eq(pc + 'p card conservation', dealt + g.deck.length + g.burn.length, 16);
  eq(pc + 'p round 1', g.round, 1);
  eq(pc + 'p not over', g.over, false);
  ok(pc + 'p only seat 0 is human', !g.players[0].isAI && g.players.slice(1).every(function (p) { return p.isAI; }));
});
throws('1 player rejected', function () { Engine.createGame({ playerCount: 1 }); }, /2、3 或 4/);
throws('5 players rejected', function () { Engine.createGame({ playerCount: 5 }); }, /2、3 或 4/);

section('hidden information');
var hidden = Engine.createGame({ seed: 7, playerCount: 3 });
var view0 = Engine.getView(hidden, 0);
eq('own hand visible', view0.players[0].hand.length, 2);
ok('opponent hands hidden', view0.players[1].hand.every(function (c) { return c === 'hidden'; }));
ok('opponent 2 hidden', view0.players[2].hand.every(function (c) { return c === 'hidden'; }));
eq('hidden view keeps hand count', view0.players[1].handCount, 1);
ok('view does not expose deck order', view0.deck === undefined && view0.deckLeft === hidden.deck.length);
var spectator = Engine.getView(hidden, null);
ok('spectator sees no hands', spectator.players[0].hand.every(function (c) { return c === 'hidden'; }));

section('countess rule');
var c = fresh(3);
setHands(c, [[7,6],[2],[3]]); c.deck = [4,5,8,1];
var countessMoves = Engine.getLegalMoves(c);
ok('countess + king: only countess legal', countessMoves.length > 0 && countessMoves.every(function (m) { return m.card === 7; }));
throws('king rejected while countess forced', function () { Engine.applyMove(c, { type: 'play', card: 6, target: 1 }); }, /女伯爵/);
var c2 = fresh(3); setHands(c2, [[7,4],[2],[3]]); c2.deck = [5,6,8,1];
var c2moves = Engine.getLegalMoves(c2);
ok('countess + handmaid: free choice', c2moves.some(function (m) { return m.card === 7; }) && c2moves.some(function (m) { return m.card === 4; }));

section('guard');
var g = fresh(3); setHands(g, [[1,2],[5],[3]]); g.deck = [4,6,7,8];
var g2 = Engine.applyMove(g, { type: 'play', card: 1, target: 1, guess: 5 });
eq('guard hit eliminates target', g2.players[1].out, true);
eq('guard hit discards target hand', g2.players[1].hand, []);
eq('turn passes to player 2', g2.current, 2);
eq('guard hit logs', g2.lastAction.cancelled, false);
var g3 = fresh(3); setHands(g3, [[1,2],[5],[3]]); g3.deck = [4,6,7,8];
var g4 = Engine.applyMove(g3, { type: 'play', card: 1, target: 1, guess: 7 });
eq('guard miss keeps target', g4.players[1].out, false);
var g5 = fresh(3); setHands(g5, [[1,2],[5],[3]]); g5.deck = [4,6,7,8]; g5.players[1].protected = true;
var g6 = Engine.applyMove(g5, { type: 'play', card: 1, target: 1, guess: 5 });
eq('guard vs handmaid cancelled', g6.players[1].out, false);
eq('guard vs handmaid flagged', g6.lastAction.cancelled, true);
throws('guard cannot guess guard', function () { Engine.applyMove(g5, { type: 'play', card: 1, target: 1, guess: 1 }); }, /不合法/);
eq('guard legal guesses exclude 1', movesFor(g5, 1).every(function (m) { return m.guess >= 2 && m.guess <= 8; }), true);

section('priest');
var p = fresh(3); setHands(p, [[2,4],[6],[3]]); p.deck = [5,7,8,1];
var p2 = Engine.applyMove(p, { type: 'play', card: 2, target: 1 });
eq('priest records target hand', p2.known[0][1], 6);
eq('priest does not eliminate', p2.players[1].out, false);
eq('known info hidden from other seats', p2.known[1][2], undefined);
var pv = Engine.getView(p2, 0);
eq('priest knowledge survives view', pv.known[1], 6);

section('baron');
var b = fresh(3); setHands(b, [[3,6],[4],[2]]); b.deck = [5,7,8,1];
var b2 = Engine.applyMove(b, { type: 'play', card: 3, target: 1 });
eq('baron lower target out', b2.players[1].out, true);
eq('baron leaves you in', b2.players[0].out, false);
var b3 = fresh(3); setHands(b3, [[3,2],[7],[4]]); b3.deck = [5,6,8,1];
var b4 = Engine.applyMove(b3, { type: 'play', card: 3, target: 1 });
eq('baron can eliminate you', b4.players[0].out, true);
var b5 = fresh(3); setHands(b5, [[3,4],[4],[2]]); b5.deck = [5,6,8,1];
var b6 = Engine.applyMove(b5, { type: 'play', card: 3, target: 1 });
eq('baron tie eliminates nobody', [b6.players[0].out, b6.players[1].out], [false, false]);

section('handmaid');
var h = fresh(3); setHands(h, [[4,5],[1,2],[4]]); h.deck = [6,7,8,1];
var h2 = Engine.applyMove(h, { type: 'play', card: 4 });
eq('handmaid protects self', h2.players[0].protected, true);
eq('handmaid does not eliminate', h2.players[0].out, false);
eq('handmaid passes turn', h2.current, 1);
var h3 = Engine.applyMove(h2, { type: 'play', card: 1, target: 0, guess: 5 });
eq('protected target survives guard', h3.players[0].out, false);
eq('protected target guard cancelled', h3.lastAction.cancelled, true);
var h4 = Engine.applyMove(h3, { type: 'play', card: 4 });
eq('protection clears at own next turn', h4.players[0].protected, false);

section('prince');
var pr = fresh(3); setHands(pr, [[5,6],[8],[2]]); pr.deck = [3,4,7,1];
var pr2 = Engine.applyMove(pr, { type: 'play', card: 5, target: 1 });
eq('prince forces princess discard', pr2.players[1].out, true);
var pr3 = fresh(3); setHands(pr3, [[5,6],[2],[3]]); pr3.deck = [4,8,1,7];
var pr4 = Engine.applyMove(pr3, { type: 'play', card: 5, target: 0 });
eq('prince self discards old card', pr4.players[0].hand, [7]);
eq('prince self does not eliminate', pr4.players[0].out, false);
var pr5 = fresh(3); setHands(pr5, [[5,6],[2],[3]]); pr5.deck = [];
var pr6 = Engine.applyMove(pr5, { type: 'play', card: 5, target: 1 });
eq('prince with empty deck leaves target empty', pr6.lastRound.hands[1].value, 0);
eq('prince empty deck ends round', pr6.round, 2);

section('king');
var k = fresh(3); setHands(k, [[6,2],[7],[3]]); k.deck = [4,5,8,1];
var k2 = Engine.applyMove(k, { type: 'play', card: 6, target: 1 });
eq('king swaps hands with target', k2.players[0].hand, [7]);
ok('king target receives low card', k2.players[1].hand.indexOf(2) >= 0, JSON.stringify(k2.players[1].hand));
var k3 = fresh(3); setHands(k3, [[6,2],[7],[3]]); k3.deck = [4,5,8,1]; k3.players[1].protected = true;
var k4 = Engine.applyMove(k3, { type: 'play', card: 6, target: 1 });
eq('king vs handmaid cancelled', k4.players[0].hand, [2]);
eq('king cancellation flagged', k4.lastAction.cancelled, true);

section('princess');
var pn = fresh(3); setHands(pn, [[8,4],[2],[3]]); pn.deck = [5,6,7,1];
var pn2 = Engine.applyMove(pn, { type: 'play', card: 8 });
eq('playing princess eliminates self', pn2.players[0].out, true);
eq('princess round continues with others', pn2.current, 1);

section('deck exhaustion');
var e = fresh(2); setHands(e, [[4,6],[4]]); e.deck = [];
var e2 = Engine.applyMove(e, { type: 'play', card: 4 });
eq('deck empty compares hands', e2.lastRound.winners, [0]);
eq('round winner gets token', e2.players[0].tokens, 1);
eq('new round starts', e2.round, 2);
var tie = fresh(2); setHands(tie, [[4,6],[6]]); tie.players[1].discard = [4]; tie.deck = [];
var tie2 = Engine.applyMove(tie, { type: 'play', card: 4 });
eq('hand tie falls to discard sum', tie2.lastRound.shared, true);
eq('shared round gives both tokens', [tie2.players[0].tokens, tie2.players[1].tokens], [1, 1]);

section('match end');
var m = fresh(2); m.targetTokens = 1; setHands(m, [[4,6],[4]]); m.deck = [];
var m2 = Engine.applyMove(m, { type: 'play', card: 4 });
eq('match ends at target', m2.over, true);
eq('match winner recorded', m2.winner, 0);
eq('results expose tokens', Engine.getResults(m2).tokens.length, 2);
ok('results winners contains seat 0', Engine.getResults(m2).winners.indexOf(0) >= 0);
var m3 = Engine.getView(m2, 0);
eq('game over reveals hands', m3.players[1].hand.indexOf('hidden'), -1);

section('AI self-play');
[2,3,4].forEach(function (pc) {
  var allLegal = true, allOver = true, maxSteps = 0, tokenSane = true;
  for (var game = 0; game < 18; game++) {
    var state = Engine.createGame({ seed: 900 + game + pc * 100, playerCount: pc });
    var steps = 0;
    while (!Engine.isGameOver(state) && steps < 1500) {
      var move = Engine.chooseAIMove(state);
      if (!move) { allLegal = false; break; }
      try { state = Engine.applyMove(state, move); } catch (err) { allLegal = false; break; }
      steps += 1;
    }
    if (!Engine.isGameOver(state)) allOver = false;
    if (steps > maxSteps) maxSteps = steps;
    state.players.forEach(function (p) { if (p.tokens < 0 || p.tokens > state.targetTokens) tokenSane = false; });
  }
  eq(pc + 'p: 18 matches all legal', allLegal, true);
  eq(pc + 'p: 18 matches all finished', allOver, true);
  eq(pc + 'p: token counts bounded', tokenSane, true);
  ok(pc + 'p: step count bounded', maxSteps < 1500, 'max=' + maxSteps);
});

section('deterministic shuffle');
var d1 = Engine.createGame({ seed: 12345, playerCount: 3 });
var d2 = Engine.createGame({ seed: 12345, playerCount: 3 });
eq('same seed same hands', d1.players.map(function (p) { return p.hand; }), d2.players.map(function (p) { return p.hand; }));
eq('same seed same deck', d1.deck, d2.deck);
var d3 = Engine.createGame({ seed: 54321, playerCount: 3 });
ok('different seed different deal', JSON.stringify(d1.deck) !== JSON.stringify(d3.deck));

section('immutability + perf');
var im = Engine.createGame({ seed: 3, playerCount: 2 });
var snapshot = JSON.stringify(im);
Engine.applyMove(im, Engine.getLegalMoves(im)[0]);
eq('applyMove does not mutate input', JSON.stringify(im), snapshot);
var perfState = Engine.createGame({ seed: 11, playerCount: 4 });
var start = process.hrtime.bigint();
var perfMoves = 0;
for (var i = 0; i < 200 && !Engine.isGameOver(perfState); i++) {
  perfState = Engine.applyMove(perfState, Engine.chooseAIMove(perfState));
  perfMoves += 1;
}
var elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
ok('200-step AI simulation under 500ms', elapsedMs < 500, elapsedMs.toFixed(2) + 'ms');
ok('perf simulation advanced', perfMoves > 10, 'moves=' + perfMoves);

section('page + assets');
var html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(HERE, 'rules.html'), 'utf8');
ok('index loads engine.js', /<script[^>]*src="engine\.js"/.test(html));
ok('index loads data.js', /<script[^>]*src="data\.js"/.test(html));
ok('index reuses shared shuffle', /shared\/shuffle\.js/.test(html));
ok('index reuses shared sfx', /shared\/sfx\.js/.test(html));
ok('mobile viewport', /name="viewport"[^>]*width=device-width/.test(html));
ok('index has no external http request', !/(src|href)="https?:\/\//.test(html.replace(/<link[^>]*rel=["']canonical["'][^>]*>/gi, '')));
ok('touch targets >= 44px', /min-height:\s*44px/.test(html));
ok('aria labels present', /aria-label=/.test(html));
ok('rules page has FAQ JSON-LD', /FAQPage/.test(rules));
ok('rules page links back', /href="index\.html"/.test(rules));
ok('songti 700 declared', /Songti SC/.test(html));
ok('online page exists', fs.existsSync(path.join(HERE, 'online.html')));
ok('online server exists', fs.existsSync(path.join(HERE, 'online-server.mjs')));
ok('service worker precache exists', /CORE/.test(fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8')));
['card-back','wax-seal','token','table-crimson','envelope'].forEach(function (name) {
  ok('material ' + name + ' present', fs.existsSync(path.join(HERE, '../../assets/art/premium/love-letter', name + '.webp')));
});
['cover','og','detail-1','detail-2'].forEach(function (name) {
  ok('local art ' + name + ' present', fs.existsSync(path.join(HERE, 'assets', name + '.webp')));
});

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
