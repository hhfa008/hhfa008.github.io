#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'retirement-calculator';
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

  // futureBalance: 0% returns savings plus contributions (all in cents).
  t.eq('futureBalance zero rate 10y', engine.futureBalance(0, 100000, 0, 10), { ok: true, value: 12000000 });
  t.eq('futureBalance zero years returns savings', engine.futureBalance(500000, 100000, 7, 0), { ok: true, value: 500000 });
  // 10,000 at 5% compounded monthly for 10 years = 16,470.09.
  t.eq('futureBalance 5%/10y monthly compounding', engine.futureBalance(1000000, 0, 5, 10), { ok: true, value: 1647009 });
  t.eq('futureBalance rejects negative savings', engine.futureBalance(-1, 0, 5, 10), { ok: false, error: 'bad_savings' });
  t.eq('futureBalance rejects fractional years', engine.futureBalance(0, 0, 5, 1.5), { ok: false, error: 'bad_years' });

  // requiredFunds: 12,000/yr for 20 years at 0% = 240,000.
  t.eq('requiredFunds zero rate', engine.requiredFunds(1200000, 0, 20), { ok: true, value: 24000000 });
  t.eq('requiredFunds 5% 20y', engine.requiredFunds(1200000, 5, 20), { ok: true, value: 15152531 });
  t.eq('requiredFunds zero years', engine.requiredFunds(1200000, 5, 0), { ok: true, value: 0 });
  t.eq('requiredFunds rejects negative spend', engine.requiredFunds(-1, 5, 20), { ok: false, error: 'bad_spend' });

  // yearsSustained simulation.
  t.eq('yearsSustained zero rate 20y', engine.yearsSustained(24000000, 1200000, 0, 1200), {
    ok: true, months: 240, years: 20, finite: true, depleted: true
  });
  t.eq('yearsSustained zero balance', engine.yearsSustained(0, 1200000, 5, 1200), {
    ok: true, months: 0, years: 0, finite: true, depleted: true
  });
  var inf = engine.yearsSustained(100, 0, 5, 1200);
  t.eq('yearsSustained zero spend is infinite', { ok: inf.ok, months: inf.months, finite: inf.finite }, { ok: true, months: 1200, finite: false });

  // gap sign.
  t.eq('gap positive when short', engine.gap(100, 500), { ok: true, value: 400 });
  t.eq('gap negative when surplus', engine.gap(500, 100), { ok: true, value: -400 });
  t.eq('gap rejects negative balance', engine.gap(-1, 100), { ok: false, error: 'bad_savings' });

  // analyze validation and consistency.
  t.eq('analyze rejects retirement age <= current', engine.analyze({
    curAge: 30, retAge: 30, lifeAge: 85, rate: 5, postRate: null,
    savings: 100, monthly: 0, spend: 0
  }), { ok: false, error: 'age_order' });
  t.eq('analyze rejects lifespan <= retirement age', engine.analyze({
    curAge: 30, retAge: 65, lifeAge: 60, rate: 5, postRate: null,
    savings: 100, monthly: 0, spend: 0
  }), { ok: false, error: 'life_order' });
  t.eq('analyze rejects fractional age', engine.analyze({
    curAge: 30.5, retAge: 65, lifeAge: 85, rate: 5, postRate: null,
    savings: 100, monthly: 0, spend: 0
  }), { ok: false, error: 'bad_age' });
  t.eq('analyze rejects rate out of range', engine.analyze({
    curAge: 30, retAge: 65, lifeAge: 85, rate: 60, postRate: null,
    savings: 100, monthly: 0, spend: 0
  }), { ok: false, error: 'bad_rate' });
  t.eq('analyze rejects string age', engine.analyze({
    curAge: '30', retAge: 65, lifeAge: 85, rate: 5, postRate: null,
    savings: 100, monthly: 0, spend: 0
  }), { ok: false, error: 'bad_age' });

  var plan = engine.analyze({
    curAge: 30, retAge: 65, lifeAge: 85, rate: 5, postRate: null,
    savings: 10000000, monthly: 200000, spend: 6000000
  });
  t.ok('analyze returns ok for a valid plan', !!plan && plan.ok === true);
  if (plan && plan.ok) {
    t.eq('analyze gap equals needed minus balance', plan.gap, plan.needed - plan.balance);
    t.ok('analyze enough agrees with gap sign', plan.enough === (plan.gap <= 0));
    t.eq('analyze years to retire', plan.yearsToRet, 35);
    t.eq('analyze years in retirement', plan.yearsRet, 20);

    var same = engine.analyze({
      curAge: 30, retAge: 65, lifeAge: 85, rate: 5, postRate: 5,
      savings: 10000000, monthly: 200000, spend: 6000000
    });
    t.eq('postRate null reuses pre-retirement rate', same, plan);

    var shortPlan = engine.analyze({
      curAge: 30, retAge: 65, lifeAge: 85, rate: 5, postRate: null,
      savings: 0, monthly: 0, spend: 6000000
    });
    t.ok('empty savings is short', shortPlan.ok && shortPlan.shortfall === true);
  }

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
