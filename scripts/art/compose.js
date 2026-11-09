#!/usr/bin/env node
'use strict';

/**
 * Compose game art from transparent element PNGs and screenshot it with the
 * locally installed Chrome. No npm dependencies.
 *
 *   node scripts/art/compose.js --game chess
 *   node scripts/art/compose.js --all
 *   node scripts/art/compose.js --list
 *
 * See scripts/art/README.md for the scene format.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const ART_DIR = path.join(ROOT, 'games', 'assets', 'art');
const DEFAULT_ELEMENTS_DIR = path.join(ART_DIR, 'elements');
const DEFAULT_OUT_DIR = path.join(ART_DIR, 'composed');
const SCENES_FILE = path.join(__dirname, 'scenes.json');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
];

const PRESETS = new Set(['charcoal-warm', 'charcoal-cool', 'felt-green']);

const SIZES = [
  { suffix: 'og', width: 1200, height: 630 },
  { suffix: 'card', width: 480, height: 320 },
];

function usage() {
  return [
    'Usage:',
    '  node scripts/art/compose.js --game <slug>   render one scene',
    '  node scripts/art/compose.js --all           render every scene',
    '  node scripts/art/compose.js --sheet         render all + build composed/_sheet.png',
    '  node scripts/art/compose.js --list         list configured scenes',
    '',
    'Options:',
    '  --elements <dir>   element PNG dir (default games/assets/art/elements)',
    '  --out <dir>        output dir (default games/assets/art/composed)',
    '  --scenes <file>    alternate scenes file (for validation tests)',
    '',
    'Environment:',
    '  CHROME_PATH        override the Chrome executable path',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { game: null, all: false, list: false, sheet: false, elements: DEFAULT_ELEMENTS_DIR, out: DEFAULT_OUT_DIR, scenes: SCENES_FILE };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--game') {
      const v = argv[++i];
      if (!v) throw new Error('--game needs a value');
      opts.game = v;
    } else if (arg.startsWith('--game=')) {
      opts.game = arg.slice('--game='.length);
    } else if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--sheet') {
      opts.sheet = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--elements') {
      opts.elements = path.resolve(argv[++i] || '');
    } else if (arg.startsWith('--elements=')) {
      opts.elements = path.resolve(arg.slice('--elements='.length));
    } else if (arg === '--out') {
      opts.out = path.resolve(argv[++i] || '');
    } else if (arg.startsWith('--out=')) {
      opts.out = path.resolve(arg.slice('--out='.length));
    } else if (arg === '--scenes') {
      opts.scenes = path.resolve(argv[++i] || '');
    } else if (arg.startsWith('--scenes=')) {
      opts.scenes = path.resolve(arg.slice('--scenes='.length));
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function loadScenes(file = SCENES_FILE) {
  const raw = fs.readFileSync(file, 'utf8');
  let scenes;
  try {
    scenes = JSON.parse(raw);
  } catch (err) {
    throw new Error(`scenes.json is not valid JSON: ${err.message}`);
  }
  validateScenes(scenes);
  return scenes;
}

function validateScenes(scenes) {
  if (!scenes || typeof scenes !== 'object' || Array.isArray(scenes)) {
    throw new Error('scenes.json must be an object keyed by game slug');
  }
  for (const [slug, scene] of Object.entries(scenes)) {
    if (!scene || typeof scene !== 'object') throw new Error(`${slug}: scene must be an object`);
    if (!PRESETS.has(scene.background)) {
      throw new Error(`${slug}: background "${scene.background}" is not one of ${[...PRESETS].join(', ')}`);
    }
    const board = scene.board || 'none';
    if (!BOARD_TYPES.has(board)) {
      throw new Error(`${slug}: board "${board}" is not one of ${[...BOARD_TYPES].join(', ')}`);
    }
    if (!Array.isArray(scene.items) || scene.items.length === 0) {
      throw new Error(`${slug}: items must be a non-empty array`);
    }
    scene.items.forEach((item, idx) => {
      const at = `${slug}.items[${idx}]`;
      if (!item || typeof item !== 'object') throw new Error(`${at}: item must be an object`);
      const hasEl = typeof item.el === 'string' && item.el;
      const hasSrc = typeof item.src === 'string' && item.src;
      if (!hasEl && !hasSrc) throw new Error(`${at}: needs el or src`);
      if (hasEl && hasSrc) throw new Error(`${at}: el and src are mutually exclusive`);
      if ('scale' in item) throw new Error(`${at}: use realScale (default 1.0), not scale`);
      for (const key of ['x', 'y']) {
        if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) {
          throw new Error(`${at}: ${key} must be a finite number`);
        }
      }
      if (item.x < 0 || item.x > 1) throw new Error(`${at}: x must be within 0..1`);
      if (item.y < 0 || item.y > 1) throw new Error(`${at}: y must be within 0..1`);
      if (item.realScale !== undefined && (!Number.isFinite(item.realScale) || item.realScale <= 0)) {
        throw new Error(`${at}: realScale must be a positive number`);
      }
      if (item.stack !== undefined && (!Number.isInteger(item.stack) || item.stack < 1)) {
        throw new Error(`${at}: stack must be a positive integer`);
      }
      if (item.rot !== undefined && (typeof item.rot !== 'number' || !Number.isFinite(item.rot))) {
        throw new Error(`${at}: rot must be a finite number`);
      }
      if (item.shadow !== undefined && typeof item.shadow !== 'boolean') {
        throw new Error(`${at}: shadow must be a boolean`);
      }
      if (item.shape !== undefined && item.shape !== 'flat' && item.shape !== 'standing') {
        throw new Error(`${at}: shape must be flat or standing`);
      }
      if (item.cell !== undefined) {
        if (!item.cell || !Number.isInteger(item.cell.col) || !Number.isInteger(item.cell.row)) {
          throw new Error(`${at}: cell must have integer col/row`);
        }
      }
      if (item.role !== undefined && typeof item.role !== 'string') {
        throw new Error(`${at}: role must be a string`);
      }
    });
    if (scene.realism !== undefined) {
      const r = scene.realism;
      if (!r || typeof r !== 'object') throw new Error(`${slug}: realism must be an object`);
      if (r.pieceCount !== undefined && (!Number.isInteger(r.pieceCount) || r.pieceCount < 0)) {
        throw new Error(`${slug}: realism.pieceCount must be a non-negative integer`);
      }
      if (r.board !== undefined && r.board !== (scene.board || 'none')) {
        throw new Error(`${slug}: realism.board must match scene.board`);
      }
      if (r.mustTouchSurface !== undefined && typeof r.mustTouchSurface !== 'boolean') {
        throw new Error(`${slug}: realism.mustTouchSurface must be a boolean`);
      }
    }
  }
}

function itemName(item) {
  if (item.src) return path.basename(item.src).replace(/\.webp$/i, '');
  return item.el || '';
}

function itemCount(scene, predicate) {
  return scene.items
    .filter((item) => !['wall', 'dice', 'chip', 'accessory'].includes(item.role || '') && (!predicate || predicate(item)))
    .reduce((sum, item) => sum + (item.stack || 1), 0);
}

function validateRealism(slug, scene) {
  const errors = [];
  const r = scene.realism;
  if (!r) return errors;

  const count = itemCount(scene);
  if (r.pieceCount !== undefined && count !== r.pieceCount) {
    errors.push(`pieceCount: expected ${r.pieceCount}, found ${count}`);
  }
  if (r.board !== undefined && r.board !== (scene.board || 'none')) {
    errors.push(`board: expected ${r.board}, found ${scene.board || 'none'}`);
  }
  if (r.mustTouchSurface) {
    scene.items.forEach((item, i) => {
      if (!(item.x >= 0 && item.x <= 1 && item.y >= 0 && item.y <= 1)) {
        errors.push(`item ${i} (${itemName(item)}) is off the ${scene.board} surface`);
      }
    });
  }

  const cells = scene.items.filter((i) => i.cell);
  const requireCells = (minCol, maxCol, minRow, maxRow) => {
    for (const item of scene.items) {
      if (!item.cell) continue;
      const { col, row } = item.cell;
      if (col < minCol || col > maxCol || row < minRow || row > maxRow) {
        errors.push(`${itemName(item)} cell (${col},${row}) is outside the board`);
      }
    }
  };

  if (slug === 'chess') {
    const knights = scene.items.filter((i) => i.el === 'chess-knight-dark');
    if (knights.length > 1) errors.push(`same-colour knights: ${knights.length}`);
    const queens = scene.items.filter((i) => i.el === 'chess-queen-light');
    if (queens.length > 1) errors.push(`same-colour queens: ${queens.length}`);
    if (count !== 2) errors.push(`endgame close-up needs 2 pieces, found ${count}`);
    requireCells(0, 7, 0, 7);
  }

  if (slug === 'xiangqi') {
    const red = scene.items.filter((i) => itemName(i).startsWith('red-'));
    const black = scene.items.filter((i) => itemName(i).startsWith('black-'));
    if (red.length !== 16) errors.push(`red pieces: expected 16, found ${red.length}`);
    if (black.length !== 16) errors.push(`black pieces: expected 16, found ${black.length}`);
    const wantRed = { 'red-shuai': 1, 'red-shi': 2, 'red-xiang': 2, 'red-ma': 2, 'red-ju': 2, 'red-pao': 2, 'red-bing': 5 };
    const wantBlack = { 'black-jiang': 1, 'black-shi': 2, 'black-xiang': 2, 'black-ma': 2, 'black-ju': 2, 'black-pao': 2, 'black-zu': 5 };
    for (const [name, n] of Object.entries(wantRed)) {
      const found = red.filter((i) => itemName(i) === name).length;
      if (found !== n) errors.push(`${name}: expected ${n}, found ${found}`);
    }
    for (const [name, n] of Object.entries(wantBlack)) {
      const found = black.filter((i) => itemName(i) === name).length;
      if (found !== n) errors.push(`${name}: expected ${n}, found ${found}`);
    }
    requireCells(0, 8, 0, 9);
  }

  if (slug === 'go9') {
    const black = scene.items.filter((i) => i.el === 'go-stone-black').length;
    const white = scene.items.filter((i) => i.el === 'go-stone-white').length;
    if (count < 10 || count > 16) errors.push(`go stones: expected 10-16, found ${count}`);
    if (Math.abs(black - white) > 1) errors.push(`go colours differ by ${Math.abs(black - white)}`);
    requireCells(0, 8, 0, 8);
  }

  if (slug === 'mahjong') {
    const hand = scene.items.filter((i) => (i.role || 'hand') !== 'wall').length;
    const wall = scene.items.filter((i) => i.role === 'wall').length;
    if (hand !== 13) errors.push(`mahjong hand: expected 13, found ${hand}`);
    if (wall < 4) errors.push(`mahjong wall: expected at least 4 tiles, found ${wall}`);
  }

  if (slug === 'texas-holdem') {
    const pub = scene.items.filter((i) => i.role === 'public').length;
    const hole = scene.items.filter((i) => i.role === 'hole').length;
    if (pub !== 5) errors.push(`public cards: expected 5, found ${pub}`);
    if (hole !== 2) errors.push(`hole cards: expected 2, found ${hole}`);
    for (const item of scene.items.filter((i) => i.role === 'hole')) {
      if (item.el !== 'card-back-red') errors.push(`hole card ${itemName(item)} is not face down`);
    }
  }

  if (slug === 'doudizhu') {
    const hand = scene.items.filter((i) => (i.role || 'hand') !== 'wall').length;
    if (hand !== 17) errors.push(`doudizhu hand: expected 17, found ${hand}`);
  }

  if (slug === 'connect4') {
    if (count !== 16) errors.push(`connect4 discs: expected 16, found ${count}`);
    const byCol = new Map();
    for (const item of scene.items) {
      if (!item.cell) {
        errors.push(`${itemName(item)} has no column/row`);
        continue;
      }
      const { col, row } = item.cell;
      if (!byCol.has(col)) byCol.set(col, []);
      byCol.get(col).push(row);
    }
    for (const [col, rows] of byCol) {
      rows.sort((a, b) => b - a);
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] !== 5 - i) {
          errors.push(`column ${col} floats: rows ${rows.join(',')} instead of 5..${5 - rows.length + 1}`);
          break;
        }
      }
    }
    requireCells(0, 6, 0, 5);
  }

  if (slug === 'reversi') {
    if (count !== 4) errors.push(`reversi opening: expected 4 discs, found ${count}`);
    const black = scene.items.filter((i) => i.el === 'reversi-black').length;
    const white = scene.items.filter((i) => i.el === 'reversi-white').length;
    if (black !== 2 || white !== 2) errors.push(`reversi colours: ${black} black / ${white} white`);
    const central = new Set(['3,3', '4,4', '3,4', '4,3']);
    for (const item of scene.items) {
      if (!item.cell) {
        errors.push(`${itemName(item)} has no cell`);
        continue;
      }
      const key = `${item.cell.col},${item.cell.row}`;
      if (!central.has(key)) errors.push(`${itemName(item)} is not on a central cell (${key})`);
    }
    requireCells(0, 7, 0, 7);
  }

  if (slug === 'backgammon') {
    const bySide = new Map();
    for (const item of scene.items) {
      if (item.role === 'dice') continue;
      const side = item.side || 'dark';
      bySide.set(side, (bySide.get(side) || 0) + (item.stack || 1));
      if (!item.cell) errors.push(`${itemName(item)} is not on a point`);
    }
    const sizes = [...bySide.values()].sort((a, b) => a - b);
    if (!(sizes.includes(15) && sizes.some((n) => n >= 3 && n <= 5))) {
      errors.push(`backgammon men: expected one side 15 and the other 3-5, found ${sizes.join('/')}`);
    }
    requireCells(0, 11, 0, 1);
  }

  if (slug === 'checkers-jump') {
    if (count !== 24) errors.push(`checkers: expected 24, found ${count}`);
    const bySide = new Map();
    for (const item of scene.items) {
      const side = item.side || 'dark';
      bySide.set(side, (bySide.get(side) || 0) + (item.stack || 1));
      if (!item.cell) {
        errors.push(`${itemName(item)} has no cell`);
        continue;
      }
      if ((item.cell.col + item.cell.row) % 2 !== 1) {
        errors.push(`${itemName(item)} is on a light square (${item.cell.col},${item.cell.row})`);
      }
    }
    for (const [side, n] of bySide) {
      if (n !== 12) errors.push(`checkers ${side}: expected 12, found ${n}`);
    }
    requireCells(0, 7, 0, 7);
  }

  if (slug === 'aeroplane') {
    const planes = scene.items.filter((i) => i.el === 'airplane-token').length;
    const dice = scene.items.filter((i) => i.el === 'die').length;
    if (planes !== 4) errors.push(`aeroplane tokens: expected 4, found ${planes}`);
    if (dice !== 2) errors.push(`aeroplane dice: expected 2, found ${dice}`);
  }

  return errors;
}

function findChrome() {
  // An explicit CHROME_PATH is authoritative: if it is wrong, fail loudly
  // instead of silently using a different Chrome.
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : CHROME_CANDIDATES;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Chrome not found. Looked at:\n  ' +
      candidates.join('\n  ') +
      '\nInstall Google Chrome or set CHROME_PATH to its executable.'
  );
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * One shared tabletop camera. The CSS in template.html must mirror these
 * numbers: perspective 1600px, plane rotateX(52deg) rotateZ(-14deg).
 */
