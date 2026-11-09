#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'rent-split-calculator';
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
  var refs = lib.externalRefs(html);
  t.eq('externalRefs is empty', refs, []);

  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
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
  t.ok('engine does not use Math.random',
    !/\bMath\s*\.\s*random\s*\(/.test(engineCode));

  return (bytes / 1024).toFixed(1) + ' KB';
});

function sum(arr) {
  return arr.reduce(function (a, b) { return a + b; }, 0);
}

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var third = engine.splitByWeights(10000, [1, 1, 1]);
  t.eq('equal thirds shares', third.shares, [3334, 3333, 3333]);
  t.eq('equal thirds sum to total', sum(third.shares), 10000);

  var weighted = engine.splitByWeights(10000, [1, 2, 3]);
  t.eq('weighted shares 1:2:3', weighted.shares, [1667, 3333, 5000]);
  t.eq('weighted shares sum to total', sum(weighted.shares), 10000);

  var decimals = engine.splitByWeights(1000, [1.5, 2.5]);
  t.eq('decimal weights 1.5:2.5', decimals.shares, [375, 625]);
  t.eq('decimal weights sum to total', sum(decimals.shares), 1000);

  var zeroWeight = engine.splitByWeights(100, [0, 1]);
  t.eq('zero weight pays nothing', zeroWeight.shares, [0, 100]);
  t.eq('single member takes all', engine.splitByWeights(5000, [1]).shares, [5000]);
  t.eq('equally split zero total', engine.equalSplit(0, 3).shares, [0, 0, 0]);

  t.eq('all zero weights rejected', engine.splitByWeights(100, [0, 0]), { ok: false, error: 'zero_weights' });
  t.eq('negative weight rejected', engine.splitByWeights(100, [1, -1]), { ok: false, error: 'bad_weight' });
  t.eq('non-numeric weight rejected', engine.splitByWeights(100, [1, '2']), { ok: false, error: 'bad_weight' });
  t.eq('empty weights rejected', engine.splitByWeights(100, []), { ok: false, error: 'bad_weights' });
  t.eq('non-array weights rejected', engine.splitByWeights(100, null), { ok: false, error: 'bad_weights' });
  t.eq('negative total rejected', engine.splitByWeights(-1, [1]), { ok: false, error: 'bad_total' });
  t.eq('fractional cent rejected', engine.splitByWeights(10.5, [1]), { ok: false, error: 'bad_total' });

  t.eq('equalSplit 100 into 3', engine.equalSplit(100, 3).shares, [34, 33, 33]);
  t.eq('equalSplit rejects zero count', engine.equalSplit(100, 0), { ok: false, error: 'bad_count' });

  var total = engine.splitTotal(450000, 60000, [15, 12]);
  t.eq('splitTotal shares', total.shares, [283333, 226667]);
  t.eq('splitTotal total', total.total, 510000);
  t.eq('splitTotal keeps rent', total.rent, 450000);
  t.eq('splitTotal keeps extras', total.extras, 60000);
  t.eq('splitTotal conservation', sum(total.shares), total.total);
  t.eq('splitTotal rejects bad extras', engine.splitTotal(100, -1, [1]), { ok: false, error: 'bad_extras' });

  t.eq('validateWeights valid', engine.validateWeights([1, 2.5]), null);
  t.eq('validateWeights zero sum', engine.validateWeights([0, 0]), 'zero_weights');
  t.eq('validateWeights negative', engine.validateWeights([1, -2]), 'bad_weight');

  // Conservation check across uneven weights and totals.
  var cases = [
    [1, 1, 1, 1, 1, 1, 1],
    [3, 1, 1],
    [0.1, 0.2, 0.7],
    [12.5, 7.25, 3]
  ];
  var totals = [1, 99, 12345, 987654];
  var conserved = true;
  cases.forEach(function (weights) {
    totals.forEach(function (amount) {
      var r = engine.splitByWeights(amount, weights);
      if (!r.ok || sum(r.shares) !== amount) conserved = false;
    });
  });
  t.ok('shares always sum to total', conserved);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
