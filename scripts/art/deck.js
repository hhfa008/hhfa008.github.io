#!/usr/bin/env node
'use strict';

/**
 * deck.js — render the three code-generated decks with local Chrome.
 *
 *   node scripts/art/deck.js --all
 *   node scripts/art/deck.js --set poker
 *   node scripts/art/deck.js --set mahjong --preview
 *   node scripts/art/deck.js --all --elements /tmp/empty-elements   # fallback proof
 *   node scripts/art/deck.js --list
 *
 * Cards (102):
 *   poker    54  AS..KS KH.. 10D .. joker-red/joker-black       256x358
 *   mahjong  34  1w..9w 1t..9t 1s..9s east south west north
 *                red green white                                 256x340
 *   xiangqi  14  red-shuai 仕 相 馬 車 炮 兵 / black-jiang ...     256x300
 *
 * Zero npm dependencies: Node's built-in WebSocket speaks CDP to one Chrome
 * instance, so all 102 screenshots come from a single browser launch.
 * Element PNGs are only read; this script never writes to elements/.
 *
 * Determinism: fixed card order, system fonts awaited via document.fonts.ready,
 * all images decoded before capture, fixed device metrics / colour profile.
 * Run twice and compare md5.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const ART_DIR = path.join(ROOT, 'games', 'assets', 'art');
const DEFAULT_ELEMENTS = path.join(ART_DIR, 'elements');
const DEFAULT_OUT = path.join(ART_DIR, 'decks');
const CSS_FILE = path.join(__dirname, 'deck.css');

const ELEMENT_NAMES = [
  'card-face-frame',
  'pip-spade', 'pip-heart', 'pip-diamond', 'pip-club',
  'court-panel',
  'mahjong-blank',
  'xiangqi-blank-red', 'xiangqi-blank-black',
];

const POKER_SUITS = [
  { code: 'S', el: 'pip-spade', tone: 'black' },
  { code: 'H', el: 'pip-heart', tone: 'red' },
  { code: 'D', el: 'pip-diamond', tone: 'red' },
  { code: 'C', el: 'pip-club', tone: 'black' },
];

const POKER_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/* Classic pip positions, normalised inside a 112x196 box centred on the card.
   Rows are 0, 1/3, 2/3, 1; columns 0 and 1. */
const PIP_LAYOUT = {
  2: [[0.5, 0], [0.5, 1]],
  3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
  4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
  6: [[0, 0], [0, 1 / 3], [0, 1], [1, 0], [1, 1 / 3], [1, 1]],
  7: [[0, 0], [0, 1 / 3], [0, 1], [1, 0], [1, 1 / 3], [1, 1], [0.5, 1 / 6]],
  8: [[0, 0], [0, 1 / 3], [0, 1], [1, 0], [1, 1 / 3], [1, 1],
      [0.5, 1 / 6], [0.5, 5 / 6]],
  9: [[0, 0], [0, 1 / 3], [0, 2 / 3], [0, 1],
      [1, 0], [1, 1 / 3], [1, 2 / 3], [1, 1], [0.5, 0.5]],
  10: [[0, 0], [0, 1 / 3], [0, 2 / 3], [0, 1],
       [1, 0], [1, 1 / 3], [1, 2 / 3], [1, 1],
       [0.5, 1 / 3], [0.5, 2 / 3]],
};
const PIP_SIZE = {
  2: 46, 3: 44, 4: 42, 5: 40, 6: 37, 7: 35, 8: 34, 9: 33, 10: 32,
};

const SUIT_SVG = {
  S: '<path d="M50 92C44 80 14 62 14 37 14 20 26 10 39 10c6 0 10 3 11 9 1-6 5-9 11-9 13 0 25 10 25 27 0 25-30 43-36 55z"/>' +
     '<path d="M44 72c-1 12-7 18-16 22h44c-9-4-15-10-16-22z"/>',
  H: '<path d="M50 88C20 66 6 46 6 29 6 13 18 3 33 3c9 0 15 5 17 13 2-8 8-13 17-13 15 0 27 10 27 26 0 17-14 37-44 59z"/>',
  D: '<path d="M50 2 95 50 50 98 5 50z"/>',
  C: '<circle cx="50" cy="24" r="19"/><circle cx="29" cy="58" r="19"/>' +
     '<circle cx="71" cy="58" r="19"/>' +
     '<path d="M44 62c0 16-6 26-16 32h44c-10-6-16-16-16-32z"/>',
};

const WAN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

const HONORS = [
  { name: 'east', char: '東' },
  { name: 'south', char: '南' },
  { name: 'west', char: '西' },
  { name: 'north', char: '北' },
  { name: 'red', char: '中', tone: 'red' },
  { name: 'green', char: '發', tone: 'green' },
  { name: 'white', char: null },
];

const XIANGQI = [
  { name: 'red-shuai', side: 'red', char: '帥' },
  { name: 'red-shi', side: 'red', char: '仕' },
  { name: 'red-xiang', side: 'red', char: '相' },
  { name: 'red-ma', side: 'red', char: '馬' },
  { name: 'red-ju', side: 'red', char: '車' },
  { name: 'red-pao', side: 'red', char: '炮' },
  { name: 'red-bing', side: 'red', char: '兵' },
  { name: 'black-jiang', side: 'black', char: '將' },
  { name: 'black-shi', side: 'black', char: '士' },
  { name: 'black-xiang', side: 'black', char: '象' },
  { name: 'black-ma', side: 'black', char: '馬' },
  { name: 'black-ju', side: 'black', char: '車' },
  { name: 'black-pao', side: 'black', char: '砲' },
  { name: 'black-zu', side: 'black', char: '卒' },
];

