'use strict';

/*
 * Tests for tools/unit-converter/.
 * Run with: node tools/tests/unit-converter.test.js
 */

var path = require('path');
var lib = require('./lib.js');

var DIR = path.join(__dirname, '..', 'unit-converter');
var html = lib.page(DIR);
var t = lib.suite('unit-converter');
var E = lib.evalScript(html, 'engine', 'ToolEngine');
var I18N = lib.evalScript(html, 'i18n', 'TOOL_I18N');

function value(res) { return res && res.ok ? res.value : NaN; }
function code(res) { return res && res.ok ? null : (res && res.error); }
function conv(cat, v, from, to) { return value(E.convert(cat, v, from, to)); }

/* ------------------------------------------------------------------ engine */

t.group('engine exports and metadata', function () {
  t.ok('convert is a function', typeof E.convert === 'function');
  t.ok('convertAll is a function', typeof E.convertAll === 'function');
  t.ok('units is a function', typeof E.units === 'function');
  t.ok('round is a function', typeof E.round === 'function');
  t.eq('eight categories', E.categories, ['length', 'mass', 'area', 'volume', 'temperature', 'speed', 'data', 'time']);

  var src = lib.scriptCode(html, 'engine');
  t.ok('engine does not touch document', !/\bdocument\b/.test(src));
  t.ok('engine does not touch window', !/\bwindow\b/.test(src));
  t.ok('engine contains the affine temperature conversion', src.indexOf('affine') !== -1 && src.indexOf('273.15') !== -1);

  var lengths = { length: 9, mass: 7, area: 8, volume: 8, temperature: 3, speed: 5, data: 9, time: 6 };
  E.categories.forEach(function (cat) {
    var meta = E.units(cat);
    t.ok('units(' + cat + ') succeeds', meta.ok);
    t.eq('units(' + cat + ') count', meta.value.length, lengths[cat]);
    meta.value.forEach(function (u) {
      t.ok('unit ' + cat + '/' + u.id + ' has a numeric factor', typeof u.factor === 'number' && isFinite(u.factor));
    });
  });
  t.eq('unknown category rejected', code(E.units('nope')), 'unknown_category');
});

t.group('length', function () {
  t.near('1 in = 0.0254 m', conv('length', 1, 'in', 'm'), 0.0254, 1e-12);
  t.near('1 ft = 0.3048 m', conv('length', 1, 'ft', 'm'), 0.3048, 1e-12);
  t.near('1 yd = 0.9144 m', conv('length', 1, 'yd', 'm'), 0.9144, 1e-12);
  t.near('1 mi = 1609.344 m', conv('length', 1, 'mi', 'm'), 1609.344, 1e-12);
  t.near('1 nmi = 1852 m', conv('length', 1, 'nmi', 'm'), 1852, 1e-12);
  t.near('1 m = 100 cm', conv('length', 1, 'm', 'cm'), 100, 1e-9);
  t.near('1 km = 1000 m', conv('length', 1, 'km', 'm'), 1000, 1e-9);
  t.near('1 mm = 0.001 m', conv('length', 1, 'mm', 'm'), 0.001, 1e-12);
  t.near('0 converts to 0', conv('length', 0, 'm', 'ft'), 0, 1e-12);
  t.near('negative values are allowed', conv('length', -1, 'm', 'cm'), -100, 1e-9);
});

t.group('mass', function () {
  t.near('1 lb = 0.45359237 kg', conv('mass', 1, 'lb', 'kg'), 0.45359237, 1e-12);
  t.near('1 oz = 0.028349523125 kg', conv('mass', 1, 'oz', 'kg'), 0.028349523125, 1e-12);
  t.near('1 st = 6.35029318 kg', conv('mass', 1, 'st', 'kg'), 6.35029318, 1e-9);
  t.near('1 t = 1000 kg', conv('mass', 1, 't', 'kg'), 1000, 1e-9);
  t.near('1 kg = 1000 g', conv('mass', 1, 'kg', 'g'), 1000, 1e-9);
  t.near('1 g = 1000 mg', conv('mass', 1, 'g', 'mg'), 1000, 1e-9);
});

t.group('area', function () {
  t.near('1 acre = 4046.8564224 m2', conv('area', 1, 'acre', 'm2'), 4046.8564224, 1e-9);
  t.near('1 ha = 10000 m2', conv('area', 1, 'ha', 'm2'), 10000, 1e-9);
  t.near('1 ft2 = 0.09290304 m2', conv('area', 1, 'ft2', 'm2'), 0.09290304, 1e-12);
  t.near('1 yd2 = 0.83612736 m2', conv('area', 1, 'yd2', 'm2'), 0.83612736, 1e-12);
  t.near('1 km2 = 1e6 m2', conv('area', 1, 'km2', 'm2'), 1000000, 1e-9);
  t.near('1 m2 = 10000 cm2', conv('area', 1, 'm2', 'cm2'), 10000, 1e-9);
});

