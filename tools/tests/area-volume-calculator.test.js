#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'area-volume-calculator';
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

  t.eq('four area shapes', engine.shapes('area').map(function (s) { return s.id; }),
    ['rectangle', 'triangle', 'circle', 'trapezoid']);
  t.eq('five volume shapes', engine.shapes('volume').map(function (s) { return s.id; }),
    ['cube', 'box', 'cylinder', 'sphere', 'cone']);
  t.eq('bad mode has no shapes', engine.shapes('x'), []);
  t.eq('sphere metadata fields', engine.shapeMeta('sphere').fields, ['r']);
  t.eq('unknown metadata', engine.shapeMeta('nope'), { ok: false, error: 'unsupported' });

  t.eq('rectangle 3x4', engine.areaOf('rectangle', { w: 3, h: 4 }).value, 12);
  t.eq('triangle b6 h4', engine.areaOf('triangle', { base: 6, height: 4 }).value, 12);
  t.near('circle r2', engine.areaOf('circle', { r: 2 }).value, 4 * Math.PI, 1e-12);
  t.eq('trapezoid 3,5,4', engine.areaOf('trapezoid', { a: 3, b: 5, h: 4 }).value, 16);
  t.eq('area kind', engine.areaOf('circle', { r: 2 }).kind, 'area');

  t.eq('missing param', engine.areaOf('rectangle', { w: 3 }), { ok: false, error: 'bad_value' });
  t.eq('zero param', engine.areaOf('rectangle', { w: 3, h: 0 }), { ok: false, error: 'bad_value' });
  t.eq('negative param', engine.areaOf('circle', { r: -2 }), { ok: false, error: 'bad_value' });
  t.eq('string param', engine.areaOf('circle', { r: '2' }), { ok: false, error: 'bad_value' });
  t.eq('unknown area shape', engine.areaOf('hexagon', { a: 1 }), { ok: false, error: 'unsupported' });

  t.eq('cube side 3', engine.volumeOf('cube', { side: 3 }).value, 27);
  t.eq('box 2x3x4', engine.volumeOf('box', { l: 2, w: 3, h: 4 }).value, 24);
  t.near('cylinder r2 h5', engine.volumeOf('cylinder', { r: 2, h: 5 }).value, 20 * Math.PI, 1e-12);
  t.near('sphere r3', engine.volumeOf('sphere', { r: 3 }).value, 36 * Math.PI, 1e-12);
  t.near('cone r3 h4', engine.volumeOf('cone', { r: 3, h: 4 }).value, 12 * Math.PI, 1e-12);
  t.eq('volume kind', engine.volumeOf('cube', { side: 3 }).kind, 'volume');
  t.eq('volume missing param', engine.volumeOf('box', { l: 2, w: 3 }), { ok: false, error: 'bad_value' });
  t.eq('unknown volume shape', engine.volumeOf('pyramid', { a: 1 }), { ok: false, error: 'unsupported' });

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