/* 筒: N circles.  [x, y, diameter], normalised in the tile's dot box. */
const DOT_LAYOUT = {
  1: [[0.5, 0.5, 132]],
  2: [[0.5, 0.3, 66], [0.5, 0.7, 66]],
  3: [[0.24, 0.2, 58], [0.5, 0.5, 58], [0.76, 0.8, 58]],
  4: [[0.28, 0.28, 56], [0.72, 0.28, 56], [0.28, 0.72, 56], [0.72, 0.72, 56]],
  5: [[0.27, 0.27, 52], [0.73, 0.27, 52], [0.5, 0.5, 52], [0.27, 0.73, 52], [0.73, 0.73, 52]],
  6: [[0.3, 0.2, 48], [0.7, 0.2, 48], [0.3, 0.5, 48], [0.7, 0.5, 48], [0.3, 0.8, 48], [0.7, 0.8, 48]],
  7: [[0.18, 0.18, 44], [0.5, 0.18, 44], [0.82, 0.18, 44], [0.5, 0.5, 44],
      [0.18, 0.82, 44], [0.5, 0.82, 44], [0.82, 0.82, 44]],
  8: [[0.3, 0.14, 42], [0.7, 0.14, 42], [0.3, 0.38, 42], [0.7, 0.38, 42],
      [0.3, 0.62, 42], [0.7, 0.62, 42], [0.3, 0.86, 42], [0.7, 0.86, 42]],
  9: [[0.2, 0.15, 40], [0.5, 0.15, 40], [0.8, 0.15, 40],
      [0.2, 0.5, 40], [0.5, 0.5, 40], [0.8, 0.5, 40],
      [0.2, 0.85, 40], [0.5, 0.85, 40], [0.8, 0.85, 40]],
};

/* 条: N sticks.  [x, y, height], normalised in the tile's stick box. */
const BAM_LAYOUT = {
  2: [[0.35, 0.5, 170], [0.65, 0.5, 170]],
  3: [[0.2, 0.5, 160], [0.5, 0.5, 160], [0.8, 0.5, 160]],
  4: [[0.35, 0.3, 96], [0.65, 0.3, 96], [0.35, 0.7, 96], [0.65, 0.7, 96]],
  5: [[0.35, 0.22, 64], [0.65, 0.22, 64], [0.5, 0.5, 64], [0.35, 0.78, 64], [0.65, 0.78, 64]],
  6: [[0.2, 0.3, 96], [0.5, 0.3, 96], [0.8, 0.3, 96],
      [0.2, 0.7, 96], [0.5, 0.7, 96], [0.8, 0.7, 96]],
  7: [[0.2, 0.2, 56], [0.5, 0.2, 56], [0.8, 0.2, 56], [0.5, 0.5, 56],
      [0.2, 0.8, 56], [0.5, 0.8, 56], [0.8, 0.8, 56]],
  8: [[0.14, 0.3, 96], [0.38, 0.3, 96], [0.62, 0.3, 96], [0.86, 0.3, 96],
      [0.14, 0.7, 96], [0.38, 0.7, 96], [0.62, 0.7, 96], [0.86, 0.7, 96]],
  9: [[0.2, 0.18, 64], [0.5, 0.18, 64], [0.8, 0.18, 64],
      [0.2, 0.5, 64], [0.5, 0.5, 64], [0.8, 0.5, 64],
      [0.2, 0.82, 64], [0.5, 0.82, 64], [0.8, 0.82, 64]],
};

const BIRD_SVG = `
<svg class="mj-bird" viewBox="0 0 200 240" aria-hidden="true">
  <path d="M18 210C62 198 138 202 184 192" fill="none" stroke="var(--gold)" stroke-width="6" stroke-linecap="round"/>
  <path d="M62 152C36 130 20 96 16 60c18 24 42 50 62 68z" fill="var(--black)"/>
  <path d="M58 148C34 122 22 86 26 52c14 26 34 52 54 72z" fill="var(--red)"/>
  <path d="M68 154c-10-32 10-62 42-66 28-3 46 18 46 46 0 32-24 54-54 54-18 0-30-12-34-34z" fill="var(--mj-green)"/>
  <path d="M96 184c22 0 44-14 52-34-6 26-26 42-48 42-10 0-18-4-24-10z" fill="var(--ivory)"/>
  <path d="M104 108c24-2 44 10 48 32-12 12-32 16-46 10-12-6-14-30-2-42z" fill="var(--red)"/>
  <path d="M112 116c14 2 26 10 30 22M104 126c12 2 22 8 28 18" stroke="var(--gold)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  <circle cx="148" cy="84" r="29" fill="var(--mj-green)"/>
  <path d="M148 52c-8-20 2-30 14-32-4 14-2 24 4 32z" fill="var(--red)"/>
  <path d="M174 82l28 8-28 8z" fill="var(--gold)"/>
  <circle cx="156" cy="78" r="5" fill="var(--black)"/>
  <circle cx="157.5" cy="76.5" r="1.6" fill="var(--ivory)"/>
  <path d="M112 188l-2 24M126 188l6 24" stroke="var(--gold)" stroke-width="4" stroke-linecap="round"/>
  <path d="M104 212h12M126 212h12" stroke="var(--gold)" stroke-width="4" stroke-linecap="round"/>
</svg>`;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
];

/* ------------------------------------------------------------------ args */

