#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'circle-calculator';
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

  var r = engine.solveCircle('radius', 5);
  t.ok('radius 5 ok', r.ok === true);
  t.eq('radius 5 radius', r.radius, 5);
  t.eq('radius 5 diameter', r.diameter, 10);
  t.near('radius 5 circumference', r.circumference, 10 * Math.PI, 1e-12);
  t.near('radius 5 area', r.area, 25 * Math.PI, 1e-12);

  var d = engine.solveCircle('diameter', 10);
  t.near('diameter 10 radius', d.radius, 5, 1e-12);
  t.near('diameter 10 area', d.area, 25 * Math.PI, 1e-12);

  var c = engine.solveCircle('circumference', 10 * Math.PI);
  t.near('circumference input radius', c.radius, 5, 1e-12);
  t.near('circumference input area', c.area, 25 * Math.PI, 1e-12);

  var a = engine.solveCircle('area', 25 * Math.PI);
  t.near('area input radius', a.radius, 5, 1e-12);
  t.near('area input circumference', a.circumference, 10 * Math.PI, 1e-12);
  t.near('circumference squared relation', r.circumference * r.circumference, 4 * Math.PI * r.area, 1e-9);

  t.eq('zero rejected', engine.solveCircle('radius', 0), { ok: false, error: 'bad_value' });
  t.eq('negative rejected', engine.solveCircle('radius', -5), { ok: false, error: 'bad_value' });
  t.eq('string rejected', engine.solveCircle('radius', '5'), { ok: false, error: 'bad_value' });
  t.eq('NaN rejected', engine.solveCircle('area', NaN), { ok: false, error: 'bad_value' });
  t.eq('bad mode rejected', engine.solveCircle('perimeter', 5), { ok: false, error: 'bad_mode' });

  var s = engine.sector(5, 90);
  t.ok('sector r5 90 ok', s.ok === true);
  t.near('sector quarter area', s.area, 25 * Math.PI / 4, 1e-12);
  t.near('sector quarter arc', s.arcLength, 10 * Math.PI / 4, 1e-12);
  t.near('sector 90 radians', s.angleRad, Math.PI / 2, 1e-12);

  var full = engine.sector(5, 360);
  t.near('sector 360 full area', full.area, 25 * Math.PI, 1e-12);
  t.near('sector 360 full arc', full.arcLength, 10 * Math.PI, 1e-12);

  t.eq('sector rejects 0 angle', engine.sector(5, 0), { ok: false, error: 'bad_angle' });
  t.eq('sector rejects 361 angle', engine.sector(5, 361), { ok: false, error: 'bad_angle' });
  t.eq('sector rejects negative radius', engine.sector(-5, 90), { ok: false, error: 'bad_value' });
  t.eq('sector rejects string angle', engine.sector(5, '90'), { ok: false, error: 'bad_value' });

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
