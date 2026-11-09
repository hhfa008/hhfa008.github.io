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
var SLUG = 'fraction-calculator';
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

    t.ok('parseFraction 1/2 ok', engine.parseFraction('1/2').ok === true);
  t.eq('parseFraction 1/2 numerator', engine.parseFraction('1/2').num.toString(), '1');
  t.eq('parseFraction 1/2 denominator', engine.parseFraction('1/2').den.toString(), '2');
  t.eq('parseFraction whole number denominator', engine.parseFraction('3').den.toString(), '1');
  t.eq('parseFraction mixed number', engine.parseFraction('1 2/3').num.toString(), '5');
  t.eq('parseFraction negative mixed number', engine.parseFraction('-1 2/3').num.toString(), '-5');
  t.eq('parseFraction negative denominator moves sign', engine.parseFraction('1/-2').num.toString(), '-1');
  t.eq('parseFraction zero denominator', engine.parseFraction('1/0'), { ok: false, error: 'zero_denominator' });
  t.eq('parseFraction empty input', engine.parseFraction('   '), { ok: false, error: 'empty_input' });
  t.eq('parseFraction rejects text', engine.parseFraction('abc'), { ok: false, error: 'bad_value' });
  t.eq('parseFraction rejects improper fraction part', engine.parseFraction('1 5/3'), { ok: false, error: 'bad_mixed' });
  t.eq('parseFraction rejects 41-digit integer', engine.parseFraction('1'.repeat(41)), { ok: false, error: 'bad_value' });

  t.eq('gcd(12,18)', engine.gcd(12, 18).value.toString(), '6');
  t.eq('gcd(0,0) is zero', engine.gcd(0, 0).value.toString(), '0');
  t.eq('gcd(-12,18) uses absolute values', engine.gcd(-12, 18).value.toString(), '6');
  t.eq('gcd rejects non-integer', engine.gcd(1.5, 2), { ok: false, error: 'bad_value' });
  var simp = engine.simplify(6, 8);
  t.eq('simplify(6,8) reduces to 3/4',
    simp.num.toString() + '/' + simp.den.toString(), '3/4');
  t.eq('simplify records gcd 2', simp.gcd.toString(), '2');
  t.eq('simplify zero numerator becomes 0/1',
    engine.simplify(0, 9).num.toString() + '/' + engine.simplify(0, 9).den.toString(), '0/1');
  t.eq('simplify zero denominator', engine.simplify(1, 0), { ok: false, error: 'zero_denominator' });

  var add = engine.add('1/2', '1/3');
  t.ok('add 1/2 + 1/3 succeeds', add.ok === true);
  t.eq('1/2 + 1/3 = 5/6', add.num.toString() + '/' + add.den.toString(), '5/6');
  t.eq('1/2 + 1/3 gcd is 1', add.gcd.toString(), '1');
  var sub = engine.sub('1/3', '1/2');
  t.eq('1/3 - 1/2 = -1/6', sub.num.toString() + '/' + sub.den.toString(), '-1/6');
  t.eq('subtraction normalizes sign', sub.den.toString(), '6');
  var mul = engine.mul('-2/3', '3/4');
  t.eq('-2/3 * 3/4 = -1/2', mul.num.toString() + '/' + mul.den.toString(), '-1/2');
  var div = engine.div('1/2', '3/4');
  t.eq('1/2 / 3/4 = 2/3', div.num.toString() + '/' + div.den.toString(), '2/3');
  t.eq('division by zero', engine.div('1/2', '0/5'), { ok: false, error: 'divide_by_zero' });
  var mixedIn = engine.add('1 1/2', '1/2');
  t.eq('1 1/2 + 1/2 = 2', engine.formatFraction(mixedIn.num, mixedIn.den), '2');

  var mixed = engine.toMixed(-7, 4);
  t.eq('toMixed(-7/4) whole', mixed.whole.toString(), '-1');
  t.eq('toMixed(-7/4) remainder', mixed.num.toString(), '3');
  t.eq('toMixed(-7/4) denominator', mixed.den.toString(), '4');

  t.eq('decimal 1/3 to 10 places', engine.toDecimal(1, 3, 10), '0.3333333333');
  t.eq('decimal 5/6 rounds half-up', engine.toDecimal(5, 6, 10), '0.8333333333');
  t.eq('decimal 2/3 rounds last digit', engine.toDecimal(2, 3, 10), '0.6666666667');
  t.eq('decimal exact 1/8', engine.toDecimal(1, 8, 10), '0.125');
  t.eq('decimal negative 1/8', engine.toDecimal(-1, 8, 10), '-0.125');
  t.eq('decimal integer', engine.toDecimal(6, 3, 10), '2');

  var big = engine.simplify(BigInt('12345678901234567890'), 3n);
  t.eq('BigInt numerator keeps precision', big.num.toString(), '4115226300411522630');
  t.eq('BigInt simplification denominator', big.den.toString(), '1');
  t.eq('BigInt formatting keeps every digit',
    engine.formatFraction(BigInt('12345678901234567890'), 1n), '12345678901234567890');
  var smallSum = engine.add('1/3', '1/6');
  t.eq('1/3 + 1/6 simplifies to 1/2', engine.formatFraction(smallSum.num, smallSum.den), '1/2');
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