function usage() {
  return [
    'Usage:',
    '  node scripts/art/deck.js --all                 render all 102 cards + previews',
    '  node scripts/art/deck.js --set poker           render one set',
    '  node scripts/art/deck.js --all --preview       render cards then contact sheets',
    '  node scripts/art/deck.js --preview             rebuild previews from existing WebPs',
    '  node scripts/art/deck.js --list                list cards + element presence',
    '',
    'Output:',
    '  decks/<set>/webp/<name>.webp   site asset (q0.9)',
    '  decks/<set>/png/<name>.png     lossless master, kept in the repo',
    '',
    'Options:',
    '  --set <poker|mahjong|xiangqi>  one set (repeatable)',
    '  --elements <dir>               element PNG dir (default games/assets/art/elements)',
    '  --out <dir>                    output dir (default games/assets/art/decks)',
    '  --quality <0-100>              WebP quality (default 90)',
    '  --preview                      write _preview/{poker-fan,mahjong-row,xiangqi-row}.png',
    '  --no-preview                   suppress previews after --all',
    '',
    'Environment:',
    '  CHROME_PATH                    override the Chrome executable',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    sets: [], all: false, preview: false, noPreview: false,
    list: false, help: false, quality: 90,
    elements: DEFAULT_ELEMENTS, out: DEFAULT_OUT,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--preview') opts.preview = true;
    else if (a === '--no-preview') opts.noPreview = true;
    else if (a === '--list') opts.list = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '--set' || a.startsWith('--set=')) {
      const v = a === '--set' ? argv[++i] : a.slice(6);
      if (!v) throw new Error('--set needs poker, mahjong or xiangqi');
      for (const s of v.split(',')) {
        if (!['poker', 'mahjong', 'xiangqi'].includes(s)) throw new Error(`unknown set: ${s}`);
        if (!opts.sets.includes(s)) opts.sets.push(s);
      }
    } else if (a === '--elements' || a.startsWith('--elements=')) {
      const v = a === '--elements' ? argv[++i] : a.slice(11);
      if (!v) throw new Error('--elements needs a directory');
      opts.elements = path.resolve(v);
    } else if (a === '--out' || a.startsWith('--out=')) {
      const v = a === '--out' ? argv[++i] : a.slice(6);
      if (!v) throw new Error('--out needs a directory');
      opts.out = path.resolve(v);
    } else if (a === '--quality' || a.startsWith('--quality=')) {
      const v = a === '--quality' ? argv[++i] : a.slice(10);
      const q = Number(v);
      if (!Number.isFinite(q) || q < 0 || q > 100) throw new Error('--quality must be 0..100');
      opts.quality = Math.round(q);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return opts;
}

/* -------------------------------------------------------------- card specs */

function pokerCards() {
  const cards = [];
  for (const suit of POKER_SUITS) {
    for (const rank of POKER_RANKS) {
      cards.push({
        set: 'poker', name: `${rank}${suit.code}`, rank, suit,
        width: 256, height: 358,
      });
    }
  }
  cards.push({ set: 'poker', name: 'joker-red', joker: 'red', width: 256, height: 358 });
  cards.push({ set: 'poker', name: 'joker-black', joker: 'black', width: 256, height: 358 });
  return cards;
}

function mahjongCards() {
  const cards = [];
  for (let n = 1; n <= 9; n++) {
    cards.push({ set: 'mahjong', name: `${n}w`, kind: 'wan', num: n, width: 256, height: 340 });
  }
  for (let n = 1; n <= 9; n++) {
    cards.push({ set: 'mahjong', name: `${n}t`, kind: 'tong', num: n, width: 256, height: 340 });
  }
  for (let n = 1; n <= 9; n++) {
    cards.push({ set: 'mahjong', name: `${n}s`, kind: 'tiao', num: n, width: 256, height: 340 });
  }
  for (const h of HONORS) {
    cards.push({ set: 'mahjong', name: h.name, kind: 'honor', honor: h, width: 256, height: 340 });
  }
  return cards;
}

function xiangqiCards() {
  return XIANGQI.map((x) => ({
    set: 'xiangqi', name: x.name, side: x.side, char: x.char,
    width: 256, height: 300,
  }));
}

const SETS = {
  poker: pokerCards,
  mahjong: mahjongCards,
  xiangqi: xiangqiCards,
};

/* --------------------------------------------------------------- elements */

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

/* Minimal 8-bit PNG alpha-bbox decoder (RGBA/RGB/gray, non-interlaced).
   The carriers are 1024x1024 RGBA with transparent margins; cropping to the
   alpha bbox is what lets them fill a 256x358 card or a 256x256 disc without
   a paper underlay peeking around the art. */
function pngAlphaBBox(file) {
  if (!isPng(file)) return null;
  const buf = fs.readFileSync(file);
  let offset = 8;
  let ihdr = null;
  const idat = [];
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) return null;
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
  if (!ihdr || !idat.length) return null;
  if (ihdr.bitDepth !== 8 || ihdr.interlace !== 0) return null;
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = ihdr.width * channels;
  if (raw.length < (stride + 1) * ihdr.height) return null;
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
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          value = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: return null;
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
      const alpha = alphaOffset === -1 ? 255 : out[y * stride + x * channels + alphaOffset];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return null;
  return {
    x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1,
    width: ihdr.width, height: ihdr.height,
  };
}

function loadElements(dir) {
  const map = new Map();
  for (const name of ELEMENT_NAMES) {
    let file = null;
    for (const suffix of ['@2x.png', '.png']) {
      const candidate = path.join(dir, `${name}${suffix}`);
      if (fs.existsSync(candidate) && isPng(candidate)) {
        file = candidate;
        break;
      }
    }
    const bbox = file ? pngAlphaBBox(file) : null;
    map.set(name, file && bbox ? { file, url: pathToFileURL(file).href, bbox } : null);
  }
  return map;
}

function missingElements(elems, names) {
  return names.filter((n) => !elems.get(n));
}

/* ------------------------------------------------------------------ HTML */

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Map an element's alpha bbox onto a target box.
   fill    -> bbox edges land on the target edges (cards/tiles/discs)
   contain -> bbox preserves aspect and is centred (pips/suit marks) */
function carrierBg(el, targetW, targetH, mode) {
  const b = el.bbox;
  let sx;
  let sy;
  if (mode === 'contain') {
    const s = Math.min(targetW / b.w, targetH / b.h);
    sx = s;
    sy = s;
  } else {
    sx = targetW / b.w;
    sy = targetH / b.h;
  }
  const bw = b.width * sx;
  const bh = b.height * sy;
  let ox;
  let oy;
  if (mode === 'contain') {
    ox = (targetW - b.w * sx) / 2 - b.x * sx;
    oy = (targetH - b.h * sy) / 2 - b.y * sy;
  } else {
    ox = -b.x * sx;
    oy = -b.y * sy;
  }
  return `background-image:url("${el.url}");` +
    `background-size:${bw.toFixed(3)}px ${bh.toFixed(3)}px;` +
    `background-position:${ox.toFixed(3)}px ${oy.toFixed(3)}px;` +
    'background-repeat:no-repeat;';
}

