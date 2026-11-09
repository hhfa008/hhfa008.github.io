'use strict';

/*
 * Tests for tools/percentage-calculator/.
 * Run with: node tools/tests/percentage-calculator.test.js
 */

var path = require('path');
var fs = require('fs');
var lib = require('./lib.js');

var DIR = path.join(__dirname, '..', 'percentage-calculator');
var html = lib.page(DIR);
var t = lib.suite('percentage-calculator');
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var I18N = lib.evalScript(html, 'i18n', 'TOOL_I18N');

function value(res) { return res && res.ok ? res.value : NaN; }
function code(res) { return res && res.ok ? null : (res && res.error); }

/* ------------------------------------------------------------------ engine */

t.group('engine exports', function () {
  t.ok('percentOf is a function', typeof E.percentOf === 'function');
  t.ok('whatPercent is a function', typeof E.whatPercent === 'function');
  t.ok('percentChange is a function', typeof E.percentChange === 'function');
  t.ok('applyPercent is a function', typeof E.applyPercent === 'function');
  t.ok('formatNumber is a function', typeof E.formatNumber === 'function');
  t.ok('round is a function', typeof E.round === 'function');

  var src = lib.scriptCode(html, 'engine');
  t.ok('engine does not touch document', !/\bdocument\b/.test(src));
  t.ok('engine does not touch window', !/\bwindow\b/.test(src));
});

t.group('percentOf', function () {
  t.near('15% of 200 = 30', value(E.percentOf(15, 200)), 30, 1e-12);
  t.near('0% of 500 = 0', value(E.percentOf(0, 500)), 0, 1e-12);
  t.near('-10% of 200 = -20', value(E.percentOf(-10, 200)), -20, 1e-12);
  t.near('12.5% of 80 = 10', value(E.percentOf(12.5, 80)), 10, 1e-12);
  t.near('10% of -200 = -20', value(E.percentOf(10, -200)), -20, 1e-12);
  t.near('-10% of -200 = 20', value(E.percentOf(-10, -200)), 20, 1e-12);
  t.eq('string percent rejected', code(E.percentOf('15', 200)), 'bad_percent');
  t.eq('NaN value rejected', code(E.percentOf(10, NaN)), 'bad_value');
  t.eq('Infinity value rejected', code(E.percentOf(10, Infinity)), 'bad_value');
  t.eq('overflow reported', code(E.percentOf(1e308, 1e308)), 'overflow');
});

t.group('whatPercent', function () {
  t.near('30 of 200 = 15%', value(E.whatPercent(30, 200)), 15, 1e-12);
  t.near('0 of 200 = 0%', value(E.whatPercent(0, 200)), 0, 1e-12);
  t.near('-30 of 200 = -15%', value(E.whatPercent(-30, 200)), -15, 1e-12);
  t.near('200 of 200 = 100%', value(E.whatPercent(200, 200)), 100, 1e-12);
  t.eq('zero base rejected', code(E.whatPercent(25, 0)), 'zero_base');
  t.eq('non-numeric base rejected', code(E.whatPercent(5, NaN)), 'bad_base');
  t.eq('non-numeric value rejected', code(E.whatPercent(NaN, 5)), 'bad_value');
  t.eq('string base rejected', code(E.whatPercent(5, '200')), 'bad_base');
});

t.group('percentChange', function () {
  var up = E.percentChange(200, 250);
  t.near('200 to 250 = +25%', value(up), 25, 1e-12);
  t.eq('increase direction', up.direction, 'increase');

  var down = E.percentChange(250, 200);
  t.near('250 to 200 = -20%', value(down), -20, 1e-12);
  t.eq('decrease direction', down.direction, 'decrease');

  var flat = E.percentChange(200, 200);
  t.near('no change = 0%', value(flat), 0, 1e-12);
  t.eq('none direction', flat.direction, 'none');

  t.near('-100 to -50 = +50%', value(E.percentChange(-100, -50)), 50, 1e-12);
  t.near('-100 to -150 = -50%', value(E.percentChange(-100, -150)), -50, 1e-12);
  t.near('100 to -50 = -150%', value(E.percentChange(100, -50)), -150, 1e-12);
  t.eq('zero original value rejected', code(E.percentChange(0, 5)), 'zero_base');
  t.eq('bad original value code', code(E.percentChange('200', 250)), 'bad_from');
  t.eq('bad new value code', code(E.percentChange(200, undefined)), 'bad_to');
  t.eq('overflow reported', code(E.percentChange(1e308, -1e308)), 'overflow');
});

