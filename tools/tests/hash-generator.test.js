'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');
var webcrypto = require('node:crypto').webcrypto;

var SLUG = 'hash-generator';
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
  t.ok('engine uses subtle.digest', code.indexOf('subtle.digest') !== -1);
  return (bytes / 1024).toFixed(1) + ' KB';
});

(async function () {
  var known = {};
  var bad = {};

  try {
    var all = await Promise.all([
      engine.hashText('abc', 'SHA-1', webcrypto),
      engine.hashText('abc', 'SHA-256', webcrypto),
      engine.hashText('abc', 'SHA-384', webcrypto),
      engine.hashText('abc', 'SHA-512', webcrypto),
      engine.hashText('', 'SHA-256', webcrypto),
      engine.hashText('中文😀', 'SHA-256', webcrypto),
      engine.hashText('abc', 'SHA-256', webcrypto),
      engine.hashText('abc', 'MD5', webcrypto),
      engine.hashText(42, 'SHA-256', webcrypto),
      engine.hashText('abc', 'SHA-256', null)
    ]);
    known.sha1 = all[0];
    known.sha256 = all[1];
    known.sha384 = all[2];
    known.sha512 = all[3];
    known.empty = all[4];
    known.unicode = all[5];
    known.again = all[6];
    bad.algorithm = all[7];
    bad.input = all[8];
    bad.crypto = all[9];
  } catch (e) {
    known.error = e;
  }

  var group = t.group('engine', function () {
    t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
    if (!engine) return 'engine missing';
    t.ok('hashes resolved', !known.error && !!known.sha256 && known.sha256.ok,
      known.error ? known.error.message : '');
    if (!known.sha256 || !known.sha256.ok) return 'hash resolution failed';

    t.eq('SHA-1("abc") known value', known.sha1.hex, 'a9993e364706816aba3e25717850c26c9cd0d89d');
    t.eq('SHA-256("abc") known value', known.sha256.hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    t.eq('SHA-384("abc") known value', known.sha384.hex,
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    t.eq('SHA-512("abc") known value', known.sha512.hex,
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
    t.eq('empty string SHA-256 known value', known.empty.hex,
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    t.eq('SHA-1 hex length', known.sha1.hex.length, 40);
    t.eq('SHA-256 hex length', known.sha256.hex.length, 64);
    t.eq('SHA-384 hex length', known.sha384.hex.length, 96);
    t.eq('SHA-512 hex length', known.sha512.hex.length, 128);
    t.eq('SHA-1 byte length', known.sha1.bytes, 20);
    t.eq('SHA-256 byte length', known.sha256.bytes, 32);
    t.eq('SHA-384 digest bytes', known.sha384.bytes, 48);
    t.eq('SHA-256 Base64 length', known.sha256.base64.length, 44);
    t.eq('SHA-256 Base64 known value', known.sha256.base64, 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    t.eq('hash result names algorithm', known.sha256.algorithm, 'SHA-256');
    t.ok('unicode input hashes differently', known.unicode.hex !== known.sha256.hex);
    t.eq('same input deterministic', known.again.hex, known.sha256.hex);

    t.eq('byteLength abc', engine.byteLength('abc'), 3);
    t.eq('byteLength Chinese', engine.byteLength('中'), 3);
    t.eq('byteLength emoji', engine.byteLength('😀'), 4);
    t.eq('byteLength non-string', engine.byteLength(42), 0);
    t.eq('bytesToHex', engine.bytesToHex(new Uint8Array([0, 15, 255])), '000fff');
    t.eq('bytesToBase64', engine.bytesToBase64(new Uint8Array([0, 255])), 'AP8=');
    t.eq('bytesToBase64 empty', engine.bytesToBase64(new Uint8Array([])), '');

    t.eq('normalizeHex lowercases', engine.normalizeHex('AA BB', false).value, 'aabb');
    t.eq('normalizeHex uppercases', engine.normalizeHex('aa bb', true).value, 'AABB');
    t.eq('normalizeHex rejects non-hex', engine.normalizeHex('zz').error, 'bad_hex');
    t.eq('normalizeHex rejects odd length', engine.normalizeHex('abc').error, 'bad_hex');
    t.eq('normalizeHex rejects non-string', engine.normalizeHex(12).error, 'bad_hex');

    t.eq('compareHashes equal after normalization', engine.compareHashes('AA BB', 'aabb'), { ok: true, equal: true });
    t.eq('compareHashes detects difference', engine.compareHashes('aaaa', 'bbbb'), { ok: true, equal: false });
    t.eq('compareHashes rejects empty', engine.compareHashes('', 'aa').error, 'empty');
    t.eq('compareHashes rejects non-string', engine.compareHashes(1, 'aa').error, 'bad_input');

    t.eq('isAlgorithm accepts SHA-256', engine.isAlgorithm('SHA-256'), true);
    t.eq('isAlgorithm rejects MD5', engine.isAlgorithm('MD5'), false);
    t.eq('rejects unsupported algorithm', bad.algorithm.error, 'bad_algo');
    t.eq('rejects non-string input', bad.input.error, 'bad_input');
    t.eq('rejects missing crypto', bad.crypto.error, 'no_crypto');

    return 'known digests, encodings and compare covered';
  });

  t.group('engine coverage', function () {
    var total = group.pass + group.fail;
    t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
    return total + ' assertions';
  });

  t.done();
})();