function styleAttr(css) {
  return `style="${escapeAttr(css)}"`;
}

function suitSvg(code) {
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${SUIT_SVG[code]}</svg>`;
}

function pipMarkup(card, elems, size, x, y) {
  const pip = elems.get(card.suit.el);
  const art = pip ? '' : suitSvg(card.suit.code);
  const bg = pip ? carrierBg(pip, size, size, 'contain') : '';
  const style = `left:${x * 100}%;top:${y * 100}%;width:${size}px;height:${size}px;${bg}`;
  return `<span class="pip" ${styleAttr(style)}>${art}</span>`;
}

function pokerCorner(card, elems, cls) {
  const pip = elems.get(card.suit.el);
  const art = pip ? '' : suitSvg(card.suit.code);
  const bg = pip ? carrierBg(pip, 20, 20, 'contain') : '';
  return `<div class="corner ${cls}">` +
    `<span class="rank${card.rank === '10' ? ' rank--ten' : ''}">${card.rank}</span>` +
    `<span class="suit-mark"${bg ? ` ${styleAttr(bg)}` : ''}>${art}</span>` +
    '</div>';
}

function pokerCard(card, elems) {
  const frame = elems.get('card-face-frame');
  const fallback = !frame;
  const paper = fallback ? '<div class="poker-paper"></div>' : '';
  const frameDiv = frame
    ? `<div class="poker-frame" ${styleAttr(carrierBg(frame, card.width, card.height, 'fill'))}></div>`
    : '';

  if (card.joker) {
    return `<div class="card poker joker joker--${card.joker}${fallback ? ' fallback' : ''}">` +
      paper + frameDiv + (frame ? '<div class="poker-rule"></div>' : '') +
      '<div class="joker">' +
      '<div class="joker-mark joker-mark--tl"></div>' +
      '<div class="joker-mark joker-mark--br"></div>' +
      '<div class="joker-emblem"><div class="joker-emblem-inner">' +
      '<span class="joker-word">JOKER</span>' +
      '</div></div>' +
      '</div></div>';
  }

  let center;
  if (card.rank === 'A') {
    center = `<div class="pips">${pipMarkup(card, elems, 88, 0.5, 0.5)}</div>`;
  } else if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    const panel = elems.get('court-panel');
    center = '<div class="court">' +
      (panel ? `<div class="court-bg" ${styleAttr(carrierBg(panel, 152, 206, 'fill'))}></div>` : '') +
      `<div class="court-medallion"><span class="court-letter">${card.rank}</span></div>` +
      '</div>';
  } else {
    const layout = PIP_LAYOUT[Number(card.rank)];
    const size = PIP_SIZE[Number(card.rank)];
    center = `<div class="pips">${layout
      .map(([x, y]) => pipMarkup(card, elems, size, x, y))
      .join('')}</div>`;
  }

  return `<div class="card poker suit-${card.suit.code}${fallback ? ' fallback' : ''}">` +
    paper + frameDiv + (frame ? '<div class="poker-rule"></div>' : '') +
    pokerCorner(card, elems, 'corner--tl') +
    pokerCorner(card, elems, 'corner--br') +
    center +
    '</div>';
}

/* Traditional mahjong ring rotation: red / green / black, 2px each.
   i is the dot index inside the tile, so 2-9 dot tiles do not all look
   like the same red bullseye. 1t is the explicit red-outside/green-inside
   exception the traditional sets use. */
const MJ_RINGS = ['var(--red)', 'var(--mj-green)', 'var(--black)'];

function ringVarsFor(i) {
  const a = MJ_RINGS[i % 3];
  const b = MJ_RINGS[(i + 1) % 3];
  const c = MJ_RINGS[(i + 2) % 3];
  return `--ring1:${a};--ring2:${b};--ring3:${c};--core:${a}`;
}

const ONE_TONG_RINGS =
  '--ring1:var(--red);--ring2:var(--mj-green);--ring3:var(--mj-green);--core:var(--mj-green)';

function dotMarkup(x, y, size, vars) {
  const style = `left:${x * 100}%;top:${y * 100}%;width:${size}px;height:${size}px` +
    (vars ? `;${vars}` : '');
  return `<span class="mj-dot" ${styleAttr(style)}></span>`;
}

function bambooMarkup(x, y, height, i) {
  const stick = i % 2 === 0 ? 'var(--mj-green)' : 'var(--red)';
  const dark = i % 2 === 0
    ? 'color-mix(in srgb, var(--mj-green) 55%, var(--black))'
    : 'color-mix(in srgb, var(--red) 55%, var(--black))';
  const style = `left:${x * 100}%;top:${y * 100}%;height:${height}px;` +
    `--stick:${stick};--stick-dark:${dark}`;
  return `<span class="bam" ${styleAttr(style)}></span>`;
}

function mahjongContent(card) {
  if (card.kind === 'wan') {
    return '<div class="mj-content"><div class="mj-wan-figure">' +
      `<span class="mj-num">${WAN_NUM[card.num - 1]}</span>` +
      '<span class="mj-wan-char">萬</span>' +
      '</div></div>';
  }
  if (card.kind === 'tong') {
    const dots = DOT_LAYOUT[card.num];
    return `<div class="mj-dots">${dots
      .map(([x, y, size], i) => dotMarkup(x, y, size, card.num === 1 ? ONE_TONG_RINGS : ringVarsFor(i)))
      .join('')}</div>`;
  }
  if (card.kind === 'tiao') {
    if (card.num === 1) return `<div class="mj-bird-wrap">${BIRD_SVG}</div>`;
    return `<div class="mj-bamboo">${BAM_LAYOUT[card.num]
      .map(([x, y, h], i) => bambooMarkup(x, y, h, i)).join('')}</div>`;
  }
  const h = card.honor;
  if (!h.char) return '<div class="mj-white"><div class="mj-white-inner"></div></div>';
  const cls = h.tone === 'red' ? ' mj-honor--red' : h.tone === 'green' ? ' mj-honor--green' : '';
  return `<div class="mj-content"><span class="mj-honor${cls}">${h.char}</span></div>`;
}

function mahjongTile(card, elems) {
  const blank = elems.get('mahjong-blank');
  const fallback = !blank;
  return `<div class="card mahjong${fallback ? ' fallback' : ''}">` +
    (blank
      ? `<div class="tile-blank" ${styleAttr(carrierBg(blank, card.width, card.height, 'fill'))}></div>`
      : '<div class="tile-bg"></div><div class="mj-recess"></div>') +
    mahjongContent(card) +
    '</div>';
}

function xiangqiPiece(card, elems) {
  const blank = elems.get(card.side === 'red' ? 'xiangqi-blank-red' : 'xiangqi-blank-black');
  const fallback = !blank;
  return `<div class="card xiangqi ${card.side}${fallback ? ' fallback' : ''}">` +
    (blank
      ? `<div class="piece-img" ${styleAttr(carrierBg(blank, 256, 256, 'fill'))}></div>` +
        '<div class="xq-rule"></div>'
      : '<div class="xq-disc"></div>') +
    `<div class="xq-char">${card.char}</div>` +
    '</div>';
}

function pageHtml(body, width, height, css) {
  return '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<style>${css}\nhtml, body { width: ${width}px; height: ${height}px; }\n</style>\n` +
    `</head>\n<body>\n${body}\n</body>\n</html>\n`;
}

