#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'color-converter';
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

  var rgb = engine.hexToRgb('#b93d12');
  t.eq('hex to rgb', rgb, { ok: true, r: 185, g: 61, b: 18 });

  var short = engine.hexToRgb('#b93');
  t.eq('3-digit hex expands', short, { ok: true, r: 187, g: 153, b: 51 });
  t.eq('invalid hex rejected', engine.hexToRgb('#xyz'), { ok: false, error: 'invalid_color' });
  t.eq('5-digit hex rejected', engine.hexToRgb('#12345'), { ok: false, error: 'invalid_color' });

  t.eq('rgb to hex', engine.rgbToHex(185, 61, 18), { ok: true, value: '#b93d12' });
  t.eq('rgb to hex pads', engine.rgbToHex(0, 1, 255), { ok: true, value: '#0001ff' });
  t.eq('rgb out of range rejected', engine.rgbToHex(256, 0, 0), { ok: false, error: 'bad_value' });

  var hsl = engine.rgbToHsl(185, 61, 18);
  t.near('hue', hsl.h, 15.4491, 1e-3);
  t.near('saturation', hsl.s, 82.266, 1e-3);
  t.near('lightness', hsl.l, 39.804, 1e-3);

  var backHsl = engine.hslToRgb(hsl.h, hsl.s, hsl.l);
  t.eq('HSL round trip returns original RGB', backHsl, { ok: true, r: 185, g: 61, b: 18 });

  t.eq('hue 360 equals red', engine.hslToRgb(360, 100, 50), { ok: true, r: 255, g: 0, b: 0 });
  t.eq('negative hue wraps', engine.hslToRgb(-120, 100, 50), { ok: true, r: 0, g: 0, b: 255 });

  var gray = engine.rgbToHsl(128, 128, 128);
  t.eq('gray has zero saturation', gray.s, 0);
  t.eq('gray has zero hue', gray.h, 0);

  var hsv = engine.rgbToHsv(185, 61, 18);
  t.near('hsv value', hsv.v, 72.549, 1e-3);
  t.eq('HSV round trip', engine.hsvToRgb(hsv.h, hsv.s, hsv.v), { ok: true, r: 185, g: 61, b: 18 });

  var cmyk = engine.rgbToCmyk(185, 61, 18);
  t.near('cmyk key', cmyk.k, 27.451, 1e-3);
  t.near('cmyk magenta', cmyk.m, 67.027, 1e-3);
  t.eq('CMYK round trip', engine.cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k), { ok: true, r: 185, g: 61, b: 18 });
  t.eq('black CMYK key', engine.rgbToCmyk(0, 0, 0), { ok: true, c: 0, m: 0, y: 0, k: 100 });

  var black = { r: 0, g: 0, b: 0 };
  var white = { r: 255, g: 255, b: 255 };
  var contrast = engine.contrastRatio(black, white);
  t.eq('black white contrast 21', contrast.ratio, 21);
  t.eq('21:1 passes AAA', contrast.aaa, true);
  t.eq('contrast is symmetric', engine.contrastRatio(white, black).ratio, 21);
  t.eq('same color contrast 1', engine.contrastRatio(black, black).ratio, 1);
  t.near('white luminance 1', engine.relativeLuminance(white), 1, 1e-9);
  t.near('black luminance 0', engine.relativeLuminance(black), 0, 1e-9);

  t.eq('parse named color', engine.parseColor('red'), { ok: true, r: 255, g: 0, b: 0, format: 'name' });
  t.eq('parse rgb()', engine.parseColor('rgb(185, 61, 18)'), { ok: true, r: 185, g: 61, b: 18, format: 'rgb' });
  t.eq('parse hsl()', engine.parseColor('hsl(0, 100%, 50%)'), { ok: true, r: 255, g: 0, b: 0, format: 'hsl' });
  var parsedCmyk = engine.parseColor('cmyk(0%, 49%, 100%, 0%)');
  t.ok('parse cmyk()', parsedCmyk.ok === true && parsedCmyk.format === 'cmyk');
  t.eq('parse invalid', engine.parseColor('not-a-color'), { ok: false, error: 'invalid_color' });
  t.eq('parse empty', engine.parseColor('   '), { ok: false, error: 'empty_input' });

  var exact = engine.colorName(255, 165, 0);
  t.eq('exact color name', exact, { ok: true, name: 'orange', hex: '#ffa500', exact: true });
  var nearest = engine.colorName(185, 61, 18);
  t.eq('nearest color is not exact', nearest.exact, false);
  t.ok('nearest color has a name', typeof nearest.name === 'string' && nearest.name.length > 0);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
