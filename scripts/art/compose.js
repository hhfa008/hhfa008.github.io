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

function buildItems(scene, width, height, elementsDir, missing) {
  const unit = Math.min(width, height);
  const parts = [];

  for (const item of scene.items) {
    const size = item.scale * unit;
    const cx = item.x * width;
    const cy = item.y * height;
    const rot = item.rot || 0;
    const shadow = item.shadow !== false;

    const style = `left:${round(cx)}px;top:${round(cy)}px;width:${round(size)}px;height:${round(size)}px`;

    const file = path.join(elementsDir, `${item.el}@2x.png`);
    const present = fs.existsSync(file);

    // Contact shadow sits at the bottom of the element box. It is drawn behind
    // the element, so any overlap with the artwork is hidden by the PNG itself.
    // Missing elements are debug placeholders: no pretend contact shadow.
    let contact = '';
    if (shadow && present) {
      const cw = size * 0.58;
      const ch = size * 0.18;
      contact =
        `<div class="contact" style="width:${round(cw)}px;height:${round(ch)}px;` +
        `left:${round((size - cw) / 2)}px;top:${round(size * 0.83)}px"></div>`;
    }

    if (present) {
      const src = pathToFileURL(file).href;
      const dx = round(unit * 0.018);
      const dy = round(unit * 0.030);
      const blur = round(unit * 0.035);
      const filter = shadow ? ` style="filter:drop-shadow(${dx}px ${dy}px ${blur}px rgba(0,0,0,0.62))"` : '';
      parts.push(
        `<div class="item" style="${style}">${contact}` +
          `<div class="shadowwrap"${filter}>` +
          `<img src="${escapeHtml(src)}" alt="" style="transform:rotate(${round(rot)}deg)">` +
          `</div></div>`
      );
    } else {
      missing.add(item.el);
      const fontSize = round(Math.max(9, Math.min(18, size * 0.07)));
      parts.push(
        `<div class="item" style="${style}">${contact}` +
          `<div class="ph" style="font-size:${fontSize}px">` +
          `<span>${escapeHtml(item.el)}</span>` +
          `</div></div>`
      );
    }
  }

  return parts.join('\n  ');
}

function buildHtml(scene, background, itemsHtml, width, height) {
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  return template
    .replace(/\{\{BACKGROUND\}\}/g, background)
    .replace(/\{\{WIDTH\}\}/g, String(width))
    .replace(/\{\{HEIGHT\}\}/g, String(height))
    .replace(/\{\{W\}\}/g, String(width))
    .replace(/\{\{H\}\}/g, String(height))
    .replace('{{ITEMS}}', itemsHtml);
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
  fs.mkdirSync(opts.out, { recursive: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-compose-'));
  const profileDir = path.join(tmpDir, 'chrome-profile');
  const results = [];

  try {
    for (const { suffix, width, height } of SIZES) {
      const itemsHtml = buildItems(scene, width, height, opts.elements, missing);
      const html = buildHtml(scene, scene.background, itemsHtml, width, height);
      const htmlPath = path.join(tmpDir, `${slug}-${suffix}.html`);
      fs.writeFileSync(htmlPath, html);

      const outPath = path.join(opts.out, `${slug}-${suffix}.png`);
      const bytes = screenshot(chrome, htmlPath, outPath, width, height, profileDir);
      results.push({ file: outPath, width, height, bytes });
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { results, missing: [...missing] };
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

  for (const slug of targets) {
    const { results, missing } = renderScene(slug, scenes[slug], opts, chrome);
    for (const file of missing) {
      if (!allMissing.has(file)) allMissing.set(file, new Set());
      allMissing.get(file).add(slug);
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
