#!/usr/bin/env node
'use strict';

/*
 * Xiangqi Premium engine tests.
 *   node games/boardgame/xiangqi-premium/test.js
 * Prints one machine-readable line: RESULT: N passed, M failed
 */

var Engine = require('./engine.js');

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
function empty() { return new Array(90).fill(null); }
function move(from, to) { return Engine.encode(from, to); }
function cloneBoard(b) { return b.slice(); }

/* ------------------------------------------------------------------ */
/* Opening position                                                    */
/* ------------------------------------------------------------------ */
var b0 = Engine.initialBoard();
eq('90 intersections', Engine.SIZE, 90);
eq('32 pieces', b0.filter(Boolean).length, 32);
eq('16 red pieces', b0.filter(function (p) { return p && Engine.sideOfPiece(p) === Engine.RED; }).length, 16);
eq('16 black pieces', b0.filter(function (p) { return p && Engine.sideOfPiece(p) === Engine.BLACK; }).length, 16);
eq('red king at 85', Engine.kingSquare(b0, Engine.RED), 85);
eq('black king at 4', Engine.kingSquare(b0, Engine.BLACK), 4);
eq('red opens with 44 legal moves', Engine.legalMoves(b0, Engine.RED).length, 44);
eq('black also opens with 44 legal moves', Engine.legalMoves(b0, Engine.BLACK).length, 44);
ok('opening not in check', !Engine.inCheck(b0, Engine.RED) && !Engine.inCheck(b0, Engine.BLACK));
eq('piece cases map to sides', [Engine.sideOfPiece('R'), Engine.sideOfPiece('r')], [1, -1]);
eq('type ignores case', [Engine.typeOfPiece('n'), Engine.typeOfPiece('N')], ['N', 'N']);
eq('char table red general', Engine.CHAR.K, '帅');
eq('char table black general', Engine.CHAR.k, '将');
eq('draw rule is 120 plies', Engine.DRAW_PLIES, 120);
eq('repetition limit is 3', Engine.REPETITION_LIMIT, 3);

/* ------------------------------------------------------------------ */
/* Piece movement rules                                                */
/* ------------------------------------------------------------------ */
var t = empty();
t[40] = 'C';
t[13] = 'r';
t[22] = 'P';
var cannonTos = Engine.pseudoMovesFrom(t, 40).map(Engine.moveTo);
ok('cannon captures over exactly one screen', cannonTos.indexOf(13) >= 0);
ok('cannon cannot land on its screen', cannonTos.indexOf(22) < 0);
ok('cannon may move to empty squares', cannonTos.indexOf(31) >= 0);
t = empty(); t[40] = 'C'; t[13] = 'r';
ok('cannon cannot capture with no screen', Engine.pseudoMovesFrom(t, 40).map(Engine.moveTo).indexOf(13) < 0);

t = empty(); t[40] = 'N';
eq('horse on empty board has 8 moves', Engine.pseudoMovesFrom(t, 40).length, 8);
t[49] = 'P';
eq('blocked horse leg leaves 6 moves', Engine.pseudoMovesFrom(t, 40).length, 6);
eq('the two blocked destinations are gone', Engine.pseudoMovesFrom(t, 40).map(Engine.moveTo).filter(function (s) { return s === 57 || s === 59; }), []);

t = empty(); t[83] = 'B';
eq('red elephant starts with two moves', Engine.pseudoMovesFrom(t, 83).map(Engine.moveTo).sort(), [63, 67]);
t[73] = 'P';
eq('blocked elephant eye leaves one move', Engine.pseudoMovesFrom(t, 83).map(Engine.moveTo), [67]);
t = empty(); t[45] = 'B';
eq('elephant cannot cross the river', Engine.pseudoMovesFrom(t, 45).map(Engine.moveTo).filter(function (s) { return Engine.rowOf(s) < 5; }), []);

t = empty(); t[76] = 'A';
eq('advisor in the palace centre has four moves', Engine.pseudoMovesFrom(t, 76).map(Engine.moveTo).sort(), [66, 68, 84, 86]);
t = empty(); t[85] = 'K';
eq('king at the bottom centre has three palace moves', Engine.pseudoMovesFrom(t, 85).map(Engine.moveTo).sort(), [76, 84, 86]);

t = empty(); t[60] = 'P';
ok('red pawn moves forward before the river', Engine.pseudoMovesFrom(t, 60).map(Engine.moveTo).indexOf(51) >= 0);
eq('red pawn has no sideways move before river', Engine.pseudoMovesFrom(t, 60).length, 1);
t = empty(); t[30] = 'P';
eq('crossed pawn moves forward and sideways', Engine.pseudoMovesFrom(t, 30).map(Engine.moveTo).sort(), [21, 29, 31]);
t = empty(); t[4] = 'p';
eq('black pawn forward is +1 row', Engine.pseudoMovesFrom(t, 4).map(Engine.moveTo), [13]);