t.group('applyPercent', function () {
  t.near('200 + 10% = 220', value(E.applyPercent(200, 10, 'increase')), 220, 1e-12);
  t.near('200 - 10% = 180', value(E.applyPercent(200, 10, 'decrease')), 180, 1e-12);
  t.near('200 with -10% increase = 180', value(E.applyPercent(200, -10, 'increase')), 180, 1e-12);
  t.near('200 with -10% decrease = 220', value(E.applyPercent(200, -10, 'decrease')), 220, 1e-12);
  t.near('0 decreased stays 0', value(E.applyPercent(0, 50, 'decrease')), 0, 1e-12);
  t.near('default mode increases', value(E.applyPercent(100, 10)), 110, 1e-12);
  t.near('negative amount increases algebraically', value(E.applyPercent(-100, 10, 'increase')), -110, 1e-9);
  t.eq('unknown mode rejected', code(E.applyPercent(200, 10, 'add')), 'bad_mode');
  t.eq('bad value rejected', code(E.applyPercent(NaN, 10, 'increase')), 'bad_value');
  t.eq('bad percent rejected', code(E.applyPercent(200, '10', 'increase')), 'bad_percent');
});

t.group('round', function () {
  var r;
  r = E.round(2.675, 2);
  t.near('2.675 rounds to 2.68', r.value, 2.68, 1e-12);
  r = E.round(-2.675, 2);
  t.near('-2.675 rounds half away from zero', r.value, -2.68, 1e-12);
  r = E.round(0.004, 2);
  t.eq('tiny positive rounds to +0', r.value, 0);
  t.ok('tiny positive is not negative zero', !Object.is(r.value, -0));
  r = E.round(-0.004, 2);
  t.eq('tiny negative rounds to 0', r.value, 0);
  t.ok('tiny negative is not negative zero', !Object.is(r.value, -0));
  r = E.round(1234.5678, 3);
  t.near('1234.5678 at 3 decimals', r.value, 1234.568, 1e-12);
  t.near('default is 2 decimals', E.round(1.239).value, 1.24, 1e-12);
  t.eq('negative decimals rejected', code(E.round(1, -1)), 'bad_decimals');
  t.eq('7 decimals rejected', code(E.round(1, 7)), 'bad_decimals');
  t.eq('fractional decimals rejected', code(E.round(1, 1.5)), 'bad_decimals');
  t.eq('NaN rejected', code(E.round(NaN, 2)), 'bad_value');
});

t.group('formatNumber', function () {
  var f;
  f = E.formatNumber(1234.5678, 2);
  t.near('1234.5678 -> 1234.57', f.value, 1234.57, 1e-12);
  t.eq('two-decimal text', f.text, '1234.57');

  f = E.formatNumber(1234.5, 0);
  t.near('zero decimals rounds to integer', f.value, 1235, 1e-12);
  t.eq('zero-decimal text', f.text, '1235');

  f = E.formatNumber(1.005, 2);
  t.near('1.005 -> 1.01 (binary-safe)', f.value, 1.01, 1e-12);
  t.eq('1.005 text', f.text, '1.01');

  f = E.formatNumber(-1.005, 2);
  t.near('-1.005 -> -1.01', f.value, -1.01, 1e-12);
  t.eq('-1.005 text', f.text, '-1.01');

  f = E.formatNumber(0.1 + 0.2, 2);
  t.near('0.1 + 0.2 -> 0.3', f.value, 0.3, 1e-12);
  t.eq('0.1 + 0.2 text', f.text, '0.30');

  f = E.formatNumber(2.675, 2);
  t.near('2.675 -> 2.68', f.value, 2.68, 1e-12);
  t.eq('2.675 text', f.text, '2.68');

  f = E.formatNumber(1, 6);
  t.eq('six-decimal text', f.text, '1.000000');
  t.eq('NaN rejected', code(E.formatNumber(NaN, 2)), 'bad_value');
  t.eq('negative decimals rejected', code(E.formatNumber(1, -1)), 'bad_decimals');
  t.eq('seven decimals rejected', code(E.formatNumber(1, 7)), 'bad_decimals');
});

