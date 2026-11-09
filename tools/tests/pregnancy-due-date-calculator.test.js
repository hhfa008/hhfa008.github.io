#!/usr/bin/env node
'use strict';

/*
 * pregnancy-due-date-calculator — engine + contract tests.
 * Output ends with: RESULT: N passed, M failed
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'pregnancy-due-date-calculator';
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

  var jan1 = { y: 2024, m: 1, d: 1 };
  var due = engine.dueDate(jan1);
  t.eq('2024-01-01 due date is 2024-10-07', due.due, { y: 2024, m: 10, d: 7 });
  t.eq('due date span is 280 days', due.days, 280);

  var newYear = engine.dueDate({ y: 2023, m: 12, d: 31 });
  t.eq('cross-year LMP 2023-12-31 due 2024-10-06', newYear.due, { y: 2024, m: 10, d: 6 });

  var leapLmp = { y: 2024, m: 2, d: 29 };
  t.eq('leap day LMP is valid', engine.isValidDate(leapLmp), true);
  t.eq('leap day due date is exactly 280 days later',
    engine.toOrdinal(engine.dueDate(leapLmp).due) - engine.toOrdinal(leapLmp), 280);

  t.eq('2023-02-29 rejected', engine.dueDate({ y: 2023, m: 2, d: 29 }), { ok: false, error: 'bad_date' });
  t.eq('2024-04-31 rejected', engine.dueDate({ y: 2024, m: 4, d: 31 }), { ok: false, error: 'bad_date' });
  t.eq('month 13 rejected', engine.dueDate({ y: 2024, m: 13, d: 1 }), { ok: false, error: 'bad_date' });
  t.eq('day 0 rejected', engine.dueDate({ y: 2024, m: 1, d: 0 }), { ok: false, error: 'bad_date' });
  t.eq('year 1899 rejected', engine.dueDate({ y: 1899, m: 12, d: 31 }), { ok: false, error: 'bad_date' });
  t.eq('year 2201 rejected', engine.dueDate({ y: 2201, m: 1, d: 1 }), { ok: false, error: 'bad_date' });
  t.eq('string components rejected', engine.dueDate({ y: '2024', m: 1, d: 1 }), { ok: false, error: 'bad_date' });
  t.eq('null rejected', engine.dueDate(null), { ok: false, error: 'bad_date' });

  var gest = engine.gestationalAge(jan1, { y: 2024, m: 3, d: 1 });
  t.eq('Jan 1 to Mar 1 is 60 days', gest.days, 60);
  t.eq('60 days is 8 weeks 4 days', { weeks: gest.weeks, remainder: gest.remainder }, { weeks: 8, remainder: 4 });
  t.eq('8 weeks 4 days is first trimester', gest.trimester, 1);
  t.eq('220 days remain to due date', gest.daysToDue, 220);
  t.eq('progress is 21.4%', gest.progress, 21.4);
  t.eq('gestational age returns the due date', gest.due, { y: 2024, m: 10, d: 7 });

  var sameDay = engine.gestationalAge(jan1, jan1);
  t.eq('same day is 0 weeks 0 days', { weeks: sameDay.weeks, remainder: sameDay.remainder }, { weeks: 0, remainder: 0 });
  t.eq('same day is first trimester', sameDay.trimester, 1);
  t.eq('same day leaves 280 days', sameDay.daysToDue, 280);

  function refAfter(offset) {
    return engine.fromOrdinal(engine.toOrdinal(jan1) + offset);
  }
  t.eq('13w6d is first trimester', engine.gestationalAge(jan1, refAfter(97)).trimester, 1);
  t.eq('14w0d is second trimester', engine.gestationalAge(jan1, refAfter(98)).trimester, 2);
  t.eq('27w6d is second trimester', engine.gestationalAge(jan1, refAfter(195)).trimester, 2);
  t.eq('28w0d is third trimester', engine.gestationalAge(jan1, refAfter(196)).trimester, 3);

  var onDue = engine.gestationalAge(jan1, { y: 2024, m: 10, d: 7 });
  t.eq('due date is 40 weeks 0 days', { weeks: onDue.weeks, remainder: onDue.remainder }, { weeks: 40, remainder: 0 });
  t.eq('due date has 0 days remaining', onDue.daysToDue, 0);
  t.eq('due date is not overdue', onDue.overdue, false);
  t.eq('due date progress is 100%', onDue.progress, 100);

  var overdue = engine.gestationalAge(jan1, { y: 2024, m: 10, d: 21 });
  t.eq('overdue by 14 days reports -14', overdue.daysToDue, -14);
  t.eq('overdue flag is set', overdue.overdue, true);
  t.eq('overdue progress stays at 100%', overdue.progress, 100);

  t.eq('reference before LMP is rejected',
    engine.gestationalAge(jan1, { y: 2023, m: 12, d: 31 }), { ok: false, error: 'future_date' });
  t.eq('reference after LMP is accepted',
    engine.gestationalAge(jan1, refAfter(1)).ok, true);

  t.eq('2000 is a leap year', engine.isLeapYear(2000), true);
  t.eq('1900 is not a leap year', engine.isLeapYear(1900), false);
  t.eq('2024 is a leap year', engine.isLeapYear(2024), true);
  t.eq('February 2024 has 29 days', engine.daysInMonth(2024, 2), 29);
  t.eq('February 2023 has 28 days', engine.daysInMonth(2023, 2), 28);

  var sampleDates = [
    { y: 1900, m: 1, d: 1 },
    { y: 1999, m: 12, d: 31 },
    { y: 2000, m: 2, d: 29 },
    { y: 2024, m: 10, d: 7 },
    { y: 2200, m: 12, d: 31 }
  ];
  sampleDates.forEach(function (date) {
    t.eq('ordinal round-trip ' + date.y + '-' + date.m + '-' + date.d,
      engine.fromOrdinal(engine.toOrdinal(date)), date);
  });
  t.eq('ordinal 1970-01-01 is 0', engine.toOrdinal({ y: 1970, m: 1, d: 1 }), 0);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
