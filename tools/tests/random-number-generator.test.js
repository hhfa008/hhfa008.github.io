#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'random-number-generator';
var DIR = path.join('/Users/fa/games/tools', SLUG);
var MAX_BYTES = 90 * 1024;
var EXPECTED_CANONICAL = 'https://hhfa008.github.io/tools/' + SLUG + '/';
var LANGS = ['zh', 'en', 'id'];
var GENERIC_KEYS = [
  'docTitle', 'docDesc', 'appTitle', 'tagline', 'privacy', 'navHall',
  'navGames', 'langLabel', 'copy', 'copied', 'copyFail', 'reset', 'result',
  'errorInvalid', 'explainTitle', 'faqTitle', 'formulaTitle', 'backTools',
  'moreTools', 'footerNote', 'copyright', 'notMedical', 'notFinancial', 'unitNote',
  'download', 'clear', 'swap', 'add', 'remove', 'close', 'yes', 'no'
];

var html = lib.page(DIR);
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* reported below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* reported below */ }

t.group('i18n', function () {
  t.ok('TOOL_I18N evaluates', !!dict && typeof dict === 'object');
  if (!dict) return 'dictionary missing';
  var keys = lib.checkI18n(t, dict, GENERIC_KEYS);
  var markup = html.replace(/<!--[\s\S]*?-->/g, '');
  var used = lib.dataIKeys(markup);
  t.ok('page references data-i keys', used.length > 0, 'found ' + used.length);
  used.forEach(function (key) {
    LANGS.forEach(function (lang) {
      t.ok('data-i key ' + key + ' exists in ' + lang,
        !!(dict[lang] && Object.prototype.hasOwnProperty.call(dict[lang], key)));
    });
  });
  var faqQuestions = (markup.match(/data-i\s*=\s*["']faqQ\d+["']/g) || []).length;
  t.ok('visible FAQ has at least 3 entries', faqQuestions >= 3, 'found ' + faqQuestions);
  return used.length + ' data-i keys, ' + keys.length + ' dictionary keys';
});

t.group('static', function () {
  var refs = lib.externalRefs(html);
  t.eq('externalRefs is empty', refs, []);
  var jsonLd = [];
  try { jsonLd = lib.jsonLd(html); t.ok('JSON-LD parses', true); }
  catch (e) { t.ok('JSON-LD parses', false, e.message); }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  var types = jsonLd.map(function (item) { return item && item['@type']; }).sort();
  t.eq('JSON-LD types', types, ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  var faqPage = jsonLd.filter(function (item) { return item && item['@type'] === 'FAQPage'; })[0];
  t.ok('FAQPage has 3+ questions', !!faqPage && Array.isArray(faqPage.mainEntity) && faqPage.mainEntity.length >= 3);
  t.ok('FAQPage entries have answers', !!faqPage && faqPage.mainEntity.every(function (item) {
    return item && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));
  t.ok('viewport present', /<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html));
  var title = html.match(/<title>\s*([^<]*?)\s*<\/title>/i);
  t.ok('title non-empty', !!(title && title[1].trim()));
  t.ok('meta description non-empty', /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i.test(html));
  var canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  t.ok('canonical correct', !!canonical && canonical[1] === EXPECTED_CANONICAL);
  t.ok('author is Devin', /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('robots meta present', /<meta[^>]+name\s*=\s*["']robots["']/i.test(html));
  t.ok('inline data URI favicon', /<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  LANGS.forEach(function (lang) {
    var count = (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length;
    t.eq('one language button for ' + lang, count, 1);
  });
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var engineCode = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage',
    !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(engineCode));
  t.ok('engine has no clock dependency',
    !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(engineCode));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var rng = lib.mulberry32(12345);
  t.eq('randomInt(1,1) is always 1', engine.randomInt(1, 1, rng), { ok: true, value: 1 });
  t.eq('randomInt rejects string bound', engine.randomInt('1', 2, rng), { ok: false, error: 'bad_value' });
  t.eq('randomInt rejects NaN', engine.randomInt(NaN, 2, rng), { ok: false, error: 'bad_value' });
  t.eq('randomInt rejects min > max', engine.randomInt(5, 4, rng), { ok: false, error: 'range' });
  t.eq('randomInt rejects missing rng', engine.randomInt(1, 2, null), { ok: false, error: 'bad_rng' });

  var boundary = true;
  var r = lib.mulberry32(7);
  for (var i = 0; i < 500; i++) {
    var draw = engine.randomInt(1, 6, r);
    if (!draw.ok || draw.value < 1 || draw.value > 6 || Math.floor(draw.value) !== draw.value) boundary = false;
  }
  t.ok('randomInt stays inside 1..6 for 500 draws', boundary);

  var uniq = engine.uniqueSample(1, 10, 10, lib.mulberry32(99));
  t.ok('uniqueSample returns 10 values', uniq.ok && uniq.values.length === 10);
  var sortedUnique = uniq.values.slice().sort(function (a, b) { return a - b; });
  t.eq('uniqueSample covers the whole range once', sortedUnique, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  t.eq('uniqueSample rejects count > range', engine.uniqueSample(1, 5, 6, lib.mulberry32(1)), { ok: false, error: 'range' });
  t.eq('uniqueSample rejects count 0', engine.uniqueSample(1, 5, 0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });

  var floats = true;
  var fr = lib.mulberry32(2024);
  for (var j = 0; j < 300; j++) {
    var f = engine.randomFloat(1, 2, 2, fr);
    if (!f.ok || f.value < 1 || f.value > 2) floats = false;
    if (Math.abs(f.value * 100 - Math.round(f.value * 100)) > 1e-7) floats = false;
  }
  t.ok('randomFloat respects bounds and 2 decimals', floats);
  t.eq('randomFloat rejects 7 decimals', engine.randomFloat(1, 2, 7, fr), { ok: false, error: 'bad_decimals' });
  t.eq('randomFloat rejects min > max', engine.randomFloat(3, 2, 2, fr), { ok: false, error: 'range' });
  t.eq('roundTo(1.005, 2) is half away from zero', engine.roundTo(1.005, 2), 1.01);
  t.eq('roundTo(-2.5, 0) is negative half away', engine.roundTo(-2.5, 0), -3);

  var gen = engine.generate({ min: 1, max: 20, count: 8, decimals: 0, unique: true, sorted: true, rng: lib.mulberry32(5) });
  t.ok('generate returns 8 sorted unique values', gen.ok && gen.values.length === 8 &&
    gen.values.every(function (v, k, arr) { return k === 0 || arr[k - 1] <= v; }) &&
    new Set(gen.values).size === 8);

  t.eq('generate rejects count 0', engine.generate({ min: 1, max: 9, count: 0, decimals: 0, rng: lib.mulberry32(1) }), { ok: false, error: 'bad_count' });
  t.eq('generate rejects negative count', engine.generate({ min: 1, max: 9, count: -2, decimals: 0, rng: lib.mulberry32(1) }), { ok: false, error: 'bad_count' });
  t.eq('generate rejects count over 1000', engine.generate({ min: 1, max: 5000, count: 1001, decimals: 0, rng: lib.mulberry32(1) }), { ok: false, error: 'bad_count' });
  t.eq('generate rejects min > max', engine.generate({ min: 9, max: 1, count: 2, decimals: 0, rng: lib.mulberry32(1) }), { ok: false, error: 'range' });

  var withRepeat = engine.generate({ min: 1, max: 2, count: 50, decimals: 0, unique: false, rng: lib.mulberry32(3) });
  t.ok('non-unique count may exceed range', withRepeat.ok && withRepeat.values.length === 50);

  var a = engine.generate({ min: 1, max: 100, count: 10, decimals: 0, rng: lib.mulberry32(42) });
  var b = engine.generate({ min: 1, max: 100, count: 10, decimals: 0, rng: lib.mulberry32(42) });
  t.eq('same rng seed gives identical batch', a.values, b.values);

  var counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  var br = lib.mulberry32(777);
  for (var k = 0; k < 6000; k++) counts[engine.randomInt(1, 6, br).value]++;
  var fair = Object.keys(counts).every(function (n) { return counts[n] > 900 && counts[n] < 1100; });
  t.ok('large sample is roughly uniform', fair, JSON.stringify(counts));

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
