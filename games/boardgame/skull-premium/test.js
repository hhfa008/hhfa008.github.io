#!/usr/bin/env node
'use strict';

/* skull-premium engine + page tests. Run: node games/boardgame/skull-premium/test.js */

var fs = require('fs');
var path = require('path');
var Engine = require('./engine.js');
var Data = require('./data.js');
var HERE = __dirname;
var passed = 0, failed = 0, failures = [];
function ok(label, cond, detail) { if (cond) passed += 1; else { failed += 1; var line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('FAIL ' + line); } return !!cond; }
function eq(label, actual, expected) { return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
function throws(label, fn) { var threw = false, message = ''; try { fn(); } catch (err) { threw = true; message = err && err.message; } return ok(label, threw, 'message=' + JSON.stringify(message)); }
function section(name) { console.log('\n## ' + name); }
function kind(state, type) { return Engine.getLegalMoves(state).filter(function (m) { return m.type === type; }); }

section('components');
eq('3-6 players', [Engine.MIN_PLAYERS, Engine.MAX_PLAYERS], [3, 6]);
eq('4 coasters each', Engine.DISCS_PER_PLAYER, 4);
eq('3 roses each', Engine.ROSES_PER_PLAYER, 3);
eq('1 skull each', Engine.SKULLS_PER_PLAYER, 1);
eq('2 points to win', Engine.TARGET_POINTS, 2);
[3,4,5,6].forEach(function (pc) {
  var g = Engine.createGame({ seed: 10 + pc, playerCount: pc });
  eq(pc + 'p players', g.players.length, pc);
  eq(pc + 'p round 1', g.round, 1);
  eq(pc + 'p placement', g.phase, 'placement');
  eq(pc + 'p current 0', g.current, 0);
  g.players.forEach(function (p) { eq(pc + 'p player ' + p.index + ' roses', p.roses, 3); eq(pc + 'p player ' + p.index + ' skull', p.skull, 1); eq(pc + 'p player ' + p.index + ' total', Engine.totalDiscs(p), 4); eq(pc + 'p player ' + p.index + ' stack empty', p.stack, []); });
  eq(pc + 'p only seat 0 human', g.players[0].isAI, false);
  ok(pc + 'p others AI', g.players.slice(1).every(function (p) { return p.isAI; }));
  ok(pc + 'p log has opening', g.log.length > 0);
});
throws('2 players rejected', function () { Engine.createGame({ playerCount: 2 }); });
throws('7 players rejected', function () { Engine.createGame({ playerCount: 7 }); });

section('placement');
var g = Engine.createGame({ seed: 1, playerCount: 3 });
var opening = Engine.getLegalMoves(g);
ok('first player can place rose', opening.some(function (m) { return m.type === 'place' && m.disc === 'rose'; }));
ok('first player can place skull', opening.some(function (m) { return m.type === 'place' && m.disc === 'skull'; }));
ok('first player cannot pass with empty table', !opening.some(function (m) { return m.type === 'pass'; }));
g = Engine.applyMove(g, { type: 'place', disc: 'rose' });
eq('rose removed from hand', g.players[0].roses, 2);
eq('stack has one disc', g.players[0].stack, ['rose']);
eq('placed total 1', g.placement.placedTotal, 1);
eq('turn passes to player 1', g.current, 1);
eq('last placed by 0', g.placement.lastPlacedBy, 0);
g = Engine.applyMove(g, { type: 'pass' });
eq('player 1 passed', g.players[1].passed, true);
eq('turn passes to player 2', g.current, 2);
g = Engine.applyMove(g, { type: 'pass' });
eq('player 2 passed', g.players[2].passed, true);
eq('returns to player 0', g.current, 0);
eq('still placement', g.phase, 'placement');
g = Engine.applyMove(g, { type: 'pass' });
eq('all passed -> bidding', g.phase, 'bidding');
eq('last placer opens bidding', g.bid.current, 0);
eq('no bid yet', g.bid.highest, 0);
var once = Engine.createGame({ seed: 2, playerCount: 3 });
once = Engine.applyMove(once, { type: 'place', disc: 'rose' });
eq('only one disc placed per turn', once.players[0].stack.length, 1);
eq('hand now 2 roses + 1 skull', [once.players[0].roses, once.players[0].skull], [2, 1]);
throws('cannot bid during placement', function () { Engine.applyMove(once, { type: 'bid', amount: 1 }); });

section('bidding');
var b = Engine.createGame({ seed: 3, playerCount: 3 });
b = Engine.applyMove(b, { type: 'place', disc: 'rose' });
b = Engine.applyMove(b, { type: 'place', disc: 'rose' });
b = Engine.applyMove(b, { type: 'place', disc: 'rose' });
b = Engine.applyMove(b, { type: 'place', disc: 'rose' });
b = Engine.applyMove(b, { type: 'pass' });
b = Engine.applyMove(b, { type: 'pass' });
b = Engine.applyMove(b, { type: 'pass' });
eq('bidding starts', b.phase, 'bidding');
var bMoves = Engine.getLegalMoves(b);
ok('opening bid 1 legal', bMoves.some(function (m) { return m.type === 'bid' && m.amount === 1; }));
ok('opening pass illegal', !bMoves.some(function (m) { return m.type === 'pass'; }));
ok('cannot bid above table total', bMoves.every(function (m) { return m.type !== 'bid' || m.amount <= b.placement.placedTotal; }));
b = Engine.applyMove(b, { type: 'bid', amount: 1 });
eq('highest bid 1', b.bid.highest, 1);
eq('bidder 0', b.bid.bidder, 0);
eq('turn to 1', b.current, 1);
var b2 = Engine.getLegalMoves(b);
ok('next bid must be 2', b2.some(function (m) { return m.type === 'bid' && m.amount === 2; }));
ok('lower bid not offered', !b2.some(function (m) { return m.type === 'bid' && m.amount === 1; }));
ok('pass offered once bid exists', b2.some(function (m) { return m.type === 'pass'; }));
b = Engine.applyMove(b, { type: 'pass' });
b = Engine.applyMove(b, { type: 'pass' });
eq('all others passed -> reveal', b.phase, 'reveal');
eq('highest bidder reveals', b.reveal.bidder, 0);
eq('reveal target 1', b.reveal.target, 1);

section('reveal + success');
var s = Engine.createGame({ seed: 4, playerCount: 3 });
s = Engine.applyMove(s, { type: 'place', disc: 'rose' });
s = Engine.applyMove(s, { type: 'pass' }); s = Engine.applyMove(s, { type: 'pass' }); s = Engine.applyMove(s, { type: 'pass' });
s = Engine.applyMove(s, { type: 'bid', amount: 1 }); s = Engine.applyMove(s, { type: 'pass' }); s = Engine.applyMove(s, { type: 'pass' });
var reveals = Engine.getLegalMoves(s).filter(function (m) { return m.type === 'reveal'; });
ok('own stack revealable', reveals.some(function (m) { return m.player === 0; }));
s = Engine.applyMove(s, { type: 'reveal', player: 0 });
eq('success scores 1', s.players[0].score, 1);
eq('round 2 starts', s.round, 2);
eq('placed disc returned', s.players[0].roses, 3);
eq('stacks cleared', s.players[0].stack, []);
eq('last round success', s.lastRound.success, true);
eq('last round target', s.lastRound.target, 1);
eq('next first player', s.firstPlayer, 1);

section('skull failure');
var f = Engine.createGame({ seed: 5, playerCount: 3 });
f = Engine.applyMove(f, { type: 'place', disc: 'skull' });
f = Engine.applyMove(f, { type: 'pass' }); f = Engine.applyMove(f, { type: 'pass' }); f = Engine.applyMove(f, { type: 'pass' });
f = Engine.applyMove(f, { type: 'bid', amount: 1 }); f = Engine.applyMove(f, { type: 'pass' }); f = Engine.applyMove(f, { type: 'pass' });
f.players[0].roses = 0; f.players[0].skull = 0;
f = Engine.applyMove(f, { type: 'reveal', player: 0 });
eq('skull fails challenge', f.lastRound.success, false);
eq('failed bidder lost a disc', Engine.totalDiscs(f.players[0]), 0);
eq('player with no discs is out', f.players[0].out, true);
eq('no score on failure', f.lastRound.scores[0].score, 0);

section('reveal depth rules');
var d = Engine.createGame({ seed: 6, playerCount: 3 });
d.players[0].stack = ['rose','skull']; d.players[1].stack = ['rose','skull'];
d.placement = { placedTotal: 4, lastPlacedBy: 0 }; d.phase = 'reveal'; d.bid = { highest: 3, bidder: 0, current: 0 };
d.reveal = { bidder: 0, target: 3, flipped: 0, flips: [], revealedFrom: { 0: 0 } }; d.current = 0;
var dMoves = Engine.getLegalMoves(d);
ok('own stack available', dMoves.some(function (m) { return m.player === 0; }));
ok('other top available', dMoves.some(function (m) { return m.player === 1; }));
d = Engine.applyMove(d, { type: 'reveal', player: 1 });
var afterOther = Engine.getLegalMoves(d);
ok('cannot go deeper into another stack', !afterOther.some(function (m) { return m.player === 1; }));
ok('can still reveal own stack', afterOther.some(function (m) { return m.player === 0; }));
d = Engine.applyMove(d, { type: 'reveal', player: 0 });
var afterOwn = Engine.getLegalMoves(d);
ok('can go deeper into own stack', afterOwn.some(function (m) { return m.player === 0; }));
d.players[0].stack = ['rose'];
d = Engine.applyMove(d, { type: 'reveal', player: 0 });
ok('reveal target reached ends round', d.lastRound && typeof d.lastRound.success === 'boolean');

section('hidden information');
var h = Engine.createGame({ seed: 7, playerCount: 4 });
h.players[0].stack = ['skull']; h.players[1].stack = ['rose'];
var hv = Engine.getView(h, 0);
eq('own stack visible', hv.players[0].stack, ['skull']);
eq('other stack hidden', hv.players[1].stack, ['hidden']);
eq('own hand visible', [hv.players[0].roses, hv.players[0].skull], [3, 1]);
eq('other hand hidden', [hv.players[1].roses, hv.players[1].skull], [null, null]);
eq('public hand count', hv.players[1].handCount, 4);
var spectator = Engine.getView(h, null);
ok('spectator sees no stack type', spectator.players[0].stack.every(function (v) { return v === 'hidden'; }));

section('match end + determinism');
var m = Engine.createGame({ seed: 8, playerCount: 3 });
m.players[0].score = 1; m.players[0].stack = ['rose'];
m.placement = { placedTotal: 1, lastPlacedBy: 0 }; m.phase = 'reveal'; m.bid = { highest: 1, bidder: 0, current: 0 };
m.reveal = { bidder: 0, target: 1, flipped: 0, flips: [], revealedFrom: { 0: 0 } }; m.current = 0;
m = Engine.applyMove(m, { type: 'reveal', player: 0 });
eq('second successful challenge wins match', m.over, true);
eq('winner seat 0', m.winner, 0);
eq('result has scores', Engine.getResults(m).scores.length, 3);
eq('match reveals stacks', Engine.getView(m, 1).players[0].stack, []);
var det1 = Engine.createGame({ seed: 123, playerCount: 4 });
var det2 = Engine.createGame({ seed: 123, playerCount: 4 });
eq('same seed same players', det1.players.map(function (p) { return [p.roses, p.skull]; }), det2.players.map(function (p) { return [p.roses, p.skull]; }));
var loss1 = Engine.createGame({ seed: 77, playerCount: 3 });
var loss2 = Engine.createGame({ seed: 77, playerCount: 3 });
[loss1, loss2].forEach(function (state) {
  state.players[0].stack = ['skull']; state.placement = { placedTotal: 1, lastPlacedBy: 0 }; state.phase = 'reveal';
  state.bid = { highest: 1, bidder: 0, current: 0 }; state.reveal = { bidder: 0, target: 1, flipped: 0, flips: [], revealedFrom: { 0: 0 } }; state.current = 0;
});
loss1 = Engine.applyMove(loss1, { type: 'reveal', player: 0 });
loss2 = Engine.applyMove(loss2, { type: 'reveal', player: 0 });
eq('same seed same lost disc', loss1.lastRound.lostDisc, loss2.lastRound.lostDisc);

section('immutability + perf');
var im = Engine.createGame({ seed: 9, playerCount: 4 });
var before = JSON.stringify(im);
Engine.applyMove(im, Engine.getLegalMoves(im)[0]);
eq('applyMove does not mutate input', JSON.stringify(im), before);
var perfState = Engine.createGame({ seed: 12, playerCount: 5 });
var start = process.hrtime.bigint();
var steps = 0;
while (!Engine.isGameOver(perfState) && steps < 400) { perfState = Engine.applyMove(perfState, Engine.chooseAIMove(perfState)); steps += 1; }
var elapsed = Number(process.hrtime.bigint() - start) / 1e6;
ok('AI simulation under 500ms', elapsed < 500, elapsed.toFixed(2) + 'ms');
ok('AI simulation advanced', steps > 10, 'steps=' + steps);

section('AI self-play');
[3,4,5,6].forEach(function (pc) {
  var allLegal = true, allOver = true, maxSteps = 0, scoresSane = true;
  for (var game = 0; game < 14; game++) {
    var state = Engine.createGame({ seed: 500 + game + pc * 100, playerCount: pc });
    var n = 0;
    while (!Engine.isGameOver(state) && n < 2500) {
      var move = Engine.chooseAIMove(state);
      if (!move) { allLegal = false; break; }
      try { state = Engine.applyMove(state, move); } catch (err) { allLegal = false; break; }
      n += 1;
    }
    if (!Engine.isGameOver(state)) allOver = false;
    if (n > maxSteps) maxSteps = n;
    state.players.forEach(function (p) { if (p.score < 0 || p.score > Engine.TARGET_POINTS) scoresSane = false; if (p.roses < 0 || p.skull < 0) scoresSane = false; });
  }
  eq(pc + 'p: 14 matches all legal', allLegal, true);
  eq(pc + 'p: 14 matches all finished', allOver, true);
  eq(pc + 'p: scores and discs sane', scoresSane, true);
  ok(pc + 'p: step count bounded', maxSteps < 2500, 'max=' + maxSteps);
});

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
['coaster','table-wood','bar-mat'].forEach(function (name) { ok('material ' + name + ' present', fs.existsSync(path.join(HERE, '../../assets/art/premium/skull', name + '.webp'))); });
['cover','og','detail-1','detail-2'].forEach(function (name) { ok('local art ' + name + ' present', fs.existsSync(path.join(HERE, 'assets', name + '.webp'))); });

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
