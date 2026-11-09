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
var SLUG = 'box-shadow-generator';
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

  // --- color helpers ------------------------------------------------------
  t.eq('colorToRgba black 0.25', engine.colorToRgba('#000', 0.25), { ok: true, value: 'rgba(0, 0, 0, 0.25)' });
  t.eq('colorToRgba full color', engine.colorToRgba('#b93d12', 1), { ok: true, value: 'rgba(185, 61, 18, 1)' });
  t.eq('colorToRgba alpha 0', engine.colorToRgba('#ffffff', 0), { ok: true, value: 'rgba(255, 255, 255, 0)' });
  t.eq('colorToRgba rounds alpha to 2 places', engine.colorToRgba('#000', 0.333).value, 'rgba(0, 0, 0, 0.33)');
  t.eq('colorToRgba rejects alpha above 1', engine.colorToRgba('#000', 1.1), { ok: false, error: 'bad_alpha' });
  t.eq('colorToRgba rejects negative alpha', engine.colorToRgba('#000', -0.1), { ok: false, error: 'bad_alpha' });
  t.eq('colorToRgba rejects bad color', engine.colorToRgba('red', 1), { ok: false, error: 'bad_color' });

  // --- layer normalization ------------------------------------------------
  var norm = engine.normalizeLayer({ x: 0.004, y: -4, blur: 12.345, spread: -2.345, color: '#ABC', alpha: 0.5 });
  t.eq('normalizeLayer rounds values', norm, {
    ok: true,
    value: { x: 0, y: -4, blur: 12.35, spread: -2.35, color: '#aabbcc', alpha: 0.5, inset: false }
  });
  t.eq('normalizeLayer defaults alpha to 1', engine.normalizeLayer({ x: 0, y: 0, blur: 0, spread: 0, color: '#000' }).value.alpha, 1);
  t.eq('normalizeLayer keeps inset', engine.normalizeLayer({ x: 0, y: 0, blur: 0, spread: 0, color: '#000', inset: true }).value.inset, true);
  t.eq('normalizeLayer rejects negative blur', engine.normalizeLayer({ x: 0, y: 0, blur: -1, spread: 0, color: '#000' }),
    { ok: false, error: 'bad_blur' });
  t.eq('normalizeLayer rejects NaN', engine.normalizeLayer({ x: NaN, y: 0, blur: 0, spread: 0, color: '#000' }),
    { ok: false, error: 'bad_value' });
  t.eq('normalizeLayer rejects non-object', engine.normalizeLayer(null), { ok: false, error: 'bad_layer' });

  // --- CSS building -------------------------------------------------------
  var single = engine.buildShadow([{ x: 0, y: 4, blur: 12, spread: 0, color: '#000', alpha: 0.25 }]);
  t.eq('single layer CSS', single.value.css, '0 4px 12px 0 rgba(0, 0, 0, 0.25)');
  t.eq('single layer count', single.value.count, 1);
  t.eq('inset comes first', engine.layerToCss({ x: 0, y: 4, blur: 12, spread: 0, color: '#000', alpha: 0.25, inset: true }).value,
    'inset 0 4px 12px 0 rgba(0, 0, 0, 0.25)');
  t.eq('negative offsets and spread', engine.layerToCss({ x: -1, y: -2, blur: 0, spread: -3, color: '#123456', alpha: 1 }).value,
    '-1px -2px 0 -3px rgba(18, 52, 86, 1)');
  t.eq('zero layer', engine.layerToCss({ x: 0, y: 0, blur: 0, spread: 0, color: '#fff', alpha: 0 }).value,
    '0 0 0 0 rgba(255, 255, 255, 0)');
  t.eq('decimal lengths', engine.layerToCss({ x: 1.5, y: 2.345, blur: 3, spread: 4, color: '#000', alpha: 0.5 }).value,
    '1.5px 2.35px 3px 4px rgba(0, 0, 0, 0.5)');
  var multi = engine.buildShadow([
    { x: 0, y: 1, blur: 2, spread: 3, color: '#000', alpha: 0.5 },
    { x: 0, y: 4, blur: 8, spread: 0, color: '#fff', alpha: 0.2, inset: true }
  ]);
  t.ok('multi layer uses comma', multi.value.css.indexOf(', inset ') !== -1);
  t.eq('multi layer count', multi.value.count, 2);
  t.ok('multi layer order preserved', multi.value.css.indexOf('0 1px 2px 3px rgba(0, 0, 0, 0.5), inset ') === 0);
  t.eq('buildShadow rejects empty list', engine.buildShadow([]), { ok: false, error: 'bad_layers' });
  t.eq('buildShadow rejects nine layers', engine.buildShadow(new Array(9).fill({ x: 0, y: 0, blur: 0, spread: 0, color: '#000' })),
    { ok: false, error: 'bad_layers' });
  t.eq('buildShadow propagates bad blur', engine.buildShadow([{ x: 0, y: 0, blur: -2, spread: 0, color: '#000' }]),
    { ok: false, error: 'bad_blur' });
  t.eq('buildShadowCss prefixes property', engine.buildShadowCss([{ x: 0, y: 4, blur: 12, spread: 0, color: '#000', alpha: 0.25 }]),
    { ok: true, value: 'box-shadow: 0 4px 12px 0 rgba(0, 0, 0, 0.25);' });
  t.eq('formatNumber trims zeros', engine.formatNumber(4), '4');
  t.eq('formatNumber avoids negative zero', engine.formatNumber(-0.001), '0');

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
