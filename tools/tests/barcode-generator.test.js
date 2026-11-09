#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'barcode-generator';
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

var ABC_BITS = '11010010000101000110001000101100010001000110110011011001100011101011';
var HELLO_BITS = '110100100001100010100010001101000100011011101000110111010001110110110001010001100011101011';

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  // --- symbol table --------------------------------------------------------
  t.eq('pattern 0', engine.pattern(0), { ok: true, value: '212222' });
  t.eq('pattern 33', engine.pattern(33), { ok: true, value: '111323' });
  t.eq('pattern start B', engine.pattern(104), { ok: true, value: '211214' });
  t.eq('pattern stop', engine.pattern(106), { ok: true, value: '2331112' });
  t.eq('pattern 102', engine.pattern(102), { ok: true, value: '411131' });
  t.eq('pattern rejects 107', engine.pattern(107), { ok: false, error: 'bad_pattern' });
  t.eq('pattern rejects fraction', engine.pattern(1.5), { ok: false, error: 'bad_pattern' });

  // --- checksum ------------------------------------------------------------
  t.eq('checksum ABC values', engine.checksum([33, 34, 35]), { ok: true, value: 1 });
  t.eq('checksum AB values', engine.checksum([33, 34]), { ok: true, value: 102 });
  t.eq('checksum single A', engine.checksum([33]), { ok: true, value: 34 });
  t.eq('checksum space', engine.checksum([0]), { ok: true, value: 1 });
  t.eq('checksum tilde', engine.checksum([94]), { ok: true, value: 95 });
  t.eq('checksum empty list', engine.checksum([]), { ok: true, value: 1 });
  t.eq('checksum rejects 95', engine.checksum([95]), { ok: false, error: 'bad_values' });
  t.eq('checksum rejects fraction', engine.checksum([1.5]), { ok: false, error: 'bad_values' });
  t.eq('checksum rejects non-array', engine.checksum('x'), { ok: false, error: 'bad_values' });

  // --- encoding ------------------------------------------------------------
  var abc = engine.encodeCode128('ABC');
  t.ok('encode ABC ok', abc.ok === true, abc.error || '');
  if (abc.ok) {
    t.eq('ABC values', abc.values, [104, 33, 34, 35, 1, 106]);
    t.eq('ABC checksum', abc.checksum, 1);
    t.eq('ABC modules', abc.modules, 68);
    t.eq('ABC symbols', abc.symbols, 6);
    t.eq('ABC chars', abc.chars, 3);
    t.eq('ABC bit string matches reference', abc.bits, ABC_BITS);
    t.eq('ABC module formula', abc.modules, 11 * (3 + 2) + 13);
    t.eq('bits start with a bar', abc.bits.charAt(0), '1');
    t.eq('bits end with the stop bar', abc.bits.charAt(abc.bits.length - 1), '1');
    t.ok('bits are binary only', /^[01]+$/.test(abc.bits));
  }
  var hello = engine.encodeCode128('HELLO');
  t.eq('HELLO checksum', hello.checksum, 40);
  t.eq('HELLO modules', hello.modules, 90);
  t.eq('HELLO bit string matches reference', hello.bits, HELLO_BITS);
  t.eq('HELLO module formula', hello.modules, 11 * (5 + 2) + 13);

  var a1b2 = engine.encodeCode128('A1B2');
  t.eq('A1B2 checksum', a1b2.checksum, 36);
  t.eq('A1B2 modules', a1b2.modules, 11 * (4 + 2) + 13);
  t.eq('single A checksum', engine.encodeCode128('A').checksum, 34);
  t.eq('single A modules', engine.encodeCode128('A').modules, 46);
  t.eq('space checksum', engine.encodeCode128(' ').checksum, 1);
  t.eq('space allowed', engine.encodeCode128(' ').ok, true);
  t.eq('tilde checksum', engine.encodeCode128('~').checksum, 95);
  t.eq('tilde allowed', engine.encodeCode128('~').ok, true);
  t.eq('80 chars allowed', engine.encodeCode128(new Array(81).join('A')).ok, true);
  t.eq('80 char modules', engine.encodeCode128(new Array(81).join('A')).modules, 11 * 82 + 13);

  // --- invalid input -------------------------------------------------------
  t.eq('empty input', engine.encodeCode128(''), { ok: false, error: 'empty_input' });
  t.eq('non-string input', engine.encodeCode128(123), { ok: false, error: 'bad_text' });
  t.eq('81 chars too long', engine.encodeCode128(new Array(82).join('A')), { ok: false, error: 'too_long' });
  t.eq('CJK rejected at 0', engine.encodeCode128('中'), { ok: false, error: 'bad_char', index: 0 });
  t.eq('CJK rejected at 1', engine.encodeCode128('A中'), { ok: false, error: 'bad_char', index: 1 });
  t.eq('newline rejected', engine.encodeCode128('A\nB'), { ok: false, error: 'bad_char', index: 1 });
  t.eq('DEL rejected', engine.encodeCode128(String.fromCharCode(127)), { ok: false, error: 'bad_char', index: 0 });

  // --- SVG -----------------------------------------------------------------
  var svg = engine.buildBarcodeSvg(ABC_BITS, {
    moduleWidth: 3,
    quiet: 10,
    dark: '#000000',
    light: '#ffffff',
    text: 'ABC',
    label: 'Barcode <&>'
  });
  t.ok('SVG generated', svg.ok === true, svg.error || '');
  if (svg.ok) {
    t.ok('SVG starts with namespace', svg.value.indexOf('<svg xmlns="http://www.w3.org/2000/svg"') === 0);
    t.ok('SVG width uses modules and scale', /width="264" height="140"/.test(svg.value));
    t.ok('SVG viewBox includes quiet zone', /viewBox="0 0 88 140"/.test(svg.value));
    t.ok('SVG background rect', /<rect width="88" height="140" fill="#ffffff"\/>/.test(svg.value));
    t.ok('SVG bar group present', svg.value.indexOf('<g fill="#000000">') !== -1);
    t.ok('SVG human-readable text', svg.value.indexOf('>ABC</text>') !== -1);
    t.ok('SVG label escaped', svg.value.indexOf('aria-label="Barcode &lt;&amp;&gt;"') !== -1);
  }
  var noText = engine.buildBarcodeSvg(ABC_BITS, { showText: false, text: 'ABC' });
  t.ok('SVG can omit text', noText.ok && noText.value.indexOf('<text') === -1);
  var escaped = engine.buildBarcodeSvg(ABC_BITS, { text: '<A&>' });
  t.ok('SVG text escaped', escaped.ok && escaped.value.indexOf('&lt;A&amp;&gt;') !== -1);
  t.eq('SVG rejects empty bits', engine.buildBarcodeSvg('', {}), { ok: false, error: 'bad_bits' });
  t.eq('SVG rejects non-binary bits', engine.buildBarcodeSvg('0102', {}), { ok: false, error: 'bad_bits' });
  t.eq('SVG rejects module width 0', engine.buildBarcodeSvg(ABC_BITS, { moduleWidth: 0 }),
    { ok: false, error: 'bad_module_width' });
  t.eq('SVG rejects module width 21', engine.buildBarcodeSvg(ABC_BITS, { moduleWidth: 21 }),
    { ok: false, error: 'bad_module_width' });
  t.eq('SVG rejects negative quiet', engine.buildBarcodeSvg(ABC_BITS, { quiet: -1 }),
    { ok: false, error: 'bad_quiet' });
  t.eq('SVG rejects bad color', engine.buildBarcodeSvg(ABC_BITS, { dark: 'black' }),
    { ok: false, error: 'bad_color' });

  // --- names and colors ----------------------------------------------------
  t.eq('parseHex short', engine.parseHex('#fff'), { ok: true, value: '#fff' });
  t.eq('parseHex invalid', engine.parseHex('black'), { ok: false, error: 'bad_color' });
  t.eq('safeName spaces', engine.safeName('ABC 123'), { ok: true, value: 'ABC-123' });
  t.eq('safeName slash', engine.safeName('a/b'), { ok: true, value: 'a-b' });
  t.eq('safeName CJK fallback', engine.safeName('中文!!'), { ok: true, value: 'barcode' });
  t.eq('safeName empty', engine.safeName(''), { ok: false, error: 'bad_name' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
