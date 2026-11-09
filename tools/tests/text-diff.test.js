#!/usr/bin/env node
'use strict';

var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'text-diff';
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
  t.ok('viewport present', /<meta[^>]+name\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width=device-width/i.test(html));
  t.ok('title non-empty', /<title>\s*[^<]+?\s*<\/title>/i.test(html));
  t.ok('meta description non-empty', /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']+["']/i.test(html));
  t.ok('canonical correct', (function () {
    var m = html.match(/<link[^>]+rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i);
    return !!m && m[1] === EXPECTED_CANONICAL;
  })());
  t.ok('author is Devin', /<meta[^>]+name\s*=\s*["']author["'][^>]*content\s*=\s*["']Devin["']/i.test(html));
  t.ok('inline favicon', /<link[^>]+rel\s*=\s*["']icon["'][^>]*href\s*=\s*["']data:image\/svg\+xml/i.test(html));
  t.ok('no <script src>', !/<script[^>]*\bsrc\s*=/i.test(html));
  LANGS.forEach(function (lang) {
    var n = (html.match(new RegExp('data-lang\\s*=\\s*["\']' + lang + '["\']', 'g')) || []).length;
    t.eq('one language button for ' + lang, n, 1);
  });
  var bytes = Buffer.byteLength(html, 'utf8');
  t.ok('file <= 90 KB', bytes <= MAX_BYTES, (bytes / 1024).toFixed(1) + ' KB');
  var engineCode = lib.scriptCode(html, 'engine');
  t.ok('engine has no DOM/window/storage', !/\bdocument\s*\.|\bwindow\s*\.|\blocalStorage\b|\bsessionStorage\b/.test(engineCode));
  t.ok('engine has no clock dependency', !/\bDate\s*\.\s*now\s*\(|new\s+Date\b|\bperformance\s*\.\s*now\s*\(/.test(engineCode));
  t.ok('engine does not use Math.random', !/\bMath\s*\.\s*random\s*\(/.test(engineCode));
  return (bytes / 1024).toFixed(1) + ' KB';
});

var eg = t.group('engine', function () {
  var base = engine.diffLines('a\nb\nc', 'a\nb\nc');
  t.ok('identical texts parse', base.ok);
  t.eq('identical rows are all same', base.rows.map(function (r) { return r.type; }), ['same', 'same', 'same']);
  t.eq('identical stats', base.stats, { added: 0, removed: 0, unchanged: 3, aLines: 3, bLines: 3, changes: 0 });

  var insert = engine.diffLines('a\nc', 'a\nb\nc');
  t.eq('insertion row', insert.rows[1], { type: 'add', text: 'b', aLine: null, bLine: 2 });
  t.eq('insertion stats', [insert.stats.added, insert.stats.removed], [1, 0]);

  var remove = engine.diffLines('a\nb\nc', 'a\nc');
  t.eq('deletion row', remove.rows[1], { type: 'del', text: 'b', aLine: 2, bLine: null });
  t.eq('deletion stats', [remove.stats.added, remove.stats.removed], [0, 1]);

  var replace = engine.diffLines('a\nb\nc', 'a\nx\nc');
  t.eq('replacement becomes del + add', replace.rows.map(function (r) { return r.type; }), ['same', 'del', 'add', 'same']);
  t.eq('replacement line numbers', [replace.rows[1].aLine, replace.rows[2].bLine], [2, 2]);

  t.eq('both empty', engine.diffLines('', '').rows, []);
  t.eq('left empty adds every line', engine.diffLines('', 'a\nb').stats.added, 2);
  t.eq('right empty removes every line', engine.diffLines('a\nb', '').stats.removed, 2);
  t.eq('empty text has zero lines', engine.splitLines('').length, 0);

  var crlf = engine.diffLines('a\r\nb', 'a\nb');
  t.eq('CRLF normalized', crlf.stats.unchanged, 2);
  t.eq('trailing newline creates empty line', engine.diffLines('a', 'a\n').stats.added, 1);

  var ws = engine.diffLines('  A   b ', 'a b', { ignoreWhitespace: true, ignoreCase: true });
  t.eq('ignore whitespace and case', ws.stats.unchanged, 1);
  t.eq('ignore case only', engine.diffLines('A', 'a', { ignoreCase: true }).stats.unchanged, 1);
  t.eq('case matters by default', engine.diffLines('A', 'a').stats.changes, 2);

  var side = engine.sideBySide(replace.rows);
  t.ok('side-by-side pairs', side.ok);
  t.eq('replacement paired', [side.pairs[1].left.type, side.pairs[1].right.type], ['del', 'add']);
  t.eq('same rows mirrored', side.pairs[0].left.text, side.pairs[0].right.text);

  t.eq('unified text', engine.unifiedText(replace.rows), { ok: true, value: '  a\n- b\n+ x\n  c' });
  t.eq('unified text rejects non-array', engine.unifiedText('x'), { ok: false, error: 'bad_value' });

  var tooMany = new Array(2001).join('\n');
  t.eq('line limit rejects large text', engine.diffLines(tooMany, 'y'), { ok: false, error: 'too_large' });
  t.eq('non-string input rejected', engine.diffLines(null, 'a'), { ok: false, error: 'bad_value' });

  var all = engine.diffLines('a\nb', 'a\nc\nd');
  t.eq('stats conservation', all.stats.unchanged + all.stats.removed, all.stats.aLines);
  t.eq('right line conservation', all.stats.unchanged + all.stats.added, all.stats.bLines);
  return '';
});

t.group('engine coverage', function () {
  var total = eg.pass + eg.fail;
  t.ok('engine group has at least 12 assertions', total >= 12, 'found ' + total);
  return total + ' assertions';
});

t.done();
