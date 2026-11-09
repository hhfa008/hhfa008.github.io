#!/usr/bin/env node
'use strict';

/*
 * water-intake-calculator — engine + contract tests.
 * Output ends with: RESULT: N passed, M failed
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'water-intake-calculator';
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

  var base = engine.dailyWater(70, 0, 'temperate', 'none');
  t.eq('70 kg baseline is 2450 ml', base, {
    ok: true, baseMl: 2450, activityMl: 0, climateMl: 0, statusMl: 0,
    totalMl: 2450, totalL: 2.45, cups250: 9.8, glasses200: 12.3, bottles500: 4.9
  });

  var withExercise = engine.dailyWater(70, 30, 'temperate', 'none');
  t.eq('30 min exercise adds 360 ml', withExercise.activityMl, 360);
  t.eq('baseline plus exercise total', withExercise.totalMl, 2810);

  t.eq('hot climate adds 20% of baseline', engine.dailyWater(70, 0, 'hot', 'none').climateMl, 490);
  t.eq('warm climate adds 10% of baseline', engine.dailyWater(70, 0, 'warm', 'none').climateMl, 245);
  t.eq('very hot adds 30% of baseline', engine.dailyWater(70, 0, 'veryHot', 'none').climateMl, 735);

  t.eq('pregnancy adds 300 ml', engine.dailyWater(70, 0, 'temperate', 'pregnant').statusMl, 300);
  var full = engine.dailyWater(70, 30, 'hot', 'breastfeeding');
  t.eq('breastfeeding adds 700 ml', full.statusMl, 700);
  t.eq('full scenario total is 4000 ml', full.totalMl, 4000);
  t.eq('full scenario is 4.0 L', full.totalL, 4);
  t.eq('full scenario is 16 cups', full.cups250, 16);
  t.eq('full scenario is 8 bottles', full.bottles500, 8);
  t.ok('components sum to the reported total',
    Math.round(full.baseMl + full.activityMl + full.climateMl + full.statusMl) === full.totalMl);

  t.eq('minimum weight 20 kg is accepted', engine.dailyWater(20, 0, 'temperate', 'none').baseMl, 700);
  t.eq('maximum weight 300 kg is accepted', engine.dailyWater(300, 0, 'temperate', 'none').totalMl, 10500);
  t.eq('300 kg is 10.5 L', engine.dailyWater(300, 0, 'temperate', 'none').totalL, 10.5);
  t.eq('600 exercise minutes is accepted', engine.dailyWater(70, 600, 'temperate', 'none').activityMl, 7200);

  t.eq('weight below range rejected', engine.dailyWater(19.9, 0, 'temperate', 'none'), { ok: false, error: 'bad_weight' });
  t.eq('weight above range rejected', engine.dailyWater(300.1, 0, 'temperate', 'none'), { ok: false, error: 'bad_weight' });
  t.eq('zero weight rejected', engine.dailyWater(0, 0, 'temperate', 'none'), { ok: false, error: 'bad_weight' });
  t.eq('numeric string weight rejected', engine.dailyWater('70', 0, 'temperate', 'none'), { ok: false, error: 'bad_weight' });
  t.eq('NaN weight rejected', engine.dailyWater(NaN, 0, 'temperate', 'none'), { ok: false, error: 'bad_weight' });
  t.eq('negative exercise rejected', engine.dailyWater(70, -1, 'temperate', 'none'), { ok: false, error: 'bad_activity' });
  t.eq('exercise above range rejected', engine.dailyWater(70, 601, 'temperate', 'none'), { ok: false, error: 'bad_activity' });
  t.eq('unknown climate rejected', engine.dailyWater(70, 0, 'cold', 'none'), { ok: false, error: 'bad_climate' });
  t.eq('unknown status rejected', engine.dailyWater(70, 0, 'temperate', 'lactating'), { ok: false, error: 'bad_status' });

  t.eq('roundTo half-up 2.345 -> 2.35', engine.roundTo(2.345, 2), 2.35);
  t.eq('roundTo negative -2.345 -> -2.35', engine.roundTo(-2.345, 2), -2.35);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
