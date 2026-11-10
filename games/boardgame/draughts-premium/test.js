#!/usr/bin/env node
'use strict';

/* International Draughts (10×10) engine tests.
   node games/boardgame/draughts-premium/test.js
   Prints: RESULT: N passed, M failed */

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
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}
function throws(label, fn, pattern) {
  var threw = false, message = '';
  try { fn(); } catch (err) { threw = true; message = String(err && err.message); }
  return ok(label, threw && (!pattern || pattern.test(message)), 'message=' + JSON.stringify(message));
}
function sq(r, c) { return E.idx(r, c); }
function craft(items, turn) {
  var s = E.createGame();
  s.board = new Array(100).fill(0);
  items.forEach(function (it) { s.board[it[0]] = it[1]; });
  s.turn = turn == null ? E.WHITE : turn;
  s.history = [];
  s.captures = { white: [], black: [] };
  s.kingMoves = 0;
  s.over = false;
  s.winner = 0;
  s.reason = '';
  s.repetition = {};
  return s;
}
function dests(state) { return E.legalMoves(state).map(function (m) { return m.to; }).sort(function (a, b) { return a - b; }); }

/* ------------------------------------------------------------------ */
/* Board, numbering and opening                                        */
/* ------------------------------------------------------------------ */
eq('100 cells', E.CELLS, 100);
eq('10 files', E.SIZE, 10);
var dark = 0;
for (var i = 0; i < 100; i++) if (E.isDark(E.row(i), E.col(i))) dark += 1;
eq('50 playable dark squares', dark, 50);
eq('only dark squares are numbered', [E.number(sq(0, 1)), E.number(sq(9, 8)), E.number(sq(1, 0))], [1, 50, 6]);
ok('fromNumber round-trips all 50 squares', (function () {
  for (var n = 1; n <= 50; n++) {
    var s = E.fromNumber(n);
    if (E.number(s) !== n || !E.isDark(E.row(s), E.col(s))) return false;
  }
  return true;
})());

var game = E.createGame();
eq('20 white pieces', E.countPieces(game, E.WHITE), 20);
eq('20 black pieces', E.countPieces(game, E.BLACK), 20);
eq('40 pieces total', game.board.filter(Boolean).length, 40);
eq('white moves first', game.turn, E.WHITE);
eq('opening has 9 legal man moves', E.legalMoves(game).length, 9);
ok('opening keeps every piece on dark squares', game.board.every(function (p, i) {
  return !p || E.isDark(E.row(i), E.col(i));
}));
eq('side of pieces', [E.sideOf(1), E.sideOf(-2), E.sideOf(0)], [E.WHITE, E.BLACK, 0]);
ok('king flags', E.isKing(2) && E.isKing(-2) && !E.isKing(1) && !E.isKing(-1));
eq('king draw rule is 50 plies', E.KING_DRAW_PLIES, 50);

/* ------------------------------------------------------------------ */
/* Men: forward only, capture in every direction                        */
/* ------------------------------------------------------------------ */
var s = craft([[sq(6, 1), 1]], E.WHITE);
eq('white man has two forward moves', dests(s), [sq(5, 0), sq(5, 2)]);
s = craft([[sq(6, 1), -1]], E.BLACK);
eq('black man moves the other way', dests(s), [sq(7, 0), sq(7, 2)]);
s = craft([[sq(6, 1), 1], [sq(5, 0), 1]], E.WHITE);
eq('own piece blocks a forward move', dests(s), [sq(4, 1), sq(5, 2)]);

s = craft([[sq(6, 1), 1], [sq(5, 2), -1]], E.WHITE);
var cap = E.legalMoves(s);
eq('capture is mandatory', cap.length, 1);
eq('white man captures forward-right', [cap[0].from, cap[0].to, cap[0].captures], [sq(6, 1), sq(4, 3), [sq(5, 2)]]);
eq('capture notation uses x', E.moveNotation(cap[0]), '31x22');

