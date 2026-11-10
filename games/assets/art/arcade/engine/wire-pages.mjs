#!/usr/bin/env node
'use strict';

/*
 * Wire one family's shared art into all of its variant pages.
 *
 *   node games/assets/art/arcade/engine/wire-pages.mjs <family>
 *
 * For every variant index.html it adds an absolute 1200x630 og:image (plus
 * Twitter large-image tags and per-variant alt text). For every rules.html it
 * adds the same absolute og:image and a 1200x800 detail figure under the hero
 * with a per-variant Chinese alt/caption. It never touches game logic.
 *
 * The edit is idempotent: existing art meta/figure blocks are updated in place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
const GAMES = path.join(ROOT, 'games');
const ARCADE = path.resolve(HERE, '..');
const SITE = 'https://hhfa008.github.io/games/assets/art/arcade';

const VARIANTS = {
  'slide2048': ['2048-3', '2048-5', '2048-6', '2048-7', '2048-8', '2048-9', '2048-10', '2048-11', '2048-12'],
  'slide-puzzle': ['slide-3', 'slide-4', 'slide-5', 'slide-6', 'slide-7', 'slide-8', 'slide-9', 'slide-10', 'slide-11', 'slide-12'],
  'lights-out': ['lights-3', 'lights-4', 'lights-5', 'lights-6', 'lights-7', 'lights-8', 'lights-9', 'lights-10', 'lights-11', 'lights-12'],
  'minesweeper': ['mines-7x7', 'mines-10x10', 'mines-14x14', 'mines-18x18', 'mines-20x20', 'mines-24x24', 'mines-30x16', 'mines-easy', 'mines-mid', 'mines-hard'],
  'memory-pairs': ['memory-3x4', 'memory-4x4', 'memory-4x5', 'memory-4x6', 'memory-5x4', 'memory-5x5', 'memory-6x4', 'memory-6x6', 'memory-8x5', 'memory-8x6'],
  'snake': ['snake', 'snake-10', 'snake-12', 'snake-14', 'snake-18', 'snake-20', 'snake-24', 'snake-30', 'snake-fast', 'snake-wrap'],
  'pong': ['pong', 'pong-1-5', 'pong-2-5', 'pong-2p', 'pong-3', 'pong-3-5', 'pong-4', 'pong-5', 'pong-6', 'pong-fast'],
  'tictactoe': ['tictactoe', 'tictactoe-4', 'tictactoe-5', 'tictactoe-6', 'tictactoe-7', 'tictactoe-8', 'tictactoe-9', 'tictactoe-10', 'tictactoe-11', 'tictactoe-12'],
  'hanoi': ['hanoi-4', 'hanoi-5', 'hanoi-6', 'hanoi-7', 'hanoi-8', 'hanoi-9', 'hanoi-10', 'hanoi-11', 'hanoi-12', 'hanoi-13'],
  'reaction': ['reaction-time', 'reaction-10', 'reaction-20', 'reaction-30',
    'whack', 'whack-15', 'whack-60', 'aim-trainer', 'aim-15', 'aim-60']
};

const FAMILY_LABEL = {
  'slide2048': '2048',
  'slide-puzzle': '数字华容道', 'lights-out': '关灯', 'minesweeper': '扫雷',
  'memory-pairs': '翻牌记忆', 'snake': '贪吃蛇', 'pong': '乒乓球',
  'tictactoe': '井字棋', 'hanoi': '汉诺塔', 'reaction': '反应挑战'
};

/* The 2048 family keeps its own art package under games/2048/assets and its
 * realism state in the same directory, so its URL/detail paths differ from the
 * shared games/assets/art/arcade/<family>/ layout. */
const ART_OVERRIDES = {
  slide2048: {
    urlBase: 'https://hhfa008.github.io/games/2048/assets',
    detailSrc: '../2048/assets/detail.webp',
    stateFile: () => path.join(GAMES, '2048/assets/state.json'),
    validator: 'games/2048/assets/realism.mjs'
  }
};

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function read(file) { return fs.readFileSync(file, 'utf8'); }
function write(file, text) { fs.writeFileSync(file, text); }

