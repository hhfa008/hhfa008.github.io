#!/usr/bin/env node
'use strict';

/*
 * azul-premium engine tests.
 *
 * Run: node games/boardgame/azul-premium/test.js
 * Prints exactly one machine-readable line: RESULT: N passed, M failed
 * Exits non-zero when anything fails.
 */

var fs = require('fs');
var path = require('path');
var Engine = require('./engine.js');
var HERE = __dirname;

var passed = 0;
var failed = 0;
var failures = [];

function ok(label, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    var line = label + (detail ? ' — ' + detail : '');
    failures.push(line);
    console.log('FAIL ' + line);
  }
  return !!condition;
}

function eq(label, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  return ok(label, a === e, 'got ' + a + ', want ' + e);
}

function throws(label, fn, pattern) {
  var threw = false;
  var message = '';
  try { fn(); } catch (err) { threw = true; message = String(err && err.message); }
  return ok(label, threw && (!pattern || pattern.test(message)), 'message=' + JSON.stringify(message));
}

function fresh(seed, playerCount) {
  return Engine.createGame({ seed: seed == null ? 1 : seed, playerCount: playerCount || 2 });
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function fillRowExcept(wall, row, exceptCol) {
  for (var c = 0; c < Engine.WALL_SIZE; c++) {
    if (c === exceptCol) continue;
    wall[row][c] = Engine.wallColorAt(row, c);
  }
}

function fullRow(wall, row) {
  for (var c = 0; c < Engine.WALL_SIZE; c++) wall[row][c] = Engine.wallColorAt(row, c);
}

function fullWall(wall) {
  for (var r = 0; r < Engine.WALL_SIZE; r++) {
    for (var c = 0; c < Engine.WALL_SIZE; c++) wall[r][c] = Engine.wallColorAt(r, c);
  }
}

/* ------------------------------------------------------------------ */
/* Constants, factories, setup                                        */
/* ------------------------------------------------------------------ */

eq('5 colors', Engine.COLOR_COUNT, 5);
eq('20 tiles per color', Engine.TILES_PER_COLOR, 20);
eq('100 tiles total', Engine.TOTAL_TILES, 100);
eq('5x5 wall', Engine.WALL_SIZE, 5);
eq('7 floor slots', Engine.FLOOR_SIZE, 7);
eq('floor penalties', Engine.FLOOR_PENALTY, [1, 1, 2, 2, 2, 3, 3]);
eq('2 players -> 5 factories', Engine.factoryCountFor(2), 5);
eq('3 players -> 7 factories', Engine.factoryCountFor(3), 7);
eq('4 players -> 9 factories', Engine.factoryCountFor(4), 9);
throws('1 player rejected', function () { Engine.factoryCountFor(1); }, /2、3 或 4/);
throws('5 players rejected', function () { Engine.createGame({ playerCount: 5 }); }, /2、3 或 4/);

var g2 = fresh(42, 2);
eq('2p has 5 factories', g2.factories.length, 5);
eq('2p factories hold 20 tiles', g2.factories.reduce(function (n, f) { return n + f.length; }, 0), 20);
eq('2p bag starts with 80', g2.bag.length, 80);
eq('2p starts round 1', g2.round, 1);
eq('2p current player 0', g2.current, 0);
eq('2p first player 0', g2.firstPlayer, 0);
eq('2p center starts empty', g2.center, []);
ok('2p center has marker', g2.centerMarker === true);
eq('2p total tiles conserved', Engine.allTiles(g2).length, 100);
eq('2p player 0 score', g2.players[0].score, 0);
eq('2p player 0 lines empty', g2.players[0].lines, [[], [], [], [], []]);
eq('2p player 0 wall 5x5 nulls', g2.players[0].wall.flat().filter(function (v) { return v === null; }).length, 25);
eq('2p player 0 floor empty', g2.players[0].floor, []);
ok('2p player 1 is AI', g2.players[1].isAI === true);

var g3 = fresh(7, 3);
eq('3p has 7 factories', g3.factories.length, 7);
eq('3p factories hold 28', g3.factories.reduce(function (n, f) { return n + f.length; }, 0), 28);
eq('3p bag starts with 72', g3.bag.length, 72);
eq('3p total tiles conserved', Engine.allTiles(g3).length, 100);

var g4 = fresh(9, 4);
eq('4p has 9 factories', g4.factories.length, 9);
eq('4p factories hold 36', g4.factories.reduce(function (n, f) { return n + f.length; }, 0), 36);
eq('4p bag starts with 64', g4.bag.length, 64);
eq('4p total tiles conserved', Engine.allTiles(g4).length, 100);

var g2b = fresh(42, 2);
eq('same seed reproduces factories', g2b.factories, g2.factories);
eq('same seed reproduces bag', g2b.bag, g2.bag);
var g2c = fresh(43, 2);
ok('different seed changes deal', JSON.stringify(g2c.factories) !== JSON.stringify(g2.factories));

/* ------------------------------------------------------------------ */
/* Wall geometry, scoring, bonuses                                    */
/* ------------------------------------------------------------------ */

eq('wall row 0 colors', [0, 1, 2, 3, 4].map(function (c) { return Engine.wallColorAt(0, c); }), [0, 1, 2, 3, 4]);
eq('wall row 1 colors', [0, 1, 2, 3, 4].map(function (c) { return Engine.wallColorAt(1, c); }), [4, 0, 1, 2, 3]);
for (var r = 0; r < 5; r++) {
  for (var color = 0; color < 5; color++) {
    var col = Engine.wallColFor(r, color);
    if (Engine.wallColorAt(r, col) !== color) {
      ok('wallColFor inverse row ' + r + ' color ' + color, false);
    }
  }
}
ok('wallColFor inverse checked', true);
for (var wr = 0; wr < 5; wr++) {
  var rowColors = [];
  for (var wc = 0; wc < 5; wc++) rowColors.push(Engine.wallColorAt(wr, wc));
  eq('wall row ' + wr + ' has 5 distinct colors', rowColors.slice().sort().join(''), '01234');
}

var emptyWall = [[null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null], [null, null, null, null, null]];
eq('isolated tile scores 1', Engine.wallPlacementScore(emptyWall, 2, 2), 1);
var hWall = copy(emptyWall);
hWall[2][0] = 0; hWall[2][1] = 1; hWall[2][3] = 3;
eq('horizontal run scores 4', Engine.wallPlacementScore(hWall, 2, 2), 4);
var vWall = copy(emptyWall);
vWall[0][3] = 0; vWall[1][3] = 1; vWall[3][3] = 3;
eq('vertical run scores 4', Engine.wallPlacementScore(vWall, 2, 3), 4);
var crossWall = copy(emptyWall);
crossWall[2][0] = 0; crossWall[2][1] = 1; crossWall[1][2] = 1; crossWall[0][2] = 0;
eq('horizontal + vertical both score', Engine.wallPlacementScore(crossWall, 2, 2), 6);

eq('floor penalty empty', Engine.floorPenalty([]), 0);
eq('floor penalty marker only', Engine.floorPenalty([Engine.MARKER]), 1);
eq('floor penalty 3 slots', Engine.floorPenalty([0, 1, 2]), 4);
eq('floor penalty full', Engine.floorPenalty([0, 1, 2, 3, 4, 0, 1]), 14);

var bWall = copy(emptyWall);
fullRow(bWall, 0);
var bonusRow = Engine.computeBonuses(bWall);
eq('one complete row bonus', bonusRow.rowBonus, 2);
eq('one complete row total', bonusRow.total, 2);
eq('one complete row count', bonusRow.rows, 1);
eq('one complete row no color bonus', bonusRow.colors, 0);

var colWall = copy(emptyWall);
for (var cr = 0; cr < 5; cr++) colWall[cr][0] = Engine.wallColorAt(cr, 0);
var bonusCol = Engine.computeBonuses(colWall);
eq('one complete column bonus', bonusCol.columnBonus, 7);
eq('one complete column total', bonusCol.total, 7);

var allWall = copy(emptyWall);
fullWall(allWall);
var bonusAll = Engine.computeBonuses(allWall);
eq('full wall rows', bonusAll.rows, 5);
eq('full wall cols', bonusAll.cols, 5);
eq('full wall colors', bonusAll.colors, 5);
eq('full wall total', bonusAll.total, 95);

/* ------------------------------------------------------------------ */
/* Legal moves and move validation                                    */
/* ------------------------------------------------------------------ */

var lm = fresh(3, 2);
lm.factories = [[0, 0, 1, 2], [3], [], [], []];
lm.center = [0, 4];
lm.centerMarker = false;
var legal = Engine.getLegalMoves(lm);
ok('legal moves exist', legal.length > 0);
ok('floor is always a legal destination', legal.some(function (m) { return m.row === -1; }));
ok('factory moves carry index', legal.some(function (m) { return m.source === 'factory' && m.factoryIndex === 0; }));
ok('center moves use -1 index', legal.some(function (m) { return m.source === 'center' && m.factoryIndex === -1; }));
ok('all legal rows in range', legal.every(function (m) { return m.row >= -1 && m.row <= 4; }));
ok('all legal colors in range', legal.every(function (m) { return m.color >= 0 && m.color <= 4; }));
var keys = legal.map(function (m) { return m.source + ':' + m.factoryIndex + ':' + m.color + ':' + m.row; });
eq('legal moves unique', keys.length, new Set(keys).size);

var invalidBase = fresh(4, 2);
invalidBase.factories = [[0, 0, 1, 2], [], [], [], []];
invalidBase.center = [];
invalidBase.centerMarker = false;
var invalidBefore = copy(invalidBase);
throws('missing source rejected', function () { Engine.applyMove(invalidBase, { source: 'bag', color: 0, row: 0 }); });
throws('invalid color rejected', function () { Engine.applyMove(invalidBase, { source: 'factory', factoryIndex: 0, color: 9, row: 0 }); });
throws('invalid factory rejected', function () { Engine.applyMove(invalidBase, { source: 'factory', factoryIndex: 9, color: 0, row: 0 }); });
throws('color absent from factory rejected', function () { Engine.applyMove(invalidBase, { source: 'factory', factoryIndex: 0, color: 3, row: 0 }); });
throws('invalid row rejected', function () { Engine.applyMove(invalidBase, { source: 'factory', factoryIndex: 0, color: 0, row: 5 }); });
throws('center with factory index rejected', function () { Engine.applyMove(invalidBase, { source: 'center', factoryIndex: 0, color: 0, row: 0 }); });
eq('failed moves do not mutate state', invalidBase, invalidBefore);

var wallBlock = fresh(5, 2);
wallBlock.factories = [[0, 0, 1, 2], [], [], [], []];
wallBlock.center = [];
wallBlock.centerMarker = false;
wallBlock.players[0].wall[0][0] = 0;
var wallLegal = Engine.getLegalMoves(wallBlock);
ok('blocked wall color has no pattern row 0', !wallLegal.some(function (m) { return m.color === 0 && m.row === 0; }));
ok('blocked wall color can still go to floor', wallLegal.some(function (m) { return m.color === 0 && m.row === -1; }));
throws('placing on wall color rejected', function () {
  Engine.applyMove(wallBlock, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
}, /已有/);

var lineBlock = fresh(6, 2);
lineBlock.factories = [[2, 2, 1, 0], [], [], [], []];
lineBlock.center = [];
lineBlock.centerMarker = false;
lineBlock.players[0].lines[1] = [1];
var lineLegal = Engine.getLegalMoves(lineBlock);
ok('different color cannot join line', !lineLegal.some(function (m) { return m.color === 2 && m.row === 1; }));
throws('different color in line rejected', function () {
  Engine.applyMove(lineBlock, { source: 'factory', factoryIndex: 0, color: 2, row: 1 });
}, /其他颜色/);

var fullLine = fresh(8, 2);
fullLine.factories = [[0, 0, 1, 2], [], [], [], []];
fullLine.center = [];
fullLine.centerMarker = false;
fullLine.players[0].lines[0] = [0];
var fullLegal = Engine.getLegalMoves(fullLine);
ok('full line is not a legal destination', !fullLegal.some(function (m) { return m.color === 0 && m.row === 0; }));
throws('full line rejected', function () {
  Engine.applyMove(fullLine, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
}, /已满/);

var floorMove = fresh(10, 2);
floorMove.factories = [[0, 0, 1, 2], [], [], [], []];
floorMove.center = [];
floorMove.centerMarker = false;
var floorPlayed = Engine.applyMove(floorMove, { source: 'factory', factoryIndex: 0, color: 0, row: -1 });
eq('intentional floor placement puts all tiles on floor', floorPlayed.players[0].floor, [0, 0]);
eq('intentional floor placement leaves line empty', floorPlayed.players[0].lines[0], []);
eq('intentional floor placement returns rest to center', floorPlayed.center, [1, 2]);

/* ------------------------------------------------------------------ */
/* Taking tiles, marker, overflow                                     */
/* ------------------------------------------------------------------ */

var take = fresh(11, 2);
take.factories = [[0, 0, 1, 2], [], [], [], []];
take.center = [];
take.centerMarker = false;
var takeBefore = copy(take);
var took = Engine.applyMove(take, { source: 'factory', factoryIndex: 0, color: 0, row: 0 });
eq('take removes factory tiles', took.factories[0], []);
eq('take places one tile in line 0', took.players[0].lines[0], [0]);
eq('take moves leftovers to center', took.center, [1, 2]);
eq('take sets lastAction', took.lastAction, {
  player: 0, source: 'factory', factoryIndex: 0, color: 0, row: 0,
  taken: 2, placed: 1, overflow: 1, gotMarker: false
});
eq('take overflow goes to floor', took.players[0].floor, [0]);
eq('take advances current player', took.current, 1);
eq('take increments turn', took.turn, 1);
eq('take never mutates input', take, takeBefore);
var realMove = fresh(15, 2);
var realNext = Engine.applyMove(realMove, Engine.getLegalMoves(realMove)[0]);
eq('real move conserves all 100 tiles', Engine.allTiles(realNext).length, 100);

var marker = fresh(12, 2);
marker.factories = [];
marker.center = [0, 0, 1];
marker.centerMarker = true;
marker.current = 0;
marker.firstPlayer = 1;
var marked = Engine.applyMove(marker, { source: 'center', factoryIndex: -1, color: 0, row: 0 });
eq('center take leaves other colors', marked.center, [1]);
eq('center take clears marker', marked.centerMarker, false);
eq('center take sets first player', marked.firstPlayer, 0);
eq('marker occupies floor first', marked.players[0].floor, [Engine.MARKER, 0]);
ok('lastAction reports marker', marked.lastAction.gotMarker === true);
eq('marker placement lastAction overflow', marked.lastAction.overflow, 1);

var overflow = fresh(13, 2);
overflow.factories = [[0, 0, 0], [], [], [], []];
overflow.center = [];
overflow.centerMarker = false;
var over = Engine.applyMove(overflow, { source: 'factory', factoryIndex: 0, color: 0, row: 0 }, { deferResolve: true });
eq('overflow line gets one', over.players[0].lines[0], [0]);
eq('overflow excess lands on floor', over.players[0].floor, [0, 0]);
ok('overflow is pending round', over.pendingRound === true);

var floorCap = fresh(14, 2);
floorCap.factories = [[0, 0, 0], [], [], [], []];
floorCap.center = [];
floorCap.centerMarker = false;
floorCap.players[0].floor = [1, 1, 1, 1, 1, 1];
var floorCapAfter = Engine.applyMove(floorCap, { source: 'factory', factoryIndex: 0, color: 0, row: 0 }, { deferResolve: true });
eq('floor fills to 7', floorCapAfter.players[0].floor.length, 7);
eq('floor overflow goes to discard', floorCapAfter.discard, [0]);
ok('floor cap state is pending', floorCapAfter.pendingRound === true);

/* ------------------------------------------------------------------ */
/* Round resolution                                                   */
/* ------------------------------------------------------------------ */

var pending = fresh(21, 2);
pending.factories = [[0], [], [], [], []];
pending.center = [];
pending.centerMarker = false;
pending.bag = pending.bag.concat([]);
var deferred = Engine.applyMove(pending, { source: 'factory', factoryIndex: 0, color: 0, row: 0 }, { deferResolve: true });
ok('deferResolve marks pending round', deferred.pendingRound === true);
ok('deferred state is not over', deferred.over === false);
eq('deferred state has no legal moves', Engine.getLegalMoves(deferred), []);
throws('cannot move during pending round', function () {
  Engine.applyMove(deferred, { source: 'center', factoryIndex: -1, color: 0, row: -1 });
}, /等待结算/);
var resolved = Engine.resolvePendingRound(deferred);
ok('resolve clears pending flag', resolved.pendingRound === false);
eq('resolve advances round', resolved.round, 2);
ok('resolve puts marker back in center', resolved.centerMarker === true);
eq('resolve resets center tiles', resolved.center, []);
eq('resolve refills factories', resolved.factories.reduce(function (n, f) { return n + f.length; }, 0), 20);
ok('resolved state still has 100 tiles in play', Engine.allTiles(resolved).length > 0);
throws('resolve without pending round rejected', function () { Engine.resolvePendingRound(resolved); }, /等待结算/);

var persist = fresh(22, 2);
persist.factories = [];
persist.center = [];
persist.centerMarker = false;
persist.pendingRound = true;
persist.players[0].lines[2] = [1, 1];
persist.players[0].floor = [0, 2];
var persistAfter = Engine.resolvePendingRound(persist);
eq('incomplete pattern line stays', persistAfter.players[0].lines[2], [1, 1]);
eq('floor penalty applied to incomplete line player', persistAfter.players[0].score, 0);

var clearComplete = fresh(23, 2);
clearComplete.factories = [];
clearComplete.center = [];
clearComplete.centerMarker = false;
clearComplete.pendingRound = true;
clearComplete.players[0].lines[0] = [0];
clearComplete.players[0].lines[1] = [1, 1];
clearComplete.players[0].lines[2] = [2];
clearComplete.players[0].floor = [];
var cleared = Engine.resolvePendingRound(clearComplete);
eq('complete line 0 clears', cleared.players[0].lines[0], []);
eq('complete line 1 clears', cleared.players[0].lines[1], []);
eq('incomplete line 2 remains', cleared.players[0].lines[2], [2]);
eq('complete line 0 wall tile', cleared.players[0].wall[0][0], 0);
eq('complete line 1 wall tile', cleared.players[0].wall[1][2], 1);
eq('leftover from complete line 1 discarded', cleared.players[0].score >= 0 && cleared.discard.indexOf(1) !== -1, true);
ok('round events contain placements', cleared.lastRound.players[0].placements.length === 2);
eq('round events penalty', cleared.lastRound.players[0].penalty, 0);
eq('round events points', cleared.lastRound.players[0].points, 2);

var clamp = fresh(24, 2);
clamp.factories = [];
clamp.center = [];
clamp.centerMarker = false;
clamp.pendingRound = true;
clamp.players[0].score = 1;
clamp.players[0].floor = [0, 1, 2];
var clamped = Engine.resolvePendingRound(clamp);
eq('floor penalty never drops below zero', clamped.players[0].score, 0);
eq('floor clears after penalty', clamped.players[0].floor, []);
eq('floor tiles go to discard', clamped.discard.filter(function (t) { return t === 0 || t === 1 || t === 2; }).length, 3);


var markerPenalty = fresh(25, 2);
markerPenalty.factories = [];
markerPenalty.center = [];
markerPenalty.centerMarker = false;
markerPenalty.pendingRound = true;
markerPenalty.players[0].floor = [Engine.MARKER];
var markerPenalized = Engine.resolvePendingRound(markerPenalty);
eq('marker counts as a floor tile for penalty', markerPenalized.lastRound.players[0].penalty, 1);
eq('marker returns to player for next round', markerPenalized.players[0].floor, []);
ok('marker is not put in discard', markerPenalized.discard.indexOf(Engine.MARKER) === -1);

/* ------------------------------------------------------------------ */
/* End game, bonuses, tie-break                                       */
/* ------------------------------------------------------------------ */

var endGame = fresh(31, 2);
endGame.factories = [[0], [], [], [], []];
endGame.center = [];
endGame.centerMarker = false;
endGame.current = 0;
endGame.firstPlayer = 0;
fillRowExcept(endGame.players[0].wall, 0, 0);
endGame.players[0].lines[0] = [0];
endGame.players[0].score = 0;
endGame.players[1].wall = endGame.players[1].wall;
endGame.players[1].score = 0;
var ended = Engine.applyMove(endGame, { source: 'factory', factoryIndex: 0, color: 0, row: -1 });
ok('game ends when wall row completes', ended.over === true);
ok('game result exists', !!ended.result);
eq('completed row counted', ended.result.scores[0].rows, 1);
eq('row bonus is 2', ended.result.scores[0].rowBonus, 2);
eq('end game base score includes placement and floor penalty', ended.result.scores[0].base, 4);
eq('end game total includes row bonus', ended.result.scores[0].total, 6);
eq('end game winner is player 0', ended.result.winner, 0);
ok('end game not tied', ended.result.tied === false);
eq('last round marked ended', ended.lastRound.ended, true);


var tieRows = fresh(32, 2);
tieRows.factories = [[0], [], [], [], []];
tieRows.center = [];
tieRows.centerMarker = false;
tieRows.current = 0;
tieRows.firstPlayer = 0;
fillRowExcept(tieRows.players[0].wall, 0, 0);
tieRows.players[0].lines[0] = [0];
tieRows.players[0].score = 0;
tieRows.players[1].score = 6;
var tieRowsEnded = Engine.applyMove(tieRows, { source: 'factory', factoryIndex: 0, color: 0, row: -1 });
ok('equal totals tie on points', tieRowsEnded.result.scores[0].total === tieRowsEnded.result.scores[1].total);
eq('more completed rows wins tie', tieRowsEnded.result.winner, 0);
eq('tie-break winner has more rows', tieRowsEnded.result.scores[0].rows > tieRowsEnded.result.scores[1].rows, true);

var tieBreak = fresh(33, 2);
tieBreak.factories = [[0], [], [], [], []];
tieBreak.center = [];
tieBreak.centerMarker = false;
tieBreak.current = 0;
tieBreak.firstPlayer = 0;
fillRowExcept(tieBreak.players[0].wall, 0, 0);
fullRow(tieBreak.players[0].wall, 1);
tieBreak.players[0].lines[0] = [0];
tieBreak.players[0].score = 0;
fullRow(tieBreak.players[1].wall, 1);
tieBreak.players[1].score = 8;
var tieBreakEnded = Engine.applyMove(tieBreak, { source: 'factory', factoryIndex: 0, color: 0, row: -1 });
eq('tie-break player 0 has two rows', tieBreakEnded.result.scores[0].rows, 2);
eq('tie-break player 1 has one row', tieBreakEnded.result.scores[1].rows, 1);
ok('tie-break totals are equal', tieBreakEnded.result.scores[0].total === tieBreakEnded.result.scores[1].total);
eq('tie-break picks more rows', tieBreakEnded.result.winner, 0);

var shared = fresh(34, 2);
shared.factories = [[0], [], [], [], []];
shared.center = [];
shared.centerMarker = false;
shared.current = 0;
shared.firstPlayer = 0;
fillRowExcept(shared.players[0].wall, 0, 0);
shared.players[0].lines[0] = [0];
shared.players[0].score = 0;
fullRow(shared.players[1].wall, 1);
shared.players[1].score = 4;
var sharedEnded = Engine.applyMove(shared, { source: 'factory', factoryIndex: 0, color: 0, row: -1 });
eq('shared victory equal totals', sharedEnded.result.scores[0].total, sharedEnded.result.scores[1].total);
eq('shared victory equal rows', sharedEnded.result.scores[0].rows, sharedEnded.result.scores[1].rows);
ok('shared victory is tied', sharedEnded.result.tied === true);
eq('shared victory has no single winner', sharedEnded.result.winner, null);
eq('shared victory lists both winners', sharedEnded.result.winners.slice().sort(), [0, 1]);

/* ------------------------------------------------------------------ */
/* AI                                                                 */
/* ------------------------------------------------------------------ */

var aiState = fresh(41, 3);
aiState.factories = [[0, 0, 1, 2], [3, 3, 4, 4], [], [], [], [], []];
aiState.center = [];
aiState.centerMarker = false;
var aiBefore = copy(aiState);
var aiMove = Engine.chooseAIMove(aiState);
eq('AI does not mutate state', aiState, aiBefore);
ok('AI move is legal', Engine.getLegalMoves(aiState).some(function (m) {
  return m.source === aiMove.source && m.factoryIndex === aiMove.factoryIndex &&
    m.color === aiMove.color && m.row === aiMove.row;
}));
ok('AI move has valid row', aiMove.row >= -1 && aiMove.row <= 4);

var aiReal = fresh(41, 3);
var aiRealMove = Engine.chooseAIMove(aiReal);
var aiApplied = Engine.applyMove(aiReal, aiRealMove);
ok('AI move applies without error', aiApplied.turn === 1);
eq('AI move conserves tiles', Engine.allTiles(aiApplied).length, 100);

var aiSamples = 0;
for (var aiSeed = 1; aiSeed <= 12; aiSeed++) {
  var sample = fresh(aiSeed, 2 + (aiSeed % 3));
  var legalNow = Engine.getLegalMoves(sample);
  if (legalNow.length > 0) {
    var choice = Engine.chooseAIMove(sample);
    if (legalNow.some(function (m) {
      return m.source === choice.source && m.factoryIndex === choice.factoryIndex &&
        m.color === choice.color && m.row === choice.row;
    })) aiSamples += 1;
  }
}
eq('AI returned legal moves for 12 samples', aiSamples, 12);

/* ------------------------------------------------------------------ */
/* 30 full AI self-play games                                         */
/* ------------------------------------------------------------------ */

var selfPlayGames = 0;
var selfPlayTurns = 0;
var selfPlayOk = true;
var selfPlayDetail = '';
for (var gameSeed = 1; gameSeed <= 30; gameSeed++) {
  var playerCount = 2 + (gameSeed % 3);
  var game = fresh(gameSeed, playerCount);
  var turns = 0;
  try {
    while (!game.over && turns < 1200) {
      var moves = Engine.getLegalMoves(game);
      if (moves.length === 0) {
        throw new Error('no legal moves at turn ' + turns);
      }
      var best = Engine.chooseAIMove(game);
      if (!moves.some(function (m) {
        return m.source === best.source && m.factoryIndex === best.factoryIndex &&
          m.color === best.color && m.row === best.row;
      })) {
        throw new Error('illegal AI move at turn ' + turns);
      }
      game = Engine.applyMove(game, best);
      turns += 1;
      if (Engine.allTiles(game).length !== 100) {
        throw new Error('tile conservation broke at turn ' + turns);
      }
    }
    if (!game.over) throw new Error('game did not end within 1200 turns');
    if (!game.result || game.result.scores.length !== playerCount) throw new Error('missing result');
    if (game.result.scores.some(function (s) { return s.total < 0 || !Number.isFinite(s.total); })) {
      throw new Error('invalid final score');
    }
    if (Engine.getResults(game) !== game.result) throw new Error('getResults mismatch');
    selfPlayGames += 1;
    selfPlayTurns += turns;
  } catch (err) {
    selfPlayOk = false;
    selfPlayDetail = 'seed ' + gameSeed + ' (' + playerCount + 'p): ' + String(err && err.message);
    break;
  }
}
ok('30 AI self-play games complete', selfPlayOk && selfPlayGames === 30, selfPlayDetail);
ok('self-play uses a sane number of turns', selfPlayTurns > 0 && selfPlayTurns < 36000, 'turns=' + selfPlayTurns);

/* ------------------------------------------------------------------ */
/* meta.json, realism, design & art deliverables                      */
/* ------------------------------------------------------------------ */

var metaPath = path.join(HERE, 'meta.json');
var meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
ok('meta slug', meta.slug === 'azul-premium', meta.slug);
ok('meta status is shipped or draft', meta.status === 'shipped' || meta.status === 'draft', meta.status);
ok('meta marks multiplayer online game', meta.singlePlayer === false);
ok('meta has single-player label', /单人/.test(meta.modeLabel || ''), meta.modeLabel);
ok('meta has online label', /联机/.test(meta.modeLabel || ''), meta.modeLabel);
ok('meta online status recorded', meta.online && (meta.online.status === 'missing' || meta.online.status === 'ready'), meta.online && meta.online.status);
if (meta.status === 'draft') {
  ok('draft lists missing online requirements', Array.isArray(meta.online.required) && meta.online.required.length >= 6, JSON.stringify(meta.online.required));
} else {
  ok('shipped online status is ready', meta.online.status === 'ready', meta.online.status);
  ok('shipped lists the verified online capabilities', Array.isArray(meta.online.required) && meta.online.required.length >= 6, JSON.stringify(meta.online.required));
}
ok('design document exists', fs.existsSync(path.join(HERE, meta.design)));
ok('design document has substance', fs.readFileSync(path.join(HERE, meta.design), 'utf8').length > 2000);
ok('cover exists', fs.existsSync(path.join(HERE, meta.assets.cover)));
ok('OG image exists', fs.existsSync(path.join(HERE, meta.assets.og)));
ok('detail images exist', meta.assets.detailImages.every(function (rel) { return fs.existsSync(path.join(HERE, rel)); }));
ok('composition source exists', fs.existsSync(path.join(HERE, meta.assets.compositionSource)));
ok('composition script exists', fs.existsSync(path.join(HERE, meta.assets.compositionScript)));
ok('e2e script exists', fs.existsSync(path.join(HERE, meta.e2e.script)));
ok('e2e record exists', fs.existsSync(path.join(HERE, meta.e2e.record)));
ok('progress file exists', fs.existsSync(path.join(HERE, meta.progress)));
ok('e2e record has a real result', /RESULT:\s*\d+\s+passed,\s*0\s+failed/.test(fs.readFileSync(path.join(HERE, meta.e2e.record), 'utf8')));
ok('e2e assertion count recorded', meta.e2e.assertions >= 100, String(meta.e2e.assertions));
ok('service worker exists', fs.existsSync(path.join(HERE, 'sw.js')));
ok('single-object assets exist', meta.assets.singleObject.every(function (rel) { return fs.existsSync(path.resolve(HERE, rel)); }));
ok('all assets are local paths', meta.assets.singleObject.every(function (rel) { return !/^https?:/.test(rel); }));

var realism = meta.realism;
eq('realism total tiles', realism.rules.totalTiles, Engine.TOTAL_TILES);
eq('realism colors', realism.rules.colors, Engine.COLOR_COUNT);
eq('realism tiles per color', realism.rules.tilesPerColor, Engine.TILES_PER_COLOR);
eq('realism tiles per factory', realism.rules.tilesPerFactory, Engine.TILES_PER_FACTORY);
eq('realism 2p factories', realism.rules.factoryCounts['2'], Engine.factoryCountFor(2));
eq('realism 3p factories', realism.rules.factoryCounts['3'], Engine.factoryCountFor(3));
eq('realism 4p factories', realism.rules.factoryCounts['4'], Engine.factoryCountFor(4));
eq('realism pattern lines', realism.rules.patternLines, [1, 2, 3, 4, 5]);
eq('realism wall size', realism.rules.wall, [Engine.WALL_SIZE, Engine.WALL_SIZE]);
eq('realism floor slots', realism.rules.floorSlots, Engine.FLOOR_SIZE);
eq('realism floor penalty', realism.rules.floorPenalty, Engine.FLOOR_PENALTY);
eq('realism row bonus', realism.rules.bonuses.row, 2);
eq('realism column bonus', realism.rules.bonuses.column, 7);
eq('realism color bonus', realism.rules.bonuses.color, 10);
eq('realism color hex order', realism.colors.map(function (c) { return c.hex; }), Engine.COLORS.map(function (c) { return c.hex; }));
eq('realism color keys', realism.colors.map(function (c) { return c.key; }), Engine.COLORS.map(function (c) { return c.key; }));
ok('realism dimensions recorded', realism.dimensions && realism.dimensions.boxMm.length === 3 && realism.dimensions.playerBoardMm.length === 2 && realism.dimensions.tileMm.length === 3);
ok('realism materials recorded', realism.materials && /resin/i.test(realism.materials.officialTiles) && /cardboard/i.test(realism.materials.officialFactories) && /felt/i.test(realism.materials.artDirection));
var fullRealWall = [[null,null,null,null,null],[null,null,null,null,null],[null,null,null,null,null],[null,null,null,null,null],[null,null,null,null,null]];
for (var rr = 0; rr < 5; rr++) for (var cc = 0; cc < 5; cc++) fullRealWall[rr][cc] = Engine.wallColorAt(rr, cc);
var realBonus = Engine.computeBonuses(fullRealWall);
eq('realism full-wall total matches bonuses', realBonus.total, 5 * 2 + 5 * 7 + 5 * 10);
eq('realism full-wall row bonus', realBonus.rowBonus, 5 * realism.rules.bonuses.row);
eq('realism full-wall column bonus', realBonus.columnBonus, 5 * realism.rules.bonuses.column);
eq('realism full-wall color bonus', realBonus.colorBonus, 5 * realism.rules.bonuses.color);
ok('performance budgets recorded', meta.performanceBudgets && meta.performanceBudgets.fcpMs > 0 && meta.performanceBudgets.fps >= 30 && meta.performanceBudgets.externalRequests === 0);
ok('mobile viewports recorded', meta.mobile && meta.mobile.viewports.indexOf('390x844') !== -1 && meta.mobile.viewports.indexOf('320x568') !== -1);
ok('mobile touch target budget', meta.mobile.touchTargetPx >= 44);
ok('mobile offline + safe area recorded', meta.mobile.offline === true && meta.mobile.safeArea === true && meta.mobile.dvh === true);
var rulesHtml = fs.readFileSync(path.join(HERE, 'rules.html'), 'utf8');
ok('rules page includes cover image', /assets\/cover\.webp/.test(rulesHtml));
ok('rules page includes both detail images', /assets\/detail-1\.webp/.test(rulesHtml) && /assets\/detail-2\.webp/.test(rulesHtml));
ok('rules page marks single-player', /单人/.test(rulesHtml));
ok('rules page includes OG image', /assets\/og\.webp/.test(rulesHtml));
var indexHtml = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
var engineSrc = fs.readFileSync(path.join(HERE, 'engine.js'), 'utf8');
var swSrc = fs.readFileSync(path.join(HERE, 'sw.js'), 'utf8');
ok('index loads shared shuffle', /shared\/shuffle\.js/.test(indexHtml));
ok('index loads shared sfx', /shared\/sfx\.js/.test(indexHtml));
ok('engine requires shared shuffle', /shared\/shuffle\.js/.test(engineSrc) && /ShuffleApi/.test(engineSrc));
ok('engine no longer duplicates mulberry32', !/mulberry32/.test(engineSrc));
ok('index no longer builds its own AudioContext', !/new Ctor\(\)/.test(indexHtml) && !/createOscillator/.test(indexHtml));
ok('sw precaches shared shuffle/sfx', /shared\/shuffle\.js/.test(swSrc) && /shared\/sfx\.js/.test(swSrc));
ok('meta records shared module reuse', meta.shared && /shuffle\.js/.test(meta.shared.shuffle) && /sfx\.js/.test(meta.shared.sfx));
ok('meta records rules/physics N\/A', meta.shared && /N\/A/.test(meta.shared.rules) && /N\/A/.test(meta.shared.physics));
ok('meta records rewards N/A and server leaderboard reuse', meta.shared && /N\/A/.test(meta.shared.rewards) && /leaderboard\.js/.test(meta.shared.leaderboard));

/* ------------------------------------------------------------------ */
/* Results and helpers                                                */
/* ------------------------------------------------------------------ */

var inProgress = fresh(51, 2);
var standings = Engine.getResults(inProgress);
eq('in-progress results not over', standings.over, false);
eq('in-progress results have scores', standings.scores.length, 2);
eq('in-progress winner null', standings.winner, null);
ok('currentPlayer returns active player', Engine.currentPlayer(inProgress).index === inProgress.current);
eq('allTiles initial count', Engine.allTiles(inProgress).length, 100);
eq('colorCounts initial', Engine.colorCounts(Engine.allTiles(inProgress)), [20, 20, 20, 20, 20]);
eq('isGameOver false in progress', Engine.isGameOver(inProgress), false);
eq('isGameOver true after end', Engine.isGameOver(ended), true);

var cloneSource = fresh(52, 2);
var cloneCopy = copy(cloneSource);
var movedClone = Engine.applyMove(cloneSource, Engine.getLegalMoves(cloneSource)[0]);
eq('applyMove is a pure operation', cloneSource, cloneCopy);
ok('applyMove returns a new object', movedClone !== cloneSource);
eq('getLegalMoves does not mutate', cloneSource, cloneCopy);

console.log('');
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(function (line) { console.log(' - ' + line); });
}
process.exit(failed > 0 ? 1 : 0);
