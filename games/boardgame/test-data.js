'use strict';

/*
 * 数据层单测：契约字段、覆盖度、fixture 重放幂等、品类映射、筛选纯函数。
 * 运行：node games/boardgame/test-data.js（run-all 会自动发现 test*.js）
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var cp = require('child_process');
var url = require('url');
var t = require('../tests/lib.js');

var ROOT = __dirname;
var DATA = path.join(ROOT, 'data');
var FIXTURES = path.join(ROOT, 'fixtures');
var SCRIPT = path.join(ROOT, 'scripts', 'fetch-gstone.mjs');
var LIB = path.join(ROOT, 'lib.mjs');

var s = t.suite('boardgame-data');

function md5(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function oneDecimal(n) {
  return Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

(async function () {
  var categories = readJson(path.join(DATA, 'categories.json'));
  var games = readJson(path.join(DATA, 'boardgames.json'));
  var schema = readJson(path.join(DATA, 'boardgames.schema.json'));
  var fixtureFile = fs.readdirSync(FIXTURES)
    .filter(function (f) { return /^gstone-.*\.json$/.test(f); })
    .sort()[0];
  var fixturePath = path.join(FIXTURES, fixtureFile);
  var fixture = readJson(fixturePath);

  var lib = await import(url.pathToFileURL(LIB).href);
  var importer = await import(url.pathToFileURL(SCRIPT).href);

  s.group('catalog shape', function () {
    s.ok('30–50 条数据', games.length >= 30 && games.length <= 50, 'got ' + games.length);
    s.eq('品类表 6 条', categories.length, 6);
    s.eq('fixture 与目录条数一致', fixture.games.length, games.length);
    s.eq('schema 顶层为数组', schema.type, 'array');
    s.eq('schema minItems', schema.minItems, 30);
    s.eq('schema maxItems', schema.maxItems, 50);
  });

  s.group('categories', function () {
    var keys = categories.map(function (c) { return c.key; });
    s.eq('品类 key 与契约顺序一致', keys, ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family']);
    categories.forEach(function (c) {
      s.ok(c.key + ' name.zh 非空', typeof c.name.zh === 'string' && c.name.zh.trim().length > 0);
      s.ok(c.key + ' name.en 非空', typeof c.name.en === 'string' && c.name.en.trim().length > 0);
      s.ok(c.key + ' desc.zh 非空', typeof c.desc.zh === 'string' && c.desc.zh.trim().length > 0);
      s.ok(c.key + ' desc.en 非空', typeof c.desc.en === 'string' && c.desc.en.trim().length > 0);
    });

    var counts = {};
    games.forEach(function (g) { counts[g.category] = (counts[g.category] || 0) + 1; });
    categories.forEach(function (c) {
      s.ok(c.key + ' 至少 3 条', (counts[c.key] || 0) >= 3, 'got ' + (counts[c.key] || 0));
    });
    s.eq('品类计数之和 = 数据条数',
      categories.reduce(function (sum, c) { return sum + (counts[c.key] || 0); }, 0),
      games.length);
    s.eq('schema 品类枚举一致', schema.items.properties.category.enum, keys);
  });

  s.group('identity', function () {
    var ids = new Set();
    var slugs = new Set();
    games.forEach(function (g) {
      s.ok(g.id + ' id 唯一', !ids.has(g.id));
      s.ok(g.slug + ' slug 唯一', !slugs.has(g.slug));
      ids.add(g.id);
      slugs.add(g.slug);
      s.ok(g.id + ' id 格式', /^gstone-[0-9]+$/.test(g.id), g.id);
      s.ok(g.slug + ' slug kebab-case', /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g.slug), g.slug);
    });
    s.eq('唯一 id 数量', ids.size, games.length);
    s.eq('唯一 slug 数量', slugs.size, games.length);
  });

  s.group('field types and ranges', function () {
    games.forEach(function (g) {
      s.ok(g.name.zh + ' 中文名非空', typeof g.name.zh === 'string' && g.name.zh.trim().length > 0);
      s.ok(g.name.zh + ' 原名非空', typeof g.name.en === 'string' && g.name.en.trim().length > 0);
      s.ok(g.name.zh + ' 品类合法', ['euro', 'party', 'ameritrash', 'card', 'two-player', 'family'].indexOf(g.category) !== -1);
      s.ok(g.name.zh + ' 人数为整数', Number.isInteger(g.players.min) && Number.isInteger(g.players.max));
      s.ok(g.name.zh + ' 人数范围合法', g.players.min >= 1 && g.players.min <= g.players.max && g.players.max <= 99);
      s.ok(g.name.zh + ' bestPlayers 为数组', Array.isArray(g.bestPlayers));
      s.ok(g.name.zh + ' bestPlayers 唯一', new Set(g.bestPlayers).size === g.bestPlayers.length);
      g.bestPlayers.forEach(function (n) {
        s.ok(g.name.zh + ' 最佳人数 ' + n + ' 在区间内', n >= g.players.min && n <= g.players.max);
      });
      s.ok(g.name.zh + ' 时长为整数', Number.isInteger(g.playTime.min) && Number.isInteger(g.playTime.max));
      s.ok(g.name.zh + ' 时长范围合法', g.playTime.min > 0 && g.playTime.min <= g.playTime.max && g.playTime.max <= 10000);
      s.ok(g.name.zh + ' 重度 1–5', typeof g.weight === 'number' && g.weight >= 1 && g.weight <= 5);
      s.ok(g.name.zh + ' 重度一位小数', oneDecimal(g.weight), String(g.weight));
      s.ok(g.name.zh + ' 评分 0–10', typeof g.rating === 'number' && g.rating >= 0 && g.rating <= 10);
      s.ok(g.name.zh + ' 评分一位小数', oneDecimal(g.rating), String(g.rating));
      s.ok(g.name.zh + ' 设计师数组', Array.isArray(g.designers));
      s.ok(g.name.zh + ' 出版社数组', Array.isArray(g.publishers));
      g.designers.concat(g.publishers).forEach(function (name) {
        s.ok(g.name.zh + ' 人员/出版社非空字符串', typeof name === 'string' && name.trim().length > 0);
      });
      s.ok(g.name.zh + ' 年份合法', Number.isInteger(g.year) && g.year >= 1000 && g.year <= 2100);
      s.ok(g.name.zh + ' coverUrl 为 https', /^https:\/\//.test(g.coverUrl));
      s.ok(g.name.zh + ' coverUrl 指向集石图床', g.coverUrl.indexOf('oss.gstonegames.com') !== -1);
      s.ok(g.name.zh + ' source.site 合法', ['gstone', 'bgg', 'manual'].indexOf(g.source.site) !== -1);
      s.ok(g.name.zh + ' source.url 为 https', /^https:\/\//.test(g.source.url), g.source.url);
      s.ok(g.name.zh + ' fetchedAt 可解析', !Number.isNaN(Date.parse(g.source.fetchedAt)), g.source.fetchedAt);
      if (g.tags != null) {
        s.ok(g.name.zh + ' tags 为数组', Array.isArray(g.tags));
        g.tags.forEach(function (tag) {
          s.ok(g.name.zh + ' tag 非空', typeof tag === 'string' && tag.trim().length > 0);
        });
      }
    });
  });

  s.group('fixture replay', function () {
    var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'boardgame-replay-'));
    var out1 = path.join(tmp, 'boardgames-1.json');
    var out2 = path.join(tmp, 'boardgames-2.json');
    var run1 = cp.spawnSync(process.execPath, [SCRIPT, '--fixture', fixturePath, '--out', out1], {
      cwd: ROOT, encoding: 'utf8'
    });
    var run2 = cp.spawnSync(process.execPath, [SCRIPT, '--fixture', fixturePath, '--out', out2], {
      cwd: ROOT, encoding: 'utf8'
    });
    s.ok('fixture 重放第一次退出 0', run1.status === 0, (run1.stderr || '').trim());
    s.ok('fixture 重放第二次退出 0', run2.status === 0, (run2.stderr || '').trim());
    s.ok('重放输出文件存在', fs.existsSync(out1) && fs.existsSync(out2));

    var a = fs.readFileSync(out1);
    var b = fs.readFileSync(out2);
    s.ok('两次重放字节一致', a.equals(b));
    s.eq('两次重放 md5 一致', md5(a), md5(b));
    s.eq('重放结果与已提交数据 md5 一致', md5(a), md5(fs.readFileSync(path.join(DATA, 'boardgames.json'))));

    var replay = JSON.parse(a.toString('utf8'));
    s.eq('重放条数', replay.length, games.length);
    s.eq('重放 slug 顺序稳定', replay.map(function (g) { return g.slug; }), games.map(function (g) { return g.slug; }));

    fixture.games.forEach(function (record) {
      s.ok('fixture ' + record.sourceId + ' 有 htmlSha256', /^[0-9a-f]{64}$/.test(record.htmlSha256));
      s.ok('fixture ' + record.sourceId + ' 有公开详情 URL', /^https:\/\/www\.gstonegames\.com\/game\/info-[0-9]+\.html$/.test(record.url));
      s.ok('fixture ' + record.sourceId + ' 记录抓取时间', !Number.isNaN(Date.parse(record.fetchedAt)));
    });

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  s.group('category mapping', function () {
    s.eq('德式 -> euro', importer.mapCategory('德式', '550'), 'euro');
    s.eq('聚会 -> party', importer.mapCategory('聚会', '13275'), 'party');
    s.eq('美式 -> ameritrash', importer.mapCategory('美式', '745'), 'ameritrash');
    s.eq('卡牌 -> card', importer.mapCategory('卡牌', '782'), 'card');
    s.eq('亲子 -> family', importer.mapCategory('亲子', '33628'), 'family');
    s.eq('战棋 -> two-player', importer.mapCategory('战棋', '10465'), 'two-player');
    s.eq('解谜 -> family', importer.mapCategory('解谜', '19552'), 'family');
    s.eq('抽象 -> family 默认', importer.mapCategory('抽象', '30026'), 'family');
    s.eq('国际象棋覆盖为 two-player', importer.mapCategory('抽象', '569'), 'two-player');
    s.eq('日本麻将覆盖为 family', importer.mapCategory('抽象', '2135'), 'family');
    s.eq('未知原始类别回退 family', importer.mapCategory('未知类别', '999999'), 'family');
    s.eq('精选条目 43 条', importer.EDITORIAL.length, 43);
  });

  s.group('filter logic', function () {
    s.eq('无条件返回全部', lib.filterGames(games, {}).length, games.length);
    s.eq('null 条件返回全部', lib.filterGames(games, null).length, games.length);

    var euro = lib.filterGames(games, { category: 'euro' });
    s.ok('euro 筛选非空', euro.length > 0);
    euro.forEach(function (g) { s.ok('euro 结果品类正确 ' + g.slug, g.category === 'euro'); });

    var two = lib.filterGames(games, { players: 2 });
    s.ok('2 人筛选非空', two.length > 0);
    two.forEach(function (g) {
      s.ok('2 人结果覆盖 2 人 ' + g.slug, g.players.min <= 2 && 2 <= g.players.max);
    });

    var five = lib.filterGames(games, { players: 5 });
    s.ok('5+ 筛选非空', five.length > 0);
    five.forEach(function (g) { s.ok('5+ 结果上限 >= 5 ' + g.slug, g.players.max >= 5); });

    var short = lib.filterGames(games, { time: '30' });
    s.ok('≤30 分钟非空', short.length > 0);
    short.forEach(function (g) { s.ok('≤30 结果时长正确 ' + g.slug, g.playTime.max <= 30); });

    var long = lib.filterGames(games, { time: '120plus' });
    s.ok('120+ 非空', long.length > 0);
    long.forEach(function (g) { s.ok('120+ 结果时长正确 ' + g.slug, g.playTime.max > 120); });

    var arkham = lib.filterGames(games, { q: 'arkham' });
    s.ok('搜索 arkham 命中', arkham.length >= 2, 'got ' + arkham.length);
    arkham.forEach(function (g) {
      var hay = (g.name.zh + ' ' + g.name.en + ' ' + g.slug).toLowerCase();
      s.ok('搜索结果含关键词 ' + g.slug, hay.indexOf('arkham') !== -1);
    });

    var combined = lib.filterGames(games, { category: 'euro', players: '3', q: 'a' });
    combined.forEach(function (g) {
      s.ok('组合筛选品类 ' + g.slug, g.category === 'euro');
      s.ok('组合筛选人数 ' + g.slug, g.players.min <= 3 && 3 <= g.players.max);
      var hay = (g.name.zh + ' ' + g.name.en + ' ' + g.slug + ' ' + g.designers.join(' ') + ' ' + g.publishers.join(' ')).toLowerCase();
      s.ok('组合筛选关键词 ' + g.slug, hay.indexOf('a') !== -1);
    });

    s.eq('timeBucket 30', lib.timeBucket(30), '30');
    s.eq('timeBucket 31', lib.timeBucket(31), '60');
    s.eq('timeBucket 60', lib.timeBucket(60), '60');
    s.eq('timeBucket 61', lib.timeBucket(61), '120');
    s.eq('timeBucket 120', lib.timeBucket(120), '120');
    s.eq('timeBucket 121', lib.timeBucket(121), '120plus');

    var recs = lib.recommend(games, games[0], 3);
    s.eq('同类推荐 3 条', recs.length, 3);
    recs.forEach(function (rec) {
      s.ok('推荐不包含自己', rec.id !== games[0].id);
      s.ok('推荐同品类 ' + rec.slug, rec.category === games[0].category);
    });
    s.ok('推荐按评分降序', recs[0].rating >= recs[1].rating && recs[1].rating >= recs[2].rating);

    var sorted = lib.sortGames(games);
    var order = { euro: 0, party: 1, ameritrash: 2, card: 3, 'two-player': 4, family: 5 };
    var monotonic = sorted.every(function (g, i) {
      return i === 0 || order[sorted[i - 1].category] <= order[g.category];
    });
    s.ok('sortGames 按品类顺序', monotonic);
  });

  s.done();
})().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
