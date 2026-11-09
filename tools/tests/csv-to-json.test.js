#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var lib = require('/Users/fa/games/tools/tests/lib.js');

var SLUG = 'csv-to-json';
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
var engine = null;
var dict = null;
var t = lib.suite(SLUG);

try { engine = lib.evalScript(html, 'engine', 'ToolEngine'); } catch (e) { /* reported below */ }
try { dict = lib.evalScript(html, 'i18n', 'TOOL_I18N'); } catch (e) { /* reported below */ }

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

  var simple = engine.parseCsv('a,b\n1,2\n');
  t.ok('parseCsv ok', simple.ok === true);
  t.eq('parseCsv row count', simple.rows.length, 2);
  t.eq('parseCsv header cells', simple.rows[0].cells, ['a', 'b']);
  t.eq('parseCsv data cells', simple.rows[1].cells, ['1', '2']);

  var quotedComma = engine.parseCsv('a,b\n"x,y",2\n');
  t.eq('quoted comma stays one cell', quotedComma.rows[1].cells, ['x,y', '2']);

  var quotedNewline = engine.parseCsv('a\n"line1\nline2"\n');
  t.eq('quoted newline row count', quotedNewline.rows.length, 2);
  t.eq('quoted newline cell', quotedNewline.rows[1].cells[0], 'line1\nline2');

  var escaped = engine.parseCsv('a\n"say ""hi"""\n');
  t.eq('escaped quotes', escaped.rows[1].cells[0], 'say "hi"');

  var crlf = engine.parseCsv('a,b\r\n1,2\r\n');
  t.eq('CRLF row count', crlf.rows.length, 2);
  t.eq('CRLF cells', crlf.rows[1].cells, ['1', '2']);

  var bom = engine.parseCsv('\uFEFFa,b\n1,2\n');
  t.eq('BOM stripped from first header', bom.rows[0].cells[0], 'a');

  var semi = engine.parseCsv('a;b\n1;2\n', { delimiter: ';' });
  t.eq('semicolon delimiter', semi.rows[1].cells, ['1', '2']);
  var tab = engine.parseCsv('a\tb\n1\t2\n', { delimiter: '\t' });
  t.eq('tab delimiter', tab.rows[1].cells, ['1', '2']);

  var badDelim = engine.parseCsv('a,b', { delimiter: '::' });
  t.eq('bad delimiter rejected', badDelim, { ok: false, error: 'bad_delimiter' });

  var unclosed = engine.parseCsv('a,b\n"oops,2\n');
  t.eq('unclosed quote error code', unclosed.error, 'unclosed_quote');
  t.eq('unclosed quote line', unclosed.line, 2);
  t.eq('unclosed quote column', unclosed.column, 1);

  var midQuote = engine.parseCsv('a\nab"cd\n');
  t.eq('quote inside unquoted field rejected', midQuote.error, 'bad_quote');

  t.eq('infer integer', engine.inferValue('42'), 42);
  t.eq('infer float', engine.inferValue('1.5'), 1.5);
  t.eq('infer negative', engine.inferValue('-7'), -7);
  t.eq('infer boolean true', engine.inferValue('TRUE'), true);
  t.eq('infer boolean false', engine.inferValue('false'), false);
  t.eq('infer null', engine.inferValue('null'), null);
  t.eq('infer empty stays string', engine.inferValue(''), '');
  t.eq('infer spaces stays string', engine.inferValue('  '), '');
  t.eq('infer leading zero number', engine.inferValue('007'), 7);
  t.eq('infer alphabet stays string', engine.inferValue('1a'), '1a');
  t.eq('infer huge integer stays string', engine.inferValue('12345678901234567890'), '12345678901234567890');

  var rows = engine.parseCsv(' id , id ,,\n1,2,3,4\n');
  var json = engine.toJson(rows.rows, { hasHeader: true, inferTypes: true });
  t.eq('duplicate header renamed', json.columns, ['id', 'id_2', 'column_3', 'column_4']);
  t.ok('duplicate header warning', json.warnings.some(function (w) { return w.type === 'duplicate_header'; }));

  var nested = engine.toJson(
    engine.parseCsv('user.name,user.age,active\nAda,36,true\n').rows,
    { hasHeader: true, inferTypes: true, nested: true }
  );
  t.eq('nested object built', JSON.stringify(nested.data[0]), '{"user":{"name":"Ada","age":36},"active":true}');

  var noHeader = engine.toJson(engine.parseCsv('1,2\n3,4\n').rows, { hasHeader: false, inferTypes: true });
  t.eq('no header gives array of arrays', JSON.stringify(noHeader.data), '[[1,2],[3,4]]');

  var padded = engine.toJson(engine.parseCsv('a,b,c\n1\n').rows, { hasHeader: true, inferTypes: false });
  t.eq('short row padded', JSON.stringify(padded.data[0]), '{"a":"1","b":"","c":""}');

  var extra = engine.toJson(engine.parseCsv('a,b\n1,2,3\n').rows, { hasHeader: true });
  t.ok('extra cell warning', extra.warnings.some(function (w) { return w.type === 'extra_cells' && w.line === 2 && w.n === 1; }));

  t.eq('empty csv yields no rows', engine.parseCsv('').rows.length, 0);
  t.eq('toJson empty', JSON.stringify(engine.toJson([], { hasHeader: true }).data), '[]');
  return '';
});

t.group('engine coverage', function () {
  var total = engineGroup.pass + engineGroup.fail;
  t.ok('engine group has at least 14 assertions', total >= 14, 'found ' + total);
  return total + ' assertions';
});

t.done();
