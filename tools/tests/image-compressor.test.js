#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'image-compressor';
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

  function eq(name, value, expected) { t.eq(name, value, expected); }

  var dims = engine.calculateDimensions(4000, 3000, 1920, 1080);
  eq('calculateDimensions scales by the tighter limit', dims, { ok: true, width: 1440, height: 1080, scale: 0.36, scaled: true });
  eq('calculateDimensions keeps ratio for 800x600 at 1920', engine.calculateDimensions(800, 600, 1920, 1920),
    { ok: true, width: 800, height: 600, scale: 1, scaled: false });
  eq('width limit only', engine.calculateDimensions(800, 600, 400, 0),
    { ok: true, width: 400, height: 300, scale: 0.5, scaled: true });
  eq('height limit only', engine.calculateDimensions(800, 600, 0, 300),
    { ok: true, width: 400, height: 300, scale: 0.5, scaled: true });
  eq('never shrinks below 1px', engine.calculateDimensions(10, 10, 1, 1),
    { ok: true, width: 1, height: 1, scale: 0.1, scaled: true });
  eq('zero width rejected', engine.calculateDimensions(0, 100, 10, 10), { ok: false, error: 'bad_size' });
  eq('negative height rejected', engine.calculateDimensions(100, -1, 10, 10), { ok: false, error: 'bad_size' });
  eq('NaN width rejected', engine.calculateDimensions(NaN, 100, 10, 10), { ok: false, error: 'bad_size' });
  eq('bad max limit', engine.calculateDimensions(100, 100, -1, 0), { ok: false, error: 'bad_limit' });
  eq('decimal max limit rejected', engine.normalizeLimit(100.5), { ok: false, error: 'bad_limit' });
  eq('empty max limit means unlimited', engine.normalizeLimit(''), { ok: true, value: 0 });

  eq('formatBytes 0', engine.formatBytes(0), '0 B');
  eq('formatBytes 1023', engine.formatBytes(1023), '1023 B');
  eq('formatBytes 1024', engine.formatBytes(1024), '1.0 KB');
  eq('formatBytes 1536', engine.formatBytes(1536), '1.5 KB');
  eq('formatBytes 1048576', engine.formatBytes(1048576), '1.0 MB');
  eq('formatBytes negative', engine.formatBytes(-1), '—');

  eq('compressionRatio half', engine.compressionRatio(1000, 500), { ok: true, value: 50 });
  eq('compressionRatio equal', engine.compressionRatio(1000, 1000), { ok: true, value: 0 });
  eq('compressionRatio growth is negative', engine.compressionRatio(1000, 1500), { ok: true, value: -50 });
  eq('compressionRatio rounds one decimal', engine.compressionRatio(3, 2), { ok: true, value: 33.3 });
  eq('compressionRatio rejects zero before', engine.compressionRatio(0, 10), { ok: false, error: 'bad_bytes' });

  eq('quality 10 accepted', engine.validateQuality(10), { ok: true, value: 10 });
  eq('quality 100 accepted', engine.validateQuality(100), { ok: true, value: 100 });
  eq('quality 9 rejected', engine.validateQuality(9), { ok: false, error: 'bad_quality' });
  eq('quality 101 rejected', engine.validateQuality(101), { ok: false, error: 'bad_quality' });
  eq('quality fraction rejected', engine.validateQuality(80.5), { ok: false, error: 'bad_quality' });

  eq('outputMime keeps webp', engine.outputMime('image/webp', 'keep'), { ok: true, value: 'image/webp' });
  eq('outputMime unknown source falls back to png', engine.outputMime('image/gif', 'keep'), { ok: true, value: 'image/png' });
  eq('outputMime explicit jpeg', engine.outputMime('image/png', 'image/jpeg'), { ok: true, value: 'image/jpeg' });
  eq('outputMime bad choice', engine.outputMime('image/png', 'gif'), { ok: false, error: 'bad_format' });
  eq('extensionForMime jpeg', engine.extensionForMime('image/jpeg'), { ok: true, value: 'jpg' });
  eq('extensionForMime webp', engine.extensionForMime('image/webp'), { ok: true, value: 'webp' });
  eq('extensionForMime rejects gif', engine.extensionForMime('image/gif'), { ok: false, error: 'unsupported' });

  eq('validateFile empty', engine.validateFile(0, 'image/png'), { ok: false, error: 'empty_input' });
  eq('validateFile too large', engine.validateFile(engine.MAX_FILE_BYTES + 1, 'image/png'), { ok: false, error: 'too_large' });
  eq('validateFile wrong mime', engine.validateFile(1000, 'image/gif'), { ok: false, error: 'unsupported' });
  eq('validateFile accepts png at limit', engine.validateFile(engine.MAX_FILE_BYTES, 'image/png'),
    { ok: true, value: engine.MAX_FILE_BYTES });

  eq('outputName adds suffix', engine.outputName('photo.JPG', 'jpg'), { ok: true, value: 'photo-compressed.jpg' });
  eq('outputName strips path', engine.outputName('dir/sub/a.png', 'png'), { ok: true, value: 'a-compressed.png' });
  eq('outputName keeps inner dots', engine.outputName('a.b.webp', 'webp'), { ok: true, value: 'a.b-compressed.webp' });
  eq('outputName rejects empty', engine.outputName('', 'png'), { ok: false, error: 'bad_name' });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