/* ------------------------------------------------------------------ Chrome */

function findChrome() {
  const candidates = process.env.CHROME_PATH ? [process.env.CHROME_PATH] : CHROME_CANDIDATES;
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    'Chrome not found. Looked at:\n  ' + candidates.join('\n  ') +
    '\nInstall Google Chrome or set CHROME_PATH to its executable.'
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpBrowser {
  constructor(child, ws, profileDir) {
    this.child = child;
    this.ws = ws;
    this.profileDir = profileDir;
    this.nextId = 1;
    this.pending = new Map();
    this.waiters = new Map();
    this.sessionId = null;
    this.closed = false;
    ws.addEventListener('message', (ev) => this._onMessage(ev));
    ws.addEventListener('close', () => {
      this.closed = true;
      for (const [, p] of this.pending) p.reject(new Error('Chrome websocket closed'));
      this.pending.clear();
    });
  }

  static async launch(chrome, profileDir, tmpDir) {
    fs.mkdirSync(profileDir, { recursive: true });
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--force-color-profile=srgb',
      '--allow-file-access-from-files',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      'about:blank',
    ];
    const child = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (buf) => { stderr += buf.toString(); });

    const portFile = path.join(profileDir, 'DevToolsActivePort');
    let lines = null;
    for (let i = 0; i < 300; i++) {
      if (fs.existsSync(portFile)) {
        try {
          const raw = fs.readFileSync(portFile, 'utf8').trim().split('\n');
          if (raw.length >= 2 && raw[0] && raw[1]) { lines = raw; break; }
        } catch { /* still writing */ }
      }
      if (child.exitCode !== null) break;
      await sleep(50);
    }
    if (!lines) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      throw new Error(`Chrome did not expose DevToolsActivePort.${stderr ? `\n${stderr.trim()}` : ''}`);
    }
    const wsUrl = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout connecting to ${wsUrl}`)), 15000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`failed to connect to ${wsUrl}`)); }, { once: true });
    });
    const browser = new CdpBrowser(child, ws, profileDir);
    await browser.attachPage();
    return browser;
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); }
    catch { return; }

    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    const list = this.waiters.get(msg.method);
    if (!list || list.length === 0) return;
    const index = list.findIndex((w) => !w.sessionId || w.sessionId === msg.sessionId);
    if (index === -1) return;
    const w = list[index];
    list.splice(index, 1);
    clearTimeout(w.timer);
    w.resolve(msg.params);
  }

  send(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(new Error('Chrome websocket is closed'));
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  sendSession(method, params = {}) {
    return this.send(method, params, this.sessionId);
  }

  waitEvent(method, sessionId, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const entry = { sessionId, resolve, reject };
      entry.timer = setTimeout(() => {
        const list = this.waiters.get(method) || [];
        const i = list.indexOf(entry);
        if (i >= 0) list.splice(i, 1);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const list = this.waiters.get(method) || [];
      list.push(entry);
      this.waiters.set(method, list);
    });
  }

  async attachPage() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.sessionId = sessionId;
    this.targetId = targetId;
    await this.sendSession('Page.enable');
    await this.sendSession('Runtime.enable');
    await this.sendSession('DOM.enable');
    await this.sendSession('CSS.enable');
    await this.sendSession('Emulation.setDefaultBackgroundColorOverride', {
      color: { r: 0, g: 0, b: 0, a: 0 },
    });
    await this.sendSession('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }],
    });
  }

  async load(url, width, height) {
    await this.sendSession('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    });
    const loaded = this.waitEvent('Page.loadEventFired', this.sessionId);
    await this.sendSession('Page.navigate', { url });
    await loaded;
    await this.evaluate('document.fonts.ready.then(() => true)', true);
    await this.evaluate(
      'Promise.all(Array.from(document.images).map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))).then(() => true)',
      true
    );
    await this.evaluate(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))',
      true
    );
  }

  async evaluate(expression, awaitPromise = false) {
    const res = await this.sendSession('Runtime.evaluate', {
      expression, awaitPromise, returnByValue: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      throw new Error(`page eval failed: ${(d.exception && d.exception.description) || d.text || 'unknown'}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async platformFonts(selector) {
    const { root } = await this.sendSession('DOM.getDocument', { depth: 1 });
    const { nodeId } = await this.sendSession('DOM.querySelector', {
      nodeId: root.nodeId, selector,
    });
    if (!nodeId) return null;
    const { fonts } = await this.sendSession('CSS.getPlatformFontsForNode', { nodeId });
    return (fonts || []).map((f) => ({
      family: f.familyName,
      postScript: f.postScriptName,
      custom: f.isCustomFont,
      glyphs: f.glyphCount,
    }));
  }

  async screenshot(format = 'png', quality) {
    const params = {
      format,
      fromSurface: true,
      captureBeyondViewport: false,
      optimizeForSpeed: false,
    };
    if (format === 'webp' || format === 'jpeg') params.quality = quality;
    const { data } = await this.sendSession('Page.captureScreenshot', params);
    return Buffer.from(data, 'base64');
  }

  async close() {
    try { await this.send('Browser.close'); } catch { /* already gone */ }
    await sleep(150);
    try { this.child.kill('SIGTERM'); } catch { /* already gone */ }
    await sleep(150);
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/* Dimensions from the WebP container. Chrome writes lossy+alpha as VP8X. */
function webpSize(buffer) {
  if (buffer.length < 30 ||
      buffer.toString('ascii', 0, 4) !== 'RIFF' ||
      buffer.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('not a WebP');
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height, alpha: Boolean(buffer[20] & 0x10) };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff), alpha: true };
  }
  if (chunk === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      alpha: false,
    };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

