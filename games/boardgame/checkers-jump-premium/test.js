#!/usr/bin/env node
'use strict';

/* Chinese Checkers premium engine tests.
   node games/boardgame/checkers-jump-premium/test.js
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
  return ok(label, thrown(threw, pattern, message), 'message=' + JSON.stringify(message));
}
function thrown(threw, pattern, message) { return threw && (!pattern || pattern.test(message)); }
function marbles(s) { return Array.from(s.board).filter(function (x) { return x >= 0; }).length; }

/* ------------------------------------------------------------------ */
/* Star board                                                          */
/* ------------------------------------------------------------------ */
eq('121 holes', E.holeCount, 121);
eq('six zones', E.ZONES.length, 6);
eq('ten holes per zone', E.ZONES.map(function (z) { return z.length; }), [10, 10, 10, 10, 10, 10]);
ok('adjacency is symmetric', E.NEI.every(function (ns, i) {
  return ns.every(function (j) { return E.NEI[j].indexOf(i) >= 0; });
}));
ok('every hole has at least one neighbour', E.NEI.every(function (ns) { return ns.length > 0; }));
eq('each hole has at most six neighbours', Math.max.apply(null, E.NEI.map(function (n) { return n.length; })), 6);
var allZones = {};
E.ZONES.forEach(function (z) { z.forEach(function (h) { allZones[h] = (allZones[h] || 0) + 1; }); });
eq('zones are disjoint', Object.keys(allZones).filter(function (h) { return allZones[h] > 1; }).length, 0);
eq('total zone holes', Object.keys(allZones).length, 60);
eq('centre hole belongs to no zone', E.ZONES.every(function (z) { return z.indexOf(60) < 0; }), true);

/* ------------------------------------------------------------------ */
/* Setups and turn order                                               */
/* ------------------------------------------------------------------ */
var s2 = E.setup(2);
eq('two-player marbles', marbles(s2), 20);
eq('two-player active zones', s2.active, [0, 3]);
eq('two-player targets are opposite', [E.targetZone(s2, 0), E.targetZone(s2, 3)], [3, 0]);
eq('two-player opening moves', E.legalMoves(s2, 0).length, 14);
eq('player 0 starts in zone 0', E.ZONES[0].every(function (h) { return s2.board[h] === 0; }), true);
eq('player 3 starts in zone 3', E.ZONES[3].every(function (h) { return s2.board[h] === 3; }), true);
eq('unused zones are empty', [1, 2, 4, 5].every(function (z) {
  return E.ZONES[z].every(function (h) { return s2.board[h] === -1; });
}), true);

var s3 = E.setup(3);
eq('three-player marbles', marbles(s3), 30);
eq('three-player active zones', s3.active, [0, 2, 4]);
eq('three-player targets', s3.active.map(function (p) { return E.targetZone(s3, p); }), [3, 5, 1]);
eq('three-player turn order', [s3.turn, E.nextTurn(s3, 0), E.nextTurn(s3, 2), E.nextTurn(s3, 4)], [0, 2, 4, 0]);

var s4 = E.setup(4);
eq('four-player marbles', marbles(s4), 40);
eq('four-player active zones', s4.active, [0, 1, 3, 4]);
eq('four-player targets', s4.active.map(function (p) { return E.targetZone(s4, p); }), [3, 4, 0, 1]);
eq('four-player turn order', [s4.turn, E.nextTurn(s4, 0), E.nextTurn(s4, 1), E.nextTurn(s4, 3), E.nextTurn(s4, 4)], [0, 1, 3, 4, 0]);

var s6 = E.setup(6);
eq('six-player marbles', marbles(s6), 60);
eq('six-player active zones', s6.active, [0, 1, 2, 3, 4, 5]);
eq('six-player each player has 10', [0, 1, 2, 3, 4, 5].map(function (p) {
  return Array.from(s6.board).filter(function (x) { return x === p; }).length;
}), [10, 10, 10, 10, 10, 10]);
eq('six-player opening moves', E.legalMoves(s6, 0).length, 14);

/* ------------------------------------------------------------------ */
/* Moves: single steps and chain jumps                                 */
/* ------------------------------------------------------------------ */
var step = E.legalMovesFrom(s2, E.ZONES[0][0])[0];
ok('single step exists from a zone edge', !!step && step.jump === false);
var jump = null, all = [];
for (var h = 0; h < 121; h++) {
  if (s2.board[h] !== 0) continue;
  all = all.concat(E.legalMovesFrom(s2, h));
}
jump = all.filter(function (m) { return m.jump; })[0];
ok('opening contains a jump', !!jump);
ok('jump path has at least two points', jump && jump.path.length >= 2, jump && JSON.stringify(jump.path));
ok('jump lands on an empty hole', jump && s2.board[jump.to] === -1);
ok('applyMove does not mutate the source', (function () {
  var before = Array.from(s2.board).join(',');
  E.applyMove(s2, jump);
  return Array.from(s2.board).join(',') === before;
})());
var after = E.applyMove(s2, jump);
eq('mover lands on the target hole', after.board[jump.to], 0);
eq('origin becomes empty', after.board[jump.from], -1);
eq('turn moves to player 3', after.turn, 3);
eq('move recorded once', after.history.length, 1);
ok('move notation is H-based', /^H\d+[x-]H\d+/.test(after.history[0].notation), after.history[0].notation);
eq('notation uses x for jumps', after.history[0].notation.indexOf('x') >= 0, true);

