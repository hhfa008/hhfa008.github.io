#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'name-picker';
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

  var parsed = engine.parseNames('  张三\n\n李四  \n张三\n王五\n', true);
  t.eq('parseNames drops blank lines and trims', parsed.names, ['张三', '李四', '王五']);
  t.eq('parseNames reports one duplicate', parsed.removed, 1);
  t.eq('parseNames keeps duplicates when dedupe is off',
    engine.parseNames('a\na\nb', false).names, ['a', 'a', 'b']);
  t.eq('parseNames accepts an empty string', engine.parseNames('').names, []);
  t.eq('parseNames rejects a non-string', engine.parseNames(42), { ok: false, error: 'bad_value' });

  t.eq('pickOne rejects an empty list', engine.pickOne([], lib.mulberry32(1)), { ok: false, error: 'empty_input' });
  t.eq('pickOne rejects a missing rng', engine.pickOne(['a'], null), { ok: false, error: 'bad_rng' });
  t.eq('pickOne with one name returns index 0',
    engine.pickOne(['solo'], lib.mulberry32(2)), { ok: true, index: 0, value: 'solo' });

  var p1 = engine.pickOne(['a', 'b', 'c', 'd'], lib.mulberry32(33));
  var p2 = engine.pickOne(['a', 'b', 'c', 'd'], lib.mulberry32(33));
  t.eq('pickOne is deterministic for the same rng', p1, p2);
  t.ok('pickOne index stays in bounds', p1.index >= 0 && p1.index < 4);

  var list = ['a', 'b', 'c', 'd', 'e'];
  var sh = engine.shuffle(list, lib.mulberry32(11));
  t.ok('shuffle is a permutation', sh.ok && sh.items.slice().sort().join(',') === list.slice().sort().join(','));
  t.eq('shuffle preserves the original array', list, ['a', 'b', 'c', 'd', 'e']);
  t.eq('shuffle is reproducible', engine.shuffle(list, lib.mulberry32(11)).items, sh.items);
  t.eq('shuffle accepts an empty list', engine.shuffle([], lib.mulberry32(1)).items, []);
  t.eq('shuffle keeps a one-item list', engine.shuffle(['x'], lib.mulberry32(1)).items, ['x']);
  t.eq('shuffle rejects a non-array', engine.shuffle('abc', lib.mulberry32(1)), { ok: false, error: 'bad_value' });

  var pool = ['n1', 'n2', 'n3', 'n4', 'n5'];
  var picked = [];
  var rng = lib.mulberry32(2026);
  while (pool.length) {
    var draw = engine.pickOne(pool, rng);
    if (!draw.ok) break;
    picked.push(draw.value);
    pool.splice(draw.index, 1);
  }
  t.eq('five draws without replacement cover all names',
    picked.slice().sort(), ['n1', 'n2', 'n3', 'n4', 'n5']);
  t.eq('drawing until empty leaves no duplicates', new Set(picked).size, 5);
  t.eq('the remaining pool is empty at the end', pool, []);

  var counts = { a: 0, b: 0, c: 0, d: 0 };
  var br = lib.mulberry32(88);
  for (var i = 0; i < 4000; i++) counts[engine.pickOne(['a', 'b', 'c', 'd'], br).value]++;
  var fair = Object.keys(counts).every(function (k) { return counts[k] > 850 && counts[k] < 1150; });
  t.ok('pickOne is roughly uniform over four names', fair, JSON.stringify(counts));

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
