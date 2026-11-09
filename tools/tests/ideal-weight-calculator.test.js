#!/usr/bin/env node
'use strict';

/*
 * ideal-weight-calculator — engine + contract tests.
 * Output ends with: RESULT: N passed, M failed
 */

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'ideal-weight-calculator';
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
} catch (e) {
  /* asserted in the engine group below */
}
try {
  dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
} catch (e) {
  /* asserted in the i18n group below */
}

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

  t.eq('Devine male 180 cm is 75.0 kg', engine.devine(180, 'male').kg, 75);
  t.eq('Robinson male 180 cm is 72.6 kg', engine.robinson(180, 'male').kg, 72.6);
  t.eq('Miller male 180 cm is 71.5 kg', engine.miller(180, 'male').kg, 71.5);
  t.eq('Hamwi male 180 cm is 77.3 kg', engine.hamwi(180, 'male').kg, 77.3);

  t.eq('Devine female 180 cm is 70.5 kg', engine.devine(180, 'female').kg, 70.5);
  t.eq('Robinson female 180 cm is 67.5 kg', engine.robinson(180, 'female').kg, 67.5);
  t.eq('Miller female 180 cm is 67.9 kg', engine.miller(180, 'female').kg, 67.9);
  t.eq('Hamwi female 180 cm is 69.4 kg', engine.hamwi(180, 'female').kg, 69.4);

  t.eq('Devine male 170 cm is 65.9 kg', engine.devine(170, 'male').kg, 65.9);
  t.eq('Miller male 170 cm is 66.0 kg', engine.miller(170, 'male').kg, 66);

  var male180 = engine.idealWeight(180, 'male');
  t.eq('male 180 formulas', male180.kg, { devine: 75, robinson: 72.6, miller: 71.5, hamwi: 77.3 });
  t.eq('male 180 range minimum', male180.minKg, 71.5);
  t.eq('male 180 range maximum', male180.maxKg, 77.3);
  t.eq('male 180 average', male180.avgKg, 74.1);
  t.eq('male 180 pounds range minimum', male180.minLb, 157.6);
  t.eq('male 180 pounds range maximum', male180.maxLb, 170.4);
  t.eq('male 180 pound average', male180.avgLb, 163.4);
  t.eq('male 180 height in inches', male180.inches, 70.9);

  var female180 = engine.idealWeight(180, 'female');
  t.eq('female 180 range minimum', female180.minKg, 67.5);
  t.eq('female 180 range maximum', female180.maxKg, 70.5);
  t.eq('female 180 average', female180.avgKg, 68.8);
  t.ok('female values are lower than male values for every formula',
    female180.kg.devine < male180.kg.devine &&
    female180.kg.robinson < male180.kg.robinson &&
    female180.kg.miller < male180.kg.miller &&
    female180.kg.hamwi < male180.kg.hamwi);

  t.ok('range brackets each formula for male',
    male180.kg.devine >= male180.minKg && male180.kg.devine <= male180.maxKg &&
    male180.kg.robinson >= male180.minKg && male180.kg.robinson <= male180.maxKg &&
    male180.kg.miller >= male180.minKg && male180.kg.miller <= male180.maxKg &&
    male180.kg.hamwi >= male180.minKg && male180.kg.hamwi <= male180.maxKg);
  t.ok('average lies inside the range',
    male180.avgKg >= male180.minKg && male180.avgKg <= male180.maxKg);

  t.eq('Devine 75 kg is 165.3 lb', engine.kgToLb(75).value.toFixed(1), '165.3');
  t.eq('180 cm is 70.866 inches', engine.cmToIn(180).value.toFixed(3), '70.866');
  t.eq('70 inches is 177.8 cm', engine.inToCm(70).value, 177.8);
  t.eq('5 ft 9 in is 175.26 cm', engine.feetInchesToCm(5, 9).value, 175.26);
  t.near('165.3467 lb is about 75 kg', engine.lbToKg(165.3467).value, 75, 0.001);

  t.eq('140 cm is accepted', engine.idealWeight(140, 'male').ok, true);
  t.eq('230 cm is accepted', engine.idealWeight(230, 'female').ok, true);
  t.eq('139 cm is rejected', engine.idealWeight(139, 'male'), { ok: false, error: 'bad_height' });
  t.eq('231 cm is rejected', engine.idealWeight(231, 'male'), { ok: false, error: 'bad_height' });
  t.eq('0 cm is rejected', engine.idealWeight(0, 'male'), { ok: false, error: 'bad_height' });
  t.eq('NaN height is rejected', engine.idealWeight(NaN, 'male'), { ok: false, error: 'bad_height' });
  t.eq('numeric string height is rejected', engine.idealWeight('180', 'male'), { ok: false, error: 'bad_height' });
  t.eq('unknown sex is rejected', engine.idealWeight(180, 'other'), { ok: false, error: 'bad_sex' });
  t.eq('capitalised sex is rejected', engine.idealWeight(180, 'Male'), { ok: false, error: 'bad_sex' });
  t.eq('formula validates sex', engine.devine(180, 'x'), { ok: false, error: 'bad_sex' });
  t.eq('formula validates height', engine.hamwi(100, 'male'), { ok: false, error: 'bad_height' });

  t.eq('feetInchesToCm rejects 12 inches', engine.feetInchesToCm(5, 12), { ok: false, error: 'bad_value' });
  t.eq('feetInchesToCm rejects negative inches', engine.feetInchesToCm(5, -1), { ok: false, error: 'bad_value' });
  t.eq('feetInchesToCm rejects 10 feet', engine.feetInchesToCm(10, 0), { ok: false, error: 'bad_value' });

  t.eq('round1 rounds 2.35 up', engine.round1(2.35), 2.4);
  t.eq('round1 rounds 2.34 down', engine.round1(2.34), 2.3);
  t.eq('round1 rounds -2.35 away from zero', engine.round1(-2.35), -2.4);
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
