#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'image-resizer';
var DIR = path.join('/Users/fa/games/tools', SLUG);
var MAX_BYTES = 120 * 1024;
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

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* asserted below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* asserted below */ }

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
  try { jsonLd = lib.jsonLd(html); t.ok('JSON-LD parses', true); }
  catch (e) { t.ok('JSON-LD parses', false, e.message); }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (x) { return x && x['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  var faqPage = jsonLd.filter(function (x) { return x && x['@type'] === 'FAQPage'; })[0];
  t.ok('FAQPage has 3+ questions', !!faqPage && faqPage.mainEntity.length >= 3);
  t.ok('viewport present', /name\s*=\s*["']viewport["']/i.test(html));
  t.ok('title non-empty', /<title>\s*[^<\s]/i.test(html));
  t.ok('meta description non-empty', /name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html));
  t.ok('canonical correct', new RegExp('rel\\s*=\\s*["\']canonical["\'][^>]*href\\s*=\\s*["\']' +
    EXPECTED_CANONICAL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\']').test(html));
  t.ok('author is Devin', /name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('robots meta present', /name\s*=\s*["']robots["']/i.test(html));
  t.ok('inline favicon', /rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*\brel\s*=\s*["']?stylesheet/i.test(html));
  LANGS.forEach(function (lang) {
    t.eq('one language button for ' + lang,
      (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length, 1);
  });
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 120 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var code = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage',
    !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(code));
  t.ok('engine has no clock dependency',
    !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(code));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(code));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var engineGroup = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  function dims(name, srcW, srcH, opts, w, h) {
    var r = engine.resizeDimensions(srcW, srcH, opts);
    t.ok(name + ' ok', r.ok === true, JSON.stringify(r));
    if (!r.ok) return;
    t.eq(name + ' width', r.width, w);
    t.eq(name + ' height', r.height, h);
  }

  dims('width only locked', 1000, 500, { width: 300 }, 300, 150);
  dims('height only locked', 1000, 500, { height: 100 }, 200, 100);
  dims('percent 50', 1000, 500, { percent: 50 }, 500, 250);
  dims('percent 33.3 rounds half up', 1000, 500, { percent: 33.3 }, 333, 167);
  dims('both sides locked fit inside', 1000, 500, { width: 400, height: 400 }, 400, 200);
  dims('both sides unlocked distort', 1000, 500, { width: 400, height: 400, lockRatio: false }, 400, 400);

  var capped = engine.resizeDimensions(1000, 500, { width: 2000 });
  t.eq('no upscale caps width', capped.width, 1000);
  t.eq('no upscale caps height', capped.height, 500);
  t.eq('no upscale flags limited', capped.limited, true);
  var allowed = engine.resizeDimensions(1000, 500, { width: 2000, allowUpscale: true });
  t.eq('allow upscale width', allowed.width, 2000);
  t.eq('allow upscale height', allowed.height, 1000);
  t.eq('allow upscale not limited', allowed.limited, false);

  var pctUp = engine.resizeDimensions(1000, 500, { percent: 150 });
  t.eq('percent 150 no upscale stays 1000', pctUp.width, 1000);
  t.eq('percent 150 no upscale flags limited', pctUp.limited, true);
  var pctBig = engine.resizeDimensions(1000, 500, { percent: 150, allowUpscale: true });
  t.eq('percent 150 allowed width', pctBig.width, 1500);
  t.eq('percent 150 allowed height', pctBig.height, 750);

  var distorted = engine.resizeDimensions(1000, 500, { width: 400, height: 400, lockRatio: false });
  t.eq('distorted flag', distorted.distorted, true);

  t.eq('width only unlocked needs height',
    engine.resizeDimensions(1000, 500, { width: 300, lockRatio: false }), { ok: false, error: 'missing_height' });
  t.eq('height only unlocked needs width',
    engine.resizeDimensions(1000, 500, { height: 100, lockRatio: false }), { ok: false, error: 'missing_width' });
  t.eq('no input', engine.resizeDimensions(1000, 500, {}), { ok: false, error: 'no_input' });
  t.eq('zero source', engine.resizeDimensions(0, 500, { width: 10 }), { ok: false, error: 'bad_src' });
  t.eq('zero width', engine.resizeDimensions(1000, 500, { width: 0 }), { ok: false, error: 'bad_value' });
  t.eq('negative width', engine.resizeDimensions(1000, 500, { width: -5 }), { ok: false, error: 'bad_value' });
  t.eq('zero percent', engine.resizeDimensions(1000, 500, { percent: 0 }), { ok: false, error: 'bad_percent' });
  t.eq('negative percent', engine.resizeDimensions(1000, 500, { percent: -10 }), { ok: false, error: 'bad_percent' });
  t.eq('percent above limit', engine.resizeDimensions(1000, 500, { percent: 1001 }), { ok: false, error: 'bad_percent' });

  t.eq('scaleX for width driver', engine.resizeDimensions(1000, 500, { width: 300 }).scaleX, 0.3);

  t.eq('suggestName keeps extension', engine.suggestName('photo.JPG', 800, 600, 'jpg'),
    { ok: true, value: 'photo-800x600.jpg' });
  t.eq('suggestName defaults to png', engine.suggestName('photo', 800, 600),
    { ok: true, value: 'photo-800x600.png' });
  t.eq('suggestName strips path', engine.suggestName('dir/a.png', 100, 50, 'png'),
    { ok: true, value: 'a-100x50.png' });
  t.eq('suggestName rejects bad dims', engine.suggestName('a.png', 0, 50), { ok: false, error: 'bad_value' });
  t.eq('suggestName rejects empty name', engine.suggestName('', 10, 10), { ok: false, error: 'bad_name' });

  t.eq('formatBytes 1024', engine.formatBytes(1024), '1.0 KB');
  t.eq('formatBytes negative', engine.formatBytes(-2), '—');
  t.eq('mimeFromName jpeg', engine.mimeFromName('x.JPEG'), { ok: true, value: 'image/jpeg' });
  t.eq('mimeFromName webp', engine.mimeFromName('x.webp'), { ok: true, value: 'image/webp' });
  t.eq('mimeFromName rejects gif', engine.mimeFromName('x.gif'), { ok: false, error: 'unsupported' });
  t.eq('outputMime keep', engine.outputMime('image/webp', 'keep'), { ok: true, value: 'image/webp' });
  t.eq('outputMime explicit', engine.outputMime('image/png', 'image/jpeg'), { ok: true, value: 'image/jpeg' });
  t.eq('outputMime bad', engine.outputMime('image/png', 'image/gif'), { ok: false, error: 'bad_format' });
  t.eq('validateFile too large', engine.validateFile(engine.MAX_FILE_BYTES + 1, 'image/png'),
    { ok: false, error: 'too_large' });
  t.eq('validateFile empty', engine.validateFile(0, 'image/png'), { ok: false, error: 'empty_input' });
  t.eq('validateFile ok', engine.validateFile(1000, 'image/webp'), { ok: true, value: 1000 });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