const CAMERA = {
  perspective: 1600,
  planeScale: 1.6,
  tiltX: 52,
  rollZ: -14,
  // Plane-local offset whose projection is roughly +10px/+10px down-right.
  shadowOffsetX: 6,
  shadowOffsetY: 18,
};

function planeSize(width, height) {
  return {
    PW: Math.round(width * CAMERA.planeScale),
    PH: Math.round(height * CAMERA.planeScale),
  };
}

/** Exact projection of a point on the table plane into screen coordinates. */
function projectToScreen(nx, ny, width, height) {
  const { PW, PH } = planeSize(width, height);
  return projectPlanePoint(nx * PW, ny * PH, width, height);
}

/** Same projection, but the input is already in plane-local pixels. */
function projectPlanePoint(px, py, width, height) {
  const { PW, PH } = planeSize(width, height);
  const u = px - PW / 2;
  const v = py - PH / 2;
  const rz = (CAMERA.rollZ * Math.PI) / 180;
  const rx = (CAMERA.tiltX * Math.PI) / 180;
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  const u1 = u * cz - v * sz;
  const v1 = u * sz + v * cz;
  const y2 = v1 * Math.cos(rx);
  const z2 = v1 * Math.sin(rx);
  const k = CAMERA.perspective / (CAMERA.perspective - z2);
  return { x: width / 2 + u1 * k, y: height / 2 + y2 * k, k };
}

