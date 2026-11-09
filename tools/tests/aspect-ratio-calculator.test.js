#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'aspect-ratio-calculator';
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

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var full = engine.solve({ mode: 'ratio', width: 1920, height: 1080 });
  t.eq('1920×1080 simplifies to 16:9', [full.ratioW, full.ratioH], [16, 9]);
  t.ok('1920×1080 decimal ratio', Math.abs(full.decimal - 16 / 9) < 1e-12);

  var byHeight = engine.solve({ mode: 'height', width: 1920, ratioW: 16, ratioH: 9 });
  t.eq('width + 16:9 gives height 1080', byHeight.height, 1080);
  var byWidth = engine.solve({ mode: 'width', height: 1080, ratioW: 16, ratioH: 9 });
  t.eq('height + 16:9 gives width 1920', byWidth.width, 1920);

  var portrait = engine.solve({ mode: 'ratio', width: 1080, height: 1920 });
  t.eq('1080×1920 simplifies to 9:16', [portrait.ratioW, portrait.ratioH], [9, 16]);
  t.ok('portrait decimal is 0.5625', Math.abs(portrait.decimal - 0.5625) < 1e-12);

  t.eq('1200×800 simplifies to 3:2', engine.simplifyRatio(1200, 800).ratioW + ':' + engine.simplifyRatio(1200, 800).ratioH, '3:2');
  t.eq('1.5:1 simplifies to 3:2', engine.simplifyRatio(1.5, 1).ratioW + ':' + engine.simplifyRatio(1.5, 1).ratioH, '3:2');
  t.eq('0.5:1 simplifies to 1:2', engine.simplifyRatio(0.5, 1).ratioW + ':' + engine.simplifyRatio(0.5, 1).ratioH, '1:2');
  t.eq('1366×768 simplifies to 683:384', engine.simplifyRatio(1366, 768).ratioW + ':' + engine.simplifyRatio(1366, 768).ratioH, '683:384');
  t.eq('1440×900 simplifies to 8:5', engine.simplifyRatio(1440, 900).ratioW + ':' + engine.simplifyRatio(1440, 900).ratioH, '8:5');
  t.eq('2560×1080 simplifies to 64:27', engine.simplifyRatio(2560, 1080).ratioW + ':' + engine.simplifyRatio(2560, 1080).ratioH, '64:27');
  t.ok('ratio terms stay integers', engine.simplifyRatio(1.5, 1).ratioW === 3 && engine.simplifyRatio(1.5, 1).ratioH === 2);

  var scaleW = engine.scale(1200, 800, 600, 'width');
  t.eq('scale by width to 600', [scaleW.width, scaleW.height], [600, 400]);
  t.eq('scale factor is 0.5', scaleW.scale, 0.5);
  var scaleH = engine.scale(1200, 800, 400, 'height');
  t.eq('scale by height to 400', [scaleH.width, scaleH.height], [600, 400]);
  t.ok('scale preserves ratio', Math.abs(scaleH.width / scaleH.height - 1200 / 800) < 1e-12);

  t.eq('zero width rejected', engine.simplifyRatio(0, 100), { ok: false, error: 'bad_width' });
  t.eq('negative height rejected', engine.simplifyRatio(100, -1), { ok: false, error: 'bad_height' });
  t.eq('string width rejected', engine.simplifyRatio('100', 100), { ok: false, error: 'bad_width' });
  t.eq('width cap enforced', engine.simplifyRatio(10000001, 100), { ok: false, error: 'bad_width' });
  t.eq('zero ratio term rejected', engine.solve({ mode: 'height', width: 100, ratioW: 0, ratioH: 9 }),
    { ok: false, error: 'bad_ratio' });
  t.eq('ratio term cap enforced', engine.solve({ mode: 'height', width: 100, ratioW: 2000000, ratioH: 9 }),
    { ok: false, error: 'bad_ratio' });
  t.eq('unknown mode rejected', engine.solve({ mode: 'diagonal', width: 100, height: 100 }),
    { ok: false, error: 'bad_mode' });
  t.eq('missing input rejected', engine.solve(null), { ok: false, error: 'bad_value' });
  t.eq('height overflow rejected', engine.solve({ mode: 'height', width: 10000000, ratioW: 0.000001, ratioH: 1000000 }),
    { ok: false, error: 'overflow' });
  t.eq('scale reject zero target', engine.scale(1200, 800, 0, 'width'), { ok: false, error: 'bad_target' });
  t.eq('scale reject bad mode', engine.scale(1200, 800, 600, 'diagonal'), { ok: false, error: 'bad_mode' });
  t.eq('gcd(1920, 1080)', engine.gcd(1920, 1080), 120);

  var presetList = engine.PRESETS.map(function (p) { return p.w + ':' + p.h; });
  t.eq('five common presets', presetList, ['16:9', '4:3', '1:1', '9:16', '21:9']);

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
