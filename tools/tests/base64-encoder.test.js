'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'base64-encoder';
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

function encode(text, opts) {
  var r = engine.encodeUtf8(text, opts);
  return r.ok ? r.value : 'ERR:' + r.error;
}
function decode(value) {
  var r = engine.decodeUtf8(value);
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

  t.eq('encode hello', encode('hello'), 'aGVsbG8=');
  t.eq('decode hello', decode('aGVsbG8='), 'hello');
  t.eq('encode Chinese', encode('中文'), '5Lit5paH');
  t.eq('Chinese round trip', decode(encode('中文')), '中文');
  t.eq('emoji round trip', decode(encode('😀👍🏽')), '😀👍🏽');
  t.eq('ZWJ emoji round trip', decode(encode('🧑‍💻')), '🧑‍💻');
  t.eq('NUL round trip', decode(encode('a\u0000b')), 'a\u0000b');
  t.eq('empty encodes to empty', encode(''), '');
  t.eq('empty decodes to empty', decode(''), '');
  t.eq('unicode byte count', engine.encodeUtf8('中文').bytes, 6);
  t.eq('emoji byte count', engine.encodeUtf8('😀').bytes, 4);

  t.eq('URL-safe replaces + and /', encode('??>>', { urlSafe: true }), 'Pz8-Pg');
  t.ok('URL-safe has no + / =', !/[+/=]/.test(encode('??>>', { urlSafe: true })));
  t.eq('URL-safe round trip', decode(encode('??>>', { urlSafe: true })), '??>>');
  t.eq('toUrlSafe mapping', engine.toUrlSafe('a+b/c=='), 'a-b_c');
  t.eq('fromUrlSafe mapping', engine.fromUrlSafe('a-b_c'), 'a+b/c===');
  t.eq('fromUrlSafe pads to multiple of 4', engine.fromUrlSafe('aGVsbG8').length % 4, 0);
  t.eq('base64ToBytes accepts unpadded', engine.decodeUtf8('aGVsbG8').value, 'hello');
  t.eq('decode ignores newlines', decode('aGVs\nbG8=\n'), 'hello');
  t.eq('decode ignores spaces and tabs', decode('aGVs\t bG8='), 'hello');
  t.eq('decode accepts URL-safe chars', decode('Pz8-Pg'), '??>>');

  var bytes = [0, 255, 128, 1, 2, 3];
  t.eq('bytesToBase64 known', engine.bytesToBase64(new Uint8Array([0, 255])), 'AP8=');
  t.eq('bytesToBase64 then decode bytes', engine.bytesToBase64(new Uint8Array(bytes)),
    'AP+AAQID');
  t.eq('base64ToBytes round trip', engine.base64ToBytes(engine.bytesToBase64(new Uint8Array(bytes))), bytes);
  t.eq('utf8Encode Chinese bytes', engine.utf8Encode('中'), [0xE4, 0xB8, 0xAD]);
  t.eq('utf8Decode Chinese bytes', engine.utf8Decode([0xE4, 0xB8, 0xAD]), '中');
  t.eq('lone surrogate becomes replacement', decode(encode('\uD800')), '�');

  t.eq('invalid characters rejected', engine.decodeUtf8('!!!!').error, 'bad_base64');
  t.eq('length mod 4 = 1 rejected', engine.decodeUtf8('abcde').error, 'bad_base64');
  t.eq('too much padding rejected', engine.decodeUtf8('aGVsbG8==').error, 'bad_base64');
  t.eq('padding in the middle rejected', engine.decodeUtf8('ab=c').error, 'bad_base64');
  t.eq('non-base64 character rejected', engine.decodeUtf8('中文').error, 'bad_base64');
  t.eq('invalid UTF-8 rejected', engine.decodeUtf8('//8=').error, 'bad_utf8');
  t.eq('lone continuation byte rejected', engine.decodeUtf8('gA==').error, 'bad_utf8');
  t.eq('non-string decode rejected', engine.decodeUtf8(42).error, 'bad_input');
  t.eq('non-string encode rejected', engine.encodeUtf8(42).error, 'bad_input');

  var encoded = encode('The quick brown fox jumps over the lazy dog');
  t.eq('encoded alphabet only', /^[A-Za-z0-9+/]+={0,2}$/.test(encoded), true);
  t.eq('long text round trip', decode(encoded), 'The quick brown fox jumps over the lazy dog');

  return 'UTF-8, URL-safe and invalid input covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
