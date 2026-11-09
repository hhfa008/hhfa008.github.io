#!/usr/bin/env node
'use strict';

/*
 * Tests for tools/week-number-calculator/index.html
 * Run: node tools/tests/week-number-calculator.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var SLUG = 'week-number-calculator';
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

var html = lib.page(DIR);
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* asserted */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* asserted */ }

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
  try { jsonLd = lib.jsonLd(html); t.ok('JSON-LD parses', true); }
  catch (e) { t.ok('JSON-LD parses', false, e.message); }
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
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

function date(y, m, d) { return { y: y, m: m, d: d }; }

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var a = engine.isoWeek('2024-01-01').value;
  t.eq('2024-01-01 week', a.week, 1);
  t.eq('2024-01-01 week-year', a.year, 2024);
  t.eq('2024-01-01 weekday is Monday', a.weekday, 0);
  t.eq('2024-01-01 range start', a.start, date(2024, 1, 1));
  t.eq('2024-01-01 range end', a.end, date(2024, 1, 7));

  var b = engine.isoWeek('2023-01-01').value;
  t.eq('2023-01-01 belongs to 2022', b.year, 2022);
  t.eq('2023-01-01 is week 52', b.week, 52);
  t.eq('2023-01-01 is Sunday', b.weekday, 6);
  t.eq('2022 week 52 starts 2022-12-26', b.start, date(2022, 12, 26));

  var c = engine.isoWeek('2024-12-30').value;
  t.eq('2024-12-30 belongs to 2025', c.year, 2025);
  t.eq('2024-12-30 is week 1', c.week, 1);
  t.eq('2025 week 1 ends 2025-01-05', c.end, date(2025, 1, 5));

  var d1 = engine.isoWeek('2020-12-31').value;
  t.eq('2020-12-31 is week 53', d1.week, 53);
  t.eq('2020 has 53 weeks', engine.weeksInYear(2020), 53);
  t.eq('2021-01-01 still week 53 of 2020', engine.isoWeek('2021-01-01').value.week, 53);
  t.eq('2024 has 52 weeks', engine.weeksInYear(2024), 52);
  t.eq('2025 has 52 weeks', engine.weeksInYear(2025), 52);
  t.eq('2026 has 53 weeks', engine.weeksInYear(2026), 53);

  var e = engine.isoWeek('2025-12-29').value;
  t.eq('2025-12-29 belongs to 2026', e.year, 2026);
  t.eq('2025-12-29 is week 1', e.week, 1);

  var r1 = engine.weekRange(2024, 1).value;
  t.eq('weekRange 2024-W01 start', r1.start, date(2024, 1, 1));
  t.eq('weekRange 2024-W01 end', r1.end, date(2024, 1, 7));
  t.eq('weekRange 2024-W01 total', r1.total, 52);
  var r2 = engine.weekRange(2023, 52).value;
  t.eq('weekRange 2023-W52 start', r2.start, date(2023, 12, 25));
  t.eq('weekRange 2023-W52 end', r2.end, date(2023, 12, 31));
  t.eq('weekRange rejects week 53 in 2024', engine.weekRange(2024, 53), { ok: false, error: 'range' });
  t.eq('weekRange rejects week 0', engine.weekRange(2024, 0), { ok: false, error: 'range' });
  t.eq('weekRange rejects year 0', engine.weekRange(0, 1), { ok: false, error: 'range' });
  t.eq('weekRange rejects fractional week', engine.weekRange(2024, 1.5),
    { ok: false, error: 'bad_value' });

  t.eq('weekdayIndex Monday', engine.weekdayIndex(2024, 1, 1), 0);
  t.eq('weekdayIndex Sunday', engine.weekdayIndex(2024, 1, 7), 6);
  t.eq('weekdayIndex leap Thursday', engine.weekdayIndex(2024, 2, 29), 3);

  t.eq('parseDate rejects Feb 30', engine.parseDate('2024-02-30'), null);
  t.eq('parseDate rejects unpadded day', engine.parseDate('2024-2-1'), null);
  t.eq('isoWeek rejects invalid date', engine.isoWeek('2023-02-29'),
    { ok: false, error: 'bad_value' });
  t.eq('formatDate pads', engine.formatDate(date(2024, 2, 9)), { ok: true, value: '2024-02-09' });

  t.eq('addDays across leap day', engine.addDays(date(2024, 2, 28), 1),
    { ok: true, value: date(2024, 2, 29) });
  t.eq('addDays into March', engine.addDays(date(2024, 2, 29), 1),
    { ok: true, value: date(2024, 3, 1) });
  t.eq('addDays back across year', engine.addDays(date(2024, 1, 1), -1),
    { ok: true, value: date(2023, 12, 31) });
  t.eq('addDays rejects fractional amount', engine.addDays(date(2024, 1, 1), 1.5),
    { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
