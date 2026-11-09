'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'slug-generator';
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

function value(text, opts) {
  var r = engine.slugify(text, opts);
  return r.ok ? r.value : 'ERR:' + r.error;
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
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (x) { return x && x['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  t.ok('viewport present', /width=device-width/i.test(html));
  t.ok('canonical correct', html.indexOf('rel="canonical" href="' + EXPECTED_CANONICAL + '"') !== -1);
  t.ok('meta description non-empty', /<meta name="description" content="[^"]+"/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*rel=["']?stylesheet/i.test(html));
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var code = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage', !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b/.test(code));
  t.ok('engine has no clock dependency', !/\bDate\s*\.\s*now|\bnew\s+Date\b|\bperformance\s*\.\s*now/.test(code));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(code));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var group = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  t.eq('basic slug', value('10 Best Coffee Shops in Jakarta'), '10-best-coffee-shops-in-jakarta');
  t.eq('lowercases', value('Hello WORLD'), 'hello-world');
  t.eq('collapses consecutive separators', value('__foo---bar__  baz'), 'foo-bar-baz');
  t.eq('removes punctuation', value('Hello, world!!!'), 'hello-world');
  t.eq('removes apostrophes', value("Don't stop"), 'dont-stop');
  t.eq('keeps Chinese by default', value('你好 世界！2026'), '你好-世界-2026');
  t.eq('drops Chinese without Unicode', value('你好 世界 hello', { keepUnicode: false }), 'hello');
  t.eq('accent folding when Unicode off', value('Café déjà vu', { keepUnicode: false }), 'cafe-deja-vu');
  t.eq('keeps accents when Unicode on', value('Café déjà vu'), 'café-déjà-vu');
  t.eq('NFKC folds full-width letters', value('ＡＢＣ　１２３'), 'abc-123');
  t.eq('custom underscore separator', value('Hello World', { separator: '_' }), 'hello_world');
  t.eq('custom dot separator', value('Hello World', { separator: '.' }), 'hello.world');
  t.eq('stop words removed', value('The Lord of the Rings', { stopWords: true }), 'lord-rings');
  t.eq('all stop words gives empty', value('the of and', { stopWords: true }), '');

  t.eq('max length cuts at word boundary', value('hello world foo bar', { maxLength: 11 }), 'hello-world');
  t.eq('max length avoids splitting word', value('hello-world', { maxLength: 8 }), 'hello');
  t.eq('max length hard-cuts long word', value('abcdefghij', { maxLength: 5 }), 'abcde');
  t.eq('max length strips trailing separator', value('hello world', { maxLength: 6 }), 'hello');
  t.eq('max 0 means unlimited', value('one two three', { maxLength: 0 }), 'one-two-three');

  t.eq('empty string gives empty', value(''), '');
  t.eq('whitespace gives empty', value('   \n\t '), '');
  t.eq('punctuation only gives empty', value('!!!???...'), '');
  t.ok('result reports token count', engine.slugify('one two three').tokens === 3);
  t.eq('idempotent slug', value(value('Hello, World!')), 'hello-world');
  t.eq('idempotent with stop words', value(value('The Best of Both', { stopWords: true }), { stopWords: true }), 'best-both');

  t.eq('tokenize splits slug', engine.tokenize('Hello World'), ['hello', 'world']);
  t.eq('tokenize empty', engine.tokenize(''), []);
  t.eq('isStopWord true', engine.isStopWord('the'), true);
  t.eq('isStopWord false', engine.isStopWord('coffee'), false);

  t.eq('rejects non-string', engine.slugify(42).error, 'bad_input');
  t.eq('rejects bad separator', engine.slugify('x', { separator: '/' }).error, 'bad_separator');
  t.eq('rejects negative length', engine.slugify('x', { maxLength: -1 }).error, 'bad_length');
  t.eq('rejects fractional length', engine.slugify('x', { maxLength: 1.5 }).error, 'bad_length');
  t.eq('rejects length over 200', engine.slugify('x', { maxLength: 201 }).error, 'bad_length');

  return 'slug rules covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