t.group('randomized identity checks', function () {
  var rnd = lib.mulberry32(20261109);
  for (var i = 0; i < 10; i++) {
    var p = (rnd() * 400 - 200);
    var n = (rnd() * 20000 - 10000);
    t.near('percentOf matches n*p/100 #' + i, value(E.percentOf(p, n)), n * p / 100, 1e-8);
  }
  for (var j = 0; j < 10; j++) {
    var from = (rnd() * 2000 - 1000);
    if (Math.abs(from) < 1) from = 7;
    var to = (rnd() * 2000 - 1000);
    t.near('percentChange matches formula #' + j,
      value(E.percentChange(from, to)), (to - from) / Math.abs(from) * 100, 1e-8);
  }
});

/* -------------------------------------------------------------------- i18n */

var dictKeys = [];

t.group('i18n dictionaries', function () {
  dictKeys = lib.checkI18n(t, I18N, [
    'docTitle', 'docDesc', 'appTitle', 'tab1', 'tab2', 'tab3', 'tab4',
    'resultTitle', 'errZeroBase', 'faqQ1', 'faqA1'
  ]);

  ['zh', 'en', 'id'].forEach(function (lang) {
    dictKeys.forEach(function (key) {
      t.ok('i18n ' + lang + '.' + key + ' is not the key name', I18N[lang][key] !== key);
    });
  });

  t.ok('Chinese and English titles differ', I18N.zh.docTitle !== I18N.en.docTitle);
  t.ok('Chinese and Indonesian titles differ', I18N.zh.docTitle !== I18N.id.docTitle);
  t.ok('English description is long enough', I18N.en.docDesc.length > 80);
  t.ok('Indonesian description is long enough', I18N.id.docDesc.length > 80);
});

