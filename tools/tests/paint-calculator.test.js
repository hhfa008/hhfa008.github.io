#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'paint-calculator';
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
} catch (e) { /* asserted below */ }
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) { /* asserted below */ }

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
  t.eq('externalRefs is empty', lib.externalRefs(html), []);
  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (item) { return item && item['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
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

  var r;

  r = engine.wallArea(5, 4, 2.7, 4);
  t.eq('wallArea ok', r.ok, true);
  t.near('wall area before openings = 48.6', r.wall, 48.6, 1e-9);
  t.near('net wall area = 44.6', r.value, 44.6, 1e-9);
  t.eq('openings reported', r.openings, 4);

  r = engine.wallArea(5, 4, 2.7, 0);
  t.near('no openings keeps full wall area', r.value, 48.6, 1e-9);

  r = engine.wallArea(5, 4, 2.7);
  t.near('missing openings defaults to 0', r.value, 48.6, 1e-9);

  t.eq('zero length rejected', engine.wallArea(0, 4, 2.7, 0), { ok: false, error: 'range' });
  t.eq('negative width rejected', engine.wallArea(5, -4, 2.7, 0), { ok: false, error: 'range' });
  t.eq('negative openings rejected', engine.wallArea(5, 4, 2.7, -1), { ok: false, error: 'range' });
  t.eq('openings larger than wall rejected', engine.wallArea(1, 1, 1, 100),
    { ok: false, error: 'range' });
  t.eq('string dimension rejected', engine.wallArea('5', 4, 2.7, 0), { ok: false, error: 'bad_value' });

  r = engine.paintLiters(44.6, 2, 10);
  t.eq('paintLiters ok', r.ok, true);
  t.near('44.6 m² × 2 coats ÷ 10 = 8.92 L', r.value, 8.92, 1e-9);

  r = engine.paintLiters(0, 2, 10);
  t.eq('zero area → 0 litres', r.value, 0);

  t.eq('zero coverage rejected', engine.paintLiters(10, 2, 0), { ok: false, error: 'range' });
  t.eq('zero coats rejected', engine.paintLiters(10, 0, 10), { ok: false, error: 'bad_value' });
  t.eq('fractional coats rejected', engine.paintLiters(10, 1.5, 10), { ok: false, error: 'bad_value' });
  t.eq('negative area rejected', engine.paintLiters(-1, 2, 10), { ok: false, error: 'range' });
  t.eq('NaN area rejected', engine.paintLiters(NaN, 2, 10), { ok: false, error: 'bad_value' });

  r = engine.buckets(8.92, 5);
  t.eq('8.92 L needs 2 buckets', r.value, 2);
  t.near('purchased litres = 10', r.purchased, 10, 1e-9);
  t.near('leftover = 1.08 L', r.leftover, 1.08, 1e-9);

  t.eq('exact multiple does not overshoot', engine.buckets(10, 5).value, 2);
  t.eq('tiny float overshoot does not add a bucket', engine.buckets(0.1 + 0.2, 0.3).value, 1);
  t.eq('zero litres → zero buckets', engine.buckets(0, 5).value, 0);
  t.eq('zero bucket size rejected', engine.buckets(1, 0), { ok: false, error: 'range' });
  t.eq('negative litres rejected', engine.buckets(-1, 5), { ok: false, error: 'range' });

  r = engine.calculateTotal([
    { name: 'A', length: 5, width: 4, height: 2.7, openings: 4 },
    { name: 'B', length: 4, width: 3, height: 2.7, openings: 2 }
  ], 2, 10, 5);
  t.eq('multi-room total ok', r.ok, true);
  t.near('room B net = 35.8', r.rooms[1].net, 35.8, 1e-9);
  t.near('total net = 80.4', r.netArea, 80.4, 1e-9);
  t.near('total litres = 16.08', r.liters, 16.08, 1e-9);
  t.eq('total buckets = 4', r.buckets, 4);
  t.near('total purchased = 20 L', r.purchased, 20, 1e-9);
  t.near('total leftover = 3.92', r.leftover, 3.92, 1e-9);
  t.eq('per-room rows', r.rooms.length, 2);

  t.eq('empty rooms rejected', engine.calculateTotal([], 2, 10, 5), { ok: false, error: 'empty_input' });
  t.eq('non-array rooms rejected', engine.calculateTotal(null, 2, 10, 5), { ok: false, error: 'empty_input' });
  t.eq('bad room row rejected', engine.calculateTotal([null], 2, 10, 5), { ok: false, error: 'bad_value' });
  t.eq('bad room dimension propagates', engine.calculateTotal([
    { length: 0, width: 3, height: 2.7, openings: 0 }
  ], 2, 10, 5), { ok: false, error: 'range' });

  return 'wall area, litres, buckets and multi-room totals';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
