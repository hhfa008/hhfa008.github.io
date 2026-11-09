#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'grade-calculator';
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

  r = engine.weightedGrade([{ score: 90, weight: 50 }, { score: 80, weight: 50 }]);
  t.eq('weighted 90/80 at 50-50 ok', r.ok, true);
  t.near('weighted 90/80 at 50-50 = 85', r.value, 85, 1e-9);
  t.eq('weight sum reported', r.weightSum, 100);

  r = engine.weightedGrade([{ score: 90, weight: 2 }, { score: 80, weight: 1 }]);
  t.near('weights normalised (2:1) = 86.6667', r.value, 260 / 3, 1e-9);

  r = engine.weightedGrade([{ score: 75, weight: 0 }, { score: 90, weight: 10 }]);
  t.near('zero-weight item ignored', r.value, 90, 1e-9);
  t.eq('zero-weight item still counted in count', r.count, 2);

  r = engine.weightedGrade([{ score: 0, weight: 10 }]);
  t.eq('zero score allowed', r.value, 0);
  t.eq('zero score ok', r.ok, true);

  t.eq('empty items rejected', engine.weightedGrade([]), { ok: false, error: 'empty_input' });
  t.eq('non-array rejected', engine.weightedGrade(null), { ok: false, error: 'empty_input' });
  t.eq('all-zero weights rejected', engine.weightedGrade([{ score: 90, weight: 0 }]),
    { ok: false, error: 'zero_weight' });
  t.eq('score above 100 rejected', engine.weightedGrade([{ score: 101, weight: 10 }]),
    { ok: false, error: 'range' });
  t.eq('negative score rejected', engine.weightedGrade([{ score: -1, weight: 10 }]),
    { ok: false, error: 'range' });
  t.eq('negative weight rejected', engine.weightedGrade([{ score: 80, weight: -1 }]),
    { ok: false, error: 'range' });
  t.eq('NaN score rejected', engine.weightedGrade([{ score: NaN, weight: 10 }]),
    { ok: false, error: 'bad_value' });
  t.eq('string score rejected', engine.weightedGrade([{ score: '80', weight: 10 }]),
    { ok: false, error: 'bad_value' });
  t.eq('null item rejected', engine.weightedGrade([null]), { ok: false, error: 'bad_value' });

  t.eq('letter 93 = A', engine.letterFor(93), { ok: true, letter: 'A' });
  t.eq('letter 92.99 = A-', engine.letterFor(92.99), { ok: true, letter: 'A-' });
  t.eq('letter 60 = D-', engine.letterFor(60), { ok: true, letter: 'D-' });
  t.eq('letter 59.99 = F', engine.letterFor(59.99), { ok: true, letter: 'F' });
  t.eq('letter 101 rejected', engine.letterFor(101), { ok: false, error: 'range' });

  r = engine.gradePoint(95, '4.0');
  t.eq('gradePoint(95, 4.0) = 4.0', r.value, 4.0);
  t.eq('gradePoint(85, 4.0) = 3.0', engine.gradePoint(85, '4.0').value, 3.0);
  t.eq('gradePoint(75, 4.0) = 2.0', engine.gradePoint(75, '4.0').value, 2.0);
  t.eq('gradePoint(65, 4.0) = 1.0', engine.gradePoint(65, '4.0').value, 1.0);
  t.eq('gradePoint(55, 4.0) = 0', engine.gradePoint(55, '4.0').value, 0);
  t.eq('gradePoint(98, 4.3) = 4.3', engine.gradePoint(98, '4.3').value, 4.3);
  t.eq('gradePoint(95, 4.3) = 4.0', engine.gradePoint(95, '4.3').value, 4.0);
  t.eq('gradePoint(92, 4.3) = 3.7', engine.gradePoint(92, '4.3').value, 3.7);
  t.eq('invalid scale rejected', engine.gradePoint(90, '5.0'), { ok: false, error: 'bad_mode' });
  t.eq('numeric scale 4 accepted', engine.gradePoint(90, 4).ok, true);

  r = engine.gpa([{ score: 95, credits: 4 }, { score: 85, credits: 2 }], '4.0');
  t.eq('gpa ok', r.ok, true);
  t.near('credit-weighted GPA = 3.6667', r.value, 11 / 3, 1e-9);
  t.eq('gpa total credits', r.credits, 6);

  r = engine.gpa([{ score: 95, weight: 4 }, { score: 85, weight: 2 }], '4.0');
  t.near('gpa falls back to weight', r.value, 11 / 3, 1e-9);

  t.eq('gpa rejects zero credit', engine.gpa([{ score: 90, credits: 0 }], '4.0'),
    { ok: false, error: 'range' });
  t.eq('gpa rejects empty', engine.gpa([], '4.0'), { ok: false, error: 'empty_input' });
  t.eq('gpa rejects bad scale', engine.gpa([{ score: 90, credits: 1 }], '5.0'),
    { ok: false, error: 'bad_mode' });

  r = engine.neededForTarget([{ score: 80, weight: 50 }], 90, 50);
  t.eq('needed ok', r.ok, true);
  t.near('needed for 90 with 50 left = 100', r.value, 100, 1e-9);
  t.eq('needed feasible', r.feasible, true);
  t.eq('needed not already met', r.alreadyMet, false);

  r = engine.neededForTarget([{ score: 95, weight: 100 }], 85, 10);
  t.near('target already met returns negative', r.value, -15, 1e-9);
  t.eq('alreadyMet true', r.alreadyMet, true);

  r = engine.neededForTarget([{ score: 60, weight: 100 }], 95, 10);
  t.near('impossible needed = 445', r.value, 445, 1e-9);
  t.eq('feasible false above 100', r.feasible, false);

  r = engine.neededForTarget([], 88, 100);
  t.near('no completed items needed = target', r.value, 88, 1e-9);

  t.eq('zero remaining weight rejected', engine.neededForTarget([], 90, 0),
    { ok: false, error: 'zero_weight' });
  t.eq('negative remaining rejected', engine.neededForTarget([], 90, -1),
    { ok: false, error: 'range' });
  t.eq('target above 100 rejected', engine.neededForTarget([], 101, 10),
    { ok: false, error: 'range' });
  t.eq('bad item in target rejected', engine.neededForTarget([{ score: 90, weight: NaN }], 90, 10),
    { ok: false, error: 'bad_value' });
  t.eq('numeric target NaN rejected', engine.neededForTarget([], NaN, 10),
    { ok: false, error: 'bad_value' });

  return 'weighted, GPA and target rules';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