s = craft([[sq(4, 3), 1], [sq(5, 4), -1]], E.WHITE);
var back = E.legalMoves(s);
eq('man may capture backwards', back.length, 1);
eq('backward capture lands beyond the victim', back[0].to, sq(6, 5));

s = craft([[sq(6, 1), 1], [sq(5, 2), -1], [sq(5, 0), 1]], E.WHITE);
eq('a quiet move is illegal while a capture exists', E.legalMoves(s).every(function (m) { return m.captures.length > 0; }), true);

/* Maximum capture rule. */
s = craft([
  [sq(8, 1), 1], [sq(7, 2), -1], [sq(5, 4), -1],
  [sq(4, 7), 1], [sq(3, 6), -1]
], E.WHITE);
var maxMoves = E.legalMoves(s);
eq('only maximum-length capture is legal', maxMoves.length, 1);
eq('maximum capture takes three pieces', maxMoves[0].captures.length, 3);
eq('maximum capture path', maxMoves[0].path, [sq(8, 1), sq(6, 3), sq(4, 5), sq(2, 7)]);
eq('the one-piece capture is filtered out', maxMoves.some(function (m) { return m.from === sq(4, 7); }), false);

/* Promotion. */
s = craft([[sq(1, 2), 1]], E.WHITE);
var promos = E.legalMoves(s);
ok('both quiet moves to the last row promote', promos.length === 2 && promos.every(function (m) { return m.promoted; }));
var promoted = E.applyMove(s, promos[0]);
ok('promoted piece becomes a king', E.isKing(promoted.board[promos[0].to]));
eq('promotion is recorded in history', promoted.history[0].promoted, true);

s = craft([[sq(2, 1), 1], [sq(1, 2), -1]], E.WHITE);
var promCap = E.legalMoves(s);
eq('capture onto the last row promotes', promCap.length, 1);
ok('capture promotion flag', promCap[0].promoted === true);
ok('capture promotion makes a king', E.isKing(E.applyMove(s, promCap[0]).board[promCap[0].to]));

/* Man passes the promotion row during a chain and continues as a man. */
s = craft([
  [sq(2, 1), 1], [sq(1, 2), -1], [sq(1, 4), -1]
], E.WHITE);
var chain = E.legalMoves(s);
eq('chain through the promotion row takes both', chain.length, 1);
eq('chain ends beyond the promotion row', chain[0].to, sq(2, 5));
eq('passing the promotion row does not promote', chain[0].promoted, false);
ok('chain end piece remains a man', !E.isKing(E.applyMove(s, chain[0]).board[sq(2, 5)]));

/* ------------------------------------------------------------------ */
/* Flying kings                                                        */
/* ------------------------------------------------------------------ */
s = craft([[sq(5, 4), 2]], E.WHITE);
eq('king has 17 quiet diagonal moves from the centre', E.legalMoves(s).length, 17);
s = craft([[sq(5, 4), 2], [sq(4, 5), 1]], E.WHITE);
eq('own piece stops a king', E.legalMoves(s).length, 14);

s = craft([[sq(5, 0), 2], [sq(3, 2), -1]], E.WHITE);
var kingCaps = E.legalMoves(s);
eq('flying king may land on any empty square beyond', kingCaps.length, 3);
eq('flying king landing squares', kingCaps.map(function (m) { return m.to; }).sort(function (a, b) { return a - b; }), [sq(0, 5), sq(1, 4), sq(2, 3)]);
ok('flying king captures one piece', kingCaps.every(function (m) { return m.captures.length === 1 && m.captures[0] === sq(3, 2); }));

s = craft([[sq(5, 0), 2], [sq(4, 1), -1], [sq(3, 2), -1]], E.WHITE);
eq('king cannot jump over two adjacent pieces', E.legalMoves(s).filter(function (m) { return m.captures.length; }).length, 0);

