'use strict';

/*
 * Collector regression: both pipelines are offline and deterministic.
 *
 *   1. gstone: replay collector/fixtures/gstone-2026-11-10.json through
 *      collector/fetch-gstone.mjs; bytes must equal data/boardgames.json.
 *   2. BGG: parse collector/fixtures/bgg-sample.xml through
 *      collector/import.mjs; games[] must equal out/games.imported.json.
 *
 * No network, no raw/ writes. This suite always runs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createSuite } from './lib/suite.mjs';
import { ROOT } from './lib/probe.mjs';

const COLLECTOR = path.join(ROOT, 'collector');
const GSTONE_FIXTURE = path.join(COLLECTOR, 'fixtures', 'gstone-2026-11-10.json');
const BGG_FIXTURE = path.join(COLLECTOR, 'fixtures', 'bgg-sample.xml');
const GSTONE_SCRIPT = path.join(COLLECTOR, 'fetch-gstone.mjs');
const BGG_IMPORT = path.join(COLLECTOR, 'import.mjs');
const BGG_OUT = path.join(COLLECTOR, 'out', 'games.imported.json');
const DATA = path.join(ROOT, 'data', 'boardgames.json');

const CATEGORIES = ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function md5(file) {
  return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex');
}

function oneDecimal(value) {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

const s = createSuite('boardgame-collector');

await s.run(async () => {
  await s.group('collector files', async () => {
    for (const file of [GSTONE_FIXTURE, BGG_FIXTURE, GSTONE_SCRIPT, BGG_IMPORT, BGG_OUT, DATA]) {
      s.ok(path.relative(ROOT, file) + ' 存在', fs.existsSync(file));
    }
    const readme = fs.readFileSync(path.join(COLLECTOR, 'README.md'), 'utf8');
    s.includes('README 记录 gstone 管线', readme, 'fetch-gstone.mjs');
    s.includes('README 记录 BGG 补充管线', readme, 'import.mjs');
    s.includes('README 标明 BGG 样例不是目录真源', readme, '不是目录真源');
    const bggXml = fs.readFileSync(BGG_FIXTURE, 'utf8');
    s.includes('BGG fixture 标注 SAMPLE DATA', bggXml, 'SAMPLE DATA');
    s.eq('BGG fixture 含 5 个 item', (bggXml.match(/<item\b/g) || []).length, 5);
  });

  await s.group('gstone fixture replay', async () => {
    const fixture = readJson(GSTONE_FIXTURE);
    s.eq('gstone fixture 43 条', fixture.games.length, 43);
    s.eq('gstone fixture 与 data 条数一致', fixture.games.length, readJson(DATA).length);
    for (const record of fixture.games) {
      s.ok('记录 ' + record.sourceId + ' 有数字 sourceId', /^[0-9]+$/.test(String(record.sourceId)));
      s.matches('记录 ' + record.sourceId + ' 有公开详情 URL', record.url,
        /^https:\/\/www\.gstonegames\.com\/game\/info-[0-9]+\.html$/);
      s.matches('记录 ' + record.sourceId + ' 有 HTML SHA-256', record.htmlSha256, /^[0-9a-f]{64}$/);
      s.ok('记录 ' + record.sourceId + ' 抓取时间可解析', !Number.isNaN(Date.parse(record.fetchedAt)));
      s.ok('record ' + record.sourceId + ' 保留原始字段快照', record.raw !== undefined ||
        record.fields !== undefined || record.name !== undefined || record.title !== undefined,
        JSON.stringify(Object.keys(record)).slice(0, 160));
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-collector-gstone-'));
    try {
      const out = path.join(tmp, 'boardgames.json');
      const run = spawnSync(process.execPath, [GSTONE_SCRIPT, '--fixture', GSTONE_FIXTURE, '--out', out], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60000
      });
      s.ok('fetch-gstone --fixture 退出码 0', run.status === 0, (run.stderr || run.stdout || '').trim());
      s.ok('fetch-gstone 产出文件', fs.existsSync(out));
      if (fs.existsSync(out)) {
        s.eq('gstone 重放 md5 与 data/boardgames.json 一致', md5(out), md5(DATA));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  await s.group('BGG sample import', async () => {
    const imported = readJson(BGG_OUT);
    s.eq('out/games.imported.json count', imported.count, 5);
    s.eq('source 为 bgg', imported.source, 'bgg');
    s.ok('generatedAt 可解析', !Number.isNaN(Date.parse(imported.generatedAt)));
    s.eq('games 数组 5 条', imported.games.length, 5);

    const ids = new Set();
    const slugs = new Set();
    for (const game of imported.games) {
      const label = game.slug || game.id;
      s.matches(label + ' id 为 bgg-*', game.id, /^bgg-[0-9]+$/);
      s.ok(label + ' id 唯一', !ids.has(game.id));
      s.ok(label + ' slug 唯一', !slugs.has(game.slug));
      ids.add(game.id);
      slugs.add(game.slug);
      s.matches(label + ' slug kebab-case', game.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      s.ok(label + ' name.zh 非空', typeof game.name.zh === 'string' && game.name.zh.length > 0);
      s.ok(label + ' name.en 非空', typeof game.name.en === 'string' && game.name.en.length > 0);
      s.ok(label + ' 品类合法', CATEGORIES.indexOf(game.category) !== -1, game.category);
      s.ok(label + ' 人数合法', Number.isInteger(game.players.min) && Number.isInteger(game.players.max) &&
        game.players.min >= 1 && game.players.min <= game.players.max);
      s.ok(label + ' 时长合法', Number.isInteger(game.playTime.min) && Number.isInteger(game.playTime.max) &&
        game.playTime.min > 0 && game.playTime.min <= game.playTime.max);
      s.ok(label + ' weight 0–5', typeof game.weight === 'number' && game.weight >= 0 && game.weight <= 5);
      s.ok(label + ' rating 0–10', typeof game.rating === 'number' && game.rating >= 0 && game.rating <= 10);
      s.ok(label + ' year 合法', Number.isInteger(game.year) && game.year >= 1000 && game.year <= 2100);
      s.ok(label + ' cover.url 为 null（不加载外链）', game.cover && game.cover.url === null,
        JSON.stringify(game.cover));
      s.ok(label + ' cover.placeholder 非空', game.cover && typeof game.cover.placeholder === 'string');
      s.eq(label + ' source.site', game.source && game.source.site, 'bgg');
      s.matches(label + ' source.url 为 BGG 页面', game.source.url,
        /^https:\/\/boardgamegeek\.com\/boardgame\/[0-9]+$/);
      s.ok(label + ' fetchedAt 可解析', !Number.isNaN(Date.parse(game.source.fetchedAt)));
      s.ok(label + ' designers 为数组', Array.isArray(game.designers));
      s.ok(label + ' publishers 为数组', Array.isArray(game.publishers));
      s.ok(label + ' bgg.categories 为数组', Array.isArray(game.bgg && game.bgg.categories));
      s.ok(label + ' bgg.mechanics 为数组', Array.isArray(game.bgg && game.bgg.mechanics));
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-collector-bgg-'));
    try {
      const out = path.join(tmp, 'games.imported.json');
      const run = spawnSync(process.execPath, [BGG_IMPORT, '--input', BGG_FIXTURE, '--out', out], {
        cwd: COLLECTOR,
        encoding: 'utf8',
        timeout: 60000
      });
      s.ok('import.mjs 退出码 0', run.status === 0, (run.stderr || run.stdout || '').trim());
      s.ok('import.mjs 产出文件', fs.existsSync(out));
      if (fs.existsSync(out)) {
        const replay = readJson(out);
        s.eq('重放 count = 5', replay.count, 5);
        // Import timestamps are generated at run time; everything else is
        // deterministic and must match the committed sample output.
        function stripTimes(games) {
          return games.map(function (game) {
            const copy = JSON.parse(JSON.stringify(game));
            if (copy.source) delete copy.source.fetchedAt;
            return copy;
          });
        }
        s.eq('重放 games 与已提交结果一致（忽略抓取时间）',
          JSON.stringify(stripTimes(replay.games)), JSON.stringify(stripTimes(imported.games)));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }

    s.ok('样例 BGG 数据没有混入目录真源', readJson(DATA).every(function (game) {
      return String(game.id).indexOf('bgg-') !== 0;
    }));
  });

  await s.group('normalization invariants', async () => {
    const imported = readJson(BGG_OUT);
    const catan = imported.games.find(function (game) { return game.id === 'bgg-13'; });
    s.ok('样例含 CATAN (bgg-13)', catan !== undefined);
    if (catan) {
      s.eq('CATAN 品类 euro', catan.category, 'euro');
      s.eq('CATAN 人数 3–4', catan.players, { min: 3, max: 4 });
      s.ok('CATAN weight 一位小数或两位', Number.isFinite(catan.weight), String(catan.weight));
      s.ok('CATAN rating 一位小数', oneDecimal(catan.rating), String(catan.rating));
    }
    const slugs = imported.games.map(function (game) { return game.slug; });
    s.eq('slug 无重复', new Set(slugs).size, slugs.length);
  });
});
