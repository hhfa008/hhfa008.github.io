#!/usr/bin/env node
'use strict';

/*
 * pace-calculator tests.
 * Run: node /Users/fa/games/tools/tests/pace-calculator.test.js
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'pace-calculator';
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
  t.eq('5K preset', engine.PRESETS.fiveK, 5);
  t.eq('10K preset', engine.PRESETS.tenK, 10);
  t.eq('half preset', engine.PRESETS.half, 21.0975);
  t.eq('full preset', engine.PRESETS.full, 42.195);

  t.eq('parseTime 0:50:00', engine.parseTime('0:50:00'),
    { ok: true, seconds: 3000, hours: 0, minutes: 50, secondsPart: 0 });
  t.eq('parseTime 5:00', engine.parseTime('5:00').seconds, 300);
  t.eq('parseTime 1:23:45', engine.parseTime('1:23:45').seconds, 5025);
  t.eq('parseTime single number is minutes', engine.parseTime('50').seconds, 3000);
  t.eq('parseTime 90:00', engine.parseTime('90:00').seconds, 5400);
  t.eq('parseTime trims spaces', engine.parseTime('  10:00  ').seconds, 600);
  t.eq('parseTime rejects seconds 60', engine.parseTime('1:60'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects seconds 60 in H:MM:SS', engine.parseTime('1:2:60'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects too many parts', engine.parseTime('1:2:3:4'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects letters', engine.parseTime('abc'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects empty', engine.parseTime(''), { ok: false, error: 'empty_input' });
  t.eq('parseTime rejects zero', engine.parseTime('0'), { ok: false, error: 'range' });
  t.eq('parseTime rejects over 48h', engine.parseTime('49:00:00'), { ok: false, error: 'range' });
  t.eq('parseTime rejects number input', engine.parseTime(300), { ok: false, error: 'bad_time' });

  t.eq('formatTime 300', engine.formatTime(300),
    { ok: true, text: '5:00', totalSeconds: 300, hours: 0, minutes: 5, seconds: 0 });
  t.eq('formatTime 3000', engine.formatTime(3000).text, '50:00');
  t.eq('formatTime 5025', engine.formatTime(5025).text, '1:23:45');
  t.eq('formatTime zero', engine.formatTime(0).text, '0:00');
  t.eq('formatTime rounds', engine.formatTime(59.6).text, '1:00');
  t.eq('formatTime rejects negative', engine.formatTime(-1), { ok: false, error: 'bad_value' });
  t.eq('formatTime rejects NaN', engine.formatTime(NaN), { ok: false, error: 'bad_value' });

  var p = engine.pace(10, 3000);
  t.eq('pace 10K/50min ok', p.ok, true);
  t.eq('pace seconds per km', p.paceSecPerKm, 300);
  t.eq('pace speed kmh', p.speedKmh, 12);
  t.near('pace per mile', p.paceSecPerMile, 482.8032, 1e-9);
  t.eq('pace rejects zero distance', engine.pace(0, 3000), { ok: false, error: 'range' });
  t.eq('pace rejects negative distance', engine.pace(-10, 3000), { ok: false, error: 'range' });
  t.eq('pace rejects zero time', engine.pace(10, 0), { ok: false, error: 'range' });
  t.eq('pace rejects NaN distance', engine.pace(NaN, 3000), { ok: false, error: 'bad_value' });
  t.eq('pace rejects NaN time', engine.pace(10, NaN), { ok: false, error: 'bad_value' });

  t.eq('finishTime 10K at 5:00', engine.finishTime(10, 300).seconds, 3000);
  t.eq('finishTime 5K at 5:00', engine.finishTime(5, 300).seconds, 1500);
  t.near('finishTime half at 5:00', engine.finishTime(21.0975, 300).seconds, 6329.25, 1e-9);
  t.eq('finishTime rejects zero distance', engine.finishTime(0, 300), { ok: false, error: 'range' });
  t.eq('finishTime rejects zero pace', engine.finishTime(10, 0), { ok: false, error: 'range' });

  var ten = engine.splitTable(10, 300);
  t.eq('splitTable 10K count', ten.splits.length, 10);
  t.eq('splitTable first elapsed', ten.splits[0].elapsedSeconds, 300);
  t.eq('splitTable last elapsed', ten.splits[9].elapsedSeconds, 3000);
  t.eq('splitTable last distance', ten.splits[9].distanceKm, 10);
  t.eq('splitTable total', ten.totalSeconds, 3000);
  var half = engine.splitTable(21.0975, 300);
  t.eq('splitTable half rows', half.splits.length, 22);
  t.near('splitTable half total', half.totalSeconds, 6329.25, 1e-9);
  t.near('splitTable half last distance', half.splits[21].distanceKm, 21.0975, 1e-9);
  var short = engine.splitTable(0.5, 300);
  t.eq('splitTable partial row', short.splits.length, 1);
  t.eq('splitTable partial elapsed', short.splits[0].elapsedSeconds, 150);
  t.eq('splitTable rejects zero distance', engine.splitTable(0, 300), { ok: false, error: 'range' });

  var predicted = engine.predictFinishes(300);
  t.eq('predictFinishes count', predicted.results.length, 4);
  t.eq('predictFinishes 5K', predicted.results[0], { key: 'fiveK', distanceKm: 5, seconds: 1500 });
  t.eq('predictFinishes 10K', predicted.results[1], { key: 'tenK', distanceKm: 10, seconds: 3000 });
  t.near('predictFinishes half', predicted.results[2].seconds, 6329.25, 1e-9);
  t.near('predictFinishes full', predicted.results[3].seconds, 12658.5, 1e-9);
  t.eq('predictFinishes rejects zero pace', engine.predictFinishes(0), { ok: false, error: 'range' });

  t.eq('kmFromMiles 1', engine.kmFromMiles(1).km, 1.609344);
  t.eq('kmFromMiles rejects negative', engine.kmFromMiles(-1), { ok: false, error: 'range' });
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
