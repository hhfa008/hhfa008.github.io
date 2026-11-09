#!/usr/bin/env node
'use strict';

/*
 * TEST_TEMPLATE.js — copy to /Users/fa/games/tools/tests/<slug>.test.js
 *
 *   1. Set SLUG below.
 *   2. Replace /* ENGINE_ASSERTIONS *\/ with at least 10 real assertions.
 *   3. Optionally add UI/contract assertions in the marked group.
 *   4. Run: node /Users/fa/games/tools/tests/<slug>.test.js
 *
 * Output ends with: RESULT: N passed, M failed
 * Process exit code is 1 when anything failed.
 *
 * Rules enforced here:
 *   - zh / en / id dictionaries expose exactly the same non-empty keys
 *   - every data-i / data-i-ph / data-i-aria key exists in all three dictionaries
 *   - no external requests or remote assets
 *   - exactly three JSON-LD blocks (SoftwareApplication, FAQPage, BreadcrumbList)
 *   - canonical, viewport, title, meta description present
 *   - engine has no DOM / clock / storage / Math.random dependency
 *   - file is <= 90 KB
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

// ---------------------------------------------------------------------------
// EDIT ME
// ---------------------------------------------------------------------------
var SLUG = 'color-palette-generator';
// ---------------------------------------------------------------------------

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

var html;
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try {
  html = lib.page(DIR);
} catch (e) {
  console.error('无法读取 ' + path.join(DIR, 'index.html') + ': ' + e.message);
  process.exit(1);
}

try {
  engine = lib.evalScript(html, 'engine', 'ToolEngine');
} catch (e) {
  /* asserted in the engine group below */
}
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) {
  /* asserted in the i18n group below */
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// static contract
// ---------------------------------------------------------------------------

t.group('static', function () {
  var refs = lib.externalRefs(html);
  t.eq('externalRefs is empty', refs, []);

  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  var types = jsonLd.map(function (item) { return item && item['@type']; }).sort();
  t.eq('JSON-LD types', types, ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  var faqPage = jsonLd.filter(function (item) { return item && item['@type'] === 'FAQPage'; })[0];
  t.ok('FAQPage has 3+ questions', !!faqPage && Array.isArray(faqPage.mainEntity) && faqPage.mainEntity.length >= 3);
  t.ok('FAQPage entries have answers', !!faqPage && faqPage.mainEntity.every(function (item) {
    return item && item.name && item.acceptedAnswer && item.acceptedAnswer.text;
  }));

  t.ok('viewport present', /<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html));
  var title = html.match(/<title>\s*([^<]*?)\s*<\/title>/i);
  t.ok('title non-empty', !!(title && title[1].trim()));
  t.ok('meta description non-empty', /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']+)["']/i.test(html));
  t.ok('canonical correct', (function () {
    var match = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
    return !!match && match[1] === EXPECTED_CANONICAL;
  })());
  t.ok('author is Devin', /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('robots meta present', /<meta[^>]+name\s*=\s*["']robots["']/i.test(html));
  t.ok('inline data URI favicon', /<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));

  LANGS.forEach(function (lang) {
    var count = (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length;
    t.eq('one language button for ' + lang, count, 1);
  });

  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');

  var engineCode = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage',
    !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(engineCode));
  t.ok('engine has no clock dependency',
    !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(engineCode));
  t.ok('engine does not use Math.random',
    !/\bMath\s*\.\s*random\s*\(/.test(engineCode));

  return (bytes / 1024).toFixed(1) + ' KB';
});

// ---------------------------------------------------------------------------
// engine correctness — fill this with at least 10 real assertions
// ---------------------------------------------------------------------------

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  // --- hex parsing and conversion -----------------------------------------
  t.eq('normalizeHex expands #ABC', engine.normalizeHex('#ABC'), { ok: true, value: '#aabbcc' });
  t.eq('normalizeHex accepts no hash', engine.normalizeHex('b93d12'), { ok: true, value: '#b93d12' });
  t.eq('normalizeHex rejects 5 digits', engine.normalizeHex('#b93d1'), { ok: false, error: 'bad_hex' });
  t.eq('normalizeHex rejects numbers', engine.normalizeHex(123), { ok: false, error: 'bad_hex' });
  t.eq('hexToRgb orange', engine.hexToRgb('#ff8000'), { ok: true, value: { r: 255, g: 128, b: 0 } });
  t.eq('rgbToHex round trip', engine.rgbToHex(255, 128, 0), { ok: true, value: '#ff8000' });
  t.eq('rgbToHex rejects 256', engine.rgbToHex(256, 0, 0), { ok: false, error: 'range' });
  t.eq('rgbToHex rounds channels', engine.rgbToHex(254.6, 0, 0), { ok: true, value: '#ff0000' });
  t.eq('rgbToHsl red', engine.rgbToHsl({ r: 255, g: 0, b: 0 }), { ok: true, value: { h: 0, s: 100, l: 50 } });
  t.eq('rgbToHsl blue hue 240', engine.rgbToHsl({ r: 0, g: 0, b: 255 }).value.h, 240);
  t.eq('hslToRgb green', engine.hslToRgb(120, 100, 50), { ok: true, value: { r: 0, g: 255, b: 0 } });
  t.eq('hslToRgb wraps negative hue', engine.hslToRgb(-240, 100, 50), { ok: true, value: { r: 0, g: 255, b: 0 } });

  // --- harmonies ----------------------------------------------------------
  var comp = engine.harmony('#ff0000', 'complementary');
  t.ok('complementary ok', comp.ok);
  t.eq('complementary emits 5 colors', comp.value.length, 5);
  t.near('complementary third color is cyan', engine.rgbToHsl(engine.hexToRgb(comp.value[2]).value).value.h, 180, 1);
  var analog = engine.harmony('#ff0000', 'analogous');
  t.eq('analogous hue wraps to 300', engine.rgbToHsl(engine.hexToRgb(analog.value[0]).value).value.h, 300, 1);
  t.eq('analogous last hue is 60', engine.rgbToHsl(engine.hexToRgb(analog.value[4]).value).value.h, 60, 1);
  var triad = engine.harmony('#ff0000', 'triadic');
  t.near('triadic second hue 120', engine.rgbToHsl(engine.hexToRgb(triad.value[1]).value).value.h, 120, 1);
  t.near('triadic third hue 240', engine.rgbToHsl(engine.hexToRgb(triad.value[2]).value).value.h, 240, 1);
  var mono = engine.harmony('#336699', 'monochromatic');
  t.eq('monochromatic 5 colors', mono.value.length, 5);
  t.ok('monochromatic lightness descends',
    engine.rgbToHsl(engine.hexToRgb(mono.value[0]).value).value.l >
    engine.rgbToHsl(engine.hexToRgb(mono.value[4]).value).value.l);
  var all = engine.harmonies('#b93d12');
  t.ok('harmonies returns all five modes', all.ok && Object.keys(all.value).length === 5 &&
    all.value.tetradic.length === 5);
  t.eq('harmonies rejects bad hex', engine.harmonies('nope'), { ok: false, error: 'bad_hex' });
  t.eq('harmony rejects bad mode', engine.harmony('#fff', 'square'), { ok: false, error: 'bad_mode' });

  // --- gradients ----------------------------------------------------------
  var grad = engine.shades('#336699', 5);
  t.eq('shades emits requested count', grad.value.length, 5);
  var gl = grad.value.map(function (hex) {
    return engine.rgbToHsl(engine.hexToRgb(hex).value).value.l;
  });
  t.ok('shades lightness strictly descends', gl.every(function (l, i) { return i === 0 || l < gl[i - 1]; }));
  t.eq('shades rejects count 1', engine.shades('#336699', 1), { ok: false, error: 'bad_count' });
  t.eq('shades rejects count 22', engine.shades('#336699', 22), { ok: false, error: 'bad_count' });
  t.eq('shades rejects fractional count', engine.shades('#336699', 5.5), { ok: false, error: 'bad_count' });
  t.eq('shades defaults to 10', engine.shades('#336699').value.length, 10);

  // --- export -------------------------------------------------------------
  var css = engine.toCssVars(['#ff0000', '#00ff00'], 'brand');
  t.ok('toCssVars opens :root', css.ok && css.value.indexOf(':root {') === 0);
  t.ok('toCssVars names variables', css.value.indexOf('--brand-1: #ff0000;') !== -1 &&
    css.value.indexOf('--brand-2: #00ff00;') !== -1);
  t.eq('toCssVars rejects empty list', engine.toCssVars([], 'x'), { ok: false, error: 'bad_value' });
  t.eq('toCssVars rejects bad color', engine.toCssVars(['zzz'], 'x'), { ok: false, error: 'bad_hex' });
  t.eq('toCssVars rejects bad prefix', engine.toCssVars(['#fff'], '1bad'), { ok: false, error: 'bad_prefix' });
  t.eq('joinHex normalizes', engine.joinHex(['#fff', '#000']), { ok: true, value: '#ffffff, #000000' });
  t.ok('toJson produces parseable output', (function () {
    var json = engine.toJson({ base: '#fff', colors: ['#ffffff'] });
    return json.ok && JSON.parse(json.value).base === '#fff';
  })());
  t.eq('toJson rejects null', engine.toJson(null), { ok: false, error: 'bad_value' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10,
    'found ' + total + '; replace /* ENGINE_ASSERTIONS */ in TEST_TEMPLATE.js');
  return total + ' assertions';
});

// ---------------------------------------------------------------------------
// Optional: add UI / contract assertions here.
// ---------------------------------------------------------------------------

t.done();