/* --------------------------------------------------------------- rendering */

const SET_ELEMENTS = {
  poker: ['card-face-frame', 'pip-spade', 'pip-heart', 'pip-diamond', 'pip-club', 'court-panel'],
  mahjong: ['mahjong-blank'],
  xiangqi: ['xiangqi-blank-red', 'xiangqi-blank-black'],
};

const FALLBACK_NOTES = {
  'card-face-frame': 'poker: --paper fill + 2px --paper-line border',
  'pip-spade': 'poker: inline SVG, flat --black',
  'pip-heart': 'poker: inline SVG, flat --red',
  'pip-diamond': 'poker: inline SVG, flat --red',
  'pip-club': 'poker: inline SVG, flat --black',
  'court-panel': 'poker J/Q/K: ivory medallion only',
  'mahjong-blank': 'mahjong: --ivory tile + 2px recess',
  'xiangqi-blank-red': 'xiangqi red: radial lacquer disc + 2px rings',
  'xiangqi-blank-black': 'xiangqi black: radial near-black disc + 2px rings',
};

async function renderSet(browser, set, cards, elems, opts, css, tmpDir, fontState) {
  const outDir = path.join(opts.out, set);
  const pngDir = path.join(outDir, 'png');
  const webpDir = path.join(outDir, 'webp');
  fs.mkdirSync(pngDir, { recursive: true });
  fs.mkdirSync(webpDir, { recursive: true });

  const usedElements = new Set(SET_ELEMENTS[set]);
  let webpBytes = 0;
  let pngBytes = 0;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    let body;
    if (set === 'poker') body = pokerCard(card, elems);
    else if (set === 'mahjong') body = mahjongTile(card, elems);
    else body = xiangqiPiece(card, elems);

    const htmlPath = path.join(tmpDir, `${set}-${card.name}.html`);
    fs.writeFileSync(htmlPath, pageHtml(body, card.width, card.height, css));
    await browser.load(pathToFileURL(htmlPath).href, card.width, card.height);

    if (!fontState.checked) {
      fontState.checked = true;
      fontState.available = await browser.evaluate(`(() => {
        const fams = ['Songti SC', 'Songti TC', 'STKaiti', 'PingFang SC', 'Helvetica Neue'];
        const out = {};
        for (const f of fams) {
          out[f] = {
            available: document.fonts.check('16px "' + f + '"'),
            hanzi: document.fonts.check('700 124px "' + f + '"', '帥將馬車砲卒萬東南西北中發一二三四五六七八九')
          };
        }
        return out;
      })()`);
    }

    if (card.name === 'AS') {
      await probeFont(browser, '.rank', 'AS .rank', fontState);
      await probeFont(browser, '.pip', 'AS .pip', fontState);
    }
    if (card.name === '1w') {
      await probeFont(browser, '.mj-num', '1w .mj-num', fontState);
      await probeFont(browser, '.mj-wan-char', '1w .mj-wan-char', fontState);
    }
    if (card.name === 'red-shuai') {
      await probeFont(browser, '.xq-char', 'red-shuai .xq-char', fontState);
    }

    const png = await browser.screenshot('png');
    const pngInfo = pngSize(png);
    if (pngInfo.width !== card.width || pngInfo.height !== card.height) {
      throw new Error(
        `${set}/png/${card.name}.png is ${pngInfo.width}x${pngInfo.height}, ` +
        `expected ${card.width}x${card.height}`
      );
    }
    if (png.length === 0) throw new Error(`${set}/png/${card.name}.png is empty`);
    fs.writeFileSync(path.join(pngDir, `${card.name}.png`), png);
    pngBytes += png.length;

    const webp = await browser.screenshot('webp', opts.quality);
    const webpInfo = webpSize(webp);
    if (webpInfo.width !== card.width || webpInfo.height !== card.height) {
      throw new Error(
        `${set}/webp/${card.name}.webp is ${webpInfo.width}x${webpInfo.height}, ` +
        `expected ${card.width}x${card.height}`
      );
    }
    if (webp.length === 0) throw new Error(`${set}/webp/${card.name}.webp is empty`);
    if (!webpInfo.alpha) {
      throw new Error(`${set}/webp/${card.name}.webp has no alpha channel`);
    }
    fs.writeFileSync(path.join(webpDir, `${card.name}.webp`), webp);
    webpBytes += webp.length;

    console.log(
      `[deck] ${set.padEnd(7)} ${card.name.padEnd(13)} ` +
      `${webpInfo.width}x${webpInfo.height}  webp ${webp.length} B  png ${png.length} B`
    );
  }

  // Cards used to live directly under decks/<set>/. The committed layout is
  // now png/ (master) + webp/ (product); remove only root-level card files.
  for (const entry of fs.readdirSync(outDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(png|webp)$/i.test(entry.name)) {
      fs.rmSync(path.join(outDir, entry.name), { force: true });
    }
  }

  return {
    count: cards.length,
    bytes: webpBytes,
    masterBytes: pngBytes,
    usedElements: [...usedElements],
  };
}

