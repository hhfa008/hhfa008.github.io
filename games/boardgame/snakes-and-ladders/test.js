'use strict';

/*
 * Snakes and Ladders — standalone engine tests.
 * Run with: node test.js
 */

var E = require('./engine.js');

var passed = 0;
var failed = 0;
var failures = [];

function ok(name, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name + (detail === undefined ? '' : ' — ' + detail));
  }
}

function eq(name, actual, expected) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  ok(name, a === b, 'expected ' + b + ', got ' + a);
}

function throws(name, fn) {
  var threw = false;
  try { fn(); } catch (err) { threw = true; }
  ok(name, !threw, 'unexpected exception');
}

function validState(st) {
  return !!st && Array.isArray(st.positions) && st.positions.length === 2 &&
    st.positions.every(function (p) { return Number.isInteger(p) && p >= 1 && p <= 100; }) &&
    (st.turn === 1 || st.turn === 2) &&
    (st.winner === 0 || st.winner === 1 || st.winner === 2) &&
    Number.isInteger(st.rolls) && st.rolls >= 0;
}

function stateAt(position, turn) {
  var st = E.setup(12345);
  var player = turn || 1;
  st.positions[player - 1] = position;
  st.turn = player;
  return st;
}

// ---------------------------------------------------------------------------
// Board and fixed mappings
// ---------------------------------------------------------------------------
eq('BOARD_SIZE is 100', E.BOARD_SIZE, 100);
ok('engine exposes the required API', ['setup', 'rollDice', 'applyRoll', 'moveFrom', 'aiRoll', 'status', 'winner']
  .every(function (key) { return typeof E[key] === 'function'; }));
ok('at least five ladders', Object.keys(E.LADDERS).length >= 5);
ok('at least five snakes', Object.keys(E.SNAKES).length >= 5);

var mappingsValid = true;
var mappingProblems = [];
Object.keys(E.LADDERS).forEach(function (key) {
  var from = Number(key);
  var to = E.LADDERS[key];
  if (!Number.isInteger(from) || !Number.isInteger(to)) mappingProblems.push('non-integer ladder');
  if (from < 2 || from > 99 || to < 2 || to > 99) mappingProblems.push('ladder endpoint outside 2..99');
  if (to <= from) mappingProblems.push('ladder does not climb: ' + from + ' -> ' + to);
});
Object.keys(E.SNAKES).forEach(function (key) {
  var from = Number(key);
  var to = E.SNAKES[key];
  if (!Number.isInteger(from) || !Number.isInteger(to)) mappingProblems.push('non-integer snake');
  if (from < 2 || from > 99 || to < 2 || to > 99) mappingProblems.push('snake endpoint outside 2..99');
  if (to >= from) mappingProblems.push('snake does not descend: ' + from + ' -> ' + to);
});
ok('every ladder climbs and every snake descends', mappingProblems.length === 0, mappingProblems.join('; '));

var ladderStarts = Object.keys(E.LADDERS).map(Number);
var snakeStarts = Object.keys(E.SNAKES).map(Number);
var allStarts = ladderStarts.concat(snakeStarts);
var noDuplicateStarts = allStarts.every(function (v, i) { return allStarts.indexOf(v) === i; });
ok('no square is both a ladder foot and a snake head', noDuplicateStarts);

var endpointsInBounds = Object.keys(E.LADDERS).every(function (k) {
  return E.LADDERS[k] >= 2 && E.LADDERS[k] <= 99;
}) && Object.keys(E.SNAKES).every(function (k) {
  return E.SNAKES[k] >= 2 && E.SNAKES[k] <= 99;
});
ok('no link points at square 1 or 100', endpointsInBounds);

// ---------------------------------------------------------------------------
// Setup and immutable state
// ---------------------------------------------------------------------------
var initial = E.setup(2026);
eq('initial positions are both 1', initial.positions, [1, 1]);
eq('player 1 starts', initial.turn, 1);
eq('no winner at setup', E.winner(initial), 0);
ok('setup stores the seed', initial.seed === 2026);
ok('status reports an unfinished game', E.status(initial).over === false);
eq('status copies positions', E.status(initial).positions, [1, 1]);
ok('default setup still receives a numeric seed', Number.isInteger(E.setup().seed));

