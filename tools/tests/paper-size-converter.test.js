#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'paper-size-converter';
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

  r = engine.paperSize('A4');
  t.eq('A4 lookup ok', r.ok, true);
  t.eq('A4 width 210 mm', r.widthMm, 210);
  t.eq('A4 height 297 mm', r.heightMm, 297);

  t.eq('lowercase a4 accepted', engine.paperSize('a4').name, 'A4');
  t.eq('A0 width', engine.paperSize('A0').widthMm, 841);
  t.eq('A0 height', engine.paperSize('A0').heightMm, 1189);
  t.eq('B5 width', engine.paperSize('B5').widthMm, 176);
  t.eq('B5 height', engine.paperSize('B5').heightMm, 250);
  t.eq('C4 width', engine.paperSize('C4').widthMm, 229);
  t.eq('C4 height', engine.paperSize('C4').heightMm, 324);
  t.eq('Letter width', engine.paperSize('Letter').widthMm, 215.9);
  t.eq('Letter height', engine.paperSize('Letter').heightMm, 279.4);
  t.eq('Legal width', engine.paperSize('Legal').widthMm, 215.9);
  t.eq('Legal height', engine.paperSize('Legal').heightMm, 355.6);
  t.eq('unknown size rejected', engine.paperSize('A99'), { ok: false, error: 'not_found' });
  t.eq('empty name rejected', engine.paperSize(''), { ok: false, error: 'bad_value' });
  t.eq('non-string name rejected', engine.paperSize(null), { ok: false, error: 'bad_value' });

  t.eq('210 mm at 300 DPI = 2480 px', engine.toPixels(210, 300), { ok: true, value: 2480, dpi: 300 });
  t.eq('297 mm at 300 DPI = 3508 px', engine.toPixels(297, 300), { ok: true, value: 3508, dpi: 300 });
  t.eq('25.4 mm at 72 DPI = 72 px', engine.toPixels(25.4, 72).value, 72);
  t.eq('0 mm = 0 px', engine.toPixels(0, 300).value, 0);
  t.eq('zero DPI rejected', engine.toPixels(210, 0), { ok: false, error: 'range' });
  t.eq('negative mm rejected', engine.toPixels(-1, 300), { ok: false, error: 'range' });
  t.eq('NaN mm rejected', engine.toPixels(NaN, 300), { ok: false, error: 'bad_value' });
  t.eq('string DPI rejected', engine.toPixels(210, '300'), { ok: false, error: 'bad_value' });

  r = engine.paperPixels('A4', 300);
  t.eq('paperPixels A4 ok', r.ok, true);
  t.eq('A4 300 DPI width px', r.widthPx, 2480);
  t.eq('A4 300 DPI height px', r.heightPx, 3508);
  t.eq('paperPixels reports name', r.name, 'A4');
  t.eq('paperPixels unknown size', engine.paperPixels('A99', 300), { ok: false, error: 'not_found' });
  t.eq('paperPixels zero DPI', engine.paperPixels('A4', 0), { ok: false, error: 'range' });

  t.near('210 mm = 8.2677 in', engine.toInches(210).value, 8.26771653543307, 1e-9);
  t.eq('negative inches rejected', engine.toInches(-1), { ok: false, error: 'range' });

  var list = engine.sizes();
  t.eq('35 paper sizes in table', list.length, 35);
  t.ok('all sizes have positive dimensions', list.every(function (item) {
    return item.widthMm > 0 && item.heightMm > 0;
  }));

  var areaA4A0 = engine.scaleRatio('A4', 'A0');
  t.eq('A4→A0 scale ok', areaA4A0.ok, true);
  t.near('A0 area ≈ 16 × A4', areaA4A0.areaRatio, 16.0326, 0.01);
  t.near('A4→A0 fit scale = 1189/297', areaA4A0.fitScale, 1189 / 297, 1e-12);

  r = engine.scaleRatio('A4', 'A3');
  t.near('A4→A3 fit scale = 420/297', r.fitScale, 420 / 297, 1e-12);
  t.eq('A4 fits on A3 without shrinking', r.fitsWithoutScaling, true);
  t.near('A4→A3 area ratio ≈ 2', r.areaRatio, (297 * 420) / (210 * 297), 1e-12);

  r = engine.scaleRatio('A4', 'Letter');
  t.near('A4→Letter fit scale = 279.4/297', r.fitScale, 279.4 / 297, 1e-12);
  t.eq('A4 does not fit Letter unscaled', r.fitsWithoutScaling, false);
  t.near('A4→Letter width ratio > 1', r.widthRatio, 215.9 / 210, 1e-12);

  r = engine.scaleRatio('A4', 'A4');
  t.eq('same size fit scale = 1', r.fitScale, 1);
  t.eq('same size area ratio = 1', r.areaRatio, 1);
  t.eq('same size fits unscaled', r.fitsWithoutScaling, true);

  t.eq('scaleRatio unknown source', engine.scaleRatio('A99', 'A4'), { ok: false, error: 'not_found' });
  t.eq('scaleRatio unknown target', engine.scaleRatio('A4', 'A99'), { ok: false, error: 'not_found' });

  return 'ISO sizes, DPI pixels and scale ratios';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
