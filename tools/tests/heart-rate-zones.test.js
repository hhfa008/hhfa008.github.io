#!/usr/bin/env node
'use strict';

/*
 * heart-rate-zones tests.
 * Run: node /Users/fa/games/tools/tests/heart-rate-zones.test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'heart-rate-zones';
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
} catch (e) {
  /* asserted in the engine group below */
}
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) {
  /* asserted in the i18n group below */
}

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

  t.eq('BANDS has five bands', engine.BANDS.length, 5);
  t.eq('first band', engine.BANDS[0], { low: 50, high: 60 });
  t.eq('last band', engine.BANDS[4], { low: 90, high: 100 });

  t.eq('maxHr(30)', engine.maxHr(30), { ok: true, value: 190 });
  t.eq('maxHr(20)', engine.maxHr(20), { ok: true, value: 200 });
  t.eq('maxHr(5) boundary', engine.maxHr(5), { ok: true, value: 215 });
  t.eq('maxHr(120) boundary', engine.maxHr(120), { ok: true, value: 100 });
  t.eq('maxHr(4) rejected', engine.maxHr(4), { ok: false, error: 'range' });
  t.eq('maxHr(121) rejected', engine.maxHr(121), { ok: false, error: 'range' });
  t.eq('maxHr(NaN) rejected', engine.maxHr(NaN), { ok: false, error: 'bad_value' });
  t.eq('maxHr("30") rejected', engine.maxHr('30'), { ok: false, error: 'bad_value' });

  var z = engine.zones(190);
  t.eq('zones(190) ok', z.ok, true);
  t.eq('zones(190) method', z.method, 'percent');
  t.eq('zones(190) count', z.zones.length, 5);
  t.eq('zones(190) first low', z.zones[0].min, 95);
  t.eq('zones(190) first high', z.zones[0].max, 114);
  t.eq('zones(190) last low', z.zones[4].min, 171);
  t.eq('zones(190) last high', z.zones[4].max, 190);
  t.eq('zones(190) percents', [z.zones[0].lowPercent, z.zones[0].highPercent, z.zones[4].lowPercent, z.zones[4].highPercent], [50, 60, 90, 100]);
  t.eq('zones(190) boundaries contiguous',
    z.zones.every(function (zone, i) { return i === 0 || zone.min === z.zones[i - 1].max; }), true);
  t.eq('zones(100) boundary', engine.zones(100).zones[0], { index: 1, lowPercent: 50, highPercent: 60, min: 50, max: 60, method: 'percent' });
  t.eq('zones(250) last max', engine.zones(250).zones[4].max, 250);
  t.eq('zones(99) rejected', engine.zones(99), { ok: false, error: 'range' });
  t.eq('zones(251) rejected', engine.zones(251), { ok: false, error: 'range' });
  t.eq('zones(NaN) rejected', engine.zones(NaN), { ok: false, error: 'bad_value' });

  var k = engine.karvonen(190, 60);
  t.eq('karvonen ok', k.ok, true);
  t.eq('karvonen method', k.method, 'karvonen');
  t.eq('karvonen reserve', k.reserve, 130);
  t.eq('karvonen first low', k.zones[0].min, 125);
  t.eq('karvonen first high', k.zones[0].max, 138);
  t.eq('karvonen last high', k.zones[4].max, 190);
  t.eq('karvonen boundaries contiguous',
    k.zones.every(function (zone, i) { return i === 0 || zone.min === k.zones[i - 1].max; }), true);
  t.eq('karvonen rest must be below max', engine.karvonen(190, 190), { ok: false, error: 'range' });
  t.eq('karvonen rest too low', engine.karvonen(190, 19), { ok: false, error: 'range' });
  t.eq('karvonen bad rest', engine.karvonen(190, NaN), { ok: false, error: 'bad_value' });
  t.eq('karvonen bad max', engine.karvonen(99, 60), { ok: false, error: 'range' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
