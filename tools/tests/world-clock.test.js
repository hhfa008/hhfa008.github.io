#!/usr/bin/env node
'use strict';

/*
 * Tests for tools/world-clock/index.html
 * Run: node tools/tests/world-clock.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var SLUG = 'world-clock';
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

  t.eq('validZone UTC', engine.validZone('UTC'), true);
  t.eq('validZone Shanghai', engine.validZone('Asia/Shanghai'), true);
  t.eq('validZone rejects unknown', engine.validZone('Not/AZone'), false);
  t.eq('validZone rejects empty', engine.validZone(''), false);

  t.eq('zoneParts epoch in UTC', engine.zoneParts(0, 'UTC'),
    { ok: true, value: { y: 1970, m: 1, d: 1, hh: 0, mm: 0, ss: 0 } });
  t.eq('zoneParts epoch in Shanghai', engine.zoneParts(0, 'Asia/Shanghai'),
    { ok: true, value: { y: 1970, m: 1, d: 1, hh: 8, mm: 0, ss: 0 } });
  t.eq('zoneParts rejects unknown zone', engine.zoneParts(0, 'Not/AZone'),
    { ok: false, error: 'bad_value' });

  t.eq('offsetMinutes UTC', engine.offsetMinutes(0, 'UTC'), { ok: true, value: 0 });
  t.eq('offsetMinutes Shanghai', engine.offsetMinutes(0, 'Asia/Shanghai'), { ok: true, value: 480 });
  t.eq('offsetMinutes New York winter', engine.offsetMinutes(Date.UTC(2024, 0, 15, 12), 'America/New_York'),
    { ok: true, value: -300 });
  t.eq('offsetMinutes New York summer', engine.offsetMinutes(Date.UTC(2024, 6, 1, 12), 'America/New_York'),
    { ok: true, value: -240 });
  t.eq('offsetMinutes Kolkata half hour', engine.offsetMinutes(0, 'Asia/Kolkata'),
    { ok: true, value: 330 });

  t.eq('formatOffset +08:00', engine.formatOffset(480), { ok: true, value: '+08:00' });
  t.eq('formatOffset -05:00', engine.formatOffset(-300), { ok: true, value: '-05:00' });
  t.eq('formatOffset +05:45', engine.formatOffset(345), { ok: true, value: '+05:45' });
  t.eq('formatOffset zero', engine.formatOffset(0), { ok: true, value: '+00:00' });
  t.eq('formatOffset rejects strings', engine.formatOffset('480'), { ok: false, error: 'bad_value' });

  var cross = Date.UTC(2024, 0, 1, 23, 30);
  t.eq('zoneParts crosses date in Shanghai', engine.zoneParts(cross, 'Asia/Shanghai').value.d, 2);
  t.eq('dayDelta UTC to Shanghai = +1', engine.dayDelta(cross, 'UTC', 'Asia/Shanghai'),
    { ok: true, value: 1 });
  t.eq('dayDelta same zone = 0', engine.dayDelta(cross, 'UTC', 'UTC'), { ok: true, value: 0 });
  t.eq('dayDelta Shanghai to Los Angeles = -1',
    engine.dayDelta(Date.UTC(2024, 0, 1, 16, 30), 'Asia/Shanghai', 'America/Los_Angeles'),
    { ok: true, value: -1 });

  t.eq('dayNight 6 is day', engine.dayNight(6), { ok: true, value: 'day' });
  t.eq('dayNight 17 is day', engine.dayNight(17), { ok: true, value: 'day' });
  t.eq('dayNight 18 is night', engine.dayNight(18), { ok: true, value: 'night' });
  t.eq('dayNight 5 is night', engine.dayNight(5), { ok: true, value: 'night' });
  t.eq('dayNight rejects 24', engine.dayNight(24), { ok: false, error: 'bad_value' });
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