/* ------------------------------------------------------------------ */
/* Board geometry                                                      */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Physical units: 1 script unit = 1 mm.                              */
/* Board pitches and object dimensions come from real-world specs.    */
/* ------------------------------------------------------------------ */

const BOARD_TYPES = new Set([
  'chess8',
  'go9',
  'xiangqi9x10',
  'reversi8',
  'connect4frame',
  'backgammon',
  'cardtable',
  'aeroplaneCross',
  'none',
]);

// Board box in millimetres (including any printed margin).
const BOARD_PHYS = {
  chess8: { w: 440, h: 440, kind: 'chess' },
  xiangqi9x10: { w: 270, h: 300, kind: 'xiangqi' },
  go9: { w: 200, h: 200, kind: 'go9' },
  reversi8: { w: 260, h: 260, kind: 'reversi' },
  connect4frame: { w: 280, h: 240, kind: 'connect4' },
  backgammon: { w: 600, h: 300, kind: 'backgammon' },
  cardtable: { w: 900, h: 900, kind: 'cardtable' },
  aeroplaneCross: { w: 500, h: 500, kind: 'aeroplane' },
  none: null,
};

const BOARD_LABEL = {
  chess8: '8x8x55mm',
  xiangqi9x10: 'grid 240x270mm, pitch 30mm',
  go9: 'grid 176x176mm, pitch 22mm',
  reversi8: 'grid 240x240mm, pitch 30mm',
  connect4frame: '7x6 holes, pitch 40mm',
  backgammon: '24 points, pitch 50mm',
  cardtable: '900x900mm table',
  aeroplaneCross: '500x500mm cross track',
  none: '400x400mm reference',
};

const BOARD_LINE = 'rgba(245,238,220,0.20)';
const BOARD_LINE_PX = 1.5;

// Real face sizes for the generated deck WebPs.
const DECK_PHYS = {
  poker: { w: 63, h: 88 },
  mahjong: { w: 30, h: 40 },
  xiangqi: { w: 28, h: (28 * 300) / 256, rw: 1, rh: 256 / 300 },
};

// Real object sizes. `main` is the visible dimension in mm; rw/rh are the
// alpha-bbox fractions measured from the element canvases.
const ELEMENT_PHYS = {
  'chess-queen-light': { main: 100, mode: 'height' },
  'chess-knight-dark': { main: 80, mode: 'height' },
  'go-stone-black': { main: 20, mode: 'width' },
  'go-stone-white': { main: 20, mode: 'width' },
  'reversi-black': { main: 28, mode: 'width' },
  'reversi-white': { main: 28, mode: 'width' },
  'connect4-red': { main: 33, mode: 'width' },
  'connect4-yellow': { main: 33, mode: 'width' },
  'checker-dark': { main: 30, mode: 'width' },
  'chip-red': { main: 39, mode: 'width' },
  'chip-black': { main: 39, mode: 'width' },
  die: { main: 16, mode: 'width' },
  'airplane-token': { main: 25, mode: 'width' },
  'card-back-red': { main: 88, mode: 'height' },
  'card-face-blank': { main: 88, mode: 'height' },
  'mahjong-back': { main: 40, mode: 'height' },
  'mahjong-face-wan': { main: 40, mode: 'height' },
  'lantern-spirit': { main: 80, mode: 'height' },
};

