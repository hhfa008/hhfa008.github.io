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
var SLUG = 'placeholder-image-generator';
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

  // --- dimension validation ----------------------------------------------
  t.eq('max size is 4096', engine.MAX_SIZE, 4096);
  t.eq('1 is valid', engine.isValidSize(1), true);
  t.eq('4096 is valid', engine.isValidSize(4096), true);
  t.eq('0 is invalid', engine.isValidSize(0), false);
  t.eq('4097 is invalid', engine.isValidSize(4097), false);
  t.eq('fraction is invalid', engine.isValidSize(12.5), false);
  t.eq('string is invalid for isValidSize', engine.isValidSize('12'), false);
  t.eq('parseDimension accepts number', engine.parseDimension(1200), { ok: true, value: 1200 });
  t.eq('parseDimension accepts numeric string', engine.parseDimension('640'), { ok: true, value: 640 });
  t.eq('parseDimension accepts px suffix', engine.parseDimension('1920px'), { ok: true, value: 1920 });
  t.eq('parseDimension trims spaces', engine.parseDimension(' 800 '), { ok: true, value: 800 });
  t.eq('parseDimension rejects 0', engine.parseDimension(0), { ok: false, error: 'bad_dimension' });
  t.eq('parseDimension rejects 4097', engine.parseDimension(4097), { ok: false, error: 'bad_dimension' });
  t.eq('parseDimension rejects fraction', engine.parseDimension(12.5), { ok: false, error: 'bad_dimension' });
  t.eq('parseDimension rejects words', engine.parseDimension('abc'), { ok: false, error: 'bad_dimension' });
  t.eq('parseDimension rejects empty', engine.parseDimension(''), { ok: false, error: 'bad_dimension' });

  // --- format helpers -----------------------------------------------------
  t.eq('png mime', engine.formatMime('png'), { ok: true, value: { format: 'png', mime: 'image/png', ext: 'png' } });
  t.eq('jpeg aliases jpg', engine.formatMime('jpeg'), { ok: true, value: { format: 'jpeg', mime: 'image/jpeg', ext: 'jpg' } });
  t.eq('webp mime', engine.formatMime('WEBP'), { ok: true, value: { format: 'webp', mime: 'image/webp', ext: 'webp' } });
  t.eq('gif is rejected', engine.formatMime('gif'), { ok: false, error: 'bad_format' });
  t.eq('null format is rejected', engine.formatMime(null), { ok: false, error: 'bad_format' });

  // --- labels and filenames ----------------------------------------------
  t.eq('default label is size', engine.buildLabel(1200, 630, ''), { ok: true, value: '1200 × 630' });
  t.eq('null text uses default', engine.buildLabel(300, 250, null), { ok: true, value: '300 × 250' });
  t.eq('custom label is trimmed', engine.buildLabel(800, 600, '  Hero  '), { ok: true, value: 'Hero' });
  t.eq('long label truncated to 48', Array.from(engine.buildLabel(100, 100, new Array(60).join('a')).value).length, 48);
  t.eq('label rejects bad dimensions', engine.buildLabel(0, 100, 'x'), { ok: false, error: 'bad_dimension' });
  t.eq('label rejects non-string', engine.buildLabel(100, 100, 42), { ok: false, error: 'bad_text' });
  t.eq('png filename', engine.buildFilename(1200, 630, 'png'), { ok: true, value: 'placeholder-1200x630.png' });
  t.eq('jpg filename', engine.buildFilename(1920, 1080, 'jpg'), { ok: true, value: 'placeholder-1920x1080.jpg' });
  t.eq('webp filename', engine.buildFilename(300, 250, 'webp'), { ok: true, value: 'placeholder-300x250.webp' });
  t.eq('filename rejects bad size', engine.buildFilename(0, 250, 'png'), { ok: false, error: 'bad_dimension' });
  t.eq('filename rejects bad format', engine.buildFilename(300, 250, 'gif'), { ok: false, error: 'bad_format' });

  // --- font sizing --------------------------------------------------------
  var normal = engine.fitFontSize(1200, 630, '').value;
  t.eq('default label font size', normal, 113);
  t.ok('long text gets a smaller font', engine.fitFontSize(1200, 630, 'A very long placeholder caption').value < normal);
  t.eq('tiny canvas clamps to 8', engine.fitFontSize(1, 1, '').value, 8);
  t.eq('huge canvas clamps to 512', engine.fitFontSize(4096, 4096, 'A').value, 512);
  t.eq('font rejects bad size', engine.fitFontSize(0, 100, ''), { ok: false, error: 'bad_dimension' });

  // --- full config / presets ---------------------------------------------
  var cfg = engine.normalizeConfig({
    width: '1200', height: '630', bg: '#d5d0c4', fg: '#14171a', text: '', format: 'jpg'
  });
  t.eq('normalizeConfig builds defaults', cfg, {
    ok: true,
    value: {
      width: 1200,
      height: 630,
      bg: '#d5d0c4',
      fg: '#14171a',
      text: '',
      label: '1200 × 630',
      font: 113,
      format: 'jpg',
      mime: 'image/jpeg',
      filename: 'placeholder-1200x630.jpg'
    }
  });
  t.eq('normalizeConfig defaults to png', engine.normalizeConfig({ width: 10, height: 10, bg: '#000', fg: '#fff' }).value.format, 'png');
  t.eq('normalizeConfig rejects bad width', engine.normalizeConfig({ width: 0, height: 10, bg: '#000', fg: '#fff' }),
    { ok: false, error: 'bad_dimension' });
  t.eq('normalizeConfig rejects bad color', engine.normalizeConfig({ width: 10, height: 10, bg: 'red', fg: '#fff' }),
    { ok: false, error: 'bad_color' });
  t.eq('normalizeConfig rejects bad format', engine.normalizeConfig({ width: 10, height: 10, bg: '#000', fg: '#fff', format: 'gif' }),
    { ok: false, error: 'bad_format' });
  t.eq('normalizeConfig rejects null', engine.normalizeConfig(null), { ok: false, error: 'bad_value' });
  var presets = engine.presets();
  t.eq('six presets', presets.length, 6);
  t.eq('OG preset dimensions', presets[0], { id: 'og', width: 1200, height: 630 });
  t.eq('ad preset dimensions', presets[5], { id: 'ad', width: 300, height: 250 });

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
