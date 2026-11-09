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
var SLUG = 'border-radius-generator';
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

  // --- parsing ------------------------------------------------------------
  t.eq('parseRadius px', engine.parseRadius('16px'), { ok: true, value: { n: 16, unit: 'px' } });
  t.eq('parseRadius percent', engine.parseRadius('50%'), { ok: true, value: { n: 50, unit: '%' } });
  t.eq('parseRadius number', engine.parseRadius(0), { ok: true, value: { n: 0, unit: 'px' } });
  t.eq('parseRadius bare zero', engine.parseRadius('0'), { ok: true, value: { n: 0, unit: 'px' } });
  t.eq('parseRadius decimal', engine.parseRadius('.5px'), { ok: true, value: { n: 0.5, unit: 'px' } });
  t.eq('parseRadius rejects unitless', engine.parseRadius('16'), { ok: false, error: 'bad_radius' });
  t.eq('parseRadius rejects negative', engine.parseRadius('-1px'), { ok: false, error: 'bad_radius' });
  t.eq('parseRadius rejects em', engine.parseRadius('2em'), { ok: false, error: 'bad_radius' });
  t.eq('parseRadius rejects NaN', engine.parseRadius(NaN), { ok: false, error: 'bad_radius' });
  t.eq('parseRadius rejects time values', engine.parseRadius(true), { ok: false, error: 'bad_radius' });

  // --- compression --------------------------------------------------------
  t.eq('all equal compresses to one', engine.compressValues(['8px', '8px', '8px', '8px']), { ok: true, value: '8px' });
  t.eq('opposites equal compresses to two', engine.compressValues(['8px', '4px', '8px', '4px']), { ok: true, value: '8px 4px' });
  t.eq('only tr and bl equal compresses to three', engine.compressValues(['1px', '2px', '3px', '2px']), { ok: true, value: '1px 2px 3px' });
  t.eq('four values stay four', engine.compressValues(['1px', '2px', '3px', '4px']), { ok: true, value: '1px 2px 3px 4px' });
  t.eq('compress rejects wrong length', engine.compressValues(['1px', '2px']), { ok: false, error: 'bad_value' });

  // --- buildRadius --------------------------------------------------------
  t.eq('single value', engine.buildRadius('16px', '16px', '16px', '16px').value.css, 'border-radius: 16px;');
  t.eq('four values', engine.buildRadius('1px', '2px', '3px', '4px').value.css, 'border-radius: 1px 2px 3px 4px;');
  t.eq('two values', engine.buildRadius('16px', '0px', '16px', '0px').value.css, 'border-radius: 16px 0px;');
  t.eq('three values', engine.buildRadius('1px', '2px', '3px', '2px').value.css, 'border-radius: 1px 2px 3px;');
  t.eq('percent radius', engine.buildRadius('50%', '50%', '50%', '50%').value.css, 'border-radius: 50%;');
  t.eq('zero radius', engine.buildRadius(0, 0, 0, 0).value.css, 'border-radius: 0px;');
  t.eq('ellipse slash syntax', engine.buildRadius('10px', '10px', '10px', '10px', ['20px', '20px', '20px', '20px']).value.css,
    'border-radius: 10px / 20px;');
  t.eq('ellipse vertical four values', engine.buildRadius('50%', '50%', '50%', '50%', ['50%', '50%', '50%', '25%']).value.css,
    'border-radius: 50% / 50% 50% 50% 25%;');
  t.eq('ellipse object input', engine.buildRadius('4px', '4px', '4px', '4px', { tl: '2px', tr: '2px', br: '2px', bl: '2px' }).value.css,
    'border-radius: 4px / 2px;');
  t.eq('negative corner rejected', engine.buildRadius('-1px', '2px', '3px', '4px'), { ok: false, error: 'bad_radius' });
  t.eq('negative vertical rejected', engine.buildRadius('1px', '1px', '1px', '1px', ['-2px', '2px', '2px', '2px']),
    { ok: false, error: 'bad_radius' });
  t.eq('bad vertical type rejected', engine.buildRadius('1px', '1px', '1px', '1px', 'x'),
    { ok: false, error: 'bad_radius' });

  // --- presets ------------------------------------------------------------
  t.eq('pill preset', engine.presetRadius('pill').value.horizontal, ['9999px', '9999px', '9999px', '9999px']);
  t.eq('circle preset', engine.presetRadius('circle').value.horizontal[0], '50%');
  t.eq('leaf preset is a copy', (function () {
    var a = engine.presetRadius('leaf');
    a.value.horizontal[0] = 'changed';
    return engine.presetRadius('leaf').value.horizontal[0];
  })(), '0px');
  t.eq('blob preset has vertical radii', engine.presetRadius('blob').value.vertical.length, 4);
  t.eq('none preset is zero', engine.presetRadius('none').value.horizontal, ['0px', '0px', '0px', '0px']);
  t.eq('unknown preset rejected', engine.presetRadius('star'), { ok: false, error: 'bad_preset' });
  t.eq('five preset names', engine.presetNames().length, 5);

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