const BBOX_CACHE = new Map();

function isPng(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(8);
    const n = fs.readSync(fd, head, 0, 8, 0);
    fs.closeSync(fd);
    return n === 8 && head.toString('hex') === '89504e470d0a1a0a';
  } catch {
    return false;
  }
}

/** Minimal 8-bit PNG alpha-bbox decoder (non-interlaced). */
function pngAlphaBBox(file) {
  if (BBOX_CACHE.has(file)) return BBOX_CACHE.get(file);
  if (!isPng(file)) {
    BBOX_CACHE.set(file, null);
    return null;
  }
  const buf = fs.readFileSync(file);
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) break;
    if (type === 'IHDR') {
      ihdr = {
        width: buf.readUInt32BE(dataStart),
        height: buf.readUInt32BE(dataStart + 4),
        bitDepth: buf[dataStart + 8],
        colorType: buf[dataStart + 9],
        interlace: buf[dataStart + 12],
      };
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!ihdr || !idat.length) {
    BBOX_CACHE.set(file, null);
    return null;
  }
  if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0) {
    BBOX_CACHE.set(file, null);
    return null;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) {
    BBOX_CACHE.set(file, null);
    return null;
  }
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    BBOX_CACHE.set(file, null);
    return null;
  }
  const stride = ihdr.width * channels;
  if (raw.length < (stride + 1) * ihdr.height) {
    BBOX_CACHE.set(file, null);
    return null;
  }
  const out = Buffer.alloc(stride * ihdr.height);
  let pos = 0;
  for (let y = 0; y < ihdr.height; y++) {
    const filter = raw[pos++];
    const row = y * stride;
    const prev = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[pos++];
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = y > 0 && x >= channels ? out[prev + x - channels] : 0;
      let value;
      switch (filter) {
        case 0: value = v; break;
        case 1: value = v + a; break;
        case 2: value = v + b; break;
        case 3: value = v + ((a + b) >> 1); break;
        case 4: {
          const pr = a + b - c;
          const pa = Math.abs(pr - a);
          const pb = Math.abs(pr - b);
          const pc = Math.abs(pr - c);
          value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          BBOX_CACHE.set(file, null);
          return null;
      }
      out[row + x] = value & 0xff;
    }
  }
  let minX = ihdr.width;
  let minY = ihdr.height;
  let maxX = -1;
  let maxY = -1;
  const alphaOffset = channels === 4 ? 3 : channels === 2 ? 1 : -1;
  for (let y = 0; y < ihdr.height; y++) {
    for (let x = 0; x < ihdr.width; x++) {
      const base = y * stride + x * channels;
      const alpha = alphaOffset === -1 ? 255 : out[base + alphaOffset];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = maxX >= 0
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, width: ihdr.width, height: ihdr.height }
    : null;
  BBOX_CACHE.set(file, bbox);
  return bbox;
}

function itemPhysMm(item, elementsDir) {
  if (item.src) {
    const set = item.src.split('/')[1];
    const spec = DECK_PHYS[set];
    if (!spec) throw new Error(`unknown deck set in src: ${item.src}`);
    return { w: spec.w, h: spec.h, rw: spec.rw, rh: spec.rh, deck: true };
  }
  const spec = ELEMENT_PHYS[item.el];
  if (!spec) throw new Error(`no physical size for element: ${item.el}`);
  const file = path.join(elementsDir, `${item.el}@2x.png`);
  const bbox = pngAlphaBBox(file);
  const rw = bbox ? bbox.w / bbox.width : 0.84;
  const rh = bbox ? bbox.h / bbox.height : 0.84;
  if (spec.mode === 'height') {
    const box = spec.main / rh;
    return { w: box, h: box, rw, rh };
  }
  const box = spec.main / rw;
  return { w: box, h: box, rw, rh };
}

/** Global px-per-mm for a scene: board/table projects to ~90% frame width. */
function sceneScale(scene, width, height) {
  const type = scene.board || 'none';
  const phys = BOARD_PHYS[type] || { w: 400, h: 400 };
  const { PW, PH } = planeSize(width, height);
  // Largest global scale that keeps the whole board/table inside the frame.
  const mx = 0.04 * width;
  const my = 0.04 * height;
  let lo = 0.01;
  let hi = 50;
  for (let i = 0; i < 45; i++) {
    const k = (lo + hi) / 2;
    const w = phys.w * k;
    const h = phys.h * k;
    const left = (PW - w) / 2;
    const top = (PH - h) / 2;
    const pts = [
      [left, top],
      [left + w, top],
      [left + w, top + h],
      [left, top + h],
    ].map(([px, py]) => projectPlanePoint(px, py, width, height));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const fits =
      Math.min(...xs) >= mx &&
      Math.max(...xs) <= width - mx &&
      Math.min(...ys) >= my &&
      Math.max(...ys) <= height - my;
    if (fits) lo = k;
    else hi = k;
  }
  return lo;
}

function boardRect(scene, width, height, k) {
  const type = scene.board || 'none';
  const phys = BOARD_PHYS[type];
  if (!phys) return null;
  const { PW, PH } = planeSize(width, height);
  const w = phys.w * k;
  const h = phys.h * k;
  return { left: (PW - w) / 2, top: (PH - h) / 2, w, h, PW, PH, k, phys };
}

function itemPlanePos(item, scene, width, height, k) {
  const rect = boardRect(scene, width, height, k);
  if (rect) return { x: rect.left + item.x * rect.w, y: rect.top + item.y * rect.h };
  const { PW, PH } = planeSize(width, height);
  return { x: item.x * PW, y: item.y * PH };
}

function itemDimsPx(item, k, elementsDir) {
  const mm = itemPhysMm(item, elementsDir);
  const rs = item.realScale === undefined ? 1 : item.realScale;
  return {
    w: mm.w * rs * k,
    h: mm.h * rs * k,
    visW: mm.w * mm.rw * rs * k,
    visH: mm.h * mm.rh * rs * k,
    mm,
  };
}

function resolveItemFile(item, elementsDir) {
  if (item.src) return path.join(ART_DIR, item.src);
  return path.join(elementsDir, `${item.el}@2x.png`);
}

function itemLabel(item) {
  if (item.el) return item.el;
  return path.basename(item.src || '').replace(/\.(webp|png)$/i, '');
}

