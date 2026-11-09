#!/usr/bin/env node
'use strict';

/*
 * steps-to-distance tests.
 * Run: node /Users/fa/games/tools/tests/steps-to-distance.test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'steps-to-distance';
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

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  t.eq('mile constant', engine.M_PER_MILE, 1609.344);
  t.eq('stride factor', engine.STRIDE_FACTOR, 0.415);
  t.eq('calorie factor', engine.KCAL_PER_STEP_KG, 0.00045);

  var forward = engine.distanceFromSteps(10000, 0.7);
  t.eq('10000 steps is 7 km', forward.km, 7);
  t.eq('10000 steps is 7000 m', forward.meters, 7000);
  t.near('10000 steps in miles', forward.miles, 4.349598345661338, 1e-9);
  t.eq('zero steps', engine.distanceFromSteps(0, 0.7).meters, 0);
  t.eq('negative steps rejected', engine.distanceFromSteps(-1, 0.7), { ok: false, error: 'range' });
  t.eq('NaN steps rejected', engine.distanceFromSteps(NaN, 0.7), { ok: false, error: 'bad_value' });
  t.eq('string steps rejected', engine.distanceFromSteps('10000', 0.7), { ok: false, error: 'bad_value' });
  t.eq('step overflow rejected', engine.distanceFromSteps(1000000001, 0.7), { ok: false, error: 'overflow' });
  t.eq('zero stride rejected', engine.distanceFromSteps(100, 0), { ok: false, error: 'range' });
  t.eq('negative stride rejected', engine.distanceFromSteps(100, -0.7), { ok: false, error: 'range' });
  t.eq('huge stride rejected', engine.distanceFromSteps(100, 6), { ok: false, error: 'range' });

  t.eq('7 km to steps', engine.stepsFromDistance(7, 'km', 0.7).steps, 10000);
  t.eq('1 mile to steps', engine.stepsFromDistance(1, 'mi', 0.7).steps, 2299);
  t.eq('zero distance to steps', engine.stepsFromDistance(0, 'km', 0.7).steps, 0);
  t.eq('zero distance in meters', engine.stepsFromDistance(0, 'km', 0.7).meters, 0);
  t.eq('negative distance rejected', engine.stepsFromDistance(-1, 'km', 0.7), { ok: false, error: 'range' });
  t.eq('unknown unit rejected', engine.stepsFromDistance(7, 'yd', 0.7), { ok: false, error: 'bad_unit' });
  t.eq('reverse round trip', engine.stepsFromDistance(engine.distanceFromSteps(12345, 0.73).km, 'km', 0.73).steps, 12345);

  var fromHeight = engine.strideFromHeight(170);
  t.eq('height 170 stride', fromHeight.strideM, 0.7055);
  t.eq('custom factor', engine.strideFromHeight(170, 0.5).strideM, 0.85);
  t.eq('height too low', engine.strideFromHeight(49), { ok: false, error: 'range' });
  t.eq('height too high', engine.strideFromHeight(251), { ok: false, error: 'range' });
  t.eq('factor out of range', engine.strideFromHeight(170, 0.7), { ok: false, error: 'range' });
  t.eq('bad height', engine.strideFromHeight(NaN), { ok: false, error: 'bad_value' });
  t.eq('bad factor', engine.strideFromHeight(170, '0.4'), { ok: false, error: 'bad_value' });

  t.eq('10000 steps calories at 70 kg', engine.calories(10000, 70), { ok: true, kcal: 315 });
  t.eq('zero steps calories', engine.calories(0, 70), { ok: true, kcal: 0 });
  t.eq('light weight rejected', engine.calories(10000, 19), { ok: false, error: 'range' });
  t.eq('heavy weight rejected', engine.calories(10000, 401), { ok: false, error: 'range' });
  t.eq('zero weight rejected', engine.calories(10000, 0), { ok: false, error: 'range' });
  t.eq('missing weight rejected', engine.calories(10000, null), { ok: false, error: 'bad_value' });
  t.eq('isNum(0)', engine.isNum(0), true);
  t.eq('isNum("0")', engine.isNum('0'), false);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