var normal = E.applyRoll(initial, 4);
ok('normal roll returns a new state', normal !== false && normal !== initial);
eq('1 + 4 lands on 5', normal.positions[0], 5);
eq('turn passes to player 2', normal.turn, 2);
eq('input positions are unchanged', initial.positions, [1, 1]);
eq('input history is unchanged', initial.history.length, 0);
eq('new state has one history entry', normal.history.length, 1);
eq('history records the dice', normal.last.dice, 4);
eq('history records the origin', normal.last.from, 1);
eq('history records the destination', normal.last.to, 5);
eq('a normal move has no transit', normal.last.transit, null);

var normal2 = E.applyRoll(normal, 2);
eq('player 2 can roll next', normal2.positions[1], 3);
eq('turn returns to player 1', normal2.turn, 1);
eq('roll counter increments', normal2.rolls, 2);

// ---------------------------------------------------------------------------
// Ladders, snakes, overshoot and victory
// ---------------------------------------------------------------------------
eq('ladder foot 2 climbs to 23', E.moveFrom(1, 1), 23);
eq('ladder foot 80 climbs to 99', E.moveFrom(79, 1), 99);
eq('snake head 36 slides to 6', E.moveFrom(32, 4), 6);
eq('snake head 98 slides to 40', E.moveFrom(97, 1), 40);
eq('snake head 17 slides to 7', E.moveFrom(12, 5), 7);

var ladderState = E.applyRoll(stateAt(1), 1);
eq('applyRoll triggers the ladder at 2', ladderState.positions[0], 23);
eq('ladder transit is recorded', ladderState.last.transit, 'ladder');
eq('ladder pre-transit square is recorded', ladderState.last.landed, 2);

var snakeState = E.applyRoll(stateAt(32), 4);
eq('applyRoll triggers the snake at 36', snakeState.positions[0], 6);
eq('snake transit is recorded', snakeState.last.transit, 'snake');
eq('snake pre-transit square is recorded', snakeState.last.landed, 36);

eq('overshoot from 97 with a 5 stays on 97', E.moveFrom(97, 5), 97);
eq('overshoot from 99 with a 6 stays on 99', E.moveFrom(99, 6), 99);
var overshootState = E.applyRoll(stateAt(97), 5);
eq('applyRoll keeps an overshooting token in place', overshootState.positions[0], 97);
eq('overshoot is recorded', overshootState.last.overshoot, true);
eq('overshoot passes the turn', overshootState.turn, 2);
eq('98 is a snake head, not a winning square', E.moveFrom(97, 1), 40);

eq('exactly 100 wins the move', E.moveFrom(96, 4), 100);
var winState = E.applyRoll(stateAt(96), 4);
eq('player 1 reaches 100', winState.positions[0], 100);
eq('winner is player 1', E.winner(winState), 1);
eq('status says the game is over', E.status(winState).over, true);
eq('status names the winner', E.status(winState).winner, 1);
eq('a winning roll keeps the winner on turn', winState.turn, 1);
ok('no further rolls are accepted after a win', E.applyRoll(winState, 1) === false);

var p2WinState = E.applyRoll(stateAt(96, 2), 4);
eq('player 2 can win as well', E.winner(p2WinState), 2);
eq('player 2 reaches 100', p2WinState.positions[1], 100);
eq('player 1 position survives a player 2 win', p2WinState.positions[0], 1);

// ---------------------------------------------------------------------------
// Invalid input
// ---------------------------------------------------------------------------
var badDice = [0, 7, -1, 1.5, '3', null, undefined, NaN, Infinity];
var rejected = badDice.every(function (dice) {
  var result;
  throws('invalid dice ' + String(dice) + ' does not throw', function () {
    result = E.applyRoll(initial, dice);
  });
  return result === false;
});
ok('invalid dice values are rejected without throwing', rejected);
ok('moveFrom rejects dice 0', E.moveFrom(10, 0) === false);
ok('moveFrom rejects dice 7', E.moveFrom(10, 7) === false);
ok('moveFrom rejects non-integer dice', E.moveFrom(10, 2.5) === false);
ok('moveFrom rejects an off-board position', E.moveFrom(0, 3) === false && E.moveFrom(101, 3) === false);
ok('applyRoll rejects a malformed state', E.applyRoll(null, 3) === false && E.applyRoll({}, 3) === false);
ok('status rejects a malformed state', E.status(null) === false);
eq('winner of a malformed state is 0', E.winner(null), 0);