function svgBoard(viewW, viewH, k, body) {
  return (
    `<svg viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="none" ` +
    `xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  );
}

function boardSvg(type, k) {
  const sw = BOARD_LINE_PX / k;
  const stroke = `stroke="${BOARD_LINE}" stroke-width="${sw}" fill="none"`;

  if (type === 'chess8') {
    const cell = 55;
    const size = 440;
    const rects = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const fill = (r + c) % 2 === 0 ? '#f2e4c8' : '#080604';
        rects.push(
          `<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`
        );
      }
    }
    return svgBoard(
      size,
      size,
      k,
      `<g opacity="0.35">${rects.join('')}</g>` +
        `<rect x="0" y="0" width="${size}" height="${size}" ${stroke}/>`
    );
  }

  if (type === 'reversi8') {
    const m = 10;
    const step = 30;
    const lines = [];
    for (let i = 0; i <= 8; i++) {
      const p = m + i * step;
      lines.push(`<line x1="${p}" y1="${m}" x2="${p}" y2="${m + 240}" ${stroke}/>`);
      lines.push(`<line x1="${m}" y1="${p}" x2="${m + 240}" y2="${p}" ${stroke}/>`);
    }
    return svgBoard(260, 260, k, lines.join(''));
  }

  if (type === 'go9') {
    const m = 12;
    const step = 22;
    const lines = [];
    for (let i = 0; i <= 8; i++) {
      const p = m + i * step;
      lines.push(`<line x1="${p}" y1="${m}" x2="${p}" y2="${m + 176}" ${stroke}/>`);
      lines.push(`<line x1="${m}" y1="${p}" x2="${m + 176}" y2="${p}" ${stroke}/>`);
    }
    const stars = [];
    for (const [c, r] of [[2, 2], [2, 6], [6, 2], [6, 6], [4, 4]]) {
      stars.push(
        `<circle cx="${m + c * step}" cy="${m + r * step}" r="3" fill="${BOARD_LINE}"/>`
      );
    }
    return svgBoard(200, 200, k, lines.join('') + stars.join(''));
  }

  if (type === 'xiangqi9x10') {
    const mx = 15;
    const my = 15;
    const step = 30;
    const parts = [];
    for (let j = 0; j <= 9; j++) {
      const y = my + j * step;
      parts.push(`<line x1="${mx}" y1="${y}" x2="${mx + 8 * step}" y2="${y}" ${stroke}/>`);
    }
    for (let i = 0; i <= 8; i++) {
      const x = mx + i * step;
      if (i === 0 || i === 8) {
        parts.push(`<line x1="${x}" y1="${my}" x2="${x}" y2="${my + 9 * step}" ${stroke}/>`);
      } else {
        parts.push(`<line x1="${x}" y1="${my}" x2="${x}" y2="${my + 4 * step}" ${stroke}/>`);
        parts.push(
          `<line x1="${x}" y1="${my + 5 * step}" x2="${x}" y2="${my + 9 * step}" ${stroke}/>`
        );
      }
    }
    const px0 = mx + 3 * step;
    const px1 = mx + 5 * step;
    const top0 = my;
    const top1 = my + 2 * step;
    const bot0 = my + 7 * step;
    const bot1 = my + 9 * step;
    parts.push(`<line x1="${px0}" y1="${top0}" x2="${px1}" y2="${top1}" ${stroke}/>`);
    parts.push(`<line x1="${px1}" y1="${top0}" x2="${px0}" y2="${top1}" ${stroke}/>`);
    parts.push(`<line x1="${px0}" y1="${bot0}" x2="${px1}" y2="${bot1}" ${stroke}/>`);
    parts.push(`<line x1="${px1}" y1="${bot0}" x2="${px0}" y2="${bot1}" ${stroke}/>`);
    return svgBoard(270, 300, k, parts.join(''));
  }

  if (type === 'connect4frame') {
    const m = 20;
    const pitch = 40;
    const cols = 7;
    const rows = 6;
    const parts = [];
    parts.push(
      `<rect x="2" y="2" width="276" height="236" rx="6" ` +
        `fill="rgba(0,0,0,0.16)" ${stroke}/>`
    );
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = m + c * pitch;
        const cy = m + r * pitch;
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="18" fill="rgba(0,0,0,0.38)" ` +
            `stroke="${BOARD_LINE}" stroke-width="${sw}"/>`
        );
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="15" fill="none" ` +
            `stroke="rgba(255,245,228,0.055)" stroke-width="${0.8 / k}"/>`
        );
      }
    }
    return svgBoard(280, 240, k, parts.join(''));
  }

  if (type === 'backgammon') {
    const m = 10;
    const barW = 20;
    const leftEnd = 290;
    const rightStart = 310;
    const pointW = 280 / 6;
    const parts = [];
    const tri = (x0, x1, base, tip, fill) =>
      `<path d="M${x0} ${base} L${x1} ${base} L${(x0 + x1) / 2} ${tip} Z" ` +
      `fill="${fill}" ${stroke}/>`;
    for (let i = 0; i < 6; i++) {
      const fill = i % 2 === 0 ? 'rgba(255,245,228,0.055)' : 'rgba(0,0,0,0.12)';
      const lx0 = m + i * pointW;
      const lx1 = lx0 + pointW;
      const rx0 = rightStart + i * pointW;
      const rx1 = rx0 + pointW;
      parts.push(tri(lx0, lx1, 10, 150, fill));
      parts.push(tri(rx0, rx1, 10, 150, fill));
      parts.push(tri(lx0, lx1, 290, 150, fill));
      parts.push(tri(rx0, rx1, 290, 150, fill));
    }
    parts.push(
      `<rect x="${leftEnd}" y="10" width="${barW}" height="280" ` +
        `fill="rgba(0,0,0,0.18)" ${stroke}/>`
    );
    parts.push(`<rect x="10" y="10" width="580" height="280" ${stroke}/>`);
    return svgBoard(600, 300, k, parts.join(''));
  }

  if (type === 'aeroplaneCross') {
    const parts = [];
    // plus-shaped track, touching the four frame edges
    parts.push(
      `<path d="M0 200 H200 V0 H300 V200 H500 V300 H300 V500 H200 V300 H0 Z" ` +
        `fill="rgba(255,255,255,0.035)" ${stroke}/>`
    );
    parts.push(`<line x1="250" y1="0" x2="250" y2="500" ${stroke}/>`);
    parts.push(`<line x1="0" y1="250" x2="500" y2="250" ${stroke}/>`);
    for (const [x, y] of [[60, 60], [380, 60], [60, 380], [380, 380]]) {
      parts.push(
        `<rect x="${x}" y="${y}" width="60" height="60" rx="14" ` +
          `fill="rgba(255,255,255,0.045)" ${stroke}/>`
      );
    }
    return svgBoard(500, 500, k, parts.join(''));
  }

  throw new Error(`unknown board type: ${type}`);
}

function buildBoard(type, width, height, k) {
  if (!type || type === 'none') return '';
  if (!BOARD_TYPES.has(type)) throw new Error(`unknown board type: ${type}`);

  const { PW, PH } = planeSize(width, height);
  const phys = BOARD_PHYS[type];
  const w = phys.w * k;
  const h = phys.h * k;
  const left = (PW - w) / 2;
  const top = (PH - h) / 2;

  if (type === 'cardtable') {
    return (
      `<div class="board board--cardtable" style="left:${round(left)}px;` +
      `top:${round(top)}px;width:${round(w)}px;height:${round(h)}px"></div>`
    );
  }

  return (
    `<div class="board" style="left:${round(left)}px;top:${round(top)}px;` +
    `width:${round(w)}px;height:${round(h)}px">${boardSvg(type, k)}</div>`
  );
}

