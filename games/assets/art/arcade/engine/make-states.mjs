#!/usr/bin/env node
'use strict';

/*
 * Deterministic state generator for the arcade-family art packages.
 *
 *   node games/assets/art/arcade/engine/make-states.mjs <family>
 *   node .../make-states.mjs --all
 *
 * The generated JSON is the single source of truth for the renderer and is
 * committed next to the images. Re-running this file with the same seed must
 * produce byte-identical JSON, which is what the ART-GUIDE reproducibility
 * rule asks for.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_DIR = path.resolve(HERE, '..', 'state');

function seeded(seed) {
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

function base(family, config, position, hud, caption, art) {
  return { version: 1, family, config, position, hud, caption, art };
}

// --- slide-puzzle -----------------------------------------------------------
function slideSolved(n) {
  const out = [];
  for (let i = 1; i < n * n; i++) out.push(i);
  out.push(0);
  return out;
}
function slideNeighbors(blank, n) {
  const r = Math.floor(blank / n), c = blank % n;
  const out = [];
  if (r > 0) out.push('up');
  if (r < n - 1) out.push('down');
  if (c > 0) out.push('left');
  if (c < n - 1) out.push('right');
  return out;
}
function slideApply(tiles, blank, dir, n) {
  const r = Math.floor(blank / n), c = blank % n;
  const delta = { up: -n, down: n, left: -1, right: 1 };
  const valid = {
    up: r > 0, down: r < n - 1, left: c > 0, right: c < n - 1
  };
  if (!valid[dir]) return null;
  const at = blank + delta[dir];
  const next = tiles.slice();
  next[blank] = next[at];
  next[at] = 0;
  return { tiles: next, blank: at };
}
function makeSlide(n, seed, steps) {
  const rng = seeded(seed);
  let tiles = slideSolved(n), blank = n * n - 1;
  const moves = [];
  for (let i = 0; i < steps; i++) {
    const dirs = slideNeighbors(blank, n);
    // Prefer not to immediately undo the previous slide; the recorded history
    // is still legal either way, this just gives a nicer-looking scramble.
    const last = moves.length ? { up: 'down', down: 'up', left: 'right', right: 'left' }[moves[moves.length - 1]] : null;
    const pool = dirs.filter((d) => d !== last);
    const dir = pick(rng, pool.length ? pool : dirs);
    const next = slideApply(tiles, blank, dir, n);
    if (!next) continue;
    tiles = next.tiles;
    blank = next.blank;
    moves.push(dir);
  }
  if (tiles.join(',') === slideSolved(n).join(',')) {
    const next = slideApply(tiles, blank, 'up', n);
    tiles = next.tiles; blank = next.blank; moves.push('up');
  }
  return {
    tiles, blank, moves,
    blankLabel: 'r' + (Math.floor(blank / n) + 1) + 'c' + (blank % n + 1)
  };
}

// --- lights-out -------------------------------------------------------------
function lightsToggle(lights, index, n) {
  const r = Math.floor(index / n), c = index % n;
  [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) lights[rr * n + cc] ^= 1;
  });
}
function makeLights(n, seed, clicks) {
  const rng = seeded(seed);
  let lights = new Array(n * n).fill(0);
  const history = [];
  for (let i = 0; i < clicks; i++) {
    const idx = Math.min(n * n - 1, Math.floor(rng() * n * n));
    lightsToggle(lights, idx, n);
    history.push(idx);
  }
  const lit = lights.reduce((a, b) => a + b, 0);
  if (lit === 0 || lit > n * n - 3 || lit < 3) {
    // Deterministic fallback: press the centre plus a diagonal.
    lights = new Array(n * n).fill(0);
    history.length = 0;
    const at = Math.floor(n / 2);
    [at, at - 1, at + 1, at - n, at + n].forEach((idx) => {
      if (idx >= 0 && idx < n * n) { lightsToggle(lights, idx, n); history.push(idx); }
    });
  }
  return { lights, clicks: history, lit: lights.reduce((a, b) => a + b, 0) };
}

// --- minesweeper ------------------------------------------------------------
function mineNeighbors(index, rows, cols) {
  const r = Math.floor(index / cols), c = index % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push(rr * cols + cc);
  }
  return out;
}
function mineCountAt(index, mines, rows, cols) {
  const set = new Set(mines);
  return mineNeighbors(index, rows, cols).filter((i) => set.has(i)).length;
}
function makeMines(rows, cols, mineCount, firstClick, seed) {
  const rng = seeded(seed);
  const N = rows * cols;
  const forbidden = new Set([firstClick, ...mineNeighbors(firstClick, rows, cols)]);
  const pool = [];
  for (let i = 0; i < N; i++) if (!forbidden.has(i)) pool.push(i);
  const mines = [];
  while (mines.length < mineCount && pool.length) {
    const at = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
    mines.push(pool.splice(at, 1)[0]);
  }
  mines.sort((a, b) => a - b);
  const minesSet = new Set(mines);
  const revealed = new Array(N).fill(false);
  function reveal(index) {
    const stack = [index];
    while (stack.length) {
      const cur = stack.pop();
      if (revealed[cur] || minesSet.has(cur)) continue;
      revealed[cur] = true;
      if (mineCountAt(cur, mines, rows, cols) === 0) {
        mineNeighbors(cur, rows, cols).forEach((i) => { if (!revealed[i]) stack.push(i); });
      }
    }
  }
  reveal(firstClick);
  const reveals = [firstClick];
  // Add a few numbered reveals so the picture carries readable counts.
  const numbered = [];
  for (let i = 0; i < N; i++) if (!revealed[i] && !minesSet.has(i) && mineCountAt(i, mines, rows, cols) > 0) numbered.push(i);
  for (let k = 0; k < Math.min(4, numbered.length); k++) {
    const idx = numbered[Math.floor((k + 0.5) * numbered.length / Math.min(4, numbered.length))];
    if (!revealed[idx]) { reveal(idx); reveals.push(idx); }
  }
  const revealedList = [];
  for (let i = 0; i < N; i++) if (revealed[i]) revealedList.push(i);
  const flags = mines.filter((i) => !revealed[i]).slice(0, Math.min(4, mines.length));
  return { mines, firstClick, reveals, revealed: revealedList, flags };
}

// --- memory-pairs -----------------------------------------------------------
const SYMBOLS = ['star', 'moon', 'leaf', 'drop', 'bolt', 'heart', 'diamond', 'ring'];
function makeMemory(rows, cols, seed) {
  const N = rows * cols;
  const pairs = Math.floor(N / 2);
  const deck = [];
  for (let p = 0; p < pairs; p++) { deck.push(p); deck.push(p); }
  const rng = seeded(seed);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
  }
  const cards = deck.map((pair) => ({ pair, up: false, matched: false }));
  // Matched pairs 0,1,2 on a 4x4 board; pair 3 is the two cards currently up.
  const matched = new Set([0, 1, 2]);
  cards.forEach((c) => { if (matched.has(c.pair)) c.matched = true; });
  for (const c of cards) { if (c.pair === 3) c.up = true; }
  return {
    cards,
    flips: 2 * (matched.size + 1),
    moves: matched.size + 1,
    symbols: SYMBOLS
  };
}

// --- snake ------------------------------------------------------------------
function makeSnake(size) {
  const body = [
    [6, 9], [6, 8], [6, 7], [6, 6], [7, 6], [8, 6], [8, 5], [8, 4],
    [7, 4], [6, 4], [5, 4], [5, 5], [5, 6], [4, 6], [4, 7], [4, 8]
  ];
  return { size, body, dir: 'right', food: [10, 10], score: body.length - 3, alive: true };
}

// --- family states ----------------------------------------------------------
const ART = {
  'slide-puzzle': { title: 'Sliding Puzzle', sub: 'slide · order · solve', familyZh: '数字华容道' },
  'lights-out': { title: 'Lights Out', sub: 'toggle · chase · dark', familyZh: '关灯' },
  'minesweeper': { title: 'Minesweeper', sub: 'flag · count · clear', familyZh: '扫雷' },
  'memory-pairs': { title: 'Memory Pairs', sub: 'flip · match · remember', familyZh: '翻牌记忆' },
  'snake': { title: 'Snake', sub: 'eat · grow · survive', familyZh: '贪吃蛇' },
  'pong': { title: 'Pong', sub: 'serve · rally · score', familyZh: '乒乓球' },
  'tictactoe': { title: 'Tic-Tac-Toe', sub: 'mark · block · three', familyZh: '井字棋' },
  'hanoi': { title: 'Tower of Hanoi', sub: 'lift · stack · move', familyZh: '汉诺塔' },
  'reaction': { title: 'Reaction', sub: 'watch · tap · reflex', familyZh: '反应挑战' }
};

function stateFor(family) {
  if (family === 'slide-puzzle') {
    const n = 4;
    const s = makeSlide(n, 20261110, 60);
    return base(family, { n }, {
      tiles: s.tiles, blank: s.blank, moves: s.moves.length, history: { moves: s.moves }
    }, [
      { label: 'Moves', value: String(s.moves.length) },
      { label: 'Blank', value: s.blankLabel }
    ], 'Real 4×4 position · ' + s.moves.length + ' legal slides · blank at ' + s.blankLabel,
    { ...ART[family], captionZh: '真实可复核的 4×4 数字华容道局面：从复原盘面逐步滑动 ' + s.moves.length + ' 步，空格在 ' + s.blankLabel + '。' });
  }
  if (family === 'lights-out') {
    const n = 5;
    const s = makeLights(n, 13, 9);
    return base(family, { n }, { lights: s.lights, moves: s.clicks.length, history: { clicks: s.clicks } }, [
      { label: 'Moves', value: String(s.clicks.length) },
      { label: 'Lit', value: String(s.lit) }
    ], 'Real 5×5 position · ' + s.clicks.length + ' clicks from all-off · ' + s.lit + ' lights on',
    { ...ART[family], captionZh: '真实可复核的 5×5 关灯局面：从全灭开始依次点击 ' + s.clicks.length + ' 个格子，现存 ' + s.lit + ' 盏灯。' });
  }
  if (family === 'minesweeper') {
    const rows = 10, cols = 10, mines = 18, firstClick = 44;
    const s = makeMines(rows, cols, mines, firstClick, 325);
    const prefix = (i) => 'r' + (Math.floor(i / cols) + 1) + 'c' + (i % cols + 1);
    return base(family, { rows, cols, mines }, {
      mines: s.mines, firstClick: s.firstClick, reveals: s.reveals,
      revealed: s.revealed, flags: s.flags
    }, [
      { label: 'Mines', value: String(mines) },
      { label: 'Flags', value: String(s.flags.length) },
      { label: 'Open', value: String(s.revealed.length) }
    ], 'Real 10×10 position · ' + mines + ' mines · ' + s.revealed.length + ' open · ' + s.flags.length + ' flags · first click ' + prefix(s.firstClick),
    { ...ART[family], captionZh: '真实可复核的 10×10 扫雷局面：18 颗雷，首开 ' + prefix(s.firstClick) + ' 安全，已翻开 ' + s.revealed.length + ' 格并正确插旗 ' + s.flags.length + ' 面。' });
  }
  if (family === 'memory-pairs') {
    const rows = 4, cols = 4;
    const s = makeMemory(rows, cols, 20261110);
    return base(family, { rows, cols }, {
      cards: s.cards, flips: s.flips, moves: s.moves, symbols: s.symbols
    }, [
      { label: 'Pairs', value: '3 / 8' },
      { label: 'Moves', value: String(s.moves) }
    ], 'Real 4×4 layout · 8 pairs · 3 matched · 2 face-up',
    { ...ART[family], captionZh: '真实可复核的 4×4 翻牌记忆盘面：8 对图案，已完成 3 对，当前两张同图案牌面朝上。' });
  }
  if (family === 'snake') {
    const p = makeSnake(14);
    return base(family, { size: p.size, wrap: false, speed: 5 }, {
      body: p.body, dir: p.dir, food: p.food, score: p.score, alive: p.alive
    }, [
      { label: 'Score', value: String(p.score) },
      { label: 'Length', value: String(p.body.length) }
    ], 'Real 14×14 run · length ' + p.body.length + ' · food at r' + (p.food[0] + 1) + 'c' + (p.food[1] + 1),
    { ...ART[family], captionZh: '真实可复核的 14×14 贪吃蛇局面：蛇身 ' + p.body.length + ' 节连续无自交，食物在 r' + (p.food[0] + 1) + 'c' + (p.food[1] + 1) + '。' });
  }
  if (family === 'pong') {
    return base(family, { ai: true, speed: 1 }, {
      w: 100, h: 60,
      ball: { x: 62.5, y: 24, vx: 1.4, vy: -0.9 },
      left: { y: 30 }, right: { y: 22 }, score: [3, 2], over: false
    }, [
      { label: 'Score', value: '3 – 2' },
      { label: 'Rally', value: 'live' }
    ], 'Live rally · 100×60 court · score 3–2 · ball in play',
    { ...ART[family], captionZh: '真实可复核的乒乓球局面：100×60 球场，比分 3–2，球在界内，双方球拍都在合法范围内。' });
  }
  if (family === 'tictactoe') {
    const n = 3;
    const board = [1, 0, 2, 0, 1, 1, 0, 2, 2];
    return base(family, { n, ai: true }, { board, turn: 1 }, [
      { label: 'X', value: '3' },
      { label: 'O', value: '3' },
      { label: 'Turn', value: 'X' }
    ], 'Real 3×3 mid-game · 3 X · 3 O · no winner · X to move',
    { ...ART[family], captionZh: '真实可复核的 3×3 井字棋中局：X 与 O 各 3 子，无三连，轮到 X 落子。' });
  }
  if (family === 'hanoi') {
    const disks = 8;
    const pegs = [[8, 7, 6, 5], [4, 3], [2, 1]];
    return base(family, { disks }, { pegs, moves: 60, won: false }, [
      { label: 'Disks', value: String(disks) },
      { label: 'Moves', value: '60' }
    ], 'Legal 8-disk position · 60 moves · pegs 4 / 2 / 2',
    { ...ART[family], captionZh: '真实可复核的 8 盘汉诺塔局面：三根柱子分别有 4、2、2 枚盘，每根柱从上到下严格由小到大，未完成。' });
  }
  if (family === 'reaction') {
    return base(family, { mode: 'time', time: 20 }, {
      score: 24, hits: 24, misses: 3, timeLeft: 7, running: true, over: false,
      targets: [{ r: 2, c: 3 }]
    }, [
      { label: 'Score', value: '24' },
      { label: 'Hits', value: '24' },
      { label: 'Time', value: '7s' }
    ], 'Live 20 s round · 24 hits · 3 misses · 7 s left',
    { ...ART[family], captionZh: '真实可复核的反应挑战局面：20 秒回合还剩 7 秒，24 次命中、3 次未命中，目标落在 6×6 触控板内。' });
  }
  throw new Error('unknown family: ' + family);
}

const FAMILIES = Object.keys(ART);
const arg = process.argv[2];
if (arg === '--all') {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  for (const family of FAMILIES) {
    const file = path.join(STATE_DIR, family + '.json');
    fs.writeFileSync(file, JSON.stringify(stateFor(family), null, 2) + '\n');
    console.log('wrote ' + path.relative(process.cwd(), file));
  }
} else if (FAMILIES.includes(arg)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, arg + '.json');
  fs.writeFileSync(file, JSON.stringify(stateFor(arg), null, 2) + '\n');
  console.log('wrote ' + path.relative(process.cwd(), file));
} else {
  console.error('usage: node make-states.mjs <' + FAMILIES.join('|') + '|--all>');
  process.exit(1);
}
