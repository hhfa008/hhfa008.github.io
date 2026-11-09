#!/usr/bin/env node
'use strict';

/*
 * TEST_TEMPLATE.js — copy to /Users/fa/games/tools/tests/<slug>.test.js
 *
 *   1. Set SLUG below.
 *   2. Replace /* ENGINE_ASSERTIONS *\/ with at least 10 real assertions.
 *   3. Optionally add UI/contract assertions in the marked group.
 *   4. Run: node /Users/fa/games/tools/tests/<slug>.test.js
 *
 * Output ends with: RESULT: N passed, M failed
 * Process exit code is 1 when anything failed.
 *
 * Rules enforced here:
 *   - zh / en / id dictionaries expose exactly the same non-empty keys
 *   - every data-i / data-i-ph / data-i-aria key exists in all three dictionaries
 *   - no external requests or remote assets
 *   - exactly three JSON-LD blocks (SoftwareApplication, FAQPage, BreadcrumbList)
 *   - canonical, viewport, title, meta description present
 *   - engine has no DOM / clock / storage / Math.random dependency
 *   - file is <= 90 KB
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

// ---------------------------------------------------------------------------
// EDIT ME
// ---------------------------------------------------------------------------
var SLUG = 'statistics-calculator';
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// static contract
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// engine correctness — fill this with at least 10 real assertions
// ---------------------------------------------------------------------------

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

    var parsed = engine.parseNumbers('2, 4 4\n4;5，5、7 9');
  t.ok('parseNumbers accepts mixed separators', parsed.ok === true);
  t.eq('parseNumbers keeps all values', parsed.values.join(','), '2,4,4,4,5,5,7,9');
  t.eq('parseNumbers accepts exponent and negative',
    engine.parseNumbers('1e3 -2.5').values.join(','), '1000,-2.5');
  t.eq('parseNumbers rejects empty input', engine.parseNumbers('   '), { ok: false, error: 'empty_input' });
  t.eq('parseNumbers rejects text tokens', engine.parseNumbers('1, abc'),
    { ok: false, error: 'bad_value' });
  t.eq('parseNumbers rejects NaN', engine.parseNumbers('NaN'), { ok: false, error: 'bad_value' });
  t.eq('parseNumbers rejects Infinity', engine.parseNumbers('1 Infinity'),
    { ok: false, error: 'bad_value' });
  t.eq('parseNumbers rejects malformed decimals', engine.parseNumbers('1.2.3'),
    { ok: false, error: 'bad_value' });
  t.eq('parseNumbers rejects more than 10000 values',
    engine.parseNumbers(new Array(10001).fill('1').join(' ')),
    { ok: false, error: 'too_many' });

  var data = [2, 4, 4, 4, 5, 5, 7, 9];
  t.eq('sum of the sample data', engine.sum(data).value, 40);
  t.eq('mean of the sample data', engine.mean(data).value, 5);
  t.eq('median with an even count', engine.median(data).value, 4.5);
  t.eq('median with an odd count', engine.median([1, 3, 9]).value, 3);
  t.eq('median of four values', engine.median([1, 2, 3, 4]).value, 2.5);
  t.eq('single mode', engine.mode(data).value.modes, [4]);
  t.eq('mode frequency', engine.mode(data).value.maxCount, 3);
  t.eq('multiple modes', engine.mode([1, 2, 2, 3, 3]).value.modes, [2, 3]);
  t.eq('no mode when every value is unique', engine.mode([1, 2, 3]).value.hasMode, false);
  t.eq('range of the sample data', engine.range(data).value, 7);
  t.eq('range reports min and max', [engine.range(data).min, engine.range(data).max], [2, 9]);

  t.eq('population variance', engine.variance(data, false).value, 4);
  t.near('sample variance', engine.variance(data, true).value, 32 / 7, 1e-12);
  t.eq('population standard deviation', engine.stdev(data, false).value, 2);
  t.near('sample standard deviation', engine.stdev(data, true).value, Math.sqrt(32 / 7), 1e-12);
  t.eq('sample variance needs two values', engine.variance([5], true),
    { ok: false, error: 'need_two' });
  t.eq('population variance of a single value is zero', engine.variance([5], false).value, 0);

  var q = engine.quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9]).value;
  t.eq('Q1 of 1..9', q.q1, 3);
  t.eq('Q2 of 1..9', q.q2, 5);
  t.eq('Q3 of 1..9', q.q3, 7);
  t.eq('IQR of 1..9', q.iqr, 4);
  var q2 = engine.quartiles(data).value;
  t.eq('Q1 of the sample data', q2.q1, 4);
  t.eq('Q3 of the sample data', q2.q3, 5.5);
  t.eq('IQR of the sample data', q2.iqr, 1.5);

  var summary = engine.summarize(data).value;
  t.eq('summary count', summary.count, 8);
  t.eq('summary mean', summary.mean, 5);
  t.eq('summary population variance', summary.variancePopulation, 4);
  t.near('summary sample variance', summary.varianceSample, 32 / 7, 1e-12);
  t.eq('summary sorted data', summary.sorted, [2, 4, 4, 4, 5, 5, 7, 9]);
  var single = engine.summarize([5]).value;
  t.eq('single-value population variance', single.variancePopulation, 0);
  t.eq('single-value sample variance is null', single.varianceSample, null);
  t.eq('single-value quartiles collapse', [single.q1, single.q3, single.iqr], [5, 5, 0]);

  t.eq('mean rejects an empty array', engine.mean([]), { ok: false, error: 'bad_value' });
  t.eq('sum rejects non-numeric entries', engine.sum([1, '2']), { ok: false, error: 'bad_value' });
  // Replace the block above with at least 10 assertions, for example:
  //
  // t.eq('double(0)', engine.double(0), { ok: true, value: 0 });
  // t.eq('double(21)', engine.double(21), { ok: true, value: 42 });
  // t.eq('double(-2.5)', engine.double(-2.5), { ok: true, value: -5 });
  // t.eq('double rejects NaN', engine.double(NaN), { ok: false, error: 'bad_value' });
  // t.eq('double rejects Infinity', engine.double(Infinity), { ok: false, error: 'bad_value' });
  // t.eq('double rejects strings', engine.double('2'), { ok: false, error: 'bad_value' });
  // t.eq('round(1.005, 2)', engine.round(1.005, 2), { ok: true, value: 1.01 });
  // t.eq('round(-2.5, 0)', engine.round(-2.5, 0), { ok: true, value: -3 });
  // t.eq('round validates decimals', engine.round(1, 7), { ok: false, error: 'bad_decimals' });
  // t.eq('isNum(0)', engine.isNum(0), true);
  // t.eq('isNum("0")', engine.isNum('0'), false);
  //
  // Cover: normal values, 0, negatives where allowed, invalid input, boundaries,
  // rounding, and for money the invariant that components sum to the total.

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10,
    'found ' + total + '; replace /* ENGINE_ASSERTIONS */ in TEST_TEMPLATE.js');
  return total + ' assertions';
});

// ---------------------------------------------------------------------------
// Optional: add UI / contract assertions here.
// ---------------------------------------------------------------------------

t.done();
