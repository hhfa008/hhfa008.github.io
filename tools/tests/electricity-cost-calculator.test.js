#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'electricity-cost-calculator';
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

  t.eq('1000W × 2h × 30 days', engine.kwh(1000, 2, 30), { ok: true, value: 60 });
  t.eq('1500W × 1.5h × 30 days', engine.kwh(1500, 1.5, 30), { ok: true, value: 67.5 });
  t.eq('quantity multiplies energy', engine.kwh(1000, 2, 30, 2), { ok: true, value: 120 });
  t.eq('zero watts', engine.kwh(0, 2, 30), { ok: true, value: 0 });
  t.eq('zero days', engine.kwh(1000, 2, 0), { ok: true, value: 0 });
  t.eq('full 24 hours allowed', engine.kwh(100, 24, 30), { ok: true, value: 72 });

  t.eq('cost at 15 per kWh', engine.cost(60, 1500), { ok: true, value: 90000 });
  t.eq('zero tariff', engine.cost(60, 0), { ok: true, value: 0 });
  t.eq('cost rounds to the cent', engine.cost(1.005, 1234), { ok: true, value: 1240 });
  t.eq('negative energy rejected', engine.cost(-1, 1500), { ok: false, error: 'bad_kwh' });
  t.eq('negative tariff rejected', engine.cost(1, -1), { ok: false, error: 'bad_price' });
  t.eq('string energy rejected', engine.cost('1', 100), { ok: false, error: 'bad_kwh' });

  var list = engine.sumAppliances([
    { watts: 1000, hours: 2 },
    { watts: 100, hours: 24 }
  ], 30, 1500);
  t.eq('multi-appliance total kWh', list.totalKwh, 132);
  t.eq('multi-appliance total cents', list.totalCents, 198000);
  t.eq('multi-appliance item costs', list.items.map(function (i) { return i.cents; }), [90000, 108000]);
  t.eq('item costs sum to total', list.items.reduce(function (a, b) { return a + b.cents; }, 0), list.totalCents);
  t.eq('zero-day list is free', engine.sumAppliances([{ watts: 1000, hours: 2 }], 0, 1500).totalCents, 0);

  t.eq('power above cap rejected', engine.kwh(100001, 2, 30), { ok: false, error: 'bad_power' });
  t.eq('power at cap allowed', engine.kwh(100000, 1, 1), { ok: true, value: 100 });
  t.eq('negative power rejected', engine.kwh(-1, 2, 30), { ok: false, error: 'bad_power' });
  t.eq('string power rejected', engine.kwh('1000', 2, 30), { ok: false, error: 'bad_power' });
  t.eq('hours above 24 rejected', engine.kwh(1000, 25, 30), { ok: false, error: 'bad_hours' });
  t.eq('negative hours rejected', engine.kwh(1000, -1, 30), { ok: false, error: 'bad_hours' });
  t.eq('days above 366 rejected', engine.kwh(1000, 2, 367), { ok: false, error: 'bad_days' });
  t.eq('quantity zero rejected', engine.kwh(1000, 2, 30, 0), { ok: false, error: 'bad_quantity' });
  t.eq('fractional quantity rejected', engine.kwh(1000, 2, 30, 1.5), { ok: false, error: 'bad_quantity' });

  t.eq('empty appliance list rejected', engine.sumAppliances([], 30, 1500), { ok: false, error: 'bad_appliances' });
  t.eq('non-array rejected', engine.sumAppliances(null, 30, 1500), { ok: false, error: 'bad_appliances' });
  t.eq('bad appliance power propagates', engine.sumAppliances([{ watts: -1, hours: 1 }], 30, 1500),
    { ok: false, error: 'bad_power' });
  t.eq('bad tariff rejected in list', engine.sumAppliances([{ watts: 1, hours: 1 }], 30, -1),
    { ok: false, error: 'bad_price' });

  var many = [];
  for (var i = 0; i < 100; i++) many.push({ watts: 100000, hours: 24 });
  t.eq('huge appliance list overflows', engine.sumAppliances(many, 366, 100000000),
    { ok: false, error: 'overflow' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
