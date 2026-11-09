/* Pure-function tests for the agentnet server core.
 *
 *   node test.js
 *
 * Covers: rule-copy equivalence with games/shared/rules.js, legal/illegal
 * actions, hash-chain determinism, replay verification and timeout decisions.
 * No Worker/runtime is started here; smoke.js does the end-to-end run.
 */
'use strict';

const assert = require('assert');
const path = require('path');

// Load order matters: each UMD file publishes itself on globalThis.
// shared/rules.js -> rules copy -> core (which reads the copy).
const shared = require('../../shared/rules.js');
const copy = require('./src/rules/rules.js');
const core = require('./src/rules/core.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)));
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push(name + ': ' + (err && err.message ? err.message : String(err)));
  }
}

function rng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function buildLog(game, moves, seed, mutate) {
  let state = core.createGame(game);
  let hash = await core.genesisHash(game, seed);
  const chain = [];
  const logMoves = [];
  for (let i = 0; i < moves.length; i++) {
    const seat = state.turn;
    const res = core.applyMove(state, moves[i]);
    if (!res.ok) throw new Error('fixture move ' + moves[i] + ' rejected: ' + res.code);
    state = res.state;
    hash = await core.chainNext(hash, state, i + 1);
    chain.push(hash);
    logMoves.push({ n: i + 1, seat: seat, id: res.action.id });
  }
  const result = state.over
    ? { winner: state.winner || null, draw: !!state.draw, byTimeout: false }
    : null;
  const log = {
    game: game,
    seed: seed,
    matchId: 'test-match',
    moves: logMoves,
    hashChain: chain,
    finalHash: hash,
    result: result,
  };
  log.logHash = await core.computeLogHash(log);
  if (mutate) mutate(log);
  return log;
}

const GOMOKU_WIN = ['7,0', '0,0', '7,1', '0,1', '7,2', '0,2', '7,3', '0,3', '7,4'];

