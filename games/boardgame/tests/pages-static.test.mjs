'use strict';

/*
 * L1 page contract for the committed catalog pages (index.html + board/*.html).
 *
 * Validates the 43 detail pages produced by build.mjs, the list page metadata,
 * JSON-LD (CollectionPage/ItemList on the list, Article/BreadcrumbList on each
 * detail page), and (when Chrome is available) checks 390/320 overflow, dark
 * mode, zero external requests and zero console errors over CDP.
 *
 * The old pages/ tree was a duplicate of board/ and has been removed; this
 * suite now checks the canonical output in place.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';
import { findChrome, withChrome } from './lib/browser.mjs';

const PAGES = ROOT;
const BOARD = path.join(ROOT, 'board');
const DATA = path.join(ROOT, 'data');
const BUILDER = path.join(ROOT, 'build.mjs');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir, base, out) {
  const prefix = base || '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  })) {
    const full = path.join(dir, entry.name);
    const relPath = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) walk(full, relPath, out);
    else out.push(relPath);
  }
  return out;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function auditExternal(s, html, label, expectedAnchors) {
  s.ok(label + ' 无 <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  s.ok(label + ' 无 stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  s.ok(label + ' 无 @import', !/@import/i.test(html));
  s.ok(label + ' 无远程 url()', !/url\(\s*["']?https?:/i.test(html));
  s.ok(label + ' 无 img/iframe/video/audio 资源', !/<(img|iframe|video|audio|source|embed|object)\b/i.test(html));
  s.ok(label + ' 无 fetch/XHR/sendBeacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));
  s.ok(label + ' 无外链字体', !/fonts\.(googleapis|gstatic)\.com/i.test(html));

  const anchors = html.match(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/gi) || [];
  s.eq(label + ' 外链数量', anchors.length, expectedAnchors);
  for (const tag of anchors) {
    s.ok(label + ' 外链带 noopener noreferrer', /rel="noopener noreferrer"/.test(tag), tag.slice(0, 120));
  }

  const stripped = html
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, '')
    .replace(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  s.ok(label + ' 白名单外无 http(s) URL', !/https?:\/\//.test(stripped),
    (stripped.match(/https?:\/\/[^\s"'<>]+/g) || []).slice(0, 3).join(', '));
}

function jsonLdTypes(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach(function (child) { jsonLdTypes(child, out); });
    return out;
  }
  if (typeof node['@type'] === 'string') out.push(node['@type']);
  if (node.mainEntity) jsonLdTypes(node.mainEntity, out);
  if (node.itemListElement) jsonLdTypes(node.itemListElement, out);
  if (node.item) jsonLdTypes(node.item, out);
  return out;
}

function parseJsonLd(s, html, label) {
  const blocks = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) blocks.push(match[1]);
  s.ok(label + ' 含 JSON-LD', blocks.length > 0);
  const allTypes = [];
  for (let i = 0; i < blocks.length; i += 1) {
    try {
      const parsed = JSON.parse(blocks[i]);
      s.ok(label + ' JSON-LD #' + (i + 1) + ' 可解析', parsed !== null && typeof parsed === 'object');
      jsonLdTypes(parsed, allTypes);
    } catch (err) {
      s.ok(label + ' JSON-LD #' + (i + 1) + ' 可解析', false, err.message);
    }
  }
  s.ok(label + ' JSON-LD 带 @type', allTypes.length > 0, JSON.stringify(allTypes));
  if (label.indexOf('列表页') !== -1) {
    s.ok(label + ' JSON-LD 含 CollectionPage', allTypes.indexOf('CollectionPage') !== -1, JSON.stringify(allTypes));
    s.ok(label + ' JSON-LD 含 ItemList', allTypes.indexOf('ItemList') !== -1, JSON.stringify(allTypes));
  } else {
    s.ok(label + ' JSON-LD 含 Article', allTypes.indexOf('Article') !== -1, JSON.stringify(allTypes));
    s.ok(label + ' JSON-LD 含 BreadcrumbList', allTypes.indexOf('BreadcrumbList') !== -1, JSON.stringify(allTypes));
  }
}

const s = createSuite('boardgame-pages-static');

await s.run(async () => {
  if (!fs.existsSync(path.join(PAGES, 'index.html'))) {
    s.ok('列表页 index.html 存在', false, 'committed index.html is missing');
    return;
  }

  const games = readJson(path.join(DATA, 'boardgames.json'));
  const categories = readJson(path.join(DATA, 'categories.json'));
  const indexFile = path.join(PAGES, 'index.html');
  const indexHtml = fs.readFileSync(indexFile, 'utf8');

  const detailFiles = fs.readdirSync(BOARD).filter(function (name) { return /\.html$/.test(name); });

  await s.group('page set', async () => {
    s.eq('详情页数 = 数据条数', detailFiles.length, games.length);
    const missing = games.filter(function (game) {
      return detailFiles.indexOf(game.slug + '.html') === -1;
    }).map(function (game) { return game.slug; });
    s.eq('每款游戏都有详情页', missing, []);
    const extras = detailFiles.filter(function (name) {
      return !games.some(function (game) { return game.slug + '.html' === name; });
    });
    s.eq('没有多余详情页', extras, []);
  });

  await s.group('list page', async () => {
    s.matches('标题含 43 款桌游', indexHtml, new RegExp('<title>桌游目录 · ' + games.length + ' 款桌游'));
    s.matches('lang=zh-CN', indexHtml, /<html lang="zh-CN">/);
    s.matches('viewport', indexHtml, /name="viewport"[^>]*width=device-width/);
    s.matches('theme-color', indexHtml, /name="theme-color"/);
    s.matches('meta description', indexHtml, /<meta name="description" content="[^"]{20,}"/);
    s.matches('meta robots', indexHtml, /name="robots"/);
    s.matches('canonical 指向 boardgame 根', indexHtml, /rel="canonical" href="https:\/\/hhfa008\.github\.io\/games\/boardgame\/"/);
    s.matches('搜索框 id=q', indexHtml, /id="q"/);
    s.matches('搜索框 type=search', indexHtml, /type="search"/);

    for (const field of ['category', 'players', 'time']) {
      s.includes('筛选元数据 data-filter=' + field, indexHtml, 'data-filter="' + field + '"');
    }
    for (const category of categories) {
      s.includes('品类筛选项 ' + category.key, indexHtml, 'data-value="' + category.key + '"');
      s.includes('品类中文名 ' + category.name.zh, indexHtml, category.name.zh);
    }
    s.includes('结果计数节点', indexHtml, 'id="count"');
    s.includes('空状态节点', indexHtml, 'id="empty"');
    s.eq('卡片数 = 数据条数', (indexHtml.match(/class="card"/g) || []).length, games.length);
    s.matches('列表页含卡牌对战入口', indexHtml, /href="\.\/card-battle\/"/);
    s.matches('列表页含拼布入口', indexHtml, /href="\.\/patchwork\/"/);
    s.matches('移动端媒体查询', indexHtml, /@media \(max-width:520px\)/);
    s.matches('触控目标 >=44px', indexHtml, /min-height:44px/);
    s.matches('深色模式 CSS', indexHtml, /prefers-color-scheme\s*:\s*dark/);
    s.matches('横向溢出保护', indexHtml, /overflow-x:\s*hidden/);
    s.ok('列表页不加载封面图', !/<img\b/i.test(indexHtml));
    auditExternal(s, indexHtml, '列表页', 0);
    parseJsonLd(s, indexHtml, '列表页');
  });

  await s.group('detail pages', async () => {
    for (const game of games) {
      const file = path.join(BOARD, game.slug + '.html');
      const label = game.slug;
      s.ok(label + ' 详情页存在', fs.existsSync(file));
      if (!fs.existsSync(file)) continue;
      const html = fs.readFileSync(file, 'utf8');

      s.includes(label + ' title 含中文名', html, '<title>' + escapeHtml(game.name.zh) + ' · 桌游详情</title>');
      s.matches(label + ' meta description', html, /<meta name="description" content="[^"]{20,}"/);
      s.matches(label + ' canonical 指向 board/<slug>', html,
        new RegExp('rel="canonical" href="[^"]*/board/' + game.slug + '\\.html"'));
      s.includes(label + ' 含中文名', html, escapeHtml(game.name.zh));
      s.includes(label + ' 含原名', html, escapeHtml(game.name.en));
      s.includes(label + ' 含评分', html, game.rating.toFixed(1));
      s.ok(label + ' 含支持人数', html.indexOf(game.players.min + '–' + game.players.max + ' 人') !== -1 ||
        html.indexOf(game.players.min + ' 人') !== -1);
      s.includes(label + ' 返回列表链接', html, 'href="../index.html"');
      s.includes(label + ' 含来源链接', html, game.source.url);
      s.matches(label + ' 来源链接 rel 白名单', html, /<a class="source-link"[^>]*rel="noopener noreferrer"/);
      s.eq(label + ' 同类推荐 3 条', (html.match(/class="rec-card"/g) || []).length, 3);
      s.ok(label + ' 详情页不加载封面图', !/<img\b/i.test(html));
      s.matches(label + ' 深色模式 CSS', html, /prefers-color-scheme\s*:\s*dark/);
      auditExternal(s, html, label, 1);
      parseJsonLd(s, html, label);
    }
  });

  await s.group('builder reproducibility', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-pages-build-'));
    try {
      const out = path.join(tmp, 'out');
      const result = spawnSync(process.execPath, [BUILDER, '--out', out], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120000
      });
      s.ok('build.mjs 退出码 0', result.status === 0, (result.stderr || result.stdout || '').trim());
      s.ok('build.mjs 输出目录存在', fs.existsSync(out));
      if (!fs.existsSync(out)) return;

      s.eq('列表页 md5 与已提交产出一致',
        md5(path.join(out, 'index.html')), md5(path.join(PAGES, 'index.html')));
      const built = walk(path.join(out, 'board'), '', []).sort();
      const committed = walk(BOARD, '', []).sort();
      s.eq('详情页清单与已提交 board/ 一致', committed, built);
      let mismatch = null;
      for (const relPath of built) {
        if (md5(path.join(out, 'board', relPath)) !== md5(path.join(BOARD, relPath))) {
          mismatch = relPath;
          break;
        }
      }
      s.ok('所有详情页 md5 与已提交产出一致', mismatch === null, mismatch || '');
      s.eq('构建详情页数', built.length, games.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await s.group('browser: 390/320, dark, console, network', async () => {
    if (!findChrome()) {
      s.skip('browser checks', 'Chrome 未安装');
      return;
    }

    const samples = [
      { label: '列表页', file: indexFile },
      { label: '详情页 ' + games[0].slug, file: path.join(BOARD, games[0].slug + '.html') },
      { label: '详情页 ' + games[Math.floor(games.length / 2)].slug, file: path.join(BOARD, games[Math.floor(games.length / 2)].slug + '.html') },
      { label: '详情页 ' + games[games.length - 1].slug, file: path.join(BOARD, games[games.length - 1].slug + '.html') }
    ];

    for (const sample of samples) {
      try {
        const audit = await withChrome(pathToFileURL(sample.file).href, async function (page) {
          const at390 = await page.metrics({ width: 390, height: 844 });
          const at320 = await page.metrics({ width: 320, height: 720 });
          const colors = await page.colors();
          return {
            at390: at390,
            at320: at320,
            colors: colors,
            external: page.externalRequests.slice(),
            consoleErrors: page.consoleErrors.slice(),
            pageErrors: page.pageErrors.slice()
          };
        }, { timeoutMs: 12000 });

        s.ok(sample.label + ' 390px 无横向滚动', audit.at390.scrollWidth <= audit.at390.clientWidth + 1,
          'scrollWidth=' + audit.at390.scrollWidth + ', clientWidth=' + audit.at390.clientWidth);
        s.eq(sample.label + ' 390px 无越界元素', audit.at390.overflow, []);
        s.ok(sample.label + ' 320px 无横向滚动', audit.at320.scrollWidth <= audit.at320.clientWidth + 1,
          'scrollWidth=' + audit.at320.scrollWidth + ', clientWidth=' + audit.at320.clientWidth);
        s.eq(sample.label + ' 320px 无越界元素', audit.at320.overflow, []);
        s.ok(sample.label + ' 深色模式背景与浅色不同',
          audit.colors.light !== audit.colors.dark,
          audit.colors.light + ' vs ' + audit.colors.dark);
        s.eq(sample.label + ' 零外部请求', audit.external, []);
        s.eq(sample.label + ' 零 console error', audit.consoleErrors, []);
        s.eq(sample.label + ' 零未捕获异常', audit.pageErrors, []);
      } catch (err) {
        s.skip(sample.label + ' browser checks', 'CDP 运行失败: ' + (err && err.message ? err.message : String(err)));
      }
    }
  });
});
