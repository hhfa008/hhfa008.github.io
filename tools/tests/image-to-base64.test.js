#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'image-to-base64';
var DIR = path.join('/Users/fa/games/tools', SLUG);
var MAX_BYTES = 120 * 1024;
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

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* asserted below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* asserted below */ }

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
  t.ok('viewport present', /name\s*=\s*["']viewport["']/i.test(html));
  t.ok('title non-empty', /<title>\s*[^<\s]/i.test(html));
  t.ok('meta description non-empty', /name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html));
  t.ok('canonical correct', new RegExp('rel\\s*=\\s*["\']canonical["\'][^>]*href\\s*=\\s*["\']' +
    EXPECTED_CANONICAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(html));
  t.ok('author is Devin', /name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('robots meta present', /name\s*=\s*["']robots["']/i.test(html));
  t.ok('inline favicon', /rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  LANGS.forEach(function (lang) {
    t.eq('one language button for ' + lang,
      (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length, 1);
  });
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 120 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var code = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage',
    !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(code));
  t.ok('engine has no clock dependency',
    !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(code));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(code));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  t.eq('base64 of Man', engine.bytesToBase64([77, 97, 110]), { ok: true, value: 'TWFu' });
  t.eq('base64 one byte', engine.bytesToBase64([77]), { ok: true, value: 'TQ==' });
  t.eq('base64 two bytes', engine.bytesToBase64([77, 97]), { ok: true, value: 'TWE=' });
  t.eq('base64 empty', engine.bytesToBase64([]), { ok: true, value: '' });
  t.eq('base64 zeros', engine.bytesToBase64([0, 0, 0]), { ok: true, value: 'AAAA' });
  t.eq('base64 high bytes', engine.bytesToBase64([255, 254, 253]), { ok: true, value: '//79' });
  t.eq('base64 accepts Uint8Array', engine.bytesToBase64(new Uint8Array([77, 97, 110])),
    { ok: true, value: 'TWFu' });
  t.eq('base64 rejects 256', engine.bytesToBase64([256]), { ok: false, error: 'bad_bytes' });
  t.eq('base64 rejects negative byte', engine.bytesToBase64([-1]), { ok: false, error: 'bad_bytes' });
  t.eq('base64 rejects fractional byte', engine.bytesToBase64([1.5]), { ok: false, error: 'bad_bytes' });
  t.eq('base64 rejects string byte', engine.bytesToBase64(['77']), { ok: false, error: 'bad_bytes' });
  t.eq('base64 rejects string input', engine.bytesToBase64('Man'), { ok: false, error: 'bad_bytes' });
  t.eq('base64 rejects null', engine.bytesToBase64(null), { ok: false, error: 'bad_bytes' });

  t.eq('decode Man', engine.base64ToBytes('TWFu'), { ok: true, value: [77, 97, 110] });
  t.eq('decode one byte', engine.base64ToBytes('TQ=='), { ok: true, value: [77] });
  t.eq('decode two bytes', engine.base64ToBytes('TWE='), { ok: true, value: [77, 97] });
  t.eq('decode empty', engine.base64ToBytes(''), { ok: true, value: [] });
  t.eq('decode rejects symbols', engine.base64ToBytes('!!!!'), { ok: false, error: 'bad_base64' });
  t.eq('decode rejects length 3', engine.base64ToBytes('TQ='), { ok: false, error: 'bad_base64' });
  t.eq('decode rejects extra padding', engine.base64ToBytes('TQ==='), { ok: false, error: 'bad_base64' });

  var all = [];
  for (var i = 0; i < 256; i++) all.push(i);
  var encoded = engine.bytesToBase64(all);
  t.ok('byte roundtrip encodes', encoded.ok === true);
  var decoded = engine.base64ToBytes(encoded.value);
  t.ok('byte roundtrip decodes', decoded.ok === true);
  t.eq('byte roundtrip values', decoded.value, all);

  t.eq('estimated 0', engine.estimatedBase64Length(0), { ok: true, value: 0 });
  t.eq('estimated 1', engine.estimatedBase64Length(1), { ok: true, value: 4 });
  t.eq('estimated 3', engine.estimatedBase64Length(3), { ok: true, value: 4 });
  t.eq('estimated 4', engine.estimatedBase64Length(4), { ok: true, value: 8 });
  t.eq('estimated rejects negative', engine.estimatedBase64Length(-1), { ok: false, error: 'bad_value' });

  t.eq('mime jpg', engine.mimeFromName('photo.JPG'), { ok: true, value: 'image/jpeg' });
  t.eq('mime jpeg', engine.mimeFromName('photo.jpeg'), { ok: true, value: 'image/jpeg' });
  t.eq('mime png', engine.mimeFromName('a.png'), { ok: true, value: 'image/png' });
  t.eq('mime webp', engine.mimeFromName('a.WEBP'), { ok: true, value: 'image/webp' });
  t.eq('mime gif rejected', engine.mimeFromName('a.gif'), { ok: false, error: 'unsupported' });
  t.eq('mime empty name rejected', engine.mimeFromName(''), { ok: false, error: 'bad_name' });

  t.eq('formatBytes 1536', engine.formatBytes(1536), '1.5 KB');
  t.eq('formatBytes 1048576', engine.formatBytes(1048576), '1.0 MB');
  t.eq('formatBytes negative', engine.formatBytes(-1), '—');

  t.eq('checkSize at limit', engine.checkSize(engine.MAX_FILE_BYTES, engine.MAX_FILE_BYTES),
    { ok: true, value: engine.MAX_FILE_BYTES });
  t.eq('checkSize over limit', engine.checkSize(engine.MAX_FILE_BYTES + 1, engine.MAX_FILE_BYTES),
    { ok: false, error: 'too_large' });
  t.eq('checkSize negative', engine.checkSize(-1, 10), { ok: false, error: 'bad_value' });

  var uri = engine.buildDataUri('image/png', 'TWFu');
  t.eq('buildDataUri', uri, { ok: true, value: 'data:image/png;base64,TWFu' });
  t.eq('buildDataUri bad mime', engine.buildDataUri('png', 'TWFu'), { ok: false, error: 'bad_mime' });
  t.eq('buildDataUri bad base64', engine.buildDataUri('image/png', '!!!!'), { ok: false, error: 'bad_base64' });

  var parsed = engine.parseDataUri('data:image/png;base64,TWFu');
  t.eq('parseDataUri mime', parsed.mime, 'image/png');
  t.eq('parseDataUri bytes', parsed.bytes, [77, 97, 110]);
  t.eq('parseDataUri base64', parsed.base64, 'TWFu');
  t.eq('parseDataUri rejects plain text', engine.parseDataUri('data:text/plain,hello'),
    { ok: false, error: 'unsupported' });
  t.eq('parseDataUri rejects bad uri', engine.parseDataUri('nope'), { ok: false, error: 'bad_uri' });

  t.eq('buildCss', engine.buildCss('data:image/png;base64,TWFu'),
    { ok: true, value: 'background-image: url("data:image/png;base64,TWFu")' });
  t.eq('buildCss rejects quote', engine.buildCss('data:image/png;base64,TWFu"'), { ok: false, error: 'bad_uri' });
  t.eq('buildHtml escapes alt', engine.buildHtml('data:image/png;base64,TWFu', '<b>&"'),
    { ok: true, value: '<img src="data:image/png;base64,TWFu" alt="&lt;b&gt;&amp;&quot;">' });
  t.eq('escapeHtml', engine.escapeHtml("a'&<>"), 'a&#39;&amp;&lt;&gt;');

  t.eq('validateImageFile empty', engine.validateImageFile(0, 'image/png'), { ok: false, error: 'empty_input' });
  t.eq('validateImageFile too large', engine.validateImageFile(engine.MAX_FILE_BYTES + 1, 'image/png'),
    { ok: false, error: 'too_large' });
  t.eq('validateImageFile unsupported', engine.validateImageFile(100, 'image/gif'),
    { ok: false, error: 'unsupported' });
  t.eq('validateImageFile ok', engine.validateImageFile(100, 'image/webp'), { ok: true, value: 100 });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
