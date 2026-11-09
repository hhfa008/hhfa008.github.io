#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'recipe-scaler';
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
  t.eq('externalRefs is empty', lib.externalRefs(html), []);
  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (item) { return item && item['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
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
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var r;

  r = engine.scaleFactor(2, 6);
  t.eq('scaleFactor(2,6) ok', r.ok, true);
  t.eq('2 → 6 servings factor = 3', r.value, 3);

  r = engine.scaleFactor(3, 2);
  t.near('3 → 2 servings factor = 0.6667', r.value, 2 / 3, 1e-12);

  t.eq('same servings factor = 1', engine.scaleFactor(4, 4).value, 1);
  t.eq('zero original rejected', engine.scaleFactor(0, 6), { ok: false, error: 'range' });
  t.eq('zero target rejected', engine.scaleFactor(2, 0), { ok: false, error: 'range' });
  t.eq('negative servings rejected', engine.scaleFactor(-2, 6), { ok: false, error: 'range' });
  t.eq('NaN servings rejected', engine.scaleFactor(NaN, 6), { ok: false, error: 'bad_value' });
  t.eq('string servings rejected', engine.scaleFactor('2', 6), { ok: false, error: 'bad_value' });

  r = engine.scaleIngredients(3, [{ name: 'flour', amount: 2, unit: 'cup' }]);
  t.eq('scaleIngredients ok', r.ok, true);
  t.eq('scaleIngredients count', r.count, 1);
  t.eq('ingredient amount scaled', r.items[0].amount, 6);
  t.eq('ingredient original amount kept', r.items[0].original, 2);
  t.eq('ingredient unit unchanged', r.items[0].unit, 'cup');
  t.eq('ingredient name unchanged', r.items[0].name, 'flour');

  r = engine.scaleIngredients(2 / 3, [{ amount: 3, unit: 'g' }]);
  t.near('fractional factor applies', r.items[0].amount, 2, 1e-12);

  r = engine.scaleIngredients(3, [{ amount: 0, unit: 'g' }]);
  t.eq('zero amount stays zero', r.items[0].amount, 0);

  t.eq('negative ingredient amount rejected',
    engine.scaleIngredients(2, [{ amount: -1, unit: 'g' }]), { ok: false, error: 'range' });
  t.eq('zero factor rejected',
    engine.scaleIngredients(0, [{ amount: 1, unit: 'g' }]), { ok: false, error: 'range' });
  t.eq('non-array ingredients rejected', engine.scaleIngredients(2, null),
    { ok: false, error: 'bad_value' });
  t.eq('null ingredient row rejected', engine.scaleIngredients(2, [null]),
    { ok: false, error: 'bad_value' });
  t.eq('string amount rejected',
    engine.scaleIngredients(2, [{ amount: '1', unit: 'g' }]), { ok: false, error: 'bad_value' });
  t.eq('non-string unit rejected',
    engine.scaleIngredients(2, [{ amount: 1, unit: 5 }]), { ok: false, error: 'bad_value' });

  t.eq('format fraction 1.5', engine.formatAmount(1.5, 'fraction').text, '1 1/2');
  t.eq('format fraction 0.333', engine.formatAmount(0.333, 'fraction').text, '1/3');
  t.eq('format fraction 0.6667', engine.formatAmount(0.6667, 'fraction').text, '2/3');
  t.eq('format fraction 0.25', engine.formatAmount(0.25, 'fraction').text, '1/4');
  t.eq('format fraction 0.375', engine.formatAmount(0.375, 'fraction').text, '3/8');
  t.eq('format fraction 2.25', engine.formatAmount(2.25, 'fraction').text, '2 1/4');
  t.eq('format fraction 1.999 rounds to 2', engine.formatAmount(1.999, 'fraction').text, '2');
  t.eq('format fraction 0', engine.formatAmount(0, 'fraction').text, '0');
  t.eq('format fraction default mode', engine.formatAmount(0.5).text, '1/2');

  r = engine.formatAmount(1.3333, 'decimal');
  t.eq('format decimal 1.3333', r.text, '1.33');
  t.eq('format decimal numeric value', r.value, 1.33);
  t.eq('format decimal 2', engine.formatAmount(2, 'decimal').text, '2');
  t.eq('format decimal 1.005', engine.formatAmount(1.005, 'decimal').text, '1.01');

  r = engine.formatAmount(0.4, 'round');
  t.eq('round 0.4 up to 1', r.text, '1');
  t.eq('round numeric value 0.4', r.value, 1);
  t.eq('round 2.6 to 3', engine.formatAmount(2.6, 'round').text, '3');
  t.eq('round 0 stays 0', engine.formatAmount(0, 'round').text, '0');
  t.eq('round 2 stays 2', engine.formatAmount(2, 'round').text, '2');

  t.eq('unknown mode rejected', engine.formatAmount(1, 'fancy'), { ok: false, error: 'bad_mode' });
  t.eq('negative value rejected', engine.formatAmount(-1, 'fraction'), { ok: false, error: 'range' });
  t.eq('NaN value rejected', engine.formatAmount(NaN, 'fraction'), { ok: false, error: 'bad_value' });
  t.eq('string value rejected', engine.formatAmount('1', 'fraction'), { ok: false, error: 'bad_value' });

  return 'scale factor, ingredient scaling and formatting';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
