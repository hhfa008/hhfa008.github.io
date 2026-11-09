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
    '',
    'Environment:',
    '  CHROME_PATH        override the Chrome executable path',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { game: null, all: false, list: false, sheet: false, elements: DEFAULT_ELEMENTS_DIR, out: DEFAULT_OUT_DIR };
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
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

function loadScenes() {
  const raw = fs.readFileSync(SCENES_FILE, 'utf8');
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
      if (!item || typeof item.el !== 'string' || !item.el) throw new Error(`${at}: el must be a non-empty string`);
      for (const key of ['x', 'y', 'scale']) {
        if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) {
          throw new Error(`${at}: ${key} must be a finite number`);
        }
      }
      if (item.x < 0 || item.x > 1) throw new Error(`${at}: x must be within 0..1`);
      if (item.y < 0 || item.y > 1) throw new Error(`${at}: y must be within 0..1`);
      if (item.scale <= 0) throw new Error(`${at}: scale must be > 0`);
      if (item.rot !== undefined && (typeof item.rot !== 'number' || !Number.isFinite(item.rot))) {
        throw new Error(`${at}: rot must be a finite number`);
      }
      if (item.shadow !== undefined && typeof item.shadow !== 'boolean') {
        throw new Error(`${at}: shadow must be a boolean`);
      }
    });
  }
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

const BOARD_TYPES = new Set([
  'chess8',
  'go19',
  'xiangqi9x10',
  'reversi8',
  'connect4frame',
  'backgammon',
  'cardtable',
  'none',
]);

// width: fraction of the table plane width. aspect: height / width.
const BOARD_SPECS = {
  chess8: { width: 0.50, aspect: 1 },
  go19: { width: 0.50, aspect: 1 },
  reversi8: { width: 0.50, aspect: 1 },
  xiangqi9x10: { width: 0.46, aspect: 1.125 },
  connect4frame: { width: 0.48, aspect: 6 / 7 },
  backgammon: { width: 0.55, aspect: 0.5 },
};

const BOARD_LINE = 'rgba(245,238,220,0.20)';
const BOARD_LINE_W = 1.5;