function shadowDims(dims, shape) {
  if (shape === 'standing') return [dims.visW * 0.90, dims.visW * 0.22];
  return [dims.visW * 1.06, dims.visH * 1.06];
}

function shadowHtml(item, shape, dims, cx, cy, rot) {
  const [w, h] = shadowDims(dims, shape);
  const left = cx + CAMERA.shadowOffsetX - w / 2;
  const top = cy + CAMERA.shadowOffsetY - h / 2;
  const transform = shape === 'flat' ? `transform:rotate(${round(rot)}deg);` : '';
  return (
    `<div class="shadow" style="left:${round(left)}px;top:${round(top)}px;` +
    `width:${round(w)}px;height:${round(h)}px;${transform}"></div>`
  );
}

/* ------------------------------------------------------------------ */
/* Overlap guard                                                       */
/* ------------------------------------------------------------------ */

function isCardItem(item) {
  return (item.src && item.src.includes('/poker/')) || (item.el || '').startsWith('card-');
}

function isRoundItem(item) {
  if (item.src && item.src.includes('/xiangqi/')) return true;
  return /^(go-stone|reversi|connect4|checker|chip|xiangqi-)/.test(item.el || '');
}

function projectedVisibleBox(item, scene, width, height, k, dims) {
  const pos = itemPlanePos(item, scene, width, height, k);
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  let local;
  if (isRoundItem(item)) {
    local = [];
    const steps = 48;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      local.push([(Math.cos(a) * dims.visW) / 2, (Math.sin(a) * dims.visH) / 2]);
    }
  } else {
    local = [
      [-dims.visW / 2, -dims.visH / 2],
      [dims.visW / 2, -dims.visH / 2],
      [dims.visW / 2, dims.visH / 2],
      [-dims.visW / 2, dims.visH / 2],
    ];
  }
  const pts = local.map(([dx, dy]) => {
    const px = pos.x + dx * cos - dy * sin;
    const py = pos.y + dx * sin + dy * cos;
    return projectPlanePoint(px, py, width, height);
  });
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function overlapWarnings(slug, scene, width, height, k, elementsDir) {
  const flats = [];
  scene.items.forEach((item, index) => {
    if ((item.shape || 'flat') === 'flat') {
      const dims = itemDimsPx(item, k, elementsDir);
      flats.push({
        item,
        index,
        box: projectedVisibleBox(item, scene, width, height, k, dims),
      });
    }
  });

  const out = [];
  for (let i = 0; i < flats.length; i++) {
    for (let j = i + 1; j < flats.length; j++) {
      const a = flats[i];
      const b = flats[j];
      const ow = Math.min(a.box.maxX, b.box.maxX) - Math.max(a.box.minX, b.box.minX);
      const oh = Math.min(a.box.maxY, b.box.maxY) - Math.max(a.box.minY, b.box.minY);
      if (ow <= 0 || oh <= 0) continue;
      const areaA = (a.box.maxX - a.box.minX) * (a.box.maxY - a.box.minY);
      const areaB = (b.box.maxX - b.box.minX) * (b.box.maxY - b.box.minY);
      const ratio = (ow * oh) / Math.min(areaA, areaB);
      const cardScene = slug === 'texas-holdem' || slug === 'doudizhu';
      const bothCards = isCardItem(a.item) && isCardItem(b.item);
      const limit = cardScene && bothCards ? 0.45 : 0.12;
      if (ratio > limit + 1e-9) {
        out.push({
          a: `${itemLabel(a.item)}[${a.index}]`,
          b: `${itemLabel(b.item)}[${b.index}]`,
          ratio,
          limit,
        });
      }
    }
  }
  return out;
}

function renderFlat(item, dims, pos, rot, src) {
  const stack = item.stack || 1;
  const stepMm = item.stackStep || 3;
  const step = stepMm * (dims.w / Math.max(0.001, dims.mm.w));
  const baseFilter = item.filter ? `${item.filter} ` : '';
  const imgs = [];
  for (let layer = 0; layer < stack; layer++) {
    const shade = Math.max(0.4, 1 - layer * 0.12);
    imgs.push(
      `<img src="${escapeHtml(src)}" alt="" style="position:absolute;left:0;` +
        `top:${round(-layer * step)}px;width:100%;height:100%;object-fit:contain;` +
        `filter:${baseFilter}brightness(${shade})">`
    );
  }
  return (
    `<div class="flat" style="left:${round(pos.x - dims.w / 2)}px;` +
    `top:${round(pos.y - dims.h / 2)}px;width:${round(dims.w)}px;height:${round(dims.h)}px;` +
    `transform:rotate(${round(rot)}deg)">${imgs.join('')}</div>`
  );
}