/* Flying general: kings may not face each other on an open file. */
t = empty(); t[85] = 'K'; t[4] = 'k';
ok('flying general attacks along the file', Engine.isAttacked(t, 85, Engine.BLACK));
t[40] = 'P';
ok('a screen blocks flying general', !Engine.isAttacked(t, 85, Engine.BLACK));

/* ------------------------------------------------------------------ */
/* Legal move filtering, check and mate                                */
/* ------------------------------------------------------------------ */
var pin = empty();
pin[85] = 'K'; pin[4] = 'k'; pin[76] = 'R'; pin[13] = 'r';
var pinnedMoves = Engine.legalMoves(pin, Engine.RED).map(Engine.moveTo);
ok('pinned rook may not leave the file', pinnedMoves.indexOf(75) < 0);

var mate = empty();
mate[85] = 'K'; mate[4] = 'k'; mate[12] = 'R'; mate[13] = 'R'; mate[14] = 'R';
eq('mate position has no legal moves', Engine.legalMoves(mate, Engine.BLACK).length, 0);
ok('mate position is in check', Engine.inCheck(mate, Engine.BLACK));
var st = Engine.gameStatus(mate, Engine.BLACK);
eq('gameStatus reports checkmate', [st.over, st.checkmate, st.winner], [true, true, Engine.RED]);

/* ------------------------------------------------------------------ */
/* State transitions and notation                                      */
/* ------------------------------------------------------------------ */
var game = Engine.createGame();
eq('new game red to move', game.turn, Engine.RED);
eq('new game move 1', game.moveNo, 1);
eq('new game shares 32 pieces', game.board.filter(Boolean).length, 32);
eq('new game halfmove clock 0', game.halfmove, 0);
ok('new game repetition key recorded', Object.keys(game.repetition).length === 1);

var redCannon = move(64, 63);
eq('cannon notation 炮8平9', Engine.moveToChinese(game.board, redCannon), '红炮8平9');
var next = Engine.applyMove(game, redCannon);
eq('turn flips to black', next.turn, Engine.BLACK);
eq('move number stays 1 after red move', next.moveNo, 1);
eq('history has one entry', next.history.length, 1);
eq('history notation stored', next.history[0].notation, '红炮8平9');
eq('original state untouched', game.board[64], 'C');
eq('new state moved the piece', [next.board[64], next.board[63]], [null, 'C']);
eq('halfmove increments', next.halfmove, 1);

var blackPawn = move(29, 38);
eq('black pawn notation 卒3进1', Engine.moveToChinese(next.board, blackPawn), '黑卒3进1');
var next2 = Engine.applyMove(next, blackPawn);
eq('move number becomes 2 after black move', next2.moveNo, 2);
eq('black pawn advanced', [next2.board[29], next2.board[38]], [null, 'p']);

var horse = move(82, 63);
eq('horse notation 马8进9', Engine.moveToChinese(game.board, horse), '红马8进9');

throws('illegal empty start is rejected', function () { Engine.applyMove(game, move(40, 41)); }, /没有棋子/);
throws('moving opponent piece is rejected', function () { Engine.applyMove(game, move(0, 9)); }, /还没轮到/);
throws('illegal geometry is rejected', function () { Engine.applyMove(game, move(81, 60)); }, /不符合规则/);
throws('moves after game over are rejected', function () {
  var done = Engine.createGame();
  done.over = true;
  Engine.applyMove(done, redCannon);
}, /已结束/);

var captureState = Engine.createGame();
captureState.board = empty();
captureState.board[85] = 'K';
captureState.board[3] = 'k';
captureState.board[40] = 'R';
captureState.board[31] = 'p';
captureState.turn = Engine.RED;
var cap = Engine.applyMove(captureState, move(40, 31));
eq('capture lands on the square', cap.board[31], 'R');
eq('captured piece recorded', cap.captures.black, ['p']);
eq('capture resets halfmove clock', cap.halfmove, 0);

/* Draw by the 60-move (120-ply) no-capture rule. */
var drawState = Engine.createGame();
drawState.board = empty();
drawState.board[85] = 'K';
drawState.board[3] = 'k';
drawState.board[40] = 'R';
drawState.turn = Engine.RED;
drawState.halfmove = 119;
var drawn = Engine.applyMove(drawState, move(40, 41));
eq('120 quiet plies end in a draw', [drawn.over, drawn.winner, drawn.reason], [true, 0, 'draw60']);

