#!/usr/bin/env node
'use strict';

/* dixit-premium engine + card + page tests. Run: node games/boardgame/dixit-premium/test.js */

var fs = require('fs');
var path = require('path');
var Engine = require('./engine.js');
var Data = require('./data.js');
var Cards = require('./cards.js');
var HERE = __dirname;
var passed = 0, failed = 0, failures = [];
function ok(label, cond, detail) { if (cond) passed += 1; else { failed += 1; var line = label + (detail ? ' — ' + detail : ''); failures.push(line); console.log('FAIL ' + line); } return !!cond; }
function eq(label, actual, expected) { return ok(label, JSON.stringify(actual) === JSON.stringify(expected), 'got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(expected)); }
function throws(label, fn, pattern) { var threw = false, message = ''; try { fn(); } catch (err) { threw = true; message = String(err && err.message); } return ok(label, threw && (!pattern || pattern.test(message)), 'message=' + JSON.stringify(message)); }
function section(name) { console.log('\n## ' + name); }
function legal(state) { return Engine.getLegalMoves(state); }
function clueMove(state, card, text) { return { type: 'clue', card: card, text: text }; }
function voteSetup(seed, votes, submissions, storyCard, playerCount) {
  var g = Engine.createGame({ seed: seed || 9, playerCount: playerCount || 4 });
  var order = [storyCard].concat(submissions.slice(1));
  g.storyteller = 0; g.phase = 'vote'; g.current = playerCount - 1; g.clue = '测试线索'; g.storytellerCard = storyCard;
  g.submissions = {}; submissions.forEach(function (card, i) { g.submissions[i] = card; });
  g.submitOrder = submissions.slice(); g.voteOrder = order; g.votes = {};
  votes.forEach(function (card, i) { if (card != null) g.votes[i] = card; });
  return g;
}

section('deck + setup');
eq('84 cards', Data.CARDS.length, 84);
eq('unique card ids', new Set(Data.CARDS.map(function (c) { return c.id; })).size, 84);
eq('6 cards per hand', Data.HAND_SIZE, 6);
eq('target 30', Data.TARGET_SCORE, 30);
eq('3-6 players', [Data.MIN_PLAYERS, Data.MAX_PLAYERS], [3, 6]);
eq('12 palettes', Data.PALETTES.length, 12);
eq('12 motifs', Data.MOTIFS.length, 12);
ok('every card has two tags', Data.CARDS.every(function (c) { return c.tags.length === 2 && c.tags[0] && c.tags[1]; }));
ok('card faces have no text renderer', Data.CARDS.every(function (c) { var svg = Cards.render(c.id, { uid: 'test' + c.id }); return svg.length > 1000 && !/<text[\s>]/.test(svg); }));
[3,4,5,6].forEach(function (pc) {
  var g = Engine.createGame({ seed: 20 + pc, playerCount: pc });
  eq(pc + 'p players', g.players.length, pc);
  eq(pc + 'p hand size', g.players.map(function (p) { return p.hand.length; }), new Array(pc).fill(6));
  eq(pc + 'p deck left', g.deck.length, 84 - 6 * pc);
  eq(pc + 'p storyteller 0', g.storyteller, 0);
  eq(pc + 'p clue phase', g.phase, 'clue');
  eq(pc + 'p target', g.targetScore, 30);
  var used = g.players.reduce(function (n, p) { return n + p.hand.length; }, 0) + g.deck.length;
  eq(pc + 'p card conservation', used, 84);
  ok(pc + 'p only seat 0 human', !g.players[0].isAI && g.players.slice(1).every(function (p) { return p.isAI; }));
});
throws('2 players rejected', function () { Engine.createGame({ playerCount: 2 }); });
throws('7 players rejected', function () { Engine.createGame({ playerCount: 7 }); });

section('clue');
var g = Engine.createGame({ seed: 2, playerCount: 4 });
var hand0 = g.players[0].hand.slice();
ok('storyteller can pick any hand card', legal(g).every(function (m) { return m.type === 'clue' && hand0.indexOf(m.card) >= 0; }));
throws('empty clue rejected', function () { Engine.applyMove(g, clueMove(g, hand0[0], '   ')); }, /线索/);
throws('long clue rejected', function () { Engine.applyMove(g, clueMove(g, hand0[0], new Array(62).join('字'))); }, /60/);
throws('newline clue rejected', function () { Engine.applyMove(g, clueMove(g, hand0[0], 'a\nb')); }, /换行/);
var c = Engine.applyMove(g, clueMove(g, hand0[0], '像潮汐一样退去'));
eq('clue stores text', c.clue, '像潮汐一样退去');
eq('storyteller card stored', c.storytellerCard, hand0[0]);
eq('storyteller card left hand', c.players[0].hand.indexOf(hand0[0]), -1);
eq('phase submit', c.phase, 'submit');
eq('current first non-storyteller', c.current, 1);
eq('submit legal cards', legal(c).every(function (m) { return m.type === 'submit' && c.players[1].hand.indexOf(m.card) >= 0; }), true);

section('submit + vote order');
var s = Engine.applyMove(g, clueMove(g, hand0[0], '线索'));
var submitCards = [];
for (var i = 1; i < 4; i++) { var h = s.players[i].hand[0]; submitCards.push(h); s = Engine.applyMove(s, { type: 'submit', card: h }); }
eq('phase vote after all submit', s.phase, 'vote');
eq('vote order length', s.voteOrder.length, 4);
eq('vote order contains storyteller card', s.voteOrder.indexOf(hand0[0]) !== -1, true);
eq('vote order contains each submit', submitCards.every(function (card) { return s.voteOrder.indexOf(card) !== -1; }), true);
ok('own card excluded from legal votes', legal(s).every(function (m) { return m.card !== s.submissions[s.current]; }));

section('scoring: all correct');
var ga = voteSetup(11, [0, 10, 10, null], [0, 11, 12, 13], 10);
ga.votes = { 1: 10, 2: 10 }; ga.current = 3;
ga = Engine.applyMove(ga, { type: 'vote', card: 10 });
eq('all correct outcome', ga.lastRound.outcome, 'all');
eq('storyteller gets 0', ga.lastRound.delta[0], 0);
eq('others get 2 each', [ga.lastRound.delta[1], ga.lastRound.delta[2], ga.lastRound.delta[3]], [2, 2, 2]);
eq('new round starts', ga.round, 2);
eq('storyteller rotates', ga.storyteller, 1);

section('scoring: none correct');
var gn = voteSetup(12, [null, 12, 14, null], [0, 11, 12, 14], 10);
gn.votes = { 1: 12, 2: 14 }; gn.current = 3;
gn = Engine.applyMove(gn, { type: 'vote', card: 11 });
eq('none correct outcome', gn.lastRound.outcome, 'none');
eq('storyteller gets 0', gn.lastRound.delta[0], 0);
eq('others get 2 each', [gn.lastRound.delta[1], gn.lastRound.delta[2], gn.lastRound.delta[3]], [2, 2, 2]);

section('scoring: partial + card votes');
var gp = voteSetup(13, [null, 10, 10, 11], [0, 11, 12, 13], 10);
gp.votes = { 1: 10, 2: 10, 3: 11 }; gp.current = 3;
gp = Engine.applyMove(gp, { type: 'vote', card: 11 });
eq('partial outcome', gp.lastRound.outcome, 'normal');
eq('storyteller +3', gp.lastRound.delta[0], 3);
eq('correct voter 1 +4', gp.lastRound.delta[1], 4);
eq('correct voter 2 +3', gp.lastRound.delta[2], 3);
eq('non-voter 3 +0', gp.lastRound.delta[3], 0);
eq('card owner vote count', gp.lastRound.cards.filter(function (x) { return x.card === 11; })[0].votes, 1);

section('hidden information');
var hv = Engine.createGame({ seed: 5, playerCount: 4 });
hv = Engine.applyMove(hv, clueMove(hv, hv.players[0].hand[0], '秘密线索'));
var view1 = Engine.getView(hv, 1);
eq('storyteller card hidden during submit', view1.storytellerCard, null);
eq('clue text public', view1.clue, '秘密线索');
ok('own hand visible', view1.players[1].hand.every(function (c) { return c !== 'hidden'; }));
ok('other hands hidden', view1.players[0].hand.every(function (c) { return c === 'hidden'; }));
ok('clue action does not leak card', view1.lastAction == null || view1.lastAction.card == null);
eq('vote cards hidden during submit', view1.voteCards, []);
eq('submission counts public', typeof view1.submissionsCount, 'number');
var spectator = Engine.getView(hv, null);
ok('spectator sees no hands', spectator.players.every(function (p) { return p.hand.every(function (c) { return c === 'hidden'; }); }));

section('end conditions');
var end = voteSetup(14, [null, 10, 10, 11], [0, 11, 12, 13], 10);
end.players[0].score = 29; end.votes = { 1: 10, 2: 10 }; end.current = 3;
end = Engine.applyMove(end, { type: 'vote', card: 11 });
eq('30 points ends the game', end.over, true);
eq('winner is storyteller', end.winner, 0);
eq('result scores present', Engine.getResults(end).scores.length, 4);
var empty = voteSetup(15, [null, 10, 10, 10], [0, 11, 12, 13], 10);
empty.deck = []; empty.votes = { 1: 10, 2: 10 }; empty.current = 3;
empty = Engine.applyMove(empty, { type: 'vote', card: 10 });
eq('empty deck ends after round', empty.over, true);
ok('empty deck winner exists', empty.winners.length >= 1);

section('determinism + immutability + perf');
var d1 = Engine.createGame({ seed: 123, playerCount: 4 });
var d2 = Engine.createGame({ seed: 123, playerCount: 4 });
eq('same seed same hands', d1.players.map(function (p) { return p.hand; }), d2.players.map(function (p) { return p.hand; }));
eq('same seed same deck', d1.deck, d2.deck);
var im = Engine.createGame({ seed: 3, playerCount: 4 });
var before = JSON.stringify(im);
Engine.applyMove(im, clueMove(im, im.players[0].hand[0], 'x'));
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
    var state = Engine.createGame({ seed: 700 + game + pc * 100, playerCount: pc });
    var n = 0;
    while (!Engine.isGameOver(state) && n < 2000) {
      var move = Engine.chooseAIMove(state);
      if (!move) { allLegal = false; break; }
      try { state = Engine.applyMove(state, move); } catch (err) { allLegal = false; break; }
      n += 1;
    }
    if (!Engine.isGameOver(state)) allOver = false;
    if (n > maxSteps) maxSteps = n;
    state.players.forEach(function (p) { if (p.score < 0 || p.hand.length > 6) scoresSane = false; });
  }
  eq(pc + 'p: 14 matches all legal', allLegal, true);
  eq(pc + 'p: 14 matches all finished', allOver, true);
  eq(pc + 'p: scores and hands sane', scoresSane, true);
  ok(pc + 'p: step count bounded', maxSteps < 2000, 'max=' + maxSteps);
});

section('page + assets');
var html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
var rules = fs.readFileSync(path.join(HERE, 'rules.html'), 'utf8');
ok('index loads engine.js', /<script[^>]*src="engine\.js"/.test(html));
ok('index loads data.js', /<script[^>]*src="data\.js"/.test(html));
ok('index loads cards.js', /<script[^>]*src="cards\.js"/.test(html));
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
['card-cream','table-teal','brass-token','moon-gate'].forEach(function (name) { ok('material ' + name + ' present', fs.existsSync(path.join(HERE, '../../assets/art/premium/dixit', name + '.webp'))); });
['cover','og','detail-1','detail-2'].forEach(function (name) { ok('local art ' + name + ' present', fs.existsSync(path.join(HERE, 'assets', name + '.webp'))); });

console.log('\nRESULT: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