async function main() {
  // ---------------------------------------------------------------- copy vs shared
  check('copy/gomoku constants match shared', () => {
    assert.strictEqual(copy.gomoku.N, shared.gomoku.N);
    assert.strictEqual(copy.gomoku.NN, shared.gomoku.NN);
    assert.strictEqual(copy.gomoku.EMPTY, shared.gomoku.EMPTY);
    assert.strictEqual(copy.gomoku.BLACK, shared.gomoku.BLACK);
    assert.strictEqual(copy.gomoku.WHITE, shared.gomoku.WHITE);
  });
  check('copy/connect4 constants match shared', () => {
    assert.strictEqual(copy.connect4.ROWS, shared.connect4.ROWS);
    assert.strictEqual(copy.connect4.COLS, shared.connect4.COLS);
    assert.strictEqual(copy.connect4.P1, shared.connect4.P1);
    assert.strictEqual(copy.connect4.P2, shared.connect4.P2);
  });

  const rand = rng(20261110);
  check('copy/gomoku checkWinAt+lineAt equal on 200 random boards', () => {
    for (let t = 0; t < 200; t++) {
      const b = [];
      for (let i = 0; i < 225; i++) b.push(rand() < 0.7 ? 0 : rand() < 0.5 ? 1 : 2);
      for (let k = 0; k < 20; k++) {
        const r = (rand() * 15) | 0;
        const c = (rand() * 15) | 0;
        const p = rand() < 0.5 ? 1 : 2;
        assert.deepStrictEqual(copy.gomoku.checkWinAt(b, r, c, p), shared.gomoku.checkWinAt(b, r, c, p));
        if (shared.gomoku.lineAt(b, r, c, p)) {
          assert.deepStrictEqual(copy.gomoku.lineAt(b, r, c, p), shared.gomoku.lineAt(b, r, c, p));
        }
      }
    }
  });
  check('copy/gomoku index helpers equal', () => {
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      assert.strictEqual(copy.gomoku.index(r, c), shared.gomoku.index(r, c));
      assert.strictEqual(copy.gomoku.rowOf(r * 15 + c), shared.gomoku.rowOf(r * 15 + c));
      assert.strictEqual(copy.gomoku.colOf(r * 15 + c), shared.gomoku.colOf(r * 15 + c));
      assert.strictEqual(copy.gomoku.inBoard(r, c), shared.gomoku.inBoard(r, c));
    }
  });

  check('copy/connect4 state helpers equal on 200 random boards', () => {
    for (let t = 0; t < 200; t++) {
      const b = [];
      for (let i = 0; i < 42; i++) b.push(rand() < 0.6 ? 0 : rand() < 0.5 ? 1 : 2);
      const state = { b: b, turn: rand() < 0.5 ? 1 : 2, last: -1, plies: 0 };
      assert.deepStrictEqual(copy.connect4.legalMoves(state), shared.connect4.legalMoves(state));
      for (let c = 0; c < 7; c++) {
        assert.strictEqual(copy.connect4.rowFor(b, c), shared.connect4.rowFor(b, c));
        assert.strictEqual(copy.connect4.isLegal(state, c), shared.connect4.isLegal(state, c));
      }
      assert.deepStrictEqual(copy.connect4.scanWinner(b), shared.connect4.scanWinner(b));
      assert.deepStrictEqual(copy.connect4.status(state), shared.connect4.status(state));
    }
  });

  check('copy/connect4 applyMove+status equal across 50 random playouts', () => {
    for (let g = 0; g < 50; g++) {
      let mine = core.createGame('connect4');
      let theirs = shared.connect4.setup();
      for (let ply = 0; ply < 42; ply++) {
        const legal = shared.connect4.legalMoves(theirs);
        if (!legal.length) break;
        const col = legal[(rand() * legal.length) | 0];
        const a = core.applyMove(mine, String(col));
        const b = shared.connect4.applyMove(theirs, col);
        assert.ok(a.ok);
        assert.deepStrictEqual(a.state.board, Array.from(b.b));
        assert.strictEqual(a.state.turn === 'p1' ? 1 : 2, b.turn);
        assert.strictEqual(a.state.last, b.last);
        assert.strictEqual(a.state.plies, b.plies);
        const mineStatus = { over: a.state.over, winner: a.state.winner === 'p1' ? 1 : a.state.winner === 'p2' ? 2 : 0, draw: a.state.draw };
        const theirStatus = shared.connect4.status(b);
        assert.strictEqual(mineStatus.over, theirStatus.over);
        assert.strictEqual(mineStatus.winner, theirStatus.winner);
        assert.strictEqual(mineStatus.draw, theirStatus.draw);
        mine = a.state;
        theirs = b;
        if (theirs.plies >= 0 && shared.connect4.status(theirs).over) break;
      }
    }
  });

  check('core/gomoku wins exactly when shared.checkWinAt says so (120 random games)', () => {
    for (let g = 0; g < 120; g++) {
      let state = core.createGame('gomoku');
      const board = new Array(225).fill(0);
      for (let ply = 0; ply < 225; ply++) {
        const legal = core.legalActions(state);
        const id = legal[(rand() * legal.length) | 0];
        const before = state.turn;
        const res = core.applyMove(state, id);
        assert.ok(res.ok);
        const cell = res.state.last;
        board[cell] = core.markOf(before);
        assert.deepStrictEqual(res.state.board, board);
        const shouldWin = shared.gomoku.checkWinAt(board, (cell / 15) | 0, cell % 15, core.markOf(before));
        assert.strictEqual(res.state.winner !== null, shouldWin);
        state = res.state;
        if (state.over) break;
      }
    }
  });

  // ---------------------------------------------------------------- legal actions
  check('legalActions/gomoku initial has 225 unique ids', () => {
    const legal = core.legalActions(core.createGame('gomoku'));
    assert.strictEqual(legal.length, 225);
    assert.strictEqual(new Set(legal).size, 225);
    assert.ok(legal.includes('7,7'));
    assert.ok(legal.includes('14,14'));
  });
  check('legalActions/connect4 initial has columns 0..6', () => {
    const legal = core.legalActions(core.createGame('connect4'));
    assert.deepStrictEqual(legal, ['0', '1', '2', '3', '4', '5', '6']);
  });
  check('legalActions/connect4 drops a full column', () => {
    let state = core.createGame('connect4');
    for (let i = 0; i < 6; i++) {
      const res = core.applyMove(state, '3');
      assert.ok(res.ok);
      state = res.state;
    }
    assert.ok(!core.legalActions(state).includes('3'));
  });

  // ---------------------------------------------------------------- illegal moves
  check('applyMove rejects occupied gomoku cell and leaves input untouched', () => {
    const start = core.createGame('gomoku');
    const first = core.applyMove(start, '7,7');
    assert.ok(first.ok);
    const occupied = core.applyMove(first.state, '7,7');
    assert.strictEqual(occupied.ok, false);
    assert.strictEqual(occupied.code, 'illegal_action');
    assert.strictEqual(start.board[7 * 15 + 7], 0, 'first move must not mutate its input');
    assert.strictEqual(first.state.board[7 * 15 + 7], 1);
  });
  check('applyMove rejects out-of-bounds / malformed gomoku ids', () => {
    const state = core.createGame('gomoku');
    for (const id of ['15,0', '0,15', '-1,0', '7', '7,7,7', 'a,b', '', ' 1,1', '1.0,2']) {
      const res = core.applyMove(state, id);
      assert.strictEqual(res.ok, false, 'accepted illegal id ' + JSON.stringify(id));
      assert.strictEqual(res.code, 'illegal_action');
    }
  });
  check('applyMove rejects malformed / full connect4 columns', () => {
    let state = core.createGame('connect4');
    for (const id of ['7', '8', '-1', 'a', '', '1,1']) {
      const res = core.applyMove(state, id);
      assert.strictEqual(res.ok, false, 'accepted illegal id ' + JSON.stringify(id));
    }
    for (let i = 0; i < 6; i++) state = core.applyMove(state, '3').state;
    const full = core.applyMove(state, '3');
    assert.strictEqual(full.ok, false);
    assert.strictEqual(full.code, 'illegal_action');
  });
  check('applyMove rejects any move after the game is over', () => {
    let state = core.createGame('gomoku');
    for (const id of GOMOKU_WIN) {
      const res = core.applyMove(state, id);
      assert.ok(res.ok);
      state = res.state;
    }
    assert.strictEqual(state.over, true);
    assert.strictEqual(state.winner, 'p1');
    const after = core.applyMove(state, '10,10');
    assert.strictEqual(after.ok, false);
    assert.strictEqual(after.code, 'game_over');
    assert.deepStrictEqual(core.legalActions(state), []);
  });

  // ---------------------------------------------------------------- hashes
  await checkAsync('hash/genesis is deterministic and matches fixture', async () => {
    assert.strictEqual(
      await core.genesisHash('gomoku', 'seed-1'),
      '66ce19acfb48d445dcf8e143ec80aa7fdc08984d511ba01e5131ed633fd0fb72',
    );
    assert.strictEqual(
      await core.genesisHash('connect4', 'seed-1'),
      'dd7a14fc2846c11d491bd8487eade2a03008b31e35a0131116a3a1eda5a10210',
    );
    assert.strictEqual(await core.genesisHash('gomoku', 'seed-1'), await core.genesisHash('gomoku', 'seed-1'));
  });

  await checkAsync('hash/chain matches recorded fixture for the 9-move win', async () => {
    const expected = [
      '9b2e4b342acd77403cb28658d33fa47f933974b6c2f0da785f0ddb631b8923c0',
      '091dbd6fd0c06dc687273ad65ada2996f97ce5e55b2e71c5f2674fa7438cb700',
      '786e930caec07977c49a077a175e6946fe950108b64dcc937f78714e0276cad9',
      '155b2ce41048bf9fd4ee38928b115688be809121bd4a0e7badc83f9923bc2143',
      'dd69e62bf67eaac6b713010abe857ee1068590e228405ccf53c84250d26cdb32',
      '99d219515656d9f9cea5fa8ba3840e70c6ab12fd5360c00161d33b6b5e9eceeb',
      '9e4e686d8c6ad198a0950cd24dc50b068a30a407dd6f50c537bf198ba5dbcfc1',
      'dd6f605e80daf1895cf1fa6963cd59cab45b1e6d5151b86de9b2d49911259228',
      '907e640fdaaef57ab1892442b31dc3f57c6678f92582ad058f3f8b176c304fdd',
    ];
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    assert.deepStrictEqual(log.hashChain, expected);
    assert.strictEqual(log.finalHash, expected[8]);
  });

  check('hash/canonical state is stable under key order and extra fields', () => {
    const a = { game: 'gomoku', board: [0], turn: 'p1', last: null, plies: 0, over: false, winner: null, draw: false };
    const b = { draw: false, winner: null, over: false, plies: 0, last: null, turn: 'p1', board: [0], game: 'gomoku', ignored: 123 };
    assert.strictEqual(core.canonicalState(a, 0), core.canonicalState(b, 0));
    assert.notStrictEqual(core.canonicalState(a, 0), core.canonicalState(a, 1));
  });

  // ---------------------------------------------------------------- verifyLog
  await checkAsync('verify/accepts a genuine gomoku log', async () => {
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    const verdict = await core.verifyLog(log);
    assert.deepStrictEqual(verdict.errors, []);
    assert.strictEqual(verdict.ok, true);
    assert.strictEqual(verdict.finalHash, log.finalHash);
    assert.strictEqual(verdict.logHash, log.logHash);
  });

  await checkAsync('verify/rejects a tampered move id', async () => {
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    log.moves[4].id = '7,9';
    const verdict = await core.verifyLog(log);
    assert.strictEqual(verdict.ok, false);
    assert.ok(verdict.errors.some((e) => e.startsWith('chain_mismatch')), JSON.stringify(verdict.errors));
    assert.ok(verdict.errors.includes('log_hash'), JSON.stringify(verdict.errors));
  });

  await checkAsync('verify/rejects a tampered hash chain', async () => {
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    log.hashChain[3] = 'f'.repeat(64);
    const verdict = await core.verifyLog(log);
    assert.strictEqual(verdict.ok, false);
    assert.ok(verdict.errors.includes('chain_mismatch_4'));
    assert.ok(verdict.errors.includes('log_hash'));
    log.finalHash = 'f'.repeat(64);
    const second = await core.verifyLog(log);
    assert.ok(second.errors.includes('final_hash'));
  });

  await checkAsync('verify/rejects a tampered result and a wrong seat', async () => {
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    log.result.winner = 'p2';
    log.moves[1].seat = 'p1';
    const verdict = await core.verifyLog(log);
    assert.strictEqual(verdict.ok, false);
    assert.ok(verdict.errors.includes('result_winner'));
    assert.ok(verdict.errors.includes('move_2_wrong_seat'));
    assert.ok(verdict.errors.includes('log_hash'));
  });

  await checkAsync('verify/rejects a log that hides the game-over result', async () => {
    const log = await buildLog('gomoku', GOMOKU_WIN, 'seed-1');
    log.result = null;
    log.logHash = await core.computeLogHash(log);
    const verdict = await core.verifyLog(log);
    assert.strictEqual(verdict.ok, false);
    assert.ok(verdict.errors.includes('missing_result'));
  });

  await checkAsync('verify/accepts a timeout log with zero moves', async () => {
    const log = {
      game: 'gomoku',
      seed: 'timeout-seed',
      matchId: 'timeout-match',
      moves: [],
      hashChain: [],
      finalHash: await core.genesisHash('gomoku', 'timeout-seed'),
      result: { winner: 'p2', draw: false, byTimeout: true },
    };
    log.logHash = await core.computeLogHash(log);
    const verdict = await core.verifyLog(log);
    assert.deepStrictEqual(verdict.errors, []);
    assert.strictEqual(verdict.ok, true);
    log.result.winner = 'p1';
    log.logHash = await core.computeLogHash(log);
    const bad = await core.verifyLog(log);
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.errors.includes('result_winner'));
  });

  // ---------------------------------------------------------------- timeout
  check('timeout/decides exactly at the deadline', () => {
    const state = core.createGame('gomoku');
    assert.strictEqual(core.timeoutResult(state, 999, 1000), null);
    assert.deepStrictEqual(core.timeoutResult(state, 1000, 1000), { winner: 'p2', loser: 'p1', byTimeout: true });
    assert.deepStrictEqual(core.timeoutResult(state, 5000, 1000), { winner: 'p2', loser: 'p1', byTimeout: true });
  });
  check('timeout/winner is always the opponent of the player to move', () => {
    const state = core.createGame('connect4');
    state.turn = 'p2';
    assert.deepStrictEqual(core.timeoutResult(state, 100, 50), { winner: 'p1', loser: 'p2', byTimeout: true });
  });
  check('timeout/no decision without deadline or after game over', () => {
    const state = core.createGame('gomoku');
    assert.strictEqual(core.timeoutResult(state, 100, null), null);
    assert.strictEqual(core.timeoutResult(state, 100, undefined), null);
    state.over = true;
    state.winner = 'p1';
    assert.strictEqual(core.timeoutResult(state, 1e12, 1), null);
  });

  // ---------------------------------------------------------------- summary
  for (const failure of failures) console.error('FAIL ' + failure);
  console.log('test.js: ' + passed + ' checks passed, ' + failures.length + ' failed');
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
