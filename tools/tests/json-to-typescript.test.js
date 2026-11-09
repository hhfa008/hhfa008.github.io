#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'json-to-typescript';
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

  var parsed = engine.parseJsonText('{"a":1}');
  t.ok('parseJsonText ok', parsed.ok === true);
  var broken = engine.parseJsonText('{\n  "a": 1,\n}');
  t.eq('invalid JSON code', broken.error, 'invalid_json');
  t.eq('invalid JSON line', broken.line, 3);
  t.ok('invalid JSON column numeric', typeof broken.column === 'number' && broken.column >= 1);

  t.eq('infer string', engine.inferType('x').kind, 'string');
  t.eq('infer number', engine.inferType(1.5).kind, 'number');
  t.eq('infer boolean', engine.inferType(false).kind, 'boolean');
  t.eq('infer null', engine.inferType(null).kind, 'null');
  t.eq('infer empty array element', engine.inferType([]).element.kind, 'unknown');

  var merged = engine.inferType([{ a: 1 }, { b: 'x' }]).element;
  t.eq('array merge keeps shared key', merged.props[0].name, 'a');
  t.eq('array merge marks missing optional', merged.props[0].optional, true);
  t.eq('array merge adds second key', merged.props[1].name, 'b');
  t.eq('array merge second optional', merged.props[1].optional, true);

  var union = engine.mergeTypes({ kind: 'number' }, { kind: 'string' });
  t.eq('merge conflict gives union', union.kind, 'union');
  t.eq('union member count', union.types.length, 2);

  var nested = engine.toTypeScript({ user: { name: 'Ada', age: 36 } }, {});
  t.eq('nested code', nested.code,
    'export interface Root {\n  user: RootUser;\n}\n\nexport interface RootUser {\n  name: string;\n  age: number;\n}');
  t.eq('nested interface count', nested.interfaces, 2);
  t.eq('nested field count', nested.fields, 3);

  var arrayMerge = engine.toTypeScript({ items: [{ id: 1, name: 'a' }, { id: 2 }] }, {});
  t.eq('array element interface', arrayMerge.code,
    'export interface Root {\n  items: RootItemsItem[];\n}\n\nexport interface RootItemsItem {\n  id: number;\n  name?: string;\n}');
  t.ok('optional marker present', arrayMerge.code.indexOf('name?: string;') !== -1);

  var nullable = engine.toTypeScript({ value: [1, null] }, {});
  t.ok('nullable union rendered', nullable.code.indexOf('Array<number | null>') !== -1);

  var scalar = engine.toTypeScript(42, {});
  t.eq('root scalar alias', scalar.code, 'export type Root = number;');

  var rootArray = engine.toTypeScript([{ id: 1 }], {});
  t.eq('root array alias', rootArray.code,
    'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n}');

  var emptyObject = engine.toTypeScript({}, {});
  t.eq('empty root object', emptyObject.code, 'export type Root = Record<string, unknown>;');

  var typeMode = engine.toTypeScript({ user: { name: 'Ada' } }, { mode: 'type' });
  t.eq('type mode inline object', typeMode.code,
    'export type Root = {\n  user: {\n    name: string;\n  };\n};');
  t.eq('type mode has no interfaces', typeMode.interfaces, 0);

  var noExport = engine.toTypeScript({ a: 1 }, { export: false });
  t.ok('export disabled', noExport.code.indexOf('export ') === -1);
  t.ok('no export code starts with interface', noExport.code.indexOf('interface Root') === 0);

  t.eq('sanitize plain', engine.sanitizeName('my root!'), 'MyRoot');
  t.eq('sanitize leading digit', engine.sanitizeName('123abc'), '_123abc');
  t.ok('named root used', engine.toTypeScript({ a: 1 }, { rootName: 'api response' }).code.indexOf('interface ApiResponse') !== -1);

  var quotedKey = engine.toTypeScript({ 'user-name': 'Ada' }, { mode: 'type' });
  t.ok('non-identifier key quoted', quotedKey.code.indexOf('"user-name": string;') !== -1);

  var customIndent = engine.toTypeScript({ a: 1 }, { indent: 4 });
  t.ok('4-space indent', customIndent.code.indexOf('\n    a: number;') !== -1);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
