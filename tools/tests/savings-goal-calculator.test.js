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
var SLUG = 'savings-goal-calculator';
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

  /* ENGINE_ASSERTIONS */
  var plan = engine.monthlyNeeded(100000, 10000, 5, 60);
  var reached = engine.monthsToGoal(100000, 10000, 5, 1000);
  var zeroPlan = engine.monthlyNeeded(1200, 0, 0, 12);
  var zeroTime = engine.monthsToGoal(1200, 0, 0, 100);
  var achieved = engine.monthlyNeeded(50000, 60000, 5, 12);
  var longerPlan = engine.monthlyNeeded(100000, 10000, 5, 120);
  var fasterTime = engine.monthsToGoal(100000, 10000, 5, 2000);

  t.ok('monthlyNeeded succeeds', plan.ok === true);
  t.eq('monthly needed for 100000/10000/5%/60m = 1281.75', plan.monthly, 1281.75);
  t.ok('plan is not flagged as achieved', plan.achieved === false);
  t.ok('projection reaches the target', plan.projected >= 100000,
    'projected ' + plan.projected);
  t.eq('longer term needs less per month', longerPlan.monthly, 537.93);
  t.ok('monthly requirement falls monotonically with time', longerPlan.monthly < plan.monthly);

  t.ok('monthsToGoal succeeds', reached.ok === true);
  t.eq('goal reached in 74 whole months', reached.months, 74);
  t.ok('whole months cover the target', reached.projected >= 100000,
    'projected ' + reached.projected);
  t.eq('higher deposit needs fewer months', fasterTime.months, 41);
  t.ok('months fall monotonically with deposit', fasterTime.months < reached.months);

  t.eq('zero-rate monthly need = 1200/12', zeroPlan.monthly, 100);
  t.eq('zero-rate goal takes exactly 12 months', zeroTime.months, 12);
  t.eq('zero-rate projection equals target', zeroTime.projected, 1200);

  t.eq('savings above target are achieved', achieved.achieved, true);
  t.eq('achieved goal needs no deposit', achieved.monthly, 0);
  t.eq('achieved goal has zero deposits', achieved.totalDeposits, 0);

  t.eq('negative target rejected', engine.monthlyNeeded(-1, 0, 5, 12), { ok: false, error: 'bad_target' });
  t.eq('zero target rejected', engine.monthlyNeeded(0, 0, 5, 12), { ok: false, error: 'bad_target' });
  t.eq('negative current savings rejected', engine.monthlyNeeded(1000, -1, 5, 12), { ok: false, error: 'bad_current' });
  t.eq('negative rate rejected', engine.monthlyNeeded(1000, 0, -1, 12), { ok: false, error: 'bad_rate' });
  t.eq('rate above 100 rejected', engine.monthlyNeeded(1000, 0, 101, 12), { ok: false, error: 'bad_rate' });
  t.eq('zero months rejected', engine.monthlyNeeded(1000, 0, 5, 0), { ok: false, error: 'bad_months' });
  t.eq('fractional months rejected', engine.monthlyNeeded(1000, 0, 5, 1.5), { ok: false, error: 'bad_months' });
  t.eq('months above limit rejected', engine.monthlyNeeded(1000, 0, 5, 1201), { ok: false, error: 'range' });
  t.eq('zero monthly deposit rejected', engine.monthsToGoal(1000, 0, 5, 0), { ok: false, error: 'bad_monthly' });
  t.eq('NaN target rejected', engine.monthsToGoal(NaN, 0, 5, 100), { ok: false, error: 'bad_target' });
  t.eq('string input rejected', engine.monthlyNeeded('1000', 0, 5, 12), { ok: false, error: 'bad_target' });
  t.eq('round2(1.005) = 1.01', engine.round2(1.005), 1.01);
  t.eq('round2(-1.005) = -1.01', engine.round2(-1.005), -1.01);
  t.eq('ceil2(333.331) = 333.34', engine.ceil2(333.331), 333.34);
  t.eq('ceil2(100) = 100', engine.ceil2(100), 100);

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
