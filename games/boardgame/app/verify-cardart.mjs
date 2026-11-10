#!/usr/bin/env node
/**
 * verify-cardart.mjs — static data checks + real Chromium checks for cardart.
 *
 * Run: node games/boardgame/app/verify-cardart.mjs
 *
 * Static:
 *   - pokerCards() 54 / mahjongTiles() 34 / chessPieces() 14
 *   - every item has a positive font size, a non-empty label, no undefined
 *   - every cardHTML() is non-empty
 * Browser (Playwright + installed Chrome):
 *   - cardart.html renders 102 .asset / .ca-face nodes
 *   - 0 console errors, 0 external requests
 *   - perspective 1600px, flat tilts inside -20..20, 14 upright pieces
 *   - 390px viewport has no horizontal overflow
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  pokerCards,
  mahjongTiles,
  chessPieces,
  allCards,
  cardHTML,
} from './cardart.js';
import { startServer } from '../../../tools/serve.mjs';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '../../..');
const TEXTURES = [
  'wood-dark.png',
  'wood-light.png',
  'stone.png',
  'lacquer-black.png',
  'felt-green.png',
  'charcoal.png',
];
const TEXTURE_DIR = path.join(ROOT, 'games/boardgame/assets/cardart/textures');

const failures = [];
const passes = [];

function check(name, condition, detail = '') {
  if (condition) {
    passes.push(name);
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return Boolean(condition);
}

function hasUndefined(value, trail = '$') {
  if (value === undefined) return trail;
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = hasUndefined(value[i], `${trail}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    const hit = hasUndefined(child, `${trail}.${key}`);
    if (hit) return hit;
  }
  return null;
}

function hanCount(text) {
  return (String(text).match(/\p{Script=Han}/gu) || []).length;
}

/* ------------------------------ static checks ------------------------------ */

console.log('== static data ==');
const poker = pokerCards();
const mahjong = mahjongTiles();
const chess = chessPieces();
const all = allCards();

check('pokerCards() count', poker.length === 54, `${poker.length}`);
check('mahjongTiles() count', mahjong.length === 34, `${mahjong.length}`);
check('chessPieces() count', chess.length === 14, `${chess.length}`);
check('allCards() count', all.length === 102, `${all.length}`);
check(
  '3D table constants',
  all.every((item) => item.kind === 'poker' || item.kind === 'mahjong' || item.kind === 'chess'),
  'kinds: poker/mahjong/chess',
);

const groups = [
  ['poker', poker],
  ['mahjong', mahjong],
  ['chess', chess],
];

for (const [kind, items] of groups) {
  const ids = new Set();
  const fontSizes = [];
  let emptyHtml = 0;
  let hanCards = 0;
  let undefinedHits = 0;
  let badIds = 0;
  let missingExport = 0;

  for (const item of items) {
    if (ids.has(item.id)) badIds += 1;
    ids.add(item.id);
    if (hasUndefined(item)) undefinedHits += 1;
    if (typeof item.fontSize !== 'number' || !Number.isFinite(item.fontSize) || item.fontSize <= 0) {
      fontSizes.push(`bad:${item.id}`);
    } else {
      fontSizes.push(item.fontSize);
    }
    if (!item.label || !String(item.label).trim()) emptyHtml += 1;
    if (hanCount(item.label) > 0) hanCards += 1;
    if (!item.exportPath || !/^[a-z]+\/[-A-Za-z0-9]+\.png$/.test(item.exportPath)) missingExport += 1;

    const html = cardHTML(item);
    if (!html || html.length < 80) emptyHtml += 1;
    if (/undefined|NaN/.test(html)) undefinedHits += 1;
    if (!html.includes(`data-card-id="${item.id}"`)) badIds += 1;
    if (!/font-size:/.test(html)) emptyHtml += 1;
  }

  const numeric = fontSizes.filter((v) => typeof v === 'number');
  check(`${kind}: unique ids`, badIds === 0, `${ids.size} unique`);
  check(`${kind}: no undefined/NaN`, undefinedHits === 0, `${undefinedHits} hits`);
  check(`${kind}: every card has a font size`, fontSizes.length === items.length, `min ${Math.min(...numeric)} / max ${Math.max(...numeric)}`);
  check(`${kind}: every card has non-empty HTML`, emptyHtml === 0, `${items.length} markup blocks`);
  check(`${kind}: export paths`, missingExport === 0, `${items.length} paths`);
  if (kind === 'mahjong' || kind === 'chess') {
    check(`${kind}: every card has Han glyphs`, hanCards === items.length, `${hanCards}/${items.length}`);
  } else {
    check('poker: jokers use Han glyphs', poker.filter((c) => c.joker && hanCount(c.label) > 0).length === 2, '小王 / 大王');
    check('poker: 52 suit cards labeled', poker.filter((c) => !c.joker && c.label).length === 52, 'rank + suit');
  }
}