t.group('volume', function () {
  t.near('1 gal = 3.785411784 L', conv('volume', 1, 'gal', 'l'), 3.785411784, 1e-12);
  t.near('1 cup = 236.5882365 mL', conv('volume', 1, 'cup', 'ml'), 236.5882365, 1e-9);
  t.near('1 tbsp = 14.78676478125 mL', conv('volume', 1, 'tbsp', 'ml'), 14.78676478125, 1e-9);
  t.near('1 tsp = 4.92892159375 mL', conv('volume', 1, 'tsp', 'ml'), 4.92892159375, 1e-9);
  t.near('1 floz = 29.5735295625 mL', conv('volume', 1, 'floz', 'ml'), 29.5735295625, 1e-9);
  t.near('1 m3 = 1000 L', conv('volume', 1, 'm3', 'l'), 1000, 1e-9);
  t.near('1 L = 1000 mL', conv('volume', 1, 'l', 'ml'), 1000, 1e-9);
});

t.group('temperature is affine', function () {
  t.near('0 C = 32 F', conv('temperature', 0, 'c', 'f'), 32, 1e-9);
  t.near('100 C = 212 F', conv('temperature', 100, 'c', 'f'), 212, 1e-9);
  t.near('32 F = 0 C', conv('temperature', 32, 'f', 'c'), 0, 1e-9);
  t.near('212 F = 100 C', conv('temperature', 212, 'f', 'c'), 100, 1e-9);
  t.near('0 C = 273.15 K', conv('temperature', 0, 'c', 'k'), 273.15, 1e-9);
  t.near('273.15 K = 0 C', conv('temperature', 273.15, 'k', 'c'), 0, 1e-9);
  t.near('-40 C = -40 F', conv('temperature', -40, 'c', 'f'), -40, 1e-9);
  t.near('98.6 F = 37 C', conv('temperature', 98.6, 'f', 'c'), 37, 1e-9);
  t.near('0 K = -459.67 F', conv('temperature', 0, 'k', 'f'), -459.67, 1e-7);
  t.near('0 K = -273.15 C', conv('temperature', 0, 'k', 'c'), -273.15, 1e-9);
  t.near('celsius to itself is identity', conv('temperature', 12.5, 'c', 'c'), 12.5, 1e-12);
});

t.group('speed', function () {
  t.near('1 m/s = 3.6 km/h', conv('speed', 1, 'mps', 'kmh'), 3.6, 1e-9);
  t.near('1 km/h = 1/3.6 m/s', conv('speed', 1, 'kmh', 'mps'), 1 / 3.6, 1e-12);
  t.near('1 mph = 0.44704 m/s', conv('speed', 1, 'mph', 'mps'), 0.44704, 1e-12);
  t.near('1 knot = 1.852 km/h', conv('speed', 1, 'knot', 'kmh'), 1.852, 1e-9);
  t.near('1 ft/s = 0.3048 m/s', conv('speed', 1, 'fps', 'mps'), 0.3048, 1e-12);
});

t.group('data decimal vs binary', function () {
  t.near('1 b = 1 B', conv('data', 1, 'b', 'b'), 1, 1e-12);
  t.near('1 kB = 1000 B', conv('data', 1, 'kb', 'b'), 1000, 1e-9);
  t.near('1 MB = 1000000 B', conv('data', 1, 'mb', 'b'), 1000000, 1e-9);
  t.near('1 KiB = 1024 B', conv('data', 1, 'kib', 'b'), 1024, 1e-9);
  t.near('1 MiB = 1048576 B', conv('data', 1, 'mib', 'b'), 1048576, 1e-9);
  t.near('1 GiB = 1073741824 B', conv('data', 1, 'gib', 'b'), 1073741824, 1);
  t.near('1 TiB = 1099511627776 B', conv('data', 1, 'tib', 'b'), 1099511627776, 1);
  t.near('1 GB = 1000 MB', conv('data', 1, 'gb', 'mb'), 1000, 1e-9);
  t.near('1 GiB = 1024 MiB', conv('data', 1, 'gib', 'mib'), 1024, 1e-9);
  t.near('1 MB = 1e6/2^20 MiB', conv('data', 1, 'mb', 'mib'), 1000000 / 1048576, 1e-12);
});

