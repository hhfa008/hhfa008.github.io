#!/usr/bin/env node
'use strict';

/*
 * Board game catalog tests.
 *
 * Discovered by games/tests/run-all.js because the filename matches test*.js
 * and games/boardgames/index.html exists. Everything here is offline: it reads
 * data, fixtures and generated HTML, and runs build/fetch into a visible
 * test-output directory that is removed afterwards.
 */

var fs = require('fs');
var path = require('path');
var child = require('child_process');
var lib = require('../tests/lib.js');
var data = require('./scripts/lib/data.js');
var schemaLite = require('./scripts/lib/schema-lite.js');
var fetchGames = require('./scripts/fetch-games.js');

var t = lib.suite('boardgames');
var ROOT = __dirname;
var OUTPUT = path.join(ROOT, 'test-output');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function runNode(args, extraEnv) {
  return child.spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 20 * 1024 * 1024,
    env: Object.assign({}, process.env, { NO_COLOR: '1' }, extraEnv || {})
  });
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (ignored) {}
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Kept local so this test also runs on older games/tests/lib.js revisions
// that predate the tools helper.
function externalRefs(html) {
  var checks = [
    { re: /<script[^>]*\bsrc\s*=/gi, why: '<script src>' },
    { re: /<link[^>]*\brel\s*=\s*["']?stylesheet/gi, why: 'stylesheet link' },
    { re: /@import/gi, why: '@import' },
    { re: /url\(\s*["']?https?:/gi, why: 'remote url()' },
    { re: /\bfetch\s*\(/g, why: 'fetch()' },
    { re: /XMLHttpRequest/g, why: 'XMLHttpRequest' },
    { re: /sendBeacon/g, why: 'sendBeacon' }
  ];
  var hits = [];
  checks.forEach(function (c) {
    var m = html.match(c.re);
    if (m) hits.push(c.why + ' ×' + m.length);
  });
  return hits;
}

var categories = data.loadCategories();
var games = data.loadGames();
var schema = data.loadSchema();
var catMap = data.categoryMap(categories);

// ---------------------------------------------------------------------------
t.group('categories', function () {
  t.ok('categories is an array', Array.isArray(categories));
  t.eq('exactly 6 categories', categories.length, 6);
  t.eq('category ids', categories.map(function (c) { return c.id; }).sort(), data.EXPECTED_CATEGORIES.slice().sort());
  t.eq('category order', categories.slice().sort(function (a, b) { return a.order - b.order; }).map(function (c) { return c.order; }), [1, 2, 3, 4, 5, 6]);
  categories.forEach(function (cat) {
    t.ok('category ' + cat.id + ' has zh', typeof cat.zh === 'string' && cat.zh.trim().length > 0);
    t.ok('category ' + cat.id + ' has en', typeof cat.en === 'string' && cat.en.trim().length > 0);
    t.ok('category ' + cat.id + ' has desc', typeof cat.desc === 'string' && cat.desc.trim().length > 0);
    t.ok('category ' + cat.id + ' has only known fields',
      Object.keys(cat).sort().join(',') === ['desc', 'en', 'id', 'order', 'zh'].join(','));
  });
  t.ok('category ids unique', new Set(categories.map(function (c) { return c.id; })).size === categories.length);
  t.ok('category order unique', new Set(categories.map(function (c) { return c.order; })).size === categories.length);
});

// ---------------------------------------------------------------------------
t.group('games schema', function () {
  t.eq('catalog has 40 games', games.length, 40);
  t.ok('catalog is non-empty', games.length > 0);

  var schemaErrors = [];
  games.forEach(function (game, i) {
    schemaLite.validate(game, schema, 'games[' + i + ']').forEach(function (err) { schemaErrors.push(err); });
  });
  t.eq('every game matches schema/game.schema.json', schemaErrors.length, 0,
    schemaErrors.slice(0, 6).map(function (e) { return e.path + ': ' + e.message; }).join(' | '));

  var ids = games.map(function (g) { return g.id; });
  var slugs = games.map(function (g) { return g.slug; });
  t.eq('ids unique', new Set(ids).size, ids.length);
  t.eq('slugs unique', new Set(slugs).size, slugs.length);
  t.ok('all slugs are URL-safe', slugs.every(function (s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s); }));

  var used = Object.create(null);
  games.forEach(function (game) {
    var at = game.slug;
    t.ok(at + ': name is non-empty', typeof game.name === 'string' && game.name.trim().length > 0);
    t.ok(at + ': nameOriginal is non-empty', typeof game.nameOriginal === 'string' && game.nameOriginal.trim().length > 0);
    t.ok(at + ': description is non-empty', typeof game.description === 'string' && game.description.trim().length > 0);
    t.ok(at + ': has at least one category', Array.isArray(game.categories) && game.categories.length > 0);
    t.ok(at + ': categories are valid', game.categories.every(function (c) { return data.EXPECTED_CATEGORIES.indexOf(c) !== -1; }));
    t.ok(at + ': categories are unique', new Set(game.categories).size === game.categories.length);
    game.categories.forEach(function (c) { used[c] = true; });

    t.ok(at + ': playersMin <= playersMax', game.playersMin <= game.playersMax);
    t.ok(at + ': playersMin >= 1', game.playersMin >= 1);
    var best = data.parseBestPlayers(game.bestPlayers);
    t.ok(at + ': bestPlayers is parseable', !isNaN(best[0]) && !isNaN(best[1]));
    t.ok(at + ': bestPlayers inside player range',
      best[0] >= game.playersMin && best[1] <= game.playersMax && best[0] <= best[1]);
    t.ok(at + ': playTimeMin <= playTimeMax', game.playTimeMin <= game.playTimeMax);
    t.ok(at + ': playTime positive', game.playTimeMin >= 1 && game.playTimeMax >= 1);
    t.ok(at + ': weight 1..5', typeof game.weight === 'number' && game.weight >= 1 && game.weight <= 5);
    t.ok(at + ': rating 0..10 or null', game.rating === null || (typeof game.rating === 'number' && game.rating >= 0 && game.rating <= 10));
    t.ok(at + ': designers is array of strings', Array.isArray(game.designers) && game.designers.every(function (d) { return typeof d === 'string' && d.length > 0; }));
    t.ok(at + ': publishers is array of strings', Array.isArray(game.publishers) && game.publishers.every(function (p) { return typeof p === 'string' && p.length > 0; }));
    t.ok(at + ': year is integer or null', game.year === null || Number.isInteger(game.year));
    t.ok(at + ': cover gradient is local', /^linear-gradient\(/.test(game.cover.gradient) && !/https?:|url\s*\(/i.test(game.cover.gradient));
    t.ok(at + ': cover label is non-empty', typeof game.cover.label === 'string' && game.cover.label.length > 0);
    t.ok(at + ': source type is known', ['fixture', 'bgg', 'gstone', 'manual'].indexOf(game.source.type) !== -1);
    t.ok(at + ': source date is YYYY-MM-DD', /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(game.source.fetchedAt));
    t.ok(at + ': source url is https or null', game.source.url == null || /^https:\/\//.test(game.source.url));
  });

  data.EXPECTED_CATEGORIES.forEach(function (id) {
    t.ok('category ' + id + ' is used by at least one game', !!used[id]);
  });
  var counts = data.countByCategory(games);
  t.ok('category counts are all positive', data.EXPECTED_CATEGORIES.every(function (id) { return counts[id] > 0; }));
  t.ok('category counts do not exceed games x categories', data.EXPECTED_CATEGORIES.every(function (id) { return counts[id] <= games.length * 2; }));
});

// ---------------------------------------------------------------------------
t.group('fixtures and importer', function () {
  var fixture = data.loadFixture();
  t.eq('fixture has the same number of games', fixture.length, games.length);
  t.eq('data/games.json is a replay of the fixture', JSON.stringify(games), JSON.stringify(fixture));

  var attempt = data.readJSON(data.PATHS.gstoneAttempt);
  t.ok('gstone attempt record has checkedAt', /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(attempt.checkedAt));
  t.ok('gstone attempt record has at least 3 attempts', Array.isArray(attempt.attempts) && attempt.attempts.length >= 3);
  t.ok('gstone attempt records robots disallow', JSON.stringify(attempt).indexOf('Disallow:/') !== -1);
  t.ok('gstone decision mentions stopping', /stopped|停止/.test(attempt.decision));

  t.ok('robotsDisallowsAll handles Disallow:/', fetchGames.robotsDisallowsAll('User-agent:*\nDisallow:/') === true);
  t.ok('robotsDisallowsAll allows a normal site', fetchGames.robotsDisallowsAll('User-agent:*\nDisallow:/private\nAllow:/') === false);
  t.ok('robotsDisallowsAll handles our bot group', fetchGames.robotsDisallowsAll('User-agent: BoardgamesCatalogBot\nDisallow:/\n\nUser-agent:*\nDisallow:') === true);

  var links = fetchGames.extractDetailLinks('<a href="/game/info-10292.html">a</a><a href="/game/info-10292.html">b</a><a href="/game/info-3.html">c</a>', 'https://www.gstonegames.com');
  t.eq('extractDetailLinks dedupes and absolutizes', links, ['https://www.gstonegames.com/game/info-10292.html', 'https://www.gstonegames.com/game/info-3.html']);
  t.ok('extractDetailLinks ignores unrelated links', fetchGames.extractDetailLinks('<a href="/bbs/x.html">x</a>', 'https://www.gstonegames.com').length === 0);

  var args = fetchGames.parseArgs(['--online', '--limit', '5', '--out', '/tmp/x.json']);
  t.eq('parseArgs --online', args.online, true);
  t.eq('parseArgs --limit', args.limit, 5);
  t.ok('parseArgs --out is absolute', path.isAbsolute(args.out));
  t.eq('parseArgs default is offline', fetchGames.parseArgs([]).online, false);

  rmrf(OUTPUT);
  var importerOut = path.join(OUTPUT, 'imported-games.json');
  var res = runNode(['scripts/fetch-games.js', '--fixture', data.PATHS.fixture, '--out', importerOut]);
  t.eq('offline importer exits 0', res.status, 0, (res.stderr || '').trim());
  t.ok('offline importer wrote the output file', fs.existsSync(importerOut));
  if (fs.existsSync(importerOut)) {
    var imported = JSON.parse(fs.readFileSync(importerOut, 'utf8'));
    t.eq('offline importer preserves all records', JSON.stringify(imported), JSON.stringify(fixture));
  }
});

// ---------------------------------------------------------------------------
t.group('list filter functions', function () {
  var html = read('index.html');
  var gameMatches = lib.evalBetween(html, '/* FILTER:START */', '/* FILTER:END */', 'gameMatches');
  t.ok('gameMatches is a function', typeof gameMatches === 'function');

  var sample = {
    slug: 'catan',
    name: '卡坦岛',
    nameOriginal: 'Catan',
    categories: ['euro', 'family'],
    playersMin: 3,
    playersMax: 4,
    playTimeMin: 60,
    playTimeMax: 120,
    designers: ['Klaus Teuber'],
    publishers: ['Kosmos'],
    year: 1995
  };

  t.ok('empty filters match', gameMatches(sample, {}) === true);
  t.ok('category match', gameMatches(sample, { categories: ['euro'] }) === true);
  t.ok('category miss', gameMatches(sample, { categories: ['party'] }) === false);
  t.ok('category OR', gameMatches(sample, { categories: ['party', 'family'] }) === true);
  t.ok('players 2 rejected', gameMatches(sample, { players: '2' }) === false);
  t.ok('players 3 accepted', gameMatches(sample, { players: '3' }) === true);
  t.ok('players 4 accepted', gameMatches(sample, { players: '4' }) === true);
  t.ok('players 5 rejected', gameMatches(sample, { players: '5' }) === false);
  t.ok('players empty accepted', gameMatches(sample, { players: '' }) === true);
  t.ok('time 30 rejected', gameMatches(sample, { time: '30' }) === false);
  t.ok('time 60 accepted', gameMatches(sample, { time: '60' }) === true);
  t.ok('time 120 accepted', gameMatches(sample, { time: '120' }) === true);
  t.ok('time 121 rejected', gameMatches(sample, { time: '121' }) === false);
  t.ok('query by name', gameMatches(sample, { query: '卡坦' }) === true);
  t.ok('query by original name case-insensitive', gameMatches(sample, { query: 'cAtAn' }) === true);
  t.ok('query by designer', gameMatches(sample, { query: 'klaus' }) === true);
  t.ok('query by publisher', gameMatches(sample, { query: 'kosmos' }) === true);
  t.ok('query by year', gameMatches(sample, { query: '1995' }) === true);
  t.ok('query miss', gameMatches(sample, { query: 'zzz' }) === false);
  t.ok('combined match', gameMatches(sample, { categories: ['euro'], players: '4', time: '60', query: 'catan' }) === true);
  t.ok('combined miss', gameMatches(sample, { categories: ['euro'], players: '2', time: '60' }) === false);

  var allMatch = games.every(function (game) { return gameMatches(game, {}); });
  t.ok('every catalog game matches empty filters', allMatch);
  var catMatches = games.every(function (game) {
    return game.categories.every(function (cat) { return gameMatches(game, { categories: [cat] }); });
  });
  t.ok('every game matches each of its categories', catMatches);
});

// ---------------------------------------------------------------------------
t.group('build end-to-end', function () {
  rmrf(OUTPUT);
  var buildOut = path.join(OUTPUT, 'site');
  var res = runNode(['scripts/build.js', '--out', buildOut, '--quiet']);
  t.eq('build exits 0', res.status, 0, (res.stderr || '').trim());

  var listPath = path.join(buildOut, 'index.html');
  t.ok('list page exists', fs.existsSync(listPath));
  if (!fs.existsSync(listPath)) return;

  var listHtml = fs.readFileSync(listPath, 'utf8');
  var detailFiles = games.map(function (game) { return path.join(buildOut, game.slug, 'index.html'); });
  t.eq('detail page count equals game count', detailFiles.filter(function (f) { return fs.existsSync(f); }).length, games.length);

  t.ok('list page has catalog total', listHtml.indexOf('id="catalog-total">' + games.length + '<') !== -1);
  t.eq('list page has one card per game', countOccurrences(listHtml, 'data-categories="'), games.length);
  t.eq('list page has one card link per game', countOccurrences(listHtml, 'class="game-card"'), games.length);
  t.ok('list page has all six category chips', data.EXPECTED_CATEGORIES.every(function (id) {
    return listHtml.indexOf('data-cat="' + id + '"') !== -1;
  }));
  t.ok('list page has filter controls', listHtml.indexOf('id="filter-players"') !== -1 &&
    listHtml.indexOf('id="filter-time"') !== -1 && listHtml.indexOf('id="filter-query"') !== -1);
  t.ok('list page has dark mode', listHtml.indexOf('prefers-color-scheme: dark') !== -1);
  t.ok('list page has mobile viewport', listHtml.indexOf('width=device-width') !== -1);
  t.ok('list page has 44px touch targets', listHtml.indexOf('min-height:44px') !== -1);
  t.ok('list page has no unreplaced placeholder', !/\{\{|\bundefined\b|\bNaN\b|\bTODO\b/.test(listHtml));
  t.eq('list page makes no external requests', externalRefs(listHtml), []);

  var detailOk = true;
  var detailMissingName = [];
  var detailMissingJsonLd = [];
  var detailExternal = [];
  detailFiles.forEach(function (file, i) {
    if (!fs.existsSync(file)) { detailOk = false; return; }
    var html = fs.readFileSync(file, 'utf8');
    var game = games[i];
    if (html.indexOf(game.name) === -1) detailMissingName.push(game.slug);
    if (html.indexOf('"@type": "BoardGame"') === -1) detailMissingJsonLd.push(game.slug);
    if (externalRefs(html).length) detailExternal.push(game.slug);
    if (/\{\{|\bundefined\b|\bNaN\b|\bTODO\b/.test(html)) detailOk = false;
    if (html.indexOf('id="catalog-total"') !== -1) detailOk = false;
  });
  t.eq('every detail page contains its game name', detailMissingName, []);
  t.eq('every detail page has BoardGame JSON-LD', detailMissingJsonLd, []);
  t.eq('every detail page makes no external requests', detailExternal, []);
  t.ok('every detail page has no unreplaced placeholder', detailOk);

  var sampleDetail = fs.readFileSync(detailFiles[0], 'utf8');
  t.ok('detail page has canonical URL', sampleDetail.indexOf('rel="canonical" href="https://hhfa008.github.io/games/boardgames/') !== -1);
  t.ok('detail page links back to the list', sampleDetail.indexOf('href="/games/boardgames/"') !== -1);
  t.ok('detail page shows best player count', sampleDetail.indexOf('最佳人数') !== -1);
  t.ok('detail page local cover only', !/https?:[^"']*\.(png|jpg|jpeg|webp|gif|svg)/i.test(sampleDetail));

  var check = runNode(['scripts/build.js', '--check', '--out', buildOut]);
  t.eq('build --check passes on fresh output', check.status, 0, (check.stderr || '').trim());

  var before = fs.readFileSync(detailFiles[0], 'utf8');
  var res2 = runNode(['scripts/build.js', '--out', buildOut, '--quiet']);
  t.eq('second build exits 0', res2.status, 0);
  var after = fs.readFileSync(detailFiles[0], 'utf8');
  t.ok('rebuild is byte-identical', before === after);

  fs.appendFileSync(listPath, '\n<!-- stale -->\n');
  var staleCheck = runNode(['scripts/build.js', '--check', '--out', buildOut]);
  t.ok('build --check detects stale list page', staleCheck.status !== 0);
  t.ok('build --check names the stale file', /list page is stale/.test(staleCheck.stderr || ''));

  var sourceCheck = runNode(['scripts/build.js', '--check']);
  t.eq('committed list and detail pages are up to date', sourceCheck.status, 0, (sourceCheck.stderr || '').trim());
});

// ---------------------------------------------------------------------------
t.group('readme', function () {
  var readme = read('README.md');
  t.ok('README exists and has content', readme.length > 500);
  ['fetch-games.js', 'build.js', 'fixture', '评分', '重度', 'robots'].forEach(function (word) {
    t.ok('README mentions ' + word, readme.indexOf(word) !== -1);
  });
});

rmrf(OUTPUT);
t.done();