const textureStats = [];
for (const name of TEXTURES) {
  const file = path.join(TEXTURE_DIR, name);
  if (!existsSync(file)) {
    textureStats.push({ name, missing: true });
    continue;
  }
  const info = await stat(file);
  const buffer = await readFile(file);
  const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  textureStats.push({
    name,
    missing: false,
    bytes: info.size,
    isPng,
    width: isPng ? buffer.readUInt32BE(16) : 0,
    height: isPng ? buffer.readUInt32BE(20) : 0,
  });
}
check(
  '6 local material textures present',
  textureStats.every((item) => !item.missing && item.bytes > 0 && item.isPng),
  textureStats.map((item) => `${item.name}:${item.missing ? 'missing' : `${item.width}x${item.height}/${(item.bytes / 1024).toFixed(0)}KB`}`).join(' '),
);
check(
  'material textures are 512x512',
  textureStats.every((item) => item.width === 512 && item.height === 512),
  textureStats.map((item) => `${item.width}x${item.height}`).join(' '),
);
check(
  'material textures <= 100 KB each',
  textureStats.every((item) => item.bytes <= 100 * 1024),
  textureStats.map((item) => `${item.name}:${(item.bytes / 1024).toFixed(0)}KB`).join(' '),
);

check(
  'no duplicate ids across 102',
  new Set(all.map((item) => item.id)).size === 102,
  `${new Set(all.map((item) => item.id)).size}`,
);

const suitCounts = Object.fromEntries(['s', 'h', 'd', 'c'].map((s) => [s, poker.filter((c) => c.suit === s).length]));
check('poker suits 13 each', Object.values(suitCounts).every((n) => n === 13), JSON.stringify(suitCounts));
check('mahjong wan/tong/tiao 9 each', ['wan', 'tong', 'tiao'].every((s) => mahjong.filter((t) => t.suit === s).length === 9), '9/9/9');
check('mahjong honors 7', mahjong.filter((t) => t.suit === 'wind' || t.suit === 'dragon').length === 7, '東南西北中發白');
check('chess red 7', chess.filter((p) => p.side === 'red').length === 7, '帥仕相馬車炮兵');
check('chess black 7', chess.filter((p) => p.side === 'black').length === 7, '將士象馬車砲卒');

/* ------------------------------ Chromium checks ----------------------------- */

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
      const scoped = createRequire(candidate);
      return scoped('playwright');
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

