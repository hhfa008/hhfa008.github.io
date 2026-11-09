'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'uuid-generator';
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
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
  t.ok('page uses crypto.getRandomValues', html.indexOf('crypto.getRandomValues') !== -1);
  return (bytes / 1024).toFixed(1) + ' KB';
});

var group = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var one = engine.uuidV4(lib.mulberry32(1));
  t.ok('uuidV4 succeeds', one.ok);
  t.ok('uuid matches v4 format', UUID_RE.test(one.value), one.value);
  t.eq('version digit is 4', one.value.charAt(14), '4');
  t.ok('variant digit is 8/9/a/b', '89ab'.indexOf(one.value.charAt(19)) !== -1, one.value);
  t.eq('uuid length with hyphens', one.value.length, 36);
  t.eq('hyphen positions', [8, 13, 18, 23].map(function (i) { return one.value.charAt(i); }).join(''), '----');

  var deterministicA = engine.uuidV4(lib.mulberry32(99)).value;
  var deterministicB = engine.uuidV4(lib.mulberry32(99)).value;
  t.eq('same rng seed gives same uuid', deterministicA, deterministicB);
  t.ok('different rng seed gives another uuid', deterministicA !== engine.uuidV4(lib.mulberry32(100)).value);

  var hundred = engine.batch(100, {}, lib.mulberry32(7));
  t.ok('batch of 100 succeeds', hundred.ok);
  t.eq('batch reports 100 values', hundred.values.length, 100);
  t.eq('batch values are unique', new Set(hundred.values).size, 100);
  t.ok('every batch value is v4', hundred.values.every(function (v) { return UUID_RE.test(v); }));

  var twenty = engine.batch(20, {}, lib.mulberry32(11)).values;
  t.ok('all version digits are 4', twenty.every(function (v) { return v.charAt(14) === '4'; }));
  t.ok('all variant digits valid', twenty.every(function (v) { return '89ab'.indexOf(v.charAt(19)) !== -1; }));

  var upper = engine.batch(2, { uppercase: true }, lib.mulberry32(3)).values;
  t.ok('uppercase output', upper.every(function (v) { return /^[0-9A-F-]+$/.test(v); }));
  var plain = engine.batch(2, { hyphens: false }, lib.mulberry32(3)).values;
  t.ok('hyphenless length is 32', plain.every(function (v) { return v.length === 32; }));
  t.ok('hyphenless output is hex', plain.every(function (v) { return /^[0-9a-f]{32}$/.test(v); }));
  t.ok('both formats describe same values',
    upper[0].toLowerCase().replace(/-/g, '') === plain[0]);

  t.eq('formatUuid validates input', engine.formatUuid('nope').error, 'bad_uuid');
  t.eq('formatUuid accepts 32 hex', engine.formatUuid('a00087fbf7474cb8adfe747d23673f27').value,
    'a00087fb-f747-4cb8-adfe-747d23673f27');
  t.eq('isUuid accepts standard', engine.isUuid(one.value), true);
  t.eq('isUuid accepts 32 hex', engine.isUuid(one.value.replace(/-/g, '')), true);
  t.eq('isUuid rejects junk', engine.isUuid('not-a-uuid'), false);
  t.eq('isUuid rejects numbers', engine.isUuid(123), false);

  t.eq('uuidV4 rejects missing rng', engine.uuidV4(null).error, 'bad_rng');
  t.eq('uuidV4 rejects rng output 1', engine.uuidV4(function () { return 1; }).error, 'bad_rng');
  t.eq('uuidV4 rejects negative rng', engine.uuidV4(function () { return -0.1; }).error, 'bad_rng');
  t.eq('uuidV4 rejects string rng', engine.uuidV4('random').error, 'bad_rng');

  [0, 101, 1.5, NaN, Infinity, '5'].forEach(function (n) {
    t.eq('batch rejects count ' + String(n), engine.batch(n, {}, lib.mulberry32(1)).error, 'bad_count');
  });
  t.eq('batch rejects missing rng', engine.batch(3, {}, null).error, 'bad_rng');

  return 'format, bits, uniqueness and batch covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
