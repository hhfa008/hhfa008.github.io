#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'qr-code-generator';
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

var GOLDEN_HELLO_L_MASK0 = [
  '111111100101101111111',
  '100000100111001000001',
  '101110101101101011101',
  '101110100101001011101',
  '101110100010101011101',
  '100000100000101000001',
  '111111101010101111111',
  '000000001101100000000',
  '111011111111011000100',
  '000100001000001000010',
  '101000100010100011111',
  '110010001010001000010',
  '101001100110101010100',
  '000000001101010100110',
  '111111101001011100111',
  '100000101111110110000',
  '101110101001011100111',
  '101110100010001100110',
  '101110101110100010101',
  '100000101100001010010',
  '111111101100101100111'
].join('\n');

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  // --- structure -----------------------------------------------------------
  var r = engine.encodeQR('HELLO', 'L', { version: 1, mask: 0 });
  t.ok('encode HELLO ok', r.ok === true, JSON.stringify(r && r.error));
  if (!r.ok) return 'encode failed';
  t.eq('version 1 size', r.size, 21);
  t.ok('mask forced to 0', r.mask === 0);
  t.eq('golden matrix (HELLO, L, mask 0)', engine.toText(r.modules), GOLDEN_HELLO_L_MASK0);

  function finderOk(m, ox, oy) {
    for (var dy = 0; dy <= 6; dy++) {
      for (var dx = 0; dx <= 6; dx++) {
        var expected = dx === 0 || dx === 6 || dy === 0 || dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
        if (m[oy + dy][ox + dx] !== expected) return false;
      }
    }
    return true;
  }
  t.ok('top-left finder', finderOk(r.modules, 0, 0));
  t.ok('top-right finder', finderOk(r.modules, 14, 0));
  t.ok('bottom-left finder', finderOk(r.modules, 0, 14));
  t.ok('separator under top-left is light', r.modules[7][7] === false);
  t.ok('timing row alternates', r.modules[6][8] === true && r.modules[6][9] === false);
  t.ok('timing column alternates', r.modules[8][6] === true && r.modules[9][6] === false);
  t.ok('dark module present', r.modules[r.size - 8][8] === true);

  t.eq('deterministic output', engine.toText(engine.encodeQR('HELLO', 'L', { version: 1, mask: 0 }).modules), GOLDEN_HELLO_L_MASK0);

  // --- versions and boundaries --------------------------------------------
  t.eq('version 2 size', engine.encodeQR('HELLO', 'L', { version: 2 }).size, 25);
  t.eq('version 10 size', engine.encodeQR('HELLO', 'L', { version: 10 }).size, 57);
  t.eq('version 40 size', engine.encodeQR('x', 'L', { version: 40 }).size, 177);
  t.eq('17 bytes fits version 1 L', engine.encodeQR(new Array(18).join('a'), 'L').version, 1);
  t.eq('18 bytes needs version 2 L', engine.encodeQR(new Array(19).join('a'), 'L').version, 2);
  t.eq('v1 L byte capacity', engine.capacityBytes(1, 'L'), { ok: true, value: 17 });
  t.eq('v1 H byte capacity', engine.capacityBytes(1, 'H'), { ok: true, value: 7 });
  t.eq('v40 L byte capacity', engine.capacityBytes(40, 'L'), { ok: true, value: 2953 });
  t.eq('v40 M byte capacity', engine.capacityBytes(40, 'M'), { ok: true, value: 2331 });
  t.eq('v40 Q byte capacity', engine.capacityBytes(40, 'Q'), { ok: true, value: 1663 });
  t.eq('v40 H byte capacity', engine.capacityBytes(40, 'H'), { ok: true, value: 1273 });
  t.eq('chooseVersion exact fit', engine.chooseVersion(17, 0), 1);
  t.eq('chooseVersion one over', engine.chooseVersion(18, 0), 2);
  t.eq('chooseVersion max L', engine.chooseVersion(2953, 0), 40);
  t.eq('chooseVersion over max L', engine.chooseVersion(2954, 0), 0);
  t.eq('H needs larger version than L', engine.encodeQR(new Array(101).join('b'), 'H').version >= engine.encodeQR(new Array(101).join('b'), 'L').version, true);

  // --- UTF-8 and EC -------------------------------------------------------
  t.eq('utf8 e-acute', engine.utf8Encode('é'), [195, 169]);
  t.eq('utf8 CJK', engine.utf8Encode('你好'), [228, 189, 160, 229, 165, 189]);
  t.eq('utf8 emoji', engine.utf8Encode('😀'), [240, 159, 152, 128]);
  t.ok('UTF-8 text encodes', engine.encodeQR('你好，世界', 'Q').ok === true);
  t.ok('UTF-8 QR is version 2+', engine.encodeQR('你好，世界', 'Q').version >= 2);
  t.ok('EC H matrix is valid', finderOk(engine.encodeQR('EC TEST', 'H', { version: 2, mask: 5 }).modules, 0, 0));
  t.ok('different masks differ', engine.toText(engine.encodeQR('HELLO', 'L', { version: 1, mask: 0 }).modules) !==
    engine.toText(engine.encodeQR('HELLO', 'L', { version: 1, mask: 1 }).modules));

  // --- errors -------------------------------------------------------------
  t.eq('empty input', engine.encodeQR('', 'L'), { ok: false, error: 'empty_input' });
  t.eq('non-string input', engine.encodeQR(123, 'L'), { ok: false, error: 'bad_text' });
  t.eq('bad EC', engine.encodeQR('x', 'Z'), { ok: false, error: 'bad_ec' });
  t.eq('bad mask', engine.encodeQR('x', 'L', { mask: 8 }), { ok: false, error: 'bad_mask' });
  t.eq('bad version', engine.encodeQR('x', 'L', { version: 41 }), { ok: false, error: 'bad_version' });
  t.eq('too long for L', engine.encodeQR(new Array(2955).join('x'), 'L'), { ok: false, error: 'too_long' });
  t.eq('too long for H', engine.encodeQR(new Array(1275).join('x'), 'H'), { ok: false, error: 'too_long' });
  t.eq('forced version too small', engine.encodeQR(new Array(11).join('x'), 'H', { version: 1 }),
    { ok: false, error: 'too_long' });
  t.eq('bad version in capacity', engine.capacityBytes(0, 'L'), { ok: false, error: 'bad_version' });
  t.eq('bad EC in capacity', engine.capacityBytes(1, 'Z'), { ok: false, error: 'bad_ec' });
  t.eq('maxBytes M', engine.maxBytes('M'), { ok: true, value: 2331 });
  t.eq('maxBytes bad EC', engine.maxBytes('Z'), { ok: false, error: 'bad_ec' });

  // --- SVG ----------------------------------------------------------------
  var svg = engine.buildSvg(r.modules, { size: 512, quiet: 4, dark: '#14171a', light: '#ffffff', label: 'QR <test> &' });
  t.ok('SVG generated', svg.ok === true);
  t.ok('SVG has namespace', svg.value.indexOf('<svg xmlns="http://www.w3.org/2000/svg"') === 0);
  t.ok('SVG viewBox includes quiet zone', /viewBox="0 0 29 29"/.test(svg.value));
  t.ok('SVG has requested size', /width="512" height="512"/.test(svg.value));
  t.ok('SVG background rect', /<rect width="29" height="29" fill="#ffffff"\/>/.test(svg.value));
  t.ok('SVG path is dark color', svg.value.indexOf('<path fill="#14171a"') !== -1);
  t.ok('SVG label escaped', svg.value.indexOf('aria-label="QR &lt;test&gt; &amp;"') !== -1);
  var svgTransparent = engine.buildSvg(r.modules, { transparent: true });
  t.ok('transparent SVG omits background rect', svgTransparent.value.indexOf('<rect') === -1);
  t.eq('SVG rejects empty matrix', engine.buildSvg([], {}), { ok: false, error: 'bad_matrix' });
  t.eq('SVG rejects ragged matrix', engine.buildSvg([[true], [true, false]], {}), { ok: false, error: 'bad_matrix' });
  t.eq('SVG rejects bad quiet', engine.buildSvg(r.modules, { quiet: -1 }), { ok: false, error: 'bad_quiet' });
  t.eq('SVG rejects small size', engine.buildSvg(r.modules, { size: 10 }), { ok: false, error: 'bad_size' });
  t.eq('SVG rejects bad color', engine.buildSvg(r.modules, { dark: 'black' }), { ok: false, error: 'bad_color' });

  // --- colors -------------------------------------------------------------
  t.eq('parseHex short', engine.parseHex('#fff'), { ok: true, value: [255, 255, 255] });
  t.eq('parseHex long', engine.parseHex('#b93d12'), { ok: true, value: [185, 61, 18] });
  t.eq('parseHex rejects name', engine.parseHex('red'), { ok: false, error: 'bad_color' });
  t.eq('contrast black/white', engine.contrastRatio('#000000', '#ffffff'), { ok: true, value: 21 });
  t.eq('contrast white/black', engine.contrastRatio('#ffffff', '#000000'), { ok: true, value: 21 });
  t.eq('contrast same color', engine.contrastRatio('#777777', '#777777'), { ok: true, value: 1 });
  t.eq('contrast rejects bad color', engine.contrastRatio('red', '#fff'), { ok: false, error: 'bad_color' });

  // --- payload templates --------------------------------------------------
  t.eq('escapeWifi', engine.escapeWifi('a;b'), { ok: true, value: 'a\\;b' });
  t.eq('wifi payload', engine.buildWifiPayload('My Wifi', 'p;ass', 'WPA', false),
    { ok: true, value: 'WIFI:T:WPA;S:My Wifi;P:p\\;ass;;' });
  t.eq('wifi hidden', engine.buildWifiPayload('My', 'x', 'WPA', true),
    { ok: true, value: 'WIFI:T:WPA;S:My;P:x;H:true;;' });
  t.eq('wifi open', engine.buildWifiPayload('Open', '', 'nopass', false),
    { ok: true, value: 'WIFI:T:nopass;S:Open;;' });
  t.eq('wifi missing ssid', engine.buildWifiPayload('', 'x', 'WPA', false), { ok: false, error: 'bad_ssid' });
  t.eq('wifi bad security', engine.buildWifiPayload('a', 'x', 'WPA3', false), { ok: false, error: 'bad_security' });
  t.eq('tel payload', engine.buildTelPayload('+86 138-0013-8000'), { ok: true, value: 'tel:+8613800138000' });
  t.eq('tel invalid', engine.buildTelPayload('abc'), { ok: false, error: 'bad_phone' });
  t.eq('tel too long', engine.buildTelPayload('123456789012345678901'), { ok: false, error: 'bad_phone' });
  t.eq('sms payload', engine.buildSmsPayload('+86 138-0013-8000', 'Hi'), { ok: true, value: 'SMSTO:+8613800138000:Hi' });
  t.eq('sms invalid phone', engine.buildSmsPayload('abc', 'Hi'), { ok: false, error: 'bad_phone' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