function buildItems(scene, width, height, elementsDir, missing, k) {
  const shadows = [];
  const flats = [];
  const billboards = [];

  for (const item of scene.items) {
    const shape = item.shape === 'standing' ? 'standing' : 'flat';
    const rot = item.rot || 0;
    const wantShadow = item.shadow !== false;
    const pos = itemPlanePos(item, scene, width, height, k);
    const dims = itemDimsPx(item, k, elementsDir);
    const file = resolveItemFile(item, elementsDir);
    const present = fs.existsSync(file);
    const label = itemLabel(item);

    if (present) {
      const src = pathToFileURL(file).href;

      if (shape === 'standing') {
        const p = projectPlanePoint(pos.x, pos.y, width, height);
        const box = dims.w * p.k;
        if (wantShadow) shadows.push(shadowHtml(item, shape, dims, pos.x, pos.y, rot));
        billboards.push(
          `<div class="billboard" style="left:${round(p.x)}px;top:${round(p.y)}px;` +
            `width:${round(box)}px;height:${round(box)}px;` +
            `transform:translate(-50%, -92%) rotate(${round(rot)}deg)">` +
            `<img src="${escapeHtml(src)}" alt=""${item.filter ? ` style="filter:${item.filter}"` : ''}></div>`
        );
      } else {
        if (wantShadow) shadows.push(shadowHtml(item, shape, dims, pos.x, pos.y, rot));
        flats.push(renderFlat(item, dims, pos, rot, src));
      }
    } else {
      missing.add(label);
      if (shape === 'standing') {
        const p = projectPlanePoint(pos.x, pos.y, width, height);
        const box = dims.w * p.k;
        const fontSize = round(Math.max(9, Math.min(18, box * 0.07)));
        billboards.push(
          `<div class="billboard" style="left:${round(p.x)}px;top:${round(p.y)}px;` +
            `width:${round(box)}px;height:${round(box)}px;` +
            `transform:translate(-50%, -92%) rotate(${round(rot)}deg)">` +
            `<div class="ph" style="font-size:${fontSize}px">` +
            `<span>${escapeHtml(label)}</span></div></div>`
        );
      } else {
        const fontSize = round(Math.max(9, Math.min(18, dims.w * 0.07)));
        flats.push(
          `<div class="flat" style="left:${round(pos.x - dims.w / 2)}px;` +
            `top:${round(pos.y - dims.h / 2)}px;width:${round(dims.w)}px;height:${round(dims.h)}px;` +
            `transform:rotate(${round(rot)}deg)">` +
            `<div class="ph" style="font-size:${fontSize}px">` +
            `<span>${escapeHtml(label)}</span></div></div>`
        );
      }
    }
  }

  return {
    shadows: shadows.join('\n    '),
    flats: flats.join('\n    '),
    billboards: billboards.join('\n    '),
  };
}

function buildHtml(scene, background, layers, width, height, k) {
  const { PW, PH } = planeSize(width, height);
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  return template
    .replace(/\{\{BACKGROUND\}\}/g, background)
    .replace(/\{\{WIDTH\}\}/g, String(width))
    .replace(/\{\{HEIGHT\}\}/g, String(height))
    .replace(/\{\{PW\}\}/g, String(PW))
    .replace(/\{\{PH\}\}/g, String(PH))
    .replace(/\{\{PWH\}\}/g, String(PW / 2))
    .replace(/\{\{PHH\}\}/g, String(PH / 2))
    .replace(/\{\{W\}\}/g, String(width))
    .replace(/\{\{H\}\}/g, String(height))
    .replace('{{SHADOWS}}', layers.shadows)
    .replace('{{FLATS}}', layers.flats)
    .replace('{{BILLBOARDS}}', layers.billboards)
    .replace('{{BOARD}}', buildBoard(scene.board || 'none', width, height, k));
}

function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    if (head.toString('ascii', 1, 4) !== 'PNG') throw new Error('not a PNG');
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } finally {
    fs.closeSync(fd);
  }
}

function screenshot(chrome, htmlPath, outPath, width, height, profileDir) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=1500',
    `--user-data-dir=${profileDir}`,
    `--window-size=${width},${height}`,
    `--screenshot=${outPath}`,
    pathToFileURL(htmlPath).href,
  ];

  try {
    execFileSync(chrome, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : '';
    throw new Error(`Chrome failed for ${path.basename(outPath)}${stderr ? `:\n${stderr}` : ''}`);
  }

  if (!fs.existsSync(outPath)) throw new Error(`Chrome wrote no screenshot to ${outPath}`);
  const actual = pngSize(outPath);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(
      `${path.basename(outPath)} is ${actual.width}x${actual.height}, expected ${width}x${height}`
    );
  }
  return fs.statSync(outPath).size;
}

