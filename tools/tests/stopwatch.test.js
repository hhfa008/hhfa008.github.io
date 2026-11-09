#!/usr/bin/env node
'use strict';

/*
 * Tests for tools/stopwatch/index.html
 * Run: node tools/tests/stopwatch.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var SLUG = 'stopwatch';
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

  t.eq('formatMs(0)', engine.formatMs(0), { ok: true, value: '00:00:00.000' });
  t.eq('formatMs(100)', engine.formatMs(100), { ok: true, value: '00:00:00.100' });
  t.eq('formatMs(3723004)', engine.formatMs(3723004), { ok: true, value: '01:02:03.004' });
  t.eq('formatMs(360000000)', engine.formatMs(360000000), { ok: true, value: '100:00:00.000' });
  t.eq('formatMs rejects negative', engine.formatMs(-1), { ok: false, error: 'bad_value' });
  t.eq('formatMs rejects NaN', engine.formatMs(NaN), { ok: false, error: 'bad_value' });
  t.eq('formatMs rejects strings', engine.formatMs('1000'), { ok: false, error: 'bad_value' });

  t.eq('elapsed with pause total', engine.elapsed(100, 250, 30), { ok: true, value: 180 });
  t.eq('elapsed at start', engine.elapsed(100, 100, 0), { ok: true, value: 0 });
  t.eq('elapsed after two pauses',
    engine.elapsed(5000, 5250, 500), { ok: true, value: 750 });
  t.eq('elapsed rejects backwards clock', engine.elapsed(100, 50, 0), { ok: false, error: 'bad_value' });
  t.eq('elapsed rejects negative paused total', engine.elapsed(100, 200, -1), { ok: false, error: 'bad_value' });
  t.eq('elapsed rejects strings', engine.elapsed('100', 200, 0), { ok: false, error: 'bad_value' });

  t.eq('lapSplit normal', engine.lapSplit(250, 100), { ok: true, value: 150 });
  t.eq('lapSplit zero', engine.lapSplit(100, 100), { ok: true, value: 0 });
  t.eq('lapSplit rejects decreasing totals', engine.lapSplit(100, 250), { ok: false, error: 'order' });
  t.eq('lapSplit rejects negative input', engine.lapSplit(-1, 0), { ok: false, error: 'bad_value' });

  t.eq('summarize totals', engine.summarize([100, 250, 300]), {
    ok: true, value: { count: 3, total: 300, best: 50, average: 100 }
  });
  t.eq('summarize empty', engine.summarize([]), {
    ok: true, value: { count: 0, total: 0, best: null, average: null }
  });
  t.eq('summarize rejects non-monotonic laps', engine.summarize([100, 50]), { ok: false, error: 'bad_value' });
  t.eq('summarize rejects non-array', engine.summarize('x'), { ok: false, error: 'bad_value' });

  t.eq('splitMs parts', engine.splitMs(3723004), {
    ok: true, value: { h: 1, m: 2, s: 3, ms: 4, total: 3723004 }
  });
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