throws('fabricated move is rejected', function () { E.applyMove(s2, { from: 0, to: 120 }); }, /不符合规则/);
throws('moves after game over are rejected', function () {
  var done = E.setup(2);
  done.over = true;
  E.applyMove(done, E.legalMoves(done, 0)[0]);
}, /已结束/);
eq('empty hole has no moves', E.legalMovesFrom(s2, 60), []);

/* A chain jump is a single move with a longer path. */
var chainState = E.emptyState([0, 1]);
chainState.board[E.KEY['0,0']] = 0;
[['1,0'], ['2,1'], ['1,2'], ['-1,2']].forEach(function (k) { chainState.board[E.KEY[k[0]]] = 1; });
var chain = E.legalMovesFrom(chainState, E.KEY['0,0']);
ok('chain jump reaches the far landing', chain.some(function (m) { return m.path.length >= 5; }),
  JSON.stringify(chain.map(function (m) { return m.path; })));
ok('chain jump is marked as a jump', chain.some(function (m) { return m.jump && m.path.length >= 5; }));

/* ------------------------------------------------------------------ */
/* Winning and public state                                            */
/* ------------------------------------------------------------------ */
var win = E.setup(2);
E.ZONES[3].forEach(function (h) { win.board[h] = 0; });
eq('filling the target zone wins', E.winner(win), 0);
win.over = true;
win.winner = 0;
var pubWin0 = E.publicState(win, 0);
var pubWin1 = E.publicState(win, 1);
eq('winnerSeat for seat 0', pubWin0.winnerSeat, 0);
eq('winnerSeat for seat 1', pubWin1.winnerSeat, 0);
eq('public active list', pubWin0.active, [0, 3]);
eq('progress counts target marbles', E.progress(win, 0), 10);
eq('loser progress is zero', E.progress(win, 3), 0);

var pub = E.publicState(s2, 0);
eq('seat 0 is player 0 and can move', [pub.you, pub.yourPlayer, pub.canMove], [0, 0, true]);
eq('seat 0 sees 14 legal moves', pub.legal.length, 14);
eq('seat 1 waits', E.publicState(s2, 1).canMove, false);
var pub6 = E.publicState(s6, 5);
eq('six-player seat 5 maps to player 5', [pub6.you, pub6.yourPlayer], [5, 5]);

/* ------------------------------------------------------------------ */
/* AI and long-run conservation                                        */
/* ------------------------------------------------------------------ */
[2, 4, 6].forEach(function (count) {
  var st = E.setup(count);
  var m = E.aiMove(st, 2, 200);
  ok('AI returns a legal move for a ' + count + '-player game', !!m && E.findMove(st, m) != null);
});

var sim = E.setup(2);
var plies = 0;
while (!sim.over && plies < 20) {
  var m2 = E.aiMove(sim, 1, 60);
  if (!m2) break;
  sim = E.applyMove(sim, m2);
  plies += 1;
  if (marbles(sim) !== 20) {
    ok('marble conservation at ply ' + plies, false, String(marbles(sim)));
    break;
  }
}
eq('20-ply self-play conserves 20 marbles', marbles(sim), 20);
ok('self-play produced history', sim.history.length >= 10, 'history=' + sim.history.length);
ok('every history move has notation', sim.history.every(function (h) { return /^H\d+[x-]H/.test(h.notation); }));

/* ------------------------------------------------------------------ */
/* Ship artifacts                                                      */
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
ok('precache manifest contains the checkers-jump entry pages',
  manifestSrc.indexOf('/games/boardgame/checkers-jump-premium/') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/checkers-jump-premium/online.html') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/checkers-jump-premium/rules.html') >= 0);
ok('precache manifest contains engine/data/meta/realism',
  ['engine.js', 'data.js', 'meta.json', 'realism.json'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/checkers-jump-premium/' + name) >= 0;
  }));
ok('precache manifest contains cover/og/detail art',
  ['cover.webp', 'og.webp', 'detail-1.webp', 'detail-2.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/checkers-jump-premium/assets/' + name) >= 0;
  }));
ok('precache manifest contains the marble and board materials',
  ['marble-glass.webp', 'board-birch.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/assets/art/premium/checkers-jump/' + name) >= 0;
  }) && manifestSrc.indexOf('/games/assets/art/premium/shared/table-felt.webp') >= 0);
ok('online-server reuses the shared room server',
  /shared\/boardgame-room-server\.mjs/.test(readIf(path.join(__dirname, 'online-server.mjs'))));
ok('online adapter binds the Chinese checkers engine',
  /ChineseCheckersEngine|engine\.js/.test(readIf(path.join(__dirname, 'online-adapter.mjs'))));
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