t.group('time', function () {
  t.near('1 ms = 0.001 s', conv('time', 1, 'ms', 's'), 0.001, 1e-12);
  t.near('1 min = 60 s', conv('time', 1, 'min', 's'), 60, 1e-9);
  t.near('1 h = 3600 s', conv('time', 1, 'h', 's'), 3600, 1e-9);
  t.near('1 d = 24 h', conv('time', 1, 'd', 'h'), 24, 1e-9);
  t.near('1 wk = 7 d', conv('time', 1, 'wk', 'd'), 7, 1e-9);
  t.near('1 wk = 604800 s', conv('time', 1, 'wk', 's'), 604800, 1e-9);
});

t.group('error handling', function () {
  t.eq('unknown category rejected', code(E.convert('nope', 1, 'm', 'cm')), 'unknown_category');
  t.eq('unknown source unit rejected', code(E.convert('length', 1, 'xx', 'm')), 'unknown_unit');
  t.eq('unknown target unit rejected', code(E.convert('length', 1, 'm', 'xx')), 'unknown_unit');
  t.eq('NaN value rejected', code(E.convert('length', NaN, 'm', 'cm')), 'bad_value');
  t.eq('Infinity value rejected', code(E.convert('length', Infinity, 'm', 'cm')), 'bad_value');
  t.eq('string value rejected', code(E.convert('length', '1', 'm', 'cm')), 'bad_value');
  t.eq('null value rejected', code(E.convert('length', null, 'm', 'cm')), 'bad_value');
  t.eq('overflow rejected', code(E.convert('data', 1e308, 'tib', 'b')), 'overflow');
  t.eq('convertAll unknown category', code(E.convertAll('nope', 1, 'm')), 'unknown_category');
  t.eq('convertAll unknown unit', code(E.convertAll('length', 1, 'xx')), 'unknown_unit');
  t.eq('convertAll bad value', code(E.convertAll('length', NaN, 'm')), 'bad_value');
});

t.group('convertAll', function () {
  var all = E.convertAll('length', 1, 'm');
  t.ok('length conversion table succeeds', all.ok);
  t.eq('length table has nine rows', all.value.length, 9);
  t.eq('length table starts with mm', all.value[0].id, 'mm');
  t.eq('length table ends with nmi', all.value[8].id, 'nmi');
  var byId = {};
  all.value.forEach(function (row) { byId[row.id] = row.value; });
  t.near('table m row = 1', byId.m, 1, 1e-12);
  t.near('table cm row = 100', byId.cm, 100, 1e-9);
  t.near('table mm row = 1000', byId.mm, 1000, 1e-9);
  t.near('table km row = 0.001', byId.km, 0.001, 1e-12);
  t.near('table inch row = 1/0.0254', byId.in, 1 / 0.0254, 1e-12);

  var temps = E.convertAll('temperature', 0, 'c');
  t.ok('temperature table succeeds', temps.ok);
  t.eq('temperature table has three rows', temps.value.length, 3);
  var tempById = {};
  temps.value.forEach(function (row) { tempById[row.id] = row.value; });
  t.near('temperature table F row = 32', tempById.f, 32, 1e-9);
  t.near('temperature table K row = 273.15', tempById.k, 273.15, 1e-9);
});

t.group('round', function () {
  t.near('1.005 rounds to 1.01', value(E.round(1.005, 2)), 1.01, 1e-12);
  t.near('-1.005 rounds away from zero', value(E.round(-1.005, 2)), -1.01, 1e-12);
  t.near('1234.5678 at 0 decimals', value(E.round(1234.5678, 0)), 1235, 1e-12);
  t.near('2.675 at 2 decimals', value(E.round(2.675, 2)), 2.68, 1e-12);
  t.eq('tiny negative becomes +0', value(E.round(-0.0000001, 2)), 0);
  t.ok('tiny negative is not negative zero', !Object.is(value(E.round(-0.0000001, 2)), -0));
  t.near('default is four decimals', value(E.round(1.234567)), 1.2346, 1e-12);
  t.eq('9 decimals rejected', code(E.round(1, 9)), 'bad_decimals');
  t.eq('negative decimals rejected', code(E.round(1, -1)), 'bad_decimals');
  t.eq('fractional decimals rejected', code(E.round(1, 2.5)), 'bad_decimals');
  t.eq('NaN rejected', code(E.round(NaN, 2)), 'bad_value');
});

t.group('randomized conversion identities', function () {
  var rnd = lib.mulberry32(20261110);
  for (var i = 0; i < 10; i++) {
    var v = rnd() * 20000 - 10000;
    t.near('m to cm identity #' + i, conv('length', v, 'm', 'cm'), v * 100, Math.max(1e-9, Math.abs(v) * 1e-10));
  }
  for (var j = 0; j < 10; j++) {
    var kg = rnd() * 500;
    t.near('kg to lb identity #' + j, conv('mass', kg, 'kg', 'lb'), kg / 0.45359237, Math.max(1e-9, kg * 1e-10));
  }
});

