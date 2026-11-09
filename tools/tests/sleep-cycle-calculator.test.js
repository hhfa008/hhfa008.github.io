#!/usr/bin/env node
'use strict';

/*
 * sleep-cycle-calculator — engine + contract tests.
 * Output ends with: RESULT: N passed, M failed
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'sleep-cycle-calculator';
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

  var wake = engine.wakeTimes('23:00', 15);
  t.eq('wake calculation succeeds', wake.ok, true);
  t.eq('three cycle options', wake.times.length, 3);
  t.eq('4 cycles wake at 05:15', wake.times[0].time, '05:15');
  t.eq('5 cycles wake at 06:45', wake.times[1].time, '06:45');
  t.eq('6 cycles wake at 08:15', wake.times[2].time, '08:15');
  t.eq('4 cycles sleep 360 minutes', wake.times[0].sleepMinutes, 360);
  t.eq('5 cycles sleep 450 minutes', wake.times[1].sleepMinutes, 450);
  t.eq('6 cycles sleep 540 minutes', wake.times[2].sleepMinutes, 540);
  t.eq('4 cycles in bed 375 minutes', wake.times[0].inBedMinutes, 375);
  t.eq('6 cycles in bed 555 minutes', wake.times[2].inBedMinutes, 555);
  t.eq('wake mode is bedtime', wake.mode, 'bedtime');

  var bed = engine.bedTimes('07:00', 15);
  t.eq('bedtime calculation succeeds', bed.ok, true);
  t.eq('4 cycles bedtime 00:45', bed.times[0].time, '00:45');
  t.eq('5 cycles bedtime 23:15', bed.times[1].time, '23:15');
  t.eq('6 cycles bedtime 21:45', bed.times[2].time, '21:45');
  t.eq('reverse mode is wake', bed.mode, 'wake');

  t.eq('23:30 + 45 min crosses midnight', engine.addMinutes('23:30', 45).time, '00:15');
  t.eq('00:10 - 20 min wraps backwards', engine.addMinutes('00:10', -20).time, '23:50');
  t.eq('12:00 + 720 min is midnight', engine.addMinutes('12:00', 720).time, '00:00');
  t.eq('addMinutes rejects fractional delta', engine.addMinutes('12:00', 1.5), { ok: false, error: 'bad_minutes' });
  t.eq('addMinutes rejects bad time', engine.addMinutes('24:00', 10), { ok: false, error: 'bad_time' });

  t.eq('parseTime accepts 7:05', engine.parseTime('7:05').minutes, 425);
  t.eq('parseTime rejects hour 24', engine.parseTime('24:00'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects minute 60', engine.parseTime('12:60'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects words', engine.parseTime('noon'), { ok: false, error: 'bad_time' });
  t.eq('parseTime rejects numbers', engine.parseTime(705), { ok: false, error: 'bad_time' });

  t.eq('zero onset wakes 4 cycles at 04:00', engine.wakeTimes('22:00', 0).times[0].time, '04:00');
  t.eq('missing onset defaults to 15', engine.wakeTimes('23:00').onset, 15);
  t.eq('onset above 120 rejected', engine.wakeTimes('23:00', 121), { ok: false, error: 'bad_onset' });
  t.eq('fractional onset rejected', engine.wakeTimes('23:00', 15.5), { ok: false, error: 'bad_onset' });
  t.eq('string onset rejected', engine.bedTimes('07:00', '15'), { ok: false, error: 'bad_onset' });
  t.eq('bad wake time rejected', engine.bedTimes('7:5', 15), { ok: false, error: 'bad_time' });

  t.eq('normalize 1440 to 0', engine.normalize(1440), 0);
  t.eq('normalize -30 to 1410', engine.normalize(-30), 1410);
  t.eq('formatTime pads midnight', engine.formatTime(0), '00:00');
  t.eq('formatTime 1395 is 23:15', engine.formatTime(1395), '23:15');

  t.eq('durationParts 450', engine.durationParts(450), { ok: true, hours: 7, minutes: 30 });
  t.eq('durationParts 360', engine.durationParts(360), { ok: true, hours: 6, minutes: 0 });
  t.eq('durationParts 540', engine.durationParts(540), { ok: true, hours: 9, minutes: 0 });
  t.eq('durationParts rejects negative', engine.durationParts(-1), { ok: false, error: 'bad_minutes' });
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
