#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'decision-wheel';
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

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* reported below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* reported below */ }

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
  var canonical = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
  t.ok('canonical correct', !!canonical && canonical[1] === EXPECTED_CANONICAL);
  t.ok('author is Devin', /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('robots meta present', /<meta[^>]+name\s*=\s*["']robots["']/i.test(html));
  t.ok('inline data URI favicon', /<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  t.ok('wheel SVG is present', /<svg[^>]+id="wheel"/i.test(html));
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

  t.eq('single weight always returns index 0',
    engine.pickIndex([1], function () { return 0; }), { ok: true, index: 0 });
  t.eq('equal weights at u=0 return index 0',
    engine.pickIndex([1, 1], function () { return 0; }), { ok: true, index: 0 });
  t.eq('equal weights near u=1 return the last index',
    engine.pickIndex([1, 1], function () { return 0.999; }), { ok: true, index: 1 });
  t.eq('weight 3/1 boundary below 0.75 picks index 0',
    engine.pickIndex([3, 1], function () { return 0.74; }), { ok: true, index: 0 });
  t.eq('weight 3/1 boundary above 0.75 picks index 1',
    engine.pickIndex([3, 1], function () { return 0.76; }), { ok: true, index: 1 });

  t.eq('empty weights are rejected', engine.pickIndex([], function () { return 0; }), { ok: false, error: 'empty_input' });
  t.eq('non-array weights are rejected', engine.pickIndex(3, function () { return 0; }), { ok: false, error: 'bad_value' });
  t.eq('zero weight is rejected', engine.pickIndex([1, 0], function () { return 0; }), { ok: false, error: 'bad_weight' });
  t.eq('negative weight is rejected', engine.pickIndex([1, -1], function () { return 0; }), { ok: false, error: 'bad_weight' });
  t.eq('NaN weight is rejected', engine.pickIndex([1, NaN], function () { return 0; }), { ok: false, error: 'bad_weight' });
  t.eq('missing rng is rejected', engine.pickIndex([1, 2], null), { ok: false, error: 'bad_rng' });

  var rng = lib.mulberry32(2024);
  var hits = [0, 0];
  for (var i = 0; i < 4000; i++) hits[engine.pickIndex([3, 1], rng).index]++;
  t.ok('3:1 weights give roughly 75% to index 0',
    hits[0] > 2880 && hits[0] < 3120, JSON.stringify(hits));

  t.eq('pickIndex is deterministic',
    engine.pickIndex([1, 2, 3, 4], lib.mulberry32(9)),
    engine.pickIndex([1, 2, 3, 4], lib.mulberry32(9)));

  t.eq('pickWeighted returns the matching item',
    engine.pickWeighted(['a', 'b'], [1, 1], function () { return 0.9; }),
    { ok: true, index: 1, item: 'b' });
  t.eq('pickWeighted rejects mismatched lengths',
    engine.pickWeighted(['a'], [1, 2], function () { return 0; }), { ok: false, error: 'bad_value' });

  var two = engine.segmentAngles([1, 1]);
  t.eq('two equal weights share half each', two.segments.map(function (s) { return s.share; }), [0.5, 0.5]);
  t.eq('two equal weights have mids at 90 and 270',
    two.segments.map(function (s) { return s.mid; }), [90, 270]);
  t.eq('two equal spans end at 360', two.segments.map(function (s) { return s.end; }), [180, 360]);

  var four = engine.segmentAngles([1, 1, 1, 1]);
  t.eq('four equal weights have mids at 45/135/225/315',
    four.segments.map(function (s) { return s.mid; }), [45, 135, 225, 315]);
  t.near('all shares sum to 1',
    four.segments.reduce(function (a, s) { return a + s.share; }, 0), 1, 1e-12);

  var skew = engine.segmentAngles([3, 1]);
  t.eq('3:1 weights produce 0.75 and 0.25 shares',
    skew.segments.map(function (s) { return s.share; }), [0.75, 0.25]);
  t.eq('a 3:1 split puts the first boundary at 270 degrees', skew.segments[0].end, 270);
  t.eq('empty segmentAngles is rejected', engine.segmentAngles([]), { ok: false, error: 'empty_input' });
  t.eq('zero weight angles are rejected', engine.segmentAngles([1, 0]), { ok: false, error: 'bad_weight' });

  var top = engine.polarToCartesian(0, 0, 10, 0);
  var right = engine.polarToCartesian(0, 0, 10, 90);
  var bottom = engine.polarToCartesian(0, 0, 10, 180);
  var left = engine.polarToCartesian(0, 0, 10, 270);
  t.near('angle 0 is the top x', top.x, 0);
  t.near('angle 0 is the top y', top.y, -10);
  t.near('angle 90 is the right x', right.x, 10);
  t.near('angle 90 is the right y', right.y, 0);
  t.near('angle 180 is the bottom y', bottom.y, 10);
  t.near('angle 270 is the left x', left.x, -10);

  var full = engine.sectorPath(160, 160, 140, 0, 360);
  t.eq('a full circle path uses two arcs', (full.path.match(/A /g) || []).length, 2);
  var quarter = engine.sectorPath(160, 160, 140, 0, 90);
  t.ok('a 90 degree sector uses the small-arc flag', /A 140 140 0 0 1/.test(quarter.path));
  var wide = engine.sectorPath(160, 160, 140, 0, 200);
  t.ok('a 200 degree sector uses the large-arc flag', /A 140 140 0 1 1/.test(wide.path));
  t.eq('a zero-width sector returns an empty path',
    engine.sectorPath(160, 160, 140, 90, 90), { ok: true, path: '' });
  t.eq('a non-positive radius is rejected', engine.sectorPath(160, 160, 0, 0, 90), { ok: false, error: 'bad_value' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
