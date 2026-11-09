#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'image-rotate';
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

  function angle(name, input, expected) {
    t.eq(name, engine.normalizeAngle(input), { ok: true, value: expected });
  }
  angle('normalize 0', 0, 0);
  angle('normalize 90', 90, 90);
  angle('normalize 180', 180, 180);
  angle('normalize 270', 270, 270);
  angle('normalize 360', 360, 0);
  angle('normalize 450', 450, 90);
  angle('normalize 720', 720, 0);
  angle('normalize -90', -90, 270);
  angle('normalize -180', -180, 180);
  angle('normalize -450', -450, 270);
  t.eq('normalize rejects 45', engine.normalizeAngle(45), { ok: false, error: 'bad_angle' });
  t.eq('normalize rejects 90.5', engine.normalizeAngle(90.5), { ok: false, error: 'bad_angle' });
  t.eq('normalize rejects string', engine.normalizeAngle('90'), { ok: false, error: 'bad_value' });
  t.eq('normalize rejects NaN', engine.normalizeAngle(NaN), { ok: false, error: 'bad_value' });

  t.eq('0 degrees keeps size', engine.rotateDimensions(100, 50, 0),
    { ok: true, width: 100, height: 50, angle: 0, swapped: false });
  t.eq('90 degrees swaps size', engine.rotateDimensions(100, 50, 90),
    { ok: true, width: 50, height: 100, angle: 90, swapped: true });
  t.eq('180 degrees keeps size', engine.rotateDimensions(100, 50, 180),
    { ok: true, width: 100, height: 50, angle: 180, swapped: false });
  t.eq('270 degrees swaps size', engine.rotateDimensions(100, 50, 270),
    { ok: true, width: 50, height: 100, angle: 270, swapped: true });
  t.eq('-90 degrees swaps size', engine.rotateDimensions(100, 50, -90),
    { ok: true, width: 50, height: 100, angle: 270, swapped: true });
  t.eq('360 degrees normalizes', engine.rotateDimensions(100, 50, 360),
    { ok: true, width: 100, height: 50, angle: 0, swapped: false });
  t.eq('zero source rejected', engine.rotateDimensions(0, 50, 90), { ok: false, error: 'bad_size' });
  t.eq('negative source rejected', engine.rotateDimensions(100, -50, 90), { ok: false, error: 'bad_size' });
  t.eq('bad angle rejected by dims', engine.rotateDimensions(100, 50, 45), { ok: false, error: 'bad_angle' });

  t.eq('nextAngle wraps right', engine.nextAngle(270, 90), { ok: true, value: 0 });
  t.eq('nextAngle wraps left', engine.nextAngle(0, -90), { ok: true, value: 270 });
  t.eq('nextAngle adds 180', engine.nextAngle(90, 180), { ok: true, value: 270 });
  t.eq('nextAngle rejects 45', engine.nextAngle(0, 45), { ok: false, error: 'bad_angle' });
  t.eq('nextAngle rejects string', engine.nextAngle('0', 90), { ok: false, error: 'bad_value' });

  t.eq('outputName angle and one flip', engine.outputName('photo.JPG', 90, true, false, 'jpg'),
    { ok: true, value: 'photo-r90-fh.jpg' });
  t.eq('outputName both flips', engine.outputName('photo.png', 180, true, true, 'png'),
    { ok: true, value: 'photo-r180-fh-fv.png' });
  t.eq('outputName defaults to png', engine.outputName('photo', 0, false, false),
    { ok: true, value: 'photo-r0.png' });
  t.eq('outputName strips path', engine.outputName('dir/a.webp', 270, false, false, 'webp'),
    { ok: true, value: 'a-r270.webp' });
  t.eq('outputName rejects empty', engine.outputName('', 90, false, false, 'jpg'),
    { ok: false, error: 'bad_name' });
  t.eq('outputName rejects bad angle', engine.outputName('a.png', 45, false, false, 'png'),
    { ok: false, error: 'bad_angle' });

  t.eq('formatBytes 2048', engine.formatBytes(2048), '2.0 KB');
  t.eq('formatBytes negative', engine.formatBytes(-1), '—');
  t.eq('extension jpeg', engine.extensionForMime('image/jpeg'), { ok: true, value: 'jpg' });
  t.eq('extension webp', engine.extensionForMime('image/webp'), { ok: true, value: 'webp' });
  t.eq('extension rejects gif', engine.extensionForMime('image/gif'), { ok: false, error: 'unsupported' });
  t.eq('outputMime keep', engine.outputMime('image/png', 'keep'), { ok: true, value: 'image/png' });
  t.eq('outputMime explicit png', engine.outputMime('image/jpeg', 'image/png'), { ok: true, value: 'image/png' });
  t.eq('outputMime bad choice', engine.outputMime('image/jpeg', 'image/gif'), { ok: false, error: 'bad_format' });
  t.eq('validateFile empty', engine.validateFile(0, 'image/png'), { ok: false, error: 'empty_input' });
  t.eq('validateFile too large', engine.validateFile(engine.MAX_FILE_BYTES + 1, 'image/png'),
    { ok: false, error: 'too_large' });
  t.eq('validateFile unsupported', engine.validateFile(100, 'image/gif'), { ok: false, error: 'unsupported' });
  t.eq('validateFile ok', engine.validateFile(100, 'image/jpeg'), { ok: true, value: 100 });

  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 15 assertions', total >= 15, 'found ' + total);
  return total + ' assertions';
});

t.done();