function firstMatch(html, re, fallback) {
  const m = html.match(re);
  return m ? m[1].trim() : fallback;
}

function enName(html) {
  const title = firstMatch(html, /<title>([^<]*)<\/title>/i, '');
  return title.replace(/\s*—\s*free online game\s*$/i, '').trim();
}

function zhName(html) {
  const h1 = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i, '');
  const text = h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const cut = text.split(/规则|怎么玩|完整|：|:/)[0].trim();
  return cut || text;
}

const OG_RE = /[ \t]*<meta property="og:image"[^>]*>[ \t]*\r?\n?/g;
const OG_TYPE_RE = /[ \t]*<meta property="og:image:type"[^>]*>[ \t]*\r?\n?/g;
const OG_W_RE = /[ \t]*<meta property="og:image:width"[^>]*>[ \t]*\r?\n?/g;
const OG_H_RE = /[ \t]*<meta property="og:image:height"[^>]*>[ \t]*\r?\n?/g;
const OG_ALT_RE = /[ \t]*<meta property="og:image:alt"[^>]*>[ \t]*\r?\n?/g;
const TW_IMAGE_RE = /[ \t]*<meta name="twitter:image"[^>]*>[ \t]*\r?\n?/g;

function stripArtMeta(html) {
  return html.replace(OG_RE, '').replace(OG_TYPE_RE, '').replace(OG_W_RE, '')
    .replace(OG_H_RE, '').replace(OG_ALT_RE, '').replace(TW_IMAGE_RE, '');
}

function addMeta(html, url, alt) {
  const block = [
    '<meta property="og:image" content="' + url + '">',
    '<meta property="og:image:type" content="image/webp">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="' + escapeAttr(alt) + '">'
  ].join('\n');
  // Place the block immediately after og:url (or canonical as a fallback).
  if (/<meta property="og:url"[^>]*>/.test(html)) {
    html = html.replace(/(<meta property="og:url"[^>]*>)/, '$1\n' + block);
  } else {
    html = html.replace(/(<link rel="canonical"[^>]*>)/, '$1\n' + block);
  }
  // Twitter: large image + matching image after the description.
  html = html.replace(/<meta name="twitter:card" content="summary">/,
    '<meta name="twitter:card" content="summary_large_image">');
  const tw = '<meta name="twitter:image" content="' + url + '">';
  if (/<meta name="twitter:description"[^>]*>/.test(html)) {
    html = html.replace(/(<meta name="twitter:description"[^>]*>)/, '$1\n' + tw);
  } else if (/<meta name="twitter:card"[^>]*>/.test(html)) {
    html = html.replace(/(<meta name="twitter:card"[^>]*>)/, '$1\n' + tw);
  }
  return html;
}

const FIGURE_CSS = [
  '.art-figure{margin:20px 0 24px;padding:0}',
  '.art-figure img{display:block;width:100%;height:auto;border-radius:12px;border:1px solid var(--line);',
  '  background:var(--paper-2);box-shadow:0 10px 26px rgb(43 47 54 / .10)}',
  '.art-figure figcaption{margin-top:8px;font-size:13px;line-height:1.55;color:var(--muted)}',
  // The figcaption embeds a long module path in <code>; without wrapping it
  // pushes the 320px document to 326px (site-quality overflow-x).
  'code{overflow-wrap:anywhere}',
  // The rules-page eyebrow is a <p>; 11px is below the 12px mobile floor.
  '.eyebrow{font-size:12px}'
].join('\n');

// Matches the whole art-figure block written by any earlier version, so a
// rerun can refresh stale CSS instead of only filling in missing pages.
const FIGURE_CSS_RE = /\.art-figure\{margin:20px 0 24px[\s\S]*?\.art-figure figcaption\{[^}]*\}\n?/;

