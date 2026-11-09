#!/usr/bin/env node
/**
 * export-cardart.mjs — export all 102 card faces + one gallery PNG.
 *
 * Run: node games/boardgame/app/export-cardart.mjs
 *
 * Output:
 *   games/boardgame/assets/cardart/poker/*.png      (54, 2x, transparent)
 *   games/boardgame/assets/cardart/mahjong/*.png    (34, 2x, transparent)
 *   games/boardgame/assets/cardart/chess/*.png      (14, 2x, transparent)
 *   games/boardgame/assets/cardart/gallery.png      (1200x800 whole table)
 *
 * The page is opened with ?export=1, every face is rendered through the same
 * 3D scene (perspective 1600 / rotateX 52 / rotateZ -14 + contact shadow),
 * then screenshotted element-by-element at deviceScaleFactor 2.
 */

import http from 'node:http';
import { readFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pokerCards, mahjongTiles, chessPieces } from './cardart.js';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(ROOT, 'games/boardgame/assets/cardart');
const MAX_BYTES_PER_FILE = 100 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/games/boardgame/demo/cardart.html';
      const file = path.normalize(path.join(ROOT, pathname));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  try {
    return req('playwright');
  } catch {
    /* keep looking */
  }
  const candidates = [
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/@playwright/test/package.json'),
    path.join(process.env.HOME || '', '.npm-global/lib/node_modules/playwright/package.json'),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return createRequire(candidate)('playwright');
    } catch {
      /* next */
    }
  }
  throw new Error('Playwright module not found (looked in local deps and ~/.npm-global)');
}

async function launchChrome(chromium) {
  try {
    return await chromium.launch({ headless: true, channel: 'chrome' });
  } catch {
    const fallback = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(fallback)) throw new Error('Neither Playwright Chromium nor Google Chrome is installed');
    return chromium.launch({ headless: true, executablePath: fallback });
  }
}

/** Read width/height/color-type straight from the PNG IHDR chunk. */
function pngChunks(buffer) {
  const types = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    types.push(type);
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return types;
}

async function pngInfo(file) {
  const buffer = await readFile(file);
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error(`not a PNG: ${file}`);
  const chunks = pngChunks(buffer);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
    hasTRNS: chunks.includes('tRNS'),
    bytes: buffer.length,
  };
}

function verifyAlphaWithPillow(root) {
  const script = `
import sys
from pathlib import Path
from PIL import Image
root = Path(sys.argv[1])
bad = []
for path in sorted(root.rglob('*.png')):
    if 'textures' in path.parts or path.name == 'gallery.png':
        continue
    image = Image.open(path).convert('RGBA')
    corners = [
        image.getpixel((0, 0)),
        image.getpixel((image.width - 1, 0)),
        image.getpixel((0, image.height - 1)),
        image.getpixel((image.width - 1, image.height - 1)),
    ]
    if any(pixel[3] != 0 for pixel in corners):
        bad.append(path.name)
print(f'alpha margin: {102 - len(bad)}/102 cards transparent, {len(bad)} opaque')
if bad:
    print('opaque corners:', ', '.join(bad[:8]))
    sys.exit(1)
`;
  try {
    const out = execFileSync('python3', ['-I', '-c', script, root], { encoding: 'utf8' }).trim();
    console.log(out);
    return true;
  } catch (error) {
    console.log(String(error.stdout || error.message).trim());
    return false;
  }
}

function compressWithPillow(root) {
  const script = `
import sys
from pathlib import Path
from PIL import Image
root = Path(sys.argv[1])
for path in sorted(root.rglob('*.png')):
    if 'textures' in path.parts:
        continue
    image = Image.open(path).convert('RGBA')
    quantized = image.quantize(colors=256, method=Image.FASTOCTREE, dither=Image.FLOYDSTEINBERG)
    quantized.save(path, optimize=True)
`;
  try {
    execFileSync('python3', ['-I', '-c', script, root], { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.log(`WARN  PNG compression skipped: ${error.message.split('\n')[0]}`);
    return false;
  }
}

function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'textures') continue;
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith('.png')) out.push(full);
  }
  return out.sort();
}

