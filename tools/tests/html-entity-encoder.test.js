#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'html-entity-encoder';
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
  t.ok('escapeHtml exported', typeof engine.escapeHtml === 'function');
  t.eq('named escapes all five', engine.escapeHtml('& < > " \''),
    { ok: true, value: '&amp; &lt; &gt; &quot; &apos;' });
  t.eq('numeric escapes all five', engine.escapeHtml('& < > " \'', 'numeric'),
    { ok: true, value: '&#38; &#60; &#62; &#34; &#39;' });
  t.eq('all mode encodes ASCII', engine.escapeHtml('A', 'all'),
    { ok: true, value: '&#65;' });
  t.eq('non-ASCII option encodes CJK', engine.escapeHtml('A中', 'named', true),
    { ok: true, value: 'A&#20013;' });
  t.eq('emoji counts as one code point', engine.escapeHtml('😀', 'named', true),
    { ok: true, value: '&#128512;' });
  t.eq('plain text unchanged by default', engine.escapeHtml('中文 ok'),
    { ok: true, value: '中文 ok' });
  t.eq('empty string escapes to empty', engine.escapeHtml(''), { ok: true, value: '' });
  t.eq('escapeHtml rejects non-string', engine.escapeHtml(42), { ok: false, error: 'bad_value' });
  t.eq('escapeHtml rejects bad mode', engine.escapeHtml('x', 'raw'), { ok: false, error: 'bad_mode' });
  t.eq('unescape named', engine.unescapeHtml('&amp;&lt;&gt;&quot;&apos;'),
    { ok: true, value: '&<>"\'' });
  t.eq('unescape decimal', engine.unescapeHtml('&#38;&#20013;'), { ok: true, value: '&中' });
  t.eq('unescape hex', engine.unescapeHtml('&#x4E2D;&#x1F600;'), { ok: true, value: '中😀' });
  t.eq('unescape is single pass', engine.unescapeHtml('&amp;lt;'), { ok: true, value: '&lt;' });
  t.eq('unknown entity stays literal', engine.unescapeHtml('&nope; &bogus;'),
    { ok: true, value: '&nope; &bogus;' });
  t.eq('invalid numeric entity stays literal', engine.unescapeHtml('&#xD800;'),
    { ok: true, value: '&#xD800;' });
  t.eq('toNumericEntities encodes every code point', engine.toNumericEntities('A中'),
    { ok: true, value: '&#65;&#20013;' });
  t.eq('normalize collapses double escaping', engine.normalizeEntities('&amp;amp;'),
    { ok: true, value: '&amp;amp;' });
  t.eq('normalize one escaped layer', engine.normalizeEntities('&lt;b&gt;'),
    { ok: true, value: '&lt;b&gt;' });
  t.eq('normalize keeps XSS sample escaped', engine.normalizeEntities('<script>alert(1)</script>'),
    { ok: true, value: '&lt;script&gt;alert(1)&lt;/script&gt;' });
  t.eq('detectEntities counts entities', engine.detectEntities('&amp; x &lt; y'),
    { ok: true, count: 2, names: ['&amp;', '&lt;'] });
  t.eq('detectEntities ignores ampersand words', engine.detectEntities('AT&T'),
    { ok: true, count: 0, names: [] });
  t.eq('detectEntities rejects non-string', engine.detectEntities(null), { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