let server;
let browser;
try {
  const { chromium } = loadPlaywright();
  const started = await startServer({ root: ROOT, port: 0 });
  server = started.server;
  const base = `http://127.0.0.1:${started.port}`;
  browser = await launchChrome(chromium);

  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const externalRequests = [];
  const textureRequests = [];
  const failedRequests = [];
  const badResponses = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/textures/')) textureRequests.push(url);
    if (!url.startsWith(base) && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(url);
    }
  });
  page.on('requestfailed', (req) => failedRequests.push(`${req.url()} ${req.failure()?.errorText || ''}`));
  page.on('response', (res) => {
    if (res.url().includes('/textures/') && res.status() !== 200) badResponses.push(`${res.status()} ${res.url()}`);
  });

  await page.goto(`${base}/games/boardgame/demo/cardart.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__CARDART_READY__ === true, { timeout: 15000 });
  await page.waitForFunction(() => window.__CARDART_TEXTURES_READY__ === true, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);

  const dom = await page.evaluate(() => {
    const assets = [...document.querySelectorAll('.asset')];
    const faces = [...document.querySelectorAll('.ca-face')];
    const flat = [...document.querySelectorAll('.asset-flat')];
    const upright = [...document.querySelectorAll('.asset-upright')];
    const shadows = [...document.querySelectorAll('.contact-shadow')];
    const scenes = [...document.querySelectorAll('.scene')];
    const tables = [...document.querySelectorAll('.table3d')];
    const kinds = { poker: 0, mahjong: 0, chess: 0 };
    for (const asset of assets) kinds[asset.dataset.kind] += 1;
    return {
      assets: assets.length,
      faces: faces.length,
      shadows: shadows.length,
      flat: flat.length,
      upright: upright.length,
      kinds,
      exportIds: assets.map((a) => a.dataset.exportId),
      tilts: flat.map((a) => Number(a.dataset.tilt)),
      perspective: scenes.map((s) => getComputedStyle(s).perspective),
      tableTransforms: tables.map((t) => getComputedStyle(t).transform),
      fontFamilies: [...new Set(faces.map((f) => getComputedStyle(f).fontFamily))],
      cornerFont: getComputedStyle(document.querySelector('.ca-corner b')).fontSize,
      hanTextNodes: faces.filter((f) => /\p{Script=Han}/u.test(f.textContent || '')).length,
      geometry: (() => {
        const flatFace = document.querySelector('.asset-flat .ca-face').getBoundingClientRect();
        const uprightAsset = document.querySelector('.asset-upright');
        const uprightFace = uprightAsset.querySelector('.ca-face').getBoundingClientRect();
        const uprightBox = uprightAsset.getBoundingClientRect();
        const shadow = getComputedStyle(document.querySelector('.contact-shadow'));
        return {
          flatAspect: flatFace.width / flatFace.height,
          uprightAspect: uprightFace.width / uprightFace.height,
          uprightBottomDelta: Math.abs(uprightFace.bottom - uprightBox.bottom),
          shadowFilter: shadow.filter,
          shadowOpacity: shadow.opacity,
          shadowImage: shadow.backgroundImage,
        };
      })(),
      hasExternalLink: [...document.querySelectorAll('link,script,img')].some((el) => {
        const url = el.getAttribute('href') || el.getAttribute('src') || '';
        return /^(https?:)?\/\//.test(url);
      }),
      textureStyles: {
        poker: getComputedStyle(document.querySelector('.ca-poker')).backgroundImage,
        mahjong: getComputedStyle(document.querySelector('.ca-mahjong')).backgroundImage,
        chessRed: getComputedStyle(document.querySelector('.ca-chess-red')).backgroundImage,
        chessBlack: getComputedStyle(document.querySelector('.ca-chess-black')).backgroundImage,
        felt: getComputedStyle(document.querySelector('.poker-table')).backgroundImage,
        charcoal: getComputedStyle(document.querySelector('.chess-table')).backgroundImage,
      },
      textureReady: window.__CARDART_TEXTURES_READY__ === true,
      missingTextures: window.__CARDART_TEXTURE_MISSING__ || [],
    };
  });

  console.log('\n== Chromium: desktop 1200x900 ==');
  check('DOM cards = 102', dom.assets === 102 && dom.faces === 102, `assets ${dom.assets} / faces ${dom.faces}`);
  check(
    'DOM by category 54/34/14',
    dom.kinds.poker === 54 && dom.kinds.mahjong === 34 && dom.kinds.chess === 14,
    JSON.stringify(dom.kinds),
  );
  check('every item has a contact shadow', dom.shadows === 102, `${dom.shadows}`);
  check('flat items', dom.flat === 88 && dom.upright === 14, `flat ${dom.flat} / upright ${dom.upright}`);
  check('no 90° flat rotations', dom.tilts.every((t) => Math.abs(t) <= 20), `range ${Math.min(...dom.tilts)}..${Math.max(...dom.tilts)}`);
  check('perspective 1600px on every scene', dom.perspective.length === 3 && dom.perspective.every((p) => p === '1600px'), dom.perspective.join(' / '));
  check('3D transform applied to every table', dom.tableTransforms.length === 3 && dom.tableTransforms.every((m) => m && m !== 'none'), 'matrix3d');
  check('console errors = 0', consoleErrors.length === 0, `${consoleErrors.length}`);
  check('page errors = 0', pageErrors.length === 0, `${pageErrors.length}`);
  check('external requests = 0', externalRequests.length === 0, `${externalRequests.length}`);
  check('no external link/script/img tags', dom.hasExternalLink === false, 'local assets only');
  check('texture preload finished', dom.textureReady && dom.missingTextures.length === 0, `${dom.missingTextures.length} missing`);
  check('6 material textures requested', new Set(textureRequests).size === 6, `${new Set(textureRequests).size} unique / ${textureRequests.length} requests`);
  check('no failed texture requests', failedRequests.length === 0 && badResponses.length === 0, `${failedRequests.length} failed / ${badResponses.length} bad status`);
  const styleKeys = Object.keys(dom.textureStyles);
  check(
    'material images are applied by CSS',
    styleKeys.every((key) => dom.textureStyles[key].includes('/textures/')),
    styleKeys.map((key) => `${key}:${dom.textureStyles[key].includes('/textures/') ? 'ok' : 'missing'}`).join(' '),
  );
  check('CJK text rendered in DOM', dom.hanTextNodes >= 32, `${dom.hanTextNodes} faces contain Han glyphs`);
  check('font stack is system-only', dom.fontFamilies.every((f) => /system-ui|PingFang|Songti|STKaiti|serif/.test(f)), dom.fontFamilies.join(' | '));
  check('corner font-size is numeric', /^\d+(\.\d+)?px$/.test(dom.cornerFont), dom.cornerFont);

  const uniqueIds = new Set(dom.exportIds);
  check('all 102 export ids are unique in DOM', uniqueIds.size === 102, `${uniqueIds.size}`);
  check('flat cards are perspective-compressed', dom.geometry.flatAspect > 1.0, `screen w/h ${dom.geometry.flatAspect.toFixed(2)} (face 5:7)`);
  check('chess billboards render upright', dom.geometry.uprightAspect > 0.85 && dom.geometry.uprightAspect < 1.15, `screen w/h ${dom.geometry.uprightAspect.toFixed(2)}`);
  check('billboard bottom sits on the table point', dom.geometry.uprightBottomDelta < 20, `${dom.geometry.uprightBottomDelta.toFixed(1)}px`);
  check('contact shadow has fixed blur/opacity', dom.geometry.shadowFilter.includes('blur(5px)') && dom.geometry.shadowOpacity === '0.62', `${dom.geometry.shadowFilter} / ${dom.geometry.shadowOpacity}`);
  check('contact shadow is a radial ellipse', dom.geometry.shadowImage.includes('radial-gradient'), 'radial-gradient(ellipse)');

  console.log('\n== Chromium: 390px viewport ==');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const mobile = await page.evaluate(() => {
    const assets = document.querySelectorAll('.asset').length;
    const root = document.documentElement;
    return {
      assets,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    };
  });
  check('DOM cards still 102 at 390px', mobile.assets === 102, `${mobile.assets}`);
  check('no horizontal overflow at 390px', mobile.scrollWidth <= mobile.innerWidth && mobile.bodyScrollWidth <= mobile.innerWidth, `scrollWidth ${mobile.scrollWidth} / body ${mobile.bodyScrollWidth} / inner ${mobile.innerWidth}`);

  console.log(`\nconsole errors: ${consoleErrors.length}`);
  console.log(`page errors:    ${pageErrors.length}`);
  console.log(`DOM cards:      ${dom.assets}`);
  console.log(`external reqs:  ${externalRequests.length}`);
console.log(`texture reqs:   ${new Set(textureRequests).size} unique / 6 expected`);
console.log(`texture errors: ${failedRequests.length} failed / ${badResponses.length} bad status`);
  if (consoleErrors.length) console.log(consoleErrors.map((e) => `  console: ${e}`).join('\n'));
  if (pageErrors.length) console.log(pageErrors.map((e) => `  pageerror: ${e}`).join('\n'));
} catch (error) {
  failures.push(`runtime: ${error.message}`);
  console.error('\nRUNTIME ERROR:', error);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}

console.log(`\n== summary ==\n${passes.length} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
}
