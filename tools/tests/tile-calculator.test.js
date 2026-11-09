#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'tile-calculator';
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

var html;
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try {
  html = lib.page(DIR);
} catch (e) {
  console.error('无法读取 ' + path.join(DIR, 'index.html') + ': ' + e.message);
  process.exit(1);
}
try {
  engine = lib.evalScript(html, 'engine', 'ToolEngine');
} catch (e) { /* asserted below */ }
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) { /* asserted below */ }

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
  t.eq('externalRefs is empty', lib.externalRefs(html), []);
  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (item) { return item && item['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  var faqPage = jsonLd.filter(function (item) { return item && item['@type'] === 'FAQPage'; })[0];
  t.ok('FAQPage has 3+ questions', !!faqPage && Array.isArray(faqPage.mainEntity) && faqPage.mainEntity.length >= 3);
  t.ok('FAQPage entries have answers', !!faqPage && faqPage.mainEntity.every(function (item) {
    return item && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));
  t.ok('viewport present', /<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html));
  var title = html.match(/<title>\s*([^<]*?)\s*<\/title>/i);
  t.ok('title non-empty', !!(title && title[1].trim()));
  t.ok('meta description non-empty', /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i.test(html));
  t.ok('canonical correct', (function () {
    var match = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
    return !!match && match[1] === EXPECTED_CANONICAL;
  })());
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

  var r;

  r = engine.area(4, 3, 'm');
  t.eq('area(4,3,m) ok', r.ok, true);
  t.near('4 m × 3 m = 12 m²', r.value, 12, 1e-9);

  r = engine.area(400, 300, 'cm');
  t.near('400 cm × 300 cm = 12 m²', r.value, 12, 1e-9);

  r = engine.area(10, 10, 'ft');
  t.near('10 ft × 10 ft = 9.290304 m²', r.value, 9.290304, 1e-9);

  r = engine.area(4, 3, 'm');
  t.near('12 m² = 129.17 ft²', r.sqft, 12 / 0.09290304, 1e-9);

  t.eq('zero length rejected', engine.area(0, 3, 'm'), { ok: false, error: 'range' });
  t.eq('negative width rejected', engine.area(4, -3, 'm'), { ok: false, error: 'range' });
  t.eq('bad room unit rejected', engine.area(4, 3, 'yard'), { ok: false, error: 'bad_unit' });
  t.eq('NaN length rejected', engine.area(NaN, 3, 'm'), { ok: false, error: 'bad_value' });

  r = engine.areaFromValue(12, 'm2');
  t.near('area 12 m² stays 12', r.value, 12, 1e-9);
  r = engine.areaFromValue(100, 'ft2');
  t.near('100 ft² = 9.290304 m²', r.value, 9.290304, 1e-9);
  t.eq('area 0 rejected', engine.areaFromValue(0, 'm2'), { ok: false, error: 'range' });
  t.eq('bad area unit rejected', engine.areaFromValue(1, 'acre'), { ok: false, error: 'bad_unit' });

  r = engine.tilesNeeded(12, 60, 60, 10, 'cm');
  t.eq('tilesNeeded ok', r.ok, true);
  t.near('60×60 cm tile = 0.36 m²', r.tileArea, 0.36, 1e-12);
  t.eq('12 m² + 10% needs 37 tiles', r.value, 37);
  t.eq('base tiles without waste = 34', r.baseTiles, 34);
  t.eq('waste tiles = 3', r.wasteTiles, 3);

  r = engine.tilesNeeded(12, 60, 60, 0, 'cm');
  t.eq('no waste still rounds up to 34', r.value, 34);
  t.eq('no waste has zero waste tiles', r.wasteTiles, 0);

  r = engine.tilesNeeded(10.8, 60, 60, 0, 'cm');
  t.eq('exact 30 tiles does not add one', r.value, 30);

  r = engine.tilesNeeded(12, 24, 24, 0, 'in');
  t.near('24 in = 60.96 cm tile area', r.tileArea, 0.37161216, 1e-12);
  t.eq('inch tile needs 33 tiles', r.value, 33);

  t.eq('zero area rejected', engine.tilesNeeded(0, 60, 60, 10, 'cm'), { ok: false, error: 'range' });
  t.eq('zero tile length rejected', engine.tilesNeeded(12, 0, 60, 10, 'cm'), { ok: false, error: 'range' });
  t.eq('waste above 100 rejected', engine.tilesNeeded(12, 60, 60, 101, 'cm'), { ok: false, error: 'range' });
  t.eq('negative waste rejected', engine.tilesNeeded(12, 60, 60, -1, 'cm'), { ok: false, error: 'range' });
  t.eq('bad tile unit rejected', engine.tilesNeeded(12, 60, 60, 10, 'ft'), { ok: false, error: 'bad_unit' });
  t.eq('NaN tile size rejected', engine.tilesNeeded(12, NaN, 60, 10, 'cm'), { ok: false, error: 'bad_value' });

  r = engine.boxesNeeded(37, 10);
  t.eq('37 tiles need 4 boxes', r.value, 4);
  t.eq('purchased tiles = 40', r.purchasedTiles, 40);
  t.eq('leftover tiles = 3', r.leftover, 3);

  t.eq('exact 40 tiles = 4 boxes', engine.boxesNeeded(40, 10).value, 4);
  t.eq('zero tiles = zero boxes', engine.boxesNeeded(0, 10).value, 0);
  t.eq('float overshoot does not add a box', engine.boxesNeeded(10 + 1e-9, 5).value, 2);
  t.eq('zero per box rejected', engine.boxesNeeded(10, 0), { ok: false, error: 'bad_value' });
  t.eq('fractional per box rejected', engine.boxesNeeded(10, 2.5), { ok: false, error: 'bad_value' });
  t.eq('negative tiles rejected', engine.boxesNeeded(-1, 10), { ok: false, error: 'range' });
  t.eq('NaN tiles rejected', engine.boxesNeeded(NaN, 10), { ok: false, error: 'bad_value' });

  r = engine.sqmToSqft(1);
  t.near('1 m² = 10.7639 ft²', r.value, 10.763910416709722, 1e-9);
  t.eq('negative area to sqft rejected', engine.sqmToSqft(-1), { ok: false, error: 'range' });

  return 'area, tiles, boxes and unit conversion';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
