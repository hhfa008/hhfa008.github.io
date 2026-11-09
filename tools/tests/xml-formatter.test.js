#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'xml-formatter';
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

  var formatted = engine.formatXml('<root><a>1</a><b x="1"/></root>', { indent: 2 });
  t.ok('format ok', formatted.ok === true);
  t.eq('nested indentation', formatted.xml,
    '<root>\n  <a>1</a>\n  <b x="1"/>\n</root>');
  t.eq('element count', formatted.elements, 3);
  t.eq('line count', formatted.lines, 4);

  var four = engine.formatXml('<r><a/></r>', { indent: 4 });
  t.eq('4-space indent', four.xml, '<r>\n    <a/>\n</r>');

  var attrs = engine.formatXml('<a href="x?y=1&amp;z=2" title="hello world"/>', {});
  t.eq('attributes preserved', attrs.xml, '<a href="x?y=1&amp;z=2" title="hello world"/>');

  var declaration = engine.formatXml('<?xml version="1.0"?><r/>', {});
  t.eq('declaration preserved', declaration.xml, '<?xml version="1.0"?>\n<r/>');

  var withComment = engine.formatXml('<r><!-- keep me --><a/></r>', {});
  t.eq('comment kept and indented', withComment.xml, '<r>\n  <!-- keep me -->\n  <a/>\n</r>');

  var cdataText = '<![CDATA[ if (a < b && c > d) { run(); } ]]>';
  var withCdata = engine.formatXml('<r><s>' + cdataText + '</s></r>', {});
  t.ok('CDATA preserved verbatim', withCdata.ok && withCdata.xml.indexOf(cdataText) !== -1);

  var textOnly = engine.formatXml('<r><a> hi </a></r>', {});
  t.eq('text-only element inline', textOnly.xml, '<r>\n  <a>hi</a>\n</r>');

  var emptyElement = engine.formatXml('<r><a></a></r>', {});
  t.eq('empty element inline', emptyElement.xml, '<r>\n  <a></a>\n</r>');

  var mismatched = engine.formatXml('<a>\n  <b></a>', {});
  t.eq('mismatched error code', mismatched.error, 'mismatched_tag');
  t.eq('mismatched expected', mismatched.expected, 'b');
  t.eq('mismatched got', mismatched.got, 'a');
  t.eq('mismatched line', mismatched.line, 2);
  t.eq('mismatched column', mismatched.column, 6);

  var unclosed = engine.formatXml('<a><b>', {});
  t.eq('unclosed tag code', unclosed.error, 'unclosed_tag');
  t.eq('unclosed tag name', unclosed.name, 'b');
  t.eq('unclosed tag column', unclosed.column, 4);

  var strayClose = engine.formatXml('</a>', {});
  t.eq('stray close code', strayClose.error, 'unexpected_close');
  t.eq('stray close name', strayClose.name, 'a');

  var badComment = engine.parse('<a><!-- oops</a>');
  t.eq('unclosed comment code', badComment.error, 'unclosed_comment');

  var badCdata = engine.parse('<a><![CDATA[oops</a>');
  t.eq('unclosed cdata code', badCdata.error, 'unclosed_cdata');

  t.eq('empty input code', engine.parse('   ').error, 'empty_input');

  var minified = engine.minifyXml('<r>\n  <a> x </a>\n  <b/>\n</r>', { keepComments: false });
  t.eq('minify removes inter-tag whitespace', minified.xml, '<r><a> x </a><b/></r>');

  var minifiedComments = engine.minifyXml('<r><!-- c --><a/></r>', { keepComments: true });
  t.eq('minify keeps comments when asked', minifiedComments.xml, '<r><!-- c --><a/></r>');
  var droppedComments = engine.minifyXml('<r><!-- c --><a/></r>', { keepComments: false });
  t.eq('minify drops comments when asked', droppedComments.xml, '<r><a/></r>');

  var minifiedCdata = engine.minifyXml('<r><s><![CDATA[a < b]]></s></r>', {});
  t.eq('minify keeps CDATA', minifiedCdata.xml, '<r><s><![CDATA[a < b]]></s></r>');

  var reparse = engine.parse(minified.xml);
  t.ok('minified output parses again', reparse.ok === true);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
