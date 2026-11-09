#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'css-formatter';
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

  var simple = engine.formatCss('a{color:red;background:blue}');
  t.ok('format ok', simple.ok === true);
  t.eq('format indentation', simple.css, 'a {\n  color:red;\n  background:blue;\n}');
  t.eq('format line count', simple.lines, 4);

  var nested = engine.formatCss('@media (min-width:600px){a{color:red}}');
  t.eq('nested rule indentation', nested.css,
    '@media (min-width:600px) {\n  a {\n    color:red;\n  }\n}');

  var four = engine.formatCss('a{color:red}', { indent: 4 });
  t.eq('4-space indent', four.css, 'a {\n    color:red;\n}');
  var tabbed = engine.formatCss('a{color:red}', { indent: 'tab' });
  t.eq('tab indent', tabbed.css, 'a {\n\tcolor:red;\n}');

  var comment = engine.formatCss('/* theme */a{color:red}');
  t.eq('comment kept in format', comment.css, '/* theme */\na {\n  color:red;\n}');

  var stringBrace = engine.formatCss('.a{content:"}";color:red}');
  t.eq('brace inside string safe', stringBrace.css, '.a {\n  content:"}";\n  color:red;\n}');

  var stringSemi = engine.minifyCss('.a{content:"a;b"}');
  t.eq('semicolon inside string safe', stringSemi.css, '.a{content:"a;b"}');

  var dataUri = engine.minifyCss('.a{background:url(data:image/svg+xml;base64,ABC==)}');
  t.eq('data URI preserved', dataUri.css, '.a{background:url(data:image/svg+xml;base64,ABC==)}');

  var calc = engine.minifyCss('.a{width:calc(100% - 10px)}');
  t.eq('calc spaces preserved', calc.css, '.a{width:calc(100% - 10px)}');

  var atImport = engine.formatCss('@import url("x.css");');
  t.eq('at-rule statement formatted', atImport.css, '@import url("x.css");');

  var minified = engine.minifyCss('a { color: red; }\n b { margin: 0 }');
  t.eq('minify simple', minified.css, 'a{color: red;}b{margin: 0}');
  t.eq('minified line count', minified.lines, 1);

  var minifiedNested = engine.minifyCss('@media (min-width: 600px) { a { color: red; } }');
  t.eq('minify nested', minifiedNested.css, '@media (min-width: 600px){a{color: red;}}');

  var dropped = engine.minifyCss('/* x */a{color:red}');
  t.eq('comments dropped by default', dropped.css, 'a{color:red}');
  var kept = engine.minifyCss('/* x */a{color:red}', { keepComments: true });
  t.eq('comments kept when asked', kept.css, '/* x */a{color:red}');

  var missingSemi = engine.formatCss('a{color:red}');
  t.ok('missing final semicolon added', missingSemi.css.indexOf('color:red;') !== -1);

  var unmatchedOpen = engine.formatCss('a{color:red');
  t.eq('unmatched open code', unmatchedOpen.error, 'unmatched_open');
  t.eq('unmatched open line', unmatchedOpen.line, 1);
  t.eq('unmatched open column', unmatchedOpen.column, 2);

  var unmatchedClose = engine.formatCss('a}');
  t.eq('unmatched close code', unmatchedClose.error, 'unmatched_close');
  t.eq('unmatched close column', unmatchedClose.column, 2);

  var unclosedString = engine.formatCss('.a{content:"x}');
  t.eq('unclosed string code', unclosedString.error, 'unclosed_string');

  var unclosedComment = engine.formatCss('a{color:red} /* oops');
  t.eq('unclosed comment code', unclosedComment.error, 'unclosed_comment');

  var unclosedUrl = engine.formatCss('.a{background:url(x.png}');
  t.eq('unclosed url code', unclosedUrl.error, 'unclosed_url');

  var empty = engine.formatCss('');
  t.ok('empty input ok', empty.ok === true);
  t.eq('empty input output', empty.css, '');

  var tokens = engine.tokenize('a{content:"}"}');
  t.ok('tokenizer ok', tokens.ok === true);
  t.ok('tokenizer keeps string as one token', tokens.tokens.some(function (token) {
    return token.type === 'string' && token.raw === '"}"';
  }));
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
