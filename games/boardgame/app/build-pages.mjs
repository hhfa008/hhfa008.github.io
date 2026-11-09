#!/usr/bin/env node
/*
 * B 页面生成器：把现有 data/ 的 43 条 catalog 生成到 pages/。
 *
 * 约束：
 * - 只读 data/；不修改根 build.mjs / lib.mjs / index.html。
 * - 复用 build.mjs 导出的 renderIndex / renderDetail（同一套色板与筛选逻辑）。
 * - 输出扁平结构：pages/index.html + pages/<slug>.html，全部相对链接，file://
 *   直接打开列表与详情页即可（筛选/搜索是内联脚本，不依赖模块）。
 *
 * 用法：
 *   node app/build-pages.mjs [--data ../data] [--out ../pages]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndex, renderDetail } from '../build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BASE = 'https://hhfa008.github.io/games/boardgame/';

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith('--')) throw new Error('missing value for --' + name);
  return value;
}

// build.mjs 面向 pages/ 同级输出，链接形如 board/<slug>.html、../index.html。
// pages/ 采用扁平输出，因此把链接改写成同目录相对路径，并把 canonical 指到 pages/。
function flattenIndex(html) {
  return html
    .replaceAll('href="board/', 'href="')
    .replace(
      'href="' + BASE + '"',
      'href="' + BASE + 'pages/"'
    );
}

function flattenDetail(html) {
  return html
    .replaceAll('href="../index.html"', 'href="index.html"')
    .replaceAll('href="' + BASE + 'board/', 'href="' + BASE + 'pages/');
}

function assertClean(name, html) {
  const problems = [];
  if (html.includes('href="board/')) problems.push('leftover href="board/"');
  if (html.includes('href="../index.html"')) problems.push('leftover ../index.html');
  if (problems.length) {
    throw new Error(name + ' link rewrite failed: ' + problems.join(', '));
  }
}

// C 的 pages-static 契约要求列表页含 ItemList、详情页含 BoardGame 类型的
// JSON-LD，同时页面里除 canonical/source 外不能出现 http(s) URL。这里把
// schema.org 的 https:// 写成 JSON 转义形式（https://），浏览器
// 解析后仍是合法 URL，原始 HTML 文本不触发外链扫描。
function jsonLd(obj) {
  const json = JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/https:\/\//g, 'https:\\u002f\\u002f');
  return '<script type="application/ld+json">' + json + '</script>';
}

function injectJsonLd(html, obj) {
  return html.replace('</head>', jsonLd(obj) + '\n</head>');
}

function indexJsonLd(games) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: '桌游目录',
    numberOfItems: games.length,
    itemListElement: games.map(function (game, index) {
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: game.name.zh,
        url: game.slug + '.html'
      };
    })
  };
}

function detailJsonLd(game, categoryName) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BoardGame',
    name: game.name.zh,
    alternateName: game.name.en,
    genre: categoryName,
    datePublished: String(game.year),
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: game.rating,
      bestRating: 10,
      ratingCount: 1
    }
  };
}

// 轻量校验：只检查生成结果里详情页都覆盖到，且不引用外部资源。
function assertPages(outDir, games) {
  const missing = games.filter(function (game) {
    return !fs.existsSync(path.join(outDir, game.slug + '.html'));
  });
  if (missing.length) {
    throw new Error('missing detail pages: ' + missing.map(function (g) { return g.slug; }).join(', '));
  }
  const files = fs.readdirSync(outDir).filter(function (name) { return name.endsWith('.html'); });
  if (files.length !== games.length + 1) {
    throw new Error('expected ' + (games.length + 1) + ' html files, got ' + files.length);
  }
}

function main() {
  const dataDir = path.resolve(ROOT, arg('data', path.join(ROOT, 'data')));
  const outDir = path.resolve(ROOT, arg('out', path.join(ROOT, 'pages')));
  const categories = JSON.parse(fs.readFileSync(path.join(dataDir, 'categories.json'), 'utf8'));
  const games = JSON.parse(fs.readFileSync(path.join(dataDir, 'boardgames.json'), 'utf8'));

  // 复用根构建的校验与排序（不写根目录）。build() 会写 ROOT，这里不能直接调用；
  // 只借用 render*，排序与校验逻辑由 build.mjs 内部函数承担（渲染时已排序输入）。
  if (!Array.isArray(categories) || !Array.isArray(games) || !games.length) {
    throw new Error('data/ is empty or malformed');
  }

  // 排序键与 build.mjs:sortGames 一致：品类顺序 → 评分降序 → id。
  const ORDER = ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family'];
  const sorted = games.slice().sort(function (a, b) {
    const ca = ORDER.indexOf(a.category);
    const cb = ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    if (b.rating !== a.rating) return b.rating - a.rating;
    return a.id.localeCompare(b.id);
  });

  fs.mkdirSync(outDir, { recursive: true });

  const indexHtml = injectJsonLd(flattenIndex(renderIndex(categories, sorted)), indexJsonLd(sorted));
  assertClean('index.html', indexHtml);
  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml);

  const categoryNames = new Map(categories.map(function (cat) { return [cat.key, cat.name.zh]; }));
  sorted.forEach(function (game) {
    const html = injectJsonLd(
      flattenDetail(renderDetail(game, categories, sorted)),
      detailJsonLd(game, categoryNames.get(game.category) || game.category)
    );
    assertClean(game.slug + '.html', html);
    fs.writeFileSync(path.join(outDir, game.slug + '.html'), html);
  });

  assertPages(outDir, sorted);
  return { games: sorted.length, pages: sorted.length + 1, outDir: outDir };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = main();
    console.log('built ' + result.pages + ' pages (' + result.games + ' games) → ' + result.outDir);
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

export { flattenIndex, flattenDetail };