t.group('markup language keys', function () {
  var refs = lib.dataIKeys(html);
  t.ok('markup references many keys', refs.length >= 60);
  refs.forEach(function (key) {
    t.ok('zh has data-i key ' + key, Object.prototype.hasOwnProperty.call(I18N.zh, key));
    t.ok('en has data-i key ' + key, Object.prototype.hasOwnProperty.call(I18N.en, key));
    t.ok('id has data-i key ' + key, Object.prototype.hasOwnProperty.call(I18N.id, key));
  });

  var uiSource = html.slice(html.lastIndexOf('<script>'));
  var uiKeys = {};
  var re = /\bt\(\s*'([A-Za-z0-9_]+)'\s*\)/g;
  var m;
  while ((m = re.exec(uiSource))) uiKeys[m[1]] = true;
  /* Template helpers are called as tf('key', …). */
  var reTf = /\btf\(\s*'([A-Za-z0-9_]+)'/g;
  while ((m = reTf.exec(uiSource))) uiKeys[m[1]] = true;
  Object.keys(uiKeys).forEach(function (key) {
    t.ok('UI references known i18n key ' + key,
      Object.prototype.hasOwnProperty.call(I18N.zh, key));
  });
});

/* ------------------------------------------------------------------ static */

t.group('static compliance', function () {
  var refs = lib.externalRefs(html);
  t.eq('no external requests', refs, []);

  t.ok('viewport meta present', /<meta name="viewport" content="width=device-width/.test(html));
  t.eq('html defaults to Chinese', /<html lang="zh-CN">/.test(html), true);
  t.ok('canonical link present',
    html.indexOf('<link rel="canonical" href="https://hhfa008.github.io/tools/percentage-calculator/">') !== -1);

  var title = /<title>([^<]+)<\/title>/.exec(html);
  t.ok('title exists', !!title && title[1].trim().length > 5);
  var desc = /<meta name="description" content="([^"]+)">/.exec(html);
  t.ok('meta description exists', !!desc && desc[1].length >= 60);

  t.ok('og title present', /<meta property="og:title" content="[^"]+">/.test(html));
  t.ok('og description present', /<meta property="og:description" content="[^"]+">/.test(html));
  t.ok('twitter card present', /<meta name="twitter:card" content="summary">/.test(html));

  var lds = lib.jsonLd(html);
  t.eq('three JSON-LD blocks', lds.length, 3);
  var types = lds.map(function (x) { return x['@type']; });
  t.ok('SoftwareApplication JSON-LD', types.indexOf('SoftwareApplication') !== -1);
  t.ok('FAQPage JSON-LD', types.indexOf('FAQPage') !== -1);
  t.ok('BreadcrumbList JSON-LD', types.indexOf('BreadcrumbList') !== -1);

  var app = lds.filter(function (x) { return x['@type'] === 'SoftwareApplication'; })[0];
  t.eq('app is free', app.offers.price, '0');
  t.eq('app url matches canonical', app.url, 'https://hhfa008.github.io/tools/percentage-calculator/');

  var faq = lds.filter(function (x) { return x['@type'] === 'FAQPage'; })[0];
  t.eq('FAQ has three questions', faq.mainEntity.length, 3);
  faq.mainEntity.forEach(function (item, i) {
    t.ok('FAQ question ' + (i + 1) + ' is visible in page', html.indexOf(item.name) !== -1);
    t.ok('FAQ answer ' + (i + 1) + ' is visible in page', html.indexOf(item.acceptedAnswer.text) !== -1);
  });

  var crumbs = lds.filter(function (x) { return x['@type'] === 'BreadcrumbList'; })[0];
  t.eq('breadcrumb has three levels', crumbs.itemListElement.length, 3);
  t.eq('breadcrumb positions', crumbs.itemListElement.map(function (x) { return x.position; }), [1, 2, 3]);

  t.ok('noscript notice present', /<noscript>[\s\S]*<\/noscript>/.test(html));
  t.ok('reduced-motion media query present', /@media \(prefers-reduced-motion:reduce\)/.test(html));
  t.ok('dark mode media query present', /@media \(prefers-color-scheme:dark\)/.test(html));

  t.eq('four tabs', (html.match(/<button[^>]*role="tab"/g) || []).length, 4);
  t.eq('one tablist', (html.match(/role="tablist"/g) || []).length, 1);
  t.eq('four tab panels', (html.match(/role="tabpanel"/g) || []).length, 4);
  t.ok('result region is aria-live', /aria-live="polite"/.test(html));
  t.ok('inline errors use role=alert', /role="alert"/.test(html));
  t.ok('no blocking alert() calls', !/\balert\s*\(/.test(html));
  t.ok('no confirm() calls', !/\bconfirm\s*\(/.test(html));

  t.ok('decimal inputs use inputmode', (html.match(/inputmode="decimal"/g) || []).length >= 8);

  ['p1-percent', 'p1-value', 'p2-x', 'p2-y', 'p3-from', 'p3-to', 'p4-value', 'p4-percent'].forEach(function (id) {
    t.ok('input ' + id + ' has a label', html.indexOf('for="' + id + '"') !== -1);
  });

  t.ok('language priority uses query string', html.indexOf('URLSearchParams') !== -1);
  t.ok('language uses localStorage key', html.indexOf('hhfa.tool.percentage-calculator.lang') !== -1);
  t.ok('language uses navigator.language', html.indexOf('navigator.language') !== -1);
  t.ok('tools nav link is localized', html.indexOf("'/tools/' + lang + '/'") !== -1);

  t.ok('page is within 90KB', Buffer.byteLength(html, 'utf8') <= 90 * 1024);
});

t.done();