let server;
let browser;
try {
  const { chromium } = loadPlaywright();
  const started = await startServer();
  server = started.server;
  const base = `http://127.0.0.1:${started.port}`;

  // Keep assets/cardart/textures/; only regenerate the item dirs + gallery.
  for (const dir of ['poker', 'mahjong', 'chess']) {
    await rm(path.join(OUT, dir), { recursive: true, force: true });
  }
  await rm(path.join(OUT, 'gallery.png'), { force: true });
  await mkdir(OUT, { recursive: true });

  browser = await launchChrome(chromium);

  const groups = [
    ['poker', pokerCards()],
    ['mahjong', mahjongTiles()],
    ['chess', chessPieces()],
  ];
  const all = groups.flatMap(([, items]) => items);
  if (all.length !== 102) throw new Error(`expected 102 items, got ${all.length}`);

  const consoleErrors = [];
  const failedRequests = [];
  const textureRequests = new Set();
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err}`));
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText || ''}`));
  page.on('request', (req) => {
    if (req.url().includes('/textures/')) textureRequests.add(req.url());
  });

  await page.goto(`${base}/games/boardgame/demo/cardart.html?export=1`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__CARDART_READY__ === true && window.__CARDART_TEXTURES_READY__ === true && window.cardartExport,
    { timeout: 15000 },
  );
  await page.evaluate(() => document.fonts.ready);

  const frame = page.locator('.export-frame');
  let exported = 0;
  for (const item of all) {
    await page.evaluate(async (id) => {
      window.cardartExport.render(id);
      await document.fonts.ready;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, item.id);

    const actual = await frame.getAttribute('data-export-id');
    if (actual !== item.id) throw new Error(`frame mismatch: expected ${item.id}, got ${actual}`);

    const box = await frame.boundingBox();
    if (!box) throw new Error(`no bounding box for ${item.id}`);
    const target = path.join(OUT, item.exportPath);
    await mkdir(path.dirname(target), { recursive: true });
    // page.screenshot (not locator.screenshot) is required for a real alpha channel.
    await page.screenshot({
      path: target,
      clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
      omitBackground: true,
      animations: 'disabled',
    });
    exported += 1;
    if (exported % 20 === 0) console.log(`  exported ${exported}/${all.length}`);
  }
  await context.close();

  // Gallery: 1200x800, deviceScaleFactor 1, whole table.
  const galleryContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const galleryPage = await galleryContext.newPage();
  galleryPage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  galleryPage.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err}`));
  galleryPage.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText || ''}`));
  galleryPage.on('request', (req) => {
    if (req.url().includes('/textures/')) textureRequests.add(req.url());
  });
  await galleryPage.goto(`${base}/games/boardgame/demo/cardart.html?export=1`, { waitUntil: 'load' });
  await galleryPage.waitForFunction(
    () => window.__CARDART_READY__ === true && window.__CARDART_TEXTURES_READY__ === true && window.cardartExport,
    { timeout: 15000 },
  );
  await galleryPage.evaluate(async () => {
    window.cardartExport.render('__gallery__');
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const galleryPath = path.join(OUT, 'gallery.png');
  const galleryBox = await galleryPage.locator('.export-frame').boundingBox();
  if (!galleryBox) throw new Error('no bounding box for gallery');
  await galleryPage.screenshot({
    path: galleryPath,
    clip: {
      x: Math.round(galleryBox.x),
      y: Math.round(galleryBox.y),
      width: Math.round(galleryBox.width),
      height: Math.round(galleryBox.height),
    },
    omitBackground: true,
    animations: 'disabled',
  });
  await galleryContext.close();

  /* --------------------------- compress PNGs --------------------------- */
  console.log('\n== compress (Pillow, 256-color palette) ==');
  const compressed = compressWithPillow(OUT);
  console.log(compressed ? 'compressed all PNGs in place' : 'compression unavailable; keeping raw PNGs');
  const alphaOk = verifyAlphaWithPillow(OUT);

  /* ------------------------------ report ------------------------------ */
  console.log('\n== exported files ==');
  const files = await walk(OUT);
  const itemFiles = files.filter((file) => !file.endsWith('gallery.png'));
  console.log(`item PNGs:    ${itemFiles.length} (expected 102)`);
  console.log(`gallery PNG:  ${existsSync(galleryPath) ? 1 : 0} (gallery.png)`);
  console.log(`total files:  ${files.length}`);

  for (const [kind, items] of groups) {
    const dir = path.join(OUT, kind);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.png'));
    console.log(`  ${kind}:      ${names.length} (expected ${items.length})`);
  }

  const infos = [];
  for (const file of files) infos.push({ file, ...(await pngInfo(file)) });
  const itemInfos = infos.filter((info) => !info.file.endsWith('gallery.png'));
  const galleryInfo = infos.find((info) => info.file.endsWith('gallery.png'));
  const sizes = itemInfos.map((info) => info.bytes);
  const totalBytes = infos.reduce((sum, info) => sum + info.bytes, 0);

  const textureDir = path.join(OUT, 'textures');
  const textureFiles = (await readdir(textureDir)).filter((name) => name.endsWith('.png')).sort();
  const textureInfos = [];
  for (const name of textureFiles) textureInfos.push({ name, ...(await pngInfo(path.join(textureDir, name))) });
  const textureBytes = textureInfos.reduce((sum, info) => sum + info.bytes, 0);

  console.log('\n== size / dimensions ==');
  console.log(`item size:    min ${formatKB(Math.min(...sizes))} / max ${formatKB(Math.max(...sizes))} / avg ${formatKB(sizes.reduce((a, b) => a + b, 0) / sizes.length)}`);
  console.log(`total bytes:  ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(2)} MB, limit 15 MB)`);
  console.log(`textures:     ${textureInfos.length} files, ${(textureBytes / 1024).toFixed(1)} KB, ${textureInfos.map((i) => `${i.name}:${i.width}x${i.height}/${(i.bytes / 1024).toFixed(0)}KB`).join(' ')}`);
  console.log(`all assets:   ${totalBytes + textureBytes} bytes (${((totalBytes + textureBytes) / 1024 / 1024).toFixed(2)} MB incl. textures)`);
  console.log(`item pixels:  ${itemInfos[0].width}x${itemInfos[0].height} @2x (expected 720x840)`);
  console.log(`gallery:      ${galleryInfo ? `${galleryInfo.width}x${galleryInfo.height}` : 'MISSING'} (expected 1200x800)`);
  console.log(`item alpha:   colorType ${[...new Set(itemInfos.map((i) => i.colorType))].join(',')} / tRNS ${itemInfos.every((i) => i.hasTRNS) ? 'all' : 'partial'} (6 = RGBA, 3+tRNS = palette alpha)`);

  const wrongDims = itemInfos.filter((info) => info.width !== 720 || info.height !== 840);
  const badAlpha = itemInfos.filter((info) => !(info.colorType === 6 || (info.colorType === 3 && info.hasTRNS)));
  const oversize = infos.filter((info) => info.bytes > MAX_BYTES_PER_FILE);

  console.log('\n== spot checks (file + sips) ==');
  const samples = [
    itemInfos.find((info) => info.file.includes(`${path.sep}poker${path.sep}AS.png`)),
    itemInfos.find((info) => info.file.includes(`${path.sep}mahjong${path.sep}tong-5.png`)),
    itemInfos.find((info) => info.file.includes(`${path.sep}chess${path.sep}red-shuai.png`)),
    galleryInfo,
  ].filter(Boolean);

  for (const sample of samples) {
    const fileOut = execFileSync('file', [sample.file], { encoding: 'utf8' }).trim();
    const sipsOut = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', sample.file], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter((line) => /pixelWidth|pixelHeight/.test(line))
      .map((line) => line.trim())
      .join(', ');
    console.log(`${path.relative(ROOT, sample.file)}`);
    console.log(`  file: ${fileOut}`);
    console.log(`  sips: ${sipsOut}`);
  }

  console.log('\n== checks ==');
  const checks = [
    ['102 item PNGs', itemFiles.length === 102],
    ['gallery.png exists', Boolean(galleryInfo)],
    ['all item PNGs are 720x840', wrongDims.length === 0],
    ['all item PNGs have alpha (RGBA or palette+tRNS)', badAlpha.length === 0],
    ['transparent corners on all 102 item PNGs', alphaOk],
    ['every file <= 100 KB', oversize.length === 0],
    ['total <= 15 MB', totalBytes + textureBytes <= MAX_TOTAL_BYTES],
    ['6 local material textures', textureInfos.length === 6 && textureInfos.every((i) => i.width === 512 && i.height === 512)],
    ['texture requests = 6', textureRequests.size === 6],
    ['no failed requests', failedRequests.length === 0],
    ['gallery is 1200x800', Boolean(galleryInfo) && galleryInfo.width === 1200 && galleryInfo.height === 800],
    ['console errors = 0', consoleErrors.length === 0],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);

  if (oversize.length) {
    console.log('\noversize files:');
    for (const info of oversize) console.log(`  ${path.relative(ROOT, info.file)} ${formatKB(info.bytes)}`);
  }
  if (wrongDims.length) {
    console.log('\nwrong dimensions:');
    for (const info of wrongDims.slice(0, 10)) console.log(`  ${path.relative(ROOT, info.file)} ${info.width}x${info.height}`);
  }
  if (consoleErrors.length) {
    console.log('\nconsole errors:');
    for (const error of consoleErrors) console.log(`  ${error}`);
  }

  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(`\n== summary ==\n${checks.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
} catch (error) {
  console.error('\nEXPORT ERROR:', error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
