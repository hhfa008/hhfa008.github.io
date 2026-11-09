#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'regex-tester';
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
var engine = lib.evalScript(html, 'engine', 'ToolEngine');
var dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite(SLUG);

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
  try { jsonLd = lib.jsonLd(html); t.ok('JSON-LD parses', true); }
  catch (e) { t.ok('JSON-LD parses', false, e.message); }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (x) { return x && x['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  var faqPage = jsonLd.filter(function (x) { return x && x['@type'] === 'FAQPage'; })[0];
  t.ok('FAQPage has 3+ questions', !!faqPage && faqPage.mainEntity.length >= 3);
  t.ok('viewport present', /<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html));
  t.ok('title non-empty', /<title>\s*[^<]+?\s*<\/title>/i.test(html));
  t.ok('meta description non-empty', /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html));
  t.ok('canonical correct', (function () {
    var m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
    return !!m && m[1] === EXPECTED_CANONICAL;
  })());
  t.ok('author is Devin', /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('inline favicon', /<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  LANGS.forEach(function (lang) {
    var n = (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length;
    t.eq('one language button for ' + lang, n, 1);
  });
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var engineCode = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage', !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(engineCode));
  t.ok('engine has no clock dependency', !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(engineCode));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var eg = t.group('engine', function () {
  t.eq('valid pattern and flags', engine.validatePattern('a+', 'gim'), { ok: true, flags: 'gim' });
  t.eq('invalid pattern', engine.validatePattern('[', 'g'), { ok: false, error: 'bad_pattern' });
  t.eq('invalid flag', engine.validatePattern('a', 'gz'), { ok: false, error: 'bad_flags' });
  t.eq('duplicate flag', engine.validatePattern('a', 'gg'), { ok: false, error: 'bad_flags' });
  t.eq('non-string pattern', engine.validatePattern(5, 'g'), { ok: false, error: 'bad_value' });

  var global = engine.execAll('a', 'g', 'aba');
  t.eq('global match count', global.matches.length, 2);
  t.eq('global match indexes', global.matches.map(function (m) { return m.index; }), [0, 2]);
  t.eq('without g returns first only', engine.execAll('a', '', 'aba').matches.length, 1);
  t.eq('case-insensitive flag', engine.execAll('A', 'gi', 'aA').matches.length, 2);

  var caps = engine.execAll('(a)(b)?', 'g', 'a ab').matches;
  t.eq('capture group values', caps[1].groups, ['a', 'b']);
  t.eq('unmatched group is null', caps[0].groups, ['a', null]);
  var named = engine.execAll('(?<word>[a-z]+)', 'g', 'hi 42');
  t.eq('named group', named.matches[0].named, { word: 'hi' });

  var zero = engine.execAll('a*', 'g', 'ba');
  t.eq('zero-width matches terminate', zero.matches.map(function (m) { return m.index; }), [0, 1, 2]);
  t.eq('empty pattern matches every position', engine.execAll('', 'g', 'ab').matches.length, 3);
  t.eq('unicode zero-width advances by code point', engine.execAll('', 'gu', '😀').matches.map(function (m) { return m.index; }), [0, 2]);
  t.eq('multiline anchors', engine.execAll('^', 'gm', 'a\nb').matches.length, 2);

  var rep = engine.replaceAll('(\\w+)@(\\w+)', 'g', 'a@b c@d', '$2:$1');
  t.eq('replacement with groups', rep.value, 'b:a d:c');
  t.eq('replacement count', rep.count, 2);
  t.eq('replacement without g only first', engine.replaceAll('a', '', 'aba', 'x').value, 'xba');
  t.eq('literal dollar escape', engine.replaceAll('a', 'g', 'a', '$$1').value, '$1');
  t.eq('empty replacement deletes', engine.replaceAll('\\d+', 'g', 'a1b2', '').value, 'ab');

  t.ok('risk flags nested quantifier', engine.riskWarnings('(a+)+').indexOf('nested_quantifier') !== -1);
  t.ok('risk flags alternation', engine.riskWarnings('(a|a)+').indexOf('alternation_quantifier') !== -1);
  t.eq('safe pattern has no risk', engine.riskWarnings('\\d+'), []);
  t.eq('text over limit rejected', engine.execAll('a', 'g', new Array(100002).join('a')),
    { ok: false, error: 'too_large' });
  t.eq('execAll rejects non-string text', engine.execAll('a', 'g', null), { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
