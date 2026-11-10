#!/usr/bin/env node
'use strict';

/*
 * 2048 realism gate for the art package.
 *
 * The picture must show a position that can actually occur in a real game, so
 * this file does not trust the board alone. It replays the recorded game from
 * the two starting tiles, move by move, using a small independent engine:
 *
 *   - board is 4x4 row-major, every tile is 0 or 2^k (k >= 1)
 *   - [2,2,2,2] merges to [4,4,0,0], never [8,0,0,0]: a tile merges at most
 *     once per move (canonical vectors below)
 *   - every recorded move must change the board, then spawn one 2 or 4 in an
 *     empty cell, exactly like the real game
 *   - score is the sum of merged values and moves is the number of valid moves
 *   - the declared final board, score and move count must equal the replay
 *   - the position is playable and contains at least one legal merge
 *
 * Exit 0 = REALISM OK. Exit 3 = REALISM FAIL; callers must not render any
 * image on exit 3 (render-art.mjs checks this before Chrome starts).
 *
 * Usage: node games/2048/assets/realism.mjs [state.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 4;
const CELLS = N * N;
const DIRS = ['left', 'right', 'up', 'down'];
const HERE = path.dirname(fileURLToPath(import.meta.url));

function fail(errors, message) {
  errors.push(message);
}

function mergeLine(line) {
  const src = line.filter((v) => v !== 0);
  const out = [];
  let gained = 0;
  for (let i = 0; i < src.length; i++) {
    if (i + 1 < src.length && src[i] === src[i + 1]) {
      const v = src[i] * 2;
      out.push(v);
      gained += v;
      i++;
    } else {
      out.push(src[i]);
    }
  }
  while (out.length < N) out.push(0);
  return { line: out, gained };
}

function applyMove(board, dir) {
  const next = board.slice();
  let gained = 0;
  let changed = false;
  for (let i = 0; i < N; i++) {
    let line;
    if (dir === 'left') line = next.slice(i * N, i * N + N);
    else if (dir === 'right') line = next.slice(i * N, i * N + N).reverse();
    else if (dir === 'up') line = Array.from({ length: N }, (_, r) => next[r * N + i]);
    else line = Array.from({ length: N }, (_, r) => next[(N - 1 - r) * N + i]);

    const res = mergeLine(line);
    gained += res.gained;
    let out = res.line;
    if (dir === 'right' || dir === 'down') out = out.slice().reverse();
    for (let k = 0; k < N; k++) {
      const idx = (dir === 'left' || dir === 'right') ? i * N + k : k * N + i;
      if (next[idx] !== out[k]) changed = true;
      next[idx] = out[k];
    }
  }
  return { board: next, gained, changed };
}

function isPowerOfTwo(v) {
  return Number.isInteger(v) && v >= 2 && (v & (v - 1)) === 0;
}

function hasAdjacentEqual(board) {
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const i = r * N + c;
      if (!board[i]) continue;
      if (c + 1 < N && board[i + 1] === board[i]) return true;
      if (r + 1 < N && board[i + N] === board[i]) return true;
    }
  }
  return false;
}

function hasLegalMove(board) {
  if (board.includes(0)) return true;
  return hasAdjacentEqual(board);
}

function sameBoard(a, b) {
  if (!Array.isArray(a) || a.length !== CELLS) return false;
  return a.every((v, i) => v === b[i]);
}

function canonicalVectors(errors) {
  const cases = [
    { input: [2, 2, 2, 2], expect: [4, 4, 0, 0], gained: 8, note: 'four 2s merge as two 4s' },
    { input: [2, 2, 4, 0], expect: [4, 4, 0, 0], gained: 4, note: 'merge result cannot merge again' },
    { input: [4, 4, 8, 8], expect: [8, 16, 0, 0], gained: 24, note: 'two independent pairs' },
    { input: [2, 2, 2, 0], expect: [4, 2, 0, 0], gained: 4, note: 'odd 2 stays single' }
  ];
  for (const c of cases) {
    const got = mergeLine(c.input);
    if (got.line.join(',') !== c.expect.join(',') || got.gained !== c.gained) {
      fail(errors, `merge vector failed: [${c.input}] -> [${got.line}] +${got.gained}, expected [${c.expect}] +${c.gained} (${c.note})`);
    }
  }
  const allLeft = applyMove([2, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'left');
  if (allLeft.board.slice(0, 4).join(',') !== '4,4,0,0' || allLeft.gained !== 8) {
    fail(errors, `move-level merge-once failed: [2,2,2,2] left -> [${allLeft.board.slice(0, 4)}] +${allLeft.gained}`);
  }
}

export function validateState(state) {
  const errors = [];
  canonicalVectors(errors);

  if (!state || typeof state !== 'object') {
    return { ok: false, errors: ['state is not an object'] };
  }
  if (state.game !== '2048') fail(errors, `game must be "2048", got ${JSON.stringify(state.game)}`);
  if (!Array.isArray(state.board) || state.board.length !== CELLS) {
    fail(errors, `board must contain ${CELLS} cells, got ${Array.isArray(state.board) ? state.board.length : typeof state.board}`);
  }
  const board = Array.isArray(state.board) ? state.board : [];
  board.forEach((v, i) => {
    if (v !== 0 && !isPowerOfTwo(v)) fail(errors, `cell ${i} is ${v}; every tile must be 0 or a power of two >= 2`);
  });
  if (!Number.isInteger(state.score) || state.score < 0) fail(errors, `score must be a non-negative integer, got ${state.score}`);
  if (!Number.isInteger(state.moves) || state.moves < 0) fail(errors, `moves must be a non-negative integer, got ${state.moves}`);

  const history = state.history;
  if (!history || typeof history !== 'object') {
    fail(errors, 'history is required to prove the position is reachable');
    return { ok: false, errors };
  }
  if (!Array.isArray(history.initial) || history.initial.length !== 2) {
    fail(errors, 'history.initial must contain exactly the two starting tiles');
  }
  if (!Array.isArray(history.moves)) {
    fail(errors, 'history.moves must be an array');
    return { ok: false, errors };
  }

  let replay = new Array(CELLS).fill(0);
  const used = new Set();
  for (const [k, tile] of (history.initial || []).entries()) {
    if (!Array.isArray(tile) || tile.length !== 2) { fail(errors, `initial tile ${k} must be [index, value]`); continue; }
    const [idx, val] = tile;
    if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS) { fail(errors, `initial tile ${k} index ${idx} out of range`); continue; }
    if (used.has(idx)) fail(errors, `initial tile ${k} reuses cell ${idx}`);
    used.add(idx);
    if (val !== 2 && val !== 4) fail(errors, `initial tile ${k} value ${val} must be 2 or 4`);
    replay[idx] = val;
  }

  let score = 0;
  history.moves.forEach((move, k) => {
    if (!move || typeof move !== 'object') { fail(errors, `move ${k} is not an object`); return; }
    if (!DIRS.includes(move.dir)) { fail(errors, `move ${k} direction ${JSON.stringify(move.dir)} is invalid`); return; }
    const res = applyMove(replay, move.dir);
    if (!res.changed) { fail(errors, `move ${k} (${move.dir}) does not change the board`); return; }
    replay = res.board;
    score += res.gained;
    if (!Array.isArray(move.spawn) || move.spawn.length !== 2) {
      fail(errors, `move ${k} spawn must be [index, value]`);
      return;
    }
    const [idx, val] = move.spawn;
    if (!Number.isInteger(idx) || idx < 0 || idx >= CELLS) { fail(errors, `move ${k} spawn index ${idx} out of range`); return; }
    if (replay[idx] !== 0) { fail(errors, `move ${k} spawns into occupied cell ${idx}`); return; }
    if (val !== 2 && val !== 4) { fail(errors, `move ${k} spawn value ${val} must be 2 or 4`); return; }
    replay[idx] = val;
  });

  if (!sameBoard(board, replay)) {
    fail(errors, `declared board does not match replay: declared [${board.join(',')}] replay [${replay.join(',')}]`);
  }
  if (state.moves !== history.moves.length) {
    fail(errors, `moves=${state.moves} but history has ${history.moves.length} valid moves`);
  }
  if (state.score !== score) {
    fail(errors, `score=${state.score} but merges add up to ${score}`);
  }
  if (!hasLegalMove(board)) fail(errors, 'position has no legal move; pick a playable mid-game position');
  if (!hasAdjacentEqual(board)) fail(errors, 'position has no adjacent equal tiles; the art should show a legal merge opportunity');

  return { ok: errors.length === 0, errors, replay, score, moves: history.moves.length };
}

function main() {
  const file = path.resolve(process.argv[2] || path.join(HERE, 'state.json'));
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('REALISM FAIL: cannot read ' + file + ': ' + err.message);
    process.exitCode = 3;
    return;
  }
  const result = validateState(state);
  if (!result.ok) {
    console.error('REALISM FAIL: ' + file);
    for (const e of result.errors) console.error('  - ' + e);
    console.error('refusing to render: 0 image files written');
    process.exitCode = 3;
    return;
  }
  const rows = [];
  for (let r = 0; r < N; r++) rows.push(state.board.slice(r * N, r * N + N).join('\t'));
  console.log(`REALISM OK: ${path.relative(process.cwd(), file)}`);
  console.log(rows.join('\n'));
  console.log(`4x4 · ${state.moves} moves · score ${state.score} · replay matched · merge-once vectors passed`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