/* -------------------------------------------------------------------- i18n */

var dictKeys = [];

t.group('i18n dictionaries', function () {
  dictKeys = lib.checkI18n(t, I18N, [
    'docTitle', 'docDesc', 'appTitle', 'categoryLabel', 'valueLabel',
    'resultTitle', 'tableTitle', 'faqQ1', 'faqA1', 'swapAria'
  ]);

  ['zh', 'en', 'id'].forEach(function (lang) {
    dictKeys.forEach(function (key) {
      t.ok('i18n ' + lang + '.' + key + ' is not the key name', I18N[lang][key] !== key);
    });
  });

  E.categories.forEach(function (cat) {
    ['zh', 'en', 'id'].forEach(function (lang) {
      t.ok('i18n ' + lang + ' has category label cat_' + cat,
        typeof I18N[lang]['cat_' + cat] === 'string' && I18N[lang]['cat_' + cat].length > 0);
    });
    var meta = E.units(cat);
    meta.value.forEach(function (u) {
      ['zh', 'en', 'id'].forEach(function (lang) {
        t.ok('i18n ' + lang + ' has unit label u_' + u.id,
          typeof I18N[lang]['u_' + u.id] === 'string' && I18N[lang]['u_' + u.id].length > 0);
      });
    });
  });

  t.ok('Chinese and English titles differ', I18N.zh.docTitle !== I18N.en.docTitle);
  t.ok('Chinese and Indonesian titles differ', I18N.zh.docTitle !== I18N.id.docTitle);
});

t.group('markup language keys', function () {
  var refs = lib.dataIKeys(html);
  t.ok('markup references many keys', refs.length >= 55);
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
    html.indexOf('<link rel="canonical" href="https://hhfa008.github.io/tools/unit-converter/">') !== -1);

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
  t.eq('app url matches canonical', app.url, 'https://hhfa008.github.io/tools/unit-converter/');

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

  t.ok('table container scrolls horizontally', /\.table-wrap\{[^}]*overflow-x:auto/.test(html));
  t.ok('swap button is 44px wide', /\.swap\{[^}]*width:44px/.test(html));
  t.ok('swap button is 44px tall', /\.swap\{[^}]*height:44px/.test(html));
  t.ok('swap button has a translated aria-label', /data-i-aria="swapAria"/.test(html));
  t.ok('result region is aria-live', /aria-live="polite"/.test(html));
  t.ok('inline errors use role=alert', /role="alert"/.test(html));
  t.ok('no blocking alert() calls', !/\balert\s*\(/.test(html));
  t.ok('no confirm() calls', !/\bconfirm\s*\(/.test(html));

  t.ok('value input uses inputmode', /id="value"[^>]*inputmode="decimal"/.test(html));
  ['category', 'value', 'from', 'to'].forEach(function (id) {
    t.ok('control ' + id + ' has a label', html.indexOf('for="' + id + '"') !== -1);
  });

  t.eq('eight category options', (html.match(/<option value="(?:length|mass|area|volume|temperature|speed|data|time)" data-i="/g) || []).length, 8);
  t.ok('precision offers 0 decimals', html.indexOf('<option value="0">0</option>') !== -1);
  t.ok('precision offers 8 decimals', html.indexOf('<option value="8">8</option>') !== -1);
  t.ok('precision defaults to 4', html.indexOf('<option value="4" selected>4</option>') !== -1);

  t.ok('exact inch factor is in the page', html.indexOf('0.0254') !== -1);
  t.ok('exact pound factor is in the page', html.indexOf('0.45359237') !== -1);
  t.ok('exact acre factor is in the page', html.indexOf('4046.8564224') !== -1);
  t.ok('exact gallon factor is in the page', html.indexOf('3.785411784') !== -1);
  t.ok('binary GiB factor is in the page', html.indexOf('1073741824') !== -1);
  t.ok('temperature offset is in the page', html.indexOf('273.15') !== -1);

  t.ok('language priority uses query string', html.indexOf('URLSearchParams') !== -1);
  t.ok('language uses localStorage key', html.indexOf('hhfa.tool.unit-converter.lang') !== -1);
  t.ok('language uses navigator.language', html.indexOf('navigator.language') !== -1);
  t.ok('tools nav link is localized', html.indexOf("'/tools/' + lang + '/'") !== -1);

  t.ok('page is within 90KB', Buffer.byteLength(html, 'utf8') <= 90 * 1024);
});

t.done();
