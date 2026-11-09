#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'number-base-converter';
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

var html = lib.page(DIR);
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* reported below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* reported below */ }

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

  t.ok('parseBase integer is BigInt', typeof engine.parseBase('255', 10).value === 'bigint');
  t.eq('parseBase decimal value', engine.parseBase('255', 10).value.toString(), '255');
  t.eq('parseBase hex value', engine.parseBase('ff', 16).value.toString(), '255');
  t.eq('parseBase uppercase accepted', engine.parseBase('FF', 16).value.toString(), '255');
  t.eq('parseBase negative', engine.parseBase('-1010', 2).value.toString(), '-10');

  t.eq('255 decimal to hex', engine.convertBase('255', 10, 16, 8).value, 'FF');
  t.eq('FF hex to decimal', engine.convertBase('ff', 16, 10, 8).value, '255');
  t.eq('binary to decimal', engine.convertBase('1010', 2, 10, 8).value, '10');
  t.eq('decimal to binary', engine.convertBase('10', 10, 2, 8).value, '1010');
  t.eq('base 36 digit to decimal', engine.convertBase('z', 36, 10, 8).value, '35');
  t.eq('decimal 10 to base 36', engine.convertBase('10', 10, 36, 8).value, 'A');
  t.eq('zero stays zero', engine.convertBase('0', 10, 2, 8).value, '0');

  var big = '9007199254740993';
  var bigHex = engine.convertBase(big, 10, 16, 8);
  t.eq('big integer exact hex', bigHex.value, '20000000000001');
  t.eq('big integer round trip', engine.convertBase(bigHex.value, 16, 10, 8).value, big);

  t.eq('fraction 0.5 to binary', engine.convertBase('0.5', 10, 2, 8).value, '0.1');
  var repeating = engine.convertBase('0.1', 10, 2, 8);
  t.eq('repeating fraction truncated', repeating.value, '0.00011001');
  t.eq('repeating fraction flagged', repeating.truncated, true);
  t.eq('precision zero drops fraction', engine.convertBase('0.5', 10, 2, 0).value, '0');
  t.eq('precision zero flagged truncated', engine.convertBase('0.5', 10, 2, 0).truncated, true);
  t.eq('fraction in hex', engine.convertBase('10.5', 10, 16, 4).value, 'A.8');

  var badDigit = engine.parseBase('12g', 16);
  t.eq('invalid digit code', badDigit.error, 'bad_digit');
  t.eq('invalid digit character', badDigit.digit, 'g');
  t.eq('invalid digit index', badDigit.index, 2);
  t.eq('invalid digit in fraction', engine.parseBase('1.2z', 10).index, 3);

  t.eq('base below range rejected', engine.parseBase('10', 1).error, 'bad_base');
  t.eq('base above range rejected', engine.parseBase('10', 37).error, 'bad_base');
  t.eq('base 2 works', engine.convertBase('11', 2, 10, 8).value, '3');
  t.eq('base 36 works', engine.convertBase('zz', 36, 10, 8).value, '1295');
  t.eq('empty input rejected', engine.parseBase('   ', 10).error, 'empty_input');
  t.eq('trailing dot rejected', engine.parseBase('1.', 10).error, 'bad_digit');
  t.eq('double dot rejected', engine.parseBase('1.2.3', 10).error, 'bad_digit');
  t.eq('bad precision rejected', engine.convertBase('1', 10, 2, 33).error, 'bad_precision');

  t.eq('formatGroup decimal', engine.formatGroup('1234567', 3, ',').value, '1,234,567');
  t.eq('formatGroup negative fraction', engine.formatGroup('-1234567.89', 3, ',').value, '-1,234,567.89');
  t.eq('formatGroup small number', engine.formatGroup('12', 3, ' ').value, '12');
  t.eq('formatGroup invalid size', engine.formatGroup('12', 0, ',').error, 'bad_value');
  t.eq('formatGroup empty', engine.formatGroup('  ', 3, ',').error, 'empty_input');
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