function renderScene(slug, scene, opts, chrome) {
  const missing = new Set();
  const overlaps = [];
  fs.mkdirSync(opts.out, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-compose-'));
  const profileDir = path.join(tmpDir, 'chrome-profile');
  const results = [];

  try {
    for (const { suffix, width, height } of SIZES) {
      const k = sceneScale(scene, width, height);
      const layers = buildItems(scene, width, height, opts.elements, missing, k);
      const html = buildHtml(scene, scene.background, layers, width, height, k);
      const htmlPath = path.join(tmpDir, `${slug}-${suffix}.html`);
      fs.writeFileSync(htmlPath, html);

      for (const warning of overlapWarnings(slug, scene, width, height, k, opts.elements)) {
        overlaps.push({ ...warning, size: suffix });
      }

      const outPath = path.join(opts.out, `${slug}-${suffix}.png`);
      const bytes = screenshot(chrome, htmlPath, outPath, width, height, profileDir);
      results.push({ file: outPath, width, height, bytes });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { results, missing: [...missing], overlaps };
}

function rel(file) {
  const relative = path.relative(ROOT, file);
  return relative && !relative.startsWith('..') ? relative : file;
}

const SHEET = {
  width: 2400,
  columns: 3,
  margin: 48,
  gap: 24,
  captionGap: 12,
  captionHeight: 46,
  labelSize: 30,
};

function buildSheetHtml(slugs, outDir) {
  const cellW = (SHEET.width - SHEET.margin * 2 - SHEET.gap * (SHEET.columns - 1)) / SHEET.columns;
  const cellH = Math.round((cellW * 630) / 1200);
  const rows = Math.max(1, Math.ceil(slugs.length / SHEET.columns));
  const rowStride = cellH + SHEET.captionGap + SHEET.captionHeight + SHEET.gap;
  const height = SHEET.margin * 2 + rows * rowStride - SHEET.gap;
  const colStride = cellW + SHEET.gap;

  const cells = slugs.map((slug, index) => {
    const row = Math.floor(index / SHEET.columns);
    const col = index % SHEET.columns;
    const left = SHEET.margin + col * colStride;
    const top = SHEET.margin + row * rowStride;
    // Inline the composed OG PNG so the screenshot never races file I/O while
    // twelve large <img> elements are still being fetched/decoded.
    const png = fs.readFileSync(path.join(outDir, `${slug}-og.png`));
    const src = `data:image/png;base64,${png.toString('base64')}`;
    return (
      `<div class="cell" style="left:${round(left)}px;top:${round(top)}px;width:${round(cellW)}px">` +
      `<div class="frame" style="height:${cellH}px">` +
      `<img src="${escapeHtml(src)}" alt="">` +
      `</div>` +
      `<div class="label">${escapeHtml(slug)}</div>` +
      `</div>`
    );
  });

  const css = `
  html, body {
    margin: 0;
    padding: 0;
    width: ${SHEET.width}px;
    height: ${height}px;
    overflow: hidden;
    background: #141414;
  }
  .sheet {
    position: relative;
    width: ${SHEET.width}px;
    height: ${height}px;
    background: #141414;
  }
  .cell { position: absolute; }
  .frame {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.10);
    background: #1d1d1d;
    overflow: hidden;
  }
  .frame img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .label {
    height: ${SHEET.captionHeight}px;
    line-height: ${SHEET.captionHeight}px;
    margin-top: ${SHEET.captionGap}px;
    text-align: center;
    font-family: ui-sans-serif, -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: ${SHEET.labelSize}px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #e9e2d4;
  }`;

  return (
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>composed art sheet</title>\n' +
    `<style>${css}\n  </style>\n</head>\n<body>\n<div class="sheet">\n  ${cells.join('\n  ')}\n</div>\n</body>\n</html>\n`
  );
}

function renderSheet(chrome, slugs, outDir, outPath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-sheet-'));
  const profileDir = path.join(tmpDir, 'chrome-profile');
  try {
    const htmlPath = path.join(tmpDir, 'sheet.html');
    fs.writeFileSync(htmlPath, buildSheetHtml(slugs, outDir));
    const cellW = (SHEET.width - SHEET.margin * 2 - SHEET.gap * (SHEET.columns - 1)) / SHEET.columns;
    const cellH = Math.round((cellW * 630) / 1200);
    const rows = Math.max(1, Math.ceil(slugs.length / SHEET.columns));
    const height = SHEET.margin * 2 + rows * (cellH + SHEET.captionGap + SHEET.captionHeight + SHEET.gap) - SHEET.gap;
    const bytes = screenshot(chrome, htmlPath, outPath, SHEET.width, height, profileDir);
    return { bytes, width: SHEET.width, height };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`compose: ${err.message}\n\n${usage()}`);
    process.exit(2);
  }

  if (opts.help) {
    console.log(usage());
    return;
  }

  let scenes;
  try {
    scenes = loadScenes(opts.scenes);
  } catch (err) {
    console.error(`compose: ${err.message}`);
    process.exit(2);
  }

  const slugs = Object.keys(scenes);

  if (opts.list) {
    console.log(`Configured scenes (${slugs.length}):`);
    for (const slug of slugs) {
      const scene = scenes[slug];
      const missing = [...new Set(scene.items.map((i) => itemLabel(i)))].filter(
        (label) => {
          const item = scene.items.find((i) => itemLabel(i) === label);
          return !fs.existsSync(resolveItemFile(item, opts.elements));
        }
      );
      const status = missing.length ? `missing ${missing.length}: ${missing.join(', ')}` : 'all elements present';
      console.log(
        `  ${slug.padEnd(14)} ${String(scene.items.length).padStart(2)} items  ${scene.background.padEnd(14)} ${status}`
      );
    }
    return;
  }

  const targets = opts.sheet ? slugs : opts.all ? slugs : opts.game ? [opts.game] : null;
  if (!targets) {
    console.error(`compose: pick --game <slug>, --all, --sheet or --list\n\n${usage()}`);
    process.exit(2);
  }
  for (const slug of opts.game ? [opts.game] : targets) {
    if (!scenes[slug]) {
      console.error(`compose: no scene for "${slug}". Configured: ${slugs.join(', ')}`);
      process.exit(2);
    }
  }

  const realismFailures = [];
  const validationTargets = opts.sheet ? slugs : targets;
  for (const slug of validationTargets) {
    for (const reason of validateRealism(slug, scenes[slug])) {
      realismFailures.push(`${slug}: ${reason}`);
    }
  }
  if (realismFailures.length) {
    console.error(`REALISM FAIL (${realismFailures.length}) — refusing to render:`);
    for (const line of realismFailures) console.error(`  - ${line}`);
    process.exit(3);
  }

  for (const slug of validationTargets) {
    const scene = scenes[slug];
    const phys = BOARD_PHYS[scene.board || 'none'] || { w: 400, h: 400 };
    const parts = SIZES.map(({ suffix, width, height }) =>
      `${suffix} k=${sceneScale(scene, width, height).toFixed(3)}px/mm`
    );
    console.log(
      `[scale] ${slug.padEnd(14)} board=${phys.w}x${phys.h}mm (${BOARD_LABEL[scene.board || 'none']})  ${parts.join('  ')}`
    );
  }

  const chrome = findChrome();
  const allMissing = new Map();
  const allOverlaps = new Map();

  for (const slug of targets) {
    const { results, missing, overlaps } = renderScene(slug, scenes[slug], opts, chrome);
    for (const file of missing) {
      if (!allMissing.has(file)) allMissing.set(file, new Set());
      allMissing.get(file).add(slug);
    }
    for (const warning of overlaps) {
      const key = `${slug}|${warning.a}|${warning.b}`;
      const previous = allOverlaps.get(key);
      if (!previous || warning.ratio > previous.ratio) {
        allOverlaps.set(key, { slug, ...warning });
      }
    }
    for (const r of results) {
      console.log(`[compose] ${slug.padEnd(14)} ${rel(r.file)}  ${r.width}x${r.height}  ${r.bytes} B`);
    }
  }

  if (opts.sheet) {
    const sheetPath = path.join(opts.out, '_sheet.png');
    const info = renderSheet(chrome, slugs, opts.out, sheetPath);
    console.log(`[compose] ${'sheet'.padEnd(14)} ${rel(sheetPath)}  ${info.width}x${info.height}  ${info.bytes} B`);
  }

  if (allOverlaps.size) {
    console.log('');
    console.log(`[compose] OVERLAP WARNINGS (${allOverlaps.size}) — flat bounding boxes over the limit:`);
    const rows = [...allOverlaps.values()].sort((x, y) =>
      x.slug === y.slug ? x.a.localeCompare(y.a) || x.b.localeCompare(y.b) : x.slug.localeCompare(y.slug)
    );
    for (const w of rows) {
      console.log(
        `  - ${w.slug}: ${w.a} x ${w.b} = ${(w.ratio * 100).toFixed(1)}% ` +
          `of smaller (limit ${(w.limit * 100).toFixed(0)}%) [${w.size}]`
      );
    }
  }

  if (allMissing.size) {
    console.log('');
    console.log(`[compose] MISSING ELEMENTS (${allMissing.size}) — drew labelled placeholders:`);
    for (const [el, usedBy] of [...allMissing.entries()].sort()) {
      console.log(`  - ${el}@2x.png  (used by: ${[...usedBy].join(', ')})`);
    }
    console.log('[compose] degraded render finished; no ENOENT / no crash.');
  }
}

try {
  main();
} catch (err) {
  console.error(`compose: ${err.message}`);
  process.exit(1);
}