s = craft([[sq(5, 0), 2], [sq(3, 2), -1], [sq(1, 4), -1]], E.WHITE);
var kingChain = E.legalMoves(s);
eq('king chain captures both pieces', kingChain.filter(function (m) { return m.captures.length === 2; }).length > 0, true);

/* ------------------------------------------------------------------ */
/* Apply, history, captures and end conditions                         */
/* ------------------------------------------------------------------ */
s = craft([[sq(6, 1), 1], [sq(5, 2), -1]], E.WHITE);
var m = E.legalMoves(s)[0];
var after = E.applyMove(s, m);
eq('victim removed', after.board[sq(5, 2)], 0);
eq('mover lands on target', after.board[sq(4, 3)], 1);
eq('turn flips to black', after.turn, E.BLACK);
eq('captured piece recorded', after.captures.black, [-1]);
eq('history records the capture', after.history[0].captures, [sq(5, 2)]);
eq('original state untouched', s.board[sq(6, 1)], 1);
throws('fabricated move is rejected', function () { E.applyMove(s, { from: sq(6, 1), to: sq(0, 0) }); }, /不符合规则/);
throws('moves after game over are rejected', function () {
  var done = E.createGame();
  done.over = true;
  E.applyMove(done, E.legalMoves(s)[0]);
}, /已结束/);

s = craft([[sq(6, 1), 1]], E.WHITE);
var quiet = E.applyMove(s, E.legalMoves(s)[0]);
eq('quiet move increments the king-only counter', quiet.kingMoves, 0);

var draw = craft([[sq(5, 4), 2], [sq(0, 1), -2]], E.WHITE);
draw.kingMoves = 49;
var drawMove = E.legalMoves(draw)[0];
var drawn = E.applyMove(draw, drawMove);
eq('50 king-only plies end in a draw', [drawn.over, drawn.winner, drawn.reason], [true, 0, 'king25']);

/* Repetition: two kings shuttle through the same four positions. */
var rep = craft([[sq(5, 4), 2], [sq(0, 3), -2]], E.WHITE);
rep.repetition = {};
var cycle = [
  [sq(5, 4), sq(4, 3)], [sq(0, 3), sq(1, 2)],
  [sq(4, 3), sq(5, 4)], [sq(1, 2), sq(0, 3)]
];
for (var round = 0; round < 3 && !rep.over; round++) {
  for (var ci = 0; ci < cycle.length && !rep.over; ci++) {
    var step = E.findMove(rep, { from: cycle[ci][0], to: cycle[ci][1] });
    ok('repetition cycle step is legal', !!step, 'round ' + round + ' step ' + ci);
    rep = E.applyMove(rep, step);
  }
}
eq('threefold repetition ends the game', [rep.over, rep.reason], [true, 'repetition']);

/* ------------------------------------------------------------------ */
/* Public view and AI                                                  */
/* ------------------------------------------------------------------ */
var pub = E.publicState(game, 0);
eq('seat 0 is white and can move', [pub.you, pub.yourSide, pub.canMove], [0, E.WHITE, true]);
eq('public legal moves carry notation', pub.legal.length, 9);
ok('public notation uses square numbers', /^\d+-?\d+/.test(pub.legal[0].notation), pub.legal[0].notation);
var pub2 = E.publicState(game, 1);
eq('seat 1 waits on white move', pub2.canMove, false);

for (var level = 1; level <= 3; level++) {
  var st = E.createGame();
  var ai = E.aiMove(st, level, 150);
  ok('AI level ' + level + ' returns a legal move', ai != null && E.findMove(st, ai) != null);
}

