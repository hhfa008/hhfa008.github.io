#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'markdown-preview';
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

function md(src) {
  var result = engine.renderMarkdown(src);
  return result.ok ? result.html : result;
}

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
  t.eq('escapeHtml escapes five characters', engine.escapeHtml('<&>"\''),
    { ok: true, value: '&lt;&amp;&gt;&quot;&#39;' });
  t.eq('escapeHtml rejects non-string', engine.escapeHtml(null), { ok: false, error: 'bad_value' });

  t.eq('heading level 1', md('# Title'), '<h1>Title</h1>');
  t.eq('heading level 6', md('###### Six'), '<h6>Six</h6>');
  t.eq('bold and italic', md('**bold** and *italic*'), '<p><strong>bold</strong> and <em>italic</em></p>');
  t.eq('inline code is protected from emphasis', md('`**x**`'), '<p><code>**x**</code></p>');
  t.eq('code fence escapes HTML', md('```js\n<b>hi</b>\n```'),
    '<pre><code class="language-js">&lt;b&gt;hi&lt;/b&gt;</code></pre>');
  t.eq('unclosed fence warns', engine.renderMarkdown('```\nx').warnings, ['unclosed_fence']);
  t.eq('unordered list', md('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  t.eq('ordered list', md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  t.eq('nested list', md('- a\n  - b\n- c'), '<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>');
  t.eq('blockquote', md('> hello'), '<blockquote><p>hello</p></blockquote>');
  t.eq('horizontal rule', md('---'), '<hr>');
  t.eq('paragraph line break', md('a\nb'), '<p>a<br>b</p>');

  var link = md('[site](https://example.com/?a=1&b=2)');
  t.ok('safe link rendered', /<a href="https:\/\/example\.com\/\?a=1&amp;b=2"/.test(link), link);
  t.ok('safe link has rel', /rel="noopener noreferrer"/.test(link), link);
  t.eq('javascript link rejected', md('[x](javascript:alert(1))'), '<p>x</p>');
  t.eq('data link rejected', md('[x](data:text/html,1)'), '<p>x</p>');
  t.eq('entity-obfuscated scheme rejected', md('[x](java&#115;cript:alert(1))'), '<p>x</p>');
  t.eq('relative link allowed', md('[x](/docs/a)'),
    '<p><a href="/docs/a" rel="noopener noreferrer" target="_blank">x</a></p>');

  var xss = md('<script>alert(1)</script>');
  t.ok('script tag escaped', xss.indexOf('<script') === -1 && xss.indexOf('&lt;script&gt;') !== -1, xss);
  var img = md('<img src=x onerror=alert(1)>');
  t.ok('image tag escaped', img.indexOf('<img') === -1 && img.indexOf('onerror=alert(1)') !== -1, img);
  t.eq('markdown image keeps alt text only', md('![alt](x.png)'), '<p>alt</p>');
  t.ok('output only whitelisted tags', (function () {
    var tags = (md('# h\n\n**b** *i* `c`\n\n- a\n\n> q\n\n[z](/x)\n\n---').match(/<\/?[a-z0-9]+/g) || []);
    var allowed = { '<h1': 1, '</h1': 1, '<p': 1, '</p': 1, '<strong': 1, '</strong': 1, '<em': 1, '</em': 1, '<code': 1, '</code': 1, '<ul': 1, '</ul': 1, '<li': 1, '</li': 1, '<blockquote': 1, '</blockquote': 1, '<a': 1, '</a': 1, '<hr': 1 };
    return tags.every(function (tag) { return allowed[tag] === 1; });
  })(), 'tag whitelist');

  t.eq('empty input renders empty', md(''), '');
  t.eq('non-string input rejected', engine.renderMarkdown(5), { ok: false, error: 'bad_value' });
  t.eq('too large input rejected', engine.renderMarkdown(new Array(200002).join('a')),
    { ok: false, error: 'too_large' });
  t.eq('safeUrl allows https', engine.safeUrl('https://a.test/?x=1&y=2'), 'https://a.test/?x=1&y=2');
  t.eq('safeUrl rejects javascript', engine.safeUrl('JaVaScRiPt:alert(1)'), null);
  t.eq('safeUrl rejects entity tricks', engine.safeUrl('java&#115;cript:alert(1)'), null);
  t.eq('safeUrl allows relative', engine.safeUrl('../a.md'), '../a.md');
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
