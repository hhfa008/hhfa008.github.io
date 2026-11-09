/* Battleship engine — pure UMD logic, no DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BattleshipEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var BOARD_SIZE = 8;
  var EMPTY = 0;
  var MISS = 1;
  var HIT = 2;

  var SHIP_SPECS = Object.freeze([
    Object.freeze({ length: 5, name: '航空母舰' }),
    Object.freeze({ length: 4, name: '战列舰' }),
    Object.freeze({ length: 3, name: '巡洋舰' }),
    Object.freeze({ length: 3, name: '驱逐舰' }),
    Object.freeze({ length: 2, name: '潜艇' })
  ]);
  var SHIP_LENGTHS = Object.freeze(SHIP_SPECS.map(function (s) { return s.length; }));
  var DIRECTIONS = Object.freeze([
    Object.freeze({ r: -1, c: 0 }),
    Object.freeze({ r: 1, c: 0 }),
    Object.freeze({ r: 0, c: -1 }),
    Object.freeze({ r: 0, c: 1 })
  ]);

  function fail(error) {
    return { ok: false, error: error };
  }

  function isState(value) {
    return Boolean(value && value.player && value.ai &&
      Array.isArray(value.player.shots) && Array.isArray(value.ai.shots));
  }

  function oppositeSide(side) {
    return side === 'player' ? 'ai' : 'player';
  }

  function emptyGrid() {
    var grid = [];
    for (var r = 0; r < BOARD_SIZE; r += 1) {
      var row = [];
      for (var c = 0; c < BOARD_SIZE; c += 1) row.push(EMPTY);
      grid.push(row);
    }
    return grid;
  }

  function cloneCells(cells) {
    return cells.map(function (cell) { return [cell[0], cell[1]]; });
  }

  function cloneSide(side) {
    return {
      fleet: side.fleet.map(function (ship) {
        return {
          id: ship.id,
          name: ship.name,
          length: ship.length,
          orientation: ship.orientation,
          cells: cloneCells(ship.cells)
        };
      }),
      shots: side.shots.map(function (row) { return row.slice(); })
    };
  }

  function cloneState(state) {
    return {
      version: state.version,
      seed: state.seed,
      phase: state.phase,
      turn: state.turn,
      winner: state.winner,
      player: cloneSide(state.player),
      ai: cloneSide(state.ai),
      lastAction: state.lastAction ? Object.assign({}, state.lastAction) : null
    };
  }

  function normalizeSeed(seed) {
    if (seed === undefined || seed === null) return Date.now() >>> 0;
    if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
    var text = String(seed);
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // mulberry32: small, deterministic PRNG. All engine randomness goes through this.
  function createRng(seed) {
    var state = normalizeSeed(seed);
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resolveRng(rng) {
    if (typeof rng === 'function') return rng;
    if (rng && typeof rng.next === 'function') {
      return function () { return rng.next(); };
    }
    if (rng !== undefined && rng !== null) return createRng(rng);
    return createRng(Date.now());
  }

  function randomIndex(length, rng) {
    var value = Number(rng());
    if (!Number.isFinite(value)) value = 0;
    if (value < 0) value = 0;
    if (value >= 1) value = 0.999999999999;
    return Math.floor(value * length);
  }

  function pickOne(list, rng) {
    return list[randomIndex(list.length, rng)];
  }

  function shuffle(list, rng) {
    for (var i = list.length - 1; i > 0; i -= 1) {
      var j = randomIndex(i + 1, rng);
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function cellKey(r, c) {
    return r * BOARD_SIZE + c;
  }

  function inBounds(r, c) {
    return Number.isInteger(r) && Number.isInteger(c) &&
      r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE;
  }

  function normalizeOrientation(orientation) {
    if (orientation === undefined || orientation === null || orientation === '') return 'h';
    var value = String(orientation).toLowerCase();
    if (value === 'h' || value === 'horizontal' || value === 'row' || value === '横') return 'h';
    if (value === 'v' || value === 'vertical' || value === 'col' || value === '竖') return 'v';
    return null;
  }

  function cellsFor(length, r, c, orientation) {
    if (!Number.isInteger(length) || length < 1 || length > BOARD_SIZE) return null;
    var dir = normalizeOrientation(orientation);
    if (!dir) return null;
    var cells = [];
    for (var i = 0; i < length; i += 1) {
      var nr = r + (dir === 'v' ? i : 0);
      var nc = c + (dir === 'h' ? i : 0);
      if (!inBounds(nr, nc)) return null;
      cells.push([nr, nc]);
    }
    return cells;
  }

  function shipSpecFor(length, fleet) {
    var matching = SHIP_SPECS.filter(function (spec) { return spec.length === length; });
    if (!matching.length) return null;
    var already = fleet.filter(function (ship) { return ship.length === length; }).length;
    if (already >= matching.length) return null;
    return matching[already];
  }

  function validateFleet(fleet) {
    if (!Array.isArray(fleet)) return fail('INVALID_FLEET');
    if (fleet.length !== SHIP_SPECS.length) return fail('SHIP_COUNT_MISMATCH');

    var expectedLengths = SHIP_LENGTHS.slice().sort(function (a, b) { return a - b; });
    var actualLengths = fleet.map(function (ship) { return ship && ship.length; })
      .sort(function (a, b) { return a - b; });
    if (expectedLengths.join(',') !== actualLengths.join(',')) {
      return fail('SHIP_LENGTH_MISMATCH');
    }

    var occupied = Object.create(null);
    for (var i = 0; i < fleet.length; i += 1) {
      var ship = fleet[i];
      if (!ship || !Array.isArray(ship.cells) || ship.cells.length !== ship.length) {
        return fail('INVALID_SHIP');
      }
      var cells = ship.cells;
      for (var j = 0; j < cells.length; j += 1) {
        if (!Array.isArray(cells[j]) || !inBounds(cells[j][0], cells[j][1])) {
          return fail('OUT_OF_BOUNDS');
        }
      }
      var sameRow = cells.every(function (cell) { return cell[0] === cells[0][0]; });
      var sameCol = cells.every(function (cell) { return cell[1] === cells[0][1]; });
      if (!sameRow && !sameCol) return fail('SHIP_NOT_STRAIGHT');
      var ordered;
      if (sameRow) {
        ordered = cells.map(function (cell) { return cell[1]; }).sort(function (a, b) { return a - b; });
        for (var k = 1; k < ordered.length; k += 1) {
          if (ordered[k] !== ordered[k - 1] + 1) return fail('SHIP_NOT_CONTIGUOUS');
        }
      } else {
        ordered = cells.map(function (cell) { return cell[0]; }).sort(function (a, b) { return a - b; });
        for (var m = 1; m < ordered.length; m += 1) {
          if (ordered[m] !== ordered[m - 1] + 1) return fail('SHIP_NOT_CONTIGUOUS');
        }
      }
      for (var n = 0; n < cells.length; n += 1) {
        var key = cellKey(cells[n][0], cells[n][1]);
        if (occupied[key]) return fail('FLEET_OVERLAP');
        occupied[key] = true;
      }
    }
    return { ok: true };
  }

  function randomFleet(rng) {
    var rand = resolveRng(rng);
    var chosen = [];

    function candidatesFor(length, occupied) {
      var candidates = [];
      var orientations = ['h', 'v'];
      for (var oi = 0; oi < orientations.length; oi += 1) {
        var orientation = orientations[oi];
        var maxR = orientation === 'v' ? BOARD_SIZE - length : BOARD_SIZE - 1;
        var maxC = orientation === 'h' ? BOARD_SIZE - length : BOARD_SIZE - 1;
        for (var r = 0; r <= maxR; r += 1) {
          for (var c = 0; c <= maxC; c += 1) {
            var cells = [];
            var free = true;
            for (var i = 0; i < length; i += 1) {
              var nr = r + (orientation === 'v' ? i : 0);
              var nc = c + (orientation === 'h' ? i : 0);
              if (occupied[cellKey(nr, nc)]) { free = false; break; }
              cells.push([nr, nc]);
            }
            if (free) candidates.push({ r: r, c: c, orientation: orientation, cells: cells });
          }
        }
      }
      return shuffle(candidates, rand);
    }

    function search(index, occupied) {
      if (index >= SHIP_SPECS.length) return true;
      var spec = SHIP_SPECS[index];
      var candidates = candidatesFor(spec.length, occupied);
      for (var i = 0; i < candidates.length; i += 1) {
        var candidate = candidates[i];
        for (var j = 0; j < candidate.cells.length; j += 1) {
          occupied[cellKey(candidate.cells[j][0], candidate.cells[j][1])] = true;
        }
        chosen.push({ spec: spec, candidate: candidate });
        if (search(index + 1, occupied)) return true;
        chosen.pop();
        for (var k = 0; k < candidate.cells.length; k += 1) {
          delete occupied[cellKey(candidate.cells[k][0], candidate.cells[k][1])];
        }
      }
      return false;
    }

    var found = search(0, Object.create(null));
    if (!found) throw new Error('randomFleet: no valid layout found');

    return chosen.map(function (entry, index) {
      return {
        id: 'ship-' + (index + 1),
        name: entry.spec.name,
        length: entry.spec.length,
        orientation: entry.candidate.orientation,
        cells: cloneCells(entry.candidate.cells)
      };
    });
  }

  function createGame(seed) {
    var actualSeed = normalizeSeed(seed);
    return {
      version: 1,
      seed: actualSeed,
      phase: 'setup',
      turn: 'player',
      winner: null,
      player: { fleet: [], shots: emptyGrid() },
      ai: { fleet: randomFleet(createRng(actualSeed)), shots: emptyGrid() },
      lastAction: null
    };
  }

  function canPlace(fleetOrState, a, b, c, d, e) {
    var fleet;
    var length;
    var r;
    var c0;
    var orientation;

    if (isState(fleetOrState)) {
      if (a === 'player' || a === 'ai') {
        fleet = fleetOrState[a].fleet;
        length = b;
        r = c;
        c0 = d;
        orientation = e;
      } else {
        fleet = fleetOrState.player.fleet;
        length = a;
        r = b;
        c0 = c;
        orientation = d;
      }
    } else {
      fleet = fleetOrState;
      length = a;
      r = b;
      c0 = c;
      orientation = d;
    }

    if (!Array.isArray(fleet)) return false;
    var cells = cellsFor(length, r, c0, orientation);
    if (!cells) return false;
    var occupied = Object.create(null);
    for (var i = 0; i < fleet.length; i += 1) {
      var ship = fleet[i];
      if (!ship || !Array.isArray(ship.cells)) return false;
      for (var j = 0; j < ship.cells.length; j += 1) {
        var cell = ship.cells[j];
        if (Array.isArray(cell)) occupied[cellKey(cell[0], cell[1])] = true;
      }
    }
    for (var k = 0; k < cells.length; k += 1) {
      if (occupied[cellKey(cells[k][0], cells[k][1])]) return false;
    }
    return true;
  }

  function placeShip(state, side, length, r, c, orientation) {
    if (!isState(state)) return fail('INVALID_STATE');
    if (side !== 'player' && side !== 'ai') return fail('INVALID_SIDE');
    if (state.phase !== 'setup') return fail('NOT_SETUP');
    if (!Number.isInteger(length) || SHIP_LENGTHS.indexOf(length) === -1) {
      return fail('INVALID_SHIP_LENGTH');
    }
    var fleet = state[side].fleet;
    var spec = shipSpecFor(length, fleet);
    if (!spec) return fail('SHIP_ALREADY_PLACED');
    if (!normalizeOrientation(orientation)) return fail('INVALID_ORIENTATION');
    var cells = cellsFor(length, r, c, orientation);
    if (!cells) return fail('OUT_OF_BOUNDS');
    if (!canPlace(fleet, length, r, c, orientation)) return fail('OVERLAP');

    var next = cloneState(state);
    var already = next[side].fleet.filter(function (ship) { return ship.length === length; }).length;
    var ship = {
      id: side + '-ship-' + length + '-' + (already + 1),
      name: spec.name,
      length: length,
      orientation: normalizeOrientation(orientation),
      cells: cells
    };
    next[side].fleet.push(ship);
    return { ok: true, state: next, ship: ship };
  }

  function setFleet(state, side, fleet) {
    if (!isState(state)) return fail('INVALID_STATE');
    if (side !== 'player' && side !== 'ai') return fail('INVALID_SIDE');
    if (state.phase !== 'setup') return fail('NOT_SETUP');
    var valid = validateFleet(fleet);
    if (!valid.ok) return fail(valid.error);
    var next = cloneState(state);
    next[side].fleet = fleet.map(function (ship) {
      return {
        id: ship.id || (side + '-ship-' + ship.length),
        name: ship.name || '战舰',
        length: ship.length,
        orientation: ship.orientation || 'h',
        cells: cloneCells(ship.cells)
      };
    });
    return { ok: true, state: next };
  }

  function startGame(state) {
    if (!isState(state)) return fail('INVALID_STATE');
    if (state.phase !== 'setup') return fail('ALREADY_STARTED');
    var playerCheck = validateFleet(state.player.fleet);
    if (!playerCheck.ok) return fail('PLAYER_FLEET_' + playerCheck.error);
    var aiCheck = validateFleet(state.ai.fleet);
    if (!aiCheck.ok) return fail('AI_FLEET_' + aiCheck.error);

    var next = cloneState(state);
    next.phase = 'playing';
    next.turn = 'player';
    next.winner = null;
    next.player.shots = emptyGrid();
    next.ai.shots = emptyGrid();
    next.lastAction = null;
    return { ok: true, state: next };
  }

  function shipAt(fleet, r, c) {
    for (var i = 0; i < fleet.length; i += 1) {
      var cells = fleet[i].cells;
      for (var j = 0; j < cells.length; j += 1) {
        if (cells[j][0] === r && cells[j][1] === c) return fleet[i];
      }
    }
    return null;
  }

  function shipSunk(ship, shots) {
    return Boolean(ship && Array.isArray(ship.cells) && ship.cells.length > 0 &&
      ship.cells.every(function (cell) {
        return Array.isArray(shots[cell[0]]) && shots[cell[0]][cell[1]] === HIT;
      }));
  }

  function fleetSunk(fleet, shots) {
    return Array.isArray(fleet) && fleet.length > 0 &&
      fleet.every(function (ship) { return shipSunk(ship, shots); });
  }

  function allSunk(input, side) {
    if (Array.isArray(input)) return fleetSunk(input, side);
    if (!isState(input)) return false;
    if (side === 'player' || side === 'ai') {
      if (input[side].fleet.length !== SHIP_SPECS.length) return false;
      return fleetSunk(input[side].fleet, input[oppositeSide(side)].shots);
    }
    if (side === undefined) return allSunk(input, 'player') || allSunk(input, 'ai');
    return false;
  }

  function sunkCount(state, side) {
    if (!isState(state) || (side !== 'player' && side !== 'ai')) return 0;
    var shots = state[oppositeSide(side)].shots;
    return state[side].fleet.filter(function (ship) { return shipSunk(ship, shots); }).length;
  }

  function status(state) {
    if (!isState(state)) return 'invalid';
    if (state.phase === 'setup') return 'setup';
    if (state.winner === 'player') return 'player-win';
    if (state.winner === 'ai') return 'ai-win';
    if (allSunk(state, 'ai')) return 'player-win';
    if (allSunk(state, 'player')) return 'ai-win';
    if (state.phase === 'over') return 'over';
    return 'playing';
  }

  function winner(state) {
    if (!isState(state)) return null;
    if (state.winner === 'player' || state.winner === 'ai') return state.winner;
    var current = status(state);
    if (current === 'player-win') return 'player';
    if (current === 'ai-win') return 'ai';
    return null;
  }

  function fire(state, r, c, side) {
    if (!isState(state)) return fail('INVALID_STATE');
    var attacker = side === undefined ? 'player' : side;
    if (attacker !== 'player' && attacker !== 'ai') return fail('INVALID_SIDE');
    if (state.phase !== 'playing') return fail('NOT_PLAYING');
    if (state.turn !== attacker) return fail('NOT_YOUR_TURN');
    if (!Number.isInteger(r) || !Number.isInteger(c)) return fail('INVALID_COORDINATE');
    if (!inBounds(r, c)) return fail('OUT_OF_BOUNDS');

    var targetSide = oppositeSide(attacker);
    var next = cloneState(state);
    if (next[attacker].shots[r][c] !== EMPTY) return fail('CELL_ALREADY_FIRED');

    var ship = shipAt(next[targetSide].fleet, r, c);
    var hit = Boolean(ship);
    next[attacker].shots[r][c] = hit ? HIT : MISS;

    var sunk = hit && shipSunk(ship, next[attacker].shots);
    var won = allSunk(next, targetSide);
    var action = {
      side: attacker,
      targetSide: targetSide,
      r: r,
      c: c,
      hit: hit,
      sunk: sunk,
      sunkShip: sunk ? ship.name : null,
      winner: won ? attacker : null
    };

    next.lastAction = action;
    if (won) {
      next.phase = 'over';
      next.winner = attacker;
      next.turn = attacker;
    } else {
      next.turn = targetSide;
    }

    return { ok: true, state: next, result: action };
  }

  function collectHitCells(state, attacker, targetSide) {
    var shots = state[attacker].shots;
    var sunkCells = Object.create(null);
    var fleet = state[targetSide].fleet;
    for (var i = 0; i < fleet.length; i += 1) {
      if (shipSunk(fleet[i], shots)) {
        for (var j = 0; j < fleet[i].cells.length; j += 1) {
          var sunk = fleet[i].cells[j];
          sunkCells[cellKey(sunk[0], sunk[1])] = true;
        }
      }
    }
    var hits = [];
    for (var r = 0; r < BOARD_SIZE; r += 1) {
      for (var c = 0; c < BOARD_SIZE; c += 1) {
        if (shots[r][c] === HIT && !sunkCells[cellKey(r, c)]) hits.push([r, c]);
      }
    }
    return hits;
  }

  function aiTarget(state, rng) {
    if (!isState(state) || state.phase !== 'playing') return null;
    var attacker = state.turn;
    if (attacker !== 'player' && attacker !== 'ai') return null;
    var targetSide = oppositeSide(attacker);
    var shots = state[attacker].shots;
    var rand = resolveRng(rng);

    var untried = [];
    for (var r = 0; r < BOARD_SIZE; r += 1) {
      for (var c = 0; c < BOARD_SIZE; c += 1) {
        if (shots[r][c] === EMPTY) untried.push([r, c]);
      }
    }
    if (!untried.length) return null;

    var activeHits = collectHitCells(state, attacker, targetSide);
    if (activeHits.length) {
      var adjacent = [];
      var extension = [];
      var seenAdjacent = Object.create(null);
      var seenExtension = Object.create(null);

      for (var h = 0; h < activeHits.length; h += 1) {
        var hr = activeHits[h][0];
        var hc = activeHits[h][1];
        for (var d = 0; d < DIRECTIONS.length; d += 1) {
          var dir = DIRECTIONS[d];
          var nr = hr + dir.r;
          var nc = hc + dir.c;
          if (inBounds(nr, nc) && shots[nr][nc] === EMPTY) {
            var nearKey = cellKey(nr, nc);
            if (!seenAdjacent[nearKey]) {
              seenAdjacent[nearKey] = true;
              adjacent.push([nr, nc]);
            }
          }
          var tr = nr + dir.r;
          var tc = nc + dir.c;
          if (inBounds(nr, nc) && inBounds(tr, tc) &&
              shots[nr][nc] === HIT && shots[tr][tc] === EMPTY) {
            var farKey = cellKey(tr, tc);
            if (!seenExtension[farKey]) {
              seenExtension[farKey] = true;
              extension.push([tr, tc]);
            }
          }
        }
      }

      var targetList = extension.length ? extension : adjacent;
      if (targetList.length) {
        var picked = pickOne(targetList, rand);
        return { r: picked[0], c: picked[1] };
      }
    }

    var parity = untried.filter(function (cell) { return (cell[0] + cell[1]) % 2 === 0; });
    var pool = parity.length ? parity : untried;
    var choice = pickOne(pool, rand);
    return { r: choice[0], c: choice[1] };
  }

  return {
    BOARD_SIZE: BOARD_SIZE,
    EMPTY: EMPTY,
    MISS: MISS,
    HIT: HIT,
    SHIP_SPECS: SHIP_SPECS,
    SHIP_LENGTHS: SHIP_LENGTHS,
    createGame: createGame,
    createRng: createRng,
    makeRng: createRng,
    randomFleet: randomFleet,
    canPlace: canPlace,
    placeShip: placeShip,
    setFleet: setFleet,
    startGame: startGame,
    fire: fire,
    aiTarget: aiTarget,
    allSunk: allSunk,
    sunkCount: sunkCount,
    status: status,
    winner: winner,
    validateFleet: validateFleet,
    cloneState: cloneState,
    oppositeSide: oppositeSide
  };
});
