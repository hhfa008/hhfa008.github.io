#!/usr/bin/env node
'use strict';

/*
 * Tests for tools/timezone-converter/index.html
 * Run: node tools/tests/timezone-converter.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var SLUG = 'timezone-converter';
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

  t.eq('parseLocal basic', engine.parseLocal('2024-01-01T00:00'),
    { ok: true, value: { y: 2024, m: 1, d: 1, hh: 0, mm: 0, ss: 0 } });
  t.eq('parseLocal with seconds', engine.parseLocal('2024-01-01T12:34:56'),
    { ok: true, value: { y: 2024, m: 1, d: 1, hh: 12, mm: 34, ss: 56 } });
  t.eq('parseLocal accepts a space separator', engine.parseLocal('2024-01-01 12:30').ok, true);
  t.eq('parseLocal rejects Feb 30', engine.parseLocal('2024-02-30T00:00'),
    { ok: false, error: 'bad_value' });
  t.eq('parseLocal rejects unpadded month', engine.parseLocal('2024-1-1T00:00'),
    { ok: false, error: 'bad_value' });
  t.eq('parseLocal rejects hour 24', engine.parseLocal('2024-01-01T24:00'),
    { ok: false, error: 'bad_value' });

  var sh = engine.convertZone('2024-01-01T00:00', 'UTC', 'Asia/Shanghai');
  t.eq('UTC to Shanghai epoch', sh.value.epoch, 1704067200000);
  t.eq('UTC to Shanghai wall time', sh.value.to,
    { y: 2024, m: 1, d: 1, hh: 8, mm: 0, ss: 0 });
  t.eq('UTC to Shanghai offsets', [sh.value.offsetFrom, sh.value.offsetTo], [0, 480]);
  t.eq('UTC to Shanghai same day', sh.value.dayDelta, 0);

  var cross = engine.convertZone('2023-12-31T23:30', 'UTC', 'Asia/Shanghai');
  t.eq('cross-day target parts', cross.value.to,
    { y: 2024, m: 1, d: 1, hh: 7, mm: 30, ss: 0 });
  t.eq('cross-day dayDelta', cross.value.dayDelta, 1);

  var summer = engine.convertZone('2024-07-01T12:00', 'UTC', 'America/New_York');
  t.eq('New York summer hour', summer.value.to.hh, 8);
  t.eq('New York summer offset', summer.value.offsetTo, -240);
  var winter = engine.convertZone('2024-01-15T12:00', 'UTC', 'America/New_York');
  t.eq('New York winter hour', winter.value.to.hh, 7);
  t.eq('New York winter offset', winter.value.offsetTo, -300);

  t.eq('seconds are preserved',
    engine.convertZone('2024-01-01T12:34:56', 'UTC', 'UTC').value.epoch, 1704112496000);
  t.eq('unknown zone rejected',
    engine.convertZone('2024-01-01T00:00', 'Not/AZone', 'UTC'), { ok: false, error: 'bad_zone' });
  t.eq('invalid local rejected',
    engine.convertZone('2024-02-30T00:00', 'UTC', 'UTC'), { ok: false, error: 'bad_value' });

  var gap = engine.convertZone('2024-03-10T02:30', 'America/New_York', 'America/New_York');
  t.eq('spring-forward time moves forward', gap.value.from,
    { y: 2024, m: 3, d: 10, hh: 3, mm: 30, ss: 0 });
  var ambiguous = engine.convertZone('2024-11-03T01:30', 'America/New_York', 'America/New_York');
  t.eq('fall-back time uses the earlier offset', ambiguous.value.offsetFrom, -240);
  t.eq('fall-back epoch', ambiguous.value.epoch, 1730611800000);

  t.eq('formatOffset +08:00', engine.formatOffset(480), { ok: true, value: '+08:00' });
  t.eq('formatOffset -05:00', engine.formatOffset(-300), { ok: true, value: '-05:00' });
  t.eq('formatOffset +05:45', engine.formatOffset(345), { ok: true, value: '+05:45' });

  t.eq('formatWall padding', engine.formatWall({ y: 2024, m: 1, d: 2, hh: 3, mm: 4, ss: 5 }),
    { ok: true, value: '2024-01-02T03:04:05' });
  var wall = engine.wallToEpoch({ y: 2024, m: 6, d: 1, hh: 12, mm: 34, ss: 56 }, 'UTC');
  t.eq('wallToEpoch round-trips', engine.zoneParts(wall.value, 'UTC').value,
    { y: 2024, m: 6, d: 1, hh: 12, mm: 34, ss: 56 });
  t.eq('sameWall true', engine.sameWall(
    { y: 2024, m: 1, d: 1, hh: 0, mm: 0, ss: 0 },
    { y: 2024, m: 1, d: 1, hh: 0, mm: 0, ss: 0 }), true);
  t.eq('sameWall false', engine.sameWall(
    { y: 2024, m: 1, d: 1, hh: 0, mm: 0, ss: 0 },
    { y: 2024, m: 1, d: 1, hh: 0, mm: 0, ss: 1 }), false);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
