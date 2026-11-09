#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'cooking-converter';
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
} catch (e) {
  /* asserted below */
}
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) {
  /* asserted below */
}

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
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));

  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var v;

  v = engine.volumeToMl(1, 'cup');
  t.eq('volumeToMl(1,cup) ok', v.ok, true);
  t.near('1 cup = 236.588 ml', v.value, 236.5882365, 1e-6);

  v = engine.volumeToMl(1, 'tbsp');
  t.near('1 tbsp = 14.787 ml', v.value, 14.7867648, 1e-6);

  v = engine.volumeToMl(1, 'tsp');
  t.near('1 tsp = 4.929 ml', v.value, 4.92892159, 1e-6);

  v = engine.volumeToMl(1, 'floz');
  t.near('1 fl oz = 29.574 ml', v.value, 29.5735295625, 1e-6);

  v = engine.weightToG(1, 'oz');
  t.near('1 oz = 28.3495 g', v.value, 28.349523125, 1e-6);

  v = engine.weightToG(1, 'lb');
  t.near('1 lb = 453.59237 g', v.value, 453.59237, 1e-6);

  v = engine.volumeToMl(0, 'cup');
  t.eq('0 cup = 0 ml', v, { ok: true, value: 0 });

  t.eq('negative amount rejected', engine.volumeToMl(-1, 'cup'), { ok: false, error: 'range' });
  t.eq('NaN amount rejected', engine.volumeToMl(NaN, 'cup'), { ok: false, error: 'bad_value' });
  t.eq('string amount rejected', engine.volumeToMl('1', 'cup'), { ok: false, error: 'bad_value' });
  t.eq('unknown volume unit rejected', engine.volumeToMl(1, 'gallon'), { ok: false, error: 'bad_unit' });
  t.eq('weight unit on volume fn rejected', engine.volumeToMl(1, 'g'), { ok: false, error: 'bad_unit' });
  t.eq('unknown weight unit rejected', engine.weightToG(1, 'stone'), { ok: false, error: 'bad_unit' });

  v = engine.convertIngredient(1, 'cup', 'ml', 'water');
  t.ok('cup water to ml ok', v.ok === true);
  t.near('1 cup water ≈ 236.588 ml', v.value, 236.5882365, 1e-6);

  v = engine.convertIngredient(1, 'cup', 'g', 'flour');
  t.near('1 cup flour ≈ 125.39 g', v.value, 236.5882365 * 0.53, 1e-6);

  v = engine.convertIngredient(1, 'tbsp', 'g', 'sugar');
  t.near('1 tbsp sugar ≈ 12.57 g', v.value, 14.7867648 * 0.85, 1e-6);

  v = engine.convertIngredient(100, 'ml', 'g', 'milk');
  t.near('100 ml milk = 103 g', v.value, 103, 1e-9);

  v = engine.convertIngredient(100, 'g', 'ml', 'butter');
  t.near('100 g butter ≈ 109.77 ml', v.value, 100 / 0.911, 1e-6);

  v = engine.convertIngredient(1, 'lb', 'ml', 'water');
  t.near('1 lb water = 453.592 ml', v.value, 453.59237, 1e-6);

  var temp = engine.convertIngredient(100, 'g', 'cup', 'flour');
  var back = engine.convertIngredient(temp.value, 'cup', 'g', 'flour');
  t.near('flour g→cup→g round trip', back.value, 100, 1e-9);

  t.eq('same-unit identity', engine.convertIngredient(2, 'cup', 'cup', 'water').value, 2);
  t.eq('zero amount converts to zero', engine.convertIngredient(0, 'cup', 'g', 'water').value, 0);
  t.eq('unknown ingredient rejected', engine.convertIngredient(1, 'cup', 'g', 'quinoa'),
    { ok: false, error: 'not_found' });
  t.eq('non-string ingredient rejected', engine.convertIngredient(1, 'cup', 'g', null),
    { ok: false, error: 'not_found' });
  t.eq('negative amount in convertIngredient rejected', engine.convertIngredient(-1, 'cup', 'g', 'water'),
    { ok: false, error: 'range' });
  t.eq('bad from unit in convertIngredient rejected', engine.convertIngredient(1, 'gallon', 'g', 'water'),
    { ok: false, error: 'bad_unit' });

  t.eq('ingredients list', engine.ingredients(), ['water', 'flour', 'sugar', 'rice', 'butter', 'milk']);
  t.eq('densityOf water', engine.densityOf('water'), { ok: true, value: 1 });
  t.eq('densityOf flour', engine.densityOf('flour'), { ok: true, value: 0.53 });
  t.eq('densityOf unknown', engine.densityOf('quinoa'), { ok: false, error: 'not_found' });
  t.eq('unitFactor(g) is weight', engine.unitFactor('g'), { ok: true, kind: 'weight', value: 1 });
  t.eq('unitFactor(cup) is volume', engine.unitFactor('cup'),
    { ok: true, kind: 'volume', value: 236.5882365 });
  t.eq('unitFactor unknown', engine.unitFactor('stone'), { ok: false, error: 'bad_unit' });

  return 'density and unit table assertions';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
