'use strict';

// Run from this directory: node test.js
var Engine = require('./engine.js');

var passed = 0;
var failed = 0;

function check(condition, label, detail) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error('FAIL: ' + label + (detail ? ' — ' + detail : ''));
}

function checkEqual(actual, expected, label) {
  check(actual === expected, label,
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function checkDeepEqual(actual, expected, label) {
  check(JSON.stringify(actual) === JSON.stringify(expected), label);
}

function cells(count, r, c, orientation) {
  var result = [];
  for (var i = 0; i < count; i += 1) {
    result.push([r + (orientation === 'v' ? i : 0), c + (orientation === 'h' ? i : 0)]);
  }
  return result;
}

// Deterministic layouts used by the rule tests.
var AI_LAYOUT = [
  cells(5, 0, 0, 'h'),
  cells(4, 1, 0, 'h'),
  cells(3, 2, 0, 'h'),
  cells(3, 3, 0, 'h'),
  cells(2, 4, 0, 'h')
];
var PLAYER_LAYOUT = [
  cells(5, 7, 0, 'h'),
  cells(4, 6, 0, 'h'),
  cells(3, 5, 0, 'h'),
  cells(3, 3, 5, 'h'),
  cells(2, 2, 5, 'h')
];

function fleetFrom(layout) {
  return layout.map(function (shipCells, index) {
    var spec = Engine.SHIP_SPECS[index];
    return {
      id: 'test-ship-' + (index + 1),
      name: spec.name,
      length: spec.length,
      orientation: shipCells[0][0] === shipCells[1][0] ? 'h' : 'v',
      cells: shipCells.map(function (cell) { return [cell[0], cell[1]]; })
    };
  });
}

function playingState() {
  var state = Engine.createGame(20261110);
  var placedPlayer = Engine.setFleet(state, 'player', fleetFrom(PLAYER_LAYOUT));
  if (!placedPlayer.ok) throw new Error('playingState player fleet: ' + placedPlayer.error);
  var placedAi = Engine.setFleet(placedPlayer.state, 'ai', fleetFrom(AI_LAYOUT));
  if (!placedAi.ok) throw new Error('playingState ai fleet: ' + placedAi.error);
  var started = Engine.startGame(placedAi.state);
  if (!started.ok) throw new Error('playingState start: ' + started.error);
  return started.state;
}

function shipCellList(fleet) {
  var list = [];
  fleet.forEach(function (ship) {
    ship.cells.forEach(function (cell) { list.push(cell); });
  });
  return list;
}

function flatMisses() {
  var list = [];
  var r;
  for (r = 0; r < 8; r += 1) {
    for (var c = 0; c < 8; c += 1) list.push([r, c]);
  }
  return list.filter(function (cell) {
    return !PLAYER_LAYOUT.some(function (ship) {
      return ship.some(function (part) { return part[0] === cell[0] && part[1] === cell[1]; });
    });
  });
}

// 1. createGame shape and setup state.
(function () {
  var game = Engine.createGame(1);
  checkEqual(game.seed, 1, 'createGame keeps numeric seed');
  checkEqual(game.player.fleet.length, 0, 'createGame starts with an empty player fleet');
  checkEqual(game.ai.fleet.length, 5, 'createGame creates five AI ships');
  checkEqual(Engine.status(game), 'setup', 'createGame status is setup');
  checkEqual(Engine.winner(game), null, 'createGame has no winner');
  checkEqual(game.turn, 'player', 'createGame starts on the player setup turn');
})();

// 2. randomFleet always returns the five required ship lengths and valid geometry.
(function () {
  var fleet = Engine.randomFleet(Engine.createRng(1234));
  checkDeepEqual(fleet.map(function (ship) { return ship.length; }), [5, 4, 3, 3, 2],
    'randomFleet uses lengths 5,4,3,3,2');
  check(Engine.validateFleet(fleet).ok, 'randomFleet produces a valid non-overlapping fleet');
  check(fleet.every(function (ship) {
    return ship.cells.every(function (cell) {
      return cell[0] >= 0 && cell[0] < 8 && cell[1] >= 0 && cell[1] < 8;
    });
  }), 'randomFleet keeps every cell in bounds');
  var another = Engine.randomFleet(Engine.createRng(98765));
  check(Engine.validateFleet(another).ok, 'a second randomFleet is valid');
  check(JSON.stringify(fleet) !== JSON.stringify(another), 'different seeds produce different fleets');
})();

// 3. Seeded reproducibility.
(function () {
  var fleetA = Engine.randomFleet(Engine.createRng(777));
  var fleetB = Engine.randomFleet(Engine.createRng(777));
  checkDeepEqual(fleetA, fleetB, 'randomFleet is reproducible for the same seed');
  var gameA = Engine.createGame(777);
  var gameB = Engine.createGame(777);
  checkDeepEqual(gameA.ai.fleet, gameB.ai.fleet, 'createGame AI fleet is reproducible for the same seed');
  check(JSON.stringify(Engine.createGame(778).ai.fleet) !== JSON.stringify(gameA.ai.fleet),
    'createGame changes the AI fleet for a different seed');

  var probeA = Engine.cloneState(playingState());
  var probeB = Engine.cloneState(playingState());
  probeA.turn = 'ai';
  probeB.turn = 'ai';
  checkDeepEqual(Engine.aiTarget(probeA, Engine.createRng(55)),
    Engine.aiTarget(probeB, Engine.createRng(55)), 'aiTarget is reproducible for the same seed');
})();

// 4. canPlace geometry, overlap, bounds and both orientations.
(function () {
  check(Engine.canPlace([], 5, 0, 0, 'h'), 'canPlace accepts a free horizontal ship');
  check(Engine.canPlace([], 5, 0, 0, 'v'), 'canPlace accepts a free vertical ship');
  check(!Engine.canPlace([], 5, 0, 4, 'h'), 'canPlace rejects horizontal out-of-bounds');
  check(!Engine.canPlace([], 5, 4, 0, 'v'), 'canPlace rejects vertical out-of-bounds');
  var oneShip = [{ id: 'x', name: '潜艇', length: 2, cells: cells(2, 0, 0, 'h') }];
  check(!Engine.canPlace(oneShip, 2, 0, 1, 'h'), 'canPlace rejects overlap');
  check(Engine.canPlace(oneShip, 2, 1, 0, 'h'), 'canPlace accepts a non-overlapping row below');
  var game = Engine.createGame(4);
  check(Engine.canPlace(game, 'player', 5, 0, 0, 'h'), 'canPlace overload accepts a state and side');
})();

// 5. placeShip clones state, caps duplicate lengths and reports errors.
(function () {
  var game = Engine.createGame(5);
  var placed = Engine.placeShip(game, 'player', 5, 0, 0, 'h');
  check(placed.ok, 'placeShip places the first ship');
  checkEqual(game.player.fleet.length, 0, 'placeShip does not mutate the original state');
  checkEqual(placed.state.player.fleet.length, 1, 'placeShip returns a copied state with the ship');
  var duplicate = Engine.placeShip(placed.state, 'player', 5, 2, 0, 'h');
  check(!duplicate.ok, 'placeShip rejects a second ship of a unique length');
  checkEqual(duplicate.error, 'SHIP_ALREADY_PLACED', 'duplicate ship has a clear error code');
  var overlap = Engine.placeShip(placed.state, 'player', 4, 0, 0, 'h');
  check(!overlap.ok, 'placeShip rejects overlap');
  checkEqual(overlap.error, 'OVERLAP', 'overlap has a clear error code');
  var outOfBounds = Engine.placeShip(placed.state, 'player', 4, 7, 7, 'h');
  check(!outOfBounds.ok, 'placeShip rejects out-of-bounds');
  checkEqual(outOfBounds.error, 'OUT_OF_BOUNDS', 'out-of-bounds has a clear error code');
  var badOrientation = Engine.placeShip(placed.state, 'player', 3, 2, 0, 'diagonal');
  check(!badOrientation.ok, 'placeShip rejects an unknown orientation');
})();

// 6. startGame requires complete fleets and switches to playing.
(function () {
  var incomplete = Engine.createGame(6);
  var rejected = Engine.startGame(incomplete);
  check(!rejected.ok, 'startGame rejects an incomplete fleet');
  checkEqual(rejected.error, 'PLAYER_FLEET_SHIP_COUNT_MISMATCH', 'startGame reports the incomplete fleet');

  var complete = Engine.setFleet(Engine.createGame(6), 'player', fleetFrom(PLAYER_LAYOUT));
  check(complete.ok, 'setFleet accepts a valid player fleet');
  var started = Engine.startGame(complete.state);
  check(started.ok, 'startGame accepts two complete fleets');
  checkEqual(Engine.status(started.state), 'playing', 'started game status is playing');
  checkEqual(started.state.turn, 'player', 'started game gives the player the first shot');
  var latePlacement = Engine.placeShip(started.state, 'player', 2, 0, 7, 'h');
  checkEqual(latePlacement.error, 'NOT_SETUP', 'placeShip rejects placement after the game starts');
})();

// 7. Fire rules: hit, miss, immutability, duplicate, wrong turn and bounds.
(function () {
  var game = playingState();
  var before = JSON.stringify(game.player.shots);
  var hit = Engine.fire(game, 0, 0);
  check(hit.ok, 'player can fire at an unshot cell');
  check(hit.result.hit, 'fire detects a hit');
  checkEqual(hit.state.turn, 'ai', 'a player shot hands the turn to the AI');
  checkEqual(JSON.stringify(game.player.shots), before, 'fire does not mutate the original state');

  var miss = Engine.fire(game, 7, 7);
  check(miss.ok && !miss.result.hit, 'fire detects a miss');

  var wrongTurn = Engine.fire(game, 0, 0, 'ai');
  check(!wrongTurn.ok, 'AI cannot fire during the player turn');
  checkEqual(wrongTurn.error, 'NOT_YOUR_TURN', 'wrong turn has a clear error code');

  var outOfBounds = Engine.fire(game, 8, 0);
  check(!outOfBounds.ok, 'fire rejects r=8');
  checkEqual(outOfBounds.error, 'OUT_OF_BOUNDS', 'fire reports out-of-bounds');

  var notPlaying = Engine.fire(Engine.createGame(7), 0, 0);
  check(!notPlaying.ok, 'fire rejects a setup-state shot');
  checkEqual(notPlaying.error, 'NOT_PLAYING', 'setup shot has a clear error code');

  var aiShot = Engine.fire(hit.state, 0, 7, 'ai');
  check(aiShot.ok && !aiShot.result.hit, 'AI can fire during its turn');
  var repeated = Engine.fire(aiShot.state, 0, 0);
  check(!repeated.ok, 'repeat shot is rejected');
  checkEqual(repeated.error, 'CELL_ALREADY_FIRED', 'repeat shot has a clear error code');
  checkEqual(Engine.status(aiShot.state), 'playing', 'normal shots do not end the game');
})();

// 8. Sink detection and sunk count.
(function () {
  var game = playingState();
  var first = Engine.fire(game, 4, 0);
  check(first.ok && first.result.hit && !first.result.sunk, 'first hit does not sink the two-cell ship');
  var ai = Engine.fire(first.state, 0, 7, 'ai');
  check(ai.ok && !ai.result.hit, 'AI misses while the player is sinking a ship');
  var second = Engine.fire(ai.state, 4, 1);
  check(second.ok && second.result.hit, 'second hit lands on the same ship');
  check(second.result.sunk, 'second hit sinks the two-cell ship');
  checkEqual(second.result.sunkShip, '潜艇', 'sink result names the ship');
  checkEqual(Engine.sunkCount(second.state, 'ai'), 1, 'sunkCount reports one enemy ship sunk');
  checkEqual(Engine.sunkCount(second.state, 'player'), 0, 'sunkCount reports no player losses yet');
})();

// 9. Sinking all five enemy ships produces a player win.
(function () {
  var game = playingState();
  var targets = shipCellList(game.ai.fleet);
  var misses = flatMisses();
  var missIndex = 0;
  var lastResult = null;
  var allAccepted = true;

  targets.forEach(function (target) {
    if (Engine.winner(game)) return;
    var shot = Engine.fire(game, target[0], target[1], 'player');
    if (!shot.ok) {
      allAccepted = false;
      return;
    }
    game = shot.state;
    lastResult = shot.result;
    if (!Engine.winner(game)) {
      var miss = misses[missIndex];
      missIndex += 1;
      var aiShot = Engine.fire(game, miss[0], miss[1], 'ai');
      if (!aiShot.ok) {
        allAccepted = false;
        return;
      }
      game = aiShot.state;
    }
  });

  check(allAccepted, 'every player/AI shot in the full win sequence is legal');
  checkEqual(Engine.winner(game), 'player', 'destroying all enemy ships makes the player win');
  checkEqual(Engine.status(game), 'player-win', 'status reflects the player win');
  checkEqual(game.phase, 'over', 'winning moves the game to over');
  check(Engine.allSunk(game, 'ai'), 'allSunk recognises the destroyed AI fleet');
  check(!Engine.allSunk(game, 'player'), 'allSunk is false for the surviving player fleet');
  check(Engine.allSunk(game), 'allSunk with no side is true once either fleet is gone');
  checkEqual(Engine.sunkCount(game, 'ai'), 5, 'all five enemy ships count as sunk');
  check(lastResult && lastResult.winner === 'player', 'last shot result records the winner');
})();

// 10. AI can also win by sinking all player ships.
(function () {
  var game = playingState();
  var targets = shipCellList(game.player.fleet);
  var misses = flatMisses();
  var missIndex = 0;
  var allAccepted = true;

  targets.forEach(function (target) {
    if (Engine.winner(game)) return;
    var miss = misses[missIndex];
    missIndex += 1;
    var playerShot = Engine.fire(game, miss[0], miss[1], 'player');
    if (!playerShot.ok) {
      allAccepted = false;
      return;
    }
    game = playerShot.state;
    var shot = Engine.fire(game, target[0], target[1], 'ai');
    if (!shot.ok) {
      allAccepted = false;
      return;
    }
    game = shot.state;
  });

  check(allAccepted, 'every shot in the AI win sequence is legal');
  checkEqual(Engine.winner(game), 'ai', 'destroying all player ships makes the AI win');
  checkEqual(Engine.status(game), 'ai-win', 'status reflects the AI win');
  check(Engine.allSunk(game, 'player'), 'allSunk recognises the destroyed player fleet');
  checkEqual(Engine.sunkCount(game, 'player'), 5, 'all five player ships count as sunk');
})();

// 11. AI target hunting: valid, unshot, parity fallback, adjacent after a hit.
(function () {
  checkEqual(Engine.aiTarget(Engine.createGame(11), Engine.createRng(1)), null,
    'aiTarget refuses to fire during setup');

  var probe = Engine.cloneState(playingState());
  probe.turn = 'ai';
  var first = Engine.aiTarget(probe, Engine.createRng(99));
  check(Boolean(first), 'aiTarget returns a target during play');
  check(Number.isInteger(first.r) && first.r >= 0 && first.r < 8 &&
    Number.isInteger(first.c) && first.c >= 0 && first.c < 8,
  'aiTarget returns coordinates inside 0..7');
  checkEqual(probe.ai.shots[first.r][first.c], 0, 'aiTarget returns an unshot cell');
  checkEqual((first.r + first.c) % 2, 0, 'hunt mode starts on the parity grid');

  var hitProbe = Engine.cloneState(playingState());
  hitProbe.turn = 'ai';
  hitProbe.ai.shots[3][3] = Engine.HIT;
  var adjacent = Engine.aiTarget(hitProbe, Engine.createRng(8));
  check(Math.abs(adjacent.r - 3) + Math.abs(adjacent.c - 3) === 1,
    'target mode attacks a cell adjacent to the hit');

  var noRepeat = Engine.cloneState(playingState());
  noRepeat.turn = 'ai';
  var repeatRng = Engine.createRng(2026);
  var legal = true;
  for (var i = 0; i < 20; i += 1) {
    var target = Engine.aiTarget(noRepeat, repeatRng);
    if (!target || noRepeat.ai.shots[target.r][target.c] !== 0) {
      legal = false;
      break;
    }
    noRepeat.ai.shots[target.r][target.c] = Engine.MISS;
  }
  check(legal, 'aiTarget never repeats a previously fired cell');
})();

// 12. validateFleet catches overlap and wrong ship counts.
(function () {
  var good = fleetFrom(AI_LAYOUT);
  check(Engine.validateFleet(good).ok, 'validateFleet accepts a legal fleet');
  var overlap = fleetFrom(AI_LAYOUT);
  overlap[4].cells = [[0, 0], [0, 1]];
  check(!Engine.validateFleet(overlap).ok, 'validateFleet rejects overlapping ships');
  var short = fleetFrom(AI_LAYOUT).slice(0, 4);
  check(!Engine.validateFleet(short).ok, 'validateFleet rejects an incomplete fleet');
})();

// 13. Thirty seeded AI-vs-AI games must all terminate without illegal actions.
(function () {
  for (var seed = 1; seed <= 30; seed += 1) {
    var rng = Engine.createRng(seed * 9973);
    var state = Engine.createGame(seed);
    var playerFleet = Engine.randomFleet(rng);
    var setPlayer = Engine.setFleet(state, 'player', playerFleet);
    if (!setPlayer.ok) {
      check(false, 'self-play seed ' + seed + ' setFleet', setPlayer.error);
      continue;
    }
    var started = Engine.startGame(setPlayer.state);
    if (!started.ok) {
      check(false, 'self-play seed ' + seed + ' startGame', started.error);
      continue;
    }
    state = started.state;

    var steps = 0;
    var legal = true;
    while (!Engine.winner(state) && steps < 200) {
      var attacker = state.turn;
      var target = Engine.aiTarget(state, rng);
      if (!target || target.r < 0 || target.r > 7 || target.c < 0 || target.c > 7 ||
          state[attacker].shots[target.r][target.c] !== Engine.EMPTY) {
        legal = false;
        break;
      }
      var result = Engine.fire(state, target.r, target.c, attacker);
      if (!result.ok) {
        legal = false;
        break;
      }
      state = result.state;
      steps += 1;
    }

    check(legal, 'self-play seed ' + seed + ' has no illegal action');
    check(steps < 200, 'self-play seed ' + seed + ' stays under the step cap', 'steps=' + steps);
    check(Engine.winner(state) !== null, 'self-play seed ' + seed + ' reaches a winner',
      'steps=' + steps);
    var winningSide = Engine.winner(state);
    var losingSide = winningSide === 'player' ? 'ai' : 'player';
    check(winningSide !== null && Engine.allSunk(state, losingSide),
      'self-play seed ' + seed + ' ends with a fully sunk fleet');
  }
})();

console.log('RESULT: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exitCode = 1;
