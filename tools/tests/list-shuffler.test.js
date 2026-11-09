#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'list-shuffler';
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

  var parsed = engine.parseList('  a  \n\n b\nb\n  \n');
  t.eq('parseList trims and drops blank lines', parsed.items, ['a', 'b', 'b']);
  t.eq('parseList keeps duplicates and counts removals', parsed.removed, 3);
  t.eq('parseList accepts an empty string', engine.parseList('').items, []);
  t.eq('parseList rejects a non-string', engine.parseList(12), { ok: false, error: 'bad_value' });

  var list = [];
  for (var i = 0; i < 20; i++) list.push('item-' + i);
  var shuffled = engine.shuffleSeeded(list, 7);
  t.ok('shuffleSeeded returns all items', shuffled.ok && shuffled.items.length === 20);
  t.eq('shuffleSeeded preserves the multiset',
    shuffled.items.slice().sort(), list.slice().sort());
  t.eq('shuffleSeeded keeps the same item count', new Set(shuffled.items).size, 20);
  t.eq('shuffleSeeded does not mutate the input', list.length, 20);
  t.eq('shuffleSeeded does not mutate the input order', list[0], 'item-0');

  t.eq('same numeric seed reproduces the order',
    engine.shuffleSeeded(list, 7).items, shuffled.items);
  t.eq('same text seed reproduces the order',
    engine.shuffleSeeded(list, 'demo-seed').items,
    engine.shuffleSeeded(list, 'demo-seed').items);
  t.ok('different seeds produce a different order',
    engine.shuffleSeeded(list, 1).items.join(',') !== engine.shuffleSeeded(list, 2).items.join(','));

  t.eq('empty list shuffles to empty', engine.shuffleSeeded([], 1).items, []);
  t.eq('single item stays put', engine.shuffleSeeded(['only'], 1).items, ['only']);

  t.eq('hashSeed is stable for text', engine.hashSeed('abc'), engine.hashSeed('abc'));
  t.ok('hashSeed returns a 32-bit unsigned integer',
    engine.hashSeed('abc') >= 0 && engine.hashSeed('abc') <= 4294967295 &&
    Math.floor(engine.hashSeed('abc')) === engine.hashSeed('abc'));
  t.eq('hashSeed of an empty string is the FNV offset', engine.hashSeed(''), 2166136261);
  t.eq('numeric seedToInt is preserved', engine.seedToInt(123), 123);
  t.eq('text seedToInt matches hashSeed', engine.seedToInt('abc'), engine.hashSeed('abc'));
  t.eq('empty text seed is rejected', engine.seedToInt(''), null);
  t.eq('fractional seed is rejected', engine.seedToInt(1.5), null);

  t.eq('shuffleSeeded rejects an empty seed', engine.shuffleSeeded(list, ''), { ok: false, error: 'bad_seed' });
  t.eq('shuffleSeeded rejects a missing seed', engine.shuffleSeeded(list), { ok: false, error: 'bad_seed' });
  t.eq('shuffleSeeded rejects a non-array', engine.shuffleSeeded('abc', 1), { ok: false, error: 'bad_value' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
