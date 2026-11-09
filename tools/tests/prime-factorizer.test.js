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
var SLUG = 'prime-factorizer';
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

    var p360 = engine.parseInteger('360');
  t.ok('parseInteger accepts 360', p360.ok === true);
  t.eq('parseInteger value', p360.value.toString(), '360');
  t.eq('parseInteger detects negative', engine.parseInteger('-12').negative, true);
  t.eq('parseInteger rejects empty input', engine.parseInteger('  '), { ok: false, error: 'empty_input' });
  t.eq('parseInteger rejects decimals', engine.parseInteger('3.5'), { ok: false, error: 'bad_value' });
  t.eq('parseInteger rejects 41 digits',
    engine.parseInteger('1'.repeat(41)), { ok: false, error: 'range' });

  var f12 = engine.factorize(12);
  t.ok('factorize(12) succeeds', f12.ok === true);
  t.eq('12 = 2^2 * 3', f12.factors.map(function (f) { return f.p.toString() + '^' + f.e; }).join(','),
    '2^2,3^1');
  t.eq('formatFactors(12)', engine.formatFactors(f12.factors), '2² × 3');
  var f360 = engine.factorize(360);
  t.eq('360 = 2^3 * 3^2 * 5', engine.formatFactors(f360.factors), '2³ × 3² × 5');
  t.eq('factorize(97) is a single prime', engine.formatFactors(engine.factorize(97).factors), '97');
  t.ok('factorize(97) is complete', engine.factorize(97).complete === true);

  t.eq('0 has no prime factorization', engine.factorize(0).zero, true);
  t.eq('factorize(0) keeps an empty factor list', engine.factorize(0).factors.length, 0);
  t.eq('1 is a special unit', engine.factorize(1).one, true);
  t.eq('factorize(-12) marks the sign', engine.factorize(-12).negative, true);
  t.eq('factorize(-12) uses absolute value', engine.formatFactors(engine.factorize(-12).factors), '2² × 3');

  t.eq('isPrime(97)', engine.isPrime(97), { ok: true, prime: true });
  t.eq('isPrime(1000003)', engine.isPrime(1000003), { ok: true, prime: true });
  t.eq('isPrime(1) is false', engine.isPrime(1), { ok: true, prime: false });
  t.eq('isPrime(0) is false', engine.isPrime(0), { ok: true, prime: false });
  t.eq('isPrime(12) is false', engine.isPrime(12), { ok: true, prime: false });
  t.eq('classify(97)', engine.classify(97).kind, 'prime');
  t.eq('classify(12)', engine.classify(12).kind, 'composite');
  t.eq('classify(0)', engine.classify(0).kind, 'zero');
  t.eq('classify(1)', engine.classify(1).kind, 'one');

  t.eq('divisorCount(12)', engine.divisorCount(f12.factors).value, 6);
  t.eq('divisorSum(12)', engine.divisorSum(f12.factors).value.toString(), '28');
  t.eq('divisorCount(360)', engine.divisorCount(f360.factors).value, 24);
  t.eq('divisorSum(360)', engine.divisorSum(f360.factors).value.toString(), '1170');
  t.eq('divisorCount(1) is 1', engine.divisorCount(engine.factorize(1).factors).value, 1);
  t.eq('divisorSum(1) is 1', engine.divisorSum(engine.factorize(1).factors).value.toString(), '1');
  t.eq('divisorCount rejects malformed factors', engine.divisorCount(null), { ok: false, error: 'bad_value' });

  var square = engine.factorize(1000003n * 1000003n);
  t.ok('perfect square of two primes is complete', square.complete === true);
  t.eq('1000003^2 factors into two copies',
    engine.formatFactors(square.factors), '1000003²');

  var capped = engine.factorize(1000003n * 1000003n, 100);
  t.ok('small trial cap leaves work unfinished', capped.complete === false);
  t.eq('unfinished factorization reports the remainder',
    capped.remainder.toString(), '1000006000009');
  t.eq('isPrime reports the trial limit', engine.isPrime(1000003n * 1000003n, 100),
    { ok: false, error: 'trial_limit' });
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
