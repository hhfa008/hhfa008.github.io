#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'roman-numeral-converter';
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
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var r = engine.toRoman(1994);
  t.ok('1994 converts', r.ok === true);
  t.eq('1994 roman', r.roman, 'MCMXCIV');
  t.eq('1994 lowercase', r.lower, 'mcmxciv');
  t.eq('1994 step count', r.steps.length, 4);
  t.eq('1994 second step', r.steps[1], { value: 900, symbol: 'CM', count: 1 });

  t.eq('4 is IV', engine.toRoman(4).roman, 'IV');
  t.eq('9 is IX', engine.toRoman(9).roman, 'IX');
  t.eq('40 is XL', engine.toRoman(40).roman, 'XL');
  t.eq('90 is XC', engine.toRoman(90).roman, 'XC');
  t.eq('400 is CD', engine.toRoman(400).roman, 'CD');
  t.eq('900 is CM', engine.toRoman(900).roman, 'CM');
  t.eq('1 is I', engine.toRoman(1).roman, 'I');
  t.eq('3999 roman', engine.toRoman(3999).roman, 'MMMCMXCIX');
  t.eq('3 steps for 3', engine.toRoman(3).steps[0], { value: 1, symbol: 'I', count: 3 });

  t.eq('0 rejected', engine.toRoman(0), { ok: false, error: 'range' });
  t.eq('-1 rejected', engine.toRoman(-1), { ok: false, error: 'range' });
  t.eq('4000 rejected', engine.toRoman(4000), { ok: false, error: 'range' });
  t.eq('3.5 rejected', engine.toRoman(3.5), { ok: false, error: 'bad_value' });
  t.eq('string number rejected', engine.toRoman('1994'), { ok: false, error: 'bad_value' });
  t.eq('NaN rejected', engine.toRoman(NaN), { ok: false, error: 'bad_value' });

  t.eq('MCMXCIV parses', engine.fromRoman('MCMXCIV').value, 1994);
  t.eq('lowercase parses', engine.fromRoman('mcmxciv').value, 1994);
  t.eq('padded lowercase parses', engine.fromRoman('  mcmxciv  ').value, 1994);
  t.eq('MMMCMXCIX parses', engine.fromRoman('MMMCMXCIX').value, 3999);
  t.eq('IV parses', engine.fromRoman('IV').value, 4);

  t.eq('IIII rejected', engine.fromRoman('IIII'), { ok: false, error: 'invalid_roman' });
  t.eq('VX rejected', engine.fromRoman('VX'), { ok: false, error: 'invalid_roman' });
  t.eq('IC rejected', engine.fromRoman('IC'), { ok: false, error: 'invalid_roman' });
  t.eq('IIX rejected', engine.fromRoman('IIX'), { ok: false, error: 'invalid_roman' });
  t.eq('MMMM rejected', engine.fromRoman('MMMM'), { ok: false, error: 'range' });
  t.eq('A is invalid', engine.fromRoman('A'), { ok: false, error: 'invalid_roman' });
  t.eq('empty rejected', engine.fromRoman(''), { ok: false, error: 'empty_input' });
  t.eq('number input to fromRoman rejected', engine.fromRoman(1994), { ok: false, error: 'bad_value' });

  t.eq('validate number source', engine.validate(1994).source, 'number');
  t.eq('validate roman value', engine.validate('mcmxciv').value, 1994);
  t.eq('validate invalid', engine.validate('IIII').error, 'invalid_roman');
  t.eq('validate bad type', engine.validate(null).error, 'bad_value');

  var roundTripOk = true;
  for (var i = 1; i <= 3999; i++) {
    var roman = engine.toRoman(i).roman;
    if (engine.fromRoman(roman).value !== i) { roundTripOk = false; break; }
  }
  t.ok('round trip 1..3999', roundTripOk);

  t.eq('isNum(0)', engine.isNum(0), true);
  t.eq('isNum("0")', engine.isNum('0'), false);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