async function probeFont(browser, selector, label, fontState) {
  try {
    const fonts = await browser.platformFonts(selector);
    if (fonts) fontState.probes.push({ label, fonts });
  } catch (err) {
    fontState.probes.push({ label, error: err.message });
  }
}

/* ---------------------------------------------------------------- previews */

const PREVIEW = {
  poker: { width: 1800, height: 900 },
  mahjong: { width: 34 * 134 + 120, height: 300 },
  xiangqi: { width: 14 * 232 + 120, height: 340 },
};

function previewCss() {
  return `
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    background: #141210;
  }
  .stage {
    position: relative;
    overflow: hidden;
    background:
      radial-gradient(90% 80% at 50% 0%, rgba(200, 160, 100, 0.10), rgba(200, 160, 100, 0) 60%),
      #141210;
  }
  .card {
    position: absolute;
    display: block;
    filter: drop-shadow(0 14px 16px rgba(0, 0, 0, 0.52));
  }
  .caption {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 16px;
    letter-spacing: 1.4px;
    color: #cbbfa7;
    white-space: nowrap;
  }
`;
}

function previewHtml(set, outDir, css) {
  const fileUrl = (name) => pathToFileURL(path.join(outDir, set, 'webp', `${name}.webp`)).href;
  const parts = [];
  let width;
  let height;
  let caption;

  if (set === 'poker') {
    width = PREVIEW.poker.width;
    height = PREVIEW.poker.height;
    const names = ['AH', '2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH', 'joker-red', 'joker-black'];
    const n = names.length;
    const R = 1100;
    const cx = width / 2;
    const cy = 1350;
    const spread = 70;
    const w = Math.round(256 * 0.72);
    const h = Math.round(358 * 0.72);
    names.forEach((name, i) => {
      const deg = -spread / 2 + (i * spread) / (n - 1);
      const rad = (deg * Math.PI) / 180;
      const x = cx + R * Math.sin(rad);
      const y = cy - R * Math.cos(rad);
      parts.push(
        `<img class="card" alt="" src="${escapeAttr(fileUrl(name))}" ` +
        `style="left:${x.toFixed(2)}px;top:${y.toFixed(2)}px;width:${w}px;height:${h}px;` +
        `transform:translate(-50%,-50%) rotate(${deg.toFixed(2)}deg);z-index:${i + 1}">`
      );
    });
    caption = 'POKER · 54 cards · 256×358 · A–K hearts + both jokers';
  } else if (set === 'mahjong') {
    width = PREVIEW.mahjong.width;
    height = PREVIEW.mahjong.height;
    const names = [
      ...Array.from({ length: 9 }, (_, i) => `${i + 1}w`),
      ...Array.from({ length: 9 }, (_, i) => `${i + 1}t`),
      ...Array.from({ length: 9 }, (_, i) => `${i + 1}s`),
      'east', 'south', 'west', 'north', 'red', 'green', 'white',
    ];
    const w = Math.round(256 * 0.5);
    const h = Math.round(340 * 0.5);
    names.forEach((name, i) => {
      const x = 60 + i * 134;
      const y = 58;
      parts.push(
        `<img class="card" alt="" src="${escapeAttr(fileUrl(name))}" ` +
        `style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${i + 1}">`
      );
    });
    caption = 'MAHJONG · 34 tiles · 256×340 · 1–9 万 / 1–9 筒 / 1–9 条 / 東南西北中發白';
  } else {
    width = PREVIEW.xiangqi.width;
    height = PREVIEW.xiangqi.height;
    const names = XIANGQI.map((x) => x.name);
    const w = Math.round(256 * 0.85);
    const h = Math.round(300 * 0.85);
    names.forEach((name, i) => {
      const x = 60 + i * 232;
      const y = 32;
      parts.push(
        `<img class="card" alt="" src="${escapeAttr(fileUrl(name))}" ` +
        `style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;z-index:${i + 1}">`
      );
    });
    caption = 'XIANGQI · 14 pieces · 256×300 · 帥仕相馬車炮兵 / 將士象馬車砲卒';
  }

  return {
    width,
    height,
    html: pageHtml(
      `<div class="stage" style="width:${width}px;height:${height}px">` +
      parts.join('\n') +
      `<div class="caption" style="top:${height - 52}px">${caption}</div>` +
      '</div>',
      width,
      height,
      css
    ),
  };
}

async function renderPreviews(browser, outDir, sets, tmpDir) {
  const previewDir = path.join(outDir, '_preview');
  fs.mkdirSync(previewDir, { recursive: true });
  const css = previewCss();
  const results = [];

  for (const set of sets) {
    const names = set === 'poker'
      ? ['AS', 'KH', '10D', 'joker-red', 'joker-black']
      : set === 'mahjong'
        ? ['1w', '9w', '1t', '5t', '1s', 'east', 'red']
        : XIANGQI.map((x) => x.name);
    const missing = names.filter((n) => !fs.existsSync(path.join(outDir, set, 'webp', `${n}.webp`)));
    if (missing.length) {
      console.log(`[deck] preview ${set}: skipped, missing ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? '…' : ''}`);
      continue;
    }

    const preview = previewHtml(set, outDir, css);
    const htmlPath = path.join(tmpDir, `preview-${set}.html`);
    fs.writeFileSync(htmlPath, preview.html);
    await browser.load(pathToFileURL(htmlPath).href, preview.width, preview.height);
    const png = await browser.screenshot();
    const size = pngSize(png);
    if (size.width !== preview.width || size.height !== preview.height) {
      throw new Error(`preview ${set} is ${size.width}x${size.height}, expected ${preview.width}x${preview.height}`);
    }
    const outFile = path.join(previewDir, `${set === 'poker' ? 'poker-fan' : `${set}-row`}.png`);
    fs.writeFileSync(outFile, png);
    results.push({ file: outFile, width: size.width, height: size.height, bytes: png.length });
    console.log(`[deck] preview ${set.padEnd(7)} ${path.relative(ROOT, outFile)}  ${size.width}x${size.height}  ${png.length} B`);
  }
  return results;
}