// ---------------------------------------------------------------------------
// Dice and seeded RNG
// ---------------------------------------------------------------------------
var rngA = E.mulberry32(42);
var rngB = E.mulberry32(42);
var seqA = [];
var seqB = [];
var diceInRange = true;
for (var i = 0; i < 50; i += 1) {
  var a = E.rollDice(rngA);
  var b = E.rollDice(rngB);
  seqA.push(a);
  seqB.push(b);
  if (!Number.isInteger(a) || a < 1 || a > 6) diceInRange = false;
}
ok('rollDice always returns 1..6', diceInRange);
eq('the same seed reproduces the same dice sequence', seqA, seqB);
ok('different seeds usually differ', E.rollDice(E.mulberry32(1)) !== E.rollDice(E.mulberry32(2)));
eq('rollDice maps rng 0 to 1', E.rollDice(function () { return 0; }), 1);
eq('rollDice maps rng .999 to 6', E.rollDice(function () { return 0.999999; }), 6);
ok('rollDice handles a throwing rng without throwing', E.rollDice(function () { throw new Error('boom'); }) === false);

// ---------------------------------------------------------------------------
// AI turns and deterministic self-play
// ---------------------------------------------------------------------------
var aiRng = E.mulberry32(77);
var aiState = E.setup(77);
var aiLegal = true;
for (var j = 0; j < 40; j += 1) {
  var nextAi = E.aiRoll(aiState, aiRng);
  if (!validState(nextAi) || !E.status(nextAi).positions.every(function (p) { return p >= 1 && p <= 100; })) {
    aiLegal = false;
    break;
  }
  aiState = nextAi;
  if (E.status(aiState).over) break;
}
ok('40 sequential AI turns stay legal', aiLegal);
ok('AI state remains valid', validState(aiState));

function aiSequence(seed, count) {
  var st = E.setup(seed);
  var rng = E.mulberry32(seed);
  var out = [];
  for (var k = 0; k < count; k += 1) {
    st = E.aiRoll(st, rng);
    if (!st) break;
    out.push(st.last.dice);
    if (E.status(st).over) break;
  }
  return out;
}
eq('seeded AI turns are reproducible', aiSequence(909, 12), aiSequence(909, 12));
ok('no-argument aiRoll is deterministic for a given state', E.aiRoll(E.setup(55)).last.dice === E.aiRoll(E.setup(55)).last.dice);

// 30 full AI-vs-AI games. If this loops forever, the suite should fail rather
// than hang; the cap also proves the engine has no pathological cycle.
var allGamesEnded = true;
var allActionsLegal = true;
var maxTurns = 0;
var totalTurns = 0;
for (var g = 0; g < 30; g += 1) {
  var seed = 5000 + g;
  var st = E.setup(seed);
  var rng = E.mulberry32(seed);
  var turns = 0;
  while (!E.status(st).over && turns < 4000) {
    var before = st;
    var after = E.aiRoll(st, rng);
    if (!after || !validState(after)) {
      allActionsLegal = false;
      break;
    }
    var rec = after.last;
    if (!rec || rec.n !== before.rolls + 1 || rec.dice < 1 || rec.dice > 6) {
      allActionsLegal = false;
      break;
    }
    if (after.positions.some(function (p) { return p < 1 || p > 100; })) {
      allActionsLegal = false;
      break;
    }
    if (E.moveFrom(rec.from, rec.dice) !== rec.to) {
      allActionsLegal = false;
      break;
    }
    if (!rec.overshoot && rec.to !== rec.landed && rec.transit === null) {
      allActionsLegal = false;
      break;
    }
    st = after;
    turns += 1;
  }
  if (!E.status(st).over) allGamesEnded = false;
  maxTurns = Math.max(maxTurns, turns);
  totalTurns += turns;
}
ok('30 AI-vs-AI games all finish within 4000 turns', allGamesEnded, 'max turns: ' + maxTurns);
ok('all self-play actions are legal', allActionsLegal);
ok('self-play games end with a real winner', allGamesEnded && [1, 2].indexOf(E.winner(st)) !== -1);
ok('self-play does not exceed the turn cap', maxTurns <= 4000, 'max turns: ' + maxTurns);
ok('self-play average turn count is reasonable', totalTurns / 30 < 4000);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (failed) {
  console.error('\nFailures:');
  failures.forEach(function (name) { console.error(' - ' + name); });
  process.exitCode = 1;
}
console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
