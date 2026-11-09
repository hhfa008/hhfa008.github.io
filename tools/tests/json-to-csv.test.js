#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'json-to-csv';
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

  var parsed = engine.parseJson('[{"a":1}]');
  t.ok('parseJson ok', parsed.ok === true);
  t.eq('parseJson value', JSON.stringify(parsed.value), '[{"a":1}]');

  var broken = engine.parseJson('{\n  "a": 1,\n}');
  t.eq('invalid JSON code', broken.error, 'invalid_json');
  t.eq('invalid JSON line', broken.line, 3);
  t.ok('invalid JSON column is a number', typeof broken.column === 'number' && broken.column >= 1);

  var flat = engine.flattenObject({ user: { name: 'Ada', tags: ['x', 'y'] }, ok: true });
  t.eq('flatten nested keys', Object.keys(flat), ['user.name', 'user.tags.0', 'user.tags.1', 'ok']);
  t.eq('flatten nested value', flat['user.name'], 'Ada');

  var emptyFlat = engine.flattenObject({ list: [], blank: {} });
  t.eq('empty array flatten', emptyFlat.list, '[]');
  t.eq('empty object flatten', emptyFlat.blank, '{}');

  var union = engine.collectKeys([{ a: 1 }, { b: 2, a: 3 }, { c: null }], true);
  t.eq('column union order', union, ['a', 'b', 'c']);

  t.eq('escape plain', engine.escapeCell('plain', ','), 'plain');
  t.eq('escape comma', engine.escapeCell('a,b', ','), '"a,b"');
  t.eq('escape quote', engine.escapeCell('say "hi"', ','), '"say ""hi"""');
  t.eq('escape newline', engine.escapeCell('a\nb', ','), '"a\nb"');
  t.eq('escape leading space', engine.escapeCell(' x', ','), '" x"');
  t.eq('escape null', engine.escapeCell(null, ','), '');
  t.eq('escape tab delimiter not used by comma', engine.escapeCell('a\tb', ','), 'a\tb');

  var csv = engine.toCsv([
    { id: 1, user: { name: 'Ada' } },
    { id: 2, user: { name: 'Linus' }, note: 'a, b' }
  ], { delimiter: ',', flatten: true, header: true, bom: false });
  t.ok('toCsv ok', csv.ok === true);
  t.eq('toCsv columns', csv.columns, ['id', 'user.name', 'note']);
  t.eq('toCsv header line', csv.csv.split('\r\n')[0], 'id,user.name,note');
  t.eq('toCsv missing cell', csv.csv.split('\r\n')[1], '1,Ada,');
  t.eq('toCsv quoted cell', csv.csv.split('\r\n')[2], '2,Linus,"a, b"');
  t.eq('toCsv row count', csv.rowCount, 2);

  var bomCsv = engine.toCsv([{ a: 1 }], { bom: true });
  t.ok('BOM prefix', bomCsv.csv.charAt(0) === '\uFEFF');

  var noHeader = engine.toCsv([{ a: 1, b: 2 }], { header: false });
  t.eq('header disabled', noHeader.csv, '1,2\r\n');

  var nestedJson = engine.toCsv([{ user: { name: 'Ada' } }], { flatten: false });
  t.eq('flatten off keeps JSON in cell', nestedJson.csv.split('\r\n')[1], '"{""name"":""Ada""}"');

  var scalar = engine.toCsv([1, 2], {});
  t.eq('scalar rows use value column', scalar.columns, ['value']);
  t.eq('scalar row csv', scalar.csv, 'value\r\n1\r\n2\r\n');

  var notArray = engine.toCsv({ a: 1 }, {});
  t.eq('non-array rejected', notArray, { ok: false, error: 'not_array' });

  var empty = engine.toCsv([], {});
  t.ok('empty array ok', empty.ok === true);
  t.eq('empty array output', empty.csv, '');

  var badDelim = engine.toCsv([{ a: 1 }], { delimiter: ',,', flatten: true });
  t.eq('bad delimiter rejected', badDelim, { ok: false, error: 'bad_delimiter' });

  var tabCsv = engine.toCsv([{ a: 'x\ty' }], { delimiter: '\t' });
  t.eq('tab delimiter quoting', tabCsv.csv, 'a\r\n"x\ty"\r\n');
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