/* -------------------------------------------------------------------- main */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`deck: ${err.message}\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  if (opts.help) { console.log(usage()); return; }

  if (opts.all) opts.sets = ['poker', 'mahjong', 'xiangqi'];
  if (!opts.sets.length && !opts.list && !opts.preview) {
    console.error(`deck: pick --all or --set <poker|mahjong|xiangqi>\n\n${usage()}`);
    process.exitCode = 2;
    return;
  }

  const elems = loadElements(opts.elements);
  const allCards = {};
  for (const set of opts.sets) allCards[set] = SETS[set]();

  if (opts.list) {
    for (const set of Object.keys(SETS)) {
      const cards = SETS[set]();
      console.log(`${set.padEnd(8)} ${String(cards.length).padStart(2)} cards: ${cards.map((c) => c.name).join(' ')}`);
    }
    console.log('');
    console.log(`elements dir: ${path.relative(ROOT, opts.elements) || opts.elements}`);
    console.log('output: <set>/webp/<name>.webp (site q0.9)  +  <set>/png/<name>.png (masters)');
    const missing = missingElements(elems, ELEMENT_NAMES);
    for (const name of ELEMENT_NAMES) {
      const el = elems.get(name);
      if (!el) {
        console.log(`  MISSING  ${name}@2x.png   -> ${FALLBACK_NOTES[name]}`);
      } else {
        const b = el.bbox;
        console.log(
          `  present  ${name}@2x.png   alpha bbox ${b.w}x${b.h} at ${b.x},${b.y} ` +
          `of ${b.width}x${b.height}`
        );
      }
    }
    console.log(`  ${missing.length === 0 ? 'all element carriers present' : `${missing.length} missing, fallbacks ready`}`);
    return;
  }

  const chrome = findChrome();
  const css = fs.readFileSync(CSS_FILE, 'utf8');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-deck-'));
  const profileDir = path.join(tmpDir, 'chrome-profile');
  const fontState = { checked: false, available: null, probes: [] };
  const totals = {};
  let browser;

  try {
    browser = await CdpBrowser.launch(chrome, profileDir, tmpDir);

    if (opts.sets.length) {
      fs.mkdirSync(opts.out, { recursive: true });
      for (const set of opts.sets) {
        const result = await renderSet(browser, set, allCards[set], elems, opts, css, tmpDir, fontState);
        totals[set] = result;
      }
    }

    const wantPreview = !opts.noPreview && (opts.preview || opts.all);
    if (wantPreview) {
      const previewSets = opts.sets.length ? opts.sets : ['poker', 'mahjong', 'xiangqi'];
      await renderPreviews(browser, opts.out, previewSets, tmpDir);
    }
  } finally {
    if (browser) await browser.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch { /* temp dir can stay */ }
  }

  if (Object.keys(totals).length) {
    let count = 0;
    let bytes = 0;
    let masterBytes = 0;
    for (const set of Object.keys(totals)) {
      count += totals[set].count;
      bytes += totals[set].bytes;
      masterBytes += totals[set].masterBytes;
      const avg = Math.round(totals[set].bytes / totals[set].count);
      console.log(
        `[deck] ${set.padEnd(8)} ${totals[set].count} cards  webp ${totals[set].bytes} B  ` +
        `avg ${avg} B  |  png masters ${totals[set].masterBytes} B`
      );
    }
    console.log(
      `[deck] TOTAL    ${count} cards  webp ${bytes} B  avg ${Math.round(bytes / count)} B  ` +
      `|  png masters ${masterBytes} B`
    );

    const expected = [];
    for (const set of Object.keys(totals)) expected.push(...SET_ELEMENTS[set]);
    const missing = [...new Set(missingElements(elems, expected))];
    if (missing.length) {
      console.log('');
      console.log(`[deck] MISSING ELEMENTS (${missing.length}) — code fallbacks used, no ENOENT / no crash:`);
      for (const name of missing) console.log(`  - ${name}@2x.png   -> ${FALLBACK_NOTES[name] || 'code fallback'}`);
      console.log(`[deck] elements dir checked: ${path.relative(ROOT, opts.elements) || opts.elements}`);
    } else {
      console.log('[deck] all expected element carriers present');
    }

    if (fontState.available) {
      console.log('');
      console.log('[deck] fonts (document.fonts.check):');
      for (const [family, info] of Object.entries(fontState.available)) {
        console.log(`  ${family.padEnd(16)} available=${info.available}  hanzi=${info.hanzi}`);
      }
    }
    if (fontState.probes.length) {
      console.log('[deck] platform font actually used (CSS.getPlatformFontsForNode):');
      for (const probe of fontState.probes) {
        if (probe.error) {
          console.log(`  ${probe.label.padEnd(24)} ERROR ${probe.error}`);
          continue;
        }
        const text = probe.fonts && probe.fonts.length
          ? probe.fonts.map((f) => `${f.family}${f.postScript ? ` (${f.postScript})` : ''} glyphs=${f.glyphs}`).join(', ')
          : 'no font reported';
        console.log(`  ${probe.label.padEnd(24)} ${text}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`deck: ${err.message}`);
  process.exitCode = 1;
});
