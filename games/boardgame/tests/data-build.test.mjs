'use strict';

/*
 * L1 regression: the committed catalog and the 44 generated pages.
 *
 * This is the only suite that must always run green today. It rebuilds into a
 * temp directory and compares bytes with the committed pages, so a stale
 * `index.html` / `board/*.html` cannot merge silently.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';

const DATA_DIR = path.join(ROOT, 'data');
const BOARD_DIR = path.join(ROOT, 'board');
const BUILD = path.join(ROOT, 'build.mjs');
const LIB = path.join(ROOT, 'lib.mjs');

const CATEGORY_KEYS = ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function oneDecimal(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function auditNoExternal(s, html, label, expectedAnchors) {
  s.ok(label + ' 无 <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  s.ok(label + ' 无 stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  s.ok(label + ' 无 @import', !/@import/i.test(html));
  s.ok(label + ' 无远程 url()', !/url\(\s*["']?https?:/i.test(html));
  s.ok(label + ' 无 img/iframe/video/audio 资源', !/<(img|iframe|video|audio|source|embed|object)\b/i.test(html));
  s.ok(label + ' 无 fetch/XHR/sendBeacon', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(html));

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

const s = createSuite('boardgame-data-build');

await s.run(async () => {
  const data = readJson(path.join(DATA_DIR, 'boardgames.json'));
  const categories = readJson(path.join(DATA_DIR, 'categories.json'));
  const schema = readJson(path.join(DATA_DIR, 'boardgames.schema.json'));
  const lib = await import(pathToFileURL(LIB).href);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-tests-data-build-'));
  const outDir = path.join(tmpRoot, 'out');
  const build = spawnSync(process.execPath, [BUILD, '--out', outDir], {
    cwd: ROOT,
    encoding: 'utf8'
  });

  try {
    await s.group('build', async () => {
      s.ok('构建退出码 0', build.status === 0, (build.stderr || '').trim());
      s.ok('构建输出目录存在', fs.existsSync(outDir));
      s.ok('构建生成列表页', fs.existsSync(path.join(outDir, 'index.html')));
      s.ok('构建生成详情目录', fs.existsSync(path.join(outDir, 'board')));
      s.matches('构建日志报告 44 页', build.stdout || '', /built 44 pages \(43 games\)/);

      const builtBoard = fs.readdirSync(path.join(outDir, 'board')).filter(function (f) {
        return /\.html$/.test(f);
      });
      s.eq('构建详情页数 = 数据条数', builtBoard.length, data.length);
      s.eq('构建总页数 = 数据 + 1', builtBoard.length + 1, data.length + 1);
    });

    await s.group('catalog shape', async () => {
      s.ok('数据是数组', Array.isArray(data));
      s.ok('目录条数 30–50', data.length >= 30 && data.length <= 50, 'got ' + data.length);
      s.eq('当前快照 43 条', data.length, 43);
      s.eq('品类表 6 条', categories.length, 6);
      s.eq('schema 顶层为数组', schema.type, 'array');
      s.eq('schema minItems', schema.minItems, 30);
      s.eq('schema maxItems', schema.maxItems, 50);
      s.eq('schema 禁止额外字段', schema.items.additionalProperties, false);
      s.eq('schema required 字段数', schema.items.required.length,
        ['id', 'slug', 'name', 'category', 'players', 'bestPlayers', 'playTime',
          'weight', 'rating', 'designers', 'publishers', 'year', 'coverUrl', 'source'].length);
    });

    await s.group('categories', async () => {
      s.eq('品类 key 顺序', categories.map(function (c) { return c.key; }), CATEGORY_KEYS);
      s.eq('schema 品类枚举', schema.items.properties.category.enum, CATEGORY_KEYS);

      const counts = {};
      for (const game of data) counts[game.category] = (counts[game.category] || 0) + 1;

      for (const category of categories) {
        for (const field of ['zh', 'en']) {
          s.ok(category.key + ' name.' + field + ' 非空',
            typeof category.name[field] === 'string' && category.name[field].trim().length > 0);
          s.ok(category.key + ' desc.' + field + ' 非空',
            typeof category.desc[field] === 'string' && category.desc[field].trim().length > 0);
        }
        s.ok(category.key + ' 至少 3 条游戏', (counts[category.key] || 0) >= 3,
          'got ' + (counts[category.key] || 0));
      }

      s.eq('品类计数之和 = 数据条数',
        categories.reduce(function (sum, c) { return sum + (counts[c.key] || 0); }, 0),
        data.length);
      s.eq('没有未知品类', Object.keys(counts).filter(function (key) {
        return CATEGORY_KEYS.indexOf(key) === -1;
      }), []);
    });

    await s.group('identity and schema fields', async () => {
      const ids = new Set();
      const slugs = new Set();
      const schemaProps = Object.keys(schema.items.properties);

      for (const game of data) {
        const label = game.slug || game.id || '(missing slug)';
        s.ok(label + ' id 唯一', !ids.has(game.id));
        s.ok(label + ' slug 唯一', !slugs.has(game.slug));
        ids.add(game.id);
        slugs.add(game.slug);

        s.matches(label + ' id 格式', game.id, /^(gstone|bgg|manual)-[a-z0-9-]+$/);
        s.matches(label + ' slug kebab-case', game.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);

        const extra = Object.keys(game).filter(function (key) { return schemaProps.indexOf(key) === -1; });
        s.eq(label + ' 无 schema 之外的字段', extra, []);

        for (const required of schema.items.required) {
          s.ok(label + ' 含必填字段 ' + required, game[required] !== undefined && game[required] !== null);
        }

        s.ok(label + ' name.zh 非空', typeof game.name.zh === 'string' && game.name.zh.trim().length > 0);
        s.ok(label + ' name.en 非空', typeof game.name.en === 'string' && game.name.en.trim().length > 0);
        s.ok(label + ' 品类合法', CATEGORY_KEYS.indexOf(game.category) !== -1);

        s.ok(label + ' 人数为整数', Number.isInteger(game.players.min) && Number.isInteger(game.players.max));
        s.ok(label + ' 人数范围 1–99', game.players.min >= 1 && game.players.min <= game.players.max && game.players.max <= 99);
        s.ok(label + ' bestPlayers 为数组', Array.isArray(game.bestPlayers));
        s.eq(label + ' bestPlayers 唯一', new Set(game.bestPlayers).size, game.bestPlayers.length);
        for (const player of game.bestPlayers) {
          s.ok(label + ' bestPlayers ' + player + ' 在人数区间', player >= game.players.min && player <= game.players.max);
        }

        s.ok(label + ' 时长为整数', Number.isInteger(game.playTime.min) && Number.isInteger(game.playTime.max));
        s.ok(label + ' 时长范围 1–10000', game.playTime.min >= 1 && game.playTime.min <= game.playTime.max && game.playTime.max <= 10000);

        s.ok(label + ' 重度 1–5', typeof game.weight === 'number' && game.weight >= 1 && game.weight <= 5);
        s.ok(label + ' 重度一位小数', oneDecimal(game.weight), String(game.weight));
        s.ok(label + ' 评分 0–10', typeof game.rating === 'number' && game.rating >= 0 && game.rating <= 10);
        s.ok(label + ' 评分一位小数', oneDecimal(game.rating), String(game.rating));

        s.ok(label + ' designers 为数组', Array.isArray(game.designers));
        s.ok(label + ' publishers 为数组', Array.isArray(game.publishers));
        for (const name of game.designers.concat(game.publishers)) {
          s.ok(label + ' 人员/出版社是非空字符串', typeof name === 'string' && name.trim().length > 0);
        }

        s.ok(label + ' 年份 1000–2100', Number.isInteger(game.year) && game.year >= 1000 && game.year <= 2100);
        s.matches(label + ' coverUrl https', game.coverUrl, /^https:\/\//);
        s.ok(label + ' source.site 合法', ['gstone', 'bgg', 'manual'].indexOf(game.source.site) !== -1);
        s.matches(label + ' source.url https', game.source.url, /^https:\/\//);
        s.ok(label + ' fetchedAt 可解析', !Number.isNaN(Date.parse(game.source.fetchedAt)));

        if (game.tags !== undefined) {
          s.ok(label + ' tags 为数组', Array.isArray(game.tags));
          for (const tag of game.tags) {
            s.ok(label + ' tag 非空', typeof tag === 'string' && tag.trim().length > 0);
          }
        }
      }

      s.eq('唯一 id 数量', ids.size, data.length);
      s.eq('唯一 slug 数量', slugs.size, data.length);
    });

    await s.group('list page', async () => {
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      s.matches('标题含桌游数与数量', html, new RegExp('<title>桌游目录 · ' + data.length + ' 款桌游'));
      s.matches('lang=zh-CN', html, /<html lang="zh-CN">/);
      s.matches('viewport', html, /name="viewport"[^>]*width=device-width/);
      s.matches('搜索框', html, /id="q"/);
      s.matches('搜索框 type=search', html, /type="search"/);

      for (const field of ['category', 'players', 'time']) {
        s.includes('筛选元数据 data-filter=' + field, html, 'data-filter="' + field + '"');
      }
      for (const category of categories) {
        s.includes('品类筛选项 ' + category.key, html, 'data-value="' + category.key + '"');
        s.includes('品类中文名 ' + category.name.zh, html, category.name.zh);
      }

      s.includes('结果计数节点', html, 'id="count"');
      s.includes('空状态节点', html, 'id="empty"');
      s.eq('卡片数 = 数据条数', (html.match(/class="card"/g) || []).length, data.length);
      s.matches('移动端媒体查询', html, /@media \(max-width:520px\)/);
      s.matches('触控目标 >=44px', html, /min-height:44px/);
      s.ok('列表页不加载封面图', !/<img\b/i.test(html));
      auditNoExternal(s, html, '列表页', 0);
    });

    await s.group('detail pages', async () => {
      const files = fs.readdirSync(path.join(outDir, 'board')).filter(function (f) {
        return /\.html$/.test(f);
      });
      s.eq('详情页数 = 数据条数', files.length, data.length);

      for (const game of data) {
        const file = path.join(outDir, 'board', game.slug + '.html');
        const label = game.slug;
        s.ok(label + ' 详情页存在', fs.existsSync(file));
        if (!fs.existsSync(file)) continue;
        const html = fs.readFileSync(file, 'utf8');

        s.includes(label + ' title 含中文名', html, '<title>' + escapeHtml(game.name.zh) + ' · 桌游详情</title>');
        s.includes(label + ' 含中文名', html, escapeHtml(game.name.zh));
        s.includes(label + ' 含原名', html, escapeHtml(game.name.en));
        s.includes(label + ' 含评分', html, game.rating.toFixed(1));
        s.ok(label + ' 含支持人数', html.indexOf(game.players.min + '–' + game.players.max + ' 人') !== -1
          || html.indexOf(game.players.min + ' 人') !== -1);
        s.includes(label + ' 含返回列表链接', html, 'href="../index.html"');
        s.includes(label + ' 含来源链接', html, game.source.url);
        s.matches(label + ' 来源链接 rel 白名单', html, /<a class="source-link"[^>]*rel="noopener noreferrer"/);
        s.eq(label + ' 同类推荐 3 条', (html.match(/class="rec-card"/g) || []).length, 3);
        s.ok(label + ' 详情页不加载封面图', !/<img\b/i.test(html));
        auditNoExternal(s, html, label, 1);
      }
    });

    await s.group('committed pages are current', async () => {
      s.ok('已提交列表页存在', fs.existsSync(path.join(ROOT, 'index.html')));
      s.eq('已提交列表页与构建结果 md5 一致', md5(path.join(ROOT, 'index.html')), md5(path.join(outDir, 'index.html')));

      const built = walk(path.join(outDir, 'board'), '', []).sort();
      const committed = walk(BOARD_DIR, '', []).sort();
      s.eq('已提交详情页清单与构建结果一致', committed, built);
      let mismatch = null;
      for (const relPath of built) {
        if (md5(path.join(outDir, 'board', relPath)) !== md5(path.join(BOARD_DIR, relPath))) {
          mismatch = relPath;
          break;
        }
      }
      s.ok('已提交详情页全部与构建结果 md5 一致', mismatch === null, mismatch || '');
      s.eq('已提交总页数（列表 + 详情）', 1 + committed.length, data.length + 1);
    });

    await s.group('filter and recommendation helpers', async () => {
      s.eq('无条件返回全部', lib.filterGames(data, {}).length, data.length);
      s.eq('null 条件返回全部', lib.filterGames(data, null).length, data.length);

      const euro = lib.filterGames(data, { category: 'euro' });
      s.ok('euro 筛选非空', euro.length > 0);
      s.ok('euro 筛选只含 euro', euro.every(function (game) { return game.category === 'euro'; }));

      const two = lib.filterGames(data, { players: 2 });
      s.ok('2 人筛选非空', two.length > 0);
      s.ok('2 人筛选人数正确', two.every(function (game) {
        return game.players.min <= 2 && 2 <= game.players.max;
      }));

      s.eq('timeBucket 30', lib.timeBucket(30), '30');
      s.eq('timeBucket 31', lib.timeBucket(31), '60');
      s.eq('timeBucket 60', lib.timeBucket(60), '60');
      s.eq('timeBucket 61', lib.timeBucket(61), '120');
      s.eq('timeBucket 120', lib.timeBucket(120), '120');
      s.eq('timeBucket 121', lib.timeBucket(121), '120plus');

      const recs = lib.recommend(data, data[0], 3);
      s.eq('同类推荐 3 条', recs.length, 3);
      s.ok('推荐不含自己', recs.every(function (game) { return game.id !== data[0].id; }));
      s.ok('推荐同品类', recs.every(function (game) { return game.category === data[0].category; }));
      s.ok('推荐按评分降序', recs[0].rating >= recs[1].rating && recs[1].rating >= recs[2].rating);

      const sorted = lib.sortGames(data);
      const order = { euro: 0, party: 1, ameritrash: 2, card: 3, 'two-player': 4, family: 5 };
      s.ok('sortGames 按品类顺序稳定', sorted.every(function (game, i) {
        return i === 0 || order[sorted[i - 1].category] <= order[game.category];
      }));
      s.eq('categoryCounts 计数之和', Object.keys(lib.categoryCounts(data)).reduce(function (sum, key) {
        return sum + lib.categoryCounts(data)[key];
      }, 0), data.length);
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
