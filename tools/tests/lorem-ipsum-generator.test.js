'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'lorem-ipsum-generator';
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

var html = lib.page(DIR);
var engine = lib.evalScript(html, 'engine', 'ToolEngine');
var dict = lib.evalScript(html, 'i18n', 'TOOL_I18N');
var t = lib.suite(SLUG);

function sentencesOf(text) {
  return text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; });
}
function wordsOf(text) {
  return text.trim().split(/\s+/).filter(function (w) { return w.length > 0; });
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
  t.eq('externalRefs is empty', lib.externalRefs(html), []);
  var jsonLd = [];
  try {
    jsonLd = lib.jsonLd(html);
    t.ok('JSON-LD parses', true);
  } catch (e) {
    t.ok('JSON-LD parses', false, e.message);
  }
  t.eq('JSON-LD block count', jsonLd.length, 3);
  t.eq('JSON-LD types', jsonLd.map(function (x) { return x && x['@type']; }).sort(),
    ['BreadcrumbList', 'FAQPage', 'SoftwareApplication']);
  t.ok('viewport present', /width=device-width/i.test(html));
  t.ok('canonical correct', html.indexOf('rel="canonical" href="' + EXPECTED_CANONICAL + '"') !== -1);
  t.ok('meta description non-empty', /<meta name="description" content="[^"]+"/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  t.ok('no stylesheet link', !/<link[^>]*rel=["']?stylesheet/i.test(html));
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var code = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage', !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b/.test(code));
  t.ok('engine has no clock dependency', !/\bDate\s*\.\s*now|\bnew\s+Date\b|\bperformance\s*\.\s*now/.test(code));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(code));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var group = t.group('engine', function () {
  t.ok('ToolEngine exported', !!engine && typeof engine === 'object');
  if (!engine) return 'engine missing';

  var w12 = engine.generateWords(12, { seed: 'alpha' });
  t.ok('generateWords succeeds', w12.ok);
  t.eq('word count is exact', wordsOf(w12.text).length, 12);
  t.eq('words result reports count', w12.words, 12);
  t.eq('word mode has no sentences', w12.sentences, 0);
  t.eq('default seed is lorem', engine.generateWords(3, {}).seed, 'lorem');
  t.eq('empty seed falls back to lorem', engine.generateWords(3, { seed: '' }).seed, 'lorem');

  var opener = engine.generateWords(5, { seed: 'beta', startWithLorem: true });
  var openerWords = wordsOf(opener.text);
  t.eq('lorem opener first word', openerWords[0], 'Lorem');
  t.eq('lorem opener second word', openerWords[1], 'ipsum');
  t.eq('lorem opener keeps exact count', openerWords.length, 5);
  t.eq('single word opener', engine.generateWords(1, { seed: 'x', startWithLorem: true }).text, 'Lorem');

  t.eq('same seed reproduces words',
    engine.generateWords(20, { seed: 'repeat' }).text,
    engine.generateWords(20, { seed: 'repeat' }).text);
  t.ok('different seed changes words',
    engine.generateWords(20, { seed: 'one' }).text !== engine.generateWords(20, { seed: 'two' }).text);

  var s4 = engine.generateSentences(4, { seed: 'gamma' });
  t.ok('generateSentences succeeds', s4.ok);
  t.eq('sentence count is exact', sentencesOf(s4.text).length, 4);
  t.eq('sentences result reports count', s4.sentences, 4);
  sentencesOf(s4.text).forEach(function (s, i) {
    var n = wordsOf(s).length;
    t.ok('sentence ' + (i + 1) + ' has 5-12 words', n >= 5 && n <= 12, 'got ' + n);
  });
  t.eq('startWithLorem begins the first sentence', engine.generateSentences(1, { seed: 's', startWithLorem: true }).text,
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.');
  t.eq('same seed reproduces sentences',
    engine.generateSentences(6, { seed: 'snap' }).text,
    engine.generateSentences(6, { seed: 'snap' }).text);

  var p3 = engine.generateParagraphs(3, { seed: 'delta', startWithLorem: true });
  t.ok('generateParagraphs succeeds', p3.ok);
  var paras = p3.text.split('\n\n');
  t.eq('paragraph count is exact', paras.length, 3);
  t.eq('paragraphs result reports count', p3.paragraphs, 3);
  paras.forEach(function (para, i) {
    var n = sentencesOf(para).length;
    t.ok('paragraph ' + (i + 1) + ' has 3-6 sentences', n >= 3 && n <= 6, 'got ' + n);
  });
  t.ok('opener starts the first paragraph', paras[0].indexOf('Lorem ipsum') === 0);
  t.ok('paragraph sentence total is 9-18', p3.sentences >= 9 && p3.sentences <= 18, 'got ' + p3.sentences);

  var withTags = engine.generateParagraphs(2, { seed: 'tags', html: true });
  t.ok('html option wraps paragraphs', /^<p>.*<\/p>\n\n<p>.*<\/p>$/.test(withTags.text));
  t.ok('html option keeps paragraph count', withTags.text.split('\n\n').length, 2);
  t.ok('no duplicated punctuation', !/\.\.|,,|\.\,/.test(p3.text));

  var badCounts = [0, -1, 1.5, NaN, Infinity, '3'];
  badCounts.forEach(function (n) {
    t.eq('rejects word count ' + String(n), engine.generateWords(n, {}).error, 'bad_count');
  });
  t.eq('rejects too many paragraphs', engine.generateParagraphs(51, {}).error, 'bad_count');
  t.eq('maxFor knows modes', [engine.maxFor('words'), engine.maxFor('sentences'), engine.maxFor('paragraphs')],
    [1000, 200, 50]);
  t.eq('maxFor rejects unknown mode', engine.maxFor('chapters'), 0);

  var r1 = engine.makeRng('same');
  var r2 = engine.makeRng('same');
  t.eq('rng deterministic first value', r1(), r2());
  t.eq('rng deterministic second value', r1(), r2());

  return 'words, sentences, paragraphs and seed covered';
});

t.group('engine coverage', function () {
  var total = group.pass + group.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
