#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'triangle-calculator';
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

  var r = engine.sss(3, 4, 5);
  t.ok('sss(3,4,5) ok', r.ok === true);
  t.near('3-4-5 area', r.area, 6, 1e-12);
  t.eq('3-4-5 perimeter', r.perimeter, 12);
  t.eq('3-4-5 sides type', r.sidesType, 'scalene');
  t.eq('3-4-5 angle type', r.angleType, 'right');
  t.near('3-4-5 angle C', r.anglesDeg.C, 90, 1e-9);
  t.near('3-4-5 angle sum', r.anglesDeg.A + r.anglesDeg.B + r.anglesDeg.C, 180, 1e-9);
  t.near('3-4-5 angle C radians', r.anglesRad.C, Math.PI / 2, 1e-12);

  var eq = engine.sss(6, 6, 6);
  t.eq('equilateral type', eq.sidesType, 'equilateral');
  t.eq('equilateral angle type', eq.angleType, 'acute');
  t.near('equilateral area', eq.area, 9 * Math.sqrt(3), 1e-9);

  var iso = engine.sss(3, 3, 4);
  t.eq('isosceles type', iso.sidesType, 'isosceles');

  t.eq('degenerate 1,2,3', engine.sss(1, 2, 3), { ok: false, error: 'degenerate' });
  t.eq('not a triangle 1,2,5', engine.sss(1, 2, 5), { ok: false, error: 'not_triangle' });
  t.eq('zero side rejected', engine.sss(0, 4, 5), { ok: false, error: 'bad_value' });
  t.eq('negative side rejected', engine.sss(-3, 4, 5), { ok: false, error: 'bad_value' });
  t.eq('string side rejected', engine.sss('3', 4, 5), { ok: false, error: 'bad_value' });
  t.eq('NaN side rejected', engine.sss(NaN, 4, 5), { ok: false, error: 'bad_value' });

  t.near('heron(3,4,5)', engine.heron(3, 4, 5).value, 6, 1e-12);
  t.near('heron(2,2,2)', engine.heron(2, 2, 2).value, Math.sqrt(3), 1e-12);
  t.eq('heron rejects degenerate', engine.heron(1, 2, 3).error, 'degenerate');

  var s = engine.sas(2, 3, 60);
  t.ok('sas(2,3,60) ok', s.ok === true);
  t.near('sas side a', s.a, Math.sqrt(7), 1e-12);
  t.near('sas area', s.area, 2.598076211353316, 1e-12);
  t.near('sas angle sum', s.anglesDeg.A + s.anglesDeg.B + s.anglesDeg.C, 180, 1e-9);
  t.near('sas 90 degree area', engine.sas(4, 5, 90).area, 10, 1e-12);
  t.near('sas 90 degree hypotenuse', engine.sas(4, 5, 90).a, Math.sqrt(41), 1e-12);
  t.eq('sas rejects 0 angle', engine.sas(4, 5, 0), { ok: false, error: 'bad_angle' });
  t.eq('sas rejects 180 angle', engine.sas(4, 5, 180), { ok: false, error: 'bad_angle' });
  t.eq('sas rejects non-number angle', engine.sas(4, 5, '60'), { ok: false, error: 'bad_value' });

  var c = engine.classify(3, 4, 5);
  t.eq('classify sides', c.sidesType, 'scalene');
  t.eq('classify angle', c.angleType, 'right');
  t.eq('classify obtuse', engine.classify(2, 3, 4).angleType, 'obtuse');

  t.near('degToRad(180)', engine.degToRad(180), Math.PI, 1e-12);
  t.near('radToDeg(pi)', engine.radToDeg(Math.PI), 180, 1e-12);
  t.eq('round 1.005 to 2', engine.round(1.005, 2), { ok: true, value: 1.01 });
  t.eq('round -2.5 to 0', engine.round(-2.5, 0), { ok: true, value: -3 });
  t.eq('round rejects 7 decimals', engine.round(1, 7), { ok: false, error: 'bad_decimals' });
  t.eq('isNum(0)', engine.isNum(0), true);
  t.eq('isNum("0")', engine.isNum('0'), false);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
