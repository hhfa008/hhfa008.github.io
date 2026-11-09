#!/usr/bin/env node
'use strict';

/*
 * Tests for tools/unix-timestamp-converter/index.html
 * Run: node tools/tests/unix-timestamp-converter.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var SLUG = 'unix-timestamp-converter';
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

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  t.eq('isoUTC(0)', engine.isoUTC(0), { ok: true, value: '1970-01-01T00:00:00.000Z' });
  t.eq('isoUTC(1700000000000)', engine.isoUTC(1700000000000),
    { ok: true, value: '2023-11-14T22:13:20.000Z' });
  t.eq('isoUTC(-1)', engine.isoUTC(-1), { ok: true, value: '1969-12-31T23:59:59.999Z' });
  t.eq('isoUTC rejects NaN', engine.isoUTC(NaN), { ok: false, error: 'bad_value' });
  t.eq('isoUTC rejects out-of-range', engine.isoUTC(8640000000000001),
    { ok: false, error: 'range' });

  t.eq('partsFromMs(0)', engine.partsFromMs(0), {
    ok: true, value: { y: 1970, m: 1, d: 1, hh: 0, mm: 0, ss: 0, milli: 0 }
  });
  t.eq('partsFromMs(-1)', engine.partsFromMs(-1), {
    ok: true, value: { y: 1969, m: 12, d: 31, hh: 23, mm: 59, ss: 59, milli: 999 }
  });
  t.eq('partsFromMs leap day', engine.partsFromMs(Date.UTC(2024, 1, 29, 12, 0, 0)).value,
    { y: 2024, m: 2, d: 29, hh: 12, mm: 0, ss: 0, milli: 0 });

  t.eq('detectUnit seconds', engine.detectUnit(1700000000), { ok: true, value: 's' });
  t.eq('detectUnit milliseconds', engine.detectUnit(1700000000000), { ok: true, value: 'ms' });
  t.eq('detectUnit below boundary', engine.detectUnit(99999999999), { ok: true, value: 's' });
  t.eq('detectUnit at boundary', engine.detectUnit(100000000000), { ok: true, value: 'ms' });
  t.eq('detectUnit negative seconds', engine.detectUnit(-1700000000), { ok: true, value: 's' });
  t.eq('detectUnit rejects strings', engine.detectUnit('1700000000'), { ok: false, error: 'bad_value' });

  t.eq('toMs auto seconds', engine.toMs(1700000000, 'auto'),
    { ok: true, value: { ms: 1700000000000, unit: 's' } });
  t.eq('toMs forced seconds', engine.toMs(1, 's'),
    { ok: true, value: { ms: 1000, unit: 's' } });
  t.eq('toMs milliseconds', engine.toMs(1500, 'ms'),
    { ok: true, value: { ms: 1500, unit: 'ms' } });
  t.eq('toMs zero', engine.toMs(0, 'auto'),
    { ok: true, value: { ms: 0, unit: 's' } });
  t.eq('toMs rejects unknown unit', engine.toMs(1, 'min'), { ok: false, error: 'bad_unit' });
  t.eq('toMs rejects overflow', engine.toMs(9e15, 'ms'), { ok: false, error: 'range' });
  t.eq('toMs rejects strings', engine.toMs('1', 's'), { ok: false, error: 'bad_value' });

  t.eq('toUnix floors positive ms', engine.toUnix(1700000000123, 's'), { ok: true, value: 1700000000 });
  t.eq('toUnix floors negative ms', engine.toUnix(-1, 's'), { ok: true, value: -1 });
  t.eq('toUnix milliseconds', engine.toUnix(1700000000123, 'ms'),
    { ok: true, value: 1700000000123 });
  t.eq('toUnix rejects unknown unit', engine.toUnix(1, 'min'), { ok: false, error: 'bad_unit' });

  t.eq('parseIso epoch', engine.parseIso('2023-11-14T22:13:20Z'), { ok: true, value: 1700000000000 });
  t.eq('parseIso milliseconds fraction', engine.parseIso('2023-11-14T22:13:20.123Z'),
    { ok: true, value: 1700000000123 });
  t.eq('parseIso positive offset', engine.parseIso('2023-11-15T06:13:20+08:00'),
    { ok: true, value: 1700000000000 });
  t.eq('parseIso negative offset', engine.parseIso('2023-11-14T22:13:20-05:00'),
    { ok: true, value: 1700018000000 });
  t.eq('parseIso date only is UTC midnight', engine.parseIso('1970-01-01'), { ok: true, value: 0 });
  t.eq('parseIso before epoch', engine.parseIso('1969-12-31T23:59:59.999Z'), { ok: true, value: -1 });
  t.eq('parseIso rejects Feb 30', engine.parseIso('2024-02-30T00:00:00Z'),
    { ok: false, error: 'bad_value' });
  t.eq('parseIso rejects hour 24', engine.parseIso('2024-01-01T24:00:00Z'),
    { ok: false, error: 'bad_value' });
  t.eq('parseIso round-trips negative', engine.parseIso(engine.isoUTC(-1).value).value, -1);
  t.eq('parseIso round-trips milliseconds',
    engine.parseIso(engine.isoUTC(1700000000123).value).value, 1700000000123);

  t.eq('isoWithOffset +08:00', engine.isoWithOffset(0, 480),
    { ok: true, value: '1970-01-01T08:00:00.000+08:00' });
  t.eq('isoWithOffset -05:00', engine.isoWithOffset(0, -300),
    { ok: true, value: '1969-12-31T19:00:00.000-05:00' });
  t.eq('isoWithOffset UTC', engine.isoWithOffset(0, 0),
    { ok: true, value: '1970-01-01T00:00:00.000+00:00' });
  t.eq('isoWithOffset rejects strings', engine.isoWithOffset(0, '480'),
    { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
