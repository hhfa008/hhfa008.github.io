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
var SLUG = 'debt-payoff-calculator';
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

  var one = engine.simulateDebts([{ name: 'Card', balanceCents: 100000, annualRatePct: 12, minPaymentCents: 5000 }], 0, 'avalanche');
  t.ok('single debt simulation ok', one.ok === true);
  t.eq('single debt months', one.months, 23);
  t.eq('single debt interest', one.totalInterestCents, 12136);
  t.eq('single debt paid = principal + interest', one.totalPaidCents - one.totalInterestCents, 100000);
  var two = [{ name: 'A', balanceCents: 100000, annualRatePct: 24, minPaymentCents: 3000 }, { name: 'B', balanceCents: 50000, annualRatePct: 6, minPaymentCents: 1000 }];
  var av = engine.simulateDebts(two, 5000, 'avalanche');
  var sn = engine.simulateDebts(two, 5000, 'snowball');
  t.eq('avalanche months', av.months, 19);
  t.eq('snowball months', sn.months, 20);
  t.eq('avalanche interest', av.totalInterestCents, 20014);
  t.eq('snowball interest', sn.totalInterestCents, 29211);
  t.eq('avalanche conservation', av.totalPaidCents - av.totalInterestCents, 150000);
  t.eq('snowball conservation', sn.totalPaidCents - sn.totalInterestCents, 150000);
  t.eq('avalanche clears high-rate debt first', av.perDebt[0].months, 15);
  t.eq('snowball clears small debt first', sn.perDebt[1].months, 9);
  t.eq('avalanche total monthly budget', av.monthlyBudgetCents, 9000);
  var cmp = engine.compare(two, 5000);
  t.ok('compare ok', cmp.ok === true);
  t.eq('interest winner', cmp.interestWinner, 'avalanche');
  t.eq('interest saved', cmp.interestSavedCents, 9197);
  t.eq('months winner', cmp.monthsWinner, 'avalanche');
  t.eq('months saved', cmp.monthsSaved, 1);
  var extra = engine.simulateDebts([{ name: 'Card', balanceCents: 100000, annualRatePct: 12, minPaymentCents: 5000 }], 1000, 'avalanche');
  t.eq('extra budget shortens payoff', extra.months, 19);
  t.eq('extra budget lowers interest', extra.totalInterestCents, 9948);
  var stall = engine.simulateDebts([{ name: 'Card', balanceCents: 100000, annualRatePct: 36, minPaymentCents: 1000 }], 0, 'avalanche');
  t.ok('stall flagged', stall.stalled === true);
  t.eq('stall has no months', stall.months, null);
  t.eq('stall error code', stall.error, 'min_not_enough');
  var zero = engine.simulateDebts([{ name: 'Paid', balanceCents: 0, annualRatePct: 10, minPaymentCents: 10 }], 0, 'snowball');
  t.eq('zero balance pays off immediately', zero.months, 0);
  t.eq('zero balance interest', zero.totalInterestCents, 0);
  t.eq('bad strategy rejected', engine.simulateDebts(two, 0, 'fastest'), { ok: false, error: 'bad_strategy' });
  t.eq('negative extra rejected', engine.simulateDebts(two, -1, 'avalanche'), { ok: false, error: 'bad_value' });
  t.eq('empty debts rejected', engine.simulateDebts([], 0, 'avalanche'), { ok: false, error: 'bad_value' });
  t.eq('negative balance rejected', engine.simulateDebts([{ name: 'X', balanceCents: -1, annualRatePct: 10, minPaymentCents: 10 }], 0, 'avalanche'), { ok: false, error: 'bad_value' });
  t.eq('rate above 1000 rejected', engine.simulateDebts([{ name: 'X', balanceCents: 100, annualRatePct: 1001, minPaymentCents: 10 }], 0, 'avalanche'), { ok: false, error: 'bad_value' });
  t.eq('NaN extra rejected', engine.simulateDebts(two, NaN, 'avalanche'), { ok: false, error: 'bad_value' });

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