function svgBoard(viewW, viewH, body) {
  return (
    `<svg viewBox="0 0 ${viewW} ${viewH}" preserveAspectRatio="none" ` +
    `xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  );
}

function boardSvg(type) {
  const stroke = `stroke="${BOARD_LINE}" stroke-width="${BOARD_LINE_W}" fill="none"`;

  if (type === 'chess8') {
    const m = 40;
    const inner = 920;
    const cell = inner / 8;
    const rects = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const fill = (r + c) % 2 === 0 ? '#f2e4c8' : '#080604';
        rects.push(
          `<rect x="${m + c * cell}" y="${m + r * cell}" width="${cell}" ` +
            `height="${cell}" fill="${fill}"/>`
        );
      }
    }
    return svgBoard(
      1000,
      1000,
      `<g opacity="0.35">${rects.join('')}</g>` +
        `<rect x="${m}" y="${m}" width="${inner}" height="${inner}" ${stroke}/>`
    );
  }

  if (type === 'reversi8') {
    const m = 40;
    const inner = 920;
    const step = inner / 8;
    const lines = [];
    for (let i = 0; i <= 8; i++) {
      const p = m + i * step;
      lines.push(`<line x1="${p}" y1="${m}" x2="${p}" y2="${m + inner}" ${stroke}/>`);
      lines.push(`<line x1="${m}" y1="${p}" x2="${m + inner}" y2="${p}" ${stroke}/>`);
    }
    return svgBoard(1000, 1000, lines.join(''));
  }

  if (type === 'go19') {
    const m = 40;
    const inner = 920;
    const step = inner / 18;
    const lines = [];
    for (let i = 0; i <= 18; i++) {
      const p = m + i * step;
      lines.push(`<line x1="${p}" y1="${m}" x2="${p}" y2="${m + inner}" ${stroke}/>`);
      lines.push(`<line x1="${m}" y1="${p}" x2="${m + inner}" y2="${p}" ${stroke}/>`);
    }
    // four corner star points (4-4 points of a 19x19 board)
    const stars = [3, 15]
      .flatMap((r) => [3, 15].map((c) => [r, c]))
      .map(
        ([r, c]) =>
          `<circle cx="${m + c * step}" cy="${m + r * step}" r="5.5" ` +
          `fill="${BOARD_LINE}"/>`
      );
    return svgBoard(1000, 1000, lines.join('') + stars.join(''));
  }

  if (type === 'xiangqi9x10') {
    const mx = 50;
    const my = 56.25;
    const step = 112.5;
    const parts = [];
    // 10 horizontal lines
    for (let j = 0; j <= 9; j++) {
      const y = my + j * step;
      parts.push(`<line x1="${mx}" y1="${y}" x2="${mx + 8 * step}" y2="${y}" ${stroke}/>`);
    }
    // 9 vertical lines; inner ones stop at the river banks
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
    // palace X at both ends (columns 3-5, rows 0-2 and 7-9)
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
    return svgBoard(1000, 1125, parts.join(''));
  }

  if (type === 'connect4frame') {
    const m = 30;
    const w = 940;
    const h = 797.142857;
    const cols = 7;
    const rows = 6;
    const cw = w / cols;
    const ch = h / rows;
    const parts = [];
    parts.push(
      `<rect x="${m}" y="${m}" width="${w}" height="${h}" rx="42" ` +
        `fill="rgba(0,0,0,0.16)" ${stroke}/>`
    );
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = m + (c + 0.5) * cw;
        const cy = m + (r + 0.5) * ch;
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="52" fill="rgba(0,0,0,0.38)" ` +
            `stroke="${BOARD_LINE}" stroke-width="${BOARD_LINE_W}"/>`
        );
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="43" fill="none" ` +
            `stroke="rgba(255,245,228,0.055)" stroke-width="1"/>`
        );
      }
    }
    return svgBoard(1000, 857.142857, parts.join(''));
  }

  if (type === 'backgammon') {
    const top = 20;
    const bottom = 480;
    const barW = 28;
    const leftEnd = 486;
    const rightStart = 514;
    const pointW = (leftEnd - top) / 6; // 77.667
    const parts = [];
    const tri = (x0, x1, base, tip, fill) =>
      `<path d="M${x0} ${base} L${x1} ${base} L${(x0 + x1) / 2} ${tip} Z" ` +
      `fill="${fill}" ${stroke}/>`;
    for (let i = 0; i < 6; i++) {
      const fill = i % 2 === 0 ? 'rgba(255,245,228,0.055)' : 'rgba(0,0,0,0.12)';
      const lx0 = top + i * pointW;
      const lx1 = lx0 + pointW;
      const rx0 = rightStart + i * pointW;
      const rx1 = rx0 + pointW;
      parts.push(tri(lx0, lx1, top, 230, fill));
      parts.push(tri(rx0, rx1, top, 230, fill));
      parts.push(tri(lx0, lx1, bottom, 270, fill));
      parts.push(tri(rx0, rx1, bottom, 270, fill));
    }
    parts.push(
      `<rect x="${leftEnd}" y="${top}" width="${barW}" height="${bottom - top}" ` +
        `fill="rgba(0,0,0,0.18)" ${stroke}/>`
    );
    parts.push(
      `<rect x="${top}" y="${top}" width="960" height="${bottom - top}" ${stroke}/>`
    );
    return svgBoard(1000, 500, parts.join(''));
  }

  throw new Error(`unknown board type: ${type}`);
}

function buildBoard(type, width, height) {
  if (!type || type === 'none') return '';
  if (!BOARD_TYPES.has(type)) throw new Error(`unknown board type: ${type}`);

  const { PW, PH } = planeSize(width, height);
  if (type === 'cardtable') {
    const w = PW * 0.62;
    const h = PH * 0.78;
    return (
      `<div class="board board--cardtable" style="left:${round((PW - w) / 2)}px;` +
      `top:${round((PH - h) / 2)}px;width:${round(w)}px;height:${round(h)}px"></div>`
    );
  }

  const spec = BOARD_SPECS[type];
  const w = spec.width * PW;
  const h = w * spec.aspect;
  return (
    `<div class="board" style="left:${round((PW - w) / 2)}px;top:${round((PH - h) / 2)}px;` +
    `width:${round(w)}px;height:${round(h)}px">${boardSvg(type)}</div>`
  );
}

