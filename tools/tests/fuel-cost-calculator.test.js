#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'fuel-cost-calculator';
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
  var refs = lib.externalRefs(html);
  t.eq('externalRefs is empty', refs, []);

  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
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
  t.ok('engine does not use Math.random',
    !/\bMath\s*\.\s*random\s*\(/.test(engineCode));

  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var trip = engine.tripCost(500, 7, 'l100', 800, false);
  t.eq('500 km at 7 L/100km needs 35 L', trip.fuelLitres, 35);
  t.eq('500 km at 8/L costs 280', trip.costCents, 28000);
  t.eq('cost per km is 0.56', trip.costPerKmCents, 56);
  t.eq('one-way distance preserved', trip.distanceKm, 500);

  var both = engine.tripCost(500, 7, 'l100', 800, true);
  t.eq('round trip doubles distance', both.distanceKm, 1000);
  t.eq('round trip doubles fuel', both.fuelLitres, 70);
  t.eq('round trip doubles cost', both.costCents, 56000);
  t.eq('round trip keeps cost per km', both.costPerKmCents, 56);

  var mpg = engine.consumptionToL100(30, 'mpg');
  t.ok('30 MPG converts to about 7.8405 L/100km', mpg.ok && Math.abs(mpg.value - 7.8404861) < 1e-6,
    'got ' + (mpg && mpg.value));
  var kmpl = engine.consumptionToL100(12, 'kmpl');
  t.ok('12 km/L converts to 8.3333 L/100km', kmpl.ok && Math.abs(kmpl.value - 100 / 12) < 1e-9,
    'got ' + (kmpl && kmpl.value));

  var backMpg = engine.consumptionFromL100(mpg.value, 'mpg');
  t.ok('MPG conversion round-trips', backMpg.ok && Math.abs(backMpg.value - 30) < 1e-9,
    'got ' + (backMpg && backMpg.value));
  var backKmpl = engine.consumptionFromL100(kmpl.value, 'kmpl');
  t.ok('km/L conversion round-trips', backKmpl.ok && Math.abs(backKmpl.value - 12) < 1e-9,
    'got ' + (backKmpl && backKmpl.value));

  var odd = engine.tripCost(333.33, 7.1, 'l100', 799, false);
  t.eq('odd trip cost rounds to cents', odd.costCents, 18909);
  t.eq('odd trip cost per km rounds to cents', odd.costPerKmCents, 57);

  t.eq('zero distance rejected', engine.tripCost(0, 7, 'l100', 800, false), { ok: false, error: 'bad_distance' });
  t.eq('negative distance rejected', engine.tripCost(-5, 7, 'l100', 800, false), { ok: false, error: 'bad_distance' });
  t.eq('distance cap enforced', engine.tripCost(2000001, 7, 'l100', 800, false), { ok: false, error: 'bad_distance' });
  t.eq('zero consumption rejected', engine.consumptionToL100(0, 'l100'), { ok: false, error: 'bad_consumption' });
  t.eq('negative consumption rejected', engine.consumptionToL100(-1, 'l100'), { ok: false, error: 'bad_consumption' });
  t.eq('unknown unit rejected', engine.consumptionToL100(7, 'gallons'), { ok: false, error: 'bad_unit' });
  t.eq('string consumption rejected', engine.consumptionToL100('7', 'l100'), { ok: false, error: 'bad_consumption' });

  var free = engine.tripCost(100, 7, 'l100', 0, false);
  t.eq('zero price gives zero cost', { ok: free.ok, cost: free.costCents, perKm: free.costPerKmCents },
    { ok: true, cost: 0, perKm: 0 });
  t.eq('negative price rejected', engine.tripCost(100, 7, 'l100', -1, false), { ok: false, error: 'bad_price' });
  t.eq('NaN price rejected', engine.tripCost(100, 7, 'l100', NaN, false), { ok: false, error: 'bad_price' });
  t.eq('non-boolean round trip rejected', engine.tripCost(100, 7, 'l100', 800, 'yes'), { ok: false, error: 'bad_roundtrip' });
  t.eq('huge fuel volume overflows', engine.tripCost(2000000, 100000, 'l100', 800, false), { ok: false, error: 'overflow' });
  t.eq('costPerKm rejects zero distance', engine.costPerKm(100, 0), { ok: false, error: 'bad_distance' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