/* Threefold repetition draw. */
var rep = Engine.createGame();
rep.board = empty();
rep.board[85] = 'K';
rep.board[3] = 'k';
rep.board[40] = 'P';
rep.board[41] = 'R';
rep.turn = Engine.RED;
rep.halfmove = 0;
var cycle = [move(41, 42), move(3, 4), move(42, 41), move(4, 3)];
var r = rep;
for (var round = 0; round < 2; round++) {
  cycle.forEach(function (m) { r = Engine.applyMove(r, m); });
}
eq('two full cycles do not end the game', r.over, false);
r = Engine.applyMove(r, cycle[0]);
eq('third occurrence ends in repetition draw', [r.over, r.reason], [true, 'repetition']);

/* ------------------------------------------------------------------ */
/* Public view, AI and conservation                                    */
/* ------------------------------------------------------------------ */
var pub = Engine.publicState(game, 0);
eq('public view identifies seat 0 as red', [pub.you, pub.yourSide, pub.canMove], [0, Engine.RED, true]);
eq('public view exposes 44 legal moves to red', pub.legal.length, 44);
ok('public legal moves carry notation', pub.legal.every(function (m) { return /^红/.test(m.notation); }));
var pubBlack = Engine.publicState(next, 1);
eq('seat 1 is black and can move on black turn', [pubBlack.you, pubBlack.yourSide, pubBlack.canMove], [1, Engine.BLACK, true]);

for (var level = 1; level <= 3; level++) {
  var aiState = Engine.createGame();
  var aiM = Engine.aiMove(aiState, level, 120);
  ok('AI level ' + level + ' returns a legal move',
    aiM != null && Engine.legalMovesFor(aiState).indexOf(aiM) >= 0);
}

var sim = Engine.createGame();
var plies = 0;
while (!sim.over && plies < 24) {
  var m = Engine.aiMove(sim, 1, 60);
  if (m == null) break;
  sim = Engine.applyMove(sim, m);
  plies += 1;
  var onBoard = sim.board.filter(Boolean).length;
  var captured = sim.captures.red.length + sim.captures.black.length;
  if (onBoard + captured !== 32) {
    ok('piece conservation at ply ' + plies, false, onBoard + '+' + captured);
    break;
  }
}
ok('24-ply AI self-play conserved all 32 pieces',
  sim.board.filter(Boolean).length + sim.captures.red.length + sim.captures.black.length === 32);
ok('self-play made progress', sim.history.length >= 10, 'history=' + sim.history.length);
ok('every history move has notation', sim.history.every(function (h) { return h.notation.length >= 4; }));

var keysBefore = Object.keys(game.repetition).length;
var afterOne = Engine.applyMove(game, redCannon);
eq('repetition table grows after a new position', Object.keys(afterOne.repetition).length, keysBefore + 1);

/* Captured pieces mirror the opponent's colour. */
var capBoard = empty();
capBoard[85] = 'K'; capBoard[3] = 'k'; capBoard[40] = 'R'; capBoard[31] = 'n';
var capGame = Engine.createGame();
capGame.board = capBoard;
capGame.turn = Engine.RED;
var capNext = Engine.applyMove(capGame, move(40, 31));
eq('black horse lands in red captures', capNext.captures.black, ['n']);
eq('history records the capture', capNext.history[0].captured, 'n');

/* ------------------------------------------------------------------ */
/* Ship artifacts: shared room server, service worker manifest        */
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
ok('precache manifest contains the xiangqi entry pages',
  manifestSrc.indexOf('/games/boardgame/xiangqi-premium/') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/xiangqi-premium/online.html') >= 0 &&
  manifestSrc.indexOf('/games/boardgame/xiangqi-premium/rules.html') >= 0);
ok('precache manifest contains engine/data/meta',
  ['engine.js', 'data.js', 'meta.json', 'realism.json'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/xiangqi-premium/' + name) >= 0;
  }));
ok('precache manifest contains cover/og/detail art',
  ['cover.webp', 'og.webp', 'detail-1.webp', 'detail-2.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/boardgame/xiangqi-premium/assets/' + name) >= 0;
  }));
ok('precache manifest contains the three material photographs',
  ['piece-wood.webp', 'board-wood.webp', 'table-walnut.webp'].every(function (name) {
    return manifestSrc.indexOf('/games/assets/art/premium/xiangqi/' + name) >= 0;
  }));
ok('online-server reuses the shared room server',
  /boardgame-room-server\.mjs/.test(readIf(path.join(__dirname, 'online-server.mjs'))) &&
  /shared\/boardgame-room-server\.mjs/.test(readIf(path.join(__dirname, 'online-server.mjs'))));
ok('online adapter binds the xiangqi engine',
  /XiangqiEngine|engine\.js/.test(readIf(path.join(__dirname, 'online-adapter.mjs'))));
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