/**
 * Grid boards use board-local item coordinates (0..1 across the board box),
 * so the same scene stays aligned on both the 1200x630 OG and 480x320 card,
 * whose plane aspect ratios differ. Cardtable/none keep plane coordinates.
 */
function boardRect(scene, width, height) {
  const type = scene.board || 'none';
  const spec = BOARD_SPECS[type];
  if (!spec) return null;
  const { PW, PH } = planeSize(width, height);
  const w = spec.width * PW;
  const h = w * spec.aspect;
  return { left: (PW - w) / 2, top: (PH - h) / 2, w, h, PW, PH };
}

function itemPlanePos(item, scene, width, height) {
  const rect = boardRect(scene, width, height);
  if (rect) {
    return { x: rect.left + item.x * rect.w, y: rect.top + item.y * rect.h };
  }
  const { PW, PH } = planeSize(width, height);
  return { x: item.x * PW, y: item.y * PH };
}

/** Approximate visible footprint of an element, in plane-local px. */
function shadowFootprint(el, shape, size) {
  if (shape === 'standing') return [size * 0.40, size * 0.15];
  // Flat cards/tiles sit on top of most of their own shadow, so their
  // footprint is a little wider than the visible card to keep the contact
  // shadow as legible as the one under a disc.
  if (/^(card-)/.test(el)) return [size * 0.76, size * 1.00];
  if (/^(mahjong-)/.test(el)) return [size * 0.72, size * 0.96];
  if (el === 'die') return [size * 0.80, size * 0.80];
  if (/^(chip|connect4|go-stone|reversi|checker)/.test(el)) return [size * 0.82, size * 0.82];
  return [size * 0.72, size * 0.72];
}

