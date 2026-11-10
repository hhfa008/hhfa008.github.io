#!/usr/bin/env node
'use strict';

/*
 * Realism gate for the nine arcade-family art packages.
 *
 *   node games/assets/art/arcade/engine/realism.mjs <family>
 *   node .../realism.mjs games/assets/art/arcade/state/slide-puzzle.json
 *
 * Every family state must describe a position that can actually occur under
 * that game's own kit (games/shared/arcade/kits/*.js). The gate is independent
 * of the renderer: the renderer refuses to start when this exits 3, so a bad
 * position can never overwrite the committed images.
 *
 * Exit 0 = REALISM OK, exit 3 = REALISM FAIL (no image files may be written).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(HERE, '..', 'state');
const FAMILIES = [
  'slide-puzzle', 'lights-out', 'minesweeper', 'memory-pairs', 'snake',
  'pong', 'tictactoe', 'hanoi', 'reaction'
];
const FILES = {
  'slide-puzzle': 'slide-puzzle',
  'lights-out': 'lights-out',
  'minesweeper': 'minesweeper',
  'memory-pairs': 'memory-pairs',
  'snake': 'snake',
  'pong': 'pong',
  'tictactoe': 'tictactoe',
  'hanoi': 'hanoi',
  'reaction': 'reaction'
};

function fail(errors, message) { errors.push(message); }

function isInt(v) { return Number.isInteger(v); }

function isIndex(v, n) { return isInt(v) && v >= 0 && v < n; }

function unique(arr) { return new Set(arr).size === arr.length; }

function seeded(seed) {
  // mulberry32: deterministic, tiny, good enough for art state generation.
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) { return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]; }

// ---------------------------------------------------------------------------
// slide-puzzle (n x n, 1..n^2-1 + one blank)
// ---------------------------------------------------------------------------
function slideSolved(n) {
  const out = [];
  for (let i = 1; i < n * n; i++) out.push(i);
  out.push(0);
  return out;
}
function slideNeighbors(blank, n) {
  const r = Math.floor(blank / n), c = blank % n;
  const out = [];
  if (r > 0) out.push({ dir: 'up', at: blank - n });
  if (r < n - 1) out.push({ dir: 'down', at: blank + n });
  if (c > 0) out.push({ dir: 'left', at: blank - 1 });
  if (c < n - 1) out.push({ dir: 'right', at: blank + 1 });
  return out;
}
function slideApply(tiles, blank, dir, n) {
  const nb = slideNeighbors(blank, n).find((x) => x.dir === dir);
  if (!nb) return null;
  const next = tiles.slice();
  next[blank] = next[nb.at];
  next[nb.at] = 0;
  return { tiles: next, blank: nb.at };
}
function validateSlide(state, errors) {
  const cfg = state.config || {};
  const n = cfg.n;
  if (!isInt(n) || n < 3 || n > 12) fail(errors, `config.n must be 3..12, got ${JSON.stringify(n)}`);
  if (!isInt(n) || n < 3 || n > 12) return {};
  const N = n * n;
  const pos = state.position || {};
  if (!Array.isArray(pos.tiles) || pos.tiles.length !== N) {
    fail(errors, `position.tiles must have ${N} cells`);
    return {};
  }
  const sorted = pos.tiles.slice().sort((a, b) => a - b);
  for (let i = 0; i < N; i++) {
    if (sorted[i] !== i) { fail(errors, `tiles must contain 0..${N - 1} exactly once (cell ${i} sorted to ${sorted[i]})`); break; }
  }
  if (pos.blank !== pos.tiles.indexOf(0)) {
    fail(errors, `position.blank ${pos.blank} does not match the zero cell ${pos.tiles.indexOf(0)}`);
  }
  const hist = pos.history;
  if (!hist || !Array.isArray(hist.moves)) {
    fail(errors, 'position.history.moves is required to prove reachability from the solved board');
    return {};
  }
  let tiles = slideSolved(n);
  let blank = N - 1;
  hist.moves.forEach((dir, k) => {
    if (!['up', 'down', 'left', 'right'].includes(dir)) { fail(errors, `history move ${k} has invalid direction ${JSON.stringify(dir)}`); return; }
    const next = slideApply(tiles, blank, dir, n);
    if (!next) { fail(errors, `history move ${k} (${dir}) is illegal with blank at ${blank}`); return; }
    tiles = next.tiles;
    blank = next.blank;
  });
  if (tiles.join(',') !== pos.tiles.join(',')) {
    fail(errors, `declared tiles do not match replay from solved: declared [${pos.tiles}] replay [${tiles}]`);
  }
  if (blank !== pos.blank) fail(errors, `declared blank ${pos.blank} but replay has ${blank}`);
  if (pos.moves !== hist.moves.length) fail(errors, `position.moves ${pos.moves} != history moves ${hist.moves.length}`);
  const solved = slideSolved(n);
  if (pos.tiles.join(',') === solved.join(',')) fail(errors, 'position is already solved; the art should show a mid-game board');
  return { n, moves: hist.moves.length };
}

// ---------------------------------------------------------------------------
// lights-out (n x n, click toggles self + orthogonal neighbours)
// ---------------------------------------------------------------------------
function lightsToggle(lights, index, n) {
  const r = Math.floor(index / n), c = index % n;
  [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) lights[rr * n + cc] ^= 1;
  });
}
function validateLights(state, errors) {
  const cfg = state.config || {};
  const n = cfg.n;
  if (!isInt(n) || n < 3 || n > 12) { fail(errors, `config.n must be 3..12, got ${JSON.stringify(n)}`); return {}; }
  const N = n * n;
  const pos = state.position || {};
  if (!Array.isArray(pos.lights) || pos.lights.length !== N) { fail(errors, `position.lights must have ${N} cells`); return {}; }
  pos.lights.forEach((v, i) => { if (v !== 0 && v !== 1) fail(errors, `lights[${i}] must be 0 or 1, got ${JSON.stringify(v)}`); });
  if (!pos.history || !Array.isArray(pos.history.clicks)) {
    fail(errors, 'position.history.clicks is required to prove reachability from all-off');
    return {};
  }
  let lights = new Array(N).fill(0);
  pos.history.clicks.forEach((index, k) => {
    if (!isIndex(index, N)) { fail(errors, `history click ${k} index ${JSON.stringify(index)} out of range`); return; }
    lightsToggle(lights, index, n);
  });
  if (lights.join('') !== pos.lights.join('')) fail(errors, `declared lights do not match replay: declared ${pos.lights.join('')} replay ${lights.join('')}`);
  if (pos.moves !== pos.history.clicks.length) fail(errors, `position.moves ${pos.moves} != clicks ${pos.history.clicks.length}`);
  const lit = pos.lights.reduce((a, b) => a + b, 0);
  if (lit === 0) fail(errors, 'all lights are off; not a mid-game position');
  if (lit > N - 3) fail(errors, `only ${N - lit} lights are off; pick a position with more work left`);
  if (lit < 3) fail(errors, `only ${lit} lights are on; too empty to read as the game`);
  return { n, lit, moves: pos.moves };
}

// ---------------------------------------------------------------------------
// minesweeper
// ---------------------------------------------------------------------------
function mineNeighbors(index, rows, cols) {
  const r = Math.floor(index / cols), c = index % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
    }
  }
  return out;
}
function mineCountAt(index, mines, rows, cols) {
  const set = new Set(mines);
  return mineNeighbors(index, rows, cols).filter((i) => set.has(i)).length;
}
function validateMines(state, errors) {
  const cfg = state.config || {};
  const rows = cfg.rows, cols = cfg.cols, mineCount = cfg.mines;
  if (!isInt(rows) || !isInt(cols) || rows < 7 || cols < 7 || rows > 30 || cols > 30) {
    fail(errors, `config rows/cols must be 7..30, got ${rows}x${cols}`);
    return {};
  }
  const N = rows * cols;
  if (!isInt(mineCount) || mineCount < 1 || mineCount >= N) { fail(errors, `config.mines ${JSON.stringify(mineCount)} must be 1..${N - 1}`); return {}; }
  const pos = state.position || {};
  if (!Array.isArray(pos.mines) || pos.mines.length !== mineCount) {
    fail(errors, `position.mines must contain exactly ${mineCount} indices`);
    return {};
  }
  pos.mines.forEach((i) => { if (!isIndex(i, N)) fail(errors, `mine index ${JSON.stringify(i)} out of range`); });
  if (!unique(pos.mines)) fail(errors, 'mine indices are not unique');
  if (!isIndex(pos.firstClick, N)) fail(errors, `firstClick ${JSON.stringify(pos.firstClick)} out of range`);
  if (pos.mines.includes(pos.firstClick)) fail(errors, 'firstClick is a mine; the first reveal must be safe');
  if (mineCountAt(pos.firstClick, pos.mines, rows, cols) !== 0) {
    fail(errors, `firstClick ${pos.firstClick} has adjacent mines; the opening flood should start on an empty cell`);
  }
  if (!Array.isArray(pos.reveals) || !pos.reveals.length) { fail(errors, 'position.reveals must be a non-empty array'); return {}; }
  const mines = new Set(pos.mines);
  const revealed = new Array(N).fill(false);
  const flags = new Array(N).fill(false);
  // The kit's reveal action: flood only through zero-count cells, skipping
  // flagged cells. Flags are placed after the reveals in this picture.
  function reveal(index) {
    if (!isIndex(index, N)) { fail(errors, `reveal index ${JSON.stringify(index)} out of range`); return; }
    if (mines.has(index)) { fail(errors, `reveal ${index} would open a mine`); return; }
    if (revealed[index]) { fail(errors, `reveal ${index} is already revealed`); return; }
    const stack = [index];
    while (stack.length) {
      const cur = stack.pop();
      if (revealed[cur] || flags[cur]) continue;
      revealed[cur] = true;
      if (mineCountAt(cur, pos.mines, rows, cols) === 0) {
        mineNeighbors(cur, rows, cols).forEach((i) => { if (!revealed[i]) stack.push(i); });
      }
    }
  }
  pos.reveals.forEach(reveal);
  if (pos.reveals[0] !== pos.firstClick) fail(errors, `first reveal ${pos.reveals[0]} != firstClick ${pos.firstClick}`);
  if (!Array.isArray(pos.flags)) { fail(errors, 'position.flags must be an array'); return {}; }
  if (!unique(pos.flags)) fail(errors, 'flag indices are not unique');
  pos.flags.forEach((i) => {
    if (!isIndex(i, N)) { fail(errors, `flag index ${JSON.stringify(i)} out of range`); return; }
    if (!mines.has(i)) fail(errors, `flag ${i} is not on a mine; the picture should show correct flags`);
    if (revealed[i]) fail(errors, `flag ${i} sits on an already revealed cell`);
    flags[i] = true;
  });
  const declared = new Set(pos.revealed || []);
  if (!Array.isArray(pos.revealed)) fail(errors, 'position.revealed must be an array');
  if (declared.size !== pos.revealed.length) fail(errors, 'revealed indices are not unique');
  pos.revealed.forEach((i) => { if (!isIndex(i, N)) fail(errors, `revealed index ${JSON.stringify(i)} out of range`); });
  const replayed = [];
  for (let i = 0; i < N; i++) if (revealed[i]) replayed.push(i);
  if (replayed.join(',') !== (pos.revealed || []).slice().sort((a, b) => a - b).join(',')) {
    fail(errors, `declared revealed set does not match the reveal replay (${replayed.length} cells)`);
  }
  let numbers = 0;
  replayed.forEach((i) => { if (mineCountAt(i, pos.mines, rows, cols) > 0) numbers++; });
  if (numbers < 3) fail(errors, `only ${numbers} revealed numbered cells; the picture needs readable numbers`);
  if (replayed.length < 8) fail(errors, `only ${replayed.length} cells revealed; the board reads as untouched`);
  if (replayed.length >= N - mineCount) fail(errors, 'board is already solved; pick a mid-game position');
  return { rows, cols, mines: mineCount, revealed: replayed.length, flags: pos.flags.length, numbers };
}

// ---------------------------------------------------------------------------
// memory-pairs
// ---------------------------------------------------------------------------
function validateMemory(state, errors) {
  const cfg = state.config || {};
  const rows = cfg.rows, cols = cfg.cols;
  if (!isInt(rows) || !isInt(cols) || rows < 3 || cols < 3 || rows > 8 || cols > 8) {
    fail(errors, `config rows/cols must be 3..8, got ${rows}x${cols}`);
    return {};
  }
  const N = rows * cols;
  const pairs = Math.floor(N / 2);
  const pos = state.position || {};
  if (!Array.isArray(pos.cards) || pos.cards.length !== N) { fail(errors, `position.cards must have ${N} entries`); return {}; }
  const counts = new Map();
  pos.cards.forEach((card, i) => {
    if (!card || typeof card !== 'object') { fail(errors, `card ${i} is not an object`); return; }
    const p = card.pair;
    if (p === -1) {
      if (N % 2 === 0) fail(errors, `card ${i} uses the odd-board filler pair -1 on an even board`);
      if (!card.matched) fail(errors, `odd-board filler card ${i} must be matched`);
      return;
    }
    if (!isInt(p) || p < 0 || p >= pairs) { fail(errors, `card ${i} pair ${JSON.stringify(p)} out of range 0..${pairs - 1}`); return; }
    counts.set(p, (counts.get(p) || 0) + 1);
  });
  for (let p = 0; p < pairs; p++) if (counts.get(p) !== 2) fail(errors, `pair ${p} appears ${counts.get(p) || 0} times, expected 2`);
  const up = pos.cards.map((c, i) => (c.up && !c.matched ? i : -1)).filter((i) => i >= 0);
  if (up.length > 2) fail(errors, `${up.length} cards are face-up; at most two can be up at once`);
  if (up.length === 2) {
    const a = pos.cards[up[0]], b = pos.cards[up[1]];
    if (a.pair !== b.pair) fail(errors, `the two face-up cards are pair ${a.pair} and ${b.pair}; the picture should show a matching pair`);
  }
  const matched = pos.cards.filter((c) => c.matched && c.pair !== -1);
  if (matched.length % 2 !== 0) fail(errors, `${matched.length} cards are matched; pairs must be complete`);
  const matchedPairs = new Map();
  matched.forEach((c) => matchedPairs.set(c.pair, (matchedPairs.get(c.pair) || 0) + 1));
  matchedPairs.forEach((n, p) => { if (n !== 2) fail(errors, `pair ${p} has ${n} matched cards; both or neither`); });
  if (matchedPairs.size < 1) fail(errors, 'no completed pair; the picture should show progress');
  const down = pos.cards.filter((c) => !c.up && !c.matched).length;
  if (down < 2) fail(errors, 'not enough face-down cards left; pick a mid-game position');
  if (!isInt(pos.flips) || pos.flips < 0) fail(errors, `position.flips ${JSON.stringify(pos.flips)} must be a non-negative integer`);
  if (!isInt(pos.moves) || pos.moves < 1) fail(errors, `position.moves ${JSON.stringify(pos.moves)} must be a positive integer`);
  return { rows, cols, pairs, matched: matchedPairs.size, up: up.length, down };
}

// ---------------------------------------------------------------------------
// snake
// ---------------------------------------------------------------------------
function validateSnake(state, errors) {
  const cfg = state.config || {};
  const size = cfg.size;
  if (!isInt(size) || size < 10 || size > 30) { fail(errors, `config.size must be 10..30, got ${JSON.stringify(size)}`); return {}; }
  const pos = state.position || {};
  const body = pos.body;
  if (!Array.isArray(body) || body.length < 3) { fail(errors, 'position.body must have at least 3 segments'); return {}; }
  const seen = new Set();
  body.forEach((p, k) => {
    if (!Array.isArray(p) || p.length !== 2 || !isIndex(p[0], size) || !isIndex(p[1], size)) {
      fail(errors, `body[${k}] ${JSON.stringify(p)} is not an in-bounds [row,col]`);
      return;
    }
    const key = p[0] + ',' + p[1];
    if (seen.has(key)) fail(errors, `body self-intersects at ${key}`);
    seen.add(key);
  });
  for (let k = 1; k < body.length; k++) {
    const dr = Math.abs(body[k][0] - body[k - 1][0]);
    const dc = Math.abs(body[k][1] - body[k - 1][1]);
    if (dr + dc !== 1) fail(errors, `body ${k - 1}->${k} is not orthogonally adjacent`);
  }
  const dirs = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  const d = dirs[pos.dir];
  if (!d) fail(errors, `position.dir ${JSON.stringify(pos.dir)} is invalid`);
  else if (body.length >= 2) {
    const dr = body[0][0] - body[1][0], dc = body[0][1] - body[1][1];
    if (dr !== d[0] || dc !== d[1]) fail(errors, `dir ${pos.dir} does not match head direction (${dr},${dc})`);
  }
  if (!Array.isArray(pos.food) || pos.food.length !== 2 || !isIndex(pos.food[0], size) || !isIndex(pos.food[1], size)) {
    fail(errors, `position.food ${JSON.stringify(pos.food)} is not an in-bounds [row,col]`);
  } else if (seen.has(pos.food[0] + ',' + pos.food[1])) {
    fail(errors, 'food sits on the snake body');
  }
  if (pos.score !== body.length - 3) fail(errors, `score ${pos.score} must equal grown segments ${body.length - 3}`);
  if (pos.alive !== true) fail(errors, 'the picture must show a live snake');
  return { size, length: body.length, score: pos.score };
}

// ---------------------------------------------------------------------------
// pong
// ---------------------------------------------------------------------------
function validatePong(state, errors) {
  const pos = state.position || {};
  if (pos.w !== 100 || pos.h !== 60) fail(errors, `court must be 100x60, got ${pos.w}x${pos.h}`);
  const ball = pos.ball;
  if (!ball || typeof ball !== 'object') { fail(errors, 'position.ball is required'); return {}; }
  if (!(ball.x > 0 && ball.x < 100) || !(ball.y > 0 && ball.y < 60)) fail(errors, `ball (${ball.x},${ball.y}) is outside the court`);
  if (!isFinite(ball.vx) || !isFinite(ball.vy) || Math.abs(ball.vx) < 0.2 || Math.abs(ball.vy) < 0.2) {
    fail(errors, `ball velocity (${ball.vx},${ball.vy}) must be a moving rally`);
  }
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed < 0.5 || speed > 4) fail(errors, `ball speed ${speed.toFixed(2)} is outside a plausible rally`);
  ['left', 'right'].forEach((side) => {
    const p = pos[side];
    if (!p || !isFinite(p.y) || p.y < 8 || p.y > 52) fail(errors, `${side} paddle y ${p && p.y} must stay inside 8..52`);
  });
  if (!Array.isArray(pos.score) || pos.score.length !== 2 || !pos.score.every((v) => isInt(v) && v >= 0 && v < 7)) {
    fail(errors, `score must be two integers 0..6, got ${JSON.stringify(pos.score)}`);
  }
  if (pos.over !== false) fail(errors, 'the picture must show a live rally, not a finished match');
  return { score: pos.score, ball: [ball.x, ball.y] };
}

// ---------------------------------------------------------------------------
// tictactoe / n-in-a-row
// ---------------------------------------------------------------------------
function tttWinner(board, n) {
  for (let r = 0; r < n; r++) {
    const v = board[r * n];
    if (v && board.slice(r * n, r * n + n).every((x) => x === v)) return v;
  }
  for (let c = 0; c < n; c++) {
    const v = board[c];
    if (!v) continue;
    let ok = true;
    for (let r = 1; r < n; r++) if (board[r * n + c] !== v) { ok = false; break; }
    if (ok) return v;
  }
  const d1 = board[0];
  if (d1 && board.every((x, i) => i % (n + 1) !== 0 || x === d1)) {
    if (board.filter((_, i) => i % (n + 1) === 0).every((x) => x === d1)) return d1;
  }
  const d2 = board[n - 1];
  if (d2 && Array.from({ length: n }, (_, r) => board[r * n + (n - 1 - r)]).every((x) => x === d2)) return d2;
  return 0;
}
function validateTictactoe(state, errors) {
  const cfg = state.config || {};
  const n = cfg.n;
  if (!isInt(n) || n < 3 || n > 12) { fail(errors, `config.n must be 3..12, got ${JSON.stringify(n)}`); return {}; }
  const N = n * n;
  const pos = state.position || {};
  if (!Array.isArray(pos.board) || pos.board.length !== N) { fail(errors, `position.board must have ${N} cells`); return {}; }
  let x = 0, o = 0;
  pos.board.forEach((v, i) => {
    if (v === 1) x++;
    else if (v === 2) o++;
    else if (v !== 0) fail(errors, `board[${i}] ${JSON.stringify(v)} must be 0, 1 or 2`);
  });
  if (!(x === o || x === o + 1)) fail(errors, `X/O counts ${x}/${o} cannot occur with X moving first`);
  const turn = x === o ? 1 : 2;
  if (pos.turn !== turn) fail(errors, `turn ${JSON.stringify(pos.turn)} should be ${turn} for counts ${x}/${o}`);
  if (x + o < 3) fail(errors, 'fewer than three marks; the board reads as untouched');
  if (x + o >= N) fail(errors, 'board is full; pick a mid-game position');
  if (tttWinner(pos.board, n)) fail(errors, 'the position already has a winner; pick a mid-game position');
  return { n, x, o, turn };
}

// ---------------------------------------------------------------------------
// hanoi
// ---------------------------------------------------------------------------
function validateHanoi(state, errors) {
  const cfg = state.config || {};
  const disks = cfg.disks;
  if (!isInt(disks) || disks < 4 || disks > 13) { fail(errors, `config.disks must be 4..13, got ${JSON.stringify(disks)}`); return {}; }
  const pos = state.position || {};
  if (!Array.isArray(pos.pegs) || pos.pegs.length !== 3) { fail(errors, 'position.pegs must be three arrays'); return {}; }
  const seen = [];
  pos.pegs.forEach((peg, k) => {
    if (!Array.isArray(peg)) { fail(errors, `peg ${k} is not an array`); return; }
    peg.forEach((d, j) => {
      if (!isInt(d) || d < 1 || d > disks) { fail(errors, `peg ${k}[${j}] disk ${JSON.stringify(d)} out of range 1..${disks}`); return; }
      if (j > 0 && peg[j - 1] <= d) fail(errors, `peg ${k} is illegal: disk ${d} sits under ${peg[j - 1]} (larger must be lower)`);
      seen.push(d);
    });
  });
  const sorted = seen.slice().sort((a, b) => a - b);
  for (let i = 0; i < disks; i++) if (sorted[i] !== i + 1) { fail(errors, `disks must be 1..${disks} exactly once, got [${seen}]`); break; }
  if (pos.pegs[2].length === disks) fail(errors, 'the puzzle is already solved; pick a mid-game position');
  if (!isInt(pos.moves) || pos.moves < 1 || pos.moves > 2 ** disks - 1) fail(errors, `moves ${JSON.stringify(pos.moves)} outside 1..${2 ** disks - 1}`);
  const nonEmpty = pos.pegs.filter((p) => p.length).length;
  if (nonEmpty < 2) fail(errors, 'all disks are on one peg; the picture should show a transfer in progress');
  return { disks, moves: pos.moves, heights: pos.pegs.map((p) => p.length) };
}

// ---------------------------------------------------------------------------
// reaction (click/time challenge)
// ---------------------------------------------------------------------------
function validateReaction(state, errors) {
  const cfg = state.config || {};
  const pos = state.position || {};
  const mode = cfg.mode;
  if (mode !== 'time' && mode !== 'rounds') { fail(errors, `config.mode must be "time" or "rounds", got ${JSON.stringify(mode)}`); return {}; }
  if (mode === 'time' && ![10, 20, 30].includes(cfg.time)) fail(errors, `config.time must be 10, 20 or 30, got ${JSON.stringify(cfg.time)}`);
  if (mode === 'rounds' && cfg.rounds !== 5) fail(errors, `config.rounds must be 5, got ${JSON.stringify(cfg.rounds)}`);
  if (!isInt(pos.score) || pos.score < 0) fail(errors, `score ${JSON.stringify(pos.score)} must be a non-negative integer`);
  if (!isInt(pos.hits) || pos.hits < 0) fail(errors, `hits ${JSON.stringify(pos.hits)} must be a non-negative integer`);
  if (!isInt(pos.misses) || pos.misses < 0) fail(errors, `misses ${JSON.stringify(pos.misses)} must be a non-negative integer`);
  if (pos.score !== pos.hits) fail(errors, `score ${pos.score} must equal hits ${pos.hits} in the kit`);
  if (pos.running !== true || pos.over !== false) fail(errors, 'the picture must show a running round');
  if (mode === 'time') {
    if (!isInt(pos.timeLeft) || pos.timeLeft < 1 || pos.timeLeft >= cfg.time) fail(errors, `timeLeft ${JSON.stringify(pos.timeLeft)} must be 1..${cfg.time - 1}`);
  } else {
    if (!isInt(pos.round) || pos.round < 1 || pos.round > cfg.rounds) fail(errors, `round ${JSON.stringify(pos.round)} must be 1..${cfg.rounds}`);
  }
  const targets = pos.targets;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 3) { fail(errors, 'position.targets must contain 1..3 targets'); return {}; }
  const seen = new Set();
  targets.forEach((t, k) => {
    if (!t || !isIndex(t.r, 6) || !isIndex(t.c, 6)) { fail(errors, `target ${k} ${JSON.stringify(t)} is outside the 6x6 pad`); return; }
    const key = t.r + ',' + t.c;
    if (seen.has(key)) fail(errors, `target ${k} overlaps another target at ${key}`);
    seen.add(key);
  });
  return { mode, score: pos.score, hits: pos.hits, misses: pos.misses, targets: targets.length };
}

const VALIDATORS = {
  'slide-puzzle': validateSlide,
  'lights-out': validateLights,
  'minesweeper': validateMines,
  'memory-pairs': validateMemory,
  'snake': validateSnake,
  'pong': validatePong,
  'tictactoe': validateTictactoe,
  'hanoi': validateHanoi,
  'reaction': validateReaction
};

export function validateState(state) {
  const errors = [];
  if (!state || typeof state !== 'object') return { ok: false, errors: ['state is not an object'] };
  if (state.version !== 1) fail(errors, `state.version must be 1, got ${JSON.stringify(state.version)}`);
  const family = state.family;
  if (!FAMILIES.includes(family)) return { ok: false, errors: [`state.family must be one of ${FAMILIES.join(', ')}, got ${JSON.stringify(family)}`] };
  if (!state.art || typeof state.art !== 'object') fail(errors, 'state.art metadata is required');
  if (!state.position || typeof state.position !== 'object') fail(errors, 'state.position is required');
  if (!state.config || typeof state.config !== 'object') fail(errors, 'state.config is required');
  let summary = {};
  if (state.position && state.config) {
    try { summary = VALIDATORS[family](state, errors) || {}; }
    catch (err) { fail(errors, `validator crashed: ${err && err.message ? err.message : String(err)}`); }
  }
  return { ok: errors.length === 0, errors, summary };
}

function resolveFile(arg) {
  if (!arg) return null;
  if (fs.existsSync(arg)) return path.resolve(arg);
  const stem = FILES[arg] ? FILES[arg] : arg;
  const candidate = path.join(STATE_DIR, stem + '.json');
  return fs.existsSync(candidate) ? candidate : null;
}

export function loadState(family) {
  const file = path.join(STATE_DIR, FILES[family] + '.json');
  return { file, state: JSON.parse(fs.readFileSync(file, 'utf8')) };
}

function main() {
  const arg = process.argv[2];
  const file = resolveFile(arg);
  if (!file) {
    console.error('REALISM FAIL: unknown family or missing state file: ' + JSON.stringify(arg));
    console.error('usage: node realism.mjs <' + FAMILIES.join('|') + '|path/to/state.json>');
    process.exitCode = 3;
    return;
  }
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { console.error('REALISM FAIL: cannot read ' + file + ': ' + err.message); process.exitCode = 3; return; }
  const result = validateState(state);
  if (!result.ok) {
    console.error('REALISM FAIL: ' + path.relative(process.cwd(), file));
    result.errors.forEach((e) => console.error('  - ' + e));
    console.error('refusing to render: 0 image files written');
    process.exitCode = 3;
    return;
  }
  const details = Object.keys(result.summary).map((k) => k + '=' + JSON.stringify(result.summary[k])).join(' · ');
  console.log('REALISM OK: ' + path.relative(process.cwd(), file));
  console.log('  ' + state.family + ' · ' + details);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
