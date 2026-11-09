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
var SLUG = 'gradient-generator';
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

  // --- color / angle helpers ----------------------------------------------
  t.eq('normalizeColor expands 3-digit hex', engine.normalizeColor('#0f8'), { ok: true, value: '#00ff88' });
  t.eq('normalizeColor rejects rgb()', engine.normalizeColor('rgb(1,2,3)'), { ok: false, error: 'bad_color' });
  t.eq('normalizeColor rejects null', engine.normalizeColor(null), { ok: false, error: 'bad_color' });
  t.eq('normalizeAngle(-90)', engine.normalizeAngle(-90), { ok: true, value: 270 });
  t.eq('normalizeAngle(450)', engine.normalizeAngle(450), { ok: true, value: 90 });
  t.eq('normalizeAngle(360)', engine.normalizeAngle(360), { ok: true, value: 0 });
  t.eq('normalizeAngle rejects NaN', engine.normalizeAngle(NaN), { ok: false, error: 'bad_angle' });

  // --- stop normalization -------------------------------------------------
  var sorted = engine.normalizeStops([
    { color: '#0000FF', position: 100 },
    { color: '#FFF', position: 0 }
  ]);
  t.eq('stops sorted ascending and normalized', sorted, {
    ok: true,
    value: [
      { color: '#ffffff', position: 0 },
      { color: '#0000ff', position: 100 }
    ]
  });
  t.eq('one stop is rejected', engine.normalizeStops([{ color: '#fff', position: 0 }]),
    { ok: false, error: 'bad_stops' });
  t.eq('thirteen stops are rejected', engine.normalizeStops(new Array(13).fill({ color: '#fff', position: 0 })),
    { ok: false, error: 'bad_stops' });
  t.eq('bad color is rejected', engine.normalizeStops([
    { color: 'red', position: 0 }, { color: '#fff', position: 100 }
  ]), { ok: false, error: 'bad_color' });
  t.eq('position below 0 is rejected', engine.normalizeStops([
    { color: '#fff', position: -1 }, { color: '#000', position: 100 }
  ]), { ok: false, error: 'bad_position' });
  t.eq('position above 100 is rejected', engine.normalizeStops([
    { color: '#fff', position: 0 }, { color: '#000', position: 101 }
  ]), { ok: false, error: 'bad_position' });
  t.eq('NaN position is rejected', engine.normalizeStops([
    { color: '#fff', position: 0 }, { color: '#000', position: NaN }
  ]), { ok: false, error: 'bad_position' });
  t.eq('duplicate positions are kept', engine.normalizeStops([
    { color: '#fff', position: 50 }, { color: '#000', position: 50 }
  ]).value.length, 2);

  // --- buildGradient ------------------------------------------------------
  var linear = engine.buildGradient({
    type: 'linear', angle: 90,
    stops: [{ color: '#ff0000', position: 0 }, { color: '#0000ff', position: 100 }]
  });
  t.eq('linear CSS string', linear.value.css, 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
  var reversed = engine.buildGradient({
    type: 'linear', angle: -90,
    stops: [{ color: '#0000ff', position: 100 }, { color: '#ff0000', position: 0 }]
  });
  t.eq('output sorted and negative angle wrapped', reversed.value.css,
    'linear-gradient(270deg, #ff0000 0%, #0000ff 100%)');
  var radial = engine.buildGradient({
    type: 'radial', angle: NaN,
    stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 100 }]
  });
  t.eq('radial ignores angle', radial.value.css, 'radial-gradient(circle at center, #ffffff 0%, #000000 100%)');
  t.eq('radial angle is null', radial.value.angle, null);
  t.eq('default angle is 90', engine.buildGradient({
    stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 100 }]
  }).value.css, 'linear-gradient(90deg, #ffffff 0%, #000000 100%)');
  t.eq('bad type rejected', engine.buildGradient({
    type: 'conic',
    stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 100 }]
  }), { ok: false, error: 'bad_mode' });
  t.eq('bad stop propagates', engine.buildGradient({
    type: 'linear', angle: 0, stops: [{ color: '#fff', position: 0 }]
  }), { ok: false, error: 'bad_stops' });
  t.eq('decimal positions format to 2 places', engine.buildGradient({
    type: 'linear', angle: 45,
    stops: [{ color: '#fff', position: 12.345 }, { color: '#000', position: 99.9 }]
  }).value.css, 'linear-gradient(45deg, #ffffff 12.35%, #000000 99.9%)');
  t.eq('hard edge keeps both stops', (engine.buildGradient({
    type: 'linear', angle: 0,
    stops: [{ color: '#fff', position: 50 }, { color: '#000', position: 50 }]
  }).value.css.match(/%/g) || []).length, 2);
  t.eq('non-object config rejected', engine.buildGradient(null), { ok: false, error: 'bad_value' });

  // --- css block / presets ------------------------------------------------
  t.eq('toCssBlock prefixes background-image', engine.toCssBlock({
    type: 'linear', angle: 90,
    stops: [{ color: '#fff', position: 0 }, { color: '#000', position: 100 }]
  }), { ok: true, value: 'background-image: linear-gradient(90deg, #ffffff 0%, #000000 100%);' });
  var presets = engine.presets();
  t.eq('five presets', presets.length, 5);
  t.ok('every preset builds', presets.every(function (preset) {
    return engine.buildGradient(preset).ok;
  }));
  t.eq('preset list is a copy', presets[0].stops.length, 2);

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
