#!/usr/bin/env node
'use strict';

/*
 * macro-calculator tests.
 * Run: node /Users/fa/games/tools/tests/macro-calculator.test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'macro-calculator';
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

  t.eq('KCAL_PER_GRAM', engine.KCAL_PER_GRAM, { protein: 4, carbs: 4, fat: 9 });

  t.eq('presetRatios balanced', engine.presetRatios('balanced'),
    { ok: true, preset: 'balanced', ratios: { protein: 30, carbs: 40, fat: 30 } });
  t.eq('presetRatios highProtein', engine.presetRatios('highProtein'),
    { ok: true, preset: 'highProtein', ratios: { protein: 40, carbs: 35, fat: 25 } });
  t.eq('presetRatios lowCarb', engine.presetRatios('lowCarb'),
    { ok: true, preset: 'lowCarb', ratios: { protein: 35, carbs: 20, fat: 45 } });
  t.eq('presetRatios rejects unknown', engine.presetRatios('keto'), { ok: false, error: 'bad_mode' });
  t.eq('presetRatios rejects non-string', engine.presetRatios(3), { ok: false, error: 'bad_mode' });

  t.eq('validateRatios 30/40/30', engine.validateRatios({ protein: 30, carbs: 40, fat: 30 }),
    { ok: true, ratios: { protein: 30, carbs: 40, fat: 30 }, totalPercent: 100 });
  t.eq('validateRatios accepts decimal split', engine.validateRatios({ protein: 33.3, carbs: 33.3, fat: 33.4 }).ok, true);
  t.eq('validateRatios rejects 99', engine.validateRatios({ protein: 30, carbs: 40, fat: 29 }),
    { ok: false, error: 'bad_ratio' });
  t.eq('validateRatios rejects 101 total', engine.validateRatios({ protein: 30, carbs: 40, fat: 31 }),
    { ok: false, error: 'bad_ratio' });
  t.eq('validateRatios rejects negative', engine.validateRatios({ protein: -1, carbs: 51, fat: 50 }),
    { ok: false, error: 'bad_value' });
  t.eq('validateRatios rejects >100', engine.validateRatios({ protein: 101, carbs: 0, fat: -1 }),
    { ok: false, error: 'range' });
  t.eq('validateRatios rejects NaN', engine.validateRatios({ protein: NaN, carbs: 50, fat: 50 }),
    { ok: false, error: 'bad_value' });
  t.eq('validateRatios rejects missing object', engine.validateRatios(null), { ok: false, error: 'bad_value' });

  var split = engine.macroSplit(2000, { protein: 30, carbs: 40, fat: 30 });
  t.eq('macroSplit 2000 grams', split.grams, { protein: 150, carbs: 200, fat: 66.7 });
  t.eq('macroSplit 2000 kcal parts', split.kcal, { protein: 600, carbs: 800, fat: 600 });
  t.eq('macroSplit kcal conserves total', split.kcal.protein + split.kcal.carbs + split.kcal.fat, 2000);
  t.eq('macroSplit totalGrams', split.totalGrams, 416.7);
  t.eq('macroSplit keeps ratios', split.ratios, { protein: 30, carbs: 40, fat: 30 });

  var high = engine.macroSplit(1800, { protein: 40, carbs: 35, fat: 25 });
  t.eq('macroSplit high protein grams', high.grams, { protein: 180, carbs: 157.5, fat: 50 });
  t.eq('macroSplit high protein kcal', high.kcal, { protein: 720, carbs: 630, fat: 450 });

  var zero = engine.macroSplit(0, { protein: 30, carbs: 40, fat: 30 });
  t.eq('macroSplit zero calories', zero.grams, { protein: 0, carbs: 0, fat: 0 });
  t.eq('macroSplit zero kcal', zero.kcal, { protein: 0, carbs: 0, fat: 0 });

  t.eq('macroSplit rejects negative calories', engine.macroSplit(-10, { protein: 30, carbs: 40, fat: 30 }),
    { ok: false, error: 'range' });
  t.eq('macroSplit rejects NaN calories', engine.macroSplit(NaN, { protein: 30, carbs: 40, fat: 30 }),
    { ok: false, error: 'bad_value' });
  t.eq('macroSplit rejects overflow', engine.macroSplit(100001, { protein: 30, carbs: 40, fat: 30 }),
    { ok: false, error: 'overflow' });
  t.eq('macroSplit propagates bad ratio', engine.macroSplit(2000, { protein: 30, carbs: 40, fat: 31 }),
    { ok: false, error: 'bad_ratio' });
  t.eq('isNum(0)', engine.isNum(0), true);
  t.eq('isNum("0")', engine.isNum('0'), false);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