function shadowHtml(el, shape, size, cx, cy, rot) {
  const [w, h] = shadowFootprint(el, shape, size);
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

// Visible alpha footprint as a fraction of the square element canvas.
// Measured from the current @2x exports; the fallback is a full square.
const VISIBLE_RATIOS = [
  [/^card-/, 0.59, 0.84],
  [/^mahjong-/, 0.60, 0.84],
  [/^go-stone-black$/, 0.84, 0.604],
  [/^go-stone-white$/, 0.84, 0.708],
  [/^connect4-/, 0.84, 0.84],
  [/^chip-/, 0.82, 0.84],
  [/^reversi-black$/, 0.84, 0.78],
  [/^reversi-white$/, 0.84, 0.836],
  [/^checker-/, 0.82, 0.84],
  [/^airplane-token$/, 0.84, 0.694],
  [/^xiangqi-/, 0.82, 0.84],
  [/^die$/, 0.723, 0.84],
];

function visibleRatios(el) {
  for (const [re, rw, rh] of VISIBLE_RATIOS) {
    if (re.test(el)) return [rw, rh];
  }
  return [0.84, 0.84];
}

function projectedVisibleBox(item, scene, width, height) {
  const size = item.scale * Math.min(width, height);
  const [rw, rh] = visibleRatios(item.el);
  const w = size * rw;
  const h = size * rh;
  const pos = itemPlanePos(item, scene, width, height);
  const rad = ((item.rot || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([dx, dy]) => [pos.x + dx * cos - dy * sin, pos.y + dx * sin + dy * cos]);
  const pts = corners.map(([px, py]) => projectPlanePoint(px, py, width, height));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function overlapWarnings(slug, scene, width, height) {
  const flats = [];
  scene.items.forEach((item, index) => {
    if ((item.shape || 'flat') === 'flat') {
      flats.push({ item, index, box: projectedVisibleBox(item, scene, width, height) });
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
      const bothCards = a.item.el.startsWith('card-') && b.item.el.startsWith('card-');
      const limit = cardScene && bothCards ? 0.45 : 0.12;
      if (ratio > limit + 1e-9) {
        out.push({
          a: `${a.item.el}[${a.index}]`,
          b: `${b.item.el}[${b.index}]`,
          ratio,
          limit,
        });
      }
    }
  }
  return out;
}

function buildItems(scene, width, height, elementsDir, missing) {
  const unit = Math.min(width, height);
  const shadows = [];
  const flats = [];
  const billboards = [];

  for (const item of scene.items) {
    const size = item.scale * unit;
    const shape = item.shape === 'standing' ? 'standing' : 'flat';
    const rot = item.rot || 0;
    const wantShadow = item.shadow !== false;
    const pos = itemPlanePos(item, scene, width, height);

    const file = path.join(elementsDir, `${item.el}@2x.png`);
    const present = fs.existsSync(file);

    if (present) {
      const src = pathToFileURL(file).href;

      if (shape === 'standing') {
        const p = projectPlanePoint(pos.x, pos.y, width, height);
        const box = size * p.k;
        if (wantShadow) {
          shadows.push(shadowHtml(item.el, shape, size, pos.x, pos.y, rot));
        }
        billboards.push(
          `<div class="billboard" style="left:${round(p.x)}px;top:${round(p.y)}px;` +
            `width:${round(box)}px;height:${round(box)}px;` +
            `transform:translate(-50%, -92%) rotate(${round(rot)}deg)">` +
            `<img src="${escapeHtml(src)}" alt=""></div>`
        );
      } else {
        if (wantShadow) shadows.push(shadowHtml(item.el, shape, size, pos.x, pos.y, rot));
        flats.push(
          `<div class="flat" style="left:${round(pos.x - size / 2)}px;top:${round(pos.y - size / 2)}px;` +
            `width:${round(size)}px;height:${round(size)}px;` +
            `transform:rotate(${round(rot)}deg)">` +
            `<img src="${escapeHtml(src)}" alt=""></div>`
        );
      }
    } else {
      missing.add(item.el);
      if (shape === 'standing') {
        const p = projectPlanePoint(pos.x, pos.y, width, height);
        const box = size * p.k;
        const fontSize = round(Math.max(9, Math.min(18, box * 0.07)));
        billboards.push(
          `<div class="billboard" style="left:${round(p.x)}px;top:${round(p.y)}px;` +
            `width:${round(box)}px;height:${round(box)}px;` +
            `transform:translate(-50%, -92%) rotate(${round(rot)}deg)">` +
            `<div class="ph" style="font-size:${fontSize}px">` +
            `<span>${escapeHtml(item.el)}</span></div></div>`
        );
      } else {
        const fontSize = round(Math.max(9, Math.min(18, size * 0.07)));
        flats.push(
          `<div class="flat" style="left:${round(pos.x - size / 2)}px;top:${round(pos.y - size / 2)}px;` +
            `width:${round(size)}px;height:${round(size)}px;` +
            `transform:rotate(${round(rot)}deg)">` +
            `<div class="ph" style="font-size:${fontSize}px">` +
            `<span>${escapeHtml(item.el)}</span></div></div>`
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

function buildHtml(scene, background, layers, width, height) {
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
    .replace('{{BOARD}}', buildBoard(scene.board || 'none', width, height));
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
      const layers = buildItems(scene, width, height, opts.elements, missing);
      const html = buildHtml(scene, scene.background, layers, width, height);
      const htmlPath = path.join(tmpDir, `${slug}-${suffix}.html`);
      fs.writeFileSync(htmlPath, html);

      for (const warning of overlapWarnings(slug, scene, width, height)) {
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
    scenes = loadScenes();
  } catch (err) {
    console.error(`compose: ${err.message}`);
    process.exit(2);
  }

  const slugs = Object.keys(scenes);

  if (opts.list) {
    console.log(`Configured scenes (${slugs.length}):`);
    for (const slug of slugs) {
      const scene = scenes[slug];
      const missing = [...new Set(scene.items.map((i) => i.el))].filter(
        (el) => !fs.existsSync(path.join(opts.elements, `${el}@2x.png`))
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
