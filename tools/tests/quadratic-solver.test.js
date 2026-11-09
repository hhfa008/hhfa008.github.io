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
var SLUG = 'quadratic-solver';
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

    var r1 = engine.solveQuadratic(1, -3, 2);
  t.ok('x²-3x+2 solves', r1.ok === true);
  t.eq('x²-3x+2 has two real roots', r1.mode, 'two_real');
  t.eq('x²-3x+2 root count', r1.roots.length, 2);
  t.eq('x²-3x+2 first root', r1.roots[0].re, 1);
  t.eq('x²-3x+2 second root', r1.roots[1].re, 2);
  t.eq('x²-3x+2 discriminant', r1.discriminant, 1);
  t.eq('x²-3x+2 vertex x', r1.vertex.x, 1.5);
  t.eq('x²-3x+2 vertex y', r1.vertex.y, -0.25);
  t.eq('Vieta sum of roots', r1.sumRoots, 3);
  t.eq('Vieta product of roots', r1.productRoots, 2);
  t.eq('factored form stores both roots', [r1.factor.r1, r1.factor.r2], [1, 2]);
  t.eq('exact radical form for x²-3x+2', r1.radical,
    { n: 3, k: 1, m: 1, den: 2, complex: false });

  var r2 = engine.solveQuadratic(1, 2, 1);
  t.eq('x²+2x+1 is a repeated root', r2.mode, 'repeated');
  t.eq('x²+2x+1 root count', r2.roots.length, 1);
  t.eq('x²+2x+1 root value', r2.roots[0].re, -1);
  t.eq('x²+2x+1 discriminant', r2.discriminant, 0);
  t.eq('x²+2x+1 vertex y', r2.vertex.y, 0);
  t.eq('x²+2x+1 factor is repeated', r2.factor.repeated, true);
  t.eq('no radical form for a perfect square', r2.radical, null);

  var r3 = engine.solveQuadratic(1, 0, 1);
  t.eq('x²+1 has complex roots', r3.mode, 'complex');
  t.eq('x²+1 real part is zero', r3.roots[0].re, 0);
  t.eq('x²+1 imaginary part is 1', Math.abs(r3.roots[0].im), 1);
  t.eq('x²+1 discriminant', r3.discriminant, -4);
  t.eq('x²+1 vertex', [r3.vertex.x, r3.vertex.y], [0, 1]);
  t.eq('x²+1 has no real factor form', r3.factor, null);
  t.eq('x²+1 exact form reduces to ±i', r3.radical,
    { n: 0, k: 1, m: 1, den: 1, complex: true });

  var r4 = engine.solveQuadratic(1, 0, -2);
  t.near('x²-2 negative root', r4.roots[0].re, -Math.sqrt(2), 1e-12);
  t.near('x²-2 positive root', r4.roots[1].re, Math.sqrt(2), 1e-12);
  t.eq('x²-2 exact form is ±√2', r4.radical,
    { n: 0, k: 1, m: 2, den: 1, complex: false });

  var rLinear = engine.solveQuadratic(0, 2, -4);
  t.eq('a=0 falls back to linear', rLinear.mode, 'linear');
  t.eq('linear root', rLinear.roots[0].re, 2);
  t.eq('linear mode has no discriminant', rLinear.discriminant, null);
  t.eq('linear mode has no vertex', rLinear.vertex, null);
  t.eq('linear sum of roots is the single root', rLinear.sumRoots, 2);
  t.eq('linear mode has no product', rLinear.productRoots, null);

  var rNone = engine.solveQuadratic(0, 0, 5);
  t.eq('degenerate constant case has no solution', rNone.mode, 'none');
  t.eq('no-solution case returns no roots', rNone.roots.length, 0);
  var rIdentity = engine.solveQuadratic(0, 0, 0);
  t.eq('0=0 is an identity', rIdentity.mode, 'identity');

  t.eq('discriminant(1,-3,2)', engine.discriminant(1, -3, 2).value, 1);
  t.eq('discriminant rejects strings', engine.discriminant('1', 2, 3),
    { ok: false, error: 'bad_value' });
  t.eq('discriminant rejects out-of-range coefficients',
    engine.discriminant(1e13, 0, 0), { ok: false, error: 'range' });
  t.eq('solveQuadratic rejects NaN', engine.solveQuadratic(NaN, 1, 1),
    { ok: false, error: 'bad_value' });
  t.eq('solveQuadratic rejects out-of-range coefficients',
    engine.solveQuadratic(0, 1e13, 1), { ok: false, error: 'range' });

  t.eq('simplifySqrt(72) = 6√2', engine.simplifySqrt(72), { ok: true, k: 6, m: 2 });
  t.eq('simplifySqrt(4) = 2', engine.simplifySqrt(4), { ok: true, k: 2, m: 1 });
  t.eq('simplifySqrt(0) = 0', engine.simplifySqrt(0), { ok: true, k: 0, m: 1 });
  t.eq('simplifySqrt rejects negatives', engine.simplifySqrt(-1), { ok: false, error: 'bad_value' });
  t.eq('simplifySqrt rejects decimals', engine.simplifySqrt(2.5),
    { ok: false, error: 'bad_value' });

  var near = engine.solveQuadratic(1, 0, 1e-13);
  t.eq('near-zero discriminant is treated as a repeated root', near.mode, 'repeated');
  var precision = engine.solveQuadratic(1, -1e6, 1);
  t.near('large-coefficient root keeps precision', precision.roots[0].re, 1e-6, 1e-9);
  t.near('large-coefficient root product stays close to 1',
    precision.roots[0].re * precision.roots[1].re, 1, 1e-9);
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