function addFigure(html, src, name, captionZh, validator) {
  const alt = name + ' 规则页配图：' + captionZh;
  const figure = [
    '<figure class="art-figure">',
    '  <img src="' + src + '" width="1200" height="800"',
    '    alt="' + escapeAttr(alt) + '" loading="eager" decoding="async">',
    '  <figcaption>' + name + ' 的规则页配图。' + (captionZh ? escapeAttr(captionZh) + ' ' : '') +
      '画面中的文字、数字与点阵由系统字体和代码绘制，材质由本地 FLUX 生成，局面由 <code>' +
      (validator || 'games/assets/art/arcade/engine/realism.mjs') + '</code> 校验后才允许出图。</figcaption>',
    '</figure>'
  ].join('\n');
  // Remove a previous art figure, then insert after the hero header (the
  // </header> inside <main>), before the article. The site header is first, so
  // the search must start at <main>, not at document index 0.
  html = html.replace(/[ \t]*<figure class="art-figure">[\s\S]*?<\/figure>\r?\n?/g, '');
  const mainStart = html.indexOf('<main');
  const headerEnd = mainStart === -1 ? -1 : html.indexOf('</header>', mainStart);
  const articleStart = headerEnd === -1 ? -1 : html.indexOf('<article', headerEnd);
  if (mainStart === -1 || headerEnd === -1 || articleStart === -1) {
    throw new Error('cannot find hero header/article insertion point');
  }
  return html.slice(0, headerEnd + '</header>'.length) + '\n\n  ' + figure + '\n\n  ' +
    html.slice(articleStart);
}

function addFigureCss(html) {
  const headEnd = html.indexOf('</head>');
  if (headEnd === -1) return html;
  const styleEnd = html.lastIndexOf('</style>', headEnd);
  if (styleEnd === -1) return html;
  // Refresh the block in place: an older wired page already contains a
  // ".art-figure" block, but it may predate the overflow/font fixes above.
  const head = html.slice(0, styleEnd).replace(FIGURE_CSS_RE, '');
  return head + FIGURE_CSS + '\n' + html.slice(styleEnd);
}

function artConfig(family) {
  const override = ART_OVERRIDES[family];
  return {
    urlBase: override ? override.urlBase : SITE + '/' + family,
    detailSrc: override ? override.detailSrc : '../assets/art/arcade/' + family + '/detail.webp',
    validator: override ? override.validator : 'games/assets/art/arcade/engine/realism.mjs',
  };
}

function wireIndex(file, family, state) {
  let html = read(file);
  const name = enName(html);
  const alt = name + ' — ' + (state.caption || 'real position');
  html = stripArtMeta(html);
  html = addMeta(html, artConfig(family).urlBase + '/og.webp', alt);
  write(file, html);
  return name;
}

function wireRules(file, family, state) {
  let html = read(file);
  const name = zhName(html);
  const captionZh = (state.art && state.art.captionZh) || state.caption || '';
  html = stripArtMeta(html);
  html = addMeta(html, artConfig(family).urlBase + '/og.webp', name + ' 真实可复核局面：' + captionZh);
  html = addFigureCss(html);
  html = addFigure(html, artConfig(family).detailSrc, name, captionZh, artConfig(family).validator);
  write(file, html);
  return name;
}

function main() {
  const family = process.argv[2];
  const slugs = VARIANTS[family];
  if (!slugs) {
    console.error('usage: node wire-pages.mjs <' + Object.keys(VARIANTS).join('|') + '>');
    process.exit(2);
  }
  const override = ART_OVERRIDES[family];
  const stateFile = override ? override.stateFile() : path.join(ARCADE, 'state', family + '.json');
  if (!fs.existsSync(stateFile)) throw new Error('missing state: ' + stateFile);
  const state = JSON.parse(read(stateFile));
  const report = [];
  for (const slug of slugs) {
    const dir = path.join(GAMES, slug);
    const index = path.join(dir, 'index.html');
    const rules = path.join(dir, 'rules.html');
    if (!fs.existsSync(index) || !fs.existsSync(rules)) throw new Error('missing page for ' + slug);
    const en = wireIndex(index, family, state);
    const zh = wireRules(rules, family, state);
    report.push(slug + '\t' + en + '\t' + zh);
  }
  console.log('wired ' + family + ' into ' + slugs.length + ' variants');
  report.forEach((line) => console.log('  ' + line));
}

main();
