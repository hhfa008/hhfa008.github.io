#!/usr/bin/env node
/* 把共享 kit + 本地模型生成的 UI/CSS 拼进模板，生成 games/<slug>/index.html 与 test.js。
 *
 *   node tools/arcade/build-game.mjs --slug 2048 --css /tmp/a.css --ui /tmp/a.ui.js
 *   node tools/arcade/build-game.mjs --slug 2048            # 只校验已有文件
 *
 * 引擎来自 games/shared/arcade/kits/<family>.js（同一份代码被页面与测试共用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allGames } from './families.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ARCADE = path.join(ROOT, 'games/shared/arcade');
const TPL = path.join(ARCADE, 'templates/game.html');

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const slug = arg('slug');
if (!slug) {
  console.error('usage: build-game.mjs --slug <slug> [--css file] [--ui file] [--js file]');
  process.exit(2);
}

let game = allGames().find((g) => g.slug === slug);
if (!game) {
  try {
    const catalog = JSON.parse(fs.readFileSync(path.join(ARCADE, 'catalog.json'), 'utf8'));
    game = catalog.games.find((g) => g.slug === slug);
  } catch { /* ignore */ }
}
if (!game) {
  console.error(`unknown slug: ${slug}`);
  process.exit(2);
}
const family = game.family;
if (!family) {
  console.error(`${slug}: no family/kit`);
  process.exit(2);
}
const kitFile = path.join(ARCADE, 'kits', `${family}.js`);
const suiteFile = path.join(ARCADE, 'tests', `${family}.js`);
if (!fs.existsSync(kitFile) || !fs.existsSync(suiteFile)) {
  console.error(`${slug}: kit/suite missing for family ${family}`);
  process.exit(2);
}

const outDir = path.join(ROOT, 'games', slug);
const outFile = path.join(outDir, 'index.html');
const params = game.params || {};
const title = game.title || `${game.en} — free online game`;
const desc = game.desc || `${game.en}: a free browser game, no sign-up, works offline. ${game.zh}：免费在线小游戏，无需注册。`;

const cssFile = arg('css');
const uiFile = arg('ui');
const jsFile = arg('js');

if (!cssFile && !uiFile && !jsFile) {
  if (!fs.existsSync(outFile)) { console.error(`missing ${outFile}`); process.exit(1); }
  const html = fs.readFileSync(outFile, 'utf8');
  const problems = check(game, html);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log(`OK ${path.relative(ROOT, outFile)} ${Buffer.byteLength(html)} bytes`);
  process.exit(0);
}

const css = cssFile ? fs.readFileSync(cssFile, 'utf8').trim() : '';
let ui = '';
if (uiFile) ui = fs.readFileSync(uiFile, 'utf8').trim();
if (!ui && jsFile) {
  const js = fs.readFileSync(jsFile, 'utf8');
  const end = js.indexOf('// __CORE_END__');
  ui = end >= 0 ? js.slice(end + '// __CORE_END__'.length).trim() : js.trim();
}
if (!ui) { console.error('no UI content'); process.exit(2); }

const tpl = fs.readFileSync(TPL, 'utf8');
const jsonld = {
  '@context': 'https://schema.org',
  '@type': 'VideoGame',
  name: game.en,
  alternateName: [game.zh, game.id],
  url: `https://hhfa008.github.io/games/${slug}/`,
  applicationCategory: 'Game',
  genre: 'Browser game',
  gamePlatform: 'Web browser',
  operatingSystem: 'Any',
  inLanguage: ['en', 'zh-CN', 'id'],
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  publisher: { '@type': 'Person', name: 'Devin' },
};

const html = tpl
  .replaceAll('{{TITLE}}', esc(title))
  .replaceAll('{{DESC}}', esc(desc))
  .replaceAll('{{SLUG}}', slug)
  .replaceAll('{{JSONLD}}', '<script type="application/ld+json">\n' + JSON.stringify(jsonld, null, 2) + '\n<\/script>')
  .replaceAll('{{ZH_NAME}}', esc(game.zh))
  .replaceAll('{{EN_NAME}}', esc(game.en))
  .replaceAll('{{ID_NAME}}', esc(game.id))
  .replaceAll('{{KIT}}', family)
  .replaceAll('{{CORE_INIT}}', `var CORE = ArcadeKit.create(${JSON.stringify(params)});`)
  .replaceAll('{{GAME_UI}}', ui)
  .replaceAll('{{GAME_CSS}}', css);

const problems = check(game, html);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);

// 生成 test.js：同一 kit + 同一份共享测试
const test = `'use strict';

var lib = require('../tests/lib.js');
var s = lib.suite('${slug}');
var kit = require('../shared/arcade/kits/${family}.js');
var run = require('../shared/arcade/tests/${family}.js');
var params = ${JSON.stringify(params)};
run(kit.create(params), params, s);
s.done();
`;
fs.writeFileSync(path.join(outDir, 'test.js'), test);
console.log(`built ${path.relative(ROOT, outFile)} ${Buffer.byteLength(html)} bytes; test.js ${family}`);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function check(g, html) {
  const bad = [];
  const bytes = Buffer.byteLength(html);
  if (bytes > 70 * 1024) bad.push(`index.html ${bytes} bytes > 70KB`);
  for (const marker of [`kits/${family}.js`, 'ArcadeKit.create', 'Arcade.init', 'share.js']) {
    if (!html.includes(marker)) bad.push(`missing ${marker}`);
  }
  const ext = [...html.matchAll(/<(script|link|img|iframe)([^>]*)>/g)]
    .map((m) => {
      const tag = m[1];
      const attrs = m[2];
      const rel = (attrs.match(/rel="([^"]+)"/) || [])[1] || '';
      if (tag === 'link' && !/stylesheet|preload|prefetch|icon/i.test(rel)) return null;
      const url = (attrs.match(/(?:src|href)="(https?:\/\/[^"]+)"/) || [])[1];
      return url || null;
    })
    .filter(Boolean);
  if (ext.length) bad.push(`external subresources: ${ext.slice(0, 3).join(', ')}`);
  if (/\{\{[A-Z_0-9]+\}\}/.test(html)) bad.push('unfilled template placeholder');
  if (!html.includes(`arcade.${g.slug}.best`)) bad.push('best-score key not found');

  const i18n = extractI18N(html);
  if (!i18n) {
    bad.push('I18N object not found/parseable');
  } else {
    const required = ['eyebrow','title','tagline','score','best','extraLabel','boardAria','playAgain','newGame','hint','note','rules','hall','moreLink','overlayWin','overlayLose'];
    for (const lang of ['en','zh','id']) {
      if (!i18n[lang]) { bad.push(`I18N missing ${lang}`); continue; }
      const missing = required.filter((k) => i18n[lang][k] == null);
      if (missing.length) bad.push(`I18N ${lang} missing: ${missing.join(',')}`);
    }
    const used = [...html.matchAll(/data-i="([^"]+)"/g)].map((m) => m[1]);
    const missingUsed = [...new Set(used)].filter((k) => i18n.en && i18n.en[k] == null);
    if (missingUsed.length) bad.push(`data-i keys not in I18N: ${missingUsed.join(',')}`);
  }
  return bad;
}

function extractI18N(html) {
  const start = html.indexOf('var I18N');
  if (start < 0) return null;
  const brace = html.indexOf('{', start);
  if (brace < 0) return null;
  let depth = 0, inStr = null, esc = false;
  for (let i = brace; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return new Function('return (' + html.slice(brace, i + 1) + ')')(); }
        catch { return null; }
      }
    }
  }
  return null;
}
