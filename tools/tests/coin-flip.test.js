#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'coin-flip';
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

  var one = engine.flip(1, lib.mulberry32(1));
  t.ok('flip(1) returns one outcome', one.ok && one.sequence.length === 1);
  t.eq('flip(1) heads + tails equals 1', one.heads + one.tails, 1);
  t.ok('flip(1) outcome is H or T', one.sequence[0] === 'H' || one.sequence[0] === 'T');

  var many = engine.flip(1000, lib.mulberry32(7));
  t.eq('flip(1000) heads + tails equals 1000', many.heads + many.tails, 1000);
  t.eq('flip(1000) sequence length is 1000', many.sequence.length, 1000);
  t.ok('sequence only contains H and T', many.sequence.every(function (s) { return s === 'H' || s === 'T'; }));
  t.near('percentages sum to 100', many.headsPct + many.tailsPct, 100, 1e-9);
  t.near('heads percentage matches the count', many.headsPct, many.heads * 100 / 1000, 1e-12);

  t.eq('flip is deterministic for the same rng',
    engine.flip(50, lib.mulberry32(99)).sequence,
    engine.flip(50, lib.mulberry32(99)).sequence);

  t.eq('flip(0) is rejected', engine.flip(0, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('negative count is rejected', engine.flip(-5, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('fractional count is rejected', engine.flip(2.5, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('count above 10000 is rejected', engine.flip(10001, lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('string count is rejected', engine.flip('10', lib.mulberry32(1)), { ok: false, error: 'bad_count' });
  t.eq('missing rng is rejected', engine.flip(10, null), { ok: false, error: 'bad_rng' });

  var allHeads = engine.flip(64, function () { return 0; });
  t.eq('rng 0 produces all heads', allHeads.heads, 64);
  var allTails = engine.flip(64, function () { return 3 / 4294967296; });
  t.eq('an odd 32-bit draw produces all tails', allTails.tails, 64);

  var big = engine.flip(10000, lib.mulberry32(2024));
  t.ok('10000 flips are allowed', big.ok && big.sequence.length === 10000);
  t.ok('10000 flips stay near 50%', big.heads > 4800 && big.heads < 5200,
    'heads=' + big.heads);

  var singlePct = engine.flip(1, lib.mulberry32(3));
  t.ok('single flip percentage is 0 or 100',
    (singlePct.heads === 1 && singlePct.headsPct === 100) ||
    (singlePct.tails === 1 && singlePct.tailsPct === 100));

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 10 assertions', total >= 10, 'found ' + total);
  return total + ' assertions';
});

t.done();
