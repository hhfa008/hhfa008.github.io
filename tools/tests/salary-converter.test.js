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
var SLUG = 'salary-converter';
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
  var hourly = engine.toAnnual(100, 'hourly', 40, 52, 8);
  var monthly = engine.toAnnual(5000, 'monthly', 40, 52, 8);
  var weekly = engine.toAnnual(1000, 'weekly', 40, 52, 8);
  var daily = engine.toAnnual(800, 'daily', 40, 52, 8);
  var yearly = engine.toAnnual(100000, 'yearly', 40, 52, 8);
  var all = engine.allPeriods(100, 'hourly', 40, 52, 8);
  var monthlyAll = engine.allPeriods(5000, 'monthly', 40, 52, 8);

  t.ok('hourly to annual succeeds', hourly.ok === true);
  t.eq('100/hour × 40 × 52 = 208000', hourly.annual, 208000);
  t.eq('monthly 5000 → annual 60000', monthly.annual, 60000);
  t.eq('weekly 1000 → annual 52000', weekly.annual, 52000);
  t.eq('daily 800 with 8h days → annual 208000', daily.annual, 208000);
  t.eq('yearly 100000 stays 100000', yearly.annual, 100000);

  t.eq('208000 annual → hourly 100', engine.fromAnnual(208000, 'hourly', 40, 52, 8), { ok: true, value: 100 });
  t.eq('208000 annual → monthly 17333.33', engine.fromAnnual(208000, 'monthly', 40, 52, 8).value, 17333.33);
  t.eq('208000 annual → weekly 4000', engine.fromAnnual(208000, 'weekly', 40, 52, 8).value, 4000);
  t.eq('208000 annual → daily 800', engine.fromAnnual(208000, 'daily', 40, 52, 8).value, 800);
  t.eq('208000 annual → yearly 208000', engine.fromAnnual(208000, 'yearly', 40, 52, 8).value, 208000);

  t.eq('allPeriods annual = 208000', all.annual, 208000);
  t.eq('allPeriods hourly = 100', all.hourly, 100);
  t.eq('allPeriods daily = 800', all.daily, 800);
  t.eq('allPeriods weekly = 4000', all.weekly, 4000);
  t.eq('allPeriods monthly = 17333.33', all.monthly, 17333.33);
  t.eq('days per week derived from hours = 5', all.daysPerWeek, 5);
  t.eq('monthly input annual = 60000', monthlyAll.annual, 60000);
  t.eq('monthly input hourly = 28.85', monthlyAll.hourly, 28.85);
  t.near('monthly × 12 is within a cent of annual', monthlyAll.monthly * 12, monthlyAll.annual, 0.01);
  t.eq('round trip hourly → annual → hourly returns 100',
    engine.fromAnnual(engine.toAnnual(100, 'hourly', 40, 52, 8).annual, 'hourly', 40, 52, 8).value, 100);
  t.eq('zero amount yields zero annual', engine.allPeriods(0, 'hourly', 40, 52, 8).annual, 0);
  t.eq('zero amount yields zero hourly', engine.allPeriods(0, 'hourly', 40, 52, 8).hourly, 0);

  t.eq('zero weekly hours rejected', engine.toAnnual(100, 'hourly', 0, 52, 8), { ok: false, error: 'bad_hours' });
  t.eq('weekly hours above 168 rejected', engine.toAnnual(100, 'hourly', 169, 52, 8), { ok: false, error: 'bad_hours' });
  t.eq('168 weekly hours allowed', engine.toAnnual(100, 'hourly', 168, 52, 8).annual, 873600);
  t.eq('zero working weeks rejected', engine.toAnnual(100, 'hourly', 40, 0, 8), { ok: false, error: 'bad_weeks' });
  t.eq('working weeks above 52 rejected', engine.toAnnual(100, 'hourly', 40, 53, 8), { ok: false, error: 'bad_weeks' });
  t.eq('52 working weeks allowed', engine.toAnnual(100, 'hourly', 40, 52, 8).ok, true);
  t.eq('zero daily hours rejected', engine.toAnnual(100, 'hourly', 40, 52, 0), { ok: false, error: 'bad_day_hours' });
  t.eq('daily hours above 24 rejected', engine.toAnnual(100, 'hourly', 40, 52, 25), { ok: false, error: 'bad_day_hours' });
  t.eq('24 daily hours allowed', engine.toAnnual(100, 'hourly', 40, 52, 24).ok, true);
  t.eq('invalid period rejected', engine.toAnnual(100, 'fortnightly', 40, 52, 8), { ok: false, error: 'bad_period' });
  t.eq('negative amount rejected', engine.toAnnual(-1, 'hourly', 40, 52, 8), { ok: false, error: 'bad_amount' });
  t.eq('NaN amount rejected', engine.toAnnual(NaN, 'hourly', 40, 52, 8), { ok: false, error: 'bad_amount' });
  t.eq('string amount rejected', engine.fromAnnual('208000', 'hourly', 40, 52, 8), { ok: false, error: 'bad_amount' });
  t.eq('round2(1.005) = 1.01', engine.round2(1.005), 1.01);
  t.eq('round2(-1.005) = -1.01', engine.round2(-1.005), -1.01);
  t.eq('isNum(0) is true', engine.isNum(0), true);
  t.eq('isNum("0") is false', engine.isNum('0'), false);

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