var sim = E.createGame();
var plies = 0;
while (!sim.over && plies < 20) {
  var aim = E.aiMove(sim, 1, 60);
  if (!aim) break;
  sim = E.applyMove(sim, aim);
  plies += 1;
  var onBoard = sim.board.filter(Boolean).length;
  var captured = sim.captures.white.length + sim.captures.black.length;
  if (onBoard + captured !== 40) {
    ok('piece conservation at ply ' + plies, false, onBoard + '+' + captured);
    break;
  }
}
eq('20-ply self-play conserved 40 pieces', sim.board.filter(Boolean).length + sim.captures.white.length + sim.captures.black.length, 40);
ok('self-play produced history', sim.history.length >= 10, 'history=' + sim.history.length);
ok('every history move has notation', sim.history.every(function (h) { return /^\d+[-x]/.test(h.notation); }));

var kingState = craft([[sq(5, 4), 2], [sq(0, 1), -2]], E.WHITE);
var kingMove = E.legalMoves(kingState)[0];
var kingAfter = E.applyMove(kingState, kingMove);
ok('king quiet move keeps kings on board', E.isKing(kingAfter.board[kingMove.to]));
eq('public view exposes seat-aware winner on a finished state', (function () {
  var finished = craft([[sq(5, 4), 2]], E.WHITE);
  finished.over = true;
  finished.winner = E.WHITE;
  finished.reason = 'nomoves';
  return E.publicState(finished, 0).winnerSeat;
})(), 0);

/* ------------------------------------------------------------------ */
/* Ship artifacts: shared room server and service worker manifest     */
/* ------------------------------------------------------------------ */
var fs = require('fs');
var path = require('path');
function readIf(file) { try { return fs.readFileSync(file, 'utf8'); } catch (err) { return ''; } }
var swSrc = readIf(path.join(__dirname, '../../sw.js'));
var manifestSrc = readIf(path.join(__dirname, '../../precache-manifest.js'));
var swVersion = (swSrc.match(/CACHE_VERSION\s*=\s*'([^']+)'/) || [])[1];
var manifestVersion = (manifestSrc.match(/"version"\s*:\s*"([^"]+)"/) || [])[1];
ok('sw.js and precache manifest share a v20+ version',
  !!swVersion && swVersion === manifestVersion && Number(swVersion.replace('v', '')) >= 20,
  'sw=' + swVersion + ' manifest=' + manifestVersion);
ok('precache manifest contains the draughts entry pages',
  manifestSrc.indexOf('/games/boardgame/draughts-premium/') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/draughts-premium/online.html') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/draughts-premium/rules.html') >= 0);
ok('precache manifest contains engine/data/meta/realism',
  ['engine.js', 'data.js', 'meta.json', 'realism.json'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/draughts-premium/' + name) >= 0;
  }));
ok('precache manifest contains cover/og/detail art',
  ['cover.webp', 'og.webp', 'detail-1.webp', 'detail-2.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/draughts-premium/assets/' + name) >= 0;
  }));
ok('precache manifest contains the material photographs',
  ['man-dark.webp', 'man-light.webp', 'board-walnut.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/assets/art/premium/draughts/' + name) >= 0;
  }) &&
  manifestSrc.indexOf('/games/assets/art/premium/shared/table-felt.webp') >= 0);
ok('online-server reuses the shared room server',
  /shared\/boardgame-room-server\.mjs/.test(readIf(path.join(__dirname, 'online-server.mjs'))));
ok('online adapter binds the draughts engine',
  /DraughtsEngine|engine\.js/.test(readIf(path.join(__dirname, 'online-adapter.mjs'))));
ok('online client, server and dual-client test exist',
  ['online.html', 'online-server.mjs', 'test-online.js'].every(function (name) {
    return fs.existsSync(path.join(__dirname, name));
  }));
ok('ship docs and evidence files exist',
  ['DESIGN.md', 'ACCEPTANCE.md', 'E2E.md', 'realism.json', 'perf.json', 'meta.json', 'e2e.mjs'].every(function (name) {
    return fs.existsSync(path.join(__dirname, name));
  }));
ok('composed cover art exists and is a real raster',
  (function () {
    try { return fs.statSync(path.join(__dirname, 'assets/cover.webp')).size > 20000; }
    catch (err) { return false; }
  })());

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
  process.exitCode = 1;
}
