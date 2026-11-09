#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'shoe-size-converter';
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

  r = engine.cmToSize(25, 'men');
  t.eq('25 cm men ok', r.ok, true);
  t.eq('25 cm men = EU 40', r.value.EU, 40);
  t.eq('25 cm men = US 7', r.value.US, 7);
  t.eq('25 cm men = UK 6', r.value.UK, 6);
  t.eq('25 cm men = JP 25', r.value.JP, 25);
  t.eq('25 cm is an exact chart row', r.exact, true);

  t.eq('EU 40 men = 25 cm', engine.sizeToCm('EU', 40, 'men').value, 25);
  t.eq('US 7 men = 25 cm', engine.sizeToCm('US', 7, 'men').value, 25);
  t.eq('UK 6 men = 25 cm', engine.sizeToCm('UK', 6, 'men').value, 25);
  t.eq('JP 25 men = 25 cm', engine.sizeToCm('JP', 25, 'men').value, 25);
  t.eq('cm 25 men = 25', engine.sizeToCm('cm', 25, 'men').value, 25);

  t.eq('convert 25 cm to EU men = 40', engine.convert(25, 'cm', 'EU', 'men').value, 40);
  t.eq('convert EU 40 to US men = 7', engine.convert(40, 'EU', 'US', 'men').value, 7);
  t.eq('convert US 7 back to EU men = 40', engine.convert(7, 'US', 'EU', 'men').value, 40);
  t.eq('convert JP 25 to UK men = 6', engine.convert(25, 'JP', 'UK', 'men').value, 6);
  t.eq('convert EU 40 to cm = 25', engine.convert(40, 'EU', 'cm', 'men').value, 25);

  r = engine.cmToSize(25, 'women');
  t.eq('women 25 cm = EU 38.5', r.value.EU, 38.5);
  t.eq('women 25 cm = US 8', r.value.US, 8);
  t.eq('women 25 cm = UK 5.5', r.value.UK, 5.5);

  r = engine.cmToSize(15, 'children');
  t.eq('children 15 cm = EU 24', r.value.EU, 24);
  t.eq('children 15 cm = US 8', r.value.US, 8);
  t.eq('children 15 cm = UK 7', r.value.UK, 7);
  t.eq('children US 1.5 maps to 21 cm', engine.sizeToCm('US', 1.5, 'children').value, 21);

  r = engine.cmToSize(25.5, 'men');
  t.eq('half size 25.5 = EU 40.5', r.value.EU, 40.5);
  t.eq('half size 25.5 = US 7.5', r.value.US, 7.5);
  t.eq('half size 25.5 = UK 6.5', r.value.UK, 6.5);
  t.eq('EU 40.5 men = 25.5 cm', engine.sizeToCm('EU', 40.5, 'men').value, 25.5);

  r = engine.cmToSize(24.8, 'men');
  t.eq('nearest foot length picks 25 cm row', r.cm, 25);
  t.eq('nearest lookup is not exact', r.exact, false);

  var men = engine.table('men');
  t.eq('men chart rows', men.rows.length, 14);
  t.eq('women chart rows', engine.table('women').rows.length, 13);
  t.eq('children chart rows', engine.table('children').rows.length, 12);
  t.eq('men chart JP equals cm', men.rows.every(function (row) { return row.JP === row.cm; }), true);
  t.ok('men chart is sorted by foot length', men.rows.every(function (row, i, list) {
    return i === 0 || list[i - 1].cm < row.cm;
  }));

  t.eq('bad gender rejected by cmToSize', engine.cmToSize(25, 'kids'),
    { ok: false, error: 'bad_mode' });
  t.eq('bad gender rejected by table', engine.table('kids'), { ok: false, error: 'bad_mode' });
  t.eq('foot length too small rejected', engine.cmToSize(5, 'men'), { ok: false, error: 'range' });
  t.eq('foot length too large rejected', engine.cmToSize(50, 'men'), { ok: false, error: 'range' });
  t.eq('cm system out of range rejected', engine.sizeToCm('cm', 50, 'men'),
    { ok: false, error: 'range' });
  t.eq('negative size rejected', engine.sizeToCm('EU', -1, 'men'), { ok: false, error: 'range' });
  t.eq('unknown half size rejected', engine.sizeToCm('EU', 39.5, 'men'),
    { ok: false, error: 'not_found' });
  t.eq('NaN size rejected', engine.sizeToCm('EU', NaN, 'men'), { ok: false, error: 'bad_value' });
  t.eq('string size rejected', engine.sizeToCm('EU', '40', 'men'), { ok: false, error: 'bad_value' });
  t.eq('bad system rejected', engine.sizeToCm('FR', 40, 'men'), { ok: false, error: 'bad_mode' });
  t.eq('convert with bad system rejected', engine.convert(40, 'FR', 'EU', 'men'),
    { ok: false, error: 'bad_mode' });
  t.eq('convert with unknown size rejected', engine.convert(39.5, 'EU', 'US', 'men'),
    { ok: false, error: 'not_found' });
  t.eq('convert NaN rejected', engine.convert(NaN, 'EUR', 'US', 'men'),
    { ok: false, error: 'bad_value' });

  return 'gender charts, half sizes and conversions';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
