'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'case-converter';
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

  t.eq('tokenize ASCII words', engine.tokenize('user profile'), ['user', 'profile']);
  t.eq('tokenize camel boundary', engine.tokenize('getURLValue'), ['get', 'URL', 'Value']);
  t.eq('tokenize acronym word', engine.tokenize('XMLHttpRequest'), ['XML', 'Http', 'Request']);
  t.eq('tokenize underscores and hyphens', engine.tokenize('__foo-bar__ baz'), ['foo', 'bar', 'baz']);
  t.eq('tokenize keeps Chinese', engine.tokenize('你好 世界'), ['你好', '世界']);
  t.eq('tokenize empty', engine.tokenize(''), []);

  t.eq('snake basic', engine.toSnake('User Profile Settings'), 'user_profile_settings');
  t.eq('snake acronym', engine.toSnake('getURLValue'), 'get_url_value');
  t.eq('snake digits', engine.toSnake('v2 update'), 'v2_update');
  t.eq('snake Chinese', engine.toSnake('你好 世界'), '你好_世界');
  t.eq('kebab basic', engine.toKebab('User Profile'), 'user-profile');
  t.eq('constant basic', engine.toConstant('user profile'), 'USER_PROFILE');
  t.eq('camel basic', engine.toCamel('user profile settings'), 'userProfileSettings');
  t.eq('camel keeps acronym', engine.toCamel('parse URL'), 'parseURL');
  t.eq('camel digits', engine.toCamel('v2 update'), 'v2Update');
  t.eq('pascal basic', engine.toPascal('user profile settings'), 'UserProfileSettings');
  t.eq('pascal keeps acronym', engine.toPascal('URL parser'), 'URLParser');
  t.eq('title keeps minor words', engine.toTitle('the lord of the rings'), 'The Lord of the Rings');
  t.eq('title capitalizes first and last', engine.toTitle('a tale of two cities'), 'A Tale of Two Cities');
  t.eq('sentence lowercases body', engine.toSentence('HELLO WORLD. THIS IS A TEST!'), 'Hello world. This is a test!');
  t.eq('sentence keeps Chinese', engine.toSentence('你好 WORLD'), '你好 world');
  t.eq('upper keeps Chinese', engine.toUpper('abc你好'), 'ABC你好');
  t.eq('lower handles ASCII', engine.toLower('AbC'), 'abc');
  t.eq('alternating counts cased letters', engine.toAlternating('abcd'), 'aBcD');

  t.eq('snake empty', engine.toSnake(''), '');
  t.eq('camel empty', engine.toCamel(''), '');
  t.eq('title empty', engine.toTitle(''), '');
  t.eq('non-string input returns empty', engine.toSnake(null), '');

  t.eq('snake idempotent', engine.toSnake(engine.toSnake('getURLValue')), engine.toSnake('getURLValue'));
  t.eq('kebab idempotent', engine.toKebab(engine.toKebab('Some Title Here')), engine.toKebab('Some Title Here'));
  t.eq('camel idempotent', engine.toCamel(engine.toCamel('API response')), engine.toCamel('API response'));
  t.eq('pascal idempotent', engine.toPascal(engine.toPascal('api response')), engine.toPascal('api response'));

  var st = engine.stats('Hello world. 你好!\nSecond line');
  t.eq('stats chars', st.chars, 28);
  t.eq('stats words', st.words, 5);
  t.eq('stats sentences', st.sentences, 3);
  t.eq('stats lines', st.lines, 2);
  t.eq('stats empty', engine.stats(''), { chars: 0, charsNoSpace: 0, words: 0, sentences: 0, lines: 0 });

  t.eq('convert camel', engine.convert('camel', 'hello world'), { ok: true, value: 'helloWorld' });
  t.eq('convert rejects bad mode', engine.convert('nope', 'x'), { ok: false, error: 'bad_mode' });
  t.eq('convert rejects non-string', engine.convert('camel', 42), { ok: false, error: 'bad_input' });

  return 'case rules covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
